const fs = require('fs');
const path = require('path');

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

function readJsonFile(filePath, fallback) {
    if (!fs.existsSync(filePath)) {
        return fallback;
    }

    try {
        const text = fs.readFileSync(filePath, 'utf8');
        if (!text.trim()) {
            return fallback;
        }
        return JSON.parse(text);
    } catch (error) {
        const wrapped = new Error(`读取 JSON 失败: ${filePath} - ${error.message}`);
        wrapped.cause = error;
        throw wrapped;
    }
}

function writeJsonFile(filePath, data) {
    ensureDir(path.dirname(filePath));
    const tempPath = `${filePath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tempPath, filePath);
}

function getFileInfo(filePath) {
    if (!fs.existsSync(filePath)) {
        return {
            exists: false,
            path: filePath
        };
    }

    const stats = fs.statSync(filePath);
    return {
        exists: true,
        path: filePath,
        size: stats.size,
        updatedAt: stats.mtime.toISOString()
    };
}

class CreativeKnowledgeStore {
    constructor(dataDir) {
        this.dataDir = dataDir;
    }

    ensureBase() {
        ensureDir(this.dataDir);
        ensureDir(path.join(this.dataDir, 'runs'));
    }

    filePath(fileName) {
        return path.join(this.dataDir, fileName);
    }

    read(fileName, fallback) {
        return readJsonFile(this.filePath(fileName), fallback);
    }

    write(fileName, data) {
        writeJsonFile(this.filePath(fileName), data);
    }

    info(fileName) {
        return getFileInfo(this.filePath(fileName));
    }
}

module.exports = {
    CreativeKnowledgeStore,
    ensureDir,
    getFileInfo,
    readJsonFile,
    writeJsonFile
};
