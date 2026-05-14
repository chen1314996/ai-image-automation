/**
 * Legil generation flow.
 *
 * Methods are copied from the original LegilAutomation class and grouped by
 * responsibility so the automation flow is easier to inspect.
 */
module.exports = function createGenerationFlowMethods(deps) {
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
        let page = null;

        try {
            throwIfAborted(options);

            const useHeadlessBrowser = options.headless === true;
            const browserReady = await browserController.ensureBrowserMode(useHeadlessBrowser);
            if (!browserReady) {
                throw new Error('无法启动 Legil 自动化浏览器');
            }

            // 第1步：获取 Legil 页面
            page = browserController.getPage('legil');
            if (!page || page.isClosed()) {
                logger.warn('Legil 页面未打开，正在打开...');
                const opened = await browserController.openWebsite('legil', LEGIL_IMAGE_TO_IMAGE_URL, {
                    headless: useHeadlessBrowser
                });
                if (!opened) {
                    throw new Error('无法打开 Legil 页面');
                }
                page = browserController.getPage('legil');
                await interruptibleSleep(5000, options);
            }

            if (!page || page.isClosed()) {
                throw new Error('Legil 页面不可用');
            }

            await this.ensureLegilImageToImagePage(page, options);
            await browserController.applyLegilWindowFit(page).catch(error => {
                logger.warn(`Legil 窗口自适应设置失败: ${error.message}`);
            });

            logger.info('[步骤1/6] 正在应用 Legil 生成参数...');
            const appliedGenerationSettings = await this.applyGenerationSettings(page, generationSettings, options);

            // 第2步：上传参考图。改尺寸批处理会传入 referenceImagePath，量产流程继续使用原参考图文件夹。
            // 创意拓展页面只使用表格中的提示词时，会显式传入 skipReferenceUpload 跳过上传。
            const hasDirectReferenceImage = typeof options.referenceImagePath === 'string' && options.referenceImagePath.trim();
            const shouldSkipReferenceUpload = options.skipReferenceUpload === true;
            if (!shouldSkipReferenceUpload && (hasDirectReferenceImage || this.referenceImages.length > 0 || fs.existsSync(this.referenceFolder))) {
                logger.info('[步骤2/6] 正在上传参考图...');
                const uploadSuccess = await this.uploadReferenceImage(page, options);
                if (uploadSuccess) {
                    logger.info('✅ 参考图上传成功');
                    // 等待图片上传完成并生效
                    await interruptibleSleep(3000, options);
                } else {
                    if (hasDirectReferenceImage) {
                        throw new Error('上传改尺寸输入图失败，请确认 Legil 图生图页面已登录且上传入口可用');
                    }
                    logger.warn('⚠️ 参考图上传失败，继续生成流程');
                }
            } else {
                logger.info(shouldSkipReferenceUpload
                    ? '[步骤2/6] 跳过参考图上传（创意拓展仅使用表格提示词）'
                    : '[步骤2/6] 跳过参考图上传（未配置参考图文件夹）');
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
                const timeoutError = new Error('等待图片生成超时');
                const screenshotPath = await this.captureErrorScreenshot(page, timeoutError, {
                    ...options,
                    promptIndex: safePromptIndex,
                    stage: 'wait_timeout'
                });
                await this.cleanupTimedOutGeneration(page, options).catch(cleanupError => {
                    logger.warn(`清理超时生成任务失败，将继续后续流程: ${cleanupError.message}`);
                });
                if (options.autoRefreshOnStuck !== false && options.autoRecoveryEnabled !== false && options._legilRefreshRetried !== true) {
                    const refreshed = await this.refreshLegilPageOnce(page, options);
                    if (refreshed) {
                        return this.generateImage(promptText, safePromptIndex, {
                            ...options,
                            _legilRefreshRetried: true
                        });
                    }
                }
                timeoutError.screenshotPath = screenshotPath;
                throw timeoutError;
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
            const screenshotPath = error.screenshotPath || await this.captureErrorScreenshot(page, error, {
                ...options,
                promptIndex: safePromptIndex,
                stage: options._legilRefreshRetried ? 'retry_failed' : 'failed'
            });
            logger.error(`❌ Legil 自动化失败: ${error.message}`);
            return {
                success: false,
                savePath: null,
                screenshotPath,
                message: error.message
            };
        }
    }
    };
};
