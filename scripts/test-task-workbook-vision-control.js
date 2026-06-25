const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { TaskWorkbookStore } = require('../src/services/task-workbook/store');
const { TaskDirectionVisionService } = require('../src/services/task-workbook/vision-service');
const { classifyVisionApiError } = require('../src/services/material-analysis/vision/vision-client');

function makeDirection(index) {
    return {
        importId: 'task_import_test',
        taskDirectionId: `task_direction_${index}`,
        sourceRow: index + 1,
        sourcePath: `题材/测试/${index}`,
        iterationDescription: '测试迭代',
        directionDescription: '测试方向',
        referenceImages: [
            {
                filePath: __filename,
                mimeType: 'image/png'
            }
        ]
    };
}

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeoutMs = 1000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const value = predicate();
        if (value) return value;
        await wait(20);
    }
    return predicate();
}

function createStore() {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-workbook-vision-'));
    const store = new TaskWorkbookStore(rootDir);
    const importId = 'task_import_test';
    const directions = [makeDirection(1), makeDirection(2)];
    store.writeImport({
        importId,
        summary: {
            importId,
            fileName: 'test.xlsx',
            importedAt: new Date().toISOString(),
            taskDirectionCount: directions.length,
            taskReferenceImageCount: directions.length
        },
        taskDirections: directions,
        hierarchyDefinitions: []
    });
    return { rootDir, store, importId, directions };
}

async function testStaleRunningStatusBecomesPaused() {
    const { store, importId, directions } = createStore();
    store.writeVisionResults(importId, [
        {
            taskDirectionId: directions[0].taskDirectionId,
            importId,
            status: 'success',
            source: 'api',
            vision: { visualSummary: 'done' }
        },
        {
            taskDirectionId: directions[1].taskDirectionId,
            importId,
            status: 'pending'
        }
    ]);
    store.writeVisionStatus(importId, {
        importId,
        state: 'running',
        running: true,
        total: 2,
        completed: 1,
        successCount: 1,
        failedCount: 0,
        cachedCount: 0,
        pendingCount: 1,
        currentTaskDirectionId: directions[1].taskDirectionId,
        currentSourcePath: directions[1].sourcePath,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        message: '正在整理 2/2'
    });

    const service = new TaskDirectionVisionService({
        store,
        client: {
            validateConfig() {}
        }
    });

    const status = service.getStatus(importId).status;
    assert.strictEqual(status.state, 'paused');
    assert.strictEqual(status.running, false);
    assert.strictEqual(status.completed, 1);
    assert.strictEqual(status.pendingCount, 1);
    assert.match(status.message, /未正常收尾/);
}

async function testPauseAbortsInFlightVisionRequest() {
    const { store, importId } = createStore();
    let sawSignal = false;
    let aborted = false;
    const service = new TaskDirectionVisionService({
        store,
        client: {
            validateConfig() {},
            getCacheMeta() {
                return { provider: 'test' };
            },
            analyzeTaskDirection({ signal }) {
                sawSignal = Boolean(signal);
                return new Promise((resolve, reject) => {
                    if (signal && signal.aborted) {
                        aborted = true;
                        const error = new Error('cancelled');
                        error.code = 'ERR_CANCELED';
                        reject(error);
                        return;
                    }
                    signal.addEventListener('abort', () => {
                        aborted = true;
                        const error = new Error('cancelled');
                        error.code = 'ERR_CANCELED';
                        reject(error);
                    }, { once: true });
                });
            }
        }
    });

    const startResult = service.start(importId, { concurrency: 1 });
    assert.strictEqual(startResult.success, true);

    await waitFor(() => sawSignal);
    const pauseResult = service.pause(importId);
    assert.strictEqual(pauseResult.success, true);

    const finalStatus = await waitFor(() => {
        const status = service.getStatus(importId).status;
        return status.state === 'paused' && status.running === false ? status : null;
    });

    assert.strictEqual(aborted, true);
    assert(finalStatus, 'expected the task to become paused');
    assert.strictEqual(finalStatus.pendingCount, 2);
}

async function testUpstreamTimeoutIsNotFatalAndContinuesQueue() {
    assert.strictEqual(classifyVisionApiError(403, 'upstream request timeout'), 'UPSTREAM_TIMEOUT');

    const { store, importId, directions } = createStore();
    const calls = [];
    const service = new TaskDirectionVisionService({
        store,
        client: {
            validateConfig() {},
            getCacheMeta() {
                return { provider: 'test' };
            },
            async analyzeTaskDirection({ taskDirection }) {
                calls.push(taskDirection.taskDirectionId);
                if (taskDirection.taskDirectionId === directions[0].taskDirectionId) {
                    const error = new Error('Lumos Winky 任务方向视觉整理失败 HTTP 403: upstream request timeout');
                    error.code = 'UPSTREAM_TIMEOUT';
                    error.fatal = false;
                    throw error;
                }
                return {
                    rawText: '{}',
                    result: {
                        visualSummary: 'ok',
                        creativeCore: 'ok',
                        mustKeep: [],
                        variationAxes: [],
                        avoidRules: []
                    }
                };
            }
        }
    });

    service.start(importId, { concurrency: 1, maxRetriesPerRow: 1 });
    const finalStatus = await waitFor(() => {
        const status = service.getStatus(importId).status;
        return status.running === false && ['partial', 'completed'].includes(status.state) ? status : null;
    }, 1000);

    assert(finalStatus, 'expected the queue to finish');
    assert.strictEqual(finalStatus.state, 'partial');
    assert.strictEqual(finalStatus.successCount, 1);
    assert.strictEqual(finalStatus.failedCount, 1);
    assert.deepStrictEqual(calls, directions.map(item => item.taskDirectionId));
}

(async () => {
    await testStaleRunningStatusBecomesPaused();
    await testPauseAbortsInFlightVisionRequest();
    await testUpstreamTimeoutIsNotFatalAndContinuesQueue();
    console.log('task workbook vision control tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
