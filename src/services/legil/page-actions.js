/**
 * Legil page actions.
 *
 * Methods are copied from the original LegilAutomation class and grouped by
 * responsibility so the automation flow is easier to inspect.
 */
module.exports = function createPageActionsMethods(deps) {
    const {
        browserController,
        logger,
        fs,
        path,
        formatDateTimeForFile,
        padNumber,
        sanitizeFileNamePart,
        sortNaturallyByName,
        isAbortRequested,
        throwIfAborted,
        interruptibleSleep,
        normalizeImageUrl,
        isLegilOutputUrl,
        extractLegilImageUrl,
        isPageLocalImageUrl,
        LEGIL_DEFAULT_SETTINGS,
        LEGIL_IMAGE_MODEL_OPTIONS,
        LEGIL_ASPECT_RATIOS,
        LEGIL_RESOLUTIONS,
        LEGIL_OUTPUT_QUANTITIES,
        IMAGE_EXTENSIONS,
        LEGIL_IMAGE_TO_IMAGE_URL,
        LEGIL_ERROR_SCREENSHOT_DIR
    } = deps;

    return {
    async captureErrorScreenshot(page, error, options = {}) {
        if (options.captureErrorScreenshot === false || !page || page.isClosed()) {
            return '';
        }

        try {
            fs.mkdirSync(LEGIL_ERROR_SCREENSHOT_DIR, { recursive: true });
            const timestamp = formatDateTimeForFile();
            const promptPart = padNumber(Number(options.promptIndexWithinImage || options.promptIndex || 0) || 0, 2);
            const runPart = sanitizeFileNamePart(options.runId || 'legil_error', 40);
            const fileName = `${runPart}_prompt${promptPart}_${timestamp}.png`;
            const screenshotPath = path.join(LEGIL_ERROR_SCREENSHOT_DIR, fileName);
            await page.screenshot({
                path: screenshotPath,
                fullPage: true,
                timeout: 10000
            });
            logger.warn(`已保存 Legil 异常截图: ${screenshotPath}`);
            this.emit('legil-exception', {
                screenshotPath,
                message: error && error.message ? error.message : String(error || '未知错误'),
                promptIndex: options.promptIndexWithinImage || options.promptIndex,
                runId: options.runId || '',
                referenceImageName: options.referenceImageName || '',
                taskType: options.taskType || '',
                stage: options.stage || ''
            });
            return screenshotPath;
        } catch (screenshotError) {
            logger.warn(`保存 Legil 异常截图失败: ${screenshotError.message}`);
            return '';
        }
    },

    async refreshLegilPageOnce(page, options = {}) {
        if (!page || page.isClosed()) {
            return false;
        }

        try {
            logger.warn('Legil 可能卡住，正在自动刷新页面并重试一次...');
            await page.reload({
                waitUntil: 'domcontentloaded',
                timeout: 30000
            });
            await interruptibleSleep(8000, options);
            await this.ensureLegilImageToImagePage(page, options);
            return true;
        } catch (error) {
            logger.warn(`Legil 自动刷新失败: ${error.message}`);
            return false;
        }
    }

    /**
     * 扫描参考图文件夹中的所有图片
     */,

    async ensureLegilImageToImagePage(page, options = {}) {
        throwIfAborted(options);

        const hasControls = async () => page.evaluate(() => {
            const isVisible = (el) => {
                const rect = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return rect.width > 0 &&
                    rect.height > 0 &&
                    style.visibility !== 'hidden' &&
                    style.display !== 'none' &&
                    style.opacity !== '0';
            };

            const hasFileInput = document.querySelectorAll('input[type="file"]').length > 0;
            const hasPromptInput = Array.from(document.querySelectorAll('textarea, input[type="text"]'))
                .some(el => isVisible(el));
            const hasGenerateButton = Array.from(document.querySelectorAll('button'))
                .some(button => isVisible(button) && /创建图片|生成|重新生成/.test(button.innerText || button.textContent || ''));

            return {
                hasFileInput,
                hasPromptInput,
                hasGenerateButton,
                text: (document.body?.innerText || '').slice(0, 800)
            };
        }).catch(() => ({
            hasFileInput: false,
            hasPromptInput: false,
            hasGenerateButton: false,
            text: ''
        }));

        let controls = await hasControls();
        if (controls.hasPromptInput && controls.hasGenerateButton) {
            return true;
        }

        const currentUrl = page.url();
        if (!currentUrl.includes('/legil/image-ai/image-to-image')) {
            logger.warn('当前未停留在 Legil 图生图页面，正在重新进入图生图页面...');
            await page.goto(LEGIL_IMAGE_TO_IMAGE_URL, {
                waitUntil: 'domcontentloaded',
                timeout: 30000
            }).catch(() => {});
            await interruptibleSleep(5000, options);
            controls = await hasControls();
            if (controls.hasPromptInput && controls.hasGenerateButton) {
                return true;
            }
        }

        if (/登录|login|sign in/i.test(controls.text) && !controls.hasPromptInput) {
            throw new Error('Legil 自动化浏览器未登录或登录已过期，请在自动化浏览器中登录 Legil 后重试');
        }

        throw new Error('未进入 Legil 图生图页面，请先打开 Legil 图生图页面后重试');
    },

    async uploadReferenceImage(page, options = {}) {
        try {
            throwIfAborted(options);

            let imagePath = '';
            const directReferenceImagePath = typeof options.referenceImagePath === 'string'
                ? options.referenceImagePath.trim()
                : '';

            if (directReferenceImagePath) {
                const ext = path.extname(directReferenceImagePath).toLowerCase();
                if (!IMAGE_EXTENSIONS.includes(ext)) {
                    logger.warn(`指定参考图格式不支持，跳过: ${directReferenceImagePath}`);
                    return false;
                }

                if (!fs.existsSync(directReferenceImagePath)) {
                    logger.warn(`指定参考图文件不存在，跳过: ${directReferenceImagePath}`);
                    return false;
                }

                const stats = fs.statSync(directReferenceImagePath);
                if (!stats.isFile()) {
                    logger.warn(`指定参考图不是文件，跳过: ${directReferenceImagePath}`);
                    return false;
                }

                imagePath = directReferenceImagePath;
            } else {
                // 确保已扫描参考图
                if (this.referenceImages.length === 0) {
                    this.scanReferenceImages();
                }

                if (this.referenceImages.length === 0) {
                    logger.warn('没有可用的参考图');
                    return false;
                }

                // 获取下一张参考图
                imagePath = this.getNextReferenceImage();
                if (!imagePath) {
                    logger.warn('无法获取参考图');
                    return false;
                }

                if (!fs.existsSync(imagePath)) {
                    logger.warn(`参考图文件不存在，跳过: ${imagePath}`);
                    this.scanReferenceImages();
                    return false;
                }
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
     */,

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
    };
};
