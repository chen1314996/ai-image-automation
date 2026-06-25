const assert = require('assert');
const express = require('express');
const fs = require('fs');
const path = require('path');
const registerLegilRoutes = require('../src/routes/legil.routes');
const {
    cleanupFixture,
    makePrompt,
    makeTempCreativeFixture
} = require('./creative-auto-test-utils');

function normalizePromptItems(items = []) {
    return items.map((item, index) => ({
        ...item,
        index: Number(item.index) || index + 1,
        sourceRow: Number(item.sourceRow) || index + 1,
        prompt: String(item.prompt || item.finalPrompt || '').trim(),
        finalPrompt: String(item.finalPrompt || item.prompt || '').trim(),
        selected: true
    })).filter(item => item.prompt);
}

async function main() {
    const fixture = makeTempCreativeFixture('creative-batch-failed-record-');
    const app = express();
    app.use(express.json({ limit: '2mb' }));

    const automationState = {
        legilTaskRunning: false,
        legilStopRequested: false,
        legilTaskType: null,
        legilTaskProgress: null
    };
    let creativeResumeState = null;
    const context = {
        rootDir: fixture.root,
        creativeKnowledgeDataDir: fixture.dataDir,
        dataDir: fixture.dataDir,
        appConfig: {
            creative: {
                outputFolder: fixture.outputFolder,
                referenceFolder: fixture.referenceFolder,
                browserMode: 'headless',
                generationSettings: { imageModel: 'test', aspectRatio: '1:1', resolution: '1K', outputQuantity: 1 }
            },
            notifications: {
                autoRecoveryEnabled: false,
                legilScreenshotEnabled: false,
                pauseOnConsecutiveFailures: false,
                consecutiveFailureThreshold: 99
            }
        },
        automationState,
        buildResizeJobs: () => [],
        clearCreativeResumeState: () => { creativeResumeState = null; },
        clearResizeResumeState: () => {},
        DEFAULT_CREATIVE_CONFIG: {
            outputFolder: fixture.outputFolder,
            referenceFolder: fixture.referenceFolder,
            browserMode: 'headless',
            generationSettings: { imageModel: 'test', aspectRatio: '1:1', resolution: '1K', outputQuantity: 1 }
        },
        DEFAULT_RESIZE_CONFIG: {},
        formatDateTimeForFile: () => '20260604_120000',
        fs,
        getCreativeProgressSnapshot: () => ({
            hasProgress: Boolean(automationState.legilTaskProgress),
            running: automationState.legilTaskRunning,
            stopRequested: automationState.legilStopRequested,
            taskType: automationState.legilTaskType,
            progress: automationState.legilTaskProgress
        }),
        getCreativeResumeInfo: includePrompts => ({
            hasResume: Boolean(creativeResumeState),
            ...(creativeResumeState || {}),
            prompts: includePrompts && creativeResumeState ? creativeResumeState.prompts : undefined
        }),
        getResizeAspectRatiosFromSettings: () => [],
        getResizeResumeInfo: () => ({ hasResume: false }),
        isLegilBusy: () => automationState.legilTaskRunning === true,
        isLegilStopRequested: () => automationState.legilStopRequested === true,
        legilAutomation: {
            saveFolder: '',
            referenceFolder: '',
            referenceImages: [],
            currentRefIndex: 0,
            generationSettings: {},
            getConfig: () => ({ settings: { imageModel: 'test', aspectRatio: '1:1', resolution: '1K', outputQuantity: 1 } }),
            getImageModelLabel: value => value,
            generateImage: async (prompt, index, options) => {
                if (index === 3) {
                    return { success: false, message: 'mock generation failed' };
                }
                const filePath = path.join(fixture.outputFolder, `generated-${index}.png`);
                fs.writeFileSync(filePath, Buffer.from('image'));
                return { success: true, savedCount: 1, savePaths: [filePath] };
            }
        },
        listImageFilesInFolder: () => [],
        logger: { system() {}, info() {}, warn() {}, error() {} },
        normalizeCreativeBatchPromptItems: normalizePromptItems,
        normalizeCreativeBrowserMode: value => value === 'headed' ? 'headed' : 'headless',
        normalizeCreativeConfigPayload: payload => ({
            outputFolder: payload.outputFolder || fixture.outputFolder,
            referenceFolder: payload.referenceFolder || fixture.referenceFolder,
            browserMode: payload.browserMode || 'headless',
            generationSettings: payload.generationSettings || { outputQuantity: 1 }
        }),
        normalizeLegilGenerationSettings: settings => ({
            imageModel: 'test',
            aspectRatio: '1:1',
            resolution: '1K',
            outputQuantity: 1,
            ...(settings || {})
        }),
        normalizeResizeConfigPayload: payload => payload || {},
        notifyLegilResult: () => {},
        notifyTaskEvent: () => {},
        path,
        persistRuntimeConfig: () => {},
        requestLegilTaskStop: () => {
            automationState.legilStopRequested = true;
            return { success: true };
        },
        resolveCreativeBatchRunContext: (prompts, body, settings) => ({
            isResume: false,
            previousState: null,
            baseCompleted: 0,
            baseSuccess: 0,
            baseFailed: 0,
            baseSaved: 0,
            total: prompts.length,
            outputTotal: prompts.length * (Number(settings.outputQuantity) || 1)
        }),
        setCreativeResumeState: state => { creativeResumeState = state; return creativeResumeState; },
        setResizeResumeState: () => {},
        sleepWithLegilStop: async () => {},
        toPositiveIndex: value => Math.max(1, Number(value) || 1),
        updateCreativeResumeState: updates => {
            creativeResumeState = { ...(creativeResumeState || {}), ...(updates || {}) };
            return creativeResumeState;
        },
        updateResizeResumeState: () => {},
        workflowController: {}
    };

    registerLegilRoutes(app, context);
    const server = await new Promise(resolve => {
        const instance = app.listen(0, () => resolve(instance));
    });

    try {
        const port = server.address().port;
        const prompts = Array.from({ length: 5 }, (_, index) => makePrompt(index + 1, {
            promptTitle: `Prompt ${index + 1}`,
            promptHash: `hash-${index + 1}`,
            sourceRow: index + 11,
            prompt: `Prompt body ${index + 1}`
        }));
        const res = await fetch(`http://127.0.0.1:${port}/api/legil/creative-batch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                outputFolder: fixture.outputFolder,
                referenceFolder: fixture.referenceFolder,
                browserMode: 'headless',
                generationSettings: { outputQuantity: 1 },
                prompts
            })
        });
        const started = await res.json();
        assert.strictEqual(started.success, true);

        await new Promise((resolve, reject) => {
            const startedAt = Date.now();
            const tick = () => {
                if (automationState.legilTaskRunning === false && automationState.legilTaskProgress && automationState.legilTaskProgress.phase === 'completed') {
                    resolve();
                    return;
                }
                if (Date.now() - startedAt > 3000) {
                    reject(new Error('Timed out waiting for creative batch completion'));
                    return;
                }
                setTimeout(tick, 25);
            };
            tick();
        });

        const failed = automationState.legilTaskProgress.failedPromptResults;
        assert.strictEqual(failed.length, 1);
        assert.strictEqual(failed[0].promptListIndex, 3);
        assert.strictEqual(failed[0].displayIndex, 3);
        assert.strictEqual(failed[0].sourceRow, 13);
        assert.strictEqual(failed[0].promptTitle, 'Prompt 3');
        assert.strictEqual(failed[0].promptHash, 'hash-3');
        assert.strictEqual(failed[0].prompt, 'Prompt body 3');
        assert.match(failed[0].message, /mock generation failed/);
    } finally {
        await new Promise(resolve => server.close(resolve));
        cleanupFixture(fixture);
    }
}

main()
    .then(() => console.log('creative batch failed prompt record tests passed'))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });
