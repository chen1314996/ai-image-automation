/**
 * 完整自动化工作流的启动、停止、续跑和状态接口。
 */
module.exports = function registerWorkflowRoutes(app, context) {
    const __dirname = context.rootDir;
    const {
        appConfig,
        automationState,
        compactProgress,
        doubaoAutomation,
        getHealthSnapshot,
        getLegilRecoveryOptions,
        legilAutomation,
        logger,
        normalizeLegilGenerationSettings,
        normalizeWorkflowConfigPayload,
        notifyTaskEvent,
        notifyWorkflowResult,
        persistRuntimeConfig,
        workflowController
    } = context;



    /**
     * ============================================
     * 第九阶段：完整工作流 API 接口
     * ============================================
     *
     * 请求方法：POST
     * 请求路径：/api/workflow/start
     * 请求参数：{ inputFolder: "输入文件夹路径", outputFolder: "输出文件夹路径" }
     * 返回数据：{ success: true/false, message: "提示信息", stats: {...} }
     */
    app.post('/api/workflow/start', async (req, res) => {
        const body = req.body || {};
        const { inputFolder, outputFolder, legilReferenceFolder } = body;
        const workflowConfig = normalizeWorkflowConfigPayload(body);
        const workflowGenerationSettings = normalizeLegilGenerationSettings(
            body && typeof body.generationSettings === 'object' ? body.generationSettings : workflowConfig.generationSettings,
            workflowConfig.generationSettings || legilAutomation.getConfig().settings
        );

        console.log('\n🔄 收到完整工作流启动请求（第九阶段）');
        console.log('   输入文件夹:', inputFolder || '使用默认路径');
        console.log('   输出文件夹:', outputFolder || '使用默认路径');
        console.log('   Legil参考图文件夹:', legilReferenceFolder || appConfig.legilReferenceFolder || '使用默认路径');
        console.log('   运行模式:', workflowConfig.browserMode);
        logger.system('收到完整工作流启动请求，正在校验文件夹和配置...');

        if (automationState.legilTaskRunning) {
            logger.warn('工作流启动失败：当前已有 Legil 生成任务正在运行');
            return res.json({
                success: false,
                message: '当前已有 Legil 生成任务正在运行，请稍后再启动工作流'
            });
        }

        const legilRefFolder = legilReferenceFolder || appConfig.legilReferenceFolder;
        const validation = workflowController.validateStart(inputFolder, outputFolder, legilRefFolder);
        if (!validation.success) {
            logger.error(`工作流启动失败：${validation.message}`);
            return res.json({
                success: false,
                message: validation.message
            });
        }

        const doubaoConfig = doubaoAutomation.getConfig();
        if (!doubaoConfig.apiKeyConfigured || !doubaoConfig.modelId) {
            logger.error('工作流启动失败：豆包 API Key 或模型 ID 未配置');
            return res.json({
                success: false,
                message: '请先在豆包API配置中填写火山方舟 API Key 和模型 ID / Endpoint ID'
            });
        }

        appConfig.workflow = workflowConfig;
        persistRuntimeConfig({ workflow: appConfig.workflow });

        // 先返回接受请求的消息
        res.json({
            success: true,
            message: `工作流已启动，将处理 ${validation.totalImages} 张参考图，请在日志中查看进度`,
            totalImages: validation.totalImages
        });
        logger.system(`工作流启动请求已通过校验，将处理 ${validation.totalImages} 张参考图`);

        // 在后台执行工作流（不阻塞响应）
        (async () => {
            try {
                // 使用配置的Legil参考图文件夹
                const result = await workflowController.startWorkflow(
                    validation.inputFolder,
                    validation.outputFolder,
                    validation.legilReferenceFolder,
                    {
                        browserMode: workflowConfig.browserMode,
                        generationSettings: workflowGenerationSettings,
                        ...getLegilRecoveryOptions()
                    }
                );
                if (result.success) {
                    console.log('\n✅ 工作流执行结果:', result.message);
                } else {
                    console.log('\n⚠️ 工作流执行结果:', result.message);
                    logger.warn('工作流未完成: ' + result.message);
                }
                notifyWorkflowResult(result, { source: '网页端启动' });
            } catch (error) {
                console.error('\n❌ 工作流执行出错:', error.message);
                logger.error('工作流执行出错: ' + error.message);
                notifyTaskEvent({
                    level: 'error',
                    title: '工作流执行出错',
                    taskType: '量产工作流',
                    progress: compactProgress(getHealthSnapshot()),
                    message: error.message,
                    suggestion: '可发送“进度”查看详情；如有可恢复任务，可发送“继续任务”。'
                }, {
                    key: `workflow-throw:${error.message}`,
                    cooldownMs: 0
                });
            }
        })();
    });



    /**
     * ============================================
     * 第九阶段：获取工作流状态
     * ============================================
     */
    app.get('/api/workflow/status', (req, res) => {
        const status = workflowController.getStatus();

        res.json({
            success: true,
            status: status,
            message: status.isRunning ? '工作流运行中' : '工作流未运行'
        });
    });



    app.get('/api/workflow/resume-info', (req, res) => {
        const resumeInfo = workflowController.getResumeInfo();
        res.json({
            success: true,
            resume: resumeInfo
        });
    });



    app.post('/api/workflow/resume', async (req, res) => {
        console.log('\n↩️ 收到继续上次工作流请求');

        if (automationState.legilTaskRunning) {
            return res.json({
                success: false,
                message: '当前已有 Legil 生成任务正在运行，请稍后再继续工作流'
            });
        }

        const resumeInfo = workflowController.getResumeInfo();
        if (!resumeInfo.hasResume) {
            return res.json({
                success: false,
                message: '没有可继续的上次任务'
            });
        }

        const doubaoConfig = doubaoAutomation.getConfig();
        if (!doubaoConfig.apiKeyConfigured || !doubaoConfig.modelId) {
            return res.json({
                success: false,
                message: '请先在豆包API配置中填写火山方舟 API Key 和模型 ID / Endpoint ID'
            });
        }

        res.json({
            success: true,
            message: `已继续上次任务：第 ${resumeInfo.imageIndex}/${resumeInfo.totalImages} 张参考图，从提示词 ${resumeInfo.promptIndex}/${resumeInfo.totalPrompts} 开始`,
            resume: resumeInfo
        });

        (async () => {
            try {
                const result = await workflowController.resumeWorkflow(getLegilRecoveryOptions());
                if (result.success) {
                    console.log('\n✅ 继续工作流执行结果:', result.message);
                } else {
                    console.log('\n⚠️ 继续工作流执行结果:', result.message);
                    logger.warn('继续工作流未完成: ' + result.message);
                }
                notifyWorkflowResult(result, { source: '继续任务' });
            } catch (error) {
                console.error('\n❌ 继续工作流执行出错:', error.message);
                logger.error('继续工作流执行出错: ' + error.message);
                notifyTaskEvent({
                    level: 'error',
                    title: '继续工作流出错',
                    taskType: '量产工作流',
                    progress: compactProgress(getHealthSnapshot()),
                    message: error.message,
                    suggestion: '可发送“进度”查看详情。'
                }, {
                    key: `workflow-resume-throw:${error.message}`,
                    cooldownMs: 0
                });
            }
        })();
    });



    app.post('/api/workflow/clear-resume', (req, res) => {
        workflowController.clearResume();
        res.json({
            success: true,
            message: '已清除上次任务记录'
        });
    });



    /**
     * ============================================
     * 获取工作流最近一次提取的提示词
     * ============================================
     */
    app.get('/api/workflow/extracted-prompts', (req, res) => {
        const prompts = workflowController.getLastExtractedPrompts();

        if (prompts) {
            res.json({
                success: true,
                prompts: prompts,
                message: `获取到 ${prompts.length} 组提示词`
            });
        } else {
            res.json({
                success: false,
                prompts: [],
                message: '尚未提取提示词，请先运行工作流'
            });
        }
    });



    /**
     * ============================================
     * 第九阶段：停止工作流
     * ============================================
     */
    app.post('/api/workflow/stop', async (req, res) => {
        console.log('\n⏹️ 收到停止工作流请求');

        const result = await workflowController.stopWorkflow();
        const resumeInfo = workflowController.getResumeInfo();
        if (result.success) {
            notifyTaskEvent({
                level: 'warning',
                title: '工作流已停止',
                taskType: '量产工作流',
                progress: compactProgress(getHealthSnapshot()),
                message: result.message,
                suggestion: resumeInfo.hasResume ? '已保存可继续任务，可发送“继续任务”。' : '当前没有可继续任务。'
            }, {
                key: `workflow-stop:${Date.now()}`,
                cooldownMs: 0
            });
        }

        res.json({
            success: result.success,
            message: result.message,
            resume: resumeInfo
        });
    });
};
