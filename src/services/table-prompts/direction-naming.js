const fs = require('fs');
const path = require('path');
const {
    sanitizeFileNamePart
} = require('../output-naming/creative-output-naming');

const EMPTY_LABELS = new Set(['', '暂无', '无', '未分类', '未归类', '空', 'null', 'undefined']);

function normalizeText(value) {
    if (value === null || value === undefined) {
        return '';
    }
    return String(value).replace(/^\uFEFF/, '').trim();
}

function isEmptyLabel(value) {
    return EMPTY_LABELS.has(normalizeText(value).toLowerCase());
}

function compactKey(value) {
    return normalizeText(value)
        .toLowerCase()
        .replace(/[【】\[\]（）()《》"“”'‘’]/g, '')
        .replace(/[\s_\-—–/\\|>＞:：,，.。;；+＋]+/g, '')
        .trim();
}

function splitPathParts(value) {
    if (Array.isArray(value)) {
        return value.flatMap(splitPathParts);
    }

    return normalizeText(value)
        .replace(/[【][^】]*[】]/g, '')
        .split(/[\s_\-—–/\\|>＞:：,，;；]+/g)
        .map(part => normalizeText(part))
        .filter(part => !isEmptyLabel(part));
}

function readJsonFile(filePath, fallback) {
    try {
        if (!fs.existsSync(filePath)) {
            return fallback;
        }
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
        return fallback;
    }
}

function normalizeDirectionEntry(direction, index) {
    if (!direction || typeof direction !== 'object') {
        return null;
    }

    const fieldPath = [
        direction.primaryTag || direction.primary || direction.level1,
        direction.secondaryTag || direction.secondary || direction.level2,
        direction.tertiaryTag || direction.tertiary || direction.level3
    ].map(normalizeText).filter(part => !isEmptyLabel(part));

    const pathParts = splitPathParts(
        direction.path ||
        direction.directionPath ||
        direction.fullPath ||
        direction.standardLabelPath ||
        direction.labelPath ||
        ''
    );

    const labels = (fieldPath.length >= Math.min(pathParts.length, 3) ? fieldPath : pathParts.slice(0, 3))
        .filter(part => !isEmptyLabel(part))
        .slice(0, 3);

    if (!labels.length) {
        return null;
    }

    const fullPath = splitPathParts(direction.path || direction.directionPath || labels.join('/'));
    const name = normalizeText(direction.name);
    const aliases = []
        .concat(direction.aliases || [])
        .concat(direction.alias || [])
        .concat(direction.directionName || [])
        .concat(name && !isEmptyLabel(name) ? [name] : [])
        .filter(Boolean);

    return {
        id: normalizeText(direction.id || direction.directionId || ''),
        index,
        labels,
        fullPath: fullPath.length ? fullPath : labels,
        name,
        aliases,
        status: normalizeText(direction.status || 'seed'),
        raw: direction
    };
}

function directionStatusEnabled(entry) {
    const status = normalizeText(entry && entry.status).toLowerCase();
    return !['disabled', 'archived', 'archive', 'rejected', 'deleted'].includes(status);
}

function addIndexEntry(index, key, entry, matchType, score) {
    if (!key) return;
    const current = index.get(key);
    const candidate = {
        entry,
        matchType,
        score
    };
    if (!current || candidate.score > current.score || (
        candidate.score === current.score && entry.labels.length > current.entry.labels.length
    )) {
        index.set(key, candidate);
    }
}

function buildDirectionIndex(directions = []) {
    const entries = (Array.isArray(directions) ? directions : [])
        .map(normalizeDirectionEntry)
        .filter(Boolean)
        .filter(directionStatusEnabled);
    const index = new Map();

    entries.forEach(entry => {
        const labelKey = compactKey(entry.labels.join(''));
        const fullKey = compactKey(entry.fullPath.join(''));
        addIndexEntry(index, labelKey, entry, 'path', 100);
        addIndexEntry(index, fullKey, entry, 'path', 100);

        for (let start = 0; start < entry.fullPath.length; start++) {
            const suffix = entry.fullPath.slice(start);
            if (suffix.length >= 2) {
                addIndexEntry(index, compactKey(suffix.join('')), entry, 'path-suffix', 92 + suffix.length);
            }
        }

        for (let start = 0; start < entry.labels.length; start++) {
            const suffix = entry.labels.slice(start);
            if (suffix.length >= 2) {
                addIndexEntry(index, compactKey(suffix.join('')), entry, 'label-suffix', 90 + suffix.length);
            }
        }

        entry.aliases.forEach(alias => {
            const aliasParts = splitPathParts(alias);
            if (aliasParts.length >= 2 || compactKey(alias).length >= 4) {
                addIndexEntry(index, compactKey(aliasParts.join('') || alias), entry, 'alias', 86);
            }
        });
    });

    return {
        entries,
        index
    };
}

function flattenObjects(value, output = []) {
    if (Array.isArray(value)) {
        value.forEach(item => flattenObjects(item, output));
        return output;
    }
    if (!value || typeof value !== 'object') {
        return output;
    }
    if (value.sourceDirectionPath || value.sourceDirectionKey || value.sourceDirectionName || value.directionPath || value.directionName || value.materialName) {
        output.push(value);
    }
    Object.values(value).forEach(item => flattenObjects(item, output));
    return output;
}

function materialNameParts(value) {
    return normalizeText(value)
        .replace(/\.(png|jpe?g|webp|bmp|gif)$/i, '')
        .split(/[_\s]+/g)
        .map(part => normalizeText(part))
        .filter(Boolean)
        .filter(part => !/^\d{3,5}x\d{3,5}$/i.test(part))
        .filter(part => !/^[A-Z0-9]{5,}$/i.test(part));
}

function cleanContentName(value, fallback = '') {
    let text = normalizeText(value || fallback)
        .replace(/[【】\[\]（）()《》"“”'‘’]/g, '')
        .replace(/^(主题|画面|内容|主体|方向|核心|重点)[:：]/, '')
        .replace(/^(保留|更换|加入|呈现|突出|围绕|设计|玩家|前景为|背景露出)/, '')
        .replace(/(画面|场景|内容|核心|重点|整体|风格)$/g, '')
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
        .replace(/\s+/g, '');

    const segments = text.split(/[，,。.;；、]/g).map(part => part.trim()).filter(Boolean);
    if (segments.length >= 2 && segments[0].length <= 2) {
        text = segments.slice(0, 4).join('');
    } else {
        text = segments.find(part => part.length >= 2) || segments[0] || text;
    }
    text = text.replace(/^(不同|多个|多款|各类|当前|这个)/, '');

    if (!text || text.length < 2) {
        text = normalizeText(fallback);
    }
    if (!text) {
        text = '图片内容';
    }
    return sanitizeFileNamePart(text, 18) || '图片内容';
}

function buildTargetContentRecords(rootDir) {
    const knowledgeDir = path.join(rootDir || process.cwd(), 'data', 'creative-knowledge');
    const sources = [
        readJsonFile(path.join(knowledgeDir, 'creative-target-queues.json'), {}),
        readJsonFile(path.join(knowledgeDir, 'assets.json'), {})
    ];
    const records = [];
    const seen = new Set();

    sources.flatMap(source => flattenObjects(source)).forEach(item => {
        const sourcePath = normalizeText(item.sourceDirectionPath || item.sourceDirectionKey || item.directionPath || '');
        const pathParts = splitPathParts(sourcePath);
        const sourceDirectionName = cleanContentName(item.sourceDirectionName || item.directionName || '', '');
        const nameParts = materialNameParts(item.sourceMaterialName || item.materialName || item.fileName || '');
        const fallbackContent = nameParts[nameParts.length - 1] || sourceDirectionName || item.mainSubject || item.visualInsight || '';
        const contentName = cleanContentName(sourceDirectionName || fallbackContent, fallbackContent);

        if (!contentName || contentName === '图片内容') {
            return;
        }

        const key = `${pathParts.join('/')}::${contentName}`;
        if (seen.has(key)) {
            return;
        }
        seen.add(key);
        records.push({
            pathParts,
            contentName,
            sourceDirectionName,
            sourceDirectionPath: sourcePath,
            materialName: normalizeText(item.sourceMaterialName || item.materialName || item.fileName || ''),
            mainSubject: normalizeText(item.mainSubject || ''),
            visualInsight: normalizeText(item.visualInsight || item.visionSummary || '')
        });
    });

    return records;
}

function loadTablePromptNamingKnowledge(rootDir) {
    const knowledgeDir = path.join(rootDir || process.cwd(), 'data', 'creative-knowledge');
    const directionsData = readJsonFile(path.join(knowledgeDir, 'directions.json'), { directions: [] });
    const directions = Array.isArray(directionsData)
        ? directionsData
        : (Array.isArray(directionsData.directions) ? directionsData.directions : []);
    const directionIndex = buildDirectionIndex(directions);
    return {
        ...directionIndex,
        targetContentRecords: buildTargetContentRecords(rootDir),
        directionCount: directionIndex.entries.length
    };
}

function matchDirection(tableDirection, knowledge) {
    const directionParts = splitPathParts(tableDirection);
    const key = compactKey(directionParts.join('') || tableDirection);
    const match = knowledge && knowledge.index ? knowledge.index.get(key) : null;

    if (match) {
        return {
            matched: true,
            matchType: match.matchType,
            matchConfidence: Math.min(1, match.score / 100),
            directionId: match.entry.id,
            directionName: match.entry.name,
            directionPath: match.entry.fullPath.join('/'),
            labels: match.entry.labels
        };
    }

    if (directionParts.length >= 2 && knowledge && Array.isArray(knowledge.entries)) {
        const partKeys = directionParts.map(compactKey).filter(Boolean);
        const containsMatches = knowledge.entries.filter(entry => {
            const haystack = [
                entry.fullPath.join(''),
                entry.labels.join(''),
                entry.name,
                ...(entry.aliases || [])
            ].map(compactKey).join('|');
            return partKeys.every(part => haystack.includes(part));
        });
        const uniqueIds = Array.from(new Set(containsMatches.map(entry => entry.id || entry.fullPath.join('/'))));
        if (uniqueIds.length === 1 && containsMatches[0]) {
            const entry = containsMatches[0];
            return {
                matched: true,
                matchType: 'contains-unique',
                matchConfidence: 0.82,
                directionId: entry.id,
                directionName: entry.name,
                directionPath: entry.fullPath.join('/'),
                labels: entry.labels
            };
        }
    }

    return {
        matched: false,
        matchType: 'unmatched',
        matchConfidence: 0,
        directionId: '',
        directionName: '',
        directionPath: '',
        labels: []
    };
}

function findContentNameFromTargets(labels, knowledge) {
    const safeLabels = (Array.isArray(labels) ? labels : []).filter(Boolean);
    if (!safeLabels.length || !knowledge || !Array.isArray(knowledge.targetContentRecords)) {
        return '';
    }
    const labelKey = compactKey(safeLabels.join(''));

    const matched = knowledge.targetContentRecords.find(record => {
        if (!Array.isArray(record.pathParts) || record.pathParts.length <= safeLabels.length) {
            return false;
        }
        const prefix = record.pathParts.slice(0, safeLabels.length);
        return compactKey(prefix.join('')) === labelKey;
    });

    return matched ? matched.contentName : '';
}

function extractQuotedScene(prompt = '') {
    const text = normalizeText(prompt);
    const patterns = [
        /(?:画面为|围绕(?:延展\d+|补充延展)?)[“"]([^”"]{4,80})[”"]/,
        /方向「[^」]+」[^，。]*[，,]([^。]{4,80})/
    ];
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match && match[1]) {
            return match[1];
        }
    }
    return '';
}

function extractPromptSceneCandidates(prompt = '') {
    const text = normalizeText(prompt);
    if (!text) {
        return [];
    }

    const candidates = [];
    const quotePattern = /[\u201c\u300c"']([^"'\u201d\u300d]{4,140})[\u201d\u300d"']/g;
    let match;
    while ((match = quotePattern.exec(text))) {
        const before = text.slice(Math.max(0, match.index - 12), match.index);
        if (/(\u753b\u9762|\u573a\u666f|\u5185\u5bb9|\u4e3b\u4f53|\u5ef6\u5c55)/.test(before)) {
            candidates.push(match[1]);
        }
    }

    const markerPattern = /(?:\u753b\u9762\u4e3a|\u753b\u9762\u662f|\u753b\u9762[:\uff1a]|\u573a\u666f\u4e3a|\u4e3b\u4f53\u4e3a)([^。\uff1b;]{4,140})/g;
    while ((match = markerPattern.exec(text))) {
        candidates.push(match[1]);
    }

    const legacyScene = extractQuotedScene(prompt);
    if (legacyScene) {
        candidates.push(legacyScene);
    }

    return Array.from(new Set(candidates.map(normalizeText).filter(Boolean)));
}

function simplifyPromptSceneContent(scene = '', labels = []) {
    const cleanScene = normalizeText(scene)
        .replace(/^[\u201c\u201d\u300c\u300d"']+|[\u201c\u201d\u300c\u300d"']+$/g, '')
        .replace(/\s+/g, '');
    if (!cleanScene) {
        return '';
    }

    const clauses = cleanScene
        .split(/[\uff0c,。\uff1b;]+/g)
        .map(part => normalizeText(part))
        .filter(Boolean);

    const preferred = clauses.find(part => /^(?:\u66f4\u6362|\u66ff\u6362|\u52a0\u5165|\u5448\u73b0|\u7a81\u51fa|\u56f4\u7ed5|\u5c55\u793a|\u6253\u9020|\u6539\u6210|\u6362\u6210|\u805a\u7126|\u4e3b\u6253)/.test(part)) ||
        clauses.find(part => /(?:\u89d2\u8272|\u4eba\u7269|\u4e3b\u4f53|\u9053\u5177|\u624b\u529e|\u5957\u88c5|\u5c0f\u961f|\u82f1\u96c4|\u5e78\u5b58\u8005|\u804c\u4e1a|\u9635\u8425)/.test(part)) ||
        clauses[0] ||
        cleanScene;

    let content = preferred
        .replace(/^(?:\u4fdd\u7559|\u66f4\u6362|\u66ff\u6362|\u52a0\u5165|\u5448\u73b0|\u7a81\u51fa|\u56f4\u7ed5|\u5c55\u793a|\u8bbe\u8ba1\u6210|\u8bbe\u8ba1|\u6253\u9020|\u8868\u73b0|\u805a\u7126|\u4e3b\u6253|\u5f3a\u5316|\u589e\u52a0|\u6539\u6210|\u6362\u6210)/, '')
        .replace(/[\/\\]+/g, '')
        .replace(/(?:\u8981\u6e05\u695a|\u7edf\u4e00\u6210.*|\u7edf\u4e00\u4e3a.*|\u660e\u786e.*|\u5f3a.*)$/g, '');

    const compactLabels = (Array.isArray(labels) ? labels : []).map(compactKey);
    if (compactLabels.includes(compactKey('\u624b\u529e')) && !compactKey(content).includes(compactKey('\u624b\u529e'))) {
        content += '\u624b\u529e';
    }

    return cleanContentName(content, '');
}

function inferContentName({ prompt, visualHook, extensionText, direction, sourceMaterial } = {}, labels = [], knowledge) {
    const promptSceneName = extractPromptSceneCandidates(prompt)
        .map(scene => simplifyPromptSceneContent(scene, labels))
        .find(Boolean);
    if (promptSceneName) {
        return {
            contentName: promptSceneName,
            contentNameSource: 'prompt-scene'
        };
    }

    const targetName = findContentNameFromTargets(labels, knowledge);
    if (targetName) {
        return {
            contentName: targetName,
            contentNameSource: 'knowledge-target'
        };
    }

    const quotedScene = extractQuotedScene(prompt);
    const candidates = [
        quotedScene,
        extensionText,
        visualHook,
        sourceMaterial && !/^5月TOP[:：]/i.test(sourceMaterial) ? sourceMaterial : '',
        direction
    ].map(value => cleanContentName(value, '')).filter(Boolean);

    const genericWords = new Set(labels.map(compactKey));
    const picked = candidates.find(candidate => !genericWords.has(compactKey(candidate))) || candidates[0] || '图片内容';
    return {
        contentName: picked,
        contentNameSource: quotedScene ? 'prompt-scene' : 'table-fields'
    };
}

function buildTablePromptNaming(input = {}, knowledge) {
    const directionMatch = matchDirection(input.direction, knowledge);
    const labels = directionMatch.matched ? directionMatch.labels : [];
    const namingLabels = labels.length ? labels : ['未归类'];
    const content = inferContentName(input, labels, knowledge);
    const outputNameBase = namingLabels
        .concat(content.contentName)
        .map(part => sanitizeFileNamePart(part, 36))
        .filter(Boolean)
        .join('_')
        .slice(0, 150)
        .replace(/_+$/g, '') || '未归类_图片内容';

    return {
        primaryTag: labels[0] || (directionMatch.matched ? '' : '未归类'),
        secondaryTag: labels[1] || '',
        tertiaryTag: labels[2] || '',
        standardLabelPath: labels,
        matchedDirectionId: directionMatch.directionId,
        matchedDirectionName: directionMatch.directionName,
        matchedDirectionPath: directionMatch.directionPath,
        directionMatchType: directionMatch.matchType,
        directionMatchConfidence: directionMatch.matchConfidence,
        directionLibraryMatched: directionMatch.matched,
        contentName: content.contentName,
        contentNameSource: content.contentNameSource,
        outputNameBase
    };
}

module.exports = {
    buildTablePromptNaming,
    loadTablePromptNamingKnowledge,
    splitPathParts,
    compactKey,
    cleanContentName
};
