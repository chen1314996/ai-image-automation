const assert = require('assert');
const { importDirections } = require('../src/services/creative-knowledge/direction-importer');

const workbookPath = 'C:/Users/dd/Desktop/项目/sucai/创意方向种子表.xlsx';
const result = importDirections({ workbookPath });

assert.ok(result.directions.length > 5, 'expected seed workbook directions');
assert.strictEqual(result.directions[0].path, '题材/探索发现/末世文字/末世标语');
assert.strictEqual(result.directions[1].path, '题材/探索发现/攀爬');
assert.strictEqual(result.directions[2].path, '题材/探索发现/指示牌/路标');
assert.strictEqual(result.directions[0].rowNumber, 2);
assert.strictEqual(result.directions[0].orderIndex, 1);
assert.strictEqual(result.directions[1].orderIndex, 2);

console.log('creative knowledge seed workbook order test passed');
