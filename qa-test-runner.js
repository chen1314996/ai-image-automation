/**
 * QA测试运行器
 * 自动截图并记录测试结果
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// 截图保存目录
const SCREENSHOT_DIR = path.join(__dirname, 'qa-screenshots');
if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

// 测试结果记录
const testResults = [];

async function takeScreenshot(page, name) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${name}_${timestamp}.png`;
    const filepath = path.join(SCREENSHOT_DIR, filename);
    await page.screenshot({ path: filepath, fullPage: true });
    console.log(`📸 截图已保存: ${filepath}`);
    return filepath;
}

function logTest(testName, passed, message = '') {
    const status = passed ? '✅ PASS' : '❌ FAIL';
    testResults.push({ testName, passed, message, timestamp: new Date().toISOString() });
    console.log(`${status} - ${testName}${message ? ': ' + message : ''}`);
}

async function runQATests() {
    console.log('========================================');
    console.log('🧪 开始QA测试');
    console.log('========================================');

    const browser = await chromium.launch({
        headless: false,
        slowMo: 100,
        args: ['--window-size=1400,900']
    });

    const context = await browser.newContext({
        viewport: { width: 1400, height: 900 }
    });

    const page = await context.newPage();

    try {
        // 测试1: 页面加载
        console.log('\n--- 测试1: 页面加载 ---');
        await page.goto('http://localhost:3055', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(3000);
        await takeScreenshot(page, '01_page_loaded');

        const title = await page.title();
        logTest('页面标题', title.includes('AI生图'), `标题: ${title}`);

        // 检查关键元素
        const hasReferenceInput = await page.locator('#referenceFolder').count() > 0;
        logTest('参考图文件夹输入框存在', hasReferenceInput);

        const hasLegilRefInput = await page.locator('#legilReferenceFolder').count() > 0;
        logTest('Legil参考图文件夹输入框存在', hasLegilRefInput);

        // 检查新的UI元素
        const hasWorkflowSection = await page.locator('.workflow-section').count() > 0;
        logTest('工作流区域存在', hasWorkflowSection);

        const hasProgressPanel = await page.locator('#progressPanel').count() > 0;
        logTest('进度面板存在', hasProgressPanel);

        // 测试2: 检查按钮状态
        console.log('\n--- 测试2: 按钮检查 ---');
        const buttons = [
            { selector: 'button:has-text("确认")', name: '确认按钮' },
            { selector: '#oneClickStartBtn', name: '一键启动按钮' },
            { selector: 'button:has-text("打开豆包")', name: '打开豆包按钮' },
            { selector: 'button:has-text("打开Legil")', name: '打开Legil按钮' }
        ];

        for (const btn of buttons) {
            try {
                const count = await page.locator(btn.selector).count();
                const visible = count > 0 && await page.locator(btn.selector).first().isVisible();
                logTest(`${btn.name}存在`, visible);
            } catch (e) {
                logTest(`${btn.name}存在`, false, e.message);
            }
        }

        await takeScreenshot(page, '02_buttons_check');

        // 测试3: 测试文件夹统计功能
        console.log('\n--- 测试3: 文件夹统计功能 ---');

        // 使用测试文件夹路径
        const testInputPath = 'D:\\工作\\自动化工作流1\\输入';
        await page.fill('#referenceFolder', testInputPath);
        await page.click('button:has-text("确认")');

        // 等待结果
        await page.waitForTimeout(2000);

        // 检查结果显示
        const infoBox = await page.locator('#refCountInfo');
        const infoBoxVisible = await infoBox.isVisible().catch(() => false);

        if (infoBoxVisible) {
            const text = await infoBox.textContent();
            logTest('文件夹统计结果显示', true, text.substring(0, 50));
        } else {
            logTest('文件夹统计结果显示', false, '信息框未显示');
        }

        await takeScreenshot(page, '03_folder_stats');

        // 测试4: 检查Legil参考图配置区域
        console.log('\n--- 测试4: Legil参考图配置 ---');
        const legilRefSection = await page.locator('#legilReferenceFolder');
        const legilRefVisible = await legilRefSection.isVisible();
        logTest('Legil参考图输入框可见', legilRefVisible);

        // 测试输入和保存
        const testLegilPath = 'D:\\工作\\自动化工作流1\\Legil参考图';
        await page.fill('#legilReferenceFolder', testLegilPath);
        await page.click('button:has-text("保存配置")');
        await page.waitForTimeout(1000);

        await takeScreenshot(page, '04_legil_ref_config');

        // 测试5: 浏览器控制按钮
        console.log('\n--- 测试5: 浏览器控制 ---');

        // 点击"一键打开两个网站"
        const openBothBtn = page.locator('#openBothBtn');
        await openBothBtn.click();
        await page.waitForTimeout(3000);

        // 检查浏览器是否打开（通过状态指示器）
        const browserStatus = await page.locator('#browserStatus').textContent();
        logTest('浏览器状态显示', browserStatus.includes('运行中') || browserStatus.includes('已打开'), browserStatus);

        await takeScreenshot(page, '05_browser_opened');

        // 等待几秒钟观察
        await page.waitForTimeout(5000);

        // 测试6: 检查实时日志
        console.log('\n--- 测试6: 实时日志 ---');
        const logArea = await page.locator('#logArea');
        const logAreaVisible = await logArea.isVisible();
        logTest('日志区域可见', logAreaVisible);

        const logContent = await logArea.textContent();
        logTest('日志有内容', logContent.length > 50, `日志长度: ${logContent.length}`);

        await takeScreenshot(page, '06_logs');

        // 测试7: 工作流区域检查
        console.log('\n--- 测试7: 工作流区域 ---');
        const workflowSection = await page.locator('text=完整工作流自动化');
        const workflowVisible = await workflowSection.isVisible();
        logTest('工作流区域可见', workflowVisible);

        const oneClickBtn = await page.locator('#oneClickStartBtn');
        const oneClickVisible = await oneClickBtn.isVisible();
        logTest('一键启动按钮可见', oneClickVisible);

        await takeScreenshot(page, '07_workflow_section');

        // 测试8: 提示词管理区域
        console.log('\n--- 测试8: 提示词管理区域 ---');
        const promptSection = await page.locator('text=提示词管理中心');
        const promptSectionVisible = await promptSection.isVisible();
        logTest('提示词管理区域可见', promptSectionVisible);

        await takeScreenshot(page, '08_prompt_management');

        // 最终截图
        await page.waitForTimeout(2000);
        await takeScreenshot(page, '09_final_state');

    } catch (error) {
        console.error('❌ 测试执行出错:', error.message);
        await takeScreenshot(page, 'error_state');
    } finally {
        // 生成测试报告
        console.log('\n========================================');
        console.log('📊 测试报告');
        console.log('========================================');

        const passed = testResults.filter(r => r.passed).length;
        const failed = testResults.filter(r => !r.passed).length;

        console.log(`总计: ${testResults.length} 项测试`);
        console.log(`通过: ${passed} 项`);
        console.log(`失败: ${failed} 项`);
        console.log(`通过率: ${((passed / testResults.length) * 100).toFixed(1)}%`);

        console.log('\n--- 详细结果 ---');
        testResults.forEach((r, i) => {
            const status = r.passed ? '✅' : '❌';
            console.log(`${i + 1}. ${status} ${r.testName}`);
            if (r.message) console.log(`   ${r.message}`);
        });

        // 保存测试报告
        const reportPath = path.join(SCREENSHOT_DIR, `test-report-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
        fs.writeFileSync(reportPath, JSON.stringify(testResults, null, 2));
        console.log(`\n📄 测试报告已保存: ${reportPath}`);

        await browser.close();
        console.log('\n🏁 测试完成');
    }
}

// 运行测试
runQATests().catch(console.error);
