
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

            // 第三步：等待回复
            const waitTime = 90;
            logger.info(`已发送，等待豆包生成回复（约 ${waitTime} 秒）...`);
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
