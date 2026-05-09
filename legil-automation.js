/**
 * ============================================
 * Legil 美术与创意平台自动化操作模块
 * ============================================
 * 核心功能：
 * 1. 填入提示词
 * 2. 点击生成按钮
 * 3. 等待生成完成
 * 4. 点击缩略图打开大图，保存完整大图
 */

// 引入 Playwright 浏览器控制器
const browserController = require('./playwright-controller');

// 引入实时日志系统
const logger = require('./logger');

// 引入文件系统模块
const fs = require('fs');
const path = require('path');
const {
    formatDateTimeForFile,
    padNumber,
    sanitizeFileNamePart,
    sortNaturallyByName
} = require('./file-utils');

function isAbortRequested(options = {}) {
    if (options.signal && options.signal.aborted) {
        return true;
    }
    if (typeof options.shouldAbort === 'function') {
        try {
            return !!options.shouldAbort();
        } catch (error) {
            logger.warn(`检查取消状态失败: ${error.message}`);
        }
    }
    return false;
}

function throwIfAborted(options = {}) {
    if (isAbortRequested(options)) {
        throw new Error('操作已取消');
    }
}

// 可中断的sleep函数；没有传入取消信号时就是普通 sleep
async function interruptibleSleep(ms, options = {}) {
    const checkInterval = 500; // 每500毫秒检查一次
    const startTime = Date.now();
    while (Date.now() - startTime < ms) {
        if (isAbortRequested(options)) {
            throw new Error('操作已取消');
        }
        await browserController.sleep(Math.min(checkInterval, ms - (Date.now() - startTime)));
    }
}

function normalizeImageUrl(src) {
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
}

function isLegilOutputUrl(src) {
    const normalized = normalizeImageUrl(src);
    return normalized.includes('/output') && !normalized.includes('/input');
}

function extractLegilImageUrl(src) {
    const normalized = normalizeImageUrl(src);
    try {
        const parsed = new URL(normalized);
        const embeddedUrl = parsed.searchParams.get('url');
        return embeddedUrl ? normalizeImageUrl(embeddedUrl) : normalized;
    } catch (error) {
        return normalized;
    }
}

const LEGIL_DEFAULT_SETTINGS = {
    imageModel: 'nano-banana-2',
    aspectRatio: '1:1',
    resolution: '2K',
    outputQuantity: 1
};

const LEGIL_IMAGE_MODEL_OPTIONS = [
    { value: 'seedream-4.5', label: 'Seedream 4.5' },
    { value: 'gpt-image-2', label: 'GPT-Image-2' },
    { value: 'gpt-image-1', label: 'GPT-Image-1' },
    { value: 'nano-banana-2', label: 'Nano Banana 2' },
    { value: 'nano-banana-pro', label: 'Nano Banana Pro' },
    { value: 'nano-banana', label: 'Nano Banana' },
    { value: 'imagen-3', label: 'Imagen-3' }
];

const LEGIL_ASPECT_RATIOS = ['1:1', '1:4', '1:8', '2:3', '3:4', '4:5', '9:16', '21:9', '16:9', '5:4', '4:3', '3:2', '8:1', '4:1'];
const LEGIL_RESOLUTIONS = ['512px', '1K', '2K', '4K'];
const LEGIL_OUTPUT_QUANTITIES = [1, 2, 3, 4];

class LegilAutomation {
    constructor() {
        // 保存路径（默认输出文件夹）
        this.saveFolder = 'D:\\工作\\自动化工作流1\\输出';
        // 参考图文件夹路径
        this.referenceFolder = 'D:\\工作\\自动化工作流1\\Legil参考图';
        // 存储可用的参考图列表
        this.referenceImages = [];
        // 当前使用的参考图索引
        this.currentRefIndex = 0;
        this.generationSettings = { ...LEGIL_DEFAULT_SETTINGS };
    }

    buildOutputFileName(promptIndex, options = {}) {
        const timestamp = formatDateTimeForFile();
        const variantIndex = Number.isFinite(Number(options.variantIndex)) && Number(options.variantIndex) > 0
            ? Math.floor(Number(options.variantIndex))
            : 1;
        const outputSequenceBase = Number(options.outputSequence);
        const outputSequence = Number.isFinite(outputSequenceBase) && outputSequenceBase > 0
            ? outputSequenceBase + variantIndex - 1
            : outputSequenceBase;

        if (Number.isFinite(outputSequence) && outputSequence > 0) {
            const outputTotal = Number(options.outputTotal);
            const sequenceWidth = Math.max(4, String(Number.isFinite(outputTotal) && outputTotal > 0 ? Math.floor(outputTotal) : Math.floor(outputSequence)).length);
            const sequencePart = padNumber(outputSequence, sequenceWidth);
            const promptNumber = Number(options.promptIndexWithinImage ?? promptIndex);
            const promptPart = padNumber(promptNumber, 2);
            const runPart = sanitizeFileNamePart(options.runId || timestamp, 30);

            const refIndex = Number(options.referenceImageIndex);
            if (Number.isFinite(refIndex) && refIndex > 0) {
                const totalRefs = Number(options.totalReferenceImages);
                const refWidth = Math.max(3, String(Number.isFinite(totalRefs) && totalRefs > 0 ? Math.floor(totalRefs) : Math.floor(refIndex)).length);
                const refPart = padNumber(refIndex, refWidth);
                const refBaseName = path.parse(String(options.referenceImageName || '')).name;
                const safeRefName = sanitizeFileNamePart(refBaseName, 50);
                return `${runPart}_${sequencePart}_ref${refPart}_prompt${promptPart}_v${padNumber(variantIndex, 2)}_${safeRefName}_${timestamp}.png`;
            }

            return `${runPart}_${sequencePart}_prompt${promptPart}_v${padNumber(variantIndex, 2)}_${timestamp}.png`;
        }

        return `legil_${promptIndex}_v${padNumber(variantIndex, 2)}_${timestamp}.png`;
    }

    /**
     * 设置保存文件夹
     */
    setSaveFolder(folderPath) {
        this.saveFolder = folderPath;
        logger.info(`已设置 Legil 保存文件夹: ${folderPath}`);
    }

    /**
     * 设置参考图文件夹
     */
    setReferenceFolder(folderPath) {
        this.referenceFolder = folderPath;
        logger.info(`已设置 Legil 参考图文件夹: ${folderPath}`);
        // 重新扫描参考图
        this.scanReferenceImages();
    }

    getImageModelLabel(modelValue = this.generationSettings.imageModel) {
        const option = LEGIL_IMAGE_MODEL_OPTIONS.find(item => item.value === modelValue);
        return option ? option.label : LEGIL_IMAGE_MODEL_OPTIONS[0].label;
    }

    getImageModelOptions() {
        return LEGIL_IMAGE_MODEL_OPTIONS.map(option => ({ ...option }));
    }

    normalizeGenerationSettings(settings = {}) {
        const next = {
            ...this.generationSettings,
            ...(settings && typeof settings === 'object' ? settings : {})
        };

        const imageModel = LEGIL_IMAGE_MODEL_OPTIONS.some(option => option.value === String(next.imageModel))
            ? String(next.imageModel)
            : LEGIL_DEFAULT_SETTINGS.imageModel;
        const aspectRatio = LEGIL_ASPECT_RATIOS.includes(String(next.aspectRatio))
            ? String(next.aspectRatio)
            : LEGIL_DEFAULT_SETTINGS.aspectRatio;
        const resolution = LEGIL_RESOLUTIONS.includes(String(next.resolution))
            ? String(next.resolution)
            : LEGIL_DEFAULT_SETTINGS.resolution;
        const outputQuantityNumber = Number(next.outputQuantity);
        const outputQuantity = LEGIL_OUTPUT_QUANTITIES.includes(outputQuantityNumber)
            ? outputQuantityNumber
            : LEGIL_DEFAULT_SETTINGS.outputQuantity;

        return {
            imageModel,
            aspectRatio,
            resolution,
            outputQuantity
        };
    }

    setGenerationSettings(settings = {}) {
        this.generationSettings = this.normalizeGenerationSettings(settings);
        logger.info(`已设置 Legil 生成参数: 模型 ${this.getImageModelLabel(this.generationSettings.imageModel)}, 宽高比 ${this.generationSettings.aspectRatio}, 分辨率 ${this.generationSettings.resolution}, 输出数量 ${this.generationSettings.outputQuantity}`);
        return this.getConfig();
    }

    getConfig() {
        return {
            settings: { ...this.generationSettings },
            defaultSettings: { ...LEGIL_DEFAULT_SETTINGS },
            options: {
                imageModels: this.getImageModelOptions(),
                aspectRatios: [...LEGIL_ASPECT_RATIOS],
                resolutions: [...LEGIL_RESOLUTIONS],
                outputQuantities: [...LEGIL_OUTPUT_QUANTITIES]
            }
        };
    }

    /**
     * 扫描参考图文件夹中的所有图片
     */
    scanReferenceImages() {
        try {
            if (!fs.existsSync(this.referenceFolder)) {
                logger.warn(`参考图文件夹不存在: ${this.referenceFolder}`);
                this.referenceImages = [];
                return;
            }

            const files = fs.readdirSync(this.referenceFolder);
            const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif'];

            this.referenceImages = sortNaturallyByName(files)
                .filter(file => {
                    const ext = path.extname(file).toLowerCase();
                    return imageExtensions.includes(ext);
                })
                .map(file => path.join(this.referenceFolder, file));

            logger.info(`📁 Legil参考图文件夹扫描完成: 找到 ${this.referenceImages.length} 张参考图`);

            if (this.referenceImages.length > 0) {
                logger.info(`   参考图列表: ${this.referenceImages.map(f => path.basename(f)).join(', ')}`);
            }

        } catch (error) {
            logger.error(`扫描参考图文件夹失败: ${error.message}`);
            this.referenceImages = [];
        }
    }

    /**
     * 获取下一张参考图（循环使用）
     */
    getNextReferenceImage() {
        if (this.referenceImages.length === 0) {
            return null;
        }

        const image = this.referenceImages[this.currentRefIndex];
        this.currentRefIndex = (this.currentRefIndex + 1) % this.referenceImages.length;

        return image;
    }

    /**
     * =====================================================
     * 主流程：生成图片并保存（带参考图上传）
     * =====================================================
     */
    async generateImage(prompt, promptIndex = 1, options = {}) {
        const promptText = typeof prompt === 'string' ? prompt.trim() : '';
        const safePromptIndex = Number.isFinite(Number(promptIndex)) ? Number(promptIndex) : 1;

        if (!promptText) {
            return {
                success: false,
                savePath: null,
                message: '请提供有效提示词'
            };
        }

        logger.info(`========================================`);
        logger.info(`开始 Legil 自动化流程 - 第 ${safePromptIndex} 张图片`);
        logger.info(`========================================`);

        // 如果指定了参考图文件夹，则使用指定的
        if (options.referenceFolder) {
            this.setReferenceFolder(options.referenceFolder);
        }

        if (options.saveFolder) {
            this.setSaveFolder(options.saveFolder);
        }

        const generationSettings = this.normalizeGenerationSettings(options.generationSettings);

        try {
            throwIfAborted(options);

            // 第1步：获取 Legil 页面
            let page = browserController.getPage('legil');
            if (!page || page.isClosed()) {
                logger.warn('Legil 页面未打开，正在打开...');
                const opened = await browserController.openWebsite('legil', 'https://lumos.diandian.info/legil/image-to-image');
                if (!opened) {
                    throw new Error('无法打开 Legil 页面');
                }
                page = browserController.getPage('legil');
                await interruptibleSleep(5000, options);
            }

            if (!page || page.isClosed()) {
                throw new Error('Legil 页面不可用');
            }

            logger.info('[步骤1/6] 正在应用 Legil 生成参数...');
            const appliedGenerationSettings = await this.applyGenerationSettings(page, generationSettings, options);

            // 第2步：上传参考图（如果配置了参考图文件夹）
            if (this.referenceImages.length > 0 || fs.existsSync(this.referenceFolder)) {
                logger.info('[步骤2/6] 正在上传参考图...');
                const uploadSuccess = await this.uploadReferenceImage(page, options);
                if (uploadSuccess) {
                    logger.info('✅ 参考图上传成功');
                    // 等待图片上传完成并生效
                    await interruptibleSleep(3000, options);
                } else {
                    logger.warn('⚠️ 参考图上传失败，继续生成流程');
                }
            } else {
                logger.info('[步骤2/6] 跳过参考图上传（未配置参考图文件夹）');
            }

            // 第3步：填入提示词
            logger.info('[步骤3/6] 正在填入提示词...');
            const inputSuccess = await this.inputPrompt(page, promptText, options);
            if (!inputSuccess) {
                throw new Error('填入提示词失败');
            }

            const beforeImageKeys = await this.getImageKeys(page);

            // 第4步：点击生成按钮
            logger.info('[步骤4/6] 正在点击生成按钮...');
            const clickSuccess = await this.clickGenerateButton(page, options);
            if (!clickSuccess) {
                throw new Error('点击生成按钮失败');
            }

            // 第5步：等待图片生成完成
            logger.info('[步骤5/6] 等待图片生成完成（约3-5分钟）...');
            const generateSuccess = await this.waitForGenerationComplete(page, beforeImageKeys, {
                ...options,
                expectedOutputCount: appliedGenerationSettings.outputQuantity
            });
            if (!generateSuccess) {
                throw new Error('等待图片生成超时');
            }

            // 第6步：保存生成的图片
            logger.info('[步骤6/6] 正在保存生成的图片...');
            const savePaths = await this.saveGeneratedImages(page, safePromptIndex, {
                ...options,
                beforeImageKeys,
                expectedOutputCount: appliedGenerationSettings.outputQuantity
            });
            if (savePaths.length === 0) {
                throw new Error('保存图片失败');
            }

            logger.info(`========================================`);
            logger.info(`✅ 流程完成！已保存 ${savePaths.length} 张图片`);
            savePaths.forEach(savePath => logger.info(`📁 保存路径: ${savePath}`));
            logger.info(`========================================`);

            return {
                success: true,
                savePath: savePaths[0],
                savePaths,
                savedCount: savePaths.length,
                message: `图片生成并保存成功（${savePaths.length}张）`
            };

        } catch (error) {
            logger.error(`❌ Legil 自动化失败: ${error.message}`);
            return {
                success: false,
                savePath: null,
                message: error.message
            };
        }
    }

    async getImageKeys(page) {
        if (!page || page.isClosed()) {
            return [];
        }

        return page.evaluate(() => {
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
            const extractImageUrl = (src) => {
                const normalized = normalizeSrc(src);
                try {
                    const url = new URL(normalized, window.location.href);
                    const embeddedUrl = url.searchParams.get('url');
                    return embeddedUrl ? normalizeSrc(embeddedUrl) : normalized;
                } catch (e) {
                    return normalized;
                }
            };

            const keys = new Set();
            for (const img of document.querySelectorAll('img')) {
                const srcList = [img.currentSrc, img.src].filter(Boolean);
                for (const src of srcList) {
                    const raw = String(src).split('#')[0];
                    keys.add(raw);
                    keys.add(normalizeSrc(raw));
                    keys.add(extractImageUrl(raw));
                }
            }
            return Array.from(keys).filter(Boolean);
        }).catch(() => []);
    }

    /**
     * =====================================================
     * 上传参考图到 Legil
     * =====================================================
     */
    async uploadReferenceImage(page, options = {}) {
        try {
            throwIfAborted(options);

            // 确保已扫描参考图
            if (this.referenceImages.length === 0) {
                this.scanReferenceImages();
            }

            if (this.referenceImages.length === 0) {
                logger.warn('没有可用的参考图');
                return false;
            }

            // 获取下一张参考图
            const imagePath = this.getNextReferenceImage();
            if (!imagePath) {
                logger.warn('无法获取参考图');
                return false;
            }

            if (!fs.existsSync(imagePath)) {
                logger.warn(`参考图文件不存在，跳过: ${imagePath}`);
                this.scanReferenceImages();
                return false;
            }

            logger.info(`准备上传参考图: ${path.basename(imagePath)}`);

            // 等待页面完全加载
            await page.waitForLoadState('networkidle');
            await interruptibleSleep(2000, options);

            // 尝试找到文件上传输入框
            const fileInputSelectors = [
                'input[type="file"]',
                'input[type="file"][accept*="image"]',
                '[class*="upload"] input[type="file"]',
                '[class*="reference"] input[type="file"]',
                'input[type="file"][name*="image"]',
                'input[type="file"][name*="file"]'
            ];

            let fileInput = null;

            // 尝试每个选择器
            for (const selector of fileInputSelectors) {
                try {
                    fileInput = await page.$(selector);
                    if (fileInput) {
                        const isVisible = await fileInput.isVisible().catch(() => false);
                        // 文件输入框可能是隐藏的，所以不需要检查可见性
                        logger.info(`找到文件上传输入框: ${selector}`);
                        break;
                    }
                } catch (e) {}
            }

            // 如果没找到，尝试查找所有 input[type="file"]
            if (!fileInput) {
                const allFileInputs = await page.$$('input[type="file"]');
                for (const input of allFileInputs) {
                    fileInput = input;
                    logger.info(`找到文件上传输入框（备选）`);
                    break;
                }
            }

            if (!fileInput) {
                // 尝试点击上传按钮来触发文件选择
                logger.info('尝试点击上传按钮...');
                const uploadButtonSelectors = [
                    'button:has-text("上传")',
                    'button:has-text("参考图")',
                    'button:has-text("图片")',
                    '[class*="upload"]',
                    '[class*="reference"]',
                    'button svg[xmlns]',
                    'div[class*="upload"]',
                    'div[class*="reference"]'
                ];

                for (const selector of uploadButtonSelectors) {
                    try {
                        const button = await page.$(selector);
                        if (button) {
                            const isVisible = await button.isVisible().catch(() => false);
                            if (isVisible) {
                                await button.click();
                                logger.info(`点击上传按钮: ${selector}`);
                                await interruptibleSleep(2000, options);

                                // 点击后再次查找文件输入框
                                const fileInputAfterClick = await page.$('input[type="file"]');
                                if (fileInputAfterClick) {
                                    fileInput = fileInputAfterClick;
                                    break;
                                }
                            }
                        }
                    } catch (e) {}
                }
            }

            if (!fileInput) {
                logger.warn('未找到文件上传输入框');
                return false;
            }

            // 上传文件
            await fileInput.setInputFiles(imagePath);
            logger.info(`已选择参考图文件: ${path.basename(imagePath)}`);

            // 等待上传完成
            await interruptibleSleep(3000, options);

            // 检查是否有上传按钮需要点击
            const confirmUploadSelectors = [
                'button:has-text("上传")',
                'button:has-text("确认")',
                'button:has-text("确定")',
                'button[type="submit"]'
            ];

            for (const selector of confirmUploadSelectors) {
                try {
                    const button = await page.$(selector);
                    if (button) {
                        const isVisible = await button.isVisible().catch(() => false);
                        const isEnabled = await button.isEnabled().catch(() => false);
                        if (isVisible && isEnabled) {
                            const btnText = await button.textContent().catch(() => '');
                            if (btnText.includes('上传') || btnText.includes('确认') || btnText.includes('确定')) {
                                await button.click();
                                logger.info(`点击确认上传按钮: ${selector}`);
                                await interruptibleSleep(2000, options);
                                break;
                            }
                        }
                    }
                } catch (e) {}
            }

            logger.info('参考图上传流程完成');
            return true;

        } catch (error) {
            logger.error(`上传参考图失败: ${error.message}`);
            return false;
        }
    }

    /**
     * =====================================================
     * 填入提示词
     * =====================================================
     */
    async inputPrompt(page, prompt, options = {}) {
        try {
            throwIfAborted(options);
            const promptText = typeof prompt === 'string' ? prompt.trim() : '';
            if (!promptText) {
                throw new Error('提示词为空');
            }

            // 等待页面完全加载
            await page.waitForLoadState('networkidle');
            await interruptibleSleep(2000, options);

            // 可能的选择器列表
            const inputSelectors = [
                'textarea[placeholder*="描述"]',
                'textarea[placeholder*="提示"]',
                'textarea',
                'input[type="text"]'
            ];

            let inputElement = null;

            // 尝试每个选择器
            for (const selector of inputSelectors) {
                try {
                    inputElement = await page.waitForSelector(selector, { timeout: 2000 });
                    if (inputElement) {
                        const isVisible = await inputElement.isVisible().catch(() => false);
                        if (isVisible) {
                            logger.info(`找到输入框: ${selector}`);
                            break;
                        }
                    }
                } catch (e) {}
            }

            // 如果上面没找到，查找页面中所有 textarea
            if (!inputElement) {
                const allInputs = await page.$$('textarea, input[type="text"]');
                for (const el of allInputs) {
                    const isVisible = await el.isVisible().catch(() => false);
                    if (isVisible) {
                        inputElement = el;
                        break;
                    }
                }
            }

            if (!inputElement) {
                throw new Error('未找到输入框');
            }

            // 清空并填入提示词
            await inputElement.click();
            await inputElement.fill('');
            await inputElement.fill(promptText);
            logger.info('提示词已填入');
            return true;

        } catch (error) {
            logger.error(`填入提示词失败: ${error.message}`);
            return false;
        }
    }

    async detectCurrentImageModel(page) {
        const labels = this.getImageModelOptions().map(option => option.label);
        return page.evaluate((modelLabels) => {
            const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim();
            const isVisible = (el) => {
                const rect = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return rect.width > 0 &&
                    rect.height > 0 &&
                    style.visibility !== 'hidden' &&
                    style.display !== 'none' &&
                    style.opacity !== '0';
            };

            const candidates = [];
            for (const el of document.querySelectorAll('button, [role="button"], [aria-haspopup], [class*="select"], [class*="dropdown"], div, span')) {
                if (!isVisible(el)) continue;
                const rect = el.getBoundingClientRect();
                if (rect.left < 180 || rect.left > 520 || rect.top < 60 || rect.top > 180 || rect.width > 340 || rect.height > 100) continue;

                const text = normalizeText(el.innerText || el.textContent || '');
                const label = modelLabels.find(item => text === item || text.includes(item));
                if (!label) continue;

                candidates.push({
                    label,
                    top: rect.top,
                    left: rect.left,
                    area: rect.width * rect.height
                });
            }

            candidates.sort((a, b) => {
                const topDiff = a.top - b.top;
                if (Math.abs(topDiff) > 4) return topDiff;
                const leftDiff = a.left - b.left;
                if (Math.abs(leftDiff) > 4) return leftDiff;
                return a.area - b.area;
            });

            return candidates[0]?.label || '';
        }, labels).catch(() => '');
    }

    async findImageModelTrigger(page) {
        const labels = this.getImageModelOptions().map(option => option.label);
        const handle = await page.evaluateHandle((modelLabels) => {
            const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim();
            const isVisible = (el) => {
                const rect = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return rect.width > 0 &&
                    rect.height > 0 &&
                    style.visibility !== 'hidden' &&
                    style.display !== 'none' &&
                    style.opacity !== '0';
            };

            const clickableFor = (el) => {
                return el.closest('button, [role="button"], [aria-haspopup], [class*="select"], [class*="dropdown"], [class*="trigger"]') || el;
            };

            const candidates = [];
            for (const el of document.querySelectorAll('button, [role="button"], [aria-haspopup], [class*="select"], [class*="dropdown"], [class*="trigger"], div, span')) {
                if (!isVisible(el)) continue;
                const rect = el.getBoundingClientRect();
                if (rect.left < 180 || rect.left > 520 || rect.top < 60 || rect.top > 180 || rect.width > 340 || rect.height > 100) continue;

                const text = normalizeText(el.innerText || el.textContent || '');
                if (!modelLabels.some(label => text === label || text.includes(label))) continue;

                const clickable = clickableFor(el);
                if (!isVisible(clickable)) continue;
                const clickableRect = clickable.getBoundingClientRect();
                if (clickableRect.left < 180 || clickableRect.left > 520 || clickableRect.width > 360 || clickableRect.height > 120) continue;

                candidates.push({
                    el: clickable,
                    top: clickableRect.top,
                    left: clickableRect.left,
                    area: clickableRect.width * clickableRect.height
                });
            }

            candidates.sort((a, b) => {
                const topDiff = a.top - b.top;
                if (Math.abs(topDiff) > 4) return topDiff;
                const leftDiff = a.left - b.left;
                if (Math.abs(leftDiff) > 4) return leftDiff;
                return a.area - b.area;
            });

            return candidates[0]?.el || null;
        }, labels).catch(() => null);

        return handle ? handle.asElement() : null;
    }

    async clickImageModelOption(page, targetLabel, minTop = 0, options = {}) {
        const handle = await page.evaluateHandle(({ label, optionMinTop }) => {
            const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim();
            const isVisible = (el) => {
                const rect = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return rect.width > 0 &&
                    rect.height > 0 &&
                    style.visibility !== 'hidden' &&
                    style.display !== 'none' &&
                    style.opacity !== '0';
            };

            const clickableFor = (el) => {
                return el.closest('button, [role="option"], [role="menuitem"], [role="button"], [class*="option"], [class*="item"], [class*="select"], [class*="dropdown"], div') || el;
            };

            const candidates = [];
            for (const el of document.querySelectorAll('button, [role="option"], [role="menuitem"], [role="button"], [class*="option"], [class*="item"], div, span')) {
                if (!isVisible(el)) continue;
                const text = normalizeText(el.innerText || el.textContent || '');
                if (!(text === label || text.includes(label))) continue;

                const clickable = clickableFor(el);
                if (!isVisible(clickable)) continue;
                const rect = clickable.getBoundingClientRect();
                if (rect.left < 180 || rect.left > 520 || rect.top < optionMinTop || rect.width > 360 || rect.height > 80) continue;

                candidates.push({
                    el: clickable,
                    top: rect.top,
                    left: rect.left,
                    area: rect.width * rect.height
                });
            }

            candidates.sort((a, b) => {
                const topDiff = a.top - b.top;
                if (Math.abs(topDiff) > 4) return topDiff;
                const leftDiff = a.left - b.left;
                if (Math.abs(leftDiff) > 4) return leftDiff;
                return a.area - b.area;
            });

            return candidates[0]?.el || null;
        }, {
            label: targetLabel,
            optionMinTop: Number.isFinite(minTop) ? minTop : 0
        }).catch(() => null);

        const optionElement = handle ? handle.asElement() : null;
        if (!optionElement) {
            return false;
        }

        await optionElement.click();
        await interruptibleSleep(500, options);
        return true;
    }

    async ensureImageModel(page, imageModel, options = {}) {
        const targetModel = LEGIL_IMAGE_MODEL_OPTIONS.some(item => item.value === imageModel)
            ? imageModel
            : LEGIL_DEFAULT_SETTINGS.imageModel;
        const targetLabel = this.getImageModelLabel(targetModel);

        try {
            throwIfAborted(options);

            const currentLabel = await this.detectCurrentImageModel(page);
            if (currentLabel === targetLabel) {
                logger.info(`✅ Legil 图生图模型已是 ${targetLabel}`);
                return true;
            }

            logger.info(`正在切换 Legil 图生图模型: ${targetLabel}`);
            const trigger = await this.findImageModelTrigger(page);
            if (!trigger) {
                logger.warn('未找到 Legil 图生图模型切换入口，继续使用页面当前模型');
                return false;
            }

            const triggerBox = await trigger.boundingBox().catch(() => null);
            const minTop = triggerBox ? triggerBox.y + triggerBox.height - 4 : 100;

            await trigger.click();
            await interruptibleSleep(500, options);

            const clicked = await this.clickImageModelOption(page, targetLabel, minTop, options);
            if (!clicked) {
                logger.warn(`未找到 Legil 图生图模型选项 "${targetLabel}"，继续使用页面当前模型`);
                await page.keyboard.press('Escape').catch(() => {});
                return false;
            }

            const verifiedLabel = await this.detectCurrentImageModel(page);
            if (verifiedLabel && verifiedLabel !== targetLabel) {
                logger.warn(`Legil 图生图模型可能未切换成功，当前检测为 "${verifiedLabel}"`);
                return false;
            }

            logger.info(`✅ 已应用 Legil 图生图模型: ${targetLabel}`);
            return true;
        } catch (error) {
            logger.warn(`切换 Legil 图生图模型失败，将继续使用页面当前模型: ${error.message}`);
            await page.keyboard.press('Escape').catch(() => {});
            return false;
        }
    }

    async clickLegilSettingOption(page, value, options = {}) {
        const target = String(value);
        const optionHandle = await page.evaluateHandle((targetText) => {
            const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim();
            const isVisible = (el) => {
                const rect = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return rect.width > 0 &&
                    rect.height > 0 &&
                    style.visibility !== 'hidden' &&
                    style.display !== 'none' &&
                    style.opacity !== '0';
            };

            const clickableFor = (el) => {
                return el.closest('button, [role="button"], [class*="radio"], [class*="option"], [class*="item"], [class*="segment"], div') || el;
            };

            const candidates = [];
            for (const el of document.querySelectorAll('button, [role="button"], div, span')) {
                if (!isVisible(el)) continue;
                const rect = el.getBoundingClientRect();
                if (rect.left < 180 || rect.left > 480 || rect.top < 80) continue;

                const text = normalizeText(el.innerText || el.textContent || '');
                if (text !== targetText) continue;

                const clickable = clickableFor(el);
                if (!isVisible(clickable)) continue;
                const clickableRect = clickable.getBoundingClientRect();
                if (clickableRect.left < 180 || clickableRect.left > 480 || clickableRect.width > 260 || clickableRect.height > 80) continue;

                candidates.push({
                    el: clickable,
                    top: clickableRect.top,
                    left: clickableRect.left,
                    area: clickableRect.width * clickableRect.height
                });
            }

            candidates.sort((a, b) => {
                const topDiff = a.top - b.top;
                if (Math.abs(topDiff) > 4) return topDiff;
                const leftDiff = a.left - b.left;
                if (Math.abs(leftDiff) > 4) return leftDiff;
                return a.area - b.area;
            });

            return candidates[0]?.el || null;
        }, target).catch(() => null);

        const optionElement = optionHandle ? optionHandle.asElement() : null;
        if (!optionElement) {
            return false;
        }

        await optionElement.click();
        await interruptibleSleep(300, options);
        return true;
    }

    async applyGenerationSettings(page, settings = this.generationSettings, options = {}) {
        const normalized = this.normalizeGenerationSettings(settings);
        logger.info(`Legil 参数: 模型 ${this.getImageModelLabel(normalized.imageModel)}，宽高比 ${normalized.aspectRatio}，分辨率 ${normalized.resolution}，输出数量 ${normalized.outputQuantity}`);
        const applied = { ...normalized };

        await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
        await interruptibleSleep(500, options);

        await this.ensureImageModel(page, normalized.imageModel, options);

        const tasks = [
            { label: '宽高比', value: normalized.aspectRatio },
            { label: '分辨率', value: normalized.resolution },
            { label: '输出数量', value: String(normalized.outputQuantity) }
        ];

        for (const task of tasks) {
            throwIfAborted(options);
            const clicked = await this.clickLegilSettingOption(page, task.value, options);
            if (clicked) {
                logger.info(`✅ 已应用 ${task.label}: ${task.value}`);
            } else {
                logger.warn(`未找到 Legil ${task.label}选项 "${task.value}"，继续使用页面当前值`);
                if (task.label === '输出数量') {
                    applied.outputQuantity = 1;
                }
            }
        }

        await interruptibleSleep(500, options);
        return applied;
    }

    /**
     * =====================================================
     * 点击生成按钮
     * =====================================================
     */
    async clickGenerateButton(page, options = {}) {
        try {
            throwIfAborted(options);
            const buttonSelectors = [
                'button:has-text("创建图片")',
                'button:has-text("重新生成")',
                'button:has-text("生成")'
            ];

            for (const selector of buttonSelectors) {
                try {
                    const button = await page.waitForSelector(selector, { timeout: 2000 });
                    if (button) {
                        const isVisible = await button.isVisible().catch(() => false);
                        const isEnabled = await button.isEnabled().catch(() => false);
                        if (isVisible && isEnabled) {
                            logger.info(`找到生成按钮: ${selector}`);
                            await button.click();
                            logger.info('已点击生成按钮');
                            return true;
                        }
                    }
                } catch (e) {}
            }

            throw new Error('未找到生成按钮');

        } catch (error) {
            logger.error(`点击生成按钮失败: ${error.message}`);
            return false;
        }
    }

    mergeOutputImageInfos(...groups) {
        const merged = new Map();

        for (const group of groups) {
            for (const item of Array.isArray(group) ? group : []) {
                const key = item.identity || item.outputSrc || item.src;
                if (!key) continue;

                const previous = merged.get(key);
                const previousArea = Number(previous?.displayWidth || 0) * Number(previous?.displayHeight || 0);
                const currentArea = Number(item.displayWidth || 0) * Number(item.displayHeight || 0);
                if (!previous || currentArea >= previousArea) {
                    merged.set(key, item);
                }
            }
        }

        return Array.from(merged.values()).sort((a, b) => {
            const topDiff = Number(a.top || 0) - Number(b.top || 0);
            if (Math.abs(topDiff) > 8) return topDiff;
            return Number(a.left || 0) - Number(b.left || 0);
        });
    }

    resolveCurrentOutputRowTop(imageInfos = [], failedInfos = []) {
        const rows = [
            ...(Array.isArray(imageInfos) ? imageInfos : []),
            ...(Array.isArray(failedInfos) ? failedInfos : [])
        ]
            .map(item => Number(item.top))
            .filter(value => Number.isFinite(value));

        if (rows.length === 0) {
            return null;
        }

        return rows.sort((a, b) => a - b)[0];
    }

    /**
     * =====================================================
     * 等待图片生成完成
     * =====================================================
     */
    async waitForGenerationComplete(page, beforeImageKeys = [], options = {}) {
        const maxWaitTime = options.maxWaitTime || 300000;
        const checkInterval = 3000;
        let waited = 0;
        let sawBusyState = false;
        let readyConfirmations = 0;
        let lastReadySignature = '';
        let firstThreeSlotsSeenAt = null;
        let lastFourthSlotScanAt = 0;
        const beforeKeys = Array.isArray(beforeImageKeys) ? beforeImageKeys : [];
        const expectedOutputCount = LEGIL_OUTPUT_QUANTITIES.includes(Number(options.expectedOutputCount))
            ? Number(options.expectedOutputCount)
            : 1;

        logger.info('等待图片生成中...');

        while (waited < maxWaitTime) {
            // 检查调用方是否请求取消
            if (isAbortRequested(options)) {
                logger.info('⏹️ 检测到取消信号，中断等待');
                throw new Error('操作已取消');
            }

            await interruptibleSleep(checkInterval, options);
            waited += checkInterval;

            const state = await page.evaluate((knownKeys) => {
                const normalizeSrc = (src) => {
                    let value = String(src || '');
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
                const extractImageUrl = (src) => {
                    const normalized = normalizeSrc(src);
                    try {
                        const url = new URL(normalized, window.location.href);
                        const embeddedUrl = url.searchParams.get('url');
                        return embeddedUrl ? normalizeSrc(embeddedUrl) : normalized;
                    } catch (e) {
                        return normalized;
                    }
                };

                const keys = new Set();
                for (const src of knownKeys || []) {
                    const raw = String(src || '').split('#')[0];
                    if (!raw) continue;
                    keys.add(raw);
                    keys.add(normalizeSrc(raw));
                    keys.add(extractImageUrl(raw));
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

                const text = document.body?.innerText || '';
                const busyByText = /生成中|正在生成|排队|处理中|请稍候|loading/i.test(text);
                const busyByElement = Array.from(document.querySelectorAll(
                    'svg[class*="animate-spin"], [class*="loading"], [class*="spin"], [aria-busy="true"]'
                )).some(el => isVisible(el));

                const visibleButtons = Array.from(document.querySelectorAll('button'))
                    .filter(button => isVisible(button));

                const generateButtonReady = visibleButtons.some(button => {
                    const label = button.innerText || button.textContent || '';
                    return /创建图片|重新生成|生成/.test(label) && !/生成中|正在生成|排队|处理中/.test(label) && !button.disabled;
                });

                const generateButtonBusy = visibleButtons.some(button => {
                    const label = button.innerText || button.textContent || '';
                    return /生成中|正在生成|排队|处理中/.test(label) || (button.disabled && /生成/.test(label));
                });

                const newOutputImages = Array.from(document.querySelectorAll('img'))
                    .map((img, index) => {
                        const rect = img.getBoundingClientRect();
                        const src = (img.currentSrc || img.src || '').split('#')[0];
                        const normalizedSrc = normalizeSrc(src);
                        const outputSrc = extractImageUrl(src);
                        return {
                            index,
                            src,
                            normalizedSrc,
                            outputSrc,
                            rect,
                            width: rect.width,
                            height: rect.height,
                            naturalWidth: img.naturalWidth || 0,
                            naturalHeight: img.naturalHeight || 0
                        };
                    })
                    .filter(item =>
                        item.src &&
                            !keys.has(item.src) &&
                            !keys.has(item.normalizedSrc) &&
                            !keys.has(item.outputSrc) &&
                            item.outputSrc.includes('/output') &&
                            !item.outputSrc.includes('/input') &&
                            item.rect.left > 300 &&
                            item.width > 128 &&
                            item.height > 128 &&
                            item.naturalWidth > 128 &&
                            item.naturalHeight > 128
                    );

                return {
                    busy: busyByText || busyByElement || generateButtonBusy,
                    generateButtonReady,
                    newImageCount: newOutputImages.length,
                    newImageKeys: newOutputImages
                        .map(item => item.outputSrc || item.normalizedSrc || item.src)
                        .sort()
                };
            }, beforeKeys).catch(() => ({
                busy: false,
                generateButtonReady: false,
                newImageCount: 0,
                newImageKeys: []
            }));

            let scannedOutputImages = await this.getNewOutputImageInfos(page, beforeKeys, expectedOutputCount, {
                scanScroll: false
            });
            let currentRowTop = this.resolveCurrentOutputRowTop(scannedOutputImages);
            let failedOutputSlots = await this.getFailedOutputSlotInfos(page, scannedOutputImages, expectedOutputCount, {
                scanScroll: false,
                currentRowOnly: true,
                targetRowTop: currentRowTop
            });

            if (failedOutputSlots.length > 0 && currentRowTop === null) {
                currentRowTop = this.resolveCurrentOutputRowTop(scannedOutputImages, failedOutputSlots);
            }

            const visibleFinishedSlotCount = Math.min(expectedOutputCount, scannedOutputImages.length + failedOutputSlots.length);
            const shouldScanFourthSlot = expectedOutputCount === 4 &&
                visibleFinishedSlotCount >= 3 &&
                visibleFinishedSlotCount < expectedOutputCount;

            if (shouldScanFourthSlot) {
                if (firstThreeSlotsSeenAt === null) {
                    firstThreeSlotsSeenAt = waited;
                    lastFourthSlotScanAt = waited;
                } else if (waited - lastFourthSlotScanAt >= 30000) {
                    logger.info('已检测到当前行前3个输出槽位完成，横向查看第4张图生成状态...');
                    const hiddenOutputImages = await this.getNewOutputImageInfos(page, beforeKeys, expectedOutputCount, {
                        scanScroll: true,
                        currentRowOnly: true,
                        targetRowTop: currentRowTop
                    });
                    scannedOutputImages = this.mergeOutputImageInfos(scannedOutputImages, hiddenOutputImages);
                    currentRowTop = this.resolveCurrentOutputRowTop(scannedOutputImages, failedOutputSlots);
                    failedOutputSlots = await this.getFailedOutputSlotInfos(page, scannedOutputImages, expectedOutputCount, {
                        scanScroll: true,
                        currentRowOnly: true,
                        targetRowTop: currentRowTop
                    });
                    lastFourthSlotScanAt = waited;
                }
            } else {
                firstThreeSlotsSeenAt = null;
                lastFourthSlotScanAt = 0;
            }

            if (scannedOutputImages.length > state.newImageCount) {
                state.newImageCount = scannedOutputImages.length;
                state.newImageKeys = scannedOutputImages
                    .map(item => item.identity || item.outputSrc || item.src)
                    .filter(Boolean)
                    .sort();
            }
            state.failedImageCount = failedOutputSlots.length;
            state.finishedSlotCount = Math.min(expectedOutputCount, state.newImageCount + state.failedImageCount);

            if (state.busy) {
                sawBusyState = true;
            }

            if (state.finishedSlotCount >= expectedOutputCount && !state.busy && state.generateButtonReady) {
                const signature = `${(state.newImageKeys || []).join('|')}|failed:${state.failedImageCount}`;
                if (signature && signature === lastReadySignature) {
                    readyConfirmations += 1;
                } else {
                    lastReadySignature = signature;
                    readyConfirmations = 1;
                    if (state.failedImageCount > 0) {
                        logger.warn(`检测到 ${state.newImageCount}/${expectedOutputCount} 张有效新图，另有 ${state.failedImageCount} 张失败占位，将跳过失败图并二次确认...`);
                    } else {
                        logger.info(`检测到 ${state.newImageCount}/${expectedOutputCount} 张候选新图，正在二次确认生成状态...`);
                    }
                }

                if (readyConfirmations >= 2) {
                    if (state.failedImageCount > 0) {
                        logger.warn(`✅ 生成状态已稳定结束：${state.newImageCount} 张有效图，跳过 ${state.failedImageCount} 张失败图`);
                    } else {
                        logger.info(`✅ 检测到 ${state.newImageCount} 张新生成图片，且生成状态已稳定结束`);
                    }
                    await interruptibleSleep(1000, options);
                    return true;
                }
            } else {
                if ((state.newImageCount > 0 || state.failedImageCount > 0) && waited % 30000 === 0) {
                    if (state.failedImageCount > 0) {
                        logger.info(`已检测到 ${state.newImageCount}/${expectedOutputCount} 张有效图，${state.failedImageCount} 张失败占位，继续等待其余输出...`);
                    } else {
                        logger.info(`已检测到 ${state.newImageCount}/${expectedOutputCount} 张新图，继续等待其余输出...`);
                    }
                }
                readyConfirmations = 0;
                lastReadySignature = '';
            }

            if (waited % 30000 === 0) {
                logger.info(`⏳ 已等待 ${waited / 1000} 秒...`);
            }
        }

        logger.error('等待图片生成超时');
        return false;
    }

    async getNewOutputImageInfos(page, beforeImageKeys = [], limit = 1, scanOptions = {}) {
        const safeLimit = Math.max(1, Math.min(4, Number(limit) || 1));
        const safeScanOptions = {
            scanScroll: scanOptions.scanScroll !== false,
            currentRowOnly: scanOptions.currentRowOnly === true,
            targetRowTop: Number.isFinite(Number(scanOptions.targetRowTop)) ? Number(scanOptions.targetRowTop) : null
        };

        return page.evaluate(async ({ knownKeys, safeLimit, scanOptions }) => {
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
            const extractImageUrl = (src) => {
                const normalized = normalizeSrc(src);
                try {
                    const url = new URL(normalized, window.location.href);
                    const embeddedUrl = url.searchParams.get('url');
                    return embeddedUrl ? normalizeSrc(embeddedUrl) : normalized;
                } catch (e) {
                    return normalized;
                }
            };
            const outputIdentity = (src) => {
                const outputSrc = extractImageUrl(src);
                const match = outputSrc.match(/\/output\/[^?#\s)]+/);
                return match ? match[0] : outputSrc;
            };
            const keys = new Set();
            for (const src of knownKeys || []) {
                const raw = String(src || '').split('#')[0];
                if (!raw) continue;
                keys.add(raw);
                keys.add(normalizeSrc(raw));
                keys.add(extractImageUrl(raw));
                keys.add(outputIdentity(raw));
            }

            const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
            const collected = new Map();
            let targetRowTop = Number.isFinite(scanOptions.targetRowTop) ? scanOptions.targetRowTop : null;
            const rowTolerance = 150;

            const isInTargetRow = (top) => {
                if (!scanOptions.currentRowOnly || targetRowTop === null) {
                    return true;
                }
                return Math.abs(Number(top) - Number(targetRowTop)) <= rowTolerance;
            };

            const inferTargetRowTop = () => {
                if (!scanOptions.currentRowOnly || targetRowTop !== null || collected.size === 0) {
                    return;
                }

                targetRowTop = Array.from(collected.values())
                    .map(item => Number(item.top))
                    .filter(value => Number.isFinite(value))
                    .sort((a, b) => a - b)[0] ?? null;
            };

            const getFinalValues = () => Array.from(collected.values())
                .filter(item => isInTargetRow(item.top))
                .sort((a, b) => {
                    const topDiff = a.top - b.top;
                    if (Math.abs(topDiff) > 8) return topDiff;
                    const leftDiff = a.left - b.left;
                    if (Math.abs(leftDiff) > 8) return leftDiff;
                    if (a.naturalArea !== b.naturalArea) return b.naturalArea - a.naturalArea;
                    if (a.area !== b.area) return b.area - a.area;
                    return a.index - b.index;
                })
                .slice(0, safeLimit)
                .map(item => ({
                    index: item.index,
                    src: item.src,
                    outputSrc: item.outputSrc,
                    width: item.naturalWidth,
                    height: item.naturalHeight,
                    displayWidth: item.width,
                    displayHeight: item.height,
                    left: item.left,
                    top: item.top,
                    identity: item.identity
                }));

            const collectVisibleOutputs = () => {
                Array.from(document.querySelectorAll('img'))
                    .map((img, index) => {
                    const rect = img.getBoundingClientRect();
                    const src = (img.currentSrc || img.src || '').split('#')[0];
                    const normalizedSrc = normalizeSrc(src);
                    const outputSrc = extractImageUrl(src);
                    const identity = outputIdentity(src);
                    const style = window.getComputedStyle(img);
                    return {
                        index,
                        src,
                        normalizedSrc,
                        outputSrc,
                        identity,
                        left: rect.left,
                        top: rect.top,
                        width: rect.width,
                        height: rect.height,
                        naturalWidth: img.naturalWidth || 0,
                        naturalHeight: img.naturalHeight || 0,
                        area: rect.width * rect.height,
                        naturalArea: (img.naturalWidth || 0) * (img.naturalHeight || 0),
                        visible: !!src &&
                            rect.width > 0 &&
                            rect.height > 0 &&
                            style.visibility !== 'hidden' &&
                            style.display !== 'none' &&
                            style.opacity !== '0'
                    };
                })
                .filter(item =>
                    item.visible &&
                    item.src &&
                    !keys.has(item.src) &&
                    !keys.has(item.normalizedSrc) &&
                    !keys.has(item.outputSrc) &&
                    !keys.has(item.identity) &&
                    item.outputSrc.includes('/output') &&
                    !item.outputSrc.includes('/input') &&
                    item.left > 300 &&
                    isInTargetRow(item.top) &&
                    item.width > 48 &&
                    item.height > 48 &&
                    item.naturalWidth > 128 &&
                    item.naturalHeight > 128
                )
                    .forEach(item => {
                        const key = item.identity || item.outputSrc || item.normalizedSrc || item.src;
                        const previous = collected.get(key);
                        if (!previous || item.area > previous.area || item.naturalArea > previous.naturalArea) {
                            collected.set(key, item);
                        }
                    });
            };

            collectVisibleOutputs();
            inferTargetRowTop();

            if (!scanOptions.scanScroll) {
                return getFinalValues();
            }

            const scrollContainers = Array.from(document.querySelectorAll('*'))
                .filter(el => {
                    const rect = el.getBoundingClientRect();
                    const style = window.getComputedStyle(el);
                    return el.scrollWidth > el.clientWidth + 40 &&
                        rect.left > 280 &&
                        rect.top > 60 &&
                        rect.width > 160 &&
                        rect.height > 100 &&
                        (!scanOptions.currentRowOnly || (
                            targetRowTop !== null &&
                            rect.height <= 420 &&
                            targetRowTop >= rect.top - rowTolerance &&
                            targetRowTop <= rect.bottom + rowTolerance
                        )) &&
                        style.display !== 'none' &&
                        style.visibility !== 'hidden';
                })
                .sort((a, b) => {
                    const rectA = a.getBoundingClientRect();
                    const rectB = b.getBoundingClientRect();
                    const areaA = rectA.width * rectA.height;
                    const areaB = rectB.width * rectB.height;
                    return areaB - areaA;
                })
                .slice(0, 8);

            const originalScrolls = scrollContainers.map(el => ({
                el,
                left: el.scrollLeft,
                top: el.scrollTop
            }));

            for (const el of scrollContainers) {
                const maxLeft = Math.max(0, el.scrollWidth - el.clientWidth);
                if (maxLeft <= 0) continue;

                const step = Math.max(120, Math.floor(el.clientWidth * 0.8));
                const positions = new Set([0, maxLeft]);
                for (let pos = step; pos < maxLeft; pos += step) {
                    positions.add(Math.min(maxLeft, pos));
                }

                for (const pos of positions) {
                    el.scrollLeft = pos;
                    el.dispatchEvent(new Event('scroll', { bubbles: true }));
                    await sleep(120);
                    collectVisibleOutputs();
                    inferTargetRowTop();
                    if (collected.size >= safeLimit) break;
                }

                if (collected.size >= safeLimit) break;
            }

            originalScrolls.forEach(item => {
                item.el.scrollLeft = item.left;
                item.el.scrollTop = item.top;
            });

            return getFinalValues();
        }, { knownKeys: beforeImageKeys, safeLimit, scanOptions: safeScanOptions }).catch(() => []);
    }

    async getFailedOutputSlotInfos(page, outputInfos = [], limit = 4, scanOptions = {}) {
        const safeLimit = Math.max(1, Math.min(4, Number(limit) || 1));
        const outputRows = (Array.isArray(outputInfos) ? outputInfos : [])
            .map(item => Number(item.top))
            .filter(value => Number.isFinite(value));
        const safeScanOptions = {
            scanScroll: scanOptions.scanScroll !== false,
            currentRowOnly: scanOptions.currentRowOnly === true,
            targetRowTop: Number.isFinite(Number(scanOptions.targetRowTop)) ? Number(scanOptions.targetRowTop) : null
        };

        return page.evaluate(async ({ outputRows, safeLimit, scanOptions }) => {
            const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
            const failedPattern = /(图片已被.*咬坏|图片.*咬坏|生成失败|图片生成失败|加载失败|图片加载失败|图片损坏|图片异常|出图失败|任务失败|内容违规|审核未通过|无法生成|生成异常|出错了|失败)/;
            const collected = new Map();
            const rowTolerance = 150;
            const targetRowTop = Number.isFinite(scanOptions.targetRowTop) ? scanOptions.targetRowTop : null;

            const isVisible = (el) => {
                const rect = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return rect.width > 0 &&
                    rect.height > 0 &&
                    style.visibility !== 'hidden' &&
                    style.display !== 'none' &&
                    style.opacity !== '0';
            };

            const resolveSlotBox = (el) => {
                let current = el;
                for (let i = 0; i < 8 && current; i++) {
                    const rect = current.getBoundingClientRect();
                    if (rect.left > 300 && rect.width >= 120 && rect.height >= 100) {
                        return {
                            el: current,
                            rect
                        };
                    }
                    current = current.parentElement;
                }

                const rect = el.getBoundingClientRect();
                return {
                    el,
                    rect
                };
            };

            const belongsToCurrentOutputRow = (top) => {
                if (scanOptions.currentRowOnly && targetRowTop !== null) {
                    return Math.abs(Number(targetRowTop) - Number(top)) <= rowTolerance;
                }
                if (!outputRows.length) {
                    return false;
                }
                return outputRows.some(rowTop => Math.abs(Number(rowTop) - Number(top)) <= 140);
            };

            const collectVisibleFailures = () => {
                for (const el of document.querySelectorAll('div, span, p')) {
                    if (!isVisible(el)) continue;

                    const text = String(el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
                    if (!text || !failedPattern.test(text)) continue;

                    const { rect } = resolveSlotBox(el);
                    if (rect.left <= 300 || rect.width < 80 || rect.height < 60) continue;
                    if (!belongsToCurrentOutputRow(rect.top)) continue;

                    const key = `${Math.round(rect.top / 20)}:${Math.round(rect.left / 20)}:${text.slice(0, 24)}`;
                    if (!collected.has(key)) {
                        collected.set(key, {
                            text,
                            left: rect.left,
                            top: rect.top,
                            width: rect.width,
                            height: rect.height
                        });
                    }
                }
            };

            collectVisibleFailures();

            const getFinalValues = () => Array.from(collected.values())
                .sort((a, b) => {
                    const topDiff = a.top - b.top;
                    if (Math.abs(topDiff) > 8) return topDiff;
                    return a.left - b.left;
                })
                .slice(0, safeLimit);

            if (!scanOptions.scanScroll) {
                return getFinalValues();
            }

            const scrollContainers = Array.from(document.querySelectorAll('*'))
                .filter(el => {
                    const rect = el.getBoundingClientRect();
                    const style = window.getComputedStyle(el);
                    return el.scrollWidth > el.clientWidth + 40 &&
                        rect.left > 280 &&
                        rect.top > 60 &&
                        rect.width > 160 &&
                        rect.height > 100 &&
                        (!scanOptions.currentRowOnly || (
                            targetRowTop !== null &&
                            rect.height <= 420 &&
                            targetRowTop >= rect.top - rowTolerance &&
                            targetRowTop <= rect.bottom + rowTolerance
                        )) &&
                        style.display !== 'none' &&
                        style.visibility !== 'hidden';
                })
                .sort((a, b) => {
                    const rectA = a.getBoundingClientRect();
                    const rectB = b.getBoundingClientRect();
                    const areaA = rectA.width * rectA.height;
                    const areaB = rectB.width * rectB.height;
                    return areaB - areaA;
                })
                .slice(0, 8);

            const originalScrolls = scrollContainers.map(el => ({
                el,
                left: el.scrollLeft,
                top: el.scrollTop
            }));

            for (const el of scrollContainers) {
                const maxLeft = Math.max(0, el.scrollWidth - el.clientWidth);
                if (maxLeft <= 0) continue;

                const step = Math.max(120, Math.floor(el.clientWidth * 0.8));
                const positions = new Set([0, maxLeft]);
                for (let pos = step; pos < maxLeft; pos += step) {
                    positions.add(Math.min(maxLeft, pos));
                }

                for (const pos of positions) {
                    el.scrollLeft = pos;
                    el.dispatchEvent(new Event('scroll', { bubbles: true }));
                    await sleep(120);
                    collectVisibleFailures();
                    if (collected.size >= safeLimit) break;
                }

                if (collected.size >= safeLimit) break;
            }

            originalScrolls.forEach(item => {
                item.el.scrollLeft = item.left;
                item.el.scrollTop = item.top;
            });

            return getFinalValues();
        }, {
            outputRows,
            safeLimit,
            scanOptions: safeScanOptions
        }).catch(() => []);
    }

    resolveDownloadUrl(rawUrl, pageUrl) {
        const extracted = extractLegilImageUrl(rawUrl);
        const withoutResize = extracted.includes('resize')
            ? extracted.replace(/resize,w_\d+,h_\d+,?/, '')
            : extracted;
        return new URL(withoutResize, pageUrl).href;
    }

    async downloadImageToFile(page, imageUrl, savePath, options = {}) {
        throwIfAborted(options);
        const context = page.context();
        const headers = {
            referer: page.url()
        };

        try {
            headers.origin = new URL(page.url()).origin;
        } catch (e) {}

        const userAgent = await page.evaluate(() => navigator.userAgent).catch(() => '');
        if (userAgent) {
            headers['user-agent'] = userAgent;
        }

        const response = await context.request.get(imageUrl, { headers });

        if (!response.ok()) {
            throw new Error(`下载失败: HTTP ${response.status()}`);
        }

        const buffer = await response.body();
        if (!buffer || buffer.length === 0) {
            throw new Error('下载的数据为空');
        }

        fs.writeFileSync(savePath, buffer);
        return this.validateSavedImageFile(savePath);
    }

    validateSavedImageFile(savePath) {
        if (!fs.existsSync(savePath)) {
            throw new Error('文件未写入');
        }

        const stats = fs.statSync(savePath);
        if (stats.size <= 1000) {
            try {
                fs.unlinkSync(savePath);
            } catch (e) {}
            throw new Error('保存的文件无效');
        }

        return stats.size;
    }

    async fetchImageInPageToFile(page, imageUrl, savePath, options = {}) {
        throwIfAborted(options);

        const base64 = await page.evaluate(async (url) => {
            const response = await fetch(url, {
                credentials: 'include',
                referrer: window.location.href
            });

            if (!response.ok) {
                throw new Error(`页面内下载失败: HTTP ${response.status}`);
            }

            const blob = await response.blob();
            if (!blob || blob.size <= 0) {
                throw new Error('页面内下载的数据为空');
            }

            return await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => {
                    const result = String(reader.result || '');
                    const commaIndex = result.indexOf(',');
                    resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
                };
                reader.onerror = () => reject(new Error('读取图片数据失败'));
                reader.readAsDataURL(blob);
            });
        }, imageUrl);

        const buffer = Buffer.from(base64, 'base64');
        if (!buffer || buffer.length === 0) {
            throw new Error('页面内下载的数据为空');
        }

        fs.writeFileSync(savePath, buffer);
        return this.validateSavedImageFile(savePath);
    }

    async getOutputImageElement(page, imageInfo, beforeImageKeys = []) {
        const handle = await page.evaluateHandle(async ({ info, knownKeys }) => {
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
            const extractImageUrl = (src) => {
                const normalized = normalizeSrc(src);
                try {
                    const url = new URL(normalized, window.location.href);
                    const embeddedUrl = url.searchParams.get('url');
                    return embeddedUrl ? normalizeSrc(embeddedUrl) : normalized;
                } catch (e) {
                    return normalized;
                }
            };
            const outputIdentity = (src) => {
                const outputSrc = extractImageUrl(src);
                const match = outputSrc.match(/\/output\/[^?#\s)]+/);
                return match ? match[0] : outputSrc;
            };
            const keys = new Set();
            for (const src of knownKeys || []) {
                const raw = String(src || '').split('#')[0];
                if (!raw) continue;
                keys.add(raw);
                keys.add(normalizeSrc(raw));
                keys.add(extractImageUrl(raw));
                keys.add(outputIdentity(raw));
            }

            const targetCandidates = [
                info?.outputSrc,
                info?.src,
                info?.identity
            ].filter(Boolean);
            const targetSet = new Set();
            for (const src of targetCandidates) {
                targetSet.add(String(src).split('#')[0]);
                targetSet.add(normalizeSrc(src));
                targetSet.add(extractImageUrl(src));
                targetSet.add(outputIdentity(src));
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
            const targetRowTop = Number.isFinite(Number(info?.top)) ? Number(info.top) : null;
            const rowTolerance = 150;
            const isInTargetRow = (top) => {
                if (targetRowTop === null) {
                    return true;
                }
                return Math.abs(Number(top) - Number(targetRowTop)) <= rowTolerance;
            };

            const sortCandidates = (candidates) => candidates.sort((a, b) => {
                    const topDiff = a.top - b.top;
                    if (Math.abs(topDiff) > 8) return topDiff;
                    const leftDiff = a.left - b.left;
                    if (Math.abs(leftDiff) > 8) return leftDiff;
                    if (a.naturalArea !== b.naturalArea) return b.naturalArea - a.naturalArea;
                    if (a.area !== b.area) return b.area - a.area;
                    return a.index - b.index;
                });

            const collectCandidates = () => sortCandidates(Array.from(document.querySelectorAll('img'))
                .map((img, index) => {
                    const rect = img.getBoundingClientRect();
                    const src = (img.currentSrc || img.src || '').split('#')[0];
                    const normalizedSrc = normalizeSrc(src);
                    const outputSrc = extractImageUrl(src);
                    const identity = outputIdentity(src);
                    return {
                        img,
                        index,
                        src,
                        normalizedSrc,
                        outputSrc,
                        identity,
                        left: rect.left,
                        top: rect.top,
                        width: rect.width,
                        height: rect.height,
                        area: rect.width * rect.height,
                        naturalArea: (img.naturalWidth || 0) * (img.naturalHeight || 0),
                        visible: isVisible(img)
                    };
                })
                .filter(item =>
                    item.visible &&
                    item.src &&
                    item.left > 300 &&
                    isInTargetRow(item.top) &&
                    item.width > 48 &&
                    item.height > 48 &&
                    item.outputSrc.includes('/output') &&
                    !item.outputSrc.includes('/input') &&
                    !keys.has(item.src) &&
                    !keys.has(item.normalizedSrc) &&
                    !keys.has(item.outputSrc) &&
                    !keys.has(item.identity) &&
                    (
                        targetSet.has(item.src) ||
                        targetSet.has(item.normalizedSrc) ||
                        targetSet.has(item.outputSrc) ||
                        targetSet.has(item.identity)
                    )
                ));

            let candidates = collectCandidates();
            if (candidates[0]) {
                return candidates[0].img;
            }

            const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
            const scrollContainers = Array.from(document.querySelectorAll('*'))
                .filter(el => {
                    const rect = el.getBoundingClientRect();
                    const style = window.getComputedStyle(el);
                    return el.scrollWidth > el.clientWidth + 40 &&
                        rect.left > 280 &&
                        rect.top > 60 &&
                        rect.width > 160 &&
                        rect.height > 100 &&
                        (
                            targetRowTop === null ||
                            (
                                rect.height <= 420 &&
                                targetRowTop >= rect.top - rowTolerance &&
                                targetRowTop <= rect.bottom + rowTolerance
                            )
                        ) &&
                        style.display !== 'none' &&
                        style.visibility !== 'hidden';
                })
                .sort((a, b) => {
                    const rectA = a.getBoundingClientRect();
                    const rectB = b.getBoundingClientRect();
                    const areaA = rectA.width * rectA.height;
                    const areaB = rectB.width * rectB.height;
                    return areaB - areaA;
                })
                .slice(0, 8);

            const originalScrolls = scrollContainers.map(el => ({
                el,
                left: el.scrollLeft,
                top: el.scrollTop
            }));

            for (const el of scrollContainers) {
                const maxLeft = Math.max(0, el.scrollWidth - el.clientWidth);
                if (maxLeft <= 0) continue;

                const step = Math.max(120, Math.floor(el.clientWidth * 0.8));
                const positions = new Set([0, maxLeft]);
                for (let pos = step; pos < maxLeft; pos += step) {
                    positions.add(Math.min(maxLeft, pos));
                }

                for (const pos of positions) {
                    el.scrollLeft = pos;
                    el.dispatchEvent(new Event('scroll', { bubbles: true }));
                    await sleep(150);
                    candidates = collectCandidates();
                    if (candidates[0]) {
                        return candidates[0].img;
                    }
                }
            }

            originalScrolls.forEach(item => {
                item.el.scrollLeft = item.left;
                item.el.scrollTop = item.top;
            });

            return null;
        }, {
            info: imageInfo || {},
            knownKeys: beforeImageKeys
        }).catch(() => null);

        return handle ? handle.asElement() : null;
    }

    async screenshotImageElementToFile(page, imageInfo, savePath, beforeImageKeys = [], options = {}) {
        throwIfAborted(options);
        const imageElement = await this.getOutputImageElement(page, imageInfo, beforeImageKeys);

        if (!imageElement) {
            throw new Error('未找到可截图的输出图片元素');
        }

        await imageElement.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
        await interruptibleSleep(300, options);

        try {
            await imageElement.screenshot({ path: savePath, timeout: 8000 });
        } catch (error) {
            const box = await imageElement.boundingBox();
            if (!box || box.width <= 0 || box.height <= 0) {
                throw error;
            }
            await page.screenshot({
                path: savePath,
                clip: {
                    x: Math.max(0, box.x),
                    y: Math.max(0, box.y),
                    width: box.width,
                    height: box.height
                },
                timeout: 8000
            });
        }

        return this.validateSavedImageFile(savePath);
    }

    async screenshotElementToFile(page, element, savePath, options = {}) {
        throwIfAborted(options);

        if (!element) {
            throw new Error('未找到可截图的图片元素');
        }

        await element.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
        await interruptibleSleep(300, options);

        try {
            await element.screenshot({ path: savePath, timeout: 8000 });
        } catch (error) {
            const box = await element.boundingBox();
            if (!box || box.width <= 0 || box.height <= 0) {
                throw error;
            }

            await page.screenshot({
                path: savePath,
                clip: {
                    x: Math.max(0, box.x),
                    y: Math.max(0, box.y),
                    width: box.width,
                    height: box.height
                },
                timeout: 8000
            });
        }

        return this.validateSavedImageFile(savePath);
    }

    async clickImageElement(page, element, options = {}) {
        throwIfAborted(options);

        try {
            await element.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
            await element.click({ timeout: 5000 });
            return true;
        } catch (clickError) {
            logger.warn(`点击输出图失败，尝试坐标点击: ${clickError.message.split('\n')[0]}`);
        }

        const box = await element.boundingBox().catch(() => null);
        if (!box || box.width <= 0 || box.height <= 0) {
            return false;
        }

        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        return true;
    }

    async getOpenedPreviewImageElement(page, fallbackSrc) {
        const handle = await page.evaluateHandle(({ fallbackSrc }) => {
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
            const extractImageUrl = (src) => {
                const normalized = normalizeSrc(src);
                try {
                    const url = new URL(normalized, window.location.href);
                    const embeddedUrl = url.searchParams.get('url');
                    return embeddedUrl ? normalizeSrc(embeddedUrl) : normalized;
                } catch (e) {
                    return normalized;
                }
            };
            const outputIdentity = (src) => {
                const outputSrc = extractImageUrl(src);
                const match = outputSrc.match(/\/output\/[^?#\s)]+/);
                return match ? match[0] : '';
            };
            const isVisible = (el) => {
                const rect = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return rect.width > 0 &&
                    rect.height > 0 &&
                    style.visibility !== 'hidden' &&
                    style.display !== 'none' &&
                    style.opacity !== '0';
            };

            const fallbackIdentity = outputIdentity(fallbackSrc);
            if (!fallbackIdentity) {
                return null;
            }

            const selectors = [
                'div[role="dialog"] img',
                '.ant-modal img',
                '[class*="modal"] img',
                '[class*="preview"] img',
                '[class*="lightbox"] img',
                '[class*="fullscreen"] img',
                'img'
            ];

            const candidates = [];
            for (const selector of selectors) {
                for (const img of document.querySelectorAll(selector)) {
                    if (!isVisible(img)) continue;
                    const src = img.currentSrc || img.src || '';
                    if (!src || outputIdentity(src) !== fallbackIdentity) continue;

                    const rect = img.getBoundingClientRect();
                    candidates.push({
                        img,
                        inPreview: /dialog|modal|preview|lightbox|fullscreen/i.test(selector),
                        left: rect.left,
                        top: rect.top,
                        area: rect.width * rect.height,
                        naturalArea: (img.naturalWidth || 0) * (img.naturalHeight || 0)
                    });
                }
            }

            candidates.sort((a, b) => {
                if (a.inPreview !== b.inPreview) return a.inPreview ? -1 : 1;
                if (a.naturalArea !== b.naturalArea) return b.naturalArea - a.naturalArea;
                if (a.area !== b.area) return b.area - a.area;
                const topDiff = a.top - b.top;
                if (Math.abs(topDiff) > 8) return topDiff;
                return a.left - b.left;
            });

            return candidates[0]?.img || null;
        }, { fallbackSrc }).catch(() => null);

        return handle ? handle.asElement() : null;
    }

    async saveOpenedPreviewToFile(page, previewElement, fallbackElement, fallbackSrc, savePath, options = {}) {
        throwIfAborted(options);

        const sourceElement = previewElement || fallbackElement;
        const sourceInfo = sourceElement
            ? await sourceElement.evaluate(el => ({
                src: el.currentSrc || el.src || '',
                width: el.naturalWidth || 0,
                height: el.naturalHeight || 0
            })).catch(() => null)
            : null;

        const sourceSrc = sourceInfo?.src || fallbackSrc;
        let savedSize = 0;

        if (sourceSrc && isLegilOutputUrl(sourceSrc)) {
            const downloadUrl = this.resolveDownloadUrl(sourceSrc, page.url());

            try {
                savedSize = await this.downloadImageToFile(page, downloadUrl, savePath, options);
            } catch (downloadError) {
                logger.warn(`大图直链下载失败，尝试页面内下载: ${downloadError.message}`);
            }

            if (!savedSize) {
                try {
                    savedSize = await this.fetchImageInPageToFile(page, downloadUrl, savePath, options);
                } catch (pageFetchError) {
                    logger.warn(`大图页面内下载失败，改用大图截图保存: ${pageFetchError.message}`);
                }
            }
        }

        if (!savedSize) {
            savedSize = await this.screenshotElementToFile(page, sourceElement, savePath, options);
        }

        return savedSize;
    }

    async saveOutputImageByOpening(page, imageInfo, savePath, beforeImageKeys = [], options = {}) {
        let previewOpen = false;

        try {
            throwIfAborted(options);

            const thumbnailElement = await this.getOutputImageElement(page, imageInfo, beforeImageKeys);
            if (!thumbnailElement) {
                throw new Error('未找到本次输出图缩略图');
            }

            const thumbInfo = await thumbnailElement.evaluate(el => ({
                src: el.src,
                currentSrc: el.currentSrc || el.src,
                width: el.naturalWidth || 0,
                height: el.naturalHeight || 0
            }));

            const thumbSrc = thumbInfo.currentSrc || thumbInfo.src;
            if (!isLegilOutputUrl(thumbSrc)) {
                throw new Error('候选图片不是 Legil 输出图，已停止保存以避免拿到参考图或历史图');
            }

            logger.info(`打开输出图大图: ${thumbInfo.width}x${thumbInfo.height}`);
            const clicked = await this.clickImageElement(page, thumbnailElement, options);
            if (!clicked) {
                throw new Error('点击输出图失败');
            }

            previewOpen = true;
            await interruptibleSleep(3000, options);

            const previewElement = await this.getOpenedPreviewImageElement(page, thumbSrc);
            const savedSize = await this.saveOpenedPreviewToFile(page, previewElement, thumbnailElement, thumbSrc, savePath, options);

            return savedSize;
        } finally {
            if (previewOpen) {
                await page.keyboard.press('Escape').catch(() => {});
                await interruptibleSleep(500, options).catch(() => {});
            }
        }
    }

    async saveGeneratedImages(page, promptIndex, options = {}) {
        try {
            throwIfAborted(options);

            if (!fs.existsSync(this.saveFolder)) {
                fs.mkdirSync(this.saveFolder, { recursive: true });
            }

            const expectedOutputCount = LEGIL_OUTPUT_QUANTITIES.includes(Number(options.expectedOutputCount))
                ? Number(options.expectedOutputCount)
                : 1;
            const beforeKeys = Array.isArray(options.beforeImageKeys) ? options.beforeImageKeys : [];
            const imageInfos = await this.getNewOutputImageInfos(page, beforeKeys, expectedOutputCount, {
                scanScroll: true,
                currentRowOnly: true
            });

            if (imageInfos.length === 0) {
                throw new Error('未找到本次新生成的输出图');
            }

            if (imageInfos.length < expectedOutputCount) {
                logger.warn(`只检测到 ${imageInfos.length}/${expectedOutputCount} 张新输出图，将保存已检测到的图片`);
            }

            const savePaths = [];

            for (let i = 0; i < imageInfos.length; i++) {
                throwIfAborted(options);
                const info = imageInfos[i];
                const outputUrl = info.outputSrc || info.src || '';

                if (!isLegilOutputUrl(outputUrl)) {
                    logger.warn(`跳过非输出图地址: ${outputUrl.substring(0, 80)}...`);
                    continue;
                }

                const fileName = this.buildOutputFileName(promptIndex, {
                    ...options,
                    variantIndex: i + 1
                });
                const savePath = path.join(this.saveFolder, fileName);

                logger.info(`正在打开并保存第 ${i + 1}/${imageInfos.length} 张输出图: ${outputUrl.substring(0, 80)}...`);

                try {
                    const savedSize = await this.saveOutputImageByOpening(page, info, savePath, beforeKeys, options);
                    logger.info(`✅ 图片保存成功: ${fileName} (${(savedSize / 1024).toFixed(2)} KB)`);
                    savePaths.push(savePath);
                } catch (saveError) {
                    logger.error(`第 ${i + 1}/${imageInfos.length} 张输出图保存失败: ${saveError.message}`);
                }
            }

            return savePaths;
        } catch (error) {
            logger.error(`保存图片失败: ${error.message}`);
            await page.keyboard.press('Escape').catch(() => {});
            return [];
        }
    }

    /**
     * =====================================================
     * 保存生成的图片（点击缩略图打开大图后保存）
     * =====================================================
     */
    async saveGeneratedImage(page, promptIndex, options = {}) {
        try {
            throwIfAborted(options);

            // 确保保存目录存在
            if (!fs.existsSync(this.saveFolder)) {
                fs.mkdirSync(this.saveFolder, { recursive: true });
            }

            // 生成文件名。工作流会传入全局流水号，确保资源管理器按名称排序时就是生成顺序。
            const fileName = this.buildOutputFileName(promptIndex, options);
            const savePath = path.join(this.saveFolder, fileName);

            logger.info('正在查找缩略图...');

            const beforeKeys = Array.isArray(options.beforeImageKeys) ? options.beforeImageKeys : [];

            // 第1步：优先选择本次生成后新出现的右侧大图，避免保存历史图或参考图
            const thumbnailHandle = await page.evaluateHandle((knownKeys) => {
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
                const extractImageUrl = (src) => {
                    const normalized = normalizeSrc(src);
                    try {
                        const url = new URL(normalized, window.location.href);
                        const embeddedUrl = url.searchParams.get('url');
                        return embeddedUrl ? normalizeSrc(embeddedUrl) : normalized;
                    } catch (e) {
                        return normalized;
                    }
                };
                const keys = new Set();
                for (const src of knownKeys || []) {
                    const raw = String(src || '').split('#')[0];
                    if (!raw) continue;
                    keys.add(raw);
                    keys.add(normalizeSrc(raw));
                    keys.add(extractImageUrl(raw));
                }

                const candidates = Array.from(document.querySelectorAll('img'))
                    .map((img, index) => {
                        const rect = img.getBoundingClientRect();
                        const src = (img.currentSrc || img.src || '').split('#')[0];
                        const normalizedSrc = normalizeSrc(src);
                        const outputSrc = extractImageUrl(src);
                        const visible = !!src &&
                            rect.width > 0 &&
                            rect.height > 0 &&
                            window.getComputedStyle(img).visibility !== 'hidden' &&
                            window.getComputedStyle(img).display !== 'none';
                        return {
                            img,
                            index,
                            src,
                            normalizedSrc,
                            outputSrc,
                            isOutput: outputSrc.includes('/output') && !outputSrc.includes('/input'),
                            isNew: src && !keys.has(src) && !keys.has(normalizedSrc) && !keys.has(outputSrc),
                            isRightSide: rect.left > 300,
                            area: rect.width * rect.height,
                            naturalArea: (img.naturalWidth || 0) * (img.naturalHeight || 0),
                            width: rect.width,
                            height: rect.height,
                            naturalWidth: img.naturalWidth || 0,
                            naturalHeight: img.naturalHeight || 0,
                            visible
                        };
                    })
                    .filter(item =>
                        item.visible &&
                        item.isNew &&
                        item.isOutput &&
                        item.isRightSide &&
                        item.width > 128 &&
                        item.height > 128 &&
                        item.naturalWidth > 128 &&
                        item.naturalHeight > 128
                    )
                    .sort((a, b) => {
                        if (a.isNew !== b.isNew) return a.isNew ? -1 : 1;
                        if (a.naturalArea !== b.naturalArea) return b.naturalArea - a.naturalArea;
                        if (a.area !== b.area) return b.area - a.area;
                        return b.index - a.index;
                    });

                return candidates[0]?.img || null;
            }, beforeKeys);

            const thumbnailElement = await thumbnailHandle.asElement();
            if (!thumbnailElement) {
                throw new Error('未找到缩略图');
            }

            // 获取缩略图信息
            const thumbInfo = await thumbnailElement.evaluate(el => ({
                src: el.src,
                currentSrc: el.currentSrc || el.src,
                width: el.naturalWidth,
                height: el.naturalHeight
            }));

            const thumbSrc = thumbInfo.currentSrc || thumbInfo.src;
            if (!isLegilOutputUrl(thumbSrc)) {
                throw new Error('候选图片不是 Legil 输出图，已停止保存以避免拿到参考图或历史图');
            }

            logger.info(`找到缩略图: ${thumbInfo.width}x${thumbInfo.height}`);
            logger.info('点击缩略图打开大图...');

            // 第2步：使用 Playwright 点击缩略图（模拟真实点击）
            await thumbnailElement.click();
            logger.info('已点击，等待大图弹窗...');

            // 等待弹窗出现
            await interruptibleSleep(3000, options);

            // 第3步：获取完整大图的地址
            logger.info('查找完整大图...');

            // 先尝试查找弹窗中的大图
            let fullImageSrc = await page.evaluate(({ fallbackSrc }) => {
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
                const extractImageUrl = (src) => {
                    const normalized = normalizeSrc(src);
                    try {
                        const url = new URL(normalized, window.location.href);
                        const embeddedUrl = url.searchParams.get('url');
                        return embeddedUrl ? normalizeSrc(embeddedUrl) : normalized;
                    } catch (e) {
                        return normalized;
                    }
                };
                const outputIdentity = (src) => {
                    const outputSrc = extractImageUrl(src);
                    const match = outputSrc.match(/\/output\/[^?#\s)]+/);
                    return match ? match[0] : '';
                };
                const fallbackIdentity = outputIdentity(fallbackSrc);

                // 方法1：查找弹窗/模态框中与当前缩略图同一张输出图的大图
                const modalSelectors = [
                    'div[role="dialog"] img',
                    '.ant-modal img',
                    '[class*="modal"] img',
                    '[class*="preview"] img',
                    '[class*="lightbox"] img',
                    '[class*="fullscreen"] img'
                ];

                for (const selector of modalSelectors) {
                    const imgs = document.querySelectorAll(selector);
                    for (const img of imgs) {
                        const src = img.currentSrc || img.src || '';
                        if (src &&
                            fallbackIdentity &&
                            outputIdentity(src) === fallbackIdentity &&
                            img.naturalWidth > 500 &&
                            img.naturalHeight > 500) {
                            return src;
                        }
                    }
                }

                // 方法2：查找页面中与当前缩略图同源的最大右侧图片（可能是展开后的）
                const allImgs = document.querySelectorAll('img');
                let bestImg = null;
                let maxArea = 0;

                for (const img of allImgs) {
                    const rect = img.getBoundingClientRect();
                    const src = img.currentSrc || img.src || '';
                    // 查找尺寸大于800的大图
                    if (src &&
                        fallbackIdentity &&
                        outputIdentity(src) === fallbackIdentity &&
                        rect.left > 300 &&
                        img.naturalWidth > 800 &&
                        img.naturalHeight > 800) {
                        const area = img.naturalWidth * img.naturalHeight;
                        if (area > maxArea) {
                            maxArea = area;
                            bestImg = img;
                        }
                    }
                }

                if (bestImg) {
                    return bestImg.currentSrc || bestImg.src;
                }

                return fallbackSrc || null;
            }, { fallbackSrc: thumbSrc });

            // 如果没找到大图，尝试从缩略图 URL 推断
            if (!fullImageSrc) {
                logger.info('未找到弹窗大图，尝试从缩略图 URL 获取原图...');
                fullImageSrc = thumbSrc;
            }

            if (!fullImageSrc) {
                throw new Error('未找到可下载的图片地址');
            }

            if (!isLegilOutputUrl(fullImageSrc)) {
                throw new Error('下载地址不是 Legil 输出图，已停止保存以避免拿到参考图或历史图');
            }

            // Legil 的 URL 格式：包含 resize 参数，移除后获取原图
            if (fullImageSrc.includes('resize')) {
                fullImageSrc = fullImageSrc.replace(/resize,w_\d+,h_\d+,?/, '');
                logger.info('已移除 resize 参数');
            }

            logger.info(`找到完整大图: ${fullImageSrc.substring(0, 80)}...`);

            // 第4步：下载图片
            logger.info('正在保存图片...');
            throwIfAborted(options);

            let savedSize = 0;
            const fullDownloadUrl = this.resolveDownloadUrl(fullImageSrc, page.url());

            try {
                savedSize = await this.downloadImageToFile(page, fullDownloadUrl, savePath, options);
            } catch (downloadError) {
                logger.warn(`直链下载失败，尝试页面内下载: ${downloadError.message}`);
            }

            if (!savedSize) {
                try {
                    savedSize = await this.fetchImageInPageToFile(page, fullDownloadUrl, savePath, options);
                } catch (pageFetchError) {
                    logger.warn(`页面内下载失败，改用图片元素截图保存: ${pageFetchError.message}`);
                }
            }

            if (!savedSize) {
                await thumbnailElement.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
                await thumbnailElement.screenshot({ path: savePath, timeout: 8000 });
                savedSize = this.validateSavedImageFile(savePath);
            }

            // 验证文件
            if (fs.existsSync(savePath)) {
                const stats = fs.statSync(savePath);
                if (stats.size > 1000) {
                    logger.info(`✅ 图片保存成功: ${fileName} (${(stats.size/1024).toFixed(2)} KB)`);

                    // 关闭弹窗（按 Escape）
                    await page.keyboard.press('Escape');
                    await interruptibleSleep(500, options);

                    return savePath;
                }
            }

            throw new Error('保存的文件无效');

        } catch (error) {
            logger.error(`保存图片失败: ${error.message}`);
            await page.keyboard.press('Escape').catch(() => {});
            return null;
        }
    }
}

// 导出单例实例
module.exports = new LegilAutomation();
