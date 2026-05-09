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
