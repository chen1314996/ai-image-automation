function compactMetric(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function buildVisionInput(material = {}) {
    return {
        materialName: material.materialName || '',
        contentUrl: material.contentUrl || '',
        metrics: {
            spend: compactMetric(material.spend),
            d0IapRoi: compactMetric(material.d0IapRoi),
            cpi: compactMetric(material.cpi),
            ipm: compactMetric(material.ipm),
            ctr: compactMetric(material.ctr),
            cvr: compactMetric(material.cvr)
        },
        parsedName: {
            primary: material.parsedName && material.parsedName.primary || '',
            secondary: material.parsedName && material.parsedName.secondary || '',
            idea: material.parsedName && material.parsedName.idea || ''
        },
        health: material.health ? {
            score: material.health.score,
            tag: material.health.tag && material.health.tag.label || '',
            action: material.health.action || ''
        } : undefined
    };
}

function buildVisionPrompt(material = {}) {
    const input = buildVisionInput(material);
    return `你是游戏买量素材分析师，正在分析《无尽冬日》图片投放素材。

请结合图片画面和下面的投放数据，识别这张素材的画面内容、吸引点、可保留元素、可迭代方向和风险点。输出必须是严格 JSON，不要 Markdown，不要解释。

素材数据：
${JSON.stringify(input, null, 2)}

请只返回下面结构：
{
  "summary": "一句话概括画面",
  "mainSubject": "主视觉主体",
  "scene": "场景",
  "event": "正在发生的事件",
  "emotion": "情绪张力",
  "composition": "构图方式",
  "color": "色彩和光照",
  "hook": "用户第一眼会被什么吸引",
  "retainElements": ["建议保留的有效元素"],
  "variationAxes": ["后续可迭代变量"],
  "riskNotes": ["画面或投放风险"],
  "suggestedDirection": "建议沉淀到的方向名称"
}

判断要求：
1. 不要只复述素材名称，必须基于图片内容判断。
2. 结合 D0 ROI、CPI、IPM、CTR、CVR 判断哪些画面元素值得保留或需要修正。
3. retainElements、variationAxes、riskNotes 每项最多 6 条，每条保持短句。
4. suggestedDirection 使用“一级方向 / 二级方向”的短格式。`;
}

module.exports = {
    buildVisionInput,
    buildVisionPrompt
};
