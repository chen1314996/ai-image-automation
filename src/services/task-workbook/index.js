const fs = require('fs');
const path = require('path');
const { TaskWorkbookStore } = require('./store');
const { parseTaskWorkbook } = require('./parser');
const { createTaskDirectionVisionService } = require('./vision-service');

class TaskWorkbookService {
    constructor(options = {}) {
        this.rootDir = options.ROOT_DIR || options.rootDir || process.cwd();
        this.logger = options.logger;
        this.store = options.store || new TaskWorkbookStore(this.rootDir);
        this.vision = options.vision || createTaskDirectionVisionService({
            ...options,
            rootDir: this.rootDir,
            store: this.store
        });
    }

    importWorkbook(payload = {}) {
        const result = parseTaskWorkbook(payload, {
            store: this.store
        });
        if (this.logger && typeof this.logger.info === 'function') {
            this.logger.info(`自动化任务表导入完成：${result.importId}，任务方向 ${result.summary.taskDirectionCount}，参考图 ${result.summary.taskReferenceImageCount}`);
        }
        return result;
    }

    listImports() {
        return this.vision.listImports();
    }

    getImport(importId) {
        return this.vision.getImport(importId);
    }

    deleteImport(importId) {
        return this.vision.deleteImport(importId);
    }

    getImage(importId, fileName) {
        const filePath = this.store.resolveImagePath(importId, fileName);
        if (!filePath || !fs.existsSync(filePath)) return null;
        return {
            filePath,
            mimeType: mimeTypeForPath(filePath)
        };
    }
}

function mimeTypeForPath(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.png') return 'image/png';
    if (ext === '.webp') return 'image/webp';
    if (ext === '.gif') return 'image/gif';
    if (ext === '.bmp') return 'image/bmp';
    return 'image/jpeg';
}

function createTaskWorkbookService(options) {
    return new TaskWorkbookService(options);
}

module.exports = {
    createTaskWorkbookService,
    TaskWorkbookService,
    TaskWorkbookStore
};
