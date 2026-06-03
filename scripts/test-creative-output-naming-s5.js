const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { CreativeKnowledgeStore } = require('../src/services/creative-knowledge/store');
const { registerRunAssets } = require('../src/services/creative-auto/assets');

function writeImage(filePath, content) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, Buffer.from(content));
}

function findAssetByName(assets, fileName) {
    return assets.find(asset => asset.fileName === fileName);
}

function createPrompt(index, overrides = {}) {
    return {
        index,
        sourceRow: index,
        promptHash: `prompt-hash-${index}`,
        prompt: `生成第 ${index} 张创意图`,
        direction: '雪原信号塔救援',
        primaryTag: '题材',
        secondaryTag: '探索发现',
        tertiaryTag: '避难所',
        standardLabelPath: ['题材', '探索发现', '避难所'],
        sourceDirectionId: 'dir-shelter',
        sourceDirectionPath: '题材 / 探索发现 / 避难所 / 地下入口',
        sourceRawName: 'GOFCNIM6724_DR_题材_探索发现_避难所形象拓展_800x800',
        sourceParsedParts: ['题材', '探索发现', '避难所形象拓展'],
        sourceContentTitle: '避难所形象拓展',
        newDirectionName: '雪原信号塔救援',
        promptTitle: '信号塔点亮',
        contentTitle: '雪原信号塔救援',
        outputNameBase: '题材_探索发现_避难所_雪原信号塔救援',
        namingSource: 'direction-library-fuzzy',
        tagConfidence: 'medium',
        ...overrides
    };
}

function assertNamingContext(asset, expected = {}) {
    assert.strictEqual(asset.primaryTag, expected.primaryTag || '题材');
    assert.strictEqual(asset.secondaryTag, expected.secondaryTag || '探索发现');
    assert.strictEqual(asset.tertiaryTag, expected.tertiaryTag || '避难所');
    assert.deepStrictEqual(asset.standardLabelPath, expected.standardLabelPath || ['题材', '探索发现', '避难所']);
    assert.strictEqual(asset.sourceDirectionId, expected.sourceDirectionId || 'dir-shelter');
    assert.strictEqual(asset.sourceDirectionPath, expected.sourceDirectionPath || '题材 / 探索发现 / 避难所 / 地下入口');
    assert.strictEqual(asset.sourceRawName, expected.sourceRawName || 'GOFCNIM6724_DR_题材_探索发现_避难所形象拓展_800x800');
    assert.deepStrictEqual(asset.sourceParsedParts, expected.sourceParsedParts || ['题材', '探索发现', '避难所形象拓展']);
    assert.strictEqual(asset.sourceContentTitle, expected.sourceContentTitle || '避难所形象拓展');
    assert.strictEqual(asset.newDirectionName, expected.newDirectionName || '雪原信号塔救援');
    assert.strictEqual(asset.promptTitle, expected.promptTitle || '信号塔点亮');
    assert.strictEqual(asset.contentTitle, expected.contentTitle || '雪原信号塔救援');
    assert.strictEqual(asset.outputNameBase, expected.outputNameBase || '题材_探索发现_避难所_雪原信号塔救援');
    assert.strictEqual(asset.namingSource, expected.namingSource || 'direction-library-fuzzy');
    assert.strictEqual(asset.tagConfidence, expected.tagConfidence || 'medium');
}

function main() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'creative-output-naming-s5-'));
    const dataDir = path.join(root, 'data', 'creative-knowledge');
    const outputFolder = path.join(root, 'output');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(outputFolder, { recursive: true });

    const store = new CreativeKnowledgeStore(dataDir);
    store.write('assets.json', { version: 1, assets: [] });

    const fileFromProgress = path.join(outputFolder, 'creative_0001_题材_探索发现_避难所_雪原信号塔救援_v01.png');
    const fileFromPrompt = path.join(outputFolder, 'creative_0002_题材_探索发现_避难所_地下补给仓发现_v01.png');
    const fileFromPromptResult = path.join(outputFolder, 'creative_0003_题材_探索发现_避难所_夜间求生信号_v01.png');
    writeImage(fileFromProgress, 'progress-image');
    writeImage(fileFromPrompt, 'prompt-image');
    writeImage(fileFromPromptResult, 'prompt-result-image');

    const prompts = [
        createPrompt(1),
        createPrompt(2, {
            promptHash: 'prompt-hash-2',
            newDirectionName: '地下补给仓发现',
            contentTitle: '地下补给仓发现',
            outputNameBase: '题材_探索发现_避难所_地下补给仓发现',
            promptTitle: '补给仓门口'
        }),
        createPrompt(3, {
            promptHash: 'prompt-hash-3',
            newDirectionName: '夜间求生信号',
            contentTitle: '夜间求生信号',
            outputNameBase: '题材_探索发现_避难所_夜间求生信号',
            promptTitle: '夜间信号'
        })
    ];

    const run = {
        runId: 'creative-run-s5',
        sourceDirection: {
            id: 'dir-shelter',
            path: '题材 / 探索发现 / 避难所 / 地下入口',
            name: '地下入口',
            primaryTag: '题材',
            secondaryTag: '探索发现',
            tertiaryTag: '避难所'
        },
        config: {
            outputFolder,
            generationSettings: {
                imageModel: 'nano-banana-2',
                outputQuantity: 1
            }
        },
        prompts
    };

    const progress = {
        phase: 'completed',
        saved: 3,
        batchRunId: 'creative_20260602_153012',
        savedFiles: [
            {
                filePath: fileFromProgress,
                promptListIndex: 1,
                imageIndex: 1,
                promptHash: 'prompt-hash-1',
                primaryTag: '题材',
                secondaryTag: '探索发现',
                tertiaryTag: '避难所',
                standardLabelPath: ['题材', '探索发现', '避难所'],
                sourceDirectionId: 'dir-shelter',
                sourceDirectionPath: '题材 / 探索发现 / 避难所 / 地下入口',
                sourceRawName: 'GOFCNIM6724_DR_题材_探索发现_避难所形象拓展_800x800',
                sourceParsedParts: ['题材', '探索发现', '避难所形象拓展'],
                sourceContentTitle: '避难所形象拓展',
                newDirectionName: '雪原信号塔救援',
                promptTitle: '信号塔点亮',
                contentTitle: '雪原信号塔救援',
                outputNameBase: '题材_探索发现_避难所_雪原信号塔救援',
                namingSource: 'direction-library-fuzzy',
                tagConfidence: 'medium',
                savedAt: new Date().toISOString()
            },
            {
                filePath: fileFromPrompt,
                promptListIndex: 2,
                imageIndex: 1,
                promptHash: 'prompt-hash-2',
                savedAt: new Date().toISOString()
            }
        ],
        promptResults: [
            {
                promptListIndex: 3,
                promptHash: 'prompt-hash-3',
                primaryTag: '题材',
                secondaryTag: '探索发现',
                tertiaryTag: '避难所',
                standardLabelPath: ['题材', '探索发现', '避难所'],
                sourceDirectionId: 'dir-shelter',
                sourceDirectionPath: '题材 / 探索发现 / 避难所 / 地下入口',
                sourceRawName: 'GOFCNIM6724_DR_题材_探索发现_废弃观测站.png',
                sourceParsedParts: ['题材', '探索发现', '废弃观测站'],
                sourceContentTitle: '废弃观测站',
                newDirectionName: '夜间求生信号',
                promptTitle: '夜间信号',
                contentTitle: '夜间求生信号',
                outputNameBase: '题材_探索发现_避难所_夜间求生信号',
                namingSource: 'direction-library-exact',
                tagConfidence: 'high',
                savedFiles: [{
                    filePath: fileFromPromptResult,
                    promptListIndex: 3,
                    imageIndex: 1,
                    savedAt: new Date().toISOString()
                }]
            }
        ]
    };

    try {
        const report = registerRunAssets({ store, run, progress });
        assert.strictEqual(report.success, true);
        assert.strictEqual(report.newAssetCount, 3);

        const assetsData = store.read('assets.json', { assets: [] });
        assert.strictEqual(assetsData.assets.length, 3);

        const progressAsset = findAssetByName(assetsData.assets, path.basename(fileFromProgress));
        const promptAsset = findAssetByName(assetsData.assets, path.basename(fileFromPrompt));
        const promptResultAsset = findAssetByName(assetsData.assets, path.basename(fileFromPromptResult));

        assertNamingContext(progressAsset);
        assertNamingContext(promptAsset, {
            newDirectionName: '地下补给仓发现',
            promptTitle: '补给仓门口',
            contentTitle: '地下补给仓发现',
            outputNameBase: '题材_探索发现_避难所_地下补给仓发现'
        });
        assertNamingContext(promptResultAsset, {
            sourceRawName: 'GOFCNIM6724_DR_题材_探索发现_废弃观测站.png',
            sourceParsedParts: ['题材', '探索发现', '废弃观测站'],
            sourceContentTitle: '废弃观测站',
            newDirectionName: '夜间求生信号',
            promptTitle: '夜间信号',
            contentTitle: '夜间求生信号',
            outputNameBase: '题材_探索发现_避难所_夜间求生信号',
            namingSource: 'direction-library-exact',
            tagConfidence: 'high'
        });

        console.log('[creative-output-naming S5] Asset naming context checks passed.');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

main();
