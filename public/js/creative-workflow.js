// 创意拓展批量生成流程：启动、停止、续跑和展示创意任务进度。
        function prepareCreativeStoppedActions(progress) {
            const remainingIndexes = getCreativeRemainingRunIndexes(progress);
            const startBtn = document.getElementById('creativeStartBtn');
            const infoBox = document.getElementById('creativeBatchInfo');
            const hasPrompts = Array.isArray(config.creativePrompts) && config.creativePrompts.length > 0;

            creativeResumeIndexes = remainingIndexes;
            setCreativeStoppedActionsVisible(hasPrompts, remainingIndexes.length);

            if (remainingIndexes.length > 0) {
                selectCreativePromptsByIndexes(remainingIndexes);
                if (startBtn) {
                    startBtn.disabled = true;
                    startBtn.textContent = '请选择继续任务或新任务';
                }
                if (infoBox) {
                    infoBox.className = 'info-box success';
                    infoBox.textContent = `⏹️ 创意拓展已停止，可点击“继续任务”处理剩余 ${remainingIndexes.length} 组，或点击“新任务”重新开始。`;
                }
                return;
            }

            if (startBtn) {
                startBtn.disabled = hasPrompts;
                startBtn.textContent = hasPrompts ? '请选择新任务' : '开始创意拓展';
            }
            if (infoBox) {
                infoBox.className = 'info-box success';
                infoBox.textContent = '⏹️ 创意拓展已停止，可以点击“新任务”重新开始。';
            }
        }

        async function resumeCreativeStoppedTask() {
            if (creativeResumeIndexes.length === 0) {
                await refreshCreativeResumeControls();
                if (creativeResumeIndexes.length === 0) {
                    showToast('没有可继续的剩余任务', 'error');
                    return;
                }
            }

            selectCreativePromptsByIndexes(creativeResumeIndexes);
            await startCreativeBatchWithConfirm({
                resumeMode: true,
                resumeRunId: creativeResumeInfo?.runId || ''
            });
        }

        async function startCreativeNewTask() {
            if (!Array.isArray(config.creativePrompts) || config.creativePrompts.length === 0) {
                showToast('请先上传表格并提取提示词', 'error');
                return;
            }

            setAllCreativePromptsSelected(true);
            creativeLastRunIndexes = [];
            creativeResumeIndexes = [];
            await clearCreativeResumeOnServer();

            const startBtn = document.getElementById('creativeStartBtn');
            if (startBtn) {
                startBtn.disabled = false;
                startBtn.textContent = '开始创意拓展';
            }

            await startCreativeBatchWithConfirm({
                resumeMode: false
            });
        }

        async function startCreativeBatchWithConfirm(options = {}) {
            const browserModeLabel = getCreativeBrowserModeLabel(config.creativeBrowserMode);
            const browserModeNote = config.creativeBrowserMode === 'headless'
                ? '使用已保存的登录状态后台运行'
                : '会显示浏览器窗口';
            const confirmed = confirm(
                '请确认以下事项：\n\n' +
                `✅ 运行模式：${browserModeLabel}（${browserModeNote}）\n` +
                '✅ 已在 Legil 登录账号\n' +
                '✅ 已上传并解析表格提示词\n' +
                '✅ 创意拓展输出文件夹路径正确\n' +
                '✅ Legil生成参数已确认\n\n' +
                '点击"确定"开始创意拓展批量生成。'
            );
            if (!confirmed) return;

            await startCreativeBatch(options);
        }

        async function startCreativeBatch(options = {}) {
            const outputFolder = document.getElementById('creativeOutputFolder')?.value.trim();
            const referenceFolder = document.getElementById('creativeReferenceFolder')?.value.trim() || '';
            const infoBox = document.getElementById('creativeBatchInfo');
            const startBtn = document.getElementById('creativeStartBtn');
            const stopBtn = document.getElementById('creativeStopBtn');

            if (!outputFolder) return showToast('请输入创意拓展输出文件夹路径', 'error');
            if (!Array.isArray(config.creativePrompts) || config.creativePrompts.length === 0) {
                return showToast('请先上传表格并提取提示词', 'error');
            }
            const selectedPrompts = getSelectedCreativePrompts();
            if (selectedPrompts.length === 0) {
                return showToast('请至少勾选一组要生成的提示词', 'error');
            }
            creativeLastRunIndexes = selectedPrompts.map((item, index) => getCreativePromptIndex(item, index));
            creativeResumeIndexes = [];
            setCreativeStoppedActionsVisible(false);

            addFolderHistory('creativeOutputFolder', outputFolder);
            if (referenceFolder) addFolderHistory('creativeReferenceFolder', referenceFolder);

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
                infoBox.textContent = '正在启动 Legil 创意拓展任务...';
            }

            try {
                const configSaved = await saveCreativeConfig({ silent: true });
                if (!configSaved) {
                    throw new Error('创意拓展配置保存失败');
                }

                const data = await fetchJsonWithTimeout('/api/legil/creative-batch', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        outputFolder,
                        referenceFolder,
                        prompts: selectedPrompts,
                        tableFileName: config.creativeTableFileName || '',
                        browserMode: config.creativeBrowserMode,
                        generationSettings: config.creativeLegilGeneration,
                        resumeMode: options.resumeMode === true,
                        resumeRunId: options.resumeRunId || ''
                    })
                }, 30000, '启动创意拓展失败，请重启服务器后刷新页面');

                if (!data.success) {
                    throw new Error(data.message || '启动失败');
                }

                creativeResumeInfo = null;
                document.getElementById('creativeProgressPanel')?.classList.add('active');
                updateCreativeProgress(data.progress || {
                    taskType: 'creative-batch',
                    phase: 'queued',
                    total: data.totalPrompts || selectedPrompts.length,
                    currentIndex: 0,
                    completed: 0,
                    success: 0,
                    failed: 0,
                    saved: 0,
                    currentAction: '创意拓展任务已启动，等待 Legil 开始生成...'
                });

                if (infoBox) {
                    infoBox.className = 'info-box success';
                    infoBox.textContent = `✅ 已启动：${data.totalPrompts || 0} 组提示词`;
                }
                addLog(`✅ Legil创意拓展已启动：${data.totalPrompts || selectedPrompts.length} 组提示词`, 'success');
                showToast('创意拓展任务已启动');
                if (stopBtn) {
                    stopBtn.disabled = false;
                    stopBtn.textContent = '停止工作流';
                }
                startCreativeStatusPolling();
            } catch (e) {
                if (infoBox) {
                    infoBox.className = 'info-box error';
                    infoBox.textContent = '❌ ' + e.message;
                }
                showToast(e.message || '启动创意拓展失败', 'error');
                resetCreativeUI();
            }
        }

        async function stopCreativeBatch() {
            const stopBtn = document.getElementById('creativeStopBtn');
            const infoBox = document.getElementById('creativeBatchInfo');

            if (stopBtn) {
                stopBtn.disabled = true;
                stopBtn.textContent = '停止中...';
            }
            if (infoBox) {
                infoBox.className = 'info-box loading';
                infoBox.textContent = '正在停止创意拓展任务...';
            }

            addLog('正在停止创意拓展任务...', 'system');

            try {
                const res = await fetch('/api/legil/stop', { method: 'POST' });
                const data = await readJsonResponse(res, '停止创意拓展任务失败，请重启服务器后刷新页面');
                if (!data.success) {
                    throw new Error(data.message || '停止失败');
                }

                showToast('已发送停止指令');
                addLog('⏹️ 已发送停止创意拓展任务指令', 'system');
                if (infoBox) {
                    infoBox.className = 'info-box loading';
                    infoBox.textContent = '已发送停止指令，当前步骤结束后可继续剩余任务或开启新任务。';
                }
                startCreativeStatusPolling();
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

        function startCreativeStatusPolling() {
            if (creativeStatusInterval) {
                clearInterval(creativeStatusInterval);
                creativeStatusInterval = null;
            }
            checkCreativeTaskStatus();
            creativeStatusInterval = setInterval(checkCreativeTaskStatus, 3000);
        }

        function updateCreativeProgress(progress) {
            if (!progress || progress.taskType !== 'creative-batch') return;

            const panel = document.getElementById('creativeProgressPanel');
            const total = Math.max(0, Number(progress.total) || 0);
            const currentIndex = Math.max(0, Number(progress.currentIndex) || 0);
            const completed = Math.max(0, Number(progress.completed) || 0);
            const success = Math.max(0, Number(progress.success) || 0);
            const failed = Math.max(0, Number(progress.failed) || 0);
            const saved = Math.max(0, Number(progress.saved) || 0);
            const phase = String(progress.phase || '');
            const displayIndex = phase === 'completed' ? total : Math.min(total, Math.max(currentIndex, completed));
            const progressBase = phase === 'completed' ? total : completed;
            const pct = total > 0 ? Math.max(0, Math.min(100, Math.round((progressBase / total) * 100))) : 0;

            if (panel) panel.classList.add('active');

            const progressText = document.getElementById('creativeProgressText');
            if (progressText) progressText.textContent = `${displayIndex} / ${total}`;

            const progressBar = document.getElementById('creativeProgressBar');
            if (progressBar) {
                progressBar.style.width = `${pct}%`;
                progressBar.classList.toggle('success', phase === 'completed');
            }

            const statusText = document.getElementById('creativeCurrentStatusText');
            if (statusText) {
                statusText.textContent = progress.currentAction || progress.currentName || '创意拓展任务运行中...';
            }

            const successEl = document.getElementById('creativeStatsSuccess');
            const failedEl = document.getElementById('creativeStatsFailed');
            const savedEl = document.getElementById('creativeStatsSaved');
            const totalEl = document.getElementById('creativeStatsSelected');
            if (successEl) successEl.textContent = success;
            if (failedEl) failedEl.textContent = failed;
            if (savedEl) savedEl.textContent = saved;
            if (totalEl) totalEl.textContent = total;
        }

        async function checkCreativeTaskStatus() {
            try {
                const res = await fetch('/api/legil/task-status');
                const data = await readJsonResponse(res, '读取创意拓展任务状态失败');
                if (!data.success) return;
                if (data.progress && data.progress.taskType === 'creative-batch') {
                    updateCreativeProgress(data.progress);
                }

                if (!data.running) {
                    if (creativeStatusInterval) {
                        clearInterval(creativeStatusInterval);
                        creativeStatusInterval = null;
                    }
                    resetCreativeUI();
                    if (
                        data.progress &&
                        data.progress.taskType === 'creative-batch' &&
                        String(data.progress.phase || '') === 'stopped'
                    ) {
                        prepareCreativeStoppedActions(data.progress);
                    } else {
                        refreshCreativeResumeControls();
                    }
                } else {
                    const startBtn = document.getElementById('creativeStartBtn');
                    if (startBtn) {
                        startBtn.disabled = true;
                        startBtn.textContent = data.stopRequested === true ? '等待停止完成...' : '运行中...';
                    }
                    setCreativeStoppedActionsVisible(false);
                    const stopBtn = document.getElementById('creativeStopBtn');
                    if (stopBtn) {
                        const isCreativeTask = data.taskType === 'creative-batch';
                        stopBtn.disabled = !isCreativeTask || data.stopRequested === true;
                        stopBtn.textContent = data.stopRequested === true ? '停止中...' : '停止工作流';
                    }
                }
            } catch (e) {}
        }

        function resetCreativeUI() {
            const startBtn = document.getElementById('creativeStartBtn');
            const stopBtn = document.getElementById('creativeStopBtn');
            if (startBtn) {
                startBtn.disabled = false;
                startBtn.textContent = '开始创意拓展';
            }
            setCreativeStoppedActionsVisible(false);
            if (stopBtn) {
                stopBtn.disabled = true;
                stopBtn.textContent = '停止工作流';
            }
        }

        // Workflow
