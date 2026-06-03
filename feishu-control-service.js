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

function creativeAutoPhaseLabel(phase) {
    const map = {
        agent_running: 'Agent 生成中',
        agent_completed: 'Prompt Gate 已完成',
        agent_cancelled: 'Agent 已暂停',
        agent_failed: 'Agent 失败',
        prompt_gate_empty: 'Prompt Gate 无可用提示词',
        legil_pending: '等待启动 Legil',
        legil_starting: '正在启动 Legil',
        legil_queued: 'Legil 已排队',
        legil_running: 'Legil 生图中',
        legil_stopping: 'Legil 停止中',
        legil_paused: '已暂停，可继续',
        legil_completed: 'Legil 已完成',
        legil_failed: 'Legil 失败',
        legil_start_failed: 'Legil 启动失败',
        legil_resume_failed: 'Legil 恢复失败',
        legil_continue_failed: '继续 Legil 失败',
        legil_poll_timeout: 'Legil 轮询超时'
    };
    return map[phase] || phaseLabel(phase);
}

function runStatusLabel(status) {
    const map = {
        idle: '空闲',
        running: '运行中',
        paused: '已暂停',
        completed: '已完成',
        failed: '失败',
        stopped: '已停止',
        cancelled: '已取消'
    };
    return map[status] || status || '未知';
}

function modeLabel(mode, agentOnly) {
    if (agentOnly === true || mode === 'agent-only') return '只生成 Prompt';
    const map = {
        'legil-run-once': '小批量/自动生图',
        'agent-only-continued-legil': 'Prompt 续跑生图',
        'run-once': '运行一次'
    };
    return map[mode] || mode || '自动创意';
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

function numberOrZero(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
}

function shortId(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    if (text.length <= 18) return text;
    return `${text.slice(0, 12)}...${text.slice(-5)}`;
}

function firstLine(value, maxLength = 120) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function runDirectionLabel(run = {}) {
    const direction = run.sourceDirection || {};
    const aggregate = run.aggregateTarget || {};
    return String(
        direction.path ||
        direction.name ||
        aggregate.path ||
        run.directionPath ||
        ''
    ).trim();
}

function resolveCreativeAutoRun(creativeAuto = {}) {
    if (creativeAuto.activeRun) {
        return {
            run: creativeAuto.activeRun,
            source: 'active'
        };
    }
    if (creativeAuto.resumableRun) {
        return {
            run: creativeAuto.resumableRun,
            source: 'resumable'
        };
    }
    return {
        run: null,
        source: ''
    };
}

function promptGateSummary(run = {}) {
    const accepted = numberOrZero(run.promptTotal);
    const translated = numberOrZero(run.promptTotalTranslated);
    const candidate = numberOrZero(run.promptTotalCandidate);
    const raw = numberOrZero(run.promptTotalRaw);
    const rejected = numberOrZero(run.promptTotalRejected);
    const base = candidate || translated || raw || accepted;
    if (!base && !accepted && !rejected) {
        return '暂无';
    }
    return `通过 ${accepted}/${base || accepted}，淘汰 ${rejected}`;
}

function legilProgressSummary(progress = {}) {
    const total = numberOrZero(progress.total);
    const completed = numberOrZero(progress.completed);
    const success = numberOrZero(progress.success);
    const failed = numberOrZero(progress.failed);
    const saved = numberOrZero(progress.saved);
    if (!total && !completed && !success && !failed && !saved) {
        return '暂无';
    }
    return `${completed}/${total}，成功 ${success}，失败 ${failed}，保存 ${saved}`;
}

function unifiedRunSummary(unifiedState = {}) {
    const activeRun = unifiedState.activeRun || {};
    const legilQueue = unifiedState.legilQueue || {};
    const caps = unifiedState.capabilities || {};
    const counts = activeRun.counts || {};
    const controls = activeRun.controls || {};
    const lines = [
        `统一状态：${unifiedState.statusLabel || runStatusLabel(unifiedState.status)} / ${unifiedState.phaseLabel || phaseLabel(unifiedState.phase)}`,
        `当前 run：${activeRun.runId ? `${activeRun.runTypeLabel || activeRun.runType || '任务'} ${shortId(activeRun.runId)}` : '暂无'}`,
        `当前 Agent：${unifiedState.currentAgent || activeRun.agent || '暂无'}`,
        `统一进度：${Number.isFinite(Number(activeRun.progressPercent)) ? `${activeRun.progressPercent}%` : '暂无'}`,
        `当前动作：${firstLine((activeRun.current && activeRun.current.message) || legilQueue.currentAction || '暂无')}`,
        `Prompt/图片：通过 ${numberOrZero(counts.acceptedPrompts)}/${numberOrZero(counts.rawPrompts)}，保存 ${numberOrZero(counts.savedImages)} 张`,
        `Legil 队列：${legilQueue.status || 'idle'}，长度 ${numberOrZero(legilQueue.queueLength)}，进度 ${numberOrZero(legilQueue.completed)}/${numberOrZero(legilQueue.total)}`,
        `控制能力：暂停 ${caps.canPause || controls.canPause ? '可用' : '不可用'}，继续 ${caps.canResume || controls.canResume ? '可用' : '不可用'}`
    ];
    return lines;
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
            runState,
            workflow,
            workflowResume,
            legil,
            creativeResume,
            creativeProgress,
            creativeAuto,
            browser,
            agent,
            logs
        ] = await Promise.all([
            this.safeGet('/api/run-state/status'),
            this.safeGet('/api/workflow/status'),
            this.safeGet('/api/workflow/resume-info'),
            this.safeGet('/api/legil/task-status'),
            this.safeGet('/api/legil/creative-resume'),
            this.safeGet('/api/legil/creative-progress'),
            this.safeGet('/api/creative-auto/status'),
            this.safeGet('/api/browser-status'),
            this.safeGet('/api/creative-agent/status'),
            this.safeGet('/api/logs/recent?limit=12')
        ]);

        return {
            runState: runState.ok ? runState.data : null,
            runStateError: runState.ok ? null : runState.error,
            workflow: workflow.ok ? workflow.data : null,
            workflowError: workflow.ok ? null : workflow.error,
            workflowResume: workflowResume.ok ? workflowResume.data : null,
            legil: legil.ok ? legil.data : null,
            creativeResume: creativeResume.ok ? creativeResume.data : null,
            creativeProgress: creativeProgress.ok ? creativeProgress.data : null,
            creativeAuto: creativeAuto.ok ? creativeAuto.data : null,
            browser: browser.ok ? browser.data : null,
            agent: agent.ok ? agent.data : null,
            logs: logs.ok ? logs.data : null
        };
    }

    async getStatusSummary() {
        const state = await this.collectPlatformState();
        const unified = state.runState || {};
        const workflowStatus = state.workflow && state.workflow.status ? state.workflow.status : {};
        const workflowDetail = workflowStatus.currentStatus || {};
        const workflowStats = workflowStatus.stats || {};
        const workflowResume = state.workflowResume && state.workflowResume.resume ? state.workflowResume.resume : {};
        const legil = state.legil || {};
        const creativeResume = state.creativeResume && state.creativeResume.resume ? state.creativeResume.resume : {};
        const creativeAuto = state.creativeAuto || {};
        const autoRunInfo = resolveCreativeAutoRun(creativeAuto);
        const autoRun = autoRunInfo.run || {};
        const legilProgress = resolveLegilDisplayProgress(legil, creativeResume, state.creativeProgress);
        const displayTaskType = legil.taskType || legilProgress.taskType;
        const browserStatus = state.browser && state.browser.status ? state.browser.status : {};
        const agentStatus = state.agent && state.agent.status ? state.agent.status : {};
        const suggestion = creativeAuto.suggestion && creativeAuto.suggestion.next ? creativeAuto.suggestion.next : null;
        const suggestionDirection = suggestion && suggestion.direction ? suggestion.direction : {};
        const preflight = creativeAuto.preflight || {};
        const config = creativeAuto.config || {};
        const settings = config.generationSettings || {};
        const quota = creativeAuto.quota || {};
        const knowledge = creativeAuto.knowledge || {};

        const lines = [
            '**创意拓展控制台状态**',
            ...unifiedRunSummary(unified),
            '',
            `自动创意：${runStatusLabel(creativeAuto.status)}${autoRun.runId ? `，${autoRunInfo.source === 'active' ? '当前' : '可继续'} run ${shortId(autoRun.runId)}` : ''}`,
            `阶段：${autoRun.runId ? `${runStatusLabel(autoRun.status)} / ${creativeAutoPhaseLabel(autoRun.phase)}` : (preflight.ok === false ? '环境检查未通过' : '等待启动')}`,
            `模式：${modeLabel(autoRun.mode, autoRun.agentOnly)}`,
            `方向：${runDirectionLabel(autoRun) || (suggestionDirection.path || suggestionDirection.name || '暂无')}`,
            `Prompt Gate：${promptGateSummary(autoRun)}`,
            `预计图片：${numberOrZero(autoRun.expectedImageTotal) || '暂无'}；今日已记账：${numberOrZero(quota.usedImagesToday)} 张`,
            `Legil创意：${legil.running ? '运行中' : '未运行'}${displayTaskType ? `（${taskTypeLabel(displayTaskType)}）` : ''}，阶段 ${phaseLabel(legilProgress.phase)}`,
            `Legil进度：${legilProgressSummary(legilProgress)}`,
            `Legil当前：${legilProgress.currentName || '暂无'}`,
            `当前动作：${firstLine(autoRun.message || legilProgress.currentAction || workflowDetail.currentAction || '暂无')}`,
            `创意续跑：${creativeResume.hasResume ? `可继续，剩余 ${creativeResume.remainingCount}/${creativeResume.total} 组，阶段 ${phaseLabel(creativeResume.phase)}` : '无可继续任务'}`,
            `推荐方向：${suggestionDirection.path || suggestionDirection.name || '暂无'}${suggestion && Number.isFinite(Number(suggestion.score)) ? `，评分 ${suggestion.score}` : ''}`,
            `环境检查：${preflight.ok === false ? '未通过' : '通过'}；知识库：${knowledge.imported ? '已导入' : '未导入'}${knowledge.counts ? `，方向 ${knowledge.counts.directions || 0} 个，参考图 ${knowledge.counts.referenceImages || 0} 张` : ''}`,
            `生成参数：${settings.imageModel || '--'} / ${settings.aspectRatio || '--'} / ${settings.resolution || '--'} / ${settings.outputQuantity || 1} 张`,
            `浏览器：${browserStatus.browserRunning ? '运行中' : '未启动'}，Legil页面：${browserStatus.pages && browserStatus.pages.legil ? '已打开' : '未打开'}，Agent：${agentStatus.running ? '运行中' : '空闲'}`,
            `完整工作流：${workflowStatus.isRunning ? '运行中' : '未运行'}，可继续：${workflowResume.hasResume ? '是' : '否'}`
        ];

        if (state.workflowError) {
            lines.push(`状态接口异常：${state.workflowError.message}`);
        }
        if (state.runStateError) {
            lines.push(`统一状态接口异常：${state.runStateError.message}`);
        }

        return truncateText(lines.join('\n'));
    }

    async getProgressSummary() {
        const state = await this.collectPlatformState();
        const unified = state.runState || {};
        const workflowStatus = state.workflow && state.workflow.status ? state.workflow.status : {};
        const workflowDetail = workflowStatus.currentStatus || {};
        const workflowStats = workflowStatus.stats || {};
        const legil = state.legil || {};
        const creativeResume = state.creativeResume && state.creativeResume.resume ? state.creativeResume.resume : {};
        const creativeAuto = state.creativeAuto || {};
        const autoRunInfo = resolveCreativeAutoRun(creativeAuto);
        const autoRun = autoRunInfo.run || {};
        const legilProgress = resolveLegilDisplayProgress(legil, creativeResume, state.creativeProgress);
        const displayTaskType = legil.taskType || legilProgress.taskType;
        const agentTask = autoRun.agentTask || {};
        const quota = autoRun.quota || creativeAuto.quota || {};

        const lines = [
            '**创意拓展进度**',
            ...unifiedRunSummary(unified),
            '',
            `Run：${autoRun.runId ? `${shortId(autoRun.runId)}（${autoRunInfo.source === 'active' ? '当前运行' : '可继续'}）` : '暂无自动创意 run'}`,
            `自动创意阶段：${autoRun.runId ? `${runStatusLabel(autoRun.status)} / ${creativeAutoPhaseLabel(autoRun.phase)}` : runStatusLabel(creativeAuto.status)}`,
            `模式：${modeLabel(autoRun.mode, autoRun.agentOnly)}`,
            `方向：${runDirectionLabel(autoRun) || '暂无'}`,
            `Agent：${agentTask.phase || agentTask.status ? `${phaseLabel(agentTask.phase || agentTask.status)}${agentTask.currentAction ? `，${firstLine(agentTask.currentAction, 80)}` : ''}` : '暂无运行中的 Agent'}`,
            `Prompt Gate：${promptGateSummary(autoRun)}`,
            `生图额度：${quota.unlimitedImages || quota.unlimitedPrompts ? '不限额' : `预计 ${numberOrZero(quota.expectedImages)} 张`}；预计图片：${numberOrZero(autoRun.expectedImageTotal) || '暂无'}`,
            `Legil任务类型：${taskTypeLabel(displayTaskType)}`,
            `Legil阶段：${phaseLabel(legilProgress.phase)}`,
            `Legil提示词：${legilProgressSummary(legilProgress)}`,
            `Legil当前方向：${legilProgress.currentName || '暂无'}`,
            `Legil动作：${firstLine(legilProgress.currentAction || '暂无')}`,
            `创意续跑：${creativeResume.hasResume ? `剩余 ${creativeResume.remainingCount}/${creativeResume.total}，阶段 ${phaseLabel(creativeResume.phase)}` : '无可继续任务'}`,
            `完整工作流：${workflowStatus.isRunning ? '运行中' : '未运行'}，图片 ${workflowStats.processed || 0}/${workflowStatus.totalImages || 0}，失败 ${workflowStats.failed || 0}`,
            `完整工作流动作：${workflowDetail.currentAction || '暂无'}`,
            `最近更新：${formatDateTime(autoRun.updatedAt || legilProgress.updatedAt || workflowDetail.updatedAt || creativeResume.updatedAt)}`
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
            `提示词模型页面：无需打开网页`,
            `Legil页面：${pages.legil ? '已打开' : '未打开'}`,
            `Lumos Winky：${status.doubaoApiConfigured ? '已配置' : '未配置'}`
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
        const creativeAuto = await this.getJson('/api/creative-auto/status').catch(() => null);
        const activeRun = creativeAuto && creativeAuto.activeRun ? creativeAuto.activeRun : null;
        if (activeRun && activeRun.runId && activeRun.status === 'running') {
            const result = await this.postJson(`/api/creative-auto/runs/${encodeURIComponent(activeRun.runId)}/pause`, {
                source: 'feishu'
            });
            return {
                success: result.success !== false,
                message: result.message || '已暂停自动创意任务'
            };
        }

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

        const creativeAuto = await this.getJson('/api/creative-auto/status').catch(() => null);
        const autoRun = creativeAuto && creativeAuto.resumableRun ? creativeAuto.resumableRun : null;
        if (autoRun && autoRun.runId) {
            const result = await this.postJson(`/api/creative-auto/runs/${encodeURIComponent(autoRun.runId)}/resume`, {
                source: 'feishu'
            });
            return {
                success: result.success !== false,
                message: result.message || '已继续自动创意任务'
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

    formatCreativeAutoStartResult(result, fallback) {
        const run = result && result.run ? result.run : {};
        const direction = runDirectionLabel(run);
        const parts = [
            result && result.message ? result.message : fallback,
            run.runId ? `Run：${shortId(run.runId)}` : '',
            direction ? `方向：${direction}` : '',
            run.phase ? `阶段：${creativeAutoPhaseLabel(run.phase)}` : ''
        ].filter(Boolean);
        return parts.join('\n');
    }

    async startCreativePromptOnly() {
        const result = await this.postJson('/api/creative-auto/run-once', {
            agentOnly: true,
            unlimitedPrompts: true,
            source: 'feishu'
        });
        return {
            success: result.success !== false,
            message: this.formatCreativeAutoStartResult(result, '已启动只生成 Prompt')
        };
    }

    async startCreativeSmoke() {
        const result = await this.postJson('/api/creative-auto/run-once', {
            agentOnly: false,
            fullScale: false,
            maxPrompts: 1,
            source: 'feishu'
        });
        return {
            success: result.success !== false,
            message: this.formatCreativeAutoStartResult(result, '已启动小批量验证')
        };
    }

    async startCreativeFullScale() {
        const result = await this.postJson('/api/creative-auto/run-once', {
            agentOnly: false,
            fullScale: true,
            unlimitedPrompts: true,
            source: 'feishu'
        });
        return {
            success: result.success !== false,
            message: this.formatCreativeAutoStartResult(result, '已启动持续生图')
        };
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
            case 'start_creative_prompts':
                return await this.startCreativePromptOnly();
            case 'start_creative_smoke':
                return await this.startCreativeSmoke();
            case 'start_creative_full':
                return await this.startCreativeFullScale();
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
