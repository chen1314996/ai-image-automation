const assert = require('assert');
const { __test } = require('../creative-agent-service');

function main() {
    const singleTargetInstruction = [
        '你正在为项目后台执行 creative-auto run-once 的 Agent-only 阶段。',
        'Only process creative target 1/139 in this queue. Expand and generate images for this one TOP material before the next target starts.',
        '# Historical uniqueness guard',
        'This run must use history dedupe and duplicateRisk fields, but it is still one source direction only.',
        'directionPlans 每一项代表一个原始方向，必须包含 sourceDirectionPath、currentJudgment、exclusionSummary、extensions。'
    ].join('\n');

    const selected = __test.selectCreativeAgentSkills(singleTargetInstruction);
    assert.ok(selected.includes('reference-analysis-table'));
    assert.ok(selected.includes('batch-iteration-strategy-table'));
    assert.ok(selected.includes('new-direction-expansion-table'));
    assert.ok(selected.includes('legil-run-once-prompt-contract'));
    assert.ok(!selected.includes('batch-creative-expansion-accelerator'));

    const request = __test.buildCreativeAgentMessages({
        instruction: singleTargetInstruction,
        targetCount: 3,
        attachments: []
    });
    assert.ok(!request.selectedSkillNames.includes('batch-creative-expansion-accelerator'));

    const batchSelected = __test.selectCreativeAgentSkills('请批量生成上百个素材池扩量方向，并按方向表清单执行。');
    assert.ok(batchSelected.includes('batch-creative-expansion-accelerator'));
    assert.ok(batchSelected.includes('strict-table-direction-iteration'));

    const deltaText = __test.extractCreativeAgentResponseText({
        choices: [{
            delta: {
                content: '{"candidateDirections":[]}'
            },
            finish_reason: 'stop'
        }]
    });
    assert.strictEqual(deltaText, '{"candidateDirections":[]}');
}

main();
console.log('creative agent single target skill tests passed');
