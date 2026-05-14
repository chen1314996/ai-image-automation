// 浏览器操作按钮：打开 Legil、打开两个平台、关闭浏览器、刷新浏览器状态。
        async function openSingleWebsite(name) {
            if (name === 'doubao') {
                showToast('豆包已改为API调用，无需打开网页');
                return;
            }

            const input = document.getElementById(name + 'Url');
            const url = input ? input.value.trim() : '';
            if (!url) return showToast('请输入网址', 'error');

            addLog(`正在打开 ${name}...`, 'browser');
            try {
                const res = await fetch('/api/open-website', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, url })
                });
                const data = await res.json();
                if (data.success) {
                    addLog(`${name} 已打开`, 'browser');
                    updateStatus(name, true, 'Legil已连接');
                    updateStatus('browser', true, '浏览器运行中');
                }
            } catch (e) {
                showToast('打开失败', 'error');
            }
        }

        async function openBothWebsites() {
            const legilUrl = document.getElementById('legilUrl').value.trim();

            addLog('正在打开Legil网站，豆包已改为API调用...', 'browser');
            try {
                const res = await fetch('/api/open-both-websites', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ legilUrl })
                });
                const data = await res.json();
                if (data.success) {
                    addLog('Legil网站已打开，豆包API无需网页', 'browser');
                    loadDoubaoConfig();
                    updateStatus('legil', true, 'Legil已连接');
                    updateStatus('browser', true, '浏览器运行中');
                } else {
                    showToast(data.message || '打开失败', 'error');
                }
            } catch (e) {
                showToast('打开失败', 'error');
            }
        }

        async function closeBrowser() {
            addLog('正在关闭浏览器...', 'browser');
            try {
                await fetch('/api/close-browser', { method: 'POST' });
                addLog('浏览器已关闭', 'browser');
                updateStatus('browser', false, '浏览器未启动');
                updateStatus('legil', false, 'Legil未连接');
                loadDoubaoConfig();
            } catch (e) {}
        }

        async function checkBrowserStatus() {
            try {
                const res = await fetch('/api/browser-status');
                const data = await res.json();
                if (data.success && data.status) {
                    const s = data.status;
                    if (s.browserRunning) updateStatus('browser', true, '浏览器运行中');
                    if (s.doubaoApiConfigured) updateStatus('doubao', true, '豆包API已配置');
                    if (!s.doubaoApiConfigured) updateStatus('doubao', false, '豆包API未配置');
                    if (s.pages.legil) updateStatus('legil', true, 'Legil已连接');
                }
            } catch (e) {}
        }
