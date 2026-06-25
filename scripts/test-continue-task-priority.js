const assert = require('assert');
const { FeishuControlService } = require('../feishu-control-service');

class MockControlService extends FeishuControlService {
    constructor(responses) {
        super({ apiBaseUrl: 'http://127.0.0.1:0' });
        this.responses = responses;
        this.calls = [];
    }

    async getJson(endpoint) {
        this.calls.push(['GET', endpoint]);
        const value = this.responses[endpoint];
        if (value instanceof Error) throw value;
        if (typeof value === 'function') return value();
        return value;
    }

    async postJson(endpoint, data = {}) {
        this.calls.push(['POST', endpoint, data]);
        const key = `POST ${endpoint}`;
        const value = this.responses[key];
        if (value instanceof Error) throw value;
        if (typeof value === 'function') return value(data);
        return value || { success: true, message: `posted ${endpoint}` };
    }
}

async function main() {
    const running = new MockControlService({
        '/api/legil/task-status': { running: true, workflowRunning: false }
    });
    const runningResult = await running.continueAutomation();
    assert.strictEqual(runningResult.success, false);
    assert.deepStrictEqual(running.calls, [['GET', '/api/legil/task-status']]);

    const creativeAuto = new MockControlService({
        '/api/legil/task-status': { running: false, workflowRunning: false },
        '/api/creative-auto/status': { success: true, resumableRun: { runId: 'creative_run_1' } },
        'POST /api/creative-auto/runs/creative_run_1/resume': { success: true, message: 'creative-auto resumed' }
    });
    const creativeAutoResult = await creativeAuto.continueAutomation();
    assert.strictEqual(creativeAutoResult.success, true);
    assert.strictEqual(creativeAutoResult.message, 'creative-auto resumed');
    assert.deepStrictEqual(creativeAuto.calls.map(call => `${call[0]} ${call[1]}`), [
        'GET /api/legil/task-status',
        'GET /api/creative-auto/status',
        'POST /api/creative-auto/runs/creative_run_1/resume'
    ]);

    const legilResume = new MockControlService({
        '/api/legil/task-status': { running: false, workflowRunning: false },
        '/api/creative-auto/status': { success: true, resumableRun: null },
        '/api/legil/creative-resume': {
            resume: {
                hasResume: true,
                outputFolder: 'out',
                referenceFolder: 'ref',
                browserMode: 'headless',
                generationSettings: { outputQuantity: 1 },
                prompts: [{ prompt: 'retry prompt', selected: true }]
            }
        },
        'POST /api/legil/creative-batch': { success: true, message: 'legil creative resumed' }
    });
    const legilResult = await legilResume.continueAutomation();
    assert.strictEqual(legilResult.success, true);
    assert.strictEqual(legilResult.message, 'legil creative resumed');
    assert.deepStrictEqual(legilResume.calls.map(call => `${call[0]} ${call[1]}`), [
        'GET /api/legil/task-status',
        'GET /api/creative-auto/status',
        'GET /api/legil/creative-resume',
        'GET /api/legil/task-status',
        'GET /api/creative-auto/status',
        'GET /api/legil/creative-resume',
        'POST /api/legil/creative-batch'
    ]);

    const workflowResume = new MockControlService({
        '/api/legil/task-status': { running: false, workflowRunning: false },
        '/api/creative-auto/status': { success: true, resumableRun: null },
        '/api/legil/creative-resume': { resume: { hasResume: false } },
        '/api/workflow/resume-info': { resume: { hasResume: true } },
        'POST /api/workflow/resume': { success: true, message: 'workflow resumed' }
    });
    const workflowResult = await workflowResume.continueAutomation();
    assert.strictEqual(workflowResult.success, true);
    assert.strictEqual(workflowResult.message, 'workflow resumed');
    assert.deepStrictEqual(workflowResume.calls.map(call => `${call[0]} ${call[1]}`), [
        'GET /api/legil/task-status',
        'GET /api/creative-auto/status',
        'GET /api/legil/creative-resume',
        'GET /api/workflow/resume-info',
        'GET /api/legil/task-status',
        'POST /api/workflow/resume'
    ]);
}

main()
    .then(() => console.log('continue task priority tests passed'))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });
