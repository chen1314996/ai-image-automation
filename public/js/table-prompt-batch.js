// 批量产图页：从 CSV/XLSX 表格提取 AI提示词，并接入可恢复 Legil 批量产图。
(function () {
    const state = {
        files: [],
        prompts: [],
        summary: null,
        warnings: [],
        resume: null,
        progressTimer: null
    };
    const folderConfigStorageKey = 'ai-image-automation-table-prompt-folders-v1';

    function $(id) {
        return document.getElementById(id);
    }

    function escapeHtmlText(value) {
        const div = document.createElement('div');
        div.textContent = String(value || '');
        return div.innerHTML;
    }

    function setInfo(type, message) {
        const info = $('tablePromptsInfo');
        if (!info) return;
        info.className = `info-box ${type || ''}`.trim();
        info.textContent = message || '';
    }

    function getTablePromptFolderDefaults() {
        return {
            referenceFolder: config?.tablePromptReferenceFolder || config?.legilReferenceFolder || 'D:\\工作\\自动化工作流1\\批量产图\\参考图',
            outputFolder: config?.tablePromptOutputFolder || config?.saveFolder || 'D:\\工作\\自动化工作流1\\批量产图\\输出'
        };
    }

    function readTablePromptFolderConfig() {
        try {
            const parsed = JSON.parse(localStorage.getItem(folderConfigStorageKey) || '{}');
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch (error) {
            return {};
        }
    }

    function getTablePromptFolders() {
        const defaults = getTablePromptFolderDefaults();
        return {
            referenceFolder: $('tablePromptReferenceFolder')?.value.trim() || defaults.referenceFolder,
            outputFolder: $('tablePromptOutputFolder')?.value.trim() || defaults.outputFolder
        };
    }

    function persistTablePromptFolderConfig() {
        const folders = getTablePromptFolders();
        config.tablePromptReferenceFolder = folders.referenceFolder;
        config.tablePromptOutputFolder = folders.outputFolder;
        try {
            localStorage.setItem(folderConfigStorageKey, JSON.stringify(folders));
        } catch (error) {}
        if (typeof addFolderHistory === 'function') {
            addFolderHistory('tablePromptReferenceFolder', folders.referenceFolder);
            addFolderHistory('tablePromptOutputFolder', folders.outputFolder);
        }
        return folders;
    }

    function initTablePromptFolderConfig() {
        const saved = readTablePromptFolderConfig();
        const defaults = getTablePromptFolderDefaults();
        const referenceInput = $('tablePromptReferenceFolder');
        const outputInput = $('tablePromptOutputFolder');

        if (referenceInput) {
            referenceInput.value = saved.referenceFolder || defaults.referenceFolder;
            config.tablePromptReferenceFolder = referenceInput.value;
            referenceInput.addEventListener('blur', () => persistTablePromptFolderConfig());
            referenceInput.addEventListener('change', () => persistTablePromptFolderConfig());
        }
        if (outputInput) {
            outputInput.value = saved.outputFolder || defaults.outputFolder;
            config.tablePromptOutputFolder = outputInput.value;
            outputInput.addEventListener('blur', () => persistTablePromptFolderConfig());
            outputInput.addEventListener('change', () => persistTablePromptFolderConfig());
        }
        persistTablePromptFolderConfig();
    }

    function setButtonState() {
        const selectedCount = getSelectedTablePrompts().length;
        const hasResume = state.resume && state.resume.hasResume && Number(state.resume.remainingCount) > 0;
        const running = state.resume && state.resume.running === true;

        const startBtn = $('tablePromptStartBtn');
        if (startBtn) {
            startBtn.disabled = running || selectedCount === 0;
        }

        const stopBtn = $('tablePromptStopBtn');
        if (stopBtn) {
            stopBtn.disabled = !running;
            stopBtn.textContent = running ? '暂停任务' : '暂停任务';
        }

        const resumeBtn = $('tablePromptResumeBtn');
        if (resumeBtn) {
            resumeBtn.disabled = running || !hasResume;
            resumeBtn.textContent = hasResume ? `继续任务（剩余 ${state.resume.remainingCount} 组）` : '继续任务';
        }
    }

    function updateStats() {
        const summary = state.summary || {};
        const selectedCount = getSelectedTablePrompts().length;
        const outputQuantity = Number(config?.legilGeneration?.outputQuantity) || 1;
        const imageCount = selectedCount * outputQuantity;

        const values = {
            tablePromptFileCount: summary.fileCount || state.files.length || 0,
            tablePromptSheetCount: summary.sheetCount || 0,
            tablePromptRowCount: summary.rowCount || 0,
            tablePromptPromptCount: `${selectedCount} / ${summary.promptCount || state.prompts.length || 0}`,
            tablePromptImageCount: imageCount
        };

        Object.entries(values).forEach(([id, value]) => {
            const el = $(id);
            if (el) el.textContent = value;
        });
    }

    function renderWarnings() {
        const box = $('tablePromptsWarnings');
        if (!box) return;
        const warnings = Array.isArray(state.warnings) ? state.warnings.filter(Boolean) : [];
        if (!warnings.length) {
            box.innerHTML = '';
            box.hidden = true;
            return;
        }

        box.hidden = false;
        box.innerHTML = warnings.slice(0, 10)
            .map(item => `<div class="table-prompts-warning">${escapeHtmlText(item)}</div>`)
            .join('');
    }

    function getPromptPreview(prompt = {}) {
        return String(prompt.prompt || '').slice(0, 180) + (String(prompt.prompt || '').length > 180 ? '...' : '');
    }

    function getDirectionMatchText(prompt = {}) {
        if (prompt.directionLibraryMatched) {
            return prompt.matchedDirectionPath || (Array.isArray(prompt.standardLabelPath) ? prompt.standardLabelPath.join(' / ') : '') || '已命中方向库';
        }
        return '未命中方向库';
    }

    function renderPreview() {
        const list = $('tablePromptsPreview');
        if (!list) return;

        if (!state.prompts.length) {
            list.innerHTML = '<div class="table-prompts-empty">上传表格后会显示提示词预览。</div>';
            updateStats();
            renderWarnings();
            setButtonState();
            return;
        }

        const visiblePrompts = state.prompts.slice(0, 80);
        list.innerHTML = visiblePrompts.map((prompt, index) => {
            const checked = prompt.selected !== false ? 'checked' : '';
            const source = [
                prompt.tableFileName,
                prompt.sheetName,
                prompt.sourceRow ? `第${prompt.sourceRow}行` : ''
            ].filter(Boolean).join(' / ');
            const matchClass = prompt.directionLibraryMatched ? 'is-matched' : 'is-unmatched';

            return `
                <label class="table-prompt-row ${matchClass}">
                    <input type="checkbox" ${checked} data-table-prompt-index="${index}">
                    <span class="table-prompt-main">
                        <strong>${escapeHtmlText(prompt.outputNameBase || prompt.direction || `提示词${index + 1}`)}</strong>
                        <em>${escapeHtmlText(source)}</em>
                        <span class="table-prompt-match">${escapeHtmlText(getDirectionMatchText(prompt))}</span>
                        <span class="table-prompt-content-name">图片内容名：${escapeHtmlText(prompt.contentName || prompt.contentTitle || '图片内容')}</span>
                        <span>${escapeHtmlText(prompt.promptTitle || prompt.promptColumn || '')}</span>
                        <p>${escapeHtmlText(getPromptPreview(prompt))}</p>
                    </span>
                </label>
            `;
        }).join('');

        if (state.prompts.length > visiblePrompts.length) {
            list.insertAdjacentHTML(
                'beforeend',
                `<div class="table-prompts-more">已显示前 ${visiblePrompts.length} 条，实际会按勾选状态提交全部 ${state.prompts.length} 条。</div>`
            );
        }

        list.querySelectorAll('[data-table-prompt-index]').forEach(input => {
            input.addEventListener('change', event => {
                const index = Number(event.currentTarget.dataset.tablePromptIndex);
                if (state.prompts[index]) {
                    state.prompts[index].selected = event.currentTarget.checked;
                }
                updateStats();
                setButtonState();
            });
        });

        updateStats();
        renderWarnings();
        setButtonState();
    }

    function getSelectedTablePrompts() {
        return state.prompts.filter(item => item && item.selected !== false && String(item.prompt || '').trim());
    }

    function readFileAsBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const result = String(reader.result || '');
                resolve(result.includes(',') ? result.split(',').pop() : result);
            };
            reader.onerror = () => reject(new Error(`读取文件失败：${file.name}`));
            reader.readAsDataURL(file);
        });
    }

    async function importTablePromptFiles(files) {
        const safeFiles = Array.from(files || []);
        if (!safeFiles.length) {
            showToast('请选择 CSV 或 XLSX 文件', 'error');
            return;
        }

        setInfo('loading', '正在解析表格...');
        state.files = safeFiles.map(file => file.name);
        state.prompts = [];
        state.summary = null;
        state.warnings = [];
        renderPreview();

        try {
            const payloadFiles = await Promise.all(safeFiles.map(async file => ({
                name: file.name,
                size: file.size,
                type: file.type,
                contentBase64: await readFileAsBase64(file)
            })));

            const response = await fetch('/api/table-prompts/import', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ files: payloadFiles })
            });
            const data = await response.json();
            if (!data.success) {
                throw new Error(data.message || '表格解析失败');
            }

            state.summary = data.summary || {};
            state.prompts = Array.isArray(data.prompts)
                ? data.prompts.map(item => ({ ...item, selected: item.selected !== false }))
                : [];
            state.warnings = Array.isArray(data.warnings) ? data.warnings : [];

            const outputQuantity = Number(config?.legilGeneration?.outputQuantity) || 1;
            const matchedCount = Number(state.summary.directionMatchedCount) || 0;
            const unmatchedCount = Number(state.summary.directionUnmatchedCount) || 0;
            if (unmatchedCount > 0) {
                state.warnings = state.warnings.concat(`有 ${unmatchedCount} 条提示词未命中方向库，将使用“未归类_图片内容名”命名。`);
            }
            setInfo(
                state.prompts.length ? 'success' : 'error',
                state.prompts.length
                    ? `已提取 ${state.prompts.length} 条提示词，方向库命中 ${matchedCount} 条，当前预计产图 ${state.prompts.length * outputQuantity} 张。`
                    : '没有提取到可用提示词，请检查表头是否包含“AI提示词”。'
            );
            addLog(`✅ 表格提示词解析完成：${state.prompts.length} 条`, 'success');
            showToast(`已提取 ${state.prompts.length} 条提示词`);
            renderPreview();
        } catch (error) {
            setInfo('error', '❌ ' + error.message);
            showToast(error.message || '表格解析失败', 'error');
            renderPreview();
        }
    }

    async function startTablePromptBatch(options = {}) {
        const selectedPrompts = getSelectedTablePrompts();
        const folders = persistTablePromptFolderConfig();
        const outputFolder = folders.outputFolder;
        const referenceFolder = folders.referenceFolder;

        if (!selectedPrompts.length) {
            showToast('请至少选择一条提示词', 'error');
            return;
        }
        if (!outputFolder) {
            showToast('请填写输出文件夹', 'error');
            return;
        }
        if (!referenceFolder) {
            showToast('请填写 Legil参考图文件夹', 'error');
            return;
        }

        const outputQuantity = Number(config?.legilGeneration?.outputQuantity) || 1;
        const confirmed = options.skipConfirm === true || confirm(
            '确认开始表格批量产图？\n\n' +
            `提示词：${selectedPrompts.length} 条\n` +
            `预计产图：${selectedPrompts.length * outputQuantity} 张\n` +
            `参考图文件夹：${referenceFolder}\n` +
            `输出文件夹：${outputFolder}\n\n` +
            '任务可暂停，服务器重启后可继续剩余提示词。'
        );
        if (!confirmed) return;

        setInfo('loading', '正在启动表格批量产图任务...');
        setButtonState();

        try {
            if (typeof saveLegilGenerationConfig === 'function') {
                const saved = await saveLegilGenerationConfig({ silent: true });
                if (!saved) {
                    throw new Error('Legil生成参数保存失败');
                }
            }
            addFolderHistory('tablePromptOutputFolder', outputFolder);
            addFolderHistory('tablePromptReferenceFolder', referenceFolder);

            const response = await fetch('/api/legil/creative-batch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    outputFolder,
                    referenceFolder,
                    prompts: selectedPrompts,
                    tableFileName: state.files.length ? state.files.join(' + ') : '表格提示词批量产图',
                    browserMode: config.workflowBrowserMode,
                    generationSettings: config.legilGeneration,
                    resumeMode: options.resumeMode === true,
                    resumeRunId: options.resumeRunId || '',
                    persistCreativeConfig: false
                })
            });
            const data = await response.json();
            if (!data.success) {
                throw new Error(data.message || '启动失败');
            }

            setInfo('success', `已启动表格批量产图：${data.totalPrompts || selectedPrompts.length} 条提示词。`);
            addLog(`✅ 表格批量产图已启动：${data.totalPrompts || selectedPrompts.length} 条提示词`, 'success');
            showToast('表格批量产图已启动');
            startTablePromptProgressPolling();
        } catch (error) {
            setInfo('error', '❌ ' + error.message);
            showToast(error.message || '启动失败', 'error');
            setButtonState();
        }
    }

    async function stopTablePromptBatch() {
        const stopBtn = $('tablePromptStopBtn');
        if (stopBtn) {
            stopBtn.disabled = true;
            stopBtn.textContent = '暂停中...';
        }
        setInfo('loading', '正在发送暂停指令...');

        try {
            const response = await fetch('/api/legil/stop', { method: 'POST' });
            const data = await response.json();
            if (!data.success) {
                throw new Error(data.message || '暂停失败');
            }
            setInfo('loading', '已发送暂停指令，当前提示词完成后会保存续跑状态。');
            showToast('已发送暂停指令');
            startTablePromptProgressPolling();
        } catch (error) {
            setInfo('error', '❌ ' + error.message);
            showToast(error.message || '暂停失败', 'error');
            if (stopBtn) {
                stopBtn.disabled = false;
                stopBtn.textContent = '暂停任务';
            }
        }
    }

    async function resumeTablePromptBatch() {
        await refreshTablePromptResume();
        if (!state.resume || !state.resume.hasResume) {
            showToast('没有可继续的任务', 'error');
            return;
        }

        const prompts = Array.isArray(state.resume.prompts)
            ? state.resume.prompts.filter(item => item && item.selected !== false && String(item.prompt || '').trim())
            : [];
        if (!prompts.length) {
            showToast('恢复状态里没有剩余提示词', 'error');
            return;
        }

        state.prompts = prompts.map(item => ({ ...item, selected: item.selected !== false }));
        state.summary = {
            ...(state.summary || {}),
            fileCount: state.resume.tableFileName ? 1 : state.files.length,
            sheetCount: state.summary?.sheetCount || 0,
            rowCount: state.summary?.rowCount || 0,
            promptCount: prompts.length
        };
        renderPreview();

        await startTablePromptBatch({
            resumeMode: true,
            resumeRunId: state.resume.runId || '',
            skipConfirm: false
        });
    }

    function formatProgress(progress = {}) {
        const total = Number(progress.total) || 0;
        const completed = Number(progress.completed) || 0;
        const success = Number(progress.success) || 0;
        const failed = Number(progress.failed) || 0;
        const saved = Number(progress.saved) || 0;
        const phase = progress.phase || 'idle';
        return `${phase}：${completed}/${total}，成功 ${success}，失败 ${failed}，保存 ${saved} 张。${progress.currentAction || ''}`;
    }

    async function refreshTablePromptResume() {
        try {
            const [resumeResponse, progressResponse] = await Promise.all([
                fetch('/api/legil/creative-resume'),
                fetch('/api/legil/creative-progress')
            ]);
            const resumeData = await resumeResponse.json();
            const progressData = await progressResponse.json();
            const resume = resumeData.success ? resumeData.resume : null;
            const progressSnapshot = progressData.success ? progressData : null;
            const running = progressSnapshot && progressSnapshot.running === true && progressSnapshot.taskType === 'creative-batch';

            state.resume = resume && resume.hasResume
                ? { ...resume, running }
                : (running ? {
                    hasResume: false,
                    running,
                    remainingCount: 0,
                    progress: progressSnapshot.progress
                } : null);

            if (running && progressSnapshot.progress) {
                setInfo('loading', formatProgress(progressSnapshot.progress));
            } else if (resume && resume.hasResume) {
                setInfo('success', `发现可继续任务：已完成 ${resume.completed || 0}/${resume.total || 0}，剩余 ${resume.remainingCount || 0} 组。`);
            } else if (!state.prompts.length) {
                setInfo('', '等待上传表格。');
            }
            setButtonState();
            return state.resume;
        } catch (error) {
            setButtonState();
            return null;
        }
    }

    async function checkTablePromptProgress() {
        try {
            const response = await fetch('/api/legil/creative-progress');
            const data = await response.json();
            if (!data.success || data.taskType !== 'creative-batch' || !data.progress) {
                await refreshTablePromptResume();
                return;
            }

            const progress = data.progress;
            state.resume = {
                ...(state.resume || {}),
                running: data.running === true,
                hasResume: data.resume && data.resume.hasResume,
                remainingCount: data.resume ? data.resume.remainingCount : 0,
                progress
            };
            setInfo(data.running ? 'loading' : 'success', formatProgress(progress));
            setButtonState();

            if (!data.running && ['completed', 'stopped', 'interrupted'].includes(String(progress.phase || ''))) {
                clearInterval(state.progressTimer);
                state.progressTimer = null;
                await refreshTablePromptResume();
            }
        } catch (error) {
            clearInterval(state.progressTimer);
            state.progressTimer = null;
            await refreshTablePromptResume();
        }
    }

    function startTablePromptProgressPolling() {
        if (state.progressTimer) {
            clearInterval(state.progressTimer);
        }
        checkTablePromptProgress();
        state.progressTimer = setInterval(checkTablePromptProgress, 3000);
    }

    function initDropzone() {
        const dropzone = $('tablePromptsDropzone');
        if (!dropzone) return;

        ['dragenter', 'dragover'].forEach(eventName => {
            dropzone.addEventListener(eventName, event => {
                event.preventDefault();
                dropzone.classList.add('is-dragover');
            });
        });
        ['dragleave', 'drop'].forEach(eventName => {
            dropzone.addEventListener(eventName, event => {
                event.preventDefault();
                dropzone.classList.remove('is-dragover');
            });
        });
        dropzone.addEventListener('drop', event => {
            importTablePromptFiles(event.dataTransfer.files);
        });
    }

    window.initTablePromptBatch = function initTablePromptBatch() {
        initTablePromptFolderConfig();
        initDropzone();
        renderPreview();
        refreshTablePromptResume();
    };

    window.handleTablePromptFilesChange = function handleTablePromptFilesChange(input) {
        importTablePromptFiles(input && input.files);
        if (input) input.value = '';
    };

    window.clearTablePromptImport = function clearTablePromptImport() {
        state.files = [];
        state.prompts = [];
        state.summary = null;
        state.warnings = [];
        renderPreview();
        setInfo('', '等待上传表格。');
    };

    window.setAllTablePromptsSelected = function setAllTablePromptsSelected(selected) {
        state.prompts.forEach(item => {
            item.selected = selected === true;
        });
        renderPreview();
    };

    window.selectFirstTablePrompts = function selectFirstTablePrompts(count) {
        const limit = Math.max(0, Number(count) || 0);
        state.prompts.forEach((item, index) => {
            item.selected = index < limit;
        });
        renderPreview();
    };

    window.startTablePromptBatch = startTablePromptBatch;
    window.stopTablePromptBatch = stopTablePromptBatch;
    window.resumeTablePromptBatch = resumeTablePromptBatch;
    window.refreshTablePromptResume = refreshTablePromptResume;
    window.refreshTablePromptStats = updateStats;
    window.persistTablePromptFolderConfig = persistTablePromptFolderConfig;
})();
