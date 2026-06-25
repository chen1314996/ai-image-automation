const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { CreativeKnowledgeStore } = require('../src/services/creative-knowledge/store');
const { createCreativeAutoService } = require('../src/services/creative-auto');

function buildPrompt(subject, scene) {
    return [
        `主题：${subject}。`,
        '画风：高质量3D卡通渲染，商业级游戏广告海报风格，冰封末世废土题材。',
        '情绪氛围：紧张危机中保留求生希望，资源稀缺和风雪压迫感清晰可见。',
        `画面内容：${scene}，前景有带霜的手部动作和关键道具，中景有幸存者小队协作，远景有废墟街区、厚雪、避难所灯光和风雪层次。`,
        '整体基调：1:1方图，冷蓝雪景与局部暖光对比，缩略图下主体明确，不出现商标水印、复杂小字、重型装甲、科幻操作屏和危险道具。冰雪氛围，画面直观、主题明确，高质量3D卡通渲染，商业级游戏宣传海报风格，电影镜头感。'
    ].join('');
}

function buildRepairDirectionPlan() {
    return {
        directionPlans: [
            {
                sourceDirectionPath: '题材/探索发现/物品展示/急救药品',
                currentJudgment: '急救药品方向适合继续围绕救命资源、护送事件和争夺机制扩展。',
                exclusionSummary: '避开静态药箱展示，优先输出具备人物动作、空间目标和资源稀缺压力的事件画面。',
                extensions: [
                    {
                        extensionKey: 'repair-1',
                        extensionType: '已有方向延展',
                        name: '雪夜急救箱护送',
                        description: '幸存者小队在暴风雪夜护送发光急救箱穿过废弃街区，必须赶到远处避难所。',
                        visualHook: '前景急救箱暖光，中景幸存者小队护送，远景避难所灯光、厚雪街道、低机位镜头形成清晰目标。',
                        dedupeReason: '区别于旧的药箱静态发现或陈列，新增护送、赶路、风雪阻拦和避难所目标。',
                        riskNote: '避免商标水印、重型装甲、科幻操作屏、危险道具和大段外文，药箱标识用抽象图形。',
                        productionAdvice: '用冷暖对比突出救命价值，画面中心放急救箱和人物动作，缩略图也能读懂护送事件。',
                        promptPair: [
                            {
                                title: '雪夜急救箱护送-低机位',
                                prompt: buildPrompt('雪夜急救箱护送', '低机位镜头中三名幸存者用绳索拖着发光急救箱穿过结冰街道，前景手套抓紧箱扣，中景队员互相掩护，远处避难所暖光成为明确目标')
                            },
                            {
                                title: '雪夜急救箱护送-俯视路线',
                                prompt: buildPrompt('雪夜急救箱护送俯视路线', '俯视镜头展示急救箱在厚雪中留下拖拽痕迹，幸存者小队沿废弃车辆之间快速移动，前景地图和手电筒光束指向远处亮着灯的避难所入口')
                            }
                        ]
                    }
                ]
            }
        ],
        candidateDirections: []
    };
}

async function runRepairLoopTest() {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'creative-direction-repair-'));
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
                                    content: JSON.stringify(buildRepairDirectionPlan())
                                }
                            }
                        ]
                    }
                };
            }
        }
    });

    try {
        assert.ok(service.__test && service.__test.applyPromptGatesWithRepair);

        const result = await service.__test.applyPromptGatesWithRepair({
            translation: {
                prompts: [
                    {
                        index: 1,
                        direction: '抽象生存氛围',
                        newDirectionName: '抽象生存氛围',
                        promptTitle: '失败候选',
                        prompt: ''
                    }
                ]
            },
            selected: {
                direction: {
                    id: 'direction-1',
                    path: '题材/探索发现/物品展示/急救药品',
                    name: '急救药品'
                }
            },
            quota: {
                outputQuantity: 4,
                unlimitedImages: true,
                unlimitedPrompts: true,
                maxPrompts: Number.MAX_SAFE_INTEGER,
                remainingImagesToday: Number.MAX_SAFE_INTEGER
            },
            store,
            run: { runId: 'repair-loop-test' },
            payload: {
                directionPlanning: {
                    selectedExtensionsPerSource: 1,
                    promptsPerExtension: 2,
                    minScore: 70,
                    maxRepairAttempts: 2
                }
            },
            config: {},
            memoryRules: [],
            winkyConfig: {
                apiUrl: 'https://winky.example.test/v1/chat/completions',
                apiKey: 'test-key',
                model: 'test-model',
                provider: 'test-provider'
            }
        });

        assert.strictEqual(axiosCalls.length, 1);
        assert.strictEqual(axiosCalls[0].url, 'https://winky.example.test/v1/chat/completions');
        assert.strictEqual(axiosCalls[0].payload.response_format.type, 'json_object');
        assert.strictEqual(axiosCalls[0].requestOptions.headers.Authorization, 'Bearer test-key');

        assert.strictEqual(result.repairReport.enabled, true);
        assert.strictEqual(result.repairReport.attempts.length, 1);
        assert.strictEqual(result.repairReport.generatedPromptCount, 2);
        assert.strictEqual(result.repairReport.finalAcceptedPromptCount, 2);
        assert.strictEqual(result.repairReport.success, true);
        assert.strictEqual(result.directionPlanGate.directionPlanReport.selectedExtensionCount, 1);
        assert.strictEqual(result.gate.prompts.length, 2);
        assert.ok(result.gate.prompts.every(item => item.repairAttempt === 1));
        assert.ok(!result.gate.promptQualityReport.rejectionSummary.empty_prompt);
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

runRepairLoopTest()
    .then(() => {
        console.log('creative direction repair loop tests passed');
    })
    .catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
