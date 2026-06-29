const crypto = require('crypto');
const { normalizeDirectionTagsForRecord } = require('../direction-tags');

const DEFAULT_DIRECTION_PLAN_CONFIG = {
    candidateExtensionsPerSource: 8,
    selectedExtensionsPerSource: 4,
    promptsPerExtension: 2,
    minScore: 70,
    preferredScore: 85,
    maxRepairAttempts: 2,
    diversityMode: 'balanced',
    historyScope: 'recent30',
    candidateMultiplier: 2,
    tagStrategy: 'stable'
};

const ABSTRACT_TERMS = [
    '氛围感',
    '高级感',
    '生存感',
    '末日感',
    '故事感',
    '电影感',
    '视觉感',
    '情绪感',
    '冲突感',
    '主题拓展'
];

const EVENT_TERMS = [
    '发现',
    '争夺',
    '护送',
    '抢救',
    '交换',
    '撤离',
    '守护',
    '倒计时',
    '修复',
    '重启',
    '搭建',
    '运输',
    '逃离',
    '救援',
    '解冻',
    '搬运',
    '追逐',
    '选择'
];

const VISUAL_TERMS = [
    '前景',
    '中景',
    '远景',
    '镜头',
    '低机位',
    '俯视',
    '构图',
    '幸存者',
    '小队',
    '物资',
    '药箱',
    '燃料',
    '火光',
    '灯光',
    '警报',
    '地图',
    '信号',
    '避难所',
    '废墟',
    '车辆',
    '桥',
    '入口',
    '冰层',
    '暴风雪',
    '厚雪',
    '裂冰',
    '金属',
    '旧布料'
];

const DNA_CORE_FIELDS = ['atmosphere', 'camera', 'event', 'visualHook'];
const DNA_FIELD_ALIASES = {
    atmosphere: ['atmosphere', 'mood', 'tone', 'emotion', '氛围', '情绪'],
    camera: ['camera', 'perspective', 'view', 'angle', 'shot', '视角', '镜头'],
    event: ['event', 'narrative', 'action', 'story', 'moment', '事件', '叙事', '动作'],
    visualHook: ['visualHook', 'hook', 'pictureHook', 'sellingPoint', '钩子', '视觉钩子']
};

function safeArray(value) {
    return Array.isArray(value) ? value : [];
}

function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeKey(value) {
    return normalizeText(value)
        .replace(/[，。！？；：、,.!?;:\s"'“”‘’（）()[\]{}【】《》<>]/g, '')
        .toLowerCase();
}

function clampCount(value, fallback, min = 1, max = 20) {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue)) return fallback;
    return Math.max(min, Math.min(max, Math.floor(numberValue)));
}

function firstDefined(...values) {
    return values.find(value => value !== undefined && value !== null && value !== '');
}

function normalizeChoice(value, allowed, fallback) {
    const normalized = normalizeText(value).toLowerCase();
    return allowed.includes(normalized) ? normalized : fallback;
}

function buildDirectionPlanConfig(payload = {}, config = {}) {
    const fromConfig = config.directionPlanning || {};
    const fromPayload = payload.directionPlanning || {};
    const selectedExtensionsPerSource = clampCount(
        firstDefined(fromPayload.selectedExtensionsPerSource, payload.newDirectionsPerSource, fromConfig.selectedExtensionsPerSource),
        DEFAULT_DIRECTION_PLAN_CONFIG.selectedExtensionsPerSource,
        1,
        12
    );
    const explicitCandidateExtensions = firstDefined(
        fromPayload.candidateExtensionsPerSource,
        fromPayload.candidateDirectionsPerSource
    );
    const candidateMultiplier = clampCount(
        firstDefined(fromPayload.candidateMultiplier, fromConfig.candidateMultiplier),
        DEFAULT_DIRECTION_PLAN_CONFIG.candidateMultiplier,
        1,
        5
    );
    const selectedProvidedByPayload = firstDefined(fromPayload.selectedExtensionsPerSource, payload.newDirectionsPerSource) !== undefined;
    const candidateExtensionsPerSource = clampCount(
        explicitCandidateExtensions !== undefined
            ? explicitCandidateExtensions
            : (selectedProvidedByPayload
                ? selectedExtensionsPerSource * candidateMultiplier
                : fromConfig.candidateExtensionsPerSource),
        Math.max(DEFAULT_DIRECTION_PLAN_CONFIG.candidateExtensionsPerSource, selectedExtensionsPerSource * 2),
        1,
        24
    );
    return {
        candidateExtensionsPerSource: Math.max(selectedExtensionsPerSource, candidateExtensionsPerSource),
        selectedExtensionsPerSource,
        promptsPerExtension: clampCount(
            firstDefined(fromPayload.promptsPerExtension, payload.promptsPerExtension, payload.promptGroupsPerNewDirection, fromConfig.promptsPerExtension),
            DEFAULT_DIRECTION_PLAN_CONFIG.promptsPerExtension,
            1,
            8
        ),
        minScore: clampCount(
            firstDefined(fromPayload.minScore, fromConfig.minScore),
            DEFAULT_DIRECTION_PLAN_CONFIG.minScore,
            1,
            100
        ),
        preferredScore: clampCount(
            firstDefined(fromPayload.preferredScore, fromConfig.preferredScore),
            DEFAULT_DIRECTION_PLAN_CONFIG.preferredScore,
            1,
            100
        ),
        maxRepairAttempts: clampCount(
            firstDefined(fromPayload.maxRepairAttempts, fromConfig.maxRepairAttempts),
            DEFAULT_DIRECTION_PLAN_CONFIG.maxRepairAttempts,
            0,
            4
        ),
        diversityMode: normalizeChoice(
            firstDefined(fromPayload.diversityMode, fromConfig.diversityMode),
            ['stable', 'balanced', 'explore'],
            DEFAULT_DIRECTION_PLAN_CONFIG.diversityMode
        ),
        historyScope: normalizeChoice(
            firstDefined(fromPayload.historyScope, fromConfig.historyScope),
            ['recent10', 'recent30', 'all'],
            DEFAULT_DIRECTION_PLAN_CONFIG.historyScope
        ),
        tagStrategy: normalizeChoice(
            firstDefined(fromPayload.tagStrategy, fromPayload.expansionStrategy, fromConfig.tagStrategy, fromConfig.expansionStrategy),
            ['stable', 'explore'],
            DEFAULT_DIRECTION_PLAN_CONFIG.tagStrategy
        ),
        candidateMultiplier
    };
}

function countHits(text, terms) {
    const value = normalizeText(text);
    return terms.reduce((count, term) => count + (value.includes(term) ? 1 : 0), 0);
}

function hasAbstractName(name) {
    const value = normalizeText(name);
    return ABSTRACT_TERMS.some(term => value.includes(term));
}

function hasConcreteEvent(text) {
    return countHits(text, EVENT_TERMS) > 0;
}

function hasVisualHook(text) {
    return countHits(text, VISUAL_TERMS) >= 2 || hasConcreteEvent(text);
}

function valueList(value) {
    if (Array.isArray(value)) return value.flatMap(item => valueList(item));
    if (value && typeof value === 'object') {
        return [value.value, value.label, value.name, value.text].flatMap(item => valueList(item));
    }
    return String(value || '')
        .split(/[、，；;,|/]+/)
        .map(normalizeText)
        .filter(Boolean);
}

function uniqueDnaValues(values = []) {
    const seen = new Set();
    const result = [];
    valueList(values).forEach(value => {
        const key = normalizeKey(value);
        if (!key || seen.has(key)) return;
        seen.add(key);
        result.push(value);
    });
    return result;
}

function getAliasValue(object = {}, aliases = []) {
    if (!object || typeof object !== 'object') return [];
    return aliases.flatMap(alias => valueList(object[alias]));
}

function inferDnaFromText(record = {}) {
    const joined = normalizeText([
        record.name,
        record.extensionName,
        record.newDirectionName,
        record.direction,
        record.description,
        record.visualHook,
        record.productionAdvice,
        record.dedupeReason
    ].filter(Boolean).join(' '));
    const dna = {
        atmosphere: [],
        camera: [],
        event: [],
        visualHook: []
    };
    if (!joined) return dna;

    const atmosphereTerms = [
        ['紧张危机', ['紧张', '危机', '抢', '争夺', '撤离']],
        ['史诗壮阔', ['史诗', '壮阔', '巨型', '地标', '宏大']],
        ['温暖希望', ['温暖', '希望', '暖光', '救援', '灯光']],
        ['神秘未知', ['神秘', '未知', '发现', '入口', '遗迹']],
        ['荒凉孤独', ['荒凉', '孤独', '废墟', '空城']]
    ];
    const cameraTerms = [
        ['第一人称', ['第一人称', '手持', '主观']],
        ['俯瞰', ['俯瞰', '鸟瞰', '高处']],
        ['平视', ['平视', '正面']],
        ['低机位', ['低机位', '仰视']],
        ['近景', ['近景', '特写']]
    ];
    const eventTerms = [
        ['撤离', ['撤离', '逃离']],
        ['发现', ['发现', '初次发现']],
        ['求救', ['求救', '救援', '抢救']],
        ['争夺', ['争夺', '拉扯']],
        ['修复', ['修复', '重启']]
    ];

    atmosphereTerms.forEach(([value, terms]) => {
        if (terms.some(term => joined.includes(term))) dna.atmosphere.push(value);
    });
    cameraTerms.forEach(([value, terms]) => {
        if (terms.some(term => joined.includes(term))) dna.camera.push(value);
    });
    eventTerms.forEach(([value, terms]) => {
        if (terms.some(term => joined.includes(term))) dna.event.push(value);
    });
    if (hasVisualHook(joined)) {
        dna.visualHook.push(normalizeText(record.visualHook || record.hook || record.pictureHook || record.description).slice(0, 80));
    }
    return dna;
}

function extensionVisualDna(extension = {}) {
    const visualDna = extension.visualDna && typeof extension.visualDna === 'object' ? extension.visualDna : {};
    const dimensions = extension.dimensions && typeof extension.dimensions === 'object' ? extension.dimensions : {};
    const inferred = inferDnaFromText(extension);
    return {
        atmosphere: uniqueDnaValues(
            getAliasValue(visualDna, DNA_FIELD_ALIASES.atmosphere)
                .concat(getAliasValue(dimensions, DNA_FIELD_ALIASES.atmosphere))
                .concat(inferred.atmosphere)
        ),
        camera: uniqueDnaValues(
            getAliasValue(visualDna, DNA_FIELD_ALIASES.camera)
                .concat(getAliasValue(dimensions, DNA_FIELD_ALIASES.camera))
                .concat(inferred.camera)
        ),
        event: uniqueDnaValues(
            getAliasValue(visualDna, DNA_FIELD_ALIASES.event)
                .concat(getAliasValue(dimensions, DNA_FIELD_ALIASES.event))
                .concat(inferred.event)
        ),
        visualHook: uniqueDnaValues(
            getAliasValue(visualDna, DNA_FIELD_ALIASES.visualHook)
                .concat(getAliasValue(dimensions, DNA_FIELD_ALIASES.visualHook))
                .concat(valueList(extension.visualHook || extension.hook || extension.pictureHook))
                .concat(inferred.visualHook)
        )
    };
}

function dnaComboKey(dna = {}) {
    return DNA_CORE_FIELDS
        .map(key => normalizeKey(safeArray(dna[key])[0] || ''))
        .filter(Boolean)
        .join('|');
}

function preferenceValues(preference = {}, key) {
    const source = preference[key]
        || (preference.visualDna && preference.visualDna[key])
        || (preference.topValues && preference.topValues[key])
        || (preference.highAdoption && preference.highAdoption[key])
        || [];
    return safeArray(source).flatMap(item => valueList(item && typeof item === 'object' ? (item.value || item.label || item.name) : item));
}

function preferenceRisks(preference = {}) {
    return safeArray(preference.risks || preference.highRisks || preference.riskTerms || preference.avoid)
        .flatMap(item => valueList(item && typeof item === 'object' ? (item.value || item.label || item.name || item.text) : item));
}

function textMatchesValue(text, value) {
    const left = normalizeKey(text);
    const right = normalizeKey(value);
    if (!left || !right) return false;
    return left.includes(right) || right.includes(left) || similarity(left, right) >= 0.45;
}

function countPreferenceMatches(dna = {}, preference = {}) {
    return DNA_CORE_FIELDS.reduce((count, key) => {
        const values = safeArray(dna[key]);
        const preferred = preferenceValues(preference, key).slice(0, 6);
        return count + (values.some(value => preferred.some(target => textMatchesValue(value, target))) ? 1 : 0);
    }, 0);
}

function buildHistoricalDnaCombos(items = []) {
    const combos = new Set();
    safeArray(items).forEach(item => {
        const key = dnaComboKey(extensionVisualDna(item));
        if (key) combos.add(key);
    });
    return combos;
}

function buildDnaAssessment(extension = {}, context = {}) {
    const dna = extensionVisualDna(extension);
    const comboKey = dnaComboKey(dna);
    const completeness = DNA_CORE_FIELDS.filter(key => safeArray(dna[key]).length > 0).length;
    const preferenceMatchCount = countPreferenceMatches(dna, context.visualDnaPreference || {});
    const historyCombos = context.historyDnaCombos || new Set();
    const seenCombos = context.seenDnaCombos || new Set();
    const riskTerms = preferenceRisks(context.visualDnaPreference || {});
    const joined = [
        extension.name,
        extension.description,
        extension.visualHook,
        extension.dedupeReason,
        extension.riskNote,
        extension.productionAdvice
    ].map(normalizeText).filter(Boolean).join(' ');
    const riskHits = riskTerms
        .filter(term => normalizeKey(term).length >= 2)
        .filter(term => textMatchesValue(joined, term))
        .slice(0, 6);
    return {
        dna,
        comboKey,
        completeness,
        completenessRatio: Number((completeness / DNA_CORE_FIELDS.length).toFixed(2)),
        preferenceMatchCount,
        isDiverseInCurrentPool: Boolean(comboKey && !seenCombos.has(comboKey)),
        isHistoricalRepeat: Boolean(comboKey && historyCombos.has(comboKey)),
        riskHits
    };
}

function preferenceTagValues(preference = {}, keys = []) {
    return keys.flatMap(key => valueList(preference[key]));
}

function preferenceTopTagValues(preference = {}) {
    return preferenceTagValues(preference, [
        'highTags',
        'preferredTags',
        'directionTags',
        'tags',
        'highPerformingTags'
    ]).concat(valueList(preference.topTags));
}

function preferenceGapTagValues(preference = {}) {
    return preferenceTagValues(preference, [
        'gapTags',
        'missingTags',
        'underusedTags'
    ]);
}

function preferenceRiskTagValues(preference = {}) {
    return preferenceTagValues(preference, [
        'riskTags',
        'avoidTags',
        'highRiskTags',
        'risks'
    ]).concat(valueList(preference.topRiskTags));
}

function preferenceRepeatedTagCombos(preference = {}) {
    return preferenceTagValues(preference, [
        'repeatedCombos',
        'repeatedTagCombos',
        'duplicateCombos'
    ]);
}

function tagComboKey(tags = []) {
    const values = Array.isArray(tags)
        ? tags
        : String(tags || '').split(/[+|/、，,]+/);
    return values
        .slice(0, 3)
        .map(normalizeKey)
        .filter(Boolean)
        .join('|');
}

function buildHistoricalTagCombos(items = []) {
    const combos = new Set();
    safeArray(items).forEach(item => {
        const tags = normalizeDirectionTagsForRecord(item, { limit: 5 }).tags;
        const key = tagComboKey(tags);
        if (key) combos.add(key);
    });
    return combos;
}

function buildTagAssessment(extension = {}, context = {}) {
    const normalized = normalizeDirectionTagsForRecord(extension, { limit: 8, riskLimit: 6 });
    const tags = normalized.tags;
    const riskTags = normalized.riskTags;
    const preference = context.directionTagPreference || {};
    const highTags = preferenceTopTagValues(preference).slice(0, 12);
    const gapTags = preferenceGapTagValues(preference).slice(0, 12);
    const riskPreferences = preferenceRiskTagValues(preference).slice(0, 12);
    const repeatedCombos = new Set(preferenceRepeatedTagCombos(preference).map(tagComboKey).filter(Boolean));
    const comboKey = tagComboKey(tags);
    const joined = [
        extension.name,
        extension.description,
        extension.visualHook,
        extension.dedupeReason,
        extension.riskNote,
        extension.productionAdvice,
        safeArray(extension.avoidRules).join(' ')
    ].map(normalizeText).filter(Boolean).join(' ');
    const matchValues = (values = []) => tags
        .filter(tag => values.some(value => textMatchesValue(tag, value)));
    const riskHits = riskTags
        .concat(riskPreferences
            .filter(term => normalizeKey(term).length >= 2)
            .filter(term => riskTags.some(tag => textMatchesValue(tag, term)) || textMatchesValue(joined, term)))
        .filter(Boolean);
    const seenCombos = context.seenTagCombos || new Set();
    const historyCombos = context.historyTagCombos || new Set();
    return {
        tags,
        riskTags,
        comboKey,
        completeness: tags.length,
        completenessRatio: Number((Math.min(tags.length, 5) / 5).toFixed(2)),
        highTagMatches: Array.from(new Set(matchValues(highTags))).slice(0, 6),
        gapTagMatches: Array.from(new Set(matchValues(gapTags))).slice(0, 6),
        isDiverseInCurrentPool: Boolean(comboKey && !seenCombos.has(comboKey)),
        isHistoricalRepeat: Boolean(comboKey && historyCombos.has(comboKey)),
        isRepeatedPreferredCombo: Boolean(comboKey && repeatedCombos.has(comboKey)),
        riskHits: Array.from(new Set(riskHits)).slice(0, 6)
    };
}

function directionTagsForOutput(item = {}) {
    const normalized = normalizeDirectionTagsForRecord(item);
    const tags = safeArray(item.directionTags).length ? safeArray(item.directionTags) : normalized.tags;
    return {
        tags,
        directionTags: tags,
        riskTags: safeArray(item.riskTags).length ? safeArray(item.riskTags) : normalized.riskTags
    };
}

function hasMeaningfulDnaObject(value) {
    if (!value || typeof value !== 'object') return false;
    return Object.values(value).some(item => valueList(item).some(text => normalizeKey(text)));
}

function hashPlanText(text) {
    return crypto.createHash('sha1').update(normalizeKey(text)).digest('hex').slice(0, 16);
}

function compactReason(parts = []) {
    return parts.map(normalizeText).filter(Boolean).join('；').slice(0, 500);
}

function tokenSet(value) {
    const text = normalizeText(value).toLowerCase();
    const tokens = new Set();
    const words = text.match(/[a-z0-9]+/g) || [];
    words.forEach(word => {
        if (word.length >= 2) tokens.add(word);
    });

    const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).join('');
    for (let index = 0; index < cjk.length - 1; index += 1) {
        tokens.add(cjk.slice(index, index + 2));
    }
    if (!tokens.size) {
        const key = normalizeKey(text);
        for (let index = 0; index < key.length - 2; index += 1) {
            tokens.add(key.slice(index, index + 3));
        }
        if (!tokens.size && key) tokens.add(key);
    }
    return tokens;
}

function similarity(left, right) {
    const leftTokens = tokenSet(left);
    const rightTokens = tokenSet(right);
    if (!leftTokens.size || !rightTokens.size) return 0;
    let overlap = 0;
    leftTokens.forEach(token => {
        if (rightTokens.has(token)) overlap += 1;
    });
    return overlap / Math.max(leftTokens.size, rightTokens.size);
}

function historyItemText(item = {}) {
    return [
        item.newDirectionName,
        item.extensionName,
        item.name,
        item.direction,
        item.visualHook,
        item.dedupeReason,
        item.description,
        item.promptTitle
    ].map(normalizeText).filter(Boolean).join(' ');
}

function maxHistorySimilarity(extension = {}, historyItems = []) {
    const name = normalizeText(extension.name || extension.extensionName || extension.newDirectionName || extension.direction);
    const mechanism = [
        extension.visualHook,
        extension.dedupeReason,
        extension.description,
        extension.productionAdvice
    ].map(normalizeText).filter(Boolean).join(' ');
    return safeArray(historyItems).reduce((best, item) => {
        const itemName = normalizeText(item.newDirectionName || item.extensionName || item.name || item.direction);
        const itemMechanism = historyItemText(item);
        return {
            name: Math.max(best.name, similarity(name, itemName)),
            mechanism: Math.max(best.mechanism, similarity(mechanism, itemMechanism))
        };
    }, { name: 0, mechanism: 0 });
}

function diversityPenaltyMultiplier(mode) {
    if (mode === 'stable') return 0.75;
    if (mode === 'explore') return 1.25;
    return 1;
}

function scoreDirectionExtension(extension = {}, context = {}) {
    const name = normalizeText(extension.name || extension.extensionName || extension.newDirectionName || extension.direction);
    const description = normalizeText(extension.description || extension.directionDescription);
    const visualHook = normalizeText(extension.visualHook || extension.hook || extension.pictureHook);
    const dedupeReason = normalizeText(extension.dedupeReason || extension.dedupReason || extension.reason);
    const productionAdvice = normalizeText(extension.productionAdvice || extension.makingAdvice || extension.sourceStrategy);
    const riskNote = normalizeText(extension.riskNote || extension.qualityRisk || extension.duplicateRisk);
    const joined = [name, description, visualHook, dedupeReason, productionAdvice].join(' ');
    const reasons = [];
    let score = 0;

    if (name.length >= 4 && !hasAbstractName(name)) {
        score += 20;
        reasons.push('方向命名具体');
    } else {
        reasons.push('方向命名偏抽象');
    }

    if (hasConcreteEvent(joined)) {
        score += 18;
        reasons.push('包含明确事件机制');
    } else if (description.length >= 20) {
        score += 10;
        reasons.push('有方向描述但事件机制不够强');
    } else {
        reasons.push('缺少明确事件机制');
    }

    if (hasVisualHook([visualHook, description].join(' '))) {
        score += 18;
        reasons.push('画面抓手可视化');
    } else {
        reasons.push('画面抓手不足');
    }

    if (dedupeReason.length >= 12) {
        score += 15;
        reasons.push('有排重说明');
    } else {
        reasons.push('排重说明不足');
    }

    if (countHits(joined, VISUAL_TERMS) >= 4) {
        score += 12;
        reasons.push('画面要素充足');
    } else if (countHits(joined, VISUAL_TERMS) >= 2) {
        score += 7;
        reasons.push('画面要素基本可用');
    } else {
        reasons.push('画面要素偏少');
    }

    if (productionAdvice.length >= 10) {
        score += 8;
        reasons.push('制作建议可执行');
    }

    if (riskNote && /真实品牌|机甲|高科技|赛博|大面积英文|枪|军事|血腥/u.test(riskNote)) {
        score -= 12;
        reasons.push('风险备注包含高风险元素');
    } else {
        score += 5;
        reasons.push('风险可控');
    }

    const key = normalizeKey(name);
    if (context.seenNames && key && context.seenNames.has(key)) {
        score -= 25;
        reasons.push('本轮方向名重复');
    }
    if (context.historyNames && key && context.historyNames.has(key)) {
        score -= 20;
        reasons.push('历史方向名重复');
    }

    const historySimilarity = maxHistorySimilarity(extension, context.historyItems);
    const multiplier = diversityPenaltyMultiplier(context.diversityMode);
    if (historySimilarity.name >= 0.85) {
        score -= Math.round(18 * multiplier);
        reasons.push('history near-duplicate name');
    } else if (historySimilarity.name >= 0.65) {
        score -= Math.round(10 * multiplier);
        reasons.push('history similar name');
    }
    if (historySimilarity.mechanism >= 0.62) {
        score -= Math.round(16 * multiplier);
        reasons.push('history near-duplicate visual mechanism');
    } else if (historySimilarity.mechanism >= 0.45) {
        score -= Math.round(8 * multiplier);
        reasons.push('history similar visual mechanism');
    }

    const dnaAssessment = buildDnaAssessment(extension, context);
    const hasExplicitDna = Boolean(
        context.visualDnaPreference
        || hasMeaningfulDnaObject(extension.visualDna)
        || hasMeaningfulDnaObject(extension.dimensions)
    );
    const dnaCompletenessScore = hasExplicitDna && dnaAssessment.completeness >= 4
        ? 4
        : (hasExplicitDna && dnaAssessment.completeness >= 2 ? 2 : 0);
    if (hasExplicitDna) {
        score += dnaCompletenessScore;
        if (dnaAssessment.completeness >= 4) {
            reasons.push('DNA完整度高');
        } else if (dnaAssessment.completeness >= 2) {
            reasons.push('DNA基本可用');
        } else {
            reasons.push('DNA维度缺失');
        }

        if (dnaAssessment.isDiverseInCurrentPool) {
            score += 2;
            reasons.push('DNA组合有差异');
        } else if (dnaAssessment.comboKey) {
            score -= Math.round(6 * multiplier);
            reasons.push('本轮DNA组合重复');
        }

        if (dnaAssessment.preferenceMatchCount > 0) {
            score += Math.min(12, dnaAssessment.preferenceMatchCount * 4);
            reasons.push('匹配高采纳DNA');
        }

        if (dnaAssessment.isHistoricalRepeat) {
            score -= Math.round(12 * multiplier);
            reasons.push('历史DNA组合重复');
        }

        if (dnaAssessment.riskHits.length) {
            score -= Math.round(10 * multiplier);
            reasons.push('命中风险DNA');
        }
    }

    const tagAssessment = buildTagAssessment(extension, context);
    const hasTagSignal = Boolean(
        context.directionTagPreference
        || safeArray(extension.directionTags).length
        || safeArray(extension.mainTags).length
        || safeArray(extension.extraTags).length
        || tagAssessment.tags.length
    );
    const tagCompletenessScore = tagAssessment.completeness >= 5
        ? 5
        : (tagAssessment.completeness >= 3 ? 3 : (tagAssessment.completeness >= 1 ? 1 : -3));
    const tagNoveltyScore = tagAssessment.comboKey
        ? (tagAssessment.isDiverseInCurrentPool ? 2 : -Math.round(4 * multiplier))
        : 0;
    const highMatchScore = Math.min(8, tagAssessment.highTagMatches.length * (context.tagStrategy === 'explore' ? 1 : 2));
    const gapMatchScore = Math.min(6, tagAssessment.gapTagMatches.length * (context.tagStrategy === 'explore' ? 3 : 1));
    const repeatPenalty = tagAssessment.isHistoricalRepeat || tagAssessment.isRepeatedPreferredCombo
        ? -Math.round(10 * multiplier)
        : 0;
    const tagRiskPenalty = tagAssessment.riskHits.length
        ? -Math.round((8 + Math.min(8, tagAssessment.riskHits.length * 2)) * multiplier)
        : 0;
    if (hasTagSignal) {
        score += tagCompletenessScore + tagNoveltyScore + highMatchScore + gapMatchScore + repeatPenalty + tagRiskPenalty;
        if (tagAssessment.completeness >= 3) {
            reasons.push('direction tags complete');
        } else if (tagAssessment.completeness > 0) {
            reasons.push('direction tags sparse');
        } else {
            reasons.push('direction tags missing');
        }
        if (tagAssessment.highTagMatches.length) reasons.push('matches high-performing tags');
        if (tagAssessment.gapTagMatches.length) reasons.push('covers gap tags');
        if (tagNoveltyScore > 0) reasons.push('tag combo is new in current pool');
        if (tagNoveltyScore < 0) reasons.push('tag combo repeats in current pool');
        if (repeatPenalty < 0) reasons.push('tag combo repeats in history');
        if (tagRiskPenalty < 0) reasons.push('hits risk tags');
    }

    return {
        score: Math.max(0, Math.min(100, score)),
        reasons,
        summary: compactReason(reasons),
        historySimilarity,
        dnaAssessment,
        dnaScore: {
            completeness: dnaCompletenessScore,
            diversity: hasExplicitDna ? (dnaAssessment.isDiverseInCurrentPool ? 2 : (dnaAssessment.comboKey ? -6 : 0)) : 0,
            preferenceMatch: hasExplicitDna ? Math.min(12, dnaAssessment.preferenceMatchCount * 4) : 0,
            historicalRepeatPenalty: hasExplicitDna && dnaAssessment.isHistoricalRepeat ? -12 : 0,
            riskPenalty: hasExplicitDna && dnaAssessment.riskHits.length ? -10 : 0
        },
        tagAssessment,
        tagScore: {
            completeness: hasTagSignal ? tagCompletenessScore : 0,
            novelty: hasTagSignal ? tagNoveltyScore : 0,
            highPerformanceMatch: hasTagSignal ? highMatchScore : 0,
            gapCoverage: hasTagSignal ? gapMatchScore : 0,
            repeatPenalty: hasTagSignal ? repeatPenalty : 0,
            riskPenalty: hasTagSignal ? tagRiskPenalty : 0
        }
    };
}

function extensionGroupKey(item = {}) {
    return [
        item.sourceDirectionId,
        item.sourceDirectionPath,
        item.extensionKey,
        item.extensionName,
        item.newDirectionName,
        item.direction
    ].map(normalizeKey).filter(Boolean).join('::') || `extension::${hashPlanText(item.prompt || JSON.stringify(item))}`;
}

function rawTagList(values = [], limit = 8) {
    const seen = new Set();
    const output = [];
    safeArray(values).flat().forEach(value => {
        const text = normalizeText(value);
        const key = normalizeKey(text);
        if (!text || !key || seen.has(key)) return;
        seen.add(key);
        output.push(text);
    });
    return output.slice(0, limit);
}

function normalizeExtensionFromPrompts(items = [], selected = {}) {
    const first = items[0] || {};
    const direction = selected && selected.direction ? selected.direction : {};
    const name = normalizeText(first.extensionName || first.newDirectionName || first.direction || first.contentTitle);
    const directionTags = rawTagList(items.flatMap(item => safeArray(item.directionTags)), 8);
    const mainTags = rawTagList(items.flatMap(item => safeArray(item.mainTags)), 5);
    const extraTags = rawTagList(items.flatMap(item => safeArray(item.extraTags)), 8);
    const riskTags = rawTagList(items.flatMap(item => safeArray(item.riskTags)), 6);
    return {
        sourceDirectionId: normalizeText(first.sourceDirectionId || direction.id),
        sourceDirectionPath: normalizeText(first.sourceDirectionPath || direction.path),
        extensionKey: normalizeText(first.extensionKey || first.promptTitle || name),
        extensionType: normalizeText(first.extensionType || first.type || 'candidate'),
        name,
        description: normalizeText(first.extensionDescription || first.directionDescription || first.description),
        visualHook: normalizeText(first.visualHook || first.hook),
        dedupeReason: normalizeText(first.dedupeReason || first.dedupReason || first.reason),
        riskNote: normalizeText(first.riskNote || first.qualityRisk || first.duplicateRisk),
        productionAdvice: normalizeText(first.productionAdvice || first.sourceStrategy),
        directionTags,
        mainTags,
        extraTags,
        riskTags,
        dimensions: first.dimensions || {},
        visualDna: first.visualDna || {},
        prompts: items
    };
}

function buildExtensionsFromPrompts(prompts = [], selected = {}) {
    const groups = new Map();
    safeArray(prompts).forEach(item => {
        const key = extensionGroupKey(item);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(item);
    });
    return Array.from(groups.values()).map(items => normalizeExtensionFromPrompts(items, selected));
}

function normalizeExtensionFromPlan(extension = {}, plan = {}, selected = {}) {
    const direction = selected && selected.direction ? selected.direction : {};
    const name = normalizeText(extension.name || extension.extensionName || extension.newDirectionName || extension.direction || extension.label);
    const sourceDirectionPath = normalizeText(
        extension.sourceDirectionPath ||
        extension.sourcePath ||
        plan.sourceDirectionPath ||
        plan.sourcePath ||
        direction.path
    );
    return {
        sourceDirectionId: normalizeText(extension.sourceDirectionId || plan.sourceDirectionId || direction.id),
        sourceDirectionPath,
        extensionKey: normalizeText(extension.extensionKey || extension.key || name),
        extensionType: normalizeText(extension.extensionType || extension.type || 'candidate'),
        name,
        description: normalizeText(extension.description || extension.directionDescription),
        visualHook: normalizeText(extension.visualHook || extension.hook || extension.pictureHook),
        dedupeReason: normalizeText(extension.dedupeReason || extension.dedupReason || extension.reason),
        riskNote: normalizeText(extension.riskNote || extension.qualityRisk || extension.duplicateRisk),
        productionAdvice: normalizeText(extension.productionAdvice || extension.makingAdvice || extension.sourceStrategy),
        dimensions: extension.dimensions || {},
        prompts: safeArray(extension.prompts),
        promptPair: safeArray(extension.promptPair),
        currentJudgment: normalizeText(plan.currentJudgment || plan.judgment),
        exclusionSummary: normalizeText(plan.exclusionSummary || plan.dedupeSummary)
    };
}

function buildExtensionsFromDirectionPlans(directionPlans = [], selected = {}) {
    return safeArray(directionPlans).flatMap(plan => {
        const extensions = safeArray(plan && plan.extensions);
        return extensions.map(extension => normalizeExtensionFromPlan(extension, plan, selected));
    });
}

function buildHistoryNameSet(historyUsage = null) {
    const names = new Set();
    safeArray(historyUsage && historyUsage.directionSamples).forEach(sample => {
        const key = normalizeKey(sample && sample.newDirectionName);
        if (key) names.add(key);
    });
    return names;
}

function buildHistoryItems(historyUsage = null, payload = {}, config = {}) {
    const fromPayload = payload.directionPlanning || {};
    const fromConfig = config.directionPlanning || {};
    return safeArray(historyUsage && historyUsage.directionSamples)
        .concat(safeArray(historyUsage && historyUsage.directionExpansionHistory))
        .concat(safeArray(historyUsage && historyUsage.expansionHistory))
        .concat(safeArray(fromPayload.historyEntries))
        .concat(safeArray(fromConfig.historyEntries))
        .filter(item => item && typeof item === 'object');
}

function selectExtensionsCore({ extensions, prompts = [], selected = {}, payload = {}, config = {}, historyUsage = null }) {
    const planConfig = buildDirectionPlanConfig(payload, config);
    const targetExtensionCount = planConfig.selectedExtensionsPerSource;
    const targetCandidateCount = planConfig.candidateExtensionsPerSource;
    const seenNames = new Set();
    const historyNames = buildHistoryNameSet(historyUsage);
    const historyItems = buildHistoryItems(historyUsage, payload, config);
    const visualDnaPreference = (payload.directionPlanning && payload.directionPlanning.visualDnaPreference)
        || (config.directionPlanning && config.directionPlanning.visualDnaPreference)
        || selected.visualDnaPreferenceContext
        || (selected.directionSystemContext && selected.directionSystemContext.visualDnaPreferenceContext)
        || null;
    const directionTagPreference = (payload.directionPlanning && payload.directionPlanning.directionTagPreference)
        || (config.directionPlanning && config.directionPlanning.directionTagPreference)
        || selected.directionTagPreferenceContext
        || (selected.directionSystemContext && selected.directionSystemContext.directionTagPreferenceContext)
        || null;
    const historyDnaCombos = buildHistoricalDnaCombos(historyItems);
    const historyTagCombos = buildHistoricalTagCombos(historyItems);
    const seenDnaCombos = new Set();
    const seenTagCombos = new Set();
    const scored = extensions.map((extension, index) => {
        const score = scoreDirectionExtension(extension, {
            seenNames,
            historyNames,
            historyItems,
            diversityMode: planConfig.diversityMode,
            visualDnaPreference,
            historyDnaCombos,
            seenDnaCombos,
            directionTagPreference,
            historyTagCombos,
            seenTagCombos,
            tagStrategy: planConfig.tagStrategy
        });
        const nameKey = normalizeKey(extension.name);
        if (nameKey) seenNames.add(nameKey);
        const comboKey = score.dnaAssessment && score.dnaAssessment.comboKey;
        if (comboKey) seenDnaCombos.add(comboKey);
        const tagCombo = score.tagAssessment && score.tagAssessment.comboKey;
        if (tagCombo) seenTagCombos.add(tagCombo);
        return {
            ...extension,
            index: index + 1,
            score: score.score,
            scoreReasons: score.reasons,
            scoreSummary: score.summary,
            historySimilarity: score.historySimilarity,
            dnaAssessment: score.dnaAssessment,
            dnaScore: score.dnaScore,
            tagAssessment: score.tagAssessment,
            tagScore: score.tagScore,
            promptCount: safeArray(extension.prompts).length
        };
    });

    const sorted = scored.slice().sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.index - b.index;
    });
    const strong = sorted.filter(item => item.score >= planConfig.minScore);
    const qualifiedExtensionCount = strong.length;
    const hasEnoughQualifiedExtensions = qualifiedExtensionCount >= targetExtensionCount;
    const fallbackLowScoreUsed = !hasEnoughQualifiedExtensions;
    const selectedExtensions = (hasEnoughQualifiedExtensions ? strong : sorted)
        .slice(0, targetExtensionCount);
    const selectedBelowMinScoreCount = selectedExtensions
        .filter(item => item.score < planConfig.minScore)
        .length;
    const candidatePoolComplete = scored.length >= targetCandidateCount;
    const selectedKeys = new Set(selectedExtensions.map(item => `${item.index}:${normalizeKey(item.name)}`));
    const rejectedExtensions = scored
        .filter(item => !selectedKeys.has(`${item.index}:${normalizeKey(item.name)}`))
        .map(item => ({
            ...directionTagsForOutput(item),
            name: item.name,
            extensionKey: item.extensionKey,
            score: item.score,
            reason: item.scoreSummary,
            tagAssessment: item.tagAssessment,
            tagScore: item.tagScore
        }));
    const selectedPrompts = [];
    selectedExtensions.forEach(extension => {
        const directionTagSummary = directionTagsForOutput(extension);
        safeArray(extension.prompts)
            .slice(0, planConfig.promptsPerExtension)
            .forEach(item => {
                selectedPrompts.push({
                    ...item,
                    directionPlanScore: extension.score,
                    directionPlanScoreSummary: extension.scoreSummary,
                    extensionType: extension.extensionType,
                    extensionName: extension.name,
                    extensionDescription: extension.description,
                    visualHook: extension.visualHook,
                    dedupeReason: extension.dedupeReason,
                    riskNote: extension.riskNote,
                    productionAdvice: extension.productionAdvice,
                    directionTags: directionTagSummary.tags,
                    riskTags: directionTagSummary.riskTags,
                    mainTags: safeArray(extension.mainTags),
                    extraTags: safeArray(extension.extraTags),
                    dimensions: extension.dimensions || item.dimensions || {},
                    visualDna: extension.dnaAssessment && extension.dnaAssessment.dna
                });
            });
    });

    return {
        prompts: selectedPrompts.map((item, index) => ({
            ...item,
            index: index + 1
        })),
        selectedExtensions,
        directionPlanReport: {
            success: selectedExtensions.length > 0,
            checkedAt: new Date().toISOString(),
            config: planConfig,
            targetCandidateExtensionCount: targetCandidateCount,
            targetSelectedExtensionCount: targetExtensionCount,
            candidateExtensionCount: scored.length,
            qualifiedExtensionCount,
            selectedExtensionCount: selectedExtensions.length,
            selectedBelowMinScoreCount,
            rejectedExtensionCount: rejectedExtensions.length,
            candidatePromptCount: safeArray(prompts).length,
            selectedPromptCount: selectedPrompts.length,
            historicalExpansionCount: historyItems.length,
            candidatePoolComplete,
            needsRepair: !candidatePoolComplete || !hasEnoughQualifiedExtensions,
            fallbackLowScoreUsed,
            selectedExtensions: selectedExtensions.map(item => ({
                ...directionTagsForOutput(item),
                name: item.name,
                extensionKey: item.extensionKey,
                extensionType: item.extensionType,
                score: item.score,
                scoreSummary: item.scoreSummary,
                historySimilarity: item.historySimilarity,
                dnaAssessment: item.dnaAssessment,
                dnaScore: item.dnaScore,
                tagAssessment: item.tagAssessment,
                tagScore: item.tagScore,
                mainTags: safeArray(item.mainTags),
                extraTags: safeArray(item.extraTags),
                visualHook: item.visualHook,
                dedupeReason: item.dedupeReason,
                riskNote: item.riskNote,
                productionAdvice: item.productionAdvice,
                promptCount: Math.min(planConfig.promptsPerExtension, item.promptCount)
            })),
            lowScoreSelectedExtensions: selectedExtensions
                .filter(item => item.score < planConfig.minScore)
                .map(item => ({
                    ...directionTagsForOutput(item),
                    name: item.name,
                    extensionKey: item.extensionKey,
                    score: item.score,
                    reason: item.scoreSummary,
                    tagAssessment: item.tagAssessment,
                    tagScore: item.tagScore
                })),
            rejectedExtensions: rejectedExtensions.map(item => ({
                ...item
            })),
            summary: `方向规划目标候选 ${targetCandidateCount} 个，实际候选 ${scored.length} 个，70分以上 ${qualifiedExtensionCount} 个，入选 ${selectedExtensions.length} 个，输出 ${selectedPrompts.length} 条 prompt${fallbackLowScoreUsed ? '，低分兜底' : ''}`
        }
    };
}

function selectDirectionExtensions({ prompts, selected, payload = {}, config = {}, historyUsage = null }) {
    return selectExtensionsCore({
        extensions: buildExtensionsFromPrompts(prompts, selected),
        prompts,
        selected,
        payload,
        config,
        historyUsage
    });
}

function selectDirectionPlanExtensions({ directionPlans, selected, payload = {}, config = {}, historyUsage = null }) {
    return selectExtensionsCore({
        extensions: buildExtensionsFromDirectionPlans(directionPlans, selected),
        prompts: [],
        selected,
        payload,
        config,
        historyUsage
    });
}

module.exports = {
    DEFAULT_DIRECTION_PLAN_CONFIG,
    buildDirectionPlanConfig,
    scoreDirectionExtension,
    selectDirectionExtensions,
    selectDirectionPlanExtensions
};
