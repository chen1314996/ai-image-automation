const path = require('path');

const DEFAULT_MAX_LEVEL = 3;
const DEFAULT_PART_MAX_LENGTH = 40;
const DEFAULT_BASE_MAX_LENGTH = 160;
const AUTOMATION_CONTENT_PREFIX = '自动化';
const FINAL_CONTENT_MIN_CHARS = 4;
const FINAL_CONTENT_MAX_CHARS = 8;
const GENERIC_CONTENT_WORDS = [
    AUTOMATION_CONTENT_PREFIX,
    '新方向',
    '创意方向',
    '方向',
    '拓展',
    '扩展',
    '延展',
    '优化',
    '变体',
    '版本',
    '提示词',
    'Prompt',
    'prompt',
    '图片',
    '图像',
    '生成',
    '画面',
    '场景',
    '素材',
    '内容',
    '设计',
    '方案',
    '效果'
];
const TRAILING_CONTENT_WORDS = [
    '画面',
    '场景',
    '内容',
    '方向',
    '拓展',
    '扩展',
    '延展',
    '发现',
    '展示',
    '呈现',
    '生成',
    '设计',
    '版本',
    '变体',
    '效果',
    '主题',
    '海报',
    '素材'
];

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

function escapeRegExp(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function chineseChars(value) {
    return String(value || '').match(/[\u3400-\u9fff\uf900-\ufaff]/gu) || [];
}

function chineseLength(value) {
    return chineseChars(value).length;
}

function stripAutomationPrefix(value) {
    return normalizeText(value).replace(new RegExp(escapeRegExp(AUTOMATION_CONTENT_PREFIX), 'g'), '');
}

function stripGenericContentWords(value) {
    let text = stripAutomationPrefix(value);
    GENERIC_CONTENT_WORDS
        .slice()
        .sort((a, b) => b.length - a.length)
        .forEach(word => {
            text = text.replace(new RegExp(escapeRegExp(word), 'gi'), '');
        });
    return text;
}

function stripKnownLabelWords(value, standardLabelPath = []) {
    let text = normalizeText(value);
    const labels = uniqueParts(standardLabelPath)
        .filter(part => chineseLength(part) >= 2)
        .sort((a, b) => b.length - a.length);

    labels.forEach(label => {
        const next = text.replace(new RegExp(escapeRegExp(label), 'g'), '');
        if (chineseLength(next) >= 3) {
            text = next;
        }
    });

    return text;
}

function firstChineseSegment(value) {
    const segments = String(value || '')
        .replace(/\r/g, '\n')
        .split(/[\n，,。；;：:！!？?、|/\\]+/g)
        .map(part => part.trim())
        .filter(Boolean);
    const usable = segments.find(part => chineseLength(part) >= 2);
    if (usable) {
        return usable;
    }
    const runs = chineseChars(value).join('');
    return runs || normalizeText(value);
}

function cleanContentTitleCandidate(value, standardLabelPath = []) {
    let text = firstChineseSegment(value)
        .replace(/\.(png|jpe?g|webp|bmp|gif)$/i, '')
        .replace(/^[\s"'“”‘’《》【】\[\]（）()]+|[\s"'“”‘’《》【】\[\]（）()]+$/g, '')
        .replace(/^(标题|主题|方向|创意方向|画面标题|场景标题|内容|主体)\s*[:：]\s*/i, '')
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
        .replace(/[\s_\-]+/g, '')
        .trim();

    text = stripGenericContentWords(text);
    text = stripKnownLabelWords(text, standardLabelPath);
    text = (text.match(/[\u3400-\u9fff\uf900-\ufaff]+/gu) || []).join('');

    return text;
}

function fitFinalContentTitle(value, standardLabelPath = [], minChars = FINAL_CONTENT_MIN_CHARS, maxChars = FINAL_CONTENT_MAX_CHARS) {
    let text = cleanContentTitleCandidate(value, standardLabelPath);
    if (!text) {
        return '';
    }

    TRAILING_CONTENT_WORDS
        .slice()
        .sort((a, b) => b.length - a.length)
        .forEach(word => {
            while (chineseLength(text) > maxChars && text.endsWith(word)) {
                text = text.slice(0, -word.length);
            }
        });

    const chars = chineseChars(text);
    if (chars.length > maxChars) {
        text = chars.slice(0, maxChars).join('');
    }

    if (chineseLength(text) < minChars) {
        return '';
    }

    return text;
}

function titleCandidatesForInput(input = {}) {
    const mode = normalizeText(input.namingMode || input.mode || input.source || input.taskType).toLowerCase();
    const commonTail = [
        input.visualHook,
        input.extensionName,
        input.promptTitle,
        input.title,
        input.sourceContentTitle,
        input.sourceRawName,
        input.prompt,
        input.finalPrompt,
        input.fallbackName
    ];

    if (/creative|auto|agent|material|direction/.test(mode)) {
        return [
            input.finalContentTitle,
            input.contentTitle,
            input.contentName,
            input.newDirectionName,
            input.direction,
            ...commonTail
        ];
    }

    if (/batch|table|prompt/.test(mode)) {
        return [
            input.finalContentTitle,
            input.contentTitle,
            input.contentName,
            input.outputTitle,
            input.title,
            input.promptTitle,
            input.newDirectionName,
            input.direction,
            ...commonTail
        ];
    }

    return [
        input.finalContentTitle,
        input.contentTitle,
        input.contentName,
        input.newDirectionName,
        input.direction,
        input.outputTitle,
        ...commonTail
    ];
}

function buildFinalContentTitle(input = {}, standardLabelPath = []) {
    for (const candidate of titleCandidatesForInput(input)) {
        const title = fitFinalContentTitle(candidate, standardLabelPath);
        if (title) {
            return title;
        }
    }

    return '素材内容';
}

function buildAutomationContentTitle(finalContentTitle) {
    const title = fitFinalContentTitle(finalContentTitle, []) || '素材内容';
    return `${AUTOMATION_CONTENT_PREFIX}${stripAutomationPrefix(title)}`;
}

function flattenTextParts(value) {
    if (Array.isArray(value)) {
        return value.flatMap(flattenTextParts);
    }
    if (value && typeof value === 'object') {
        return Object.values(value).flatMap(flattenTextParts);
    }
    const text = normalizeText(value);
    return text ? [text] : [];
}

function collectBestFitTexts(input = {}) {
    return flattenTextParts([
        input.sourceDirectionPath,
        input.directionPath,
        input.directionLabelPath,
        input.sourceLabelPath,
        input.labelPath,
        input.standardLabelPath,
        input.primaryTag || input.primary,
        input.secondaryTag || input.secondary,
        input.tertiaryTag || input.tertiary,
        input.direction,
        input.matchedDirectionName,
        input.matchedDirectionPath,
        input.newDirectionName,
        input.contentTitle,
        input.contentName,
        input.finalContentTitle,
        input.promptTitle,
        input.title,
        input.visualHook,
        input.extensionName,
        input.sourceRawName,
        input.sourceContentTitle,
        input.referenceFolderPath,
        input.prompt,
        input.finalPrompt
    ]).filter(Boolean);
}

function chineseNgrams(value, min = 2, max = 4, limit = 120) {
    const text = chineseChars(value).join('');
    const result = [];
    for (let size = min; size <= max; size++) {
        for (let i = 0; i <= text.length - size; i++) {
            result.push(text.slice(i, i + size));
            if (result.length >= limit) {
                return result;
            }
        }
    }
    return result;
}

function scoreBestFitEntry(entry, texts = []) {
    const compactTexts = texts.map(compactText).filter(Boolean);
    const allText = compactText(texts.join(''));
    const pathKey = compactText((entry.path || []).join(''));
    let score = 0;
    let matchedParts = 0;

    if (pathKey && allText.includes(pathKey)) {
        score += 700 + entry.path.length * 40;
    }

    for (const part of entry.path || []) {
        const partKey = compactText(part);
        if (!partKey) continue;
        const matchedIndex = compactTexts.findIndex(text => text.includes(partKey));
        if (matchedIndex >= 0) {
            matchedParts += 1;
            score += Math.max(25, 120 - matchedIndex * 8) + partKey.length * 2;
        }
    }

    const aliases = Array.isArray(entry.aliases) ? entry.aliases : [];
    aliases.forEach(alias => {
        if (alias && allText.includes(alias)) {
            score += 45;
        }
    });

    const raw = entry.raw && typeof entry.raw === 'object' ? entry.raw : {};
    const rawText = compactText([
        entry.path,
        raw.name,
        raw.directionName,
        raw.description,
        raw.visualHook,
        raw.note,
        raw.alias,
        raw.aliases
    ].flatMap(flattenTextParts).join(''));
    chineseNgrams(texts.join('')).forEach(token => {
        const tokenKey = compactText(token);
        if (tokenKey && rawText.includes(tokenKey)) {
            score += Math.min(16, tokenKey.length * 3);
        }
    });

    if (matchedParts === entry.path.length && matchedParts > 0) {
        score += 160 + entry.path.length * 30;
    } else if (matchedParts > 0) {
        score += matchedParts * 25;
    }

    if (matchedParts > 0) {
        score += (entry.path || []).length * 3;
    }
    return {
        score,
        matchedParts
    };
}

function resolveBestFitStandardLabelPath(input = {}, entries = [], maxLevel = DEFAULT_MAX_LEVEL) {
    const availableEntries = (Array.isArray(entries) ? entries : []).filter(entry => entry && Array.isArray(entry.path) && entry.path.length);
    if (!availableEntries.length) {
        return normalizeResolvedResult({
            standardLabelPath: [],
            sourceParsedParts: collectBestFitTexts(input).flatMap(parseLabelCandidatesFromName),
            sourceContentTitle: '',
            droppedLabelParts: [],
            matchType: 'none',
            namingSource: 'none',
            tagConfidence: 'missing'
        }, maxLevel);
    }

    const texts = collectBestFitTexts(input);
    let best = null;
    for (const entry of availableEntries) {
        const current = scoreBestFitEntry(entry, texts);
        const candidate = {
            entry,
            ...current
        };
        if (!best ||
            candidate.score > best.score ||
            (candidate.score === best.score && candidate.matchedParts > 0 && candidate.entry.path.length > best.entry.path.length) ||
            (candidate.score === best.score && candidate.matchedParts === 0 && best.matchedParts === 0 && candidate.entry.path.length < best.entry.path.length) ||
            (candidate.score === best.score && candidate.entry.path.length === best.entry.path.length && !candidate.entry.inferredAncestor && best.entry.inferredAncestor)) {
            best = candidate;
        }
    }

    const selected = best && best.score > 0
        ? best
        : {
            entry: availableEntries
                .filter(entry => !entry.inferredAncestor)
                .sort((a, b) => (a.index || 0) - (b.index || 0))[0] || availableEntries[0],
            score: 0,
            matchedParts: 0
        };

    return normalizeResolvedResult({
        entry: selected.entry,
        standardLabelPath: selected.entry.path.slice(0, maxLevel),
        sourceParsedParts: texts.flatMap(parseLabelCandidatesFromName),
        sourceContentTitle: '',
        droppedLabelParts: [],
        matchType: selected.score > 0 ? 'best-fit' : 'best-fit-default',
        namingSource: selected.score > 0 ? 'direction-library-best-fit' : 'direction-library-best-fit-default',
        tagConfidence: selected.score >= 260 ? 'medium' : 'low'
    }, maxLevel);
}

function resolveManagedStandardLabelPath(input = {}) {
    const maxLevel = normalizeMaxLevel(input.maxLevel);
    const entries = normalizeDirectionLibrary(input.directionLibrary, maxLevel);
    const resolved = resolveStandardLabelPath({
        ...input,
        strictLibraryTags: input.strictLibraryTags !== false
    });

    if (resolved.standardLabelPath && resolved.standardLabelPath.length) {
        return resolved;
    }

    return resolveBestFitStandardLabelPath(input, entries, maxLevel);
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

function buildManagedOutputNamingContext(input = {}) {
    const resolved = resolveManagedStandardLabelPath(input);
    const finalContentTitle = buildFinalContentTitle(input, resolved.standardLabelPath);
    const automationContentTitle = buildAutomationContentTitle(finalContentTitle);
    const outputNameBase = buildOutputNameBase({
        standardLabelPath: resolved.standardLabelPath,
        contentTitle: automationContentTitle,
        fallbackName: automationContentTitle || input.fallbackName || resolved.sourceContentTitle || input.sourceRawName || ''
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
        contentTitle: finalContentTitle,
        contentName: finalContentTitle,
        finalContentTitle,
        automationContentTitle,
        outputNameBase,
        namingSource: resolved.namingSource,
        tagConfidence: resolved.tagConfidence,
        matchedDirectionId: resolved.matchedDirectionId,
        matchedDirectionPath: resolved.standardLabelPath.join('/'),
        matchType: resolved.matchType
    };
}

module.exports = {
    resolveStandardLabelPath,
    resolveManagedStandardLabelPath,
    buildOutputNameBase,
    sanitizeFileNamePart,
    parseLabelCandidatesFromName,
    buildCreativeOutputNamingContext,
    buildManagedOutputNamingContext,
    buildFinalContentTitle,
    buildAutomationContentTitle,
    normalizeDirectionLibrary
};
