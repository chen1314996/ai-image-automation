const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const express = require('express');
const { createCanvas } = require('canvas');

const registerDeliveryRoutes = require('../src/routes/delivery.routes');
const { readImageDimensions } = require('../src/services/image-renamer');

const TARGET_SIZES = ['800x800', '1280x720', '1080x1920'];
const TARGET_DIMENSIONS = {
    '800x800': { width: 800, height: 800 },
    '1280x720': { width: 1280, height: 720 },
    '1080x1920': { width: 1080, height: 1920 }
};

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

function writePng(filePath, width, height, seed = 1) {
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    const hue = (seed * 67) % 360;
    ctx.fillStyle = `hsl(${hue}, 58%, 46%)`;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.82)';
    ctx.fillRect(Math.floor(width * 0.12), Math.floor(height * 0.16), Math.floor(width * 0.46), Math.floor(height * 0.34));
    ctx.fillStyle = 'rgba(0, 0, 0, 0.24)';
    ctx.fillRect(Math.floor(width * 0.58), Math.floor(height * 0.58), Math.floor(width * 0.24), Math.floor(height * 0.22));
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, canvas.toBuffer('image/png'));
}

function finalPathFor(run, job, targetSize) {
    return path.join(run.outputFolder, run.runId, 'final-package', job.folderName, `${job.baseName}_${targetSize}.jpg`);
}

function assertFinalFile(run, job, targetSize) {
    const filePath = finalPathFor(run, job, targetSize);
    assert.ok(fs.existsSync(filePath), `${job.sourceImage.fileName} ${targetSize} final file should exist`);
    assert.strictEqual(path.extname(filePath).toLowerCase(), '.jpg', `${targetSize} final file should be JPG`);
    assert.strictEqual(path.basename(filePath), `${job.baseName}_${targetSize}.jpg`, `${targetSize} final file should use delivery naming`);
    const dimensions = readImageDimensions(filePath);
    assert.deepStrictEqual(
        { width: dimensions && dimensions.width, height: dimensions && dimensions.height },
        TARGET_DIMENSIONS[targetSize],
        `${job.sourceImage.fileName} ${targetSize} final dimensions should be exact`
    );
    assert.ok(fs.statSync(filePath).size <= 390 * 1024, `${targetSize} final file should be <= 390KB`);
    const target = job.targets[targetSize];
    assert.strictEqual(target.logoApplied, true, `${targetSize} target should mark logoApplied`);
    assert.ok(target.finalized && target.finalized.logoFileName, `${targetSize} finalized metadata should include logoFileName`);
    return filePath;
}

async function createAppContext(rootDir) {
    let legilGenerateCalls = 0;
    const legilCalls = [];
    const logs = [];
    const app = express();
    app.use(express.json({ limit: '2mb' }));

    const context = {
        rootDir,
        logger: {
            system(message) { logs.push(['system', String(message || '')]); },
            info(message) { logs.push(['info', String(message || '')]); },
            warn(message) { logs.push(['warn', String(message || '')]); },
            error(message) { logs.push(['error', String(message || '')]); }
        },
        fs,
        path,
        appConfig: {
            resize: {
                browserMode: 'headless',
                generationSettings: {
                    aspectRatio: '1:1',
                    outputQuantity: 1
                }
            },
            notifications: {}
        },
        automationState: {},
        legilAutomation: {
            saveFolder: '',
            referenceFolder: '',
            referenceImages: [],
            currentRefIndex: 0,
            generationSettings: {},
            getConfig() {
                return {
                    settings: {
                        aspectRatio: '1:1',
                        outputQuantity: 1
                    }
                };
            },
            async generateImage(prompt, index, options) {
                legilGenerateCalls += 1;
                legilCalls.push({
                    referenceImageName: options.referenceImageName,
                    targetSize: options.promptTitleName,
                    generationSettings: { ...(options.generationSettings || {}) }
                });
                const targetSize = options.promptTitleName;
                const { width, height } = TARGET_DIMENSIONS[targetSize];
                const filePath = path.join(options.saveFolder, `real_folder_candidate_${index}_${targetSize}_${legilGenerateCalls}.png`);
                writePng(filePath, width, height, index + legilGenerateCalls + 10);
                return {
                    success: true,
                    savePaths: [filePath]
                };
            }
        },
        normalizeLegilGenerationSettings(settings) {
            return {
                aspectRatio: settings && settings.aspectRatio || '1:1',
                outputQuantity: Number(settings && settings.outputQuantity) || 1
            };
        },
        isLegilBusy() {
            return false;
        },
        async sleepWithLegilStop() {},
        isLegilStopRequested() {
            return false;
        },
        notifyLegilResult() {}
    };

    registerDeliveryRoutes(app, context);
    const server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    return {
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () => new Promise(resolve => server.close(resolve)),
        getLegilGenerateCalls: () => legilGenerateCalls,
        getLegilCalls: () => [...legilCalls],
        getLogs: () => [...logs]
    };
}

async function postJson(url, body) {
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
    });
    const data = await res.json();
    assert.strictEqual(data.success, true, data.message || `request failed: ${url}`);
    return data;
}

async function waitForRunDone(appContext, runId) {
    const deadline = Date.now() + 20000;
    let latest = null;
    while (Date.now() < deadline) {
        const res = await fetch(`${appContext.baseUrl}/api/delivery/runs/${runId}`);
        const data = await res.json();
        assert.strictEqual(data.success, true, 'run status should be readable');
        latest = data;
        if (!data.task || !data.task.running) {
            return data.run;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`timed out waiting for run ${runId}; latest=${JSON.stringify(latest && latest.task)}`);
}

async function main() {
    const inputFolder = process.env.TEST_INPUT_DIR;
    const outputFolder = process.env.TEST_OUTPUT_DIR;
    const logoTemplateFolder = process.env.TEST_LOGO_DIR;
    if (!inputFolder || !fs.existsSync(inputFolder)) {
        throw new Error(`TEST_INPUT_DIR not found: ${inputFolder || ''}`);
    }
    if (!logoTemplateFolder || !fs.existsSync(logoTemplateFolder)) {
        throw new Error(`TEST_LOGO_DIR not found: ${logoTemplateFolder || ''}`);
    }
    ensureDir(outputFolder);

    const rootDir = path.join(outputFolder, '.delivery-test-runtime');
    ensureDir(rootDir);

    const appContext = await createAppContext(rootDir);
    try {
        const scan = await postJson(`${appContext.baseUrl}/api/delivery/scan`, {
            inputFolder,
            outputFolder,
            logoTemplateFolder,
            processMode: 'full-delivery',
            targetSizes: TARGET_SIZES,
            candidateCountPerSize: 1,
            namingRule: {
                fixedPrefix: 'GOFCNIM',
                startNumber: process.env.TEST_START_NUMBER || '42001',
                regionText: process.env.TEST_REGION_TEXT || 'BJ',
                channelText: process.env.TEST_CHANNEL_TEXT || '',
                primaryTag: process.env.TEST_PRIMARY_TAG || '',
                secondaryTag: process.env.TEST_SECONDARY_TAG || ''
            }
        });

        assert.strictEqual(scan.run.totalJobs, 2, 'real folder should scan two images');
        assert.strictEqual(scan.run.scan.sourceReuseTargetCount, 2, 'real folder should source-reuse two targets');
        assert.strictEqual(scan.run.scan.legilTargetCount, 4, 'real folder should leave four Legil targets');

        await postJson(`${appContext.baseUrl}/api/delivery/start`, {
            runId: scan.run.runId,
            processMode: 'full-delivery',
            logoTemplateFolder,
            targetSizes: TARGET_SIZES,
            candidateCountPerSize: 1
        });

        const done = await waitForRunDone(appContext, scan.run.runId);
        assert.strictEqual(done.status, 'finalized', 'real folder run should finalize');
        assert.strictEqual(done.completedJobs, 2, 'both real images should finalize');
        assert.strictEqual(appContext.getLegilGenerateCalls(), 4, 'only four non-source-reuse targets should call Legil substitute');

        appContext.getLegilCalls().forEach(call => {
            assert.strictEqual(
                call.generationSettings.aspectRatio,
                TARGET_SIZES.includes(call.targetSize) ? {
                    '800x800': '1:1',
                    '1280x720': '16:9',
                    '1080x1920': '9:16'
                }[call.targetSize] : '',
                `${call.targetSize} should pass target aspectRatio into Legil`
            );
            assert.deepStrictEqual(
                call.generationSettings.aspectRatios,
                [call.generationSettings.aspectRatio],
                `${call.targetSize} should constrain Legil aspectRatios to target ratio`
            );
        });

        const sourceReusePairs = new Set();
        done.jobs.forEach(job => {
            TARGET_SIZES.forEach(size => {
                if (job.targets[size].generationMode === 'source-reuse') {
                    sourceReusePairs.add(`${job.sourceImage.fileName}|${size}`);
                }
            });
        });
        appContext.getLegilCalls().forEach(call => {
            assert.ok(
                !sourceReusePairs.has(`${call.referenceImageName}|${call.targetSize}`),
                `source-reuse target should not call Legil substitute: ${call.referenceImageName} ${call.targetSize}`
            );
        });

        const finalFiles = [];
        done.jobs.forEach(job => {
            assert.strictEqual(job.status, 'finalized', `${job.sourceImage.fileName} should be finalized`);
            TARGET_SIZES.forEach(size => {
                finalFiles.push(assertFinalFile(done, job, size));
            });
        });

        console.log(JSON.stringify({
            success: true,
            inputFolder,
            outputFolder,
            runId: done.runId,
            finalPackageRoot: done.finalPackageRoot,
            sourceReuseTargetCount: done.scan.sourceReuseTargetCount,
            legilTargetCount: done.scan.legilTargetCount,
            legilGenerateCalls: appContext.getLegilGenerateCalls(),
            legilCalls: appContext.getLegilCalls(),
            finalFiles
        }, null, 2));
    } finally {
        await appContext.close();
    }
}

main().catch(error => {
    console.error('S11 real folder delivery test failed');
    console.error(error);
    process.exitCode = 1;
});
