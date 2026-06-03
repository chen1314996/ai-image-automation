const crypto = require('crypto');
const axios = require('axios');

const CREATIVE_MEMORY_VERSION = 1;
const FEEDBACK_LEARNING_VERSION = 's6-feedback-learning-agent-v1';
const FEEDBACK_LEARNING_AGENT_NAME = 'Feedback Learning Agent';

const RULE_SCOPES = new Set(['global', 'dimension', 'node']);
const RULE_TYPES = new Set(['preferred', 'avoid', 'prompt', 'priority', 'style']);
const RULE_STATUSES = new Set(['draft', 'active', 'rejected', 'disabled', 'archived']);

function nowIso() {
    return new Date().toISOString();
}

function safeArray(value) {
    return Array.isArray(value) ? value : [];
}

function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function uniqueStrings(values = []) {
    return Array.from(new Set(safeArray(values)
        .map(value => normalizeText(value))
        .filter(Boolean)));
}

function hashText(text) {
    return crypto.createHash('sha1').update(normalizeText(text)).digest('hex').slice(0, 12);
}

function buildRuleId(rule = {}) {
    return `memory_rule_${hashText([
        rule.scope,
        rule.type,
        rule.target,
        rule.title,
        rule.pattern,
        rule.rationale
    ].join('|'))}`;
}

function buildLearningRunId() {
    return `learning_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
}

function emptyCreativeMemory() {
    return {
        version: CREATIVE_MEMORY_VERSION,
        preferred_patterns: [],
        avoid_patterns: [],
        rules: {
            global: [],
            dimension: {},
            node: {}
        },
        style_calibration: {},
        stats: {
            totalLearningRuns: 0,
            totalDraftRules: 0,
            activeRules: 0,
            rejectedDraftRules: 0,
            lastLearnedAt: ''
        },
        drafts: [],
        learningReports: [],
        updatedAt: nowIso()
    };
}

function normalizeMemory(memory = {}) {
    const fallback = emptyCreativeMemory();
    return {
        ...fallback,
        ...memory,
        version: memory.version || CREATIVE_MEMORY_VERSION,
        preferred_patterns: safeArray(memory.preferred_patterns),
        avoid_patterns: safeArray(memory.avoid_patterns),
        rules: {
            global: safeArray(memory.rules && memory.rules.global),
            dimension: memory.rules && memory.rules.dimension && typeof memory.rules.dimension === 'object' ? memory.rules.dimension : {},
            node: memory.rules && memory.rules.node && typeof memory.rules.node === 'object' ? memory.rules.node : {}
        },
        style_calibration: memory.style_calibration && typeof memory.style_calibration === 'object' ? memory.style_calibration : {},
        stats: {
            ...fallback.stats,
            ...(memory.stats || {})
        },
        drafts: safeArray(memory.drafts),
        learningReports: safeArray(memory.learningReports)
    };
}

function normalizeRule(raw = {}, defaults = {}) {
    const scope = RULE_SCOPES.has(normalizeText(raw.scope)) ? normalizeText(raw.scope) : (defaults.scope || 'global');
    const type = RULE_TYPES.has(normalizeText(raw.type)) ? normalizeText(raw.type) : (defaults.type || 'preferred');
    const target = normalizeText(raw.target || raw.dimension || raw.node || defaults.target);
    const status = RULE_STATUSES.has(normalizeText(raw.status)) ? normalizeText(raw.status) : (defaults.status || 'draft');
    const title = normalizeText(raw.title || raw.name || raw.pattern || defaults.title).slice(0, 120);
    const pattern = normalizeText(raw.pattern || raw.rule || raw.content || raw.text).slice(0, 500);
    const rationale = normalizeText(raw.rationale || raw.reason || raw.why || raw.summary).slice(0, 800);
    const action = normalizeText(raw.action || raw.suggestion || raw.applyAs).slice(0, 500);
    const evidence = safeArray(raw.evidence).map(item => normalizeText(item).slice(0, 300)).filter(Boolean).slice(0, 8);
    const sourceFeedbackIds = uniqueStrings(raw.sourceFeedbackIds || raw.feedbackIds || defaults.sourceFeedbackIds).slice(0, 30);
    const confidence = Math.max(0, Math.min(1, Number(raw.confidence) || Number(defaults.confidence) || 0.65));
    const createdAt = raw.createdAt || defaults.createdAt || nowIso();
    const rule = {
        ruleId: raw.ruleId || buildRuleId({ scope, type, target, title, pattern, rationale }),
        scope,
        type,
        target,
        title: title || (type === 'avoid' ? '规避模式' : '偏好模式'),
        pattern: pattern || title || rationale,
        rationale,
        action,
        confidence,
        evidence,
        sourceFeedbackIds,
        status,
        enabled: raw.enabled !== false && status === 'active',
        createdAt,
        updatedAt: raw.updatedAt || createdAt,
        source: raw.source || FEEDBACK_LEARNING_AGENT_NAME,
        version: raw.version || FEEDBACK_LEARNING_VERSION
    };
    if (rule.status !== 'active') {
        rule.enabled = raw.enabled === true;
    }
    return rule;
}

function compactAssetForLearning(asset = {}, feedback = {}) {
    return {
        feedbackTargetType: feedback.feedbackTargetType || (feedback.directionDraftId ? 'direction-candidate' : (feedback.assetId || asset.assetId ? 'asset' : 'prompt')),
        assetId: asset.assetId || feedback.assetId || '',
        directionDraftId: feedback.directionDraftId || asset.directionDraftId || '',
        runId: asset.runId || feedback.runId || '',
        directionId: asset.directionId || feedback.directionId || '',
        directionPath: asset.directionPath || feedback.directionPath || '',
        directionName: asset.directionName || feedback.directionName || '',
        sourceDirectionId: feedback.sourceDirectionId || asset.sourceDirectionId || asset.directionId || '',
        sourceDirectionPath: feedback.sourceDirectionPath || asset.sourceDirectionPath || asset.directionPath || '',
        sourceDirectionName: feedback.sourceDirectionName || asset.sourceDirectionName || '',
        newDirectionName: feedback.newDirectionName || asset.newDirectionName || asset.promptDirection || feedback.directionName || '',
        promptHash: asset.promptHash || feedback.promptHash || '',
        promptTitle: asset.promptTitle || feedback.promptTitle || '',
        promptDirection: asset.promptDirection || feedback.promptDirection || '',
        prompt: normalizeText(asset.prompt || feedback.prompt).slice(0, 1200),
        reviewStatus: feedback.status || asset.reviewStatus || (asset.review && asset.review.status) || '',
        reviewLabels: uniqueStrings(feedback.labels || asset.reviewLabels || (asset.review && asset.review.labels)),
        reviewNote: normalizeText(feedback.note || asset.reviewNote || (asset.review && asset.review.note)).slice(0, 600),
        targetLevel: feedback.targetLevel || asset.targetLevel || '',
        dimensions: feedback.dimensions && typeof feedback.dimensions === 'object' ? feedback.dimensions : (asset.dimensions && typeof asset.dimensions === 'object' ? asset.dimensions : {}),
        duplicateRisk: normalizeText(feedback.duplicateRisk || asset.duplicateRisk).slice(0, 300),
        reason: normalizeText(feedback.reason || asset.reason).slice(0, 800),
        original: normalizeText(feedback.original).slice(0, 800),
        modified: normalizeText(feedback.modified).slice(0, 800),
        deleteReason: normalizeText(feedback.deleteReason).slice(0, 800),
        previewGenerated: feedback.previewGenerated === true,
        legilSkipped: feedback.legilSkipped === true,
        legilError: normalizeText(feedback.legilError).slice(0, 600),
        selectedAsReference: feedback.selectedAsReference === true,
        rating: feedback.rating === null || feedback.rating === undefined || feedback.rating === '' ? null : Number(feedback.rating),
        savedAt: asset.savedAt || asset.recordedAt || '',
        feedbackId: feedback.feedbackId || (asset.review && asset.review.feedbackId) || ''
    };
}

function buildFeedbackSamples({ assets = [], feedback = [], limit = 80 }) {
    const assetById = new Map(safeArray(assets).map(asset => [asset.assetId, asset]));
    const reviewedFeedback = safeArray(feedback)
        .filter(item => item && ['good', 'normal', 'bad', 'rejected'].includes(item.status))
        .sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')))
        .slice(0, Math.max(1, limit));
    return reviewedFeedback.map(item => compactAssetForLearning(assetById.get(item.assetId) || {}, item));
}

function summarizeSamples(samples = []) {
    const counts = safeArray(samples).reduce((summary, sample) => {
        const status = sample.reviewStatus || 'unknown';
        summary[status] = (summary[status] || 0) + 1;
        return summary;
    }, {});
    return {
        total: safeArray(samples).length,
        good: counts.good || 0,
        normal: counts.normal || 0,
        bad: counts.bad || 0,
        rejected: counts.rejected || 0
    };
}

function buildLearningMessages({ samples, memory }) {
    const activeRules = getActiveMemoryRules(memory).slice(0, 50);
    const systemPrompt = [
        '你是 Feedback Learning Agent，职责是把人工审核过的图片反馈总结成下一轮创意生成可用的规则草案。',
        '你不能直接启用规则，只能生成 draft rules，等待人工确认。',
        '请说人话：报告要清楚说明系统学到了什么、证据来自哪些反馈、下一轮应该怎么用。',
        '只输出严格 JSON object，不要 Markdown，不要代码块。',
        'JSON 顶层格式固定为 {"learningReport": {...}, "ruleDrafts": [...]}。',
        'ruleDrafts 每条必须包含：scope, type, target, title, pattern, rationale, action, confidence, evidence, sourceFeedbackIds。',
        'scope 只能是 global、dimension、node；type 只能是 preferred、avoid、prompt、priority、style。',
        '请优先按三层沉淀：通用规则写 global；八维偏好或避坑写 dimension，target 填 mood/perspective/time/narrative/scale/material/subjectRelation/hook；具体方向节点偏好写 node，target 填 directionId 或 sourceDirectionId。',
        '正向反馈总结 preferred/priority/style；负向反馈总结 avoid/prompt/style。',
        '如果样本里有 modified 字段，请对比 original 和 modified，总结人工反复补充的维度、主体关系、材质或叙事动作。',
        '如果样本里有 direction-candidate 反馈，请把 accepted/rejected/archive/merge 的人工原因纳入方向级规则；不要只学习图片好坏。',
        '如果样本里有 legilSkipped 或 legilError，请总结为 prompt 或执行避坑规则，但不要夸大偶发错误。',
        '不要把单个偶然样本总结成强规则。证据不足时降低 confidence 或不输出。',
        '输出 3 到 10 条最有用规则草案；如果样本不足，少于 3 条也可以，但 learningReport 必须解释。'
    ].join('\n');
    const userPrompt = [
        '# Existing Active Memory',
        JSON.stringify(activeRules.map(rule => ({
            ruleId: rule.ruleId,
            scope: rule.scope,
            type: rule.type,
            target: rule.target,
            title: rule.title,
            pattern: rule.pattern,
            action: rule.action
        })), null, 2),
        '',
        '# Reviewed Feedback Samples',
        JSON.stringify(samples, null, 2),
        '',
        '# Required Output Shape',
        JSON.stringify({
            learningReport: {
                title: '本轮反馈学习报告',
                summary: '一句话说明学到了什么',
                positiveFindings: ['喜欢什么'],
                negativeFindings: ['不喜欢什么'],
                nextRunAdvice: ['下一轮怎么用'],
                sampleSummary: summarizeSamples(samples)
            },
            ruleDrafts: [{
                scope: 'global',
                type: 'preferred',
                target: '',
                title: '规则标题',
                pattern: '偏好或规避模式',
                rationale: '为什么这样总结',
                action: '下一轮生成时怎么做',
                confidence: 0.75,
                evidence: ['证据摘要'],
                sourceFeedbackIds: ['feedback_x']
            }]
        }, null, 2)
    ].join('\n');
    return [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
    ];
}

function extractModelText(data) {
    if (typeof data === 'string') return data;
    if (!data || typeof data !== 'object') return '';
    if (typeof data.output_text === 'string') return data.output_text;
    if (typeof data.text === 'string') return data.text;
    const firstChoice = Array.isArray(data.choices) ? data.choices[0] : null;
    if (firstChoice) {
        const message = firstChoice.message || {};
        if (typeof message.content === 'string') return message.content;
        if (Array.isArray(message.content)) {
            return message.content
                .map(part => typeof part === 'string' ? part : (part && (part.text || part.content) ? String(part.text || part.content) : ''))
                .filter(Boolean)
                .join('\n');
        }
        if (typeof firstChoice.text === 'string') return firstChoice.text;
    }
    return '';
}

function extractJsonObject(text) {
    const raw = String(text || '').trim()
        .replace(/^```(?:json)?/i, '')
        .replace(/```$/i, '')
        .trim();
    try {
        return JSON.parse(raw);
    } catch {
        const start = raw.indexOf('{');
        const end = raw.lastIndexOf('}');
        if (start >= 0 && end > start) {
            return JSON.parse(raw.slice(start, end + 1));
        }
        throw new Error('Feedback Learning Agent did not return parseable JSON');
    }
}

async function callFeedbackLearningAgent({ messages, agentConfig = {}, learningClient }) {
    if (typeof learningClient === 'function') {
        return await learningClient({
            agentName: FEEDBACK_LEARNING_AGENT_NAME,
            version: FEEDBACK_LEARNING_VERSION,
            messages,
            responseFormat: 'json_object'
        });
    }

    const apiUrl = normalizeText(agentConfig.apiUrl);
    const apiKey = normalizeText(agentConfig.apiKey);
    const model = normalizeText(agentConfig.model);
    const provider = normalizeText(agentConfig.provider);
    if (!apiUrl || !apiKey || !model) {
        throw new Error('Feedback Learning Agent configuration is incomplete');
    }

    const shouldUseMaxCompletionTokens = /^gpt-5\.5(?:$|[-_.\s])/i.test(model);
    const payload = {
        model,
        messages,
        stream: false,
        response_format: { type: 'json_object' }
    };
    if (shouldUseMaxCompletionTokens) {
        payload.max_completion_tokens = Number(agentConfig.maxTokens) || 8000;
    } else {
        payload.temperature = 0.48;
        payload.max_tokens = Number(agentConfig.maxTokens) || 8000;
    }
    if (provider) {
        payload.provider = provider;
    }

    const client = agentConfig.axios || axios;
    const response = await client.post(apiUrl, payload, {
        timeout: Number(agentConfig.timeoutMs) || 10 * 60 * 1000,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        }
    });

    return extractJsonObject(extractModelText(response && response.data ? response.data : response));
}

function normalizeLearningReport(raw = {}, context = {}) {
    return {
        learningRunId: context.learningRunId || buildLearningRunId(),
        version: FEEDBACK_LEARNING_VERSION,
        title: normalizeText(raw.title || '反馈学习报告'),
        summary: normalizeText(raw.summary || raw.message || '已根据人工反馈生成规则草案。').slice(0, 1000),
        positiveFindings: safeArray(raw.positiveFindings).map(item => normalizeText(item).slice(0, 300)).filter(Boolean).slice(0, 10),
        negativeFindings: safeArray(raw.negativeFindings).map(item => normalizeText(item).slice(0, 300)).filter(Boolean).slice(0, 10),
        nextRunAdvice: safeArray(raw.nextRunAdvice).map(item => normalizeText(item).slice(0, 300)).filter(Boolean).slice(0, 10),
        sampleSummary: raw.sampleSummary || context.sampleSummary || {},
        draftRuleCount: Number(context.draftRuleCount) || 0,
        sourceFeedbackIds: uniqueStrings(context.sourceFeedbackIds).slice(0, 100),
        createdAt: context.createdAt || nowIso()
    };
}

function getRuleBucket(memory, rule) {
    if (rule.scope === 'dimension') {
        const key = rule.target || 'general';
        memory.rules.dimension[key] = safeArray(memory.rules.dimension[key]);
        return memory.rules.dimension[key];
    }
    if (rule.scope === 'node') {
        const key = rule.target || 'general';
        memory.rules.node[key] = safeArray(memory.rules.node[key]);
        return memory.rules.node[key];
    }
    return memory.rules.global;
}

function removeRuleFromBuckets(memory, ruleId) {
    memory.rules.global = safeArray(memory.rules.global).filter(rule => rule.ruleId !== ruleId);
    Object.keys(memory.rules.dimension || {}).forEach(key => {
        memory.rules.dimension[key] = safeArray(memory.rules.dimension[key]).filter(rule => rule.ruleId !== ruleId);
    });
    Object.keys(memory.rules.node || {}).forEach(key => {
        memory.rules.node[key] = safeArray(memory.rules.node[key]).filter(rule => rule.ruleId !== ruleId);
    });
}

function getAllMemoryRules(memory = {}, includeDrafts = false) {
    const normalized = normalizeMemory(memory);
    const rules = [
        ...safeArray(normalized.rules.global),
        ...Object.values(normalized.rules.dimension || {}).flatMap(safeArray),
        ...Object.values(normalized.rules.node || {}).flatMap(safeArray)
    ];
    return includeDrafts ? rules.concat(safeArray(normalized.drafts)) : rules;
}

function getActiveMemoryRules(memory = {}) {
    return getAllMemoryRules(memory)
        .map(rule => normalizeRule(rule, { status: rule.status || 'active' }))
        .filter(rule => rule.status === 'active' && rule.enabled !== false);
}

function refreshMemoryStats(memory) {
    const activeRules = getActiveMemoryRules(memory);
    memory.preferred_patterns = activeRules
        .filter(rule => rule.type === 'preferred')
        .map(rule => ({
            ruleId: rule.ruleId,
            pattern: rule.pattern,
            action: rule.action,
            scope: rule.scope,
            target: rule.target,
            confidence: rule.confidence
        }));
    memory.avoid_patterns = activeRules
        .filter(rule => rule.type === 'avoid')
        .map(rule => ({
            ruleId: rule.ruleId,
            pattern: rule.pattern,
            action: rule.action,
            scope: rule.scope,
            target: rule.target,
            confidence: rule.confidence
        }));
    memory.stats = {
        ...(memory.stats || {}),
        totalDraftRules: safeArray(memory.drafts).filter(rule => rule.status === 'draft').length,
        activeRules: activeRules.length,
        rejectedDraftRules: safeArray(memory.drafts).filter(rule => rule.status === 'rejected').length
    };
    memory.updatedAt = nowIso();
    return memory;
}

function upsertDrafts(memory, drafts) {
    const existingById = new Map(safeArray(memory.drafts).map(rule => [rule.ruleId, rule]));
    safeArray(drafts).forEach(rule => {
        const current = existingById.get(rule.ruleId);
        existingById.set(rule.ruleId, current ? {
            ...current,
            ...rule,
            status: current.status === 'active' ? 'active' : rule.status,
            updatedAt: nowIso()
        } : rule);
    });
    memory.drafts = Array.from(existingById.values());
    return memory;
}

module.exports = {
    CREATIVE_MEMORY_VERSION,
    FEEDBACK_LEARNING_AGENT_NAME,
    FEEDBACK_LEARNING_VERSION,
    buildFeedbackSamples,
    buildLearningMessages,
    callFeedbackLearningAgent,
    emptyCreativeMemory,
    getActiveMemoryRules,
    getAllMemoryRules,
    normalizeLearningReport,
    normalizeMemory,
    normalizeRule,
    refreshMemoryStats,
    removeRuleFromBuckets,
    upsertDrafts
};
