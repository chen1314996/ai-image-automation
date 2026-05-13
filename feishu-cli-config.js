const { readSecrets } = require('./secrets-store');

const DEFAULT_PROFILE = 'ai-image-automation';
const DEFAULT_CONTROL_API_BASE_URL = 'http://127.0.0.1:3066';
const DEFAULT_EVENT_KEY = 'im.message.receive_v1';

function parseList(value) {
    if (Array.isArray(value)) {
        return value.map(item => String(item || '').trim()).filter(Boolean);
    }

    return String(value || '')
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);
}

function parseBoolean(value, fallback = false) {
    if (value === undefined || value === null || value === '') {
        return fallback;
    }
    if (typeof value === 'boolean') {
        return value;
    }

    const text = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'y', 'on', 'enabled'].includes(text)) {
        return true;
    }
    if (['0', 'false', 'no', 'n', 'off', 'disabled'].includes(text)) {
        return false;
    }

    return fallback;
}

function toPositiveNumber(value, fallback) {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue) || numberValue <= 0) {
        return fallback;
    }
    return numberValue;
}

function readFeishuCliConfig(overrides = {}) {
    const secrets = readSecrets();
    const profile = String(
        overrides.profile ||
        process.env.FEISHU_CLI_PROFILE ||
        secrets.feishuCliProfile ||
        DEFAULT_PROFILE
    ).trim();

    const allowedChatIds = parseList(
        overrides.allowedChatIds ||
        process.env.FEISHU_CLI_ALLOWED_CHAT_IDS ||
        secrets.feishuCliAllowedChatIds ||
        secrets.feishuAllowedChatIds
    );

    const allowedUserIds = parseList(
        overrides.allowedUserIds ||
        process.env.FEISHU_CLI_ALLOWED_USER_IDS ||
        secrets.feishuCliAllowedUserIds
    );

    const notifyChatId = String(
        overrides.notifyChatId ||
        process.env.FEISHU_CLI_NOTIFY_CHAT_ID ||
        secrets.feishuCliNotifyChatId ||
        allowedChatIds[0] ||
        ''
    ).trim();
    const pairingEnabled = parseBoolean(
        overrides.pairingEnabled !== undefined
            ? overrides.pairingEnabled
            : (process.env.FEISHU_CLI_PAIRING_ENABLED || secrets.feishuCliPairingEnabled),
        true
    );

    return {
        enabled: parseBoolean(
            overrides.enabled !== undefined ? overrides.enabled : (process.env.FEISHU_CLI_ENABLED || secrets.feishuCliEnabled),
            false
        ),
        cliPath: String(overrides.cliPath || process.env.FEISHU_CLI_PATH || secrets.feishuCliPath || 'lark-cli').trim(),
        profile,
        eventKey: String(overrides.eventKey || process.env.FEISHU_CLI_EVENT_KEY || secrets.feishuCliEventKey || DEFAULT_EVENT_KEY).trim(),
        controlApiBaseUrl: String(
            overrides.controlApiBaseUrl ||
            process.env.FEISHU_CLI_CONTROL_API ||
            secrets.feishuCliControlApiBaseUrl ||
            DEFAULT_CONTROL_API_BASE_URL
        ).replace(/\/+$/, ''),
        cardActionBaseUrl: String(
            overrides.cardActionBaseUrl ||
            process.env.FEISHU_CLI_CARD_ACTION_BASE_URL ||
            secrets.feishuCliCardActionBaseUrl ||
            overrides.controlApiBaseUrl ||
            process.env.FEISHU_CLI_CONTROL_API ||
            secrets.feishuCliControlApiBaseUrl ||
            DEFAULT_CONTROL_API_BASE_URL
        ).replace(/\/+$/, ''),
        cardActionToken: String(
            overrides.cardActionToken ||
            process.env.FEISHU_CLI_CARD_ACTION_TOKEN ||
            secrets.feishuCliCardActionToken ||
            ''
        ).trim(),
        allowedChatIds,
        allowedUserIds,
        notifyChatId,
        pairingEnabled,
        replyInThread: parseBoolean(
            overrides.replyInThread !== undefined ? overrides.replyInThread : (process.env.FEISHU_CLI_REPLY_IN_THREAD || secrets.feishuCliReplyInThread),
            false
        ),
        reconnect: parseBoolean(
            overrides.reconnect !== undefined ? overrides.reconnect : (process.env.FEISHU_CLI_RECONNECT || secrets.feishuCliReconnect),
            true
        ),
        reconnectDelayMs: toPositiveNumber(
            overrides.reconnectDelayMs || process.env.FEISHU_CLI_RECONNECT_DELAY_MS || secrets.feishuCliReconnectDelayMs,
            5000
        ),
        maxReconnectDelayMs: toPositiveNumber(
            overrides.maxReconnectDelayMs || process.env.FEISHU_CLI_MAX_RECONNECT_DELAY_MS || secrets.feishuCliMaxReconnectDelayMs,
            60000
        ),
        sendTimeoutMs: toPositiveNumber(
            overrides.sendTimeoutMs || process.env.FEISHU_CLI_SEND_TIMEOUT_MS || secrets.feishuCliSendTimeoutMs,
            20000
        )
    };
}

function getSafeFeishuCliConfig(config = readFeishuCliConfig()) {
    return {
        enabled: config.enabled,
        cliPath: config.cliPath,
        profile: config.profile,
        eventKey: config.eventKey,
        controlApiBaseUrl: config.controlApiBaseUrl,
        allowedChatIds: config.allowedChatIds.length,
        allowedUserIds: config.allowedUserIds.length,
        notifyChatIdConfigured: Boolean(config.notifyChatId),
        cardActionBaseUrl: config.cardActionBaseUrl,
        cardActionTokenConfigured: Boolean(config.cardActionToken),
        pairingEnabled: config.pairingEnabled,
        replyInThread: config.replyInThread,
        reconnect: config.reconnect
    };
}

function validateFeishuCliConfig(config = readFeishuCliConfig()) {
    const warnings = [];
    if (!config.cliPath) {
        warnings.push('未配置 lark-cli 路径');
    }
    if (!config.profile) {
        warnings.push('未配置独立 lark-cli profile');
    }
    if (!config.eventKey) {
        warnings.push('未配置飞书事件类型');
    }
    if (!config.controlApiBaseUrl) {
        warnings.push('未配置本机控制 API 地址');
    }
    if (!config.allowedChatIds.length && !config.allowedUserIds.length && config.pairingEnabled) {
        warnings.push('当前处于首次绑定模式，仅会响应“绑定平台”指令');
    }
    if (!config.allowedChatIds.length && !config.allowedUserIds.length && !config.pairingEnabled) {
        warnings.push('未配置飞书控制白名单，桥接服务会拒绝处理消息');
    }

    return {
        success: warnings.every(message => message.includes('首次绑定模式')),
        warnings
    };
}

module.exports = {
    DEFAULT_PROFILE,
    DEFAULT_CONTROL_API_BASE_URL,
    DEFAULT_EVENT_KEY,
    parseList,
    parseBoolean,
    readFeishuCliConfig,
    getSafeFeishuCliConfig,
    validateFeishuCliConfig
};
