/**
 * 后台启动入口。
 *
 * 这个文件只负责把应用、接口、后台服务和关闭流程串起来，具体功能放在旁边的小模块里。
 */
const { createApp } = require('../app');
const {
    PORT,
    ROOT_DIR,
    appConfig,
    browserController,
    jimengBrowserService,
    logger,
    feishuNotifier,
    feishuCliBridge,
    HealthMonitor,
    readFeishuCliConfig,
    ensureFeishuWatchdogProcess,
    getHealthSnapshot,
    createRouteContext,
    getHealthMonitor,
    setHealthMonitor
} = require('./context');
const { registerRoutes } = require('./routes');
const { printStartupBanner } = require('./startup-banner');
const { startRuntimeServices } = require('./runtime-services');
const { createGracefulShutdown } = require('./shutdown');

const app = createApp({ rootDir: ROOT_DIR });
app.get('/api/health', (req, res, next) => {
    const wantsFullSnapshot = /^(1|true|yes|full)$/i.test(String(req.query.full || '').trim());
    if (wantsFullSnapshot) {
        return next();
    }

    return res.json({
        success: true,
        server: {
            running: true,
            uptimeSeconds: Math.floor(process.uptime()),
            port: PORT
        },
        monitor: getHealthMonitor() ? getHealthMonitor().getStatus() : null
    });
});
const routeContext = createRouteContext();
registerRoutes(app, routeContext);

const LEGIL_IMAGE_TO_IMAGE_URL = 'https://lumos.diandian.info/legil/image-ai/image-to-image';

function parseBooleanEnv(value) {
    if (value === undefined || value === null || value === '') {
        return null;
    }

    return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function shouldAutoOpenLegilOnStart() {
    if (process.env.CI || process.env.NODE_ENV === 'test') {
        return false;
    }

    const envValue = parseBooleanEnv(process.env.AUTO_OPEN_LEGIL_ON_START);
    if (envValue !== null) {
        return envValue;
    }

    if (appConfig.browser && typeof appConfig.browser.autoOpenLegilOnStart === 'boolean') {
        return appConfig.browser.autoOpenLegilOnStart;
    }

    return false;
}

function getStartupLegilUrl() {
    return (
        process.env.LEGIL_URL ||
        process.env.LEGIL_IMAGE_TO_IMAGE_URL ||
        (appConfig.browser && appConfig.browser.legilUrl) ||
        LEGIL_IMAGE_TO_IMAGE_URL
    );
}

function scheduleStartupLegilOpen() {
    if (!shouldAutoOpenLegilOnStart()) {
        logger.info('启动预连接已关闭：不会自动打开 Legil 页面');
        return;
    }

    const delayMs = Number(process.env.AUTO_OPEN_LEGIL_DELAY_MS) || 2500;
    setTimeout(async () => {
        try {
            if (browserController.isPageOpen && browserController.isPageOpen('legil')) {
                logger.browser('启动预连接跳过：Legil 页面已打开');
                return;
            }

            logger.browser('启动预连接：正在打开 Legil 图生图页面');
            const success = await browserController.openWebsite('legil', getStartupLegilUrl());
            if (success) {
                logger.browser('启动预连接完成：Legil 页面已打开，可用于连接状态检测');
            } else {
                logger.warn('启动预连接未完成：Legil 页面打开失败');
            }
        } catch (error) {
            logger.warn(`启动预连接失败：${error.message}`);
        }
    }, delayMs);
}

const server = app.listen(PORT, () => {
    printStartupBanner(PORT);
    scheduleStartupLegilOpen();
});

server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
        console.error(`❌ 端口 ${PORT} 已被占用，请关闭旧服务或使用 PORT 环境变量指定其他端口`);
        process.exitCode = 1;
        return;
    }

    console.error('❌ 服务器启动失败:', error.message);
    process.exitCode = 1;
});

startRuntimeServices({
    readFeishuCliConfig,
    feishuCliBridge,
    logger,
    ensureFeishuWatchdogProcess,
    HealthMonitor,
    getHealthSnapshot,
    feishuNotifier,
    appConfig,
    setHealthMonitor
});

const gracefulShutdown = createGracefulShutdown({
    server,
    getHealthMonitor,
    feishuNotifier,
    feishuCliBridge,
    browserController,
    jimengBrowserService
});

process.on('SIGINT', () => {
    gracefulShutdown('SIGINT');
});

process.on('SIGTERM', () => {
    gracefulShutdown('SIGTERM');
});
