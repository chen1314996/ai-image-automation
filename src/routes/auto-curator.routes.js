const { createAutoCuratorService } = require('../services/auto-curator');

module.exports = function registerAutoCuratorRoutes(app, context) {
    const service = createAutoCuratorService(context);

    app.post('/api/auto-curator/score-run/:runId', async (req, res) => {
        try {
            const result = await service.scoreRun(req.params.runId, req.body || {}, req.query || {});
            if (!result.success) {
                return res.status(400).json(result);
            }
            res.json(result);
        } catch (error) {
            res.status(500).json({
                success: false,
                message: 'Auto Curator score-run failed: ' + error.message
            });
        }
    });

    app.post('/api/auto-curator/score-assets', async (req, res) => {
        try {
            res.json(await service.scoreAssets(req.body || {}, req.query || {}));
        } catch (error) {
            res.status(500).json({
                success: false,
                message: 'Auto Curator score-assets failed: ' + error.message
            });
        }
    });

    app.get('/api/auto-curator/shadow-report', (req, res) => {
        try {
            res.json(service.getShadowReport(req.query || {}));
        } catch (error) {
            res.status(500).json({
                success: false,
                message: 'Auto Curator shadow report failed: ' + error.message
            });
        }
    });

    app.get('/api/auto-curator/golden-set', (req, res) => {
        try {
            res.json(service.getGoldenSet(req.query || {}));
        } catch (error) {
            res.status(500).json({
                success: false,
                message: 'Auto Curator golden set read failed: ' + error.message
            });
        }
    });

    app.post('/api/auto-curator/golden-set/import', (req, res) => {
        try {
            res.json(service.importGoldenSet(req.body || {}, req.query || {}));
        } catch (error) {
            res.status(400).json({
                success: false,
                message: 'Auto Curator golden set import failed: ' + error.message
            });
        }
    });

    app.post('/api/auto-curator/golden-set/evaluate', async (req, res) => {
        try {
            res.json(await service.evaluateGoldenSet(req.body || {}, req.query || {}));
        } catch (error) {
            res.status(500).json({
                success: false,
                message: 'Auto Curator golden set evaluation failed: ' + error.message
            });
        }
    });
};
