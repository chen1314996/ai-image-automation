const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createCanvas } = require('canvas');

const {
    createDeliveryPostprocessStore,
    DELIVERY_TARGET_ASPECT_RATIOS
} = require('../src/services/delivery-postprocess/store');
const {
    DELIVERY_TARGET_DIMENSIONS,
    standardizeImageToTarget,
    buildStandardizedOutputPath
} = require('../src/services/delivery-postprocess/standardize');
const {
    finalizeDeliveryRun
} = require('../src/services/delivery-postprocess/finalize');
const {
    readImageDimensions
} = require('../src/services/image-renamer');

const ROOT = path.join(__dirname, '..');
const TEST_ROOT = path.join(ROOT, 'runtime', 's11-stage0-delivery-baseline');
const INPUT_DIR = path.join(TEST_ROOT, 'ok-input');
const OUTPUT_DIR = path.join(TEST_ROOT, 'delivery-output');
const LOGO_DIR = path.join(TEST_ROOT, 'logo-templates');

const TARGET_SIZES = ['800x800', '1280x720', '1080x1920'];
const SOURCE_FIXTURES = [
    { fileName: 'ok_square_1x1.png', width: 800, height: 800, expectedRatio: '1:1' },
    { fileName: 'ok_landscape_16x9.png', width: 1280, height: 720, expectedRatio: '16:9' },
    { fileName: 'ok_portrait_9x16.png', width: 1080, height: 1920, expectedRatio: '9:16' },
    { fileName: 'ok_other_4x3.png', width: 1000, height: 750, expectedRatio: '4:3' }
];

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

function resetTestRoot() {
    const resolved = path.resolve(TEST_ROOT);
    const runtimeRoot = path.resolve(path.join(ROOT, 'runtime'));
    assert.ok(resolved.startsWith(runtimeRoot), 'Refusing to delete outside runtime directory');
    fs.rmSync(resolved, { recursive: true, force: true });
    ensureDir(INPUT_DIR);
    ensureDir(OUTPUT_DIR);
    ensureDir(LOGO_DIR);
}

function writePng(filePath, width, height, seed = 1) {
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    const hue = (seed * 47) % 360;
    ctx.fillStyle = `hsl(${hue}, 64%, 42%)`;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.86)';
    ctx.fillRect(Math.floor(width * 0.18), Math.floor(height * 0.18), Math.floor(width * 0.42), Math.floor(height * 0.42));
    ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
    ctx.fillRect(Math.floor(width * 0.55), Math.floor(height * 0.55), Math.floor(width * 0.26), Math.floor(height * 0.26));
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, canvas.toBuffer('image/png'));
}

function writeLogoTemplate(targetSize) {
    const dimensions = DELIVERY_TARGET_DIMENSIONS[targetSize];
    assert.ok(dimensions, `Missing dimensions for ${targetSize}`);
    const filePath = path.join(LOGO_DIR, `logo_${targetSize}.png`);
    const canvas = createCanvas(dimensions.width, dimensions.height);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, dimensions.width, dimensions.height);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.01)';
    ctx.fillRect(0, 0, dimensions.width, dimensions.height);
    ctx.fillStyle = 'rgba(255, 23, 68, 0.9)';
    ctx.fillRect(Math.max(0, dimensions.width - 72), Math.max(0, dimensions.height - 72), 48, 48);
    fs.writeFileSync(filePath, canvas.toBuffer('image/png'));
    return filePath;
}

function seedFixtures() {
    SOURCE_FIXTURES.forEach((fixture, index) => {
        writePng(path.join(INPUT_DIR, fixture.fileName), fixture.width, fixture.height, index + 1);
    });
    TARGET_SIZES.forEach(writeLogoTemplate);
}

function assertScanContract(run, store) {
    const fixturesByName = new Map(SOURCE_FIXTURES.map(fixture => [fixture.fileName, fixture]));
    assert.strictEqual(run.totalJobs, SOURCE_FIXTURES.length, 'scan should create one job per OK image');
    assert.deepStrictEqual(run.targetSizes, TARGET_SIZES, 'scan should keep the three delivery target sizes in order');
    assert.strictEqual(run.candidateCountPerSize, 2, 'scan should preserve candidateCountPerSize');
    assert.ok(run.runId.startsWith('delivery_run_'), 'run id should use delivery_run prefix');
    assert.ok(run.inputFolderKey, 'run should store inputFolderKey for reuse');
    assert.ok(run.outputFolderKey, 'run should store outputFolderKey for reuse');
    assert.strictEqual(run.scan.sourceImageCount, SOURCE_FIXTURES.length, 'scan summary should count source images');

    const savedRun = store.readRun(run.runId);
    assert.ok(savedRun, 'scan should persist run JSON');
    assert.strictEqual(savedRun.totalJobs, run.totalJobs, 'persisted run should keep totalJobs');

    const latestRun = store.getLatestRun(INPUT_DIR);
    assert.ok(latestRun && latestRun.runId === run.runId, 'latest run lookup by input folder should find this run');

    run.jobs.forEach((job, index) => {
        const fixture = fixturesByName.get(job.sourceImage && job.sourceImage.fileName);
        assert.ok(fixture, `unexpected source image ${job.sourceImage && job.sourceImage.fileName}`);
        assert.strictEqual(job.groupIndex, index + 1, 'job groupIndex should be one-based and ordered naturally');
        assert.ok(job.jobId.startsWith('delivery_job_'), 'job id should use delivery_job prefix');
        assert.strictEqual(job.folderName, job.baseName, 'job folderName should match baseName');
        assert.ok(job.sourceImage, 'job should include sourceImage');
        assert.strictEqual(job.sourceImage.fileName, fixture.fileName, 'source image fileName should persist');
        assert.strictEqual(job.sourceImage.extension, '.png', 'source extension should persist');
        assert.ok(job.sourceImage.fileSize > 0, 'source file size should persist');
        assert.ok(job.sourceImage.sourceKey, 'sourceKey should persist');

        const dimensions = readImageDimensions(job.sourceImage.filePath);
        assert.deepStrictEqual(
            { width: dimensions.width, height: dimensions.height },
            { width: fixture.width, height: fixture.height },
            'source fixture dimensions should be readable'
        );

        TARGET_SIZES.forEach(size => {
            const target = job.targets[size];
            assert.ok(target, `job should include target ${size}`);
            assert.strictEqual(target.size, size, 'target.size should match key');
            assert.strictEqual(target.aspectRatio, DELIVERY_TARGET_ASPECT_RATIOS[size], 'target aspect ratio should match map');
            assert.ok(Number(target.candidateCount) >= 1, 'target should keep a valid candidate count');
            assert.ok(Array.isArray(target.candidates), 'target candidates should be an array');
        });
    });
}

async function assertStandardizeAndFinalizeContract(run, store) {
    const job = run.jobs[0];
    const candidateSource = path.join(INPUT_DIR, SOURCE_FIXTURES[0].fileName);

    for (const targetSize of TARGET_SIZES) {
        const target = job.targets[targetSize];
        const candidateId = `baseline_${targetSize}`;
        target.candidates = [{
            candidateId,
            filePath: candidateSource,
            fileName: path.basename(candidateSource),
            targetSize,
            aspectRatio: DELIVERY_TARGET_ASPECT_RATIOS[targetSize],
            selected: true,
            source: 'baseline-fixture'
        }];
        target.selectedCandidateId = candidateId;
        target.status = 'candidate_selected';

        const outputPath = buildStandardizedOutputPath({
            outputFolder: OUTPUT_DIR,
            runId: run.runId,
            folderName: job.folderName,
            baseName: job.baseName,
            targetSize,
            candidateIndex: 1,
            candidateCount: 1
        });
        const standardized = await standardizeImageToTarget(candidateSource, outputPath, targetSize, {
            maxOutputBytes: 390 * 1024,
            minQuality: 60
        });

        assert.ok(fs.existsSync(standardized.outputPath), `standardized ${targetSize} output should exist`);
        assert.strictEqual(standardized.outputDimensions, targetSize, `standardized ${targetSize} dimensions should be exact`);
        assert.ok(standardized.sizeBytes <= 390 * 1024, `standardized ${targetSize} output should be under 390KB`);

        target.standardizedCandidates = [{
            candidateId,
            candidateIndex: 1,
            candidateCount: 1,
            outputPath: standardized.outputPath,
            quality: standardized.quality,
            sizeBytes: standardized.sizeBytes,
            sizeKb: standardized.sizeKb,
            dimensions: standardized.outputDimensions
        }];
        target.standardizedPath = standardized.outputPath;
        target.standardized = target.standardizedCandidates[0];
        target.status = 'standardized';
    }

    store.saveRun(run);

    const singleJobRun = {
        ...JSON.parse(JSON.stringify(run)),
        totalJobs: 1,
        jobs: [JSON.parse(JSON.stringify(job))]
    };
    const finalized = await finalizeDeliveryRun(singleJobRun, {
        logoTemplateFolder: LOGO_DIR,
        allowPartial: false,
        maxOutputBytes: 390 * 1024,
        minQuality: 60
    });

    assert.strictEqual(finalized.failedCount, 0, 'full finalize should not fail when all three targets are standardized');
    assert.strictEqual(finalized.finalizedCount, TARGET_SIZES.length, 'full finalize should output three final images for one job');
    assert.strictEqual(finalized.run.status, 'finalized', 'single-job finalize should mark the cloned run finalized');

    const finalizedJob = finalized.run.jobs[0];
    assert.strictEqual(finalizedJob.status, 'finalized', 'fully standardized job should be finalized');
    assert.ok(finalizedJob.postprocess.finalPackageFolder, 'finalized job should record finalPackageFolder');

    TARGET_SIZES.forEach(targetSize => {
        const target = finalizedJob.targets[targetSize];
        assert.strictEqual(target.status, 'finalized', `${targetSize} target should be finalized`);
        assert.ok(fs.existsSync(target.finalPath), `${targetSize} final image should exist`);
        assert.strictEqual(path.basename(target.finalPath), `${finalizedJob.baseName}_${targetSize}.jpg`, `${targetSize} final naming should be stable`);
        const dimensions = readImageDimensions(target.finalPath);
        const expected = DELIVERY_TARGET_DIMENSIONS[targetSize];
        assert.deepStrictEqual(
            { width: dimensions.width, height: dimensions.height },
            { width: expected.width, height: expected.height },
            `${targetSize} final image dimensions should be exact`
        );
        const stat = fs.statSync(target.finalPath);
        assert.ok(stat.size <= 390 * 1024, `${targetSize} final image should be under 390KB`);
    });

    return finalized;
}

async function main() {
    resetTestRoot();
    seedFixtures();

    const store = createDeliveryPostprocessStore({ rootDir: TEST_ROOT });
    const run = store.scanInputFolder({
        inputFolder: INPUT_DIR,
        outputFolder: OUTPUT_DIR,
        candidateCountPerSize: 2,
        namingRule: {
            fixedPrefix: 'GOFCNIM',
            startNumber: '30001',
            regionText: 'QA',
            channelText: 'Baseline',
            primaryTag: 'Topic',
            secondaryTag: 'Delivery'
        }
    });

    assertScanContract(run, store);
    const finalized = await assertStandardizeAndFinalizeContract(run, store);

    const report = {
        runId: run.runId,
        testRoot: TEST_ROOT,
        inputFolder: INPUT_DIR,
        outputFolder: OUTPUT_DIR,
        targetSizes: run.targetSizes,
        sourceFixtures: SOURCE_FIXTURES,
        totalJobs: run.totalJobs,
        finalizedCount: finalized.finalizedCount,
        finalPackageRoot: finalized.finalPackageRoot
    };
    const reportPath = path.join(TEST_ROOT, 'baseline-report.json');
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

    console.log('S11 stage 0 delivery baseline passed');
    console.log(JSON.stringify(report, null, 2));

    if (process.env.KEEP_S11_STAGE0_BASELINE !== '1') {
        fs.rmSync(TEST_ROOT, { recursive: true, force: true });
    }
}

main().catch(error => {
    console.error('S11 stage 0 delivery baseline failed');
    console.error(error);
    process.exitCode = 1;
});
