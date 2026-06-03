const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { CreativeKnowledgeStore } = require('./creative-knowledge/store');

const MANIFEST_FILE_NAME = 'postprocess-manifest.json';
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif']);

function nowIso() {
    return new Date().toISOString();
}

function normalizePathKey(value) {
    const text = String(value || '').trim();
    return text ? path.normalize(text).toLowerCase() : '';
}

function normalizeInputPath(value) {
    if (typeof value !== 'string') {
        return '';
    }
    return value.replace(/["']/g, '').trim().replace(/\\/g, '/');
}

function safeArray(value) {
    return Array.isArray(value) ? value : [];
}

function hashId(prefix, parts) {
    const hash = crypto
        .createHash('sha1')
        .update(parts.map(part => String(part || '')).join('|'))
        .digest('hex')
        .slice(0, 16);
    return `${prefix}_${hash}`;
}

function isImageFile(filePath) {
    return IMAGE_EXTENSIONS.has(path.extname(String(filePath || '')).toLowerCase());
}

function getUniqueFilePath(outputFolder, fileName, usedNames) {
    const parsed = path.parse(fileName);
    const baseName = parsed.name || 'asset';
    const ext = parsed.ext || '.png';
    let counter = 1;
    let outputName = `${baseName}${ext}`;

    while (
        usedNames.has(outputName.toLowerCase()) ||
        fs.existsSync(path.join(outputFolder, outputName))
    ) {
        counter += 1;
        outputName = `${baseName}_${String(counter).padStart(2, '0')}${ext}`;
    }

    usedNames.add(outputName.toLowerCase());
    return path.join(outputFolder, outputName);
}

function compactDerivative(derivative = {}) {
    return {
        derivativeId: derivative.derivativeId || '',
        operation: derivative.operation || '',
        status: derivative.status || 'completed',
        outputPath: derivative.outputPath || '',
        outputName: derivative.outputName || '',
        outputFolder: derivative.outputFolder || '',
        sourceAssetId: derivative.sourceAssetId || '',
        sourceRunId: derivative.sourceRunId || '',
        sourcePromptId: derivative.sourcePromptId || '',
        sourceFilePath: derivative.sourceFilePath || '',
        runId: derivative.runId || '',
        targetSize: derivative.targetSize || '',
        packageFolderName: derivative.packageFolderName || '',
        message: derivative.message || '',
        createdAt: derivative.createdAt || nowIso()
    };
}

function derivativeKey(derivative = {}) {
    return [
        derivative.operation,
        normalizePathKey(derivative.outputPath),
        derivative.sourceAssetId,
        derivative.status
    ].join('|');
}

function buildAssetIndex(assets = []) {
    const byPath = new Map();
    const byAssetId = new Map();

    safeArray(assets).forEach(asset => {
        if (!asset || !asset.assetId) return;
        byAssetId.set(asset.assetId, asset);

        const fileKey = normalizePathKey(asset.filePath);
        if (fileKey) byPath.set(fileKey, asset);

        safeArray(asset.postprocess && asset.postprocess.derivatives).forEach(derivative => {
            const outputKey = normalizePathKey(derivative.outputPath);
            if (outputKey) byPath.set(outputKey, asset);
        });
    });

    return { byPath, byAssetId };
}

function readManifest(inputFolder) {
    const folder = normalizeInputPath(inputFolder);
    if (!folder) {
        return {
            byPath: new Map(),
            manifest: null
        };
    }

    const manifestPath = path.join(folder, MANIFEST_FILE_NAME);
    if (!fs.existsSync(manifestPath)) {
        return {
            byPath: new Map(),
            manifest: null
        };
    }

    const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const byPath = new Map();
    safeArray(parsed.assets).forEach(entry => {
        const key = normalizePathKey(entry.preparedFilePath || entry.filePath || entry.outputPath);
        if (key) byPath.set(key, entry);
    });

    return {
        byPath,
        manifest: parsed
    };
}

function resolveSourceAsset(item, index, manifestIndex, assetIndex) {
    const sourcePath = item && (item.sourcePath || item.inputPath || item.filePath);
    const manifestEntry = manifestIndex.byPath.get(normalizePathKey(sourcePath));
    if (manifestEntry && manifestEntry.assetId) {
        const asset = assetIndex.byAssetId.get(manifestEntry.assetId);
        if (asset) return asset;
    }

    if (item && item.sourceAssetId) {
        const asset = assetIndex.byAssetId.get(item.sourceAssetId);
        if (asset) return asset;
    }

    const byPath = assetIndex.byPath.get(normalizePathKey(sourcePath));
    if (byPath) return byPath;

    return null;
}

function normalizeOperationItems(operation, result = {}, successItemsKey, failedItemsKey) {
    const successItems = safeArray(result[successItemsKey]).flatMap(item => {
        if (operation === 'package') {
            return safeArray(item.files).map(file => ({
                ...file,
                outputPath: file.outputPath,
                outputName: file.originalName,
                packageFolderName: item.folderName || item.outputName || '',
                status: 'completed'
            }));
        }

        return [{
            ...item,
            status: 'completed'
        }];
    });

    const failedItems = safeArray(result[failedItemsKey]).flatMap(item => {
        if (operation === 'package' && Array.isArray(item.files)) {
            return item.files.map(file => ({
                ...file,
                outputPath: file.outputPath || '',
                outputName: file.originalName || '',
                packageFolderName: item.folderName || item.outputName || '',
                status: 'failed',
                reason: item.reason || file.reason || ''
            }));
        }

        return [{
            ...item,
            status: 'failed'
        }];
    });

    return successItems.concat(failedItems);
}

function createPostprocessTraceService(context = {}) {
    const rootDir = context.rootDir || context.ROOT_DIR || path.join(__dirname, '..', '..');
    const dataDir = path.join(rootDir, 'data', 'creative-knowledge');
    const store = new CreativeKnowledgeStore(dataDir);

    function readAssetsData() {
        store.ensureBase();
        return store.read('assets.json', {
            version: 1,
            assets: [],
            updatedAt: nowIso()
        });
    }

    function writeAssetsData(data) {
        store.write('assets.json', {
            ...data,
            version: data.version || 1,
            updatedAt: nowIso()
        });
    }

    function recordOperationResult({
        operation,
        result = {},
        successItemsKey,
        failedItemsKey = 'failed',
        config = {}
    }) {
        const normalizedOperation = String(operation || '').trim();
        if (!normalizedOperation) {
            return {
                success: false,
                matchedCount: 0,
                derivativeCount: 0,
                message: 'missing_operation'
            };
        }

        const data = readAssetsData();
        const assets = safeArray(data.assets);
        if (!assets.length) {
            return {
                success: true,
                matchedCount: 0,
                derivativeCount: 0,
                unmatchedCount: 0,
                message: 'no_assets_to_trace'
            };
        }

        const manifestIndex = readManifest(result.inputFolder || config.inputFolder);
        const assetIndex = buildAssetIndex(assets);
        const items = normalizeOperationItems(normalizedOperation, result, successItemsKey, failedItemsKey);
        const runId = hashId('postprocess_run', [
            normalizedOperation,
            result.inputFolder,
            result.outputFolder,
            nowIso()
        ]);
        const timestamp = nowIso();
        const matched = [];
        const unmatched = [];

        items.forEach((item, index) => {
            const sourceAsset = resolveSourceAsset(item, index, manifestIndex, assetIndex);
            if (!sourceAsset) {
                unmatched.push(item.sourcePath || item.originalName || item.outputPath || '');
                return;
            }

            const outputPath = item.outputPath ? path.normalize(item.outputPath) : '';
            const derivative = compactDerivative({
                derivativeId: hashId('derivative', [
                    normalizedOperation,
                    sourceAsset.assetId,
                    item.sourcePath,
                    outputPath,
                    item.status
                ]),
                operation: normalizedOperation,
                status: item.status || 'completed',
                outputPath,
                outputName: item.outputName || (outputPath ? path.basename(outputPath) : ''),
                outputFolder: result.outputFolder || config.outputFolder || '',
                sourceAssetId: sourceAsset.assetId || '',
                sourceRunId: sourceAsset.runId || '',
                sourcePromptId: sourceAsset.promptHash || sourceAsset.promptIndex || '',
                sourceFilePath: item.sourcePath || sourceAsset.filePath || '',
                runId,
                targetSize: item.targetDimensions || result.targetSize || config.targetSize || '',
                packageFolderName: item.packageFolderName || '',
                message: item.reason || '',
                createdAt: timestamp
            });

            if (derivative.status === 'completed' && (!derivative.outputPath || !fs.existsSync(derivative.outputPath))) {
                derivative.status = 'missing_output';
                derivative.message = derivative.message || 'output_file_missing';
            }

            const existing = sourceAsset.postprocess && Array.isArray(sourceAsset.postprocess.derivatives)
                ? sourceAsset.postprocess.derivatives
                : [];
            const nextByKey = new Map(existing.map(entry => [derivativeKey(entry), entry]));
            nextByKey.set(derivativeKey(derivative), derivative);
            sourceAsset.postprocess = {
                ...(sourceAsset.postprocess || {}),
                updatedAt: timestamp,
                derivatives: Array.from(nextByKey.values())
                    .map(compactDerivative)
                    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
            };
            matched.push(derivative);
        });

        if (matched.length) {
            writeAssetsData({
                ...data,
                assets
            });
        }

        return {
            success: true,
            runId,
            operation: normalizedOperation,
            manifestId: manifestIndex.manifest && manifestIndex.manifest.manifestId || '',
            matchedCount: matched.length,
            derivativeCount: matched.length,
            unmatchedCount: unmatched.filter(Boolean).length,
            unmatched: unmatched.filter(Boolean).slice(0, 20),
            derivatives: matched
        };
    }

    function prepareAssets(payload = {}) {
        const assetIds = safeArray(payload.assetIds)
            .map(value => String(value || '').trim())
            .filter(Boolean);
        if (!assetIds.length) {
            throw new Error('请先选择要送入后处理的资产');
        }

        const data = readAssetsData();
        const assetById = new Map(safeArray(data.assets).map(asset => [asset.assetId, asset]));
        const selected = assetIds
            .map(assetId => assetById.get(assetId))
            .filter(asset => asset && asset.filePath && fs.existsSync(asset.filePath) && isImageFile(asset.filePath));

        if (!selected.length) {
            throw new Error('选中的资产没有可读取的本地图片文件');
        }

        const manifestId = hashId('postprocess_manifest', [assetIds.join(','), nowIso()]);
        const outputFolder = normalizeInputPath(payload.outputFolder)
            || path.join(rootDir, 'data', 'postprocess', 'selected-assets', manifestId);
        fs.mkdirSync(outputFolder, { recursive: true });

        const usedNames = new Set();
        const copied = selected.map((asset, index) => {
            const sourceName = path.basename(asset.filePath);
            const preparedPath = getUniqueFilePath(
                outputFolder,
                `${String(index + 1).padStart(2, '0')}_${sourceName}`,
                usedNames
            );
            fs.copyFileSync(asset.filePath, preparedPath);

            return {
                assetId: asset.assetId,
                sourceRunId: asset.runId || '',
                sourcePromptId: asset.promptHash || asset.promptIndex || '',
                sourceFilePath: asset.filePath,
                preparedFilePath: preparedPath,
                preparedFileName: path.basename(preparedPath),
                fileName: asset.fileName || sourceName
            };
        });

        const manifest = {
            version: 1,
            manifestId,
            source: 'creative-knowledge-assets',
            createdAt: nowIso(),
            outputFolder,
            assets: copied
        };
        fs.writeFileSync(path.join(outputFolder, MANIFEST_FILE_NAME), JSON.stringify(manifest, null, 2), 'utf8');

        return {
            success: true,
            manifestId,
            outputFolder,
            count: copied.length,
            manifestPath: path.join(outputFolder, MANIFEST_FILE_NAME),
            assets: copied
        };
    }

    return {
        recordOperationResult,
        prepareAssets
    };
}

module.exports = {
    MANIFEST_FILE_NAME,
    createPostprocessTraceService
};
