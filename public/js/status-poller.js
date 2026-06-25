// Shared start/stop poller for page status modules.
(function () {
    function createStatusPoller(options = {}) {
        const name = options.name || 'status-poller';
        const intervalMs = Math.max(1000, Number(options.intervalMs) || 3000);
        let timer = null;
        let inFlight = false;
        let stopped = true;
        let visibilityHandlerBound = false;

        async function refresh() {
            if (inFlight || stopped) return null;
            if (options.pauseWhenHidden && document.visibilityState === 'hidden') return null;
            inFlight = true;
            try {
                const data = typeof options.load === 'function' ? await options.load() : null;
                if (typeof options.onData === 'function') {
                    options.onData(data);
                }
                return data;
            } catch (error) {
                if (typeof options.onError === 'function') {
                    options.onError(error);
                } else {
                    console.warn(`${name} refresh failed:`, error);
                }
                return null;
            } finally {
                inFlight = false;
            }
        }

        function start(startOptions = {}) {
            stop();
            stopped = false;
            if (options.pauseWhenHidden && !visibilityHandlerBound) {
                document.addEventListener('visibilitychange', () => {
                    if (!stopped && document.visibilityState === 'visible') {
                        refresh();
                    }
                });
                visibilityHandlerBound = true;
            }
            if (startOptions.immediate !== false) {
                refresh();
            }
            timer = setInterval(refresh, intervalMs);
            return api;
        }

        function stop() {
            stopped = true;
            if (timer) {
                clearInterval(timer);
                timer = null;
            }
            return api;
        }

        function isRunning() {
            return !stopped && Boolean(timer);
        }

        const api = {
            start,
            stop,
            refresh,
            isRunning
        };
        return api;
    }

    window.createStatusPoller = createStatusPoller;
})();
