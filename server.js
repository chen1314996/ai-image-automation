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
const { execFile } = require('child_process');
const { Worker } = require('worker_threads');
const XLSX = require('xlsx');

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
const {
    CREATIVE_AGENT_OUTPUT_DIR,
    getCreativeAgentStatus,
    getStoredWinkyConfig
} = require('./creative-agent-service');

const persistedConfig = readConfig();

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
const DEFAULT_RESIZE_CONFIG = {
    inputFolder: 'D:\\工作\\自动化工作流1\\Legil批量改尺寸\\输入',
    outputFolder: 'D:\\工作\\自动化工作流1\\Legil批量改尺寸\\输出',
    promptTemplate: '',
    generationSettings: {
        imageModel: 'nano-banana-2',
        aspectRatio: '16:9',
        resolution: '1K',
        outputQuantity: 1
    }
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

/**
 * ============================================
 * 全局配置存储
 * ============================================
 */
const appConfig = {
    legilReferenceFolder: persistedConfig.legilReferenceFolder || 'D:\\工作\\自动化工作流1\\批量产图\\参考图',
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

let creativeResumeState = null;

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

    const total = prompts.length;
    const nextIndex = clampNumber(
        state.nextIndex !== undefined ? state.nextIndex : state.completed,
        0,
        total
    );
    const phase = String(state.phase || 'interrupted');
    const generationSettings = normalizeLegilGenerationSettings(
        state.generationSettings,
        appConfig.creative && appConfig.creative.generationSettings
            ? appConfig.creative.generationSettings
            : DEFAULT_CREATIVE_CONFIG.generationSettings
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
        nextIndex,
        currentIndex: clampNumber(state.currentIndex, 0, total),
        completed: clampNumber(state.completed !== undefined ? state.completed : nextIndex, 0, total),
        success: clampNumber(state.success, 0, total),
        failed: clampNumber(state.failed, 0, total),
        saved: clampNumber(state.saved, 0),
        outputTotal: clampNumber(state.outputTotal, 0),
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

function normalizeResizeConfigPayload(payload = {}) {
    const inputFolder = normalizeInputPath(payload.inputFolder) || appConfig.resize.inputFolder || DEFAULT_RESIZE_CONFIG.inputFolder;
    const outputFolder = normalizeInputPath(payload.outputFolder) || appConfig.resize.outputFolder || DEFAULT_RESIZE_CONFIG.outputFolder;
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
        promptTemplate,
        generationSettings
    };
}

function normalizeCreativeBrowserMode(value, fallback = 'headed') {
    if (value === 'headless' || value === 'headed') {
        return value;
    }
    return fallback === 'headless' ? 'headless' : 'headed';
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

function runCreativeAgentInWorker(payload) {
    return new Promise((resolve, reject) => {
        const worker = new Worker(path.join(__dirname, 'creative-agent-worker.js'), {
            workerData: payload
        });

        let settled = false;
        const settle = (callback, value) => {
            if (settled) return;
            settled = true;
            callback(value);
        };

        worker.once('message', message => {
            if (message && message.success) {
                settle(resolve, message.result);
                return;
            }
            settle(reject, new Error((message && message.message) || '创意拓展 Agent 执行失败'));
        });

        worker.once('error', error => {
            settle(reject, error);
        });

        worker.once('exit', code => {
            if (code !== 0) {
                settle(reject, new Error(`创意拓展 Agent worker 已退出，退出码 ${code}`));
            }
        });
    });
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

    return {
        success: true,
        message: '已发送停止指令，当前步骤结束后会停止'
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

function normalizeCellText(value) {
    if (value === null || value === undefined) {
        return '';
    }
    return String(value).replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
}

function isPromptHeader(header) {
    const text = String(header || '').toLowerCase().replace(/\s+/g, '');
    if (/原方向|新方向|方向描述|方向简析|简析|解析|名称|标签|路径|序号|编号/.test(text)) {
        return false;
    }
    return /^(提示词\d*|画面提示词\d*|生图提示词\d*|图片提示词\d*|prompt\d*|imageprompt\d*)$/.test(text) ||
        /提示词\d+$|prompt\d+$|画面提示词/.test(text);
}

function isDirectionHeader(header) {
    const text = String(header || '').toLowerCase().replace(/\s+/g, '');
    return /方向|方向描述|主题|标题|名称|分类|类型|subject|title|category/.test(text);
}

function directionHeaderScore(header) {
    const text = String(header || '').toLowerCase().replace(/\s+/g, '');
    if (/新方向名称|新标题|新主题/.test(text)) return 0;
    if (/方向名称|标题|主题|title|subject/.test(text)) return 10;
    if (/原方向名称/.test(text)) return 20;
    if (/方向描述|描述/.test(text)) return 40;
    return 50;
}

function rowHasHeaderKeywords(row) {
    const joined = row.map(normalizeCellText).join(' ').toLowerCase();
    return /提示词|prompt|方向|主题|标题|画面/.test(joined);
}

function findHeaderRow(rows) {
    const maxRows = Math.min(rows.length, 8);
    for (let i = 0; i < maxRows; i++) {
        const cells = rows[i].map(normalizeCellText).filter(Boolean);
        if (cells.length >= 2 && rowHasHeaderKeywords(cells)) {
            return i;
        }
    }
    return -1;
}

function chooseLongestText(cells, minLength = 12) {
    return cells
        .map((text, index) => ({ text: normalizeCellText(text), index }))
        .filter(item => item.text.length >= minLength)
        .sort((a, b) => b.text.length - a.text.length)[0] || null;
}

function extractCreativePromptsFromRows(rows, sheetName = '') {
    const cleanRows = rows
        .map(row => (Array.isArray(row) ? row : []).map(normalizeCellText))
        .filter(row => row.some(Boolean));

    if (cleanRows.length === 0) {
        return [];
    }

    const headerRowIndex = findHeaderRow(cleanRows);
    const hasHeader = headerRowIndex >= 0;
    const headers = hasHeader ? cleanRows[headerRowIndex] : [];
    const dataRows = hasHeader ? cleanRows.slice(headerRowIndex + 1) : cleanRows;
    const promptColumnIndexes = [];
    const directionColumnIndexes = [];

    if (hasHeader) {
        headers.forEach((header, index) => {
            if (isPromptHeader(header)) {
                promptColumnIndexes.push(index);
            } else if (isDirectionHeader(header)) {
                directionColumnIndexes.push(index);
            }
        });
    }

    const prompts = [];
    const seen = new Set();

    dataRows.forEach((row, rowOffset) => {
        const sourceRow = (hasHeader ? headerRowIndex + rowOffset + 2 : rowOffset + 1);
        const cells = row.map(normalizeCellText);
        const direction = directionColumnIndexes
            .map(index => ({
                text: cells[index] || '',
                score: directionHeaderScore(headers[index] || '')
            }))
            .filter(item => item.text)
            .sort((a, b) => a.score - b.score)[0]?.text || '';

        const promptSources = promptColumnIndexes.length > 0
            ? promptColumnIndexes.map(index => ({
                prompt: cells[index] || '',
                columnIndex: index,
                title: headers[index] || `提示词${index + 1}`
            }))
            : (() => {
                const chosen = chooseLongestText(cells, 12);
                return chosen ? [{
                    prompt: chosen.text,
                    columnIndex: chosen.index,
                    title: hasHeader ? (headers[chosen.index] || '提示词') : '提示词'
                }] : [];
            })();

        promptSources.forEach((source, promptOffset) => {
            const prompt = normalizeCellText(source.prompt);
            if (!prompt || prompt.length < 8) {
                return;
            }

            const key = prompt.replace(/\s+/g, ' ').trim().toLowerCase();
            if (seen.has(key)) {
                return;
            }
            seen.add(key);

            const promptTitle = normalizeCellText(source.title) || `提示词${promptOffset + 1}`;
            const directionTitle = direction || `表格第${sourceRow}行`;

            prompts.push({
                index: prompts.length + 1,
                sourceRow,
                sheetName,
                direction: directionTitle.slice(0, 200),
                promptTitle: promptTitle.slice(0, 80),
                promptColumn: Number.isFinite(Number(source.columnIndex)) ? Number(source.columnIndex) + 1 : null,
                prompt: prompt.slice(0, 10000),
                selected: true
            });
        });
    });

    return prompts;
}

function countPromptColumnsInRows(rows) {
    const cleanRows = (Array.isArray(rows) ? rows : [])
        .map(row => (Array.isArray(row) ? row : []).map(normalizeCellText))
        .filter(row => row.some(Boolean));

    const headerRowIndex = findHeaderRow(cleanRows);
    if (headerRowIndex < 0) {
        return 0;
    }

    return cleanRows[headerRowIndex].filter(isPromptHeader).length;
}

function chooseCreativePromptSheet(workbook) {
    const sheetNames = Array.isArray(workbook.SheetNames) ? workbook.SheetNames : [];
    if (sheetNames.length === 0) {
        return '';
    }

    const normalizeSheetName = (name) => String(name || '').replace(/\s+/g, '').toLowerCase();
    const exactTarget = sheetNames.find(name => normalizeSheetName(name) === '新方向拓展表');
    if (exactTarget) {
        return exactTarget;
    }

    const fuzzyTarget = sheetNames.find(name => normalizeSheetName(name).includes('新方向拓展'));
    if (fuzzyTarget) {
        return fuzzyTarget;
    }

    let best = {
        name: sheetNames[0],
        score: -1
    };

    for (const name of sheetNames) {
        const rows = XLSX.utils.sheet_to_json(workbook.Sheets[name], {
            header: 1,
            raw: false,
            defval: ''
        });
        const promptColumnCount = countPromptColumnsInRows(rows);
        const rowCount = Array.isArray(rows) ? rows.filter(row => Array.isArray(row) && row.some(Boolean)).length : 0;
        const score = promptColumnCount * 100000 + rowCount;
        if (score > best.score) {
            best = { name, score };
        }
    }

    return best.name;
}

function parseCreativePromptWorkbook(fileName, base64Content) {
    if (typeof base64Content !== 'string' || !base64Content.trim()) {
        throw new Error('请先上传表格文件');
    }

    const buffer = Buffer.from(base64Content.replace(/^data:.*?;base64,/, ''), 'base64');
    if (!buffer.length) {
        throw new Error('表格文件为空');
    }

    const ext = path.extname(String(fileName || '')).toLowerCase();
    const workbook = ext === '.csv' || ext === '.txt'
        ? XLSX.read(buffer.toString('utf8').replace(/^\uFEFF/, ''), {
            type: 'string',
            cellDates: false,
            raw: false
        })
        : XLSX.read(buffer, {
            type: 'buffer',
            cellDates: false,
            raw: false
        });

    const sheetName = chooseCreativePromptSheet(workbook);
    if (!sheetName) {
        throw new Error('表格中没有可读取的工作表');
    }

    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        raw: false,
        defval: ''
    });

    const prompts = extractCreativePromptsFromRows(rows, sheetName);
    if (prompts.length === 0) {
        throw new Error('没有从表格中提取到有效画面提示词，请确认存在“画面提示词/提示词/prompt”等列');
    }

    return {
        fileName: path.basename(String(fileName || '表格文件')),
        sheetName,
        prompts
    };
}

function persistRuntimeConfig(extra = {}) {
    const doubaoConfig = doubaoAutomation.getConfig();
    return updateConfig({
        legilReferenceFolder: appConfig.legilReferenceFolder,
        resize: {
            ...appConfig.resize
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
    const legilProgress = automationState.legilTaskProgress || {};
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
            const result = await workflowController.startWorkflow(
                validation.inputFolder,
                validation.outputFolder,
                validation.legilReferenceFolder
            );
            await sendFeishuText(`完整工作流执行结束：${result.message || (result.success ? '已完成' : '未完成')}`);
        } catch (error) {
            logger.error('飞书启动的完整工作流执行出错: ' + error.message);
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
            const result = await workflowController.resumeWorkflow();
            await sendFeishuText(`完整工作流继续执行结束：${result.message || (result.success ? '已完成' : '未完成')}`);
        } catch (error) {
            logger.error('飞书继续完整工作流出错: ' + error.message);
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
        generationSettings: resumeInfo.generationSettings
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

    const text = extractFeishuCommandText(body);
    if (!text) {
        return '';
    }

    return await executeFeishuCommand(text);
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
        res.json({
            success: true,
            ...parsed,
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
        const result = await legilAutomation.generateImage(prompt.trim(), safePromptIndex);
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
                        totalPromptsForImage: normalizedPrompts.length
                    });

                    if (result.success) {
                        const savedCount = Number(result.savedCount) || 1;
                        outputSequence += savedCount;
                        logger.info(`✅ 第 ${i + 1} 组生成成功，保存 ${savedCount} 张图片: ${path.basename(result.savePath)}`);
                    } else {
                        logger.error(`❌ 第 ${i + 1} 张图片生成失败: ${result.message}`);
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
            logger.info(`输入图片数量: ${imageFiles.length}`);
            logger.info(`改尺寸 Legil 参数: 模型 ${legilAutomation.getImageModelLabel(resizeGenerationSettings.imageModel)}，宽高比 ${resizeGenerationSettings.aspectRatio}，分辨率 ${resizeGenerationSettings.resolution}，输出数量 ${resizeGenerationSettings.outputQuantity}`);
            logger.system('========================================');

            let outputSequence = 1;
            let successCount = 0;
            let failedCount = 0;
            let stopped = false;

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
                            generationSettings: resizeGenerationSettings,
                            outputSequence,
                            outputTotal,
                            runId: batchRunId,
                            referenceImageIndex: i + 1,
                            totalReferenceImages: imageFiles.length,
                            referenceImageName: imageName,
                            promptIndexWithinImage: 1,
                            totalPromptsForImage: 1,
                            shouldAbort: isLegilStopRequested
                        });

                        if (result.success) {
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
                            logger.error(`❌ 改尺寸图片 ${i + 1}/${imageFiles.length} 失败: ${result.message}`);
                        }
                    } catch (error) {
                        if (isLegilStopRequested() || error.message === '操作已取消') {
                            stopped = true;
                            logger.warn('⏹️ 改尺寸任务已停止');
                            break;
                        }
                        failedCount += 1;
                        logger.error(`❌ 改尺寸图片 ${i + 1}/${imageFiles.length} 出错: ${error.message}`);
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
                logger.error(`❌ Legil 批量改尺寸任务被中断: ${safeMessage}`);
            } finally {
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

        const agentResult = await runCreativeAgentInWorker({
            apiUrl,
            apiKey,
            model,
            provider,
            instruction,
            targetCount,
            attachments
        });

        logger.log(`创意拓展 Agent 已生成表格: ${agentResult.fileName}`, 'success');
        logger.info(agentResult.message);

        res.json({
            success: true,
            ...agentResult
        });
    } catch (error) {
        const safeMessage = String(error && error.message ? error.message : error || '未知错误').replaceAll(apiKey, '[REDACTED]');
        logger.error(`创意拓展 Agent 调用失败: ${safeMessage}`);
        res.status(500).json({
            success: false,
            message: '创意拓展 Agent 调用失败: ' + safeMessage
        });
    }
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
        const outputTotal = normalizedPrompts.length * (Number(creativeGenerationSettings.outputQuantity) || 1);
        automationState.legilTaskProgress = {
            taskType: 'creative-batch',
            phase: 'queued',
            total: normalizedPrompts.length,
            currentIndex: 0,
            completed: 0,
            success: 0,
            failed: 0,
            saved: 0,
            outputTotal,
            browserMode: creativeBrowserMode,
            currentName: '',
            currentAction: '创意拓展任务已排队，准备开始...',
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
            total: normalizedPrompts.length,
            nextIndex: 0,
            currentIndex: 0,
            completed: 0,
            success: 0,
            failed: 0,
            saved: 0,
            outputTotal,
            currentName: '',
            currentAction: '创意拓展任务已排队，准备开始...',
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

            let outputSequence = 1;
            let successCount = 0;
            let failedCount = 0;
            let savedTotal = 0;
            let stopped = false;

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
                    automationState.legilTaskProgress = {
                        ...(automationState.legilTaskProgress || {}),
                        taskType: 'creative-batch',
                        phase: 'running',
                        total: normalizedPrompts.length,
                        currentIndex: i + 1,
                        completed: successCount + failedCount,
                        success: successCount,
                        failed: failedCount,
                        saved: savedTotal,
                        outputTotal,
                        currentName: directionName,
                        currentAction: `正在生成第 ${i + 1}/${normalizedPrompts.length} 组：${directionName}`,
                        updatedAt: new Date().toISOString()
                    };
                    updateCreativeResumeState({
                        phase: 'running',
                        currentIndex: i + 1,
                        nextIndex: i,
                        completed: successCount + failedCount,
                        success: successCount,
                        failed: failedCount,
                        saved: savedTotal,
                        currentName: directionName,
                        currentAction: automationState.legilTaskProgress.currentAction
                    });

                    logger.info('');
                    logger.info(`🎨 正在处理创意提示词 ${i + 1}/${normalizedPrompts.length}: ${directionName}`);

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
                            shouldAbort: isLegilStopRequested
                        });

                        if (result.success) {
                            const savedCount = Number(result.savedCount) || 1;
                            outputSequence += savedCount;
                            successCount += 1;
                            savedTotal += savedCount;
                            automationState.legilTaskProgress = {
                                ...(automationState.legilTaskProgress || {}),
                                phase: 'running',
                                completed: successCount + failedCount,
                                success: successCount,
                                failed: failedCount,
                                saved: savedTotal,
                                currentAction: `第 ${i + 1}/${normalizedPrompts.length} 组已完成，保存 ${savedCount} 张`,
                                updatedAt: new Date().toISOString()
                            };
                            updateCreativeResumeState({
                                phase: 'running',
                                currentIndex: i + 1,
                                nextIndex: i + 1,
                                completed: successCount + failedCount,
                                success: successCount,
                                failed: failedCount,
                                saved: savedTotal,
                                currentName: directionName,
                                currentAction: automationState.legilTaskProgress.currentAction
                            });
                            logger.info(`✅ 创意提示词 ${i + 1}/${normalizedPrompts.length} 完成，保存 ${savedCount} 张`);
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
                                nextIndex: successCount + failedCount,
                                completed: successCount + failedCount,
                                success: successCount,
                                failed: failedCount,
                                saved: savedTotal,
                                currentName: directionName,
                                currentAction: '创意拓展任务正在停止...'
                            });
                            logger.warn('⏹️ 创意拓展任务已停止');
                            break;
                        } else {
                            failedCount += 1;
                            automationState.legilTaskProgress = {
                                ...(automationState.legilTaskProgress || {}),
                                phase: 'running',
                                completed: successCount + failedCount,
                                success: successCount,
                                failed: failedCount,
                                saved: savedTotal,
                                currentAction: `第 ${i + 1}/${normalizedPrompts.length} 组失败：${result.message}`,
                                updatedAt: new Date().toISOString()
                            };
                            updateCreativeResumeState({
                                phase: 'running',
                                currentIndex: i + 1,
                                nextIndex: i + 1,
                                completed: successCount + failedCount,
                                success: successCount,
                                failed: failedCount,
                                saved: savedTotal,
                                currentName: directionName,
                                currentAction: automationState.legilTaskProgress.currentAction
                            });
                            logger.error(`❌ 创意提示词 ${i + 1}/${normalizedPrompts.length} 失败: ${result.message}`);
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
                                nextIndex: successCount + failedCount,
                                completed: successCount + failedCount,
                                success: successCount,
                                failed: failedCount,
                                saved: savedTotal,
                                currentName: directionName,
                                currentAction: '创意拓展任务正在停止...'
                            });
                            logger.warn('⏹️ 创意拓展任务已停止');
                            break;
                        }
                        failedCount += 1;
                        automationState.legilTaskProgress = {
                            ...(automationState.legilTaskProgress || {}),
                            phase: 'running',
                            completed: successCount + failedCount,
                            success: successCount,
                            failed: failedCount,
                            saved: savedTotal,
                            currentAction: `第 ${i + 1}/${normalizedPrompts.length} 组出错：${error.message}`,
                            updatedAt: new Date().toISOString()
                        };
                        updateCreativeResumeState({
                            phase: 'running',
                            currentIndex: i + 1,
                            nextIndex: i + 1,
                            completed: successCount + failedCount,
                            success: successCount,
                            failed: failedCount,
                            saved: savedTotal,
                            currentName: directionName,
                            currentAction: automationState.legilTaskProgress.currentAction
                        });
                        logger.error(`❌ 创意提示词 ${i + 1}/${normalizedPrompts.length} 出错: ${error.message}`);
                    }

                    if (i < normalizedPrompts.length - 1) {
                        logger.info('等待 5 秒后继续下一组提示词...');
                        try {
                            await sleepWithLegilStop(5000);
                        } catch (error) {
                            stopped = true;
                            updateCreativeResumeState({
                                phase: 'stopping',
                                nextIndex: successCount + failedCount,
                                completed: successCount + failedCount,
                                success: successCount,
                                failed: failedCount,
                                saved: savedTotal,
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
                        completed: successCount + failedCount,
                        success: successCount,
                        failed: failedCount,
                        saved: savedTotal,
                        currentAction: `创意拓展任务已停止：成功 ${successCount} 组，失败 ${failedCount} 组`,
                        updatedAt: new Date().toISOString()
                    };
                    updateCreativeResumeState({
                        phase: 'stopped',
                        nextIndex: successCount + failedCount,
                        currentIndex: successCount + failedCount,
                        completed: successCount + failedCount,
                        success: successCount,
                        failed: failedCount,
                        saved: savedTotal,
                        currentAction: automationState.legilTaskProgress.currentAction
                    });
                    logger.system(`⏹️ Legil 创意拓展任务已停止：成功 ${successCount} 组，失败 ${failedCount} 组`);
                } else {
                    automationState.legilTaskProgress = {
                        ...(automationState.legilTaskProgress || {}),
                        phase: 'completed',
                        currentIndex: normalizedPrompts.length,
                        completed: normalizedPrompts.length,
                        success: successCount,
                        failed: failedCount,
                        saved: savedTotal,
                        currentAction: `创意拓展任务完成：成功 ${successCount} 组，失败 ${failedCount} 组`,
                        updatedAt: new Date().toISOString()
                    };
                    clearCreativeResumeState();
                    logger.system(`✅ Legil 创意拓展任务完成：成功 ${successCount} 组，失败 ${failedCount} 组`);
                }
                logger.system('========================================');
            } catch (error) {
                const safeMessage = error && error.message ? error.message : String(error || '未知错误');
                automationState.legilTaskProgress = {
                    ...(automationState.legilTaskProgress || {}),
                    taskType: 'creative-batch',
                    phase: 'interrupted',
                    total: normalizedPrompts.length,
                    completed: successCount + failedCount,
                    success: successCount,
                    failed: failedCount,
                    saved: savedTotal,
                    outputTotal,
                    browserMode: creativeBrowserMode,
                    currentAction: `创意拓展任务被中断：${safeMessage}`,
                    updatedAt: new Date().toISOString()
                };
                updateCreativeResumeState({
                    phase: 'interrupted',
                    nextIndex: successCount + failedCount,
                    currentIndex: successCount + failedCount,
                    completed: successCount + failedCount,
                    success: successCount,
                    failed: failedCount,
                    saved: savedTotal,
                    currentAction: automationState.legilTaskProgress.currentAction
                });
                logger.error(`❌ Legil 创意拓展任务被中断: ${safeMessage}`);
            } finally {
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
    const { inputFolder, outputFolder, legilReferenceFolder } = req.body;

    console.log('\n🔄 收到完整工作流启动请求（第九阶段）');
    console.log('   输入文件夹:', inputFolder || '使用默认路径');
    console.log('   输出文件夹:', outputFolder || '使用默认路径');
    console.log('   Legil参考图文件夹:', legilReferenceFolder || appConfig.legilReferenceFolder || '使用默认路径');
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
                validation.legilReferenceFolder
            );
            if (result.success) {
                console.log('\n✅ 工作流执行结果:', result.message);
            } else {
                console.log('\n⚠️ 工作流执行结果:', result.message);
                logger.warn('工作流未完成: ' + result.message);
            }
        } catch (error) {
            console.error('\n❌ 工作流执行出错:', error.message);
            logger.error('工作流执行出错: ' + error.message);
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
            const result = await workflowController.resumeWorkflow();
            if (result.success) {
                console.log('\n✅ 继续工作流执行结果:', result.message);
            } else {
                console.log('\n⚠️ 继续工作流执行结果:', result.message);
                logger.warn('继续工作流未完成: ' + result.message);
            }
        } catch (error) {
            console.error('\n❌ 继续工作流执行出错:', error.message);
            logger.error('继续工作流执行出错: ' + error.message);
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

let shuttingDown = false;
async function gracefulShutdown(signal) {
    if (shuttingDown) {
        return;
    }

    shuttingDown = true;
    console.log(`\n收到 ${signal}，正在保存浏览器登录状态并关闭服务...`);

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
