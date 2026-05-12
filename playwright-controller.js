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
     * 使用 browser_data 持久化用户目录保存登录状态和 cookie
     * @param {boolean} headless - 是否无头模式（true=后台运行不显示窗口，false=显示窗口）
     * @returns {Promise<boolean>} - 启动成功返回 true，失败返回 false
     */
    async launchBrowser(headless = false) {
        try {
            console.log('🚀 正在启动浏览器...');
            logger.browser('正在启动浏览器...');
            console.log(`   用户数据目录: ${USER_DATA_DIR}`);

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

            // 使用持久化用户目录启动浏览器。这样 Legil 的 cookie、localStorage、
            // IndexedDB 等登录信息会像普通浏览器一样自动保存到 browser_data。
            const contextOptions = {
                headless: headless,              // 是否无头模式
                slowMo: 100,                     // 增加操作延迟，更自然
                viewport: { width: 1280, height: 800 },
                acceptDownloads: true,
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
            };

            if (!fs.existsSync(USER_DATA_DIR)) {
                fs.mkdirSync(USER_DATA_DIR, { recursive: true });
            }

            try {
                this.context = await chromium.launchPersistentContext(USER_DATA_DIR, contextOptions);
            } catch (launchError) {
                if (/lock|singleton|profile|user data directory|正在使用|in use/i.test(launchError.message)) {
                    console.log('   检测到浏览器用户目录锁定，正在清理残留锁文件后重试...');
                    this.clearStaleProfileLocks();
                    this.context = await chromium.launchPersistentContext(USER_DATA_DIR, contextOptions);
                } else {
                    throw launchError;
                }
            }

            this.browser = this.context.browser();
            this.attachLifecycleHandlers();

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

    attachLifecycleHandlers() {
        if (this.context) {
            this.context.once('close', () => {
                this.context = null;
                this.browser = null;
                this.pages = {};
                console.log('   浏览器上下文已关闭，登录状态已由 browser_data 自动保留');
            });
        }

        if (this.browser) {
            this.browser.once('disconnected', () => {
                this.context = null;
                this.browser = null;
                this.pages = {};
                console.log('   浏览器已断开连接');
            });
        }
    }

    isBrowserActive() {
        if (!this.context || !this.browser) {
            return false;
        }

        try {
            if (typeof this.browser.isConnected === 'function' && !this.browser.isConnected()) {
                return false;
            }
            this.context.pages();
            return true;
        } catch (e) {
            return false;
        }
    }

    clearStaleProfileLocks() {
        const lockFiles = ['SingletonLock', 'SingletonCookie', 'SingletonSocket'];
        for (const fileName of lockFiles) {
            const targetPath = path.join(USER_DATA_DIR, fileName);
            try {
                if (fs.existsSync(targetPath)) {
                    fs.rmSync(targetPath, { force: true, recursive: true });
                    console.log(`   已清理残留锁文件: ${fileName}`);
                }
            } catch (error) {
                console.log(`   清理锁文件 ${fileName} 失败: ${error.message}`);
            }
        }
    }

    /**
     * 保存浏览器状态
     * 持久化上下文会自动把登录信息写入 browser_data。
     */
    async saveStorageState() {
        console.log('   登录状态由 browser_data 自动保存');
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
            if (!this.isBrowserActive()) {
                console.log('   浏览器未启动，正在启动...');
                const launched = await this.launchBrowser(false);
                if (!launched) {
                    throw new Error('浏览器启动失败');
                }
            }

            // 检查浏览器实例是否有效
            if (!this.isBrowserActive()) {
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

            // 等待页面稳定 - 对于复杂页面需要更长时间
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
     * 同时打开自动化所需网站
     * ---------------
     * 豆包提示词阶段已改为 API 调用，因此这里只打开 Legil。
     * 第一个参数保留为兼容旧后端调用，不再使用。
     * @param {string} _doubaoUrl - 旧版豆包网址，API 版不再使用
     * @param {string} legilUrl - Legil 平台网址
     * @returns {Promise<Object>} - 返回各网站的打开结果
     */
    async openBothWebsites(_doubaoUrl, legilUrl) {
        const results = {
            doubao: true,
            legil: false
        };

        console.log('\n🔄 开始打开 Legil 网站（豆包 API 无需网页）...\n');

        // 先启动浏览器
        if (!this.isBrowserActive()) {
            const launched = await this.launchBrowser(false);
            if (!launched) {
                return results;
            }
        }

        // 使用 Promise.all 同时打开两个网站（并行执行提高效率）
        // 虽然 playwright 操作是异步的，但我们按顺序打开更稳定
        try {
            // 打开 Legil
            results.legil = await this.openWebsite('legil', legilUrl);

        } catch (error) {
            console.error('打开网站时出错:', error.message);
        }

        // 输出结果总结
        console.log('\n📊 打开结果：');
        console.log('   豆包: ✅ API 模式，无需网页');
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
     * 注意：登录状态会自动保存到 browser_data
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
                this.browser = null;
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
