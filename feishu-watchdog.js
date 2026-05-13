const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const feishuCliBridge = require('./feishu-cli-bridge');

const RUNTIME_DIR = path.join(__dirname, 'runtime');
const LOCK_PATH = path.join(RUNTIME_DIR, 'feishu-watchdog.lock.json');
const STATUS_PATH = path.join(RUNTIME_DIR, 'feishu-watchdog.status.json');

const TARGET_URL = String(process.env.WATCHDOG_TARGET_URL || 'http://127.0.0.1:3066/api/health').trim();
const PROJECT_DIR = __dirname;
const CONFIG_PATH = path.join(PROJECT_DIR, 'automation-config.json');
const INTERVAL_MS = toPositiveNumber(process.env.WATCHDOG_INTERVAL_MS, 30 * 1000);
const TIMEOUT_MS = toPositiveNumber(process.env.WATCHDOG_TIMEOUT_MS, 5000);
const FAIL_THRESHOLD = toPositiveNumber(process.env.WATCHDOG_FAIL_THRESHOLD, 2);
const RECOVERY_THRESHOLD = toPositiveNumber(process.env.WATCHDOG_RECOVERY_THRESHOLD, 1);
const NOTIFY_COOLDOWN_MS = toPositiveNumber(process.env.WATCHDOG_NOTIFY_COOLDOWN_MS, 10 * 60 * 1000);

let timer = null;
let stopping = false;
let consecutiveFailures = 0;
let consecutiveSuccesses = 0;
let serverDown = false;
let lastDownNotifyAt = 0;
let lastDownAt = '';
let lastRecoveryAt = '';
let lastNotifyResult = null;
let lastRestartAt = '';
let lastRestartResult = null;
let lastError = '';

function toPositiveNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : fallback;
}

function ensureRuntimeDir() {
    fs.mkdirSync(RUNTIME_DIR, { recursive: true });
}

function readJson(filePath) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
        return null;
    }
}

function writeJson(filePath, data) {
    ensureRuntimeDir();
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function isProcessAlive(pid) {
    const numericPid = Number(pid);
    if (!Number.isInteger(numericPid) || numericPid <= 0 || numericPid === process.pid) {
        return false;
    }

    try {
        process.kill(numericPid, 0);
        return true;
    } catch {
        return false;
    }
}

function acquireLock() {
    ensureRuntimeDir();
    const existing = readJson(LOCK_PATH);
    if (existing && isProcessAlive(existing.pid)) {
        return false;
    }

    writeJson(LOCK_PATH, {
        pid: process.pid,
        startedAt: new Date().toISOString(),
        targetUrl: TARGET_URL
    });
    return true;
}

function releaseLock() {
    const lock = readJson(LOCK_PATH);
    if (lock && Number(lock.pid) === process.pid) {
        try {
            fs.unlinkSync(LOCK_PATH);
        } catch {
            // ignore cleanup failure
        }
    }
}

function writeStatus(extra = {}) {
    writeJson(STATUS_PATH, {
        running: true,
        pid: process.pid,
        targetUrl: TARGET_URL,
        intervalMs: INTERVAL_MS,
        timeoutMs: TIMEOUT_MS,
        failThreshold: FAIL_THRESHOLD,
        recoveryThreshold: RECOVERY_THRESHOLD,
        notifyCooldownMs: NOTIFY_COOLDOWN_MS,
        serverDown,
        lastDownAt,
        lastRecoveryAt,
        lastNotifyResult,
        lastRestartAt,
        lastRestartResult,
        consecutiveFailures,
        consecutiveSuccesses,
        lastError,
        updatedAt: new Date().toISOString(),
        ...extra
    });
}

function readNotificationConfig() {
    try {
        if (!fs.existsSync(CONFIG_PATH)) return {};
        const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        return parsed && parsed.notifications && typeof parsed.notifications === 'object'
            ? parsed.notifications
            : {};
    } catch {
        return {};
    }
}

function isAutoRestartEnabled() {
    if (process.env.WATCHDOG_AUTO_RESTART !== undefined) {
        return String(process.env.WATCHDOG_AUTO_RESTART).toLowerCase() !== 'false';
    }
    const config = readNotificationConfig();
    return config.watchdogAutoRestartEnabled !== false;
}

function restartServerProcess() {
    if (!isAutoRestartEnabled()) {
        return {
            success: false,
            skipped: true,
            message: '守护监控自动重启未启用'
        };
    }

    try {
        const child = spawn(process.execPath, ['server.js'], {
            cwd: PROJECT_DIR,
            detached: true,
            stdio: 'ignore',
            windowsHide: true,
            env: process.env
        });
        child.unref();
        lastRestartAt = new Date().toISOString();
        lastRestartResult = {
            success: true,
            pid: child.pid,
            message: '已尝试自动重启 server.js'
        };
        return lastRestartResult;
    } catch (error) {
        lastRestartResult = {
            success: false,
            message: '自动重启 server.js 失败：' + error.message
        };
        return lastRestartResult;
    }
}

function formatTime(value = new Date()) {
    return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

async function sendWatchdogMessage(title, message, options = {}) {
    const lines = [
        `**${title}**`,
        '',
        `时间：${formatTime()}`,
        `监控地址：${TARGET_URL}`,
        `说明：${message}`
    ];

    if (options.suggestion) {
        lines.push(`建议：${options.suggestion}`);
    }
    if (Array.isArray(options.extraLines) && options.extraLines.length) {
        lines.push('', ...options.extraLines);
    }

    try {
        return await feishuCliBridge.sendMessage(lines.join('\n'));
    } catch (error) {
        lastError = '飞书通知发送失败: ' + error.message;
        writeStatus();
        return { success: false, message: lastError };
    }
}

async function checkServerHealth() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
        const response = await fetch(TARGET_URL, {
            signal: controller.signal,
            headers: {
                'Accept': 'application/json'
            }
        });
        const text = await response.text();
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
        }

        let payload = {};
        try {
            payload = text ? JSON.parse(text) : {};
        } catch {
            throw new Error('健康接口返回非 JSON 内容');
        }
        if (payload && payload.success === false) {
            throw new Error(payload.message || '健康接口返回失败状态');
        }

        return {
            ok: true,
            payload
        };
    } catch (error) {
        return {
            ok: false,
            error: error && error.name === 'AbortError' ? `健康检查超时 ${TIMEOUT_MS}ms` : error.message
        };
    } finally {
        clearTimeout(timeout);
    }
}

async function tick() {
    if (stopping) return;

    const result = await checkServerHealth();
    if (result.ok) {
        consecutiveSuccesses += 1;
        consecutiveFailures = 0;
        lastError = '';

        if (serverDown && consecutiveSuccesses >= RECOVERY_THRESHOLD) {
            serverDown = false;
            const notifyResult = await sendWatchdogMessage(
                '自动化平台服务已恢复',
                '守护监控已重新连上健康接口。',
                {
                    extraLines: [
                        `连续成功：${consecutiveSuccesses}`,
                        `服务启动时间：${result.payload && result.payload.server ? result.payload.server.startedAt || '未知' : '未知'}`
                    ]
                }
            );
            lastRecoveryAt = new Date().toISOString();
            lastNotifyResult = notifyResult;
            writeStatus({
                lastRecoveryAt,
                lastNotifyResult
            });
            return;
        }

        writeStatus({
            lastSuccessAt: new Date().toISOString(),
            serverStartedAt: result.payload && result.payload.server ? result.payload.server.startedAt : ''
        });
        return;
    }

    consecutiveFailures += 1;
    consecutiveSuccesses = 0;
    lastError = result.error || '健康检查失败';

    const now = Date.now();
    const shouldNotify = consecutiveFailures >= FAIL_THRESHOLD &&
        (!serverDown || now - lastDownNotifyAt >= NOTIFY_COOLDOWN_MS);

    if (shouldNotify) {
        serverDown = true;
        lastDownNotifyAt = now;
        lastDownAt = new Date().toISOString();
        const notifyResult = await sendWatchdogMessage(
            '自动化平台服务可能已掉线',
            lastError,
            {
                suggestion: '请检查本机 node server.js 是否仍在运行；如需继续任务，先重启服务后再发送“继续任务”。',
                extraLines: [
                    `连续失败：${consecutiveFailures}`,
                    `失败阈值：${FAIL_THRESHOLD}`
                ]
            }
        );
        lastNotifyResult = notifyResult;
        const restartResult = restartServerProcess();
        writeStatus({
            lastDownAt,
            lastNotifyResult,
            lastRestartAt,
            lastRestartResult: restartResult
        });
        return;
    }

    writeStatus({
        lastFailureAt: new Date().toISOString()
    });
}

function stop(signal) {
    if (stopping) return;
    stopping = true;
    if (timer) {
        clearInterval(timer);
        timer = null;
    }
    writeStatus({
        running: false,
        stoppedAt: new Date().toISOString(),
        stopSignal: signal
    });
    releaseLock();
    process.exit(0);
}

async function main() {
    if (!acquireLock()) {
        process.exit(0);
    }

    writeStatus({
        startedAt: new Date().toISOString()
    });
    await tick();
    timer = setInterval(() => {
        tick().catch(error => {
            lastError = error.message;
            writeStatus();
        });
    }, INTERVAL_MS);
}

process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
process.on('exit', releaseLock);

main().catch(error => {
    lastError = error.message;
    writeStatus({
        running: false,
        fatal: true
    });
    releaseLock();
    process.exit(1);
});
