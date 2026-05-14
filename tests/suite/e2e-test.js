/**
 * 端到端测试
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:3066';
const results = [];

function logTest(name, passed, message = '') {
    const icon = passed ? '✅' : '❌';
    results.push({ name, passed, message });
    console.log(`${icon} ${name}${message ? ': ' + message : ''}`);
}

async function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

async function runTests() {
    console.log('='.repeat(60));
    console.log('🎮 端到端测试');
    console.log('='.repeat(60));

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await context.newPage();

    try {
        // 测试1: 页面加载
        await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
        await sleep(1000);
        const title = await page.title();
        logTest('页面加载', title.includes('AI生图'), title);

        // 测试2: 填写参考图文件夹
        await page.fill('#referenceFolder', 'D:\\工作\\自动化工作流1\\输入');
        const refValue = await page.inputValue('#referenceFolder');
        logTest('填写参考图文件夹', refValue === 'D:\\工作\\自动化工作流1\\输入');

        // 测试3: 点击确认按钮
        await page.click('button:has-text("确认")');
        await sleep(2000);
        const infoBox = await page.locator('#refCountInfo');
        const infoVisible = await infoBox.isVisible().catch(() => false);
        logTest('文件夹统计', infoVisible);

        // 测试4: 状态栏存在
        const statusBar = await page.locator('.status-bar');
        logTest('状态栏存在', await statusBar.isVisible());

        // 测试5: 工作流区域
        const workflow = await page.locator('.workflow-section');
        logTest('工作流区域存在', await workflow.isVisible());

        // 测试6: 一键启动按钮
        const startBtn = await page.locator('#oneClickStartBtn');
        logTest('一键启动按钮存在', await startBtn.isVisible());

        // 测试7: 日志区域
        const logArea = await page.locator('.log-area');
        const logText = await logArea.textContent();
        logTest('日志区域有内容', logText && logText.length > 10);

        // 测试8: 进度面板初始隐藏
        const progressPanel = await page.locator('#progressPanel');
        const isHidden = await progressPanel.evaluate(el =>
            window.getComputedStyle(el).display === 'none'
        );
        logTest('进度面板初始隐藏', isHidden);

        // 截图
        const reportDir = path.join(__dirname, '..', 'reports');
        fs.mkdirSync(reportDir, { recursive: true });
        await page.screenshot({
            path: path.join(reportDir, `e2e-screenshot-${Date.now()}.png`),
            fullPage: true
        });

    } catch (e) {
        logTest('测试执行', false, e.message);
    } finally {
        await browser.close();
    }

    // 报告
    console.log('\n' + '='.repeat(60));
    console.log('📊 测试报告');
    console.log('='.repeat(60));
    const passed = results.filter(r => r.passed).length;
    console.log(`总计: ${results.length} 项`);
    console.log(`通过: ${passed} 项`);
    console.log(`失败: ${results.length - passed} 项`);
    console.log(`通过率: ${((passed / results.length) * 100).toFixed(1)}%`);

    return results.length === passed;
}

runTests().then(allPassed => {
    process.exit(allPassed ? 0 : 1);
}).catch(err => {
    console.error('测试出错:', err);
    process.exit(1);
});
