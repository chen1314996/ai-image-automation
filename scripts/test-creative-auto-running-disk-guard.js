const assert = require('assert');
const path = require('path');
const { createCreativeAutoService } = require('../src/services/creative-auto');
const {
    cleanupFixture,
    defaultDirections,
    makeTempCreativeFixture,
    todayKey,
    writeBaseKnowledge,
    writeJson
} = require('./creative-auto-test-utils');

async function main() {
    const fixture = makeTempCreativeFixture('creative-auto-running-guard-');
    try {
        const directions = defaultDirections();
        writeBaseKnowledge(fixture, directions);

        const runId = 'creative_run_running_from_disk';
        const queueId = 'creative_queue_running_from_disk';
        const now = new Date().toISOString();
        const appConfig = {
            creative: {
                outputFolder: fixture.outputFolder,
                referenceFolder: fixture.referenceFolder,
                generationSettings: { outputQuantity: 1 }
            }
        };

        writeJson(path.join(fixture.dataDir, 'runs', `${runId}.json`), {
            runId,
            mode: 'legil-run-once',
            agentOnly: false,
            status: 'running',
            phase: 'agent_running',
            createdAt: now,
            startedAt: now,
            updatedAt: now,
            completedAt: '',
            sourceDirection: directions[0],
            selection: { score: 90, reasons: ['test'] },
            config: appConfig.creative,
            schedulerState: {
                status: 'running',
                currentRunId: runId,
                currentAgentTaskRunId: 'creative_agent_running_from_disk',
                daily: { date: todayKey(), imageCount: 0, imageLimit: 1000 }
            },
            targetQueue: { queueId, index: 1, total: 2 },
            agentTaskRunId: 'creative_agent_running_from_disk',
            agentTask: { runId: 'creative_agent_running_from_disk', phase: 'running', running: true }
        });

        writeJson(path.join(fixture.dataDir, 'scheduler-state.json'), {
            status: 'running',
            currentRunId: runId,
            currentAgentTaskRunId: 'creative_agent_running_from_disk',
            targetQueue: {
                queueId,
                status: 'running',
                currentRunId: runId
            },
            daily: { date: todayKey(), imageCount: 0, imageLimit: 1000 }
        });

        writeJson(path.join(fixture.dataDir, 'creative-target-queues.json'), {
            version: 1,
            queues: [{
                queueId,
                status: 'running',
                originalPayload: {
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
                startedAt: now,
                updatedAt: now
            }]
        });

        let agentStarts = 0;
        const service = createCreativeAutoService({
            rootDir: fixture.root,
            logger: { info() {}, warn() {}, error() {} },
            isLegilBusy: () => false,
            getStoredWinkyConfig: () => ({
                apiKey: 'test-key',
                apiUrl: 'https://winky.test/v1',
                model: 'test-model',
                provider: 'test'
            }),
            hasActiveCreativeAgentTask: () => false,
            getCreativeAgentTask: runId => ({ runId, phase: 'running', running: true }),
            publicCreativeAgentTask: task => task,
            startCreativeAgentTask: () => {
                agentStarts += 1;
                return { runId: `agent-${agentStarts}`, phase: 'running' };
            }
        });

        const result = service.runOnce({
            maxPrompts: 1,
            directionIds: ['direction-2']
        }, { dataDir: fixture.dataDir, appConfig });

        assert.strictEqual(result.success, false);
        assert.match(result.message, /已有自动创意任务正在运行/);
        assert.strictEqual(result.activeRun.runId, runId);
        assert.strictEqual(result.activeRun.targetQueueProgress.status, 'running');
        assert.strictEqual(agentStarts, 0);
    } finally {
        cleanupFixture(fixture);
    }
}

main()
    .then(() => console.log('creative auto running disk guard tests passed'))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });
