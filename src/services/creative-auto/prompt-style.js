const CREATIVE_PROMPT_STYLE_DEFAULT = 'cinematic_photo';

const CREATIVE_PROMPT_STYLE_OPTIONS = [
    {
        value: 'cinematic_photo',
        label: '电影感真实摄影质感',
        lead: '以参考图角色为基础，保持角色造型和服装特征，生成高质量电影感场景图',
        terms: ['真实摄影质感', '自然电影光影', '角色与环境融合', '画面中心清晰', '构图稳定', '细节丰富']
    },
    {
        value: 'commercial_3d',
        label: '3D卡通商业广告海报',
        lead: '以参考图角色为基础，保持角色造型和服装特征，生成高质量3D卡通商业广告海报',
        terms: ['主体醒目', '构图稳定', '冷暖光对比明确', '材质细节丰富', '缩略图可读']
    },
    {
        value: 'style_free',
        label: '不限风格',
        lead: '以参考图角色为基础，保持角色造型、服装特征和原图视觉质感，生成高质量场景图',
        terms: ['画面中心清晰', '构图稳定', '细节丰富']
    }
];

const STYLE_VALUES = new Set(CREATIVE_PROMPT_STYLE_OPTIONS.map(option => option.value));

const PARAMETER_PATTERNS = [
    /1\s*[:：]\s*1/gi,
    /方图/g,
    /正方形构图/g,
    /生成\s*[一二三四五六七八九十百\d]+\s*张/g,
    /输出\s*[一二三四五六七八九十百\d]+\s*张/g,
    /分辨率\s*[248]\s*[Kk]/gi,
    /[248]\s*[Kk]\s*分辨率/gi,
    /宽高比/g,
    /画幅比例/g
];

const STRUCTURED_LABEL_PATTERN = /(?:^|[。；;\n]\s*)(主题|画风|风格|画面内容|核心构图|构图|镜头|光线|文字规则|画面要求|整体基调|情绪氛围|主体|场景|动作)\s*[:：]\s*/g;
const STYLE_FREE_FORCED_PATTERN = /电影感|真实摄影|自然电影光影|3D|三维|卡通|商业广告|商业海报|游戏广告|写实大片|写实摄影/g;
const TEXT_DIRECTION_PATTERN = /文字标语|海报大字|按钮文案|大号中文词语|醒目字样|标题文字|文案/g;
const GENERIC_ACTION_PATTERN = /整理物资|整理补给|清点物资|清点补给|寻找补给|寻找资源|搜寻补给|搜寻资源|收集补给|收集资源|探索场景|探索废墟|探索车站/g;
const CONCRETE_PROP_TERMS = [
    '罐头',
    '药品',
    '药盒',
    '电池',
    '电池包',
    '背包',
    '绷带',
    '指示牌',
    '手电',
    '应急灯',
    '灯笼',
    '补给箱',
    '工具箱',
    '木箱',
    '铁门',
    '绳索',
    '地图',
    '信号灯',
    '取暖芯',
    '能源芯',
    '钥匙卡',
    '金属箱',
    '货架',
    '箱盖',
    '脚印'
];
const SPECIFICITY_DETAILS = {
    cinematic_photo: {
        organize: '把罐头、药品和电池从破旧背包里分类装箱',
        search: '用手电照亮倒塌货架，从积雪下翻出罐头、药盒和备用电池',
        collect: '把散落罐头、绷带和电池包装进旧背包',
        explore: '沿着结冰地面检查破损指示牌、倒塌货架和遗落补给箱',
        props: '散落绷带、旧背包和结冰工具箱'
    },
    commercial_3d: {
        organize: '把发光能源芯、厚实补给箱和钥匙卡摆到画面中心的破损箱盖上',
        search: '用手电照亮倒塌货架，从积雪下翻出发光能源芯、补给箱和钥匙卡',
        collect: '把发光能源芯、补给箱和电池包集中到醒目的前景位置',
        explore: '沿着结冰地面检查破损指示牌、发光补给箱和能源芯线索',
        props: '发光能源芯、厚实补给箱和冰霜金属箱'
    },
    style_free: {
        organize: '把罐头、药品和电池从破旧背包里分类装箱',
        search: '用手电照亮倒塌货架，从积雪下翻出罐头、药盒和备用电池',
        collect: '把散落罐头、绷带和电池包装进旧背包',
        explore: '沿着结冰地面检查破损指示牌、倒塌货架和遗落补给箱',
        props: '散落绷带、旧背包和结冰工具箱'
    }
};

function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeCreativePromptStyle(value) {
    const text = normalizeText(value);
    return STYLE_VALUES.has(text) ? text : CREATIVE_PROMPT_STYLE_DEFAULT;
}

function getCreativePromptStyleOptions() {
    return CREATIVE_PROMPT_STYLE_OPTIONS.map(option => ({
        value: option.value,
        label: option.label
    }));
}

function getCreativePromptStyle(style) {
    const normalized = normalizeCreativePromptStyle(style);
    return CREATIVE_PROMPT_STYLE_OPTIONS.find(option => option.value === normalized)
        || CREATIVE_PROMPT_STYLE_OPTIONS[0];
}

function hasGenerationParameterText(text) {
    const source = normalizeText(text);
    return PARAMETER_PATTERNS.some(pattern => {
        pattern.lastIndex = 0;
        return pattern.test(source);
    });
}

function hasStructuredPromptLabels(text) {
    STRUCTURED_LABEL_PATTERN.lastIndex = 0;
    return STRUCTURED_LABEL_PATTERN.test(String(text || ''));
}

function hasForcedStyleForStyleFree(text) {
    STYLE_FREE_FORCED_PATTERN.lastIndex = 0;
    return STYLE_FREE_FORCED_PATTERN.test(normalizeText(text));
}

function hasGenericVisualAction(text) {
    GENERIC_ACTION_PATTERN.lastIndex = 0;
    return GENERIC_ACTION_PATTERN.test(normalizeText(text));
}

function countConcreteVisualProps(text) {
    const source = normalizeText(text);
    return CONCRETE_PROP_TERMS.reduce((count, term) => count + (source.includes(term) ? 1 : 0), 0);
}

function getSpecificityDetail(style) {
    return SPECIFICITY_DETAILS[normalizeCreativePromptStyle(style)] || SPECIFICITY_DETAILS.cinematic_photo;
}

function shouldEnrichVisualSpecificity(text) {
    const source = normalizeText(text);
    if (hasGenericVisualAction(source)) {
        return true;
    }
    return countConcreteVisualProps(source) < 3 && /物资|补给|资源|背包|车站|仓库|废弃|冰|雪|求生|幸存|取暖|能源/.test(source);
}

function enrichPromptVisualSpecificity(text, style = CREATIVE_PROMPT_STYLE_DEFAULT) {
    let next = String(text || '');
    const detail = getSpecificityDetail(style);
    next = next
        .replace(/整理物资|整理补给|清点物资|清点补给/g, detail.organize)
        .replace(/寻找补给|寻找资源|搜寻补给|搜寻资源/g, detail.search)
        .replace(/收集补给|收集资源/g, detail.collect)
        .replace(/探索场景|探索废墟|探索车站/g, detail.explore);

    if (shouldEnrichVisualSpecificity(next) && countConcreteVisualProps(next) < 3 && !/前景有/.test(next)) {
        next = `${next}，前景有${detail.props}`;
    }
    return next;
}

function stripGenerationParameters(text) {
    let next = String(text || '');
    PARAMETER_PATTERNS.forEach(pattern => {
        pattern.lastIndex = 0;
        next = next.replace(pattern, '');
    });
    return next;
}

function stripStructuredLabels(text) {
    return String(text || '').replace(STRUCTURED_LABEL_PATTERN, (match, label) => {
        return match.startsWith('\n') ? '' : '，';
    });
}

function stripStyleFreeForcedTerms(text) {
    STYLE_FREE_FORCED_PATTERN.lastIndex = 0;
    return String(text || '').replace(STYLE_FREE_FORCED_PATTERN, '');
}

function normalizePromptPunctuation(text) {
    return String(text || '')
        .replace(/[ \t\r\n]+/g, '')
        .replace(/，{2,}/g, '，')
        .replace(/。{2,}/g, '。')
        .replace(/、{2,}/g, '、')
        .replace(/：{2,}/g, '：')
        .replace(/^[，。；;、\s]+|[，；;、\s]+$/g, '')
        .replace(/，。/g, '。')
        .replace(/。，/g, '，')
        .trim();
}

function appendDefaultNegativeTextRule(text) {
    const source = normalizePromptPunctuation(text)
        .replace(/，?不要文字，不要水印。?$/g, '')
        .replace(/，?不要水印。?$/g, '')
        .replace(/，?不要文字。?$/g, '');
    if (TEXT_DIRECTION_PATTERN.test(source)) {
        return `${source.replace(/。$/g, '')}，不要水印。`;
    }
    return `${source.replace(/。$/g, '')}，不要文字，不要水印。`;
}

function sanitizeLegilPromptText(prompt, style = CREATIVE_PROMPT_STYLE_DEFAULT) {
    const normalizedStyle = normalizeCreativePromptStyle(style);
    let next = normalizeText(prompt);
    next = stripStructuredLabels(next);
    next = stripGenerationParameters(next);
    if (normalizedStyle === 'style_free') {
        next = stripStyleFreeForcedTerms(next);
    }
    next = normalizePromptPunctuation(next);
    if (!next) {
        next = getCreativePromptStyle(normalizedStyle).lead;
    } else if (!/参考图|原图|角色造型|服装特征/.test(next)) {
        next = `${getCreativePromptStyle(normalizedStyle).lead}：${next}`;
    }
    if (shouldEnrichVisualSpecificity(next)) {
        next = enrichPromptVisualSpecificity(next, normalizedStyle);
    }
    return appendDefaultNegativeTextRule(next);
}

function buildStyleInstruction(style = CREATIVE_PROMPT_STYLE_DEFAULT) {
    const option = getCreativePromptStyle(style);
    if (option.value === 'style_free') {
        return [
            `当前提示词风格：${option.label}。`,
            '最终 finalPrompt 不要额外强加电影感、真实摄影、3D、卡通、商业海报、写实大片等风格词。',
            '应尽量保留参考图原本的视觉质感，只补足场景、动作、构图、前景道具、光线和细节。'
        ].join('\n');
    }
    return [
        `当前提示词风格：${option.label}。`,
        `finalPrompt 建议以“${option.lead}：”开头。`,
        `可以自然使用这些表达：${option.terms.join('、')}。`
    ].join('\n');
}

module.exports = {
    CREATIVE_PROMPT_STYLE_DEFAULT,
    CREATIVE_PROMPT_STYLE_OPTIONS,
    buildStyleInstruction,
    countConcreteVisualProps,
    enrichPromptVisualSpecificity,
    getCreativePromptStyle,
    getCreativePromptStyleOptions,
    hasForcedStyleForStyleFree,
    hasGenerationParameterText,
    hasGenericVisualAction,
    hasStructuredPromptLabels,
    normalizeCreativePromptStyle,
    sanitizeLegilPromptText
};
