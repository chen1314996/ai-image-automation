const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { normalizeImportSummaryFileNames } = require('./file-name');

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

function safeSegment(value, fallback = 'item') {
    const text = String(value || '').trim() || fallback;
    return text
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
        .replace(/\s+/g, '_')
        .slice(0, 100);
}

function sleepSync(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function isTransientFileError(error) {
    return error && ['EPERM', 'EACCES', 'EBUSY', 'ENOENT'].includes(error.code);
}

function readJson(filePath, fallback) {
    for (let attempt = 0; attempt < 8; attempt += 1) {
        try {
            if (!fs.existsSync(filePath)) return fallback;
            const text = fs.readFileSync(filePath, 'utf8');
            if (!text.trim()) return fallback;
            return JSON.parse(text);
        } catch (error) {
            if (attempt >= 7 || !isTransientFileError(error)) throw error;
            sleepSync(25 * (attempt + 1));
        }
    }
    return fallback;
}

function writeJson(filePath, data) {
    ensureDir(path.dirname(filePath));
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.${crypto.randomBytes(3).toString('hex')}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');

    for (let attempt = 0; attempt < 10; attempt += 1) {
        try {
            fs.renameSync(tempPath, filePath);
            return;
        } catch (error) {
            if (attempt >= 9 || !isTransientFileError(error)) {
                try {
                    fs.copyFileSync(tempPath, filePath);
                    fs.unlinkSync(tempPath);
                    return;
                } catch (fallbackError) {
                    try {
                        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
                    } catch (_) {
                        // Best-effort cleanup only.
                    }
                    throw fallbackError;
                }
            }
            sleepSync(35 * (attempt + 1));
        }
    }
}

function isPathInside(childPath, parentPath) {
    const relative = path.relative(path.resolve(parentPath), path.resolve(childPath));
    return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

class TaskWorkbookStore {
    constructor(rootDir) {
        this.rootDir = rootDir || process.cwd();
        this.baseDir = path.join(this.rootDir, 'data', 'task-workbooks');
        this.cacheDir = path.join(this.baseDir, 'vision-cache');
    }

    ensureBase() {
        ensureDir(this.baseDir);
        ensureDir(this.cacheDir);
    }

    importDir(importId) {
        return path.join(this.baseDir, safeSegment(importId, 'task_import'));
    }

    imageDir(importId) {
        return path.join(this.importDir(importId), 'images');
    }

    writeImport(payload) {
        this.ensureBase();
        const dir = this.importDir(payload.importId);
        ensureDir(dir);
        ensureDir(path.join(dir, 'images'));
        writeJson(path.join(dir, 'import-summary.json'), payload.summary);
        writeJson(path.join(dir, 'task-directions.json'), payload.taskDirections || []);
        writeJson(path.join(dir, 'hierarchy-definitions.json'), payload.hierarchyDefinitions || []);
        writeJson(path.join(dir, 'vision-results.json'), []);
        writeJson(path.join(dir, 'vision-status.json'), {
            importId: payload.importId,
            state: 'idle',
            running: false,
            total: payload.taskDirections ? payload.taskDirections.length : 0,
            completed: 0,
            successCount: 0,
            failedCount: 0,
            cachedCount: 0,
            pendingCount: payload.taskDirections ? payload.taskDirections.length : 0,
            updatedAt: new Date().toISOString(),
            message: '等待启动任务方向视觉整理'
        });
        return dir;
    }

    saveSourceWorkbook(importId, buffer, fileName = 'source.xlsx') {
        const dir = this.importDir(importId);
        ensureDir(dir);
        const ext = path.extname(fileName) || '.xlsx';
        const target = path.join(dir, `source${ext}`);
        fs.writeFileSync(target, buffer);
        return target;
    }

    saveImage(importId, fileName, buffer) {
        const dir = this.imageDir(importId);
        ensureDir(dir);
        const target = path.join(dir, safeSegment(fileName, 'image.jpeg'));
        fs.writeFileSync(target, buffer);
        return target;
    }

    listImports() {
        this.ensureBase();
        if (!fs.existsSync(this.baseDir)) return [];
        return fs.readdirSync(this.baseDir)
            .map(importId => {
                const dir = this.importDir(importId);
                if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return null;
                const summary = readJson(path.join(dir, 'import-summary.json'), null);
                return summary ? normalizeImportSummaryFileNames({ ...summary, importDir: dir }) : null;
            })
            .filter(Boolean)
            .sort((a, b) => String(b.importedAt || '').localeCompare(String(a.importedAt || '')));
    }

    findImport(importId) {
        return this.listImports().find(item => item.importId === importId) || null;
    }

    deleteImport(importId) {
        const found = this.findImport(importId);
        if (!found) return null;
        const targetDir = path.resolve(this.importDir(importId));
        const baseDir = path.resolve(this.baseDir);
        if (!isPathInside(targetDir, baseDir)) {
            throw new Error('Refusing to delete outside task workbook directory');
        }
        fs.rmSync(targetDir, { recursive: true, force: true });
        return found;
    }

    readSummary(importId) {
        return normalizeImportSummaryFileNames(readJson(path.join(this.importDir(importId), 'import-summary.json'), null));
    }

    readTaskDirections(importId) {
        return readJson(path.join(this.importDir(importId), 'task-directions.json'), []);
    }

    writeTaskDirections(importId, taskDirections) {
        writeJson(path.join(this.importDir(importId), 'task-directions.json'), taskDirections || []);
    }

    readHierarchyDefinitions(importId) {
        return readJson(path.join(this.importDir(importId), 'hierarchy-definitions.json'), []);
    }

    readVisionResults(importId) {
        return readJson(path.join(this.importDir(importId), 'vision-results.json'), []);
    }

    writeVisionResults(importId, results) {
        writeJson(path.join(this.importDir(importId), 'vision-results.json'), results || []);
    }

    readVisionStatus(importId) {
        return readJson(path.join(this.importDir(importId), 'vision-status.json'), null);
    }

    writeVisionStatus(importId, status) {
        const next = {
            importId,
            ...(status || {}),
            updatedAt: new Date().toISOString()
        };
        writeJson(path.join(this.importDir(importId), 'vision-status.json'), next);
        return next;
    }

    cachePath(cacheKey) {
        this.ensureBase();
        return path.join(this.cacheDir, `${safeSegment(cacheKey, 'cache')}.json`);
    }

    readVisionCache(cacheKey) {
        if (!cacheKey) return null;
        return readJson(this.cachePath(cacheKey), null);
    }

    writeVisionCache(cacheKey, payload) {
        if (!cacheKey) return null;
        const next = {
            ...(payload || {}),
            cacheKey,
            cachedAt: new Date().toISOString()
        };
        writeJson(this.cachePath(cacheKey), next);
        return next;
    }

    resolveImagePath(importId, fileName) {
        const dir = path.resolve(this.imageDir(importId));
        const target = path.resolve(dir, safeSegment(fileName, 'image'));
        if (!isPathInside(target, dir) && target !== dir) {
            return null;
        }
        return target;
    }
}

module.exports = {
    TaskWorkbookStore,
    safeSegment,
    readJson,
    writeJson
};
