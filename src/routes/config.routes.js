/**
 * 豆包、Legil、通知、工作流等配置接口。
 */
module.exports = function registerConfigRoutes(app, context) {
    const __dirname = context.rootDir;
    const {
        appConfig,
        applyNotificationRuntimeConfig,
        DEFAULT_CREATIVE_CONFIG,
        DEFAULT_RESIZE_CONFIG,
        doubaoAutomation,
        fs,
        legilAutomation,
        normalizeCreativeConfigPayload,
        normalizeInputPath,
        normalizeNotificationConfig,
        normalizeResizeConfigPayload,
        normalizeWorkflowConfigPayload,
        persistRuntimeConfig
    } = context;



    app.get('/api/config/doubao', (req, res) => {
        res.json({
            success: true,
            config: doubaoAutomation.getConfig()
        });
    });



    app.post('/api/config/doubao', (req, res) => {
        const { apiKey, modelId, baseUrl, promptTemplate, instruction, clearApiKey } = req.body || {};
        const nextPrompt = promptTemplate ?? instruction;

        try {
            const updates = {};

            if (typeof nextPrompt !== 'undefined') {
                if (typeof nextPrompt !== 'string' || !nextPrompt.trim()) {
                    return res.json({
                        success: false,
                        message: '豆包固定指令不能为空'
                    });
                }

                if (nextPrompt.length > 10000) {
                    return res.json({
                        success: false,
                        message: '豆包固定指令过长，请控制在10000字以内'
                    });
                }

                updates.promptTemplate = nextPrompt.trim();
            }

            if (typeof modelId !== 'undefined') {
                if (typeof modelId !== 'string' || !modelId.trim()) {
                    return res.json({
                        success: false,
                        message: '模型 ID / Endpoint ID 不能为空'
                    });
                }
                updates.modelId = modelId.trim();
            }

            if (typeof baseUrl !== 'undefined' && String(baseUrl || '').trim()) {
                updates.baseUrl = String(baseUrl).trim();
            }

            if (typeof apiKey !== 'undefined' && String(apiKey || '').trim()) {
                updates.apiKey = String(apiKey).trim();
            }

            if (clearApiKey === true) {
                updates.clearApiKey = true;
            }

            const config = doubaoAutomation.setConfig(updates);
            persistRuntimeConfig();

            res.json({
                success: true,
                config,
                message: '豆包配置已保存'
            });
        } catch (error) {
            res.json({
                success: false,
                message: error.message
            });
        }
    });



    app.post('/api/config/doubao/reset-prompt', (req, res) => {
        try {
            doubaoAutomation.resetPrompt();
            const config = doubaoAutomation.getConfig();
            persistRuntimeConfig();
            res.json({
                success: true,
                config,
                message: '豆包固定指令已恢复默认'
            });
        } catch (error) {
            res.json({
                success: false,
                message: error.message
            });
        }
    });



    app.get('/api/config/legil-generation', (req, res) => {
        res.json({
            success: true,
            config: legilAutomation.getConfig()
        });
    });



    app.post('/api/config/legil-generation', (req, res) => {
        const { imageModel, aspectRatio, resolution, outputQuantity } = req.body || {};

        try {
            const config = legilAutomation.setGenerationSettings({
                imageModel,
                aspectRatio,
                resolution,
                outputQuantity
            });
            appConfig.workflow = {
                ...appConfig.workflow,
                generationSettings: {
                    ...config.settings
                }
            };
            persistRuntimeConfig();

            res.json({
                success: true,
                config,
                message: 'Legil 生成参数已保存'
            });
        } catch (error) {
            res.json({
                success: false,
                message: error.message
            });
        }
    });



    app.get('/api/config/notifications', (req, res) => {
        appConfig.notifications = normalizeNotificationConfig(appConfig.notifications);
        res.json({
            success: true,
            config: {
                ...appConfig.notifications
            },
            message: '获取通知配置成功'
        });
    });



    app.post('/api/config/notifications', (req, res) => {
        try {
            appConfig.notifications = normalizeNotificationConfig(req.body || {});
            persistRuntimeConfig({ notifications: appConfig.notifications });
            applyNotificationRuntimeConfig();

            res.json({
                success: true,
                config: {
                    ...appConfig.notifications
                },
                message: '通知配置已保存'
            });
        } catch (error) {
            res.json({
                success: false,
                message: '通知配置保存失败：' + error.message
            });
        }
    });



    app.get('/api/config/workflow', (req, res) => {
        appConfig.workflow = normalizeWorkflowConfigPayload(appConfig.workflow);
        res.json({
            success: true,
            config: {
                ...appConfig.workflow
            },
            message: '获取量产配置成功'
        });
    });



    app.post('/api/config/workflow', (req, res) => {
        try {
            appConfig.workflow = normalizeWorkflowConfigPayload(req.body || {});
            persistRuntimeConfig({ workflow: appConfig.workflow });

            res.json({
                success: true,
                config: {
                    ...appConfig.workflow
                },
                message: '量产配置已保存'
            });
        } catch (error) {
            res.json({
                success: false,
                message: '保存量产配置失败: ' + error.message
            });
        }
    });



    app.get('/api/config/resize', (req, res) => {
        const legilConfig = legilAutomation.getConfig();
        appConfig.resize = normalizeResizeConfigPayload(appConfig.resize);

        res.json({
            success: true,
            config: {
                ...appConfig.resize,
                generationSettings: {
                    ...appConfig.resize.generationSettings
                },
                defaultGenerationSettings: {
                    ...DEFAULT_RESIZE_CONFIG.generationSettings
                },
                generationOptions: {
                    ...(legilConfig.options || {})
                }
            },
            message: '获取改尺寸配置成功'
        });
    });



    app.post('/api/config/resize', (req, res) => {
        try {
            appConfig.resize = normalizeResizeConfigPayload(req.body || {});
            persistRuntimeConfig({ resize: appConfig.resize });

            res.json({
                success: true,
                config: {
                    ...appConfig.resize,
                    generationSettings: {
                        ...appConfig.resize.generationSettings
                    }
                },
                message: '改尺寸配置已保存'
            });
        } catch (error) {
            res.json({
                success: false,
                message: '保存改尺寸配置失败: ' + error.message
            });
        }
    });



    app.get('/api/config/creative', (req, res) => {
        const legilConfig = legilAutomation.getConfig();
        appConfig.creative = normalizeCreativeConfigPayload(appConfig.creative);

        res.json({
            success: true,
            config: {
                ...appConfig.creative,
                generationSettings: {
                    ...appConfig.creative.generationSettings
                },
                defaultGenerationSettings: {
                    ...DEFAULT_CREATIVE_CONFIG.generationSettings
                },
                generationOptions: {
                    ...(legilConfig.options || {})
                }
            },
            message: '获取创意拓展配置成功'
        });
    });



    app.post('/api/config/creative', (req, res) => {
        try {
            appConfig.creative = normalizeCreativeConfigPayload(req.body || {});
            persistRuntimeConfig({ creative: appConfig.creative });

            res.json({
                success: true,
                config: {
                    ...appConfig.creative,
                    generationSettings: {
                        ...appConfig.creative.generationSettings
                    }
                },
                message: '创意拓展配置已保存'
            });
        } catch (error) {
            res.json({
                success: false,
                message: '保存创意拓展配置失败: ' + error.message
            });
        }
    });



    /**
     * ============================================
     * 新增 API：保存 Legil 参考图文件夹配置
     * ============================================
     */
    app.post('/api/config/legil-ref-folder', (req, res) => {
        const { folderPath } = req.body;

        console.log('\n📁 收到 Legil 参考图文件夹配置');
        console.log('   路径:', folderPath);

        if (typeof folderPath !== 'string' || !folderPath.trim()) {
            return res.json({
                success: false,
                message: '请提供文件夹路径'
            });
        }

        // 验证路径是否存在
        try {
            const normalizedFolderPath = normalizeInputPath(folderPath);

            if (!fs.existsSync(normalizedFolderPath)) {
                return res.json({
                    success: false,
                    message: '路径不存在，请检查路径是否正确'
                });
            }

            const stats = fs.statSync(normalizedFolderPath);
            if (!stats.isDirectory()) {
                return res.json({
                    success: false,
                    message: '提供的路径不是文件夹'
                });
            }

            // 保存配置
            appConfig.legilReferenceFolder = normalizedFolderPath;
            persistRuntimeConfig({ legilReferenceFolder: normalizedFolderPath });
            console.log('   ✅ 配置已保存');

            // 同时更新 legil 自动化模块的配置
            legilAutomation.setReferenceFolder(normalizedFolderPath);

            res.json({
                success: true,
                message: '配置已保存',
                folderPath: normalizedFolderPath
            });

        } catch (error) {
            console.error('   ❌ 保存配置失败:', error.message);
            res.json({
                success: false,
                message: '保存配置失败: ' + error.message
            });
        }
    });



    /**
     * ============================================
     * 新增 API：获取 Legil 参考图文件夹配置
     * ============================================
     */
    app.get('/api/config/legil-ref-folder', (req, res) => {
        res.json({
            success: true,
            folderPath: appConfig.legilReferenceFolder,
            message: '获取配置成功'
        });
    });
};
