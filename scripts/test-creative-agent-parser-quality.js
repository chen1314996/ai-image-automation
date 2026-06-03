const assert = require('assert');
const XLSX = require('xlsx');
const { parseCreativePromptWorkbook } = require('../creative-table-parser');
const {
    buildCreativeAgentQualityReport,
    sanitizeCreativePromptItems
} = require('../creative-agent-quality');

function workbookToBase64(workbook) {
    return XLSX.write(workbook, {
        type: 'buffer',
        bookType: 'xlsx'
    }).toString('base64');
}

function createWorkbook(rows, sheetName = '新方向拓展表') {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), sheetName);
    return workbook;
}

function runParserTest() {
    const workbook = createWorkbook([
        ['参考方向', '新方向名称', '方向描述', '提示词1', '提示词2'],
        [
            '旧方向',
            '冰层补给站',
            '补给站争夺',
            '主题：冰层补给站争夺。画风：高质量3D卡通渲染。画面内容：幸存者围绕补给箱展开争夺，前景有裂冰和散落工具。',
            '主题：暴风雪中的补给运输。画风：高质量3D卡通渲染。画面内容：小队拖拽物资穿过废墟道路，远处有红色警示灯。'
        ]
    ]);

    const parsed = parseCreativePromptWorkbook('agent.xlsx', workbookToBase64(workbook));
    assert.strictEqual(parsed.sheetName, '新方向拓展表');
    assert.strictEqual(parsed.prompts.length, 2);
    assert.strictEqual(parsed.parseStats.totalPromptCount, 2);
    assert.strictEqual(parsed.parseStats.dedupedPromptCount, 2);
    assert.strictEqual(parsed.parseStats.duplicatePromptCount, 0);
    assert.strictEqual(parsed.prompts[0].direction, '冰层补给站');
    assert.strictEqual(parsed.prompts[1].promptTitle, '提示词2');
}

function runParserWithCandidateMetadataColumnsTest() {
    const workbook = createWorkbook([
        ['参考方向', '新方向名称', '方向描述', '提示词1', '目标层级', '氛围', '视角', '广告钩子', '质量风险'],
        [
            '旧方向',
            '雪夜急救箱护送',
            '小队护送急救箱穿过暴风雪街区',
            '主题：雪夜急救箱护送。画风：高质量3D卡通渲染。情绪氛围：紧张危机。画面内容：幸存者小队护送破损急救箱穿过冰封街道，前景有裂冰、脚印和结霜包装，中景是护送队伍与远处避难所灯光。整体基调：突出救命价值和路途危险。冰雪氛围，画面直观、主题明确，高质量3D卡通渲染，商业级游戏宣传海报风格，电影镜头感。',
            'L4',
            '紧张危机',
            '远景',
            '救命价值',
            '低'
        ]
    ]);

    const parsed = parseCreativePromptWorkbook('agent-with-metadata.xlsx', workbookToBase64(workbook));
    assert.strictEqual(parsed.prompts.length, 1);
    assert.strictEqual(parsed.prompts[0].direction, '雪夜急救箱护送');
    assert.strictEqual(parsed.prompts[0].promptTitle, '提示词1');
}

function runDuplicatePromptDeduplicationTest() {
    const promptA = 'prompt text A with enough detail for creative image generation';
    const promptB = 'prompt text B with enough detail for creative image generation';
    const workbook = createWorkbook([
        ['title', 'prompt1', 'prompt2'],
        ['direction one', promptA, promptB],
        ['direction two', promptA, promptB]
    ], 'prompt sheet');

    const parsed = parseCreativePromptWorkbook('duplicate-prompts.xlsx', workbookToBase64(workbook));
    assert.strictEqual(parsed.prompts.length, 2);
    assert.strictEqual(parsed.parseStats.totalPromptCount, 4);
    assert.strictEqual(parsed.parseStats.dedupedPromptCount, 2);
    assert.strictEqual(parsed.parseStats.duplicatePromptCount, 2);
    assert.strictEqual(parsed.parseStats.duplicateRowPairs.length, 1);
    assert.strictEqual(parsed.parseStats.duplicateRowPairs[0].duplicatePromptCount, 2);
    assert.strictEqual(parsed.parseStats.duplicatePromptRows[0].sourceRow, 3);
    assert.strictEqual(parsed.parseStats.duplicatePromptRows[0].duplicateOfRow, 2);
    assert.strictEqual(parsed.prompts[0].prompt, promptA);
    assert.strictEqual(parsed.prompts[1].prompt, promptB);
    assert.strictEqual(parsed.prompts[0].sourceRow, 2);
    assert.strictEqual(parsed.prompts[1].sourceRow, 2);
}

function runQualityTest() {
    const prompts = sanitizeCreativePromptItems([
        {
            index: 1,
            direction: '冰层补给站',
            promptTitle: '提示词1',
            prompt: '主题：冰层补给站。。画风：高质量3D卡通渲染。画面内容：幸存者围绕补给箱展开争夺，前景有裂冰和散落工具。'
        },
        {
            index: 2,
            direction: '的结果揭晓',
            promptTitle: '提示词2',
            prompt: '主题：的结果揭晓。画风：高质量3D卡通渲染。画面内容：让成为绝对视觉中心。'
        }
    ]);

    assert.ok(!prompts[0].prompt.includes('。。'));
    const report = buildCreativeAgentQualityReport(prompts);
    assert.strictEqual(report.totalPrompts, 2);
    assert.ok(report.errors.some(issue => issue.code === 'malformed_prompt'));
    assert.strictEqual(report.success, false);
    assert.strictEqual(report.status, 'error');
}

function runForbiddenTermQualityTest() {
    const report = buildCreativeAgentQualityReport([
        {
            index: 1,
            direction: '冰封补给站',
            promptTitle: '提示词1',
            prompt: '主题：冰封补给站。画风：高质量3D卡通渲染。情绪氛围：紧张危机。画面内容：幸存者站在带有真实品牌 logo 的补给箱旁，前景是积雪和破损包装。整体基调：商业级游戏宣传海报风格。'
        }
    ]);

    assert.strictEqual(report.success, false);
    assert.ok(report.errors.some(issue => issue.code === 'forbidden_term'));
}

runParserTest();
runParserWithCandidateMetadataColumnsTest();
runDuplicatePromptDeduplicationTest();
runQualityTest();
runForbiddenTermQualityTest();
console.log('creative agent parser and quality tests passed');
