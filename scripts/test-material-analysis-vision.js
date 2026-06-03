const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { createMaterialAnalysisService } = require('../src/services/material-analysis');
const { createMaterialVisionService } = require('../src/services/material-analysis/vision');

function findSampleCsv() {
    const downloads = path.join(os.homedir(), 'Downloads');
    const fileName = fs.readdirSync(downloads).find(name => name.endsWith('1779785458434.csv'));
    if (!fileName) {
        throw new Error('Sample material CSV not found in Downloads');
    }
    return path.join(downloads, fileName);
}

async function waitForDone(service, runId) {
    for (let index = 0; index < 80; index += 1) {
        const status = service.getStatus(runId).status;
        if (!status.running) return status;
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('Vision task did not finish in time');
}

async function run() {
    const samplePath = findSampleCsv();
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'material-analysis-vision-test-'));
    const analysisService = createMaterialAnalysisService({
        rootDir: tempRoot,
        logger: { success() {} }
    });
    const imported = analysisService.importTable({
        projectName: 'test-project',
        weekId: 'vision-week',
        fileName: path.basename(samplePath),
        fileContent: fs.readFileSync(samplePath, 'utf8')
    });

    let apiCalls = 0;
    const fakeClient = {
        validateConfig() {},
        async analyzeImage({ material }) {
            apiCalls += 1;
            if (material.topRank === 3) {
                throw new Error('mock vision failure');
            }
            return {
                rawText: '{"summary":"mock"}',
                result: {
                    summary: `画面总结 ${material.topRank}`,
                    mainSubject: '幸存者',
                    scene: '冰雪废墟',
                    event: '求生',
                    emotion: '紧张',
                    composition: '纵深构图',
                    color: '冷暖对比',
                    hook: '即时危机',
                    retainElements: ['危机关系', '冰雪环境'],
                    variationAxes: ['场景', '人物关系', '镜头角度'],
                    riskNotes: ['主体不要过小'],
                    suggestedDirection: '自然危机 / 求生'
                }
            };
        }
    };
    const fakeFetcher = {
        async fetchImage() {
            return {
                sourceUrl: 'mock://image',
                mimeType: 'image/png',
                dataUrl: 'data:image/png;base64,AA==',
                sizeBytes: 1
            };
        }
    };
    const visionService = createMaterialVisionService({
        rootDir: tempRoot,
        client: fakeClient,
        fetcher: fakeFetcher,
        logger: { info() {}, warn() {}, error() {}, system() {} }
    });

    for (const fileName of ['normalized-materials.json', 'top100.json']) {
        const filePath = path.join(imported.summary.runDir, fileName);
        const rows = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        rows.forEach(row => {
            row.contentUrl = '';
            row.contentText = '';
        });
        fs.writeFileSync(filePath, JSON.stringify(rows, null, 2), 'utf8');
    }
    fs.writeFileSync(
        path.join(imported.summary.runDir, 'source.csv'),
        fs.readFileSync(samplePath, 'utf8').replace(/=HYPERLINK\("[^"]+"\)/g, ''),
        'utf8'
    );

    const blocked = visionService.startRun(imported.summary.runId, { concurrency: 4, retries: 0 });
    assert.strictEqual(blocked.success, false);
    assert.strictEqual(blocked.status.state, 'blocked');
    assert.strictEqual(blocked.status.missingImageCount, 100);

    for (const fileName of ['normalized-materials.json', 'top100.json']) {
        const filePath = path.join(imported.summary.runDir, fileName);
        const rows = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        rows.forEach(row => {
            row.contentUrl = `https://example.invalid/material-analysis/${row.materialId}.png`;
        });
        fs.writeFileSync(filePath, JSON.stringify(rows, null, 2), 'utf8');
    }

    const start = visionService.startRun(imported.summary.runId, { concurrency: 4, retries: 0 });
    assert.strictEqual(start.success, true);
    const status = await waitForDone(visionService, imported.summary.runId);
    assert.strictEqual(status.total, 100);
    assert.strictEqual(status.successCount, 99);
    assert.strictEqual(status.failedCount, 1);

    const results = visionService.getResults(imported.summary.runId);
    assert.strictEqual(results.results.length, 100);
    assert.strictEqual(results.results.filter(item => item.status === 'success').length, 99);
    assert.strictEqual(results.results[0].vision.summary, '画面总结 1');
    assert.ok(results.results[0].iterationAdvice.includes('保留'));

    const runCachePath = path.join(tempRoot, 'data', 'material-analysis', 'vision', 'runs', `${imported.summary.runId}.json`);
    const stalePayload = JSON.parse(fs.readFileSync(runCachePath, 'utf8'));
    stalePayload.status = {
        ...stalePayload.status,
        state: 'running',
        running: true,
        finishedAt: null,
        message: 'mock stale running task'
    };
    fs.writeFileSync(runCachePath, JSON.stringify(stalePayload, null, 2), 'utf8');
    const restartedVisionService = createMaterialVisionService({
        rootDir: tempRoot,
        client: fakeClient,
        fetcher: fakeFetcher,
        logger: { info() {}, warn() {}, error() {}, system() {} }
    });
    const unlockedStatus = restartedVisionService.getStatus(imported.summary.runId).status;
    assert.strictEqual(unlockedStatus.running, false);
    assert.strictEqual(unlockedStatus.state, 'interrupted');
    assert.match(unlockedStatus.message, /自动解锁/);

    const cleared = restartedVisionService.clearRun(imported.summary.runId);
    assert.strictEqual(cleared.success, true);
    assert.strictEqual(cleared.status.running, false);
    assert.strictEqual(cleared.status.state, 'idle');
    assert.strictEqual(cleared.results.length, 100);
    assert.match(cleared.message, /已清除/);

    const apiCallsAfterFirstRun = apiCalls;
    const secondStart = visionService.startRun(imported.summary.runId, { concurrency: 4, retries: 0 });
    assert.strictEqual(secondStart.success, true);
    const secondStatus = await waitForDone(visionService, imported.summary.runId);
    assert.strictEqual(secondStatus.cachedCount, 99);
    assert.strictEqual(apiCalls, apiCallsAfterFirstRun + 1);

    const selectedIds = [
        imported.top100[3].materialId,
        imported.top100[4].materialId
    ];
    const selectedStart = visionService.startRun(imported.summary.runId, {
        materialIds: selectedIds,
        concurrency: 2,
        retries: 0
    });
    assert.strictEqual(selectedStart.success, true);
    assert.strictEqual(selectedStart.status.total, 2);
    const selectedStatus = await waitForDone(visionService, imported.summary.runId);
    assert.strictEqual(selectedStatus.total, 2);
    assert.strictEqual(selectedStatus.successCount, 2);
    assert.strictEqual(selectedStatus.cachedCount, 2);
    assert.strictEqual(apiCalls, apiCallsAfterFirstRun + 1);

    const retry = await visionService.retryMaterial(imported.top100[0].materialId);
    assert.strictEqual(retry.success, true);
    assert.strictEqual(retry.result.status, 'success');
    assert.strictEqual(apiCalls, apiCallsAfterFirstRun + 2);

    const cacheDir = path.join(tempRoot, 'data', 'material-analysis', 'vision', 'cache');
    assert.ok(fs.readdirSync(cacheDir).filter(name => name.endsWith('.json')).length >= 99);

    fs.rmSync(tempRoot, { recursive: true, force: true });
    console.log('material-analysis vision test passed');
}

run().catch(error => {
    console.error(error);
    process.exit(1);
});
