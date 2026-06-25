// 运行诊断：阶段标签、健康摘要和闭环入口状态。
(function () {
    let diagnosticsPoller = null;
    let lastDiagnostics = null;

    function setText(id, value) {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    }

    function formatNumber(value) {
        const number = Number(value);
        return Number.isFinite(number) ? new Intl.NumberFormat('zh-CN').format(number) : '--';
    }

    function statusLabel(value) {
        const text = String(value || '').trim().toLowerCase();
        const labels = {
            idle: '空闲',
            unknown: '未知',
            preflight: '预检中',
            queued: '排队中',
            pending: '等待中',
            starting: '启动中',
            running: '运行中',
            paused: '已暂停',
            stopped: '已停止',
            completed: '已完成',
            failed: '异常',
            blocked: '阻断',
            cancelled: '已取消'
        };
        return labels[text] || value || '--';
    }

    function formatQueue(queue) {
        if (!queue || !queue.queueId) return '无队列';
        const status = statusLabel(queue.status || 'unknown');
        const remaining = Number(queue.remainingTargets) || 0;
        const total = Number(queue.totalTargets) || 0;
        return `${status} · ${remaining}/${total}`;
    }

    function todayProduction(data = {}) {
        const daily = data.schedulerState && data.schedulerState.daily ? data.schedulerState.daily : {};
        return Number(daily.imageCount) || 0;
    }

    function p0Warnings(data = {}) {
        return (Array.isArray(data.warnings) ? data.warnings : []).filter(item => item && item.severity === 'P0');
    }

    function statusClass(value) {
        const text = String(value || '').toLowerCase();
        if (text.includes('running')) return 'is-running';
        if (text.includes('paused')) return 'is-paused';
        if (text.includes('failed') || text.includes('blocked')) return 'is-failed';
        if (text.includes('completed')) return 'is-completed';
        return 'is-idle';
    }

    function updateStageBadges(data = {}) {
        const stage = data.policySummary && data.policySummary.stageLabel
            ? data.policySummary.stageLabel
            : '辅助自动';
        ['runCenterStageBadge', 'creativeStageBadge'].forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            el.textContent = stage;
            el.className = `autonomy-stage-badge ${statusClass(data.serviceStatus && data.serviceStatus.status)}`;
        });
    }

    function updateHealthSummary(data = {}) {
        const service = data.serviceStatus || {};
        const counts = data.knowledgeCounts || {};
        const p0Count = p0Warnings(data).length;
        const runStatus = service.preflightOk ? (service.status || 'idle') : 'preflight';

        setText('runCenterHealthRunStatus', statusLabel(runStatus));
        setText('runCenterHealthQueueStatus', formatQueue(data.targetQueue));
        setText('runCenterHealthTodayOutput', formatNumber(todayProduction(data)));
        setText('runCenterHealthP0', formatNumber(p0Count));
        setText('runCenterHealthUnreviewed', formatNumber(counts.unreviewedAssets));

        const health = document.getElementById('runCenterHealthRunStatus');
        if (health) health.className = `autonomy-health-value ${service.preflightOk ? statusClass(service.status) : 'is-failed'}`;
        const p0 = document.getElementById('runCenterHealthP0');
        if (p0) p0.className = `autonomy-health-value ${p0Count ? 'is-failed' : 'is-completed'}`;

        const warningList = document.getElementById('runCenterP0Warnings');
        if (warningList) {
            warningList.textContent = '';
            const warnings = (Array.isArray(data.warnings) ? data.warnings : []).slice(0, 4);
            if (!warnings.length) {
                const item = document.createElement('span');
                item.className = 'autonomy-warning-chip is-ok';
                item.textContent = '暂无阻断';
                warningList.appendChild(item);
            } else {
                warnings.forEach(warning => {
                    const item = document.createElement('span');
                    item.className = `autonomy-warning-chip ${warning.severity === 'P0' ? 'is-p0' : 'is-p1'}`;
                    const severityLabel = warning.severity === 'P0'
                        ? '关键'
                        : warning.severity === 'P1'
                        ? '提醒'
                        : '提示';
                    item.textContent = `${severityLabel} · ${warning.message || warning.code || '待处理'}`;
                    warningList.appendChild(item);
                });
            }
        }
    }

    function updateEntryPanels(data = {}) {
        const counts = data.knowledgeCounts || {};
        const queue = data.targetQueue || {};
        const lastRun = data.lastRun || {};

        setText('creativeEntryQueueTag', queue.queueId ? `${statusLabel(queue.status || '--')} · 剩 ${formatNumber(queue.remainingTargets)}` : '待启动');
        setText('creativeEntryPromptGateTag', lastRun.runId ? `${formatNumber(lastRun.promptAccepted)} 通过` : '待任务');
        setText('creativeEntryLegilTag', data.legilResume && data.legilResume.hasResume ? `可续 ${formatNumber(data.legilResume.remainingCount)}` : (data.serviceStatus && data.serviceStatus.legilRunning ? '运行中' : '空闲'));
        setText('creativeEntryReviewTag', `${formatNumber(counts.unreviewedAssets)} 未审`);

        setText('knowledgeEntryDirectionTag', `${formatNumber(counts.directions)} 方向`);
        setText('knowledgeEntryAssetTag', `${formatNumber(counts.assets)} 资产`);
        setText('knowledgeEntryFeedbackTag', `${formatNumber(counts.feedback)} 反馈`);
        setText('knowledgeEntryDnaTag', `${formatNumber(counts.activeMemoryRules)} 规则`);
    }

    function renderDiagnostics(data = {}) {
        lastDiagnostics = data;
        updateStageBadges(data);
        updateHealthSummary(data);
        updateEntryPanels(data);
    }

    async function loadAutonomyDiagnostics(options = {}) {
        try {
            const data = await window.ApiClient.fetchJson('/api/creative-auto/diagnostics', {
                timeoutMs: 12000,
                fallbackMessage: '读取运行诊断失败',
                toastOnError: options.silent !== true
            });
            renderDiagnostics(data);
            return data;
        } catch (error) {
            setText('runCenterHealthRunStatus', '读取失败');
            setText('runCenterHealthQueueStatus', error.message || '诊断接口异常');
            return null;
        }
    }

    function startAutonomyDiagnosticsPolling() {
        if (!diagnosticsPoller && typeof window.createStatusPoller === 'function') {
            diagnosticsPoller = window.createStatusPoller({
                name: 'autonomy-diagnostics',
                intervalMs: 30000,
                load: () => loadAutonomyDiagnostics({ silent: true }),
                pauseWhenHidden: true
            });
        }
        if (diagnosticsPoller) {
            if (!diagnosticsPoller.isRunning || !diagnosticsPoller.isRunning()) {
                diagnosticsPoller.start();
            }
        } else {
            loadAutonomyDiagnostics({ silent: true });
        }
    }

    function stopAutonomyDiagnosticsPolling() {
        if (diagnosticsPoller) diagnosticsPoller.stop();
    }

    window.loadAutonomyDiagnostics = loadAutonomyDiagnostics;
    window.startAutonomyDiagnosticsPolling = startAutonomyDiagnosticsPolling;
    window.stopAutonomyDiagnosticsPolling = stopAutonomyDiagnosticsPolling;
    window.getLastAutonomyDiagnostics = () => lastDiagnostics;

    document.addEventListener('DOMContentLoaded', () => {
        if (document.getElementById('runCenterPage')?.classList.contains('active') ||
            document.getElementById('autonomyPolicyPage')?.classList.contains('active')) {
            startAutonomyDiagnosticsPolling();
        }
    });
})();
