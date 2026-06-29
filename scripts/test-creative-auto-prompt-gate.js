const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { CreativeKnowledgeStore } = require('../src/services/creative-knowledge/store');
const {
    applyPromptGate,
    buildForbiddenTerms,
    findForbiddenTerm
} = require('../src/services/creative-auto/prompt-gate');

function createPrompt(subject, extra = '') {
    return `主题：${subject}。画风：高质量3D卡通渲染。情绪氛围：紧张、明确、有求生希望。画面内容：幸存者在冰封废墟中围绕关键资源展开行动，前景有清楚的手部动作和道具，中景有人物关系，远景有被风雪吞没的旧文明建筑。整体基调：冷蓝雪景与局部暖光对比，方图中心稳定，缩略图下也能看懂广告点击点。${extra}冰雪氛围，画面直观、主题明确，高质量3D卡通渲染，商业级游戏宣传海报风格，电影镜头感。`;
}

function runPromptGateTest() {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'creative-auto-gate-'));
    const store = new CreativeKnowledgeStore(tempDir);
    store.ensureBase();

    const promptA = createPrompt('冰封补给站门口幸存者抢修热源灯');
    const historicalPrompt = createPrompt('雪地仓库外幸存者搬运稀缺燃料');
    const promptB = createPrompt('废弃地铁入口幸存者沿短标语撤离');
    const promptC = createPrompt('暴风雪高台上队伍发现避难所灯光');

    store.write('runs/history.json', {
        runId: 'history',
        sourceDirection: {
            id: 'direction-1',
            path: 'topic/explore/supply-station'
        },
        directionDefinitions: [
            {
                sourceDirectionId: 'direction-1',
                newDirectionName: 'Warehouse Fuel'
            }
        ],
        prompts: [
            {
                prompt: historicalPrompt
            }
        ]
    });
    store.write('assets.json', {
        version: 1,
        assets: [
            {
                prompt: createPrompt('旧营地门口幸存者围绕火堆分配物资')
            }
        ]
    });

    const selected = {
        direction: {
            id: 'direction-1',
            path: '题材/探索发现/补给站',
            mustAvoid: '机甲、真实品牌'
        }
    };
    const quota = {
        usedImagesToday: 990,
        maxImagesPerDay: 1000,
        remainingImagesToday: 10,
        outputQuantity: 4,
        maxPrompts: 2
    };
    const prompts = [
        { index: 1, direction: '补给站热源', promptTitle: '提示词1', prompt: promptA },
        { index: 2, direction: '补给站热源', promptTitle: '提示词2', prompt: promptA },
        { index: 3, direction: '机甲救援', promptTitle: '提示词1', prompt: createPrompt('冰原上出现机甲救援队') },
        { index: 4, direction: '仓库燃料', promptTitle: '提示词1', prompt: historicalPrompt },
        { index: 5, direction: '地铁撤离', promptTitle: '提示词1', prompt: promptB },
        { index: 6, direction: '高台灯光', promptTitle: '提示词1', prompt: promptC }
    ];

    try {
        const mixedAdviceTerms = buildForbiddenTerms({
            direction: {
                mustAvoid: [
                    '\u4fdd\u7559\uff1a\u51b0\u96ea\u672b\u65e5\u6c1b\u56f4\u3001\u5e9e\u5927\u5de5\u4e1a\u5efa\u7b51\u3002',
                    '\u8fed\u4ee3\uff1a\u5821\u5792\u5916\u89c2\u4e0e\u7ec6\u8282\u3001\u5929\u6c14\u4e0e\u65f6\u95f4\u53d8\u5316\u3002',
                    '\u6ce8\u610f\uff1a\u753b\u9762\u627f\u8bfa\u4e0e\u5b9e\u9645\u73a9\u6cd5\u843d\u5dee\u5927\u3001\u60c5\u611f\u5171\u9e23\u4e0d\u8db3\u3002',
                    '\u6295\u653e\u52a8\u4f5c\uff1a\u51cf\u5c11\u91cd\u590d\u6295\u653e\u3002'
                ].join('')
            }
        });
        assert.ok(!mixedAdviceTerms.includes('\u4fdd\u7559\uff1a\u51b0\u96ea\u672b\u65e5\u6c1b\u56f4'));
        assert.ok(!mixedAdviceTerms.includes('\u51b0\u96ea\u672b\u65e5\u6c1b\u56f4'));
        assert.ok(!mixedAdviceTerms.includes('\u5e9e\u5927\u5de5\u4e1a\u5efa\u7b51\u3002\u8fed\u4ee3\uff1a\u5821\u5792\u5916\u89c2\u4e0e\u7ec6\u8282'));
        assert.ok(mixedAdviceTerms.includes('\u753b\u9762\u627f\u8bfa\u4e0e\u5b9e\u9645\u73a9\u6cd5\u843d\u5dee\u5927'));
        assert.ok(mixedAdviceTerms.includes('\u60c5\u611f\u5171\u9e23\u4e0d\u8db3'));
        assert.strictEqual(findForbiddenTerm(
            '\u753b\u9762\u6709\u7d27\u5f20\u51b2\u7a81\u548c\u5371\u673a\u611f\uff0c\u4f46\u6ca1\u6709\u771f\u5b9e\u54c1\u724c',
            ['\u51b2\u7a81', '\u51b2\u7a81\u70b9', '\u5371\u673a\u611f']
        ), '');
        assert.strictEqual(findForbiddenTerm(
            '\u753b\u9762\u6709\u7d27\u5f20\u51b2\u7a81\u548c\u5371\u673a\u611f\uff0c\u4f46\u6ca1\u6709\u771f\u5b9e\u54c1\u724c',
            ['\u51b2\u7a81', '\u771f\u5b9e\u54c1\u724c']
        ), '\u771f\u5b9e\u54c1\u724c');

        const gate = applyPromptGate({
            prompts,
            selected,
            quota,
            store,
            runId: 'current-run',
            payload: {
                forbiddenRules: ['大面积英文']
            },
            config: {}
        });

        assert.strictEqual(gate.prompts.length, 2);
        assert.strictEqual(gate.prompts[0].index, 1);
        assert.strictEqual(gate.prompts[0].originalIndex, 1);
        assert.strictEqual(gate.prompts[1].originalIndex, 5);
        assert.ok(gate.prompts[0].promptHash);
        assert.strictEqual(gate.qualityReport.success, true);

        const report = gate.promptQualityReport;
        assert.strictEqual(report.rawPromptCount, 6);
        assert.strictEqual(report.acceptedPromptCount, 2);
        assert.strictEqual(report.rejectedPromptCount, 4);
        assert.strictEqual(report.expectedImageTotal, 8);
        assert.strictEqual(report.dailyRemainingBeforeRun, 10);
        assert.strictEqual(report.outputQuantity, 4);
        assert.strictEqual(report.maxPromptsAllowed, 2);
        assert.strictEqual(report.rejectionSummary.duplicate_current_prompt, 1);
        assert.strictEqual(report.rejectionSummary.forbidden_term, 1);
        assert.strictEqual(report.rejectionSummary.duplicate_history_prompt, 1);
        assert.strictEqual(report.rejectionSummary.quota_limit, 1);
        assert.ok(report.forbiddenTerms.includes('机甲'));
        assert.ok(report.historyPromptKeyCount >= 2);
        assert.ok(report.historyDirectionKeyCount >= 1);

        const directionDuplicateGate = applyPromptGate({
            prompts: [
                {
                    index: 1,
                    direction: 'Warehouse Fuel',
                    newDirectionName: 'Warehouse Fuel',
                    promptTitle: 'Fresh Angle',
                    prompt: createPrompt('different warehouse fuel rescue scene')
                }
            ],
            selected,
            quota: {
                usedImagesToday: 0,
                maxImagesPerDay: null,
                remainingImagesToday: Number.MAX_SAFE_INTEGER,
                unlimitedImages: true,
                unlimitedPrompts: true,
                outputQuantity: 4,
                maxPrompts: Number.MAX_SAFE_INTEGER
            },
            store,
            runId: 'direction-duplicate-run',
            payload: {},
            config: {}
        });
        assert.strictEqual(directionDuplicateGate.prompts.length, 0);
        assert.strictEqual(directionDuplicateGate.promptQualityReport.rejectionSummary.duplicate_history_direction, 1);

        const unlimitedGate = applyPromptGate({
            prompts: [
                { index: 1, direction: '补给站热源', promptTitle: '提示词1', prompt: promptA },
                { index: 2, direction: '地铁撤离', promptTitle: '提示词1', prompt: promptB },
                { index: 3, direction: '高台灯光', promptTitle: '提示词1', prompt: promptC }
            ],
            selected,
            quota: {
                usedImagesToday: 1000,
                maxImagesPerDay: null,
                remainingImagesToday: Number.MAX_SAFE_INTEGER,
                unlimitedImages: true,
                unlimitedPrompts: true,
                outputQuantity: 4,
                maxPrompts: Number.MAX_SAFE_INTEGER
            },
            store,
            runId: 'unlimited-run',
            payload: {},
            config: {}
        });
        assert.strictEqual(unlimitedGate.prompts.length, 3);
        assert.strictEqual(unlimitedGate.promptQualityReport.maxPromptsAllowed, null);
        assert.strictEqual(unlimitedGate.promptQualityReport.unlimitedPrompts, true);
        assert.strictEqual(unlimitedGate.promptQualityReport.unlimitedImages, true);
        assert.ok(!unlimitedGate.promptQualityReport.rejectionSummary.quota_limit);

        const missingDirectionTagGate = applyPromptGate({
            prompts: [
                {
                    index: 1,
                    direction: '方向标签未落地',
                    promptTitle: 'missing-tag',
                    prompt: createPrompt('普通雪地行动'),
                    directionTags: ['地图线索', '入口目标'],
                    mainTags: ['地图线索', '入口目标']
                }
            ],
            selected,
            quota: {
                usedImagesToday: 0,
                maxImagesPerDay: null,
                remainingImagesToday: Number.MAX_SAFE_INTEGER,
                unlimitedImages: true,
                unlimitedPrompts: true,
                outputQuantity: 4,
                maxPrompts: Number.MAX_SAFE_INTEGER
            },
            store,
            runId: 'missing-direction-tag-run',
            payload: {},
            config: {}
        });
        assert.strictEqual(missingDirectionTagGate.prompts.length, 0);
        assert.strictEqual(missingDirectionTagGate.promptQualityReport.rejectionSummary.missing_direction_tag_landing, 1);

        const landedDirectionTagGate = applyPromptGate({
            prompts: [
                {
                    index: 1,
                    direction: '方向标签已落地',
                    promptTitle: 'landed-tag',
                    prompt: createPrompt('地图入口线索'),
                    directionTags: ['地图线索', '入口目标'],
                    mainTags: ['地图线索', '入口目标']
                }
            ],
            selected,
            quota: {
                usedImagesToday: 0,
                maxImagesPerDay: null,
                remainingImagesToday: Number.MAX_SAFE_INTEGER,
                unlimitedImages: true,
                unlimitedPrompts: true,
                outputQuantity: 4,
                maxPrompts: Number.MAX_SAFE_INTEGER
            },
            store,
            runId: 'landed-direction-tag-run',
            payload: {},
            config: {}
        });
        assert.strictEqual(landedDirectionTagGate.prompts.length, 1);

        const dnaLandingGate = applyPromptGate({
            prompts: [
                {
                    index: 1,
                    direction: 'DNA landing check',
                    promptTitle: 'landing-warning',
                    prompt: createPrompt('DNA warning accepted prompt', ' red-risk-token '),
                    visualHook: '巨型地标信号灯',
                    riskNote: 'red-risk-token',
                    dimensions: {
                        perspective: '俯瞰',
                        narrative: '撤离'
                    }
                }
            ],
            selected,
            quota: {
                usedImagesToday: 0,
                maxImagesPerDay: null,
                remainingImagesToday: Number.MAX_SAFE_INTEGER,
                unlimitedImages: true,
                unlimitedPrompts: true,
                outputQuantity: 4,
                maxPrompts: Number.MAX_SAFE_INTEGER
            },
            store,
            runId: 'dna-landing-run',
            payload: {},
            config: {}
        });
        assert.strictEqual(dnaLandingGate.prompts.length, 1);
        const dnaWarnings = dnaLandingGate.promptQualityReport.warnings
            .filter(issue => issue.source === 'direction-dna-landing');
        assert.ok(dnaWarnings.some(issue => issue.field === 'visualHook'));
        assert.ok(dnaWarnings.some(issue => issue.field === 'event'));
        assert.ok(dnaWarnings.some(issue => issue.field === 'camera'));
        assert.ok(dnaWarnings.some(issue => issue.field === 'riskNote'));
        assert.strictEqual(dnaLandingGate.promptQualityReport.dnaLandingWarningCount, dnaWarnings.length);
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

runPromptGateTest();
console.log('creative auto prompt gate tests passed');
