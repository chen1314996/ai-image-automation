const fs = require('fs');
const path = require('path');

const { renameImages } = require('../src/services/image-renamer');
const { createPostprocessTraceService } = require('../src/services/postprocess-trace');
const {
    extractSourceBusinessName
} = require('../src/services/output-naming/source-business-name');

const ROOT = path.join(__dirname, '..');
const TEST_ROOT = path.join(ROOT, 'runtime', 's10-postprocess-trace-test');
const SOURCE_DIR = path.join(TEST_ROOT, 'source-assets');
const DATA_DIR = path.join(TEST_ROOT, 'data', 'creative-knowledge');

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function writeTinyPng(filePath) {
    const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lA0FqwAAAABJRU5ErkJggg==';
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, Buffer.from(pngBase64, 'base64'));
}

function resetTestRoot() {
    const resolved = path.resolve(TEST_ROOT);
    const runtimeRoot = path.resolve(path.join(ROOT, 'runtime'));
    assert(resolved.startsWith(runtimeRoot), 'Refusing to delete outside runtime directory');
    fs.rmSync(resolved, { recursive: true, force: true });
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.mkdirSync(SOURCE_DIR, { recursive: true });
}

function readAssets() {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'assets.json'), 'utf8'));
}

async function main() {
    resetTestRoot();

    const generatedName = '20260603_103821_0016_题材_探索发现_妙思结合指南针等UI和幸存者宠物载具05_雪后初晴宠物协作解救行动_v04_20260603_104609.png';
    const sourceFile = path.join(SOURCE_DIR, generatedName);
    writeTinyPng(sourceFile);

    const parsedGenerated = extractSourceBusinessName(generatedName);
    assert(parsedGenerated.businessName === '题材_探索发现_妙思结合指南针等UI和幸存者宠物载具05_雪后初晴宠物协作解救行动', 'generated Legil name should keep only business parts');
    const parsedTwoLevel = extractSourceBusinessName('20260603_103821_0016_题材_探索发现_v04_20260603_104609.png');
    assert(parsedTwoLevel.businessName === '题材_探索发现', 'generated Legil name should allow only primary and secondary tags');
    const parsedOld = extractSourceBusinessName('GOFCNIM13535_DR_题材_探索发现_微缩世界垃圾桶_800x800.jpg');
    assert(parsedOld.businessName === '题材_探索发现_微缩世界垃圾桶', 'old GOFCNIM name should drop old prefix and size');

    fs.writeFileSync(path.join(DATA_DIR, 'assets.json'), JSON.stringify({
        version: 1,
        updatedAt: new Date().toISOString(),
        assets: [{
            assetId: 'asset_s10_trace_001',
            runId: 'run_s10_trace_001',
            promptHash: 'prompt_s10_trace_001',
            promptIndex: 1,
            filePath: sourceFile,
            fileName: path.basename(sourceFile),
            savedAt: new Date().toISOString()
        }]
    }, null, 2), 'utf8');

    const traceService = createPostprocessTraceService({
        rootDir: TEST_ROOT,
        logger: {
            info() {},
            warn() {}
        }
    });

    const prepared = traceService.prepareAssets({
        assetIds: ['asset_s10_trace_001']
    });
    assert(prepared.success, 'prepareAssets should succeed');
    assert(prepared.count === 1, 'prepareAssets should copy one asset');
    assert(fs.existsSync(prepared.manifestPath), 'prepareAssets should write manifest');

    const renameOutputFolder = path.join(TEST_ROOT, 'renamed-assets');
    const renameResult = renameImages({
        inputFolder: prepared.outputFolder,
        outputFolder: renameOutputFolder,
        fixedPrefix: 'S10',
        startNumber: '001',
        regionText: 'BJ',
        channelText: 'QA',
        primaryTag: 'Topic',
        secondaryTag: 'Vehicle'
    });
    assert(renameResult.copiedCount === 1, 'renameImages should copy one image');
    assert(
        renameResult.copied[0].outputName === 'S10001_BJ_QA_题材_探索发现_妙思结合指南针等UI和幸存者宠物载具05_雪后初晴宠物协作解救行动_1x1.png',
        'renameImages should inherit generated business name and drop v/timestamps'
    );

    const trace = traceService.recordOperationResult({
        operation: 'rename',
        result: renameResult,
        successItemsKey: 'copied',
        failedItemsKey: 'failed',
        config: renameResult.rule || {}
    });
    assert(trace.success, 'recordOperationResult should succeed');
    assert(trace.derivativeCount === 1, 'recordOperationResult should register one derivative');
    assert(trace.unmatchedCount === 0, 'recordOperationResult should match source asset through manifest');

    const updated = readAssets();
    const asset = updated.assets.find(item => item.assetId === 'asset_s10_trace_001');
    assert(asset, 'asset should remain in assets.json');
    assert(asset.postprocess, 'asset should have postprocess block');
    assert(Array.isArray(asset.postprocess.derivatives), 'asset should have derivative list');
    assert(asset.postprocess.derivatives.length === 1, 'asset should have one derivative');

    const derivative = asset.postprocess.derivatives[0];
    assert(derivative.operation === 'rename', 'derivative operation should be rename');
    assert(derivative.sourceAssetId === 'asset_s10_trace_001', 'derivative should preserve sourceAssetId');
    assert(derivative.sourceRunId === 'run_s10_trace_001', 'derivative should preserve sourceRunId');
    assert(derivative.sourcePromptId === 'prompt_s10_trace_001', 'derivative should preserve sourcePromptId');
    assert(fs.existsSync(derivative.outputPath), 'derivative output should exist');

    console.log('S10 postprocess trace test passed');
    console.log(JSON.stringify({
        preparedFolder: prepared.outputFolder,
        derivativeId: derivative.derivativeId,
        outputPath: derivative.outputPath
    }, null, 2));

    if (process.env.KEEP_S10_TRACE_TEST !== '1') {
        fs.rmSync(TEST_ROOT, { recursive: true, force: true });
    }
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
