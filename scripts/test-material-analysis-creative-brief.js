const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { createMaterialAnalysisService } = require('../src/services/material-analysis');
const { MaterialVisionCache } = require('../src/services/material-analysis/vision/vision-cache');
const { createMaterialCreativeBriefService } = require('../src/services/material-analysis/creative-brief');

function csvEscape(value) {
    return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function buildCsv() {
    const rows = [
        ['name', 'spend', 'CTR', 'installs', 'CVR', 'CPI', 'IPM', 'D0 ROI', 'D7 ROI', 'content'],
        [
            'GO_TEST_BJ_题材_自然危机_坠落危机_800x800',
            120000,
            '4.5%',
            24000,
            '18%',
            5,
            8.1,
            '1.2%',
            '9.8%',
            'https://example.invalid/material-a.png'
        ],
        [
            'GO_TEST_BJ_题材_自然危机_海啸救援_800x800',
            88000,
            '3.2%',
            12000,
            '14%',
            7.3,
            6.2,
            '0.4%',
            '5.8%',
            'https://example.invalid/material-b.png'
        ],
        [
            'GO_TEST_BJ_题材_探索发现_避难所堡垒_800x800',
            76000,
            '2.8%',
            9800,
            '12%',
            7.75,
            4.2,
            '0.2%',
            '3.2%',
            'https://example.invalid/material-c.png'
        ]
    ];
    return rows.map(row => row.map(csvEscape).join(',')).join('\n');
}

function run() {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'material-analysis-brief-test-'));
    const analysisService = createMaterialAnalysisService({
        rootDir: tempRoot,
        logger: { success() {} }
    });
    const imported = analysisService.importTable({
        projectName: '无尽冬日',
        weekId: '2026-W21',
        fileName: 'brief-test.csv',
        fileContent: buildCsv()
    });

    assert.strictEqual(imported.success, true);
    const first = imported.top100[0];
    const cache = new MaterialVisionCache(tempRoot);
    cache.writeRun(imported.summary.runId, {
        status: {
            runId: imported.summary.runId,
            state: 'completed',
            running: false,
            total: 3,
            completed: 3,
            successCount: 2,
            failedCount: 1
        },
        results: [
            {
                materialId: first.materialId,
                runId: imported.summary.runId,
                status: 'success',
                vision: {
                    summary: '人物正在从断裂冰桥边缘逃生，危机关系清晰。',
                    mainSubject: '求生人物',
                    scene: '冰雪断桥',
                    event: '坠落前救援',
                    hook: '即时危机',
                    suggestedDirection: '自然危机 / 坠落危机',
                    retainElements: ['即时危机', '人物求生动作'],
                    variationAxes: ['场景', '人物关系', '道具', '镜头'],
                    riskNotes: ['主体过小', '危险关系不清']
                },
                iterationAdvice: '保留即时危机，变化人物关系与镜头。'
            },
            {
                materialId: imported.top100[1].materialId,
                runId: imported.summary.runId,
                status: 'failed',
                error: 'mock 429'
            }
        ]
    });

    const briefService = createMaterialCreativeBriefService({ rootDir: tempRoot });
    const materialBrief = briefService.createMaterialBrief(first.materialId, {
        runId: imported.summary.runId
    });
    assert.strictEqual(materialBrief.success, true);
    assert.strictEqual(materialBrief.brief.source, 'material-analysis');
    assert.strictEqual(materialBrief.brief.target, 'material');
    assert.strictEqual(materialBrief.brief.projectName, '无尽冬日');
    assert.ok(materialBrief.brief.performanceSummary.includes('花费'));
    assert.ok(materialBrief.brief.visualInsight.includes('即时危机'));
    assert.ok(materialBrief.brief.directionPath.includes('自然危机'));
    assert.deepStrictEqual(materialBrief.brief.variationAxes.slice(0, 4), ['场景', '人物关系', '道具', '镜头']);
    assert.ok(materialBrief.brief.avoidRules.includes('主体过小'));
    assert.ok(materialBrief.brief.request.includes('Legil'));

    const directionKey = imported.directions[0].directionKey;
    const directionBrief = briefService.createDirectionBrief(directionKey, {
        runId: imported.summary.runId
    });
    assert.strictEqual(directionBrief.success, true);
    assert.strictEqual(directionBrief.brief.target, 'direction');
    assert.strictEqual(directionBrief.brief.directionKey, directionKey);
    assert.ok(directionBrief.brief.performanceSummary.includes('方向素材'));
    assert.ok(Array.isArray(directionBrief.brief.topMaterials));
    assert.ok(directionBrief.brief.topMaterials.length > 0);

    const plan = briefService.createCreativePlan(imported.summary.runId, { limit: 3 });
    assert.strictEqual(plan.success, true);
    assert.strictEqual(plan.plan.source, 'material-analysis');
    assert.strictEqual(plan.plan.target, 'weekly-plan');
    assert.ok(plan.plan.briefs.length > 0);
    assert.ok(plan.plan.performanceSummary.includes('Top100'));
    assert.ok(fs.existsSync(plan.planPath));

    fs.rmSync(tempRoot, { recursive: true, force: true });
    console.log('material-analysis creative brief test passed');
}

run();
