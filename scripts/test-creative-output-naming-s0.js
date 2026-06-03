const assert = require('assert');
const path = require('path');

const legilAutomation = require('../src/services/legil');
const { createRouteContext } = require('../src/server/context');

const { normalizeCreativeBatchPromptItems } = createRouteContext();

const DIRECTION_LIBRARY = [
    { id: 'dir-topic', path: ['题材'] },
    { id: 'dir-explore', path: ['题材', '探索发现'] },
    { id: 'dir-shelter', path: ['题材', '探索发现', '避难所'] }
];

function logPass(message) {
    console.log(`[creative-output-naming S0] OK - ${message}`);
}

function splitPath(value) {
    if (Array.isArray(value)) {
        return value.map(part => String(part || '').trim()).filter(Boolean);
    }
    return String(value || '')
        .split(/[\/_>＞]+/g)
        .map(part => part.trim())
        .filter(Boolean);
}

function normalizeRawNameParts(value) {
    const stem = path.parse(String(value || '')).name;
    return stem
        .split(/[_\s]+/g)
        .map(part => part.trim())
        .filter(Boolean)
        .filter(part => !/^[A-Z]{2,}$/i.test(part))
        .filter(part => !/^[A-Z0-9]{8,}$/i.test(part))
        .filter(part => !/^\d{2,5}x\d{2,5}$/i.test(part));
}

function sameOrConservativeContains(source, standard) {
    if (!source || !standard) return false;
    return source === standard || source.includes(standard);
}

function pathMatchScore(candidateParts, standardPath) {
    if (candidateParts.length < standardPath.length) {
        return -1;
    }

    for (let i = 0; i < standardPath.length; i++) {
        if (!sameOrConservativeContains(candidateParts[i], standardPath[i])) {
            return -1;
        }
    }

    return standardPath.length;
}

function resolveStandardLabelPath(input) {
    const candidates = [];
    const explicit = splitPath(input.standardLabelPath || input.sourceLabelPath);
    const sourceDirection = splitPath(input.sourceDirectionPath);
    const rawNameParts = normalizeRawNameParts(input.sourceRawName);

    if (explicit.length) candidates.push(explicit);
    if (sourceDirection.length) candidates.push(sourceDirection);
    if (rawNameParts.length) candidates.push(rawNameParts);

    let best = [];
    for (const candidate of candidates) {
        for (const direction of DIRECTION_LIBRARY) {
            const score = pathMatchScore(candidate, direction.path);
            if (score > best.length) {
                best = direction.path;
            }
        }
    }

    return best.slice(0, 3);
}

function buildExpectedOutputNameBase(input) {
    const standardLabelPath = resolveStandardLabelPath(input);
    return [...standardLabelPath, input.contentTitle]
        .map(part => String(part || '').trim())
        .filter(Boolean)
        .join('_');
}

function checkOldBuildOutputFileNameFormats() {
    const creativeName = legilAutomation.buildOutputFileName(1, {
        outputSequence: 1,
        outputTotal: 12,
        runId: 'creative_20260602_153012',
        referenceImageIndex: 1,
        totalReferenceImages: 7,
        referenceImageName: '题材_探索发现_避难所_雪原信号塔救援_门口抢修热源灯',
        promptIndexWithinImage: 1,
        variantIndex: 1
    });

    assert.match(
        creativeName,
        /^creative_20260602_153012_0001_ref001_prompt01_v01_题材_探索发现_避难所_雪原信号塔救援_门口抢修热源灯_\d{8}_\d{6}\.png$/
    );

    const batchName = legilAutomation.buildOutputFileName(2, {
        outputSequence: 5,
        outputTotal: 12,
        runId: '20260602_153012',
        promptIndexWithinImage: 2,
        variantIndex: 1
    });

    assert.match(
        batchName,
        /^20260602_153012_0005_prompt02_v01_\d{8}_\d{6}\.png$/
    );

    const fallbackName = legilAutomation.buildOutputFileName(2, {
        variantIndex: 3
    });

    assert.match(
        fallbackName,
        /^legil_2_v03_\d{8}_\d{6}\.png$/
    );

    logPass('old Legil filename formats are locked');
}

function checkCreativeBatchNormalizerMetadata() {
    const normalized = normalizeCreativeBatchPromptItems([{
        index: 9,
        sourceRow: 18,
        direction: '题材 / 探索发现 / 避难所 / 雪原信号塔救援',
        newDirectionName: '雪原信号塔救援',
        promptTitle: '门口抢修热源灯',
        sourceDirectionId: 'dir-shelter',
        sourceDirectionPath: '题材 / 探索发现 / 避难所',
        standardLabelPath: ['题材', '探索发现', '避难所'],
        contentTitle: '雪原信号塔救援',
        outputNameBase: '题材_探索发现_避难所_雪原信号塔救援',
        prompt: '雪原避难所门口，幸存者抢修热源灯，高质量 3D 卡通渲染。'
    }])[0];

    assert.strictEqual(normalized.index, 9);
    assert.strictEqual(normalized.sourceRow, 18);
    assert.strictEqual(normalized.newDirectionName, '雪原信号塔救援');
    assert.strictEqual(normalized.sourceDirectionId, 'dir-shelter');
    assert.strictEqual(normalized.sourceDirectionPath, '题材 / 探索发现 / 避难所');
    assert.deepStrictEqual(normalized.standardLabelPath, ['题材', '探索发现', '避难所']);
    assert.strictEqual(normalized.contentTitle, '雪原信号塔救援');
    assert.strictEqual(normalized.outputNameBase, '题材_探索发现_避难所_雪原信号塔救援');

    logPass('creative-batch normalizer preserves naming enhancement fields');
}

function checkExpectedNamingSamples() {
    const samples = [
        {
            name: '创意拓展一级标签',
            input: {
                sourceDirectionPath: '题材',
                contentTitle: '冰封地铁站避难'
            },
            expected: '题材_冰封地铁站避难'
        },
        {
            name: '创意拓展二级标签',
            input: {
                sourceDirectionPath: '题材 / 探索发现',
                contentTitle: '冰封地铁站避难'
            },
            expected: '题材_探索发现_冰封地铁站避难'
        },
        {
            name: '创意拓展三级标签',
            input: {
                sourceDirectionPath: '题材 / 探索发现 / 避难所',
                contentTitle: '雪原信号塔救援'
            },
            expected: '题材_探索发现_避难所_雪原信号塔救援'
        },
        {
            name: '创意拓展三级以下方向',
            input: {
                sourceDirectionPath: '题材 / 探索发现 / 避难所 / 地下入口',
                contentTitle: '地下补给仓发现'
            },
            expected: '题材_探索发现_避难所_地下补给仓发现'
        },
        {
            name: '素材分析转创意拓展',
            input: {
                sourceRawName: 'GOFCNIM6724_DR_题材_探索发现_避难所形象拓展_800x800',
                contentTitle: '雪原信号塔救援'
            },
            expected: '题材_探索发现_避难所_雪原信号塔救援'
        },
        {
            name: '普通批量产图有标签原图',
            input: {
                sourceRawName: '题材_探索发现_废弃观测站.png',
                contentTitle: '夜间求生信号'
            },
            expected: '题材_探索发现_夜间求生信号'
        },
        {
            name: '普通批量产图无标签原图',
            input: {
                sourceRawName: 'GOFCNIM6724_DR_废墟暖光补给_800x800.png',
                contentTitle: '夜间求生信号'
            },
            expected: '夜间求生信号'
        }
    ];

    samples.forEach(sample => {
        assert.strictEqual(
            buildExpectedOutputNameBase(sample.input),
            sample.expected,
            sample.name
        );
    });

    logPass('seven expected outputNameBase samples are locked');
}

function main() {
    checkOldBuildOutputFileNameFormats();
    checkCreativeBatchNormalizerMetadata();
    checkExpectedNamingSamples();
    console.log('[creative-output-naming S0] Baseline and acceptance samples locked.');
}

main();
