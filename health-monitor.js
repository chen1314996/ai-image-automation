const logger = require('./logger');

const DEFAULT_INTERVAL_MS = 60 * 1000;
const DEFAULT_STALE_WARNING_MS = 15 * 60 * 1000;
const DEFAULT_STALE_ERROR_MS = 30 * 60 * 1000;

function toPositiveNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : fallback;
}

function taskTypeLabel(type) {
    switch (String(type || '')) {
        case 'workflow':
            return '量产工作流';
        case 'resize-batch':
            return '批量改尺寸';
        case 'creative-batch':
            return '创意拓展产图';
        case 'batch-generate':
            return 'Legil批量生成';
        case 'creative-agent':
            return '创意拓展Agent';
        default:
            return '自动化任务';
    }
}

function compactProgress(snapshot = {}) {
    const workflow = snapshot.workflow || {};
    const workflowStatus = workflow.status || {};
    const workflowStats = workflowStatus.stats || {};
    const legil = snapshot.legil || {};
    const legilProgress = legil.progress || {};

    if (workflowStatus.isRunning) {
        return `工作流图片 ${workflowStats.processed || 0}/${workflowStatus.totalImages || 0}，失败 ${workflowStats.failed || 0}，已生成 ${workflowStats.totalGenerated || 0}`;
    }
    if (legil.running) {
        return `Legil ${legilProgress.completed || legilProgress.currentIndex || 0}/${legilProgress.total || 0}，成功/失败/保存 ${legilProgress.success || 0}/${legilProgress.failed || 0}/${legilProgress.saved || 0}`;
    }
    return '';
}

function progressSignature(snapshot = {}) {
    const workflowStatus = snapshot.workflow && snapshot.workflow.status ? snapshot.workflow.status : {};
    const workflowStats = workflowStatus.stats || {};
    const workflowDetail = workflowStatus.currentStatus || {};
    const legil = snapshot.legil || {};
    const legilProgress = legil.progress || {};
    const creativeAgent = snapshot.creativeAgent || {};

    if (workflowStatus.isRunning) {
        return [
            'workflow',
            workflowStatus.currentIndex,
            workflowStats.processed,
            workflowStats.failed,
            workflowStats.totalGenerated,
            workflowDetail.currentPromptIndex
        ].join(':');
    }
    if (legil.running) {
        return [
            'legil',
            legil.taskType,
            legilProgress.completed || legilProgress.currentIndex || 0,
            legilProgress.success || 0,
            legilProgress.failed || 0,
            legilProgress.saved || 0
        ].join(':');
    }
    if (creativeAgent.running) {
        return ['creative-agent', creativeAgent.runningCount || 1].join(':');
    }
    return 'idle';
}

function runningTaskType(snapshot = {}) {
    const workflowStatus = snapshot.workflow && snapshot.workflow.status ? snapshot.workflow.status : {};
    const legil = snapshot.legil || {};
    const creativeAgent = snapshot.creativeAgent || {};
    if (workflowStatus.isRunning) return 'workflow';
    if (legil.running) return legil.taskType || 'legil';
    if (creativeAgent.running) return 'creative-agent';
    return '';
}

class HealthMonitor {
    constructor(options = {}) {
        this.snapshotProvider = options.snapshotProvider;
        this.notifier = options.notifier;
        this.shouldNotifyStale = typeof options.shouldNotifyStale === 'function' ? options.shouldNotifyStale : () => true;
        this.intervalMs = toPositiveNumber(options.intervalMs, DEFAULT_INTERVAL_MS);
        this.staleWarningMs = toPositiveNumber(options.staleWarningMs, DEFAULT_STALE_WARNING_MS);
        this.staleErrorMs = toPositiveNumber(options.staleErrorMs, DEFAULT_STALE_ERROR_MS);
        this.timer = null;
        this.lastSignature = '';
        this.lastProgressAt = Date.now();
        this.lastFeishuReady = null;
        this.staleAlertedKey = '';
        this.startedAt = null;
    }

    configure(options = {}) {
        if (Number(options.intervalMs) > 0) {
            this.intervalMs = toPositiveNumber(options.intervalMs, this.intervalMs);
        }
        if (Number(options.staleWarningMs) > 0) {
            this.staleWarningMs = toPositiveNumber(options.staleWarningMs, this.staleWarningMs);
        }
        if (Number(options.staleErrorMs) > 0) {
            this.staleErrorMs = toPositiveNumber(options.staleErrorMs, this.staleErrorMs);
        }
        if (typeof options.shouldNotifyStale === 'function') {
            this.shouldNotifyStale = options.shouldNotifyStale;
        }
    }

    start() {
        if (this.timer) return;
        this.startedAt = new Date().toISOString();
        this.lastProgressAt = Date.now();
        this.timer = setInterval(() => {
            this.check().catch(error => {
                logger.warn('健康监控检查失败: ' + error.message);
            });
        }, this.intervalMs);
        this.timer.unref();
    }

    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    async check() {
        if (typeof this.snapshotProvider !== 'function') return null;
        const snapshot = await this.snapshotProvider();
        const now = Date.now();
        const signature = progressSignature(snapshot);
        const taskType = runningTaskType(snapshot);
        const isRunning = Boolean(taskType);

        if (signature !== this.lastSignature) {
            this.lastSignature = signature;
            this.lastProgressAt = now;
            this.staleAlertedKey = '';
        } else if (isRunning && this.shouldNotifyStale()) {
            const idleMs = now - this.lastProgressAt;
            const staleKey = `${taskType}:${signature}`;
            if (idleMs >= this.staleErrorMs && this.staleAlertedKey !== staleKey) {
                this.staleAlertedKey = staleKey;
                this.notifier.notifySoon({
                    level: 'error',
                    title: '任务可能卡住',
                    taskType: taskTypeLabel(taskType),
                    progress: compactProgress(snapshot),
                    message: `已 ${Math.round(idleMs / 60000)} 分钟无进度变化`,
                    suggestion: '已进入静默观察，后续不会重复提醒；可发送“进度”查看详情，必要时发送“停止全部”或“继续任务”。'
                }, {
                    key: `stale:once:${staleKey}`,
                    cooldownMs: 0
                });
            }
        } else {
            this.lastProgressAt = now;
            this.staleAlertedKey = '';
        }

        const feishu = snapshot.feishu || {};
        const feishuReady = Boolean(feishu.ready && feishu.cardActionReady);
        if (this.lastFeishuReady === null) {
            this.lastFeishuReady = feishuReady;
        } else if (this.lastFeishuReady !== feishuReady) {
            this.lastFeishuReady = feishuReady;
            if (feishuReady) {
                return snapshot;
            }
            this.notifier.notifySoon({
                level: 'warning',
                title: '飞书长连接异常',
                message: '卡片按钮可能不可用，系统会自动降级为文字指令。',
                extraLines: [
                    `模式：${feishu.consumerMode || 'unknown'}`,
                    `错误：${feishu.lastError || '无'}`
                ]
            }, {
                key: `feishu-ready:${feishuReady}`,
                cooldownMs: 60 * 1000
            });
        }

        return snapshot;
    }

    notifyStartup(snapshot = {}) {
        const feishu = snapshot.feishu || {};
        const workflowResume = snapshot.workflowResume && snapshot.workflowResume.resume ? snapshot.workflowResume.resume : {};
        const creativeResume = snapshot.creativeResume && snapshot.creativeResume.resume ? snapshot.creativeResume.resume : {};
        const hasResume = Boolean(workflowResume.hasResume || creativeResume.hasResume);
        const feishuIssue = !(feishu.ready && feishu.cardActionReady);
        if (!hasResume && !feishuIssue) {
            return;
        }
        const extraLines = [
            `飞书连接：${feishu.ready ? '正常' : '未就绪'}，按钮：${feishu.cardActionReady ? '可用' : '不可用'}`,
            `完整工作流可继续：${workflowResume.hasResume ? '是' : '否'}`,
            `创意拓展可继续：${creativeResume.hasResume ? '是' : '否'}`
        ];

        this.notifier.notifySoon({
            level: feishuIssue ? 'warning' : 'info',
            title: hasResume ? '服务器已启动，有可继续任务' : '服务器已启动，飞书未就绪',
            message: hasResume ? '发现可继续任务。' : '服务已启动，但飞书连接未完全就绪。',
            suggestion: hasResume ? '可发送“继续任务”。' : '可发送“状态”确认连接情况。',
            extraLines
        }, {
            key: `server-start:${Date.now()}`,
            cooldownMs: 0
        });
    }

    getStatus() {
        return {
            running: Boolean(this.timer),
            startedAt: this.startedAt,
            intervalMs: this.intervalMs,
            staleWarningMs: this.staleWarningMs,
            staleErrorMs: this.staleErrorMs,
            lastSignature: this.lastSignature,
            staleAlertedKey: this.staleAlertedKey,
            lastProgressAt: new Date(this.lastProgressAt).toISOString(),
            lastFeishuReady: this.lastFeishuReady
        };
    }
}

module.exports = {
    HealthMonitor,
    taskTypeLabel,
    compactProgress
};
