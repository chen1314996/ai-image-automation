const { normalizeCellText } = require('./creative-table-parser');

const STRUCTURED_PROMPT_SUFFIX = '冰雪氛围，画面直观、主题明确，高质量3D卡通渲染，商业级游戏宣传海报风格，电影镜头感。';

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
        checkedAt: new Date().toISOString(),
        totalPrompts: 0,
        selectedPrompts: 0,
        directionCount: 0,
        duplicateCount: 0,
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

        if (sanitizedPrompt.length < 120) {
            addIssue(report, 'warning', 'short_prompt', `提示词偏短：${sanitizedPrompt.length} 字`, item, index);
        }
        if (sanitizedPrompt.length > 1200) {
            addIssue(report, 'warning', 'long_prompt', `提示词偏长：${sanitizedPrompt.length} 字`, item, index);
        }
        if (!sanitizedPrompt.includes('主题') || !sanitizedPrompt.includes('画风')) {
            addIssue(report, 'warning', 'missing_structure', '提示词缺少“主题/画风”等结构化字段', item, index);
        }
        if ((sanitizedPrompt.match(new RegExp(STRUCTURED_PROMPT_SUFFIX, 'g')) || []).length > 1) {
            addIssue(report, 'warning', 'duplicate_suffix', '固定风格尾句重复出现', item, index);
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
    });

    report.directionCount = directions.size;
    report.success = report.errors.length === 0;
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
    STRUCTURED_PROMPT_SUFFIX,
    buildCreativeAgentQualityReport,
    sanitizeCreativePromptItems,
    sanitizePromptText
};
