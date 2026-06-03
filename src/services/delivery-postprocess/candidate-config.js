const DELIVERY_TARGET_ASPECT_RATIOS = {
    '800x800': '1:1',
    '1280x720': '16:9',
    '1080x1920': '9:16'
};

const DELIVERY_ALLOWED_CANDIDATE_COUNTS = [1, 2, 3, 4];

const DEFAULT_DELIVERY_PROMPT_TEMPLATES = {
    common: [
        '请基于输入图片进行图生图改造，保留主体、题材、情绪、核心卖点和可读性。',
        '不要简单拉伸或裁切。请根据目标画幅重新构图，适当扩展背景、补足空间、调整主体位置。',
        '保持广告素材风格清晰，主体关系明确，避免文字乱码和主体变形。',
        '目标尺寸：${targetSize}，目标比例：${aspectRatio}。'
    ].join('\n'),
    '800x800': '适配正方形广告图。主体居中偏稳，核心动作和冲突关系必须在第一眼可见。',
    '1280x720': '适配横版广告图。允许横向扩展背景和动作空间，主体不要过小，画面左右信息保持均衡。',
    '1080x1920': '适配竖版广告图。主体和关键动作应位于中上区域，保留竖屏浏览的视觉冲击，避免重要元素贴边。'
};

function normalizeDeliveryCandidateCount(value) {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue)) {
        return 4;
    }
    const count = Math.floor(numberValue);
    return DELIVERY_ALLOWED_CANDIDATE_COUNTS.includes(count) ? count : 4;
}

function normalizeDeliveryPromptTemplates(value = {}) {
    const source = value && typeof value === 'object' ? value : {};
    const next = { ...DEFAULT_DELIVERY_PROMPT_TEMPLATES };
    Object.keys(next).forEach(key => {
        if (typeof source[key] === 'string' && source[key].trim()) {
            next[key] = source[key].trim();
        }
    });
    return next;
}

function fillTemplate(template, values = {}) {
    return String(template || '').replace(/\$\{([a-zA-Z0-9_]+)\}/g, (_match, key) => {
        return values[key] === undefined || values[key] === null ? '' : String(values[key]);
    });
}

function buildDeliveryPrompt({ promptTemplates, targetSize, aspectRatio, baseName, sourceFileName }) {
    const templates = normalizeDeliveryPromptTemplates(promptTemplates);
    const values = {
        targetSize,
        aspectRatio,
        baseName: baseName || '',
        sourceFileName: sourceFileName || ''
    };
    return [
        fillTemplate(templates.common, values),
        fillTemplate(templates[targetSize], values)
    ].filter(Boolean).join('\n\n').trim();
}

module.exports = {
    DELIVERY_TARGET_ASPECT_RATIOS,
    DELIVERY_ALLOWED_CANDIDATE_COUNTS,
    DEFAULT_DELIVERY_PROMPT_TEMPLATES,
    normalizeDeliveryCandidateCount,
    normalizeDeliveryPromptTemplates,
    buildDeliveryPrompt
};
