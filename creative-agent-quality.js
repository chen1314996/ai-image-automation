const { normalizeCellText } = require('./creative-table-parser');
const {
    countConcreteVisualProps,
    hasForcedStyleForStyleFree,
    hasGenerationParameterText,
    hasGenericVisualAction,
    hasStructuredPromptLabels,
    normalizeCreativePromptStyle
} = require('./src/services/creative-auto/prompt-style');

const STRUCTURED_PROMPT_SUFFIX = '冰雪氛围，画面直观、主题明确，高质量3D卡通渲染，商业级游戏宣传海报风格，电影镜头感。';
const DEFAULT_PROMPT_FORBIDDEN_TERMS = [
    '真实品牌',
    '品牌 logo',
    '品牌logo',
    '强赛博',
    '高科技 UI',
    '高科技UI',
    '枪支',
    '军事',
    '悬浮设备',
    '机甲',
    '激光界面',
    '大面积英文',
    '二次元赛璐璐'
];
const REQUIRED_PROMPT_SECTIONS = ['主题', '画风', '情绪氛围', '画面内容', '整体基调'];
const ABSTRACT_DIRECTION_TERMS = [
    '氛围感',
    '高级感',
    '生存感',
    '末日感',
    '故事感',
    '电影感',
    '视觉感',
    '情绪感'
];
const CONCRETE_VISUAL_TERMS = [
    '前景',
    '中景',
    '远景',
    '镜头',
    '构图',
    '手',
    '人物',
    '幸存者',
    '小队',
    '物资',
    '建筑',
    '车辆',
    '废墟',
    '冰',
    '雪',
    '火光',
    '灯光',
    '包装',
    '金属',
    '布料'
];

function sanitizePromptText(text) {
    return normalizeCellText(text)
        .replace(/\s+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/。{2,}/g, '。')
        .replace(/，{2,}/g, '，')
        .replace(/；{2,}/g, '；')
        .replace(/：{2,}/g, '：')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

function normalizePromptKey(text) {
    return sanitizePromptText(text)
        .replace(/[，。！？；：、,.!?;:\s]/g, '')
        .toLowerCase();
}

function tokenizeForSimilarity(text) {
    const key = normalizePromptKey(text);
    const tokens = new Set();
    for (let index = 0; index < key.length - 1; index += 2) {
        tokens.add(key.slice(index, index + 2));
    }
    return tokens;
}

function promptSimilarity(a, b) {
    const left = tokenizeForSimilarity(a);
    const right = tokenizeForSimilarity(b);
    if (!left.size || !right.size) {
        return 0;
    }
    let intersection = 0;
    left.forEach(token => {
        if (right.has(token)) {
            intersection += 1;
        }
    });
    const union = left.size + right.size - intersection;
    return union ? intersection / union : 0;
}

function findForbiddenTerm(prompt) {
    const normalized = sanitizePromptText(prompt).toLowerCase();
    return DEFAULT_PROMPT_FORBIDDEN_TERMS.find(term => {
        const key = normalizeCellText(term).toLowerCase();
        return key && normalized.includes(key);
    }) || '';
}

function findMissingPromptSections(prompt) {
    return REQUIRED_PROMPT_SECTIONS.filter(section => !prompt.includes(section));
}

function hasMultiScenePlan(prompt) {
    return /(方案[一二三四五六123456]|四宫格|三联画|拼贴|分屏|或者|也可以|另一种|同时给出|分别呈现|一半.*另一半)/u.test(prompt);
}

function isAbstractPrompt(prompt) {
    const text = sanitizePromptText(prompt);
    const concreteHitCount = CONCRETE_VISUAL_TERMS.reduce((count, term) => count + (text.includes(term) ? 1 : 0), 0);
    if (concreteHitCount >= 4) {
        return false;
    }
    return /氛围|感觉|高级|震撼|史诗|希望|压迫|紧张|孤独|神秘/u.test(text);
}

function compactIssueItem(item, index) {
    return {
        index: Number(item && item.index) || index + 1,
        sourceRow: item && item.sourceRow ? item.sourceRow : '',
        direction: normalizeCellText(item && item.direction).slice(0, 120),
        promptTitle: normalizeCellText(item && item.promptTitle).slice(0, 80)
    };
}

function addIssue(report, severity, code, message, item, index) {
    const target = severity === 'error' ? report.errors : report.warnings;
    target.push({
        severity,
        code,
        message,
        ...(item ? compactIssueItem(item, index) : {})
    });
}

function findMalformedReason(prompt, item) {
    const direction = normalizeCellText(item && item.direction);
    const checks = [
        { pattern: /主题：\s*的/, reason: '主题缺少主体，出现“主题：的...”' },
        { pattern: /让成为/, reason: '句子缺少主体，出现“让成为”' },
        { pattern: /中景是与|落在与|把与角色|托住与/, reason: '画面描述中存在变量缺失痕迹' },
        { pattern: /主体为[，。；]|画面内容：[，。；]/, reason: '关键字段后缺少具体内容' },
        { pattern: /undefined|null|NaN|\{\{|\$\{|TODO|待补/i, reason: '包含占位符或未替换变量' }
    ];

    for (const check of checks) {
        if (check.pattern.test(prompt)) {
            return check.reason;
        }
    }

    if (/^[的，。、；：]/.test(direction)) {
        return '方向名称疑似不完整';
    }

    return '';
}

function buildCreativeAgentQualityReport(promptItems = []) {
    const report = {
        success: true,
        status: 'pass',
        checkedAt: new Date().toISOString(),
        totalPrompts: 0,
        acceptedPromptCount: 0,
        rejectedPromptCount: 0,
        selectedPrompts: 0,
        directionCount: 0,
        duplicateCount: 0,
        similarCount: 0,
        malformedCount: 0,
        sanitizedCount: 0,
        errors: [],
        warnings: [],
        summary: '未检查到提示词'
    };

    const prompts = Array.isArray(promptItems) ? promptItems : [];
    const seenPrompts = new Map();
    const directions = new Set();

    prompts.forEach((item, index) => {
        const originalPrompt = normalizeCellText(item && item.prompt);
        const sanitizedPrompt = sanitizePromptText(originalPrompt);
        const direction = normalizeCellText(item && item.direction);
        if (!originalPrompt) {
            addIssue(report, 'error', 'empty_prompt', '提示词为空', item, index);
            return;
        }

        report.totalPrompts += 1;
        if (!item || item.selected !== false) {
            report.selectedPrompts += 1;
        }
        if (direction) {
            directions.add(direction);
        }
        if (sanitizedPrompt !== originalPrompt) {
            report.sanitizedCount += 1;
        }

        const creativePromptStyle = normalizeCreativePromptStyle(item && item.creativePromptStyle);

        if (sanitizedPrompt.length < 60) {
            addIssue(report, 'error', 'short_prompt', `提示词过短：${sanitizedPrompt.length} 字`, item, index);
        } else if (sanitizedPrompt.length < 80) {
            addIssue(report, 'warning', 'short_prompt', `提示词偏短：${sanitizedPrompt.length} 字`, item, index);
        }
        if (sanitizedPrompt.length > 240) {
            addIssue(report, 'warning', 'long_prompt', `提示词偏长：${sanitizedPrompt.length} 字`, item, index);
        }
        if (hasStructuredPromptLabels(sanitizedPrompt)) {
            addIssue(report, 'error', 'structured_prompt_labels', '提示词仍包含“主题/画风/画面内容”等字段式标签', item, index);
        }
        if (hasGenerationParameterText(sanitizedPrompt)) {
            addIssue(report, 'error', 'generation_parameter_in_prompt', '提示词不能包含宽高比、输出张数、分辨率等生图参数', item, index);
        }
        if (creativePromptStyle === 'style_free' && hasForcedStyleForStyleFree(sanitizedPrompt)) {
            addIssue(report, 'error', 'style_free_forced_style', '不限风格时不能强加电影感、真实摄影、3D、卡通、商业海报等风格词', item, index);
        }
        if (hasGenericVisualAction(sanitizedPrompt) || countConcreteVisualProps(sanitizedPrompt) < 3) {
            addIssue(report, 'warning', 'generic_action_or_sparse_props', '提示词建议把“整理物资/寻找补给”等泛动作改成具体物资动作，并补足 2-3 个可见道具', item, index);
        }
        if (!/参考图|原图|角色造型|服装特征/.test(sanitizedPrompt)) {
            addIssue(report, 'warning', 'weak_reference_binding', '提示词建议明确绑定参考图角色和造型服装特征', item, index);
        }
        if (!/不要文字，不要水印|不要水印/.test(sanitizedPrompt)) {
            addIssue(report, 'warning', 'missing_no_text_watermark', '提示词建议默认追加“不要文字，不要水印”', item, index);
        }
        if ((sanitizedPrompt.match(new RegExp(STRUCTURED_PROMPT_SUFFIX, 'g')) || []).length > 1) {
            addIssue(report, 'warning', 'duplicate_suffix', '固定风格尾句重复出现', item, index);
        }
        const forbiddenTerm = findForbiddenTerm(sanitizedPrompt);
        if (forbiddenTerm) {
            addIssue(report, 'error', 'forbidden_term', `命中禁用元素：${forbiddenTerm}`, item, index);
        }
        if (hasMultiScenePlan(sanitizedPrompt)) {
            addIssue(report, 'warning', 'multi_scene_plan', '单条提示词疑似包含多个互斥画面方案，建议拆成多条 prompt', item, index);
        }
        if (isAbstractPrompt(sanitizedPrompt)) {
            addIssue(report, 'warning', 'abstract_prompt', '提示词可能偏抽象，缺少足够具体的主体、动作、镜头或材质细节', item, index);
        }
        if (ABSTRACT_DIRECTION_TERMS.some(term => direction.includes(term))) {
            addIssue(report, 'warning', 'abstract_direction_name', '方向名称偏抽象，建议改成具体画面母题', item, index);
        }

        const malformedReason = findMalformedReason(sanitizedPrompt, item);
        if (malformedReason) {
            report.malformedCount += 1;
            addIssue(report, 'error', 'malformed_prompt', malformedReason, item, index);
        }

        const key = normalizePromptKey(sanitizedPrompt);
        if (seenPrompts.has(key)) {
            report.duplicateCount += 1;
            addIssue(report, 'warning', 'duplicate_prompt', `与第 ${seenPrompts.get(key)} 组提示词高度重复`, item, index);
        } else if (key) {
            seenPrompts.set(key, Number(item && item.index) || index + 1);
        }

        for (const [seenKey, seenIndex] of seenPrompts.entries()) {
            if (seenKey === key) {
                continue;
            }
            const similarity = promptSimilarity(seenKey, key);
            if (similarity >= 0.9) {
                report.similarCount += 1;
                addIssue(report, 'warning', 'similar_prompt', `与第 ${seenIndex} 组提示词相似度较高（${Math.round(similarity * 100)}%）`, item, index);
                break;
            }
        }
    });

    report.directionCount = directions.size;
    report.success = report.errors.length === 0;
    report.status = report.errors.length > 0 ? 'error' : (report.warnings.length > 0 ? 'warning' : 'pass');
    report.acceptedPromptCount = report.success ? report.totalPrompts : Math.max(0, report.totalPrompts - report.errors.length);
    report.rejectedPromptCount = report.success ? 0 : report.errors.length;
    report.summary = report.errors.length > 0
        ? `发现 ${report.errors.length} 个严重问题、${report.warnings.length} 个提醒，建议修正后再批量生成`
        : `已检查 ${report.totalPrompts} 组提示词，${report.warnings.length} 个提醒`;

    return report;
}

function sanitizeCreativePromptItems(promptItems = []) {
    return (Array.isArray(promptItems) ? promptItems : []).map(item => ({
        ...item,
        prompt: sanitizePromptText(item && item.prompt)
    }));
}

module.exports = {
    DEFAULT_PROMPT_FORBIDDEN_TERMS,
    REQUIRED_PROMPT_SECTIONS,
    STRUCTURED_PROMPT_SUFFIX,
    buildCreativeAgentQualityReport,
    sanitizeCreativePromptItems,
    sanitizePromptText
};
