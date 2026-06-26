const { createBatchRetouchController } = require('../services/batch-retouch-controller');

module.exports = function registerBatchRetouchRoutes(app, context) {
    const {
        appConfig,
        getLegilRecoveryOptions,
        logger,
        persistRuntimeConfig
    } = context;

    const controller = createBatchRetouchController(context);

    app.get('/api/batch-retouch/config', (req, res) => {
        try {
            res.json({
                success: true,
                config: controller.getPublicConfig(),
                message: '获取批量修图配置成功'
            });
        } catch (error) {
            res.json({
                success: false,
                message: error.message
            });
        }
    });

    app.post('/api/batch-retouch/config', (req, res) => {
        try {
            const config = controller.updateConfig(req.body || {});
            persistRuntimeConfig({ batchRetouch: appConfig.batchRetouch });
            res.json({
                success: true,
                config,
                message: '批量修图配置已保存'
            });
        } catch (error) {
            res.json({
                success: false,
                message: '保存批量修图配置失败: ' + error.message
            });
        }
    });

    app.post('/api/batch-retouch/scan', (req, res) => {
        try {
            const scan = controller.scan(req.body || {});
            res.json({
                ...scan,
                ready: scan.success,
                success: true,
                inputImages: undefined,
                styleReferenceImages: undefined,
                usedStyleReferenceImages: undefined
            });
        } catch (error) {
            res.json({
                success: false,
                message: error.message
            });
        }
    });

    app.post('/api/batch-retouch/start', async (req, res) => {
        try {
            const result = await controller.start(req.body || {}, getLegilRecoveryOptions());
            if (result.success) {
                logger.system(`批量修图启动请求已接受：${result.message}`);
            }
            res.json(result);
        } catch (error) {
            res.json({
                success: false,
                message: '启动批量修图失败: ' + error.message
            });
        }
    });

    app.get('/api/batch-retouch/status', (req, res) => {
        res.json({
            success: true,
            status: controller.getStatus()
        });
    });

    app.post('/api/batch-retouch/stop', (req, res) => {
        res.json(controller.stop());
    });

    app.get('/api/batch-retouch/resume-info', (req, res) => {
        res.json({
            success: true,
            resume: controller.getResumeInfo()
        });
    });

    app.post('/api/batch-retouch/resume', async (req, res) => {
        try {
            const result = await controller.resume(getLegilRecoveryOptions());
            res.json(result);
        } catch (error) {
            res.json({
                success: false,
                message: '继续批量修图失败: ' + error.message
            });
        }
    });

    app.post('/api/batch-retouch/clear-resume', (req, res) => {
        controller.clearResume();
        res.json({
            success: true,
            message: '已清除批量修图续跑记录'
        });
    });
};
