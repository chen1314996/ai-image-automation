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

// 引入工作流控制器（用于检查停止状态）
let workflowController = null;
function getWorkflowController() {
    if (!workflowController) {
        try {
            workflowController = require('./workflow-controller');
        } catch (e) {
            return null;
        }
    }
    return workflowController;
}

// 可中断的sleep函数
async function interruptibleSleep(ms) {
    const checkInterval = 500; // 每500毫秒检查一次
    const startTime = Date.now();
    while (Date.now() - startTime < ms) {
        const wfController = getWorkflowController();
        if (wfController && !wfController.isRunning) {
            return; // 工作流已停止，提前返回
        }
        await browserController.sleep(Math.min(checkInterval, ms - (Date.now() - startTime)));
    }
}

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

            this.referenceImages = files
                .filter(file => {
                    const ext = path.extname(file).toLowerCase();
                    return imageExtensions.includes(ext);
                })
                .map(file => path.join(this.referenceFolder, file))
                .sort();

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
        logger.info(`========================================`);
        logger.info(`开始 Legil 自动化流程 - 第 ${promptIndex} 张图片`);
        logger.info(`========================================`);

        // 如果指定了参考图文件夹，则使用指定的
        if (options.referenceFolder) {
            this.setReferenceFolder(options.referenceFolder);
        }

        try {
            // 第1步：获取 Legil 页面
            let page = browserController.getPage('legil');
            if (!page || page.isClosed()) {
                logger.warn('Legil 页面未打开，正在打开...');
                const opened = await browserController.openWebsite('legil', 'https://lumos.diandian.info/legil/image-to-image');
                if (!opened) {
                    throw new Error('无法打开 Legil 页面');
                }
                page = browserController.getPage('legil');
                await interruptibleSleep(5000);
            }

            // 第2步：上传参考图（如果配置了参考图文件夹）
            if (this.referenceImages.length > 0 || fs.existsSync(this.referenceFolder)) {
                logger.info('[步骤1/5] 正在上传参考图...');
                const uploadSuccess = await this.uploadReferenceImage(page);
                if (uploadSuccess) {
                    logger.info('✅ 参考图上传成功');
                    // 等待图片上传完成并生效
                    await interruptibleSleep(3000);
                } else {
                    logger.warn('⚠️ 参考图上传失败，继续生成流程');
                }
            } else {
                logger.info('[步骤1/5] 跳过参考图上传（未配置参考图文件夹）');
            }

            // 第3步：填入提示词
            logger.info('[步骤2/5] 正在填入提示词...');
            const inputSuccess = await this.inputPrompt(page, prompt);
            if (!inputSuccess) {
                throw new Error('填入提示词失败');
            }

            // 第4步：点击生成按钮
            logger.info('[步骤3/5] 正在点击生成按钮...');
            const clickSuccess = await this.clickGenerateButton(page);
            if (!clickSuccess) {
                throw new Error('点击生成按钮失败');
            }

            // 第5步：等待图片生成完成
            logger.info('[步骤4/5] 等待图片生成完成（约3-5分钟）...');
            const generateSuccess = await this.waitForGenerationComplete(page);
            if (!generateSuccess) {
                throw new Error('等待图片生成超时');
            }

            // 第6步：保存生成的图片
            logger.info('[步骤5/5] 正在保存生成的图片...');
            const savePath = await this.saveGeneratedImage(page, promptIndex);
            if (!savePath) {
                throw new Error('保存图片失败');
            }

            logger.info(`========================================`);
            logger.info(`✅ 流程完成！图片已保存`);
            logger.info(`📁 保存路径: ${savePath}`);
            logger.info(`========================================`);

            return {
                success: true,
                savePath: savePath,
                message: '图片生成并保存成功'
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

    /**
     * =====================================================
     * 上传参考图到 Legil
     * =====================================================
     */
    async uploadReferenceImage(page) {
        try {
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

            logger.info(`准备上传参考图: ${path.basename(imagePath)}`);

            // 等待页面完全加载
            await page.waitForLoadState('networkidle');
            await interruptibleSleep(2000);

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
                                await interruptibleSleep(2000);

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
            await interruptibleSleep(3000);

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
                                await interruptibleSleep(2000);
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
    async inputPrompt(page, prompt) {
        try {
            // 等待页面完全加载
            await page.waitForLoadState('networkidle');
            await interruptibleSleep(2000);

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
            await inputElement.fill(prompt);
            logger.info('提示词已填入');
            return true;

        } catch (error) {
            logger.error(`填入提示词失败: ${error.message}`);
            return false;
        }
    }

    /**
     * =====================================================
     * 点击生成按钮
     * =====================================================
     */
    async clickGenerateButton(page) {
        try {
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

    /**
     * =====================================================
     * 等待图片生成完成
     * =====================================================
     */
    async waitForGenerationComplete(page) {
        const maxWaitTime = 300000;
        const checkInterval = 3000;
        let waited = 0;

        logger.info('等待图片生成中...');

        while (waited < maxWaitTime) {
            // 检查工作流是否已停止
            const wfController = getWorkflowController();
            if (wfController && !wfController.isRunning) {
                logger.info('⏹️ 检测到工作流已停止，中断等待');
                return false;
            }

            await interruptibleSleep(checkInterval);
            waited += checkInterval;

            const createButton = await page.$('button:has-text("创建图片")');
            if (createButton) {
                const isVisible = await createButton.isVisible().catch(() => false);
                if (isVisible) {
                    logger.info('✅ 检测到"创建图片"按钮，生成完成');
                    await interruptibleSleep(3000);
                    return true;
                }
            }

            if (waited % 30000 === 0) {
                logger.info(`⏳ 已等待 ${waited / 1000} 秒...`);
            }
        }

        logger.error('等待图片生成超时');
        return false;
    }

    /**
     * =====================================================
     * 保存生成的图片（点击缩略图打开大图后保存）
     * =====================================================
     */
    async saveGeneratedImage(page, promptIndex) {
        try {
            // 确保保存目录存在
            if (!fs.existsSync(this.saveFolder)) {
                fs.mkdirSync(this.saveFolder, { recursive: true });
            }

            // 生成文件名
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
            const fileName = `legil_${promptIndex}_${timestamp}.png`;
            const savePath = path.join(this.saveFolder, fileName);

            logger.info('正在查找缩略图...');

            // 第1步：找到缩略图元素
            const thumbnailHandle = await page.evaluateHandle(() => {
                const allImgs = document.querySelectorAll('img');
                let bestImg = null;
                let maxArea = 0;

                for (const img of allImgs) {
                    const rect = img.getBoundingClientRect();
                    // 条件：右侧区域（left > 400）且尺寸大于 200x200
                    if (rect.left > 400 && rect.width > 200 && rect.height > 200) {
                        const area = rect.width * rect.height;
                        if (area > maxArea) {
                            maxArea = area;
                            bestImg = img;
                        }
                    }
                }

                return bestImg;
            });

            const thumbnailElement = await thumbnailHandle.asElement();
            if (!thumbnailElement) {
                throw new Error('未找到缩略图');
            }

            // 获取缩略图信息
            const thumbInfo = await thumbnailElement.evaluate(el => ({
                src: el.src,
                width: el.naturalWidth,
                height: el.naturalHeight
            }));

            logger.info(`找到缩略图: ${thumbInfo.width}x${thumbInfo.height}`);
            logger.info('点击缩略图打开大图...');

            // 第2步：使用 Playwright 点击缩略图（模拟真实点击）
            await thumbnailElement.click();
            logger.info('已点击，等待大图弹窗...');

            // 等待弹窗出现
            await interruptibleSleep(3000);

            // 第3步：获取完整大图的地址
            logger.info('查找完整大图...');

            // 先尝试查找弹窗中的大图
            let fullImageSrc = await page.evaluate(() => {
                // 方法1：查找弹窗/模态框中的大图
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
                        if (img.naturalWidth > 500 && img.naturalHeight > 500) {
                            return img.src;
                        }
                    }
                }

                // 方法2：查找页面中最大的图片（可能是展开后的）
                const allImgs = document.querySelectorAll('img');
                let bestImg = null;
                let maxArea = 0;

                for (const img of allImgs) {
                    // 查找尺寸大于800的大图
                    if (img.naturalWidth > 800 && img.naturalHeight > 800) {
                        const area = img.naturalWidth * img.naturalHeight;
                        if (area > maxArea) {
                            maxArea = area;
                            bestImg = img;
                        }
                    }
                }

                if (bestImg) {
                    return bestImg.src;
                }

                return null;
            });

            // 如果没找到大图，尝试从缩略图 URL 推断
            if (!fullImageSrc) {
                logger.info('未找到弹窗大图，尝试从缩略图 URL 获取原图...');
                fullImageSrc = thumbInfo.src;

                // Legil 的 URL 格式：包含 resize 参数，移除后获取原图
                if (fullImageSrc.includes('resize')) {
                    // 移除 resize 参数
                    fullImageSrc = fullImageSrc.replace(/resize,w_\d+,h_\d+,/, '');
                    logger.info('已移除 resize 参数');
                }
            } else {
                logger.info(`找到完整大图: ${fullImageSrc.substring(0, 80)}...`);
            }

            // 第4步：下载图片
            logger.info('正在下载图片...');

            const context = page.context();
            const response = await context.request.get(fullImageSrc);

            if (!response.ok()) {
                throw new Error(`下载失败: HTTP ${response.status()}`);
            }

            const buffer = await response.body();

            if (!buffer || buffer.length === 0) {
                throw new Error('下载的数据为空');
            }

            logger.info(`下载完成: ${(buffer.length / 1024).toFixed(2)} KB`);

            // 保存文件
            fs.writeFileSync(savePath, buffer);

            // 验证文件
            if (fs.existsSync(savePath)) {
                const stats = fs.statSync(savePath);
                if (stats.size > 1000) {
                    logger.info(`✅ 图片保存成功: ${fileName} (${(stats.size/1024).toFixed(2)} KB)`);

                    // 关闭弹窗（按 Escape）
                    await page.keyboard.press('Escape');
                    await interruptibleSleep(500);

                    return savePath;
                }
            }

            throw new Error('保存的文件无效');

        } catch (error) {
            logger.error(`保存图片失败: ${error.message}`);
            return null;
        }
    }
}

// 导出单例实例
module.exports = new LegilAutomation();
