const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const IMAGE_TARGET_RE = /\.(png|jpe?g|webp|gif|bmp)$/i;

function hashId(prefix, values) {
    const hash = crypto
        .createHash('sha1')
        .update(values.filter(Boolean).join('|'))
        .digest('hex')
        .slice(0, 12);
    return `${prefix}_${hash}`;
}

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

function sanitizeFileNamePart(value) {
    return String(value || '')
        .trim()
        .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
        .replace(/\s+/g, '_')
        .slice(0, 80) || 'item';
}

function findEndOfCentralDirectory(buffer) {
    const minOffset = Math.max(0, buffer.length - 0xFFFF - 22);
    for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
        if (buffer.readUInt32LE(offset) === 0x06054b50) {
            return offset;
        }
    }
    throw new Error('Invalid xlsx zip: missing central directory');
}

function readZipEntries(filePath) {
    const buffer = fs.readFileSync(filePath);
    const eocdOffset = findEndOfCentralDirectory(buffer);
    const entryCount = buffer.readUInt16LE(eocdOffset + 10);
    const centralDirOffset = buffer.readUInt32LE(eocdOffset + 16);
    const entries = new Map();
    let offset = centralDirOffset;

    for (let index = 0; index < entryCount; index += 1) {
        if (buffer.readUInt32LE(offset) !== 0x02014b50) {
            throw new Error('Invalid xlsx zip: bad central directory entry');
        }

        const compression = buffer.readUInt16LE(offset + 10);
        const compressedSize = buffer.readUInt32LE(offset + 20);
        const fileNameLength = buffer.readUInt16LE(offset + 28);
        const extraLength = buffer.readUInt16LE(offset + 30);
        const commentLength = buffer.readUInt16LE(offset + 32);
        const localHeaderOffset = buffer.readUInt32LE(offset + 42);
        const fileName = buffer
            .subarray(offset + 46, offset + 46 + fileNameLength)
            .toString('utf8');

        if (buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
            throw new Error(`Invalid xlsx zip: bad local header for ${fileName}`);
        }

        const localFileNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
        const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
        const dataOffset = localHeaderOffset + 30 + localFileNameLength + localExtraLength;
        const compressed = buffer.subarray(dataOffset, dataOffset + compressedSize);
        let data;

        if (compression === 0) {
            data = Buffer.from(compressed);
        } else if (compression === 8) {
            data = zlib.inflateRawSync(compressed);
        } else {
            throw new Error(`Unsupported xlsx zip compression ${compression} for ${fileName}`);
        }

        entries.set(fileName.replace(/\\/g, '/'), data);
        offset += 46 + fileNameLength + extraLength + commentLength;
    }

    return entries;
}

function parseAttributes(xmlTag) {
    const attrs = {};
    String(xmlTag || '').replace(/([\w:.-]+)="([^"]*)"/g, (_, key, value) => {
        attrs[key] = value;
        return '';
    });
    return attrs;
}

function parseRelationships(xml) {
    const rels = new Map();
    String(xml || '').replace(/<Relationship\b[^>]*\/?>/g, tag => {
        const attrs = parseAttributes(tag);
        if (attrs.Id && attrs.Target) {
            rels.set(attrs.Id, attrs.Target);
        }
        return '';
    });
    return rels;
}

function resolveZipPath(basePath, target) {
    if (!target) return '';
    if (target.startsWith('/')) return target.replace(/^\/+/, '');
    return path.posix.normalize(path.posix.join(path.posix.dirname(basePath), target));
}

function parseDrawingAnchors(xml) {
    const anchors = [];
    const text = String(xml || '');
    const anchorRe = /<xdr:(?:twoCellAnchor|oneCellAnchor)\b[\s\S]*?<\/xdr:(?:twoCellAnchor|oneCellAnchor)>/g;
    let match;

    while ((match = anchorRe.exec(text))) {
        const anchor = match[0];
        const fromMatch = anchor.match(/<xdr:from>[\s\S]*?<xdr:col>(\d+)<\/xdr:col>[\s\S]*?<xdr:row>(\d+)<\/xdr:row>[\s\S]*?<\/xdr:from>/);
        const embedMatch = anchor.match(/r:embed="([^"]+)"/);
        if (!fromMatch || !embedMatch) continue;

        const nameTag = anchor.match(/<xdr:cNvPr\b[^>]*>/);
        const attrs = nameTag ? parseAttributes(nameTag[0]) : {};
        anchors.push({
            col: Number(fromMatch[1]),
            row: Number(fromMatch[2]),
            relId: embedMatch[1],
            name: attrs.name || '',
            description: attrs.descr || ''
        });
    }

    return anchors;
}

function getContentType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
    if (ext === '.png') return 'image/png';
    if (ext === '.webp') return 'image/webp';
    if (ext === '.gif') return 'image/gif';
    if (ext === '.bmp') return 'image/bmp';
    return 'application/octet-stream';
}

function extractWorkbookReferenceImages(options = {}) {
    const workbookPath = options.workbookPath || '';
    const directions = Array.isArray(options.directions) ? options.directions : [];
    const outputDir = options.outputDir || '';
    const warnings = [];

    if (!workbookPath || !fs.existsSync(workbookPath)) {
        return {
            images: [],
            warnings: [`Direction workbook not found: ${workbookPath || '(empty)'}`],
            metadata: {
                sourceFile: workbookPath,
                imageCount: 0
            }
        };
    }

    if (!outputDir) {
        throw new Error('Missing outputDir for workbook reference image extraction');
    }

    const directionByRow = new Map();
    directions.forEach(direction => {
        if (direction && Number(direction.rowNumber)) {
            directionByRow.set(Number(direction.rowNumber), direction);
        }
    });

    const entries = readZipEntries(workbookPath);
    const drawingPaths = Array.from(entries.keys())
        .filter(name => /^xl\/drawings\/drawing\d+\.xml$/i.test(name))
        .sort((a, b) => a.localeCompare(b));
    const images = [];
    ensureDir(outputDir);

    drawingPaths.forEach(drawingPath => {
        const relPath = path.posix.join(path.posix.dirname(drawingPath), '_rels', `${path.posix.basename(drawingPath)}.rels`);
        const rels = parseRelationships(entries.get(relPath)?.toString('utf8') || '');
        const anchors = parseDrawingAnchors(entries.get(drawingPath)?.toString('utf8') || '');

        anchors.forEach(anchor => {
            const excelRow = anchor.row + 1;
            const excelCol = anchor.col + 1;
            const direction = directionByRow.get(excelRow);
            const target = rels.get(anchor.relId);
            const mediaPath = resolveZipPath(drawingPath, target);
            const media = entries.get(mediaPath);

            if (!direction || !target || !IMAGE_TARGET_RE.test(mediaPath) || !media) {
                return;
            }

            const ext = path.extname(mediaPath).toLowerCase() || '.jpg';
            const slot = Math.max(1, excelCol - 5);
            const id = hashId('ref', [
                workbookPath,
                direction.id,
                String(excelRow),
                String(excelCol),
                mediaPath
            ]);
            const fileName = `${sanitizeFileNamePart(direction.id)}_${String(slot).padStart(2, '0')}_${id}${ext}`;
            const directionDir = path.join(outputDir, sanitizeFileNamePart(direction.id));
            const filePath = path.join(directionDir, fileName);
            ensureDir(directionDir);
            fs.writeFileSync(filePath, media);
            const stats = fs.statSync(filePath);

            images.push({
                id,
                filePath,
                fileName,
                relativePath: path.relative(outputDir, filePath),
                extension: ext,
                size: stats.size,
                updatedAt: stats.mtime.toISOString(),
                directionId: direction.id,
                directionPath: direction.path || '',
                directionName: direction.name || '',
                matchedDirectionIds: [direction.id],
                source: 'workbook-embedded',
                sourceFile: workbookPath,
                sourceSheetRow: excelRow,
                sourceSheetColumn: excelCol,
                sourceSlot: slot,
                sourceMediaPath: mediaPath,
                contentType: getContentType(filePath),
                name: anchor.name || '',
                description: anchor.description || ''
            });
        });
    });

    return {
        images,
        warnings,
        metadata: {
            sourceFile: workbookPath,
            outputDir,
            drawingCount: drawingPaths.length,
            imageCount: images.length
        }
    };
}

module.exports = {
    extractWorkbookReferenceImages,
    getContentType,
    readZipEntries
};
