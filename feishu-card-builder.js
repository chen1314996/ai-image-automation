const crypto = require('crypto');
const { readSecrets, updateSecrets } = require('./secrets-store');

const CARD_TOKEN_BYTES = 24;

const CARD_ACTIONS = {
    run_center: {
        label: '运行中心',
        type: 'primary'
    },
    status: {
        label: '状态',
        type: 'primary'
    },
    progress: {
        label: '进度',
        type: 'default'
    },
    stop_all: {
        label: '停止全部',
        type: 'danger',
        confirmTitle: '确认停止全部页面任务？',
        confirmText: '会尝试停止完整工作流、自动创意、Legil 队列和正在运行的 Agent。'
    },
    mute_stale_1h: {
        label: '静音卡住',
        type: 'default'
    },
    panel_production: {
        label: '生产面板',
        type: 'default'
    },
    panel_delivery: {
        label: '交付面板',
        type: 'default'
    },
    panel_system: {
        label: '系统面板',
        type: 'default'
    },
    panel_material: {
        label: '素材面板',
        type: 'default'
    },
    panel_knowledge: {
        label: '知识库',
        type: 'default'
    },
    start_creative_prompts: {
        label: '生成Prompt',
        type: 'primary'
    },
    start_creative_smoke: {
        label: '小批量验证',
        type: 'primary'
    },
    start_creative_full: {
        label: '持续生图',
        type: 'primary'
    },
    retry_failed_prompts: {
        label: '重试失败',
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
    production_status: {
        label: '生产状态',
        type: 'primary'
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
        label: '暂停创意',
        type: 'danger',
        confirmTitle: '确认停止创意拓展？',
        confirmText: '会暂停自动创意 run，或向当前 Legil 创意拓展任务发送停止指令。'
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
        label: '重启服务器',
        type: 'danger',
        confirmTitle: '确认重启服务器？',
        confirmText: '会重启本项目 Node 服务。若当前有任务正在运行，后端会拒绝执行。'
    },
    panel: {
        label: '刷新面板',
        type: 'default'
    },
    panel_main: {
        label: '主面板',
        type: 'default'
    },
    delivery_status: {
        label: '交付状态',
        type: 'primary'
    },
    delivery_scan: {
        label: '扫描OK图',
        type: 'default'
    },
    delivery_start: {
        label: '开始交付',
        type: 'primary'
    },
    delivery_resume: {
        label: '继续交付',
        type: 'primary'
    },
    delivery_stop: {
        label: '停止交付',
        type: 'danger',
        confirmTitle: '确认停止交付任务？',
        confirmText: '会停止当前三尺寸候选生成，当前 target 结束后安全退出。'
    },
    delivery_standardize: {
        label: '标准化JPG',
        type: 'default'
    },
    delivery_finalize: {
        label: '最终打包',
        type: 'primary'
    },
    material_status: {
        label: '素材状态',
        type: 'primary'
    },
    task_workbook_status: {
        label: '任务表',
        type: 'default'
    },
    material_weekly_report: {
        label: '生成周报',
        type: 'default'
    },
    material_creative_plan: {
        label: '创意计划',
        type: 'default'
    },
    knowledge_status: {
        label: '知识库状态',
        type: 'primary'
    },
    feishu_sync_status: {
        label: '同步状态',
        type: 'default'
    },
    feishu_sync_import: {
        label: '同步飞书库',
        type: 'primary',
        confirmTitle: '确认同步飞书知识库？',
        confirmText: '会读取已配置的飞书表并更新本地只读知识库缓存。'
    },
    feishu_direction_status: {
        label: '方向表状态',
        type: 'default'
    },
    feishu_direction_import: {
        label: '导入方向表',
        type: 'primary',
        confirmTitle: '确认导入飞书方向表？',
        confirmText: '会从飞书方向表同步导入本地方向库。'
    }
};

const CONTROL_CARD_ROWS = [
    ['status', 'progress'],
    ['continue_workflow', 'stop_all'],
    ['panel_production', 'panel_delivery'],
    ['logs', 'panel_system']
];

const PANEL_DEFINITIONS = {
    main: {
        title: 'AI图片生产远程控制台',
        rows: CONTROL_CARD_ROWS,
        footer: '飞书端用于查看、续跑和止损；新任务配置、知识库同步和交付确认请在网页端完成。'
    },
    production: {
        title: '生产面板',
        rows: [
            ['production_status', 'progress'],
            ['continue_creative', 'stop_creative'],
            ['retry_failed_prompts', 'logs'],
            ['panel_main', 'panel_system']
        ],
        footer: '用于长跑创意任务的查看、暂停、续跑和失败补跑。新任务启动建议在网页端确认参数后执行。'
    },
    delivery: {
        title: '交付面板',
        rows: [
            ['delivery_status', 'progress'],
            ['delivery_resume', 'delivery_stop'],
            ['logs', 'browser_status'],
            ['panel_main', 'panel_system']
        ],
        footer: '用于查看和接管改尺寸交付任务。扫描、开始、打包等配置型操作请在网页端执行。'
    },
    system: {
        title: '系统面板',
        rows: [
            ['browser_status', 'logs'],
            ['restart_server', 'panel_main']
        ],
        footer: '重启服务器只在无运行任务时执行；长跑任务中请先查看进度。'
    },
    material: {
        title: '素材面板',
        rows: [
            ['material_status', 'task_workbook_status'],
            ['material_weekly_report', 'material_creative_plan'],
            ['panel_knowledge', 'progress'],
            ['panel_main', 'logs']
        ],
        footer: '用于素材分析、任务表视觉整理、周报和创意计划。'
    },
    knowledge: {
        title: '知识库面板',
        rows: [
            ['knowledge_status', 'feishu_sync_status'],
            ['feishu_sync_import', 'feishu_direction_status'],
            ['feishu_direction_import', 'progress'],
            ['panel_main', 'logs']
        ],
        footer: '用于飞书表同步、方向库导入和知识库状态检查。'
    }
};

const DEFAULT_CARD_FOOTER = PANEL_DEFINITIONS.main.footer;
const TEXT_COMMAND_PANEL = [
    '**常用指令**',
    '状态 | 进度 | 日志 | 浏览器',
    '继续任务 | 停止全部 | 重启服务器',
    '',
    '**分面板**',
    '生产面板 | 交付面板 | 系统面板',
    '',
    '**生产/交付**',
    '继续创意 | 暂停创意 | 重试失败 | 继续交付 | 停止交付'
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

    if (options.urlButtons === true) {
        item.url = buildActionUrl(action, options);
    }

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
    const panelKey = String(options.panel || 'main').trim();
    const panel = PANEL_DEFINITIONS[panelKey] || PANEL_DEFINITIONS.main;
    const title = String(options.title || panel.title || 'AI生图自动化平台').slice(0, 80);
    const summary = escapeMarkdownText(options.summary || '远程值班面板：查看状态、进度、日志，必要时继续、停止或进入系统面板重启服务器。');
    const template = options.template || 'blue';
    const enableButtons = options.enableButtons !== false;
    const actionOptions = {
        baseUrl: options.baseUrl,
        token: options.token,
        chatId: options.chatId
    };
    const controlElements = enableButtons
        ? panel.rows.map(actions => actionRow(actions, actionOptions))
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
                        ? panel.footer || DEFAULT_CARD_FOOTER
                        : '当前飞书卡片按钮回调未接通，请直接发送上方文字指令控制平台。'))
                ]
            }
        ]
    };
}

module.exports = {
    CARD_ACTIONS,
    CONTROL_CARD_ROWS,
    PANEL_DEFINITIONS,
    TEXT_COMMAND_PANEL,
    buildActionUrl,
    buildFeishuControlCard,
    ensureFeishuCliCardActionToken
};
