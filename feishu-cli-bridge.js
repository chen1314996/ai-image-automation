const { spawn, execFile } = require('child_process');
const readline = require('readline');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');
let Lark = null;
try {
    Lark = require('@larksuiteoapi/node-sdk');
} catch {
    Lark = null;
}
const {
    readFeishuCliConfig,
    getSafeFeishuCliConfig,
    validateFeishuCliConfig
} = require('./feishu-cli-config');
const { readSecrets, updateSecrets } = require('./secrets-store');
const { FeishuCommandRouter, accessGuard } = require('./feishu-command-router');
const { FeishuControlService } = require('./feishu-control-service');
const {
    CARD_ACTIONS,
    buildFeishuControlCard,
    ensureFeishuCliCardActionToken
} = require('./feishu-card-builder');

function createIdempotencyKey(prefix = 'ai-image-platform') {
    return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

function getWindowsLarkCliScript(cliPath) {
    const candidates = [];
    const normalizedCliPath = String(cliPath || '').trim();
    if (normalizedCliPath && /[\\/]/.test(normalizedCliPath)) {
        const cliDir = path.dirname(normalizedCliPath);
        candidates.push(path.join(cliDir, 'node_modules', '@larksuite', 'cli', 'scripts', 'run.js'));
    }
    if (process.env.APPDATA) {
        candidates.push(path.join(process.env.APPDATA, 'npm', 'node_modules', '@larksuite', 'cli', 'scripts', 'run.js'));
    }

    return candidates.find(candidate => candidate && fs.existsSync(candidate)) || '';
}

function resolveLarkCliInvocation(cliPath) {
    const safeCliPath = String(cliPath || 'lark-cli').trim();
    if (process.platform === 'win32') {
        if (/\.js$/i.test(safeCliPath) && fs.existsSync(safeCliPath)) {
            return {
                command: process.execPath,
                argsPrefix: [safeCliPath],
                display: `${process.execPath} ${safeCliPath}`
            };
        }

        const scriptPath = getWindowsLarkCliScript(safeCliPath);
        if (scriptPath) {
            return {
                command: process.execPath,
                argsPrefix: [scriptPath],
                display: `${process.execPath} ${scriptPath}`
            };
        }
    }

    return {
        command: safeCliPath,
        argsPrefix: [],
        display: safeCliPath
    };
}

function getLarkCliConfigPath() {
    const candidates = [
        process.env.LARK_CLI_CONFIG,
        process.env.LARKSUITE_CLI_CONFIG,
        process.env.USERPROFILE ? path.join(process.env.USERPROFILE, '.lark-cli', 'config.json') : '',
        process.env.HOME ? path.join(process.env.HOME, '.lark-cli', 'config.json') : ''
    ].filter(Boolean);

    return candidates.find(candidate => fs.existsSync(candidate)) || '';
}

function readLarkCliProfileCredentials(profile) {
    const configPath = getLarkCliConfigPath();
    if (!configPath) {
        return null;
    }

    try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        const apps = Array.isArray(config.apps) ? config.apps : [];
        const normalizedProfile = String(profile || '').trim();
        const app = apps.find(item => String(item.name || '').trim() === normalizedProfile) ||
            apps.find(item => String(item.profile || '').trim() === normalizedProfile) ||
            apps.find(item => String(item.appId || '').trim() === normalizedProfile) ||
            (apps.length === 1 ? apps[0] : null);

        if (!app || !app.appId) {
            return null;
        }

        const secrets = readSecrets();
        const appSecretFromConfig = typeof app.appSecret === 'string'
            ? app.appSecret.trim()
            : '';
        const appSecret = String(
            secrets.feishuSdkAppSecret ||
            secrets.feishuCliAppSecret ||
            secrets.feishuAppSecret ||
            process.env.FEISHU_SDK_APP_SECRET ||
            process.env.FEISHU_CLI_APP_SECRET ||
            appSecretFromConfig ||
            ''
        ).trim();
        const appId = String(
            secrets.feishuSdkAppId ||
            secrets.feishuCliAppId ||
            process.env.FEISHU_SDK_APP_ID ||
            process.env.FEISHU_CLI_APP_ID ||
            app.appId ||
            ''
        ).trim();

        if (!appSecret || appSecret === '[object Object]') {
            logger.warn('飞书 SDK 长连接缺少可用 App Secret；lark-cli keychain 引用不能直接给 Node SDK 使用');
            return null;
        }

        return {
            appId,
            appSecret,
            brand: String(app.brand || 'feishu').trim().toLowerCase()
        };
    } catch (error) {
        logger.warn('读取 lark-cli profile 凭据失败: ' + error.message);
        return null;
    }
}

function execFileAsync(command, args, options = {}) {
    return new Promise((resolve, reject) => {
        execFile(command, args, {
            windowsHide: true,
            timeout: options.timeout || 20000,
            maxBuffer: options.maxBuffer || 1024 * 1024,
            env: options.env || process.env
        }, (error, stdout, stderr) => {
            if (error) {
                error.stdout = stdout;
                error.stderr = stderr;
                reject(error);
                return;
            }
            resolve({ stdout, stderr });
        });
    });
}

function execLarkCliAsync(config, args, options = {}) {
    const invocation = resolveLarkCliInvocation(config.cliPath);
    return execFileAsync(invocation.command, [...invocation.argsPrefix, ...args], options);
}

function createSdkClientFromConfig(config) {
    if (!Lark) {
        return null;
    }

    const credentials = readLarkCliProfileCredentials(config.profile);
    if (!credentials || !credentials.appId || !credentials.appSecret) {
        return null;
    }

    return new Lark.Client({
        appId: credentials.appId,
        appSecret: credentials.appSecret,
        domain: credentials.brand === 'lark' ? Lark.Domain.Lark : Lark.Domain.Feishu,
        loggerLevel: Lark.LoggerLevel.warn
    });
}

function getSdkErrorMessage(error) {
    const responseData = error && error.response && error.response.data;
    if (responseData) {
        try {
            return JSON.stringify(responseData);
        } catch {}
    }
    return error && error.message ? error.message : String(error || '未知错误');
}

class FeishuCliBridge {
    constructor(options = {}) {
        this.configReader = options.configReader || readFeishuCliConfig;
        this.child = null;
        this.router = null;
        this.running = false;
        this.ready = false;
        this.manualStopping = false;
        this.reconnectTimer = null;
        this.reconnectAttempts = 0;
        this.startedAt = '';
        this.lastError = '';
        this.lastEventAt = '';
        this.lastReplyAt = '';
        this.lastStderr = '';
        this.currentConfig = null;
        this.consumerMode = '';
        this.sdkWsClient = null;
        this.sdkWsStartPromise = null;
        this.sdkReadyOnce = false;
        this.sdkFallbackStarted = false;
        this.messageReady = false;
        this.cardActionReady = false;
        this.pollTimer = null;
        this.polling = false;
        this.pollSeenMessageIds = new Set();
        this.pollSeededChatIds = new Set();
    }

    getStatus() {
        const config = this.currentConfig || this.configReader();
        const validation = validateFeishuCliConfig(config);
        return {
            running: this.running,
            ready: this.ready,
            pid: this.child && this.child.pid ? this.child.pid : null,
            startedAt: this.startedAt,
            lastEventAt: this.lastEventAt,
            lastReplyAt: this.lastReplyAt,
            lastError: this.lastError,
            lastStderr: this.lastStderr,
            reconnectAttempts: this.reconnectAttempts,
            consumerMode: this.consumerMode,
            messageReady: this.messageReady,
            cardActionReady: this.cardActionReady,
            polling: this.polling,
            config: getSafeFeishuCliConfig(config),
            validation
        };
    }

    async start(overrides = {}) {
        if (this.running) {
            return {
                success: true,
                message: '飞书 CLI 桥接已在运行',
                status: this.getStatus()
            };
        }

        const config = this.configReader(overrides);
        const validation = validateFeishuCliConfig(config);
        if (!validation.success) {
            return {
                success: false,
                message: `飞书 CLI 桥接配置不完整：${validation.warnings.join('；')}`,
                status: this.getStatus()
            };
        }

        this.currentConfig = config;
        this.router = new FeishuCommandRouter({
            controlService: new FeishuControlService({
                apiBaseUrl: config.controlApiBaseUrl,
                timeoutMs: config.sendTimeoutMs
            }),
            onPair: async pairInfo => {
                updateSecrets({
                    feishuCliProfile: config.profile,
                    feishuCliAllowedChatIds: pairInfo.chatId,
                    feishuCliAllowedUserIds: pairInfo.userId,
                    feishuCliNotifyChatId: pairInfo.chatId,
                    feishuCliPairingEnabled: false,
                    feishuCliEnabled: true
                });
                this.currentConfig = this.configReader();
                logger.system(`飞书 CLI 控制已完成首次绑定：chat=${pairInfo.chatId}`);
            }
        });
        this.manualStopping = false;
        this.lastError = '';
        this.lastStderr = '';
        this.sdkReadyOnce = false;
        this.sdkFallbackStarted = false;
        this.messageReady = false;
        this.cardActionReady = false;
        this.startedAt = new Date().toISOString();
        const sdkStarted = this.startSdkConsumer(config);
        if (!sdkStarted) {
            this.startPollingConsumer(config);
        }

        return {
            success: true,
            message: `飞书 CLI 桥接正在启动，profile=${config.profile}`,
            status: this.getStatus()
        };
    }

    startPollingConsumer(config) {
        const chatIds = Array.from(new Set([
            ...config.allowedChatIds,
            config.notifyChatId
        ].map(item => String(item || '').trim()).filter(Boolean)));

        this.consumerMode = 'polling';
        this.running = true;
        this.polling = false;
        this.messageReady = false;
        this.pollSeenMessageIds = new Set();
        this.pollSeededChatIds = new Set();
        this.ready = this.messageReady || this.cardActionReady;

        if (!chatIds.length) {
            this.lastError = 'Feishu polling requires at least one allowed chat id';
            logger.warn(this.lastError);
            return;
        }

        const poll = async () => {
            if (this.polling || this.manualStopping) {
                return;
            }

            this.polling = true;
            try {
                for (const chatId of chatIds) {
                    await this.pollChatMessages(config, chatId);
                }
                this.lastError = '';
                this.messageReady = true;
                this.ready = this.messageReady || this.cardActionReady;
            } catch (error) {
                this.lastError = error && error.message ? error.message : String(error || 'Unknown polling error');
                logger.warn('Feishu polling failed: ' + this.lastError);
            } finally {
                this.polling = false;
            }
        };

        logger.system(`启动飞书消息轮询桥接：profile=${config.profile} chats=${chatIds.length}`);
        poll();
        this.pollTimer = setInterval(poll, 5000);
    }

    async pollChatMessages(config, chatId) {
        const args = [
            '--profile', config.profile,
            'im', '+chat-messages-list',
            '--as', 'bot',
            '--chat-id', chatId,
            '--page-size', '10',
            '--format', 'json'
        ];
        const { stdout } = await execLarkCliAsync(config, args, {
            timeout: config.sendTimeoutMs,
            maxBuffer: 1024 * 1024
        });
        const payload = JSON.parse(stdout || '{}');
        const messages = payload && payload.data && Array.isArray(payload.data.messages)
            ? payload.data.messages
            : [];

        const ordered = [...messages].reverse();
        if (!this.pollSeededChatIds.has(chatId)) {
            for (const message of ordered) {
                const messageId = String(message.message_id || '').trim();
                if (messageId) {
                    this.pollSeenMessageIds.add(messageId);
                }
            }
            this.pollSeededChatIds.add(chatId);
            return;
        }

        for (const message of ordered) {
            const messageId = String(message.message_id || '').trim();
            if (!messageId || this.pollSeenMessageIds.has(messageId)) {
                continue;
            }

            this.pollSeenMessageIds.add(messageId);
            if (this.pollSeenMessageIds.size > 500) {
                this.pollSeenMessageIds = new Set(Array.from(this.pollSeenMessageIds).slice(-250));
            }

            const sender = message.sender || {};
            const senderType = String(sender.sender_type || '').trim();
            const msgType = String(message.msg_type || '').trim();
            if (senderType !== 'user' || msgType !== 'text') {
                continue;
            }

            const event = {
                type: 'im.message.receive_v1',
                event_id: messageId,
                timestamp: String(Date.now()),
                id: messageId,
                message_id: messageId,
                create_time: String(message.create_time || ''),
                chat_id: String(message.chat_id || chatId),
                chat_type: 'p2p',
                message_type: msgType,
                sender_id: String(sender.id || ''),
                content: String(message.content || '')
            };
            await this.handleEventLine(JSON.stringify(event));
        }
    }

    spawnConsumer(config) {
        const args = [
            '--profile', config.profile,
            'event', 'consume', config.eventKey,
            '--as', 'bot'
        ];

        const invocation = resolveLarkCliInvocation(config.cliPath);
        logger.system(`启动飞书 CLI 桥接：${invocation.display} ${args.join(' ')}`);
        this.consumerMode = this.sdkWsClient ? 'hybrid' : 'lark-cli';
        this.child = spawn(invocation.command, [...invocation.argsPrefix, ...args], {
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true,
            env: process.env
        });
        this.running = true;
        this.messageReady = false;
        this.ready = this.messageReady || this.cardActionReady;

        const stdoutReader = readline.createInterface({
            input: this.child.stdout
        });
        stdoutReader.on('line', line => {
            this.handleEventLine(line).catch(error => {
                this.lastError = error.message;
                logger.error('处理飞书 CLI 事件失败: ' + error.message);
            });
        });

        this.child.stderr.on('data', chunk => {
            const text = String(chunk || '').trim();
            if (!text) {
                return;
            }
            this.lastStderr = text.slice(-2000);
            if (text.includes(`[event] ready event_key=${config.eventKey}`)) {
                this.messageReady = true;
                this.ready = this.messageReady || this.cardActionReady;
                this.consumerMode = this.sdkWsClient ? 'hybrid' : 'lark-cli';
                logger.system(`飞书 CLI 桥接已就绪：${config.eventKey}`);
                return;
            }
            logger.info(`飞书 CLI: ${text}`);
        });

        this.child.on('error', error => {
            this.lastError = error.message;
            logger.error('飞书 CLI 桥接启动失败: ' + error.message);
        });

        this.child.on('exit', (code, signal) => {
            const wasManualStopping = this.manualStopping;
            this.messageReady = false;
            this.running = Boolean(this.sdkWsClient);
            this.ready = this.messageReady || this.cardActionReady;
            this.child = null;
            logger.warn(`飞书 CLI 桥接已退出，code=${code === null ? 'null' : code} signal=${signal || 'none'}`);

            if (!wasManualStopping && config.reconnect) {
                this.scheduleReconnect(config);
            }
        });
    }

    startSdkConsumer(config) {
        if (!Lark) {
            return false;
        }

        const credentials = readLarkCliProfileCredentials(config.profile);
        if (!credentials) {
            logger.warn('未能从 lark-cli profile 读取飞书应用凭据，回退到 lark-cli 事件桥接');
            return false;
        }

        const domain = credentials.brand === 'lark' ? Lark.Domain.Lark : Lark.Domain.Feishu;
        const dispatcher = new Lark.EventDispatcher({
            loggerLevel: Lark.LoggerLevel.warn
        }).register({
            'im.message.receive_v1': async data => {
                await this.handleSdkMessageEvent(data);
            },
            'card.action.trigger': async data => {
                await this.handleCardActionEvent(data);
            }
        });

        this.consumerMode = this.child ? 'hybrid' : 'sdk';
        this.running = true;
        this.cardActionReady = false;
        this.ready = this.messageReady || this.cardActionReady;
        this.sdkWsClient = new Lark.WSClient({
            appId: credentials.appId,
            appSecret: credentials.appSecret,
            domain,
            loggerLevel: Lark.LoggerLevel.warn,
            onReady: () => {
                this.messageReady = true;
                this.cardActionReady = true;
                this.ready = this.messageReady || this.cardActionReady;
                this.consumerMode = this.child ? 'hybrid' : 'sdk';
                this.sdkReadyOnce = true;
                this.reconnectAttempts = 0;
                logger.system('飞书 SDK 长连接桥接已就绪：消息指令 + 卡片按钮');
            },
            onError: error => {
                const message = error && error.message ? error.message : String(error || '未知错误');
                this.lastError = message;
                this.messageReady = false;
                this.cardActionReady = false;
                this.ready = this.messageReady || this.cardActionReady;
                logger.error('飞书 SDK 长连接错误: ' + message);
                if (!this.sdkReadyOnce && !this.child) {
                    this.fallbackToLarkCli(config, message);
                }
            },
            onReconnecting: () => {
                this.messageReady = false;
                this.cardActionReady = false;
                this.ready = this.messageReady || this.cardActionReady;
                this.reconnectAttempts += 1;
                logger.warn('飞书 SDK 长连接正在重连...');
            },
            onReconnected: () => {
                this.messageReady = true;
                this.cardActionReady = true;
                this.ready = this.messageReady || this.cardActionReady;
                logger.system('飞书 SDK 长连接已恢复');
            }
        });

        this.sdkWsStartPromise = Promise.resolve(this.sdkWsClient.start({ eventDispatcher: dispatcher }))
            .catch(error => {
                const message = error && error.message ? error.message : String(error || '未知错误');
                this.lastError = message;
                this.messageReady = false;
                this.cardActionReady = false;
                this.running = Boolean(this.child);
                this.ready = this.messageReady || this.cardActionReady;
                logger.error('飞书 SDK 长连接启动失败: ' + message);
                if (!this.child) {
                    this.fallbackToLarkCli(config, message);
                }
            });

        logger.system(`启动飞书 SDK 长连接桥接：profile=${config.profile}`);
        return true;
    }

    fallbackToLarkCli(config, reason) {
        if (this.manualStopping || this.sdkFallbackStarted || this.child) {
            return;
        }

        this.sdkFallbackStarted = true;
        try {
            if (this.sdkWsClient) {
                this.sdkWsClient.close({ force: true });
            }
        } catch {}

        this.sdkWsClient = null;
        this.sdkWsStartPromise = null;
        this.running = false;
        this.ready = false;
        logger.warn(`飞书 SDK 长连接不可用，回退到 lark-cli 消息桥接：${reason || '未知原因'}`);
        this.spawnConsumer(config);
    }

    async handleSdkMessageEvent(data) {
        await this.handleEventLine(JSON.stringify({
            event: data || {}
        }));
    }

    async handleCardActionEvent(rawEvent) {
        this.lastEventAt = new Date().toISOString();
        const config = this.currentConfig || this.configReader();
        const normalized = Lark && typeof Lark.normalizeCardAction === 'function'
            ? Lark.normalizeCardAction(rawEvent, { includeRaw: true })
            : null;

        const rawActionValue = normalized && normalized.action ? normalized.action.value : null;
        let actionValue = {};
        if (rawActionValue && typeof rawActionValue === 'object') {
            actionValue = rawActionValue;
        } else if (typeof rawActionValue === 'string' && rawActionValue.trim()) {
            try {
                const parsedValue = JSON.parse(rawActionValue);
                if (parsedValue && typeof parsedValue === 'object') {
                    actionValue = parsedValue;
                }
            } catch {}
        }
        const action = String(actionValue.action || '').trim();
        const token = String(actionValue.token || '').trim();
        const chatId = String(actionValue.chatId || actionValue.chat_id || (normalized && normalized.chatId) || '').trim();
        const senderId = String(normalized && normalized.operator && normalized.operator.openId || '').trim();

        if (!action) {
            logger.warn('飞书卡片按钮事件缺少 action');
            return;
        }

        const guard = accessGuard({ chatId, senderId }, config);
        if (!guard.allowed) {
            if (!guard.silent && guard.message) {
                setImmediate(() => {
                    this.sendMessage(guard.message, chatId ? { chatId } : {}).catch(error => {
                        logger.warn('发送飞书按钮权限提示失败: ' + error.message);
                    });
                });
            }
            return;
        }

        if (!config.cardActionToken || token !== config.cardActionToken) {
            setImmediate(() => {
                this.sendMessage('飞书卡片按钮 token 无效，请重新发送控制面板卡片。', chatId ? { chatId } : {}).catch(error => {
                    logger.warn('发送飞书按钮 token 提示失败: ' + error.message);
                });
            });
            return;
        }

        const actionLabel = CARD_ACTIONS[action] ? CARD_ACTIONS[action].label : action || '未知动作';
        setImmediate(() => {
            this.executeCardActionAsync({ action, actionLabel, chatId, config }).catch(error => {
                const message = error && error.message ? error.message : String(error || '未知错误');
                this.lastError = message;
                logger.error('处理飞书卡片按钮失败: ' + message);
                this.sendMessage(`飞书卡片按钮执行失败：${message}`, chatId ? { chatId } : {}).catch(() => {});
            });
        });
    }

    async executeCardActionAsync({ action, actionLabel, chatId, config }) {
        const controlService = new FeishuControlService({
            apiBaseUrl: config.controlApiBaseUrl,
            timeoutMs: config.sendTimeoutMs
        });
        const result = await controlService.executeControlAction(action);
        const success = result && result.success !== false;
        const message = result && result.message ? result.message : (success ? '已执行' : '执行失败');
        const cardOptions = result && result.cardOptions && typeof result.cardOptions === 'object' ? result.cardOptions : {};

        await this.sendControlCard({
            chatId,
            title: `按钮执行：${actionLabel}`,
            summary: message,
            template: success ? 'green' : 'red',
            footer: `来自飞书卡片按钮：${actionLabel}`,
            ...cardOptions
        });
    }

    scheduleReconnect(config) {
        if (this.reconnectTimer) {
            return;
        }

        this.reconnectAttempts += 1;
        const delay = Math.min(
            config.maxReconnectDelayMs,
            config.reconnectDelayMs * Math.max(1, this.reconnectAttempts)
        );
        logger.warn(`飞书 CLI 桥接将在 ${Math.round(delay / 1000)} 秒后尝试重连`);
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            if (!this.manualStopping && !this.child) {
                this.spawnConsumer(config);
            }
        }, delay);
    }

    async handleEventLine(line) {
        const trimmed = String(line || '').trim();
        if (!trimmed) {
            return;
        }

        let event;
        try {
            event = JSON.parse(trimmed);
        } catch (error) {
            this.lastError = `飞书事件 JSON 解析失败：${error.message}`;
            logger.warn(this.lastError);
            return;
        }

        this.lastEventAt = new Date().toISOString();
        const config = this.currentConfig || this.configReader();
        const result = await this.router.handleEvent(event, config);
        if (!result || result.ignored || (!result.replyText && !result.replyCard)) {
            const normalizedEvent = result && result.event ? result.event : {};
            const reason = result && result.reason ? result.reason : (result && result.ignored ? 'ignored' : 'empty_reply');
            logger.info([
                '飞书消息事件未回复',
                `reason=${reason}`,
                `chat=${normalizedEvent.chatId || 'unknown'}`,
                `chatType=${normalizedEvent.chatType || 'unknown'}`,
                `sender=${normalizedEvent.senderId || 'unknown'}`,
                `message=${normalizedEvent.messageId || 'unknown'}`,
                `text=${String(normalizedEvent.text || '').slice(0, 80)}`
            ].join(' '));
            return;
        }

        logger.info([
            '飞书消息事件已匹配',
            `chat=${result.event && result.event.chatId || 'unknown'}`,
            `chatType=${result.event && result.event.chatType || 'unknown'}`,
            `sender=${result.event && result.event.senderId || 'unknown'}`,
            `message=${result.event && result.event.messageId || 'unknown'}`,
            `reply=${result.replyCard ? 'card' : 'text'}`
        ].join(' '));

        if (result.replyCard) {
            await this.replyWithControlCard(result.event || event, result.replyCard, config);
            return;
        }

        await this.replyToEvent(result.event || event, result.replyText, config);
    }

    async stop() {
        this.manualStopping = true;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        this.reconnectAttempts = 0;
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
        this.polling = false;

        if (this.sdkWsClient) {
            try {
                this.sdkWsClient.close({ force: true });
            } catch (error) {
                logger.warn('关闭飞书 SDK 长连接失败: ' + error.message);
            }
            this.sdkWsClient = null;
            this.sdkWsStartPromise = null;
            this.cardActionReady = false;
            this.ready = this.messageReady || this.cardActionReady;
            if (!this.child) {
                this.running = false;
                this.messageReady = false;
                this.ready = false;
                return {
                success: true,
                message: '飞书 SDK 长连接桥接已停止',
                status: this.getStatus()
                };
            }
        }

        if (!this.child) {
            this.running = false;
            this.messageReady = false;
            this.cardActionReady = false;
            this.ready = false;
            return {
                success: true,
                message: '飞书 CLI 桥接未运行',
                status: this.getStatus()
            };
        }

        const child = this.child;
        await new Promise(resolve => {
            const timer = setTimeout(() => {
                if (!child.killed) {
                    child.kill('SIGTERM');
                }
                resolve();
            }, 2500);

            child.once('exit', () => {
                clearTimeout(timer);
                resolve();
            });

            try {
                if (child.stdin && !child.stdin.destroyed) {
                    child.stdin.end();
                } else {
                    child.kill('SIGTERM');
                }
            } catch {
                child.kill('SIGTERM');
            }
        });

        this.child = null;
        this.messageReady = false;
        this.cardActionReady = false;
        this.running = false;
        this.ready = false;
        return {
            success: true,
            message: '飞书 CLI 桥接已停止',
            status: this.getStatus()
        };
    }

    async replyToEvent(event, text, config = this.currentConfig || this.configReader()) {
        const messageId = String(event && (event.messageId || event.message_id || event.id) || '').trim();
        if (!messageId) {
            return {
                success: false,
                message: '飞书事件缺少 message_id，无法回复'
            };
        }

        const sdkClient = createSdkClientFromConfig(config);
        if (sdkClient) {
            try {
                await sdkClient.im.v1.message.reply({
                    path: { message_id: messageId },
                    data: {
                        msg_type: 'text',
                        content: JSON.stringify({ text: String(text || '').slice(0, 12000) }),
                        reply_in_thread: Boolean(config.replyInThread)
                    }
                });
                this.lastReplyAt = new Date().toISOString();
                return {
                    success: true,
                    message: '飞书消息已通过 SDK 回复'
                };
            } catch (error) {
                this.lastError = getSdkErrorMessage(error);
                logger.warn('飞书 SDK 回复失败，回退 lark-cli：' + this.lastError);
            }
        }

        const args = [
            '--profile', config.profile,
            'im', '+messages-reply',
            '--as', 'bot',
            '--message-id', messageId,
            '--markdown', String(text || '').slice(0, 12000),
            '--idempotency-key', createIdempotencyKey('reply')
        ];
        if (config.replyInThread) {
            args.push('--reply-in-thread');
        }

        await execLarkCliAsync(config, args, { timeout: config.sendTimeoutMs });
        this.lastReplyAt = new Date().toISOString();
        return {
            success: true,
            message: '飞书消息已回复'
        };
    }

    buildControlCard(cardOptions = {}, config = this.currentConfig || this.configReader()) {
        const token = config.cardActionToken || ensureFeishuCliCardActionToken();
        if (!config.cardActionToken) {
            this.currentConfig = this.configReader();
            config = this.currentConfig;
        }
        const chatId = String(cardOptions.chatId || config.notifyChatId || '').trim();
        return buildFeishuControlCard({
            ...cardOptions,
            baseUrl: cardOptions.baseUrl || config.cardActionBaseUrl || config.controlApiBaseUrl,
            enableButtons: cardOptions.enableButtons !== undefined ? cardOptions.enableButtons : this.cardActionReady,
            token,
            chatId
        });
    }

    async replyWithControlCard(event, cardOptions = {}, config = this.currentConfig || this.configReader()) {
        const messageId = String(event && (event.messageId || event.message_id || event.id) || '').trim();
        if (!messageId) {
            return {
                success: false,
                message: '飞书事件缺少 message_id，无法回复卡片'
            };
        }

        const eventChatId = String(event && (event.chatId || event.chat_id) || '').trim();
        const card = this.buildControlCard({
            ...cardOptions,
            chatId: cardOptions.chatId || eventChatId
        }, config);

        const sdkClient = createSdkClientFromConfig(config);
        if (sdkClient) {
            try {
                await sdkClient.im.v1.message.reply({
                    path: { message_id: messageId },
                    data: {
                        msg_type: 'interactive',
                        content: JSON.stringify(card),
                        reply_in_thread: Boolean(config.replyInThread)
                    }
                });
                this.lastReplyAt = new Date().toISOString();
                return {
                    success: true,
                    message: '飞书卡片已通过 SDK 回复'
                };
            } catch (error) {
                this.lastError = getSdkErrorMessage(error);
                logger.warn('飞书 SDK 回复卡片失败，回退 lark-cli：' + this.lastError);
            }
        }

        const args = [
            '--profile', config.profile,
            'im', '+messages-reply',
            '--as', 'bot',
            '--message-id', messageId,
            '--msg-type', 'interactive',
            '--content', JSON.stringify(card),
            '--idempotency-key', createIdempotencyKey('reply-card')
        ];
        if (config.replyInThread) {
            args.push('--reply-in-thread');
        }

        await execLarkCliAsync(config, args, { timeout: config.sendTimeoutMs });
        this.lastReplyAt = new Date().toISOString();
        return {
            success: true,
            message: '飞书卡片已回复'
        };
    }

    async sendMessage(text, options = {}) {
        const config = this.currentConfig || this.configReader(options);
        const chatId = String(options.chatId || config.notifyChatId || '').trim();
        if (!chatId) {
            return {
                success: false,
                message: '未配置飞书通知 chat_id'
            };
        }

        const sdkClient = createSdkClientFromConfig(config);
        if (sdkClient) {
            try {
                await sdkClient.im.v1.message.create({
                    params: { receive_id_type: 'chat_id' },
                    data: {
                        receive_id: chatId,
                        msg_type: 'text',
                        content: JSON.stringify({ text: String(text || '').slice(0, 12000) })
                    }
                });
                this.lastReplyAt = new Date().toISOString();
                return {
                    success: true,
                    message: '飞书消息已通过 SDK 发送',
                    chatId
                };
            } catch (error) {
                this.lastError = getSdkErrorMessage(error);
                logger.warn('飞书 SDK 发送消息失败，回退 lark-cli：' + this.lastError);
            }
        }

        const args = [
            '--profile', config.profile,
            'im', '+messages-send',
            '--as', 'bot',
            '--chat-id', chatId,
            '--markdown', String(text || '').slice(0, 12000),
            '--idempotency-key', createIdempotencyKey('send')
        ];

        await execLarkCliAsync(config, args, { timeout: config.sendTimeoutMs });
        this.lastReplyAt = new Date().toISOString();
        return {
            success: true,
            message: '飞书消息已发送',
            chatId
        };
    }

    async sendImage(imagePath, options = {}) {
        const config = this.currentConfig || this.configReader(options);
        const chatId = String(options.chatId || config.notifyChatId || '').trim();
        const safeImagePath = String(imagePath || '').trim();
        if (!chatId) {
            return {
                success: false,
                message: '未配置飞书通知 chat_id'
            };
        }
        if (!safeImagePath || !fs.existsSync(safeImagePath)) {
            return {
                success: false,
                message: '图片文件不存在，无法发送飞书图片'
            };
        }

        const args = [
            '--profile', config.profile,
            'im', '+messages-send',
            '--as', 'bot',
            '--chat-id', chatId,
            '--image', safeImagePath,
            '--idempotency-key', createIdempotencyKey('send-image')
        ];

        await execLarkCliAsync(config, args, { timeout: config.sendTimeoutMs });
        this.lastReplyAt = new Date().toISOString();
        return {
            success: true,
            message: '飞书图片已发送',
            chatId,
            imagePath: safeImagePath
        };
    }

    async sendControlCard(options = {}) {
        const config = this.currentConfig || this.configReader(options);
        const chatId = String(options.chatId || config.notifyChatId || '').trim();
        if (!chatId) {
            return {
                success: false,
                message: '未配置飞书通知 chat_id'
            };
        }

        const card = this.buildControlCard({
            ...options,
            chatId
        }, config);

        const sdkClient = createSdkClientFromConfig(config);
        if (sdkClient) {
            try {
                await sdkClient.im.v1.message.create({
                    params: { receive_id_type: 'chat_id' },
                    data: {
                        receive_id: chatId,
                        msg_type: 'interactive',
                        content: JSON.stringify(card)
                    }
                });
                this.lastReplyAt = new Date().toISOString();
                return {
                    success: true,
                    message: '飞书卡片已通过 SDK 发送',
                    chatId
                };
            } catch (error) {
                this.lastError = getSdkErrorMessage(error);
                logger.warn('飞书 SDK 发送卡片失败，回退 lark-cli：' + this.lastError);
            }
        }

        const args = [
            '--profile', config.profile,
            'im', '+messages-send',
            '--as', 'bot',
            '--chat-id', chatId,
            '--msg-type', 'interactive',
            '--content', JSON.stringify(card),
            '--idempotency-key', createIdempotencyKey('send-card')
        ];

        await execLarkCliAsync(config, args, { timeout: config.sendTimeoutMs });
        this.lastReplyAt = new Date().toISOString();
        return {
            success: true,
            message: '飞书卡片已发送',
            chatId
        };
    }
}

module.exports = new FeishuCliBridge();
module.exports.FeishuCliBridge = FeishuCliBridge;
module.exports.execFileAsync = execFileAsync;
module.exports.execLarkCliAsync = execLarkCliAsync;
module.exports.resolveLarkCliInvocation = resolveLarkCliInvocation;
