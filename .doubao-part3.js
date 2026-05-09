
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
            await browserController.sleep(2000);

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

                            if (!isUserMessage && text.length > 200) {
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
}

// 导出单例实例
module.exports = new DoubaoAutomation();
