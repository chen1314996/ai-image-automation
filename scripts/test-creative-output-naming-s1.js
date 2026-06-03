const assert = require('assert');

const {
    resolveStandardLabelPath,
    buildOutputNameBase,
    sanitizeFileNamePart,
    parseLabelCandidatesFromName,
    buildCreativeOutputNamingContext,
    normalizeDirectionLibrary
} = require('../src/services/output-naming/creative-output-naming');

const DIRECTION_LIBRARY = [
    { id: 'dir-topic', path: '题材' },
    { id: 'dir-explore', path: '题材 / 探索发现' },
    { id: 'dir-shelter', path: '题材 / 探索发现 / 避难所' }
];

function logPass(message) {
    console.log(`[creative-output-naming S1] OK - ${message}`);
}

function checkAcceptanceSamples() {
    const materialContext = buildCreativeOutputNamingContext({
        sourceRawName: 'GOFCNIM6724_DR_题材_探索发现_避难所形象拓展_800x800',
        directionLibrary: DIRECTION_LIBRARY,
        contentTitle: '雪原信号塔救援'
    });

    assert.deepStrictEqual(materialContext.standardLabelPath, ['题材', '探索发现', '避难所']);
    assert.strictEqual(materialContext.sourceContentTitle, '避难所形象拓展');
    assert.strictEqual(materialContext.outputNameBase, '题材_探索发现_避难所_雪原信号塔救援');
    assert.strictEqual(materialContext.namingSource, 'direction-library-fuzzy');
    assert.strictEqual(materialContext.tagConfidence, 'medium');

    const batchContext = buildCreativeOutputNamingContext({
        sourceRawName: '题材_探索发现_废弃观测站.png',
        directionLibrary: [{ id: 'dir-explore', path: '题材 / 探索发现' }],
        contentTitle: '夜间求生信号'
    });

    assert.deepStrictEqual(batchContext.standardLabelPath, ['题材', '探索发现']);
    assert.strictEqual(batchContext.sourceContentTitle, '废弃观测站');
    assert.strictEqual(batchContext.outputNameBase, '题材_探索发现_夜间求生信号');

    logPass('stage 1 acceptance samples return expected naming context');
}

function checkResolutionPriority() {
    const byStructured = buildCreativeOutputNamingContext({
        primaryTag: '题材',
        secondaryTag: '探索发现',
        tertiaryTag: '避难所',
        sourceRawName: '未知_旧标题.png',
        directionLibrary: DIRECTION_LIBRARY,
        contentTitle: '结构化标签优先'
    });

    assert.deepStrictEqual(byStructured.standardLabelPath, ['题材', '探索发现', '避难所']);
    assert.strictEqual(byStructured.namingSource, 'prompt-meta');
    assert.strictEqual(byStructured.tagConfidence, 'high');
    assert.strictEqual(byStructured.outputNameBase, '题材_探索发现_避难所_结构化标签优先');

    const byId = resolveStandardLabelPath({
        sourceDirectionId: 'dir-shelter',
        sourceRawName: '题材_探索发现_废弃观测站.png',
        directionLibrary: DIRECTION_LIBRARY
    });

    assert.deepStrictEqual(byId.standardLabelPath, ['题材', '探索发现', '避难所']);
    assert.strictEqual(byId.namingSource, 'direction-library-id');
    assert.strictEqual(byId.tagConfidence, 'high');
    assert.strictEqual(byId.matchedDirectionId, 'dir-shelter');

    const byPath = buildCreativeOutputNamingContext({
        sourceDirectionPath: '题材 / 探索发现 / 避难所 / 地下入口',
        directionLibrary: DIRECTION_LIBRARY,
        contentTitle: '地下补给仓发现'
    });

    assert.deepStrictEqual(byPath.standardLabelPath, ['题材', '探索发现', '避难所']);
    assert.strictEqual(byPath.sourceContentTitle, '地下入口');
    assert.strictEqual(byPath.outputNameBase, '题材_探索发现_避难所_地下补给仓发现');

    logPass('structured fields, direction id, and direction path resolve in priority order');
}

function checkCandidatesAndSanitize() {
    assert.deepStrictEqual(
        parseLabelCandidatesFromName('GOFCNIM6724_DR_题材_探索发现_避难所形象拓展_800x800.png'),
        ['题材', '探索发现', '避难所形象拓展']
    );

    assert.deepStrictEqual(
        parseLabelCandidatesFromName('D:\\工作\\题材\\探索发现\\废弃观测站.png').slice(-3),
        ['题材', '探索发现', '废弃观测站']
    );

    assert.strictEqual(
        sanitizeFileNamePart(' 夜间:求生/信号*  ', 20),
        '夜间_求生_信号'
    );

    assert.strictEqual(
        buildOutputNameBase({
            standardLabelPath: ['题材', '探索发现'],
            contentTitle: '夜间:求生/信号*',
            maxLength: 13
        }),
        '题材_探索发现_夜间_求生'
    );

    logPass('candidate parsing and filename sanitizing are stable');
}

function checkLibraryShapesAndFallback() {
    const objectLibrary = normalizeDirectionLibrary({
        directions: [{ id: 'dir-a', primaryTag: '题材', secondaryTag: '探索发现', tertiaryTag: '避难所' }]
    });
    assert.deepStrictEqual(objectLibrary[0].path, ['题材', '探索发现', '避难所']);

    const stringLibraryContext = buildCreativeOutputNamingContext({
        sourceRawName: '题材_探索发现_废弃观测站.png',
        directionLibrary: '题材 / 探索发现',
        contentTitle: '夜间求生信号'
    });
    assert.strictEqual(stringLibraryContext.outputNameBase, '题材_探索发现_夜间求生信号');

    const fallbackContext = buildCreativeOutputNamingContext({
        sourceRawName: 'GOFCNIM6724_DR_废墟暖光补给_800x800.png',
        directionLibrary: DIRECTION_LIBRARY,
        contentTitle: '夜间求生信号'
    });

    assert.deepStrictEqual(fallbackContext.standardLabelPath, []);
    assert.strictEqual(fallbackContext.namingSource, 'none');
    assert.strictEqual(fallbackContext.tagConfidence, 'missing');
    assert.strictEqual(fallbackContext.outputNameBase, '夜间求生信号');

    logPass('direction library shapes and no-label fallback are supported');
}

function main() {
    checkAcceptanceSamples();
    checkResolutionPriority();
    checkCandidatesAndSanitize();
    checkLibraryShapesAndFallback();
    console.log('[creative-output-naming S1] Unified naming service checks passed.');
}

main();
