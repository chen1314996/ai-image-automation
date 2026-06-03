const fs = require('fs');
const path = require('path');
const { MaterialAnalysisService } = require('./importer');
const { MaterialVisionCache } = require('./vision/vision-cache');
const { safeSegment } = require('./store');

const DEFAULT_REQUEST = '请输出 3 个新方向，每个方向 4 条 Legil 提示词';
const DEFAULT_WEEKLY_PLAN_REQUEST = '请逐个执行 creativeTargets：每个原始方向输出 3 个差异化新方向，每个新方向输出 4 组可直接给 Legil 使用的中文画面提示词。';
const DEFAULT_VARIATION_AXES = ['场景', '人物关系', '道具', '镜头'];
const DEFAULT_AVOID_RULES = ['主体过小', '危险关系不清', '画面承诺与转化落差过大'];

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath, data) {
    ensureDir(path.dirname(filePath));
    const tempPath = `${filePath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tempPath, filePath);
}

function toNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function formatNumber(value, digits = 2) {
    const number = toNumber(value);
    if (number === null) return '--';
    return new Intl.NumberFormat('zh-CN', {
        maximumFractionDigits: digits
    }).format(number);
}

function formatPercent(value, digits = 2) {
    const number = toNumber(value);
    if (number === null) return '--';
    return new Intl.NumberFormat('zh-CN', {
        style: 'percent',
        maximumFractionDigits: digits
    }).format(number);
}

function compactText(value) {
    return String(value || '').trim();
}

function uniqueList(values = [], limit = 8) {
    const seen = new Set();
    const output = [];
    for (const value of values.flat()) {
        const text = compactText(value);
        if (!text || seen.has(text)) continue;
        seen.add(text);
        output.push(text);
        if (output.length >= limit) break;
    }
    return output;
}

function directionPathFromMaterial(material = {}) {
    const parsed = material.parsedName || {};
    return [parsed.primary, parsed.secondary, parsed.idea]
        .map(compactText)
        .filter(Boolean)
        .join('/');
}

function directionKeyFromMaterial(material = {}) {
    const parsed = material.parsedName || {};
    return [parsed.primary, parsed.secondary]
        .map(compactText)
        .filter(Boolean)
        .join('/');
}

function healthText(health = {}) {
    return compactText(health.tag && health.tag.label) ||
        compactText(health.level && health.level.label) ||
        compactText(health.action);
}

function materialPerformanceSummary(material = {}) {
    const metrics = [
        `花费 ${formatNumber(material.spend)}`,
        `安装 ${formatNumber(material.installs, 0)}`,
        `CTR ${formatPercent(material.ctr)}`,
        `CVR ${formatPercent(material.cvr)}`,
        `CPI ${formatNumber(material.cpi)}`,
        `IPM ${formatNumber(material.ipm)}`,
        `D0 ROI ${formatPercent(material.d0IapRoi)}`
    ];
    const health = healthText(material.health);
    const action = compactText(material.health && material.health.action);
    return uniqueList([
        metrics.join('，'),
        health ? `健康判断：${health}` : '',
        action ? `建议：${action}` : ''
    ], 3).join('；');
}

function directionPerformanceSummary(direction = {}) {
    const metrics = [
        `方向素材 ${formatNumber(direction.materialCount, 0)} 条`,
        `Top100 ${formatNumber(direction.top100Count, 0)} 条`,
        `花费 ${formatNumber(direction.spend)}`,
        `安装 ${formatNumber(direction.installs, 0)}`,
        `消耗占比 ${formatPercent(direction.spendShare)}`,
        `Top100 消耗占比 ${formatPercent(direction.top100SpendShare)}`,
        `CPI ${formatNumber(direction.cpi)}`,
        `IPM ${formatNumber(direction.ipm)}`,
        `D0 ROI ${formatPercent(direction.d0IapRoi)}`,
        `健康分 ${formatNumber(direction.avgHealthScore, 0)}`
    ];
    const status = compactText(direction.status && direction.status.label);
    const action = compactText(direction.action);
    return uniqueList([
        metrics.join('，'),
        status ? `方向判断：${status}` : '',
        action ? `建议：${action}` : ''
    ], 3).join('；');
}

function visualInsightFromResult(result = null) {
    if (!result) return '视觉识别尚未完成，先按素材名称、方向和投放指标生成 brief。';
    if (result.status !== 'success') {
        const message = compactText(result.userMessage || result.error || result.errorDetail);
        return message ? `视觉识别失败或待补充：${message}` : '视觉识别失败或待补充。';
    }
    const vision = result.vision || {};
    return uniqueList([
        vision.summary,
        vision.mainSubject ? `主体：${vision.mainSubject}` : '',
        vision.scene ? `场景：${vision.scene}` : '',
        vision.event ? `事件：${vision.event}` : '',
        vision.hook ? `钩子：${vision.hook}` : '',
        result.iterationAdvice
    ], 6).join('；') || '视觉识别已完成，但没有返回可用洞察。';
}

function retainElementsFor(material = {}, vision = {}) {
    const parsed = material.parsedName || {};
    return uniqueList([
        Array.isArray(vision.retainElements) ? vision.retainElements : [],
        vision.hook,
        vision.mainSubject,
        vision.event,
        parsed.idea,
        parsed.secondary
    ], 6);
}

function variationAxesFor(vision = {}) {
    return uniqueList([
        Array.isArray(vision.variationAxes) ? vision.variationAxes : [],
        DEFAULT_VARIATION_AXES
    ], 6);
}

function avoidRulesFor(subject = {}, vision = {}) {
    return uniqueList([
        Array.isArray(vision.riskNotes) ? vision.riskNotes : [],
        subject.health && subject.health.action ? subject.health.action : '',
        subject.action,
        DEFAULT_AVOID_RULES
    ], 8);
}

function materialBriefFrom({ summary, material, visionResult }) {
    const vision = visionResult && visionResult.status === 'success' ? (visionResult.vision || {}) : {};
    return {
        source: 'material-analysis',
        projectName: summary.projectName || material.projectName || '',
        weekId: summary.weekId || material.weekId || '',
        runId: summary.runId || material.runId || '',
        target: 'material',
        materialId: material.materialId,
        materialName: material.materialName || '',
        directionKey: directionKeyFromMaterial(material),
        directionPath: directionPathFromMaterial(material),
        performanceSummary: materialPerformanceSummary(material),
        visualInsight: visualInsightFromResult(visionResult),
        retainElements: retainElementsFor(material, vision),
        variationAxes: variationAxesFor(vision),
        avoidRules: avoidRulesFor(material, vision),
        metrics: {
            spend: material.spend,
            installs: material.installs,
            ctr: material.ctr,
            cvr: material.cvr,
            cpi: material.cpi,
            ipm: material.ipm,
            d0IapRoi: material.d0IapRoi,
            d7IapRoi: material.d7IapRoi,
            health: material.health || null
        },
        request: DEFAULT_REQUEST,
        createdAt: new Date().toISOString()
    };
}

function directionBriefFrom({ summary, direction, materials, visionResults }) {
    const materialIds = new Set((direction.topMaterials || []).map(item => item.materialId));
    const relatedMaterials = materials
        .filter(material => materialIds.has(material.materialId) || directionKeyFromMaterial(material) === direction.directionKey)
        .sort((a, b) => (Number(b.spend) || 0) - (Number(a.spend) || 0))
        .slice(0, 8);
    const relatedVision = relatedMaterials
        .map(material => visionResults.get(material.materialId))
        .filter(result => result && result.status === 'success');
    const retain = uniqueList(relatedVision.map(result => result.vision && result.vision.retainElements), 8);
    const axes = uniqueList(relatedVision.map(result => result.vision && result.vision.variationAxes), 8);
    const risks = uniqueList(relatedVision.map(result => result.vision && result.vision.riskNotes), 8);
    const visualInsight = relatedVision.length
        ? uniqueList(relatedVision.map(result => visualInsightFromResult(result)), 4).join('；')
        : '该方向暂无成功视觉识别结果，先按方向指标、头部素材名称和健康判断生成 brief。';

    return {
        source: 'material-analysis',
        projectName: summary.projectName || '',
        weekId: summary.weekId || '',
        runId: summary.runId || '',
        target: 'direction',
        directionKey: direction.directionKey || '',
        directionPath: direction.directionKey || '',
        materialName: relatedMaterials.slice(0, 3).map(item => item.materialName).filter(Boolean).join('；'),
        performanceSummary: directionPerformanceSummary(direction),
        visualInsight,
        retainElements: retain.length ? retain : uniqueList(relatedMaterials.map(item => {
            const parsed = item.parsedName || {};
            return [parsed.secondary, parsed.idea].filter(Boolean);
        }), 6),
        variationAxes: axes.length ? axes : DEFAULT_VARIATION_AXES,
        avoidRules: risks.length ? risks : avoidRulesFor(direction),
        topMaterials: relatedMaterials.map(item => ({
            materialId: item.materialId,
            materialName: item.materialName,
            spend: item.spend,
            installs: item.installs,
            d0IapRoi: item.d0IapRoi,
            health: item.health || null
        })),
        metrics: {
            spend: direction.spend,
            installs: direction.installs,
            spendShare: direction.spendShare,
            top100SpendShare: direction.top100SpendShare,
            cpi: direction.cpi,
            ipm: direction.ipm,
            d0IapRoi: direction.d0IapRoi,
            avgHealthScore: direction.avgHealthScore,
            status: direction.status || null
        },
        request: DEFAULT_REQUEST,
        createdAt: new Date().toISOString()
    };
}

function creativeTargetFromBrief(brief = {}, index = 0, overrides = {}) {
    const targetId = compactText(overrides.targetId) ||
        `creative_target_${index + 1}_${String(brief.directionKey || brief.materialId || index + 1).replace(/[^\w\u4e00-\u9fa5-]+/g, '_').slice(0, 48)}`;
    const promptGroupsPerNewDirection = Number(overrides.promptGroupsPerNewDirection) || 4;
    const newDirectionsPerSource = Number(overrides.newDirectionsPerSource) || 3;
    return {
        targetId,
        targetType: brief.target || 'direction',
        sourceDirectionKey: brief.directionKey || brief.directionPath || '',
        sourceDirectionPath: brief.directionPath || brief.directionKey || '',
        materialName: brief.materialName || '',
        performanceSummary: brief.performanceSummary || '',
        visualSummary: brief.visualInsight || '',
        retainElements: Array.isArray(brief.retainElements) ? brief.retainElements : [],
        variationAxes: Array.isArray(brief.variationAxes) ? brief.variationAxes : DEFAULT_VARIATION_AXES,
        avoidRules: Array.isArray(brief.avoidRules) ? brief.avoidRules : DEFAULT_AVOID_RULES,
        seedMaterials: Array.isArray(brief.topMaterials) ? brief.topMaterials.slice(0, 5) : [],
        newDirectionsPerSource,
        promptGroupsPerNewDirection,
        task: `基于该原始方向输出 ${newDirectionsPerSource} 个差异化新方向，每个新方向输出 ${promptGroupsPerNewDirection} 组可直接给 Legil 使用的中文画面提示词。`
    };
}

function buildCreativeExpansionAgentInstruction(plan = {}) {
    const targets = Array.isArray(plan.creativeTargets) ? plan.creativeTargets : [];
    const targetLines = targets.map((target, index) => [
        `${index + 1}. 原始方向：${target.sourceDirectionPath || target.sourceDirectionKey || target.materialName || target.targetId}`,
        `   指标结论：${target.performanceSummary || '--'}`,
        `   视觉洞察：${target.visualSummary || '--'}`,
        `   必须保留：${(target.retainElements || []).join('、') || '--'}`,
        `   可变化轴：${(target.variationAxes || []).join('、') || '--'}`,
        `   避坑规则：${(target.avoidRules || []).join('、') || '--'}`,
        `   执行数量：${target.newDirectionsPerSource || 3} 个新方向 × ${target.promptGroupsPerNewDirection || 4} 组 Legil 提示词`
    ].join('\n')).join('\n\n');

    return [
        '# 素材分析创意拓展任务包',
        '你收到的是 material-analysis 生成的 creativeTargets 数组。不要猜“方向在哪”，方向就在下方每个 target 的“原始方向”字段里。',
        '',
        '# 执行规则',
        '1. 必须逐个 creativeTarget 执行，不要合并、跳过或只输出泛泛建议。',
        '2. 每个原始方向先拆出 3 个差异化新方向，新方向要明显改变场景机制、人物关系、道具或镜头。',
        '3. 每个新方向输出 4 组中文 Legil 画面提示词，每组提示词都要可直接用于生图。',
        '4. 每组提示词必须包含主体、动作、场景、危险/奖励关系、构图、光线、材质和广告可读性要求。',
        '5. 必须显式保留 retainElements，沿 variationAxes 变化，并避开 avoidRules。',
        '',
        '# 输出格式',
        '优先输出表格：原始方向｜新方向名称｜方向描述｜提示词1｜提示词2｜提示词3｜提示词4｜提示词5。',
        '',
        '# creativeTargets',
        targetLines || '暂无可执行方向。'
    ].join('\n');
}

class MaterialCreativeBriefService {
    constructor(context = {}) {
        this.rootDir = context.ROOT_DIR || context.rootDir || process.cwd();
        this.analysisService = context.analysisService || new MaterialAnalysisService(context);
        this.visionCache = context.visionCache || new MaterialVisionCache(this.rootDir);
    }

    getLatestRunId() {
        const list = this.analysisService.listImports().imports || [];
        return list[0] && list[0].runId ? list[0].runId : '';
    }

    getDetail(runId) {
        const targetRunId = compactText(runId) || this.getLatestRunId();
        if (!targetRunId) {
            return {
                success: false,
                message: '尚未找到素材分析导入记录'
            };
        }
        const detail = this.analysisService.getImport(targetRunId);
        if (!detail.success) return detail;
        return detail;
    }

    findMaterial(materialId, runId = '') {
        if (runId) {
            const detail = this.getDetail(runId);
            if (!detail.success) return detail;
            const material = detail.materials.find(item => item.materialId === materialId) ||
                detail.top100.find(item => item.materialId === materialId);
            if (!material) {
                return { success: false, message: '素材不存在' };
            }
            return { success: true, detail, material };
        }

        const imports = this.analysisService.listImports().imports || [];
        for (const item of imports) {
            const detail = this.analysisService.getImport(item.runId);
            if (!detail.success) continue;
            const material = detail.materials.find(row => row.materialId === materialId) ||
                detail.top100.find(row => row.materialId === materialId);
            if (material) {
                return { success: true, detail, material };
            }
        }
        return { success: false, message: '素材不存在' };
    }

    visionResultsById(runId) {
        const payload = this.visionCache.readRun(runId);
        const results = payload && Array.isArray(payload.results) ? payload.results : [];
        return new Map(results.map(result => [result.materialId, result]));
    }

    createMaterialBrief(materialId, payload = {}) {
        const found = this.findMaterial(materialId, payload.runId || payload.weekRunId || '');
        if (!found.success) return found;
        const runId = found.detail.summary.runId;
        const visionResults = this.visionResultsById(runId);
        const brief = materialBriefFrom({
            summary: found.detail.summary,
            material: found.material,
            visionResult: visionResults.get(found.material.materialId) || null
        });
        return {
            success: true,
            brief
        };
    }

    createDirectionBrief(directionKey, payload = {}) {
        const decodedKey = compactText(directionKey);
        const imports = payload.runId
            ? [{ runId: payload.runId }]
            : (this.analysisService.listImports().imports || []);
        for (const item of imports) {
            const detail = this.getDetail(item.runId);
            if (!detail.success) continue;
            const direction = detail.directions.find(row => row.directionKey === decodedKey);
            if (!direction) continue;
            const brief = directionBriefFrom({
                summary: detail.summary,
                direction,
                materials: detail.materials || [],
                visionResults: this.visionResultsById(detail.summary.runId)
            });
            return {
                success: true,
                brief
            };
        }
        return {
            success: false,
            message: '方向不存在'
        };
    }

    createCreativePlan(runId, payload = {}) {
        const detail = this.getDetail(runId);
        if (!detail.success) return detail;

        const requestedLimit = Number(payload.limit);
        const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
            ? Math.min(8, Math.floor(requestedLimit))
            : 5;
        const candidates = [
            ...((detail.overview && detail.overview.goodDirections) || []),
            ...(detail.directions || [])
        ];
        const seen = new Set();
        const selectedDirections = candidates
            .filter(direction => {
                const key = direction.directionKey;
                if (!key || seen.has(key)) return false;
                seen.add(key);
                return true;
            })
            .sort((a, b) => {
                const scoreDelta = (Number(b.avgHealthScore) || 0) - (Number(a.avgHealthScore) || 0);
                if (scoreDelta) return scoreDelta;
                return (Number(b.spend) || 0) - (Number(a.spend) || 0);
            })
            .slice(0, limit);
        const visionResults = this.visionResultsById(detail.summary.runId);
        const briefs = selectedDirections.map(direction => directionBriefFrom({
            summary: detail.summary,
            direction,
            materials: detail.materials || [],
            visionResults
        }));

        const plan = {
            source: 'material-analysis',
            packageType: 'creative-expansion-package',
            target: 'weekly-plan',
            planId: `creative_plan_${detail.summary.runId}_${Date.now()}`,
            projectName: detail.summary.projectName || '',
            weekId: detail.summary.weekId || '',
            runId: detail.summary.runId,
            intent: {
                mode: 'expand-source-directions',
                newDirectionsPerSource: 3,
                promptGroupsPerNewDirection: 4,
                outputTarget: 'creative-auto-agent'
            },
            performanceSummary: [
                `总花费 ${formatNumber(detail.summary.totalSpend)}`,
                `总安装 ${formatNumber(detail.summary.totalInstalls, 0)}`,
                `Top100 消耗占比 ${formatPercent(detail.summary.top100SpendShare)}`,
                `D0 ROI 覆盖 ${formatPercent(detail.summary.d0RoiCoverage)}`
            ].join('，'),
            visualInsight: briefs.length
                ? uniqueList(briefs.map(brief => brief.visualInsight), 5).join('；')
                : '暂无可生成计划的方向。',
            retainElements: uniqueList(briefs.map(brief => brief.retainElements), 10),
            variationAxes: uniqueList(briefs.map(brief => brief.variationAxes), 10),
            avoidRules: uniqueList(briefs.map(brief => brief.avoidRules), 10),
            briefs,
            creativeTargets: briefs.map((brief, index) => creativeTargetFromBrief(brief, index, {
                newDirectionsPerSource: 3,
                promptGroupsPerNewDirection: 4
            })),
            request: DEFAULT_WEEKLY_PLAN_REQUEST,
            createdAt: new Date().toISOString()
        };
        plan.agentInstructionText = buildCreativeExpansionAgentInstruction(plan);

        const outputPath = path.join(
            this.rootDir,
            'data',
            'material-analysis',
            'creative-plans',
            safeSegment(detail.summary.projectName, 'project'),
            safeSegment(detail.summary.weekId, 'week'),
            `${safeSegment(detail.summary.runId, 'run')}.json`
        );
        writeJson(outputPath, plan);

        return {
            success: true,
            plan,
            planPath: outputPath
        };
    }
}

function createMaterialCreativeBriefService(context) {
    return new MaterialCreativeBriefService(context);
}

module.exports = {
    createMaterialCreativeBriefService,
    MaterialCreativeBriefService,
    DEFAULT_REQUEST,
    DEFAULT_WEEKLY_PLAN_REQUEST,
    creativeTargetFromBrief,
    buildCreativeExpansionAgentInstruction
};
