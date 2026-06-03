const {
    createMaterialAnalysisService,
    createMaterialKnowledgeCollectorService
} = require('../services/material-analysis');
const { createMaterialVisionService } = require('../services/material-analysis/vision');
const { createMaterialReportService } = require('../services/material-analysis/report-builder');
const { createMaterialCreativeBriefService } = require('../services/material-analysis/creative-brief');
const { createMaterialCreativeExpansionService } = require('../services/material-analysis/creative-expansion');
const { MaterialImageFetcher } = require('../services/material-analysis/vision/image-fetcher');

module.exports = function registerMaterialAnalysisRoutes(app, context) {
    const service = createMaterialAnalysisService(context);
    const visionService = createMaterialVisionService(context);
    const reportService = createMaterialReportService(context);
    const creativeBriefService = createMaterialCreativeBriefService(context);
    const creativeExpansionService = createMaterialCreativeExpansionService(context);
    const knowledgeCollectorService = createMaterialKnowledgeCollectorService(context);
    const imageFetcher = new MaterialImageFetcher();

    function sendCollectKnowledgeError(res, error, fallbackMessage) {
        const status = error && error.needsConfirmation ? 409 : 400;
        return res.status(status).json({
            success: false,
            needsConfirmation: Boolean(error && error.needsConfirmation),
            message: `${fallbackMessage}：${error.message}`
        });
    }

    app.post('/api/material-analysis/import', (req, res) => {
        try {
            res.json(service.importTable(req.body || {}));
        } catch (error) {
            res.status(400).json({
                success: false,
                message: '导入素材分析数据失败：' + error.message
            });
        }
    });

    app.get('/api/material-analysis/imports', (req, res) => {
        try {
            res.json(service.listImports());
        } catch (error) {
            res.status(500).json({
                success: false,
                message: '读取素材分析导入记录失败：' + error.message
            });
        }
    });

    app.delete('/api/material-analysis/imports/:runId', (req, res) => {
        try {
            const result = service.deleteImport(req.params.runId);
            if (result.success) {
                try {
                    if (typeof visionService.cancelRun === 'function') {
                        visionService.cancelRun(req.params.runId);
                    }
                } catch (clearError) {
                    // Best effort: deleting the import should still work if there is no vision task.
                }
            }
            res.status(result.success ? 200 : 404).json(result);
        } catch (error) {
            res.status(500).json({
                success: false,
                message: '删除素材分析导入记录失败：' + error.message
            });
        }
    });

    app.get('/api/material-analysis/imports/:runId', (req, res) => {
        try {
            const result = service.getImport(req.params.runId);
            res.status(result.success ? 200 : 404).json(result);
        } catch (error) {
            res.status(500).json({
                success: false,
                message: '读取素材分析详情失败：' + error.message
            });
        }
    });

    app.get('/api/material-analysis/imports/:runId/top100', (req, res) => {
        try {
            const result = service.getTop100(req.params.runId);
            res.status(result.success ? 200 : 404).json(result);
        } catch (error) {
            res.status(500).json({
                success: false,
                message: '读取素材分析 Top100 失败：' + error.message
            });
        }
    });

    app.get('/api/material-analysis/imports/:runId/overview', (req, res) => {
        try {
            const result = service.getOverview(req.params.runId);
            res.status(result.success ? 200 : 404).json(result);
        } catch (error) {
            res.status(500).json({
                success: false,
                message: '读取素材分析健康概览失败：' + error.message
            });
        }
    });

    app.get('/api/material-analysis/imports/:runId/directions', (req, res) => {
        try {
            const result = service.getDirections(req.params.runId);
            res.status(result.success ? 200 : 404).json(result);
        } catch (error) {
            res.status(500).json({
                success: false,
                message: '读取素材分析方向表现失败：' + error.message
            });
        }
    });

    app.post('/api/material-analysis/imports/:runId/vision/start', (req, res) => {
        try {
            const result = visionService.startRun(req.params.runId, req.body || {});
            res.status(result.success ? 200 : 400).json(result);
        } catch (error) {
            res.status(400).json({
                success: false,
                message: '启动素材视觉识别失败：' + error.message
            });
        }
    });

    app.get('/api/material-analysis/imports/:runId/vision/status', (req, res) => {
        try {
            res.json(visionService.getStatus(req.params.runId));
        } catch (error) {
            res.status(500).json({
                success: false,
                message: '读取素材视觉识别进度失败：' + error.message
            });
        }
    });

    app.get('/api/material-analysis/imports/:runId/vision/results', (req, res) => {
        try {
            res.json(visionService.getResults(req.params.runId));
        } catch (error) {
            res.status(500).json({
                success: false,
                message: '读取素材视觉识别结果失败：' + error.message
            });
        }
    });

    app.post('/api/material-analysis/imports/:runId/vision/clear', (req, res) => {
        try {
            const result = visionService.clearRun(req.params.runId);
            res.json(result);
        } catch (error) {
            res.status(400).json({
                success: false,
                message: '清除素材视觉识别任务失败：' + error.message
            });
        }
    });

    app.post('/api/material-analysis/imports/:runId/reports/generate', (req, res) => {
        try {
            const result = reportService.generate(req.params.runId);
            res.status(result.success ? 200 : 400).json(result);
        } catch (error) {
            res.status(400).json({
                success: false,
                message: '生成素材分析报告失败：' + error.message
            });
        }
    });

    app.get('/api/material-analysis/imports/:runId/reports', (req, res) => {
        try {
            const result = reportService.getReports(req.params.runId);
            res.status(result.success ? 200 : 404).json(result);
        } catch (error) {
            res.status(500).json({
                success: false,
                message: '读取素材分析报告失败：' + error.message
            });
        }
    });

    app.post('/api/material-analysis/imports/:runId/reports/open', (req, res) => {
        try {
            const result = reportService.openReport(req.params.runId, req.body && req.body.type);
            res.status(result.success ? 200 : 400).json(result);
        } catch (error) {
            res.status(400).json({
                success: false,
                message: '打开素材分析报告位置失败：' + error.message
            });
        }
    });

    app.post('/api/material-analysis/materials/:materialId/creative-brief', (req, res) => {
        try {
            const result = creativeBriefService.createMaterialBrief(req.params.materialId, {
                ...(req.body || {}),
                runId: (req.body && req.body.runId) || req.query.runId
            });
            res.status(result.success ? 200 : 404).json(result);
        } catch (error) {
            res.status(400).json({
                success: false,
                message: '生成单素材创意拓展 brief 失败：' + error.message
            });
        }
    });

    app.post('/api/material-analysis/directions/:directionKey/creative-brief', (req, res) => {
        try {
            const result = creativeBriefService.createDirectionBrief(req.params.directionKey, {
                ...(req.body || {}),
                runId: (req.body && req.body.runId) || req.query.runId
            });
            res.status(result.success ? 200 : 404).json(result);
        } catch (error) {
            res.status(400).json({
                success: false,
                message: '生成方向级创意拓展 brief 失败：' + error.message
            });
        }
    });

    app.post('/api/material-analysis/imports/:runId/creative-plan', (req, res) => {
        try {
            const result = creativeBriefService.createCreativePlan(req.params.runId, req.body || {});
            res.status(result.success ? 200 : 404).json(result);
        } catch (error) {
            res.status(400).json({
                success: false,
                message: '生成下周创意拓展计划失败：' + error.message
            });
        }
    });

    app.get('/api/material-analysis/imports/:runId/creative-targets', (req, res) => {
        try {
            const result = creativeExpansionService.getCreativeTargets(req.params.runId, {
                defaultPromptGroupsPerNewDirection: req.query.defaultPromptGroupsPerNewDirection
            });
            res.status(result.success ? 200 : 404).json(result);
        } catch (error) {
            res.status(500).json({
                success: false,
                message: '读取 TOP100 创意拓展方向失败：' + error.message
            });
        }
    });

    app.get('/api/material-analysis/creative-expansions', (req, res) => {
        try {
            res.json(creativeExpansionService.listPromptPools());
        } catch (error) {
            res.status(500).json({
                success: false,
                message: '读取创意提示词池失败：' + error.message
            });
        }
    });

    app.post('/api/material-analysis/imports/:runId/creative-expansion', async (req, res) => {
        try {
            const result = await creativeExpansionService.createPromptPool(req.params.runId, req.body || {});
            res.status(result.success ? 200 : 400).json(result);
        } catch (error) {
            res.status(400).json({
                success: false,
                message: '生成 TOP100 拓展提示词池失败：' + error.message
            });
        }
    });

    app.get('/api/material-analysis/learnings', (req, res) => {
        try {
            res.json(knowledgeCollectorService.listLearnings(req.query || {}));
        } catch (error) {
            res.status(500).json({
                success: false,
                message: '读取素材分析经验失败：' + error.message
            });
        }
    });

    app.post('/api/material-analysis/materials/:materialId/collect-knowledge', (req, res) => {
        try {
            const result = knowledgeCollectorService.collectMaterial(req.params.materialId, {
                ...(req.body || {}),
                runId: (req.body && req.body.runId) || req.query.runId
            });
            res.status(result.success ? 200 : 404).json(result);
        } catch (error) {
            sendCollectKnowledgeError(res, error, '收录素材到创意知识库失败');
        }
    });

    app.post('/api/material-analysis/directions/:directionKey/collect-knowledge', (req, res) => {
        try {
            const result = knowledgeCollectorService.collectDirection(req.params.directionKey, {
                ...(req.body || {}),
                runId: (req.body && req.body.runId) || req.query.runId
            });
            res.status(result.success ? 200 : 404).json(result);
        } catch (error) {
            sendCollectKnowledgeError(res, error, '收录方向到创意知识库失败');
        }
    });

    app.post('/api/material-analysis/imports/:runId/collect-weekly-learnings', (req, res) => {
        try {
            const result = knowledgeCollectorService.collectWeeklyLearnings(req.params.runId, req.body || {});
            res.status(result.success ? 200 : 400).json(result);
        } catch (error) {
            sendCollectKnowledgeError(res, error, '沉淀本周素材分析经验失败');
        }
    });

    app.post('/api/material-analysis/learnings/:learningId/create-direction-draft', (req, res) => {
        try {
            const result = knowledgeCollectorService.createDirectionDraftFromLearning(req.params.learningId, req.body || {});
            res.status(result.success ? 200 : 404).json(result);
        } catch (error) {
            sendCollectKnowledgeError(res, error, '转为方向草案失败');
        }
    });

    app.post('/api/material-analysis/materials/:materialId/create-direction-draft', (req, res) => {
        try {
            const result = knowledgeCollectorService.createMaterialDirectionDraft(req.params.materialId, {
                ...(req.body || {}),
                runId: (req.body && req.body.runId) || req.query.runId
            });
            res.status(result.success ? 200 : 404).json(result);
        } catch (error) {
            sendCollectKnowledgeError(res, error, '素材转为方向草案失败');
        }
    });

    app.post('/api/material-analysis/directions/:directionKey/create-direction-draft', (req, res) => {
        try {
            const result = knowledgeCollectorService.createDirectionDraft(req.params.directionKey, {
                ...(req.body || {}),
                runId: (req.body && req.body.runId) || req.query.runId
            });
            res.status(result.success ? 200 : 404).json(result);
        } catch (error) {
            sendCollectKnowledgeError(res, error, '方向转为方向草案失败');
        }
    });

    app.get('/api/material-analysis/creative-expansions/:expansionId', (req, res) => {
        try {
            const result = creativeExpansionService.readPromptPool(req.params.expansionId);
            res.status(result.success ? 200 : 404).json(result);
        } catch (error) {
            res.status(500).json({
                success: false,
                message: '读取创意提示词池失败：' + error.message
            });
        }
    });

    app.post('/api/material-analysis/creative-expansions/:expansionId/export-js', (req, res) => {
        try {
            const result = creativeExpansionService.readPromptPool(req.params.expansionId);
            if (!result.success) {
                return res.status(404).json(result);
            }
            const jsPath = creativeExpansionService.exportJsSnapshot(result.pool);
            return res.json({
                success: true,
                jsPath,
                message: 'JS 快照已导出'
            });
        } catch (error) {
            return res.status(400).json({
                success: false,
                message: '导出创意提示词池 JS 快照失败：' + error.message
            });
        }
    });

    app.post('/api/material-analysis/materials/:materialId/vision/retry', async (req, res) => {
        try {
            const result = await visionService.retryMaterial(req.params.materialId);
            res.status(result.success ? 200 : 400).json(result);
        } catch (error) {
            res.status(400).json({
                success: false,
                message: '重跑单素材视觉识别失败：' + error.message
            });
        }
    });

    app.get('/api/material-analysis/imports/:runId/materials/:materialId', (req, res) => {
        try {
            const result = service.getMaterial(req.params.runId, req.params.materialId);
            res.status(result.success ? 200 : 404).json(result);
        } catch (error) {
            res.status(500).json({
                success: false,
                message: '读取素材分析单素材详情失败：' + error.message
            });
        }
    });

    app.get('/api/material-analysis/imports/:runId/materials/:materialId/image', async (req, res) => {
        try {
            const result = service.getMaterial(req.params.runId, req.params.materialId);
            if (!result.success || !result.material) {
                return res.status(404).send(result.message || '素材不存在');
            }

            const image = await imageFetcher.fetchImage(result.material);
            const match = String(image.dataUrl || '').match(/^data:(image\/[^;]+);base64,(.+)$/i);
            if (!match) {
                return res.status(422).send('图片格式不可预览');
            }

            const buffer = Buffer.from(match[2], 'base64');
            res.setHeader('Content-Type', match[1]);
            res.setHeader('Cache-Control', 'public, max-age=86400');
            res.setHeader('Content-Length', buffer.length);
            return res.end(buffer);
        } catch (error) {
            return res.status(502).send('素材缩略图加载失败：' + error.message);
        }
    });
};
