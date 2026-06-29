const crypto = require('crypto');

const DIRECTION_TAGS_FILE = 'direction-tags.json';
const TAG_LIMIT = 5;
const RISK_TAG_LIMIT = 6;

function nowIso() {
    return new Date().toISOString();
}

function safeArray(value) {
    return Array.isArray(value) ? value : [];
}

function normalizeText(value = '') {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeKey(value = '') {
    return normalizeText(value)
        .toLowerCase()
        .replace(/[()（）\d]+/g, '')
        .replace(/[_/|]+/g, ' ')
        .replace(/[。；;,.，、:："'“”‘’[\]{}<>《》!?！？]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function splitDirectionPath(value = '') {
    return normalizeText(value)
        .split('/')
        .map(part => part.trim())
        .filter(Boolean);
}

function directionParentPath(value = '') {
    const parts = splitDirectionPath(value);
    return parts.length > 1 ? parts.slice(0, -1).join('/') : normalizeText(value);
}

function directionLastName(value = '') {
    const parts = splitDirectionPath(value);
    return parts[parts.length - 1] || normalizeText(value);
}

function directionMatchKey(value = '') {
    return normalizeText(value)
        .toLowerCase()
        .replace(/[\s\\/_\-.,，。；;:：'"“”‘’()（）[\]{}<>《》!?！？]/g, '');
}

function uniqueValues(values = [], limit = TAG_LIMIT) {
    const seen = new Set();
    const output = [];
    values.flat().forEach(value => {
        const text = normalizeTag(value);
        const key = directionMatchKey(text);
        if (!text || !key || seen.has(key)) return;
        seen.add(key);
        output.push(text);
    });
    return output.slice(0, limit);
}

const EXACT_LABELS = new Map(Object.entries({
    'comic relief under danger': '危中幽默',
    'urgent hope': '急迫希望',
    'last chance pressure': '最后机会',
    'surprise reward': '惊喜奖励',
    'low angle close foreground': '低机位近景',
    'low-angle close foreground': '低机位近景',
    'macro prop with human stakes': '道具特写',
    'top down map like view': '地图俯瞰',
    'top-down map-like view': '地图俯瞰',
    'over shoulder pursuit': '越肩追逐',
    'over-shoulder pursuit': '越肩追逐',
    'evacuation countdown': '撤离倒计时',
    'temporary bridge': '临时桥',
    'blocked entrance': '入口受阻',
    'collapsing shelter': '庇护坍塌',
    'escort through danger': '护送穿越',
    'frozen vehicle route': '冰面车路',
    'repair restart': '维修重启',
    'signal flare clue': '信号线索',
    'resource contest': '资源争夺',
    'moral tradeoff': '取舍抉择',
    'warm hope': '温暖希望',
    'first person': '第一人称',
    'first-person': '第一人称',
    'top down': '俯瞰',
    'overhead': '俯瞰',
    'low angle': '低机位',
    'close foreground': '近景',
    evacuation: '撤离',
    discovery: '发现',
    danger: '危险',
    hope: '希望',
    warning: '警示',
    shelter: '庇护所',
    repair: '维修',
    rescue: '救援',
    escort: '护送',
    map: '地图线索',
    bridge: '桥梁通行',
    entrance: '入口目标'
}));

const TAG_RULES = [
    [/多余.*文字|上下.*文字|文字信息|英文|小字|包装|品牌|标识|地名|UI/i, '文字干扰'],
    [/过度科幻|科幻|高科技|赛博|机甲|激光|悬浮|能量装置/i, '过度科幻'],
    [/主体不清|主体.*不明|看不清|不清晰|焦点.*散|元素过多/i, '主体不清'],
    [/军事化|枪支|血腥|暴力|真实品牌/i, '合规风险'],
    [/信号弹|信号烟|信号|光束|红烟/i, '信号线索'],
    [/标语|文字|短牌|中文|纸条/i, '中文标语'],
    [/路标|指示牌|箭头|方向牌/i, '指示路标'],
    [/巨型|地标|尺度|高耸|巨大/i, '巨型地标'],
    [/暖光|暖灯|窗口|灯光|火炉|炉火|火光/i, '暖光目标'],
    [/选择压力|犹豫|是否|转向|分叉|取舍|抉择/i, '选择压力'],
    [/守护|保护阵型|围成保护|护住|半围合/i, '守护动作'],
    [/手套|伸手|手部|拉扯|递过|交接/i, '手部动作'],
    [/绳梯|绳索|绳结|攀爬|钢索/i, '绳索攀爬'],
    [/工具箱|工具小件|破冰工具|锈蚀工具/i, '工具箱'],
    [/零件包|维修零件|破损零件|齿轮|手摇轮/i, '维修零件'],
    [/搭建支架|搭建|支架|临时木板/i, '搭建动作'],
    [/车辆|车辙|雪橇|小推车|载具|车厢|手泵|燃料/i, '载具燃料'],
    [/桥|桥面|断桥|冰桥|桥墩/i, '桥梁通行'],
    [/裂缝|裂冰|冰裂|冰缝|断裂冰面/i, '冰裂危机'],
    [/补给|物资|药包|药箱|急救盒|木柴|热汤|食物/i, '物资补给'],
    [/地图|路线|地图筒|路线图/i, '地图线索'],
    [/入口|仓门|门缝|铁门|卷门|门廊/i, '入口目标'],
    [/冰洞|天窗|洞口|雪洞|冰井/i, '洞口空间'],
    [/队列|排队|订单|摊位|交易|交换/i, '交易队列'],
    [/撤离|逃离|倒计时|快进|最后/i, '撤离压力'],
    [/争夺|抢夺|拉扯|资源冲突|两队/i, '资源争夺'],
    [/发现|初次发现|隐藏|暗格|线索/i, '发现线索'],
    [/救援|求救|伤员|救命|抢救|护送/i, '救援目标'],
    [/温暖希望|希望|种子|幼苗|黎明|晨光/i, '温暖希望'],
    [/暴风雪|风雪|雪夜|寒潮|极寒/i, '风雪压迫'],
    [/俯瞰|鸟瞰|高处|地图式/i, '俯瞰'],
    [/第一人称|主观|手持/i, '第一人称'],
    [/低机位|仰视|低角度/i, '低机位'],
    [/近景|特写|近前景|前景/i, '近景主体'],
    [/平视|正面|中景/i, '平视中景'],
    [/主体明确|一眼可读|中心|画面中心/i, '主体明确']
];

const RISK_RULES = [
    [/英文|小字|包装|品牌|标识|地名|UI|文字|english\s*text|text|brand|logo/i, '文字干扰'],
    [/过度科幻|科幻|高科技|赛博|机甲|激光|悬浮|能量|over\s*sci-?fi|sci-?fi|science\s*fiction|mecha/i, '过度科幻'],
    [/主体不清|主体.*不明|看不清|不清晰|焦点.*散|元素过多|过碎/i, '主体不清'],
    [/军事化|枪支|血腥|暴力|真实品牌/i, '合规风险'],
    [/纯静物|静态|空场景|过于安静|只剩风景/i, '画面过静'],
    [/重复|相似|复用|同质|撞车|合并/i, '重复风险']
];
const RISK_LABELS = new Set(RISK_RULES.map(([, label]) => label));
const RISK_TAG_EXCLUSIONS = new Map([
    ['文字干扰', ['中文标语']],
    ['过度科幻', ['过度科幻']],
    ['主体不清', ['主体不清']],
    ['合规风险', ['合规风险']],
    ['画面过静', ['画面过静']],
    ['重复风险', ['重复风险']]
]);

function localizeText(value = '') {
    let text = normalizeText(value);
    if (!text) return '';
    EXACT_LABELS.forEach((to, from) => {
        text = text.replace(new RegExp(escapeRegExp(from), 'gi'), to);
    });
    return text
        .replace(/\b(visualDna|atmosphere|camera|event|visualHook)\b/gi, '')
        .replace(/视觉\s*DNA/gi, '方向标签')
        .replace(/视觉\s*钩子/g, '画面重点')
        .replace(/钩子/g, '重点')
        .replace(/视角/g, '镜头')
        .replace(/事件/g, '动作')
        .replace(/氛围/g, '感')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

function escapeRegExp(value = '') {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeTag(value = '') {
    const raw = localizeText(value)
        .replace(/^(方向标签|风险|避免|注意|建议|制作|画面重点|DNA)\s*[:：]\s*/i, '')
        .replace(/[。；;,.，、]+$/g, '')
        .trim();
    if (!raw) return '';
    const key = normalizeKey(raw);
    if (EXACT_LABELS.has(key)) return EXACT_LABELS.get(key);
    if (RISK_LABELS.has(raw)) return raw;
    if (/^[a-z0-9\s-]+$/i.test(raw)) return EXACT_LABELS.get(key) || '';
    if (/^(感|镜头|动作|重点|视觉|方向|主体|画面|制作|风险)$/.test(raw)) return '';
    const rule = TAG_RULES.find(([pattern]) => pattern.test(raw));
    if (rule) return rule[1];
    return raw.length > 8 ? raw.slice(0, 8) : raw;
}

function splitTagValues(value) {
    if (Array.isArray(value)) return value.flatMap(splitTagValues);
    if (value && typeof value === 'object') return Object.values(value).flatMap(splitTagValues);
    return normalizeText(value)
        .split(/[、,，;；\n|/]+/)
        .map(normalizeTag)
        .filter(Boolean);
}

function riskTagsFromText(value = '') {
    const text = normalizeText(value);
    if (!text) return [];
    return RISK_RULES
        .filter(([pattern]) => pattern.test(text))
        .map(([, label]) => label);
}

function explicitRiskTagValues(value) {
    return splitTagValues(value).filter(tag => RISK_LABELS.has(tag));
}

function tagsFromText(value = '') {
    const text = normalizeText(value);
    if (!text) return [];
    const matches = TAG_RULES
        .filter(([pattern]) => pattern.test(text))
        .map(([, label]) => label);
    if (matches.length) return matches;
    return splitTagValues(text).filter(tag => tag.length <= 6);
}

function objectAliasValues(source = {}, aliases = []) {
    if (!source || typeof source !== 'object') return [];
    return aliases.flatMap(alias => splitTagValues(source[alias]));
}

function normalizeDirectionTagsForRecord(record = {}, options = {}) {
    const visualDna = record.visualDna && typeof record.visualDna === 'object' ? record.visualDna : {};
    const dimensions = record.dimensions && typeof record.dimensions === 'object' ? record.dimensions : {};
    const directTags = [
        record.mainTags,
        record.directionTags,
        record.tags,
        record.extraTags
    ].flatMap(splitTagValues);
    const legacyTags = [
        visualDna.mainTags,
        visualDna.atmosphere,
        visualDna.camera,
        visualDna.event,
        visualDna.visualHook,
        objectAliasValues(dimensions, ['mood', 'atmosphere', 'tone', 'emotion']),
        objectAliasValues(dimensions, ['camera', 'perspective', 'view', 'angle', 'shot']),
        objectAliasValues(dimensions, ['event', 'narrative', 'action', 'story', 'moment']),
        objectAliasValues(dimensions, ['hook', 'visualHook', 'pictureHook', 'sellingPoint']),
        record.visualHook,
        record.hook,
        record.pictureHook
    ].flatMap(splitTagValues);
    const textTags = [
        record.name,
        record.newDirectionName,
        record.extensionName,
        record.direction,
        record.path,
        record.description,
        record.visualHook,
        record.productionAdvice,
        record.dedupeReason,
        record.reason
    ].flatMap(tagsFromText);
    const riskTags = uniqueValues([
        explicitRiskTagValues(record.riskTags),
        riskTagsFromText([
            record.avoidRules,
            record.riskNote,
            record.duplicateRisk,
            record.dedupeReason,
            record.mustAvoid,
            record.description,
            record.productionAdvice
        ].filter(Boolean).join('。'))
    ], options.riskLimit || RISK_TAG_LIMIT);
    const riskKeys = new Set(riskTags.flatMap(tag => [
        tag,
        ...(RISK_TAG_EXCLUSIONS.get(tag) || [])
    ]).map(directionMatchKey));
    const tags = uniqueValues(directTags.concat(legacyTags, textTags), options.limit || TAG_LIMIT + riskTags.length)
        .filter(tag => !riskKeys.has(directionMatchKey(tag)))
        .slice(0, options.limit || TAG_LIMIT);
    return {
        tags,
        riskTags
    };
}

function isCleanDirectionTag(value = '', options = {}) {
    const text = normalizeTag(value);
    if (!text) return false;
    const maxLength = Number(options.maxLength) || 8;
    if (text.length > maxLength) return false;
    if (/[a-z]/i.test(text)) return false;
    if (/(visualDna|visualHook|DNA|氛围|视角|事件|钩子)/i.test(text)) return false;
    return /[\u4e00-\u9fff]/.test(text);
}

function sourceWeight(type = '') {
    if (type === 'manual') return 20;
    if (type === 'reference-vision' || type === 'vision') return 18;
    if (type === 'feedback') return 16;
    if (type === 'direction-evidence') return 9;
    if (type === 'direction-drafts') return 7;
    if (type === 'direction-expansion-history') return 5;
    if (type === 'runs') return 4;
    if (type === 'direction') return 3;
    return 1;
}

function createAccumulator(direction = {}) {
    return {
        directionId: direction.id || '',
        path: direction.path || direction.name || '',
        name: direction.name || direction.path || '',
        parentPath: directionParentPath(direction.path || direction.name || ''),
        tagScores: new Map(),
        riskScores: new Map(),
        sources: []
    };
}

function addTagScore(map, tag, source = {}) {
    const normalized = normalizeTag(tag);
    if (!normalized) return;
    const key = directionMatchKey(normalized);
    if (!key) return;
    const current = map.get(key) || { value: normalized, count: 0, score: 0, sources: [] };
    current.count += 1;
    current.score += sourceWeight(source.type);
    if (current.sources.length < 8) {
        current.sources.push({
            type: source.type || 'fallback',
            field: source.field || '',
            id: source.id || '',
            weight: sourceWeight(source.type)
        });
    }
    map.set(key, current);
}

function addRecordToAccumulator(acc, record = {}, source = {}) {
    if (!acc || !record) return;
    const normalized = normalizeDirectionTagsForRecord(record, { limit: 12, riskLimit: RISK_TAG_LIMIT });
    normalized.tags.forEach(tag => addTagScore(acc.tagScores, tag, source));
    normalized.riskTags.forEach(tag => addTagScore(acc.riskScores, tag, { ...source, risk: true }));
    if (acc.sources.length < 24) {
        acc.sources.push({
            type: source.type || 'fallback',
            id: source.id || '',
            field: source.field || '',
            tagCount: normalized.tags.length,
            riskTagCount: normalized.riskTags.length
        });
    }
}

function sortedScores(map, limit) {
    return Array.from(map.values())
        .sort((a, b) => b.score - a.score || b.count - a.count || a.value.localeCompare(b.value))
        .slice(0, limit)
        .map(item => ({
            value: item.value,
            count: item.count,
            score: item.score,
            sources: item.sources
        }));
}

function finalizeAccumulator(acc) {
    const topTags = sortedScores(acc.tagScores, TAG_LIMIT);
    const riskTags = sortedScores(acc.riskScores, RISK_TAG_LIMIT);
    return {
        directionId: acc.directionId,
        path: acc.path,
        name: acc.name,
        parentPath: acc.parentPath,
        tags: topTags.map(item => item.value),
        riskTags: riskTags.map(item => item.value),
        topTags,
        topRiskTags: riskTags,
        sourceCount: acc.sources.length,
        sources: acc.sources,
        confidence: Math.min(0.96, Number((0.24 + topTags.length * 0.1 + Math.min(acc.sources.length, 8) * 0.045).toFixed(2))),
        updatedAt: nowIso()
    };
}

function directionMatchesRecord(direction = {}, record = {}) {
    if (!direction || !record) return false;
    const directionId = normalizeText(direction.id);
    const recordIds = [
        record.directionId,
        record.targetDirectionId,
        record.sourceDirectionId,
        record.matchedDirectionId,
        record.acceptedDirectionId
    ].map(normalizeText).filter(Boolean);
    if (directionId && recordIds.includes(directionId)) return true;

    const pathKey = directionMatchKey(direction.path || direction.name || direction.id);
    const recordPath = directionMatchKey(
        record.directionPath ||
        record.targetDirectionPath ||
        record.sourceDirectionPath ||
        record.path ||
        record.sourcePath ||
        record.directionKey
    );
    const recordName = directionMatchKey(record.name || record.newDirectionName || record.extensionName || record.targetDirectionName);
    if (!pathKey) return false;
    return Boolean(
        recordPath && pathKey === recordPath ||
        recordName && recordName === directionMatchKey(direction.name)
    );
}

function runRecords(run = {}) {
    const report = run.directionPlanReport || run.directionCandidateReport || {};
    const review = run.directionCandidateReview || {};
    return []
        .concat(safeArray(report.selectedExtensions))
        .concat(safeArray(report.lowScoreSelectedExtensions))
        .concat(safeArray(review.selected))
        .map(item => ({
            ...item,
            sourceDirectionId: item.sourceDirectionId || run.sourceDirection && run.sourceDirection.id,
            sourceDirectionPath: item.sourceDirectionPath || run.sourceDirection && run.sourceDirection.path,
            runId: run.runId
        }));
}

function buildDirectionTagRecords({ directions = [], drafts = [], history = [], feedback = [], assets = [], evidence = [], runs = [], existing = [] } = {}) {
    const accById = new Map();
    safeArray(directions).forEach(direction => {
        const acc = createAccumulator(direction);
        addRecordToAccumulator(acc, direction, { type: 'direction', id: direction.id, field: 'direction' });
        accById.set(direction.id, acc);
    });

    const addMatching = (record, source) => {
        accById.forEach((acc, directionId) => {
            const direction = safeArray(directions).find(item => item.id === directionId) || {};
            if (directionMatchesRecord(direction, record)) addRecordToAccumulator(acc, record, source);
        });
    };

    const assetsById = new Map(safeArray(assets).map(asset => [asset.assetId, asset]));
    safeArray(feedback)
        .filter(item => ['good', 'normal'].includes(normalizeText(item.status || item.reviewStatus).toLowerCase()))
        .forEach(item => {
            const asset = assetsById.get(item.assetId) || {};
            addMatching({
                ...asset,
                ...item,
                description: [item.note, item.modified, asset.promptTitle, asset.prompt, asset.promptDirection].filter(Boolean).join('。')
            }, { type: 'feedback', id: item.feedbackId || item.assetId, field: 'feedback' });
        });

    safeArray(evidence).forEach(item => {
        addMatching(item, { type: 'direction-evidence', id: item.id || item.evidenceId || item.assetGroupKey, field: 'evidence' });
    });
    safeArray(history).forEach(item => {
        addMatching(item, { type: 'direction-expansion-history', id: item.dedupeKey || item.extensionKey || item.newDirectionName, field: 'history' });
    });
    safeArray(drafts)
        .filter(item => ['accepted', 'draft'].includes(normalizeText(item.status || 'draft').toLowerCase()))
        .forEach(item => {
            addMatching(item, { type: 'direction-drafts', id: item.id, field: 'draft' });
        });
    safeArray(runs).forEach(run => {
        runRecords(run).forEach(item => addMatching(item, { type: 'runs', id: run.runId, field: 'selectedExtensions' }));
    });
    safeArray(existing).filter(item => (
        item.manual === true ||
        item.source === 'manual' ||
        item.source === 'reference-vision' ||
        item.source === 'vision'
    )).forEach(item => {
        const id = item.directionId || item.id;
        const acc = accById.get(id);
        if (!acc) return;
        const sourceType = item.manual === true || item.source === 'manual'
            ? 'manual'
            : 'reference-vision';
        addRecordToAccumulator(acc, item, { type: sourceType, id, field: 'direction-tags.json' });
    });

    return Array.from(accById.values()).map(finalizeAccumulator);
}

function emptyDirectionTags() {
    return {
        version: 1,
        updatedAt: nowIso(),
        directions: []
    };
}

function buildDirectionTagsIndex(data = {}) {
    const index = new Map();
    safeArray(data.directions).forEach(item => {
        [
            item.directionId,
            item.id,
            item.path,
            item.name
        ].map(normalizeText).filter(Boolean).forEach(key => {
            index.set(key, item);
            index.set(directionMatchKey(key), item);
        });
    });
    return index;
}

function directionTagHash(record = {}) {
    return crypto
        .createHash('sha1')
        .update([
            record.directionId,
            safeArray(record.tags).join('|'),
            safeArray(record.riskTags).join('|')
        ].join('::'))
        .digest('hex')
        .slice(0, 12);
}

module.exports = {
    DIRECTION_TAGS_FILE,
    TAG_LIMIT,
    RISK_TAG_LIMIT,
    buildDirectionTagRecords,
    buildDirectionTagsIndex,
    directionMatchKey,
    directionTagHash,
    emptyDirectionTags,
    isCleanDirectionTag,
    localizeText,
    normalizeDirectionTagsForRecord,
    normalizeTag,
    splitTagValues
};
