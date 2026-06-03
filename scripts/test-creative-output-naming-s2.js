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

async function checkCreativeBatchRouteNaming() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'creative-output-naming-s2-'));
    const outputFolder = path.join(root, 'output');
    const dataDir = path.join(root, 'data', 'creative-knowledge');
    fs.mkdirSync(outputFolder, { recursive: true });
    fs.mkdirSync(dataDir, { recursive: true });

    const calls = [];
    const context = createRouteContext();
    const fakeLegilAutomation = {
        saveFolder: '',
        referenceFolder: '',
        referenceImages: [],
        currentRefIndex: 0,
        generationSettings: {
            imageModel: 'nano-banana-2',
            aspectRatio: '1:1',
            resolution: '2K',
            outputQuantity: 1
        },
        getConfig() {
            return { settings: { ...this.generationSettings } };
        },
        getImageModelLabel() {
            return 'Nano Banana 2';
        },
        async generateImage(prompt, promptIndex, options) {
            calls.push({ prompt, promptIndex, options });
            return {
                success: true,
                savedCount: 1,
                savePath: path.join(outputFolder, `${options.outputNameBase}_v01.png`),
                savePaths: [path.join(outputFolder, `${options.outputNameBase}_v01.png`)]
            };
        }
    };

    Object.assign(context, {
        dataDir,
        legilAutomation: fakeLegilAutomation,
        isLegilBusy: () => false,
        isLegilStopRequested: () => false,
        persistRuntimeConfig: () => {},
        setCreativeResumeState: () => null,
        updateCreativeResumeState: () => null,
        clearCreativeResumeState: () => null,
        sleepWithLegilStop: async () => {},
        notifyLegilResult: () => {},
        notifyTaskEvent: () => {},
        appConfig: {
            ...context.appConfig,
            notifications: {
                autoRecoveryEnabled: false,
                legilScreenshotEnabled: false,
                pauseOnConsecutiveFailures: false,
                consecutiveFailureThreshold: 3
            },
            creative: {
                outputFolder,
                referenceFolder: '',
                browserMode: 'headless',
                generationSettings: {
                    imageModel: 'nano-banana-2',
                    aspectRatio: '1:1',
                    resolution: '2K',
                    outputQuantity: 1
                }
            }
        }
    });

    const app = createFakeApp();
    registerLegilRoutes(app, context);
    const handler = app.handlers.get('POST /api/legil/creative-batch');
    assert.ok(handler, 'creative-batch route should be registered');

    const res = createResponse();
    await handler({
        body: {
            outputFolder,
            browserMode: 'headless',
            generationSettings: {
                imageModel: 'nano-banana-2',
                aspectRatio: '1:1',
                resolution: '2K',
                outputQuantity: 1
            },
            directionLibrary: [
                { id: 'dir-topic', path: '题材' },
                { id: 'dir-explore', path: '题材 / 探索发现' },
                { id: 'dir-shelter', path: '题材 / 探索发现 / 避难所' }
            ],
            prompts: [{
                index: 1,
                sourceRow: 1,
                direction: '地下补给仓发现',
                newDirectionName: '地下补给仓发现',
                promptTitle: '门口抢修热源灯',
                sourceDirectionPath: '题材 / 探索发现 / 避难所 / 地下入口',
                prompt: '主题：地下补给仓发现。画风：高质量 3D 卡通渲染。画面内容清楚可读。'
            }]
        }
    }, res);

    assert.strictEqual(res.payload.success, true);
    await waitFor(() => calls.length === 1);

    assert.strictEqual(calls[0].options.outputNameBase, '题材_探索发现_避难所_地下补给仓发现');
    assert.strictEqual(calls[0].options.referenceImageName, '题材_探索发现_避难所_地下补给仓发现');
    assert.ok(!calls[0].options.outputNameBase.includes('门口抢修热源灯'));

    fs.rmSync(root, { recursive: true, force: true });
}

function checkNormalizerAndFileName() {
    const context = createRouteContext();
    const prompt = context.normalizeCreativeBatchPromptItems([{
        primaryTag: '题材',
        secondaryTag: '探索发现',
        tertiaryTag: '避难所',
        standardLabelPath: ['题材', '探索发现', '避难所'],
        sourceDirectionId: 'dir-shelter',
        sourceDirectionPath: '题材 / 探索发现 / 避难所 / 地下入口',
        newDirectionName: '地下补给仓发现',
        promptTitle: '门口抢修热源灯',
        contentTitle: '地下补给仓发现',
        outputNameBase: '题材_探索发现_避难所_地下补给仓发现',
        promptHash: 'abc123',
        prompt: '有效提示词'
    }])[0];

    assert.deepStrictEqual(prompt.standardLabelPath, ['题材', '探索发现', '避难所']);
    assert.strictEqual(prompt.sourceDirectionPath, '题材 / 探索发现 / 避难所 / 地下入口');
    assert.strictEqual(prompt.newDirectionName, '地下补给仓发现');
    assert.strictEqual(prompt.contentTitle, '地下补给仓发现');
    assert.strictEqual(prompt.outputNameBase, '题材_探索发现_避难所_地下补给仓发现');
    assert.strictEqual(prompt.promptTitle, '门口抢修热源灯');

    const fileName = legilAutomation.buildOutputFileName(1, {
        outputSequence: 1,
        outputTotal: 1,
        runId: 'creative_20260602_153012',
        referenceImageIndex: 1,
        totalReferenceImages: 1,
        referenceImageName: '地下补给仓发现_门口抢修热源灯',
        outputNameBase: prompt.outputNameBase,
        promptTitle: prompt.promptTitle,
        promptIndexWithinImage: 1,
        variantIndex: 1
    });

    assert.match(
        fileName,
        /^creative_20260602_153012_0001_题材_探索发现_避难所_地下补给仓发现_v01_\d{8}_\d{6}\.png$/
    );
    assert.ok(!fileName.includes('门口抢修热源灯'));
}

async function main() {
    checkNormalizerAndFileName();
    await checkCreativeBatchRouteNaming();
    console.log('[creative-output-naming S2] Creative auto main-chain naming checks passed.');
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
