/**
 * 创意拓展 Agent 的表格解析、运行、查询和下载接口。
 */
module.exports = function registerCreativeAgentRoutes(app, context) {
    const __dirname = context.rootDir;
    const {
        buildCreativeAgentQualityReport,
        cancelCreativeAgentTask,
        CREATIVE_AGENT_OUTPUT_DIR,
        fs,
        getCreativeAgentStatus,
        getCreativeAgentTask,
        getStoredWinkyConfig,
        logger,
        parseCreativePromptWorkbook,
        path,
        publicCreativeAgentTask,
        startCreativeAgentTask
    } = context;



    app.post('/api/creative/parse-table', (req, res) => {
        const { fileName, fileContentBase64 } = req.body || {};

        try {
            const parsed = parseCreativePromptWorkbook(fileName, fileContentBase64);
            const qualityReport = buildCreativeAgentQualityReport(parsed.prompts);
            res.json({
                success: true,
                ...parsed,
                qualityReport,
                count: parsed.prompts.length,
                message: `成功提取 ${parsed.prompts.length} 组画面提示词`
            });
        } catch (error) {
            res.json({
                success: false,
                prompts: [],
                count: 0,
                message: error.message
            });
        }
    });



    app.get('/api/creative-agent/status', (req, res) => {
        res.json(getCreativeAgentStatus());
    });



    app.post('/api/creative-agent/run', async (req, res) => {
        const body = req.body || {};
        const storedWinkyConfig = getStoredWinkyConfig();
        const instruction = typeof body.instruction === 'string' ? body.instruction.trim() : '';
        const apiKey = String(body.apiKey || storedWinkyConfig.apiKey || '').trim();
        const apiUrl = String(body.apiUrl || storedWinkyConfig.apiUrl || '').trim();
        const model = String(body.model || storedWinkyConfig.model || '').trim();
        const provider = String(body.provider || storedWinkyConfig.provider || '').trim();
        const targetCount = Number.isFinite(Number(body.targetCount)) && Number(body.targetCount) > 0
            ? Math.floor(Number(body.targetCount))
            : null;
        const attachments = Array.isArray(body.attachments) ? body.attachments : [];

        if (!apiKey) {
            return res.status(400).json({
                success: false,
                message: '请填写 Lumos Winky API Key，或在服务器环境变量中设置 WINKY_API_KEY'
            });
        }

        if (!apiUrl) {
            return res.status(400).json({
                success: false,
                message: '请填写 Lumos Winky API URL，或在服务器环境变量中设置 WINKY_API_BASE_URL'
            });
        }

        if (!model) {
            return res.status(400).json({
                success: false,
                message: '请填写要调用的模型名称，或在服务器环境变量中设置 WINKY_MODEL'
            });
        }

        if (!instruction && attachments.length === 0) {
            return res.status(400).json({
                success: false,
                message: '请填写文字指令，或上传表格、图片、文件夹素材'
            });
        }

        try {
            new URL(apiUrl);
        } catch {
            return res.status(400).json({
                success: false,
                message: 'Lumos Winky API URL 格式不正确，请填写完整的接口地址'
            });
        }

        try {
            logger.system('开始调用创意拓展 Agent');
            logger.info(`创意拓展 Agent 附件数量: ${attachments.length}`);

            const task = startCreativeAgentTask({
                apiUrl,
                apiKey,
                model,
                provider,
                instruction,
                targetCount,
                attachments
            });

            res.json({
                success: true,
                runId: task.runId,
                task: publicCreativeAgentTask(task),
                message: '创意拓展 Agent 已启动，请等待任务完成'
            });
        } catch (error) {
            const safeMessage = String(error && error.message ? error.message : error || '未知错误').replaceAll(apiKey, '[REDACTED]');
            logger.error(`创意拓展 Agent 启动失败: ${safeMessage}`);
            res.status(500).json({
                success: false,
                message: '创意拓展 Agent 启动失败: ' + safeMessage
            });
        }
    });



    app.get('/api/creative-agent/task-status/:runId', (req, res) => {
        const task = getCreativeAgentTask(req.params.runId);
        if (!task) {
            return res.status(404).json({
                success: false,
                message: '创意拓展 Agent 任务不存在或已过期'
            });
        }

        res.json({
            success: true,
            task: publicCreativeAgentTask(task)
        });
    });



    app.get('/api/creative-agent/result/:runId', (req, res) => {
        const task = getCreativeAgentTask(req.params.runId);
        if (!task) {
            return res.status(404).json({
                success: false,
                message: '创意拓展 Agent 任务不存在或已过期'
            });
        }

        if (task.phase !== 'completed') {
            return res.json({
                success: false,
                task: publicCreativeAgentTask(task),
                message: task.error || task.message || '创意拓展 Agent 任务尚未完成'
            });
        }

        res.json({
            success: true,
            task: publicCreativeAgentTask(task, true),
            ...(task.result || {})
        });
    });



    app.post('/api/creative-agent/cancel/:runId', (req, res) => {
        const result = cancelCreativeAgentTask(getCreativeAgentTask(req.params.runId));
        res.json(result);
    });



    app.get('/api/creative-agent/download/:fileName', (req, res) => {
        const fileName = path.basename(String(req.params.fileName || ''));
        const outputRoot = path.resolve(CREATIVE_AGENT_OUTPUT_DIR);
        const filePath = path.resolve(CREATIVE_AGENT_OUTPUT_DIR, fileName);

        if (!fileName || !filePath.startsWith(outputRoot + path.sep)) {
            return res.status(400).json({
                success: false,
                message: '文件名不正确'
            });
        }

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({
                success: false,
                message: '表格文件不存在或已被清理'
            });
        }

        res.download(filePath, fileName);
    });
};
