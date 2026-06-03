const crypto = require('crypto');
const path = require('path');
const xlsx = require('xlsx');

const EMPTY_TAGS = new Set(['', '暂无', '无', 'none', 'null', '-']);

function normalizeHeader(value) {
    return String(value || '').replace(/\s+/g, '').trim();
}

function normalizeText(value) {
    return String(value ?? '').replace(/\uFEFF/g, '').trim();
}

function normalizeTag(value) {
    const text = normalizeText(value);
    return EMPTY_TAGS.has(text.toLowerCase()) ? '' : text;
}

function getValue(row, names) {
    for (const name of names) {
        if (Object.prototype.hasOwnProperty.call(row, name)) {
            return normalizeText(row[name]);
        }
    }

    const normalizedNames = new Set(names.map(normalizeHeader));
    for (const key of Object.keys(row)) {
        if (normalizedNames.has(normalizeHeader(key))) {
            return normalizeText(row[key]);
        }
    }

    return '';
}

function hashId(prefix, values) {
    const hash = crypto
        .createHash('sha1')
        .update(values.filter(Boolean).join('|'))
        .digest('hex')
        .slice(0, 10);
    return `${prefix}_${hash}`;
}

function parseBoolean(value, fallback = true) {
    const text = normalizeText(value).toLowerCase();
    if (!text) return fallback;
    if (['1', 'true', 'yes', 'y', 'on', '是', '启用', '自动', '允许'].includes(text)) return true;
    if (['0', 'false', 'no', 'n', 'off', '否', '禁用', '不自动', '不允许'].includes(text)) return false;
    return fallback;
}

function parsePriority(value, fallback = 50) {
    const number = Number(String(value || '').replace(/[^\d.-]/g, ''));
    if (!Number.isFinite(number)) return fallback;
    return Math.max(1, Math.min(100, Math.round(number)));
}

function chooseSheet(workbook) {
    const preferred = workbook.SheetNames.find(sheetName => sheetName.includes('标签系统'));
    return preferred || workbook.SheetNames[0];
}

function buildPath(parts) {
    return parts.filter(Boolean).join('/');
}

function importDirections(options = {}) {
    const workbookPath = options.workbookPath;
    if (!workbookPath) {
        throw new Error('缺少创意方向表路径');
    }

    if (path.basename(workbookPath).startsWith('~$')) {
        throw new Error('不能导入 Excel 临时锁文件，请关闭表格后选择正式文件');
    }

    const workbook = xlsx.readFile(workbookPath, {
        cellDates: false
    });
    const sheetName = chooseSheet(workbook);
    const sheet = workbook.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json(sheet, {
        defval: '',
        raw: false,
        blankrows: false
    });

    const warnings = [];
    const directions = [];
    const seenIds = new Set();

    rows.forEach((row, index) => {
        const rowNumber = index + 2;
        const primaryTag = normalizeTag(getValue(row, ['一级标签', '一级']));
        const secondaryTag = normalizeTag(getValue(row, ['二级标签', '二级']));
        const tertiaryTag = normalizeTag(getValue(row, ['三级标签', '三极标签', '三级']));
        const subTag = normalizeTag(getValue(row, ['细分标签', '细分']));
        const description = normalizeText(getValue(row, ['方向简述', '方向描述', '描述']));
        const directionPath = buildPath([primaryTag, secondaryTag, tertiaryTag, subTag]);

        if (!directionPath && !description) {
            return;
        }

        if (!directionPath) {
            warnings.push(`第 ${rowNumber} 行缺少标签路径，已跳过`);
            return;
        }

        const referenceHints = [
            getValue(row, ['参考图1', '参考图 1']),
            getValue(row, ['参考图2', '参考图 2']),
            getValue(row, ['参考图3', '参考图 3'])
        ].filter(Boolean);

        let id = hashId('direction', [directionPath, description]);
        if (seenIds.has(id)) {
            id = hashId('direction', [directionPath, description, String(rowNumber)]);
        }
        seenIds.add(id);

        directions.push({
            id,
            rowNumber,
            orderIndex: directions.length + 1,
            sheetName,
            path: directionPath,
            name: subTag || tertiaryTag || secondaryTag || primaryTag,
            primaryTag,
            secondaryTag,
            tertiaryTag,
            subTag,
            description,
            referenceHints,
            mustKeep: normalizeText(getValue(row, ['必须保留', '保留'])),
            mustAvoid: normalizeText(getValue(row, ['必须避开', '避免', '禁用'])),
            autoRun: parseBoolean(getValue(row, ['自动运行', '是否自动运行']), true),
            priority: parsePriority(getValue(row, ['优先级', '权重']), 50),
            stats: {
                expandedCount: 0,
                promptCount: 0,
                imageCount: 0,
                lastRunAt: null,
                failureCount: 0
            }
        });
    });

    return {
        directions,
        warnings,
        metadata: {
            sourceFile: workbookPath,
            sheetName,
            totalRows: rows.length,
            importedRows: directions.length
        }
    };
}

module.exports = {
    importDirections,
    normalizeHeader,
    normalizeTag,
    normalizeText
};
