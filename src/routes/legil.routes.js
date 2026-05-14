/**
 * Legil 单次生成、批量生成、改尺寸和创意续跑接口。
 */
module.exports = function registerLegilRoutes(app, context) {
    const __dirname = context.rootDir;
    const {
        appConfig,
        automationState,
        clearCreativeResumeState,
        DEFAULT_CREATIVE_CONFIG,
        DEFAULT_RESIZE_CONFIG,
        formatDateTimeForFile,
        fs,
        getCreativeProgressSnapshot,
        getCreativeResumeInfo,
        isLegilBusy,
        isLegilStopRequested,
        legilAutomation,
        listImageFilesInFolder,
        logger,
        normalizeCreativeBatchPromptItems,
        normalizeCreativeBrowserMode,
        normalizeCreativeConfigPayload,
        normalizeLegilGenerationSettings,
        normalizeResizeConfigPayload,
        notifyLegilResult,
        notifyTaskEvent,
        path,
        persistRuntimeConfig,
        requestLegilTaskStop,
        resolveCreativeBatchRunContext,
        setCreativeResumeState,
        sleepWithLegilStop,
        toPositiveIndex,
        updateCreativeResumeState,
        workflowController
    } = context;



    /**
     * ============================================
     * 第七阶段：Legil 平台自动化 API 接口
     * ============================================
     *
     * 请求方法：POST
     * 请求路径：/api/legil/generate
     * 请求参数：{ prompt: "提示词", promptIndex: 序号 }
     * 返回数据：{ success: true/false, savePath: "保存路径", message: "提示信息" }
     */
    app.post('/api/legil/generate', async (req, res) => {
        const { prompt, promptIndex, index } = req.body;
        const safePromptIndex = toPositiveIndex(promptIndex ?? index, 1);

        console.log('\n🎨 收到 Legil 生成图片请求（第七阶段）');
        console.log('   提示词序号:', safePromptIndex);
        console.log('   提示词预览:', typeof prompt === 'string' ? prompt.substring(0, 50) + '...' : '未提供');

        // 验证参数
        if (typeof prompt !== 'string' || !prompt.trim()) {
            return res.json({
                success: false,
                savePath: null,
                message: '请提供提示词'
            });
        }

        if (isLegilBusy()) {
            return res.json({
                success: false,
                savePath: null,
                message: '当前已有自动化任务正在运行，请稍后再试'
            });
        }

        try {
            automationState.legilTaskRunning = true;
            automationState.legilStopRequested = false;
            automationState.legilTaskType = 'single-generate';
            // 调用 Legil 自动化模块
            const result = await legilAutomation.generateImage(prompt.trim(), safePromptIndex, {
                taskType: 'Legil单张生成',
                autoRecoveryEnabled: appConfig.notifications.autoRecoveryEnabled,
                captureErrorScreenshot: appConfig.notifications.legilScreenshotEnabled
            });
            res.json(result);

        } catch (error) {
            console.error('Legil 自动化出错:', error);
            res.json({
                success: false,
                savePath: null,
                message: '服务器错误：' + error.message
            });
        } finally {
            automationState.legilTaskRunning = false;
            automationState.legilStopRequested = false;
            automationState.legilTaskType = null;
        }
    });



    /**
     * ============================================
     * 第七阶段：批量生成五张图片
     * ============================================
     */
    app.post('/api/legil/batch-generate', async (req, res) => {
        const { prompts } = req.body;

        console.log('\n🎨 收到 Legil 批量生成请求');
        console.log('   提示词数量:', prompts ? prompts.length : 0);

        if (!prompts || !Array.isArray(prompts) || prompts.length === 0) {
            return res.json({
                success: false,
                results: [],
                message: '请提供提示词数组'
            });
        }

        if (isLegilBusy()) {
            return res.json({
                success: false,
                results: [],
                message: '当前已有自动化任务正在运行，请稍后再试'
            });
        }

        const normalizedPrompts = prompts
            .map(promptData => typeof promptData === 'string' ? promptData : promptData && promptData.content)
            .filter(promptText => typeof promptText === 'string' && promptText.trim())
            .map(promptText => promptText.trim());

        if (normalizedPrompts.length === 0) {
            return res.json({
                success: false,
                results: [],
                message: '提示词数组中没有有效内容'
            });
        }

        automationState.legilTaskRunning = true;
        automationState.legilStopRequested = false;
        automationState.legilTaskType = 'batch-generate';
        const batchRunId = formatDateTimeForFile();

        // 先返回接受请求的消息
        res.json({
            success: true,
            message: `已接受批量生成请求，将生成 ${normalizedPrompts.length} 张图片。请通过日志查看进度。`,
            total: normalizedPrompts.length
        });

        // 在后台执行批量生成（不阻塞响应）
        (async () => {
            logger.system('开始批量生成图片...');

            try {
                let outputSequence = 1;
                let consecutiveFailures = 0;
                const legilOutputQuantity = legilAutomation.getConfig().settings.outputQuantity || 1;
                const outputTotal = normalizedPrompts.length * legilOutputQuantity;
                for (let i = 0; i < normalizedPrompts.length; i++) {
                    const promptText = normalizedPrompts[i];

                    logger.info(`正在生成第 ${i + 1}/${normalizedPrompts.length} 张图片...`);

                    try {
                        const result = await legilAutomation.generateImage(promptText, i + 1, {
                            outputSequence,
                            outputTotal,
                            runId: batchRunId,
                            promptIndexWithinImage: i + 1,
                            totalPromptsForImage: normalizedPrompts.length,
                            taskType: 'Legil批量生成',
                            autoRecoveryEnabled: appConfig.notifications.autoRecoveryEnabled,
                            captureErrorScreenshot: appConfig.notifications.legilScreenshotEnabled
                        });

                        if (result.success) {
                            consecutiveFailures = 0;
                            const savedCount = Number(result.savedCount) || 1;
                            outputSequence += savedCount;
                            logger.info(`✅ 第 ${i + 1} 组生成成功，保存 ${savedCount} 张图片: ${path.basename(result.savePath)}`);
                        } else {
                            consecutiveFailures += 1;
                            logger.error(`❌ 第 ${i + 1} 张图片生成失败: ${result.message}`);
                            if (
                                appConfig.notifications.pauseOnConsecutiveFailures &&
                                consecutiveFailures >= appConfig.notifications.consecutiveFailureThreshold
                            ) {
                                logger.warn(`连续失败 ${consecutiveFailures} 次，已暂停批量生成任务，等待确认后再继续。`);
                                notifyTaskEvent({
                                    level: 'warning',
                                    title: 'Legil批量生成已暂停',
                                    taskType: 'Legil批量生成',
                                    message: `连续失败 ${consecutiveFailures} 次，系统已暂停任务。`,
                                    suggestion: '请检查 Legil 页面状态、账号登录和提示词内容后再重新启动。'
                                }, {
                                    key: `batch-generate-paused:${batchRunId}`,
                                    cooldownMs: 0
                                });
                                break;
                            }
                        }

                        // 每张图片之间等待 5 秒，避免过于频繁
                        if (i < normalizedPrompts.length - 1) {
                            logger.info('等待 5 秒后继续下一张...');
                            await new Promise(resolve => setTimeout(resolve, 5000));
                        }

                    } catch (error) {
                        logger.error(`❌ 第 ${i + 1} 张图片生成时出错: ${error.message}`);
                    }
                }

                logger.system('✅ 批量生成完成！');
            } finally {
                automationState.legilTaskRunning = false;
                automationState.legilStopRequested = false;
                automationState.legilTaskType = null;
            }
        })();
    });



    app.get('/api/legil/task-status', (req, res) => {
        res.json({
            success: true,
            running: automationState.legilTaskRunning,
            stopRequested: automationState.legilStopRequested,
            taskType: automationState.legilTaskType,
            progress: automationState.legilTaskProgress,
            workflowRunning: workflowController.isRunning
        });
    });



    app.post('/api/legil/stop', (req, res) => {
        res.json(requestLegilTaskStop());
    });



    /**
     * ============================================
     * Legil 批量改尺寸：只使用 Legil，不调用豆包 API
     * ============================================
     */
    app.post('/api/legil/resize-batch', async (req, res) => {
        const resizeConfig = normalizeResizeConfigPayload(req.body || {});
        const resizeGenerationSettings = normalizeLegilGenerationSettings(
            req.body && typeof req.body.generationSettings === 'object' ? req.body.generationSettings : resizeConfig.generationSettings,
            resizeConfig.generationSettings || DEFAULT_RESIZE_CONFIG.generationSettings
        );
        const promptText = String(resizeConfig.promptTemplate || '').trim();

        console.log('\n🖼️ 收到 Legil 批量改尺寸请求');
        console.log('   输入文件夹:', resizeConfig.inputFolder);
        console.log('   输出文件夹:', resizeConfig.outputFolder);
        console.log('   运行模式:', resizeConfig.browserMode);

        if (isLegilBusy()) {
            return res.json({
                success: false,
                message: '当前已有自动化任务正在运行，请稍后再试'
            });
        }

        if (!promptText) {
            return res.json({
                success: false,
                message: '请填写发送给 Legil 的固定文字提示词'
            });
        }

        try {
            if (!fs.existsSync(resizeConfig.inputFolder)) {
                return res.json({
                    success: false,
                    message: '输入文件夹不存在，请检查路径是否正确'
                });
            }

            if (!fs.statSync(resizeConfig.inputFolder).isDirectory()) {
                return res.json({
                    success: false,
                    message: '输入路径不是文件夹'
                });
            }

            const imageFiles = listImageFilesInFolder(resizeConfig.inputFolder);
            if (imageFiles.length === 0) {
                return res.json({
                    success: false,
                    message: '输入文件夹中没有找到图片'
                });
            }

            fs.mkdirSync(resizeConfig.outputFolder, { recursive: true });
            if (!fs.statSync(resizeConfig.outputFolder).isDirectory()) {
                return res.json({
                    success: false,
                    message: '输出路径不是文件夹'
                });
            }

            appConfig.resize = {
                ...resizeConfig,
                generationSettings: resizeGenerationSettings
            };
            persistRuntimeConfig({
                resize: appConfig.resize
            });

            automationState.legilTaskRunning = true;
            automationState.legilStopRequested = false;
            automationState.legilTaskType = 'resize-batch';
            const batchRunId = formatDateTimeForFile();
            const outputTotal = imageFiles.length * (Number(resizeGenerationSettings.outputQuantity) || 1);
            const resizeHeadless = resizeConfig.browserMode === 'headless';
            automationState.legilTaskProgress = {
                taskType: 'resize-batch',
                phase: 'queued',
                total: imageFiles.length,
                currentIndex: 0,
                completed: 0,
                success: 0,
                failed: 0,
                saved: 0,
                outputTotal,
                browserMode: resizeConfig.browserMode,
                currentName: '',
                currentAction: '批量改尺寸任务已排队，准备开始...',
                startedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            res.json({
                success: true,
                message: `已启动 Legil 批量改尺寸任务，共 ${imageFiles.length} 张输入图。请通过实时日志查看进度。`,
                totalImages: imageFiles.length,
                outputTotal,
                progress: automationState.legilTaskProgress
            });

            (async () => {
                const previousSaveFolder = legilAutomation.saveFolder;
                const previousReferenceFolder = legilAutomation.referenceFolder;
                const previousReferenceImages = Array.isArray(legilAutomation.referenceImages)
                    ? [...legilAutomation.referenceImages]
                    : [];
                const previousRefIndex = legilAutomation.currentRefIndex;
                const previousGenerationSettings = {
                    ...legilAutomation.getConfig().settings
                };

                logger.system('========================================');
                logger.system('开始 Legil 批量改尺寸任务');
                logger.info(`输入文件夹: ${resizeConfig.inputFolder}`);
                logger.info(`输出文件夹: ${resizeConfig.outputFolder}`);
                logger.info(`运行模式: ${resizeHeadless ? '无头模式' : '有头模式'}`);
                logger.info(`输入图片数量: ${imageFiles.length}`);
                logger.info(`改尺寸 Legil 参数: 模型 ${legilAutomation.getImageModelLabel(resizeGenerationSettings.imageModel)}，宽高比 ${resizeGenerationSettings.aspectRatio}，分辨率 ${resizeGenerationSettings.resolution}，输出数量 ${resizeGenerationSettings.outputQuantity}`);
                logger.system('========================================');

                let outputSequence = 1;
                let successCount = 0;
                let failedCount = 0;
                let consecutiveFailures = 0;
                let stopped = false;
                let interruptedMessage = '';
                const updateResizeProgress = (patch = {}) => {
                    automationState.legilTaskProgress = {
                        ...(automationState.legilTaskProgress || {}),
                        taskType: 'resize-batch',
                        total: imageFiles.length,
                        outputTotal,
                        browserMode: resizeConfig.browserMode,
                        ...patch,
                        updatedAt: new Date().toISOString()
                    };
                };

                try {
                    for (let i = 0; i < imageFiles.length; i++) {
                        if (isLegilStopRequested()) {
                            stopped = true;
                            logger.warn('⏹️ 改尺寸任务已停止，退出剩余图片处理');
                            break;
                        }

                        const imagePath = imageFiles[i];
                        const imageName = path.basename(imagePath);
                        updateResizeProgress({
                            phase: 'running',
                            currentIndex: i + 1,
                            completed: successCount + failedCount,
                            success: successCount,
                            failed: failedCount,
                            saved: outputSequence - 1,
                            currentName: imageName,
                            currentAction: `正在处理改尺寸图片 ${i + 1}/${imageFiles.length}: ${imageName}`
                        });

                        logger.info('');
                        logger.info(`🖼️ 正在处理改尺寸图片 ${i + 1}/${imageFiles.length}: ${imageName}`);

                        try {
                            const result = await legilAutomation.generateImage(promptText, i + 1, {
                                referenceImagePath: imagePath,
                                saveFolder: resizeConfig.outputFolder,
                                headless: resizeHeadless,
                                generationSettings: resizeGenerationSettings,
                                outputSequence,
                                outputTotal,
                                runId: batchRunId,
                                referenceImageIndex: i + 1,
                                totalReferenceImages: imageFiles.length,
                                referenceImageName: imageName,
                                promptIndexWithinImage: 1,
                                totalPromptsForImage: 1,
                                taskType: '批量改尺寸',
                                acceptStablePartialOutputs: true,
                                autoRecoveryEnabled: appConfig.notifications.autoRecoveryEnabled,
                                captureErrorScreenshot: appConfig.notifications.legilScreenshotEnabled,
                                shouldAbort: isLegilStopRequested
                            });

                            if (result.success) {
                                consecutiveFailures = 0;
                                const savedCount = Number(result.savedCount) || 1;
                                outputSequence += savedCount;
                                successCount += 1;
                                updateResizeProgress({
                                    phase: 'running',
                                    currentIndex: i + 1,
                                    completed: successCount + failedCount,
                                    success: successCount,
                                    failed: failedCount,
                                    saved: outputSequence - 1,
                                    currentName: imageName,
                                    currentAction: `改尺寸图片 ${i + 1}/${imageFiles.length} 完成，保存 ${savedCount} 张`
                                });
                                logger.info(`✅ 改尺寸图片 ${i + 1}/${imageFiles.length} 完成，保存 ${savedCount} 张`);
                            } else if (isLegilStopRequested() || String(result.message || '').includes('操作已取消')) {
                                stopped = true;
                                logger.warn('⏹️ 改尺寸任务已停止');
                                break;
                            } else {
                                failedCount += 1;
                                consecutiveFailures += 1;
                                updateResizeProgress({
                                    phase: 'running',
                                    currentIndex: i + 1,
                                    completed: successCount + failedCount,
                                    success: successCount,
                                    failed: failedCount,
                                    saved: outputSequence - 1,
                                    currentName: imageName,
                                    currentAction: `改尺寸图片 ${i + 1}/${imageFiles.length} 失败: ${result.message}`
                                });
                                logger.error(`❌ 改尺寸图片 ${i + 1}/${imageFiles.length} 失败: ${result.message}`);
                                if (
                                    appConfig.notifications.pauseOnConsecutiveFailures &&
                                    consecutiveFailures >= appConfig.notifications.consecutiveFailureThreshold
                                ) {
                                    stopped = true;
                                    logger.warn(`连续失败 ${consecutiveFailures} 次，已暂停改尺寸任务，等待确认。`);
                                    notifyTaskEvent({
                                        level: 'warning',
                                        title: '批量改尺寸已暂停',
                                        taskType: '批量改尺寸',
                                        message: `连续失败 ${consecutiveFailures} 次，系统已暂停任务。`,
                                        suggestion: '请检查 Legil 页面、账号登录和输入图片后重新启动。'
                                    }, {
                                        key: `resize-paused:${batchRunId}`,
                                        cooldownMs: 0
                                    });
                                    break;
                                }
                            }
                        } catch (error) {
                            if (isLegilStopRequested() || error.message === '操作已取消') {
                                stopped = true;
                                logger.warn('⏹️ 改尺寸任务已停止');
                                break;
                            }
                            failedCount += 1;
                            consecutiveFailures += 1;
                            updateResizeProgress({
                                phase: 'running',
                                currentIndex: i + 1,
                                completed: successCount + failedCount,
                                success: successCount,
                                failed: failedCount,
                                saved: outputSequence - 1,
                                currentName: imageName,
                                currentAction: `改尺寸图片 ${i + 1}/${imageFiles.length} 出错: ${error.message}`
                            });
                            logger.error(`❌ 改尺寸图片 ${i + 1}/${imageFiles.length} 出错: ${error.message}`);
                            if (
                                appConfig.notifications.pauseOnConsecutiveFailures &&
                                consecutiveFailures >= appConfig.notifications.consecutiveFailureThreshold
                            ) {
                                stopped = true;
                                logger.warn(`连续失败 ${consecutiveFailures} 次，已暂停改尺寸任务，等待确认。`);
                                notifyTaskEvent({
                                    level: 'warning',
                                    title: '批量改尺寸已暂停',
                                    taskType: '批量改尺寸',
                                    message: `连续失败 ${consecutiveFailures} 次，系统已暂停任务。`,
                                    suggestion: '请检查 Legil 页面、账号登录和输入图片后重新启动。'
                                }, {
                                    key: `resize-paused:${batchRunId}`,
                                    cooldownMs: 0
                                });
                                break;
                            }
                        }

                        if (i < imageFiles.length - 1) {
                            logger.info('等待 5 秒后继续下一张...');
                            try {
                                await sleepWithLegilStop(5000);
                            } catch (error) {
                                stopped = true;
                                logger.warn('⏹️ 改尺寸任务已停止');
                                break;
                            }
                        }
                    }

                    logger.system('========================================');
                    if (stopped) {
                        updateResizeProgress({
                            phase: 'stopped',
                            currentIndex: successCount + failedCount,
                            completed: successCount + failedCount,
                            success: successCount,
                            failed: failedCount,
                            saved: outputSequence - 1,
                            currentAction: '批量改尺寸任务已停止'
                        });
                        logger.system(`⏹️ Legil 批量改尺寸任务已停止：成功 ${successCount} 张，失败 ${failedCount} 张`);
                    } else {
                        updateResizeProgress({
                            phase: 'completed',
                            currentIndex: imageFiles.length,
                            completed: successCount + failedCount,
                            success: successCount,
                            failed: failedCount,
                            saved: outputSequence - 1,
                            currentAction: `批量改尺寸任务完成：成功 ${successCount} 张，失败 ${failedCount} 张`
                        });
                        logger.system(`✅ Legil 批量改尺寸任务完成：成功 ${successCount} 张，失败 ${failedCount} 张`);
                    }
                    logger.system('========================================');
                } catch (error) {
                    const safeMessage = error && error.message ? error.message : String(error || '未知错误');
                    interruptedMessage = safeMessage;
                    updateResizeProgress({
                        phase: 'interrupted',
                        currentIndex: successCount + failedCount,
                        completed: successCount + failedCount,
                        success: successCount,
                        failed: failedCount,
                        saved: outputSequence - 1,
                        currentAction: `批量改尺寸任务被中断: ${safeMessage}`
                    });
                    logger.error(`❌ Legil 批量改尺寸任务被中断: ${safeMessage}`);
                } finally {
                    notifyLegilResult('resize-batch', {
                        successCount,
                        failedCount,
                        interrupted: Boolean(interruptedMessage),
                        message: interruptedMessage || (stopped ? '任务已停止' : `任务完成：成功 ${successCount} 张，失败 ${failedCount} 张`)
                    });
                    legilAutomation.saveFolder = previousSaveFolder;
                    legilAutomation.referenceFolder = previousReferenceFolder;
                    legilAutomation.referenceImages = previousReferenceImages;
                    legilAutomation.currentRefIndex = previousRefIndex;
                    legilAutomation.generationSettings = previousGenerationSettings;
                    automationState.legilTaskRunning = false;
                    automationState.legilStopRequested = false;
                    automationState.legilTaskType = null;
                }
            })();
        } catch (error) {
            automationState.legilTaskRunning = false;
            automationState.legilStopRequested = false;
            automationState.legilTaskType = null;
            console.error('Legil 批量改尺寸启动失败:', error);
            res.json({
                success: false,
                message: '启动失败：' + error.message
            });
        }
    });



    app.get('/api/legil/creative-resume', (req, res) => {
        res.json({
            success: true,
            resume: getCreativeResumeInfo(true)
        });
    });



    app.get('/api/legil/creative-progress', (req, res) => {
        res.json({
            success: true,
            ...getCreativeProgressSnapshot()
        });
    });



    app.post('/api/legil/creative-resume/clear', (req, res) => {
        if (automationState.legilTaskRunning && automationState.legilTaskType === 'creative-batch') {
            return res.json({
                success: false,
                message: '创意拓展任务正在运行，不能清除恢复状态'
            });
        }

        clearCreativeResumeState();
        res.json({
            success: true,
            resume: { hasResume: false },
            message: '已清除创意拓展恢复状态'
        });
    });



    /**
     * ============================================
     * Legil 创意拓展：从本地表格提示词批量生成
     * ============================================
     */
    app.post('/api/legil/creative-batch', async (req, res) => {
        const creativeConfig = normalizeCreativeConfigPayload(req.body || {});
        const creativeBrowserMode = normalizeCreativeBrowserMode(creativeConfig.browserMode);
        const creativeHeadless = creativeBrowserMode === 'headless';
        const creativeGenerationSettings = normalizeLegilGenerationSettings(
            req.body && typeof req.body.generationSettings === 'object' ? req.body.generationSettings : creativeConfig.generationSettings,
            creativeConfig.generationSettings || DEFAULT_CREATIVE_CONFIG.generationSettings
        );
        const promptItems = Array.isArray(req.body && req.body.prompts) ? req.body.prompts : [];
        const normalizedPrompts = normalizeCreativeBatchPromptItems(promptItems);
        const creativeTableFileName = String(req.body && req.body.tableFileName ? req.body.tableFileName : '').trim();

        console.log('\n🎨 收到 Legil 创意拓展批量生成请求');
        console.log('   输出文件夹:', creativeConfig.outputFolder);
        console.log('   运行模式:', creativeHeadless ? '无头模式' : '有头模式');
        console.log('   提示词数量:', normalizedPrompts.length);

        if (isLegilBusy()) {
            return res.json({
                success: false,
                message: '当前已有自动化任务正在运行，请稍后再试'
            });
        }

        if (normalizedPrompts.length === 0) {
            return res.json({
                success: false,
                message: '请先上传表格并提取有效画面提示词'
            });
        }

        try {
            fs.mkdirSync(creativeConfig.outputFolder, { recursive: true });
            if (!fs.statSync(creativeConfig.outputFolder).isDirectory()) {
                return res.json({
                    success: false,
                    message: '输出路径不是文件夹'
                });
            }

            if (creativeConfig.referenceFolder) {
                if (!fs.existsSync(creativeConfig.referenceFolder) || !fs.statSync(creativeConfig.referenceFolder).isDirectory()) {
                    return res.json({
                        success: false,
                        message: 'Legil参考图文件夹不存在或不是文件夹'
                    });
                }
            }

            appConfig.creative = {
                ...creativeConfig,
                browserMode: creativeBrowserMode,
                generationSettings: creativeGenerationSettings
            };
            persistRuntimeConfig({
                creative: appConfig.creative
            });

            automationState.legilTaskRunning = true;
            automationState.legilStopRequested = false;
            automationState.legilTaskType = 'creative-batch';
            const batchRunId = formatDateTimeForFile();
            const runContext = resolveCreativeBatchRunContext(normalizedPrompts, req.body || {}, creativeGenerationSettings);
            const progressTotal = runContext.total;
            const outputTotal = runContext.outputTotal;
            const initialAction = runContext.isResume
                ? `创意拓展继续任务已排队，准备从 ${runContext.baseCompleted}/${progressTotal} 继续...`
                : '创意拓展任务已排队，准备开始...';
            automationState.legilTaskProgress = {
                taskType: 'creative-batch',
                phase: 'queued',
                total: progressTotal,
                baseCompleted: runContext.baseCompleted,
                baseSuccess: runContext.baseSuccess,
                baseFailed: runContext.baseFailed,
                baseSaved: runContext.baseSaved,
                currentIndex: runContext.baseCompleted,
                completed: runContext.baseCompleted,
                success: runContext.baseSuccess,
                failed: runContext.baseFailed,
                saved: runContext.baseSaved,
                outputTotal,
                browserMode: creativeBrowserMode,
                currentName: '',
                currentAction: initialAction,
                startedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            setCreativeResumeState({
                runId: batchRunId,
                phase: 'queued',
                tableFileName: creativeTableFileName || '创意拓展表格',
                outputFolder: creativeConfig.outputFolder,
                referenceFolder: creativeConfig.referenceFolder,
                browserMode: creativeBrowserMode,
                generationSettings: creativeGenerationSettings,
                prompts: normalizedPrompts,
                total: progressTotal,
                baseCompleted: runContext.baseCompleted,
                baseSuccess: runContext.baseSuccess,
                baseFailed: runContext.baseFailed,
                baseSaved: runContext.baseSaved,
                nextIndex: 0,
                currentIndex: runContext.baseCompleted,
                completed: runContext.baseCompleted,
                success: runContext.baseSuccess,
                failed: runContext.baseFailed,
                saved: runContext.baseSaved,
                outputTotal,
                currentName: '',
                currentAction: initialAction,
                startedAt: automationState.legilTaskProgress.startedAt,
                updatedAt: automationState.legilTaskProgress.updatedAt
            });

            res.json({
                success: true,
                message: `已启动 Legil 创意拓展任务，共 ${normalizedPrompts.length} 组提示词。请通过实时日志查看进度。`,
                totalPrompts: normalizedPrompts.length,
                outputTotal,
                browserMode: creativeBrowserMode,
                progress: automationState.legilTaskProgress
            });

            (async () => {
                const previousSaveFolder = legilAutomation.saveFolder;
                const previousReferenceFolder = legilAutomation.referenceFolder;
                const previousReferenceImages = Array.isArray(legilAutomation.referenceImages)
                    ? [...legilAutomation.referenceImages]
                    : [];
                const previousRefIndex = legilAutomation.currentRefIndex;
                const previousGenerationSettings = {
                    ...legilAutomation.getConfig().settings
                };

                logger.system('========================================');
                logger.system('开始 Legil 创意拓展批量生成任务');
                logger.info(`输出文件夹: ${creativeConfig.outputFolder}`);
                logger.info(`运行模式: ${creativeHeadless ? '无头模式' : '有头模式'}`);
                logger.info(`提示词数量: ${normalizedPrompts.length}`);
                logger.info(creativeConfig.referenceFolder
                    ? `Legil参考图文件夹: ${creativeConfig.referenceFolder}`
                    : 'Legil参考图文件夹: 未配置，生成时不上传参考图');
                logger.info(`创意拓展 Legil 参数: 模型 ${legilAutomation.getImageModelLabel(creativeGenerationSettings.imageModel)}，宽高比 ${creativeGenerationSettings.aspectRatio}，分辨率 ${creativeGenerationSettings.resolution}，输出数量 ${creativeGenerationSettings.outputQuantity}`);
                logger.system('========================================');

                let outputSequence = runContext.baseSaved + 1;
                let successCount = 0;
                let failedCount = 0;
                let savedTotal = 0;
                let consecutiveFailures = 0;
                let stopped = false;
                let interruptedMessage = '';
                const getLocalCompleted = () => successCount + failedCount;
                const getAggregateCompleted = () => runContext.baseCompleted + getLocalCompleted();
                const getAggregateSuccess = () => runContext.baseSuccess + successCount;
                const getAggregateFailed = () => runContext.baseFailed + failedCount;
                const getAggregateSaved = () => runContext.baseSaved + savedTotal;

                try {
                    for (let i = 0; i < normalizedPrompts.length; i++) {
                        if (isLegilStopRequested()) {
                            stopped = true;
                            logger.warn('⏹️ 创意拓展任务已停止，退出剩余提示词处理');
                            break;
                        }

                        const promptItem = normalizedPrompts[i];
                        const directionName = [promptItem.direction, promptItem.promptTitle]
                            .filter(Boolean)
                            .join('_') || `表格第${promptItem.sourceRow}行`;
                        const displayIndex = runContext.baseCompleted + i + 1;
                        automationState.legilTaskProgress = {
                            ...(automationState.legilTaskProgress || {}),
                            taskType: 'creative-batch',
                            phase: 'running',
                            total: progressTotal,
                            currentIndex: displayIndex,
                            completed: getAggregateCompleted(),
                            success: getAggregateSuccess(),
                            failed: getAggregateFailed(),
                            saved: getAggregateSaved(),
                            outputTotal,
                            currentName: directionName,
                            currentAction: `正在生成第 ${displayIndex}/${progressTotal} 组：${directionName}`,
                            updatedAt: new Date().toISOString()
                        };
                        updateCreativeResumeState({
                            phase: 'running',
                            currentIndex: displayIndex,
                            nextIndex: i,
                            completed: getAggregateCompleted(),
                            success: getAggregateSuccess(),
                            failed: getAggregateFailed(),
                            saved: getAggregateSaved(),
                            currentName: directionName,
                            currentAction: automationState.legilTaskProgress.currentAction
                        });

                        logger.info('');
                        logger.info(`🎨 正在处理创意提示词 ${displayIndex}/${progressTotal}: ${directionName}`);

                        try {
                            const result = await legilAutomation.generateImage(promptItem.prompt, i + 1, {
                                saveFolder: creativeConfig.outputFolder,
                                referenceFolder: creativeConfig.referenceFolder || undefined,
                                skipReferenceUpload: !creativeConfig.referenceFolder,
                                generationSettings: creativeGenerationSettings,
                                outputSequence,
                                outputTotal,
                                runId: batchRunId,
                                referenceImageIndex: i + 1,
                                totalReferenceImages: normalizedPrompts.length,
                                referenceImageName: directionName,
                                promptIndexWithinImage: 1,
                                totalPromptsForImage: 1,
                                headless: creativeHeadless,
                                taskType: '创意拓展产图',
                                acceptStablePartialOutputs: true,
                                autoRecoveryEnabled: appConfig.notifications.autoRecoveryEnabled,
                                captureErrorScreenshot: appConfig.notifications.legilScreenshotEnabled,
                                shouldAbort: isLegilStopRequested
                            });

                            if (result.success) {
                                consecutiveFailures = 0;
                                const savedCount = Number(result.savedCount) || 1;
                                outputSequence += savedCount;
                                successCount += 1;
                                savedTotal += savedCount;
                                automationState.legilTaskProgress = {
                                    ...(automationState.legilTaskProgress || {}),
                                    phase: 'running',
                                    currentIndex: displayIndex,
                                    completed: getAggregateCompleted(),
                                    success: getAggregateSuccess(),
                                    failed: getAggregateFailed(),
                                    saved: getAggregateSaved(),
                                    currentAction: `第 ${displayIndex}/${progressTotal} 组已完成，保存 ${savedCount} 张`,
                                    updatedAt: new Date().toISOString()
                                };
                                updateCreativeResumeState({
                                    phase: 'running',
                                    currentIndex: displayIndex,
                                    nextIndex: i + 1,
                                    completed: getAggregateCompleted(),
                                    success: getAggregateSuccess(),
                                    failed: getAggregateFailed(),
                                    saved: getAggregateSaved(),
                                    currentName: directionName,
                                    currentAction: automationState.legilTaskProgress.currentAction
                                });
                                logger.info(`✅ 创意提示词 ${displayIndex}/${progressTotal} 完成，保存 ${savedCount} 张`);
                            } else if (isLegilStopRequested() || String(result.message || '').includes('操作已取消')) {
                                stopped = true;
                                automationState.legilTaskProgress = {
                                    ...(automationState.legilTaskProgress || {}),
                                    phase: 'stopping',
                                    currentAction: '创意拓展任务正在停止...',
                                    updatedAt: new Date().toISOString()
                                };
                                updateCreativeResumeState({
                                    phase: 'stopping',
                                    currentIndex: getAggregateCompleted(),
                                    nextIndex: getLocalCompleted(),
                                    completed: getAggregateCompleted(),
                                    success: getAggregateSuccess(),
                                    failed: getAggregateFailed(),
                                    saved: getAggregateSaved(),
                                    currentName: directionName,
                                    currentAction: '创意拓展任务正在停止...'
                                });
                                logger.warn('⏹️ 创意拓展任务已停止');
                                break;
                            } else {
                                failedCount += 1;
                                consecutiveFailures += 1;
                                automationState.legilTaskProgress = {
                                    ...(automationState.legilTaskProgress || {}),
                                    phase: 'running',
                                    currentIndex: displayIndex,
                                    completed: getAggregateCompleted(),
                                    success: getAggregateSuccess(),
                                    failed: getAggregateFailed(),
                                    saved: getAggregateSaved(),
                                    currentAction: `第 ${displayIndex}/${progressTotal} 组失败：${result.message}`,
                                    updatedAt: new Date().toISOString()
                                };
                                updateCreativeResumeState({
                                    phase: 'running',
                                    currentIndex: displayIndex,
                                    nextIndex: i + 1,
                                    completed: getAggregateCompleted(),
                                    success: getAggregateSuccess(),
                                    failed: getAggregateFailed(),
                                    saved: getAggregateSaved(),
                                    currentName: directionName,
                                    currentAction: automationState.legilTaskProgress.currentAction
                                });
                                logger.error(`❌ 创意提示词 ${displayIndex}/${progressTotal} 失败: ${result.message}`);
                                if (
                                    appConfig.notifications.pauseOnConsecutiveFailures &&
                                    consecutiveFailures >= appConfig.notifications.consecutiveFailureThreshold
                                ) {
                                    stopped = true;
                                    automationState.legilTaskProgress = {
                                        ...(automationState.legilTaskProgress || {}),
                                        phase: 'stopped',
                                        currentAction: `连续失败 ${consecutiveFailures} 次，创意拓展已暂停，等待确认`,
                                        updatedAt: new Date().toISOString()
                                    };
                                    updateCreativeResumeState({
                                        phase: 'stopped',
                                        currentIndex: getAggregateCompleted(),
                                        nextIndex: getLocalCompleted(),
                                        completed: getAggregateCompleted(),
                                        success: getAggregateSuccess(),
                                        failed: getAggregateFailed(),
                                        saved: getAggregateSaved(),
                                        currentName: directionName,
                                        currentAction: automationState.legilTaskProgress.currentAction
                                    });
                                    notifyTaskEvent({
                                        level: 'warning',
                                        title: '创意拓展已暂停',
                                        taskType: '创意拓展产图',
                                        message: `连续失败 ${consecutiveFailures} 次，系统已暂停任务。`,
                                        suggestion: '请检查 Legil 页面、账号登录和提示词内容后点击继续任务。'
                                    }, {
                                        key: `creative-paused:${batchRunId}`,
                                        cooldownMs: 0
                                    });
                                    break;
                                }
                            }
                        } catch (error) {
                            if (isLegilStopRequested() || error.message === '操作已取消') {
                                stopped = true;
                                automationState.legilTaskProgress = {
                                    ...(automationState.legilTaskProgress || {}),
                                    phase: 'stopping',
                                    currentAction: '创意拓展任务正在停止...',
                                    updatedAt: new Date().toISOString()
                                };
                                updateCreativeResumeState({
                                    phase: 'stopping',
                                    currentIndex: getAggregateCompleted(),
                                    nextIndex: getLocalCompleted(),
                                    completed: getAggregateCompleted(),
                                    success: getAggregateSuccess(),
                                    failed: getAggregateFailed(),
                                    saved: getAggregateSaved(),
                                    currentName: directionName,
                                    currentAction: '创意拓展任务正在停止...'
                                });
                                logger.warn('⏹️ 创意拓展任务已停止');
                                break;
                            }
                            failedCount += 1;
                            consecutiveFailures += 1;
                            automationState.legilTaskProgress = {
                                ...(automationState.legilTaskProgress || {}),
                                phase: 'running',
                                currentIndex: displayIndex,
                                completed: getAggregateCompleted(),
                                success: getAggregateSuccess(),
                                failed: getAggregateFailed(),
                                saved: getAggregateSaved(),
                                currentAction: `第 ${displayIndex}/${progressTotal} 组出错：${error.message}`,
                                updatedAt: new Date().toISOString()
                            };
                            updateCreativeResumeState({
                                phase: 'running',
                                currentIndex: displayIndex,
                                nextIndex: i + 1,
                                completed: getAggregateCompleted(),
                                success: getAggregateSuccess(),
                                failed: getAggregateFailed(),
                                saved: getAggregateSaved(),
                                currentName: directionName,
                                currentAction: automationState.legilTaskProgress.currentAction
                            });
                            logger.error(`❌ 创意提示词 ${displayIndex}/${progressTotal} 出错: ${error.message}`);
                            if (
                                appConfig.notifications.pauseOnConsecutiveFailures &&
                                consecutiveFailures >= appConfig.notifications.consecutiveFailureThreshold
                            ) {
                                stopped = true;
                                automationState.legilTaskProgress = {
                                    ...(automationState.legilTaskProgress || {}),
                                    phase: 'stopped',
                                    currentAction: `连续失败 ${consecutiveFailures} 次，创意拓展已暂停，等待确认`,
                                    updatedAt: new Date().toISOString()
                                };
                                updateCreativeResumeState({
                                    phase: 'stopped',
                                    currentIndex: getAggregateCompleted(),
                                    nextIndex: getLocalCompleted(),
                                    completed: getAggregateCompleted(),
                                    success: getAggregateSuccess(),
                                    failed: getAggregateFailed(),
                                    saved: getAggregateSaved(),
                                    currentName: directionName,
                                    currentAction: automationState.legilTaskProgress.currentAction
                                });
                                notifyTaskEvent({
                                    level: 'warning',
                                    title: '创意拓展已暂停',
                                    taskType: '创意拓展产图',
                                    message: `连续失败 ${consecutiveFailures} 次，系统已暂停任务。`,
                                    suggestion: '请检查 Legil 页面、账号登录和提示词内容后点击继续任务。'
                                }, {
                                    key: `creative-paused:${batchRunId}`,
                                    cooldownMs: 0
                                });
                                break;
                            }
                        }

                        if (i < normalizedPrompts.length - 1) {
                            logger.info('等待 5 秒后继续下一组提示词...');
                            try {
                                await sleepWithLegilStop(5000);
                            } catch (error) {
                                stopped = true;
                                updateCreativeResumeState({
                                    phase: 'stopping',
                                    currentIndex: getAggregateCompleted(),
                                    nextIndex: getLocalCompleted(),
                                    completed: getAggregateCompleted(),
                                    success: getAggregateSuccess(),
                                    failed: getAggregateFailed(),
                                    saved: getAggregateSaved(),
                                    currentAction: '创意拓展任务正在停止...'
                                });
                                logger.warn('⏹️ 创意拓展任务已停止');
                                break;
                            }
                        }
                    }

                    logger.system('========================================');
                    if (stopped) {
                        automationState.legilTaskProgress = {
                            ...(automationState.legilTaskProgress || {}),
                            phase: 'stopped',
                            currentIndex: getAggregateCompleted(),
                            completed: getAggregateCompleted(),
                            success: getAggregateSuccess(),
                            failed: getAggregateFailed(),
                            saved: getAggregateSaved(),
                            currentAction: `创意拓展任务已停止：成功 ${getAggregateSuccess()} 组，失败 ${getAggregateFailed()} 组`,
                            updatedAt: new Date().toISOString()
                        };
                        updateCreativeResumeState({
                            phase: 'stopped',
                            nextIndex: getLocalCompleted(),
                            currentIndex: getAggregateCompleted(),
                            completed: getAggregateCompleted(),
                            success: getAggregateSuccess(),
                            failed: getAggregateFailed(),
                            saved: getAggregateSaved(),
                            currentAction: automationState.legilTaskProgress.currentAction
                        });
                        logger.system(`⏹️ Legil 创意拓展任务已停止：成功 ${getAggregateSuccess()} 组，失败 ${getAggregateFailed()} 组`);
                    } else {
                        const completedAllPrompts = getAggregateCompleted() >= progressTotal;
                        automationState.legilTaskProgress = {
                            ...(automationState.legilTaskProgress || {}),
                            phase: 'completed',
                            currentIndex: getAggregateCompleted(),
                            completed: getAggregateCompleted(),
                            success: getAggregateSuccess(),
                            failed: getAggregateFailed(),
                            saved: getAggregateSaved(),
                            currentAction: `创意拓展任务完成：成功 ${getAggregateSuccess()} 组，失败 ${getAggregateFailed()} 组`,
                            updatedAt: new Date().toISOString()
                        };
                        if (completedAllPrompts) {
                            clearCreativeResumeState();
                        } else {
                            updateCreativeResumeState({
                                phase: 'stopped',
                                nextIndex: getLocalCompleted(),
                                currentIndex: getAggregateCompleted(),
                                completed: getAggregateCompleted(),
                                success: getAggregateSuccess(),
                                failed: getAggregateFailed(),
                                saved: getAggregateSaved(),
                                currentAction: automationState.legilTaskProgress.currentAction
                            });
                        }
                        logger.system(`✅ Legil 创意拓展任务完成：成功 ${getAggregateSuccess()} 组，失败 ${getAggregateFailed()} 组`);
                    }
                    logger.system('========================================');
                } catch (error) {
                    const safeMessage = error && error.message ? error.message : String(error || '未知错误');
                    interruptedMessage = safeMessage;
                    automationState.legilTaskProgress = {
                        ...(automationState.legilTaskProgress || {}),
                        taskType: 'creative-batch',
                        phase: 'interrupted',
                        total: progressTotal,
                        currentIndex: getAggregateCompleted(),
                        completed: getAggregateCompleted(),
                        success: getAggregateSuccess(),
                        failed: getAggregateFailed(),
                        saved: getAggregateSaved(),
                        outputTotal,
                        browserMode: creativeBrowserMode,
                        currentAction: `创意拓展任务被中断：${safeMessage}`,
                        updatedAt: new Date().toISOString()
                    };
                    updateCreativeResumeState({
                        phase: 'interrupted',
                        nextIndex: getLocalCompleted(),
                        currentIndex: getAggregateCompleted(),
                        completed: getAggregateCompleted(),
                        success: getAggregateSuccess(),
                        failed: getAggregateFailed(),
                        saved: getAggregateSaved(),
                        currentAction: automationState.legilTaskProgress.currentAction
                    });
                    logger.error(`❌ Legil 创意拓展任务被中断: ${safeMessage}`);
                } finally {
                    notifyLegilResult('creative-batch', {
                        successCount: getAggregateSuccess(),
                        failedCount: getAggregateFailed(),
                        interrupted: Boolean(interruptedMessage),
                        message: interruptedMessage || (stopped
                            ? `任务已停止：成功 ${getAggregateSuccess()} 组，失败 ${getAggregateFailed()} 组`
                            : `任务完成：成功 ${getAggregateSuccess()} 组，失败 ${getAggregateFailed()} 组`)
                    });
                    legilAutomation.saveFolder = previousSaveFolder;
                    legilAutomation.referenceFolder = previousReferenceFolder;
                    legilAutomation.referenceImages = previousReferenceImages;
                    legilAutomation.currentRefIndex = previousRefIndex;
                    legilAutomation.generationSettings = previousGenerationSettings;
                    automationState.legilTaskRunning = false;
                    automationState.legilStopRequested = false;
                    automationState.legilTaskType = null;
                }
            })();
        } catch (error) {
            automationState.legilTaskRunning = false;
            automationState.legilStopRequested = false;
            automationState.legilTaskType = null;
            clearCreativeResumeState();
            console.error('Legil 创意拓展启动失败:', error);
            res.json({
                success: false,
                message: '启动失败：' + error.message
            });
        }
    });
};
