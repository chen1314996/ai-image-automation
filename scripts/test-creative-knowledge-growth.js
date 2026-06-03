const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createCreativeKnowledgeService } = require('../src/services/creative-knowledge');
const { selectNextDirection } = require('../src/services/creative-auto/direction-selector');

function writeJson(filePath, data) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function seed(root) {
    const dataDir = path.join(root, 'data', 'creative-knowledge');
    const runId = 'creative_run_s4_growth';

    writeJson(path.join(dataDir, 'metadata.json'), {
        version: 1,
        importedAt: '2026-05-27T00:00:00.000Z',
        counts: {
            directions: 2,
            topMaterials: 0,
            topMaterialInsights: 0,
            referenceImages: 0
        },
        warnings: []
    });
    writeJson(path.join(dataDir, 'directions.json'), {
        version: 1,
        importedAt: '2026-05-27T00:00:00.000Z',
        directions: [
            {
                id: 'direction-seed-wall',
                orderIndex: 1,
                sheetName: 'seed',
                path: '题材/探索发现/围墙',
                name: '围墙',
                primaryTag: '题材',
                secondaryTag: '探索发现',
                tertiaryTag: '围墙',
                description: '冰封末世中的围墙、防御结构和外部威胁观察。',
                priority: 1,
                status: 'seed',
                autoRun: true,
                stats: {
                    expandedCount: 8,
                    imageCount: 120,
                    failureCount: 0,
                    lastRunAt: '2026-05-27T00:00:00.000Z'
                }
            },
            {
                id: 'direction-seed-outpost',
                orderIndex: 2,
                sheetName: 'seed',
                path: '题材/探索发现/哨站',
                name: '哨站',
                primaryTag: '题材',
                secondaryTag: '探索发现',
                tertiaryTag: '哨站',
                priority: 1,
                status: 'seed',
                autoRun: true,
                stats: {
                    expandedCount: 10,
                    imageCount: 160,
                    failureCount: 0,
                    lastRunAt: '2026-05-27T00:00:00.000Z'
                }
            }
        ]
    });
    writeJson(path.join(dataDir, 'reference-images.json'), { version: 1, images: [] });
    writeJson(path.join(dataDir, 'assets.json'), { version: 1, assets: [], updatedAt: '2026-05-27T00:00:00.000Z' });
    writeJson(path.join(dataDir, 'feedback.json'), { version: 1, feedback: [], updatedAt: '2026-05-27T00:00:00.000Z' });
    writeJson(path.join(dataDir, 'scheduler-state.json'), {
        version: 1,
        status: 'idle',
        daily: {
            date: '2026-05-27',
            imageCount: 0,
            imageLimit: 1000
        }
    });
    writeJson(path.join(dataDir, 'runs', `${runId}.json`), {
        runId,
        status: 'completed',
        phase: 'agent_only_completed',
        createdAt: '2026-05-27T08:00:00.000Z',
        startedAt: '2026-05-27T08:00:00.000Z',
        sourceDirection: {
            id: 'direction-seed-wall',
            path: '题材/探索发现/围墙',
            name: '围墙'
        },
        promptTotalRaw: 4,
        promptTotal: 4,
        prompts: [
            {
                direction: '冰墙观察塔',
                promptTitle: '观察塔冷启动',
                prompt: '主题：冰墙观察塔，画面内容：幸存者在高耸冰墙观察塔上发现远处火光。'
            },
            {
                direction: '破冰补给门',
                promptTitle: '补给门打开',
                prompt: '主题：破冰补给门，画面内容：小队撬开结冰补给门，背后露出暖光。'
            },
            {
                direction: '暴雪警戒线',
                promptTitle: '警戒线信号',
                prompt: '主题：暴雪警戒线，画面内容：防线红色信号灯穿透暴雪。'
            },
            {
                direction: '火光避难廊',
                promptTitle: '避难廊收容',
                prompt: '主题：火光避难廊，画面内容：围墙内部的暖色避难走廊收容幸存者。'
            }
        ]
    });

    return { dataDir, runId };
}

function logPass(message) {
    console.log(`[S4] OK - ${message}`);
}

function main() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'creative-knowledge-s4-'));
    try {
        const { dataDir, runId } = seed(root);
        const service = createCreativeKnowledgeService({
            rootDir: root,
            logger: { info() {}, error() {} }
        });

        const extracted = service.extractDirectionDraftsFromRun(runId);
        assert.strictEqual(extracted.success, true);
        assert.strictEqual(extracted.createdCount, 4);
        assert.strictEqual(extracted.drafts.length, 4);
        assert.ok(extracted.drafts.every(draft => draft.status === 'draft'));
        logPass('run prompts can be extracted into direction-drafts.json');

        const drafts = service.listDirectionDrafts({ status: 'draft', limit: 10 });
        assert.strictEqual(drafts.success, true);
        assert.strictEqual(drafts.total, 4);
        assert.strictEqual(drafts.counts.draft, 4);

        const acceptedDraft = drafts.drafts.find(draft => draft.name === '冰墙观察塔');
        const accepted = service.acceptDirectionDraft(acceptedDraft.id, {
            allowSimilar: true,
            reason: '观察塔让围墙方向有更明确的广告叙事钩子。',
            modified: 'manual preference: keep the watchtower as a clear foreground decision point',
            rating: 5,
            priority: 100
        });
        assert.strictEqual(accepted.success, true);
        assert.strictEqual(accepted.direction.status, 'accepted');
        assert.strictEqual(accepted.direction.source, 'agent');
        assert.strictEqual(accepted.direction.sheetName, 'local-growth');
        assert.strictEqual(accepted.direction.autoRun, true);
        assert.strictEqual(accepted.draft.status, 'accepted');
        assert.strictEqual(accepted.feedback.feedbackTargetType, 'direction-candidate');
        assert.strictEqual(accepted.feedback.directionDraftId, acceptedDraft.id);
        assert.strictEqual(accepted.feedback.newDirectionName, acceptedDraft.name);
        assert.ok(accepted.feedback.prompt);
        assert.ok(accepted.feedback.modified.includes('watchtower'));
        assert.strictEqual(accepted.feedback.rating, 5);
        logPass('accepted drafts enter the local-growth direction layer');

        const rejectedDraft = drafts.drafts.find(draft => draft.name === '破冰补给门');
        const rejected = service.rejectDirectionDraft(rejectedDraft.id, {
            reason: '补给门和原围墙方向差异不足，先作为反例保留。'
        });
        assert.strictEqual(rejected.success, true);
        assert.strictEqual(rejected.draft.status, 'rejected');
        assert.ok(rejected.draft.rejectionReason.includes('反例'));
        assert.strictEqual(rejected.feedback.feedbackTargetType, 'direction-candidate');
        assert.strictEqual(rejected.feedback.directionDraftId, rejectedDraft.id);
        assert.ok(rejected.feedback.deleteReason);
        logPass('rejected drafts keep a reason for future negative examples');

        const archivedDraft = drafts.drafts.find(draft => draft.name === '暴雪警戒线');
        const archived = service.archiveDirectionDraft(archivedDraft.id, {
            reason: '概念可用但暂不进入下一轮。'
        });
        assert.strictEqual(archived.success, true);
        assert.strictEqual(archived.draft.status, 'archived');
        assert.ok(archived.draft.archiveReason.includes('暂不进入'));
        assert.strictEqual(archived.feedback.feedbackTargetType, 'direction-candidate');
        assert.strictEqual(archived.feedback.status, 'normal');
        assert.ok(archived.feedback.deleteReason);
        logPass('drafts can be archived without becoming runnable directions');

        const mergedDraft = drafts.drafts.find(draft => draft.name === '火光避难廊');
        const merged = service.mergeDirectionDraft(mergedDraft.id, {
            targetDirectionId: 'direction-seed-wall',
            reason: '作为围墙方向的素材表达补充，不单独开方向。'
        });
        assert.strictEqual(merged.success, true);
        assert.strictEqual(merged.draft.status, 'archived');
        assert.strictEqual(merged.draft.mergedIntoDirectionId, 'direction-seed-wall');
        assert.strictEqual(merged.feedback.feedbackTargetType, 'direction-candidate');
        assert.strictEqual(merged.feedback.directionDraftId, mergedDraft.id);
        logPass('drafts can be merged back into an existing direction');

        const allFeedback = service.listFeedback({ limit: 10 });
        assert.strictEqual(allFeedback.success, true);
        assert.strictEqual(allFeedback.total, 4);
        assert.strictEqual(allFeedback.feedback.every(entry => entry.feedbackTargetType === 'direction-candidate'), true);

        const modifiedFeedback = service.listFeedback({ q: 'watchtower' });
        assert.strictEqual(modifiedFeedback.success, true);
        assert.strictEqual(modifiedFeedback.total, 1);
        assert.strictEqual(modifiedFeedback.feedback[0].directionDraftId, acceptedDraft.id);
        logPass('direction draft decisions append searchable feedback records');

        const overview = service.getOverview();
        assert.strictEqual(overview.counts.acceptedDirections, 1);
        assert.strictEqual(overview.counts.pendingDirectionDrafts, 0);
        assert.strictEqual(overview.counts.rejectedDirectionDrafts, 1);
        logPass('overview exposes local-growth and draft decision counts');

        const directionData = JSON.parse(fs.readFileSync(path.join(dataDir, 'directions.json'), 'utf8'));
        const selected = selectNextDirection(directionData.directions, [], { limit: 5 });
        assert.strictEqual(selected.next.direction.id, accepted.direction.id);
        assert.strictEqual(selected.next.direction.status, 'accepted');
        logPass('accepted local-growth directions are visible to the next auto selector');

        const disabled = service.updateDirectionStatus(accepted.direction.id, {
            status: 'disabled',
            reason: '验收禁跑能力'
        });
        assert.strictEqual(disabled.success, true);
        assert.strictEqual(disabled.direction.autoRun, false);
        assert.strictEqual(disabled.direction.status, 'disabled');
        logPass('accepted directions can be disabled to prevent uncontrolled growth');

        const persistedDrafts = JSON.parse(fs.readFileSync(path.join(dataDir, 'direction-drafts.json'), 'utf8'));
        assert.strictEqual(persistedDrafts.drafts.length, 4);
        assert.deepStrictEqual(
            persistedDrafts.drafts.map(draft => draft.status).sort(),
            ['accepted', 'archived', 'archived', 'rejected']
        );
        logPass('direction-drafts.json persists all manual decisions');

        console.log('[S4] Creative knowledge local-growth contract is locked.');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

main();
