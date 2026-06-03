const EventEmitter = require('events');
const { chromium } = require('playwright');
const { loadImage } = require('canvas');

const JIMENG_IMAGE_URL = 'https://jimeng.jianying.com/ai-tool/generate?workspace=12721326029068&type=image';
const JIMENG_TASK_TYPE = 'jimeng-resize-batch';
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif'];

const DEFAULT_PROMPT = '修改图片比例，可适当调整布局排版，不要产生拉伸。需要生成4张。';
const OUTPUT_COUNT_PROMPT = '需要生成4张。';
const JIMENG_OUTPUT_QUANTITY = 4;

const DEFAULT_JIMENG_RESIZE_CONFIG = {
    inputFolder: 'D:\\工作\\自动化工作流1\\即梦AI批量改尺寸\\输入',
    outputFolder: 'D:\\工作\\自动化工作流1\\即梦AI批量改尺寸\\输出',
    browserMode: 'headless',
    promptTemplate: DEFAULT_PROMPT,
    generationSettings: {
        imageModel: 'image-5-lite',
        aspectRatio: '16:9',
        aspectRatios: ['16:9'],
        resolution: '2k',
        outputQuantity: JIMENG_OUTPUT_QUANTITY,
        concurrency: 1,
        pollTimeoutSeconds: 900
    }
};

const JIMENG_GENERATION_OPTIONS = {
    imageModels: [
        {
            value: 'image-5-lite',
            label: '图片5.0 Lite',
            description: '默认模型；网页自动化会尝试选择该模型，实际以页面可用项为准'
        }
    ],
    aspectRatios: ['1:1', '9:16', '16:9', '4:3', '3:4', '2:3', '3:2'],
    resolutions: [
        { value: '2k', label: '高清 2K' }
    ],
    concurrencyOptions: [1]
};

function padNumber(value, width = 2) {
    const numberValue = Number(value);
    const safeNumber = Number.isFinite(numberValue) && numberValue >= 0
        ? Math.floor(numberValue)
        : 0;
    return String(safeNumber).padStart(width, '0');
}

function sanitizeFileNamePart(value, maxLength = 60) {
    const text = String(value || '').trim();
    const safe = text
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
        .replace(/\s+/g, '_')
        .replace(/_+/g, '_')
        .replace(/[. ]+$/g, '')
        .replace(/^_+|_+$/g, '');
    return (safe || 'image').slice(0, maxLength);
}

function clampNumber(value, fallback, min, max) {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue)) {
        return fallback;
    }
    return Math.max(min, Math.min(max, Math.round(numberValue)));
}

function normalizeBrowserMode(value, fallback = 'headless') {
    if (value === 'headless' || value === 'headed') {
        return value;
    }
    return fallback === 'headed' ? 'headed' : 'headless';
}

function normalizeInputPath(value) {
    return String(value || '').trim().replace(/^["']|["']$/g, '');
}

function normalizeJimengResizeConfig(payload = {}, fallback = DEFAULT_JIMENG_RESIZE_CONFIG) {
    const source = payload && typeof payload === 'object' ? payload : {};
    const fallbackConfig = fallback && typeof fallback === 'object' ? fallback : DEFAULT_JIMENG_RESIZE_CONFIG;
    const sourceSettings = source.generationSettings && typeof source.generationSettings === 'object'
        ? source.generationSettings
        : {};
    const fallbackSettings = fallbackConfig.generationSettings || DEFAULT_JIMENG_RESIZE_CONFIG.generationSettings;

    const imageModel = JIMENG_GENERATION_OPTIONS.imageModels.some(option => option.value === String(sourceSettings.imageModel))
        ? String(sourceSettings.imageModel)
        : (JIMENG_GENERATION_OPTIONS.imageModels.some(option => option.value === String(fallbackSettings.imageModel))
            ? String(fallbackSettings.imageModel)
            : DEFAULT_JIMENG_RESIZE_CONFIG.generationSettings.imageModel);
    const aspectRatio = JIMENG_GENERATION_OPTIONS.aspectRatios.includes(String(sourceSettings.aspectRatio))
        ? String(sourceSettings.aspectRatio)
        : (JIMENG_GENERATION_OPTIONS.aspectRatios.includes(String(fallbackSettings.aspectRatio))
            ? String(fallbackSettings.aspectRatio)
            : DEFAULT_JIMENG_RESIZE_CONFIG.generationSettings.aspectRatio);
    const normalizeAspectRatios = (value) => {
        const rawValues = Array.isArray(value) ? value : [];
        const seen = new Set();
        return rawValues
            .map(item => String(item || '').trim())
            .filter(item => JIMENG_GENERATION_OPTIONS.aspectRatios.includes(item))
            .filter(item => {
                if (seen.has(item)) return false;
                seen.add(item);
                return true;
            });
    };
    const sourceAspectRatios = normalizeAspectRatios(sourceSettings.aspectRatios);
    const fallbackAspectRatios = normalizeAspectRatios(fallbackSettings.aspectRatios);
    const aspectRatios = sourceAspectRatios.length
        ? sourceAspectRatios
        : (fallbackAspectRatios.length ? fallbackAspectRatios : [aspectRatio]);
    const primaryAspectRatio = aspectRatios.includes(aspectRatio)
        ? aspectRatio
        : (aspectRatios[0] || aspectRatio);
    const resolution = JIMENG_GENERATION_OPTIONS.resolutions.some(option => option.value === String(sourceSettings.resolution).toLowerCase())
        ? String(sourceSettings.resolution).toLowerCase()
        : (JIMENG_GENERATION_OPTIONS.resolutions.some(option => option.value === String(fallbackSettings.resolution).toLowerCase())
            ? String(fallbackSettings.resolution).toLowerCase()
            : DEFAULT_JIMENG_RESIZE_CONFIG.generationSettings.resolution);

    return {
        inputFolder: normalizeInputPath(source.inputFolder) || fallbackConfig.inputFolder || DEFAULT_JIMENG_RESIZE_CONFIG.inputFolder,
        outputFolder: normalizeInputPath(source.outputFolder) || fallbackConfig.outputFolder || DEFAULT_JIMENG_RESIZE_CONFIG.outputFolder,
        browserMode: normalizeBrowserMode(source.browserMode, fallbackConfig.browserMode || DEFAULT_JIMENG_RESIZE_CONFIG.browserMode),
        promptTemplate: typeof source.promptTemplate === 'string'
            ? source.promptTemplate
            : (typeof source.prompt === 'string'
                ? source.prompt
                : (fallbackConfig.promptTemplate || DEFAULT_PROMPT)),
        generationSettings: {
            imageModel,
            aspectRatio: primaryAspectRatio,
            aspectRatios,
            resolution,
            outputQuantity: JIMENG_OUTPUT_QUANTITY,
            concurrency: 1,
            pollTimeoutSeconds: clampNumber(
                sourceSettings.pollTimeoutSeconds,
                clampNumber(fallbackSettings.pollTimeoutSeconds, DEFAULT_JIMENG_RESIZE_CONFIG.generationSettings.pollTimeoutSeconds, 120, 3600),
                120,
                3600
            )
        }
    };
}

function getJimengGenerationOptions() {
    return {
        imageModels: [...JIMENG_GENERATION_OPTIONS.imageModels],
        aspectRatios: [...JIMENG_GENERATION_OPTIONS.aspectRatios],
        resolutions: [...JIMENG_GENERATION_OPTIONS.resolutions],
        concurrencyOptions: [...JIMENG_GENERATION_OPTIONS.concurrencyOptions]
    };
}

function resolveImageExtension(contentType = '', url = '') {
    const type = String(contentType || '').toLowerCase();
    if (type.includes('jpeg') || type.includes('jpg')) return '.jpg';
    if (type.includes('webp')) return '.webp';
    if (type.includes('png')) return '.png';

    try {
        const pathname = new URL(url).pathname;
        const ext = pathname.match(/\.(png|jpe?g|webp|bmp|gif)$/i);
        if (ext) {
            return ext[0].toLowerCase().replace('.jpeg', '.jpg');
        }
    } catch (e) {}

    return '.png';
}

function resolveDownloadExtension(fileName = '', contentType = '', url = '') {
    const nameMatch = String(fileName || '').match(/\.(png|jpe?g|webp|bmp|gif)$/i);
    if (nameMatch) {
        return nameMatch[0].toLowerCase().replace('.jpeg', '.jpg');
    }

    return resolveImageExtension(contentType, url);
}

function parseAspectRatio(value = '') {
    const match = String(value || '').match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
    if (!match) return 0;
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        return 0;
    }
    return width / height;
}

class JimengBrowserService extends EventEmitter {
    constructor(deps = {}) {
        super();
        this.ROOT_DIR = deps.ROOT_DIR || process.cwd();
        this.fs = deps.fs || require('fs');
        this.path = deps.path || require('path');
        this.logger = deps.logger || console;
        this.formatDateTimeForFile = deps.formatDateTimeForFile || (() => new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 15));
        this.userDataDir = deps.userDataDir || this.path.join(this.ROOT_DIR, 'browser_data_jimeng');

        this.context = null;
        this.browser = null;
        this.pages = new Set();
        this.mainPage = null;
        this.currentHeadless = null;

        this.running = false;
        this.stopRequested = false;
        this.taskType = null;
        this.progress = this.createIdleProgress();
    }

    createIdleProgress(patch = {}) {
        return {
            taskType: JIMENG_TASK_TYPE,
            phase: 'idle',
            total: 0,
            currentIndex: 0,
            completed: 0,
            success: 0,
            failed: 0,
            saved: 0,
            active: 0,
            queued: 0,
            concurrency: DEFAULT_JIMENG_RESIZE_CONFIG.generationSettings.concurrency,
            currentName: '',
            currentAction: '即梦改尺寸任务未运行',
            updatedAt: new Date().toISOString(),
            ...patch
        };
    }

    isRunning() {
        return this.running === true;
    }

    getTaskStatus() {
        return {
            success: true,
            running: this.running,
            stopRequested: this.stopRequested,
            taskType: this.taskType,
            progress: this.progress || this.createIdleProgress()
        };
    }

    requestStop() {
        if (!this.running) {
            return {
                success: true,
                running: false,
                stopRequested: false,
                message: '当前没有运行中的即梦改尺寸任务'
            };
        }

        this.stopRequested = true;
        this.updateProgress({
            phase: 'stopping',
            currentAction: '正在停止本地队列和即梦结果轮询；已提交到云端的任务可能仍会继续生成'
        });

        return {
            success: true,
            running: true,
            stopRequested: true,
            message: '已发送停止指令：停止本地队列和轮询，不保证取消已提交到即梦云端的任务'
        };
    }

    updateProgress(patch = {}) {
        this.progress = {
            ...(this.progress || this.createIdleProgress()),
            taskType: JIMENG_TASK_TYPE,
            ...patch,
            updatedAt: new Date().toISOString()
        };
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
            const targetPath = this.path.join(this.userDataDir, fileName);
            try {
                if (this.fs.existsSync(targetPath)) {
                    this.fs.rmSync(targetPath, { force: true, recursive: true });
                }
            } catch (error) {
                this.logger.warn && this.logger.warn(`清理即梦浏览器锁文件失败 ${fileName}: ${error.message}`);
            }
        }
    }

    trackPage(page) {
        if (!page) return page;
        this.pages.add(page);
        page.once('close', () => {
            this.pages.delete(page);
            if (this.mainPage === page) {
                this.mainPage = null;
            }
        });
        return page;
    }

    async launchBrowser(headless = false) {
        const requestedHeadless = headless === true;

        if (this.isBrowserActive() && this.currentHeadless !== null && this.currentHeadless !== requestedHeadless && !this.running) {
            await this.closeBrowser();
        }

        if (this.isBrowserActive()) {
            return true;
        }

        this.fs.mkdirSync(this.userDataDir, { recursive: true });
        const modeLabel = requestedHeadless ? '无头模式' : '有头模式';
        this.logger.browser && this.logger.browser(`正在启动即梦自动化浏览器（${modeLabel}）...`);

        const contextOptions = {
            headless: requestedHeadless,
            slowMo: requestedHeadless ? 60 : 120,
            viewport: requestedHeadless ? { width: 1600, height: 950 } : null,
            screen: { width: 1600, height: 950 },
            acceptDownloads: true,
            args: [
                '--window-size=1600,950',
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-blink-features=AutomationControlled'
            ]
        };

        try {
            this.context = await chromium.launchPersistentContext(this.userDataDir, contextOptions);
        } catch (error) {
            if (/lock|singleton|profile|user data directory|正在使用|in use/i.test(error.message)) {
                this.clearStaleProfileLocks();
                this.context = await chromium.launchPersistentContext(this.userDataDir, contextOptions);
            } else {
                throw error;
            }
        }

        this.browser = this.context.browser();
        this.currentHeadless = requestedHeadless;
        this.context.pages().forEach(page => this.trackPage(page));
        this.context.on('page', page => this.trackPage(page));
        this.context.once('close', () => {
            this.context = null;
            this.browser = null;
            this.pages.clear();
            this.mainPage = null;
            this.currentHeadless = null;
        });

        this.logger.browser && this.logger.browser(`✅ 即梦自动化浏览器已启动（${modeLabel}）`);
        return true;
    }

    async closeBrowser() {
        if (this.context) {
            try {
                await this.context.close();
            } catch (error) {
                this.logger.warn && this.logger.warn(`关闭即梦浏览器失败: ${error.message}`);
            }
        }

        this.context = null;
        this.browser = null;
        this.pages.clear();
        this.mainPage = null;
        this.currentHeadless = null;
    }

    async openJimengPage(options = {}) {
        const headless = options.headless === true;
        await this.launchBrowser(headless);

        let page = this.mainPage && !this.mainPage.isClosed() ? this.mainPage : null;
        if (!page) {
            page = this.context.pages().find(item => !item.isClosed() && /jimeng\.jianying\.com/.test(item.url())) || null;
        }
        if (!page) {
            page = await this.context.newPage();
            this.trackPage(page);
        }

        this.mainPage = page;
        await this.gotoJimengImagePage(page);
        return page;
    }

    async gotoJimengImagePage(page) {
        await page.goto(JIMENG_IMAGE_URL, {
            waitUntil: 'domcontentloaded',
            timeout: 60000
        }).catch(() => {});
        await this.waitForPageSettled(page);
        await this.dismissPopups(page);
    }

    async waitForPageSettled(page) {
        if (!page || page.isClosed()) return;
        await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
        await this.sleep(1500);
    }

    async checkStatus(options = {}) {
        try {
            if (!this.isBrowserActive() && options.open !== true) {
                return {
                    success: true,
                    browserRunning: false,
                    pageOpen: false,
                    loggedIn: false,
                    ready: false,
                    url: '',
                    message: '即梦自动化浏览器未打开，请先点击“打开即梦AI”并完成登录'
                };
            }

            const page = options.open === true
                ? await this.openJimengPage({ headless: options.headless === true })
                : (this.getReusablePage() || await this.openJimengPage({ headless: this.currentHeadless === true }));
            const probe = await this.inspectPage(page);
            const loggedIn = probe.loginVisible !== true;
            const ready = loggedIn && (probe.hasPromptInput || probe.fileInputCount > 0 || /ai-tool\/generate/.test(probe.url || ''));

            return {
                success: true,
                browserRunning: this.isBrowserActive(),
                pageOpen: !!page && !page.isClosed(),
                loggedIn,
                ready,
                url: probe.url,
                title: probe.title,
                hasPromptInput: probe.hasPromptInput,
                fileInputCount: probe.fileInputCount,
                message: ready
                    ? '即梦浏览器已打开并检测到可用页面'
                    : (loggedIn
                        ? '即梦已登录，但未检测到完整生图控件，启动任务时会尝试重新进入图片生成页'
                        : '请在已打开的即梦浏览器中登录，登录完成后再检测或启动任务')
            };
        } catch (error) {
            return {
                success: false,
                browserRunning: this.isBrowserActive(),
                loggedIn: false,
                ready: false,
                message: '检测即梦浏览器状态失败: ' + error.message
            };
        }
    }

    getReusablePage() {
        if (this.mainPage && !this.mainPage.isClosed()) {
            return this.mainPage;
        }

        for (const page of this.pages) {
            if (!page.isClosed()) {
                return page;
            }
        }

        return null;
    }

    async inspectPage(page) {
        if (!page || page.isClosed()) {
            return {
                url: '',
                title: '',
                text: '',
                loginVisible: true,
                hasPromptInput: false,
                fileInputCount: 0
            };
        }

        return await page.evaluate(() => {
            const isVisible = (el) => {
                const rect = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return rect.width > 0 &&
                    rect.height > 0 &&
                    style.visibility !== 'hidden' &&
                    style.display !== 'none' &&
                    style.opacity !== '0';
            };

            const visibleTextElements = Array.from(document.querySelectorAll('button, a, [role="button"], div, span'))
                .filter(isVisible)
                .map(el => String(el.innerText || el.textContent || '').trim())
                .filter(Boolean);
            const loginVisible = visibleTextElements.some(text => text === '登录' || text === '立即登录' || /^登录\s*$/.test(text));
            const promptSelectors = [
                'textarea',
                '[contenteditable="true"]',
                '.ProseMirror',
                '[class*="ProseMirror"]'
            ];
            const hasPromptInput = promptSelectors.some(selector => {
                return Array.from(document.querySelectorAll(selector)).some(isVisible);
            });

            return {
                url: window.location.href,
                title: document.title || '',
                text: String(document.body?.innerText || '').slice(0, 1200),
                loginVisible,
                hasPromptInput,
                fileInputCount: document.querySelectorAll('input[type="file"]').length
            };
        }).catch(() => ({
            url: page.url(),
            title: '',
            text: '',
            loginVisible: true,
            hasPromptInput: false,
            fileInputCount: 0
        }));
    }

    async ensureReadyForGeneration(page, options = {}) {
        this.throwIfStopped();
        if (options.navigate !== false) {
            await this.gotoJimengImagePage(page);
        } else {
            await this.waitForPageSettled(page);
            await this.dismissPopups(page);
        }

        let probe = await this.inspectPage(page);
        if (probe.loginVisible) {
            throw new Error('即梦自动化浏览器未登录或登录已过期，请点击“打开即梦AI”并在弹出的浏览器中登录');
        }

        await this.ensureImageGenerationMode(page);
        probe = await this.inspectPage(page);
        if (!probe.hasPromptInput) {
            await this.clickImageGenerationEntry(page).catch(() => {});
            await this.waitForPageSettled(page);
            probe = await this.inspectPage(page);
        }

        if (probe.loginVisible) {
            throw new Error('即梦自动化浏览器未登录或登录已过期，请先登录即梦');
        }

        if (!probe.hasPromptInput) {
            throw new Error('未检测到即梦图片生成输入框，请确认页面停留在“图片生成”功能');
        }

        await this.dismissPopups(page);
        await this.ensureBottomImageGenerationMode(page);
        this.throwIfStopped();
        return true;
    }

    async ensureImageGenerationMode(page) {
        if (await this.isImageGenerationModeReady(page)) {
            return true;
        }

        if (await this.clickImageGenerationCard(page)) {
            await this.waitForPageSettled(page);
            return await this.isImageGenerationModeReady(page);
        }

        if (await this.clickImageGenerationEntry(page)) {
            await this.waitForPageSettled(page);
            return await this.isImageGenerationModeReady(page);
        }

        return false;
    }

    async isImageGenerationModeReady(page) {
        const toolbarText = await this.getBottomGenerationToolbarText(page);
        if (toolbarText.includes('图片生成')) {
            return true;
        }

        return await page.evaluate(() => {
            const text = String(document.body?.innerText || '');
            return text.includes('上传参考图、输入文字，描述你想生成的图片') &&
                text.includes('图片生成') &&
                (text.includes('高清 2K') || text.includes('高清2K') || text.includes('2K'));
        }).catch(() => false);
    }

    async clickImageGenerationCard(page) {
        try {
            const handle = await page.evaluateHandle(() => {
                const isVisible = (el) => {
                    const rect = el.getBoundingClientRect();
                    const style = window.getComputedStyle(el);
                    return rect.width > 0 &&
                        rect.height > 0 &&
                        style.visibility !== 'hidden' &&
                        style.display !== 'none' &&
                        style.opacity !== '0';
                };

                const candidates = Array.from(document.querySelectorAll('button, [role="button"]'))
                    .filter(isVisible)
                    .map(el => ({
                        el,
                        text: String(el.innerText || el.textContent || '').trim(),
                        rect: el.getBoundingClientRect()
                    }))
                    .filter(item => item.text.includes('图片生成') && item.text.includes('即刻想象'))
                    .sort((a, b) => (a.rect.top - b.rect.top) || (a.rect.left - b.rect.left));

                return candidates[0]?.el || null;
            });
            const element = handle.asElement();
            if (element) {
                await element.click({ timeout: 3000 });
                await this.sleep(2000);
                return true;
            }
        } catch (e) {}

        return false;
    }

    async clickImageGenerationEntry(page) {
        const selectors = [
            'button:has-text("图片生成")',
            '[role="button"]:has-text("图片生成")',
            '[class*="option"]:has-text("图片生成")',
            '[class*="card"]:has-text("图片生成")',
            '[class*="type"]:has-text("图片生成")',
            'text=图片生成'
        ];

        for (const selector of selectors) {
            try {
                const locator = page.locator(selector).first();
                if (await locator.isVisible({ timeout: 1500 }).catch(() => false)) {
                    await locator.click({ timeout: 3000 });
                    await this.sleep(1200);
                    return true;
                }
            } catch (e) {}
        }

        return false;
    }

    async dismissPopups(page) {
        const buttonTexts = ['我知道了', '知道了', '稍后再说', '暂不', '跳过', '关闭'];
        for (const text of buttonTexts) {
            try {
                const locator = page.getByText(text, { exact: true }).first();
                if (await locator.isVisible({ timeout: 500 }).catch(() => false)) {
                    await locator.click({ timeout: 1000 }).catch(() => {});
                    await this.sleep(300);
                }
            } catch (e) {}
        }

        await page.evaluate(() => {
            const isVisible = (el) => {
                const rect = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return rect.width > 0 &&
                    rect.height > 0 &&
                    style.visibility !== 'hidden' &&
                    style.display !== 'none' &&
                    style.opacity !== '0';
            };

            const closeCandidates = Array.from(document.querySelectorAll([
                '[class*="close-icon-wrapper"]',
                '[class*="modal"] [class*="close"]',
                '.lv-modal-close',
                'button[aria-label*="close" i]',
                'button[aria-label*="关闭"]'
            ].join(',')))
                .filter(isVisible)
                .map(el => {
                    const rect = el.getBoundingClientRect();
                    return { el, rect, area: rect.width * rect.height };
                })
                .filter(item => item.area <= 3600)
                .sort((a, b) => {
                    const modalA = a.el.closest('[role="dialog"], .lv-modal, [class*="modal"]') ? 1 : 0;
                    const modalB = b.el.closest('[role="dialog"], .lv-modal, [class*="modal"]') ? 1 : 0;
                    if (modalB !== modalA) return modalB - modalA;
                    if (b.rect.top !== a.rect.top) return b.rect.top - a.rect.top;
                    return b.rect.left - a.rect.left;
                });

            if (closeCandidates[0]) {
                closeCandidates[0].el.click();
            }
        }).catch(() => {});

        await page.keyboard.press('Escape').catch(() => {});
    }

    async applyGenerationSettings(page, settings = {}) {
        const normalizedSettings = normalizeJimengResizeConfig({ generationSettings: settings }).generationSettings;

        const modelLabel = normalizedSettings.imageModel === 'image-5-lite' ? '图片5.0 Lite' : normalizedSettings.imageModel;
        const resolutionLabels = normalizedSettings.resolution === '2k'
            ? ['高清 2K', '高清2K', '2K']
            : [String(normalizedSettings.resolution).toUpperCase()];

        await this.dismissPopups(page);
        await this.ensureBottomImageGenerationMode(page);
        await this.selectImageModel(page, modelLabel);
        await this.selectAspectRatioAndResolution(page, normalizedSettings.aspectRatio, resolutionLabels);

        this.logger.info && this.logger.info(`即梦参数目标: ${modelLabel} / ${normalizedSettings.aspectRatio} / ${resolutionLabels[0]} / 每图4张`);
        return normalizedSettings;
    }

    async ensureBottomImageGenerationMode(page) {
        for (let attempt = 0; attempt < 3; attempt += 1) {
            this.throwIfStopped();
            const currentToolbarText = await this.getBottomGenerationToolbarText(page);
            if (currentToolbarText.includes('图片生成')) {
                return true;
            }

            const bottomText = await this.getBottomToolbarText(page);
            if (attempt === 0 && bottomText) {
                this.logger.info && this.logger.info(`即梦底部当前模式: ${bottomText.slice(0, 120)}`);
            }

            const openedModeMenu = await this.clickBottomGenerationModeButton(page);
            if (openedModeMenu) {
                await this.sleep(700);
                const selected = await this.clickImageGenerationModeOption(page);
                if (selected) {
                    await this.sleep(1200);
                    const changedToolbarText = await this.getBottomGenerationToolbarText(page);
                    if (changedToolbarText.includes('图片生成')) {
                        return true;
                    }
                }
                await page.keyboard.press('Escape').catch(() => {});
            }

            if (await this.clickImageGenerationEntry(page)) {
                await this.waitForPageSettled(page);
                const changedToolbarText = await this.getBottomGenerationToolbarText(page);
                if (changedToolbarText.includes('图片生成')) {
                    return true;
                }
            }

            if (attempt === 1) {
                await this.gotoJimengImagePage(page);
            } else {
                await this.sleep(800);
            }
        }

        const finalBottomText = await this.getBottomToolbarText(page);
        throw new Error(`未能将即梦底部模式切回“图片生成”，当前底部状态: ${finalBottomText || '未识别'}`);
    }

    async getBottomToolbarText(page) {
        return await page.evaluate(() => {
            const isVisible = (el) => {
                const rect = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return rect.width > 0 &&
                    rect.height > 0 &&
                    rect.bottom >= 0 &&
                    rect.top <= window.innerHeight &&
                    style.visibility !== 'hidden' &&
                    style.display !== 'none' &&
                    style.opacity !== '0';
            };

            const candidates = Array.from(document.querySelectorAll('div, button, [role="button"]'))
                .filter(isVisible)
                .map(el => {
                    const rect = el.getBoundingClientRect();
                    const text = String(el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
                    const score =
                        (text.includes('上传参考图') ? 50 : 0) +
                        (text.includes('图片生成') ? 40 : 0) +
                        (text.includes('Agent 模式') ? 35 : 0) +
                        (text.includes('Seedance') ? 30 : 0) +
                        (text.includes('使用技能') ? 20 : 0) +
                        (text.includes('0 / 张') ? 10 : 0) +
                        (rect.top / Math.max(window.innerHeight, 1));
                    return {
                        text,
                        rect,
                        area: rect.width * rect.height,
                        score
                    };
                })
                .filter(item =>
                    item.rect.top > window.innerHeight * 0.5 &&
                    item.text &&
                    item.score > 0
                )
                .sort((a, b) => {
                    if (b.score !== a.score) return b.score - a.score;
                    return a.area - b.area;
                });

            return candidates[0]?.text || '';
        }).catch(() => '');
    }

    async getBottomGenerationToolbarText(page) {
        return await page.evaluate(() => {
            const isVisible = (el) => {
                const rect = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return rect.width > 0 &&
                    rect.height > 0 &&
                    rect.bottom >= 0 &&
                    rect.top <= window.innerHeight &&
                    style.visibility !== 'hidden' &&
                    style.display !== 'none' &&
                    style.opacity !== '0';
            };

            const candidates = Array.from(document.querySelectorAll('div, button, [role="button"]'))
                .filter(isVisible)
                .map(el => {
                    const rect = el.getBoundingClientRect();
                    const text = String(el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
                    return {
                        text,
                        y: rect.top,
                        area: rect.width * rect.height
                    };
                })
                .filter(item =>
                    item.y > window.innerHeight * 0.55 &&
                    item.text &&
                    item.text.includes('图片生成') &&
                    (item.text.includes('2K') || item.text.includes('1:1') || item.text.includes('16:9') || item.text.includes('智能比例'))
                )
                .sort((a, b) => b.area - a.area);

            return candidates[0]?.text || '';
        }).catch(() => '');
    }

    async selectImageModel(page, modelLabel) {
        const currentText = await this.getBottomGenerationToolbarText(page);
        if (currentText.includes(modelLabel)) {
            return true;
        }

        const opened = await this.clickBottomModelSelect(page);
        if (!opened) {
            this.logger.warn && this.logger.warn(`未找到即梦模型选择控件，继续使用页面当前模型（目标: ${modelLabel}）`);
            return false;
        }

        const selected = await this.clickPopoverOption(page, modelLabel);
        await this.sleep(500);
        const finalText = await this.getBottomGenerationToolbarText(page);
        if (!selected || !finalText.includes(modelLabel)) {
            this.logger.warn && this.logger.warn(`即梦模型未确认切换为 ${modelLabel}，实际以页面当前模型为准`);
            return false;
        }

        return true;
    }

    async clickBottomModelSelect(page) {
        const handle = await page.evaluateHandle(() => {
            const isVisible = (el) => {
                const rect = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return rect.width > 0 &&
                    rect.height > 0 &&
                    rect.bottom >= 0 &&
                    rect.top <= window.innerHeight &&
                    style.visibility !== 'hidden' &&
                    style.display !== 'none' &&
                    style.opacity !== '0';
            };

            const candidates = Array.from(document.querySelectorAll('.lv-select, [class*="select"], button, [role="button"], div'))
                .filter(isVisible)
                .map(el => {
                    const rect = el.getBoundingClientRect();
                    return {
                        el,
                        text: String(el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim(),
                        rect,
                        area: rect.width * rect.height
                    };
                })
                .filter(item =>
                    item.rect.top > window.innerHeight * 0.55 &&
                    item.text &&
                    /图片\s*\d|Lite|模型/.test(item.text) &&
                    item.area < 30000
                )
                .sort((a, b) => {
                    if (a.rect.top !== b.rect.top) return a.rect.top - b.rect.top;
                    return a.rect.left - b.rect.left;
                });

            return candidates[0]?.el || null;
        }).catch(() => null);

        const element = handle ? handle.asElement() : null;
        if (!element) return false;

        await element.click({ timeout: 3000 }).catch(() => {});
        await this.sleep(700);
        return true;
    }

    async selectAspectRatioAndResolution(page, aspectRatio, resolutionLabels = []) {
        let currentText = await this.getBottomGenerationToolbarText(page);
        const hasAspect = currentText.includes(aspectRatio);
        const hasResolution = resolutionLabels.some(label => currentText.includes(label));

        if (hasAspect && hasResolution) {
            return true;
        }

        if (!await this.clickBottomSizeSettingsButton(page)) {
            throw new Error('未找到即梦底部比例/分辨率设置按钮，无法确认 16:9 参数');
        }

        await this.sleep(700);

        if (!hasAspect) {
            const selectedAspect = await this.clickPopoverOption(page, aspectRatio);
            if (!selectedAspect) {
                throw new Error(`未能在即梦比例菜单中选择 ${aspectRatio}`);
            }
            await this.sleep(500);
        }

        currentText = await this.getBottomGenerationToolbarText(page);
        const resolutionReady = resolutionLabels.some(label => currentText.includes(label));
        if (!resolutionReady && resolutionLabels.length > 0) {
            const selectedResolution = await this.clickPopoverOption(page, resolutionLabels[0]);
            if (!selectedResolution) {
                throw new Error(`未能在即梦分辨率菜单中选择 ${resolutionLabels[0]}`);
            }
            await this.sleep(500);
        }

        currentText = await this.getBottomGenerationToolbarText(page);
        const finalAspect = currentText.includes(aspectRatio);
        const finalResolution = resolutionLabels.length === 0 || resolutionLabels.some(label => currentText.includes(label));
        if (!finalAspect || !finalResolution) {
            throw new Error(`即梦参数确认失败，当前底部参数为: ${currentText || '未识别'}`);
        }

        await page.keyboard.press('Escape').catch(() => {});
        return true;
    }

    async clickBottomSizeSettingsButton(page) {
        const handle = await page.evaluateHandle(() => {
            const isVisible = (el) => {
                const rect = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return rect.width > 0 &&
                    rect.height > 0 &&
                    rect.bottom >= 0 &&
                    rect.top <= window.innerHeight &&
                    style.visibility !== 'hidden' &&
                    style.display !== 'none' &&
                    style.opacity !== '0';
            };

            const candidates = Array.from(document.querySelectorAll('button, [role="button"]'))
                .filter(isVisible)
                .map(el => {
                    const rect = el.getBoundingClientRect();
                    return {
                        el,
                        text: String(el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim(),
                        rect,
                        area: rect.width * rect.height
                    };
                })
                .filter(item =>
                    item.rect.top > window.innerHeight * 0.55 &&
                    item.area < 40000 &&
                    (
                        item.text.includes('2K') ||
                        item.text.includes('1:1') ||
                        item.text.includes('16:9') ||
                        item.text.includes('智能比例') ||
                        item.text.includes('比例')
                    )
                )
                .sort((a, b) => {
                    if (a.rect.top !== b.rect.top) return a.rect.top - b.rect.top;
                    return a.rect.left - b.rect.left;
                });

            return candidates[0]?.el || null;
        }).catch(() => null);

        const element = handle ? handle.asElement() : null;
        if (!element) return false;

        const box = await element.boundingBox().catch(() => null);
        if (box) {
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 6 }).catch(() => {});
            await this.humanDelay(150, 350);
            await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2).catch(async () => {
                await element.click({ timeout: 3000 }).catch(() => {});
            });
        } else {
            await element.click({ timeout: 3000 }).catch(() => {});
        }
        return true;
    }

    async clickBottomGenerationModeButton(page) {
        const handle = await page.evaluateHandle(() => {
            const isVisible = (el) => {
                const rect = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return rect.width > 0 &&
                    rect.height > 0 &&
                    rect.bottom >= 0 &&
                    rect.top <= window.innerHeight &&
                    style.visibility !== 'hidden' &&
                    style.display !== 'none' &&
                    style.opacity !== '0';
            };

            const scoreButton = (text) => {
                if (/^Agent\s*模式/.test(text)) return 120;
                if (text === '视频生成') return 100;
                if (text === '图片生成') return 90;
                if (text.includes('图片生成') && text.length <= 30) return 80;
                if (text === '使用技能') return 40;
                return 0;
            };

            const candidates = Array.from(document.querySelectorAll('button, [role="button"], .lv-select, [class*="select"], div'))
                .filter(isVisible)
                .map(el => {
                    const rect = el.getBoundingClientRect();
                    const text = String(el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
                    return {
                        el,
                        text,
                        rect,
                        area: rect.width * rect.height,
                        score: scoreButton(text)
                    };
                })
                .filter(item =>
                    item.rect.top > window.innerHeight * 0.55 &&
                    item.area > 0 &&
                    item.area < 50000 &&
                    item.score > 0
                )
                .sort((a, b) => {
                    if (b.score !== a.score) return b.score - a.score;
                    if (a.rect.top !== b.rect.top) return b.rect.top - a.rect.top;
                    return a.rect.left - b.rect.left;
                });

            return candidates[0]?.el || null;
        }).catch(() => null);

        const element = handle ? handle.asElement() : null;
        if (!element) return false;

        const box = await element.boundingBox().catch(() => null);
        if (box) {
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 6 }).catch(() => {});
            await this.humanDelay(150, 350);
            await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2).catch(async () => {
                await element.click({ timeout: 3000 }).catch(() => {});
            });
        } else {
            await element.click({ timeout: 3000 }).catch(() => {});
        }
        return true;
    }

    async clickImageGenerationModeOption(page) {
        if (await this.clickPopoverOption(page, '图片生成')) {
            return true;
        }

        const handle = await page.evaluateHandle(() => {
            const isVisible = (el) => {
                const rect = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return rect.width > 0 &&
                    rect.height > 0 &&
                    rect.bottom >= 0 &&
                    rect.top <= window.innerHeight &&
                    style.visibility !== 'hidden' &&
                    style.display !== 'none' &&
                    style.opacity !== '0';
            };

            const candidates = Array.from(document.querySelectorAll('button, [role="button"], div, span, li'))
                .filter(isVisible)
                .map(el => {
                    const rect = el.getBoundingClientRect();
                    const text = String(el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
                    const menuLike = Boolean(el.closest('.lv-popover, [role="tooltip"], [role="listbox"], [class*="dropdown"], [class*="popover"], [class*="menu"]'));
                    return {
                        el,
                        text,
                        rect,
                        area: rect.width * rect.height,
                        menuLike
                    };
                })
                .filter(item =>
                    item.text === '图片生成' &&
                    item.area > 0 &&
                    item.area < 50000 &&
                    item.rect.top > window.innerHeight * 0.25
                )
                .sort((a, b) => {
                    if (a.menuLike !== b.menuLike) return a.menuLike ? -1 : 1;
                    if (a.rect.top !== b.rect.top) return b.rect.top - a.rect.top;
                    return a.area - b.area;
                });

            return candidates[0]?.el || null;
        }).catch(() => null);

        const element = handle ? handle.asElement() : null;
        if (!element) return false;

        const box = await element.boundingBox().catch(() => null);
        if (box) {
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 6 }).catch(() => {});
            await this.humanDelay(150, 350);
            await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2).catch(async () => {
                await element.click({ timeout: 3000 }).catch(() => {});
            });
        } else {
            await element.click({ timeout: 3000 }).catch(() => {});
        }
        return true;
    }

    async clickPopoverOption(page, label) {
        const safeLabel = String(label || '').trim();
        if (!safeLabel) return false;

        const handle = await page.evaluateHandle((targetText) => {
            const isVisible = (el) => {
                const rect = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return rect.width > 0 &&
                    rect.height > 0 &&
                    rect.bottom >= 0 &&
                    rect.top <= window.innerHeight &&
                    style.visibility !== 'hidden' &&
                    style.display !== 'none' &&
                    style.opacity !== '0';
            };

            const candidates = Array.from(document.querySelectorAll('button, [role="button"], div, span, li'))
                .filter(isVisible)
                .map(el => {
                    const rect = el.getBoundingClientRect();
                    const text = String(el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
                    const insidePopover = Boolean(el.closest('.lv-popover, [role="tooltip"], [role="listbox"], [class*="dropdown"], [class*="popover"]'));
                    return {
                        el,
                        text,
                        rect,
                        area: rect.width * rect.height,
                        insidePopover
                    };
                })
                .filter(item =>
                    item.text === targetText &&
                    item.insidePopover
                )
                .sort((a, b) => {
                    if (a.insidePopover !== b.insidePopover) return a.insidePopover ? -1 : 1;
                    if (b.area !== a.area) return b.area - a.area;
                    if (a.rect.top !== b.rect.top) return a.rect.top - b.rect.top;
                    return a.rect.left - b.rect.left;
                });

            return candidates[0]?.el || null;
        }, safeLabel).catch(() => null);

        const element = handle ? handle.asElement() : null;
        if (!element) return false;

        const box = await element.boundingBox().catch(() => null);
        if (box) {
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 6 }).catch(() => {});
            await this.humanDelay(150, 350);
            await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2).catch(async () => {
                await element.click({ timeout: 3000 }).catch(() => {});
            });
        } else {
            await element.click({ timeout: 3000 }).catch(() => {});
        }
        return true;
    }

    async clickOptionIfPresent(page, labels = [], openLabels = []) {
        for (const label of labels) {
            if (await this.clickVisibleText(page, label)) {
                await this.sleep(500);
                return true;
            }
        }

        for (const opener of openLabels) {
            if (await this.clickVisibleText(page, opener)) {
                await this.sleep(600);
                for (const label of labels) {
                    if (await this.clickVisibleText(page, label)) {
                        await this.sleep(500);
                        return true;
                    }
                }
            }
        }

        return false;
    }

    async clickVisibleText(page, text) {
        const safeText = String(text || '').trim();
        if (!safeText) return false;

        try {
            const locator = page.getByText(safeText, { exact: true }).first();
            if (await locator.isVisible({ timeout: 800 }).catch(() => false)) {
                await this.humanDelay(250, 700);
                await locator.click({ timeout: 1500 });
                await this.humanDelay(500, 1000);
                return true;
            }
        } catch (e) {}

        try {
            const handle = await page.evaluateHandle((targetText) => {
                const isVisible = (el) => {
                    const rect = el.getBoundingClientRect();
                    const style = window.getComputedStyle(el);
                    return rect.width > 0 &&
                        rect.height > 0 &&
                        style.visibility !== 'hidden' &&
                        style.display !== 'none' &&
                        style.opacity !== '0';
                };

                const candidates = Array.from(document.querySelectorAll('button, [role="button"], div, span'))
                    .filter(isVisible)
                    .filter(el => String(el.innerText || el.textContent || '').trim() === targetText)
                    .sort((a, b) => {
                        const ar = a.getBoundingClientRect();
                        const br = b.getBoundingClientRect();
                        return (ar.width * ar.height) - (br.width * br.height);
                    });

                return candidates[0] || null;
            }, safeText);
            const element = handle.asElement();
            if (element) {
                await this.humanDelay(250, 700);
                await element.click({ timeout: 1500 });
                await this.humanDelay(500, 1000);
                return true;
            }
        } catch (e) {}

        return false;
    }

    appendOutputCountPrompt(prompt) {
        const promptText = String(prompt || '').trim();
        if (!promptText) return '';
        if (/需要生成\s*4\s*张/.test(promptText)) {
            return promptText;
        }

        const separator = /[。！？!?；;]$/.test(promptText) ? '' : '。';
        return `${promptText}${separator}${OUTPUT_COUNT_PROMPT}`;
    }

    async uploadReferenceImage(page, imagePath) {
        this.throwIfStopped();
        const imageName = this.path.basename(imagePath);
        const beforeKeys = await this.getImageKeys(page);
        let inputs = await page.$$('input[type="file"]');

        if (inputs.length === 0) {
            await this.clickUploadEntry(page);
            await this.humanDelay(900, 1600);
            inputs = await page.$$('input[type="file"]');
        }

        if (inputs.length === 0) {
            throw new Error('未找到即梦图片上传入口');
        }

        for (const input of inputs) {
            this.throwIfStopped();
            try {
                await this.humanDelay(600, 1200);
                await input.setInputFiles(imagePath);
                this.logger.info && this.logger.info(`即梦已选择输入图: ${imageName}`);
                const uploaded = await this.waitForUploadPreview(page, beforeKeys, imageName);
                if (uploaded) {
                    await this.humanDelay(1200, 2200);
                    return true;
                }
            } catch (error) {
                this.logger.warn && this.logger.warn(`尝试上传到即梦输入框失败: ${error.message}`);
            }
        }

        throw new Error('上传输入图到即梦失败，请确认页面上传入口可用');
    }

    async clickUploadEntry(page) {
        const labels = ['上传参考', '上传图片', '参考图', '图片', '添加图片'];
        for (const label of labels) {
            if (await this.clickVisibleText(page, label)) {
                return true;
            }
        }
        return false;
    }

    async waitForUploadPreview(page, beforeKeys = [], imageName = '') {
        const deadline = Date.now() + 18000;
        const known = new Set(beforeKeys);

        while (Date.now() < deadline) {
            this.throwIfStopped();
            const keys = await this.getImageKeys(page);
            const hasNewImage = keys.some(key => key && !known.has(key));
            if (hasNewImage) {
                await this.sleep(1500);
                return true;
            }

            const nameVisible = await page.evaluate((name) => {
                return Boolean(name) && String(document.body?.innerText || '').includes(name);
            }, imageName).catch(() => false);
            if (nameVisible) {
                await this.sleep(1500);
                return true;
            }

            await this.sleep(1000);
        }

        return false;
    }

    async inputPrompt(page, prompt) {
        this.throwIfStopped();
        const promptText = this.appendOutputCountPrompt(prompt);
        if (!promptText) {
            throw new Error('提示词为空');
        }

        const selectors = [
            '.ProseMirror[contenteditable="true"]',
            '[contenteditable="true"]',
            'textarea',
            'div.tiptap'
        ];

        for (const selector of selectors) {
            try {
                const locator = page.locator(selector).first();
                if (await locator.isVisible({ timeout: 1500 }).catch(() => false)) {
                    await this.humanDelay(500, 1000);
                    await locator.click({ timeout: 3000 });
                    await this.humanDelay(200, 500);
                    await page.keyboard.press('Control+A').catch(() => {});
                    await this.humanDelay(120, 300);
                    await page.keyboard.press('Backspace').catch(() => {});
                    await this.humanDelay(300, 700);
                    await page.keyboard.type(promptText, { delay: 22 }).catch(async () => {
                        const chunkSize = 18;
                        for (let index = 0; index < promptText.length; index += chunkSize) {
                            await page.keyboard.insertText(promptText.slice(index, index + chunkSize));
                            await this.humanDelay(80, 180);
                        }
                    });
                    await this.humanDelay(800, 1400);
                    return true;
                }
            } catch (e) {}
        }

        throw new Error('未找到即梦提示词输入框');
    }

    async getImageKeys(page) {
        return await page.evaluate(() => {
            const normalizeSrc = (src) => {
                let value = String(src || '').split('#')[0];
                for (let i = 0; i < 3; i++) {
                    try {
                        const decoded = decodeURIComponent(value);
                        if (decoded === value) break;
                        value = decoded;
                    } catch (e) {
                        break;
                    }
                }
                return value;
            };

            const extractBackgroundUrl = (el) => {
                const style = window.getComputedStyle(el);
                const value = style.backgroundImage || '';
                const match = value.match(/url\((["']?)(.*?)\1\)/);
                return match ? match[2] : '';
            };

            const imageKeys = Array.from(document.querySelectorAll('img'))
                .map(img => normalizeSrc(img.currentSrc || img.src || ''))
                .filter(Boolean);

            const backgroundKeys = Array.from(document.querySelectorAll('div, [role="button"], span'))
                .map(el => normalizeSrc(extractBackgroundUrl(el)))
                .filter(Boolean);

            return Array.from(new Set([...imageKeys, ...backgroundKeys]));
        }).catch(() => []);
    }

    async clickGenerateButton(page) {
        this.throwIfStopped();
        const handle = await page.evaluateHandle(() => {
            const isVisible = (el) => {
                const rect = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return rect.width > 0 &&
                    rect.height > 0 &&
                    style.visibility !== 'hidden' &&
                    style.display !== 'none' &&
                    style.opacity !== '0';
            };

            const isDisabled = (el) => {
                return el.disabled === true ||
                    el.getAttribute('aria-disabled') === 'true' ||
                    el.className?.toString().includes('disabled');
            };

            const scoreButton = (el) => {
                const text = String(el.innerText || el.textContent || el.getAttribute('aria-label') || '').trim();
                if (!text && el.querySelector('svg')) return 30;
                if (/^(图片生成|视频生成|智能美学|模型|比例|分辨率)$/.test(text)) return -100;
                if (/^(生成|开始生成|立即生成|生成图片)$/.test(text)) return 120;
                if (/生成/.test(text) && text.length <= 12) return 90;
                if (/即刻想象|提交|发送/.test(text) && text.length <= 20) return 75;
                return -10;
            };

            const candidates = Array.from(document.querySelectorAll('button, [role="button"]'))
                .filter(el => isVisible(el) && !isDisabled(el))
                .map((el, index) => {
                    const rect = el.getBoundingClientRect();
                    return {
                        el,
                        index,
                        score: scoreButton(el),
                        y: rect.top,
                        x: rect.left,
                        area: rect.width * rect.height
                    };
                })
                .filter(item => item.score > 0)
                .sort((a, b) => {
                    if (b.score !== a.score) return b.score - a.score;
                    if (b.y !== a.y) return b.y - a.y;
                    return b.x - a.x;
                });

            return candidates[0]?.el || null;
        });

        const button = handle.asElement();
        if (button) {
            const box = await button.boundingBox().catch(() => null);
            if (box) {
                await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 8 }).catch(() => {});
                await this.humanDelay(300, 800);
            }
            await button.click({ timeout: 5000 });
            await this.humanDelay(1200, 2200);
            return true;
        }

        await this.humanDelay(500, 1000);
        await page.keyboard.press('Control+Enter').catch(() => {});
        await this.humanDelay(1200, 2200);
        return true;
    }

    async findNewOutputCandidates(page, beforeKeys = []) {
        return await page.evaluate((knownKeys) => {
            const normalizeSrc = (src) => {
                let value = String(src || '').split('#')[0];
                for (let i = 0; i < 3; i++) {
                    try {
                        const decoded = decodeURIComponent(value);
                        if (decoded === value) break;
                        value = decoded;
                    } catch (e) {
                        break;
                    }
                }
                return value;
            };

            const normalizeComparableSrc = (src) => {
                const value = normalizeSrc(src);
                try {
                    const url = new URL(value, window.location.href);
                    return url.origin + url.pathname + url.search;
                } catch (e) {
                    return value;
                }
            };

            const known = new Set();
            for (const key of knownKeys || []) {
                const normalized = normalizeComparableSrc(key);
                if (normalized) known.add(normalized);
            }

            const isVisible = (el) => {
                const rect = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return rect.width > 0 &&
                    rect.height > 0 &&
                    style.visibility !== 'hidden' &&
                    style.display !== 'none' &&
                    style.opacity !== '0';
            };

            const isInsideComposer = (img) => {
                if (img.closest('[contenteditable="true"], textarea')) {
                    return true;
                }

                let node = img;
                for (let depth = 0; node && depth < 8; depth += 1, node = node.parentElement) {
                    const rect = node.getBoundingClientRect();
                    const text = String(node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
                    if (
                        rect.top > window.innerHeight * 0.55 &&
                        (
                            text.includes('上传参考图') ||
                            text.includes('输入文字') ||
                            text.includes('0 / 张') ||
                            text.includes('需要生成4张')
                        )
                    ) {
                        return true;
                    }
                }

                return false;
            };

            const getCardRect = (img) => {
                const card = img.closest('[class*="image-card"], [role="button"], [class*="card"]') || img;
                const rect = card.getBoundingClientRect();
                return {
                    x: rect.left,
                    y: rect.top,
                    width: rect.width,
                    height: rect.height,
                    area: rect.width * rect.height
                };
            };

            const extractBackgroundUrl = (el) => {
                const style = window.getComputedStyle(el);
                const value = style.backgroundImage || '';
                const match = value.match(/url\((["']?)(.*?)\1\)/);
                return match ? match[2] : '';
            };

            const visualElements = [
                ...Array.from(document.querySelectorAll('img')).map((el, index) => ({
                    el,
                    index,
                    kind: 'img',
                    rawSrc: el.currentSrc || el.src || '',
                    naturalWidth: el.naturalWidth || 0,
                    naturalHeight: el.naturalHeight || 0
                })),
                ...Array.from(document.querySelectorAll('div, [role="button"], span'))
                    .map((el, index) => ({
                        el,
                        index,
                        kind: 'background',
                        rawSrc: extractBackgroundUrl(el),
                        naturalWidth: 0,
                        naturalHeight: 0
                    }))
                    .filter(item => item.rawSrc)
            ];

            const candidates = visualElements
                .map((visual, index) => {
                    const el = visual.el;
                    const rect = el.getBoundingClientRect();
                    const src = normalizeComparableSrc(visual.rawSrc);
                    const naturalWidth = visual.naturalWidth || 0;
                    const naturalHeight = visual.naturalHeight || 0;
                    const naturalArea = naturalWidth * naturalHeight;
                    const area = rect.width * rect.height;
                    const lowerSrc = src.toLowerCase();
                    const isIcon = /logo|avatar|icon|emoji|sprite/.test(lowerSrc) ||
                        lowerSrc.startsWith('data:image/svg') ||
                        lowerSrc.startsWith('data:image/gif') ||
                        /\.gif($|[?#])/.test(lowerSrc);
                    const cardRect = getCardRect(el);
                    return {
                        index,
                        domIndex: visual.index,
                        kind: visual.kind,
                        src,
                        width: rect.width,
                        height: rect.height,
                        x: rect.left,
                        y: rect.top,
                        naturalWidth,
                        naturalHeight,
                        area,
                        naturalArea,
                        alt: visual.kind === 'img' ? (el.alt || '') : '',
                        visible: isVisible(el),
                        isNew: src && !known.has(src),
                        isIcon,
                        inComposer: isInsideComposer(el),
                        cardRect
                    };
                })
                .filter(item =>
                    item.visible &&
                    item.isNew &&
                    !item.isIcon &&
                    !item.inComposer &&
                    item.src &&
                    item.width >= 160 &&
                    item.height >= 90 &&
                    item.y < window.innerHeight * 0.82 &&
                    (item.naturalArea >= 300000 || item.area >= 30000)
                )
                .sort((a, b) => {
                    if (a.y !== b.y) return a.y - b.y;
                    if (a.x !== b.x) return a.x - b.x;
                    if (b.naturalArea !== a.naturalArea) return b.naturalArea - a.naturalArea;
                    if (b.area !== a.area) return b.area - a.area;
                    return b.index - a.index;
                });

            const unique = [];
            const seen = new Set();
            for (const candidate of candidates) {
                if (seen.has(candidate.src)) continue;
                seen.add(candidate.src);
                unique.push(candidate);
            }

            return unique;
        }, beforeKeys).catch(() => null);
    }

    async findNewOutputCandidate(page, beforeKeys = []) {
        const candidates = await this.findNewOutputCandidates(page, beforeKeys);
        return Array.isArray(candidates) && candidates.length ? candidates[0] : null;
    }

    async detectPageError(page) {
        const text = await page.evaluate(() => String(document.body?.innerText || '').slice(0, 3000)).catch(() => '');
        const errorPatterns = [
            /积分不足|余额不足|点数不足|额度不足/,
            /生成失败|任务失败|处理失败/,
            /内容违规|审核不通过|无法生成/,
            /登录已过期|请登录/
        ];

        const match = errorPatterns.find(pattern => pattern.test(text));
        return match ? match.source : '';
    }

    async waitForGeneratedImages(page, beforeKeys = [], options = {}) {
        const timeoutMs = clampNumber(options.pollTimeoutSeconds, 900, 120, 3600) * 1000;
        const expectedCount = clampNumber(options.outputQuantity, JIMENG_OUTPUT_QUANTITY, 1, JIMENG_OUTPUT_QUANTITY);
        const deadline = Date.now() + timeoutMs;
        let lastLogAt = 0;

        while (Date.now() < deadline) {
            this.throwIfStopped();

            const candidates = await this.findNewOutputCandidates(page, beforeKeys);
            const count = Array.isArray(candidates) ? candidates.length : 0;
            if (count >= expectedCount) {
                return candidates.slice(0, expectedCount);
            }

            const pageError = await this.detectPageError(page);
            if (pageError) {
                throw new Error('即梦页面提示异常：' + pageError);
            }

            if (Date.now() - lastLogAt > 30000) {
                lastLogAt = Date.now();
                this.logger.info && this.logger.info(`即梦生成中，已识别 ${count}/${expectedCount} 张输出图，继续等待...`);
            }

            await this.sleep(3000);
        }

        throw new Error('等待即梦图片生成超时');
    }

    async waitForGeneratedImage(page, beforeKeys = [], options = {}) {
        const candidates = await this.waitForGeneratedImages(page, beforeKeys, {
            ...options,
            outputQuantity: 1
        });
        return candidates[0] || null;
    }

    async validateSavedImage(savePath, settings = {}) {
        if (!this.fs.existsSync(savePath)) {
            throw new Error('文件未保存成功');
        }

        const stats = this.fs.statSync(savePath);
        if (!stats || stats.size < 100 * 1024) {
            throw new Error('保存文件过小，疑似不是即梦成品原图');
        }

        const imageBuffer = this.fs.readFileSync(savePath);
        const image = await loadImage(imageBuffer);
        const width = image.width || 0;
        const height = image.height || 0;
        const longSide = Math.max(width, height);
        const shortSide = Math.min(width, height);
        if (longSide < 1500 || shortSide < 800) {
            throw new Error(`保存图片尺寸异常 ${width}x${height}，疑似缩略图或输入框截图`);
        }

        const expectedRatio = parseAspectRatio(settings.aspectRatio);
        if (expectedRatio > 0 && height > 0) {
            const actualRatio = width / height;
            const delta = Math.abs(actualRatio - expectedRatio) / expectedRatio;
            if (delta > 0.08) {
                throw new Error(`保存图片比例异常 ${width}x${height}，目标比例 ${settings.aspectRatio}`);
            }
        }

        return {
            width,
            height,
            sizeBytes: stats.size
        };
    }

    async saveGeneratedImages(page, candidates, imagePath, imageIndex, config, runId, settings = {}) {
        const safeCandidates = Array.isArray(candidates) ? candidates : [];
        if (safeCandidates.length < JIMENG_OUTPUT_QUANTITY) {
            throw new Error(`即梦本次只识别到 ${safeCandidates.length}/${JIMENG_OUTPUT_QUANTITY} 张成品图，未保存，避免误存输入框或参考图`);
        }

        const saved = [];
        for (let index = 0; index < JIMENG_OUTPUT_QUANTITY; index += 1) {
            const savePath = await this.saveCandidateImage(
                page,
                safeCandidates[index],
                imagePath,
                imageIndex,
                index + 1,
                config,
                runId,
                settings
            );
            saved.push(savePath);
            await this.humanDelay(700, 1400);
        }

        return saved;
    }

    async saveCandidateImage(page, candidate, imagePath, imageIndex, outputIndex, config, runId, settings = {}) {
        const outputFolder = config.outputFolder;
        this.fs.mkdirSync(outputFolder, { recursive: true });

        const sourceName = sanitizeFileNamePart(this.path.basename(imagePath, this.path.extname(imagePath)), 50);
        const ratioPart = Array.isArray(settings.aspectRatios) && settings.aspectRatios.length > 1 && settings.aspectRatio
            ? `_${sanitizeFileNamePart(String(settings.aspectRatio).replace(/[:：]/g, 'x'), 20)}`
            : '';
        const baseName = `jimeng_resize_${runId}_${padNumber(imageIndex, 3)}_${padNumber(outputIndex, 2)}${ratioPart}_${sourceName}`;
        const directUrl = this.normalizeImageUrl(candidate.src, page.url());
        const element = await this.findImageElementByCandidate(page, candidate);

        if (element) {
            const downloadedPath = await this.downloadCandidateImage(page, element, baseName, outputFolder).catch(error => {
                this.logger.warn && this.logger.warn(`点击即梦下载按钮保存失败: ${error.message}`);
                return '';
            });
            if (downloadedPath) {
                try {
                    await this.validateSavedImage(downloadedPath, settings);
                } catch (error) {
                    this.fs.rmSync(downloadedPath, { force: true });
                    throw error;
                }
                return downloadedPath;
            }
        }

        if (/^data:image\//i.test(directUrl)) {
            const parsed = directUrl.match(/^data:(image\/[^;]+);base64,(.+)$/i);
            if (parsed) {
                const ext = resolveImageExtension(parsed[1], '');
                const savePath = this.path.join(outputFolder, `${baseName}${ext}`);
                this.fs.writeFileSync(savePath, Buffer.from(parsed[2], 'base64'));
                await this.validateSavedImage(savePath, settings);
                return savePath;
            }
        }

        if (/^https?:\/\//i.test(directUrl)) {
            try {
                const response = await page.context().request.get(directUrl, { timeout: 60000 });
                if (response.ok()) {
                    const buffer = await response.body();
                    if (buffer && buffer.length > 1024) {
                        const ext = resolveImageExtension(response.headers()['content-type'], directUrl);
                        const savePath = this.path.join(outputFolder, `${baseName}${ext}`);
                        this.fs.writeFileSync(savePath, buffer);
                        try {
                            await this.validateSavedImage(savePath, settings);
                        } catch (error) {
                            this.fs.rmSync(savePath, { force: true });
                            throw error;
                        }
                        return savePath;
                    }
                }
            } catch (error) {
                this.logger.warn && this.logger.warn(`直接下载即梦输出图失败: ${error.message}`);
            }
        }

        throw new Error('即梦成品图下载失败，已阻止保存输入框截图或缩略图');
    }

    async downloadCandidateImage(page, element, baseName, outputFolder) {
        await element.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
        const box = await element.boundingBox().catch(() => null);
        if (!box || box.width <= 0 || box.height <= 0) {
            return '';
        }

        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await this.sleep(800);

        const buttonBox = await page.evaluate((targetBox) => {
            const isVisible = (el) => {
                const rect = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return rect.width > 0 &&
                    rect.height > 0 &&
                    rect.bottom >= 0 &&
                    rect.top <= window.innerHeight &&
                    style.visibility !== 'hidden' &&
                    style.display !== 'none' &&
                    style.opacity !== '0';
            };

            const candidates = Array.from(document.querySelectorAll('[class*="action-button"], [class*="operation-button"], button, [role="button"]'))
                .filter(isVisible)
                .map(el => {
                    const rect = el.getBoundingClientRect();
                    return {
                        x: rect.left,
                        y: rect.top,
                        width: rect.width,
                        height: rect.height,
                        area: rect.width * rect.height,
                        text: String(el.innerText || el.textContent || el.getAttribute('aria-label') || el.getAttribute('title') || '').replace(/\s+/g, ' ').trim(),
                        className: String(el.className || '')
                    };
                })
                .filter(item =>
                    item.area > 0 &&
                    item.area <= 2000 &&
                    item.x >= targetBox.x - 4 &&
                    item.x <= targetBox.x + targetBox.width + 4 &&
                    item.y >= targetBox.y - 4 &&
                    item.y <= targetBox.y + Math.max(70, targetBox.height * 0.45)
                )
                .sort((a, b) => {
                    if (a.y !== b.y) return a.y - b.y;
                    return a.x - b.x;
                });

            return candidates[0] || null;
        }, box).catch(() => null);

        if (!buttonBox) {
            return '';
        }

        const downloadPromise = page.waitForEvent('download', { timeout: 30000 }).catch(() => null);
        await page.mouse.click(buttonBox.x + buttonBox.width / 2, buttonBox.y + buttonBox.height / 2);
        const download = await downloadPromise;
        if (!download) {
            return '';
        }

        const suggestedFileName = download.suggestedFilename();
        const ext = resolveDownloadExtension(suggestedFileName);
        const savePath = this.path.join(outputFolder, `${baseName}${ext}`);
        await download.saveAs(savePath);

        const stats = this.fs.existsSync(savePath) ? this.fs.statSync(savePath) : null;
        if (!stats || stats.size < 1024) {
            if (this.fs.existsSync(savePath)) {
                this.fs.rmSync(savePath, { force: true });
            }
            return '';
        }

        this.logger.info && this.logger.info(`即梦原图下载保存成功: ${this.path.basename(savePath)} (${(stats.size / 1024).toFixed(2)} KB)`);
        return savePath;
    }

    normalizeImageUrl(src, baseUrl) {
        const value = String(src || '').trim();
        if (!value) return '';
        if (value.startsWith('//')) return 'https:' + value;
        if (/^(https?:|data:|blob:)/i.test(value)) return value;
        try {
            return new URL(value, baseUrl).href;
        } catch (e) {
            return value;
        }
    }

    async findImageElementByCandidate(page, candidate) {
        const handle = await page.evaluateHandle((target) => {
            const targetSrc = String(target.src || '').split('#')[0];
            const targetCenter = {
                x: Number(target.x || target.cardRect?.x || 0) + Number(target.width || target.cardRect?.width || 0) / 2,
                y: Number(target.y || target.cardRect?.y || 0) + Number(target.height || target.cardRect?.height || 0) / 2
            };
            const extractBackgroundUrl = (el) => {
                const style = window.getComputedStyle(el);
                const value = style.backgroundImage || '';
                const match = value.match(/url\((["']?)(.*?)\1\)/);
                return match ? match[2] : '';
            };
            const normalizeSrc = (src) => {
                let value = String(src || '').split('#')[0];
                for (let i = 0; i < 3; i++) {
                    try {
                        const decoded = decodeURIComponent(value);
                        if (decoded === value) break;
                        value = decoded;
                    } catch (e) {
                        break;
                    }
                }
                try {
                    const url = new URL(value, window.location.href);
                    return url.origin + url.pathname + url.search;
                } catch (e) {
                    return value;
                }
            };

            const isVisible = (el) => {
                const rect = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return rect.width > 0 &&
                    rect.height > 0 &&
                    rect.bottom >= 0 &&
                    rect.top <= window.innerHeight &&
                    style.visibility !== 'hidden' &&
                    style.display !== 'none' &&
                    style.opacity !== '0';
            };

            const visualElements = [
                ...Array.from(document.querySelectorAll('img')).map((el, index) => ({
                    el,
                    index,
                    rawSrc: el.currentSrc || el.src || ''
                })),
                ...Array.from(document.querySelectorAll('div, [role="button"], span'))
                    .map((el, index) => ({
                        el,
                        index,
                        rawSrc: extractBackgroundUrl(el)
                    }))
                    .filter(item => item.rawSrc)
            ];

            const scored = visualElements
                .filter(item => isVisible(item.el))
                .map((item, index) => {
                    const rect = item.el.getBoundingClientRect();
                    const center = {
                        x: rect.left + rect.width / 2,
                        y: rect.top + rect.height / 2
                    };
                    const src = normalizeSrc(item.rawSrc);
                    const distance = Math.hypot(center.x - targetCenter.x, center.y - targetCenter.y);
                    const srcMatches = src && targetSrc && src === targetSrc;
                    return {
                        el: item.el,
                        index,
                        domIndex: item.index,
                        distance,
                        srcMatches,
                        area: rect.width * rect.height
                    };
                })
                .filter(item =>
                    item.area >= 25000 &&
                    (
                        item.distance <= 80 ||
                        (item.srcMatches && item.distance <= 260)
                    )
                )
                .sort((a, b) => {
                    if (a.srcMatches !== b.srcMatches) return a.srcMatches ? -1 : 1;
                    if (a.distance !== b.distance) return a.distance - b.distance;
                    return a.index - b.index;
                });

            return scored[0]?.el || null;
        }, candidate).catch(() => null);

        return handle ? handle.asElement() : null;
    }

    async captureErrorScreenshot(page, imageIndex, stage = 'failed') {
        if (!page || page.isClosed()) return '';
        try {
            const dir = this.path.join(this.ROOT_DIR, 'runtime', 'jimeng-error-screenshots');
            this.fs.mkdirSync(dir, { recursive: true });
            const fileName = `jimeng_${stage}_${padNumber(imageIndex, 3)}_${this.formatDateTimeForFile()}.png`;
            const screenshotPath = this.path.join(dir, fileName);
            await page.screenshot({ path: screenshotPath, fullPage: true, timeout: 15000 });
            return screenshotPath;
        } catch (e) {
            return '';
        }
    }

    async generateForImageOnPage(page, imagePath, imageIndex, config, runId, options = {}) {
        const settings = config.generationSettings || DEFAULT_JIMENG_RESIZE_CONFIG.generationSettings;
        const imageName = this.path.basename(imagePath);

        try {
            this.throwIfStopped();
            await this.ensureReadyForGeneration(page, {
                navigate: options.navigate !== false
            });
            await this.applyGenerationSettings(page, settings);
            await this.uploadReferenceImage(page, imagePath);
            await this.inputPrompt(page, config.promptTemplate);
            const beforeImageKeys = await this.getImageKeys(page);
            await this.clickGenerateButton(page);
            this.logger.info && this.logger.info(`即梦已提交生成任务: ${imageName}`);
            const candidates = await this.waitForGeneratedImages(page, beforeImageKeys, {
                ...settings,
                outputQuantity: JIMENG_OUTPUT_QUANTITY
            });
            const savePaths = await this.saveGeneratedImages(page, candidates, imagePath, imageIndex, config, runId, settings);
            return {
                success: true,
                savePath: savePaths[0] || null,
                savePaths,
                savedCount: savePaths.length,
                message: `即梦改尺寸生成并保存成功，保存 ${savePaths.length} 张`
            };
        } catch (error) {
            const screenshotPath = await this.captureErrorScreenshot(page, imageIndex, 'failed');
            return {
                success: false,
                savePath: null,
                screenshotPath,
                message: error.message
            };
        }
    }

    async generateForImage(imagePath, imageIndex, config, runId) {
        let page = this.getReusablePage();
        if (!page) {
            page = await this.context.newPage();
            this.trackPage(page);
        }

        return await this.generateForImageOnPage(page, imagePath, imageIndex, config, runId, {
            navigate: true
        });
    }

    startResizeBatch(config, imageFiles = [], options = {}) {
        if (this.running) {
            return {
                success: false,
                message: '当前已有即梦改尺寸任务正在运行，请稍后再试'
            };
        }

        const resizeConfig = normalizeJimengResizeConfig(config, DEFAULT_JIMENG_RESIZE_CONFIG);
        const safeImageFiles = Array.isArray(imageFiles) ? [...imageFiles] : [];
        const aspectRatios = Array.isArray(resizeConfig.generationSettings.aspectRatios) && resizeConfig.generationSettings.aspectRatios.length
            ? resizeConfig.generationSettings.aspectRatios
            : [resizeConfig.generationSettings.aspectRatio];
        const concurrency = 1;
        const buildJobs = () => {
            const jobs = [];
            safeImageFiles.forEach((imagePath, imageIndex) => {
                aspectRatios.forEach((aspectRatio, ratioIndex) => {
                    jobs.push({
                        imagePath,
                        imageName: this.path.basename(String(imagePath || '')),
                        imageIndex,
                        aspectRatio,
                        ratioIndex,
                        jobIndex: jobs.length + 1
                    });
                });
            });
            return jobs;
        };
        const allJobs = Array.isArray(options.jobs) && options.jobs.length ? options.jobs : buildJobs();
        const resumeBase = options.resumeBase && typeof options.resumeBase === 'object' ? options.resumeBase : null;
        const resumeNextIndex = Math.max(0, Math.min(allJobs.length, Number(options.resumeNextIndex) || 0));
        const runId = String(options.runId || '').trim() || this.formatDateTimeForFile();
        const totalJobs = resumeBase ? (Number(resumeBase.total) || allJobs.length) : allJobs.length;
        const totalImages = resumeBase ? (Number(resumeBase.totalImages) || safeImageFiles.length) : safeImageFiles.length;
        const totalAspectRatios = resumeBase ? (Number(resumeBase.totalAspectRatios) || aspectRatios.length) : aspectRatios.length;
        const baseCompleted = resumeBase ? (Number(resumeBase.completed) || 0) : 0;
        const baseSuccess = resumeBase ? (Number(resumeBase.success) || 0) : 0;
        const baseFailed = resumeBase ? (Number(resumeBase.failed) || 0) : 0;
        const baseSaved = resumeBase ? (Number(resumeBase.saved) || 0) : 0;
        const outputTotal = Math.max(Number(resumeBase && resumeBase.outputTotal) || 0, totalJobs * JIMENG_OUTPUT_QUANTITY);
        const startedAt = new Date().toISOString();

        this.running = true;
        this.stopRequested = false;
        this.taskType = JIMENG_TASK_TYPE;
        this.updateProgress({
            phase: 'queued',
            total: totalJobs,
            totalImages,
            totalAspectRatios,
            currentIndex: baseCompleted,
            completed: baseCompleted,
            success: baseSuccess,
            failed: baseFailed,
            saved: baseSaved,
            outputTotal,
            active: 0,
            queued: Math.max(0, totalJobs - resumeNextIndex),
            concurrency,
            browserMode: resizeConfig.browserMode,
            currentName: '',
            currentAction: resumeBase
                ? `即梦批量改尺寸继续任务已排队，准备从 ${baseCompleted}/${totalJobs} 继续...`
                : '即梦批量改尺寸任务已排队，准备启动浏览器...',
            startedAt
        });

        if (typeof options.onSetResumeState === 'function') {
            options.onSetResumeState({
                provider: 'jimeng',
                runId,
                phase: 'queued',
                inputFolder: resizeConfig.inputFolder,
                outputFolder: resizeConfig.outputFolder,
                browserMode: resizeConfig.browserMode,
                promptTemplate: resizeConfig.promptTemplate,
                generationSettings: resizeConfig.generationSettings,
                jobs: allJobs,
                total: totalJobs,
                totalImages,
                totalAspectRatios,
                nextIndex: resumeNextIndex,
                currentIndex: baseCompleted,
                completed: baseCompleted,
                success: baseSuccess,
                failed: baseFailed,
                saved: baseSaved,
                outputTotal,
                currentName: '',
                currentAction: this.progress.currentAction,
                startedAt
            });
        }

        this.runResizeBatch(resizeConfig, safeImageFiles, runId, {
            ...options,
            jobs: allJobs,
            resumeNextIndex,
            resumeBase,
            totalJobs,
            totalImages,
            totalAspectRatios,
            outputTotal
        }).catch(error => {
            this.updateProgress({
                phase: 'interrupted',
                currentAction: '即梦批量改尺寸任务被中断: ' + error.message
            });
            if (typeof options.onUpdateResumeState === 'function') {
                options.onUpdateResumeState({
                    phase: 'interrupted',
                    currentAction: '即梦批量改尺寸任务被中断: ' + error.message
                });
            }
            this.logger.error && this.logger.error(`即梦批量改尺寸任务被中断: ${error.message}`);
        }).finally(() => {
            this.running = false;
            this.stopRequested = false;
            this.taskType = null;
        });

        return {
            success: true,
            message: resumeBase
                ? `已继续即梦批量改尺寸任务，剩余 ${Math.max(0, allJobs.length - resumeNextIndex)} 组。`
                : `已启动即梦批量改尺寸任务，共 ${safeImageFiles.length} 张输入图。`,
            totalImages: safeImageFiles.length,
            outputTotal,
            progress: this.progress
        };
    }

    async runResizeBatch(config, imageFiles, runId, options = {}) {
        const headless = config.browserMode !== 'headed';
        const aspectRatios = Array.isArray(config.generationSettings.aspectRatios) && config.generationSettings.aspectRatios.length
            ? config.generationSettings.aspectRatios
            : [config.generationSettings.aspectRatio];
        const total = Number(options.totalJobs) || imageFiles.length * aspectRatios.length;
        const totalImages = Number(options.totalImages) || imageFiles.length;
        const totalAspectRatios = Number(options.totalAspectRatios) || aspectRatios.length;
        const resumeBase = options.resumeBase && typeof options.resumeBase === 'object' ? options.resumeBase : null;
        const startIndex = Math.max(0, Number(options.resumeNextIndex) || 0);
        const outputTotal = Math.max(Number(options.outputTotal) || 0, total * JIMENG_OUTPUT_QUANTITY);
        const concurrency = 1;
        let successCount = resumeBase ? (Number(resumeBase.success) || 0) : 0;
        let failedCount = resumeBase ? (Number(resumeBase.failed) || 0) : 0;
        let savedCount = resumeBase ? (Number(resumeBase.saved) || 0) : 0;
        let stopped = false;
        let jobIndex = 0;
        const updateResumeState = (patch = {}) => {
            if (typeof options.onUpdateResumeState !== 'function') return;
            options.onUpdateResumeState({
                phase: patch.phase || (this.progress && this.progress.phase) || 'running',
                nextIndex: Math.max(0, Math.min(total, jobIndex)),
                currentIndex: patch.currentIndex !== undefined ? patch.currentIndex : jobIndex,
                completed: successCount + failedCount,
                success: successCount,
                failed: failedCount,
                saved: savedCount,
                currentName: patch.currentName || '',
                currentAction: patch.currentAction || '',
                ...patch
            });
        };

        this.logger.system && this.logger.system('========================================');
        this.logger.system && this.logger.system('开始即梦网页自动化批量改尺寸任务');
        this.logger.info && this.logger.info(`输入文件夹: ${config.inputFolder}`);
        this.logger.info && this.logger.info(`输出文件夹: ${config.outputFolder}`);
        this.logger.info && this.logger.info(`处理方式: 单页顺序生成，每张图依次完成 ${aspectRatios.join('、')} 后再处理下一张`);
        this.logger.system && this.logger.system('========================================');

        const page = await this.openJimengPage({ headless });

        for (let current = 0; current < imageFiles.length; current += 1) {
            if (this.stopRequested) {
                stopped = true;
                break;
            }

            const imagePath = imageFiles[current];
            const imageName = this.path.basename(imagePath);
            for (let ratioIndex = 0; ratioIndex < aspectRatios.length; ratioIndex += 1) {
                if (jobIndex < startIndex) {
                    jobIndex += 1;
                    continue;
                }

                if (this.stopRequested) {
                    stopped = true;
                    break;
                }

                const aspectRatio = aspectRatios[ratioIndex];
                const currentJobIndex = jobIndex + 1;
                let countedCurrentJob = false;
                const perRatioConfig = {
                    ...config,
                    generationSettings: {
                        ...config.generationSettings,
                        aspectRatio,
                        aspectRatios
                    }
                };

                this.updateProgress({
                    phase: 'running',
                    currentIndex: currentJobIndex,
                    completed: successCount + failedCount,
                    success: successCount,
                    failed: failedCount,
                    saved: savedCount,
                    total,
                    totalImages,
                    totalAspectRatios,
                    outputTotal,
                    active: 1,
                    queued: Math.max(0, total - currentJobIndex),
                    currentName: imageName,
                    currentAction: `即梦顺序处理 ${current + 1}/${imageFiles.length}，比例 ${ratioIndex + 1}/${aspectRatios.length}（${aspectRatio}）: ${imageName}`
                });
                updateResumeState(this.progress);

                this.logger.info && this.logger.info(`🖼️ 即梦顺序处理 ${current + 1}/${imageFiles.length}: ${imageName}，比例 ${ratioIndex + 1}/${aspectRatios.length}（${aspectRatio}）`);
                try {
                    const result = await this.generateForImageOnPage(page, imagePath, current + 1, perRatioConfig, runId, {
                        navigate: true
                    });
                    if (result.success) {
                        successCount += 1;
                        savedCount += Number(result.savedCount) || 0;
                        countedCurrentJob = true;
                        this.logger.info && this.logger.info(`✅ 即梦改尺寸完成 ${current + 1}/${imageFiles.length}: ${imageName}，比例 ${aspectRatio}，保存 ${result.savedCount || 0} 张`);
                    } else if (this.stopRequested || /停止|取消/.test(result.message || '')) {
                        stopped = true;
                        this.logger.warn && this.logger.warn(`⏹️ 即梦改尺寸已停止: ${imageName}`);
                        break;
                    } else {
                        failedCount += 1;
                        countedCurrentJob = true;
                        this.logger.error && this.logger.error(`❌ 即梦改尺寸失败 ${current + 1}/${imageFiles.length}，比例 ${aspectRatio}: ${result.message}`);
                    }
                } catch (error) {
                    if (this.stopRequested || /停止|取消/.test(error.message || '')) {
                        stopped = true;
                        break;
                    }
                    failedCount += 1;
                    countedCurrentJob = true;
                    this.logger.error && this.logger.error(`❌ 即梦改尺寸出错 ${current + 1}/${imageFiles.length}，比例 ${aspectRatio}: ${error.message}`);
                } finally {
                    if (countedCurrentJob) {
                        jobIndex += 1;
                    }
                    this.updateProgress({
                        phase: this.stopRequested || stopped ? 'stopping' : 'running',
                        currentIndex: countedCurrentJob ? jobIndex : currentJobIndex,
                        completed: successCount + failedCount,
                        success: successCount,
                        failed: failedCount,
                        saved: savedCount,
                        total,
                        totalImages,
                        totalAspectRatios,
                        outputTotal,
                        active: 0,
                        queued: this.stopRequested ? 0 : Math.max(0, total - jobIndex),
                        currentName: imageName,
                        currentAction: this.stopRequested || stopped
                            ? '正在停止即梦本地队列和结果轮询...'
                            : `即梦进度：成功 ${successCount}，失败 ${failedCount}，已保存 ${savedCount} 张`
                    });
                    updateResumeState(this.progress);
                }

                if (stopped) break;
            }

            if (stopped) break;
        }

        stopped = stopped || this.stopRequested;
        this.updateProgress({
            phase: stopped ? 'stopped' : 'completed',
            currentIndex: stopped ? jobIndex : total,
            completed: successCount + failedCount,
            success: successCount,
            failed: failedCount,
            saved: savedCount,
            total,
            totalImages,
            totalAspectRatios,
            outputTotal,
            active: 0,
            queued: 0,
            currentName: '',
            currentAction: stopped
                ? `即梦批量改尺寸已停止：成功 ${successCount} 组，失败 ${failedCount} 组`
                : `即梦批量改尺寸完成：成功 ${successCount} 组，失败 ${failedCount} 组`
        });
        if (stopped) {
            updateResumeState(this.progress);
        } else if (typeof options.onClearResumeState === 'function') {
            options.onClearResumeState();
        }

        this.logger.system && this.logger.system(stopped
            ? `⏹️ 即梦批量改尺寸已停止：成功 ${successCount} 组，失败 ${failedCount} 组`
            : `✅ 即梦批量改尺寸完成：成功 ${successCount} 组，失败 ${failedCount} 组`);
    }

    throwIfStopped() {
        if (this.stopRequested) {
            throw new Error('操作已停止');
        }
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async humanDelay(minMs = 400, maxMs = 1000) {
        const min = Math.max(0, Number(minMs) || 0);
        const max = Math.max(min, Number(maxMs) || min);
        const waitMs = min + Math.floor(Math.random() * (max - min + 1));
        await this.sleep(waitMs);
    }
}

function createJimengBrowserService(deps = {}) {
    return new JimengBrowserService(deps);
}

module.exports = {
    createJimengBrowserService,
    DEFAULT_JIMENG_RESIZE_CONFIG,
    JIMENG_IMAGE_URL,
    JIMENG_TASK_TYPE,
    normalizeJimengResizeConfig,
    getJimengGenerationOptions,
    IMAGE_EXTENSIONS
};
