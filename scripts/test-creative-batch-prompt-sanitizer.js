const assert = require('assert');
const { createRouteContext } = require('../src/server/context');
const {
    hasForcedStyleForStyleFree,
    hasGenerationParameterText,
    hasStructuredPromptLabels
} = require('../src/services/creative-auto/prompt-style');

const { normalizeCreativeBatchPromptItems } = createRouteContext();
const GENERIC_ACTION_PATTERN = /整理物资|整理补给|清点物资|清点补给|寻找补给|寻找资源|搜寻补给|搜寻资源|收集补给|收集资源|探索场景|探索废墟|探索车站/;
const SPECIFIC_PROP_PATTERN = /罐头|药品|药盒|电池|电池包|背包|绷带|补给箱|工具箱|能源芯|钥匙卡|取暖芯/;

function assertCleanCreativeBatchPrompt(prompt, { styleFree = false } = {}) {
    assert.ok(prompt.includes('参考图') || prompt.includes('原图视觉质感'), 'prompt should bind the reference image');
    assert.ok(prompt.endsWith('不要文字，不要水印。'), `prompt should end with the default negative rule: ${prompt}`);
    assert.strictEqual(hasGenerationParameterText(prompt), false, `prompt should not contain generation parameters: ${prompt}`);
    assert.strictEqual(hasStructuredPromptLabels(prompt), false, `prompt should not contain structured labels: ${prompt}`);
    assert.ok(!/1\s*:\s*1|方图|正方形构图|生成\s*[一二三四五六七八九十百\d]+\s*张|输出\s*[一二三四五六七八九十百\d]+\s*张|分辨率|宽高比|画幅比例|2K|4K/i.test(prompt), `prompt should not contain old parameter text: ${prompt}`);
    assert.ok(!GENERIC_ACTION_PATTERN.test(prompt), `prompt should not keep generic actions: ${prompt}`);
    assert.ok(SPECIFIC_PROP_PATTERN.test(prompt), `prompt should include concrete supplies/props: ${prompt}`);
    if (styleFree) {
        assert.strictEqual(hasForcedStyleForStyleFree(prompt), false, `style_free should not force style words: ${prompt}`);
        assert.ok(!/电影感|真实摄影|3D|卡通|商业广告|商业海报|游戏广告|写实大片/.test(prompt), `style_free should not include forced style terms: ${prompt}`);
    }
}

const oldTemplatePrompt = [
    '主题：暴风雪后的废弃车站。',
    '画风：电影感真实摄影。',
    '画面内容：角色在暖色应急灯下整理物资，前景有结冰地面和破损指示牌。',
    '核心构图：1:1方图，正方形构图，分辨率 2K，输出四张。'
].join('');

const cinematic = normalizeCreativeBatchPromptItems([{
    index: 1,
    direction: '探索发现 / 攀爬',
    promptTitle: '旧模板',
    prompt: oldTemplatePrompt,
    finalPrompt: oldTemplatePrompt
}], 'cinematic_photo')[0];

assert.ok(cinematic, 'cinematic prompt should be retained');
assert.strictEqual(cinematic.creativePromptStyle, 'cinematic_photo');
assert.strictEqual(cinematic.prompt, cinematic.finalPrompt);
assertCleanCreativeBatchPrompt(cinematic.prompt);
assert.ok(cinematic.prompt.includes('高质量电影感场景图') || cinematic.prompt.includes('真实摄影质感'));

const commercial = normalizeCreativeBatchPromptItems([{
    prompt: '冰封末世求生主题：断桥冰索攀越取暖芯，1:1方图，生成四张，分辨率 4K，主体醒目，冷暖光对比明确。'
}], 'commercial_3d')[0];

assert.ok(commercial, 'commercial prompt should be retained');
assert.strictEqual(commercial.creativePromptStyle, 'commercial_3d');
assertCleanCreativeBatchPrompt(commercial.prompt);
assert.ok(commercial.prompt.includes('高质量3D卡通商业广告海报'));

const styleFree = normalizeCreativeBatchPromptItems([{
    prompt: '主题：废弃车站整理物资，电影感真实摄影，3D卡通商业广告海报，宽高比 16:9，输出一张。'
}], 'style_free')[0];

assert.ok(styleFree, 'style_free prompt should be retained');
assert.strictEqual(styleFree.creativePromptStyle, 'style_free');
assertCleanCreativeBatchPrompt(styleFree.prompt, { styleFree: true });
assert.ok(styleFree.prompt.includes('原图视觉质感'));

const empty = normalizeCreativeBatchPromptItems([''], 'cinematic_photo');
assert.deepStrictEqual(empty, [], 'empty prompts should not become generated default prompts');

console.log('creative batch prompt sanitizer tests passed');
