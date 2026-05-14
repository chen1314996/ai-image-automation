// 批量改尺寸流程：确认参数、启动任务、更新改尺寸进度。
        async function startResizeBatchWithConfirm() {
            const browserModeLabel = getBrowserModeLabel(config.resizeBrowserMode);
            const browserModeNote = getBrowserModeNote(config.resizeBrowserMode);
            const confirmed = confirm(
                '请确认以下事项：\n\n' +
                '✅ 已在浏览器中登录 Legil 账号\n' +
                '✅ 改尺寸输入文件夹路径正确\n' +
                '✅ 改尺寸输出文件夹路径正确\n' +
                '✅ 固定提示词内容已确认\n' +
                `✅ 运行模式：${browserModeLabel}（${browserModeNote}）\n\n` +
                '点击"确定"开始批量改尺寸。'
            );
            if (!confirmed) return;

            await startResizeBatch();
        }

        async function startResizeBatch() {
            const inputFolder = document.getElementById('resizeInputFolder')?.value.trim();
            const outputFolder = document.getElementById('resizeOutputFolder')?.value.trim();
            const promptTemplate = document.getElementById('resizePromptTemplate')?.value.trim();
            const infoBox = document.getElementById('resizeBatchInfo');
            const startBtn = document.getElementById('resizeStartBtn');
            const stopBtn = document.getElementById('resizeStopBtn');

            if (!inputFolder) return showToast('请输入改尺寸输入文件夹路径', 'error');
            if (!outputFolder) return showToast('请输入改尺寸输出文件夹路径', 'error');
            if (!promptTemplate) return showToast('请输入发送给 Legil 的固定文字提示词', 'error');

            addFolderHistory('resizeInputFolder', inputFolder);
            addFolderHistory('resizeOutputFolder', outputFolder);

            if (startBtn) {
                startBtn.disabled = true;
                startBtn.textContent = '运行中...';
            }
            if (stopBtn) {
                stopBtn.disabled = true;
                stopBtn.textContent = '停止工作流';
            }
            if (infoBox) {
                infoBox.className = 'info-box loading';
                infoBox.textContent = '正在启动 Legil 批量改尺寸任务...';
            }

            try {
                const configSaved = await saveResizeConfig({ silent: true });
                if (!configSaved) {
                    throw new Error('改尺寸配置保存失败');
                }

                const res = await fetch('/api/legil/resize-batch', {
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
                const data = await readJsonResponse(res, '启动改尺寸失败，请重启服务器后刷新页面');

                if (!data.success) {
                    throw new Error(data.message || '启动失败');
                }

                if (infoBox) {
                    infoBox.className = 'info-box success';
                    infoBox.textContent = `✅ 已启动：${data.totalImages || 0} 张输入图`;
                }
                document.getElementById('resizeProgressPanel')?.classList.add('active');
                updateResizeProgress(data.progress || {
                    taskType: 'resize-batch',
                    phase: 'queued',
                    total: data.totalImages || 0,
                    currentIndex: 0,
                    completed: 0,
                    success: 0,
                    failed: 0,
                    saved: 0,
                    currentAction: '改尺寸任务已启动，等待 Legil 开始处理...'
                });
                addLog(`✅ Legil批量改尺寸已启动：${data.totalImages || 0} 张输入图`, 'success');
                showToast('改尺寸任务已启动');
                if (stopBtn) {
                    stopBtn.disabled = false;
                    stopBtn.textContent = '停止工作流';
                }
                startResizeStatusPolling();
            } catch (e) {
                if (infoBox) {
                    infoBox.className = 'info-box error';
                    infoBox.textContent = '❌ ' + e.message;
                }
                showToast(e.message || '启动改尺寸失败', 'error');
                resetResizeUI();
            }
        }

        async function stopResizeBatch() {
            const stopBtn = document.getElementById('resizeStopBtn');
            const infoBox = document.getElementById('resizeBatchInfo');

            if (stopBtn) {
                stopBtn.disabled = true;
                stopBtn.textContent = '停止中...';
            }
            if (infoBox) {
                infoBox.className = 'info-box loading';
                infoBox.textContent = '正在停止改尺寸任务...';
            }

            addLog('正在停止改尺寸任务...', 'system');

            try {
                const res = await fetch('/api/legil/stop', { method: 'POST' });
                const data = await readJsonResponse(res, '停止改尺寸任务失败，请重启服务器后刷新页面');
                if (!data.success) {
                    throw new Error(data.message || '停止失败');
                }

                showToast('已发送停止指令');
                addLog('⏹️ 已发送停止改尺寸任务指令', 'system');
                startResizeStatusPolling();
            } catch (e) {
                if (infoBox) {
                    infoBox.className = 'info-box error';
                    infoBox.textContent = '❌ ' + e.message;
                }
                if (stopBtn) {
                    stopBtn.disabled = false;
                    stopBtn.textContent = '停止工作流';
                }
                showToast(e.message || '停止失败', 'error');
            }
        }

        function startResizeStatusPolling() {
            if (resizeStatusInterval) {
                clearInterval(resizeStatusInterval);
                resizeStatusInterval = null;
            }
            checkResizeTaskStatus();
            resizeStatusInterval = setInterval(checkResizeTaskStatus, 3000);
        }

        function updateResizeProgress(progress) {
            if (!progress || progress.taskType !== 'resize-batch') return;

            const panel = document.getElementById('resizeProgressPanel');
            const total = Math.max(0, Number(progress.total) || 0);
            const currentIndex = Math.max(0, Number(progress.currentIndex) || 0);
            const completed = Math.max(0, Number(progress.completed) || 0);
            const success = Math.max(0, Number(progress.success) || 0);
            const failed = Math.max(0, Number(progress.failed) || 0);
            const saved = Math.max(0, Number(progress.saved) || 0);
            const progressValue = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;

            if (panel) panel.classList.add('active');
            const textEl = document.getElementById('resizeProgressText');
            const barEl = document.getElementById('resizeProgressBar');
            const statusEl = document.getElementById('resizeCurrentStatusText');
            const successEl = document.getElementById('resizeStatsSuccess');
            const failedEl = document.getElementById('resizeStatsFailed');
            const savedEl = document.getElementById('resizeStatsSaved');
            const totalEl = document.getElementById('resizeStatsTotal');

            if (textEl) textEl.textContent = `${Math.min(currentIndex || completed, total)} / ${total}`;
            if (barEl) barEl.style.width = `${progressValue}%`;
            if (statusEl) statusEl.textContent = progress.currentAction || '改尺寸任务处理中...';
            if (successEl) successEl.textContent = success;
            if (failedEl) failedEl.textContent = failed;
            if (savedEl) savedEl.textContent = saved;
            if (totalEl) totalEl.textContent = total;
        }

        async function checkResizeTaskStatus() {
            try {
                const res = await fetch('/api/legil/task-status');
                const data = await readJsonResponse(res, '读取改尺寸任务状态失败');
                if (!data.success) return;
                if (data.progress && data.progress.taskType === 'resize-batch') {
                    updateResizeProgress(data.progress);
                }

                if (!data.running) {
                    if (resizeStatusInterval) {
                        clearInterval(resizeStatusInterval);
                        resizeStatusInterval = null;
                    }
                    resetResizeUI();
                } else {
                    const stopBtn = document.getElementById('resizeStopBtn');
                    if (stopBtn) {
                        const isResizeTask = data.taskType === 'resize-batch';
                        stopBtn.disabled = !isResizeTask || data.stopRequested === true;
                        stopBtn.textContent = data.stopRequested === true ? '停止中...' : '停止工作流';
                    }
                }
            } catch (e) {}
        }

        function resetResizeUI() {
            const startBtn = document.getElementById('resizeStartBtn');
            const stopBtn = document.getElementById('resizeStopBtn');
            if (startBtn) {
                startBtn.disabled = false;
                startBtn.textContent = '开始改尺寸';
            }
            if (stopBtn) {
                stopBtn.disabled = true;
                stopBtn.textContent = '停止工作流';
            }
        }
