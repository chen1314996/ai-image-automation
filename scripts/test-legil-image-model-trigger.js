const assert = require('assert');
const { chromium } = require('playwright');
const legilAutomation = require('../legil-automation');

async function withPage(browser, html, fn) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.setContent(html);
    try {
        await fn(page);
    } finally {
        await page.close();
    }
}

async function getHandleText(handle) {
    return handle.evaluate(el => String(el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim());
}

(async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        await withPage(browser, `
            <main style="padding:220px 0 0 32px">
                <section style="width:480px">
                    <div>Image Model</div>
                    <button id="model-trigger" aria-haspopup="listbox" style="width:420px;height:44px">Seedream 4.5</button>
                </section>
            </main>
        `, async (page) => {
            const detected = await legilAutomation.detectCurrentImageModel(page);
            assert.strictEqual(detected, 'Seedream 4.5', 'should detect a shifted image model trigger');

            const trigger = await legilAutomation.findImageModelTrigger(page);
            assert.ok(trigger, 'should find a shifted image model trigger');
            assert.strictEqual(await getHandleText(trigger), 'Seedream 4.5');
        });

        await withPage(browser, `
            <main style="padding:96px 0 0 36px">
                <section style="width:520px">
                    <label>\u56fe\u751f\u56fe\u6a21\u578b</label>
                    <button id="model-trigger" aria-haspopup="listbox" style="width:420px;height:44px">Choose model</button>
                </section>
            </main>
        `, async (page) => {
            const trigger = await legilAutomation.findImageModelTrigger(page);
            assert.ok(trigger, 'should find trigger by nearby image-model label');
            assert.strictEqual(await getHandleText(trigger), 'Choose model');
        });

        await withPage(browser, `
            <main style="padding:150px 0 0 32px">
                <button id="model-trigger" aria-haspopup="listbox" style="width:360px;height:44px">GPT-Image-1</button>
                <div role="listbox" style="position:absolute;left:620px;top:90px;width:280px">
                    <div role="option" id="target-option" onclick="document.body.dataset.clicked='gpt2'" style="height:40px">GPT Image 2</div>
                </div>
            </main>
        `, async (page) => {
            const clicked = await legilAutomation.clickImageModelOption(page, 'GPT-Image-2', 190, {});
            assert.strictEqual(clicked, true, 'should click a normalized model option in a displaced popup');
            assert.strictEqual(await page.evaluate(() => document.body.dataset.clicked), 'gpt2');
        });
    } finally {
        await browser.close();
    }

    console.log('PASS Legil image model trigger detection');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
