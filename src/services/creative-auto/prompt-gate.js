const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
    buildCreativeAgentQualityReport,
    sanitizePromptText
} = require('../../../creative-agent-quality');

const DEFAULT_FORBIDDEN_TERMS = [
    '真实品牌',
    '品牌 logo',
    '品牌logo',
    '大面积英文',
    '赛博',
    '高科技 UI',
    '高科技UI',
    '悬浮设备',
    '机甲',
    '激光界面'
];

const SOFT_RISK_TERM_PATTERNS = [
    /可能/u,
    /风险/u,
    /落差/u,
    /同质化/u,
    /疲劳/u,
    /转化/u,
    /情绪/u,
    /共鸣/u,
    /代入/u,
    /不足/u,
    /压抑/u,
    /敏感/u,
    /注意/u,
    /警惕/u,
    /影响/u,
    /误解/u,
    /接受度/u,
    /关联/u,
    /玩法/u,
    /用户/u,
    /受众/u,
    /点击/u,
    /吸引/u,
    /信息量/u,
    /承诺/u,
    /实际/u,
    /主线/u,
    /目标/u,
    /审美/u
];

const SOFT_RISK_TERMS = new Set([
    '冲突',
    '冲突点',
    '危机感',
    '冷色调',
    '末日题材',
    '主角背影',
    '场景单一',
    '互动感',
    '情感共鸣',
    '代入感'
]);

function safeArray(value) {
    return Array.isArray(value) ? value : [];
}

function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function firstNonEmpty(...values) {
    for (const value of values) {
        const text = normalizeText(value);
        if (text) {
            return text;
        }
    }
    return '';
}

function normalizePromptKey(text) {
    return sanitizePromptText(text)
        .replace(/[，。！？；：、,.!?;:\s"'“”‘’（）()[\]{}【】《》<>]/g, '')
        .toLowerCase();
}

function hashPrompt(text) {
    return crypto.createHash('sha1').update(normalizePromptKey(text)).digest('hex').slice(0, 16);
}

function normalizeTitleKey(text) {
    return normalizeText(text)
        .replace(/[，。！？；：、,.!?;:\s"'“”‘’（）()[\]{}【】《》<>]/g, '')
        .toLowerCase();
}

function normalizeSourceDirectionKey(value) {
    return normalizeTitleKey(value);
}

function historyDirectionKey(sourceKey, directionNameKey) {
    return `${sourceKey || 'global'}::${directionNameKey}`;
}

function candidateSourceDirectionKeys(item = {}, selectedDirection = {}) {
    return Array.from(new Set([
        item.sourceDirectionId,
        item.sourceDirectionPath,
        item.directionId,
        item.directionPath,
        selectedDirection.id,
        selectedDirection.path
    ].map(normalizeSourceDirectionKey).filter(Boolean)));
}

function splitForbiddenRule(rule) {
    const cleaned = normalizeText(rule)
        .replace(/^[-*•\s]+/, '')
        .replace(/^(不要|禁止|避免|必须避开|不允许|请勿|勿)\s*/, '')
        .replace(/默认加入|主动加入|使用|出现|加入/g, '');

    return cleaned
        .split(/[，,、；;\/|]|\s或\s|\s和\s|\s以及\s|或|和|以及/g)
        .map(item => normalizeText(item)
            .replace(/^(不要|禁止|避免|必须避开|不允许|请勿|勿)\s*/, '')
            .replace(/^(默认|主动)?(加入|使用|出现)\s*/, '')
            .replace(/[。.!！?？]+$/g, '')
            .trim())
        .filter(item => item.length >= 2);
}

function isHardForbiddenTerm(term) {
    const text = normalizeText(term);
    if (!text) return false;
    const defaultTerms = new Set(DEFAULT_FORBIDDEN_TERMS.map(normalizeText));
    if (defaultTerms.has(text)) return true;
    if (SOFT_RISK_TERMS.has(text)) return false;
    if (text.length <= 4 && SOFT_RISK_TERM_PATTERNS.some(pattern => pattern.test(text))) return false;
    return true;
}

function normalizeForMatch(value) {
    return normalizeText(value)
        .toLowerCase()
        .replace(/[\\/_\-\s.()[\]{}【】（）]/g, '');
}

function directionMatchScore(direction = {}, targetPath = '') {
    const directionText = normalizeForMatch([
        direction.path,
        direction.name,
        direction.id,
        safeArray(direction.memberDirectionPaths).join('/'),
        safeArray(direction.memberDirectionIds).join('/')
    ].filter(Boolean).join('/'));
    const target = normalizeForMatch(targetPath);
    if (!directionText || !target) return 0;
    if (directionText === target) return 100;
    if (directionText.includes(target) || target.includes(directionText)) return 80;
    return String(targetPath || '')
        .split('/')
        .map(normalizeForMatch)
        .filter(Boolean)
        .reduce((score, part) => score + (directionText.includes(part) ? 12 : 0), 0);
}

function memoryRuleAppliesToDirection(rule = {}, direction = {}) {
    if (!rule || rule.enabled === false || rule.status === 'disabled') return false;
    if (rule.type !== 'avoid') return false;
    if (rule.scope === 'global') return true;
    if (rule.scope === 'node' || rule.scope === 'dimension') {
        return directionMatchScore(direction, rule.target || '') >= 36;
    }
    return false;
}

function buildMemoryAvoidRules(memoryRules = [], direction = {}) {
    return safeArray(memoryRules)
        .filter(rule => memoryRuleAppliesToDirection(rule, direction))
        .map(rule => {
            const terms = splitForbiddenRule(rule.pattern || rule.rationale || rule.action)
                .filter(term => term.length >= 2);
            return {
                ruleId: rule.ruleId || '',
                title: rule.title || '素材分析避坑规则',
                target: rule.target || '',
                pattern: rule.pattern || '',
                action: rule.action || '',
                source: rule.source || '',
                terms
            };
        })
        .filter(rule => rule.terms.length);
}

function findMemoryAvoidRule(prompt, rules = []) {
    const normalizedPrompt = normalizeText(prompt).toLowerCase();
    for (const rule of rules) {
        const term = safeArray(rule.terms).find(item => {
            const normalizedTerm = normalizeText(item).toLowerCase();
            return normalizedTerm && normalizedPrompt.includes(normalizedTerm);
        });
        if (term) {
            return {
                ...rule,
                matchedTerm: term
            };
        }
    }
    return null;
}

const FORBIDDEN_SECTION_LABELS = new Set([
    '\u907f\u5751',
    '\u6ce8\u610f',
    '\u98ce\u9669'
]);

function splitRuleSections(rule) {
    const text = normalizeText(rule);
    const sectionPattern = /(\u5fc5\u987b\u4fdd\u7559|\u53ef\u53d8\u5316\u8f74|\u53d8\u5316\u8f74|\u4fdd\u7559|\u8fed\u4ee3|\u907f\u5751|\u6ce8\u610f|\u98ce\u9669|\u6295\u653e\u52a8\u4f5c|\u5efa\u8bae)\s*[:\uff1a]/gu;
    const matches = Array.from(text.matchAll(sectionPattern));
    if (!matches.length) {
        return [text];
    }

    return matches
        .map((match, index) => {
            const label = match[1];
            const start = match.index + match[0].length;
            const end = index + 1 < matches.length ? matches[index + 1].index : text.length;
            return {
                label,
                text: normalizeText(text.slice(start, end)).replace(/^[\u3002\uff0c\uff1b;,\s]+|[\u3002\uff0c\uff1b;,\s]+$/g, '')
            };
        })
        .filter(section => FORBIDDEN_SECTION_LABELS.has(section.label))
        .map(section => section.text)
        .filter(Boolean);
}

function buildForbiddenTerms({ direction, payload = {}, config = {} }) {
    const terms = new Set();
    DEFAULT_FORBIDDEN_TERMS.forEach(term => terms.add(term));

    const configuredRules = safeArray(config.forbiddenRules)
        .concat(safeArray(config.mustAvoid))
        .concat(safeArray(config.forbiddenTerms));
    const payloadRules = safeArray(payload.forbiddenRules)
        .concat(safeArray(payload.mustAvoid));
    const directionRule = direction && direction.mustAvoid ? [direction.mustAvoid] : [];

    configuredRules
        .concat(payloadRules)
        .concat(directionRule)
        .forEach(rule => {
            splitRuleSections(rule).forEach(section => {
                splitForbiddenRule(section)
                    .filter(isHardForbiddenTerm)
                    .forEach(term => terms.add(term));
            });
        });

    return Array.from(terms)
        .map(normalizeText)
        .filter(Boolean)
        .sort((a, b) => b.length - a.length);
}

function findForbiddenTerm(prompt, forbiddenTerms) {
    const normalizedPrompt = normalizeText(prompt).toLowerCase();
    return forbiddenTerms.find(term => {
        if (!isHardForbiddenTerm(term)) return false;
        const normalizedTerm = normalizeText(term).toLowerCase();
        return normalizedTerm && normalizedPrompt.includes(normalizedTerm);
    }) || '';
}

function compactPromptItem(item, reason, message) {
    return {
        index: Number(item && item.index) || 0,
        sourceRow: item && item.sourceRow ? item.sourceRow : '',
        direction: normalizeText(item && item.direction).slice(0, 120),
        newDirectionName: normalizeText(item && item.newDirectionName).slice(0, 120),
        promptTitle: normalizeText(item && item.promptTitle).slice(0, 80),
        translationVersion: item && item.translationVersion ? item.translationVersion : '',
        promptSchemaVersion: item && item.promptSchemaVersion ? item.promptSchemaVersion : '',
        promptHash: item && item.promptHash ? item.promptHash : hashPrompt(item && item.prompt),
        reason,
        message
    };
}

function readJsonFile(filePath, fallback) {
    if (!fs.existsSync(filePath)) {
        return fallback;
    }

    try {
        const text = fs.readFileSync(filePath, 'utf8');
        return text.trim() ? JSON.parse(text) : fallback;
    } catch {
        return fallback;
    }
}

function collectPromptFromObject(value, prompts) {
    if (!value || typeof value !== 'object') {
        return;
    }

    ['prompt', 'finalPrompt', 'promptText', 'sourcePrompt'].forEach(key => {
        if (value[key]) {
            prompts.push(value[key]);
        }
    });

    if (value.promptItem && typeof value.promptItem === 'object') {
        collectPromptFromObject(value.promptItem, prompts);
    }
}

function collectCreativeUsageFromObject(value, usage, meta = {}) {
    if (!value || typeof value !== 'object') {
        return;
    }

    ['prompt', 'finalPrompt', 'promptText', 'sourcePrompt'].forEach(key => {
        if (!value[key]) {
            return;
        }
        const promptText = value[key];
        const promptKey = normalizePromptKey(promptText);
        if (promptKey) {
            usage.promptKeys.add(promptKey);
        }
        if (usage.promptSamples.length < usage.maxPromptSamples) {
            usage.promptSamples.push({
                runId: meta.runId || value.runId || '',
                source: meta.source || '',
                sourceDirectionId: firstNonEmpty(value.sourceDirectionId, value.directionId, meta.sourceDirectionId),
                sourceDirectionPath: firstNonEmpty(value.sourceDirectionPath, value.directionPath, meta.sourceDirectionPath),
                newDirectionName: firstNonEmpty(value.newDirectionName, value.directionName, value.direction, value.contentTitle),
                prompt: normalizeText(promptText).slice(0, 220)
            });
        }
    });

    const directionName = firstNonEmpty(
        value.newDirectionName,
        value.directionName,
        value.direction,
        value.contentTitle
    );
    const directionNameKey = normalizeTitleKey(directionName);
    if (directionNameKey) {
        const sourceKeys = candidateSourceDirectionKeys(value, {});
        (sourceKeys.length ? sourceKeys : ['global']).forEach(sourceKey => {
            usage.directionKeys.add(historyDirectionKey(sourceKey, directionNameKey));
        });
        if (usage.directionSamples.length < usage.maxDirectionSamples) {
            usage.directionSamples.push({
                runId: meta.runId || value.runId || '',
                source: meta.source || '',
                sourceDirectionId: firstNonEmpty(value.sourceDirectionId, value.directionId, meta.sourceDirectionId),
                sourceDirectionPath: firstNonEmpty(value.sourceDirectionPath, value.directionPath, meta.sourceDirectionPath),
                newDirectionName: directionName,
                promptTitle: firstNonEmpty(value.promptTitle, value.title)
            });
        }
    }

    if (value.promptItem && typeof value.promptItem === 'object') {
        collectCreativeUsageFromObject(value.promptItem, usage, meta);
    }
}

function collectHistoricalCreativeUsage(store, currentRunId = '', options = {}) {
    const usage = {
        promptKeys: new Set(),
        directionKeys: new Set(),
        promptSamples: [],
        directionSamples: [],
        maxPromptSamples: Math.max(1, Number(options.maxPromptSamples) || 80),
        maxDirectionSamples: Math.max(1, Number(options.maxDirectionSamples) || 120)
    };
    const runsDir = store.filePath('runs');
    const assetsData = store.read('assets.json', { assets: [] });

    safeArray(assetsData.assets).forEach(asset => {
        collectCreativeUsageFromObject(asset, usage, {
            source: 'asset',
            runId: asset && asset.runId
        });
    });

    if (fs.existsSync(runsDir)) {
        fs.readdirSync(runsDir)
            .filter(fileName => fileName.endsWith('.json'))
            .filter(fileName => fileName !== `${currentRunId}.json`)
            .forEach(fileName => {
                const run = readJsonFile(path.join(runsDir, fileName), null);
                const sourceDirection = run && run.sourceDirection ? run.sourceDirection : {};
                const runSource = {
                    runId: run && run.runId,
                    sourceDirectionId: sourceDirection.id,
                    sourceDirectionPath: sourceDirection.path
                };
                safeArray(run && run.prompts).forEach(item => collectCreativeUsageFromObject({
                    sourceDirectionId: sourceDirection.id,
                    sourceDirectionPath: sourceDirection.path,
                    ...(item || {})
                }, usage, {
                    ...runSource,
                    source: 'run-prompt'
                }));
                safeArray(run && run.directionDefinitions).forEach(item => collectCreativeUsageFromObject({
                    sourceDirectionId: sourceDirection.id,
                    sourceDirectionPath: sourceDirection.path,
                    ...(item || {})
                }, usage, {
                    ...runSource,
                    source: 'run-direction'
                }));
            });
    }

    return usage;
}

function collectHistoryPromptKeys(store, currentRunId = '') {
    return collectHistoricalCreativeUsage(store, currentRunId).promptKeys;
}

function sampleMatchesSelectedDirection(sample = {}, selectedDirection = {}) {
    const selectedKeys = candidateSourceDirectionKeys({}, selectedDirection);
    if (!selectedKeys.length) return true;
    const sampleKeys = candidateSourceDirectionKeys(sample, {});
    if (!sampleKeys.length) return true;
    return sampleKeys.some(key => selectedKeys.includes(key));
}

function summarizeHistoricalCreativeUsage({ store, selectedDirection = {}, currentRunId = '', maxDirections = 24, maxPrompts = 10 } = {}) {
    const usage = collectHistoricalCreativeUsage(store, currentRunId, {
        maxDirectionSamples: Math.max(120, maxDirections * 4),
        maxPromptSamples: Math.max(80, maxPrompts * 4)
    });
    const directionNames = [];
    const seenDirectionNames = new Set();
    usage.directionSamples
        .filter(sample => sampleMatchesSelectedDirection(sample, selectedDirection))
        .forEach(sample => {
            const key = normalizeTitleKey(sample.newDirectionName);
            if (!key || seenDirectionNames.has(key) || directionNames.length >= maxDirections) {
                return;
            }
            seenDirectionNames.add(key);
            directionNames.push(sample.newDirectionName);
        });

    const promptSnippets = [];
    const seenPromptSnippets = new Set();
    usage.promptSamples
        .filter(sample => sampleMatchesSelectedDirection(sample, selectedDirection))
        .forEach(sample => {
            const key = normalizePromptKey(sample.prompt);
            if (!key || seenPromptSnippets.has(key) || promptSnippets.length >= maxPrompts) {
                return;
            }
            seenPromptSnippets.add(key);
            promptSnippets.push({
                newDirectionName: sample.newDirectionName || '',
                prompt: sample.prompt
            });
        });

    return {
        promptHistoryCount: usage.promptKeys.size,
        directionHistoryCount: usage.directionKeys.size,
        matchedDirectionNameCount: directionNames.length,
        matchedPromptSnippetCount: promptSnippets.length,
        directionNames,
        promptSnippets
    };
}

function summarizeRejections(rejectedPrompts) {
    return rejectedPrompts.reduce((summary, item) => {
        summary[item.reason] = (summary[item.reason] || 0) + 1;
        return summary;
    }, {});
}

function indexQualityErrors(qualityReport) {
    const map = new Map();
    safeArray(qualityReport && qualityReport.errors).forEach(issue => {
        const index = Number(issue.index);
        if (!Number.isFinite(index)) {
            return;
        }
        const list = map.get(index) || [];
        list.push(issue);
        map.set(index, list);
    });
    return map;
}

function normalizePromptItems(prompts, selected) {
    const direction = selected && selected.direction ? selected.direction : {};
    return safeArray(prompts).map((item, index) => {
        const prompt = sanitizePromptText(item && (item.finalPrompt || item.prompt));
        const primaryTag = (item && item.primaryTag) || direction.primaryTag || direction.primary || '';
        const secondaryTag = (item && item.secondaryTag) || direction.secondaryTag || direction.secondary || '';
        const tertiaryTag = (item && item.tertiaryTag) || direction.tertiaryTag || direction.tertiary || '';
        return {
            ...(item || {}),
            index: Number(item && item.index) || index + 1,
            prompt,
            finalPrompt: prompt,
            selected: !item || item.selected !== false,
            primaryTag,
            secondaryTag,
            tertiaryTag,
            standardLabelPath: Array.isArray(item && item.standardLabelPath)
                ? item.standardLabelPath
                : [primaryTag, secondaryTag, tertiaryTag].filter(Boolean),
            sourceDirectionId: (item && item.sourceDirectionId) || direction.id || '',
            sourceDirectionPath: (item && item.sourceDirectionPath) || direction.path || '',
            newDirectionName: (item && item.newDirectionName) || (item && item.direction) || '',
            contentTitle: (item && item.contentTitle) || (item && item.newDirectionName) || (item && item.direction) || '',
            outputNameBase: (item && item.outputNameBase) || ''
        };
    });
}

function applyPromptGate({ prompts, selected, quota, store, runId, payload = {}, config = {}, memoryRules = [] }) {
    const normalizedPrompts = normalizePromptItems(prompts, selected);
    const rawPromptCount = safeArray(prompts).length;
    const outputQuantity = Math.max(1, Number(quota && quota.outputQuantity) || 4);
    const unlimitedPrompts = Boolean(quota && quota.unlimitedPrompts);
    const maxPromptsAllowed = unlimitedPrompts
        ? Number.POSITIVE_INFINITY
        : Math.max(0, Number(quota && quota.maxPrompts) || 0);
    const selectedDirection = selected && selected.direction;
    const forbiddenTerms = buildForbiddenTerms({
        direction: selectedDirection,
        payload,
        config
    });
    const memoryAvoidRules = buildMemoryAvoidRules(
        safeArray(memoryRules).concat(safeArray(config.memoryRules)),
        selectedDirection || {}
    );
    const qualityReportRaw = buildCreativeAgentQualityReport(normalizedPrompts);
    const qualityErrorsByIndex = indexQualityErrors(qualityReportRaw);
    const historyUsage = collectHistoricalCreativeUsage(store, runId);
    const historyPromptKeys = historyUsage.promptKeys;
    const currentPromptKeys = new Map();
    const currentTitleKeys = new Map();
    const accepted = [];
    const rejectedPrompts = [];
    const warnings = [];

    normalizedPrompts.forEach(item => {
        const promptKey = normalizePromptKey(item.prompt);
        const titleKey = `${normalizeTitleKey(item.direction)}::${normalizeTitleKey(item.promptTitle)}`;
        const qualityErrors = qualityErrorsByIndex.get(Number(item.index)) || [];
        const forbiddenTerm = findForbiddenTerm(item.prompt, forbiddenTerms);
        const memoryAvoidRule = findMemoryAvoidRule(item.prompt, memoryAvoidRules);
        const directionNameKey = normalizeTitleKey(item.newDirectionName || item.direction || item.contentTitle);
        const matchedHistoryDirectionKey = directionNameKey
            ? candidateSourceDirectionKeys(item, selectedDirection || {}).find(sourceKey => (
                historyUsage.directionKeys.has(historyDirectionKey(sourceKey, directionNameKey))
            ))
            : '';

        if (!promptKey) {
            rejectedPrompts.push(compactPromptItem(item, 'empty_prompt', '提示词为空'));
            return;
        }

        if (forbiddenTerm) {
            rejectedPrompts.push(compactPromptItem(item, 'forbidden_term', `命中禁用元素：${forbiddenTerm}`));
            return;
        }

        if (memoryAvoidRule) {
            rejectedPrompts.push(compactPromptItem(
                item,
                'memory_avoid_rule',
                `命中素材分析避坑规则：${memoryAvoidRule.title}（${memoryAvoidRule.matchedTerm}）`
            ));
            return;
        }

        if (qualityErrors.length) {
            rejectedPrompts.push(compactPromptItem(
                item,
                'quality_error',
                qualityErrors.map(issue => issue.message).join('；')
            ));
            return;
        }

        if (matchedHistoryDirectionKey || (directionNameKey && historyUsage.directionKeys.has(historyDirectionKey('global', directionNameKey)))) {
            rejectedPrompts.push(compactPromptItem(
                item,
                'duplicate_history_direction',
                '与历史 run 或已生成资产中的新方向名称重复'
            ));
            return;
        }

        if (currentPromptKeys.has(promptKey)) {
            rejectedPrompts.push(compactPromptItem(
                item,
                'duplicate_current_prompt',
                `与本轮第 ${currentPromptKeys.get(promptKey)} 条 prompt 重复`
            ));
            return;
        }

        if (historyPromptKeys.has(promptKey)) {
            rejectedPrompts.push(compactPromptItem(item, 'duplicate_history_prompt', '与历史 run 或资产索引中的 prompt 重复'));
            return;
        }

        if (titleKey !== '::' && currentTitleKeys.has(titleKey)) {
            rejectedPrompts.push(compactPromptItem(
                item,
                'duplicate_current_title',
                `与本轮第 ${currentTitleKeys.get(titleKey)} 条方向标题和提示词列重复`
            ));
            return;
        }

        if (!unlimitedPrompts && accepted.length >= maxPromptsAllowed) {
            rejectedPrompts.push(compactPromptItem(
                item,
                'quota_limit',
                `超过本轮可提交 prompt 上限 ${maxPromptsAllowed}`
            ));
            return;
        }

        currentPromptKeys.set(promptKey, item.index);
        if (titleKey !== '::') {
            currentTitleKeys.set(titleKey, item.index);
        }

        accepted.push({
            ...item,
            index: accepted.length + 1,
            originalIndex: item.index,
            promptHash: hashPrompt(item.prompt),
            selected: item.selected !== false
        });
    });

    safeArray(qualityReportRaw.warnings).forEach(issue => {
        warnings.push({
            ...issue,
            source: 'creative-agent-quality'
        });
    });
    memoryAvoidRules.slice(0, 8).forEach(rule => {
        warnings.push({
            source: 'material-analysis-memory',
            severity: 'warning',
            ruleId: rule.ruleId,
            message: `Prompt Gate 已加载避坑规则：${rule.title}`,
            target: rule.target,
            terms: rule.terms.slice(0, 5)
        });
    });

    const acceptedQualityReport = buildCreativeAgentQualityReport(accepted);
    const promptQualityReport = {
        success: accepted.length > 0 && acceptedQualityReport.errors.length === 0,
        checkedAt: new Date().toISOString(),
        rawPromptCount,
        candidatePromptCount: normalizedPrompts.length,
        acceptedPromptCount: accepted.length,
        rejectedPromptCount: rejectedPrompts.length,
        expectedImageTotal: accepted.length * outputQuantity,
        dailyRemainingBeforeRun: quota && quota.unlimitedImages ? null : Math.max(0, Number(quota && quota.remainingImagesToday) || 0),
        usedImagesToday: Math.max(0, Number(quota && quota.usedImagesToday) || 0),
        maxImagesPerDay: quota && quota.unlimitedImages ? null : Math.max(0, Number(quota && quota.maxImagesPerDay) || 0),
        outputQuantity,
        maxPromptsAllowed: unlimitedPrompts ? null : maxPromptsAllowed,
        unlimitedPrompts,
        unlimitedImages: Boolean(quota && quota.unlimitedImages),
        rejectionSummary: summarizeRejections(rejectedPrompts),
        warnings,
        rejectedPrompts,
        forbiddenTerms,
        memoryAvoidRules,
        historyPromptKeyCount: historyPromptKeys.size,
        historyDirectionKeyCount: historyUsage.directionKeys.size,
        qualityReportRaw,
        acceptedQualityReport,
        summary: `原始 ${rawPromptCount} 条，接受 ${accepted.length} 条，丢弃 ${rejectedPrompts.length} 条，预计出图 ${accepted.length * outputQuantity} 张`
    };

    return {
        prompts: accepted,
        qualityReport: acceptedQualityReport,
        promptQualityReport
    };
}

module.exports = {
    DEFAULT_FORBIDDEN_TERMS,
    applyPromptGate,
    buildForbiddenTerms,
    collectHistoricalCreativeUsage,
    findForbiddenTerm,
    summarizeHistoricalCreativeUsage,
    normalizePromptKey,
    hashPrompt
};
