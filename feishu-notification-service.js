const logger = require('./logger');

const DEFAULT_COOLDOWN_MS = 10 * 60 * 1000;
const DEFAULT_COMPLETION_SUMMARY_DELAY_MS = 5 * 60 * 1000;

function truncateText(value, maxLength = 3500) {
    const text = String(value || '');
    return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

function formatDateTime(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
        return new Date().toLocaleString('zh-CN', { hour12: false });
    }
    return date.toLocaleString('zh-CN', { hour12: false });
}

function normalizeLevel(level) {
    const text = String(level || '').toLowerCase();
    if (['info', 'warning', 'error', 'critical'].includes(text)) {
        return text;
    }
    return 'info';
}

function levelLabel(level) {
    switch (normalizeLevel(level)) {
        case 'critical':
            return '严重';
        case 'error':
            return '错误';
        case 'warning':
            return '警告';
        default:
            return '信息';
    }
}

class FeishuNotificationService {
    constructor(options = {}) {
        this.bridge = options.bridge;
        this.cooldownMs = Number(options.cooldownMs) > 0 ? Number(options.cooldownMs) : DEFAULT_COOLDOWN_MS;
        this.cooldowns = new Map();
        this.history = [];
        this.maxHistory = 80;
        this.enabled = options.enabled !== false;
        this.completionSummaryDelayMs = Number(options.completionSummaryDelayMs) > 0
            ? Number(options.completionSummaryDelayMs)
            : DEFAULT_COMPLETION_SUMMARY_DELAY_MS;
        this.completionSummaryTimer = null;
        this.completionSummaryQueue = [];
    }

    configure(options = {}) {
        if (Object.prototype.hasOwnProperty.call(options, 'bridge')) {
            this.bridge = options.bridge;
        }
        if (Object.prototype.hasOwnProperty.call(options, 'enabled')) {
            this.enabled = options.enabled !== false;
        }
        if (Number(options.cooldownMs) > 0) {
            this.cooldownMs = Number(options.cooldownMs);
        }
        if (Number(options.completionSummaryDelayMs) > 0) {
            this.completionSummaryDelayMs = Number(options.completionSummaryDelayMs);
        }
    }

    shouldSend(key, cooldownMs = this.cooldownMs) {
        const safeKey = String(key || 'default');
        const now = Date.now();
        const lastAt = this.cooldowns.get(safeKey) || 0;
        if (cooldownMs > 0 && now - lastAt < cooldownMs) {
            return false;
        }
        this.cooldowns.set(safeKey, now);
        return true;
    }

    record(entry) {
        this.history.unshift({
            ...entry,
            createdAt: new Date().toISOString()
        });
        if (this.history.length > this.maxHistory) {
            this.history.length = this.maxHistory;
        }
    }

    buildMessage(payload = {}) {
        const title = String(payload.title || '自动化平台通知').trim();
        const lines = [
            `**${title}**`,
            '',
            `级别：${levelLabel(payload.level)}`,
            `时间：${formatDateTime(payload.time || new Date())}`
        ];

        if (payload.taskType) {
            lines.push(`任务类型：${payload.taskType}`);
        }
        if (payload.progress) {
            lines.push(`进度：${payload.progress}`);
        }
        if (payload.stage) {
            lines.push(`阶段：${payload.stage}`);
        }
        if (payload.message) {
            lines.push(`说明：${payload.message}`);
        }
        if (payload.suggestion) {
            lines.push(`建议：${payload.suggestion}`);
        }
        if (Array.isArray(payload.extraLines) && payload.extraLines.length) {
            lines.push('', ...payload.extraLines.map(line => String(line || '')).filter(Boolean));
        }

        return truncateText(lines.join('\n'));
    }

    async notify(payload = {}, options = {}) {
        const level = normalizeLevel(payload.level);
        const key = options.key || payload.key || `${level}:${payload.title || payload.message || 'notification'}`;
        const cooldownMs = Number(options.cooldownMs) >= 0 ? Number(options.cooldownMs) : this.cooldownMs;

        if (!this.enabled) {
            this.record({ sent: false, skipped: true, reason: 'disabled', level, key, payload });
            return { success: false, skipped: true, message: '飞书通知未启用' };
        }
        if (!this.shouldSend(key, cooldownMs)) {
            this.record({ sent: false, skipped: true, reason: 'cooldown', level, key, payload });
            return { success: true, skipped: true, message: '同类通知冷却中' };
        }
        if (!this.bridge || typeof this.bridge.sendMessage !== 'function') {
            this.record({ sent: false, skipped: true, reason: 'bridge_missing', level, key, payload });
            return { success: false, skipped: true, message: '飞书桥接未配置' };
        }

        const text = this.buildMessage({ ...payload, level });
        try {
            const result = await this.bridge.sendMessage(text);
            if (payload.screenshotPath && typeof this.bridge.sendImage === 'function') {
                try {
                    const imageResult = await this.bridge.sendImage(payload.screenshotPath);
                    result.screenshot = imageResult;
                } catch (imageError) {
                    result.screenshot = {
                        success: false,
                        message: imageError.message
                    };
                    logger.warn('飞书异常截图发送失败: ' + imageError.message);
                }
            }
            this.record({ sent: true, level, key, payload, result });
            return result;
        } catch (error) {
            const message = error && error.message ? error.message : String(error || '未知错误');
            logger.warn('飞书通知发送失败: ' + message);
            this.record({ sent: false, level, key, payload, error: message });
            return { success: false, message };
        }
    }

    buildCompletionSummaryMessage(entries = []) {
        const safeEntries = Array.isArray(entries) ? entries : [];
        const title = safeEntries.length > 1 ? `任务完成汇总（${safeEntries.length} 项）` : '任务完成汇总';
        const lines = [
            `**${title}**`,
            '',
            `时间：${formatDateTime(new Date())}`
        ];

        safeEntries.slice(0, 12).forEach((entry, index) => {
            const payload = entry && entry.payload ? entry.payload : {};
            const parts = [
                `${index + 1}. ${payload.title || '任务已完成'}`,
                payload.taskType ? `类型：${payload.taskType}` : '',
                payload.progress ? `进度：${payload.progress}` : '',
                payload.message ? `说明：${payload.message}` : ''
            ].filter(Boolean);
            lines.push('', ...parts);
        });

        if (safeEntries.length > 12) {
            lines.push('', `另有 ${safeEntries.length - 12} 项完成事件已合并。`);
        }

        return truncateText(lines.join('\n'));
    }

    async flushCompletionSummary(reason = 'timer') {
        if (this.completionSummaryTimer) {
            clearTimeout(this.completionSummaryTimer);
            this.completionSummaryTimer = null;
        }

        const entries = this.completionSummaryQueue.splice(0);
        if (!entries.length) {
            return { success: true, skipped: true, message: '没有待发送的完成汇总' };
        }

        if (!this.enabled) {
            this.record({ sent: false, skipped: true, reason: 'disabled', level: 'info', key: 'completion-summary', payload: { entries } });
            return { success: false, skipped: true, message: '飞书通知未启用' };
        }
        if (!this.bridge || typeof this.bridge.sendMessage !== 'function') {
            this.record({ sent: false, skipped: true, reason: 'bridge_missing', level: 'info', key: 'completion-summary', payload: { entries } });
            return { success: false, skipped: true, message: '飞书桥接未配置' };
        }

        const text = this.buildCompletionSummaryMessage(entries);
        try {
            const result = await this.bridge.sendMessage(text);
            this.record({
                sent: true,
                level: 'info',
                key: `completion-summary:${reason}`,
                payload: { count: entries.length, entries },
                result
            });
            return result;
        } catch (error) {
            const message = error && error.message ? error.message : String(error || '未知错误');
            logger.warn('飞书完成汇总发送失败: ' + message);
            this.record({ sent: false, level: 'info', key: `completion-summary:${reason}`, payload: { entries }, error: message });
            return { success: false, message };
        }
    }

    notifyCompletionSummarySoon(payload = {}, options = {}) {
        this.completionSummaryQueue.push({
            payload,
            options,
            queuedAt: new Date().toISOString()
        });

        if (this.completionSummaryTimer) {
            return {
                success: true,
                queued: true,
                message: '完成通知已加入汇总队列'
            };
        }

        this.completionSummaryTimer = setTimeout(() => {
            this.flushCompletionSummary('batch').catch(error => {
                logger.warn('飞书完成汇总异步发送失败: ' + error.message);
            });
        }, this.completionSummaryDelayMs);
        this.completionSummaryTimer.unref();

        return {
            success: true,
            queued: true,
            message: '完成通知已加入汇总队列'
        };
    }

    notifySoon(payload = {}, options = {}) {
        setImmediate(() => {
            this.notify(payload, options).catch(error => {
                logger.warn('飞书通知异步发送失败: ' + error.message);
            });
        });
    }

    getStatus() {
        return {
            enabled: this.enabled,
            cooldownMs: this.cooldownMs,
            completionSummaryDelayMs: this.completionSummaryDelayMs,
            completionSummaryQueued: this.completionSummaryQueue.length,
            cooldowns: Array.from(this.cooldowns.entries()).map(([key, lastAt]) => ({
                key,
                lastAt: new Date(lastAt).toISOString()
            })),
            recent: this.history.slice(0, 20)
        };
    }
}

module.exports = {
    FeishuNotificationService,
    formatDateTime
};
