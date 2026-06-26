const path = require('path');
const XLSX = require('xlsx');
const {
    sanitizeFileNamePart
} = require('../output-naming/creative-output-naming');
const {
    buildTablePromptNaming,
    loadTablePromptNamingKnowledge
} = require('./direction-naming');

const SUPPORTED_EXTENSIONS = new Set(['.csv', '.xlsx', '.xls']);
const PROMPT_HEADER_PATTERN = /AI\s*提示词/i;

function normalizeText(value) {
    if (value === null || value === undefined) {
        return '';
    }
    return String(value).replace(/^\uFEFF/, '').trim();
}

function isSupportedFileName(fileName = '') {
    return SUPPORTED_EXTENSIONS.has(path.extname(String(fileName || '')).toLowerCase());
}

function decodeFileBuffer(file = {}) {
    if (Buffer.isBuffer(file.buffer)) {
        return file.buffer;
    }
    if (typeof file.contentBase64 === 'string' && file.contentBase64.trim()) {
        return Buffer.from(file.contentBase64, 'base64');
    }
    if (typeof file.content === 'string') {
        return Buffer.from(file.content, 'utf8');
    }
    return Buffer.alloc(0);
}

function readWorkbookFromFile(file = {}) {
    const fileName = normalizeText(file.name || file.fileName || '未命名表格');
    const ext = path.extname(fileName).toLowerCase();
    if (!isSupportedFileName(fileName)) {
        throw new Error(`不支持的文件类型：${fileName}`);
    }

    const buffer = decodeFileBuffer(file);
    if (!buffer.length) {
        throw new Error(`文件内容为空：${fileName}`);
    }

    if (ext === '.csv') {
        const text = buffer.toString('utf8').replace(/^\uFEFF/, '');
        return XLSX.read(text, {
            type: 'string',
            raw: false,
            cellDates: false
        });
    }

    return XLSX.read(buffer, {
        type: 'buffer',
        raw: false,
        cellDates: false
    });
}

function sheetRowsFromWorkbook(workbook, sheetName) {
    const sheet = workbook && workbook.Sheets ? workbook.Sheets[sheetName] : null;
    if (!sheet) {
        return [];
    }

    return XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        defval: '',
        raw: false,
        blankrows: false
    });
}

function trimEmptyEdges(rows = []) {
    const normalizedRows = (Array.isArray(rows) ? rows : []).map(row => Array.isArray(row) ? row : []);
    let lastNonEmptyRow = normalizedRows.length - 1;
    while (lastNonEmptyRow >= 0) {
        const hasContent = normalizedRows[lastNonEmptyRow].some(cell => normalizeText(cell));
        if (hasContent) break;
        lastNonEmptyRow -= 1;
    }

    const keptRows = normalizedRows.slice(0, lastNonEmptyRow + 1);
    let lastNonEmptyColumn = 0;
    keptRows.forEach(row => {
        row.forEach((cell, index) => {
            if (normalizeText(cell)) {
                lastNonEmptyColumn = Math.max(lastNonEmptyColumn, index + 1);
            }
        });
    });

    return keptRows.map(row => row.slice(0, lastNonEmptyColumn));
}

function findHeaderRow(rows = []) {
    for (let rowIndex = 0; rowIndex < Math.min(rows.length, 12); rowIndex++) {
        const headers = (rows[rowIndex] || []).map(normalizeText);
        if (headers.some(header => PROMPT_HEADER_PATTERN.test(header))) {
            return {
                rowIndex,
                headers
            };
        }
    }
    return null;
}

function getPromptColumnInfo(headers = []) {
    return headers
        .map((header, columnIndex) => {
            const text = normalizeText(header);
            if (!PROMPT_HEADER_PATTERN.test(text)) {
                return null;
            }

            const extensionName = normalizeText(text.split(/-\s*AI\s*提示词/i)[0]) ||
                normalizeText(text.replace(PROMPT_HEADER_PATTERN, '')) ||
                '延展';
            const variantMatch = text.match(/提示词\s*(\d+)/i);
            return {
                columnIndex,
                header: text,
                extensionName,
                promptVariant: variantMatch ? Number(variantMatch[1]) : 1
            };
        })
        .filter(Boolean);
}

function getValue(row = [], headerIndex = new Map(), candidates = []) {
    for (const name of candidates) {
        const index = headerIndex.get(name);
        if (Number.isInteger(index)) {
            const value = normalizeText(row[index]);
            if (value) return value;
        }
    }
    return '';
}

function getDirectionName(row = [], headerIndex = new Map(), fileBaseName = '', rowNumber = 0) {
    const primary = getValue(row, headerIndex, ['方向名称', '方向', '三级标签', '二级标签', '来源素材']);
    if (primary) {
        return primary;
    }

    const level2 = getValue(row, headerIndex, ['二级标签']);
    const level3 = getValue(row, headerIndex, ['三级标签']);
    const brief = getValue(row, headerIndex, ['方向简述']);
    const combined = [level2, level3, brief].filter(Boolean).join('_');
    if (combined) {
        return combined;
    }

    return `${fileBaseName || '表格提示词'}_第${rowNumber}行`;
}

function getStandardLabelPath(row = [], headerIndex = new Map()) {
    return ['一级标签', '二级标签', '三级标签']
        .map(name => getValue(row, headerIndex, [name]))
        .filter(Boolean)
        .slice(0, 3);
}

function buildOutputNameBase(parts = []) {
    const safeParts = parts
        .map(part => sanitizeFileNamePart(part, 42))
        .filter(Boolean);
    return safeParts.join('_').slice(0, 150).replace(/_+$/g, '') || '表格提示词';
}

function rowHasBusinessContent(row = [], promptColumnIndexes = []) {
    return row.some((cell, index) => {
        if (promptColumnIndexes.includes(index)) return false;
        return Boolean(normalizeText(cell));
    });
}

function extractPromptsFromRows({
    rows,
    fileName,
    sheetName,
    globalStartIndex,
    namingKnowledge
}) {
    const warnings = [];
    const trimmedRows = trimEmptyEdges(rows);
    const headerMatch = findHeaderRow(trimmedRows);
    if (!headerMatch) {
        return {
            prompts: [],
            warnings: [`${fileName} / ${sheetName} 未找到包含“AI提示词”的表头`],
            rowCount: 0,
            promptColumnCount: 0,
            emptyPromptCount: 0
        };
    }

    const { rowIndex: headerRowIndex, headers } = headerMatch;
    const headerIndex = new Map();
    headers.forEach((header, index) => {
        const text = normalizeText(header);
        if (text && !headerIndex.has(text)) {
            headerIndex.set(text, index);
        }
    });

    const promptColumns = getPromptColumnInfo(headers);
    if (!promptColumns.length) {
        return {
            prompts: [],
            warnings: [`${fileName} / ${sheetName} 未找到可用 AI提示词 列`],
            rowCount: 0,
            promptColumnCount: 0,
            emptyPromptCount: 0
        };
    }

    const fileBaseName = path.parse(fileName).name;
    const prompts = [];
    let emptyPromptCount = 0;
    let businessRowCount = 0;
    let directionMatchedCount = 0;
    let directionUnmatchedCount = 0;
    const promptColumnIndexes = promptColumns.map(column => column.columnIndex);

    for (let rowIndex = headerRowIndex + 1; rowIndex < trimmedRows.length; rowIndex++) {
        const row = trimmedRows[rowIndex] || [];
        const rowNumber = rowIndex + 1;
        if (!rowHasBusinessContent(row, promptColumnIndexes)) {
            continue;
        }

        businessRowCount += 1;
        const directionName = getDirectionName(row, headerIndex, fileBaseName, rowNumber);
        const sourceMaterial = getValue(row, headerIndex, ['来源素材', '方向简述', '排重说明']);
        const visualHook = getValue(row, headerIndex, ['画面抓手']);
        const priority = getValue(row, headerIndex, ['优先级']);
        const type = getValue(row, headerIndex, ['类型']);
        const standardLabelPath = getStandardLabelPath(row, headerIndex);

        promptColumns.forEach(column => {
            const prompt = normalizeText(row[column.columnIndex]);
            if (!prompt) {
                emptyPromptCount += 1;
                return;
            }

            const promptIndex = globalStartIndex + prompts.length + 1;
            const extensionText = getValue(row, headerIndex, [column.extensionName]);
            const naming = buildTablePromptNaming({
                direction: directionName,
                prompt,
                promptTitle: column.header,
                visualHook,
                extensionText,
                sourceMaterial
            }, namingKnowledge);
            if (naming.directionLibraryMatched) {
                directionMatchedCount += 1;
            } else {
                directionUnmatchedCount += 1;
            }
            const directionPath = naming.matchedDirectionPath ||
                naming.standardLabelPath.join(' / ') ||
                directionName;

            prompts.push({
                index: promptIndex,
                batchIndex: promptIndex,
                sourceRow: rowNumber,
                sourceColumn: column.columnIndex + 1,
                tableFileName: fileName,
                sheetName,
                direction: directionName,
                extensionName: column.extensionName,
                promptVariant: column.promptVariant,
                promptTitle: column.header,
                promptColumn: column.header,
                sourceDirectionPath: directionPath,
                sourceRawName: directionName,
                sourceContentTitle: sourceMaterial,
                contentTitle: naming.contentName,
                newDirectionName: directionPath,
                outputNameBase: naming.outputNameBase,
                standardLabelPath: naming.standardLabelPath,
                primaryTag: naming.primaryTag,
                secondaryTag: naming.secondaryTag,
                tertiaryTag: naming.tertiaryTag,
                matchedDirectionId: naming.matchedDirectionId,
                matchedDirectionName: naming.matchedDirectionName,
                matchedDirectionPath: naming.matchedDirectionPath,
                directionMatchType: naming.directionMatchType,
                directionMatchConfidence: naming.directionMatchConfidence,
                directionLibraryMatched: naming.directionLibraryMatched,
                contentName: naming.contentName,
                contentNameSource: naming.contentNameSource,
                finalContentTitle: naming.finalContentTitle,
                automationContentTitle: naming.automationContentTitle,
                namingSource: naming.namingSource,
                tagConfidence: naming.tagConfidence,
                originalStandardLabelPath: standardLabelPath,
                visualHook,
                priority,
                type,
                prompt,
                selected: true
            });
        });
    }

    if (!prompts.length) {
        warnings.push(`${fileName} / ${sheetName} 没有提取到非空提示词`);
    }

    return {
        prompts,
        warnings,
        rowCount: businessRowCount,
        promptColumnCount: promptColumns.length,
        emptyPromptCount,
        directionMatchedCount,
        directionUnmatchedCount
    };
}

function importTablePromptFiles(files = [], options = {}) {
    const safeFiles = Array.isArray(files) ? files : [];
    const namingKnowledge = options.namingKnowledge ||
        (options.rootDir ? loadTablePromptNamingKnowledge(options.rootDir) : null);
    const allPrompts = [];
    const warnings = [];
    const fileSummaries = [];
    let sheetCount = 0;
    let rowCount = 0;
    let promptColumnCount = 0;
    let emptyPromptCount = 0;
    let directionMatchedCount = 0;
    let directionUnmatchedCount = 0;

    safeFiles.forEach((file, fileIndex) => {
        const fileName = normalizeText(file && (file.name || file.fileName)) || `表格${fileIndex + 1}.xlsx`;
        try {
            const workbook = readWorkbookFromFile({
                ...file,
                name: fileName
            });
            const sheetNames = Array.isArray(workbook.SheetNames) ? workbook.SheetNames : [];
            const fileSummary = {
                fileName,
                sheetCount: 0,
                rowCount: 0,
                promptColumnCount: 0,
                promptCount: 0,
                emptyPromptCount: 0,
                warnings: []
            };

            sheetNames.forEach(sheetName => {
                const rows = sheetRowsFromWorkbook(workbook, sheetName);
                const result = extractPromptsFromRows({
                    rows,
                    fileName,
                    sheetName,
                    globalStartIndex: allPrompts.length,
                    namingKnowledge
                });

                sheetCount += 1;
                rowCount += result.rowCount;
                promptColumnCount += result.promptColumnCount;
                emptyPromptCount += result.emptyPromptCount;
                directionMatchedCount += result.directionMatchedCount || 0;
                directionUnmatchedCount += result.directionUnmatchedCount || 0;
                allPrompts.push(...result.prompts);
                fileSummary.sheetCount += 1;
                fileSummary.rowCount += result.rowCount;
                fileSummary.promptColumnCount += result.promptColumnCount;
                fileSummary.promptCount += result.prompts.length;
                fileSummary.emptyPromptCount += result.emptyPromptCount;
                fileSummary.directionMatchedCount = (fileSummary.directionMatchedCount || 0) + (result.directionMatchedCount || 0);
                fileSummary.directionUnmatchedCount = (fileSummary.directionUnmatchedCount || 0) + (result.directionUnmatchedCount || 0);
                fileSummary.warnings.push(...result.warnings);
                warnings.push(...result.warnings);
            });

            fileSummaries.push(fileSummary);
        } catch (error) {
            const message = `${fileName} 解析失败：${error.message}`;
            warnings.push(message);
            fileSummaries.push({
                fileName,
                sheetCount: 0,
                rowCount: 0,
                promptColumnCount: 0,
                promptCount: 0,
                emptyPromptCount: 0,
                warnings: [message]
            });
        }
    });

    return {
        success: true,
        summary: {
            fileCount: safeFiles.length,
            sheetCount,
            rowCount,
            promptColumnCount,
            promptCount: allPrompts.length,
            emptyPromptCount,
            directionMatchedCount,
            directionUnmatchedCount,
            directionLibraryCount: namingKnowledge && Number(namingKnowledge.directionCount) || 0,
            warningCount: warnings.length
        },
        files: fileSummaries,
        prompts: allPrompts,
        warnings
    };
}

module.exports = {
    importTablePromptFiles,
    isSupportedFileName,
    normalizeText
};
