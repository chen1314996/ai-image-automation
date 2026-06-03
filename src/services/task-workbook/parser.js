const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const xlsx = require('xlsx');
const { safeSegment } = require('./store');

const TASK_SHEET_NAME = '自动化任务表';
const TAG_SHEET_NAME = '全量标签';
const DEFINITION_SHEET_NAME = '一二级标签定义';

const MIME_BY_EXT = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp'
};

function formatTimestamp(date = new Date()) {
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

function makeImportId() {
    return `task_import_${formatTimestamp()}_${crypto.randomBytes(3).toString('hex')}`;
}

function hashText(value) {
    return crypto.createHash('sha1').update(String(value || '')).digest('hex');
}

function compactText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeHeader(value) {
    return String(value || '')
        .replace(/\s+/g, '')
        .replace(/[：:]/g, '')
        .trim();
}

function findColumn(headers, candidates) {
    const normalized = headers.map(normalizeHeader);
    for (const candidate of candidates) {
        const target = normalizeHeader(candidate);
        const index = normalized.findIndex(header => header === target);
        if (index >= 0) return index;
    }
    for (const candidate of candidates) {
        const target = normalizeHeader(candidate);
        const index = normalized.findIndex(header => header.includes(target) || target.includes(header));
        if (index >= 0) return index;
    }
    return -1;
}

function cellValue(row, index) {
    if (index < 0) return '';
    return String(row[index] || '').trim();
}

function columnName(index) {
    let value = Number(index) + 1;
    let output = '';
    while (value > 0) {
        const mod = (value - 1) % 26;
        output = String.fromCharCode(65 + mod) + output;
        value = Math.floor((value - mod) / 26);
    }
    return output || 'A';
}

function pathParts(task = {}) {
    return [
        task.primaryTag,
        task.secondaryTag,
        task.tertiaryTag,
        task.subDirection
    ].map(part => String(part || '').trim()).filter(Boolean);
}

function buildSourcePath(task = {}) {
    return pathParts(task).join('/');
}

function mimeTypeForFile(fileName) {
    return MIME_BY_EXT[path.extname(fileName).toLowerCase()] || 'image/jpeg';
}

function parseAttributes(tag) {
    const attrs = {};
    String(tag || '').replace(/([\w:.-]+)="([^"]*)"/g, (_, key, value) => {
        attrs[key] = value;
        return '';
    });
    return attrs;
}

function parseRelationships(xml) {
    const map = new Map();
    String(xml || '').replace(/<Relationship\b[^>]*\/?>/g, tag => {
        const attrs = parseAttributes(tag);
        if (attrs.Id && attrs.Target) {
            map.set(attrs.Id, {
                id: attrs.Id,
                type: attrs.Type || '',
                target: attrs.Target
            });
        }
        return '';
    });
    return map;
}

function cfbPartMap(buffer) {
    const cfb = xlsx.CFB.read(buffer, { type: 'buffer' });
    const parts = new Map();
    cfb.FileIndex.forEach((entry, index) => {
        const fullPath = String(cfb.FullPaths[index] || entry.name || '').replace(/^Root Entry\/?/, '');
        if (!fullPath || fullPath.endsWith('/')) return;
        parts.set(fullPath, Buffer.from(entry.content || []));
    });
    return parts;
}

function readPartText(parts, partPath) {
    const buffer = parts.get(partPath);
    return buffer ? buffer.toString('utf8') : '';
}

function resolvePart(baseDir, target) {
    return path.posix.normalize(path.posix.join(baseDir, String(target || '')));
}

function relsPathForPart(partPath) {
    const dir = path.posix.dirname(partPath);
    const file = path.posix.basename(partPath);
    return path.posix.join(dir, '_rels', `${file}.rels`);
}

function parseWorkbookSheetParts(parts) {
    const workbookXml = readPartText(parts, 'xl/workbook.xml');
    const workbookRels = parseRelationships(readPartText(parts, 'xl/_rels/workbook.xml.rels'));
    const sheets = [];
    workbookXml.replace(/<sheet\b[^>]*\/?>/g, tag => {
        const attrs = parseAttributes(tag);
        const rid = attrs['r:id'] || attrs.id || '';
        const rel = workbookRels.get(rid);
        if (!attrs.name || !rel) return '';
        sheets.push({
            name: attrs.name,
            rid,
            partPath: resolvePart('xl', rel.target)
        });
        return '';
    });
    return sheets;
}

function drawingPartForSheet(parts, sheetPartPath) {
    const sheetXml = readPartText(parts, sheetPartPath);
    const drawingMatch = sheetXml.match(/<drawing\b[^>]*(?:r:id|id)="([^"]+)"/);
    if (!drawingMatch) return '';
    const rels = parseRelationships(readPartText(parts, relsPathForPart(sheetPartPath)));
    const rel = rels.get(drawingMatch[1]);
    if (!rel) return '';
    return resolvePart(path.posix.dirname(sheetPartPath), rel.target);
}

function parseDrawingAnchors(parts, drawingPartPath) {
    if (!drawingPartPath) return [];
    const drawingXml = readPartText(parts, drawingPartPath);
    const rels = parseRelationships(readPartText(parts, relsPathForPart(drawingPartPath)));
    const anchors = [];
    const anchorRegex = /<[\w:]*?(?:twoCellAnchor|oneCellAnchor)\b[\s\S]*?<\/[\w:]*?(?:twoCellAnchor|oneCellAnchor)>/g;
    const blocks = drawingXml.match(anchorRegex) || [];

    blocks.forEach(block => {
        const fromMatch = block.match(/<[\w:]*?from>[\s\S]*?<[\w:]*?col>(\d+)<\/[\w:]*?col>[\s\S]*?<[\w:]*?row>(\d+)<\/[\w:]*?row>/);
        const embedMatch = block.match(/<a:blip\b[^>]*(?:r:embed|embed)="([^"]+)"/) ||
            block.match(/<[\w:]*?blip\b[^>]*(?:r:embed|embed)="([^"]+)"/);
        if (!fromMatch || !embedMatch) return;
        const rel = rels.get(embedMatch[1]);
        if (!rel) return;
        const mediaPartPath = resolvePart(path.posix.dirname(drawingPartPath), rel.target);
        anchors.push({
            rowIndex: Number(fromMatch[2]),
            excelRow: Number(fromMatch[2]) + 1,
            colIndex: Number(fromMatch[1]),
            excelCol: columnName(Number(fromMatch[1])),
            sourceCell: `${columnName(Number(fromMatch[1]))}${Number(fromMatch[2]) + 1}`,
            relationshipId: embedMatch[1],
            mediaPartPath,
            originalFileName: path.posix.basename(mediaPartPath)
        });
    });

    return anchors;
}

function readSheetRows(workbook, sheetName) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return [];
    return xlsx.utils.sheet_to_json(sheet, {
        header: 1,
        defval: '',
        raw: false,
        blankrows: false
    });
}

function parseTaskRows(workbook, taskSheetName) {
    const rows = readSheetRows(workbook, taskSheetName);
    if (rows.length < 2) return [];
    const headers = rows[0] || [];
    const columns = {
        primaryTag: findColumn(headers, ['一级标签', '一级']),
        secondaryTag: findColumn(headers, ['二级标签', '二级']),
        tertiaryTag: findColumn(headers, ['三级标签', '三级']),
        subDirection: findColumn(headers, ['子方向', '细分标签', '细分方向']),
        iterationDescription: findColumn(headers, ['迭代描述', '迭代方向', '迭代说明']),
        directionDescription: findColumn(headers, ['方向描述', '方向简述', '描述']),
        referenceImage: findColumn(headers, ['参考图', '参考图片', '图片'])
    };

    return rows.slice(1)
        .map((row, index) => {
            const task = {
                sourceRow: index + 2,
                primaryTag: cellValue(row, columns.primaryTag),
                secondaryTag: cellValue(row, columns.secondaryTag),
                tertiaryTag: cellValue(row, columns.tertiaryTag),
                subDirection: cellValue(row, columns.subDirection),
                iterationDescription: cellValue(row, columns.iterationDescription),
                directionDescription: cellValue(row, columns.directionDescription),
                referenceImageText: cellValue(row, columns.referenceImage)
            };
            task.sourcePath = buildSourcePath(task);
            task.groupKey = task.sourcePath;
            return task;
        })
        .filter(task => {
            return [
                task.primaryTag,
                task.secondaryTag,
                task.tertiaryTag,
                task.subDirection,
                task.iterationDescription,
                task.directionDescription
            ].some(Boolean);
        });
}

function parseHierarchyDefinitions(workbook, definitionSheetName) {
    const rows = readSheetRows(workbook, definitionSheetName);
    if (rows.length < 2) return [];
    const headers = rows[0] || [];
    const columns = {
        primaryTag: findColumn(headers, ['一级标签']),
        primaryDescription: findColumn(headers, ['一级标签概念解释', '一级概念解释']),
        secondaryTag: findColumn(headers, ['二级标签']),
        secondaryDescription: findColumn(headers, ['二级标签概念解释', '二级概念解释'])
    };
    return rows.slice(1)
        .map((row, index) => ({
            sourceRow: index + 2,
            primaryTag: cellValue(row, columns.primaryTag),
            primaryDescription: cellValue(row, columns.primaryDescription),
            secondaryTag: cellValue(row, columns.secondaryTag),
            secondaryDescription: cellValue(row, columns.secondaryDescription)
        }))
        .filter(item => item.primaryTag || item.primaryDescription || item.secondaryTag || item.secondaryDescription);
}

function mediaBuffer(parts, mediaPartPath) {
    return parts.get(mediaPartPath) || parts.get(path.posix.basename(mediaPartPath)) || null;
}

function groupTaskImages({ parts, anchors, importId, store }) {
    const imagesByRow = new Map();
    anchors.forEach(anchor => {
        const buffer = mediaBuffer(parts, anchor.mediaPartPath);
        if (!buffer || buffer.length === 0) return;
        const ext = path.extname(anchor.originalFileName || '') || '.jpeg';
        const list = imagesByRow.get(anchor.excelRow) || [];
        const fileName = `row_${String(anchor.excelRow).padStart(3, '0')}_ref_${String(list.length + 1).padStart(2, '0')}${ext}`;
        const filePath = store.saveImage(importId, fileName, buffer);
        list.push({
            imageId: `task_ref_${hashText(`${importId}:${anchor.excelRow}:${list.length + 1}:${anchor.originalFileName}`).slice(0, 12)}`,
            sourceCell: anchor.sourceCell,
            fileName,
            filePath,
            relativePath: path.relative(store.rootDir, filePath).replace(/\\/g, '/'),
            imageUrl: `/api/task-workbooks/imports/${encodeURIComponent(importId)}/images/${encodeURIComponent(fileName)}`,
            mimeType: mimeTypeForFile(fileName),
            sizeBytes: buffer.length
        });
        imagesByRow.set(anchor.excelRow, list);
    });
    return imagesByRow;
}

function decodeWorkbookPayload(payload = {}) {
    if (payload.fileBuffer && Buffer.isBuffer(payload.fileBuffer)) return payload.fileBuffer;
    if (payload.fileContent) {
        return Buffer.from(String(payload.fileContent), 'base64');
    }
    if (payload.filePath) {
        return fs.readFileSync(payload.filePath);
    }
    throw new Error('缺少任务表文件内容');
}

function parseTaskWorkbook(payload = {}, options = {}) {
    const store = options.store;
    if (!store) throw new Error('TaskWorkbookStore is required');

    const buffer = decodeWorkbookPayload(payload);
    const fileName = safeSegment(payload.fileName || (payload.filePath ? path.basename(payload.filePath) : 'source.xlsx'), 'source.xlsx');
    const importId = payload.importId || makeImportId();
    const workbook = xlsx.read(buffer, {
        type: 'buffer',
        cellDates: false,
        raw: false
    });
    const sheetOptions = payload.sheets || {};
    const taskSheetName = workbook.SheetNames.includes(sheetOptions.taskSheet || '')
        ? sheetOptions.taskSheet
        : (workbook.SheetNames.includes(TASK_SHEET_NAME) ? TASK_SHEET_NAME : workbook.SheetNames[0]);
    const definitionSheetName = workbook.SheetNames.includes(sheetOptions.definitionSheet || '')
        ? sheetOptions.definitionSheet
        : (workbook.SheetNames.includes(DEFINITION_SHEET_NAME) ? DEFINITION_SHEET_NAME : '');
    const tagSheetName = workbook.SheetNames.includes(sheetOptions.tagSheet || '')
        ? sheetOptions.tagSheet
        : (workbook.SheetNames.includes(TAG_SHEET_NAME) ? TAG_SHEET_NAME : '');

    if (!taskSheetName) {
        throw new Error('未找到可解析的自动化任务表工作表');
    }

    store.ensureBase();
    store.writeImport({
        importId,
        summary: {
            importId,
            fileName,
            importedAt: new Date().toISOString(),
            taskSheetName,
            definitionSheetName,
            tagSheetName,
            taskDirectionCount: 0,
            taskReferenceImageCount: 0,
            tagDirectionCount: 0,
            tagReferenceImageCount: 0,
            ignoredSheets: tagSheetName ? [tagSheetName] : [],
            sourceWorkbookPath: ''
        },
        taskDirections: [],
        hierarchyDefinitions: []
    });
    const sourceWorkbookPath = store.saveSourceWorkbook(importId, buffer, fileName);

    const parts = cfbPartMap(buffer);
    const sheetParts = parseWorkbookSheetParts(parts);
    const taskSheetPart = (sheetParts.find(item => item.name === taskSheetName) || {}).partPath ||
        `xl/worksheets/sheet${Math.max(1, workbook.SheetNames.indexOf(taskSheetName) + 1)}.xml`;
    const taskDrawingPart = drawingPartForSheet(parts, taskSheetPart);
    const taskAnchors = parseDrawingAnchors(parts, taskDrawingPart);
    const imagesByRow = groupTaskImages({
        parts,
        anchors: taskAnchors,
        importId,
        store
    });
    const taskRows = parseTaskRows(workbook, taskSheetName);
    const hierarchyDefinitions = definitionSheetName
        ? parseHierarchyDefinitions(workbook, definitionSheetName)
        : [];

    const taskDirections = taskRows.map(task => {
        const referenceImages = imagesByRow.get(task.sourceRow) || [];
        const taskDirectionId = `task_direction_${hashText(`${importId}:${task.sourceRow}:${task.sourcePath}:${task.iterationDescription}`).slice(0, 12)}`;
        return {
            taskDirectionId,
            source: 'task-workbook',
            importId,
            sourceRow: task.sourceRow,
            sourcePath: task.sourcePath,
            groupKey: task.groupKey,
            primaryTag: task.primaryTag,
            secondaryTag: task.secondaryTag,
            tertiaryTag: task.tertiaryTag,
            subDirection: task.subDirection,
            iterationDescription: task.iterationDescription,
            directionDescription: task.directionDescription,
            referenceImages,
            referenceImagePolicy: {
                forVisionUnderstanding: true,
                forFrontendPreview: true,
                useForLegilReferenceUpload: false
            },
            legilReferenceImages: [],
            defaultRunMode: 'creative-expansion',
            status: referenceImages.length ? 'pending-vision' : 'missing-image',
            createdAt: new Date().toISOString()
        };
    });

    const summary = {
        importId,
        fileName,
        importedAt: new Date().toISOString(),
        taskSheetName,
        definitionSheetName,
        tagSheetName,
        taskDirectionCount: taskDirections.length,
        tagDirectionCount: 0,
        taskReferenceImageCount: taskDirections.reduce((sum, item) => sum + item.referenceImages.length, 0),
        tagReferenceImageCount: 0,
        ignoredSheets: tagSheetName ? [tagSheetName] : [],
        options: {
            ignoreTagSheet: true,
            oneRowOneTaskDirection: true,
            autoVisionAllRows: true,
            visionConcurrency: 1,
            maxVisionConcurrency: 2,
            maxVisionRetriesPerRow: 3,
            dailyWinkyCallLimit: null,
            useTaskReferenceImagesForLegil: false,
            saveTaskDirectionToOfficialKnowledge: false,
            defaultRunMode: 'creative-expansion'
        },
        sourceWorkbookPath: path.relative(store.rootDir, sourceWorkbookPath).replace(/\\/g, '/'),
        warnings: []
    };

    store.writeImport({
        importId,
        summary,
        taskDirections,
        hierarchyDefinitions
    });

    return {
        success: true,
        agent: 'task-workbook-parser-agent',
        importId,
        fileName,
        summary,
        taskDirections,
        hierarchyDefinitions,
        warnings: summary.warnings
    };
}

module.exports = {
    parseTaskWorkbook,
    makeImportId,
    hashText,
    compactText,
    columnName,
    TASK_SHEET_NAME,
    TAG_SHEET_NAME,
    DEFINITION_SHEET_NAME
};
