/**
 * 第一版“运行一次自动创意”的状态和选题接口。
 */
module.exports = function registerCreativeAutoRoutes(app, context) {
    const service = context.creativeAutoService;

    function getLightDiagnostics() {
        const summary = context.runStateService && typeof context.runStateService.getSummary === 'function'
            ? context.runStateService.getSummary()
            : { status: 'idle', legilQueue: {}, activeRun: null };
        const activeRun = summary.activeRun || {};
        const counts = activeRun.counts || {};
        const legilQueue = summary.legilQueue || {};

        return {
            success: true,
            lightweight: true,
            serviceStatus: {
                status: summary.status || 'idle',
                phase: summary.phase || 'idle',
                preflightOk: true,
                legilRunning: legilQueue.status === 'running'
            },
            policySummary: {
                stageLabel: '辅助自动'
            },
            knowledgeCounts: {
                directions: 0,
                assets: 0,
                feedback: 0,
                activeMemoryRules: 0,
                unreviewedAssets: 0
            },
            targetQueue: activeRun.targetQueueProgress || activeRun.targetQueue || null,
            warnings: [],
            lastRun: activeRun.runId ? {
                runId: activeRun.runId,
                status: activeRun.status,
                phase: activeRun.phase,
                promptAccepted: counts.acceptedPrompts || 0,
                updatedAt: activeRun.updatedAt || ''
            } : null,
            legilResume: {
                hasResume: false
            },
            runState: summary
        };
    }

    app.get('/api/creative-auto/status', (req, res) => {
        try {
            res.json(service.getStatus({
                ...req.query,
                appConfig: context.appConfig
            }));
        } catch (error) {
            res.status(500).json({
                success: false,
                message: '获取自动创意状态失败: ' + error.message
            });
        }
    });

    app.get('/api/creative-auto/diagnostics', (req, res) => {
        try {
            const wantsFull = /^(1|true|yes|full)$/i.test(String(req.query.full || '').trim());
            res.json(wantsFull
                ? service.getDiagnostics({
                    ...req.query,
                    appConfig: context.appConfig
                })
                : getLightDiagnostics());
        } catch (error) {
            res.status(500).json({
                success: false,
                message: '获取自动创意诊断失败: ' + error.message
            });
        }
    });

    app.get('/api/creative-auto/suggestion', (req, res) => {
        try {
            const status = service.getStatus({
                ...req.query,
                appConfig: context.appConfig
            });
            res.json({
                success: true,
                suggestion: status.suggestion,
                quota: status.quota,
                preflight: status.preflight
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                message: '获取自动选题建议失败: ' + error.message
            });
        }
    });

    app.post('/api/creative-auto/run-once', (req, res) => {
        try {
            const result = service.runOnce(req.body || {}, {
                appConfig: context.appConfig
            });
            res.status(result.success ? 202 : 400).json(result);
        } catch (error) {
            res.status(500).json({
                success: false,
                message: '启动运行一次自动创意失败: ' + error.message
            });
        }
    });

    app.post('/api/creative-auto/runs/:runId/start-legil', (req, res) => {
        try {
            const result = service.continueRunToLegil(req.params.runId, req.body || {}, {
                appConfig: context.appConfig
            });
            res.status(result.success ? 202 : 400).json(result);
        } catch (error) {
            res.status(500).json({
                success: false,
                message: '从 Prompt Gate 继续启动 Legil 失败: ' + error.message
            });
        }
    });

    app.post('/api/creative-auto/runs/:runId/direction-review', (req, res) => {
        try {
            const result = service.continueRunFromDirectionReview(req.params.runId, req.body || {}, {
                appConfig: context.appConfig
            });
            res.status(result.success ? 202 : 400).json(result);
        } catch (error) {
            res.status(500).json({
                success: false,
                message: '候选方向审核后继续生成 prompt 失败: ' + error.message
            });
        }
    });

    app.post('/api/creative-auto/runs/:runId/pause', (req, res) => {
        try {
            const result = service.pauseRun(req.params.runId, req.body || {}, {
                appConfig: context.appConfig
            });
            res.status(result.success ? 202 : 400).json(result);
        } catch (error) {
            res.status(500).json({
                success: false,
                message: '停止自动创意任务失败: ' + error.message
            });
        }
    });

    app.post('/api/creative-auto/runs/:runId/resume', (req, res) => {
        try {
            const result = service.resumeRun(req.params.runId, req.body || {}, {
                appConfig: context.appConfig
            });
            res.status(result.success ? 202 : 400).json(result);
        } catch (error) {
            res.status(500).json({
                success: false,
                message: '恢复自动创意任务失败: ' + error.message
            });
        }
    });

    app.post('/api/creative-auto/runs/:runId/retry-failed-prompts', (req, res) => {
        try {
            const result = service.retryFailedPrompts(req.params.runId, req.body || {}, {
                appConfig: context.appConfig
            });
            res.status(result.success ? 202 : 400).json(result);
        } catch (error) {
            res.status(500).json({
                success: false,
                message: '重试失败 Prompt 失败: ' + error.message
            });
        }
    });

    app.get('/api/creative-auto/runs/:runId', (req, res) => {
        try {
            const run = service.getRun(req.params.runId, {
                appConfig: context.appConfig
            });
            if (!run) {
                return res.status(404).json({
                    success: false,
                    message: '自动创意运行记录不存在'
                });
            }

            res.json({
                success: true,
                run
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                message: '读取自动创意运行记录失败: ' + error.message
            });
        }
    });
};
