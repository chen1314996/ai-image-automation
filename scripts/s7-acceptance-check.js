const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');

function readProjectFile(relativePath) {
    return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

function readJsonIfExists(relativePath) {
    const filePath = path.join(ROOT_DIR, relativePath);
    if (!fs.existsSync(filePath)) return {};
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function assertIncludes(relativePath, expected) {
    const text = readProjectFile(relativePath);
    expected.forEach(item => {
        assert.ok(text.includes(item), `${relativePath} missing ${item}`);
    });
}

function assertScriptExists(name) {
    const packageJson = readJsonIfExists('package.json');
    assert.ok(packageJson.scripts && packageJson.scripts[name], `package.json missing script ${name}`);
}

function logPass(message) {
    console.log(`[S7] OK - ${message}`);
}

function logWarn(message) {
    console.log(`[S7] WARN - ${message}`);
}

function hasConfigValue(...values) {
    return values.some(value => typeof value === 'string' && value.trim());
}

function checkGitignoreBoundary() {
    assertIncludes('.gitignore', [
        'data/creative-knowledge/',
        'data/material-analysis/',
        'data/acceptance-*.png',
        'data/tmp-*.xlsx',
        'public/generated/',
        'sucai/~$*.xlsx'
    ]);
    logPass('local runtime data and generated snapshot boundaries are explicit in .gitignore');
}

function checkInterfaceDocs() {
    assertIncludes('docs/接口清单.md', [
        '/api/creative-auto/runs/:runId/start-legil',
        '/api/material-analysis/import',
        '/api/material-analysis/imports/:runId/vision/start',
        '/api/material-analysis/imports/:runId/vision/status',
        '/api/material-analysis/imports/:runId/vision/results',
        '/api/material-analysis/imports/:runId/reports/generate',
        '/api/material-analysis/imports/:runId/creative-targets',
        '/api/material-analysis/imports/:runId/creative-expansion',
        '/api/material-analysis/creative-expansions/:expansionId/export-js',
        '/api/material-analysis/materials/:materialId/vision/retry',
        '/api/material-analysis/imports/:runId/materials/:materialId/image',
        '/api/resize/resume',
        '/api/resize/resume/clear'
    ]);
    logPass('S7-relevant creative-auto, material-analysis, and resize endpoints are documented');
}

function checkRouteContracts() {
    assertIncludes('src/routes/creative-auto.routes.js', [
        "app.post('/api/creative-auto/runs/:runId/start-legil'"
    ]);
    assertIncludes('src/routes/material-analysis.routes.js', [
        "app.post('/api/material-analysis/import'",
        "app.post('/api/material-analysis/imports/:runId/vision/start'",
        "app.get('/api/material-analysis/imports/:runId/vision/status'",
        "app.get('/api/material-analysis/imports/:runId/vision/results'",
        "app.post('/api/material-analysis/imports/:runId/reports/generate'",
        "app.get('/api/material-analysis/imports/:runId/creative-targets'",
        "app.post('/api/material-analysis/imports/:runId/creative-expansion'",
        "app.post('/api/material-analysis/creative-expansions/:expansionId/export-js'",
        "app.post('/api/material-analysis/materials/:materialId/vision/retry'"
    ]);
    assertIncludes('src/routes/legil.routes.js', [
        "app.get('/api/resize/resume'",
        "app.post('/api/resize/resume/clear'"
    ]);
    logPass('documented S7 endpoints are present in route files');
}

function checkRegressionScripts() {
    [
        'test:s0-baseline',
        'test:s1-knowledge',
        'test:s2-feedback',
        'test:s3-creative-page',
        'test:s4-growth',
        'test:s5-prompt-translator',
        'test:s6-feedback-learning',
        'test:s7-pages',
        'test:creative-auto',
        'test:material-analysis',
        'test:p5-creative-brief'
    ].forEach(assertScriptExists);
    logPass('S0-S6, creative-auto, and material-analysis regression scripts are registered');
}

function checkS7Docs() {
    assert.ok(fs.existsSync(path.join(ROOT_DIR, 'docs', 'S7之后新版分阶段开发计划-20260528.md')), 'S7 plan document is missing');
    assert.ok(fs.existsSync(path.join(ROOT_DIR, 'docs', 'S7-当前能力收口与真实验收记录.md')), 'S7 acceptance record is missing');
    logPass('S7 plan and acceptance record documents exist');
}

function checkWinkyConfigurationPresence() {
    const secrets = readJsonIfExists('automation-secrets.json');
    const hasApiKey = hasConfigValue(process.env.WINKY_API_KEY, secrets.winkyApiKey, secrets.WINKY_API_KEY);
    const hasApiUrl = hasConfigValue(process.env.WINKY_API_BASE_URL, secrets.winkyApiUrl, secrets.WINKY_API_BASE_URL);
    const hasModel = hasConfigValue(process.env.WINKY_MODEL, secrets.winkyModel, secrets.WINKY_MODEL);

    if (hasApiKey && hasApiUrl && hasModel) {
        logPass('Winky credential fields are present locally (values hidden)');
        return;
    }

    logWarn('Winky credential fields are incomplete locally; real Winky image/text validation still needs configured secrets');
}

function checkLocalDataShape() {
    const materialDir = path.join(ROOT_DIR, 'data', 'material-analysis');
    const knowledgeDir = path.join(ROOT_DIR, 'data', 'creative-knowledge');
    const sucaiDir = path.join(ROOT_DIR, 'sucai');

    if (fs.existsSync(materialDir)) {
        logPass('local material-analysis runtime data directory exists and is treated as generated data');
    } else {
        logWarn('data/material-analysis does not exist yet; material-analysis runtime validation has no local artifacts');
    }

    if (fs.existsSync(knowledgeDir)) {
        logPass('local creative-knowledge runtime data directory exists and is ignored');
    } else {
        logWarn('data/creative-knowledge does not exist yet; knowledge page may need import before browser validation');
    }

    if (fs.existsSync(sucaiDir)) {
        logPass('sucai source data directory exists and is intentionally not globally ignored');
    } else {
        logWarn('sucai directory is missing; local knowledge import will need an alternate source');
    }
}

function run() {
    checkGitignoreBoundary();
    checkInterfaceDocs();
    checkRouteContracts();
    checkRegressionScripts();
    checkS7Docs();
    checkWinkyConfigurationPresence();
    checkLocalDataShape();
    console.log('[S7] acceptance static check passed');
}

run();
