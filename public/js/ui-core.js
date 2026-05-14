// 通用界面工具：日志、弹窗、提示、页面切换和按钮状态。
        function addLog(message, level = 'info') {
            const logArea = document.getElementById('logArea');
            const now = new Date();
            const timeStr = now.toTimeString().split(' ')[0];
            const normalizedLevel = level === 'warning' ? 'warn' : level;
            const safeLevel = ['info', 'warn', 'error', 'system', 'browser', 'success'].includes(normalizedLevel)
                ? normalizedLevel
                : 'info';
            const entry = document.createElement('div');
            entry.className = 'log-entry';

            const timeSpan = document.createElement('span');
            timeSpan.className = 'log-time';
            timeSpan.textContent = `[${timeStr}]`;

            const messageSpan = document.createElement('span');
            messageSpan.className = `log-${safeLevel}`;
            messageSpan.textContent = String(message ?? '');

            entry.appendChild(timeSpan);
            entry.appendChild(messageSpan);
            logArea.appendChild(entry);

            while (logArea.children.length > maxLogEntries) {
                logArea.removeChild(logArea.firstElementChild);
            }

            logArea.scrollTop = logArea.scrollHeight;
        }

        // SSE connection
        function connectLogStream() {
            if (eventSource) eventSource.close();
            eventSource = new EventSource('/api/logs');
            eventSource.onmessage = (e) => {
                try {
                    const data = JSON.parse(e.data);
                    addLog(data.message, data.type);
                } catch (err) {}
            };
        }

        // Status updates
        function updateStatus(type, online, text) {
            const item = document.getElementById(type + 'StatusItem');
            const label = document.getElementById(type + 'StatusText');
            if (item && label) {
                item.className = 'status-item ' + (online ? 'status-online' : 'status-offline');
                label.textContent = text;
            }
        }

        // Toast
        function showToast(message, type = 'success') {
            const toast = document.getElementById('toast');
            document.getElementById('toastMessage').textContent = message;
            toast.className = 'toast ' + type + ' active';
            setTimeout(() => toast.classList.remove('active'), 3000);
        }

        // Modal
        function closeModal() {
            document.getElementById('completionModal').classList.remove('active');
        }

        function switchPage(page) {
            const targetPage = page === 'resize' || page === 'creative' || page === 'rename' ? page : 'mass';
            document.getElementById('massPage')?.classList.toggle('active', targetPage === 'mass');
            document.getElementById('resizePage')?.classList.toggle('active', targetPage === 'resize');
            document.getElementById('creativePage')?.classList.toggle('active', targetPage === 'creative');
            document.getElementById('renamePage')?.classList.toggle('active', targetPage === 'rename');
            document.getElementById('massPageTab')?.classList.toggle('active', targetPage === 'mass');
            document.getElementById('resizePageTab')?.classList.toggle('active', targetPage === 'resize');
            document.getElementById('creativePageTab')?.classList.toggle('active', targetPage === 'creative');
            document.getElementById('renamePageTab')?.classList.toggle('active', targetPage === 'rename');
            document.body.classList.toggle('resize-mode', targetPage === 'resize');
            document.body.classList.toggle('creative-mode', targetPage === 'creative');
            document.body.classList.toggle('rename-mode', targetPage === 'rename');
            const subtitle = document.getElementById('pageSubtitle');
            if (subtitle) {
                subtitle.textContent = targetPage === 'creative'
                    ? '本地表格提示词 → Legil逐组生成 → 自动保存'
                    : (targetPage === 'rename'
                        ? '本地图片文件夹 → 提取中文题材 → 复制重命名输出'
                    : (targetPage === 'resize'
                        ? 'Legil批量改尺寸 → 自动保存到输出文件夹'
                        : '豆包API生成提示词 → Legil生成图片 → 全自动循环处理'));
            }
            closeFolderHistoryMenus();
        }

        function loadFolderHistory() {
            try {
                const parsed = JSON.parse(localStorage.getItem(folderHistoryKey) || '{}');
                return parsed && typeof parsed === 'object' ? parsed : {};
            } catch (e) {
                return {};
            }
        }

        function saveFolderHistory(store) {
            try {
                localStorage.setItem(folderHistoryKey, JSON.stringify(store || {}));
            } catch (e) {}
        }

        function normalizeFolderValue(value) {
            return String(value || '').trim();
        }

        function addFolderHistory(inputId, value) {
            const folderPath = normalizeFolderValue(value);
            if (!folderPath) return;

            const store = loadFolderHistory();
            const current = Array.isArray(store[inputId]) ? store[inputId] : [];
            const next = [
                folderPath,
                ...current.filter(item => String(item || '').toLowerCase() !== folderPath.toLowerCase())
            ].slice(0, folderHistoryLimit);

            store[inputId] = next;
            saveFolderHistory(store);
            renderFolderHistory(inputId);
        }

        function shortFolderLabel(folderPath) {
            const text = String(folderPath || '');
            if (text.length <= 28) return text;
            return '...' + text.slice(-25);
        }

        function renderFolderHistory(inputId) {
            const menu = document.getElementById(inputId + 'HistoryMenu');
            if (!menu) return;

            const store = loadFolderHistory();
            const values = [];
            const defaultValue = folderDefaults[inputId];
            const inputValue = normalizeFolderValue(document.getElementById(inputId)?.value);

            [inputValue, defaultValue, ...(Array.isArray(store[inputId]) ? store[inputId] : [])].forEach(value => {
                const folderPath = normalizeFolderValue(value);
                if (!folderPath) return;
                if (!values.some(item => item.toLowerCase() === folderPath.toLowerCase())) {
                    values.push(folderPath);
                }
            });

            menu.innerHTML = '';
            const visibleValues = values.slice(0, folderHistoryLimit);
            if (visibleValues.length === 0) {
                const empty = document.createElement('div');
                empty.className = 'folder-history-empty';
                empty.textContent = '暂无历史记录';
                menu.appendChild(empty);
                return;
            }

            visibleValues.forEach((folderPath) => {
                const item = document.createElement('div');
                item.setAttribute('role', 'button');
                item.tabIndex = 0;
                item.className = 'folder-history-item';
                item.title = folderPath;
                item.addEventListener('mousedown', event => event.preventDefault());
                item.addEventListener('click', () => selectFolderHistory(inputId, folderPath));
                item.addEventListener('keydown', (event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        selectFolderHistory(inputId, folderPath);
                    }
                });

                const label = document.createElement('span');
                label.className = 'folder-history-path';
                label.textContent = shortFolderLabel(folderPath);

                const canDelete = folderPath !== defaultValue;
                item.appendChild(label);

                if (canDelete) {
                    const deleteButton = document.createElement('button');
                    deleteButton.type = 'button';
                    deleteButton.className = 'folder-history-delete';
                    deleteButton.textContent = '删除';
                    deleteButton.addEventListener('mousedown', event => event.preventDefault());
                    deleteButton.addEventListener('click', (event) => {
                        event.stopPropagation();
                        deleteFolderHistory(inputId, folderPath);
                    });
                    item.appendChild(deleteButton);
                }

                menu.appendChild(item);
            });
        }

        function closeFolderHistoryMenus(exceptInputId = '') {
            document.querySelectorAll('.folder-history-menu.active').forEach(menu => {
                if (!exceptInputId || menu.id !== exceptInputId + 'HistoryMenu') {
                    menu.classList.remove('active');
                }
            });
            document.querySelectorAll('.folder-history-button.active').forEach(button => {
                if (!exceptInputId || button.id !== exceptInputId + 'HistoryButton') {
                    button.classList.remove('active');
                }
            });
        }

        function toggleFolderHistory(inputId) {
            const menu = document.getElementById(inputId + 'HistoryMenu');
            const button = document.getElementById(inputId + 'HistoryButton');
            if (!menu || !button) return;

            renderFolderHistory(inputId);
            const willOpen = !menu.classList.contains('active');
            closeFolderHistoryMenus(inputId);
            menu.classList.toggle('active', willOpen);
            button.classList.toggle('active', willOpen);
        }

        function deleteFolderHistory(inputId, folderPath) {
            const store = loadFolderHistory();
            const target = normalizeFolderValue(folderPath).toLowerCase();
            const current = Array.isArray(store[inputId]) ? store[inputId] : [];
            store[inputId] = current.filter(item => normalizeFolderValue(item).toLowerCase() !== target);
            saveFolderHistory(store);
            renderFolderHistory(inputId);
        }

        function initFolderControls() {
            Object.keys(folderDefaults).forEach(inputId => {
                const input = document.getElementById(inputId);
                if (!input) return;

                renderFolderHistory(inputId);
                input.addEventListener('blur', () => handleFolderInputBlur(inputId));
                input.addEventListener('keydown', (event) => {
                    if (event.key === 'Enter') {
                        event.preventDefault();
                        input.blur();
                    }
                });
            });

            document.addEventListener('click', (event) => {
                if (!event.target.closest('.folder-input-combo')) {
                    closeFolderHistoryMenus();
                }
            });
        }

        async function handleFolderInputBlur(inputId) {
            const input = document.getElementById(inputId);
            const folderPath = normalizeFolderValue(input?.value);
            if (!folderPath) {
                renderFolderHistory(inputId);
                return;
            }

            addFolderHistory(inputId, folderPath);

            if (inputId === 'referenceFolder') {
                await checkReferenceFolder({ silent: true });
            } else if (inputId === 'legilReferenceFolder') {
                await checkLegilReferenceFolder({ silent: true });
            } else if (inputId === 'resizeInputFolder') {
                await checkResizeInputFolder({ silent: true });
                await saveResizeConfig({ silent: true });
            } else if (inputId === 'resizeOutputFolder') {
                await saveResizeConfig({ silent: true });
            } else if (inputId === 'creativeOutputFolder' || inputId === 'creativeReferenceFolder') {
                await saveCreativeConfig({ silent: true });
            } else if (inputId === 'renameInputFolder' || inputId === 'renameOutputFolder') {
                config[inputId] = folderPath;
            } else if (inputId === 'resizeBatchInputFolder' || inputId === 'resizeBatchOutputFolder') {
                config[inputId] = folderPath;
                if (typeof saveResizeBatchSettings === 'function') {
                    saveResizeBatchSettings();
                }
            } else if (inputId === 'logoBatchInputFolder' || inputId === 'logoBatchOutputFolder') {
                config[inputId] = folderPath;
                if (typeof saveLogoBatchSettings === 'function') {
                    saveLogoBatchSettings();
                }
            }
        }

        async function selectFolderHistory(inputId, folderPath) {
            if (!folderPath) return;

            const input = document.getElementById(inputId);
            if (!input) return;

            input.value = folderPath;
            addFolderHistory(inputId, folderPath);
            await handleFolderInputBlur(inputId);

            closeFolderHistoryMenus();
        }

        async function browseFolder(inputId) {
            const input = document.getElementById(inputId);
            if (!input) return;

            const currentPath = normalizeFolderValue(input.value) || folderDefaults[inputId] || '';
            const browseButton = input.closest('.folder-path-row')?.querySelector('.btn-folder-browse');
            if (browseButton) {
                browseButton.disabled = true;
                browseButton.textContent = '选择中';
            }

            try {
                const res = await fetch('/api/select-folder', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ currentPath })
                });
                const data = await res.json();

                if (data.success && data.folderPath) {
                    input.value = data.folderPath;
                    addFolderHistory(inputId, data.folderPath);
                    await handleFolderInputBlur(inputId);
                    showToast('文件夹已选择');
                } else if (!data.cancelled) {
                    showToast(data.message || '选择文件夹失败', 'error');
                }
            } catch (e) {
                showToast('选择文件夹失败', 'error');
            } finally {
                if (browseButton) {
                    browseButton.disabled = false;
                    browseButton.textContent = '浏览';
                }
            }
        }

        // Check reference folder
        async function checkReferenceFolder(options = {}) {
            const path = document.getElementById('referenceFolder').value.trim();
            const infoBox = document.getElementById('refCountInfo');
            if (!path) return showToast('请输入文件夹路径', 'error');

            infoBox.className = 'info-box loading';
            infoBox.textContent = '统计中...';

            try {
                const res = await fetch('/api/count-images', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ folderPath: path })
                });
                const data = await res.json();
                if (data.success) {
                    infoBox.className = 'info-box success';
                    infoBox.textContent = `✅ 找到 ${data.count} 张参考图`;
                    addFolderHistory('referenceFolder', path);
                    if (!options.silent) showToast(`成功找到 ${data.count} 张图片`);
                } else {
                    infoBox.className = 'info-box error';
                    infoBox.textContent = '❌ ' + data.message;
                }
            } catch (e) {
                infoBox.className = 'info-box error';
                infoBox.textContent = '❌ 请求失败';
            }
        }

        // Check Legil reference folder
        async function checkLegilReferenceFolder(options = {}) {
            const path = document.getElementById('legilReferenceFolder').value.trim();
            const infoBox = document.getElementById('legilRefCountInfo');
            if (!path) return showToast('请输入文件夹路径', 'error');

            infoBox.className = 'info-box loading';
            infoBox.textContent = '统计中...';

            try {
                const res = await fetch('/api/count-images', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ folderPath: path })
                });
                const data = await res.json();
                if (data.success) {
                    infoBox.className = 'info-box success';
                    infoBox.textContent = `✅ 找到 ${data.count} 张参考图`;
                    addFolderHistory('legilReferenceFolder', path);
                    await saveLegilRefFolder({ silent: options.silent });
                } else {
                    infoBox.className = 'info-box error';
                    infoBox.textContent = '❌ ' + data.message;
                }
            } catch (e) {
                infoBox.className = 'info-box error';
                infoBox.textContent = '❌ 请求失败';
            }
        }

        // Save Legil ref folder
        async function saveLegilRefFolder(options = {}) {
            const path = document.getElementById('legilReferenceFolder').value.trim();
            if (!path) return;

            try {
                await fetch('/api/config/legil-ref-folder', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ folderPath: path })
                });
                addFolderHistory('legilReferenceFolder', path);
                if (!options.silent) showToast('配置已保存');
            } catch (e) {}
        }

        // Load config
        async function loadLegilRefFolderConfig() {
            try {
                const res = await fetch('/api/config/legil-ref-folder');
                const data = await res.json();
                if (data.success && data.folderPath) {
                    document.getElementById('legilReferenceFolder').value = data.folderPath;
                    addFolderHistory('legilReferenceFolder', data.folderPath);
                }
            } catch (e) {}
        }

        function updateResizePromptCount() {
            const textarea = document.getElementById('resizePromptTemplate');
            const counter = document.getElementById('resizePromptCount');
            if (textarea && counter) {
                counter.textContent = `${textarea.value.length} 字`;
            }
        }

        async function checkResizeInputFolder(options = {}) {
            const folderPath = document.getElementById('resizeInputFolder')?.value.trim();
            const infoBox = document.getElementById('resizeInputCountInfo');
            if (!folderPath) {
                if (!options.silent) showToast('请输入改尺寸输入文件夹路径', 'error');
                return false;
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
                        infoBox.textContent = `✅ 找到 ${data.count} 张输入图`;
                    }
                    addFolderHistory('resizeInputFolder', folderPath);
                    if (!options.silent) showToast(`成功找到 ${data.count} 张图片`);
                    return true;
                }

                if (infoBox) {
                    infoBox.className = 'info-box error';
                    infoBox.textContent = '❌ ' + data.message;
                }
                return false;
            } catch (e) {
                if (infoBox) {
                    infoBox.className = 'info-box error';
                    infoBox.textContent = '❌ 请求失败';
                }
                return false;
            }
        }

        async function readJsonResponse(response, fallbackMessage = '请求失败') {
            const contentType = response.headers.get('content-type') || '';
            if (!contentType.includes('application/json')) {
                await response.text().catch(() => '');
                throw new Error(fallbackMessage);
            }

            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.message || fallbackMessage);
            }
            return data;
        }

        async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 20000, fallbackMessage = '请求失败') {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);

            try {
                const response = await fetch(url, {
                    ...options,
                    signal: controller.signal
                });
                return await readJsonResponse(response, fallbackMessage);
            } catch (error) {
                if (error && error.name === 'AbortError') {
                    throw new Error('请求超时，请检查服务器是否正常运行');
                }
                throw error;
            } finally {
                clearTimeout(timer);
            }
        }
