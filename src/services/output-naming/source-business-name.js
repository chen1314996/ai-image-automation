const path = require('path');

const CJK_RE = /[\u3400-\u9fff\uf900-\ufaff]/u;
const DIMENSION_RE = /^\d{2,5}x\d{2,5}(?:[-_].*)?$/i;
const GOFCNIM_RE = /^GOFCNIM\d+$/i;
const VERSION_RE = /^v\d{1,4}$/i;
const DATE_RE = /^\d{8}$/;
const TIME_RE = /^\d{6}$/;
const SEQUENCE_RE = /^\d{4,}$/;

const KNOWN_PRIMARY_TAGS = new Set([
    '题材',
    '玩法',
    '角色',
    '角色展示',
    '趣味',
    '包装形式',
    '节日',
    'TOP迭代'
]);

function sanitizeNamePart(value, maxLength = 80) {
    const text = String(value || '').trim();
    if (!text) {
        return '';
    }

    const safe = text
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
        .replace(/\s+/g, '_')
        .replace(/_+/g, '_')
        .replace(/[. ]+$/g, '')
        .replace(/^_+|_+$/g, '');

    if (!safe) {
        return '';
    }

    const limit = Number(maxLength);
    if (!Number.isFinite(limit) || limit <= 0 || safe.length <= limit) {
        return safe;
    }
    return safe.slice(0, Math.floor(limit)).replace(/_+$/g, '');
}

function splitStem(fileName) {
    return path.parse(String(fileName || '')).name
        .split(/_+/)
        .map(part => sanitizeNamePart(part))
        .filter(Boolean);
}

function cleanBusinessParts(parts) {
    const cleaned = (Array.isArray(parts) ? parts : [])
        .map(part => sanitizeNamePart(part))
        .filter(Boolean)
        .filter(part => !DIMENSION_RE.test(part))
        .filter(part => !VERSION_RE.test(part));

    while (cleaned.length >= 2 && DATE_RE.test(cleaned[cleaned.length - 2]) && TIME_RE.test(cleaned[cleaned.length - 1])) {
        cleaned.splice(cleaned.length - 2, 2);
    }

    return cleaned;
}

function buildResult(parts, sourceType, details = {}) {
    const businessParts = cleanBusinessParts(parts);
    const businessName = businessParts.join('_');
    if (!businessName) {
        return null;
    }

    return {
        sourceType,
        businessParts,
        businessName,
        primaryTag: businessParts[0] || '',
        secondaryTag: businessParts[1] || '',
        tertiaryTag: businessParts[2] || '',
        contentTitle: businessParts.slice(3).join('_'),
        ...details
    };
}

function parseGeneratedLegilName(fileName) {
    const parts = splitStem(fileName);
    if (parts.length < 5) {
        return null;
    }

    const last = parts[parts.length - 1];
    const secondLast = parts[parts.length - 2];
    const thirdLast = parts[parts.length - 3];
    const hasGeneratedSuffix = TIME_RE.test(last) && DATE_RE.test(secondLast) && VERSION_RE.test(thirdLast);
    if (!hasGeneratedSuffix) {
        return null;
    }

    const coreParts = parts.slice(0, -3);
    const sequenceCandidates = [];
    coreParts.forEach((part, index) => {
        if (SEQUENCE_RE.test(part) && index < coreParts.length - 1) {
            sequenceCandidates.push(index);
        }
    });

    if (!sequenceCandidates.length) {
        return null;
    }

    const preferred = sequenceCandidates.find(index => {
        const next = coreParts[index + 1] || '';
        return CJK_RE.test(next) || KNOWN_PRIMARY_TAGS.has(next);
    });
    const sequenceIndex = preferred === undefined
        ? [...sequenceCandidates].reverse().find(index => coreParts.slice(index + 1).some(part => CJK_RE.test(part)))
        : preferred;

    if (sequenceIndex === undefined || sequenceIndex === -1) {
        return null;
    }

    return buildResult(coreParts.slice(sequenceIndex + 1), 'generated-legil', {
        runId: coreParts.slice(0, sequenceIndex).join('_'),
        sequence: coreParts[sequenceIndex],
        variant: thirdLast.replace(/^v/i, ''),
        savedAt: `${secondLast}_${last}`
    });
}

function parseGofcnimName(fileName) {
    const parts = cleanBusinessParts(splitStem(fileName));
    if (!parts.length || !GOFCNIM_RE.test(parts[0])) {
        return null;
    }

    const primaryIndex = parts.findIndex((part, index) => index > 0 && KNOWN_PRIMARY_TAGS.has(part));
    if (primaryIndex > 0) {
        return buildResult(parts.slice(primaryIndex), 'gofcnim');
    }

    return null;
}

function extractSourceBusinessName(fileName) {
    return parseGeneratedLegilName(fileName) || parseGofcnimName(fileName) || null;
}

module.exports = {
    extractSourceBusinessName,
    parseGeneratedLegilName,
    parseGofcnimName,
    sanitizeNamePart
};
