const {
    importTablePromptFiles
} = require('../services/table-prompts/importer');

module.exports = function registerTablePromptRoutes(app, context = {}) {
    app.post('/api/table-prompts/import', (req, res) => {
        try {
            const files = Array.isArray(req.body && req.body.files) ? req.body.files : [];
            if (!files.length) {
                return res.json({
                    success: false,
                    message: '请上传至少一个 CSV 或 XLSX 表格文件'
                });
            }

            const result = importTablePromptFiles(files, {
                rootDir: context.rootDir
            });
            res.json(result);
        } catch (error) {
            res.json({
                success: false,
                message: `表格提示词解析失败：${error.message}`
            });
        }
    });
};
