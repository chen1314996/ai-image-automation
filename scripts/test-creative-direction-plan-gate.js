const assert = require('assert');
const {
    extractDirectionPlansFromText,
    flattenDirectionPlansToPromptItems
} = require('../creative-agent-service');
const {
    buildDirectionPlanConfig,
    selectDirectionExtensions,
    selectDirectionPlanExtensions,
    scoreDirectionExtension
} = require('../src/services/creative-auto/direction-plan-gate');

function prompt(subject, detail) {
    return [
        `主题：${subject}。`,
        '画风：高质量3D卡通渲染，商业级游戏宣传海报风格，冰封末世游戏美术。',
        '情绪氛围：紧张危机中带有求生希望，资源稀缺和危险逼近都能一眼读懂。',
        `画面内容：${detail}，前景有结霜道具和手部动作，中景有人物关系，远景有风雪废墟与避难所灯光。`,
        '整体基调：1:1方图，冷蓝雪景与局部暖光对比，缩略图下主体明确，避免复杂小字和真实品牌。冰雪氛围，画面直观、主题明确，高质量3D卡通渲染，商业级游戏宣传海报风格，电影镜头感。'
    ].join('');
}

function runDirectionPlanParserAndGateTest() {
    const text = JSON.stringify({
        directionPlans: [
            {
                sourceDirectionPath: '题材/探索发现/物品展示/急救药品',
                currentJudgment: '急救药品方向成立在救命价值、资源稀缺和暴风雪危机。',
                exclusionSummary: '避开静态药箱展示，优先生成护送、抢救、争夺等动态机制。',
                extensions: [
                    {
                        extensionKey: '延展1',
                        extensionType: '已有方向延展',
                        name: '雪夜急救箱护送',
                        description: '幸存者小队在暴风雪夜护送急救箱穿过废弃街区。',
                        visualHook: '急救箱暖光、风雪道路、远处避难所灯光形成清晰目标。',
                        dedupeReason: '区别于旧的药箱发现/展示，新增护送救援动作机制。',
                        riskNote: '避免文字过小，药箱和人物关系要清楚。',
                        productionAdvice: '使用中景小队行动和冷暖对比，突出救命价值。',
                        promptPair: [
                            { title: '延展1-AI提示词1', prompt: prompt('雪夜急救箱护送', '三名幸存者用绳索拖着发光急救箱穿过结冰街道') },
                            { title: '延展1-AI提示词2', prompt: prompt('雪夜急救箱护送的低机位变体', '低机位看见急救箱从裂冰边缘被拉起，后方队员举着信号灯') }
                        ]
                    },
                    {
                        extensionKey: '延展2',
                        extensionType: '新创意方向',
                        name: '废弃诊所药品争夺',
                        description: '两队幸存者在冰封诊所门口争夺最后一箱药品。',
                        visualHook: '破碎诊所招牌、药箱红色警示灯、两队人物拉扯形成冲突。',
                        dedupeReason: '区别于护送路线，强调争夺冲突和近景拉扯。',
                        riskNote: '避免武器化表现，冲突以拉扯和抢救为主。',
                        productionAdvice: '用近景手部和药箱做视觉中心。',
                        promptPair: [
                            { title: '延展2-AI提示词1', prompt: prompt('废弃诊所药品争夺', '冰封诊所门口两队幸存者围绕最后一箱药品拉扯，红色警示灯照亮雪雾') },
                            { title: '延展2-AI提示词2', prompt: prompt('废弃诊所药品争夺的俯视变体', '俯视镜头中药箱位于画面中心，脚印和裂冰把两队人分隔开') }
                        ]
                    },
                    {
                        extensionKey: '延展3',
                        extensionType: '弱候选',
                        name: '极寒生存感',
                        description: '表现末世氛围。',
                        visualHook: '',
                        dedupeReason: '',
                        riskNote: '',
                        productionAdvice: '',
                        promptPair: [
                            { title: '延展3-AI提示词1', prompt: prompt('极寒生存感', '幸存者站在雪地里看向远方') },
                            { title: '延展3-AI提示词2', prompt: prompt('极寒生存感变体', '幸存者站在另一片雪地里看向远方') }
                        ]
                    }
                ]
            }
        ],
        candidateDirections: []
    });

    const plans = extractDirectionPlansFromText(text);
    assert.strictEqual(plans.length, 1);
    assert.strictEqual(plans[0].extensions.length, 3);

    const prompts = flattenDirectionPlansToPromptItems(plans);
    assert.strictEqual(prompts.length, 6);
    assert.strictEqual(prompts[0].extensionName, '雪夜急救箱护送');
    assert.strictEqual(prompts[0].visualHook.includes('急救箱暖光'), true);

    const strongScore = scoreDirectionExtension(plans[0].extensions[0]);
    const weakScore = scoreDirectionExtension(plans[0].extensions[2]);
    assert.ok(strongScore.score > weakScore.score);
    assert.ok(strongScore.score >= 70);

    const gate = selectDirectionExtensions({
        prompts,
        selected: {
            direction: {
                id: 'direction-1',
                path: '题材/探索发现/物品展示/急救药品'
            }
        },
        payload: {
            directionPlanning: {
                selectedExtensionsPerSource: 2,
                promptsPerExtension: 2,
                minScore: 70
            }
        },
        config: {}
    });

    assert.strictEqual(gate.directionPlanReport.candidateExtensionCount, 3);
    assert.strictEqual(gate.directionPlanReport.targetCandidateExtensionCount, 4);
    assert.strictEqual(gate.directionPlanReport.targetSelectedExtensionCount, 2);
    assert.strictEqual(gate.directionPlanReport.selectedExtensionCount, 2);
    assert.strictEqual(gate.directionPlanReport.rejectedExtensionCount, 1);
    assert.strictEqual(gate.prompts.length, 4);
    assert.ok(gate.prompts.every(item => item.directionPlanScore >= 70));
    assert.ok(gate.directionPlanReport.rejectedExtensions.some(item => item.name === '极寒生存感'));

    const fallbackGate = selectDirectionExtensions({
        prompts,
        selected: {
            direction: {
                id: 'direction-1',
                path: '题材/探索发现/物品展示/急救药品'
            }
        },
        payload: {
            directionPlanning: {
                selectedExtensionsPerSource: 2,
                promptsPerExtension: 2,
                minScore: 95
            }
        },
        config: {}
    });

    assert.strictEqual(fallbackGate.directionPlanReport.needsRepair, true);
    assert.strictEqual(fallbackGate.directionPlanReport.fallbackLowScoreUsed, true);
    assert.strictEqual(fallbackGate.directionPlanReport.selectedExtensionCount, 2);
    assert.ok(fallbackGate.directionPlanReport.selectedBelowMinScoreCount > 0);
    assert.strictEqual(fallbackGate.prompts.length, 4);

    const directionOnlyPlans = JSON.parse(JSON.stringify(plans));
    directionOnlyPlans[0].extensions.forEach(extension => {
        extension.promptPair = [];
    });
    const directionOnlyGate = selectDirectionPlanExtensions({
        directionPlans: directionOnlyPlans,
        selected: {
            direction: {
                id: 'direction-1',
                path: '题材/探索发现/物品展示/急救药品'
            }
        },
        payload: {
            directionPlanning: {
                selectedExtensionsPerSource: 2,
                promptsPerExtension: 2,
                minScore: 70
            }
        },
        config: {}
    });

    assert.strictEqual(directionOnlyGate.directionPlanReport.candidateExtensionCount, 3);
    assert.strictEqual(directionOnlyGate.directionPlanReport.selectedExtensionCount, 2);
    assert.strictEqual(directionOnlyGate.prompts.length, 0);
    assert.strictEqual(directionOnlyGate.selectedExtensions.length, 2);

    const historyAwareGate = selectDirectionPlanExtensions({
        directionPlans: directionOnlyPlans,
        selected: {
            direction: {
                id: 'direction-1',
                path: '棰樻潗/鎺㈢储鍙戠幇/鐗╁搧灞曠ず/鎬ユ晳鑽搧'
            }
        },
        payload: {
            directionPlanning: {
                selectedExtensionsPerSource: 1,
                promptsPerExtension: 2,
                minScore: 70,
                diversityMode: 'explore'
            }
        },
        config: {},
        historyUsage: {
            directionExpansionHistory: [{
                sourceDirectionId: 'direction-1',
                sourceDirectionPath: '棰樻潗/鎺㈢储鍙戠幇/鐗╁搧灞曠ず/鎬ユ晳鑽搧',
                newDirectionName: directionOnlyPlans[0].extensions[0].name,
                visualHook: directionOnlyPlans[0].extensions[0].visualHook,
                dedupeReason: directionOnlyPlans[0].extensions[0].dedupeReason
            }]
        }
    });

    assert.strictEqual(historyAwareGate.directionPlanReport.historicalExpansionCount, 1);
    assert.notStrictEqual(historyAwareGate.selectedExtensions[0].name, directionOnlyPlans[0].extensions[0].name);
    assert.ok(historyAwareGate.directionPlanReport.rejectedExtensions.some(item => item.name === directionOnlyPlans[0].extensions[0].name));

    const disabledRepairConfig = buildDirectionPlanConfig({
        directionPlanning: {
            maxRepairAttempts: 0
        }
    }, {});
    assert.strictEqual(disabledRepairConfig.maxRepairAttempts, 0);

    const multiplierConfig = buildDirectionPlanConfig({
        newDirectionsPerSource: 4,
        directionPlanning: {
            candidateMultiplier: 3,
            diversityMode: 'explore',
            historyScope: 'all'
        }
    }, {});
    assert.strictEqual(multiplierConfig.candidateExtensionsPerSource, 12);
    assert.strictEqual(multiplierConfig.candidateMultiplier, 3);
    assert.strictEqual(multiplierConfig.diversityMode, 'explore');
    assert.strictEqual(multiplierConfig.historyScope, 'all');

    const defaultRepairConfig = buildDirectionPlanConfig({}, {});
    assert.strictEqual(defaultRepairConfig.maxRepairAttempts, 2);
}

runDirectionPlanParserAndGateTest();
console.log('creative direction plan gate tests passed');
