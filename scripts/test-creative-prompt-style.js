const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { CreativeKnowledgeStore } = require('../src/services/creative-knowledge/store');
const {
    hasGenerationParameterText,
    hasStructuredPromptLabels,
    sanitizeLegilPromptText
} = require('../src/services/creative-auto/prompt-style');
const { translatePromptsForLegil } = require('../src/services/creative-auto/prompt-translator');
const { applyPromptGate } = require('../src/services/creative-auto/prompt-gate');

const PARAMETER_PATTERN = /1\s*[:：]\s*1|方图|正方形构图|生成[一二三四五六七八九十百\d]+张|输出[一二三四五六七八九十百\d]+张|分辨率|宽高比|画幅比例|2K|4K/i;
const STRUCTURED_LABEL_PATTERN = /主题：|画风：|画面内容：|核心构图：|画面要求：/;
const STYLE_FREE_FORCED_PATTERN = /电影感|真实摄影|3D|三维|卡通|商业广告|商业海报|游戏广告|写实大片/;
const GENERIC_ACTION_PATTERN = /整理物资|整理补给|清点物资|清点补给|寻找补给|寻找资源|搜寻补给|搜寻资源|收集补给|收集资源|探索场景|探索废墟|探索车站/;
const SPECIFIC_PROP_PATTERN = /罐头|药品|药盒|电池|电池包|背包|绷带|补给箱|工具箱|能源芯|钥匙卡|取暖芯/;

function assertCleanPrompt(prompt, { styleFree = false } = {}) {
    assert.ok(prompt.includes('参考图') || prompt.includes('原图视觉质感'), 'prompt should bind reference image');
    assert.ok(/不要文字，不要水印。$/.test(prompt), 'prompt should end with default no-text/no-watermark rule');
    assert.ok(!PARAMETER_PATTERN.test(prompt), `prompt should not contain generation parameters: ${prompt}`);
    assert.ok(!STRUCTURED_LABEL_PATTERN.test(prompt), `prompt should not contain structured labels: ${prompt}`);
    assert.strictEqual(hasGenerationParameterText(prompt), false);
    assert.strictEqual(hasStructuredPromptLabels(prompt), false);
    assert.ok(!GENERIC_ACTION_PATTERN.test(prompt), `prompt should not keep generic actions: ${prompt}`);
    assert.ok(SPECIFIC_PROP_PATTERN.test(prompt), `prompt should include concrete supplies/props: ${prompt}`);
    if (styleFree) {
        assert.ok(!STYLE_FREE_FORCED_PATTERN.test(prompt), `style_free prompt should not force style terms: ${prompt}`);
        assert.ok(prompt.includes('原图视觉质感'), 'style_free prompt should preserve original visual texture');
    }
}

async function run() {
    const oldTemplatePrompt = '主题：暴风雪后的废弃车站。画风：电影感真实摄影。画面内容：角色整理物资。画面要求：1:1 方图，分辨率 2K，输出四张。';
    const cinematic = sanitizeLegilPromptText(oldTemplatePrompt, 'cinematic_photo');
    assertCleanPrompt(cinematic);
    assert.ok(cinematic.includes('电影感') || cinematic.includes('真实摄影质感'));

    const free = sanitizeLegilPromptText('主题：废弃车站，电影感真实摄影，3D卡通商业海报，角色整理物资，前景有破损指示牌。', 'style_free');
    assertCleanPrompt(free, { styleFree: true });

    const selected = {
        direction: {
            id: 'direction-station',
            path: '题材/冰雪求生/废弃车站',
            name: '废弃车站补给',
            description: '角色在暴风雪过后的废弃车站寻找补给，画面需要有清晰动作、前景道具和冷暖光。',
            mustKeep: '参考图角色造型、服装特征、冰雪求生',
            mustAvoid: ''
        }
    };

    const sourcePrompts = [
        {
            index: 1,
            direction: '废弃车站补给',
            promptTitle: '旧模板',
            prompt: oldTemplatePrompt,
            selected: true
        }
    ];

    const translation = await translatePromptsForLegil({
        prompts: sourcePrompts,
        selected,
        payload: { creativePromptStyle: 'commercial_3d' },
        config: { creativePromptStyle: 'commercial_3d' },
        runId: 'style-test',
        translatorClient: async () => ({
            prompts: [
                {
                    index: 1,
                    promptTitle: '废弃车站整理物资',
                    sourceDirectionId: selected.direction.id,
                    newDirectionName: '废弃车站补给',
                    subject: '参考图角色',
                    action: '在暖色应急灯下整理物资',
                    scene: '暴风雪过后的废弃车站大厅',
                    camera: '画面中心清晰，构图稳定',
                    lighting: '冷暖光对比明确',
                    visualStyle: '高质量3D卡通商业广告海报',
                    textRule: '不要文字，不要水印',
                    mustKeep: ['参考图角色造型', '服装特征'],
                    mustAvoid: [],
                    finalPrompt: '主题：暴风雪过后的废弃车站大厅。画风：高质量3D卡通商业广告海报。画面内容：角色在暖色应急灯下整理物资，前景有结冰地面和破损指示牌。画面要求：1:1 方图，2K 分辨率，输出四张。'
                }
            ]
        })
    });

    assert.strictEqual(translation.prompts.length, 1);
    assert.strictEqual(translation.report.creativePromptStyle, 'commercial_3d');
    assertCleanPrompt(translation.prompts[0].finalPrompt);
    assert.ok(translation.prompts[0].finalPrompt.includes('3D卡通商业广告海报'));
    assert.strictEqual(translation.report.selfCheckFailed, 0);

    const fallbackTranslation = await translatePromptsForLegil({
        prompts: [{
            index: 1,
            direction: '废弃车站补给',
            promptTitle: '短草稿',
            prompt: '角色整理物资',
            selected: true
        }],
        selected,
        payload: { creativePromptStyle: 'style_free' },
        config: { creativePromptStyle: 'style_free' },
        runId: 'style-test-fallback',
        translatorClient: async () => {
            throw new Error('translator unavailable');
        }
    });

    assert.strictEqual(fallbackTranslation.report.fallbackUsed, true);
    assert.strictEqual(fallbackTranslation.prompts.length, 1);
    assertCleanPrompt(fallbackTranslation.prompts[0].finalPrompt, { styleFree: true });

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'creative-prompt-style-'));
    try {
        const store = new CreativeKnowledgeStore(tempDir);
        store.ensureBase();
        const gate = applyPromptGate({
            prompts: fallbackTranslation.prompts,
            selected,
            quota: {
                usedImagesToday: 0,
                maxImagesPerDay: 1000,
                remainingImagesToday: 1000,
                outputQuantity: 4,
                maxPrompts: 1
            },
            store,
            runId: 'style-test-gate',
            payload: { creativePromptStyle: 'style_free' },
            config: { creativePromptStyle: 'style_free' }
        });

        assert.strictEqual(gate.prompts.length, 1);
        assertCleanPrompt(gate.prompts[0].finalPrompt, { styleFree: true });
        assert.strictEqual(gate.promptQualityReport.acceptedPromptCount, 1);
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

run()
    .then(() => {
        console.log('creative prompt style tests passed');
    })
    .catch(error => {
        console.error(error);
        process.exit(1);
    });
