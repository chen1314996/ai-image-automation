function normalizeForMatch(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[\\/_\-\s.()[\]{}【】（）]/g, '');
}

function splitPath(value) {
    return String(value || '').split('/').map(part => part.trim()).filter(Boolean);
}

function pathOverlapScore(directionPath, insightPath) {
    const directionParts = splitPath(directionPath).map(normalizeForMatch).filter(Boolean);
    const insightText = normalizeForMatch(insightPath);
    if (!directionParts.length || !insightText) {
        return 0;
    }

    return directionParts.reduce((score, part) => score + (insightText.includes(part) ? 1 : 0), 0);
}

function safeArray(value) {
    return Array.isArray(value) ? value : [];
}

function directionMatchScore(direction = {}, targetPath = '') {
    const directionPath = normalizeForMatch(direction.path || direction.name || direction.id);
    const target = normalizeForMatch(targetPath);
    if (!directionPath || !target) return 0;
    if (directionPath === target) return 100;
    if (directionPath.includes(target) || target.includes(directionPath)) return 80;
    return splitPath(targetPath)
        .map(normalizeForMatch)
        .filter(Boolean)
        .reduce((score, part) => score + (directionPath.includes(part) ? 12 : 0), 0);
}

function learningMatchesDirection(direction = {}, learning = {}) {
    if (learning.targetDirectionId && learning.targetDirectionId === direction.id) return true;
    return directionMatchScore(
        direction,
        learning.targetDirectionPath || learning.directionKey || learning.targetDirectionName
    ) >= 36;
}

function getMaterialLearningSummary(direction = {}, materialLearnings = []) {
    const matched = safeArray(materialLearnings)
        .filter(entry => entry && entry.source === 'material-analysis')
        .filter(entry => learningMatchesDirection(direction, entry));
    const positive = matched.filter(entry => entry.decision !== 'negative');
    const negative = matched.filter(entry => entry.decision === 'negative');
    const positiveScore = Math.min(18, positive.length * 6);
    const riskPenalty = Math.min(20, negative.length * 7);
    return {
        positive,
        negative,
        positiveScore,
        riskPenalty
    };
}

function memoryRuleMatchesDirection(direction = {}, rule = {}) {
    if (!rule || rule.enabled === false || rule.status === 'disabled') return false;
    if (rule.scope === 'global') return true;
    if (rule.scope === 'node' || rule.scope === 'dimension') {
        return directionMatchScore(direction, rule.target || '') >= 36;
    }
    return false;
}

function getMemoryRiskSummary(direction = {}, memoryRules = []) {
    const avoidRules = safeArray(memoryRules)
        .filter(rule => rule && rule.type === 'avoid')
        .filter(rule => memoryRuleMatchesDirection(direction, rule));
    return {
        avoidRules,
        penalty: Math.min(18, avoidRules.length * 5)
    };
}

function getBestInsight(direction, insights) {
    let best = null;

    for (const insight of insights || []) {
        const overlap = pathOverlapScore(direction.path, insight.pathKey);
        if (overlap <= 0) continue;

        const materialCount = Number(insight.materialCount) || 0;
        const avgCtr = Number(insight.avgCtr) || 0;
        const avgD7IapRoi = Number(insight.avgD7IapRoi) || 0;
        const score = overlap * 8
            + Math.min(18, Math.log1p(materialCount) * 3)
            + Math.min(12, avgCtr * 200)
            + Math.min(10, avgD7IapRoi * 40);

        if (!best || score > best.score) {
            best = {
                insight,
                overlap,
                score
            };
        }
    }

    return best;
}

function getFreshnessScore(lastRunAt) {
    if (!lastRunAt) {
        return 20;
    }

    const lastRunTime = Date.parse(lastRunAt);
    if (!Number.isFinite(lastRunTime)) {
        return 10;
    }

    const days = Math.max(0, (Date.now() - lastRunTime) / 86400000);
    return Math.min(18, days * 2);
}

function isRunnableDirection(direction = {}) {
    const status = String(direction.status || 'seed').trim().toLowerCase();
    return direction.autoRun !== false && ['seed', 'accepted'].includes(status);
}

function scoreDirection(direction, insights, options = {}) {
    const stats = direction.stats || {};
    const priorityScore = Number(direction.priority) || 50;
    const freshnessScore = getFreshnessScore(stats.lastRunAt);
    const bestInsight = getBestInsight(direction, insights);
    const topMaterialScore = bestInsight ? Math.min(35, bestInsight.score) : 0;
    const materialLearning = getMaterialLearningSummary(direction, options.materialLearnings || options.directionEvidence);
    const memoryRisk = getMemoryRiskSummary(direction, options.memoryRules);
    const coveragePenalty = (Number(stats.expandedCount) || 0) * 2
        + (Number(stats.imageCount) || 0) * 0.2;
    const failurePenalty = (Number(stats.failureCount) || 0) * 10;
    const score = priorityScore
        + freshnessScore
        + topMaterialScore
        + materialLearning.positiveScore
        - materialLearning.riskPenalty
        - memoryRisk.penalty
        - coveragePenalty
        - failurePenalty;
    const reasons = [];

    if (!stats.lastRunAt) reasons.push('未运行过');
    if (bestInsight) {
        reasons.push(`匹配 TOP 素材 ${bestInsight.insight.materialCount || 0} 条`);
    }
    if (materialLearning.positive.length) {
        reasons.push(`素材分析正向经验 ${materialLearning.positive.length} 条`);
    }
    if (materialLearning.negative.length) {
        reasons.push(`素材分析风险经验 ${materialLearning.negative.length} 条，已降权`);
    }
    if (memoryRisk.avoidRules.length) {
        reasons.push(`命中避坑规则 ${memoryRisk.avoidRules.length} 条，已降权`);
    }
    if ((Number(stats.failureCount) || 0) > 0) {
        reasons.push(`历史失败 ${stats.failureCount} 次，已降权`);
    }
    if ((Number(stats.imageCount) || 0) > 0) {
        reasons.push(`已有产图 ${stats.imageCount} 张，已做覆盖降权`);
    }
    if (!reasons.length) {
        reasons.push('默认优先级排序');
    }

    return {
        direction,
        score: Math.round(score * 100) / 100,
        scoreParts: {
            priorityScore,
            freshnessScore: Math.round(freshnessScore * 100) / 100,
            topMaterialScore: Math.round(topMaterialScore * 100) / 100,
            materialLearningScore: Math.round(materialLearning.positiveScore * 100) / 100,
            materialRiskPenalty: Math.round(materialLearning.riskPenalty * 100) / 100,
            memoryRiskPenalty: Math.round(memoryRisk.penalty * 100) / 100,
            coveragePenalty: Math.round(coveragePenalty * 100) / 100,
            failurePenalty: Math.round(failurePenalty * 100) / 100
        },
        materialLearning: {
            positiveCount: materialLearning.positive.length,
            riskCount: materialLearning.negative.length,
            examples: materialLearning.positive.slice(0, 3).map(entry => ({
                learningId: entry.learningId || entry.evidenceId || entry.id || '',
                weekId: entry.weekId || '',
                materialName: entry.materialName || '',
                reason: entry.reason || '',
                hook: entry.visualInsight && entry.visualInsight.hook ? entry.visualInsight.hook : ''
            })),
            risks: materialLearning.negative.slice(0, 3).map(entry => ({
                learningId: entry.learningId || entry.evidenceId || entry.id || '',
                weekId: entry.weekId || '',
                materialName: entry.materialName || '',
                reason: entry.reason || '',
                riskNotes: entry.visualInsight && Array.isArray(entry.visualInsight.riskNotes)
                    ? entry.visualInsight.riskNotes.slice(0, 3)
                    : []
            }))
        },
        memoryRiskRules: memoryRisk.avoidRules.slice(0, 3).map(rule => ({
            ruleId: rule.ruleId || '',
            title: rule.title || '',
            target: rule.target || '',
            pattern: rule.pattern || ''
        })),
        topMaterialInsight: bestInsight ? {
            pathKey: bestInsight.insight.pathKey,
            materialCount: bestInsight.insight.materialCount,
            avgCtr: bestInsight.insight.avgCtr,
            avgD7IapRoi: bestInsight.insight.avgD7IapRoi,
            topNames: (bestInsight.insight.topNames || []).slice(0, 5),
            keywords: (bestInsight.insight.keywords || []).slice(0, 10)
        } : null,
        reasons
    };
}

function selectNextDirection(directions, insights, options = {}) {
    const limit = Math.max(1, Math.min(50, Number(options.limit) || 10));
    const candidates = (directions || [])
        .filter(direction => direction && isRunnableDirection(direction))
        .map(direction => scoreDirection(direction, insights, options))
        .sort((a, b) => b.score - a.score);

    return {
        next: candidates[0] || null,
        candidates: candidates.slice(0, limit)
    };
}

module.exports = {
    scoreDirection,
    selectNextDirection
};
