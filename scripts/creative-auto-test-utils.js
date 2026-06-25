const fs = require('fs');
const os = require('os');
const path = require('path');

function todayKey() {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
}

function makeTempCreativeFixture(prefix = 'creative-auto-test-') {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    const dataDir = path.join(root, 'data', 'creative-knowledge');
    const outputFolder = path.join(root, 'output');
    const referenceFolder = path.join(root, 'reference');
    fs.mkdirSync(path.join(dataDir, 'runs'), { recursive: true });
    fs.mkdirSync(outputFolder, { recursive: true });
    fs.mkdirSync(referenceFolder, { recursive: true });
    return { root, dataDir, outputFolder, referenceFolder };
}

function writeJson(filePath, data) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function writeBaseKnowledge(fixture, directions = defaultDirections()) {
    writeJson(path.join(fixture.dataDir, 'metadata.json'), {
        importedAt: new Date().toISOString(),
        counts: { directions: directions.length, topMaterials: 0, topMaterialInsights: 0, referenceImages: 0 },
        warnings: []
    });
    writeJson(path.join(fixture.dataDir, 'directions.json'), { directions });
    writeJson(path.join(fixture.dataDir, 'top-material-insights.json'), { insights: [] });
    writeJson(path.join(fixture.dataDir, 'material-learnings.json'), { learnings: [] });
    writeJson(path.join(fixture.dataDir, 'reference-images.json'), { images: [] });
    writeJson(path.join(fixture.dataDir, 'assets.json'), { version: 1, assets: [] });
    writeJson(path.join(fixture.dataDir, 'scheduler-state.json'), {
        version: 1,
        status: 'idle',
        daily: { date: todayKey(), imageCount: 0, imageLimit: 1000 }
    });
}

function defaultDirections() {
    return [
        {
            id: 'direction-1',
            path: 'Topic/Source/Direction One',
            name: 'Direction One',
            autoRun: true,
            priority: 90,
            stats: {}
        },
        {
            id: 'direction-2',
            path: 'Topic/Source/Direction Two',
            name: 'Direction Two',
            autoRun: true,
            priority: 80,
            stats: {}
        }
    ];
}

function makePrompt(index, overrides = {}) {
    return {
        index,
        originalIndex: index,
        sourceRow: overrides.sourceRow || index,
        direction: overrides.direction || `Direction ${index}`,
        newDirectionName: overrides.newDirectionName || `New Direction ${index}`,
        promptTitle: overrides.promptTitle || `Prompt ${index}`,
        sourceDirectionId: overrides.sourceDirectionId || 'direction-1',
        sourceDirectionPath: overrides.sourceDirectionPath || 'Topic/Source/Direction One',
        prompt: overrides.prompt || `A complete image prompt for test ${index}.`,
        finalPrompt: overrides.finalPrompt || overrides.prompt || `A complete image prompt for test ${index}.`,
        promptHash: overrides.promptHash || `prompt-hash-${index}`,
        selected: overrides.selected !== false
    };
}

function waitFor(predicate, timeoutMs = 4000, intervalMs = 50) {
    const startedAt = Date.now();
    return new Promise((resolve, reject) => {
        const tick = () => {
            try {
                const value = predicate();
                if (value) {
                    resolve(value);
                    return;
                }
            } catch (error) {
                reject(error);
                return;
            }
            if (Date.now() - startedAt >= timeoutMs) {
                reject(new Error('Timed out waiting for condition'));
                return;
            }
            setTimeout(tick, intervalMs);
        };
        tick();
    });
}

function cleanupFixture(fixture) {
    if (fixture && fixture.root) {
        fs.rmSync(fixture.root, { recursive: true, force: true });
    }
}

module.exports = {
    cleanupFixture,
    defaultDirections,
    makePrompt,
    makeTempCreativeFixture,
    todayKey,
    waitFor,
    writeBaseKnowledge,
    writeJson
};
