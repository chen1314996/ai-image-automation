// 配置面板：读取和保存豆包、Legil、通知、工作流、改尺寸、创意拓展配置。
        function normalizeBrowserMode(mode, fallback = 'headless') {
            if (mode === 'headless' || mode === 'headed') {
                return mode;
            }
            return fallback === 'headed' ? 'headed' : 'headless';
        }

        function getBrowserModeLabel(mode) {
            return normalizeBrowserMode(mode) === 'headless' ? '无头模式' : '有头模式';
        }

        function getBrowserModeNote(mode) {
            return normalizeBrowserMode(mode) === 'headless'
                ? '后台运行，不弹出浏览器窗口'
                : '显示浏览器窗口，便于观察流程';
        }

        function normalizePromptProvider(provider) {
            return 'lumos';
        }

        function getPromptProviderLabel(provider = config.workflowPromptGeneration.provider) {
            return 'Lumos Winky';
        }

        function getSelectedLumosModel() {
            const select = document.getElementById('lumosPromptModelSelect');
            const hiddenInput = document.getElementById('lumosPromptModel');
            return (select?.value || hiddenInput?.value || config.workflowPromptGeneration?.lumos?.model || '').trim();
        }

        function setLumosPromptModelFromSelect() {
            const selectedModel = getSelectedLumosModel();
            config.workflowPromptGeneration = config.workflowPromptGeneration || { provider: 'lumos', lumos: {} };
            config.workflowPromptGeneration.lumos = config.workflowPromptGeneration.lumos || {};
            config.workflowPromptGeneration.lumos.model = selectedModel;
            const hiddenInput = document.getElementById('lumosPromptModel');
            if (hiddenInput) hiddenInput.value = selectedModel;
            updatePromptGenerationInfo();
        }

        function updateLumosPromptCount() {
            const textarea = document.getElementById('lumosPromptTemplate');
            const counter = document.getElementById('lumosPromptCount');
            if (textarea && counter) {
                counter.textContent = `${textarea.value.length} 字`;
            }
        }

        function updatePromptProviderActiveState() {
            const provider = normalizePromptProvider(config.workflowPromptGeneration?.provider);
            document.querySelectorAll('[data-prompt-provider]').forEach(button => {
                button.classList.toggle('active', button.dataset.promptProvider === provider);
            });
        }

        function updatePromptProviderVisibility() {
            const provider = normalizePromptProvider(config.workflowPromptGeneration?.provider);
            document.querySelectorAll('[data-prompt-provider-panel]').forEach(panel => {
                panel.hidden = panel.dataset.promptProviderPanel !== provider;
            });
        }

        function getWorkflowPromptGenerationFromForm() {
            const current = config.workflowPromptGeneration || { provider: 'lumos', lumos: {} };
            const lumos = current.lumos || {};
            const model = getSelectedLumosModel() || lumos.model || '';
            const baseUrl = document.getElementById('lumosPromptApiUrl')?.value.trim() || lumos.baseUrl || '';
            const provider = document.getElementById('lumosPromptProvider')?.value.trim() || lumos.provider || '';
            const promptTemplate = document.getElementById('lumosPromptTemplate')?.value.trim() || lumos.promptTemplate || config.doubaoPromptTemplate || '';

            return {
                provider: normalizePromptProvider(current.provider),
                lumos: {
                    model,
                    baseUrl,
                    provider,
                    promptTemplate
                }
            };
        }

        function isGpt55LumosModel(option) {
            const text = `${option?.value || ''} ${option?.label || ''}`.toLowerCase();
            return /(^|[^a-z0-9])gpt-5\.5($|[^a-z0-9])/.test(text);
        }

        function compareGpt55LumosModels(a, b) {
            const getModelText = option => `${option?.value || ''} ${option?.label || ''}`.toLowerCase();
            const getModelDate = option => {
                const match = getModelText(option).match(/20\d{2}-\d{2}-\d{2}/);
                return match ? Date.parse(match[0]) || 0 : 0;
            };
            const getModelProScore = option => getModelText(option).includes('gpt-5.5-pro') ? 1 : 0;
            const dateDiff = getModelDate(b) - getModelDate(a);
            if (dateDiff !== 0) return dateDiff;
            const proDiff = getModelProScore(b) - getModelProScore(a);
            if (proDiff !== 0) return proDiff;
            return String(a.label || a.value).localeCompare(String(b.label || b.value));
        }

        function renderLumosModelOptions(models = []) {
            const select = document.getElementById('lumosPromptModelSelect');
            const status = document.getElementById('lumosPromptModelStatus');
            if (!select) return;

            const currentModel = config.workflowPromptGeneration?.lumos?.model || select.value || '';
            const safeModels = (Array.isArray(models) ? models : [])
                .map(option => {
                    const value = option && typeof option === 'object' ? option.value : option;
                    const label = option && typeof option === 'object' ? option.label : value;
                    return String(value || '').trim()
                        ? { value: String(value).trim(), label: String(label || value).trim() }
                        : null;
                })
                .filter(Boolean)
                .filter(isGpt55LumosModel)
                .sort(compareGpt55LumosModels);

            select.textContent = '';
            if (safeModels.length === 0) {
                const canKeepCurrentModel = isGpt55LumosModel({ value: currentModel, label: currentModel });
                const option = document.createElement('option');
                option.value = canKeepCurrentModel ? currentModel : '';
                option.textContent = canKeepCurrentModel ? `${currentModel}（当前 GPT-5.5 模型，等待刷新列表）` : '未读取到 GPT-5.5 系列模型';
                select.appendChild(option);
                select.value = canKeepCurrentModel ? currentModel : '';
                if (status) status.textContent = canKeepCurrentModel ? '暂未刷新到 GPT-5.5 系列模型列表，已保留当前模型' : '未读取到 GPT-5.5 系列模型，请点击刷新重试';
                setLumosPromptModelFromSelect();
                return;
            }

            safeModels.forEach(optionData => {
                const option = document.createElement('option');
                option.value = optionData.value;
                option.textContent = optionData.label || optionData.value;
                select.appendChild(option);
            });

            const hasCurrentModel = currentModel && safeModels.some(option => option.value === currentModel);
            select.value = hasCurrentModel ? currentModel : safeModels[0].value;
            if (status) {
                status.textContent = `已自动识别 ${safeModels.length} 个 GPT-5.5 系列模型`;
            }
            setLumosPromptModelFromSelect();
        }

        function renderPromptGenerationConfig(promptGeneration = {}) {
            const lumos = promptGeneration.lumos || {};
            config.workflowPromptGeneration = {
                provider: normalizePromptProvider(promptGeneration.provider),
                lumos: {
                    model: lumos.model || '',
                    baseUrl: lumos.baseUrl || '',
                    provider: lumos.provider || '',
                    promptTemplate: lumos.promptTemplate || config.doubaoPromptTemplate || '',
                    apiKeyConfigured: lumos.apiKeyConfigured === true,
                    apiKeySource: lumos.apiKeySource || '',
                    configured: lumos.configured === true
                },
                doubao: promptGeneration.doubao || {},
                lumosModels: config.workflowPromptGeneration?.lumosModels || []
            };

            const keyStatus = document.getElementById('lumosPromptApiKeyStatus');
            if (keyStatus) {
                keyStatus.value = config.workflowPromptGeneration.lumos.apiKeyConfigured
                    ? `已配置（${config.workflowPromptGeneration.lumos.apiKeySource || '后端'}）`
                    : '未配置';
            }
            const modelInput = document.getElementById('lumosPromptModel');
            if (modelInput) modelInput.value = config.workflowPromptGeneration.lumos.model || '';
            renderLumosModelOptions(config.workflowPromptGeneration.lumosModels || []);
            const apiUrlInput = document.getElementById('lumosPromptApiUrl');
            if (apiUrlInput) apiUrlInput.value = config.workflowPromptGeneration.lumos.baseUrl || '';
            const providerInput = document.getElementById('lumosPromptProvider');
            if (providerInput) providerInput.value = config.workflowPromptGeneration.lumos.provider || '';
            const promptTextarea = document.getElementById('lumosPromptTemplate');
            if (promptTextarea) {
                promptTextarea.value = config.workflowPromptGeneration.lumos.promptTemplate || '';
                updateLumosPromptCount();
            }

            updatePromptProviderActiveState();
            updatePromptProviderVisibility();
            updatePromptGenerationInfo();
        }

        function getSelectedPromptProviderReady() {
            const provider = normalizePromptProvider(config.workflowPromptGeneration?.provider);
            const lumos = config.workflowPromptGeneration.lumos || {};
            return Boolean(lumos.apiKeyConfigured && getSelectedLumosModel());
        }

        function updatePromptGenerationInfo() {
            const infoBox = document.getElementById('doubaoConfigInfo');
            const provider = normalizePromptProvider(config.workflowPromptGeneration?.provider);
            const label = getPromptProviderLabel(provider);
            const ready = getSelectedPromptProviderReady();
            updateStatus('doubao', ready, ready ? `${label}已配置` : `${label}待配置`);

            if (infoBox) {
                const model = getSelectedLumosModel() || '未选择';
                infoBox.className = ready ? 'info-box success' : 'info-box error';
                infoBox.textContent = ready
                    ? `✅ 当前提示词模型：Lumos Winky，模型：${model}`
                    : '❌ 当前选择 Lumos Winky，请确认后端密钥已配置，并从下拉列表选择模型';
            }
        }

        function setPromptProvider(provider) {
            config.workflowPromptGeneration = config.workflowPromptGeneration || { provider: 'lumos', lumos: {} };
            config.workflowPromptGeneration.provider = 'lumos';
            updatePromptProviderActiveState();
            updatePromptProviderVisibility();
            updatePromptGenerationInfo();
            if (config.workflowPromptGeneration.provider === 'lumos') {
                loadLumosPromptModels({ silent: true });
            }
            saveWorkflowConfig({ silent: true });
        }

        function setWorkflowBrowserMode(mode) {
            config.workflowBrowserMode = normalizeBrowserMode(mode, 'headless');
            updateWorkflowBrowserModeActiveState();
            if (typeof refreshLegilGenerationSummary === 'function') {
                refreshLegilGenerationSummary();
            }
            saveWorkflowConfig({ silent: true });
        }

        function updateWorkflowBrowserModeActiveState() {
            document.querySelectorAll('[data-workflow-browser-mode]').forEach(button => {
                button.classList.toggle('active', button.dataset.workflowBrowserMode === config.workflowBrowserMode);
            });
        }

        async function loadWorkflowConfig() {
            try {
                const res = await fetch('/api/config/workflow');
                const data = await readJsonResponse(res, '读取量产配置失败，请重启服务器后刷新页面');
                if (!data.success || !data.config) return;
                config.workflowBrowserMode = normalizeBrowserMode(data.config.browserMode || config.workflowBrowserMode, 'headless');
                renderPromptGenerationConfig(data.config.promptGeneration || {});
                updateWorkflowBrowserModeActiveState();
                loadLumosPromptModels({ silent: true });
                if (typeof refreshLegilGenerationSummary === 'function') {
                    refreshLegilGenerationSummary();
                }
            } catch (e) {
                updateWorkflowBrowserModeActiveState();
                if (typeof refreshLegilGenerationSummary === 'function') {
                    refreshLegilGenerationSummary();
                }
            }
        }

        async function saveWorkflowConfig(options = {}) {
            const silent = options.silent === true;
            try {
                const res = await fetch('/api/config/workflow', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        browserMode: config.workflowBrowserMode,
                        promptGeneration: getWorkflowPromptGenerationFromForm(),
                        generationSettings: config.legilGeneration
                    })
                });
                const data = await readJsonResponse(res, '保存量产配置失败，请重启服务器后刷新页面');
                if (!data.success || !data.config) {
                    throw new Error(data.message || '保存失败');
                }
                config.workflowBrowserMode = normalizeBrowserMode(data.config.browserMode || config.workflowBrowserMode, 'headless');
                renderPromptGenerationConfig(data.config.promptGeneration || {});
                updateWorkflowBrowserModeActiveState();
                return true;
            } catch (e) {
                if (!silent) showToast(e.message || '保存量产配置失败', 'error');
                return false;
            }
        }

        async function savePromptGenerationConfig(options = {}) {
            const silent = options.silent === true;
            const provider = normalizePromptProvider(config.workflowPromptGeneration?.provider);
            const infoBox = document.getElementById('doubaoConfigInfo');
            if (infoBox) {
                infoBox.className = 'info-box loading';
                infoBox.textContent = '保存提示词模型配置中...';
            }

            if (false && provider === 'doubao') {
                const doubaoSaved = await saveDoubaoConfig({ silent: true });
                if (!doubaoSaved) {
                    if (!silent) showToast('请先检查豆包配置', 'error');
                    updatePromptGenerationInfo();
                    return false;
                }
            } else {
                let model = getSelectedLumosModel();
                if (!model) {
                    await loadLumosPromptModels({ silent: true });
                    model = getSelectedLumosModel();
                }
                if (!model) {
                    if (infoBox) {
                        infoBox.className = 'info-box error';
                        infoBox.textContent = '❌ 请先从下拉列表选择 Lumos Winky 模型';
                    }
                    if (!silent) showToast('请先选择 Lumos Winky 模型', 'error');
                    return false;
                }
            }

            const saved = await saveWorkflowConfig({ silent: true });
            if (!saved) {
                if (!silent) showToast('提示词模型配置保存失败', 'error');
                return false;
            }

            updatePromptGenerationInfo();
            if (!silent) {
                const label = getPromptProviderLabel();
                showToast('提示词模型配置已保存');
                addLog(`✅ 提示词模型配置已保存：${label}`, 'success');
            }
            return true;
        }

        async function refreshPromptGenerationConfig() {
            await Promise.all([
                loadDoubaoConfig(),
                loadWorkflowConfig()
            ]);
            updatePromptGenerationInfo();
        }

        async function loadLumosPromptModels(options = {}) {
            const silent = options.silent === true;
            const infoBox = document.getElementById('doubaoConfigInfo');
            const status = document.getElementById('lumosPromptModelStatus');
            const select = document.getElementById('lumosPromptModelSelect');
            if (status) status.textContent = '正在自动读取 GPT-5.5 系列模型...';
            if (select && !select.value) {
                select.textContent = '';
                const option = document.createElement('option');
                option.value = '';
                option.textContent = '正在自动读取 GPT-5.5 系列模型...';
                select.appendChild(option);
            }
            if (infoBox && !silent) {
                infoBox.className = 'info-box loading';
                infoBox.textContent = '正在读取 Lumos Winky GPT-5.5 系列模型...';
            }

            try {
                const res = await fetch('/api/config/prompt-generation/lumos-models', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        promptGeneration: getWorkflowPromptGenerationFromForm()
                    })
                });
                const data = await readJsonResponse(res, '读取 Lumos 模型列表失败，请重启服务器后刷新页面');
                config.workflowPromptGeneration = config.workflowPromptGeneration || { provider: 'lumos', lumos: {} };
                config.workflowPromptGeneration.lumosModels = data.models || [];
                renderLumosModelOptions(data.models || []);
                if (infoBox && !silent) {
                    infoBox.className = data.success ? 'info-box success' : 'info-box error';
                    infoBox.textContent = (data.success ? '✅ ' : '❌ ') + (data.message || '模型列表读取完成');
                }
                updatePromptGenerationInfo();
                if (!data.success && !silent) {
                    showToast(data.message || '未读取到模型，请稍后重试', 'error');
                }
            } catch (e) {
                if (status) status.textContent = '模型列表读取失败，请点击刷新重试';
                if (infoBox && !silent) {
                    infoBox.className = 'info-box error';
                    infoBox.textContent = '❌ ' + e.message;
                }
                if (!silent) showToast(e.message || '读取 Lumos 模型列表失败', 'error');
            }
        }

        async function testPromptGenerationConfig() {
            const inputFolder = document.getElementById('referenceFolder')?.value.trim() || '';
            const infoBox = document.getElementById('doubaoConfigInfo');
            if (infoBox) {
                infoBox.className = 'info-box loading';
                infoBox.textContent = '正在测试提示词生成模型...';
            }

            const saved = await savePromptGenerationConfig({ silent: true });
            if (!saved) {
                return;
            }

            try {
                const res = await fetch('/api/prompt-generation/test', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        inputFolder,
                        promptGeneration: getWorkflowPromptGenerationFromForm()
                    })
                });
                const data = await readJsonResponse(res, '测试提示词生成失败，请重启服务器后刷新页面');
                if (!data.success) {
                    throw new Error(data.message || '测试失败');
                }
                if (infoBox) {
                    infoBox.className = 'info-box success';
                    infoBox.textContent = `✅ 测试成功：${getPromptProviderLabel(data.provider)} 返回 ${data.prompts.length} 组提示词`;
                }
                addLog(`✅ 提示词模型测试成功：${getPromptProviderLabel(data.provider)} / ${data.model || '默认模型'}，返回 ${data.prompts.length} 组`, 'success');
                showToast('提示词生成测试成功');
            } catch (e) {
                if (infoBox) {
                    infoBox.className = 'info-box error';
                    infoBox.textContent = '❌ ' + e.message;
                }
                addLog(`❌ 提示词模型测试失败：${e.message}`, 'error');
                showToast(e.message || '提示词生成测试失败', 'error');
            }
        }

        function readNotificationConfigFromForm() {
            const readChecked = (id, fallback) => {
                const el = document.getElementById(id);
                return el ? el.checked : fallback;
            };
            const readNumber = (id, fallback, min, max) => {
                const el = document.getElementById(id);
                const value = Number(el?.value);
                if (!Number.isFinite(value)) return fallback;
                return Math.max(min, Math.min(max, Math.round(value)));
            };

            return {
                feishuEnabled: readChecked('notifyFeishuEnabled', true),
                taskCompletionEnabled: readChecked('notifyTaskCompletionEnabled', true),
                serverStartupEnabled: readChecked('notifyServerStartupEnabled', true),
                staleProgressEnabled: readChecked('notifyStaleProgressEnabled', true),
                staleThresholdMinutes: readNumber('notifyStaleThresholdMinutes', 15, 1, 1440),
                notificationCooldownMinutes: readNumber('notifyCooldownMinutes', 10, 0, 1440),
                legilScreenshotEnabled: readChecked('notifyLegilScreenshotEnabled', true),
                autoRecoveryEnabled: readChecked('notifyAutoRecoveryEnabled', true),
                pauseOnConsecutiveFailures: readChecked('notifyPauseOnFailuresEnabled', true),
                consecutiveFailureThreshold: readNumber('notifyFailureThreshold', 3, 1, 20),
                watchdogAutoRestartEnabled: readChecked('notifyWatchdogRestartEnabled', true)
            };
        }

        function renderNotificationConfig(nextConfig = {}) {
            config.notifications = {
                ...config.notifications,
                ...(nextConfig && typeof nextConfig === 'object' ? nextConfig : {})
            };
            const boolMap = {
                notifyFeishuEnabled: 'feishuEnabled',
                notifyTaskCompletionEnabled: 'taskCompletionEnabled',
                notifyServerStartupEnabled: 'serverStartupEnabled',
                notifyStaleProgressEnabled: 'staleProgressEnabled',
                notifyLegilScreenshotEnabled: 'legilScreenshotEnabled',
                notifyAutoRecoveryEnabled: 'autoRecoveryEnabled',
                notifyPauseOnFailuresEnabled: 'pauseOnConsecutiveFailures',
                notifyWatchdogRestartEnabled: 'watchdogAutoRestartEnabled'
            };
            Object.entries(boolMap).forEach(([id, key]) => {
                const el = document.getElementById(id);
                if (el) el.checked = config.notifications[key] !== false;
            });
            const stale = document.getElementById('notifyStaleThresholdMinutes');
            const cooldown = document.getElementById('notifyCooldownMinutes');
            const failures = document.getElementById('notifyFailureThreshold');
            if (stale) stale.value = config.notifications.staleThresholdMinutes || 15;
            if (cooldown) cooldown.value = config.notifications.notificationCooldownMinutes ?? 10;
            if (failures) failures.value = config.notifications.consecutiveFailureThreshold || 3;
        }

        async function loadNotificationConfig() {
            try {
                const res = await fetch('/api/config/notifications');
                const data = await readJsonResponse(res, '读取通知配置失败，请重启服务器后刷新页面');
                if (data.success && data.config) {
                    renderNotificationConfig(data.config);
                    await refreshWatchdogStatus();
                }
            } catch (e) {
                renderNotificationConfig(config.notifications);
            }
        }

        async function saveNotificationConfig(options = {}) {
            const silent = options.silent === true;
            const infoBox = document.getElementById('notificationConfigInfo');
            const nextConfig = readNotificationConfigFromForm();
            try {
                const res = await fetch('/api/config/notifications', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(nextConfig)
                });
                const data = await readJsonResponse(res, '保存通知配置失败，请重启服务器后刷新页面');
                if (!data.success || !data.config) {
                    throw new Error(data.message || '保存失败');
                }
                renderNotificationConfig(data.config);
                if (infoBox && !silent) {
                    infoBox.className = 'info-box success';
                    infoBox.textContent = `✅ 通知配置已保存：无进展 ${data.config.staleThresholdMinutes} 分钟，冷却 ${data.config.notificationCooldownMinutes} 分钟`;
                }
                await refreshWatchdogStatus();
                if (!silent) showToast('通知配置已保存');
                return true;
            } catch (e) {
                if (infoBox && !silent) {
                    infoBox.className = 'info-box error';
                    infoBox.textContent = '❌ ' + e.message;
                }
                if (!silent) showToast(e.message || '保存通知配置失败', 'error');
                return false;
            }
        }

        async function refreshWatchdogStatus() {
            const infoBox = document.getElementById('watchdogStatusInfo');
            if (infoBox) {
                infoBox.className = 'info-box loading';
                infoBox.textContent = '读取中...';
            }
            try {
                const res = await fetch('/api/watchdog/status');
                const data = await readJsonResponse(res, '读取Watchdog状态失败');
                const watchdog = data.watchdog || {};
                if (infoBox) {
                    infoBox.className = watchdog.running ? 'info-box success' : 'info-box error';
                    const downText = watchdog.serverDown ? '服务掉线' : '服务正常';
                    infoBox.textContent = watchdog.running
                        ? `✅ 运行中 PID ${watchdog.pid || '-'}，${downText}`
                        : `❌ 未运行：${watchdog.message || '未启动'}`;
                }
            } catch (e) {
                if (infoBox) {
                    infoBox.className = 'info-box error';
                    infoBox.textContent = '❌ ' + e.message;
                }
            }
        }

        const resizeProviderStorageKey = 'ai-image-automation-resize-provider-v1';

        function normalizeResizeProvider(provider) {
            return provider === 'legil' ? 'legil' : 'jimeng';
        }

        function getResizeProviderLabel(provider = config.resizeProvider) {
            return normalizeResizeProvider(provider) === 'legil' ? 'Legil' : '即梦 AI';
        }

        function ensureResizeProviderFormState() {
            if (!config.resizeProviderFormState) {
                config.resizeProviderFormState = {
                    legil: {
                        inputFolder: config.resizeInputFolder,
                        outputFolder: config.resizeOutputFolder,
                        promptTemplate: config.resizePromptTemplate,
                        browserMode: config.resizeBrowserMode
                    },
                    jimeng: {
                        inputFolder: config.resizeInputFolder,
                        outputFolder: config.resizeOutputFolder,
                        promptTemplate: config.resizePromptTemplate,
                        browserMode: config.resizeBrowserMode
                    }
                };
            }
            ['legil', 'jimeng'].forEach(provider => {
                if (!config.resizeProviderFormState[provider]) {
                    config.resizeProviderFormState[provider] = {};
                }
                const state = config.resizeProviderFormState[provider];
                state.inputFolder = state.inputFolder || config.resizeInputFolder;
                state.outputFolder = state.outputFolder || config.resizeOutputFolder;
                state.promptTemplate = typeof state.promptTemplate === 'string' ? state.promptTemplate : config.resizePromptTemplate;
                state.browserMode = normalizeBrowserMode(state.browserMode || config.resizeBrowserMode, 'headless');
            });
            return config.resizeProviderFormState;
        }

        function mergeResizeProviderFormState(provider, dataConfig = {}) {
            const stateMap = ensureResizeProviderFormState();
            const normalizedProvider = normalizeResizeProvider(provider);
            const current = stateMap[normalizedProvider] || {};
            stateMap[normalizedProvider] = {
                inputFolder: dataConfig.inputFolder || current.inputFolder || config.resizeInputFolder,
                outputFolder: dataConfig.outputFolder || current.outputFolder || config.resizeOutputFolder,
                promptTemplate: typeof dataConfig.promptTemplate === 'string'
                    ? dataConfig.promptTemplate
                    : (typeof current.promptTemplate === 'string' ? current.promptTemplate : config.resizePromptTemplate),
                browserMode: normalizeBrowserMode(dataConfig.browserMode || current.browserMode || config.resizeBrowserMode, 'headless')
            };
            return stateMap[normalizedProvider];
        }

        function syncResizeProviderFormState(provider = config.resizeProvider) {
            const stateMap = ensureResizeProviderFormState();
            const normalizedProvider = normalizeResizeProvider(provider);
            const inputFolder = document.getElementById('resizeInputFolder')?.value.trim()
                || document.getElementById('deliveryInputFolder')?.value.trim()
                || config.resizeInputFolder;
            const outputFolder = document.getElementById('resizeOutputFolder')?.value.trim()
                || document.getElementById('deliveryOutputFolder')?.value.trim()
                || config.resizeOutputFolder;
            const promptTemplate = document.getElementById('resizePromptTemplate')?.value || config.resizePromptTemplate || '';
            stateMap[normalizedProvider] = {
                inputFolder,
                outputFolder,
                promptTemplate,
                browserMode: normalizeBrowserMode(config.resizeBrowserMode, 'headless')
            };
            config.resizeInputFolder = inputFolder;
            config.resizeOutputFolder = outputFolder;
            config.resizePromptTemplate = promptTemplate;
            return stateMap[normalizedProvider];
        }

        function applyResizeProviderFormState(provider = config.resizeProvider) {
            const state = ensureResizeProviderFormState()[normalizeResizeProvider(provider)];
            config.resizeInputFolder = state.inputFolder || config.resizeInputFolder;
            config.resizeOutputFolder = state.outputFolder || config.resizeOutputFolder;
            config.resizePromptTemplate = typeof state.promptTemplate === 'string' ? state.promptTemplate : config.resizePromptTemplate;
            config.resizeBrowserMode = normalizeBrowserMode(state.browserMode || config.resizeBrowserMode, 'headless');

            const input = document.getElementById('resizeInputFolder');
            const output = document.getElementById('resizeOutputFolder');
            const prompt = document.getElementById('resizePromptTemplate');
            if (input) input.value = config.resizeInputFolder;
            if (output) output.value = config.resizeOutputFolder;
            if (prompt) prompt.value = config.resizePromptTemplate;

            addFolderHistory('resizeInputFolder', config.resizeInputFolder);
            addFolderHistory('resizeOutputFolder', config.resizeOutputFolder);
            updateResizePromptCount();
            updateResizeBrowserModeActiveState();
        }

        function setResizeGenerationInfo(className, text) {
            const infoBox = document.getElementById('resizeLegilGenerationConfigInfo');
            if (!infoBox) return;
            infoBox.className = className;
            infoBox.textContent = text;
        }

        function updateResizeProviderActiveState() {
            document.querySelectorAll('[data-resize-provider]').forEach(button => {
                button.classList.toggle('active', button.dataset.resizeProvider === config.resizeProvider);
            });
        }

        function updateResizeProviderVisibility() {
            document.querySelectorAll('[data-resize-provider-panel]').forEach(panel => {
                panel.hidden = panel.dataset.resizeProviderPanel !== config.resizeProvider;
            });
        }

        function updateResizePromptLabel() {
            const label = document.getElementById('resizePromptTemplateLabel');
            if (label) {
                label.textContent = `发送给 ${getResizeProviderLabel()} 的固定文字提示词`;
            }
        }

        function setResizeProvider(provider) {
            syncResizeProviderFormState(config.resizeProvider);
            config.resizeProvider = normalizeResizeProvider(provider);
            try {
                window.localStorage.setItem(resizeProviderStorageKey, config.resizeProvider);
            } catch (e) {}
            applyResizeProviderFormState(config.resizeProvider);
            updateResizeProviderActiveState();
            updateResizeProviderVisibility();
            updateResizePromptLabel();
            refreshResizeGenerationSummary();
        }

        async function readResizeConfigEndpoint(url, label) {
            try {
                const res = await fetch(url);
                const data = await readJsonResponse(res, label);
                return data.success && data.config ? data.config : null;
            } catch (e) {
                return null;
            }
        }

        async function loadResizeConfig() {
            const storedProvider = (() => {
                try {
                    return window.localStorage.getItem(resizeProviderStorageKey);
                } catch (e) {
                    return '';
                }
            })();
            config.resizeProvider = normalizeResizeProvider(storedProvider || config.resizeProvider);

            const [legilConfig, jimengConfig] = await Promise.all([
                readResizeConfigEndpoint('/api/config/resize', '读取 Legil 改尺寸配置失败，请重启服务器后刷新页面'),
                readResizeConfigEndpoint('/api/config/jimeng-resize', '读取即梦改尺寸配置失败，请重启服务器后刷新页面')
            ]);

            if (legilConfig) {
                mergeResizeProviderFormState('legil', legilConfig);
                renderResizeLegilGenerationConfig(legilConfig);
            } else {
                renderResizeLegilGenerationConfig({
                    generationSettings: config.resizeLegilGeneration,
                    generationOptions: {}
                });
            }

            if (jimengConfig) {
                mergeResizeProviderFormState('jimeng', jimengConfig);
                renderResizeJimengGenerationConfig(jimengConfig);
            } else {
                renderResizeJimengGenerationConfig({
                    generationSettings: config.resizeJimengGeneration,
                    generationOptions: {}
                });
            }

            applyResizeProviderFormState(config.resizeProvider);
            updateResizeProviderActiveState();
            updateResizeProviderVisibility();
            updateResizePromptLabel();
            refreshResizeGenerationSummary();
        }

        async function saveResizeConfig(options = {}) {
            const silent = options.silent === true;
            const infoBox = document.getElementById('resizeBatchInfo');
            const provider = normalizeResizeProvider(config.resizeProvider);
            const providerState = syncResizeProviderFormState(provider);
            const isJimeng = provider === 'jimeng';
            const endpoint = isJimeng ? '/api/config/jimeng-resize' : '/api/config/resize';
            const generationSettings = isJimeng
                ? {
                    ...config.resizeJimengGeneration,
                    outputQuantity: 4,
                    concurrency: 1
                }
                : {
                    ...config.resizeLegilGeneration,
                    outputQuantity: Number(config.resizeLegilGeneration.outputQuantity) || 1
                };

            try {
                const res = await fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        inputFolder: providerState.inputFolder,
                        outputFolder: providerState.outputFolder,
                        browserMode: providerState.browserMode,
                        promptTemplate: providerState.promptTemplate,
                        generationSettings
                    })
                });
                const data = await readJsonResponse(res, '保存 Legil 适配配置失败，请重启服务器后刷新页面');
                if (!data.success || !data.config) {
                    throw new Error(data.message || '保存失败');
                }

                mergeResizeProviderFormState(provider, data.config);
                applyResizeProviderFormState(provider);
                if (data.config.generationSettings) {
                    if (isJimeng) {
                        config.resizeJimengGeneration = normalizeResizeJimengGenerationFromSettings(data.config.generationSettings);
                        updateResizeJimengGenerationActiveStates();
                    } else {
                        config.resizeLegilGeneration = normalizeResizeLegilGenerationFromSettings(data.config.generationSettings);
                        updateResizeLegilGenerationActiveStates();
                    }
                }
                refreshResizeGenerationSummary();

                if (infoBox && !silent) {
                    infoBox.className = 'info-box success';
                    infoBox.textContent = `✅ ${getResizeProviderLabel(provider)} 适配配置已保存`;
                }
                if (!silent) showToast(`${getResizeProviderLabel(provider)} 适配配置已保存`);
                return true;
            } catch (e) {
                if (infoBox && !silent) {
                    infoBox.className = 'info-box error';
                    infoBox.textContent = '❌ ' + e.message;
                }
                if (!silent) showToast(e.message || '保存 Legil 适配配置失败', 'error');
                return false;
            }
        }

        function normalizeResizeAspectRatios(settings = {}, fallbackRatio = '16:9') {
            const source = settings && typeof settings === 'object' ? settings : {};
            const rawValues = Array.isArray(source.aspectRatios) && source.aspectRatios.length
                ? source.aspectRatios
                : [source.aspectRatio || fallbackRatio];
            const seen = new Set();
            const selected = rawValues
                .map(value => String(value || '').trim())
                .filter(Boolean)
                .filter(value => {
                    if (seen.has(value)) return false;
                    seen.add(value);
                    return true;
                });
            return selected.length ? selected : [fallbackRatio];
        }

        function getResizeSelectedAspectRatios(settings = {}) {
            return normalizeResizeAspectRatios(settings, settings.aspectRatio || '16:9');
        }

        function toggleResizeAspectRatio(settings, value, selector) {
            const selectedSet = new Set(getResizeSelectedAspectRatios(settings));
            const valueText = String(value || '').trim();
            if (!valueText) return;

            if (selectedSet.has(valueText) && selectedSet.size > 1) {
                selectedSet.delete(valueText);
            } else {
                selectedSet.add(valueText);
            }

            const optionOrder = Array.from(document.querySelectorAll(selector))
                .map(button => String(button.dataset.value || '').trim())
                .filter(Boolean);
            const nextRatios = optionOrder.length
                ? optionOrder.filter(option => selectedSet.has(option))
                : Array.from(selectedSet);
            const safeRatios = nextRatios.length ? nextRatios : [valueText];

            settings.aspectRatios = safeRatios;
            settings.aspectRatio = safeRatios[0];
        }

        function getResizeAspectRatioSummary(settings = {}) {
            return getResizeSelectedAspectRatios(settings).join('、');
        }

        function normalizeResizeLegilGenerationFromSettings(settings = {}) {
            const aspectRatios = normalizeResizeAspectRatios(
                settings,
                settings.aspectRatio || config.resizeLegilGeneration.aspectRatio || '16:9'
            );
            return {
                imageModel: settings.imageModel || config.resizeLegilGeneration.imageModel || 'nano-banana-2',
                aspectRatio: aspectRatios[0],
                aspectRatios,
                resolution: settings.resolution || config.resizeLegilGeneration.resolution || '1K',
                outputQuantity: Number(settings.outputQuantity) || Number(config.resizeLegilGeneration.outputQuantity) || 1
            };
        }

        function normalizeResizeJimengGenerationFromSettings(settings = {}) {
            const aspectRatios = normalizeResizeAspectRatios(
                settings,
                settings.aspectRatio || config.resizeJimengGeneration.aspectRatio || '16:9'
            );
            return {
                imageModel: settings.imageModel || config.resizeJimengGeneration.imageModel || 'image-5-lite',
                aspectRatio: aspectRatios[0],
                aspectRatios,
                resolution: settings.resolution || config.resizeJimengGeneration.resolution || '2k',
                outputQuantity: 4,
                concurrency: 1,
                pollTimeoutSeconds: Number(settings.pollTimeoutSeconds) || config.resizeJimengGeneration.pollTimeoutSeconds || 900
            };
        }

        function setResizeLegilGenerationValue(key, value) {
            if (key === 'aspectRatio') {
                toggleResizeAspectRatio(config.resizeLegilGeneration, value, '[data-resize-legil-setting="aspectRatio"]');
            } else {
                config.resizeLegilGeneration[key] = key === 'outputQuantity' ? Number(value) : value;
                if (key === 'outputQuantity' && typeof setDeliverySelectedCandidateCount === 'function') {
                    setDeliverySelectedCandidateCount(Number(value));
                }
            }
            updateResizeLegilGenerationActiveStates();
            refreshResizeLegilGenerationSummary();
            if (typeof updateDeliveryPreview === 'function') {
                updateDeliveryPreview();
            }
            saveResizeConfig({ silent: true });
        }

        function setResizeJimengGenerationValue(key, value) {
            if (key === 'aspectRatio') {
                toggleResizeAspectRatio(config.resizeJimengGeneration, value, '[data-resize-jimeng-setting="aspectRatio"]');
            } else {
                config.resizeJimengGeneration[key] = value;
            }
            config.resizeJimengGeneration.outputQuantity = 4;
            config.resizeJimengGeneration.concurrency = 1;
            updateResizeJimengGenerationActiveStates();
            refreshResizeJimengGenerationSummary();
            saveResizeConfig({ silent: true });
        }

        function setResizeBrowserMode(mode) {
            config.resizeBrowserMode = normalizeBrowserMode(mode, 'headless');
            ensureResizeProviderFormState()[config.resizeProvider].browserMode = config.resizeBrowserMode;
            updateResizeBrowserModeActiveState();
            refreshResizeGenerationSummary();
            saveResizeConfig({ silent: true });
        }

        function updateResizeBrowserModeActiveState() {
            document.querySelectorAll('[data-resize-browser-mode]').forEach(button => {
                button.classList.toggle('active', button.dataset.resizeBrowserMode === config.resizeBrowserMode);
            });
        }

        function updateResizeLegilGenerationActiveStates() {
            document.querySelectorAll('[data-resize-legil-setting]').forEach(button => {
                const key = button.dataset.resizeLegilSetting;
                const active = key === 'aspectRatio'
                    ? getResizeSelectedAspectRatios(config.resizeLegilGeneration).includes(String(button.dataset.value))
                    : String(button.dataset.value) === String(config.resizeLegilGeneration[key]);
                button.classList.toggle('active', active);
            });
            updateResizeBrowserModeActiveState();
        }

        function updateResizeJimengGenerationActiveStates() {
            document.querySelectorAll('[data-resize-jimeng-setting]').forEach(button => {
                const key = button.dataset.resizeJimengSetting;
                const active = key === 'aspectRatio'
                    ? getResizeSelectedAspectRatios(config.resizeJimengGeneration).includes(String(button.dataset.value))
                    : String(button.dataset.value) === String(config.resizeJimengGeneration[key]);
                button.classList.toggle('active', active);
            });
            updateResizeBrowserModeActiveState();
        }

        function renderResizeLegilImageModelOptions(options) {
            const container = document.getElementById('resizeLegilImageModelOptions');
            if (!container) return;
            container.textContent = '';

            const safeOptions = Array.isArray(options) && options.length
                ? options
                : [
                    { value: 'seedream-4.5', label: 'Seedream 4.5' },
                    { value: 'gpt-image-2', label: 'GPT-Image-2' },
                    { value: 'gpt-image-1', label: 'GPT-Image-1' },
                    { value: 'nano-banana-2', label: 'Nano Banana 2' },
                    { value: 'nano-banana-pro', label: 'Nano Banana Pro' },
                    { value: 'nano-banana', label: 'Nano Banana' },
                    { value: 'imagen-3', label: 'Imagen-3' }
                ];

            safeOptions.forEach(option => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'model-option';
                button.dataset.resizeLegilSetting = 'imageModel';
                button.dataset.value = option.value;
                button.onclick = () => setResizeLegilGenerationValue('imageModel', option.value);

                const title = document.createElement('span');
                title.className = 'model-option-title';
                title.textContent = option.label || option.value;

                const desc = document.createElement('span');
                desc.className = 'model-option-desc';
                desc.textContent = option.description || '';

                button.appendChild(title);
                button.appendChild(desc);
                container.appendChild(button);
            });
        }

        function renderResizeLegilSettingOptions(key, values) {
            const idMap = {
                aspectRatio: 'resizeLegilAspectRatioOptions',
                resolution: 'resizeLegilResolutionOptions',
                outputQuantity: 'resizeLegilOutputQuantityOptions'
            };
            const container = document.getElementById(idMap[key]);
            if (!container) return;
            container.textContent = '';

            const safeValues = Array.isArray(values) && values.length
                ? values
                : {
                    aspectRatio: ['1:1', '16:9', '9:16', '4:3', '3:4'],
                    resolution: ['1K', '2K'],
                    outputQuantity: [1, 2, 3, 4]
                }[key] || [];

            safeValues.forEach(value => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'setting-option';
                button.dataset.resizeLegilSetting = key;
                button.dataset.value = value;
                button.textContent = value;
                button.onclick = () => setResizeLegilGenerationValue(key, value);
                container.appendChild(button);
            });
        }

        function renderResizeJimengImageModelOptions(options) {
            const container = document.getElementById('resizeJimengImageModelOptions');
            if (!container) return;
            container.textContent = '';

            const safeOptions = Array.isArray(options) && options.length
                ? options
                : [
                    { value: 'image-5-lite', label: '图片5.0 Lite', description: '默认模型；网页自动化会尝试选择，实际以页面可用项为准' }
                ];

            safeOptions.forEach(option => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'model-option';
                button.dataset.resizeJimengSetting = 'imageModel';
                button.dataset.value = option.value;
                button.onclick = () => setResizeJimengGenerationValue('imageModel', option.value);

                const title = document.createElement('span');
                title.className = 'model-option-title';
                title.textContent = option.label || option.value;

                const desc = document.createElement('span');
                desc.className = 'model-option-desc';
                desc.textContent = option.description || '';

                button.appendChild(title);
                button.appendChild(desc);
                container.appendChild(button);
            });
        }

        function renderResizeJimengSettingOptions(key, values) {
            const idMap = {
                aspectRatio: 'resizeJimengAspectRatioOptions',
                resolution: 'resizeJimengResolutionOptions'
            };
            const container = document.getElementById(idMap[key]);
            if (!container) return;
            container.textContent = '';

            const safeValues = Array.isArray(values) && values.length
                ? values
                : {
                    aspectRatio: ['1:1', '9:16', '16:9', '4:3', '3:4', '2:3', '3:2'],
                    resolution: [{ value: '2k', label: '高清 2K' }]
                }[key] || [];

            safeValues.forEach(value => {
                const optionValue = value && typeof value === 'object' ? value.value : value;
                const optionLabel = value && typeof value === 'object' ? (value.label || value.value) : value;
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'setting-option';
                button.dataset.resizeJimengSetting = key;
                button.dataset.value = optionValue;
                button.textContent = optionLabel;
                button.onclick = () => setResizeJimengGenerationValue(key, optionValue);
                container.appendChild(button);
            });
        }

        function renderResizeLegilGenerationConfig(dataConfig) {
            const settings = dataConfig.generationSettings || dataConfig.defaultGenerationSettings || {};
            const options = dataConfig.generationOptions || {};
            mergeResizeProviderFormState('legil', dataConfig);
            config.resizeLegilGeneration = normalizeResizeLegilGenerationFromSettings(settings);

            renderResizeLegilImageModelOptions(options.imageModels || []);
            renderResizeLegilSettingOptions('aspectRatio', options.aspectRatios || []);
            renderResizeLegilSettingOptions('resolution', options.resolutions || []);
            renderResizeLegilSettingOptions('outputQuantity', options.outputQuantities || []);
            updateResizeLegilGenerationActiveStates();
        }

        function renderResizeJimengGenerationConfig(dataConfig) {
            const settings = dataConfig.generationSettings || dataConfig.defaultGenerationSettings || {};
            const options = dataConfig.generationOptions || {};
            mergeResizeProviderFormState('jimeng', dataConfig);
            config.resizeJimengGeneration = normalizeResizeJimengGenerationFromSettings(settings);

            renderResizeJimengImageModelOptions(options.imageModels || []);
            renderResizeJimengSettingOptions('aspectRatio', options.aspectRatios || []);
            renderResizeJimengSettingOptions('resolution', options.resolutions || []);
            updateResizeJimengGenerationActiveStates();
        }

        function getResizeOptionLabel(selector, value, fallback) {
            const button = Array.from(document.querySelectorAll(selector))
                .find(item => String(item.dataset.value) === String(value));
            return button?.querySelector('.model-option-title')?.textContent || button?.textContent || fallback || value;
        }

        function refreshResizeLegilGenerationSummary() {
            const modelLabel = getResizeOptionLabel('[data-resize-legil-setting="imageModel"]', config.resizeLegilGeneration.imageModel, config.resizeLegilGeneration.imageModel);
            setResizeGenerationInfo(
                'info-box success',
                `✅ Legil AI 三尺寸适配参数：${getBrowserModeLabel(config.resizeBrowserMode)} / ${modelLabel} / ${getResizeAspectRatioSummary(config.resizeLegilGeneration)} / ${config.resizeLegilGeneration.resolution} / 每比例 ${config.resizeLegilGeneration.outputQuantity} 张`
            );
        }

        function refreshResizeJimengGenerationSummary() {
            const modelLabel = getResizeOptionLabel('[data-resize-jimeng-setting="imageModel"]', config.resizeJimengGeneration.imageModel, '图片5.0 Lite');
            const resolutionLabel = getResizeOptionLabel('[data-resize-jimeng-setting="resolution"]', config.resizeJimengGeneration.resolution, String(config.resizeJimengGeneration.resolution).toUpperCase());
            setResizeGenerationInfo(
                'info-box success',
                `✅ 即梦改尺寸参数：${getBrowserModeLabel(config.resizeBrowserMode)} / ${modelLabel} / ${getResizeAspectRatioSummary(config.resizeJimengGeneration)} / ${resolutionLabel} / 单页顺序 / 每比例每图4张`
            );
        }

        function refreshResizeGenerationSummary() {
            if (config.resizeProvider === 'legil') {
                refreshResizeLegilGenerationSummary();
            } else {
                refreshResizeJimengGenerationSummary();
            }
        }

        async function checkJimengStatus(options = {}) {
            const silent = options.silent === true;
            const infoBox = document.getElementById('resizeJimengCliStatusInfo');
            if (infoBox && !silent) {
                infoBox.className = 'info-box loading';
                infoBox.textContent = '正在检测即梦浏览器登录状态...';
            }

            try {
                const res = await fetch('/api/jimeng/status' + (silent ? '' : '?open=1'));
                const data = await readJsonResponse(res, '检测即梦浏览器状态失败');
                if (!data.success) {
                    throw new Error(data.message || '检测失败');
                }
                if (infoBox) {
                    infoBox.className = data.loggedIn ? 'info-box success' : 'info-box error';
                    infoBox.textContent = data.loggedIn
                        ? `✅ 即梦浏览器已登录，${data.ready ? '已检测到生图页面' : '启动任务时会重新进入图片生成页'}`
                        : `❌ ${data.message || '即梦浏览器未登录'}`;
                }
                if (!silent) {
                    showToast(data.loggedIn ? '即梦登录检测通过' : (data.message || '即梦浏览器未登录'), data.loggedIn ? 'success' : 'error');
                }
                return data.loggedIn === true;
            } catch (e) {
                if (infoBox) {
                    infoBox.className = 'info-box error';
                    infoBox.textContent = '❌ ' + e.message;
                }
                if (!silent) showToast(e.message || '检测即梦浏览器状态失败', 'error');
                return false;
            }
        }

        function setCreativeLegilGenerationInfo(className, text) {
            const infoBox = document.getElementById('creativeLegilGenerationConfigInfo');
            if (!infoBox) return;
            infoBox.className = className;
            infoBox.textContent = text;
        }

        function normalizeCreativeBrowserMode(mode) {
            return normalizeBrowserMode(mode, 'headed');
        }

        function getCreativeBrowserModeLabel(mode) {
            return getBrowserModeLabel(normalizeCreativeBrowserMode(mode));
        }

        function getCreativeCurrentModelLabel() {
            const modelButton = Array.from(document.querySelectorAll('[data-creative-legil-setting="imageModel"]'))
                .find(button => button.dataset.value === config.creativeLegilGeneration.imageModel);
            return modelButton?.querySelector('.model-option-title')?.textContent || config.creativeLegilGeneration.imageModel;
        }

        function refreshCreativeLegilGenerationSummary() {
            setCreativeLegilGenerationInfo(
                'info-box success',
                `✅ 创意拓展参数：${getCreativeBrowserModeLabel(config.creativeBrowserMode)} / ${getCreativeCurrentModelLabel()} / ${config.creativeLegilGeneration.aspectRatio} / ${config.creativeLegilGeneration.resolution} / ${config.creativeLegilGeneration.outputQuantity}张`
            );
        }

        function setCreativeBrowserMode(mode) {
            config.creativeBrowserMode = normalizeCreativeBrowserMode(mode);
            updateCreativeBrowserModeActiveState();
            refreshCreativeLegilGenerationSummary();
        }

        function updateCreativeBrowserModeActiveState() {
            document.querySelectorAll('[data-creative-browser-mode]').forEach(button => {
                button.classList.toggle('active', button.dataset.creativeBrowserMode === config.creativeBrowserMode);
            });
        }

        function setCreativeLegilGenerationValue(key, value) {
            config.creativeLegilGeneration[key] = key === 'outputQuantity' ? Number(value) : value;
            if (key === 'aspectRatio') {
                config.creativeLegilGeneration.aspectRatios = [String(value)];
            }
            updateCreativeLegilGenerationActiveStates();
            refreshCreativeLegilGenerationSummary();
        }

        function updateCreativeLegilGenerationActiveStates() {
            document.querySelectorAll('[data-creative-legil-setting]').forEach(button => {
                const key = button.dataset.creativeLegilSetting;
                button.classList.toggle('active', String(button.dataset.value) === String(config.creativeLegilGeneration[key]));
            });
        }

        function renderCreativeLegilImageModelOptions(options) {
            const container = document.getElementById('creativeLegilImageModelOptions');
            if (!container) return;
            container.textContent = '';

            const safeOptions = Array.isArray(options) && options.length
                ? options
                : [
                    { value: 'seedream-4.5', label: 'Seedream 4.5' },
                    { value: 'gpt-image-2', label: 'GPT-Image-2' },
                    { value: 'gpt-image-1', label: 'GPT-Image-1' },
                    { value: 'nano-banana-2', label: 'Nano Banana 2' },
                    { value: 'nano-banana-pro', label: 'Nano Banana Pro' },
                    { value: 'nano-banana', label: 'Nano Banana' },
                    { value: 'imagen-3', label: 'Imagen-3' }
                ];

            safeOptions.forEach(option => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'model-option';
                button.dataset.creativeLegilSetting = 'imageModel';
                button.dataset.value = option.value;
                button.onclick = () => setCreativeLegilGenerationValue('imageModel', option.value);

                const title = document.createElement('span');
                title.className = 'model-option-title';
                title.textContent = option.label || option.value;

                const desc = document.createElement('span');
                desc.className = 'model-option-desc';
                desc.textContent = option.description || '';

                button.appendChild(title);
                button.appendChild(desc);
                container.appendChild(button);
            });
        }

        function renderCreativeLegilSettingOptions(key, values) {
            const idMap = {
                aspectRatio: 'creativeLegilAspectRatioOptions',
                resolution: 'creativeLegilResolutionOptions',
                outputQuantity: 'creativeLegilOutputQuantityOptions'
            };
            const container = document.getElementById(idMap[key]);
            if (!container) return;
            container.textContent = '';

            (values || []).forEach(value => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'setting-option';
                button.dataset.creativeLegilSetting = key;
                button.dataset.value = value;
                button.textContent = value;
                button.onclick = () => setCreativeLegilGenerationValue(key, value);
                container.appendChild(button);
            });
        }

        function renderCreativeLegilGenerationConfig(dataConfig) {
            const settings = dataConfig.generationSettings || dataConfig.defaultGenerationSettings || {};
            const options = dataConfig.generationOptions || {};
            config.creativeBrowserMode = normalizeCreativeBrowserMode(dataConfig.browserMode || config.creativeBrowserMode);
            config.creativeLegilGeneration = {
                imageModel: settings.imageModel || 'nano-banana-2',
                aspectRatio: settings.aspectRatio || '1:1',
                aspectRatios: Array.isArray(settings.aspectRatios) && settings.aspectRatios.length
                    ? settings.aspectRatios
                    : [settings.aspectRatio || '1:1'],
                resolution: settings.resolution || '2K',
                outputQuantity: Number(settings.outputQuantity) || 4
            };

            renderCreativeLegilImageModelOptions(options.imageModels || []);
            renderCreativeLegilSettingOptions('aspectRatio', options.aspectRatios || []);
            renderCreativeLegilSettingOptions('resolution', options.resolutions || []);
            renderCreativeLegilSettingOptions('outputQuantity', options.outputQuantities || []);
            updateCreativeBrowserModeActiveState();
            updateCreativeLegilGenerationActiveStates();

            refreshCreativeLegilGenerationSummary();
        }

        async function loadCreativeConfig() {
            try {
                const res = await fetch('/api/config/creative');
                const data = await readJsonResponse(res, '读取创意拓展配置失败，请重启服务器后刷新页面');
                if (!data.success || !data.config) return;

                config.creativeOutputFolder = data.config.outputFolder || config.creativeOutputFolder;
                config.creativeReferenceFolder = data.config.referenceFolder || '';
                renderCreativeLegilGenerationConfig(data.config);

                const output = document.getElementById('creativeOutputFolder');
                const reference = document.getElementById('creativeReferenceFolder');
                if (output) output.value = config.creativeOutputFolder;
                if (reference) reference.value = config.creativeReferenceFolder;

                addFolderHistory('creativeOutputFolder', config.creativeOutputFolder);
                if (config.creativeReferenceFolder) {
                    addFolderHistory('creativeReferenceFolder', config.creativeReferenceFolder);
                }
            } catch (e) {}
        }

        async function saveCreativeConfig(options = {}) {
            const silent = options.silent === true;
            const infoBox = document.getElementById('creativeBatchInfo');
            const outputFolder = document.getElementById('creativeOutputFolder')?.value.trim() || config.creativeOutputFolder;
            const referenceFolder = document.getElementById('creativeReferenceFolder')?.value.trim() || '';

            try {
                const res = await fetch('/api/config/creative', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        outputFolder,
                        referenceFolder,
                        browserMode: config.creativeBrowserMode,
                        generationSettings: config.creativeLegilGeneration
                    })
                });
                const data = await readJsonResponse(res, '保存创意拓展配置失败，请重启服务器后刷新页面');
                if (!data.success || !data.config) {
                    throw new Error(data.message || '保存失败');
                }

                config.creativeOutputFolder = data.config.outputFolder;
                config.creativeReferenceFolder = data.config.referenceFolder || '';
                config.creativeBrowserMode = normalizeCreativeBrowserMode(data.config.browserMode || config.creativeBrowserMode);
                updateCreativeBrowserModeActiveState();
                if (data.config.generationSettings) {
                    config.creativeLegilGeneration = {
                        imageModel: data.config.generationSettings.imageModel || config.creativeLegilGeneration.imageModel,
                        aspectRatio: data.config.generationSettings.aspectRatio || config.creativeLegilGeneration.aspectRatio,
                        aspectRatios: Array.isArray(data.config.generationSettings.aspectRatios) && data.config.generationSettings.aspectRatios.length
                            ? data.config.generationSettings.aspectRatios
                            : [data.config.generationSettings.aspectRatio || config.creativeLegilGeneration.aspectRatio],
                        resolution: data.config.generationSettings.resolution || config.creativeLegilGeneration.resolution,
                        outputQuantity: Number(data.config.generationSettings.outputQuantity) || config.creativeLegilGeneration.outputQuantity
                    };
                    updateCreativeLegilGenerationActiveStates();
                }
                refreshCreativeLegilGenerationSummary();
                addFolderHistory('creativeOutputFolder', config.creativeOutputFolder);
                if (config.creativeReferenceFolder) {
                    addFolderHistory('creativeReferenceFolder', config.creativeReferenceFolder);
                }

                if (infoBox && !silent) {
                    infoBox.className = 'info-box success';
                    infoBox.textContent = '✅ 创意拓展配置已保存';
                }
                if (!silent) showToast('创意拓展配置已保存');
                return true;
            } catch (e) {
                if (infoBox && !silent) {
                    infoBox.className = 'info-box error';
                    infoBox.textContent = '❌ ' + e.message;
                }
                if (!silent) showToast(e.message || '保存创意拓展配置失败', 'error');
                return false;
            }
        }
