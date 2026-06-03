const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const crypto = require('crypto');
const axios = require('axios');

const { createFeishuSyncService } = require('../src/services/creative-knowledge/feishu-sync');
const { CreativeKnowledgeStore } = require('../src/services/creative-knowledge/store');

function makeTempRoot() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'feishu-sync-test-'));
}

function expectedDirectionId() {
    const hash = crypto
        .createHash('sha1')
        .update(['spreadsheet_token', 'sheet_dir', '2', '题材/自然危机/坠落危机', '坠落危机'].join('|'))
        .digest('hex')
        .slice(0, 12);
    return `direction_feishu_${hash}`;
}

function buildTestConfig(dataDir) {
    return {
        dataDir,
        enabled: true,
        appId: 'cli_test',
        appSecret: 'secret_test',
        sources: {
            directions: {
                enabled: true,
                type: 'sheet',
                token: 'spreadsheet_token',
                sheetId: 'sheet_dir',
                range: 'A1:ZZ20',
                fieldMap: {
                    path: '方向路径',
                    name: '方向名称',
                    description: '方向描述',
                    status: '状态',
                    priority: '优先级'
                }
            },
            topMaterials: {
                enabled: true,
                type: 'sheet',
                token: 'spreadsheet_token',
                sheetId: 'sheet_top',
                range: 'A1:ZZ20',
                fieldMap: {
                    projectName: '项目',
                    weekId: '周次',
                    materialName: '素材名称',
                    contentUrl: '素材链接',
                    spend: '花费',
                    ctr: 'CTR'
                }
            },
            referenceImages: {
                enabled: true,
                type: 'sheet',
                token: 'spreadsheet_token',
                sheetId: 'sheet_ref',
                range: 'A1:ZZ20',
                fieldMap: {
                    directionPath: '方向路径',
                    imageUrl: '图片URL',
                    fileName: '文件名'
                }
            }
        }
    };
}

function seedExistingKnowledge(store) {
    store.write('directions.json', {
        version: 1,
        importedAt: '2026-05-28T00:00:00.000Z',
        directions: [{
            id: expectedDirectionId(),
            path: '题材/自然危机/坠落危机',
            name: '坠落危机',
            description: '旧描述',
            status: 'disabled',
            autoRun: false,
            source: 'feishu-readonly'
        }, {
            id: 'direction_local_accepted',
            path: '玩法/本地成长/保留项',
            name: '保留项',
            description: '人工采纳方向',
            status: 'accepted',
            source: 'agent'
        }]
    });
    store.write('top-materials.json', {
        version: 1,
        materials: []
    });
    store.write('reference-images.json', {
        version: 1,
        images: []
    });
}

function installAxiosMock() {
    const originalCreate = axios.create;
    axios.create = () => ({
        post: async () => ({
            data: {
                code: 0,
                tenant_access_token: 'tenant_token'
            }
        }),
        get: async url => {
            if (url.includes('sheet_dir')) {
                return {
                    data: {
                        code: 0,
                        data: {
                            valueRange: {
                                values: [
                                    ['方向路径', '方向名称', '方向描述', '状态', '优先级'],
                                    ['题材/自然危机/坠落危机', '坠落危机', '高处坠落瞬间，主体和危险关系一眼可读', 'seed', '88'],
                                    ['玩法/救援/绳索营救', '绳索营救', '救援动作明确', 'accepted', '60']
                                ]
                            }
                        }
                    }
                };
            }
            if (url.includes('sheet_top')) {
                return {
                    data: {
                        code: 0,
                        data: {
                            valueRange: {
                                values: [
                                    ['项目', '周次', '素材名称', '素材链接', '花费', 'CTR'],
                                    ['无尽冬日', '2026-W22', '素材_题材_自然危机_坠落危机_800x800', 'https://example.com/material-a.png', '1,200', '3.5%']
                                ]
                            }
                        }
                    }
                };
            }
            if (url.includes('sheet_ref')) {
                return {
                    data: {
                        code: 0,
                        data: {
                            valueRange: {
                                values: [
                                    ['方向路径', '图片URL', '文件名'],
                                    ['题材/自然危机/坠落危机', 'https://example.com/ref-a.png', 'ref-a.png']
                                ]
                            }
                        }
                    }
                };
            }
            throw new Error(`unexpected url: ${url}`);
        }
    });
    return () => {
        axios.create = originalCreate;
    };
}

async function run() {
    const rootDir = makeTempRoot();
    const dataDir = path.join(rootDir, 'data', 'creative-knowledge');
    const store = new CreativeKnowledgeStore(dataDir);
    store.ensureBase();
    seedExistingKnowledge(store);

    const service = createFeishuSyncService({ rootDir, dataDir });
    const config = buildTestConfig(dataDir);
    const restoreAxios = installAxiosMock();

    try {
        const preview = await service.preview(config);
        assert.strictEqual(preview.success, true);
        assert.strictEqual(preview.preview.directions.added, 1);
        assert.strictEqual(preview.preview.directions.updated, 1);
        assert.strictEqual(preview.preview.directions.ignored, 1);

        const result = await service.sync(config);
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.counts.directions, 2);
        assert.strictEqual(result.counts.topMaterials, 1);
        assert.strictEqual(result.counts.referenceImages, 1);

        const directions = store.read('directions.json', { directions: [] }).directions;
        const preserved = directions.find(item => item.id === expectedDirectionId());
        assert.strictEqual(preserved.status, 'disabled');
        assert.strictEqual(preserved.autoRun, false);
        assert.strictEqual(preserved.localStatusPreserved, true);
        assert.ok(directions.some(item => item.id === 'direction_local_accepted'));

        const references = store.read('reference-images.json', { images: [] }).images;
        assert.strictEqual(references[0].remoteUrl, 'https://example.com/ref-a.png');
        assert.ok(references[0].matchedDirectionIds.includes(expectedDirectionId()));

        const cache = store.read('feishu-cache.json', null);
        assert.ok(cache);
        assert.strictEqual(cache.preview.counts.topMaterials, 1);

        const operations = store.read('knowledge-operations.json', { operations: [] }).operations;
        assert.ok(operations.length >= 2);
        assert.strictEqual(operations[0].type, 'feishu-sync');

        store.write('top-materials.json', {
            version: 1,
            materials: [{ id: 'local_material_keep', name: '本地素材保留' }]
        });
        store.write('reference-images.json', {
            version: 1,
            images: [{ id: 'local_ref_keep', filePath: 'D:\\keep.png', source: 'local-folder' }]
        });
        const directionOnlyConfig = buildTestConfig(dataDir);
        directionOnlyConfig.sources.topMaterials.enabled = false;
        directionOnlyConfig.sources.referenceImages.enabled = false;
        const directionOnly = await service.sync(directionOnlyConfig);
        assert.strictEqual(directionOnly.success, true);
        assert.strictEqual(store.read('top-materials.json', { materials: [] }).materials[0].id, 'local_material_keep');
        assert.strictEqual(store.read('reference-images.json', { images: [] }).images[0].id, 'local_ref_keep');
    } finally {
        restoreAxios();
        fs.rmSync(rootDir, { recursive: true, force: true });
    }
}

run()
    .then(() => {
        console.log('Feishu readonly sync tests passed');
    })
    .catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
