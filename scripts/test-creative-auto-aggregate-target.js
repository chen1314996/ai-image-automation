const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createCreativeAutoService } = require('../src/services/creative-auto');

function nowIso() {
    return new Date().toISOString();
}

function createPrompt(subject) {
    return `主题：${subject}。画面动作：两名幸存者在冰封高处入口协作打开被雪埋住的金属门，门内露出暖色补给光。场景：末日冰雪建筑高处，前景有结冰绳索、破损背包和散落工具，中景有人物动作，远景有风雪压迫。镜头：低机位中景，前景道具清楚，中景角色关系明确。光线：冷蓝雪光与门内暖光对比，主体边缘有轮廓光。画风：高质量 3D 卡通游戏广告图，商业级游戏宣传海报风格，电影镜头感。文字规则：如需文字，只出现短中文关键词，清晰可读。画面要求：1:1 方图，主体清楚，动作可读，适合 Legil 直接生图。`;
}

function seed(root) {
    const dataDir = path.join(root, 'data', 'creative-knowledge');
    const outputFolder = path.join(root, 'output');
    const referenceFolder = path.join(root, 'reference');
    fs.mkdirSync(path.join(dataDir, 'runs'), { recursive: true });
    fs.mkdirSync(outputFolder, { recursive: true });
    fs.mkdirSync(referenceFolder, { recursive: true });

    const directions = [
        {
            id: 'direction-a',
            path: '题材/探索发现/攀爬',
            name: '攀爬',
            primaryTag: '题材',
            secondaryTag: '探索发现',
            tertiaryTag: '攀爬',
            description: '幸存者攀爬冰封建筑发现资源。',
            referenceHints: ['攀爬姿态', '高处资源'],
            autoRun: true,
            priority: 60,
            stats: {}
        },
        {
            id: 'direction-b',
            path: '题材/探索发现/破门',
            name: '破门',
            primaryTag: '题材',
            secondaryTag: '探索发现',
            tertiaryTag: '破门',
            description: '幸存者打开冰封入口发现新区域。',
            referenceHints: ['入口', '发现瞬间'],
            autoRun: true,
            priority: 50,
            stats: {}
        }
    ];

    fs.writeFileSync(path.join(dataDir, 'metadata.json'), JSON.stringify({
        version: 1,
        importedAt: nowIso(),
        counts: { directions: directions.length, topMaterials: 0, topMaterialInsights: 0, referenceImages: 0 },
        warnings: []
    }, null, 2));
    fs.writeFileSync(path.join(dataDir, 'directions.json'), JSON.stringify({ version: 1, directions, updatedAt: nowIso() }, null, 2));
    fs.writeFileSync(path.join(dataDir, 'top-material-insights.json'), JSON.stringify({ version: 1, insights: [] }, null, 2));
    fs.writeFileSync(path.join(dataDir, 'reference-images.json'), JSON.stringify({ version: 1, images: [] }, null, 2));
    fs.writeFileSync(path.join(dataDir, 'assets.json'), JSON.stringify({ version: 1, assets: [] }, null, 2));
    fs.writeFileSync(path.join(dataDir, 'scheduler-state.json'), JSON.stringify({
        version: 1,
        status: 'idle',
        daily: { date: new Date().toISOString().slice(0, 10), imageCount: 0, imageLimit: 1000 },
        updatedAt: nowIso()
    }, null, 2));

    return { dataDir, outputFolder, referenceFolder };
}

async function waitForRun(service, runId, context) {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
        const run = service.getRun(runId, context);
        if (run && run.status === 'completed') return run;
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Timed out waiting for ${runId}`);
}

async function waitForQueuedRuns(dataDir, queueId, minCount) {
    const runsDir = path.join(dataDir, 'runs');
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
        const runs = fs.readdirSync(runsDir)
            .filter(fileName => fileName.endsWith('.json'))
            .map(fileName => JSON.parse(fs.readFileSync(path.join(runsDir, fileName), 'utf8')))
            .filter(run => run.status === 'completed' && run.targetQueue && run.targetQueue.queueId === queueId)
            .sort((a, b) => Number(a.targetQueue.index) - Number(b.targetQueue.index));
        if (runs.length >= minCount) return runs;
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Timed out waiting for queued runs ${queueId}`);
}

async function main() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'creative-auto-aggregate-'));
    try {
        const { dataDir, outputFolder, referenceFolder } = seed(root);
        const context = {
            dataDir,
            appConfig: {
                creative: {
                    outputFolder,
                    referenceFolder,
                    browserMode: 'headed',
                    generationSettings: { outputQuantity: 4 }
                }
            }
        };

        const service = createCreativeAutoService({
            rootDir: root,
            logger: { info() {}, warn() {}, error() {} },
            getStoredWinkyConfig: () => ({ apiUrl: 'https://example.invalid', apiKey: 'key', model: 'model' }),
            hasActiveCreativeAgentTask: () => false,
            isLegilBusy: () => false,
            promptTranslatorClient: async () => ({
                prompts: [{
                    index: 1,
                    promptTitle: '冰封高处入口发现',
                    sourceDirectionId: 'direction_group_test',
                    newDirectionName: '探索发现大方向',
                    subject: '幸存者在冰封高处入口发现补给资源',
                    action: '两名幸存者协作打开被雪埋住的金属门，门内露出暖色补给光',
                    scene: '末日冰雪建筑高处，结冰绳索、破损背包和散落工具形成资源线索',
                    camera: '低机位中景，前景道具清楚，中景角色关系明确',
                    lighting: '冷蓝雪光与门内暖光对比，主体边缘有轮廓光',
                    visualStyle: '高质量 3D 卡通游戏广告图，商业级游戏宣传海报风格，电影镜头感',
                    textRule: '如需文字，只出现短中文关键词，清晰可读',
                    mustKeep: ['冰雪末日', '幸存者', '补给资源'],
                    mustAvoid: [],
                    finalPrompt: createPrompt('幸存者在冰封高处入口发现补给资源')
                }]
            }),
            startCreativeAgentTask: () => ({
                runId: 'aggregate-agent-task',
                phase: 'completed',
                result: {
                    prompts: [{
                        index: 1,
                        direction: '探索发现大方向',
                        promptTitle: '冰封高处入口发现',
                        prompt: '主题：冰封高处入口发现。画面内容：幸存者在冰封建筑高处打开入口发现资源，画面清晰，主体明确，冰雪末世氛围强。',
                        selected: true
                    }]
                },
                message: 'done'
            }),
            getCreativeAgentTask: () => ({
                runId: 'aggregate-agent-task',
                phase: 'completed',
                result: {
                    prompts: [{
                        index: 1,
                        direction: '探索发现大方向',
                        promptTitle: '冰封高处入口发现',
                        prompt: '主题：冰封高处入口发现。画面内容：幸存者在冰封建筑高处打开入口发现资源，画面清晰，主体明确，冰雪末世氛围强。',
                        selected: true
                    }]
                },
                message: 'done'
            }),
            publicCreativeAgentTask: (task, includeResult) => ({ ...task, result: includeResult ? task.result : undefined })
        });

        const started = service.runOnce({
            agentOnly: true,
            maxPrompts: 1,
            directionIds: ['direction-a', 'direction-b'],
            targetSelection: {
                type: 'tag',
                level: 2,
                label: '题材/探索发现',
                path: '题材/探索发现'
            }
        }, context);

        assert.strictEqual(started.success, true);
        const run = await waitForRun(service, started.run.runId, context);
        assert.strictEqual(run.sourceDirection.aggregate, true);
        assert.deepStrictEqual(run.sourceDirection.memberDirectionIds, ['direction-a', 'direction-b']);
        assert.ok(run.instruction.includes('聚合迭代要求'));
        assert.ok(run.instruction.includes('先归纳这些方向的共同点'));
        assert.strictEqual(run.promptTotal, 1);

        const briefDirectionPath = '题材/探索发现/妙思俯瞰城镇废墟';
        const briefStarted = service.runOnce({
            agentOnly: true,
            maxPrompts: 1,
            creativeBrief: {
                brief: {
                    source: 'material-analysis',
                    target: 'material',
                    projectName: '无尽冬日',
                    weekId: '2026-W21',
                    materialId: 'material-brief-test',
                    materialName: 'GO_TEST_BJ_题材_探索发现_妙思俯瞰城镇废墟_800x800',
                    directionPath: briefDirectionPath,
                    directionKey: '题材/探索发现',
                    performanceSummary: '花费高，安装高，D0 ROI 待观察',
                    visualInsight: '俯瞰城镇废墟，巨大建筑与幸存者探索关系清晰。',
                    retainElements: ['俯瞰城镇废墟', '探索发现', '巨大建筑'],
                    variationAxes: ['镜头', '场景', '人物关系'],
                    avoidRules: ['不要改成室内常规探索']
                }
            }
        }, context);

        assert.strictEqual(briefStarted.success, true);
        const briefRun = await waitForRun(service, briefStarted.run.runId, context);
        assert.strictEqual(briefRun.sourceDirection.path, briefDirectionPath);
        assert.strictEqual(briefRun.sourceDirection.source, 'material-analysis');
        assert.ok(briefRun.selection.reasons.includes('素材分析 brief 指定方向优先'));
        assert.ok(briefRun.instruction.includes(`方向路径：${briefDirectionPath}`));
        assert.ok(!briefRun.instruction.includes('指标依据'));
        assert.ok(!briefRun.instruction.includes('花费高'));
        assert.ok(!briefRun.instruction.includes('# 当前必须拓展的原始方向\n方向 ID：direction-a'));

        const packageStarted = service.runOnce({
            agentOnly: true,
            maxPrompts: 10,
            creativeBrief: {
                brief: {
                    source: 'material-analysis',
                    packageType: 'creative-target-package',
                    target: 'source-directions',
                    projectName: '无尽冬日',
                    weekId: '2026-W21',
                    creativeTargets: [
                        {
                            targetId: 'target-cat',
                            targetType: 'source-direction',
                            sourceDirectionPath: '题材/危机来袭/妙思猫猫袭击城镇建筑载具',
                            sourceDirectionKey: '题材/危机来袭/妙思猫猫袭击城镇建筑载具',
                            visualInsight: '巨型猫咪袭击雪地城镇和车辆，危险关系清晰。',
                            retainElements: ['巨型猫咪', '城镇建筑', '载具破坏'],
                            variationAxes: ['场景', '人物关系', '镜头'],
                            avoidRules: ['不要串到室内探索'],
                            seedMaterials: [
                                {
                                    materialId: 'material-cat-1',
                                    materialName: 'GO_TEST_BJ_题材_危机来袭_妙思猫猫袭击城镇建筑载具_1080x1920',
                                    visionSummary: '猫咪巨大化压迫城镇街道。'
                                }
                            ],
                            newDirectionsPerSource: 2,
                            promptGroupsPerNewDirection: 3
                        },
                        {
                            targetId: 'target-ruin',
                            targetType: 'source-direction',
                            sourceDirectionPath: briefDirectionPath,
                            sourceDirectionKey: briefDirectionPath,
                            visualInsight: '俯瞰城镇废墟，探索路线清晰。',
                            retainElements: ['俯瞰视角', '城镇废墟'],
                            variationAxes: ['视角高度', '资源道具'],
                            avoidRules: ['不要改成常规室内探索'],
                            newDirectionsPerSource: 1,
                            promptGroupsPerNewDirection: 4
                        }
                    ]
                }
            }
        }, context);

        assert.strictEqual(packageStarted.success, true);
        const packageRun = await waitForRun(service, packageStarted.run.runId, context);
        assert.strictEqual(packageRun.sourceDirection.source, 'material-analysis');
        assert.strictEqual(packageRun.targetQueue.index, 1);
        assert.strictEqual(packageRun.targetQueue.total, 2);
        assert.ok(packageRun.instruction.includes('任务包类型：creative-target-package'));
        assert.ok(packageRun.instruction.includes('Only process creative target 1/2'));
        assert.ok(packageRun.instruction.includes('新方向之间的差异要明显拉开'));
        assert.ok(packageRun.instruction.includes('同一新方向下的不同 prompt 也要有更大的画面差异'));
        assert.ok(packageRun.instruction.includes('数量约束：新方向 2 个；每个新方向 3 条 prompt'));
        assert.ok(!packageRun.instruction.includes('数量约束：新方向 1 个；每个新方向 4 条 prompt'));
        assert.ok(packageRun.instruction.includes('题材/危机来袭/妙思猫猫袭击城镇建筑载具'));
        assert.ok(!packageRun.instruction.includes(briefDirectionPath));
        assert.ok(packageRun.instruction.includes('不要把一个原始方向改写成另一个方向'));
        assert.strictEqual(packageRun.quota.unlimitedPrompts, true);
        assert.strictEqual(packageRun.quota.maxPrompts, Number.MAX_SAFE_INTEGER);

        const queuedRuns = await waitForQueuedRuns(dataDir, packageRun.targetQueue.queueId, 2);
        assert.deepStrictEqual(queuedRuns.map(run => run.targetQueue.index), [1, 2]);
        const secondQueuedRun = queuedRuns[1];
        assert.ok(secondQueuedRun.instruction.includes('Only process creative target 2/2'));
        assert.ok(secondQueuedRun.instruction.includes('数量约束：新方向 1 个；每个新方向 4 条 prompt'));
        assert.ok(!secondQueuedRun.instruction.includes('数量约束：新方向 2 个；每个新方向 3 条 prompt'));
        assert.ok(secondQueuedRun.instruction.includes(briefDirectionPath));
        console.log('creative auto aggregate target test passed');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
