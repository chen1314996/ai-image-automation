/**
 * ============================================
 * 完整工作流控制器（第九阶段）
 * ============================================
 * 核心功能：
 * 1. 循环处理输入文件夹中的所有参考图
 * 2. 每张参考图：上传豆包 → 获取5组提示词 → Legil生成5张图片
 * 3. 完成后新开豆包对话，处理下一张
 * 4. 直到所有参考图处理完毕
 */

const fs = require('fs');
const path = require('path');
const browserController = require('./playwright-controller');
const doubaoAutomation = require('./doubao-automation');
const legilAutomation = require('./legil-automation');
const logger = require('./logger');

class WorkflowController {
    constructor() {
        this.isRunning = false;
        this.currentIndex = 0;
        this.totalImages = 0;
        this.imageFiles = [];
        this.inputFolder = 'D:\\工作\\自动化工作流1\\输入';
        this.outputFolder = 'D:\\工作\\自动化工作流1\\输出';
        // Legil参考图文件夹
        this.legilReferenceFolder = 'D:\\工作\\自动化工作流1\\Legil参考图';
        this.stats = {
            processed: 0,
            failed: 0,
            totalGenerated: 0
        };
        // 详细进度状态（阶段10新增）
        this.currentStatus = {
            phase: 'idle', // idle, processing_image, extracting_prompts, generating_in_legil, completed, error
            currentImageIndex: 0,
            totalImages: 0,
            currentImageName: '',
            currentPromptIndex: 0,
            totalPrompts: 5,
            currentAction: '', // 当前正在执行的动作描述
            error: null
        };
        // 用于强制停止的信号
        this.abortController = null;
        this.pendingPromises = [];
    }

    /**
     * =====================================================
     * 更新当前状态（推送到前端）
     * =====================================================
     */
    updateStatus(updates) {
        this.currentStatus = { ...this.currentStatus, ...updates };
        // 通过日志系统推送状态更新
        const statusMsg = JSON.stringify({
            type: 'workflow_status',
            status: this.currentStatus
        });
        // 这里可以通过 logger 的特殊方式推送，或者前端通过轮询获取
    }

    /**
     * =====================================================
     * 主流程：启动完整工作流
     * =====================================================
     * @param {string} inputFolder - 参考图文件夹路径
     * @param {string} outputFolder - 输出文件夹路径
     * @param {string} legilRefFolder - Legil参考图文件夹路径（可选）
     */
    async startWorkflow(inputFolder, outputFolder, legilRefFolder) {
        if (this.isRunning) {
            return {
                success: false,
                message: '工作流正在运行中，请勿重复启动'
            };
        }

        this.isRunning = true;
        this.abortController = new AbortController();
        this.inputFolder = inputFolder || this.inputFolder;
        this.outputFolder = outputFolder || this.outputFolder;
        this.legilReferenceFolder = legilRefFolder || this.legilReferenceFolder;
        this.stats = { processed: 0, failed: 0, totalGenerated: 0 };

        // 设置Legil参考图文件夹
        if (this.legilReferenceFolder) {
            legilAutomation.setReferenceFolder(this.legilReferenceFolder);
            logger.info(`已设置 Legil 参考图文件夹: ${this.legilReferenceFolder}`);
        }

        // 初始化状态
        this.updateStatus({
            phase: 'starting',
            currentImageIndex: 0,
            totalImages: 0,
            currentImageName: '',
            currentPromptIndex: 0,
            totalPrompts: 5,
            currentAction: '正在初始化工作流...',
            error: null
        });

        logger.info('========================================');
        logger.info('🚀 启动完整工作流 - 第九阶段');
        logger.info('========================================');
        logger.info(`输入文件夹: ${this.inputFolder}`);
        logger.info(`输出文件夹: ${this.outputFolder}`);

        try {
            // 第1步：获取所有参考图
            this.imageFiles = this.getImageFiles(this.inputFolder);
            this.totalImages = this.imageFiles.length;
            this.currentIndex = 0;

            if (this.totalImages === 0) {
                this.isRunning = false;
                return {
                    success: false,
                    message: '输入文件夹中没有图片'
                };
            }

            logger.info(`找到 ${this.totalImages} 张参考图，开始处理...`);

            // 第2步：循环处理每张参考图
            for (let i = 0; i < this.totalImages; i++) {
                // 每次循环开始时检查是否已停止
                if (!this.isRunning) {
                    logger.info('⏹️ 工作流已停止，退出循环');
                    break;
                }

                this.currentIndex = i;
                const imagePath = this.imageFiles[i];
                const imageName = path.basename(imagePath);

                // 更新状态（阶段10）
                this.updateStatus({
                    phase: 'processing_image',
                    currentImageIndex: i + 1,
                    totalImages: this.totalImages,
                    currentImageName: imageName,
                    currentPromptIndex: 0,
                    currentAction: `正在处理第 ${i + 1}/${this.totalImages} 张参考图: ${imageName}`
                });

                logger.info('');
                logger.info('========================================');
                logger.info(`📷 正在处理第 ${i + 1}/${this.totalImages} 张参考图`);
                logger.info(`文件名: ${imageName}`);
                logger.info('========================================');

                try {
                    // 处理单张参考图（传入当前索引和总数，用于显示进度）
                    await this.processSingleImage(imagePath, i + 1, this.totalImages);
                    this.stats.processed++;

                    // 如果不是最后一张，新开豆包对话
                    if (i < this.totalImages - 1 && this.isRunning) {
                        this.updateStatus({
                            currentAction: `等待冷却时间，准备处理下一张参考图...`
                        });
                        logger.info('');
                        logger.info('⏳ 准备处理下一张参考图...');
                        logger.info('⏸️ 等待30秒冷却时间（避免触发风控）...');
                        await this.sleep(30000); // 30秒冷却（可中断）
                        if (!this.isRunning) break;
                        await this.startNewDoubaoChat();
                        // 等待页面加载
                        await this.sleep(5000);
                    }

                } catch (error) {
                    const imageName = path.basename(imagePath);
                    const isTimeout = error.message.includes('超时');

                    if (isTimeout) {
                        logger.error(`❌ 图片处理超时: ${imageName}`);
                        logger.error(`   原因: ${error.message}`);
                        logger.error(`   该图片将被记录到失败日志，继续处理下一张...`);
                    } else {
                        logger.error(`❌ 处理失败: ${error.message}`);
                    }

                    this.updateStatus({
                        phase: 'error',
                        currentAction: `处理失败: ${error.message}`,
                        error: error.message
                    });
                    this.stats.failed++;

                    // 尝试恢复：新开对话继续下一张
                    if (i < this.totalImages - 1 && this.isRunning) {
                        logger.info('⏸️ 等待10秒后开启新对话...');
                        await this.sleep(10000);
                        if (!this.isRunning) break;
                        await this.startNewDoubaoChat();
                        // 等待页面加载
                        await this.sleep(5000);
                    }
                }
            }

            // 第3步：完成总结
            this.isRunning = false;
            this.updateStatus({
                phase: 'completed',
                currentAction: '工作流已完成',
                currentPromptIndex: 5
            });

            logger.info('');
            logger.info('========================================');
            logger.info('✅ 完整工作流执行完毕！');
            logger.info('========================================');
            logger.info(`处理结果:`);
            logger.info(`  - 成功: ${this.stats.processed} 张`);
            logger.info(`  - 失败: ${this.stats.failed} 张`);
            logger.info(`  - 共生成: ${this.stats.totalGenerated} 张图片`);
            logger.info('========================================');

            return {
                success: true,
                message: '工作流执行完毕',
                stats: this.stats,
                totalImages: this.totalImages
            };

        } catch (error) {
            this.isRunning = false;
            this.updateStatus({
                phase: 'error',
                currentAction: `工作流执行失败: ${error.message}`,
                error: error.message
            });
            logger.error(`❌ 工作流执行失败: ${error.message}`);
            return {
                success: false,
                message: error.message,
                stats: this.stats
            };
        }
    }

    /**
     * =====================================================
     * 处理单张参考图
     * =====================================================
     * 流程：
     * 1. 上传到豆包获取5组提示词
     * 2. 每组提示词在Legil生成1张图片（共5张）
     * 3. 本轮结束
     */
    async processSingleImage(imagePath, imageIndex, totalImages) {
        const imageName = path.basename(imagePath);

        // 步骤0：确保豆包页面已准备好
        logger.info('');
        logger.info('╔════════════════════════════════════════════════════════════╗');
        logger.info(`║ 📷 参考图 ${imageIndex}/${totalImages}: ${imageName}`);
        logger.info('╠════════════════════════════════════════════════════════════╣');
        logger.info('║ [步骤0] 检查豆包页面状态...');
        logger.info('╚════════════════════════════════════════════════════════════╝');

        // 确保豆包页面已打开且有效
        let doubaoPage = browserController.getPage('doubao');
        if (!doubaoPage && this.isRunning) {
            logger.warn('豆包页面未打开，正在重新打开...');
            await browserController.openWebsite('doubao', 'https://www.doubao.com/chat/');
            await this.sleep(5000);
            doubaoPage = browserController.getPage('doubao');
        }

        // 检查页面URL是否有效
        if (doubaoPage && this.isRunning) {
            const url = doubaoPage.url();
            if (url.startsWith('chrome-error://') || url === 'about:blank') {
                logger.warn('豆包页面是错误页面，正在刷新...');
                await doubaoPage.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
                await this.sleep(5000);
            }
        }

        // 步骤1：豆包自动化 - 上传图片并获取5组提示词
        logger.info('');
        logger.info('╔════════════════════════════════════════════════════════════╗');
        logger.info('║ [步骤1] 豆包：上传图片并获取5组提示词...');
        logger.info('╚════════════════════════════════════════════════════════════╝');

        // 更新状态 - 正在上传参考图到豆包
        this.updateStatus({
            phase: 'processing_image',
            currentAction: `正在上传参考图到豆包: ${imageName}`
        });

        const doubaoResult = await doubaoAutomation.uploadAndPrompt(imagePath, { imageIndex, totalImages, useNewChat: imageIndex > 1 });

        if (!doubaoResult.success || !doubaoResult.response) {
            throw new Error('豆包生成提示词失败');
        }

        // 从响应中提取提示词
        logger.info('正在从回复中提取提示词...');
        const extractResult = doubaoAutomation.extractPrompts(doubaoResult.response);

        if (!extractResult.success || !extractResult.prompts || extractResult.prompts.length === 0) {
            logger.error(`提取提示词失败: ${extractResult.message}`);
            throw new Error('豆包生成提示词失败');
        }

        const prompts = extractResult.prompts.slice(0, 5);
        logger.info(`✅ 成功获取 ${prompts.length} 组提示词`);

        // 保存提示词到内存，供前端查看
        this.lastExtractedPrompts = prompts;
        logger.info('💾 提示词已缓存，可通过API获取');

        // 更新状态 - 正在提取提示词
        this.updateStatus({
            phase: 'extracting_prompts',
            currentAction: `已提取 ${prompts.length} 组提示词`
        });

        // 不再关闭豆包页面，下一轮直接点击"新对话"即可
        // logger.info(`正在关闭第 ${imageIndex} 张参考图的豆包对话窗口...`);
        // await doubaoAutomation.closeChat(doubaoAutomation.getCurrentPage(), imageIndex);

        // 步骤2：Legil生成 - 每组提示词生成1张图片
        logger.info('');
        logger.info('╔════════════════════════════════════════════════════════════╗');
        logger.info('║ [步骤2] Legil：每组提示词生成1张图片（共5张）');
        logger.info('╚════════════════════════════════════════════════════════════╝');

        for (let i = 0; i < prompts.length; i++) {
            const promptData = prompts[i];
            const promptText = typeof promptData === 'string' ? promptData : promptData.content;

            // 更新状态 - 正在Legil生成图片
            this.updateStatus({
                phase: 'generating_in_legil',
                currentPromptIndex: i + 1,
                currentAction: `正在Legil生成第 ${i + 1}/5 张图片`
            });

            logger.info('');
            logger.info(`┌────────────────────────────────────────────────────────────┐`);
            logger.info(`│ 🎨 提示词 ${i + 1}/5`);
            logger.info(`├────────────────────────────────────────────────────────────┤`);
            logger.info(`│ ${promptText.substring(0, 50)}...`);
            logger.info(`└────────────────────────────────────────────────────────────┘`);

            const legilResult = await legilAutomation.generateImage(promptText, i + 1);

            if (legilResult.success) {
                this.stats.totalGenerated++;
                logger.info(`✅ 图片 ${i + 1}/5 生成成功`);
                // 更新状态 - 图片已保存
                this.updateStatus({
                    currentAction: `第 ${i + 1}/5 张图片已保存`
                });
            } else {
                logger.error(`❌ 图片 ${i + 1}/5 生成失败: ${legilResult.message}`);
            }

            // 每张图片之间等待5秒
            if (i < prompts.length - 1 && this.isRunning) {
                logger.info('⏳ 等待5秒后继续下一张...');
                await this.sleep(5000);
            }
        }

        logger.info('');
        logger.info('╔════════════════════════════════════════════════════════════╗');
        logger.info(`║ ✅ 参考图 ${imageIndex}/${totalImages} 处理完毕！`);
        logger.info(`║    已生成5张图片，准备下一张...`);
        logger.info('╚════════════════════════════════════════════════════════════╝');
    }

    /**
     * =====================================================
     * 新开豆包对话
     * =====================================================
     * 点击豆包的"新建对话"按钮，清除上下文
     */
    async startNewDoubaoChat() {
        logger.info('正在新开豆包对话...');

        try {
            let page = browserController.getPage('doubao');
            if (!page || page.isClosed()) {
                logger.warn('豆包页面未打开，正在重新打开...');
                await browserController.openWebsite('doubao', 'https://www.doubao.com/chat/');
                await this.sleep(5000);
                return;
            }

            // 尝试点击"新建对话"按钮（精确选择侧边栏内的按钮，避免点到资讯卡片）
            // 注意："新对话"在侧边栏最上方，带蓝色加号图标，"AI创作"在它下面
            const newChatSelectors = [
                // 最可靠：通过精确文本+层级定位
                // 侧边栏直接子元素中包含"新对话"的
                'aside > div a:has-text("新对话")',
                'aside > div button:has-text("新对话")',
                'aside > nav a:has-text("新对话")',
                'aside > nav button:has-text("新对话")',
                // 侧边栏第一层级的第一个交互元素（通常是"新对话"）
                'aside > *:first-child a',
                'aside > *:first-child button',
                'aside > a:first-of-type',
                // 带加号/新建图标的按钮
                'aside a:has(svg):has-text("新对话")',
                'aside button:has(svg):has-text("新对话")',
                // 类名匹配
                '[class*="new-chat"]',
                '[class*="new-conversation"]',
                // 备选：任何包含"新对话"的元素
                'button:has-text("新对话")',
                'a:has-text("新对话")'
            ];

            let clicked = false;
            for (const selector of newChatSelectors) {
                try {
                    const button = await page.$(selector);
                    if (button) {
                        const isVisible = await button.isVisible().catch(() => false);
                        if (isVisible) {
                            await button.click();
                            logger.info('✅ 已点击"新建对话"按钮');
                            clicked = true;
                            break;
                        }
                    }
                } catch (e) {}
            }

            // 如果没找到按钮，直接导航到新对话URL（最可靠的方式）
            if (!clicked) {
                logger.info('未找到新建对话按钮，直接导航到新对话...');
                await page.goto('https://www.doubao.com/chat/');
                logger.info('✅ 已导航到新对话页面');
            }

            // 等待页面稳定
            await this.sleep(3000);

        } catch (error) {
            logger.error(`新开对话失败: ${error.message}`);
            // 尝试打开新页面
            try {
                await browserController.openWebsite('doubao', 'https://www.doubao.com/chat/');
            } catch (e) {}
        }
    }

    /**
     * =====================================================
     * 获取文件夹中的所有图片文件
     * =====================================================
     */
    getImageFiles(folderPath) {
        if (!fs.existsSync(folderPath)) {
            throw new Error('输入文件夹不存在');
        }

        const files = fs.readdirSync(folderPath);
        const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif'];

        return files
            .filter(file => {
                const ext = path.extname(file).toLowerCase();
                return imageExtensions.includes(ext);
            })
            .map(file => path.join(folderPath, file))
            .sort(); // 按文件名排序，确保顺序一致
    }

    /**
     * =====================================================
     * 获取当前工作流状态
     * =====================================================
     */
    getStatus() {
        return {
            isRunning: this.isRunning,
            currentIndex: this.currentIndex,
            totalImages: this.totalImages,
            currentImage: this.imageFiles[this.currentIndex] || null,
            stats: this.stats,
            progress: this.totalImages > 0 ? Math.round((this.currentIndex / this.totalImages) * 100) : 0,
            lastExtractedPrompts: this.lastExtractedPrompts || null,
            // 阶段10新增：详细状态
            currentStatus: this.currentStatus
        };
    }

    /**
     * =====================================================
     * 获取最近一次提取的提示词
     * =====================================================
     */
    getLastExtractedPrompts() {
        return this.lastExtractedPrompts || null;
    }

    /**
     * =====================================================
     * 停止工作流（强制中断）
     * =====================================================
     */
    async stopWorkflow() {
        if (this.isRunning) {
            this.isRunning = false;
            // 触发 abort 信号以中断正在进行的操作
            if (this.abortController) {
                this.abortController.abort();
                this.abortController = null;
            }
            this.updateStatus({
                phase: 'stopped',
                currentAction: '工作流已停止'
            });
            logger.info('⏹️ 工作流已停止');
            return { success: true, message: '工作流已停止' };
        }
        return { success: false, message: '工作流未运行' };
    }

    /**
     * =====================================================
     * 重置工作流状态
     * =====================================================
     */
    resetStatus() {
        this.currentStatus = {
            phase: 'idle',
            currentImageIndex: 0,
            totalImages: 0,
            currentImageName: '',
            currentPromptIndex: 0,
            totalPrompts: 5,
            currentAction: '',
            error: null
        };
    }

    /**
     * =====================================================
     * 可中断的 sleep
     * =====================================================
     */
    async sleep(ms) {
        if (!this.isRunning) return;
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                cleanup();
                resolve();
            }, ms);

            const checkInterval = setInterval(() => {
                if (!this.isRunning) {
                    cleanup();
                    reject(new Error('工作流已停止'));
                }
            }, 100);

            function cleanup() {
                clearTimeout(timeout);
                clearInterval(checkInterval);
            }
        }).catch(() => {}); // 忽略停止时的错误
    }
}

// 导出单例实例
module.exports = new WorkflowController();
