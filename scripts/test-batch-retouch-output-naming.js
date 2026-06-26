const assert = require('assert');

const legilAutomation = require('../src/services/legil');
const {
    buildBatchRetouchOutputNameBase
} = require('../src/services/batch-retouch-controller');

function main() {
    const signalInput = '20260625_185955_0001_题材_信号弹_自动化吊桥绳索上的红色求救_v01_20260625_190254.png';
    const signalBase = buildBatchRetouchOutputNameBase(signalInput);
    assert.strictEqual(
        signalBase,
        '题材_信号弹_自动化吊桥绳索红色求救',
        'batch retouch should remove relation particles instead of hard-cutting the action'
    );
    assert.ok(!signalBase.includes('自动化自动化'), 'automation prefix should not duplicate');

    const migrationInput = '20260625_185955_0003_题材_迁徙_自动化废城街口巨猿举梁开路_v01_20260625_190653.png';
    assert.strictEqual(
        buildBatchRetouchOutputNameBase(migrationInput),
        '题材_迁徙_自动化街口巨猿举梁开路',
        'batch retouch should keep the action/result tail when a title is still too long'
    );

    const generatedInput = '20260625_172310_0003_题材_探索发现_末世文字_自动化雪巷物资争夺手写_v03_20260625_172500.png';
    const generatedBase = buildBatchRetouchOutputNameBase(generatedInput);
    assert.strictEqual(
        generatedBase,
        '题材_探索发现_末世文字_自动化雪巷物资争夺手写',
        '8-char source titles should remain intact'
    );

    const gofcnimInput = 'GOFCNIM28935_BJ_广点通_题材_探索发现_雪崩前的蔬菜雪橇装车_800x800.jpg';
    assert.strictEqual(
        buildBatchRetouchOutputNameBase(gofcnimInput),
        '题材_探索发现_自动化雪崩蔬菜雪橇装车',
        'batch retouch should compact relation particles in GOFCNIM source names'
    );

    assert.strictEqual(
        buildBatchRetouchOutputNameBase('截图 1.png'),
        '未分类_自动化截图_1',
        'untagged inputs should fall back to uncategorized automated source stem'
    );

    const fileName = legilAutomation.buildOutputFileName(1, {
        runId: 'batch-retouch-20260625_190000',
        outputSequence: 3,
        outputTotal: 4,
        outputNameBase: signalBase,
        variantIndex: 2
    });
    assert.match(
        fileName,
        /^batch-retouch-20260625_190000_0004_题材_信号弹_自动化吊桥绳索红色求救_v02_\d{8}_\d{6}\.png$/,
        'batch retouch should use unified Legil output naming with global sequence and variant'
    );

    console.log('[batch-retouch-output-naming] checks passed.');
}

main();
