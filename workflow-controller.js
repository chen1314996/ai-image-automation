/**
 * ============================================
 * 完整工作流控制器（第九阶段）
 * ============================================
 * 核心功能：
 * 1. 循环处理输入文件夹中的所有参考图
 * 2. 每张参考图：调用豆包大模型 API → 获取5组提示词 → Legil生成图片
 * 3. 单张图5组提示词处理完后，自动处理下一张
 * 4. 直到所有参考图处理完毕
 */

const fs = require('fs');
const path = require('path');
const doubaoAutomation = require('./doubao-automation');
const legilAutomation = require('./legil-automation');
const logger = require('./logger');
const { formatDateTimeForFile, sortNaturallyByName } = require('./file-utils');

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
        this.currentRunId = '';
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

    normalizeFolderPath(folderPath) {
        if (typeof folderPath !== 'string') {
            return '';
        }
        return folderPath.replace(/["']/g, '').trim();
    }

    ensureDirectory(folderPath, label) {
        const normalizedPath = this.normalizeFolderPath(folderPath);
        if (!normalizedPath) {
            throw new Error(`${label}不能为空`);
        }

        if (!fs.existsSync(normalizedPath)) {
            fs.mkdirSync(normalizedPath, { recursive: true });
        }

        const stats = fs.statSync(normalizedPath);
        if (!stats.isDirectory()) {
            throw new Error(`${label}不是文件夹`);
        }

        return normalizedPath;
    }

    validateStart(inputFolder, outputFolder, legilRefFolder) {
        if (this.isRunning) {
            return {
                success: false,
                message: '工作流正在运行中，请勿重复启动'
            };
        }

        const resolvedInput = this.normalizeFolderPath(inputFolder) || this.inputFolder;
        const resolvedOutput = this.normalizeFolderPath(outputFolder) || this.outputFolder;
        const resolvedLegilRef = this.normalizeFolderPath(legilRefFolder) || this.legilReferenceFolder;

        try {
            if (!fs.existsSync(resolvedInput)) {
                return {
                    success: false,
                    message: `输入文件夹不存在: ${resolvedInput}`
                };
            }

            const inputStats = fs.statSync(resolvedInput);
            if (!inputStats.isDirectory()) {
                return {
                    success: false,
                    message: `输入路径不是文件夹: ${resolvedInput}`
                };
            }

            const imageFiles = this.getImageFiles(resolvedInput);
            if (imageFiles.length === 0) {
                return {
                    success: false,
                    message: '输入文件夹中没有图片'
                };
            }

            const safeOutput = this.ensureDirectory(resolvedOutput, '输出文件夹');

            return {
                success: true,
                inputFolder: resolvedInput,
                outputFolder: safeOutput,
                legilReferenceFolder: resolvedLegilRef,
                totalImages: imageFiles.length
            };
        } catch (error) {
            return {
                success: false,
                message: error.message
            };
        }
    }

    isAbortRequested() {
        return !this.isRunning || (this.abortController && this.abortController.signal.aborted);
    }

    getCancellationOptions() {
        return {
            signal: this.abortController ? this.abortController.signal : null,
            shouldAbort: () => this.isAbortRequested()
        };
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
        const validation = this.validateStart(inputFolder, outputFolder, legilRefFolder);
        if (!validation.success) {
            this.updateStatus({
                phase: 'error',
                currentAction: validation.message,
                error: validation.message
            });
            return validation;
        }

        this.isRunning = true;
        this.abortController = new AbortController();
        this.inputFolder = validation.inputFolder;
        this.outputFolder = validation.outputFolder;
        this.legilReferenceFolder = validation.legilReferenceFolder;
        this.stats = { processed: 0, failed: 0, totalGenerated: 0 };
        this.currentRunId = formatDateTimeForFile();

        // 确保前端传入的输出目录真正用于 Legil 图片保存
        legilAutomation.setSaveFolder(this.outputFolder);

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

                    // 如果不是最后一张，短暂等待后继续下一张参考图。
                    // 豆包已改为 API 调用，不再需要打开网页或新建对话。
                    if (i < this.totalImages - 1 && this.isRunning) {
                        this.updateStatus({
                            currentAction: `等待冷却时间，准备处理下一张参考图...`
                        });
                        logger.info('');
                        logger.info('⏳ 准备处理下一张参考图...');
                        logger.info('⏸️ 等待5秒后继续下一张...');
                        await this.sleep(5000);
                        if (!this.isRunning) break;
                    }

                } catch (error) {
                    const imageName = path.basename(imagePath);
                    const errorMessage = error && error.message ? error.message : String(error);

                    if (this.isAbortRequested() || errorMessage.includes('取消') || errorMessage.includes('停止')) {
                        logger.info('⏹️ 工作流已停止，退出当前图片处理');
                        break;
                    }

                    const isTimeout = errorMessage.includes('超时');

                    if (isTimeout) {
                        logger.error(`❌ 图片处理超时: ${imageName}`);
                        logger.error(`   原因: ${errorMessage}`);
                        logger.error(`   该图片将被记录到失败日志，继续处理下一张...`);
                    } else {
                        logger.error(`❌ 处理失败: ${errorMessage}`);
                    }

                    this.updateStatus({
                        phase: 'error',
                        currentAction: `处理失败: ${errorMessage}`,
                        error: errorMessage
                    });
                    this.stats.failed++;

                    // 尝试恢复：API 模式下无需新开豆包对话，短暂等待后继续下一张。
                    if (i < this.totalImages - 1 && this.isRunning) {
                        logger.info('⏸️ 等待10秒后继续下一张参考图...');
                        await this.sleep(10000);
                        if (!this.isRunning) break;
                    }
                }
            }

            const stopped = this.abortController && this.abortController.signal.aborted;
            if (stopped || !this.isRunning) {
                this.isRunning = false;
                this.updateStatus({
                    phase: 'stopped',
                    currentAction: '工作流已停止'
                });
                logger.info('⏹️ 工作流已停止');
                return {
                    success: false,
                    message: '工作流已停止',
                    stats: this.stats,
                    totalImages: this.totalImages
                };
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
            const errorMessage = error && error.message ? error.message : String(error);
            this.updateStatus({
                phase: 'error',
                currentAction: `工作流执行失败: ${errorMessage}`,
                error: errorMessage
            });
            logger.error(`❌ 工作流执行失败: ${errorMessage}`);
            return {
                success: false,
                message: errorMessage,
                stats: this.stats
            };
        } finally {
            this.abortController = null;
        }
    }

    /**
     * =====================================================
     * 处理单张参考图
     * =====================================================
     * 流程：
     * 1. 调用豆包大模型 API 获取5组提示词
     * 2. 每组提示词在Legil生成图片
     * 3. 本轮结束
     */
    async processSingleImage(imagePath, imageIndex, totalImages) {
        const imageName = path.basename(imagePath);

        logger.info('');
        logger.info('╔════════════════════════════════════════════════════════════╗');
        logger.info(`║ 📷 参考图 ${imageIndex}/${totalImages}: ${imageName}`);
        logger.info('╠════════════════════════════════════════════════════════════╣');
        logger.info('║ [步骤1] 豆包 API：读取参考图并获取5组提示词...');
        logger.info('╚════════════════════════════════════════════════════════════╝');

        // 更新状态 - 正在通过豆包 API 生成提示词。
        this.updateStatus({
            phase: 'extracting_prompts',
            currentAction: `正在调用豆包 API 生成提示词: ${imageName}`
        });

        const doubaoResult = await doubaoAutomation.fullAutomation(imagePath, {
            imageIndex,
            totalImages,
            ...this.getCancellationOptions()
        });

        if (!doubaoResult.success || !Array.isArray(doubaoResult.prompts) || doubaoResult.prompts.length === 0) {
            throw new Error('豆包生成提示词失败');
        }

        const prompts = doubaoResult.prompts
            .map(promptData => typeof promptData === 'string' ? promptData : promptData && promptData.content)
            .filter(promptText => typeof promptText === 'string' && promptText.trim())
            .map(promptText => promptText.trim())
            .slice(0, 5);

        if (prompts.length < 5) {
            logger.error(`提取提示词失败: 豆包 API 只返回 ${prompts.length} 组有效提示词`);
            throw new Error('豆包生成提示词失败');
        }

        logger.info(`✅ 成功获取 ${prompts.length} 组提示词`);

        // 保存提示词到内存，供前端查看
        this.lastExtractedPrompts = prompts;
        logger.info('💾 提示词已缓存，可通过API获取');

        // 更新状态 - 正在提取提示词
        this.updateStatus({
            phase: 'extracting_prompts',
            currentAction: `已提取 ${prompts.length} 组提示词`
        });

        // 步骤2：Legil生成 - 每组提示词生成1张图片
        logger.info('');
        logger.info('╔════════════════════════════════════════════════════════════╗');
        logger.info('║ [步骤2] Legil：每组提示词生成1张图片（共5张）');
        logger.info('╚════════════════════════════════════════════════════════════╝');

        for (let i = 0; i < prompts.length; i++) {
            const promptData = prompts[i];
            const promptText = typeof promptData === 'string' ? promptData : promptData.content;

            if (!promptText || typeof promptText !== 'string') {
                logger.warn(`提示词 ${i + 1}/5 为空，跳过`);
                continue;
            }

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

            const legilOutputQuantity = legilAutomation.getConfig().settings.outputQuantity || 1;
            const nextOutputSequence = this.stats.totalGenerated + 1;
            const legilResult = await legilAutomation.generateImage(promptText, i + 1, {
                saveFolder: this.outputFolder,
                referenceFolder: this.legilReferenceFolder,
                outputSequence: nextOutputSequence,
                outputTotal: totalImages * prompts.length * legilOutputQuantity,
                runId: this.currentRunId,
                referenceImageIndex: imageIndex,
                totalReferenceImages: totalImages,
                referenceImageName: imageName,
                promptIndexWithinImage: i + 1,
                totalPromptsForImage: prompts.length,
                ...this.getCancellationOptions()
            });

            if (legilResult.success) {
                const savedCount = Number(legilResult.savedCount) || 1;
                this.stats.totalGenerated += savedCount;
                logger.info(`✅ 提示词 ${i + 1}/5 生成成功，保存 ${savedCount} 张图片`);
                // 更新状态 - 图片已保存
                this.updateStatus({
                    currentAction: `第 ${i + 1}/5 组已保存 ${savedCount} 张图片`
                });
            } else {
                if (this.isAbortRequested()) {
                    logger.info('⏹️ 工作流已停止，中断 Legil 生成循环');
                    break;
                }
                logger.error(`❌ 图片 ${i + 1}/5 生成失败: ${legilResult.message}`);
            }

            // 每张图片之间等待5秒
            if (i < prompts.length - 1 && this.isRunning) {
                logger.info('⏳ 等待5秒后继续下一张...');
                await this.sleep(5000);
            }
        }

        if (this.isAbortRequested()) {
            throw new Error('工作流已停止');
        }

        logger.info('');
        logger.info('╔════════════════════════════════════════════════════════════╗');
        logger.info(`║ ✅ 参考图 ${imageIndex}/${totalImages} 处理完毕！`);
        logger.info(`║    已生成5张图片，准备下一张...`);
        logger.info('╚════════════════════════════════════════════════════════════╝');
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

        return sortNaturallyByName(files)
            .filter(file => {
                const ext = path.extname(file).toLowerCase();
                return imageExtensions.includes(ext);
            })
            .map(file => path.join(folderPath, file));
    }

    /**
     * =====================================================
     * 获取当前工作流状态
     * =====================================================
     */
    getStatus() {
        const completed = this.currentStatus.phase === 'completed';
        const progress = this.totalImages > 0
            ? (completed ? 100 : Math.min(99, Math.round((this.stats.processed / this.totalImages) * 100)))
            : 0;

        return {
            isRunning: this.isRunning,
            currentIndex: this.currentIndex,
            totalImages: this.totalImages,
            currentImage: this.imageFiles[this.currentIndex] || null,
            stats: this.stats,
            progress,
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
