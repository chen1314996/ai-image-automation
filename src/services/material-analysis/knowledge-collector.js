const path = require('path');
const crypto = require('crypto');
const { MaterialAnalysisService } = require('./importer');
const { MaterialAnalysisStore } = require('./store');
const { MaterialVisionCache } = require('./vision/vision-cache');
const { CreativeKnowledgeStore } = require('../creative-knowledge/store');
const {
    emptyCreativeMemory,
    normalizeMemory,
    normalizeRule,
    refreshMemoryStats
} = require('../creative-knowledge/feedback-learning');

const VERSION = 's8-material-analysis-knowledge-v1';
const POSITIVE_TAGS = new Set(['high_spend_high_roi', 'low_spend_potential', 'replicable']);
const RISK_TAGS = new Set(['high_spend_low_roi', 'pause_repeat']);
const POSITIVE_DIRECTION_STATUS = new Set(['scale', 'replicate']);
const RISK_DIRECTION_STATUS = new Set(['pause', 'risk']);

function nowIso() {
    return new Date().toISOString();
}

function safeArray(value) {
    return Array.isArray(value) ? value : [];
}

function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function hashId(prefix, values = []) {
    const hash = crypto
        .createHash('sha1')
        .update(values.map(value => String(value || '')).join('|'))
        .digest('hex')
        .slice(0, 14);
    return `${prefix}_${hash}`;
}

function normalizeForMatch(value) {
    return normalizeText(value)
        .toLowerCase()
        .replace(/[\\/_\-\s.()[\]{}【】（）]/g, '');
}

function splitDirection(value) {
    return normalizeText(value)
        .split('/')
        .map(part => part.trim())
        .filter(Boolean);
}

function materialDirectionKey(material = {}) {
    const parsed = material.parsedName || {};
    return [parsed.primary, parsed.secondary, parsed.idea]
        .map(normalizeText)
        .filter(Boolean)
        .join('/') || normalizeText(material.materialName || material.materialId || '未解析方向');
}

function compactMetrics(source = {}) {
    return {
        spend: Number(source.spend) || 0,
        d0IapRoi: Number.isFinite(Number(source.d0IapRoi)) ? Number(source.d0IapRoi) : null,
        d7IapRoi: Number.isFinite(Number(source.d7IapRoi)) ? Number(source.d7IapRoi) : null,
        cpi: Number.isFinite(Number(source.cpi)) ? Number(source.cpi) : null,
        ipm: Number.isFinite(Number(source.ipm)) ? Number(source.ipm) : null,
        ctr: Number.isFinite(Number(source.ctr)) ? Number(source.ctr) : null,
        cvr: Number.isFinite(Number(source.cvr)) ? Number(source.cvr) : null
    };
}

function compactVisualInsight(result = null) {
    const vision = result && result.vision ? result.vision : {};
    return {
        summary: normalizeText(vision.summary).slice(0, 500),
        mainSubject: normalizeText(vision.mainSubject).slice(0, 160),
        scene: normalizeText(vision.scene).slice(0, 160),
        hook: normalizeText(vision.hook).slice(0, 240),
        suggestedDirection: normalizeText(vision.suggestedDirection).slice(0, 240),
        retainElements: safeArray(vision.retainElements).map(normalizeText).filter(Boolean).slice(0, 8),
        variationAxes: safeArray(vision.variationAxes).map(normalizeText).filter(Boolean).slice(0, 8),
        riskNotes: safeArray(vision.riskNotes).map(normalizeText).filter(Boolean).slice(0, 8)
    };
}

function emptyMaterialLearnings() {
    return {
        version: 1,
        learnings: [],
        updatedAt: nowIso()
    };
}

function readJsonWithFallback(store, fileName, fallback) {
    try {
        return store.read(fileName, fallback);
    } catch {
        return fallback;
    }
}

function directionMatchScore(direction = {}, directionKey = '') {
    const directionPath = normalizeForMatch(direction.path || direction.name || direction.id);
    const key = normalizeForMatch(directionKey);
    if (!directionPath || !key) return 0;
    if (directionPath === key) return 100;
    if (directionPath.includes(key) || key.includes(directionPath)) return 80;
    const parts = splitDirection(directionKey).map(normalizeForMatch).filter(Boolean);
    return parts.reduce((score, part) => score + (directionPath.includes(part) ? 12 : 0), 0);
}

function findKnowledgeDirection(directions = [], directionKey = '') {
    return safeArray(directions)
        .map(direction => ({
            direction,
            score: directionMatchScore(direction, directionKey)
        }))
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score)[0]?.direction || null;
}

function inferMaterialDecision(material = {}, fallback = 'positive') {
    const tag = material.health && material.health.tag && material.health.tag.key;
    if (POSITIVE_TAGS.has(tag)) return 'positive';
    if (RISK_TAGS.has(tag)) return 'negative';
    return fallback;
}

function inferDirectionDecision(direction = {}, fallback = 'positive') {
    const status = direction.status && direction.status.key;
    if (POSITIVE_DIRECTION_STATUS.has(status)) return 'positive';
    if (RISK_DIRECTION_STATUS.has(status)) return 'negative';
    return fallback;
}

function ensureConfirmed(payload = {}) {
    if (payload.dryRun === true) return false;
    if (payload.confirm === true || payload.confirmed === true) return true;
    const error = new Error('写入长期知识库需要人工确认，请传 confirm=true');
    error.needsConfirmation = true;
    throw error;
}

function learningKey(entry = {}) {
    return [
        entry.source,
        entry.runId,
        entry.directionKey,
        entry.materialId || entry.directionKey,
        entry.decision
    ].filter(Boolean).join('|');
}

function emptyDirectionDrafts() {
    return {
        version: 1,
        drafts: [],
        updatedAt: nowIso()
    };
}

function compactPromptList(prompts = []) {
    return safeArray(prompts)
        .map((prompt, index) => {
            if (typeof prompt === 'string') {
                return {
                    index: index + 1,
                    title: `提示词${index + 1}`,
                    prompt: normalizeText(prompt).slice(0, 10000)
                };
            }
            return {
                index: Number(prompt.index) || index + 1,
                title: normalizeText(prompt.title || prompt.promptTitle || `提示词${index + 1}`).slice(0, 80),
                prompt: normalizeText(prompt.prompt || prompt.finalPrompt).slice(0, 10000)
            };
        })
        .filter(item => item.prompt);
}

function splitDirectionPath(value) {
    return String(value || '')
        .split('/')
        .map(part => part.trim())
        .filter(Boolean);
}

function buildDirectionDescription({ directionKey = '', visualInsight = {}, sourceAction = '' }) {
    const parts = splitDirectionPath(directionKey);
    const name = parts[parts.length - 1] || directionKey || '素材分析方向';
    const subject = normalizeText(visualInsight.mainSubject) || '核心主体';
    const scene = normalizeText(visualInsight.scene) || '关键场景';
    const hook = normalizeText(visualInsight.hook || visualInsight.summary || sourceAction);
    const retain = safeArray(visualInsight.retainElements).slice(0, 4).join('、');
    const axes = safeArray(visualInsight.variationAxes).slice(0, 3).join('、');
    return [
        `画面核心为${subject}在${scene}中呈现「${name}」方向。`,
        hook ? `重点突出${hook}。` : '',
        retain ? `可保留${retain}等直观视觉元素。` : '',
        axes ? `后续可沿${axes}做变化。` : ''
    ].filter(Boolean).join('');
}

function buildMustKeep(visualInsight = {}) {
    return safeArray(visualInsight.retainElements).slice(0, 6).join('、');
}

function buildMustAvoid(visualInsight = {}) {
    return safeArray(visualInsight.riskNotes).slice(0, 6).join('、');
}

function formatPercent(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '--';
    return `${Math.round(number * 10000) / 100}%`;
}

function buildRiskReason({ material, direction, visualInsight, payload = {} }) {
    const explicit = normalizeText(payload.reason || payload.memoryReason);
    if (explicit) return explicit.slice(0, 800);
    if (material) {
        const action = normalizeText(material.health && material.health.action);
        const risk = safeArray(visualInsight.riskNotes).join('、');
        return [
            action || '高消耗或回收偏弱素材需要避免简单复刻',
            risk ? `视觉风险：${risk}` : '',
            Number.isFinite(Number(material.d0IapRoi)) ? `D0 ROI ${formatPercent(material.d0IapRoi)}` : ''
        ].filter(Boolean).join('；').slice(0, 800);
    }
    return normalizeText(direction && direction.action) || '方向健康度偏弱，需要先复盘画面承诺、主体清晰度和转化落差';
}

class MaterialKnowledgeCollectorService {
    constructor(context = {}) {
        this.rootDir = context.ROOT_DIR || context.rootDir || process.cwd();
        this.logger = context.logger;
        this.materialStore = context.materialStore || new MaterialAnalysisStore(this.rootDir);
        this.materialService = context.materialService || new MaterialAnalysisService({
            rootDir: this.rootDir,
            logger: this.logger,
            store: this.materialStore
        });
        this.visionCache = context.visionCache || new MaterialVisionCache(this.rootDir);
        this.knowledgeDataDir = context.knowledgeDataDir || path.join(this.rootDir, 'data', 'creative-knowledge');
        this.knowledgeStore = context.knowledgeStore || new CreativeKnowledgeStore(this.knowledgeDataDir);
    }

    loadImport(runId) {
        const detail = this.materialService.getImport(runId);
        if (!detail.success) {
            throw new Error(detail.message || '素材分析导入记录不存在');
        }
        const visionPayload = this.visionCache.readRun(runId) || {
            status: {},
            results: []
        };
        const visionByMaterialId = new Map(safeArray(visionPayload.results).map(item => [item.materialId, item]));
        return {
            ...detail,
            visionPayload,
            visionByMaterialId
        };
    }

    findMaterial(materialId, runId = '') {
        const imports = runId
            ? [this.materialStore.findImport(runId)].filter(Boolean)
            : this.materialStore.listImports();
        for (const item of imports) {
            const detail = this.loadImport(item.runId);
            const material = safeArray(detail.top100).find(row => row.materialId === materialId) ||
                safeArray(detail.materials).find(row => row.materialId === materialId);
            if (material) {
                return {
                    detail,
                    material,
                    visionResult: detail.visionByMaterialId.get(materialId) || null
                };
            }
        }
        return null;
    }

    findDirection(directionKey, runId = '') {
        const decodedKey = decodeURIComponent(directionKey || '');
        const imports = runId
            ? [this.materialStore.findImport(runId)].filter(Boolean)
            : this.materialStore.listImports();
        for (const item of imports) {
            const detail = this.loadImport(item.runId);
            const direction = safeArray(detail.directions).find(row => row.directionKey === decodedKey);
            if (direction) {
                return { detail, direction };
            }
        }
        return null;
    }

    readKnowledgeDirections() {
        this.knowledgeStore.ensureBase();
        return safeArray(readJsonWithFallback(this.knowledgeStore, 'directions.json', { directions: [] }).directions);
    }

    readLearningData() {
        this.knowledgeStore.ensureBase();
        return readJsonWithFallback(this.knowledgeStore, 'material-learnings.json', emptyMaterialLearnings());
    }

    writeLearningData(data) {
        const timestamp = nowIso();
        this.knowledgeStore.write('material-learnings.json', {
            ...data,
            version: data.version || 1,
            learnings: safeArray(data.learnings),
            updatedAt: timestamp
        });
        return timestamp;
    }

    upsertLearnings(entries = [], write = true) {
        const learningData = this.readLearningData();
        const byKey = new Map(safeArray(learningData.learnings).map(entry => [learningKey(entry), entry]));
        const saved = [];
        safeArray(entries).forEach(entry => {
            const key = learningKey(entry);
            const existing = byKey.get(key);
            const next = {
                ...(existing || {}),
                ...entry,
                id: entry.id || (existing && existing.id) || entry.learningId || entry.evidenceId,
                learningId: entry.learningId || entry.id || (existing && existing.learningId) || entry.evidenceId,
                evidenceId: entry.evidenceId || entry.learningId || entry.id || (existing && existing.evidenceId),
                updatedAt: nowIso()
            };
            byKey.set(key, next);
            saved.push(next);
        });
        const nextData = {
            ...learningData,
            learnings: Array.from(byKey.values())
        };
        if (write) {
            this.writeLearningData(nextData);
        }
        return saved;
    }

    readMemory() {
        this.knowledgeStore.ensureBase();
        return normalizeMemory(readJsonWithFallback(this.knowledgeStore, 'creative-memory.json', emptyCreativeMemory()));
    }

    writeMemory(memory) {
        const saved = refreshMemoryStats(normalizeMemory(memory));
        this.knowledgeStore.write('creative-memory.json', saved);
        return saved;
    }

    upsertRiskRules(evidenceEntries = [], payload = {}, write = true) {
        const memory = this.readMemory();
        const nodeRules = memory.rules.node && typeof memory.rules.node === 'object' ? memory.rules.node : {};
        memory.rules.global = safeArray(memory.rules.global);
        memory.rules.node = nodeRules;
        const saved = [];

        safeArray(evidenceEntries)
            .filter(entry => entry.decision === 'negative')
            .forEach(entry => {
                const riskNotes = safeArray(entry.visualInsight && entry.visualInsight.riskNotes).filter(Boolean);
                const target = normalizeText(entry.directionKey || entry.targetDirectionPath || entry.targetDirectionName);
                const title = normalizeText(payload.title || `规避 ${target || '素材分析风险'}`).slice(0, 120);
                const pattern = normalizeText(payload.target || riskNotes[0] || entry.reason || '高消耗低回收素材的画面表达').slice(0, 500);
                const sourceLearningId = entry.learningId || entry.evidenceId || entry.id;
                const ruleId = hashId('memory_rule', ['material-analysis', target, pattern, sourceLearningId]);
                const rule = normalizeRule({
                    ruleId,
                    scope: target ? 'node' : 'global',
                    type: 'avoid',
                    target,
                    title,
                    pattern,
                    rationale: entry.reason || '来自素材分析中人工确认的风险素材或风险方向。',
                    action: normalizeText(payload.action || `生成 ${target || '相关方向'} 时避开该风险表达，优先强化主体清晰度、承诺一致性和转化目标。`).slice(0, 500),
                    confidence: payload.confidence === 'high' ? 0.82 : (payload.confidence === 'low' ? 0.52 : Number(payload.confidence) || 0.68),
                    evidence: [
                        `${entry.weekId || ''} ${entry.materialName || entry.directionKey || ''}`.trim(),
                        entry.reason || '',
                        riskNotes.length ? `风险点：${riskNotes.join('、')}` : ''
                    ].filter(Boolean),
                    sourceFeedbackIds: [],
                    status: 'active',
                    enabled: true,
                    source: 'material-analysis',
                    version: VERSION,
                    createdAt: entry.createdAt || nowIso(),
                    updatedAt: nowIso()
                }, { status: 'active' });
                rule.sourceEvidenceIds = Array.from(new Set(safeArray(rule.sourceEvidenceIds).concat(sourceLearningId).filter(Boolean)));
                rule.sourceLearningIds = Array.from(new Set(safeArray(rule.sourceLearningIds).concat(sourceLearningId).filter(Boolean)));
                rule.affectedDirections = Array.from(new Set(safeArray(rule.affectedDirections).concat(entry.directionKey).filter(Boolean)));

                if (rule.scope === 'node') {
                    const bucket = safeArray(nodeRules[rule.target]).filter(item => item.ruleId !== rule.ruleId);
                    bucket.push(rule);
                    nodeRules[rule.target] = bucket;
                } else {
                    memory.rules.global = safeArray(memory.rules.global)
                        .filter(item => item.ruleId !== rule.ruleId)
                        .concat(rule);
                }
                saved.push(rule);
            });

        if (write && saved.length) {
            this.writeMemory(memory);
        }
        return saved;
    }

    buildMaterialLearning(found, payload = {}) {
        const { detail, material, visionResult } = found;
        const summary = detail.summary || {};
        const decision = normalizeText(payload.decision) || inferMaterialDecision(material, 'positive');
        const directionKey = normalizeText(payload.directionKey) || materialDirectionKey(material);
        const visualInsight = compactVisualInsight(visionResult);
        const reason = decision === 'negative'
            ? buildRiskReason({ material, visualInsight, payload })
            : normalizeText(payload.reason || payload.whyGood || material.health?.action || visualInsight.hook || '优秀素材已人工确认，值得复刻其视觉钩子和变化轴。').slice(0, 800);
        const learningId = hashId('learning', ['material-analysis', summary.runId, material.materialId, directionKey, decision]);
        return {
            id: learningId,
            learningId,
            evidenceId: learningId,
            source: 'material-analysis',
            version: VERSION,
            projectName: summary.projectName || material.projectName || '',
            weekId: summary.weekId || material.weekId || '',
            runId: summary.runId || material.runId || '',
            directionKey,
            targetDirectionId: '',
            targetDirectionPath: '',
            targetDirectionName: '',
            materialId: material.materialId || '',
            materialName: material.materialName || '',
            topRank: material.topRank || null,
            metrics: compactMetrics(material),
            health: material.health || null,
            visualInsight,
            decision,
            reason,
            status: 'collected',
            createdAt: nowIso()
        };
    }

    buildDirectionLearning(found, payload = {}) {
        const { detail, direction } = found;
        const summary = detail.summary || {};
        const decision = normalizeText(payload.decision) || inferDirectionDecision(direction, 'positive');
        const directionKey = direction.directionKey || decodeURIComponent(payload.directionKey || '');
        const topMaterialIds = safeArray(direction.topMaterials).map(item => item.materialId).filter(Boolean);
        const relatedVision = topMaterialIds
            .map(id => detail.visionByMaterialId.get(id))
            .filter(item => item && item.vision);
        const visualInsight = {
            summary: normalizeText(payload.visualSummary || direction.action || '').slice(0, 500),
            hook: safeArray(relatedVision.map(item => item.vision && item.vision.hook)).map(normalizeText).filter(Boolean)[0] || '',
            retainElements: Array.from(new Set(relatedVision.flatMap(item => safeArray(item.vision && item.vision.retainElements)).map(normalizeText).filter(Boolean))).slice(0, 8),
            variationAxes: Array.from(new Set(relatedVision.flatMap(item => safeArray(item.vision && item.vision.variationAxes)).map(normalizeText).filter(Boolean))).slice(0, 8),
            riskNotes: Array.from(new Set(relatedVision.flatMap(item => safeArray(item.vision && item.vision.riskNotes)).map(normalizeText).filter(Boolean))).slice(0, 8)
        };
        const reason = decision === 'negative'
            ? buildRiskReason({ direction, visualInsight, payload })
            : normalizeText(payload.reason || direction.action || '该方向在本周素材分析中表现较好，适合作为下一轮自动创意候选。').slice(0, 800);
        const learningId = hashId('learning', ['material-analysis-direction', summary.runId, directionKey, decision]);
        return {
            id: learningId,
            learningId,
            evidenceId: learningId,
            source: 'material-analysis',
            version: VERSION,
            projectName: summary.projectName || '',
            weekId: summary.weekId || '',
            runId: summary.runId || '',
            directionKey,
            targetDirectionId: '',
            targetDirectionPath: '',
            targetDirectionName: '',
            materialId: '',
            materialName: '',
            topMaterialIds,
            metrics: compactMetrics(direction),
            health: {
                status: direction.status || null,
                avgHealthScore: direction.avgHealthScore || 0,
                materialCount: direction.materialCount || 0,
                top100Count: direction.top100Count || 0
            },
            visualInsight,
            decision,
            reason,
            status: 'collected',
            createdAt: nowIso()
        };
    }

    collectMaterial(materialId, payload = {}) {
        const confirmed = ensureConfirmed(payload);
        const found = this.findMaterial(materialId, payload.runId || '');
        if (!found) {
            return {
                success: false,
                message: '素材不存在'
            };
        }
        const learning = this.buildMaterialLearning(found, payload);
        const learningEntries = this.upsertLearnings([learning], confirmed);
        const memoryRules = learning.decision === 'negative'
            ? this.upsertRiskRules(learningEntries, payload, confirmed)
            : [];
        return {
            success: true,
            dryRun: !confirmed,
            message: learning.decision === 'negative' ? '风险素材已写入素材经验和避坑规则' : '优秀素材已收录为素材经验',
            learning: learningEntries[0],
            evidence: learningEntries[0],
            memoryRules,
            material: found.material
        };
    }

    collectDirection(directionKey, payload = {}) {
        const confirmed = ensureConfirmed(payload);
        const found = this.findDirection(directionKey, payload.runId || '');
        if (!found) {
            return {
                success: false,
                message: '方向不存在'
            };
        }
        const learning = this.buildDirectionLearning(found, {
            ...payload,
            directionKey: decodeURIComponent(directionKey || '')
        });
        const learningEntries = this.upsertLearnings([learning], confirmed);
        const memoryRules = learning.decision === 'negative'
            ? this.upsertRiskRules(learningEntries, payload, confirmed)
            : [];
        return {
            success: true,
            dryRun: !confirmed,
            message: learning.decision === 'negative' ? '风险方向已写入素材经验和避坑规则' : '优秀方向已收录为素材经验',
            learning: learningEntries[0],
            evidence: learningEntries[0],
            memoryRules,
            direction: found.direction
        };
    }

    collectWeeklyLearnings(runId, payload = {}) {
        const confirmed = ensureConfirmed(payload);
        const detail = this.loadImport(runId);
        const positiveLimit = Math.max(1, Math.min(20, Number(payload.positiveLimit) || 3));
        const negativeLimit = Math.max(1, Math.min(20, Number(payload.negativeLimit) || 3));
        const excellentMaterials = safeArray(detail.overview && detail.overview.excellentMaterials);
        const riskMaterials = safeArray(detail.overview && detail.overview.riskMaterials);
        const goodDirections = safeArray(detail.overview && detail.overview.goodDirections);
        const riskDirections = safeArray(detail.overview && detail.overview.riskDirections);

        const positiveMaterialEntries = excellentMaterials.slice(0, positiveLimit).map(material => this.buildMaterialLearning({
            detail,
            material,
            visionResult: detail.visionByMaterialId.get(material.materialId) || null
        }, { ...payload, decision: 'positive' }));
        const positiveDirectionEntries = goodDirections
            .slice(0, Math.max(0, positiveLimit - positiveMaterialEntries.length))
            .map(direction => this.buildDirectionLearning({ detail, direction }, { ...payload, decision: 'positive' }));
        const negativeMaterialEntries = riskMaterials.slice(0, negativeLimit).map(material => this.buildMaterialLearning({
            detail,
            material,
            visionResult: detail.visionByMaterialId.get(material.materialId) || null
        }, { ...payload, decision: 'negative' }));
        const negativeDirectionEntries = riskDirections
            .slice(0, Math.max(0, negativeLimit - negativeMaterialEntries.length))
            .map(direction => this.buildDirectionLearning({ detail, direction }, { ...payload, decision: 'negative' }));
        const entries = positiveMaterialEntries
            .concat(positiveDirectionEntries)
            .concat(negativeMaterialEntries)
            .concat(negativeDirectionEntries);
        const savedLearnings = this.upsertLearnings(entries, confirmed);
        const memoryRules = this.upsertRiskRules(savedLearnings, payload, confirmed);
        return {
            success: true,
            dryRun: !confirmed,
            message: `本周经验已沉淀：正向素材经验 ${savedLearnings.filter(item => item.decision !== 'negative').length} 条，负向避坑 ${memoryRules.length} 条`,
            summary: detail.summary,
            positiveLearningCount: savedLearnings.filter(item => item.decision !== 'negative').length,
            negativeLearningCount: savedLearnings.filter(item => item.decision === 'negative').length,
            positiveEvidenceCount: savedLearnings.filter(item => item.decision !== 'negative').length,
            negativeEvidenceCount: savedLearnings.filter(item => item.decision === 'negative').length,
            memoryRuleCount: memoryRules.length,
            learnings: savedLearnings,
            evidence: savedLearnings,
            memoryRules
        };
    }

    readDirectionDrafts() {
        this.knowledgeStore.ensureBase();
        return readJsonWithFallback(this.knowledgeStore, 'direction-drafts.json', emptyDirectionDrafts());
    }

    writeDirectionDrafts(data) {
        const timestamp = nowIso();
        this.knowledgeStore.write('direction-drafts.json', {
            ...data,
            version: data.version || 1,
            drafts: safeArray(data.drafts),
            updatedAt: timestamp
        });
        return timestamp;
    }

    findLearning(learningId) {
        const id = normalizeText(learningId);
        if (!id) return null;
        return safeArray(this.readLearningData().learnings)
            .find(item => item && (item.learningId === id || item.id === id || item.evidenceId === id)) || null;
    }

    listLearnings(query = {}) {
        const data = this.readLearningData();
        const keyword = normalizeText(query.q || query.keyword).toLowerCase();
        const decision = normalizeText(query.decision).toLowerCase();
        const runId = normalizeText(query.runId);
        const status = normalizeText(query.status).toLowerCase();
        const offset = Math.max(0, Math.floor(Number(query.offset) || 0));
        const limit = Math.max(1, Math.min(500, Math.floor(Number(query.limit) || 100)));
        let learnings = safeArray(data.learnings).slice();
        if (keyword) {
            learnings = learnings.filter(item => [
                item.materialName,
                item.directionKey,
                item.reason,
                item.visualInsight && item.visualInsight.summary,
                item.visualInsight && item.visualInsight.hook
            ].some(value => String(value || '').toLowerCase().includes(keyword)));
        }
        if (decision) {
            learnings = learnings.filter(item => String(item.decision || '').toLowerCase() === decision);
        }
        if (runId) {
            learnings = learnings.filter(item => item.runId === runId);
        }
        if (status) {
            learnings = learnings.filter(item => String(item.status || '').toLowerCase() === status);
        }
        learnings.sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
        return {
            success: true,
            updatedAt: data.updatedAt || '',
            total: learnings.length,
            offset,
            limit,
            learnings: learnings.slice(offset, offset + limit)
        };
    }

    buildDirectionDraftFromLearning(learning = {}, payload = {}) {
        const directionKey = normalizeText(payload.directionKey || learning.directionKey || learning.targetDirectionPath);
        const pathParts = splitDirectionPath(directionKey);
        const name = normalizeText(payload.name || pathParts[pathParts.length - 1] || learning.materialName || '素材分析方向').slice(0, 120);
        const pathValue = normalizeText(payload.path || directionKey || name);
        const nextParts = splitDirectionPath(pathValue);
        const visualInsight = learning.visualInsight || {};
        const description = normalizeText(payload.description || buildDirectionDescription({
            directionKey: pathValue,
            visualInsight,
            sourceAction: learning.reason
        })).slice(0, 1200);
        const draftId = hashId('draft_material', [
            learning.learningId || learning.id || learning.evidenceId,
            pathValue,
            name,
            description
        ]);
        return {
            id: draftId,
            status: 'draft',
            name,
            path: pathValue,
            description,
            primaryTag: normalizeText(payload.primaryTag || nextParts[0]).slice(0, 80),
            secondaryTag: normalizeText(payload.secondaryTag || nextParts[1]).slice(0, 80),
            tertiaryTag: normalizeText(payload.tertiaryTag || nextParts[2]).slice(0, 80),
            subTag: normalizeText(payload.subTag || nextParts.slice(3).join('/')).slice(0, 160),
            source: 'material-analysis',
            sourceRunId: learning.runId || '',
            sourceAgentTaskRunId: '',
            sourceDirectionId: '',
            sourceDirectionPath: learning.directionKey || '',
            sourceDirectionName: name,
            sourceStrategy: normalizeText(payload.sourceStrategy || learning.reason || '从素材分析经验中人工选择为候选方向。').slice(0, 1200),
            sourceLearningId: learning.learningId || learning.id || learning.evidenceId || '',
            sourceMaterialId: learning.materialId || '',
            sourceMaterialName: learning.materialName || '',
            sourceProjectName: learning.projectName || '',
            sourceWeekId: learning.weekId || '',
            referenceHints: safeArray(payload.referenceHints).length
                ? safeArray(payload.referenceHints).map(normalizeText).filter(Boolean).slice(0, 12)
                : Array.from(new Set([
                    ...safeArray(visualInsight.retainElements),
                    ...safeArray(visualInsight.variationAxes)
                ].map(normalizeText).filter(Boolean))).slice(0, 12),
            mustKeep: normalizeText(payload.mustKeep || buildMustKeep(visualInsight)).slice(0, 800),
            mustAvoid: normalizeText(payload.mustAvoid || buildMustAvoid(visualInsight)).slice(0, 800),
            referenceImageStatus: 'manual_pending',
            prompts: compactPromptList(payload.prompts).slice(0, 5),
            similarDirections: [],
            createdAt: nowIso(),
            updatedAt: nowIso()
        };
    }

    upsertDirectionDraft(draft, write = true) {
        const draftData = this.readDirectionDrafts();
        const timestamp = nowIso();
        const nextDraft = {
            ...draft,
            updatedAt: timestamp,
            createdAt: draft.createdAt || timestamp
        };
        const drafts = safeArray(draftData.drafts).slice();
        const index = drafts.findIndex(item => item && item.id === nextDraft.id);
        if (index >= 0) {
            drafts[index] = {
                ...drafts[index],
                ...nextDraft,
                status: drafts[index].status && drafts[index].status !== 'draft' ? drafts[index].status : nextDraft.status
            };
        } else {
            drafts.push(nextDraft);
        }
        if (write) {
            this.writeDirectionDrafts({
                ...draftData,
                drafts
            });
        }
        return index >= 0 ? drafts[index] : nextDraft;
    }

    attachDraftToLearning(learning, draft, write = true) {
        const next = {
            ...learning,
            status: 'draft_created',
            directionDraftId: draft.id,
            directionDraftPath: draft.path,
            updatedAt: nowIso()
        };
        this.upsertLearnings([next], write);
        return next;
    }

    createDirectionDraftFromLearning(learningId, payload = {}) {
        const confirmed = ensureConfirmed(payload);
        const learning = this.findLearning(learningId);
        if (!learning) {
            return {
                success: false,
                message: '素材经验不存在'
            };
        }
        const draft = this.buildDirectionDraftFromLearning(learning, payload);
        const savedDraft = this.upsertDirectionDraft(draft, confirmed);
        const nextLearning = this.attachDraftToLearning(learning, savedDraft, confirmed);
        return {
            success: true,
            dryRun: !confirmed,
            message: '已转为本地成长方向草案，参考图待手动上传',
            draft: savedDraft,
            learning: nextLearning
        };
    }

    createMaterialDirectionDraft(materialId, payload = {}) {
        const confirmed = ensureConfirmed(payload);
        const found = this.findMaterial(materialId, payload.runId || '');
        if (!found) {
            return {
                success: false,
                message: '素材不存在'
            };
        }
        const learning = this.buildMaterialLearning(found, {
            ...payload,
            decision: normalizeText(payload.decision) || 'positive'
        });
        const savedLearning = this.upsertLearnings([learning], confirmed)[0];
        const draft = this.buildDirectionDraftFromLearning(savedLearning, payload);
        const savedDraft = this.upsertDirectionDraft(draft, confirmed);
        const nextLearning = this.attachDraftToLearning(savedLearning, savedDraft, confirmed);
        return {
            success: true,
            dryRun: !confirmed,
            message: '素材已转为本地成长方向草案，参考图待手动上传',
            draft: savedDraft,
            learning: nextLearning,
            material: found.material
        };
    }

    createDirectionDraft(directionKey, payload = {}) {
        const confirmed = ensureConfirmed(payload);
        const found = this.findDirection(directionKey, payload.runId || '');
        if (!found) {
            return {
                success: false,
                message: '方向不存在'
            };
        }
        const learning = this.buildDirectionLearning(found, {
            ...payload,
            decision: normalizeText(payload.decision) || 'positive',
            directionKey: decodeURIComponent(directionKey || '')
        });
        const savedLearning = this.upsertLearnings([learning], confirmed)[0];
        const draft = this.buildDirectionDraftFromLearning(savedLearning, payload);
        const savedDraft = this.upsertDirectionDraft(draft, confirmed);
        const nextLearning = this.attachDraftToLearning(savedLearning, savedDraft, confirmed);
        return {
            success: true,
            dryRun: !confirmed,
            message: '方向已转为本地成长方向草案，参考图待手动上传',
            draft: savedDraft,
            learning: nextLearning,
            direction: found.direction
        };
    }
}

function createMaterialKnowledgeCollectorService(context = {}) {
    return new MaterialKnowledgeCollectorService(context);
}

module.exports = {
    VERSION,
    MaterialKnowledgeCollectorService,
    createMaterialKnowledgeCollectorService,
    materialDirectionKey,
    compactMetrics,
    compactVisualInsight
};
