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

async function main() {
    const fixture = makeTempCreativeFixture('creative-auto-policy-block-');
    try {
        const directions = defaultDirections();
        writeBaseKnowledge(fixture, directions);

        const runId = 'creative_run_policy_previous';
        const queueId = 'creative_queue_policy_block';
        const appConfig = {
            creative: {
                outputFolder: fixture.outputFolder,
                referenceFolder: fixture.referenceFolder,
                generationSettings: { outputQuantity: 1 },
                pipelinePrefetch: false
            }
        };
        const context = { dataDir: fixture.dataDir, appConfig };

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
            config: { outputFolder: fixture.outputFolder, referenceFolder: fixture.referenceFolder, generationSettings: { outputQuantity: 1 } },
            schedulerState: { daily: { date: todayKey(), imageCount: 1, imageLimit: 1000 } },
            prompts: [makePrompt(1)],
            promptTotal: 1,
            promptQualityReport: { rawPromptCount: 1, acceptedPromptCount: 1, rejectedPromptCount: 0 },
            legilResult: { success: true, successCount: 1, failedCount: 0, savedCount: 1 },
            targetQueue: { queueId, index: 1, total: 2 }
        });

        writeJson(path.join(fixture.dataDir, 'creative-target-queues.json'), {
            version: 1,
            queues: [{
                queueId,
                status: 'paused',
                originalPayload: {
                    fullScale: false,
                    maxPrompts: 1,
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
            canPerformAction: () => ({
                allowed: false,
                action: 'start_loop',
                reason: 'Start Loop requires L3; current level is L2.',
                reasonCode: 'level_too_low',
                requiredLevel: 'L3',
                currentLevel: 'L2'
            })
        });

        const resumed = service.resumeRun(runId, {}, context);
        assert.strictEqual(resumed.success, true);

        const queue = await waitFor(() => {
            const data = JSON.parse(fs.readFileSync(path.join(fixture.dataDir, 'creative-target-queues.json'), 'utf8'));
            const queue = data.queues[0];
            return queue.nextAction === 'policy_blocked' ? queue : null;
        }, 5000);

        assert.strictEqual(queue.status, 'paused');
        assert.strictEqual(queue.currentRunId, runId);
        assert.strictEqual(queue.lastError, 'Start Loop requires L3; current level is L2.');
        assert.strictEqual(queue.lastPolicyBlock.reasonCode, 'level_too_low');

        const status = service.getStatus(context);
        assert.strictEqual(status.targetQueue.status, 'paused');
        assert.strictEqual(status.targetQueue.nextAction, 'advance_next_target');
        assert.strictEqual(status.resumableRun.runId, runId);
    } finally {
        cleanupFixture(fixture);
    }
}

main()
    .then(() => console.log('creative auto policy block pause tests passed'))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });
