const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createMaterialAnalysisService } = require('../src/services/material-analysis');
const { MaterialVisionCache } = require('../src/services/material-analysis/vision/vision-cache');
const { createMaterialCreativeExpansionService } = require('../src/services/material-analysis/creative-expansion');
const legilAutomation = require('../src/services/legil');

function csvEscape(value) {
    return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function buildCsv() {
    const rows = [
        ['name', 'spend', 'CTR', 'installs', 'CVR', 'CPI', 'IPM', 'D0 ROI', 'content'],
        ['GOFCNIM6724_DR_题材_探索发现_避难所形象拓展_800x800', 76000, '2.8%', 9800, '12%', 7.75, 4.2, '0.2%', 'https://example.invalid/c.png']
    ];
    return rows.map(row => row.map(csvEscape).join(',')).join('\n');
}

async function main() {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'creative-output-naming-s3-'));
    const dataDir = path.join(tempRoot, 'data', 'creative-knowledge');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'directions.json'), JSON.stringify({
        directions: [
            { id: 'dir-topic', path: '题材' },
            { id: 'dir-explore', path: '题材 / 探索发现' },
            { id: 'dir-shelter', path: '题材 / 探索发现 / 避难所' }
        ]
    }, null, 2), 'utf8');

    const analysisService = createMaterialAnalysisService({
        rootDir: tempRoot,
        logger: { success() {} }
    });
    const imported = analysisService.importTable({
        projectName: '无尽冬日',
        weekId: '2026-W21',
        fileName: 'creative-output-naming-s3.csv',
        fileContent: buildCsv()
    });

    const cache = new MaterialVisionCache(tempRoot);
    cache.writeRun(imported.summary.runId, {
        status: {
            runId: imported.summary.runId,
            running: false,
            total: 1,
            completed: 1,
            successCount: 1
        },
        results: imported.top100.map(material => ({
            materialId: material.materialId,
            runId: imported.summary.runId,
            status: 'success',
            vision: {
                summary: '避难所形象拓展素材，画面里有雪地庇护入口和救援信号。',
                mainSubject: '雪地避难所',
                scene: '冰雪废墟',
                event: '信号救援',
                hook: '雪原信号塔',
                suggestedDirection: '题材 / 探索发现 / 避难所',
                retainElements: ['避难所入口', '救援信号'],
                variationAxes: ['场景', '人物关系', '道具', '镜头'],
                riskNotes: ['主体过小']
            },
            iterationAdvice: '保留避难所识别，但新方向不要继承旧素材名尾段。'
        }))
    });

    const service = createMaterialCreativeExpansionService({
        rootDir: tempRoot,
        analysisService,
        llmClient: async () => ({
            newDirections: [{
                name: '雪原信号塔救援',
                description: '救援信号成为新的画面点击点',
                sourceStrategy: '场景/道具',
                prompts: [{
                    title: '信号塔点亮',
                    prompt: '画面提示词：雪原信号塔救援，主体、动作、场景、危机关系、构图、光线、材质完整。'
                }]
            }]
        })
    });

    try {
        const targetResult = service.getCreativeTargets(imported.summary.runId, {
            defaultPromptGroupsPerNewDirection: 1
        });
        assert.strictEqual(targetResult.success, true);
        assert.strictEqual(targetResult.targets.length, 1);

        const poolResult = await service.createPromptPool(imported.summary.runId, {
            targetKeys: [targetResult.targets[0].targetKey],
            defaultPromptGroupsPerNewDirection: 1,
            directionLibrary: [
                { id: 'dir-topic', path: '题材' },
                { id: 'dir-explore', path: '题材 / 探索发现' },
                { id: 'dir-shelter', path: '题材 / 探索发现 / 避难所' }
            ]
        });

        assert.strictEqual(poolResult.success, true);
        assert.strictEqual(poolResult.pool.promptCount, 1);
        const prompt = poolResult.pool.prompts[0];

        assert.deepStrictEqual(prompt.standardLabelPath, ['题材', '探索发现', '避难所']);
        assert.strictEqual(prompt.sourceRawName, 'GOFCNIM6724_DR_题材_探索发现_避难所形象拓展_800x800');
        assert.strictEqual(prompt.sourceContentTitle, '避难所形象拓展');
        assert.strictEqual(prompt.newDirectionName, '雪原信号塔救援');
        assert.strictEqual(prompt.contentTitle, '雪原信号塔救援');
        assert.strictEqual(prompt.outputNameBase, '题材_探索发现_避难所_雪原信号塔救援');
        assert.strictEqual(prompt.namingSource, 'direction-library-fuzzy');
        assert.strictEqual(prompt.tagConfidence, 'medium');
        assert.ok(!prompt.outputNameBase.includes('避难所形象拓展'));

        const fileName = legilAutomation.buildOutputFileName(1, {
            outputSequence: 1,
            outputTotal: 1,
            runId: 'creative_20260602_153012',
            outputNameBase: prompt.outputNameBase,
            promptTitle: prompt.promptTitle,
            variantIndex: 1
        });

        assert.ok(fileName.includes('题材_探索发现_避难所_雪原信号塔救援'));
        assert.ok(!fileName.includes('题材_探索发现_避难所形象拓展_雪原信号塔救援'));
        assert.ok(!fileName.includes('信号塔点亮'));

        console.log('[creative-output-naming S3] Material-analysis creative expansion naming checks passed.');
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
