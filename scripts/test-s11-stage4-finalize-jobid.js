const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const express = require('express');
const { createCanvas } = require('canvas');

const registerDeliveryRoutes = require('../src/routes/delivery.routes');
const {
    createDeliveryPostprocessStore
} = require('../src/services/delivery-postprocess/store');
const {
    finalizeDeliveryRun
} = require('../src/services/delivery-postprocess/finalize');

const ROOT = path.join(__dirname, '..');
const TEST_ROOT = path.join(ROOT, 'runtime', 's11-stage4-finalize-jobid');
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
    const hue = (seed * 47) % 360;
    ctx.fillStyle = `hsl(${hue}, 64%, 44%)`;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.82)';
    ctx.fillRect(Math.floor(width * 0.10), Math.floor(height * 0.16), Math.floor(width * 0.48), Math.floor(height * 0.36));
    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.fillRect(Math.floor(width * 0.60), Math.floor(height * 0.58), Math.floor(width * 0.24), Math.floor(height * 0.22));
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
    ctx.fillStyle = '#d81b60';
    ctx.fillRect(Math.max(0, width - 44), Math.max(0, height - 44), 36, 36);
    fs.writeFileSync(path.join(LOGO_DIR, `logo_${targetSize}.png`), canvas.toBuffer('image/png'));
}

function seedInputs() {
    writePng(path.join(INPUT_DIR, 'ok_01_other.png'), 1000, 750, 1);
    writePng(path.join(INPUT_DIR, 'ok_02_other.png'), 1000, 750, 2);
    TARGET_SIZES.forEach(writeLogoTemplate);
}

function listJpgs(folderPath) {
    if (!fs.existsSync(folderPath)) {
        return [];
    }
    return fs.readdirSync(folderPath).filter(file => file.toLowerCase().endsWith('.jpg'));
}

function finalFolderFor(run, job) {
    return path.join(run.outputFolder, run.runId, 'final-package', job.folderName);
}

function finalPathsForJob(run, job) {
    return TARGET_SIZES.map(size => path.join(finalFolderFor(run, job), `${job.baseName}_${size}.jpg`));
}

function createScannedRun() {
    const store = createDeliveryPostprocessStore({ rootDir: TEST_ROOT });
    const run = store.scanInputFolder({
        inputFolder: INPUT_DIR,
        outputFolder: OUTPUT_DIR,
        logoTemplateFolder: LOGO_DIR,
        processMode: 'full-delivery',
        targetSizes: TARGET_SIZES,
        candidateCountPerSize: 1,
        namingRule: {
            fixedPrefix: 'GOFCNIM',
            startNumber: '34001',
            regionText: 'QA',
            channelText: 'Stage4',
            primaryTag: 'Topic',
            secondaryTag: 'Delivery'
        }
    });
    assert.strictEqual(run.totalJobs, 2, 'fixture should create two jobs');
    return { store, run };
}

function attachStandardizedTargets(run, job, seedOffset = 0) {
    TARGET_SIZES.forEach((targetSize, index) => {
        const [width, height] = targetSize.split('x').map(Number);
        const outputPath = path.join(
            run.outputFolder,
            run.runId,
            'stage-standardized-fixture',
            job.folderName,
            `${job.baseName}_${targetSize}.png`
        );
        writePng(outputPath, width, height, seedOffset + index + 1);
        const target = job.targets[targetSize];
        target.standardizedCandidates = [{
            candidateId: `std_${job.jobId}_${targetSize}`,
            candidateIndex: 1,
            candidateCount: 1,
            outputPath,
            dimensions: targetSize
        }];
        target.standardizedPath = outputPath;
        target.status = 'standardized';
        target.error = '';
        target.postprocessProbe = `job-${job.groupIndex}`;
    });
    job.status = 'candidates_ready';
    job.postprocess = {
        ...(job.postprocess || {}),
        standardized: true,
        finalized: false,
        probe: `job-${job.groupIndex}`
    };
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function assertServiceJobIdFinalize() {
    resetTestRoot();
    seedInputs();
    const { run } = createScannedRun();
    const [job1, job2] = run.jobs;
    attachStandardizedTargets(run, job1, 10);
    attachStandardizedTargets(run, job2, 20);
    const job2Snapshot = JSON.stringify({
        baseName: job2.baseName,
        folderName: job2.folderName,
        status: job2.status,
        postprocess: job2.postprocess,
        targets: job2.targets
    });

    const firstResult = await finalizeDeliveryRun(run, {
        logoTemplateFolder: LOGO_DIR,
        jobId: job1.jobId,
        namingRule: {
            fixedPrefix: 'GOFCNIM',
            startNumber: '35001',
            regionText: 'QA',
            channelText: 'Stage4Rename',
            primaryTag: 'Topic',
            secondaryTag: 'Delivery'
        }
    });
    assert.strictEqual(firstResult.finalizedCount, 3, 'jobId finalize should output current job three sizes');
    assert.strictEqual(firstResult.failedCount, 0, 'jobId finalize should not fail');
    assert.strictEqual(firstResult.run.completedJobs, 1, 'completedJobs should count only finalized jobs');
    assert.strictEqual(firstResult.run.failedJobs, 0, 'failedJobs should count all jobs');
    assert.strictEqual(job1.status, 'finalized', 'current job should be finalized');
    assert.strictEqual(job1.postprocess.finalized, true, 'current job postprocess should be finalized');
    assert.strictEqual(JSON.stringify({
        baseName: job2.baseName,
        folderName: job2.folderName,
        status: job2.status,
        postprocess: job2.postprocess,
        targets: job2.targets
    }), job2Snapshot, 'other job state and postprocess should not be mutated');
    assert.strictEqual(listJpgs(finalFolderFor(run, job1)).length, 3, 'current job final folder should contain three jpgs');
    assert.strictEqual(listJpgs(finalFolderFor(run, job2)).length, 0, 'other job final folder should not be created');

    const firstStats = finalPathsForJob(run, job1).map(filePath => fs.statSync(filePath).mtimeMs);
    await sleep(80);
    const secondResult = await finalizeDeliveryRun(run, {
        logoTemplateFolder: LOGO_DIR,
        jobId: job1.jobId
    });
    const secondStats = finalPathsForJob(run, job1).map(filePath => fs.statSync(filePath).mtimeMs);
    assert.strictEqual(secondResult.reusedExistingCount, 3, 'existing final outputs should be reused by default');
    assert.deepStrictEqual(secondStats, firstStats, 'non-force finalize should not overwrite existing files');

    await sleep(80);
    const forcedResult = await finalizeDeliveryRun(run, {
        logoTemplateFolder: LOGO_DIR,
        jobId: job1.jobId,
        force: true
    });
    const forcedStats = finalPathsForJob(run, job1).map(filePath => fs.statSync(filePath).mtimeMs);
    assert.strictEqual(forcedResult.reusedExistingCount, 0, 'force finalize should not report reused outputs');
    assert.ok(
        forcedStats.some((mtime, index) => mtime > secondStats[index]),
        'force finalize should overwrite at least one existing output file'
    );
    assert.strictEqual(listJpgs(finalFolderFor(run, job2)).length, 0, 'force jobId finalize should still not create other job folder');
}

async function createDeliveryAppContext() {
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
            async generateImage() {
                throw new Error('route finalize test should not call Legil');
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
        async sleepWithLegilStop() {},
        isLegilStopRequested() {
            return false;
        },
        notifyLegilResult() {}
    };

    registerDeliveryRoutes(app, context);
    const server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    return {
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () => new Promise(resolve => server.close(resolve))
    };
}

async function assertRoutePassesJobId() {
    resetTestRoot();
    seedInputs();
    const { store, run } = createScannedRun();
    const [job1, job2] = run.jobs;
    attachStandardizedTargets(run, job1, 30);
    store.saveRun(run);

    const appContext = await createDeliveryAppContext();
    try {
        const res = await fetch(`${appContext.baseUrl}/api/delivery/runs/${run.runId}/finalize`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                jobId: job1.jobId,
                logoTemplateFolder: LOGO_DIR
            })
        });
        const data = await res.json();
        assert.strictEqual(data.success, true, 'route jobId finalize should succeed even when other job is not standardized');
        assert.strictEqual(data.finalizedCount, 3, 'route jobId finalize should output only current job');
        assert.strictEqual(data.run.completedJobs, 1, 'route should return completedJobs across all jobs');
        assert.strictEqual(data.run.failedJobs, 0, 'route should return failedJobs across all jobs');
        assert.strictEqual(listJpgs(finalFolderFor(run, job1)).length, 3, 'route should output current job final folder');
        assert.strictEqual(listJpgs(finalFolderFor(run, job2)).length, 0, 'route should not output other job final folder');

        const saved = store.readRun(run.runId);
        assert.strictEqual(saved.jobs[0].status, 'finalized', 'saved current job should be finalized');
        assert.notStrictEqual(saved.jobs[1].status, 'finalized', 'saved other job should not be finalized');
        assert.notStrictEqual(saved.jobs[1].postprocess.finalized, true, 'saved other job postprocess should not be finalized');
    } finally {
        await appContext.close();
    }
}

async function main() {
    await assertServiceJobIdFinalize();
    await assertRoutePassesJobId();

    console.log('S11 stage 4 finalize jobId test passed');
    if (process.env.KEEP_S11_STAGE4_FINALIZE_JOBID !== '1') {
        fs.rmSync(TEST_ROOT, { recursive: true, force: true });
    }
}

main().catch(error => {
    console.error('S11 stage 4 finalize jobId test failed');
    console.error(error);
    process.exitCode = 1;
});
