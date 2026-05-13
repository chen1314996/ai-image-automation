const { FeishuControlService } = require('./feishu-control-service');

const DEFAULT_CONFIRM_TTL_MS = 5 * 60 * 1000;
const DEFAULT_DEDUP_TTL_MS = 10 * 60 * 1000;

function normalizeCommandText(text) {
    return String(text || '')
        .replace(/<at[^>]*>.*?<\/at>/g, '')
        .replace(/@\S+/g, '')
        .replace(/[，。！？；：]/g, match => {
            const map = {
                '，': ',',
                '。': '.',
                '！': '!',
                '？': '?',
                '；': ';',
                '：': ':'
            };
            return map[match] || match;
        })
        .replace(/\s+/g, ' ')
        .trim();
}

function extractTextFromEvent(event) {
    if (!event || typeof event !== 'object') {
        return '';
    }

    if (typeof event.content === 'string') {
        return event.content;
    }

    const nestedMessage = event.event && event.event.message ? event.event.message : null;
    if (nestedMessage && typeof nestedMessage.content === 'string') {
        try {
            const parsed = JSON.parse(nestedMessage.content);
            return parsed.text || nestedMessage.content;
        } catch {
            return nestedMessage.content;
        }
    }

    return '';
}

function normalizeFeishuEvent(event) {
    const nestedEvent = event && event.event ? event.event : {};
    const header = event && event.header ? event.header : {};
    const nestedMessage = nestedEvent.message || {};
    return {
        raw: event,
        eventId: String(event && (event.event_id || event.uuid || event.eventId) || nestedEvent.event_id || header.event_id || '').trim(),
        messageId: String(event && (event.message_id || event.id) || nestedMessage.message_id || '').trim(),
        chatId: String(event && event.chat_id || nestedMessage.chat_id || '').trim(),
        chatType: String(event && event.chat_type || nestedMessage.chat_type || '').trim(),
        senderId: String(event && event.sender_id || (nestedEvent.sender && nestedEvent.sender.sender_id && nestedEvent.sender.sender_id.open_id) || '').trim(),
        messageType: String(event && event.message_type || nestedMessage.message_type || '').trim(),
        text: normalizeCommandText(extractTextFromEvent(event))
    };
}

function accessGuard(event, config) {
    const allowedChatIds = Array.isArray(config.allowedChatIds) ? config.allowedChatIds : [];
    const allowedUserIds = Array.isArray(config.allowedUserIds) ? config.allowedUserIds : [];

    if (!allowedChatIds.length && !allowedUserIds.length && config.pairingEnabled) {
        return {
            allowed: true,
            pairingOnly: true,
            silent: false,
            message: ''
        };
    }

    if (!allowedChatIds.length && !allowedUserIds.length) {
        return {
            allowed: false,
            silent: false,
            message: '飞书控制尚未配置白名单。请先配置 feishuCliAllowedChatIds 或 feishuCliAllowedUserIds。'
        };
    }

    if (allowedChatIds.length && !allowedChatIds.includes(event.chatId)) {
        return {
            allowed: false,
            silent: true,
            message: ''
        };
    }

    if (allowedUserIds.length && !allowedUserIds.includes(event.senderId)) {
        return {
            allowed: false,
            silent: false,
            message: '你没有权限控制 AI生图自动化平台。'
        };
    }

    return {
        allowed: true,
        silent: false,
        message: ''
    };
}

function buildHelpText() {
    return [
        '**AI生图控制指令**',
        '帮助：查看可用指令',
        '状态 / 进度：查看运行状态和任务进度',
        '开始量产 / 继续任务：启动量产或继续可恢复任务',
        '停止工作流：停止当前完整工作流或 Legil/创意拓展任务',
        '日志 / 浏览器状态：查看最近日志或浏览器状态',
        '继续创意拓展 / 停止创意拓展：单独控制创意拓展任务',
        '重启工作流：二次确认后按默认配置重启',
        '',
        '安全限制：只处理白名单群或白名单用户消息，不执行任意 shell 命令。'
    ].join('\n');
}

function createConfirmationCode(random = Math.random) {
    return String(Math.floor(1000 + random() * 9000));
}

function confirmationKey(event) {
    return `${event.chatId || 'unknown-chat'}:${event.senderId || 'unknown-user'}`;
}

function isPairCommand(text) {
    return /绑定平台|绑定机器人|绑定控制台|绑定飞书|bind/i.test(String(text || ''));
}

function isConfirmationText(text) {
    return /^确认/.test(text) && /\d{4}/.test(text);
}

function detectCommand(text) {
    if (!text) {
        return { type: 'empty' };
    }

    if (/控制面板|卡片|按钮|菜单|面板|panel|menu/i.test(text)) {
        return { type: 'control_panel' };
    }

    if (/帮助|help|指令|怎么用/i.test(text)) {
        return { type: 'help' };
    }

    if (isPairCommand(text)) {
        return { type: 'pair' };
    }

    if (/重启服务|重启服务器|restart server/i.test(text)) {
        return { type: 'restart_service' };
    }

    if (/重启|重新开始|restart/i.test(text)) {
        return { type: 'restart_workflow' };
    }

    if (/开始.*量产|启动.*量产|量产开始|start.*mass|mass.*start/i.test(text)) {
        return { type: 'start_mass' };
    }

    if (/继续.*创意|恢复.*创意|continue.*creative|resume.*creative/i.test(text)) {
        return { type: 'continue_creative' };
    }

    if (/停止.*创意|停.*创意|stop.*creative/i.test(text)) {
        return { type: 'stop_creative' };
    }

    if (/停止.*完整|停止.*主流程|停止.*全流程|停止.*工作流|停.*工作流|stop.*workflow/i.test(text)) {
        return { type: 'stop_workflow' };
    }

    if (/继续.*完整|继续.*工作流|恢复.*工作流|继续.*任务|继续.*刚才|continue|resume/i.test(text)) {
        return { type: 'continue_workflow' };
    }

    if (/浏览器|browser/i.test(text)) {
        return { type: 'browser_status' };
    }

    if (/日志|log|最近.*记录/i.test(text)) {
        return { type: 'logs' };
    }

    if (/进度|跑到哪|做到哪|目前工作进度|当前工作进度|progress/i.test(text)) {
        return { type: 'progress' };
    }

    if (/状态|检查|目前工作状态|当前工作状态|服务状态|status/i.test(text)) {
        return { type: 'status' };
    }

    return { type: 'unknown' };
}

class FeishuCommandRouter {
    constructor(options = {}) {
        this.controlService = options.controlService || new FeishuControlService({
            apiBaseUrl: options.controlApiBaseUrl
        });
        this.random = options.random || Math.random;
        this.now = options.now || (() => Date.now());
        this.onPair = typeof options.onPair === 'function' ? options.onPair : null;
        this.confirmTtlMs = options.confirmTtlMs || DEFAULT_CONFIRM_TTL_MS;
        this.dedupTtlMs = options.dedupTtlMs || DEFAULT_DEDUP_TTL_MS;
        this.pendingConfirmations = new Map();
        this.seenEvents = new Map();
    }

    cleanup() {
        const now = this.now();
        for (const [key, value] of this.pendingConfirmations.entries()) {
            if (!value || value.expiresAt <= now) {
                this.pendingConfirmations.delete(key);
            }
        }
        for (const [key, expiresAt] of this.seenEvents.entries()) {
            if (expiresAt <= now) {
                this.seenEvents.delete(key);
            }
        }
    }

    isDuplicate(event) {
        const id = event.eventId || event.messageId;
        if (!id) {
            return false;
        }
        this.cleanup();
        if (this.seenEvents.has(id)) {
            return true;
        }
        this.seenEvents.set(id, this.now() + this.dedupTtlMs);
        return false;
    }

    async handleEvent(rawEvent, config = {}) {
        const event = normalizeFeishuEvent(rawEvent);
        if (!event.text) {
            return { ignored: true, reason: 'empty' };
        }

        if (this.isDuplicate(event)) {
            return { ignored: true, reason: 'duplicate' };
        }

        const guard = accessGuard(event, config);
        if (!guard.allowed) {
            return {
                ignored: guard.silent,
                replyText: guard.silent ? '' : guard.message,
                reason: guard.silent ? 'chat_not_allowed' : 'user_not_allowed'
            };
        }

        if (guard.pairingOnly && !isPairCommand(event.text)) {
            return {
                ignored: false,
                replyText: 'AI生图自动化平台正在首次绑定模式。请发送：绑定平台',
                reason: 'pairing_required'
            };
        }

        const reply = await this.executeText(event.text, event);
        const replyText = typeof reply === 'string'
            ? reply
            : (reply && typeof reply.replyText === 'string' ? reply.replyText : '');
        const replyCard = reply && typeof reply === 'object' ? reply.replyCard : null;
        return {
            ignored: !replyText && !replyCard,
            replyText,
            replyCard,
            event
        };
    }

    async executeText(text, event = {}) {
        const normalizedText = normalizeCommandText(text);
        const key = confirmationKey(event);

        if (isConfirmationText(normalizedText)) {
            return await this.executeConfirmation(normalizedText, key);
        }

        const command = detectCommand(normalizedText);
        switch (command.type) {
            case 'empty':
                return '';
            case 'help':
                return {
                    replyCard: {
                        title: 'AI生图控制面板',
                        summary: `${buildHelpText()}\n\n常用操作可直接点按钮。`
                    }
                };
            case 'control_panel':
                return {
                    replyCard: {
                        title: 'AI生图控制面板',
                        summary: '常用按钮已精简，其他操作继续发送文字指令。'
                    }
                };
            case 'pair':
                return await this.pairController(event);
            case 'status':
                return await this.controlService.getStatusSummary();
            case 'progress':
                return await this.controlService.getProgressSummary();
            case 'logs':
                return await this.controlService.getLogSummary();
            case 'browser_status':
                return await this.controlService.getBrowserSummary();
            case 'stop_creative': {
                const result = await this.controlService.stopCreative();
                return `停止创意拓展结果：${result.message || (result.success ? '已发送停止指令' : '执行失败')}`;
            }
            case 'continue_creative': {
                const result = await this.controlService.continueCreative();
                return `继续创意拓展结果：${result.message || (result.success ? '已启动' : '执行失败')}`;
            }
            case 'stop_workflow': {
                const result = await this.controlService.stopAutomation();
                return `停止工作流结果：${result.message || (result.success ? '已发送停止指令' : '执行失败')}`;
            }
            case 'start_mass': {
                const result = await this.controlService.startMassProduction();
                return `开始量产结果：${result.message || (result.success ? '已启动' : '执行失败')}`;
            }
            case 'continue_workflow': {
                const result = await this.controlService.continueAutomation();
                return `继续工作流结果：${result.message || (result.success ? '已启动' : '执行失败')}`;
            }
            case 'restart_service':
                return '暂未开放飞书直接重启服务器。为了避免中断正在生成的图片，请先用“状态”确认任务情况，再在本机执行服务重启。';
            case 'restart_workflow':
                return this.createRestartWorkflowConfirmation(key);
            default:
                return `未识别指令：“${normalizedText}”\n\n${buildHelpText()}`;
        }
    }

    async pairController(event) {
        if (!event.chatId || !event.senderId) {
            return '绑定失败：没有从飞书事件里读取到 chat_id 或 open_id。';
        }
        if (!this.onPair) {
            return '当前服务未启用自动绑定处理器。';
        }

        await this.onPair({
            chatId: event.chatId,
            userId: event.senderId,
            chatType: event.chatType
        });

        return [
            'AI生图自动化平台已绑定成功。',
            `控制会话：${event.chatId}`,
            `控制用户：${event.senderId}`,
            '现在可以发送：状态、进度、日志、停止创意拓展、继续创意拓展。'
        ].join('\n');
    }

    createRestartWorkflowConfirmation(key) {
        const code = createConfirmationCode(this.random);
        this.pendingConfirmations.set(key, {
            action: 'restart_workflow',
            code,
            expiresAt: this.now() + this.confirmTtlMs
        });

        return [
            '重启工作流属于高风险操作，可能会停止当前任务或清除完整工作流恢复状态。',
            `确认执行请输入：确认重启 ${code}`,
            '确认码 5 分钟内有效。'
        ].join('\n');
    }

    async executeConfirmation(text, key) {
        this.cleanup();
        const pending = this.pendingConfirmations.get(key);
        if (!pending) {
            return '没有待确认的操作，或确认码已过期。';
        }

        const matchedCode = text.match(/\d{4}/);
        if (!matchedCode || matchedCode[0] !== pending.code) {
            return '确认码不正确，操作未执行。';
        }

        this.pendingConfirmations.delete(key);
        if (pending.action === 'restart_workflow') {
            const result = await this.controlService.restartWorkflow();
            return `重启工作流结果：${result.message || (result.success ? '已启动' : '执行失败')}`;
        }

        return '未知确认操作，未执行。';
    }
}

module.exports = {
    FeishuCommandRouter,
    normalizeCommandText,
    normalizeFeishuEvent,
    detectCommand,
    buildHelpText,
    accessGuard,
    isPairCommand
};
