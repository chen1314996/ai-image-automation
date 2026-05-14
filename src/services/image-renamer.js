const fs = require('fs');
const path = require('path');

const { sortNaturallyByName } = require('../../file-utils');

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
const DEFAULT_RENAME_PREFIX = 'GOFCNIM28930_BJ_广点通_题材_载具';
const DEFAULT_FIXED_PREFIX = 'GOFCNIM';
const MAX_BASE_NAME_LENGTH = 180;
const CJK_RE = /[\u3400-\u9fff\uf900-\ufaff]/u;

function normalizeInputPath(value) {
    if (typeof value !== 'string') {
        return '';
    }
    return value.replace(/["']/g, '').trim().replace(/\\/g, '/');
}

function sanitizeFileNamePart(value, fallback = '') {
    const text = String(value || '').trim();
    if (!text) {
        return fallback;
    }

    const safe = text
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
        .replace(/\s+/g, '_')
        .replace(/_+/g, '_')
        .replace(/[. ]+$/g, '')
        .replace(/^_+|_+$/g, '');

    return safe || fallback;
}

function trimBaseName(baseName, reserveLength = 0) {
    const maxLength = Math.max(20, MAX_BASE_NAME_LENGTH - reserveLength);
    const safeBase = sanitizeFileNamePart(baseName, 'image');
    if (safeBase.length <= maxLength) {
        return safeBase;
    }
    return safeBase.slice(0, maxLength).replace(/[._ -]+$/g, '') || 'image';
}

function extractChineseNamePart(fileName) {
    const stem = path.parse(String(fileName || '')).name;
    const candidates = stem
        .split(/[_\s]+/)
        .map(part => sanitizeFileNamePart(part))
        .filter(part => part && CJK_RE.test(part));

    if (candidates.length === 0) {
        return '';
    }

    return candidates.reduce((longest, part) => {
        if (part.length > longest.length) {
            return part;
        }
        return longest;
    }, '');
}

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

function getUniqueOutputName(outputFolder, baseName, ext, usedNames) {
    let counter = 1;
    let outputName = `${trimBaseName(baseName)}${ext}`;

    while (
        usedNames.has(outputName.toLowerCase()) ||
        fs.existsSync(path.join(outputFolder, outputName))
    ) {
        counter += 1;
        const suffix = `_${String(counter).padStart(2, '0')}`;
        outputName = `${trimBaseName(baseName, suffix.length)}${suffix}${ext}`;
    }

    usedNames.add(outputName.toLowerCase());
    return outputName;
}

function readPngDimensions(buffer) {
    if (
        buffer.length >= 24 &&
        buffer[0] === 0x89 &&
        buffer.toString('ascii', 1, 4) === 'PNG'
    ) {
        return {
            width: buffer.readUInt32BE(16),
            height: buffer.readUInt32BE(20)
        };
    }
    return null;
}

function readGifDimensions(buffer) {
    if (buffer.length >= 10 && buffer.toString('ascii', 0, 3) === 'GIF') {
        return {
            width: buffer.readUInt16LE(6),
            height: buffer.readUInt16LE(8)
        };
    }
    return null;
}

function readBmpDimensions(buffer) {
    if (buffer.length >= 26 && buffer.toString('ascii', 0, 2) === 'BM') {
        return {
            width: Math.abs(buffer.readInt32LE(18)),
            height: Math.abs(buffer.readInt32LE(22))
        };
    }
    return null;
}

function readJpegDimensions(buffer) {
    if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
        return null;
    }

    let offset = 2;
    const startOfFrameMarkers = new Set([
        0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
        0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf
    ]);

    while (offset < buffer.length - 1) {
        if (buffer[offset] !== 0xff) {
            offset += 1;
            continue;
        }

        while (buffer[offset] === 0xff) {
            offset += 1;
        }

        const marker = buffer[offset];
        offset += 1;

        if (marker === 0xd9 || marker === 0xda) {
            break;
        }

        if (offset + 2 > buffer.length) {
            break;
        }

        const segmentLength = buffer.readUInt16BE(offset);
        if (segmentLength < 2 || offset + segmentLength > buffer.length) {
            break;
        }

        if (startOfFrameMarkers.has(marker) && segmentLength >= 7) {
            return {
                width: buffer.readUInt16BE(offset + 5),
                height: buffer.readUInt16BE(offset + 3)
            };
        }

        offset += segmentLength;
    }

    return null;
}

function readWebpDimensions(buffer) {
    if (
        buffer.length < 30 ||
        buffer.toString('ascii', 0, 4) !== 'RIFF' ||
        buffer.toString('ascii', 8, 12) !== 'WEBP'
    ) {
        return null;
    }

    const chunkType = buffer.toString('ascii', 12, 16);
    if (chunkType === 'VP8X' && buffer.length >= 30) {
        const width = 1 + buffer.readUIntLE(24, 3);
        const height = 1 + buffer.readUIntLE(27, 3);
        return { width, height };
    }

    if (chunkType === 'VP8L' && buffer.length >= 25 && buffer[20] === 0x2f) {
        const b1 = buffer[21];
        const b2 = buffer[22];
        const b3 = buffer[23];
        const b4 = buffer[24];
        const width = 1 + (((b2 & 0x3f) << 8) | b1);
        const height = 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6));
        return { width, height };
    }

    if (chunkType === 'VP8 ' && buffer.length >= 30) {
        return {
            width: buffer.readUInt16LE(26) & 0x3fff,
            height: buffer.readUInt16LE(28) & 0x3fff
        };
    }

    return null;
}

function readImageDimensions(filePath) {
    const buffer = fs.readFileSync(filePath);
    const dimensions =
        readPngDimensions(buffer) ||
        readJpegDimensions(buffer) ||
        readGifDimensions(buffer) ||
        readBmpDimensions(buffer) ||
        readWebpDimensions(buffer);

    if (!dimensions || !dimensions.width || !dimensions.height) {
        return null;
    }

    return {
        width: dimensions.width,
        height: dimensions.height,
        text: `${dimensions.width}x${dimensions.height}`
    };
}

function parseStartNumber(value) {
    const raw = String(value ?? '').trim();
    if (!/^\d+$/.test(raw)) {
        throw new Error('请输入有效的起始编号');
    }

    const numberValue = Number(raw);
    if (!Number.isSafeInteger(numberValue) || numberValue < 0) {
        throw new Error('起始编号超出可用范围');
    }

    return {
        value: numberValue,
        width: raw.length
    };
}

function formatSequenceNumber(startNumber, index) {
    const nextValue = startNumber.value + index;
    const text = String(nextValue);
    return startNumber.width > text.length ? text.padStart(startNumber.width, '0') : text;
}

function normalizeRenameRule(options = {}) {
    const hasSegmentedRule = ['startNumber', 'regionText', 'channelText', 'primaryTag', 'secondaryTag']
        .some(key => options[key] !== undefined && options[key] !== null);

    if (!hasSegmentedRule) {
        return {
            mode: 'legacy',
            prefix: trimBaseName(options.prefix || DEFAULT_RENAME_PREFIX)
        };
    }

    const fixedPrefixSource = options.fixedPrefix === undefined || options.fixedPrefix === null
        ? DEFAULT_FIXED_PREFIX
        : options.fixedPrefix;
    const fixedPrefix = sanitizeFileNamePart(fixedPrefixSource, '');
    const startNumber = parseStartNumber(options.startNumber);
    const regionText = sanitizeFileNamePart(options.regionText, '');
    const channelText = sanitizeFileNamePart(options.channelText, '');
    const primaryTag = sanitizeFileNamePart(options.primaryTag, '');
    const secondaryTag = sanitizeFileNamePart(options.secondaryTag, '');

    if (!fixedPrefix) {
        throw new Error('请输入固定前缀');
    }
    if (!regionText) {
        throw new Error('请输入区域/代号文本');
    }
    if (!channelText) {
        throw new Error('请输入渠道文本');
    }
    if (!primaryTag) {
        throw new Error('请选择一级标签');
    }
    if (!secondaryTag) {
        throw new Error('请选择二级标签');
    }

    return {
        mode: 'segmented',
        fixedPrefix,
        startNumber,
        startNumberText: formatSequenceNumber(startNumber, 0),
        regionText,
        channelText,
        primaryTag,
        secondaryTag
    };
}

function buildOutputBaseName(rule, index, chinesePart, dimensionText = '') {
    if (rule.mode === 'legacy') {
        return [rule.prefix, chinesePart, dimensionText].filter(Boolean).join('_');
    }

    const sequenceToken = `${rule.fixedPrefix}${formatSequenceNumber(rule.startNumber, index)}`;
    return [
        sequenceToken,
        rule.regionText,
        rule.channelText,
        rule.primaryTag,
        rule.secondaryTag,
        chinesePart,
        dimensionText
    ].filter(Boolean).join('_');
}

function buildRenamePlan(options = {}) {
    const inputFolder = normalizeInputPath(options.inputFolder);
    const outputFolder = normalizeInputPath(options.outputFolder);
    const rule = normalizeRenameRule(options);

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

    const files = sortNaturallyByName(fs.readdirSync(inputFolder));
    const imageFiles = files.filter(file => IMAGE_EXTENSIONS.includes(path.extname(file).toLowerCase()));
    const usedNames = new Set();
    const items = [];
    const skipped = [];

    imageFiles.forEach((file, index) => {
        const sourcePath = path.join(inputFolder, file);
        const chinesePart = extractChineseNamePart(file);
        const dimensions = readImageDimensions(sourcePath);
        const ext = path.extname(file);
        const outputBaseName = buildOutputBaseName(rule, index, chinesePart, dimensions ? dimensions.text : '');
        const outputName = getUniqueOutputName(outputFolder, outputBaseName, ext, usedNames);

        items.push({
            originalName: file,
            outputName,
            chinesePart,
            dimensions: dimensions ? dimensions.text : '',
            sequenceNumber: rule.mode === 'segmented' ? formatSequenceNumber(rule.startNumber, index) : '',
            sourcePath,
            outputPath: path.join(outputFolder, outputName)
        });
    });

    return {
        inputFolder,
        outputFolder,
        prefix: rule.mode === 'legacy' ? rule.prefix : '',
        rule: {
            ...rule,
            startNumber: undefined
        },
        totalImages: imageFiles.length,
        readyCount: items.length,
        skippedCount: skipped.length,
        items,
        skipped,
        outputFolderExists: fs.existsSync(outputFolder)
    };
}

function renameImages(options = {}) {
    const plan = buildRenamePlan(options);
    fs.mkdirSync(plan.outputFolder, { recursive: true });

    const copied = [];
    const failed = [];

    plan.items.forEach(item => {
        try {
            fs.copyFileSync(item.sourcePath, item.outputPath);
            copied.push(item);
        } catch (error) {
            failed.push({
                ...item,
                reason: error.message
            });
        }
    });

    return {
        ...plan,
        copied,
        failed,
        copiedCount: copied.length,
        failedCount: failed.length
    };
}

module.exports = {
    IMAGE_EXTENSIONS,
    DEFAULT_RENAME_PREFIX,
    DEFAULT_FIXED_PREFIX,
    buildRenamePlan,
    extractChineseNamePart,
    getUniqueOutputName,
    normalizeInputPath,
    readImageDimensions,
    renameImages,
    sanitizeFileNamePart,
    trimBaseName
};
