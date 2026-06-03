const {
    buildHealthContext,
    classifyMaterial,
    isFiniteNumber,
    toNumber
} = require('./health-score');

function sum(items, key) {
    return items.reduce((total, item) => total + (isFiniteNumber(item[key]) ? Number(item[key]) : 0), 0);
}

function weightedAverage(items, key, weightKey = 'spend') {
    let weightedSum = 0;
    let weightSum = 0;
    for (const item of items) {
        const value = toNumber(item[key]);
        if (value === null) continue;
        const weight = Math.max(0, toNumber(item[weightKey]) || 0);
        if (weight <= 0) continue;
        weightedSum += value * weight;
        weightSum += weight;
    }
    if (weightSum > 0) return weightedSum / weightSum;

    const values = items.map(item => toNumber(item[key])).filter(value => value !== null);
    if (!values.length) return null;
    return values.reduce((total, value) => total + value, 0) / values.length;
}

function weightedHealthScore(items = []) {
    let weightedSum = 0;
    let weightSum = 0;
    for (const item of items) {
        const score = toNumber(item.health && item.health.score);
        if (score === null) continue;
        const weight = Math.max(0, toNumber(item.spend) || 0);
        if (weight <= 0) continue;
        weightedSum += score * weight;
        weightSum += weight;
    }
    if (weightSum > 0) return weightedSum / weightSum;

    const scores = items
        .map(item => toNumber(item.health && item.health.score))
        .filter(score => score !== null);
    if (!scores.length) return 0;
    return scores.reduce((total, score) => total + score, 0) / scores.length;
}

function directionKey(material = {}) {
    const parsed = material.parsedName || {};
    const primary = parsed.primary || '未解析';
    const secondary = parsed.secondary || '未分组';
    return `${primary}/${secondary}`;
}

function buildMaterialHealth(materials = []) {
    const context = buildHealthContext(materials);
    return materials.map(material => ({
        ...material,
        health: classifyMaterial(material, context)
    }));
}

function classifyDirection(row = {}, summary = {}) {
    const scoreBase = row.avgHealthScore || 0;
    const highSpendShare = row.spendShare >= 0.08;
    const d0Ready = row.d0IapRoi !== null && row.d0IapRoi !== undefined;
    let status = { key: 'watch', label: '控量观察', className: 'is-watch' };
    let action = '保持小步验证，优先补齐 D0 ROI 样本。';

    if (scoreBase >= 72 && d0Ready) {
        status = { key: 'scale', label: '继续放量', className: 'is-excellent' };
        action = '继续放量，并拆出 2-3 个变量做复刻。';
    } else if (scoreBase >= 62) {
        status = { key: 'replicate', label: '拆解复刻', className: 'is-good' };
        action = '保留高回收元素，做场景、主体、镜头变化。';
    } else if (highSpendShare && scoreBase < 45) {
        status = { key: 'pause', label: '暂停复刻', className: 'is-bad' };
        action = '高消耗但健康度偏弱，暂停简单重复。';
    } else if (scoreBase < 48) {
        status = { key: 'risk', label: '风险复盘', className: 'is-risk' };
        action = '先复盘素材承诺、主体清晰度和转化落差。';
    }

    if (summary.totalSpend > 0 && row.top100SpendShare >= 0.12 && scoreBase < 60) {
        action = '该方向占用较多头部消耗，需先控量并复盘有效变量。';
    }

    return {
        status,
        action
    };
}

function buildDirectionAnalysis(enrichedMaterials = [], top100 = [], summary = {}) {
    const top100Ids = new Set(top100.map(item => item.materialId));
    const totalSpend = summary.totalSpend || sum(enrichedMaterials, 'spend');
    const top100Spend = sum(top100, 'spend');
    const buckets = new Map();

    for (const material of enrichedMaterials) {
        const key = directionKey(material);
        if (!buckets.has(key)) {
            const [primary, secondary] = key.split('/');
            buckets.set(key, {
                directionKey: key,
                primary,
                secondary,
                materials: []
            });
        }
        buckets.get(key).materials.push(material);
    }

    return Array.from(buckets.values()).map(bucket => {
        const items = bucket.materials;
        const topItems = items.filter(item => top100Ids.has(item.materialId));
        const spend = sum(items, 'spend');
        const installs = sum(items, 'installs');
        const topSpend = sum(topItems, 'spend');
        const avgHealthScore = weightedHealthScore(items);
        const row = {
            directionKey: bucket.directionKey,
            primary: bucket.primary,
            secondary: bucket.secondary,
            materialCount: items.length,
            top100Count: topItems.length,
            spend,
            installs,
            spendShare: totalSpend > 0 ? spend / totalSpend : 0,
            top100SpendShare: top100Spend > 0 ? topSpend / top100Spend : 0,
            ctr: weightedAverage(items, 'ctr'),
            cvr: weightedAverage(items, 'cvr'),
            cpi: installs > 0 ? spend / installs : weightedAverage(items, 'cpi'),
            ipm: weightedAverage(items, 'ipm'),
            d0IapRoi: weightedAverage(items, 'd0IapRoi'),
            d7IapRoi: weightedAverage(items, 'd7IapRoi'),
            avgHealthScore,
            topMaterials: topItems
                .sort((a, b) => (Number(b.spend) || 0) - (Number(a.spend) || 0))
                .slice(0, 5)
                .map(item => ({
                    materialId: item.materialId,
                    materialName: item.materialName,
                    spend: item.spend,
                    health: item.health
                }))
        };
        const classification = classifyDirection(row, summary);
        return {
            ...row,
            status: classification.status,
            action: classification.action
        };
    }).sort((a, b) => (b.spend || 0) - (a.spend || 0));
}

function countBy(items = [], getter) {
    return items.reduce((acc, item) => {
        const key = getter(item);
        acc[key] = (acc[key] || 0) + 1;
        return acc;
    }, {});
}

function buildOverview(summary = {}, enrichedMaterials = [], enrichedTop100 = [], directions = []) {
    const topHealthCounts = countBy(enrichedTop100, item => item.health?.tag?.key || 'unknown');
    const levelCounts = countBy(enrichedTop100, item => item.health?.level?.key || 'unknown');
    const excellentMaterials = enrichedTop100
        .filter(item => ['high_spend_high_roi', 'low_spend_potential', 'replicable'].includes(item.health?.tag?.key))
        .slice(0, 10);
    const riskMaterials = enrichedTop100
        .filter(item => ['high_spend_low_roi', 'pause_repeat'].includes(item.health?.tag?.key))
        .slice(0, 10);
    const goodDirections = directions
        .filter(item => ['scale', 'replicate'].includes(item.status?.key))
        .slice(0, 10);
    const riskDirections = directions
        .filter(item => ['pause', 'risk'].includes(item.status?.key))
        .slice(0, 10);

    const avgTopHealth = enrichedTop100.length
        ? enrichedTop100.reduce((total, item) => total + (item.health ? item.health.score : 0), 0) / enrichedTop100.length
        : 0;
    let projectStatus = '回收观察期';
    if (avgTopHealth >= 70 && goodDirections.length >= 3) {
        projectStatus = '健康放量期';
    } else if ((summary.top10SpendShare || 0) >= 0.3 && goodDirections.length <= 2) {
        projectStatus = '单点依赖期';
    } else if (riskMaterials.length >= excellentMaterials.length && enrichedTop100.length > 0) {
        projectStatus = '高消耗风险期';
    } else if (goodDirections.length > riskDirections.length) {
        projectStatus = '方向分化增长期';
    }

    return {
        projectStatus,
        avgTopHealthScore: Math.round(avgTopHealth),
        topHealthCounts,
        levelCounts,
        excellentMaterials,
        riskMaterials,
        goodDirections,
        riskDirections,
        conclusion: buildConclusion(projectStatus, summary, excellentMaterials, riskMaterials, goodDirections, riskDirections)
    };
}

function buildConclusion(projectStatus, summary, excellentMaterials, riskMaterials, goodDirections, riskDirections) {
    const parts = [`当前判断：${projectStatus}。`];
    if ((summary.d0RoiCoverage || 0) < 0.5) {
        parts.push('D0 ROI 覆盖不足，健康度结论需要结合 CPI、IPM 继续观察。');
    } else {
        parts.push('D0 ROI 覆盖较可用，优先用它判断回收质量。');
    }
    if (excellentMaterials.length) {
        parts.push(`Top100 中有 ${excellentMaterials.length} 条素材进入可拆解池。`);
    }
    if (riskMaterials.length) {
        parts.push(`Top100 中有 ${riskMaterials.length} 条素材需要风险复盘。`);
    }
    if (goodDirections.length) {
        parts.push(`优先关注 ${goodDirections.slice(0, 3).map(item => item.directionKey).join('、')}。`);
    }
    if (riskDirections.length) {
        parts.push(`谨慎处理 ${riskDirections.slice(0, 3).map(item => item.directionKey).join('、')}。`);
    }
    return parts.join('');
}

function analyzeMaterialRun(summary = {}, materials = [], top100 = []) {
    const enrichedMaterials = buildMaterialHealth(materials);
    const healthById = new Map(enrichedMaterials.map(item => [item.materialId, item.health]));
    const enrichedTop100 = top100.map(item => ({
        ...item,
        health: healthById.get(item.materialId) || classifyMaterial(item, buildHealthContext(materials))
    }));
    const directions = buildDirectionAnalysis(enrichedMaterials, enrichedTop100, summary);
    const overview = buildOverview(summary, enrichedMaterials, enrichedTop100, directions);

    return {
        overview,
        directions,
        materials: enrichedMaterials,
        top100: enrichedTop100
    };
}

module.exports = {
    analyzeMaterialRun,
    buildMaterialHealth,
    buildDirectionAnalysis,
    buildOverview
};
