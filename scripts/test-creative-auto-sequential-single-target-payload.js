const assert = require('assert');
const { createCreativeAutoService } = require('../src/services/creative-auto');
const {
    cleanupFixture,
    defaultDirections,
    makePrompt,
    makeTempCreativeFixture,
    writeBaseKnowledge
} = require('./creative-auto-test-utils');

function completePrompt(label) {
    return [
        `主题：${label}。`,
        '画面内容：两名幸存者在冰封末世的废墟入口协作搬开结冰金属门，门缝里透出暖色补给光，前景有破损背包、冻住的绳索和散落工具，中景人物动作清楚，远景是被风雪压住的建筑轮廓。',
        '镜头构图：低机位中景，前景道具形成探索线索，人物和入口占据画面中心，危险与奖励关系一眼可读。',
        '情绪氛围：寒冷、紧张、发现希望的瞬间，冷蓝雪光和门内暖光形成强对比。',
        '整体基调：冰雪求生、探索发现、商业游戏广告点击图。',
        '画风：高质量3D卡通渲染，商业级游戏宣传海报风格，电影镜头感，1:1方图。'
    ].join('');
}

async function main() {
    const fixture = makeTempCreativeFixture('creative-auto-single-target-payload-');
    try {
        const directions = defaultDirections();
        writeBaseKnowledge(fixture, directions);

        const appConfig = {
            creative: {
                outputFolder: fixture.outputFolder,
                referenceFolder: fixture.referenceFolder,
                generationSettings: { outputQuantity: 1 }
            }
        };
        const service = createCreativeAutoService({
            rootDir: fixture.root,
            logger: { info() {}, warn() {}, error() {} },
            isLegilBusy: () => false,
            getStoredWinkyConfig: () => ({
                apiKey: 'test-key',
                apiUrl: 'https://winky.test/v1',
                model: 'test-model',
                provider: 'test'
            }),
            hasActiveCreativeAgentTask: () => false,
            startCreativeAgentTask: () => ({ runId: 'agent-single-target', phase: 'completed' }),
            getCreativeAgentTask: runId => ({
                runId,
                phase: 'completed',
                result: {
                    prompts: [makePrompt(1, {
                        sourceDirectionId: 'direction-1',
                        sourceDirectionPath: directions[0].path,
                        direction: '冰封入口协作发现',
                        newDirectionName: '冰封入口协作发现',
                        prompt: completePrompt('冰封入口协作发现'),
                        finalPrompt: completePrompt('冰封入口协作发现')
                    })]
                }
            }),
            publicCreativeAgentTask: (task, includeResult) => ({
                ...task,
                result: includeResult ? task.result : undefined
            })
        });

        const result = service.runOnce({
            agentOnly: true,
            maxPrompts: 10,
            directionIds: ['direction-1', 'direction-2'],
            targetSelection: {
                type: 'direction',
                label: '2 个目标/2 个方向',
                path: '2 个目标/2 个方向',
                directionIds: ['direction-1', 'direction-2']
            },
            creativeBrief: {
                brief: {
                    packageType: 'creative-target-package',
                    target: 'source-directions',
                    creativeTargets: [
                        {
                            targetId: 'target-1',
                            directionIds: ['direction-1'],
                            sourceDirectionPath: directions[0].path,
                            sourceMaterialName: 'Target 1',
                            newDirectionsPerSource: 2,
                            promptGroupsPerNewDirection: 3
                        },
                        {
                            targetId: 'target-2',
                            directionIds: ['direction-2'],
                            sourceDirectionPath: directions[1].path,
                            sourceMaterialName: 'Target 2',
                            newDirectionsPerSource: 1,
                            promptGroupsPerNewDirection: 4
                        }
                    ]
                }
            }
        }, { dataDir: fixture.dataDir, appConfig });

        assert.strictEqual(result.success, true);
        assert.strictEqual(result.run.sourceDirection.id, 'direction-1');
        assert.strictEqual(result.run.sourceDirection.aggregate, undefined);
        assert.strictEqual(result.run.aggregateTarget, null);
        assert.deepStrictEqual(result.run.targetSelection.directionIds, ['direction-1']);
        assert.strictEqual(result.run.targetSelection.index, 1);
        assert.strictEqual(result.run.targetSelection.total, 2);
        assert.strictEqual(result.run.creativeBrief.brief.targetCount, 1);
        assert.strictEqual(result.run.creativeBrief.brief.creativeTargets.length, 1);
        assert.strictEqual(result.run.creativeBrief.brief.creativeTargets[0].targetId, 'target-1');
        assert.ok(result.run.instruction.includes('Only process creative target 1/2'));
        assert.ok(result.run.instruction.includes('数量约束：新方向 2 个；每个新方向 3 条 prompt'));
        assert.ok(!result.run.instruction.includes('数量约束：新方向 1 个；每个新方向 4 条 prompt'));
        assert.ok(result.run.instruction.includes(directions[0].path));
        assert.ok(!result.run.instruction.includes(directions[1].path));
    } finally {
        cleanupFixture(fixture);
    }
}

main()
    .then(() => console.log('creative auto sequential single target payload tests passed'))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });
