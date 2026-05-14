const browserController = require('../../../playwright-controller');
const logger = require('../../../logger');

function isAbortRequested(options = {}) {
    if (options.signal && options.signal.aborted) {
        return true;
    }
    if (typeof options.shouldAbort === 'function') {
        try {
            return !!options.shouldAbort();
        } catch (error) {
            logger.warn(`检查中止状态失败: ${error.message}`);
        }
    }
    return false;
}

function throwIfAborted(options = {}) {
    if (isAbortRequested(options)) {
        throw new Error('任务已中止');
    }
}

async function interruptibleSleep(ms, options = {}) {
    const checkInterval = 500;
    const startTime = Date.now();
    while (Date.now() - startTime < ms) {
        if (isAbortRequested(options)) {
            throw new Error('任务已中止');
        }
        await browserController.sleep(Math.min(checkInterval, ms - (Date.now() - startTime)));
    }
}

function normalizeImageUrl(src) {
    let value = String(src || '').split('#')[0];
    for (let i = 0; i < 3; i++) {
        try {
            const decoded = decodeURIComponent(value);
            if (decoded === value) break;
            value = decoded;
        } catch (e) {
            break;
        }
    }
    return value;
}

function isLegilOutputUrl(src) {
    const normalized = normalizeImageUrl(src);
    return normalized.includes('/output') && !normalized.includes('/input');
}

function extractLegilImageUrl(src) {
    const normalized = normalizeImageUrl(src);
    try {
        const parsed = new URL(normalized);
        const embeddedUrl = parsed.searchParams.get('url');
        return embeddedUrl ? normalizeImageUrl(embeddedUrl) : normalized;
    } catch (error) {
        return normalized;
    }
}

function isPageLocalImageUrl(src) {
    return /^blob:/i.test(String(src || '')) || /^data:image\//i.test(String(src || ''));
}

module.exports = {
    isAbortRequested,
    throwIfAborted,
    interruptibleSleep,
    normalizeImageUrl,
    isLegilOutputUrl,
    extractLegilImageUrl,
    isPageLocalImageUrl
};
