const assert = require('assert');
const legilAutomation = require('../legil-automation');

const screenshotAspectRatios = ['1:1', '2:3', '3:4', '4:5', '9:16', '16:9', '5:4', '4:3', '3:2', '智能比例'];
const screenshotResolutions = ['1K', '2K'];
const outputQuantities = [1, 2, 3, 4];

function assertDeepEqual(actual, expected, message) {
    assert.deepStrictEqual(actual, expected, `${message}\nactual: ${JSON.stringify(actual)}\nexpected: ${JSON.stringify(expected)}`);
}

const gptImage2Profile = legilAutomation.getModelParameterProfile('gpt-image-2');
assertDeepEqual(gptImage2Profile.aspectRatios, screenshotAspectRatios, 'GPT-Image-2 aspect ratios should match the Legil UI');
assertDeepEqual(gptImage2Profile.resolutions, screenshotResolutions, 'GPT-Image-2 resolutions should match the Legil UI');
assertDeepEqual(gptImage2Profile.outputQuantities, outputQuantities, 'GPT-Image-2 output quantity range should be 1-4');
assert.strictEqual(gptImage2Profile.outputQuantityControl, 'slider', 'GPT-Image-2 output quantity should use slider automation');

const gptImage1Profile = legilAutomation.getModelParameterProfile('gpt-image-1');
assertDeepEqual(gptImage1Profile.aspectRatios, screenshotAspectRatios, 'GPT-Image-1 should share GPT image aspect ratios');
assertDeepEqual(gptImage1Profile.resolutions, screenshotResolutions, 'GPT-Image-1 should share GPT image resolutions');

const normalized = legilAutomation.normalizeGenerationSettings({
    imageModel: 'gpt-image-2',
    aspectRatio: '21:9',
    aspectRatios: ['1:1', '21:9', '16:9', '智能比例'],
    resolution: '4K',
    outputQuantity: 4
});

assert.deepStrictEqual(normalized, {
    imageModel: 'gpt-image-2',
    aspectRatio: '1:1',
    resolution: '2K',
    outputQuantity: 4,
    aspectRatios: ['1:1', '16:9', '智能比例']
}, 'GPT-Image-2 normalization should keep valid UI values and fall back invalid ones');

const configProfile = legilAutomation.getConfig().modelParameterProfiles['gpt-image-2'];
assertDeepEqual(configProfile.aspectRatios, screenshotAspectRatios, 'Config API profile should expose GPT-Image-2 aspect ratios');
assertDeepEqual(configProfile.resolutions, screenshotResolutions, 'Config API profile should expose GPT-Image-2 resolutions');
assert.strictEqual(configProfile.outputQuantityControl, 'slider', 'Config API profile should expose GPT-Image-2 slider control');

console.log('PASS Legil GPT-Image-2 generation settings profile');
