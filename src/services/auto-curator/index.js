const { CreativeKnowledgeStore } = require('../creative-knowledge/store');
const { buildDefaultConfig } = require('../creative-knowledge');
const {
    AUTO_CURATOR_VERSION,
    LOW_CONFIDENCE_THRESHOLD,
    createAutoCuratorScorer
} = require('./scorer');
const {
    appendGoldenEvaluation,
    buildEvaluationRecord,
    importGoldenSamples,
    listGoldenSet,
    readGoldenSet
} = require('./golden-set');
const {
    buildShadowReport,
    compactAssetForReport
} = require('./shadow-evaluator');

function nowIso() {
    return new Date().toISOString();
}

function safeArray(value) {
    return Array.isArray(value) ? value : [];
}

function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeLimit(value, fallback = 48, max = 200) {
    return Math.max(1, Math.min(max, Math.floor(Number(value) || fallback)));
}

function emptyAssets() {
    return {
        version: 1,
        assets: [],
        updatedAt: ''
    };
}

function getReviewStatus(asset = {}) {
    return normalizeText(
        asset.reviewStatus ||
        (asset.review && (asset.review.status || asset.review.reviewStatus))
    ).toLowerCase() || 'unreviewed';
}

function getStoreFromContext(context = {}, query = {}) {
    const rootDir = context.rootDir || context.ROOT_DIR || process.cwd();
    const config = buildDefaultConfig(rootDir, context.creativeKnowledge || context.knowledge || {});
    const dataDir = normalizeText(query.dataDir) || config.dataDir;
    return new CreativeKnowledgeStore(dataDir);
}

function readAssets(store) {
    store.ensureBase();
    return store.read('assets.json', emptyAssets());
}

function writeAssets(store, data, timestamp = nowIso()) {
    store.write('assets.json', {
        ...data,
        version: data.version || 1,
        updatedAt: timestamp,
        assets: safeArray(data.assets)
    });
}

function assetMatches(asset = {}, filters = {}) {
    const assetIds = new Set(safeArray(filters.assetIds).map(normalizeText).filter(Boolean));
    if (assetIds.size && !assetIds.has(asset.assetId)) return false;
    const runId = normalizeText(filters.runId);
    if (runId && asset.runId !== runId) return false;
    const status = normalizeText(filters.reviewStatus || filters.status).toLowerCase();
    if (status && getReviewStatus(asset) !== status) return false;
    const onlyMissing = filters.onlyMissing === true;
    if (onlyMissing && asset.autoReview && asset.autoReview.status === 'scored') return false;
    const retryFailed = filters.retryFailed === true;
    if (retryFailed && (!asset.autoReview || !['failed', 'skipped'].includes(asset.autoReview.status))) return false;
    return true;
}

function buildFailedAutoReview(asset, error, options = {}) {
    return {
        version: AUTO_CURATOR_VERSION,
        autoCuratorVersion: AUTO_CURATOR_VERSION,
        mode: 'shadow',
        status: options.status || 'failed',
        assetId: asset.assetId || '',
        runId: asset.runId || '',
        score: null,
        autoScore: null,
        confidence: 0,
        autoGrade: '',
        failureType: options.failureType || 'scoring_failed',
        reason: normalizeText(error && error.message ? error.message : error).slice(0, 1200),
        evidence: [],
        needsHumanReview: true,
        provider: options.provider || '',
        model: options.model || '',
        scoredAt: nowIso()
    };
}

function compactScoreRunResult(results = []) {
    return results.reduce((summary, item) => {
        const status = item.status || 'unknown';
        summary[status] = (summary[status] || 0) + 1;
        if (item.autoReview && item.autoReview.needsHumanReview) {
            summary.lowConfidence = (summary.lowConfidence || 0) + 1;
        }
        return summary;
    }, {
        scored: 0,
        failed: 0,
        skipped: 0,
        lowConfidence: 0
    });
}

function createAutoCuratorService(context = {}) {
    const scorer = createAutoCuratorScorer(context);

    function getStore(query = {}) {
        return getStoreFromContext(context, query);
    }

    async function scoreAssets(payload = {}, query = {}) {
        const store = getStore(query);
        const data = readAssets(store);
        const assets = safeArray(data.assets).slice();
        const limit = normalizeLimit(payload.limit || query.limit, 48, 300);
        const filters = {
            assetIds: payload.assetIds || payload.assets,
            runId: payload.runId || query.runId,
            reviewStatus: payload.reviewStatus || query.reviewStatus,
            onlyMissing: payload.onlyMissing === true || query.onlyMissing === 'true',
            retryFailed: payload.retryFailed === true || query.retryFailed === 'true'
        };
        const candidates = assets
            .map((asset, index) => ({ asset, index }))
            .filter(item => item.asset && assetMatches(item.asset, filters))
            .slice(0, limit);

        const results = [];
        for (const item of candidates) {
            const asset = item.asset;
            if (!asset.assetId) {
                results.push({
                    status: 'skipped',
                    message: 'Asset is missing assetId'
                });
                continue;
            }
            if (asset.autoReview && asset.autoReview.status === 'scored' && payload.force !== true && filters.retryFailed !== true) {
                results.push({
                    status: 'skipped',
                    assetId: asset.assetId,
                    autoReview: asset.autoReview,
                    message: 'Already scored'
                });
                continue;
            }

            try {
                const autoReview = await scorer.scoreAsset(asset, {
                    retries: payload.retries,
                    allowMetadataFallback: payload.allowMetadataFallback !== false,
                    winkyConfig: payload.winkyConfig
                });
                assets[item.index] = {
                    ...asset,
                    autoReview
                };
                results.push({
                    status: 'scored',
                    assetId: asset.assetId,
                    autoReview
                });
            } catch (error) {
                const autoReview = buildFailedAutoReview(asset, error);
                assets[item.index] = {
                    ...asset,
                    autoReview
                };
                results.push({
                    status: 'failed',
                    assetId: asset.assetId,
                    autoReview,
                    message: error.message
                });
            }
        }

        writeAssets(store, {
            ...data,
            assets
        });

        return {
            success: true,
            mode: 'shadow',
            autoCuratorVersion: AUTO_CURATOR_VERSION,
            totalCandidates: candidates.length,
            summary: compactScoreRunResult(results),
            results
        };
    }

    async function scoreRun(runId, payload = {}, query = {}) {
        const normalizedRunId = normalizeText(runId);
        if (!normalizedRunId) {
            return { success: false, message: 'runId is required' };
        }
        return await scoreAssets({
            ...payload,
            runId: normalizedRunId
        }, query);
    }

    function getShadowReport(query = {}) {
        const store = getStore(query);
        const data = readAssets(store);
        const golden = readGoldenSet(store);
        const assets = safeArray(data.assets);
        return buildShadowReport({
            assets,
            goldenSamples: golden.samples,
            limit: normalizeLimit(query.limit, 24, 120)
        });
    }

    function getGoldenSet(query = {}) {
        const store = getStore(query);
        return listGoldenSet({ store, query });
    }

    function importGoldenSet(payload = {}, query = {}) {
        const store = getStore(query);
        const assets = readAssets(store).assets;
        return importGoldenSamples({ store, payload, assets });
    }

    async function evaluateGoldenSet(payload = {}, query = {}) {
        const store = getStore(query);
        const data = readGoldenSet(store);
        const assetData = readAssets(store);
        const assets = safeArray(assetData.assets);
        const assetsById = new Map(assets.map(asset => [asset.assetId, asset]));
        const label = normalizeText(payload.label || query.label).toLowerCase();
        const limit = normalizeLimit(payload.limit || query.limit, 100, 500);
        const samples = data.samples
            .filter(sample => !label || sample.label === label)
            .slice(0, limit);
        const pairs = [];
        const updatedAssets = assets.slice();
        const indexByAssetId = new Map(updatedAssets.map((asset, index) => [asset.assetId, index]));

        for (const sample of samples) {
            let asset = assetsById.get(sample.assetId) || {
                assetId: sample.assetId,
                filePath: sample.filePath,
                fileName: sample.fileName,
                prompt: sample.prompt,
                promptTitle: sample.promptTitle,
                promptDirection: sample.promptDirection,
                directionId: sample.directionId,
                directionPath: sample.directionPath
            };
            let autoReview = asset.autoReview && asset.autoReview.status === 'scored' ? asset.autoReview : null;
            if (!autoReview && payload.scoreMissing !== false) {
                try {
                    autoReview = await scorer.scoreAsset(asset, {
                        retries: payload.retries,
                        allowMetadataFallback: payload.allowMetadataFallback !== false,
                        winkyConfig: payload.winkyConfig
                    });
                    if (payload.persistScores === true && asset.assetId && indexByAssetId.has(asset.assetId)) {
                        const index = indexByAssetId.get(asset.assetId);
                        updatedAssets[index] = {
                            ...updatedAssets[index],
                            autoReview
                        };
                        asset = updatedAssets[index];
                    }
                } catch (error) {
                    autoReview = buildFailedAutoReview(asset, error);
                }
            }
            if (!autoReview || autoReview.status !== 'scored') continue;
            pairs.push({
                sampleId: sample.sampleId,
                assetId: sample.assetId,
                expected: sample.label,
                predicted: autoReview.autoGrade,
                confidence: autoReview.confidence,
                reason: autoReview.reason
            });
        }

        if (payload.persistScores === true) {
            writeAssets(store, {
                ...assetData,
                assets: updatedAssets
            });
        }

        const evaluation = buildEvaluationRecord(pairs, {
            autoCuratorVersion: AUTO_CURATOR_VERSION,
            resultLimit: payload.resultLimit
        });
        appendGoldenEvaluation(store, data, evaluation);

        return {
            success: true,
            autoCuratorVersion: AUTO_CURATOR_VERSION,
            evaluation,
            accuracy: evaluation.accuracy,
            total: evaluation.total,
            matched: evaluation.matched,
            byLabel: evaluation.byLabel
        };
    }

    function getLowConfidenceQueue(query = {}) {
        const report = getShadowReport(query);
        return {
            success: true,
            lowConfidenceThreshold: LOW_CONFIDENCE_THRESHOLD,
            total: report.queue.lowConfidence,
            assets: report.lowConfidenceQueue.map(compactAssetForReport)
        };
    }

    return {
        scoreAssets,
        scoreRun,
        getShadowReport,
        getGoldenSet,
        importGoldenSet,
        evaluateGoldenSet,
        getLowConfidenceQueue
    };
}

module.exports = {
    AUTO_CURATOR_VERSION,
    LOW_CONFIDENCE_THRESHOLD,
    createAutoCuratorService
};
