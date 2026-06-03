const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { createMaterialAnalysisService } = require('../src/services/material-analysis');

function findSampleCsv() {
    const downloads = path.join(os.homedir(), 'Downloads');
    if (!fs.existsSync(downloads)) {
        throw new Error('Downloads folder not found');
    }
    const fileName = fs.readdirSync(downloads).find(name => name.endsWith('1779785458434.csv'));
    if (!fileName) {
        throw new Error('Sample material CSV not found in Downloads');
    }
    return path.join(downloads, fileName);
}

function run() {
    const samplePath = findSampleCsv();
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'material-analysis-test-'));
    const service = createMaterialAnalysisService({
        rootDir: tempRoot,
        logger: { success() {} }
    });
    const result = service.importTable({
        projectName: 'test-project',
        weekId: 'test-week',
        fileName: path.basename(samplePath),
        fileContent: fs.readFileSync(samplePath, 'utf8')
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.summary.materialRows, 17655);
    assert.strictEqual(result.summary.top100Count, 100);
    assert.strictEqual(result.top100[0].spend, 187276.14);
    assert.ok(result.top100[0].contentUrl.startsWith('https://dp-cls-cos.campfiregames.cn/creatives/'));
    assert.ok(result.top100[0].contentUrl.endsWith('.jpg'));
    assert.strictEqual(result.top100[0].parsedName.primary, '题材');
    assert.strictEqual(result.top100[0].parsedName.secondary, '探索发现');
    assert.strictEqual(result.top100[0].parsedName.size, '800x800');
    assert.ok(result.top100[0].health);
    assert.strictEqual(result.top100[0].health.tag.key, 'high_spend_low_roi');
    assert.ok(result.top100[0].health.score < 50);
    assert.ok(result.overview);
    assert.ok(Array.isArray(result.directions));
    assert.ok(result.directions.length > 0);
    assert.ok(result.directions[0].status);
    assert.ok(typeof result.directions[0].action === 'string');
    assert.ok(result.overview.avgTopHealthScore >= 0);
    assert.ok(result.overview.conclusion);
    assert.ok(result.summary.parsedPrimaryRate > 0.9);
    assert.ok(result.summary.parsedSizeRate > 0.9);
    assert.ok(fs.existsSync(path.join(result.summary.runDir, 'top100.json')));

    fs.rmSync(tempRoot, { recursive: true, force: true });
    console.log('material-analysis parser test passed');
}

run();
