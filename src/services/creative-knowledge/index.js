const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const XLSX = require('xlsx');
const { importDirections } = require('./direction-importer');
const { importTopMaterials } = require('./top-material-importer');
const { indexReferenceImages } = require('./reference-image-indexer');
const { CreativeKnowledgeStore } = require('./store');
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
            return {
                referenceDirection: normalizeText(item.sourcePath || item.referenceDirection || ''),
                name: normalizeText(item.label || item.name || item.newDirectionName || `候选方向${index + 1}`),
                description: normalizeText(item.description),
                sourceStrategy: normalizeText(item.sourceStrategy || item.reason),
                targetLevel: normalizeText(item.targetLevel),
                dimensions: item.dimensions && typeof item.dimensions === 'object' ? item.dimensions : {},
                duplicateRisk: normalizeText(item.duplicateRisk),
                reason: normalizeText(item.reason),
                prompts
            };
        })
        .filter(item => item.name || item.description || item.prompts.length);
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
    return {
        id: image.id || '',
        directionId: image.directionId || '',
        directionPath: image.directionPath || '',
        directionName: image.directionName || '',
        matchedDirectionIds: safeArray(image.matchedDirectionIds),
        source: image.source || '',
        sourceSlot: image.sourceSlot || '',
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
        imageUrl: exists && image.id
            ? `/api/creative-knowledge/references/${encodeURIComponent(image.id)}/file`
            : (image.remoteUrl || '')
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
        message: run.message || ''
    };
}

function createCreativeKnowledgeService(options = {}) {
    const rootDir = options.rootDir || options.ROOT_DIR || process.cwd();
    const logger = options.logger || console;

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
        writeIfMissing(store, 'material-learnings.json', emptyMaterialLearnings);
        writeIfMissing(store, 'creative-memory.json', emptyCreativeMemory);
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
        const filtered = applyDirectionFilters(data.directions, query);
        const offset = Math.max(0, Math.floor(Number(query.offset) || 0));
        const limit = Math.max(1, Math.min(500, Math.floor(Number(query.limit) || 100)));
        const items = filtered.slice(offset, offset + limit).map(direction => {
            const matchedEvidence = evidenceEntries
                .filter(entry => directionEvidenceMatches(direction, entry))
                .sort((a, b) => toTimeMs(b.updatedAt || b.createdAt) - toTimeMs(a.updatedAt || a.createdAt));

            return {
                ...direction,
                evidenceCount: matchedEvidence.length,
                knowledgeStats: {
                    matchedReferenceCount: referenceCounts.get(direction.id) || 0,
                    referenceHintCount: safeArray(direction.referenceHints).filter(Boolean).length,
                    runCount: runCounts.get(direction.id) || 0,
                    assetCount: assetCounts.get(direction.id) || 0,
                    evidenceCount: matchedEvidence.length
                },
                evidencePreview: matchedEvidence.slice(0, 4).map(compactDirectionEvidence),
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

    function compactDirectionDraft(draft = {}, directions = []) {
        const similarDirections = Array.isArray(draft.similarDirections)
            ? draft.similarDirections
            : findSimilarDirections(directions, draft);
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
        let drafts = safeArray(data.drafts).map(draft => compactDirectionDraft(draft, directionData.directions));
        const keyword = normalizeText(query.q || query.keyword).toLowerCase();
        const status = normalizeText(query.status).toLowerCase();
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

        drafts.sort((a, b) => toTimeMs(b.updatedAt || b.createdAt) - toTimeMs(a.updatedAt || a.createdAt));
        const { offset, limit } = parsePaging(query, { limit: 50, maxLimit: 300 });
        const counts = {};
        safeArray(data.drafts).forEach(draft => {
            const draftStatus = normalizeDirectionStatus(draft.status, 'draft');
            counts[draftStatus] = (counts[draftStatus] || 0) + 1;
        });

        return {
            success: true,
            updatedAt: data.updatedAt || '',
            total: drafts.length,
            offset,
            limit,
            counts,
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
        let candidates = candidateDirectionsToDraftCandidates(
            (run.agentTask && run.agentTask.result && run.agentTask.result.candidateDirections)
            || (run.agentOutput && run.agentOutput.candidateDirections)
            || run.candidateDirections
            || []
        );
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
                dimensions: candidate.dimensions && typeof candidate.dimensions === 'object' ? candidate.dimensions : {},
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
        if (normalizeDirectionStatus(draft.status, 'draft') === 'accepted' && draft.acceptedDirectionId) {
            return {
                success: true,
                message: '方向草案此前已采纳',
                draft: compactDirectionDraft(draft),
                directionId: draft.acceptedDirectionId
            };
        }

        const directionData = store.read('directions.json', {
            version: 1,
            importedAt: null,
            directions: []
        });
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
            referenceImageStatus: draft.referenceImageStatus || 'manual_pending',
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
        const data = store.read('assets.json', {
            assets: []
        });
        const target = safeArray(data.assets)
            .map(compactAsset)
            .find(asset => asset.assetId === assetId);

        if (!target || !target.fileExists) {
            return null;
        }

        return {
            assetId: target.assetId,
            filePath: target.filePath,
            fileName: target.fileName
        };
    }

    function getReferenceFile(referenceId, query = {}) {
        const { store } = getStore(query);
        const data = store.read('reference-images.json', {
            images: []
        });
        const target = safeArray(data.images)
            .map(compactReferenceImage)
            .find(image => image.id === referenceId);

        if (!target || !target.fileExists) {
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
        getConfig,
        getAssetFile,
        getCreativeMemory,
        getOverview,
        getReferenceFile,
        getStatus,
        importKnowledge,
        learnFromFeedback,
        listDirectionDrafts,
        listFeedback,
        listAssets,
        listDirections,
        listRuns,
        listTopMaterialInsights,
        mergeDirection,
        mergeDirectionDraft,
        rejectMemoryRule,
        rejectDirectionDraft,
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
