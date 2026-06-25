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
    writeBaseKnowledge,
    writeJson
} = require('./creative-auto-test-utils');

async function main() {
    const fixture = makeTempCreativeFixture('creative-auto-duplicate-advance-');
    try {
        const directions = defaultDirections();
        writeBaseKnowledge(fixture, directions);

        const runId = 'creative_run_duplicate_advance_previous';
        const queueId = 'creative_queue_duplicate_advance';
        const claimedRunId = 'creative_run_duplicate_advance_next';
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
            status: 'completed',
            phase: 'legil_completed',
            createdAt: new Date().toISOString(),
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            sourceDirection: directions[0],
            selection: { score: 90, reasons: ['test'] },
            config: {
                outputFolder: fixture.outputFolder,
                referenceFolder: fixture.referenceFolder,
                generationSettings: { outputQuantity: 1 }
            },
            schedulerState: { daily: { date: todayKey(), imageCount: 1, imageLimit: 1000 } },
            prompts: [makePrompt(1)],
            promptTotal: 1,
            legilResult: { success: true, successCount: 1, failedCount: 0, savedCount: 1 },
            targetQueue: { queueId, index: 1, total: 2 }
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
                            { targetId: 'target-1', sourceDirectionPath: directions[0].path, sourceMaterialName: 'Target 1' },
                            { targetId: 'target-2', sourceDirectionPath: directions[1].path, sourceMaterialName: 'Target 2' }
                        ]
                    }
                },
                context: { appConfig },
                targets: [
                    { targetId: 'target-1', sourceDirectionPath: directions[0].path, sourceMaterialName: 'Target 1' },
                    { targetId: 'target-2', sourceDirectionPath: directions[1].path, sourceMaterialName: 'Target 2' }
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
            startCreativeAgentTask: () => {
                agentStarts += 1;
                return { runId: `agent-${agentStarts}`, phase: 'running' };
            },
            getCreativeAgentTask: runId => ({ runId, phase: 'running' }),
            publicCreativeAgentTask: task => task
        });

        const context = { dataDir: fixture.dataDir, appConfig };
        const resumed = service.resumeRun(runId, {}, context);
        assert.strictEqual(resumed.success, true);

        const queuePath = path.join(fixture.dataDir, 'creative-target-queues.json');
        const queuedState = JSON.parse(fs.readFileSync(queuePath, 'utf8'));
        queuedState.queues[0].currentRunId = claimedRunId;
        queuedState.queues[0].currentIndex = 1;
        queuedState.queues[0].nextIndex = 1;
        queuedState.queues[0].lastRunId = claimedRunId;
        queuedState.queues[0].lastRunStatus = 'running';
        fs.writeFileSync(queuePath, JSON.stringify(queuedState, null, 2));

        await new Promise(resolve => setTimeout(resolve, 1300));

        const finalState = JSON.parse(fs.readFileSync(queuePath, 'utf8'));
        const queue = finalState.queues[0];
        assert.strictEqual(agentStarts, 0);
        assert.strictEqual(queue.status, 'running');
        assert.strictEqual(queue.currentRunId, claimedRunId);
        assert.deepStrictEqual(queue.failedRunIds, []);
        assert.strictEqual(queue.lastError || '', '');
    } finally {
        cleanupFixture(fixture);
    }
}

main()
    .then(() => console.log('creative auto duplicate queue advance tests passed'))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });
