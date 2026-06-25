const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const express = require('express');
const { createCanvas } = require('canvas');

const registerDeliveryRoutes = require('../src/routes/delivery.routes');

const ROOT = path.join(__dirname, '..');
const TEST_ROOT = path.join(ROOT, 'runtime', 's11-stage5-resume-retry');
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
    const hue = (seed * 59) % 360;
    ctx.fillStyle = `hsl(${hue}, 62%, 45%)`;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.82)';
    ctx.fillRect(Math.floor(width * 0.12), Math.floor(height * 0.16), Math.floor(width * 0.45), Math.floor(height * 0.35));
    ctx.fillStyle = 'rgba(0, 0, 0, 0.24)';
    ctx.fillRect(Math.floor(width * 0.58), Math.floor(height * 0.58), Math.floor(width * 0.25), Math.floor(height * 0.22));
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
    ctx.fillStyle = '#3949ab';
    ctx.fillRect(Math.max(0, width - 42), Math.max(0, height - 42), 34, 34);
    fs.writeFileSync(path.join(LOGO_DIR, `logo_${targetSize}.png`), canvas.toBuffer('image/png'));
}

function seedFixtures() {
    writePng(path.join(INPUT_DIR, 'ok_01_square.png'), 800, 800, 1);
    writePng(path.join(INPUT_DIR, 'ok_02_square.png'), 800, 800, 2);
    TARGET_SIZES.forEach(writeLogoTemplate);
}

function finalPathFor(run, job, targetSize) {
    return path.join(run.outputFolder, run.runId, 'final-package', job.folderName, `${job.baseName}_${targetSize}.jpg`);
}

async function createDeliveryAppContext() {
    let legilGenerateCalls = 0;
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
            async generateImage(prompt, index, options) {
                legilGenerateCalls += 1;
                legilTargetSizes.push(options.promptTitleName);
                const targetSize = options.promptTitleName;
                const [width, height] = targetSize.split('x').map(Number);
                const filePath = path.join(options.saveFolder, `stage5_${index}_${targetSize}_${legilGenerateCalls}.png`);
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
        close: () => new Promise(resolve => server.close(resolve)),
        getLegilGenerateCalls: () => legilGenerateCalls,
        getLegilTargetSizes: () => [...legilTargetSizes],
        resetLegilTrace() {
            legilGenerateCalls = 0;
            legilTargetSizes.length = 0;
        }
    };
}

async function postJson(url, body) {
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
    });
    const data = await res.json();
    assert.strictEqual(data.success, true, data.message || `request failed: ${url}`);
    return data;
}

async function waitForRunDone(appContext, runId) {
    const deadline = Date.now() + 45000;
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

async function scanAndComplete(appContext) {
    const scan = await postJson(`${appContext.baseUrl}/api/delivery/scan`, {
        inputFolder: INPUT_DIR,
        outputFolder: OUTPUT_DIR,
        logoTemplateFolder: LOGO_DIR,
        processMode: 'full-delivery',
        targetSizes: TARGET_SIZES,
        candidateCountPerSize: 1,
        namingRule: {
            fixedPrefix: 'GOFCNIM',
            startNumber: '36001',
            regionText: 'QA',
            channelText: 'Stage5',
            primaryTag: 'Topic',
            secondaryTag: 'Delivery'
        }
    });
    assert.strictEqual(scan.run.scan.sourceReuseTargetCount, 2, 'both square images should reuse source for 800x800');
    await postJson(`${appContext.baseUrl}/api/delivery/start`, {
        runId: scan.run.runId,
        processMode: 'full-delivery',
        logoTemplateFolder: LOGO_DIR,
        targetSizes: TARGET_SIZES,
        candidateCountPerSize: 1
    });
    const completed = await waitForRunDone(appContext, scan.run.runId);
    assert.strictEqual(completed.status, 'finalized', 'initial run should finalize');
    assert.strictEqual(appContext.getLegilGenerateCalls(), 4, 'initial run should generate only four Legil targets');
    assert.ok(!appContext.getLegilTargetSizes().includes('800x800'), 'source-reuse should not call Legil during initial run');
    return completed;
}

async function main() {
    resetTestRoot();
    seedFixtures();
    const appContext = await createDeliveryAppContext();
    try {
        const run = await scanAndComplete(appContext);
        const [job1, job2] = run.jobs;

        appContext.resetLegilTrace();
        const finalizedResumeStartedAt = Date.now();
        await postJson(`${appContext.baseUrl}/api/delivery/start`, {
            runId: run.runId,
            processMode: 'full-delivery',
            logoTemplateFolder: LOGO_DIR,
            targetSizes: TARGET_SIZES,
            candidateCountPerSize: 1
        });
        const resumed = await waitForRunDone(appContext, run.runId);
        const finalizedResumeElapsedMs = Date.now() - finalizedResumeStartedAt;
        assert.strictEqual(resumed.status, 'finalized', 'resume should keep run finalized');
        assert.strictEqual(appContext.getLegilGenerateCalls(), 0, 'resume should skip already finalized jobs with valid files');
        assert.ok(finalizedResumeElapsedMs < 3000, `resume should skip finalized jobs without job-gap delay; elapsed=${finalizedResumeElapsedMs}ms`);

        const sourceReuseFinalPath = finalPathFor(resumed, resumed.jobs[0], '800x800');
        assert.ok(fs.existsSync(sourceReuseFinalPath), 'source-reuse final file should exist before deletion');
        fs.unlinkSync(sourceReuseFinalPath);

        appContext.resetLegilTrace();
        await postJson(`${appContext.baseUrl}/api/delivery/runs/${run.runId}/retry-target`, {
            jobId: job1.jobId
        });
        const repairedSourceReuse = await waitForRunDone(appContext, run.runId);
        assert.ok(fs.existsSync(sourceReuseFinalPath), 'deleted source-reuse final file should be recreated');
        assert.strictEqual(appContext.getLegilGenerateCalls(), 0, 'source-reuse final repair should not call Legil');
        assert.strictEqual(repairedSourceReuse.jobs[0].status, 'finalized', 'repaired job should be finalized');
        assert.strictEqual(repairedSourceReuse.jobs[1].status, 'finalized', 'other finalized job should remain finalized');

        const failedRun = repairedSourceReuse;
        const failedJob = failedRun.jobs[1];
        const failedTarget = failedJob.targets['1280x720'];
        failedTarget.status = 'failed';
        failedTarget.error = 'stage5 simulated failed target';
        failedTarget.candidates = [];
        failedTarget.standardizedCandidates = [];
        failedTarget.standardizedPath = '';
        failedTarget.finalizedCandidates = [];
        failedTarget.finalPath = '';
        failedTarget.finalized = null;
        failedJob.status = 'failed';
        failedJob.postprocess.finalized = false;
        failedRun.status = 'failed';
        const statusBeforeFailedRetryRes = await fetch(`${appContext.baseUrl}/api/delivery/runs/${run.runId}`);
        const statusBeforeFailedRetry = await statusBeforeFailedRetryRes.json();
        const persistedRun = statusBeforeFailedRetry.run;
        const persistedJob = persistedRun.jobs.find(job => job.jobId === failedJob.jobId);
        persistedJob.targets['1280x720'].status = 'failed';
        persistedJob.targets['1280x720'].error = 'stage5 simulated failed target';
        persistedJob.targets['1280x720'].candidates = [];
        persistedJob.targets['1280x720'].standardizedCandidates = [];
        persistedJob.targets['1280x720'].standardizedPath = '';
        persistedJob.targets['1280x720'].finalizedCandidates = [];
        persistedJob.targets['1280x720'].finalPath = '';
        persistedJob.targets['1280x720'].finalized = null;
        persistedJob.status = 'failed';
        persistedJob.postprocess.finalized = false;
        persistedRun.status = 'failed';
        fs.writeFileSync(
            path.join(TEST_ROOT, 'data', 'delivery-postprocess', 'runs', `${run.runId}.json`),
            JSON.stringify(persistedRun, null, 2)
        );

        appContext.resetLegilTrace();
        await postJson(`${appContext.baseUrl}/api/delivery/runs/${run.runId}/retry-target`, {
            jobId: job2.jobId
        });
        const repairedFailed = await waitForRunDone(appContext, run.runId);
        assert.strictEqual(appContext.getLegilGenerateCalls(), 1, 'failed Legil target should be generated once');
        assert.deepStrictEqual(appContext.getLegilTargetSizes(), ['1280x720'], 'only the failed Legil target should be regenerated');
        assert.strictEqual(repairedFailed.jobs[1].status, 'finalized', 'failed job should return to finalized');
        assert.strictEqual(repairedFailed.jobs[1].targets['800x800'].generationMode, 'source-reuse', 'source-reuse target should remain source-reuse');
        assert.ok(!appContext.getLegilTargetSizes().includes('800x800'), 'source-reuse target should not enter Legil during failed retry');

        const failedOnlyRun = repairedFailed;
        const failedOnlyTargets = [
            { jobIndex: 0, targetSize: '1280x720' },
            { jobIndex: 1, targetSize: '1080x1920' }
        ];
        failedOnlyTargets.forEach(({ jobIndex, targetSize }) => {
            const targetJob = failedOnlyRun.jobs[jobIndex];
            const target = targetJob.targets[targetSize];
            target.status = 'failed';
            target.error = `stage5 simulated failed-only target ${targetSize}`;
            target.candidates = [];
            target.standardizedCandidates = [];
            target.standardizedPath = '';
            target.finalizedCandidates = [];
            target.finalPath = '';
            target.finalized = null;
            targetJob.status = 'failed';
            targetJob.postprocess.finalized = false;
        });
        failedOnlyRun.status = 'failed';
        fs.writeFileSync(
            path.join(TEST_ROOT, 'data', 'delivery-postprocess', 'runs', `${run.runId}.json`),
            JSON.stringify(failedOnlyRun, null, 2)
        );

        appContext.resetLegilTrace();
        const retryFailedResponse = await postJson(`${appContext.baseUrl}/api/delivery/runs/${run.runId}/retry-failed`, {
            processMode: 'full-delivery',
            logoTemplateFolder: LOGO_DIR,
            targetSizes: TARGET_SIZES,
            candidateCountPerSize: 1
        });
        assert.strictEqual(retryFailedResponse.totalTargets, 2, 'retry-failed should enqueue only failed targets');
        const repairedAllFailed = await waitForRunDone(appContext, run.runId);
        assert.strictEqual(appContext.getLegilGenerateCalls(), 2, 'retry-failed should regenerate both failed Legil targets only');
        assert.deepStrictEqual(
            appContext.getLegilTargetSizes().sort(),
            ['1080x1920', '1280x720'],
            'retry-failed should not regenerate finalized or source-reuse targets'
        );
        assert.strictEqual(repairedAllFailed.status, 'finalized', 'retry-failed should restore the run to finalized');
        assert.strictEqual(repairedAllFailed.jobs[0].targets['800x800'].generationMode, 'source-reuse', 'source-reuse target should remain source-reuse after retry-failed');
        assert.ok(!appContext.getLegilTargetSizes().includes('800x800'), 'retry-failed should never call Legil for source-reuse targets');
    } finally {
        await appContext.close();
    }

    console.log('S11 stage 5 resume/retry test passed');
    if (process.env.KEEP_S11_STAGE5_RESUME_RETRY !== '1') {
        fs.rmSync(TEST_ROOT, { recursive: true, force: true });
    }
}

main().catch(error => {
    console.error('S11 stage 5 resume/retry test failed');
    console.error(error);
    process.exitCode = 1;
});
