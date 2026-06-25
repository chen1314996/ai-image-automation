const { parentPort, workerData } = require('worker_threads');
const {
    formatCreativeAgentPausedMessage,
    isWinkyTimeoutError,
    runCreativeAgent,
    sanitizeCreativeAgentError
} = require('./creative-agent-service');

(async () => {
    try {
        const result = await runCreativeAgent({
            ...(workerData || {}),
            onRetry: event => {
                parentPort.postMessage({
                    type: 'retry',
                    ...event
                });
            }
        });
        parentPort.postMessage({
            success: true,
            result
        });
    } catch (error) {
        const friendlyMessage = formatCreativeAgentPausedMessage(error);
        parentPort.postMessage({
            success: false,
            message: sanitizeCreativeAgentError(error, workerData && workerData.apiKey),
            friendlyMessage,
            winkyTimeout: isWinkyTimeoutError(error)
        });
    }
})();
