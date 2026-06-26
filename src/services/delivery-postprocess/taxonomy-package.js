const fs = require('fs');
const path = require('path');

const TAXONOMY_PACKAGE_FOLDER_NAME = '标签分类交付包';
const TAXONOMY_PACKAGE_MANIFEST_NAME = '标签分类交付包_manifest.json';
const DEFAULT_DIRECTION_LIBRARY_PATH = path.join(__dirname, '..', '..', '..', 'data', 'creative-knowledge', 'directions.json');

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

function readJson(filePath, fallback) {
    try {
        if (!filePath || !fs.existsSync(filePath)) {
            return fallback;
        }
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
        return fallback;
    }
}

function writeJson(filePath, data) {
    ensureDir(path.dirname(filePath));
    const tempPath = `${filePath}.tmp`;
    fs.writeFileSync(tempPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    fs.renameSync(tempPath, filePath);
}

function normalizeText(value) {
    return String(value || '').replace(/\s+/g, '').replace(/[\\/_-]+/g, '').trim();
}

function cleanPart(value) {
    return String(value || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim();
}

function splitPathParts(value) {
    return String(value || '')
        .split(/[\/\\>｜|]+/)
        .map(part => cleanPart(part))
        .filter(Boolean);
}

function extractKeywordParts(value) {
    return String(value || '')
        .split(/[\/\\>｜|\s,，;；、。:：()（）\[\]【】]+/)
        .map(part => cleanPart(part))
        .filter(Boolean);
}

function uniqueValues(values = []) {
    const seen = new Set();
    const output = [];
    values.forEach(value => {
        const text = cleanPart(value);
        const key = normalizeText(text);
        if (!text || seen.has(key)) return;
        seen.add(key);
        output.push(text);
    });
    return output;
}

function loadDirectionEntries(directionLibraryPath = DEFAULT_DIRECTION_LIBRARY_PATH) {
    const data = readJson(directionLibraryPath, { directions: [] });
    const directions = Array.isArray(data)
        ? data
        : (Array.isArray(data.directions) ? data.directions : []);

    return directions
        .map(direction => {
            const pathParts = splitPathParts(direction.path);
            const primary = cleanPart(direction.primaryTag || direction.primary || pathParts[0]);
            const secondary = cleanPart(direction.secondaryTag || direction.secondary || pathParts[1]);
            if (!primary) return null;

            const tertiary = cleanPart(direction.tertiaryTag || direction.tertiary || pathParts[2]);
            const subTag = cleanPart(direction.subTag || direction.name || pathParts[3]);
            const labels = uniqueValues([primary, secondary].filter(Boolean));
            const keywords = uniqueValues([
                primary,
                secondary,
                tertiary,
                subTag,
                direction.name,
                direction.path,
                direction.description
            ].flatMap(value => {
                const pathParts = splitPathParts(value);
                const keywordParts = extractKeywordParts(value);
                return [...pathParts, ...keywordParts, value];
            }));

            return {
                id: direction.id || '',
                labels,
                primary,
                secondary,
                tertiary,
                subTag,
                path: direction.path || labels.join('/'),
                keywords,
                searchableText: normalizeText([
                    direction.path,
                    direction.name,
                    primary,
                    secondary,
                    tertiary,
                    subTag,
                    direction.description
                ].filter(Boolean).join(' '))
            };
        })
        .filter(Boolean);
}

function buildTaxonomyIndex(entries = []) {
    const primaryTags = new Map();
    const primarySecondary = new Map();
    const buckets = new Map();

    entries.forEach(entry => {
        if (!entry.primary) return;
        const primaryKey = normalizeText(entry.primary);
        if (!primaryTags.has(primaryKey)) {
            primaryTags.set(primaryKey, entry.primary);
        }

        const labels = entry.secondary ? [entry.primary, entry.secondary] : [entry.primary];
        const key = labels.map(normalizeText).join('/');
        if (!buckets.has(key)) {
            buckets.set(key, {
                labels,
                primary: entry.primary,
                secondary: entry.secondary || '',
                directionIds: [],
                keywords: [],
                searchableText: ''
            });
        }
        const bucket = buckets.get(key);
        if (entry.id) {
            bucket.directionIds.push(entry.id);
        }
        bucket.keywords.push(...entry.keywords);
        bucket.searchableText = `${bucket.searchableText} ${entry.searchableText}`.trim();

        if (entry.secondary) {
            primarySecondary.set(key, labels);
        }
    });

    return {
        primaryTags,
        primarySecondary,
        buckets: Array.from(buckets.values()).map(bucket => ({
            ...bucket,
            directionIds: uniqueValues(bucket.directionIds),
            keywords: uniqueValues(bucket.keywords),
            searchableText: normalizeText([bucket.searchableText, ...bucket.keywords].join(' '))
        }))
    };
}

function buildRunNamingRuleEntry(run = {}) {
    const namingRule = run && run.namingRule && typeof run.namingRule === 'object'
        ? run.namingRule
        : {};
    const rawLabels = Array.isArray(namingRule.tagLevels) && namingRule.tagLevels.length
        ? namingRule.tagLevels
        : [namingRule.primaryTag, namingRule.secondaryTag, namingRule.tertiaryTag];
    const labels = rawLabels.map(cleanPart).filter(Boolean).slice(0, 2);
    if (!labels.length) {
        return null;
    }
    return {
        id: 'delivery-naming-rule',
        labels,
        primary: labels[0] || '',
        secondary: labels[1] || '',
        tertiary: '',
        subTag: '',
        path: labels.join('/'),
        keywords: labels,
        searchableText: normalizeText(labels.join(' '))
    };
}


function parsePackageFolderName(folderName, run = {}) {
    const parts = String(folderName || '').split('_').map(part => cleanPart(part)).filter(Boolean);
    const prefix = parts[0] || '';
    const region = parts[1] || '';
    const channel = parts[2] || '';
    const bodyParts = parts.slice(3);
    const contentName = bodyParts.length > 1 ? bodyParts[bodyParts.length - 1] : '';
    const labelCandidates = bodyParts.length > 1 ? bodyParts.slice(0, -1) : bodyParts;

    const labels = labelCandidates.filter(Boolean);
    return {
        prefix,
        region,
        channel,
        labels,
        contentName,
        searchableText: normalizeText([folderName, contentName, ...labels].join(' '))
    };
}

function scoreBucket(parsed, bucket) {
    const originalLabels = parsed.labels || [];
    const labelKeys = originalLabels.map(normalizeText);
    const primaryKey = normalizeText(bucket.primary);
    const secondaryKey = normalizeText(bucket.secondary);
    const searchText = parsed.searchableText || '';
    let score = 0;
    let exactPrimary = false;
    let exactSecondary = false;

    if (labelKeys[0] && labelKeys[0] === primaryKey) {
        score += 80;
        exactPrimary = true;
    } else if (labelKeys.includes(primaryKey)) {
        score += 45;
    }

    if (secondaryKey) {
        if (labelKeys[1] && labelKeys[1] === secondaryKey) {
            score += 90;
            exactSecondary = true;
        } else if (labelKeys.includes(secondaryKey)) {
            score += 55;
        } else if (searchText.includes(secondaryKey)) {
            score += 30;
        }
    }

    for (const labelKey of labelKeys.slice(2)) {
        if (!labelKey) continue;
        if (bucket.searchableText.includes(labelKey)) {
            score += 24;
        }
    }

    for (const keyword of bucket.keywords || []) {
        const key = normalizeText(keyword);
        if (!key || key.length < 2) continue;
        if (searchText.includes(key)) {
            score += key.length >= 4 ? 10 : 5;
        }
    }

    if (exactPrimary && exactSecondary) {
        score += 120;
    }

    return {
        score,
        exactPrimary,
        exactSecondary
    };
}

function resolveTaxonomyPath(parsed, index) {
    const labels = parsed.labels || [];
    const primaryKey = normalizeText(labels[0]);
    const secondaryKey = normalizeText(labels[1]);
    const contentKey = normalizeText(parsed.contentName);

    if (primaryKey && secondaryKey) {
        const exactKey = `${primaryKey}/${secondaryKey}`;
        const exact = index.buckets.find(bucket => bucket.labels.map(normalizeText).join('/') === exactKey);
        if (exact) {
            return {
                labels: exact.labels,
                matchedDirectionIds: exact.directionIds,
                matchedBy: 'exact-primary-secondary',
                matchConfidence: 'high',
                reviewRequired: false
            };
        }
    }

    if (primaryKey && !secondaryKey && contentKey) {
        const contentAsSecondary = index.buckets.find(bucket => {
            return normalizeText(bucket.primary) === primaryKey &&
                normalizeText(bucket.secondary) === contentKey;
        });
        if (contentAsSecondary) {
            return {
                labels: contentAsSecondary.labels,
                matchedDirectionIds: contentAsSecondary.directionIds,
                matchedBy: 'exact-primary-secondary-from-tail',
                matchConfidence: 'high',
                reviewRequired: false
            };
        }
    }

    if (primaryKey && index.primaryTags.has(primaryKey) && !secondaryKey) {
        return {
            labels: [index.primaryTags.get(primaryKey)],
            matchedDirectionIds: [],
            matchedBy: 'exact-primary',
            matchConfidence: 'high',
            reviewRequired: false
        };
    }

    const scored = index.buckets
        .map(bucket => ({
            bucket,
            ...scoreBucket(parsed, bucket)
        }))
        .filter(item => item.score > 0)
        .sort((a, b) => {
            if (a.score !== b.score) return b.score - a.score;
            return a.bucket.labels.length - b.bucket.labels.length;
        });

    const best = scored[0] || index.buckets[0];
    if (!best) {
        return {
            labels: labels.slice(0, 2).filter(Boolean),
            matchedDirectionIds: [],
            matchedBy: 'source-labels',
            matchConfidence: labels.length ? 'low' : 'none',
            reviewRequired: true
        };
    }

    const score = best.score || 0;
    return {
        labels: best.bucket.labels,
        matchedDirectionIds: best.bucket.directionIds,
        matchedBy: labels.length ? 'best-fit' : 'content-best-fit',
        matchConfidence: score >= 120 ? 'medium' : 'low',
        reviewRequired: true
    };
}

function copyDirectoryRecursive(sourceDir, targetDir) {
    ensureDir(targetDir);
    for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
        const sourcePath = path.join(sourceDir, entry.name);
        const targetPath = path.join(targetDir, entry.name);
        if (entry.isDirectory()) {
            copyDirectoryRecursive(sourcePath, targetPath);
        } else if (entry.isFile()) {
            ensureDir(path.dirname(targetPath));
            fs.copyFileSync(sourcePath, targetPath);
        }
    }
}

function countFiles(dirPath) {
    let count = 0;
    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
        const itemPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
            count += countFiles(itemPath);
        } else if (entry.isFile()) {
            count += 1;
        }
    }
    return count;
}

function buildFinalPackageRoot(run) {
    return path.join(run.outputFolder, run.runId, 'final-package');
}

function collectCurrentPackageDirs(run, finalPackageRoot) {
    const rootKey = path.resolve(finalPackageRoot).toLowerCase();
    const current = [];
    const seen = new Set();
    for (const job of Array.isArray(run.jobs) ? run.jobs : []) {
        const folder = job && job.postprocess && job.postprocess.finalPackageFolder
            ? job.postprocess.finalPackageFolder
            : '';
        if (!folder || !fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
            continue;
        }
        const resolved = path.resolve(folder);
        if (!resolved.toLowerCase().startsWith(rootKey)) {
            continue;
        }
        const key = resolved.toLowerCase();
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        current.push({
            name: path.basename(resolved),
            sourcePath: resolved
        });
    }
    return current.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true }));
}

function collectAllPackageDirs(finalPackageRoot) {
    return fs.readdirSync(finalPackageRoot, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => ({
            name: entry.name,
            sourcePath: path.join(finalPackageRoot, entry.name)
        }))
        .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true }));
}

function organizeFinalPackageByTaxonomy(run, options = {}) {
    if (!run || typeof run !== 'object') {
        throw new Error('delivery run 无效，无法生成标签分类交付包');
    }

    const finalPackageRoot = options.finalPackageRoot || run.finalPackageRoot || buildFinalPackageRoot(run);
    if (!fs.existsSync(finalPackageRoot) || !fs.statSync(finalPackageRoot).isDirectory()) {
        throw new Error(`最终交付包不存在：${finalPackageRoot}`);
    }

    const directionLibraryPath = options.directionLibraryPath || DEFAULT_DIRECTION_LIBRARY_PATH;
    const entries = loadDirectionEntries(directionLibraryPath);
    const runNamingRuleEntry = buildRunNamingRuleEntry(run);
    if (runNamingRuleEntry) {
        entries.push(runNamingRuleEntry);
    }
    const index = buildTaxonomyIndex(entries);
    if (!index.buckets.length) {
        throw new Error(`方向库没有可用的一二级标签：${directionLibraryPath}`);
    }

    const taxonomyPackageRoot = options.taxonomyPackageRoot || path.join(run.outputFolder, run.runId, TAXONOMY_PACKAGE_FOLDER_NAME);
    const manifestPath = options.manifestPath || path.join(run.outputFolder, run.runId, TAXONOMY_PACKAGE_MANIFEST_NAME);
    if (fs.existsSync(taxonomyPackageRoot)) {
        fs.rmSync(taxonomyPackageRoot, { recursive: true, force: true });
    }
    ensureDir(taxonomyPackageRoot);

    const currentPackageDirs = collectCurrentPackageDirs(run, finalPackageRoot);
    const packageDirs = currentPackageDirs.length
        ? currentPackageDirs
        : collectAllPackageDirs(finalPackageRoot);

    const items = [];
    for (const item of packageDirs) {
        const parsed = parsePackageFolderName(item.name, run);
        const resolved = resolveTaxonomyPath(parsed, index);
        const safeLabels = resolved.labels.map(cleanPart).filter(Boolean);
        const targetDir = path.join(taxonomyPackageRoot, ...safeLabels, item.name);
        copyDirectoryRecursive(item.sourcePath, targetDir);
        items.push({
            sourcePackageFolder: item.sourcePath,
            classifiedPackageFolder: targetDir,
            folderName: item.name,
            originalLabels: parsed.labels,
            matchedPath: safeLabels,
            matchedDirectionIds: resolved.matchedDirectionIds,
            matchedBy: resolved.matchedBy,
            matchConfidence: resolved.matchConfidence,
            reviewRequired: resolved.reviewRequired,
            fileCount: countFiles(targetDir)
        });
    }

    const exactMatchedCount = items.filter(item => /^exact/.test(item.matchedBy)).length;
    const bestFitCount = items.filter(item => item.matchedBy.includes('best-fit')).length;
    const reviewRequiredCount = items.filter(item => item.reviewRequired).length;
    const manifest = {
        runId: run.runId || '',
        finalPackageRoot,
        taxonomyPackageRoot,
        directionLibrarySource: directionLibraryPath,
        packageFolderName: TAXONOMY_PACKAGE_FOLDER_NAME,
        classificationDepth: 2,
        copyMode: 'copy-package-folder',
        packageSource: currentPackageDirs.length ? 'run-current-final-packages' : 'final-package-directory-scan',
        createdAt: new Date().toISOString(),
        totalPackages: packageDirs.length,
        classifiedPackages: items.length,
        exactMatchedCount,
        bestFitCount,
        reviewRequiredCount,
        items
    };
    writeJson(manifestPath, manifest);

    return {
        success: true,
        taxonomyPackageRoot,
        manifestPath,
        manifest,
        totalPackages: manifest.totalPackages,
        classifiedPackages: manifest.classifiedPackages,
        exactMatchedCount,
        bestFitCount,
        reviewRequiredCount
    };
}

module.exports = {
    TAXONOMY_PACKAGE_FOLDER_NAME,
    TAXONOMY_PACKAGE_MANIFEST_NAME,
    DEFAULT_DIRECTION_LIBRARY_PATH,
    organizeFinalPackageByTaxonomy,
    loadDirectionEntries,
    buildTaxonomyIndex,
    parsePackageFolderName,
    resolveTaxonomyPath
};
