const path = require('path');
const XLSX = require('xlsx');

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

module.exports = {
    normalizeCellText,
    isPromptHeader,
    extractCreativePromptsFromRows,
    chooseCreativePromptSheet,
    parseCreativePromptWorkbook
};
