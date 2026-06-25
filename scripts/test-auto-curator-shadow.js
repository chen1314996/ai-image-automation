const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createAutoCuratorService } = require('../src/services/auto-curator');

const ROOT = path.join(__dirname, '..');
const testRoot = path.join(ROOT, 'runtime', 'auto-curator-shadow-test');
const knowledgeDir = path.join(testRoot, 'data', 'creative-knowledge');

function writeJson(filePath, data) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

async function main() {
    fs.rmSync(testRoot, { recursive: true, force: true });
    fs.mkdirSync(knowledgeDir, { recursive: true });

    const assets = [
        {
            assetId: 'asset_good_1',
            runId: 'run_p3',
            fileName: 'good.png',
            prompt: 'strong composition, clean subject',
            directionPath: 'A/B/good',
            review: { status: 'good', labels: [], note: 'manual good', reviewedAt: '2026-06-10T00:00:00.000Z' }
        },
        {
            assetId: 'asset_bad_1',
            runId: 'run_p3',
            fileName: 'bad.png',
            prompt: 'weak composition',
            directionPath: 'A/B/bad',
            review: { status: 'bad', labels: [], note: 'manual bad', reviewedAt: '2026-06-10T00:00:00.000Z' }
        },
        {
            assetId: 'asset_low_1',
            runId: 'run_p3',
            fileName: 'low.png',
            prompt: 'uncertain visible text',
            directionPath: 'A/B/low',
            review: { status: 'unreviewed', labels: [], note: '' }
        }
    ];
    writeJson(path.join(knowledgeDir, 'assets.json'), {
        version: 1,
        updatedAt: '',
        assets
    });

    const service = createAutoCuratorService({
        rootDir: testRoot,
        creativeKnowledge: { dataDir: knowledgeDir },
        scoringClient: async ({ asset }) => {
            if (asset.assetId === 'asset_good_1') {
                return { autoScore: 91, confidence: 0.9, autoGrade: 'good', reason: 'clear winner', evidence: ['strong subject'] };
            }
            if (asset.assetId === 'asset_bad_1') {
                return { autoScore: 28, confidence: 0.84, autoGrade: 'bad', reason: 'weak output', evidence: ['low composition quality'] };
            }
            return { autoScore: 63, confidence: 0.41, autoGrade: 'normal', reason: 'uncertain text risk', evidence: ['needs sampling'] };
        }
    });

    const scoreResult = await service.scoreRun('run_p3', { limit: 10 });
    assert.strictEqual(scoreResult.success, true);
    assert.strictEqual(scoreResult.summary.scored, 3);
    assert.strictEqual(scoreResult.summary.lowConfidence, 1);

    const savedAssets = JSON.parse(fs.readFileSync(path.join(knowledgeDir, 'assets.json'), 'utf8')).assets;
    assert.strictEqual(savedAssets[0].review.status, 'good');
    assert.strictEqual(savedAssets[1].review.status, 'bad');
    assert.strictEqual(savedAssets[0].autoReview.autoGrade, 'good');
    assert.strictEqual(savedAssets[2].autoReview.needsHumanReview, true);

    const imported = service.importGoldenSet({ fromReviewed: true, limit: 10 });
    assert.strictEqual(imported.success, true);
    assert.strictEqual(imported.summary.counts.good, 1);
    assert.strictEqual(imported.summary.counts.bad, 1);

    const evaluation = await service.evaluateGoldenSet({ scoreMissing: false });
    assert.strictEqual(evaluation.success, true);
    assert.strictEqual(evaluation.total, 2);
    assert.strictEqual(evaluation.matched, 2);
    assert.strictEqual(evaluation.accuracy, 1);

    const report = service.getShadowReport();
    assert.strictEqual(report.queue.lowConfidence, 1);
    assert.strictEqual(report.consistency.total, 2);
    assert.strictEqual(report.consistency.matched, 2);
    assert.ok(report.lowConfidenceQueue.some(asset => asset.assetId === 'asset_low_1'));

    console.log('Auto Curator P3 shadow acceptance passed.');
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
