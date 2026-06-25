const express = require('express');
const path = require('path');

/**
 * 创建 Express 应用。
 *
 * 这里只放所有接口都会用到的基础能力：JSON 请求、静态页面和 JSON 格式错误。
 */
function createApp(options = {}) {
    const rootDir = options.rootDir || path.join(__dirname, '..');
    const app = express();
    const slowRequestMs = Number(process.env.SLOW_REQUEST_MS) || 1000;

    app.use((req, res, next) => {
        const startedAt = process.hrtime.bigint();
        res.on('finish', () => {
            const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
            if (durationMs >= slowRequestMs) {
                const size = res.getHeader('content-length') || '-';
                console.warn(`[slow-request] ${req.method} ${req.originalUrl || req.url} ${res.statusCode} ${durationMs.toFixed(0)}ms ${size}b`);
            }
        });
        next();
    });

    app.use(express.json({ limit: '160mb' }));
    app.use(express.static(path.join(rootDir, 'public')));

    app.use((err, req, res, next) => {
        if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
            return res.status(400).json({
                success: false,
                message: '请求 JSON 格式错误'
            });
        }
        next(err);
    });

    return app;
}

module.exports = {
    createApp
};
