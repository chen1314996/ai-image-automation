const fs = require('fs');

const {
    createVisionTaxonomyRenamer
} = require('../services/vision-taxonomy-renamer');

module.exports = function registerVisionTaxonomyRenameRoutes(app, context) {
    const service = createVisionTaxonomyRenamer(context);

    app.get('/api/vision-taxonomy-rename/taxonomy-status', (req, res) => {
        try {
            res.json(service.taxonomyStatus(req.query || {}));
        } catch (error) {
            res.status(500).json({
                success: false,
                message: error.message
            });
        }
    });

    app.post('/api/vision-taxonomy-rename/preview', async (req, res) => {
        try {
            res.json(await service.preview(req.body || {}));
        } catch (error) {
            res.status(400).json({
                success: false,
                message: error.message
            });
        }
    });

    app.post('/api/vision-taxonomy-rename/cancel', (req, res) => {
        try {
            const runId = String(req.body && req.body.runId || '').trim();
            res.json(service.cancel(runId));
        } catch (error) {
            res.status(400).json({
                success: false,
                message: error.message
            });
        }
    });

    app.post('/api/vision-taxonomy-rename/apply', (req, res) => {
        try {
            const runId = String(req.body && req.body.runId || '').trim();
            res.json(service.apply(runId));
        } catch (error) {
            res.status(400).json({
                success: false,
                message: error.message
            });
        }
    });

    app.get('/api/vision-taxonomy-rename/latest', (req, res) => {
        try {
            res.json(service.latest(req.query || {}));
        } catch (error) {
            res.status(400).json({
                success: false,
                message: error.message
            });
        }
    });

    app.get('/api/vision-taxonomy-rename/runs/:runId', (req, res) => {
        try {
            const run = service.getRun(req.params.runId);
            if (!run) {
                return res.status(404).json({
                    success: false,
                    message: '未找到智能视觉重命名 run'
                });
            }
            res.json({
                success: true,
                run
            });
        } catch (error) {
            res.status(400).json({
                success: false,
                message: error.message
            });
        }
    });

    app.get('/api/vision-taxonomy-rename/runs/:runId/report.csv', (req, res) => {
        try {
            const paths = service.reportPaths(req.params.runId);
            if (!fs.existsSync(paths.csv)) {
                return res.status(404).json({
                    success: false,
                    message: '报告不存在'
                });
            }
            res.download(paths.csv);
        } catch (error) {
            res.status(400).json({
                success: false,
                message: error.message
            });
        }
    });
};
