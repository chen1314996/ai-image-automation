// 统一运行中心：消费轻量状态摘要，展示核心任务。
document.documentElement.dataset.runCenterScript = 'loaded';
let runCenterLastStatus = null;
let runCenterPoller = null;

function runCenterSetText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

function runCenterSetTitle(id, title) {
    const el = document.getElementById(id);
    if (!el) return;
    if (title) {
        el.title = title;
    } else {
        el.removeAttribute('title');
    }
}

function runCenterFormatDate(value) {
    if (!value) return '--';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString('zh-CN', { hour12: false });
}

function runCenterShortText(value, maxLength = 44) {
    const text = String(value || '').trim();
    if (!text) return '--';
    return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function runCenterStatusClass(status) {
    const value = String(status || '').toLowerCase();
    if (value === 'running') return 'is-running';
    if (value === 'paused') return 'is-paused';
    if (value === 'completed') return 'is-completed';
    if (value === 'failed') return 'is-failed';
    return 'is-idle';
}

function runCenterStatusLabel(status) {
    const value = String(status || '').toLowerCase();
    const labels = {
        idle: '空闲',
        running: '运行中',
        paused: '已暂停',
        completed: '已完成',
        failed: '异常',
        stopped: '已停止',
        queued: '排队中'
    };
    return labels[value] || status || '--';
}

function runCenterIsPausedRun(run = {}) {
    return String(run.status || '').toLowerCase() === 'paused' ||
        String(run.phase || '').toLowerCase() === 'paused' ||
        String(run.phase || '').toLowerCase() === 'legil_paused';
}

function runCenterIsStaleRunningText(value) {
    const text = String(value || '').trim();
    if (!text) return false;
    if (/已暂停|暂停|已停止|停止|失败|完成|未完成|可继续|继续之前任务/.test(text)) return false;
    return /正在生成|正在处理|运行中|生成第\s*\d+|等待.*开始|排队中|running|queued/i.test(text);
}

function runCenterPickDisplayText(...values) {
    for (const value of values) {
        const text = String(value || '').trim();
        if (text && !runCenterIsStaleRunningText(text)) return text;
    }
    return '';
}

function runCenterNormalizeLegilProgress(run = {}) {
    const progress = run.legilProgress && typeof run.legilProgress === 'object'
        ? { ...run.legilProgress }
        : null;
    if (!progress) return null;
    if (runCenterIsPausedRun(run) && String(progress.phase || '').toLowerCase() === 'running') {
        progress.phase = 'stopped';
        progress.currentAction = runCenterPickDisplayText(
            run.message,
            progress.currentAction,
            run.legilResult && run.legilResult.message
        ) || '任务已暂停，可继续之前任务';
    }
    return progress;
}

function runCenterDisplayMessage(run = {}, legil = null) {
    const current = run.current || {};
    if (runCenterIsPausedRun(run)) {
        return runCenterPickDisplayText(
            current.message,
            run.message,
            run.currentAction,
            legil && legil.currentAction,
            run.legilResult && run.legilResult.message
        ) || '任务已暂停，可继续之前任务';
    }
    return current.message || run.message || run.currentAction || (legil && legil.currentAction) || '';
}

function runCenterModuleLabel(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    return text
        .replace(/\bAgent\b/g, '执行模块')
        .replace(/legacy-workflow/g, '批量产图')
        .replace(/creative-auto/g, '创意拓展');
}

function runCenterSetPill(id, text, status) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text || '--';
    el.className = `run-center-pill ${runCenterStatusClass(status)}`;
}

function runCenterSetControl(id, label, enabled) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = `${label}${enabled ? '可用' : '不可用'}`;
    el.classList.toggle('is-enabled', Boolean(enabled));
}

function runCenterSourceLabel(source = {}) {
    const typeMap = {
        folder: '参考图文件夹',
        direction: '方向知识库',
        'material-brief': '素材 brief',
        'task-workbook': '自动化任务表',
        manual: '手动任务'
    };
    const type = typeMap[source.type] || source.type || '未知';
    const detail = source.directionPath || source.currentImageName || source.inputFolder || '';
    return detail ? `${type} / ${detail}` : type;
}

function renderRunCenterFlowList(runs = []) {
    const list = document.getElementById('runCenterFlowList');
    if (!list) return;
    list.innerHTML = '';

    const flowTypes = [
        { key: 'legacy-workflow', label: '批量产图' },
        { key: 'creative-auto', label: '创意拓展' }
    ];

    flowTypes.forEach(flow => {
        const run = runs.find(item => item && item.runType === flow.key) || null;
        const item = document.createElement('div');
        item.className = `run-center-flow-item ${runCenterStatusClass(run && run.status)}`;

        const head = document.createElement('div');
        head.className = 'run-center-flow-head';

        const title = document.createElement('strong');
        title.textContent = flow.label;
        const status = document.createElement('span');
        status.className = `run-center-pill ${runCenterStatusClass(run && run.status)}`;
        status.textContent = run ? `${runCenterStatusLabel(run.status || 'idle')} / ${run.phaseLabel || run.phase || '--'}` : '未运行';
        head.appendChild(title);
        head.appendChild(status);

        const body = document.createElement('div');
        body.className = 'run-center-flow-body';
        body.textContent = run
            ? `${runCenterModuleLabel(run.agent) || '暂无执行模块'} · ${runCenterShortText(run.current && run.current.message, 120)}`
            : '等待启动。';

        item.appendChild(head);
        item.appendChild(body);
        list.appendChild(item);
    });
}

function runCenterNeedsCreativeAutoDetails(data = {}) {
    const run = data.activeRun || null;
    if (!run || run.runType !== 'creative-auto') return false;
    return !run.targetQueueProgress || !run.legilProgress;
}

async function enrichRunCenterCreativeAutoStatus(data = {}) {
    if (!runCenterNeedsCreativeAutoDetails(data)) return data;
    try {
        const creativeStatus = window.ApiClient && typeof window.ApiClient.fetchJson === 'function'
            ? await window.ApiClient.fetchJson('/api/creative-auto/status', {
                timeoutMs: 12000,
                fallbackMessage: '读取创意拓展完整进度失败',
                toastOnError: false
            })
            : await (async () => {
                const res = await fetch('/api/creative-auto/status');
                const payload = await readRunCenterJson(res, '读取创意拓展完整进度失败');
                if (!res.ok || payload.success === false) {
                    throw new Error(payload.message || `读取创意拓展完整进度失败（HTTP ${res.status}）`);
                }
                return payload;
            })();
        const baseRun = data.activeRun || {};
        const fullRun = creativeStatus && creativeStatus.activeRun &&
            creativeStatus.activeRun.runId === baseRun.runId
            ? creativeStatus.activeRun
            : null;
        const topQueue = creativeStatus && creativeStatus.targetQueue ? creativeStatus.targetQueue : null;
        if (!fullRun && !topQueue && !data.legilQueue) return data;

        const mergedRun = {
            ...baseRun,
            targetQueue: (fullRun && fullRun.targetQueue) || topQueue || baseRun.targetQueue || null,
            targetQueueProgress: (fullRun && (fullRun.targetQueueProgress || fullRun.targetQueue)) || topQueue || baseRun.targetQueueProgress || null,
            legilProgress: (fullRun && fullRun.legilProgress) || baseRun.legilProgress || data.legilQueue || null,
            legilResult: (fullRun && fullRun.legilResult) || baseRun.legilResult || null,
            promptQualityReport: (fullRun && fullRun.promptQualityReport) || baseRun.promptQualityReport || null,
            promptTotal: Number(fullRun && fullRun.promptTotal) || Number(baseRun.promptTotal) || Number(data.legilQueue && data.legilQueue.total) || 0,
            promptTotalRaw: Number(fullRun && fullRun.promptTotalRaw) || Number(baseRun.promptTotalRaw) || 0,
            promptTotalRejected: Number(fullRun && fullRun.promptTotalRejected) || Number(baseRun.promptTotalRejected) || 0,
            message: (fullRun && fullRun.message) || baseRun.message || '',
            currentAction: (fullRun && fullRun.currentAction) || baseRun.currentAction || ''
        };
        mergedRun.legilProgress = runCenterNormalizeLegilProgress(mergedRun);
        mergedRun.current = {
            ...(mergedRun.current || {}),
            message: runCenterDisplayMessage(mergedRun, mergedRun.legilProgress)
        };

        return {
            ...data,
            activeRun: mergedRun,
            runs: Array.isArray(data.runs)
                ? data.runs.map(run => run && run.runId === mergedRun.runId ? { ...run, ...mergedRun } : run)
                : data.runs
        };
    } catch (error) {
        return data;
    }
}

function renderRunCenterStatus(data = {}) {
    runCenterLastStatus = data;
    const activeRunBase = data.activeRun || {};
    const normalizedLegilProgress = runCenterNormalizeLegilProgress(activeRunBase);
    const activeRun = normalizedLegilProgress
        ? {
            ...activeRunBase,
            legilProgress: normalizedLegilProgress,
            current: {
                ...(activeRunBase.current || {}),
                message: runCenterDisplayMessage(activeRunBase, normalizedLegilProgress)
            }
        }
        : activeRunBase;
    const legil = data.legilQueue || {};
    const counts = activeRun.counts || {};
    const current = activeRun.current || {};
    const controls = activeRun.controls || {};
    const creativeRuntime = window.CreativeAutoRuntime || null;
    const isCreativeRun = activeRun.runType === 'creative-auto' && creativeRuntime;
    const creativePhaseProgress = isCreativeRun ? creativeRuntime.getProgress(activeRun) : null;
    const creativeOverallProgress = isCreativeRun ? creativeRuntime.getOverallProgress(activeRun, creativePhaseProgress) : null;
    const creativeEtaState = isCreativeRun ? creativeRuntime.updateEtaCalibration(activeRun, creativePhaseProgress) : null;
    const creativeEstimate = isCreativeRun ? creativeRuntime.getEstimate(activeRun, creativePhaseProgress, creativeEtaState) : null;
    const percent = creativeOverallProgress
        ? Math.max(0, Math.min(100, Math.round(Number(creativeOverallProgress.percent) || 0)))
        : Math.max(0, Math.min(100, Math.round(Number(activeRun.progressPercent) || 0)));

    runCenterSetText('runCenterGlobalStatus', data.statusLabel || runCenterStatusLabel(data.status) || '空闲');
    runCenterSetText('runCenterGlobalPhase', data.phaseLabel || data.phase || '--');
    runCenterSetText('runCenterCurrentAgent', runCenterModuleLabel(data.currentAgent || activeRun.agent) || '--');
    runCenterSetText('runCenterUpdatedAt', runCenterFormatDate(data.updatedAt));

    runCenterSetPill('runCenterActiveRunStatus', data.activeRun ? `${runCenterStatusLabel(activeRun.status || 'idle')} / ${activeRun.phaseLabel || activeRun.phase || '--'}` : '空闲', activeRun.status);
    runCenterSetText('runCenterCurrentMessage', runCenterDisplayMessage(activeRun, activeRun.legilProgress) || '暂无运行中的任务。');
    runCenterSetText('runCenterEstimateText', data.activeRun
        ? (creativeEstimate ? creativeEstimate.text : '预计完成时间：--')
        : '预计完成时间：--');
    runCenterSetTitle('runCenterEstimateText', data.activeRun
        ? (creativeEstimate ? creativeEstimate.title : '当前任务暂未提供可估算的整体队列数据。')
        : '');
    runCenterSetText('runCenterProgressLabel', creativeOverallProgress ? '整体进度' : '统一进度');
    runCenterSetText('runCenterProgressText', creativeOverallProgress && creativeOverallProgress.total
        ? `${creativeOverallProgress.completed} / ${creativeOverallProgress.total} · ${percent}%`
        : `${percent}%`);
    const bar = document.getElementById('runCenterProgressBar');
    if (bar) bar.style.width = `${percent}%`;

    runCenterSetText('runCenterRunId', activeRun.runId || '--');
    runCenterSetText('runCenterRunType', activeRun.runTypeLabel || runCenterModuleLabel(activeRun.runType) || '--');
    runCenterSetText('runCenterMode', activeRun.mode || '--');
    runCenterSetText('runCenterSource', activeRun.source ? runCenterSourceLabel(activeRun.source) : '--');
    runCenterSetControl('runCenterCanPause', '暂停', controls.canPause || (data.capabilities && data.capabilities.canPause));
    runCenterSetControl('runCenterCanResume', '继续', controls.canResume || (data.capabilities && data.capabilities.canResume));
    runCenterSetControl('runCenterCanStop', '停止', controls.canStop || (data.capabilities && data.capabilities.canStop));
    const hasRunningWork = String(data.status || '').toLowerCase() === 'running' ||
        String(activeRun.status || '').toLowerCase() === 'running';
    const canStop = hasRunningWork && Boolean(
        controls.canStop ||
        controls.canPause ||
        (data.capabilities && (data.capabilities.canStop || data.capabilities.canPause)) ||
        legil.status === 'running' ||
        (Array.isArray(data.runs) && data.runs.some(run => run && run.status === 'running'))
    );
    const canResume = Boolean(controls.canResume || (data.capabilities && data.capabilities.canResume));
    const stopBtn = document.getElementById('runCenterStopAllBtn');
    const resumeBtn = document.getElementById('runCenterResumeBtn');
    if (stopBtn) stopBtn.disabled = !canStop;
    if (resumeBtn) resumeBtn.disabled = !canResume;

    runCenterSetPill('runCenterLegilStatus', runCenterStatusLabel(legil.status) || '空闲', legil.status);
    runCenterSetText('runCenterLegilTaskType', legil.taskType || '--');
    runCenterSetText('runCenterLegilQueueLength', String(Number(legil.queueLength) || 0));
    runCenterSetText('runCenterLegilProgress', `${Number(legil.completed) || 0} / ${Number(legil.total) || 0}`);
    runCenterSetText('runCenterLegilSaved', String(Number(legil.saved || counts.savedImages) || 0));
    runCenterSetText('runCenterLegilMessage', runCenterIsPausedRun(activeRun)
        ? (runCenterDisplayMessage(activeRun, activeRun.legilProgress) || '暂无 Legil 任务。')
        : (legil.currentAction || legil.currentName || '暂无 Legil 任务。'));

    renderRunCenterFlowList(Array.isArray(data.runs) ? data.runs : []);
}

async function readRunCenterJson(res, fallbackMessage) {
    const text = await res.text();
    try {
        return text ? JSON.parse(text) : {};
    } catch (error) {
        const looksLikePage = /^\s*</.test(text);
        const statusText = res && res.status ? `HTTP ${res.status}` : '接口异常';
        if (looksLikePage) {
            throw new Error(`${fallbackMessage}：统一状态接口返回了页面内容，请重启后端服务后刷新。`);
        }
        throw new Error(`${fallbackMessage}：接口返回内容不是 JSON（${statusText}）。`);
    }
}

async function postRunCenterAction(endpoint) {
    if (window.ApiClient && typeof window.ApiClient.fetchJson === 'function') {
        return await window.ApiClient.fetchJson(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source: 'run-center' }),
            timeoutMs: 20000,
            fallbackMessage: '运行中心操作失败',
            toastOnError: false
        });
    }

    const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'run-center' })
    });
    const data = await readRunCenterJson(res, '运行中心操作失败');
    if (!res.ok || data.success === false) {
        throw new Error(data.message || `操作失败（HTTP ${res.status}）`);
    }
    return data;
}

async function stopAllRunCenterTasks() {
    const active = runCenterLastStatus && runCenterLastStatus.activeRun;
    const label = active && active.runTypeLabel ? active.runTypeLabel : '当前页面任务';
    const confirmed = confirm(`确定停止所有正在运行的页面任务？\n\n将尝试停止 ${label} 和正在运行的执行模块。`);
    if (!confirmed) return;

    const btn = document.getElementById('runCenterStopAllBtn');
    if (btn) {
        btn.disabled = true;
        btn.textContent = '正在停止...';
    }

    try {
        const result = await postRunCenterAction('/api/run-state/stop-all');
        if (typeof showToast === 'function') showToast(result.message || '已发送停止指令');
        if (typeof addLog === 'function') addLog(result.message || '已发送停止指令', 'warn');
        await refreshRunCenterStatus();
    } catch (error) {
        if (typeof showToast === 'function') showToast(error.message || '停止任务失败', 'error');
        runCenterSetText('runCenterCurrentMessage', error.message || '停止任务失败');
    } finally {
        if (btn) btn.textContent = '停止所有任务';
    }
}

async function resumeRunCenterTask() {
    const btn = document.getElementById('runCenterResumeBtn');
    if (btn) {
        btn.disabled = true;
        btn.textContent = '正在继续...';
    }

    try {
        const result = await postRunCenterAction('/api/run-state/resume');
        if (typeof showToast === 'function') showToast(result.message || '已继续任务');
        if (typeof addLog === 'function') addLog(result.message || '已继续任务', 'system');
        await refreshRunCenterStatus();
    } catch (error) {
        if (typeof showToast === 'function') showToast(error.message || '继续任务失败', 'error');
        runCenterSetText('runCenterCurrentMessage', error.message || '继续任务失败');
    } finally {
        if (btn) btn.textContent = '继续任务';
    }
}

window.refreshRunCenterStatus = refreshRunCenterStatus;
window.stopAllRunCenterTasks = stopAllRunCenterTasks;
window.resumeRunCenterTask = resumeRunCenterTask;
window.startRunCenterPolling = startRunCenterPolling;
window.stopRunCenterPolling = stopRunCenterPolling;

async function refreshRunCenterStatus() {
    try {
        const data = window.ApiClient && typeof window.ApiClient.fetchJson === 'function'
            ? await window.ApiClient.fetchJson('/api/run-state/summary', {
                timeoutMs: 12000,
                fallbackMessage: '统一状态读取失败',
                toastOnError: false
            })
            : await (async () => {
                const res = await fetch('/api/run-state/summary');
                const fallbackData = await readRunCenterJson(res, '统一状态读取失败');
                if (!res.ok || !fallbackData.success) {
                    throw new Error(fallbackData.message || `统一状态读取失败（HTTP ${res.status}）`);
                }
                return fallbackData;
            })();
        const enrichedData = await enrichRunCenterCreativeAutoStatus(data);
        renderRunCenterStatus(enrichedData);
        return enrichedData;
    } catch (error) {
        runCenterSetText('runCenterGlobalStatus', '读取失败');
        runCenterSetText('runCenterCurrentAgent', '--');
        runCenterSetText('runCenterCurrentMessage', error.message || '统一状态读取失败');
        return null;
    }
}

function ensureRunCenterPoller() {
    if (!runCenterPoller && typeof window.createStatusPoller === 'function') {
        runCenterPoller = window.createStatusPoller({
            name: 'run-center-status',
            intervalMs: 10000,
            load: refreshRunCenterStatus,
            pauseWhenHidden: true,
            onError(error) {
                runCenterSetText('runCenterGlobalStatus', '读取失败');
                runCenterSetText('runCenterCurrentMessage', error.message || '统一状态读取失败');
            }
        });
    }
    return runCenterPoller;
}

function startRunCenterPolling() {
    const poller = ensureRunCenterPoller();
    if (poller) {
        if (!poller.isRunning || !poller.isRunning()) {
            poller.start();
        }
    } else {
        refreshRunCenterStatus().catch(() => {});
    }
}

function stopRunCenterPolling() {
    if (runCenterPoller) {
        runCenterPoller.stop();
    }
}

function initRunCenter() {
    startRunCenterPolling();
    if (typeof window.startAutonomyDiagnosticsPolling === 'function') {
        window.startAutonomyDiagnosticsPolling();
    }
}

setTimeout(() => {
    try {
        if (typeof addLog === 'function') {
            addLog('运行中心状态轮询已启动', 'system');
        }
        initRunCenter();
    } catch (error) {
        runCenterSetText('runCenterGlobalStatus', '启动失败');
        runCenterSetText('runCenterCurrentMessage', error.message || '运行中心启动失败');
        console.error('运行中心启动失败:', error);
    }
}, 0);
