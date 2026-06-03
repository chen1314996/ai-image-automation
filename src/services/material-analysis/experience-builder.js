function safeText(value, fallback = '--') {
    const text = String(value ?? '').trim();
    return text || fallback;
}

function formatNumber(value, digits = 2) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '--';
    return number.toLocaleString('zh-CN', {
        maximumFractionDigits: digits
    });
}

function formatPercent(value, digits = 2) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '--';
    return `${(number * 100).toLocaleString('zh-CN', {
        maximumFractionDigits: digits
    })}%`;
}

function directionName(item = {}) {
    return safeText(item.directionKey || [item.primary, item.secondary].filter(Boolean).join('/'));
}

function materialDirection(material = {}) {
    const parsed = material.parsedName || {};
    return [parsed.primary, parsed.secondary, parsed.idea].filter(Boolean).join(' / ') || '--';
}

function visionValue(result = {}, key) {
    return result && result.vision ? safeText(result.vision[key], '') : '';
}

function uniq(items = []) {
    return [...new Set(items.map(item => safeText(item, '')).filter(Boolean))];
}

function bulletList(items = [], fallback = '- 暂无明确样本，建议先补齐样本或视觉识别。') {
    const rows = items.filter(Boolean);
    if (!rows.length) return fallback;
    return rows.map(item => `- ${item}`).join('\n');
}

function topItems(items = [], count = 5) {
    return (Array.isArray(items) ? items : []).slice(0, count);
}

function buildEffectiveDirections(context = {}) {
    return topItems(context.goodDirections, 8).map(item => {
        const roi = formatPercent(item.d0IapRoi);
        const spend = formatNumber(item.spend);
        const action = item.action || '保留核心机制，继续拆变量验证。';
        return `${directionName(item)}：花费 ${spend}，D0 ROI ${roi}，健康分 ${formatNumber(item.avgHealthScore, 0)}。经验：${action}`;
    });
}

function buildRiskDirections(context = {}) {
    return topItems(context.riskDirections, 8).map(item => {
        const roi = formatPercent(item.d0IapRoi);
        const spend = formatNumber(item.spend);
        const action = item.action || '暂缓复刻，先复盘画面承诺与转化落差。';
        return `${directionName(item)}：花费 ${spend}，D0 ROI ${roi}，健康分 ${formatNumber(item.avgHealthScore, 0)}。风险：${action}`;
    });
}

function buildReusableVisualMechanisms(context = {}) {
    const successful = topItems(context.visionSuccessResults, 30);
    const hooks = uniq(successful.map(item => visionValue(item, 'hook'))).slice(0, 8);
    const events = uniq(successful.map(item => visionValue(item, 'event'))).slice(0, 8);
    const retained = uniq(successful.flatMap(item => item.vision && Array.isArray(item.vision.retainElements) ? item.vision.retainElements : [])).slice(0, 10);

    return [
        ...hooks.map(item => `钩子机制：${item}`),
        ...events.map(item => `事件机制：${item}`),
        ...retained.map(item => `可保留元素：${item}`)
    ];
}

function buildAvoidVisualExpressions(context = {}) {
    const failedNames = topItems(context.riskMaterials, 10).map(item => `${materialDirection(item)}：${safeText(item.health && item.health.action, '先降低重复投放。')}`);
    const risks = uniq(context.visionSuccessResults.flatMap(item => item.vision && Array.isArray(item.vision.riskNotes) ? item.vision.riskNotes : [])).slice(0, 10);
    return [
        ...failedNames,
        ...risks.map(item => `视觉风险：${item}`)
    ];
}

function buildIterationAxes(context = {}) {
    const axes = uniq(context.visionSuccessResults.flatMap(item => item.vision && Array.isArray(item.vision.variationAxes) ? item.vision.variationAxes : [])).slice(0, 12);
    const directionAxes = topItems(context.goodDirections, 5).map(item => `${directionName(item)}：围绕场景、主体关系、镜头距离、结局反转做小变量。`);
    return [
        ...axes.map(item => `视觉变化轴：${item}`),
        ...directionAxes
    ];
}

function buildCreativeBrief(context = {}) {
    const good = topItems(context.goodDirections, 3).map(directionName);
    const risk = topItems(context.riskDirections, 3).map(directionName);
    const visualHooks = uniq(context.visionSuccessResults.map(item => visionValue(item, 'hook'))).slice(0, 3);

    return [
        `主攻方向：${good.length ? good.join('、') : '从本周健康分最高方向中选择 2-3 个小批量验证。'}`,
        `暂缓方向：${risk.length ? risk.join('、') : '暂无强风险方向，但仍需观察高花费低 D0 ROI 样本。'}`,
        `视觉钩子：${visualHooks.length ? visualHooks.join('、') : '优先使用即时危机、明确目标、强结果反馈。'}`,
        '执行方式：每个方向拆 3 条变量，先小预算验证 D0 ROI，再决定是否进入放量池。'
    ];
}

function buildKnowledgeEvidence(context = {}) {
    return topItems(context.excellentMaterials, 8).map(item => {
        const vision = context.visionByMaterialId.get(item.materialId);
        const visual = vision && vision.vision
            ? `视觉证据：${safeText(vision.vision.summary)}；钩子：${safeText(vision.vision.hook)}`
            : '视觉证据：待补充或待复核。';
        return `${safeText(item.materialName)}：${materialDirection(item)}，D0 ROI ${formatPercent(item.d0IapRoi)}，${visual}`;
    });
}

function buildNegativeSamples(context = {}) {
    return topItems(context.riskMaterials, 8).map(item => {
        const vision = context.visionByMaterialId.get(item.materialId);
        const visual = vision && vision.vision
            ? `画面风险：${(vision.vision.riskNotes || []).join('、') || safeText(vision.vision.summary)}`
            : '画面风险：待补充视觉识别。';
        return `${safeText(item.materialName)}：花费 ${formatNumber(item.spend)}，D0 ROI ${formatPercent(item.d0IapRoi)}，${safeText(item.health && item.health.action)} ${visual}`;
    });
}

function buildExperienceDocument(context = {}) {
    const summary = context.summary || {};
    const generatedAt = context.generatedAt || new Date().toISOString();

    return [
        `# ${safeText(summary.projectName, '项目')} ${safeText(summary.weekId, '本周')} 素材经验文档`,
        '',
        `生成时间：${generatedAt}`,
        `数据来源：${safeText(summary.sourceFileName)}`,
        '',
        '## 1. 本周验证有效的方向',
        bulletList(buildEffectiveDirections(context), '- 暂无明确有效方向。优先从 D0 ROI 覆盖更完整的素材中继续观察。'),
        '',
        '## 2. 本周验证无效或风险较高的方向',
        bulletList(buildRiskDirections(context), '- 暂无明确高风险方向，但高花费素材仍需持续看 D0 ROI 和 CPI。'),
        '',
        '## 3. 可复用视觉机制',
        bulletList(buildReusableVisualMechanisms(context), '- 视觉识别样本不足，建议先补齐 Top100 识别后再沉淀机制。'),
        '',
        '## 4. 不建议重复的画面表达',
        bulletList(buildAvoidVisualExpressions(context), '- 暂无明确负向画面表达，继续积累失败样本。'),
        '',
        '## 5. 高潜力迭代轴',
        bulletList(buildIterationAxes(context), '- 暂无足够视觉轴样本，建议从场景、主体关系、镜头角度、结局反转四类先拆。'),
        '',
        '## 6. 下周创意拓展 brief',
        bulletList(buildCreativeBrief(context)),
        '',
        '## 7. 应沉淀的素材经验与候选方向建议',
        bulletList(buildKnowledgeEvidence(context), '- 暂无足够正向素材经验，建议先补充优秀素材的视觉识别和投放指标。'),
        '',
        '## 8. 应加入负样本的失败经验',
        bulletList(buildNegativeSamples(context), '- 暂无足够负样本证据，建议优先记录高花费低 D0 ROI 素材。'),
        ''
    ].join('\n');
}

module.exports = {
    buildExperienceDocument
};
