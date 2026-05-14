// 创意拓展 Agent：上传表格、解析提示词、启动 Agent 任务、查看任务结果。
        function readFileAsBase64(file) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => {
                    const result = String(reader.result || '');
                    resolve(result.includes(',') ? result.split(',').pop() : result);
                };
                reader.onerror = () => reject(new Error('读取表格文件失败'));
                reader.readAsDataURL(file);
            });
        }

        function setCreativeAgentInfo(className, text) {
            const infoBox = document.getElementById('creativeAgentInfo');
            if (!infoBox) return;
            infoBox.className = className;
            infoBox.textContent = text;
        }

        function getCreativeAgentPhaseLabel(phase) {
            const labels = {
                queued: '排队中',
                running: '运行中',
                completed: '已完成',
                failed: '失败',
                cancelled: '已取消'
            };
            return labels[String(phase || '')] || '未启动';
        }

        function setCreativeAgentTaskPanel(task) {
            const panel = document.getElementById('creativeAgentTaskPanel');
            const phaseEl = document.getElementById('creativeAgentTaskPhase');
            const actionEl = document.getElementById('creativeAgentTaskAction');
            if (!panel) return;

            if (!task) {
                panel.classList.remove('active');
                if (phaseEl) phaseEl.textContent = '未启动';
                if (actionEl) actionEl.textContent = '等待运行';
                return;
            }

            panel.classList.add('active');
            if (phaseEl) phaseEl.textContent = getCreativeAgentPhaseLabel(task.phase);
            if (actionEl) actionEl.textContent = task.currentAction || task.message || '任务处理中...';
        }

        function stopCreativeAgentPolling() {
            if (creativeAgentStatusInterval) {
                clearInterval(creativeAgentStatusInterval);
                creativeAgentStatusInterval = null;
            }
        }

        function setCreativeAgentRunningState(running) {
            const runBtn = document.getElementById('creativeAgentRunBtn');
            const cancelBtn = document.getElementById('creativeAgentCancelBtn');
            if (runBtn) {
                runBtn.disabled = running === true;
                runBtn.textContent = running === true ? '运行中...' : '运行Agent';
            }
            if (cancelBtn) {
                cancelBtn.hidden = running !== true;
                cancelBtn.disabled = running !== true;
                cancelBtn.textContent = '取消运行';
            }
        }

        function renderCreativeAgentQuality(report) {
            const box = document.getElementById('creativeAgentQuality');
            if (!box) return;
            box.textContent = '';

            if (!report || !Number.isFinite(Number(report.totalPrompts))) {
                box.className = 'creative-agent-quality';
                return;
            }

            const errorCount = Array.isArray(report.errors) ? report.errors.length : 0;
            const warningCount = Array.isArray(report.warnings) ? report.warnings.length : 0;
            box.className = `creative-agent-quality active ${errorCount > 0 ? 'error' : (warningCount > 0 ? 'warn' : 'ok')}`;

            const summary = document.createElement('div');
            summary.textContent = `${report.summary || '质检完成'}；方向 ${report.directionCount || 0} 个，提示词 ${report.totalPrompts || 0} 组。`;
            box.appendChild(summary);

            const issues = [
                ...(Array.isArray(report.errors) ? report.errors : []),
                ...(Array.isArray(report.warnings) ? report.warnings : [])
            ].slice(0, 6);
            issues.forEach(issue => {
                const row = document.createElement('div');
                row.textContent = `· ${issue.severity === 'error' ? '严重' : '提醒'}：${issue.direction || `第${issue.index || ''}组`} / ${issue.promptTitle || ''} - ${issue.message || ''}`;
                box.appendChild(row);
            });
            if (errorCount + warningCount > issues.length) {
                const more = document.createElement('div');
                more.textContent = `· 还有 ${errorCount + warningCount - issues.length} 条问题未显示，可下载表格后逐项检查。`;
                box.appendChild(more);
            }
        }

        function renderCreativeAgentPreview(prompts) {
            const box = document.getElementById('creativeAgentPreview');
            if (!box) return;
            box.textContent = '';

            const safePrompts = Array.isArray(prompts) ? prompts : [];
            if (safePrompts.length === 0) {
                box.classList.remove('active');
                return;
            }

            const groups = getCreativePromptGroups(safePrompts);
            groups.slice(0, 8).forEach((group, index) => {
                const item = document.createElement('div');
                item.className = 'creative-agent-preview-item';

                const title = document.createElement('div');
                title.className = 'creative-agent-preview-title';
                title.textContent = `#${index + 1} ${group.title}（${group.prompts.length}组）`;

                const text = document.createElement('div');
                text.className = 'creative-agent-preview-text';
                const firstPrompt = String(group.prompts[0]?.prompt || '').trim();
                text.textContent = firstPrompt.length > 180 ? `${firstPrompt.slice(0, 180)}...` : firstPrompt;

                item.appendChild(title);
                item.appendChild(text);
                box.appendChild(item);
            });

            if (groups.length > 8) {
                const more = document.createElement('div');
                more.className = 'creative-agent-preview-item creative-agent-preview-text';
                more.textContent = `还有 ${groups.length - 8} 个方向未显示，提取后可在主页面完整选择。`;
                box.appendChild(more);
            }

            box.classList.add('active');
        }

        function applyCreativeAgentResult(data) {
            creativeAgentLastResult = data;
            document.getElementById('creativeAgentResult')?.classList.add('active');
            const downloadBtn = document.getElementById('creativeAgentDownloadBtn');
            const extractBtn = document.getElementById('creativeAgentExtractBtn');
            const promptCount = Array.isArray(data.prompts) ? data.prompts.length : 0;
            if (downloadBtn) downloadBtn.disabled = !data.downloadUrl;
            if (extractBtn) extractBtn.disabled = promptCount === 0;
            renderCreativeAgentQuality(data.qualityReport);
            renderCreativeAgentPreview(data.prompts);

            const qualityHasErrors = Array.isArray(data.qualityReport?.errors) && data.qualityReport.errors.length > 0;
            setCreativeAgentInfo(
                qualityHasErrors ? 'info-box error' : 'info-box success',
                qualityHasErrors
                    ? `⚠️ Agent已生成表格：${data.fileName || 'creative_agent.xlsx'}；提取到 ${promptCount} 组提示词，但质检发现严重问题`
                    : `✅ Agent已生成表格：${data.fileName || 'creative_agent.xlsx'}；可提取 ${promptCount} 组提示词`
            );

            if (promptCount > 0 && (!Array.isArray(config.creativePrompts) || config.creativePrompts.length === 0)) {
                applyCreativeAgentPromptsToCreativePage({ silent: true });
            }
        }

        async function loadCreativeAgentStatus() {
            try {
                const res = await fetch('/api/creative-agent/status');
                const data = await readJsonResponse(res, '读取创意拓展Agent状态失败');
                creativeAgentServerStatus = data;

                const apiUrlInput = document.getElementById('creativeAgentApiUrl');
                const modelInput = document.getElementById('creativeAgentModel');
                const providerInput = document.getElementById('creativeAgentProvider');
                if (apiUrlInput && !apiUrlInput.value && data.defaults?.apiUrl) apiUrlInput.value = data.defaults.apiUrl;
                if (modelInput && !modelInput.value && data.defaults?.model) modelInput.value = data.defaults.model;
                if (providerInput && !providerInput.value && data.defaults?.provider) providerInput.value = data.defaults.provider;

                const keyHint = document.getElementById('creativeAgentKeyHint');
                if (keyHint) {
                    keyHint.textContent = data.configured?.apiKey
                        ? '服务器已配置 WINKY_API_KEY；页面留空也可以运行，Key 不会回传到前端。'
                        : 'Key 只随本次请求发送到本机后端，不会保存到配置或日志。';
                }
            } catch (e) {}
        }

        function openCreativeAgentDialog() {
            document.getElementById('creativeAgentModal')?.classList.add('active');
            renderCreativeAgentFileList();
            loadCreativeAgentStatus();
        }

        function closeCreativeAgentDialog() {
            document.getElementById('creativeAgentModal')?.classList.remove('active');
        }

        function creativeAgentFileKey(file) {
            return [
                file.webkitRelativePath || file.name,
                file.size,
                file.lastModified
            ].join('::');
        }

        function handleCreativeAgentFilesChange(input) {
            const incoming = Array.from(input?.files || []);
            const existingKeys = new Set(creativeAgentFiles.map(creativeAgentFileKey));
            incoming.forEach(file => {
                const key = creativeAgentFileKey(file);
                if (!existingKeys.has(key)) {
                    creativeAgentFiles.push(file);
                    existingKeys.add(key);
                }
            });
            if (input) input.value = '';
            renderCreativeAgentFileList();
        }

        function clearCreativeAgentFiles() {
            creativeAgentFiles = [];
            renderCreativeAgentFileList();
        }

        function formatBytes(bytes) {
            const value = Number(bytes) || 0;
            if (value < 1024) return `${value} B`;
            if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
            return `${(value / 1024 / 1024).toFixed(1)} MB`;
        }

        function renderCreativeAgentFileList() {
            const list = document.getElementById('creativeAgentFileList');
            if (!list) return;

            if (!creativeAgentFiles.length) {
                list.textContent = '未添加参考资料';
                return;
            }

            const totalSize = creativeAgentFiles.reduce((sum, file) => sum + (Number(file.size) || 0), 0);
            const visible = creativeAgentFiles.slice(0, 10);
            list.innerHTML = [
                `<strong>${creativeAgentFiles.length} 个文件 / ${formatBytes(totalSize)}</strong>`,
                ...visible.map(file => `· ${file.webkitRelativePath || file.name} (${formatBytes(file.size)})`),
                creativeAgentFiles.length > visible.length ? `· 还有 ${creativeAgentFiles.length - visible.length} 个文件未显示` : ''
            ].filter(Boolean).join('<br>');
        }

        async function buildCreativeAgentAttachments() {
            const maxTotalBytes = 42 * 1024 * 1024;
            const totalSize = creativeAgentFiles.reduce((sum, file) => sum + (Number(file.size) || 0), 0);
            if (totalSize > maxTotalBytes) {
                throw new Error(`参考资料总大小 ${formatBytes(totalSize)} 超过限制，请减少到 42 MB 以内`);
            }

            const attachments = [];
            for (const file of creativeAgentFiles) {
                const contentBase64 = await readFileAsBase64(file);
                attachments.push({
                    name: file.name,
                    relativePath: file.webkitRelativePath || file.name,
                    mimeType: file.type || '',
                    size: file.size,
                    contentBase64
                });
            }
            return attachments;
        }

        function resetCreativeAgentResult() {
            creativeAgentLastResult = null;
            creativeAgentCurrentRunId = '';
            stopCreativeAgentPolling();
            document.getElementById('creativeAgentResult')?.classList.remove('active');
            const downloadBtn = document.getElementById('creativeAgentDownloadBtn');
            const extractBtn = document.getElementById('creativeAgentExtractBtn');
            if (downloadBtn) downloadBtn.disabled = true;
            if (extractBtn) extractBtn.disabled = true;
            renderCreativeAgentQuality(null);
            renderCreativeAgentPreview([]);
            setCreativeAgentTaskPanel(null);
            setCreativeAgentRunningState(false);
        }

        async function loadCreativeAgentResult(runId) {
            const data = await fetchJsonWithTimeout(
                `/api/creative-agent/result/${encodeURIComponent(runId)}`,
                { method: 'GET' },
                30000,
                '读取创意拓展Agent结果失败'
            );
            if (!data.success) {
                throw new Error(data.message || 'Agent结果不可用');
            }
            applyCreativeAgentResult(data);
            addLog(`✅ 创意拓展Agent生成完成：${data.fileName || ''}，提示词 ${Array.isArray(data.prompts) ? data.prompts.length : 0} 组`, 'success');
            showToast('Agent表格已生成');
        }

        async function checkCreativeAgentTaskStatus() {
            if (!creativeAgentCurrentRunId) return;
            try {
                const data = await fetchJsonWithTimeout(
                    `/api/creative-agent/task-status/${encodeURIComponent(creativeAgentCurrentRunId)}`,
                    { method: 'GET' },
                    15000,
                    '读取创意拓展Agent状态失败'
                );
                if (!data.success || !data.task) return;
                setCreativeAgentTaskPanel(data.task);

                if (data.task.phase === 'completed') {
                    const runId = creativeAgentCurrentRunId;
                    stopCreativeAgentPolling();
                    setCreativeAgentRunningState(false);
                    await loadCreativeAgentResult(runId);
                } else if (data.task.phase === 'failed' || data.task.phase === 'cancelled') {
                    stopCreativeAgentPolling();
                    setCreativeAgentRunningState(false);
                    const message = data.task.error || data.task.message || 'Agent运行失败';
                    setCreativeAgentInfo(data.task.phase === 'cancelled' ? 'info-box' : 'info-box error', data.task.phase === 'cancelled' ? '已取消创意拓展Agent任务' : '❌ ' + message);
                    if (data.task.phase === 'failed') {
                        showToast(message, 'error');
                    }
                }
            } catch (e) {
                setCreativeAgentInfo('info-box error', '❌ ' + (e.message || '读取Agent状态失败'));
                stopCreativeAgentPolling();
                setCreativeAgentRunningState(false);
            }
        }

        function startCreativeAgentStatusPolling(runId) {
            creativeAgentCurrentRunId = runId;
            stopCreativeAgentPolling();
            checkCreativeAgentTaskStatus();
            creativeAgentStatusInterval = setInterval(checkCreativeAgentTaskStatus, 2000);
        }

        async function runCreativeAgent() {
            const instruction = document.getElementById('creativeAgentInstruction')?.value.trim() || '';
            const apiKey = document.getElementById('creativeAgentApiKey')?.value.trim() || '';
            const apiUrl = document.getElementById('creativeAgentApiUrl')?.value.trim() || '';
            const model = document.getElementById('creativeAgentModel')?.value.trim() || '';
            const provider = document.getElementById('creativeAgentProvider')?.value.trim() || '';
            const targetCountValue = document.getElementById('creativeAgentTargetCount')?.value.trim() || '';
            const runBtn = document.getElementById('creativeAgentRunBtn');

            if (!instruction && creativeAgentFiles.length === 0) {
                showToast('请填写文字指令或添加参考资料', 'error');
                return;
            }

            resetCreativeAgentResult();
            setCreativeAgentRunningState(true);
            setCreativeAgentInfo('info-box loading', '正在读取资料并调用创意拓展Agent...');

            try {
                const attachments = await buildCreativeAgentAttachments();
                const data = await fetchJsonWithTimeout('/api/creative-agent/run', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        instruction,
                        apiKey,
                        apiUrl,
                        model,
                        provider,
                        targetCount: targetCountValue ? Number(targetCountValue) : null,
                        attachments
                    })
                }, 30000, '创意拓展Agent启动失败，请检查 Winky API 配置');

                if (!data.success) {
                    throw new Error(data.message || 'Agent启动失败');
                }

                if (data.runId) {
                    setCreativeAgentTaskPanel(data.task || { phase: 'queued', currentAction: data.message });
                    setCreativeAgentInfo('info-box loading', 'Agent任务已启动，正在后台生成表格...');
                    addLog(`创意拓展Agent任务已启动：${data.runId}`, 'system');
                    startCreativeAgentStatusPolling(data.runId);
                } else {
                    applyCreativeAgentResult(data);
                }
            } catch (e) {
                setCreativeAgentInfo('info-box error', '❌ ' + (e.message || 'Agent运行失败'));
                showToast(e.message || 'Agent运行失败', 'error');
                setCreativeAgentRunningState(false);
            }
        }

        async function cancelCreativeAgentRun() {
            if (!creativeAgentCurrentRunId) return;
            const cancelBtn = document.getElementById('creativeAgentCancelBtn');
            if (cancelBtn) {
                cancelBtn.disabled = true;
                cancelBtn.textContent = '取消中...';
            }
            try {
                const data = await fetchJsonWithTimeout(
                    `/api/creative-agent/cancel/${encodeURIComponent(creativeAgentCurrentRunId)}`,
                    { method: 'POST' },
                    15000,
                    '取消创意拓展Agent失败'
                );
                if (!data.success) {
                    throw new Error(data.message || '取消失败');
                }
                stopCreativeAgentPolling();
                setCreativeAgentTaskPanel(data.task || { phase: 'cancelled', currentAction: data.message });
                setCreativeAgentRunningState(false);
                setCreativeAgentInfo('info-box', '已取消创意拓展Agent任务');
                showToast('已取消Agent任务');
            } catch (e) {
                if (cancelBtn) {
                    cancelBtn.disabled = false;
                    cancelBtn.textContent = '取消运行';
                }
                showToast(e.message || '取消失败', 'error');
            }
        }

        function downloadCreativeAgentTable() {
            if (!creativeAgentLastResult?.downloadUrl) {
                showToast('还没有可下载的Agent表格', 'error');
                return;
            }
            window.location.href = creativeAgentLastResult.downloadUrl;
        }

        function applyCreativeAgentPromptsToCreativePage(options = {}) {
            const prompts = Array.isArray(creativeAgentLastResult?.prompts)
                ? creativeAgentLastResult.prompts
                : [];
            if (prompts.length === 0) {
                if (!options.silent) showToast('生成表格中没有可提取的提示词', 'error');
                return false;
            }

            config.creativePrompts = prompts.map((item, index) => ({
                ...item,
                index: index + 1,
                selected: item.selected !== false
            }));
            config.creativeTableFileName = creativeAgentLastResult.fileName || 'Agent生成表格.xlsx';
            renderCreativePromptPreview(config.creativePrompts);

            const infoBox = document.getElementById('creativeTableInfo');
            if (infoBox) {
                infoBox.className = 'info-box success';
                infoBox.textContent = `✅ 已从Agent生成表格提取 ${config.creativePrompts.length} 组提示词`;
            }
            addLog(`✅ 已提取Agent生成表格提示词：${config.creativePrompts.length} 组`, 'success');
            if (!options.silent) showToast(`已提取 ${config.creativePrompts.length} 组提示词`);
            return true;
        }

        function extractCreativeAgentPrompts() {
            applyCreativeAgentPromptsToCreativePage({ silent: false });
        }

        async function handleCreativeTableFileChange() {
            await parseCreativeTableFile();
        }

        function initCreativeTableDropzone() {
            const dropzone = document.getElementById('creativeTableDropzone');
            const fileInput = document.getElementById('creativeTableFile');
            if (!dropzone || !fileInput) return;

            const stopDefaults = (event) => {
                event.preventDefault();
                event.stopPropagation();
            };

            ['dragenter', 'dragover'].forEach(eventName => {
                dropzone.addEventListener(eventName, (event) => {
                    stopDefaults(event);
                    dropzone.classList.add('drag-over');
                });
            });

            dropzone.addEventListener('click', (event) => {
                if (event.target.closest('button, input, label')) return;
                fileInput.click();
            });

            ['dragleave', 'dragend'].forEach(eventName => {
                dropzone.addEventListener(eventName, (event) => {
                    stopDefaults(event);
                    if (!dropzone.contains(event.relatedTarget)) {
                        dropzone.classList.remove('drag-over');
                    }
                });
            });

            dropzone.addEventListener('drop', async (event) => {
                stopDefaults(event);
                dropzone.classList.remove('drag-over');

                const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
                if (!file) return;

                const ext = file.name.split('.').pop().toLowerCase();
                if (!['xlsx', 'xls', 'csv'].includes(ext)) {
                    showToast('请拖入 xlsx / xls / csv 表格文件', 'error');
                    return;
                }

                try {
                    const transfer = new DataTransfer();
                    transfer.items.add(file);
                    fileInput.files = transfer.files;
                } catch (e) {}

                await parseCreativeTableFile(file);
            });
        }

        async function parseCreativeTableFile(explicitFile = null) {
            const fileInput = document.getElementById('creativeTableFile');
            const infoBox = document.getElementById('creativeTableInfo');
            const fileInfo = document.getElementById('creativeTableFileInfo');
            const file = explicitFile || (fileInput && fileInput.files && fileInput.files[0]);

            if (!file) {
                showToast('请先选择表格文件', 'error');
                return false;
            }

            if (infoBox) {
                infoBox.className = 'info-box loading';
                infoBox.textContent = '正在解析表格...';
            }
            if (fileInfo) {
                fileInfo.textContent = `${file.name} / ${(file.size / 1024).toFixed(1)} KB`;
            }

            try {
                const fileContentBase64 = await readFileAsBase64(file);
                const data = await fetchJsonWithTimeout('/api/creative/parse-table', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        fileName: file.name,
                        fileContentBase64
                    })
                }, 60000, '解析表格失败，请检查文件格式');

                if (!data.success) {
                    throw new Error(data.message || '解析失败');
                }

                config.creativePrompts = Array.isArray(data.prompts)
                    ? data.prompts.map((item, index) => ({
                        ...item,
                        index: index + 1,
                        selected: item.selected !== false
                    }))
                    : [];
                config.creativeTableFileName = data.fileName || file.name;
                renderCreativePromptPreview(config.creativePrompts);

                if (infoBox) {
                    const qualityErrors = Array.isArray(data.qualityReport?.errors) ? data.qualityReport.errors.length : 0;
                    const qualityWarnings = Array.isArray(data.qualityReport?.warnings) ? data.qualityReport.warnings.length : 0;
                    const qualityNote = qualityErrors > 0
                        ? `，质检发现 ${qualityErrors} 个严重问题`
                        : (qualityWarnings > 0 ? `，质检提醒 ${qualityWarnings} 条` : '');
                    infoBox.className = 'info-box success';
                    infoBox.textContent = `✅ 已从 ${config.creativeTableFileName} / ${data.sheetName || '首个工作表'} 提取 ${config.creativePrompts.length} 组提示词${qualityNote}`;
                }
                addLog(`✅ 创意拓展表格解析完成：${config.creativePrompts.length} 组提示词`, 'success');
                showToast(`已提取 ${config.creativePrompts.length} 组提示词`);
                return true;
            } catch (e) {
                config.creativePrompts = [];
                renderCreativePromptPreview([]);
                if (infoBox) {
                    infoBox.className = 'info-box error';
                    infoBox.textContent = '❌ ' + e.message;
                }
                showToast(e.message || '解析表格失败', 'error');
                return false;
            }
        }
