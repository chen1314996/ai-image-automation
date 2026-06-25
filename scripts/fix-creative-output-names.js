const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const {
    buildCreativeOutputNamingContext,
    normalizeDirectionLibrary,
    sanitizeFileNamePart
} = require('../src/services/output-naming/creative-output-naming');

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const CORE_STRING_KEYS = new Set([
    'fileName',
    'relativePath',
    'filePath',
    'promptFileName',
    'promptFilePath',
    'outputNameBase',
    'referenceImageName',
    'savedFileName',
    'savedPath',
    'imageName',
    'imagePath',
    'imageFilePath',
    'outputPath',
    'localPath'
]);
const LABEL_KEYS = new Set([
    'primaryTag',
    'secondaryTag',
    'tertiaryTag',
    'standardLabelPath',
    'directionPath',
    'directionName',
    'sourceDirectionPath',
    'sourceParsedParts',
    'droppedLabelParts'
]);

function parseArgs(argv) {
    const args = {
        dir: '',
        apply: false,
        syncJson: true,
        includeLegacy: false,
        legacyOnly: false
    };
    for (let index = 0; index < argv.length; index++) {
        const arg = argv[index];
        if (arg === '--dir') {
            args.dir = argv[++index] || '';
        } else if (arg === '--apply') {
            args.apply = true;
        } else if (arg === '--no-sync-json') {
            args.syncJson = false;
        } else if (arg === '--include-legacy') {
            args.includeLegacy = true;
        } else if (arg === '--legacy-only') {
            args.legacyOnly = true;
        } else if (arg === '--help' || arg === '-h') {
            args.help = true;
        }
    }
    return args;
}

function usage() {
    return [
        'Usage:',
        '  node scripts/fix-creative-output-names.js --dir "E:\\AI\\...\\TOP素材迭代"',
        '  node scripts/fix-creative-output-names.js --dir "E:\\AI\\...\\TOP素材迭代" --apply',
        '',
        'Options:',
        '  --apply          Actually rename files. Without this, only writes a dry-run report.',
        '  --no-sync-json   Do not update data/creative-knowledge assets/runs JSON metadata.',
        '  --include-legacy Also clean old ref/prompt style names when asset metadata is available.',
        '  --legacy-only    Only process legacy image names with ref/prompt/v technical prefixes.',
        '',
        'The script can also recover labels from nearby *.prompt.txt metadata files.'
    ].join('\n');
}

function readJson(filePath, fallback) {
    if (!fs.existsSync(filePath)) return fallback;
    const text = fs.readFileSync(filePath, 'utf8');
    if (!text.trim()) return fallback;
    return JSON.parse(text);
}

function writeJsonAtomic(filePath, data) {
    const tempPath = `${filePath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tempPath, filePath);
}

function normalizePathForCompare(filePath) {
    return path.resolve(filePath).toLowerCase();
}

function assertInsideDirectory(filePath, targetDir) {
    const resolved = path.resolve(filePath);
    const root = path.resolve(targetDir);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
        throw new Error(`Refusing to touch path outside target directory: ${resolved}`);
    }
    return resolved;
}

function loadDirectionLibrary(rootDir) {
    const filePath = path.join(rootDir, 'data', 'creative-knowledge', 'directions.json');
    const payload = readJson(filePath, { directions: [] });
    const directions = Array.isArray(payload) ? payload : payload.directions || [];
    return normalizeDirectionLibrary(directions);
}

function loadAssets(rootDir) {
    const filePath = path.join(rootDir, 'data', 'creative-knowledge', 'assets.json');
    const payload = readJson(filePath, { assets: [] });
    return {
        filePath,
        payload,
        assets: Array.isArray(payload) ? payload : payload.assets || []
    };
}

function splitCoreParts(core) {
    return String(core || '').split('_').map(part => part.trim()).filter(Boolean);
}

function labelKey(parts) {
    return parts.map(part => String(part || '').replace(/\s+/g, '')).filter(Boolean).join('/');
}

function uniqueList(parts) {
    const seen = new Set();
    const result = [];
    for (const part of parts) {
        const text = String(part || '').trim();
        if (!text) continue;
        const key = labelKey([text]);
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(text);
    }
    return result;
}

function buildLabelPrefixes(directionEntries) {
    const keys = new Set();
    for (const entry of directionEntries) {
        for (let level = 1; level <= entry.path.length; level++) {
            keys.add(labelKey(entry.path.slice(0, level)));
        }
    }
    return keys;
}

function parseGeneratedName(fileName) {
    const parsed = path.parse(fileName);
    const fullExt = fileName.endsWith('.prompt.txt') ? '.prompt.txt' : parsed.ext;
    const baseName = fullExt === '.prompt.txt'
        ? fileName.slice(0, -'.prompt.txt'.length)
        : parsed.name;

    let match = baseName.match(/^(?<prefix>.+?_\d{4})_(?<core>.+?)_v(?<variant>\d+)_(?<date>\d{8})_(?<time>\d{6})$/);
    if (match) {
        return {
            kind: 'image',
            prefix: match.groups.prefix,
            core: match.groups.core,
            suffix: `_v${match.groups.variant}_${match.groups.date}_${match.groups.time}${fullExt}`,
            fullExt
        };
    }

    if (fullExt === '.prompt.txt') {
        match = baseName.match(/^(?<prefix>.+?_\d{4})_(?<core>.+)$/);
        if (match) {
            return {
                kind: 'prompt',
                prefix: match.groups.prefix,
                core: match.groups.core,
                suffix: fullExt,
                fullExt
            };
        }
    }

    match = baseName.match(/^(?<prefix>.+?_\d{4})_(?<core>.+?)_(?<date>\d{8})_(?<time>\d{6})$/);
    if (match) {
        return {
            kind: 'legacy-image',
            prefix: match.groups.prefix,
            core: match.groups.core,
            suffix: `_${match.groups.date}_${match.groups.time}${fullExt}`,
            fullExt
        };
    }

    return null;
}

function buildNameFromParts(parts, newCore) {
    return `${parts.prefix}_${newCore}${parts.suffix}`;
}

function outputTitleFromAsset(asset = {}) {
    return asset.contentTitle ||
        asset.newDirectionName ||
        asset.promptDirection ||
        asset.direction ||
        asset.promptTitle ||
        '';
}

function buildOutputBaseFromAsset(asset, directionLibrary, fallbackCore = '') {
    const context = buildCreativeOutputNamingContext({
        ...asset,
        contentTitle: outputTitleFromAsset(asset) || fallbackCore,
        fallbackName: outputTitleFromAsset(asset) || fallbackCore,
        directionLibrary,
        strictLibraryTags: true
    });
    return context.outputNameBase || '';
}

function parsePromptMetadataText(text) {
    const lines = String(text || '').split(/\r?\n/);
    const metadata = {
        outputImages: []
    };
    const keyMap = {
        'Run ID': 'runId',
        'Prompt group': 'promptGroup',
        'Prompt title': 'promptTitle',
        'Direction': 'direction',
        'Table direction': 'tableDirection',
        'Matched direction': 'sourceDirectionPath',
        'Primary tag': 'primaryTag',
        'Secondary tag': 'secondaryTag',
        'Tertiary tag': 'tertiaryTag',
        'Content name': 'contentTitle',
        'Output name base': 'outputNameBase'
    };
    let inOutputImages = false;

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
            continue;
        }
        if (/^Prompt:/i.test(trimmed)) {
            break;
        }
        if (/^Output images:/i.test(trimmed)) {
            inOutputImages = true;
            continue;
        }
        if (inOutputImages) {
            const imageMatch = trimmed.match(/^-\s+(.+)$/);
            if (imageMatch) {
                metadata.outputImages.push(path.basename(imageMatch[1].trim()));
                continue;
            }
            inOutputImages = false;
        }

        const match = trimmed.match(/^([^:]+):\s*(.*)$/);
        if (!match) {
            continue;
        }
        const key = keyMap[match[1].trim()];
        if (key) {
            metadata[key] = match[2].trim();
        }
    }

    return metadata;
}

function buildOutputBaseFromPromptMetadata(metadata, directionLibrary, fallbackCore = '') {
    if (!metadata || typeof metadata !== 'object') {
        return '';
    }
    const standardLabelPath = [
        metadata.primaryTag,
        metadata.secondaryTag,
        metadata.tertiaryTag
    ].filter(Boolean);
    const contentTitle = metadata.contentTitle ||
        metadata.direction ||
        metadata.tableDirection ||
        metadata.outputNameBase ||
        fallbackCore;
    const context = buildCreativeOutputNamingContext({
        ...metadata,
        standardLabelPath,
        sourceDirectionPath: metadata.sourceDirectionPath || standardLabelPath.join('/'),
        contentTitle,
        fallbackName: contentTitle || fallbackCore,
        strictLibraryTags: false,
        directionLibrary
    });
    return context.outputNameBase || '';
}

function mapPromptMetadataByFileName(targetDir, directionLibrary) {
    const byName = new Map();
    const textFiles = fs.readdirSync(targetDir)
        .filter(name => name.endsWith('.prompt.txt'));

    for (const fileName of textFiles) {
        const filePath = path.join(targetDir, fileName);
        let metadata;
        try {
            metadata = parsePromptMetadataText(fs.readFileSync(filePath, 'utf8'));
        } catch (error) {
            continue;
        }
        const promptParts = parseGeneratedName(fileName);
        const fallbackCore = promptParts ? promptParts.core : (metadata.contentTitle || metadata.direction || '');
        const newCore = buildOutputBaseFromPromptMetadata(metadata, directionLibrary, fallbackCore);
        if (!newCore) {
            continue;
        }

        const entry = {
            metadata,
            newCore,
            source: 'prompt-metadata'
        };
        byName.set(fileName, entry);
        for (const imageName of metadata.outputImages || []) {
            if (imageName) {
                byName.set(path.basename(imageName), entry);
            }
        }
    }

    return byName;
}

function buildSameCoreAssetBaseMap(assets, targetDir, directionLibrary) {
    const candidates = new Map();
    const targetKey = normalizePathForCompare(targetDir);

    for (const asset of assets) {
        const names = [asset.fileName, asset.relativePath, asset.filePath]
            .map(value => path.basename(String(value || '')))
            .filter(Boolean);
        const isInTarget = names.some(name => fs.existsSync(path.join(targetDir, name))) ||
            [asset.filePath, asset.promptFilePath].filter(Boolean).some(value => {
                const resolved = path.resolve(String(value));
                return normalizePathForCompare(path.dirname(resolved)) === targetKey;
            });

        if (!isInTarget) {
            continue;
        }

        const oldName = names.find(name => parseGeneratedName(name));
        const parts = oldName ? parseGeneratedName(oldName) : null;
        if (!parts || !parts.core) {
            continue;
        }

        const newCore = buildOutputBaseFromAsset(asset, directionLibrary, parts.core);
        if (!newCore || newCore === parts.core) {
            continue;
        }

        const key = labelKey([parts.core]);
        const list = candidates.get(key) || [];
        list.push(newCore);
        candidates.set(key, list);
    }

    const result = new Map();
    for (const [key, values] of candidates.entries()) {
        const unique = uniqueList(values);
        if (unique.length === 1) {
            result.set(key, unique[0]);
        }
    }
    return result;
}

function inferLegacyOutputBaseFromCore(core) {
    const parts = splitCoreParts(core);
    let index = 0;
    while (index < parts.length && /^(?:ref|prompt)\d+$/i.test(parts[index])) {
        index += 1;
    }
    if (index < parts.length && /^v\d+$/i.test(parts[index])) {
        index += 1;
    }

    const title = parts.slice(index).join('_');
    return sanitizeFileNamePart(title, 80);
}

function buildCoreLabelMetadata(core, labelPrefixes) {
    const parts = splitCoreParts(core);
    let labelLevel = 0;
    for (let level = Math.min(3, parts.length); level >= 1; level--) {
        if (labelPrefixes.has(labelKey(parts.slice(0, level)))) {
            labelLevel = level;
            break;
        }
    }

    const standardLabelPath = labelLevel ? parts.slice(0, labelLevel) : [];
    return {
        standardLabelPath,
        primaryTag: standardLabelPath[0] || '',
        secondaryTag: standardLabelPath[1] || '',
        tertiaryTag: standardLabelPath[2] || '',
        directionPath: standardLabelPath.join('/'),
        directionName: standardLabelPath[standardLabelPath.length - 1] || '',
        contentTitle: parts.slice(labelLevel).join('_')
    };
}

function deriveDroppedLabelParts(oldCore, newCore, newStandardLabelPath) {
    const oldParts = splitCoreParts(oldCore);
    const newParts = splitCoreParts(newCore);
    let start = 0;
    for (const label of newStandardLabelPath) {
        if (start < oldParts.length && labelKey([oldParts[start]]) === labelKey([label])) {
            start += 1;
        }
    }

    const newTitleParts = newParts.slice(newStandardLabelPath.length);
    let end = oldParts.length;
    for (let index = newTitleParts.length - 1; index >= 0 && end > start; index--) {
        if (labelKey([oldParts[end - 1]]) !== labelKey([newTitleParts[index]])) {
            break;
        }
        end -= 1;
    }

    return uniqueList(oldParts.slice(start, end));
}

function inferOutputBaseFromCore(core, directionLibrary, labelPrefixes) {
    const parts = splitCoreParts(core);
    if (!parts.length) return '';

    const legacyBase = inferLegacyOutputBaseFromCore(core);
    if (legacyBase && legacyBase !== core) {
        return legacyBase;
    }

    let bestLevel = 0;
    for (let level = Math.min(3, parts.length); level >= 1; level--) {
        if (labelPrefixes.has(labelKey(parts.slice(0, level)))) {
            bestLevel = level;
            break;
        }
    }
    if (!bestLevel) return '';

    const remaining = parts.slice(bestLevel);
    if (!remaining.length) return '';

    const contentTitle = remaining.length >= 2 ? remaining[remaining.length - 1] : remaining[0];
    const context = buildCreativeOutputNamingContext({
        sourceDirectionPath: parts.slice(0, bestLevel).join('/'),
        sourceRawName: core,
        contentTitle,
        fallbackName: contentTitle,
        directionLibrary,
        strictLibraryTags: true
    });
    return context.outputNameBase || '';
}

function mapByFileName(assets, targetDir) {
    const byName = new Map();
    const targetKey = normalizePathForCompare(targetDir);
    for (const asset of assets) {
        const names = [asset.fileName, asset.relativePath, asset.promptFileName]
            .map(value => path.basename(String(value || '')))
            .filter(Boolean);
        for (const name of names) {
            if (!byName.has(name)) byName.set(name, asset);
        }

        const paths = [asset.filePath, asset.promptFilePath].filter(Boolean);
        for (const value of paths) {
            const resolved = path.resolve(String(value));
            if (normalizePathForCompare(path.dirname(resolved)) === targetKey) {
                byName.set(path.basename(resolved), asset);
            }
        }
    }
    return byName;
}

function addMapping(mappings, mapping, targetDir) {
    if (!mapping || !mapping.oldName || !mapping.newName || mapping.oldName === mapping.newName) return;
    const oldPath = assertInsideDirectory(path.join(targetDir, mapping.oldName), targetDir);
    const newPath = assertInsideDirectory(path.join(targetDir, mapping.newName), targetDir);
    mappings.push({
        ...mapping,
        oldPath,
        newPath
    });
}

function buildMappings({ targetDir, rootDir, directionLibrary, includeLegacy }) {
    const { assets } = loadAssets(rootDir);
    const assetsByName = mapByFileName(assets, targetDir);
    const promptMetadataByName = mapPromptMetadataByFileName(targetDir, directionLibrary);
    const sameCoreAssetBaseByCore = buildSameCoreAssetBaseMap(assets, targetDir, directionLibrary);
    const labelPrefixes = buildLabelPrefixes(directionLibrary);
    const files = fs.readdirSync(targetDir, { withFileTypes: true })
        .filter(entry => entry.isFile())
        .map(entry => entry.name);
    const mappings = [];

    for (const fileName of files) {
        const ext = path.extname(fileName).toLowerCase();
        const isPrompt = fileName.endsWith('.prompt.txt');
        if (!isPrompt && !IMAGE_EXTENSIONS.has(ext)) continue;

        const parts = parseGeneratedName(fileName);
        if (!parts) continue;
        if (parts.kind === 'legacy-image' && !includeLegacy && !assetsByName.has(fileName)) continue;

        const asset = assetsByName.get(fileName) || null;
        const promptMetadata = promptMetadataByName.get(fileName) || null;
        const sameCoreAssetBase = sameCoreAssetBaseByCore.get(labelKey([parts.core])) || '';
        let source = '';
        let newCore = '';
        if (asset) {
            newCore = buildOutputBaseFromAsset(asset, directionLibrary, parts.core);
            source = 'asset-metadata';
        } else if (promptMetadata) {
            newCore = promptMetadata.newCore;
            source = promptMetadata.source;
        } else if (sameCoreAssetBase) {
            newCore = sameCoreAssetBase;
            source = 'same-core-asset-metadata';
        } else {
            newCore = inferOutputBaseFromCore(parts.core, directionLibrary, labelPrefixes);
            source = 'filename-inference';
        }
        if (!newCore || newCore === parts.core) continue;
        const labelMetadata = buildCoreLabelMetadata(newCore, labelPrefixes);

        addMapping(mappings, {
            oldName: fileName,
            newName: buildNameFromParts(parts, newCore),
            oldCore: parts.core,
            newCore,
            source,
            kind: parts.kind,
            labelMetadata,
            droppedLabelParts: deriveDroppedLabelParts(parts.core, newCore, labelMetadata.standardLabelPath)
        }, targetDir);
    }

    return mappings;
}

function isLegacyTechnicalMapping(mapping) {
    return mapping &&
        mapping.kind === 'legacy-image' &&
        /^ref\d+_prompt\d+_v\d+_/i.test(mapping.oldCore);
}

function dedupeAndValidateMappings(mappings, targetDir) {
    const byOld = new Map();
    for (const mapping of mappings) {
        const oldKey = mapping.oldName.toLowerCase();
        if (!byOld.has(oldKey)) {
            byOld.set(oldKey, mapping);
        }
    }

    const unique = Array.from(byOld.values());
    const targetCounts = new Map();
    for (const mapping of unique) {
        const key = mapping.newName.toLowerCase();
        targetCounts.set(key, (targetCounts.get(key) || 0) + 1);
    }

    const valid = [];
    const skipped = [];
    const oldNames = new Set(unique.map(item => item.oldName.toLowerCase()));
    for (const mapping of unique) {
        const targetKey = mapping.newName.toLowerCase();
        if (targetCounts.get(targetKey) > 1) {
            skipped.push({ ...mapping, reason: 'duplicate-target-in-plan' });
            continue;
        }
        if (fs.existsSync(mapping.newPath) && !oldNames.has(path.basename(mapping.newPath).toLowerCase())) {
            skipped.push({ ...mapping, reason: 'target-exists' });
            continue;
        }
        assertInsideDirectory(mapping.oldPath, targetDir);
        assertInsideDirectory(mapping.newPath, targetDir);
        valid.push(mapping);
    }

    return { valid, skipped };
}

function renameFiles(validMappings, targetDir) {
    const tempMappings = [];
    for (const mapping of validMappings) {
        const tempName = `.__rename_tmp_${crypto.randomBytes(8).toString('hex')}__${mapping.oldName}`;
        const tempPath = assertInsideDirectory(path.join(targetDir, tempName), targetDir);
        fs.renameSync(mapping.oldPath, tempPath);
        tempMappings.push({ ...mapping, tempPath, tempName });
    }

    for (const mapping of tempMappings) {
        fs.renameSync(mapping.tempPath, mapping.newPath);
    }
}

function replaceFileNameStrings(value, replacements, key = '') {
    if (typeof value === 'string') {
        let output = value;
        let replacedFileName = false;
        for (const item of replacements) {
            if (output.includes(item.oldName)) {
                output = output.split(item.oldName).join(item.newName);
                replacedFileName = true;
            }
        }
        if (CORE_STRING_KEYS.has(key) && !replacedFileName) {
            const exactCoreMatch = replacements.find(item => output === item.oldCore);
            if (exactCoreMatch) {
                output = exactCoreMatch.newCore;
            }
        }
        return output;
    }
    if (Array.isArray(value)) {
        return value.map(item => replaceFileNameStrings(item, replacements, key));
    }
    if (value && typeof value === 'object') {
        const metadataMapping = findMetadataMapping(value, replacements);
        const next = {};
        for (const [key, child] of Object.entries(value)) {
            next[key] = replaceFileNameStrings(child, replacements, key);
        }
        applyLabelMetadata(next, metadataMapping);
        return next;
    }
    return value;
}

function directStrings(object) {
    return Object.entries(object)
        .filter(([, value]) => typeof value === 'string')
        .map(([key, value]) => ({ key, value }));
}

function findMetadataMapping(object, replacements) {
    const strings = directStrings(object);
    if (!strings.length) return null;
    for (const mapping of replacements) {
        for (const { key, value } of strings) {
            if (value.includes(mapping.oldName)) {
                return mapping;
            }
            if (CORE_STRING_KEYS.has(key) && value.includes(mapping.oldCore)) {
                return mapping;
            }
        }
    }
    return null;
}

function hasAnyLabelField(object) {
    return Object.keys(object).some(key => LABEL_KEYS.has(key));
}

function shouldPatchLabelMetadata(object, mapping) {
    if (!mapping || !mapping.labelMetadata || !mapping.labelMetadata.standardLabelPath.length) {
        return false;
    }
    if (hasAnyLabelField(object)) {
        return true;
    }
    return Object.prototype.hasOwnProperty.call(object, 'outputNameBase');
}

function applyLabelMetadata(object, mapping) {
    if (!shouldPatchLabelMetadata(object, mapping)) {
        return;
    }

    const meta = mapping.labelMetadata;
    object.standardLabelPath = meta.standardLabelPath;
    object.primaryTag = meta.primaryTag;
    object.secondaryTag = meta.secondaryTag;
    object.tertiaryTag = meta.tertiaryTag;
    object.sourceDirectionPath = meta.directionPath;
    object.sourceParsedParts = meta.standardLabelPath;
    object.droppedLabelParts = uniqueList([]
        .concat(Array.isArray(object.droppedLabelParts) ? object.droppedLabelParts : [])
        .concat(mapping.droppedLabelParts || []));

    if (Object.prototype.hasOwnProperty.call(object, 'directionPath')) {
        object.directionPath = meta.directionPath;
    }
    if (Object.prototype.hasOwnProperty.call(object, 'directionName')) {
        object.directionName = meta.directionName;
    }
}

function updateJsonMetadata(rootDir, mappings) {
    const files = [
        path.join(rootDir, 'data', 'creative-knowledge', 'assets.json')
    ];
    const runsDir = path.join(rootDir, 'data', 'creative-knowledge', 'runs');
    if (fs.existsSync(runsDir)) {
        for (const name of fs.readdirSync(runsDir)) {
            if (name.endsWith('.json')) files.push(path.join(runsDir, name));
        }
    }

    const touched = [];
    for (const filePath of files) {
        if (!fs.existsSync(filePath)) continue;
        const before = fs.readFileSync(filePath, 'utf8');
        if (!mappings.some(mapping => before.includes(mapping.oldName) || before.includes(mapping.oldCore))) {
            continue;
        }
        const payload = JSON.parse(before);
        const next = replaceFileNameStrings(payload, mappings);
        const after = JSON.stringify(next, null, 2);
        if (after !== before) {
            writeJsonAtomic(filePath, next);
            touched.push(path.relative(rootDir, filePath));
        }
    }
    return touched;
}

function updatePromptTextFiles(targetDir, mappings) {
    const textFiles = fs.readdirSync(targetDir)
        .filter(name => name.endsWith('.prompt.txt'));
    const outputNameBaseByPromptFile = new Map();
    for (const mapping of mappings) {
        if (mapping.kind === 'prompt' && mapping.newName && mapping.newCore) {
            outputNameBaseByPromptFile.set(mapping.newName, mapping.newCore);
        }
    }
    const touched = [];
    for (const name of textFiles) {
        const filePath = path.join(targetDir, name);
        let text = fs.readFileSync(filePath, 'utf8');
        const before = text;
        for (const mapping of mappings) {
            text = text.split(mapping.oldName).join(mapping.newName);
        }
        const outputNameBase = outputNameBaseByPromptFile.get(name);
        if (outputNameBase) {
            text = text.replace(/^Output name base:.*$/m, `Output name base: ${outputNameBase}`);
        }
        if (text !== before) {
            fs.writeFileSync(filePath, text, 'utf8');
            touched.push(name);
        }
    }
    return touched;
}

function writeReport(rootDir, report) {
    const dir = path.join(rootDir, 'data', 'rename-reports');
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '_');
    const filePath = path.join(dir, `creative-output-rename-${stamp}.json`);
    writeJsonAtomic(filePath, report);
    return filePath;
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help || !args.dir) {
        console.log(usage());
        process.exit(args.help ? 0 : 1);
    }

    const rootDir = path.resolve(__dirname, '..');
    const targetDir = path.resolve(args.dir);
    if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
        throw new Error(`Target directory does not exist: ${targetDir}`);
    }

    const directionLibrary = loadDirectionLibrary(rootDir);
    let mappings = buildMappings({
        targetDir,
        rootDir,
        directionLibrary,
        includeLegacy: args.includeLegacy
    });
    if (args.legacyOnly) {
        mappings = mappings.filter(isLegacyTechnicalMapping);
    }
    const { valid, skipped } = dedupeAndValidateMappings(mappings, targetDir);
    const report = {
        mode: args.apply ? 'apply' : 'dry-run',
        targetDir,
        totalCandidates: mappings.length,
        renameCount: valid.length,
        skippedCount: skipped.length,
        skipped,
        mappings: valid.map(item => ({
            oldName: item.oldName,
            newName: item.newName,
            source: item.source,
            kind: item.kind,
            oldCore: item.oldCore,
            newCore: item.newCore
        })),
        jsonTouched: [],
        promptTextTouched: []
    };

    if (args.apply && valid.length) {
        renameFiles(valid, targetDir);
        report.promptTextTouched = updatePromptTextFiles(targetDir, valid);
        if (args.syncJson) {
            report.jsonTouched = updateJsonMetadata(rootDir, valid);
        }
    }

    const reportPath = writeReport(rootDir, report);
    console.log(JSON.stringify({
        mode: report.mode,
        targetDir,
        renameCount: report.renameCount,
        skippedCount: report.skippedCount,
        reportPath
    }, null, 2));

    if (!args.apply && valid.length) {
        console.log('Sample mappings:');
        valid.slice(0, 20).forEach((item, index) => {
            console.log(`${index + 1}. ${item.oldName} -> ${item.newName}`);
        });
    }
}

main();
