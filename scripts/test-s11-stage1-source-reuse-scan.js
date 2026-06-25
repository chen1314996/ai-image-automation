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

const ROOT = path.join(__dirname, '..');
const TEST_ROOT = path.join(ROOT, 'runtime', 's11-stage1-source-reuse-scan');
const INPUT_DIR = path.join(TEST_ROOT, 'ok-input');
const OUTPUT_DIR = path.join(TEST_ROOT, 'delivery-output');
const ROUTE_INPUT_DIR = path.join(TEST_ROOT, 'route-ok-input');
const ROUTE_OUTPUT_DIR = path.join(TEST_ROOT, 'route-delivery-output');

const TARGET_SIZES = ['800x800', '1280x720', '1080x1920'];
const FIXTURES = [
    {
        fileName: 'ok_01_square.png',
        width: 800,
        height: 800,
        sourceReuseSize: '800x800',
        legilSizes: ['1280x720', '1080x1920']
    },
    {
        fileName: 'ok_02_landscape.png',
        width: 1280,
        height: 720,
        sourceReuseSize: '1280x720',
        legilSizes: ['800x800', '1080x1920']
    },
    {
        fileName: 'ok_03_portrait.png',
        width: 1080,
        height: 1920,
        sourceReuseSize: '1080x1920',
        legilSizes: ['800x800', '1280x720']
    },
    {
        fileName: 'ok_04_other.png',
        width: 1000,
        height: 750,
        sourceReuseSize: '',
        legilSizes: ['800x800', '1280x720', '1080x1920']
    }
];

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
    ensureDir(ROUTE_INPUT_DIR);
    ensureDir(ROUTE_OUTPUT_DIR);
}

function writePng(filePath, width, height, seed = 1) {
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    const hue = (seed * 61) % 360;
    ctx.fillStyle = `hsl(${hue}, 68%, 44%)`;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.82)';
    ctx.fillRect(Math.floor(width * 0.12), Math.floor(height * 0.18), Math.floor(width * 0.48), Math.floor(height * 0.36));
    ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
    ctx.fillRect(Math.floor(width * 0.56), Math.floor(height * 0.58), Math.floor(width * 0.26), Math.floor(height * 0.22));
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, canvas.toBuffer('image/png'));
}

function seedFixtures() {
    FIXTURES.forEach((fixture, index) => {
        writePng(path.join(INPUT_DIR, fixture.fileName), fixture.width, fixture.height, index + 1);
    });
    writePng(path.join(ROUTE_INPUT_DIR, 'route_square.png'), 800, 800, 9);
}

function getJobByFileName(run, fileName) {
    return run.jobs.find(job => job.sourceImage && job.sourceImage.fileName === fileName);
}

function assertSourceReuseTarget(job, size, fixture) {
    const target = job.targets[size];
    assert.ok(target, `${fixture.fileName} should have target ${size}`);
    assert.strictEqual(target.generationMode, 'source-reuse', `${fixture.fileName} ${size} should be source-reuse`);
    assert.strictEqual(target.reuseSource, true, `${fixture.fileName} ${size} should set reuseSource`);
    assert.strictEqual(target.sourceRatioMatched, true, `${fixture.fileName} ${size} should mark source ratio matched`);
    assert.strictEqual(target.sourceDimensions, `${fixture.width}x${fixture.height}`, `${fixture.fileName} ${size} should record source dimensions`);
    assert.strictEqual(target.status, 'candidate_selected', `${fixture.fileName} ${size} should be selected`);
    assert.strictEqual(target.candidateCount, 1, `${fixture.fileName} ${size} should only need one source candidate`);
    assert.strictEqual(target.candidates.length, 1, `${fixture.fileName} ${size} should have one candidate`);
    assert.strictEqual(target.selectedCandidateId, `source_reuse_${size}`, `${fixture.fileName} ${size} should select the source candidate`);
    assert.strictEqual(target.candidates[0].candidateId, `source_reuse_${size}`, `${fixture.fileName} ${size} candidate id should be stable`);
    assert.strictEqual(target.candidates[0].source, 'source-reuse', `${fixture.fileName} ${size} candidate should record source-reuse`);
    assert.strictEqual(target.candidates[0].selected, true, `${fixture.fileName} ${size} candidate should be selected`);
    assert.strictEqual(target.candidates[0].filePath, job.sourceImage.filePath, `${fixture.fileName} ${size} candidate should point to source image`);
}

function assertLegilTarget(job, size, fixture) {
    const target = job.targets[size];
    assert.ok(target, `${fixture.fileName} should have target ${size}`);
    assert.strictEqual(target.generationMode, 'legil', `${fixture.fileName} ${size} should remain legil`);
    assert.strictEqual(target.reuseSource, false, `${fixture.fileName} ${size} should not reuse source`);
    assert.strictEqual(target.sourceRatioMatched, false, `${fixture.fileName} ${size} should not mark source ratio matched`);
    assert.strictEqual(target.sourceDimensions, `${fixture.width}x${fixture.height}`, `${fixture.fileName} ${size} should still record source dimensions`);
    assert.strictEqual(target.status, 'pending', `${fixture.fileName} ${size} should stay pending`);
    assert.strictEqual(target.candidateCount, 4, `${fixture.fileName} ${size} should keep Legil candidate count`);
    assert.deepStrictEqual(target.candidates, [], `${fixture.fileName} ${size} should not have source candidates`);
}

function assertScanResult(run, store) {
    assert.strictEqual(run.totalJobs, FIXTURES.length, 'scan should create one job per fixture');
    assert.deepStrictEqual(run.targetSizes, TARGET_SIZES, 'scan should keep all three target sizes');
    assert.strictEqual(run.scan.sourceImageCount, FIXTURES.length, 'scan should count source images');
    assert.strictEqual(run.scan.targetCount, FIXTURES.length * TARGET_SIZES.length, 'scan should count all targets');
    assert.strictEqual(run.scan.sourceReuseTargetCount, 3, 'scan should mark three source-reuse targets');
    assert.strictEqual(run.scan.legilTargetCount, 9, 'scan should leave nine Legil targets');
    assert.strictEqual(run.scan.estimatedSavedTargetCount, 3, 'scan should estimate three saved targets');

    FIXTURES.forEach(fixture => {
        const job = getJobByFileName(run, fixture.fileName);
        assert.ok(job, `job should exist for ${fixture.fileName}`);
        assert.strictEqual(job.sourceImage.width, fixture.width, `${fixture.fileName} should store source width`);
        assert.strictEqual(job.sourceImage.height, fixture.height, `${fixture.fileName} should store source height`);
        assert.strictEqual(job.sourceImage.dimensions, `${fixture.width}x${fixture.height}`, `${fixture.fileName} should store source dimensions`);

        if (fixture.sourceReuseSize) {
            assertSourceReuseTarget(job, fixture.sourceReuseSize, fixture);
        }
        fixture.legilSizes.forEach(size => assertLegilTarget(job, size, fixture));
    });

    store.applyTargetConfig(run, { candidateCountPerSize: 4 });
    FIXTURES.filter(fixture => fixture.sourceReuseSize).forEach(fixture => {
        const job = getJobByFileName(run, fixture.fileName);
        assertSourceReuseTarget(job, fixture.sourceReuseSize, fixture);
    });
}

async function createDeliveryAppContext() {
    let legilGenerateCalls = 0;
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
                    outputQuantity: 4
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
                        outputQuantity: 4
                    }
                };
            },
            async generateImage() {
                legilGenerateCalls += 1;
                return {
                    success: true,
                    savePaths: []
                };
            }
        },
        normalizeLegilGenerationSettings(settings) {
            return {
                aspectRatio: settings && settings.aspectRatio || '1:1',
                outputQuantity: Number(settings && settings.outputQuantity) || 4
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
        getLegilGenerateCalls: () => legilGenerateCalls
    };
}

async function assertSourceReuseDoesNotStartLegil() {
    const appContext = await createDeliveryAppContext();
    try {
        const scanRes = await fetch(`${appContext.baseUrl}/api/delivery/scan`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                inputFolder: ROUTE_INPUT_DIR,
                outputFolder: ROUTE_OUTPUT_DIR,
                processMode: 'legil-only',
                targetSizes: ['800x800'],
                candidateCountPerSize: 4,
                namingRule: {
                    fixedPrefix: 'GOFCNIM',
                    startNumber: '31001',
                    regionText: 'QA',
                    channelText: 'Route',
                    primaryTag: 'Topic',
                    secondaryTag: 'Delivery'
                }
            })
        });
        const scanData = await scanRes.json();
        assert.strictEqual(scanData.success, true, 'route scan should succeed');
        assert.strictEqual(scanData.run.scan.sourceReuseTargetCount, 1, 'route scan should create one source-reuse target');
        assert.strictEqual(scanData.run.scan.legilTargetCount, 0, 'route scan should create no Legil target');

        const startRes = await fetch(`${appContext.baseUrl}/api/delivery/start`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                runId: scanData.run.runId,
                processMode: 'legil-only',
                targetSizes: ['800x800'],
                candidateCountPerSize: 4
            })
        });
        const startData = await startRes.json();
        assert.strictEqual(startData.success, true, 'route start should succeed');
        assert.strictEqual(startData.totalTargets, 0, 'source-reuse only run should have zero runnable Legil targets');
        await new Promise(resolve => setTimeout(resolve, 50));
        assert.strictEqual(appContext.getLegilGenerateCalls(), 0, 'source-reuse target should not call Legil generateImage');
    } finally {
        await appContext.close();
    }
}

async function main() {
    resetTestRoot();
    seedFixtures();

    const store = createDeliveryPostprocessStore({ rootDir: TEST_ROOT });
    const run = store.scanInputFolder({
        inputFolder: INPUT_DIR,
        outputFolder: OUTPUT_DIR,
        candidateCountPerSize: 4,
        namingRule: {
            fixedPrefix: 'GOFCNIM',
            startNumber: '31001',
            regionText: 'QA',
            channelText: 'Stage1',
            primaryTag: 'Topic',
            secondaryTag: 'Delivery'
        }
    });

    assertScanResult(run, store);
    await assertSourceReuseDoesNotStartLegil();

    console.log('S11 stage 1 source-reuse scan test passed');
    console.log(JSON.stringify({
        runId: run.runId,
        totalJobs: run.totalJobs,
        scan: run.scan
    }, null, 2));

    if (process.env.KEEP_S11_STAGE1_SOURCE_REUSE !== '1') {
        fs.rmSync(TEST_ROOT, { recursive: true, force: true });
    }
}

main().catch(error => {
    console.error('S11 stage 1 source-reuse scan test failed');
    console.error(error);
    process.exitCode = 1;
});
