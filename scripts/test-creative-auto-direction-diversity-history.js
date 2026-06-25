const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { CreativeKnowledgeStore } = require('../src/services/creative-knowledge/store');
const { createCreativeAutoService } = require('../src/services/creative-auto');
const {
    cleanupFixture,
    makeTempCreativeFixture,
    writeBaseKnowledge
} = require('./creative-auto-test-utils');

function runDirectionDiversityHistoryTest() {
    const fixture = makeTempCreativeFixture('creative-diversity-history-');
    writeBaseKnowledge(fixture);

    const store = new CreativeKnowledgeStore(fixture.dataDir);
    store.ensureBase();
    const service = createCreativeAutoService({
        rootDir: fixture.root,
        logger: { info() {}, warn() {}, error() {} }
    });
    const selected = {
        direction: {
            id: 'direction-1',
            path: 'Topic/Source/Direction One',
            name: 'Direction One'
        }
    };
    const payload = {
        directionPlanning: {
            diversityMode: 'explore',
            historyScope: 'all',
            candidateMultiplier: 3,
            runSeed: 'unit-seed'
        }
    };
    const config = {
        directionPlanning: {}
    };

    try {
        const initialContext = service.__test.buildDirectionDiversityContext({
            store,
            selectedDirection: selected.direction,
            payload,
            config,
            runId: 'run-a'
        });
        assert.strictEqual(initialContext.mode, 'explore');
        assert.strictEqual(initialContext.candidateMultiplier, 3);
        assert.strictEqual(initialContext.axes.length, 4);
        assert.strictEqual(initialContext.history.length, 0);

        const additions = service.__test.appendDirectionExpansionHistory(store, {
            run: { runId: 'run-a' },
            selected,
            directionPlanGate: {
                selectedExtensions: [{
                    sourceDirectionId: 'direction-1',
                    sourceDirectionPath: 'Topic/Source/Direction One',
                    name: 'Signal Flare Rescue Handoff',
                    visualHook: 'foreground flare and rescue crate',
                    dedupeReason: 'changes from static prop display to rescue handoff',
                    description: 'survivors pass a glowing rescue crate through a frozen street',
                    productionAdvice: 'keep the flare readable',
                    score: 92
                }]
            },
            diversityContext: initialContext
        });
        assert.strictEqual(additions.length, 1);

        const historyPath = path.join(fixture.dataDir, 'direction-expansion-history.json');
        const history = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
        assert.strictEqual(history.items.length, 1);
        assert.strictEqual(history.items[0].newDirectionName, 'Signal Flare Rescue Handoff');

        const nextContext = service.__test.buildDirectionDiversityContext({
            store,
            selectedDirection: selected.direction,
            payload,
            config,
            runId: 'run-b'
        });
        assert.strictEqual(nextContext.history.length, 1);
        assert.strictEqual(nextContext.history[0].newDirectionName, 'Signal Flare Rescue Handoff');

        const duplicateAdditions = service.__test.appendDirectionExpansionHistory(store, {
            run: { runId: 'run-b' },
            selected,
            directionPlanGate: {
                selectedExtensions: [{
                    sourceDirectionId: 'direction-1',
                    sourceDirectionPath: 'Topic/Source/Direction One',
                    name: 'Signal Flare Rescue Handoff',
                    visualHook: 'foreground flare and rescue crate',
                    dedupeReason: 'changes from static prop display to rescue handoff'
                }]
            },
            diversityContext: nextContext
        });
        assert.strictEqual(duplicateAdditions.length, 0);
        const unchangedHistory = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
        assert.strictEqual(unchangedHistory.items.length, 1);
    } finally {
        cleanupFixture(fixture);
    }
}

runDirectionDiversityHistoryTest();
console.log('creative auto direction diversity history tests passed');
