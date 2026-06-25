const DELIVERY_TARGET_ASPECT_RATIOS = {
    '800x800': '1:1',
    '1280x720': '16:9',
    '1080x1920': '9:16'
};

const DELIVERY_ALLOWED_CANDIDATE_COUNTS = [1, 2, 3, 4];

const DELIVERY_NO_TEXT_GUARDRAIL = [
    '纯画面适配：成图中不要新增任何文字、字母、数字、单词、可读标语、伪文字、乱码、签名、水印、logo、UI 文案、价格牌、标签或包装文字。',
    '如果原图已有文字或类似文字的纹理可以保留。'
].join('\n');

const DEFAULT_DELIVERY_PROMPT_TEMPLATES = {
    common: [
        '请基于输入图片进行图生图调整，保留主体、构图、风格、情绪、光影和广告质感。',
        '根据用户要求处理画面内容，不要简单拉伸或裁切，不要改变核心主体关系。',
        '成图中不要新增任何文字、字母、数字、可读标语、伪文字、乱码、签名、水印、logo、UI 文案、价格牌、标签或包装文字。',
        '如果原图已有文字或类似文字的纹理可以保留。',
        '目标尺寸：${targetSize}，目标比例：${aspectRatio}。'
    ].join('\n'),
    '800x800': '适配正方形广告图。主体居中偏稳，核心动作和冲突关系必须在第一眼可见。',
    '1280x720': '适配横版广告图。允许横向扩展背景和动作空间，主体不要过小，画面左右信息保持均衡。',
    '1080x1920': '适配竖版广告图。主体和关键动作应位于中间区域，保留竖屏浏览的视觉冲击，避免重要元素贴边。'
};

function normalizeDeliveryCandidateCount(value) {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue)) {
        return 1;
    }
    const count = Math.floor(numberValue);
    return DELIVERY_ALLOWED_CANDIDATE_COUNTS.includes(count) ? count : 1;
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
    const prompt = [
        fillTemplate(templates.common, values),
        fillTemplate(templates[targetSize], values)
    ].filter(Boolean).join('\n\n').trim();
    if (prompt.includes('纯画面适配') || prompt.includes('不要新增任何文字')) {
        return prompt;
    }
    return [prompt, DELIVERY_NO_TEXT_GUARDRAIL].filter(Boolean).join('\n\n').trim();
}

module.exports = {
    DELIVERY_TARGET_ASPECT_RATIOS,
    DELIVERY_ALLOWED_CANDIDATE_COUNTS,
    DELIVERY_NO_TEXT_GUARDRAIL,
    DEFAULT_DELIVERY_PROMPT_TEMPLATES,
    normalizeDeliveryCandidateCount,
    normalizeDeliveryPromptTemplates,
    buildDeliveryPrompt
};
