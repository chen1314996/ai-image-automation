const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { normalizeText } = require('./direction-importer');

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp']);

function hashId(prefix, values) {
    const hash = crypto
        .createHash('sha1')
        .update(values.filter(Boolean).join('|'))
        .digest('hex')
        .slice(0, 12);
    return `${prefix}_${hash}`;
}

function normalizeForMatch(value) {
    return normalizeText(value)
        .toLowerCase()
        .replace(/[\\/_\-\s.()[\]{}【】（）]/g, '');
}

function walkImages(dirPath, results = []) {
    if (!fs.existsSync(dirPath)) {
        return results;
    }

    const entries = fs.readdirSync(dirPath, {
        withFileTypes: true
    });

    for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
            walkImages(fullPath, results);
            continue;
        }

        if (entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
            results.push(fullPath);
        }
    }

    return results;
}

function matchDirections(filePath, directions) {
    const normalizedFile = normalizeForMatch(filePath);
    const fileName = path.basename(filePath);
    const matches = [];

    for (const direction of directions || []) {
        const pathParts = String(direction.path || '').split('/').filter(Boolean);
        let score = 0;

        for (const part of pathParts) {
            const normalizedPart = normalizeForMatch(part);
            if (normalizedPart && normalizedFile.includes(normalizedPart)) {
                score += 1;
            }
        }

        for (const hint of direction.referenceHints || []) {
            const normalizedHint = normalizeForMatch(hint);
            if (normalizedHint && normalizedFile.includes(normalizedHint)) {
                score += 2;
            }
        }

        if (score >= 2 || (pathParts.length === 1 && score >= 1)) {
            matches.push({
                directionId: direction.id,
                path: direction.path,
                score
            });
        }
    }

    return matches
        .sort((a, b) => b.score - a.score)
        .slice(0, 20)
        .map(match => match.directionId);
}

function indexReferenceImages(options = {}) {
    const referenceFolder = options.referenceFolder || '';
    const directions = options.directions || [];

    if (!referenceFolder || !fs.existsSync(referenceFolder)) {
        return {
            images: [],
            warnings: [`参考图目录不存在: ${referenceFolder || '未提供'}`],
            metadata: {
                sourceDir: referenceFolder,
                exists: false,
                imageCount: 0
            }
        };
    }

    const imageFiles = walkImages(referenceFolder);
    const images = imageFiles.map(filePath => {
        const stats = fs.statSync(filePath);
        return {
            id: hashId('ref', [filePath, String(stats.size), stats.mtime.toISOString()]),
            filePath,
            fileName: path.basename(filePath),
            relativePath: path.relative(referenceFolder, filePath),
            extension: path.extname(filePath).toLowerCase(),
            size: stats.size,
            updatedAt: stats.mtime.toISOString(),
            matchedDirectionIds: matchDirections(filePath, directions),
            source: 'local-folder'
        };
    });

    return {
        images,
        warnings: [],
        metadata: {
            sourceDir: referenceFolder,
            exists: true,
            imageCount: images.length
        }
    };
}

module.exports = {
    IMAGE_EXTENSIONS,
    indexReferenceImages,
    matchDirections,
    normalizeForMatch
};
