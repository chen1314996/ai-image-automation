const crypto = require('crypto');

const DEFAULT_DIRECTION_PLAN_CONFIG = {
    candidateExtensionsPerSource: 8,
    selectedExtensionsPerSource: 4,
    promptsPerExtension: 2,
    minScore: 70,
    preferredScore: 85,
    maxRepairAttempts: 2,
    diversityMode: 'balanced',
    historyScope: 'recent30',
    candidateMultiplier: 2
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

    return {
        score: Math.max(0, Math.min(100, score)),
        reasons,
        summary: compactReason(reasons),
        historySimilarity
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

function normalizeExtensionFromPrompts(items = [], selected = {}) {
    const first = items[0] || {};
    const direction = selected && selected.direction ? selected.direction : {};
    const name = normalizeText(first.extensionName || first.newDirectionName || first.direction || first.contentTitle);
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

function selectExtensionsCore({ extensions, prompts = [], payload = {}, config = {}, historyUsage = null }) {
    const planConfig = buildDirectionPlanConfig(payload, config);
    const targetExtensionCount = planConfig.selectedExtensionsPerSource;
    const targetCandidateCount = planConfig.candidateExtensionsPerSource;
    const seenNames = new Set();
    const historyNames = buildHistoryNameSet(historyUsage);
    const historyItems = buildHistoryItems(historyUsage, payload, config);
    const scored = extensions.map((extension, index) => {
        const score = scoreDirectionExtension(extension, {
            seenNames,
            historyNames,
            historyItems,
            diversityMode: planConfig.diversityMode
        });
        const nameKey = normalizeKey(extension.name);
        if (nameKey) seenNames.add(nameKey);
        return {
            ...extension,
            index: index + 1,
            score: score.score,
            scoreReasons: score.reasons,
            scoreSummary: score.summary,
            historySimilarity: score.historySimilarity,
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
            name: item.name,
            extensionKey: item.extensionKey,
            score: item.score,
            reason: item.scoreSummary
        }));
    const selectedPrompts = [];
    selectedExtensions.forEach(extension => {
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
                    productionAdvice: extension.productionAdvice
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
                name: item.name,
                extensionKey: item.extensionKey,
                extensionType: item.extensionType,
                score: item.score,
                scoreSummary: item.scoreSummary,
                historySimilarity: item.historySimilarity,
                visualHook: item.visualHook,
                dedupeReason: item.dedupeReason,
                riskNote: item.riskNote,
                productionAdvice: item.productionAdvice,
                promptCount: Math.min(planConfig.promptsPerExtension, item.promptCount)
            })),
            lowScoreSelectedExtensions: selectedExtensions
                .filter(item => item.score < planConfig.minScore)
                .map(item => ({
                    name: item.name,
                    extensionKey: item.extensionKey,
                    score: item.score,
                    reason: item.scoreSummary
                })),
            rejectedExtensions,
            summary: `方向规划目标候选 ${targetCandidateCount} 个，实际候选 ${scored.length} 个，70分以上 ${qualifiedExtensionCount} 个，入选 ${selectedExtensions.length} 个，输出 ${selectedPrompts.length} 条 prompt${fallbackLowScoreUsed ? '，低分兜底' : ''}`
        }
    };
}

function selectDirectionExtensions({ prompts, selected, payload = {}, config = {}, historyUsage = null }) {
    return selectExtensionsCore({
        extensions: buildExtensionsFromPrompts(prompts, selected),
        prompts,
        payload,
        config,
        historyUsage
    });
}

function selectDirectionPlanExtensions({ directionPlans, selected, payload = {}, config = {}, historyUsage = null }) {
    return selectExtensionsCore({
        extensions: buildExtensionsFromDirectionPlans(directionPlans, selected),
        prompts: [],
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
