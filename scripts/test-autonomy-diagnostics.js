const assert = require('assert');
const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createCreativeAutoService } = require('../src/services/creative-auto');
const registerCreativeAutoRoutes = require('../src/routes/creative-auto.routes');

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

function writeJson(filePath, data) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function seedKnowledge(root) {
    const dataDir = path.join(root, 'data', 'creative-knowledge');
    const outputFolder = path.join(root, 'output');
    const referenceFolder = path.join(root, 'reference');
    fs.mkdirSync(path.join(dataDir, 'runs'), { recursive: true });
    fs.mkdirSync(outputFolder, { recursive: true });
    fs.mkdirSync(referenceFolder, { recursive: true });

    const direction = {
        id: 'direction-p0',
        path: '题材/探索发现/地下补给站',
        name: '地下补给站',
        primaryTag: '题材',
        secondaryTag: '探索发现',
        status: 'seed',
        autoRun: true
    };
    const run = {
        runId: 'creative_run_p0_001',
        mode: 'agent-only',
        agentOnly: true,
        status: 'completed',
        phase: 'agent_completed',
        sourceDirection: direction,
        promptTotalRaw: 3,
        promptTotal: 2,
        promptQualityReport: {
            acceptedPromptCount: 2,
            rejectedPromptCount: 1,
            expectedImageTotal: 8
        },
        assets: {
            newAssetCount: 0
        },
        targetQueue: {
            queueId: 'creative_queue_p0',
            index: 1
        },
        createdAt: '2026-06-06T08:00:00.000Z',
        startedAt: '2026-06-06T08:00:00.000Z',
        completedAt: '2026-06-06T08:02:00.000Z',
        updatedAt: '2026-06-06T08:02:00.000Z',
        message: 'stub completed'
    };

    writeJson(path.join(dataDir, 'metadata.json'), {
        version: 1,
        importedAt: '2026-06-06T07:30:00.000Z',
        counts: {
            directions: 1,
            topMaterials: 2,
            topMaterialInsights: 1,
            referenceImages: 1
        },
        warnings: []
    });
    writeJson(path.join(dataDir, 'directions.json'), { version: 1, directions: [direction] });
    writeJson(path.join(dataDir, 'top-material-insights.json'), { version: 1, insights: [{ pathKey: direction.path }] });
    writeJson(path.join(dataDir, 'material-learnings.json'), { version: 1, learnings: [] });
    writeJson(path.join(dataDir, 'reference-images.json'), {
        version: 1,
        images: [{
            id: 'ref-p0',
            directionId: direction.id,
            matchedDirectionIds: [direction.id],
            filePath: path.join(referenceFolder, 'ref.png')
        }]
    });
    writeJson(path.join(dataDir, 'assets.json'), {
        version: 1,
        assets: [
            { assetId: 'asset-p0-1', runId: run.runId, reviewStatus: 'unreviewed' },
            { assetId: 'asset-p0-2', runId: run.runId, reviewStatus: 'good' }
        ]
    });
    writeJson(path.join(dataDir, 'feedback.json'), {
        version: 1,
        feedback: [{ feedbackId: 'feedback-p0', assetId: 'asset-p0-2', status: 'good' }]
    });
    writeJson(path.join(dataDir, 'creative-memory.json'), {
        version: 1,
        drafts: [],
        learningReports: [{ learningRunId: 'learning-p0' }],
        rules: {
            global: [{ ruleId: 'rule-p0', status: 'active', enabled: true, title: '保留清晰主体' }],
            dimension: {},
            node: {}
        },
        stats: {}
    });
    writeJson(path.join(dataDir, 'creative-target-queues.json'), {
        version: 1,
        queues: [{
            queueId: 'creative_queue_p0',
            status: 'paused',
            targets: [
                { targetId: 'target-1', sourceDirectionPath: direction.path },
                { targetId: 'target-2', sourceDirectionPath: '题材/资源争夺/油桶' }
            ],
            totalTargets: 2,
            currentIndex: 0,
            nextIndex: 1,
            currentRunId: run.runId,
            completedTargetIds: ['target-1'],
            totalExpectedPromptCount: 8,
            startedAt: '2026-06-06T08:00:00.000Z',
            updatedAt: '2026-06-06T08:03:00.000Z'
        }]
    });
    writeJson(path.join(dataDir, 'scheduler-state.json'), {
        version: 1,
        status: 'idle',
        currentRunId: '',
        lastRunId: run.runId,
        consecutiveFailures: 0,
        daily: {
            date: todayKey(),
            imageCount: 8,
            imageLimit: 1000
        },
        targetQueue: {
            queueId: 'creative_queue_p0',
            status: 'paused',
            totalTargets: 2,
            completedTargets: 1,
            remainingTargets: 1,
            currentRunId: run.runId
        },
        updatedAt: '2026-06-06T08:03:00.000Z'
    });
    writeJson(path.join(dataDir, 'runs', `${run.runId}.json`), run);

    return {
        dataDir,
        outputFolder,
        referenceFolder,
        run
    };
}

function assertDiagnosticsShape(data) {
    assert.strictEqual(data.success, true);
    [
        'serviceStatus',
        'schedulerState',
        'targetQueue',
        'lastRun',
        'legilResume',
        'knowledgeCounts',
        'policySummary',
        'warnings'
    ].forEach(key => assert.ok(Object.prototype.hasOwnProperty.call(data, key), `missing ${key}`));
    assert.strictEqual(data.policySummary.stageLabel, 'L2 单轮自动');
    assert.strictEqual(data.serviceStatus.stageLabel, 'L2 单轮自动');
    assert.strictEqual(data.schedulerState.targetQueue.queueId, data.targetQueue.queueId);
    assert.strictEqual(data.targetQueue.status, 'paused');
    assert.strictEqual(data.targetQueue.completedTargets, 1);
    assert.strictEqual(data.targetQueue.remainingTargets, 1);
    assert.strictEqual(data.lastRun.runId, 'creative_run_p0_001');
    assert.strictEqual(data.knowledgeCounts.directions, 1);
    assert.strictEqual(data.knowledgeCounts.assets, 2);
    assert.strictEqual(data.knowledgeCounts.unreviewedAssets, 1);
    assert.ok(Array.isArray(data.warnings));
}

async function withServer(app, fn) {
    const server = await new Promise(resolve => {
        const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });
    try {
        const port = server.address().port;
        return await fn(`http://127.0.0.1:${port}`);
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
}

async function main() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'creative-auto-p0-'));
    try {
        const seeded = seedKnowledge(root);
        const service = createCreativeAutoService({
            rootDir: root,
            logger: { info() {}, warn() {}, error() {} },
            getCreativeResumeInfo: () => ({ hasResume: false }),
            getCreativeProgressSnapshot: () => null
        });
        const context = {
            creativeAutoService: service,
            appConfig: {
                creative: {
                    outputFolder: seeded.outputFolder,
                    referenceFolder: seeded.referenceFolder,
                    browserMode: 'headed',
                    generationSettings: {
                        outputQuantity: 4
                    }
                }
            }
        };

        const direct = service.getDiagnostics(context);
        assertDiagnosticsShape(direct);
        console.log('[P0-diagnostics] OK - service diagnostics contract');

        const app = express();
        app.use(express.json());
        registerCreativeAutoRoutes(app, context);
        await withServer(app, async baseUrl => {
            const response = await fetch(`${baseUrl}/api/creative-auto/diagnostics`);
            assert.strictEqual(response.status, 200);
            const data = await response.json();
            assertDiagnosticsShape(data);
        });
        console.log('[P0-diagnostics] OK - GET /api/creative-auto/diagnostics');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

main().catch(error => {
    console.error('[P0-diagnostics] FAILED');
    console.error(error);
    process.exit(1);
});
