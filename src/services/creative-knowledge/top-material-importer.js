const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');
const { normalizeHeader, normalizeText } = require('./direction-importer');

const ROOT_TAGS = ['题材', '玩法', '卖点', '场景', '角色', '美术', '包装', '节日'];

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
        .slice(0, 12);
    return `${prefix}_${hash}`;
}

function parseNumber(value) {
    const raw = normalizeText(value);
    if (!raw || ['-', '--', '暂无', 'null', 'NaN'].includes(raw)) {
        return null;
    }

    const isPercent = raw.includes('%');
    const number = Number(raw.replace(/,/g, '').replace(/[^\d.-]/g, ''));
    if (!Number.isFinite(number)) {
        return null;
    }

    return isPercent ? number / 100 : number;
}

function parseMonth(fileName) {
    const match = String(fileName).match(/(\d{4})年(\d{1,2})月/);
    if (!match) return '';
    return `${match[1]}-${match[2].padStart(2, '0')}`;
}

function extractContentUrl(value) {
    const text = normalizeText(value);
    const hyperlinkMatch = text.match(/HYPERLINK\("([^"]+)"/i);
    if (hyperlinkMatch) {
        return hyperlinkMatch[1];
    }

    const urlMatch = text.match(/https?:\/\/[^\s")]+/i);
    return urlMatch ? urlMatch[0] : '';
}

function parseMaterialName(name) {
    const parts = normalizeText(name).split('_').map(part => part.trim()).filter(Boolean);
    const dimensionIndex = parts.findIndex(part => /^\d{2,5}x\d{2,5}$/i.test(part));
    const dimension = dimensionIndex >= 0 ? parts[dimensionIndex] : '';
    const rootIndex = parts.findIndex(part => ROOT_TAGS.includes(part));
    const tagEnd = dimensionIndex >= 0 ? dimensionIndex : parts.length;
    const tagPathParts = rootIndex >= 0 ? parts.slice(rootIndex, tagEnd) : [];
    const keywords = Array.from(new Set([
        ...tagPathParts,
        ...parts.slice(Math.max(0, tagEnd - 2), tagEnd)
    ].filter(Boolean)));

    return {
        parts,
        channel: parts[2] || '',
        dimension,
        tagPath: tagPathParts.join('/'),
        tagPathParts,
        keywords
    };
}

function naturalCompare(a, b) {
    return String(a).localeCompare(String(b), 'zh-CN', {
        numeric: true,
        sensitivity: 'base'
    });
}

function importCsvFile(filePath, options = {}) {
    const workbook = xlsx.readFile(filePath, {
        raw: false
    });
    const sheetName = workbook.SheetNames[0];
    const rows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], {
        defval: '',
        raw: false,
        blankrows: false
    });
    const fileName = path.basename(filePath);
    const month = parseMonth(fileName);
    const maxRows = Number.isFinite(Number(options.maxRowsPerFile))
        ? Math.max(1, Math.floor(Number(options.maxRowsPerFile)))
        : null;
    const selectedRows = maxRows ? rows.slice(0, maxRows) : rows;

    const materials = selectedRows.map((row, index) => {
        const rowNumber = index + 2;
        const name = getValue(row, ['素材名称', '素材名', '名称']);
        const contentText = getValue(row, ['素材内容', '内容', '素材链接']);
        const parsedName = parseMaterialName(name);

        return {
            id: hashId('material', [fileName, String(rowNumber), name, contentText]),
            sourceFile: filePath,
            sourceFileName: fileName,
            month,
            rowNumber,
            name,
            spend: parseNumber(getValue(row, ['花费', '消耗', 'cost'])),
            ctr: parseNumber(getValue(row, ['CTR'])),
            cpi: parseNumber(getValue(row, ['CPI'])),
            d0IapRoi: parseNumber(getValue(row, ['D0 IAP ROI', 'D0 ROI'])),
            d1IapRoi: parseNumber(getValue(row, ['D1 IAP ROI', 'D1 ROI'])),
            d7IapRoi: parseNumber(getValue(row, ['D7 IAP ROI', 'D7 ROI'])),
            contentUrl: extractContentUrl(contentText),
            contentText: contentText.slice(0, 500),
            parsedName
        };
    }).filter(material => material.name || material.contentUrl);

    return {
        fileName,
        month,
        sheetName,
        totalRows: rows.length,
        importedRows: materials.length,
        materials
    };
}

function addMetric(bucket, key, value) {
    if (!Number.isFinite(value)) return;
    bucket[`${key}Sum`] += value;
    bucket[`${key}Count`] += 1;
}

function avg(bucket, key) {
    const count = bucket[`${key}Count`];
    return count > 0 ? bucket[`${key}Sum`] / count : null;
}

function buildInsights(materials) {
    const buckets = new Map();

    for (const material of materials) {
        const pathKey = material.parsedName && material.parsedName.tagPath;
        if (!pathKey) continue;

        if (!buckets.has(pathKey)) {
            buckets.set(pathKey, {
                pathKey,
                materialCount: 0,
                spendSum: 0,
                spendCount: 0,
                ctrSum: 0,
                ctrCount: 0,
                cpiSum: 0,
                cpiCount: 0,
                d7IapRoiSum: 0,
                d7IapRoiCount: 0,
                topMaterials: [],
                keywordCounts: new Map()
            });
        }

        const bucket = buckets.get(pathKey);
        bucket.materialCount += 1;
        addMetric(bucket, 'spend', material.spend);
        addMetric(bucket, 'ctr', material.ctr);
        addMetric(bucket, 'cpi', material.cpi);
        addMetric(bucket, 'd7IapRoi', material.d7IapRoi);

        for (const keyword of material.parsedName.keywords || []) {
            bucket.keywordCounts.set(keyword, (bucket.keywordCounts.get(keyword) || 0) + 1);
        }

        const score = (Number(material.spend) || 0) * 0.001
            + (Number(material.ctr) || 0) * 100
            + (Number(material.d7IapRoi) || 0) * 10;
        bucket.topMaterials.push({
            id: material.id,
            name: material.name,
            score
        });
    }

    return Array.from(buckets.values()).map(bucket => ({
        pathKey: bucket.pathKey,
        materialCount: bucket.materialCount,
        totalSpend: bucket.spendSum,
        avgCtr: avg(bucket, 'ctr'),
        avgCpi: avg(bucket, 'cpi'),
        avgD7IapRoi: avg(bucket, 'd7IapRoi'),
        topNames: bucket.topMaterials
            .sort((a, b) => b.score - a.score)
            .slice(0, 10)
            .map(item => item.name),
        keywords: Array.from(bucket.keywordCounts.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 20)
            .map(([keyword]) => keyword)
    })).sort((a, b) => b.materialCount - a.materialCount);
}

function importTopMaterials(options = {}) {
    const directoryPath = options.directoryPath;
    if (!directoryPath || !fs.existsSync(directoryPath)) {
        return {
            materials: [],
            insights: [],
            fileSummaries: [],
            warnings: [`TOP 素材目录不存在: ${directoryPath || '未提供'}`],
            metadata: {
                sourceDir: directoryPath || '',
                fileCount: 0,
                totalRows: 0,
                importedRows: 0
            }
        };
    }

    const csvFiles = fs.readdirSync(directoryPath)
        .filter(fileName => fileName.toLowerCase().endsWith('.csv'))
        .sort(naturalCompare);
    const warnings = [];
    const fileSummaries = [];
    const materials = [];

    for (const fileName of csvFiles) {
        const filePath = path.join(directoryPath, fileName);
        try {
            const result = importCsvFile(filePath, options);
            materials.push(...result.materials);
            fileSummaries.push({
                fileName: result.fileName,
                month: result.month,
                sheetName: result.sheetName,
                totalRows: result.totalRows,
                importedRows: result.importedRows
            });
        } catch (error) {
            warnings.push(`${fileName} 导入失败: ${error.message}`);
        }
    }

    return {
        materials,
        insights: buildInsights(materials),
        fileSummaries,
        warnings,
        metadata: {
            sourceDir: directoryPath,
            fileCount: csvFiles.length,
            totalRows: fileSummaries.reduce((sum, item) => sum + item.totalRows, 0),
            importedRows: materials.length
        }
    };
}

module.exports = {
    buildInsights,
    extractContentUrl,
    importTopMaterials,
    parseMaterialName,
    parseNumber
};
