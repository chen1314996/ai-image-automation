const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const {
    rowsFromValues,
    buildImportPreview,
    buildRowValues,
    findInsertAfterRow,
    createFeishuDirectionSyncService
} = require('../src/services/creative-knowledge/feishu-direction-sync');
const { CreativeKnowledgeStore } = require('../src/services/creative-knowledge/store');

function makeTempRoot() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'feishu-direction-sync-'));
}

function createMockHttpClient(calls) {
    return {
        post: async (url, body) => {
            calls.push({ method: 'POST', url, body });
            if (url.includes('/tenant_access_token/')) {
                return {
                    data: {
                        code: 0,
                        tenant_access_token: 'tenant_token'
                    }
                };
            }
            if (url.includes('/insert_dimension_range')) {
                return { data: { code: 0, data: {} } };
            }
            throw new Error(`unexpected POST ${url}`);
        },
        get: async url => {
            calls.push({ method: 'GET', url });
            if (url.includes('/values/')) {
                return {
                    data: {
                        code: 0,
                        data: {
                            valueRange: {
                                values: [
                                    ['一级标签', '二级标签', '三级标签', '细分标签', '方向简述', '参考图1', '参考图2', '参考图3'],
                                    ['题材', '探索发现', '建筑', '冰封建筑', '旧描述', '', '', ''],
                                    ['题材', '探索发现', '建筑', '桥梁', '桥梁方向', '', '', '']
                                ]
                            }
                        }
                    }
                };
            }
            throw new Error(`unexpected GET ${url}`);
        },
        put: async (url, body) => {
            calls.push({ method: 'PUT', url, body });
            if (url.includes('/values') || url.includes('/style')) {
                return { data: { code: 0, data: {} } };
            }
            throw new Error(`unexpected PUT ${url}`);
        }
    };
}

async function run() {
    const values = [
        ['一级标签', '二级标签', '三级标签', '细分标签', '方向简述', '参考图1', '参考图2', '参考图3'],
        ['题材', '探索发现', '建筑', '冰封建筑', '画面主体为冰封建筑', '', '', ''],
        ['题材', '探索发现', '攀爬', '暂无', '攀爬场景', '', '', '']
    ];
    const parsed = rowsFromValues(values, { spreadsheetToken: 'sht', sheetId: 'UUld6D' });
    assert.deepStrictEqual(parsed.warnings, []);
    assert.strictEqual(parsed.directions.length, 2);
    assert.strictEqual(parsed.directions[0].path, '题材/探索发现/建筑/冰封建筑');
    assert.strictEqual(parsed.directions[1].path, '题材/探索发现/攀爬');
    assert.strictEqual(parsed.directions[1].subTag, '');

    const preview = buildImportPreview([{
        id: 'direction_existing',
        path: '题材/探索发现/建筑/冰封建筑',
        name: '冰封建筑',
        primaryTag: '题材',
        secondaryTag: '探索发现',
        tertiaryTag: '建筑',
        subTag: '冰封建筑',
        description: '旧描述'
    }], parsed.directions);
    assert.strictEqual(preview.added, 1);
    assert.strictEqual(preview.updated, 1);

    const rowValues = buildRowValues({
        path: '题材/探索发现/建筑/地下堡垒',
        primaryTag: '题材',
        secondaryTag: '探索发现',
        tertiaryTag: '建筑',
        subTag: '地下堡垒',
        description: '地下堡垒方向'
    });
    assert.deepStrictEqual(rowValues, ['题材', '探索发现', '建筑', '地下堡垒', '地下堡垒方向', '', '', '']);
    assert.strictEqual(findInsertAfterRow(parsed.directions, rowValues), 2);

    const rootDir = makeTempRoot();
    const dataDir = path.join(rootDir, 'data', 'creative-knowledge');
    const store = new CreativeKnowledgeStore(dataDir);
    store.ensureBase();
    store.write('directions.json', {
        version: 1,
        directions: [{
            id: 'direction_new_accepted',
            path: '题材/探索发现/建筑/地下堡垒',
            name: '地下堡垒',
            primaryTag: '题材',
            secondaryTag: '探索发现',
            tertiaryTag: '建筑',
            subTag: '地下堡垒',
            description: '地下堡垒方向',
            status: 'accepted',
            source: 'manual_from_reviewed_asset'
        }]
    });

    const calls = [];
    const service = createFeishuDirectionSyncService({
        rootDir,
        dataDir,
        httpClient: createMockHttpClient(calls)
    });
    const result = await service.syncWriteback({
        enabled: true,
        appId: 'cli_test',
        appSecret: 'secret_test',
        spreadsheetToken: 'spreadsheet_token',
        sheetId: 'UUld6D',
        range: 'A1:H20'
    });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.syncedCount, 1);
    assert.ok(calls.some(call => call.url.includes('/insert_dimension_range') && call.body.dimension.startIndex === 3));
    assert.ok(calls.some(call => call.method === 'PUT' && call.url.includes('/values') && call.body.valueRange.range === 'UUld6D!A4:H4'));
    assert.ok(calls.some(call => call.method === 'PUT' && call.url.includes('/style') && call.body.appendStyle.range === 'UUld6D!A4:H4'));

    const writeback = store.read('feishu-writeback.json', { records: [] });
    assert.strictEqual(writeback.records.length, 1);
    assert.strictEqual(writeback.records[0].directionId, 'direction_new_accepted');

    fs.rmSync(rootDir, { recursive: true, force: true });
}

run()
    .then(() => {
        console.log('Feishu direction sync tests passed');
    })
    .catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
