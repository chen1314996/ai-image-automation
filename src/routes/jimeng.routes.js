/**
 * 即梦 AI 网页自动化：登录检测、改尺寸配置、批量改尺寸任务。
 */
module.exports = function registerJimengRoutes(app, context) {
    const {
        appConfig,
        DEFAULT_JIMENG_RESIZE_CONFIG,
        fs,
        getJimengGenerationOptions,
        jimengBrowserService,
        listImageFilesInFolder,
        logger,
        normalizeInputPath,
        normalizeJimengResizeConfig,
        persistRuntimeConfig
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
        const resizeConfig = normalizeJimengResizeConfig(
            req.body || {},
            appConfig.jimengResize || DEFAULT_JIMENG_RESIZE_CONFIG
        );
        const promptText = String(resizeConfig.promptTemplate || '').trim();

        console.log('\n🖼️ 收到即梦 AI 网页批量改尺寸请求');
        console.log('   输入文件夹:', resizeConfig.inputFolder);
        console.log('   输出文件夹:', resizeConfig.outputFolder);
        console.log('   运行模式:', resizeConfig.browserMode);
        console.log('   处理方式: 单页顺序生成，每张输入图保存4张');

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

            const imageFiles = listImageFilesInFolder(inputFolder);
            if (imageFiles.length === 0) {
                return res.json({
                    success: false,
                    message: '输入文件夹中没有找到图片'
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

            logger.system('即梦 AI 改尺寸使用独立浏览器会话，可与 Legil 量产/创意拓展同时运行。');
            const result = jimengBrowserService.startResizeBatch(resizeConfig, imageFiles);
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
