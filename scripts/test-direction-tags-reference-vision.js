const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createCreativeKnowledgeService } = require('../src/services/creative-knowledge');
const { DIRECTION_TAGS_FILE, isCleanDirectionTag } = require('../src/services/direction-tags');

const ONE_PIXEL_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
    'base64'
);

function writeJson(filePath, data) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeImage(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, ONE_PIXEL_PNG);
}

function assertCleanTags(tags, label) {
    assert.ok(Array.isArray(tags), `${label} should be an array`);
    tags.forEach(tag => {
        assert.ok(isCleanDirectionTag(tag), `${label} contains unclean tag: ${tag}`);
        assert.ok(!/[a-z]/i.test(tag), `${label} contains English tag: ${tag}`);
        assert.ok(tag.length <= 8, `${label} tag is too long: ${tag}`);
    });
}

function seedFixture(rootDir) {
    const dataDir = path.join(rootDir, 'data', 'creative-knowledge');
    const imageDir = path.join(dataDir, 'reference-images', 'workbook');
    writeJson(path.join(dataDir, 'directions.json'), {
        version: 1,
        directions: [
            {
                id: 'no-image',
                path: '题材/探索发现/空参考',
                name: '空参考',
                description: '没有参考图，等待后续手动补图。'
            },
            {
                id: 'one-image',
                path: '题材/探索发现/城市废墟',
                name: '城市废墟',
                description: '废墟入口附近出现红色信号和暖光目标。'
            },
            {
                id: 'three-images',
                path: '题材/通行救援/雪地桥梁',
                name: '雪地桥梁',
                description: '断裂冰面上搭建临时桥，队伍穿过暴雪。'
            }
        ]
    });

    const images = [];
    const addRef = (directionId, slot) => {
        const filePath = path.join(imageDir, directionId, `ref-${slot}.png`);
        writeImage(filePath);
        images.push({
            id: `${directionId}-ref-${slot}`,
            directionId,
            matchedDirectionIds: [directionId],
            status: 'active',
            slot,
            filePath,
            fileName: `ref-${slot}.png`,
            source: 'workbook-embedded',
            relativePath: `${directionId}/ref-${slot}.png`
        });
    };
    addRef('one-image', 1);
    addRef('three-images', 1);
    addRef('three-images', 2);
    addRef('three-images', 3);
    writeJson(path.join(dataDir, 'reference-images.json'), {
        version: 1,
        images
    });
    return dataDir;
}

async function main() {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'direction-tags-reference-vision-'));
    const dataDir = seedFixture(rootDir);
    const calls = [];
    const service = createCreativeKnowledgeService({
        rootDir,
        callDirectionTagVision: async ({ direction, references, dataUrls }) => {
            calls.push({ directionId: direction.id, referenceCount: references.length, dataUrlCount: dataUrls.length });
            if (direction.id === 'three-images') {
                return {
                    config: { model: 'stub-vision' },
                    parsed: {
                        mainTags: ['冰桥通行', '暴雪探路', '临时搭建'],
                        extraTags: ['队伍穿越', '暖光目标'],
                        riskTags: ['主体不清'],
                        summary: '断裂冰面上的临时桥和暴雪穿行是画面重点。',
                        confidence: 0.91
                    }
                };
            }
            return {
                config: { model: 'stub-vision' },
                parsed: {
                    mainTags: ['废墟入口', '红色信号', '暖光目标'],
                    extraTags: ['地图线索', '破损街道'],
                    riskTags: ['文字干扰'],
                    summary: '城市废墟入口、红色信号和暖光目标构成主要识别点。',
                    confidence: 0.73
                }
            };
        }
    });

    const missing = await service.analyzeDirectionTagsFromReferences('no-image', {});
    assert.strictEqual(missing.success, true);
    assert.strictEqual(missing.analyzed, false);
    assert.strictEqual(missing.referenceStatus.status, 'missing');
    assert.strictEqual(calls.length, 0, 'no-image should not call vision');

    const one = await service.analyzeDirectionTagsFromReferences('one-image', {});
    assert.strictEqual(one.success, true);
    assert.strictEqual(one.analyzed, true);
    assert.strictEqual(one.directionTags.referenceImageStatus, 'insufficient-analyzed');
    assert.strictEqual(one.directionTags.referenceImageCount, 1);
    assert.ok(one.directionTags.needsMoreReferences, '1 image should mark needsMoreReferences');
    assertCleanTags(one.directionTags.tags, 'one-image tags');
    assertCleanTags(one.directionTags.riskTags, 'one-image risk tags');
    assert.ok(one.directionTags.tags.includes('入口目标'));

    const three = await service.analyzeDirectionTagsFromReferences('three-images', {});
    assert.strictEqual(three.success, true);
    assert.strictEqual(three.analyzed, true);
    assert.strictEqual(three.directionTags.referenceImageStatus, 'analyzed');
    assert.strictEqual(three.directionTags.referenceImageCount, 3);
    assert.strictEqual(three.directionTags.needsMoreReferences, false);
    assert.ok(three.directionTags.tags.includes('桥梁通行'));

    const listed = service.listDirections({});
    const listedThree = listed.directions.find(item => item.id === 'three-images');
    assert.strictEqual(listedThree.directionTagSummary.referenceImageStatus, 'analyzed');
    assert.ok(listedThree.directionTags.includes('桥梁通行'));

    const manual = service.updateDirectionTagsManualOverride('one-image', {
        mainTags: ['手动重点', '雪线入口'],
        extraTags: ['近景物件'],
        riskTags: ['重复构图'],
        summary: '人工确认后的方向标签。'
    });
    assert.strictEqual(manual.success, true);
    assert.strictEqual(manual.directionTags.manual, true);
    assert.ok(manual.directionTags.tags.includes('手动重点'));

    const refresh = service.refreshDirectionTags({});
    assert.strictEqual(refresh.success, true);
    const refreshed = service.getDirectionTags('one-image', {});
    assert.strictEqual(refreshed.directionTags.manual, true);
    assert.ok(refreshed.directionTags.tags.includes('手动重点'), 'manual tags should win after refresh');
    assert.ok(refreshed.directionTags.riskTags.includes('重复构图'), 'manual risk tags should persist');

    const skipped = await service.analyzeDirectionTagsFromReferences('one-image', { force: true });
    assert.strictEqual(skipped.skipped, true, 'AI reanalysis should not overwrite manual tags by default');

    const persisted = readJson(path.join(dataDir, DIRECTION_TAGS_FILE));
    const visionRecord = persisted.directions.find(item => item.directionId === 'three-images');
    assert.strictEqual(visionRecord.source, 'reference-vision');
    assert.strictEqual(visionRecord.analysis.source, 'reference-vision');

    fs.rmSync(rootDir, { recursive: true, force: true });
    console.log('direction tags reference vision tests passed');
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
