const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createCreativeKnowledgeService } = require('../src/services/creative-knowledge');

function writeJson(filePath, data) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function writeTinyPng(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
        'base64'
    );
    fs.writeFileSync(filePath, png);
}

function seedKnowledgeBase(root) {
    const dataDir = path.join(root, 'data', 'creative-knowledge');
    const outputDir = path.join(root, 'output');
    const referenceDir = path.join(dataDir, 'reference-images', 'workbook', 'direction-a');
    const existingImagePath = path.join(outputDir, 'run-a', 'asset-a.png');
    const missingImagePath = path.join(outputDir, 'run-b', 'missing.png');
    const referenceImagePath = path.join(referenceDir, 'direction-a_01_ref-a.png');
    const now = new Date('2026-05-26T12:00:00.000Z').toISOString();

    writeTinyPng(existingImagePath);
    writeTinyPng(referenceImagePath);

    const directions = [
        {
            id: 'direction-a',
            path: 'Subject/Discovery/Signpost',
            name: 'Signpost',
            primaryTag: 'Subject',
            secondaryTag: 'Discovery',
            subTag: 'Signpost',
            description: 'Readable survival signpost scenes.',
            referenceHints: ['signpost-ref'],
            autoRun: true,
            priority: 90
        },
        {
            id: 'direction-b',
            path: 'Scene/Shelter/Wall',
            name: 'Wall',
            primaryTag: 'Scene',
            secondaryTag: 'Shelter',
            subTag: 'Wall',
            description: 'Defensive wall scenes.',
            referenceHints: [],
            autoRun: false,
            priority: 20
        }
    ];

    const assets = [
        {
            assetId: 'asset-a',
            runId: 'run-a',
            source: 'creative-auto-run-once',
            directionId: 'direction-a',
            directionPath: 'Subject/Discovery/Signpost',
            directionName: 'Signpost',
            promptHash: 'prompt-a',
            prompt: 'A clear survival signpost in a frozen street.',
            promptDirection: 'Signpost direction',
            promptTitle: 'Frozen Street Sign',
            visualDna: {
                atmosphere: ['tense crisis'],
                camera: ['first person'],
                event: ['discovery'],
                visualHook: ['readable survival signpost']
            },
            promptIndex: 1,
            outputIndex: 1,
            filePath: existingImagePath,
            fileName: 'asset-a.png',
            fileSize: fs.statSync(existingImagePath).size,
            savedAt: '2026-05-26T12:10:00.000Z',
            recordedAt: '2026-05-26T12:11:00.000Z',
            outputFolder: outputDir
        },
        {
            assetId: 'asset-b',
            runId: 'run-b',
            source: 'creative-auto-run-once',
            directionId: 'direction-b',
            directionPath: 'Scene/Shelter/Wall',
            directionName: 'Wall',
            promptHash: 'prompt-b',
            prompt: 'A reinforced wall around a shelter.',
            promptDirection: 'Wall direction',
            promptTitle: 'Shelter Wall',
            promptIndex: 1,
            outputIndex: 1,
            filePath: missingImagePath,
            fileName: 'missing.png',
            fileSize: 0,
            savedAt: '2026-05-26T12:05:00.000Z',
            recordedAt: '2026-05-26T12:06:00.000Z',
            outputFolder: outputDir
        }
    ];

    writeJson(path.join(dataDir, 'metadata.json'), {
        version: 1,
        importedAt: now,
        counts: {
            directions: directions.length,
            topMaterials: 99,
            topMaterialInsights: 3,
            referenceImages: 1
        },
        warnings: []
    });
    writeJson(path.join(dataDir, 'directions.json'), {
        version: 1,
        importedAt: now,
        directions
    });
    writeJson(path.join(dataDir, 'reference-images.json'), {
        version: 1,
        importedAt: now,
        images: [{
            id: 'ref-a',
            fileName: 'signpost-ref.png',
            filePath: referenceImagePath,
            directionId: 'direction-a',
            directionPath: 'Subject/Discovery/Signpost',
            directionName: 'Signpost',
            matchedDirectionIds: ['direction-a'],
            source: 'workbook-embedded',
            sourceSlot: 1
        }]
    });
    writeJson(path.join(dataDir, 'assets.json'), {
        version: 1,
        updatedAt: now,
        assets
    });
    writeJson(path.join(dataDir, 'feedback.json'), {
        version: 1,
        feedback: [{
            feedbackId: 'feedback-a',
            assetId: 'asset-a',
            status: 'good',
            value: 'liked',
            directionPath: 'Subject/Discovery/Signpost',
            note: 'Strong readable hook.'
        }, {
            feedbackId: 'feedback-draft-ready',
            directionDraftId: 'draft-ready',
            status: 'good',
            directionPath: 'Subject/Discovery/Signpost/Rescue Crate Handoff',
            note: 'Draft has a usable visual hook.'
        }]
    });
    writeJson(path.join(dataDir, 'direction-drafts.json'), {
        version: 1,
        updatedAt: now,
        drafts: [
            {
                id: 'draft-ready',
                status: 'draft',
                name: 'Rescue Crate Handoff',
                path: 'Subject/Discovery/Signpost/Rescue Crate Handoff',
                description: 'Survivors hand off a glowing rescue crate near a survival signpost.',
                source: 'agent',
                sourceRunId: 'run-a',
                sourceDirectionId: 'direction-a',
                sourceDirectionPath: 'Subject/Discovery/Signpost',
                sourceStrategy: 'Use the crate and signpost as a production-ready action hook.',
                dimensions: {
                    atmosphere: 'tense crisis',
                    camera: 'first person',
                    event: 'handoff',
                    visualHook: 'glowing rescue crate'
                },
                visualHook: 'glowing rescue crate',
                duplicateRisk: '',
                selectedAsReference: true,
                prompts: [{
                    title: 'Crate handoff',
                    prompt: 'Survivors pass a glowing rescue crate beside a readable signpost.'
                }],
                createdAt: '2026-05-26T12:30:00.000Z',
                updatedAt: '2026-05-26T12:30:00.000Z'
            },
            {
                id: 'draft-risk',
                status: 'draft',
                name: 'Similar Signpost',
                path: 'Subject/Discovery/Signpost/Similar Signpost',
                description: '',
                source: 'agent',
                sourceRunId: 'run-a',
                sourceDirectionId: 'direction-a',
                sourceDirectionPath: 'Subject/Discovery/Signpost',
                sourceStrategy: 'Too close to existing signpost scene.',
                dimensions: {},
                duplicateRisk: 'high duplicate risk',
                prompts: [],
                createdAt: '2026-05-26T12:31:00.000Z',
                updatedAt: '2026-05-26T12:31:00.000Z'
            }
        ]
    });
    writeJson(path.join(dataDir, 'direction-expansion-history.json'), {
        version: 1,
        items: [
            {
                runId: 'run-history-a',
                dedupeKey: 'history-a',
                sourceDirectionPath: 'Subject/Discovery/Signpost',
                newDirectionName: 'Dawn Signpost Discovery',
                visualDna: {
                    atmosphere: ['tense crisis'],
                    camera: ['first person'],
                    event: ['discovery'],
                    visualHook: ['readable survival signpost']
                },
                productionAdvice: 'Keep the sign readable and close to the viewer.',
                createdAt: '2026-05-26T12:20:00.000Z'
            },
            {
                runId: 'run-history-b',
                dedupeKey: 'history-b',
                sourceDirectionPath: 'Subject/Discovery/Signpost',
                newDirectionName: 'Snow Route Signpost',
                visualDna: {
                    atmosphere: ['tense crisis'],
                    camera: ['first person'],
                    event: ['discovery'],
                    visualHook: ['readable survival signpost']
                },
                productionAdvice: 'Use the signpost as the hook for route discovery.',
                createdAt: '2026-05-26T12:25:00.000Z'
            }
        ]
    });
    writeJson(path.join(dataDir, 'scheduler-state.json'), {
        version: 1,
        status: 'idle',
        consecutiveFailures: 0,
        daily: {
            date: '2026-05-26',
            imageCount: 4,
            imageLimit: 1000
        },
        updatedAt: now
    });
    writeJson(path.join(dataDir, 'runs', 'run-a.json'), {
        runId: 'run-a',
        mode: 'run-once',
        agentOnly: false,
        status: 'completed',
        phase: 'legil_completed',
        createdAt: '2026-05-26T12:00:00.000Z',
        startedAt: '2026-05-26T12:00:01.000Z',
        completedAt: '2026-05-26T12:12:00.000Z',
        sourceDirection: directions[0],
        promptTotalRaw: 1,
        promptTotal: 1,
        expectedImageTotal: 4,
        legilResult: {
            savedCount: 4,
            failedCount: 0
        },
        assets: {
            newAssetCount: 1,
            matchedFileCount: 1,
            assetIds: ['asset-a']
        },
        assetIds: ['asset-a'],
        config: {
            outputFolder: outputDir
        }
    });
    writeJson(path.join(dataDir, 'runs', 'run-b.json'), {
        runId: 'run-b',
        mode: 'agent-only',
        agentOnly: true,
        status: 'failed',
        phase: 'agent_failed',
        createdAt: '2026-05-26T11:00:00.000Z',
        startedAt: '2026-05-26T11:00:01.000Z',
        completedAt: '2026-05-26T11:01:00.000Z',
        sourceDirection: directions[1],
        promptTotalRaw: 1,
        promptTotal: 0,
        expectedImageTotal: 0,
        legilResult: {
            savedCount: 0,
            failedCount: 1
        },
        assets: {
            newAssetCount: 0,
            matchedFileCount: 0,
            assetIds: []
        },
        message: 'Agent failed before Legil.'
    });

    return { dataDir, existingImagePath, referenceImagePath };
}

function logPass(message) {
    console.log(`[S1] OK - ${message}`);
}

function main() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'creative-knowledge-s1-'));

    try {
        const { existingImagePath, referenceImagePath } = seedKnowledgeBase(root);
        const service = createCreativeKnowledgeService({
            rootDir: root,
            logger: { info() {}, error() {} }
        });

        const overview = service.getOverview();
        assert.strictEqual(overview.success, true);
        assert.strictEqual(overview.imported, true);
        assert.strictEqual(overview.counts.directions, 2);
        assert.strictEqual(overview.counts.autoRunDirections, 1);
        assert.strictEqual(overview.counts.directionsWithReferenceImages, 1);
        assert.strictEqual(overview.counts.directionsWithRuns, 2);
        assert.strictEqual(overview.counts.topMaterials, 99);
        assert.strictEqual(overview.counts.referenceImages, 1);
        assert.strictEqual(overview.counts.assets, 2);
        assert.strictEqual(overview.counts.assetsWithFiles, 1);
        assert.strictEqual(overview.counts.feedback, 2);
        assert.strictEqual(overview.counts.runs, 2);
        assert.strictEqual(overview.counts.completedRuns, 1);
        assert.strictEqual(overview.visualDnaOverview.counts.totalDirections, 2);
        assert.strictEqual(overview.visualDnaOverview.counts.coveredDirections, 2);
        assert.strictEqual(overview.primaryTags.length, 2);
        assert.strictEqual(overview.recentRuns[0].runId, 'run-a');
        assert.strictEqual(overview.recentAssets[0].assetId, 'asset-a');
        logPass('overview aggregates directions, references, assets, feedback, and runs');

        const directions = service.listDirections({ q: 'signpost', limit: 10 });
        assert.strictEqual(directions.success, true);
        assert.strictEqual(directions.total, 1);
        assert.strictEqual(directions.directions[0].id, 'direction-a');
        assert.strictEqual(directions.directions[0].referenceImages.length, 1);
        assert.strictEqual(directions.directions[0].referenceImages[0].imageUrl, '/api/creative-knowledge/references/ref-a/file');
        assert.deepStrictEqual(directions.directions[0].knowledgeStats, {
            matchedReferenceCount: 1,
            activeReferenceCount: 1,
            referenceHintCount: 1,
            runCount: 1,
            assetCount: 1,
            evidenceCount: 0
        });
        logPass('directions include read-only knowledge statistics and search');

        const assets = service.listAssets({ limit: 10 });
        assert.strictEqual(assets.success, true);
        assert.strictEqual(assets.total, 2);
        assert.strictEqual(assets.assets[0].assetId, 'asset-a');
        assert.strictEqual(assets.assets[0].fileExists, true);
        assert.strictEqual(assets.assets[0].imageUrl, '/api/creative-knowledge/assets/asset-a/file');
        assert.strictEqual(assets.assets[1].fileExists, false);

        const existingOnly = service.listAssets({ existsOnly: 'true' });
        assert.strictEqual(existingOnly.total, 1);
        assert.strictEqual(existingOnly.assets[0].assetId, 'asset-a');

        const assetFile = service.getAssetFile('asset-a');
        assert.strictEqual(assetFile.filePath, existingImagePath);
        assert.strictEqual(service.getAssetFile('asset-b'), null);
        assert.strictEqual(service.getReferenceFile('ref-a').filePath, referenceImagePath);
        logPass('assets list tracks file existence and exposes local image files');

        const runs = service.listRuns({ limit: 10 });
        assert.strictEqual(runs.success, true);
        assert.strictEqual(runs.total, 2);
        assert.strictEqual(runs.runs[0].runId, 'run-a');
        assert.strictEqual(runs.runs[0].savedCount, 4);
        assert.deepStrictEqual(runs.runs[0].assetIds, ['asset-a']);

        const failedRuns = service.listRuns({ status: 'failed' });
        assert.strictEqual(failedRuns.total, 1);
        assert.strictEqual(failedRuns.runs[0].runId, 'run-b');
        logPass('runs list is sorted, compact, searchable, and status-filtered');

        const drafts = service.listDirectionDrafts({ limit: 10 });
        assert.strictEqual(drafts.success, true);
        assert.strictEqual(drafts.total, 2);
        assert.strictEqual(drafts.governanceCounts.missingDna, 1);
        assert.strictEqual(drafts.governanceCounts.missingReference, 2);
        assert.strictEqual(drafts.governanceCounts.highDuplicateRisk, 1);
        assert.strictEqual(drafts.governanceCounts.hasGoodEvidence, 1);
        assert.strictEqual(drafts.governanceCounts.readyToAccept, 1);
        const readyDraft = drafts.drafts.find(draft => draft.id === 'draft-ready');
        assert.strictEqual(readyDraft.governance.dnaCompleteness.label, '6 / 6');
        assert.strictEqual(readyDraft.governance.referenceCount, 1);
        assert.strictEqual(readyDraft.governance.duplicateRiskLabel, '低');
        assert.strictEqual(readyDraft.governance.promptSampleCount, 1);
        assert.strictEqual(readyDraft.governance.successCaseCount, 1);

        const missingDna = service.listDirectionDrafts({ governance: 'missing_dna', limit: 10 });
        assert.strictEqual(missingDna.total, 1);
        assert.strictEqual(missingDna.drafts[0].id, 'draft-risk');

        const preflight = service.acceptDirectionDraft('draft-risk', {}, {});
        assert.strictEqual(preflight.success, false);
        assert.strictEqual(preflight.needsPreflightConfirmation, true);
        assert.ok(preflight.preflight.warnings.length >= 1);

        const accepted = service.acceptDirectionDraft('draft-ready', { reason: 'Ready for production.', confirmPreflight: true }, {});
        assert.strictEqual(accepted.success, true);
        assert.strictEqual(accepted.direction.visualDna.visualHook[0], 'glowing rescue crate');
        assert.strictEqual(accepted.direction.referenceImageStatus, 'ready');
        logPass('direction draft governance exposes completeness queues and preflight checks');

        const workbench = service.buildVisualDnaWorkbench();
        assert.strictEqual(workbench.success, true);
        assert.strictEqual(workbench.counts.parentDirections, 2);
        assert.strictEqual(workbench.counts.adoptionSamples, 6);
        assert.strictEqual(workbench.counts.feedbackSamples, 3);
        assert.strictEqual(workbench.counts.historySamples, 2);
        assert.strictEqual(workbench.counts.suggestedRules, 1);
        assert.strictEqual(workbench.adoptionPatterns[0].label, 'Signpost');
        assert.deepStrictEqual(workbench.adoptionPatterns[0].preferences.camera[0], {
            value: 'first person',
            count: 4,
            sourceIds: ['feedback-a', 'run-history-a:history-a', 'run-history-b:history-b', 'draft-ready']
        });
        logPass('visual DNA workbench aggregates accepted feedback into adoption patterns');

        const generatedRules = service.generateVisualDnaRuleDrafts({ limit: 5 });
        assert.strictEqual(generatedRules.success, true);
        assert.strictEqual(generatedRules.drafts.length, 1);
        assert.strictEqual(generatedRules.memory.draftRules.length, 1);
        assert.strictEqual(generatedRules.memory.draftRules[0].source, 'visual-dna-workbench');
        logPass('visual DNA workbench can write preferred-rule drafts into creative memory');

        console.log('[S1] Knowledge readonly MVP contract is locked.');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

main();
