const assert = require('assert');
const path = require('path');
const { createCreativeAutoService } = require('../src/services/creative-auto');
const {
    cleanupFixture,
    makeTempCreativeFixture,
    writeBaseKnowledge,
    writeJson
} = require('./creative-auto-test-utils');

function writeRunningAgentRun(fixture, overrides = {}) {
    const now = new Date();
    const run = {
        runId: overrides.runId || 'creative_run_stale_guard',
        status: 'running',
        phase: 'agent_running',
        mode: 'agent-only',
        agentOnly: true,
        createdAt: overrides.createdAt || now.toISOString(),
        startedAt: overrides.startedAt || now.toISOString(),
        updatedAt: overrides.updatedAt || now.toISOString(),
        agentTaskRunId: overrides.agentTaskRunId || '',
        sourceDirection: {
            id: 'direction-1',
            path: 'Topic/Source/Direction One'
        },
        message: 'Agent-only started'
    };
    writeJson(path.join(fixture.dataDir, 'runs', `${run.runId}.json`), run);
    writeJson(path.join(fixture.dataDir, 'scheduler-state.json'), {
        version: 1,
        status: 'running',
        currentRunId: run.runId,
        currentAgentTaskRunId: run.agentTaskRunId || null,
        daily: { date: '2026-06-06', imageCount: 0, imageLimit: 1000 }
    });
    return run;
}

function readRun(fixture, runId) {
    return require('fs').existsSync(path.join(fixture.dataDir, 'runs', `${runId}.json`))
        ? JSON.parse(require('fs').readFileSync(path.join(fixture.dataDir, 'runs', `${runId}.json`), 'utf8'))
        : null;
}

function runStaleAgentGuardTest() {
    const fixture = makeTempCreativeFixture('creative-auto-stale-agent-');
    try {
        writeBaseKnowledge(fixture);
        const appConfig = {
            creative: {
                outputFolder: fixture.outputFolder,
                referenceFolder: fixture.referenceFolder,
                browserMode: 'headless'
            }
        };

        const freshRun = writeRunningAgentRun(fixture, {
            runId: 'creative_run_fresh_agent',
            updatedAt: new Date().toISOString()
        });
        const service = createCreativeAutoService({
            rootDir: fixture.root,
            logger: { info() {}, warn() {}, error() {} }
        });
        const freshStatus = service.getStatus({ appConfig });
        const freshAfter = readRun(fixture, freshRun.runId);
        assert.strictEqual(freshStatus.status, 'running');
        assert.strictEqual(freshAfter.status, 'running');
        assert.strictEqual(freshAfter.phase, 'agent_running');

        const oldDate = new Date(Date.now() - 10 * 60 * 1000).toISOString();
        const oldRun = writeRunningAgentRun(fixture, {
            runId: 'creative_run_old_agent',
            createdAt: oldDate,
            startedAt: oldDate,
            updatedAt: oldDate
        });
        service.getStatus({ appConfig });
        const oldAfter = readRun(fixture, oldRun.runId);
        assert.strictEqual(oldAfter.status, 'paused');
        assert.strictEqual(oldAfter.phase, 'agent_cancelled');

        const liveFixture = makeTempCreativeFixture('creative-auto-live-agent-');
        try {
            writeBaseKnowledge(liveFixture);
            const liveRun = writeRunningAgentRun(liveFixture, {
                runId: 'creative_run_old_live_agent',
                createdAt: oldDate,
                startedAt: oldDate,
                updatedAt: oldDate,
                agentTaskRunId: 'creative_agent_live'
            });
            const liveService = createCreativeAutoService({
                rootDir: liveFixture.root,
                logger: { info() {}, warn() {}, error() {} },
                getCreativeAgentTask(runId) {
                    return runId === 'creative_agent_live'
                        ? { runId, phase: 'running', updatedAt: new Date().toISOString() }
                        : null;
                },
                publicCreativeAgentTask(task) {
                    return {
                        runId: task.runId,
                        phase: task.phase,
                        running: true
                    };
                }
            });
            liveService.getStatus({
                appConfig: {
                    creative: {
                        outputFolder: liveFixture.outputFolder,
                        referenceFolder: liveFixture.referenceFolder,
                        browserMode: 'headless'
                    }
                }
            });
            const liveAfter = readRun(liveFixture, liveRun.runId);
            assert.strictEqual(liveAfter.status, 'running');
            assert.strictEqual(liveAfter.phase, 'agent_running');
        } finally {
            cleanupFixture(liveFixture);
        }
    } finally {
        cleanupFixture(fixture);
    }
}

runStaleAgentGuardTest();
console.log('creative auto stale agent guard tests passed');
