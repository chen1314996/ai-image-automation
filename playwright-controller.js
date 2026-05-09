/**
 * ============================================
 * Playwright 浏览器自动化控制器
 * ============================================
 * 第三阶段：封装浏览器操作功能
 * 第五阶段更新：使用持久化上下文保存登录状态
 * 提供打开网站、操作页面等方法
 */

// 引入 playwright 的 chromium 模块
// chromium 是 Playwright 支持的三种浏览器之一（Chromium/Firefox/WebKit）
const { chromium } = require('playwright');

// 引入实时日志系统（第四阶段新增）
const logger = require('./logger');

// 引入 path 模块用于处理路径
const path = require('path');
const fs = require('fs');

// 用户数据目录路径 - 用于保存登录状态、cookie 等
// 目录位于项目文件夹下，方便管理
const USER_DATA_DIR = path.join(__dirname, 'browser_data');

// 存储状态文件路径
const STORAGE_STATE_FILE = path.join(__dirname, 'storage_state.json');

/**
 * BrowserController 类
 * 封装所有浏览器相关的操作
 */
class BrowserController {
    constructor() {
        // 浏览器实例，初始为 null
        this.browser = null;

        // 页面实例字典，用于存储多个页面
        // 键值对形式：{ 'chatgpt': page实例, 'legil': page实例 }
        this.pages = {};

        // 浏览器上下文（可以用来共享 cookie、缓存等）
        this.context = null;
    }

    /**
     * 启动浏览器
     * -----------
     * 打开一个 Chromium 浏览器窗口
     * 使用 storage state 保存登录状态和 cookie
     * @param {boolean} headless - 是否无头模式（true=后台运行不显示窗口，false=显示窗口）
     * @returns {Promise<boolean>} - 启动成功返回 true，失败返回 false
     */
    async launchBrowser(headless = false) {
        try {
            console.log('🚀 正在启动浏览器...');
            logger.browser('正在启动浏览器...');
            console.log(`   存储状态文件: ${STORAGE_STATE_FILE}`);

            // 检查是否有残留的浏览器进程
            if (this.browser || this.context) {
                console.log('   检测到已存在的浏览器实例，先关闭...');
                try {
                    await this.closeBrowser();
                } catch (e) {
                    // 忽略关闭错误
                }
            }

            console.log('   正在启动浏览器...');

            // 使用普通 launch 启动浏览器（更稳定）
            this.browser = await chromium.launch({
                headless: headless,              // 是否无头模式
                slowMo: 100,                     // 增加操作延迟，更自然
                args: [
                    '--window-size=1280,800',
                    '--no-sandbox',                  // 禁用沙箱（Windows 更稳定）
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-blink-features=AutomationControlled',  // 禁用自动化检测
                    '--disable-web-security',
                    '--disable-features=IsolateOrigins,site-per-process',
                    '--remote-debugging-port=9223'   // 开启远程调试端口，支持外部连接
                ]
            });

            // 创建新的浏览器上下文
            // 如果存在存储状态文件，则加载它
            const contextOptions = {
                viewport: { width: 1280, height: 800 }  // 视口大小
            };

            if (fs.existsSync(STORAGE_STATE_FILE)) {
                console.log('   加载已保存的登录状态...');
                contextOptions.storageState = STORAGE_STATE_FILE;
            }

            this.context = await this.browser.newContext(contextOptions);

            console.log('✅ 浏览器启动成功');
            logger.browser('✅ 浏览器启动成功');
            return true;

        } catch (error) {
            console.error('❌ 浏览器启动失败:', error.message);
            logger.error(`浏览器启动失败: ${error.message}`);

            // 重置状态
            this.browser = null;
            this.context = null;

            return false;
        }
    }

    /**
     * 保存浏览器状态
     * 保存 cookies 和 localStorage 到文件
     */
    async saveStorageState() {
        if (this.context) {
            try {
                await this.context.storageState({ path: STORAGE_STATE_FILE });
                console.log('   登录状态已保存');
            } catch (e) {
                console.error('   保存登录状态失败:', e.message);
            }
        }
    }

    /**
     * 打开指定网站
     * -----------
     * 在一个新页面中打开指定 URL
     * @param {string} name - 页面标识名称（如 'chatgpt'、'legil'）
     * @param {string} url - 要打开的网址
     * @returns {Promise<boolean>} - 成功返回 true，失败返回 false
     */
    async openWebsite(name, url) {
        try {
            console.log(`🌐 准备打开 ${name}: ${url}`);
            logger.browser(`准备打开 ${name}`);

            // 如果浏览器未启动，先启动浏览器
            if (!this.browser || !this.context) {
                console.log('   浏览器未启动，正在启动...');
                const launched = await this.launchBrowser(false);
                if (!launched) {
                    throw new Error('浏览器启动失败');
                }
            }

            // 检查浏览器实例是否有效
            if (!this.browser) {
                throw new Error('浏览器实例无效');
            }

            console.log(`   正在打开页面...`);
            logger.browser(`正在打开 ${name}: ${url}`);

            // 如果该页面已存在，先关闭旧的
            if (this.pages[name]) {
                try {
                    if (!this.pages[name].isClosed()) {
                        await this.pages[name].close();
                    }
                } catch (e) {
                    // 忽略关闭错误
                }
                delete this.pages[name];
                console.log(`   已关闭旧的 ${name} 页面`);
            }

            // 创建新页面（相当于浏览器的新标签页）
            console.log('   创建新页面...');
            const page = await this.context.newPage();

            // 导航到指定 URL
            console.log('   正在加载网页...');
            await page.goto(url, {
                waitUntil: 'domcontentloaded',
                timeout: 30000  // 超时时间 30 秒
            });

            // 等待页面稳定 - 对于豆包等复杂页面需要更长时间
            console.log('   等待页面渲染完成...');
            await this.sleep(5000);

            // 检查是否是错误页面，如果是则重试
            const currentUrl = page.url();
            if (currentUrl.startsWith('chrome-error://')) {
                console.log('   检测到错误页面，正在重新加载...');
                await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
                await this.sleep(5000);
            }

            // 保存页面实例
            this.pages[name] = page;

            console.log(`✅ ${name} 已打开并加载完成`);
            logger.browser(`✅ ${name} 已打开并加载完成`);
            return true;

        } catch (error) {
            console.error(`❌ 打开 ${name} 失败:`, error.message);
            logger.error(`❌ 打开 ${name} 失败: ${error.message}`);

            // 如果是因为浏览器实例问题，重置状态
            if (error.message.includes('closed') || error.message.includes('invalid')) {
                console.log('   重置浏览器状态...');
                this.browser = null;
                this.context = null;
                this.pages = {};
            }

            return false;
        }
    }

    /**
     * 同时打开两个网站
     * ---------------
     * 同时打开 豆包 和 Legil 两个网站
     * @param {string} doubaoUrl - 豆包网址
     * @param {string} legilUrl - Legil 平台网址
     * @returns {Promise<Object>} - 返回各网站的打开结果
     */
    async openBothWebsites(doubaoUrl, legilUrl) {
        const results = {
            doubao: false,
            legil: false
        };

        console.log('\n🔄 开始同时打开两个网站...\n');

        // 先启动浏览器
        if (!this.browser) {
            const launched = await this.launchBrowser(false);
            if (!launched) {
                return results;
            }
        }

        // 使用 Promise.all 同时打开两个网站（并行执行提高效率）
        // 虽然 playwright 操作是异步的，但我们按顺序打开更稳定
        try {
            // 打开 豆包
            results.doubao = await this.openWebsite('doubao', doubaoUrl);

            // 等待 1 秒，让第一个页面稳定
            await this.sleep(1000);

            // 打开 Legil
            results.legil = await this.openWebsite('legil', legilUrl);

        } catch (error) {
            console.error('打开网站时出错:', error.message);
        }

        // 输出结果总结
        console.log('\n📊 打开结果：');
        console.log(`   豆包: ${results.doubao ? '✅ 成功' : '❌ 失败'}`);
        console.log(`   Legil: ${results.legil ? '✅ 成功' : '❌ 失败'}`);

        return results;
    }

    /**
     * 获取页面实例
     * -----------
     * 获取指定名称的页面对象，用于后续操作
     * @param {string} name - 页面名称
     * @returns {Page|null} - playwright 的 Page 对象，不存在返回 null
     */
    getPage(name) {
        const page = this.pages[name];
        if (!page) return null;

        // 检查页面是否有效（没有被关闭且不是错误页面）
        if (page.isClosed()) {
            delete this.pages[name];
            return null;
        }

        // 检查页面URL是否是错误页面
        const url = page.url();
        if (url.startsWith('chrome-error://') || url === 'about:blank') {
            logger.warn(`页面 ${name} 是错误页面 (${url})，将重新打开...`);
            delete this.pages[name];
            return null;
        }

        return page;
    }

    /**
     * 检查页面是否已打开
     * @param {string} name - 页面名称
     * @returns {boolean}
     */
    isPageOpen(name) {
        return !!this.pages[name] && !this.pages[name].isClosed();
    }

    /**
     * 关闭指定页面
     * @param {string} name - 页面名称
     */
    async closePage(name) {
        if (this.pages[name]) {
            await this.pages[name].close();
            delete this.pages[name];
            console.log(`🔒 已关闭 ${name} 页面`);
        }
    }

    /**
     * 关闭浏览器
     * 关闭所有页面和浏览器实例
     * 注意：登录状态会自动保存到 storage_state.json
     */
    async closeBrowser() {
        if (this.context) {
            console.log('🔒 正在关闭浏览器...');
            try {
                // 先保存状态
                await this.saveStorageState();

                // 关闭浏览器上下文
                await this.context.close();
                console.log('   浏览器上下文已关闭');
            } catch (error) {
                console.error('   关闭浏览器时出错:', error.message);
            } finally {
                this.context = null;
                this.pages = {};
            }
        }

        if (this.browser) {
            try {
                await this.browser.close();
                console.log('🔒 浏览器已关闭（登录状态已保存）');
            } catch (error) {
                console.error('   关闭浏览器时出错:', error.message);
            } finally {
                this.browser = null;
            }

            // 等待一下确保进程完全退出
            await this.sleep(1000);
        }
    }

    /**
     * 延迟/等待工具函数
     * @param {number} ms - 延迟毫秒数
     * @returns {Promise<void>}
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// 导出单例实例（确保整个应用使用同一个浏览器控制器）
module.exports = new BrowserController();
