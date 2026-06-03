/**
 * 即梦 AI 网页自动化：登录检测、改尺寸配置、批量改尺寸任务。
 */
module.exports = function registerJimengRoutes(app, context) {
    const {
        appConfig,
        buildResizeJobs,
        clearResizeResumeState,
        DEFAULT_JIMENG_RESIZE_CONFIG,
        fs,
        getResizeAspectRatiosFromSettings,
        getResizeResumeInfo,
        getJimengGenerationOptions,
        jimengBrowserService,
        listImageFilesInFolder,
        logger,
        normalizeInputPath,
        normalizeJimengResizeConfig,
        persistRuntimeConfig,
        setResizeResumeState,
        updateResizeResumeState
    } = context;

    app.get('/api/jimeng/status', async (req, res) => {
        try {
            const status = await jimengBrowserService.checkStatus({
                open: req.query.open === '1' || req.query.open === 'true',
                headless: req.query.headless === '1' || req.query.headless === 'true'
            });
            res.json(status);
        } catch (error) {
            res.json({
                success: false,
                browserRunning: false,
                loggedIn: false,
                ready: false,
                message: error.message
            });
        }
    });

    app.post('/api/jimeng/open', async (req, res) => {
        try {
            if (jimengBrowserService.isRunning()) {
                return res.json({
                    success: false,
                    message: '即梦改尺寸任务运行中，暂不能切换即梦浏览器页面'
                });
            }

            const status = await jimengBrowserService.checkStatus({
                open: true,
                headless: false
            });

            res.json({
                ...status,
                success: status.success !== false,
                message: status.message || '即梦 AI 页面已打开，请在弹出的自动化浏览器中完成登录'
            });
        } catch (error) {
            res.json({
                success: false,
                message: '打开即梦 AI 页面失败: ' + error.message
            });
        }
    });

    app.get('/api/config/jimeng-resize', (req, res) => {
        appConfig.jimengResize = normalizeJimengResizeConfig(
            appConfig.jimengResize,
            DEFAULT_JIMENG_RESIZE_CONFIG
        );

        res.json({
            success: true,
            config: {
                ...appConfig.jimengResize,
                generationSettings: {
                    ...appConfig.jimengResize.generationSettings
                },
                defaultGenerationSettings: {
                    ...DEFAULT_JIMENG_RESIZE_CONFIG.generationSettings
                },
                generationOptions: getJimengGenerationOptions()
            },
            message: '获取即梦改尺寸配置成功'
        });
    });

    app.post('/api/config/jimeng-resize', (req, res) => {
        try {
            appConfig.jimengResize = normalizeJimengResizeConfig(
                req.body || {},
                appConfig.jimengResize || DEFAULT_JIMENG_RESIZE_CONFIG
            );
            persistRuntimeConfig({ jimengResize: appConfig.jimengResize });

            res.json({
                success: true,
                config: {
                    ...appConfig.jimengResize,
                    generationSettings: {
                        ...appConfig.jimengResize.generationSettings
                    }
                },
                message: '即梦改尺寸配置已保存'
            });
        } catch (error) {
            res.json({
                success: false,
                message: '保存即梦改尺寸配置失败: ' + error.message
            });
        }
    });

    app.post('/api/jimeng/resize-batch', async (req, res) => {
        const requestBody = req.body || {};
        const resumeRequested = requestBody.resumeMode === true ||
            String(requestBody.resumeMode || '').toLowerCase() === 'true' ||
            Boolean(String(requestBody.resumeRunId || '').trim());
        const resumeInfo = resumeRequested ? getResizeResumeInfo(true) : null;
        let resizeConfig = normalizeJimengResizeConfig(
            requestBody,
            appConfig.jimengResize || DEFAULT_JIMENG_RESIZE_CONFIG
        );
        let resumeBase = null;
        if (resumeRequested) {
            if (!resumeInfo || !resumeInfo.hasResume || resumeInfo.provider !== 'jimeng' || !Array.isArray(resumeInfo.jobs)) {
                return res.json({
                    success: false,
                    message: '没有可继续的即梦改尺寸任务'
                });
            }
            const resumeRunId = String(requestBody.resumeRunId || '').trim();
            if (resumeRunId && resumeInfo.runId && resumeRunId !== resumeInfo.runId) {
                return res.json({
                    success: false,
                    message: '可继续任务已变化，请刷新页面后重试'
                });
            }
            resizeConfig = normalizeJimengResizeConfig({
                inputFolder: resumeInfo.inputFolder,
                outputFolder: resumeInfo.outputFolder,
                browserMode: resumeInfo.browserMode,
                promptTemplate: resumeInfo.promptTemplate,
                generationSettings: resumeInfo.generationSettings
            }, appConfig.jimengResize || DEFAULT_JIMENG_RESIZE_CONFIG);
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

        console.log('\n🖼️ 收到即梦 AI 网页批量改尺寸请求');
        console.log('   输入文件夹:', resizeConfig.inputFolder);
        console.log('   输出文件夹:', resizeConfig.outputFolder);
        console.log('   运行模式:', resizeConfig.browserMode);
        console.log('   宽高比:', (resizeConfig.generationSettings.aspectRatios || [resizeConfig.generationSettings.aspectRatio]).join('、'));
        console.log('   处理方式: 单页顺序生成，每张输入图按所选宽高比依次保存4张');

        if (jimengBrowserService.isRunning()) {
            return res.json({
                success: false,
                message: '当前已有即梦改尺寸任务正在运行，请稍后再试'
            });
        }

        if (!promptText) {
            return res.json({
                success: false,
                message: '请填写发送给即梦 AI 的固定文字提示词'
            });
        }

        try {
            const inputFolder = normalizeInputPath(resizeConfig.inputFolder);
            const outputFolder = normalizeInputPath(resizeConfig.outputFolder);
            resizeConfig.inputFolder = inputFolder;
            resizeConfig.outputFolder = outputFolder;

            if (!fs.existsSync(inputFolder)) {
                return res.json({
                    success: false,
                    message: '输入文件夹不存在，请检查路径是否正确'
                });
            }

            if (!fs.statSync(inputFolder).isDirectory()) {
                return res.json({
                    success: false,
                    message: '输入路径不是文件夹'
                });
            }

            const imageFiles = resumeBase
                ? Array.from(new Set(resumeBase.jobs.map(job => job.imagePath)))
                : listImageFilesInFolder(inputFolder);
            if (imageFiles.length === 0) {
                return res.json({
                    success: false,
                    message: '输入文件夹中没有找到图片'
                });
            }
            if (resumeBase && resumeBase.jobs.slice(resumeBase.nextIndex).length === 0) {
                return res.json({
                    success: false,
                    message: '没有剩余的即梦改尺寸任务可继续'
                });
            }

            fs.mkdirSync(outputFolder, { recursive: true });
            if (!fs.statSync(outputFolder).isDirectory()) {
                return res.json({
                    success: false,
                    message: '输出路径不是文件夹'
                });
            }

            const status = await jimengBrowserService.checkStatus({
                open: true,
                headless: resizeConfig.browserMode !== 'headed'
            });
            if (!status.success || !status.loggedIn) {
                return res.json({
                    success: false,
                    message: status.message || '即梦自动化浏览器未登录，请先点击“打开即梦AI”并完成登录'
                });
            }

            appConfig.jimengResize = resizeConfig;
            persistRuntimeConfig({ jimengResize: appConfig.jimengResize });

            const aspectRatios = getResizeAspectRatiosFromSettings(resizeConfig.generationSettings);
            const allResizeJobs = resumeBase ? resumeBase.jobs : buildResizeJobs(imageFiles, aspectRatios);
            if (allResizeJobs.length === 0) {
                return res.json({
                    success: false,
                    message: '没有可执行的即梦改尺寸任务'
                });
            }

            logger.system('即梦 AI 改尺寸使用独立浏览器会话，可与 Legil 量产/创意拓展同时运行。');
            const result = jimengBrowserService.startResizeBatch(resizeConfig, imageFiles, {
                jobs: allResizeJobs,
                resumeNextIndex: resumeBase ? resumeBase.nextIndex : 0,
                resumeBase,
                runId: resumeBase && resumeBase.runId ? resumeBase.runId : '',
                onSetResumeState: setResizeResumeState,
                onUpdateResumeState: updateResizeResumeState,
                onClearResumeState: clearResizeResumeState
            });
            res.json(result);
        } catch (error) {
            console.error('即梦 AI 改尺寸启动失败:', error);
            res.json({
                success: false,
                message: '启动即梦改尺寸失败: ' + error.message
            });
        }
    });

    app.get('/api/jimeng/task-status', (req, res) => {
        res.json(jimengBrowserService.getTaskStatus());
    });

    app.post('/api/jimeng/stop', (req, res) => {
        res.json(jimengBrowserService.requestStop());
    });
};
