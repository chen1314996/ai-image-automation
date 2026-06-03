const assert = require('assert');

const legilAutomation = require('../src/services/legil');
const {
    buildCreativeOutputNamingContext,
    buildOutputNameBase,
    sanitizeFileNamePart
} = require('../src/services/output-naming/creative-output-naming');

const DIRECTION_LIBRARY = [
    { id: 'dir-topic', path: '题材' },
    { id: 'dir-explore', path: '题材 / 探索发现' },
    { id: 'dir-shelter', path: '题材 / 探索发现 / 避难所' },
    { id: 'dir-observatory', path: '题材 / 探索发现 / 废弃观测站' }
];

function assertOutputName(input, expectedBase, message) {
    const context = buildCreativeOutputNamingContext({
        directionLibrary: DIRECTION_LIBRARY,
        ...input
    });
    assert.strictEqual(context.outputNameBase, expectedBase, message);
    return context;
}

function checkCreativeDirectionLevels() {
    const level1 = assertOutputName({
        sourceDirectionPath: '题材',
        contentTitle: '冰封地铁站避难'
    }, '题材_冰封地铁站避难', 'level 1 direction should keep only primary tag plus content title');
    assert.deepStrictEqual(level1.standardLabelPath, ['题材']);

    const level2 = assertOutputName({
        sourceDirectionPath: '题材 / 探索发现',
        contentTitle: '夜间求生信号'
    }, '题材_探索发现_夜间求生信号', 'level 2 direction should keep primary and secondary tags');
    assert.deepStrictEqual(level2.standardLabelPath, ['题材', '探索发现']);

    const level3 = assertOutputName({
        sourceDirectionPath: '题材 / 探索发现 / 避难所',
        contentTitle: '雪原信号塔救援'
    }, '题材_探索发现_避难所_雪原信号塔救援', 'level 3 direction should keep standard tertiary tag');
    assert.deepStrictEqual(level3.standardLabelPath, ['题材', '探索发现', '避难所']);

    const belowLevel3 = assertOutputName({
        sourceDirectionPath: '题材 / 探索发现 / 避难所 / 地下入口',
        contentTitle: '地下补给仓发现'
    }, '题材_探索发现_避难所_地下补给仓发现', 'level 4+ direction should truncate standard labels to level 3');
    assert.deepStrictEqual(belowLevel3.standardLabelPath, ['题材', '探索发现', '避难所']);
    assert.strictEqual(belowLevel3.sourceContentTitle, '地下入口');
}

function checkMaterialAndBatchResolution() {
    const material = assertOutputName({
        sourceRawName: 'GOFCNIM6724_DR_题材_探索发现_避难所形象拓展_800x800',
        contentTitle: '雪原信号塔救援'
    }, '题材_探索发现_避难所_雪原信号塔救援', 'material old content should normalize to standard tertiary tag');
    assert.deepStrictEqual(material.standardLabelPath, ['题材', '探索发现', '避难所']);
    assert.strictEqual(material.sourceContentTitle, '避难所形象拓展');
    assert.strictEqual(material.namingSource, 'direction-library-fuzzy');
    assert.strictEqual(material.tagConfidence, 'medium');

    const ordinaryTwoLevel = buildCreativeOutputNamingContext({
        sourceRawName: '题材_探索发现_废弃观测站.png',
        directionLibrary: [
            { id: 'dir-explore', path: '题材 / 探索发现' }
        ],
        contentTitle: '夜间求生信号'
    });
    assert.deepStrictEqual(ordinaryTwoLevel.standardLabelPath, ['题材', '探索发现']);
    assert.strictEqual(ordinaryTwoLevel.sourceContentTitle, '废弃观测站');
    assert.strictEqual(ordinaryTwoLevel.outputNameBase, '题材_探索发现_夜间求生信号');
    assert.ok(!ordinaryTwoLevel.outputNameBase.includes('废弃观测站_夜间求生信号'));

    const ordinaryThreeLevel = assertOutputName({
        sourceRawName: '题材_探索发现_废弃观测站.png',
        contentTitle: '夜间求生信号'
    }, '题材_探索发现_废弃观测站_夜间求生信号', 'standard tertiary segment in original image name should be preserved');
    assert.deepStrictEqual(ordinaryThreeLevel.standardLabelPath, ['题材', '探索发现', '废弃观测站']);
    assert.strictEqual(ordinaryThreeLevel.sourceContentTitle, '');
}

function checkStrictLibraryTagGate() {
    const strictDirectionLibrary = [
        { id: 'dir-building', path: 'TopicTag / ExploreTag / BuildingTag' },
        { id: 'dir-shelter', path: 'TopicTag / ExploreTag / ShelterTag' }
    ];

    const rawNameContext = buildCreativeOutputNamingContext({
        sourceRawName: 'GOFCNIM19410_DR_TopicTag_ExploreTag_OldLongIdea_1080x1920',
        directionLibrary: strictDirectionLibrary,
        contentTitle: 'Snow Rescue'
    });
    assert.deepStrictEqual(rawNameContext.standardLabelPath, ['TopicTag', 'ExploreTag']);
    assert.strictEqual(rawNameContext.sourceContentTitle, 'OldLongIdea');
    assert.deepStrictEqual(rawNameContext.droppedLabelParts, ['OldLongIdea']);
    assert.strictEqual(rawNameContext.tagConfidence, 'low');
    assert.strictEqual(rawNameContext.outputNameBase, 'TopicTag_ExploreTag_Snow_Rescue');

    const promptMetaContext = buildCreativeOutputNamingContext({
        standardLabelPath: ['TopicTag', 'ExploreTag', 'OldLongIdea'],
        directionLibrary: strictDirectionLibrary,
        contentTitle: 'Snow Rescue'
    });
    assert.deepStrictEqual(promptMetaContext.standardLabelPath, ['TopicTag', 'ExploreTag']);
    assert.strictEqual(promptMetaContext.sourceContentTitle, 'OldLongIdea');
    assert.deepStrictEqual(promptMetaContext.droppedLabelParts, ['OldLongIdea']);
    assert.strictEqual(promptMetaContext.outputNameBase, 'TopicTag_ExploreTag_Snow_Rescue');

    const noLabelContext = buildCreativeOutputNamingContext({
        sourceRawName: 'GOFCNIM19410_DR_UnknownIdea_1080x1920',
        directionLibrary: strictDirectionLibrary,
        contentTitle: 'Fresh Concept'
    });
    assert.deepStrictEqual(noLabelContext.standardLabelPath, []);
    assert.strictEqual(noLabelContext.outputNameBase, 'Fresh_Concept');
}

function checkSanitizeLengthAndFallback() {
    assert.strictEqual(
        sanitizeFileNamePart(' 夜间:求生/信号*?<>|  ', 40),
        '夜间_求生_信号',
        'Windows-illegal filename characters should be cleaned'
    );

    const longBase = buildOutputNameBase({
        standardLabelPath: ['题材', '探索发现', '避难所'],
        contentTitle: '超长标题'.repeat(40),
        maxLength: 36
    });
    assert.ok(longBase.length <= 36, 'outputNameBase should be capped by maxLength');
    assert.ok(!longBase.endsWith('_'), 'trimmed outputNameBase should not leave trailing underscores');

    const fallback = buildCreativeOutputNamingContext({
        sourceRawName: 'GOFCNIM6724_DR_未知旧内容_800x800.png',
        directionLibrary: DIRECTION_LIBRARY,
        contentTitle: '无标签新内容'
    });
    assert.deepStrictEqual(fallback.standardLabelPath, []);
    assert.strictEqual(fallback.namingSource, 'none');
    assert.strictEqual(fallback.tagConfidence, 'missing');
    assert.strictEqual(fallback.outputNameBase, '无标签新内容');
}

function checkFullFileNameFormat() {
    const fileName = legilAutomation.buildOutputFileName(1, {
        outputSequence: 1,
        outputTotal: 1,
        runId: 'creative_20260602_153012',
        outputNameBase: '题材_探索发现_避难所_雪原信号塔救援',
        promptTitle: '不应进入文件名的prompt标题',
        variantIndex: 1
    });
    assert.match(
        fileName,
        /^creative_20260602_153012_0001_题材_探索发现_避难所_雪原信号塔救援_v01_\d{8}_\d{6}\.png$/
    );
    assert.ok(!fileName.includes('不应进入文件名的prompt标题'));
}

function main() {
    checkCreativeDirectionLevels();
    checkMaterialAndBatchResolution();
    checkStrictLibraryTagGate();
    checkSanitizeLengthAndFallback();
    checkFullFileNameFormat();
    console.log('[creative-output-naming] Stable naming rule checks passed.');
}

main();
