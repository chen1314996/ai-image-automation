const crypto = require('crypto');
const { readSecrets, updateSecrets } = require('./secrets-store');

const CARD_TOKEN_BYTES = 24;

const CARD_ACTIONS = {
    status: {
        label: '状态',
        type: 'primary'
    },
    progress: {
        label: '进度',
        type: 'default'
    },
    logs: {
        label: '日志',
        type: 'default'
    },
    browser_status: {
        label: '浏览器',
        type: 'default'
    },
    continue_creative: {
        label: '继续创意',
        type: 'primary'
    },
    continue_workflow: {
        label: '继续任务',
        type: 'primary'
    },
    start_mass: {
        label: '开始量产',
        type: 'primary'
    },
    stop_creative: {
        label: '停止创意',
        type: 'danger',
        confirmTitle: '确认停止创意拓展？',
        confirmText: '会向当前创意拓展任务发送停止指令。'
    },
    stop_workflow: {
        label: '停止任务',
        type: 'danger',
        confirmTitle: '确认停止当前任务？',
        confirmText: '会停止当前完整工作流或 Legil/创意拓展批量任务。'
    },
    restart_prompt: {
        label: '重启确认',
        type: 'danger',
        confirmTitle: '需要二次确认',
        confirmText: '点击后只发送确认说明，不会直接重启。'
    },
    restart_server: {
        label: '重启服务',
        type: 'danger',
        confirmTitle: '确认重启服务器？',
        confirmText: '会重启本项目 server.js。若有任务正在运行，后端会拒绝执行。'
    },
    panel: {
        label: '刷新面板',
        type: 'default'
    }
};

const CONTROL_CARD_ROWS = [
    ['status', 'progress'],
    ['start_mass', 'continue_workflow'],
    ['stop_workflow', 'restart_server']
];

const DEFAULT_CARD_FOOTER = '新版后台回调按钮，不会打开浏览器。更多指令：日志、浏览器状态、继续创意、停止创意、重启工作流。';
const TEXT_COMMAND_PANEL = [
    '**常用指令**',
    '状态 | 进度',
    '开始量产 | 继续任务',
    '停止工作流 | 重启服务器',
    '',
    '**更多指令**',
    '日志 | 浏览器状态 | 继续创意 | 停止创意 | 重启工作流'
].join('\n');

function ensureFeishuCliCardActionToken() {
    const secrets = readSecrets();
    const existing = String(secrets.feishuCliCardActionToken || '').trim();
    if (existing) {
        return existing;
    }

    const token = crypto.randomBytes(CARD_TOKEN_BYTES).toString('hex');
    updateSecrets({
        feishuCliCardActionToken: token
    });
    return token;
}

function escapeMarkdownText(value) {
    return String(value || '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .slice(0, 3500);
}

function normalizeBaseUrl(baseUrl) {
    return String(baseUrl || 'http://127.0.0.1:3066').replace(/\/+$/, '');
}

function buildActionUrl(action, options = {}) {
    const baseUrl = normalizeBaseUrl(options.baseUrl);
    const params = new URLSearchParams({
        action,
        token: String(options.token || ''),
        close: '1'
    });

    if (options.chatId) {
        params.set('chat_id', String(options.chatId));
    }

    return `${baseUrl}/api/feishu-cli/card-action?${params.toString()}`;
}

function plainText(content) {
    return {
        tag: 'plain_text',
        content: String(content || '')
    };
}

function button(action, options = {}) {
    const def = CARD_ACTIONS[action] || CARD_ACTIONS.panel;
    const item = {
        tag: 'button',
        text: plainText(def.label),
        type: def.type || 'default',
        value: {
            action,
            token: String(options.token || ''),
            chatId: String(options.chatId || '')
        }
    };

    if (def.confirmTitle || def.confirmText) {
        item.confirm = {
            title: plainText(def.confirmTitle || '确认执行？'),
            text: plainText(def.confirmText || '点击确认后会执行该操作。')
        };
    }

    return item;
}

function actionRow(actions, options = {}) {
    return {
        tag: 'action',
        layout: actions.length >= 3 ? 'trisection' : 'bisected',
        actions: actions.map(action => button(action, options))
    };
}

function buildFeishuControlCard(options = {}) {
    const title = String(options.title || 'AI生图自动化平台').slice(0, 80);
    const summary = escapeMarkdownText(options.summary || '已精简为常用操作按钮，其他功能继续用文字指令。');
    const template = options.template || 'blue';
    const enableButtons = options.enableButtons !== false;
    const actionOptions = {
        baseUrl: options.baseUrl,
        token: options.token,
        chatId: options.chatId
    };
    const controlElements = enableButtons
        ? CONTROL_CARD_ROWS.map(actions => actionRow(actions, actionOptions))
        : [{
            tag: 'markdown',
            content: TEXT_COMMAND_PANEL
        }];

    return {
        config: {
            wide_screen_mode: true,
            enable_forward: false,
            update_multi: true
        },
        header: {
            title: plainText(title),
            template
        },
        elements: [
            {
                tag: 'markdown',
                content: summary
            },
            {
                tag: 'hr'
            },
            ...controlElements,
            {
                tag: 'note',
                elements: [
                    plainText(options.footer || (enableButtons
                        ? DEFAULT_CARD_FOOTER
                        : '当前飞书卡片按钮回调未接通，请直接发送上方文字指令控制平台。'))
                ]
            }
        ]
    };
}

module.exports = {
    CARD_ACTIONS,
    CONTROL_CARD_ROWS,
    TEXT_COMMAND_PANEL,
    buildActionUrl,
    buildFeishuControlCard,
    ensureFeishuCliCardActionToken
};
