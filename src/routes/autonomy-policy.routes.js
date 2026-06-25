const { createAutonomyPolicyService } = require('../services/autonomy-policy');

module.exports = function registerAutonomyPolicyRoutes(app, context) {
    const service = context.autonomyPolicyService || createAutonomyPolicyService(context);

    app.get('/api/autonomy-policy', (req, res) => {
        try {
            res.json(service.getPolicy());
        } catch (error) {
            res.status(500).json({
                success: false,
                message: '读取自治策略失败: ' + error.message
            });
        }
    });

    app.post('/api/autonomy-policy', (req, res) => {
        try {
            res.json(service.savePolicy(req.body || {}));
        } catch (error) {
            res.status(400).json({
                success: false,
                message: '保存自治策略失败: ' + error.message
            });
        }
    });

    app.post('/api/autonomy-policy/check-action', (req, res) => {
        try {
            const body = req.body || {};
            const result = service.canPerformAction(body.action, body.context || {});
            res.status(result.allowed ? 200 : 403).json({
                success: result.allowed,
                ...result
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                allowed: false,
                message: '检查自治动作失败: ' + error.message
            });
        }
    });

    app.get('/api/autonomy-policy/events', (req, res) => {
        try {
            res.json(service.listEvents(req.query || {}));
        } catch (error) {
            res.status(500).json({
                success: false,
                message: '读取自治策略事件失败: ' + error.message
            });
        }
    });
};
