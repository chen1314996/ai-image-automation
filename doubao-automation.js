/**
 * ============================================
 * 豆包平台自动化操作模块
 * ============================================
 * 第五阶段：实现图片上传和提示词发送
 *
 * 功能：
 * 1. 上传参考图片到豆包
 * 2. 发送固定提示词
 * 3. 获取生成的五组提示词
 */

// 引入 Playwright 浏览器控制器
const browserController = require('./playwright-controller');

// 引入实时日志系统
const logger = require('./logger');

// 引入路径和文件系统模块
const path = require('path');
const fs = require('fs');

// 引入工作流控制器（用于检查停止状态）
let workflowController = null;
function getWorkflowController() {
    if (!workflowController) {
        workflowController = require('./workflow-controller');
    }
    return workflowController;
}

class DoubaoAutomation {
    constructor() {
        // 固定提示词
        this.promptTemplate = `帮我参考这张图，生成五组不同画面提示词，要求画面直观、主题明确、高质量3D卡通渲染、商业级游戏宣传海报风格、电影镜头感、内容尽可能详细。`;

        // 存储最近提取的提示词（第六阶段）
        this.lastExtractedPrompts = null;
    }

    /**

    /**
     * 上传图片并发送提示词（增强版，支持新建对话）
     * --------------------
     * 在豆包平台完成完整的操作流程
     * 每张参考图都在全新的豆包对话窗口中执行
     * @param {string} imagePath - 本地图片路径
     * @param {Object} options - 可选参数
     * @param {number} options.imageIndex - 当前图片索引（用于日志）
     * @param {number} options.totalImages - 总图片数（用于日志）
     * @param {boolean} options.useNewChat - 是否使用新对话（默认true）
     * @returns {Promise<Object>} - 操作结果
     */
    async uploadAndPrompt(imagePath, options = {}) {
        const { imageIndex = 1, totalImages = 1, useNewChat = true } = options;
        const isFirstImage = imageIndex === 1;

        logger.info('========================================');
        logger.info(`🔄 开始处理第 ${imageIndex}/${totalImages} 张参考图`);
        logger.info(`图片路径: ${imagePath}`);
        logger.info('========================================');

        let page = null;
        let newChatCreated = false;

        try {
            // 获取或创建豆包页面
            page = browserController.getPage('doubao');

            if (!page || page.isClosed()) {
                logger.info('豆包页面未打开，正在打开...');
                const opened = await browserController.openWebsite('doubao', 'https://www.doubao.com/chat/');
                if (!opened) {
                    throw new Error('无法打开豆包页面');
                }
                page = browserController.getPage('doubao');
                await browserController.sleep(3000);
            }

            // 为每张参考图新建对话窗口（除了第一张，如果是首次启动）
            if (useNewChat && !isFirstImage) {
                logger.info('');
                logger.info(`📱 正在为第 ${imageIndex} 张参考图新建豆包对话窗口...`);
                const newChatSuccess = await this.startNewChat(page);
                if (newChatSuccess) {
                    newChatCreated = true;
                    logger.info(`✅ 已为第 ${imageIndex} 张参考图新建豆包对话窗口`);
                } else {
                    logger.warn('⚠️ 新建对话失败，将使用当前对话窗口');
                }
                // 等待页面加载稳定
                await browserController.sleep(3000);
            }

            // 第一步：上传图片
            logger.browser('正在上传图片...');
            const uploadSuccess = await this.uploadImage(page, imagePath);
            if (!uploadSuccess) {
                throw new Error('图片上传失败');
            }

            // 等待图片上传完成
            logger.info('等待图片上传完成（约 5-10 秒）...');
            await browserController.sleep(8000);

            // 第二步：发送提示词
            logger.browser('正在发送提示词...');
            const promptSuccess = await this.sendPrompt(page);
            if (!promptSuccess) {
                throw new Error('发送提示词失败');
            }

            // 第三步：轮询等待回复（每30秒检查一次状态）
            logger.info('已发送，开始轮询检查回复状态...');
            const pollInterval = 30000; // 30秒
            const maxWaitTime = 3 * 60 * 1000; // 3分钟超时 (180秒)
            const startTime = Date.now();
            let response = null;
            let isGenerating = false;

            while (Date.now() - startTime < maxWaitTime) {
                // 检查工作流是否已停止
                const wfController = getWorkflowController();
                if (wfController && !wfController.isRunning) {
                    logger.info('⏹️ 检测到工作流已停止，中断等待');
                    throw new Error('工作流已停止');
                }

                const elapsed = Math.floor((Date.now() - startTime) / 1000);
                const remaining = Math.floor((maxWaitTime - (Date.now() - startTime)) / 1000);

                // 检查是否正在生成中（通过检查"停止生成"按钮）
                const generating = await this.isGenerating(page);
                if (generating) {
                    if (!isGenerating) {
                        isGenerating = true;
                        logger.info('⏳ 检测到豆包正在生成回复...');
                    }
                    // 每30秒输出一次日志
                    if (elapsed % 30 === 0) {
                        logger.info(`  生成中... 已等待 ${elapsed}秒，剩余 ${remaining}秒`);
                    }
                } else {
                    // 检查是否已完成
                    const hasResponse = await this.checkResponseComplete(page);
                    if (hasResponse) {
                        logger.info(`✅ 检测到回复已完成（共等待 ${elapsed}秒）`);
                        break;
                    }
                    // 每30秒输出一次日志
                    if (elapsed % 30 === 0) {
                        logger.info(`  等待回复... 已等待 ${elapsed}秒，剩余 ${remaining}秒`);
                    }
                }

                // 等待30秒后再次检查（使用可中断的sleep）
                await this.interruptibleSleep(pollInterval);
            }

            // 检查是否超时
            if (Date.now() - startTime >= maxWaitTime) {
                logger.error(`❌ 等待回复超时（超过3分钟），图片处理失败: ${path.basename(imagePath)}`);
                // 记录失败信息
                await this.logFailedImage(imagePath, '等待回复超时（超过3分钟）');
                throw new Error('等待豆包回复超时');
            }

            // 第四步：获取回复内容
            logger.browser('正在获取回复内容...');
            response = await this.getLastResponse(page);

            logger.info('========================================');
            logger.info(`✅ 第 ${imageIndex}/${totalImages} 张参考图处理完成`);
            logger.info('========================================');

            return {
                success: true,
                response: response,
                message: '已成功上传图片并获取回复',
                newChatCreated: newChatCreated
            };

        } catch (error) {
            logger.error(`❌ 豆包自动化失败: ${error.message}`);
            return {
                success: false,
                response: null,
                message: error.message,
                newChatCreated: newChatCreated
            };
        }
    }

    /**
     * 新建豆包对话
     * 点击"新对话"按钮创建干净的对话环境
     * @param {Page} page - Playwright 页面对象
     * @returns {Promise<boolean>}
     */
    async startNewChat(page) {
        try {
            logger.info('正在点击"新对话"按钮...');

            // 根据截图，新对话按钮在左上角侧边栏，带蓝色图标，位于"AI创作"上方
            // 优先尝试最精确的选择器，避免点到"AI创作"或其他按钮
            const newChatSelectors = [
                // 最可靠：通过精确文本+层级定位（侧边栏直接子元素）
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
                            logger.info('✅ 已点击"新对话"按钮');
                            clicked = true;
                            break;
                        }
                    }
                } catch (e) {
                    // 继续尝试下一个选择器
                }
            }

            // 如果没找到按钮，尝试直接导航到新对话URL
            if (!clicked) {
                logger.info('未找到"新对话"按钮，尝试直接导航...');
                await page.goto('https://www.doubao.com/chat/');
                logger.info('✅ 已导航到新对话页面');
                clicked = true;
            }

            // 等待新对话加载完成（等待"有什么我能帮你的吗"或输入框出现）
            await browserController.sleep(3000);

            // 验证新对话是否成功开启
            const bodyText = await page.$eval('body', body => body.innerText).catch(() => '');
            if (bodyText.includes('有什么我能帮你的吗') || bodyText.includes('新对话')) {
                logger.info('✅ 新对话窗口已开启');
            }

            return clicked;

        } catch (error) {
            logger.error(`新建对话失败: ${error.message}`);
            return false;
        }
    }

    /**
     * 关闭当前豆包对话窗口
     * @param {Page} page - Playwright 页面对象
     * @param {number} imageIndex - 当前图片索引（用于日志）
     * @returns {Promise<boolean>}
     */
    async closeChat(page, imageIndex = 1) {
        try {
            if (!page || page.isClosed()) {
                logger.info('豆包对话窗口已经关闭');
                return true;
            }

            logger.info(`正在关闭第 ${imageIndex} 张参考图的豆包对话窗口...`);

            // 尝试关闭当前标签页
            await page.close();
            logger.info(`✅ 已关闭第 ${imageIndex} 张参考图的豆包对话窗口`);

            return true;

        } catch (error) {
            logger.warn(`关闭对话窗口时出错: ${error.message}`);
            return false;
        }
    }

    /**
     * 上传图片
     * --------
     * 在豆包页面点击上传按钮并选择图片
     * 使用更自然的操作方式，避免触发验证
     * @param {Page} page - Playwright 页面对象
     * @param {string} imagePath - 图片路径
     * @returns {Promise<boolean>}
     */
    async uploadImage(page, imagePath) {
        try {
            logger.info('定位上传按钮...');

            // 先等待一下，模拟人工操作节奏
            await this.randomDelay(1000, 2000);

            // 检查页面是否有效
            const url = page.url();
            if (url.startsWith('chrome-error://')) {
                logger.warn('页面是错误页面，尝试刷新...');
                await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
                await browserController.sleep(5000);
            }

            // 尝试直接找文件输入框（最多重试3次）
            let fileInput = null;
            for (let attempt = 1; attempt <= 3; attempt++) {
                fileInput = await page.$('input[type="file"]');
                if (fileInput) break;
                logger.info(`未找到文件输入框，等待重试 (${attempt}/3)...`);
                await browserController.sleep(2000);
            }

            if (fileInput) {
                logger.info('找到文件输入框，正在上传...');

                // 直接设置文件，不点击（避免弹出文件选择对话框）
                await fileInput.setInputFiles(imagePath);
                logger.info('图片已选择，等待上传完成...');

                // 等待更长时间，让图片上传完成
                await this.randomDelay(5000, 8000);

                // 验证图片是否上传成功（检查是否有图片预览、"解释图片"等标识）
                await browserController.sleep(3000); // 等待图片渲染
                const hasImagePreview = await page.$eval('body', body => {
                    const text = body.innerText;
                    // 检查多种图片已上传的标志
                    return text.includes('解释图片') ||
                           text.includes('jpg') ||
                           text.includes('png') ||
                           text.includes('上传') ||
                           text.includes('图片') ||
                           document.querySelector('img[src]') !== null;
                }).catch(() => false);

                // 同时检查是否有图片元素出现
                const hasImageElement = await page.$('img[src*="doubao"], img[src*="data"], .image-preview, [class*="image"]').catch(() => false);

                if (hasImagePreview || hasImageElement) {
                    logger.info('✅ 图片上传成功');
                } else {
                    logger.warn('⚠️ 未检测到图片上传确认，但将继续执行（豆包可能已收到图片）');
                }

                return true;
            }

            // 尝试点击上传按钮
            logger.info('尝试点击上传按钮...');

            const uploadSelectors = [
                '[class*="upload"]',
                '[class*="image"]',
                'button:has-text("上传")',
                'button:has-text("图片")',
                '[role="button"]:has(svg)',
            ];

            for (const selector of uploadSelectors) {
                const uploadBtn = await page.$(selector);
                if (uploadBtn) {
                    logger.info(`找到上传按钮: ${selector}`);

                    // 使用自然点击（带延迟）
                    await this.naturalClick(uploadBtn);
                    await this.randomDelay(1500, 2500);

                    // 查找文件输入框
                    const fileInputAfterClick = await page.$('input[type="file"]');
                    if (fileInputAfterClick) {
                        await fileInputAfterClick.setInputFiles(imagePath);
                        logger.info('图片已选择');
                        await this.randomDelay(3000, 5000);
                        return true;
                    }
                }
            }

            throw new Error('无法找到上传按钮');

        } catch (error) {
            logger.error(`上传图片失败: ${error.message}`);
            return false;
        }
    }

    /**
     * 发送提示词
     * --------
     * 在输入框填入固定提示词并发送
     * 使用更自然的输入方式，避免触发验证
     * @param {Page} page - Playwright 页面对象
     * @returns {Promise<boolean>}
     */
    async sendPrompt(page) {
        try {
            // 首先检查是否有验证弹窗
            const hasCaptcha = await this.checkForCaptcha(page);
            if (hasCaptcha) {
                logger.warn('');
                logger.warn('========================================');
                logger.warn('⚠️ 检测到人机验证弹窗！');
                logger.warn('请在浏览器窗口中完成验证操作');
                logger.warn('完成后系统会自动继续执行');
                logger.warn('========================================');
                await this.waitForCaptchaComplete(page);
            }

            logger.info('正在定位输入框...');

            // 根据豆包实际结构调整选择器
            const inputSelectors = [
                'div[contenteditable="true"]',
                '[class*="chat-input"]',
                '[class*="message-input"]',
                '[class*="editor"]',
                'textarea:not([aria-hidden="true"])',
                'textarea[placeholder*="输入"]',
                'textarea[placeholder*="发送"]',
                'input[placeholder*="输入"]',
            ];

            let inputElement = null;

            for (const selector of inputSelectors) {
                try {
                    await page.waitForSelector(selector, { timeout: 5000 });
                    inputElement = await page.$(selector);
                    if (inputElement) {
                        const isVisible = await inputElement.isVisible().catch(() => false);
                        if (isVisible) {
                            logger.info(`找到输入框: ${selector}`);
                            break;
                        }
                    }
                } catch (e) {
                    // 继续尝试下一个选择器
                }
            }

            if (!inputElement) {
                throw new Error('无法找到可见的输入框');
            }

            // 使用自然点击
            await this.naturalClick(inputElement);
            await this.randomDelay(800, 1500);

            // 填入提示词 - 使用逐字输入模拟人工
            logger.info('正在逐字填入提示词（模拟人工）...');
            await this.typeLikeHuman(inputElement, this.promptTemplate);

            logger.info('提示词已填入');
            await this.randomDelay(1000, 2000);

            // 发送消息
            logger.info('正在发送消息...');

            // 尝试多种方式发送
            // 方式1：查找发送按钮
            const sendSelectors = [
                'button[class*="send"]',
                'button[class*="submit"]',
                '[class*="send-btn"]',
                '[class*="submit-btn"]',
                'button svg',  // 图标按钮
                'button:has(svg)',  // 包含图标的按钮
                'button:last-of-type',  // 最后一个按钮
            ];

            let sent = false;
            for (const selector of sendSelectors) {
                try {
                    const sendBtn = await page.$(selector);
                    if (sendBtn) {
                        const isEnabled = await sendBtn.isEnabled().catch(() => false);
                        if (isEnabled) {
                            await sendBtn.click();
                            logger.info(`通过按钮发送成功: ${selector}`);
                            sent = true;
                            break;
                        }
                    }
                } catch (e) {
                    // 继续尝试下一个
                }
            }

            // 方式2：如果没有找到按钮，尝试按回车键
            if (!sent) {
                logger.info('尝试按回车键发送...');
                await inputElement.press('Enter');
                await browserController.sleep(500);
                // 有时需要按两次回车
                await inputElement.press('Enter');
                sent = true;
                logger.info('通过回车键发送');
            }

            return sent;

        } catch (error) {
            logger.error(`发送提示词失败: ${error.message}`);
            return false;
        }
    }

    /**
     * 获取豆包的回复（排除用户自己的消息）
     * ----------------------------------
     * 从豆包页面获取最后一次 AI 生成的内容，排除用户发送的消息
     * @param {Page} page - Playwright 页面对象
     * @returns {Promise<string>}
     */
    async getLastResponse(page) {
        try {
            // 等待一下确保回复已生成
            await browserController.sleep(3000);
            
            // 额外等待 - 豆包生成需要更长时间
            logger.info("等待内容完全加载...");
            await browserController.sleep(3000);

            logger.info('正在获取豆包回复（排除用户消息）...');

            // 方法1：通过消息角色区分（豆包通常有 user/assistant 角色标记）
            const assistantSelectors = [
                '[data-role="assistant"]',
                '[class*="assistant"]',
                '[class*="bot-message"]',
                '[class*="ai-message"]',
            ];

            for (const selector of assistantSelectors) {
                try {
                    const elements = await page.$$(selector);
                    if (elements.length > 0) {
                        // 取最后一个 AI 消息
                        const lastElement = elements[elements.length - 1];
                        const text = await lastElement.textContent();
                        if (text && text.length > 50 && !text.includes('帮我参考这张图')) {
                            logger.info(`✅ 通过选择器 ${selector} 获取到豆包回复`);
                            return text.trim();
                        }
                    }
                } catch (e) {
                    // 继续尝试
                }
            }

            // 方法2：获取所有消息，通过位置或样式区分
            try {
                // 豆包的消息通常在右侧（用户）或左侧（AI）
                const allMessages = await page.$$('[class*="message"], [class*="bubble"], [class*="content"]');

                for (let i = allMessages.length - 1; i >= 0; i--) {
                    const msg = allMessages[i];
                    try {
                        const text = await msg.textContent();

                        // 排除用户消息的特征：
                        // 1. 包含我们发送的固定提示词开头
                        // 2. 太短（少于100字）
                        // 3. 在右侧（需要检查样式）
                        if (text && text.length > 100) {
                            // 检查是否是用户消息（包含发送的提示词关键词）
                            const isUserMessage =
                                text.includes('帮我参考这张图') ||
                                text.includes('生成五组不同画面提示词') ||
                                (await msg.evaluate(el => {
                                    // 检查是否在右侧（用户消息通常在右侧）
                                    const rect = el.getBoundingClientRect();
                                    const parentRect = el.parentElement?.getBoundingClientRect();
                                    if (parentRect && rect.left > parentRect.left + parentRect.width / 2) {
                                        return true; // 在右侧，可能是用户消息
                                    }
                                    // 检查类名或样式
                                    return el.className.includes('user') ||
                                           el.className.includes('right') ||
                                           el.getAttribute('data-role') === 'user';
                                }).catch(() => false));

                            if (!isUserMessage && text.length > 100) {
                                logger.info(`✅ 获取到豆包回复，长度: ${text.length}`);
                                return text.trim();
                            }
                        }
                    } catch (e) {
                        // 继续
                    }
                }
            } catch (e) {
                logger.warn('通过位置区分消息失败，尝试其他方法...');
            }

            // 方法3：直接获取页面文本，过滤掉固定提示词
            logger.warn('使用文本过滤方法...');
            const body = await page.$('body');
            if (body) {
                const fullText = await body.textContent();

                // 分割成段落
                const paragraphs = fullText
                    .split('\n')
                    .map(p => p.trim())
                    .filter(p => p.length > 100);

                // 从后往前找，排除包含用户提示词的段落
                for (let i = paragraphs.length - 1; i >= 0; i--) {
                    const p = paragraphs[i];
                    // 排除用户发送的提示词
                    if (!p.includes('帮我参考这张图') &&
                        !p.includes('生成五组不同画面提示词') &&
                        p.length > 200) {
                        logger.info(`✅ 获取到回复，长度: ${p.length}`);
                        return p;
                    }
                }
            }

            return '无法获取回复内容';

        } catch (error) {
            logger.error(`获取回复失败: ${error.message}`);
            return `获取回复失败: ${error.message}`;
        }
    }
    /**
     * 完整的自动化流程（上传+获取+提取）
     * --------------------------------
     * 第六阶段完整流程
     * @param {string} imagePath - 本地图片路径
     * @returns {Promise<Object>} - 包含提取的提示词
     */
    async fullAutomation(imagePath) {
        // 每个操作前增加随机延迟，避免触发风控
        await this.randomDelay(2000, 4000);

        // 步骤1：上传图片并发送提示词
        const result = await this.uploadAndPrompt(imagePath);

        if (!result.success) {
            return result;
        }

        // 步骤2：提取五组提示词
        logger.info('正在从回复中提取提示词...');
        const extractResult = this.extractPrompts(result.response);

        if (extractResult.success) {
            logger.info('✅ 完整流程成功！');
            logger.info(`提取到 ${extractResult.prompts.length} 组提示词：`);
            extractResult.prompts.forEach((p, i) => {
                logger.info(`  ${i + 1}. ${p.preview}`);
            });
        }

        return {
            success: extractResult.success,
            response: result.response,
            prompts: extractResult.prompts,
            message: extractResult.message
        };
    }

    /**
     * ============================================
     * 第六阶段：提取五组提示词（增强版）
     * ============================================
     * 同时兼容：
     *   1. 纯文本形式（提示词 X：格式）
     *   2. 代码块包裹形式（<plaintext>代码块）
     *   3. 数字标题格式（X 标题）
     */

    /**
     * 从豆包回复中提取五组提示词
     * @param {string} response - 豆包的完整回复文本
     * @returns {Object} - 提取结果 { success: boolean, prompts: array, message: string }
     */
    extractPrompts(response) {
        logger.info('开始提取五组提示词...');
        logger.info(`回复内容长度: ${response.length} 字符`);

        try {
            if (!response || response.length < 50) {
                logger.error('❌ 回复内容太短，无法提取提示词');
                return {
                    success: false,
                    prompts: [],
                    message: '回复内容太短，无法提取提示词'
                };
            }

            // 预处理：移除用户发送的提示词请求，找到AI回复的起始位置
            let aiResponse = this.extractAIResponse(response);
            logger.info(`AI回复部分长度: ${aiResponse.length} 字符`);

            const prompts = [];

            // ========================================
            // 策略1：提取"提示词 X："格式（最常见）
            // ========================================
            // 匹配：提示词1：、提示词 1：、提示词一：等
            const promptPattern = /提示词\s*([一二三四五12345])[：:\s]+\n?\s*([^\n]*?)(?:\n|$)([\s\S]*?)(?=提示词\s*[一二三四五12345][：:\s]+|第\s*[一二三四五12345]\s*[组組]|$)/gi;
            let matches = [...aiResponse.matchAll(promptPattern)];

            if (matches.length >= 5) {
                logger.info(`✅ 找到 ${matches.length} 组提示词（按"提示词 X"格式）`);

                for (let i = 0; i < 5 && i < matches.length; i++) {
                    const match = matches[i];
                    const promptNum = match[1];
                    let title = match[2] ? match[2].trim() : '';
                    let content = match[3] ? match[3].trim() : '';

                    // 提取代码块中的内容
                    const codeBlockMatch = content.match(/```(?:plaintext|text)?\s*\n?([\s\S]*?)```/i);
                    if (codeBlockMatch) {
                        content = codeBlockMatch[1].trim();
                    }

                    let fullPrompt = title && title.length > 0 && !title.toLowerCase().includes('plaintext')
                        ? `${title}\n${content}`
                        : content;

                    fullPrompt = this.cleanPromptContent(fullPrompt);

                    if (fullPrompt.length > 30) {
                        prompts.push(fullPrompt);
                        logger.info(`  提示词 ${promptNum}: ${fullPrompt.substring(0, 60)}...`);
                    }
                }
            }

            // ========================================
            // 策略2：提取"第 X 组"格式
            // ========================================
            if (prompts.length < 5) {
                prompts.length = 0;
                logger.info('尝试按"第 X 组"格式提取...');

                const groupPattern = /第\s*([一二三四五12345])\s*[组組]?[：:\s]+\n?\s*([^\n]*?)(?:\n|$)([\s\S]*?)(?=第\s*[一二三四五12345]\s*[组組]?[：:\s]+|提示词\s*[12345][：:\s]+|$)/gi;
                matches = [...aiResponse.matchAll(groupPattern)];

                if (matches.length >= 5) {
                    logger.info(`✅ 找到 ${matches.length} 组提示词（按"第 X 组"格式）`);

                    for (let i = 0; i < 5 && i < matches.length; i++) {
                        const match = matches[i];
                        const groupNum = match[1];
                        let title = match[2] ? match[2].trim() : '';
                        let content = match[3] ? match[3].trim() : '';

                        const codeBlockMatch = content.match(/```(?:plaintext|text)?\s*\n?([\s\S]*?)```/i);
                        if (codeBlockMatch) {
                            content = codeBlockMatch[1].trim();
                        }

                        let fullPrompt = title && title.length > 0 && !title.toLowerCase().includes('plaintext')
                            ? `${title}\n${content}`
                            : content;

                        fullPrompt = this.cleanPromptContent(fullPrompt);

                        if (fullPrompt.length > 30) {
                            prompts.push(fullPrompt);
                            logger.info(`  第 ${groupNum} 组: ${fullPrompt.substring(0, 60)}...`);
                        }
                    }
                }
            }

            // ========================================
            // 策略3：提取"X. 标题"或"X 标题"格式（处理截图中的格式）
            // ========================================
            if (prompts.length < 5) {
                prompts.length = 0;
                logger.info('尝试按"X. 标题"格式提取...');

                // 匹配：1. 标题、1、标题、1）标题 等
                const numPattern = /(?:^|\n)([12345])[\.．、\s]+([^\n]*?)(?:\n|$)([\s\S]*?)(?=(?:^|\n)[12345][\.．、\s]+|提示词\s*[12345][：:\s]+|第\s*[一二三四五12345]\s*[组組]|$)/gm;
                matches = [...aiResponse.matchAll(numPattern)];

                if (matches.length >= 5) {
                    logger.info(`✅ 找到 ${matches.length} 组提示词（按"X. 标题"格式）`);

                    for (let i = 0; i < 5 && i < matches.length; i++) {
                        const match = matches[i];
                        const num = match[1];
                        let title = match[2] ? match[2].trim() : '';
                        let content = match[3] ? match[3].trim() : '';

                        const codeBlockMatch = content.match(/```(?:plaintext|text)?\s*\n?([\s\S]*?)```/i);
                        if (codeBlockMatch) {
                            content = codeBlockMatch[1].trim();
                        }

                        let fullPrompt = title && title.length > 0
                            ? `${title}\n${content}`
                            : content;

                        fullPrompt = this.cleanPromptContent(fullPrompt);

                        if (fullPrompt.length > 30) {
                            prompts.push(fullPrompt);
                            logger.info(`  [${num}] ${fullPrompt.substring(0, 60)}...`);
                        }
                    }
                }
            }

            // ========================================
            // 策略3.5：提取"提示词 X：标题"格式 + 代码块（截图中的格式）
            // ========================================
            if (prompts.length < 5) {
                prompts.length = 0;
                logger.info('尝试按"提示词 X：标题 + 代码块"格式提取...');

                // 匹配：提示词 5：末世废土·佛影残阳
                const promptTitlePattern = /提示词\s*([12345])[：:\s]+([^\n]+)(?:\n|$)/gi;
                const titleMatches = [...aiResponse.matchAll(promptTitlePattern)];

                if (titleMatches.length >= 5) {
                    logger.info(`✅ 找到 ${titleMatches.length} 组"提示词 X"标题`);

                    // 提取所有代码块
                    const codeBlockPattern = /```(?:plaintext|text)?\s*\n?([\s\S]*?)(?:```|$)/gi;
                    const codeBlocks = [...aiResponse.matchAll(codeBlockPattern)];

                    logger.info(`找到 ${codeBlocks.length} 个代码块`);

                    for (let i = 0; i < 5 && i < titleMatches.length; i++) {
                        const titleMatch = titleMatches[i];
                        const num = titleMatch[1];
                        let title = titleMatch[2].trim();

                        // 找到对应的代码块（按顺序匹配）
                        let content = '';
                        if (i < codeBlocks.length) {
                            content = codeBlocks[i][1].trim();
                        }

                        // 组合标题和内容
                        let fullPrompt = title;
                        if (content) {
                            fullPrompt = `${title}\n${content}`;
                        }

                        fullPrompt = this.cleanPromptContent(fullPrompt);

                        if (fullPrompt.length > 30) {
                            prompts.push(fullPrompt);
                            logger.info(`  提示词 ${num}: ${fullPrompt.substring(0, 60)}...`);
                        }
                    }
                }
            }

            // ========================================
            // 策略3.6：提取"X. 标题"格式 + 代码块（如 5. 冰原上的青椒怪车）
            // ========================================
            if (prompts.length < 5) {
                prompts.length = 0;
                logger.info('尝试按"X. 标题 + 代码块"格式提取...');

                // 匹配：5. 冰原上的青椒怪车（奇幻惊悚向）
                const dotNumberPattern = /(?:^|\n)\s*([12345])[\.．、]\s*([^\n]+)(?:\n|$)/g;
                const titleMatches = [...aiResponse.matchAll(dotNumberPattern)];

                if (titleMatches.length >= 5) {
                    logger.info(`✅ 找到 ${titleMatches.length} 组"X. 标题"格式`);

                    // 提取所有代码块
                    const codeBlockPattern = /```(?:plaintext|text)?\s*\n?([\s\S]*?)(?:```|$)/gi;
                    const codeBlocks = [...aiResponse.matchAll(codeBlockPattern)];

                    logger.info(`找到 ${codeBlocks.length} 个代码块`);

                    for (let i = 0; i < 5 && i < titleMatches.length; i++) {
                        const titleMatch = titleMatches[i];
                        const num = titleMatch[1];
                        let title = titleMatch[2].trim();

                        // 找到对应的代码块（按顺序匹配）
                        let content = '';
                        if (i < codeBlocks.length) {
                            content = codeBlocks[i][1].trim();
                        }

                        // 组合标题和内容
                        let fullPrompt = title;
                        if (content) {
                            fullPrompt = `${title}\n${content}`;
                        }

                        fullPrompt = this.cleanPromptContent(fullPrompt);

                        if (fullPrompt.length > 30) {
                            prompts.push(fullPrompt);
                            logger.info(`  [${num}] ${fullPrompt.substring(0, 60)}...`);
                        }
                    }
                }
            }

            // ========================================
            // ========================================
            // 策略3.7：提取"X. 标题"格式 + 纯文本段落（无代码块）
            // ========================================
            if (prompts.length < 5) {
                prompts.length = 0;
                logger.info('尝试按"X. 标题 + 纯文本"格式提取...');

                // 匹配：4. 末日营地 · 远景叙事版 后面跟着正文
                // 使用非贪婪匹配捕获标题，然后捕获到下一个标题或结束
                const plainTextPattern = /(?:^|\n)\s*([12345])[\.．、]\s*([^\n]+)\n+([\s\S]*?)(?=(?:^|\n)\s*[12345][\.．、]\s*[^\n]+\n+|提示词\s*[12345][：:\s]+|$)/gm;
                const matches = [...aiResponse.matchAll(plainTextPattern)];

                if (matches.length >= 5) {
                    logger.info(`✅ 找到 ${matches.length} 组"X. 标题 + 纯文本"格式`);

                    for (let i = 0; i < 5 && i < matches.length; i++) {
                        const match = matches[i];
                        const num = match[1];
                        let title = match[2].trim();
                        let content = match[3].trim();

                        // 组合标题和内容
                        let fullPrompt = title;
                        if (content && content.length > 20) {
                            fullPrompt = `${title}\n${content}`;
                        }

                        fullPrompt = this.cleanPromptContent(fullPrompt);

                        if (fullPrompt.length > 30) {
                            prompts.push(fullPrompt);
                            logger.info(`  [${num}] ${fullPrompt.substring(0, 60)}...`);
                        }
                    }
                }
            }

            // ========================================
            // 策略3.8：提取"提示词 X：标题"格式 + 纯文本段落（无代码块）
            // ========================================
            if (prompts.length < 5) {
                prompts.length = 0;
                logger.info('尝试按"提示词 X：标题 + 纯文本"格式提取...');

                // 匹配：提示词 4：冰封物品特写 · 末日细节镜头 后面跟着正文
                const promptTextPattern = /提示词\s*([12345])[：:\s]+([^\n]+)\n+([\s\S]*?)(?=提示词\s*[12345][：:\s]+|$)/gi;
                const matches = [...aiResponse.matchAll(promptTextPattern)];

                if (matches.length >= 5) {
                    logger.info(`✅ 找到 ${matches.length} 组"提示词 X：标题 + 纯文本"格式`);

                    for (let i = 0; i < 5 && i < matches.length; i++) {
                        const match = matches[i];
                        const num = match[1];
                        let title = match[2].trim();
                        let content = match[3].trim();

                        // 组合标题和内容
                        let fullPrompt = title;
                        if (content && content.length > 20) {
                            fullPrompt = `${title}\n${content}`;
                        }

                        fullPrompt = this.cleanPromptContent(fullPrompt);

                        if (fullPrompt.length > 30) {
                            prompts.push(fullPrompt);
                            logger.info(`  提示词 ${num}: ${fullPrompt.substring(0, 60)}...`);
                        }
                    }
                }
            }

            // ========================================
            // 策略3.9：提取蓝色编号徽章格式（如 `1 「冰原青椒越野车」`）
            // ========================================
            if (prompts.length < 5) {
                prompts.length = 0;
                logger.info('尝试按"蓝色编号徽章"格式提取（如 1 「标题」）...');

                // 匹配：1 「冰原青椒越野车」 或 1「标题」或 1.「标题」等
                // 这种格式通常是：数字 + 可选空格 + 「标题」+ 换行 + 内容
                const badgePattern = /(?:^|\n)\s*([12345])[\.．、\s]*[\s「【\[]*([^\n「【\]]+)[」\]】]?\s*(?:\n+([\s\S]*?))?(?=(?:^|\n)\s*[12345][\.．、\s]*[「【\[]|$)/gm;
                const matches = [...aiResponse.matchAll(badgePattern)];

                if (matches.length >= 5) {
                    logger.info(`✅ 找到 ${matches.length} 组"蓝色编号徽章"格式`);

                    for (let i = 0; i < 5 && i < matches.length; i++) {
                        const match = matches[i];
                        const num = match[1];
                        let title = match[2] ? match[2].trim() : '';
                        let content = match[3] ? match[3].trim() : '';

                        // 清理标题中的特殊字符
                        title = title.replace(/[「」【】\[\]]/g, '').trim();

                        // 提取代码块中的内容（如果有）
                        const codeBlockMatch = content.match(/```(?:plaintext|text)?\s*\n?([\s\S]*?)```/i);
                        if (codeBlockMatch) {
                            content = codeBlockMatch[1].trim();
                        }

                        // 组合标题和内容
                        let fullPrompt = title;
                        if (content && content.length > 20) {
                            fullPrompt = `${title}\n${content}`;
                        }

                        fullPrompt = this.cleanPromptContent(fullPrompt);

                        if (fullPrompt.length > 30) {
                            prompts.push(fullPrompt);
                            logger.info(`  [${num}] ${fullPrompt.substring(0, 60)}...`);
                        }
                    }
                }
            }

            // 策略4：按代码块提取
            // ========================================
            if (prompts.length < 5) {
                prompts.length = 0;
                logger.info('尝试从代码块中提取...');

                const codeBlockPattern = /```(?:plaintext|text)?\s*\n?([\s\S]*?)(?:```|$)/gi;
                const codeBlocks = [...aiResponse.matchAll(codeBlockPattern)];

                if (codeBlocks.length >= 5) {
                    logger.info(`✅ 找到 ${codeBlocks.length} 个代码块`);

                    for (let i = 0; i < 5 && i < codeBlocks.length; i++) {
                        let content = codeBlocks[i][1].trim();
                        content = this.cleanPromptContent(content);

                        if (content.length > 30) {
                            prompts.push(content);
                            logger.info(`  代码块 ${i + 1}: ${content.substring(0, 60)}...`);
                        }
                    }
                }
            }

            // ========================================
            // 策略5：智能段落分割（兜底）
            // ========================================
            if (prompts.length < 5) {
                prompts.length = 0;
                logger.info('使用智能段落分割策略...');

                // 需要过滤掉的关键词（豆包的追问和结束语）
                const invalidKeywords = [
                    '要不要我',
                    '短词版',
                    '再生成',
                    '推荐一些',
                    '进一步提高',
                    '针对其中某一个',
                    '帮你针对',
                    '需要我',
                    '还有什么',
                    '随时告诉我',
                    '随时找我'
                ];

                const segments = aiResponse
                    .split(/\n{2,}/)
                    .map(s => s.trim())
                    .filter(s => {
                        // 基础过滤
                        if (s.length < 50 || s.match(/^```/)) return false;
                        // 过滤掉包含无效关键词的段落
                        for (const kw of invalidKeywords) {
                            if (s.includes(kw)) return false;
                        }
                        return true;
                    });

                // 英文提示词特征关键词
                const englishPromptKeywords = ['render', '3D', 'cinematic', 'game', 'poster', 'quality', 'detailed', 'lighting', 'shadow', 'texture', 'octane', 'unreal'];
                const chinesePromptKeywords = ['3D', '渲染', '海报', '场景', '画面', '镜头', '光影', '风格', '视角', '构图', '卡通'];

                const scored = segments.map(seg => {
                    let score = 0;

                    // 英文关键词加分（豆包生成的提示词通常是英文）
                    englishPromptKeywords.forEach(kw => {
                        if (seg.toLowerCase().includes(kw.toLowerCase())) score += 15;
                    });

                    // 中文关键词加分
                    chinesePromptKeywords.forEach(kw => {
                        if (seg.includes(kw)) score += 10;
                    });

                    // 长度加分（提示词通常较长）
                    score += Math.min(seg.length / 30, 40);

                    // 包含用户请求关键词扣分
                    if (seg.includes('帮我参考') || seg.includes('生成五组') || seg.includes('帮我参考这张图')) score -= 1000;

                    // 以数字或提示词开头的加分
                    if (/^(提示词\s*\d|【?\d[\.．、】]|\d[\.．、])/.test(seg)) score += 20;

                    return { seg, score };
                });

                // 按分数排序
                scored.sort((a, b) => b.score - a.score);

                logger.info(`找到 ${scored.length} 个候选段落，取前5个`);

                // 取前5个
                for (let i = 0; i < 5 && i < scored.length; i++) {
                    let content = this.cleanPromptContent(scored[i].seg);
                    if (content.length > 100) {  // 提示词应该足够长
                        prompts.push(content);
                        logger.info(`  [${i+1}] 分数: ${scored[i].score}, 内容: ${content.substring(0, 60)}...`);
                    }
                }
            }

            // ========================================
            // 验证和过滤结果
            // ========================================

            // 最终过滤：确保没有无效内容
            const invalidPatterns = [
                '要不要我',
                '短词版',
                '再生成',
                '推荐一些',
                '进一步提高',
                '帮你针对',
                '随时告诉我'
            ];

            const validPrompts = prompts.filter(p => {
                for (const pattern of invalidPatterns) {
                    if (p.includes(pattern)) {
                        logger.warn(`过滤掉包含无效内容的段落: ${p.substring(0, 50)}...`);
                        return false;
                    }
                }
                // 确保包含英文提示词特征
                const hasEnglishContent = /\b(render|3D|cinematic|shot|scene|lighting|texture|quality|detailed)\b/i.test(p);
                if (!hasEnglishContent) {
                    logger.warn(`过滤掉非英文提示词: ${p.substring(0, 50)}...`);
                }
                return hasEnglishContent;
            });

            if (validPrompts.length >= 5) {
                logger.info(`✅ 已提取到 ${validPrompts.length} 组有效提示词`);

                const finalPrompts = validPrompts.slice(0, 5).map((p, index) => ({
                    id: index + 1,
                    content: p.substring(0, 2000),
                    preview: p.substring(0, 80) + '...'
                }));

                this.lastExtractedPrompts = finalPrompts;

                logger.info('提取结果摘要:');
                finalPrompts.forEach((p, i) => {
                    logger.info(`  [${i + 1}] ${p.preview}`);
                });

                return {
                    success: true,
                    prompts: finalPrompts,
                    message: `成功提取 ${finalPrompts.length} 组提示词`
                };
            } else {
                logger.error(`❌ 提取失败：只找到 ${validPrompts.length} 组有效提示词，需要5组`);
                return {
                    success: false,
                    prompts: validPrompts.map((p, index) => ({
                        id: index + 1,
                        content: p,
                        preview: p.substring(0, 80) + '...'
                    })),
                    message: `只提取到 ${prompts.length} 组提示词，需要5组`
                };
            }

        } catch (error) {
            logger.error(`❌ 提取提示词失败: ${error.message}`);
            return {
                success: false,
                prompts: [],
                message: `提取失败: ${error.message}`
            };
        }
    }

    /**
     * 从完整响应中提取AI回复部分
     * 过滤掉用户发送的提示词请求和引导语
     */
    extractAIResponse(response) {
        // 找到AI回复的起始位置
        const userMarkers = [
            '帮我参考这张图',
            '生成五组不同画面提示词',
            '画面直观、主题明确'
        ];

        let aiStartIndex = 0;

        for (const marker of userMarkers) {
            const index = response.indexOf(marker);
            if (index !== -1) {
                const afterMarker = response.substring(index);
                const aiStartMatch = afterMarker.match(/(第\s*[一二三四五12345]\s*[组組]|提示词\s*[一二三四五12345]|[一二三四五12345][\.．、\s]+|我参考)/);
                if (aiStartMatch) {
                    const relativeIndex = afterMarker.indexOf(aiStartMatch[0]);
                    const absoluteIndex = index + relativeIndex;
                    if (absoluteIndex > aiStartIndex) {
                        aiStartIndex = absoluteIndex;
                    }
                }
            }
        }

        let aiResponse = response.substring(aiStartIndex);

        // 过滤引导语
        const introPatterns = [
            /^我参考.*?(?:为你创作|生成|提供)/,
            /^根据.*?参考图/,
            /^以下是.*?5组/,
            /^这是.*?提示词/,
            /^(?:好的|好的，|OK，|没问题，)/
        ];

        for (const pattern of introPatterns) {
            aiResponse = aiResponse.replace(pattern, '');
        }

        return aiResponse.trim();
    }

    /**
     * 清理提示词内容
     * 移除代码块标记、复制按钮文本等无关内容
     */
    cleanPromptContent(content) {
        // 清理代码块标记
        let cleaned = content
            .replace(/```(?:plaintext|text)?\s*\n?/gi, '')
            .replace(/```/g, '')
            .replace(/<plaintext>/gi, '')
            .replace(/复制/g, '')
            .replace(/复制代码/g, '')
            .replace(/^\s*[\*\-•]\s*/gm, '')
            .replace(/\n{3,}/g, '\n\n')
            .trim();

        // 移除豆包的追问和结束语（从第一个无效关键词开始截断）
        const invalidPatterns = [
            '要不要我再帮你',
            '要不要我',
            '做一份更精简',
            '短词版',
            '再生成一组',
            '推荐一些',
            '进一步提高',
            '随时告诉我',
            '随时找我',
            '需要我帮你',
            '如果你想',
            '我可以帮你'
        ];

        for (const pattern of invalidPatterns) {
            const index = cleaned.indexOf(pattern);
            if (index !== -1) {
                cleaned = cleaned.substring(0, index).trim();
            }
        }

        return cleaned;
    }

    /**
     * 获取当前豆包页面
     * @returns {Page|null} - Playwright 页面对象
     */
    getCurrentPage() {
        return browserController.getPage('doubao');
    }

    /**
     * 设置自定义提示词
     * @param {string} prompt - 自定义提示词
     */
    setPrompt(prompt) {
        this.promptTemplate = prompt;
        logger.info('已更新提示词模板');
    }

    /**
     * 重置提示词为默认值
     */
    resetPrompt() {
        this.promptTemplate = `帮我参考这张图，生成五组不同画面提示词，要求画面直观、主题明确、高质量3D卡通渲染、商业级游戏宣传海报风格、电影镜头感、内容尽可能详细。`;
        logger.info('已重置提示词为默认值');
    }

    /**
     * 可中断的 sleep
     * 定期检查工作流是否已停止，如果停止则提前返回
     * @param {number} ms - 延迟毫秒数
     */
    async interruptibleSleep(ms) {
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

    /**
     * 随机延迟
     * 在 min 和 max 毫秒之间随机延迟，模拟人工操作节奏
     * @param {number} min - 最小延迟（毫秒）
     * @param {number} max - 最大延迟（毫秒）
     */
    async randomDelay(min, max) {
        const delay = Math.floor(Math.random() * (max - min + 1)) + min;
        await browserController.sleep(delay);
    }

    /**
     * 自然点击
     * 模拟人工点击，带随机延迟
     * @param {Element} element - 要点击的元素
     */
    async naturalClick(element) {
        // 先移动到元素上
        await element.hover().catch(() => {});
        await this.randomDelay(100, 300);
        // 点击
        await element.click();
    }

    /**
     * 模拟人工打字
     * 逐字输入，每个字符之间有随机延迟
     * @param {Element} element - 输入元素
     * @param {string} text - 要输入的文本
     */
    async typeLikeHuman(element, text) {
        // 先清空现有内容
        await element.click();
        await element.press('Control+a');
        await this.randomDelay(100, 200);
        await element.press('Delete');
        await this.randomDelay(200, 400);

        // 逐字输入
        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            await element.type(char);
            // 随机延迟 50-150 毫秒
            await this.randomDelay(50, 150);

            // 每输入 20 个字符，停顿久一点（模拟思考）
            if (i > 0 && i % 20 === 0) {
                await this.randomDelay(300, 600);
            }
        }
    }

    /**
     * 检查是否有验证弹窗
     * @param {Page} page - Playwright 页面对象
     * @returns {Promise<boolean>}
     */
    async checkForCaptcha(page) {
        try {
            // 常见的验证弹窗特征
            const captchaSelectors = [
                '[class*="captcha"]',
                '[class*="verify"]',
                '[class*="validation"]',
                'text=验证',
                'text=请选择',
                'text=拖拽',
                'text=常见的',
                'text=家养宠物',
                'text=符合上文描述',
                '[role="dialog"]:has(text=验证)',
                'div[role="dialog"]',
                'div[class*="modal"]',
            ];

            for (const selector of captchaSelectors) {
                try {
                    const element = await page.$(selector);
                    if (element) {
                        const isVisible = await element.isVisible().catch(() => false);
                        if (isVisible) {
                            // 检查是否包含验证相关的文本
                            const text = await element.textContent().catch(() => '');
                            if (text.includes('验证') ||
                                text.includes('请选择') ||
                                text.includes('拖拽') ||
                                text.includes('常见的') ||
                                text.includes('家养宠物') ||
                                text.includes('符合上文')) {
                                return true;
                            }
                        }
                    }
                } catch (e) {
                    // 忽略错误
                }
            }

            return false;
        } catch (error) {
            return false;
        }
    }

    /**
     * 等待用户完成验证
     * 检测到验证弹窗时暂停，让用户手动完成
     * @param {Page} page - Playwright 页面对象
     */
    async waitForCaptchaComplete(page) {
        logger.warn('');
        logger.warn('========================================');
        logger.warn('⏸️  等待用户完成人机验证');
        logger.warn('========================================');
        logger.warn('请在浏览器窗口中完成验证操作：');
        logger.warn('1. 按照提示完成图片验证（如拖拽、选择等）');
        logger.warn('2. 完成后系统会自动检测到并继续执行');
        logger.warn('========================================');

        // 等待最多 120 秒，让用户完成验证
        const maxWaitTime = 120000;
        const checkInterval = 3000;
        let waited = 0;

        while (waited < maxWaitTime) {
            await browserController.sleep(checkInterval);
            waited += checkInterval;

            // 每10秒提醒一次
            if (waited % 10000 === 0) {
                logger.info(`⏳ 仍在等待验证完成... (${waited/1000}秒)`);
            }

            // 检查验证是否消失
            const stillHasCaptcha = await this.checkForCaptcha(page);
            if (!stillHasCaptcha) {
                logger.info('');
                logger.info('========================================');
                logger.info('✅ 验证已完成，继续执行');
                logger.info('========================================');
                return;
            }
        }

        logger.error('❌ 验证等待超时 (120秒)，请重新尝试');
        throw new Error('验证超时');
    }

    /**
     * 检查豆包是否正在生成回复
     * 通过检测"停止生成"按钮来判断
     * @param {Page} page - Playwright 页面对象
     * @returns {Promise<boolean>}
     */
    async isGenerating(page) {
        try {
            // 检查是否有"停止生成"按钮 - 表示正在生成中
            const stopButtonSelectors = [
                'button:has-text("停止生成")',
                '[class*="stop"]',
                'button svg[class*="stop"]',
                'button:has(svg):has-text("")'  // 可能是纯图标按钮
            ];

            for (const selector of stopButtonSelectors) {
                const button = await page.$(selector);
                if (button) {
                    const isVisible = await button.isVisible().catch(() => false);
                    if (isVisible) {
                        // 进一步确认按钮文本或属性
                        const text = await button.textContent().catch(() => '');
                        if (text.includes('停止') || text.includes('Stop')) {
                            return true;
                        }
                        // 检查按钮的title或aria-label
                        const title = await button.getAttribute('title').catch(() => '');
                        const ariaLabel = await button.getAttribute('aria-label').catch(() => '');
                        if (title.includes('停止') || ariaLabel.includes('停止')) {
                            return true;
                        }
                    }
                }
            }

            return false;
        } catch (error) {
            return false;
        }
    }

    /**
     * 检查回复是否已完成
     * 通过检测是否有AI回复内容来判断
     * @param {Page} page - Playwright 页面对象
     * @returns {Promise<boolean>}
     */
    async checkResponseComplete(page) {
        try {
            // 获取页面文本内容
            const bodyText = await page.$eval('body', body => body.innerText);

            // 检查是否有5组提示词的标志（支持多种格式：提示词 X、X. 标题、第 X 组）
            const hasMultiplePrompts =
                (bodyText.match(/提示词\s*[12345]/gi) || []).length >= 5 ||
                (bodyText.match(/[12345][\.．、]\s*[^\n]{3,}/g) || []).length >= 5 ||
                (bodyText.match(/第\s*[12345]\s*[组組]/g) || []).length >= 5;

            // 检查是否有结束标志（如"如果你想针对某一组提示词调整"等）
            const hasEndingIndicator =
                bodyText.includes('如果你想') ||
                bodyText.includes('随时告诉我') ||
                bodyText.includes('我可以帮你') ||
                bodyText.includes('以上') ||
                bodyText.includes('完成');

            // 检查内容长度是否足够（5组提示词通常很长）
            const contentLength = bodyText.length;

            // 如果检测到5组提示词且内容足够长，则认为已完成
            if (hasMultiplePrompts && contentLength > 500) {
                return true;
            }

            // 检查是否有AI消息气泡
            const assistantSelectors = [
                '[data-role="assistant"]',
                '[class*="assistant"]',
                '[class*="bot-message"]'
            ];

            for (const selector of assistantSelectors) {
                const elements = await page.$$(selector);
                if (elements.length > 0) {
                    // 检查最后一个AI消息的长度
                    const lastElement = elements[elements.length - 1];
                    const text = await lastElement.textContent().catch(() => '');
                    if (text.length > 300 && hasMultiplePrompts) {
                        return true;
                    }
                }
            }

            return false;
        } catch (error) {
            return false;
        }
    }

    /**
     * 记录处理失败的图片
     * @param {string} imagePath - 图片路径
     * @param {string} reason - 失败原因
     */
    async logFailedImage(imagePath, reason) {
        const fs = require('fs');
        const path = require('path');
        const imageName = path.basename(imagePath);
        const timestamp = new Date().toISOString();
        const logEntry = `[${timestamp}] 图片: ${imageName} | 原因: ${reason}\n`;

        const logFile = path.join(__dirname, 'failed_images.log');

        try {
            fs.appendFileSync(logFile, logEntry);
            logger.info(`📝 已记录失败图片到日志: ${logFile}`);
        } catch (e) {
            logger.error(`❌ 记录失败图片日志时出错: ${e.message}`);
        }
    }
}

// 导出单例实例
module.exports = new DoubaoAutomation();
