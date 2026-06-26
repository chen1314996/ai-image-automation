const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const registerLegilRoutes = require('../src/routes/legil.routes');
const { createRouteContext } = require('../src/server/context');
const realLegilAutomation = require('../legil-automation');

function waitFor(predicate, timeoutMs = 5000) {
    const startedAt = Date.now();
    return new Promise((resolve, reject) => {
        const tick = () => {
            if (predicate()) {
                resolve();
                return;
            }
            if (Date.now() - startedAt > timeoutMs) {
                reject(new Error('Timed out waiting for creative-batch background task'));
                return;
            }
            setTimeout(tick, 50);
        };
        tick();
    });
}

function createMockResponse() {
    let payload = null;
    return {
        json(value) {
            payload = value;
        },
        get payload() {
            return payload;
        }
    };
}

async function main() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'creative-batch-naming-route-'));
    const outputFolder = path.join(root, 'output');
    const dataDir = path.join(root, 'creative-knowledge');
    fs.mkdirSync(outputFolder, { recursive: true });
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'directions.json'), JSON.stringify({
        directions: [{
            id: 'direction-apocalypse-text',
            path: '题材/探索发现/末世文字',
            primaryTag: '题材',
            secondaryTag: '探索发现',
            tertiaryTag: '末世文字',
            name: '末世文字'
        }]
    }, null, 2), 'utf8');
    fs.writeFileSync(path.join(dataDir, 'assets.json'), JSON.stringify({ version: 1, assets: [] }, null, 2), 'utf8');

    const routes = new Map();
    const app = {
        post(routePath, handler) {
            routes.set(`POST ${routePath}`, handler);
        },
        get(routePath, handler) {
            routes.set(`GET ${routePath}`, handler);
        }
    };

    const context = createRouteContext();
    context.creativeKnowledgeDataDir = dataDir;
    context.dataDir = dataDir;
    context.persistRuntimeConfig = () => {};
    context.notifyLegilResult = () => {};
    context.notifyTaskEvent = () => {};
    context.automationState.legilTaskRunning = false;
    context.automationState.legilStopRequested = false;
    context.automationState.legilTaskType = null;
    context.clearCreativeResumeState();

    const mockLegilAutomation = {
        saveFolder: '',
        referenceFolder: '',
        referenceImages: [],
        currentRefIndex: 0,
        generationSettings: realLegilAutomation.getConfig().settings,
        getConfig: () => realLegilAutomation.getConfig(),
        getImageModelLabel: value => realLegilAutomation.getImageModelLabel(value),
        async generateImage(prompt, promptIndex, options = {}) {
            const saveFolder = options.saveFolder || outputFolder;
            fs.mkdirSync(saveFolder, { recursive: true });
            const fileName = realLegilAutomation.buildOutputFileName(promptIndex, {
                ...options,
                variantIndex: 1
            });
            const filePath = path.join(saveFolder, fileName);
            fs.writeFileSync(filePath, Buffer.from(`mock image for ${prompt}`));
            return {
                success: true,
                message: 'mock generated',
                savedCount: 1,
                savePath: filePath,
                savePaths: [filePath]
            };
        }
    };
    context.legilAutomation = mockLegilAutomation;

    registerLegilRoutes(app, context);
    const handler = routes.get('POST /api/legil/creative-batch');
    assert(handler, 'creative-batch route should be registered');

    const response = createMockResponse();
    await handler({
        body: {
            outputFolder,
            persistCreativeConfig: false,
            suppressLegilNotification: true,
            browserMode: 'headless',
            generationSettings: {
                outputQuantity: 1
            },
            prompts: [{
                index: 1,
                sourceRow: 1,
                direction: '冰墙标语守夜',
                newDirectionName: '冰墙标语守夜',
                contentTitle: '冰墙标语守夜',
                outputNameBase: '冰墙标语守夜',
                promptTitle: '延展1-AI提示词1',
                primaryTag: '题材',
                secondaryTag: '探索发现',
                tertiaryTag: '末世文字',
                standardLabelPath: ['题材', '探索发现', '末世文字'],
                sourceDirectionPath: '题材/探索发现/末世文字/末世标语',
                prompt: '主题：冰墙标语守夜。画面内容：幸存者在冰墙旁守夜。'
            }]
        }
    }, response);

    assert.strictEqual(response.payload && response.payload.success, true, 'route should accept the creative batch');
    await waitFor(() => context.automationState.legilTaskRunning === false, 8000);

    const files = fs.readdirSync(outputFolder);
    const pngFiles = files.filter(name => name.endsWith('.png'));
    const promptFiles = files.filter(name => name.endsWith('.prompt.txt'));
    assert.strictEqual(pngFiles.length, 1, `expected one png, got ${pngFiles.join(', ')}`);
    assert.strictEqual(promptFiles.length, 1, `expected one prompt txt, got ${promptFiles.join(', ')}`);

    assert(
        pngFiles[0].includes('_题材_探索发现_末世文字_自动化冰墙标语守夜_'),
        `png file should include labels: ${pngFiles[0]}`
    );
    assert(
        !pngFiles[0].includes('_0001_冰墙标语守夜_v'),
        `png file should not use bare content title only: ${pngFiles[0]}`
    );

    const promptText = fs.readFileSync(path.join(outputFolder, promptFiles[0]), 'utf8');
    assert(promptText.includes('Primary tag: 题材'), 'prompt txt should include primary tag');
    assert(promptText.includes('Secondary tag: 探索发现'), 'prompt txt should include secondary tag');
    assert(promptText.includes('Tertiary tag: 末世文字'), 'prompt txt should include tertiary tag');
    assert(promptText.includes('Output name base: 题材_探索发现_末世文字_自动化冰墙标语守夜'), 'prompt txt should include labeled automation outputNameBase');
    assert(promptText.includes(pngFiles[0]), 'prompt txt should point at the labeled image file');

    console.log(JSON.stringify({
        success: true,
        outputFolder,
        pngFile: pngFiles[0],
        promptFile: promptFiles[0]
    }, null, 2));

    fs.rmSync(root, { recursive: true, force: true });
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
