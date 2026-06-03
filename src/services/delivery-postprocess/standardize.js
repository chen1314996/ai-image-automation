const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('canvas');

const { readImageDimensions, sanitizeFileNamePart } = require('../image-renamer');

const DELIVERY_TARGET_DIMENSIONS = {
    '800x800': { width: 800, height: 800 },
    '1280x720': { width: 1280, height: 720 },
    '1080x1920': { width: 1080, height: 1920 }
};

const DEFAULT_MAX_OUTPUT_BYTES = 390 * 1024;
const DEFAULT_MAX_OUTPUT_KB = 390;
const DEFAULT_MIN_JPEG_QUALITY = 60;
const JPEG_QUALITIES = [92, 88, 84, 80, 76, 72, 68, 64, 60];

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
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

function calculateCoverTransform(sourceWidth, sourceHeight, targetWidth, targetHeight) {
    const scale = Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight);
    const sourceCropWidth = targetWidth / scale;
    const sourceCropHeight = targetHeight / scale;
    return {
        sourceX: Math.max(0, (sourceWidth - sourceCropWidth) / 2),
        sourceY: Math.max(0, (sourceHeight - sourceCropHeight) / 2),
        sourceCropWidth,
        sourceCropHeight
    };
}

function buildQualitySteps(minQuality) {
    const min = normalizeMinQuality(minQuality);
    const steps = JPEG_QUALITIES.filter(quality => quality >= min);
    if (!steps.includes(min)) {
        steps.push(min);
    }
    return Array.from(new Set(steps)).sort((a, b) => b - a);
}

function encodeJpegWithinLimit(canvas, options = {}) {
    const maxBytes = normalizeMaxBytes(options.maxOutputBytes);
    const minQuality = normalizeMinQuality(options.minQuality);
    let last = null;

    for (const quality of buildQualitySteps(minQuality)) {
        const buffer = canvas.toBuffer('image/jpeg', {
            quality: quality / 100,
            progressive: false,
            chromaSubsampling: true
        });
        last = { buffer, quality, bytes: buffer.length };
        if (buffer.length <= maxBytes) {
            return {
                ...last,
                withinLimit: true
            };
        }
    }

    return {
        ...(last || { buffer: Buffer.alloc(0), quality: minQuality, bytes: 0 }),
        withinLimit: false
    };
}

async function standardizeImageToTarget(sourcePath, outputPath, targetSize, options = {}) {
    const target = DELIVERY_TARGET_DIMENSIONS[targetSize];
    if (!target) {
        throw new Error(`不支持的目标尺寸：${targetSize}`);
    }
    if (!sourcePath || !fs.existsSync(sourcePath)) {
        throw new Error(`候选图不存在：${sourcePath || ''}`);
    }

    const dimensions = readImageDimensions(sourcePath);
    if (!dimensions) {
        throw new Error('无法读取候选图尺寸');
    }

    ensureDir(path.dirname(outputPath));
    const image = await loadImage(fs.readFileSync(sourcePath));
    const canvas = createCanvas(target.width, target.height);
    const ctx = canvas.getContext('2d');
    const transform = calculateCoverTransform(dimensions.width, dimensions.height, target.width, target.height);

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, target.width, target.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(
        image,
        transform.sourceX,
        transform.sourceY,
        transform.sourceCropWidth,
        transform.sourceCropHeight,
        0,
        0,
        target.width,
        target.height
    );

    const encoded = encodeJpegWithinLimit(canvas, options);
    if (!encoded.withinLimit) {
        throw new Error(`压缩到最低质量 ${normalizeMinQuality(options.minQuality)} 后仍超过 ${Math.round(normalizeMaxBytes(options.maxOutputBytes) / 1024)}KB`);
    }

    fs.writeFileSync(outputPath, encoded.buffer);
    const savedDimensions = readImageDimensions(outputPath);
    if (!savedDimensions || savedDimensions.width !== target.width || savedDimensions.height !== target.height) {
        throw new Error(`标准化后尺寸不匹配，应为 ${targetSize}`);
    }

    return {
        outputPath,
        targetSize,
        width: target.width,
        height: target.height,
        quality: encoded.quality,
        sizeBytes: encoded.bytes,
        sizeKb: Math.round(encoded.bytes / 1024),
        maxOutputKb: Math.round(normalizeMaxBytes(options.maxOutputBytes) / 1024),
        minQuality: normalizeMinQuality(options.minQuality),
        sourceDimensions: dimensions.text,
        outputDimensions: `${target.width}x${target.height}`
    };
}

function buildOrdinalSuffix(candidateIndex, candidateCount) {
    const count = Number(candidateCount) || 0;
    const index = Number(candidateIndex) || 0;
    return count > 1 && index > 0 ? `_${index}` : '';
}

function buildStandardizedOutputPath({ outputFolder, runId, folderName, baseName, targetSize, candidateIndex = 1, candidateCount = 1 }) {
    const safeFolderName = sanitizeFileNamePart(folderName || baseName || 'delivery-job', 'delivery-job');
    const safeBaseName = sanitizeFileNamePart(baseName || safeFolderName, 'image');
    return path.join(outputFolder, runId, 'stage-final', safeFolderName, `${safeBaseName}_${targetSize}${buildOrdinalSuffix(candidateIndex, candidateCount)}.jpg`);
}

module.exports = {
    DELIVERY_TARGET_DIMENSIONS,
    DEFAULT_MAX_OUTPUT_BYTES,
    DEFAULT_MAX_OUTPUT_KB,
    DEFAULT_MIN_JPEG_QUALITY,
    standardizeImageToTarget,
    buildStandardizedOutputPath,
    buildOrdinalSuffix
};
