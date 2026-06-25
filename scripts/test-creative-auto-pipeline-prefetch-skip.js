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
        '画面内容：幸存者小队在冰封末世的废弃补给站门口发现隐藏物资，前景是结冰背包和破损路牌，中景人物协作搬运箱子，远景有风雪中的避难所灯光。',
        '镜头构图：低机位三分法构图，补给箱和人物动作形成清晰视觉中心，广告点击点突出。',
        '情绪氛围：寒冷紧张但带有希望，冷蓝环境光与暖黄补给光形成对比。',
        '整体基调：冰雪求生、资源发现、团队协作、商业游戏宣传图。',
        '画风：高质量3D卡通渲染，电影镜头感，1:1方图，2K。'
    ].join('');
}

async function main() {
    const fixture = makeTempCreativeFixture('creative-auto-pipeline-prefetch-skip-');
    try {
        const directions = defaultDirections().concat([{
            id: 'direction-3',
            path: 'Topic/Source/Direction Three',
            name: 'Direction Three',
            autoRun: true,
            priority: 70,
            stats: {}
        }]);
        writeBaseKnowledge(fixture, directions);
        const runId = 'creative_run_pipeline_skip_current';
        const queueId = 'creative_queue_pipeline_skip';
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
            targetQueue: { queueId, index: 1, total: 3 }
        });

        const targets = directions.map((direction, index) => ({
            targetId: `target-${index + 1}`,
            directionIds: [direction.id],
            sourceDirectionPath: direction.path,
            sourceMaterialName: `Target ${index + 1}`
        }));
        writeJson(path.join(fixture.dataDir, 'creative-target-queues.json'), {
            version: 1,
            queues: [{
                queueId,
                status: 'running',
                originalPayload: {
                    fullScale: false,
                    maxPrompts: 1,
                    creativeBrief: {
                        packageType: 'creative-target-package',
                        target: 'source-directions',
                        creativeTargets: targets
                    }
                },
                context: { appConfig },
                targets,
                totalTargets: 3,
                totalExpectedPromptCount: 3,
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
            startCreativeAgentTask: () => ({ runId: `agent-prefetch-skip-${++agentCounter}`, phase: 'running' }),
            getCreativeAgentTask: runId => {
                const attemptNumber = Number(String(runId).split('-').pop()) || 0;
                if (attemptNumber <= 3) {
                    return { runId, phase: 'failed', error: 'synthetic prefetch failure' };
                }
                return {
                    runId,
                    phase: 'completed',
                    result: {
                        prompts: [makePrompt(1, {
                            sourceDirectionId: 'direction-3',
                            sourceDirectionPath: directions[2].path,
                            direction: 'Recovered Direction Three',
                            newDirectionName: 'Recovered Direction Three',
                            prompt: completePrompt('Recovered Direction Three'),
                            finalPrompt: completePrompt('Recovered Direction Three')
                        })]
                    }
                };
            },
            publicCreativeAgentTask: (task, includeResult) => ({
                ...task,
                result: includeResult ? task.result : undefined
            }),
            startLegilCreativeBatch: async payload => ({
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
            }),
            getLegilCreativeProgress: async () => ({
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
                    creativeAutoRunId: runId,
                    currentAction: 'still running'
                }
            })
        });

        const started = service.continueRunToLegil(runId, {}, { dataDir: fixture.dataDir, appConfig });
        assert.strictEqual(started.success, true);

        const queue = await waitFor(() => {
            const data = JSON.parse(fs.readFileSync(path.join(fixture.dataDir, 'creative-target-queues.json'), 'utf8'));
            const queue = data.queues[0];
            const skippedSecond = queue.skippedTargets && queue.skippedTargets.some(item => item.index === 1 && item.attempts === 3);
            return skippedSecond && queue.nextPreparedRunId && queue.nextPrepareIndex === 2 ? queue : null;
        }, 8000);

        assert.strictEqual(queue.prefetchAttemptsByIndex['1'], 3);
        assert.ok(queue.skippedTargetIds.includes('target-2'));
        assert.ok(queue.nextPreparedRunId);
        assert.strictEqual(agentCounter, 4);
    } finally {
        cleanupFixture(fixture);
    }
}

main()
    .then(() => console.log('creative auto pipeline prefetch skip tests passed'))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });
