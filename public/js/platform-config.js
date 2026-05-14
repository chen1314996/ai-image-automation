// 平台配置辅助：豆包提示词模板、Legil 参数、文件夹历史和配置加载。
        function updateDoubaoPromptCount() {
            const textarea = document.getElementById('doubaoPromptTemplate');
            const counter = document.getElementById('doubaoPromptCount');
            if (textarea && counter) {
                counter.textContent = `${textarea.value.length} 字`;
            }
        }

        async function loadDoubaoConfig() {
            const infoBox = document.getElementById('doubaoConfigInfo');
            const keyStatus = document.getElementById('doubaoApiKeyStatus');
            try {
                const res = await fetch('/api/config/doubao');
                const data = await res.json();
                if (!data.success || !data.config) {
                    throw new Error(data.message || '读取豆包配置失败');
                }

                config.doubaoPromptTemplate = data.config.promptTemplate || '';
                config.doubaoModelId = data.config.modelId || '';

                const textarea = document.getElementById('doubaoPromptTemplate');
                if (textarea) {
                    textarea.value = config.doubaoPromptTemplate;
                    updateDoubaoPromptCount();
                }

                const modelInput = document.getElementById('doubaoModelId');
                if (modelInput) {
                    modelInput.value = config.doubaoModelId;
                }

                const apiKeyInput = document.getElementById('doubaoApiKey');
                if (apiKeyInput) {
                    apiKeyInput.value = '';
                    apiKeyInput.placeholder = data.config.apiKeyConfigured
                        ? '已配置，重新填写可覆盖'
                        : '填写后仅保存在本机，不会在页面回显';
                }

                if (keyStatus) {
                    keyStatus.textContent = data.config.apiKeyConfigured
                        ? `已配置（${data.config.apiKeySource || '本机'}）`
                        : '未配置';
                }

                const doubaoReady = !!data.config.apiKeyConfigured && !!config.doubaoModelId;
                updateStatus('doubao', doubaoReady, doubaoReady ? '豆包API已配置' : '豆包API待配置');

                if (infoBox) {
                    infoBox.className = 'info-box success';
                    infoBox.textContent = `✅ 豆包API配置已加载，模型ID：${data.config.modelLabel || '未填写'}`;
                }
            } catch (e) {
                if (infoBox) {
                    infoBox.className = 'info-box error';
                    infoBox.textContent = '❌ 豆包配置读取失败';
                }
            }
        }

        async function saveDoubaoConfig(options = {}) {
            const silent = options.silent === true;
            const textarea = document.getElementById('doubaoPromptTemplate');
            const modelInput = document.getElementById('doubaoModelId');
            const apiKeyInput = document.getElementById('doubaoApiKey');
            const infoBox = document.getElementById('doubaoConfigInfo');
            const promptTemplate = textarea ? textarea.value.trim() : '';
            const modelId = modelInput ? modelInput.value.trim() : '';
            const apiKey = apiKeyInput ? apiKeyInput.value.trim() : '';

            if (!promptTemplate) {
                if (!silent) showToast('豆包固定指令不能为空', 'error');
                return false;
            }

            if (!modelId) {
                if (!silent) showToast('请填写豆包模型 ID / Endpoint ID', 'error');
                return false;
            }

            if (promptTemplate.length > 10000) {
                if (!silent) showToast('豆包固定指令过长', 'error');
                return false;
            }

            if (infoBox) {
                infoBox.className = 'info-box loading';
                infoBox.textContent = '保存中...';
            }

            try {
                const res = await fetch('/api/config/doubao', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        modelId,
                        promptTemplate,
                        apiKey
                    })
                });
                const data = await res.json();

                if (!data.success) {
                    throw new Error(data.message || '保存失败');
                }

                if (!data.config || !data.config.apiKeyConfigured) {
                    throw new Error('请填写火山方舟 API Key');
                }

                config.doubaoPromptTemplate = data.config.promptTemplate;
                config.doubaoModelId = data.config.modelId || '';
                if (textarea) {
                    textarea.value = config.doubaoPromptTemplate;
                    updateDoubaoPromptCount();
                }
                if (modelInput) {
                    modelInput.value = config.doubaoModelId;
                }
                if (apiKeyInput) {
                    apiKeyInput.value = '';
                    apiKeyInput.placeholder = data.config.apiKeyConfigured
                        ? '已配置，重新填写可覆盖'
                        : '填写后仅保存在本机，不会在页面回显';
                }

                const keyStatus = document.getElementById('doubaoApiKeyStatus');
                if (keyStatus) {
                    keyStatus.textContent = data.config.apiKeyConfigured
                        ? `已配置（${data.config.apiKeySource || '本机'}）`
                        : '未配置';
                }
                const doubaoReady = !!data.config.apiKeyConfigured && !!config.doubaoModelId;
                updateStatus('doubao', doubaoReady, doubaoReady ? '豆包API已配置' : '豆包API待配置');

                if (infoBox) {
                    infoBox.className = 'info-box success';
                    infoBox.textContent = `✅ 豆包API配置已保存，模型ID：${data.config.modelLabel || '未填写'}`;
                }
                if (!silent) {
                    showToast('豆包配置已保存');
                    addLog(`✅ 豆包API配置已保存，模型ID：${data.config.modelLabel || '未填写'}`, 'success');
                }
                return true;
            } catch (e) {
                if (infoBox) {
                    infoBox.className = 'info-box error';
                    infoBox.textContent = '❌ ' + e.message;
                }
                if (!silent) showToast(e.message || '豆包配置保存失败', 'error');
                return false;
            }
        }

        async function resetDoubaoPrompt() {
            const infoBox = document.getElementById('doubaoConfigInfo');
            try {
                const res = await fetch('/api/config/doubao/reset-prompt', { method: 'POST' });
                const data = await res.json();
                if (!data.success) {
                    throw new Error(data.message || '恢复失败');
                }

                config.doubaoPromptTemplate = data.config.promptTemplate;
                const textarea = document.getElementById('doubaoPromptTemplate');
                if (textarea) {
                    textarea.value = config.doubaoPromptTemplate;
                    updateDoubaoPromptCount();
                }

                if (infoBox) {
                    infoBox.className = 'info-box success';
                    infoBox.textContent = '✅ 已恢复默认指令';
                }
                showToast('已恢复默认指令');
            } catch (e) {
                if (infoBox) {
                    infoBox.className = 'info-box error';
                    infoBox.textContent = '❌ ' + e.message;
                }
                showToast(e.message || '恢复失败', 'error');
            }
        }

        function getLegilImageModelLabel(value, options) {
            const option = (options || []).find(item => item.value === value);
            return option ? option.label : (value || 'Nano Banana 2');
        }

        function setLegilGenerationValue(key, value) {
            config.legilGeneration[key] = key === 'outputQuantity' ? Number(value) : value;
            document.querySelectorAll(`[data-legil-setting="${key}"]`).forEach(button => {
                button.classList.toggle('active', String(button.dataset.value) === String(config.legilGeneration[key]));
            });
            refreshLegilGenerationSummary();
        }

        function renderLegilImageModelOptions(options) {
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

            const container = document.getElementById('legilImageModelOptions');
            if (!container) return;
            container.textContent = '';

            safeOptions.forEach(option => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'model-option';
                button.dataset.legilSetting = 'imageModel';
                button.dataset.value = option.value;
                button.onclick = () => setLegilGenerationValue('imageModel', option.value);

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

            setLegilGenerationValue('imageModel', config.legilGeneration.imageModel);
        }

        function renderLegilSettingOptions(key, values) {
            const idMap = {
                aspectRatio: 'legilAspectRatioOptions',
                resolution: 'legilResolutionOptions',
                outputQuantity: 'legilOutputQuantityOptions'
            };
            const container = document.getElementById(idMap[key]);
            if (!container) return;
            container.textContent = '';

            (values || []).forEach(value => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'setting-option';
                button.dataset.legilSetting = key;
                button.dataset.value = value;
                button.textContent = value;
                button.onclick = () => setLegilGenerationValue(key, value);
                container.appendChild(button);
            });

            setLegilGenerationValue(key, config.legilGeneration[key]);
        }

        function renderLegilGenerationConfig(dataConfig) {
            const settings = dataConfig.settings || {};
            const options = dataConfig.options || {};
            config.legilGeneration = {
                imageModel: settings.imageModel || 'nano-banana-2',
                aspectRatio: settings.aspectRatio || '1:1',
                resolution: settings.resolution || '2K',
                outputQuantity: Number(settings.outputQuantity) || 1
            };

            renderLegilImageModelOptions(options.imageModels || []);
            renderLegilSettingOptions('aspectRatio', options.aspectRatios || []);
            renderLegilSettingOptions('resolution', options.resolutions || []);
            renderLegilSettingOptions('outputQuantity', options.outputQuantities || []);
            refreshLegilGenerationSummary(options.imageModels);
        }

        function setLegilGenerationInfo(className, text) {
            const infoBox = document.getElementById('legilGenerationConfigInfo');
            if (!infoBox) return;
            infoBox.className = className;
            infoBox.textContent = text;
        }

        function refreshLegilGenerationSummary(imageModelOptions) {
            const modelLabel = getLegilImageModelLabel(config.legilGeneration.imageModel, imageModelOptions);
            setLegilGenerationInfo(
                'info-box success',
                `✅ 量产 Legil参数：${getBrowserModeLabel(config.workflowBrowserMode)} / ${modelLabel} / ${config.legilGeneration.aspectRatio} / ${config.legilGeneration.resolution} / ${config.legilGeneration.outputQuantity}张`
            );
        }

        async function loadLegilGenerationConfig() {
            try {
                const res = await fetch('/api/config/legil-generation');
                const data = await res.json();
                if (!data.success || !data.config) {
                    throw new Error(data.message || '读取Legil参数失败');
                }

                renderLegilGenerationConfig(data.config);

                refreshLegilGenerationSummary(data.config.options?.imageModels);
            } catch (e) {
                setLegilGenerationInfo('info-box error', '❌ Legil参数读取失败');
            }
        }

        async function saveLegilGenerationConfig(options = {}) {
            const silent = options.silent === true;
            setLegilGenerationInfo('info-box loading', '保存中...');

            try {
                const res = await fetch('/api/config/legil-generation', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(config.legilGeneration)
                });
                const data = await res.json();
                if (!data.success || !data.config) {
                    throw new Error(data.message || '保存失败');
                }

                renderLegilGenerationConfig(data.config);
                refreshLegilGenerationSummary(data.config.options?.imageModels);
                if (!silent) {
                    const modelLabel = getLegilImageModelLabel(config.legilGeneration.imageModel, data.config.options?.imageModels);
                    showToast('Legil参数已保存');
                    addLog(`✅ Legil参数已保存：${getBrowserModeLabel(config.workflowBrowserMode)} / ${modelLabel} / ${config.legilGeneration.aspectRatio} / ${config.legilGeneration.resolution} / ${config.legilGeneration.outputQuantity}张`, 'success');
                }
                return true;
            } catch (e) {
                setLegilGenerationInfo('info-box error', '❌ ' + e.message);
                if (!silent) showToast(e.message || 'Legil参数保存失败', 'error');
                return false;
            }
        }

        // Open websites
