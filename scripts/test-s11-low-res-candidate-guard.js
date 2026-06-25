const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createCanvas } = require('canvas');

const legilAutomation = require('../src/services/legil');

function writeImage(filePath, width, height) {
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#234b7a';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#ffffff';
    ctx.font = `${Math.max(10, Math.floor(width / 10))}px sans-serif`;
    ctx.fillText(`${width}x${height}`, 8, Math.max(20, Math.floor(height / 2)));
    fs.writeFileSync(filePath, canvas.toBuffer('image/png'));
}

async function main() {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 's11-low-res-guard-'));
    const lowResPath = path.join(tempDir, 'low-res.png');
    const okPath = path.join(tempDir, 'ok.png');

    writeImage(lowResPath, 256, 256);
    writeImage(okPath, 800, 800);

    assert.throws(
        () => legilAutomation.validateSavedImageFile(lowResPath, { promptTitleName: '800x800' }),
        /分辨率过低/,
        'low resolution Legil candidate should be rejected'
    );
    assert.strictEqual(fs.existsSync(lowResPath), false, 'rejected low-res candidate should be deleted');

    const okSize = legilAutomation.validateSavedImageFile(okPath, { promptTitleName: '800x800' });
    assert.ok(okSize > 1000, 'valid target-sized candidate should pass');
    assert.strictEqual(fs.existsSync(okPath), true, 'valid candidate should be kept');

    fs.rmSync(tempDir, { recursive: true, force: true });
    console.log('S11 low-res candidate guard passed');
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
