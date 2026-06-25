/**
 * 飞书通知、飞书 CLI、飞书按钮回调和远程控制接口。
 */
module.exports = function registerFeishuRoutes(app, context) {
    const __dirname = context.rootDir;
    const {
        automationState,
        buildPlatformStatusText,
        CARD_ACTIONS,
        feishuCliBridge,
        FeishuControlService,
        getFeishuConfig,
        getSafeFeishuCliConfig,
        handleFeishuEvent,
        hasActiveCreativeAgentTask,
        isLoopbackRequest,
        logger,
        readFeishuCliConfig,
        renderFeishuCardActionPage,
        scheduleLocalServerRestart,
        sendFeishuText,
        validateFeishuCliConfig,
        verifyFeishuEventToken,
        workflowController
    } = context;



    app.get('/api/feishu/status', (req, res) => {
        const feishuConfig = getFeishuConfig();
        res.json({
            success: true,
            configured: {
                eventVerificationToken: Boolean(feishuConfig.verificationToken),
                botWebhookUrl: Boolean(feishuConfig.botWebhookUrl),
                botSecret: Boolean(feishuConfig.botSecret),
                allowedChatIds: feishuConfig.allowedChatIds.length
            },
            endpoints: {
                events: '/api/feishu/events',
                notify: '/api/feishu/notify'
            },
            supportedCommands: [
                '控制面板', '生产面板', '交付面板', '系统面板',
                '状态', '进度', '日志', '浏览器状态',
                '继续任务', '停止全部', '重启服务器',
                '继续创意', '暂停创意', '重试失败Prompt',
                '继续交付', '停止交付', '帮助'
            ]
        });
    });



    app.post('/api/feishu/notify', async (req, res) => {
        const text = typeof req.body?.text === 'string' && req.body.text.trim()
            ? req.body.text.trim()
            : buildPlatformStatusText();

        try {
            const result = await sendFeishuText(text);
            res.json(result);
        } catch (error) {
            res.status(500).json({
                success: false,
                message: '飞书消息发送失败：' + error.message
            });
        }
    });



    app.post('/api/feishu/events', (req, res) => {
        const body = req.body || {};

        if (body.encrypt) {
            return res.status(400).json({
                code: 1,
                msg: '暂未启用飞书加密事件解析，请先关闭事件加密或使用 verification token 校验'
            });
        }

        const verification = verifyFeishuEventToken(body);
        if (!verification.success) {
            return res.status(403).json({
                code: 1,
                msg: verification.message
            });
        }

        if (body.type === 'url_verification' && body.challenge) {
            return res.json({
                challenge: body.challenge
            });
        }

        res.json({
            code: 0,
            msg: 'ok'
        });

        setImmediate(async () => {
            try {
                const resultText = await handleFeishuEvent(body);
                if (resultText) {
                    await sendFeishuText(resultText);
                }
            } catch (error) {
                logger.error('处理飞书指令失败: ' + error.message);
                await sendFeishuText('处理飞书指令失败：' + error.message).catch(() => {});
            }
        });
    });



    app.get('/api/feishu-cli/status', (req, res) => {
        const config = readFeishuCliConfig();
        res.json({
            success: true,
            configured: getSafeFeishuCliConfig(config),
            validation: validateFeishuCliConfig(config),
            bridge: feishuCliBridge.getStatus(),
            commands: [
                '帮助', '控制面板', '生产面板', '交付面板', '系统面板',
                '状态', '进度', '继续任务', '停止全部', '日志', '浏览器状态',
                '重启服务器', '继续创意', '暂停创意', '重试失败Prompt',
                '继续交付', '停止交付'
            ]
        });
    });



    app.post('/api/feishu-cli/test-card-action', async (req, res) => {
        if (!isLoopbackRequest(req)) {
            return res.status(403).json({
                success: false,
                message: '该接口仅允许本机访问。'
            });
        }

        const config = readFeishuCliConfig();
        const action = typeof req.body?.action === 'string' && req.body.action.trim()
            ? req.body.action.trim()
            : 'progress';
        const chatId = config.notifyChatId || config.allowedChatIds[0] || '';
        const senderId = config.allowedUserIds[0] || '';

        if (!chatId || !senderId || !config.cardActionToken) {
            return res.json({
                success: false,
                message: '飞书卡片按钮测试缺少 chat_id、user_id 或 token 配置。'
            });
        }

        try {
            await feishuCliBridge.handleCardActionEvent({
                context: {
                    open_message_id: `om_local_test_${Date.now()}`,
                    open_chat_id: chatId
                },
                operator: {
                    open_id: senderId
                },
                action: {
                    tag: 'button',
                    value: {
                        action,
                        token: config.cardActionToken,
                        chatId
                    }
                }
            });

            res.json({
                success: true,
                message: `飞书卡片按钮测试已执行：${action}`,
                bridge: feishuCliBridge.getStatus()
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                message: '飞书卡片按钮测试失败：' + error.message,
                bridge: feishuCliBridge.getStatus()
            });
        }
    });



    app.post('/api/server/restart', (req, res) => {
        if (!isLoopbackRequest(req)) {
            return res.status(403).json({
                success: false,
                message: '该接口仅允许本机访问。'
            });
        }

        if (workflowController.isRunning || automationState.legilTaskRunning || hasActiveCreativeAgentTask()) {
            return res.json({
                success: false,
                message: '当前有任务正在运行，请先停止工作流、创意拓展或 Agent 任务后再重启服务器。'
            });
        }

        const result = scheduleLocalServerRestart({
            delayMs: req.body && req.body.delayMs,
            reason: req.body && req.body.reason ? req.body.reason : '飞书按钮'
        });

        res.json(result);
    });



    app.get('/api/feishu-cli/card-action', async (req, res) => {
        const config = readFeishuCliConfig();
        const token = String(req.query.token || '').trim();
        const action = String(req.query.action || '').trim();
        const requestedChatId = String(req.query.chat_id || '').trim();

        if (!isLoopbackRequest(req)) {
            return res.status(403).send(renderFeishuCardActionPage('按钮执行被拒绝', '该接口仅允许本机访问。', false));
        }

        if (!config.cardActionToken || token !== config.cardActionToken) {
            return res.status(403).send(renderFeishuCardActionPage('按钮执行被拒绝', '卡片按钮 token 无效，请重新发送控制面板卡片。', false));
        }

        const chatId = requestedChatId && config.allowedChatIds.includes(requestedChatId)
            ? requestedChatId
            : config.notifyChatId;
        const actionLabel = CARD_ACTIONS[action] ? CARD_ACTIONS[action].label : action || '未知动作';

        try {
            const controlService = new FeishuControlService({
                apiBaseUrl: config.controlApiBaseUrl,
                timeoutMs: config.sendTimeoutMs
            });
            const result = await controlService.executeControlAction(action);
            const success = result && result.success !== false;
            const message = result && result.message ? result.message : (success ? '已执行' : '执行失败');
            const cardOptions = result && result.cardOptions && typeof result.cardOptions === 'object' ? result.cardOptions : {};
            const title = `按钮执行：${actionLabel}`;

            await feishuCliBridge.sendControlCard({
                chatId,
                title,
                summary: message,
                template: success ? 'green' : 'red',
                footer: `来自卡片按钮：${actionLabel}`,
                ...cardOptions
            }).catch(error => {
                logger.warn('发送飞书按钮结果卡片失败: ' + error.message);
            });

            const shouldAutoClose = success && String(req.query.close || '1') !== '0';
            res.send(renderFeishuCardActionPage(
                success ? '已执行' : '执行失败',
                `${title}\n\n${message}`,
                success,
                { autoClose: shouldAutoClose }
            ));
        } catch (error) {
            logger.error('处理飞书卡片按钮失败: ' + error.message);
            await feishuCliBridge.sendMessage(`飞书卡片按钮执行失败：${error.message}`, chatId ? { chatId } : {}).catch(() => {});
            res.status(500).send(renderFeishuCardActionPage('执行失败', error.message, false));
        }
    });



    app.post('/api/feishu-cli/start', async (req, res) => {
        try {
            const result = await feishuCliBridge.start(req.body && typeof req.body === 'object' ? req.body : {});
            res.json(result);
        } catch (error) {
            res.status(500).json({
                success: false,
                message: '启动飞书 CLI 桥接失败：' + error.message,
                status: feishuCliBridge.getStatus()
            });
        }
    });



    app.post('/api/feishu-cli/stop', async (req, res) => {
        try {
            const result = await feishuCliBridge.stop();
            res.json(result);
        } catch (error) {
            res.status(500).json({
                success: false,
                message: '停止飞书 CLI 桥接失败：' + error.message,
                status: feishuCliBridge.getStatus()
            });
        }
    });



    app.post('/api/feishu-cli/test-send', async (req, res) => {
        const text = typeof req.body?.text === 'string' && req.body.text.trim()
            ? req.body.text.trim()
            : `AI生图自动化平台飞书 CLI 通知测试成功\n时间：${new Date().toLocaleString('zh-CN', { hour12: false })}`;
        const chatId = typeof req.body?.chatId === 'string' ? req.body.chatId.trim() : '';

        try {
            const result = await feishuCliBridge.sendMessage(text, chatId ? { chatId } : {});
            res.json(result);
        } catch (error) {
            res.status(500).json({
                success: false,
                message: '飞书 CLI 消息发送失败：' + error.message
            });
        }
    });



    app.post('/api/feishu-cli/send-card', async (req, res) => {
        const title = typeof req.body?.title === 'string' && req.body.title.trim()
            ? req.body.title.trim()
            : 'AI图片生产远程控制台';
        const summary = typeof req.body?.summary === 'string' && req.body.summary.trim()
            ? req.body.summary.trim()
            : '远程值班面板：查看状态、进度、日志，必要时继续、停止或进入系统面板重启服务器。';
        const chatId = typeof req.body?.chatId === 'string' ? req.body.chatId.trim() : '';

        try {
            const result = await feishuCliBridge.sendControlCard({
                title,
                summary,
                chatId
            });
            res.json(result);
        } catch (error) {
            res.status(500).json({
                success: false,
                message: '飞书 CLI 卡片发送失败：' + error.message
            });
        }
    });
};
