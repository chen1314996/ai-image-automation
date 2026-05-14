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
const routeContext = createRouteContext();
registerRoutes(app, routeContext);

const server = app.listen(PORT, () => {
    printStartupBanner(PORT);
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
    browserController
});

process.on('SIGINT', () => {
    gracefulShutdown('SIGINT');
});

process.on('SIGTERM', () => {
    gracefulShutdown('SIGTERM');
});
