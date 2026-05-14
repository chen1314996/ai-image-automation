/**
 * 服务关闭流程。
 *
 * 负责停止健康监控、发送飞书提醒、保存浏览器登录状态，并关闭 HTTP 服务。
 */
function createGracefulShutdown(deps) {
    const {
        server,
        getHealthMonitor,
        feishuNotifier,
        feishuCliBridge,
        browserController
    } = deps;

    let shuttingDown = false;

    async function gracefulShutdown(signal) {
        if (shuttingDown) {
            return;
        }
    
        shuttingDown = true;
        console.log(`\n收到 ${signal}，正在保存浏览器登录状态并关闭服务...`);
    
        const healthMonitor = getHealthMonitor();
        if (healthMonitor) {
            healthMonitor.stop();
        }
    
        try {
            await feishuNotifier.notify({
                level: 'warning',
                title: '服务器正在关闭',
                message: `收到 ${signal}，服务正在停止。`,
                suggestion: '如非主动操作，请稍后检查服务是否已重新启动。'
            }, {
                key: `server-shutdown:${signal}:${Date.now()}`,
                cooldownMs: 0
            });
        } catch (error) {
            console.error('发送服务器关闭通知时出错:', error.message);
        }
    
        try {
            await feishuCliBridge.stop();
        } catch (error) {
            console.error('停止飞书 CLI 桥接时出错:', error.message);
        }
    
        try {
            await browserController.closeBrowser();
        } catch (error) {
            console.error('关闭浏览器时出错:', error.message);
        }
    
        server.close(() => {
            console.log('服务器已关闭');
            process.exit(0);
        });
    
        setTimeout(() => {
            console.log('关闭超时，强制退出');
            process.exit(0);
        }, 5000).unref();
    }
    return gracefulShutdown;
}

module.exports = {
    createGracefulShutdown
};
