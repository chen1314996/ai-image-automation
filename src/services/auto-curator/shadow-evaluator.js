const { LOW_CONFIDENCE_THRESHOLD } = require('./scorer');

const HUMAN_REVIEWED = new Set(['good', 'normal', 'bad', 'rejected']);
const GOLDEN_LABELS = new Set(['good', 'bad', 'off_direction', 'text_problem']);

function safeArray(value) {
    return Array.isArray(value) ? value : [];
}

function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeHumanLabel(value) {
    const label = normalizeText(value).toLowerCase();
    if (label === 'normal') return 'good';
    if (label === 'rejected') return 'bad';
    if (GOLDEN_LABELS.has(label)) return label;
    return '';
}

function normalizeAutoLabel(value) {
    const label = normalizeText(value).toLowerCase();
    if (label === 'normal') return 'good';
    if (label === 'rejected') return 'bad';
    if (GOLDEN_LABELS.has(label)) return label;
    return '';
}

function getReviewStatus(asset = {}) {
    const status = normalizeText(
        asset.reviewStatus ||
        (asset.review && (asset.review.status || asset.review.reviewStatus))
    ).toLowerCase();
    return status || 'unreviewed';
}

function getAutoReview(asset = {}) {
    return asset.autoReview && typeof asset.autoReview === 'object' ? asset.autoReview : null;
}

function isAutoScored(asset = {}) {
    const autoReview = getAutoReview(asset);
    return Boolean(autoReview && autoReview.status === 'scored');
}

function isLowConfidence(asset = {}) {
    const autoReview = getAutoReview(asset);
    if (!autoReview) return false;
    return autoReview.needsHumanReview === true ||
        Number(autoReview.confidence) < LOW_CONFIDENCE_THRESHOLD ||
        autoReview.status === 'failed';
}

function compareAutoToHuman(autoGrade, humanStatus) {
    const ai = normalizeAutoLabel(autoGrade);
    const human = normalizeHumanLabel(humanStatus);
    return {
        comparable: Boolean(ai && human),
        ai,
        human,
        matched: Boolean(ai && human && ai === human)
    };
}

function buildConsistency(assets = []) {
    const compared = safeArray(assets)
        .filter(asset => isAutoScored(asset) && HUMAN_REVIEWED.has(getReviewStatus(asset)))
        .map(asset => {
            const comparison = compareAutoToHuman(asset.autoReview.autoGrade, getReviewStatus(asset));
            return comparison.comparable ? { asset, comparison } : null;
        })
        .filter(Boolean);
    const matched = compared.filter(item => item.comparison.matched).length;
    const byHuman = compared.reduce((map, item) => {
        const key = item.comparison.human || 'unknown';
        if (!map[key]) map[key] = { total: 0, matched: 0, accuracy: 0 };
        map[key].total += 1;
        if (item.comparison.matched) map[key].matched += 1;
        map[key].accuracy = map[key].total ? map[key].matched / map[key].total : 0;
        return map;
    }, {});
    return {
        total: compared.length,
        matched,
        mismatched: compared.length - matched,
        accuracy: compared.length ? matched / compared.length : 0,
        byHuman
    };
}

function labelCounts(items = [], labelField = 'label') {
    return safeArray(items).reduce((counts, item) => {
        const label = normalizeHumanLabel(item && item[labelField]) || normalizeText(item && item[labelField]).toLowerCase() || 'unknown';
        counts[label] = (counts[label] || 0) + 1;
        return counts;
    }, {});
}

function compactAssetForReport(asset = {}) {
    const autoReview = getAutoReview(asset);
    return {
        assetId: asset.assetId || '',
        runId: asset.runId || '',
        fileName: asset.fileName || '',
        filePath: asset.filePath || '',
        imageUrl: asset.imageUrl || (asset.assetId ? `/api/creative-knowledge/assets/${encodeURIComponent(asset.assetId)}/file` : ''),
        prompt: asset.prompt || '',
        promptTitle: asset.promptTitle || '',
        promptDirection: asset.promptDirection || '',
        directionId: asset.directionId || '',
        directionPath: asset.directionPath || asset.sourceDirectionPath || '',
        reviewStatus: getReviewStatus(asset),
        reviewLabels: safeArray(asset.reviewLabels || (asset.review && asset.review.labels)),
        reviewNote: asset.reviewNote || (asset.review && asset.review.note) || '',
        autoReview,
        autoScore: autoReview ? autoReview.autoScore : null,
        confidence: autoReview ? autoReview.confidence : null,
        autoGrade: autoReview ? autoReview.autoGrade : '',
        reason: autoReview ? autoReview.reason : ''
    };
}

function buildShadowReport({ assets = [], goldenSamples = [], limit = 24 } = {}) {
    const today = new Date().toISOString().slice(0, 10);
    const scored = safeArray(assets).filter(isAutoScored);
    const failed = safeArray(assets).filter(asset => getAutoReview(asset) && getAutoReview(asset).status === 'failed');
    const pending = safeArray(assets).filter(asset => !getAutoReview(asset));
    const lowConfidence = safeArray(assets).filter(isLowConfidence);
    const reviewedToday = scored.filter(asset => String(asset.autoReview.scoredAt || '').startsWith(today));
    const consistency = buildConsistency(assets);
    const gradeCounts = scored.reduce((counts, asset) => {
        const grade = normalizeAutoLabel(asset.autoReview.autoGrade) || asset.autoReview.autoGrade || 'unknown';
        counts[grade] = (counts[grade] || 0) + 1;
        return counts;
    }, {});

    return {
        success: true,
        mode: 'shadow',
        lowConfidenceThreshold: LOW_CONFIDENCE_THRESHOLD,
        queue: {
            pending: pending.length,
            scored: scored.length,
            reviewedToday: reviewedToday.length,
            failed: failed.length,
            lowConfidence: lowConfidence.length
        },
        consistency,
        autoGradeCounts: gradeCounts,
        goldenSet: {
            total: safeArray(goldenSamples).length,
            counts: labelCounts(goldenSamples)
        },
        lowConfidenceQueue: lowConfidence
            .sort((a, b) => Number((a.autoReview || {}).confidence) - Number((b.autoReview || {}).confidence))
            .slice(0, limit)
            .map(compactAssetForReport),
        recentScored: scored
            .sort((a, b) => String((b.autoReview || {}).scoredAt || '').localeCompare(String((a.autoReview || {}).scoredAt || '')))
            .slice(0, limit)
            .map(compactAssetForReport),
        sampleDetails: safeArray(assets)
            .filter(asset => getAutoReview(asset))
            .sort((a, b) => String((b.autoReview || {}).scoredAt || '').localeCompare(String((a.autoReview || {}).scoredAt || '')))
            .slice(0, limit)
            .map(compactAssetForReport)
    };
}

function evaluatePredictions(pairs = []) {
    const results = safeArray(pairs)
        .map(pair => {
            const expected = normalizeHumanLabel(pair.expected || pair.label);
            const predicted = normalizeAutoLabel(pair.predicted || pair.autoGrade);
            const matched = Boolean(expected && predicted && expected === predicted);
            return {
                sampleId: pair.sampleId || '',
                assetId: pair.assetId || '',
                expected,
                predicted,
                matched,
                confidence: Number(pair.confidence) || 0,
                reason: pair.reason || ''
            };
        })
        .filter(item => item.expected && item.predicted);
    const matched = results.filter(item => item.matched).length;
    const byLabel = results.reduce((map, item) => {
        if (!map[item.expected]) {
            map[item.expected] = { total: 0, matched: 0, accuracy: 0 };
        }
        map[item.expected].total += 1;
        if (item.matched) map[item.expected].matched += 1;
        map[item.expected].accuracy = map[item.expected].total
            ? map[item.expected].matched / map[item.expected].total
            : 0;
        return map;
    }, {});

    return {
        total: results.length,
        matched,
        mismatched: results.length - matched,
        accuracy: results.length ? matched / results.length : 0,
        byLabel,
        results
    };
}

module.exports = {
    compareAutoToHuman,
    evaluatePredictions,
    buildShadowReport,
    compactAssetForReport,
    normalizeAutoLabel,
    normalizeHumanLabel
};
