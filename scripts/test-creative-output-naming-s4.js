const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const registerLegilRoutes = require('../src/routes/legil.routes');
const { createRouteContext } = require('../src/server/context');
const legilAutomation = require('../src/services/legil');

function waitFor(predicate, timeoutMs = 2000) {
    const startedAt = Date.now();
    return new Promise((resolve, reject) => {
        const tick = () => {
            if (predicate()) {
                resolve();
                return;
            }
            if (Date.now() - startedAt > timeoutMs) {
                reject(new Error('Timed out waiting for condition'));
                return;
            }
            setTimeout(tick, 25);
        };
        tick();
    });
}

function createFakeApp() {
    const handlers = new Map();
    return {
        handlers,
        post(route, handler) {
            handlers.set(`POST ${route}`, handler);
        },
        get(route, handler) {
            handlers.set(`GET ${route}`, handler);
        }
    };
}

function createResponse() {
    let payload = null;
    return {
        json(value) {
            payload = value;
            return value;
        },
        get payload() {
            return payload;
        }
    };
}

function createBatchRouteHarness() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'creative-output-naming-s4-'));
    const outputFolder = path.join(root, 'output');
    const dataDir = path.join(root, 'data', 'creative-knowledge');
    fs.mkdirSync(outputFolder, { recursive: true });
    fs.mkdirSync(dataDir, { recursive: true });

    const calls = [];
    const automationState = {
        legilTaskRunning: false,
        legilStopRequested: false,
        legilTaskType: null,
        legilTaskProgress: null
    };
    const context = createRouteContext();
    const fakeLegilAutomation = {
        getConfig() {
            return {
                settings: {
                    outputQuantity: 1
                }
            };
        },
        async generateImage(prompt, promptIndex, options) {
            calls.push({ prompt, promptIndex, options });
            return {
                success: true,
                savedCount: 1,
                savePath: path.join(outputFolder, `${options.outputNameBase || 'legacy'}_v01.png`)
            };
        }
    };

    Object.assign(context, {
        dataDir,
        automationState,
        legilAutomation: fakeLegilAutomation,
        isLegilBusy: () => automationState.legilTaskRunning,
        notifyTaskEvent: () => {},
        appConfig: {
            ...context.appConfig,
            legilReferenceFolder: '',
            notifications: {
                autoRecoveryEnabled: false,
                legilScreenshotEnabled: false,
                pauseOnConsecutiveFailures: false,
                consecutiveFailureThreshold: 3
            }
        }
    });

    const app = createFakeApp();
    registerLegilRoutes(app, context);
    const handler = app.handlers.get('POST /api/legil/batch-generate');
    assert.ok(handler, 'batch-generate route should be registered');

    return {
        root,
        calls,
        automationState,
        async run(body) {
            const res = createResponse();
            await handler({ body }, res);
            assert.strictEqual(res.payload.success, true);
            await waitFor(() => calls.length === body.prompts.length && automationState.legilTaskRunning === false);
            return res.payload;
        },
        cleanup() {
            fs.rmSync(root, { recursive: true, force: true });
        }
    };
}

async function checkBatchOriginalNameMatchesTwoLevelDirection() {
    const harness = createBatchRouteHarness();
    try {
        await harness.run({
            directionLibrary: [
                { id: 'dir-explore', path: '题材 / 探索发现' }
            ],
            prompts: [{
                content: '生成一张夜间求生信号主题图片',
                title: '夜间求生信号',
                sourceRawName: '题材_探索发现_废弃观测站.png'
            }]
        });

        assert.strictEqual(harness.calls[0].prompt, '生成一张夜间求生信号主题图片');
        assert.strictEqual(harness.calls[0].options.outputNameBase, '题材_探索发现_夜间求生信号');
    } finally {
        harness.cleanup();
    }
}

async function checkBatchOriginalNameMatchesThreeLevelDirection() {
    const harness = createBatchRouteHarness();
    try {
        await harness.run({
            directionLibrary: [
                { id: 'dir-explore', path: '题材 / 探索发现' },
                { id: 'dir-observatory', path: '题材 / 探索发现 / 废弃观测站' }
            ],
            prompts: [{
                content: '生成一张夜间求生信号主题图片',
                title: '夜间求生信号',
                sourceRawName: '题材_探索发现_废弃观测站.png'
            }]
        });

        assert.strictEqual(harness.calls[0].options.outputNameBase, '题材_探索发现_废弃观测站_夜间求生信号');
    } finally {
        harness.cleanup();
    }
}

async function checkBatchAssetHintAndLegacyFallback() {
    const assetHarness = createBatchRouteHarness();
    try {
        await assetHarness.run({
            directionLibrary: [
                { id: 'dir-explore', path: '题材 / 探索发现' },
                { id: 'dir-shelter', path: '题材 / 探索发现 / 避难所' }
            ],
            assets: [{
                assetId: 'asset-1',
                fileName: 'old-reference.png',
                directionPath: '题材 / 探索发现 / 避难所'
            }],
            prompts: [{
                content: '生成一张雪原救援主题图片',
                title: '雪原信号塔救援',
                sourceRawName: 'old-reference.png'
            }]
        });

        assert.strictEqual(assetHarness.calls[0].options.outputNameBase, '题材_探索发现_避难所_雪原信号塔救援');
    } finally {
        assetHarness.cleanup();
    }

    const legacyHarness = createBatchRouteHarness();
    try {
        await legacyHarness.run({
            directionLibrary: [
                { id: 'dir-explore', path: '题材 / 探索发现' }
            ],
            prompts: [{
                content: '生成一张普通批量图片',
                title: '无法识别的新标题',
                sourceRawName: '普通原图.png'
            }]
        });

        assert.strictEqual(legacyHarness.calls[0].options.outputNameBase, undefined);
    } finally {
        legacyHarness.cleanup();
    }
}

function checkBuildOutputFileNameForBatchOutputBase() {
    const fileName = legilAutomation.buildOutputFileName(1, {
        outputSequence: 1,
        outputTotal: 1,
        runId: 'batch_20260602_153012',
        promptIndexWithinImage: 1,
        outputNameBase: '题材_探索发现_废弃观测站_夜间求生信号',
        variantIndex: 1
    });

    assert.match(
        fileName,
        /^batch_20260602_153012_0001_题材_探索发现_废弃观测站_夜间求生信号_v01_\d{8}_\d{6}\.png$/
    );
}

async function main() {
    await checkBatchOriginalNameMatchesTwoLevelDirection();
    await checkBatchOriginalNameMatchesThreeLevelDirection();
    await checkBatchAssetHintAndLegacyFallback();
    checkBuildOutputFileNameForBatchOutputBase();
    console.log('[creative-output-naming S4] Ordinary batch naming integration checks passed.');
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
