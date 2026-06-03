/**
 * Legil 单次生成、批量生成、改尺寸和创意续跑接口。
 */
module.exports = function registerLegilRoutes(app, context) {
    const __dirname = context.rootDir;
    const {
        buildCreativeOutputNamingContext
    } = require('../services/output-naming/creative-output-naming');
    const { CreativeKnowledgeStore } = require('../services/creative-knowledge/store');
    const { registerRunAssets } = require('../services/creative-auto/assets');
    const {
        appConfig,
        automationState,
        buildResizeJobs,
        clearCreativeResumeState,
        clearResizeResumeState,
        DEFAULT_CREATIVE_CONFIG,
        DEFAULT_RESIZE_CONFIG,
        formatDateTimeForFile,
        fs,
        getCreativeProgressSnapshot,
        getCreativeResumeInfo,
        getResizeAspectRatiosFromSettings,
        getResizeResumeInfo,
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
        setResizeResumeState,
        sleepWithLegilStop,
        toPositiveIndex,
        updateCreativeResumeState,
        updateResizeResumeState,
        workflowController
    } = context;

    function readCreativeDirectionLibrary(body = {}) {
        if (Array.isArray(body.directionLibrary) || typeof body.directionLibrary === 'string') {
            return body.directionLibrary;
        }
        if (body.directionLibrary && typeof body.directionLibrary === 'object') {
            return body.directionLibrary;
        }
        if (Array.isArray(body.directions)) {
            return body.directions;
        }

        const candidates = [
            context.creativeKnowledgeDataDir,
            context.dataDir,
            path.join(__dirname, 'data', 'creative-knowledge')
        ].filter(Boolean);

        for (const dir of candidates) {
            try {
                const filePath = path.join(dir, 'directions.json');
                if (fs.existsSync(filePath)) {
                    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                    if (Array.isArray(data)) {
                        return data;
                    }
                    if (Array.isArray(data && data.directions)) {
                        return data.directions;
                    }
                }
            } catch (error) {
                logger.warn(`读取创意方向库失败: ${error.message}`);
            }
        }

        return [];
    }

    function pickText(source, fields) {
        for (const field of fields) {
            const value = source && source[field];
            if (typeof value === 'string' && value.trim()) {
                return value.trim();
            }
        }
        return '';
    }

    function resolvePromptTextFilePath(savePaths = []) {
        const firstPath = Array.isArray(savePaths) ? savePaths.find(Boolean) : '';
        if (!firstPath) {
            return '';
        }
        const parsed = path.parse(firstPath);
        const sharedStem = parsed.name
            .replace(/_v\d+_\d{8}_\d{6}$/i, '')
            .replace(/_v\d+$/i, '');
        return path.join(parsed.dir, `${sharedStem || parsed.name}.prompt.txt`);
    }

    function buildPromptTextFileContent(promptItem = {}, meta = {}) {
        const savedPaths = Array.isArray(meta.savedPaths) ? meta.savedPaths : [];
        const outputNames = savedPaths.map(filePath => path.basename(filePath)).filter(Boolean);
        return [
            `Generated at: ${meta.savedAt || new Date().toISOString()}`,
            `Run ID: ${meta.runId || ''}`,
            `Prompt group: ${meta.displayIndex || promptItem.index || promptItem.batchIndex || ''}`,
            `Prompt title: ${promptItem.promptTitle || promptItem.title || ''}`,
            `Direction: ${promptItem.newDirectionName || promptItem.direction || promptItem.contentTitle || ''}`,
            '',
            'Output images:',
            ...(outputNames.length ? outputNames.map(name => `- ${name}`) : ['-']),
            '',
            'Prompt:',
            promptItem.prompt || promptItem.finalPrompt || ''
        ].join('\n');
    }

    function savePromptTextFileForPromptGroup(savePaths = [], promptItem = {}, meta = {}) {
        const promptFilePath = resolvePromptTextFilePath(savePaths);
        if (!promptFilePath) {
            return '';
        }
        fs.writeFileSync(promptFilePath, buildPromptTextFileContent(promptItem, {
            ...meta,
            savedPaths: savePaths
        }), 'utf8');
        return promptFilePath;
    }

    function normalizeTextArray(value) {
        if (Array.isArray(value)) {
            return value.map(part => String(part || '').trim()).filter(Boolean);
        }
        if (typeof value === 'string' && value.trim()) {
            return value
                .split(/[\/\\_>,，\n\r]+/g)
                .map(part => part.trim())
                .filter(Boolean);
        }
        return [];
    }

    function normalizeLookupKey(value) {
        return String(value || '')
            .trim()
            .replace(/\\/g, '/')
            .toLowerCase();
    }

    function basenameLookupKey(value) {
        const text = String(value || '').trim();
        if (!text) {
            return '';
        }
        return normalizeLookupKey(path.basename(text));
    }

    function readCreativeAssetLibrary(body = {}) {
        const directAssets = Array.isArray(body.assets)
            ? body.assets
            : (Array.isArray(body.assetLibrary) ? body.assetLibrary : null);
        if (directAssets) {
            return directAssets;
        }

        const candidates = [
            context.creativeKnowledgeDataDir,
            context.dataDir,
            path.join(__dirname, 'data', 'creative-knowledge')
        ].filter(Boolean);

        for (const dir of candidates) {
            try {
                const filePath = path.join(dir, 'assets.json');
                if (fs.existsSync(filePath)) {
                    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                    if (Array.isArray(data && data.assets)) {
                        return data.assets;
                    }
                }
            } catch (error) {
                logger.warn(`读取创意资产库失败: ${error.message}`);
            }
        }

        return [];
    }

    function resolveCreativeKnowledgeDataDir() {
        return context.creativeKnowledgeDataDir ||
            context.dataDir ||
            path.join(__dirname, 'data', 'creative-knowledge');
    }

    function registerLegilGeneratedAssets({
        source,
        runId,
        outputFolder,
        generationSettings,
        prompts,
        progress,
        sourceDirection
    } = {}) {
        const savedCount = Number(progress && progress.saved) || 0;
        if (!savedCount) {
            return null;
        }

        try {
            const store = new CreativeKnowledgeStore(resolveCreativeKnowledgeDataDir());
            const assetReport = registerRunAssets({
                store,
                run: {
                    runId,
                    source,
                    sourceDirection: sourceDirection || {},
                    config: {
                        outputFolder,
                        generationSettings: generationSettings || {}
                    },
                    prompts: Array.isArray(prompts) ? prompts : []
                },
                progress
            });
            logger.info(`资产记录已更新：新增 ${assetReport.newAssetCount} 条，重复 ${assetReport.duplicateCount} 条`);
            return assetReport;
        } catch (error) {
            logger.warn(`资产记录更新失败: ${error.message}`);
            return {
                success: false,
                error: error.message
            };
        }
    }

    function findCreativeAssetHint(item, assets = []) {
        if (!item || typeof item !== 'object' || !Array.isArray(assets) || !assets.length) {
            return null;
        }

        const assetIds = [
            item.assetId,
            item.sourceAssetId,
            item.referenceAssetId,
            item.originalAssetId
        ].map(value => String(value || '').trim()).filter(Boolean);

        const pathKeys = [
            item.filePath,
            item.sourceFilePath,
            item.referenceImagePath,
            item.originalImagePath,
            item.sourceImagePath
        ].map(normalizeLookupKey).filter(Boolean);

        const nameKeys = [
            item.fileName,
            item.sourceRawName,
            item.referenceImageName,
            item.originalImageName,
            item.sourceImageName,
            item.imageName
        ].map(basenameLookupKey).filter(Boolean);

        return assets.find(asset => {
            if (!asset || typeof asset !== 'object') {
                return false;
            }
            if (assetIds.length && assetIds.includes(String(asset.assetId || asset.id || '').trim())) {
                return true;
            }

            const assetPath = normalizeLookupKey(asset.filePath || asset.path || asset.sourcePath || '');
            const assetName = basenameLookupKey(asset.fileName || asset.name || assetPath);
            if (assetPath && pathKeys.includes(assetPath)) {
                return true;
            }
            return Boolean(assetName && nameKeys.includes(assetName));
        }) || null;
    }

    function normalizeBatchGeneratePromptItems(prompts = [], body = {}) {
        const assets = readCreativeAssetLibrary(body);
        const defaultReferenceFolderPath = pickText(body, [
            'referenceFolderPath',
            'referenceFolder',
            'sourceFolderPath',
            'sourceFolder',
            'originalFolderPath'
        ]) || appConfig.legilReferenceFolder || '';

        return (Array.isArray(prompts) ? prompts : [])
            .map((item, index) => {
                if (typeof item === 'string') {
                    return {
                        index: index + 1,
                        prompt: item.trim(),
                        outputNameBase: ''
                    };
                }

                if (!item || typeof item !== 'object') {
                    return null;
                }

                const assetHint = findCreativeAssetHint(item, assets) || {};
                const prompt = pickText(item, ['prompt', 'content', 'finalPrompt', 'promptText', 'text']);
                const title = pickText(item, ['contentTitle', 'title', 'newDirectionName', 'outputTitle']);
                const assetStandardLabelPath = normalizeTextArray(
                    assetHint.standardLabelPath ||
                    assetHint.labelPath ||
                    assetHint.sourceLabelPath ||
                    ''
                );
                const itemStandardLabelPath = normalizeTextArray(
                    item.standardLabelPath ||
                    item.sourceLabelPath ||
                    item.labelPath ||
                    item.directionLabelPath ||
                    ''
                );
                const sourceRawName = pickText(item, [
                    'sourceRawName',
                    'sourceMaterialName',
                    'referenceImageName',
                    'originalImageName',
                    'sourceImageName',
                    'imageName',
                    'fileName'
                ]) || pickText(assetHint, ['fileName', 'name']);

                return {
                    index: Number.isFinite(Number(item.index)) && Number(item.index) > 0 ? Number(item.index) : index + 1,
                    prompt,
                    title,
                    contentTitle: pickText(item, ['contentTitle']) || title,
                    newDirectionName: pickText(item, ['newDirectionName']),
                    promptTitle: pickText(item, ['promptTitle', 'promptName']),
                    fallbackName: pickText(item, ['fallbackName', 'name']),
                    primaryTag: pickText(item, ['primaryTag', 'primary']),
                    secondaryTag: pickText(item, ['secondaryTag', 'secondary']),
                    tertiaryTag: pickText(item, ['tertiaryTag', 'tertiary']),
                    standardLabelPath: itemStandardLabelPath.length ? itemStandardLabelPath : assetStandardLabelPath,
                    sourceLabelPath: pickText(item, ['sourceLabelPath', 'labelPath', 'directionLabelPath']),
                    sourceDirectionId: pickText(item, ['sourceDirectionId', 'directionId']) || pickText(assetHint, ['directionId', 'sourceDirectionId']),
                    sourceDirectionPath: pickText(item, ['sourceDirectionPath', 'directionPath', 'direction']) || pickText(assetHint, ['directionPath', 'sourceDirectionPath']),
                    sourceRawName,
                    referenceFolderPath: pickText(item, [
                        'referenceFolderPath',
                        'sourceFolderPath',
                        'sourceFolder',
                        'originalFolderPath'
                    ]) || defaultReferenceFolderPath,
                    outputNameBase: pickText(item, ['outputNameBase']),
                    namingSource: pickText(item, ['namingSource']),
                    tagConfidence: pickText(item, ['tagConfidence'])
                };
            })
            .filter(item => item && item.prompt);
    }

    function hasBatchOutputNamingClue(item) {
        if (!item || typeof item !== 'object') {
            return false;
        }
        if (item.outputNameBase) {
            return true;
        }
        const hasTitle = Boolean(item.contentTitle || item.title || item.newDirectionName);
        const hasLabelClue = Boolean(
            item.primaryTag ||
            item.secondaryTag ||
            item.tertiaryTag ||
            (Array.isArray(item.standardLabelPath) && item.standardLabelPath.length) ||
            item.sourceLabelPath ||
            item.sourceDirectionId ||
            item.sourceDirectionPath ||
            item.sourceRawName ||
            item.referenceFolderPath
        );
        return hasTitle || hasLabelClue;
    }

    function resolveBatchOutputNameBase(item, directionLibrary) {
        if (!item || typeof item !== 'object') {
            return '';
        }
        if (!hasBatchOutputNamingClue(item)) {
            return '';
        }

        const namingContext = buildCreativeOutputNamingContext({
            ...item,
            contentTitle: item.contentTitle || item.title || item.newDirectionName || item.outputNameBase,
            fallbackName: item.fallbackName || item.title || item.contentTitle || item.newDirectionName || item.outputNameBase || item.sourceRawName,
            directionLibrary,
            strictLibraryTags: true
        });

        Object.assign(item, namingContext);
        return namingContext.outputNameBase || '';
    }



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
     * 第七阶段：批量生成多张图片
     * ============================================
     */
    app.post('/api/legil/batch-generate', async (req, res) => {
        const requestBody = req.body || {};
        const { prompts } = requestBody;
        const directionLibrary = readCreativeDirectionLibrary(requestBody);

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

        const normalizedPrompts = normalizeBatchGeneratePromptItems(prompts, requestBody);

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
                const batchGenerationSettings = legilAutomation.getConfig().settings || {};
                const legilOutputQuantity = batchGenerationSettings.outputQuantity || 1;
                const outputTotal = normalizedPrompts.length * legilOutputQuantity;
                const savedFiles = [];
                const promptResults = [];
                for (let i = 0; i < normalizedPrompts.length; i++) {
                    const promptItem = normalizedPrompts[i];
                    const promptText = promptItem.prompt;
                    const outputNameBase = resolveBatchOutputNameBase(promptItem, directionLibrary);

                    logger.info(`正在生成第 ${i + 1}/${normalizedPrompts.length} 张图片...`);

                    try {
                        const result = await legilAutomation.generateImage(promptText, i + 1, {
                            outputSequence,
                            outputTotal,
                            runId: batchRunId,
                            promptIndexWithinImage: i + 1,
                            totalPromptsForImage: normalizedPrompts.length,
                            outputNameBase: outputNameBase || undefined,
                            referenceImageName: outputNameBase || promptItem.sourceRawName || undefined,
                            promptTitle: promptItem.promptTitle || undefined,
                            taskType: 'Legil批量生成',
                            autoRecoveryEnabled: appConfig.notifications.autoRecoveryEnabled,
                            captureErrorScreenshot: appConfig.notifications.legilScreenshotEnabled
                        });

                        if (result.success) {
                            consecutiveFailures = 0;
                            const savedCount = Number(result.savedCount) || 1;
                            const resultSavePaths = Array.isArray(result.savePaths)
                                ? result.savePaths
                                : (result.savePath ? [result.savePath] : []);
                            let promptFilePath = '';
                            const promptFileSavedAt = new Date().toISOString();
                            try {
                                promptFilePath = savePromptTextFileForPromptGroup(resultSavePaths, promptItem, {
                                    savedAt: promptFileSavedAt,
                                    runId: batchRunId,
                                    displayIndex: i + 1
                                });
                                if (promptFilePath) {
                                    logger.info(`Prompt text saved: ${path.basename(promptFilePath)}`);
                                }
                            } catch (promptFileError) {
                                logger.warn(`Prompt text save failed: ${promptFileError.message}`);
                            }
                            const promptSavedFiles = resultSavePaths.map((filePath, fileIndex) => ({
                                filePath,
                                fileName: path.basename(filePath),
                                promptFilePath,
                                promptFileName: promptFilePath ? path.basename(promptFilePath) : '',
                                promptListIndex: i + 1,
                                displayIndex: i + 1,
                                imageIndex: fileIndex + 1,
                                promptTitle: promptItem.promptTitle || '',
                                sourceDirectionId: promptItem.sourceDirectionId || '',
                                sourceDirectionPath: promptItem.sourceDirectionPath || '',
                                sourceRawName: promptItem.sourceRawName || '',
                                sourceParsedParts: promptItem.sourceParsedParts || [],
                                sourceContentTitle: promptItem.sourceContentTitle || '',
                                droppedLabelParts: promptItem.droppedLabelParts || [],
                                newDirectionName: promptItem.newDirectionName || '',
                                outputNameBase: outputNameBase || '',
                                contentTitle: promptItem.contentTitle || promptItem.title || '',
                                standardLabelPath: promptItem.standardLabelPath || [],
                                primaryTag: promptItem.primaryTag || '',
                                secondaryTag: promptItem.secondaryTag || '',
                                tertiaryTag: promptItem.tertiaryTag || '',
                                namingSource: promptItem.namingSource || '',
                                tagConfidence: promptItem.tagConfidence || '',
                                savedAt: promptFileSavedAt
                            }));
                            savedFiles.push(...promptSavedFiles);
                            promptResults.push({
                                promptListIndex: i + 1,
                                displayIndex: i + 1,
                                promptTitle: promptItem.promptTitle || '',
                                sourceDirectionId: promptItem.sourceDirectionId || '',
                                sourceDirectionPath: promptItem.sourceDirectionPath || '',
                                sourceRawName: promptItem.sourceRawName || '',
                                sourceParsedParts: promptItem.sourceParsedParts || [],
                                sourceContentTitle: promptItem.sourceContentTitle || '',
                                droppedLabelParts: promptItem.droppedLabelParts || [],
                                newDirectionName: promptItem.newDirectionName || '',
                                outputNameBase: outputNameBase || '',
                                contentTitle: promptItem.contentTitle || promptItem.title || '',
                                standardLabelPath: promptItem.standardLabelPath || [],
                                primaryTag: promptItem.primaryTag || '',
                                secondaryTag: promptItem.secondaryTag || '',
                                tertiaryTag: promptItem.tertiaryTag || '',
                                namingSource: promptItem.namingSource || '',
                                tagConfidence: promptItem.tagConfidence || '',
                                promptFilePath,
                                promptFileName: promptFilePath ? path.basename(promptFilePath) : '',
                                savedCount,
                                savedFiles: promptSavedFiles
                            });
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
                registerLegilGeneratedAssets({
                    source: 'legil-batch-generate',
                    runId: batchRunId,
                    outputFolder: legilAutomation.saveFolder,
                    generationSettings: batchGenerationSettings,
                    prompts: normalizedPrompts,
                    progress: {
                        taskType: 'batch-generate',
                        phase: 'completed',
                        saved: savedFiles.length,
                        success: promptResults.length,
                        failed: Math.max(0, normalizedPrompts.length - promptResults.length),
                        outputTotal,
                        batchRunId,
                        savedFiles,
                        promptResults,
                        updatedAt: new Date().toISOString()
                    }
                });
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


    app.get('/api/resize/resume', (req, res) => {
        res.json({
            success: true,
            resume: getResizeResumeInfo(false)
        });
    });



    app.post('/api/resize/resume/clear', (req, res) => {
        if (automationState.legilTaskRunning && automationState.legilTaskType === 'resize-batch') {
            return res.json({
                success: false,
                message: 'Legil 改尺寸任务正在运行，不能清除恢复状态'
            });
        }
        if (context.jimengBrowserService && context.jimengBrowserService.isRunning()) {
            return res.json({
                success: false,
                message: '即梦改尺寸任务正在运行，不能清除恢复状态'
            });
        }

        clearResizeResumeState();
        res.json({
            success: true,
            resume: { hasResume: false },
            message: '改尺寸恢复状态已清除'
        });
    });



    /**
     * ============================================
     * Legil 批量改尺寸：只使用 Legil，不调用提示词 LLM
     * ============================================
     */
    app.post('/api/legil/resize-batch', async (req, res) => {
        const requestBody = req.body || {};
        const resumeRequested = requestBody.resumeMode === true ||
            String(requestBody.resumeMode || '').toLowerCase() === 'true' ||
            Boolean(String(requestBody.resumeRunId || '').trim());
        const resumeInfo = resumeRequested ? getResizeResumeInfo(true) : null;
        let resizeConfig = normalizeResizeConfigPayload(requestBody);
        let resizeGenerationSettings = normalizeLegilGenerationSettings(
            req.body && typeof req.body.generationSettings === 'object' ? req.body.generationSettings : resizeConfig.generationSettings,
            resizeConfig.generationSettings || DEFAULT_RESIZE_CONFIG.generationSettings
        );
        let resumeBase = null;
        if (resumeRequested) {
            if (!resumeInfo || !resumeInfo.hasResume || resumeInfo.provider !== 'legil' || !Array.isArray(resumeInfo.jobs)) {
                return res.json({
                    success: false,
                    message: '没有可继续的 Legil 改尺寸任务'
                });
            }
            const resumeRunId = String(requestBody.resumeRunId || '').trim();
            if (resumeRunId && resumeInfo.runId && resumeRunId !== resumeInfo.runId) {
                return res.json({
                    success: false,
                    message: '可继续任务已变化，请刷新页面后重试'
                });
            }
            resizeConfig = normalizeResizeConfigPayload({
                inputFolder: resumeInfo.inputFolder,
                outputFolder: resumeInfo.outputFolder,
                browserMode: resumeInfo.browserMode,
                promptTemplate: resumeInfo.promptTemplate,
                generationSettings: resumeInfo.generationSettings
            });
            resizeGenerationSettings = normalizeLegilGenerationSettings(
                resumeInfo.generationSettings,
                resizeConfig.generationSettings || DEFAULT_RESIZE_CONFIG.generationSettings
            );
            resumeBase = {
                runId: resumeInfo.runId,
                jobs: resumeInfo.jobs,
                nextIndex: Number(resumeInfo.nextIndex) || 0,
                total: Number(resumeInfo.total) || resumeInfo.jobs.length,
                totalImages: Number(resumeInfo.totalImages) || 0,
                totalAspectRatios: Number(resumeInfo.totalAspectRatios) || 0,
                completed: Number(resumeInfo.completed) || 0,
                success: Number(resumeInfo.success) || 0,
                failed: Number(resumeInfo.failed) || 0,
                saved: Number(resumeInfo.saved) || 0,
                outputTotal: Number(resumeInfo.progress && resumeInfo.progress.outputTotal) || 0
            };
        }
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

            let imageFiles = resumeBase
                ? Array.from(new Set(resumeBase.jobs.map(job => job.imagePath)))
                : listImageFilesInFolder(resizeConfig.inputFolder);
            if (imageFiles.length === 0) {
                return res.json({
                    success: false,
                    message: '输入文件夹中没有找到图片'
                });
            }
            if (resumeBase && resumeBase.jobs.slice(resumeBase.nextIndex).length === 0) {
                return res.json({
                    success: false,
                    message: '没有剩余的 Legil 改尺寸任务可继续'
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
            const batchRunId = resumeBase && resumeBase.runId ? resumeBase.runId : formatDateTimeForFile();
            const resizeAspectRatios = Array.isArray(resizeGenerationSettings.aspectRatios) && resizeGenerationSettings.aspectRatios.length
                ? resizeGenerationSettings.aspectRatios
                : [resizeGenerationSettings.aspectRatio];
            const allResizeJobs = resumeBase
                ? resumeBase.jobs
                : buildResizeJobs(imageFiles, resizeAspectRatios);
            const resizeJobs = resumeBase
                ? allResizeJobs.slice(resumeBase.nextIndex)
                : allResizeJobs;
            const progressTotal = resumeBase ? resumeBase.total : allResizeJobs.length;
            const baseCompleted = resumeBase ? resumeBase.completed : 0;
            const baseSuccess = resumeBase ? resumeBase.success : 0;
            const baseFailed = resumeBase ? resumeBase.failed : 0;
            const baseSaved = resumeBase ? resumeBase.saved : 0;
            const runNextIndexBase = resumeBase ? resumeBase.nextIndex : 0;
            const outputTotal = Math.max(
                resumeBase ? resumeBase.outputTotal : 0,
                progressTotal * (Number(resizeGenerationSettings.outputQuantity) || 1)
            );
            const resizeHeadless = resizeConfig.browserMode === 'headless';
            automationState.legilTaskProgress = {
                taskType: 'resize-batch',
                phase: 'queued',
                total: progressTotal,
                totalImages: resumeBase ? resumeBase.totalImages : imageFiles.length,
                totalAspectRatios: resumeBase ? resumeBase.totalAspectRatios : resizeAspectRatios.length,
                currentIndex: baseCompleted,
                completed: baseCompleted,
                success: baseSuccess,
                failed: baseFailed,
                saved: baseSaved,
                outputTotal,
                browserMode: resizeConfig.browserMode,
                currentName: '',
                currentAction: resumeBase
                    ? `Legil 改尺寸继续任务已排队，准备从 ${baseCompleted}/${progressTotal} 继续...`
                    : '批量改尺寸任务已排队，准备开始...',
                startedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            setResizeResumeState({
                provider: 'legil',
                runId: batchRunId,
                phase: 'queued',
                inputFolder: resizeConfig.inputFolder,
                outputFolder: resizeConfig.outputFolder,
                browserMode: resizeConfig.browserMode,
                promptTemplate: resizeConfig.promptTemplate,
                generationSettings: resizeGenerationSettings,
                jobs: allResizeJobs,
                total: progressTotal,
                totalImages: resumeBase ? resumeBase.totalImages : imageFiles.length,
                totalAspectRatios: resumeBase ? resumeBase.totalAspectRatios : resizeAspectRatios.length,
                nextIndex: runNextIndexBase,
                currentIndex: baseCompleted,
                completed: baseCompleted,
                success: baseSuccess,
                failed: baseFailed,
                saved: baseSaved,
                outputTotal,
                currentName: '',
                currentAction: automationState.legilTaskProgress.currentAction,
                startedAt: automationState.legilTaskProgress.startedAt,
                updatedAt: automationState.legilTaskProgress.updatedAt
            });

            res.json({
                success: true,
                message: resumeBase
                    ? `已继续 Legil 批量改尺寸任务，剩余 ${resizeJobs.length} 组。请通过实时日志查看进度。`
                    : `已启动 Legil 批量改尺寸任务，共 ${imageFiles.length} 张输入图、${resizeAspectRatios.length} 个宽高比。请通过实时日志查看进度。`,
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
                logger.info(`改尺寸 Legil 参数: 模型 ${legilAutomation.getImageModelLabel(resizeGenerationSettings.imageModel)}，宽高比 ${resizeAspectRatios.join('、')}，分辨率 ${resizeGenerationSettings.resolution}，输出数量 ${resizeGenerationSettings.outputQuantity}`);
                logger.system('========================================');

                let outputSequence = baseSaved + 1;
                let successCount = 0;
                let failedCount = 0;
                let savedTotal = 0;
                let consecutiveFailures = 0;
                let stopped = false;
                let interruptedMessage = '';
                const totalImagesForProgress = resumeBase ? resumeBase.totalImages : imageFiles.length;
                const totalRatiosForProgress = resumeBase ? resumeBase.totalAspectRatios : resizeAspectRatios.length;
                const getLocalCompleted = () => successCount + failedCount;
                const getAggregateCompleted = () => Math.min(progressTotal, baseCompleted + getLocalCompleted());
                const getAggregateSuccess = () => baseSuccess + successCount;
                const getAggregateFailed = () => baseFailed + failedCount;
                const getAggregateSaved = () => baseSaved + savedTotal;
                const getResumeNextIndex = () => Math.min(allResizeJobs.length, runNextIndexBase + getLocalCompleted());
                const updateResizeProgress = (patch = {}) => {
                    automationState.legilTaskProgress = {
                        ...(automationState.legilTaskProgress || {}),
                        taskType: 'resize-batch',
                        total: progressTotal,
                        totalImages: totalImagesForProgress,
                        totalAspectRatios: totalRatiosForProgress,
                        outputTotal,
                        browserMode: resizeConfig.browserMode,
                        ...patch,
                        updatedAt: new Date().toISOString()
                    };
                };
                const updateResizeResumeFromProgress = (patch = {}) => {
                    updateResizeResumeState({
                        phase: patch.phase || 'running',
                        nextIndex: getResumeNextIndex(),
                        currentIndex: patch.currentIndex !== undefined ? patch.currentIndex : getAggregateCompleted(),
                        completed: getAggregateCompleted(),
                        success: getAggregateSuccess(),
                        failed: getAggregateFailed(),
                        saved: getAggregateSaved(),
                        currentName: patch.currentName || '',
                        currentAction: patch.currentAction || '',
                        ...patch
                    });
                };

                try {
                    for (const job of resizeJobs) {
                        if (isLegilStopRequested()) {
                            stopped = true;
                            logger.warn('⏹️ 改尺寸任务已停止，退出剩余图片处理');
                            break;
                        }

                        const imagePath = job.imagePath;
                        const imageName = path.basename(imagePath);
                        const perRatioGenerationSettings = {
                            ...resizeGenerationSettings,
                            aspectRatio: job.aspectRatio,
                            aspectRatios: resizeAspectRatios
                        };

                        updateResizeProgress({
                            phase: 'running',
                            currentIndex: job.jobIndex,
                            completed: getAggregateCompleted(),
                            success: getAggregateSuccess(),
                            failed: getAggregateFailed(),
                            saved: getAggregateSaved(),
                            currentName: imageName,
                            currentAction: `正在处理改尺寸图片 ${job.imageIndex + 1}/${imageFiles.length}，比例 ${job.ratioIndex + 1}/${resizeAspectRatios.length}（${job.aspectRatio}）: ${imageName}`
                        });
                        updateResizeResumeFromProgress(automationState.legilTaskProgress);

                        logger.info('');
                        logger.info(`🖼️ 正在处理改尺寸图片 ${job.imageIndex + 1}/${imageFiles.length}: ${imageName}，比例 ${job.ratioIndex + 1}/${resizeAspectRatios.length}（${job.aspectRatio}）`);

                        try {
                            const result = await legilAutomation.generateImage(promptText, job.jobIndex, {
                                referenceImagePath: imagePath,
                                saveFolder: resizeConfig.outputFolder,
                                headless: resizeHeadless,
                                generationSettings: perRatioGenerationSettings,
                                outputSequence,
                                outputTotal,
                                runId: batchRunId,
                                referenceImageIndex: job.imageIndex + 1,
                                totalReferenceImages: imageFiles.length,
                                referenceImageName: imageName,
                                promptIndexWithinImage: job.ratioIndex + 1,
                                totalPromptsForImage: resizeAspectRatios.length,
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
                                savedTotal += savedCount;
                                successCount += 1;
                                updateResizeProgress({
                                    phase: 'running',
                                    currentIndex: job.jobIndex,
                                    completed: getAggregateCompleted(),
                                    success: getAggregateSuccess(),
                                    failed: getAggregateFailed(),
                                    saved: getAggregateSaved(),
                                    currentName: imageName,
                                    currentAction: `改尺寸图片 ${job.imageIndex + 1}/${imageFiles.length}，比例 ${job.aspectRatio} 完成，保存 ${savedCount} 张`
                                });
                                updateResizeResumeFromProgress(automationState.legilTaskProgress);
                                logger.info(`✅ 改尺寸图片 ${job.imageIndex + 1}/${imageFiles.length}，比例 ${job.aspectRatio} 完成，保存 ${savedCount} 张`);
                            } else if (isLegilStopRequested() || String(result.message || '').includes('操作已取消')) {
                                stopped = true;
                                logger.warn('⏹️ 改尺寸任务已停止');
                                break;
                            } else {
                                failedCount += 1;
                                consecutiveFailures += 1;
                                updateResizeProgress({
                                    phase: 'running',
                                    currentIndex: job.jobIndex,
                                    completed: getAggregateCompleted(),
                                    success: getAggregateSuccess(),
                                    failed: getAggregateFailed(),
                                    saved: getAggregateSaved(),
                                    currentName: imageName,
                                    currentAction: `改尺寸图片 ${job.imageIndex + 1}/${imageFiles.length}，比例 ${job.aspectRatio} 失败: ${result.message}`
                                });
                                updateResizeResumeFromProgress(automationState.legilTaskProgress);
                                logger.error(`❌ 改尺寸图片 ${job.imageIndex + 1}/${imageFiles.length}，比例 ${job.aspectRatio} 失败: ${result.message}`);
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
                                currentIndex: job.jobIndex,
                                completed: getAggregateCompleted(),
                                success: getAggregateSuccess(),
                                failed: getAggregateFailed(),
                                saved: getAggregateSaved(),
                                currentName: imageName,
                                currentAction: `改尺寸图片 ${job.imageIndex + 1}/${imageFiles.length}，比例 ${job.aspectRatio} 出错: ${error.message}`
                            });
                            updateResizeResumeFromProgress(automationState.legilTaskProgress);
                            logger.error(`❌ 改尺寸图片 ${job.imageIndex + 1}/${imageFiles.length}，比例 ${job.aspectRatio} 出错: ${error.message}`);
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

                        const isLastRatioForImage = job.ratioIndex === resizeAspectRatios.length - 1;
                        const isLastImage = job.imageIndex >= imageFiles.length - 1;
                        if (isLastRatioForImage && !isLastImage) {
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
                            currentIndex: getAggregateCompleted(),
                            completed: getAggregateCompleted(),
                            success: getAggregateSuccess(),
                            failed: getAggregateFailed(),
                            saved: getAggregateSaved(),
                            currentAction: '批量改尺寸任务已停止'
                        });
                        updateResizeResumeFromProgress(automationState.legilTaskProgress);
                        logger.system(`⏹️ Legil 批量改尺寸任务已停止：成功 ${getAggregateSuccess()} 组，失败 ${getAggregateFailed()} 组`);
                    } else {
                        updateResizeProgress({
                            phase: 'completed',
                            currentIndex: progressTotal,
                            completed: getAggregateCompleted(),
                            success: getAggregateSuccess(),
                            failed: getAggregateFailed(),
                            saved: getAggregateSaved(),
                            currentAction: `批量改尺寸任务完成：成功 ${getAggregateSuccess()} 组，失败 ${getAggregateFailed()} 组`
                        });
                        clearResizeResumeState();
                        logger.system(`✅ Legil 批量改尺寸任务完成：成功 ${getAggregateSuccess()} 组，失败 ${getAggregateFailed()} 组`);
                    }
                    logger.system('========================================');
                } catch (error) {
                    const safeMessage = error && error.message ? error.message : String(error || '未知错误');
                    interruptedMessage = safeMessage;
                    updateResizeProgress({
                        phase: 'interrupted',
                        currentIndex: getAggregateCompleted(),
                        completed: getAggregateCompleted(),
                        success: getAggregateSuccess(),
                        failed: getAggregateFailed(),
                        saved: getAggregateSaved(),
                        currentAction: `批量改尺寸任务被中断: ${safeMessage}`
                    });
                    updateResizeResumeFromProgress(automationState.legilTaskProgress);
                    logger.error(`❌ Legil 批量改尺寸任务被中断: ${safeMessage}`);
                } finally {
                    notifyLegilResult('resize-batch', {
                        successCount: getAggregateSuccess(),
                        failedCount: getAggregateFailed(),
                        interrupted: Boolean(interruptedMessage),
                        message: interruptedMessage || (stopped ? '任务已停止' : `任务完成：成功 ${getAggregateSuccess()} 组，失败 ${getAggregateFailed()} 组`)
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
        const directionLibrary = readCreativeDirectionLibrary(req.body || {});
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
                message: 'Please provide valid image prompts before starting Legil generation'
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
                batchRunId,
                creativeAutoRunId: String(req.body && req.body.creativeAutoRunId || ''),
                savedFiles: [],
                promptResults: [],
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
                const savedFiles = [];
                const promptResults = [];
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
                        const namingContext = buildCreativeOutputNamingContext({
                            ...promptItem,
                            sourceDirectionPath: promptItem.sourceDirectionPath || promptItem.direction,
                            contentTitle: promptItem.contentTitle || promptItem.newDirectionName || promptItem.direction,
                            fallbackName: promptItem.newDirectionName || promptItem.direction || `表格第${promptItem.sourceRow}行`,
                            directionLibrary,
                            strictLibraryTags: true
                        });
                        const outputNameBase = namingContext.outputNameBase || promptItem.outputNameBase || promptItem.newDirectionName || promptItem.direction || `表格第${promptItem.sourceRow}行`;
                        const enrichedPromptItem = {
                            ...promptItem,
                            ...namingContext,
                            outputNameBase
                        };
                        normalizedPrompts[i] = enrichedPromptItem;
                        const directionName = outputNameBase;
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
                            const result = await legilAutomation.generateImage(enrichedPromptItem.prompt, i + 1, {
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
                                outputNameBase,
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
                                const resultSavePaths = Array.isArray(result.savePaths)
                                    ? result.savePaths
                                    : (result.savePath ? [result.savePath] : []);
                                let promptFilePath = '';
                                const promptFileSavedAt = new Date().toISOString();
                                try {
                                    promptFilePath = savePromptTextFileForPromptGroup(resultSavePaths, enrichedPromptItem, {
                                        savedAt: promptFileSavedAt,
                                        runId: batchRunId,
                                        displayIndex
                                    });
                                    if (promptFilePath) {
                                        logger.info(`Prompt text saved: ${path.basename(promptFilePath)}`);
                                    }
                                } catch (promptFileError) {
                                    logger.warn(`Prompt text save failed: ${promptFileError.message}`);
                                }
                                const promptSavedFiles = resultSavePaths.map((filePath, fileIndex) => ({
                                    filePath,
                                    fileName: path.basename(filePath),
                                    promptFilePath,
                                    promptFileName: promptFilePath ? path.basename(promptFilePath) : '',
                                    promptListIndex: i + 1,
                                    displayIndex,
                                    imageIndex: fileIndex + 1,
                                    sourceRow: promptItem.sourceRow || '',
                                    direction: enrichedPromptItem.direction || '',
                                    promptTitle: enrichedPromptItem.promptTitle || '',
                                    promptHash: enrichedPromptItem.promptHash || '',
                                    sourceDirectionId: enrichedPromptItem.sourceDirectionId || '',
                                    sourceDirectionPath: enrichedPromptItem.sourceDirectionPath || '',
                                    sourceRawName: enrichedPromptItem.sourceRawName || '',
                                    sourceParsedParts: enrichedPromptItem.sourceParsedParts || [],
                                    sourceContentTitle: enrichedPromptItem.sourceContentTitle || '',
                                    droppedLabelParts: enrichedPromptItem.droppedLabelParts || [],
                                    newDirectionName: enrichedPromptItem.newDirectionName || '',
                                    outputNameBase,
                                    contentTitle: enrichedPromptItem.contentTitle || '',
                                    standardLabelPath: enrichedPromptItem.standardLabelPath || [],
                                    primaryTag: enrichedPromptItem.primaryTag || '',
                                    secondaryTag: enrichedPromptItem.secondaryTag || '',
                                    tertiaryTag: enrichedPromptItem.tertiaryTag || '',
                                    namingSource: enrichedPromptItem.namingSource || '',
                                    tagConfidence: enrichedPromptItem.tagConfidence || '',
                                    savedAt: promptFileSavedAt
                                }));
                                savedFiles.push(...promptSavedFiles);
                                promptResults.push({
                                    promptListIndex: i + 1,
                                    displayIndex,
                                    sourceRow: enrichedPromptItem.sourceRow || '',
                                    direction: enrichedPromptItem.direction || '',
                                    promptTitle: enrichedPromptItem.promptTitle || '',
                                    promptHash: enrichedPromptItem.promptHash || '',
                                    sourceDirectionId: enrichedPromptItem.sourceDirectionId || '',
                                    sourceDirectionPath: enrichedPromptItem.sourceDirectionPath || '',
                                    sourceRawName: enrichedPromptItem.sourceRawName || '',
                                    sourceParsedParts: enrichedPromptItem.sourceParsedParts || [],
                                    sourceContentTitle: enrichedPromptItem.sourceContentTitle || '',
                                    droppedLabelParts: enrichedPromptItem.droppedLabelParts || [],
                                    newDirectionName: enrichedPromptItem.newDirectionName || '',
                                    outputNameBase,
                                    contentTitle: enrichedPromptItem.contentTitle || '',
                                    standardLabelPath: enrichedPromptItem.standardLabelPath || [],
                                    primaryTag: enrichedPromptItem.primaryTag || '',
                                    secondaryTag: enrichedPromptItem.secondaryTag || '',
                                    tertiaryTag: enrichedPromptItem.tertiaryTag || '',
                                    namingSource: enrichedPromptItem.namingSource || '',
                                    tagConfidence: enrichedPromptItem.tagConfidence || '',
                                    promptFilePath,
                                    promptFileName: promptFilePath ? path.basename(promptFilePath) : '',
                                    savedCount,
                                    savedFiles: promptSavedFiles
                                });
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
                                    savedFiles,
                                    promptResults,
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
                    if (!(req.body && req.body.creativeAutoRunId)) {
                        registerLegilGeneratedAssets({
                            source: 'legil-creative-batch',
                            runId: batchRunId,
                            outputFolder: creativeConfig.outputFolder,
                            generationSettings: creativeGenerationSettings,
                            prompts: normalizedPrompts,
                            progress: {
                                ...(automationState.legilTaskProgress || {}),
                                taskType: 'creative-batch',
                                saved: getAggregateSaved(),
                                success: getAggregateSuccess(),
                                failed: getAggregateFailed(),
                                outputTotal,
                                batchRunId,
                                savedFiles,
                                promptResults,
                                updatedAt: new Date().toISOString()
                            }
                        });
                    }
                    if (req.body && req.body.suppressLegilNotification !== true) {
                        notifyLegilResult('creative-batch', {
                            successCount: getAggregateSuccess(),
                            failedCount: getAggregateFailed(),
                            interrupted: Boolean(interruptedMessage),
                            message: interruptedMessage || (stopped
                                ? `任务已停止：成功 ${getAggregateSuccess()} 组，失败 ${getAggregateFailed()} 组`
                                : `任务完成：成功 ${getAggregateSuccess()} 组，失败 ${getAggregateFailed()} 组`)
                        });
                    }
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
