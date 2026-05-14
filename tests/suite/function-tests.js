/**
 * 功能测试
 */

const { chromium } = require('playwright');
const TestUtils = require('./test-utils');
const config = require('./test-config');

class FunctionTests {
    constructor(baseUrl) {
        this.baseUrl = baseUrl || config.server.baseUrl;
        this.utils = new TestUtils();
        this.browser = null;
        this.page = null;
    }

    async runAll() {
        console.log('\n' + '='.repeat(60));
        console.log('🎮 功能测试');
        console.log('='.repeat(60));

        try {
            await this.setup();

            await this.testPageLoad();
            await this.testFormInputs();
            await this.testFolderConfiguration();
            await this.testBrowserControls();
            await this.testLogStream();
            await this.testWorkflowUI();

        } finally {
            await this.teardown();
        }

        return this.utils.printReport();
    }

    async setup() {
        console.log('\n🚀 启动浏览器...');
        this.browser = await chromium.launch({
            headless: true,
            slowMo: 50
        });
        this.context = await this.browser.newContext({
            viewport: { width: 1400, height: 900 }
        });
        this.page = await this.context.newPage();
    }

    async teardown() {
        if (this.browser) {
            await this.browser.close();
            console.log('🔒 浏览器已关闭');
        }
    }

    /**
     * 测试页面加载
     */
    async testPageLoad() {
        try {
            await this.page.goto(this.baseUrl, { waitUntil: 'domcontentloaded' });
            await this.utils.sleep(1000);

            const title = await this.page.title();
            const passed = title.includes('AI生图');
            this.utils.logTest('页面标题正确', passed, `标题: ${title}`);

            // 检查关键元素
            const hasHeader = await this.page.locator('.header').count() > 0;
            this.utils.logTest('页面头部存在', hasHeader);

            const hasWorkflow = await this.page.locator('.workflow-section').count() > 0;
            this.utils.logTest('工作流区域存在', hasWorkflow);

            const hasLogArea = await this.page.locator('.log-area').count() > 0;
            this.utils.logTest('日志区域存在', hasLogArea);

        } catch (e) {
            this.utils.logTest('页面加载', false, e.message);
        }
    }

    /**
     * 测试表单输入
     */
    async testFormInputs() {
        try {
            // 测试参考图文件夹输入
            const refFolder = 'D:\\Test\\Reference';
            await this.page.fill('#referenceFolder', refFolder);
            const value = await this.page.inputValue('#referenceFolder');
            this.utils.logTest('参考图文件夹输入', value === refFolder);

            // 测试Legil参考图输入
            const legilRef = 'D:\\Test\\LegilRef';
            await this.page.fill('#legilReferenceFolder', legilRef);
            const legilValue = await this.page.inputValue('#legilReferenceFolder');
            this.utils.logTest('Legil参考图输入', legilValue === legilRef);

            // 测试保存文件夹输入
            const saveFolder = 'D:\\Test\\Output';
            await this.page.fill('#saveFolder', saveFolder);
            const saveValue = await this.page.inputValue('#saveFolder');
            this.utils.logTest('保存文件夹输入', saveValue === saveFolder);

        } catch (e) {
            this.utils.logTest('表单输入', false, e.message);
        }
    }

    /**
     * 测试文件夹配置功能
     */
    async testFolderConfiguration() {
        try {
            // 先设置正确的测试路径
            await this.page.fill('#referenceFolder', config.testData.inputFolder);

            // 点击确认按钮
            await this.page.click('button:has-text("确认")');
            await this.utils.sleep(2000);

            // 检查结果显示
            const infoBox = await this.page.locator('#refCountInfo');
            const isVisible = await infoBox.isVisible().catch(() => false);

            if (isVisible) {
                const text = await infoBox.textContent();
                const passed = text.includes('找到') || text.includes('成功');
                this.utils.logTest('文件夹统计结果显示', passed, text.substring(0, 50));
            } else {
                this.utils.logTest('文件夹统计结果显示', false, '信息框未显示');
            }

        } catch (e) {
            this.utils.logTest('文件夹配置', false, e.message);
        }
    }

    /**
     * 测试浏览器控制按钮
     */
    async testBrowserControls() {
        const buttons = [
            { name: '打开豆包按钮', selector: 'button:has-text("打开豆包")' },
            { name: '打开Legil按钮', selector: 'button:has-text("打开Legil")' },
            { name: '关闭浏览器按钮', selector: 'button:has-text("关闭浏览器")' }
        ];

        for (const btn of buttons) {
            try {
                const count = await this.page.locator(btn.selector).count();
                const visible = count > 0 && await this.page.locator(btn.selector).first().isVisible();
                this.utils.logTest(`${btn.name}存在`, visible);
            } catch (e) {
                this.utils.logTest(`${btn.name}存在`, false, e.message);
            }
        }
    }

    /**
     * 测试日志流
     */
    async testLogStream() {
        try {
            // 等待SSE连接
            await this.utils.sleep(2000);

            const logArea = await this.page.locator('.log-area');
            const hasContent = await logArea.textContent();
            const passed = hasContent && hasContent.length > 10;
            this.utils.logTest('日志区域有内容', passed, `长度: ${hasContent?.length || 0}`);

        } catch (e) {
            this.utils.logTest('日志流', false, e.message);
        }
    }

    /**
     * 测试工作流UI
     */
    async testWorkflowUI() {
        try {
            // 检查一键启动按钮
            const startBtn = await this.page.locator('#oneClickStartBtn');
            const isVisible = await startBtn.isVisible();
            this.utils.logTest('一键启动按钮可见', isVisible);

            // 检查进度面板（初始隐藏）
            const progressPanel = await this.page.locator('#progressPanel');
            const isHidden = await progressPanel.evaluate(el =>
                window.getComputedStyle(el).display === 'none'
            );
            this.utils.logTest('进度面板初始隐藏', isHidden);

            // 检查状态栏
            const statusBar = await this.page.locator('.status-bar');
            const statusVisible = await statusBar.isVisible();
            this.utils.logTest('状态栏可见', statusVisible);

        } catch (e) {
            this.utils.logTest('工作流UI', false, e.message);
        }
    }
}

module.exports = FunctionTests;
