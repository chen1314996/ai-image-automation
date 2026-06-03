const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createCreativeAutoService } = require('../src/services/creative-auto');
const { TRANSLATION_VERSION } = require('../src/services/creative-auto/prompt-translator');

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
    return `主题：${subject}。画风：高质量3D卡通渲染。情绪氛围：紧张、明确、有求生希望。画面内容：幸存者在冰封废墟中围绕关键资源展开行动，前景有清楚的手部动作和道具，中景有人物关系，远景有被风雪吞没的旧文明建筑。整体基调：冷蓝雪景与局部暖光对比，方图中心稳定，缩略图下也能看懂广告点击点。冰雪氛围，画面直观、主题明确，高质量3D卡通渲染，商业级游戏宣传海报风格，电影镜头感。`;
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

async function runLegilRunOnceTest() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'creative-auto-legil-'));
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
        primaryTag: '题材',
        secondaryTag: '探索发现',
        tertiaryTag: '',
        subTag: '补给站',
        description: '幸存者寻找补给站',
        referenceHints: [],
        mustAvoid: '',
        autoRun: true,
        priority: 90,
        stats: {
            expandedCount: 0,
            promptCount: 0,
            imageCount: 0,
            lastRunAt: null,
            failureCount: 0
        }
    };
    const siblingDirection = {
        id: 'direction-2',
        path: '题材/探索发现/急救药品',
        name: '急救药品',
        primaryTag: '题材',
        secondaryTag: '探索发现',
        tertiaryTag: '',
        subTag: '急救药品',
        description: '雪夜护送急救药箱，突出救命价值和路途危险',
        referenceHints: [],
        autoRun: true,
        priority: 60,
        stats: {}
    };
    const childDirection = {
        id: 'direction-3',
        path: '题材/探索发现/补给站/冰封仓库',
        name: '冰封仓库',
        primaryTag: '题材',
        secondaryTag: '探索发现',
        tertiaryTag: '补给站',
        subTag: '冰封仓库',
        description: '幸存者在冰封仓库发现燃料和食物',
        referenceHints: [],
        autoRun: true,
        priority: 50,
        stats: {}
    };

    fs.writeFileSync(path.join(dataDir, 'metadata.json'), JSON.stringify({
        importedAt: new Date().toISOString(),
        counts: {
            directions: 3,
            topMaterials: 1,
            topMaterialInsights: 1,
            referenceImages: 0
        },
        warnings: []
    }, null, 2));
    fs.writeFileSync(path.join(dataDir, 'directions.json'), JSON.stringify({ directions: [direction, siblingDirection, childDirection] }, null, 2));
    fs.writeFileSync(path.join(dataDir, 'top-material-insights.json'), JSON.stringify({
        insights: [{
            pathKey: '题材/探索发现/补给站',
            materialCount: 3,
            avgCtr: 0.07,
            avgD7IapRoi: 0.15,
            topNames: ['补给站'],
            keywords: ['补给']
        }]
    }, null, 2));
    fs.writeFileSync(path.join(dataDir, 'reference-images.json'), JSON.stringify({ images: [] }, null, 2));
    fs.writeFileSync(path.join(dataDir, 'assets.json'), JSON.stringify({ version: 1, assets: [] }, null, 2));
    fs.writeFileSync(path.join(dataDir, 'runs', 'creative_run_previous.json'), JSON.stringify({
        runId: 'creative_run_previous',
        sourceDirection: direction,
        prompts: [{
            promptHash: 'prompt_hash_previous_001',
            newDirectionName: '废弃补给站旧方向',
            sourceDirectionId: direction.id,
            sourceDirectionPath: direction.path,
            prompt: createPrompt('历史补给站旧方向')
        }],
        directionDefinitions: [{
            newDirectionName: '废弃补给站旧方向',
            sourceDirectionId: direction.id,
            sourceDirectionPath: direction.path
        }],
        promptQualityReport: {
            rejectedPrompts: [{
                direction: '补给站激光机甲巡逻',
                promptTitle: '提示词1',
                reason: 'forbidden_term',
                message: '命中禁用元素：机甲'
            }]
        }
    }, null, 2));
    fs.writeFileSync(path.join(dataDir, 'scheduler-state.json'), JSON.stringify({
        status: 'idle',
        consecutiveFailures: 0,
        daily: {
            date: todayKey(),
            imageCount: 0,
            imageLimit: 1000
        }
    }, null, 2));

    const agentResult = {
        fileName: 'agent.xlsx',
        downloadUrl: '/api/creative-agent/download/agent.xlsx',
        localPath: path.join(root, 'agent.xlsx'),
        prompts: [
            {
                index: 1,
                direction: '补给站热源',
                promptTitle: '提示词1',
                prompt: createPrompt('冰封补给站门口幸存者抢修热源灯'),
                selected: true
            },
            {
                index: 2,
                direction: '仓库燃料',
                promptTitle: '提示词1',
                prompt: createPrompt('雪地仓库外幸存者搬运稀缺燃料'),
                selected: true
            },
            {
                index: 3,
                direction: 'forbidden mecha ui',
                promptTitle: 'rejected forbidden prompt',
                prompt: createPrompt('高科技 UI 机甲 激光界面'),
                selected: true
            }
        ],
        rawText: '| raw table |',
        rawTableMarkdown: '| raw table |',
        markdownPreview: '| raw table |',
        message: 'stub completed'
    };
    const task = {
        runId: 'agent-task-1',
        phase: 'completed',
        createdAt: new Date().toISOString(),
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        currentAction: 'done',
        instructionPreview: '',
        attachmentCount: 0,
        targetCount: 5,
        result: agentResult,
        message: 'done',
        error: ''
    };

    let legilPayload = null;
    let legilPrompts = [];
    let savedFiles = [];
    const service = createCreativeAutoService({
        rootDir: root,
        dataDir,
        logger: { info() {}, error() {} },
        legilProgressPollMs: 100,
        legilProgressMaxWaitMs: 1000,
        getStoredWinkyConfig: () => ({
            apiUrl: 'https://example.invalid',
            apiKey: 'test-key',
            model: 'test-model'
        }),
        hasActiveCreativeAgentTask: () => false,
        isLegilBusy: () => false,
        promptTranslatorClient: async () => ({
            prompts: [
                {
                    index: 1,
                    promptTitle: '热源门口',
                    sourceDirectionId: direction.id,
                    newDirectionName: '补给站热源',
                    subject: '冰封补给站门口的幸存者抢修热源灯',
                    action: '幸存者跪在积雪中拆开金属箱，旁边同伴举着手电照亮刚亮起的暖色灯泡',
                    scene: '废弃补给站入口，结冰木箱、散落罐头、破损地图和雪痕形成清楚资源线索',
                    camera: '低机位中景，前景突出手部动作和热源灯，中景呈现两人协作，背景保留补给站门牌',
                    lighting: '冷蓝雪光与局部暖光对比，主体边缘有清楚轮廓光',
                    visualStyle: '高质量 3D 卡通游戏广告图，商业级游戏宣传海报风格，电影镜头感',
                    textRule: '如需文字，只出现短中文关键词，清晰可读',
                    mustKeep: ['冰雪末日', '幸存者', '关键补给'],
                    mustAvoid: [],
                    finalPrompt: createPrompt('冰封补给站门口幸存者抢修热源灯')
                },
                {
                    index: 2,
                    promptTitle: '仓库燃料',
                    sourceDirectionId: direction.id,
                    newDirectionName: '仓库燃料',
                    subject: '雪地仓库外的幸存者搬运稀缺燃料',
                    action: '一名幸存者抱起结霜燃料罐，另一名角色拉开半掩的仓库铁门，门内暖光照出补给箱',
                    scene: '冰封仓库外侧，地面有拖拽痕迹、破布、绳索和被雪埋住的路牌',
                    camera: '电影感平视中景，前景燃料罐清楚，中景角色关系明确，远景保留暴风雪压迫感',
                    lighting: '冷色环境光与仓库内部暖光形成对比，燃料罐边缘有高亮反光',
                    visualStyle: '高质量 3D 卡通游戏广告图，商业级游戏宣传海报风格，电影镜头感',
                    textRule: '如需文字，只出现短中文关键词，清晰可读',
                    mustKeep: ['冰雪末日', '幸存者', '关键补给'],
                    mustAvoid: [],
                    finalPrompt: createPrompt('雪地仓库外幸存者搬运稀缺燃料')
                },
                {
                    index: 3,
                    promptTitle: 'rejected forbidden prompt',
                    sourceDirectionId: direction.id,
                    newDirectionName: 'forbidden mecha ui',
                    finalPrompt: createPrompt('高科技 UI 机甲 激光界面')
                }
            ]
        }),
        startCreativeAgentTask: () => task,
        getCreativeAgentTask: () => task,
        publicCreativeAgentTask: (currentTask, includeResult) => ({
            ...currentTask,
            result: includeResult ? currentTask.result : undefined
        }),
        startLegilCreativeBatch: async payload => {
            legilPayload = payload;
            legilPrompts = payload.prompts;
            savedFiles = [];
            payload.prompts.forEach((promptItem, promptIndex) => {
                for (let imageIndex = 1; imageIndex <= 4; imageIndex++) {
                    const filePath = path.join(
                        outputFolder,
                        `stub_ref${String(promptIndex + 1).padStart(3, '0')}_prompt01_v${String(imageIndex).padStart(2, '0')}.png`
                    );
                    fs.writeFileSync(filePath, Buffer.from(`image-${promptIndex + 1}-${imageIndex}`));
                    savedFiles.push({
                        filePath,
                        fileName: path.basename(filePath),
                        promptListIndex: promptIndex + 1,
                        displayIndex: promptIndex + 1,
                        imageIndex,
                        sourceRow: promptItem.sourceRow,
                        direction: promptItem.direction,
                        promptTitle: promptItem.promptTitle,
                        promptHash: promptItem.promptHash,
                        savedAt: new Date().toISOString()
                    });
                }
            });
            return {
                success: true,
                message: 'Legil stub started',
                totalPrompts: payload.prompts.length,
                outputTotal: payload.prompts.length * 4,
                browserMode: payload.browserMode,
                progress: {
                    taskType: 'creative-batch',
                    creativeAutoRunId: payload.creativeAutoRunId,
                    legilTaskId: payload.legilTaskId,
                    phase: 'queued',
                    total: payload.prompts.length,
                    completed: 0,
                    success: 0,
                    failed: 0,
                    saved: 0,
                    outputTotal: payload.prompts.length * 4,
                    currentAction: 'queued'
                }
            };
        },
        getLegilCreativeProgress: async () => ({
            success: true,
            hasProgress: true,
            running: false,
            stopRequested: false,
            taskType: 'creative-batch',
            progress: {
                taskType: 'creative-batch',
                creativeAutoRunId: legilPayload && legilPayload.creativeAutoRunId,
                legilTaskId: legilPayload && legilPayload.legilTaskId,
                phase: 'completed',
                total: 2,
                completed: 2,
                success: 2,
                failed: 0,
                saved: 8,
                outputTotal: 8,
                savedFiles,
                promptResults: legilPrompts.map((promptItem, promptIndex) => ({
                    promptListIndex: promptIndex + 1,
                    displayIndex: promptIndex + 1,
                    sourceRow: promptItem.sourceRow,
                    direction: promptItem.direction,
                    promptTitle: promptItem.promptTitle,
                    promptHash: promptItem.promptHash,
                    savedCount: 4,
                    savedFiles: savedFiles.filter(item => item.promptListIndex === promptIndex + 1)
                })),
                currentAction: '创意拓展任务完成：成功 2 组，失败 0 组'
            }
        })
    });

    try {
        const context = {
            dataDir,
            appConfig: {
                creative: {
                    outputFolder,
                    referenceFolder,
                    browserMode: 'headed',
                    generationSettings: {
                        imageModel: 'nano-banana-2',
                        aspectRatio: '1:1',
                        resolution: '2K',
                        outputQuantity: 4
                    }
                }
            }
        };
        const started = service.runOnce({ maxPrompts: 2, fullScale: false, unlimitedPrompts: false }, context);
        assert.strictEqual(started.success, true);
        assert.strictEqual(started.run.agentOnly, false);
        assert.strictEqual(started.run.mode, 'legil-run-once');
        assert.strictEqual(started.run.quota.unlimitedPrompts, false);
        assert.strictEqual(started.run.quota.unlimitedImages, true);
        assert.ok(started.run.directionSystemContext.directionTreeSummary.includes('补给站'));
        assert.ok(started.run.directionSystemContext.directionTreeSummary.includes('急救药品'));
        assert.ok(started.run.directionSystemContext.siblings.some(item => item.label === '急救药品'));
        assert.ok(started.run.directionSystemContext.exclusionContext.existingDirectionNames.includes('急救药品'));
        assert.ok(started.run.directionSystemContext.exclusionContext.existingDirectionNames.includes('冰封仓库'));
        assert.ok(started.run.directionSystemContext.exclusionContext.historicalPromptHashes.includes('prompt_hash_previous_001'));
        assert.ok(started.run.directionSystemContext.exclusionContext.rejectedDirections.some(item => item.direction === '补给站激光机甲巡逻'));
        assert.ok(started.run.instruction.includes('方向树摘要'));
        assert.ok(started.run.instruction.includes('同级样本'));
        assert.ok(started.run.instruction.includes('八维覆盖缺口'));
        assert.ok(started.run.instruction.includes('prompt_hash_previous_001'));
        assert.ok(started.run.instruction.includes('补给站激光机甲巡逻'));

        const run = await waitForRun(service, started.run.runId, context, item => item.phase === 'legil_completed');
        assert.strictEqual(run.status, 'completed');
        assert.strictEqual(run.promptTotal, 2);
        assert.strictEqual(run.promptTotalTranslated, 3);
        assert.strictEqual(run.promptTotalRejected, 1);
        assert.strictEqual(run.expectedImageTotal, 8);
        assert.strictEqual(run.promptTranslation.version, TRANSLATION_VERSION);
        assert.strictEqual(run.promptTranslation.promptCount, 3);
        assert.strictEqual(run.promptQualityReport.acceptedPromptCount, 2);
        assert.strictEqual(run.promptQualityReport.rejectedPromptCount, 1);
        assert.ok(run.promptQualityReport.rejectedPrompts.some(item => item.promptTitle === 'rejected forbidden prompt'));
        assert.ok(run.directionDefinitions.length >= 1);
        assert.strictEqual(run.prompts[0].translationVersion, TRANSLATION_VERSION);
        assert.strictEqual(run.prompts[0].prompt, run.prompts[0].finalPrompt);
        assert.strictEqual(run.legilResult.savedCount, 8);
        assert.strictEqual(run.legilResult.successCount, 2);
        assert.strictEqual(run.assets.success, true);
        assert.strictEqual(run.assets.newAssetCount, 8);
        assert.strictEqual(run.assetIds.length, 8);
        assert.ok(run.legilTask.taskId);
        assert.strictEqual(run.legilTask.status, 'completed');
        assert.strictEqual(run.legilTask.promptCount, 2);
        assert.strictEqual(run.legilTask.submittedPromptSource, 'prompt-gate-accepted');
        assert.strictEqual(run.legilPayload.browserMode, 'headed');
        assert.strictEqual(run.legilPayload.legilTaskId, run.legilTask.taskId);
        assert.strictEqual(run.legilPayload.generationSettings.imageModel, 'nano-banana-2');
        assert.strictEqual(run.legilPayload.generationSettings.aspectRatio, '1:1');
        assert.strictEqual(run.legilPayload.generationSettings.resolution, '2K');
        assert.strictEqual(run.legilPayload.generationSettings.outputQuantity, 4);
        assert.ok(run.legilPayload.prompts[0].promptHash);
        assert.strictEqual(run.legilPayload.prompts[0].translationVersion, TRANSLATION_VERSION);
        assert.strictEqual(legilPayload.prompts.length, 2);
        assert.strictEqual(legilPayload.legilTaskId, run.legilTask.taskId);
        assert.strictEqual(legilPayload.prompts.some(item => item.promptTitle === 'rejected forbidden prompt'), false);
        assert.strictEqual(legilPayload.prompts[0].prompt, legilPayload.prompts[0].finalPrompt);
        assert.strictEqual(legilPayload.browserMode, 'headed');

        const schedulerState = JSON.parse(fs.readFileSync(path.join(dataDir, 'scheduler-state.json'), 'utf8'));
        assert.strictEqual(schedulerState.status, 'idle');
        assert.strictEqual(schedulerState.daily.imageCount, 8);
        assert.strictEqual(schedulerState.consecutiveFailures, 0);

        const assetsData = JSON.parse(fs.readFileSync(path.join(dataDir, 'assets.json'), 'utf8'));
        assert.strictEqual(assetsData.assets.length, 8);
        assert.strictEqual(assetsData.assets[0].runId, started.run.runId);
        assert.strictEqual(assetsData.assets[0].source, 'creative-auto-run-once');
        assert.strictEqual(assetsData.assets[0].promptHash, legilPayload.prompts[0].promptHash);
        assert.strictEqual(assetsData.assets[0].legilTaskId, run.legilTask.taskId);
        assert.strictEqual(assetsData.assets[0].legilTaskStatus, 'completed');
        assert.strictEqual(assetsData.assets[0].generationSettings.imageModel, 'nano-banana-2');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

runLegilRunOnceTest()
    .then(() => {
        console.log('creative auto run-once legil tests passed');
    })
    .catch(error => {
        console.error(error);
        process.exit(1);
    });
