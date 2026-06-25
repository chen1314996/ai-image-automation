const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const express = require('express');
const { createCanvas } = require('canvas');

const registerDeliveryRoutes = require('../src/routes/delivery.routes');

const ROOT = path.join(__dirname, '..');
const TEST_ROOT = path.join(ROOT, 'runtime', 's11-stage3-closed-loop-delivery');
const INPUT_DIR = path.join(TEST_ROOT, 'ok-input');
const OUTPUT_DIR = path.join(TEST_ROOT, 'delivery-output');
const LOGO_DIR = path.join(TEST_ROOT, 'logo-templates');
const TARGET_SIZES = ['800x800', '1280x720', '1080x1920'];

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

function resetTestRoot() {
    const resolved = path.resolve(TEST_ROOT);
    const runtimeRoot = path.resolve(path.join(ROOT, 'runtime'));
    assert.ok(resolved.startsWith(runtimeRoot), 'Refusing to delete outside runtime directory');
    fs.rmSync(resolved, { recursive: true, force: true });
    ensureDir(INPUT_DIR);
    ensureDir(OUTPUT_DIR);
    ensureDir(LOGO_DIR);
}

function writePng(filePath, width, height, seed = 1) {
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    const hue = (seed * 53) % 360;
    ctx.fillStyle = `hsl(${hue}, 60%, 45%)`;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.80)';
    ctx.fillRect(Math.floor(width * 0.12), Math.floor(height * 0.16), Math.floor(width * 0.46), Math.floor(height * 0.34));
    ctx.fillStyle = 'rgba(0, 0, 0, 0.24)';
    ctx.fillRect(Math.floor(width * 0.58), Math.floor(height * 0.58), Math.floor(width * 0.24), Math.floor(height * 0.22));
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, canvas.toBuffer('image/png'));
}

function writeLogoTemplate(targetSize) {
    const [width, height] = targetSize.split('x').map(Number);
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.01)';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#e53935';
    ctx.fillRect(Math.max(0, width - 42), Math.max(0, height - 42), 34, 34);
    fs.writeFileSync(path.join(LOGO_DIR, `logo_${targetSize}.png`), canvas.toBuffer('image/png'));
}

function seedFixtures(prefix = '') {
    writePng(path.join(INPUT_DIR, `${prefix}ok_01_square.png`), 800, 800, 1);
    writePng(path.join(INPUT_DIR, `${prefix}ok_02_square.png`), 800, 800, 2);
    TARGET_SIZES.forEach(writeLogoTemplate);
}

function listJpgs(folderPath) {
    if (!fs.existsSync(folderPath)) {
        return [];
    }
    return fs.readdirSync(folderPath).filter(file => file.toLowerCase().endsWith('.jpg'));
}

async function createDeliveryAppContext(options = {}) {
    let legilGenerateCalls = 0;
    let stopRequested = false;
    let sleepCalls = 0;
    let activeRun = null;
    let firstJobFolderName = '';
    let checkedFirstJobBeforeSecondJob = false;
    let closedLoopViolation = '';
    const legilTargetSizes = [];

    const app = express();
    app.use(express.json({ limit: '2mb' }));
    const context = {
        rootDir: TEST_ROOT,
        logger: {
            system() {},
            info() {},
            warn() {},
            error() {}
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
                legilTargetSizes.push(generateOptions.promptTitleName);

                if (
                    activeRun &&
                    firstJobFolderName &&
                    generateOptions.referenceImageName &&
                    generateOptions.referenceImageName.includes('ok_02_square') &&
                    !checkedFirstJobBeforeSecondJob
                ) {
                    checkedFirstJobBeforeSecondJob = true;
                    const firstFinalFolder = path.join(OUTPUT_DIR, activeRun.runId, 'final-package', firstJobFolderName);
                    const jpgs = listJpgs(firstFinalFolder);
                    if (jpgs.length !== 3) {
                        closedLoopViolation = `first job final package should exist before job 2 starts, got ${jpgs.length} jpg(s)`;
                    }
                }

                const targetSize = generateOptions.promptTitleName;
                const [width, height] = targetSize.split('x').map(Number);
                const filePath = path.join(generateOptions.saveFolder, `fake_${index}_${targetSize}.png`);
                writePng(filePath, width, height, index + 10);
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
            if (options.stopAfterFirstJob && sleepCalls >= 2) {
                stopRequested = true;
                throw new Error('stop after first closed-loop job');
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
        setActiveRun(run) {
            activeRun = run;
            firstJobFolderName = run.jobs[0].folderName;
        },
        getLegilGenerateCalls: () => legilGenerateCalls,
        getLegilTargetSizes: () => [...legilTargetSizes],
        checkedFirstJobBeforeSecondJob: () => checkedFirstJobBeforeSecondJob,
        getClosedLoopViolation: () => closedLoopViolation
    };
}

async function scanAndStart(appContext) {
    const scanRes = await fetch(`${appContext.baseUrl}/api/delivery/scan`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            inputFolder: INPUT_DIR,
            outputFolder: OUTPUT_DIR,
            logoTemplateFolder: LOGO_DIR,
            processMode: 'full-delivery',
            targetSizes: TARGET_SIZES,
            candidateCountPerSize: 1,
            namingRule: {
                fixedPrefix: 'GOFCNIM',
                startNumber: '33001',
                regionText: 'QA',
                channelText: 'Stage3',
                primaryTag: 'Topic',
                secondaryTag: 'Delivery'
            }
        })
    });
    const scanData = await scanRes.json();
    assert.strictEqual(scanData.success, true, 'scan should succeed');
    assert.strictEqual(scanData.run.scan.sourceReuseTargetCount, 2, 'both square images should reuse 800x800');
    assert.strictEqual(scanData.run.scan.legilTargetCount, 4, 'two square images should leave four Legil targets');
    appContext.setActiveRun(scanData.run);

    const startRes = await fetch(`${appContext.baseUrl}/api/delivery/start`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            runId: scanData.run.runId,
            processMode: 'full-delivery',
            logoTemplateFolder: LOGO_DIR,
            targetSizes: TARGET_SIZES,
            candidateCountPerSize: 1
        })
    });
    const startData = await startRes.json();
    assert.strictEqual(startData.success, true, 'start should succeed');
    assert.strictEqual(startData.postprocess, true, 'full delivery should enable postprocess');
    assert.strictEqual(startData.totalTargets, 4, 'only Legil targets should be runnable');
    return scanData.run;
}

async function waitForRunDone(appContext, runId) {
    const deadline = Date.now() + 15000;
    let latest = null;
    while (Date.now() < deadline) {
        const res = await fetch(`${appContext.baseUrl}/api/delivery/runs/${runId}`);
        const data = await res.json();
        assert.strictEqual(data.success, true, 'run status should be readable');
        latest = data;
        if (!data.task || !data.task.running) {
            return data;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`timed out waiting for run ${runId}; latest=${JSON.stringify(latest && latest.task)}`);
}

async function assertClosedLoopCompletesBeforeNextJob() {
    resetTestRoot();
    seedFixtures();
    const appContext = await createDeliveryAppContext();
    try {
        const run = await scanAndStart(appContext);
        const done = await waitForRunDone(appContext, run.runId);
        assert.strictEqual(done.run.status, 'finalized', 'full closed-loop run should finalize');
        assert.strictEqual(done.run.completedJobs, 2, 'both jobs should be finalized');
        assert.strictEqual(appContext.getLegilGenerateCalls(), 4, 'only four Legil targets should be generated');
        assert.ok(!appContext.getLegilTargetSizes().includes('800x800'), 'source-reuse 800x800 should not call Legil');
        assert.strictEqual(appContext.checkedFirstJobBeforeSecondJob(), true, 'test should observe job 2 starting');
        assert.strictEqual(appContext.getClosedLoopViolation(), '', appContext.getClosedLoopViolation());

        const firstFinalFolder = path.join(OUTPUT_DIR, run.runId, 'final-package', run.jobs[0].folderName);
        const secondFinalFolder = path.join(OUTPUT_DIR, run.runId, 'final-package', run.jobs[1].folderName);
        assert.strictEqual(listJpgs(firstFinalFolder).length, 3, 'first job final folder should contain three jpgs');
        assert.strictEqual(listJpgs(secondFinalFolder).length, 3, 'second job final folder should contain three jpgs');
    } finally {
        await appContext.close();
    }
}

async function assertFinalizedJobSurvivesInterruption() {
    resetTestRoot();
    seedFixtures('stop_');
    const appContext = await createDeliveryAppContext({
        stopAfterFirstJob: true
    });
    try {
        const run = await scanAndStart(appContext);
        const done = await waitForRunDone(appContext, run.runId);
        assert.strictEqual(done.run.status, 'stopped', 'run should stop before job 2 starts');
        assert.strictEqual(done.run.jobs[0].status, 'finalized', 'first job should remain finalized after stop');
        assert.notStrictEqual(done.run.jobs[1].status, 'finalized', 'second job should not be finalized after stop');
        assert.strictEqual(appContext.getLegilGenerateCalls(), 2, 'stop case should only generate first job Legil targets');

        const firstFinalFolder = path.join(OUTPUT_DIR, run.runId, 'final-package', run.jobs[0].folderName);
        const secondFinalFolder = path.join(OUTPUT_DIR, run.runId, 'final-package', run.jobs[1].folderName);
        assert.strictEqual(listJpgs(firstFinalFolder).length, 3, 'first job final package should remain on disk');
        assert.strictEqual(listJpgs(secondFinalFolder).length, 0, 'second job final package should not exist yet');
    } finally {
        await appContext.close();
    }
}

async function main() {
    await assertClosedLoopCompletesBeforeNextJob();
    await assertFinalizedJobSurvivesInterruption();

    console.log('S11 stage 3 closed-loop delivery test passed');
    if (process.env.KEEP_S11_STAGE3_CLOSED_LOOP !== '1') {
        fs.rmSync(TEST_ROOT, { recursive: true, force: true });
    }
}

main().catch(error => {
    console.error('S11 stage 3 closed-loop delivery test failed');
    console.error(error);
    process.exitCode = 1;
});
