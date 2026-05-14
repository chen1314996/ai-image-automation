const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('canvas');

const { sortNaturallyByName } = require('../../file-utils');
const {
    IMAGE_EXTENSIONS,
    normalizeInputPath,
    readImageDimensions,
    sanitizeFileNamePart,
    trimBaseName
} = require('./image-renamer');

const RESIZE_TARGETS = [
    { text: '800x800', width: 800, height: 800 },
    { text: '1080x1920', width: 1080, height: 1920 },
    { text: '1280x720', width: 1280, height: 720 }
];
const DEFAULT_RESIZE_TARGET = RESIZE_TARGETS[0];
const JPEG_EXTENSION = '.jpg';
const MAX_OUTPUT_BYTES = 390 * 1024;
const MAX_OUTPUT_KB = 390;
const JPEG_QUALITIES = [0.92, 0.88, 0.84, 0.8, 0.76, 0.72, 0.68, 0.64, 0.6];
const MIN_JPEG_QUALITY = 0.6;

function assertDirectory(folderPath, label) {
    if (!folderPath) {
        throw new Error(`请输入${label}`);
    }
    if (!fs.existsSync(folderPath)) {
        throw new Error(`${label}不存在，请检查路径是否正确`);
    }
    if (!fs.statSync(folderPath).isDirectory()) {
        throw new Error(`${label}不是文件夹`);
    }
}

function parseResizeTarget(value) {
    const text = String(value || DEFAULT_RESIZE_TARGET.text).trim().toLowerCase();
    const target = RESIZE_TARGETS.find(item => item.text === text);

    if (!target) {
        throw new Error('请选择有效的目标尺寸');
    }

    return target;
}

function replaceOrAppendDimensionSuffix(fileName, targetText) {
    const stem = sanitizeFileNamePart(path.parse(String(fileName || '')).name, 'image');
    const withoutTrailingDimension = stem.replace(/(?:[_\-\s])?\d{2,5}x\d{2,5}$/i, '');
    const baseName = withoutTrailingDimension || 'image';

    return `${baseName}_${targetText}`;
}

function getUniqueResizeOutputName(outputFolder, baseName, targetText, usedNames) {
    const targetSuffix = `_${targetText}`;
    const safeBaseName = trimBaseName(baseName);
    const prefix = safeBaseName.endsWith(targetSuffix)
        ? safeBaseName.slice(0, -targetSuffix.length)
        : safeBaseName;
    let counter = 1;
    let outputName = `${safeBaseName}${JPEG_EXTENSION}`;

    while (
        usedNames.has(outputName.toLowerCase()) ||
        fs.existsSync(path.join(outputFolder, outputName))
    ) {
        counter += 1;
        const uniqueSuffix = `_${String(counter).padStart(2, '0')}`;
        const uniquePrefix = trimBaseName(prefix, uniqueSuffix.length + targetSuffix.length);
        outputName = `${uniquePrefix}${uniqueSuffix}${targetSuffix}${JPEG_EXTENSION}`;
    }

    usedNames.add(outputName.toLowerCase());
    return outputName;
}

function calculateCoverTransform(sourceWidth, sourceHeight, targetWidth, targetHeight) {
    const scale = Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight);
    const scaledWidth = Math.round(sourceWidth * scale);
    const scaledHeight = Math.round(sourceHeight * scale);
    const overflowWidth = Math.max(0, scaledWidth - targetWidth);
    const overflowHeight = Math.max(0, scaledHeight - targetHeight);
    const sourceCropWidth = targetWidth / scale;
    const sourceCropHeight = targetHeight / scale;
    const sourceX = Math.max(0, (sourceWidth - sourceCropWidth) / 2);
    const sourceY = Math.max(0, (sourceHeight - sourceCropHeight) / 2);

    let cropSummary = `等比缩放至 ${scaledWidth}x${scaledHeight}`;
    if (overflowWidth > 0 || overflowHeight > 0) {
        const parts = [];
        if (overflowWidth > 0) parts.push(`宽度 ${overflowWidth}px`);
        if (overflowHeight > 0) parts.push(`高度 ${overflowHeight}px`);
        cropSummary += `，居中裁剪${parts.join('、')}`;
    }

    return {
        scale,
        scaleText: `${(scale * 100).toFixed(1)}%`,
        scaledWidth,
        scaledHeight,
        sourceX,
        sourceY,
        sourceCropWidth,
        sourceCropHeight,
        cropSummary
    };
}

function normalizeResizeOptions(options = {}) {
    const inputFolder = normalizeInputPath(options.inputFolder);
    const outputFolder = normalizeInputPath(options.outputFolder);
    const target = parseResizeTarget(options.targetSize);

    assertDirectory(inputFolder, '输入文件夹');

    if (!outputFolder) {
        throw new Error('请输入输出文件夹');
    }

    if (fs.existsSync(outputFolder) && !fs.statSync(outputFolder).isDirectory()) {
        throw new Error('输出路径不是文件夹');
    }

    if (path.resolve(inputFolder).toLowerCase() === path.resolve(outputFolder).toLowerCase()) {
        throw new Error('输入文件夹和输出文件夹不能相同');
    }

    return {
        inputFolder,
        outputFolder,
        target
    };
}

function buildResizePlan(options = {}) {
    const { inputFolder, outputFolder, target } = normalizeResizeOptions(options);
    const files = sortNaturallyByName(fs.readdirSync(inputFolder));
    const imageFiles = files.filter(file => IMAGE_EXTENSIONS.includes(path.extname(file).toLowerCase()));
    const usedNames = new Set();
    const items = [];
    const skipped = [];

    imageFiles.forEach(file => {
        const sourcePath = path.join(inputFolder, file);

        try {
            const dimensions = readImageDimensions(sourcePath);
            if (!dimensions) {
                skipped.push({
                    originalName: file,
                    reason: '无法读取图片尺寸'
                });
                return;
            }

            const transform = calculateCoverTransform(
                dimensions.width,
                dimensions.height,
                target.width,
                target.height
            );
            const outputBaseName = replaceOrAppendDimensionSuffix(file, target.text);
            const outputName = getUniqueResizeOutputName(outputFolder, outputBaseName, target.text, usedNames);

            items.push({
                originalName: file,
                outputName,
                originalDimensions: dimensions.text,
                targetDimensions: target.text,
                cropSummary: transform.cropSummary,
                scaleText: transform.scaleText,
                sourcePath,
                outputPath: path.join(outputFolder, outputName),
                transform
            });
        } catch (error) {
            skipped.push({
                originalName: file,
                reason: error.message
            });
        }
    });

    return {
        inputFolder,
        outputFolder,
        targetSize: target.text,
        maxOutputKb: MAX_OUTPUT_KB,
        minQuality: Math.round(MIN_JPEG_QUALITY * 100),
        outputExtension: JPEG_EXTENSION,
        totalImages: imageFiles.length,
        readyCount: items.length,
        skippedCount: skipped.length,
        outputFolderExists: fs.existsSync(outputFolder),
        items,
        skipped
    };
}

function encodeJpegWithinLimit(canvas) {
    let lastBuffer = null;
    let lastQuality = MIN_JPEG_QUALITY;

    for (const quality of JPEG_QUALITIES) {
        const buffer = canvas.toBuffer('image/jpeg', {
            quality,
            progressive: false,
            chromaSubsampling: true
        });

        lastBuffer = buffer;
        lastQuality = quality;

        if (buffer.length <= MAX_OUTPUT_BYTES) {
            return {
                buffer,
                quality,
                bytes: buffer.length,
                withinLimit: true
            };
        }
    }

    return {
        buffer: lastBuffer,
        quality: lastQuality,
        bytes: lastBuffer ? lastBuffer.length : 0,
        withinLimit: false
    };
}

async function renderResizedJpeg(item) {
    const image = await loadImage(fs.readFileSync(item.sourcePath));
    const [targetWidth, targetHeight] = item.targetDimensions.split('x').map(Number);
    const canvas = createCanvas(targetWidth, targetHeight);
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, targetWidth, targetHeight);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(
        image,
        item.transform.sourceX,
        item.transform.sourceY,
        item.transform.sourceCropWidth,
        item.transform.sourceCropHeight,
        0,
        0,
        targetWidth,
        targetHeight
    );

    return encodeJpegWithinLimit(canvas);
}

async function resizeImages(options = {}) {
    const plan = buildResizePlan(options);
    fs.mkdirSync(plan.outputFolder, { recursive: true });

    const resized = [];
    const failed = [];

    for (const item of plan.items) {
        try {
            const encoded = await renderResizedJpeg(item);
            if (!encoded.withinLimit) {
                failed.push({
                    ...item,
                    quality: Math.round(encoded.quality * 100),
                    sizeBytes: encoded.bytes,
                    reason: `压缩到 ${Math.round(MIN_JPEG_QUALITY * 100)} 质量后仍超过 ${MAX_OUTPUT_KB}KB`
                });
                continue;
            }

            fs.writeFileSync(item.outputPath, encoded.buffer);
            resized.push({
                ...item,
                quality: Math.round(encoded.quality * 100),
                sizeBytes: encoded.bytes
            });
        } catch (error) {
            failed.push({
                ...item,
                reason: error.message
            });
        }
    }

    return {
        ...plan,
        resized,
        failed,
        resizedCount: resized.length,
        failedCount: failed.length
    };
}

module.exports = {
    RESIZE_TARGETS,
    buildResizePlan,
    calculateCoverTransform,
    replaceOrAppendDimensionSuffix,
    resizeImages
};
