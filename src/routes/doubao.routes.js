/**
 * 豆包提示词生成和最近提示词读取接口。
 */
module.exports = function registerDoubaoRoutes(app, context) {
    const __dirname = context.rootDir;
    const {
        doubaoAutomation,
        fs,
        normalizeInputPath,
        workflowController
    } = context;



    /**
     * ============================================
     * 第六阶段：完整自动化流程 API 接口
     * ============================================
     *
     * 请求方法：POST
     * 请求路径：/api/doubao/full-automation
     * 请求参数：{ imagePath: "图片路径" }
     * 返回数据：{ success: true/false, response: "豆包回复", prompts: [...], message: "提示信息" }
     */
    app.post('/api/doubao/full-automation', async (req, res) => {
        const { imagePath } = req.body;

        console.log('\n🤖 收到完整自动化流程请求（第六阶段）');
        console.log('   图片路径:', imagePath);

        // 验证参数
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
                message: '工作流正在运行中，请稍后再单独运行豆包自动化'
            });
        }

        // 规范化路径并验证文件是否存在
        const normalizedImagePath = normalizeInputPath(imagePath);
        if (!fs.existsSync(normalizedImagePath)) {
            return res.json({
                success: false,
                response: null,
                prompts: [],
                message: '图片文件不存在: ' + normalizedImagePath
            });
        }

        try {
            // 调用豆包完整自动化流程（上传+获取+提取）
            const result = await doubaoAutomation.fullAutomation(normalizedImagePath);
            res.json(result);

        } catch (error) {
            console.error('完整自动化流程出错:', error);
            res.json({
                success: false,
                response: null,
                prompts: [],
                message: '服务器错误：' + error.message
            });
        }
    });



    /**
     * ============================================
     * 第六阶段：获取已提取的提示词
     * ============================================
     */
    app.get('/api/doubao/extracted-prompts', (req, res) => {
        const prompts = doubaoAutomation.getLastExtractedPrompts();

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
                message: '尚未提取提示词，请先运行完整流程'
            });
        }
    });



    /**
     * ============================================
     * 第五阶段：豆包自动化 API 接口（基础版，保留兼容）
     * ============================================
     */
    app.post('/api/doubao/upload-and-prompt', async (req, res) => {
        const { imagePath } = req.body;

        console.log('\n🤖 收到豆包自动化请求');
        console.log('   图片路径:', imagePath);

        // 验证参数
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
                message: '工作流正在运行中，请稍后再单独运行豆包自动化'
            });
        }

        // 验证文件是否存在
        const normalizedImagePath = normalizeInputPath(imagePath);
        if (!fs.existsSync(normalizedImagePath)) {
            return res.json({
                success: false,
                response: null,
                message: '图片文件不存在'
            });
        }

        try {
            // 调用豆包自动化模块
            const result = await doubaoAutomation.uploadAndPrompt(normalizedImagePath);
            res.json(result);

        } catch (error) {
            console.error('豆包自动化出错:', error);
            res.json({
                success: false,
                response: null,
                message: '服务器错误：' + error.message
            });
        }
    });
};
