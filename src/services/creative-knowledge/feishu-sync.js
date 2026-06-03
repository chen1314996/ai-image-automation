const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { readConfig, updateConfig } = require('../../../config-store');
const { readSecrets, updateSecrets } = require('../../../secrets-store');
const { CreativeKnowledgeStore } = require('./store');
const { buildInsights, parseMaterialName, parseNumber } = require('./top-material-importer');

const DEFAULT_FEISHU_SYNC_CONFIG = {
    enabled: false,
    domain: 'feishu',
    apiBaseUrl: '',
    timeoutMs: 20000,
    sources: {
        directions: {
            enabled: false,
            type: 'sheet',
            token: '',
            sheetId: '',
            tableId: '',
            range: 'A1:ZZ5000',
            fieldMap: {
                path: '方向路径',
                name: '方向名称',
                primaryTag: '一级标签',
                secondaryTag: '二级标签',
                tertiaryTag: '三级标签',
                subTag: '细分标签',
                description: '方向描述',
                tags: '标签',
                status: '状态',
                priority: '优先级',
                autoRun: '自动运行',
                referenceHints: '参考图线索',
                mustKeep: '必须保留',
                mustAvoid: '必须避开'
            }
        },
        topMaterials: {
            enabled: false,
            type: 'sheet',
            token: '',
            sheetId: '',
            tableId: '',
            range: 'A1:ZZ5000',
            fieldMap: {
                projectName: '项目',
                weekId: '周次',
                month: '月份',
                materialName: '素材名称',
                contentUrl: '素材链接',
                spend: '花费',
                ctr: 'CTR',
                cpi: 'CPI',
                d0IapRoi: 'D0 IAP ROI',
                d1IapRoi: 'D1 IAP ROI',
                d7IapRoi: 'D7 IAP ROI'
            }
        },
        referenceImages: {
            enabled: false,
            type: 'sheet',
            token: '',
            sheetId: '',
            tableId: '',
            range: 'A1:ZZ5000',
            fieldMap: {
                directionPath: '方向路径',
                directionName: '方向名称',
                imageUrl: '图片URL',
                attachment: '附件',
                localPath: '本地路径',
                fileName: '文件名',
                sourceSlot: '槽位',
                tags: '标签'
            }
        }
    }
};

const FIELD_ALIASES = {
    directions: {
        path: ['方向路径', '路径', 'path'],
        name: ['方向名称', '名称', 'name'],
        primaryTag: ['一级标签', '一级', 'primaryTag'],
        secondaryTag: ['二级标签', '二级', 'secondaryTag'],
        tertiaryTag: ['三级标签', '三级', '三极标签', 'tertiaryTag'],
        subTag: ['细分标签', '细分', 'subTag'],
        description: ['方向描述', '方向简述', '描述', 'description'],
        tags: ['标签', 'tags'],
        status: ['状态', 'status'],
        priority: ['优先级', '权重', 'priority'],
        autoRun: ['自动运行', '是否自动运行', 'autoRun'],
        referenceHints: ['参考图线索', '参考图', '参考图1', '参考图 1', 'referenceHints'],
        mustKeep: ['必须保留', '保留', 'mustKeep'],
        mustAvoid: ['必须避开', '避免', '禁用', 'mustAvoid']
    },
    topMaterials: {
        projectName: ['项目', '项目名', 'projectName'],
        weekId: ['周次', 'week', 'weekId'],
        month: ['月份', 'month'],
        materialName: ['素材名称', '素材名', '名称', 'materialName'],
        contentUrl: ['素材链接', '素材内容', '链接', 'URL', 'contentUrl'],
        spend: ['花费', '消耗', 'cost', 'spend'],
        ctr: ['CTR', 'ctr'],
        cpi: ['CPI', 'cpi'],
        d0IapRoi: ['D0 IAP ROI', 'D0 ROI', 'd0IapRoi'],
        d1IapRoi: ['D1 IAP ROI', 'D1 ROI', 'd1IapRoi'],
        d7IapRoi: ['D7 IAP ROI', 'D7 ROI', 'd7IapRoi']
    },
    referenceImages: {
        directionPath: ['方向路径', '路径', 'directionPath'],
        directionName: ['方向名称', '方向', 'directionName'],
        imageUrl: ['图片URL', '图片链接', 'URL', 'imageUrl'],
        attachment: ['附件', '图片附件', 'attachment'],
        localPath: ['本地路径', '本地文件', 'localPath'],
        fileName: ['文件名', '图片名', 'fileName'],
        sourceSlot: ['槽位', '位置', 'sourceSlot'],
        tags: ['标签', 'tags']
    }
};

const REQUIRED_FIELD_GROUPS = {
    directions: [
        ['path', 'primaryTag', 'name']
    ],
    topMaterials: [
        ['materialName', 'contentUrl']
    ],
    referenceImages: [
        ['imageUrl', 'attachment', 'localPath']
    ]
};

const DIRECTION_STATUSES = new Set(['seed', 'draft', 'accepted', 'rejected', 'archived', 'disabled']);

function nowIso() {
    return new Date().toISOString();
}

function normalizeText(value) {
    if (value === undefined || value === null) return '';
    if (Array.isArray(value)) {
        return value.map(normalizeText).filter(Boolean).join('；');
    }
    if (typeof value === 'object') {
        if (value.text !== undefined) return normalizeText(value.text);
        if (value.name !== undefined) return normalizeText(value.name);
        if (value.url !== undefined) return normalizeText(value.url);
        if (value.link !== undefined) return normalizeText(value.link);
        if (value.file_token !== undefined) return normalizeText(value.file_token);
        if (value.attachmentToken !== undefined) return normalizeText(value.attachmentToken);
        return Object.values(value).map(normalizeText).filter(Boolean).join('；');
    }
    return String(value).replace(/\uFEFF/g, '').trim();
}

function normalizeHeader(value) {
    return normalizeText(value).replace(/\s+/g, '').toLowerCase();
}

function safeArray(value) {
    return Array.isArray(value) ? value : [];
}

function splitList(value) {
    if (Array.isArray(value)) return value.map(normalizeText).filter(Boolean);
    return normalizeText(value)
        .split(/[,\n，、;；|]/)
        .map(item => item.trim())
        .filter(Boolean);
}

function hashId(prefix, values) {
    const hash = crypto
        .createHash('sha1')
        .update(values.map(normalizeText).filter(Boolean).join('|'))
        .digest('hex')
        .slice(0, 12);
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
    const number = Number(normalizeText(value).replace(/[^\d.-]/g, ''));
    if (!Number.isFinite(number)) return fallback;
    return Math.max(1, Math.min(100, Math.round(number)));
}

function normalizeDirectionStatus(value, fallback = 'seed') {
    const text = normalizeText(value).toLowerCase();
    if (!text) return fallback;
    const mapped = {
        种子: 'seed',
        草案: 'draft',
        待确认: 'draft',
        已采纳: 'accepted',
        采纳: 'accepted',
        接受: 'accepted',
        已拒绝: 'rejected',
        拒绝: 'rejected',
        已归档: 'archived',
        归档: 'archived',
        禁跑: 'disabled',
        禁用: 'disabled',
        停用: 'disabled'
    }[text] || text;
    return DIRECTION_STATUSES.has(mapped) ? mapped : fallback;
}

function normalizeSource(source = {}) {
    const base = source && typeof source === 'object' ? source : {};
    return {
        enabled: base.enabled === true,
        type: base.type === 'bitable' ? 'bitable' : 'sheet',
        token: normalizeText(base.token),
        sheetId: normalizeText(base.sheetId),
        tableId: normalizeText(base.tableId),
        range: normalizeText(base.range) || 'A1:ZZ5000',
        fieldMap: base.fieldMap && typeof base.fieldMap === 'object' ? { ...base.fieldMap } : {}
    };
}

function mergeSource(defaultSource, source = {}) {
    const normalized = normalizeSource({
        ...defaultSource,
        ...source
    });
    normalized.fieldMap = {
        ...(defaultSource.fieldMap || {}),
        ...(source && typeof source.fieldMap === 'object' ? source.fieldMap : {})
    };
    return normalized;
}

function readFeishuSyncConfig(overrides = {}) {
    const storedConfig = readConfig();
    const secrets = readSecrets();
    const stored = storedConfig.feishuSync && typeof storedConfig.feishuSync === 'object'
        ? storedConfig.feishuSync
        : {};
    const merged = {
        ...DEFAULT_FEISHU_SYNC_CONFIG,
        ...stored,
        ...overrides
    };

    const sources = {};
    Object.keys(DEFAULT_FEISHU_SYNC_CONFIG.sources).forEach(key => {
        sources[key] = mergeSource(
            DEFAULT_FEISHU_SYNC_CONFIG.sources[key],
            {
                ...(stored.sources && stored.sources[key] ? stored.sources[key] : {}),
                ...(overrides.sources && overrides.sources[key] ? overrides.sources[key] : {})
            }
        );
    });

    return {
        enabled: merged.enabled === true,
        domain: merged.domain === 'lark' ? 'lark' : 'feishu',
        apiBaseUrl: normalizeText(merged.apiBaseUrl || process.env.FEISHU_SYNC_API_BASE_URL),
        timeoutMs: Math.max(3000, Math.min(120000, Number(merged.timeoutMs) || 20000)),
        appId: normalizeText(
            overrides.appId ||
            process.env.FEISHU_SYNC_APP_ID ||
            secrets.feishuSyncAppId ||
            secrets.feishuSdkAppId ||
            secrets.feishuCliAppId ||
            stored.appId
        ),
        appSecret: normalizeText(
            overrides.appSecret ||
            process.env.FEISHU_SYNC_APP_SECRET ||
            secrets.feishuSyncAppSecret ||
            secrets.feishuSdkAppSecret ||
            secrets.feishuCliAppSecret
        ),
        sources
    };
}

function getPublicFeishuSyncConfig(config = readFeishuSyncConfig()) {
    return {
        enabled: config.enabled,
        domain: config.domain,
        apiBaseUrl: config.apiBaseUrl,
        timeoutMs: config.timeoutMs,
        appId: config.appId,
        appSecretConfigured: Boolean(config.appSecret),
        sources: config.sources
    };
}

function saveFeishuSyncConfig(payload = {}) {
    const current = readFeishuSyncConfig();
    const sourcePayload = payload.sources && typeof payload.sources === 'object' ? payload.sources : {};
    const sources = {};
    Object.keys(DEFAULT_FEISHU_SYNC_CONFIG.sources).forEach(key => {
        sources[key] = mergeSource(
            current.sources[key] || DEFAULT_FEISHU_SYNC_CONFIG.sources[key],
            sourcePayload[key] || {}
        );
    });

    const nextStored = {
        enabled: payload.enabled === true,
        domain: payload.domain === 'lark' ? 'lark' : 'feishu',
        apiBaseUrl: normalizeText(payload.apiBaseUrl),
        timeoutMs: Math.max(3000, Math.min(120000, Number(payload.timeoutMs) || current.timeoutMs || 20000)),
        appId: normalizeText(payload.appId),
        sources
    };
    updateConfig({ feishuSync: nextStored });

    const secretUpdates = {};
    if (normalizeText(payload.appId)) {
        secretUpdates.feishuSyncAppId = normalizeText(payload.appId);
    }
    if (normalizeText(payload.appSecret)) {
        secretUpdates.feishuSyncAppSecret = normalizeText(payload.appSecret);
    }
    if (payload.clearAppSecret === true) {
        secretUpdates.feishuSyncAppSecret = '';
    }
    if (Object.keys(secretUpdates).length) {
        updateSecrets(secretUpdates);
    }

    return getPublicFeishuSyncConfig(readFeishuSyncConfig());
}

function getApiBaseUrl(config) {
    if (config.apiBaseUrl) return config.apiBaseUrl.replace(/\/+$/, '');
    return config.domain === 'lark'
        ? 'https://open.larksuite.com'
        : 'https://open.feishu.cn';
}

function validateSourceConfig(key, source, warnings) {
    if (!source.enabled) return;
    if (!source.token) warnings.push(`${sourceLabel(key)}未配置表格或多维表 token`);
    if (source.type === 'bitable' && !source.tableId) warnings.push(`${sourceLabel(key)}使用多维表时必须配置 table id`);
    if (source.type === 'sheet' && !source.sheetId) warnings.push(`${sourceLabel(key)}使用电子表格时必须配置 sheet id`);
}

function validateFeishuSyncConfig(config = readFeishuSyncConfig()) {
    const warnings = [];
    if (!config.enabled) warnings.push('飞书只读同步尚未启用');
    if (!config.appId) warnings.push('未配置飞书 App ID');
    if (!config.appSecret) warnings.push('未配置飞书 App Secret');
    const enabledSources = Object.entries(config.sources).filter(([, source]) => source.enabled);
    if (!enabledSources.length) warnings.push('至少启用一个同步来源：方向、TOP 素材或参考图线索');
    enabledSources.forEach(([key, source]) => validateSourceConfig(key, source, warnings));
    return {
        success: warnings.length === 0,
        warnings
    };
}

function sourceLabel(key) {
    return {
        directions: '方向表',
        topMaterials: 'TOP素材表',
        referenceImages: '参考图线索表'
    }[key] || key;
}

function compactRowsForValidation(rows = []) {
    const fieldSet = new Set();
    safeArray(rows).forEach(row => {
        Object.keys(row.fields || {}).forEach(key => fieldSet.add(normalizeHeader(key)));
    });
    return fieldSet;
}

function mappingNames(fieldMap = {}, key, aliases = []) {
    return splitList(fieldMap[key]).concat(aliases || []);
}

function getMapped(row, sourceKey, fieldMap, key) {
    const fields = row.fields || {};
    const aliases = mappingNames(fieldMap, key, FIELD_ALIASES[sourceKey] && FIELD_ALIASES[sourceKey][key]);
    const normalizedAliases = aliases.map(normalizeHeader).filter(Boolean);

    for (const [fieldName, value] of Object.entries(fields)) {
        const normalizedField = normalizeHeader(fieldName);
        if (normalizedAliases.some(alias => alias === normalizedField)) {
            return normalizeText(value);
        }
    }

    for (const [fieldName, value] of Object.entries(fields)) {
        const normalizedField = normalizeHeader(fieldName);
        if (normalizedAliases.some(alias => alias && normalizedField.includes(alias))) {
            return normalizeText(value);
        }
    }
    return '';
}

function validateMappedRows(sourceKey, rows, fieldMap, warnings) {
    if (!rows.length) {
        warnings.push(`${sourceLabel(sourceKey)}没有读到数据行`);
        return;
    }

    const availableFields = compactRowsForValidation(rows);
    const missingMapped = Object.entries(fieldMap || {})
        .filter(([, mappedName]) => normalizeText(mappedName))
        .filter(([, mappedName]) => splitList(mappedName).every(name => !availableFields.has(normalizeHeader(name))))
        .map(([key, mappedName]) => `${key}=${mappedName}`);
    if (missingMapped.length) {
        warnings.push(`${sourceLabel(sourceKey)}字段映射未命中：${missingMapped.slice(0, 8).join('，')}`);
    }

    for (const group of REQUIRED_FIELD_GROUPS[sourceKey] || []) {
        const hasAny = group.some(key => rows.some(row => getMapped(row, sourceKey, fieldMap, key)));
        if (!hasAny) {
            warnings.push(`${sourceLabel(sourceKey)}缺少关键字段：${group.join(' / ')} 至少需要一个`);
        }
    }
}

function buildAxios(config, token) {
    return axios.create({
        baseURL: getApiBaseUrl(config),
        timeout: config.timeoutMs,
        headers: token ? { Authorization: `Bearer ${token}` } : undefined
    });
}

function describeFeishuError(error, fallback = '飞书接口请求失败') {
    const response = error && error.response;
    const data = response && response.data;
    if (data && typeof data === 'object') {
        const code = data.code !== undefined ? `code=${data.code}` : '';
        const message = data.msg || data.message || data.error || fallback;
        if (response.status === 401 || response.status === 403) {
            return `飞书权限不足或凭据无效：${message} ${code}`.trim();
        }
        if (response.status === 404) {
            return `飞书表格 token、sheet id 或 table id 可能错误：${message} ${code}`.trim();
        }
        return `${fallback}：${message} ${code}`.trim();
    }
    if (response && response.status) {
        return `${fallback}：HTTP ${response.status}`;
    }
    return error && error.message ? `${fallback}：${error.message}` : fallback;
}

async function getTenantAccessToken(config) {
    const validation = validateFeishuSyncConfig(config);
    const credentialWarnings = validation.warnings.filter(message => /App ID|App Secret/.test(message));
    if (credentialWarnings.length) {
        throw new Error(credentialWarnings.join('；'));
    }

    try {
        const client = buildAxios(config);
        const response = await client.post('/open-apis/auth/v3/tenant_access_token/internal', {
            app_id: config.appId,
            app_secret: config.appSecret
        });
        const data = response.data || {};
        if (data.code !== 0 || !data.tenant_access_token) {
            throw new Error(data.msg || data.message || `code=${data.code}`);
        }
        return data.tenant_access_token;
    } catch (error) {
        throw new Error(describeFeishuError(error, '获取飞书 tenant_access_token 失败'));
    }
}

function sheetValuesToRows(values = []) {
    const rows = safeArray(values);
    const headers = safeArray(rows[0]).map(normalizeText);
    return rows.slice(1)
        .map((row, index) => {
            const fields = {};
            headers.forEach((header, columnIndex) => {
                if (header) fields[header] = normalizeText(row[columnIndex]);
            });
            return {
                rowNumber: index + 2,
                recordId: '',
                fields
            };
        })
        .filter(row => Object.values(row.fields).some(Boolean));
}

async function fetchSheetRows(config, token, source) {
    const rangeText = `${source.sheetId}!${source.range || 'A1:ZZ5000'}`;
    const client = buildAxios(config, token);
    try {
        const response = await client.get(
            `/open-apis/sheets/v2/spreadsheets/${encodeURIComponent(source.token)}/values/${encodeURIComponent(rangeText)}`
        );
        const data = response.data || {};
        if (data.code !== 0) {
            throw new Error(data.msg || data.message || `code=${data.code}`);
        }
        const values = data.data && data.data.valueRange && data.data.valueRange.values
            ? data.data.valueRange.values
            : [];
        return sheetValuesToRows(values);
    } catch (error) {
        throw new Error(describeFeishuError(error, '读取飞书电子表格失败'));
    }
}

function bitableFieldsToRows(items = []) {
    return safeArray(items)
        .map((item, index) => ({
            rowNumber: index + 1,
            recordId: normalizeText(item && (item.record_id || item.recordId)),
            fields: Object.fromEntries(
                Object.entries((item && item.fields) || {}).map(([key, value]) => [key, normalizeText(value)])
            )
        }))
        .filter(row => Object.values(row.fields).some(Boolean));
}

async function fetchBitableRows(config, token, source) {
    const client = buildAxios(config, token);
    const rows = [];
    let pageToken = '';

    try {
        do {
            const params = { page_size: 500 };
            if (pageToken) params.page_token = pageToken;
            const response = await client.get(
                `/open-apis/bitable/v1/apps/${encodeURIComponent(source.token)}/tables/${encodeURIComponent(source.tableId)}/records`,
                { params }
            );
            const data = response.data || {};
            if (data.code !== 0) {
                throw new Error(data.msg || data.message || `code=${data.code}`);
            }
            const payload = data.data || {};
            rows.push(...bitableFieldsToRows(payload.items || []));
            pageToken = payload.has_more ? normalizeText(payload.page_token) : '';
        } while (pageToken);
        return rows;
    } catch (error) {
        throw new Error(describeFeishuError(error, '读取飞书多维表失败'));
    }
}

async function fetchSourceRows(config, token, source) {
    if (source.type === 'bitable') {
        return await fetchBitableRows(config, token, source);
    }
    return await fetchSheetRows(config, token, source);
}

function splitDirectionPath(value) {
    return normalizeText(value).split('/').map(item => item.trim()).filter(Boolean);
}

function directionPathFromRow(row, fieldMap) {
    const pathValue = getMapped(row, 'directions', fieldMap, 'path');
    if (pathValue) return pathValue;
    return [
        getMapped(row, 'directions', fieldMap, 'primaryTag'),
        getMapped(row, 'directions', fieldMap, 'secondaryTag'),
        getMapped(row, 'directions', fieldMap, 'tertiaryTag'),
        getMapped(row, 'directions', fieldMap, 'subTag')
    ].filter(Boolean).join('/');
}

function normalizeDirections(rows = [], source) {
    const fieldMap = source.fieldMap || {};
    const directions = [];
    const seen = new Set();

    safeArray(rows).forEach(row => {
        const directionPath = directionPathFromRow(row, fieldMap);
        const description = getMapped(row, 'directions', fieldMap, 'description');
        if (!directionPath && !description) return;

        const parts = splitDirectionPath(directionPath);
        const primaryTag = getMapped(row, 'directions', fieldMap, 'primaryTag') || parts[0] || '';
        const secondaryTag = getMapped(row, 'directions', fieldMap, 'secondaryTag') || parts[1] || '';
        const tertiaryTag = getMapped(row, 'directions', fieldMap, 'tertiaryTag') || parts[2] || '';
        const subTag = getMapped(row, 'directions', fieldMap, 'subTag') || parts.slice(3).join('/') || '';
        const name = getMapped(row, 'directions', fieldMap, 'name') || subTag || tertiaryTag || secondaryTag || primaryTag || directionPath;
        const sourceKey = row.recordId || String(row.rowNumber) || directionPath;
        let id = hashId('direction_feishu', [source.token, source.sheetId || source.tableId, sourceKey, directionPath, name]);
        if (seen.has(id)) {
            id = hashId('direction_feishu', [source.token, sourceKey, directionPath, name, String(directions.length + 1)]);
        }
        seen.add(id);

        directions.push({
            id,
            rowNumber: row.rowNumber,
            orderIndex: directions.length + 1,
            sheetName: source.sheetId || source.tableId || '',
            path: directionPath || name,
            name,
            primaryTag,
            secondaryTag,
            tertiaryTag,
            subTag,
            description,
            tags: splitList(getMapped(row, 'directions', fieldMap, 'tags')),
            referenceHints: splitList(getMapped(row, 'directions', fieldMap, 'referenceHints')),
            mustKeep: getMapped(row, 'directions', fieldMap, 'mustKeep'),
            mustAvoid: getMapped(row, 'directions', fieldMap, 'mustAvoid'),
            autoRun: parseBoolean(getMapped(row, 'directions', fieldMap, 'autoRun'), true),
            priority: parsePriority(getMapped(row, 'directions', fieldMap, 'priority'), 50),
            status: normalizeDirectionStatus(getMapped(row, 'directions', fieldMap, 'status'), 'seed'),
            feishuStatus: normalizeDirectionStatus(getMapped(row, 'directions', fieldMap, 'status'), 'seed'),
            source: 'feishu-readonly',
            sourceType: source.type,
            sourceToken: source.token,
            sourceSheetId: source.sheetId || '',
            sourceTableId: source.tableId || '',
            sourceRecordId: row.recordId || '',
            sourceSheetRow: row.rowNumber,
            stats: {
                expandedCount: 0,
                promptCount: 0,
                imageCount: 0,
                lastRunAt: null,
                failureCount: 0
            }
        });
    });

    return directions;
}

function extractUrl(value) {
    const text = normalizeText(value);
    const hyperlinkMatch = text.match(/HYPERLINK\("([^"]+)"/i);
    if (hyperlinkMatch) return hyperlinkMatch[1];
    const urlMatch = text.match(/https?:\/\/[^\s")]+/i);
    return urlMatch ? urlMatch[0] : text;
}

function normalizeTopMaterials(rows = [], source) {
    const fieldMap = source.fieldMap || {};
    return safeArray(rows).map(row => {
        const name = getMapped(row, 'topMaterials', fieldMap, 'materialName');
        const contentUrl = extractUrl(getMapped(row, 'topMaterials', fieldMap, 'contentUrl'));
        const projectName = getMapped(row, 'topMaterials', fieldMap, 'projectName');
        const weekId = getMapped(row, 'topMaterials', fieldMap, 'weekId');
        const month = getMapped(row, 'topMaterials', fieldMap, 'month');
        if (!name && !contentUrl) return null;
        return {
            id: hashId('material_feishu', [source.token, source.sheetId || source.tableId, row.recordId || String(row.rowNumber), name, contentUrl]),
            source: 'feishu-readonly',
            sourceType: source.type,
            sourceToken: source.token,
            sourceSheetId: source.sheetId || '',
            sourceTableId: source.tableId || '',
            sourceRecordId: row.recordId || '',
            sourceSheetRow: row.rowNumber,
            projectName,
            weekId,
            month,
            rowNumber: row.rowNumber,
            name,
            spend: parseNumber(getMapped(row, 'topMaterials', fieldMap, 'spend')),
            ctr: parseNumber(getMapped(row, 'topMaterials', fieldMap, 'ctr')),
            cpi: parseNumber(getMapped(row, 'topMaterials', fieldMap, 'cpi')),
            d0IapRoi: parseNumber(getMapped(row, 'topMaterials', fieldMap, 'd0IapRoi')),
            d1IapRoi: parseNumber(getMapped(row, 'topMaterials', fieldMap, 'd1IapRoi')),
            d7IapRoi: parseNumber(getMapped(row, 'topMaterials', fieldMap, 'd7IapRoi')),
            contentUrl,
            contentText: contentUrl,
            parsedName: parseMaterialName(name)
        };
    }).filter(Boolean);
}

function findDirectionIdsForReference(image, directions = []) {
    const pathText = normalizeText(image.directionPath);
    const nameText = normalizeText(image.directionName);
    if (!pathText && !nameText) return [];
    return safeArray(directions)
        .filter(direction => {
            const directionPath = normalizeText(direction.path);
            const directionName = normalizeText(direction.name);
            return (
                pathText && (directionPath === pathText || directionPath.includes(pathText) || pathText.includes(directionPath))
            ) || (
                nameText && (directionName === nameText || directionPath.endsWith(`/${nameText}`))
            );
        })
        .slice(0, 20)
        .map(direction => direction.id);
}

function normalizeReferenceImages(rows = [], source, directions = []) {
    const fieldMap = source.fieldMap || {};
    return safeArray(rows).map(row => {
        const localPath = getMapped(row, 'referenceImages', fieldMap, 'localPath');
        const imageUrl = extractUrl(getMapped(row, 'referenceImages', fieldMap, 'imageUrl'));
        const attachment = getMapped(row, 'referenceImages', fieldMap, 'attachment');
        const fileName = getMapped(row, 'referenceImages', fieldMap, 'fileName') || path.basename(localPath || imageUrl || attachment || '');
        const directionPath = getMapped(row, 'referenceImages', fieldMap, 'directionPath');
        const directionName = getMapped(row, 'referenceImages', fieldMap, 'directionName');
        if (!localPath && !imageUrl && !attachment) return null;
        const draft = {
            directionPath,
            directionName
        };
        const matchedDirectionIds = findDirectionIdsForReference(draft, directions);
        const exists = localPath && fs.existsSync(localPath);
        const stats = exists ? fs.statSync(localPath) : null;
        return {
            id: hashId('ref_feishu', [source.token, source.sheetId || source.tableId, row.recordId || String(row.rowNumber), localPath, imageUrl, attachment]),
            directionId: matchedDirectionIds[0] || '',
            directionPath,
            directionName,
            matchedDirectionIds,
            source: 'feishu-readonly',
            sourceType: source.type,
            sourceToken: source.token,
            sourceSheetId: source.sheetId || '',
            sourceTableId: source.tableId || '',
            sourceRecordId: row.recordId || '',
            sourceSlot: getMapped(row, 'referenceImages', fieldMap, 'sourceSlot'),
            sourceSheetRow: row.rowNumber,
            sourceSheetColumn: '',
            filePath: localPath,
            remoteUrl: imageUrl,
            attachmentToken: attachment,
            fileName,
            relativePath: fileName,
            extension: path.extname(fileName || localPath || imageUrl).toLowerCase(),
            size: stats ? stats.size : 0,
            updatedAt: stats ? stats.mtime.toISOString() : nowIso(),
            tags: splitList(getMapped(row, 'referenceImages', fieldMap, 'tags'))
        };
    }).filter(Boolean);
}

async function fetchAndNormalizeFeishuData(config = readFeishuSyncConfig()) {
    const validation = validateFeishuSyncConfig(config);
    if (!validation.success) {
        throw new Error(validation.warnings.join('；'));
    }

    const token = await getTenantAccessToken(config);
    const warnings = [];
    const raw = {};
    const normalized = {
        directions: [],
        topMaterials: [],
        topMaterialInsights: [],
        referenceImages: []
    };

    if (config.sources.directions.enabled) {
        raw.directions = await fetchSourceRows(config, token, config.sources.directions);
        validateMappedRows('directions', raw.directions, config.sources.directions.fieldMap, warnings);
        normalized.directions = normalizeDirections(raw.directions, config.sources.directions);
    }

    if (config.sources.topMaterials.enabled) {
        raw.topMaterials = await fetchSourceRows(config, token, config.sources.topMaterials);
        validateMappedRows('topMaterials', raw.topMaterials, config.sources.topMaterials.fieldMap, warnings);
        normalized.topMaterials = normalizeTopMaterials(raw.topMaterials, config.sources.topMaterials);
        normalized.topMaterialInsights = buildInsights(normalized.topMaterials);
    }

    if (config.sources.referenceImages.enabled) {
        raw.referenceImages = await fetchSourceRows(config, token, config.sources.referenceImages);
        validateMappedRows('referenceImages', raw.referenceImages, config.sources.referenceImages.fieldMap, warnings);
        normalized.referenceImages = normalizeReferenceImages(
            raw.referenceImages,
            config.sources.referenceImages,
            normalized.directions
        );
    }

    return {
        fetchedAt: nowIso(),
        rawCounts: {
            directions: safeArray(raw.directions).length,
            topMaterials: safeArray(raw.topMaterials).length,
            referenceImages: safeArray(raw.referenceImages).length
        },
        normalized,
        warnings
    };
}

function comparableDigest(value) {
    return crypto
        .createHash('sha1')
        .update(JSON.stringify(value || {}))
        .digest('hex');
}

function directionCompareShape(direction = {}) {
    const {
        status,
        autoRun,
        lifecycle,
        mergedIntoDirectionId,
        mergeReason,
        stats,
        referenceImageIds,
        referenceImageCount,
        ...rest
    } = direction;
    return rest;
}

function compareItems(existing = [], incoming = [], shapeFn = item => item) {
    const existingById = new Map(safeArray(existing).map(item => [item.id, item]));
    const stats = { added: 0, updated: 0, unchanged: 0, ignored: 0 };
    safeArray(incoming).forEach(item => {
        const current = existingById.get(item.id);
        if (!current) {
            stats.added += 1;
            return;
        }
        const same = comparableDigest(shapeFn(current)) === comparableDigest(shapeFn(item));
        stats[same ? 'unchanged' : 'updated'] += 1;
    });
    stats.ignored = safeArray(existing).filter(item => item && item.source !== 'feishu-readonly').length;
    return stats;
}

function disabledPreviewStats() {
    return {
        added: 0,
        updated: 0,
        unchanged: 0,
        ignored: 0,
        disabled: true
    };
}

function buildPreview(store, normalized, config = readFeishuSyncConfig()) {
    const existingDirections = store.read('directions.json', { directions: [] }).directions || [];
    const existingMaterials = store.read('top-materials.json', { materials: [] }).materials || [];
    const existingReferences = store.read('reference-images.json', { images: [] }).images || [];
    return {
        directions: config.sources.directions.enabled
            ? compareItems(existingDirections, normalized.directions, directionCompareShape)
            : disabledPreviewStats(),
        topMaterials: config.sources.topMaterials.enabled
            ? compareItems(existingMaterials, normalized.topMaterials)
            : disabledPreviewStats(),
        referenceImages: config.sources.referenceImages.enabled
            ? compareItems(existingReferences, normalized.referenceImages)
            : disabledPreviewStats(),
        counts: {
            directions: normalized.directions.length,
            topMaterials: normalized.topMaterials.length,
            topMaterialInsights: normalized.topMaterialInsights.length,
            referenceImages: normalized.referenceImages.length
        }
    };
}

function mergeDirectionsForWrite(existing = [], incoming = []) {
    const existingById = new Map(safeArray(existing).map(direction => [direction.id, direction]));
    const incomingIds = new Set(safeArray(incoming).map(direction => direction.id));
    const mergedIncoming = safeArray(incoming).map(direction => {
        const existingDirection = existingById.get(direction.id);
        if (!existingDirection) {
            return direction;
        }
        return {
            ...direction,
            status: normalizeDirectionStatus(existingDirection.status, direction.status),
            autoRun: existingDirection.status === 'disabled'
                ? false
                : (existingDirection.autoRun !== undefined ? existingDirection.autoRun : direction.autoRun),
            lifecycle: existingDirection.lifecycle || {},
            mergedIntoDirectionId: existingDirection.mergedIntoDirectionId || '',
            mergeReason: existingDirection.mergeReason || '',
            stats: existingDirection.stats || direction.stats,
            referenceImageIds: existingDirection.referenceImageIds || direction.referenceImageIds || [],
            referenceImageCount: Number(existingDirection.referenceImageCount) || Number(direction.referenceImageCount) || 0,
            localStatusPreserved: existingDirection.status !== direction.status || existingDirection.autoRun !== direction.autoRun
        };
    });
    const localDirections = safeArray(existing)
        .filter(direction => direction && direction.id && !incomingIds.has(direction.id))
        .filter(direction => direction.source !== 'feishu-readonly' || normalizeDirectionStatus(direction.status, '') === 'accepted');
    return mergedIncoming.concat(localDirections);
}

function writeOperation(store, operation) {
    const data = store.read('knowledge-operations.json', {
        version: 1,
        operations: []
    });
    const next = {
        version: 1,
        updatedAt: operation.createdAt || nowIso(),
        operations: [
            {
                id: operation.id || hashId('operation', [operation.type, operation.createdAt || nowIso(), operation.message || '']),
                ...operation
            },
            ...safeArray(data.operations)
        ].slice(0, 200)
    };
    store.write('knowledge-operations.json', next);
    return next.operations[0];
}

function writeFeishuCache(store, payload) {
    store.write('feishu-cache.json', {
        version: 1,
        ...payload,
        updatedAt: payload.fetchedAt || nowIso()
    });
}

function applyFeishuSyncData(store, fetched, config) {
    const importedAt = nowIso();
    const currentDirections = store.read('directions.json', { directions: [] });
    const currentTopMaterials = store.read('top-materials.json', { materials: [] });
    const currentTopMaterialInsights = store.read('top-material-insights.json', { insights: [] });
    const currentReferences = store.read('reference-images.json', { images: [] });
    const preview = buildPreview(store, fetched.normalized, config);

    const directions = config.sources.directions.enabled
        ? mergeDirectionsForWrite(currentDirections.directions, fetched.normalized.directions)
        : safeArray(currentDirections.directions);
    const topMaterials = config.sources.topMaterials.enabled
        ? fetched.normalized.topMaterials
        : safeArray(currentTopMaterials.materials);
    const topMaterialInsights = config.sources.topMaterials.enabled
        ? fetched.normalized.topMaterialInsights
        : safeArray(currentTopMaterialInsights.insights);
    const references = config.sources.referenceImages.enabled
        ? fetched.normalized.referenceImages
        : safeArray(currentReferences.images);

    if (config.sources.directions.enabled) {
        store.write('directions.json', {
            version: 1,
            importedAt,
            source: 'feishu-readonly',
            directions,
            warnings: fetched.warnings,
            metadata: {
                source: 'feishu-readonly',
                importedRows: fetched.normalized.directions.length,
                totalRows: fetched.rawCounts.directions
            }
        });
    }
    if (config.sources.topMaterials.enabled) {
        store.write('top-materials.json', {
            version: 1,
            importedAt,
            source: 'feishu-readonly',
            materials: topMaterials,
            fileSummaries: [{
                fileName: 'feishu-readonly',
                month: '',
                sheetName: '',
                totalRows: fetched.rawCounts.topMaterials,
                importedRows: topMaterials.length
            }],
            metadata: {
                source: 'feishu-readonly',
                totalRows: fetched.rawCounts.topMaterials,
                importedRows: topMaterials.length
            },
            warnings: fetched.warnings
        });
        store.write('top-material-insights.json', {
            version: 1,
            importedAt,
            source: 'feishu-readonly',
            insights: topMaterialInsights,
            metadata: {
                source: 'feishu-readonly',
                insightCount: topMaterialInsights.length
            }
        });
    }
    if (config.sources.referenceImages.enabled) {
        store.write('reference-images.json', {
            version: 1,
            importedAt,
            source: 'feishu-readonly',
            images: references,
            metadata: {
                source: 'feishu-readonly',
                totalRows: fetched.rawCounts.referenceImages,
                imageCount: references.length
            },
            warnings: fetched.warnings
        });
    }
    store.write('metadata.json', {
        version: 1,
        importedAt,
        config: {
            source: 'feishu-readonly',
            feishuSync: getPublicFeishuSyncConfig(config)
        },
        counts: {
            directions: directions.length,
            topMaterials: topMaterials.length,
            topMaterialInsights: topMaterialInsights.length,
            referenceImages: references.length
        },
        sources: {
            directions: { source: 'feishu-readonly', rows: fetched.rawCounts.directions },
            topMaterials: { source: 'feishu-readonly', rows: fetched.rawCounts.topMaterials },
            referenceImages: { source: 'feishu-readonly', rows: fetched.rawCounts.referenceImages }
        },
        warnings: fetched.warnings
    });

    writeFeishuCache(store, {
        fetchedAt: fetched.fetchedAt,
        config: getPublicFeishuSyncConfig(config),
        rawCounts: fetched.rawCounts,
        normalized: fetched.normalized,
        warnings: fetched.warnings,
        preview
    });

    const operation = writeOperation(store, {
        type: 'feishu-sync',
        mode: 'sync',
        status: 'success',
        source: 'feishu-readonly',
        createdAt: importedAt,
        counts: preview.counts,
        preview,
        warnings: fetched.warnings,
        message: `飞书只读同步完成：方向 ${preview.counts.directions}，TOP素材 ${preview.counts.topMaterials}，参考图线索 ${preview.counts.referenceImages}`
    });

    return {
        success: true,
        message: operation.message,
        importedAt,
        counts: preview.counts,
        preview,
        warnings: fetched.warnings,
        operation
    };
}

function getStore(rootDir, dataDir) {
    const baseDir = dataDir || path.join(rootDir, 'data', 'creative-knowledge');
    const store = new CreativeKnowledgeStore(baseDir);
    store.ensureBase();
    return store;
}

function readCacheInfo(store) {
    const cache = store.read('feishu-cache.json', null);
    if (!cache) {
        return {
            exists: false
        };
    }
    return {
        exists: true,
        updatedAt: cache.updatedAt || cache.fetchedAt || '',
        counts: cache.preview && cache.preview.counts ? cache.preview.counts : {},
        warnings: cache.warnings || []
    };
}

function readLastOperation(store) {
    const data = store.read('knowledge-operations.json', {
        operations: []
    });
    return safeArray(data.operations)[0] || null;
}

function createFeishuSyncService(options = {}) {
    const rootDir = options.rootDir || options.ROOT_DIR || process.cwd();
    const dataDir = options.dataDir || path.join(rootDir, 'data', 'creative-knowledge');

    async function testConnection(overrides = {}) {
        const config = readFeishuSyncConfig(overrides);
        const validation = validateFeishuSyncConfig(config);
        if (!validation.success) {
            return {
                success: false,
                message: validation.warnings.join('；'),
                validation,
                config: getPublicFeishuSyncConfig(config)
            };
        }

        try {
            const token = await getTenantAccessToken(config);
            const enabledSource = Object.entries(config.sources).find(([, source]) => source.enabled);
            let sample = null;
            if (enabledSource) {
                const [key, source] = enabledSource;
                const rows = await fetchSourceRows(config, token, source);
                sample = {
                    source: key,
                    sourceLabel: sourceLabel(key),
                    rowCount: rows.length,
                    headers: Object.keys((rows[0] && rows[0].fields) || {}).slice(0, 30)
                };
            }
            return {
                success: true,
                message: sample
                    ? `飞书连接成功，${sample.sourceLabel}读到 ${sample.rowCount} 行`
                    : '飞书连接成功',
                validation,
                sample,
                config: getPublicFeishuSyncConfig(config)
            };
        } catch (error) {
            return {
                success: false,
                message: error.message,
                validation,
                config: getPublicFeishuSyncConfig(config)
            };
        }
    }

    async function preview(overrides = {}) {
        const config = readFeishuSyncConfig(overrides);
        const store = getStore(rootDir, overrides.dataDir || dataDir);
        try {
            const fetched = await fetchAndNormalizeFeishuData(config);
            const previewResult = buildPreview(store, fetched.normalized, config);
            writeOperation(store, {
                type: 'feishu-sync',
                mode: 'preview',
                status: 'success',
                source: 'feishu-readonly',
                createdAt: nowIso(),
                counts: previewResult.counts,
                preview: previewResult,
                warnings: fetched.warnings,
                message: `飞书同步预览完成：新增方向 ${previewResult.directions.added}，更新方向 ${previewResult.directions.updated}`
            });
            return {
                success: true,
                message: '飞书同步预览完成',
                fetchedAt: fetched.fetchedAt,
                rawCounts: fetched.rawCounts,
                preview: previewResult,
                warnings: fetched.warnings
            };
        } catch (error) {
            const operation = writeOperation(store, {
                type: 'feishu-sync',
                mode: 'preview',
                status: 'failed',
                source: 'feishu-readonly',
                createdAt: nowIso(),
                counts: {},
                warnings: [],
                message: error.message
            });
            return {
                success: false,
                message: error.message,
                cache: readCacheInfo(store),
                operation
            };
        }
    }

    async function sync(overrides = {}) {
        const config = readFeishuSyncConfig(overrides);
        const store = getStore(rootDir, overrides.dataDir || dataDir);
        try {
            const fetched = await fetchAndNormalizeFeishuData(config);
            return applyFeishuSyncData(store, fetched, config);
        } catch (error) {
            const operation = writeOperation(store, {
                type: 'feishu-sync',
                mode: 'sync',
                status: 'failed',
                source: 'feishu-readonly',
                createdAt: nowIso(),
                counts: {},
                warnings: [],
                message: error.message
            });
            return {
                success: false,
                message: error.message,
                cache: readCacheInfo(store),
                operation
            };
        }
    }

    function getStatus(overrides = {}) {
        const config = readFeishuSyncConfig(overrides);
        const store = getStore(rootDir, overrides.dataDir || dataDir);
        return {
            success: true,
            config: getPublicFeishuSyncConfig(config),
            validation: validateFeishuSyncConfig(config),
            cache: readCacheInfo(store),
            lastOperation: readLastOperation(store),
            files: {
                feishuCache: store.info('feishu-cache.json'),
                operations: store.info('knowledge-operations.json')
            }
        };
    }

    function listOperations(overrides = {}) {
        const store = getStore(rootDir, overrides.dataDir || dataDir);
        const data = store.read('knowledge-operations.json', {
            version: 1,
            operations: []
        });
        return {
            success: true,
            total: safeArray(data.operations).length,
            operations: safeArray(data.operations).slice(0, 100)
        };
    }

    return {
        getStatus,
        listOperations,
        preview,
        saveConfig: saveFeishuSyncConfig,
        testConnection,
        sync
    };
}

module.exports = {
    DEFAULT_FEISHU_SYNC_CONFIG,
    createFeishuSyncService,
    fetchAndNormalizeFeishuData,
    getPublicFeishuSyncConfig,
    readFeishuSyncConfig,
    saveFeishuSyncConfig,
    validateFeishuSyncConfig
};
