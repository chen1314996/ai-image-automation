const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { createMaterialAnalysisService } = require('../src/services/material-analysis');
const { MaterialVisionCache } = require('../src/services/material-analysis/vision/vision-cache');
const { createMaterialCreativeExpansionService } = require('../src/services/material-analysis/creative-expansion');

function csvEscape(value) {
    return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function buildCsv() {
    const rows = [
        ['name', 'spend', 'CTR', 'installs', 'CVR', 'CPI', 'IPM', 'D0 ROI', 'content'],
        ['GO_TEST_BJ_题材_自然危机_坠落危机_800x800', 120000, '4.5%', 24000, '18%', 5, 8.1, '1.2%', 'https://example.invalid/a.png'],
        ['GO_TEST_BJ_题材_自然危机_坠落危机_1024x1024', 88000, '3.2%', 12000, '14%', 7.3, 6.2, '0.4%', 'https://example.invalid/b.png'],
        ['GO_TEST_BJ_题材_探索发现_避难所堡垒_800x800', 76000, '2.8%', 9800, '12%', 7.75, 4.2, '0.2%', 'https://example.invalid/c.png']
    ];
    return rows.map(row => row.map(csvEscape).join(',')).join('\n');
}

async function run() {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'material-analysis-expansion-test-'));
    const analysisService = createMaterialAnalysisService({
        rootDir: tempRoot,
        logger: { success() {} }
    });
    const imported = analysisService.importTable({
        projectName: '无尽冬日',
        weekId: '2026-W21',
        fileName: 'creative-expansion-test.csv',
        fileContent: buildCsv()
    });

    const cache = new MaterialVisionCache(tempRoot);
    cache.writeRun(imported.summary.runId, {
        status: {
            runId: imported.summary.runId,
            running: false,
            total: 3,
            completed: 3,
            successCount: 3
        },
        results: imported.top100.map((material, index) => ({
            materialId: material.materialId,
            runId: imported.summary.runId,
            status: 'success',
            vision: {
                summary: `视觉总结${index + 1}`,
                mainSubject: '求生人物',
                scene: '冰雪废墟',
                event: '即时危机',
                hook: '危险逼近',
                suggestedDirection: '自然危机 / 坠落危机',
                retainElements: ['即时危机', '人物求生动作'],
                variationAxes: ['场景', '人物关系', '道具', '镜头'],
                riskNotes: ['主体过小', '危险关系不清']
            },
            iterationAdvice: '保留危机关系，变化镜头。'
        }))
    });

    const service = createMaterialCreativeExpansionService({
        rootDir: tempRoot,
        analysisService,
        llmClient: async ({ settings }) => ({
            newDirections: Array.from({ length: settings.newDirectionsPerSource }).map((_, directionIndex) => ({
                name: `测试新方向${directionIndex + 1}`,
                description: '用不同场景机制拉开差异',
                sourceStrategy: '场景/镜头',
                prompts: Array.from({ length: settings.promptGroupsPerNewDirection }).map((__, promptIndex) => ({
                    title: `提示词${promptIndex + 1}`,
                    prompt: `画面提示词 ${directionIndex + 1}-${promptIndex + 1}，主体、动作、场景、危机关系、构图、光线、材质完整。`
                }))
            }))
        })
    });

    const targetResult = service.getCreativeTargets(imported.summary.runId, {
        defaultPromptGroupsPerNewDirection: 4
    });
    assert.strictEqual(targetResult.success, true);
    assert.strictEqual(targetResult.targets.length, imported.top100.length);
    assert.strictEqual(targetResult.settings.newDirectionsPerSource, 3);
    assert.strictEqual(targetResult.settings.targetMode, 'top100-material');
    assert.deepStrictEqual(targetResult.settings.aggregateBy, ['Top100 素材']);
    assert.strictEqual(new Set(targetResult.targets.map(target => target.targetKey)).size, imported.top100.length);
    assert.ok(targetResult.targets.every(target => target.targetType === 'top100-material'));
    assert.ok(targetResult.targets.every(target => target.materialCount === 1));
    assert.ok(targetResult.targets[0].sourceDirectionPath.includes('题材'));

    const selectedKeys = targetResult.targets.slice(0, 2).map(target => target.targetKey);
    const poolResult = await service.createPromptPool(imported.summary.runId, {
        targetKeys: selectedKeys,
        defaultPromptGroupsPerNewDirection: 4,
        overrides: {
            [selectedKeys[0]]: 3
        }
    });
    assert.strictEqual(poolResult.success, true);
    assert.strictEqual(poolResult.pool.targetCount, 2);
    assert.strictEqual(poolResult.pool.settings.newDirectionsPerSource, 3);
    assert.strictEqual(poolResult.pool.settings.promptGroupsByTarget[selectedKeys[0]], 3);
    assert.strictEqual(poolResult.pool.settings.promptGroupsByTarget[selectedKeys[1]], 4);
    assert.strictEqual(poolResult.pool.promptCount, (3 * 3) + (3 * 4));
    assert.ok(poolResult.pool.prompts.every(item => item.prompt && item.direction && item.promptTitle));
    assert.ok(fs.existsSync(poolResult.jsonPath));
    assert.ok(fs.existsSync(poolResult.jsPath));
    assert.ok(fs.readFileSync(poolResult.jsPath, 'utf8').includes('window.MATERIAL_CREATIVE_PROMPT_POOL'));

    const readBack = service.readPromptPool(poolResult.pool.expansionId);
    assert.strictEqual(readBack.success, true);
    assert.strictEqual(readBack.pool.promptCount, poolResult.pool.promptCount);

    fs.rmSync(tempRoot, { recursive: true, force: true });
    console.log('material-analysis creative expansion test passed');
}

run().catch(error => {
    console.error(error);
    process.exit(1);
});
