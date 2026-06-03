const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createCreativeAutoService } = require('../src/services/creative-auto');

function todayKey() {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
}

function writeJson(filePath, data) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

async function runFinalSnapshotRecoveryTest() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'creative-auto-final-snapshot-'));
    const dataDir = path.join(root, 'data', 'creative-knowledge');
    const outputFolder = path.join(root, 'output');
    const referenceFolder = path.join(root, 'reference');
    const runId = 'creative_run_recovery_001';
    const queueId = 'creative_queue_recovery_001';
    const savedFile = path.join(outputFolder, 'recovered_001.png');
    fs.mkdirSync(path.join(dataDir, 'runs'), { recursive: true });
    fs.mkdirSync(outputFolder, { recursive: true });
    fs.mkdirSync(referenceFolder, { recursive: true });
    fs.writeFileSync(savedFile, Buffer.from('image'));

    const direction = {
        id: 'direction-1',
        path: '题材/探索发现/补给站',
        name: '补给站',
        autoRun: true,
        status: 'accepted',
        stats: {
            expandedCount: 0,
            promptCount: 0,
            imageCount: 0,
            failureCount: 0
        }
    };
    const targets = [{
        targetId: 'target-1',
        sourceDirectionPath: direction.path,
        sourceDirectionKey: direction.path,
        sourceMaterialName: '补给站素材1',
        selected: true,
        newDirectionsPerSource: 1,
        promptGroupsPerNewDirection: 1,
        expectedPromptCount: 1
    }];

    writeJson(path.join(dataDir, 'metadata.json'), {
        importedAt: new Date().toISOString(),
        counts: {
            directions: 1,
            topMaterials: 1,
            topMaterialInsights: 1,
            referenceImages: 0
        },
        warnings: []
    });
    writeJson(path.join(dataDir, 'directions.json'), { directions: [direction] });
    writeJson(path.join(dataDir, 'top-material-insights.json'), { insights: [] });
    writeJson(path.join(dataDir, 'reference-images.json'), { images: [] });
    writeJson(path.join(dataDir, 'assets.json'), { version: 1, assets: [] });
    writeJson(path.join(dataDir, 'scheduler-state.json'), {
        version: 1,
        status: 'idle',
        daily: {
            date: todayKey(),
            imageCount: 0,
            imageLimit: 1000
        },
        targetQueue: {
            queueId,
            status: 'running',
            totalTargets: 1,
            currentIndex: 1,
            nextIndex: 0,
            completedTargets: 0,
            remainingTargets: 1,
            currentRunId: runId,
            totalExpectedPromptCount: 1
        }
    });
    writeJson(path.join(dataDir, 'creative-target-queues.json'), {
        version: 1,
        queues: [{
            queueId,
            status: 'running',
            originalPayload: {
                agentOnly: true,
                maxPrompts: 1,
                creativeBrief: {
                    source: 'material-analysis',
                    brief: {
                        packageType: 'creative-target-package',
                        target: 'source-directions',
                        creativeTargets: targets,
                        targets
                    }
                }
            },
            context: {
                appConfig: {
                    creative: {
                        outputFolder,
                        referenceFolder,
                        browserMode: 'headless'
                    }
                }
            },
            targets,
            totalTargets: 1,
            totalExpectedPromptCount: 1,
            nextIndex: 0,
            currentIndex: 0,
            currentRunId: runId,
            completedTargetIds: [],
            completedRunIds: [],
            failedRunIds: []
        }]
    });
    writeJson(path.join(dataDir, 'runs', `${runId}.json`), {
        runId,
        mode: 'legil-run-once',
        agentOnly: false,
        status: 'running',
        phase: 'legil_running',
        createdAt: new Date().toISOString(),
        startedAt: new Date().toISOString(),
        completedAt: '',
        sourceDirection: direction,
        targetQueue: {
            queueId,
            index: 1,
            total: 1,
            targetId: 'target-1',
            targetName: '补给站素材1'
        },
        selection: {
            score: 100,
            scoreParts: {},
            reasons: [],
            topMaterialInsight: null
        },
        config: {
            outputFolder,
            referenceFolder,
            generationSettings: {
                outputQuantity: 4
            }
        },
        schedulerState: {
            daily: {
                date: todayKey(),
                imageCount: 0,
                imageLimit: 1000
            }
        },
        prompts: [{
            index: 1,
            direction: '补给站热源',
            promptTitle: '提示词1',
            promptHash: 'hash-1',
            finalPrompt: '主题：补给站热源。'
        }],
        promptTotal: 1,
        legilProgress: {
            taskType: 'creative-batch',
            phase: 'running',
            total: 1,
            completed: 0,
            success: 0,
            failed: 0,
            saved: 0,
            creativeAutoRunId: runId
        },
        legilResult: null,
        message: 'stale running'
    });

    const service = createCreativeAutoService({
        rootDir: root,
        dataDir,
        logger: { info() {}, warn() {}, error() {} },
        getCreativeProgressSnapshot: () => ({
            hasProgress: true,
            running: false,
            stopRequested: false,
            taskType: null,
            progress: {
                taskType: 'creative-batch',
                phase: 'completed',
                total: 1,
                completed: 1,
                success: 1,
                failed: 0,
                saved: 1,
                outputTotal: 1,
                creativeAutoRunId: runId,
                savedFiles: [{
                    filePath: savedFile,
                    fileName: path.basename(savedFile),
                    promptListIndex: 1,
                    displayIndex: 1,
                    imageIndex: 1,
                    direction: '补给站热源',
                    promptTitle: '提示词1',
                    promptHash: 'hash-1',
                    savedAt: new Date().toISOString()
                }],
                promptResults: [{
                    promptListIndex: 1,
                    displayIndex: 1,
                    direction: '补给站热源',
                    promptTitle: '提示词1',
                    promptHash: 'hash-1',
                    savedCount: 1,
                    savedFiles: [{
                        filePath: savedFile,
                        fileName: path.basename(savedFile)
                    }]
                }],
                currentAction: '创意拓展任务完成：成功 1 组，失败 0 组'
            }
        }),
        getStoredWinkyConfig: () => ({
            apiUrl: 'https://example.invalid',
            apiKey: 'test-key',
            model: 'test-model'
        }),
        hasActiveCreativeAgentTask: () => false,
        isLegilBusy: () => false,
        startCreativeAgentTask: () => ({
            runId: 'agent-next',
            phase: 'running',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        }),
        getCreativeAgentTask: () => null,
        publicCreativeAgentTask: task => task,
        notifyTaskEvent: () => {}
    });

    try {
        const context = {
            dataDir,
            appConfig: {
                creative: {
                    outputFolder,
                    referenceFolder,
                    browserMode: 'headless'
                }
            }
        };
        service.getStatus(context);

        const recoveredRun = service.getRun(runId, context);
        assert.strictEqual(recoveredRun.status, 'completed');
        assert.strictEqual(recoveredRun.phase, 'legil_completed');
        assert.strictEqual(recoveredRun.legilResult.savedCount, 1);
        assert.strictEqual(recoveredRun.assets.newAssetCount, 1);

        const queueState = JSON.parse(fs.readFileSync(path.join(dataDir, 'creative-target-queues.json'), 'utf8'));
        const queue = queueState.queues.find(item => item.queueId === queueId);
        assert.strictEqual(queue.status, 'completed');
        assert.strictEqual(queue.nextIndex, 1);
        assert.deepStrictEqual(queue.completedTargetIds, ['target-1']);
        assert.deepStrictEqual(queue.completedRunIds, [runId]);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

runFinalSnapshotRecoveryTest()
    .then(() => {
        console.log('creative auto final snapshot recovery tests passed');
    })
    .catch(error => {
        console.error(error);
        process.exit(1);
    });
