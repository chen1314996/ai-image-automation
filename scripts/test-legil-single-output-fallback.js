const assert = require('assert');
const legilAutomation = require('../legil-automation');

(async () => {
    const originalGenerateImage = legilAutomation.generateImage;
    const originalLastPath = legilAutomation.lastUploadedReferenceImagePath;
    const originalLastPaths = legilAutomation.lastUploadedReferenceImagePaths;

    try {
        const outcome = {
            expectedOutputCount: 3,
            validCount: 0,
            failedSlotCount: 3,
            failureTexts: ['image placeholder failed'],
            allFailed: true,
            partial: false
        };

        const calls = [];
        legilAutomation.lastUploadedReferenceImagePath = 'D:\\ref\\same.png';
        legilAutomation.lastUploadedReferenceImagePaths = [];
        legilAutomation.generateImage = async (prompt, promptIndex, options = {}) => {
            calls.push({ prompt, promptIndex, options });
            const index = calls.length;
            return {
                success: true,
                savePath: `out-${index}.png`,
                savePaths: [`out-${index}.png`],
                savedCount: 1
            };
        };

        let result = await legilAutomation.generateWithSingleOutputFallback(
            'prompt text',
            7,
            { outputSequence: 10 },
            { outputQuantity: 3, imageModel: 'nano-banana-2' },
            outcome
        );

        assert.strictEqual(result.success, true);
        assert.strictEqual(result.savedCount, 3);
        assert.deepStrictEqual(result.savePaths, ['out-1.png', 'out-2.png', 'out-3.png']);
        assert.strictEqual(result.partialSuccess, false);
        assert.strictEqual(result.generationOutcome, outcome);
        assert.strictEqual(calls.length, 3);
        calls.forEach((call, index) => {
            assert.strictEqual(call.prompt, 'prompt text');
            assert.strictEqual(call.promptIndex, 7);
            assert.strictEqual(call.options.generationSettings.outputQuantity, 1);
            assert.strictEqual(call.options.singleOutputFallbackOnAllFailed, false);
            assert.strictEqual(call.options._legilSingleOutputFallbackRetried, true);
            assert.strictEqual(call.options.referenceImagePath, 'D:\\ref\\same.png');
            assert.strictEqual(call.options.outputSequence, 10 + index);
            assert.strictEqual(call.options.variantIndexBase, index);
        });

        const partialCalls = [];
        legilAutomation.lastUploadedReferenceImagePath = '';
        legilAutomation.lastUploadedReferenceImagePaths = ['D:\\ref\\main.png', 'D:\\ref\\style.png'];
        legilAutomation.generateImage = async (prompt, promptIndex, options = {}) => {
            partialCalls.push({ prompt, promptIndex, options });
            if (partialCalls.length === 1) {
                return { success: false, message: 'first retry failed' };
            }
            return {
                success: true,
                savePath: `partial-${partialCalls.length}.png`,
                savePaths: [`partial-${partialCalls.length}.png`],
                savedCount: 1
            };
        };

        result = await legilAutomation.generateWithSingleOutputFallback(
            'prompt text',
            2,
            {},
            { outputQuantity: 2 },
            { ...outcome, expectedOutputCount: 2, failedSlotCount: 2 }
        );

        assert.strictEqual(result.success, true);
        assert.strictEqual(result.savedCount, 1);
        assert.strictEqual(result.partialSuccess, true);
        assert.deepStrictEqual(partialCalls[0].options.referenceImagePaths, ['D:\\ref\\main.png', 'D:\\ref\\style.png']);
        assert.deepStrictEqual(partialCalls[1].options.referenceImagePaths, ['D:\\ref\\main.png', 'D:\\ref\\style.png']);

        legilAutomation.generateImage = async () => ({ success: false, message: 'still failed' });
        result = await legilAutomation.generateWithSingleOutputFallback(
            'prompt text',
            1,
            {},
            { outputQuantity: 1 },
            { ...outcome, expectedOutputCount: 1, failedSlotCount: 1 }
        );

        assert.strictEqual(result.success, false);
        assert.strictEqual(result.code, 'LEGIL_PLACEHOLDER_FAILED');
        assert.strictEqual(result.savedCount, 0);
        assert.strictEqual(result.generationOutcome.expectedOutputCount, 1);

        console.log('PASS Legil single-output fallback');
    } finally {
        legilAutomation.generateImage = originalGenerateImage;
        legilAutomation.lastUploadedReferenceImagePath = originalLastPath;
        legilAutomation.lastUploadedReferenceImagePaths = originalLastPaths;
    }
})().catch(error => {
    console.error(error);
    process.exit(1);
});
