/**
 * 实时日志 SSE 和最近日志读取接口。
 */
module.exports = function registerLogsRoutes(app, context) {
    const __dirname = context.rootDir;
    const {
        logger
    } = context;



    /**
     * ============================================
     * 第四阶段：新增 SSE 日志接口
     * ============================================
     *
     * 使用 SSE（Server-Sent Events）技术实现服务器向客户端推送日志
     * 前端通过 EventSource API 连接此接口，实时接收日志
     *
     * 请求方法：GET
     * 请求路径：/api/logs
     */
    app.get('/api/logs/recent', (req, res) => {
        const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 50));
        res.json({
            success: true,
            logs: logger.getRecentLogs(limit)
        });
    });



    app.get('/api/logs', (req, res) => {
        console.log('📡 新的日志客户端正在连接...');

        // 将响应对象交给 logger 管理
        logger.addClient(res);

        // 发送初始连接成功消息
        logger.system('实时日志连接已建立');
    });
};
