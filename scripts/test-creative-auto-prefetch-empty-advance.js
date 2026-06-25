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
        `Theme: ${label}.`,
        'Scene content: a clear commercial game advertising image with a central character action, readable props, strong subject silhouette, and a visible story moment.',
        'Camera composition: medium shot, stable square composition, foreground props guide the eye to the main character, background context stays readable without covering the subject.',
        'Emotion and atmosphere: tense but hopeful, strong contrast between cold environmental light and warm highlight, polished high quality 3D cartoon rendering.',
        'Visual style: premium mobile game key art, cinematic lighting, clean details, 1:1 square image, no text overlay, no watermark.'
    ].join(' ');
}

async function main() {
    const fixture = makeTempCreativeFixture('creative-auto-prefetch-empty-advance-');
    try {
        const directions = defaultDirections().concat([
            {
                id: 'direction-3',
                path: 'Topic/Source/Direction Three',
                name: 'Direction Three',
                autoRun: true,
                priority: 70,
                stats: {}
            },
            {
                id: 'direction-4',
                path: 'Topic/Source/Direction Four',
                name: 'Direction Four',
                autoRun: true,
                priority: 60,
                stats: {}
            }
        ]);
        writeBaseKnowledge(fixture, directions);

        const queueId = 'creative_queue_prefetch_empty';
        const previousRunId = 'creative_run_previous_legil_done';
        const emptyPreparedRunId = 'creative_run_empty_prefetch';
        const emptyPreparedAt = '2026-06-17T12:23:31.000Z';
        const previousCompletedAt = '2026-06-17T12:32:47.000Z';
        const appConfig = {
            creative: {
                outputFolder: fixture.outputFolder,
                referenceFolder: fixture.referenceFolder,
                generationSettings: { outputQuantity: 1 },
                pipelinePrefetch: false
            }
        };
        const context = { dataDir: fixture.dataDir, appConfig };
        const targets = directions.map((direction, index) => ({
            targetId: `target-${index + 1}`,
            directionIds: [direction.id],
            sourceDirectionPath: direction.path,
            sourceMaterialName: `Target ${index + 1}`
        }));

        writeJson(path.join(fixture.dataDir, 'runs', `${previousRunId}.json`), {
            runId: previousRunId,
            mode: 'legil-run-once',
            agentOnly: false,
            status: 'completed',
            phase: 'legil_completed',
            createdAt: '2026-06-17T12:05:36.000Z',
            startedAt: '2026-06-17T12:05:36.000Z',
            completedAt: previousCompletedAt,
            updatedAt: previousCompletedAt,
            sourceDirection: directions[1],
            selection: { score: 90, reasons: ['test'] },
            config: { outputFolder: fixture.outputFolder, referenceFolder: fixture.referenceFolder, generationSettings: { outputQuantity: 1 } },
            schedulerState: { daily: { date: todayKey(), imageCount: 2, imageLimit: 1000 } },
            prompts: [makePrompt(1, {
                sourceDirectionId: 'direction-2',
                sourceDirectionPath: directions[1].path,
                prompt: completePrompt('Previous Direction Two'),
                finalPrompt: completePrompt('Previous Direction Two')
            })],
            promptTotal: 1,
            promptQualityReport: { rawPromptCount: 1, acceptedPromptCount: 1, rejectedPromptCount: 0 },
            legilResult: { success: true, successCount: 1, failedCount: 0, savedCount: 1 },
            targetQueue: { queueId, index: 2, total: 4 }
        });

        writeJson(path.join(fixture.dataDir, 'runs', `${emptyPreparedRunId}.json`), {
            runId: emptyPreparedRunId,
            mode: 'agent-only-prefetch',
            agentOnly: true,
            status: 'completed',
            phase: 'agent_completed',
            createdAt: '2026-06-17T12:19:23.000Z',
            startedAt: '2026-06-17T12:19:23.000Z',
            completedAt: emptyPreparedAt,
            updatedAt: emptyPreparedAt,
            sourceDirection: directions[2],
            selection: { score: 80, reasons: ['test'] },
            config: { outputFolder: fixture.outputFolder, referenceFolder: fixture.referenceFolder, generationSettings: { outputQuantity: 1 } },
            schedulerState: { daily: { date: todayKey(), imageCount: 2, imageLimit: 1000 } },
            prompts: [],
            promptTotalRaw: 16,
            promptTotal: 0,
            promptTotalRejected: 16,
            promptQualityReport: { rawPromptCount: 16, acceptedPromptCount: 0, rejectedPromptCount: 16 },
            message: 'Agent-only generated prompts, but Prompt Gate accepted 0 prompts',
            targetQueue: { queueId, index: 3, total: 4 }
        });

        writeJson(path.join(fixture.dataDir, 'creative-target-queues.json'), {
            version: 1,
            queues: [{
                queueId,
                status: 'completed',
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
                totalTargets: 4,
                totalExpectedPromptCount: 4,
                currentIndex: 1,
                nextIndex: 2,
                currentRunId: previousRunId,
                completedTargetIds: ['target-1', 'target-2'],
                completedRunIds: ['creative_run_first_legil_done', previousRunId],
                failedRunIds: [],
                nextPreparedRunId: emptyPreparedRunId,
                nextPrepareIndex: 2,
                nextPreparePhase: 'agent_completed',
                nextAction: 'prefetch_ready',
                startedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            }]
        });

        let agentCounter = 0;
        const legilStarts = [];
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
            startCreativeAgentTask: () => ({ runId: `agent-after-empty-${++agentCounter}`, phase: 'running' }),
            getCreativeAgentTask: runId => ({
                runId,
                phase: 'completed',
                result: {
                    prompts: [makePrompt(1, {
                        sourceDirectionId: 'direction-4',
                        sourceDirectionPath: directions[3].path,
                        direction: 'Recovered Direction Four',
                        newDirectionName: 'Recovered Direction Four',
                        prompt: completePrompt('Recovered Direction Four'),
                        finalPrompt: completePrompt('Recovered Direction Four')
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
        });

        const status = service.getStatus(context);
        assert.strictEqual(status.resumableRun.runId, previousRunId);
        assert.strictEqual(status.resumableRun.targetQueueProgress.status, 'paused');
        assert.strictEqual(status.resumableRun.targetQueueProgress.completedTargets, 2);

        const resumed = service.resumeRun(previousRunId, {}, context);
        assert.strictEqual(resumed.success, true);
        assert.notStrictEqual(resumed.targetQueue.status, 'completed');

        const queue = await waitFor(() => {
            const data = JSON.parse(fs.readFileSync(path.join(fixture.dataDir, 'creative-target-queues.json'), 'utf8'));
            const queue = data.queues[0];
            const skippedEmpty = queue.skippedTargetIds && queue.skippedTargetIds.includes('target-3');
            const startedFourth = queue.currentRunId && queue.currentRunId !== previousRunId && legilStarts.length === 1;
            return skippedEmpty && startedFourth ? queue : null;
        }, 9000);

        assert.strictEqual(queue.status, 'running');
        assert.deepStrictEqual(queue.completedTargetIds, ['target-1', 'target-2']);
        assert.ok(queue.skippedTargetIds.includes('target-3'));
        assert.strictEqual(queue.currentIndex, 3);
        assert.strictEqual(legilStarts.length, 1);
        assert.strictEqual(legilStarts[0].prompts.length, 1);
        assert.strictEqual(legilStarts[0].prompts[0].sourceDirectionPath, directions[3].path);
    } finally {
        cleanupFixture(fixture);
    }
}

main()
    .then(() => console.log('creative auto prefetch empty advance tests passed'))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });
