const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { CreativeKnowledgeStore } = require('../src/services/creative-knowledge/store');
const {
    REQUIRED_FIELDS,
    TRANSLATION_VERSION,
    translatePromptsForLegil
} = require('../src/services/creative-auto/prompt-translator');
const { applyPromptGate } = require('../src/services/creative-auto/prompt-gate');

const PARAMETER_PATTERN = /1\s*[:：]\s*1|方图|正方形构图|生成[一二三四五六七八九十百\d]+张|输出[一二三四五六七八九十百\d]+张|分辨率|宽高比|画幅比例|2K|4K/i;
const STRUCTURED_LABEL_PATTERN = /主题：|画风：|画面内容：|核心构图：|画面要求：/;

async function runPromptTranslatorTest() {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'creative-prompt-translator-'));
    const store = new CreativeKnowledgeStore(tempDir);
    store.ensureBase();

    const selected = {
        direction: {
            id: 'direction-ice-supply',
            path: '题材/探索发现/补给站',
            name: '补给站',
            description: '幸存者在冰封废墟里寻找可用补给和热源，画面需要有清楚的行动和物资冲突。',
            mustKeep: '冰雪末日、幸存者、关键补给',
            mustAvoid: '机甲、真实品牌'
        }
    };

    const sourcePrompts = [
        {
            index: 1,
            direction: '补给站热源争夺',
            promptTitle: '短草案',
            prompt: '幸存者发现热源',
            selected: true
        },
        {
            index: 2,
            direction: '补给站热源争夺',
            promptTitle: '仓库入口',
            prompt: '主题：两名幸存者在被雪封住的仓库入口抢修小型取暖装置。动作：一人搬开结冰木箱，另一人用手电照亮半开的铁门。场景：废弃补给站外侧，地面有散落罐头、绳索和破损地图。镜头：低机位中景，前景道具清楚，中景角色关系明确。光线：冷蓝雪光与门缝暖光对比。画风：高质量 3D 卡通游戏广告图。文字规则：只允许短中文警示牌。',
            selected: true
        }
    ];

    let translatorCall = null;

    try {
        const translation = await translatePromptsForLegil({
            prompts: sourcePrompts,
            selected,
            payload: {
                forbiddenRules: ['大面积英文']
            },
            config: {},
            runId: 'run-s5',
            translatorClient: async request => {
                translatorCall = request;
                return {
                    prompts: [
                        {
                            index: 1,
                            promptTitle: '热源发现近景',
                            sourceDirectionId: selected.direction.id,
                            newDirectionName: '补给站热源争夺',
                            subject: '一名幸存者在废弃补给站门口发现可用热源',
                            action: '他蹲下拨开积雪，伸手护住刚露出的暖黄色信号灯',
                            scene: '冰封废弃补给站入口，周围有结冰木箱、破损地图和散落罐头',
                            camera: '低机位近景，前景突出手部动作和热源，中景保留补给站门口',
                            lighting: '冷蓝雪光与小面积暖光对比',
                            visualStyle: '高质量 3D 卡通游戏广告图',
                            textRule: '只允许短中文关键词',
                            mustKeep: ['冰雪末日', '幸存者', '关键补给'],
                            mustAvoid: ['机甲', '真实品牌', '大面积英文'],
                            finalPrompt: '太短'
                        },
                        {
                            index: 2,
                            promptTitle: '仓库入口协作',
                            sourceDirectionId: selected.direction.id,
                            newDirectionName: '补给站热源争夺',
                            subject: '两名幸存者在被雪封住的仓库入口抢修小型取暖装置',
                            action: '一人搬开结冰木箱，另一人用手电照亮半开的铁门，暖光从门缝里照出关键补给',
                            scene: '废弃补给站外侧，地面有散落罐头、绳索、破损地图和被雪覆盖的脚印',
                            camera: '低机位中景，前景道具清楚，中景角色关系明确，背景保留仓库门压迫感',
                            lighting: '冷蓝雪光与门缝暖光对比，主体边缘有清楚轮廓光',
                            visualStyle: '高质量 3D 卡通游戏广告图，商业级游戏宣传海报风格，电影镜头感',
                            textRule: '如需文字，只出现短中文警示牌，清晰可读',
                            mustKeep: ['冰雪末日', '幸存者', '关键补给'],
                            mustAvoid: ['机甲', '真实品牌', '大面积英文'],
                            finalPrompt: '主题：两名幸存者在被雪封住的仓库入口抢修小型取暖装置。画面动作：一人搬开结冰木箱，另一人用手电照亮半开的铁门，暖光从门缝里照出关键补给。场景：废弃补给站外侧，地面有散落罐头、绳索、破损地图和被雪覆盖的脚印。镜头：低机位中景，前景道具清楚，中景角色关系明确，背景保留仓库门压迫感。光线：冷蓝雪光与门缝暖光对比，主体边缘有清楚轮廓光。画风：高质量 3D 卡通游戏广告图，商业级游戏宣传海报风格，电影镜头感。文字规则：如需文字，只出现短中文警示牌，清晰可读。画面要求：1:1 方图，主体清楚，动作可读，适合 Legil 直接生图。'
                        }
                    ]
                };
            }
        });

        assert.ok(translatorCall);
        assert.strictEqual(translatorCall.agentName, 'Prompt Translator Agent');
        assert.strictEqual(translation.report.version, TRANSLATION_VERSION);
        assert.strictEqual(translation.report.promptSchemaVersion, 1);
        assert.strictEqual(translation.report.agentResponsePromptCount, 2);
        assert.strictEqual(translation.prompts.length, 2);
        assert.strictEqual(translation.directionDefinitions.length, 1);
        assert.strictEqual(translation.directionDefinitions[0].newDirectionName, '补给站热源争夺');
        assert.ok(Number(translation.prompts[0].rewriteCount) >= 0);
        assert.ok(Number(translation.report.rewritten) >= 0);
        assert.strictEqual(translation.report.selfCheckFailed, 0);

        translation.prompts.forEach(item => {
            REQUIRED_FIELDS.forEach(field => {
                assert.ok(item[field] !== undefined, `${field} should exist`);
                if (Array.isArray(item[field])) {
                    assert.ok(item[field].length > 0, `${field} should not be empty`);
                } else {
                    assert.ok(String(item[field]).trim(), `${field} should not be empty`);
                }
            });
            assert.strictEqual(item.prompt, item.finalPrompt);
            assert.ok(item.finalPrompt.includes('参考图') || item.finalPrompt.includes('原图视觉质感'));
            assert.ok(!STRUCTURED_LABEL_PATTERN.test(item.finalPrompt));
            assert.ok(!PARAMETER_PATTERN.test(item.finalPrompt));
            assert.ok(/不要文字，不要水印。$/.test(item.finalPrompt));
            assert.ok(item.finalPrompt.length >= 80);
            assert.ok(!item.finalPrompt.includes('机甲'));
            assert.ok(!item.finalPrompt.includes('真实品牌'));
            assert.ok(!item.finalPrompt.includes('大面积英文'));
            assert.strictEqual(item.translationVersion, TRANSLATION_VERSION);
            assert.strictEqual(item.selfCheck.success, true);
        });

        const gate = applyPromptGate({
            prompts: translation.prompts.map(item => ({
                ...item,
                prompt: ''
            })),
            selected,
            quota: {
                usedImagesToday: 0,
                maxImagesPerDay: 1000,
                remainingImagesToday: 1000,
                outputQuantity: 4,
                maxPrompts: 2
            },
            store,
            runId: 'run-s5',
            payload: {
                forbiddenRules: ['大面积英文']
            },
            config: {}
        });

        assert.strictEqual(gate.prompts.length, 2);
        assert.strictEqual(gate.prompts[0].prompt, translation.prompts[0].finalPrompt);
        assert.strictEqual(gate.prompts[0].finalPrompt, translation.prompts[0].finalPrompt);
        assert.strictEqual(gate.prompts[0].translationVersion, TRANSLATION_VERSION);
        assert.strictEqual(gate.promptQualityReport.acceptedPromptCount, 2);

        const fallbackTranslation = await translatePromptsForLegil({
            prompts: sourcePrompts,
            selected,
            payload: {
                forbiddenRules: ['大面积英文']
            },
            config: {},
            runId: 'run-s5-fallback',
            translatorClient: async () => {
                throw new SyntaxError("Expected ',' or ']' after array element in JSON at position 16986");
            }
        });

        assert.strictEqual(fallbackTranslation.report.fallbackUsed, true);
        assert.ok(fallbackTranslation.report.fallbackReason.includes("Expected ',' or ']'"));
        assert.strictEqual(fallbackTranslation.report.agentResponsePromptCount, 0);
        assert.strictEqual(fallbackTranslation.prompts.length, sourcePrompts.length);
        assert.strictEqual(fallbackTranslation.report.selfCheckFailed, 0);
        fallbackTranslation.prompts.forEach(item => {
            assert.strictEqual(item.prompt, item.finalPrompt);
            assert.ok(item.finalPrompt.includes('参考图') || item.finalPrompt.includes('原图视觉质感'));
            assert.ok(!STRUCTURED_LABEL_PATTERN.test(item.finalPrompt));
            assert.ok(!PARAMETER_PATTERN.test(item.finalPrompt));
            assert.ok(/不要文字，不要水印。$/.test(item.finalPrompt));
            assert.ok(item.finalPrompt.length >= 80);
            assert.strictEqual(item.translationVersion, TRANSLATION_VERSION);
            assert.strictEqual(item.selfCheck.success, true);
        });

        const fallbackGate = applyPromptGate({
            prompts: fallbackTranslation.prompts,
            selected,
            quota: {
                usedImagesToday: 0,
                maxImagesPerDay: 1000,
                remainingImagesToday: 1000,
                outputQuantity: 4,
                maxPrompts: 2
            },
            store,
            runId: 'run-s5-fallback',
            payload: {
                forbiddenRules: ['大面积英文']
            },
            config: {}
        });

        assert.strictEqual(fallbackGate.prompts.length, 2);
        assert.strictEqual(fallbackGate.promptQualityReport.acceptedPromptCount, 2);
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

runPromptTranslatorTest()
    .then(() => {
        console.log('creative prompt translator tests passed');
    })
    .catch(error => {
        console.error(error);
        process.exit(1);
    });
