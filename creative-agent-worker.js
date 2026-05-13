const { parentPort, workerData } = require('worker_threads');
const { runCreativeAgent, sanitizeCreativeAgentError } = require('./creative-agent-service');

(async () => {
    try {
        const result = await runCreativeAgent(workerData || {});
        parentPort.postMessage({
            success: true,
            result
        });
    } catch (error) {
        parentPort.postMessage({
            success: false,
            message: sanitizeCreativeAgentError(error, workerData && workerData.apiKey)
        });
    }
})();
