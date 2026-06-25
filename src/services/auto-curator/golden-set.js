const crypto = require('crypto');
const { evaluatePredictions, normalizeHumanLabel } = require('./shadow-evaluator');

const GOLDEN_SET_FILE = 'auto-curator-golden-set.json';
const GOLDEN_SET_VERSION = 1;

function nowIso() {
    return new Date().toISOString();
}

function safeArray(value) {
    return Array.isArray(value) ? value : [];
}

function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function buildSampleId(seed) {
    const hash = crypto.createHash('sha1').update(String(seed || '')).digest('hex').slice(0, 12);
    return `golden_${hash}`;
}

function emptyGoldenSet() {
    return {
        version: GOLDEN_SET_VERSION,
        samples: [],
        evaluations: [],
        updatedAt: ''
    };
}

function readGoldenSet(store) {
    store.ensureBase();
    const data = store.read(GOLDEN_SET_FILE, emptyGoldenSet());
    return {
        ...emptyGoldenSet(),
        ...data,
        version: data.version || GOLDEN_SET_VERSION,
        samples: safeArray(data.samples),
        evaluations: safeArray(data.evaluations)
    };
}

function writeGoldenSet(store, data, timestamp = nowIso()) {
    const next = {
        ...emptyGoldenSet(),
        ...data,
        version: data.version || GOLDEN_SET_VERSION,
        samples: safeArray(data.samples),
        evaluations: safeArray(data.evaluations),
        updatedAt: timestamp
    };
    store.write(GOLDEN_SET_FILE, next);
    return next;
}

function statusAndTagsToLabel(asset = {}) {
    const status = normalizeText(
        asset.reviewStatus ||
        (asset.review && (asset.review.status || asset.review.reviewStatus))
    ).toLowerCase();
    const tags = safeArray(asset.reviewLabels || (asset.review && asset.review.labels))
        .map(normalizeText)
        .join(' ');
    if (/文字|text|乱码/.test(tags)) return 'text_problem';
    if (/跑题|方向|不符|off/i.test(tags)) return 'off_direction';
    if (status === 'good' || status === 'normal') return 'good';
    if (status === 'bad' || status === 'rejected') return 'bad';
    return '';
}

function normalizeGoldenSample(sample = {}, asset = {}) {
    const label = normalizeHumanLabel(sample.label || sample.humanLabel || sample.category) || statusAndTagsToLabel(asset);
    if (!label) return null;
    const assetId = normalizeText(sample.assetId || asset.assetId);
    const seed = [
        assetId,
        sample.filePath || asset.filePath,
        label,
        sample.prompt || asset.prompt
    ].join('|');
    const timestamp = sample.createdAt || nowIso();
    return {
        sampleId: normalizeText(sample.sampleId || sample.id) || buildSampleId(seed),
        assetId,
        label,
        category: label,
        humanLabel: label,
        filePath: normalizeText(sample.filePath || asset.filePath),
        fileName: normalizeText(sample.fileName || asset.fileName),
        prompt: normalizeText(sample.prompt || asset.prompt).slice(0, 4000),
        promptTitle: normalizeText(sample.promptTitle || asset.promptTitle).slice(0, 240),
        promptDirection: normalizeText(sample.promptDirection || asset.promptDirection).slice(0, 500),
        directionId: normalizeText(sample.directionId || asset.directionId),
        directionPath: normalizeText(sample.directionPath || asset.directionPath || asset.sourceDirectionPath).slice(0, 500),
        note: normalizeText(sample.note || sample.reason || asset.reviewNote || (asset.review && asset.review.note)).slice(0, 1000),
        source: normalizeText(sample.source) || (assetId ? 'reviewed-asset' : 'manual-import'),
        createdAt: timestamp,
        updatedAt: sample.updatedAt || timestamp
    };
}

function summarizeGoldenSet(samples = []) {
    const counts = safeArray(samples).reduce((map, sample) => {
        const label = sample.label || 'unknown';
        map[label] = (map[label] || 0) + 1;
        return map;
    }, {});
    return {
        total: safeArray(samples).length,
        counts
    };
}

function importGoldenSamples({ store, payload = {}, assets = [] }) {
    const data = readGoldenSet(store);
    const assetsById = new Map(safeArray(assets).map(asset => [asset.assetId, asset]));
    const assetIds = safeArray(payload.assetIds).map(normalizeText).filter(Boolean);
    const explicitSamples = safeArray(payload.samples);
    const fromReviewed = payload.fromReviewed === true || (!explicitSamples.length && !assetIds.length);
    const candidates = [];

    explicitSamples.forEach(sample => {
        const asset = assetsById.get(sample.assetId) || {};
        const normalized = normalizeGoldenSample(sample, asset);
        if (normalized) candidates.push(normalized);
    });

    assetIds.forEach(assetId => {
        const asset = assetsById.get(assetId);
        if (!asset) return;
        const normalized = normalizeGoldenSample({}, asset);
        if (normalized) candidates.push(normalized);
    });

    if (fromReviewed) {
        safeArray(assets)
            .map(asset => normalizeGoldenSample({}, asset))
            .filter(Boolean)
            .slice(0, Math.max(1, Math.min(1000, Number(payload.limit) || 200)))
            .forEach(sample => candidates.push(sample));
    }

    const existing = new Map(data.samples.map(sample => [sample.sampleId, sample]));
    candidates.forEach(sample => {
        existing.set(sample.sampleId, {
            ...(existing.get(sample.sampleId) || {}),
            ...sample,
            updatedAt: nowIso()
        });
    });
    const nextSamples = Array.from(existing.values())
        .sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
    const next = writeGoldenSet(store, {
        ...data,
        samples: nextSamples
    });

    return {
        success: true,
        imported: candidates.length,
        total: next.samples.length,
        summary: summarizeGoldenSet(next.samples),
        samples: next.samples.slice(0, Number(payload.returnLimit) || 80)
    };
}

function listGoldenSet({ store, query = {} }) {
    const data = readGoldenSet(store);
    const label = normalizeText(query.label || query.category).toLowerCase();
    const keyword = normalizeText(query.q || query.keyword).toLowerCase();
    let samples = data.samples.slice();
    if (label) {
        samples = samples.filter(sample => sample.label === label || sample.category === label);
    }
    if (keyword) {
        samples = samples.filter(sample => [
            sample.sampleId,
            sample.assetId,
            sample.label,
            sample.fileName,
            sample.directionPath,
            sample.promptTitle,
            sample.promptDirection,
            sample.prompt,
            sample.note
        ].some(value => String(value || '').toLowerCase().includes(keyword)));
    }
    const limit = Math.max(1, Math.min(500, Number(query.limit) || 80));
    const offset = Math.max(0, Number(query.offset) || 0);
    return {
        success: true,
        updatedAt: data.updatedAt || '',
        summary: summarizeGoldenSet(data.samples),
        total: samples.length,
        offset,
        limit,
        samples: samples.slice(offset, offset + limit),
        recentEvaluations: data.evaluations.slice(0, 10)
    };
}

function appendGoldenEvaluation(store, data, evaluation) {
    return writeGoldenSet(store, {
        ...data,
        evaluations: [evaluation].concat(safeArray(data.evaluations)).slice(0, 50)
    });
}

function buildEvaluationRecord(pairs = [], meta = {}) {
    const report = evaluatePredictions(pairs);
    return {
        evaluationId: `golden_eval_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`,
        createdAt: nowIso(),
        autoCuratorVersion: meta.autoCuratorVersion || '',
        source: meta.source || 'golden-set',
        total: report.total,
        matched: report.matched,
        mismatched: report.mismatched,
        accuracy: report.accuracy,
        byLabel: report.byLabel,
        results: report.results.slice(0, Number(meta.resultLimit) || 200)
    };
}

module.exports = {
    GOLDEN_SET_FILE,
    appendGoldenEvaluation,
    buildEvaluationRecord,
    emptyGoldenSet,
    importGoldenSamples,
    listGoldenSet,
    normalizeGoldenSample,
    readGoldenSet,
    summarizeGoldenSet,
    writeGoldenSet
};
