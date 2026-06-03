// 统一运行中心：消费 /api/run-state/status，展示老流程、新流程和 Legil 队列。
document.documentElement.dataset.runCenterScript = 'loaded';
let runCenterLastStatus = null;

function runCenterSetText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
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
        { key: 'legacy-workflow', label: '老流程参考图批量生图' },
        { key: 'creative-auto', label: '新流程自动创意' }
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
        status.textContent = run ? `${run.status || 'idle'} / ${run.phaseLabel || run.phase || '--'}` : '未运行';
        head.appendChild(title);
        head.appendChild(status);

        const body = document.createElement('div');
        body.className = 'run-center-flow-body';
        body.textContent = run
            ? `${run.agent || '暂无 Agent'} · ${runCenterShortText(run.current && run.current.message, 120)}`
            : '等待启动。';

        item.appendChild(head);
        item.appendChild(body);
        list.appendChild(item);
    });
}

function renderRunCenterStatus(data = {}) {
    runCenterLastStatus = data;
    const activeRun = data.activeRun || {};
    const legil = data.legilQueue || {};
    const counts = activeRun.counts || {};
    const current = activeRun.current || {};
    const controls = activeRun.controls || {};
    const percent = Math.max(0, Math.min(100, Math.round(Number(activeRun.progressPercent) || 0)));

    runCenterSetText('runCenterGlobalStatus', data.statusLabel || data.status || '空闲');
    runCenterSetText('runCenterGlobalPhase', data.phaseLabel || data.phase || '--');
    runCenterSetText('runCenterCurrentAgent', data.currentAgent || activeRun.agent || '--');
    runCenterSetText('runCenterUpdatedAt', runCenterFormatDate(data.updatedAt));

    runCenterSetPill('runCenterActiveRunStatus', data.activeRun ? `${activeRun.status || 'idle'} / ${activeRun.phaseLabel || activeRun.phase || '--'}` : '空闲', activeRun.status);
    runCenterSetText('runCenterCurrentMessage', current.message || '暂无运行中的任务。');
    runCenterSetText('runCenterProgressText', `${percent}%`);
    const bar = document.getElementById('runCenterProgressBar');
    if (bar) bar.style.width = `${percent}%`;

    runCenterSetText('runCenterRunId', activeRun.runId || '--');
    runCenterSetText('runCenterRunType', activeRun.runTypeLabel || activeRun.runType || '--');
    runCenterSetText('runCenterMode', activeRun.mode || '--');
    runCenterSetText('runCenterSource', activeRun.source ? runCenterSourceLabel(activeRun.source) : '--');
    runCenterSetControl('runCenterCanPause', '暂停', controls.canPause || (data.capabilities && data.capabilities.canPause));
    runCenterSetControl('runCenterCanResume', '继续', controls.canResume || (data.capabilities && data.capabilities.canResume));
    runCenterSetControl('runCenterCanStop', '停止', controls.canStop || (data.capabilities && data.capabilities.canStop));
    const canStop = Boolean(
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

    runCenterSetPill('runCenterLegilStatus', legil.status || '空闲', legil.status);
    runCenterSetText('runCenterLegilTaskType', legil.taskType || '--');
    runCenterSetText('runCenterLegilQueueLength', String(Number(legil.queueLength) || 0));
    runCenterSetText('runCenterLegilProgress', `${Number(legil.completed) || 0} / ${Number(legil.total) || 0}`);
    runCenterSetText('runCenterLegilSaved', String(Number(legil.saved || counts.savedImages) || 0));
    runCenterSetText('runCenterLegilMessage', legil.currentAction || legil.currentName || '暂无 Legil 任务。');

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
    const confirmed = confirm(`确定停止所有正在运行的页面任务？\n\n将尝试停止 ${label}、Legil 队列和正在运行的 Agent。`);
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

async function refreshRunCenterStatus() {
    try {
        const res = await fetch('/api/run-state/status');
        const data = await readRunCenterJson(res, '统一状态读取失败');
        if (!res.ok || !data.success) {
            throw new Error(data.message || `统一状态读取失败（HTTP ${res.status}）`);
        }
        renderRunCenterStatus(data);
    } catch (error) {
        runCenterSetText('runCenterGlobalStatus', '读取失败');
        runCenterSetText('runCenterCurrentAgent', '--');
        runCenterSetText('runCenterCurrentMessage', error.message || '统一状态读取失败');
    }
}

function initRunCenter() {
    refreshRunCenterStatus();
    if (window.__runCenterStatusInterval) {
        clearInterval(window.__runCenterStatusInterval);
    }
    window.__runCenterStatusInterval = setInterval(refreshRunCenterStatus, 3000);
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
