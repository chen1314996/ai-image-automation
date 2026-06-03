const { createCreativeKnowledgeService } = require('../services/creative-knowledge');
const { createFeishuSyncService } = require('../services/creative-knowledge/feishu-sync');
const { createFeishuDirectionSyncService } = require('../services/creative-knowledge/feishu-direction-sync');

/**
 * 创意知识库导入、状态和方向查询接口。
 */
module.exports = function registerCreativeKnowledgeRoutes(app, context) {
    const service = createCreativeKnowledgeService(context);
    const feishuSyncService = createFeishuSyncService(context);
    const feishuDirectionSyncService = createFeishuDirectionSyncService(context);

    app.get('/api/creative-knowledge/status', (req, res) => {
        try {
            res.json(service.getStatus(req.query || {}));
        } catch (error) {
            res.status(500).json({
                success: false,
                message: '获取创意知识库状态失败: ' + error.message
            });
        }
    });

    app.get('/api/creative-knowledge/feishu-sync/status', (req, res) => {
        try {
            res.json(feishuSyncService.getStatus(req.query || {}));
        } catch (error) {
            res.status(500).json({
                success: false,
                message: '获取飞书同步状态失败: ' + error.message
            });
        }
    });

    app.get('/api/creative-knowledge/feishu-sync/config', (req, res) => {
        try {
            res.json(feishuSyncService.getStatus(req.query || {}));
        } catch (error) {
            res.status(500).json({
                success: false,
                message: '读取飞书同步配置失败: ' + error.message
            });
        }
    });

    app.post('/api/creative-knowledge/feishu-sync/config', (req, res) => {
        try {
            res.json({
                success: true,
                message: '飞书只读同步配置已保存',
                config: feishuSyncService.saveConfig(req.body || {})
            });
        } catch (error) {
            res.status(400).json({
                success: false,
                message: '保存飞书同步配置失败: ' + error.message
            });
        }
    });

    app.post('/api/creative-knowledge/feishu-sync/test', async (req, res) => {
        try {
            res.json(await feishuSyncService.testConnection(req.body || {}));
        } catch (error) {
            res.status(500).json({
                success: false,
                message: '测试飞书同步连接失败: ' + error.message
            });
        }
    });

    app.post('/api/creative-knowledge/feishu-sync/preview', async (req, res) => {
        try {
            res.json(await feishuSyncService.preview(req.body || {}));
        } catch (error) {
            res.status(500).json({
                success: false,
                message: '预览飞书同步失败: ' + error.message
            });
        }
    });

    app.post('/api/creative-knowledge/feishu-sync/sync', async (req, res) => {
        try {
            res.json(await feishuSyncService.sync(req.body || {}));
        } catch (error) {
            res.status(500).json({
                success: false,
                message: '执行飞书同步失败: ' + error.message
            });
        }
    });

    app.get('/api/creative-knowledge/operations', (req, res) => {
        try {
            res.json(feishuSyncService.listOperations(req.query || {}));
        } catch (error) {
            res.status(500).json({
                success: false,
                message: '读取知识库操作日志失败: ' + error.message
            });
        }
    });

    app.get('/api/creative-knowledge/feishu-direction/status', (req, res) => {
        try {
            res.json(feishuDirectionSyncService.getStatus(req.query || {}));
        } catch (error) {
            res.status(500).json({
                success: false,
                message: '获取飞书方向表协同状态失败: ' + error.message
            });
        }
    });

    app.post('/api/creative-knowledge/feishu-direction/config', (req, res) => {
        try {
            res.json({
                success: true,
                message: '飞书方向表配置已保存',
                config: feishuDirectionSyncService.saveConfig(req.body || {})
            });
        } catch (error) {
            res.status(400).json({
                success: false,
                message: '保存飞书方向表配置失败: ' + error.message
            });
        }
    });

    app.post('/api/creative-knowledge/feishu-direction/test', async (req, res) => {
        try {
            res.json(await feishuDirectionSyncService.testConnection(req.body || {}));
        } catch (error) {
            res.status(500).json({
                success: false,
                message: '测试飞书方向表读取失败: ' + error.message
            });
        }
    });

    app.post('/api/creative-knowledge/feishu-direction/preview-import', async (req, res) => {
        try {
            res.json(await feishuDirectionSyncService.previewImport(req.body || {}));
        } catch (error) {
            res.status(500).json({
                success: false,
                message: '预览飞书方向表更新失败: ' + error.message
            });
        }
    });

    app.post('/api/creative-knowledge/feishu-direction/sync-import', async (req, res) => {
        try {
            res.json(await feishuDirectionSyncService.syncImport(req.body || {}));
        } catch (error) {
            res.status(500).json({
                success: false,
                message: '更新飞书方向表到知识库失败: ' + error.message
            });
        }
    });

    app.post('/api/creative-knowledge/feishu-direction/preview-writeback', async (req, res) => {
        try {
            res.json(await feishuDirectionSyncService.previewWriteback(req.body || {}));
        } catch (error) {
            res.status(500).json({
                success: false,
                message: '预览已采纳方向写回失败: ' + error.message
            });
        }
    });

    app.post('/api/creative-knowledge/feishu-direction/sync-writeback', async (req, res) => {
        try {
            res.json(await feishuDirectionSyncService.syncWriteback(req.body || {}));
        } catch (error) {
            res.status(500).json({
                success: false,
                message: '同步已采纳方向到飞书失败: ' + error.message
            });
        }
    });

    app.get('/api/creative-knowledge/overview', (req, res) => {
        try {
            res.json(service.getOverview(req.query || {}));
        } catch (error) {
            res.status(500).json({
                success: false,
                message: '获取创意知识库总览失败: ' + error.message
            });
        }
    });

    app.post('/api/creative-knowledge/import', (req, res) => {
        try {
            res.json(service.importKnowledge(req.body || {}));
        } catch (error) {
            res.status(500).json({
                success: false,
                message: '导入创意知识库失败: ' + error.message
            });
        }
    });

    app.post('/api/creative-knowledge/import-directions', (req, res) => {
        try {
            res.json(service.importKnowledge(req.body || {}));
        } catch (error) {
            res.status(500).json({
                success: false,
                message: '导入创意方向失败: ' + error.message
            });
        }
    });

    app.get('/api/creative-knowledge/directions', (req, res) => {
        try {
            res.json(service.listDirections(req.query || {}));
        } catch (error) {
            res.status(500).json({
                success: false,
                message: '读取创意方向失败: ' + error.message
            });
        }
    });

    app.post('/api/creative-knowledge/directions/:directionId/status', (req, res) => {
        try {
            const result = service.updateDirectionStatus(req.params.directionId, req.body || {}, req.query || {});
            if (!result.success) {
                return res.status(404).json(result);
            }
            res.json(result);
        } catch (error) {
            res.status(400).json({
                success: false,
                message: '更新方向状态失败: ' + error.message
            });
        }
    });

    app.post('/api/creative-knowledge/directions/:directionId/merge', (req, res) => {
        try {
            const result = service.mergeDirection(req.params.directionId, req.body || {}, req.query || {});
            if (!result.success) {
                return res.status(404).json(result);
            }
            res.json(result);
        } catch (error) {
            res.status(400).json({
                success: false,
                message: '合并方向失败: ' + error.message
            });
        }
    });

    app.get('/api/creative-knowledge/direction-drafts', (req, res) => {
        try {
            res.json(service.listDirectionDrafts(req.query || {}));
        } catch (error) {
            res.status(500).json({
                success: false,
                message: '读取方向草案失败: ' + error.message
            });
        }
    });

    app.post('/api/creative-knowledge/direction-drafts/from-run/:runId', (req, res) => {
        try {
            const result = service.extractDirectionDraftsFromRun(req.params.runId, req.body || {}, req.query || {});
            if (!result.success) {
                return res.status(404).json(result);
            }
            res.json(result);
        } catch (error) {
            res.status(400).json({
                success: false,
                message: '提取方向草案失败: ' + error.message
            });
        }
    });

    app.post('/api/creative-knowledge/direction-drafts/:draftId/accept', (req, res) => {
        try {
            const result = service.acceptDirectionDraft(req.params.draftId, req.body || {}, req.query || {});
            if (!result.success && result.needsConfirmation) {
                return res.status(409).json(result);
            }
            if (!result.success) {
                return res.status(404).json(result);
            }
            res.json(result);
        } catch (error) {
            res.status(400).json({
                success: false,
                message: '采纳方向草案失败: ' + error.message
            });
        }
    });

    app.post('/api/creative-knowledge/direction-drafts/:draftId/reject', (req, res) => {
        try {
            const result = service.rejectDirectionDraft(req.params.draftId, req.body || {}, req.query || {});
            if (!result.success) {
                return res.status(404).json(result);
            }
            res.json(result);
        } catch (error) {
            res.status(400).json({
                success: false,
                message: '拒绝方向草案失败: ' + error.message
            });
        }
    });

    app.post('/api/creative-knowledge/direction-drafts/:draftId/archive', (req, res) => {
        try {
            const result = service.archiveDirectionDraft(req.params.draftId, req.body || {}, req.query || {});
            if (!result.success) {
                return res.status(404).json(result);
            }
            res.json(result);
        } catch (error) {
            res.status(400).json({
                success: false,
                message: '归档方向草案失败: ' + error.message
            });
        }
    });

    app.post('/api/creative-knowledge/direction-drafts/:draftId/merge', (req, res) => {
        try {
            const result = service.mergeDirectionDraft(req.params.draftId, req.body || {}, req.query || {});
            if (!result.success) {
                return res.status(404).json(result);
            }
            res.json(result);
        } catch (error) {
            res.status(400).json({
                success: false,
                message: '合并方向草案失败: ' + error.message
            });
        }
    });

    app.get('/api/creative-knowledge/assets', (req, res) => {
        try {
            res.json(service.listAssets(req.query || {}));
        } catch (error) {
            res.status(500).json({
                success: false,
                message: '读取创意资产失败: ' + error.message
            });
        }
    });

    app.get('/api/creative-knowledge/assets/:assetId/file', (req, res) => {
        try {
            const file = service.getAssetFile(req.params.assetId, req.query || {});
            if (!file) {
                return res.status(404).json({
                    success: false,
                    message: '资产图片不存在或本地文件不可读'
                });
            }

            res.setHeader('Cache-Control', 'private, max-age=60');
            return res.sendFile(file.filePath);
        } catch (error) {
            res.status(500).json({
                success: false,
                message: '读取资产图片失败: ' + error.message
            });
        }
    });

    app.post('/api/creative-knowledge/assets/:assetId/review', (req, res) => {
        try {
            const result = service.reviewAsset(req.params.assetId, req.body || {}, req.query || {});
            if (!result.success) {
                return res.status(404).json(result);
            }
            res.json(result);
        } catch (error) {
            res.status(400).json({
                success: false,
                message: '保存资产审核失败: ' + error.message
            });
        }
    });

    app.post('/api/creative-knowledge/assets/:assetId/collect-direction', (req, res) => {
        try {
            const result = service.collectDirectionFromAsset(req.params.assetId, req.body || {}, req.query || {});
            if (!result.success && result.needsConfirmation) {
                return res.status(409).json(result);
            }
            if (!result.success) {
                return res.status(404).json(result);
            }
            res.json(result);
        } catch (error) {
            res.status(400).json({
                success: false,
                message: '收录方向失败: ' + error.message
            });
        }
    });

    app.get('/api/creative-knowledge/references/:referenceId/file', (req, res) => {
        try {
            const file = service.getReferenceFile(req.params.referenceId, req.query || {});
            if (!file) {
                return res.status(404).json({
                    success: false,
                    message: '参考图不存在或本地文件不可读'
                });
            }

            res.setHeader('Cache-Control', 'private, max-age=3600');
            return res.sendFile(file.filePath);
        } catch (error) {
            res.status(500).json({
                success: false,
                message: '读取参考图失败: ' + error.message
            });
        }
    });

    app.post('/api/creative-knowledge/feedback', (req, res) => {
        try {
            res.json(service.createFeedback(req.body || {}, req.query || {}));
        } catch (error) {
            res.status(400).json({
                success: false,
                message: '写入反馈失败: ' + error.message
            });
        }
    });

    app.get('/api/creative-knowledge/feedback', (req, res) => {
        try {
            res.json(service.listFeedback(req.query || {}));
        } catch (error) {
            res.status(500).json({
                success: false,
                message: '读取反馈失败: ' + error.message
            });
        }
    });

    app.get('/api/creative-knowledge/memory', (req, res) => {
        try {
            res.json(service.getCreativeMemory(req.query || {}));
        } catch (error) {
            res.status(500).json({
                success: false,
                message: '读取反馈记忆失败: ' + error.message
            });
        }
    });

    app.post('/api/creative-knowledge/memory/learn', async (req, res) => {
        try {
            const result = await service.learnFromFeedback(req.body || {}, req.query || {});
            if (!result.success) {
                return res.status(400).json(result);
            }
            res.json(result);
        } catch (error) {
            res.status(400).json({
                success: false,
                message: 'Feedback Learning Agent 执行失败: ' + error.message
            });
        }
    });

    app.post('/api/creative-knowledge/memory/rules/:ruleId', (req, res) => {
        try {
            const result = service.updateMemoryRule(req.params.ruleId, req.body || {}, req.query || {});
            if (!result.success) {
                return res.status(404).json(result);
            }
            res.json(result);
        } catch (error) {
            res.status(400).json({
                success: false,
                message: '保存反馈规则失败: ' + error.message
            });
        }
    });

    app.post('/api/creative-knowledge/memory/rules/:ruleId/accept', (req, res) => {
        try {
            const result = service.acceptMemoryRule(req.params.ruleId, req.body || {}, req.query || {});
            if (!result.success) {
                return res.status(404).json(result);
            }
            res.json(result);
        } catch (error) {
            res.status(400).json({
                success: false,
                message: '启用反馈规则失败: ' + error.message
            });
        }
    });

    app.post('/api/creative-knowledge/memory/rules/:ruleId/reject', (req, res) => {
        try {
            const result = service.rejectMemoryRule(req.params.ruleId, req.body || {}, req.query || {});
            if (!result.success) {
                return res.status(404).json(result);
            }
            res.json(result);
        } catch (error) {
            res.status(400).json({
                success: false,
                message: '拒绝反馈规则失败: ' + error.message
            });
        }
    });

    app.post('/api/creative-knowledge/memory/rules/:ruleId/disable', (req, res) => {
        try {
            const result = service.disableMemoryRule(req.params.ruleId, req.body || {}, req.query || {});
            if (!result.success) {
                return res.status(404).json(result);
            }
            res.json(result);
        } catch (error) {
            res.status(400).json({
                success: false,
                message: '禁用反馈规则失败: ' + error.message
            });
        }
    });

    app.get('/api/creative-knowledge/runs', (req, res) => {
        try {
            res.json(service.listRuns(req.query || {}));
        } catch (error) {
            res.status(500).json({
                success: false,
                message: '读取创意运行记录失败: ' + error.message
            });
        }
    });

    app.get('/api/creative-knowledge/top-material-insights', (req, res) => {
        try {
            res.json(service.listTopMaterialInsights(req.query || {}));
        } catch (error) {
            res.status(500).json({
                success: false,
                message: '读取 TOP 素材洞察失败: ' + error.message
            });
        }
    });
};
