const { createTaskWorkbookService } = require('../services/task-workbook');

module.exports = function registerTaskWorkbookRoutes(app, context) {
    const service = createTaskWorkbookService(context);

    app.post('/api/task-workbooks/import', (req, res) => {
        try {
            const result = service.importWorkbook(req.body || {});
            res.status(201).json(result);
        } catch (error) {
            res.status(400).json({
                success: false,
                message: '导入自动化任务表失败：' + error.message
            });
        }
    });

    app.get('/api/task-workbooks/imports', (req, res) => {
        try {
            res.json(service.listImports());
        } catch (error) {
            res.status(500).json({
                success: false,
                message: '读取任务表导入记录失败：' + error.message
            });
        }
    });

    app.get('/api/task-workbooks/imports/:importId', (req, res) => {
        try {
            const result = service.getImport(req.params.importId);
            res.status(result.success ? 200 : 404).json(result);
        } catch (error) {
            res.status(404).json({
                success: false,
                message: '读取任务方向池失败：' + error.message
            });
        }
    });

    app.delete('/api/task-workbooks/imports/:importId', (req, res) => {
        try {
            const result = service.deleteImport(req.params.importId);
            res.status(result.success ? 200 : 404).json(result);
        } catch (error) {
            res.status(500).json({
                success: false,
                message: '删除任务表导入记录失败：' + error.message
            });
        }
    });

    app.get('/api/task-workbooks/imports/:importId/images/:fileName', (req, res) => {
        try {
            const image = service.getImage(req.params.importId, req.params.fileName);
            if (!image) {
                return res.status(404).send('图片不存在');
            }
            res.setHeader('Content-Type', image.mimeType);
            res.setHeader('Cache-Control', 'public, max-age=86400');
            return res.sendFile(image.filePath);
        } catch (error) {
            return res.status(500).send('读取任务表参考图失败：' + error.message);
        }
    });

    app.post('/api/task-workbooks/imports/:importId/vision/start', (req, res) => {
        try {
            const result = service.vision.start(req.params.importId, req.body || {});
            res.status(result.success ? 202 : 400).json(result);
        } catch (error) {
            res.status(400).json({
                success: false,
                message: '启动任务方向视觉整理失败：' + error.message
            });
        }
    });

    app.post('/api/task-workbooks/imports/:importId/vision/pause', (req, res) => {
        try {
            res.json(service.vision.pause(req.params.importId));
        } catch (error) {
            res.status(400).json({
                success: false,
                message: '暂停任务方向视觉整理失败：' + error.message
            });
        }
    });

    app.post('/api/task-workbooks/imports/:importId/vision/resume', (req, res) => {
        try {
            const result = service.vision.resume(req.params.importId, req.body || {});
            res.status(result.success ? 202 : 400).json(result);
        } catch (error) {
            res.status(400).json({
                success: false,
                message: '继续任务方向视觉整理失败：' + error.message
            });
        }
    });

    app.get('/api/task-workbooks/imports/:importId/vision/status', (req, res) => {
        try {
            res.json(service.vision.getStatus(req.params.importId));
        } catch (error) {
            res.status(500).json({
                success: false,
                message: '读取任务方向视觉整理状态失败：' + error.message
            });
        }
    });

    app.get('/api/task-workbooks/imports/:importId/vision/results', (req, res) => {
        try {
            res.json(service.vision.getResults(req.params.importId));
        } catch (error) {
            res.status(500).json({
                success: false,
                message: '读取任务方向视觉整理结果失败：' + error.message
            });
        }
    });

    app.post('/api/task-workbooks/imports/:importId/directions/:taskDirectionId/vision/retry', async (req, res) => {
        try {
            const result = await service.vision.retry(req.params.importId, req.params.taskDirectionId);
            res.status(result.success ? 200 : 400).json(result);
        } catch (error) {
            res.status(400).json({
                success: false,
                message: '重试任务方向视觉整理失败：' + error.message
            });
        }
    });
};
