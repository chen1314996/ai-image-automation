const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    createMaterialKnowledgeCollectorService
} = require('../src/services/material-analysis');
const { selectNextDirection } = require('../src/services/creative-auto/direction-selector');
const { applyPromptGate } = require('../src/services/creative-auto/prompt-gate');

function writeJson(filePath, data) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function makeMaterial(index, tagKey, action) {
    const risk = tagKey === 'high_spend_low_roi';
    return {
        materialId: `material_${index}`,
        materialName: risk ? `风险素材${index}` : `优秀素材${index}`,
        topRank: index,
        parsedName: {
            primary: '题材',
            secondary: '自然危机',
            idea: risk ? '主体过小' : '坠落危机'
        },
        spend: risk ? 880 + index : 260 + index,
        installs: 100 + index,
        ctr: risk ? 0.012 : 0.034,
        cvr: risk ? 0.02 : 0.08,
        cpi: risk ? 8.6 : 2.3,
        ipm: risk ? 1.2 : 6.5,
        d0IapRoi: risk ? 0.04 : 0.32,
        health: {
            tag: {
                key: tagKey,
                label: risk ? '高消耗低回收' : '可复刻'
            },
            action
        }
    };
}

function makeVision(material) {
    const risk = material.materialId.endsWith('4') || material.materialId.endsWith('5') || material.materialId.endsWith('6');
    return {
        materialId: material.materialId,
        status: 'success',
        vision: {
            summary: risk ? '角色主体过小，危险关系不清晰。' : '近景坠落瞬间清晰，冷暖对比强。',
            mainSubject: risk ? '小角色' : '幸存者',
            scene: '雪地断桥',
            hook: risk ? '远景信息分散' : '即将坠落的即时危机',
            suggestedDirection: risk ? '题材/自然危机/主体过小' : '题材/自然危机/坠落危机',
            retainElements: ['断桥', '救援倒计时'],
            variationAxes: ['天气', '镜头距离'],
            riskNotes: risk ? ['画面主体过小', '危险关系不清晰'] : []
        }
    };
}

function createFixture() {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 's8-material-knowledge-'));
    const knowledgeDataDir = path.join(rootDir, 'data', 'creative-knowledge');
    const goodMaterials = [1, 2, 3].map(index => makeMaterial(index, 'replicable', '保留近景危机和明确救援目标。'));
    const riskMaterials = [4, 5, 6].map(index => makeMaterial(index, 'high_spend_low_roi', '主体过小，危险关系不清晰，需要避开。'));
    const allMaterials = goodMaterials.concat(riskMaterials);
    const runId = 'analysis_test_s8';
    const detail = {
        success: true,
        summary: {
            runId,
            projectName: '无尽冬日',
            weekId: '2026-W21'
        },
        materials: allMaterials,
        top100: allMaterials,
        overview: {
            excellentMaterials: goodMaterials,
            riskMaterials,
            goodDirections: [],
            riskDirections: []
        },
        directions: [
            {
                directionKey: '题材/自然危机/坠落危机',
                status: { key: 'scale', label: '放量' },
                action: '本周坠落危机方向表现好，适合复刻。',
                spend: 1200,
                ipm: 6,
                d0IapRoi: 0.3,
                topMaterials: goodMaterials.map(material => ({ materialId: material.materialId }))
            },
            {
                directionKey: '题材/自然危机/主体过小',
                status: { key: 'risk', label: '风险' },
                action: '主体过小方向需要暂停。',
                spend: 2400,
                ipm: 1,
                d0IapRoi: 0.03,
                topMaterials: riskMaterials.map(material => ({ materialId: material.materialId }))
            }
        ]
    };

    writeJson(path.join(knowledgeDataDir, 'directions.json'), {
        version: 1,
        directions: [
            {
                id: 'direction_fall',
                path: '题材/自然危机/坠落危机',
                name: '坠落危机',
                status: 'seed',
                autoRun: true,
                priority: 50,
                stats: {}
            },
            {
                id: 'direction_small',
                path: '题材/自然危机/主体过小',
                name: '主体过小',
                status: 'seed',
                autoRun: true,
                priority: 50,
                stats: {}
            }
        ],
        updatedAt: new Date().toISOString()
    });

    const materialStore = {
        findImport: id => (id === runId ? { runId } : null),
        listImports: () => [{ runId }]
    };
    const materialService = {
        getImport: id => (id === runId ? detail : { success: false, message: 'missing' })
    };
    const visionCache = {
        readRun: id => (id === runId ? {
            status: { runId },
            results: allMaterials.map(makeVision)
        } : null)
    };

    return {
        rootDir,
        knowledgeDataDir,
        runId,
        detail,
        service: createMaterialKnowledgeCollectorService({
            rootDir,
            knowledgeDataDir,
            materialStore,
            materialService,
            visionCache
        })
    };
}

function fakePromptGateStore(rootDir) {
    return {
        filePath: name => path.join(rootDir, 'data', 'creative-knowledge', name),
        read: (name, fallback) => {
            const filePath = path.join(rootDir, 'data', 'creative-knowledge', name);
            if (!fs.existsSync(filePath)) return fallback;
            return readJson(filePath);
        }
    };
}

function main() {
    const fixture = createFixture();
    const { service, knowledgeDataDir, runId, rootDir } = fixture;

    assert.throws(
        () => service.collectMaterial('material_1', { runId }),
        error => error && error.needsConfirmation === true,
        'collectMaterial must require explicit confirmation'
    );

    const positive = service.collectMaterial('material_1', {
        runId,
        decision: 'positive',
        confirm: true
    });
    assert.strictEqual(positive.success, true);
    assert.strictEqual(positive.learning.decision, 'positive');

    const negative = service.collectMaterial('material_4', {
        runId,
        decision: 'negative',
        confirm: true
    });
    assert.strictEqual(negative.success, true);
    assert.strictEqual(negative.learning.decision, 'negative');
    assert.strictEqual(negative.memoryRules.length, 1);

    const weekly = service.collectWeeklyLearnings(runId, {
        confirm: true,
        positiveLimit: 3,
        negativeLimit: 3
    });
    assert.strictEqual(weekly.success, true);
    assert.ok(weekly.positiveLearningCount >= 3, 'weekly should collect at least 3 positive learning records');
    assert.ok(weekly.negativeLearningCount >= 3, 'weekly should collect at least 3 negative learning records');
    assert.ok(weekly.memoryRuleCount >= 3, 'weekly should write at least 3 active avoid rules');

    const learningData = readJson(path.join(knowledgeDataDir, 'material-learnings.json'));
    const memoryData = readJson(path.join(knowledgeDataDir, 'creative-memory.json'));
    assert.ok(learningData.learnings.filter(item => item.decision !== 'negative').length >= 3);
    assert.ok(learningData.learnings.filter(item => item.decision === 'negative').length >= 3);
    assert.ok(!fs.existsSync(path.join(knowledgeDataDir, 'direction-evidence.json')), 'material learnings should not create direction evidence');

    const activeRules = Object.values(memoryData.rules.node || {}).flat();
    assert.ok(activeRules.some(rule => rule.pattern.includes('画面主体过小')), 'memory should include material-analysis avoid pattern');

    const directions = readJson(path.join(knowledgeDataDir, 'directions.json')).directions;
    const selected = selectNextDirection(directions, [], {
        materialLearnings: learningData.learnings,
        memoryRules: activeRules,
        limit: 2
    });
    assert.strictEqual(selected.next.direction.id, 'direction_fall');
    assert.ok(selected.next.reasons.some(reason => reason.includes('素材分析正向经验')));
    assert.ok(selected.candidates.some(item => item.reasons.some(reason => reason.includes('避坑规则'))));

    const draftResult = service.createMaterialDirectionDraft('material_1', {
        runId,
        confirm: true
    });
    assert.strictEqual(draftResult.success, true);
    assert.strictEqual(draftResult.draft.source, 'material-analysis');
    assert.strictEqual(draftResult.draft.referenceImageStatus, 'manual_pending');
    assert.strictEqual(draftResult.draft.primaryTag, '题材');
    assert.strictEqual(draftResult.draft.secondaryTag, '自然危机');
    assert.ok(draftResult.draft.description.includes('画面核心'));
    const draftData = readJson(path.join(knowledgeDataDir, 'direction-drafts.json'));
    assert.ok(draftData.drafts.some(draft => draft.id === draftResult.draft.id));

    const gate = applyPromptGate({
        prompts: [{
            index: 1,
            direction: '主体过小',
            promptTitle: '风险样例',
            prompt: '画面主体过小，远景里危险关系不清晰'
        }],
        selected: {
            direction: directions.find(direction => direction.id === 'direction_small')
        },
        quota: {
            maxPrompts: 5,
            outputQuantity: 4,
            remainingImagesToday: 20
        },
        store: fakePromptGateStore(rootDir),
        runId: 'creative_run_s8_test',
        memoryRules: activeRules
    });
    assert.strictEqual(gate.prompts.length, 0);
    assert.strictEqual(gate.promptQualityReport.rejectionSummary.memory_avoid_rule, 1);
    assert.ok(gate.promptQualityReport.warnings.some(item => item.source === 'material-analysis-memory'));

    console.log('S8 material-analysis knowledge collector tests passed');
}

main();
