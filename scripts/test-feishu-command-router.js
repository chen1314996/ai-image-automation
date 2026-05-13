const assert = require('assert');
const {
    FeishuCommandRouter,
    normalizeFeishuEvent,
    detectCommand
} = require('../feishu-command-router');
const {
    buildFeishuControlCard
} = require('../feishu-card-builder');

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
    assert.strictEqual(detectCommand('继续上次停止或中断的创意拓展任务').type, 'continue_creative');
    assert.strictEqual(detectCommand('继续刚才的任务').type, 'continue_workflow');
    assert.strictEqual(detectCommand('开始量产').type, 'start_mass');
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
    assert.strictEqual(card.header.title.content, 'AI生图自动化平台');
    assert.ok(!JSON.stringify(card).includes('/api/feishu-cli/card-action'));
    assert.ok(JSON.stringify(card).includes('start_mass'));
    assert.ok(JSON.stringify(card).includes('continue_workflow'));
    assert.ok(JSON.stringify(card).includes('restart_server'));
    assert.ok(!JSON.stringify(card).includes('"action":"continue_creative"'));

    const visibleButtons = card.elements
        .filter(element => element.tag === 'action')
        .flatMap(element => element.actions || []);
    assert.strictEqual(visibleButtons.length, 6);
    assert.deepStrictEqual(
        visibleButtons.map(item => item.text.content),
        ['状态', '进度', '开始量产', '继续任务', '停止任务', '重启服务']
    );

    const textOnlyCard = buildFeishuControlCard({
        summary: '测试文字控制面板',
        enableButtons: false
    });
    assert.strictEqual(textOnlyCard.elements.filter(element => element.tag === 'action').length, 0);
    assert.ok(JSON.stringify(textOnlyCard).includes('开始量产 | 继续任务'));

    const normalized = normalizeFeishuEvent(event(' 状态 '));
    assert.strictEqual(normalized.text, '状态');
    assert.strictEqual(normalized.chatId, 'oc_allowed');
    assert.strictEqual(normalized.senderId, 'ou_allowed');

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

    result = await router.handleEvent(event('控制面板', { eventId: 'evt_panel' }), config);
    assert.ok(result.replyCard);
    assert.match(result.replyCard.title, /控制面板/);

    result = await router.handleEvent(event('重启工作流', { eventId: 'evt_restart' }), config);
    assert.match(result.replyText, /确认重启 3110/);
    assert.ok(!service.calls.includes('restartWorkflow'));

    result = await router.handleEvent(event('确认重启 3110', { eventId: 'evt_restart_confirm' }), config);
    assert.match(result.replyText, /workflow restarted/);
    assert.ok(service.calls.includes('restartWorkflow'));

    result = await router.handleEvent(event('状态', {
        eventId: 'evt_denied_chat',
        chatId: 'oc_other'
    }), config);
    assert.strictEqual(result.ignored, true);
    assert.strictEqual(result.reason, 'chat_not_allowed');

    result = await router.handleEvent(event('状态', {
        eventId: 'evt_denied_user',
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
