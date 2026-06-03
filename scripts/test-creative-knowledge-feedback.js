const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createCreativeKnowledgeService } = require('../src/services/creative-knowledge');

function writeJson(filePath, data) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function writeTinyPng(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
        'base64'
    );
    fs.writeFileSync(filePath, png);
}

function seed(root) {
    const dataDir = path.join(root, 'data', 'creative-knowledge');
    const outputDir = path.join(root, 'output');
    const assetAPath = path.join(outputDir, 'asset-a.png');
    const assetBPath = path.join(outputDir, 'asset-b.png');
    writeTinyPng(assetAPath);
    writeTinyPng(assetBPath);

    writeJson(path.join(dataDir, 'metadata.json'), {
        version: 1,
        importedAt: '2026-05-27T00:00:00.000Z',
        counts: {
            directions: 1,
            topMaterials: 0,
            topMaterialInsights: 0,
            referenceImages: 0
        },
        warnings: []
    });
    writeJson(path.join(dataDir, 'directions.json'), {
        version: 1,
        importedAt: '2026-05-27T00:00:00.000Z',
        directions: [{
            id: 'direction-a',
            path: '题材/探索发现/围墙',
            name: '围墙',
            primaryTag: '题材',
            autoRun: true
        }]
    });
    writeJson(path.join(dataDir, 'reference-images.json'), {
        version: 1,
        images: []
    });
    writeJson(path.join(dataDir, 'assets.json'), {
        version: 1,
        updatedAt: '2026-05-27T00:00:00.000Z',
        assets: [
            {
                assetId: 'asset-a',
                runId: 'run-a',
                directionId: 'direction-a',
                directionPath: '题材/探索发现/围墙',
                directionName: '围墙',
                promptHash: 'prompt-a',
                promptDirection: '冰封围墙入口发现',
                promptTitle: '提示词1',
                promptIndex: 1,
                outputIndex: 1,
                prompt: '主题：冰封围墙入口发现，画面内容：幸存者在厚重结霜的围墙入口前警惕探索。',
                filePath: assetAPath,
                fileName: 'asset-a.png',
                savedAt: '2026-05-27T00:10:00.000Z'
            },
            {
                assetId: 'asset-b',
                runId: 'run-a',
                directionId: 'direction-a',
                directionPath: '题材/探索发现/围墙',
                directionName: '围墙',
                promptHash: 'prompt-a',
                promptDirection: '冰封围墙入口发现',
                promptTitle: '提示词1',
                promptIndex: 1,
                outputIndex: 2,
                prompt: '主题：冰封围墙入口发现，画面内容：幸存者在厚重结霜的围墙入口前警惕探索。',
                filePath: assetBPath,
                fileName: 'asset-b.png',
                savedAt: '2026-05-27T00:11:00.000Z'
            }
        ]
    });
    writeJson(path.join(dataDir, 'feedback.json'), {
        version: 1,
        feedback: [],
        updatedAt: '2026-05-27T00:00:00.000Z'
    });
    writeJson(path.join(dataDir, 'scheduler-state.json'), {
        version: 1,
        status: 'idle',
        daily: {
            date: '2026-05-27',
            imageCount: 0,
            imageLimit: 1000
        }
    });

    return { dataDir };
}

function logPass(message) {
    console.log(`[S2] OK - ${message}`);
}

function main() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'creative-knowledge-s2-'));
    try {
        const { dataDir } = seed(root);
        const service = createCreativeKnowledgeService({
            rootDir: root,
            logger: { info() {}, error() {} }
        });

        const before = service.listAssets({ limit: 10 });
        assert.strictEqual(before.success, true);
        assert.strictEqual(before.reviewCounts.unreviewed, 2);
        assert.strictEqual(before.assets[0].reviewStatus, 'unreviewed');
        logPass('assets start as unreviewed');

        const review = service.reviewAsset('asset-a', {
            status: 'good',
            labels: ['可以量产', '可以拓展', '不存在的标签'],
            note: '入口主题明确，可以继续拓展。'
        });
        assert.strictEqual(review.success, true);
        assert.strictEqual(review.asset.reviewStatus, 'good');
        assert.deepStrictEqual(review.asset.reviewLabels, ['可以量产', '可以拓展']);
        assert.strictEqual(review.feedback.status, 'good');
        assert.strictEqual(review.feedback.assetId, 'asset-a');
        assert.strictEqual(review.feedback.feedbackTargetType, 'asset');
        assert.strictEqual(review.feedback.promptHash, 'prompt-a');
        assert.ok(review.feedback.prompt);
        logPass('reviewAsset updates the asset and appends a normalized feedback record');

        const persistedAssets = JSON.parse(fs.readFileSync(path.join(dataDir, 'assets.json'), 'utf8'));
        const persistedFeedback = JSON.parse(fs.readFileSync(path.join(dataDir, 'feedback.json'), 'utf8'));
        assert.strictEqual(persistedAssets.assets[0].review.status, 'good');
        assert.strictEqual(persistedFeedback.feedback.length, 1);
        assert.strictEqual(persistedFeedback.feedback[0].note, '入口主题明确，可以继续拓展。');
        logPass('assets.json and feedback.json persist the review');

        const goodAssets = service.listAssets({ reviewStatus: 'good' });
        assert.strictEqual(goodAssets.total, 1);
        assert.strictEqual(goodAssets.assets[0].assetId, 'asset-a');

        const unreviewedAssets = service.listAssets({ reviewStatus: 'unreviewed' });
        assert.strictEqual(unreviewedAssets.total, 1);
        assert.strictEqual(unreviewedAssets.assets[0].assetId, 'asset-b');
        logPass('assets can be filtered by review status');

        const feedback = service.listFeedback({ assetId: 'asset-a' });
        assert.strictEqual(feedback.success, true);
        assert.strictEqual(feedback.total, 1);
        assert.strictEqual(feedback.feedback[0].labels.includes('可以量产'), true);
        logPass('feedback can be queried and traced back to the asset');

        const promptFeedback = service.createFeedback({
            feedbackTargetType: 'prompt',
            status: 'bad',
            runId: 'run-a',
            directionId: 'direction-a',
            directionPath: 'topic/explore/wall',
            directionName: 'wall',
            promptHash: 'prompt-a',
            promptDirection: 'wall entrance discovery',
            promptTitle: 'prompt text',
            prompt: 'manual prompt variant with too much interface text',
            original: 'interface-heavy prompt',
            modified: 'physical prop-driven prompt',
            note: 'manual prompt edit prefers physical props over interface text'
        });
        assert.strictEqual(promptFeedback.success, true);
        assert.strictEqual(promptFeedback.feedback.feedbackTargetType, 'prompt');
        assert.strictEqual(promptFeedback.feedback.promptHash, 'prompt-a');
        assert.ok(promptFeedback.feedback.modified.includes('physical prop'));

        const promptSearch = service.listFeedback({ q: 'interface text' });
        assert.strictEqual(promptSearch.success, true);
        assert.strictEqual(promptSearch.total, 1);
        assert.strictEqual(promptSearch.feedback[0].feedbackTargetType, 'prompt');
        logPass('prompt-only feedback can be saved and searched by prompt/edit fields');

        const overview = service.getOverview();
        assert.strictEqual(overview.counts.reviewedAssets, 1);
        assert.strictEqual(overview.counts.goodAssets, 1);
        assert.strictEqual(overview.counts.unreviewedAssets, 1);
        assert.strictEqual(overview.counts.feedback, 2);
        logPass('overview review statistics are updated');

        assert.throws(
            () => service.reviewAsset('asset-a', { status: 'great' }),
            /审核状态必须/
        );
        logPass('invalid review statuses are rejected');

        console.log('[S2] Creative knowledge feedback contract is locked.');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

main();
