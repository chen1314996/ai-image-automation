const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createCreativeAutoService } = require('../src/services/creative-auto');
const { createCreativeKnowledgeService } = require('../src/services/creative-knowledge');
const {
    cleanupFixture,
    makeTempCreativeFixture,
    waitFor,
    writeBaseKnowledge
} = require('./creative-auto-test-utils');

function buildDirectionPlans() {
    return [
        {
            sourceDirectionPath: 'Topic/Source/Direction One',
            extensions: [
                {
                    extensionKey: 'candidate-a',
                    extensionType: 'candidate',
                    name: 'Rescue crate handoff',
                    description: 'Survivors pass a glowing rescue crate through a blocked street during evacuation.',
                    visualHook: 'Foreground rescue crate, human handoff, blocked street, distant shelter light.',
                    dedupeReason: 'Different from static supply display by using handoff action and route pressure.',
                    riskNote: 'Avoid readable brand marks and tiny UI text.',
                    productionAdvice: 'Use a close foreground crate and clear human action.'
                },
                {
                    extensionKey: 'candidate-b',
                    extensionType: 'candidate',
                    name: 'Frozen shelter signal',
                    description: 'A team discovers a signal lamp outside a frozen shelter entrance.',
                    visualHook: 'Signal lamp, shelter door, snow trail, searching team.',
                    dedupeReason: 'Focuses on discovery rather than transport.',
                    riskNote: 'Keep the lamp fictional and avoid logo text.',
                    productionAdvice: 'Make the signal lamp the brightest point.'
                }
            ]
        }
    ];
}

function buildPromptPlans() {
    return {
        directionPlans: [
            {
                sourceDirectionPath: 'Topic/Source/Direction One',
                extensions: [
                    {
                        extensionKey: 'candidate-a',
                        extensionType: 'manual-reviewed',
                        name: 'Edited rescue crate handoff',
                        description: 'Edited direction after human review.',
                        visualHook: 'Foreground glowing rescue crate with handoff action.',
                        dedupeReason: 'Human reviewed direction.',
                        riskNote: 'Avoid text clutter.',
                        productionAdvice: 'Keep the crate readable.',
                        directionTags: ['救援箱', '交接动作', '暖光目标'],
                        mainTags: ['救援箱', '交接动作'],
                        extraTags: ['暖光目标'],
                        riskTags: ['文字干扰'],
                        promptPair: [
                            {
                                title: 'Edited prompt',
                                prompt: '冰封街道中幸存者把发光救援箱交接给前方队友，近景救援箱和手部交接动作清晰，远处避难所暖光目标形成希望焦点，高质量3D卡通商业游戏海报风格。'
                            }
                        ]
                    }
                ]
            }
        ]
    };
}

async function main() {
    const fixture = makeTempCreativeFixture('creative-direction-review-');
    writeBaseKnowledge(fixture);

    const task = {
        runId: 'agent-task-review',
        phase: 'completed',
        result: {
            prompts: [],
            directionPlans: buildDirectionPlans(),
            directionPlanCount: 1,
            rawText: JSON.stringify({ directionPlans: buildDirectionPlans() })
        },
        message: 'done'
    };
    const axiosCalls = [];
    const service = createCreativeAutoService({
        rootDir: fixture.root,
        dataDir: fixture.dataDir,
        logger: { info() {}, warn() {}, error() {} },
        getStoredWinkyConfig: () => ({
            apiUrl: 'https://winky.example.test/v1/chat/completions',
            apiKey: 'test-key',
            model: 'test-model',
            provider: 'test-provider'
        }),
        hasActiveCreativeAgentTask: () => false,
        isLegilBusy: () => false,
        startCreativeAgentTask: () => task,
        getCreativeAgentTask: () => task,
        publicCreativeAgentTask: value => value,
        axios: {
            async post(url, payload, requestOptions) {
                axiosCalls.push({ url, payload, requestOptions });
                return {
                    data: {
                        choices: [{
                            message: {
                                content: JSON.stringify(buildPromptPlans())
                            }
                        }]
                    }
                };
            }
        }
    });

    try {
        const started = service.runOnce({
            agentOnly: true,
            directionId: 'direction-1',
            maxPrompts: 4,
            directionPlanning: {
                reviewMode: 'manual',
                candidateExtensionsPerSource: 2,
                selectedExtensionsPerSource: 1,
                promptsPerExtension: 1,
                minScore: 1,
                maxRepairAttempts: 0
            }
        }, { appConfig: {} });
        assert.strictEqual(started.success, true);

        let paused = null;
        try {
            paused = await waitFor(() => {
                const run = service.getRun(started.run.runId, { appConfig: {} });
                return run && run.phase === 'pending_direction_review' ? run : null;
            }, 10000);
        } catch (error) {
            const latest = service.getRun(started.run.runId, { appConfig: {} });
            console.error('latest run while waiting for direction review:', JSON.stringify({
                status: latest && latest.status,
                phase: latest && latest.phase,
                message: latest && latest.message,
                directionReviewMode: latest && latest.directionReviewMode,
                directionCandidateReview: latest && latest.directionCandidateReview,
                promptTotal: latest && latest.promptTotal
            }, null, 2));
            throw error;
        }
        assert.strictEqual(paused.status, 'paused');
        assert.strictEqual(paused.promptTotal, 0);
        assert.strictEqual(paused.directionCandidateReview.status, 'pending');
        assert.strictEqual(paused.directionCandidateReview.selected.length, 1);
        assert.strictEqual(paused.directionCandidateReview.rejected.length, 1);

        const reviewKey = paused.directionCandidateReview.selected[0].reviewKey;
        const editedCandidate = {
            reviewKey,
            name: 'Edited rescue crate handoff',
            description: 'Edited direction after human review.',
            mainTags: ['救援箱', '交接动作'],
            extraTags: ['暖光目标'],
            riskTags: ['文字干扰'],
            visualHook: 'Foreground glowing rescue crate with handoff action.',
            dimensions: {
                atmosphere: 'tense crisis',
                camera: 'first person',
                event: 'handoff',
                visualHook: 'glowing rescue crate'
            },
            avoidRules: ['avoid text clutter']
        };
        const continued = service.continueRunFromDirectionReview(paused.runId, {
            promptOnly: true,
            candidates: [editedCandidate, {
                reviewKey: paused.directionCandidateReview.rejected[0].reviewKey,
                name: 'Deleted frozen shelter signal',
                description: 'Deleted by human review.',
                status: 'deleted',
                mainTags: ['信号灯'],
                extraTags: ['入口目标']
            }]
        }, { appConfig: {} });
        assert.strictEqual(continued.success, true);

        const completed = await waitFor(() => {
            const run = service.getRun(paused.runId, { appConfig: {} });
            return run && run.status === 'completed' && run.phase === 'agent_completed' ? run : null;
        });
        assert.strictEqual(axiosCalls.length, 1);
        assert.strictEqual(completed.agentOnly, true);
        assert.strictEqual(completed.directionCandidateReview.status, 'approved');
        assert.strictEqual(completed.directionCandidateReview.selected[0].name, 'Edited rescue crate handoff');
        assert.strictEqual(completed.directionCandidateReview.selected.length, 1);
        assert.strictEqual(completed.directionPlanReport.selectedExtensionCount, 1);
        assert.strictEqual(completed.promptTotal, 1);
        assert.ok(completed.prompts[0].prompt.includes('救援箱'));
        assert.ok(completed.prompts[0].directionTags.includes('救援箱'));
        assert.ok(completed.prompts[0].mainTags.includes('交接动作'));
        assert.ok(completed.prompts[0].visualHook.includes('glowing rescue crate'));
        const requestText = JSON.stringify(axiosCalls[0].payload.messages);
        assert.ok(requestText.includes('救援箱'));
        assert.ok(requestText.includes('交接动作'));
        assert.ok(requestText.includes('文字干扰'));

        const knowledgeService = createCreativeKnowledgeService({
            rootDir: fixture.root,
            dataDir: fixture.dataDir
        });
        const draftResult = knowledgeService.extractDirectionDraftsFromRun(paused.runId, {
            candidateKey: reviewKey,
            candidates: [editedCandidate]
        }, {});
        assert.strictEqual(draftResult.success, true);
        const draftData = JSON.parse(fs.readFileSync(path.join(fixture.dataDir, 'direction-drafts.json'), 'utf8'));
        assert.strictEqual(draftData.drafts.length, 1);
        assert.ok(draftData.drafts[0].directionTags.includes('救援箱'));
        assert.ok(draftData.drafts[0].mainTags.includes('交接动作'));
        assert.ok(draftData.drafts[0].riskTags.includes('文字干扰'));
        console.log('creative auto direction review tests passed');
    } finally {
        cleanupFixture(fixture);
    }
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
