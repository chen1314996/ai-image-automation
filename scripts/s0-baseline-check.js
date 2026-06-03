const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { createCreativeAutoService } = require('../src/services/creative-auto');

const ROOT_DIR = path.resolve(__dirname, '..');

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

function logPass(message) {
    console.log(`[S0] OK - ${message}`);
}

function readProjectFile(relativePath) {
    return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

function assertFileContains(relativePath, checks) {
    const text = readProjectFile(relativePath);
    checks.forEach(check => {
        const ok = check instanceof RegExp ? check.test(text) : text.includes(check);
        assert.ok(ok, `${relativePath} missing ${check.toString()}`);
    });
}

function runNodeScript(relativePath) {
    const scriptPath = path.join(ROOT_DIR, relativePath);
    const result = spawnSync(process.execPath, [scriptPath], {
        cwd: ROOT_DIR,
        stdio: 'inherit'
    });

    if (result.error) {
        throw result.error;
    }

    assert.strictEqual(
        result.status,
        0,
        `${relativePath} exited with status ${result.status}`
    );
}

function createPrompt(subject) {
    return [
        `主题：${subject}。`,
        '画风：高质量 3D 卡通渲染，商业级游戏广告海报风格，电影镜头感。',
        '情绪氛围：紧张、明确、有求生希望，冰雪环境里有清晰的温差对比。',
        '画面内容：幸存者在冰封废墟中围绕关键资源展开行动，前景有清楚的手部动作和道具，中景有人物关系，远景有被风雪吞没的旧文明建筑。',
        '构图要求：方图中心稳定，主体足够大，缩略图下也能一眼看懂广告点击点。',
        '光线与材质：冷蓝雪景与局部暖光形成对比，冰面、金属、布料和呼吸白雾都要有可见质感。',
        '文字规则：如画面出现文字，只使用短中文标语，不出现具体商标或长段外文。',
        '冰雪氛围，画面直观、主题明确，高质量 3D 卡通渲染，商业级游戏宣传海报风格。'
    ].join('');
}

function seedKnowledgeBase({ dataDir, outputFolder, referenceFolder }) {
    fs.mkdirSync(path.join(dataDir, 'runs'), { recursive: true });
    fs.mkdirSync(outputFolder, { recursive: true });
    fs.mkdirSync(referenceFolder, { recursive: true });

    const direction = {
        id: 'direction-s0',
        path: '题材/探索发现/补给站',
        name: '补给站',
        primaryTag: '题材',
        secondaryTag: '探索发现',
        tertiaryTag: '',
        subTag: '补给站',
        description: '幸存者寻找并争夺冰封补给站的关键资源。',
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

    fs.writeFileSync(path.join(dataDir, 'metadata.json'), JSON.stringify({
        version: 1,
        importedAt: new Date().toISOString(),
        counts: {
            directions: 1,
            topMaterials: 1,
            topMaterialInsights: 1,
            referenceImages: 0
        },
        warnings: []
    }, null, 2), 'utf8');
    fs.writeFileSync(path.join(dataDir, 'directions.json'), JSON.stringify({
        version: 1,
        directions: [direction],
        updatedAt: new Date().toISOString()
    }, null, 2), 'utf8');
    fs.writeFileSync(path.join(dataDir, 'top-material-insights.json'), JSON.stringify({
        version: 1,
        insights: [{
            pathKey: direction.path,
            materialCount: 3,
            avgCtr: 0.07,
            avgD7IapRoi: 0.15,
            topNames: ['补给站高点击素材'],
            keywords: ['补给', '废墟', '暖光']
        }]
    }, null, 2), 'utf8');
    fs.writeFileSync(path.join(dataDir, 'reference-images.json'), JSON.stringify({
        version: 1,
        images: []
    }, null, 2), 'utf8');
    fs.writeFileSync(path.join(dataDir, 'assets.json'), JSON.stringify({
        version: 1,
        assets: []
    }, null, 2), 'utf8');
    fs.writeFileSync(path.join(dataDir, 'scheduler-state.json'), JSON.stringify({
        version: 1,
        status: 'idle',
        consecutiveFailures: 0,
        daily: {
            date: todayKey(),
            imageCount: 0,
            imageLimit: 1000
        },
        updatedAt: new Date().toISOString()
    }, null, 2), 'utf8');

    return direction;
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
    throw new Error(`Timed out waiting for run ${runId}`);
}

async function checkStatusAndAgentOnly() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'creative-auto-s0-'));
    const dataDir = path.join(root, 'data', 'creative-knowledge');
    const outputFolder = path.join(root, 'output');
    const referenceFolder = path.join(root, 'reference');

    try {
        const direction = seedKnowledgeBase({ dataDir, outputFolder, referenceFolder });
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

        const agentResult = {
            fileName: 's0-agent.xlsx',
            downloadUrl: '/api/creative-agent/download/s0-agent.xlsx',
            localPath: path.join(root, 's0-agent.xlsx'),
            prompts: [{
                index: 1,
                direction: '补给站暖光',
                promptTitle: '门口抢修热源灯',
                prompt: createPrompt('冰封补给站门口幸存者抢修热源灯'),
                selected: true
            }],
            rawText: '| raw table |',
            rawTableMarkdown: '| raw table |',
            markdownPreview: '| raw table |',
            message: 'stub completed'
        };
        const task = {
            runId: 's0-agent-task',
            phase: 'completed',
            createdAt: new Date().toISOString(),
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            currentAction: 'done',
            attachmentCount: 0,
            targetCount: 5,
            result: agentResult,
            message: 'done',
            error: ''
        };

        const service = createCreativeAutoService({
            rootDir: root,
            logger: { info() {}, error() {} },
            getStoredWinkyConfig: () => ({
                apiUrl: 'https://example.invalid',
                apiKey: 'test-key',
                model: 'test-model'
            }),
            hasActiveCreativeAgentTask: () => false,
            isLegilBusy: () => false,
            startCreativeAgentTask: () => task,
            getCreativeAgentTask: () => task,
            publicCreativeAgentTask: (currentTask, includeResult) => ({
                ...currentTask,
                result: includeResult ? currentTask.result : undefined
            }),
            promptTranslatorClient: async () => ({
                prompts: agentResult.prompts.map(prompt => ({
                    index: prompt.index,
                    sourceIndex: prompt.index,
                    promptTitle: prompt.promptTitle,
                    finalPrompt: prompt.prompt,
                    subject: prompt.direction,
                    action: '幸存者在冰封场景中完成明确动作',
                    scene: direction.path,
                    camera: '中景构图，主体清楚',
                    lighting: '冷暖对比光，关键道具可读',
                    visualStyle: '写实广告视觉，冰封末世质感',
                    textRule: '不使用真实品牌，不出现大面积英文'
                }))
            })
        });

        const status = service.getStatus(context);
        assert.strictEqual(status.success, true);
        assert.strictEqual(status.preflight.ok, true);
        assert.ok(status.quota.remainingImagesToday > 0);
        assert.strictEqual(status.suggestion.next.direction.id, direction.id);
        logPass('status service returns state, quota, preflight, and next direction');

        const started = service.runOnce({ agentOnly: true, maxPrompts: 1 }, context);
        assert.strictEqual(started.success, true);
        assert.strictEqual(started.run.agentOnly, true);
        assert.strictEqual(started.run.mode, 'agent-only');

        const run = await waitForRun(
            service,
            started.run.runId,
            context,
            item => item.status === 'completed' && item.phase === 'agent_completed'
        );

        assert.strictEqual(run.promptTotalRaw, 1);
        assert.strictEqual(run.promptTotal, 1);
        assert.strictEqual(run.expectedImageTotal, 4);
        assert.strictEqual(run.legilPayload, null);
        assert.strictEqual(run.legilTask, null);
        assert.strictEqual(run.promptQualityReport.acceptedPromptCount, 1);
        logPass('agentOnly run-once completes with Prompt Gate output and no Legil task');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

function checkStaticRoutesAndPages() {
    assertFileContains('src/routes/creative-auto.routes.js', [
        "app.get('/api/creative-auto/status'",
        "app.post('/api/creative-auto/run-once'",
        "app.get('/api/creative-auto/runs/:runId'"
    ]);
    assertFileContains('src/services/creative-auto/assets.js', [
        'function registerRunAssets',
        "source: 'creative-auto-run-once'",
        "store.write('assets.json'"
    ]);
    assertFileContains('public/index.html', [
        'id="massPageTab"',
        'id="resizePageTab"',
        'id="creativePageTab"',
        'id="renamePageTab"',
        'id="massPage"',
        'id="resizePage"',
        'id="creativePage"',
        'id="renamePage"',
        'id="creativeAutoRunBtn"',
        '运行一次自动创意'
    ]);
    assertFileContains('public/js/creative-auto.js', [
        '/api/creative-auto/status',
        '/api/creative-auto/run-once',
        '/api/creative-auto/runs/',
        'startCreativeAutoRun'
    ]);
    assertFileContains('public/js/ui-core.js', [
        "targetPage === 'mass'",
        "targetPage === 'resize'",
        "targetPage === 'creative'",
        "targetPage === 'rename'"
    ]);
    logPass('routes, asset writer, page entries, and automatic creative button are present');
}

async function main() {
    checkStaticRoutesAndPages();
    await checkStatusAndAgentOnly();

    runNodeScript('scripts/test-creative-auto-prompt-gate.js');
    logPass('Prompt Gate regression script passes');

    runNodeScript('scripts/test-creative-auto-run-once-legil.js');
    logPass('small Legil run-once stub saves images and writes assets.json with runId');

    console.log('[S0] Baseline locked. Use this before S1+ changes.');
}

main().catch(error => {
    console.error('[S0] Baseline failed');
    console.error(error);
    process.exit(1);
});
