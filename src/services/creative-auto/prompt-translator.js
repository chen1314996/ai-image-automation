const crypto = require('crypto');
const axios = require('axios');
const {
    sanitizePromptText
} = require('../../../creative-agent-quality');
const {
    DEFAULT_FORBIDDEN_TERMS
} = require('./prompt-gate');
const {
    buildStyleInstruction,
    countConcreteVisualProps,
    enrichPromptVisualSpecificity,
    getCreativePromptStyle,
    hasForcedStyleForStyleFree,
    hasGenerationParameterText,
    hasGenericVisualAction,
    hasStructuredPromptLabels,
    normalizeCreativePromptStyle,
    sanitizeLegilPromptText
} = require('./prompt-style');

const PROMPT_SCHEMA_VERSION = 1;
const TRANSLATION_VERSION = 's5-prompt-translator-v1';
const TRANSLATION_AGENT_NAME = 'Prompt Translator Agent';

const REQUIRED_FIELDS = [
    'promptTitle',
    'sourceDirectionId',
    'newDirectionName',
    'subject',
    'action',
    'scene',
    'camera',
    'lighting',
    'visualStyle',
    'textRule',
    'mustKeep',
    'mustAvoid',
    'finalPrompt'
];

const CAMERA_VARIANTS = [
    '低机位近景，前景放大关键道具，中景呈现角色动作，背景保留环境压力',
    '俯视中远景，画面能同时看清主体行动路线和周围资源关系',
    '电影感平视中景，主体位于画面中心偏前，前中后景层次清楚',
    '侧逆光半身特写，突出手部动作、表情反应和关键物件质感',
    '广角远景，主体与场景形成明确比例关系，适合做系列化广告图'
];

const LIGHTING_VARIANTS = [
    '冷蓝环境光与局部暖光形成对比，关键主体边缘有清晰轮廓光',
    '清晨灰蓝天光，局部橙色生存光源强调希望和可点击焦点',
    '暴风雪漫反射光，前景有高亮细节，中景保持主体可读',
    '低照度危机光，红色警示点缀但不变成科幻 UI',
    '阴天柔光加局部火光，材质细节清楚，画面不脏不糊'
];

const STYLE_VARIANTS = [
    '高质量 3D 卡通渲染，商业级游戏宣传海报风格，电影镜头感',
    '写实卡通 3D 广告图，主体造型清楚，材质有厚度，画面适合投放',
    '移动游戏买量素材风格，强叙事瞬间，缩略图下也能读懂冲突',
    '精品休闲游戏宣传图风格，角色表情和道具信息清楚，色彩对比明确',
    '末日生存题材 3D 海报风格，画面直观，主体明确，商业完成度高'
];

const PROP_DETAIL_VARIANTS = {
    cinematic_photo: [
        '罐头、药品、电池、破旧背包和散落绷带',
        '结冰工具箱、手电、破损地图和备用电池包',
        '旧补给箱、药盒、绳索和结冰指示牌'
    ],
    commercial_3d: [
        '发光能源芯、厚实补给箱、钥匙卡和冰霜金属箱',
        '醒目的补给箱、电池包、手电和发光取暖芯',
        '画面中心的能源芯、金属箱盖、钥匙卡和散落罐头'
    ],
    style_free: [
        '罐头、药品、电池、破旧背包和散落绷带',
        '结冰工具箱、手电、破损地图和备用电池包',
        '旧补给箱、药盒、绳索和结冰指示牌'
    ]
};

const ACTION_DETAIL_VARIANTS = {
    cinematic_photo: [
        '在暖色应急灯下把罐头、药品和电池从破旧背包里分类装箱',
        '用手电照亮倒塌货架，从积雪下翻出罐头、药盒和备用电池',
        '蹲在结冰地面旁，把散落绷带、电池包和旧地图收进补给箱'
    ],
    commercial_3d: [
        '把发光能源芯、厚实补给箱和钥匙卡摆到画面中心的破损箱盖上',
        '用手电照亮倒塌货架，从积雪下翻出发光能源芯、补给箱和电池包',
        '将醒目的取暖芯、电池包和钥匙卡集中到前景补给箱旁'
    ],
    style_free: [
        '在暖色应急灯下把罐头、药品和电池从破旧背包里分类装箱',
        '用手电照亮倒塌货架，从积雪下翻出罐头、药盒和备用电池',
        '蹲在结冰地面旁，把散落绷带、电池包和旧地图收进补给箱'
    ]
};

function safeArray(value) {
    return Array.isArray(value) ? value : [];
}

function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeList(value) {
    if (Array.isArray(value)) {
        return uniqueStrings(value);
    }
    const text = normalizeText(value);
    if (!text) {
        return [];
    }
    return uniqueStrings(text.split(/[、，,;；|/]/g));
}

function uniqueStrings(values = []) {
    return Array.from(new Set(safeArray(values)
        .map(value => normalizeText(value))
        .filter(Boolean)));
}

function hashText(text) {
    return crypto.createHash('sha1').update(normalizeText(text)).digest('hex').slice(0, 16);
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
        throw new Error('Prompt Translator Agent did not return parseable JSON');
    }
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

    const firstCandidate = Array.isArray(data.candidates) ? data.candidates[0] : null;
    if (firstCandidate && firstCandidate.content && Array.isArray(firstCandidate.content.parts)) {
        return firstCandidate.content.parts.map(part => part.text || '').join('\n');
    }

    return '';
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

function textSnippet(text, maxLength = 120) {
    return normalizeText(text).slice(0, maxLength);
}

function stripForbiddenTerms(text, forbiddenTerms = []) {
    let next = normalizeText(text);
    forbiddenTerms.forEach(term => {
        const safeTerm = normalizeText(term);
        if (!safeTerm) {
            return;
        }
        next = next.split(safeTerm).join('');
    });
    return sanitizePromptText(next);
}

function collectForbiddenTerms({ selected, payload = {}, config = {} }) {
    const direction = selected && selected.direction ? selected.direction : {};
    return uniqueStrings([
        ...DEFAULT_FORBIDDEN_TERMS,
        ...safeArray(config.forbiddenRules),
        ...safeArray(config.mustAvoid),
        ...safeArray(config.forbiddenTerms),
        ...safeArray(payload.forbiddenRules),
        ...safeArray(payload.mustAvoid),
        direction.mustAvoid
    ]).sort((a, b) => b.length - a.length);
}

function findForbiddenTerm(text, forbiddenTerms = []) {
    const lower = normalizeText(text).toLowerCase();
    return forbiddenTerms.find(term => {
        const target = normalizeText(term).toLowerCase();
        return target && lower.includes(target);
    }) || '';
}

function extractByLabels(text, labels = [], maxLength = 120) {
    const source = normalizeText(text);
    for (const label of labels) {
        const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp(`${escaped}\\s*[：:：]?\\s*([^。；;]+)`, 'i');
        const match = source.match(pattern);
        if (match && normalizeText(match[1])) {
            return textSnippet(match[1], maxLength);
        }
    }
    return '';
}

function sentenceAt(text, offset = 0, maxLength = 120) {
    const sentences = normalizeText(text)
        .split(/[。！？!?；;]/g)
        .map(item => item.trim())
        .filter(Boolean);
    return textSnippet(sentences[offset] || sentences[0] || '', maxLength);
}

function buildDirectionName(item, selected) {
    const direction = selected && selected.direction ? selected.direction : {};
    return firstNonEmpty(
        item && item.newDirectionName,
        item && item.directionName,
        item && item.direction,
        direction.name,
        direction.path,
        direction.id,
        '未命名方向'
    );
}

function buildDirectionDefinition(item, selected) {
    const direction = selected && selected.direction ? selected.direction : {};
    const newDirectionName = buildDirectionName(item, selected);
    const description = firstNonEmpty(
        item && item.directionDescription,
        item && item.description,
        item && item.direction,
        direction.description
    );

    return {
        sourceDirectionId: firstNonEmpty(item && item.sourceDirectionId, direction.id),
        sourceDirectionPath: firstNonEmpty(item && item.sourceDirectionPath, direction.path),
        newDirectionName,
        description: textSnippet(description, 320),
        sourceStrategy: textSnippet(firstNonEmpty(item && item.sourceStrategy, item && item.sourceRow), 240),
        mustKeep: uniqueStrings([
            ...normalizeList(direction.mustKeep),
            ...normalizeList(item && item.mustKeep)
        ]),
        mustAvoid: uniqueStrings([
            ...normalizeList(direction.mustAvoid),
            ...normalizeList(item && item.mustAvoid)
        ]),
        status: 'translated',
        version: TRANSLATION_VERSION
    };
}

function compactDirectionKey(definition) {
    return [
        definition.sourceDirectionId,
        definition.sourceDirectionPath,
        definition.newDirectionName
    ].map(normalizeText).join('::').toLowerCase();
}

function buildDirectionDefinitions(prompts, selected) {
    const byKey = new Map();
    safeArray(prompts).forEach(item => {
        const definition = buildDirectionDefinition(item || {}, selected);
        const key = compactDirectionKey(definition);
        if (!byKey.has(key)) {
            byKey.set(key, {
                ...definition,
                promptCount: 0,
                promptTitles: []
            });
        }
        const current = byKey.get(key);
        current.promptCount += 1;
        current.promptTitles = uniqueStrings([
            ...current.promptTitles,
            item && item.promptTitle
        ]).slice(0, 12);
    });
    return Array.from(byKey.values());
}

function formatMemoryRulesForTranslator(memoryRules = [], limit = 12) {
    const rules = safeArray(memoryRules)
        .filter(rule => rule && rule.status === 'active' && rule.enabled !== false)
        .slice(0, limit);
    if (!rules.length) {
        return [];
    }
    return rules.map(rule => ({
        scope: rule.scope || 'global',
        type: rule.type || 'preferred',
        target: rule.target || '',
        title: rule.title || '',
        pattern: rule.pattern || '',
        action: rule.action || '',
        rationale: rule.rationale || ''
    }));
}

function buildPromptTranslationMessages({ sourcePrompts, directionDefinitions, selected, payload = {}, config = {}, forbiddenTerms = [], memoryRules = [] }) {
    const direction = selected && selected.direction ? selected.direction : {};
    const generationSettings = config.generationSettings || {};
    const creativePromptStyle = normalizeCreativePromptStyle(payload.creativePromptStyle || config.creativePromptStyle);
    const styleOption = getCreativePromptStyle(creativePromptStyle);
    const expectedPromptCount = safeArray(sourcePrompts).length;
    const compactPrompts = safeArray(sourcePrompts).map((item, index) => ({
        index: Number(item && item.index) || index + 1,
        promptTitle: item && item.promptTitle ? item.promptTitle : '',
        newDirectionName: buildDirectionName(item || {}, selected),
        directionDescription: item && (item.directionDescription || item.description) ? (item.directionDescription || item.description) : '',
        sourcePromptCandidate: item && item.prompt ? item.prompt : '',
        selected: !item || item.selected !== false
    }));
    const naturalPromptRules = [
        '',
        '# New Legil Final Prompt Rules',
        'finalPrompt 必须是一段自然中文镜头描述，不要写成“主题：/画风：/画面内容：/核心构图：”这种字段模板。',
        'finalPrompt 必须先绑定参考图角色，表达“以参考图角色为基础，保持角色造型和服装特征”。',
        'finalPrompt 必须包含明确场景、明确动作、前景或关键道具、光线或氛围、构图或画面中心。',
        'finalPrompt 不要只写“整理物资 / 寻找补给 / 收集资源 / 探索场景”这类泛动作；必须写清楚整理或寻找的具体物品，例如罐头、药品、电池、背包、绷带、补给箱、能源芯、钥匙卡等至少 2-3 个可见物。',
        'finalPrompt 不要包含宽高比、1:1、方图、正方形构图、输出几张、生成几张、分辨率、2K、4K、画幅比例等生图参数。',
        'finalPrompt 建议 80-180 个中文字符，复杂场景最多 240 个中文字符。',
        'finalPrompt 默认以“不要文字，不要水印。”收尾。',
        buildStyleInstruction(creativePromptStyle)
    ];
    const systemPrompt = [
        '你是 Prompt Translator Agent，职责是把“方向定义”转译成可直接交给 Legil 生图的中文长 prompt。',
        '你不是创意拓展 Agent：不要新增方向数量，不要改写方向层级，不要输出策划解释。',
        '你必须输出严格 JSON object，不要 Markdown，不要代码块。',
        'JSON 顶层格式固定为 {"prompts":[...]}。',
        `每个 prompts item 必须包含字段：${REQUIRED_FIELDS.join(', ')}。`,
        'finalPrompt 必须是中文长 prompt，具体说明主体、动作、场景、镜头、光线、画风、文字规则和画面要求。',
        '动作必须具体到“做什么、拿什么、放在哪里”：例如“把罐头、药品和电池从破旧背包里分类装箱”，不要停留在“整理物资”。',
        '如果 sourcePromptCandidate 已经是完整、具体、可直接出图的中文长 prompt，请最大限度保留原始画面表达，只补足缺失字段，不要改写成机械模板。',
        'finalPrompt 不能只换词，必须让同一方向下的多条 prompt 有更明显的画面差异：动作节点、空间位置、镜头景别、关键道具或危机/奖励关系至少改变两项。',
        '差异化不能脱离当前体系：保留冰雪末世求生、3D 卡通游戏广告图、明确主体动作和可读点击点，禁止漂移到无关题材、纯风景或写实品牌广告。',
        'finalPrompt 不要写“不要/禁止/避免某元素”这种负面禁用描述，直接把禁用元素从画面中排除。',
        'mustAvoid 字段可以记录禁用规则，但 finalPrompt 里不能出现这些禁用词本身。',
        '每条 prompt 要保留 sourceDirectionId 和 newDirectionName，方便追溯。'
    ].concat(naturalPromptRules).join('\n');
    const userPrompt = [
        '# Source Direction',
        JSON.stringify({
            sourceDirectionId: direction.id || '',
            sourceDirectionPath: direction.path || '',
            sourceDirectionName: direction.name || '',
            sourceDirectionDescription: direction.description || '',
            mustKeep: direction.mustKeep || '',
            mustAvoid: direction.mustAvoid || '',
            tags: [direction.primaryTag, direction.secondaryTag, direction.tertiaryTag, direction.subTag].filter(Boolean)
        }, null, 2),
        '',
        '# Direction Definitions To Translate',
        JSON.stringify(directionDefinitions, null, 2),
        '',
        '# Source Prompt Candidates',
        '这些是上一段 Agent 给出的候选画面草案，只能作为转译参考；最终输出必须符合本轮 schema。',
        JSON.stringify(compactPrompts, null, 2),
        '',
        '# Legil Settings',
        JSON.stringify({
            imageModel: generationSettings.imageModel || '',
            aspectRatio: generationSettings.aspectRatio || '1:1',
            resolution: generationSettings.resolution || '2K',
            outputQuantity: generationSettings.outputQuantity || '',
            creativePromptStyle,
            creativePromptStyleLabel: styleOption.label,
            expectedPromptCount
        }, null, 2),
        '',
        '# Forbidden Rules',
        JSON.stringify({
            payloadMustAvoid: safeArray(payload.mustAvoid),
            payloadForbiddenRules: safeArray(payload.forbiddenRules),
            forbiddenTerms
        }, null, 2),
        '',
        '# Confirmed Feedback Memory Rules',
        '这些规则来自人工审核反馈，已经人工启用；翻译 finalPrompt 时要遵守，draft/rejected/disabled 规则不在这里出现。',
        JSON.stringify(formatMemoryRulesForTranslator(memoryRules), null, 2),
        '',
        '# Output Contract',
        `输出 prompts 数量必须等于 ${expectedPromptCount}。`,
        '按 Source Prompt Candidates 的 index 一一对应输出。',
        '优先保留 Source Prompt Candidates 中已经成熟的主题、情绪、画面内容、镜头和整体基调表达。',
        'finalPrompt 建议 180-420 个中文字符，既具体可执行，又保留后续拓展空间。',
        '如果需要画面文字，只允许短中文关键词，清晰可读，不使用真实品牌 logo，不使用大面积英文。'
    ].join('\n');

    return [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
    ];
}

async function callPromptTranslationAgent({ messages, translatorConfig = {}, translatorClient }) {
    if (typeof translatorClient === 'function') {
        return await translatorClient({
            agentName: TRANSLATION_AGENT_NAME,
            version: TRANSLATION_VERSION,
            messages,
            responseFormat: 'json_object'
        });
    }

    const apiUrl = normalizeText(translatorConfig.apiUrl);
    const apiKey = normalizeText(translatorConfig.apiKey);
    const model = normalizeText(translatorConfig.model);
    const provider = normalizeText(translatorConfig.provider);
    if (!apiUrl || !apiKey || !model) {
        throw new Error('Prompt Translator Agent configuration is incomplete');
    }

    const shouldUseMaxCompletionTokens = /^gpt-5\.5(?:$|[-_.\s])/i.test(model);
    const requestPayload = {
        model,
        messages,
        stream: false,
        response_format: { type: 'json_object' }
    };
    if (shouldUseMaxCompletionTokens) {
        requestPayload.max_completion_tokens = Number(translatorConfig.maxTokens) || 9000;
    } else {
        requestPayload.temperature = 0.56;
        requestPayload.max_tokens = Number(translatorConfig.maxTokens) || 9000;
    }
    if (provider) {
        requestPayload.provider = provider;
    }

    const client = translatorConfig.axios || axios;
    const response = await client.post(apiUrl, requestPayload, {
        timeout: Number(translatorConfig.timeoutMs) || 10 * 60 * 1000,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        }
    });

    return extractJsonObject(extractModelText(response && response.data ? response.data : response));
}

function normalizeAgentPromptItems(agentResult, sourcePrompts, selected, creativePromptStyle = 'cinematic_photo') {
    const agentPrompts = safeArray(agentResult && agentResult.prompts);
    if (!agentPrompts.length) {
        throw new Error('Prompt Translator Agent returned 0 prompts');
    }

    return safeArray(sourcePrompts).map((source, index) => {
        const sourceIndex = Number(source && source.index) || index + 1;
        const byIndex = agentPrompts.find(item => {
            const candidateIndex = Number(item && (item.index || item.sourceIndex || item.originalIndex));
            return candidateIndex === sourceIndex;
        });
        const agentItem = byIndex || agentPrompts[index] || {};
        const finalPrompt = firstNonEmpty(agentItem.finalPrompt, agentItem.prompt);
        return {
            ...(source || {}),
            ...(agentItem || {}),
            index: sourceIndex,
            originalIndex: sourceIndex,
            direction: firstNonEmpty(agentItem.newDirectionName, agentItem.direction, source && source.direction, buildDirectionName(source || {}, selected)),
            newDirectionName: firstNonEmpty(agentItem.newDirectionName, agentItem.direction, source && source.newDirectionName, source && source.direction, buildDirectionName(source || {}, selected)),
            promptTitle: firstNonEmpty(agentItem.promptTitle, source && source.promptTitle, `Prompt ${sourceIndex}`),
            sourcePrompt: sanitizePromptText(firstNonEmpty(source && source.sourcePrompt, source && source.prompt, source && source.finalPrompt)),
            finalPrompt,
            prompt: finalPrompt || firstNonEmpty(source && source.prompt, source && source.finalPrompt),
            creativePromptStyle,
            selected: !source || source.selected !== false
        };
    });
}

function compactErrorMessage(error) {
    return normalizeText(error && error.message ? error.message : String(error || 'Unknown error')).slice(0, 500);
}

function buildFallbackAgentPromptItems(sourcePrompts, selected, creativePromptStyle = 'cinematic_photo') {
    return safeArray(sourcePrompts).map((source, index) => {
        const sourceIndex = Number(source && source.index) || index + 1;
        const sourcePrompt = sanitizePromptText(firstNonEmpty(
            source && source.sourcePrompt,
            source && source.prompt,
            source && source.finalPrompt
        ));
        return {
            ...(source || {}),
            index: sourceIndex,
            originalIndex: sourceIndex,
            direction: firstNonEmpty(source && source.direction, source && source.newDirectionName, buildDirectionName(source || {}, selected)),
            newDirectionName: firstNonEmpty(source && source.newDirectionName, source && source.direction, buildDirectionName(source || {}, selected)),
            promptTitle: firstNonEmpty(source && source.promptTitle, `Prompt ${sourceIndex}`),
            sourcePrompt,
            finalPrompt: firstNonEmpty(source && source.finalPrompt, sourcePrompt),
            prompt: firstNonEmpty(source && source.prompt, source && source.finalPrompt, sourcePrompt),
            creativePromptStyle,
            selected: !source || source.selected !== false
        };
    });
}

function isMatureSourcePrompt(prompt, creativePromptStyle = 'cinematic_photo') {
    const text = sanitizeLegilPromptText(prompt, creativePromptStyle);
    if (text.length < 80) {
        return false;
    }
    if (hasStructuredPromptLabels(text) || hasGenerationParameterText(text)) {
        return false;
    }
    if (normalizeCreativePromptStyle(creativePromptStyle) === 'style_free' && hasForcedStyleForStyleFree(text)) {
        return false;
    }
    if (hasGenericVisualAction(text) || countConcreteVisualProps(text) < 3) {
        return false;
    }
    const richnessSignals = ['参考图', '角色', '造型', '服装', '场景', '动作', '前景', '道具', '光线', '氛围', '构图', '画面中心'];
    return richnessSignals.filter(signal => text.includes(signal)).length >= 3;
}

function shouldPreserveSourcePrompts(sourcePrompts = [], forbiddenTerms = [], creativePromptStyle = 'cinematic_photo') {
    const prompts = safeArray(sourcePrompts);
    if (!prompts.length) {
        return false;
    }
    return prompts.every(item => {
        const prompt = firstNonEmpty(item && item.finalPrompt, item && item.prompt, item && item.sourcePrompt);
        return isMatureSourcePrompt(prompt, creativePromptStyle) && !findForbiddenTerm(prompt, forbiddenTerms);
    });
}

async function runPromptTranslationAgent({ sourcePrompts, directionDefinitions, selected, payload, config, forbiddenTerms, memoryRules, translatorConfig, translatorClient }) {
    const messages = buildPromptTranslationMessages({
        sourcePrompts,
        directionDefinitions,
        selected,
        payload,
        config,
        forbiddenTerms,
        memoryRules
    });
    const result = await callPromptTranslationAgent({
        messages,
        translatorConfig,
        translatorClient
    });
    return {
        result,
        messages
    };
}

function pickVariant(variants, index) {
    return variants[Math.max(0, Number(index) - 1) % variants.length];
}

function pickStyleVariant(variantsByStyle, style, index) {
    const normalizedStyle = normalizeCreativePromptStyle(style);
    return pickVariant(variantsByStyle[normalizedStyle] || variantsByStyle.cinematic_photo || [], index);
}

function buildStructuredFields(item, selected, context = {}) {
    const direction = selected && selected.direction ? selected.direction : {};
    const rawPrompt = sanitizePromptText(firstNonEmpty(item && item.sourcePrompt, item && item.prompt));
    const newDirectionName = buildDirectionName(item, selected);
    const sourceDirectionId = firstNonEmpty(item && item.sourceDirectionId, direction.id);
    const sourceDirectionPath = firstNonEmpty(item && item.sourceDirectionPath, direction.path);
    const promptTitle = firstNonEmpty(item && item.promptTitle, `${newDirectionName} ${Number(context.index) || 1}`);
    const primaryTag = firstNonEmpty(item && item.primaryTag, direction.primaryTag, direction.primary);
    const secondaryTag = firstNonEmpty(item && item.secondaryTag, direction.secondaryTag, direction.secondary);
    const tertiaryTag = firstNonEmpty(item && item.tertiaryTag, direction.tertiaryTag, direction.tertiary);
    const standardLabelPath = Array.isArray(item && item.standardLabelPath)
        ? item.standardLabelPath
        : [primaryTag, secondaryTag, tertiaryTag].filter(Boolean);
    const subject = firstNonEmpty(
        item && item.subject,
        extractByLabels(rawPrompt, ['主体', '主题', '画面主体', '主角'], 80),
        newDirectionName
    );
    const creativePromptStyle = normalizeCreativePromptStyle(context.creativePromptStyle);
    const fallbackAction = pickStyleVariant(ACTION_DETAIL_VARIANTS, creativePromptStyle, context.index);
    const fallbackProps = pickStyleVariant(PROP_DETAIL_VARIANTS, creativePromptStyle, context.index);
    const rawAction = firstNonEmpty(
        item && item.action,
        extractByLabels(rawPrompt, ['动作', '行为', '画面动作', '画面内容'], 120),
        sentenceAt(rawPrompt, 1, 120),
        fallbackAction,
        `${newDirectionName}中发生一个清楚可读的关键行动`
    );
    const action = hasGenericVisualAction(rawAction) && countConcreteVisualProps(rawAction) < 3
        ? enrichPromptVisualSpecificity(rawAction, creativePromptStyle)
        : rawAction;
    const scene = firstNonEmpty(
        item && item.scene,
        extractByLabels(rawPrompt, ['场景', '环境', '地点', '背景'], 120),
        direction.path,
        sentenceAt(rawPrompt, 2, 120),
        '冰封末日生存场景，空间关系清楚'
    );
    const camera = firstNonEmpty(
        item && item.camera,
        extractByLabels(rawPrompt, ['镜头', '视角', '构图', '景别'], 140),
        pickVariant(CAMERA_VARIANTS, context.index)
    );
    const lighting = firstNonEmpty(
        item && item.lighting,
        extractByLabels(rawPrompt, ['光线', '灯光', '光照', '色彩', '基调'], 140),
        pickVariant(LIGHTING_VARIANTS, context.index)
    );
    const visualStyle = firstNonEmpty(
        item && item.visualStyle,
        extractByLabels(rawPrompt, ['画风', '风格', '视觉风格'], 140),
        pickVariant(STYLE_VARIANTS, context.index)
    );
    const textRule = firstNonEmpty(
        item && item.textRule,
        '如需文字，只出现短中文关键词，清晰可读，不使用真实品牌 logo，不出现大面积英文'
    );
    const keyProps = firstNonEmpty(
        item && item.keyProps,
        item && item.foreground,
        item && item.material,
        extractByLabels(rawPrompt, ['前景', '道具', '关键道具', '物资', '补给'], 120),
        countConcreteVisualProps(action) >= 3 ? action : '',
        fallbackProps
    );
    const mustKeep = uniqueStrings([
        ...normalizeList(direction.mustKeep),
        ...normalizeList(item && item.mustKeep),
        direction.description
    ]).slice(0, 6);
    const mustAvoid = uniqueStrings([
        ...normalizeList(direction.mustAvoid),
        ...normalizeList(item && item.mustAvoid),
        ...safeArray(context.forbiddenTerms)
    ]).slice(0, 12);

    return {
        promptTitle,
        sourceDirectionId,
        sourceDirectionPath,
        primaryTag,
        secondaryTag,
        tertiaryTag,
        standardLabelPath,
        newDirectionName,
        contentTitle: firstNonEmpty(item && item.contentTitle, newDirectionName),
        outputNameBase: firstNonEmpty(item && item.outputNameBase),
        subject,
        action,
        scene,
        camera,
        lighting,
        visualStyle,
        textRule,
        keyProps,
        mustKeep,
        mustAvoid,
        sourcePrompt: rawPrompt,
        sourcePromptHash: hashText(rawPrompt)
    };
}

function buildFinalPrompt(fields, forbiddenTerms = [], creativePromptStyle = 'cinematic_photo') {
    const style = getCreativePromptStyle(creativePromptStyle);
    const subject = firstNonEmpty(fields.subject, fields.newDirectionName, '参考图角色');
    const action = firstNonEmpty(fields.action, `${subject}正在完成一个清晰可读的关键动作`);
    const scene = firstNonEmpty(fields.scene, '具有明确空间关系的场景');
    const lighting = firstNonEmpty(fields.lighting, '自然光影突出角色轮廓和环境氛围');
    const camera = firstNonEmpty(fields.camera, '画面中心清晰，构图稳定');
    const keepText = safeArray(fields.mustKeep).length
        ? `保留${safeArray(fields.mustKeep).slice(0, 3).join('、')}，`
        : '';
    const propText = firstNonEmpty(
        fields.keyProps,
        fields.material,
        fields.foreground,
        '与场景相关的关键道具和材质细节'
    );
    const normalizedAction = action.startsWith(subject) ? action.slice(subject.length) : action;
    const styleTerms = safeArray(style.terms).slice(0, 4).join('，');
    const rawPrompt = [
        `${style.lead}：`,
        `${keepText}${scene}，`,
        `${subject}${normalizedAction}，`,
        `前景有${propText}，`,
        `${lighting}，`,
        `${camera}，`,
        styleTerms ? `${styleTerms}。` : '细节丰富。'
    ].join('');

    return sanitizeLegilPromptText(
        enrichPromptVisualSpecificity(stripForbiddenTerms(rawPrompt, forbiddenTerms), creativePromptStyle),
        creativePromptStyle
    );
}

function selfCheckPrompt(promptItem, forbiddenTerms = []) {
    const errors = [];
    const warnings = [];

    REQUIRED_FIELDS.forEach(field => {
        const value = promptItem[field];
        const emptyArray = Array.isArray(value) && value.length === 0;
        if (value === undefined || value === null || normalizeText(value) === '' || emptyArray) {
            errors.push({
                code: 'missing_field',
                field,
                message: `${field} 为空`
            });
        }
    });

    const finalPrompt = normalizeText(promptItem.finalPrompt);
    const creativePromptStyle = normalizeCreativePromptStyle(promptItem.creativePromptStyle);
    if (finalPrompt.length < 60) {
        errors.push({
            code: 'short_final_prompt',
            field: 'finalPrompt',
            message: `finalPrompt 太短：${finalPrompt.length} 字`
        });
    }

    if (finalPrompt.length >= 60 && finalPrompt.length < 80) {
        warnings.push({
            code: 'short_final_prompt',
            field: 'finalPrompt',
            message: `finalPrompt 信息略少：${finalPrompt.length} 字`
        });
    }

    if (finalPrompt.length > 240) {
        warnings.push({
            code: 'long_final_prompt',
            field: 'finalPrompt',
            message: `finalPrompt 偏长：${finalPrompt.length} 字`
        });
    }

    if (hasStructuredPromptLabels(finalPrompt)) {
        errors.push({
            code: 'structured_prompt_labels',
            field: 'finalPrompt',
            message: 'finalPrompt 仍包含字段式标签'
        });
    }

    if (hasGenerationParameterText(finalPrompt)) {
        errors.push({
            code: 'generation_parameter_in_prompt',
            field: 'finalPrompt',
            message: 'finalPrompt 不能包含宽高比、张数、分辨率等生图参数'
        });
    }

    if (creativePromptStyle === 'style_free' && hasForcedStyleForStyleFree(finalPrompt)) {
        errors.push({
            code: 'style_free_forced_style',
            field: 'finalPrompt',
            message: '不限风格时不能自动强加电影感、真实摄影、3D、卡通、商业海报等风格词'
        });
    }

    if (!/参考图|原图|角色造型|服装特征/.test(finalPrompt)) {
        warnings.push({
            code: 'weak_reference_binding',
            field: 'finalPrompt',
            message: 'finalPrompt 建议明确绑定参考图角色和造型服装特征'
        });
    }

    if (!/不要文字，不要水印|不要水印/.test(finalPrompt)) {
        errors.push({
            code: 'missing_no_text_watermark',
            field: 'finalPrompt',
            message: 'finalPrompt 默认需要以不要文字、不要水印规则收尾'
        });
    }

    if (hasGenericVisualAction(finalPrompt) || countConcreteVisualProps(finalPrompt) < 3) {
        errors.push({
            code: 'generic_action_missing_props',
            field: 'finalPrompt',
            message: 'finalPrompt 需要把泛动作细化为具体动作，并包含至少 2-3 个可见物资或道具'
        });
    }

    const forbiddenTerm = findForbiddenTerm(finalPrompt, forbiddenTerms);
    if (forbiddenTerm) {
        errors.push({
            code: 'forbidden_term',
            field: 'finalPrompt',
            message: `finalPrompt 命中禁用元素：${forbiddenTerm}`
        });
    }

    if (normalizeText(promptItem.action).length < 12 || hasGenericVisualAction(promptItem.action)) {
        warnings.push({
            code: 'weak_action',
            field: 'action',
            message: '动作偏短或偏泛，建议写清楚具体物品和操作方式'
        });
    }

    if (normalizeText(promptItem.scene).length < 10) {
        warnings.push({
            code: 'weak_scene',
            field: 'scene',
            message: '场景偏短，可能导致 Legil 自由发挥'
        });
    }

    return {
        success: errors.length === 0,
        errors,
        warnings
    };
}

function translateOnePrompt(item, selected, context) {
    const fields = buildStructuredFields(item || {}, selected, context);
    const index = Number(item && item.index) || context.index;
    const creativePromptStyle = normalizeCreativePromptStyle(context.creativePromptStyle);
    const rawCandidatePrompt = stripForbiddenTerms(firstNonEmpty(item && item.finalPrompt, item && item.prompt), context.forbiddenTerms);
    let finalPrompt = rawCandidatePrompt ? sanitizeLegilPromptText(rawCandidatePrompt, creativePromptStyle) : '';
    if (!rawCandidatePrompt || rawCandidatePrompt.length < 60 || !finalPrompt || finalPrompt.length < 60) {
        finalPrompt = buildFinalPrompt(fields, context.forbiddenTerms, creativePromptStyle);
    }
    let translated = {
        ...(item || {}),
        ...fields,
        index,
        direction: fields.newDirectionName,
        promptTitle: fields.promptTitle,
        promptSchemaVersion: PROMPT_SCHEMA_VERSION,
        translationVersion: TRANSLATION_VERSION,
        creativePromptStyle,
        translatedAt: context.translatedAt,
        finalPrompt,
        prompt: finalPrompt,
        rewriteCount: 0,
        selected: !item || item.selected !== false
    };

    let selfCheck = selfCheckPrompt(translated, context.forbiddenTerms);
    if (!selfCheck.success) {
        const repairedFields = {
            ...fields,
            subject: fields.subject || fields.newDirectionName,
            action: fields.action || `${fields.newDirectionName}中的主体正在执行一个明确动作`,
            scene: fields.scene || '冰封末日生存场景，空间关系清楚',
            camera: fields.camera || pickVariant(CAMERA_VARIANTS, context.index),
            lighting: fields.lighting || pickVariant(LIGHTING_VARIANTS, context.index),
            visualStyle: fields.visualStyle || pickVariant(STYLE_VARIANTS, context.index),
            textRule: fields.textRule || '如需文字，只出现短中文关键词，清晰可读',
            keyProps: fields.keyProps || pickStyleVariant(PROP_DETAIL_VARIANTS, creativePromptStyle, context.index)
        };
        finalPrompt = buildFinalPrompt(repairedFields, context.forbiddenTerms, creativePromptStyle);
        translated = {
            ...translated,
            ...repairedFields,
            finalPrompt,
            prompt: finalPrompt,
            rewriteCount: 1
        };
        selfCheck = selfCheckPrompt(translated, context.forbiddenTerms);
    }

    return {
        ...translated,
        selfCheck: {
            ...selfCheck,
            checkedAt: context.translatedAt
        }
    };
}

function summarizePromptTranslation(prompts = []) {
    return safeArray(prompts).reduce((summary, item) => {
        if (item.selfCheck && item.selfCheck.success) {
            summary.selfCheckPassed += 1;
        } else {
            summary.selfCheckFailed += 1;
        }
        if (Number(item.rewriteCount) > 0) {
            summary.rewritten += 1;
        }
        return summary;
    }, {
        selfCheckPassed: 0,
        selfCheckFailed: 0,
        rewritten: 0
    });
}

async function translatePromptsForLegil({
    prompts,
    selected,
    payload = {},
    config = {},
    runId = '',
    memoryRules = [],
    translatorConfig = {},
    translatorClient
}) {
    const sourcePrompts = safeArray(prompts);
    const translatedAt = new Date().toISOString();
    const creativePromptStyle = normalizeCreativePromptStyle(payload.creativePromptStyle || config.creativePromptStyle);
    const forbiddenTerms = collectForbiddenTerms({ selected, payload, config });
    const directionDefinitions = buildDirectionDefinitions(sourcePrompts, selected);
    let agent = null;
    let agentPromptItems = [];
    let fallbackUsed = false;
    let fallbackReason = '';
    let agentSkipped = false;
    let agentSkipReason = '';
    if (shouldPreserveSourcePrompts(sourcePrompts, forbiddenTerms, creativePromptStyle)) {
        agentSkipped = true;
        agentSkipReason = 'source prompts are already mature; preserved original creative wording';
        agentPromptItems = buildFallbackAgentPromptItems(sourcePrompts, selected, creativePromptStyle);
    } else {
        try {
            agent = await runPromptTranslationAgent({
                sourcePrompts,
                directionDefinitions,
                selected,
                payload,
                config,
                forbiddenTerms,
                memoryRules,
                translatorConfig,
                translatorClient
            });
            agentPromptItems = normalizeAgentPromptItems(agent.result, sourcePrompts, selected, creativePromptStyle);
        } catch (error) {
            fallbackUsed = true;
            fallbackReason = compactErrorMessage(error);
            agentPromptItems = buildFallbackAgentPromptItems(sourcePrompts, selected, creativePromptStyle);
        }
    }
    const translatedPrompts = agentPromptItems.map((item, index) => translateOnePrompt(item, selected, {
        index: index + 1,
        translatedAt,
        forbiddenTerms,
        creativePromptStyle
    }));
    const summary = summarizePromptTranslation(translatedPrompts);

    return {
        prompts: translatedPrompts,
        directionDefinitions,
        report: {
            runId,
            version: TRANSLATION_VERSION,
            promptSchemaVersion: PROMPT_SCHEMA_VERSION,
            creativePromptStyle,
            translatedAt,
            sourcePromptCount: sourcePrompts.length,
            promptCount: translatedPrompts.length,
            directionDefinitionCount: directionDefinitions.length,
            agentName: TRANSLATION_AGENT_NAME,
            agentRequestPromptCount: sourcePrompts.length,
            agentResponsePromptCount: safeArray(agent && agent.result && agent.result.prompts).length,
            agentSkipped,
            agentSkipReason,
            fallbackUsed,
            fallbackReason,
            requiredFields: REQUIRED_FIELDS,
            forbiddenTerms,
            ...summary,
            success: translatedPrompts.length > 0 && summary.selfCheckFailed === 0,
            prompts: translatedPrompts.map(item => ({
                index: item.index,
                promptTitle: item.promptTitle,
                sourceDirectionId: item.sourceDirectionId,
                sourceDirectionPath: item.sourceDirectionPath,
                newDirectionName: item.newDirectionName,
                sourcePromptHash: item.sourcePromptHash,
                finalPromptHash: hashText(item.finalPrompt),
                rewriteCount: item.rewriteCount,
                selfCheck: item.selfCheck
            }))
        }
    };
}

module.exports = {
    PROMPT_SCHEMA_VERSION,
    REQUIRED_FIELDS,
    TRANSLATION_AGENT_NAME,
    TRANSLATION_VERSION,
    buildDirectionDefinitions,
    buildPromptTranslationMessages,
    selfCheckPrompt,
    translatePromptsForLegil
};
