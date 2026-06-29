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

    const visualDnaPreference = {
        atmosphere: ['史诗壮阔'],
        camera: ['俯瞰'],
        event: ['发现'],
        risks: ['英文文字', '过度科幻', '主体不清']
    };
    const dnaPreferred = {
        extensionKey: 'dna-good',
        extensionType: 'candidate',
        name: '黎明废墟俯瞰发现巨型地标',
        description: '幸存者从高处俯瞰城市废墟，第一次发现被暖光照亮的巨型地标入口。',
        visualHook: '黎明暖光中的巨型地标入口',
        dedupeReason: '用俯瞰发现和巨型地标区别于普通废墟远景。',
        riskNote: '避免主体过小',
        productionAdvice: '用前景人物和远景地标形成清晰尺度。',
        dimensions: {
            mood: '史诗壮阔',
            perspective: '俯瞰',
            narrative: '发现',
            hook: '巨型地标'
        }
    };
    const dnaRisky = {
        extensionKey: 'dna-risk',
        extensionType: 'candidate',
        name: '未来科幻英文废墟展示',
        description: '废墟里加入大量英文文字、过度科幻界面，主体关系不清。',
        visualHook: '英文发光屏幕',
        dedupeReason: '只是替换视觉包装。',
        riskNote: '英文文字、过度科幻、主体不清',
        productionAdvice: '保持画面完整。',
        dimensions: {
            mood: '神秘未知',
            perspective: '平视'
        }
    };
    const dnaPreferredScore = scoreDirectionExtension(dnaPreferred, {
        visualDnaPreference,
        seenDnaCombos: new Set(),
        historyDnaCombos: new Set()
    });
    const dnaRiskyScore = scoreDirectionExtension(dnaRisky, {
        visualDnaPreference,
        seenDnaCombos: new Set(),
        historyDnaCombos: new Set()
    });
    assert.ok(dnaPreferredScore.score > dnaRiskyScore.score);
    assert.strictEqual(dnaPreferredScore.dnaAssessment.completeness, 4);
    assert.ok(dnaPreferredScore.dnaAssessment.preferenceMatchCount >= 3);
    assert.ok(dnaRiskyScore.dnaAssessment.riskHits.length >= 1);

    const dnaGate = selectDirectionPlanExtensions({
        directionPlans: [{
            sourceDirectionPath: '题材/探索发现/城市废墟',
            extensions: [dnaRisky, dnaPreferred]
        }],
        selected: {
            direction: {
                id: 'direction-dna',
                path: '题材/探索发现/城市废墟'
            },
            visualDnaPreferenceContext: visualDnaPreference
        },
        payload: {
            directionPlanning: {
                selectedExtensionsPerSource: 1,
                promptsPerExtension: 2,
                minScore: 1
            }
        },
        config: {}
    });
    assert.strictEqual(dnaGate.selectedExtensions[0].name, dnaPreferred.name);
    assert.strictEqual(dnaGate.directionPlanReport.selectedExtensions[0].dnaAssessment.completeness, 4);

    const highTagCandidate = {
        extensionKey: 'tag-high',
        extensionType: 'candidate',
        name: '暖光补给箱交接',
        description: '幸存者在风雪街道中交接发光补给箱，前景道具清晰。',
        visualHook: '暖光补给箱和手部交接动作',
        dedupeReason: '用交接动作区别于静态展示。',
        riskNote: '',
        productionAdvice: '让补给箱成为画面中心。',
        directionTags: ['暖光目标', '物资补给', '风雪压迫'],
        mainTags: ['暖光目标', '物资补给'],
        extraTags: ['风雪压迫']
    };
    const gapTagCandidate = {
        ...highTagCandidate,
        extensionKey: 'tag-gap',
        name: '低机位近景工具取回',
        description: '低机位近景中幸存者从冰裂边缘取回关键工具。',
        visualHook: '低机位近景工具和冰裂边缘',
        directionTags: ['低机位', '近景物件', '冰裂危机'],
        mainTags: ['低机位', '近景物件'],
        extraTags: ['冰裂危机']
    };
    const tagPreference = {
        highTags: ['暖光目标', '物资补给'],
        gapTags: ['低机位', '近景物件'],
        riskTags: ['文字干扰']
    };
    const stableHighScore = scoreDirectionExtension(highTagCandidate, {
        directionTagPreference: tagPreference,
        seenTagCombos: new Set(),
        historyTagCombos: new Set(),
        tagStrategy: 'stable'
    });
    const stableGapScore = scoreDirectionExtension(gapTagCandidate, {
        directionTagPreference: tagPreference,
        seenTagCombos: new Set(),
        historyTagCombos: new Set(),
        tagStrategy: 'stable'
    });
    assert.ok(stableHighScore.score > stableGapScore.score);
    assert.ok(stableHighScore.tagAssessment.highTagMatches.length >= 2);

    const exploreHighScore = scoreDirectionExtension(highTagCandidate, {
        directionTagPreference: tagPreference,
        seenTagCombos: new Set(),
        historyTagCombos: new Set(),
        tagStrategy: 'explore'
    });
    const exploreGapScore = scoreDirectionExtension(gapTagCandidate, {
        directionTagPreference: tagPreference,
        seenTagCombos: new Set(),
        historyTagCombos: new Set(),
        tagStrategy: 'explore'
    });
    assert.ok(exploreGapScore.score > exploreHighScore.score);
    assert.ok(exploreGapScore.tagAssessment.gapTagMatches.length >= 1);

    const riskyTagScore = scoreDirectionExtension({
        ...highTagCandidate,
        extensionKey: 'tag-risk',
        riskTags: ['文字干扰'],
        riskNote: '文字干扰'
    }, {
        directionTagPreference: tagPreference,
        seenTagCombos: new Set(),
        historyTagCombos: new Set(),
        tagStrategy: 'stable'
    });
    assert.ok(riskyTagScore.score < stableHighScore.score);
    assert.ok(riskyTagScore.tagScore.riskPenalty < 0);

    const tagGate = selectDirectionPlanExtensions({
        directionPlans: [{
            sourceDirectionPath: '题材/探索发现/补给站',
            extensions: [gapTagCandidate, highTagCandidate]
        }],
        selected: {
            direction: {
                id: 'direction-tags',
                path: '题材/探索发现/补给站'
            },
            directionTagPreferenceContext: tagPreference
        },
        payload: {
            directionPlanning: {
                selectedExtensionsPerSource: 1,
                promptsPerExtension: 1,
                minScore: 1,
                tagStrategy: 'stable'
            }
        },
        config: {}
    });
    assert.strictEqual(tagGate.selectedExtensions[0].name, highTagCandidate.name);
    assert.ok(tagGate.directionPlanReport.selectedExtensions[0].tagAssessment);
    assert.ok(tagGate.directionPlanReport.selectedExtensions[0].tagScore);

    const defaultRepairConfig = buildDirectionPlanConfig({}, {});
    assert.strictEqual(defaultRepairConfig.maxRepairAttempts, 2);
}

runDirectionPlanParserAndGateTest();
console.log('creative direction plan gate tests passed');
