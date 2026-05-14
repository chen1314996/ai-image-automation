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
                updateWorkflowBrowserModeActiveState();
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
                        generationSettings: config.legilGeneration
                    })
                });
                const data = await readJsonResponse(res, '保存量产配置失败，请重启服务器后刷新页面');
                if (!data.success || !data.config) {
                    throw new Error(data.message || '保存失败');
                }
                config.workflowBrowserMode = normalizeBrowserMode(data.config.browserMode || config.workflowBrowserMode, 'headless');
                updateWorkflowBrowserModeActiveState();
                return true;
            } catch (e) {
                if (!silent) showToast(e.message || '保存量产配置失败', 'error');
                return false;
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

        async function loadResizeConfig() {
            try {
                const res = await fetch('/api/config/resize');
                const data = await readJsonResponse(res, '读取改尺寸配置失败，请重启服务器后刷新页面');
                if (!data.success || !data.config) return;

                config.resizeInputFolder = data.config.inputFolder || config.resizeInputFolder;
                config.resizeOutputFolder = data.config.outputFolder || config.resizeOutputFolder;
                config.resizeBrowserMode = normalizeBrowserMode(data.config.browserMode || config.resizeBrowserMode, 'headless');
                config.resizePromptTemplate = data.config.promptTemplate || '';
                renderResizeLegilGenerationConfig(data.config);
                updateResizeBrowserModeActiveState();

                const input = document.getElementById('resizeInputFolder');
                const output = document.getElementById('resizeOutputFolder');
                const prompt = document.getElementById('resizePromptTemplate');
                if (input) input.value = config.resizeInputFolder;
                if (output) output.value = config.resizeOutputFolder;
                if (prompt) prompt.value = config.resizePromptTemplate;

                addFolderHistory('resizeInputFolder', config.resizeInputFolder);
                addFolderHistory('resizeOutputFolder', config.resizeOutputFolder);
                updateResizePromptCount();
            } catch (e) {}
        }

        async function saveResizeConfig(options = {}) {
            const silent = options.silent === true;
            const infoBox = document.getElementById('resizeBatchInfo');
            const inputFolder = document.getElementById('resizeInputFolder')?.value.trim() || config.resizeInputFolder;
            const outputFolder = document.getElementById('resizeOutputFolder')?.value.trim() || config.resizeOutputFolder;
            const promptTemplate = document.getElementById('resizePromptTemplate')?.value || '';

            try {
                const res = await fetch('/api/config/resize', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        inputFolder,
                        outputFolder,
                        browserMode: config.resizeBrowserMode,
                        promptTemplate,
                        generationSettings: config.resizeLegilGeneration
                    })
                });
                const data = await readJsonResponse(res, '保存改尺寸配置失败，请重启服务器后刷新页面');
                if (!data.success || !data.config) {
                    throw new Error(data.message || '保存失败');
                }

                config.resizeInputFolder = data.config.inputFolder;
                config.resizeOutputFolder = data.config.outputFolder;
                config.resizeBrowserMode = normalizeBrowserMode(data.config.browserMode || config.resizeBrowserMode, 'headless');
                config.resizePromptTemplate = data.config.promptTemplate || '';
                updateResizeBrowserModeActiveState();
                if (data.config.generationSettings) {
                    config.resizeLegilGeneration = {
                        imageModel: data.config.generationSettings.imageModel || config.resizeLegilGeneration.imageModel,
                        aspectRatio: data.config.generationSettings.aspectRatio || config.resizeLegilGeneration.aspectRatio,
                        resolution: data.config.generationSettings.resolution || config.resizeLegilGeneration.resolution,
                        outputQuantity: Number(data.config.generationSettings.outputQuantity) || config.resizeLegilGeneration.outputQuantity
                    };
                    updateResizeLegilGenerationActiveStates();
                }
                addFolderHistory('resizeInputFolder', config.resizeInputFolder);
                addFolderHistory('resizeOutputFolder', config.resizeOutputFolder);

                if (infoBox && !silent) {
                    infoBox.className = 'info-box success';
                    infoBox.textContent = '✅ 改尺寸配置已保存';
                }
                if (!silent) showToast('改尺寸配置已保存');
                return true;
            } catch (e) {
                if (infoBox && !silent) {
                    infoBox.className = 'info-box error';
                    infoBox.textContent = '❌ ' + e.message;
                }
                if (!silent) showToast(e.message || '保存改尺寸配置失败', 'error');
                return false;
            }
        }

        function setResizeLegilGenerationInfo(className, text) {
            const infoBox = document.getElementById('resizeLegilGenerationConfigInfo');
            if (!infoBox) return;
            infoBox.className = className;
            infoBox.textContent = text;
        }

        function setResizeBrowserMode(mode) {
            config.resizeBrowserMode = normalizeBrowserMode(mode, 'headless');
            updateResizeBrowserModeActiveState();
            refreshResizeLegilGenerationSummary();
            saveResizeConfig({ silent: true });
        }

        function updateResizeBrowserModeActiveState() {
            document.querySelectorAll('[data-resize-browser-mode]').forEach(button => {
                button.classList.toggle('active', button.dataset.resizeBrowserMode === config.resizeBrowserMode);
            });
        }

        function setResizeLegilGenerationValue(key, value) {
            config.resizeLegilGeneration[key] = key === 'outputQuantity' ? Number(value) : value;
            updateResizeLegilGenerationActiveStates();
            refreshResizeLegilGenerationSummary();
        }

        function updateResizeLegilGenerationActiveStates() {
            document.querySelectorAll('[data-resize-legil-setting]').forEach(button => {
                const key = button.dataset.resizeLegilSetting;
                button.classList.toggle('active', String(button.dataset.value) === String(config.resizeLegilGeneration[key]));
            });
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

            (values || []).forEach(value => {
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

        function renderResizeLegilGenerationConfig(dataConfig) {
            const settings = dataConfig.generationSettings || dataConfig.defaultGenerationSettings || {};
            const options = dataConfig.generationOptions || {};
            config.resizeBrowserMode = normalizeBrowserMode(dataConfig.browserMode || config.resizeBrowserMode, 'headless');
            config.resizeLegilGeneration = {
                imageModel: settings.imageModel || 'nano-banana-2',
                aspectRatio: settings.aspectRatio || '16:9',
                resolution: settings.resolution || '1K',
                outputQuantity: Number(settings.outputQuantity) || 1
            };

            renderResizeLegilImageModelOptions(options.imageModels || []);
            renderResizeLegilSettingOptions('aspectRatio', options.aspectRatios || []);
            renderResizeLegilSettingOptions('resolution', options.resolutions || []);
            renderResizeLegilSettingOptions('outputQuantity', options.outputQuantities || []);
            updateResizeBrowserModeActiveState();
            updateResizeLegilGenerationActiveStates();

            refreshResizeLegilGenerationSummary(options.imageModels);
        }

        function refreshResizeLegilGenerationSummary(imageModelOptions) {
            const modelLabel = getLegilImageModelLabel(config.resizeLegilGeneration.imageModel, imageModelOptions);
            setResizeLegilGenerationInfo(
                'info-box success',
                `✅ 改尺寸参数：${getBrowserModeLabel(config.resizeBrowserMode)} / ${modelLabel} / ${config.resizeLegilGeneration.aspectRatio} / ${config.resizeLegilGeneration.resolution} / ${config.resizeLegilGeneration.outputQuantity}张`
            );
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
                resolution: settings.resolution || '1K',
                outputQuantity: Number(settings.outputQuantity) || 1
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
