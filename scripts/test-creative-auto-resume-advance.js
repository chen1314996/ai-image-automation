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

function createFastService(fixture, hooks = {}) {
    let agentCounter = 0;
    const savedFile = path.join(fixture.outputFolder, 'advance-next-target.png');
    return createCreativeAutoService({
        rootDir: fixture.root,
        logger: { info() {}, warn() {}, error() {} },
        legilProgressPollMs: 50,
        legilProgressMaxWaitMs: 800,
        isLegilBusy: () => false,
        getStoredWinkyConfig: () => ({
            apiKey: 'test-key',
            apiUrl: 'https://winky.test/v1',
            model: 'test-model',
            provider: 'test'
        }),
        startCreativeAgentTask: payload => {
            if (Array.isArray(hooks.agentPayloads)) {
                hooks.agentPayloads.push(payload);
            }
            return { runId: `agent-${++agentCounter}`, phase: 'running' };
        },
        getCreativeAgentTask: runId => ({
            runId,
            phase: 'completed',
            result: {
                prompts: [makePrompt(1, { sourceDirectionId: 'direction-2', sourceDirectionPath: 'Topic/Source/Direction Two' })]
            }
        }),
        publicCreativeAgentTask: task => task,
        startLegilCreativeBatch: async payload => ({
            success: true,
            message: 'started',
            totalPrompts: payload.prompts.length,
            outputTotal: 1,
            progress: { taskType: 'creative-batch', phase: 'queued', total: payload.prompts.length }
        }),
        getLegilCreativeProgress: async () => {
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
                    savedFiles: [{
                        filePath: savedFile,
                        promptListIndex: 1,
                        imageIndex: 1,
                        savedAt: new Date().toISOString()
                    }],
                    promptResults: [],
                    failedPromptResults: [],
                    currentAction: 'completed'
                }
            };
        }
    });
}

async function main() {
    const fixture = makeTempCreativeFixture('creative-auto-resume-advance-');
    try {
        const directions = defaultDirections();
        writeBaseKnowledge(fixture, directions);

        const runId = 'creative_run_resume_advance';
        const queueId = 'creative_queue_resume_advance';
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
                status: 'paused',
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
                context: { appConfig: { creative: { outputFolder: fixture.outputFolder, referenceFolder: fixture.referenceFolder, generationSettings: { outputQuantity: 1 } } } },
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
                lastRunStatus: 'paused',
                lastRunPhase: 'legil_paused',
                startedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            }]
        });

        const agentPayloads = [];
        const service = createFastService(fixture, { agentPayloads });
        const context = { dataDir: fixture.dataDir, appConfig: { creative: { outputFolder: fixture.outputFolder, referenceFolder: fixture.referenceFolder, generationSettings: { outputQuantity: 1 } } } };
        const status = service.getStatus(context);
        assert.strictEqual(status.resumableRun.runId, runId);
        assert.strictEqual(status.resumableRun.targetQueueProgress.nextAction, 'advance_next_target');

        const resumed = service.resumeRun(runId, {}, context);
        assert.strictEqual(resumed.success, true);
        assert.strictEqual(resumed.targetQueue.status, 'running');
        assert.strictEqual(resumed.targetQueue.currentIndex, 2);

        const queueData = JSON.parse(fs.readFileSync(path.join(fixture.dataDir, 'creative-target-queues.json'), 'utf8'));
        const queue = queueData.queues[0];
        assert.strictEqual(queue.status, 'running');
        assert.strictEqual(queue.currentIndex, 1);
        assert.strictEqual(queue.nextIndex, 1);
        assert.deepStrictEqual(queue.completedTargetIds, ['target-1']);
        assert.ok(queue.completedRunIds.includes(runId));
        await new Promise(resolve => setTimeout(resolve, 1200));

        assert.strictEqual(agentPayloads.length, 1);
        assert.ok(agentPayloads[0].instruction.includes(directions[1].path));
        assert.ok(!agentPayloads[0].instruction.includes(directions[0].path));
        assert.ok(!agentPayloads[0].instruction.includes('2 个目标'));
    } finally {
        cleanupFixture(fixture);
    }
}

main()
    .then(() => console.log('creative auto resume advance tests passed'))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });
