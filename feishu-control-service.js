const axios = require('axios');

function truncateText(text, maxLength = 3800) {
    const safeText = String(text || '');
    if (safeText.length <= maxLength) {
        return safeText;
    }
    return `${safeText.slice(0, maxLength - 20)}\n...内容已截断`;
}

function phaseLabel(phase) {
    const map = {
        idle: '空闲',
        queued: '排队中',
        running: '运行中',
        stopping: '停止中',
        stopped: '已停止',
        interrupted: '已中断',
        completed: '已完成',
        error: '错误',
        processing_image: '处理参考图',
        extracting_prompts: '提取提示词',
        generating_in_legil: 'Legil 生成中'
    };
    return map[phase] || phase || '未知';
}

function taskTypeLabel(taskType) {
    const map = {
        'creative-batch': '创意拓展',
        'resize-batch': '批量改尺寸',
        'batch-generate': 'Legil 批量生成'
    };
    return map[taskType] || taskType || '无';
}

function resolveLegilDisplayProgress(legil = {}, creativeResume = {}, creativeProgress = {}) {
    const legilProgress = legil && legil.progress ? legil.progress : {};
    if (
        creativeProgress &&
        creativeProgress.progress &&
        creativeProgress.progress.taskType === 'creative-batch'
    ) {
        return creativeProgress.progress;
    }
    if (legilProgress && legilProgress.taskType === 'creative-batch') {
        return legilProgress;
    }
    if (
        creativeResume &&
        creativeResume.progress &&
        creativeResume.progress.taskType === 'creative-batch'
    ) {
        return creativeResume.progress;
    }
    return legilProgress || {};
}

function formatDateTime(value) {
    if (!value) {
        return '未知';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return String(value);
    }
    return date.toLocaleString('zh-CN', { hour12: false });
}

function normalizeApiBaseUrl(apiBaseUrl) {
    return String(apiBaseUrl || 'http://127.0.0.1:3066').replace(/\/+$/, '');
}

class FeishuControlService {
    constructor(options = {}) {
        this.apiBaseUrl = normalizeApiBaseUrl(options.apiBaseUrl);
        this.httpClient = options.httpClient || axios.create({
            timeout: options.timeoutMs || 15000
        });
    }

    async request(method, endpoint, data) {
        const response = await this.httpClient.request({
            method,
            url: `${this.apiBaseUrl}${endpoint}`,
            data,
            headers: {
                'Content-Type': 'application/json'
            }
        });
        return response.data;
    }

    async getJson(endpoint) {
        return await this.request('GET', endpoint);
    }

    async postJson(endpoint, data = {}) {
        return await this.request('POST', endpoint, data);
    }

    async safeGet(endpoint) {
        try {
            return { ok: true, data: await this.getJson(endpoint) };
        } catch (error) {
            return { ok: false, error };
        }
    }

    async collectPlatformState() {
        const [
            workflow,
            workflowResume,
            legil,
            creativeResume,
            creativeProgress,
            browser,
            agent,
            logs
        ] = await Promise.all([
            this.safeGet('/api/workflow/status'),
            this.safeGet('/api/workflow/resume-info'),
            this.safeGet('/api/legil/task-status'),
            this.safeGet('/api/legil/creative-resume'),
            this.safeGet('/api/legil/creative-progress'),
            this.safeGet('/api/browser-status'),
            this.safeGet('/api/creative-agent/status'),
            this.safeGet('/api/logs/recent?limit=12')
        ]);

        return {
            workflow: workflow.ok ? workflow.data : null,
            workflowError: workflow.ok ? null : workflow.error,
            workflowResume: workflowResume.ok ? workflowResume.data : null,
            legil: legil.ok ? legil.data : null,
            creativeResume: creativeResume.ok ? creativeResume.data : null,
            creativeProgress: creativeProgress.ok ? creativeProgress.data : null,
            browser: browser.ok ? browser.data : null,
            agent: agent.ok ? agent.data : null,
            logs: logs.ok ? logs.data : null
        };
    }

    async getStatusSummary() {
        const state = await this.collectPlatformState();
        const workflowStatus = state.workflow && state.workflow.status ? state.workflow.status : {};
        const workflowDetail = workflowStatus.currentStatus || {};
        const workflowStats = workflowStatus.stats || {};
        const workflowResume = state.workflowResume && state.workflowResume.resume ? state.workflowResume.resume : {};
        const legil = state.legil || {};
        const creativeResume = state.creativeResume && state.creativeResume.resume ? state.creativeResume.resume : {};
        const legilProgress = resolveLegilDisplayProgress(legil, creativeResume, state.creativeProgress);
        const displayTaskType = legil.taskType || legilProgress.taskType;
        const browserStatus = state.browser && state.browser.status ? state.browser.status : {};
        const agentStatus = state.agent && state.agent.status ? state.agent.status : {};

        const lines = [
            '**AI生图自动化平台状态**',
            `完整工作流：${workflowStatus.isRunning ? '运行中' : '未运行'}${workflowStatus.progress ? `，进度 ${workflowStatus.progress}%` : ''}`,
            `当前动作：${workflowDetail.currentAction || '暂无'}`,
            `图片进度：${workflowStats.processed || 0}/${workflowStatus.totalImages || 0}，失败 ${workflowStats.failed || 0}，已生成 ${workflowStats.totalGenerated || 0}`,
            `Legil任务：${legil.running ? '运行中' : '未运行'}${displayTaskType ? `（${taskTypeLabel(displayTaskType)}）` : ''}`,
            `Legil进度：${legilProgress.completed || 0}/${legilProgress.total || 0}，成功 ${legilProgress.success || 0}，失败 ${legilProgress.failed || 0}，已保存 ${legilProgress.saved || 0}`,
            `Legil动作：${legilProgress.currentAction || '暂无'}`,
            `完整工作流可继续：${workflowResume.hasResume ? `是，第 ${workflowResume.imageIndex}/${workflowResume.totalImages} 张，提示词 ${workflowResume.promptIndex}/${workflowResume.totalPrompts}` : '否'}`,
            `创意拓展可继续：${creativeResume.hasResume ? `是，剩余 ${creativeResume.remainingCount}/${creativeResume.total} 组` : '否'}`,
            `浏览器：${browserStatus.browserRunning ? '运行中' : '未启动'}，Legil页面：${browserStatus.pages && browserStatus.pages.legil ? '已打开' : '未打开'}`,
            `创意拓展Agent：${agentStatus.running ? '运行中' : '空闲'}`
        ];

        if (state.workflowError) {
            lines.push(`状态接口异常：${state.workflowError.message}`);
        }

        return truncateText(lines.join('\n'));
    }

    async getProgressSummary() {
        const state = await this.collectPlatformState();
        const workflowStatus = state.workflow && state.workflow.status ? state.workflow.status : {};
        const workflowDetail = workflowStatus.currentStatus || {};
        const workflowStats = workflowStatus.stats || {};
        const legil = state.legil || {};
        const creativeResume = state.creativeResume && state.creativeResume.resume ? state.creativeResume.resume : {};
        const legilProgress = resolveLegilDisplayProgress(legil, creativeResume, state.creativeProgress);
        const displayTaskType = legil.taskType || legilProgress.taskType;

        const lines = [
            '**当前工作进度**',
            `完整工作流：${workflowStatus.isRunning ? '运行中' : '未运行'}`,
            `完整工作流图片：${workflowStats.processed || 0}/${workflowStatus.totalImages || 0}`,
            `完整工作流失败：${workflowStats.failed || 0}`,
            `完整工作流已生成：${workflowStats.totalGenerated || 0}`,
            `完整工作流动作：${workflowDetail.currentAction || '暂无'}`,
            `Legil任务类型：${taskTypeLabel(displayTaskType)}`,
            `Legil阶段：${phaseLabel(legilProgress.phase)}`,
            `Legil提示词进度：${legilProgress.completed || 0}/${legilProgress.total || 0}`,
            `Legil成功/失败/保存：${legilProgress.success || 0}/${legilProgress.failed || 0}/${legilProgress.saved || 0}`,
            `Legil当前方向：${legilProgress.currentName || '暂无'}`,
            `Legil当前动作：${legilProgress.currentAction || '暂无'}`,
            `创意拓展恢复：${creativeResume.hasResume ? `剩余 ${creativeResume.remainingCount}/${creativeResume.total}，阶段 ${phaseLabel(creativeResume.phase)}` : '无可继续任务'}`,
            `最近更新：${formatDateTime(legilProgress.updatedAt || workflowDetail.updatedAt || creativeResume.updatedAt)}`
        ];

        return truncateText(lines.join('\n'));
    }

    async getBrowserSummary() {
        const browser = await this.getJson('/api/browser-status');
        const status = browser.status || {};
        const pages = status.pages || {};
        return [
            '**浏览器状态**',
            `浏览器：${status.browserRunning ? '运行中' : '未启动'}`,
            `豆包页面：${pages.doubao ? '已打开' : '未打开'}`,
            `Legil页面：${pages.legil ? '已打开' : '未打开'}`,
            `豆包 API：${status.doubaoApiConfigured ? '已配置' : '未配置'}`
        ].join('\n');
    }

    async getLogSummary(limit = 12) {
        const response = await this.getJson(`/api/logs/recent?limit=${encodeURIComponent(limit)}`);
        const logs = Array.isArray(response.logs) ? response.logs : [];
        if (!logs.length) {
            return '最近暂无日志。';
        }

        const lines = logs.map(item => {
            const time = item.timestamp ? new Date(item.timestamp).toLocaleTimeString('zh-CN', { hour12: false }) : '--:--:--';
            return `[${time}] [${item.type || 'info'}] ${item.message || ''}`;
        });
        return truncateText(['**最近日志**', ...lines].join('\n'));
    }

    async stopCreative() {
        const status = await this.getJson('/api/legil/task-status');
        if (!status.running || status.taskType !== 'creative-batch') {
            return {
                success: true,
                message: '当前没有正在运行的创意拓展任务'
            };
        }
        return await this.postJson('/api/legil/stop');
    }

    async stopWorkflow() {
        const workflow = await this.getJson('/api/workflow/status');
        const status = workflow.status || {};
        if (!status.isRunning) {
            return {
                success: true,
                message: '当前没有正在运行的完整工作流'
            };
        }
        return await this.postJson('/api/workflow/stop');
    }

    async stopAutomation() {
        const workflow = await this.getJson('/api/workflow/status');
        if (workflow.status && workflow.status.isRunning) {
            return await this.postJson('/api/workflow/stop');
        }

        const legil = await this.getJson('/api/legil/task-status');
        if (legil.running) {
            return await this.postJson('/api/legil/stop');
        }

        return {
            success: true,
            message: '当前没有正在运行的工作流或 Legil 任务'
        };
    }

    async continueWorkflow() {
        const legil = await this.getJson('/api/legil/task-status');
        if (legil.running || legil.workflowRunning) {
            return {
                success: false,
                message: '当前已有任务正在运行，不能继续完整工作流'
            };
        }
        return await this.postJson('/api/workflow/resume');
    }

    async continueCreative() {
        const legil = await this.getJson('/api/legil/task-status');
        if (legil.running || legil.workflowRunning) {
            return {
                success: false,
                message: '当前已有任务正在运行，不能继续创意拓展'
            };
        }

        const response = await this.getJson('/api/legil/creative-resume');
        const resume = response.resume || {};
        if (!resume.hasResume || !Array.isArray(resume.prompts)) {
            return {
                success: false,
                message: '没有可继续的创意拓展任务'
            };
        }

        const prompts = resume.prompts.filter(item => item && item.selected !== false);
        if (!prompts.length) {
            return {
                success: false,
                message: '创意拓展恢复状态里没有剩余提示词'
            };
        }

        return await this.postJson('/api/legil/creative-batch', {
            outputFolder: resume.outputFolder,
            referenceFolder: resume.referenceFolder || '',
            prompts,
            tableFileName: resume.tableFileName || '飞书继续创意拓展任务',
            browserMode: resume.browserMode,
            generationSettings: resume.generationSettings,
            resumeMode: true,
            resumeRunId: resume.runId
        });
    }

    async continueAutomation() {
        const workflowResume = await this.getJson('/api/workflow/resume-info');
        if (workflowResume.resume && workflowResume.resume.hasResume) {
            return await this.continueWorkflow();
        }

        const creativeResume = await this.getJson('/api/legil/creative-resume');
        if (creativeResume.resume && creativeResume.resume.hasResume) {
            return await this.continueCreative();
        }

        return {
            success: false,
            message: '没有可继续的任务'
        };
    }

    async startMassProduction() {
        const legil = await this.getJson('/api/legil/task-status');
        if (legil.running || legil.workflowRunning) {
            return {
                success: false,
                message: '当前已有任务正在运行，不能开始量产'
            };
        }

        return await this.postJson('/api/workflow/start', {
            browserMode: 'headless'
        });
    }

    async restartServer() {
        return await this.postJson('/api/server/restart', {
            reason: '飞书重启服务器按钮',
            delayMs: 3500
        });
    }

    async executeControlAction(action) {
        switch (String(action || '').trim()) {
            case 'status':
                return {
                    success: true,
                    message: await this.getStatusSummary()
                };
            case 'progress':
                return {
                    success: true,
                    message: await this.getProgressSummary()
                };
            case 'logs':
                return {
                    success: true,
                    message: await this.getLogSummary(8)
                };
            case 'browser_status':
                return {
                    success: true,
                    message: await this.getBrowserSummary()
                };
            case 'start_mass':
                return await this.startMassProduction();
            case 'continue_creative':
                return await this.continueCreative();
            case 'continue_workflow':
                return await this.continueAutomation();
            case 'stop_creative':
                return await this.stopCreative();
            case 'stop_workflow':
                return await this.stopAutomation();
            case 'restart_prompt':
                return {
                    success: true,
                    message: '重启工作流需要二次确认。请在飞书里发送“重启工作流”，再按机器人给出的确认码回复。'
                };
            case 'restart_server':
                return await this.restartServer();
            case 'panel':
                return {
                    success: true,
                    message: await this.getStatusSummary()
                };
            default:
                return {
                    success: false,
                    message: `未知卡片按钮动作：${action || '空'}`
                };
        }
    }

    async restartWorkflow() {
        const legil = await this.getJson('/api/legil/task-status');
        if (legil.running || legil.workflowRunning) {
            const stopResult = await this.stopAutomation();
            return {
                success: stopResult.success,
                message: `${stopResult.message || '已发送停止指令'}。当前任务停止完成后，再发送“重启工作流”即可重新启动。`
            };
        }

        await this.postJson('/api/workflow/clear-resume').catch(() => null);
        return await this.postJson('/api/workflow/start', {});
    }
}

module.exports = {
    FeishuControlService,
    truncateText,
    phaseLabel,
    taskTypeLabel
};
