const assert = require('assert');
const {
    FeishuCommandRouter,
    normalizeFeishuEvent,
    detectCommand
} = require('../feishu-command-router');
const {
    buildFeishuControlCard
} = require('../feishu-card-builder');
const { FeishuCliBridge } = require('../feishu-cli-bridge');

function createMockService() {
    const calls = [];
    return {
        calls,
        async getStatusSummary() {
            calls.push('status');
            return 'STATUS_OK';
        },
        async getProgressSummary() {
            calls.push('progress');
            return 'PROGRESS_OK';
        },
        async getLogSummary() {
            calls.push('logs');
            return 'LOGS_OK';
        },
        async getBrowserSummary() {
            calls.push('browser');
            return 'BROWSER_OK';
        },
        async stopCreative() {
            calls.push('stopCreative');
            return { success: true, message: 'creative stopped' };
        },
        async continueCreative() {
            calls.push('continueCreative');
            return { success: true, message: 'creative continued' };
        },
        async stopAutomation() {
            calls.push('stopAutomation');
            return { success: true, message: 'automation stopped' };
        },
        async stopAll() {
            calls.push('stopAll');
            return { success: true, message: 'all stopped' };
        },
        async continueAutomation() {
            calls.push('continueAutomation');
            return { success: true, message: 'automation continued' };
        },
        async restartWorkflow() {
            calls.push('restartWorkflow');
            return { success: true, message: 'workflow restarted' };
        },
        async restartServer() {
            calls.push('restartServer');
            return { success: true, message: 'server restarting' };
        },
        async startMassProduction() {
            calls.push('startMassProduction');
            return { success: true, message: 'mass started' };
        },
        async startCreativePromptOnly() {
            calls.push('startCreativePromptOnly');
            return { success: true, message: 'prompts started' };
        },
        async startCreativeSmoke() {
            calls.push('startCreativeSmoke');
            return { success: true, message: 'smoke started' };
        },
        async startCreativeFullScale() {
            calls.push('startCreativeFullScale');
            return { success: true, message: 'full started' };
        },
        async executeControlAction(action) {
            calls.push(`action:${action}`);
            return { success: true, message: `${action} done` };
        }
    };
}

function event(content, overrides = {}) {
    return {
        event_id: overrides.eventId || `evt_${Math.random()}`,
        message_id: overrides.messageId || `om_${Math.random()}`,
        chat_id: overrides.chatId || 'oc_allowed',
        sender_id: overrides.senderId || 'ou_allowed',
        message_type: 'text',
        content
    };
}

(async () => {
    assert.strictEqual(detectCommand('看一下目前工作状态').type, 'status');
    assert.strictEqual(detectCommand('现在跑到哪了').type, 'progress');
    assert.strictEqual(detectCommand('停止创意拓展').type, 'stop_creative');
    assert.strictEqual(detectCommand('暂停创意').type, 'stop_creative');
    assert.strictEqual(detectCommand('继续上次停止或中断的创意拓展任务').type, 'continue_creative');
    assert.strictEqual(detectCommand('继续刚才的任务').type, 'continue_workflow');
    assert.strictEqual(detectCommand('开始量产').type, 'start_mass');
    assert.strictEqual(detectCommand('生成Prompt').type, 'start_creative_prompts');
    assert.strictEqual(detectCommand('小批量验证').type, 'start_creative_smoke');
    assert.strictEqual(detectCommand('持续生图').type, 'start_creative_full');
    assert.strictEqual(detectCommand('停止全部').type, 'stop_all');
    assert.strictEqual(detectCommand('交付面板').panel, 'delivery');
    assert.strictEqual(detectCommand('系统面板').panel, 'system');
    assert.strictEqual(detectCommand('素材状态').type, 'material_status');
    assert.strictEqual(detectCommand('知识库状态').type, 'knowledge_status');
    assert.strictEqual(detectCommand('重试失败Prompt').type, 'retry_failed_prompts');
    assert.strictEqual(detectCommand('重启工作流').type, 'restart_workflow');
    assert.strictEqual(detectCommand('绑定平台').type, 'pair');
    assert.strictEqual(detectCommand('控制面板').type, 'control_panel');

    const card = buildFeishuControlCard({
        summary: '测试控制面板',
        token: 'token_for_test',
        baseUrl: 'http://127.0.0.1:3066',
        chatId: 'oc_allowed',
        enableButtons: true
    });
    assert.strictEqual(card.header.title.content, 'AI图片生产远程控制台');
    assert.ok(!JSON.stringify(card).includes('/api/feishu-cli/card-action'));
    assert.ok(JSON.stringify(card).includes('token_for_test'));
    assert.ok(JSON.stringify(card).includes('panel_production'));
    assert.ok(JSON.stringify(card).includes('panel_delivery'));
    assert.ok(JSON.stringify(card).includes('panel_system'));
    assert.ok(JSON.stringify(card).includes('"action":"stop_all"'));
    assert.ok(!JSON.stringify(card).includes('"action":"start_creative_prompts"'));
    assert.ok(!JSON.stringify(card).includes('"action":"panel_material"'));

    const visibleButtons = card.elements
        .filter(element => element.tag === 'action')
        .flatMap(element => element.actions || []);
    assert.strictEqual(visibleButtons.length, 8);
    assert.deepStrictEqual(
        visibleButtons.map(item => item.text.content),
        ['状态', '进度', '继续任务', '停止全部', '生产面板', '交付面板', '日志', '系统面板']
    );

    const productionCard = buildFeishuControlCard({
        panel: 'production',
        summary: '测试生产面板',
        token: 'token_for_test',
        enableButtons: true
    });
    const productionButtons = productionCard.elements
        .filter(element => element.tag === 'action')
        .flatMap(element => element.actions || []);
    assert.ok(productionButtons.some(item => item.text.content === '生产状态'));
    assert.ok(productionButtons.some(item => item.text.content === '暂停创意'));
    assert.ok(!productionButtons.some(item => item.text.content === '开始量产'));

    const systemCard = buildFeishuControlCard({
        panel: 'system',
        summary: '测试系统面板',
        token: 'token_for_test',
        enableButtons: true
    });
    const systemButtons = systemCard.elements
        .filter(element => element.tag === 'action')
        .flatMap(element => element.actions || []);
    assert.deepStrictEqual(
        systemButtons.map(item => item.text.content),
        ['浏览器', '日志', '重启服务器', '主面板']
    );

    const textOnlyCard = buildFeishuControlCard({
        summary: '测试文字控制面板',
        enableButtons: false
    });
    assert.strictEqual(textOnlyCard.elements.filter(element => element.tag === 'action').length, 0);
    assert.ok(JSON.stringify(textOnlyCard).includes('重启服务器'));

    const normalized = normalizeFeishuEvent(event(' 状态 '));
    assert.strictEqual(normalized.text, '状态');
    assert.strictEqual(normalized.chatId, 'oc_allowed');
    assert.strictEqual(normalized.senderId, 'ou_allowed');

    const normalizedObjectSender = normalizeFeishuEvent({
        event_id: 'evt_object_sender',
        message_id: 'om_object_sender',
        chat_id: 'oc_private',
        sender_id: {
            open_id: 'ou_allowed'
        },
        message_type: 'text',
        content: '控制面板'
    });
    assert.strictEqual(normalizedObjectSender.senderId, 'ou_allowed');

    const normalizedSdkEvent = normalizeFeishuEvent({
        event: {
            event_id: 'evt_sdk_message',
            sender: {
                sender_type: 'user',
                sender_id: {
                    open_id: 'ou_allowed'
                }
            },
            message: {
                message_id: 'om_sdk_message',
                chat_id: 'oc_allowed',
                chat_type: 'p2p',
                message_type: 'text',
                content: JSON.stringify({ text: '面板' })
            }
        }
    });
    assert.strictEqual(normalizedSdkEvent.text, '面板');
    assert.strictEqual(normalizedSdkEvent.chatId, 'oc_allowed');
    assert.strictEqual(normalizedSdkEvent.senderId, 'ou_allowed');

    const service = createMockService();
    let now = 1000;
    const router = new FeishuCommandRouter({
        controlService: service,
        random: () => 0.2345,
        now: () => now
    });
    const config = {
        allowedChatIds: ['oc_allowed'],
        allowedUserIds: ['ou_allowed']
    };

    let result = await router.handleEvent(event('状态', { eventId: 'evt_status' }), config);
    assert.strictEqual(result.replyText, 'STATUS_OK');
    assert.deepStrictEqual(service.calls, ['status']);

    result = await router.handleEvent(event('状态', { eventId: 'evt_status' }), config);
    assert.strictEqual(result.ignored, true);
    assert.strictEqual(result.reason, 'duplicate');

    result = await router.handleEvent(event('停止创意拓展', { eventId: 'evt_stop_creative' }), config);
    assert.match(result.replyText, /creative stopped/);
    assert.ok(service.calls.includes('stopCreative'));

    result = await router.handleEvent(event('继续创意拓展', { eventId: 'evt_continue_creative' }), config);
    assert.match(result.replyText, /creative continued/);
    assert.ok(service.calls.includes('continueCreative'));

    result = await router.handleEvent(event('开始量产', { eventId: 'evt_start_mass' }), config);
    assert.match(result.replyText, /mass started/);
    assert.ok(service.calls.includes('startMassProduction'));

    result = await router.handleEvent(event('停止全部', { eventId: 'evt_stop_all' }), config);
    assert.match(result.replyText, /all stopped/);
    assert.ok(service.calls.includes('stopAll'));

    result = await router.handleEvent(event('生成Prompt', { eventId: 'evt_start_prompts' }), config);
    assert.match(result.replyText, /prompts started/);
    assert.ok(service.calls.includes('startCreativePromptOnly'));

    result = await router.handleEvent(event('小批量验证', { eventId: 'evt_start_smoke' }), config);
    assert.match(result.replyText, /smoke started/);
    assert.ok(service.calls.includes('startCreativeSmoke'));

    result = await router.handleEvent(event('控制面板', { eventId: 'evt_panel' }), config);
    assert.ok(result.replyCard);
    assert.match(result.replyCard.title, /远程控制台/);

    const bridge = new FeishuCliBridge({
        configReader: () => ({
            allowedChatIds: ['oc_allowed'],
            allowedUserIds: ['ou_allowed'],
            notifyChatId: 'oc_allowed',
            cardActionToken: 'token_for_test',
            controlApiBaseUrl: 'http://127.0.0.1:3066',
            cardActionBaseUrl: 'http://127.0.0.1:3066',
            sendTimeoutMs: 20000
        })
    });
    let asyncActionExecuted = false;
    bridge.executeCardActionAsync = async payload => {
        asyncActionExecuted = payload.action === 'progress';
    };
    const cardActionStartedAt = Date.now();
    await bridge.handleCardActionEvent({
        context: {
            open_message_id: 'om_card_action',
            open_chat_id: 'oc_allowed'
        },
        operator: {
            open_id: 'ou_allowed'
        },
        action: {
            tag: 'button',
            value: {
                action: 'progress',
                token: 'token_for_test',
                chatId: 'oc_allowed'
            }
        }
    });
    assert.ok(Date.now() - cardActionStartedAt < 100, 'card action handler should return quickly');
    await new Promise(resolve => setImmediate(resolve));
    assert.strictEqual(asyncActionExecuted, true);

    result = await router.handleEvent(event('交付面板', { eventId: 'evt_delivery_panel' }), config);
    assert.ok(result.replyCard);
    assert.strictEqual(result.replyCard.panel, 'delivery');

    result = await router.handleEvent(event('系统面板', { eventId: 'evt_system_panel' }), config);
    assert.ok(result.replyCard);
    assert.strictEqual(result.replyCard.panel, 'system');

    result = await router.handleEvent(event('重试失败Prompt', { eventId: 'evt_retry_failed' }), config);
    assert.match(result.replyText, /retry_failed_prompts done/);
    assert.ok(service.calls.includes('action:retry_failed_prompts'));

    result = await router.handleEvent(event('重启工作流', { eventId: 'evt_restart' }), config);
    assert.match(result.replyText, /确认重启 3110/);
    assert.ok(!service.calls.includes('restartWorkflow'));

    result = await router.handleEvent(event('确认重启 3110', { eventId: 'evt_restart_confirm' }), config);
    assert.match(result.replyText, /workflow restarted/);
    assert.ok(service.calls.includes('restartWorkflow'));

    result = await router.handleEvent(event('重启服务器', { eventId: 'evt_restart_server' }), config);
    assert.match(result.replyText, /确认重启服务 3110/);
    assert.ok(!service.calls.includes('restartServer'));

    result = await router.handleEvent(event('确认重启服务 3110', { eventId: 'evt_restart_server_confirm' }), config);
    assert.match(result.replyText, /server restarting/);
    assert.ok(service.calls.includes('restartServer'));

    result = await router.handleEvent(event('状态', {
        eventId: 'evt_allowed_user_private',
        chatId: 'oc_other'
    }), config);
    assert.strictEqual(result.replyText, 'STATUS_OK');

    result = await router.handleEvent(event('状态', {
        eventId: 'evt_allowed_chat_other_user',
        senderId: 'ou_other'
    }), config);
    assert.strictEqual(result.replyText, 'STATUS_OK');

    result = await router.handleEvent(event('状态', {
        eventId: 'evt_denied_chat_and_user',
        chatId: 'oc_other',
        senderId: 'ou_other'
    }), config);
    assert.match(result.replyText, /没有权限/);

    now += 11 * 60 * 1000;
    result = await router.handleEvent(event('确认重启 3110', { eventId: 'evt_expired_confirm' }), config);
    assert.match(result.replyText, /没有待确认/);

    let paired = null;
    const pairingRouter = new FeishuCommandRouter({
        controlService: createMockService(),
        onPair: async info => {
            paired = info;
        }
    });
    result = await pairingRouter.handleEvent(event('状态', { eventId: 'evt_pairing_status' }), {
        pairingEnabled: true,
        allowedChatIds: [],
        allowedUserIds: []
    });
    assert.match(result.replyText, /首次绑定模式/);

    result = await pairingRouter.handleEvent(event('绑定平台', { eventId: 'evt_pairing_bind' }), {
        pairingEnabled: true,
        allowedChatIds: [],
        allowedUserIds: []
    });
    assert.match(result.replyText, /绑定成功/);
    assert.strictEqual(paired.chatId, 'oc_allowed');
    assert.strictEqual(paired.userId, 'ou_allowed');

    console.log('Feishu command router tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
