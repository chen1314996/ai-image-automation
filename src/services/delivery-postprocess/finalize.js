const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('canvas');

const {
    readImageDimensions,
    sanitizeFileNamePart,
    trimBaseName
} = require('../image-renamer');
const {
    DELIVERY_TARGET_DIMENSIONS,
    DEFAULT_MAX_OUTPUT_BYTES,
    DEFAULT_MAX_OUTPUT_KB,
    DEFAULT_MIN_JPEG_QUALITY,
    buildOrdinalSuffix
} = require('./standardize');
const {
    buildBaseName,
    normalizeNamingRule
} = require('./store');
const {
    extractSourceBusinessName
} = require('../output-naming/source-business-name');

const LOGO_TEMPLATE_EXTENSIONS = new Set(['.png']);
const JPEG_QUALITIES = [92, 88, 84, 80, 76, 72, 68, 64, 60];

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

function normalizeFolderPath(value) {
    return String(value || '').replace(/["']/g, '').trim();
}

function normalizeMinQuality(value) {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue)) {
        return DEFAULT_MIN_JPEG_QUALITY;
    }
    return Math.max(1, Math.min(100, Math.floor(numberValue)));
}

function normalizeMaxBytes(value) {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue) || numberValue <= 0) {
        return DEFAULT_MAX_OUTPUT_BYTES;
    }
    return Math.floor(numberValue);
}

function encodeJpegWithinLimit(canvas, options = {}) {
    const maxBytes = normalizeMaxBytes(options.maxOutputBytes);
    const minQuality = normalizeMinQuality(options.minQuality);
    const steps = JPEG_QUALITIES.filter(quality => quality >= minQuality);
    if (!steps.includes(minQuality)) {
        steps.push(minQuality);
    }

    let last = null;
    for (const quality of [...new Set(steps)].sort((a, b) => b - a)) {
        const buffer = canvas.toBuffer('image/jpeg', {
            quality: quality / 100,
            progressive: false,
            chromaSubsampling: true
        });
        last = { buffer, quality, bytes: buffer.length };
        if (buffer.length <= maxBytes) {
            return { ...last, withinLimit: true };
        }
    }

    return {
        ...(last || { buffer: Buffer.alloc(0), quality: minQuality, bytes: 0 }),
        withinLimit: false
    };
}

function resolveLogoTemplatesBySize(logoTemplateFolder, targetSizes = []) {
    const folder = normalizeFolderPath(logoTemplateFolder);
    if (!folder) {
        throw new Error('请填写 LOGO 模板目录');
    }
    if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
        throw new Error(`LOGO 模板目录不存在：${folder}`);
    }

    const templates = {};
    fs.readdirSync(folder)
        .filter(file => LOGO_TEMPLATE_EXTENSIONS.has(path.extname(file).toLowerCase()))
        .forEach(file => {
            const filePath = path.join(folder, file);
            const dimensions = readImageDimensions(filePath);
            if (!dimensions) return;
            const key = `${dimensions.width}x${dimensions.height}`;
            if (!templates[key]) {
                templates[key] = {
                    fileName: file,
                    filePath,
                    dimensions
                };
            }
        });

    const missing = targetSizes.filter(size => !templates[size]);
    if (missing.length) {
        const found = Object.keys(templates);
        throw new Error(`LOGO 模板缺少目标分辨率：${missing.join('、')}。当前目录识别到：${found.length ? found.join('、') : '无 PNG 模板'}`);
    }

    return templates;
}

function buildFinalPackageRoot(run) {
    return path.join(run.outputFolder, run.runId, 'final-package');
}

function buildFinalImagePath(run, job, targetSize, candidateIndex = 1, candidateCount = 1) {
    const safeFolderName = sanitizeFileNamePart(job.folderName || job.baseName || 'delivery-job', 'delivery-job');
    const safeBaseName = trimBaseName(sanitizeFileNamePart(job.baseName || safeFolderName, 'image'));
    return path.join(buildFinalPackageRoot(run), safeFolderName, `${safeBaseName}_${targetSize}${buildOrdinalSuffix(candidateIndex, candidateCount)}.jpg`);
}

function getExistingFinalizedOutput(outputPath, targetSize, logoTemplate) {
    if (!outputPath || !fs.existsSync(outputPath)) {
        return null;
    }
    const target = DELIVERY_TARGET_DIMENSIONS[targetSize];
    if (!target) {
        return null;
    }
    const dimensions = readImageDimensions(outputPath);
    if (!dimensions || dimensions.width !== target.width || dimensions.height !== target.height) {
        return null;
    }
    const stat = fs.statSync(outputPath);
    return {
        outputPath,
        logoPath: logoTemplate && logoTemplate.filePath || '',
        logoFileName: logoTemplate && logoTemplate.fileName || '',
        logoDimensions: logoTemplate && logoTemplate.dimensions && logoTemplate.dimensions.text || '',
        targetSize,
        quality: null,
        sizeBytes: stat.size,
        sizeKb: Math.round(stat.size / 1024),
        reusedExisting: true
    };
}

async function applyLogoTemplateToImage(sourcePath, outputPath, targetSize, logoTemplate, options = {}) {
    if (!sourcePath || !fs.existsSync(sourcePath)) {
        throw new Error(`标准化图片不存在：${sourcePath || ''}`);
    }

    const target = DELIVERY_TARGET_DIMENSIONS[targetSize];
    if (!target) {
        throw new Error(`不支持的目标尺寸：${targetSize}`);
    }

    const sourceDimensions = readImageDimensions(sourcePath);
    if (!sourceDimensions || sourceDimensions.width !== target.width || sourceDimensions.height !== target.height) {
        throw new Error(`标准化图片尺寸不匹配，应为 ${targetSize}`);
    }

    if (!logoTemplate || !logoTemplate.filePath || !fs.existsSync(logoTemplate.filePath)) {
        throw new Error(`未找到 ${targetSize} 对应的 LOGO 模板`);
    }

    const logoDimensions = logoTemplate.dimensions || readImageDimensions(logoTemplate.filePath);
    if (!logoDimensions || logoDimensions.width !== target.width || logoDimensions.height !== target.height) {
        throw new Error(`LOGO 模板尺寸不匹配，${logoTemplate.fileName || ''} 应为 ${targetSize}`);
    }

    ensureDir(path.dirname(outputPath));
    const baseImage = await loadImage(fs.readFileSync(sourcePath));
    const logoImage = await loadImage(fs.readFileSync(logoTemplate.filePath));
    const canvas = createCanvas(target.width, target.height);
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, target.width, target.height);
    ctx.drawImage(baseImage, 0, 0, target.width, target.height);
    ctx.drawImage(logoImage, 0, 0, target.width, target.height);

    const encoded = encodeJpegWithinLimit(canvas, options);
    if (!encoded.withinLimit) {
        throw new Error(`加 LOGO 后压缩到最低质量 ${normalizeMinQuality(options.minQuality)} 仍超过 ${Math.round(normalizeMaxBytes(options.maxOutputBytes) / 1024) || DEFAULT_MAX_OUTPUT_KB}KB`);
    }

    fs.writeFileSync(outputPath, encoded.buffer);
    return {
        outputPath,
        logoPath: logoTemplate.filePath,
        logoFileName: logoTemplate.fileName,
        logoDimensions: logoDimensions.text,
        targetSize,
        quality: encoded.quality,
        sizeBytes: encoded.bytes,
        sizeKb: Math.round(encoded.bytes / 1024)
    };
}

function updateRunNaming(run, namingRule, options = {}) {
    const rule = normalizeNamingRule(namingRule || run.namingRule || {});
    const onlyJobId = String(options.jobId || '').trim();
    run.namingRule = rule;
    (Array.isArray(run.jobs) ? run.jobs : []).forEach((job, index) => {
        if (onlyJobId && job.jobId !== onlyJobId) {
            return;
        }
        const baseName = buildBaseName(rule, index, job.sourceImage);
        const parsedBusinessName = extractSourceBusinessName(job.sourceImage && job.sourceImage.fileName);
        job.baseName = baseName;
        job.folderName = baseName;
        job.sourceBusinessName = parsedBusinessName ? {
            sourceType: parsedBusinessName.sourceType,
            businessName: parsedBusinessName.businessName,
            businessParts: parsedBusinessName.businessParts
        } : null;
    });
}

async function finalizeDeliveryRun(run, options = {}) {
    if (!run || typeof run !== 'object') {
        throw new Error('delivery run 无效');
    }

    const targetSizes = Array.isArray(run.targetSizes) && run.targetSizes.length
        ? run.targetSizes
        : Object.keys(DELIVERY_TARGET_DIMENSIONS);
    const logoTemplateFolder = normalizeFolderPath(options.logoTemplateFolder || run.logoTemplateFolder);
    const logoTemplates = resolveLogoTemplatesBySize(logoTemplateFolder, targetSizes);
    const allowPartial = options.allowPartial === true || options.allowPartialPostprocess === true;

    const finalized = [];
    const failed = [];
    const allJobs = Array.isArray(run.jobs) ? run.jobs : [];
    const onlyJobId = String(options.jobId || '').trim();
    const jobs = onlyJobId
        ? allJobs.filter(job => job && job.jobId === onlyJobId)
        : allJobs;
    if (onlyJobId && jobs.length === 0) {
        throw new Error(`delivery job not found: ${onlyJobId}`);
    }
    if (options.namingRule) {
        updateRunNaming(run, options.namingRule, { jobId: onlyJobId });
    }
    run.logoTemplateFolder = logoTemplateFolder;
    const forceFinalize = options.force === true || options.forceFinalize === true;
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
    let reusedExistingCount = 0;

    for (const job of jobs) {
        for (const targetSize of targetSizes) {
            const target = job.targets && job.targets[targetSize];
            if (!target) {
                failed.push({ jobId: job.jobId, targetSize, reason: '目标尺寸不存在' });
                continue;
            }
            const standardizedItems = Array.isArray(target.standardizedCandidates) && target.standardizedCandidates.length
                ? target.standardizedCandidates
                : (target.standardizedPath ? [{
                    candidateId: target.selectedCandidateId || 'candidate_1',
                    candidateIndex: 1,
                    candidateCount: 1,
                    outputPath: target.standardizedPath
                }] : []);

            if (!standardizedItems.length) {
                failed.push({ jobId: job.jobId, baseName: job.baseName, targetSize, reason: '请先执行标准化' });
                if (allowPartial) {
                    target.status = 'failed';
                    target.error = target.error || '最终交付跳过：请先执行标准化';
                    target.updatedAt = new Date().toISOString();
                }
                continue;
            }

            const finalCandidates = [];
            const targetFailures = [];
            const candidateCount = standardizedItems.length;
            for (let index = 0; index < standardizedItems.length; index++) {
                const item = standardizedItems[index];
                const candidateIndex = Number(item.candidateIndex) || index + 1;
                const outputPath = buildFinalImagePath(run, job, targetSize, candidateIndex, candidateCount);
                try {
                    const existingResult = forceFinalize
                        ? null
                        : getExistingFinalizedOutput(outputPath, targetSize, logoTemplates[targetSize]);
                    const result = existingResult || await applyLogoTemplateToImage(
                            item.outputPath,
                            outputPath,
                            targetSize,
                            logoTemplates[targetSize],
                            options
                        );
                    if (existingResult) {
                        reusedExistingCount += 1;
                    }
                    const finalizedItem = {
                        candidateId: item.candidateId || `candidate_${candidateIndex}`,
                        candidateIndex,
                        candidateCount,
                        outputPath: result.outputPath,
                        logoFileName: result.logoFileName,
                        logoPath: result.logoPath,
                        logoDimensions: result.logoDimensions,
                        quality: result.quality,
                        sizeBytes: result.sizeBytes,
                        sizeKb: result.sizeKb,
                        finalizedAt: new Date().toISOString()
                    };
                    finalCandidates.push(finalizedItem);
                    finalized.push({
                        jobId: job.jobId,
                        baseName: job.baseName,
                        targetSize,
                        ...result,
                        candidateId: finalizedItem.candidateId,
                        candidateIndex,
                        candidateCount
                    });
                } catch (error) {
                    const failure = {
                        jobId: job.jobId,
                        baseName: job.baseName,
                        targetSize,
                        candidateId: item.candidateId || `candidate_${candidateIndex}`,
                        candidateIndex,
                        candidateCount,
                        reason: error.message
                    };
                    targetFailures.push(failure);
                    failed.push(failure);
                }
            }

            target.logoPath = finalCandidates[0]?.logoPath || '';
            target.finalPath = finalCandidates[0]?.outputPath || '';
            target.finalizedCandidates = finalCandidates;
            target.status = targetFailures.length ? 'failed' : 'finalized';
            target.logoApplied = finalCandidates.length > 0;
            target.error = targetFailures.length ? `最终交付失败：${targetFailures.map(item => item.reason).join('；')}` : '';
            target.finalized = finalCandidates[0] || null;
            target.updatedAt = new Date().toISOString();
            if (onProgress) {
                onProgress(run);
            }
        }

        const allFinalized = targetSizes.every(size => job.targets && job.targets[size] && job.targets[size].status === 'finalized');
        job.status = allFinalized ? 'finalized' : (failed.some(item => item.jobId === job.jobId) ? 'failed' : job.status);
        job.postprocess = {
            ...(job.postprocess || {}),
            logoApplied: allFinalized,
            renamed: allFinalized,
            packaged: allFinalized,
            finalized: allFinalized,
            finalPackageFolder: allFinalized ? path.dirname(buildFinalImagePath(run, job, targetSizes[0], 1, 1)) : ''
        };
        job.updatedAt = new Date().toISOString();
        if (onProgress) {
            onProgress(run);
        }
    }

    run.finalPackageRoot = buildFinalPackageRoot(run);
    const allFinalized = allJobs.length > 0 && allJobs.every(job => job.status === 'finalized');
    if (allFinalized) {
        run.status = 'finalized';
        run.finalizedAt = new Date().toISOString();
    } else if (failed.length) {
        run.status = allowPartial && finalized.length ? 'partial_finalized' : 'failed';
    } else if (onlyJobId) {
        run.status = options.runStatus || run.status || 'partial_finalized';
        run.lastFinalizedAt = new Date().toISOString();
    } else {
        run.status = 'finalized';
        run.finalizedAt = new Date().toISOString();
    }
    run.completedJobs = allJobs.filter(job => job.status === 'finalized').length;
    run.failedJobs = allJobs.filter(job => job.status === 'failed').length;

    return {
        run,
        logoTemplateFolder,
        logoTemplates: targetSizes.map(size => ({
            targetSize: size,
            fileName: logoTemplates[size].fileName,
            filePath: logoTemplates[size].filePath,
            dimensions: logoTemplates[size].dimensions.text
        })),
        finalPackageRoot: run.finalPackageRoot,
        finalized,
        failed,
        finalizedCount: finalized.length,
        failedCount: failed.length,
        reusedExistingCount,
        partial: failed.length > 0 && finalized.length > 0
    };
}

module.exports = {
    finalizeDeliveryRun,
    resolveLogoTemplatesBySize,
    buildFinalImagePath,
    applyLogoTemplateToImage
};
