const crypto = require('crypto');
const XLSX = require('xlsx');
const { MaterialAnalysisStore } = require('./store');
const { analyzeMaterialRun } = require('./analyzer');

const HEADER_ALIASES = {
    materialName: ['素材名称', '素材名', '名称', 'name'],
    spend: ['花费', '消耗', 'cost', 'spend'],
    ctr: ['CTR'],
    installs: ['安装', '安装数', 'install', 'installs'],
    installShare: ['安装占比'],
    cvr: ['CVR'],
    cpi: ['CPI'],
    ipm: ['IPM'],
    d0Cpp: ['D0 CPP'],
    d0IapRoi: ['D0 IAP ROI', 'D0 ROI'],
    d1IapRoi: ['D1 IAP ROI', 'D1 ROI'],
    d2IapRoi: ['D2 IAP ROI', 'D2 ROI'],
    d3IapRoi: ['D3 IAP ROI', 'D3 ROI'],
    d4IapRoi: ['D4 IAP ROI', 'D4 ROI'],
    d5IapRoi: ['D5 IAP ROI', 'D5 ROI'],
    d6IapRoi: ['D6 IAP ROI', 'D6 ROI'],
    d7IapRoi: ['D7 IAP ROI', 'D7 ROI'],
    cpm: ['CPM'],
    content: ['素材内容', '内容', '素材链接', '图片链接', 'content']
};

const CATEGORY_TAGS = ['题材', '包装形式', '玩法', '角色', '趣味', '视频静帧截图'];

function nowStamp() {
    const date = new Date();
    const pad = value => String(value).padStart(2, '0');
    return [
        date.getFullYear(),
        pad(date.getMonth() + 1),
        pad(date.getDate()),
        '_',
        pad(date.getHours()),
        pad(date.getMinutes()),
        pad(date.getSeconds())
    ].join('');
}

function normalizeHeader(value) {
    return String(value || '')
        .replace(/^\uFEFF/, '')
        .replace(/\s+/g, '')
        .toLowerCase();
}

function normalizeText(value) {
    return String(value ?? '').trim();
}

function getRowValue(row, field) {
    const aliases = HEADER_ALIASES[field] || [field];
    const normalizedAliases = aliases.map(normalizeHeader);
    for (const key of Object.keys(row)) {
        if (normalizedAliases.includes(normalizeHeader(key))) {
            return row[key];
        }
    }
    return '';
}

function parseNumber(value) {
    const text = normalizeText(value);
    if (!text || text === '-' || text === '--' || /^nan|null$/i.test(text)) return null;
    const isPercent = text.includes('%');
    const number = Number(text.replace(/,/g, '').replace(/[^\d.-]/g, ''));
    if (!Number.isFinite(number)) return null;
    return isPercent ? number / 100 : number;
}

function extractContentUrl(value) {
    const text = normalizeText(value);
    const hyperlinkMatch = text.match(/HYPERLINK\("([^"]+)"/i);
    if (hyperlinkMatch) return hyperlinkMatch[1];
    const urlMatch = text.match(/https?:\/\/[^\s")]+/i);
    return urlMatch ? urlMatch[0] : '';
}

function parseMaterialName(name) {
    const parts = normalizeText(name).split('_').map(part => part.trim()).filter(Boolean);
    const sizePart = [...parts].reverse().find(part => /^\d{2,5}[x×]\d{2,5}$/i.test(part)) || '';
    const categoryIndex = parts.findIndex(part => CATEGORY_TAGS.includes(part));
    const channel = parts[2] && categoryIndex !== 2 ? parts[2] : '';
    const primary = categoryIndex >= 0 ? parts[categoryIndex] : '';
    const secondary = categoryIndex >= 0 && categoryIndex + 1 < parts.length ? parts[categoryIndex + 1] : '';
    const idea = categoryIndex >= 0 && categoryIndex + 2 < parts.length ? parts[categoryIndex + 2] : '';

    return {
        parts,
        channel,
        primary,
        secondary,
        idea,
        size: sizePart.replace('×', 'x')
    };
}

function hashId(prefix, values) {
    const hash = crypto
        .createHash('sha1')
        .update(values.map(value => String(value || '')).join('|'))
        .digest('hex')
        .slice(0, 12);
    return `${prefix}_${hash}`;
}

function workbookRowsFromText(fileContent, fileName) {
    const ext = String(fileName || '').toLowerCase();
    const workbook = ext.endsWith('.xlsx') || ext.endsWith('.xls')
        ? XLSX.read(Buffer.from(fileContent, 'base64'), { type: 'buffer', raw: false })
        : XLSX.read(String(fileContent || ''), { type: 'string', raw: true });
    const sheetName = workbook.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
        defval: '',
        raw: !ext.endsWith('.xlsx') && !ext.endsWith('.xls'),
        blankrows: false
    });
    return {
        sheetName,
        rows
    };
}

function buildRunId(projectName, weekId, sourceFileName) {
    return hashId(`analysis_${nowStamp()}`, [projectName, weekId, sourceFileName, Date.now()]);
}

function normalizeMaterial(row, index, context) {
    const materialName = normalizeText(getRowValue(row, 'materialName'));
    const contentText = normalizeText(getRowValue(row, 'content'));
    const contentUrl = extractContentUrl(contentText);
    const parsedName = parseMaterialName(materialName);

    return {
        materialId: hashId('material', [context.runId, index + 2, materialName, contentUrl]),
        runId: context.runId,
        projectName: context.projectName,
        weekId: context.weekId,
        sourceFileName: context.sourceFileName,
        rowNumber: index + 2,
        materialName,
        spend: parseNumber(getRowValue(row, 'spend')),
        ctr: parseNumber(getRowValue(row, 'ctr')),
        installs: parseNumber(getRowValue(row, 'installs')),
        installShare: parseNumber(getRowValue(row, 'installShare')),
        cvr: parseNumber(getRowValue(row, 'cvr')),
        cpi: parseNumber(getRowValue(row, 'cpi')),
        ipm: parseNumber(getRowValue(row, 'ipm')),
        d0Cpp: parseNumber(getRowValue(row, 'd0Cpp')),
        d0IapRoi: parseNumber(getRowValue(row, 'd0IapRoi')),
        d1IapRoi: parseNumber(getRowValue(row, 'd1IapRoi')),
        d2IapRoi: parseNumber(getRowValue(row, 'd2IapRoi')),
        d3IapRoi: parseNumber(getRowValue(row, 'd3IapRoi')),
        d4IapRoi: parseNumber(getRowValue(row, 'd4IapRoi')),
        d5IapRoi: parseNumber(getRowValue(row, 'd5IapRoi')),
        d6IapRoi: parseNumber(getRowValue(row, 'd6IapRoi')),
        d7IapRoi: parseNumber(getRowValue(row, 'd7IapRoi')),
        cpm: parseNumber(getRowValue(row, 'cpm')),
        contentUrl,
        contentText: contentText.slice(0, 500),
        parsedName
    };
}

function sumNumbers(items, key) {
    return items.reduce((sum, item) => sum + (Number.isFinite(Number(item[key])) ? Number(item[key]) : 0), 0);
}

function rateCoverage(items, key) {
    if (!items.length) return 0;
    return items.filter(item => Number.isFinite(Number(item[key]))).length / items.length;
}

function buildSummary({ runId, projectName, weekId, sourceFileName, sheetName, rows, materials, top100 }) {
    const totalSpend = sumNumbers(materials, 'spend');
    const totalInstalls = sumNumbers(materials, 'installs');
    const top10Spend = sumNumbers(top100.slice(0, 10), 'spend');
    const top100Spend = sumNumbers(top100, 'spend');

    return {
        success: true,
        runId,
        projectName,
        weekId,
        sourceFileName,
        sheetName,
        importedAt: new Date().toISOString(),
        totalRows: rows.length,
        materialRows: materials.length,
        topRule: 'spend_desc_top_100',
        top100Count: top100.length,
        totalSpend,
        totalInstalls,
        top10SpendShare: totalSpend > 0 ? top10Spend / totalSpend : 0,
        top100SpendShare: totalSpend > 0 ? top100Spend / totalSpend : 0,
        d0RoiCoverage: rateCoverage(materials, 'd0IapRoi'),
        parsedPrimaryRate: materials.length
            ? materials.filter(item => item.parsedName && item.parsedName.primary).length / materials.length
            : 0,
        parsedSizeRate: materials.length
            ? materials.filter(item => item.parsedName && item.parsedName.size).length / materials.length
            : 0
    };
}

function hydrateContentUrlsFromRows(materials = [], rows = []) {
    if (!Array.isArray(rows) || !rows.length) return materials;
    return materials.map(material => {
        if (material.contentUrl) return material;
        const sourceRow = rows[(Number(material.rowNumber) || 0) - 2];
        if (!sourceRow) return material;
        const contentText = normalizeText(getRowValue(sourceRow, 'content'));
        const contentUrl = extractContentUrl(contentText);
        if (!contentUrl) return material;
        return {
            ...material,
            contentText: contentText.slice(0, 500),
            contentUrl
        };
    });
}

class MaterialAnalysisService {
    constructor(context = {}) {
        this.rootDir = context.ROOT_DIR || context.rootDir || process.cwd();
        this.logger = context.logger;
        this.store = new MaterialAnalysisStore(this.rootDir);
    }

    importTable(payload = {}) {
        const projectName = normalizeText(payload.projectName) || '无尽冬日';
        const weekId = normalizeText(payload.weekId) || '未填写周次';
        const sourceFileName = normalizeText(payload.fileName || payload.sourceFileName) || 'material-analysis.csv';
        const fileContent = payload.fileContent || payload.csvText || '';
        if (!fileContent) {
            throw new Error('请先选择或提供素材数据表内容');
        }

        const runId = buildRunId(projectName, weekId, sourceFileName);
        const { sheetName, rows } = workbookRowsFromText(fileContent, sourceFileName);
        const context = { runId, projectName, weekId, sourceFileName };
        const materials = rows
            .map((row, index) => normalizeMaterial(row, index, context))
            .filter(item => item.materialName && item.materialName !== '-');
        const top100 = [...materials]
            .sort((a, b) => (Number(b.spend) || 0) - (Number(a.spend) || 0))
            .slice(0, 100)
            .map((item, index) => ({
                ...item,
                topRank: index + 1
            }));
        const summary = buildSummary({
            runId,
            projectName,
            weekId,
            sourceFileName,
            sheetName,
            rows,
            materials,
            top100
        });
        const runDir = this.store.writeImport({
            runId,
            projectName,
            weekId,
            sourceText: String(fileContent || ''),
            summary,
            materials,
            top100
        });

        if (this.logger && typeof this.logger.success === 'function') {
            this.logger.success(`素材分析导入完成：${projectName} ${weekId}，Top100 已生成`);
        }

        const analysis = analyzeMaterialRun(summary, materials, top100);

        return {
            success: true,
            summary: {
                ...summary,
                runDir
            },
            overview: analysis.overview,
            directions: analysis.directions,
            top100: analysis.top100
        };
    }

    listImports() {
        return {
            success: true,
            imports: this.store.listImports()
        };
    }

    getImport(runId) {
        const summary = this.store.findImport(runId);
        if (!summary) {
            return {
                success: false,
                message: '素材分析导入记录不存在'
            };
        }
        const materials = this.hydrateStoredMaterials(runId, this.store.readImportFile(runId, 'normalized-materials.json', []));
        const top100 = this.hydrateStoredMaterials(runId, this.store.readImportFile(runId, 'top100.json', []));
        const analysis = analyzeMaterialRun(summary, materials, top100);

        return {
            success: true,
            summary,
            overview: analysis.overview,
            directions: analysis.directions,
            materials: analysis.materials,
            top100: analysis.top100
        };
    }

    deleteImport(runId) {
        const deleted = this.store.deleteImport(runId);
        if (!deleted) {
            return {
                success: false,
                message: '素材分析导入记录不存在'
            };
        }

        if (this.logger && typeof this.logger.warn === 'function') {
            this.logger.warn(`素材分析导入记录已删除：${deleted.projectName || '--'} ${deleted.weekId || '--'} ${deleted.runId || runId}`);
        }

        return {
            success: true,
            deleted,
            imports: this.store.listImports(),
            message: '素材分析导入记录已删除'
        };
    }

    getTop100(runId) {
        const summary = this.store.findImport(runId);
        if (!summary) {
            return {
                success: false,
                message: '素材分析导入记录不存在'
            };
        }
        const materials = this.hydrateStoredMaterials(runId, this.store.readImportFile(runId, 'normalized-materials.json', []));
        const top100 = this.hydrateStoredMaterials(runId, this.store.readImportFile(runId, 'top100.json', []));
        const analysis = analyzeMaterialRun(summary, materials, top100);

        return {
            success: true,
            summary,
            overview: analysis.overview,
            top100: analysis.top100
        };
    }

    getOverview(runId) {
        const detail = this.getImport(runId);
        if (!detail.success) return detail;
        return {
            success: true,
            summary: detail.summary,
            overview: detail.overview
        };
    }

    getDirections(runId) {
        const detail = this.getImport(runId);
        if (!detail.success) return detail;
        return {
            success: true,
            summary: detail.summary,
            directions: detail.directions
        };
    }

    getMaterial(runId, materialId) {
        const detail = this.getImport(runId);
        if (!detail.success) return detail;
        const material = detail.materials.find(item => item.materialId === materialId);
        if (!material) {
            return {
                success: false,
                message: '素材不存在'
            };
        }
        return {
            success: true,
            summary: detail.summary,
            material
        };
    }

    hydrateStoredMaterials(runId, materials = []) {
        if (!Array.isArray(materials) || !materials.length) return [];
        if (materials.some(material => material.contentUrl)) return materials;
        const summary = this.store.findImport(runId);
        const sourceText = this.store.readImportTextFile(runId, 'source.csv', '');
        if (!summary || !sourceText) return materials;
        try {
            const parsed = workbookRowsFromText(sourceText, summary.sourceFileName || 'source.csv');
            return hydrateContentUrlsFromRows(materials, parsed.rows);
        } catch (error) {
            return materials;
        }
    }
}

function createMaterialAnalysisService(context) {
    return new MaterialAnalysisService(context);
}

module.exports = {
    createMaterialAnalysisService,
    MaterialAnalysisService,
    parseMaterialName,
    extractContentUrl,
    parseNumber,
    workbookRowsFromText,
    hydrateContentUrlsFromRows
};
