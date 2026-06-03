const path = require('path');

const DEFAULT_MAX_LEVEL = 3;
const DEFAULT_PART_MAX_LENGTH = 40;
const DEFAULT_BASE_MAX_LENGTH = 160;

function normalizeText(value) {
    return String(value || '').trim();
}

function compactText(value) {
    return normalizeText(value).replace(/\s+/g, '');
}

function sanitizeFileNamePart(value, maxLength = DEFAULT_PART_MAX_LENGTH) {
    const text = normalizeText(value);
    if (!text) {
        return '';
    }

    const safe = text
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
        .replace(/\s+/g, '_')
        .replace(/_+/g, '_')
        .replace(/[. ]+$/g, '')
        .replace(/^_+|_+$/g, '');

    const limit = Number(maxLength);
    if (!Number.isFinite(limit) || limit <= 0) {
        return safe;
    }

    return safe.slice(0, Math.floor(limit));
}

function uniqueParts(parts) {
    const result = [];
    for (const part of parts) {
        const text = normalizeText(part);
        if (text && result[result.length - 1] !== text) {
            result.push(text);
        }
    }
    return result;
}

function splitLabelPath(value) {
    if (Array.isArray(value)) {
        return uniqueParts(value.flatMap(splitLabelPath));
    }

    return uniqueParts(String(value || '')
        .split(/[\/\\_>＞|,，\n\r]+/g)
        .map(part => part.trim())
        .filter(Boolean));
}

function cleanNameToken(value) {
    return normalizeText(value)
        .replace(/\.(png|jpe?g|webp|bmp|gif)$/i, '')
        .replace(/[()（）\[\]【】]+/g, '')
        .trim();
}

function isNoiseNameToken(value) {
    const text = normalizeText(value);
    if (!text) return true;
    if (/^[A-Z]:$/i.test(text)) return true;
    if (/^\d{2,5}x\d{2,5}$/i.test(text)) return true;
    if (/^\d+$/.test(text)) return true;
    if (/^[A-Z]{2,5}$/i.test(text)) return true;
    if (/^[A-Z0-9]{6,}$/i.test(text) && /\d/.test(text)) return true;
    return false;
}

function parseLabelCandidatesFromName(name) {
    const raw = normalizeText(name);
    if (!raw) {
        return [];
    }

    return raw
        .replace(/\\/g, '/')
        .split('/')
        .flatMap((section, index, sections) => {
            const value = index === sections.length - 1
                ? path.parse(section).name || section
                : section;
            return String(value || '').split(/[_\s]+/g);
        })
        .map(cleanNameToken)
        .filter(part => !isNoiseNameToken(part));
}

function normalizeDirectionEntry(direction, index, maxLevel) {
    if (!direction) {
        return null;
    }

    if (typeof direction === 'string' || Array.isArray(direction)) {
        const parts = splitLabelPath(direction).slice(0, maxLevel);
        return parts.length ? {
            id: '',
            path: parts,
            aliases: [],
            index
        } : null;
    }

    if (typeof direction !== 'object') {
        return null;
    }

    const fieldPath = [
        direction.primaryTag || direction.primary || direction.level1,
        direction.secondaryTag || direction.secondary || direction.level2,
        direction.tertiaryTag || direction.tertiary || direction.level3
    ].map(normalizeText).filter(Boolean);

    const pathParts = splitLabelPath(
        direction.standardLabelPath ||
        direction.labelPath ||
        direction.sourceLabelPath ||
        direction.path ||
        direction.directionPath ||
        direction.fullPath ||
        ''
    );

    const parts = (fieldPath.length > pathParts.length ? fieldPath : pathParts).slice(0, maxLevel);
    if (!parts.length && direction.name) {
        parts.push(...splitLabelPath(direction.name).slice(0, maxLevel));
    }

    if (!parts.length) {
        return null;
    }

    const aliases = []
        .concat(direction.aliases || [])
        .concat(direction.alias || [])
        .flatMap(splitLabelPath)
        .map(compactText)
        .filter(Boolean);

    return {
        id: normalizeText(direction.id || direction.directionId || direction.targetId || direction.key),
        path: uniqueParts(parts).slice(0, maxLevel),
        aliases,
        raw: direction,
        index
    };
}

function normalizeDirectionLibrary(directionLibrary, maxLevel = DEFAULT_MAX_LEVEL) {
    const safeMaxLevel = normalizeMaxLevel(maxLevel);
    let source = directionLibrary;

    if (source && typeof source === 'object' && !Array.isArray(source)) {
        source = Array.isArray(source.directions) ? source.directions : [source];
    }

    if (typeof source === 'string') {
        source = [source];
    }

    if (Array.isArray(source) && source.every(item => typeof item === 'string')) {
        const looksLikeOnePath = source.length <= safeMaxLevel && source.every(item => !/[\/\\_>＞|,，]/.test(item));
        source = looksLikeOnePath ? [source] : source;
    }

    const entries = (Array.isArray(source) ? source : [])
        .map((item, index) => normalizeDirectionEntry(item, index, safeMaxLevel))
        .filter(Boolean);
    const byPath = new Map();

    for (const entry of entries) {
        const key = labelPathKey(entry.path);
        const existing = byPath.get(key);
        if (!existing || existing.inferredAncestor) {
            byPath.set(key, entry);
        }

        for (let level = 1; level < entry.path.length; level++) {
            const ancestorPath = entry.path.slice(0, level);
            const ancestorKey = labelPathKey(ancestorPath);
            if (!byPath.has(ancestorKey)) {
                byPath.set(ancestorKey, {
                    id: '',
                    path: ancestorPath,
                    aliases: [],
                    raw: entry.raw,
                    index: entry.index + level / 1000,
                    inferredAncestor: true
                });
            }
        }
    }

    return Array.from(byPath.values())
        .sort((a, b) => b.path.length - a.path.length || a.index - b.index);
}

function labelPathKey(parts = []) {
    return (Array.isArray(parts) ? parts : [])
        .map(compactText)
        .filter(Boolean)
        .join('/');
}

function normalizeMaxLevel(maxLevel) {
    const value = Number(maxLevel);
    if (!Number.isFinite(value) || value <= 0) {
        return DEFAULT_MAX_LEVEL;
    }
    return Math.max(1, Math.floor(value));
}

function sameLabel(a, b) {
    return compactText(a) === compactText(b);
}

function conservativeLabelMatch(candidate, standard, levelIndex, aliases = []) {
    const candidateText = compactText(candidate);
    const standardText = compactText(standard);
    if (!candidateText || !standardText) {
        return 'none';
    }

    if (candidateText === standardText || aliases.includes(candidateText)) {
        return 'exact';
    }

    if (levelIndex >= 2 && standardText.length >= 2 && candidateText.includes(standardText)) {
        return 'fuzzy';
    }

    return 'none';
}

function matchCandidateParts(candidateParts, entries) {
    const parts = (Array.isArray(candidateParts) ? candidateParts : [])
        .map(normalizeText)
        .filter(Boolean);
    if (!parts.length || !entries.length) {
        return null;
    }

    let best = null;
    for (let start = 0; start < parts.length; start++) {
        for (const entry of entries) {
            if (start + entry.path.length > parts.length) {
                continue;
            }

            let exactCount = 0;
            let fuzzyCount = 0;
            let matched = true;
            for (let i = 0; i < entry.path.length; i++) {
                const result = conservativeLabelMatch(parts[start + i], entry.path[i], i, entry.aliases);
                if (result === 'none') {
                    matched = false;
                    break;
                }
                if (result === 'exact') exactCount += 1;
                if (result === 'fuzzy') fuzzyCount += 1;
            }

            if (!matched) {
                continue;
            }

            const score = entry.path.length * 100 + exactCount * 10 - fuzzyCount - start;
            const sourceContentTitle = resolveSourceContentTitle(parts, start, entry.path, fuzzyCount > 0);
            const current = {
                entry,
                standardLabelPath: entry.path,
                sourceParsedParts: parts,
                sourceContentTitle,
                droppedLabelParts: resolveDroppedLabelParts(parts, start, entry.path, fuzzyCount > 0),
                matchType: fuzzyCount > 0 ? 'fuzzy' : 'exact',
                score
            };

            if (!best || current.score > best.score) {
                best = current;
            }
        }
    }

    return best;
}

function resolveDroppedLabelParts(parts, start, standardPath, hasFuzzyMatch) {
    const dropped = parts.slice(start + standardPath.length).filter(Boolean);
    if (hasFuzzyMatch) {
        const lastMatched = parts[start + standardPath.length - 1];
        const lastStandard = standardPath[standardPath.length - 1];
        if (lastMatched && !sameLabel(lastMatched, lastStandard)) {
            dropped.unshift(lastMatched);
        }
    }
    return uniqueParts(dropped);
}

function resolveSourceContentTitle(parts, start, standardPath, hasFuzzyMatch) {
    const afterMatch = parts[start + standardPath.length];
    if (afterMatch) {
        return afterMatch;
    }

    if (hasFuzzyMatch) {
        const lastMatched = parts[start + standardPath.length - 1];
        const lastStandard = standardPath[standardPath.length - 1];
        if (lastMatched && !sameLabel(lastMatched, lastStandard)) {
            return lastMatched;
        }
    }

    return '';
}

function findByDirectionId(entries, sourceDirectionId) {
    const id = normalizeText(sourceDirectionId);
    if (!id) {
        return null;
    }
    return entries.find(entry => entry.id && entry.id === id) || null;
}

function structuredLabelPathFromInput(input) {
    const structured = splitLabelPath(
        input.standardLabelPath ||
        input.sourceLabelPath ||
        input.labelPath ||
        input.directionLabelPath ||
        ''
    );
    if (structured.length) {
        return structured;
    }

    return [
        input.primaryTag || input.primary,
        input.secondaryTag || input.secondary,
        input.tertiaryTag || input.tertiary
    ].map(normalizeText).filter(Boolean);
}

function resolveFromStructuredPath(input, entries, maxLevel) {
    const structured = structuredLabelPathFromInput(input);
    if (!structured.length) {
        return null;
    }

    const matched = matchCandidateParts(structured, entries);
    if (matched) {
        return {
            ...matched,
            standardLabelPath: matched.standardLabelPath.slice(0, maxLevel),
            sourceContentTitle: matched.sourceContentTitle || structured[maxLevel] || '',
            namingSource: 'prompt-meta',
            tagConfidence: matched.entry && matched.entry.inferredAncestor
                ? 'low'
                : (matched.matchType === 'fuzzy' ? 'medium' : 'high')
        };
    }

    if (entries.length && input.strictLibraryTags !== false) {
        return {
            standardLabelPath: [],
            sourceParsedParts: structured,
            sourceContentTitle: structured[structured.length - 1] || '',
            droppedLabelParts: structured,
            namingSource: 'prompt-meta-unverified',
            tagConfidence: 'unverified',
            matchType: 'none'
        };
    }

    return {
        standardLabelPath: structured.slice(0, maxLevel),
        sourceParsedParts: structured,
        sourceContentTitle: structured[maxLevel] || '',
        namingSource: 'prompt-meta',
        tagConfidence: 'high',
        matchType: 'exact'
    };
}

function resultFromMatch(match, namingSource) {
    if (!match) {
        return null;
    }

    const source = match.entry && match.entry.inferredAncestor
        ? 'direction-library-ancestor'
        : match.matchType === 'fuzzy'
        ? 'direction-library-fuzzy'
        : namingSource;
    return {
        ...match,
        namingSource: source,
        tagConfidence: match.entry && match.entry.inferredAncestor
            ? 'low'
            : (match.matchType === 'fuzzy' ? 'medium' : 'high')
    };
}

function resolveStandardLabelPath(input = {}) {
    const maxLevel = normalizeMaxLevel(input.maxLevel);
    const entries = normalizeDirectionLibrary(input.directionLibrary, maxLevel);

    let unverifiedStructured = null;
    const structured = resolveFromStructuredPath(input, entries, maxLevel);
    if (structured) {
        const normalizedStructured = normalizeResolvedResult(structured, maxLevel);
        if (normalizedStructured.tagConfidence !== 'unverified') {
            return normalizedStructured;
        }
        unverifiedStructured = normalizedStructured;
    }

    const idMatch = findByDirectionId(entries, input.sourceDirectionId);
    if (idMatch) {
        return normalizeResolvedResult({
            entry: idMatch,
            standardLabelPath: idMatch.path,
            sourceParsedParts: [],
            sourceContentTitle: '',
            matchType: 'exact',
            namingSource: 'direction-library-id',
            tagConfidence: 'high'
        }, maxLevel);
    }

    const sourceDirectionParts = splitLabelPath(input.sourceDirectionPath);
    const directionMatch = resultFromMatch(
        matchCandidateParts(sourceDirectionParts, entries),
        'direction-library-path'
    );
    if (directionMatch) {
        return normalizeResolvedResult(directionMatch, maxLevel);
    }

    if (sourceDirectionParts.length && !entries.length) {
        return normalizeResolvedResult({
            standardLabelPath: sourceDirectionParts.slice(0, maxLevel),
            sourceParsedParts: sourceDirectionParts,
            sourceContentTitle: sourceDirectionParts[maxLevel] || '',
            matchType: 'exact',
            namingSource: 'direction-library-path',
            tagConfidence: 'low'
        }, maxLevel);
    }

    const rawNameParts = parseLabelCandidatesFromName(input.sourceRawName);
    const rawNameMatch = resultFromMatch(
        matchCandidateParts(rawNameParts, entries),
        'direction-library-exact'
    );
    if (rawNameMatch) {
        return normalizeResolvedResult(rawNameMatch, maxLevel);
    }

    const folderParts = parseLabelCandidatesFromName(input.referenceFolderPath);
    const folderMatch = resultFromMatch(
        matchCandidateParts(folderParts, entries),
        'reference-folder'
    );
    if (folderMatch) {
        return normalizeResolvedResult(folderMatch, maxLevel);
    }

    return normalizeResolvedResult({
        standardLabelPath: [],
        sourceParsedParts: rawNameParts.length ? rawNameParts : folderParts,
        sourceContentTitle: rawNameParts[rawNameParts.length - 1] || folderParts[folderParts.length - 1] || (unverifiedStructured && unverifiedStructured.sourceContentTitle) || '',
        droppedLabelParts: unverifiedStructured ? unverifiedStructured.droppedLabelParts : [],
        matchType: 'none',
        namingSource: unverifiedStructured ? unverifiedStructured.namingSource : 'none',
        tagConfidence: unverifiedStructured ? unverifiedStructured.tagConfidence : 'missing'
    }, maxLevel);
}

function normalizeResolvedResult(result, maxLevel) {
    const standardLabelPath = uniqueParts(result.standardLabelPath || []).slice(0, maxLevel);
    return {
        standardLabelPath,
        primaryTag: standardLabelPath[0] || '',
        secondaryTag: standardLabelPath[1] || '',
        tertiaryTag: standardLabelPath[2] || '',
        sourceParsedParts: Array.isArray(result.sourceParsedParts) ? result.sourceParsedParts : [],
        sourceContentTitle: result.sourceContentTitle || '',
        droppedLabelParts: Array.isArray(result.droppedLabelParts) ? result.droppedLabelParts : [],
        namingSource: result.namingSource || 'none',
        tagConfidence: result.tagConfidence || 'missing',
        matchedDirectionId: result.entry && result.entry.id ? result.entry.id : '',
        matchType: result.matchType || 'none'
    };
}

function buildOutputNameBase({
    standardLabelPath = [],
    contentTitle = '',
    fallbackName = '',
    partMaxLength = DEFAULT_PART_MAX_LENGTH,
    maxLength = DEFAULT_BASE_MAX_LENGTH
} = {}) {
    const labelParts = (Array.isArray(standardLabelPath) ? standardLabelPath : splitLabelPath(standardLabelPath))
        .map(part => sanitizeFileNamePart(part, partMaxLength))
        .filter(Boolean);
    const titlePart = sanitizeFileNamePart(contentTitle || fallbackName, partMaxLength);
    const parts = [...labelParts, titlePart].filter(Boolean);
    const base = parts.join('_') || sanitizeFileNamePart(fallbackName, partMaxLength);

    if (!base) {
        return '';
    }

    const limit = Number(maxLength);
    if (!Number.isFinite(limit) || limit <= 0 || base.length <= limit) {
        return base;
    }

    return base.slice(0, Math.floor(limit)).replace(/_+$/g, '');
}

function buildCreativeOutputNamingContext(input = {}) {
    const resolved = resolveStandardLabelPath(input);
    const contentTitle = normalizeText(
        input.contentTitle ||
        input.newDirectionName ||
        input.title ||
        input.fallbackName ||
        ''
    );
    const outputNameBase = buildOutputNameBase({
        standardLabelPath: resolved.standardLabelPath,
        contentTitle,
        fallbackName: input.fallbackName || resolved.sourceContentTitle || input.sourceRawName || ''
    });

    return {
        primaryTag: resolved.primaryTag,
        secondaryTag: resolved.secondaryTag,
        tertiaryTag: resolved.tertiaryTag,
        standardLabelPath: resolved.standardLabelPath,
        sourceDirectionId: normalizeText(input.sourceDirectionId),
        sourceDirectionPath: normalizeText(input.sourceDirectionPath),
        sourceRawName: normalizeText(input.sourceRawName),
        referenceFolderPath: normalizeText(input.referenceFolderPath),
        sourceParsedParts: resolved.sourceParsedParts,
        sourceContentTitle: resolved.sourceContentTitle || normalizeText(input.sourceContentTitle),
        droppedLabelParts: resolved.droppedLabelParts && resolved.droppedLabelParts.length
            ? resolved.droppedLabelParts
            : splitLabelPath(input.droppedLabelParts),
        newDirectionName: normalizeText(input.newDirectionName),
        promptTitle: normalizeText(input.promptTitle),
        contentTitle,
        outputNameBase,
        namingSource: resolved.namingSource,
        tagConfidence: resolved.tagConfidence,
        matchedDirectionId: resolved.matchedDirectionId,
        matchType: resolved.matchType
    };
}

module.exports = {
    resolveStandardLabelPath,
    buildOutputNameBase,
    sanitizeFileNamePart,
    parseLabelCandidatesFromName,
    buildCreativeOutputNamingContext,
    normalizeDirectionLibrary
};
