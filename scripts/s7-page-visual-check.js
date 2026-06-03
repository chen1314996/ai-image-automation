const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT_DIR = path.resolve(__dirname, '..');
const BASE_URL = process.env.S7_BASE_URL || 'http://localhost:3066';
const OUTPUT_DIR = path.join(ROOT_DIR, 'data');

const PAGE_CHECKS = [
    {
        key: 'knowledge',
        label: '知识库',
        tabSelector: '#knowledgePageTab',
        activeSelector: '#knowledgePage.page-view.active'
    },
    {
        key: 'creative',
        label: '创意拓展',
        tabSelector: '#creativePageTab',
        activeSelector: '#creativePage.page-view.active'
    },
    {
        key: 'material',
        label: '素材分析',
        tabSelector: '#materialAnalysisPageTab',
        activeSelector: '#materialAnalysisPage.page-view.active'
    }
];

const VIEWPORTS = [
    { key: 'desktop', width: 1280, height: 900 },
    { key: 'mobile', width: 390, height: 844 }
];

function logPass(message) {
    console.log(`[S7-page] OK - ${message}`);
}

async function waitForServer(page) {
    const response = await page.goto(BASE_URL, {
        waitUntil: 'domcontentloaded',
        timeout: 15000
    });
    assert.ok(response && response.ok(), `local server returned ${response && response.status()}`);
}

async function captureOne(page, pageCheck, viewport) {
    const errors = [];
    const resourceWarnings = [];
    page.on('console', message => {
        if (message.type() === 'error') {
            const text = message.text();
            if (text.includes('Failed to load resource:')) {
                resourceWarnings.push(text);
            } else {
                errors.push(text);
            }
        }
    });
    page.on('pageerror', error => {
        errors.push(error.message);
    });

    await waitForServer(page);
    await page.locator(pageCheck.tabSelector).click();
    await page.waitForSelector(pageCheck.activeSelector, { state: 'visible', timeout: 10000 });
    await page.waitForTimeout(1000);

    const metrics = await page.evaluate(() => ({
        activePageId: document.querySelector('.page-view.active')?.id || '',
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        bodyWidth: document.body.scrollWidth,
        viewportWidth: window.innerWidth
    }));
    const horizontalOverflow = metrics.scrollWidth > metrics.clientWidth + 2;

    if (viewport.key === 'mobile') {
        assert.strictEqual(
            horizontalOverflow,
            false,
            `${pageCheck.label} mobile view has horizontal overflow: ${metrics.scrollWidth} > ${metrics.clientWidth}`
        );
    }

    assert.deepStrictEqual(errors, [], `${pageCheck.label} ${viewport.key} console errors: ${errors.join('; ')}`);

    const fileName = `acceptance-s7-${pageCheck.key}-${viewport.key}.png`;
    const filePath = path.join(OUTPUT_DIR, fileName);
    await page.screenshot({
        path: filePath,
        fullPage: true
    });

    return {
        page: pageCheck.label,
        viewport: viewport.key,
        filePath,
        metrics,
        resourceWarnings
    };
}

async function run() {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    const browser = await chromium.launch({ headless: true });
    const results = [];
    try {
        for (const viewport of VIEWPORTS) {
            for (const pageCheck of PAGE_CHECKS) {
                const page = await browser.newPage({
                    viewport: {
                        width: viewport.width,
                        height: viewport.height
                    }
                });
                try {
                    const result = await captureOne(page, pageCheck, viewport);
                    results.push(result);
                    logPass(`${pageCheck.label} ${viewport.key} screenshot saved to ${path.relative(ROOT_DIR, result.filePath)}`);
                } finally {
                    await page.close();
                }
            }
        }
    } finally {
        await browser.close();
    }

    console.log(JSON.stringify({
        success: true,
        baseUrl: BASE_URL,
        screenshots: results
    }, null, 2));
}

run().catch(error => {
    console.error(error);
    process.exit(1);
});
