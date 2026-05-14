/**
 * 后台运行上下文。
 *
 * 这里集中创建后台接口会共用的对象、配置和小工具函数。routes 文件只负责声明接口，
 * 需要什么依赖都从这个 context 里拿。
 */

// 引入 express 模块
const express = require('express');

// 引入 path 模块，用于处理文件路径
const path = require('path');
const ROOT_DIR = path.join(__dirname, '..', '..');
const { createApp } = require('../app');

// 引入 fs 模块，文件系统模块
const fs = require('fs');
const axios = require('axios');
const crypto = require('crypto');
const { execFile, spawn } = require('child_process');
const { Worker } = require('worker_threads');

// 引入 Playwright 浏览器控制器
const browserController = require('../../playwright-controller');

// 引入实时日志系统（第四阶段新增）
const logger = require('../../logger');

// 引入豆包自动化模块（第五阶段新增）
const doubaoAutomation = require('../../doubao-automation');

// 引入 Legil 自动化模块（第七阶段新增）
const legilAutomation = require('../../legil-automation');

// 引入工作流控制器（第九阶段新增）
const workflowController = require('../../workflow-controller');

const { formatDateTimeForFile, sortNaturallyByName } = require('../../file-utils');
const { readConfig, updateConfig } = require('../../config-store');
const { readSecrets } = require('../../secrets-store');
const { parseCreativePromptWorkbook } = require('../../creative-table-parser');
const { buildCreativeAgentQualityReport } = require('../../creative-agent-quality');
const {
    CREATIVE_AGENT_OUTPUT_DIR,
    getCreativeAgentStatus,
    getStoredWinkyConfig,
    sanitizeCreativeAgentError
} = require('../../creative-agent-service');
const feishuCliBridge = require('../../feishu-cli-bridge');
const { FeishuControlService } = require('../../feishu-control-service');
const { CARD_ACTIONS } = require('../../feishu-card-builder');
const { FeishuNotificationService } = require('../../feishu-notification-service');
const { HealthMonitor, compactProgress } = require('../../health-monitor');
const {
    readFeishuCliConfig,
    getSafeFeishuCliConfig,
    validateFeishuCliConfig
} = require('../../feishu-cli-config');

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
const WATCHDOG_SCRIPT_PATH = path.join(ROOT_DIR, 'feishu-watchdog.js');
const WATCHDOG_STATUS_PATH = path.join(ROOT_DIR, 'runtime', 'feishu-watchdog.status.json');
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
    const fallbackSettings = appConfig.workflow?.generationSettings || legilAutomation.getConfig().settings || DEFAULT_WORKFLOW_CONFIG.generationSettings;
    return {
        browserMode: normalizeBrowserMode(
            payload.browserMode,
            appConfig.workflow?.browserMode || DEFAULT_WORKFLOW_CONFIG.browserMode
        ),
        generationSettings: normalizeLegilGenerationSettings(
            payload.generationSettings,
            fallbackSettings
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

        const worker = new Worker(path.join(ROOT_DIR, 'creative-agent-worker.js'), {
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
    const serverPath = path.join(ROOT_DIR, 'server.js');
    const serverDir = ROOT_DIR;
    const nodePath = process.execPath;
    const outPath = path.join(ROOT_DIR, 'server-runtime.log');
    const errPath = path.join(ROOT_DIR, 'server-runtime.err.log');

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
        cwd: ROOT_DIR,
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
            cwd: ROOT_DIR,
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
                    generationSettings: appConfig.workflow.generationSettings || legilAutomation.getConfig().settings,
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

const PORT = Number(process.env.PORT) || 3066;

function createRouteContext() {
    const context = {
        rootDir: ROOT_DIR,
        ROOT_DIR,
        PORT,
        express,
        path,
        fs,
        axios,
        crypto,
        execFile,
        spawn,
        Worker,
        browserController,
        logger,
        doubaoAutomation,
        legilAutomation,
        workflowController,
        formatDateTimeForFile,
        sortNaturallyByName,
        readConfig,
        updateConfig,
        readSecrets,
        parseCreativePromptWorkbook,
        buildCreativeAgentQualityReport,
        CREATIVE_AGENT_OUTPUT_DIR,
        getCreativeAgentStatus,
        getStoredWinkyConfig,
        sanitizeCreativeAgentError,
        feishuCliBridge,
        FeishuControlService,
        CARD_ACTIONS,
        FeishuNotificationService,
        HealthMonitor,
        compactProgress,
        readFeishuCliConfig,
        getSafeFeishuCliConfig,
        validateFeishuCliConfig,
        persistedConfig,
        IMAGE_EXTENSIONS,
        DEFAULT_RESIZE_CONFIG,
        DEFAULT_WORKFLOW_CONFIG,
        DEFAULT_NOTIFICATION_CONFIG,
        DEFAULT_CREATIVE_CONFIG,
        normalizeNotificationConfig,
        appConfig,
        automationState,
        serverStartedAt,
        feishuNotifier,
        WATCHDOG_SCRIPT_PATH,
        WATCHDOG_STATUS_PATH,
        creativeAgentTasks,
        CREATIVE_AGENT_TASK_MAX_AGE_MS,
        clampNumber,
        normalizeCreativeBatchPromptItems,
        normalizeCreativeResumeState,
        persistCreativeResumeState,
        setCreativeResumeState,
        updateCreativeResumeState,
        clearCreativeResumeState,
        getCreativeResumeInfo,
        getCreativeProgressSnapshot,
        sameCreativePromptIdentity,
        isCreativeResumeStartRequest,
        resolveCreativeBatchRunContext,
        normalizeInputPath,
        listImageFilesInFolder,
        normalizeBrowserMode,
        normalizeWorkflowConfigPayload,
        normalizeResizeConfigPayload,
        normalizeCreativeBrowserMode,
        normalizeCreativeConfigPayload,
        normalizeLegilGenerationSettings,
        chooseFolderWithNativeDialog,
        isCreativeAgentTaskFinal,
        cleanupCreativeAgentTasks,
        publicCreativeAgentTask,
        updateCreativeAgentTask,
        settleCreativeAgentTask,
        startCreativeAgentTask,
        getCreativeAgentTask,
        cancelCreativeAgentTask,
        hasActiveCreativeAgentTask,
        isLegilBusy,
        isLegilStopRequested,
        requestLegilTaskStop,
        waitForPromise,
        buildRestartHelperScript,
        scheduleLocalServerRestart,
        sleepWithLegilStop,
        toPositiveIndex,
        persistRuntimeConfig,
        parseCsvConfig,
        getFeishuConfig,
        buildFeishuBotSignature,
        sendFeishuText,
        getCreativeAgentTaskSnapshot,
        readWatchdogStatus,
        ensureFeishuWatchdogProcess,
        getHealthSnapshot,
        notifyTaskEvent,
        notifyWorkflowResult,
        notifyLegilResult,
        notifyLegilException,
        getLegilRecoveryOptions,
        applyNotificationRuntimeConfig,
        verifyFeishuEventToken,
        extractFeishuCommandText,
        normalizeFeishuCommandText,
        assertFeishuChatAllowed,
        getPhaseLabel,
        buildPlatformStatusText,
        startWorkflowFromCurrentConfig,
        resumeWorkflowFromFeishu,
        startCreativeResumeFromFeishu,
        stopAutomationFromFeishu,
        resumeAutomationFromFeishu,
        restartAutomationFromFeishu,
        buildFeishuHelpText,
        executeFeishuCommand,
        handleFeishuEvent,
        handleFeishuCardActionEvent,
        isLoopbackRequest,
        escapeHtml,
        renderFeishuCardActionPage,
        getHealthMonitor
    };

    Object.defineProperties(context, {
        healthMonitor: { enumerable: true, get: () => healthMonitor },
        watchdogStartAttempted: { enumerable: true, get: () => watchdogStartAttempted, set: value => { watchdogStartAttempted = value; } },
        creativeResumeState: { enumerable: true, get: () => creativeResumeState, set: value => { creativeResumeState = value; } },
        serverRestartScheduled: { enumerable: true, get: () => serverRestartScheduled, set: value => { serverRestartScheduled = value; } }
    });

    return context;
}

function getHealthMonitor() {
    return healthMonitor;
}

function setHealthMonitor(nextHealthMonitor) {
    healthMonitor = nextHealthMonitor;
}

module.exports = {
    PORT,
    ROOT_DIR,
    appConfig,
    browserController,
    logger,
    feishuNotifier,
    feishuCliBridge,
    HealthMonitor,
    readFeishuCliConfig,
    ensureFeishuWatchdogProcess,
    getHealthSnapshot,
    createRouteContext,
    getHealthMonitor,
    setHealthMonitor
};
