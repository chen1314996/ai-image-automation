const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const {
    formatDateTimeForFile,
    naturalCompareByName,
    sanitizeFileNamePart
} = require('../../../file-utils');
const {
    DELIVERY_TARGET_ASPECT_RATIOS,
    normalizeDeliveryCandidateCount,
    normalizeDeliveryPromptTemplates
} = require('./candidate-config');
const {
    extractSourceBusinessName
} = require('../output-naming/source-business-name');

const DELIVERY_TARGET_SIZES = ['800x800', '1280x720', '1080x1920'];
const DELIVERY_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp']);
const STORE_VERSION = 1;

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

function readJson(filePath, fallback) {
    try {
        if (!fs.existsSync(filePath)) {
            return fallback;
        }
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
        return fallback;
    }
}

function writeJson(filePath, data) {
    ensureDir(path.dirname(filePath));
    const tempPath = `${filePath}.tmp`;
    fs.writeFileSync(tempPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    fs.renameSync(tempPath, filePath);
}

function normalizePathKey(filePath) {
    return path.resolve(String(filePath || '').trim()).toLowerCase();
}

function normalizeInputPath(value) {
    return path.resolve(String(value || '').trim());
}

function hashText(value, length = 16) {
    return crypto.createHash('sha1').update(String(value || '')).digest('hex').slice(0, length);
}

function sanitizeOptionalPart(value, maxLength = 60) {
    const text = String(value || '').trim();
    return text ? sanitizeFileNamePart(text, maxLength) : '';
}

function normalizeNamingRule(payload = {}) {
    const source = payload && typeof payload === 'object' ? payload : {};
    const rawTagLevels = Array.isArray(source.tagLevels)
        ? source.tagLevels
        : [
            source.primaryTag || source.primary,
            source.secondaryTag || source.secondary,
            source.tertiaryTag || source.tertiary
        ];
    const tagLevels = rawTagLevels
        .map(item => String(item || '').trim())
        .filter(Boolean);
    return {
        fixedPrefix: String(source.fixedPrefix || source.prefix || '').trim() || 'GOFCNIM',
        startNumber: String(source.startNumber || '').trim() || '1',
        regionText: String(source.regionText || source.region || '').trim(),
        channelText: String(source.channelText || source.channel || '').trim(),
        primaryTag: tagLevels[0] || '',
        secondaryTag: tagLevels[1] || '',
        tertiaryTag: tagLevels[2] || '',
        tagLevels
    };
}

function buildSequence(startNumber, index) {
    const raw = String(startNumber || '').trim();
    const parsed = Number(raw);
    const base = Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 1;
    const width = /^\d+$/.test(raw) ? raw.length : String(base).length;
    return String(base + index).padStart(width, '0');
}

function buildBaseName(namingRule, index, sourceImage = null) {
    const rule = normalizeNamingRule(namingRule);
    const prefix = sanitizeOptionalPart(rule.fixedPrefix, 32) || 'image';
    const sequence = buildSequence(rule.startNumber, index);
    const sourceFileName = typeof sourceImage === 'string'
        ? sourceImage
        : (sourceImage && sourceImage.fileName ? sourceImage.fileName : '');
    const sourceBusinessName = extractSourceBusinessName(sourceFileName);
    const businessParts = sourceBusinessName && sourceBusinessName.businessParts.length
        ? sourceBusinessName.businessParts
        : (Array.isArray(rule.tagLevels) ? rule.tagLevels : []);
    const parts = [
        `${prefix}${sequence}`,
        sanitizeOptionalPart(rule.regionText, 24),
        sanitizeOptionalPart(rule.channelText, 32),
        ...businessParts.map(part => sanitizeOptionalPart(part, 80))
    ].filter(Boolean);
    return parts.join('_');
}

function normalizeCandidateCount(value) {
    return normalizeDeliveryCandidateCount(value);
}

function normalizeTargetSizes(value, fallback = DELIVERY_TARGET_SIZES) {
    const rawValues = Array.isArray(value) ? value : (value ? [value] : []);
    const selected = rawValues
        .map(item => String(item || '').trim())
        .filter(size => DELIVERY_TARGET_SIZES.includes(size));
    const ordered = DELIVERY_TARGET_SIZES.filter(size => selected.includes(size));
    if (ordered.length) {
        return ordered;
    }
    const fallbackValues = Array.isArray(fallback) ? fallback : [];
    const fallbackOrdered = DELIVERY_TARGET_SIZES.filter(size => fallbackValues.includes(size));
    return fallbackOrdered.length ? fallbackOrdered : [...DELIVERY_TARGET_SIZES];
}

function normalizeCandidateCountsBySize(value = {}, targetSizes = DELIVERY_TARGET_SIZES, fallbackCount = 4) {
    const source = value && typeof value === 'object' ? value : {};
    const defaultCount = normalizeCandidateCount(fallbackCount);
    return normalizeTargetSizes(targetSizes).reduce((counts, size) => {
        counts[size] = normalizeCandidateCount(source[size] || defaultCount);
        return counts;
    }, {});
}

function normalizeProcessMode(value) {
    return value === 'legil-only' ? 'legil-only' : 'full-delivery';
}

function createPendingTarget(size, candidateCount, existingTarget = {}) {
    const source = existingTarget && typeof existingTarget === 'object' ? existingTarget : {};
    const existingCandidates = Array.isArray(source.candidates) ? source.candidates : [];
    return {
        size,
        aspectRatio: source.aspectRatio || DELIVERY_TARGET_ASPECT_RATIOS[size] || '',
        status: source.status || (existingCandidates.length ? 'candidates_ready' : 'pending'),
        candidateCount,
        candidates: existingCandidates,
        selectedCandidateId: source.selectedCandidateId || '',
        adaptedPath: source.adaptedPath || '',
        standardizedPath: source.standardizedPath || '',
        standardizedCandidates: Array.isArray(source.standardizedCandidates) ? source.standardizedCandidates : [],
        standardized: source.standardized || null,
        logoPath: source.logoPath || '',
        finalPath: source.finalPath || '',
        logoApplied: source.logoApplied === true,
        finalizedCandidates: Array.isArray(source.finalizedCandidates) ? source.finalizedCandidates : [],
        finalized: source.finalized || null,
        error: source.error || '',
        updatedAt: source.updatedAt || ''
    };
}

function createDefaultPostprocess(existingPostprocess = {}) {
    const source = existingPostprocess && typeof existingPostprocess === 'object' ? existingPostprocess : {};
    return {
        allCandidatesGenerated: source.allCandidatesGenerated === true,
        allTargetsSelected: source.allTargetsSelected === true,
        standardized: source.standardized === true,
        logoApplied: source.logoApplied === true,
        renamed: source.renamed === true,
        packaged: source.packaged === true
    };
}

function createDeliveryPostprocessStore(options = {}) {
    const rootDir = options.rootDir || path.join(__dirname, '..', '..', '..');
    const dataRoot = path.join(rootDir, 'data', 'delivery-postprocess');
    const runsRoot = path.join(dataRoot, 'runs');
    const indexPath = path.join(dataRoot, 'delivery-runs.json');

    function ensureStore() {
        ensureDir(runsRoot);
    }

    function readIndex() {
        ensureStore();
        const index = readJson(indexPath, {
            version: STORE_VERSION,
            latestRunId: '',
            runs: []
        });
        return {
            version: STORE_VERSION,
            latestRunId: String(index.latestRunId || ''),
            runs: Array.isArray(index.runs) ? index.runs : []
        };
    }

    function writeIndex(index) {
        writeJson(indexPath, {
            version: STORE_VERSION,
            latestRunId: index.latestRunId || '',
            runs: Array.isArray(index.runs) ? index.runs : []
        });
    }

    function getRunPath(runId) {
        return path.join(runsRoot, `${sanitizeFileNamePart(runId, 120)}.json`);
    }

    function readRun(runId) {
        if (!runId) {
            return null;
        }
        const run = readJson(getRunPath(runId), null);
        return run && typeof run === 'object' ? run : null;
    }

    function writeRun(run) {
        writeJson(getRunPath(run.runId), run);
    }

    function summarizeRun(run) {
        return {
            runId: run.runId,
            status: run.status,
            inputFolder: run.inputFolder,
            inputFolderKey: run.inputFolderKey,
            outputFolder: run.outputFolder,
            processMode: run.processMode,
            targetSizes: run.targetSizes,
            candidateCountPerSize: run.candidateCountPerSize,
            candidateCountsBySize: run.candidateCountsBySize,
            totalJobs: run.totalJobs,
            createdAt: run.createdAt,
            updatedAt: run.updatedAt
        };
    }

    function upsertRunSummary(index, run) {
        const summary = summarizeRun(run);
        const runs = (index.runs || []).filter(item => item && item.runId !== run.runId);
        runs.unshift(summary);
        index.runs = runs.slice(0, 80);
        index.latestRunId = run.runId;
        return index;
    }

    function findReusableRun(inputFolderKey) {
        const index = readIndex();
        const summaries = [...index.runs].sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
        for (const summary of summaries) {
            if (!summary || summary.inputFolderKey !== inputFolderKey) {
                continue;
            }
            const run = readRun(summary.runId);
            if (run) {
                return run;
            }
        }
        return null;
    }

    function listOkImages(inputFolder) {
        const entries = fs.readdirSync(inputFolder, { withFileTypes: true });
        return entries
            .filter(entry => entry.isFile())
            .filter(entry => DELIVERY_IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
            .map(entry => {
                const filePath = path.join(inputFolder, entry.name);
                const stat = fs.statSync(filePath);
                return {
                    filePath,
                    fileName: entry.name,
                    extension: path.extname(entry.name).toLowerCase(),
                    fileSize: stat.size,
                    mtimeMs: stat.mtimeMs,
                    sourceKey: normalizePathKey(filePath)
                };
            })
            .sort((a, b) => naturalCompareByName(a.fileName, b.fileName));
    }

    function scanInputFolder(payload = {}) {
        ensureStore();

        const inputFolder = normalizeInputPath(payload.inputFolder);
        const outputFolder = normalizeInputPath(payload.outputFolder);
        if (!payload.inputFolder || !String(payload.inputFolder).trim()) {
            throw new Error('请填写 OK 图输入文件夹');
        }
        if (!payload.outputFolder || !String(payload.outputFolder).trim()) {
            throw new Error('请填写交付输出文件夹');
        }
        if (!fs.existsSync(inputFolder) || !fs.statSync(inputFolder).isDirectory()) {
            throw new Error(`OK 图输入文件夹不存在：${inputFolder}`);
        }

        const now = new Date().toISOString();
        const namingRule = normalizeNamingRule(payload.namingRule || payload);
        const logoTemplateFolder = String(payload.logoTemplateFolder || payload.logoFolder || '').trim();
        const candidateCountPerSize = normalizeCandidateCount(payload.candidateCountPerSize || payload.candidateCount || payload.outputQuantity);
        const targetSizes = normalizeTargetSizes(payload.targetSizes);
        const candidateCountsBySize = normalizeCandidateCountsBySize(
            payload.candidateCountsBySize,
            targetSizes,
            candidateCountPerSize
        );
        const processMode = normalizeProcessMode(payload.processMode);
        const promptTemplates = normalizeDeliveryPromptTemplates(payload.promptTemplates);
        const inputFolderKey = normalizePathKey(inputFolder);
        const outputFolderKey = normalizePathKey(outputFolder);
        const existingRun = findReusableRun(inputFolderKey);
        const runId = existingRun && existingRun.runId
            ? existingRun.runId
            : `delivery_run_${formatDateTimeForFile(new Date())}_${hashText(inputFolderKey, 8)}`;
        const createdAt = existingRun && existingRun.createdAt ? existingRun.createdAt : now;
        const existingJobs = new Map();

        if (existingRun && Array.isArray(existingRun.jobs)) {
            existingRun.jobs.forEach(job => {
                const key = job && job.sourceImage && (job.sourceImage.sourceKey || normalizePathKey(job.sourceImage.filePath));
                if (key && !existingJobs.has(key)) {
                    existingJobs.set(key, job);
                }
            });
        }

        let reusedJobCount = 0;
        let newJobCount = 0;
        const images = listOkImages(inputFolder);
        const jobs = images.map((image, index) => {
            const existingJob = existingJobs.get(image.sourceKey);
            const jobId = existingJob && existingJob.jobId
                ? existingJob.jobId
                : `delivery_job_${hashText(image.sourceKey, 20)}`;
            const sourceBusinessName = extractSourceBusinessName(image.fileName);
            const baseName = buildBaseName(namingRule, index, image);
            const targets = {};

            targetSizes.forEach(size => {
                targets[size] = createPendingTarget(
                    size,
                    candidateCountsBySize[size],
                    existingJob && existingJob.targets ? existingJob.targets[size] : null
                );
            });

            if (existingJob) {
                reusedJobCount += 1;
            } else {
                newJobCount += 1;
            }

            return {
                jobId,
                groupIndex: index + 1,
                status: existingJob && existingJob.status ? existingJob.status : 'pending',
                baseName,
                folderName: baseName,
                sourceImage: image,
                sourceBusinessName: sourceBusinessName ? {
                    sourceType: sourceBusinessName.sourceType,
                    businessName: sourceBusinessName.businessName,
                    businessParts: sourceBusinessName.businessParts
                } : null,
                targets,
                postprocess: createDefaultPostprocess(existingJob && existingJob.postprocess),
                createdAt: existingJob && existingJob.createdAt ? existingJob.createdAt : now,
                updatedAt: now
            };
        });

        const run = {
            version: STORE_VERSION,
            runId,
            status: 'scanned',
            inputFolder,
            inputFolderKey,
            outputFolder,
            outputFolderKey,
            logoTemplateFolder,
            processMode,
            targetSizes,
            candidateCountPerSize,
            candidateCountsBySize,
            namingRule,
            promptTemplates,
            totalJobs: jobs.length,
            completedJobs: jobs.filter(job => job.status === 'completed').length,
            failedJobs: jobs.filter(job => job.status === 'failed').length,
            currentJobIndex: 0,
            jobs,
            scan: {
                sourceImageCount: images.length,
                reusedJobCount,
                newJobCount,
                removedJobCount: existingRun && Array.isArray(existingRun.jobs)
                    ? Math.max(0, existingRun.jobs.length - reusedJobCount)
                    : 0,
                scannedAt: now
            },
            createdAt,
            updatedAt: now
        };

        writeRun(run);
        const index = upsertRunSummary(readIndex(), run);
        writeIndex(index);

        return run;
    }

    function getLatestRun(inputFolder = '') {
        const index = readIndex();
        if (inputFolder && String(inputFolder).trim()) {
            return findReusableRun(normalizePathKey(normalizeInputPath(inputFolder)));
        }
        return readRun(index.latestRunId);
    }

    function listRuns() {
        return readIndex().runs;
    }

    function saveRun(run) {
        if (!run || !run.runId) {
            throw new Error('delivery run 无效，无法保存');
        }
        const jobs = Array.isArray(run.jobs) ? run.jobs : [];
        const now = new Date().toISOString();
        const targetSizes = Array.isArray(run.targetSizes) && run.targetSizes.length
            ? run.targetSizes
            : DELIVERY_TARGET_SIZES;

        run.totalJobs = jobs.length;
        run.completedJobs = jobs.filter(job => {
            const targets = job && job.targets ? job.targets : {};
            return targetSizes.every(size => {
                const target = targets[size];
                return target && ['candidates_ready', 'candidate_selected', 'standardized', 'logo_applied', 'finalized'].includes(String(target.status || ''));
            });
        }).length;
        run.failedJobs = jobs.filter(job => {
            const targets = job && job.targets ? job.targets : {};
            return targetSizes.some(size => targets[size] && targets[size].status === 'failed');
        }).length;
        run.updatedAt = now;
        jobs.forEach(job => {
            if (job && typeof job === 'object' && !job.updatedAt) {
                job.updatedAt = now;
            }
        });

        writeRun(run);
        const index = upsertRunSummary(readIndex(), run);
        writeIndex(index);
        return run;
    }

    function applyTargetConfig(run, payload = {}) {
        if (!run || typeof run !== 'object') {
            return run;
        }
        const targetSizes = normalizeTargetSizes(payload.targetSizes, run.targetSizes);
        const defaultCount = normalizeCandidateCount(payload.candidateCountPerSize || run.candidateCountPerSize);
        const candidateCountsBySize = normalizeCandidateCountsBySize(
            payload.candidateCountsBySize || run.candidateCountsBySize,
            targetSizes,
            defaultCount
        );
        const jobs = Array.isArray(run.jobs) ? run.jobs : [];

        jobs.forEach(job => {
            job.targets = job.targets && typeof job.targets === 'object' ? job.targets : {};
            targetSizes.forEach(size => {
                job.targets[size] = createPendingTarget(
                    size,
                    candidateCountsBySize[size],
                    job.targets[size]
                );
            });
        });

        run.targetSizes = targetSizes;
        run.candidateCountsBySize = candidateCountsBySize;
        run.candidateCountPerSize = defaultCount;
        return run;
    }

    return {
        dataRoot,
        targetSizes: DELIVERY_TARGET_SIZES,
        scanInputFolder,
        getLatestRun,
        readRun,
        saveRun,
        applyTargetConfig,
        listRuns,
        buildBaseName,
        normalizeNamingRule,
        normalizeCandidateCount
    };
}

module.exports = {
    DELIVERY_TARGET_SIZES,
    DELIVERY_TARGET_ASPECT_RATIOS,
    buildBaseName,
    normalizeNamingRule,
    createDeliveryPostprocessStore
};
