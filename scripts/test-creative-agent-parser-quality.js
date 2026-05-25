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
}

runParserTest();
runDuplicatePromptDeduplicationTest();
runQualityTest();
console.log('creative agent parser and quality tests passed');
