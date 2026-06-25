const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { CreativeKnowledgeStore } = require('../src/services/creative-knowledge/store');
const { createCreativeAutoService } = require('../src/services/creative-auto');

function buildPrompt(subject, scene) {
    return [
        `主题：${subject}。`,
        '画风：1:1方图，高质量3D卡通商业游戏广告海报。',
        '情绪氛围：冰封末世求生压力中带有清晰希望。',
        `画面内容：${scene}，前景有关键道具，中景有人物动作，远景有避难所暖光和暴风雪废墟。`,
        '构图镜头：主体居中，前中远景层次清楚，缩略图可读。',
        '整体基调：冷蓝冰雪与局部暖光强对比，商业级游戏宣传海报风格，电影镜头感。'
    ].join('');
}

function buildDirectionOnlyPlans() {
    return [
        {
            sourceDirectionPath: '题材/探索发现/物品展示/急救药品',
            currentJudgment: '急救药品适合围绕护送、抢救、争夺等动态事件继续拓展。',
            exclusionSummary: '避免静态药箱展示，优先体现人物行动和资源稀缺压力。',
            extensions: [
                {
                    extensionKey: 'candidate-1',
                    extensionType: 'candidate',
                    name: '雪夜急救箱护送',
                    description: '幸存者小队在暴风雪夜护送发光急救箱穿过废弃街区，赶往远处避难所。',
                    visualHook: '前景急救箱暖光，中景小队护送动作，远景避难所灯光和厚雪街道。',
                    dedupeReason: '区别于静态药箱展示，增加护送路线、风雪阻碍和避难所目标。',
                    riskNote: '风险可控，避免真实品牌和复杂小字。',
                    productionAdvice: '缩略图中心放急救箱和人物拉拽动作，冷暖光对比强化救命价值。'
                },
                {
                    extensionKey: 'candidate-2',
                    extensionType: 'candidate',
                    name: '诊所门口药品争夺',
                    description: '两队幸存者在冰封诊所门口争夺最后一箱药品，突出资源稀缺和冲突选择。',
                    visualHook: '破损诊所招牌、红色警示灯、药箱、两队人物拉扯形成视觉中心。',
                    dedupeReason: '区别于护送方向，强调争夺冲突、近景拉扯和诊所空间。',
                    riskNote: '冲突以拉扯和抢救为主，避免武器化表现。',
                    productionAdvice: '用近景手部和药箱做中心，人物关系一眼可读。'
                },
                {
                    extensionKey: 'candidate-3',
                    extensionType: 'weak',
                    name: '末世氛围感',
                    description: '展示冰雪末世环境。',
                    visualHook: '',
                    dedupeReason: '',
                    riskNote: '',
                    productionAdvice: ''
                },
                {
                    extensionKey: 'candidate-4',
                    extensionType: 'weak',
                    name: '高级生存感',
                    description: '表现幸存者站在雪地。',
                    visualHook: '',
                    dedupeReason: '',
                    riskNote: '',
                    productionAdvice: ''
                }
            ]
        }
    ];
}

function buildPromptPlans() {
    return {
        directionPlans: [
            {
                sourceDirectionPath: '题材/探索发现/物品展示/急救药品',
                extensions: [
                    {
                        extensionKey: 'candidate-1',
                        extensionType: 'selected',
                        name: '雪夜急救箱护送',
                        description: '幸存者小队在暴风雪夜护送发光急救箱穿过废弃街区，赶往远处避难所。',
                        visualHook: '前景急救箱暖光，中景小队护送动作，远景避难所灯光和厚雪街道。',
                        dedupeReason: '区别于静态药箱展示，增加护送路线、风雪阻碍和避难所目标。',
                        riskNote: '风险可控，避免真实品牌和复杂小字。',
                        productionAdvice: '缩略图中心放急救箱和人物拉拽动作，冷暖光对比强化救命价值。',
                        promptPair: [
                            { title: '提示词1', prompt: buildPrompt('雪夜急救箱护送', '三名幸存者拖着发光急救箱穿过结冰街道') },
                            { title: '提示词2', prompt: buildPrompt('低机位急救箱护送', '低机位看见急救箱从裂冰边缘被拉起，队友举着信号灯') }
                        ]
                    },
                    {
                        extensionKey: 'candidate-2',
                        extensionType: 'selected',
                        name: '诊所门口药品争夺',
                        description: '两队幸存者在冰封诊所门口争夺最后一箱药品，突出资源稀缺和冲突选择。',
                        visualHook: '破损诊所招牌、红色警示灯、药箱、两队人物拉扯形成视觉中心。',
                        dedupeReason: '区别于护送方向，强调争夺冲突、近景拉扯和诊所空间。',
                        riskNote: '冲突以拉扯和抢救为主，避免武器化表现。',
                        productionAdvice: '用近景手部和药箱做中心，人物关系一眼可读。',
                        promptPair: [
                            { title: '提示词1', prompt: buildPrompt('诊所门口药品争夺', '冰封诊所门口两队幸存者围绕最后一箱药品拉扯') },
                            { title: '提示词2', prompt: buildPrompt('俯瞰药品争夺路线', '俯瞰镜头中药箱位于画面中心，脚印和裂冰把两队人物分隔开') }
                        ]
                    }
                ]
            }
        ],
        candidateDirections: []
    };
}

async function runTwoStageTest() {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'creative-two-stage-'));
    const store = new CreativeKnowledgeStore(tempDir);
    store.ensureBase();

    const axiosCalls = [];
    const service = createCreativeAutoService({
        rootDir: tempDir,
        logger: { info() {}, warn() {}, error() {} },
        axios: {
            async post(url, payload, requestOptions) {
                axiosCalls.push({ url, payload, requestOptions });
                return {
                    data: {
                        choices: [
                            {
                                message: {
                                    content: JSON.stringify(buildPromptPlans())
                                }
                            }
                        ]
                    }
                };
            }
        }
    });

    try {
        const selected = {
            direction: {
                id: 'direction-1',
                path: '题材/探索发现/物品展示/急救药品',
                name: '急救药品',
                description: '围绕末世急救药品拓展动态画面'
            }
        };
        const payload = {
            directionPlanning: {
                candidateExtensionsPerSource: 4,
                selectedExtensionsPerSource: 2,
                promptsPerExtension: 2,
                minScore: 70,
                maxRepairAttempts: 2
            }
        };
        const config = {};

        const directionStage = await service.__test.selectDirectionPlansWithRepair({
            directionPlans: buildDirectionOnlyPlans(),
            selected,
            payload,
            config,
            store,
            run: { runId: 'two-stage-test' },
            winkyConfig: {
                apiUrl: 'https://winky.example.test/v1/chat/completions',
                apiKey: 'test-key',
                model: 'test-model',
                provider: 'test-provider'
            }
        });

        assert.strictEqual(axiosCalls.length, 0);
        assert.strictEqual(directionStage.directionPlanGate.directionPlanReport.selectedExtensionCount, 2);
        assert.strictEqual(directionStage.directionPlanGate.prompts.length, 0);
        assert.strictEqual(directionStage.repairReport.finalQualifiedExtensionCount, 2);

        const promptStage = await service.__test.generatePromptsForSelectedDirections({
            selected,
            payload,
            config,
            directionPlanGate: directionStage.directionPlanGate,
            winkyConfig: {
                apiUrl: 'https://winky.example.test/v1/chat/completions',
                apiKey: 'test-key',
                model: 'test-model',
                provider: 'test-provider'
            }
        });

        assert.strictEqual(axiosCalls.length, 1);
        assert.strictEqual(axiosCalls[0].payload.response_format.type, 'json_object');
        assert.strictEqual(promptStage.report.success, true);
        assert.strictEqual(promptStage.prompts.length, 4);
        assert.ok(promptStage.prompts.every(item => item.source === 'selected-direction-prompt-stage'));

        const gates = await service.__test.applyPromptGatesWithRepair({
            translation: {
                prompts: promptStage.prompts,
                report: { promptCount: promptStage.prompts.length }
            },
            selected,
            quota: {
                maxPrompts: 4,
                unlimitedPrompts: false,
                outputQuantity: 1
            },
            store,
            run: { runId: 'two-stage-test' },
            payload,
            config,
            memoryRules: [],
            winkyConfig: {
                apiUrl: 'https://winky.example.test/v1/chat/completions',
                apiKey: 'test-key',
                model: 'test-model',
                provider: 'test-provider'
            },
            skipDirectionRepair: true
        });

        assert.strictEqual(axiosCalls.length, 1, 'prompt-stage gate should not call Winky repair again');
        assert.strictEqual(gates.repairReport.attempts.length, 0);
        assert.strictEqual(gates.gate.prompts.length, 4);
        assert.ok(gates.repairReport.summary.includes('跳过 prompt 阶段补候选'));
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

runTwoStageTest()
    .then(() => {
        console.log('creative auto two-stage direction prompt tests passed');
    })
    .catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
