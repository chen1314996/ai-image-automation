// 提示词管理面板：获取、复制、选择并发送提示词到 Legil。
        async function fetchLatestPrompts() {
            addLog('正在获取最新提示词...', 'system');
            try {
                const response = await fetch('/api/workflow/extracted-prompts');
                const data = await response.json();

                if (data.success && data.prompts && data.prompts.length > 0) {
                    currentPrompts = data.prompts;
                    displayPrompts(data.prompts);
                    showToast(`已获取 ${data.prompts.length} 组提示词`);
                    addLog(`✅ 已获取 ${data.prompts.length} 组提示词`, 'success');
                } else {
                    showToast('暂无提示词，请先运行工作流');
                    addLog('⚠️ 暂无提示词，请先运行工作流', 'warning');
                }
            } catch (e) {
                showToast('获取提示词失败');
                addLog('❌ 获取提示词失败', 'error');
            }
        }

        function displayPrompts(prompts) {
            const emptyDiv = document.getElementById('promptsEmpty');
            const listDiv = document.getElementById('promptsList');

            emptyDiv.style.display = 'none';
            listDiv.style.display = 'flex';
            listDiv.innerHTML = '';

            prompts.forEach((prompt, index) => {
                const promptCard = createPromptCard(prompt, index + 1);
                listDiv.appendChild(promptCard);
            });
        }

        function createPromptCard(prompt, number) {
            const card = document.createElement('div');
            card.className = 'prompt-card';
            card.id = `prompt-card-${number}`;

            const isSent = sentPromptIndices.has(number);
            if (isSent) {
                card.classList.add('sent');
            }

            const content = typeof prompt === 'string' ? prompt : prompt.content;
            const preview = content.substring(0, 150) + (content.length > 150 ? '...' : '');

            card.innerHTML = `
                <div class="prompt-header">
                    <div class="prompt-number">
                        <span class="prompt-badge ${isSent ? 'sent' : ''}" id="prompt-badge-${number}">${number}</span>
                        <span class="prompt-title-text">提示词 ${number}</span>
                    </div>
                    <span class="prompt-status" id="prompt-status-${number}">${isSent ? '✅ 已发送' : '⏳ 待发送'}</span>
                </div>
                <div class="prompt-content" id="prompt-content-${number}">${escapeHtml(content)}</div>
                <div class="prompt-actions">
                    <button class="btn-small btn-copy" onclick="copyPrompt(${number})" title="复制到剪贴板">
                        📋 复制
                    </button>
                    <button class="btn-small btn-send" onclick="sendPromptToLegil(${number})" id="btn-send-${number}" ${isSent ? 'disabled' : ''} title="发送到Legil生成图片">
                        🚀 发送到Legil
                    </button>
                </div>
            `;

            return card;
        }

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        async function copyPrompt(number) {
            const prompt = currentPrompts[number - 1];
            if (!prompt) return;

            const content = typeof prompt === 'string' ? prompt : prompt.content;

            try {
                await navigator.clipboard.writeText(content);
                showToast(`提示词 ${number} 已复制`);
                addLog(`📋 提示词 ${number} 已复制到剪贴板`, 'info');
            } catch (e) {
                // 降级方案
                const textarea = document.createElement('textarea');
                textarea.value = content;
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand('copy');
                document.body.removeChild(textarea);
                showToast(`提示词 ${number} 已复制`);
            }
        }

        async function copyAllPrompts() {
            if (currentPrompts.length === 0) {
                showToast('暂无提示词可复制');
                return;
            }

            const allContent = currentPrompts.map((p, i) => {
                const content = typeof p === 'string' ? p : p.content;
                return `【提示词 ${i + 1}】\n${content}`;
            }).join('\n\n');

            try {
                await navigator.clipboard.writeText(allContent);
                showToast('全部提示词已复制');
                addLog('📋 全部提示词已复制到剪贴板', 'info');
            } catch (e) {
                showToast('复制失败');
            }
        }

        async function sendPromptToLegil(number) {
            const prompt = currentPrompts[number - 1];
            if (!prompt) return;

            const content = typeof prompt === 'string' ? prompt : prompt.content;

            // 更新UI状态
            const card = document.getElementById(`prompt-card-${number}`);
            const badge = document.getElementById(`prompt-badge-${number}`);
            const status = document.getElementById(`prompt-status-${number}`);
            const btn = document.getElementById(`btn-send-${number}`);

            card.classList.add('sending');
            badge.classList.add('sending');
            status.textContent = '🔄 发送中...';
            btn.disabled = true;

            addLog(`正在发送提示词 ${number} 到Legil...`, 'system');

            try {
                const legilConfigSaved = await saveLegilGenerationConfig({ silent: true });
                if (!legilConfigSaved) {
                    throw new Error('Legil生成参数保存失败');
                }

                const response = await fetch('/api/legil/generate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ prompt: content, promptIndex: number })
                });

                const data = await response.json();

                if (data.success) {
                    sentPromptIndices.add(number);
                    card.classList.remove('sending');
                    card.classList.add('sent');
                    badge.classList.remove('sending');
                    badge.classList.add('sent');
                    status.textContent = '✅ 已发送';
                    showToast(`提示词 ${number} 发送成功`);
                    addLog(`✅ 提示词 ${number} 已发送到Legil`, 'success');
                } else {
                    throw new Error(data.message || '发送失败');
                }
            } catch (e) {
                card.classList.remove('sending');
                badge.classList.remove('sending');
                status.textContent = '❌ 发送失败';
                btn.disabled = false;
                showToast(`提示词 ${number} 发送失败: ${e.message}`);
                addLog(`❌ 提示词 ${number} 发送失败: ${e.message}`, 'error');
            }
        }

        async function sendAllPromptsToLegil() {
            if (currentPrompts.length === 0) {
                showToast('暂无提示词可发送');
                addLog('⚠️ 暂无提示词可发送', 'warning');
                return;
            }

            addLog(`开始批量发送 ${currentPrompts.length} 组提示词到Legil...`, 'system');

            for (let i = 1; i <= currentPrompts.length; i++) {
                if (!sentPromptIndices.has(i)) {
                    await sendPromptToLegil(i);
                    // 每组之间等待5秒
                    if (i < currentPrompts.length) {
                        await new Promise(r => setTimeout(r, 5000));
                    }
                }
            }

            addLog('✅ 批量发送完成', 'success');
            showToast('全部提示词发送完成');
        }

        // 工作流完成后自动获取提示词
        function onWorkflowComplete() {
            setTimeout(() => {
                fetchLatestPrompts();
            }, 1000);
        }
