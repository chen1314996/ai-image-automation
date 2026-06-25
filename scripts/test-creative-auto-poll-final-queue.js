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

function createService(fixture) {
    let agentCounter = 0;
    let saveCounter = 0;
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
        startCreativeAgentTask: () => ({ runId: `agent-${++agentCounter}`, phase: 'running' }),
        getCreativeAgentTask: runId => ({
            runId,
            phase: 'completed',
            result: { prompts: [makePrompt(1, { sourceDirectionId: 'direction-2', sourceDirectionPath: 'Topic/Source/Direction Two' })] }
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
            saveCounter += 1;
            const savedFile = path.join(fixture.outputFolder, `poll-final-${saveCounter}.png`);
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
                    savedFiles: [{ filePath: savedFile, promptListIndex: 1, imageIndex: 1, savedAt: new Date().toISOString() }],
                    promptResults: [],
                    failedPromptResults: [],
                    currentAction: 'completed'
                }
            };
        }
    });
}

async function main() {
    const fixture = makeTempCreativeFixture('creative-auto-poll-final-');
    try {
        const directions = defaultDirections();
        writeBaseKnowledge(fixture, directions);
        const runId = 'creative_run_poll_final_queue';
        const queueId = 'creative_queue_poll_final';
        const appConfig = { creative: { outputFolder: fixture.outputFolder, referenceFolder: fixture.referenceFolder, generationSettings: { outputQuantity: 1 }, pipelinePrefetch: false } };

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
            prompts: [makePrompt(1)],
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

        const service = createService(fixture);
        const started = service.continueRunToLegil(runId, {}, { dataDir: fixture.dataDir, appConfig });
        assert.strictEqual(started.success, true);

        const queue = await waitFor(() => {
            const data = JSON.parse(fs.readFileSync(path.join(fixture.dataDir, 'creative-target-queues.json'), 'utf8'));
            const queue = data.queues[0];
            return queue.currentIndex >= 1 && queue.completedTargetIds.includes('target-1') ? queue : null;
        }, 5000);
        assert.ok(queue.completedTargetIds.includes('target-1'));
        assert.ok(queue.nextIndex >= 1);
        const firstRun = JSON.parse(fs.readFileSync(path.join(fixture.dataDir, 'runs', `${runId}.json`), 'utf8'));
        assert.strictEqual(firstRun.status, 'completed');
        assert.strictEqual(firstRun.phase, 'legil_completed');
        await new Promise(resolve => setTimeout(resolve, 1200));
    } finally {
        cleanupFixture(fixture);
    }
}

main()
    .then(() => console.log('creative auto poll final queue tests passed'))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });
