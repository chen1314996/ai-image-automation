const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const axios = require('axios');
const { readConfig, updateConfig } = require('../../../config-store');
const { readSecrets, updateSecrets } = require('../../../secrets-store');
const { CreativeKnowledgeStore } = require('./store');

const DIRECTION_HEADERS = ['一级标签', '二级标签', '三级标签', '细分标签', '方向简述', '参考图1', '参考图2', '参考图3'];
const DEFAULT_DIRECTION_WIKI_URL = 'https://my.feishu.cn/wiki/FrIywlwxxis4z1kdIlPc1S3qnkh?sheet=UUld6D';
const DEFAULT_RANGE = 'A1:H5000';
const NEW_ROW_COLOR = '#fff2cc';
const USER_CLI_PROFILE = 'feishu-direction';
const LOCAL_SOURCE_ALLOWLIST = new Set([
    'agent',
    'manual_from_reviewed_asset',
    'material-analysis',
    'material-analysis-brief',
    'creative-auto',
    'local-growth'
]);

function nowIso() {
    return new Date().toISOString();
}

function normalizeText(value) {
    if (value === undefined || value === null) return '';
    return String(value).replace(/\uFEFF/g, '').trim();
}

function safeArray(value) {
    return Array.isArray(value) ? value : [];
}

function hashId(prefix, values) {
    const hash = crypto
        .createHash('sha1')
        .update(values.map(normalizeText).filter(Boolean).join('|'))
        .digest('hex')
        .slice(0, 12);
    return `${prefix}_${hash}`;
}

function normalizePathPart(value) {
    const text = normalizeText(value);
    return text === '暂无' ? '' : text;
}

function buildDirectionPath(row = {}) {
    return [
        row.primaryTag,
        row.secondaryTag,
        row.tertiaryTag,
        row.subTag
    ].map(normalizePathPart).filter(Boolean).join('/');
}

function splitDirectionPath(value) {
    return normalizeText(value).split('/').map(part => part.trim()).filter(Boolean);
}

function buildRowValues(direction = {}) {
    const parts = splitDirectionPath(direction.path);
    const primaryTag = normalizeText(direction.primaryTag || parts[0]);
    const secondaryTag = normalizeText(direction.secondaryTag || parts[1]);
    const tertiaryTag = normalizeText(direction.tertiaryTag || parts[2]);
    const subTag = normalizeText(direction.subTag || parts.slice(3).join('/'));
    return [
        primaryTag,
        secondaryTag,
        tertiaryTag,
        subTag || '暂无',
        normalizeText(direction.description),
        '',
        '',
        ''
    ];
}

function normalizeHeader(value) {
    return normalizeText(value).replace(/\s+/g, '');
}

function colLetter(index) {
    let value = index + 1;
    let output = '';
    while (value > 0) {
        const remainder = (value - 1) % 26;
        output = String.fromCharCode(65 + remainder) + output;
        value = Math.floor((value - 1) / 26);
    }
    return output;
}

function parseUrlInfo(sourceUrl) {
    const text = normalizeText(sourceUrl);
    if (!text) return {};
    try {
        const url = new URL(text);
        const parts = url.pathname.split('/').filter(Boolean);
        const info = {
            sourceUrl: text,
            sheetId: normalizeText(url.searchParams.get('sheet')),
            wikiToken: '',
            spreadsheetToken: ''
        };
        const wikiIndex = parts.indexOf('wiki');
        const sheetsIndex = parts.indexOf('sheets');
        if (wikiIndex >= 0 && parts[wikiIndex + 1]) {
            info.wikiToken = parts[wikiIndex + 1];
        }
        if (sheetsIndex >= 0 && parts[sheetsIndex + 1]) {
            info.spreadsheetToken = parts[sheetsIndex + 1];
        }
        return info;
    } catch {
        return {};
    }
}

function getApiBaseUrl(config) {
    if (config.apiBaseUrl) return config.apiBaseUrl.replace(/\/+$/, '');
    return config.domain === 'lark'
        ? 'https://open.larksuite.com'
        : 'https://open.feishu.cn';
}

function readDirectionSyncConfig(overrides = {}) {
    const storedConfig = readConfig();
    const secrets = readSecrets();
    const stored = storedConfig.feishuDirectionSync && typeof storedConfig.feishuDirectionSync === 'object'
        ? storedConfig.feishuDirectionSync
        : {};
    const sourceUrl = normalizeText(overrides.sourceUrl || stored.sourceUrl || DEFAULT_DIRECTION_WIKI_URL);
    const urlInfo = parseUrlInfo(sourceUrl);

    return {
        enabled: overrides.enabled !== undefined ? overrides.enabled === true : stored.enabled !== false,
        domain: (overrides.domain || stored.domain) === 'lark' ? 'lark' : 'feishu',
        apiBaseUrl: normalizeText(overrides.apiBaseUrl || stored.apiBaseUrl || process.env.FEISHU_DIRECTION_API_BASE_URL),
        timeoutMs: Math.max(60000, Math.min(180000, Number(overrides.timeoutMs || stored.timeoutMs) || 60000)),
        appId: normalizeText(
            overrides.appId ||
            process.env.FEISHU_DIRECTION_APP_ID ||
            secrets.feishuDirectionAppId ||
            secrets.feishuSyncAppId ||
            secrets.feishuSdkAppId ||
            secrets.feishuCliAppId ||
            stored.appId
        ),
        appSecret: normalizeText(
            overrides.appSecret ||
            process.env.FEISHU_DIRECTION_APP_SECRET ||
            secrets.feishuDirectionAppSecret ||
            secrets.feishuSyncAppSecret ||
            secrets.feishuSdkAppSecret ||
            secrets.feishuCliAppSecret
        ),
        sourceUrl,
        wikiToken: normalizeText(overrides.wikiToken || stored.wikiToken || urlInfo.wikiToken),
        spreadsheetToken: normalizeText(overrides.spreadsheetToken || stored.spreadsheetToken || urlInfo.spreadsheetToken),
        sheetId: normalizeText(overrides.sheetId || stored.sheetId || urlInfo.sheetId || 'UUld6D'),
        range: normalizeText(overrides.range || stored.range || DEFAULT_RANGE),
        yellowColor: normalizeText(overrides.yellowColor || stored.yellowColor || NEW_ROW_COLOR)
    };
}

function getPublicConfig(config = readDirectionSyncConfig()) {
    return {
        enabled: config.enabled,
        domain: config.domain,
        apiBaseUrl: config.apiBaseUrl,
        timeoutMs: config.timeoutMs,
        appId: config.appId,
        appSecretConfigured: Boolean(config.appSecret),
        sourceUrl: config.sourceUrl,
        wikiToken: config.wikiToken,
        spreadsheetToken: config.spreadsheetToken,
        sheetId: config.sheetId,
        range: config.range,
        yellowColor: config.yellowColor,
        fixedHeaders: DIRECTION_HEADERS
    };
}

function saveDirectionSyncConfig(payload = {}) {
    const current = readDirectionSyncConfig();
    const nextStored = {
        enabled: payload.enabled !== false,
        domain: payload.domain === 'lark' ? 'lark' : 'feishu',
        apiBaseUrl: normalizeText(payload.apiBaseUrl),
        timeoutMs: Math.max(60000, Math.min(180000, Number(payload.timeoutMs) || current.timeoutMs || 60000)),
        appId: normalizeText(payload.appId || current.appId),
        sourceUrl: normalizeText(payload.sourceUrl || current.sourceUrl || DEFAULT_DIRECTION_WIKI_URL),
        wikiToken: normalizeText(payload.wikiToken),
        spreadsheetToken: normalizeText(payload.spreadsheetToken),
        sheetId: normalizeText(payload.sheetId || current.sheetId || 'UUld6D'),
        range: normalizeText(payload.range || current.range || DEFAULT_RANGE),
        yellowColor: normalizeText(payload.yellowColor || current.yellowColor || NEW_ROW_COLOR)
    };
    updateConfig({ feishuDirectionSync: nextStored });

    const secretUpdates = {};
    if (normalizeText(payload.appId)) {
        secretUpdates.feishuDirectionAppId = normalizeText(payload.appId);
    }
    if (normalizeText(payload.appSecret)) {
        secretUpdates.feishuDirectionAppSecret = normalizeText(payload.appSecret);
    }
    if (payload.clearAppSecret === true) {
        secretUpdates.feishuDirectionAppSecret = '';
    }
    if (Object.keys(secretUpdates).length) {
        updateSecrets(secretUpdates);
    }
    return getPublicConfig(readDirectionSyncConfig());
}

function validateConfig(config = readDirectionSyncConfig()) {
    const warnings = [];
    if (!config.enabled) warnings.push('飞书方向表协同未启用');
    if (!config.appId) warnings.push('未配置飞书 App ID');
    if (!config.appSecret) warnings.push('未配置飞书 App Secret');
    if (!config.sourceUrl && !config.spreadsheetToken && !config.wikiToken) warnings.push('未配置飞书方向表链接');
    if (!config.sheetId) warnings.push('未配置工作表 sheet id');
    return {
        success: warnings.length === 0,
        warnings
    };
}

function buildAxios(config, token, options = {}) {
    if (options.httpClient) return options.httpClient;
    return axios.create({
        baseURL: getApiBaseUrl(config),
        timeout: config.timeoutMs,
        headers: token ? { Authorization: `Bearer ${token}` } : undefined
    });
}

function isFeishuPermissionError(error) {
    const data = error && error.response && error.response.data;
    const message = [
        error && error.message,
        data && data.msg,
        data && data.message,
        data && data.error && data.error.message
    ].filter(Boolean).join(' ');
    return (data && Number(data.code) === 99991672) || /No permission|permission/i.test(message);
}

function writeCliJsonFile(fileName, payload) {
    const filePath = path.join(process.cwd(), fileName);
    fs.writeFileSync(filePath, JSON.stringify(payload || {}), 'utf8');
    return fileName;
}

function runLarkCliUserApi(method, apiPath, payload = {}) {
    const stamp = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const tempFiles = [];
    const args = [
        '--profile',
        USER_CLI_PROFILE,
        'api',
        method,
        apiPath,
        '--as',
        'user'
    ];
    try {
        const paramsFile = writeCliJsonFile(`.feishu-direction-params-${stamp}.json`, payload.params || {});
        tempFiles.push(paramsFile);
        args.push('--params', `@${paramsFile}`);
        if (payload.data !== undefined) {
            const dataFile = writeCliJsonFile(`.feishu-direction-data-${stamp}.json`, payload.data || {});
            tempFiles.push(dataFile);
            args.push('--data', `@${dataFile}`);
        }
        const command = process.platform === 'win32' ? 'cmd.exe' : 'lark-cli';
        const commandArgs = process.platform === 'win32'
            ? ['/d', '/s', '/c', 'lark-cli', ...args]
            : args;
        const result = spawnSync(command, commandArgs, {
            cwd: process.cwd(),
            encoding: 'utf8',
            maxBuffer: 10 * 1024 * 1024
        });
        if (result.error) {
            throw result.error;
        }
        const output = (result.stdout || '').trim();
        const errorOutput = (result.stderr || '').trim();
        let parsed = null;
        if (output) {
            try {
                parsed = JSON.parse(output);
            } catch {
                parsed = null;
            }
        }
        if (result.status !== 0) {
            const message = parsed && parsed.error && parsed.error.message
                ? parsed.error.message
                : (errorOutput || output || `lark-cli exited ${result.status}`);
            throw new Error(message);
        }
        if (parsed && parsed.code !== undefined && parsed.code !== 0) {
            throw new Error(parsed.msg || parsed.message || `code=${parsed.code}`);
        }
        return parsed || {};
    } finally {
        tempFiles.forEach(fileName => {
            try {
                fs.rmSync(path.join(process.cwd(), fileName), { force: true });
            } catch {
                // ignore cleanup errors for temporary CLI payload files
            }
        });
    }
}

function shouldUseUserCliFallback(config) {
    return config.userCliFallback !== false && process.env.FEISHU_DIRECTION_USER_CLI_FALLBACK !== 'false';
}

function describeFeishuError(error, fallback = '飞书接口请求失败') {
    const response = error && error.response;
    const data = response && response.data;
    if (data && typeof data === 'object') {
        const code = data.code !== undefined ? `code=${data.code}` : '';
        const message = data.msg || data.message || data.error || fallback;
        return `${fallback}：${message} ${code}`.trim();
    }
    if (response && response.status) {
        return `${fallback}：HTTP ${response.status}`;
    }
    return error && error.message ? `${fallback}：${error.message}` : fallback;
}

async function getTenantAccessToken(config, options = {}) {
    const validation = validateConfig(config);
    const credentialWarnings = validation.warnings.filter(message => /App ID|App Secret/.test(message));
    if (credentialWarnings.length) {
        throw new Error(credentialWarnings.join('；'));
    }
    try {
        const client = buildAxios(config, '', options);
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

async function getTenantAccessTokenOrFallback(config, options = {}) {
    try {
        return await getTenantAccessToken(config, options);
    } catch (error) {
        if (!options.httpClient && shouldUseUserCliFallback(config)) {
            return '';
        }
        throw error;
    }
}

function resolveSpreadsheetWithUserCli(config) {
    if (config.spreadsheetToken) {
        return {
            spreadsheetToken: config.spreadsheetToken,
            sheetId: config.sheetId,
            title: '',
            authMode: 'user'
        };
    }
    if (!config.wikiToken) {
        throw new Error('飞书方向表链接里没有 wiki token，也没有直接配置 spreadsheet token');
    }
    const data = runLarkCliUserApi(
        'GET',
        '/open-apis/wiki/v2/spaces/get_node',
        {
            params: {
                token: config.wikiToken
            }
        }
    );
    const node = data.data && data.data.node ? data.data.node : data.node;
    if (!node || node.obj_type !== 'sheet' || !node.obj_token) {
        throw new Error(`该 wiki 节点不是电子表格，当前类型：${node && node.obj_type ? node.obj_type : '未知'}`);
    }
    return {
        spreadsheetToken: node.obj_token,
        sheetId: config.sheetId,
        title: node.title || '',
        authMode: 'user'
    };
}

async function resolveSpreadsheet(config, token, options = {}) {
    if (config.spreadsheetToken) {
        return {
            spreadsheetToken: config.spreadsheetToken,
            sheetId: config.sheetId,
            title: ''
        };
    }
    if (!config.wikiToken) {
        throw new Error('飞书方向表链接里没有 wiki token，也没有直接配置 spreadsheet token');
    }
    if (!token && !options.httpClient && shouldUseUserCliFallback(config)) {
        return resolveSpreadsheetWithUserCli(config);
    }
    try {
        const client = buildAxios(config, token, options);
        const response = await client.get('/open-apis/wiki/v2/spaces/get_node', {
            params: {
                token: config.wikiToken
            }
        });
        const data = response.data || {};
        if (data.code !== 0) {
            throw new Error(data.msg || data.message || `code=${data.code}`);
        }
        const node = data.data && data.data.node ? data.data.node : data.node;
        if (!node || node.obj_type !== 'sheet' || !node.obj_token) {
            throw new Error(`该 wiki 节点不是电子表格，当前类型：${node && node.obj_type ? node.obj_type : '未知'}`);
        }
        return {
            spreadsheetToken: node.obj_token,
            sheetId: config.sheetId,
            title: node.title || '',
            authMode: 'tenant'
        };
    } catch (error) {
        if (!options.httpClient && shouldUseUserCliFallback(config) && isFeishuPermissionError(error)) {
            return resolveSpreadsheetWithUserCli(config);
        }
        throw new Error(describeFeishuError(error, '解析飞书 wiki 表格失败'));
    }
}

async function readSheetValues(config, token, spreadsheetToken, sheetId, range, options = {}) {
    const rangeText = `${sheetId}!${range || DEFAULT_RANGE}`;
    if (!token && !options.httpClient && shouldUseUserCliFallback(config)) {
        const data = runLarkCliUserApi(
            'GET',
            `/open-apis/sheets/v2/spreadsheets/${encodeURIComponent(spreadsheetToken)}/values/${encodeURIComponent(rangeText)}`,
            { params: {} }
        );
        return (data.data && data.data.valueRange && data.data.valueRange.values) || [];
    }
    try {
        const client = buildAxios(config, token, options);
        const response = await client.get(
            `/open-apis/sheets/v2/spreadsheets/${encodeURIComponent(spreadsheetToken)}/values/${encodeURIComponent(rangeText)}`
        );
        const data = response.data || {};
        if (data.code !== 0) {
            throw new Error(data.msg || data.message || `code=${data.code}`);
        }
        return (data.data && data.data.valueRange && data.data.valueRange.values) || [];
    } catch (error) {
        if (!options.httpClient && shouldUseUserCliFallback(config) && isFeishuPermissionError(error)) {
            const data = runLarkCliUserApi(
                'GET',
                `/open-apis/sheets/v2/spreadsheets/${encodeURIComponent(spreadsheetToken)}/values/${encodeURIComponent(rangeText)}`,
                { params: {} }
            );
            return (data.data && data.data.valueRange && data.data.valueRange.values) || [];
        }
        throw new Error(describeFeishuError(error, '读取飞书方向表失败'));
    }
}

function rowsFromValues(values = [], source = {}) {
    const rows = safeArray(values);
    const headers = safeArray(rows[0]).map(normalizeText);
    const normalizedHeaders = headers.map(normalizeHeader);
    const warnings = [];
    DIRECTION_HEADERS.forEach((header, index) => {
        if (normalizedHeaders[index] !== normalizeHeader(header)) {
            warnings.push(`第 ${index + 1} 列应为“${header}”，实际为“${headers[index] || '空'}”`);
        }
    });

    const directions = rows.slice(1)
        .map((row, index) => {
            const rowNumber = index + 2;
            const values8 = DIRECTION_HEADERS.map((header, columnIndex) => normalizeText(row[columnIndex]));
            const [primaryTag, secondaryTag, tertiaryTag, rawSubTag, description] = values8;
            if (!values8.some(Boolean)) return null;
            if (!primaryTag && !secondaryTag && !tertiaryTag && !rawSubTag && !description) return null;
            const subTag = normalizePathPart(rawSubTag);
            const base = {
                primaryTag,
                secondaryTag,
                tertiaryTag,
                subTag,
                description,
                referenceHints: values8.slice(5).filter(Boolean)
            };
            const pathValue = buildDirectionPath(base);
            const name = subTag || normalizeText(tertiaryTag) || normalizeText(secondaryTag) || normalizeText(primaryTag);
            if (!pathValue || !name) return null;
            return {
                id: hashId('direction_feishu', [source.spreadsheetToken, source.sheetId, pathValue, name]),
                orderIndex: rowNumber - 1,
                sheetName: source.sheetTitle || 'feishu-direction-sheet',
                path: pathValue,
                name,
                primaryTag,
                secondaryTag,
                tertiaryTag,
                subTag,
                description,
                referenceHints: base.referenceHints,
                mustKeep: '',
                mustAvoid: '',
                autoRun: true,
                priority: 50,
                status: 'seed',
                source: 'feishu-direction-sheet',
                sourceSpreadsheetToken: source.spreadsheetToken,
                sourceSheetId: source.sheetId,
                sourceSheetRow: rowNumber,
                updatedAt: nowIso(),
                stats: {
                    expandedCount: 0,
                    promptCount: 0,
                    imageCount: 0,
                    lastRunAt: null,
                    failureCount: 0
                }
            };
        })
        .filter(Boolean);

    return {
        headers,
        warnings,
        directions
    };
}

function directionCompareShape(direction = {}) {
    return {
        path: normalizeText(direction.path),
        name: normalizeText(direction.name),
        primaryTag: normalizeText(direction.primaryTag),
        secondaryTag: normalizeText(direction.secondaryTag),
        tertiaryTag: normalizeText(direction.tertiaryTag),
        subTag: normalizeText(direction.subTag),
        description: normalizeText(direction.description),
        referenceHints: safeArray(direction.referenceHints).map(normalizeText).filter(Boolean)
    };
}

function digest(value) {
    return crypto.createHash('sha1').update(JSON.stringify(value || {})).digest('hex');
}

function buildImportPreview(existing = [], incoming = []) {
    const existingByPath = new Map(safeArray(existing).map(item => [normalizeText(item.path), item]));
    const items = [];
    const stats = { added: 0, updated: 0, unchanged: 0 };
    safeArray(incoming).forEach(direction => {
        const current = existingByPath.get(normalizeText(direction.path));
        const status = !current
            ? 'added'
            : (digest(directionCompareShape(current)) === digest(directionCompareShape(direction)) ? 'unchanged' : 'updated');
        stats[status] += 1;
        items.push({
            status,
            path: direction.path,
            name: direction.name,
            rowNumber: direction.sourceSheetRow,
            currentId: current && current.id,
            currentDescription: current && current.description,
            incomingDescription: direction.description
        });
    });
    return {
        ...stats,
        total: incoming.length,
        items
    };
}

function mergeImportedDirections(existing = [], incoming = []) {
    const existingByPath = new Map(safeArray(existing).map(item => [normalizeText(item.path), item]));
    const incomingPaths = new Set(safeArray(incoming).map(item => normalizeText(item.path)));
    const mergedIncoming = safeArray(incoming).map(direction => {
        const current = existingByPath.get(normalizeText(direction.path));
        if (!current) return direction;
        return {
            ...current,
            ...direction,
            id: current.id,
            status: current.status || direction.status,
            autoRun: current.autoRun !== undefined ? current.autoRun : direction.autoRun,
            priority: current.priority || direction.priority,
            source: current.source === 'feishu-readonly' ? 'feishu-direction-sheet' : (current.source || direction.source),
            lifecycle: current.lifecycle || {},
            stats: current.stats || direction.stats,
            referenceImageIds: current.referenceImageIds || direction.referenceImageIds || [],
            referenceImageCount: Number(current.referenceImageCount) || Number(direction.referenceImageCount) || 0,
            updatedAt: nowIso()
        };
    });
    const localOnly = safeArray(existing).filter(direction => !incomingPaths.has(normalizeText(direction.path)));
    return mergedIncoming.concat(localOnly);
}

function getStore(rootDir, dataDir) {
    const baseDir = dataDir || path.join(rootDir, 'data', 'creative-knowledge');
    const store = new CreativeKnowledgeStore(baseDir);
    store.ensureBase();
    return store;
}

function readWritebackState(store) {
    return store.read('feishu-writeback.json', {
        version: 1,
        updatedAt: '',
        records: []
    });
}

function writeWritebackState(store, state) {
    store.write('feishu-writeback.json', {
        version: 1,
        updatedAt: nowIso(),
        records: safeArray(state.records)
    });
}

function isAcceptedLocalDirection(direction = {}) {
    if (normalizeText(direction.status) !== 'accepted') return false;
    if (direction.source === 'feishu-direction-sheet' || direction.source === 'feishu-readonly') return false;
    if (!direction.path || !direction.name) return false;
    if (!direction.source) return true;
    return LOCAL_SOURCE_ALLOWLIST.has(direction.source) ||
        direction.source.startsWith('manual') ||
        direction.source.includes('agent') ||
        direction.source.includes('material');
}

function visualDnaValue(value) {
    if (Array.isArray(value)) return value.map(normalizeText).filter(Boolean)[0] || '';
    return normalizeText(value);
}

function directionHasCompleteVisualDna(direction = {}) {
    const visualDna = direction.visualDna && typeof direction.visualDna === 'object' ? direction.visualDna : {};
    const dimensions = direction.dimensions && typeof direction.dimensions === 'object' ? direction.dimensions : {};
    const atmosphere = visualDnaValue(visualDna.atmosphere || dimensions.atmosphere || dimensions.mood);
    const camera = visualDnaValue(visualDna.camera || dimensions.camera || dimensions.perspective || dimensions.view);
    const event = visualDnaValue(visualDna.event || dimensions.event || dimensions.narrative || dimensions.action);
    const hook = visualDnaValue(visualDna.visualHook || dimensions.visualHook || dimensions.hook || direction.visualHook);
    return Boolean(direction.name && direction.path && direction.description && atmosphere && camera && event && hook);
}

function buildAcceptedDraftMap(store) {
    const draftData = store.read('direction-drafts.json', { drafts: [] });
    const byDirectionId = new Map();
    safeArray(draftData.drafts).forEach(draft => {
        if (!draft || normalizeText(draft.status) !== 'accepted' || !draft.acceptedDirectionId) return;
        byDirectionId.set(draft.acceptedDirectionId, draft);
    });
    return byDirectionId;
}

function buildWritebackCandidates(store) {
    const directionData = store.read('directions.json', { directions: [] });
    const state = readWritebackState(store);
    const syncedIds = new Set(safeArray(state.records).map(record => record.directionId).filter(Boolean));
    const acceptedDrafts = buildAcceptedDraftMap(store);
    return safeArray(directionData.directions)
        .filter(isAcceptedLocalDirection)
        .filter(direction => !syncedIds.has(direction.id))
        .map(direction => {
            const draft = acceptedDrafts.get(direction.id);
            const priorityWriteback = Boolean(draft) && directionHasCompleteVisualDna(direction);
            return {
                id: direction.id,
                path: direction.path,
                name: direction.name,
                description: direction.description || '',
                source: direction.source || '',
                sourceDraftId: direction.sourceDraftId || (draft && draft.id) || '',
                priorityWriteback,
                priorityReason: priorityWriteback ? 'accepted_draft_complete_visual_dna' : '',
                rowValues: buildRowValues(direction),
                direction
            };
        })
        .sort((a, b) => Number(b.priorityWriteback === true) - Number(a.priorityWriteback === true));
}

function findInsertAfterRow(remoteDirections = [], rowValues = []) {
    const [primaryTag, secondaryTag, tertiaryTag] = rowValues.map(normalizeText);
    const sameThird = safeArray(remoteDirections)
        .filter(item =>
            normalizeText(item.primaryTag) === primaryTag &&
            normalizeText(item.secondaryTag) === secondaryTag &&
            normalizeText(item.tertiaryTag) === tertiaryTag
        );
    if (sameThird.length) {
        return Math.max(...sameThird.map(item => Number(item.sourceSheetRow) || 1));
    }
    const sameSecond = safeArray(remoteDirections)
        .filter(item =>
            normalizeText(item.primaryTag) === primaryTag &&
            normalizeText(item.secondaryTag) === secondaryTag
        );
    if (sameSecond.length) {
        return Math.max(...sameSecond.map(item => Number(item.sourceSheetRow) || 1));
    }
    return Math.max(1, ...safeArray(remoteDirections).map(item => Number(item.sourceSheetRow) || 1));
}

async function insertSheetRow(config, token, spreadsheetToken, sheetId, insertAfterRow, options = {}) {
    const client = buildAxios(config, token, options);
    const startIndex = Math.max(1, Number(insertAfterRow) || 1);
    if (!token && !options.httpClient && shouldUseUserCliFallback(config)) {
        runLarkCliUserApi(
            'POST',
            `/open-apis/sheets/v2/spreadsheets/${encodeURIComponent(spreadsheetToken)}/insert_dimension_range`,
            {
                data: {
                    dimension: {
                        sheetId,
                        majorDimension: 'ROWS',
                        startIndex,
                        endIndex: startIndex + 1
                    }
                }
            }
        );
        return startIndex + 1;
    }
    try {
        const response = await client.post(
            `/open-apis/sheets/v2/spreadsheets/${encodeURIComponent(spreadsheetToken)}/insert_dimension_range`,
            {
                dimension: {
                    sheetId,
                    majorDimension: 'ROWS',
                    startIndex,
                    endIndex: startIndex + 1
                }
            }
        );
        const data = response.data || {};
        if (data.code !== 0) {
            throw new Error(data.msg || data.message || `code=${data.code}`);
        }
    } catch (error) {
        if (!options.httpClient && shouldUseUserCliFallback(config) && isFeishuPermissionError(error)) {
            runLarkCliUserApi(
                'POST',
                `/open-apis/sheets/v2/spreadsheets/${encodeURIComponent(spreadsheetToken)}/insert_dimension_range`,
                {
                    data: {
                        dimension: {
                            sheetId,
                            majorDimension: 'ROWS',
                            startIndex,
                            endIndex: startIndex + 1
                        }
                    }
                }
            );
        } else {
            throw error;
        }
    }
    return startIndex + 1;
}

async function writeSheetRow(config, token, spreadsheetToken, sheetId, rowNumber, values, options = {}) {
    const client = buildAxios(config, token, options);
    const range = `${sheetId}!A${rowNumber}:${colLetter(DIRECTION_HEADERS.length - 1)}${rowNumber}`;
    if (!token && !options.httpClient && shouldUseUserCliFallback(config)) {
        runLarkCliUserApi(
            'PUT',
            `/open-apis/sheets/v2/spreadsheets/${encodeURIComponent(spreadsheetToken)}/values`,
            {
                data: {
                    valueRange: {
                        range,
                        values: [values]
                    }
                }
            }
        );
        return range;
    }
    try {
        const response = await client.put(
            `/open-apis/sheets/v2/spreadsheets/${encodeURIComponent(spreadsheetToken)}/values`,
            {
                valueRange: {
                    range,
                    values: [values]
                }
            }
        );
        const data = response.data || {};
        if (data.code !== 0) {
            throw new Error(data.msg || data.message || `code=${data.code}`);
        }
    } catch (error) {
        if (!options.httpClient && shouldUseUserCliFallback(config) && isFeishuPermissionError(error)) {
            runLarkCliUserApi(
                'PUT',
                `/open-apis/sheets/v2/spreadsheets/${encodeURIComponent(spreadsheetToken)}/values`,
                {
                    data: {
                        valueRange: {
                            range,
                            values: [values]
                        }
                    }
                }
            );
        } else {
            throw error;
        }
    }
    return range;
}

async function markSheetRowYellow(config, token, spreadsheetToken, sheetId, rowNumber, color, options = {}) {
    const client = buildAxios(config, token, options);
    const range = `${sheetId}!A${rowNumber}:${colLetter(DIRECTION_HEADERS.length - 1)}${rowNumber}`;
    if (!token && !options.httpClient && shouldUseUserCliFallback(config)) {
        runLarkCliUserApi(
            'PUT',
            `/open-apis/sheets/v2/spreadsheets/${encodeURIComponent(spreadsheetToken)}/style`,
            {
                data: {
                    appendStyle: {
                        range,
                        style: {
                            backColor: color || NEW_ROW_COLOR
                        }
                    }
                }
            }
        );
        return range;
    }
    try {
        const response = await client.put(
            `/open-apis/sheets/v2/spreadsheets/${encodeURIComponent(spreadsheetToken)}/style`,
            {
                appendStyle: {
                    range,
                    style: {
                        backColor: color || NEW_ROW_COLOR
                    }
                }
            }
        );
        const data = response.data || {};
        if (data.code !== 0) {
            throw new Error(data.msg || data.message || `code=${data.code}`);
        }
    } catch (error) {
        if (!options.httpClient && shouldUseUserCliFallback(config) && isFeishuPermissionError(error)) {
            runLarkCliUserApi(
                'PUT',
                `/open-apis/sheets/v2/spreadsheets/${encodeURIComponent(spreadsheetToken)}/style`,
                {
                    data: {
                        appendStyle: {
                            range,
                            style: {
                                backColor: color || NEW_ROW_COLOR
                            }
                        }
                    }
                }
            );
        } else {
            throw error;
        }
    }
    return range;
}

function createFeishuDirectionSyncService(options = {}) {
    const rootDir = options.rootDir || options.ROOT_DIR || process.cwd();
    const dataDir = options.dataDir || path.join(rootDir, 'data', 'creative-knowledge');

    async function fetchRemoteDirections(overrides = {}) {
        const config = readDirectionSyncConfig(overrides);
        const validation = validateConfig(config);
        if (!validation.success) {
            throw new Error(validation.warnings.join('；'));
        }
        const token = await getTenantAccessTokenOrFallback(config, options);
        const spreadsheet = await resolveSpreadsheet(config, token, options);
        const values = await readSheetValues(config, token, spreadsheet.spreadsheetToken, spreadsheet.sheetId, config.range, options);
        const parsed = rowsFromValues(values, {
            spreadsheetToken: spreadsheet.spreadsheetToken,
            sheetId: spreadsheet.sheetId,
            sheetTitle: spreadsheet.title
        });
        return {
            fetchedAt: nowIso(),
            config,
            spreadsheet,
            values,
            headers: parsed.headers,
            warnings: parsed.warnings,
            directions: parsed.directions
        };
    }

    async function testConnection(overrides = {}) {
        try {
            const fetched = await fetchRemoteDirections(overrides);
            return {
                success: true,
                message: `飞书方向表读取成功：${fetched.directions.length} 条方向`,
                rowCount: fetched.directions.length,
                spreadsheet: fetched.spreadsheet,
                headers: fetched.headers,
                warnings: fetched.warnings,
                config: getPublicConfig(fetched.config)
            };
        } catch (error) {
            return {
                success: false,
                message: error.message,
                config: getPublicConfig(readDirectionSyncConfig(overrides))
            };
        }
    }

    async function previewImport(overrides = {}) {
        try {
            const fetched = await fetchRemoteDirections(overrides);
            const store = getStore(rootDir, overrides.dataDir || dataDir);
            const directionData = store.read('directions.json', { directions: [] });
            const preview = buildImportPreview(directionData.directions, fetched.directions);
            return {
                success: true,
                message: `预览完成：新增 ${preview.added}，更新 ${preview.updated}，不变 ${preview.unchanged}`,
                fetchedAt: fetched.fetchedAt,
                spreadsheet: fetched.spreadsheet,
                preview,
                warnings: fetched.warnings,
                config: getPublicConfig(fetched.config)
            };
        } catch (error) {
            return {
                success: false,
                message: error.message,
                config: getPublicConfig(readDirectionSyncConfig(overrides))
            };
        }
    }

    async function syncImport(overrides = {}) {
        try {
            const fetched = await fetchRemoteDirections(overrides);
            const store = getStore(rootDir, overrides.dataDir || dataDir);
            const directionData = store.read('directions.json', { version: 1, directions: [] });
            const preview = buildImportPreview(directionData.directions, fetched.directions);
            const directions = mergeImportedDirections(directionData.directions, fetched.directions);
            const importedAt = nowIso();
            store.write('directions.json', {
                ...directionData,
                version: directionData.version || 1,
                importedAt: directionData.importedAt || importedAt,
                updatedAt: importedAt,
                directions,
                metadata: {
                    ...(directionData.metadata || {}),
                    feishuDirectionSheet: {
                        source: 'feishu-direction-sheet',
                        importedAt,
                        spreadsheetToken: fetched.spreadsheet.spreadsheetToken,
                        sheetId: fetched.spreadsheet.sheetId,
                        importedRows: fetched.directions.length
                    }
                },
                warnings: fetched.warnings
            });
            store.write('feishu-direction-cache.json', {
                version: 1,
                updatedAt: importedAt,
                fetchedAt: fetched.fetchedAt,
                spreadsheet: fetched.spreadsheet,
                headers: fetched.headers,
                preview,
                warnings: fetched.warnings,
                config: getPublicConfig(fetched.config)
            });
            return {
                success: true,
                message: `飞书方向表已更新到知识库：新增 ${preview.added}，更新 ${preview.updated}，不变 ${preview.unchanged}`,
                importedAt,
                preview,
                warnings: fetched.warnings
            };
        } catch (error) {
            return {
                success: false,
                message: error.message,
                config: getPublicConfig(readDirectionSyncConfig(overrides))
            };
        }
    }

    async function previewWriteback(overrides = {}) {
        try {
            const store = getStore(rootDir, overrides.dataDir || dataDir);
            const candidates = buildWritebackCandidates(store);
            let placements = [];
            let warnings = [];
            if (candidates.length) {
                const fetched = await fetchRemoteDirections(overrides);
                warnings = fetched.warnings;
                placements = candidates.map(candidate => ({
                    directionId: candidate.id,
                    path: candidate.path,
                    name: candidate.name,
                    rowValues: candidate.rowValues,
                    insertAfterRow: findInsertAfterRow(fetched.directions, candidate.rowValues)
                }));
            }
            return {
                success: true,
                message: candidates.length ? `有 ${candidates.length} 条已采纳方向待同步飞书` : '暂无待同步飞书的新方向',
                pendingCount: candidates.length,
                priorityCount: candidates.filter(candidate => candidate.priorityWriteback === true).length,
                candidates: candidates.map(candidate => ({
                    id: candidate.id,
                    path: candidate.path,
                    name: candidate.name,
                    description: candidate.description,
                    source: candidate.source,
                    sourceDraftId: candidate.sourceDraftId,
                    priorityWriteback: candidate.priorityWriteback,
                    priorityReason: candidate.priorityReason
                })),
                placements,
                warnings
            };
        } catch (error) {
            return {
                success: false,
                message: error.message
            };
        }
    }

    async function syncWriteback(overrides = {}) {
        try {
            const store = getStore(rootDir, overrides.dataDir || dataDir);
            const candidates = buildWritebackCandidates(store);
            if (!candidates.length) {
                return {
                    success: true,
                    message: '暂无待同步飞书的新方向',
                    syncedCount: 0,
                    records: []
                };
            }
            const config = readDirectionSyncConfig(overrides);
            const token = await getTenantAccessTokenOrFallback(config, options);
            const spreadsheet = await resolveSpreadsheet(config, token, options);
            let remoteDirections = (await fetchRemoteDirections(overrides)).directions;
            const state = readWritebackState(store);
            const records = [];
            for (const candidate of candidates) {
                const insertAfterRow = findInsertAfterRow(remoteDirections, candidate.rowValues);
                const rowNumber = await insertSheetRow(config, token, spreadsheet.spreadsheetToken, spreadsheet.sheetId, insertAfterRow, options);
                const valueRange = await writeSheetRow(config, token, spreadsheet.spreadsheetToken, spreadsheet.sheetId, rowNumber, candidate.rowValues, options);
                const styleRange = await markSheetRowYellow(config, token, spreadsheet.spreadsheetToken, spreadsheet.sheetId, rowNumber, config.yellowColor, options);
                const record = {
                    id: hashId('feishu_writeback', [candidate.id, spreadsheet.spreadsheetToken, spreadsheet.sheetId, String(rowNumber)]),
                    directionId: candidate.id,
                    path: candidate.path,
                    name: candidate.name,
                    sourceDraftId: candidate.sourceDraftId,
                    priorityWriteback: candidate.priorityWriteback,
                    priorityReason: candidate.priorityReason,
                    spreadsheetToken: spreadsheet.spreadsheetToken,
                    sheetId: spreadsheet.sheetId,
                    rowNumber,
                    valueRange,
                    styleRange,
                    rowValues: candidate.rowValues,
                    status: 'synced',
                    syncedAt: nowIso()
                };
                records.push(record);
                remoteDirections = remoteDirections.map(direction => ({
                    ...direction,
                    sourceSheetRow: Number(direction.sourceSheetRow) >= rowNumber
                        ? Number(direction.sourceSheetRow) + 1
                        : direction.sourceSheetRow
                }));
                remoteDirections.push({
                    primaryTag: candidate.rowValues[0],
                    secondaryTag: candidate.rowValues[1],
                    tertiaryTag: candidate.rowValues[2],
                    subTag: normalizePathPart(candidate.rowValues[3]),
                    sourceSheetRow: rowNumber
                });
            }
            const nextState = {
                ...state,
                records: safeArray(state.records).concat(records)
            };
            writeWritebackState(store, nextState);
            return {
                success: true,
                message: `已同步 ${records.length} 条新方向到飞书，并标黄 A:H`,
                syncedCount: records.length,
                records
            };
        } catch (error) {
            return {
                success: false,
                message: describeFeishuError(error, '同步已采纳方向到飞书失败')
            };
        }
    }

    function getStatus(overrides = {}) {
        const config = readDirectionSyncConfig(overrides);
        const store = getStore(rootDir, overrides.dataDir || dataDir);
        const cache = store.read('feishu-direction-cache.json', null);
        const writeback = readWritebackState(store);
        const candidates = buildWritebackCandidates(store);
        return {
            success: true,
            config: getPublicConfig(config),
            validation: validateConfig(config),
            cache: cache ? {
                exists: true,
                updatedAt: cache.updatedAt || cache.fetchedAt || '',
                preview: cache.preview || null,
                warnings: cache.warnings || []
            } : {
                exists: false
            },
            writeback: {
                updatedAt: writeback.updatedAt || '',
                syncedCount: safeArray(writeback.records).length,
                pendingCount: candidates.length,
                recentRecords: safeArray(writeback.records).slice(-10).reverse()
            },
            files: {
                cache: store.info('feishu-direction-cache.json'),
                writeback: store.info('feishu-writeback.json')
            }
        };
    }

    return {
        getStatus,
        previewImport,
        previewWriteback,
        saveConfig: saveDirectionSyncConfig,
        syncImport,
        syncWriteback,
        testConnection
    };
}

module.exports = {
    DIRECTION_HEADERS,
    DEFAULT_DIRECTION_WIKI_URL,
    createFeishuDirectionSyncService,
    getPublicConfig,
    readDirectionSyncConfig,
    saveDirectionSyncConfig,
    validateConfig,
    rowsFromValues,
    buildImportPreview,
    buildRowValues,
    findInsertAfterRow
};
