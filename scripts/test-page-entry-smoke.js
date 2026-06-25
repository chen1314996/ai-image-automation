const assert = require('assert');
const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require('playwright');

const ROOT_DIR = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT_DIR, 'data', 'p0-smoke');

const PAGES = [
    {
        key: 'run-center',
        label: '运行中心',
        tabSelector: '#runCenterPageTab',
        activeSelector: '#runCenterPage.page-view.active',
        requiredSelectors: ['#runCenterStageBadge', '#runCenterHealthSummary', '#runCenterP0Warnings']
    },
    {
        key: 'creative',
        label: '创意拓展',
        tabSelector: '#creativePageTab',
        activeSelector: '#creativePage.page-view.active',
        requiredSelectors: ['#creativeStageBadge', '#creativeLoopEntryPanel', '#creativeEntryQueueTag']
    },
    {
        key: 'knowledge',
        label: '知识库',
        tabSelector: '#knowledgePageTab',
        activeSelector: '#knowledgePage.page-view.active',
        requiredSelectors: ['#knowledgeLoopEntryPanel', '#knowledgeEntryDirectionTag', '#knowledgeEntryDnaTag']
    }
];

const VIEWPORTS = [
    { key: 'desktop', width: 1366, height: 900 },
    { key: 'mobile', width: 390, height: 844 }
];

function logPass(message) {
    console.log(`[P0-page] OK - ${message}`);
}

function getFreePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const port = server.address().port;
            server.close(() => resolve(port));
        });
    });
}

async function waitForServer(baseUrl, timeoutMs = 20000) {
    const startedAt = Date.now();
    let lastError = null;
    while (Date.now() - startedAt < timeoutMs) {
        try {
            const response = await fetch(baseUrl);
            if (response.ok) return;
            lastError = new Error(`HTTP ${response.status}`);
        } catch (error) {
            lastError = error;
        }
        await new Promise(resolve => setTimeout(resolve, 350));
    }
    throw lastError || new Error('server did not start');
}

async function startServer() {
    const port = await getFreePort();
    const child = spawn(process.execPath, ['server.js'], {
        cwd: ROOT_DIR,
        env: {
            ...process.env,
            PORT: String(port),
            SKIP_RUNTIME_SERVICES: '1',
            FEISHU_NOTIFY_COOLDOWN_MS: '0'
        },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk.toString(); });
    child.stderr.on('data', chunk => { output += chunk.toString(); });
    const baseUrl = `http://127.0.0.1:${port}`;
    try {
        await waitForServer(baseUrl);
    } catch (error) {
        child.kill();
        throw new Error(`server failed to start: ${error.message}\n${output.slice(-2000)}`);
    }
    return { child, baseUrl };
}

async function stopServer(child) {
    if (!child || child.killed) return;
    child.kill();
    await new Promise(resolve => {
        const timer = setTimeout(resolve, 2000);
        child.once('exit', () => {
            clearTimeout(timer);
            resolve();
        });
    });
}

async function checkPage(browser, baseUrl, pageSpec, viewport) {
    const page = await browser.newPage({
        viewport: {
            width: viewport.width,
            height: viewport.height
        }
    });
    const errors = [];
    try {
        page.on('console', message => {
            if (message.type() !== 'error') return;
            const text = message.text();
            if (text.includes('Failed to load resource:')) return;
            errors.push(text);
        });
        page.on('pageerror', error => {
            errors.push(error.message);
        });

        const response = await page.goto(baseUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 20000
        });
        assert.ok(response && response.ok(), `${pageSpec.label} initial load failed`);
        await page.locator(pageSpec.tabSelector).click();
        await page.waitForSelector(pageSpec.activeSelector, { state: 'visible', timeout: 10000 });
        await page.waitForTimeout(1200);

        for (const selector of pageSpec.requiredSelectors) {
            await page.waitForSelector(selector, { state: 'visible', timeout: 5000 });
            const text = await page.locator(selector).first().innerText();
            assert.ok(String(text || '').trim().length > 0, `${pageSpec.label} ${selector} is empty`);
        }

        const metrics = await page.evaluate(() => ({
            scrollWidth: document.documentElement.scrollWidth,
            clientWidth: document.documentElement.clientWidth,
            bodyScrollWidth: document.body.scrollWidth,
            activePageId: document.querySelector('.page-view.active')?.id || ''
        }));
        assert.ok(
            metrics.scrollWidth <= metrics.clientWidth + 2,
            `${pageSpec.label} ${viewport.key} horizontal overflow: ${metrics.scrollWidth} > ${metrics.clientWidth}`
        );
        assert.deepStrictEqual(errors, [], `${pageSpec.label} ${viewport.key} console errors: ${errors.join('; ')}`);

        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
        const filePath = path.join(OUTPUT_DIR, `p0-${pageSpec.key}-${viewport.key}.png`);
        await page.screenshot({ path: filePath, fullPage: true });
        return filePath;
    } finally {
        await page.close();
    }
}

async function main() {
    const { child, baseUrl } = await startServer();
    const browser = await chromium.launch({ headless: true });
    try {
        for (const viewport of VIEWPORTS) {
            for (const pageSpec of PAGES) {
                const filePath = await checkPage(browser, baseUrl, pageSpec, viewport);
                logPass(`${pageSpec.label} ${viewport.key} passed, screenshot ${path.relative(ROOT_DIR, filePath)}`);
            }
        }
    } finally {
        await browser.close().catch(() => {});
        await stopServer(child);
    }
}

main().catch(error => {
    console.error('[P0-page] FAILED');
    console.error(error);
    process.exit(1);
});
