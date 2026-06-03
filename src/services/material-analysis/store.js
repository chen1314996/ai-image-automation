const fs = require('fs');
const path = require('path');

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

function safeSegment(value, fallback = 'default') {
    const text = String(value || '').trim() || fallback;
    return text
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
        .replace(/\s+/g, '_')
        .slice(0, 80);
}

function readJsonFile(filePath, fallback) {
    if (!fs.existsSync(filePath)) return fallback;
    const text = fs.readFileSync(filePath, 'utf8');
    if (!text.trim()) return fallback;
    return JSON.parse(text);
}

function writeJsonFile(filePath, data) {
    ensureDir(path.dirname(filePath));
    const tempPath = `${filePath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tempPath, filePath);
}

function isPathInside(childPath, parentPath) {
    const relative = path.relative(path.resolve(parentPath), path.resolve(childPath));
    return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

class MaterialAnalysisStore {
    constructor(rootDir) {
        this.rootDir = rootDir;
        this.dataDir = path.join(rootDir, 'data', 'material-analysis');
        this.importsDir = path.join(this.dataDir, 'imports');
    }

    ensureBase() {
        ensureDir(this.dataDir);
        ensureDir(this.importsDir);
    }

    importDir(projectName, weekId, runId) {
        return path.join(
            this.importsDir,
            safeSegment(projectName, 'unknown-project'),
            safeSegment(weekId, 'unknown-week'),
            safeSegment(runId, 'run')
        );
    }

    writeImport(run) {
        this.ensureBase();
        const dir = this.importDir(run.projectName, run.weekId, run.runId);
        ensureDir(dir);
        fs.writeFileSync(path.join(dir, 'source.csv'), run.sourceText || '', 'utf8');
        writeJsonFile(path.join(dir, 'import-summary.json'), run.summary);
        writeJsonFile(path.join(dir, 'normalized-materials.json'), run.materials);
        writeJsonFile(path.join(dir, 'top100.json'), run.top100);
        return dir;
    }

    listImports() {
        this.ensureBase();
        const imports = [];
        if (!fs.existsSync(this.importsDir)) return imports;

        for (const projectName of fs.readdirSync(this.importsDir)) {
            const projectDir = path.join(this.importsDir, projectName);
            if (!fs.statSync(projectDir).isDirectory()) continue;

            for (const weekId of fs.readdirSync(projectDir)) {
                const weekDir = path.join(projectDir, weekId);
                if (!fs.statSync(weekDir).isDirectory()) continue;

                for (const runId of fs.readdirSync(weekDir)) {
                    const runDir = path.join(weekDir, runId);
                    if (!fs.statSync(runDir).isDirectory()) continue;
                    const summaryPath = path.join(runDir, 'import-summary.json');
                    const summary = readJsonFile(summaryPath, null);
                    if (summary) {
                        imports.push({
                            ...summary,
                            runDir
                        });
                    }
                }
            }
        }

        return imports.sort((a, b) => String(b.importedAt || '').localeCompare(String(a.importedAt || '')));
    }

    findImport(runId) {
        return this.listImports().find(item => item.runId === runId) || null;
    }

    deleteImport(runId) {
        this.ensureBase();
        const found = this.findImport(runId);
        if (!found || !found.runDir) return null;

        const runDir = path.resolve(found.runDir);
        const importsDir = path.resolve(this.importsDir);
        if (!isPathInside(runDir, importsDir)) {
            throw new Error('Refusing to delete outside material analysis imports directory');
        }

        fs.rmSync(runDir, { recursive: true, force: true });

        let parent = path.dirname(runDir);
        while (isPathInside(parent, importsDir)) {
            if (!fs.existsSync(parent) || fs.readdirSync(parent).length > 0) break;
            fs.rmdirSync(parent);
            parent = path.dirname(parent);
        }

        return {
            ...found,
            runDir
        };
    }

    readImportFile(runId, fileName, fallback) {
        const found = this.findImport(runId);
        if (!found || !found.runDir) return fallback;
        return readJsonFile(path.join(found.runDir, fileName), fallback);
    }

    readImportTextFile(runId, fileName, fallback = '') {
        const found = this.findImport(runId);
        if (!found || !found.runDir) return fallback;
        const filePath = path.join(found.runDir, fileName);
        if (!fs.existsSync(filePath)) return fallback;
        return fs.readFileSync(filePath, 'utf8');
    }
}

module.exports = {
    MaterialAnalysisStore,
    safeSegment
};
