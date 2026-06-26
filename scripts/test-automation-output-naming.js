const assert = require('assert');

const legilAutomation = require('../src/services/legil');
const {
    buildManagedOutputNamingContext
} = require('../src/services/output-naming/creative-output-naming');

const directionLibrary = [
    { id: 'topic', path: '题材' },
    { id: 'explore', path: '题材 / 探索发现' },
    { id: 'shelter', path: '题材 / 探索发现 / 避难所' },
    { id: 'apocalypse-text', path: '题材 / 探索发现 / 末世文字' },
    { id: 'migration', path: '题材 / 迁徙' },
    { id: 'gameplay', path: '玩法' },
    { id: 'resource', path: '玩法 / 资源采集' },
    { id: 'character', path: '角色展示' },
    { id: 'multi-character', path: '角色展示 / 多角色展示' }
];

function build(input) {
    return buildManagedOutputNamingContext({
        directionLibrary,
        ...input
    });
}

function assertBase(input, expected, message) {
    const context = build(input);
    assert.strictEqual(context.outputNameBase, expected, message);
    assert.ok(context.automationContentTitle.startsWith('自动化'), 'automation title should start with 自动化');
    assert.ok(!context.automationContentTitle.includes('自动化自动化'), 'automation title should not duplicate prefix');
    assert.ok(context.finalContentTitle.length >= 4 && context.finalContentTitle.length <= 8, `short title length should be 4-8: ${context.finalContentTitle}`);
    return context;
}

function main() {
    const level1 = assertBase({
        sourceDirectionPath: '题材',
        contentTitle: '雪地求生信号',
        mode: 'batch-generate'
    }, '题材_自动化雪地求生信号', 'level 1 labels should become 一级_自动化短名');
    assert.deepStrictEqual(level1.standardLabelPath, ['题材']);

    const level2 = assertBase({
        sourceDirectionPath: '题材 / 探索发现',
        contentTitle: '观测站求生',
        mode: 'batch-generate'
    }, '题材_探索发现_自动化观测站求生', 'level 2 labels should become 一级_二级_自动化短名');
    assert.deepStrictEqual(level2.standardLabelPath, ['题材', '探索发现']);

    const level3 = assertBase({
        sourceDirectionPath: '题材 / 探索发现 / 避难所',
        newDirectionName: '地下入口补给仓',
        mode: 'creative-batch'
    }, '题材_探索发现_避难所_自动化地下入口补给仓', 'level 3 labels should become 一级_二级_三级_自动化短名');
    assert.deepStrictEqual(level3.standardLabelPath, ['题材', '探索发现', '避难所']);

    const deepDirection = assertBase({
        sourceDirectionPath: '题材 / 探索发现 / 避难所 / 地下入口',
        newDirectionName: '地下入口补给仓发现',
        mode: 'creative-batch'
    }, '题材_探索发现_避难所_自动化地下入口补给仓', 'level 4+ should truncate label path to 3 levels and keep detail in short title');
    assert.deepStrictEqual(deepDirection.standardLabelPath, ['题材', '探索发现', '避难所']);

    const sourceName = assertBase({
        sourceRawName: 'GOFCNIM6724_DR_题材_探索发现_避难所形象拓展_800x800.jpg',
        contentTitle: '雪原信号塔救援',
        mode: 'batch-generate'
    }, '题材_探索发现_避难所_自动化雪原信号塔救援', 'old material suffix should be used only as a label clue');
    assert.ok(!sourceName.outputNameBase.includes('避难所形象拓展'));

    const bestFitExplore = assertBase({
        prompt: '幸存者在雪地里发现废弃观测站，红色求救信号灯在暴风雪中闪烁。',
        contentTitle: '观测站求生信号',
        mode: 'batch-generate'
    }, '题材_探索发现_自动化观测站求生信号', 'prompt-only discovery imagery should best-fit 探索发现');
    assert.deepStrictEqual(bestFitExplore.standardLabelPath, ['题材', '探索发现']);
    assert.ok(bestFitExplore.namingSource.startsWith('direction-library-best-fit'));

    const noDuplicatePrefix = assertBase({
        sourceDirectionPath: '题材 / 探索发现 / 末世文字',
        contentTitle: '自动化冰墙标语守夜画面',
        mode: 'creative-batch'
    }, '题材_探索发现_末世文字_自动化冰墙标语守夜', 'existing 自动化 prefix should be normalized to one prefix');
    assert.strictEqual(noDuplicatePrefix.finalContentTitle, '冰墙标语守夜');

    const fileName = legilAutomation.buildOutputFileName(1, {
        outputSequence: 1,
        outputTotal: 1,
        runId: '20260625_153012',
        outputNameBase: '题材_探索发现_避难所_自动化地下入口补给仓',
        variantIndex: 1
    });
    assert.match(
        fileName,
        /^20260625_153012_0001_题材_探索发现_避难所_自动化地下入口补给仓_v01_\d{8}_\d{6}\.png$/,
        'run id, sequence, variant, timestamp and extension should keep the existing Legil file format'
    );

    console.log('[automation-output-naming] Managed automation naming checks passed.');
}

main();
