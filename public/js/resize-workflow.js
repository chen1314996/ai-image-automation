// 批量改尺寸流程：按当前选择的平台确认参数、启动任务、停止任务并刷新进度。
        let resizeActiveProvider = null;

        function getResizeWorkflowProvider() {
            return typeof normalizeResizeProvider === 'function'
                ? normalizeResizeProvider(config.resizeProvider)
                : (config.resizeProvider === 'legil' ? 'legil' : 'jimeng');
        }

        function getResizeWorkflowProviderLabel(provider = getResizeWorkflowProvider()) {
            return typeof getResizeProviderLabel === 'function'
                ? getResizeProviderLabel(provider)
                : (provider === 'legil' ? 'Legil' : '即梦 AI');
        }

        function getResizeWorkflowTaskType(provider = getResizeWorkflowProvider()) {
            return provider === 'legil' ? 'resize-batch' : 'jimeng-resize-batch';
        }

        function getResizeWorkflowStatusEndpoint(provider = getResizeWorkflowProvider()) {
            return provider === 'legil' ? '/api/legil/task-status' : '/api/jimeng/task-status';
        }

        function getResizeWorkflowStopEndpoint(provider = getResizeWorkflowProvider()) {
            return provider === 'legil' ? '/api/legil/stop' : '/api/jimeng/stop';
        }

        function getResizeWorkflowStartEndpoint(provider = getResizeWorkflowProvider()) {
            return provider === 'legil' ? '/api/legil/resize-batch' : '/api/jimeng/resize-batch';
        }

        function getResizeWorkflowGenerationSettings(provider = getResizeWorkflowProvider()) {
            if (provider === 'legil') {
                return {
                    ...config.resizeLegilGeneration,
                    outputQuantity: Number(config.resizeLegilGeneration.outputQuantity) || 1
                };
            }

            return {
                ...config.resizeJimengGeneration,
                outputQuantity: 4,
                concurrency: 1
            };
        }

        async function startResizeBatchWithConfirm() {
            const provider = getResizeWorkflowProvider();
            const providerLabel = getResizeWorkflowProviderLabel(provider);
            const platformLoginLine = provider === 'legil'
                ? '✅ 已在 Legil 自动化浏览器中完成登录\n'
                : '✅ 已在即梦自动化浏览器中完成登录\n';
            const runLine = provider === 'legil'
                ? `✅ Legil 会按输入图顺序改尺寸；每张输入图按当前设置生成 ${Number(config.resizeLegilGeneration.outputQuantity) || 1} 张结果\n`
                : '✅ 即梦会单页顺序生成；每张输入图完成并保存4张结果后再处理下一张\n';
            const stopLine = provider === 'legil'
                ? '✅ 停止任务会停止本地 Legil 改尺寸队列，正在执行的浏览器动作可能需要等待当前步骤结束\n\n'
                : '✅ 停止任务只会停止本地队列，已提交到即梦云端的任务可能仍会继续生成\n\n';
            const confirmed = confirm(
                '请确认以下事项：\n\n' +
                `✅ 当前改尺寸平台：${providerLabel}\n` +
                platformLoginLine +
                '✅ 改尺寸输入文件夹路径正确\n' +
                '✅ 改尺寸输出文件夹路径正确\n' +
                '✅ 固定提示词内容已确认\n' +
                `✅ 运行模式：${getBrowserModeLabel(config.resizeBrowserMode)}\n` +
                runLine +
                stopLine +
                '点击"确定"开始批量改尺寸。'
            );
            if (!confirmed) return;

            await startResizeBatch();
        }

        async function startResizeBatch() {
            const provider = getResizeWorkflowProvider();
            const providerLabel = getResizeWorkflowProviderLabel(provider);
            const taskType = getResizeWorkflowTaskType(provider);
            const inputFolder = document.getElementById('resizeInputFolder')?.value.trim();
            const outputFolder = document.getElementById('resizeOutputFolder')?.value.trim();
            const promptTemplate = document.getElementById('resizePromptTemplate')?.value.trim();
            const infoBox = document.getElementById('resizeBatchInfo');
            const startBtn = document.getElementById('resizeStartBtn');
            const stopBtn = document.getElementById('resizeStopBtn');

            if (!inputFolder) return showToast('请输入改尺寸输入文件夹路径', 'error');
            if (!outputFolder) return showToast('请输入改尺寸输出文件夹路径', 'error');
            if (!promptTemplate) return showToast(`请输入发送给${providerLabel}的固定文字提示词`, 'error');

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
                infoBox.textContent = `正在启动${providerLabel}批量改尺寸任务...`;
            }

            try {
                const configSaved = await saveResizeConfig({ silent: true });
                if (!configSaved) {
                    throw new Error('改尺寸配置保存失败');
                }

                const res = await fetch(getResizeWorkflowStartEndpoint(provider), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        inputFolder,
                        outputFolder,
                        browserMode: config.resizeBrowserMode,
                        promptTemplate,
                        generationSettings: getResizeWorkflowGenerationSettings(provider)
                    })
                });
                const data = await readJsonResponse(res, '启动改尺寸失败，请重启服务器后刷新页面');

                if (!data.success) {
                    throw new Error(data.message || '启动失败');
                }

                resizeActiveProvider = provider;
                if (infoBox) {
                    infoBox.className = 'info-box success';
                    infoBox.textContent = `✅ 已启动${providerLabel}改尺寸：${data.totalImages || 0} 张输入图`;
                }
                document.getElementById('resizeProgressPanel')?.classList.add('active');
                updateResizeProgress(data.progress || {
                    taskType,
                    phase: 'queued',
                    total: data.totalImages || 0,
                    currentIndex: 0,
                    completed: 0,
                    success: 0,
                    failed: 0,
                    saved: 0,
                    currentAction: `${providerLabel}改尺寸任务已启动，等待网页自动化开始处理...`
                });
                addLog(`✅ ${providerLabel}批量改尺寸已启动：${data.totalImages || 0} 张输入图`, 'success');
                showToast('改尺寸任务已启动');
                if (stopBtn) {
                    stopBtn.disabled = false;
                    stopBtn.textContent = '停止工作流';
                }
                startResizeStatusPolling(provider);
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
            const provider = resizeActiveProvider || getResizeWorkflowProvider();
            const providerLabel = getResizeWorkflowProviderLabel(provider);
            const stopBtn = document.getElementById('resizeStopBtn');
            const infoBox = document.getElementById('resizeBatchInfo');

            if (stopBtn) {
                stopBtn.disabled = true;
                stopBtn.textContent = '停止中...';
            }
            if (infoBox) {
                infoBox.className = 'info-box loading';
                infoBox.textContent = `正在停止${providerLabel}改尺寸任务...`;
            }

            addLog(`正在停止${providerLabel}改尺寸任务...`, 'system');

            try {
                const res = await fetch(getResizeWorkflowStopEndpoint(provider), { method: 'POST' });
                const data = await readJsonResponse(res, '停止改尺寸任务失败，请重启服务器后刷新页面');
                if (!data.success) {
                    throw new Error(data.message || '停止失败');
                }

                showToast('已发送停止指令');
                addLog(`⏹️ 已发送${providerLabel}改尺寸任务停止指令`, 'system');
                startResizeStatusPolling(provider);
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

        function startResizeStatusPolling(provider = resizeActiveProvider || getResizeWorkflowProvider()) {
            resizeActiveProvider = provider;
            if (resizeStatusInterval) {
                clearInterval(resizeStatusInterval);
                resizeStatusInterval = null;
            }
            checkResizeTaskStatus(provider);
            resizeStatusInterval = setInterval(() => checkResizeTaskStatus(provider), 3000);
        }

        function updateResizeProgress(progress) {
            if (!progress || !['jimeng-resize-batch', 'resize-batch'].includes(progress.taskType)) return;

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
            const providerLabel = progress.taskType === 'resize-batch' ? 'Legil' : '即梦';

            if (textEl) textEl.textContent = `${Math.min(currentIndex || completed, total)} / ${total}`;
            if (barEl) barEl.style.width = `${progressValue}%`;
            if (statusEl) statusEl.textContent = progress.currentAction || `${providerLabel}改尺寸任务处理中...`;
            if (successEl) successEl.textContent = success;
            if (failedEl) failedEl.textContent = failed;
            if (savedEl) savedEl.textContent = saved;
            if (totalEl) totalEl.textContent = total;
        }

        async function checkResizeTaskStatus(provider = resizeActiveProvider || getResizeWorkflowProvider()) {
            const taskType = getResizeWorkflowTaskType(provider);
            try {
                const res = await fetch(getResizeWorkflowStatusEndpoint(provider));
                const data = await readJsonResponse(res, '读取改尺寸任务状态失败');
                if (!data.success) return;
                if (data.progress && data.progress.taskType === taskType) {
                    updateResizeProgress(data.progress);
                }

                if (!data.running) {
                    if (resizeStatusInterval) {
                        clearInterval(resizeStatusInterval);
                        resizeStatusInterval = null;
                    }
                    resizeActiveProvider = null;
                    resetResizeUI();
                } else {
                    const stopBtn = document.getElementById('resizeStopBtn');
                    if (stopBtn) {
                        const isResizeTask = data.taskType === taskType;
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
