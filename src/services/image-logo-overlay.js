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

const DEFAULT_LOGO_FILE_NAME = '1-国内LOGO模板-800x800.png';
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

function normalizeLogoFileName(value) {
    const raw = String(value || '').replace(/["']/g, '').trim();
    if (!raw) {
        throw new Error('请输入LOGO文件名称');
    }

    const fileName = path.basename(raw.replace(/\\/g, '/'));
    const ext = path.extname(fileName).toLowerCase();
    if (ext && ext !== '.png') {
        throw new Error('LOGO文件必须是PNG格式');
    }

    return {
        raw: fileName,
        candidates: ext ? [fileName] : [`${fileName}.png`, fileName]
    };
}

function resolveLogoFile(inputFolder, logoFileName) {
    const normalized = normalizeLogoFileName(logoFileName || DEFAULT_LOGO_FILE_NAME);
    const matchedName = normalized.candidates.find(candidate => {
        const fullPath = path.join(inputFolder, candidate);
        return fs.existsSync(fullPath) && fs.statSync(fullPath).isFile();
    });

    if (!matchedName) {
        throw new Error('未找到LOGO文件，请检查待处理图片目录和LOGO文件名称');
    }

    if (path.extname(matchedName).toLowerCase() !== '.png') {
        throw new Error('LOGO文件必须是PNG格式');
    }

    const logoPath = path.join(inputFolder, matchedName);
    const dimensions = readImageDimensions(logoPath);
    if (!dimensions) {
        throw new Error('LOGO尺寸读取失败');
    }

    return {
        fileName: matchedName,
        path: logoPath,
        dimensions
    };
}

function getUniqueJpgOutputName(outputFolder, baseName, usedNames) {
    let counter = 1;
    let outputName = `${trimBaseName(baseName)}${JPEG_EXTENSION}`;

    while (
        usedNames.has(outputName.toLowerCase()) ||
        fs.existsSync(path.join(outputFolder, outputName))
    ) {
        counter += 1;
        const suffix = `_${String(counter).padStart(2, '0')}`;
        outputName = `${trimBaseName(baseName, suffix.length)}${suffix}${JPEG_EXTENSION}`;
    }

    usedNames.add(outputName.toLowerCase());
    return outputName;
}

function normalizeLogoOverlayOptions(options = {}) {
    const inputFolder = normalizeInputPath(options.inputFolder);
    const outputFolder = normalizeInputPath(options.outputFolder);

    assertDirectory(inputFolder, '待处理图片目录');

    if (!outputFolder) {
        throw new Error('请输入输出目录');
    }

    if (fs.existsSync(outputFolder) && !fs.statSync(outputFolder).isDirectory()) {
        throw new Error('输出路径不是文件夹');
    }

    if (path.resolve(inputFolder).toLowerCase() === path.resolve(outputFolder).toLowerCase()) {
        throw new Error('待处理图片目录和输出目录不能相同');
    }

    return {
        inputFolder,
        outputFolder,
        logo: resolveLogoFile(inputFolder, options.logoFileName)
    };
}

function buildLogoOverlayPlan(options = {}) {
    const { inputFolder, outputFolder, logo } = normalizeLogoOverlayOptions(options);
    const files = sortNaturallyByName(fs.readdirSync(inputFolder));
    const imageFiles = files.filter(file => IMAGE_EXTENSIONS.includes(path.extname(file).toLowerCase()));
    const logoPathKey = path.resolve(logo.path).toLowerCase();
    const usedNames = new Set();
    const items = [];
    const skipped = [];

    imageFiles.forEach(file => {
        const sourcePath = path.join(inputFolder, file);
        if (path.resolve(sourcePath).toLowerCase() === logoPathKey) {
            return;
        }

        try {
            const dimensions = readImageDimensions(sourcePath);
            if (!dimensions) {
                skipped.push({
                    originalName: file,
                    reason: '无法读取图片尺寸'
                });
                return;
            }

            if (
                dimensions.width !== logo.dimensions.width ||
                dimensions.height !== logo.dimensions.height
            ) {
                skipped.push({
                    originalName: file,
                    originalDimensions: dimensions.text,
                    logoDimensions: logo.dimensions.text,
                    reason: '图片尺寸与LOGO尺寸不一致'
                });
                return;
            }

            const outputBaseName = sanitizeFileNamePart(path.parse(file).name, 'image');
            const outputName = getUniqueJpgOutputName(outputFolder, outputBaseName, usedNames);

            items.push({
                originalName: file,
                outputName,
                originalDimensions: dimensions.text,
                logoDimensions: logo.dimensions.text,
                logoFileName: logo.fileName,
                sourcePath,
                outputPath: path.join(outputFolder, outputName)
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
        logoFileName: logo.fileName,
        logoPath: logo.path,
        logoDimensions: logo.dimensions.text,
        maxOutputKb: MAX_OUTPUT_KB,
        minQuality: Math.round(MIN_JPEG_QUALITY * 100),
        outputExtension: JPEG_EXTENSION,
        totalImages: Math.max(0, imageFiles.length - 1),
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

async function renderLogoOverlayJpeg(item, logoImage) {
    const baseImage = await loadImage(fs.readFileSync(item.sourcePath));
    const [width, height] = item.originalDimensions.split('x').map(Number);
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(baseImage, 0, 0, width, height);
    ctx.drawImage(logoImage, 0, 0, width, height);

    return encodeJpegWithinLimit(canvas);
}

async function applyLogoOverlay(options = {}) {
    const plan = buildLogoOverlayPlan(options);
    fs.mkdirSync(plan.outputFolder, { recursive: true });

    const logoImage = await loadImage(fs.readFileSync(plan.logoPath));
    const applied = [];
    const failed = [];

    for (const item of plan.items) {
        try {
            const encoded = await renderLogoOverlayJpeg(item, logoImage);
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
            applied.push({
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
        applied,
        failed,
        appliedCount: applied.length,
        failedCount: failed.length
    };
}

module.exports = {
    DEFAULT_LOGO_FILE_NAME,
    applyLogoOverlay,
    buildLogoOverlayPlan,
    resolveLogoFile
};
