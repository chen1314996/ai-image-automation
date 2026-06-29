const assert = require('assert');
const { chromium } = require('playwright');
const legilAutomation = require('../legil-automation');

function outputUrl(id) {
    return `https://legil-diandian-lumos.oss-cn-beijing.aliyuncs.com/output/mock/${id}.png`;
}

function renderSlot(slot, index) {
    const left = 520 + (index * 245);
    if (slot === 'image') {
        return `
            <div class="slot" style="left:${left}px">
                <img src="${outputUrl(index)}" style="width:220px;height:220px;object-fit:cover" />
            </div>
        `;
    }

    return `
        <div class="slot" style="left:${left}px">
            <div class="failed-text">图片已被一只猫咬坏</div>
        </div>
    `;
}

function renderPage(slots) {
    return `
        <style>
            body { margin: 0; width: 1600px; height: 900px; font-family: sans-serif; }
            button { position: absolute; left: 260px; top: 760px; width: 160px; height: 44px; }
            .row { position: absolute; left: 500px; top: 120px; width: 1060px; height: 260px; }
            .slot {
                position: absolute;
                top: 0;
                width: 232px;
                height: 232px;
                background: #f2f2f2;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            .failed-text { width: 180px; height: 40px; color: #777; text-align: center; }
        </style>
        <button>创建图片</button>
        <section class="row">
            ${slots.map(renderSlot).join('')}
        </section>
    `;
}

async function waitForOutcome(page, expectedOutputCount = 4) {
    const outcome = await legilAutomation.waitForGenerationComplete(page, [], {
        expectedOutputCount,
        maxWaitTime: 1000,
        checkIntervalMs: 20
    });
    assert(outcome && outcome.completed, 'generation should complete in mock page');
    return outcome;
}

(async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

        await page.setContent(renderPage(['image', 'image', 'image', 'image']));
        let outcome = await waitForOutcome(page);
        assert.strictEqual(outcome.validCount, 4);
        assert.strictEqual(outcome.failedSlotCount, 0);
        assert.strictEqual(outcome.allFailed, false);
        assert.strictEqual(outcome.partial, false);

        await page.setContent(renderPage(['image', 'image', 'failed', 'failed']));
        outcome = await waitForOutcome(page);
        assert.strictEqual(outcome.validCount, 2);
        assert.strictEqual(outcome.failedSlotCount, 2);
        assert.strictEqual(outcome.allFailed, false);
        assert.strictEqual(outcome.partial, true);
        assert(outcome.failureTexts.some(text => text.includes('猫咬坏')));

        await page.setContent(renderPage(['failed', 'failed', 'failed', 'failed']));
        outcome = await waitForOutcome(page);
        assert.strictEqual(outcome.validCount, 0);
        assert.strictEqual(outcome.failedSlotCount, 4);
        assert.strictEqual(outcome.allFailed, true);
        assert.strictEqual(outcome.partial, false);
        assert(outcome.failureTexts.some(text => text.includes('猫咬坏')));

        await page.close();
    } finally {
        await browser.close();
    }

    console.log('PASS Legil placeholder outcome detection');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
