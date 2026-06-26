const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp']);
const NAMING_CONTEXT_FIELDS = [
    'primaryTag',
    'secondaryTag',
    'tertiaryTag',
    'standardLabelPath',
    'sourceDirectionId',
    'sourceDirectionPath',
    'sourceRawName',
    'sourceParsedParts',
    'sourceContentTitle',
    'droppedLabelParts',
    'newDirectionName',
    'promptTitle',
    'contentTitle',
    'contentName',
    'finalContentTitle',
    'automationContentTitle',
    'outputNameBase',
    'matchedDirectionId',
    'matchedDirectionPath',
    'namingSource',
    'tagConfidence'
];
const NAMING_ARRAY_FIELDS = new Set(['standardLabelPath', 'sourceParsedParts', 'droppedLabelParts']);

function safeArray(value) {
    return Array.isArray(value) ? value : [];
}

function normalizeText(value) {
    return String(value || '').trim();
}

function splitPath(value) {
    if (Array.isArray(value)) {
        return value.flatMap(splitPath).map(normalizeText).filter(Boolean);
    }
    return String(value || '')
        .split(/[\/\\_>,，\n\r]+/g)
        .map(part => part.trim())
        .filter(Boolean);
}

function firstText(...values) {
    for (const value of values) {
        const text = normalizeText(value);
        if (text) {
            return text;
        }
    }
    return '';
}

function firstArray(...values) {
    for (const value of values) {
        const parts = splitPath(value);
        if (parts.length) {
            return parts;
        }
    }
    return [];
}

function pickNamingContextFields(source = {}) {
    const result = {};
    NAMING_CONTEXT_FIELDS.forEach(field => {
        if (NAMING_ARRAY_FIELDS.has(field)) {
            const parts = splitPath(source && source[field]);
            if (parts.length) {
                result[field] = parts;
            }
            return;
        }
        const text = normalizeText(source && source[field]);
        if (text) {
            result[field] = text;
        }
    });
    return result;
}

function hashId(prefix, parts) {
    const hash = crypto
        .createHash('sha1')
        .update(parts.map(part => String(part || '')).join('|'))
        .digest('hex')
        .slice(0, 16);
    return `${prefix}_${hash}`;
}

function normalizePathKey(filePath) {
    return path.normalize(String(filePath || '')).toLowerCase();
}

function toIsoDate(value) {
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function formatShanghaiTimestampForFile(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
        return '';
    }

    const parts = new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}${values.month}${values.day}_${values.hour}${values.minute}${values.second}`;
}

function isImageFile(filePath) {
    return IMAGE_EXTENSIONS.has(path.extname(String(filePath || '')).toLowerCase());
}

function parsePromptListIndex(fileName, raw = {}) {
    const explicit = Number(raw.promptListIndex || raw.displayIndex || raw.promptIndex);
    if (Number.isFinite(explicit) && explicit > 0) {
        return Math.floor(explicit);
    }

    const match = String(fileName || '').match(/_ref(\d+)_prompt/i);
    if (match) {
        return Math.max(1, Number(match[1]) || 1);
    }

    return 0;
}

function parseOutputIndex(fileName, fallbackIndex) {
    const match = String(fileName || '').match(/_v(\d+)_/i);
    if (match) {
        return Math.max(1, Number(match[1]) || 1);
    }

    return fallbackIndex + 1;
}

function buildNamingContext({ file = {}, prompt = {}, direction = {} } = {}) {
    const directionPathParts = splitPath(direction.path || direction.directionPath || '');
    const standardLabelPath = firstArray(
        file.standardLabelPath,
        prompt.standardLabelPath,
        [
            direction.primaryTag || direction.primary,
            direction.secondaryTag || direction.secondary,
            direction.tertiaryTag || direction.tertiary
        ],
        directionPathParts.slice(0, 3)
    ).slice(0, 3);

    const primaryTag = firstText(
        file.primaryTag,
        prompt.primaryTag,
        direction.primaryTag,
        direction.primary,
        standardLabelPath[0]
    );
    const secondaryTag = firstText(
        file.secondaryTag,
        prompt.secondaryTag,
        direction.secondaryTag,
        direction.secondary,
        standardLabelPath[1]
    );
    const tertiaryTag = firstText(
        file.tertiaryTag,
        prompt.tertiaryTag,
        direction.tertiaryTag,
        direction.tertiary,
        standardLabelPath[2]
    );
    const normalizedStandardLabelPath = standardLabelPath.length
        ? standardLabelPath
        : [primaryTag, secondaryTag, tertiaryTag].filter(Boolean).slice(0, 3);

    return {
        primaryTag,
        secondaryTag,
        tertiaryTag,
        standardLabelPath: normalizedStandardLabelPath,
        sourceDirectionId: firstText(
            file.sourceDirectionId,
            prompt.sourceDirectionId,
            direction.id,
            direction.directionId
        ),
        sourceDirectionPath: firstText(
            file.sourceDirectionPath,
            prompt.sourceDirectionPath,
            direction.path,
            direction.directionPath
        ),
        sourceRawName: firstText(
            file.sourceRawName,
            prompt.sourceRawName,
            prompt.sourceMaterialName,
            prompt.referenceImageName,
            prompt.originalImageName
        ),
        sourceParsedParts: firstArray(file.sourceParsedParts, prompt.sourceParsedParts),
        sourceContentTitle: firstText(file.sourceContentTitle, prompt.sourceContentTitle),
        droppedLabelParts: firstArray(file.droppedLabelParts, prompt.droppedLabelParts),
        newDirectionName: firstText(file.newDirectionName, prompt.newDirectionName, prompt.direction),
        promptTitle: firstText(file.promptTitle, prompt.promptTitle),
        contentTitle: firstText(file.contentTitle, prompt.contentTitle, prompt.newDirectionName, prompt.direction),
        contentName: firstText(file.contentName, prompt.contentName),
        finalContentTitle: firstText(file.finalContentTitle, prompt.finalContentTitle),
        automationContentTitle: firstText(file.automationContentTitle, prompt.automationContentTitle),
        outputNameBase: firstText(file.outputNameBase, prompt.outputNameBase),
        matchedDirectionId: firstText(file.matchedDirectionId, prompt.matchedDirectionId),
        matchedDirectionPath: firstText(file.matchedDirectionPath, prompt.matchedDirectionPath),
        namingSource: firstText(file.namingSource, prompt.namingSource),
        tagConfidence: firstText(file.tagConfidence, prompt.tagConfidence)
    };
}

function toFileRecord(raw, fallbackOutputFolder = '') {
    const rawPath = raw && (raw.filePath || raw.path || raw.fullPath || raw.fullName || raw.savePath);
    if (!rawPath) {
        return null;
    }

    const filePath = path.normalize(String(rawPath));
    if (!isImageFile(filePath) || !fs.existsSync(filePath)) {
        return null;
    }

    const stats = fs.statSync(filePath);
    if (!stats.isFile()) {
        return null;
    }

    const fileName = path.basename(filePath);
    const outputFolder = fallbackOutputFolder || path.dirname(filePath);
    return {
        filePath,
        fileName,
        relativePath: outputFolder ? path.relative(outputFolder, filePath) : fileName,
        extension: path.extname(fileName).toLowerCase(),
        size: stats.size,
        mtime: stats.mtime,
        promptListIndex: parsePromptListIndex(fileName, raw || {}),
        promptHash: normalizeText(raw && raw.promptHash),
        savedAt: raw && raw.savedAt ? raw.savedAt : stats.mtime.toISOString(),
        ...pickNamingContextFields(raw || {})
    };
}

function flattenProgressSavedFiles(progress) {
    const files = [];
    safeArray(progress && progress.savedFiles).forEach(item => files.push(item));
    safeArray(progress && progress.promptResults).forEach(result => {
        safeArray(result && result.savedFiles).forEach(item => {
            files.push({
                ...pickNamingContextFields(result || {}),
                ...item,
                promptListIndex: item.promptListIndex || result.promptListIndex || result.displayIndex,
                promptHash: item.promptHash || result.promptHash
            });
        });
    });
    return files;
}

function scanOutputFolder({ outputFolder, progress, run, expectedSavedCount }) {
    if (!outputFolder || !fs.existsSync(outputFolder) || !fs.statSync(outputFolder).isDirectory()) {
        return [];
    }

    const files = fs.readdirSync(outputFolder)
        .map(fileName => path.join(outputFolder, fileName))
        .filter(isImageFile)
        .map(filePath => toFileRecord({ filePath }, outputFolder))
        .filter(Boolean);

    const batchKey = String(progress && progress.batchRunId || '').trim()
        || formatShanghaiTimestampForFile(progress && progress.startedAt);
    const byBatchKey = batchKey
        ? files.filter(file => file.fileName.startsWith(batchKey))
        : [];
    if (byBatchKey.length) {
        return byBatchKey.sort((a, b) => a.mtime - b.mtime || a.fileName.localeCompare(b.fileName));
    }

    const startMs = new Date(
        progress && progress.startedAt
            ? progress.startedAt
            : (run && (run.startedAt || run.createdAt))
    ).getTime();
    const endMs = new Date(
        run && run.completedAt
            ? run.completedAt
            : (progress && progress.updatedAt ? progress.updatedAt : Date.now())
    ).getTime();
    if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
        return [];
    }

    const candidates = files
        .filter(file => {
            const mtime = file.mtime.getTime();
            return mtime >= startMs - 30000 && mtime <= endMs + 120000;
        })
        .sort((a, b) => a.mtime - b.mtime || a.fileName.localeCompare(b.fileName));

    const limit = Math.max(0, Number(expectedSavedCount) || 0);
    if (limit > 0 && candidates.length > limit) {
        return candidates.slice(candidates.length - limit);
    }

    return candidates;
}

function collectAssetFiles({ run, progress, expectedSavedCount }) {
    const outputFolder = path.normalize(String(
        run && run.config && run.config.outputFolder
            ? run.config.outputFolder
            : ''
    ));
    const seen = new Set();
    const filesFromProgress = flattenProgressSavedFiles(progress)
        .map(item => toFileRecord(item, outputFolder))
        .filter(Boolean)
        .filter(file => {
            const key = normalizePathKey(file.filePath);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });

    if (filesFromProgress.length) {
        return {
            outputFolder,
            files: filesFromProgress,
            source: 'progress'
        };
    }

    return {
        outputFolder,
        files: scanOutputFolder({ outputFolder, progress, run, expectedSavedCount }),
        source: 'output-folder-scan'
    };
}

function pickPrompt(prompts, file, fileIndex, outputQuantity) {
    if (!prompts.length) {
        return null;
    }

    if (file.promptListIndex > 0) {
        return prompts[file.promptListIndex - 1] || null;
    }

    const inferredIndex = Math.floor(fileIndex / Math.max(1, Number(outputQuantity) || 1));
    return prompts[inferredIndex] || prompts[0] || null;
}

function buildAsset({ run, progress, file, fileIndex, outputFolder }) {
    const prompts = safeArray(run && run.prompts);
    const generationSettings = {
        ...((run && run.config && run.config.generationSettings) || {})
    };
    const outputQuantity = Number(generationSettings.outputQuantity)
        || Number(run && run.config && run.config.outputQuantity)
        || 1;
    const prompt = pickPrompt(prompts, file, fileIndex, outputQuantity) || {};
    const direction = (run && run.sourceDirection) || {};
    const legilTask = (run && run.legilTask) || {};
    const namingContext = buildNamingContext({ file, prompt, direction });
    const promptHash = file.promptHash || prompt.promptHash || hashId('prompt', [prompt.prompt || file.fileName]);
    const filePath = path.normalize(file.filePath);
    const fileSize = Number(file.size) || 0;

    return {
        assetId: hashId('asset', [run && run.runId, filePath, fileSize, promptHash]),
        runId: run && run.runId,
        source: run && run.source ? run.source : 'creative-auto-run-once',
        directionId: namingContext.sourceDirectionId || direction.id || prompt.sourceDirectionId || '',
        directionPath: namingContext.sourceDirectionPath || direction.path || prompt.sourceDirectionPath || '',
        directionName: direction.name || '',
        promptHash,
        prompt: prompt.prompt || '',
        promptDirection: prompt.direction || '',
        primaryTag: namingContext.primaryTag,
        secondaryTag: namingContext.secondaryTag,
        tertiaryTag: namingContext.tertiaryTag,
        standardLabelPath: namingContext.standardLabelPath,
        sourceDirectionId: namingContext.sourceDirectionId,
        sourceDirectionPath: namingContext.sourceDirectionPath,
        sourceRawName: namingContext.sourceRawName,
        sourceParsedParts: namingContext.sourceParsedParts,
        sourceContentTitle: namingContext.sourceContentTitle,
        droppedLabelParts: namingContext.droppedLabelParts,
        newDirectionName: namingContext.newDirectionName,
        promptTitle: namingContext.promptTitle,
        contentTitle: namingContext.contentTitle,
        contentName: namingContext.contentName,
        finalContentTitle: namingContext.finalContentTitle,
        automationContentTitle: namingContext.automationContentTitle,
        outputNameBase: namingContext.outputNameBase,
        matchedDirectionId: namingContext.matchedDirectionId,
        matchedDirectionPath: namingContext.matchedDirectionPath,
        namingSource: namingContext.namingSource,
        tagConfidence: namingContext.tagConfidence,
        promptIndex: file.promptListIndex || prompt.index || fileIndex + 1,
        originalPromptIndex: prompt.originalIndex || prompt.index || '',
        sourceRow: prompt.sourceRow || '',
        filePath,
        fileName: file.fileName,
        relativePath: file.relativePath || (outputFolder ? path.relative(outputFolder, filePath) : file.fileName),
        extension: file.extension || path.extname(file.fileName).toLowerCase(),
        fileSize,
        outputIndex: parseOutputIndex(file.fileName, fileIndex % Math.max(1, outputQuantity)),
        createdAt: toIsoDate(file.mtime),
        savedAt: toIsoDate(file.savedAt || file.mtime),
        recordedAt: new Date().toISOString(),
        outputFolder,
        legilBatchRunId: progress && progress.batchRunId ? progress.batchRunId : '',
        legilTaskId: legilTask.taskId || (run && run.legilTaskId) || '',
        legilTaskStatus: legilTask.status || '',
        legilTaskPhase: legilTask.phase || '',
        generationSettings
    };
}

function registerRunAssets({ store, run, progress }) {
    const expectedSavedCount = Number(progress && progress.saved)
        || Number(run && run.legilResult && run.legilResult.savedCount)
        || 0;
    const collected = collectAssetFiles({ run, progress, expectedSavedCount });
    const existingData = store.read('assets.json', {
        version: 1,
        assets: []
    });
    const existingAssets = safeArray(existingData.assets);
    const existingFileKeys = new Set(existingAssets.map(asset => normalizePathKey(asset.filePath)));
    const existingAssetIds = new Set(existingAssets.map(asset => asset.assetId));
    const newAssets = [];
    const duplicates = [];

    collected.files.forEach((file, fileIndex) => {
        const asset = buildAsset({
            run,
            progress,
            file,
            fileIndex,
            outputFolder: collected.outputFolder
        });
        const fileKey = normalizePathKey(asset.filePath);
        if (existingFileKeys.has(fileKey) || existingAssetIds.has(asset.assetId)) {
            duplicates.push(asset.filePath);
            return;
        }
        existingFileKeys.add(fileKey);
        existingAssetIds.add(asset.assetId);
        newAssets.push(asset);
    });

    const warnings = [];
    if (!collected.outputFolder) {
        warnings.push('missing_output_folder');
    }
    if (expectedSavedCount > 0 && collected.files.length === 0) {
        warnings.push('no_saved_files_matched');
    } else if (expectedSavedCount > 0 && collected.files.length < expectedSavedCount) {
        warnings.push('matched_files_less_than_saved_count');
    }

    if (newAssets.length) {
        store.write('assets.json', {
            ...existingData,
            version: existingData.version || 1,
            assets: existingAssets.concat(newAssets),
            updatedAt: new Date().toISOString()
        });
    }

    return {
        success: true,
        source: collected.source,
        expectedSavedCount,
        matchedFileCount: collected.files.length,
        newAssetCount: newAssets.length,
        duplicateCount: duplicates.length,
        assetIds: newAssets.map(asset => asset.assetId),
        filePaths: newAssets.map(asset => asset.filePath),
        warnings
    };
}

module.exports = {
    registerRunAssets,
    collectAssetFiles
};
