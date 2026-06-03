/**
 * Historical /api/doubao routes.
 *
 * The route names remain for frontend and workflow compatibility, but the
 * underlying prompt generation now routes through Lumos Winky.
 */
module.exports = function registerDoubaoRoutes(app, context) {
    const {
        doubaoAutomation,
        fs,
        normalizeInputPath,
        workflowController
    } = context;

    app.post('/api/doubao/full-automation', async (req, res) => {
        const { imagePath } = req.body || {};

        if (typeof imagePath !== 'string' || !imagePath.trim()) {
            return res.json({
                success: false,
                response: null,
                prompts: [],
                message: '请提供图片路径'
            });
        }

        if (workflowController.isRunning) {
            return res.json({
                success: false,
                response: null,
                prompts: [],
                message: '工作流正在运行中，请稍后再单独运行提示词生成'
            });
        }

        const normalizedImagePath = normalizeInputPath(imagePath);
        if (!fs.existsSync(normalizedImagePath)) {
            return res.json({
                success: false,
                response: null,
                prompts: [],
                message: `图片文件不存在: ${normalizedImagePath}`
            });
        }

        try {
            const result = await doubaoAutomation.fullAutomation(normalizedImagePath);
            res.json(result);
        } catch (error) {
            res.json({
                success: false,
                response: null,
                prompts: [],
                message: `服务器错误: ${error.message}`
            });
        }
    });

    app.get('/api/doubao/extracted-prompts', (req, res) => {
        const prompts = doubaoAutomation.getLastExtractedPrompts();

        if (prompts) {
            return res.json({
                success: true,
                prompts,
                message: `获取到 ${prompts.length} 组提示词`
            });
        }

        return res.json({
            success: false,
            prompts: [],
            message: '尚未提取提示词，请先运行完整流程'
        });
    });

    app.post('/api/doubao/upload-and-prompt', async (req, res) => {
        const { imagePath } = req.body || {};

        if (typeof imagePath !== 'string' || !imagePath.trim()) {
            return res.json({
                success: false,
                response: null,
                message: '请提供图片路径'
            });
        }

        if (workflowController.isRunning) {
            return res.json({
                success: false,
                response: null,
                message: '工作流正在运行中，请稍后再单独运行提示词生成'
            });
        }

        const normalizedImagePath = normalizeInputPath(imagePath);
        if (!fs.existsSync(normalizedImagePath)) {
            return res.json({
                success: false,
                response: null,
                message: '图片文件不存在'
            });
        }

        try {
            const result = await doubaoAutomation.uploadAndPrompt(normalizedImagePath);
            res.json(result);
        } catch (error) {
            res.json({
                success: false,
                response: null,
                message: `服务器错误: ${error.message}`
            });
        }
    });
};
