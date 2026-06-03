const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createCreativeAutoService } = require('../src/services/creative-auto');

function todayKey() {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
}

function createPrompt(subject) {
    return `主题：${subject}。画面动作：幸存者在冰封补给站门口抢修暖光热源，旁边同伴搬开结冰木箱露出关键补给。场景：废弃补给站入口，前景有罐头、绳索、破损地图和结霜金属箱，中景人物动作明确，远景有风雪压迫。镜头：低机位中景，前景道具清楚，中景角色关系明确。光线：冷蓝雪光与局部暖光对比，主体边缘有清楚轮廓光。画风：高质量 3D 卡通游戏广告图，商业级游戏宣传海报风格，电影镜头感。文字规则：如需文字，只出现短中文关键词，清晰可读。画面要求：1:1 方图，主体清楚，动作可读，适合 Legil 直接生图。`;
}

async function waitForRun(service, runId, context, predicate, timeoutMs = 3000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        const run = service.getRun(runId, context);
        if (run && predicate(run)) {
            return run;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`等待 run 状态超时: ${runId}`);
}

async function runContinueLegilTest() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'creative-auto-continue-'));
    const dataDir = path.join(root, 'data', 'creative-knowledge');
    const outputFolder = path.join(root, 'output');
    const referenceFolder = path.join(root, 'reference');
    fs.mkdirSync(path.join(dataDir, 'runs'), { recursive: true });
    fs.mkdirSync(outputFolder, { recursive: true });
    fs.mkdirSync(referenceFolder, { recursive: true });

    const direction = {
        id: 'direction-1',
        path: '题材/探索发现/补给站',
        name: '补给站',
        autoRun: true,
        priority: 90,
        stats: {}
    };
    const runId = 'creative_run_continue_test';
    const prompt = {
        index: 1,
        originalIndex: 1,
        direction: '补给站热源',
        newDirectionName: '补给站热源',
        promptTitle: '热源门口',
        sourceDirectionId: direction.id,
        sourceDirectionPath: direction.path,
        prompt: createPrompt('冰封补给站门口幸存者抢修热源灯'),
        finalPrompt: createPrompt('冰封补给站门口幸存者抢修热源灯'),
        promptHash: 'prompt-hash-1',
        selected: true
    };

    fs.writeFileSync(path.join(dataDir, 'metadata.json'), JSON.stringify({
        importedAt: new Date().toISOString(),
        counts: { directions: 1, topMaterials: 0, topMaterialInsights: 0, referenceImages: 0 },
        warnings: []
    }, null, 2));
    fs.writeFileSync(path.join(dataDir, 'directions.json'), JSON.stringify({ directions: [direction] }, null, 2));
    fs.writeFileSync(path.join(dataDir, 'top-material-insights.json'), JSON.stringify({ insights: [] }, null, 2));
    fs.writeFileSync(path.join(dataDir, 'reference-images.json'), JSON.stringify({ images: [] }, null, 2));
    fs.writeFileSync(path.join(dataDir, 'assets.json'), JSON.stringify({ version: 1, assets: [] }, null, 2));
    fs.writeFileSync(path.join(dataDir, 'scheduler-state.json'), JSON.stringify({
        status: 'idle',
        daily: { date: todayKey(), imageCount: 0, imageLimit: 1000 }
    }, null, 2));
    fs.writeFileSync(path.join(dataDir, 'runs', `${runId}.json`), JSON.stringify({
        runId,
        mode: 'agent-only',
        agentOnly: true,
        status: 'completed',
        phase: 'agent_completed',
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        sourceDirection: direction,
        selection: { score: 90, reasons: ['test'] },
        config: {
            outputFolder,
            referenceFolder,
            generationSettings: {
                imageModel: 'nano-banana-2',
                aspectRatio: '1:1',
                resolution: '2K',
                outputQuantity: 4
            }
        },
        schedulerState: {
            daily: { date: todayKey(), imageCount: 0, imageLimit: 1000 }
        },
        promptTotalRaw: 1,
        promptTotal: 1,
        expectedImageTotal: 0,
        prompts: [prompt],
        promptQualityReport: {
            rawPromptCount: 1,
            acceptedPromptCount: 1,
            rejectedPromptCount: 0,
            outputQuantity: 4
        },
        agentOutput: { fileName: 'agent.xlsx' }
    }, null, 2));

    let legilPayload = null;
    const savedFiles = [
        path.join(outputFolder, '20260528_120000_0001_ref001_prompt01_v01_补给站热源_20260528_120101.png'),
        path.join(outputFolder, '20260528_120000_0002_ref001_prompt01_v02_补给站热源_20260528_120106.png')
    ];
    const service = createCreativeAutoService({
        rootDir: root,
        logger: { info() {}, warn() {}, error() {} },
        legilProgressPollMs: 100,
        legilProgressMaxWaitMs: 1000,
        isLegilBusy: () => false,
        startLegilCreativeBatch: async payload => {
            legilPayload = payload;
            return {
                success: true,
                message: 'Legil stub started',
                totalPrompts: payload.prompts.length,
                outputTotal: 4,
                progress: {
                    taskType: 'creative-batch',
                    phase: 'queued',
                    total: 1,
                    completed: 0,
                    success: 0,
                    failed: 0,
                    saved: 0,
                    outputTotal: 4,
                    currentAction: 'queued'
                }
            };
        },
        getLegilCreativeProgress: async () => ({
            success: true,
            hasProgress: true,
            running: false,
            progress: {
                taskType: 'creative-batch',
                phase: 'stopped',
                total: 1,
                completed: 1,
                success: 1,
                failed: 0,
                saved: savedFiles.length,
                outputTotal: 4,
                savedFiles: savedFiles.map((filePath, index) => {
                    if (!fs.existsSync(filePath)) {
                        fs.writeFileSync(filePath, Buffer.from(`paused-image-${index + 1}`));
                    }
                    return {
                        filePath,
                        promptListIndex: 1,
                        imageIndex: index + 1,
                        savedAt: new Date().toISOString()
                    };
                }),
                promptResults: [],
                currentAction: 'stopped after partial saves'
            }
        })
    });

    try {
        const context = { dataDir, appConfig: { creative: { outputFolder, referenceFolder } } };
        const started = service.continueRunToLegil(runId, {}, context);
        assert.strictEqual(started.success, true);
        assert.strictEqual(started.run.agentOnly, false);
        assert.strictEqual(started.run.continuedFromAgentOnly, true);
        assert.strictEqual(started.run.phase, 'legil_pending');

        const run = await waitForRun(service, runId, context, item => item.phase === 'legil_paused');
        assert.strictEqual(run.status, 'paused');
        assert.strictEqual(run.promptTotal, 1);
        assert.strictEqual(run.legilResult.successCount, 1);
        assert.strictEqual(run.legilResult.savedCount, 2);
        assert.strictEqual(run.assets.newAssetCount, 2);
        assert.strictEqual(run.assetIds.length, 2);
        assert.ok(legilPayload);
        assert.strictEqual(legilPayload.creativeAutoRunId, runId);
        assert.strictEqual(legilPayload.prompts.length, 1);
        assert.strictEqual(legilPayload.prompts[0].finalPrompt, prompt.finalPrompt);

        const assets = JSON.parse(fs.readFileSync(path.join(dataDir, 'assets.json'), 'utf8'));
        assert.strictEqual(assets.assets.length, 2);
        assert.ok(assets.assets.every(asset => asset.runId === runId));
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

runContinueLegilTest()
    .then(() => {
        console.log('creative auto continue legil tests passed');
    })
    .catch(error => {
        console.error(error);
        process.exit(1);
    });
