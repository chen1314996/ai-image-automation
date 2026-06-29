const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const XLSX = require('xlsx');
const { readSecrets } = require('../../../secrets-store');
const { importDirections } = require('./direction-importer');
const { importTopMaterials } = require('./top-material-importer');
const { indexReferenceImages } = require('./reference-image-indexer');
const { CreativeKnowledgeStore, ensureDir } = require('./store');
const { extractWorkbookReferenceImages } = require('./workbook-reference-images');
const {
    buildFeedbackSamples,
    buildLearningMessages,
    callFeedbackLearningAgent,
    emptyCreativeMemory,
    getActiveMemoryRules,
    getAllMemoryRules,
    normalizeLearningReport,
    normalizeMemory,
    normalizeRule: normalizeMemoryRule,
    refreshMemoryStats,
    removeRuleFromBuckets,
    upsertDrafts
} = require('./feedback-learning');
const {
    DIRECTION_TAGS_FILE,
    buildDirectionTagRecords,
    buildDirectionTagsIndex,
    directionMatchKey,
    emptyDirectionTags,
    isCleanDirectionTag,
    normalizeTag,
    normalizeDirectionTagsForRecord
} = require('../direction-tags');

const DEFAULT_REFERENCE_FOLDER = 'D:\\工作\\自动化工作流1\\创意拓展\\参考图';
const REVIEW_STATUSES = new Set(['unreviewed', 'good', 'normal', 'bad', 'rejected']);
const REVIEWED_STATUSES = new Set(['good', 'normal', 'bad', 'rejected']);
const DIRECTION_STATUSES = new Set(['seed', 'draft', 'accepted', 'rejected', 'archived', 'disabled']);
const RUNNABLE_DIRECTION_STATUSES = new Set(['seed', 'accepted']);
const FEEDBACK_TAGS = [
    '跑题',
    '重复',
    '构图弱',
    '主体不清',
    '文字差',
    '风格不符',
    '过度科幻',
    '参考图未跟随',
    '可以量产',
    '可以拓展'
];
const REFERENCE_POOL_FILE = 'reference-images.json';
const REFERENCE_CHANGE_EVENTS_FILE = 'reference-change-events.json';
const REFERENCE_POOL_STATUSES = new Set(['active', 'archived', 'rejected', 'deleted']);
const REFERENCE_POOL_ROLES = {
    1: { roleTag: 'primary', label: '主视觉锚点', useFor: 'main_visual_anchor' },
    2: { roleTag: 'secondary', label: '差异参考', useFor: 'variation_reference' },
    3: { roleTag: 'detail', label: '细节参考', useFor: 'detail_reference' }
};
const REFERENCE_POOL_ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const REFERENCE_POOL_MAX_BYTES = 20 * 1024 * 1024;
const DIRECTION_TAG_REFERENCE_VISION_SOURCE = 'reference-vision';
const DIRECTION_TAG_REFERENCE_MAX_IMAGES = 3;
const DIRECTION_TAG_VISION_TIMEOUT_MS = 180000;
const DIRECTION_TAG_VISION_MAX_TOKENS = 1400;

function nowIso() {
    return new Date().toISOString();
}

function todayKey() {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
}

function resolvePath(rootDir, value) {
    const text = String(value || '').trim();
    if (!text) return '';
    return path.isAbsolute(text) ? path.normalize(text) : path.resolve(rootDir, text);
}

function buildDefaultConfig(rootDir, overrides = {}) {
    const sourceRoot = resolvePath(rootDir, overrides.sourceRoot || path.join(rootDir, 'sucai'));
    const dataDir = resolvePath(rootDir, overrides.dataDir || path.join(rootDir, 'data', 'creative-knowledge'));

    return {
        dataDir,
        sourceRoot,
        directionWorkbook: resolvePath(
            rootDir,
            overrides.directionWorkbook || path.join(sourceRoot, '创意方向种子表.xlsx')
        ),
        topMaterialsDir: resolvePath(
            rootDir,
            overrides.topMaterialsDir || path.join(sourceRoot, '分月TOP素材数据表')
        ),
        referenceFolder: resolvePath(rootDir, overrides.referenceFolder || DEFAULT_REFERENCE_FOLDER)
    };
}

function emptyAssets() {
    return {
        version: 1,
        assets: [],
        updatedAt: nowIso()
    };
}

function emptyFeedback() {
    return {
        version: 1,
        feedback: [],
        updatedAt: nowIso()
    };
}

function emptySchedulerState() {
    return {
        version: 1,
        status: 'idle',
        consecutiveFailures: 0,
        daily: {
            date: todayKey(),
            imageCount: 0,
            imageLimit: 1000
        },
        updatedAt: nowIso()
    };
}

function emptyDirectionDrafts() {
    return {
        version: 1,
        drafts: [],
        updatedAt: nowIso()
    };
}

function emptyDirectionEvidence() {
    return {
        version: 1,
        evidence: [],
        updatedAt: nowIso()
    };
}

function emptyMaterialLearnings() {
    return {
        version: 1,
        learnings: [],
        updatedAt: nowIso()
    };
}

function emptyReferenceChangeEvents() {
    return {
        version: 1,
        referenceChangeEvents: [],
        updatedAt: nowIso()
    };
}

function normalizeReferenceSlot(value, fallback = 1) {
    const slot = Math.round(Number(value) || fallback);
    if (slot < 1 || slot > 3) {
        throw new Error('参考图 slot 必须是 1、2 或 3');
    }
    return slot;
}

function normalizeReferenceStatus(value, fallback = 'active') {
    const status = String(value || '').trim().toLowerCase();
    return REFERENCE_POOL_STATUSES.has(status) ? status : fallback;
}

function referenceBelongsToDirection(image = {}, directionId = '') {
    const id = String(directionId || '');
    if (!id || !image) return false;
    if (String(image.directionId || '') === id) return true;
    return safeArray(image.matchedDirectionIds).some(matchedId => String(matchedId || '') === id);
}

function activeReferenceImagesForDirection(images = [], directionId = '', limit = 3) {
    const active = safeArray(images)
        .filter(image => referenceBelongsToDirection(image, directionId))
        .filter(image => normalizeReferenceStatus(image.status, image.deleted ? 'deleted' : 'active') === 'active')
        .sort((a, b) => normalizeReferenceSlot(a.slot || a.sourceSlot, 1) - normalizeReferenceSlot(b.slot || b.sourceSlot, 1));
    return limit ? active.slice(0, limit) : active;
}

function buildReferenceId(directionId, slot, seed) {
    const hash = crypto
        .createHash('sha1')
        .update([directionId, slot, seed, Date.now(), crypto.randomBytes(4).toString('hex')].join('|'))
        .digest('hex')
        .slice(0, 12);
    return `ref_pool_${hash}`;
}

function safeFileBaseName(value, fallback = 'reference') {
    const parsed = path.parse(String(value || fallback));
    return (parsed.name || fallback)
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
        .replace(/\s+/g, '_')
        .slice(0, 80) || fallback;
}

function validateReferenceImageFile(file = {}) {
    const filePath = file.filePath || '';
    const originalName = file.originalName || file.fileName || path.basename(filePath || '');
    const extension = path.extname(originalName || filePath).toLowerCase();
    if (!REFERENCE_POOL_ALLOWED_EXTENSIONS.has(extension)) {
        throw new Error(`参考图格式不支持：${extension || 'unknown'}`);
    }

    let size = Number(file.size) || 0;
    if (file.buffer) {
        size = file.buffer.length;
    } else {
        if (!filePath || !fs.existsSync(filePath)) {
            throw new Error('参考图文件不存在');
        }
        fs.accessSync(filePath, fs.constants.R_OK);
        const stats = fs.statSync(filePath);
        if (!stats.isFile()) {
            throw new Error('参考图路径不是文件');
        }
        size = stats.size;
        const fd = fs.openSync(filePath, 'r');
        const probe = Buffer.alloc(Math.min(16, Math.max(1, size)));
        try {
            fs.readSync(fd, probe, 0, probe.length, 0);
        } finally {
            fs.closeSync(fd);
        }
    }

    if (size <= 0) {
        throw new Error('参考图文件为空或不可读');
    }
    if (size > REFERENCE_POOL_MAX_BYTES) {
        throw new Error(`参考图超过大小限制 ${Math.round(REFERENCE_POOL_MAX_BYTES / 1024 / 1024)}MB`);
    }

    return {
        extension,
        size,
        originalName: originalName || `reference${extension}`
    };
}

function buildEvidenceId(assetGroupKey, targetDirectionId, mode) {
    const hash = crypto
        .createHash('sha1')
        .update([assetGroupKey, targetDirectionId, mode].filter(Boolean).join('|'))
        .digest('hex')
        .slice(0, 12);
    return `evidence_${hash}`;
}

function buildAssetGroupKey(asset = {}) {
    return [
        asset.runId || 'unknown-run',
        asset.promptHash || asset.promptIndex || asset.promptDirection || asset.prompt || asset.assetId || 'unknown-prompt'
    ].join('::');
}

function buildDraftId(runId, sourceDirectionId, name, description) {
    const hash = crypto
        .createHash('sha1')
        .update([runId, sourceDirectionId, name, description].filter(Boolean).join('|'))
        .digest('hex')
        .slice(0, 12);
    return `draft_${hash}`;
}

function buildAcceptedDirectionId(draft) {
    const hash = crypto
        .createHash('sha1')
        .update([
            draft.sourceDirectionId,
            draft.sourceDirectionPath,
            draft.name,
            draft.description,
            draft.sourceRunId
        ].filter(Boolean).join('|'))
        .digest('hex')
        .slice(0, 10);
    return `direction_grown_${hash}`;
}

function buildCollectedDirectionId(sourceDirectionId, name, assetGroupKey) {
    const hash = crypto
        .createHash('sha1')
        .update([sourceDirectionId, name, assetGroupKey].filter(Boolean).join('|'))
        .digest('hex')
        .slice(0, 10);
    return `direction_collected_${hash}`;
}

function normalizeDirectionStatus(value, fallback = 'seed') {
    const status = String(value || '').trim().toLowerCase();
    return DIRECTION_STATUSES.has(status) ? status : fallback;
}

function isRunnableDirection(direction = {}) {
    const status = normalizeDirectionStatus(direction.status, 'seed');
    return RUNNABLE_DIRECTION_STATUSES.has(status) && direction.autoRun !== false;
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
                prompt: normalizeText(prompt.prompt).slice(0, 10000)
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

function buildExpandedPath(sourceDirection, name) {
    const sourcePath = normalizeText(sourceDirection.path || sourceDirection.name);
    const directionName = normalizeText(name);
    if (!sourcePath) return directionName;
    if (!directionName || sourcePath.endsWith(`/${directionName}`) || sourcePath === directionName) {
        return sourcePath;
    }
    return `${sourcePath}/${directionName}`;
}

function normalizeForDuplicate(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[\s\\/_\-.,，。:：;；()[\]{}【】"'“”‘’]/g, '')
        .trim();
}

function evidenceDirectionText(entry = {}) {
    return normalizeText(entry.targetDirectionPath || entry.directionKey || entry.targetDirectionName || entry.directionPath);
}

function directionEvidenceMatches(direction = {}, entry = {}) {
    if (!direction || !entry) return false;
    if (entry.targetDirectionId && entry.targetDirectionId === direction.id) return true;

    const directionPath = normalizeForDuplicate(direction.path || direction.name || direction.id);
    const evidencePath = normalizeForDuplicate(evidenceDirectionText(entry));
    if (!directionPath || !evidencePath) return false;
    return directionPath === evidencePath ||
        directionPath.includes(evidencePath) ||
        evidencePath.includes(directionPath);
}

function findSimilarDirections(directions = [], candidate = {}, options = {}) {
    const candidateName = normalizeForDuplicate(candidate.name);
    const candidatePath = normalizeForDuplicate(candidate.path);
    const candidateDescription = normalizeForDuplicate(candidate.description);
    const excludeId = options.excludeId || '';

    return safeArray(directions)
        .filter(direction => direction && direction.id !== excludeId)
        .filter(direction => normalizeDirectionStatus(direction.status, 'seed') !== 'archived')
        .map(direction => {
            const directionName = normalizeForDuplicate(direction.name);
            const directionPath = normalizeForDuplicate(direction.path);
            const directionDescription = normalizeForDuplicate(direction.description);
            const reasons = [];
            if (candidatePath && directionPath && candidatePath === directionPath) {
                reasons.push('path');
            }
            if (candidateName && directionName && candidateName === directionName) {
                reasons.push('name');
            }
            if (
                candidateDescription &&
                directionDescription &&
                (candidateDescription.includes(directionDescription) || directionDescription.includes(candidateDescription)) &&
                Math.min(candidateDescription.length, directionDescription.length) >= 12
            ) {
                reasons.push('description');
            }
            return reasons.length
                ? {
                    id: direction.id,
                    path: direction.path || '',
                    name: direction.name || '',
                    status: normalizeDirectionStatus(direction.status, 'seed'),
                    reasons
                }
                : null;
        })
        .filter(Boolean)
        .slice(0, 8);
}

function textValues(value) {
    if (Array.isArray(value)) {
        return value.map(normalizeText).filter(Boolean);
    }
    const text = normalizeText(value);
    return text ? [text] : [];
}

function firstTextValue(value) {
    return textValues(value)[0] || '';
}

function draftDimensionValue(draft = {}, key = '') {
    const dimensions = draft.dimensions && typeof draft.dimensions === 'object' ? draft.dimensions : {};
    const aliases = {
        atmosphere: ['atmosphere', 'mood', '氛围'],
        camera: ['camera', 'perspective', 'view', '视角'],
        event: ['event', 'narrative', 'action', '事件'],
        visualHook: ['visualHook', 'hook', 'pictureHook', '钩子']
    };
    const keys = aliases[key] || [key];
    for (const alias of keys) {
        const value = firstTextValue(dimensions[alias]);
        if (value) return value;
    }
    if (key === 'visualHook') {
        return firstTextValue(draft.visualHook || draft.hook || draft.pictureHook);
    }
    return '';
}

function buildVisualDnaFromDraft(draft = {}) {
    return {
        atmosphere: textValues(draftDimensionValue(draft, 'atmosphere')),
        camera: textValues(draftDimensionValue(draft, 'camera')),
        event: textValues(draftDimensionValue(draft, 'event')),
        visualHook: textValues(draftDimensionValue(draft, 'visualHook'))
    };
}

function duplicateRiskLevel(draft = {}, similarDirections = []) {
    const text = normalizeText(draft.duplicateRisk || draft.dedupeReason || draft.reason).toLowerCase();
    const similarCount = safeArray(similarDirections).length;
    if (/高|high|严重|strong/.test(text) || similarCount >= 3) return 'high';
    if (/中|medium|重复|similar|相似|same|merge|合并/.test(text) || similarCount > 0 || text) return 'medium';
    return 'low';
}

function countAcceptedDirectionReferences(direction = {}, referenceImages = []) {
    if (!direction || !direction.id) return 0;
    return safeArray(referenceImages).filter(image => {
        if (!image || image.status === 'archived' || image.status === 'deleted' || image.status === 'rejected') return false;
        if (image.directionId === direction.id) return true;
        return safeArray(image.matchedDirectionIds).includes(direction.id);
    }).length;
}

function draftReferenceCount(draft = {}, acceptedDirection = null, referenceImages = []) {
    const explicitIds = safeArray(draft.referenceImageIds).filter(Boolean).length;
    const poolCount = safeArray(draft.referencePool).filter(reference => reference && reference.status !== 'archived' && reference.status !== 'deleted' && reference.status !== 'rejected').length;
    const acceptedCount = countAcceptedDirectionReferences(acceptedDirection, referenceImages);
    const selectedCount = draft.selectedAsReference === true ? 1 : 0;
    return Math.min(3, Math.max(explicitIds, poolCount, acceptedCount, selectedCount));
}

function draftSuccessCaseCount(draft = {}, context = {}) {
    const feedbackEntries = safeArray(context.feedbackEntries);
    const evidenceEntries = safeArray(context.evidenceEntries);
    const directionId = draft.acceptedDirectionId || '';
    const pathKey = normalizeForDuplicate(draft.path || draft.name);
    const isAcceptedDraft = normalizeDirectionStatus(draft.status, 'draft') === 'accepted' || Boolean(directionId);
    const feedbackCount = feedbackEntries.filter(entry => {
        if (!entry || !['good', 'normal'].includes(normalizeText(entry.status || entry.value).toLowerCase())) return false;
        if (entry.directionDraftId && entry.directionDraftId === draft.id) return true;
        if (directionId && entry.directionId === directionId) return true;
        const entryPath = normalizeForDuplicate(entry.directionPath || entry.targetDirectionPath || entry.promptDirection || entry.newDirectionName);
        if (!pathKey || !entryPath) return false;
        return isAcceptedDraft
            ? (pathKey === entryPath || pathKey.includes(entryPath) || entryPath.includes(pathKey))
            : pathKey === entryPath;
    }).length;
    const evidenceCount = evidenceEntries.filter(entry => {
        if (!entry) return false;
        if (directionId && entry.targetDirectionId === directionId) return true;
        const entryPath = normalizeForDuplicate(evidenceDirectionText(entry));
        if (!pathKey || !entryPath) return false;
        return isAcceptedDraft
            ? (pathKey === entryPath || pathKey.includes(entryPath) || entryPath.includes(pathKey))
            : pathKey === entryPath;
    }).length;
    return feedbackCount + evidenceCount;
}

function buildDirectionDraftGovernance(draft = {}, directions = [], context = {}) {
    const acceptedDirection = draft.acceptedDirectionId
        ? safeArray(directions).find(direction => direction && direction.id === draft.acceptedDirectionId)
        : null;
    const similarDirections = Array.isArray(draft.similarDirections)
        ? draft.similarDirections
        : findSimilarDirections(directions, draft, { excludeId: draft.acceptedDirectionId || '' });
    const visualDna = buildVisualDnaFromDraft(draft);
    const dnaFields = [
        { key: 'name', label: '名称', ok: Boolean(normalizeText(draft.name)) },
        { key: 'description', label: '描述', ok: Boolean(normalizeText(draft.description)) },
        { key: 'atmosphere', label: '氛围', ok: visualDna.atmosphere.length > 0 },
        { key: 'camera', label: '视角', ok: visualDna.camera.length > 0 },
        { key: 'event', label: '事件', ok: visualDna.event.length > 0 },
        { key: 'visualHook', label: '视觉钩子', ok: visualDna.visualHook.length > 0 }
    ];
    const dnaCompleteCount = dnaFields.filter(field => field.ok).length;
    const referenceCount = draftReferenceCount(draft, acceptedDirection, context.referenceImages);
    const promptCount = compactPromptList(draft.prompts).length;
    const successCaseCount = draftSuccessCaseCount(draft, context);
    const riskLevel = duplicateRiskLevel(draft, similarDirections);
    const hardErrors = [];
    const warnings = [];
    if (!normalizeText(draft.name)) hardErrors.push('必须有名称');
    if (!normalizeText(draft.path)) hardErrors.push('必须有路径');
    if (!normalizeText(draft.description)) warnings.push('建议补充 description');
    ['atmosphere', 'camera', 'event', 'visualHook'].forEach(key => {
        if (!dnaFields.find(field => field.key === key && field.ok)) {
            warnings.push(`建议补充 ${dnaFields.find(field => field.key === key).label}`);
        }
    });
    if (referenceCount <= 0) warnings.push('如无参考图，采纳后会标记为待补图');
    if (riskLevel === 'high') warnings.push('重复风险高，建议合并或人工复核');
    return {
        dnaCompleteness: {
            count: dnaCompleteCount,
            total: dnaFields.length,
            fields: dnaFields,
            missing: dnaFields.filter(field => !field.ok).map(field => field.key),
            label: `${dnaCompleteCount} / ${dnaFields.length}`
        },
        visualDna,
        referenceCount,
        referenceTarget: 3,
        promptSampleCount: promptCount,
        successCaseCount,
        duplicateRiskLevel: riskLevel,
        duplicateRiskLabel: riskLevel === 'high' ? '高' : (riskLevel === 'medium' ? '中' : '低'),
        similarDirectionCount: similarDirections.length,
        preflight: {
            hardErrors,
            warnings,
            canAccept: hardErrors.length === 0,
            canDirectAccept: hardErrors.length === 0 && warnings.length === 0,
            needsHumanEdit: hardErrors.length > 0 || warnings.length > 0,
            needsReference: referenceCount <= 0,
            shouldMerge: riskLevel === 'high',
            needsDna: dnaCompleteCount < dnaFields.length,
            hasGoodEvidence: successCaseCount > 0
        }
    };
}

function directionDraftMatchesGovernance(draft = {}, filter = '') {
    const governance = draft.governance || {};
    const preflight = governance.preflight || {};
    if (!filter) return true;
    if (filter === 'missing_dna') return preflight.needsDna === true;
    if (filter === 'missing_reference') return Number(governance.referenceCount) < Number(governance.referenceTarget || 3);
    if (filter === 'high_duplicate_risk') return governance.duplicateRiskLevel === 'high';
    if (filter === 'has_good_evidence') return preflight.hasGoodEvidence === true || Number(governance.successCaseCount) > 0;
    if (filter === 'ready_to_accept') return preflight.canDirectAccept === true && normalizeDirectionStatus(draft.status, 'draft') === 'draft';
    if (filter === 'needs_edit') return preflight.needsHumanEdit === true;
    return true;
}

function parseMarkdownTableRow(line) {
    return String(line || '')
        .trim()
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map(cell => cell.replace(/\\\|/g, '|').trim());
}

function isMarkdownTableSeparator(line) {
    const cells = parseMarkdownTableRow(line);
    return cells.length > 0 && cells.every(cell => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, '')));
}

function rowValue(row, headers, aliases) {
    const normalizedAliases = aliases.map(alias => normalizeText(alias).replace(/\s+/g, '').toLowerCase());
    for (let index = 0; index < headers.length; index += 1) {
        const header = normalizeText(headers[index]).replace(/\s+/g, '').toLowerCase();
        if (normalizedAliases.some(alias => header === alias || header.includes(alias))) {
            return normalizeText(row[index]);
        }
    }
    return '';
}

function rowsToDraftCandidates(rows = []) {
    const cleanRows = safeArray(rows)
        .map(row => safeArray(row).map(normalizeText))
        .filter(row => row.some(Boolean));
    if (cleanRows.length < 2) {
        return [];
    }

    const headerIndex = cleanRows.findIndex(row => row.some(cell => /新方向|方向名称|提示词|prompt/i.test(cell)));
    if (headerIndex < 0) {
        return [];
    }

    const headers = cleanRows[headerIndex];
    return cleanRows.slice(headerIndex + 1)
        .filter(row => row.some(Boolean))
        .map(row => {
            const promptColumns = headers
                .map((header, index) => ({ header: normalizeText(header), index }))
                .filter(item => /提示词|prompt/i.test(item.header));
            const prompts = promptColumns
                .map((item, promptIndex) => ({
                    index: promptIndex + 1,
                    title: item.header || `提示词${promptIndex + 1}`,
                    prompt: normalizeText(row[item.index])
                }))
                .filter(item => item.prompt);

            return {
                referenceDirection: rowValue(row, headers, ['参考方向', '原方向', 'source direction']),
                name: rowValue(row, headers, ['新方向名称', '方向名称', '新方向', 'name']),
                description: rowValue(row, headers, ['方向描述', '描述', 'description']),
                sourceStrategy: rowValue(row, headers, ['来源于哪条详细迭代策略', '来源策略', '迭代策略', 'source strategy']),
                targetLevel: rowValue(row, headers, ['目标层级', 'targetLevel']),
                dimensions: {
                    mood: rowValue(row, headers, ['氛围', 'mood']),
                    perspective: rowValue(row, headers, ['视角', 'perspective']),
                    time: rowValue(row, headers, ['时间天气', 'time']),
                    narrative: rowValue(row, headers, ['叙事动作', 'narrative']),
                    scale: rowValue(row, headers, ['规模', 'scale']),
                    material: rowValue(row, headers, ['材质质感', 'material']),
                    subjectRelation: rowValue(row, headers, ['主体关系', 'subjectRelation']),
                    hook: rowValue(row, headers, ['广告钩子', 'hook'])
                },
                duplicateRisk: rowValue(row, headers, ['质量风险', '重复风险', 'duplicateRisk']),
                reason: rowValue(row, headers, ['去重依据', 'reason']),
                prompts
            };
        })
        .filter(item => item.name || item.description || item.prompts.length);
}

function candidateDirectionsToDraftCandidates(candidateDirections = []) {
    return safeArray(candidateDirections)
        .map((item, index) => {
            const prompts = safeArray(item.prompts)
                .map((prompt, promptIndex) => ({
                    index: promptIndex + 1,
                    title: normalizeText(prompt && (prompt.title || prompt.promptTitle)) || `提示词${promptIndex + 1}`,
                    prompt: normalizeText(typeof prompt === 'string' ? prompt : (prompt && (prompt.prompt || prompt.finalPrompt || prompt.promptText)))
                }))
                .filter(prompt => prompt.prompt);
            const dimensions = item.dimensions && typeof item.dimensions === 'object' ? item.dimensions : {};
            return {
                reviewKey: normalizeText(item.reviewKey || item.extensionKey || item.key || item.id),
                extensionKey: normalizeText(item.extensionKey || item.key || item.id),
                referenceDirection: normalizeText(item.sourcePath || item.referenceDirection || ''),
                name: normalizeText(item.label || item.name || item.newDirectionName || item.extensionName || `候选方向${index + 1}`),
                description: normalizeText(item.description || item.extensionDescription || item.directionDescription),
                sourceStrategy: normalizeText(item.sourceStrategy || item.productionAdvice || item.reason),
                targetLevel: normalizeText(item.targetLevel),
                dimensions,
                visualHook: normalizeText(item.visualHook || item.hook || item.pictureHook || draftDimensionValue({ dimensions }, 'visualHook')),
                riskNote: normalizeText(item.riskNote || item.qualityRisk || item.duplicateRisk),
                productionAdvice: normalizeText(item.productionAdvice || item.makingAdvice || item.sourceStrategy),
                avoidRules: safeArray(item.avoidRules).map(normalizeText).filter(Boolean),
                duplicateRisk: normalizeText(item.duplicateRisk || item.dedupeReason || item.dedupReason),
                reason: normalizeText(item.reason || item.scoreSummary || item.dedupeReason),
                prompts
            };
        })
        .filter(item => item.name || item.description || item.prompts.length);
}

function reviewCandidatesToDraftCandidates(candidates = [], sourceDirection = {}, requestedCandidateKeys = new Set()) {
    return safeArray(candidates)
        .filter(candidate => {
            if (!candidate || candidate.status === 'deleted') return false;
            if (!requestedCandidateKeys.size) return true;
            const keys = [
                candidate.reviewKey,
                candidate.extensionKey,
                candidate.key,
                candidate.id,
                candidate.name,
                candidate.newDirectionName,
                candidate.extensionName
            ].map(normalizeText).filter(Boolean);
            return keys.some(key => requestedCandidateKeys.has(key));
        })
        .map(candidate => ({
            reviewKey: normalizeText(candidate.reviewKey || candidate.extensionKey || candidate.key || candidate.id),
            extensionKey: normalizeText(candidate.extensionKey || candidate.key || candidate.id),
            referenceDirection: sourceDirection.name || sourceDirection.path || '',
            name: candidate.name || candidate.newDirectionName || candidate.extensionName,
            description: candidate.description || candidate.extensionDescription || '',
            sourceStrategy: candidate.productionAdvice || candidate.sourceStrategy || '',
            directionTags: safeArray(candidate.directionTags).length
                ? safeArray(candidate.directionTags).map(normalizeText).filter(Boolean)
                : safeArray(candidate.mainTags).concat(safeArray(candidate.extraTags)).map(normalizeText).filter(Boolean),
            mainTags: safeArray(candidate.mainTags).map(normalizeText).filter(Boolean),
            extraTags: safeArray(candidate.extraTags).map(normalizeText).filter(Boolean),
            riskTags: safeArray(candidate.riskTags).map(normalizeText).filter(Boolean),
            dimensions: candidate.dimensions || {},
            duplicateRisk: candidate.dedupeReason || candidate.duplicateRisk || '',
            reason: candidate.scoreSummary || candidate.dedupeReason || candidate.reason || '',
            prompts: safeArray(candidate.prompts),
            visualHook: candidate.visualHook || '',
            riskNote: candidate.riskNote || '',
            productionAdvice: candidate.productionAdvice || '',
            avoidRules: safeArray(candidate.avoidRules)
        }))
        .filter(item => item.name || item.description || item.prompts.length);
}

function filterDraftCandidatesByKeys(candidates = [], requestedCandidateKeys = new Set()) {
    if (!requestedCandidateKeys.size) return candidates;
    return safeArray(candidates).filter(candidate => {
        const keys = [
            candidate.reviewKey,
            candidate.extensionKey,
            candidate.key,
            candidate.id,
            candidate.name,
            candidate.newDirectionName,
            candidate.extensionName
        ].map(normalizeText).filter(Boolean);
        return keys.some(key => requestedCandidateKeys.has(key));
    });
}

function extractDraftCandidatesFromMarkdown(markdown = '') {
    const lines = String(markdown || '').split(/\r?\n/);
    for (let index = 0; index < lines.length - 1; index += 1) {
        const line = lines[index].trim();
        if (!line.includes('|') || !isMarkdownTableSeparator(lines[index + 1])) {
            continue;
        }

        const rows = [parseMarkdownTableRow(line)];
        index += 2;
        while (index < lines.length && lines[index].trim().includes('|')) {
            rows.push(parseMarkdownTableRow(lines[index]));
            index += 1;
        }
        const candidates = rowsToDraftCandidates(rows);
        if (candidates.length) {
            return candidates;
        }
    }
    return [];
}

function extractDraftCandidatesFromWorkbook(filePath) {
    if (!filePath || !fs.existsSync(filePath)) {
        return [];
    }

    const workbook = XLSX.readFile(filePath, {
        cellDates: false
    });
    const sheetName = safeArray(workbook.SheetNames)
        .find(name => /新方向|拓展|prompt|提示/i.test(String(name || '')))
        || workbook.SheetNames[0];
    if (!sheetName || !workbook.Sheets[sheetName]) {
        return [];
    }

    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
        header: 1,
        raw: false,
        defval: ''
    });
    return rowsToDraftCandidates(rows);
}

function writeIfMissing(store, fileName, dataFactory) {
    const filePath = store.filePath(fileName);
    if (!fs.existsSync(filePath)) {
        store.write(fileName, dataFactory());
    }
}

function compactMetadata(config, importedAt, results) {
    return {
        version: 1,
        importedAt,
        config,
        counts: {
            directions: results.directions.directions.length,
            topMaterials: results.topMaterials.materials.length,
            topMaterialInsights: results.topMaterials.insights.length,
            referenceImages: results.references.images.length
        },
        sources: {
            directionWorkbook: results.directions.metadata,
            topMaterials: results.topMaterials.metadata,
            referenceImages: results.references.metadata
        },
        warnings: [
            ...results.directions.warnings,
            ...results.topMaterials.warnings,
            ...results.references.warnings
        ]
    };
}

function applyDirectionFilters(directions, query = {}) {
    let items = Array.isArray(directions) ? directions : [];
    const keyword = String(query.q || query.keyword || '').trim().toLowerCase();

    if (keyword) {
        items = items.filter(direction => [
            direction.path,
            direction.name,
            direction.description
        ].some(value => String(value || '').toLowerCase().includes(keyword)));
    }

    if (query.autoRun !== undefined) {
        const expected = String(query.autoRun).toLowerCase();
        if (['1', 'true', 'yes', '是'].includes(expected)) {
            items = items.filter(direction => direction.autoRun !== false);
        } else if (['0', 'false', 'no', '否'].includes(expected)) {
            items = items.filter(direction => direction.autoRun === false);
        }
    }

    if (query.runnable !== undefined) {
        const expected = String(query.runnable).toLowerCase();
        if (['1', 'true', 'yes', '是'].includes(expected)) {
            items = items.filter(isRunnableDirection);
        }
    }

    if (query.status) {
        const statuses = String(query.status)
            .split(',')
            .map(status => normalizeDirectionStatus(status, ''))
            .filter(Boolean);
        if (statuses.length) {
            items = items.filter(direction => statuses.includes(normalizeDirectionStatus(direction.status, 'seed')));
        }
    }

    return items;
}

function safeArray(value) {
    return Array.isArray(value) ? value : [];
}

function normalizeText(value) {
    return String(value || '').trim();
}

function encodeReferenceStaticPath(relativePath) {
    return String(relativePath || '')
        .split(/[\\/]+/)
        .map(part => encodeURIComponent(part))
        .join('/');
}

function uniqueStrings(values = []) {
    return Array.from(new Set(safeArray(values)
        .map(value => normalizeText(value))
        .filter(Boolean)));
}

function toTimeMs(value) {
    const ms = new Date(value || 0).getTime();
    return Number.isFinite(ms) ? ms : 0;
}

function buildFeedbackId() {
    return `feedback_${Date.now().toString(36)}_${crypto.randomBytes(5).toString('hex')}`;
}

function normalizeReviewStatus(value, fallback = 'unreviewed') {
    const status = String(value || '').trim().toLowerCase();
    if (REVIEW_STATUSES.has(status)) return status;
    return fallback;
}

function normalizeFeedbackLabels(value) {
    const input = Array.isArray(value) ? value : String(value || '').split(',');
    const knownTags = new Set(FEEDBACK_TAGS);
    const result = [];
    input
        .map(item => String(item || '').trim())
        .filter(Boolean)
        .forEach(label => {
            if (knownTags.has(label) && !result.includes(label)) {
                result.push(label);
            }
        });
    return result;
}

function compactReview(review = {}) {
    const status = normalizeReviewStatus(review.status || review.reviewStatus, 'unreviewed');
    return {
        status,
        labels: normalizeFeedbackLabels(review.labels || review.tags || review.reviewLabels),
        note: normalizeText(review.note || review.remark || review.reviewNote).slice(0, 1000),
        reviewedAt: review.reviewedAt || review.updatedAt || '',
        feedbackId: review.feedbackId || ''
    };
}

function parsePaging(query = {}, defaults = {}) {
    const offset = Math.max(0, Math.floor(Number(query.offset) || 0));
    const defaultLimit = defaults.limit || 50;
    const maxLimit = defaults.maxLimit || 200;
    const limit = Math.max(1, Math.min(maxLimit, Math.floor(Number(query.limit) || defaultLimit)));
    return { offset, limit };
}

function fileExists(filePath) {
    try {
        return Boolean(filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile());
    } catch {
        return false;
    }
}

function directionReferenceTagStatus(count = 0, analyzed = false) {
    const referenceCount = Math.max(0, Number(count) || 0);
    if (referenceCount <= 0) {
        return {
            status: 'missing',
            bucket: '0',
            label: '0 图',
            message: '待补参考图',
            needsMoreReferences: true
        };
    }
    if (referenceCount < DIRECTION_TAG_REFERENCE_MAX_IMAGES) {
        return {
            status: analyzed ? 'insufficient-analyzed' : 'insufficient',
            bucket: '1-2',
            label: `${referenceCount} 图`,
            message: '参考图偏少',
            needsMoreReferences: true
        };
    }
    return {
        status: analyzed ? 'analyzed' : 'ready',
        bucket: '3+',
        label: `${referenceCount} 图`,
        message: analyzed ? '已分析' : '可分析',
        needsMoreReferences: false
    };
}

function compactText(value, maxLength = 800) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function extractWinkyText(data) {
    if (typeof data === 'string') return data.trim();
    if (!data || typeof data !== 'object') return '';
    if (typeof data.output_text === 'string' && data.output_text.trim()) return data.output_text.trim();
    if (typeof data.text === 'string' && data.text.trim()) return data.text.trim();
    const choice = Array.isArray(data.choices) ? data.choices[0] : null;
    if (choice) {
        if (typeof choice.text === 'string' && choice.text.trim()) return choice.text.trim();
        const content = choice.message && choice.message.content;
        if (typeof content === 'string' && content.trim()) return content.trim();
        if (Array.isArray(content)) {
            const text = content
                .map(item => item && (item.text || item.content || ''))
                .filter(Boolean)
                .join('\n')
                .trim();
            if (text) return text;
        }
    }
    return '';
}

function parseJsonObject(rawText = '') {
    const text = String(rawText || '').trim();
    const candidates = [
        text,
        text.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim()
    ];
    const first = text.indexOf('{');
    const last = text.lastIndexOf('}');
    if (first !== -1 && last > first) candidates.push(text.slice(first, last + 1));
    for (const candidate of candidates) {
        try {
            return JSON.parse(candidate);
        } catch (_) {}
    }
    throw new Error(`Lumos Winky 未返回有效 JSON：${compactText(text, 220)}`);
}

function normalizeDirectionTagList(value, limit = 5) {
    const input = Array.isArray(value) ? value : String(value || '').split(/[、，,;\n|/]+/);
    const seen = new Set();
    const output = [];
    input.forEach(item => {
        const tag = normalizeTag(item);
        const key = directionMatchKey(tag);
        if (!tag || !key || seen.has(key)) return;
        if (!isCleanDirectionTag(tag, { maxLength: 8 })) return;
        seen.add(key);
        output.push(tag);
    });
    return output.slice(0, limit);
}

function normalizeDirectionTagVisionResult(parsed = {}, fallback = {}) {
    const mainTags = normalizeDirectionTagList(parsed.mainTags || parsed.primaryTags || parsed.tags, 5);
    const extraTags = normalizeDirectionTagList(parsed.extraTags || parsed.secondaryTags || parsed.relatedTags, 8)
        .filter(tag => !mainTags.some(main => directionMatchKey(main) === directionMatchKey(tag)));
    const riskTags = normalizeDirectionTagList(parsed.riskTags || parsed.risks || parsed.avoidTags, 6);
    const summary = compactText(parsed.summary || parsed.visualSummary || parsed.description || fallback.summary, 180);
    const rawConfidence = Number(parsed.confidence);
    const confidence = Number.isFinite(rawConfidence)
        ? Math.max(0, Math.min(1, Number(rawConfidence.toFixed(2))))
        : Number(fallback.confidence) || 0.6;
    return {
        mainTags,
        extraTags,
        tags: mainTags.concat(extraTags).slice(0, 12),
        riskTags,
        summary,
        confidence
    };
}

function readWinkyVisionConfig() {
    const secrets = readSecrets();
    const config = {
        apiKey: String(process.env.WINKY_API_KEY || secrets.winkyApiKey || secrets.WINKY_API_KEY || '').trim(),
        apiUrl: String(process.env.WINKY_API_BASE_URL || secrets.winkyApiUrl || secrets.WINKY_API_BASE_URL || '').trim(),
        model: String(process.env.WINKY_MODEL || secrets.winkyModel || secrets.WINKY_MODEL || '').trim(),
        provider: String(process.env.WINKY_PROVIDER || secrets.winkyProvider || secrets.WINKY_PROVIDER || '').trim()
    };
    if (!config.apiKey || !config.apiUrl || !config.model) {
        throw new Error('Lumos Winky 配置不完整：需要 WINKY_API_KEY / WINKY_API_BASE_URL / WINKY_MODEL。');
    }
    return config;
}

function shouldUseMaxCompletionTokens(model = '') {
    return /^gpt-5/i.test(String(model || '').trim());
}

function imageFileToDataUrl(filePath = '') {
    const ext = path.extname(filePath).toLowerCase();
    const mime = ext === '.png'
        ? 'image/png'
        : ext === '.webp'
            ? 'image/webp'
            : ext === '.gif'
                ? 'image/gif'
                : 'image/jpeg';
    return `data:${mime};base64,${fs.readFileSync(filePath).toString('base64')}`;
}

function buildDirectionTagVisionPrompt(direction = {}, references = []) {
    const referenceNames = references
        .map((reference, index) => `${index + 1}. ${reference.fileName || path.basename(reference.filePath || '') || reference.id}`)
        .join('\n');
    return `你是游戏买量创意方向库的视觉整理助手。请只根据方向描述和参考图画面，提炼用户一眼能看懂的“方向标签”。

要求：
1. 不要输出分类名，不要使用“氛围、视角、事件、钩子、DNA、visualHook”等字样。
2. 标签必须是中文短标签，建议 2-6 个字，最多 8 个字。
3. mainTags 输出 3-5 个最关键标签，用来概括这个方向的画面重点。
4. extraTags 输出 0-8 个可组合拓展标签。
5. riskTags 输出 0-6 个避坑标签，例如：文字干扰、主体不清、过度科幻、重复构图、品牌露出、画面过静。
6. summary 用 1 句话概括方向重点，不要写成提示词。
7. confidence 用 0-1 数字表示你对标签准确度的信心。

方向路径：${direction.path || direction.name || ''}
方向名称：${direction.name || ''}
方向描述：${direction.description || '无'}
参考图：
${referenceNames || '无'}

只返回 JSON：
{
  "mainTags": ["短中文", "短中文", "短中文"],
  "extraTags": ["短中文"],
  "riskTags": ["短中文"],
  "summary": "一句话摘要",
  "confidence": 0.85
}`;
}

function compactAssetPostprocess(postprocess = {}) {
    const derivatives = safeArray(postprocess.derivatives)
        .map(derivative => {
            const exists = fileExists(derivative.outputPath);
            return {
                derivativeId: derivative.derivativeId || '',
                operation: derivative.operation || '',
                status: derivative.status || 'completed',
                outputPath: derivative.outputPath || '',
                outputName: derivative.outputName || '',
                outputFolder: derivative.outputFolder || '',
                sourceAssetId: derivative.sourceAssetId || '',
                sourceRunId: derivative.sourceRunId || '',
                sourcePromptId: derivative.sourcePromptId || '',
                sourceFilePath: derivative.sourceFilePath || '',
                runId: derivative.runId || '',
                targetSize: derivative.targetSize || '',
                packageFolderName: derivative.packageFolderName || '',
                message: derivative.message || '',
                createdAt: derivative.createdAt || '',
                fileExists: exists
            };
        })
        .sort((a, b) => toTimeMs(b.createdAt) - toTimeMs(a.createdAt));
    const completed = derivatives.filter(item => item.status === 'completed' && item.fileExists);
    const byOperation = completed.reduce((map, derivative) => {
        const operation = derivative.operation || 'unknown';
        if (!map[operation]) {
            map[operation] = {
                count: 0,
                latestAt: '',
                latestOutputPath: ''
            };
        }
        map[operation].count += 1;
        if (!map[operation].latestAt || toTimeMs(derivative.createdAt) > toTimeMs(map[operation].latestAt)) {
            map[operation].latestAt = derivative.createdAt;
            map[operation].latestOutputPath = derivative.outputPath;
        }
        return map;
    }, {});

    return {
        updatedAt: postprocess.updatedAt || '',
        derivativeCount: derivatives.length,
        completedCount: completed.length,
        renamed: Boolean(byOperation.rename && byOperation.rename.count),
        resized: Boolean(byOperation.resize && byOperation.resize.count),
        logoApplied: Boolean(byOperation.logo && byOperation.logo.count),
        packaged: Boolean(byOperation.package && byOperation.package.count),
        byOperation,
        derivatives: derivatives.slice(0, 30)
    };
}

function compactAsset(asset = {}) {
    const exists = fileExists(asset.filePath);
    const review = compactReview(asset.review || {
        status: asset.reviewStatus,
        labels: asset.reviewLabels,
        note: asset.reviewNote,
        reviewedAt: asset.reviewedAt,
        feedbackId: asset.feedbackId
    });
    return {
        assetId: asset.assetId || '',
        runId: asset.runId || '',
        source: asset.source || '',
        directionId: asset.directionId || '',
        directionPath: asset.directionPath || '',
        directionName: asset.directionName || '',
        directionDraftId: asset.directionDraftId || '',
        newDirectionName: asset.newDirectionName || asset.promptDirection || '',
        sourceDirectionId: asset.sourceDirectionId || asset.directionId || '',
        sourceDirectionPath: asset.sourceDirectionPath || asset.directionPath || '',
        promptHash: asset.promptHash || '',
        prompt: asset.prompt || '',
        promptDirection: asset.promptDirection || '',
        promptTitle: asset.promptTitle || '',
        promptIndex: asset.promptIndex || '',
        outputIndex: asset.outputIndex || '',
        filePath: asset.filePath || '',
        fileName: asset.fileName || '',
        relativePath: asset.relativePath || '',
        fileSize: Number(asset.fileSize) || 0,
        savedAt: asset.savedAt || asset.createdAt || '',
        recordedAt: asset.recordedAt || '',
        outputFolder: asset.outputFolder || '',
        legilTaskId: asset.legilTaskId || '',
        legilTaskStatus: asset.legilTaskStatus || '',
        legilTaskPhase: asset.legilTaskPhase || '',
        legilBatchRunId: asset.legilBatchRunId || '',
        generationSettings: asset.generationSettings || {},
        reviewStatus: review.status,
        reviewLabels: review.labels,
        reviewNote: review.note,
        reviewedAt: review.reviewedAt,
        review,
        autoReview: asset.autoReview && typeof asset.autoReview === 'object' ? asset.autoReview : null,
        directionCollection: asset.directionCollection || null,
        postprocess: compactAssetPostprocess(asset.postprocess || {}),
        fileExists: exists,
        imageUrl: exists && asset.assetId
            ? `/api/creative-knowledge/assets/${encodeURIComponent(asset.assetId)}/file`
            : ''
    };
}

function compactFeedback(entry = {}) {
    const review = compactReview(entry);
    return {
        feedbackId: entry.feedbackId || '',
        feedbackTargetType: entry.feedbackTargetType || (entry.directionDraftId ? 'direction-candidate' : (entry.assetId ? 'asset' : 'prompt')),
        assetId: entry.assetId || '',
        directionDraftId: entry.directionDraftId || '',
        runId: entry.runId || '',
        directionId: entry.directionId || '',
        directionPath: entry.directionPath || '',
        directionName: entry.directionName || '',
        sourceDirectionId: entry.sourceDirectionId || '',
        sourceDirectionPath: entry.sourceDirectionPath || '',
        sourceDirectionName: entry.sourceDirectionName || '',
        newDirectionName: entry.newDirectionName || entry.directionName || '',
        promptHash: entry.promptHash || '',
        prompt: entry.prompt || '',
        promptDirection: entry.promptDirection || '',
        promptTitle: entry.promptTitle || '',
        promptIndex: entry.promptIndex || '',
        outputIndex: entry.outputIndex || '',
        targetLevel: entry.targetLevel || '',
        dimensions: entry.dimensions && typeof entry.dimensions === 'object' ? entry.dimensions : {},
        duplicateRisk: entry.duplicateRisk || '',
        reason: entry.reason || '',
        original: entry.original || '',
        modified: entry.modified || '',
        deleteReason: entry.deleteReason || '',
        previewGenerated: entry.previewGenerated === true,
        legilSkipped: entry.legilSkipped === true,
        legilError: entry.legilError || '',
        selectedAsReference: entry.selectedAsReference === true,
        rating: entry.rating === null || entry.rating === undefined || entry.rating === '' ? null : Number(entry.rating),
        status: review.status,
        labels: review.labels,
        note: review.note,
        source: entry.source || 'manual-review',
        createdAt: entry.createdAt || entry.reviewedAt || '',
        updatedAt: entry.updatedAt || entry.reviewedAt || ''
    };
}

function buildLatestFeedbackByAsset(feedback = []) {
    const latest = new Map();
    safeArray(feedback)
        .map(compactFeedback)
        .filter(entry => entry.assetId)
        .sort((a, b) => toTimeMs(a.updatedAt || a.createdAt) - toTimeMs(b.updatedAt || b.createdAt))
        .forEach(entry => {
            latest.set(entry.assetId, entry);
        });
    return latest;
}

function mergeFeedbackReview(asset = {}, latestFeedbackByAsset = new Map()) {
    const feedback = latestFeedbackByAsset.get(asset.assetId);
    if (!feedback) return asset;
    const currentReview = compactReview(asset.review || {});
    if (currentReview.reviewedAt && toTimeMs(currentReview.reviewedAt) >= toTimeMs(feedback.updatedAt || feedback.createdAt)) {
        return asset;
    }
    return {
        ...asset,
        review: {
            status: feedback.status,
            labels: feedback.labels,
            note: feedback.note,
            reviewedAt: feedback.updatedAt || feedback.createdAt,
            feedbackId: feedback.feedbackId
        }
    };
}

function buildReviewCounts(assets = []) {
    const counts = {
        unreviewed: 0,
        good: 0,
        normal: 0,
        bad: 0,
        rejected: 0,
        reviewed: 0
    };
    safeArray(assets).forEach(asset => {
        const status = normalizeReviewStatus(asset.reviewStatus || (asset.review && asset.review.status), 'unreviewed');
        counts[status] = (counts[status] || 0) + 1;
        if (REVIEWED_STATUSES.has(status)) {
            counts.reviewed += 1;
        }
    });
    return counts;
}

function compactReferenceImage(image = {}) {
    const exists = fileExists(image.filePath);
    const staticPath = image.source === 'workbook-embedded' && image.relativePath
        ? encodeReferenceStaticPath(image.relativePath)
        : '';
    const slot = Number(image.slot || image.sourceSlot) || 0;
    const roleDefaults = REFERENCE_POOL_ROLES[slot] || {};
    return {
        id: image.id || '',
        directionId: image.directionId || '',
        directionPath: image.directionPath || '',
        directionName: image.directionName || '',
        matchedDirectionIds: safeArray(image.matchedDirectionIds),
        source: image.source || '',
        sourceSlot: image.sourceSlot || '',
        slot,
        slotLabel: roleDefaults.label || '',
        roleTag: image.roleTag || roleDefaults.roleTag || '',
        useFor: image.useFor || roleDefaults.useFor || '',
        visualNotes: image.visualNotes || '',
        status: normalizeReferenceStatus(image.status, image.deleted ? 'deleted' : 'active'),
        isPrimary: slot === 1 && normalizeReferenceStatus(image.status, 'active') === 'active',
        archivedAt: image.archivedAt || '',
        archivedReason: image.archivedReason || '',
        rejectReason: image.rejectReason || '',
        replacedByReferenceId: image.replacedByReferenceId || '',
        replacesReferenceId: image.replacesReferenceId || '',
        deleted: image.deleted || null,
        sourceSheetRow: image.sourceSheetRow || '',
        sourceSheetColumn: image.sourceSheetColumn || '',
        filePath: image.filePath || '',
        remoteUrl: image.remoteUrl || '',
        attachmentToken: image.attachmentToken || '',
        fileName: image.fileName || '',
        relativePath: image.relativePath || '',
        extension: image.extension || path.extname(image.filePath || '').toLowerCase(),
        size: Number(image.size) || 0,
        updatedAt: image.updatedAt || '',
        fileExists: exists,
        imageUrl: exists && staticPath
            ? `/api/creative-knowledge/reference-static/${staticPath}`
            : exists && image.id
                ? `/api/creative-knowledge/references/${encodeURIComponent(image.id)}/file`
            : (image.remoteUrl || '')
    };
}

const VISUAL_DNA_DIMENSIONS = [
    'atmosphere',
    'camera',
    'event',
    'scale',
    'visualHook',
    'avoid'
];

const VISUAL_DNA_ALIASES = {
    atmosphere: ['atmosphere', 'mood', 'emotion', 'tone', 'feeling', '氛围', '情绪'],
    camera: ['camera', 'perspective', 'view', 'angle', 'lens', '视角', '镜头'],
    event: ['event', 'action', 'narrative', 'mechanism', 'subjectAction', 'sceneMechanism', '事件', '动作', '机制', '叙事'],
    scale: ['scale', 'sceneScale', 'landmark', 'scope', '尺度', '规模'],
    visualHook: ['visualHook', 'hook', 'pictureHook', 'advertisingHook', '视觉钩子', '画面抓手', '钩子'],
    avoid: ['avoid', 'risk', 'riskNote', 'mustAvoid', 'negativePrompt', '避坑', '风险', '避免']
};

const CREATIVE_AXIS_KEY_MAP = {
    emotion: 'atmosphere',
    mood: 'atmosphere',
    atmosphere: 'atmosphere',
    camera: 'camera',
    perspective: 'camera',
    view: 'camera',
    event: 'event',
    action: 'event',
    narrative: 'event',
    mechanism: 'event',
    'scene-mechanism': 'event',
    'subject-action': 'event',
    scale: 'scale',
    landmark: 'scale',
    hook: 'visualHook',
    visualhook: 'visualHook',
    avoid: 'avoid',
    risk: 'avoid'
};

const VISUAL_DNA_TEXT_HINTS = {
    atmosphere: [
        '紧张危机',
        '史诗壮阔',
        '温暖希望',
        '神秘未知',
        '荒凉孤独',
        '冰雪危机',
        '危机感',
        '希望感',
        '压迫感',
        '紧张',
        '危险',
        '史诗',
        '壮阔',
        '温暖',
        '神秘',
        '荒凉',
        '治愈',
        '轻松'
    ],
    camera: [
        '第一人称',
        '俯瞰',
        '鸟瞰',
        '平视',
        '低机位',
        '近景',
        '远景',
        '特写',
        '宽幅',
        '广角',
        '主视角'
    ],
    event: [
        '救援',
        '撤离',
        '逃生',
        '发现',
        '护送',
        '搭桥',
        '交接',
        '接力',
        '补给',
        '探索',
        '求救',
        '对抗',
        '建造',
        '修复',
        '穿越',
        '搜寻',
        '采集',
        '交易',
        '警示',
        '守护'
    ],
    scale: ['巨型地标', '地标', '大场景', '室内', '室外', '微缩', '宽幅']
};

function normalizeVisualDnaItems(value, options = {}) {
    if (value === undefined || value === null) return [];
    if (Array.isArray(value)) {
        return value.flatMap(item => normalizeVisualDnaItems(item, options));
    }
    if (typeof value === 'object') {
        return Object.values(value).flatMap(item => normalizeVisualDnaItems(item, options));
    }
    const text = normalizeText(value);
    if (!text) return [];
    if (options.keepSentence) return [text.slice(0, 180)];
    return text
        .split(/[、,，;；\n\r/]+/)
        .map(item => normalizeText(item).replace(/^[：:]+/, '').slice(0, 80))
        .filter(Boolean);
}

function createVisualDnaAccumulator() {
    const values = {};
    const sources = [];
    VISUAL_DNA_DIMENSIONS.forEach(key => {
        values[key] = new Map();
    });
    return { values, sources };
}

function addVisualDnaValue(accumulator, key, value, source = {}, options = {}) {
    if (!accumulator || !accumulator.values[key]) return;
    const items = normalizeVisualDnaItems(value, options);
    items.forEach(item => {
        if (!item) return;
        const current = accumulator.values[key].get(item) || { value: item, count: 0, sources: [] };
        current.count += 1;
        if (source.type && current.sources.length < 5) {
            current.sources.push({
                type: source.type,
                id: source.id || '',
                field: source.field || key,
                label: source.label || ''
            });
        }
        accumulator.values[key].set(item, current);
    });
    if (items.length && source.type) {
        accumulator.sources.push({
            type: source.type,
            id: source.id || '',
            field: source.field || key,
            label: source.label || ''
        });
    }
}

function getObjectValueByAliases(source = {}, aliases = []) {
    if (!source || typeof source !== 'object') return undefined;
    for (const alias of aliases) {
        if (source[alias] !== undefined && source[alias] !== null && source[alias] !== '') {
            return source[alias];
        }
    }
    const entries = Object.entries(source);
    for (const alias of aliases) {
        const normalizedAlias = String(alias).toLowerCase().replace(/[\s_-]+/g, '');
        const match = entries.find(([key, value]) => (
            value !== undefined &&
            value !== null &&
            value !== '' &&
            String(key).toLowerCase().replace(/[\s_-]+/g, '') === normalizedAlias
        ));
        if (match) return match[1];
    }
    return undefined;
}

function addVisualDnaFromText(accumulator, text, source = {}) {
    const normalized = normalizeText(text);
    if (!normalized) return;
    Object.entries(VISUAL_DNA_TEXT_HINTS).forEach(([key, hints]) => {
        hints.forEach(hint => {
            if (normalized.includes(hint)) {
                addVisualDnaValue(accumulator, key, hint, { ...source, field: key });
            }
        });
    });
    if (!accumulator.values.visualHook.size) {
        const sentence = normalized.split(/[。.!！?？\n\r]+/).map(normalizeText).find(Boolean);
        if (sentence && sentence.length >= 8) {
            addVisualDnaValue(accumulator, 'visualHook', sentence.slice(0, 72), { ...source, field: 'description' }, { keepSentence: true });
        }
    }
}

function addVisualDnaFromAxes(accumulator, axes, source = {}) {
    normalizeVisualDnaItems(axes).forEach(axis => {
        const parts = axis.split(/[:：]/);
        if (parts.length < 2) {
            addVisualDnaFromText(accumulator, axis, { ...source, field: 'creativeAxes' });
            return;
        }
        const rawKey = normalizeText(parts.shift()).toLowerCase();
        const value = normalizeText(parts.join(':'));
        const key = CREATIVE_AXIS_KEY_MAP[rawKey] || CREATIVE_AXIS_KEY_MAP[rawKey.replace(/[\s_]+/g, '-')];
        if (key && value) {
            addVisualDnaValue(accumulator, key, value, { ...source, field: 'creativeAxes' });
        } else {
            addVisualDnaFromText(accumulator, value || axis, { ...source, field: 'creativeAxes' });
        }
    });
}

function addVisualDnaFromRecord(accumulator, record = {}, source = {}) {
    if (!record || typeof record !== 'object') return;
    const explicitDna = record.visualDna && typeof record.visualDna === 'object' ? record.visualDna : null;
    if (explicitDna) {
        VISUAL_DNA_DIMENSIONS.forEach(key => {
            const value = getObjectValueByAliases(explicitDna, VISUAL_DNA_ALIASES[key]);
            addVisualDnaValue(accumulator, key, value, { ...source, field: `visualDna.${key}` });
        });
    }

    const dimensions = record.dimensions && typeof record.dimensions === 'object' ? record.dimensions : null;
    if (dimensions) {
        addVisualDnaValue(accumulator, 'atmosphere', getObjectValueByAliases(dimensions, VISUAL_DNA_ALIASES.atmosphere), { ...source, field: 'dimensions.mood' });
        addVisualDnaValue(accumulator, 'camera', getObjectValueByAliases(dimensions, VISUAL_DNA_ALIASES.camera), { ...source, field: 'dimensions.perspective' });
        addVisualDnaValue(accumulator, 'event', getObjectValueByAliases(dimensions, VISUAL_DNA_ALIASES.event), { ...source, field: 'dimensions.narrative' });
        addVisualDnaValue(accumulator, 'scale', getObjectValueByAliases(dimensions, VISUAL_DNA_ALIASES.scale), { ...source, field: 'dimensions.scale' });
        addVisualDnaValue(accumulator, 'visualHook', getObjectValueByAliases(dimensions, VISUAL_DNA_ALIASES.visualHook), { ...source, field: 'dimensions.hook' });
    }

    addVisualDnaValue(accumulator, 'visualHook', record.visualHook || record.hook || record.pictureHook, { ...source, field: 'visualHook' }, { keepSentence: true });
    addVisualDnaValue(accumulator, 'avoid', record.riskNote || record.duplicateRisk || record.mustAvoid, { ...source, field: 'riskNote' }, { keepSentence: true });
    addVisualDnaFromAxes(accumulator, record.creativeAxes, source);
    addVisualDnaFromText(accumulator, [
        record.description,
        record.productionAdvice,
        record.prompt,
        record.promptText,
        record.finalPrompt
    ].filter(Boolean).join('。'), { ...source, field: 'description' });
}

function finalizeVisualDna(accumulator) {
    const visualDna = {};
    const topValues = {};
    VISUAL_DNA_DIMENSIONS.forEach(key => {
        const sorted = Array.from(accumulator.values[key].values())
            .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
        visualDna[key] = sorted.slice(0, key === 'visualHook' ? 4 : 6).map(item => item.value);
        topValues[key] = sorted.slice(0, 8);
    });
    const coreKeys = ['atmosphere', 'camera', 'event', 'visualHook'];
    const filledCoreCount = coreKeys.filter(key => visualDna[key].length > 0).length;
    return {
        visualDna,
        topValues,
        source: accumulator.sources[0]?.type || 'fallback',
        sources: accumulator.sources.slice(0, 12),
        evidenceCount: accumulator.sources.length,
        confidence: Math.min(0.95, Number((0.2 + filledCoreCount * 0.16 + Math.min(accumulator.sources.length, 8) * 0.04).toFixed(2))),
        missing: coreKeys.filter(key => visualDna[key].length === 0),
        summaryText: `视觉 DNA：氛围 ${visualDna.atmosphere[0] || '--'} / 视角 ${visualDna.camera[0] || '--'} / 事件 ${visualDna.event[0] || '--'} / 钩子 ${visualDna.visualHook[0] || '--'}`
    };
}

function directionRecordMatches(direction = {}, record = {}) {
    if (!direction || !record) return false;
    const directionId = normalizeText(direction.id);
    const idFields = [
        record.directionId,
        record.targetDirectionId,
        record.sourceDirectionId,
        record.matchedDirectionId
    ].map(normalizeText).filter(Boolean);
    if (directionId && idFields.includes(directionId)) return true;

    const directionPath = normalizeForDuplicate(direction.path || direction.name || direction.id);
    const recordPath = normalizeForDuplicate(
        record.directionPath ||
        record.targetDirectionPath ||
        record.sourceDirectionPath ||
        record.path ||
        record.referenceDirection ||
        record.directionKey
    );
    const recordName = normalizeForDuplicate(record.name || record.newDirectionName || record.extensionName || record.targetDirectionName);
    if (!directionPath) return false;
    return Boolean(
        recordPath && (directionPath === recordPath || directionPath.includes(recordPath) || recordPath.includes(directionPath))
    ) || Boolean(recordName && directionPath.includes(recordName));
}

function buildDirectionDefinitionsByName(run = {}) {
    const definitions = new Map();
    safeArray(run.directionDefinitions).forEach(definition => {
        const keys = [
            definition.newDirectionName,
            definition.name,
            definition.extensionName,
            definition.extensionKey
        ].map(normalizeText).filter(Boolean);
        keys.forEach(key => definitions.set(key, definition));
    });
    return definitions;
}

function compactDirectionCandidate(candidate = {}, status = 'selected', index = 0, definitions = new Map()) {
    const name = normalizeText(candidate.name || candidate.newDirectionName || candidate.extensionName || candidate.extensionKey || `候选方向 ${index + 1}`);
    const definition = definitions.get(name) || definitions.get(normalizeText(candidate.extensionKey)) || {};
    const tagFallback = normalizeDirectionTagsForRecord({
        ...definition,
        ...candidate,
        name,
        description: candidate.description || definition.description || definition.newDirectionName || ''
    });
    return {
        status,
        index: index + 1,
        name,
        description: normalizeText(candidate.description || definition.description || definition.newDirectionName || ''),
        directionTags: safeArray(candidate.directionTags).length ? safeArray(candidate.directionTags) : tagFallback.tags,
        riskTags: safeArray(candidate.riskTags).length ? safeArray(candidate.riskTags) : tagFallback.riskTags,
        extensionKey: normalizeText(candidate.extensionKey || definition.extensionKey || ''),
        extensionType: normalizeText(candidate.extensionType || definition.extensionType || candidate.sourceStrategy || definition.sourceStrategy || ''),
        score: Number(candidate.score) || 0,
        scoreSummary: normalizeText(candidate.scoreSummary || candidate.reason || ''),
        visualHook: normalizeText(candidate.visualHook || definition.visualHook || ''),
        dedupeReason: normalizeText(candidate.dedupeReason || candidate.duplicateReason || candidate.reason || ''),
        riskNote: normalizeText(candidate.riskNote || candidate.duplicateRisk || ''),
        productionAdvice: normalizeText(candidate.productionAdvice || definition.productionAdvice || ''),
        creativeAxes: safeArray(candidate.creativeAxes || definition.creativeAxes),
        promptCount: Number(candidate.promptCount) || Number(definition.promptCount) || 0
    };
}

function buildDirectionCandidateReview(run = {}) {
    const report = run.directionPlanReport || {};
    if (!report || typeof report !== 'object' || (!report.selectedExtensions && !report.rejectedExtensions)) {
        return null;
    }
    const definitions = buildDirectionDefinitionsByName(run);
    const selected = safeArray(report.selectedExtensions)
        .concat(safeArray(report.lowScoreSelectedExtensions))
        .map((candidate, index) => compactDirectionCandidate(candidate, 'selected', index, definitions));
    const rejected = safeArray(report.rejectedExtensions || report.discardedExtensions || report.filteredExtensions)
        .map((candidate, index) => compactDirectionCandidate(candidate, 'rejected', index, definitions));
    return {
        success: report.success !== false,
        checkedAt: report.checkedAt || '',
        selectedCount: Number(report.selectedExtensionCount) || selected.length,
        rejectedCount: Number(report.rejectedExtensionCount) || rejected.length,
        candidateCount: Number(report.candidateExtensionCount) || selected.length + rejected.length,
        qualifiedCount: Number(report.qualifiedExtensionCount) || 0,
        needsRepair: report.needsRepair === true,
        summary: normalizeText(report.summary || ''),
        selected,
        rejected
    };
}

function compactRun(run = {}) {
    const legilResult = run.legilResult || {};
    const assets = run.assets || {};
    const promptQualityReport = run.promptQualityReport || {};
    const sourceDirection = run.sourceDirection || {};
    const savedCount = Number(legilResult.savedCount)
        || Number(run.legilProgress && run.legilProgress.saved)
        || Number(assets.newAssetCount)
        || Number(assets.matchedFileCount)
        || 0;

    return {
        runId: run.runId || '',
        mode: run.mode || '',
        agentOnly: run.agentOnly === true,
        status: run.status || '',
        phase: run.phase || '',
        createdAt: run.createdAt || '',
        startedAt: run.startedAt || '',
        completedAt: run.completedAt || '',
        sourceDirection: {
            id: sourceDirection.id || '',
            path: sourceDirection.path || '',
            name: sourceDirection.name || ''
        },
        promptTotalRaw: Number(run.promptTotalRaw) || 0,
        promptTotal: Number(run.promptTotal) || 0,
        promptTotalRejected: Number(run.promptTotalRejected)
            || Number(promptQualityReport.rejectedPromptCount)
            || 0,
        expectedImageTotal: Number(run.expectedImageTotal)
            || Number(promptQualityReport.expectedImageTotal)
            || 0,
        savedCount,
        failedCount: Number(legilResult.failedCount)
            || Number(run.legilProgress && run.legilProgress.failed)
            || 0,
        assetCount: Number(assets.newAssetCount) || 0,
        matchedAssetCount: Number(assets.matchedFileCount) || 0,
        assetIds: safeArray(run.assetIds).length
            ? safeArray(run.assetIds)
            : safeArray(assets.assetIds),
        outputFolder: run.config && run.config.outputFolder ? run.config.outputFolder : '',
        directionCandidateReview: buildDirectionCandidateReview(run),
        message: run.message || ''
    };
}

function createCreativeKnowledgeService(options = {}) {
    const rootDir = options.rootDir || options.ROOT_DIR || process.cwd();
    const logger = options.logger || console;
    const httpClient = options.axios || axios;
    const assetFileLookupCache = new Map();
    const referenceFileLookupCache = new Map();

    function getConfig(overrides = {}) {
        return buildDefaultConfig(rootDir, overrides);
    }

    function getStore(configOverrides = {}) {
        const config = getConfig(configOverrides);
        return {
            config,
            store: new CreativeKnowledgeStore(config.dataDir)
        };
    }

    function ensureEmptyFiles(store) {
        store.ensureBase();
        writeIfMissing(store, 'assets.json', emptyAssets);
        writeIfMissing(store, 'feedback.json', emptyFeedback);
        writeIfMissing(store, 'scheduler-state.json', emptySchedulerState);
        writeIfMissing(store, 'direction-drafts.json', emptyDirectionDrafts);
        writeIfMissing(store, 'direction-evidence.json', emptyDirectionEvidence);
        writeIfMissing(store, DIRECTION_TAGS_FILE, emptyDirectionTags);
        writeIfMissing(store, 'material-learnings.json', emptyMaterialLearnings);
        writeIfMissing(store, 'creative-memory.json', emptyCreativeMemory);
        writeIfMissing(store, REFERENCE_POOL_FILE, () => ({
            version: 1,
            importedAt: null,
            images: [],
            updatedAt: nowIso()
        }));
        writeIfMissing(store, REFERENCE_CHANGE_EVENTS_FILE, emptyReferenceChangeEvents);
    }

    function getStoreFileVersion(store, fileName) {
        const filePath = store.filePath(fileName);
        try {
            const stats = fs.statSync(filePath);
            return `${stats.mtimeMs}:${stats.size}`;
        } catch {
            return 'missing';
        }
    }

    function getFileLookup(store, fileName, collectionKey, idKey, cache) {
        const filePath = store.filePath(fileName);
        const version = getStoreFileVersion(store, fileName);
        const cached = cache.get(filePath);
        if (cached && cached.version === version) {
            return cached.items;
        }

        const data = store.read(fileName, { [collectionKey]: [] });
        const items = new Map();
        safeArray(data[collectionKey]).forEach(item => {
            const id = item && item[idKey];
            if (!id) return;
            items.set(id, {
                id,
                filePath: item.filePath || '',
                fileName: item.fileName || path.basename(item.filePath || ''),
                status: item.status || '',
                deleted: item.deleted || null
            });
        });

        cache.set(filePath, { version, items });
        return items;
    }

    function importKnowledge(importOptions = {}) {
        const config = getConfig(importOptions);
        const store = new CreativeKnowledgeStore(config.dataDir);
        const importedAt = nowIso();

        store.ensureBase();
        const existingDirectionsData = store.read('directions.json', {
            directions: []
        });
        const existingDirections = safeArray(existingDirectionsData.directions);
        const existingById = new Map(existingDirections.map(direction => [direction.id, direction]));

        const directionResult = importDirections({
            workbookPath: config.directionWorkbook
        });
        const topMaterialResult = importTopMaterials({
            directoryPath: config.topMaterialsDir,
            maxRowsPerFile: importOptions.maxRowsPerFile
        });
        const folderReferenceResult = indexReferenceImages({
            referenceFolder: config.referenceFolder,
            directions: directionResult.directions
        });
        const workbookReferenceResult = extractWorkbookReferenceImages({
            workbookPath: config.directionWorkbook,
            directions: directionResult.directions,
            outputDir: path.join(config.dataDir, 'reference-images', 'workbook')
        });
        const workbookReferencesByDirection = new Map();
        safeArray(workbookReferenceResult.images).forEach(image => {
            safeArray(image.matchedDirectionIds).forEach(directionId => {
                const current = workbookReferencesByDirection.get(directionId) || [];
                current.push(image.id);
                workbookReferencesByDirection.set(directionId, current);
            });
        });
        directionResult.directions = directionResult.directions.map(direction => ({
            ...direction,
            ...(existingById.has(direction.id) ? {
                status: normalizeDirectionStatus(existingById.get(direction.id).status, 'seed'),
                autoRun: existingById.get(direction.id).status === 'disabled'
                    ? false
                    : (existingById.get(direction.id).autoRun !== undefined ? existingById.get(direction.id).autoRun : direction.autoRun),
                lifecycle: existingById.get(direction.id).lifecycle || {},
                mergedIntoDirectionId: existingById.get(direction.id).mergedIntoDirectionId || '',
                mergeReason: existingById.get(direction.id).mergeReason || ''
            } : {
                status: 'seed'
            }),
            source: 'seed',
            referenceImageIds: workbookReferencesByDirection.get(direction.id) || [],
            referenceImageCount: safeArray(workbookReferencesByDirection.get(direction.id)).length
        }));
        const importedIds = new Set(directionResult.directions.map(direction => direction.id));
        const grownDirections = existingDirections
            .filter(direction => direction && direction.id && !importedIds.has(direction.id))
            .filter(direction => normalizeDirectionStatus(direction.status, '') !== 'draft')
            .filter(direction => direction.source === 'agent' || normalizeDirectionStatus(direction.status, '') === 'accepted');
        if (grownDirections.length) {
            directionResult.directions = directionResult.directions.concat(grownDirections);
        }
        const referenceResult = {
            images: [
                ...safeArray(folderReferenceResult.images),
                ...safeArray(workbookReferenceResult.images)
            ],
            warnings: [
                ...safeArray(folderReferenceResult.warnings),
                ...safeArray(workbookReferenceResult.warnings)
            ],
            metadata: {
                sourceDir: config.referenceFolder,
                folderImageCount: safeArray(folderReferenceResult.images).length,
                workbookImageCount: safeArray(workbookReferenceResult.images).length,
                imageCount: safeArray(folderReferenceResult.images).length + safeArray(workbookReferenceResult.images).length,
                folder: folderReferenceResult.metadata,
                workbook: workbookReferenceResult.metadata
            }
        };
        const results = {
            directions: directionResult,
            topMaterials: topMaterialResult,
            references: referenceResult
        };
        const metadata = compactMetadata(config, importedAt, results);

        store.write('directions.json', {
            version: 1,
            importedAt,
            ...directionResult
        });
        store.write('top-materials.json', {
            version: 1,
            importedAt,
            materials: topMaterialResult.materials,
            fileSummaries: topMaterialResult.fileSummaries,
            metadata: topMaterialResult.metadata,
            warnings: topMaterialResult.warnings
        });
        store.write('top-material-insights.json', {
            version: 1,
            importedAt,
            insights: topMaterialResult.insights,
            metadata: {
                sourceDir: config.topMaterialsDir,
                insightCount: topMaterialResult.insights.length
            }
        });
        store.write('reference-images.json', {
            version: 1,
            importedAt,
            images: referenceResult.images,
            metadata: referenceResult.metadata,
            warnings: referenceResult.warnings
        });
        store.write('metadata.json', metadata);
        ensureEmptyFiles(store);

        if (logger && typeof logger.info === 'function') {
            logger.info(`创意知识库导入完成: 方向 ${metadata.counts.directions} 个，TOP 素材 ${metadata.counts.topMaterials} 条，参考图 ${metadata.counts.referenceImages} 张`);
        }

        return {
            success: true,
            message: '创意知识库导入完成',
            ...metadata
        };
    }

    function getStatus(configOverrides = {}) {
        const { config, store } = getStore(configOverrides);
        store.ensureBase();
        const metadata = store.read('metadata.json', {
            version: 1,
            importedAt: null,
            config,
            counts: {
                directions: 0,
                topMaterials: 0,
                topMaterialInsights: 0,
                referenceImages: 0
            },
            sources: {},
            warnings: []
        });

        return {
            success: true,
            imported: Boolean(metadata.importedAt),
            importedAt: metadata.importedAt,
            config: metadata.config || config,
            counts: metadata.counts,
            sources: metadata.sources || {},
            warnings: metadata.warnings || [],
            files: {
                metadata: store.info('metadata.json'),
                directions: store.info('directions.json'),
                topMaterials: store.info('top-materials.json'),
                topMaterialInsights: store.info('top-material-insights.json'),
                referenceImages: store.info('reference-images.json'),
                assets: store.info('assets.json'),
                feedback: store.info('feedback.json'),
                schedulerState: store.info('scheduler-state.json'),
                directionDrafts: store.info('direction-drafts.json'),
                directionEvidence: store.info('direction-evidence.json'),
                materialLearnings: store.info('material-learnings.json')
            },
            sourceAvailability: {
                directionWorkbook: fs.existsSync(config.directionWorkbook),
                topMaterialsDir: fs.existsSync(config.topMaterialsDir),
                referenceFolder: fs.existsSync(config.referenceFolder)
            }
        };
    }

    function listDirections(query = {}) {
        const { store } = getStore(query);
        const data = store.read('directions.json', {
            directions: [],
            metadata: {},
            importedAt: null
        });
        const references = store.read('reference-images.json', { images: [] });
        const assetsData = store.read('assets.json', { assets: [] });
        const evidenceData = store.read('direction-evidence.json', emptyDirectionEvidence());
        const directionEvidence = safeArray(evidenceData.evidence)
            .filter(entry => entry && entry.source !== 'material-analysis');
        const materialLearningData = store.read('material-learnings.json', { learnings: [] });
        const referenceCounts = new Map();
        const referenceImagesByDirection = new Map();
        const assetCounts = new Map();
        const runCounts = new Map();
        const evidenceEntries = safeArray(evidenceData.evidence)
            .filter(entry => entry && entry.source !== 'material-analysis');

        safeArray(references.images).forEach(image => {
            const matchedIds = safeArray(image.matchedDirectionIds).length
                ? safeArray(image.matchedDirectionIds)
                : [image.directionId].filter(Boolean);
            matchedIds.forEach(id => {
                referenceCounts.set(id, (referenceCounts.get(id) || 0) + 1);
                const current = referenceImagesByDirection.get(id) || [];
                if (current.length < 6) {
                    current.push(compactReferenceImage(image));
                    referenceImagesByDirection.set(id, current);
                }
            });
        });
        safeArray(assetsData.assets).forEach(asset => {
            if (asset && asset.directionId) {
                assetCounts.set(asset.directionId, (assetCounts.get(asset.directionId) || 0) + 1);
            }
        });
        readRuns(store).forEach(run => {
            const id = run.sourceDirection && run.sourceDirection.id;
            if (id) {
                runCounts.set(id, (runCounts.get(id) || 0) + 1);
            }
        });
        const visualDnaSources = preloadVisualDnaSources(store);
        const directionTags = readDirectionTagsOrBuild(store);
        const directionTagsIndex = buildDirectionTagsIndex(directionTags);
        const filtered = applyDirectionFilters(data.directions, query);
        const offset = Math.max(0, Math.floor(Number(query.offset) || 0));
        const limit = Math.max(1, Math.min(500, Math.floor(Number(query.limit) || 100)));
        const items = filtered.slice(offset, offset + limit).map(direction => {
            const matchedEvidence = evidenceEntries
                .filter(entry => directionEvidenceMatches(direction, entry))
                .sort((a, b) => toTimeMs(b.updatedAt || b.createdAt) - toTimeMs(a.updatedAt || a.createdAt));
            const activePoolReferences = activeReferenceImagesForDirection(references.images, direction.id).map(compactReferenceImage);
            const visualDnaSummary = collectDirectionVisualDnaEvidence(direction, visualDnaSources);
            const directionTagSummary = directionTagRecordForDirection(direction, directionTagsIndex);
            const tagReferenceStatus = directionReferenceTagStatus(
                activePoolReferences.length,
                Boolean(directionTagSummary.analysis && directionTagSummary.analysis.source === DIRECTION_TAG_REFERENCE_VISION_SOURCE)
            );
            const enrichedDirectionTagSummary = {
                ...directionTagSummary,
                referenceImageCount: activePoolReferences.length,
                referenceImageStatus: directionTagSummary.referenceImageStatus || tagReferenceStatus.status,
                referenceImageStatusLabel: directionTagSummary.referenceImageStatusLabel || tagReferenceStatus.label,
                referenceImageBucket: tagReferenceStatus.bucket,
                needsMoreReferences: tagReferenceStatus.needsMoreReferences,
                referenceImageMessage: tagReferenceStatus.message
            };

            return {
                ...direction,
                directionTags: enrichedDirectionTagSummary.tags,
                riskTags: enrichedDirectionTagSummary.riskTags,
                directionTagSummary: enrichedDirectionTagSummary,
                tagReferenceStatus,
                visualDna: direction.visualDna || visualDnaSummary.visualDna,
                visualDnaSummary: {
                    visualDna: visualDnaSummary.visualDna,
                    summaryText: visualDnaSummary.summaryText,
                    source: visualDnaSummary.source,
                    confidence: visualDnaSummary.confidence,
                    evidenceCount: visualDnaSummary.evidenceCount,
                    missing: visualDnaSummary.missing
                },
                evidenceCount: matchedEvidence.length,
                knowledgeStats: {
                    matchedReferenceCount: referenceCounts.get(direction.id) || 0,
                    activeReferenceCount: activePoolReferences.length,
                    referenceHintCount: safeArray(direction.referenceHints).filter(Boolean).length,
                    runCount: runCounts.get(direction.id) || 0,
                    assetCount: assetCounts.get(direction.id) || 0,
                    evidenceCount: matchedEvidence.length
                },
                evidencePreview: matchedEvidence.slice(0, 4).map(compactDirectionEvidence),
                referencePool: activePoolReferences,
                referenceImages: referenceImagesByDirection.get(direction.id) || []
            };
        });

        return {
            success: true,
            importedAt: data.importedAt,
            total: filtered.length,
            offset,
            limit,
            directions: items
        };
    }

    function compactDirectionDraft(draft = {}, directions = [], context = {}) {
        const similarDirections = Array.isArray(draft.similarDirections)
            ? draft.similarDirections
            : findSimilarDirections(directions, draft);
        const governance = buildDirectionDraftGovernance(draft, directions, {
            ...context,
            evidenceEntries: context.evidenceEntries || []
        });
        return {
            id: draft.id || '',
            status: normalizeDirectionStatus(draft.status, 'draft'),
            name: draft.name || '',
            path: draft.path || '',
            description: draft.description || '',
            primaryTag: draft.primaryTag || '',
            secondaryTag: draft.secondaryTag || '',
            tertiaryTag: draft.tertiaryTag || '',
            subTag: draft.subTag || '',
            source: draft.source || 'agent',
            sourceRunId: draft.sourceRunId || '',
            sourceAgentTaskRunId: draft.sourceAgentTaskRunId || '',
            sourceDirectionId: draft.sourceDirectionId || '',
            sourceDirectionPath: draft.sourceDirectionPath || '',
            sourceDirectionName: draft.sourceDirectionName || '',
            sourceStrategy: draft.sourceStrategy || '',
            targetLevel: draft.targetLevel || '',
            dimensions: draft.dimensions || {},
            visualHook: draft.visualHook || draftDimensionValue(draft, 'visualHook'),
            riskNote: draft.riskNote || '',
            productionAdvice: draft.productionAdvice || '',
            avoidRules: safeArray(draft.avoidRules),
            duplicateRisk: draft.duplicateRisk || '',
            reason: draft.reason || '',
            sourceLearningId: draft.sourceLearningId || '',
            sourceMaterialId: draft.sourceMaterialId || '',
            sourceMaterialName: draft.sourceMaterialName || '',
            sourceProjectName: draft.sourceProjectName || '',
            sourceWeekId: draft.sourceWeekId || '',
            referenceHints: safeArray(draft.referenceHints),
            mustKeep: draft.mustKeep || '',
            mustAvoid: draft.mustAvoid || '',
            referenceImageStatus: draft.referenceImageStatus || '',
            prompts: compactPromptList(draft.prompts).slice(0, 5),
            promptCount: compactPromptList(draft.prompts).length,
            similarDirections,
            governance,
            acceptedDirectionId: draft.acceptedDirectionId || '',
            decisionReason: draft.decisionReason || '',
            rejectionReason: draft.rejectionReason || '',
            archiveReason: draft.archiveReason || '',
            original: draft.original || draft.description || '',
            modified: draft.modified || '',
            deleteReason: draft.deleteReason || draft.rejectionReason || draft.archiveReason || '',
            previewGenerated: draft.previewGenerated === true,
            legilSkipped: draft.legilSkipped === true,
            legilError: draft.legilError || '',
            selectedAsReference: draft.selectedAsReference === true,
            rating: draft.rating === null || draft.rating === undefined || draft.rating === '' ? null : Number(draft.rating),
            mergedIntoDirectionId: draft.mergedIntoDirectionId || '',
            mergeReason: draft.mergeReason || '',
            createdAt: draft.createdAt || '',
            updatedAt: draft.updatedAt || '',
            acceptedAt: draft.acceptedAt || '',
            rejectedAt: draft.rejectedAt || '',
            archivedAt: draft.archivedAt || ''
        };
    }

    function readDirectionDrafts(store) {
        store.ensureBase();
        writeIfMissing(store, 'direction-drafts.json', emptyDirectionDrafts);
        return store.read('direction-drafts.json', emptyDirectionDrafts());
    }

    function writeDirectionDrafts(store, data, updatedAt = nowIso()) {
        store.write('direction-drafts.json', {
            ...data,
            version: data.version || 1,
            updatedAt,
            drafts: safeArray(data.drafts)
        });
    }

    function listDirectionDrafts(query = {}) {
        const { store } = getStore(query);
        const data = readDirectionDrafts(store);
        const directionData = store.read('directions.json', { directions: [] });
        const referenceData = store.read('reference-images.json', { images: [] });
        const feedbackData = store.read('feedback.json', { feedback: [] });
        const evidenceData = store.read('direction-evidence.json', emptyDirectionEvidence());
        const governanceContext = {
            referenceImages: safeArray(referenceData.images),
            feedbackEntries: safeArray(feedbackData.feedback),
            evidenceEntries: safeArray(evidenceData.evidence)
        };
        let drafts = safeArray(data.drafts).map(draft => compactDirectionDraft(draft, directionData.directions, governanceContext));
        const keyword = normalizeText(query.q || query.keyword).toLowerCase();
        const status = normalizeText(query.status).toLowerCase();
        const governanceFilter = normalizeText(query.governance || query.queue || query.filter).toLowerCase();
        const runId = normalizeText(query.runId);
        const sourceDirectionId = normalizeText(query.sourceDirectionId);

        if (keyword) {
            drafts = drafts.filter(draft => [
                draft.id,
                draft.name,
                draft.path,
                draft.description,
                draft.sourceDirectionPath,
                draft.sourceStrategy,
                draft.decisionReason,
                draft.rejectionReason,
                draft.mergeReason
            ].some(value => String(value || '').toLowerCase().includes(keyword)));
        }
        if (status && DIRECTION_STATUSES.has(status)) {
            drafts = drafts.filter(draft => draft.status === status);
        }
        if (runId) {
            drafts = drafts.filter(draft => draft.sourceRunId === runId);
        }
        if (sourceDirectionId) {
            drafts = drafts.filter(draft => draft.sourceDirectionId === sourceDirectionId);
        }
        if (governanceFilter) {
            drafts = drafts.filter(draft => directionDraftMatchesGovernance(draft, governanceFilter));
        }

        drafts.sort((a, b) => toTimeMs(b.updatedAt || b.createdAt) - toTimeMs(a.updatedAt || a.createdAt));
        const { offset, limit } = parsePaging(query, { limit: 50, maxLimit: 300 });
        const counts = {};
        safeArray(data.drafts).forEach(draft => {
            const draftStatus = normalizeDirectionStatus(draft.status, 'draft');
            counts[draftStatus] = (counts[draftStatus] || 0) + 1;
        });
        const allCompactedDrafts = safeArray(data.drafts).map(draft => compactDirectionDraft(draft, directionData.directions, governanceContext));
        const governanceCounts = {
            missingDna: allCompactedDrafts.filter(draft => directionDraftMatchesGovernance(draft, 'missing_dna')).length,
            missingReference: allCompactedDrafts.filter(draft => directionDraftMatchesGovernance(draft, 'missing_reference')).length,
            highDuplicateRisk: allCompactedDrafts.filter(draft => directionDraftMatchesGovernance(draft, 'high_duplicate_risk')).length,
            hasGoodEvidence: allCompactedDrafts.filter(draft => directionDraftMatchesGovernance(draft, 'has_good_evidence')).length,
            readyToAccept: allCompactedDrafts.filter(draft => directionDraftMatchesGovernance(draft, 'ready_to_accept')).length,
            needsEdit: allCompactedDrafts.filter(draft => directionDraftMatchesGovernance(draft, 'needs_edit')).length
        };

        return {
            success: true,
            updatedAt: data.updatedAt || '',
            total: drafts.length,
            offset,
            limit,
            counts,
            governanceCounts,
            drafts: drafts.slice(offset, offset + limit)
        };
    }

    function extractDirectionDraftsFromRun(runId, payload = {}, query = {}) {
        const { store } = getStore(query);
        store.ensureBase();
        const run = getRun(runId, query);
        if (!run) {
            return {
                success: false,
                message: `运行记录不存在: ${runId}`
            };
        }

        const directionData = store.read('directions.json', { directions: [] });
        const sourceDirection = run.sourceDirection || {};
        const requestedCandidateKeys = new Set(safeArray(payload.candidateKeys || payload.reviewKeys || (payload.candidateKey ? [payload.candidateKey] : []))
            .map(value => normalizeText(value))
            .filter(Boolean));
        const payloadCandidates = safeArray(payload.candidates || payload.reviewCandidates)
            .concat(payload.candidate && typeof payload.candidate === 'object' ? [payload.candidate] : []);
        let candidates = reviewCandidatesToDraftCandidates(payloadCandidates, sourceDirection, requestedCandidateKeys);
        if (!candidates.length && run.directionCandidateReview) {
            candidates = reviewCandidatesToDraftCandidates(
                safeArray(run.directionCandidateReview.selected).concat(safeArray(run.directionCandidateReview.rejected)),
                sourceDirection,
                requestedCandidateKeys
            );
        }
        if (!candidates.length) {
            candidates = filterDraftCandidatesByKeys(candidateDirectionsToDraftCandidates(
                (run.agentTask && run.agentTask.result && run.agentTask.result.candidateDirections)
                || (run.agentOutput && run.agentOutput.candidateDirections)
                || run.candidateDirections
                || []
            ), requestedCandidateKeys);
        }
        if (!candidates.length) {
            candidates = extractDraftCandidatesFromWorkbook(run.agentOutput && run.agentOutput.localPath);
        }
        if (!candidates.length) {
            candidates = extractDraftCandidatesFromMarkdown(run.agentOutput && (run.agentOutput.rawTableMarkdown || run.agentOutput.rawText));
        }
        if (!candidates.length && safeArray(run.prompts).length) {
            const grouped = new Map();
            safeArray(run.prompts).forEach(prompt => {
                const name = normalizeText(prompt.direction || prompt.promptDirection || prompt.promptTitle);
                if (!name) return;
                const current = grouped.get(name) || {
                    referenceDirection: sourceDirection.name || sourceDirection.path || '',
                    name,
                    description: '',
                    sourceStrategy: '从 run 已通过 Prompt Gate 的提示词回收',
                    prompts: []
                };
                current.prompts.push({
                    title: prompt.promptTitle || `提示词${current.prompts.length + 1}`,
                    prompt: prompt.prompt
                });
                grouped.set(name, current);
            });
            candidates = Array.from(grouped.values());
        }

        if (!candidates.length) {
            return {
                success: false,
                message: '没有从该 run 中提取到可审核的新方向草案'
            };
        }

        const data = readDirectionDrafts(store);
        const existingById = new Map(safeArray(data.drafts).map(draft => [draft.id, draft]));
        const timestamp = nowIso();
        let createdCount = 0;
        let updatedCount = 0;

        const nextDrafts = safeArray(data.drafts).slice();
        candidates.forEach(candidate => {
            const name = normalizeText(candidate.name || candidate.referenceDirection || '未命名方向').slice(0, 120);
            const description = normalizeText(candidate.description).slice(0, 1200);
            const expandedPath = buildExpandedPath(sourceDirection, name);
            const pathParts = splitDirectionPath(expandedPath);
            const draftId = buildDraftId(run.runId, sourceDirection.id, name, description);
            const existing = existingById.get(draftId);
            const draft = {
                ...(existing || {}),
                id: draftId,
                status: existing ? normalizeDirectionStatus(existing.status, 'draft') : 'draft',
                name,
                path: expandedPath,
                description,
                primaryTag: pathParts[0] || '',
                secondaryTag: pathParts[1] || '',
                tertiaryTag: pathParts[2] || '',
                subTag: pathParts.slice(3).join('/'),
                source: 'agent',
                sourceRunId: run.runId,
                sourceAgentTaskRunId: run.agentTaskRunId || '',
                sourceDirectionId: sourceDirection.id || '',
                sourceDirectionPath: sourceDirection.path || '',
                sourceDirectionName: sourceDirection.name || '',
                sourceStrategy: normalizeText(candidate.sourceStrategy).slice(0, 1200),
                targetLevel: normalizeText(candidate.targetLevel).slice(0, 40),
                directionTags: safeArray(candidate.directionTags).map(normalizeText).filter(Boolean).slice(0, 8),
                mainTags: safeArray(candidate.mainTags).map(normalizeText).filter(Boolean).slice(0, 5),
                extraTags: safeArray(candidate.extraTags).map(normalizeText).filter(Boolean).slice(0, 8),
                riskTags: safeArray(candidate.riskTags).map(normalizeText).filter(Boolean).slice(0, 6),
                dimensions: candidate.dimensions && typeof candidate.dimensions === 'object' ? candidate.dimensions : {},
                visualHook: normalizeText(candidate.visualHook || draftDimensionValue(candidate, 'visualHook')).slice(0, 600),
                riskNote: normalizeText(candidate.riskNote).slice(0, 600),
                productionAdvice: normalizeText(candidate.productionAdvice).slice(0, 1200),
                avoidRules: safeArray(candidate.avoidRules).map(normalizeText).filter(Boolean).slice(0, 12),
                duplicateRisk: normalizeText(candidate.duplicateRisk).slice(0, 120),
                reason: normalizeText(candidate.reason).slice(0, 1200),
                original: description,
                modified: '',
                deleteReason: '',
                previewGenerated: safeArray(run.assets && run.assets.assetIds).length > 0 || safeArray(run.assetIds).length > 0,
                legilSkipped: run.agentOnly === true || run.status === 'completed' && !safeArray(run.assetIds).length,
                legilError: run.error || run.legilError || '',
                selectedAsReference: false,
                rating: null,
                prompts: compactPromptList(candidate.prompts).slice(0, 5),
                similarDirections: findSimilarDirections(directionData.directions, {
                    name,
                    path: expandedPath,
                    description
                }),
                createdAt: existing && existing.createdAt ? existing.createdAt : timestamp,
                updatedAt: timestamp
            };

            if (existing) {
                const index = nextDrafts.findIndex(item => item.id === draftId);
                if (index >= 0 && normalizeDirectionStatus(nextDrafts[index].status, 'draft') === 'draft') {
                    nextDrafts[index] = draft;
                    updatedCount += 1;
                }
            } else {
                nextDrafts.push(draft);
                createdCount += 1;
            }
        });

        writeDirectionDrafts(store, {
            ...data,
            drafts: nextDrafts
        }, timestamp);

        const directionDraftIds = candidates.map(candidate => buildDraftId(
            run.runId,
            sourceDirection.id,
            normalizeText(candidate.name || candidate.referenceDirection || '未命名方向').slice(0, 120),
            normalizeText(candidate.description).slice(0, 1200)
        ));
        updateRun(store, run.runId, {
            directionDraftIds: Array.from(new Set(safeArray(run.directionDraftIds).concat(directionDraftIds)))
        });

        return {
            success: true,
            message: `方向草案已提取：新增 ${createdCount}，更新 ${updatedCount}`,
            createdCount,
            updatedCount,
            totalExtracted: candidates.length,
            drafts: directionDraftIds
                .map(id => nextDrafts.find(draft => draft.id === id))
                .filter(Boolean)
                .map(draft => compactDirectionDraft(draft, directionData.directions))
        };
    }

    function acceptDirectionDraft(draftId, payload = {}, query = {}) {
        const { store } = getStore(query);
        const data = readDirectionDrafts(store);
        const draftIndex = safeArray(data.drafts).findIndex(draft => draft && draft.id === draftId);
        if (draftIndex < 0) {
            return {
                success: false,
                message: `方向草案不存在: ${draftId}`
            };
        }

        const draft = data.drafts[draftIndex];
        const directionData = store.read('directions.json', {
            version: 1,
            importedAt: null,
            directions: []
        });
        const referenceData = store.read('reference-images.json', { images: [] });
        const feedbackData = store.read('feedback.json', { feedback: [] });
        const evidenceData = store.read('direction-evidence.json', emptyDirectionEvidence());
        const governanceContext = {
            referenceImages: safeArray(referenceData.images),
            feedbackEntries: safeArray(feedbackData.feedback),
            evidenceEntries: safeArray(evidenceData.evidence)
        };
        const governance = buildDirectionDraftGovernance(draft, directionData.directions, governanceContext);
        if (governance.preflight.hardErrors.length) {
            return {
                success: false,
                code: 'draft_preflight_error',
                message: governance.preflight.hardErrors.join('；'),
                preflight: governance.preflight,
                governance,
                draft: compactDirectionDraft(draft, directionData.directions, governanceContext)
            };
        }
        if (governance.preflight.warnings.length && payload.confirmPreflight !== true) {
            return {
                success: false,
                code: 'draft_preflight',
                needsConfirmation: true,
                needsPreflightConfirmation: true,
                message: '采纳前检查发现需要确认的事项',
                preflight: governance.preflight,
                governance,
                draft: compactDirectionDraft(draft, directionData.directions, governanceContext)
            };
        }
        if (normalizeDirectionStatus(draft.status, 'draft') === 'accepted' && draft.acceptedDirectionId) {
            return {
                success: true,
                message: '方向草案此前已采纳',
                draft: compactDirectionDraft(draft, directionData.directions, governanceContext),
                directionId: draft.acceptedDirectionId
            };
        }

        const directionId = draft.acceptedDirectionId || buildAcceptedDirectionId(draft);
        const similarDirections = findSimilarDirections(directionData.directions, draft, {
            excludeId: directionId
        });
        if (similarDirections.length && payload.allowSimilar !== true) {
            return {
                success: false,
                code: 'similar_direction',
                needsConfirmation: true,
                message: '发现相似方向，请确认后再采纳，或使用合并',
                similarDirections
            };
        }

        const timestamp = nowIso();
        const pathParts = splitDirectionPath(draft.path);
        const nextDirection = {
            id: directionId,
            orderIndex: safeArray(directionData.directions).length + 1,
            sheetName: 'local-growth',
            path: draft.path || draft.name,
            name: draft.name || pathParts[pathParts.length - 1] || '未命名方向',
            primaryTag: draft.primaryTag || pathParts[0] || '',
            secondaryTag: draft.secondaryTag || pathParts[1] || '',
            tertiaryTag: draft.tertiaryTag || pathParts[2] || '',
            subTag: draft.subTag || pathParts.slice(3).join('/'),
            description: draft.description || '',
            referenceHints: safeArray(draft.referenceHints),
            mustKeep: draft.mustKeep || '',
            mustAvoid: draft.mustAvoid || '',
            autoRun: payload.autoRun === false ? false : true,
            priority: Math.max(1, Math.min(100, Math.round(Number(payload.priority) || 50))),
            status: 'accepted',
            source: draft.source || 'agent',
            sourceRunId: draft.sourceRunId || '',
            sourceAgentTaskRunId: draft.sourceAgentTaskRunId || '',
            sourceDraftId: draft.id,
            sourceLearningId: draft.sourceLearningId || '',
            sourceMaterialId: draft.sourceMaterialId || '',
            sourceMaterialName: draft.sourceMaterialName || '',
            sourceProjectName: draft.sourceProjectName || '',
            sourceWeekId: draft.sourceWeekId || '',
            parentDirectionId: draft.sourceDirectionId || '',
            parentDirectionPath: draft.sourceDirectionPath || '',
            sourceStrategy: draft.sourceStrategy || '',
            visualDna: governance.visualDna,
            dimensions: draft.dimensions && typeof draft.dimensions === 'object' ? draft.dimensions : {},
            visualHook: draft.visualHook || draftDimensionValue(draft, 'visualHook'),
            riskNote: draft.riskNote || '',
            productionAdvice: draft.productionAdvice || '',
            avoidRules: safeArray(draft.avoidRules),
            duplicateRisk: draft.duplicateRisk || '',
            governance: {
                dnaCompleteness: governance.dnaCompleteness,
                duplicateRiskLevel: governance.duplicateRiskLevel,
                acceptedFromDraftId: draft.id
            },
            referenceImageStatus: governance.referenceCount > 0 ? (draft.referenceImageStatus || 'ready') : 'manual_pending',
            acceptanceReason: normalizeText(payload.reason || payload.acceptanceReason || payload.whyGood).slice(0, 1200),
            samplePrompts: compactPromptList(draft.prompts).slice(0, 5),
            createdAt: timestamp,
            updatedAt: timestamp,
            stats: {
                expandedCount: 0,
                promptCount: 0,
                imageCount: 0,
                lastRunAt: null,
                failureCount: 0
            },
            lifecycle: {
                acceptedAt: timestamp,
                acceptedFromDraftId: draft.id,
                acceptedBy: 'manual'
            }
        };

        const existingDirectionIndex = safeArray(directionData.directions).findIndex(direction => direction.id === directionId);
        const nextDirections = safeArray(directionData.directions).slice();
        if (existingDirectionIndex >= 0) {
            nextDirections[existingDirectionIndex] = {
                ...nextDirections[existingDirectionIndex],
                ...nextDirection,
                stats: nextDirections[existingDirectionIndex].stats || nextDirection.stats
            };
        } else {
            nextDirections.push(nextDirection);
        }

        store.write('directions.json', {
            ...directionData,
            version: directionData.version || 1,
            updatedAt: timestamp,
            directions: nextDirections
        });

        const updatedDraft = {
            ...draft,
            status: 'accepted',
            acceptedAt: timestamp,
            updatedAt: timestamp,
            acceptedDirectionId: directionId,
            decisionReason: nextDirection.acceptanceReason,
            modified: normalizeText(payload.modified || payload.description || draft.modified).slice(0, 1200),
            previewGenerated: payload.previewGenerated === true || draft.previewGenerated === true,
            legilSkipped: payload.legilSkipped === true || draft.legilSkipped === true,
            legilError: normalizeText(payload.legilError || draft.legilError).slice(0, 1200),
            selectedAsReference: payload.selectedAsReference === true || draft.selectedAsReference === true,
            rating: payload.rating === null || payload.rating === undefined || payload.rating === '' ? (draft.rating || null) : Number(payload.rating),
            referenceImageStatus: nextDirection.referenceImageStatus,
            governanceSnapshot: governance,
            similarDirections
        };
        const nextDrafts = safeArray(data.drafts).slice();
        nextDrafts[draftIndex] = updatedDraft;
        writeDirectionDrafts(store, {
            ...data,
            drafts: nextDrafts
        }, timestamp);
        const feedback = createDirectionDraftFeedback(updatedDraft, {
            ...payload,
            targetDirectionId: directionId,
            modified: payload.modified || nextDirection.description || '',
            note: payload.note || nextDirection.acceptanceReason || '方向草案已采纳'
        }, 'good', 'manual-direction-candidate-review');
        appendFeedbackEntries(store, [feedback], timestamp);

        return {
            success: true,
            message: '方向已采纳并进入本地成长层',
            direction: nextDirection,
            draft: compactDirectionDraft(updatedDraft, nextDirections),
            feedback: compactFeedback(feedback)
        };
    }

    function rejectDirectionDraft(draftId, payload = {}, query = {}) {
        const { store } = getStore(query);
        const data = readDirectionDrafts(store);
        const draftIndex = safeArray(data.drafts).findIndex(draft => draft && draft.id === draftId);
        if (draftIndex < 0) {
            return {
                success: false,
                message: `方向草案不存在: ${draftId}`
            };
        }
        const timestamp = nowIso();
        const nextDrafts = safeArray(data.drafts).slice();
        nextDrafts[draftIndex] = {
            ...nextDrafts[draftIndex],
            status: 'rejected',
            rejectionReason: normalizeText(payload.reason || payload.rejectionReason).slice(0, 1200),
            deleteReason: normalizeText(payload.deleteReason || payload.reason || payload.rejectionReason).slice(0, 1200),
            legilSkipped: payload.legilSkipped === true || nextDrafts[draftIndex].legilSkipped === true,
            legilError: normalizeText(payload.legilError || nextDrafts[draftIndex].legilError).slice(0, 1200),
            rating: payload.rating === null || payload.rating === undefined || payload.rating === '' ? (nextDrafts[draftIndex].rating || null) : Number(payload.rating),
            rejectedAt: timestamp,
            updatedAt: timestamp
        };
        writeDirectionDrafts(store, {
            ...data,
            drafts: nextDrafts
        }, timestamp);
        const feedback = createDirectionDraftFeedback(nextDrafts[draftIndex], {
            ...payload,
            deleteReason: payload.deleteReason || payload.reason || payload.rejectionReason,
            note: payload.note || payload.reason || payload.rejectionReason || '方向草案已拒绝'
        }, 'rejected', 'manual-direction-candidate-review');
        appendFeedbackEntries(store, [feedback], timestamp);
        return {
            success: true,
            message: '方向草案已拒绝，原因已记录为反例',
            draft: compactDirectionDraft(nextDrafts[draftIndex]),
            feedback: compactFeedback(feedback)
        };
    }

    function archiveDirectionDraft(draftId, payload = {}, query = {}) {
        const { store } = getStore(query);
        const data = readDirectionDrafts(store);
        const draftIndex = safeArray(data.drafts).findIndex(draft => draft && draft.id === draftId);
        if (draftIndex < 0) {
            return {
                success: false,
                message: `方向草案不存在: ${draftId}`
            };
        }
        const timestamp = nowIso();
        const nextDrafts = safeArray(data.drafts).slice();
        nextDrafts[draftIndex] = {
            ...nextDrafts[draftIndex],
            status: 'archived',
            archiveReason: normalizeText(payload.reason || payload.archiveReason).slice(0, 1200),
            deleteReason: normalizeText(payload.deleteReason || payload.reason || payload.archiveReason).slice(0, 1200),
            rating: payload.rating === null || payload.rating === undefined || payload.rating === '' ? (nextDrafts[draftIndex].rating || null) : Number(payload.rating),
            archivedAt: timestamp,
            updatedAt: timestamp
        };
        writeDirectionDrafts(store, {
            ...data,
            drafts: nextDrafts
        }, timestamp);
        const feedback = createDirectionDraftFeedback(nextDrafts[draftIndex], {
            ...payload,
            deleteReason: payload.deleteReason || payload.reason || payload.archiveReason,
            note: payload.note || payload.reason || payload.archiveReason || '方向草案已归档'
        }, 'normal', 'manual-direction-candidate-review');
        appendFeedbackEntries(store, [feedback], timestamp);
        return {
            success: true,
            message: '方向草案已归档',
            draft: compactDirectionDraft(nextDrafts[draftIndex]),
            feedback: compactFeedback(feedback)
        };
    }

    function mergeDirectionDraft(draftId, payload = {}, query = {}) {
        const targetDirectionId = normalizeText(payload.targetDirectionId || payload.mergeIntoDirectionId);
        if (!targetDirectionId) {
            throw new Error('合并需要指定 targetDirectionId');
        }

        const { store } = getStore(query);
        const directionData = store.read('directions.json', { directions: [] });
        const target = safeArray(directionData.directions).find(direction => direction.id === targetDirectionId);
        if (!target) {
            return {
                success: false,
                message: `目标方向不存在: ${targetDirectionId}`
            };
        }

        const data = readDirectionDrafts(store);
        const draftIndex = safeArray(data.drafts).findIndex(draft => draft && draft.id === draftId);
        if (draftIndex < 0) {
            return {
                success: false,
                message: `方向草案不存在: ${draftId}`
            };
        }

        const timestamp = nowIso();
        const nextDrafts = safeArray(data.drafts).slice();
        nextDrafts[draftIndex] = {
            ...nextDrafts[draftIndex],
            status: 'archived',
            mergedIntoDirectionId: targetDirectionId,
            mergeReason: normalizeText(payload.reason || payload.mergeReason).slice(0, 1200),
            modified: normalizeText(payload.modified || payload.description || nextDrafts[draftIndex].modified).slice(0, 1200),
            rating: payload.rating === null || payload.rating === undefined || payload.rating === '' ? (nextDrafts[draftIndex].rating || null) : Number(payload.rating),
            archivedAt: timestamp,
            updatedAt: timestamp
        };
        writeDirectionDrafts(store, {
            ...data,
            drafts: nextDrafts
        }, timestamp);
        const feedback = createDirectionDraftFeedback(nextDrafts[draftIndex], {
            ...payload,
            targetDirectionId,
            note: payload.note || payload.reason || payload.mergeReason || '方向草案已合并到现有方向'
        }, 'normal', 'manual-direction-candidate-review');
        appendFeedbackEntries(store, [feedback], timestamp);
        return {
            success: true,
            message: '方向草案已合并到现有方向',
            targetDirection: target,
            draft: compactDirectionDraft(nextDrafts[draftIndex], directionData.directions),
            feedback: compactFeedback(feedback)
        };
    }

    function updateDirectionStatus(directionId, payload = {}, query = {}) {
        const status = normalizeDirectionStatus(payload.status, '');
        if (!status || status === 'draft' || status === 'rejected') {
            throw new Error('方向状态只能设置为 seed / accepted / archived / disabled');
        }

        const { store } = getStore(query);
        const data = store.read('directions.json', { directions: [] });
        const directions = safeArray(data.directions).slice();
        const index = directions.findIndex(direction => direction && direction.id === directionId);
        if (index < 0) {
            return {
                success: false,
                message: `方向不存在: ${directionId}`
            };
        }

        const timestamp = nowIso();
        const previous = directions[index];
        const lifecycle = previous.lifecycle || {};
        directions[index] = {
            ...previous,
            status,
            autoRun: status === 'archived' || status === 'disabled'
                ? false
                : (payload.autoRun !== undefined ? payload.autoRun !== false : previous.autoRun !== false),
            updatedAt: timestamp,
            statusReason: normalizeText(payload.reason || payload.statusReason).slice(0, 1200),
            lifecycle: {
                ...lifecycle,
                previousStatus: normalizeDirectionStatus(previous.status, 'seed'),
                statusUpdatedAt: timestamp,
                statusReason: normalizeText(payload.reason || payload.statusReason).slice(0, 1200)
            }
        };

        store.write('directions.json', {
            ...data,
            version: data.version || 1,
            updatedAt: timestamp,
            directions
        });

        return {
            success: true,
            message: status === 'disabled' ? '方向已禁跑' : '方向状态已更新',
            direction: directions[index]
        };
    }

    function mergeDirection(directionId, payload = {}, query = {}) {
        const targetDirectionId = normalizeText(payload.targetDirectionId || payload.mergeIntoDirectionId);
        if (!targetDirectionId || targetDirectionId === directionId) {
            throw new Error('合并需要指定不同的 targetDirectionId');
        }

        const { store } = getStore(query);
        const data = store.read('directions.json', { directions: [] });
        const directions = safeArray(data.directions).slice();
        const sourceIndex = directions.findIndex(direction => direction && direction.id === directionId);
        const target = directions.find(direction => direction && direction.id === targetDirectionId);
        if (sourceIndex < 0 || !target) {
            return {
                success: false,
                message: '源方向或目标方向不存在'
            };
        }

        const timestamp = nowIso();
        directions[sourceIndex] = {
            ...directions[sourceIndex],
            status: 'archived',
            autoRun: false,
            mergedIntoDirectionId: targetDirectionId,
            mergeReason: normalizeText(payload.reason || payload.mergeReason).slice(0, 1200),
            updatedAt: timestamp,
            lifecycle: {
                ...(directions[sourceIndex].lifecycle || {}),
                mergedAt: timestamp,
                mergedIntoDirectionId: targetDirectionId
            }
        };
        store.write('directions.json', {
            ...data,
            version: data.version || 1,
            updatedAt: timestamp,
            directions
        });

        return {
            success: true,
            message: '方向已合并并归档源方向',
            direction: directions[sourceIndex],
            targetDirection: target
        };
    }

    function readDirectionEvidence(store) {
        store.ensureBase();
        writeIfMissing(store, 'direction-evidence.json', emptyDirectionEvidence);
        return store.read('direction-evidence.json', emptyDirectionEvidence());
    }

    function writeDirectionEvidence(store, data, updatedAt = nowIso()) {
        store.write('direction-evidence.json', {
            ...data,
            version: data.version || 1,
            updatedAt,
            evidence: safeArray(data.evidence)
        });
    }

    function compactDirectionEvidence(entry = {}) {
        return {
            id: entry.id || entry.evidenceId || '',
            evidenceId: entry.evidenceId || '',
            status: entry.status || '',
            mode: entry.mode || '',
            decision: entry.decision || '',
            projectName: entry.projectName || '',
            weekId: entry.weekId || '',
            directionKey: entry.directionKey || '',
            targetDirectionId: entry.targetDirectionId || '',
            targetDirectionPath: entry.targetDirectionPath || '',
            targetDirectionName: entry.targetDirectionName || '',
            parentDirectionId: entry.parentDirectionId || '',
            parentDirectionPath: entry.parentDirectionPath || '',
            materialId: entry.materialId || '',
            materialName: entry.materialName || '',
            topRank: entry.topRank || null,
            metrics: entry.metrics || {},
            health: entry.health || null,
            visualInsight: entry.visualInsight || null,
            reason: entry.reason || '',
            assetGroupKey: entry.assetGroupKey || '',
            assetIds: safeArray(entry.assetIds),
            runId: entry.runId || '',
            promptHash: entry.promptHash || '',
            promptDirection: entry.promptDirection || '',
            promptTitle: entry.promptTitle || '',
            prompt: entry.prompt || '',
            reviewStatus: entry.reviewStatus || '',
            reviewLabels: safeArray(entry.reviewLabels),
            reviewNote: entry.reviewNote || '',
            whyGood: entry.whyGood || '',
            source: entry.source || 'manual-asset-review',
            createdAt: entry.createdAt || '',
            updatedAt: entry.updatedAt || ''
        };
    }

    function getAssetGroupForCollection(assets = [], latestFeedbackByAsset, assetId) {
        const compacted = safeArray(assets)
            .map(asset => mergeFeedbackReview(asset, latestFeedbackByAsset))
            .map(compactAsset);
        const anchor = compacted.find(asset => asset.assetId === assetId);
        if (!anchor) return null;
        const groupKey = buildAssetGroupKey(anchor);
        return {
            groupKey,
            anchor,
            assets: compacted.filter(asset => buildAssetGroupKey(asset) === groupKey)
        };
    }

    function collectDirectionFromAsset(assetId, payload = {}, query = {}) {
        const mode = normalizeText(payload.mode || payload.action);
        if (!['merge', 'new'].includes(mode)) {
            throw new Error('收录方式必须是 merge 或 new');
        }

        const { store } = getStore(query);
        store.ensureBase();
        const assetsData = store.read('assets.json', emptyAssets());
        const feedbackData = store.read('feedback.json', emptyFeedback());
        const latestFeedbackByAsset = buildLatestFeedbackByAsset(feedbackData.feedback);
        const group = getAssetGroupForCollection(assetsData.assets, latestFeedbackByAsset, assetId);
        if (!group) {
            return {
                success: false,
                message: `资产不存在: ${assetId}`
            };
        }

        const evidenceData = readDirectionEvidence(store);
        const existingEvidence = safeArray(evidenceData.evidence).find(entry => entry.assetGroupKey === group.groupKey);
        if (existingEvidence && payload.force !== true) {
            return {
                success: true,
                alreadyCollected: true,
                message: '这组图片已经收录过方向',
                evidence: compactDirectionEvidence(existingEvidence)
            };
        }

        const directionData = store.read('directions.json', {
            version: 1,
            importedAt: null,
            directions: []
        });
        const directions = safeArray(directionData.directions).slice();
        const sourceDirection = directions.find(direction => direction.id === group.anchor.directionId)
            || {
                id: group.anchor.directionId || '',
                path: group.anchor.directionPath || group.anchor.directionName || '',
                name: group.anchor.directionName || ''
            };
        const parentDirectionId = normalizeText(payload.parentDirectionId) || sourceDirection.id || group.anchor.directionId || '';
        const parentDirection = directions.find(direction => direction.id === parentDirectionId) || sourceDirection;

        let targetDirection = null;
        if (mode === 'merge') {
            const targetDirectionId = normalizeText(payload.targetDirectionId) || parentDirectionId;
            targetDirection = directions.find(direction => direction.id === targetDirectionId);
            if (!targetDirection) {
                return {
                    success: false,
                    message: `目标方向不存在: ${targetDirectionId}`
                };
            }
        } else {
            const name = normalizeText(payload.name || group.anchor.promptDirection || group.anchor.promptTitle || '未命名方向').slice(0, 120);
            const description = normalizeText(payload.description || group.anchor.promptDirection || group.anchor.prompt || '').slice(0, 1200);
            const pathValue = buildExpandedPath(parentDirection, name);
            const similarDirections = findSimilarDirections(directions, {
                name,
                path: pathValue,
                description
            });
            if (similarDirections.length && payload.allowSimilar !== true) {
                return {
                    success: false,
                    code: 'similar_direction',
                    needsConfirmation: true,
                    message: '发现相似方向，建议并入已有方向或确认后再新增',
                    similarDirections
                };
            }

            const pathParts = splitDirectionPath(pathValue);
            const directionId = buildCollectedDirectionId(parentDirectionId, name, group.groupKey);
            targetDirection = {
                id: directionId,
                orderIndex: directions.length + 1,
                sheetName: 'local-growth',
                path: pathValue,
                name,
                primaryTag: pathParts[0] || '',
                secondaryTag: pathParts[1] || '',
                tertiaryTag: pathParts[2] || '',
                subTag: pathParts.slice(3).join('/'),
                description,
                referenceHints: [],
                mustKeep: '',
                mustAvoid: '',
                autoRun: payload.autoRun === false ? false : true,
                priority: Math.max(1, Math.min(100, Math.round(Number(payload.priority) || 55))),
                status: 'accepted',
                source: 'manual_from_reviewed_asset',
                parentDirectionId,
                parentDirectionPath: parentDirection.path || '',
                sourceAssetId: group.anchor.assetId,
                sourceRunId: group.anchor.runId,
                sourcePromptHash: group.anchor.promptHash,
                acceptanceReason: normalizeText(payload.whyGood || group.anchor.reviewNote || group.anchor.promptDirection).slice(0, 1200),
                samplePrompts: compactPromptList([{ prompt: group.anchor.prompt, title: group.anchor.promptTitle || '来源 prompt' }]),
                createdAt: nowIso(),
                updatedAt: nowIso(),
                stats: {
                    expandedCount: 0,
                    promptCount: 0,
                    imageCount: 0,
                    lastRunAt: null,
                    failureCount: 0
                },
                evidenceStats: {
                    successCaseCount: 0,
                    lastEvidenceAt: ''
                },
                lifecycle: {
                    acceptedAt: nowIso(),
                    acceptedBy: 'manual',
                    acceptedFromAssetGroupKey: group.groupKey
                }
            };

            const existingDirectionIndex = directions.findIndex(direction => direction.id === directionId);
            if (existingDirectionIndex >= 0) {
                targetDirection = {
                    ...directions[existingDirectionIndex],
                    ...targetDirection,
                    stats: directions[existingDirectionIndex].stats || targetDirection.stats
                };
                directions[existingDirectionIndex] = targetDirection;
            } else {
                directions.push(targetDirection);
            }
        }

        const timestamp = nowIso();
        const whyGood = normalizeText(payload.whyGood || group.anchor.reviewNote || safeArray(group.anchor.reviewLabels).join('、')).slice(0, 1200);
        const status = mode === 'new' ? 'accepted_as_new' : 'merged';
        const evidenceId = buildEvidenceId(group.groupKey, targetDirection.id, mode);
        const evidence = {
            evidenceId,
            status,
            mode,
            targetDirectionId: targetDirection.id,
            targetDirectionPath: targetDirection.path || '',
            targetDirectionName: targetDirection.name || '',
            parentDirectionId,
            parentDirectionPath: parentDirection.path || '',
            assetGroupKey: group.groupKey,
            assetIds: group.assets.map(asset => asset.assetId).filter(Boolean),
            runId: group.anchor.runId || '',
            promptHash: group.anchor.promptHash || '',
            promptDirection: group.anchor.promptDirection || '',
            promptTitle: group.anchor.promptTitle || '',
            prompt: group.anchor.prompt || '',
            reviewStatus: group.anchor.reviewStatus || '',
            reviewLabels: safeArray(group.anchor.reviewLabels),
            reviewNote: group.anchor.reviewNote || '',
            whyGood,
            source: 'manual-asset-review',
            createdAt: timestamp
        };

        const evidenceItems = safeArray(evidenceData.evidence).filter(entry => entry.assetGroupKey !== group.groupKey);
        evidenceItems.push(evidence);
        writeDirectionEvidence(store, {
            ...evidenceData,
            evidence: evidenceItems
        }, timestamp);

        const targetIndex = directions.findIndex(direction => direction.id === targetDirection.id);
        if (targetIndex >= 0) {
            const currentStats = directions[targetIndex].evidenceStats || {};
            directions[targetIndex] = {
                ...directions[targetIndex],
                evidenceStats: {
                    ...currentStats,
                    successCaseCount: evidenceItems.filter(entry => entry.targetDirectionId === targetDirection.id).length,
                    lastEvidenceAt: timestamp
                },
                updatedAt: timestamp
            };
        }
        store.write('directions.json', {
            ...directionData,
            version: directionData.version || 1,
            updatedAt: timestamp,
            directions
        });

        const collection = {
            status,
            mode,
            evidenceId,
            targetDirectionId: targetDirection.id,
            targetDirectionPath: targetDirection.path || '',
            whyGood,
            collectedAt: timestamp
        };
        const groupAssetIds = new Set(group.assets.map(asset => asset.assetId));
        const updatedAssets = safeArray(assetsData.assets).map(asset => (
            groupAssetIds.has(asset.assetId)
                ? { ...asset, directionCollection: collection }
                : asset
        ));
        store.write('assets.json', {
            ...assetsData,
            version: assetsData.version || 1,
            updatedAt: timestamp,
            assets: updatedAssets
        });

        return {
            success: true,
            message: mode === 'new' ? '已新增为子方向并收录成功案例' : '已并入已有方向并收录成功案例',
            mode,
            status,
            direction: directions.find(direction => direction.id === targetDirection.id) || targetDirection,
            evidence: compactDirectionEvidence(evidence),
            assetIds: Array.from(groupAssetIds)
        };
    }

    function listTopMaterialInsights(query = {}) {
        const { store } = getStore(query);
        const data = store.read('top-material-insights.json', {
            importedAt: null,
            insights: []
        });
        const limit = Math.max(1, Math.min(500, Math.floor(Number(query.limit) || 100)));
        return {
            success: true,
            importedAt: data.importedAt,
            total: data.insights.length,
            insights: data.insights.slice(0, limit)
        };
    }

    function getRun(runId, query = {}) {
        const { store } = getStore(query);
        store.ensureBase();
        const id = path.basename(String(runId || ''));
        if (!id) return null;
        return store.read(path.join('runs', `${id}.json`), null);
    }

    function updateRun(store, runId, updates = {}) {
        const id = path.basename(String(runId || ''));
        if (!id) return null;
        const fileName = path.join('runs', `${id}.json`);
        const current = store.read(fileName, null);
        if (!current) return null;
        const next = {
            ...current,
            ...updates,
            updatedAt: nowIso()
        };
        store.write(fileName, next);
        return next;
    }

    function readRuns(store) {
        store.ensureBase();
        const runsDir = store.filePath('runs');
        if (!fs.existsSync(runsDir)) {
            return [];
        }

        return fs.readdirSync(runsDir)
            .filter(fileName => fileName.endsWith('.json'))
            .map(fileName => store.read(path.join('runs', fileName), null))
            .filter(Boolean)
            .map(compactRun)
            .sort((a, b) => toTimeMs(b.startedAt || b.createdAt) - toTimeMs(a.startedAt || a.createdAt));
    }

    function listRuns(query = {}) {
        const { store } = getStore(query);
        let runs = readRuns(store);
        const keyword = normalizeText(query.q || query.keyword).toLowerCase();
        const status = normalizeText(query.status).toLowerCase();

        if (keyword) {
            runs = runs.filter(run => [
                run.runId,
                run.status,
                run.phase,
                run.sourceDirection.path,
                run.message
            ].some(value => String(value || '').toLowerCase().includes(keyword)));
        }

        if (status) {
            runs = runs.filter(run => String(run.status || '').toLowerCase() === status);
        }

        const { offset, limit } = parsePaging(query, { limit: 20, maxLimit: 200 });
        return {
            success: true,
            total: runs.length,
            offset,
            limit,
            runs: runs.slice(offset, offset + limit)
        };
    }

    function readRawRuns(store) {
        store.ensureBase();
        const runsDir = store.filePath('runs');
        if (!fs.existsSync(runsDir)) {
            return [];
        }

        return fs.readdirSync(runsDir)
            .filter(fileName => fileName.endsWith('.json'))
            .map(fileName => store.read(path.join('runs', fileName), null))
            .filter(Boolean)
            .sort((a, b) => toTimeMs(b.startedAt || b.createdAt) - toTimeMs(a.startedAt || a.createdAt));
    }

    function preloadVisualDnaSources(store) {
        const historyData = store.read('direction-expansion-history.json', { items: [] });
        const draftData = store.read('direction-drafts.json', emptyDirectionDrafts());
        const evidenceData = store.read('direction-evidence.json', emptyDirectionEvidence());
        const feedbackData = store.read('feedback.json', emptyFeedback());
        const memoryData = store.read('creative-memory.json', emptyCreativeMemory());
        return {
            drafts: safeArray(draftData.drafts),
            evidence: safeArray(evidenceData.evidence).filter(entry => entry && entry.source !== 'material-analysis'),
            history: safeArray(historyData.items || historyData.history || historyData.expansions),
            runs: readRawRuns(store),
            feedback: safeArray(feedbackData.feedback),
            memory: memoryData
        };
    }

    function directionTagParentPath(value = '') {
        const parts = normalizeText(value).split('/').map(part => part.trim()).filter(Boolean);
        return parts.length > 1 ? parts.slice(0, -1).join('/') : normalizeText(value);
    }

    function readDirectionTagsFile(store) {
        writeIfMissing(store, DIRECTION_TAGS_FILE, emptyDirectionTags);
        return store.read(DIRECTION_TAGS_FILE, emptyDirectionTags());
    }

    function mergePersistedDirectionTagMeta(records = [], existingDirections = []) {
        const persistedById = new Map();
        safeArray(existingDirections)
            .filter(item => item && (
                item.manual === true ||
                item.source === 'manual' ||
                item.source === DIRECTION_TAG_REFERENCE_VISION_SOURCE ||
                item.source === 'vision'
            ))
            .forEach(item => {
                const id = item.directionId || item.id;
                if (id) persistedById.set(id, item);
            });

        return safeArray(records).map(record => {
            const persisted = persistedById.get(record.directionId);
            if (!persisted) return record;
            const normalized = normalizeDirectionTagsForRecord(persisted, { limit: 12, riskLimit: 6 });
            const isManual = persisted.manual === true || persisted.source === 'manual';
            const persistedRiskTags = normalizeDirectionTagList(persisted.riskTags, 6);
            return {
                ...record,
                source: isManual ? 'manual' : DIRECTION_TAG_REFERENCE_VISION_SOURCE,
                manual: isManual || undefined,
                mainTags: safeArray(persisted.mainTags).length
                    ? normalizeDirectionTagList(persisted.mainTags, 5)
                    : safeArray(record.tags).slice(0, 5),
                extraTags: safeArray(persisted.extraTags).length
                    ? normalizeDirectionTagList(persisted.extraTags, 8)
                    : safeArray(normalized.tags).filter(tag => !safeArray(record.tags).includes(tag)).slice(0, 8),
                riskTags: isManual && persistedRiskTags.length
                    ? persistedRiskTags
                    : record.riskTags,
                tags: isManual && normalized.tags.length
                    ? normalized.tags.slice(0, 5)
                    : record.tags,
                summary: persisted.summary || persisted.visualSummary || record.summary || '',
                referenceImageStatus: persisted.referenceImageStatus || record.referenceImageStatus || '',
                referenceImageStatusLabel: persisted.referenceImageStatusLabel || record.referenceImageStatusLabel || '',
                referenceImageCount: Number(persisted.referenceImageCount) || Number(record.referenceImageCount) || 0,
                referenceImageIds: safeArray(persisted.referenceImageIds),
                analysis: persisted.analysis || persisted.referenceAnalysis || record.analysis || null,
                confidence: Number(persisted.confidence) || Number(record.confidence) || 0,
                updatedAt: persisted.updatedAt || record.updatedAt || ''
            };
        });
    }

    function buildDirectionTagDataset(store, existingData = null) {
        const directionsData = store.read('directions.json', { directions: [] });
        const draftData = store.read('direction-drafts.json', emptyDirectionDrafts());
        const historyData = store.read('direction-expansion-history.json', { items: [] });
        const feedbackData = store.read('feedback.json', emptyFeedback());
        const assetsData = store.read('assets.json', emptyAssets());
        const evidenceData = store.read('direction-evidence.json', emptyDirectionEvidence());
        const existing = existingData || readDirectionTagsFile(store);
        const directions = buildDirectionTagRecords({
            directions: safeArray(directionsData.directions),
            drafts: safeArray(draftData.drafts),
            history: safeArray(historyData.items || historyData.history || historyData.expansions),
            feedback: safeArray(feedbackData.feedback),
            assets: safeArray(assetsData.assets),
            evidence: safeArray(evidenceData.evidence).filter(entry => entry && entry.source !== 'material-analysis'),
            runs: readRawRuns(store),
            existing: safeArray(existing.directions)
        });
        return {
            version: 1,
            updatedAt: nowIso(),
            source: 'aggregated',
            directions: mergePersistedDirectionTagMeta(directions, existing.directions)
        };
    }

    function readDirectionTagsOrBuild(store) {
        const current = readDirectionTagsFile(store);
        if (safeArray(current.directions).length > 0) {
            return current;
        }
        return buildDirectionTagDataset(store, current);
    }

    function directionTagRecordForDirection(direction = {}, tagsIndex = new Map()) {
        const record = [
            direction.id,
            direction.path,
            direction.name
        ].map(normalizeText).filter(Boolean)
            .map(key => tagsIndex.get(key) || tagsIndex.get(directionMatchKey(key)))
            .find(Boolean) || {};
        const fallback = normalizeDirectionTagsForRecord(direction);
        const tags = safeArray(record.tags).length ? safeArray(record.tags) : fallback.tags;
        const riskTags = safeArray(record.riskTags).length ? safeArray(record.riskTags) : fallback.riskTags;
        return {
            ...record,
            directionId: record.directionId || direction.id || '',
            path: record.path || direction.path || direction.name || '',
            name: record.name || direction.name || direction.path || '',
            parentPath: record.parentPath || directionTagParentPath(direction.path || direction.name || ''),
            tags,
            riskTags,
            topTags: safeArray(record.topTags).length ? safeArray(record.topTags) : tags.map(value => ({ value, count: 1, score: 1, sources: [] })),
            topRiskTags: safeArray(record.topRiskTags).length ? safeArray(record.topRiskTags) : riskTags.map(value => ({ value, count: 1, score: 1, sources: [] })),
            sourceCount: Number(record.sourceCount) || (tags.length || riskTags.length ? 1 : 0),
            confidence: Number(record.confidence) || (tags.length ? 0.42 : 0),
            updatedAt: record.updatedAt || ''
        };
    }

    function refreshDirectionTags(query = {}) {
        const { store } = getStore(query);
        ensureEmptyFiles(store);
        const current = readDirectionTagsFile(store);
        const data = buildDirectionTagDataset(store, current);
        store.write(DIRECTION_TAGS_FILE, data);
        return {
            success: true,
            message: '方向标签已刷新。',
            updatedAt: data.updatedAt,
            total: data.directions.length,
            directionTags: data
        };
    }

    function buildDirectionTagsOverview(query = {}) {
        const { store } = getStore(query);
        ensureEmptyFiles(store);
        const directionsData = store.read('directions.json', { directions: [] });
        const data = readDirectionTagsOrBuild(store);
        const tagsById = buildDirectionTagsIndex(data);
        const summaries = safeArray(directionsData.directions).map(direction => directionTagRecordForDirection(direction, tagsById));
        const tagCounts = new Map();
        const riskCounts = new Map();
        summaries.forEach(summary => {
            safeArray(summary.tags).forEach(tag => tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1));
            safeArray(summary.riskTags).forEach(tag => riskCounts.set(tag, (riskCounts.get(tag) || 0) + 1));
        });
        const sortCounts = map => Array.from(map.entries())
            .map(([value, count]) => ({ value, count }))
            .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
        const total = safeArray(directionsData.directions).length;
        const covered = summaries.filter(item => safeArray(item.tags).length > 0).length;
        return {
            success: true,
            updatedAt: data.updatedAt || '',
            counts: {
                totalDirections: total,
                coveredDirections: covered,
                missingTagDirections: Math.max(0, total - covered),
                riskTagDirections: summaries.filter(item => safeArray(item.riskTags).length > 0).length
            },
            coverageRatio: total ? Number((covered / total).toFixed(2)) : 0,
            topTags: sortCounts(tagCounts).slice(0, 20),
            topRiskTags: sortCounts(riskCounts).slice(0, 20),
            directions: summaries.slice(0, Math.max(1, Math.min(500, Number(query.limit) || 100)))
        };
    }

    function getDirectionTags(directionId, query = {}) {
        const { store } = getStore(query);
        ensureEmptyFiles(store);
        const directionsData = store.read('directions.json', { directions: [] });
        const id = normalizeText(directionId);
        const idKey = directionMatchKey(id);
        const direction = safeArray(directionsData.directions).find(item => {
            const keys = [item.id, item.path, item.name].map(normalizeText).filter(Boolean);
            return keys.includes(id) || keys.map(directionMatchKey).includes(idKey);
        });
        if (!direction) {
            return {
                success: false,
                message: '未找到方向。'
            };
        }
        const data = readDirectionTagsOrBuild(store);
        const record = directionTagRecordForDirection(direction, buildDirectionTagsIndex(data));
        const references = getDirectionReferenceTagInputs(store, direction);
        const referenceStatus = directionReferenceTagStatus(
            references.length,
            Boolean(record.analysis && record.analysis.source === DIRECTION_TAG_REFERENCE_VISION_SOURCE)
        );
        return {
            success: true,
            direction: {
                id: direction.id || '',
                path: direction.path || '',
                name: direction.name || ''
            },
            referenceStatus,
            directionTags: {
                ...record,
                referenceImageCount: references.length,
                referenceImageStatus: record.referenceImageStatus || referenceStatus.status,
                referenceImageStatusLabel: record.referenceImageStatusLabel || referenceStatus.label,
                referenceImageBucket: referenceStatus.bucket,
                needsMoreReferences: referenceStatus.needsMoreReferences
            }
        };
    }

    function findDirectionForTags(store, directionId) {
        const directionsData = store.read('directions.json', { directions: [] });
        const id = normalizeText(directionId);
        const idKey = directionMatchKey(id);
        return safeArray(directionsData.directions).find(item => {
            const keys = [item.id, item.path, item.name].map(normalizeText).filter(Boolean);
            return keys.includes(id) || keys.map(directionMatchKey).includes(idKey);
        }) || null;
    }

    function getDirectionReferenceTagInputs(store, direction = {}) {
        const referenceData = readReferenceImages(store);
        return activeReferenceImagesForDirection(referenceData.images, direction.id, 0)
            .filter(reference => fileExists(reference.filePath))
            .map(reference => ({
                ...reference,
                compact: compactReferenceImage(reference)
            }));
    }

    function writeDirectionTagRecord(store, direction = {}, patch = {}) {
        const current = readDirectionTagsOrBuild(store);
        const tagsIndex = buildDirectionTagsIndex(current);
        const base = directionTagRecordForDirection(direction, tagsIndex);
        const directions = safeArray(current.directions).slice();
        const id = direction.id || patch.directionId || base.directionId;
        const index = directions.findIndex(item => item && (
            item.directionId === id ||
            directionMatchKey(item.path || item.name || '') === directionMatchKey(direction.path || direction.name || '')
        ));
        const updated = {
            ...base,
            ...patch,
            directionId: id,
            path: direction.path || patch.path || base.path || '',
            name: direction.name || patch.name || base.name || '',
            parentPath: directionTagParentPath(direction.path || direction.name || ''),
            updatedAt: nowIso()
        };
        if (index >= 0) {
            directions[index] = updated;
        } else {
            directions.push(updated);
        }
        const data = {
            version: 1,
            updatedAt: nowIso(),
            source: current.source || 'aggregated',
            directions
        };
        store.write(DIRECTION_TAGS_FILE, data);
        return updated;
    }

    async function callDirectionTagVision(direction, references, dataUrls) {
        if (typeof options.callDirectionTagVision === 'function') {
            return options.callDirectionTagVision({ direction, references, dataUrls });
        }
        const config = readWinkyVisionConfig();
        const prompt = buildDirectionTagVisionPrompt(direction, references);
        const payload = {
            model: config.model,
            messages: [
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: prompt },
                        ...dataUrls.map(url => ({
                            type: 'image_url',
                            image_url: { url, detail: 'auto' }
                        }))
                    ]
                }
            ],
            stream: false,
            response_format: { type: 'json_object' }
        };
        if (shouldUseMaxCompletionTokens(config.model)) {
            payload.max_completion_tokens = DIRECTION_TAG_VISION_MAX_TOKENS;
        } else {
            payload.temperature = 0.1;
            payload.max_tokens = DIRECTION_TAG_VISION_MAX_TOKENS;
        }
        if (config.provider) payload.provider = config.provider;
        const response = await httpClient.post(config.apiUrl, payload, {
            headers: {
                Authorization: `Bearer ${config.apiKey}`,
                'Content-Type': 'application/json'
            },
            timeout: DIRECTION_TAG_VISION_TIMEOUT_MS,
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
            validateStatus: () => true
        });
        if (response.status < 200 || response.status >= 300) {
            const detail = typeof response.data === 'string'
                ? response.data
                : JSON.stringify(response.data || {}).slice(0, 600);
            throw new Error(`Lumos Winky 方向标签识别失败 HTTP ${response.status}: ${detail}`);
        }
        const rawText = extractWinkyText(response.data);
        if (!rawText) throw new Error('Lumos Winky 未返回方向标签内容');
        return {
            config,
            rawText,
            parsed: parseJsonObject(rawText)
        };
    }

    async function analyzeDirectionTagsFromReferences(directionId, payload = {}, query = {}) {
        const { store } = getStore(query);
        ensureEmptyFiles(store);
        const direction = findDirectionForTags(store, directionId);
        if (!direction) return { success: false, message: '未找到方向。' };

        const data = readDirectionTagsOrBuild(store);
        const currentRecord = directionTagRecordForDirection(direction, buildDirectionTagsIndex(data));
        if (currentRecord.manual === true && payload.overwriteManual !== true) {
            return {
                success: true,
                skipped: true,
                code: 'manual_override',
                message: '该方向已有手动覆盖标签，未用 AI 结果覆盖。',
                direction,
                directionTags: currentRecord
            };
        }

        const references = getDirectionReferenceTagInputs(store, direction);
        const referenceStatus = directionReferenceTagStatus(
            references.length,
            Boolean(currentRecord.analysis && currentRecord.analysis.source === DIRECTION_TAG_REFERENCE_VISION_SOURCE)
        );
        if (!references.length) {
            const record = writeDirectionTagRecord(store, direction, {
                ...currentRecord,
                referenceImageCount: 0,
                referenceImageIds: [],
                referenceImageStatus: referenceStatus.status,
                referenceImageStatusLabel: referenceStatus.label,
                needsMoreReferences: true
            });
            return {
                success: true,
                analyzed: false,
                message: '该方向还没有可读参考图，已标记为待补图。',
                direction,
                referenceStatus,
                directionTags: record
            };
        }

        const selectedReferences = references.slice(0, DIRECTION_TAG_REFERENCE_MAX_IMAGES);
        const selectedIds = selectedReferences.map(reference => reference.id).filter(Boolean);
        const sameImages = safeArray(currentRecord.referenceImageIds).join('|') === selectedIds.join('|');
        if (payload.force !== true && sameImages && currentRecord.analysis && safeArray(currentRecord.tags).length) {
            return {
                success: true,
                cached: true,
                message: '该方向参考图标签已分析，可使用重新分析刷新。',
                direction,
                referenceStatus,
                directionTags: currentRecord
            };
        }

        const dataUrls = selectedReferences.map(reference => imageFileToDataUrl(reference.filePath));
        const vision = await callDirectionTagVision(
            direction,
            selectedReferences.map(reference => reference.compact),
            dataUrls
        );
        const fallback = normalizeDirectionTagsForRecord(direction, { limit: 5, riskLimit: 6 });
        const normalized = normalizeDirectionTagVisionResult(vision.parsed || vision.result || {}, {
            summary: direction.description || '',
            confidence: selectedReferences.length >= 3 ? 0.72 : 0.58
        });
        if (!normalized.mainTags.length && fallback.tags.length) {
            normalized.mainTags = fallback.tags.slice(0, 5);
            normalized.tags = fallback.tags.slice(0, 5).concat(normalized.extraTags).slice(0, 12);
        }
        const analyzedStatus = directionReferenceTagStatus(references.length, true);
        const record = writeDirectionTagRecord(store, direction, {
            source: DIRECTION_TAG_REFERENCE_VISION_SOURCE,
            manual: false,
            mainTags: normalized.mainTags,
            extraTags: normalized.extraTags,
            tags: normalized.tags.slice(0, 5),
            riskTags: normalized.riskTags,
            summary: normalized.summary,
            confidence: normalized.confidence,
            referenceImageCount: references.length,
            referenceImageIds: selectedIds,
            referenceImageStatus: analyzedStatus.status,
            referenceImageStatusLabel: analyzedStatus.label,
            needsMoreReferences: analyzedStatus.needsMoreReferences,
            analysis: {
                source: DIRECTION_TAG_REFERENCE_VISION_SOURCE,
                analyzedAt: nowIso(),
                model: vision.config && vision.config.model || 'stub',
                imageCount: selectedReferences.length,
                referenceImageIds: selectedIds,
                summary: normalized.summary
            }
        });
        return {
            success: true,
            analyzed: true,
            message: references.length < DIRECTION_TAG_REFERENCE_MAX_IMAGES
                ? '方向标签已分析，但参考图偏少，建议后续补图。'
                : '方向标签已根据参考图更新。',
            direction,
            referenceStatus: analyzedStatus,
            directionTags: record
        };
    }

    async function batchAnalyzeDirectionTagsFromReferences(payload = {}, query = {}) {
        const { store } = getStore(query);
        ensureEmptyFiles(store);
        const directionsData = store.read('directions.json', { directions: [] });
        const limit = Math.max(1, Math.min(50, Math.floor(Number(payload.limit || query.limit) || 12)));
        const force = payload.force === true || query.force === 'true';
        const data = readDirectionTagsOrBuild(store);
        const tagsIndex = buildDirectionTagsIndex(data);
        const selected = [];
        safeArray(directionsData.directions).forEach(direction => {
            if (selected.length >= limit) return;
            const record = directionTagRecordForDirection(direction, tagsIndex);
            if (record.manual === true && payload.overwriteManual !== true) return;
            const references = getDirectionReferenceTagInputs(store, direction);
            const needsAnalysis = force ||
                !record.analysis ||
                !safeArray(record.tags).length ||
                !record.referenceImageStatus ||
                references.length === 0;
            if (needsAnalysis) selected.push(direction);
        });

        const results = [];
        for (const direction of selected) {
            try {
                results.push(await analyzeDirectionTagsFromReferences(direction.id, {
                    force,
                    overwriteManual: payload.overwriteManual === true
                }, query));
            } catch (error) {
                results.push({
                    success: false,
                    direction: {
                        id: direction.id || '',
                        path: direction.path || '',
                        name: direction.name || ''
                    },
                    message: error.message
                });
            }
        }
        return {
            success: results.every(item => item.success !== false),
            message: `批量补齐完成：处理 ${results.length} 个方向。`,
            total: results.length,
            analyzed: results.filter(item => item.analyzed).length,
            skipped: results.filter(item => item.skipped || item.cached).length,
            missingReferences: results.filter(item => item.referenceStatus && item.referenceStatus.status === 'missing').length,
            failed: results.filter(item => item.success === false).length,
            results
        };
    }

    function updateDirectionTagsManualOverride(directionId, payload = {}, query = {}) {
        const { store } = getStore(query);
        ensureEmptyFiles(store);
        const direction = findDirectionForTags(store, directionId);
        if (!direction) return { success: false, message: '未找到方向。' };
        const references = getDirectionReferenceTagInputs(store, direction);
        const normalized = normalizeDirectionTagVisionResult(payload, {
            summary: payload.summary || direction.description || '',
            confidence: 1
        });
        const status = directionReferenceTagStatus(references.length, Boolean(payload.analysis));
        const record = writeDirectionTagRecord(store, direction, {
            source: 'manual',
            manual: true,
            mainTags: normalized.mainTags,
            extraTags: normalized.extraTags,
            tags: normalized.tags.slice(0, 5),
            riskTags: normalized.riskTags,
            summary: normalized.summary,
            confidence: 1,
            referenceImageCount: references.length,
            referenceImageIds: references.slice(0, DIRECTION_TAG_REFERENCE_MAX_IMAGES).map(reference => reference.id).filter(Boolean),
            referenceImageStatus: status.status,
            referenceImageStatusLabel: status.label,
            needsMoreReferences: status.needsMoreReferences,
            analysis: {
                source: 'manual',
                updatedAt: nowIso()
            }
        });
        return {
            success: true,
            message: '方向标签已手动覆盖。',
            direction,
            referenceStatus: status,
            directionTags: record
        };
    }

    function collectDirectionVisualDnaEvidence(direction = {}, preloaded = {}) {
        const accumulator = createVisualDnaAccumulator();
        addVisualDnaFromRecord(accumulator, direction, {
            type: 'directions',
            id: direction.id || '',
            label: direction.path || direction.name || ''
        });

        safeArray(preloaded.drafts).forEach(draft => {
            if (!directionRecordMatches(direction, draft)) return;
            addVisualDnaFromRecord(accumulator, draft, {
                type: 'direction-drafts',
                id: draft.id || '',
                label: draft.path || draft.name || ''
            });
            safeArray(draft.prompts).forEach(prompt => addVisualDnaFromRecord(accumulator, prompt, {
                type: 'direction-drafts',
                id: draft.id || '',
                field: 'prompts',
                label: draft.name || ''
            }));
        });

        safeArray(preloaded.evidence).forEach(entry => {
            if (!directionEvidenceMatches(direction, entry) && !directionRecordMatches(direction, entry)) return;
            addVisualDnaFromRecord(accumulator, entry, {
                type: 'direction-evidence',
                id: entry.id || entry.evidenceId || '',
                label: entry.targetDirectionPath || entry.directionPath || ''
            });
        });

        safeArray(preloaded.history).forEach(item => {
            if (!directionRecordMatches(direction, item)) return;
            addVisualDnaFromRecord(accumulator, item, {
                type: 'direction-expansion-history',
                id: item.runId || item.dedupeKey || '',
                label: item.newDirectionName || item.extensionName || ''
            });
        });

        safeArray(preloaded.runs).forEach(run => {
            const runDirection = run.sourceDirection || {};
            const matchedRun = directionRecordMatches(direction, {
                sourceDirectionId: runDirection.id,
                sourceDirectionPath: runDirection.path,
                sourceDirectionName: runDirection.name
            });
            if (!matchedRun) return;
            const report = run.directionPlanReport || {};
            safeArray(report.selectedExtensions).forEach(extension => addVisualDnaFromRecord(accumulator, extension, {
                type: 'runs',
                id: run.runId || '',
                field: 'selectedExtensions',
                label: extension.name || ''
            }));
        });

        safeArray(preloaded.feedback).forEach(feedback => {
            if (!directionRecordMatches(direction, feedback)) return;
            addVisualDnaFromRecord(accumulator, feedback, {
                type: 'feedback',
                id: feedback.id || feedback.feedbackId || '',
                label: feedback.directionPath || feedback.targetDirectionPath || ''
            });
        });

        safeArray(getAllMemoryRules(preloaded.memory)).forEach(rule => {
            if (!directionRecordMatches(direction, rule) && !directionRecordMatches(direction, rule.scope || {})) return;
            addVisualDnaFromRecord(accumulator, rule, {
                type: 'creative-memory',
                id: rule.id || rule.ruleId || '',
                label: rule.title || ''
            });
            safeArray(rule.evidence).forEach(item => addVisualDnaFromText(accumulator, item, {
                type: 'creative-memory',
                id: rule.id || rule.ruleId || '',
                field: 'evidence',
                label: rule.title || ''
            }));
        });

        return finalizeVisualDna(accumulator);
    }

    function buildVisualDnaOverview(query = {}) {
        const { store } = getStore(query);
        store.ensureBase();
        const directionsData = store.read('directions.json', { directions: [] });
        const directions = safeArray(directionsData.directions);
        const preloaded = preloadVisualDnaSources(store);
        const topAtmospheres = new Map();
        const topCameras = new Map();
        const directionSummaries = directions.map(direction => {
            const result = collectDirectionVisualDnaEvidence(direction, preloaded);
            result.visualDna.atmosphere.forEach(value => topAtmospheres.set(value, (topAtmospheres.get(value) || 0) + 1));
            result.visualDna.camera.forEach(value => topCameras.set(value, (topCameras.get(value) || 0) + 1));
            return {
                directionId: direction.id || '',
                path: direction.path || direction.name || '',
                visualDna: result.visualDna,
                summaryText: result.summaryText,
                source: result.source,
                confidence: result.confidence,
                evidenceCount: result.evidenceCount,
                missing: result.missing
            };
        });
        const coveredDirections = directionSummaries.filter(item => (
            VISUAL_DNA_DIMENSIONS.some(key => safeArray(item.visualDna[key]).length > 0)
        ));
        const countMap = map => Array.from(map.entries())
            .map(([value, count]) => ({ value, count }))
            .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
            .slice(0, 8);

        return {
            success: true,
            updatedAt: nowIso(),
            counts: {
                totalDirections: directions.length,
                coveredDirections: coveredDirections.length,
                missingEventDirections: directionSummaries.filter(item => safeArray(item.visualDna.event).length === 0).length,
                missingVisualHookDirections: directionSummaries.filter(item => safeArray(item.visualDna.visualHook).length === 0).length
            },
            topAtmospheres: countMap(topAtmospheres),
            topCameras: countMap(topCameras),
            directions: directionSummaries
        };
    }

    function getDirectionVisualDna(directionId, query = {}) {
        const { store } = getStore(query);
        store.ensureBase();
        const data = store.read('directions.json', { directions: [] });
        const direction = safeArray(data.directions).find(item => String(item.id || '') === String(directionId || ''));
        if (!direction) {
            return { success: false, message: `方向不存在：${directionId}` };
        }
        const result = collectDirectionVisualDnaEvidence(direction, preloadVisualDnaSources(store));
        return {
            success: true,
            direction: {
                id: direction.id || '',
                path: direction.path || '',
                name: direction.name || '',
                description: direction.description || ''
            },
            ...result
        };
    }

    function visualDnaParentFromPath(value = '', fallback = '未分组') {
        const pathText = normalizeText(value);
        const parts = splitDirectionPath(pathText);
        const label = parts.length ? parts[parts.length - 1] : fallback;
        return {
            path: pathText || fallback,
            label: label || fallback
        };
    }

    function visualDnaParentPathFromDraft(draft = {}) {
        const sourcePath = normalizeText(draft.sourceDirectionPath);
        if (sourcePath) return sourcePath;
        const parts = splitDirectionPath(draft.path);
        if (parts.length > 1) return parts.slice(0, -1).join('/');
        return draft.path || draft.name || '未分组';
    }

    function addPreferenceCount(bucket, key, value, sourceId = '') {
        const text = normalizeText(value);
        if (!text) return;
        const item = bucket[key].get(text) || { value: text, count: 0, sourceIds: [] };
        item.count += 1;
        if (sourceId && item.sourceIds.length < 20) item.sourceIds.push(sourceId);
        bucket[key].set(text, item);
    }

    function sortedPreferenceValues(map, limit = 6) {
        return Array.from(map.values())
            .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
            .slice(0, limit)
            .map(item => ({
                value: item.value,
                count: item.count,
                sourceIds: item.sourceIds
            }));
    }

    function buildVisualDnaForSample(record = {}, source = {}) {
        const accumulator = createVisualDnaAccumulator();
        addVisualDnaFromRecord(accumulator, record, source);
        return finalizeVisualDna(accumulator);
    }

    function compactVisualDnaTags(dna = {}) {
        return [
            safeArray(dna.atmosphere)[0],
            safeArray(dna.camera)[0],
            safeArray(dna.event)[0],
            safeArray(dna.scale)[0],
            safeArray(dna.visualHook)[0]
        ].filter(Boolean);
    }

    function buildAdoptionSample(input = {}) {
        const parent = visualDnaParentFromPath(input.groupPath, '未分组');
        const result = buildVisualDnaForSample(input.record || {}, {
            type: input.source || 'unknown',
            id: input.id || '',
            label: input.name || ''
        });
        return {
            id: input.id || `${input.source || 'sample'}:${input.name || parent.path}`,
            source: input.source || 'unknown',
            sourceLabel: input.sourceLabel || input.source || 'unknown',
            status: input.status || '',
            groupPath: parent.path,
            groupLabel: parent.label,
            name: input.name || parent.label,
            directionPath: input.directionPath || parent.path,
            createdAt: input.createdAt || '',
            visualDna: result.visualDna,
            tags: compactVisualDnaTags(result.visualDna),
            evidence: input.evidence || '',
            confidence: result.confidence,
            feedbackId: input.feedbackId || '',
            assetId: input.assetId || ''
        };
    }

    function pushVisualDnaWorkbenchSample(groups, sample) {
        if (!sample || !sample.groupPath) return;
        const group = groups.get(sample.groupPath) || {
            path: sample.groupPath,
            label: sample.groupLabel,
            sampleCount: 0,
            sources: {
                feedback: 0,
                evidence: 0,
                history: 0,
                drafts: 0
            },
            samples: [],
            preferences: {
                atmosphere: new Map(),
                camera: new Map(),
                event: new Map(),
                scale: new Map(),
                visualHook: new Map()
            }
        };
        group.sampleCount += 1;
        if (sample.source === 'feedback') group.sources.feedback += 1;
        if (sample.source === 'direction-evidence') group.sources.evidence += 1;
        if (sample.source === 'direction-expansion-history') group.sources.history += 1;
        if (sample.source === 'direction-drafts') group.sources.drafts += 1;
        if (group.samples.length < 12) group.samples.push(sample);
        ['atmosphere', 'camera', 'event', 'scale', 'visualHook'].forEach(key => {
            safeArray(sample.visualDna[key]).slice(0, 4).forEach(value => addPreferenceCount(group.preferences, key, value, sample.id));
        });
        groups.set(sample.groupPath, group);
    }

    function compactVisualDnaWorkbenchGroup(group = {}) {
        return {
            path: group.path || '',
            label: group.label || group.path || '未分组',
            sampleCount: Number(group.sampleCount) || 0,
            sources: group.sources || {},
            samples: safeArray(group.samples),
            preferences: {
                atmosphere: sortedPreferenceValues(group.preferences.atmosphere),
                camera: sortedPreferenceValues(group.preferences.camera),
                event: sortedPreferenceValues(group.preferences.event),
                scale: sortedPreferenceValues(group.preferences.scale),
                visualHook: sortedPreferenceValues(group.preferences.visualHook, 4)
            }
        };
    }

    function buildDnaPreferenceRuleDraft(group = {}) {
        const camera = safeArray(group.preferences && group.preferences.camera).slice(0, 2);
        const atmosphere = safeArray(group.preferences && group.preferences.atmosphere).slice(0, 2);
        const event = safeArray(group.preferences && group.preferences.event).slice(0, 2);
        const strongest = camera.length ? camera : (atmosphere.length ? atmosphere : event);
        if (!strongest.length || Number(group.sampleCount) < 3) return null;
        const strongestText = strongest.map(item => item.value).join('或');
        const evidenceParts = [];
        if (camera.length) evidenceParts.push(`视角 ${camera.map(item => `${item.value} ${item.count} 次`).join('、')}`);
        if (atmosphere.length) evidenceParts.push(`氛围 ${atmosphere.map(item => `${item.value} ${item.count} 次`).join('、')}`);
        if (event.length) evidenceParts.push(`事件 ${event.map(item => `${item.value} ${item.count} 次`).join('、')}`);
        return normalizeMemoryRule({
            scope: 'node',
            type: 'preferred',
            target: group.path,
            title: `${group.label}方向优先使用${strongestText}`,
            pattern: `${group.label}方向下，优先沿用 ${evidenceParts.join('；')} 的视觉 DNA 组合。`,
            rationale: `来自视觉 DNA 工作台的采纳模式统计，共 ${group.sampleCount} 条样本。`,
            action: `生成 ${group.label} 相关方向时，优先选择 ${strongestText}，并结合历史高频事件与视觉钩子形成可生产画面。`,
            evidence: [
                `采纳样本 ${group.sampleCount} 条`,
                ...evidenceParts
            ],
            sourceFeedbackIds: safeArray(group.samples).map(sample => sample.feedbackId).filter(Boolean),
            confidence: Math.min(0.9, 0.55 + Math.min(Number(group.sampleCount) || 0, 10) * 0.03),
            source: 'visual-dna-workbench',
            status: 'draft'
        }, {
            status: 'draft'
        });
    }

    function buildVisualDnaWorkbench(query = {}) {
        const { store } = getStore(query);
        store.ensureBase();
        const assetsData = store.read('assets.json', emptyAssets());
        const feedbackData = store.read('feedback.json', emptyFeedback());
        const draftData = store.read('direction-drafts.json', emptyDirectionDrafts());
        const evidenceData = store.read('direction-evidence.json', emptyDirectionEvidence());
        const historyData = store.read('direction-expansion-history.json', { items: [] });
        const assetsById = new Map(safeArray(assetsData.assets).map(asset => [asset.assetId, asset]));
        const groups = new Map();

        safeArray(feedbackData.feedback)
            .filter(feedback => ['good', 'normal'].includes(normalizeReviewStatus(feedback.status || feedback.reviewStatus, 'unreviewed')))
            .forEach(feedback => {
                const asset = assetsById.get(feedback.assetId) || {};
                pushVisualDnaWorkbenchSample(groups, buildAdoptionSample({
                    id: feedback.feedbackId || feedback.assetId,
                    source: 'feedback',
                    sourceLabel: feedback.status === 'good' ? '好图反馈' : '一般反馈',
                    status: feedback.status,
                    groupPath: feedback.directionPath || asset.directionPath || feedback.directionName || asset.directionName,
                    directionPath: feedback.directionPath || asset.directionPath || '',
                    name: feedback.promptDirection || asset.promptDirection || feedback.promptTitle || asset.promptTitle || feedback.directionName || asset.directionName,
                    createdAt: feedback.updatedAt || feedback.createdAt || asset.savedAt || '',
                    record: {
                        ...asset,
                        ...feedback,
                        description: [feedback.note, asset.promptDirection, asset.prompt].filter(Boolean).join('。'),
                        prompt: asset.prompt
                    },
                    evidence: feedback.note || asset.promptTitle || '',
                    feedbackId: feedback.feedbackId || '',
                    assetId: feedback.assetId || asset.assetId || ''
                }));
            });

        safeArray(evidenceData.evidence)
            .filter(entry => entry && entry.source !== 'material-analysis')
            .forEach(entry => {
                pushVisualDnaWorkbenchSample(groups, buildAdoptionSample({
                    id: entry.id || entry.evidenceId || entry.assetGroupKey,
                    source: 'direction-evidence',
                    sourceLabel: '成功案例',
                    status: entry.status || 'success',
                    groupPath: entry.targetDirectionPath || entry.directionPath || entry.directionKey,
                    directionPath: entry.targetDirectionPath || entry.directionPath || '',
                    name: entry.targetDirectionName || entry.directionName || entry.directionKey || entry.assetGroupKey,
                    createdAt: entry.updatedAt || entry.createdAt || entry.collectedAt || '',
                    record: entry,
                    evidence: entry.whyGood || entry.reason || ''
                }));
            });

        safeArray(historyData.items || historyData.history || historyData.expansions)
            .forEach(item => {
                pushVisualDnaWorkbenchSample(groups, buildAdoptionSample({
                    id: `${item.runId || 'history'}:${item.dedupeKey || item.extensionKey || item.newDirectionName}`,
                    source: 'direction-expansion-history',
                    sourceLabel: '入选候选',
                    status: 'selected',
                    groupPath: item.sourceDirectionPath || item.directionPath || item.targetDirectionPath,
                    directionPath: item.sourceDirectionPath || '',
                    name: item.newDirectionName || item.extensionName || item.name,
                    createdAt: item.createdAt || '',
                    record: item,
                    evidence: item.dedupeReason || item.productionAdvice || ''
                }));
            });

        safeArray(draftData.drafts)
            .filter(draft => normalizeDirectionStatus(draft.status, 'draft') === 'accepted')
            .forEach(draft => {
                pushVisualDnaWorkbenchSample(groups, buildAdoptionSample({
                    id: draft.id,
                    source: 'direction-drafts',
                    sourceLabel: '已采纳方向',
                    status: 'accepted',
                    groupPath: visualDnaParentPathFromDraft(draft),
                    directionPath: draft.path || draft.sourceDirectionPath || '',
                    name: draft.name || draft.path,
                    createdAt: draft.updatedAt || draft.createdAt || '',
                    record: draft,
                    evidence: draft.sourceStrategy || draft.description || ''
                }));
            });

        const compactGroups = Array.from(groups.values())
            .map(compactVisualDnaWorkbenchGroup)
            .sort((a, b) => b.sampleCount - a.sampleCount || a.label.localeCompare(b.label));
        const suggestedRules = compactGroups
            .map(buildDnaPreferenceRuleDraft)
            .filter(Boolean)
            .slice(0, 12);
        return {
            success: true,
            updatedAt: nowIso(),
            counts: {
                parentDirections: compactGroups.length,
                adoptionSamples: compactGroups.reduce((sum, group) => sum + group.sampleCount, 0),
                feedbackSamples: compactGroups.reduce((sum, group) => sum + (Number(group.sources.feedback) || 0), 0),
                evidenceSamples: compactGroups.reduce((sum, group) => sum + (Number(group.sources.evidence) || 0), 0),
                historySamples: compactGroups.reduce((sum, group) => sum + (Number(group.sources.history) || 0), 0),
                acceptedDraftSamples: compactGroups.reduce((sum, group) => sum + (Number(group.sources.drafts) || 0), 0),
                suggestedRules: suggestedRules.length
            },
            adoptionPatterns: compactGroups,
            stylePreferences: compactGroups.map(group => ({
                path: group.path,
                label: group.label,
                sampleCount: group.sampleCount,
                preferences: group.preferences
            })),
            suggestedRules
        };
    }

    function generateVisualDnaRuleDrafts(payload = {}, query = {}) {
        const { store } = getStore(query);
        ensureEmptyFiles(store);
        const limit = Math.max(1, Math.min(20, Math.floor(Number(payload.limit || query.limit) || 12)));
        const workbench = buildVisualDnaWorkbench(query);
        const drafts = safeArray(workbench.suggestedRules).slice(0, limit);
        if (!drafts.length) {
            return {
                success: false,
                message: '当前视觉 DNA 采纳样本不足，暂未生成规则草案。',
                drafts: []
            };
        }
        const memory = readCreativeMemory(store);
        upsertDrafts(memory, drafts);
        const saved = writeCreativeMemory(store, memory);
        return {
            success: true,
            message: `已生成 ${drafts.length} 条视觉 DNA 规则草案，等待人工启用。`,
            drafts,
            memory: compactCreativeMemory(saved)
        };
    }

    function listAssets(query = {}) {
        const { store } = getStore(query);
        store.ensureBase();
        const data = store.read('assets.json', {
            version: 1,
            assets: []
        });
        const feedbackData = store.read('feedback.json', { feedback: [] });
        const latestFeedbackByAsset = buildLatestFeedbackByAsset(feedbackData.feedback);
        let assets = safeArray(data.assets)
            .map(asset => mergeFeedbackReview(asset, latestFeedbackByAsset))
            .map(compactAsset);
        const keyword = normalizeText(query.q || query.keyword).toLowerCase();
        const runId = normalizeText(query.runId);
        const directionId = normalizeText(query.directionId);
        const reviewStatus = normalizeText(query.reviewStatus || query.status).toLowerCase();
        const existsOnly = ['1', 'true', 'yes'].includes(String(query.existsOnly || '').toLowerCase());

        if (keyword) {
            assets = assets.filter(asset => [
                asset.assetId,
                asset.runId,
                asset.directionPath,
                asset.directionName,
                asset.promptDirection,
                asset.promptTitle,
                asset.prompt,
                asset.reviewStatus,
                asset.reviewNote,
                safeArray(asset.reviewLabels).join(' '),
                asset.legilTaskId,
                asset.legilBatchRunId,
                asset.fileName,
                asset.filePath
            ].some(value => String(value || '').toLowerCase().includes(keyword)));
        }

        if (runId) {
            assets = assets.filter(asset => asset.runId === runId);
        }

        if (directionId) {
            assets = assets.filter(asset => asset.directionId === directionId);
        }

        if (reviewStatus && REVIEW_STATUSES.has(reviewStatus)) {
            assets = assets.filter(asset => asset.reviewStatus === reviewStatus);
        }

        if (existsOnly) {
            assets = assets.filter(asset => asset.fileExists);
        }

        assets.sort((a, b) => toTimeMs(b.savedAt || b.recordedAt) - toTimeMs(a.savedAt || a.recordedAt));
        const { offset, limit } = parsePaging(query, { limit: 48, maxLimit: 200 });

        return {
            success: true,
            updatedAt: data.updatedAt || '',
            total: assets.length,
            offset,
            limit,
            reviewCounts: buildReviewCounts(assets),
            assets: assets.slice(offset, offset + limit)
        };
    }

    function listFeedback(query = {}) {
        const { store } = getStore(query);
        store.ensureBase();
        const data = store.read('feedback.json', emptyFeedback());
        let feedback = safeArray(data.feedback).map(compactFeedback);
        const keyword = normalizeText(query.q || query.keyword).toLowerCase();
        const assetId = normalizeText(query.assetId);
        const runId = normalizeText(query.runId);
        const status = normalizeText(query.status || query.reviewStatus).toLowerCase();
        const label = normalizeText(query.label || query.tag);

        if (keyword) {
            feedback = feedback.filter(entry => [
                entry.feedbackId,
                entry.feedbackTargetType,
                entry.assetId,
                entry.directionDraftId,
                entry.runId,
                entry.directionPath,
                entry.directionName,
                entry.sourceDirectionId,
                entry.sourceDirectionPath,
                entry.sourceDirectionName,
                entry.newDirectionName,
                entry.prompt,
                entry.promptDirection,
                entry.promptTitle,
                entry.original,
                entry.modified,
                entry.deleteReason,
                entry.legilError,
                entry.status,
                safeArray(entry.labels).join(' '),
                entry.note
            ].some(value => String(value || '').toLowerCase().includes(keyword)));
        }

        if (assetId) {
            feedback = feedback.filter(entry => entry.assetId === assetId);
        }

        if (runId) {
            feedback = feedback.filter(entry => entry.runId === runId);
        }

        if (status && REVIEW_STATUSES.has(status)) {
            feedback = feedback.filter(entry => entry.status === status);
        }

        if (label) {
            feedback = feedback.filter(entry => safeArray(entry.labels).includes(label));
        }

        feedback.sort((a, b) => toTimeMs(b.updatedAt || b.createdAt) - toTimeMs(a.updatedAt || a.createdAt));
        const { offset, limit } = parsePaging(query, { limit: 50, maxLimit: 500 });

        return {
            success: true,
            updatedAt: data.updatedAt || '',
            total: feedback.length,
            offset,
            limit,
            feedback: feedback.slice(offset, offset + limit)
        };
    }

    function createFeedbackEntry(asset, payload = {}) {
        const status = normalizeReviewStatus(payload.status || payload.reviewStatus, '');
        if (!status || status === 'unreviewed') {
            throw new Error('审核状态必须是 good / normal / bad / rejected');
        }
        const labels = normalizeFeedbackLabels(payload.labels || payload.tags);
        const note = normalizeText(payload.note || payload.remark).slice(0, 1000);
        const timestamp = nowIso();
        return {
            feedbackId: buildFeedbackId(),
            feedbackTargetType: normalizeText(payload.feedbackTargetType || payload.targetType)
                || (payload.directionDraftId ? 'direction-candidate' : ((asset && asset.assetId) || payload.assetId ? 'asset' : 'prompt')),
            assetId: asset.assetId || payload.assetId || '',
            directionDraftId: payload.directionDraftId || asset.directionDraftId || '',
            runId: asset.runId || payload.runId || '',
            directionId: asset.directionId || payload.directionId || '',
            directionPath: asset.directionPath || payload.directionPath || '',
            directionName: asset.directionName || payload.directionName || '',
            sourceDirectionId: asset.sourceDirectionId || payload.sourceDirectionId || asset.directionId || payload.directionId || '',
            sourceDirectionPath: asset.sourceDirectionPath || payload.sourceDirectionPath || asset.directionPath || payload.directionPath || '',
            sourceDirectionName: asset.sourceDirectionName || payload.sourceDirectionName || '',
            newDirectionName: asset.newDirectionName || payload.newDirectionName || asset.promptDirection || payload.promptDirection || payload.directionName || '',
            promptHash: asset.promptHash || payload.promptHash || '',
            prompt: normalizeText(payload.prompt || asset.prompt).slice(0, 1200),
            promptDirection: asset.promptDirection || payload.promptDirection || '',
            promptTitle: asset.promptTitle || payload.promptTitle || '',
            promptIndex: asset.promptIndex || payload.promptIndex || '',
            outputIndex: asset.outputIndex || payload.outputIndex || '',
            targetLevel: normalizeText(payload.targetLevel || asset.targetLevel).slice(0, 80),
            dimensions: payload.dimensions && typeof payload.dimensions === 'object' ? payload.dimensions : (asset.dimensions && typeof asset.dimensions === 'object' ? asset.dimensions : {}),
            duplicateRisk: normalizeText(payload.duplicateRisk || asset.duplicateRisk).slice(0, 300),
            reason: normalizeText(payload.candidateReason || payload.reason || asset.reason).slice(0, 1200),
            original: normalizeText(payload.original).slice(0, 1200),
            modified: normalizeText(payload.modified).slice(0, 1200),
            deleteReason: normalizeText(payload.deleteReason).slice(0, 1200),
            previewGenerated: payload.previewGenerated === true,
            legilSkipped: payload.legilSkipped === true,
            legilError: normalizeText(payload.legilError).slice(0, 1200),
            selectedAsReference: payload.selectedAsReference === true,
            rating: payload.rating === null || payload.rating === undefined || payload.rating === '' ? null : Number(payload.rating),
            status,
            labels,
            note,
            source: normalizeText(payload.source) || 'manual-review',
            createdAt: timestamp,
            updatedAt: timestamp
        };
    }

    function appendFeedbackEntries(store, entries = [], updatedAt = nowIso()) {
        const normalized = safeArray(entries).filter(Boolean);
        if (!normalized.length) {
            return [];
        }
        const data = store.read('feedback.json', emptyFeedback());
        store.write('feedback.json', {
            ...data,
            version: data.version || 1,
            updatedAt,
            feedback: safeArray(data.feedback).concat(normalized)
        });
        return normalized;
    }

    function createDirectionDraftFeedback(draft = {}, payload = {}, status, source) {
        const decisionNote = normalizeText(
            payload.note
            || payload.reason
            || payload.acceptanceReason
            || payload.rejectionReason
            || payload.archiveReason
            || payload.mergeReason
            || payload.whyGood
        ).slice(0, 1000);
        const labels = payload.labels || payload.tags || (
            status === 'good' ? ['可以拓展'] : (status === 'rejected' ? ['跑题'] : [])
        );
        return createFeedbackEntry({}, {
            ...payload,
            feedbackTargetType: 'direction-candidate',
            directionDraftId: draft.id || '',
            runId: draft.sourceRunId || '',
            directionId: draft.acceptedDirectionId || payload.targetDirectionId || '',
            directionPath: draft.path || '',
            directionName: draft.name || '',
            sourceDirectionId: draft.sourceDirectionId || '',
            sourceDirectionPath: draft.sourceDirectionPath || '',
            sourceDirectionName: draft.sourceDirectionName || '',
            newDirectionName: draft.name || '',
            promptHash: safeArray(draft.prompts)[0] && safeArray(draft.prompts)[0].promptHash || '',
            prompt: safeArray(draft.prompts)[0] && safeArray(draft.prompts)[0].prompt || '',
            promptDirection: draft.name || '',
            promptTitle: safeArray(draft.prompts)[0] && safeArray(draft.prompts)[0].title || '',
            targetLevel: draft.targetLevel || '',
            dimensions: draft.dimensions && typeof draft.dimensions === 'object' ? draft.dimensions : {},
            duplicateRisk: draft.duplicateRisk || '',
            candidateReason: draft.reason || '',
            original: payload.original || draft.description || draft.name || '',
            modified: payload.modified || payload.description || '',
            deleteReason: payload.deleteReason || payload.rejectionReason || payload.archiveReason || '',
            status,
            labels,
            note: decisionNote,
            source
        });
    }

    function reviewAsset(assetId, payload = {}, query = {}) {
        const { store } = getStore(query);
        store.ensureBase();
        const data = store.read('assets.json', emptyAssets());
        const assets = safeArray(data.assets);
        const index = assets.findIndex(asset => asset && asset.assetId === assetId);
        if (index < 0) {
            return {
                success: false,
                message: `资产不存在: ${assetId}`
            };
        }

        const feedback = createFeedbackEntry(assets[index], payload);
        const review = {
            status: feedback.status,
            labels: feedback.labels,
            note: feedback.note,
            reviewedAt: feedback.updatedAt,
            feedbackId: feedback.feedbackId
        };
        const updatedAsset = {
            ...assets[index],
            review
        };
        assets[index] = updatedAsset;

        const updatedAt = nowIso();
        store.write('assets.json', {
            ...data,
            version: data.version || 1,
            updatedAt,
            assets
        });

        appendFeedbackEntries(store, [feedback], updatedAt);

        const compactedAssets = assets.map(compactAsset);
        return {
            success: true,
            asset: compactAsset(updatedAsset),
            feedback: compactFeedback(feedback),
            reviewCounts: buildReviewCounts(compactedAssets),
            message: '资产审核已保存'
        };
    }

    function createFeedback(payload = {}, query = {}) {
        const assetId = normalizeText(payload.assetId);
        if (assetId) {
            return reviewAsset(assetId, payload, query);
        }

        const { store } = getStore(query);
        store.ensureBase();
        const feedback = createFeedbackEntry({}, payload);
        const updatedAt = nowIso();
        appendFeedbackEntries(store, [feedback], updatedAt);
        return {
            success: true,
            feedback: compactFeedback(feedback),
            message: '反馈已保存'
        };
    }

    function readCreativeMemory(store) {
        return normalizeMemory(store.read('creative-memory.json', emptyCreativeMemory()));
    }

    function writeCreativeMemory(store, memory) {
        const normalized = refreshMemoryStats(normalizeMemory(memory));
        store.write('creative-memory.json', normalized);
        return normalized;
    }

    function getMemoryRuleBucket(memory, rule) {
        if (rule.scope === 'dimension') {
            const key = rule.target || 'general';
            memory.rules.dimension[key] = safeArray(memory.rules.dimension[key]);
            return memory.rules.dimension[key];
        }
        if (rule.scope === 'node') {
            const key = rule.target || 'general';
            memory.rules.node[key] = safeArray(memory.rules.node[key]);
            return memory.rules.node[key];
        }
        return memory.rules.global;
    }

    function compactMemoryRule(rule = {}) {
        return normalizeMemoryRule(rule, { status: rule.status || 'draft' });
    }

    function compactCreativeMemory(memory = {}) {
        const normalized = refreshMemoryStats(normalizeMemory(memory));
        const allRules = getAllMemoryRules(normalized, true).map(compactMemoryRule);
        const activeRules = getActiveMemoryRules(normalized).map(compactMemoryRule);
        return {
            ...normalized,
            drafts: safeArray(normalized.drafts).map(compactMemoryRule),
            activeRules,
            allRules,
            draftRules: safeArray(normalized.drafts)
                .map(compactMemoryRule)
                .filter(rule => rule.status === 'draft'),
            rejectedRules: safeArray(normalized.drafts)
                .map(compactMemoryRule)
                .filter(rule => rule.status === 'rejected'),
            disabledRules: allRules.filter(rule => rule.status === 'disabled'),
            recentReports: safeArray(normalized.learningReports).slice(0, 10)
        };
    }

    function findMemoryRule(memory, ruleId) {
        const id = normalizeText(ruleId);
        if (!id) return null;

        const draftIndex = safeArray(memory.drafts).findIndex(rule => rule && rule.ruleId === id);
        if (draftIndex >= 0) {
            return { location: 'drafts', bucket: memory.drafts, index: draftIndex, rule: memory.drafts[draftIndex] };
        }

        const globalIndex = safeArray(memory.rules.global).findIndex(rule => rule && rule.ruleId === id);
        if (globalIndex >= 0) {
            return { location: 'global', bucket: memory.rules.global, index: globalIndex, rule: memory.rules.global[globalIndex] };
        }

        for (const [target, bucket] of Object.entries(memory.rules.dimension || {})) {
            const index = safeArray(bucket).findIndex(rule => rule && rule.ruleId === id);
            if (index >= 0) {
                return { location: 'dimension', target, bucket, index, rule: bucket[index] };
            }
        }

        for (const [target, bucket] of Object.entries(memory.rules.node || {})) {
            const index = safeArray(bucket).findIndex(rule => rule && rule.ruleId === id);
            if (index >= 0) {
                return { location: 'node', target, bucket, index, rule: bucket[index] };
            }
        }

        return null;
    }

    function getCreativeMemory(query = {}) {
        const { store } = getStore(query);
        ensureEmptyFiles(store);
        const memory = writeCreativeMemory(store, readCreativeMemory(store));
        return {
            success: true,
            memory: compactCreativeMemory(memory)
        };
    }

    async function learnFromFeedback(payload = {}, query = {}) {
        const { store } = getStore(query);
        ensureEmptyFiles(store);

        const assetsData = store.read('assets.json', emptyAssets());
        const feedbackData = store.read('feedback.json', emptyFeedback());
        const memory = readCreativeMemory(store);
        const limit = Number(payload.limit || query.limit) || 80;
        const samples = buildFeedbackSamples({
            assets: assetsData.assets,
            feedback: feedbackData.feedback,
            limit
        });

        if (!samples.length) {
            const report = normalizeLearningReport({
                title: '反馈学习报告',
                summary: '还没有可学习的人工审核反馈。请先把一批生成图标成好图、一般、坏图或废图，再运行反馈学习。',
                positiveFindings: [],
                negativeFindings: [],
                nextRunAdvice: ['先积累至少 3 条带原因的审核反馈，再让 Feedback Learning Agent 总结规则。'],
                sampleSummary: { total: 0, good: 0, normal: 0, bad: 0, rejected: 0 }
            }, {
                draftRuleCount: 0,
                sourceFeedbackIds: []
            });
            return {
                success: false,
                message: '没有可学习的审核反馈',
                report,
                drafts: [],
                memory: compactCreativeMemory(memory)
            };
        }

        const learningRunId = `learning_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
        const messages = buildLearningMessages({ samples, memory });
        const storedConfig = typeof options.getStoredWinkyConfig === 'function'
            ? options.getStoredWinkyConfig()
            : {};
        const agentResult = await callFeedbackLearningAgent({
            messages,
            agentConfig: {
                ...storedConfig,
                ...(payload.agentConfig && typeof payload.agentConfig === 'object' ? payload.agentConfig : {})
            },
            learningClient: options.feedbackLearningClient || options.learningClient
        });

        const sampleFeedbackIds = uniqueStrings(samples.map(sample => sample.feedbackId)).slice(0, 100);
        const drafts = safeArray(agentResult && agentResult.ruleDrafts)
            .slice(0, 10)
            .map(raw => normalizeMemoryRule(raw, {
                status: 'draft',
                sourceFeedbackIds: sampleFeedbackIds
            }))
            .filter(rule => rule.title && rule.pattern);

        upsertDrafts(memory, drafts);
        const report = normalizeLearningReport(agentResult && agentResult.learningReport, {
            learningRunId,
            draftRuleCount: drafts.length,
            sourceFeedbackIds: sampleFeedbackIds,
            sampleSummary: agentResult && agentResult.learningReport && agentResult.learningReport.sampleSummary
        });
        memory.learningReports = [report].concat(safeArray(memory.learningReports)).slice(0, 30);
        memory.stats = {
            ...(memory.stats || {}),
            totalLearningRuns: (Number(memory.stats && memory.stats.totalLearningRuns) || 0) + 1,
            lastLearnedAt: report.createdAt
        };

        const saved = writeCreativeMemory(store, memory);
        return {
            success: true,
            message: `Feedback Learning Agent 已生成 ${drafts.length} 条规则草案，等待人工确认`,
            report,
            drafts,
            memory: compactCreativeMemory(saved),
            agent: {
                name: 'Feedback Learning Agent',
                version: report.version
            }
        };
    }

    function updateMemoryRule(ruleId, payload = {}, query = {}) {
        const { store } = getStore(query);
        ensureEmptyFiles(store);
        const memory = readCreativeMemory(store);
        const found = findMemoryRule(memory, ruleId);
        if (!found) {
            return { success: false, message: `规则不存在: ${ruleId}` };
        }

        const nextRule = normalizeMemoryRule({
            ...found.rule,
            ...payload,
            ruleId: found.rule.ruleId,
            status: payload.status || found.rule.status || (found.location === 'drafts' ? 'draft' : 'active'),
            updatedAt: nowIso()
        }, {
            status: found.location === 'drafts' ? 'draft' : 'active'
        });

        if (found.location === 'drafts') {
            found.bucket[found.index] = nextRule;
        } else if (nextRule.scope !== found.rule.scope || nextRule.target !== found.rule.target) {
            removeRuleFromBuckets(memory, nextRule.ruleId);
            getMemoryRuleBucket(memory, nextRule).push({
                ...nextRule,
                status: nextRule.status === 'draft' ? 'active' : nextRule.status,
                enabled: nextRule.status !== 'disabled'
            });
        } else {
            found.bucket[found.index] = nextRule;
        }

        const saved = writeCreativeMemory(store, memory);
        return {
            success: true,
            message: '规则已保存',
            rule: nextRule,
            memory: compactCreativeMemory(saved)
        };
    }

    function acceptMemoryRule(ruleId, payload = {}, query = {}) {
        const { store } = getStore(query);
        ensureEmptyFiles(store);
        const memory = readCreativeMemory(store);
        const found = findMemoryRule(memory, ruleId);
        if (!found) {
            return { success: false, message: `规则不存在: ${ruleId}` };
        }

        const accepted = normalizeMemoryRule({
            ...found.rule,
            ...payload,
            ruleId: found.rule.ruleId,
            status: 'active',
            enabled: true,
            acceptedAt: nowIso(),
            updatedAt: nowIso()
        }, {
            status: 'active'
        });
        memory.drafts = safeArray(memory.drafts).filter(rule => rule && rule.ruleId !== accepted.ruleId);
        removeRuleFromBuckets(memory, accepted.ruleId);
        getMemoryRuleBucket(memory, accepted).push(accepted);

        const saved = writeCreativeMemory(store, memory);
        return {
            success: true,
            message: '规则已启用，会进入下一轮 Agent 上下文',
            rule: accepted,
            memory: compactCreativeMemory(saved)
        };
    }

    function rejectMemoryRule(ruleId, payload = {}, query = {}) {
        const { store } = getStore(query);
        ensureEmptyFiles(store);
        const memory = readCreativeMemory(store);
        const found = findMemoryRule(memory, ruleId);
        if (!found) {
            return { success: false, message: `规则不存在: ${ruleId}` };
        }

        const rejected = normalizeMemoryRule({
            ...found.rule,
            rejectReason: normalizeText(payload.reason || payload.rejectReason),
            status: 'rejected',
            enabled: false,
            updatedAt: nowIso()
        }, {
            status: 'rejected'
        });
        memory.drafts = safeArray(memory.drafts).filter(rule => rule && rule.ruleId !== rejected.ruleId);
        memory.drafts.push(rejected);
        removeRuleFromBuckets(memory, rejected.ruleId);

        const saved = writeCreativeMemory(store, memory);
        return {
            success: true,
            message: '规则草案已拒绝，不会注入下一轮',
            rule: rejected,
            memory: compactCreativeMemory(saved)
        };
    }

    function disableMemoryRule(ruleId, payload = {}, query = {}) {
        const { store } = getStore(query);
        ensureEmptyFiles(store);
        const memory = readCreativeMemory(store);
        const found = findMemoryRule(memory, ruleId);
        if (!found) {
            return { success: false, message: `规则不存在: ${ruleId}` };
        }

        const disabled = normalizeMemoryRule({
            ...found.rule,
            disableReason: normalizeText(payload.reason || payload.disableReason),
            status: 'disabled',
            enabled: false,
            updatedAt: nowIso()
        }, {
            status: 'disabled'
        });
        found.bucket[found.index] = disabled;

        const saved = writeCreativeMemory(store, memory);
        return {
            success: true,
            message: '规则已禁用，不会注入下一轮',
            rule: disabled,
            memory: compactCreativeMemory(saved)
        };
    }

    function getAssetFile(assetId, query = {}) {
        const { store } = getStore(query);
        const target = getFileLookup(store, 'assets.json', 'assets', 'assetId', assetFileLookupCache).get(assetId);

        if (!target || target.status === 'deleted' || target.deleted || !fileExists(target.filePath)) {
            return null;
        }

        return {
            assetId: target.assetId,
            filePath: target.filePath,
            fileName: target.fileName
        };
    }

    function readReferenceImages(store) {
        const data = store.read(REFERENCE_POOL_FILE, {
            version: 1,
            images: []
        });
        return {
            ...data,
            images: safeArray(data.images)
        };
    }

    function writeReferenceImages(store, data) {
        store.write(REFERENCE_POOL_FILE, {
            ...(data || {}),
            version: Number(data && data.version) || 1,
            images: safeArray(data && data.images),
            updatedAt: nowIso()
        });
        referenceFileLookupCache.clear();
    }

    function readReferenceChangeEvents(store) {
        const data = store.read(REFERENCE_CHANGE_EVENTS_FILE, emptyReferenceChangeEvents());
        return {
            version: Number(data.version) || 1,
            referenceChangeEvents: safeArray(data.referenceChangeEvents),
            updatedAt: data.updatedAt || ''
        };
    }

    function writeReferenceChangeEvents(store, data) {
        store.write(REFERENCE_CHANGE_EVENTS_FILE, {
            version: 1,
            referenceChangeEvents: safeArray(data.referenceChangeEvents).slice(0, 500),
            updatedAt: nowIso()
        });
    }

    function appendReferenceChangeEvent(store, type, reference, extra = {}) {
        const data = readReferenceChangeEvents(store);
        const event = {
            id: `reference_event_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`,
            type,
            referenceId: reference && reference.id || '',
            directionId: reference && reference.directionId || extra.directionId || '',
            slot: Number(reference && reference.slot) || Number(extra.slot) || 0,
            status: reference && reference.status || '',
            impact: extra.impact || {},
            before: extra.before || null,
            after: extra.after || (reference ? compactReferenceImage(reference) : null),
            reason: extra.reason || '',
            createdAt: nowIso()
        };
        data.referenceChangeEvents = [event].concat(data.referenceChangeEvents);
        writeReferenceChangeEvents(store, data);
        return event;
    }

    function findDirectionById(store, directionId) {
        const directionsData = store.read('directions.json', { directions: [] });
        return safeArray(directionsData.directions).find(direction => direction && direction.id === directionId) || null;
    }

    function findReferenceIndex(images, referenceId) {
        return safeArray(images).findIndex(image => image && image.id === referenceId);
    }

    function normalizeDirectionReferencePool(images = [], directionId = '') {
        const next = safeArray(images).map(image => ({ ...image }));
        const active = activeReferenceImagesForDirection(next, directionId, 0);
        const bySlot = new Map();
        active.forEach(image => {
            const slot = normalizeReferenceSlot(image.slot || image.sourceSlot, 1);
            image.slot = slot;
            const defaults = REFERENCE_POOL_ROLES[slot] || {};
            image.roleTag = image.roleTag || defaults.roleTag || '';
            image.useFor = image.useFor || defaults.useFor || '';
            if (bySlot.has(slot) || bySlot.size >= 3) {
                image.status = 'archived';
                image.archivedAt = image.archivedAt || nowIso();
                image.archivedReason = image.archivedReason || (bySlot.has(slot)
                    ? 'Archived because another active reference already uses this slot.'
                    : 'Archived because active reference pool is limited to 3 images.');
                return;
            }
            bySlot.set(slot, image.id);
        });
        return next;
    }

    function nextAvailableReferenceSlot(images = [], directionId = '') {
        const used = new Set(activeReferenceImagesForDirection(images, directionId).map(image => normalizeReferenceSlot(image.slot || image.sourceSlot, 1)));
        for (let slot = 1; slot <= 3; slot += 1) {
            if (!used.has(slot)) return slot;
        }
        return 0;
    }

    function copyReferenceUploadFile(store, directionId, slot, file) {
        const validation = validateReferenceImageFile(file);
        const outputDir = store.filePath(path.join('reference-pool', directionId));
        ensureDir(outputDir);
        const fileName = `${slot}_${Date.now().toString(36)}_${safeFileBaseName(validation.originalName)}${validation.extension}`;
        const filePath = path.join(outputDir, fileName);
        if (file.buffer) {
            fs.writeFileSync(filePath, file.buffer);
        } else {
            fs.copyFileSync(file.filePath, filePath);
        }
        fs.accessSync(filePath, fs.constants.R_OK);
        const stats = fs.statSync(filePath);
        return {
            filePath,
            fileName,
            relativePath: path.relative(store.dataDir, filePath),
            extension: validation.extension,
            size: stats.size,
            originalName: validation.originalName
        };
    }

    function buildReferenceRecord({ store, direction, slot, file, payload = {}, replacesReferenceId = '' }) {
        const copied = copyReferenceUploadFile(store, direction.id, slot, file);
        const defaults = REFERENCE_POOL_ROLES[slot] || {};
        const now = nowIso();
        return {
            id: buildReferenceId(direction.id, slot, copied.originalName),
            directionId: direction.id,
            directionPath: direction.path || '',
            directionName: direction.name || '',
            matchedDirectionIds: [direction.id],
            source: 'manual_upload',
            sourceSlot: slot,
            slot,
            roleTag: payload.roleTag || defaults.roleTag || '',
            useFor: payload.useFor || defaults.useFor || '',
            visualNotes: normalizeText(payload.visualNotes),
            status: 'active',
            filePath: copied.filePath,
            fileName: copied.fileName,
            originalFileName: copied.originalName,
            relativePath: copied.relativePath,
            extension: copied.extension,
            size: copied.size,
            replacesReferenceId,
            createdAt: now,
            updatedAt: now
        };
    }

    function listDirectionReferences(directionId, query = {}) {
        const { store } = getStore(query);
        ensureEmptyFiles(store);
        const direction = findDirectionById(store, directionId);
        if (!direction) {
            return { success: false, message: `方向不存在：${directionId}` };
        }
        const data = readReferenceImages(store);
        const directionImages = safeArray(data.images)
            .filter(image => referenceBelongsToDirection(image, directionId))
            .map(compactReferenceImage)
            .sort((a, b) => {
                const statusOrder = status => status === 'active' ? 0 : (status === 'archived' ? 1 : (status === 'rejected' ? 2 : 3));
                const statusDiff = statusOrder(a.status) - statusOrder(b.status);
                if (statusDiff !== 0) return statusDiff;
                return (Number(a.slot) || 99) - (Number(b.slot) || 99) || toTimeMs(b.updatedAt || b.createdAt) - toTimeMs(a.updatedAt || a.createdAt);
            });
        const active = directionImages.filter(image => image.status === 'active').slice(0, 3);
        const slots = [1, 2, 3].map(slot => {
            const defaults = REFERENCE_POOL_ROLES[slot];
            return {
                slot,
                label: defaults.label,
                roleTag: defaults.roleTag,
                useFor: defaults.useFor,
                reference: active.find(image => Number(image.slot) === slot) || null
            };
        });
        const eventData = readReferenceChangeEvents(store);
        return {
            success: true,
            direction: {
                id: direction.id,
                path: direction.path || '',
                name: direction.name || ''
            },
            slots,
            activeReferences: active,
            references: directionImages,
            referenceChangeEvents: eventData.referenceChangeEvents
                .filter(event => event && event.directionId === directionId)
                .slice(0, 30)
        };
    }

    function uploadDirectionReference(directionId, payload = {}, file = null, query = {}) {
        const { store } = getStore(query);
        ensureEmptyFiles(store);
        const direction = findDirectionById(store, directionId);
        if (!direction) {
            return { success: false, message: `方向不存在：${directionId}` };
        }
        const data = readReferenceImages(store);
        const slot = payload.slot ? normalizeReferenceSlot(payload.slot) : nextAvailableReferenceSlot(data.images, directionId);
        if (!slot) {
            return { success: false, message: '当前方向 active 参考图已满 3 张，请先替换或归档。' };
        }
        const activeAtSlot = activeReferenceImagesForDirection(data.images, directionId)
            .find(image => normalizeReferenceSlot(image.slot || image.sourceSlot, 1) === slot);
        if (activeAtSlot && payload.replaceExisting !== true) {
            return { success: false, message: `slot ${slot} 已有 active 参考图，请使用替换接口。` };
        }
        const uploadFile = file || { filePath: payload.filePath, originalName: payload.fileName || path.basename(payload.filePath || '') };
        if (!uploadFile || (!uploadFile.filePath && !uploadFile.buffer)) {
            return { success: false, message: '请提供参考图文件。' };
        }
        if (activeAtSlot) {
            const oldIndex = findReferenceIndex(data.images, activeAtSlot.id);
            data.images[oldIndex] = {
                ...data.images[oldIndex],
                status: 'archived',
                archivedAt: nowIso(),
                archivedReason: 'Replaced by new upload.',
                updatedAt: nowIso()
            };
        }
        const reference = buildReferenceRecord({ store, direction, slot, file: uploadFile, payload });
        data.images = normalizeDirectionReferencePool([reference].concat(data.images), directionId);
        writeReferenceImages(store, data);
        const event = appendReferenceChangeEvent(store, 'uploaded', reference, {
            directionId,
            slot,
            impact: { promptActiveReferenceIds: activeReferenceImagesForDirection(data.images, directionId).map(image => image.id) }
        });
        return {
            success: true,
            message: '参考图已上传。',
            reference: compactReferenceImage(reference),
            event,
            pool: listDirectionReferences(directionId, query)
        };
    }

    function replaceReference(referenceId, payload = {}, file = null, query = {}) {
        const { store } = getStore(query);
        ensureEmptyFiles(store);
        const data = readReferenceImages(store);
        const oldIndex = findReferenceIndex(data.images, referenceId);
        if (oldIndex < 0) {
            return { success: false, message: `参考图不存在：${referenceId}` };
        }
        const oldReference = data.images[oldIndex];
        const direction = findDirectionById(store, oldReference.directionId) || {
            id: oldReference.directionId,
            path: oldReference.directionPath,
            name: oldReference.directionName
        };
        const slot = normalizeReferenceSlot(oldReference.slot || oldReference.sourceSlot, 1);
        const uploadFile = file || { filePath: payload.filePath, originalName: payload.fileName || path.basename(payload.filePath || '') };
        if (!uploadFile || (!uploadFile.filePath && !uploadFile.buffer)) {
            return { success: false, message: '请提供替换参考图文件。' };
        }
        const archivedOld = {
            ...oldReference,
            status: 'archived',
            archivedAt: nowIso(),
            archivedReason: payload.reason || 'Replaced by new reference.',
            replacedByReferenceId: '',
            updatedAt: nowIso()
        };
        const nextReference = buildReferenceRecord({
            store,
            direction,
            slot,
            file: uploadFile,
            payload: {
                roleTag: payload.roleTag || oldReference.roleTag,
                useFor: payload.useFor || oldReference.useFor,
                visualNotes: payload.visualNotes !== undefined ? payload.visualNotes : oldReference.visualNotes
            },
            replacesReferenceId: oldReference.id
        });
        archivedOld.replacedByReferenceId = nextReference.id;
        data.images[oldIndex] = archivedOld;
        data.images = normalizeDirectionReferencePool([nextReference].concat(data.images), direction.id);
        writeReferenceImages(store, data);
        const event = appendReferenceChangeEvent(store, 'replaced', nextReference, {
            before: compactReferenceImage(oldReference),
            directionId: direction.id,
            slot,
            reason: payload.reason || '',
            impact: {
                oldStatus: 'archived',
                newActiveReferenceId: nextReference.id,
                promptActiveReferenceIds: activeReferenceImagesForDirection(data.images, direction.id).map(image => image.id)
            }
        });
        return {
            success: true,
            message: '参考图已替换，旧图已归档。',
            oldReference: compactReferenceImage(archivedOld),
            reference: compactReferenceImage(nextReference),
            event,
            pool: listDirectionReferences(direction.id, query)
        };
    }

    function archiveReference(referenceId, payload = {}, query = {}) {
        const { store } = getStore(query);
        ensureEmptyFiles(store);
        const data = readReferenceImages(store);
        const index = findReferenceIndex(data.images, referenceId);
        if (index < 0) return { success: false, message: `参考图不存在：${referenceId}` };
        const before = data.images[index];
        const archived = {
            ...before,
            status: 'archived',
            archivedAt: nowIso(),
            archivedReason: payload.reason || 'Manual archive.',
            updatedAt: nowIso()
        };
        data.images[index] = archived;
        data.images = normalizeDirectionReferencePool(data.images, archived.directionId);
        writeReferenceImages(store, data);
        const event = appendReferenceChangeEvent(store, 'archived', archived, {
            before: compactReferenceImage(before),
            reason: payload.reason || '',
            impact: { promptActiveReferenceIds: activeReferenceImagesForDirection(data.images, archived.directionId).map(image => image.id) }
        });
        return { success: true, message: '参考图已归档，不会再进入 Prompt。', reference: compactReferenceImage(archived), event, pool: listDirectionReferences(archived.directionId, query) };
    }

    function rejectReference(referenceId, payload = {}, query = {}) {
        const { store } = getStore(query);
        ensureEmptyFiles(store);
        const data = readReferenceImages(store);
        const index = findReferenceIndex(data.images, referenceId);
        if (index < 0) return { success: false, message: `参考图不存在：${referenceId}` };
        const before = data.images[index];
        const rejected = {
            ...before,
            status: 'rejected',
            rejectReason: payload.reason || payload.rejectReason || 'Not suitable.',
            updatedAt: nowIso()
        };
        data.images[index] = rejected;
        data.images = normalizeDirectionReferencePool(data.images, rejected.directionId);
        writeReferenceImages(store, data);
        const event = appendReferenceChangeEvent(store, 'rejected', rejected, {
            before: compactReferenceImage(before),
            reason: rejected.rejectReason,
            impact: { promptActiveReferenceIds: activeReferenceImagesForDirection(data.images, rejected.directionId).map(image => image.id) }
        });
        return { success: true, message: '参考图已标记不适合，不会再进入 Prompt。', reference: compactReferenceImage(rejected), event, pool: listDirectionReferences(rejected.directionId, query) };
    }

    function deleteReference(referenceId, payload = {}, query = {}) {
        const { store } = getStore(query);
        ensureEmptyFiles(store);
        const data = readReferenceImages(store);
        const index = findReferenceIndex(data.images, referenceId);
        if (index < 0) return { success: false, message: `参考图不存在：${referenceId}` };
        const before = data.images[index];
        if (payload.confirm !== true && payload.confirmDelete !== true) {
            return {
                success: false,
                needsConfirmation: true,
                message: '永久删除必须二次确认。',
                impact: {
                    directionId: before.directionId,
                    slot: before.slot || before.sourceSlot || '',
                    promptContext: normalizeReferenceStatus(before.status, 'active') === 'active' ? '将从 Prompt active 参考图上下文移除' : '不会影响当前 Prompt active 上下文',
                    metadata: '会保留 deleted 元数据和变更事件'
                }
            };
        }
        const deleted = {
            ...before,
            status: 'deleted',
            deleted: {
                deletedAt: nowIso(),
                reason: payload.reason || payload.deleteReason || '',
                impact: {
                    promptContext: normalizeReferenceStatus(before.status, 'active') === 'active' ? 'removed_from_active_prompt_context' : 'no_active_prompt_context_change',
                    filePath: before.filePath || ''
                }
            },
            updatedAt: nowIso()
        };
        data.images[index] = deleted;
        data.images = normalizeDirectionReferencePool(data.images, deleted.directionId);
        writeReferenceImages(store, data);
        const event = appendReferenceChangeEvent(store, 'deleted', deleted, {
            before: compactReferenceImage(before),
            reason: deleted.deleted.reason,
            impact: deleted.deleted.impact
        });
        return { success: true, message: '参考图已永久删除，保留 deleted 元数据。', reference: compactReferenceImage(deleted), event, pool: listDirectionReferences(deleted.directionId, query) };
    }

    function reorderDirectionReferences(directionId, payload = {}, query = {}) {
        const { store } = getStore(query);
        ensureEmptyFiles(store);
        const data = readReferenceImages(store);
        const active = activeReferenceImagesForDirection(data.images, directionId);
        const activeIds = new Set(active.map(image => image.id));
        const desiredIds = safeArray(payload.referenceIds || payload.orderedReferenceIds).filter(id => activeIds.has(id)).slice(0, 3);
        if (payload.referenceId && payload.slot) {
            const id = String(payload.referenceId);
            const slot = normalizeReferenceSlot(payload.slot);
            const target = active.find(image => image.id === id);
            if (!target) return { success: false, message: '只能重排 active 参考图。' };
            active.forEach(image => {
                if (image.id === id) {
                    image.slot = slot;
                    return;
                }
                if (normalizeReferenceSlot(image.slot || image.sourceSlot, 1) === slot) {
                    image.slot = normalizeReferenceSlot(target.slot || target.sourceSlot, 1);
                }
            });
        } else if (desiredIds.length) {
            desiredIds.forEach((id, index) => {
                const image = active.find(item => item.id === id);
                if (image) image.slot = index + 1;
            });
        } else {
            return { success: false, message: '请提供重排 referenceIds 或 referenceId + slot。' };
        }

        const activeById = new Map(active.map(image => [image.id, image]));
        data.images = data.images.map(image => activeById.get(image.id) || image);
        data.images = normalizeDirectionReferencePool(data.images, directionId);
        writeReferenceImages(store, data);
        const event = appendReferenceChangeEvent(store, 'reordered', { directionId, slot: 0, status: 'active' }, {
            directionId,
            impact: { promptActiveReferenceIds: activeReferenceImagesForDirection(data.images, directionId).map(image => image.id) }
        });
        return { success: true, message: '参考图 slot 已更新。', event, pool: listDirectionReferences(directionId, query) };
    }

    function analyzeReferenceDna(referenceId, payload = {}, query = {}) {
        const { store } = getStore(query);
        ensureEmptyFiles(store);
        const data = readReferenceImages(store);
        const index = findReferenceIndex(data.images, referenceId);
        if (index < 0) return { success: false, message: `参考图不存在：${referenceId}` };
        const reference = data.images[index];
        const dna = {
            analyzedAt: nowIso(),
            roleTag: reference.roleTag || '',
            useFor: reference.useFor || '',
            visualNotes: normalizeText(payload.visualNotes || reference.visualNotes),
            source: payload.source || 'manual'
        };
        data.images[index] = {
            ...reference,
            visualDna: dna,
            visualNotes: dna.visualNotes || reference.visualNotes || '',
            updatedAt: nowIso()
        };
        writeReferenceImages(store, data);
        const event = appendReferenceChangeEvent(store, 'analyzed_dna', data.images[index], {
            reason: payload.reason || '',
            impact: { visualDna: dna }
        });
        return { success: true, message: '参考图 DNA 已记录。', reference: compactReferenceImage(data.images[index]), visualDna: dna, event };
    }

    function getDirectionPromptReferences(directionId, query = {}) {
        const { store } = getStore(query);
        ensureEmptyFiles(store);
        const data = readReferenceImages(store);
        const active = activeReferenceImagesForDirection(data.images, directionId);
        return active.map(compactReferenceImage);
    }

    function getReferenceFile(referenceId, query = {}) {
        const { store } = getStore(query);
        const target = getFileLookup(store, 'reference-images.json', 'images', 'id', referenceFileLookupCache).get(referenceId);

        if (!target || target.status === 'deleted' || target.deleted || !fileExists(target.filePath)) {
            return null;
        }

        return {
            referenceId: target.id,
            filePath: target.filePath,
            fileName: target.fileName
        };
    }

    function getOverview(query = {}) {
        const { store } = getStore(query);
        store.ensureBase();

        const status = getStatus(query);
        const directionsData = store.read('directions.json', { directions: [] });
        const referencesData = store.read('reference-images.json', { images: [] });
        const assetsData = store.read('assets.json', { assets: [] });
        const feedbackData = store.read('feedback.json', { feedback: [] });
        const schedulerState = store.read('scheduler-state.json', emptySchedulerState());
        const draftData = store.read('direction-drafts.json', emptyDirectionDrafts());
        const evidenceData = store.read('direction-evidence.json', emptyDirectionEvidence());
        const directionEvidence = safeArray(evidenceData.evidence)
            .filter(entry => entry && entry.source !== 'material-analysis');
        const materialLearningData = store.read('material-learnings.json', { learnings: [] });
        const latestFeedbackByAsset = buildLatestFeedbackByAsset(feedbackData.feedback);

        const directions = safeArray(directionsData.directions);
        const directionStatusCounts = directions.reduce((counts, direction) => {
            const directionStatus = normalizeDirectionStatus(direction.status, 'seed');
            counts[directionStatus] = (counts[directionStatus] || 0) + 1;
            return counts;
        }, {});
        const draftStatusCounts = safeArray(draftData.drafts).reduce((counts, draft) => {
            const draftStatus = normalizeDirectionStatus(draft.status, 'draft');
            counts[draftStatus] = (counts[draftStatus] || 0) + 1;
            return counts;
        }, {});
        const references = safeArray(referencesData.images);
        const assets = safeArray(assetsData.assets)
            .map(asset => mergeFeedbackReview(asset, latestFeedbackByAsset))
            .map(compactAsset);
        const runs = readRuns(store);
        const reviewCounts = buildReviewCounts(assets);

        const matchedReferenceDirectionIds = new Set();
        references.forEach(image => {
            safeArray(image.matchedDirectionIds).forEach(id => matchedReferenceDirectionIds.add(id));
        });

        const runDirectionIds = new Set();
        runs.forEach(run => {
            if (run.sourceDirection && run.sourceDirection.id) {
                runDirectionIds.add(run.sourceDirection.id);
            }
        });

        const primaryTags = new Map();
        directions.forEach(direction => {
            const tag = direction.primaryTag || '未分类';
            const current = primaryTags.get(tag) || {
                tag,
                total: 0,
                withReferenceImages: 0,
                runCount: 0
            };
            current.total += 1;
            if (matchedReferenceDirectionIds.has(direction.id)) {
                current.withReferenceImages += 1;
            }
            if (runDirectionIds.has(direction.id)) {
                current.runCount += 1;
            }
            primaryTags.set(tag, current);
        });
        const visualDnaOverview = buildVisualDnaOverview(query);
        const directionTagsOverview = buildDirectionTagsOverview(query);

        return {
            success: true,
            imported: status.imported,
            importedAt: status.importedAt,
            counts: {
                directions: directions.length || Number(status.counts && status.counts.directions) || 0,
                seedDirections: directionStatusCounts.seed || 0,
                acceptedDirections: directionStatusCounts.accepted || 0,
                archivedDirections: directionStatusCounts.archived || 0,
                disabledDirections: directionStatusCounts.disabled || 0,
                autoRunDirections: directions.filter(isRunnableDirection).length,
                directionDrafts: safeArray(draftData.drafts).length,
                pendingDirectionDrafts: draftStatusCounts.draft || 0,
                rejectedDirectionDrafts: draftStatusCounts.rejected || 0,
                directionEvidence: directionEvidence.length,
                materialLearnings: safeArray(materialLearningData.learnings).length,
                collectedAssetGroups: new Set(directionEvidence.map(entry => entry.assetGroupKey).filter(Boolean)).size,
                directionsWithReferenceImages: matchedReferenceDirectionIds.size,
                directionsWithRuns: runDirectionIds.size,
                topMaterials: Number(status.counts && status.counts.topMaterials) || 0,
                topMaterialInsights: Number(status.counts && status.counts.topMaterialInsights) || 0,
                referenceImages: references.length || Number(status.counts && status.counts.referenceImages) || 0,
                assets: assets.length,
                assetsWithFiles: assets.filter(asset => asset.fileExists).length,
                feedback: safeArray(feedbackData.feedback).length,
                reviewedAssets: reviewCounts.reviewed,
                unreviewedAssets: reviewCounts.unreviewed,
                goodAssets: reviewCounts.good,
                normalAssets: reviewCounts.normal,
                badAssets: reviewCounts.bad,
                rejectedAssets: reviewCounts.rejected,
                runs: runs.length,
                completedRuns: runs.filter(run => run.status === 'completed').length,
                promptTotal: runs.reduce((sum, run) => sum + (Number(run.promptTotal) || 0), 0),
                savedImages: assets.length || runs.reduce((sum, run) => sum + (Number(run.savedCount) || 0), 0)
            },
            directionStatusCounts,
            draftStatusCounts,
            reviewCounts,
            scheduler: schedulerState,
            visualDnaOverview,
            directionTagsOverview,
            primaryTags: Array.from(primaryTags.values())
                .sort((a, b) => b.total - a.total || a.tag.localeCompare(b.tag)),
            recentRuns: runs.slice(0, 5),
            recentAssets: assets
                .sort((a, b) => toTimeMs(b.savedAt || b.recordedAt) - toTimeMs(a.savedAt || a.recordedAt))
                .slice(0, 8),
            warnings: status.warnings || []
        };
    }

    return {
        acceptDirectionDraft,
        archiveDirectionDraft,
        acceptMemoryRule,
        collectDirectionFromAsset,
        createFeedback,
        disableMemoryRule,
        extractDirectionDraftsFromRun,
        buildVisualDnaOverview,
        buildVisualDnaWorkbench,
        buildDirectionTagsOverview,
        generateVisualDnaRuleDrafts,
        analyzeDirectionTagsFromReferences,
        batchAnalyzeDirectionTagsFromReferences,
        getConfig,
        getAssetFile,
        getCreativeMemory,
        getDirectionVisualDna,
        getDirectionTags,
        getDirectionPromptReferences,
        getOverview,
        getReferenceFile,
        getStatus,
        importKnowledge,
        learnFromFeedback,
        listDirectionReferences,
        listDirectionDrafts,
        listFeedback,
        listAssets,
        listDirections,
        listRuns,
        listTopMaterialInsights,
        mergeDirection,
        mergeDirectionDraft,
        analyzeReferenceDna,
        updateDirectionTagsManualOverride,
        archiveReference,
        deleteReference,
        replaceReference,
        reorderDirectionReferences,
        rejectMemoryRule,
        rejectDirectionDraft,
        rejectReference,
        refreshDirectionTags,
        uploadDirectionReference,
        updateMemoryRule,
        updateDirectionStatus,
        reviewAsset
    };
}

module.exports = {
    DEFAULT_REFERENCE_FOLDER,
    DIRECTION_STATUSES: Array.from(DIRECTION_STATUSES),
    FEEDBACK_TAGS,
    REVIEW_STATUSES: Array.from(REVIEW_STATUSES),
    buildDefaultConfig,
    createCreativeKnowledgeService
};
