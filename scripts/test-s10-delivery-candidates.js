const fs = require('fs');
const path = require('path');
const { createCanvas } = require('canvas');

const {
    createDeliveryPostprocessStore,
    DELIVERY_TARGET_ASPECT_RATIOS
} = require('../src/services/delivery-postprocess/store');
const {
    buildDeliveryPrompt,
    normalizeDeliveryCandidateCount
} = require('../src/services/delivery-postprocess/candidate-config');
const {
    standardizeImageToTarget,
    buildStandardizedOutputPath
} = require('../src/services/delivery-postprocess/standardize');
const {
    finalizeDeliveryRun
} = require('../src/services/delivery-postprocess/finalize');

const ROOT = path.join(__dirname, '..');
const TEST_ROOT = path.join(ROOT, 'runtime', 's10-delivery-candidates-test');
const INPUT_DIR = path.join(TEST_ROOT, 'ok-input');
const OUTPUT_DIR = path.join(TEST_ROOT, 'delivery-output');
const LOGO_DIR = path.join(TEST_ROOT, 'logo-templates');

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function writeTinyPng(filePath) {
    const canvas = createCanvas(16, 16);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#1e88e5';
    ctx.fillRect(0, 0, 16, 16);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(4, 4, 8, 8);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, canvas.toBuffer('image/png'));
}

function writeLogoTemplate(filePath, width, height) {
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.01)';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#ff1744';
    ctx.fillRect(Math.max(0, width - 40), Math.max(0, height - 40), 32, 32);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, canvas.toBuffer('image/png'));
}

function resetTestRoot() {
    const resolved = path.resolve(TEST_ROOT);
    const runtimeRoot = path.resolve(path.join(ROOT, 'runtime'));
    assert(resolved.startsWith(runtimeRoot), 'Refusing to delete outside runtime directory');
    fs.rmSync(resolved, { recursive: true, force: true });
    fs.mkdirSync(INPUT_DIR, { recursive: true });
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

async function main() {
    resetTestRoot();
    const generatedName = '20260603_103821_0016_题材_探索发现_妙思结合指南针等UI和幸存者宠物载具05_雪后初晴宠物协作解救行动_v04_20260603_104609.png';
    writeTinyPng(path.join(INPUT_DIR, generatedName));

    const store = createDeliveryPostprocessStore({ rootDir: TEST_ROOT });
    const run = store.scanInputFolder({
        inputFolder: INPUT_DIR,
        outputFolder: OUTPUT_DIR,
        candidateCountPerSize: 1,
        namingRule: {
            fixedPrefix: 'GOFCNIM',
            startNumber: '28930',
            regionText: 'BJ',
            channelText: 'QA',
            primaryTag: 'Topic',
            secondaryTag: 'Vehicle'
        }
    });

    assert(run.totalJobs === 1, 'scan should create one delivery job');
    assert(run.candidateCountPerSize === 1, 'candidate count 1 should be accepted');
    assert(normalizeDeliveryCandidateCount(1) === 1, 'candidate count 1 should be accepted');
    assert(normalizeDeliveryCandidateCount(2) === 2, 'candidate count 2 should be accepted');
    assert(normalizeDeliveryCandidateCount(3) === 3, 'candidate count 3 should be accepted');
    assert(normalizeDeliveryCandidateCount(4) === 4, 'candidate count 4 should be accepted');

    const job = run.jobs[0];
    assert(
        job.baseName === 'GOFCNIM28930_BJ_QA_题材_探索发现_妙思结合指南针等UI和幸存者宠物载具05_雪后初晴宠物协作解救行动',
        'delivery base name should inherit generated business name and drop generated metadata'
    );
    assert(job.folderName === job.baseName, 'delivery folder name should match base name without size');
    assert(job.targets['800x800'].aspectRatio === '1:1', '800x800 should map to 1:1');
    assert(job.targets['1280x720'].aspectRatio === '16:9', '1280x720 should map to 16:9');
    assert(job.targets['1080x1920'].aspectRatio === '9:16', '1080x1920 should map to 9:16');
    assert(DELIVERY_TARGET_ASPECT_RATIOS['1080x1920'] === '9:16', 'target ratio map should export 9:16');

    const prompt = buildDeliveryPrompt({
        targetSize: '1280x720',
        aspectRatio: '16:9',
        baseName: job.baseName,
        sourceFileName: job.sourceImage.fileName
    });
    assert(prompt.includes('目标尺寸：1280x720'), 'prompt should include target size');
    assert(prompt.includes('目标比例：16:9'), 'prompt should include target aspect ratio');
    assert(prompt.includes('横版广告图'), 'prompt should include size-specific template');
    assert(prompt.includes('不要简单拉伸或裁切'), 'prompt should forbid local crop/stretch behavior');

    const candidatePath = path.join(OUTPUT_DIR, run.runId, 'stage-ai', job.baseName, '800x800', 'candidate.png');
    writeTinyPng(candidatePath);
    job.targets['800x800'].status = 'candidates_ready';
    job.targets['800x800'].candidates = [{
        candidateId: 'cand_test_001',
        filePath: candidatePath,
        fileName: path.basename(candidatePath),
        targetSize: '800x800',
        aspectRatio: '1:1',
        selected: false,
        source: 'legil'
    }];
    job.targets['800x800'].selectedCandidateId = 'cand_test_001';
    job.targets['800x800'].candidates[0].selected = true;
    job.targets['800x800'].status = 'candidate_selected';
    store.saveRun(run);

    const savedRun = store.readRun(run.runId);
    assert(savedRun.jobs[0].targets['800x800'].candidates.length === 1, 'candidate records should persist');
    assert(savedRun.jobs[0].targets['800x800'].selectedCandidateId === 'cand_test_001', 'selectedCandidateId should persist');
    assert(savedRun.jobs[0].targets['800x800'].status === 'candidate_selected', 'selected target status should persist');

    const multiCandidatePath = buildStandardizedOutputPath({
        outputFolder: OUTPUT_DIR,
        runId: run.runId,
        folderName: job.folderName,
        baseName: job.baseName,
        targetSize: '800x800',
        candidateIndex: 3,
        candidateCount: 4
    });
    assert(
        path.basename(multiCandidatePath) === `${job.baseName}_800x800_3.jpg`,
        'multi-candidate standardized path should append candidate ordinal after size'
    );

    const standardizedPath = path.join(OUTPUT_DIR, run.runId, 'stage-final', job.baseName, `${job.baseName}_800x800.jpg`);
    const standardized = await standardizeImageToTarget(candidatePath, standardizedPath, '800x800', {
        maxOutputBytes: 390 * 1024,
        minQuality: 60
    });
    assert(fs.existsSync(standardized.outputPath), 'standardized JPG should exist');
    assert(standardized.width === 800 && standardized.height === 800, 'standardized JPG should be exact 800x800');
    assert(standardized.sizeBytes <= 390 * 1024, 'standardized JPG should be under 390KB');
    assert(path.extname(standardized.outputPath).toLowerCase() === '.jpg', 'standardized output should be JPG');

    const partialRun = store.readRun(run.runId);
    const partialJob = partialRun.jobs[0];
    partialJob.targets['800x800'].standardizedCandidates = [{
        candidateId: 'cand_test_001',
        candidateIndex: 1,
        candidateCount: 1,
        outputPath: standardized.outputPath,
        dimensions: '800x800'
    }];
    partialJob.targets['800x800'].standardizedPath = standardized.outputPath;
    partialJob.targets['800x800'].status = 'standardized';
    store.saveRun(partialRun);

    writeLogoTemplate(path.join(LOGO_DIR, 'logo_800x800.png'), 800, 800);
    writeLogoTemplate(path.join(LOGO_DIR, 'logo_1280x720.png'), 1280, 720);
    writeLogoTemplate(path.join(LOGO_DIR, 'logo_1080x1920.png'), 1080, 1920);

    const finalized = await finalizeDeliveryRun(partialRun, {
        logoTemplateFolder: LOGO_DIR,
        allowPartial: true,
        maxOutputBytes: 390 * 1024,
        minQuality: 60
    });
    assert(finalized.partial, 'partial finalize should report partial result');
    assert(finalized.finalizedCount === 1, 'partial finalize should still output the standardized target');
    assert(finalized.failedCount === 2, 'partial finalize should skip the two missing target sizes');
    assert(finalized.run.status === 'partial_finalized', 'partial run should be marked partial_finalized');
    assert(fs.existsSync(finalized.finalized[0].outputPath), 'partial final package image should exist');
    assert(
        path.basename(finalized.finalized[0].outputPath) === `${job.baseName}_800x800.jpg`,
        'partial final output should keep final delivery naming'
    );

    console.log('S10 delivery candidates test passed');
    console.log(JSON.stringify({
        runId: run.runId,
        dataRoot: store.dataRoot,
        baseName: job.baseName
    }, null, 2));

    if (process.env.KEEP_S10_DELIVERY_TEST !== '1') {
        fs.rmSync(TEST_ROOT, { recursive: true, force: true });
    }
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
