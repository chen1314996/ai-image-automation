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

function seed(root) {
    const dataDir = path.join(root, 'data', 'creative-knowledge');
    const uploadDir = path.join(root, 'uploads');
    const direction = {
        id: 'direction-ref-pool',
        path: 'Subject/Discovery/Reference Pool',
        name: 'Reference Pool',
        description: 'Direction with a managed active reference pool.',
        primaryTag: 'Subject',
        secondaryTag: 'Discovery',
        tertiaryTag: 'Pool',
        autoRun: true,
        status: 'seed'
    };

    writeJson(path.join(dataDir, 'metadata.json'), {
        version: 1,
        importedAt: '2026-06-10T00:00:00.000Z',
        counts: { directions: 1, topMaterials: 0, topMaterialInsights: 0, referenceImages: 0 },
        warnings: []
    });
    writeJson(path.join(dataDir, 'directions.json'), {
        version: 1,
        importedAt: '2026-06-10T00:00:00.000Z',
        directions: [direction]
    });

    const files = [1, 2, 3, 4, 5].map(index => {
        const filePath = path.join(uploadDir, `ref-${index}.png`);
        writeTinyPng(filePath);
        return filePath;
    });

    return { direction, files };
}

function main() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reference-pool-'));
    try {
        const { direction, files } = seed(root);
        const service = createCreativeKnowledgeService({
            rootDir: root,
            logger: { info() {}, warn() {}, error() {} }
        });

        const uploaded = [1, 2, 3].map((slot, index) => service.uploadDirectionReference(direction.id, {
            slot,
            visualNotes: `notes-${slot}`
        }, {
            filePath: files[index],
            originalName: `upload-${slot}.png`
        }));
        uploaded.forEach(result => assert.strictEqual(result.success, true));

        let pool = service.listDirectionReferences(direction.id);
        assert.strictEqual(pool.success, true);
        assert.strictEqual(pool.activeReferences.length, 3, 'active should be exactly 3 after three uploads');
        assert.deepStrictEqual(pool.activeReferences.map(item => item.slot), [1, 2, 3]);

        const overflow = service.uploadDirectionReference(direction.id, {
            visualNotes: 'overflow'
        }, {
            filePath: files[3],
            originalName: 'overflow.png'
        });
        assert.strictEqual(overflow.success, false, 'backend must reject a fourth active reference');
        pool = service.listDirectionReferences(direction.id);
        assert.strictEqual(pool.activeReferences.length, 3, 'active must never exceed 3');

        const oldSlot2 = pool.activeReferences.find(item => item.slot === 2);
        const replaced = service.replaceReference(oldSlot2.id, {
            visualNotes: 'new-slot-2'
        }, {
            filePath: files[3],
            originalName: 'replace-slot-2.png'
        });
        assert.strictEqual(replaced.success, true);
        assert.strictEqual(replaced.oldReference.status, 'archived', 'old reference should be archived after replace');
        assert.strictEqual(replaced.reference.slot, 2, 'new reference should inherit old slot');

        pool = service.listDirectionReferences(direction.id);
        assert.strictEqual(pool.activeReferences.length, 3);
        assert.ok(pool.references.some(item => item.id === oldSlot2.id && item.status === 'archived'));
        assert.ok(pool.activeReferences.some(item => item.id === replaced.reference.id && item.slot === 2));

        let promptRefs = service.getDirectionPromptReferences(direction.id);
        assert.deepStrictEqual(promptRefs.map(item => item.slot), [1, 2, 3], 'Prompt references should be active and slot sorted');
        assert.ok(!promptRefs.some(item => item.id === oldSlot2.id), 'Prompt references should not read archived old image');

        const archived = service.archiveReference(replaced.reference.id, { reason: 'not needed for prompt' });
        assert.strictEqual(archived.success, true);
        promptRefs = service.getDirectionPromptReferences(direction.id);
        assert.strictEqual(promptRefs.length, 2, 'archived image should leave Prompt context');
        assert.ok(!promptRefs.some(item => item.id === replaced.reference.id));

        const slot3 = promptRefs.find(item => item.slot === 3);
        const deletePreview = service.deleteReference(slot3.id, {});
        assert.strictEqual(deletePreview.success, false);
        assert.strictEqual(deletePreview.needsConfirmation, true, 'delete should require second confirmation');
        const deleted = service.deleteReference(slot3.id, { confirm: true, reason: 'hard cleanup test' });
        assert.strictEqual(deleted.success, true);
        assert.strictEqual(deleted.reference.status, 'deleted');
        assert.ok(deleted.reference.deleted && deleted.reference.deleted.deletedAt, 'deleted metadata should be retained');
        assert.strictEqual(service.getReferenceFile(slot3.id), null, 'deleted reference should not serve image file');

        pool = service.listDirectionReferences(direction.id);
        assert.ok(pool.references.some(item => item.id === slot3.id && item.status === 'deleted' && item.deleted));
        assert.ok(pool.referenceChangeEvents.length >= 6, 'referenceChangeEvents should record changes');
        assert.ok(pool.referenceChangeEvents.some(event => event.type === 'replaced'));
        assert.ok(pool.referenceChangeEvents.some(event => event.type === 'deleted'));

        console.log('reference pool tests passed');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

main();
