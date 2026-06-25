const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createCreativeAutoService } = require('../src/services/creative-auto');
const {
    cleanupFixture,
    defaultDirections,
    makePrompt,
    makeTempCreativeFixture,
    todayKey,
    waitFor,
    writeBaseKnowledge,
    writeJson
} = require('./creative-auto-test-utils');

function completePrompt(label) {
    return [
        `主题：${label}。`,
        '画面内容：两名幸存者在冰封末世废墟入口协作搬开结冰金属门，门缝里透出暖色补给光，前景有破损背包、冻住的绳索和散落工具，中景人物动作清晰，远景是被风雪压住的建筑轮廓。',
        '镜头构图：低机位中景，前景道具形成探索线索，人物和入口占据画面中心，危险与奖励关系一眼可读。',
        '情绪氛围：寒冷、紧张、发现希望的瞬间，冷蓝雪光和门内暖光形成强对比。',
        '整体基调：冰雪求生、探索发现、商业游戏广告点击图。',
        '画风：高质量3D卡通渲染，商业级游戏宣传海报风格，电影镜头感，1:1方图。'
    ].join('');
}

async function main() {
    const fixture = makeTempCreativeFixture('creative-auto-pipeline-prefetch-');
    try {
        const directions = defaultDirections();
        writeBaseKnowledge(fixture, directions);
        const runId = 'creative_run_pipeline_current';
        const queueId = 'creative_queue_pipeline';
        const appConfig = {
            creative: {
                outputFolder: fixture.outputFolder,
                referenceFolder: fixture.referenceFolder,
                generationSettings: { outputQuantity: 1 },
                pipelinePrefetch: true
            }
        };

        writeJson(path.join(fixture.dataDir, 'runs', `${runId}.json`), {
            runId,
            mode: 'legil-run-once',
            agentOnly: false,
            status: 'completed',
            phase: 'agent_completed',
            createdAt: new Date().toISOString(),
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            sourceDirection: directions[0],
            selection: { score: 90, reasons: ['test'] },
            config: { outputFolder: fixture.outputFolder, referenceFolder: fixture.referenceFolder, generationSettings: { outputQuantity: 1 } },
            schedulerState: { daily: { date: todayKey(), imageCount: 0, imageLimit: 1000 } },
            prompts: [makePrompt(1, {
                prompt: completePrompt('Direction One'),
                finalPrompt: completePrompt('Direction One')
            })],
            promptTotal: 1,
            promptQualityReport: { rawPromptCount: 1, acceptedPromptCount: 1, rejectedPromptCount: 0 },
            targetQueue: { queueId, index: 1, total: 2 }
        });

        writeJson(path.join(fixture.dataDir, 'creative-target-queues.json'), {
            version: 1,
            queues: [{
                queueId,
                status: 'running',
                originalPayload: {
                    fullScale: false,
                    maxPrompts: 1,
                    directionIds: ['direction-1', 'direction-2'],
                    creativeBrief: {
                        packageType: 'creative-target-package',
                        target: 'source-directions',
                        creativeTargets: [
                            { targetId: 'target-1', directionIds: ['direction-1'], sourceDirectionPath: directions[0].path, sourceMaterialName: 'Target 1' },
                            { targetId: 'target-2', directionIds: ['direction-2'], sourceDirectionPath: directions[1].path, sourceMaterialName: 'Target 2' }
                        ]
                    }
                },
                context: { appConfig },
                targets: [
                    { targetId: 'target-1', directionIds: ['direction-1'], sourceDirectionPath: directions[0].path, sourceMaterialName: 'Target 1' },
                    { targetId: 'target-2', directionIds: ['direction-2'], sourceDirectionPath: directions[1].path, sourceMaterialName: 'Target 2' }
                ],
                totalTargets: 2,
                totalExpectedPromptCount: 2,
                currentIndex: 0,
                nextIndex: 0,
                currentRunId: runId,
                completedTargetIds: [],
                completedRunIds: [],
                failedRunIds: [],
                startedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            }]
        });

        let agentCounter = 0;
        const legilStarts = [];
        let firstLegilCanComplete = false;
        const service = createCreativeAutoService({
            rootDir: fixture.root,
            logger: { info() {}, warn() {}, error() {} },
            legilProgressPollMs: 50,
            legilProgressMaxWaitMs: 5000,
            isLegilBusy: () => false,
            hasActiveCreativeAgentTask: () => false,
            getStoredWinkyConfig: () => ({
                apiKey: 'test-key',
                apiUrl: 'https://winky.test/v1',
                model: 'test-model',
                provider: 'test'
            }),
            startCreativeAgentTask: () => ({ runId: `agent-prefetch-${++agentCounter}`, phase: 'running' }),
            getCreativeAgentTask: runId => ({
                runId,
                phase: 'completed',
                result: {
                    prompts: [makePrompt(1, {
                        sourceDirectionId: 'direction-2',
                        sourceDirectionPath: directions[1].path,
                        direction: 'Pipeline Prefetched Direction',
                        newDirectionName: 'Pipeline Prefetched Direction',
                        prompt: completePrompt('Pipeline Prefetched Direction'),
                        finalPrompt: completePrompt('Pipeline Prefetched Direction')
                    })]
                }
            }),
            publicCreativeAgentTask: (task, includeResult) => ({
                ...task,
                result: includeResult ? task.result : undefined
            }),
            startLegilCreativeBatch: async payload => {
                legilStarts.push(payload);
                return {
                    success: true,
                    message: 'started',
                    totalPrompts: payload.prompts.length,
                    outputTotal: 1,
                    progress: {
                        taskType: 'creative-batch',
                        phase: 'queued',
                        total: payload.prompts.length,
                        creativeAutoRunId: payload.creativeAutoRunId
                    }
                };
            },
            getLegilCreativeProgress: async () => {
                const activePayload = legilStarts[legilStarts.length - 1] || {};
                if (legilStarts.length === 1 && !firstLegilCanComplete) {
                    return {
                        success: true,
                        hasProgress: true,
                        running: true,
                        taskType: 'creative-batch',
                        progress: {
                            taskType: 'creative-batch',
                            phase: 'running',
                            total: 1,
                            completed: 0,
                            success: 0,
                            failed: 0,
                            saved: 0,
                            outputTotal: 1,
                            creativeAutoRunId: activePayload.creativeAutoRunId,
                            currentAction: 'still running'
                        }
                    };
                }
                const savedFile = path.join(fixture.outputFolder, `${activePayload.creativeAutoRunId || 'run'}-done.png`);
                if (!fs.existsSync(savedFile)) {
                    fs.writeFileSync(savedFile, Buffer.from('image'));
                }
                return {
                    success: true,
                    hasProgress: true,
                    running: false,
                    taskType: 'creative-batch',
                    progress: {
                        taskType: 'creative-batch',
                        phase: 'completed',
                        total: 1,
                        completed: 1,
                        success: 1,
                        failed: 0,
                        saved: 1,
                        outputTotal: 1,
                        creativeAutoRunId: activePayload.creativeAutoRunId,
                        savedFiles: [{ filePath: savedFile, promptListIndex: 1, imageIndex: 1, savedAt: new Date().toISOString() }],
                        promptResults: [],
                        failedPromptResults: [],
                        currentAction: 'completed'
                    }
                };
            }
        });

        const started = service.continueRunToLegil(runId, {}, { dataDir: fixture.dataDir, appConfig });
        assert.strictEqual(started.success, true);

        const preparedQueue = await waitFor(() => {
            const data = JSON.parse(fs.readFileSync(path.join(fixture.dataDir, 'creative-target-queues.json'), 'utf8'));
            const queue = data.queues[0];
            return queue.nextPreparedRunId && queue.nextPrepareIndex === 1 ? queue : null;
        }, 5000);
        assert.strictEqual(legilStarts.length, 1);
        assert.ok(preparedQueue.nextPreparedRunId);

        firstLegilCanComplete = true;
        const consumedQueue = await waitFor(() => {
            const data = JSON.parse(fs.readFileSync(path.join(fixture.dataDir, 'creative-target-queues.json'), 'utf8'));
            const queue = data.queues[0];
            return queue.currentRunId === preparedQueue.nextPreparedRunId && legilStarts.length >= 2 ? queue : null;
        }, 5000);

        assert.strictEqual(consumedQueue.currentIndex, 1);
        assert.strictEqual(legilStarts[1].creativeAutoRunId, preparedQueue.nextPreparedRunId);
    } finally {
        cleanupFixture(fixture);
    }
}

main()
    .then(() => console.log('creative auto pipeline prefetch tests passed'))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });
