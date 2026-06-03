const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

function readJson(filePath, fallback) {
    if (!fs.existsSync(filePath)) return fallback;
    const text = fs.readFileSync(filePath, 'utf8');
    if (!text.trim()) return fallback;
    return JSON.parse(text);
}

function writeJson(filePath, data) {
    ensureDir(path.dirname(filePath));
    const tempPath = `${filePath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tempPath, filePath);
}

function hashText(value) {
    return crypto
        .createHash('sha1')
        .update(String(value || '').trim())
        .digest('hex');
}

class MaterialVisionCache {
    constructor(rootDir) {
        this.rootDir = rootDir || process.cwd();
        this.baseDir = path.join(this.rootDir, 'data', 'material-analysis', 'vision');
        this.cacheDir = path.join(this.baseDir, 'cache');
        this.runsDir = path.join(this.baseDir, 'runs');
    }

    ensureBase() {
        ensureDir(this.cacheDir);
        ensureDir(this.runsDir);
    }

    imageHashForUrl(url) {
        return hashText(url || 'missing-url');
    }

    imageHashForMaterial(material = {}) {
        return this.imageHashForUrl(material.contentUrl || material.contentText || material.materialName || material.materialId);
    }

    cachePath(imageHash) {
        this.ensureBase();
        return path.join(this.cacheDir, `${imageHash}.json`);
    }

    readImageCache(imageHash) {
        if (!imageHash) return null;
        return readJson(this.cachePath(imageHash), null);
    }

    writeImageCache(imageHash, payload) {
        if (!imageHash) return null;
        const next = {
            ...payload,
            imageHash,
            cachedAt: payload.cachedAt || new Date().toISOString()
        };
        writeJson(this.cachePath(imageHash), next);
        return next;
    }

    runPath(runId) {
        this.ensureBase();
        return path.join(this.runsDir, `${runId}.json`);
    }

    readRun(runId) {
        return readJson(this.runPath(runId), null);
    }

    writeRun(runId, payload) {
        const next = {
            runId,
            ...payload,
            updatedAt: new Date().toISOString()
        };
        writeJson(this.runPath(runId), next);
        return next;
    }
}

module.exports = {
    MaterialVisionCache,
    hashText
};
