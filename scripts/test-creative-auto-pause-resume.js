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
    return `主题：${subject}。画面动作：幸存者在冰封补给站门口抢修热源，旁边同伴搬开结冰木箱露出关键补给。场景：废弃补给站入口，前景有罐头、绳索、破损地图和结霜金属箱，中景人物动作明确，远景有风雪压迫。镜头：低机位中景。光线：冷蓝雪光与局部暖光对比。画风：高质量 3D 卡通游戏广告图。画面要求：1:1 方图，主体清楚，动作可读。`;
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

async function runPauseResumeTest() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'creative-auto-pause-resume-'));
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
    const runId = 'creative_run_pause_resume_test';

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
        status: 'running',
        currentRunId: runId,
        daily: { date: todayKey(), imageCount: 0, imageLimit: 1000 }
    }, null, 2));
    fs.writeFileSync(path.join(dataDir, 'runs', `${runId}.json`), JSON.stringify({
        runId,
        mode: 'legil-run-once',
        agentOnly: false,
        status: 'running',
        phase: 'legil_stopping',
        createdAt: new Date().toISOString(),
        startedAt: new Date().toISOString(),
        completedAt: '',
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
        expectedImageTotal: 4,
        prompts: [prompt],
        promptQualityReport: {
            rawPromptCount: 1,
            acceptedPromptCount: 1,
            rejectedPromptCount: 0,
            outputQuantity: 4
        },
        legilProgress: {
            taskType: 'creative-batch',
            phase: 'stopping',
            total: 1,
            completed: 0,
            success: 0,
            failed: 0,
            saved: 0,
            currentAction: '正在停止创意拓展任务...'
        }
    }, null, 2));

    let stopRequested = false;
    let legilPayload = null;
    const savedFile = path.join(outputFolder, 'resume_ref001_prompt01_v01.png');
    const service = createCreativeAutoService({
        rootDir: root,
        logger: { info() {}, warn() {}, error() {} },
        legilProgressPollMs: 100,
        legilProgressMaxWaitMs: 1000,
        isLegilBusy: () => false,
        requestLegilTaskStop: () => {
            stopRequested = true;
            return { success: true, message: '已发送停止指令' };
        },
        getCreativeProgressSnapshot: () => ({
            hasProgress: true,
            running: false,
            stopRequested,
            taskType: 'creative-batch',
            progress: {
                taskType: 'creative-batch',
                phase: 'stopping',
                total: 1,
                completed: 0,
                success: 0,
                failed: 0,
                saved: 0,
                currentAction: '正在停止创意拓展任务...'
            }
        }),
        getCreativeResumeInfo: () => ({
            hasResume: true,
            runId: 'legil_batch_resume_1',
            prompts: [prompt],
            remainingCount: 1,
            total: 1
        }),
        startLegilCreativeBatch: async payload => {
            legilPayload = payload;
            return {
                success: true,
                message: 'Legil resume stub started',
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
        getLegilCreativeProgress: async () => {
            if (!fs.existsSync(savedFile)) {
                fs.writeFileSync(savedFile, Buffer.from('resume-image'));
            }
            return {
                success: true,
                hasProgress: true,
                running: false,
                stopRequested: false,
                taskType: 'creative-batch',
                progress: {
                    taskType: 'creative-batch',
                    phase: 'completed',
                    total: 1,
                    completed: 1,
                    success: 1,
                    failed: 0,
                    saved: 1,
                    outputTotal: 4,
                    savedFiles: [{
                        filePath: savedFile,
                        promptListIndex: 1,
                        imageIndex: 1,
                        savedAt: new Date().toISOString()
                    }],
                    promptResults: [],
                    currentAction: 'completed'
                }
            };
        }
    });

    try {
        const context = { dataDir, appConfig: { creative: { outputFolder, referenceFolder } } };
        const paused = service.pauseRun(runId, {}, context);
        assert.strictEqual(paused.success, true);
        assert.strictEqual(paused.run.status, 'paused');
        assert.strictEqual(paused.run.phase, 'legil_paused');
        assert.strictEqual(stopRequested, true);
        const pausedStatus = service.getStatus(context);
        assert.strictEqual(pausedStatus.resumableRun.runId, runId);
        assert.strictEqual(pausedStatus.resumableRun.status, 'paused');

        const resumed = service.resumeRun(runId, {}, context);
        assert.strictEqual(resumed.success, true);
        assert.strictEqual(resumed.run.status, 'running');
        assert.strictEqual(resumed.run.phase, 'legil_pending');

        const completed = await waitForRun(service, runId, context, item => item.phase === 'legil_completed');
        assert.strictEqual(completed.status, 'completed');
        assert.strictEqual(completed.legilResult.savedCount, 1);
        assert.ok(legilPayload);
        assert.strictEqual(legilPayload.resumeMode, true);
        assert.strictEqual(legilPayload.resumeRunId, 'legil_batch_resume_1');
        assert.strictEqual(legilPayload.prompts.length, 1);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

async function runStalePausedLiveLegilTest() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'creative-auto-stale-paused-'));
    const dataDir = path.join(root, 'data', 'creative-knowledge');
    const outputFolder = path.join(root, 'output');
    const referenceFolder = path.join(root, 'reference');
    fs.mkdirSync(path.join(dataDir, 'runs'), { recursive: true });
    fs.mkdirSync(outputFolder, { recursive: true });
    fs.mkdirSync(referenceFolder, { recursive: true });

    const direction = {
        id: 'direction-live',
        path: 'topic/live-legil',
        name: 'live-legil',
        autoRun: true,
        priority: 90,
        stats: {}
    };
    const runId = 'creative_run_stale_paused_live_legil';

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
        currentRunId: null,
        daily: { date: todayKey(), imageCount: 0, imageLimit: 1000 }
    }, null, 2));
    fs.writeFileSync(path.join(dataDir, 'runs', `${runId}.json`), JSON.stringify({
        runId,
        mode: 'legil-run-once',
        agentOnly: false,
        status: 'paused',
        phase: 'legil_paused',
        createdAt: new Date().toISOString(),
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        sourceDirection: direction,
        selection: { score: 90, reasons: ['test'] },
        config: { outputFolder, referenceFolder },
        schedulerState: {
            daily: { date: todayKey(), imageCount: 0, imageLimit: 1000 }
        },
        promptTotalRaw: 4,
        promptTotal: 4,
        expectedImageTotal: 16,
        prompts: [],
        legilProgress: {
            taskType: 'creative-batch',
            phase: 'stopped',
            total: 4,
            completed: 2,
            success: 2,
            failed: 0,
            saved: 8,
            creativeAutoRunId: runId
        }
    }, null, 2));

    let stopRequested = false;
    const service = createCreativeAutoService({
        rootDir: root,
        logger: { info() {}, warn() {}, error() {} },
        requestLegilTaskStop: () => {
            stopRequested = true;
            return { success: true, message: 'Stop requested' };
        },
        getCreativeProgressSnapshot: () => ({
            hasProgress: true,
            running: true,
            stopRequested,
            taskType: 'creative-batch',
            progress: {
                taskType: 'creative-batch',
                phase: stopRequested ? 'stopping' : 'running',
                total: 4,
                completed: 2,
                success: 2,
                failed: 0,
                saved: 8,
                creativeAutoRunId: runId,
                currentAction: stopRequested ? 'Stopping' : 'Running live Legil task'
            }
        })
    });

    try {
        const context = { dataDir, appConfig: { creative: { outputFolder, referenceFolder } } };
        const status = service.getStatus(context);
        assert.strictEqual(status.activeRun.runId, runId);
        assert.strictEqual(status.activeRun.status, 'running');
        assert.strictEqual(status.activeRun.phase, 'legil_running');
        assert.strictEqual(status.legilTask.running, true);
        assert.strictEqual(status.legilTask.runId, runId);

        const paused = service.pauseRun(runId, {}, context);
        assert.strictEqual(paused.success, true);
        assert.strictEqual(stopRequested, true);
        assert.strictEqual(paused.run.status, 'running');
        assert.strictEqual(paused.run.phase, 'legil_stopping');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

runPauseResumeTest()
    .then(runStalePausedLiveLegilTest)
    .then(() => {
        console.log('creative auto pause/resume tests passed');
    })
    .catch(error => {
        console.error(error);
        process.exit(1);
    });
