function nowIso() {
    return new Date().toISOString();
}

function asNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function clampPercent(value) {
    const number = Math.round(asNumber(value, 0));
    return Math.max(0, Math.min(100, number));
}

function pickText(...values) {
    for (const value of values) {
        const text = String(value || '').trim();
        if (text) return text;
    }
    return '';
}

function normalizePhase(phase, fallback = 'idle') {
    const value = String(phase || '').trim();
    const map = {
        idle: 'idle',
        starting: 'preflight',
        processing_image: 'preflight',
        extracting_prompts: 'prompt_generation',
        generating_in_legil: 'legil_running',
        completed: 'completed',
        stopped: 'paused',
        error: 'failed',
        agent_running: 'creative_agent',
        agent_completed: 'prompt_gate',
        agent_cancelled: 'paused',
        agent_failed: 'failed',
        prompt_gate_empty: 'prompt_gate',
        legil_pending: 'legil_queue',
        legil_starting: 'legil_queue',
        legil_queued: 'legil_queue',
        legil_running: 'legil_running',
        legil_stopping: 'legil_running',
        legil_paused: 'paused',
        legil_completed: 'completed',
        legil_failed: 'failed',
        legil_start_failed: 'failed',
        legil_resume_failed: 'failed',
        legil_continue_failed: 'failed',
        legil_poll_timeout: 'paused'
    };
    return map[value] || value || fallback;
}

function phaseLabel(phase) {
    const map = {
        idle: '空闲',
        preflight: '预检',
        prompt_generation: '提示词生成',
        task_import: '任务表导入',
        task_vision: '任务方向视觉整理',
        target_selection: '选择任务方向',
        creative_agent: '创意 Agent',
        candidate_review: '候选方向审核',
        prompt_translate: 'Prompt 转译',
        prompt_gate: 'Prompt Gate',
        legil_queue: 'Legil 队列',
        legil_running: 'Legil 生成',
        asset_register: '资产登记',
        feedback: '反馈学习',
        paused: '已暂停',
        completed: '已完成',
        failed: '失败'
    };
    return map[phase] || phase || '未知';
}

function statusLabel(status) {
    const map = {
        idle: '空闲',
        queued: '排队中',
        running: '运行中',
        paused: '已暂停',
        completed: '已完成',
        failed: '失败',
        stopped: '已停止'
    };
    return map[status] || status || '未知';
}

function agentLabel(phase, runType) {
    const normalized = normalizePhase(phase);
    const map = {
        preflight: runType === 'legacy-workflow' ? 'Winky 视觉提示词 Agent' : '选题与预检 Agent',
        prompt_generation: 'Winky 视觉提示词 Agent',
        task_import: '自动化任务表解析 Agent',
        task_vision: '任务方向视觉整理 Agent',
        target_selection: '用户选择方向',
        creative_agent: '创意拓展 Agent',
        candidate_review: '候选方向审核 Agent',
        prompt_translate: 'Legil Prompt 转译 Agent',
        prompt_gate: 'Prompt Gate Agent',
        legil_queue: 'Legil 队列执行 Agent',
        legil_running: 'Legil 队列执行 Agent',
        asset_register: '资产登记 Agent',
        feedback: '反馈学习 Agent',
        completed: '已完成',
        paused: '等待继续',
        failed: '错误处理'
    };
    return map[normalized] || '';
}

function runModeLabel(run = {}) {
    if (run.agentOnly === true || run.mode === 'agent-only') return 'observe';
    if (run.mode === 'semi-auto') return 'semi-auto';
    return 'full-auto';
}

function extractLegilQueue(context = {}) {
    const automationState = context.automationState || {};
    const progress = automationState.legilTaskProgress || null;
    const running = automationState.legilTaskRunning === true;
    const taskType = automationState.legilTaskType || (progress && progress.taskType) || '';
    const phase = progress && progress.phase ? String(progress.phase) : (running ? 'running' : 'idle');
    const total = asNumber(progress && progress.total, 0);
    const completed = asNumber(progress && progress.completed, 0);

    return {
        status: running ? 'running' : (progress && ['stopped', 'paused'].includes(phase) ? 'paused' : 'idle'),
        phase,
        taskType,
        currentTaskId: pickText(progress && progress.batchRunId, progress && progress.runId),
        currentName: pickText(progress && progress.currentName),
        currentAction: pickText(progress && progress.currentAction),
        queueLength: running ? 1 : 0,
        total,
        completed,
        success: asNumber(progress && progress.success, 0),
        failed: asNumber(progress && progress.failed, 0),
        saved: asNumber(progress && progress.saved, 0),
        progressPercent: total > 0 ? clampPercent((completed / total) * 100) : 0,
        updatedAt: pickText(progress && progress.updatedAt)
    };
}

function buildLegacyRun(context = {}) {
    const workflowController = context.workflowController;
    if (!workflowController || typeof workflowController.getStatus !== 'function') {
        return null;
    }

    const status = workflowController.getStatus();
    const detail = status.currentStatus || {};
    const hasHistory = status.totalImages > 0 || detail.phase !== 'idle';
    if (!status.isRunning && !hasHistory) {
        return null;
    }

    const phase = normalizePhase(detail.phase, status.isRunning ? 'preflight' : 'idle');
    const currentImage = asNumber(detail.currentImageIndex, asNumber(status.currentIndex, 0) + 1);
    const totalImages = asNumber(detail.totalImages, asNumber(status.totalImages, 0));
    const currentPrompt = asNumber(detail.currentPromptIndex, 0);
    const totalPrompts = asNumber(detail.totalPrompts, 0);
    const imageProgress = totalImages > 0 ? ((Math.max(0, currentImage - 1) / totalImages) * 100) : 0;
    const promptProgress = totalPrompts > 0 ? ((currentPrompt / totalPrompts) * 100) : 0;
    const progress = totalPrompts > 0 ? promptProgress : imageProgress;
    const resume = typeof workflowController.getResumeInfo === 'function'
        ? workflowController.getResumeInfo()
        : null;

    return {
        runId: pickText(status.runId, detail.runId, workflowController.currentRunId, 'legacy-workflow'),
        runType: 'legacy-workflow',
        runTypeLabel: '老流程参考图批量生图',
        mode: 'full-auto',
        status: status.isRunning ? 'running' : (phase === 'failed' ? 'failed' : (phase === 'completed' ? 'completed' : (resume && resume.hasResume ? 'paused' : 'idle'))),
        phase,
        phaseLabel: phaseLabel(phase),
        agent: agentLabel(phase, 'legacy-workflow'),
        progressPercent: clampPercent(progress || status.progress || 0),
        createdAt: '',
        startedAt: '',
        updatedAt: nowIso(),
        completedAt: phase === 'completed' ? nowIso() : '',
        source: {
            type: 'folder',
            inputFolder: workflowController.inputFolder || '',
            outputFolder: workflowController.outputFolder || '',
            currentImage: status.currentImage || '',
            currentImageName: detail.currentImageName || ''
        },
        counts: {
            candidateDirections: 0,
            rawPrompts: totalPrompts,
            acceptedPrompts: totalPrompts,
            rejectedPrompts: 0,
            expectedImages: totalImages * Math.max(1, totalPrompts),
            savedImages: asNumber(status.stats && status.stats.totalGenerated, 0),
            failedPrompts: asNumber(status.stats && status.stats.failed, 0),
            currentImage,
            totalImages,
            currentPrompt,
            totalPrompts
        },
        current: {
            agent: agentLabel(phase, 'legacy-workflow'),
            taskId: '',
            message: pickText(detail.currentAction, status.isRunning ? '工作流运行中' : '工作流未运行')
        },
        controls: {
            canPause: status.isRunning === true,
            canResume: Boolean(resume && resume.hasResume),
            canStop: status.isRunning === true
        },
        errors: detail.error ? [detail.error] : [],
        warnings: []
    };
}

function creativeProgressPercent(run = {}) {
    const legilProgress = run.legilProgress || {};
    const legilTotal = asNumber(legilProgress.total, 0);
    if (legilTotal > 0) {
        return clampPercent((asNumber(legilProgress.completed, 0) / legilTotal) * 100);
    }
    const accepted = asNumber(run.promptTotal, 0);
    const raw = Math.max(
        accepted,
        asNumber(run.promptTotalCandidate, 0),
        asNumber(run.promptTotalTranslated, 0),
        asNumber(run.promptTotalRaw, 0)
    );
    if (normalizePhase(run.phase) === 'completed') return 100;
    if (raw > 0 && accepted > 0) return 65;
    if (run.phase === 'agent_running') return 35;
    return run.status === 'running' ? 20 : 0;
}

function buildCreativeRun(context = {}) {
    const service = context.creativeAutoService;
    if (!service || typeof service.getStatus !== 'function') {
        return null;
    }

    let status;
    try {
        status = service.getStatus({ appConfig: context.appConfig });
    } catch (error) {
        return {
            runId: 'creative-auto-status-error',
            runType: 'creative-auto',
            runTypeLabel: '新流程自动创意',
            mode: 'full-auto',
            status: 'failed',
            phase: 'failed',
            phaseLabel: phaseLabel('failed'),
            agent: '运行状态读取',
            progressPercent: 0,
            current: {
                agent: '运行状态读取',
                taskId: '',
                message: error.message
            },
            controls: {
                canPause: false,
                canResume: false,
                canStop: false
            },
            counts: {},
            source: {},
            errors: [error.message],
            warnings: []
        };
    }

    const run = status.activeRun || status.resumableRun || null;
    if (!run) {
        return null;
    }

    const phase = normalizePhase(run.phase, status.activeRun ? 'creative_agent' : 'paused');
    const runStatus = status.activeRun
        ? 'running'
        : (run.status === 'paused' ? 'paused' : (run.status || 'idle'));
    const legilTask = run.legilTask || status.legilTask || {};
    const sourceDirection = run.sourceDirection || {};
    const aggregate = run.aggregateTarget || {};

    return {
        runId: pickText(run.runId, 'creative-auto'),
        runType: 'creative-auto',
        runTypeLabel: '新流程自动创意',
        mode: runModeLabel(run),
        status: runStatus,
        phase,
        phaseLabel: phaseLabel(phase),
        agent: agentLabel(phase, 'creative-auto'),
        progressPercent: creativeProgressPercent(run),
        createdAt: pickText(run.createdAt),
        startedAt: pickText(run.startedAt),
        updatedAt: pickText(run.updatedAt),
        completedAt: pickText(run.completedAt),
        source: {
            type: aggregate && aggregate.source === 'material-brief' ? 'material-brief' : 'direction',
            directionId: pickText(sourceDirection.id, run.directionId),
            directionPath: pickText(sourceDirection.path, sourceDirection.name, aggregate.path, run.directionPath),
            materialRunId: pickText(run.materialRunId)
        },
        counts: {
            candidateDirections: asNumber(run.candidateDirectionCount, asNumber(run.candidateDirections && run.candidateDirections.length, 0)),
            rawPrompts: asNumber(run.promptTotalRaw, 0),
            acceptedPrompts: asNumber(run.promptTotal, 0),
            rejectedPrompts: asNumber(run.promptTotalRejected, 0),
            expectedImages: asNumber(legilTask.expectedImageTotal, 0),
            savedImages: asNumber(run.assetReport && run.assetReport.newAssetCount, asNumber(run.legilProgress && run.legilProgress.saved, 0)),
            failedPrompts: asNumber(run.legilProgress && run.legilProgress.failed, 0)
        },
        current: {
            agent: agentLabel(phase, 'creative-auto'),
            taskId: pickText(legilTask.taskId),
            message: pickText(run.message, run.currentAction, run.legilProgress && run.legilProgress.currentAction, status.targetQueue && status.targetQueue.message)
        },
        controls: {
            canPause: runStatus === 'running',
            canResume: runStatus === 'paused' || run.status === 'paused',
            canStop: runStatus === 'running'
        },
        errors: run.lastError ? [run.lastError] : [],
        warnings: Array.isArray(run.warnings) ? run.warnings : []
    };
}

function choosePrimaryRun(runs = []) {
    return runs.find(run => run && run.status === 'running') ||
        runs.find(run => run && run.status === 'paused') ||
        runs.find(run => run && run.status === 'failed') ||
        runs.find(Boolean) ||
        null;
}

function createRunStateService(context = {}) {
    function getStatus() {
        const legacyRun = buildLegacyRun(context);
        const creativeRun = buildCreativeRun(context);
        const runs = [legacyRun, creativeRun].filter(Boolean);
        const activeRun = choosePrimaryRun(runs);
        const legilQueue = extractLegilQueue(context);
        const globalStatus = activeRun
            ? activeRun.status
            : (legilQueue.status === 'running' ? 'running' : 'idle');
        const phase = activeRun
            ? activeRun.phase
            : (legilQueue.status === 'running' ? 'legil_running' : 'idle');

        return {
            success: true,
            schemaVersion: 'unified-run-state-v1',
            status: globalStatus,
            statusLabel: statusLabel(globalStatus),
            phase,
            phaseLabel: phaseLabel(phase),
            currentAgent: activeRun ? activeRun.agent : '',
            activeRunId: activeRun ? activeRun.runId : '',
            activeRun,
            runs,
            legilQueue,
            capabilities: {
                canPause: Boolean(activeRun && activeRun.controls && activeRun.controls.canPause),
                canResume: Boolean(activeRun && activeRun.controls && activeRun.controls.canResume),
                canStop: Boolean(activeRun && activeRun.controls && activeRun.controls.canStop)
            },
            updatedAt: nowIso()
        };
    }

    return {
        getStatus
    };
}

module.exports = {
    createRunStateService,
    normalizePhase,
    phaseLabel,
    statusLabel
};
