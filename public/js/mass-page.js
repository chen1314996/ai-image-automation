// 批量产图页 P1：高频路径壳层、模式切换与轻量状态同步。
(function () {
    const state = {
        mode: 'reference',
        scanned: false,
        running: false
    };

    const $ = (id) => document.getElementById(id);

    function setText(id, value) {
        const el = $(id);
        if (el) el.textContent = value;
    }

    function modelLabel(value) {
        const normalized = String(value || '').trim();
        const fromButton = Array.from(document.querySelectorAll('[data-legil-setting="imageModel"]'))
            .find(button => button.dataset.value === normalized);
        const text = fromButton?.querySelector('.model-option-title')?.textContent?.trim();
        if (text) return text;
        const fallback = {
            'nano-banana-2': 'Nano Banana 2',
            'nano-banana-pro': 'Nano Banana Pro',
            'nano-banana': 'Nano Banana',
            'gpt-image-2': 'GPT Image 2',
            'gpt-image-1': 'GPT Image 1'
        };
        return fallback[normalized] || normalized || 'Nano Banana 2';
    }

    function winkyModelLabel() {
        const selected = $('lumosPromptModelSelect');
        const selectedText = selected?.selectedOptions?.[0]?.textContent?.trim();
        const selectedValue = selected?.value?.trim();
        const configModel = config?.workflowPromptGeneration?.lumos?.model || config?.workflowPromptGeneration?.model || '';
        if (selectedValue && selectedText && !/正在|自动读取|当前|等待|未读取/.test(selectedText)) return selectedText;
        if (selectedValue) return selectedValue;
        if (configModel) return configModel;
        return 'gpt-5.5';
    }

    function browserModeLabel(value) {
        return value === 'headed' ? '有头' : '无头';
    }

    window.updateMassParameterSummary = function updateMassParameterSummary() {
        const generation = config?.legilGeneration || {};
        setText('massSummaryWinky', winkyModelLabel());
        ['', 'table'].forEach(prefix => {
            const idPrefix = prefix || 'mass';
            setText(`${idPrefix}SummaryModel`, modelLabel(generation.imageModel));
            setText(`${idPrefix}SummaryRatio`, generation.aspectRatio || '1:1');
            setText(`${idPrefix}SummaryResolution`, generation.resolution || '2K');
            setText(`${idPrefix}SummaryOutput`, `${Number(generation.outputQuantity) || 1} 张`);
            setText(`${idPrefix}SummaryBrowserMode`, browserModeLabel(config?.workflowBrowserMode));
        });
        if (typeof refreshTablePromptStats === 'function') {
            refreshTablePromptStats();
        }
    };

    function updateMassActionState() {
        const workbench = $('massWorkbench');
        if (!workbench) return;

        workbench.classList.toggle('is-scanned', state.scanned);
        workbench.classList.toggle('is-running', state.running);

        const stickyPrimary = $('massStickyPrimaryBtn');
        if (stickyPrimary) {
            stickyPrimary.textContent = state.running
                ? '查看日志'
                : (state.scanned ? '开始自动产图' : '扫描参考图');
        }

        const miniStatus = $('massMiniStatus');
        if (miniStatus && !state.running) {
            miniStatus.dataset.state = state.scanned ? 'ready' : 'idle';
            if (state.scanned) {
                setText('massMiniStage', '已扫描');
                setText('massMiniCurrentImage', '可启动任务');
            }
        }
    }

    window.switchMassMode = function switchMassMode(mode = 'reference') {
        state.mode = mode;
        document.querySelectorAll('[data-mass-mode]').forEach(button => {
            button.classList.toggle('active', button.dataset.massMode === mode);
        });
        document.querySelectorAll('[data-mass-mode-panel]').forEach(panel => {
            panel.classList.toggle('active', panel.dataset.massModePanel === mode);
        });
    };

    async function countFolder(inputId, infoId, historyId) {
        const input = $(inputId);
        const infoBox = $(infoId);
        const folderPath = input?.value?.trim() || '';
        if (!folderPath) {
            if (infoBox) {
                infoBox.className = 'info-box error';
                infoBox.textContent = '请先填写文件夹路径';
            }
            return { success: false, count: 0 };
        }

        if (infoBox) {
            infoBox.className = 'info-box loading';
            infoBox.textContent = '统计中...';
        }

        try {
            const res = await fetch('/api/count-images', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ folderPath })
            });
            const data = await res.json();
            if (data.success) {
                if (infoBox) {
                    infoBox.className = 'info-box success';
                    infoBox.textContent = `找到 ${data.count} 张参考图`;
                }
                if (typeof addFolderHistory === 'function') {
                    addFolderHistory(historyId || inputId, folderPath);
                }
                return { success: true, count: Number(data.count) || 0 };
            }

            if (infoBox) {
                infoBox.className = 'info-box error';
                infoBox.textContent = data.message || '统计失败';
            }
            return { success: false, count: 0 };
        } catch (e) {
            if (infoBox) {
                infoBox.className = 'info-box error';
                infoBox.textContent = '请求失败';
            }
            return { success: false, count: 0 };
        }
    }

    window.scanMassReferenceFolders = async function scanMassReferenceFolders() {
        const scanBtn = $('massScanBtn');
        if (scanBtn) {
            scanBtn.disabled = true;
            scanBtn.textContent = '扫描中...';
        }

        try {
            const reference = await countFolder('referenceFolder', 'refCountInfo', 'referenceFolder');
            const legilReference = await countFolder('legilReferenceFolder', 'legilRefCountInfo', 'legilReferenceFolder');
            const saveFolder = $('saveFolder')?.value?.trim() || '';
            if (saveFolder && typeof addFolderHistory === 'function') {
                addFolderHistory('saveFolder', saveFolder);
            }
            if (legilReference.success && typeof saveLegilRefFolder === 'function') {
                await saveLegilRefFolder({ silent: true });
            }

            state.scanned = reference.success && reference.count > 0;
            updateMassActionState();
            setText('massMiniProgress', reference.success ? `0 / ${reference.count}` : '0 / 0');

            if (state.scanned) {
                showToast(`已扫描 ${reference.count} 张参考图`);
            } else if (typeof showToast === 'function') {
                showToast('参考图文件夹为空或不可访问', 'error');
            }
        } finally {
            if (scanBtn) {
                scanBtn.disabled = false;
                scanBtn.textContent = '扫描参考图';
            }
        }
    };

    window.handleMassStickyPrimaryAction = function handleMassStickyPrimaryAction() {
        if (state.running) {
            scrollMassProgressIntoView();
            return;
        }
        if (state.scanned) {
            startWorkflowWithConfirm();
            return;
        }
        scanMassReferenceFolders();
    };

    window.scrollMassProgressIntoView = function scrollMassProgressIntoView() {
        $('logSection')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    function phaseLabel(phase, action) {
        if (action) return action;
        const labels = {
            idle: '待启动',
            starting: '正在启动',
            processing_image: '处理参考图',
            extracting_prompts: '生成提示词',
            generating_in_legil: '生图中',
            stopped: '已暂停',
            completed: '已完成',
            error: '任务异常'
        };
        return labels[phase] || '处理中';
    }

    window.setMassWorkflowRunningState = function setMassWorkflowRunningState(isRunning) {
        state.running = Boolean(isRunning);
        if (state.running) state.scanned = true;
        updateMassActionState();
        const miniStatus = $('massMiniStatus');
        if (miniStatus) miniStatus.dataset.state = state.running ? 'running' : (state.scanned ? 'ready' : 'idle');
    };

    window.updateMassWorkflowStatus = function updateMassWorkflowStatus(status = {}, detail = {}) {
        state.running = Boolean(status.isRunning);
        if (state.running || Number(status.totalImages) > 0 || Number(detail.totalImages) > 0) {
            state.scanned = true;
        }

        const totalImages = Number(detail.totalImages || status.totalImages) || 0;
        const currentImage = Number(detail.currentImageIndex || status.currentIndex + 1) || 0;
        const currentName = detail.currentImageName || status.currentImage || '等待参考图';
        const progressText = totalImages > 0 ? `${Math.min(currentImage, totalImages)} / ${totalImages}` : '0 / 0';
        const stage = phaseLabel(detail.phase, detail.currentAction);

        setText('massMiniStage', stage);
        setText('massMiniCurrentImage', currentName);
        setText('massMiniProgress', progressText);

        const miniStatus = $('massMiniStatus');
        if (miniStatus) {
            miniStatus.dataset.state = state.running
                ? 'running'
                : (detail.phase === 'completed' ? 'completed' : (detail.phase === 'error' ? 'error' : (state.scanned ? 'ready' : 'idle')));
        }

        updateMassActionState();
    };

    document.addEventListener('DOMContentLoaded', () => {
        switchMassMode('reference');
        updateMassParameterSummary();
        updateMassActionState();

        $('massPage')?.addEventListener('click', () => {
            window.setTimeout(updateMassParameterSummary, 0);
        });
        $('massPage')?.addEventListener('change', () => {
            window.setTimeout(updateMassParameterSummary, 0);
        });
        ['referenceFolder', 'legilReferenceFolder', 'saveFolder'].forEach(id => {
            $(id)?.addEventListener('input', () => {
                if (!state.running) {
                    state.scanned = false;
                    setText('massMiniStage', '待启动');
                    setText('massMiniCurrentImage', '路径已调整');
                    setText('massMiniProgress', '0 / 0');
                    updateMassActionState();
                }
            });
        });
        window.setTimeout(updateMassParameterSummary, 600);
        window.setTimeout(updateMassParameterSummary, 1600);
        window.setInterval(updateMassParameterSummary, 2500);
    });
})();
