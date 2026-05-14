/**
 * 健康检查、通知状态和守护进程状态接口。
 */
module.exports = function registerHealthRoutes(app, context) {
    const __dirname = context.rootDir;
    const {
        ensureFeishuWatchdogProcess,
        feishuNotifier,
        getHealthMonitor,
        getHealthSnapshot,
        PORT,
        readWatchdogStatus
    } = context;



    app.get('/api/health', (req, res) => {
        try {
            res.json({
                ...getHealthSnapshot(),
                monitor: getHealthMonitor() ? getHealthMonitor().getStatus() : null
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                message: '获取健康状态失败：' + error.message
            });
        }
    });



    app.get('/api/notifications/status', (req, res) => {
        res.json({
            success: true,
            notification: feishuNotifier.getStatus(),
            monitor: getHealthMonitor() ? getHealthMonitor().getStatus() : null,
            watchdog: readWatchdogStatus()
        });
    });



    app.get('/api/watchdog/status', (req, res) => {
        res.json({
            success: true,
            watchdog: readWatchdogStatus()
        });
    });



    app.post('/api/watchdog/start', (req, res) => {
        const result = ensureFeishuWatchdogProcess('manual');
        res.json({
            success: result.success !== false,
            result,
            watchdog: readWatchdogStatus()
        });
    });



    app.post('/api/health/test-notification', async (req, res) => {
        try {
            const result = await feishuNotifier.notify({
                level: 'info',
                title: '飞书异常通知测试',
                message: '这是一条健康监控测试通知。',
                suggestion: '收到这条消息说明异常通知链路可用。',
                extraLines: [`服务端口：${PORT}`]
            }, {
                key: `test-notification:${Date.now()}`,
                cooldownMs: 0
            });
            res.json({
                success: result.success !== false,
                result
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                message: '测试通知发送失败：' + error.message
            });
        }
    });
};
