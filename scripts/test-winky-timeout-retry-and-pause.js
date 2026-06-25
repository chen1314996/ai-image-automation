const assert = require('assert');
const http = require('http');
const path = require('path');

const {
    cleanupFixture,
    makeTempCreativeFixture,
    waitFor,
    writeBaseKnowledge
} = require('./creative-auto-test-utils');
const {
    createCreativeAutoService
} = require('../src/services/creative-auto');
const {
    formatCreativeAgentPausedMessage,
    isWinkyTimeoutError,
    runCreativeAgent
} = require('../creative-agent-service');

function startMockWinkyServer(handler) {
    return new Promise(resolve => {
        const server = http.createServer((req, res) => {
            let body = '';
            req.on('data', chunk => {
                body += chunk;
            });
            req.on('end', () => handler(req, res, body));
        });
        server.listen(0, '127.0.0.1', () => {
            resolve({
                server,
                url: `http://127.0.0.1:${server.address().port}/winky/openai/v1/chat/completions`
            });
        });
    });
}

async function closeServer(server) {
    await new Promise(resolve => server.close(resolve));
}

async function testWinkyRetriesThenSucceeds() {
    let calls = 0;
    const retryEvents = [];
    const { server, url } = await startMockWinkyServer((req, res) => {
        calls += 1;
        if (calls <= 2) {
            res.writeHead(504, { 'Content-Type': 'text/plain' });
            res.end('stream timeout');
            return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            choices: [{
                message: {
                    content: '提示词1：雨夜桥下的救援画面，电影级光影，清晰主体。'
                },
                finish_reason: 'stop'
            }]
        }));
    });

    try {
        const result = await runCreativeAgent({
            apiUrl: url,
            apiKey: 'test-key',
            model: 'test-model',
            instruction: '生成 1 条测试提示词',
            targetCount: 1,
            attachments: [],
            onRetry: event => retryEvents.push(event)
        });
        assert.strictEqual(calls, 3);
        assert.strictEqual(retryEvents.length, 2);
        assert.match(retryEvents[0].message, /Winky 超时/);
        assert.match(retryEvents[1].message, /第 2\/2 次/);
        assert.strictEqual(result.success, true);
        assert.match(result.rawText, /雨夜桥下/);
    } finally {
        await closeServer(server);
    }
}

async function testWinkyRetriesThenFailsWithFriendlyClassifier() {
    let calls = 0;
    const { server, url } = await startMockWinkyServer((req, res) => {
        calls += 1;
        res.writeHead(504, { 'Content-Type': 'text/plain' });
        res.end('stream timeout');
    });

    try {
        await assert.rejects(
            () => runCreativeAgent({
                apiUrl: url,
                apiKey: 'test-key',
                model: 'test-model',
                instruction: '生成 1 条测试提示词',
                targetCount: 1,
                attachments: []
            }),
            error => {
                assert.strictEqual(calls, 3);
                assert.strictEqual(isWinkyTimeoutError(error), true);
                assert.match(formatCreativeAgentPausedMessage(error), /Winky 连续超时/);
                return true;
            }
        );
    } finally {
        await closeServer(server);
    }
}

async function testCreativeAutoPausesQueuedRunOnWinkyTimeout() {
    const fixture = makeTempCreativeFixture('creative-auto-winky-timeout-');
    try {
        writeBaseKnowledge(fixture);
        const task = {
            runId: 'agent-winky-timeout-test',
            phase: 'failed',
            error: 'Winky 连续超时，本轮创意 Agent 已暂停；队列会保留在当前方向，稍后点击继续即可重试。',
            message: 'Winky 连续超时，本轮创意 Agent 已暂停；队列会保留在当前方向，稍后点击继续即可重试。'
        };
        const logs = [];
        const service = createCreativeAutoService({
            rootDir: fixture.root,
            logger: {
                info: message => logs.push(['info', message]),
                warn: message => logs.push(['warn', message]),
                error: message => logs.push(['error', message])
            },
            getStoredWinkyConfig: () => ({
                apiKey: 'test-key',
                apiUrl: 'http://127.0.0.1/winky/openai/v1/chat/completions',
                model: 'test-model',
                provider: ''
            }),
            startCreativeAgentTask: () => task,
            getCreativeAgentTask: () => task,
            publicCreativeAgentTask: value => value,
            isLegilBusy: () => false
        });

        const started = service.runOnce({
            agentOnly: true,
            maxPrompts: 4,
            creativeBrief: {
                packageType: 'creative-target-package',
                target: 'source-directions',
                targets: [
                    {
                        id: 'direction:direction-1',
                        sourceDirectionId: 'direction-1',
                        sourceDirectionPath: 'Topic/Source/Direction One',
                        sourceDirectionName: 'Direction One',
                        selected: true
                    },
                    {
                        id: 'direction:direction-2',
                        sourceDirectionId: 'direction-2',
                        sourceDirectionPath: 'Topic/Source/Direction Two',
                        sourceDirectionName: 'Direction Two',
                        selected: true
                    }
                ]
            }
        }, {
            dataDir: fixture.dataDir,
            appConfig: {
                creative: {
                    outputFolder: path.join(fixture.root, 'output'),
                    referenceFolder: fixture.referenceFolder
                }
            }
        });
        assert.strictEqual(started.success, true);

        const pausedRun = await waitFor(() => {
            const run = service.getRun(started.run.runId, { dataDir: fixture.dataDir });
            return run && run.status === 'paused' ? run : null;
        }, 4000, 50);
        assert.strictEqual(pausedRun.phase, 'agent_winky_timeout');
        assert.match(pausedRun.message, /已暂停队列/);

        const status = service.getStatus({ dataDir: fixture.dataDir });
        assert.strictEqual(status.targetQueue.status, 'paused');
        assert.strictEqual(status.resumableRun.runId, started.run.runId);
        assert.ok(logs.some(([level, message]) => level === 'warn' && /Winky 连续超时/.test(message)));
    } finally {
        cleanupFixture(fixture);
    }
}

(async () => {
    await testWinkyRetriesThenSucceeds();
    await testWinkyRetriesThenFailsWithFriendlyClassifier();
    await testCreativeAutoPausesQueuedRunOnWinkyTimeout();
    console.log('winky timeout retry and pause tests passed');
})().catch(error => {
    console.error('winky timeout retry and pause tests failed');
    console.error(error);
    process.exitCode = 1;
});
