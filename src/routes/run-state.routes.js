/**
 * 统一运行状态接口。
 *
 * 阶段 1 只做状态聚合：老 workflow、新 creative-auto 和 Legil 当前任务
 * 都投影到同一个 run schema，方便前端运行中心和飞书状态命令读取。
 */
module.exports = function registerRunStateRoutes(app, context) {
    function compactActionResult(type, result) {
        return {
            type,
            success: result && result.success !== false,
            message: result && result.message ? result.message : ''
        };
    }

    function activeCreativeAutoRun() {
        try {
            const status = context.creativeAutoService.getStatus({
                appConfig: context.appConfig
            });
            return status.activeRun || status.resumableRun || null;
        } catch {
            return null;
        }
    }

    app.get('/api/run-state/status', (req, res) => {
        try {
            const wantsFull = /^(1|true|yes|full)$/i.test(String(req.query.full || '').trim());
            const status = !wantsFull && typeof context.runStateService.getSummary === 'function'
                ? context.runStateService.getSummary()
                : context.runStateService.getStatus();
            res.json(status);
        } catch (error) {
            res.status(500).json({
                success: false,
                message: '获取统一运行状态失败: ' + error.message
            });
        }
    });

    app.get('/api/run-state/summary', (req, res) => {
        try {
            const status = typeof context.runStateService.getSummary === 'function'
                ? context.runStateService.getSummary()
                : context.runStateService.getStatus();
            res.json(status);
        } catch (error) {
            res.status(500).json({
                success: false,
                message: '获取统一运行状态摘要失败: ' + error.message
            });
        }
    });

    app.post('/api/run-state/stop-all', async (req, res) => {
        const actions = [];

        try {
            if (context.workflowController && context.workflowController.isRunning) {
                const result = await context.workflowController.stopWorkflow();
                actions.push(compactActionResult('legacy-workflow', result));
            }

            const creativeRun = activeCreativeAutoRun();
            if (creativeRun && creativeRun.runId && creativeRun.status === 'running') {
                const result = context.creativeAutoService.pauseRun(creativeRun.runId, {
                    source: 'run-center'
                }, {
                    appConfig: context.appConfig
                });
                actions.push(compactActionResult('creative-auto', result));
            }

            if (context.automationState && context.automationState.legilTaskRunning) {
                const result = context.requestLegilTaskStop();
                actions.push(compactActionResult('legil', result));
            }

            if (context.creativeAgentTasks && typeof context.cancelCreativeAgentTask === 'function') {
                Array.from(context.creativeAgentTasks.values())
                    .filter(task => !context.isCreativeAgentTaskFinal(task))
                    .forEach(task => {
                        const result = context.cancelCreativeAgentTask(task);
                        actions.push(compactActionResult('creative-agent', result));
                    });
            }

            res.json({
                success: actions.every(action => action.success),
                message: actions.length ? '已发送停止指令' : '当前没有正在运行的页面任务',
                actions,
                status: context.runStateService.getStatus()
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                message: '停止页面任务失败: ' + error.message,
                actions
            });
        }
    });

    app.post('/api/run-state/resume', (req, res) => {
        try {
            const unified = context.runStateService.getStatus();
            const activeRun = unified.activeRun || {};

            if (activeRun.runType === 'creative-auto' && activeRun.runId) {
                const result = context.creativeAutoService.resumeRun(activeRun.runId, {
                    source: 'run-center'
                }, {
                    appConfig: context.appConfig
                });
                return res.status(result.success ? 202 : 400).json({
                    ...result,
                    status: context.runStateService.getStatus()
                });
            }

            const resumeInfo = context.workflowController.getResumeInfo();
            if (resumeInfo && resumeInfo.hasResume) {
                res.status(202).json({
                    success: true,
                    message: `已继续上次任务：第 ${resumeInfo.imageIndex}/${resumeInfo.totalImages} 张参考图，从提示词 ${resumeInfo.promptIndex}/${resumeInfo.totalPrompts} 开始`,
                    resume: resumeInfo,
                    status: unified
                });

                context.workflowController.resumeWorkflow({
                    ...context.getLegilRecoveryOptions()
                }).then(result => {
                    context.logger.info(`运行中心继续工作流结果: ${result.message || ''}`);
                }).catch(error => {
                    context.logger.error('运行中心继续工作流失败: ' + error.message);
                });
                return;
            }

            res.status(400).json({
                success: false,
                message: '当前没有可继续的任务',
                status: unified
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                message: '继续页面任务失败: ' + error.message
            });
        }
    });
};
