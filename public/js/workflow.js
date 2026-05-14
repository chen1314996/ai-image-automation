// 批量产图完整工作流：启动、停止、续跑和展示整体进度。
        async function startWorkflowWithConfirm() {
            const browserModeLabel = getBrowserModeLabel(config.workflowBrowserMode);
            const browserModeNote = getBrowserModeNote(config.workflowBrowserMode);
            const confirmed = confirm(
                '请确认以下事项：\n\n' +
                '✅ 已配置火山方舟 API Key 和模型 ID\n' +
                '✅ 已在浏览器中登录Legil账号\n' +
                '✅ 参考图文件夹路径正确\n' +
                '✅ 输出文件夹路径正确\n' +
                `✅ 运行模式：${browserModeLabel}（${browserModeNote}）\n\n` +
                '点击"确定"开始自动化流程。'
            );
            if (!confirmed) return;

            await startWorkflow();
        }

        async function refreshWorkflowResumeControls() {
            const actions = document.getElementById('workflowResumeActions');
            const resumeBtn = document.getElementById('resumeWorkflowBtn');
            if (!actions || !resumeBtn) return;

            try {
                const res = await fetch('/api/workflow/resume-info');
                const data = await res.json();
                workflowResumeInfo = data.success && data.resume && data.resume.hasResume ? data.resume : null;
            } catch (e) {
                workflowResumeInfo = null;
            }

            if (workflowResumeInfo) {
                actions.classList.add('active');
                resumeBtn.textContent = `↩️ 继续：第 ${workflowResumeInfo.imageIndex}/${workflowResumeInfo.totalImages} 张，提示词 ${workflowResumeInfo.promptIndex}/${workflowResumeInfo.totalPrompts}`;
            } else {
                actions.classList.remove('active');
                resumeBtn.textContent = '↩️ 继续之前任务';
            }
        }

        async function resumeWorkflowFromStop() {
            if (!workflowResumeInfo) {
                await refreshWorkflowResumeControls();
            }

            if (!workflowResumeInfo) {
                showToast('没有可继续的上次任务', 'error');
                return;
            }

            const confirmed = confirm(
                `继续上次停止的任务？\n\n` +
                `参考图：${workflowResumeInfo.imageIndex}/${workflowResumeInfo.totalImages} ${workflowResumeInfo.imageName || ''}\n` +
                `提示词：${workflowResumeInfo.promptIndex}/${workflowResumeInfo.totalPrompts}\n\n` +
                `点击"确定"后会从该位置继续。`
            );
            if (!confirmed) return;

            const resumeBtn = document.getElementById('resumeWorkflowBtn');
            if (resumeBtn) {
                resumeBtn.disabled = true;
                resumeBtn.textContent = '⏳ 正在继续...';
            }

            document.getElementById('oneClickStartBtn').disabled = true;
            document.getElementById('oneClickStartBtn').textContent = '⏳ 运行中...';
            document.getElementById('progressPanel').classList.add('active');
            addLog('↩️ 正在继续上次停止的工作流...', 'system');

            try {
                const res = await fetch('/api/workflow/resume', { method: 'POST' });
                const data = await res.json();
                if (data.success) {
                    showToast('已继续上次任务');
                    workflowResumeInfo = null;
                    await refreshWorkflowResumeControls();
                    startProgressPolling();
                } else {
                    showToast(data.message || '继续任务失败', 'error');
                    resetUI();
                    await refreshWorkflowResumeControls();
                }
            } catch (e) {
                showToast('继续任务失败', 'error');
                resetUI();
                await refreshWorkflowResumeControls();
            } finally {
                if (resumeBtn) resumeBtn.disabled = false;
            }
        }

        async function startNewWorkflowFromStop() {
            const confirmed = confirm('确定开启新任务？这会清除“继续之前任务”的记录。');
            if (!confirmed) return;

            try {
                await fetch('/api/workflow/clear-resume', { method: 'POST' });
            } catch (e) {}
            workflowResumeInfo = null;
            await refreshWorkflowResumeControls();
            await startWorkflowWithConfirm();
        }

        async function startWorkflow() {
            const inputFolder = document.getElementById('referenceFolder').value.trim();
            const outputFolder = document.getElementById('saveFolder').value.trim();
            const legilRefFolder = document.getElementById('legilReferenceFolder').value.trim();

            if (!inputFolder) return showToast('请输入参考图文件夹路径', 'error');
            addFolderHistory('referenceFolder', inputFolder);
            if (outputFolder) addFolderHistory('saveFolder', outputFolder);
            if (legilRefFolder) addFolderHistory('legilReferenceFolder', legilRefFolder);

            document.getElementById('oneClickStartBtn').disabled = true;
            document.getElementById('oneClickStartBtn').textContent = '⏳ 运行中...';
            document.getElementById('progressPanel').classList.add('active');

            addLog('🚀 启动工作流...', 'system');

            try {
                addLog('正在保存豆包API配置...', 'system');
                const configSaved = await saveDoubaoConfig({ silent: true });
                if (!configSaved) {
                    showToast('请先检查豆包配置', 'error');
                    addLog('❌ 启动失败：豆包API配置保存失败', 'error');
                    resetUI();
                    return;
                }
                addLog('正在保存Legil生成参数...', 'system');
                const legilConfigSaved = await saveLegilGenerationConfig({ silent: true });
                if (!legilConfigSaved) {
                    showToast('请先检查Legil生成参数', 'error');
                    addLog('❌ 启动失败：Legil生成参数保存失败', 'error');
                    resetUI();
                    return;
                }

                await saveWorkflowConfig({ silent: true });
                addLog('正在提交工作流启动请求...', 'system');
                const data = await fetchJsonWithTimeout('/api/workflow/start', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        inputFolder,
                        outputFolder,
                        legilReferenceFolder: legilRefFolder,
                        browserMode: config.workflowBrowserMode,
                        generationSettings: config.legilGeneration
                    })
                }, 30000, '启动工作流失败，请重启服务器后刷新页面');
                if (data.success) {
                    addLog(`✅ 工作流已提交：将处理 ${data.totalImages || 0} 张参考图`, 'success');
                    showToast('工作流已启动');
                    workflowResumeInfo = null;
                    await refreshWorkflowResumeControls();
                    startProgressPolling();
                } else {
                    showToast(data.message, 'error');
                    addLog(`❌ 启动失败：${data.message || '未知错误'}`, 'error');
                    resetUI();
                }
            } catch (e) {
                const message = e && e.message ? e.message : '启动失败';
                showToast(message, 'error');
                addLog(`❌ 启动失败：${message}`, 'error');
                resetUI();
            }
        }

        function startProgressPolling() {
            if (progressInterval) {
                clearInterval(progressInterval);
                progressInterval = null;
            }
            checkWorkflowStatus();
            progressInterval = setInterval(checkWorkflowStatus, 3000);
        }

        async function checkWorkflowStatus() {
            try {
                const res = await fetch('/api/workflow/status');
                const data = await res.json();
                if (!data.success) return;

                const s = data.status;
                const ds = s.currentStatus || {};

                // Update progress
                const currentImg = ds.currentImageIndex || s.currentIndex + 1 || 0;
                const totalImgs = ds.totalImages || s.totalImages || 0;
                const imgPct = totalImgs > 0 ? Math.round(((currentImg - 1) / totalImgs) * 100) : 0;

                document.getElementById('imageProgressText').textContent = `${currentImg} / ${totalImgs}`;
                document.getElementById('imageProgressBar').style.width = `${imgPct}%`;

                const currentPrompt = ds.currentPromptIndex || 0;
                const promptPct = Math.round((currentPrompt / 5) * 100);

                document.getElementById('promptProgressText').textContent = `${currentPrompt} / 5`;
                document.getElementById('promptProgressBar').style.width = `${promptPct}%`;

                document.getElementById('currentStatusText').textContent = ds.currentAction || '处理中...';

                if (s.stats) {
                    document.getElementById('statsSuccess').textContent = s.stats.processed || 0;
                    document.getElementById('statsFailed').textContent = s.stats.failed || 0;
                    document.getElementById('statsGenerated').textContent = s.stats.totalGenerated || 0;
                }

                // Check completion
                if (!s.isRunning && s.totalImages > 0 && ds.phase === 'completed') {
                    if (progressInterval) {
                        clearInterval(progressInterval);
                        progressInterval = null;
                    }
                    showCompletionModal(s.stats);
                    resetUI();
                } else if (!s.isRunning && ds.phase === 'stopped') {
                    if (progressInterval) {
                        clearInterval(progressInterval);
                        progressInterval = null;
                    }
                    await refreshWorkflowResumeControls();
                    resetUI();
                } else if (!s.isRunning && ds.phase === 'error') {
                    if (progressInterval) {
                        clearInterval(progressInterval);
                        progressInterval = null;
                    }
                    showToast(ds.error || '工作流执行失败', 'error');
                    resetUI();
                }
            } catch (e) {}
        }

        function showCompletionModal(stats) {
            const msg = stats
                ? `成功: ${stats.processed} 张参考图\n失败: ${stats.failed} 张\n共生成: ${stats.totalGenerated} 张图片`
                : '所有任务已完成';
            document.getElementById('completionMessage').textContent = msg;
            document.getElementById('completionModal').classList.add('active');
            onWorkflowComplete();
        }

        async function stopWorkflow() {
            addLog('正在停止工作流...', 'system');
            try {
                const res = await fetch('/api/workflow/stop', { method: 'POST' });
                const data = await res.json().catch(() => ({}));
                if (progressInterval) {
                    clearInterval(progressInterval);
                    progressInterval = null;
                }
                resetUI();
                workflowResumeInfo = data && data.resume && data.resume.hasResume ? data.resume : null;
                await refreshWorkflowResumeControls();
                showToast(workflowResumeInfo ? '工作流已停止，可选择继续或开启新任务' : '工作流已停止');
            } catch (e) {}
        }

        function resetUI() {
            document.getElementById('oneClickStartBtn').disabled = false;
            document.getElementById('oneClickStartBtn').textContent = '▶️ 开始自动化流程';
        }

        // ==================== Prompts Management ====================
        let currentPrompts = [];
        let sentPromptIndices = new Set();
