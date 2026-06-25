const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { createTaskWorkbookService } = require('../services/task-workbook');
const { recoverUtf8Filename } = require('../services/task-workbook/file-name');

module.exports = function registerTaskWorkbookRoutes(app, context) {
    const service = createTaskWorkbookService(context);
    const rootDir = (context && (context.rootDir || context.ROOT_DIR)) || process.cwd();
    const uploadDir = path.join(rootDir, 'data', 'task-workbooks', 'uploads');
    const upload = multer({
        storage: multer.diskStorage({
            destination(req, file, cb) {
                fs.mkdirSync(uploadDir, { recursive: true });
                cb(null, uploadDir);
            },
            filename(req, file, cb) {
                const safeName = path.basename(uploadOriginalName(file) || 'source.xlsx')
                    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
                    .replace(/\s+/g, '_')
                    .slice(0, 100);
                cb(null, `${Date.now()}_${process.pid}_${safeName || 'source.xlsx'}`);
            }
        }),
        limits: {
            fileSize: 1024 * 1024 * 1024
        },
        fileFilter(req, file, cb) {
            const ext = path.extname(uploadOriginalName(file) || '').toLowerCase();
            if (!['.xlsx', '.xls'].includes(ext)) {
                return cb(new Error('仅支持 .xlsx / .xls 自动化任务表'));
            }
            return cb(null, true);
        }
    });

    app.post('/api/task-workbooks/import', taskWorkbookUploadMiddleware(upload), (req, res) => {
        const tempUploadPath = req.file && req.file.path;
        try {
            const payload = buildImportPayload(req, rootDir);
            const result = service.importWorkbook(payload);
            res.status(201).json(result);
        } catch (error) {
            res.status(400).json({
                success: false,
                message: '导入自动化任务表失败：' + error.message
            });
        } finally {
            if (tempUploadPath) {
                try {
                    fs.unlinkSync(tempUploadPath);
                } catch (_) {
                    // Temporary upload cleanup is best-effort.
                }
            }
        }
    });

    app.get('/api/task-workbooks/imports', (req, res) => {
        try {
            res.json(service.listImports());
        } catch (error) {
            res.status(500).json({
                success: false,
                message: '读取任务表导入记录失败：' + error.message
            });
        }
    });

    app.get('/api/task-workbooks/imports/:importId', (req, res) => {
        try {
            const result = service.getImport(req.params.importId);
            res.status(result.success ? 200 : 404).json(result);
        } catch (error) {
            res.status(404).json({
                success: false,
                message: '读取任务方向池失败：' + error.message
            });
        }
    });

    app.delete('/api/task-workbooks/imports/:importId', (req, res) => {
        try {
            const result = service.deleteImport(req.params.importId);
            res.status(result.success ? 200 : 404).json(result);
        } catch (error) {
            res.status(500).json({
                success: false,
                message: '删除任务表导入记录失败：' + error.message
            });
        }
    });

    app.get('/api/task-workbooks/imports/:importId/images/:fileName', (req, res) => {
        try {
            const image = service.getImage(req.params.importId, req.params.fileName);
            if (!image) {
                return res.status(404).send('图片不存在');
            }
            res.setHeader('Content-Type', image.mimeType);
            res.setHeader('Cache-Control', 'public, max-age=86400');
            return res.sendFile(image.filePath);
        } catch (error) {
            return res.status(500).send('读取任务表参考图失败：' + error.message);
        }
    });

    app.post('/api/task-workbooks/imports/:importId/vision/start', (req, res) => {
        try {
            const result = service.vision.start(req.params.importId, req.body || {});
            res.status(result.success ? 202 : 400).json(result);
        } catch (error) {
            res.status(400).json({
                success: false,
                message: '启动任务方向视觉整理失败：' + error.message
            });
        }
    });

    app.post('/api/task-workbooks/imports/:importId/vision/pause', (req, res) => {
        try {
            res.json(service.vision.pause(req.params.importId));
        } catch (error) {
            res.status(400).json({
                success: false,
                message: '暂停任务方向视觉整理失败：' + error.message
            });
        }
    });

    app.post('/api/task-workbooks/imports/:importId/vision/resume', (req, res) => {
        try {
            const result = service.vision.resume(req.params.importId, req.body || {});
            res.status(result.success ? 202 : 400).json(result);
        } catch (error) {
            res.status(400).json({
                success: false,
                message: '继续任务方向视觉整理失败：' + error.message
            });
        }
    });

    app.get('/api/task-workbooks/imports/:importId/vision/status', (req, res) => {
        try {
            res.json(service.vision.getStatus(req.params.importId));
        } catch (error) {
            res.status(500).json({
                success: false,
                message: '读取任务方向视觉整理状态失败：' + error.message
            });
        }
    });

    app.get('/api/task-workbooks/imports/:importId/vision/results', (req, res) => {
        try {
            res.json(service.vision.getResults(req.params.importId));
        } catch (error) {
            res.status(500).json({
                success: false,
                message: '读取任务方向视觉整理结果失败：' + error.message
            });
        }
    });

    app.post('/api/task-workbooks/imports/:importId/directions/:taskDirectionId/vision/retry', async (req, res) => {
        try {
            const result = await service.vision.retry(req.params.importId, req.params.taskDirectionId);
            res.status(result.success ? 200 : 400).json(result);
        } catch (error) {
            res.status(400).json({
                success: false,
                message: '重试任务方向视觉整理失败：' + error.message
            });
        }
    });
};

function taskWorkbookUploadMiddleware(upload) {
    return (req, res, next) => {
        upload.single('workbook')(req, res, error => {
            if (!error) return next();
            const status = error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
            return res.status(status).json({
                success: false,
                message: '导入自动化任务表失败：' + error.message
            });
        });
    };
}

function buildImportPayload(req, rootDir) {
    if (req.file) {
        return {
            ...(req.body || {}),
            fileName: uploadOriginalName(req.file) || path.basename(req.file.path),
            filePath: req.file.path
        };
    }

    const body = req.body || {};
    if (body.filePath) {
        const filePath = resolveWorkbookPath(body.filePath, rootDir);
        return {
            ...body,
            filePath,
            fileName: body.fileName || path.basename(filePath)
        };
    }

    return body;
}

function uploadOriginalName(file) {
    if (!file) return '';
    if (!file.decodedOriginalName) {
        file.decodedOriginalName = recoverUtf8Filename(file.originalname || '');
    }
    return file.decodedOriginalName;
}

function resolveWorkbookPath(inputPath, rootDir) {
    const rawPath = String(inputPath || '').trim();
    if (!rawPath) throw new Error('缺少本地任务表路径');
    const resolvedPath = path.resolve(rootDir || process.cwd(), rawPath);
    if (!fs.existsSync(resolvedPath)) {
        throw new Error(`本地任务表路径不存在：${rawPath}`);
    }

    const stat = fs.statSync(resolvedPath);
    if (stat.isDirectory()) {
        const candidates = fs.readdirSync(resolvedPath)
            .filter(fileName => !fileName.startsWith('~$') && ['.xlsx', '.xls'].includes(path.extname(fileName).toLowerCase()))
            .map(fileName => {
                const filePath = path.join(resolvedPath, fileName);
                return {
                    filePath,
                    mtimeMs: fs.statSync(filePath).mtimeMs
                };
            })
            .sort((a, b) => b.mtimeMs - a.mtimeMs);
        if (!candidates.length) {
            throw new Error(`本地文件夹内未找到 .xlsx / .xls 任务表：${rawPath}`);
        }
        return candidates[0].filePath;
    }

    const ext = path.extname(resolvedPath).toLowerCase();
    if (!['.xlsx', '.xls'].includes(ext)) {
        throw new Error('本地任务表路径仅支持 .xlsx / .xls 文件');
    }
    return resolvedPath;
}
