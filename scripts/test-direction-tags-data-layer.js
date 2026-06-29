const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createCreativeKnowledgeService } = require('../src/services/creative-knowledge');
const {
    DIRECTION_TAGS_FILE,
    isCleanDirectionTag,
    normalizeDirectionTagsForRecord
} = require('../src/services/direction-tags');

function writeJson(filePath, data) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function assertCleanTags(tags, label) {
    assert.ok(Array.isArray(tags), `${label} should be an array`);
    tags.forEach(tag => {
        assert.ok(isCleanDirectionTag(tag), `${label} contains unclean tag: ${tag}`);
        assert.ok(!/[a-z]/i.test(tag), `${label} contains English tag: ${tag}`);
        assert.ok(!/(visualDna|visualHook|DNA|氛围|视角|事件|钩子)/i.test(tag), `${label} exposes legacy wording: ${tag}`);
        assert.ok(tag.length <= 8, `${label} tag is too long: ${tag}`);
    });
}

function seedKnowledgeBase(rootDir) {
    const dataDir = path.join(rootDir, 'data', 'creative-knowledge');
    const now = '2026-06-26T10:00:00.000Z';

    writeJson(path.join(dataDir, 'directions.json'), {
        version: 1,
        importedAt: now,
        directions: [
            {
                id: 'city-ruins',
                path: '题材/探索发现/城市废墟',
                name: '城市废墟',
                description: '红色信号烟照出旧地图筒，暖光急救盒放在倒塌入口前，避免英文文字和过度科幻。',
                visualDna: {
                    atmosphere: ['urgent hope'],
                    camera: ['first person'],
                    event: ['discovery'],
                    visualHook: ['signal flare clue']
                }
            },
            {
                id: 'ice-bridge',
                path: '题材/通行救援/冰桥',
                name: '冰桥',
                description: '断裂冰面上搭建临时木板桥，手部递过绳索，远处有暖光目标。'
            }
        ]
    });

    writeJson(path.join(dataDir, 'assets.json'), {
        version: 1,
        assets: [
            {
                assetId: 'asset-good-1',
                directionId: 'city-ruins',
                directionPath: '题材/探索发现/城市废墟',
                promptTitle: '黎明废墟俯瞰',
                prompt: '城市废墟中有巨型地标、地图线索和暖光目标。'
            }
        ]
    });

    writeJson(path.join(dataDir, 'feedback.json'), {
        version: 1,
        feedback: [
            {
                feedbackId: 'feedback-good-1',
                assetId: 'asset-good-1',
                status: 'good',
                note: '信号线索明确，暖光目标很醒目，主体明确。'
            }
        ]
    });

    writeJson(path.join(dataDir, 'direction-evidence.json'), {
        version: 1,
        evidence: [
            {
                id: 'evidence-1',
                directionId: 'city-ruins',
                directionPath: '题材/探索发现/城市废墟',
                description: '巨型地标旁发现地图线索，入口目标清楚。',
                source: 'user-accepted'
            }
        ]
    });

    writeJson(path.join(dataDir, 'direction-drafts.json'), {
        version: 1,
        drafts: [
            {
                id: 'draft-1',
                status: 'accepted',
                targetDirectionId: 'city-ruins',
                path: '题材/探索发现/城市废墟/信号急救盒',
                name: '信号急救盒',
                description: '信号烟旁的物资补给和急救箱，注意不要出现品牌文字。',
                riskNote: '品牌文字风险'
            }
        ]
    });

    writeJson(path.join(dataDir, 'direction-expansion-history.json'), {
        version: 1,
        items: [
            {
                sourceDirectionId: 'city-ruins',
                sourceDirectionPath: '题材/探索发现/城市废墟',
                newDirectionName: '红色信号烟指向旧地图筒',
                description: '信号线索、地图线索和选择压力组合。'
            }
        ]
    });

    writeJson(path.join(dataDir, 'runs', 'run-tags.json'), {
        runId: 'run-tags',
        sourceDirection: {
            id: 'city-ruins',
            path: '题材/探索发现/城市废墟',
            name: '城市废墟'
        },
        directionPlanReport: {
            selectedExtensions: [
                {
                    name: '坍塌入口前的维修零件包',
                    description: '入口目标前有维修零件和搭建动作。',
                    productionAdvice: '主体明确，避免过度科幻。'
                }
            ]
        }
    });

    return dataDir;
}

function main() {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'direction-tags-data-layer-'));
    const dataDir = seedKnowledgeBase(rootDir);
    const service = createCreativeKnowledgeService({ rootDir });

    const refresh = service.refreshDirectionTags({});
    assert.strictEqual(refresh.success, true);
    assert.strictEqual(refresh.total, 2);

    const filePath = path.join(dataDir, DIRECTION_TAGS_FILE);
    assert.ok(fs.existsSync(filePath), 'direction-tags.json should be written');
    const persisted = readJson(filePath);
    const city = persisted.directions.find(item => item.directionId === 'city-ruins');
    assert.ok(city, 'city direction should have tag record');
    assertCleanTags(city.tags, 'persisted direction tags');
    assertCleanTags(city.riskTags, 'persisted risk tags');
    assert.ok(city.tags.includes('信号线索'), 'should aggregate selected/history signal clue');
    assert.ok(
        city.topTags.some(item => (item.sources || []).some(source => source.type === 'feedback')),
        'should aggregate adopted feedback into scored tags'
    );
    assert.ok(
        normalizeDirectionTagsForRecord({ description: '信号线索明确，暖光目标很醒目，主体明确。' }, { limit: 8 }).tags.includes('暖光目标'),
        'feedback text should extract warm target'
    );
    assert.ok(city.tags.includes('地图线索'), 'should aggregate evidence map clue');
    assert.ok(city.riskTags.includes('文字干扰'), 'should split text risk');
    assert.ok(city.riskTags.includes('过度科幻'), 'should split sci-fi risk');
    assert.ok(!city.tags.includes('文字干扰'), 'risk should not appear in main tags');
    assert.ok(!city.tags.includes('过度科幻'), 'risk should not appear in main tags');

    const directions = service.listDirections({});
    const listedCity = directions.directions.find(item => item.id === 'city-ruins');
    assert.deepStrictEqual(listedCity.directionTags, city.tags, 'direction cards should read the same tag set');
    assert.deepStrictEqual(listedCity.riskTags, city.riskTags, 'direction cards should read the same risk set');

    const detail = service.getDirectionTags('city-ruins', {});
    assert.strictEqual(detail.success, true);
    assert.deepStrictEqual(detail.directionTags.tags, city.tags);
    assert.deepStrictEqual(detail.directionTags.riskTags, city.riskTags);

    const overview = service.buildDirectionTagsOverview({});
    assert.strictEqual(overview.success, true);
    assert.strictEqual(overview.counts.totalDirections, 2);
    assert.strictEqual(overview.counts.coveredDirections, 2);
    assert.ok(overview.topTags.some(item => item.value === '信号线索'));

    writeJson(filePath, { version: 1, directions: [] });
    const fallbackList = service.listDirections({});
    const fallbackCity = fallbackList.directions.find(item => item.id === 'city-ruins');
    assertCleanTags(fallbackCity.directionTags, 'fallback direction tags');
    assert.ok(fallbackCity.directionTags.length > 0, 'missing direction-tags.json should fallback from old fields');

    const legacy = normalizeDirectionTagsForRecord({
        name: 'Signal flare clue',
        visualDna: {
            atmosphere: ['urgent hope'],
            camera: ['first person'],
            event: ['discovery'],
            visualHook: ['signal flare clue']
        },
        riskNote: 'avoid English text and over sci-fi'
    });
    assertCleanTags(legacy.tags, 'legacy tags');
    assertCleanTags(legacy.riskTags, 'legacy risk tags');
    assert.ok(legacy.tags.includes('温暖希望'));
    assert.ok(legacy.tags.includes('第一人称'));
    assert.ok(legacy.tags.includes('信号线索'));
    assert.ok(legacy.riskTags.includes('文字干扰'));
    assert.ok(legacy.riskTags.includes('过度科幻'));

    fs.rmSync(rootDir, { recursive: true, force: true });
    console.log('direction tags data layer tests passed');
}

main();
