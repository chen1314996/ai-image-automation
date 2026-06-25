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

function formatShortTime(value) {
    if (!value) {
        return '未知';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return String(value);
    }
    return date.toLocaleTimeString('zh-CN', { hour12: false });
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

    panelResult(panel, message) {
        const panelTitleMap = {
            main: 'AI图片生产远程控制台',
            production: '生产面板',
            delivery: '交付面板',
            system: '系统面板',
            material: '素材面板',
            knowledge: '知识库面板'
        };
        return {
            success: true,
            message: message || '已打开分面板。',
            cardOptions: {
                panel,
                title: panelTitleMap[panel] || 'AI生图控制面板'
            }
        };
    }

    async getStatusSummary() {
        const state = await this.collectPlatformState();
        const unified = state.runState || {};
        const workflowStatus = state.workflow && state.workflow.status ? state.workflow.status : {};
        const workflowResume = state.workflowResume && state.workflowResume.resume ? state.workflowResume.resume : {};
        const legil = state.legil || {};
        const creativeResume = state.creativeResume && state.creativeResume.resume ? state.creativeResume.resume : {};
        const creativeAuto = state.creativeAuto || {};
        const autoRunInfo = resolveCreativeAutoRun(creativeAuto);
        const autoRun = autoRunInfo.run || {};
        const legilProgress = resolveLegilDisplayProgress(legil, creativeResume, state.creativeProgress);
        const displayTaskType = legil.taskType || legilProgress.taskType;
        const browserStatus = state.browser && state.browser.status ? state.browser.status : {};
        const activeRun = unified.activeRun || {};
        const queue = autoRun.targetQueueProgress || autoRun.targetQueue || activeRun.targetQueue || {};
        const runStatus = unified.statusLabel || runStatusLabel(unified.status || creativeAuto.status || (workflowStatus.isRunning ? 'running' : 'idle'));
        const runPhase = unified.phaseLabel || (autoRun.runId ? creativeAutoPhaseLabel(autoRun.phase) : phaseLabel(legilProgress.phase || unified.phase));
        const taskName = activeRun.runTypeLabel || (displayTaskType ? taskTypeLabel(displayTaskType) : '') || (workflowStatus.isRunning ? '批量产图' : '无');
        const direction = runDirectionLabel(autoRun) || queue.currentTargetName || queue.targetName || activeRun.currentName || legilProgress.currentName || '';
        const queueCurrent = numberOrZero(queue.currentIndex || queue.index);
        const queueTotal = numberOrZero(queue.totalTargets || queue.total);
        const legilTotal = numberOrZero(legilProgress.total);
        const legilCompleted = numberOrZero(legilProgress.completed);
        const saved = numberOrZero(legilProgress.saved || (activeRun.counts && activeRun.counts.savedImages));
        const failed = numberOrZero(legilProgress.failed || (activeRun.counts && activeRun.counts.failedPrompts));
        const canResume = Boolean((unified.capabilities && unified.capabilities.canResume) ||
            creativeResume.hasResume ||
            workflowResume.hasResume ||
            (autoRunInfo.source === 'resumable' && autoRun.runId));
        const browserLine = `${browserStatus.browserRunning ? '运行中' : '未启动'}，Legil ${browserStatus.pages && browserStatus.pages.legil ? '已打开' : '未打开'}`;
        let advice = '新任务请在网页端确认参数';
        if (String(unified.status || '').includes('running') || legil.running || workflowStatus.isRunning) {
            advice = failed > 0 ? '有失败项；先看日志，必要时暂停' : '继续等待；异常时看日志';
        } else if (canResume) {
            advice = '确认页面正常后继续任务';
        } else if (['failed', 'error'].includes(String(unified.status || '').toLowerCase())) {
            advice = '先看日志，必要时停止全部';
        }

        const lines = [
            '**运行状态**',
            `状态：${runStatus}`,
            `阶段：${runPhase}`,
            `任务：${taskName}`,
            direction ? `方向：${firstLine(direction, 42)}` : '',
            queueTotal ? `队列：${queueCurrent}/${queueTotal}` : '',
            legilTotal || saved || failed ? `生图：${legilCompleted}/${legilTotal || 0}，保存 ${saved}，失败 ${failed}` : '',
            `浏览器：${browserLine}`,
            `建议：${advice}`
        ].filter(Boolean);

        if (state.workflowError) {
            lines.push(`接口异常：${state.workflowError.message}`);
        }
        if (state.runStateError) {
            lines.push(`状态异常：${state.runStateError.message}`);
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
        const activeRun = unified.activeRun || {};
        const queue = autoRun.targetQueueProgress || autoRun.targetQueue || activeRun.targetQueue || {};
        const queueCurrent = numberOrZero(queue.currentIndex || queue.index);
        const queueTotal = numberOrZero(queue.totalTargets || queue.total);
        const legilTotal = numberOrZero(legilProgress.total);
        const legilCompleted = numberOrZero(legilProgress.completed);
        const saved = numberOrZero(legilProgress.saved || (activeRun.counts && activeRun.counts.savedImages));
        const outputTotal = numberOrZero(legilProgress.outputTotal || autoRun.expectedImageTotal);
        const failed = numberOrZero(legilProgress.failed || (activeRun.counts && activeRun.counts.failedPrompts));
        const currentName = legilProgress.currentName || queue.currentTargetName || queue.targetName || runDirectionLabel(autoRun) || '';
        const currentAction = legilProgress.currentAction || (activeRun.current && activeRun.current.message) || workflowDetail.currentAction || '';
        const taskName = (displayTaskType ? taskTypeLabel(displayTaskType) : '') || activeRun.runTypeLabel || (workflowStatus.isRunning ? '批量产图' : '无');
        const lines = [
            '**当前进度**',
            `任务：${taskName}`,
            queueTotal ? `目标：${queueCurrent}/${queueTotal}` : '',
            currentName ? `当前：${firstLine(currentName, 42)}` : '',
            legilTotal || legilCompleted ? `Legil：${legilCompleted}/${legilTotal}` : '',
            saved || outputTotal ? `保存：${saved}/${outputTotal || saved}` : '',
            `失败：${failed}`,
            currentAction ? `动作：${firstLine(currentAction, 54)}` : '',
            workflowStatus.isRunning && !legilTotal ? `参考图：${workflowStats.processed || 0}/${workflowStatus.totalImages || 0}` : '',
            `更新：${formatShortTime(autoRun.updatedAt || legilProgress.updatedAt || workflowDetail.updatedAt || creativeResume.updatedAt || unified.updatedAt)}`
        ].filter(Boolean);

        return truncateText(lines.join('\n'));
    }

    async getSystemSummary() {
        const [health, feishu, browser] = await Promise.all([
            this.safeGet('/api/health'),
            this.safeGet('/api/feishu-cli/status'),
            this.safeGet('/api/browser-status')
        ]);
        const bridge = feishu.ok && feishu.data && feishu.data.bridge ? feishu.data.bridge : {};
        const browserStatus = browser.ok && browser.data ? browser.data.status || {} : {};
        const pages = browserStatus.pages || {};
        const lastError = bridge.lastError || (health.ok ? '' : health.error && health.error.message) || '';
        const lines = [
            '**系统状态**',
            `服务：${health.ok ? '运行中' : '异常'}`,
            `飞书桥接：${bridge.ready ? '已连接' : '异常'}`,
            `卡片按钮：${bridge.cardActionReady ? '可用' : '不可用'}`,
            `浏览器：${browserStatus.browserRunning ? '运行中' : '未启动'}`,
            `Legil页面：${pages.legil ? '已打开' : '未打开'}`,
            `最近错误：${lastError ? firstLine(lastError, 80) : '无'}`,
            `建议：${bridge.ready && bridge.cardActionReady ? '无需处理' : '先重发控制面板；仍异常再重启服务器'}`
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

    async stopAll() {
        return await this.postJson('/api/run-state/stop-all', {
            source: 'feishu'
        });
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
        const legil = await this.getJson('/api/legil/task-status');
        if (legil.running || legil.workflowRunning) {
            return {
                success: false,
                message: '当前已有任务正在运行，不能继续任务'
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

        const creativeResume = await this.getJson('/api/legil/creative-resume');
        if (creativeResume.resume && creativeResume.resume.hasResume) {
            return await this.continueCreative();
        }

        const workflowResume = await this.getJson('/api/workflow/resume-info');
        if (workflowResume.resume && workflowResume.resume.hasResume) {
            return await this.continueWorkflow();
        }

        return {
            success: false,
            message: '没有可继续的任务'
        };
    }

    async retryFailedPrompts() {
        const creativeAuto = await this.getJson('/api/creative-auto/status');
        const run = creativeAuto.activeRun || creativeAuto.resumableRun || null;
        if (!run || !run.runId) {
            return {
                success: false,
                message: '当前没有可重试的自动创意 run'
            };
        }
        return await this.postJson(`/api/creative-auto/runs/${encodeURIComponent(run.runId)}/retry-failed-prompts`, {
            source: 'feishu'
        });
    }

    async getDeliveryStatusSummary() {
        const response = await this.getJson('/api/delivery/status');
        const run = response.run || {};
        const task = response.task || {};
        const progress = task.progress || {};
        if (!response.hasRun) {
            return '暂无三尺寸交付 run。可先在网页端配置输入目录后执行“扫描OK图”。';
        }
        return [
            '**三尺寸交付状态**',
            `Run：${run.runId || '未知'}`,
            `任务：${task.running ? '运行中' : '未运行'}${task.stopRequested ? '，停止中' : ''}`,
            `总 job：${run.totalJobs || 0}`,
            `状态：${run.status || '未知'}`,
            `进度：${progress.completed || 0}/${progress.total || 0}，成功 ${progress.success || 0}，失败 ${progress.failed || 0}，保存 ${progress.saved || 0}`,
            `当前：${firstLine(progress.currentAction || '暂无')}`
        ].join('\n');
    }

    async getLatestDeliveryRunId() {
        const response = await this.getJson('/api/delivery/status');
        const runId = response && response.run && response.run.runId ? String(response.run.runId) : '';
        if (!runId) {
            throw new Error('暂无三尺寸交付 run，请先扫描 OK 图。');
        }
        return runId;
    }

    async deliveryScan() {
        return await this.postJson('/api/delivery/scan', {});
    }

    async deliveryStart() {
        return await this.postJson('/api/delivery/start', {});
    }

    async deliveryResume() {
        return await this.postJson('/api/delivery/resume', {});
    }

    async deliveryStop() {
        return await this.postJson('/api/delivery/stop', {});
    }

    async deliveryStandardize() {
        const runId = await this.getLatestDeliveryRunId();
        return await this.postJson(`/api/delivery/runs/${encodeURIComponent(runId)}/standardize`, {});
    }

    async deliveryFinalize() {
        const runId = await this.getLatestDeliveryRunId();
        return await this.postJson(`/api/delivery/runs/${encodeURIComponent(runId)}/finalize`, {});
    }

    async getMaterialStatusSummary() {
        const imports = await this.getJson('/api/material-analysis/imports');
        const runs = Array.isArray(imports.runs) ? imports.runs : (Array.isArray(imports.imports) ? imports.imports : []);
        const latest = runs[0] || {};
        if (!runs.length) {
            return '暂无素材分析导入记录。';
        }
        return [
            '**素材分析状态**',
            `最近导入：${latest.runId || latest.importId || '未知'}`,
            `文件：${latest.fileName || latest.sourceFileName || '未知'}`,
            `状态：${latest.status || '未知'}`,
            `素材数：${latest.totalMaterials || latest.materialCount || 0}`,
            `更新时间：${formatDateTime(latest.updatedAt || latest.createdAt)}`
        ].join('\n');
    }

    async getLatestMaterialRunId() {
        const imports = await this.getJson('/api/material-analysis/imports');
        const runs = Array.isArray(imports.runs) ? imports.runs : (Array.isArray(imports.imports) ? imports.imports : []);
        const latest = runs[0] || {};
        const runId = latest.runId || latest.importId || '';
        if (!runId) {
            throw new Error('暂无素材分析导入记录。');
        }
        return runId;
    }

    async materialWeeklyReport() {
        const runId = await this.getLatestMaterialRunId();
        return await this.postJson(`/api/material-analysis/imports/${encodeURIComponent(runId)}/reports/generate`, {
            source: 'feishu'
        });
    }

    async materialCreativePlan() {
        const runId = await this.getLatestMaterialRunId();
        return await this.postJson(`/api/material-analysis/imports/${encodeURIComponent(runId)}/creative-plan`, {
            source: 'feishu'
        });
    }

    async getTaskWorkbookSummary() {
        const response = await this.getJson('/api/task-workbooks/imports');
        const imports = Array.isArray(response.imports) ? response.imports : [];
        const latest = imports[0] || {};
        if (!imports.length) {
            return '暂无自动化任务表导入记录。';
        }
        const importId = latest.importId || latest.id || '';
        let vision = null;
        if (importId) {
            vision = await this.safeGet(`/api/task-workbooks/imports/${encodeURIComponent(importId)}/vision/status`);
        }
        const visionData = vision && vision.ok ? vision.data || {} : {};
        return [
            '**任务表状态**',
            `最近导入：${importId || '未知'}`,
            `文件：${latest.fileName || latest.sourceFileName || '未知'}`,
            `方向数：${latest.directionCount || latest.totalDirections || 0}`,
            `视觉整理：${visionData.status || '未知'}，${visionData.completed || 0}/${visionData.total || 0}`
        ].join('\n');
    }

    async getKnowledgeSummary() {
        const overview = await this.safeGet('/api/creative-knowledge/overview');
        const status = overview.ok ? overview.data : await this.getJson('/api/creative-knowledge/status');
        const counts = status.counts || status.summary || {};
        return [
            '**创意知识库状态**',
            `方向：${counts.directions || counts.directionCount || 0}`,
            `参考图：${counts.referenceImages || counts.referenceImageCount || 0}`,
            `资产：${counts.assets || counts.assetCount || 0}`,
            `反馈：${counts.feedback || counts.feedbackCount || 0}`,
            `Run：${counts.runs || counts.runCount || 0}`
        ].join('\n');
    }

    async getFeishuSyncSummary() {
        const sync = await this.safeGet('/api/creative-knowledge/feishu-sync/status');
        const direction = await this.safeGet('/api/creative-knowledge/feishu-direction/status');
        const syncData = sync.ok ? sync.data : {};
        const directionData = direction.ok ? direction.data : {};
        return [
            '**飞书同步状态**',
            `知识库同步：${syncData.configured === false ? '未配置' : '可检查'}，最近操作 ${formatDateTime(syncData.lastOperation && syncData.lastOperation.createdAt)}`,
            `方向表同步：${directionData.configured === false ? '未配置' : '可检查'}，最近操作 ${formatDateTime(directionData.lastOperation && directionData.lastOperation.createdAt)}`
        ].join('\n');
    }

    async feishuSyncImport() {
        return await this.postJson('/api/creative-knowledge/feishu-sync/sync', {
            source: 'feishu'
        });
    }

    async feishuDirectionImport() {
        return await this.postJson('/api/creative-knowledge/feishu-direction/sync-import', {
            source: 'feishu'
        });
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
            case 'run_center':
            case 'production_status':
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
            case 'retry_failed_prompts':
                return await this.retryFailedPrompts();
            case 'continue_creative':
                return await this.continueCreative();
            case 'continue_workflow':
                return await this.continueAutomation();
            case 'stop_creative':
                return await this.stopCreative();
            case 'stop_workflow':
                return await this.stopAutomation();
            case 'stop_all':
                return await this.stopAll();
            case 'mute_stale_1h':
                return {
                    success: true,
                    message: '卡住提醒已改为一次性提醒；同一任务后续会静默，进度恢复或任务切换后自动重置。'
                };
            case 'panel':
            case 'panel_main':
                return this.panelResult('main', await this.getStatusSummary());
            case 'panel_production':
                return this.panelResult('production', '生产面板已打开。');
            case 'panel_delivery':
                return this.panelResult('delivery', await this.getDeliveryStatusSummary());
            case 'panel_system':
                return this.panelResult('system', await this.getSystemSummary());
            case 'panel_material':
                return this.panelResult('material', await this.getMaterialStatusSummary());
            case 'panel_knowledge':
                return this.panelResult('knowledge', await this.getKnowledgeSummary());
            case 'delivery_status':
                return {
                    success: true,
                    message: await this.getDeliveryStatusSummary()
                };
            case 'delivery_scan':
                return await this.deliveryScan();
            case 'delivery_start':
                return await this.deliveryStart();
            case 'delivery_resume':
                return await this.deliveryResume();
            case 'delivery_stop':
                return await this.deliveryStop();
            case 'delivery_standardize':
                return await this.deliveryStandardize();
            case 'delivery_finalize':
                return await this.deliveryFinalize();
            case 'material_status':
                return {
                    success: true,
                    message: await this.getMaterialStatusSummary()
                };
            case 'task_workbook_status':
                return {
                    success: true,
                    message: await this.getTaskWorkbookSummary()
                };
            case 'material_weekly_report':
                return await this.materialWeeklyReport();
            case 'material_creative_plan':
                return await this.materialCreativePlan();
            case 'knowledge_status':
                return {
                    success: true,
                    message: await this.getKnowledgeSummary()
                };
            case 'feishu_sync_status':
            case 'feishu_direction_status':
                return {
                    success: true,
                    message: await this.getFeishuSyncSummary()
                };
            case 'feishu_sync_import':
                return await this.feishuSyncImport();
            case 'feishu_direction_import':
                return await this.feishuDirectionImport();
            case 'restart_prompt':
                return {
                    success: true,
                    message: '重启工作流需要二次确认。请在飞书里发送“重启工作流”，再按机器人给出的确认码回复。'
                };
            case 'restart_server':
                return await this.restartServer();
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
