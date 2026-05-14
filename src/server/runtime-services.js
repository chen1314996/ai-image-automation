/**
 * 后台常驻服务。
 *
 * HTTP 服务启动后，这里负责启动飞书 CLI 桥接、守护监控和健康检查。
 */
function startRuntimeServices(deps) {
    const {
        readFeishuCliConfig,
        feishuCliBridge,
        logger,
        ensureFeishuWatchdogProcess,
        HealthMonitor,
        getHealthSnapshot,
        feishuNotifier,
        appConfig,
        setHealthMonitor
    } = deps;

    const feishuCliConfigOnStart = readFeishuCliConfig();
    if (feishuCliConfigOnStart.enabled) {
        feishuCliBridge.start(feishuCliConfigOnStart).catch(error => {
            logger.error('飞书 CLI 桥接自动启动失败: ' + error.message);
        });
    }
    
    const watchdogStartResult = ensureFeishuWatchdogProcess('server-start');
    if (watchdogStartResult.success) {
        logger.system(`飞书守护监控启动检查完成: ${watchdogStartResult.message}`);
    } else if (!watchdogStartResult.skipped) {
        logger.warn(watchdogStartResult.message);
    }
    
    const healthMonitor = new HealthMonitor({
        snapshotProvider: async () => getHealthSnapshot(),
        notifier: feishuNotifier,
        intervalMs: Number(process.env.HEALTH_MONITOR_INTERVAL_MS) || 60 * 1000,
        staleWarningMs: Number(process.env.HEALTH_STALE_WARNING_MS) || appConfig.notifications.staleThresholdMinutes * 60 * 1000,
        staleErrorMs: Number(process.env.HEALTH_STALE_ERROR_MS) || Math.max(appConfig.notifications.staleThresholdMinutes * 2 * 60 * 1000, appConfig.notifications.staleThresholdMinutes * 60 * 1000 + 60 * 1000),
        shouldNotifyStale: () => Boolean(appConfig.notifications.feishuEnabled && appConfig.notifications.staleProgressEnabled)
    });
    setHealthMonitor(healthMonitor);
    healthMonitor.start();
    
    setTimeout(() => {
        try {
            const snapshot = getHealthSnapshot();
            if (appConfig.notifications.feishuEnabled && appConfig.notifications.serverStartupEnabled) {
                healthMonitor.notifyStartup(snapshot);
            }
            healthMonitor.check().catch(error => {
                logger.warn('健康监控首次检查失败: ' + error.message);
            });
        } catch (error) {
            logger.warn('健康监控启动通知失败: ' + error.message);
        }
    }, Number(process.env.HEALTH_STARTUP_NOTIFY_DELAY_MS) || 8000).unref();

    return healthMonitor;
}

module.exports = {
    startRuntimeServices
};
