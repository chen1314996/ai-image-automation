const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const express = require('express');
const { createCanvas, loadImage } = require('canvas');

const registerDeliveryRoutes = require('../src/routes/delivery.routes');
const { readImageDimensions } = require('../src/services/image-renamer');

const ROOT = path.join(__dirname, '..');
const TEST_ROOT = path.join(ROOT, 'runtime', 's11-stage6-acceptance');
const OUTPUT_DIR = path.join(TEST_ROOT, 'delivery-output');
const LOGO_DIR = path.join(TEST_ROOT, 'logo-templates');
const TARGET_SIZES = ['800x800', '1280x720', '1080x1920'];
const TARGET_DIMENSIONS = {
    '800x800': { width: 800, height: 800 },
    '1280x720': { width: 1280, height: 720 },
    '1080x1920': { width: 1080, height: 1920 }
};

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

function resetTestRoot() {
    const resolved = path.resolve(TEST_ROOT);
    const runtimeRoot = path.resolve(path.join(ROOT, 'runtime'));
    assert.ok(resolved.startsWith(runtimeRoot), 'Refusing to delete outside runtime directory');
    fs.rmSync(resolved, { recursive: true, force: true });
    ensureDir(OUTPUT_DIR);
    ensureDir(LOGO_DIR);
}

function writePng(filePath, width, height, seed = 1) {
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    const hue = (seed * 41) % 360;
    ctx.fillStyle = `hsl(${hue}, 58%, 48%)`;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.78)';
    ctx.fillRect(Math.floor(width * 0.10), Math.floor(height * 0.14), Math.floor(width * 0.46), Math.floor(height * 0.34));
    ctx.fillStyle = 'rgba(80, 80, 80, 0.36)';
    ctx.fillRect(Math.floor(width * 0.58), Math.floor(height * 0.58), Math.floor(width * 0.24), Math.floor(height * 0.22));
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, canvas.toBuffer('image/png'));
}

function writeLogoTemplates(targetSizes = TARGET_SIZES) {
    targetSizes.forEach(targetSize => {
        const { width, height } = TARGET_DIMENSIONS[targetSize];
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.01)';
        ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = '#000000';
        ctx.fillRect(Math.max(0, width - 64), Math.max(0, height - 64), 56, 56);
        ensureDir(LOGO_DIR);
        fs.writeFileSync(path.join(LOGO_DIR, `logo_${targetSize}.png`), canvas.toBuffer('image/png'));
    });
}

function seedInputFolder(folderName, fixtures) {
    const inputDir = path.join(TEST_ROOT, folderName);
    ensureDir(inputDir);
    fixtures.forEach((fixture, index) => {
        writePng(path.join(inputDir, fixture.fileName), fixture.width, fixture.height, index + 1);
    });
    return inputDir;
}

function finalPathFor(run, job, targetSize) {
    return path.join(run.outputFolder, run.runId, 'final-package', job.folderName, `${job.baseName}_${targetSize}.jpg`);
}

async function readPixel(filePath, x, y) {
    const image = await loadImage(fs.readFileSync(filePath));
    const canvas = createCanvas(image.width, image.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    return Array.from(ctx.getImageData(x, y, 1, 1).data);
}

async function assertLogoPixel(filePath, targetSize) {
    const { width, height } = TARGET_DIMENSIONS[targetSize];
    const [r, g, b] = await readPixel(filePath, width - 24, height - 24);
    assert.ok(
        r < 80 && g < 80 && b < 80,
        `final image should contain black LOGO mark at bottom-right: ${path.basename(filePath)} got rgb(${r},${g},${b})`
    );
}

async function assertFinalizedJobFiles(run, job) {
    assert.strictEqual(job.status, 'finalized', `${job.sourceImage.fileName} should be finalized`);
    for (const targetSize of TARGET_SIZES) {
        const filePath = finalPathFor(run, job, targetSize);
        assert.ok(fs.existsSync(filePath), `${job.sourceImage.fileName} ${targetSize} final file should exist`);
        assert.strictEqual(path.extname(filePath).toLowerCase(), '.jpg', `${targetSize} final file should be JPG`);
        assert.strictEqual(path.basename(filePath), `${job.baseName}_${targetSize}.jpg`, `${targetSize} final name should be correct`);
        const dimensions = readImageDimensions(filePath);
        assert.deepStrictEqual(
            { width: dimensions.width, height: dimensions.height },
            TARGET_DIMENSIONS[targetSize],
            `${job.sourceImage.fileName} ${targetSize} should have exact dimensions`
        );
        assert.strictEqual(job.targets[targetSize].logoApplied, true, `${targetSize} target should mark logoApplied`);
        await assertLogoPixel(filePath, targetSize);
    }
}

async function createDeliveryAppContext(options = {}) {
    let legilGenerateCalls = 0;
    let stopRequested = false;
    let sleepCalls = 0;
    let stopAlreadyTriggered = false;
    let observedFirstJobBeforeSecond = false;
    let firstRun = null;
    const legilCalls = [];
    const logs = [];

    const app = express();
    app.use(express.json({ limit: '2mb' }));
    const context = {
        rootDir: TEST_ROOT,
        logger: {
            system(message) { logs.push(['system', String(message || '')]); },
            info(message) { logs.push(['info', String(message || '')]); },
            warn(message) { logs.push(['warn', String(message || '')]); },
            error(message) { logs.push(['error', String(message || '')]); }
        },
        fs,
        path,
        appConfig: {
            resize: {
                browserMode: 'headless',
                generationSettings: {
                    aspectRatio: '1:1',
                    outputQuantity: 1
                }
            },
            notifications: {}
        },
        automationState: {},
        legilAutomation: {
            saveFolder: '',
            referenceFolder: '',
            referenceImages: [],
            currentRefIndex: 0,
            generationSettings: {},
            getConfig() {
                return {
                    settings: {
                        aspectRatio: '1:1',
                        outputQuantity: 1
                    }
                };
            },
            async generateImage(prompt, index, generateOptions) {
                legilGenerateCalls += 1;
                legilCalls.push({
                    referenceImageName: generateOptions.referenceImageName,
                    targetSize: generateOptions.promptTitleName
                });

                if (
                    firstRun &&
                    generateOptions.referenceImageName &&
                    generateOptions.referenceImageName.includes('ok_02_') &&
                    !observedFirstJobBeforeSecond
                ) {
                    observedFirstJobBeforeSecond = true;
                    const firstJob = firstRun.jobs[0];
                    TARGET_SIZES.forEach(targetSize => {
                        assert.ok(
                            fs.existsSync(finalPathFor(firstRun, firstJob, targetSize)),
                            `first job ${targetSize} final file should exist before second job starts`
                        );
                    });
                }

                const targetSize = generateOptions.promptTitleName;
                const { width, height } = TARGET_DIMENSIONS[targetSize];
                const filePath = path.join(generateOptions.saveFolder, `stage6_${index}_${targetSize}_${legilGenerateCalls}.png`);
                writePng(filePath, width, height, index + legilGenerateCalls + 20);
                return {
                    success: true,
                    savePaths: [filePath]
                };
            }
        },
        normalizeLegilGenerationSettings(settings) {
            return {
                aspectRatio: settings && settings.aspectRatio || '1:1',
                outputQuantity: Number(settings && settings.outputQuantity) || 1
            };
        },
        isLegilBusy() {
            return false;
        },
        async sleepWithLegilStop() {
            sleepCalls += 1;
            if (options.stopAfterFirstJob && !stopAlreadyTriggered && sleepCalls >= 2) {
                stopAlreadyTriggered = true;
                stopRequested = true;
                throw new Error('stop after first job');
            }
        },
        isLegilStopRequested() {
            return stopRequested;
        },
        notifyLegilResult() {}
    };

    registerDeliveryRoutes(app, context);
    const server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    return {
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () => new Promise(resolve => server.close(resolve)),
        setFirstRun(run) { firstRun = run; },
        getLegilGenerateCalls: () => legilGenerateCalls,
        getLegilCalls: () => [...legilCalls],
        getLogs: () => [...logs],
        observedFirstJobBeforeSecond: () => observedFirstJobBeforeSecond,
        resetLegilTrace() {
            legilGenerateCalls = 0;
            legilCalls.length = 0;
        },
        clearStop() {
            stopRequested = false;
            sleepCalls = 0;
        }
    };
}

async function postJson(url, body, expectSuccess = true) {
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
    });
    const data = await res.json();
    if (expectSuccess) {
        assert.strictEqual(data.success, true, data.message || `request failed: ${url}`);
    }
    return data;
}

async function waitForRunDone(appContext, runId) {
    const deadline = Date.now() + 20000;
    let latest = null;
    while (Date.now() < deadline) {
        const res = await fetch(`${appContext.baseUrl}/api/delivery/runs/${runId}`);
        const data = await res.json();
        assert.strictEqual(data.success, true, 'run status should be readable');
        latest = data;
        if (!data.task || !data.task.running) {
            return data.run;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`timed out waiting for run ${runId}; latest=${JSON.stringify(latest && latest.task)}`);
}

async function scanRun(appContext, inputFolder, namingStart = '37001') {
    const scan = await postJson(`${appContext.baseUrl}/api/delivery/scan`, {
        inputFolder,
        outputFolder: OUTPUT_DIR,
        logoTemplateFolder: LOGO_DIR,
        processMode: 'full-delivery',
        targetSizes: TARGET_SIZES,
        candidateCountPerSize: 1,
        namingRule: {
            fixedPrefix: 'GOFCNIM',
            startNumber: namingStart,
            regionText: 'QA',
            channelText: 'Stage6',
            primaryTag: 'Topic',
            secondaryTag: 'Delivery'
        }
    });
    return scan.run;
}

function assertSourceReusePlan(run, expectedByFileName) {
    run.jobs.forEach(job => {
        const expectedReuseSize = expectedByFileName[job.sourceImage.fileName] || '';
        TARGET_SIZES.forEach(size => {
            const target = job.targets[size];
            if (size === expectedReuseSize) {
                assert.strictEqual(target.generationMode, 'source-reuse', `${job.sourceImage.fileName} ${size} should reuse source`);
                assert.strictEqual(target.candidates[0].source, 'source-reuse', `${job.sourceImage.fileName} ${size} candidate source should be source-reuse`);
            } else {
                assert.strictEqual(target.generationMode, 'legil', `${job.sourceImage.fileName} ${size} should use Legil`);
            }
        });
    });
}

async function assertRatioPlanningMatrix() {
    const appContext = await createDeliveryAppContext();
    try {
        const singleCases = [
            { folder: 'single-square', fileName: 'ok_01_square.png', width: 800, height: 800, reuseSize: '800x800' },
            { folder: 'single-landscape', fileName: 'ok_01_landscape.png', width: 1280, height: 720, reuseSize: '1280x720' },
            { folder: 'single-portrait', fileName: 'ok_01_portrait.png', width: 1080, height: 1920, reuseSize: '1080x1920' },
            { folder: 'single-other', fileName: 'ok_01_other.png', width: 1000, height: 750, reuseSize: '' }
        ];
        for (const item of singleCases) {
            const inputFolder = seedInputFolder(item.folder, [item]);
            const run = await scanRun(appContext, inputFolder);
            assertSourceReusePlan(run, { [item.fileName]: item.reuseSize });
        }

        const mixedFixtures = [
            { fileName: 'ok_01_square.png', width: 800, height: 800 },
            { fileName: 'ok_02_landscape.png', width: 1280, height: 720 },
            { fileName: 'ok_03_portrait.png', width: 1080, height: 1920 },
            { fileName: 'ok_04_other.png', width: 1000, height: 750 }
        ];
        const mixedInput = seedInputFolder('mixed-ratio-plan', mixedFixtures);
        const mixedRun = await scanRun(appContext, mixedInput);
        assertSourceReusePlan(mixedRun, {
            'ok_01_square.png': '800x800',
            'ok_02_landscape.png': '1280x720',
            'ok_03_portrait.png': '1080x1920',
            'ok_04_other.png': ''
        });
        assert.strictEqual(mixedRun.scan.sourceReuseTargetCount, 3, 'mixed scan should reuse three targets');
        assert.strictEqual(mixedRun.scan.legilTargetCount, 9, 'mixed scan should leave nine Legil targets');
    } finally {
        await appContext.close();
    }
}

async function assertMixedFullDeliveryAcceptance() {
    const appContext = await createDeliveryAppContext();
    try {
        const inputFolder = seedInputFolder('mixed-full-delivery', [
            { fileName: 'ok_01_square.png', width: 800, height: 800 },
            { fileName: 'ok_02_landscape.png', width: 1280, height: 720 },
            { fileName: 'ok_03_portrait.png', width: 1080, height: 1920 },
            { fileName: 'ok_04_other.png', width: 1000, height: 750 }
        ]);
        const run = await scanRun(appContext, inputFolder, '38001');
        appContext.setFirstRun(run);
        await postJson(`${appContext.baseUrl}/api/delivery/start`, {
            runId: run.runId,
            processMode: 'full-delivery',
            logoTemplateFolder: LOGO_DIR,
            targetSizes: TARGET_SIZES,
            candidateCountPerSize: 1
        });
        const done = await waitForRunDone(appContext, run.runId);
        assert.strictEqual(done.status, 'finalized', 'mixed full delivery should finalize');
        assert.strictEqual(done.completedJobs, 4, 'all mixed jobs should be completed');
        assert.strictEqual(appContext.getLegilGenerateCalls(), 9, 'mixed full delivery should call Legil for nine targets');
        assert.strictEqual(appContext.observedFirstJobBeforeSecond(), true, 'first job should output before second job starts');

        const calls = appContext.getLegilCalls();
        const sourceReusePairs = new Set([
            'ok_01_square.png|800x800',
            'ok_02_landscape.png|1280x720',
            'ok_03_portrait.png|1080x1920'
        ]);
        calls.forEach(call => {
            assert.ok(
                !sourceReusePairs.has(`${call.referenceImageName}|${call.targetSize}`),
                `source-reuse target should not call Legil: ${call.referenceImageName} ${call.targetSize}`
            );
        });

        for (const job of done.jobs) {
            await assertFinalizedJobFiles(done, job);
        }
    } finally {
        await appContext.close();
    }
}

async function assertStopResumeSkipsFinishedJob() {
    const appContext = await createDeliveryAppContext({ stopAfterFirstJob: true });
    try {
        const inputFolder = seedInputFolder('stop-resume', [
            { fileName: 'ok_01_square.png', width: 800, height: 800 },
            { fileName: 'ok_02_square.png', width: 800, height: 800 }
        ]);
        const run = await scanRun(appContext, inputFolder, '39001');
        await postJson(`${appContext.baseUrl}/api/delivery/start`, {
            runId: run.runId,
            processMode: 'full-delivery',
            logoTemplateFolder: LOGO_DIR,
            targetSizes: TARGET_SIZES,
            candidateCountPerSize: 1
        });
        const stopped = await waitForRunDone(appContext, run.runId);
        assert.strictEqual(stopped.status, 'stopped', 'run should stop after first job');
        assert.strictEqual(stopped.jobs[0].status, 'finalized', 'first job should be finalized before stop');
        TARGET_SIZES.forEach(size => assert.ok(fs.existsSync(finalPathFor(stopped, stopped.jobs[0], size)), `stopped first job should keep ${size}`));
        assert.strictEqual(appContext.getLegilGenerateCalls(), 2, 'first job should generate two Legil targets before stop');

        appContext.resetLegilTrace();
        appContext.clearStop();
        await postJson(`${appContext.baseUrl}/api/delivery/start`, {
            runId: run.runId,
            processMode: 'full-delivery',
            logoTemplateFolder: LOGO_DIR,
            targetSizes: TARGET_SIZES,
            candidateCountPerSize: 1
        });
        const resumed = await waitForRunDone(appContext, run.runId);
        assert.strictEqual(resumed.status, 'finalized', 'resume should finish run');
        assert.strictEqual(appContext.getLegilGenerateCalls(), 2, 'resume should only generate second job Legil targets');
        appContext.getLegilCalls().forEach(call => {
            assert.ok(call.referenceImageName.includes('ok_02_square'), 'resume should skip already finalized first job');
            assert.notStrictEqual(call.targetSize, '800x800', 'resume should not send source-reuse target to Legil');
        });
    } finally {
        await appContext.close();
    }
}

async function assertMissingLogoStopsWithGlobalError() {
    fs.rmSync(LOGO_DIR, { recursive: true, force: true });
    ensureDir(LOGO_DIR);
    writeLogoTemplates(['800x800', '1280x720']);
    const appContext = await createDeliveryAppContext();
    try {
        const inputFolder = seedInputFolder('missing-logo', [
            { fileName: 'ok_01_square.png', width: 800, height: 800 }
        ]);
        const run = await scanRun(appContext, inputFolder, '40001');
        await postJson(`${appContext.baseUrl}/api/delivery/start`, {
            runId: run.runId,
            processMode: 'full-delivery',
            logoTemplateFolder: LOGO_DIR,
            targetSizes: TARGET_SIZES,
            candidateCountPerSize: 1
        });
        const failed = await waitForRunDone(appContext, run.runId);
        assert.strictEqual(failed.status, 'failed', 'missing LOGO template should fail the run');
        assert.ok(
            appContext.getLogs().some(([, message]) => message.includes('LOGO')),
            'missing LOGO template should be reported as a global error'
        );
    } finally {
        await appContext.close();
        fs.rmSync(LOGO_DIR, { recursive: true, force: true });
        ensureDir(LOGO_DIR);
        writeLogoTemplates();
    }
}

async function assertSourceReuseStandardization() {
    const appContext = await createDeliveryAppContext();
    try {
        const inputFolder = seedInputFolder('source-reuse-standardize', [
            { fileName: 'ok_01_square.png', width: 800, height: 800 }
        ]);
        const run = await scanRun(appContext, inputFolder, '41001');
        await postJson(`${appContext.baseUrl}/api/delivery/start`, {
            runId: run.runId,
            processMode: 'full-delivery',
            logoTemplateFolder: LOGO_DIR,
            targetSizes: TARGET_SIZES,
            candidateCountPerSize: 1
        });
        const done = await waitForRunDone(appContext, run.runId);
        const job = done.jobs[0];
        const target = job.targets['800x800'];
        assert.strictEqual(target.generationMode, 'source-reuse', '800x800 should be source-reuse');
        assert.strictEqual(target.candidates[0].source, 'source-reuse', 'source-reuse candidate should be recorded');
        assert.strictEqual(appContext.getLegilCalls().some(call => call.targetSize === '800x800'), false, 'source-reuse should not call Legil');
        const finalPath = finalPathFor(done, job, '800x800');
        assert.strictEqual(path.extname(finalPath).toLowerCase(), '.jpg', 'source-reuse final output should be JPG');
        const dimensions = readImageDimensions(finalPath);
        assert.deepStrictEqual({ width: dimensions.width, height: dimensions.height }, TARGET_DIMENSIONS['800x800'], 'source-reuse final dimensions should be exact');
        assert.ok(fs.statSync(finalPath).size <= 390 * 1024, 'source-reuse final output should be under 390KB');
        await assertLogoPixel(finalPath, '800x800');
    } finally {
        await appContext.close();
    }
}

async function main() {
    resetTestRoot();
    writeLogoTemplates();

    await assertRatioPlanningMatrix();
    await assertMixedFullDeliveryAcceptance();
    await assertStopResumeSkipsFinishedJob();
    await assertMissingLogoStopsWithGlobalError();
    await assertSourceReuseStandardization();

    console.log('S11 stage 6 acceptance test passed');
    if (process.env.KEEP_S11_STAGE6_ACCEPTANCE !== '1') {
        fs.rmSync(TEST_ROOT, { recursive: true, force: true });
    }
}

main().catch(error => {
    console.error('S11 stage 6 acceptance test failed');
    console.error(error);
    process.exitCode = 1;
});
