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

            // 第三步：等待回复（1-3分钟随机等待，避免规律化）
            const minWait = 60;
            const maxWait = 180;
            const waitTime = Math.floor(Math.random() * (maxWait - minWait + 1)) + minWait;
            logger.info(`已发送，等待豆包生成回复（约 ${waitTime} 秒 / ${(waitTime/60).toFixed(1)} 分钟）...`);
            logger.info('⏳ 请耐心等待，正在分析图片并生成提示词...');
            await browserController.sleep(waitTime * 1000);

            // 第四步：获取回复内容
            logger.browser('正在获取回复内容...');
            const response = await this.getLastResponse(page);

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

            // 尝试多种选择器定位"新对话"按钮
            const newChatSelectors = [
                'button:has-text("新对话")',
                '[class*="new-chat"]',
                '[class*="new-conversation"]',
                'button:has(svg):has-text("")',
                'div:has-text("新对话")',
                'a:has-text("新对话")',
                '[data-testid*="new-chat"]',
                'button[class*="btn"]:has-text("新")',
                'div[class*="sidebar"] button:first-of-type',
                'aside button:first-of-type'
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

            // 如果没找到按钮，尝试通过快捷键或URL刷新
            if (!clicked) {
                logger.info('未找到"新对话"按钮，尝试刷新页面...');
                await page.goto('https://www.doubao.com/chat/');
                logger.info('✅ 已刷新页面到新对话');
                clicked = true;
            }

            // 等待新对话加载完成
            await browserController.sleep(3000);
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

            // 尝试直接找文件输入框
            const fileInput = await page.$('input[type="file"]');

            if (fileInput) {
                logger.info('找到文件输入框，正在上传...');

                // 直接设置文件，不点击（避免弹出文件选择对话框）
                await fileInput.setInputFiles(imagePath);
                logger.info('图片已选择，等待上传完成...');

                // 等待更长时间，让图片上传完成
                await this.randomDelay(3000, 5000);

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
                        await this.randomDelay(2000, 3000);
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
