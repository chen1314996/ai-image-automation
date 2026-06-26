// 批量产图页：批量修图。输入图作为图一，最多 10 张风格参考图作为后续参考图，直接提交 Legil。
(function () {
    const DEFAULT_PROMPT = '图一变成后几张图片风格，高质量3D卡通渲染风格，保持图一色调';
    const state = {
        scan: null,
        statusInterval: null,
        running: false,
        styleReferenceLimit: 10,
        imageModelOptions: []
    };

    const $ = (id) => document.getElementById(id);

    function setText(id, value) {
        const el = $(id);
        if (el) el.textContent = value;
    }

    function setInfo(id, className, text) {
        const el = $(id);
        if (!el) return;
        el.className = `info-box ${className || ''}`.trim();
        el.textContent = text || '';
    }

    function getFolders() {
        return {
            inputFolder: $('batchRetouchInputFolder')?.value.trim() || config.batchRetouchInputFolder,
            outputFolder: $('batchRetouchOutputFolder')?.value.trim() || config.batchRetouchOutputFolder,
            referenceFolder: $('batchRetouchReferenceFolder')?.value.trim() || config.batchRetouchReferenceFolder
        };
    }

    function getPayload() {
        const folders = getFolders();
        return {
            ...folders,
            prompt: $('batchRetouchPrompt')?.value.trim() || DEFAULT_PROMPT,
            browserMode: config.batchRetouchBrowserMode || 'headless',
            generationSettings: config.batchRetouchGeneration
        };
    }

    function updatePromptCount() {
        setText('batchRetouchPromptCount', `${($('batchRetouchPrompt')?.value || '').length} 字`);
    }

    function getModelLabel(value) {
        if (typeof getLegilImageModelLabel === 'function') {
            return getLegilImageModelLabel(value, state.imageModelOptions);
        }
        const fallback = {
            'seedream-4.5': 'Seedream 4.5',
            'gpt-image-2': 'GPT-Image-2',
            'gpt-image-1': 'GPT-Image-1',
            'nano-banana-2': 'Nano Banana 2',
            'nano-banana-pro': 'Nano Banana Pro',
            'nano-banana': 'Nano Banana',
            'imagen-3': 'Imagen-3'
        };
        return fallback[value] || value || 'Nano Banana 2';
    }

    function refreshSummary() {
        const generation = config.batchRetouchGeneration || {};
        setText('batchRetouchSummaryModel', getModelLabel(generation.imageModel));
        setText('batchRetouchSummaryRatio', generation.aspectRatio || '1:1');
        setText('batchRetouchSummaryResolution', generation.resolution || '2K');
        setText('batchRetouchSummaryOutput', `${Number(generation.outputQuantity) || 1} 张`);
        setText('batchRetouchSummaryBrowserMode', config.batchRetouchBrowserMode === 'headed' ? '有头' : '无头');

        const inputCount = Number(state.scan?.inputCount || state.status?.totalInputImages) || 0;
        const styleTotal = Number(state.scan?.styleReferenceTotal || state.status?.styleReferenceTotal) || 0;
        const styleUsed = Number(state.scan?.styleReferenceUsed || state.status?.styleReferenceUsed) || 0;
        const expected = Number(state.scan?.expectedOutputTotal || state.status?.expectedOutputTotal) || inputCount * (Number(generation.outputQuantity) || 1);
        const saved = Number(state.status?.saved) || 0;
        setText('batchRetouchInputCount', inputCount);
        setText('batchRetouchStyleCount', styleTotal > state.styleReferenceLimit ? `${styleUsed} / ${styleTotal}` : `${styleUsed} / ${state.styleReferenceLimit}`);
        setText('batchRetouchExpectedCount', expected);
        setText('batchRetouchSavedCount', saved);

        const configInfo = $('batchRetouchConfigInfo');
        if (configInfo) {
            configInfo.className = 'info-box success';
            configInfo.textContent = `✅ 批量修图参数：${config.batchRetouchBrowserMode === 'headed' ? '有头模式' : '无头模式'} / ${getModelLabel(generation.imageModel)} / ${generation.aspectRatio || '1:1'} / ${generation.resolution || '2K'} / ${Number(generation.outputQuantity) || 1}张`;
        }
    }

    function updateActiveStates() {
        document.querySelectorAll('[data-batch-retouch-browser-mode]').forEach(button => {
            button.classList.toggle('active', button.dataset.batchRetouchBrowserMode === config.batchRetouchBrowserMode);
        });
        document.querySelectorAll('[data-batch-retouch-setting]').forEach(button => {
            const key = button.dataset.batchRetouchSetting;
            button.classList.toggle('active', String(button.dataset.value) === String(config.batchRetouchGeneration?.[key]));
        });
    }

    function renderModelOptions(options = []) {
        const container = $('batchRetouchImageModelOptions');
        if (!container) return;
        state.imageModelOptions = Array.isArray(options) && options.length
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
        container.textContent = '';
        state.imageModelOptions.forEach(option => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'model-option';
            button.dataset.batchRetouchSetting = 'imageModel';
            button.dataset.value = option.value;
            button.onclick = () => setBatchRetouchGenerationValue('imageModel', option.value);

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

    function renderSettingOptions(key, values = []) {
        const idMap = {
            aspectRatio: 'batchRetouchAspectRatioOptions',
            resolution: 'batchRetouchResolutionOptions',
            outputQuantity: 'batchRetouchOutputQuantityOptions'
        };
        const container = $(idMap[key]);
        if (!container) return;
        container.textContent = '';
        values.forEach(value => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'setting-option';
            button.dataset.batchRetouchSetting = key;
            button.dataset.value = value;
            button.textContent = value;
            button.onclick = () => setBatchRetouchGenerationValue(key, value);
            container.appendChild(button);
        });
    }

    function renderModelSpecificOptions() {
        const profile = typeof getLegilModelParameterProfile === 'function'
            ? getLegilModelParameterProfile(config.batchRetouchGeneration?.imageModel)
            : {
                aspectRatios: ['1:1', '1:4', '1:8', '2:3', '3:4', '4:5', '9:16', '21:9', '16:9', '5:4', '4:3', '3:2', '8:1', '4:1'],
                resolutions: ['512px', '1K', '2K', '4K'],
                outputQuantities: [1, 2, 3, 4]
            };
        renderSettingOptions('aspectRatio', profile.aspectRatios || []);
        renderSettingOptions('resolution', profile.resolutions || []);
        renderSettingOptions('outputQuantity', profile.outputQuantities || []);
    }

    function applyConfig(dataConfig = {}) {
        config.batchRetouchInputFolder = dataConfig.inputFolder || config.batchRetouchInputFolder;
        config.batchRetouchOutputFolder = dataConfig.outputFolder || config.batchRetouchOutputFolder;
        config.batchRetouchReferenceFolder = dataConfig.referenceFolder || config.batchRetouchReferenceFolder;
        config.batchRetouchPrompt = dataConfig.prompt || config.batchRetouchPrompt || DEFAULT_PROMPT;
        config.batchRetouchBrowserMode = normalizeBrowserMode(dataConfig.browserMode || config.batchRetouchBrowserMode, 'headless');
        config.legilModelParameterProfiles = dataConfig.modelParameterProfiles || config.legilModelParameterProfiles || {};
        config.batchRetouchGeneration = normalizeLegilSettingsForModel(dataConfig.generationSettings || config.batchRetouchGeneration || {});
        state.styleReferenceLimit = Number(dataConfig.styleReferenceLimit) || state.styleReferenceLimit || 10;

        if ($('batchRetouchInputFolder')) $('batchRetouchInputFolder').value = config.batchRetouchInputFolder;
        if ($('batchRetouchOutputFolder')) $('batchRetouchOutputFolder').value = config.batchRetouchOutputFolder;
        if ($('batchRetouchReferenceFolder')) $('batchRetouchReferenceFolder').value = config.batchRetouchReferenceFolder;
        if ($('batchRetouchPrompt')) $('batchRetouchPrompt').value = config.batchRetouchPrompt;
        updatePromptCount();

        renderModelOptions(dataConfig.generationOptions?.imageModels || []);
        renderModelSpecificOptions();
        updateActiveStates();
        refreshSummary();
    }

    window.setBatchRetouchBrowserMode = function setBatchRetouchBrowserMode(mode) {
        config.batchRetouchBrowserMode = normalizeBrowserMode(mode, 'headless');
        updateActiveStates();
        refreshSummary();
    };

    window.setBatchRetouchGenerationValue = function setBatchRetouchGenerationValue(key, value) {
        config.batchRetouchGeneration = normalizeLegilSettingsForModel({
            ...config.batchRetouchGeneration,
            [key]: key === 'outputQuantity' ? Number(value) : value
        });
        if (key === 'imageModel') {
            renderModelSpecificOptions();
        }
        updateActiveStates();
        refreshSummary();
    };

    window.loadBatchRetouchConfig = async function loadBatchRetouchConfig() {
        try {
            const res = await fetch('/api/batch-retouch/config');
            const data = await readJsonResponse(res, '读取批量修图配置失败');
            if (!data.success || !data.config) {
                throw new Error(data.message || '读取配置失败');
            }
            applyConfig(data.config);
            ['batchRetouchInputFolder', 'batchRetouchOutputFolder', 'batchRetouchReferenceFolder'].forEach(id => {
                const value = $(id)?.value.trim();
                if (value) addFolderHistory(id, value);
            });
        } catch (error) {
            setInfo('batchRetouchConfigInfo', 'error', '❌ ' + error.message);
        }
    };

    window.saveBatchRetouchConfig = async function saveBatchRetouchConfig(options = {}) {
        const silent = options.silent === true;
        setInfo('batchRetouchConfigInfo', 'loading', '保存中...');
        try {
            const res = await fetch('/api/batch-retouch/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(getPayload())
            });
            const data = await readJsonResponse(res, '保存批量修图配置失败');
            if (!data.success || !data.config) {
                throw new Error(data.message || '保存失败');
            }
            applyConfig(data.config);
            ['batchRetouchInputFolder', 'batchRetouchOutputFolder', 'batchRetouchReferenceFolder'].forEach(id => {
                const value = $(id)?.value.trim();
                if (value) addFolderHistory(id, value);
            });
            if (!silent) {
                showToast('批量修图参数已保存');
                addLog('✅ 批量修图参数已保存', 'success');
            }
            return true;
        } catch (error) {
            setInfo('batchRetouchConfigInfo', 'error', '❌ ' + error.message);
            if (!silent) showToast(error.message || '保存批量修图配置失败', 'error');
            return false;
        }
    };

    window.scanBatchRetouchFolders = async function scanBatchRetouchFolders() {
        const button = $('batchRetouchScanBtn');
        if (button) {
            button.disabled = true;
            button.textContent = '扫描中...';
        }
        setInfo('batchRetouchInfo', 'loading', '正在扫描输入图和风格参考图...');
        try {
            const res = await fetch('/api/batch-retouch/scan', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(getPayload())
            });
            const data = await readJsonResponse(res, '扫描批量修图文件夹失败');
            if (!data.success) {
                throw new Error(data.message || '扫描失败');
            }
            state.scan = data;
            setInfo('batchRetouchInputInfo', data.inputCount > 0 ? 'success' : 'error', data.inputCount > 0 ? `找到 ${data.inputCount} 张输入图` : '未找到输入图');
            const refText = data.styleReferenceTotal > data.styleReferenceLimit
                ? `检测到 ${data.styleReferenceTotal} 张，本次使用前 ${data.styleReferenceUsed} 张`
                : `找到 ${data.styleReferenceUsed} 张风格参考图`;
            setInfo('batchRetouchReferenceInfo', data.styleReferenceUsed > 0 ? 'success' : 'error', refText);
            setInfo('batchRetouchInfo', data.inputCount > 0 && data.styleReferenceUsed > 0 ? 'success' : 'error', data.message || '扫描完成');
            setText('batchRetouchMiniStage', data.inputCount > 0 && data.styleReferenceUsed > 0 ? '已扫描' : '待补充');
            setText('batchRetouchMiniCurrentImage', data.inputCount > 0 ? '可启动任务' : '未找到输入图');
            setText('batchRetouchMiniProgress', `0 / ${data.inputCount || 0}`);
            const mini = $('batchRetouchMiniStatus');
            if (mini) mini.dataset.state = data.inputCount > 0 && data.styleReferenceUsed > 0 ? 'ready' : 'error';
            refreshSummary();
            if (data.inputCount > 0 && data.styleReferenceUsed > 0) {
                showToast(`已扫描 ${data.inputCount} 张输入图`);
            }
            return data;
        } catch (error) {
            setInfo('batchRetouchInfo', 'error', '❌ ' + error.message);
            showToast(error.message || '扫描失败', 'error');
            return null;
        } finally {
            if (button) {
                button.disabled = false;
                button.textContent = '扫描图片';
            }
        }
    };

    window.startBatchRetouchWithConfirm = async function startBatchRetouchWithConfirm() {
        const scan = state.scan || await scanBatchRetouchFolders();
        if (!scan || scan.inputCount <= 0 || scan.styleReferenceUsed <= 0) {
            return;
        }
        const outputQuantity = Number(config.batchRetouchGeneration?.outputQuantity) || 1;
        const confirmed = confirm(
            '确认开始批量修图？\n\n' +
            `输入图：${scan.inputCount} 张\n` +
            `风格参考图：${scan.styleReferenceUsed}/${scan.styleReferenceTotal} 张（最多使用 ${scan.styleReferenceLimit} 张）\n` +
            `每张输入图生成：1 轮\n` +
            `预计产图：${scan.inputCount * outputQuantity} 张\n` +
            `输出文件夹：${getFolders().outputFolder}\n\n` +
            '每轮生成前会刷新 Legil 页面，确保图一和风格参考图顺序稳定。'
        );
        if (!confirmed) return;
        await startBatchRetouch();
    };

    async function startBatchRetouch() {
        const saved = await saveBatchRetouchConfig({ silent: true });
        if (!saved) return;
        setRunningState(true);
        setInfo('batchRetouchInfo', 'loading', '正在启动批量修图任务...');
        try {
            const res = await fetch('/api/batch-retouch/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(getPayload())
            });
            const data = await readJsonResponse(res, '启动批量修图失败');
            if (!data.success) {
                throw new Error(data.message || '启动失败');
            }
            setInfo('batchRetouchInfo', 'success', data.message || '批量修图已启动');
            addLog(`✅ 批量修图已启动：${data.totalInputImages || 0} 张输入图`, 'success');
            showToast('批量修图已启动');
            startStatusPolling();
        } catch (error) {
            setRunningState(false);
            setInfo('batchRetouchInfo', 'error', '❌ ' + error.message);
            showToast(error.message || '启动批量修图失败', 'error');
        }
    }

    function setRunningState(isRunning) {
        state.running = Boolean(isRunning);
        const start = $('batchRetouchStartBtn');
        const stop = $('batchRetouchStopBtn');
        const resume = $('batchRetouchResumeBtn');
        const scan = $('batchRetouchScanBtn');
        if (start) start.disabled = state.running;
        if (scan) scan.disabled = state.running;
        if (stop) stop.disabled = !state.running;
        if (resume) resume.disabled = state.running;
        const mini = $('batchRetouchMiniStatus');
        if (mini) mini.dataset.state = state.running ? 'running' : (state.scan ? 'ready' : 'idle');
    }

    function startStatusPolling() {
        if (state.statusInterval) {
            clearInterval(state.statusInterval);
        }
        pollBatchRetouchStatus();
        state.statusInterval = setInterval(pollBatchRetouchStatus, 3000);
    }

    async function pollBatchRetouchStatus() {
        try {
            const res = await fetch('/api/batch-retouch/status');
            const data = await readJsonResponse(res, '读取批量修图状态失败');
            if (!data.success || !data.status) return;
            updateStatusView(data.status);
        } catch (error) {}
    }

    function phaseLabel(phase) {
        const labels = {
            idle: '待启动',
            running: '运行中',
            uploading: '上传中',
            generating: '生成中',
            stopped: '已暂停',
            stopping: '停止中',
            completed: '已完成',
            error: '异常'
        };
        return labels[phase] || '处理中';
    }

    function updateStatusView(status = {}) {
        state.status = status;
        const running = status.isRunning === true;
        setRunningState(running);
        setText('batchRetouchMiniStage', phaseLabel(status.phase));
        setText('batchRetouchMiniCurrentImage', status.currentInputName || status.currentAction || '等待输入图');
        setText('batchRetouchMiniProgress', `${Math.min(Number(status.currentInputIndex) || 0, Number(status.totalInputImages) || 0)} / ${Number(status.totalInputImages) || 0}`);
        setInfo('batchRetouchInfo', running ? 'loading' : (status.phase === 'completed' ? 'success' : (status.phase === 'error' ? 'error' : 'success')), status.currentAction || '等待任务状态');
        const mini = $('batchRetouchMiniStatus');
        if (mini) mini.dataset.state = running ? 'running' : (status.phase === 'completed' ? 'completed' : (status.phase === 'error' ? 'error' : (status.phase === 'stopped' ? 'ready' : 'idle')));
        const resumeBtn = $('batchRetouchResumeBtn');
        if (resumeBtn) {
            resumeBtn.disabled = running || !(status.resume && status.resume.hasResume);
        }
        refreshSummary();
        if (!running && ['completed', 'stopped', 'error'].includes(status.phase) && state.statusInterval) {
            clearInterval(state.statusInterval);
            state.statusInterval = null;
        }
    }

    window.stopBatchRetouch = async function stopBatchRetouch() {
        setInfo('batchRetouchInfo', 'loading', '正在发送停止指令...');
        try {
            const res = await fetch('/api/batch-retouch/stop', { method: 'POST' });
            const data = await readJsonResponse(res, '停止批量修图失败');
            setInfo('batchRetouchInfo', data.success ? 'success' : 'error', data.message || '停止指令已发送');
            showToast(data.message || '停止指令已发送');
            await pollBatchRetouchStatus();
        } catch (error) {
            setInfo('batchRetouchInfo', 'error', '❌ ' + error.message);
        }
    };

    window.resumeBatchRetouch = async function resumeBatchRetouch() {
        setRunningState(true);
        setInfo('batchRetouchInfo', 'loading', '正在继续批量修图...');
        try {
            const res = await fetch('/api/batch-retouch/resume', { method: 'POST' });
            const data = await readJsonResponse(res, '继续批量修图失败');
            if (!data.success) {
                throw new Error(data.message || '继续失败');
            }
            setInfo('batchRetouchInfo', 'success', data.message || '已继续批量修图');
            showToast('已继续批量修图');
            startStatusPolling();
        } catch (error) {
            setRunningState(false);
            setInfo('batchRetouchInfo', 'error', '❌ ' + error.message);
        }
    };

    window.initBatchRetouch = function initBatchRetouch() {
        loadBatchRetouchConfig();
        updatePromptCount();
        $('batchRetouchPrompt')?.addEventListener('input', () => {
            config.batchRetouchPrompt = $('batchRetouchPrompt').value;
            updatePromptCount();
        });
        ['batchRetouchInputFolder', 'batchRetouchOutputFolder', 'batchRetouchReferenceFolder'].forEach(id => {
            $(id)?.addEventListener('change', () => {
                state.scan = null;
                refreshSummary();
            });
        });
        setRunningState(false);
    };
})();
