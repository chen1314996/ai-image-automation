// Lightweight API client for new modules. Existing legacy helpers can keep working.
(function () {
    const pendingKeys = new Map();

    function normalizePendingKey(url, options = {}) {
        return options.pendingKey || `${String(options.method || 'GET').toUpperCase()} ${url}`;
    }

    function setButtonPending(target, pending, pendingText) {
        const button = typeof target === 'string' ? document.querySelector(target) : target;
        if (!button) return;
        if (pending) {
            button.dataset.apiClientOriginalText = button.textContent || '';
            button.disabled = true;
            if (pendingText) button.textContent = pendingText;
        } else {
            button.disabled = false;
            if (button.dataset.apiClientOriginalText) {
                button.textContent = button.dataset.apiClientOriginalText;
                delete button.dataset.apiClientOriginalText;
            }
        }
    }

    function setPending(key, pending, options = {}) {
        const nextCount = Math.max(0, (pendingKeys.get(key) || 0) + (pending ? 1 : -1));
        if (nextCount) {
            pendingKeys.set(key, nextCount);
        } else {
            pendingKeys.delete(key);
        }
        if (typeof options.onPending === 'function') {
            options.onPending(pending);
        }
        if (options.pendingTarget) {
            setButtonPending(options.pendingTarget, pending, options.pendingText);
        }
    }

    async function readJsonResponse(response, fallbackMessage = '请求失败') {
        const contentType = response.headers.get('content-type') || '';
        const text = await response.text();
        let data = {};
        if (text) {
            if (!contentType.includes('application/json') && /^\s*</.test(text)) {
                throw new Error(`${fallbackMessage}：接口返回了页面内容，请确认后端服务已重启。`);
            }
            try {
                data = JSON.parse(text);
            } catch (error) {
                throw new Error(`${fallbackMessage}：接口返回内容不是 JSON。`);
            }
        }
        if (!response.ok || data.success === false) {
            throw new Error(data.message || `${fallbackMessage}（HTTP ${response.status}）`);
        }
        return data;
    }

    async function fetchJson(url, options = {}) {
        const timeoutMs = Number(options.timeoutMs) || 20000;
        const fallbackMessage = options.fallbackMessage || '请求失败';
        const pendingKey = normalizePendingKey(url, options);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const fetchOptions = { ...options };
        delete fetchOptions.timeoutMs;
        delete fetchOptions.fallbackMessage;
        delete fetchOptions.pendingKey;
        delete fetchOptions.pendingTarget;
        delete fetchOptions.pendingText;
        delete fetchOptions.onPending;
        delete fetchOptions.toastOnError;

        setPending(pendingKey, true, options);
        try {
            const response = await fetch(url, {
                ...fetchOptions,
                signal: fetchOptions.signal || controller.signal
            });
            return await readJsonResponse(response, fallbackMessage);
        } catch (error) {
            if (error && error.name === 'AbortError') {
                throw new Error(`${fallbackMessage}：请求超时`);
            }
            if (options.toastOnError !== false && typeof window.showToast === 'function') {
                window.showToast(error.message || fallbackMessage, 'error');
            }
            throw error;
        } finally {
            clearTimeout(timer);
            setPending(pendingKey, false, options);
        }
    }

    function isPending(key) {
        return pendingKeys.has(key);
    }

    window.ApiClient = {
        fetchJson,
        readJsonResponse,
        setPending,
        isPending
    };

    if (typeof window.readJsonResponse !== 'function') {
        window.readJsonResponse = readJsonResponse;
    }
    if (typeof window.fetchJsonWithTimeout !== 'function') {
        window.fetchJsonWithTimeout = (url, options = {}, timeoutMs = 20000, fallbackMessage = '请求失败') => {
            return fetchJson(url, {
                ...options,
                timeoutMs,
                fallbackMessage
            });
        };
    }
})();
