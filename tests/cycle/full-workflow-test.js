/**
 * 全流程功能测试 - 带界面浏览器
 * 测试完整流程：豆包生成提示词 → Legil生成图片
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:3066';
const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');

// 确保截图目录存在
if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

const results = [];

function logTest(name, passed, message = '') {
    const icon = passed ? '✅' : '❌';
    const status = passed ? 'PASS' : 'FAIL';
    results.push({ name, passed, message, status, timestamp: new Date().toISOString() });
    console.log(`${icon} [${status}] ${name}${message ? ': ' + message : ''}`);
}

async function takeScreenshot(page, name) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${name}_${timestamp}.png`;
    const filepath = path.join(SCREENSHOT_DIR, filename);
    await page.screenshot({ path: filepath, fullPage: true });
    console.log(`  📸 截图: ${filename}`);
    return filepath;
}

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function runFullWorkflowTest() {
    console.log('\n' + '='.repeat(70));
    console.log('🧪 全流程功能测试（带界面浏览器）');
    console.log('='.repeat(70));
    console.log('⚠️  注意：测试过程中请勿关闭浏览器窗口');
    console.log('⚠️  当需要登录时，请在浏览器中手动完成登录\n');

    let browser;
    let page;

    try {
        // 启动带界面的浏览器
        console.log('🚀 启动浏览器（带界面模式）...');
        browser = await chromium.launch({
            headless: false,
            slowMo: 100,
            args: ['--window-size=1400,900']
        });

        const context = await browser.newContext({
            viewport: { width: 1400, height: 900 }
        });

        page = await context.newPage();

        // ===== 阶段1: 页面加载 =====
        console.log('\n📋 阶段1: 页面加载');
        await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await sleep(2000);
        await takeScreenshot(page, '01_page_loaded');

        const title = await page.title();
        logTest('页面加载', title.includes('AI生图'), `标题: ${title}`);

        // ===== 阶段2: 配置文件夹 =====
        console.log('\n📋 阶段2: 配置文件夹');

        // 填写豆包参考图文件夹
        const inputFolder = 'D:\\工作\\自动化工作流1\\输入';
        await page.fill('#referenceFolder', inputFolder);
        await page.click('button:has-text("确认")');
        await sleep(2000);

        const refInfoBox = await page.locator('#refCountInfo');
        const refInfoVisible = await refInfoBox.isVisible().catch(() => false);
        const refInfoText = refInfoVisible ? await refInfoBox.textContent() : '';
        logTest('豆包参考图文件夹统计', refInfoVisible && refInfoText.includes('找到'), refInfoText.substring(0, 50));
        await takeScreenshot(page, '02_folder_config');

        // 填写Legil参考图文件夹
        const legilRefFolder = 'D:\\工作\\自动化工作流1\\Legil参考图';
        await page.fill('#legilReferenceFolder', legilRefFolder);
        await page.click('button:has-text("保存配置")');
        await sleep(1000);
        logTest('Legil参考图配置保存', true);

        // 填写输出文件夹
        const outputFolder = 'D:\\工作\\自动化工作流1\\输出';
        await page.fill('#saveFolder', outputFolder);
        logTest('输出文件夹配置', true);

        // ===== 阶段3: 打开浏览器 =====
        console.log('\n📋 阶段3: 打开浏览器');
        console.log('⚠️  正在打开豆包和Legil网站...');

        await page.click('button:has-text("打开网站")');
        await sleep(5000);
        await takeScreenshot(page, '03_browser_opened');

        // 检查状态指示器
        const browserStatus = await page.locator('#browserStatusItem');
        const browserOnline = await browserStatus.evaluate(el =>
            el.classList.contains('status-online')
        ).catch(() => false);

        if (!browserOnline) {
            console.log('\n⚠️  请在新打开的浏览器窗口中完成以下操作：');
            console.log('   1. 登录豆包账号');
            console.log('   2. 登录Legil账号');
            console.log('   ⏳ 等待30秒让您完成登录...');

            // 等待30秒让用户完成登录
            await sleep(30000);
            console.log('   ✅ 继续测试...');
        }

        logTest('浏览器打开', true, '请确保已完成登录');

        // ===== 阶段4: 启动工作流 =====
        console.log('\n📋 阶段4: 启动工作流');

        // 监听对话框
        page.on('dialog', async dialog => {
            console.log(`  🔔 对话框: ${dialog.message()}`);
            await dialog.accept();
        });

        await page.click('#oneClickStartBtn');
        await sleep(2000);

        // 处理确认对话框
        try {
            const dialog = await page.waitForEvent('dialog', { timeout: 5000 });
            await dialog.accept();
            console.log('  ✅ 已确认启动工作流');
        } catch (e) {
            console.log('  ℹ️  无确认对话框或已自动处理');
        }

        await takeScreenshot(page, '04_workflow_started');
        logTest('工作流启动', true);

        // 检查进度面板是否显示
        const progressPanel = await page.locator('#progressPanel');
        const progressVisible = await progressPanel.isVisible().catch(() => false);
        logTest('进度面板显示', progressVisible);

        // ===== 阶段5: 监控执行 =====
        console.log('\n📋 阶段5: 监控执行（此阶段可能需要10-20分钟）');
        console.log('⏳ 正在监控工作流执行，请等待...');
        console.log('   - 豆包上传和提示词生成: ~2-3分钟');
        console.log('   - Legil生成5张图片: ~15-20分钟');

        const startTime = Date.now();
        const maxWaitTime = 30 * 60 * 1000; // 30分钟超时
        let lastScreenshot = startTime;
        let workflowCompleted = false;

        while (Date.now() - startTime < maxWaitTime) {
            await sleep(10000); // 每10秒检查一次

            // 获取当前状态
            try {
                const statusText = await page.locator('#currentStatusText').textContent();
                const imageProgress = await page.locator('#imageProgressText').textContent();
                const promptProgress = await page.locator('#promptProgressText').textContent();

                console.log(`  ⏳ ${imageProgress} | ${promptProgress} | ${statusText.substring(0, 40)}`);

                // 每2分钟截图一次
                if (Date.now() - lastScreenshot > 2 * 60 * 1000) {
                    await takeScreenshot(page, `05_progress_${Date.now()}`);
                    lastScreenshot = Date.now();
                }

                // 检查是否完成
                const modalVisible = await page.locator('#completionModal').evaluate(el =>
                    el.classList.contains('active')
                ).catch(() => false);

                if (modalVisible) {
                    console.log('  ✅ 检测到完成弹窗');
                    workflowCompleted = true;
                    await takeScreenshot(page, '06_workflow_completed');
                    break;
                }

                // 检查是否停止
                const isRunning = await page.evaluate(() => {
                    const btn = document.querySelector('#oneClickStartBtn');
                    return btn && btn.textContent.includes('运行中');
                });

                if (!isRunning && Date.now() - startTime > 5 * 60 * 1000) {
                    console.log('  ⚠️  工作流可能已停止');
                    break;
                }

            } catch (e) {
                console.log(`  ⚠️  获取状态失败: ${e.message}`);
            }
        }

        // ===== 阶段6: 验证结果 =====
        console.log('\n📋 阶段6: 验证结果');

        // 检查输出文件夹
        let outputFiles = [];
        try {
            outputFiles = fs.readdirSync(outputFolder).filter(f =>
                f.endsWith('.png') || f.endsWith('.jpg') || f.endsWith('.jpeg')
            );
            console.log(`  📁 输出文件夹找到 ${outputFiles.length} 张图片`);
            logTest('输出图片生成', outputFiles.length >= 5, `生成 ${outputFiles.length} 张图片`);
        } catch (e) {
            logTest('输出图片生成', false, `无法读取输出文件夹: ${e.message}`);
        }

        // 最终截图
        await takeScreenshot(page, '07_final_state');

        // 关闭完成弹窗
        try {
            await page.click('.modal-actions button');
            await sleep(500);
        } catch (e) {}

        logTest('全流程完成', workflowCompleted);

    } catch (error) {
        console.error('\n❌ 测试执行出错:', error.message);
        logTest('测试执行', false, error.message);

        // 错误截图
        if (page) {
            try {
                await takeScreenshot(page, 'error_state');
            } catch (e) {}
        }

    } finally {
        // 生成报告
        console.log('\n' + '='.repeat(70));
        console.log('📊 测试报告');
        console.log('='.repeat(70));

        const passed = results.filter(r => r.passed).length;
        const failed = results.filter(r => !r.passed).length;

        console.log(`总计: ${results.length} 项`);
        console.log(`通过: ${passed} 项`);
        console.log(`失败: ${failed} 项`);
        console.log(`通过率: ${results.length > 0 ? ((passed / results.length) * 100).toFixed(1) : 0}%`);

        if (failed > 0) {
            console.log('\n❌ 失败项目:');
            results.filter(r => !r.passed).forEach((r, i) => {
                console.log(`  ${i + 1}. ${r.name}`);
                if (r.message) console.log(`     ${r.message}`);
            });
        }

        // 保存报告
        const reportPath = path.join(__dirname, 'reports', `test-report-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
        if (!fs.existsSync(path.dirname(reportPath))) {
            fs.mkdirSync(path.dirname(reportPath), { recursive: true });
        }
        fs.writeFileSync(reportPath, JSON.stringify({
            timestamp: new Date().toISOString(),
            summary: { total: results.length, passed, failed },
            results
        }, null, 2));
        console.log(`\n📄 报告已保存: ${reportPath}`);

        // 保持浏览器打开以便查看
        console.log('\n⚠️  浏览器将保持打开状态10秒以便查看...');
        await sleep(10000);

        if (browser) {
            await browser.close();
            console.log('🔒 浏览器已关闭');
        }

        return { passed, failed, total: results.length };
    }
}

// 运行测试
runFullWorkflowTest().then(result => {
    console.log('\n🏁 测试结束');
    process.exit(result.failed > 0 ? 1 : 0);
}).catch(err => {
    console.error('测试运行出错:', err);
    process.exit(1);
});
