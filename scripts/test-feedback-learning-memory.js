const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createCreativeKnowledgeService } = require('../src/services/creative-knowledge');
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

function seedKnowledge(root) {
    const dataDir = path.join(root, 'data', 'creative-knowledge');
    fs.mkdirSync(path.join(dataDir, 'runs'), { recursive: true });

    const direction = {
        id: 'direction-survival-supply',
        path: '题材/探索发现/补给站',
        name: '补给站',
        primaryTag: '题材',
        secondaryTag: '探索发现',
        subTag: '补给站',
        description: '幸存者在冰封废墟中寻找补给和热源',
        autoRun: true,
        status: 'seed',
        priority: 80
    };

    writeJson(path.join(dataDir, 'metadata.json'), {
        version: 1,
        importedAt: '2026-05-27T00:00:00.000Z',
        counts: {
            directions: 1,
            topMaterials: 0,
            topMaterialInsights: 0,
            referenceImages: 0
        },
        warnings: []
    });
    writeJson(path.join(dataDir, 'directions.json'), {
        version: 1,
        directions: [direction]
    });
    writeJson(path.join(dataDir, 'top-material-insights.json'), { version: 1, insights: [] });
    writeJson(path.join(dataDir, 'reference-images.json'), { version: 1, images: [] });
    writeJson(path.join(dataDir, 'assets.json'), {
        version: 1,
        assets: [
            {
                assetId: 'asset-good-1',
                runId: 'run-feedback',
                directionId: direction.id,
                directionPath: direction.path,
                directionName: direction.name,
                promptHash: 'prompt-a',
                promptTitle: '门口热源',
                promptDirection: '补给站热源发现',
                prompt: '画面主体是幸存者在冰封补给站门口抢修热源灯，前景有清楚的手部动作和补给箱。',
                savedAt: '2026-05-27T01:00:00.000Z'
            },
            {
                assetId: 'asset-good-2',
                runId: 'run-feedback',
                directionId: direction.id,
                directionPath: direction.path,
                directionName: direction.name,
                promptHash: 'prompt-b',
                promptTitle: '仓库协作',
                promptDirection: '补给站仓库协作',
                prompt: '两个幸存者在雪地仓库入口搬运稀缺燃料，镜头能看清角色关系和资源冲突。',
                savedAt: '2026-05-27T01:02:00.000Z'
            },
            {
                assetId: 'asset-bad-1',
                runId: 'run-feedback',
                directionId: direction.id,
                directionPath: direction.path,
                directionName: direction.name,
                promptHash: 'prompt-c',
                promptTitle: '科幻面板',
                promptDirection: '补给站控制台',
                prompt: '画面出现大量蓝色科幻 UI 面板、悬浮屏幕和机械臂，人物动作不清楚。',
                savedAt: '2026-05-27T01:04:00.000Z'
            }
        ]
    });
    writeJson(path.join(dataDir, 'feedback.json'), {
        version: 1,
        updatedAt: '2026-05-27T01:10:00.000Z',
        feedback: [
            {
                feedbackId: 'feedback-good-1',
                assetId: 'asset-good-1',
                runId: 'run-feedback',
                directionId: direction.id,
                directionPath: direction.path,
                directionName: direction.name,
                promptHash: 'prompt-a',
                promptTitle: '门口热源',
                promptDirection: '补给站热源发现',
                status: 'good',
                labels: ['可以量产', '可以拓展'],
                note: '喜欢清楚的生存动作、热源灯和补给箱，缩略图也能看懂。',
                createdAt: '2026-05-27T01:06:00.000Z',
                updatedAt: '2026-05-27T01:06:00.000Z'
            },
            {
                feedbackId: 'feedback-good-2',
                assetId: 'asset-good-2',
                runId: 'run-feedback',
                directionId: direction.id,
                directionPath: direction.path,
                directionName: direction.name,
                promptHash: 'prompt-b',
                promptTitle: '仓库协作',
                promptDirection: '补给站仓库协作',
                status: 'good',
                labels: ['可以拓展'],
                note: '喜欢两人协作和稀缺资源冲突，画面行动关系明确。',
                createdAt: '2026-05-27T01:07:00.000Z',
                updatedAt: '2026-05-27T01:07:00.000Z'
            },
            {
                feedbackId: 'feedback-bad-1',
                assetId: 'asset-bad-1',
                runId: 'run-feedback',
                directionId: direction.id,
                directionPath: direction.path,
                directionName: direction.name,
                promptHash: 'prompt-c',
                promptTitle: '科幻面板',
                promptDirection: '补给站控制台',
                status: 'bad',
                labels: ['跑题', '过度科幻', '主体不清'],
                note: '不要大量科幻 UI 和悬浮屏幕，人物动作被道具淹没。',
                createdAt: '2026-05-27T01:08:00.000Z',
                updatedAt: '2026-05-27T01:08:00.000Z'
            },
            {
                feedbackId: 'feedback-direction-1',
                feedbackTargetType: 'direction-candidate',
                directionDraftId: 'draft-direction-supply-before-after',
                runId: 'run-feedback',
                directionId: direction.id,
                directionPath: direction.path,
                directionName: direction.name,
                sourceDirectionId: direction.id,
                sourceDirectionPath: direction.path,
                sourceDirectionName: direction.name,
                newDirectionName: 'supply before-after handoff',
                promptHash: 'prompt-direction-a',
                promptTitle: 'before after handoff',
                promptDirection: 'supply before-after handoff',
                prompt: 'survivors pass scarce fuel from a frozen gate into a warmer repair bay',
                targetLevel: 'node',
                dimensions: {
                    narrative: 'before-after handoff',
                    hook: 'clear before-after contrast',
                    subjectRelation: 'two survivors cooperate under resource pressure'
                },
                duplicateRisk: 'low because the hook changes narrative timing and subject relation',
                reason: 'candidate adds a before-after transition that siblings do not cover',
                original: 'supply door discovery',
                modified: 'supply before-after handoff with visible resource transfer',
                status: 'good',
                note: 'manual direction edit prefers before-after hooks and visible handoff actions for this node',
                createdAt: '2026-05-27T01:09:00.000Z',
                updatedAt: '2026-05-27T01:09:00.000Z'
            }
        ]
    });
    writeJson(path.join(dataDir, 'scheduler-state.json'), {
        version: 1,
        status: 'idle',
        consecutiveFailures: 0,
        daily: {
            date: todayKey(),
            imageCount: 0,
            imageLimit: 1000
        }
    });

    return { dataDir, direction };
}

async function runFeedbackLearningTest() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'creative-s6-feedback-'));
    try {
        const { dataDir, direction } = seedKnowledge(root);
        let learningRequest = null;
        const knowledgeService = createCreativeKnowledgeService({
            rootDir: root,
            logger: { info() {}, error() {} },
            feedbackLearningClient: async request => {
                learningRequest = request;
                return {
                    learningReport: {
                        title: '本轮反馈学习报告',
                        summary: '好图集中在清楚的生存动作、热源、补给箱和资源冲突；坏图主要是过度科幻 UI 抢走主体。',
                        positiveFindings: ['清楚的手部动作和补给箱容易形成可读点击点', '两人协作加稀缺资源冲突更像可复用方向'],
                        negativeFindings: ['大量蓝色科幻 UI、悬浮屏幕和机械臂会跑题'],
                        nextRunAdvice: ['下一轮保留生存动作和资源冲突', '避开默认科幻 UI 面板']
                    },
                    ruleDrafts: [
                        {
                            scope: 'global',
                            type: 'preferred',
                            target: '',
                            title: '强化清楚的生存动作',
                            pattern: '优先生成能一眼看懂的生存动作，前景保留手部动作、补给箱、热源灯等明确道具。',
                            rationale: '两条好图反馈都强调动作清楚和缩略图可读。',
                            action: '拓展方向时把主体动作写成具体动词，并让关键资源在前景或中景可见。',
                            confidence: 0.84,
                            evidence: ['feedback-good-1 喜欢热源灯和补给箱', 'feedback-good-2 喜欢两人协作'],
                            sourceFeedbackIds: ['feedback-good-1', 'feedback-good-2']
                        },
                        {
                            scope: 'global',
                            type: 'avoid',
                            target: '',
                            title: '避开过度科幻 UI',
                            pattern: '不要默认加入蓝色科幻 UI、大量悬浮屏幕、机械臂或控制台面板。',
                            rationale: '坏图反馈明确指出这些元素让画面跑题并遮挡主体。',
                            action: 'Prompt 中用实体道具和环境压力表达危机，不用界面元素表达信息。',
                            confidence: 0.9,
                            evidence: ['feedback-bad-1 标记过度科幻和主体不清'],
                            sourceFeedbackIds: ['feedback-bad-1']
                        },
                        {
                            scope: 'dimension',
                            type: 'preferred',
                            target: 'hook',
                            title: 'Prefer before-after handoff hooks',
                            pattern: 'When expanding a direction candidate, prefer before-after hooks with visible handoff actions over static discovery names.',
                            rationale: 'feedback-direction-1 shows a manual edit from a static supply-door discovery into a before-after handoff with visible resource transfer.',
                            action: 'For the hook dimension, add a visible before/after state change and a handoff action when the source node supports it.',
                            confidence: 0.82,
                            evidence: ['feedback-direction-1 modified the candidate toward before-after handoff'],
                            sourceFeedbackIds: ['feedback-direction-1']
                        },
                        {
                            scope: 'node',
                            type: 'priority',
                            target: direction.id,
                            title: '补给站方向优先做资源冲突',
                            pattern: '补给站方向下优先拓展热源、燃料、补给箱、入口争夺等资源冲突。',
                            rationale: '好图都围绕补给资源和协作关系，坏图偏离到控制台。',
                            action: '选择补给站方向时，提高资源冲突类 prompt 的优先级。',
                            confidence: 0.78,
                            evidence: ['feedback-good-1', 'feedback-good-2', 'feedback-bad-1'],
                            sourceFeedbackIds: ['feedback-good-1', 'feedback-good-2', 'feedback-bad-1']
                        }
                    ]
                };
            }
        });

        const learned = await knowledgeService.learnFromFeedback({ limit: 20 });
        assert.strictEqual(learned.success, true);
        assert.ok(learningRequest, 'Feedback Learning Agent should be called');
        assert.strictEqual(learningRequest.agentName, 'Feedback Learning Agent');
        assert.ok(learningRequest.messages[1].content.includes('asset-good-1'));
        assert.ok(learningRequest.messages[1].content.includes('feedback-direction-1'));
        assert.ok(learningRequest.messages[1].content.includes('direction-candidate'));
        assert.ok(learningRequest.messages[1].content.includes('before-after handoff'));
        assert.strictEqual(learned.drafts.length, 4);
        assert.strictEqual(learned.memory.draftRules.length, 4);
        assert.strictEqual(learned.memory.activeRules.length, 0);
        assert.strictEqual(learned.report.draftRuleCount, 4);

        const savedDraft = learned.memory.draftRules[0];
        const updated = knowledgeService.updateMemoryRule(savedDraft.ruleId, {
            title: '强化清楚的生存动作和关键道具'
        });
        assert.strictEqual(updated.success, true);
        assert.strictEqual(updated.rule.title, '强化清楚的生存动作和关键道具');

        const acceptedPreferred = knowledgeService.acceptMemoryRule(savedDraft.ruleId);
        assert.strictEqual(acceptedPreferred.success, true);
        assert.strictEqual(acceptedPreferred.rule.status, 'active');
        assert.strictEqual(acceptedPreferred.memory.activeRules.length, 1);
        assert.strictEqual(acceptedPreferred.memory.preferred_patterns.length, 1);
        assert.strictEqual(acceptedPreferred.memory.draftRules.length, 3);

        const rejected = knowledgeService.rejectMemoryRule(learned.memory.draftRules[1].ruleId, {
            reason: '测试拒绝'
        });
        assert.strictEqual(rejected.success, true);
        assert.strictEqual(rejected.rule.status, 'rejected');
        assert.strictEqual(rejected.memory.rejectedRules.length, 1);

        const acceptedDimension = knowledgeService.acceptMemoryRule(learned.memory.draftRules[2].ruleId);
        assert.strictEqual(acceptedDimension.success, true);
        assert.strictEqual(acceptedDimension.rule.scope, 'dimension');
        assert.strictEqual(acceptedDimension.rule.target, 'hook');
        assert.strictEqual(acceptedDimension.memory.activeRules.length, 2);

        const acceptedNode = knowledgeService.acceptMemoryRule(learned.memory.draftRules[3].ruleId);
        assert.strictEqual(acceptedNode.success, true);
        assert.strictEqual(acceptedNode.memory.activeRules.length, 3);

        const disabled = knowledgeService.disableMemoryRule(savedDraft.ruleId, {
            reason: '测试禁用'
        });
        assert.strictEqual(disabled.success, true);
        assert.strictEqual(disabled.rule.status, 'disabled');
        assert.strictEqual(disabled.memory.activeRules.length, 2);
        assert.strictEqual(disabled.memory.disabledRules.length, 1);

        const persistedMemory = JSON.parse(fs.readFileSync(path.join(dataDir, 'creative-memory.json'), 'utf8'));
        assert.strictEqual(persistedMemory.rules.node[direction.id].length, 1);
        assert.strictEqual(persistedMemory.rules.dimension.hook.length, 1);
        assert.strictEqual(persistedMemory.rules.global[0].status, 'disabled');

        const task = {
            runId: 'agent-task-s6',
            phase: 'completed',
            result: {
                prompts: [{
                    index: 1,
                    direction: '补给站资源冲突',
                    promptTitle: '热源争夺',
                    prompt: '幸存者在补给站入口争夺热源和燃料，动作清楚。',
                    selected: true
                }]
            },
            message: 'done'
        };
        const autoService = createCreativeAutoService({
            rootDir: root,
            logger: { info() {}, error() {} },
            getStoredWinkyConfig: () => ({
                apiUrl: 'https://example.invalid',
                apiKey: 'test-key',
                model: 'test-model'
            }),
            hasActiveCreativeAgentTask: () => false,
            isLegilBusy: () => false,
            startCreativeAgentTask: request => ({ ...task, instructionPreview: request.instruction }),
            getCreativeAgentTask: () => task,
            publicCreativeAgentTask: (currentTask, includeResult) => ({
                ...currentTask,
                result: includeResult ? currentTask.result : undefined
            }),
            promptTranslatorClient: async () => ({
                prompts: [{
                    index: 1,
                    promptTitle: '热源争夺',
                    sourceDirectionId: direction.id,
                    newDirectionName: '补给站资源冲突',
                    subject: '补给站入口的幸存者',
                    action: '两名幸存者争夺热源和燃料',
                    scene: '冰封补给站入口',
                    camera: '中景，动作关系清楚',
                    lighting: '冷蓝雪光和小面积暖光对比',
                    visualStyle: '高质量 3D 卡通广告图',
                    textRule: '只允许短中文关键词',
                    mustKeep: ['补给站', '资源冲突'],
                    mustAvoid: ['科幻 UI'],
                    finalPrompt: '主题：补给站入口的幸存者。画面动作：两名幸存者争夺热源和燃料，前景能看到补给箱和手部动作。场景：冰封补给站入口，雪地脚印和仓库门形成路径。镜头：中景，动作关系清楚。光线：冷蓝雪光和小面积暖光对比。画风：高质量 3D 卡通广告图。文字规则：只允许短中文关键词。画面要求：1:1 方图，主体清楚，适合直接生图。'
                }]
            })
        });

        const started = autoService.runOnce({ agentOnly: true, maxPrompts: 1 }, {
            dataDir,
            appConfig: {
                creative: {
                    outputFolder: path.join(root, 'output'),
                    referenceFolder: path.join(root, 'references'),
                    browserMode: 'headed',
                    generationSettings: {
                        imageModel: 'nano-banana-2',
                        aspectRatio: '1:1',
                        resolution: '2K',
                        outputQuantity: 4
                    }
                }
            }
        });
        assert.strictEqual(started.success, true);
        assert.ok(started.run.instruction.includes('Prefer before-after handoff hooks'));
        assert.ok(started.run.instruction.includes('已确认反馈学习规则'));
        assert.ok(started.run.instruction.includes('补给站方向优先做资源冲突'));
        assert.ok(!started.run.instruction.includes('强化清楚的生存动作和关键道具'), 'disabled rules should not be injected');
        assert.strictEqual(started.run.memoryRules.length, 2);

        console.log('S6 feedback learning memory tests passed');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

runFeedbackLearningTest().catch(error => {
    console.error(error);
    process.exit(1);
});
