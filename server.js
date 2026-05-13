/**
 * ============================================
 * 自动化AI生图网页控制平台 - 服务器端代码
 * ============================================
 * 第四阶段：添加实时日志系统（SSE）
 * 新增：服务器主动向前端推送日志
 */

// 引入 express 模块
const express = require('express');

// 引入 path 模块，用于处理文件路径
const path = require('path');

// 引入 fs 模块，文件系统模块
const fs = require('fs');
const axios = require('axios');
const crypto = require('crypto');
const { execFile, spawn } = require('child_process');
const { Worker } = require('worker_threads');

// 引入 Playwright 浏览器控制器
const browserController = require('./playwright-controller');

// 引入实时日志系统（第四阶段新增）
const logger = require('./logger');

// 引入豆包自动化模块（第五阶段新增）
const doubaoAutomation = require('./doubao-automation');

// 引入 Legil 自动化模块（第七阶段新增）
const legilAutomation = require('./legil-automation');

// 引入工作流控制器（第九阶段新增）
const workflowController = require('./workflow-controller');

const { formatDateTimeForFile, sortNaturallyByName } = require('./file-utils');
const { readConfig, updateConfig } = require('./config-store');
const { readSecrets } = require('./secrets-store');
const { parseCreativePromptWorkbook } = require('./creative-table-parser');
const { buildCreativeAgentQualityReport } = require('./creative-agent-quality');
const {
    CREATIVE_AGENT_OUTPUT_DIR,
    getCreativeAgentStatus,
    getStoredWinkyConfig,
    sanitizeCreativeAgentError
} = require('./creative-agent-service');
const feishuCliBridge = require('./feishu-cli-bridge');
const { FeishuControlService } = require('./feishu-control-service');
const { CARD_ACTIONS } = require('./feishu-card-builder');
const { FeishuNotificationService } = require('./feishu-notification-service');
const { HealthMonitor, compactProgress } = require('./health-monitor');
const {
    readFeishuCliConfig,
    getSafeFeishuCliConfig,
    validateFeishuCliConfig
} = require('./feishu-cli-config');

const persistedConfig = readConfig();

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
const DEFAULT_RESIZE_CONFIG = {
    inputFolder: 'D:\\工作\\自动化工作流1\\Legil批量改尺寸\\输入',
    outputFolder: 'D:\\工作\\自动化工作流1\\Legil批量改尺寸\\输出',
    browserMode: 'headless',
    promptTemplate: '',
    generationSettings: {
        imageModel: 'nano-banana-2',
        aspectRatio: '16:9',
        resolution: '1K',
        outputQuantity: 1
    }
};
const DEFAULT_WORKFLOW_CONFIG = {
    browserMode: 'headless'
};
const DEFAULT_NOTIFICATION_CONFIG = {
    feishuEnabled: true,
    taskCompletionEnabled: true,
    serverStartupEnabled: true,
    staleProgressEnabled: true,
    staleThresholdMinutes: 15,
    notificationCooldownMinutes: 10,
    legilScreenshotEnabled: true,
    autoRecoveryEnabled: true,
    pauseOnConsecutiveFailures: true,
    consecutiveFailureThreshold: 3,
    watchdogAutoRestartEnabled: true
};
const DEFAULT_CREATIVE_CONFIG = {
    outputFolder: 'D:\\工作\\自动化工作流1\\创意拓展\\输出',
    referenceFolder: '',
    browserMode: 'headed',
    generationSettings: {
        imageModel: 'nano-banana-2',
        aspectRatio: '1:1',
        resolution: '1K',
        outputQuantity: 1
    }
};

function normalizeNotificationConfig(payload = {}) {
    const source = payload && typeof payload === 'object' ? payload : {};
    const toBool = (value, fallback) => {
        if (value === undefined || value === null || value === '') return fallback;
        if (typeof value === 'boolean') return value;
        const text = String(value).trim().toLowerCase();
        if (['1', 'true', 'yes', 'on', 'enabled'].includes(text)) return true;
        if (['0', 'false', 'no', 'off', 'disabled'].includes(text)) return false;
        return fallback;
    };
    const toNumber = (value, fallback, min, max) => {
        const number = Number(value);
        if (!Number.isFinite(number)) return fallback;
        return Math.max(min, Math.min(max, Math.round(number)));
    };

    return {
        feishuEnabled: toBool(source.feishuEnabled, DEFAULT_NOTIFICATION_CONFIG.feishuEnabled),
        taskCompletionEnabled: toBool(source.taskCompletionEnabled, DEFAULT_NOTIFICATION_CONFIG.taskCompletionEnabled),
        serverStartupEnabled: toBool(source.serverStartupEnabled, DEFAULT_NOTIFICATION_CONFIG.serverStartupEnabled),
        staleProgressEnabled: toBool(source.staleProgressEnabled, DEFAULT_NOTIFICATION_CONFIG.staleProgressEnabled),
        staleThresholdMinutes: toNumber(source.staleThresholdMinutes, DEFAULT_NOTIFICATION_CONFIG.staleThresholdMinutes, 1, 1440),
        notificationCooldownMinutes: toNumber(source.notificationCooldownMinutes, DEFAULT_NOTIFICATION_CONFIG.notificationCooldownMinutes, 0, 1440),
        legilScreenshotEnabled: toBool(source.legilScreenshotEnabled, DEFAULT_NOTIFICATION_CONFIG.legilScreenshotEnabled),
        autoRecoveryEnabled: toBool(source.autoRecoveryEnabled, DEFAULT_NOTIFICATION_CONFIG.autoRecoveryEnabled),
        pauseOnConsecutiveFailures: toBool(source.pauseOnConsecutiveFailures, DEFAULT_NOTIFICATION_CONFIG.pauseOnConsecutiveFailures),
        consecutiveFailureThreshold: toNumber(source.consecutiveFailureThreshold, DEFAULT_NOTIFICATION_CONFIG.consecutiveFailureThreshold, 1, 20),
        watchdogAutoRestartEnabled: toBool(source.watchdogAutoRestartEnabled, DEFAULT_NOTIFICATION_CONFIG.watchdogAutoRestartEnabled)
    };
}

/**
 * ============================================
 * 全局配置存储
 * ============================================
 */
const appConfig = {
    legilReferenceFolder: persistedConfig.legilReferenceFolder || 'D:\\工作\\自动化工作流1\\批量产图\\参考图',
    workflow: {
        ...DEFAULT_WORKFLOW_CONFIG,
        ...(persistedConfig.workflow && typeof persistedConfig.workflow === 'object' ? persistedConfig.workflow : {})
    },
    notifications: normalizeNotificationConfig(persistedConfig.notifications || {}),
    resize: {
        ...DEFAULT_RESIZE_CONFIG,
        ...(persistedConfig.resize && typeof persistedConfig.resize === 'object' ? persistedConfig.resize : {})
    },
    creative: {
        ...DEFAULT_CREATIVE_CONFIG,
        ...(persistedConfig.creative && typeof persistedConfig.creative === 'object' ? persistedConfig.creative : {})
    }
};

if (persistedConfig.doubao && typeof persistedConfig.doubao === 'object') {
    try {
        doubaoAutomation.setConfig(persistedConfig.doubao);
    } catch (error) {
        console.warn('加载豆包配置失败，已使用默认配置:', error.message);
    }
}

if (persistedConfig.legil && typeof persistedConfig.legil === 'object') {
    try {
        legilAutomation.setGenerationSettings(persistedConfig.legil);
    } catch (error) {
        console.warn('加载 Legil 生成参数失败，已使用默认配置:', error.message);
    }
}

const automationState = {
    legilTaskRunning: false,
    legilStopRequested: false,
    legilTaskType: null,
    legilTaskProgress: null
};

const serverStartedAt = new Date().toISOString();
const feishuNotifier = new FeishuNotificationService({
    bridge: feishuCliBridge,
    enabled: appConfig.notifications.feishuEnabled,
    cooldownMs: Number(process.env.FEISHU_NOTIFY_COOLDOWN_MS) || appConfig.notifications.notificationCooldownMinutes * 60 * 1000
});
let healthMonitor = null;
const WATCHDOG_SCRIPT_PATH = path.join(__dirname, 'feishu-watchdog.js');
const WATCHDOG_STATUS_PATH = path.join(__dirname, 'runtime', 'feishu-watchdog.status.json');
let watchdogStartAttempted = false;

let creativeResumeState = null;
let serverRestartScheduled = false;
const creativeAgentTasks = new Map();
const CREATIVE_AGENT_TASK_MAX_AGE_MS = 6 * 60 * 60 * 1000;

function clampNumber(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue)) {
        return min;
    }
    return Math.max(min, Math.min(max, Math.floor(numberValue)));
}

function normalizeCreativeBatchPromptItems(promptItems = []) {
    return (Array.isArray(promptItems) ? promptItems : [])
        .map((item, index) => {
            const prompt = typeof item === 'string'
                ? item
                : (item && typeof item.prompt === 'string' ? item.prompt : '');
            const direction = item && typeof item.direction === 'string' ? item.direction : '';
            const promptTitle = item && typeof item.promptTitle === 'string' ? item.promptTitle : '';
            const sourceRow = item && Number.isFinite(Number(item.sourceRow)) ? Number(item.sourceRow) : index + 1;
            const originalIndex = item && Number.isFinite(Number(item.index)) && Number(item.index) > 0
                ? Number(item.index)
                : index + 1;
            return {
                index: originalIndex,
                batchIndex: index + 1,
                sourceRow,
                direction: direction.trim(),
                promptTitle: promptTitle.trim(),
                prompt: prompt.trim(),
                selected: true
            };
        })
        .filter(item => item.prompt);
}

function normalizeCreativeResumeState(state) {
    if (!state || typeof state !== 'object' || !Array.isArray(state.prompts) || state.prompts.length === 0) {
        return null;
    }

    const prompts = normalizeCreativeBatchPromptItems(state.prompts);
    if (prompts.length === 0) {
        return null;
    }

    const localTotal = prompts.length;
    const storedTotal = clampNumber(state.total, 0);
    const nextIndex = clampNumber(
        state.nextIndex !== undefined ? state.nextIndex : state.completed,
        0,
        localTotal
    );
    const completedCandidate = clampNumber(
        state.completed !== undefined ? state.completed : nextIndex,
        0
    );
    const explicitBaseCompleted = state.baseCompleted !== undefined
        ? clampNumber(state.baseCompleted, 0)
        : null;
    const baseCompleted = Math.max(
        explicitBaseCompleted !== null ? explicitBaseCompleted : 0,
        Math.max(0, storedTotal - localTotal),
        Math.max(0, completedCandidate - nextIndex)
    );
    const total = Math.max(localTotal + baseCompleted, storedTotal, localTotal);
    const phase = String(state.phase || 'interrupted');
    const generationSettings = normalizeLegilGenerationSettings(
        state.generationSettings,
        appConfig.creative && appConfig.creative.generationSettings
            ? appConfig.creative.generationSettings
            : DEFAULT_CREATIVE_CONFIG.generationSettings
    );
    const outputQuantity = Number(generationSettings.outputQuantity) || 1;
    const baseSuccess = clampNumber(state.baseSuccess, 0, total);
    const baseFailed = clampNumber(state.baseFailed, 0, total);
    const baseSaved = clampNumber(state.baseSaved, 0);
    const completed = clampNumber(
        state.completed !== undefined ? state.completed : baseCompleted + nextIndex,
        0,
        total
    );

    return {
        runId: String(state.runId || ''),
        phase,
        tableFileName: String(state.tableFileName || '上次创意拓展任务'),
        outputFolder: normalizeInputPath(state.outputFolder) || appConfig.creative.outputFolder || DEFAULT_CREATIVE_CONFIG.outputFolder,
        referenceFolder: normalizeInputPath(state.referenceFolder),
        browserMode: normalizeCreativeBrowserMode(state.browserMode, appConfig.creative.browserMode || DEFAULT_CREATIVE_CONFIG.browserMode),
        generationSettings,
        prompts,
        total,
        baseCompleted: clampNumber(baseCompleted, 0, total),
        baseSuccess,
        baseFailed,
        baseSaved,
        nextIndex,
        currentIndex: clampNumber(state.currentIndex !== undefined ? state.currentIndex : baseCompleted + nextIndex, 0, total),
        completed,
        success: clampNumber(state.success !== undefined ? state.success : baseSuccess, 0, total),
        failed: clampNumber(state.failed !== undefined ? state.failed : baseFailed, 0, total),
        saved: clampNumber(state.saved !== undefined ? state.saved : baseSaved, 0),
        outputTotal: Math.max(clampNumber(state.outputTotal, 0), total * outputQuantity),
        currentName: String(state.currentName || ''),
        currentAction: String(state.currentAction || '创意拓展任务被中断，可选择继续剩余任务。'),
        startedAt: String(state.startedAt || new Date().toISOString()),
        updatedAt: String(state.updatedAt || new Date().toISOString())
    };
}

function persistCreativeResumeState() {
    try {
        updateConfig({ creativeResume: creativeResumeState });
    } catch (error) {
        console.warn('保存创意拓展恢复状态失败:', error.message);
    }
}

function setCreativeResumeState(state) {
    creativeResumeState = state ? normalizeCreativeResumeState(state) : null;
    if (creativeResumeState) {
        creativeResumeState.updatedAt = new Date().toISOString();
    }
    persistCreativeResumeState();
    return creativeResumeState;
}

function updateCreativeResumeState(updates = {}) {
    if (!creativeResumeState) {
        return null;
    }

    creativeResumeState = normalizeCreativeResumeState({
        ...creativeResumeState,
        ...(updates && typeof updates === 'object' ? updates : {}),
        updatedAt: new Date().toISOString()
    });
    persistCreativeResumeState();
    return creativeResumeState;
}

function clearCreativeResumeState() {
    creativeResumeState = null;
    persistCreativeResumeState();
}

function getCreativeResumeInfo(includePrompts = false) {
    const state = normalizeCreativeResumeState(creativeResumeState);
    if (!state) {
        return { hasResume: false };
    }

    creativeResumeState = state;
    const nextIndex = clampNumber(state.nextIndex, 0, state.total);
    const remainingPrompts = state.prompts.slice(nextIndex);
    if (remainingPrompts.length === 0 || state.phase === 'completed') {
        return { hasResume: false };
    }

    return {
        hasResume: true,
        runId: state.runId,
        phase: state.phase,
        tableFileName: state.tableFileName,
        total: state.total,
        baseCompleted: state.baseCompleted,
        baseSuccess: state.baseSuccess,
        baseFailed: state.baseFailed,
        baseSaved: state.baseSaved,
        completed: Math.min(state.completed, state.total),
        success: state.success,
        failed: state.failed,
        saved: state.saved,
        remainingCount: remainingPrompts.length,
        remainingIndexes: remainingPrompts.map(item => item.index),
        outputFolder: state.outputFolder,
        referenceFolder: state.referenceFolder,
        browserMode: state.browserMode,
        generationSettings: {
            ...state.generationSettings
        },
        startedAt: state.startedAt,
        updatedAt: state.updatedAt,
        currentAction: state.currentAction,
        progress: {
            taskType: 'creative-batch',
            phase: state.phase,
            total: state.total,
            baseCompleted: state.baseCompleted,
            baseSuccess: state.baseSuccess,
            baseFailed: state.baseFailed,
            baseSaved: state.baseSaved,
            currentIndex: state.currentIndex || nextIndex,
            completed: Math.min(state.completed, state.total),
            success: state.success,
            failed: state.failed,
            saved: state.saved,
            outputTotal: state.outputTotal,
            browserMode: state.browserMode,
            currentName: state.currentName,
            currentAction: state.currentAction,
            startedAt: state.startedAt,
            updatedAt: state.updatedAt
        },
        prompts: includePrompts
            ? state.prompts.map((item, index) => ({
                ...item,
                selected: remainingPrompts.some(remaining => remaining.index === item.index) || index >= nextIndex
            }))
            : undefined
    };
}

function getCreativeProgressSnapshot() {
    if (
        automationState.legilTaskProgress &&
        automationState.legilTaskProgress.taskType === 'creative-batch'
    ) {
        return {
            hasProgress: true,
            running: automationState.legilTaskRunning === true,
            stopRequested: automationState.legilStopRequested === true,
            taskType: automationState.legilTaskType,
            progress: {
                ...automationState.legilTaskProgress
            }
        };
    }

    const resumeInfo = getCreativeResumeInfo(false);
    if (resumeInfo.hasResume && resumeInfo.progress) {
        return {
            hasProgress: true,
            running: false,
            stopRequested: false,
            taskType: 'creative-batch',
            progress: {
                ...resumeInfo.progress
            },
            resume: {
                hasResume: true,
                remainingCount: resumeInfo.remainingCount,
                total: resumeInfo.total,
                phase: resumeInfo.phase,
                updatedAt: resumeInfo.updatedAt
            }
        };
    }

    return {
        hasProgress: false,
        running: false,
        stopRequested: false,
        taskType: null,
        progress: null
    };
}

function sameCreativePromptIdentity(a, b) {
    if (!a || !b) {
        return false;
    }

    const aIndex = Number(a.index);
    const bIndex = Number(b.index);
    if (Number.isFinite(aIndex) && Number.isFinite(bIndex) && aIndex > 0 && bIndex > 0) {
        return aIndex === bIndex;
    }

    return String(a.prompt || '').trim() === String(b.prompt || '').trim();
}

function isCreativeResumeStartRequest(body = {}) {
    if (!body || typeof body !== 'object') {
        return false;
    }

    return body.resumeMode === true ||
        String(body.resumeMode || '').toLowerCase() === 'true' ||
        Boolean(String(body.resumeRunId || '').trim());
}

function resolveCreativeBatchRunContext(normalizedPrompts, body = {}, generationSettings = {}) {
    const previousState = normalizeCreativeResumeState(creativeResumeState);
    const resumeRequested = isCreativeResumeStartRequest(body);
    const resumeRunId = String(body.resumeRunId || '').trim();
    const outputQuantity = Number(generationSettings.outputQuantity) || 1;
    const fallbackTotal = normalizedPrompts.length;
    const fallbackOutputTotal = fallbackTotal * outputQuantity;

    const fallbackContext = {
        isResume: false,
        previousState: null,
        baseCompleted: 0,
        baseSuccess: 0,
        baseFailed: 0,
        baseSaved: 0,
        total: fallbackTotal,
        outputTotal: fallbackOutputTotal
    };

    if (!resumeRequested || !previousState || previousState.phase === 'completed') {
        return fallbackContext;
    }

    if (resumeRunId && previousState.runId && resumeRunId !== previousState.runId) {
        return fallbackContext;
    }

    const previousNextIndex = clampNumber(previousState.nextIndex, 0, previousState.prompts.length);
    const remainingPrompts = previousState.prompts.slice(previousNextIndex);
    const matchesRemaining = normalizedPrompts.length > 0 &&
        normalizedPrompts.length <= remainingPrompts.length &&
        normalizedPrompts.every((item, index) => sameCreativePromptIdentity(item, remainingPrompts[index]));

    if (!matchesRemaining) {
        return fallbackContext;
    }

    const baseCompleted = clampNumber(previousState.completed, 0, previousState.total);
    const total = Math.max(previousState.total, baseCompleted + normalizedPrompts.length, fallbackTotal);

    return {
        isResume: true,
        previousState,
        baseCompleted,
        baseSuccess: clampNumber(previousState.success, 0, total),
        baseFailed: clampNumber(previousState.failed, 0, total),
        baseSaved: clampNumber(previousState.saved, 0),
        total,
        outputTotal: Math.max(previousState.outputTotal || 0, total * outputQuantity)
    };
}

function normalizeInputPath(value) {
    if (typeof value !== 'string') {
        return '';
    }
    return value.replace(/["']/g, '').trim().replace(/\\/g, '/');
}

function listImageFilesInFolder(folderPath) {
    const normalizedFolderPath = normalizeInputPath(folderPath);
    if (!normalizedFolderPath || !fs.existsSync(normalizedFolderPath)) {
        return [];
    }

    const stats = fs.statSync(normalizedFolderPath);
    if (!stats.isDirectory()) {
        return [];
    }

    return sortNaturallyByName(fs.readdirSync(normalizedFolderPath))
        .filter(file => IMAGE_EXTENSIONS.includes(path.extname(file).toLowerCase()))
        .map(file => path.join(normalizedFolderPath, file));
}

function normalizeBrowserMode(value, fallback = 'headless') {
    if (value === 'headless' || value === 'headed') {
        return value;
    }
    return fallback === 'headed' ? 'headed' : 'headless';
}

function normalizeWorkflowConfigPayload(payload = {}) {
    return {
        browserMode: normalizeBrowserMode(
            payload.browserMode,
            appConfig.workflow?.browserMode || DEFAULT_WORKFLOW_CONFIG.browserMode
        )
    };
}

function normalizeResizeConfigPayload(payload = {}) {
    const inputFolder = normalizeInputPath(payload.inputFolder) || appConfig.resize.inputFolder || DEFAULT_RESIZE_CONFIG.inputFolder;
    const outputFolder = normalizeInputPath(payload.outputFolder) || appConfig.resize.outputFolder || DEFAULT_RESIZE_CONFIG.outputFolder;
    const browserMode = normalizeBrowserMode(
        payload.browserMode,
        appConfig.resize.browserMode || DEFAULT_RESIZE_CONFIG.browserMode
    );
    const promptTemplate = typeof payload.promptTemplate === 'string'
        ? payload.promptTemplate
        : (typeof payload.prompt === 'string' ? payload.prompt : appConfig.resize.promptTemplate || '');
    const generationSettings = normalizeLegilGenerationSettings(
        payload.generationSettings,
        appConfig.resize.generationSettings || DEFAULT_RESIZE_CONFIG.generationSettings
    );

    return {
        inputFolder,
        outputFolder,
        browserMode,
        promptTemplate,
        generationSettings
    };
}

function normalizeCreativeBrowserMode(value, fallback = 'headed') {
    return normalizeBrowserMode(value, fallback);
}

function normalizeCreativeConfigPayload(payload = {}) {
    const outputFolder = normalizeInputPath(payload.outputFolder) || appConfig.creative.outputFolder || DEFAULT_CREATIVE_CONFIG.outputFolder;
    const referenceFolder = normalizeInputPath(payload.referenceFolder);
    const browserMode = normalizeCreativeBrowserMode(
        payload.browserMode,
        appConfig.creative.browserMode || DEFAULT_CREATIVE_CONFIG.browserMode
    );
    const generationSettings = normalizeLegilGenerationSettings(
        payload.generationSettings,
        appConfig.creative.generationSettings || DEFAULT_CREATIVE_CONFIG.generationSettings
    );

    return {
        outputFolder,
        referenceFolder,
        browserMode,
        generationSettings
    };
}

function normalizeLegilGenerationSettings(settings = {}, fallback = {}) {
    const legilConfig = legilAutomation.getConfig();
    const options = legilConfig.options || {};
    const defaultSettings = legilConfig.defaultSettings || DEFAULT_RESIZE_CONFIG.generationSettings;
    const source = settings && typeof settings === 'object' ? settings : {};
    const fallbackSettings = fallback && typeof fallback === 'object' ? fallback : {};

    const imageModel = (options.imageModels || []).some(option => option.value === String(source.imageModel))
        ? String(source.imageModel)
        : ((options.imageModels || []).some(option => option.value === String(fallbackSettings.imageModel))
            ? String(fallbackSettings.imageModel)
            : defaultSettings.imageModel);
    const aspectRatio = (options.aspectRatios || []).includes(String(source.aspectRatio))
        ? String(source.aspectRatio)
        : ((options.aspectRatios || []).includes(String(fallbackSettings.aspectRatio))
            ? String(fallbackSettings.aspectRatio)
            : defaultSettings.aspectRatio);
    const resolution = (options.resolutions || []).includes(String(source.resolution))
        ? String(source.resolution)
        : ((options.resolutions || []).includes(String(fallbackSettings.resolution))
            ? String(fallbackSettings.resolution)
            : defaultSettings.resolution);
    const outputQuantityValue = Number(source.outputQuantity);
    const fallbackQuantityValue = Number(fallbackSettings.outputQuantity);
    const outputQuantity = (options.outputQuantities || []).includes(outputQuantityValue)
        ? outputQuantityValue
        : ((options.outputQuantities || []).includes(fallbackQuantityValue)
            ? fallbackQuantityValue
            : defaultSettings.outputQuantity);

    return {
        imageModel,
        aspectRatio,
        resolution,
        outputQuantity
    };
}

creativeResumeState = normalizeCreativeResumeState(persistedConfig.creativeResume);
if (creativeResumeState && ['queued', 'running', 'stopping'].includes(String(creativeResumeState.phase || ''))) {
    updateCreativeResumeState({
        phase: 'interrupted',
        currentAction: '服务器重启或任务被意外打断，可选择继续剩余创意拓展任务。'
    });
}

function chooseFolderWithNativeDialog(initialPath = '') {
    return new Promise((resolve, reject) => {
        const script = `
Add-Type -AssemblyName System.Windows.Forms
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = "请选择文件夹"
$dialog.ShowNewFolderButton = $true
if ($env:INITIAL_FOLDER_PATH -and (Test-Path -LiteralPath $env:INITIAL_FOLDER_PATH)) {
    $dialog.SelectedPath = $env:INITIAL_FOLDER_PATH
}
$result = $dialog.ShowDialog()
if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
    Write-Output $dialog.SelectedPath
    exit 0
}
exit 2
`;

        execFile(
            'powershell.exe',
            ['-NoProfile', '-STA', '-Command', script],
            {
                windowsHide: false,
                timeout: 10 * 60 * 1000,
                env: {
                    ...process.env,
                    INITIAL_FOLDER_PATH: typeof initialPath === 'string' ? initialPath.trim() : ''
                }
            },
            (error, stdout, stderr) => {
                if (error) {
                    if (error.code === 2) {
                        resolve({ cancelled: true, folderPath: '' });
                        return;
                    }
                    reject(new Error((stderr || error.message || '打开文件夹选择器失败').trim()));
                    return;
                }

                resolve({
                    cancelled: false,
                    folderPath: String(stdout || '').trim().split(/\r?\n/).filter(Boolean).pop() || ''
                });
            }
        );
    });
}

function isCreativeAgentTaskFinal(task) {
    return ['completed', 'failed', 'cancelled'].includes(String(task && task.phase || ''));
}

function cleanupCreativeAgentTasks() {
    const now = Date.now();
    for (const [runId, task] of creativeAgentTasks.entries()) {
        if (!isCreativeAgentTaskFinal(task)) {
            continue;
        }
        const updatedAt = Date.parse(task.updatedAt || task.completedAt || task.createdAt || '');
        if (Number.isFinite(updatedAt) && now - updatedAt > CREATIVE_AGENT_TASK_MAX_AGE_MS) {
            creativeAgentTasks.delete(runId);
        }
    }
}

function publicCreativeAgentTask(task, includeResult = false) {
    if (!task) {
        return null;
    }
    const result = task.result && typeof task.result === 'object' ? task.result : null;
    const promptCount = result && Array.isArray(result.prompts) ? result.prompts.length : 0;
    return {
        runId: task.runId,
        phase: task.phase,
        running: !isCreativeAgentTaskFinal(task),
        createdAt: task.createdAt,
        startedAt: task.startedAt,
        completedAt: task.completedAt,
        updatedAt: task.updatedAt,
        currentAction: task.currentAction,
        instructionPreview: task.instructionPreview,
        attachmentCount: task.attachmentCount,
        targetCount: task.targetCount,
        fileName: result ? result.fileName : '',
        promptCount,
        qualityReport: result ? result.qualityReport : null,
        message: task.message || (result ? result.message : ''),
        error: task.error || '',
        result: includeResult ? result : undefined
    };
}

function updateCreativeAgentTask(task, updates = {}) {
    Object.assign(task, updates, {
        updatedAt: new Date().toISOString()
    });
    return task;
}

function settleCreativeAgentTask(task, updates = {}) {
    if (!task || isCreativeAgentTaskFinal(task)) {
        return task;
    }
    if (task.worker) {
        task.worker.removeAllListeners();
        task.worker = null;
    }
    return updateCreativeAgentTask(task, {
        ...updates,
        completedAt: new Date().toISOString()
    });
}

function startCreativeAgentTask(payload) {
    cleanupCreativeAgentTasks();

    const runId = `creative_agent_${formatDateTimeForFile()}_${crypto.randomBytes(3).toString('hex')}`;
    const task = {
        runId,
        phase: 'queued',
        createdAt: new Date().toISOString(),
        startedAt: '',
        completedAt: '',
        updatedAt: new Date().toISOString(),
        currentAction: '创意拓展 Agent 已排队，准备读取资料...',
        instructionPreview: String(payload.instruction || '').slice(0, 160),
        attachmentCount: Array.isArray(payload.attachments) ? payload.attachments.length : 0,
        targetCount: payload.targetCount || null,
        message: '',
        error: '',
        result: null,
        worker: null,
        cancelRequested: false,
        redactionKey: String(payload.apiKey || '')
    };
    creativeAgentTasks.set(runId, task);

    setImmediate(() => {
        if (task.cancelRequested || isCreativeAgentTaskFinal(task)) {
            return;
        }

        updateCreativeAgentTask(task, {
            phase: 'running',
            startedAt: new Date().toISOString(),
            currentAction: '创意拓展 Agent 正在生成表格...'
        });

        const worker = new Worker(path.join(__dirname, 'creative-agent-worker.js'), {
            workerData: payload
        });
        task.worker = worker;

        worker.once('message', message => {
            if (task.cancelRequested) {
                settleCreativeAgentTask(task, {
                    phase: 'cancelled',
                    currentAction: '创意拓展 Agent 已取消',
                    message: '任务已取消'
                });
                return;
            }

            if (message && message.success) {
                const result = message.result || {};
                settleCreativeAgentTask(task, {
                    phase: 'completed',
                    result,
                    currentAction: `创意拓展 Agent 已完成：${result.fileName || '已生成表格'}`,
                    message: result.message || 'Agent 已完成'
                });
                logger.log(`创意拓展 Agent 已生成表格: ${result.fileName || ''}`, 'success');
                if (result.message) {
                    logger.info(result.message);
                }
                notifyTaskEvent({
                    level: 'info',
                    title: '创意拓展 Agent 已完成',
                    taskType: '创意拓展Agent',
                    message: result.fileName ? `已生成表格：${result.fileName}` : 'Agent 已完成',
                    extraLines: [`提示词数量：${Array.isArray(result.prompts) ? result.prompts.length : 0}`]
                }, {
                    key: `creative-agent-completed:${task.runId}`,
                    cooldownMs: 0
                });
                return;
            }

            const safeMessage = sanitizeCreativeAgentError(
                new Error((message && message.message) || '创意拓展 Agent 执行失败'),
                task.redactionKey
            );
            settleCreativeAgentTask(task, {
                phase: 'failed',
                currentAction: '创意拓展 Agent 调用失败',
                error: safeMessage,
                message: safeMessage
            });
            logger.error(`创意拓展 Agent 调用失败: ${safeMessage}`);
            notifyTaskEvent({
                level: 'error',
                title: '创意拓展 Agent 异常中断',
                taskType: '创意拓展Agent',
                message: safeMessage,
                suggestion: '可在创意拓展页面重新发起任务，或检查 Agent/API 配置。'
            }, {
                key: `creative-agent-failed:${task.runId}`,
                cooldownMs: 0
            });
        });

        worker.once('error', error => {
            const safeMessage = sanitizeCreativeAgentError(error, task.redactionKey);
            settleCreativeAgentTask(task, {
                phase: 'failed',
                currentAction: '创意拓展 Agent 调用失败',
                error: safeMessage,
                message: safeMessage
            });
            logger.error(`创意拓展 Agent 调用失败: ${safeMessage}`);
            notifyTaskEvent({
                level: 'error',
                title: '创意拓展 Agent 异常中断',
                taskType: '创意拓展Agent',
                message: safeMessage,
                suggestion: '可在创意拓展页面重新发起任务，或检查 Agent/API 配置。'
            }, {
                key: `creative-agent-error:${task.runId}`,
                cooldownMs: 0
            });
        });

        worker.once('exit', code => {
            if (code !== 0 && !isCreativeAgentTaskFinal(task)) {
                const safeMessage = `创意拓展 Agent worker 已退出，退出码 ${code}`;
                settleCreativeAgentTask(task, {
                    phase: 'failed',
                    currentAction: '创意拓展 Agent 已异常退出',
                    error: safeMessage,
                    message: safeMessage
                });
                logger.error(safeMessage);
                notifyTaskEvent({
                    level: 'error',
                    title: '创意拓展 Agent 异常退出',
                    taskType: '创意拓展Agent',
                    message: safeMessage,
                    suggestion: '可重新发起任务，或查看服务器日志。'
                }, {
                    key: `creative-agent-exit:${task.runId}`,
                    cooldownMs: 0
                });
            }
        });
    });

    return task;
}

function getCreativeAgentTask(runId) {
    cleanupCreativeAgentTasks();
    return creativeAgentTasks.get(String(runId || '')) || null;
}

function cancelCreativeAgentTask(task) {
    if (!task) {
        return { success: false, message: '任务不存在或已过期' };
    }
    if (isCreativeAgentTaskFinal(task)) {
        return { success: true, message: '任务已经结束', task: publicCreativeAgentTask(task) };
    }

    task.cancelRequested = true;
    if (task.worker) {
        task.worker.terminate().catch(() => {});
    }
    settleCreativeAgentTask(task, {
        phase: 'cancelled',
        currentAction: '创意拓展 Agent 已取消',
        message: '任务已取消'
    });
    logger.warn(`创意拓展 Agent 任务已取消: ${task.runId}`);
    notifyTaskEvent({
        level: 'warning',
        title: '创意拓展 Agent 已取消',
        taskType: '创意拓展Agent',
        message: '任务已取消。'
    }, {
        key: `creative-agent-cancelled:${task.runId}`,
        cooldownMs: 0
    });
    return { success: true, message: '已取消创意拓展 Agent 任务', task: publicCreativeAgentTask(task) };
}

function hasActiveCreativeAgentTask() {
    return Array.from(creativeAgentTasks.values()).some(task => !isCreativeAgentTaskFinal(task));
}

function isLegilBusy() {
    return automationState.legilTaskRunning || workflowController.isRunning;
}

function isLegilStopRequested() {
    return automationState.legilStopRequested === true;
}

function requestLegilTaskStop() {
    if (!automationState.legilTaskRunning) {
        return {
            success: true,
            message: '当前没有正在运行的 Legil 任务'
        };
    }

    if (!['resize-batch', 'creative-batch'].includes(automationState.legilTaskType)) {
        return {
            success: false,
            message: '当前运行的任务不能从这里停止，请在对应功能区停止'
        };
    }

    automationState.legilStopRequested = true;
    const taskLabel = automationState.legilTaskType === 'creative-batch' ? '创意拓展' : '改尺寸';
    if (automationState.legilTaskProgress) {
        automationState.legilTaskProgress = {
            ...automationState.legilTaskProgress,
            phase: 'stopping',
            currentAction: `正在停止${taskLabel}任务...`,
            updatedAt: new Date().toISOString()
        };
    }
    if (automationState.legilTaskType === 'creative-batch') {
        updateCreativeResumeState({
            phase: 'stopping',
            currentAction: `正在停止${taskLabel}任务...`
        });
    }
    logger.system(`⏹️ 已收到停止${taskLabel}任务指令，正在安全停止...`);
    notifyTaskEvent({
        level: 'warning',
        title: `${taskLabel}任务收到停止指令`,
        taskType: taskLabel,
        progress: compactProgress(getHealthSnapshot()),
        message: '已发送停止指令，当前步骤结束后会安全停止。',
        suggestion: '可发送“进度”查看停止进展。'
    }, {
        key: `legil-stop-request:${automationState.legilTaskType}:${Date.now()}`,
        cooldownMs: 0
    });

    return {
        success: true,
        message: '已发送停止指令，当前步骤结束后会停止'
    };
}

function waitForPromise(promise, timeoutMs = 1500) {
    return Promise.race([
        promise,
        new Promise(resolve => setTimeout(resolve, timeoutMs))
    ]).catch(() => null);
}

function buildRestartHelperScript(startDelayMs) {
    const serverPath = __filename;
    const serverDir = __dirname;
    const nodePath = process.execPath;
    const outPath = path.join(__dirname, 'server-runtime.log');
    const errPath = path.join(__dirname, 'server-runtime.err.log');

    return `
const { spawn } = require('child_process');
const fs = require('fs');
const nodePath = ${JSON.stringify(nodePath)};
const serverPath = ${JSON.stringify(serverPath)};
const serverDir = ${JSON.stringify(serverDir)};
const outPath = ${JSON.stringify(outPath)};
const errPath = ${JSON.stringify(errPath)};
setTimeout(() => {
  try {
    const out = fs.openSync(outPath, 'a');
    const err = fs.openSync(errPath, 'a');
    const child = spawn(nodePath, [serverPath], {
      cwd: serverDir,
      detached: true,
      windowsHide: true,
      stdio: ['ignore', out, err],
      env: {
        ...process.env,
        AI_IMAGE_AUTOMATION_RESTARTED_AT: new Date().toISOString()
      }
    });
    child.unref();
  } catch (error) {
    try {
      fs.appendFileSync(errPath, '[restart-helper] ' + (error && error.stack || error) + '\\n');
    } catch (_) {}
  }
}, ${Math.max(1000, Number(startDelayMs) || 5000)});
`;
}

function scheduleLocalServerRestart(options = {}) {
    if (serverRestartScheduled) {
        return {
            success: true,
            message: '服务器已经在重启队列中，请稍等。'
        };
    }

    const delayMs = clampNumber(options.delayMs, 1500, 15000);
    const helperDelayMs = delayMs + 4500;
    const reason = String(options.reason || '本机请求').trim() || '本机请求';
    serverRestartScheduled = true;

    const helper = spawn(process.execPath, ['-e', buildRestartHelperScript(helperDelayMs)], {
        cwd: __dirname,
        detached: true,
        windowsHide: true,
        stdio: 'ignore'
    });
    helper.unref();

    setTimeout(async () => {
        logger.system(`正在重启服务器：${reason}`);
        await waitForPromise(feishuCliBridge.stop(), 1500);
        await waitForPromise(browserController.closeBrowser(), 1500);
        process.exit(0);
    }, delayMs).unref();

    return {
        success: true,
        message: `已安排服务器重启，约 ${Math.ceil((delayMs + 4500) / 1000)} 秒后恢复在线。`
    };
}

async function sleepWithLegilStop(ms) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < ms) {
        if (isLegilStopRequested()) {
            throw new Error('操作已取消');
        }
        await new Promise(resolve => setTimeout(resolve, Math.min(500, ms - (Date.now() - startedAt))));
    }
}

function toPositiveIndex(value, fallback = 1) {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue) || numberValue < 1) {
        return fallback;
    }
    return Math.floor(numberValue);
}

function persistRuntimeConfig(extra = {}) {
    const doubaoConfig = doubaoAutomation.getConfig();
    return updateConfig({
        legilReferenceFolder: appConfig.legilReferenceFolder,
        resize: {
            ...appConfig.resize
        },
        workflow: {
            ...appConfig.workflow
        },
        notifications: {
            ...appConfig.notifications
        },
        creative: {
            ...appConfig.creative
        },
        doubao: {
            promptTemplate: doubaoConfig.promptTemplate,
            modelId: doubaoConfig.modelId,
            baseUrl: doubaoConfig.baseUrl
        },
        legil: {
            ...legilAutomation.getConfig().settings
        },
        ...extra
    });
}

function parseCsvConfig(value) {
    return String(value || '')
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);
}

function getFeishuConfig() {
    const secrets = readSecrets();
    const allowedChatIds = parseCsvConfig(process.env.FEISHU_ALLOWED_CHAT_IDS || secrets.feishuAllowedChatIds);
    return {
        verificationToken: String(process.env.FEISHU_VERIFICATION_TOKEN || secrets.feishuVerificationToken || '').trim(),
        botWebhookUrl: String(process.env.FEISHU_BOT_WEBHOOK_URL || secrets.feishuBotWebhookUrl || '').trim(),
        botSecret: String(process.env.FEISHU_BOT_SECRET || secrets.feishuBotSecret || '').trim(),
        allowedChatIds
    };
}

function buildFeishuBotSignature(timestamp, secret) {
    const stringToSign = `${timestamp}\n${secret}`;
    return crypto.createHmac('sha256', stringToSign).update('').digest('base64');
}

async function sendFeishuText(text) {
    const config = getFeishuConfig();
    if (!config.botWebhookUrl) {
        return {
            success: false,
            message: '未配置飞书机器人 webhook，无法主动发送消息',
            text
        };
    }

    const payload = {
        msg_type: 'text',
        content: {
            text: String(text || '').slice(0, 12000)
        }
    };

    if (config.botSecret) {
        const timestamp = Math.floor(Date.now() / 1000);
        payload.timestamp = timestamp;
        payload.sign = buildFeishuBotSignature(timestamp, config.botSecret);
    }

    const response = await axios.post(config.botWebhookUrl, payload, {
        timeout: 15000,
        headers: {
            'Content-Type': 'application/json'
        }
    });

    return {
        success: true,
        data: response.data
    };
}

function getCreativeAgentTaskSnapshot() {
    cleanupCreativeAgentTasks();
    const tasks = Array.from(creativeAgentTasks.values()).map(task => publicCreativeAgentTask(task));
    const activeTasks = tasks.filter(task => task && task.running);
    return {
        success: true,
        running: activeTasks.length > 0,
        runningCount: activeTasks.length,
        recent: tasks
            .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
            .slice(0, 5)
    };
}

function readWatchdogStatus() {
    try {
        if (!fs.existsSync(WATCHDOG_STATUS_PATH)) {
            return {
                configured: true,
                running: false,
                message: '守护监控尚未写入状态'
            };
        }
        return JSON.parse(fs.readFileSync(WATCHDOG_STATUS_PATH, 'utf8'));
    } catch (error) {
        return {
            configured: true,
            running: false,
            message: '读取守护监控状态失败：' + error.message
        };
    }
}

function ensureFeishuWatchdogProcess(reason = 'server-start') {
    if (String(process.env.WATCHDOG_AUTO_START || '').toLowerCase() === 'false') {
        return {
            success: false,
            skipped: true,
            message: 'WATCHDOG_AUTO_START=false，已跳过守护监控自动启动'
        };
    }

    if (watchdogStartAttempted && reason !== 'manual') {
        return {
            success: true,
            skipped: true,
            message: '守护监控已尝试启动'
        };
    }

    watchdogStartAttempted = true;
    try {
        const child = spawn(process.execPath, [WATCHDOG_SCRIPT_PATH], {
            cwd: __dirname,
            detached: true,
            stdio: 'ignore',
            windowsHide: true,
            env: {
                ...process.env,
                WATCHDOG_TARGET_URL: process.env.WATCHDOG_TARGET_URL || `http://127.0.0.1:${PORT}/api/health`
            }
        });
        child.unref();
        return {
            success: true,
            pid: child.pid,
            message: '飞书守护监控已启动'
        };
    } catch (error) {
        logger.warn('飞书守护监控启动失败: ' + error.message);
        return {
            success: false,
            message: '飞书守护监控启动失败：' + error.message
        };
    }
}

function getHealthSnapshot() {
    const workflowStatus = workflowController.getStatus();
    const workflowResume = workflowController.getResumeInfo();
    const creativeResume = getCreativeResumeInfo(false);
    const creativeProgress = getCreativeProgressSnapshot();
    const legilProgress = creativeProgress.progress || automationState.legilTaskProgress || {};
    const feishuStatus = feishuCliBridge.getStatus();
    const browserStatus = {
        browserRunning: !!browserController.browser,
        pages: {
            doubao: browserController.isPageOpen('doubao'),
            legil: browserController.isPageOpen('legil')
        }
    };

    return {
        success: true,
        server: {
            running: true,
            startedAt: serverStartedAt,
            uptimeSeconds: Math.floor(process.uptime()),
            port: PORT
        },
        feishu: {
            running: feishuStatus.running,
            ready: feishuStatus.ready,
            consumerMode: feishuStatus.consumerMode,
            cardActionReady: feishuStatus.cardActionReady,
            lastError: feishuStatus.lastError || '',
            reconnectAttempts: feishuStatus.reconnectAttempts || 0
        },
        workflow: {
            success: true,
            status: workflowStatus
        },
        workflowResume: {
            success: true,
            resume: workflowResume
        },
        legil: {
            success: true,
            running: automationState.legilTaskRunning,
            stopRequested: automationState.legilStopRequested,
            taskType: automationState.legilTaskType,
            progress: legilProgress,
            workflowRunning: workflowController.isRunning
        },
        creativeResume: {
            success: true,
            resume: creativeResume
        },
        creativeProgress,
        creativeAgent: getCreativeAgentTaskSnapshot(),
        watchdog: readWatchdogStatus(),
        browser: {
            success: true,
            status: browserStatus
        }
    };
}

function notifyTaskEvent(payload, options = {}) {
    const notifications = appConfig.notifications || DEFAULT_NOTIFICATION_CONFIG;
    if (!notifications.feishuEnabled) {
        return;
    }
    if (options.category === 'completion' && !notifications.taskCompletionEnabled) {
        return;
    }
    if (options.category === 'startup' && !notifications.serverStartupEnabled) {
        return;
    }
    if (options.category === 'stale' && !notifications.staleProgressEnabled) {
        return;
    }
    feishuNotifier.notifySoon(payload, options);
}

function notifyWorkflowResult(result, context = {}) {
    const status = workflowController.getStatus();
    const stats = result && result.stats ? result.stats : (status.stats || {});
    const progress = `图片 ${stats.processed || 0}/${result && result.totalImages || status.totalImages || 0}，失败 ${stats.failed || 0}，已生成 ${stats.totalGenerated || 0}`;
    const message = result && result.message ? result.message : '';
    const stopped = /停止|取消/.test(message);
    const success = Boolean(result && result.success);

    notifyTaskEvent({
        level: success ? 'info' : (stopped ? 'warning' : 'error'),
        title: success ? '工作流已完成' : (stopped ? '工作流已停止' : '工作流异常中断'),
        taskType: '量产工作流',
        progress,
        message: message || (success ? '任务已完成' : '任务未完成'),
        suggestion: stopped || !success ? '可发送“继续任务”尝试继续，或发送“进度”查看详情。' : '',
        extraLines: context.source ? [`来源：${context.source}`] : []
    }, {
        key: `workflow-result:${success ? 'completed' : stopped ? 'stopped' : 'error'}:${message}`,
        category: success ? 'completion' : 'abnormal',
        cooldownMs: stopped ? 0 : undefined
    });
}

function notifyLegilResult(taskType, result = {}) {
    const progress = automationState.legilTaskProgress || {};
    const stopped = progress.phase === 'stopped' || /停止|取消/.test(String(result.message || progress.currentAction || ''));
    const interrupted = progress.phase === 'interrupted' || result.interrupted;
    const completed = !stopped && !interrupted;
    const taskLabel = taskType === 'creative-batch'
        ? '创意拓展产图'
        : (taskType === 'resize-batch' ? '批量改尺寸' : 'Legil批量生成');

    notifyTaskEvent({
        level: completed ? 'info' : (stopped ? 'warning' : 'error'),
        title: completed ? `${taskLabel}已完成` : (stopped ? `${taskLabel}已停止` : `${taskLabel}异常中断`),
        taskType: taskLabel,
        progress: `Legil ${progress.completed || progress.currentIndex || 0}/${progress.total || 0}，成功/失败/保存 ${progress.success || result.successCount || 0}/${progress.failed || result.failedCount || 0}/${progress.saved || 0}`,
        message: result.message || progress.currentAction || '',
        suggestion: completed ? '' : '可发送“进度”查看详情；若存在可恢复任务，可发送“继续任务”。'
    }, {
        key: `legil-result:${taskType}:${completed ? 'completed' : stopped ? 'stopped' : 'interrupted'}:${result.message || ''}`,
        category: completed ? 'completion' : 'abnormal',
        cooldownMs: stopped ? 0 : undefined
    });
}

function notifyLegilException(event = {}) {
    const notifications = appConfig.notifications || DEFAULT_NOTIFICATION_CONFIG;
    if (!notifications.feishuEnabled || !notifications.legilScreenshotEnabled) {
        return;
    }

    const extraLines = [];
    if (event.referenceImageName) extraLines.push(`对象：${event.referenceImageName}`);
    if (event.promptIndex) extraLines.push(`提示词序号：${event.promptIndex}`);
    if (event.screenshotPath) extraLines.push(`截图：${event.screenshotPath}`);

    notifyTaskEvent({
        level: 'error',
        title: 'Legil 页面异常截图',
        taskType: event.taskType || 'Legil自动化',
        stage: event.stage || '',
        message: event.message || 'Legil 页面执行异常',
        suggestion: notifications.autoRecoveryEnabled ? '系统会按策略自动恢复一次；如连续失败达到阈值，将暂停任务等待确认。' : '请检查 Legil 页面状态后再继续任务。',
        screenshotPath: event.screenshotPath || '',
        extraLines
    }, {
        key: `legil-exception:${event.stage || 'unknown'}:${event.message || ''}`,
        cooldownMs: 0
    });
}

legilAutomation.on('legil-exception', notifyLegilException);

function getLegilRecoveryOptions() {
    const notifications = appConfig.notifications || DEFAULT_NOTIFICATION_CONFIG;
    return {
        autoRecoveryEnabled: notifications.autoRecoveryEnabled,
        captureErrorScreenshot: notifications.legilScreenshotEnabled,
        pauseOnConsecutiveFailures: notifications.pauseOnConsecutiveFailures,
        consecutiveFailureThreshold: notifications.consecutiveFailureThreshold
    };
}

function applyNotificationRuntimeConfig() {
    const notifications = appConfig.notifications || DEFAULT_NOTIFICATION_CONFIG;
    feishuNotifier.configure({
        enabled: notifications.feishuEnabled,
        cooldownMs: notifications.notificationCooldownMinutes * 60 * 1000
    });
    if (healthMonitor) {
        const warningMs = notifications.staleThresholdMinutes * 60 * 1000;
        healthMonitor.configure({
            staleWarningMs: warningMs,
            staleErrorMs: Math.max(warningMs * 2, warningMs + 60 * 1000),
            shouldNotifyStale: () => Boolean(appConfig.notifications.staleProgressEnabled && appConfig.notifications.feishuEnabled)
        });
    }
}

function verifyFeishuEventToken(body) {
    const config = getFeishuConfig();
    if (!config.verificationToken) {
        return {
            success: true
        };
    }

    const token = String((body && (body.token || (body.header && body.header.token))) || '').trim();
    if (token !== config.verificationToken) {
        return {
            success: false,
            message: '飞书事件 token 校验失败'
        };
    }

    return {
        success: true
    };
}

function extractFeishuCommandText(body) {
    const event = body && body.event ? body.event : {};
    const message = event.message || {};
    const messageType = String(message.message_type || '').toLowerCase();
    const rawContent = typeof message.content === 'string' ? message.content : '';

    try {
        const parsed = rawContent ? JSON.parse(rawContent) : {};
        if (messageType === 'text' && typeof parsed.text === 'string') {
            return parsed.text;
        }
        if (messageType === 'post' && parsed.post) {
            const zh = parsed.post.zh_cn || parsed.post.en_us || Object.values(parsed.post)[0] || {};
            const blocks = Array.isArray(zh.content) ? zh.content : [];
            return blocks
                .flatMap(row => Array.isArray(row) ? row : [])
                .map(item => item && (item.text || item.name || ''))
                .filter(Boolean)
                .join(' ');
        }
        if (typeof parsed.text === 'string') {
            return parsed.text;
        }
    } catch {
        return rawContent;
    }

    return '';
}

function normalizeFeishuCommandText(text) {
    return String(text || '')
        .replace(/<at[^>]*>.*?<\/at>/g, '')
        .replace(/@\S+/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function assertFeishuChatAllowed(body) {
    const config = getFeishuConfig();
    if (!config.allowedChatIds.length) {
        return {
            success: true
        };
    }

    const chatId = String(body && body.event && body.event.message && body.event.message.chat_id || '').trim();
    if (config.allowedChatIds.includes(chatId)) {
        return {
            success: true
        };
    }

    return {
        success: false,
        message: '这个飞书会话不在允许控制列表中'
    };
}

function getPhaseLabel(phase) {
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

function buildPlatformStatusText() {
    const workflowStatus = workflowController.getStatus();
    const workflowDetail = workflowStatus.currentStatus || {};
    const workflowResume = workflowController.getResumeInfo();
    const creativeResume = getCreativeResumeInfo(false);
    const creativeProgressSnapshot = getCreativeProgressSnapshot();
    const legilProgress = creativeProgressSnapshot.progress || automationState.legilTaskProgress || {};
    const browserStatus = {
        running: !!browserController.browser,
        legil: browserController.isPageOpen('legil')
    };

    const lines = [
        '自动化平台状态',
        `完整工作流：${workflowStatus.isRunning ? '运行中' : '未运行'}${workflowStatus.progress ? `，进度 ${workflowStatus.progress}%` : ''}`,
        `当前动作：${workflowDetail.currentAction || '暂无'}`,
        `图片进度：${workflowStatus.stats.processed || 0}/${workflowStatus.totalImages || 0}，失败 ${workflowStatus.stats.failed || 0}，已生成 ${workflowStatus.stats.totalGenerated || 0}`,
        `Legil任务：${automationState.legilTaskRunning ? '运行中' : '未运行'}${automationState.legilTaskType ? `（${automationState.legilTaskType}）` : ''}`,
        `Legil进度：${legilProgress.completed || 0}/${legilProgress.total || 0}，成功 ${legilProgress.success || 0}，失败 ${legilProgress.failed || 0}，已保存 ${legilProgress.saved || 0}`,
        `Legil动作：${legilProgress.currentAction || '暂无'}`,
        `完整工作流可继续：${workflowResume.hasResume ? `是，第 ${workflowResume.imageIndex}/${workflowResume.totalImages} 张，提示词 ${workflowResume.promptIndex}/${workflowResume.totalPrompts}` : '否'}`,
        `创意拓展可继续：${creativeResume.hasResume ? `是，剩余 ${creativeResume.remainingCount}/${creativeResume.total} 组` : '否'}`,
        `浏览器：${browserStatus.running ? '运行中' : '未启动'}，Legil页面：${browserStatus.legil ? '已打开' : '未打开'}`
    ];

    return lines.join('\n');
}

async function startWorkflowFromCurrentConfig(options = {}) {
    if (automationState.legilTaskRunning) {
        return {
            success: false,
            message: '当前已有 Legil 生成任务正在运行，请稍后再启动完整工作流'
        };
    }
    if (workflowController.isRunning) {
        return {
            success: false,
            message: '完整工作流正在运行中'
        };
    }

    if (options.clearResume) {
        workflowController.clearResume();
    }

    const legilRefFolder = appConfig.legilReferenceFolder;
    const validation = workflowController.validateStart(
        workflowController.inputFolder,
        workflowController.outputFolder,
        legilRefFolder
    );
    if (!validation.success) {
        return validation;
    }

    const doubaoConfig = doubaoAutomation.getConfig();
    if (!doubaoConfig.apiKeyConfigured || !doubaoConfig.modelId) {
        return {
            success: false,
            message: '请先在豆包API配置中填写火山方舟 API Key 和模型 ID / Endpoint ID'
        };
    }

    setImmediate(async () => {
        try {
            appConfig.workflow = normalizeWorkflowConfigPayload(appConfig.workflow);
            const result = await workflowController.startWorkflow(
                validation.inputFolder,
                validation.outputFolder,
                validation.legilReferenceFolder,
                {
                    browserMode: appConfig.workflow.browserMode,
                    ...getLegilRecoveryOptions()
                }
            );
            notifyWorkflowResult(result, { source: '飞书开始量产' });
            await sendFeishuText(`完整工作流执行结束：${result.message || (result.success ? '已完成' : '未完成')}`);
        } catch (error) {
            logger.error('飞书启动的完整工作流执行出错: ' + error.message);
            notifyTaskEvent({
                level: 'error',
                title: '飞书启动工作流出错',
                taskType: '量产工作流',
                progress: compactProgress(getHealthSnapshot()),
                message: error.message,
                suggestion: '可发送“状态”检查平台状态。'
            }, {
                key: `workflow-feishu-start-error:${error.message}`,
                cooldownMs: 0
            });
            await sendFeishuText(`完整工作流执行出错：${error.message}`).catch(() => {});
        }
    });

    return {
        success: true,
        message: `已启动完整工作流，将处理 ${validation.totalImages} 张参考图`
    };
}

async function resumeWorkflowFromFeishu() {
    if (automationState.legilTaskRunning) {
        return {
            success: false,
            message: '当前已有 Legil 生成任务正在运行，不能继续完整工作流'
        };
    }
    if (workflowController.isRunning) {
        return {
            success: false,
            message: '完整工作流已经在运行中'
        };
    }

    const resumeInfo = workflowController.getResumeInfo();
    if (!resumeInfo.hasResume) {
        return {
            success: false,
            message: '没有可继续的完整工作流任务'
        };
    }

    setImmediate(async () => {
        try {
            const result = await workflowController.resumeWorkflow(getLegilRecoveryOptions());
            notifyWorkflowResult(result, { source: '飞书继续任务' });
            await sendFeishuText(`完整工作流继续执行结束：${result.message || (result.success ? '已完成' : '未完成')}`);
        } catch (error) {
            logger.error('飞书继续完整工作流出错: ' + error.message);
            notifyTaskEvent({
                level: 'error',
                title: '飞书继续工作流出错',
                taskType: '量产工作流',
                progress: compactProgress(getHealthSnapshot()),
                message: error.message,
                suggestion: '可发送“状态”检查平台状态。'
            }, {
                key: `workflow-feishu-resume-error:${error.message}`,
                cooldownMs: 0
            });
            await sendFeishuText(`完整工作流继续执行出错：${error.message}`).catch(() => {});
        }
    });

    return {
        success: true,
        message: `已继续完整工作流：第 ${resumeInfo.imageIndex}/${resumeInfo.totalImages} 张，提示词 ${resumeInfo.promptIndex}/${resumeInfo.totalPrompts}`
    };
}

async function startCreativeResumeFromFeishu(options = {}) {
    if (isLegilBusy()) {
        return {
            success: false,
            message: '当前已有自动化任务正在运行，请稍后再继续创意拓展'
        };
    }

    const resumeInfo = getCreativeResumeInfo(true);
    if (!resumeInfo.hasResume || !Array.isArray(resumeInfo.prompts)) {
        return {
            success: false,
            message: '没有可继续的创意拓展任务'
        };
    }

    const prompts = options.restart
        ? resumeInfo.prompts
        : resumeInfo.prompts.filter(item => item && item.selected !== false);
    if (prompts.length === 0) {
        return {
            success: false,
            message: '创意拓展恢复状态里没有剩余提示词'
        };
    }

    const response = await axios.post(`http://127.0.0.1:${PORT}/api/legil/creative-batch`, {
        outputFolder: resumeInfo.outputFolder,
        referenceFolder: resumeInfo.referenceFolder || '',
        prompts,
        tableFileName: resumeInfo.tableFileName || '飞书继续创意拓展任务',
        browserMode: resumeInfo.browserMode,
        generationSettings: resumeInfo.generationSettings,
        resumeMode: true,
        resumeRunId: resumeInfo.runId
    }, {
        timeout: 15000,
        headers: {
            'Content-Type': 'application/json'
        }
    });

    return {
        success: Boolean(response.data && response.data.success),
        message: response.data && response.data.message
            ? response.data.message
            : `已${options.restart ? '重启' : '继续'}创意拓展任务，共 ${prompts.length} 组提示词`
    };
}

async function stopAutomationFromFeishu() {
    if (workflowController.isRunning) {
        return await workflowController.stopWorkflow();
    }

    if (automationState.legilTaskRunning) {
        return requestLegilTaskStop();
    }

    return {
        success: true,
        message: '当前没有正在运行的工作流或 Legil 任务'
    };
}

async function resumeAutomationFromFeishu(commandText) {
    const wantsCreative = /创意|creative/i.test(commandText);
    const creativeResume = getCreativeResumeInfo(true);
    const workflowResume = workflowController.getResumeInfo();

    if (wantsCreative && creativeResume.hasResume) {
        return await startCreativeResumeFromFeishu();
    }
    if (workflowResume.hasResume) {
        return await resumeWorkflowFromFeishu();
    }
    if (creativeResume.hasResume) {
        return await startCreativeResumeFromFeishu();
    }

    return {
        success: false,
        message: '没有可继续的任务'
    };
}

async function restartAutomationFromFeishu(commandText) {
    if (workflowController.isRunning) {
        const result = await workflowController.stopWorkflow();
        return {
            success: result.success,
            message: `${result.message}。完整工作流已发送停止指令，停止完成后可再次发送“重启工作流”。`
        };
    }
    if (automationState.legilTaskRunning) {
        const result = requestLegilTaskStop();
        return {
            success: result.success,
            message: `${result.message}。当前 Legil 任务停止完成后可再次发送“重启工作流”。`
        };
    }

    const wantsCreative = /创意|creative/i.test(commandText);
    const creativeResume = getCreativeResumeInfo(true);
    if (wantsCreative || creativeResume.hasResume) {
        return await startCreativeResumeFromFeishu({ restart: true });
    }

    return await startWorkflowFromCurrentConfig({ clearResume: true });
}

function buildFeishuHelpText() {
    return [
        '飞书可用指令：',
        '状态 / 工作状态：查看完整工作流、Legil任务、浏览器和可继续任务',
        '进度 / 工作进度：发送当前进度报告',
        '停止工作流：停止正在运行的完整工作流或 Legil 批量任务',
        '继续工作流：优先继续完整工作流；如果没有，则继续创意拓展剩余任务',
        '继续创意拓展：只继续创意拓展剩余提示词',
        '重启工作流：无运行任务时从当前默认路径重新启动；如果有创意拓展恢复状态，则重启该创意拓展任务',
        '帮助：查看本说明'
    ].join('\n');
}

async function executeFeishuCommand(rawText) {
    const commandText = normalizeFeishuCommandText(rawText);
    if (!commandText) {
        return '';
    }

    if (/帮助|help|指令/.test(commandText)) {
        return buildFeishuHelpText();
    }
    if (/停止|stop/i.test(commandText)) {
        const result = await stopAutomationFromFeishu();
        return `停止指令结果：${result.message}`;
    }
    if (/继续|恢复|resume/i.test(commandText)) {
        const result = await resumeAutomationFromFeishu(commandText);
        return `继续指令结果：${result.message}`;
    }
    if (/重启|重新开始|restart/i.test(commandText)) {
        const result = await restartAutomationFromFeishu(commandText);
        return `重启指令结果：${result.message}`;
    }
    if (/状态|进度|检查|status|progress/i.test(commandText)) {
        return buildPlatformStatusText();
    }

    return `未识别指令：“${commandText}”\n\n${buildFeishuHelpText()}`;
}

async function handleFeishuEvent(body) {
    const allowed = assertFeishuChatAllowed(body);
    if (!allowed.success) {
        return allowed.message;
    }

    const cardActionResult = await handleFeishuCardActionEvent(body);
    if (cardActionResult !== null) {
        return cardActionResult;
    }

    const text = extractFeishuCommandText(body);
    if (!text) {
        return '';
    }

    return await executeFeishuCommand(text);
}

async function handleFeishuCardActionEvent(body) {
    const eventType = String(body && (body.type || body.event_type || (body.header && body.header.event_type)) || '').trim();
    const event = body && body.event ? body.event : {};
    const isCardAction = eventType === 'card.action.trigger' ||
        Boolean(event.action && (event.context || event.open_message_id || event.open_chat_id));
    if (!isCardAction) {
        return null;
    }

    const action = event.action || {};
    const rawValue = action.value;
    let value = {};
    if (rawValue && typeof rawValue === 'object') {
        value = rawValue;
    } else if (typeof rawValue === 'string' && rawValue.trim()) {
        try {
            const parsed = JSON.parse(rawValue);
            if (parsed && typeof parsed === 'object') {
                value = parsed;
            }
        } catch {}
    }

    const config = readFeishuCliConfig();
    const actionName = String(value.action || '').trim();
    const token = String(value.token || '').trim();
    const chatId = String(
        value.chatId ||
        value.chat_id ||
        (event.context && event.context.open_chat_id) ||
        event.open_chat_id ||
        config.notifyChatId ||
        ''
    ).trim();

    if (!actionName) {
        return '飞书卡片按钮缺少 action，未执行。';
    }

    if (!config.cardActionToken || token !== config.cardActionToken) {
        return '飞书卡片按钮 token 无效，请重新发送控制面板卡片。';
    }

    if (config.allowedChatIds.length && chatId && !config.allowedChatIds.includes(chatId)) {
        return '';
    }

    const actionLabel = CARD_ACTIONS[actionName] ? CARD_ACTIONS[actionName].label : actionName;
    const controlService = new FeishuControlService({
        apiBaseUrl: config.controlApiBaseUrl,
        timeoutMs: config.sendTimeoutMs
    });
    const result = await controlService.executeControlAction(actionName);
    const success = result && result.success !== false;
    const message = result && result.message ? result.message : (success ? '已执行' : '执行失败');
    return `按钮执行：${actionLabel}\n${message}`;
}

// 创建 express 应用实例
const app = express();

// 设置服务器端口
const PORT = Number(process.env.PORT) || 3066;

/**
 * 配置中间件
 */
app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
        return res.status(400).json({
            success: false,
            message: '请求 JSON 格式不正确'
        });
    }
    next(err);
});

/**
 * 主页路由
 */
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/**
 * ============================================
 * API 接口：统计文件夹中的图片数量（第二阶段）
 * ============================================
 */
app.post('/api/count-images', (req, res) => {
    const { folderPath } = req.body;

    // 发送日志到前端
    logger.system('收到统计图片请求');
    logger.info('路径: ' + folderPath);

    console.log('\n📂 收到统计图片请求');
    console.log('   路径:', folderPath);

    if (typeof folderPath !== 'string' || !folderPath.trim()) {
        console.log('   ❌ 错误：未提供路径');
        return res.json({
            success: false,
            count: 0,
            message: '请提供文件夹路径'
        });
    }

    // 规范化路径：去除引号、trim，并统一使用正斜杠（兼容Windows）
    let normalizedPath = normalizeInputPath(folderPath);

    try {
        if (!fs.existsSync(normalizedPath)) {
            console.log('   ❌ 错误：路径不存在');
            return res.json({
                success: false,
                count: 0,
                message: '路径不存在，请检查路径是否正确'
            });
        }

        const stats = fs.statSync(normalizedPath);
        if (!stats.isDirectory()) {
            console.log('   ❌ 错误：这不是文件夹');
            return res.json({
                success: false,
                count: 0,
                message: '提供的路径不是文件夹'
            });
        }

        const files = fs.readdirSync(normalizedPath);
        console.log('   📋 文件夹内容:', files);

        const imageFiles = sortNaturallyByName(files).filter(file => {
            const ext = path.extname(file).toLowerCase();
            return IMAGE_EXTENSIONS.includes(ext);
        });

        console.log('   🖼️  图片文件:', imageFiles);
        console.log('   ✅ 统计完成，共', imageFiles.length, '张图片\n');

        res.json({
            success: true,
            count: imageFiles.length,
            files: imageFiles,
            message: `成功找到 ${imageFiles.length} 张参考图`
        });

    } catch (error) {
        console.log('   ❌ 错误:', error.message);
        res.json({
            success: false,
            count: 0,
            message: '读取文件夹时出错：' + error.message
        });
    }
});

/**
 * ============================================
 * 新增 API 接口：打开单个网站（第三阶段）
 * ============================================
 *
 * 请求方法：POST
 * 请求路径：/api/open-website
 * 请求参数：{ name: "网站标识", url: "网站地址" }
 * 返回数据：{ success: true/false, message: "提示信息" }
 */
app.post('/api/select-folder', async (req, res) => {
    const { currentPath } = req.body || {};

    try {
        const result = await chooseFolderWithNativeDialog(typeof currentPath === 'string' ? currentPath : '');
        if (result.cancelled) {
            return res.json({
                success: false,
                cancelled: true,
                message: '已取消选择文件夹'
            });
        }

        if (!result.folderPath) {
            return res.json({
                success: false,
                message: '未选择文件夹'
            });
        }

        const validationPath = normalizeInputPath(result.folderPath);
        if (!fs.existsSync(validationPath) || !fs.statSync(validationPath).isDirectory()) {
            return res.json({
                success: false,
                message: '选择的路径不是有效文件夹'
            });
        }

        res.json({
            success: true,
            folderPath: result.folderPath,
            message: '文件夹已选择'
        });
    } catch (error) {
        res.json({
            success: false,
            message: '打开文件夹选择器失败: ' + error.message
        });
    }
});

app.post('/api/open-website', async (req, res) => {
    const { name, url } = req.body;

    console.log('\n🌐 收到打开网站请求');
    console.log('   名称:', name);
    console.log('   网址:', url);

    // 验证参数
    if (!name) {
        return res.json({
            success: false,
            message: '请提供网站名称'
        });
    }

    if (name === 'doubao') {
        return res.json({
            success: true,
            message: '豆包已改为 API 调用，无需打开豆包网页'
        });
    }

    if (!url) {
        return res.json({
            success: false,
            message: '请提供网站网址'
        });
    }

    if (workflowController.isRunning || automationState.legilTaskRunning) {
        return res.json({
            success: false,
            message: '自动化任务运行中，暂不能切换浏览器页面'
        });
    }

    // 验证 URL 格式
    try {
        new URL(url);
    } catch {
        return res.json({
            success: false,
            message: '网址格式不正确'
        });
    }

    try {
        // 调用浏览器控制器打开网站
        const success = await browserController.openWebsite(name, url);

        if (success) {
            res.json({
                success: true,
                message: `已成功打开 ${name}`
            });
        } else {
            res.json({
                success: false,
                message: `打开 ${name} 失败`
            });
        }

    } catch (error) {
        console.error('打开网站时出错:', error);
        res.json({
            success: false,
            message: '服务器错误：' + error.message
        });
    }
});

/**
 * ============================================
 * 新增 API 接口：同时打开两个网站（第三阶段）
 * ============================================
 *
 * 请求方法：POST
 * 请求路径：/api/open-both-websites
 * 请求参数：{ legilUrl: "Legil网址" }
 * 返回数据：{ success: true/false, results: {doubao, legil}, message: "提示信息" }
 */
app.post('/api/open-both-websites', async (req, res) => {
    const { legilUrl } = req.body;

    console.log('\n🌐 收到打开自动化网站的请求');
    console.log('   豆包: 已改为 API 调用，无需网页');
    console.log('   Legil:', legilUrl);

    // 验证参数
    if (!legilUrl) {
        return res.json({
            success: false,
            message: '请提供 Legil 网站网址'
        });
    }

    if (workflowController.isRunning || automationState.legilTaskRunning) {
        return res.json({
            success: false,
            message: '自动化任务运行中，暂不能重新打开浏览器页面'
        });
    }

    try {
        new URL(legilUrl);
    } catch {
        return res.json({
            success: false,
            message: 'Legil 网址格式不正确'
        });
    }

    try {
        const results = {
            doubao: true,
            legil: false
        };

        // 豆包提示词阶段已改为 API 调用，这里只需要打开 Legil 网页。
        results.legil = await browserController.openWebsite('legil', legilUrl);

        if (results.legil) {
            res.json({
                success: true,
                results: results,
                message: '豆包 API 无需网页，Legil 网站已成功打开'
            });
        } else {
            res.json({
                success: false,
                results: results,
                message: 'Legil 网站打开失败，豆包 API 无需网页'
            });
        }

    } catch (error) {
        console.error('打开网站时出错:', error);
        res.json({
            success: false,
            message: '服务器错误：' + error.message
        });
    }
});

/**
 * ============================================
 * 新增 API 接口：关闭浏览器（第三阶段）
 * ============================================
 * 用于测试或重置时关闭浏览器
 */
app.post('/api/close-browser', async (req, res) => {
    console.log('\n🔒 收到关闭浏览器请求');

    try {
        if (workflowController.isRunning || automationState.legilTaskRunning) {
            return res.json({
                success: false,
                message: '自动化任务运行中，请先停止任务再关闭浏览器'
            });
        }

        await browserController.closeBrowser();
        res.json({
            success: true,
            message: '浏览器已关闭'
        });
    } catch (error) {
        res.json({
            success: false,
            message: '关闭浏览器时出错：' + error.message
        });
    }
});

/**
 * ============================================
 * 新增 API 接口：获取浏览器状态（第三阶段）
 * ============================================
 * 检查浏览器是否已启动、哪些页面已打开
 */
app.get('/api/browser-status', (req, res) => {
    const status = {
        browserRunning: !!browserController.browser,
        pages: {
            doubao: false,
            legil: browserController.isPageOpen('legil')
        },
        doubaoApiConfigured: doubaoAutomation.getConfig().apiKeyConfigured
    };

    res.json({
        success: true,
        status: status
    });
});

app.get('/api/feishu/status', (req, res) => {
    const feishuConfig = getFeishuConfig();
    res.json({
        success: true,
        configured: {
            eventVerificationToken: Boolean(feishuConfig.verificationToken),
            botWebhookUrl: Boolean(feishuConfig.botWebhookUrl),
            botSecret: Boolean(feishuConfig.botSecret),
            allowedChatIds: feishuConfig.allowedChatIds.length
        },
        endpoints: {
            events: '/api/feishu/events',
            notify: '/api/feishu/notify'
        },
        supportedCommands: ['状态', '进度', '停止工作流', '继续工作流', '继续创意拓展', '重启工作流', '帮助']
    });
});

app.post('/api/feishu/notify', async (req, res) => {
    const text = typeof req.body?.text === 'string' && req.body.text.trim()
        ? req.body.text.trim()
        : buildPlatformStatusText();

    try {
        const result = await sendFeishuText(text);
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            message: '飞书消息发送失败：' + error.message
        });
    }
});

app.post('/api/feishu/events', (req, res) => {
    const body = req.body || {};

    if (body.encrypt) {
        return res.status(400).json({
            code: 1,
            msg: '暂未启用飞书加密事件解析，请先关闭事件加密或使用 verification token 校验'
        });
    }

    const verification = verifyFeishuEventToken(body);
    if (!verification.success) {
        return res.status(403).json({
            code: 1,
            msg: verification.message
        });
    }

    if (body.type === 'url_verification' && body.challenge) {
        return res.json({
            challenge: body.challenge
        });
    }

    res.json({
        code: 0,
        msg: 'ok'
    });

    setImmediate(async () => {
        try {
            const resultText = await handleFeishuEvent(body);
            if (resultText) {
                await sendFeishuText(resultText);
            }
        } catch (error) {
            logger.error('处理飞书指令失败: ' + error.message);
            await sendFeishuText('处理飞书指令失败：' + error.message).catch(() => {});
        }
    });
});

app.get('/api/feishu-cli/status', (req, res) => {
    const config = readFeishuCliConfig();
    res.json({
        success: true,
        configured: getSafeFeishuCliConfig(config),
        validation: validateFeishuCliConfig(config),
        bridge: feishuCliBridge.getStatus(),
        commands: ['帮助', '状态', '进度', '日志', '浏览器状态', '开始量产', '停止创意拓展', '继续创意拓展', '停止工作流', '继续工作流', '重启工作流']
    });
});

app.get('/api/health', (req, res) => {
    try {
        res.json({
            ...getHealthSnapshot(),
            monitor: healthMonitor ? healthMonitor.getStatus() : null
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: '获取健康状态失败：' + error.message
        });
    }
});

app.get('/api/notifications/status', (req, res) => {
    res.json({
        success: true,
        notification: feishuNotifier.getStatus(),
        monitor: healthMonitor ? healthMonitor.getStatus() : null,
        watchdog: readWatchdogStatus()
    });
});

app.get('/api/watchdog/status', (req, res) => {
    res.json({
        success: true,
        watchdog: readWatchdogStatus()
    });
});

app.post('/api/watchdog/start', (req, res) => {
    const result = ensureFeishuWatchdogProcess('manual');
    res.json({
        success: result.success !== false,
        result,
        watchdog: readWatchdogStatus()
    });
});

app.post('/api/health/test-notification', async (req, res) => {
    try {
        const result = await feishuNotifier.notify({
            level: 'info',
            title: '飞书异常通知测试',
            message: '这是一条健康监控测试通知。',
            suggestion: '收到这条消息说明异常通知链路可用。',
            extraLines: [`服务端口：${PORT}`]
        }, {
            key: `test-notification:${Date.now()}`,
            cooldownMs: 0
        });
        res.json({
            success: result.success !== false,
            result
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: '测试通知发送失败：' + error.message
        });
    }
});

function isLoopbackRequest(req) {
    const values = [
        req.ip,
        req.socket && req.socket.remoteAddress,
        req.connection && req.connection.remoteAddress
    ].map(value => String(value || '').trim()).filter(Boolean);

    return values.some(ip =>
        ip === '127.0.0.1' ||
        ip === '::1' ||
        ip === '::ffff:127.0.0.1' ||
        ip.startsWith('::ffff:127.')
    );
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function renderFeishuCardActionPage(title, message, success = true, options = {}) {
    const autoClose = options.autoClose === true;
    const autoCloseScript = autoClose
        ? `
  <script>
    (function () {
      function closeOrReturn() {
        try { window.close(); } catch (_) {}
        setTimeout(function () {
          try {
            if (window.history.length > 1) {
              window.history.back();
              return;
            }
          } catch (_) {}
          document.body.classList.remove('closing');
        }, 120);
      }
      closeOrReturn();
    })();
  </script>`
        : '';
    return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f5f7fa; color: #172033; }
    body.closing { opacity: 0; }
    main { width: min(560px, calc(100vw - 32px)); background: #fff; border: 1px solid #dfe4ea; border-radius: 8px; padding: 24px; box-shadow: 0 18px 45px rgba(15, 23, 42, .08); }
    h1 { margin: 0 0 12px; font-size: 20px; }
    pre { white-space: pre-wrap; word-break: break-word; line-height: 1.6; margin: 0; color: #334155; }
    .ok { color: #0f766e; }
    .bad { color: #b42318; }
  </style>
</head>
<body${autoClose ? ' class="closing"' : ''}>
  <main>
    <h1 class="${success ? 'ok' : 'bad'}">${escapeHtml(title)}</h1>
    <pre>${escapeHtml(message)}</pre>
  </main>
${autoCloseScript}
</body>
</html>`;
}

app.post('/api/server/restart', (req, res) => {
    if (!isLoopbackRequest(req)) {
        return res.status(403).json({
            success: false,
            message: '该接口仅允许本机访问。'
        });
    }

    if (workflowController.isRunning || automationState.legilTaskRunning || hasActiveCreativeAgentTask()) {
        return res.json({
            success: false,
            message: '当前有任务正在运行，请先停止工作流、创意拓展或 Agent 任务后再重启服务器。'
        });
    }

    const result = scheduleLocalServerRestart({
        delayMs: req.body && req.body.delayMs,
        reason: req.body && req.body.reason ? req.body.reason : '飞书按钮'
    });

    res.json(result);
});

app.get('/api/feishu-cli/card-action', async (req, res) => {
    const config = readFeishuCliConfig();
    const token = String(req.query.token || '').trim();
    const action = String(req.query.action || '').trim();
    const requestedChatId = String(req.query.chat_id || '').trim();

    if (!isLoopbackRequest(req)) {
        return res.status(403).send(renderFeishuCardActionPage('按钮执行被拒绝', '该接口仅允许本机访问。', false));
    }

    if (!config.cardActionToken || token !== config.cardActionToken) {
        return res.status(403).send(renderFeishuCardActionPage('按钮执行被拒绝', '卡片按钮 token 无效，请重新发送控制面板卡片。', false));
    }

    const chatId = requestedChatId && config.allowedChatIds.includes(requestedChatId)
        ? requestedChatId
        : config.notifyChatId;
    const actionLabel = CARD_ACTIONS[action] ? CARD_ACTIONS[action].label : action || '未知动作';

    try {
        const controlService = new FeishuControlService({
            apiBaseUrl: config.controlApiBaseUrl,
            timeoutMs: config.sendTimeoutMs
        });
        const result = await controlService.executeControlAction(action);
        const success = result && result.success !== false;
        const message = result && result.message ? result.message : (success ? '已执行' : '执行失败');
        const title = `按钮执行：${actionLabel}`;

        await feishuCliBridge.sendControlCard({
            chatId,
            title,
            summary: message,
            template: success ? 'green' : 'red',
            footer: `来自卡片按钮：${actionLabel}`
        }).catch(error => {
            logger.warn('发送飞书按钮结果卡片失败: ' + error.message);
        });

        const shouldAutoClose = success && String(req.query.close || '1') !== '0';
        res.send(renderFeishuCardActionPage(
            success ? '已执行' : '执行失败',
            `${title}\n\n${message}`,
            success,
            { autoClose: shouldAutoClose }
        ));
    } catch (error) {
        logger.error('处理飞书卡片按钮失败: ' + error.message);
        await feishuCliBridge.sendMessage(`飞书卡片按钮执行失败：${error.message}`, chatId ? { chatId } : {}).catch(() => {});
        res.status(500).send(renderFeishuCardActionPage('执行失败', error.message, false));
    }
});

app.post('/api/feishu-cli/start', async (req, res) => {
    try {
        const result = await feishuCliBridge.start(req.body && typeof req.body === 'object' ? req.body : {});
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            message: '启动飞书 CLI 桥接失败：' + error.message,
            status: feishuCliBridge.getStatus()
        });
    }
});

app.post('/api/feishu-cli/stop', async (req, res) => {
    try {
        const result = await feishuCliBridge.stop();
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            message: '停止飞书 CLI 桥接失败：' + error.message,
            status: feishuCliBridge.getStatus()
        });
    }
});

app.post('/api/feishu-cli/test-send', async (req, res) => {
    const text = typeof req.body?.text === 'string' && req.body.text.trim()
        ? req.body.text.trim()
        : `AI生图自动化平台飞书 CLI 通知测试成功\n时间：${new Date().toLocaleString('zh-CN', { hour12: false })}`;
    const chatId = typeof req.body?.chatId === 'string' ? req.body.chatId.trim() : '';

    try {
        const result = await feishuCliBridge.sendMessage(text, chatId ? { chatId } : {});
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            message: '飞书 CLI 消息发送失败：' + error.message
        });
    }
});

app.post('/api/feishu-cli/send-card', async (req, res) => {
    const title = typeof req.body?.title === 'string' && req.body.title.trim()
        ? req.body.title.trim()
        : 'AI生图控制面板';
    const summary = typeof req.body?.summary === 'string' && req.body.summary.trim()
        ? req.body.summary.trim()
        : '常用按钮已精简，其他操作继续发送文字指令。';
    const chatId = typeof req.body?.chatId === 'string' ? req.body.chatId.trim() : '';

    try {
        const result = await feishuCliBridge.sendControlCard({
            title,
            summary,
            chatId
        });
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            message: '飞书 CLI 卡片发送失败：' + error.message
        });
    }
});

app.get('/api/config/doubao', (req, res) => {
    res.json({
        success: true,
        config: doubaoAutomation.getConfig()
    });
});

app.post('/api/config/doubao', (req, res) => {
    const { apiKey, modelId, baseUrl, promptTemplate, instruction, clearApiKey } = req.body || {};
    const nextPrompt = promptTemplate ?? instruction;

    try {
        const updates = {};

        if (typeof nextPrompt !== 'undefined') {
            if (typeof nextPrompt !== 'string' || !nextPrompt.trim()) {
                return res.json({
                    success: false,
                    message: '豆包固定指令不能为空'
                });
            }

            if (nextPrompt.length > 10000) {
                return res.json({
                    success: false,
                    message: '豆包固定指令过长，请控制在10000字以内'
                });
            }

            updates.promptTemplate = nextPrompt.trim();
        }

        if (typeof modelId !== 'undefined') {
            if (typeof modelId !== 'string' || !modelId.trim()) {
                return res.json({
                    success: false,
                    message: '模型 ID / Endpoint ID 不能为空'
                });
            }
            updates.modelId = modelId.trim();
        }

        if (typeof baseUrl !== 'undefined' && String(baseUrl || '').trim()) {
            updates.baseUrl = String(baseUrl).trim();
        }

        if (typeof apiKey !== 'undefined' && String(apiKey || '').trim()) {
            updates.apiKey = String(apiKey).trim();
        }

        if (clearApiKey === true) {
            updates.clearApiKey = true;
        }

        const config = doubaoAutomation.setConfig(updates);
        persistRuntimeConfig();

        res.json({
            success: true,
            config,
            message: '豆包配置已保存'
        });
    } catch (error) {
        res.json({
            success: false,
            message: error.message
        });
    }
});

app.post('/api/config/doubao/reset-prompt', (req, res) => {
    try {
        doubaoAutomation.resetPrompt();
        const config = doubaoAutomation.getConfig();
        persistRuntimeConfig();
        res.json({
            success: true,
            config,
            message: '豆包固定指令已恢复默认'
        });
    } catch (error) {
        res.json({
            success: false,
            message: error.message
        });
    }
});

app.get('/api/config/legil-generation', (req, res) => {
    res.json({
        success: true,
        config: legilAutomation.getConfig()
    });
});

app.post('/api/config/legil-generation', (req, res) => {
    const { imageModel, aspectRatio, resolution, outputQuantity } = req.body || {};

    try {
        const config = legilAutomation.setGenerationSettings({
            imageModel,
            aspectRatio,
            resolution,
            outputQuantity
        });
        persistRuntimeConfig();

        res.json({
            success: true,
            config,
            message: 'Legil 生成参数已保存'
        });
    } catch (error) {
        res.json({
            success: false,
            message: error.message
        });
    }
});

app.get('/api/config/notifications', (req, res) => {
    appConfig.notifications = normalizeNotificationConfig(appConfig.notifications);
    res.json({
        success: true,
        config: {
            ...appConfig.notifications
        },
        message: '获取通知配置成功'
    });
});

app.post('/api/config/notifications', (req, res) => {
    try {
        appConfig.notifications = normalizeNotificationConfig(req.body || {});
        persistRuntimeConfig({ notifications: appConfig.notifications });
        applyNotificationRuntimeConfig();

        res.json({
            success: true,
            config: {
                ...appConfig.notifications
            },
            message: '通知配置已保存'
        });
    } catch (error) {
        res.json({
            success: false,
            message: '通知配置保存失败：' + error.message
        });
    }
});

app.get('/api/config/workflow', (req, res) => {
    appConfig.workflow = normalizeWorkflowConfigPayload(appConfig.workflow);
    res.json({
        success: true,
        config: {
            ...appConfig.workflow
        },
        message: '获取量产配置成功'
    });
});

app.post('/api/config/workflow', (req, res) => {
    try {
        appConfig.workflow = normalizeWorkflowConfigPayload(req.body || {});
        persistRuntimeConfig({ workflow: appConfig.workflow });

        res.json({
            success: true,
            config: {
                ...appConfig.workflow
            },
            message: '量产配置已保存'
        });
    } catch (error) {
        res.json({
            success: false,
            message: '保存量产配置失败: ' + error.message
        });
    }
});

app.get('/api/config/resize', (req, res) => {
    const legilConfig = legilAutomation.getConfig();
    appConfig.resize = normalizeResizeConfigPayload(appConfig.resize);

    res.json({
        success: true,
        config: {
            ...appConfig.resize,
            generationSettings: {
                ...appConfig.resize.generationSettings
            },
            defaultGenerationSettings: {
                ...DEFAULT_RESIZE_CONFIG.generationSettings
            },
            generationOptions: {
                ...(legilConfig.options || {})
            }
        },
        message: '获取改尺寸配置成功'
    });
});

app.post('/api/config/resize', (req, res) => {
    try {
        appConfig.resize = normalizeResizeConfigPayload(req.body || {});
        persistRuntimeConfig({ resize: appConfig.resize });

        res.json({
            success: true,
            config: {
                ...appConfig.resize,
                generationSettings: {
                    ...appConfig.resize.generationSettings
                }
            },
            message: '改尺寸配置已保存'
        });
    } catch (error) {
        res.json({
            success: false,
            message: '保存改尺寸配置失败: ' + error.message
        });
    }
});

app.get('/api/config/creative', (req, res) => {
    const legilConfig = legilAutomation.getConfig();
    appConfig.creative = normalizeCreativeConfigPayload(appConfig.creative);

    res.json({
        success: true,
        config: {
            ...appConfig.creative,
            generationSettings: {
                ...appConfig.creative.generationSettings
            },
            defaultGenerationSettings: {
                ...DEFAULT_CREATIVE_CONFIG.generationSettings
            },
            generationOptions: {
                ...(legilConfig.options || {})
            }
        },
        message: '获取创意拓展配置成功'
    });
});

app.post('/api/config/creative', (req, res) => {
    try {
        appConfig.creative = normalizeCreativeConfigPayload(req.body || {});
        persistRuntimeConfig({ creative: appConfig.creative });

        res.json({
            success: true,
            config: {
                ...appConfig.creative,
                generationSettings: {
                    ...appConfig.creative.generationSettings
                }
            },
            message: '创意拓展配置已保存'
        });
    } catch (error) {
        res.json({
            success: false,
            message: '保存创意拓展配置失败: ' + error.message
        });
    }
});

app.post('/api/creative/parse-table', (req, res) => {
    const { fileName, fileContentBase64 } = req.body || {};

    try {
        const parsed = parseCreativePromptWorkbook(fileName, fileContentBase64);
        const qualityReport = buildCreativeAgentQualityReport(parsed.prompts);
        res.json({
            success: true,
            ...parsed,
            qualityReport,
            count: parsed.prompts.length,
            message: `成功提取 ${parsed.prompts.length} 组画面提示词`
        });
    } catch (error) {
        res.json({
            success: false,
            prompts: [],
            count: 0,
            message: error.message
        });
    }
});

/**
 * ============================================
 * 第六阶段：完整自动化流程 API 接口
 * ============================================
 *
 * 请求方法：POST
 * 请求路径：/api/doubao/full-automation
 * 请求参数：{ imagePath: "图片路径" }
 * 返回数据：{ success: true/false, response: "豆包回复", prompts: [...], message: "提示信息" }
 */
app.post('/api/doubao/full-automation', async (req, res) => {
    const { imagePath } = req.body;

    console.log('\n🤖 收到完整自动化流程请求（第六阶段）');
    console.log('   图片路径:', imagePath);

    // 验证参数
    if (typeof imagePath !== 'string' || !imagePath.trim()) {
        return res.json({
            success: false,
            response: null,
            prompts: [],
            message: '请提供图片路径'
        });
    }

    if (workflowController.isRunning) {
        return res.json({
            success: false,
            response: null,
            prompts: [],
            message: '工作流正在运行中，请稍后再单独运行豆包自动化'
        });
    }

    // 规范化路径并验证文件是否存在
    const normalizedImagePath = normalizeInputPath(imagePath);
    if (!fs.existsSync(normalizedImagePath)) {
        return res.json({
            success: false,
            response: null,
            prompts: [],
            message: '图片文件不存在: ' + normalizedImagePath
        });
    }

    try {
        // 调用豆包完整自动化流程（上传+获取+提取）
        const result = await doubaoAutomation.fullAutomation(normalizedImagePath);
        res.json(result);

    } catch (error) {
        console.error('完整自动化流程出错:', error);
        res.json({
            success: false,
            response: null,
            prompts: [],
            message: '服务器错误：' + error.message
        });
    }
});

/**
 * ============================================
 * 第六阶段：获取已提取的提示词
 * ============================================
 */
app.get('/api/doubao/extracted-prompts', (req, res) => {
    const prompts = doubaoAutomation.getLastExtractedPrompts();

    if (prompts) {
        res.json({
            success: true,
            prompts: prompts,
            message: `获取到 ${prompts.length} 组提示词`
        });
    } else {
        res.json({
            success: false,
            prompts: [],
            message: '尚未提取提示词，请先运行完整流程'
        });
    }
});

/**
 * ============================================
 * 第七阶段：Legil 平台自动化 API 接口
 * ============================================
 *
 * 请求方法：POST
 * 请求路径：/api/legil/generate
 * 请求参数：{ prompt: "提示词", promptIndex: 序号 }
 * 返回数据：{ success: true/false, savePath: "保存路径", message: "提示信息" }
 */
app.post('/api/legil/generate', async (req, res) => {
    const { prompt, promptIndex, index } = req.body;
    const safePromptIndex = toPositiveIndex(promptIndex ?? index, 1);

    console.log('\n🎨 收到 Legil 生成图片请求（第七阶段）');
    console.log('   提示词序号:', safePromptIndex);
    console.log('   提示词预览:', typeof prompt === 'string' ? prompt.substring(0, 50) + '...' : '未提供');

    // 验证参数
    if (typeof prompt !== 'string' || !prompt.trim()) {
        return res.json({
            success: false,
            savePath: null,
            message: '请提供提示词'
        });
    }

    if (isLegilBusy()) {
        return res.json({
            success: false,
            savePath: null,
            message: '当前已有自动化任务正在运行，请稍后再试'
        });
    }

    try {
        automationState.legilTaskRunning = true;
        automationState.legilStopRequested = false;
        automationState.legilTaskType = 'single-generate';
        // 调用 Legil 自动化模块
        const result = await legilAutomation.generateImage(prompt.trim(), safePromptIndex, {
            taskType: 'Legil单张生成',
            autoRecoveryEnabled: appConfig.notifications.autoRecoveryEnabled,
            captureErrorScreenshot: appConfig.notifications.legilScreenshotEnabled
        });
        res.json(result);

    } catch (error) {
        console.error('Legil 自动化出错:', error);
        res.json({
            success: false,
            savePath: null,
            message: '服务器错误：' + error.message
        });
    } finally {
        automationState.legilTaskRunning = false;
        automationState.legilStopRequested = false;
        automationState.legilTaskType = null;
    }
});

/**
 * ============================================
 * 第七阶段：批量生成五张图片
 * ============================================
 */
app.post('/api/legil/batch-generate', async (req, res) => {
    const { prompts } = req.body;

    console.log('\n🎨 收到 Legil 批量生成请求');
    console.log('   提示词数量:', prompts ? prompts.length : 0);

    if (!prompts || !Array.isArray(prompts) || prompts.length === 0) {
        return res.json({
            success: false,
            results: [],
            message: '请提供提示词数组'
        });
    }

    if (isLegilBusy()) {
        return res.json({
            success: false,
            results: [],
            message: '当前已有自动化任务正在运行，请稍后再试'
        });
    }

    const normalizedPrompts = prompts
        .map(promptData => typeof promptData === 'string' ? promptData : promptData && promptData.content)
        .filter(promptText => typeof promptText === 'string' && promptText.trim())
        .map(promptText => promptText.trim());

    if (normalizedPrompts.length === 0) {
        return res.json({
            success: false,
            results: [],
            message: '提示词数组中没有有效内容'
        });
    }

    automationState.legilTaskRunning = true;
    automationState.legilStopRequested = false;
    automationState.legilTaskType = 'batch-generate';
    const batchRunId = formatDateTimeForFile();

    // 先返回接受请求的消息
    res.json({
        success: true,
        message: `已接受批量生成请求，将生成 ${normalizedPrompts.length} 张图片。请通过日志查看进度。`,
        total: normalizedPrompts.length
    });

    // 在后台执行批量生成（不阻塞响应）
    (async () => {
        logger.system('开始批量生成图片...');

        try {
            let outputSequence = 1;
            let consecutiveFailures = 0;
            const legilOutputQuantity = legilAutomation.getConfig().settings.outputQuantity || 1;
            const outputTotal = normalizedPrompts.length * legilOutputQuantity;
            for (let i = 0; i < normalizedPrompts.length; i++) {
                const promptText = normalizedPrompts[i];

                logger.info(`正在生成第 ${i + 1}/${normalizedPrompts.length} 张图片...`);

                try {
                    const result = await legilAutomation.generateImage(promptText, i + 1, {
                        outputSequence,
                        outputTotal,
                        runId: batchRunId,
                        promptIndexWithinImage: i + 1,
                        totalPromptsForImage: normalizedPrompts.length,
                        taskType: 'Legil批量生成',
                        autoRecoveryEnabled: appConfig.notifications.autoRecoveryEnabled,
                        captureErrorScreenshot: appConfig.notifications.legilScreenshotEnabled
                    });

                    if (result.success) {
                        consecutiveFailures = 0;
                        const savedCount = Number(result.savedCount) || 1;
                        outputSequence += savedCount;
                        logger.info(`✅ 第 ${i + 1} 组生成成功，保存 ${savedCount} 张图片: ${path.basename(result.savePath)}`);
                    } else {
                        consecutiveFailures += 1;
                        logger.error(`❌ 第 ${i + 1} 张图片生成失败: ${result.message}`);
                        if (
                            appConfig.notifications.pauseOnConsecutiveFailures &&
                            consecutiveFailures >= appConfig.notifications.consecutiveFailureThreshold
                        ) {
                            logger.warn(`连续失败 ${consecutiveFailures} 次，已暂停批量生成任务，等待确认后再继续。`);
                            notifyTaskEvent({
                                level: 'warning',
                                title: 'Legil批量生成已暂停',
                                taskType: 'Legil批量生成',
                                message: `连续失败 ${consecutiveFailures} 次，系统已暂停任务。`,
                                suggestion: '请检查 Legil 页面状态、账号登录和提示词内容后再重新启动。'
                            }, {
                                key: `batch-generate-paused:${batchRunId}`,
                                cooldownMs: 0
                            });
                            break;
                        }
                    }

                    // 每张图片之间等待 5 秒，避免过于频繁
                    if (i < normalizedPrompts.length - 1) {
                        logger.info('等待 5 秒后继续下一张...');
                        await new Promise(resolve => setTimeout(resolve, 5000));
                    }

                } catch (error) {
                    logger.error(`❌ 第 ${i + 1} 张图片生成时出错: ${error.message}`);
                }
            }

            logger.system('✅ 批量生成完成！');
        } finally {
            automationState.legilTaskRunning = false;
            automationState.legilStopRequested = false;
            automationState.legilTaskType = null;
        }
    })();
});

app.get('/api/legil/task-status', (req, res) => {
    res.json({
        success: true,
        running: automationState.legilTaskRunning,
        stopRequested: automationState.legilStopRequested,
        taskType: automationState.legilTaskType,
        progress: automationState.legilTaskProgress,
        workflowRunning: workflowController.isRunning
    });
});

app.post('/api/legil/stop', (req, res) => {
    res.json(requestLegilTaskStop());
});

/**
 * ============================================
 * Legil 批量改尺寸：只使用 Legil，不调用豆包 API
 * ============================================
 */
app.post('/api/legil/resize-batch', async (req, res) => {
    const resizeConfig = normalizeResizeConfigPayload(req.body || {});
    const resizeGenerationSettings = normalizeLegilGenerationSettings(
        req.body && typeof req.body.generationSettings === 'object' ? req.body.generationSettings : resizeConfig.generationSettings,
        resizeConfig.generationSettings || DEFAULT_RESIZE_CONFIG.generationSettings
    );
    const promptText = String(resizeConfig.promptTemplate || '').trim();

    console.log('\n🖼️ 收到 Legil 批量改尺寸请求');
    console.log('   输入文件夹:', resizeConfig.inputFolder);
    console.log('   输出文件夹:', resizeConfig.outputFolder);
    console.log('   运行模式:', resizeConfig.browserMode);

    if (isLegilBusy()) {
        return res.json({
            success: false,
            message: '当前已有自动化任务正在运行，请稍后再试'
        });
    }

    if (!promptText) {
        return res.json({
            success: false,
            message: '请填写发送给 Legil 的固定文字提示词'
        });
    }

    try {
        if (!fs.existsSync(resizeConfig.inputFolder)) {
            return res.json({
                success: false,
                message: '输入文件夹不存在，请检查路径是否正确'
            });
        }

        if (!fs.statSync(resizeConfig.inputFolder).isDirectory()) {
            return res.json({
                success: false,
                message: '输入路径不是文件夹'
            });
        }

        const imageFiles = listImageFilesInFolder(resizeConfig.inputFolder);
        if (imageFiles.length === 0) {
            return res.json({
                success: false,
                message: '输入文件夹中没有找到图片'
            });
        }

        fs.mkdirSync(resizeConfig.outputFolder, { recursive: true });
        if (!fs.statSync(resizeConfig.outputFolder).isDirectory()) {
            return res.json({
                success: false,
                message: '输出路径不是文件夹'
            });
        }

        appConfig.resize = {
            ...resizeConfig,
            generationSettings: resizeGenerationSettings
        };
        persistRuntimeConfig({
            resize: appConfig.resize
        });

        automationState.legilTaskRunning = true;
        automationState.legilStopRequested = false;
        automationState.legilTaskType = 'resize-batch';
        const batchRunId = formatDateTimeForFile();
        const outputTotal = imageFiles.length * (Number(resizeGenerationSettings.outputQuantity) || 1);
        const resizeHeadless = resizeConfig.browserMode === 'headless';

        res.json({
            success: true,
            message: `已启动 Legil 批量改尺寸任务，共 ${imageFiles.length} 张输入图。请通过实时日志查看进度。`,
            totalImages: imageFiles.length,
            outputTotal
        });

        (async () => {
            const previousSaveFolder = legilAutomation.saveFolder;
            const previousReferenceFolder = legilAutomation.referenceFolder;
            const previousReferenceImages = Array.isArray(legilAutomation.referenceImages)
                ? [...legilAutomation.referenceImages]
                : [];
            const previousRefIndex = legilAutomation.currentRefIndex;
            const previousGenerationSettings = {
                ...legilAutomation.getConfig().settings
            };

            logger.system('========================================');
            logger.system('开始 Legil 批量改尺寸任务');
            logger.info(`输入文件夹: ${resizeConfig.inputFolder}`);
            logger.info(`输出文件夹: ${resizeConfig.outputFolder}`);
            logger.info(`运行模式: ${resizeHeadless ? '无头模式' : '有头模式'}`);
            logger.info(`输入图片数量: ${imageFiles.length}`);
            logger.info(`改尺寸 Legil 参数: 模型 ${legilAutomation.getImageModelLabel(resizeGenerationSettings.imageModel)}，宽高比 ${resizeGenerationSettings.aspectRatio}，分辨率 ${resizeGenerationSettings.resolution}，输出数量 ${resizeGenerationSettings.outputQuantity}`);
            logger.system('========================================');

            let outputSequence = 1;
            let successCount = 0;
            let failedCount = 0;
            let consecutiveFailures = 0;
            let stopped = false;
            let interruptedMessage = '';

            try {
                for (let i = 0; i < imageFiles.length; i++) {
                    if (isLegilStopRequested()) {
                        stopped = true;
                        logger.warn('⏹️ 改尺寸任务已停止，退出剩余图片处理');
                        break;
                    }

                    const imagePath = imageFiles[i];
                    const imageName = path.basename(imagePath);

                    logger.info('');
                    logger.info(`🖼️ 正在处理改尺寸图片 ${i + 1}/${imageFiles.length}: ${imageName}`);

                    try {
                        const result = await legilAutomation.generateImage(promptText, i + 1, {
                            referenceImagePath: imagePath,
                            saveFolder: resizeConfig.outputFolder,
                            headless: resizeHeadless,
                            generationSettings: resizeGenerationSettings,
                            outputSequence,
                            outputTotal,
                            runId: batchRunId,
                            referenceImageIndex: i + 1,
                            totalReferenceImages: imageFiles.length,
                            referenceImageName: imageName,
                            promptIndexWithinImage: 1,
                            totalPromptsForImage: 1,
                            taskType: '批量改尺寸',
                            autoRecoveryEnabled: appConfig.notifications.autoRecoveryEnabled,
                            captureErrorScreenshot: appConfig.notifications.legilScreenshotEnabled,
                            shouldAbort: isLegilStopRequested
                        });

                        if (result.success) {
                            consecutiveFailures = 0;
                            const savedCount = Number(result.savedCount) || 1;
                            outputSequence += savedCount;
                            successCount += 1;
                            logger.info(`✅ 改尺寸图片 ${i + 1}/${imageFiles.length} 完成，保存 ${savedCount} 张`);
                        } else if (isLegilStopRequested() || String(result.message || '').includes('操作已取消')) {
                            stopped = true;
                            logger.warn('⏹️ 改尺寸任务已停止');
                            break;
                        } else {
                            failedCount += 1;
                            consecutiveFailures += 1;
                            logger.error(`❌ 改尺寸图片 ${i + 1}/${imageFiles.length} 失败: ${result.message}`);
                            if (
                                appConfig.notifications.pauseOnConsecutiveFailures &&
                                consecutiveFailures >= appConfig.notifications.consecutiveFailureThreshold
                            ) {
                                stopped = true;
                                logger.warn(`连续失败 ${consecutiveFailures} 次，已暂停改尺寸任务，等待确认。`);
                                notifyTaskEvent({
                                    level: 'warning',
                                    title: '批量改尺寸已暂停',
                                    taskType: '批量改尺寸',
                                    message: `连续失败 ${consecutiveFailures} 次，系统已暂停任务。`,
                                    suggestion: '请检查 Legil 页面、账号登录和输入图片后重新启动。'
                                }, {
                                    key: `resize-paused:${batchRunId}`,
                                    cooldownMs: 0
                                });
                                break;
                            }
                        }
                    } catch (error) {
                        if (isLegilStopRequested() || error.message === '操作已取消') {
                            stopped = true;
                            logger.warn('⏹️ 改尺寸任务已停止');
                            break;
                        }
                        failedCount += 1;
                        consecutiveFailures += 1;
                        logger.error(`❌ 改尺寸图片 ${i + 1}/${imageFiles.length} 出错: ${error.message}`);
                        if (
                            appConfig.notifications.pauseOnConsecutiveFailures &&
                            consecutiveFailures >= appConfig.notifications.consecutiveFailureThreshold
                        ) {
                            stopped = true;
                            logger.warn(`连续失败 ${consecutiveFailures} 次，已暂停改尺寸任务，等待确认。`);
                            notifyTaskEvent({
                                level: 'warning',
                                title: '批量改尺寸已暂停',
                                taskType: '批量改尺寸',
                                message: `连续失败 ${consecutiveFailures} 次，系统已暂停任务。`,
                                suggestion: '请检查 Legil 页面、账号登录和输入图片后重新启动。'
                            }, {
                                key: `resize-paused:${batchRunId}`,
                                cooldownMs: 0
                            });
                            break;
                        }
                    }

                    if (i < imageFiles.length - 1) {
                        logger.info('等待 5 秒后继续下一张...');
                        try {
                            await sleepWithLegilStop(5000);
                        } catch (error) {
                            stopped = true;
                            logger.warn('⏹️ 改尺寸任务已停止');
                            break;
                        }
                    }
                }

                logger.system('========================================');
                if (stopped) {
                    logger.system(`⏹️ Legil 批量改尺寸任务已停止：成功 ${successCount} 张，失败 ${failedCount} 张`);
                } else {
                    logger.system(`✅ Legil 批量改尺寸任务完成：成功 ${successCount} 张，失败 ${failedCount} 张`);
                }
                logger.system('========================================');
            } catch (error) {
                const safeMessage = error && error.message ? error.message : String(error || '未知错误');
                interruptedMessage = safeMessage;
                logger.error(`❌ Legil 批量改尺寸任务被中断: ${safeMessage}`);
            } finally {
                notifyLegilResult('resize-batch', {
                    successCount,
                    failedCount,
                    interrupted: Boolean(interruptedMessage),
                    message: interruptedMessage || (stopped ? '任务已停止' : `任务完成：成功 ${successCount} 张，失败 ${failedCount} 张`)
                });
                legilAutomation.saveFolder = previousSaveFolder;
                legilAutomation.referenceFolder = previousReferenceFolder;
                legilAutomation.referenceImages = previousReferenceImages;
                legilAutomation.currentRefIndex = previousRefIndex;
                legilAutomation.generationSettings = previousGenerationSettings;
                automationState.legilTaskRunning = false;
                automationState.legilStopRequested = false;
                automationState.legilTaskType = null;
            }
        })();
    } catch (error) {
        automationState.legilTaskRunning = false;
        automationState.legilStopRequested = false;
        automationState.legilTaskType = null;
        console.error('Legil 批量改尺寸启动失败:', error);
        res.json({
            success: false,
            message: '启动失败：' + error.message
        });
    }
});

app.get('/api/creative-agent/status', (req, res) => {
    res.json(getCreativeAgentStatus());
});

app.post('/api/creative-agent/run', async (req, res) => {
    const body = req.body || {};
    const storedWinkyConfig = getStoredWinkyConfig();
    const instruction = typeof body.instruction === 'string' ? body.instruction.trim() : '';
    const apiKey = String(body.apiKey || storedWinkyConfig.apiKey || '').trim();
    const apiUrl = String(body.apiUrl || storedWinkyConfig.apiUrl || '').trim();
    const model = String(body.model || storedWinkyConfig.model || '').trim();
    const provider = String(body.provider || storedWinkyConfig.provider || '').trim();
    const targetCount = Number.isFinite(Number(body.targetCount)) && Number(body.targetCount) > 0
        ? Math.floor(Number(body.targetCount))
        : null;
    const attachments = Array.isArray(body.attachments) ? body.attachments : [];

    if (!apiKey) {
        return res.status(400).json({
            success: false,
            message: '请填写 Lumos Winky API Key，或在服务器环境变量中设置 WINKY_API_KEY'
        });
    }

    if (!apiUrl) {
        return res.status(400).json({
            success: false,
            message: '请填写 Lumos Winky API URL，或在服务器环境变量中设置 WINKY_API_BASE_URL'
        });
    }

    if (!model) {
        return res.status(400).json({
            success: false,
            message: '请填写要调用的模型名称，或在服务器环境变量中设置 WINKY_MODEL'
        });
    }

    if (!instruction && attachments.length === 0) {
        return res.status(400).json({
            success: false,
            message: '请填写文字指令，或上传表格、图片、文件夹素材'
        });
    }

    try {
        new URL(apiUrl);
    } catch {
        return res.status(400).json({
            success: false,
            message: 'Lumos Winky API URL 格式不正确，请填写完整的接口地址'
        });
    }

    try {
        logger.system('开始调用创意拓展 Agent');
        logger.info(`创意拓展 Agent 附件数量: ${attachments.length}`);

        const task = startCreativeAgentTask({
            apiUrl,
            apiKey,
            model,
            provider,
            instruction,
            targetCount,
            attachments
        });

        res.json({
            success: true,
            runId: task.runId,
            task: publicCreativeAgentTask(task),
            message: '创意拓展 Agent 已启动，请等待任务完成'
        });
    } catch (error) {
        const safeMessage = String(error && error.message ? error.message : error || '未知错误').replaceAll(apiKey, '[REDACTED]');
        logger.error(`创意拓展 Agent 启动失败: ${safeMessage}`);
        res.status(500).json({
            success: false,
            message: '创意拓展 Agent 启动失败: ' + safeMessage
        });
    }
});

app.get('/api/creative-agent/task-status/:runId', (req, res) => {
    const task = getCreativeAgentTask(req.params.runId);
    if (!task) {
        return res.status(404).json({
            success: false,
            message: '创意拓展 Agent 任务不存在或已过期'
        });
    }

    res.json({
        success: true,
        task: publicCreativeAgentTask(task)
    });
});

app.get('/api/creative-agent/result/:runId', (req, res) => {
    const task = getCreativeAgentTask(req.params.runId);
    if (!task) {
        return res.status(404).json({
            success: false,
            message: '创意拓展 Agent 任务不存在或已过期'
        });
    }

    if (task.phase !== 'completed') {
        return res.json({
            success: false,
            task: publicCreativeAgentTask(task),
            message: task.error || task.message || '创意拓展 Agent 任务尚未完成'
        });
    }

    res.json({
        success: true,
        task: publicCreativeAgentTask(task, true),
        ...(task.result || {})
    });
});

app.post('/api/creative-agent/cancel/:runId', (req, res) => {
    const result = cancelCreativeAgentTask(getCreativeAgentTask(req.params.runId));
    res.json(result);
});

app.get('/api/creative-agent/download/:fileName', (req, res) => {
    const fileName = path.basename(String(req.params.fileName || ''));
    const outputRoot = path.resolve(CREATIVE_AGENT_OUTPUT_DIR);
    const filePath = path.resolve(CREATIVE_AGENT_OUTPUT_DIR, fileName);

    if (!fileName || !filePath.startsWith(outputRoot + path.sep)) {
        return res.status(400).json({
            success: false,
            message: '文件名不正确'
        });
    }

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({
            success: false,
            message: '表格文件不存在或已被清理'
        });
    }

    res.download(filePath, fileName);
});

app.get('/api/legil/creative-resume', (req, res) => {
    res.json({
        success: true,
        resume: getCreativeResumeInfo(true)
    });
});

app.get('/api/legil/creative-progress', (req, res) => {
    res.json({
        success: true,
        ...getCreativeProgressSnapshot()
    });
});

app.post('/api/legil/creative-resume/clear', (req, res) => {
    if (automationState.legilTaskRunning && automationState.legilTaskType === 'creative-batch') {
        return res.json({
            success: false,
            message: '创意拓展任务正在运行，不能清除恢复状态'
        });
    }

    clearCreativeResumeState();
    res.json({
        success: true,
        resume: { hasResume: false },
        message: '已清除创意拓展恢复状态'
    });
});

/**
 * ============================================
 * Legil 创意拓展：从本地表格提示词批量生成
 * ============================================
 */
app.post('/api/legil/creative-batch', async (req, res) => {
    const creativeConfig = normalizeCreativeConfigPayload(req.body || {});
    const creativeBrowserMode = normalizeCreativeBrowserMode(creativeConfig.browserMode);
    const creativeHeadless = creativeBrowserMode === 'headless';
    const creativeGenerationSettings = normalizeLegilGenerationSettings(
        req.body && typeof req.body.generationSettings === 'object' ? req.body.generationSettings : creativeConfig.generationSettings,
        creativeConfig.generationSettings || DEFAULT_CREATIVE_CONFIG.generationSettings
    );
    const promptItems = Array.isArray(req.body && req.body.prompts) ? req.body.prompts : [];
    const normalizedPrompts = normalizeCreativeBatchPromptItems(promptItems);
    const creativeTableFileName = String(req.body && req.body.tableFileName ? req.body.tableFileName : '').trim();

    console.log('\n🎨 收到 Legil 创意拓展批量生成请求');
    console.log('   输出文件夹:', creativeConfig.outputFolder);
    console.log('   运行模式:', creativeHeadless ? '无头模式' : '有头模式');
    console.log('   提示词数量:', normalizedPrompts.length);

    if (isLegilBusy()) {
        return res.json({
            success: false,
            message: '当前已有自动化任务正在运行，请稍后再试'
        });
    }

    if (normalizedPrompts.length === 0) {
        return res.json({
            success: false,
            message: '请先上传表格并提取有效画面提示词'
        });
    }

    try {
        fs.mkdirSync(creativeConfig.outputFolder, { recursive: true });
        if (!fs.statSync(creativeConfig.outputFolder).isDirectory()) {
            return res.json({
                success: false,
                message: '输出路径不是文件夹'
            });
        }

        if (creativeConfig.referenceFolder) {
            if (!fs.existsSync(creativeConfig.referenceFolder) || !fs.statSync(creativeConfig.referenceFolder).isDirectory()) {
                return res.json({
                    success: false,
                    message: 'Legil参考图文件夹不存在或不是文件夹'
                });
            }
        }

        appConfig.creative = {
            ...creativeConfig,
            browserMode: creativeBrowserMode,
            generationSettings: creativeGenerationSettings
        };
        persistRuntimeConfig({
            creative: appConfig.creative
        });

        automationState.legilTaskRunning = true;
        automationState.legilStopRequested = false;
        automationState.legilTaskType = 'creative-batch';
        const batchRunId = formatDateTimeForFile();
        const runContext = resolveCreativeBatchRunContext(normalizedPrompts, req.body || {}, creativeGenerationSettings);
        const progressTotal = runContext.total;
        const outputTotal = runContext.outputTotal;
        const initialAction = runContext.isResume
            ? `创意拓展继续任务已排队，准备从 ${runContext.baseCompleted}/${progressTotal} 继续...`
            : '创意拓展任务已排队，准备开始...';
        automationState.legilTaskProgress = {
            taskType: 'creative-batch',
            phase: 'queued',
            total: progressTotal,
            baseCompleted: runContext.baseCompleted,
            baseSuccess: runContext.baseSuccess,
            baseFailed: runContext.baseFailed,
            baseSaved: runContext.baseSaved,
            currentIndex: runContext.baseCompleted,
            completed: runContext.baseCompleted,
            success: runContext.baseSuccess,
            failed: runContext.baseFailed,
            saved: runContext.baseSaved,
            outputTotal,
            browserMode: creativeBrowserMode,
            currentName: '',
            currentAction: initialAction,
            startedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        setCreativeResumeState({
            runId: batchRunId,
            phase: 'queued',
            tableFileName: creativeTableFileName || '创意拓展表格',
            outputFolder: creativeConfig.outputFolder,
            referenceFolder: creativeConfig.referenceFolder,
            browserMode: creativeBrowserMode,
            generationSettings: creativeGenerationSettings,
            prompts: normalizedPrompts,
            total: progressTotal,
            baseCompleted: runContext.baseCompleted,
            baseSuccess: runContext.baseSuccess,
            baseFailed: runContext.baseFailed,
            baseSaved: runContext.baseSaved,
            nextIndex: 0,
            currentIndex: runContext.baseCompleted,
            completed: runContext.baseCompleted,
            success: runContext.baseSuccess,
            failed: runContext.baseFailed,
            saved: runContext.baseSaved,
            outputTotal,
            currentName: '',
            currentAction: initialAction,
            startedAt: automationState.legilTaskProgress.startedAt,
            updatedAt: automationState.legilTaskProgress.updatedAt
        });

        res.json({
            success: true,
            message: `已启动 Legil 创意拓展任务，共 ${normalizedPrompts.length} 组提示词。请通过实时日志查看进度。`,
            totalPrompts: normalizedPrompts.length,
            outputTotal,
            browserMode: creativeBrowserMode,
            progress: automationState.legilTaskProgress
        });

        (async () => {
            const previousSaveFolder = legilAutomation.saveFolder;
            const previousReferenceFolder = legilAutomation.referenceFolder;
            const previousReferenceImages = Array.isArray(legilAutomation.referenceImages)
                ? [...legilAutomation.referenceImages]
                : [];
            const previousRefIndex = legilAutomation.currentRefIndex;
            const previousGenerationSettings = {
                ...legilAutomation.getConfig().settings
            };

            logger.system('========================================');
            logger.system('开始 Legil 创意拓展批量生成任务');
            logger.info(`输出文件夹: ${creativeConfig.outputFolder}`);
            logger.info(`运行模式: ${creativeHeadless ? '无头模式' : '有头模式'}`);
            logger.info(`提示词数量: ${normalizedPrompts.length}`);
            logger.info(creativeConfig.referenceFolder
                ? `Legil参考图文件夹: ${creativeConfig.referenceFolder}`
                : 'Legil参考图文件夹: 未配置，生成时不上传参考图');
            logger.info(`创意拓展 Legil 参数: 模型 ${legilAutomation.getImageModelLabel(creativeGenerationSettings.imageModel)}，宽高比 ${creativeGenerationSettings.aspectRatio}，分辨率 ${creativeGenerationSettings.resolution}，输出数量 ${creativeGenerationSettings.outputQuantity}`);
            logger.system('========================================');

            let outputSequence = runContext.baseSaved + 1;
            let successCount = 0;
            let failedCount = 0;
            let savedTotal = 0;
            let consecutiveFailures = 0;
            let stopped = false;
            let interruptedMessage = '';
            const getLocalCompleted = () => successCount + failedCount;
            const getAggregateCompleted = () => runContext.baseCompleted + getLocalCompleted();
            const getAggregateSuccess = () => runContext.baseSuccess + successCount;
            const getAggregateFailed = () => runContext.baseFailed + failedCount;
            const getAggregateSaved = () => runContext.baseSaved + savedTotal;

            try {
                for (let i = 0; i < normalizedPrompts.length; i++) {
                    if (isLegilStopRequested()) {
                        stopped = true;
                        logger.warn('⏹️ 创意拓展任务已停止，退出剩余提示词处理');
                        break;
                    }

                    const promptItem = normalizedPrompts[i];
                    const directionName = [promptItem.direction, promptItem.promptTitle]
                        .filter(Boolean)
                        .join('_') || `表格第${promptItem.sourceRow}行`;
                    const displayIndex = runContext.baseCompleted + i + 1;
                    automationState.legilTaskProgress = {
                        ...(automationState.legilTaskProgress || {}),
                        taskType: 'creative-batch',
                        phase: 'running',
                        total: progressTotal,
                        currentIndex: displayIndex,
                        completed: getAggregateCompleted(),
                        success: getAggregateSuccess(),
                        failed: getAggregateFailed(),
                        saved: getAggregateSaved(),
                        outputTotal,
                        currentName: directionName,
                        currentAction: `正在生成第 ${displayIndex}/${progressTotal} 组：${directionName}`,
                        updatedAt: new Date().toISOString()
                    };
                    updateCreativeResumeState({
                        phase: 'running',
                        currentIndex: displayIndex,
                        nextIndex: i,
                        completed: getAggregateCompleted(),
                        success: getAggregateSuccess(),
                        failed: getAggregateFailed(),
                        saved: getAggregateSaved(),
                        currentName: directionName,
                        currentAction: automationState.legilTaskProgress.currentAction
                    });

                    logger.info('');
                    logger.info(`🎨 正在处理创意提示词 ${displayIndex}/${progressTotal}: ${directionName}`);

                    try {
                        const result = await legilAutomation.generateImage(promptItem.prompt, i + 1, {
                            saveFolder: creativeConfig.outputFolder,
                            referenceFolder: creativeConfig.referenceFolder || undefined,
                            skipReferenceUpload: !creativeConfig.referenceFolder,
                            generationSettings: creativeGenerationSettings,
                            outputSequence,
                            outputTotal,
                            runId: batchRunId,
                            referenceImageIndex: i + 1,
                            totalReferenceImages: normalizedPrompts.length,
                            referenceImageName: directionName,
                            promptIndexWithinImage: 1,
                            totalPromptsForImage: 1,
                            headless: creativeHeadless,
                            taskType: '创意拓展产图',
                            autoRecoveryEnabled: appConfig.notifications.autoRecoveryEnabled,
                            captureErrorScreenshot: appConfig.notifications.legilScreenshotEnabled,
                            shouldAbort: isLegilStopRequested
                        });

                        if (result.success) {
                            consecutiveFailures = 0;
                            const savedCount = Number(result.savedCount) || 1;
                            outputSequence += savedCount;
                            successCount += 1;
                            savedTotal += savedCount;
                            automationState.legilTaskProgress = {
                                ...(automationState.legilTaskProgress || {}),
                                phase: 'running',
                                currentIndex: displayIndex,
                                completed: getAggregateCompleted(),
                                success: getAggregateSuccess(),
                                failed: getAggregateFailed(),
                                saved: getAggregateSaved(),
                                currentAction: `第 ${displayIndex}/${progressTotal} 组已完成，保存 ${savedCount} 张`,
                                updatedAt: new Date().toISOString()
                            };
                            updateCreativeResumeState({
                                phase: 'running',
                                currentIndex: displayIndex,
                                nextIndex: i + 1,
                                completed: getAggregateCompleted(),
                                success: getAggregateSuccess(),
                                failed: getAggregateFailed(),
                                saved: getAggregateSaved(),
                                currentName: directionName,
                                currentAction: automationState.legilTaskProgress.currentAction
                            });
                            logger.info(`✅ 创意提示词 ${displayIndex}/${progressTotal} 完成，保存 ${savedCount} 张`);
                        } else if (isLegilStopRequested() || String(result.message || '').includes('操作已取消')) {
                            stopped = true;
                            automationState.legilTaskProgress = {
                                ...(automationState.legilTaskProgress || {}),
                                phase: 'stopping',
                                currentAction: '创意拓展任务正在停止...',
                                updatedAt: new Date().toISOString()
                            };
                            updateCreativeResumeState({
                                phase: 'stopping',
                                currentIndex: getAggregateCompleted(),
                                nextIndex: getLocalCompleted(),
                                completed: getAggregateCompleted(),
                                success: getAggregateSuccess(),
                                failed: getAggregateFailed(),
                                saved: getAggregateSaved(),
                                currentName: directionName,
                                currentAction: '创意拓展任务正在停止...'
                            });
                            logger.warn('⏹️ 创意拓展任务已停止');
                            break;
                        } else {
                            failedCount += 1;
                            consecutiveFailures += 1;
                            automationState.legilTaskProgress = {
                                ...(automationState.legilTaskProgress || {}),
                                phase: 'running',
                                currentIndex: displayIndex,
                                completed: getAggregateCompleted(),
                                success: getAggregateSuccess(),
                                failed: getAggregateFailed(),
                                saved: getAggregateSaved(),
                                currentAction: `第 ${displayIndex}/${progressTotal} 组失败：${result.message}`,
                                updatedAt: new Date().toISOString()
                            };
                            updateCreativeResumeState({
                                phase: 'running',
                                currentIndex: displayIndex,
                                nextIndex: i + 1,
                                completed: getAggregateCompleted(),
                                success: getAggregateSuccess(),
                                failed: getAggregateFailed(),
                                saved: getAggregateSaved(),
                                currentName: directionName,
                                currentAction: automationState.legilTaskProgress.currentAction
                            });
                            logger.error(`❌ 创意提示词 ${displayIndex}/${progressTotal} 失败: ${result.message}`);
                            if (
                                appConfig.notifications.pauseOnConsecutiveFailures &&
                                consecutiveFailures >= appConfig.notifications.consecutiveFailureThreshold
                            ) {
                                stopped = true;
                                automationState.legilTaskProgress = {
                                    ...(automationState.legilTaskProgress || {}),
                                    phase: 'stopped',
                                    currentAction: `连续失败 ${consecutiveFailures} 次，创意拓展已暂停，等待确认`,
                                    updatedAt: new Date().toISOString()
                                };
                                updateCreativeResumeState({
                                    phase: 'stopped',
                                    currentIndex: getAggregateCompleted(),
                                    nextIndex: getLocalCompleted(),
                                    completed: getAggregateCompleted(),
                                    success: getAggregateSuccess(),
                                    failed: getAggregateFailed(),
                                    saved: getAggregateSaved(),
                                    currentName: directionName,
                                    currentAction: automationState.legilTaskProgress.currentAction
                                });
                                notifyTaskEvent({
                                    level: 'warning',
                                    title: '创意拓展已暂停',
                                    taskType: '创意拓展产图',
                                    message: `连续失败 ${consecutiveFailures} 次，系统已暂停任务。`,
                                    suggestion: '请检查 Legil 页面、账号登录和提示词内容后点击继续任务。'
                                }, {
                                    key: `creative-paused:${batchRunId}`,
                                    cooldownMs: 0
                                });
                                break;
                            }
                        }
                    } catch (error) {
                        if (isLegilStopRequested() || error.message === '操作已取消') {
                            stopped = true;
                            automationState.legilTaskProgress = {
                                ...(automationState.legilTaskProgress || {}),
                                phase: 'stopping',
                                currentAction: '创意拓展任务正在停止...',
                                updatedAt: new Date().toISOString()
                            };
                            updateCreativeResumeState({
                                phase: 'stopping',
                                currentIndex: getAggregateCompleted(),
                                nextIndex: getLocalCompleted(),
                                completed: getAggregateCompleted(),
                                success: getAggregateSuccess(),
                                failed: getAggregateFailed(),
                                saved: getAggregateSaved(),
                                currentName: directionName,
                                currentAction: '创意拓展任务正在停止...'
                            });
                            logger.warn('⏹️ 创意拓展任务已停止');
                            break;
                        }
                        failedCount += 1;
                        consecutiveFailures += 1;
                        automationState.legilTaskProgress = {
                            ...(automationState.legilTaskProgress || {}),
                            phase: 'running',
                            currentIndex: displayIndex,
                            completed: getAggregateCompleted(),
                            success: getAggregateSuccess(),
                            failed: getAggregateFailed(),
                            saved: getAggregateSaved(),
                            currentAction: `第 ${displayIndex}/${progressTotal} 组出错：${error.message}`,
                            updatedAt: new Date().toISOString()
                        };
                        updateCreativeResumeState({
                            phase: 'running',
                            currentIndex: displayIndex,
                            nextIndex: i + 1,
                            completed: getAggregateCompleted(),
                            success: getAggregateSuccess(),
                            failed: getAggregateFailed(),
                            saved: getAggregateSaved(),
                            currentName: directionName,
                            currentAction: automationState.legilTaskProgress.currentAction
                        });
                        logger.error(`❌ 创意提示词 ${displayIndex}/${progressTotal} 出错: ${error.message}`);
                        if (
                            appConfig.notifications.pauseOnConsecutiveFailures &&
                            consecutiveFailures >= appConfig.notifications.consecutiveFailureThreshold
                        ) {
                            stopped = true;
                            automationState.legilTaskProgress = {
                                ...(automationState.legilTaskProgress || {}),
                                phase: 'stopped',
                                currentAction: `连续失败 ${consecutiveFailures} 次，创意拓展已暂停，等待确认`,
                                updatedAt: new Date().toISOString()
                            };
                            updateCreativeResumeState({
                                phase: 'stopped',
                                currentIndex: getAggregateCompleted(),
                                nextIndex: getLocalCompleted(),
                                completed: getAggregateCompleted(),
                                success: getAggregateSuccess(),
                                failed: getAggregateFailed(),
                                saved: getAggregateSaved(),
                                currentName: directionName,
                                currentAction: automationState.legilTaskProgress.currentAction
                            });
                            notifyTaskEvent({
                                level: 'warning',
                                title: '创意拓展已暂停',
                                taskType: '创意拓展产图',
                                message: `连续失败 ${consecutiveFailures} 次，系统已暂停任务。`,
                                suggestion: '请检查 Legil 页面、账号登录和提示词内容后点击继续任务。'
                            }, {
                                key: `creative-paused:${batchRunId}`,
                                cooldownMs: 0
                            });
                            break;
                        }
                    }

                    if (i < normalizedPrompts.length - 1) {
                        logger.info('等待 5 秒后继续下一组提示词...');
                        try {
                            await sleepWithLegilStop(5000);
                        } catch (error) {
                            stopped = true;
                            updateCreativeResumeState({
                                phase: 'stopping',
                                currentIndex: getAggregateCompleted(),
                                nextIndex: getLocalCompleted(),
                                completed: getAggregateCompleted(),
                                success: getAggregateSuccess(),
                                failed: getAggregateFailed(),
                                saved: getAggregateSaved(),
                                currentAction: '创意拓展任务正在停止...'
                            });
                            logger.warn('⏹️ 创意拓展任务已停止');
                            break;
                        }
                    }
                }

                logger.system('========================================');
                if (stopped) {
                    automationState.legilTaskProgress = {
                        ...(automationState.legilTaskProgress || {}),
                        phase: 'stopped',
                        currentIndex: getAggregateCompleted(),
                        completed: getAggregateCompleted(),
                        success: getAggregateSuccess(),
                        failed: getAggregateFailed(),
                        saved: getAggregateSaved(),
                        currentAction: `创意拓展任务已停止：成功 ${getAggregateSuccess()} 组，失败 ${getAggregateFailed()} 组`,
                        updatedAt: new Date().toISOString()
                    };
                    updateCreativeResumeState({
                        phase: 'stopped',
                        nextIndex: getLocalCompleted(),
                        currentIndex: getAggregateCompleted(),
                        completed: getAggregateCompleted(),
                        success: getAggregateSuccess(),
                        failed: getAggregateFailed(),
                        saved: getAggregateSaved(),
                        currentAction: automationState.legilTaskProgress.currentAction
                    });
                    logger.system(`⏹️ Legil 创意拓展任务已停止：成功 ${getAggregateSuccess()} 组，失败 ${getAggregateFailed()} 组`);
                } else {
                    const completedAllPrompts = getAggregateCompleted() >= progressTotal;
                    automationState.legilTaskProgress = {
                        ...(automationState.legilTaskProgress || {}),
                        phase: 'completed',
                        currentIndex: getAggregateCompleted(),
                        completed: getAggregateCompleted(),
                        success: getAggregateSuccess(),
                        failed: getAggregateFailed(),
                        saved: getAggregateSaved(),
                        currentAction: `创意拓展任务完成：成功 ${getAggregateSuccess()} 组，失败 ${getAggregateFailed()} 组`,
                        updatedAt: new Date().toISOString()
                    };
                    if (completedAllPrompts) {
                        clearCreativeResumeState();
                    } else {
                        updateCreativeResumeState({
                            phase: 'stopped',
                            nextIndex: getLocalCompleted(),
                            currentIndex: getAggregateCompleted(),
                            completed: getAggregateCompleted(),
                            success: getAggregateSuccess(),
                            failed: getAggregateFailed(),
                            saved: getAggregateSaved(),
                            currentAction: automationState.legilTaskProgress.currentAction
                        });
                    }
                    logger.system(`✅ Legil 创意拓展任务完成：成功 ${getAggregateSuccess()} 组，失败 ${getAggregateFailed()} 组`);
                }
                logger.system('========================================');
            } catch (error) {
                const safeMessage = error && error.message ? error.message : String(error || '未知错误');
                interruptedMessage = safeMessage;
                automationState.legilTaskProgress = {
                    ...(automationState.legilTaskProgress || {}),
                    taskType: 'creative-batch',
                    phase: 'interrupted',
                    total: progressTotal,
                    currentIndex: getAggregateCompleted(),
                    completed: getAggregateCompleted(),
                    success: getAggregateSuccess(),
                    failed: getAggregateFailed(),
                    saved: getAggregateSaved(),
                    outputTotal,
                    browserMode: creativeBrowserMode,
                    currentAction: `创意拓展任务被中断：${safeMessage}`,
                    updatedAt: new Date().toISOString()
                };
                updateCreativeResumeState({
                    phase: 'interrupted',
                    nextIndex: getLocalCompleted(),
                    currentIndex: getAggregateCompleted(),
                    completed: getAggregateCompleted(),
                    success: getAggregateSuccess(),
                    failed: getAggregateFailed(),
                    saved: getAggregateSaved(),
                    currentAction: automationState.legilTaskProgress.currentAction
                });
                logger.error(`❌ Legil 创意拓展任务被中断: ${safeMessage}`);
            } finally {
                notifyLegilResult('creative-batch', {
                    successCount: getAggregateSuccess(),
                    failedCount: getAggregateFailed(),
                    interrupted: Boolean(interruptedMessage),
                    message: interruptedMessage || (stopped
                        ? `任务已停止：成功 ${getAggregateSuccess()} 组，失败 ${getAggregateFailed()} 组`
                        : `任务完成：成功 ${getAggregateSuccess()} 组，失败 ${getAggregateFailed()} 组`)
                });
                legilAutomation.saveFolder = previousSaveFolder;
                legilAutomation.referenceFolder = previousReferenceFolder;
                legilAutomation.referenceImages = previousReferenceImages;
                legilAutomation.currentRefIndex = previousRefIndex;
                legilAutomation.generationSettings = previousGenerationSettings;
                automationState.legilTaskRunning = false;
                automationState.legilStopRequested = false;
                automationState.legilTaskType = null;
            }
        })();
    } catch (error) {
        automationState.legilTaskRunning = false;
        automationState.legilStopRequested = false;
        automationState.legilTaskType = null;
        clearCreativeResumeState();
        console.error('Legil 创意拓展启动失败:', error);
        res.json({
            success: false,
            message: '启动失败：' + error.message
        });
    }
});

/**
 * ============================================
 * 第五阶段：豆包自动化 API 接口（基础版，保留兼容）
 * ============================================
 */
app.post('/api/doubao/upload-and-prompt', async (req, res) => {
    const { imagePath } = req.body;

    console.log('\n🤖 收到豆包自动化请求');
    console.log('   图片路径:', imagePath);

    // 验证参数
    if (typeof imagePath !== 'string' || !imagePath.trim()) {
        return res.json({
            success: false,
            response: null,
            message: '请提供图片路径'
        });
    }

    if (workflowController.isRunning) {
        return res.json({
            success: false,
            response: null,
            message: '工作流正在运行中，请稍后再单独运行豆包自动化'
        });
    }

    // 验证文件是否存在
    const normalizedImagePath = normalizeInputPath(imagePath);
    if (!fs.existsSync(normalizedImagePath)) {
        return res.json({
            success: false,
            response: null,
            message: '图片文件不存在'
        });
    }

    try {
        // 调用豆包自动化模块
        const result = await doubaoAutomation.uploadAndPrompt(normalizedImagePath);
        res.json(result);

    } catch (error) {
        console.error('豆包自动化出错:', error);
        res.json({
            success: false,
            response: null,
            message: '服务器错误：' + error.message
        });
    }
});

/**
 * ============================================
 * 第九阶段：完整工作流 API 接口
 * ============================================
 *
 * 请求方法：POST
 * 请求路径：/api/workflow/start
 * 请求参数：{ inputFolder: "输入文件夹路径", outputFolder: "输出文件夹路径" }
 * 返回数据：{ success: true/false, message: "提示信息", stats: {...} }
 */
app.post('/api/workflow/start', async (req, res) => {
    const body = req.body || {};
    const { inputFolder, outputFolder, legilReferenceFolder } = body;
    const workflowConfig = normalizeWorkflowConfigPayload(body);

    console.log('\n🔄 收到完整工作流启动请求（第九阶段）');
    console.log('   输入文件夹:', inputFolder || '使用默认路径');
    console.log('   输出文件夹:', outputFolder || '使用默认路径');
    console.log('   Legil参考图文件夹:', legilReferenceFolder || appConfig.legilReferenceFolder || '使用默认路径');
    console.log('   运行模式:', workflowConfig.browserMode);
    logger.system('收到完整工作流启动请求，正在校验文件夹和配置...');

    if (automationState.legilTaskRunning) {
        logger.warn('工作流启动失败：当前已有 Legil 生成任务正在运行');
        return res.json({
            success: false,
            message: '当前已有 Legil 生成任务正在运行，请稍后再启动工作流'
        });
    }

    const legilRefFolder = legilReferenceFolder || appConfig.legilReferenceFolder;
    const validation = workflowController.validateStart(inputFolder, outputFolder, legilRefFolder);
    if (!validation.success) {
        logger.error(`工作流启动失败：${validation.message}`);
        return res.json({
            success: false,
            message: validation.message
        });
    }

    const doubaoConfig = doubaoAutomation.getConfig();
    if (!doubaoConfig.apiKeyConfigured || !doubaoConfig.modelId) {
        logger.error('工作流启动失败：豆包 API Key 或模型 ID 未配置');
        return res.json({
            success: false,
            message: '请先在豆包API配置中填写火山方舟 API Key 和模型 ID / Endpoint ID'
        });
    }

    appConfig.workflow = workflowConfig;
    persistRuntimeConfig({ workflow: appConfig.workflow });

    // 先返回接受请求的消息
    res.json({
        success: true,
        message: `工作流已启动，将处理 ${validation.totalImages} 张参考图，请在日志中查看进度`,
        totalImages: validation.totalImages
    });
    logger.system(`工作流启动请求已通过校验，将处理 ${validation.totalImages} 张参考图`);

    // 在后台执行工作流（不阻塞响应）
    (async () => {
        try {
            // 使用配置的Legil参考图文件夹
            const result = await workflowController.startWorkflow(
                validation.inputFolder,
                validation.outputFolder,
                validation.legilReferenceFolder,
                {
                    browserMode: workflowConfig.browserMode,
                    ...getLegilRecoveryOptions()
                }
            );
            if (result.success) {
                console.log('\n✅ 工作流执行结果:', result.message);
            } else {
                console.log('\n⚠️ 工作流执行结果:', result.message);
                logger.warn('工作流未完成: ' + result.message);
            }
            notifyWorkflowResult(result, { source: '网页端启动' });
        } catch (error) {
            console.error('\n❌ 工作流执行出错:', error.message);
            logger.error('工作流执行出错: ' + error.message);
            notifyTaskEvent({
                level: 'error',
                title: '工作流执行出错',
                taskType: '量产工作流',
                progress: compactProgress(getHealthSnapshot()),
                message: error.message,
                suggestion: '可发送“进度”查看详情；如有可恢复任务，可发送“继续任务”。'
            }, {
                key: `workflow-throw:${error.message}`,
                cooldownMs: 0
            });
        }
    })();
});

/**
 * ============================================
 * 第九阶段：获取工作流状态
 * ============================================
 */
app.get('/api/workflow/status', (req, res) => {
    const status = workflowController.getStatus();

    res.json({
        success: true,
        status: status,
        message: status.isRunning ? '工作流运行中' : '工作流未运行'
    });
});

app.get('/api/workflow/resume-info', (req, res) => {
    const resumeInfo = workflowController.getResumeInfo();
    res.json({
        success: true,
        resume: resumeInfo
    });
});

app.post('/api/workflow/resume', async (req, res) => {
    console.log('\n↩️ 收到继续上次工作流请求');

    if (automationState.legilTaskRunning) {
        return res.json({
            success: false,
            message: '当前已有 Legil 生成任务正在运行，请稍后再继续工作流'
        });
    }

    const resumeInfo = workflowController.getResumeInfo();
    if (!resumeInfo.hasResume) {
        return res.json({
            success: false,
            message: '没有可继续的上次任务'
        });
    }

    const doubaoConfig = doubaoAutomation.getConfig();
    if (!doubaoConfig.apiKeyConfigured || !doubaoConfig.modelId) {
        return res.json({
            success: false,
            message: '请先在豆包API配置中填写火山方舟 API Key 和模型 ID / Endpoint ID'
        });
    }

    res.json({
        success: true,
        message: `已继续上次任务：第 ${resumeInfo.imageIndex}/${resumeInfo.totalImages} 张参考图，从提示词 ${resumeInfo.promptIndex}/${resumeInfo.totalPrompts} 开始`,
        resume: resumeInfo
    });

    (async () => {
        try {
            const result = await workflowController.resumeWorkflow(getLegilRecoveryOptions());
            if (result.success) {
                console.log('\n✅ 继续工作流执行结果:', result.message);
            } else {
                console.log('\n⚠️ 继续工作流执行结果:', result.message);
                logger.warn('继续工作流未完成: ' + result.message);
            }
            notifyWorkflowResult(result, { source: '继续任务' });
        } catch (error) {
            console.error('\n❌ 继续工作流执行出错:', error.message);
            logger.error('继续工作流执行出错: ' + error.message);
            notifyTaskEvent({
                level: 'error',
                title: '继续工作流出错',
                taskType: '量产工作流',
                progress: compactProgress(getHealthSnapshot()),
                message: error.message,
                suggestion: '可发送“进度”查看详情。'
            }, {
                key: `workflow-resume-throw:${error.message}`,
                cooldownMs: 0
            });
        }
    })();
});

app.post('/api/workflow/clear-resume', (req, res) => {
    workflowController.clearResume();
    res.json({
        success: true,
        message: '已清除上次任务记录'
    });
});

/**
 * ============================================
 * 获取工作流最近一次提取的提示词
 * ============================================
 */
app.get('/api/workflow/extracted-prompts', (req, res) => {
    const prompts = workflowController.getLastExtractedPrompts();

    if (prompts) {
        res.json({
            success: true,
            prompts: prompts,
            message: `获取到 ${prompts.length} 组提示词`
        });
    } else {
        res.json({
            success: false,
            prompts: [],
            message: '尚未提取提示词，请先运行工作流'
        });
    }
});

/**
 * ============================================
 * 第九阶段：停止工作流
 * ============================================
 */
app.post('/api/workflow/stop', async (req, res) => {
    console.log('\n⏹️ 收到停止工作流请求');

    const result = await workflowController.stopWorkflow();
    const resumeInfo = workflowController.getResumeInfo();
    if (result.success) {
        notifyTaskEvent({
            level: 'warning',
            title: '工作流已停止',
            taskType: '量产工作流',
            progress: compactProgress(getHealthSnapshot()),
            message: result.message,
            suggestion: resumeInfo.hasResume ? '已保存可继续任务，可发送“继续任务”。' : '当前没有可继续任务。'
        }, {
            key: `workflow-stop:${Date.now()}`,
            cooldownMs: 0
        });
    }

    res.json({
        success: result.success,
        message: result.message,
        resume: resumeInfo
    });
});

/**
 * ============================================
 * 新增 API：保存 Legil 参考图文件夹配置
 * ============================================
 */
app.post('/api/config/legil-ref-folder', (req, res) => {
    const { folderPath } = req.body;

    console.log('\n📁 收到 Legil 参考图文件夹配置');
    console.log('   路径:', folderPath);

    if (typeof folderPath !== 'string' || !folderPath.trim()) {
        return res.json({
            success: false,
            message: '请提供文件夹路径'
        });
    }

    // 验证路径是否存在
    try {
        const normalizedFolderPath = normalizeInputPath(folderPath);

        if (!fs.existsSync(normalizedFolderPath)) {
            return res.json({
                success: false,
                message: '路径不存在，请检查路径是否正确'
            });
        }

        const stats = fs.statSync(normalizedFolderPath);
        if (!stats.isDirectory()) {
            return res.json({
                success: false,
                message: '提供的路径不是文件夹'
            });
        }

        // 保存配置
        appConfig.legilReferenceFolder = normalizedFolderPath;
        persistRuntimeConfig({ legilReferenceFolder: normalizedFolderPath });
        console.log('   ✅ 配置已保存');

        // 同时更新 legil 自动化模块的配置
        legilAutomation.setReferenceFolder(normalizedFolderPath);

        res.json({
            success: true,
            message: '配置已保存',
            folderPath: normalizedFolderPath
        });

    } catch (error) {
        console.error('   ❌ 保存配置失败:', error.message);
        res.json({
            success: false,
            message: '保存配置失败: ' + error.message
        });
    }
});

/**
 * ============================================
 * 新增 API：获取 Legil 参考图文件夹配置
 * ============================================
 */
app.get('/api/config/legil-ref-folder', (req, res) => {
    res.json({
        success: true,
        folderPath: appConfig.legilReferenceFolder,
        message: '获取配置成功'
    });
});

/**
 * ============================================
 * 第四阶段：新增 SSE 日志接口
 * ============================================
 *
 * 使用 SSE（Server-Sent Events）技术实现服务器向客户端推送日志
 * 前端通过 EventSource API 连接此接口，实时接收日志
 *
 * 请求方法：GET
 * 请求路径：/api/logs
 */
app.get('/api/logs/recent', (req, res) => {
    const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 50));
    res.json({
        success: true,
        logs: logger.getRecentLogs(limit)
    });
});

app.get('/api/logs', (req, res) => {
    console.log('📡 新的日志客户端正在连接...');

    // 将响应对象交给 logger 管理
    logger.addClient(res);

    // 发送初始连接成功消息
    logger.system('实时日志连接已建立');
});

/**
 * 启动服务器
 */
const server = app.listen(PORT, () => {
    console.log('========================================');
    console.log('🚀 服务器启动成功！');
    console.log('========================================');
    console.log(`📍 请打开浏览器访问: http://localhost:${PORT}`);
    console.log('📂 按 Ctrl+C 可以停止服务器');
    console.log('========================================');
    console.log('✨ 已启用功能：');
    console.log('   ✅ 文件夹图片统计（第二阶段）');
    console.log('   ✅ Playwright 浏览器自动化（第三阶段）');
    console.log('      - 登录状态自动保存（只需登录一次）');
    console.log('   ✅ 实时日志系统（第四阶段）');
    console.log('      - 服务器主动推送日志');
    console.log('   ✅ 豆包大模型 API（第五阶段）');
    console.log('      - 读取本地参考图并调用火山方舟 API');
    console.log('      - 直接返回五组规整提示词');
    console.log('   ✅ API 提示词解析（第六阶段）');
    console.log('      - 不再打开豆包网页，不再等待网页回复');
    console.log('   ✅ Legil 平台自动化（第七阶段）');
    console.log('      - 自动输入提示词生成图片');
    console.log('      - 自动保存生成结果');
    console.log('   ✅ Legil 参考图功能（新增）');
    console.log('      - 自动上传参考图到 Legil');
    console.log('      - 支持循环使用多张参考图');
    console.log('   ✅ 完整工作流自动化（第九阶段）');
    console.log('      - 循环处理所有参考图');
    console.log('      - 豆包 API 生成提示词后自动进入 Legil');
    console.log('========================================');
});

server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
        console.error(`❌ 端口 ${PORT} 已被占用，请关闭旧服务或使用 PORT 环境变量指定其他端口`);
        process.exitCode = 1;
        return;
    }

    console.error('❌ 服务器启动失败:', error.message);
    process.exitCode = 1;
});

const feishuCliConfigOnStart = readFeishuCliConfig();
if (feishuCliConfigOnStart.enabled) {
    feishuCliBridge.start(feishuCliConfigOnStart).catch(error => {
        logger.error('飞书 CLI 桥接自动启动失败: ' + error.message);
    });
}

const watchdogStartResult = ensureFeishuWatchdogProcess('server-start');
if (watchdogStartResult.success) {
    logger.system(`飞书守护监控启动检查完成: ${watchdogStartResult.message}`);
} else if (!watchdogStartResult.skipped) {
    logger.warn(watchdogStartResult.message);
}

healthMonitor = new HealthMonitor({
    snapshotProvider: async () => getHealthSnapshot(),
    notifier: feishuNotifier,
    intervalMs: Number(process.env.HEALTH_MONITOR_INTERVAL_MS) || 60 * 1000,
    staleWarningMs: Number(process.env.HEALTH_STALE_WARNING_MS) || appConfig.notifications.staleThresholdMinutes * 60 * 1000,
    staleErrorMs: Number(process.env.HEALTH_STALE_ERROR_MS) || Math.max(appConfig.notifications.staleThresholdMinutes * 2 * 60 * 1000, appConfig.notifications.staleThresholdMinutes * 60 * 1000 + 60 * 1000),
    shouldNotifyStale: () => Boolean(appConfig.notifications.feishuEnabled && appConfig.notifications.staleProgressEnabled)
});
healthMonitor.start();

setTimeout(() => {
    try {
        const snapshot = getHealthSnapshot();
        if (appConfig.notifications.feishuEnabled && appConfig.notifications.serverStartupEnabled) {
            healthMonitor.notifyStartup(snapshot);
        }
        healthMonitor.check().catch(error => {
            logger.warn('健康监控首次检查失败: ' + error.message);
        });
    } catch (error) {
        logger.warn('健康监控启动通知失败: ' + error.message);
    }
}, Number(process.env.HEALTH_STARTUP_NOTIFY_DELAY_MS) || 8000).unref();

let shuttingDown = false;
async function gracefulShutdown(signal) {
    if (shuttingDown) {
        return;
    }

    shuttingDown = true;
    console.log(`\n收到 ${signal}，正在保存浏览器登录状态并关闭服务...`);

    if (healthMonitor) {
        healthMonitor.stop();
    }

    try {
        await feishuNotifier.notify({
            level: 'warning',
            title: '服务器正在关闭',
            message: `收到 ${signal}，服务正在停止。`,
            suggestion: '如非主动操作，请稍后检查服务是否已重新启动。'
        }, {
            key: `server-shutdown:${signal}:${Date.now()}`,
            cooldownMs: 0
        });
    } catch (error) {
        console.error('发送服务器关闭通知时出错:', error.message);
    }

    try {
        await feishuCliBridge.stop();
    } catch (error) {
        console.error('停止飞书 CLI 桥接时出错:', error.message);
    }

    try {
        await browserController.closeBrowser();
    } catch (error) {
        console.error('关闭浏览器时出错:', error.message);
    }

    server.close(() => {
        console.log('服务器已关闭');
        process.exit(0);
    });

    setTimeout(() => {
        console.log('关闭超时，强制退出');
        process.exit(0);
    }, 5000).unref();
}

process.on('SIGINT', () => {
    gracefulShutdown('SIGINT');
});

process.on('SIGTERM', () => {
    gracefulShutdown('SIGTERM');
});
