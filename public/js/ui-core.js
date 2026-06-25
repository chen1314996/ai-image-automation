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

        const pageLabels = {
            runCenter: '运行中心',
            autonomyPolicy: '自动化策略',
            creative: '创意拓展',
            materialAnalysis: '素材分析',
            taskWorkbook: '方案迭代',
            mass: '批量产图',
            knowledge: '知识库',
            delivery: '改尺寸',
            config: '配置',
            rename: '本地交付工具'
        };

        const pageSubtitles = {
            runCenter: '运行中心：统一查看批量产图、创意拓展和交付任务的运行状态',
            autonomyPolicy: '自动化策略：控制自动执行权限、运行阈值和异常保护策略',
            creative: '创意拓展：确认目录和方向队列，批量提交生图任务',
            materialAnalysis: '素材分析：投放素材数据导入 → Top 素材分析 → 创意机会沉淀',
            taskWorkbook: '方案迭代：任务表导入 → 行级方向整理 → 多选送入创意拓展',
            mass: '批量产图：参考图自动生成提示词，并批量提交生图任务',
            knowledge: '知识库：管理方向体系、生成资产、审核反馈和创意经验沉淀',
            delivery: '改尺寸交付：将待交付图片适配为多种投放尺寸，并完成命名、标识和交付处理。',
            config: '全局配置：提示词模型、通知策略和运行监控',
            rename: '本地交付工具：重命名、标准化、LOGO 和打包'
        };

        function setCurrentPageLabel(page) {
            const label = document.getElementById('currentPageLabel');
            if (label) {
                label.textContent = pageLabels[page] || pageLabels.mass;
            }
        }

        function closeMobileNav() {
            const tabs = document.getElementById('pageTabs');
            const toggle = document.getElementById('mobileNavToggle');
            const backdrop = document.getElementById('mobileNavBackdrop');
            tabs?.classList.remove('is-open');
            toggle?.setAttribute('aria-expanded', 'false');
            document.body.classList.remove('mobile-nav-open');
            if (backdrop) {
                backdrop.hidden = true;
            }
        }

        function toggleMobileNav() {
            const tabs = document.getElementById('pageTabs');
            const toggle = document.getElementById('mobileNavToggle');
            const backdrop = document.getElementById('mobileNavBackdrop');
            const willOpen = !tabs?.classList.contains('is-open');
            tabs?.classList.toggle('is-open', willOpen);
            toggle?.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
            document.body.classList.toggle('mobile-nav-open', willOpen);
            if (backdrop) {
                backdrop.hidden = !willOpen;
            }
        }

        function setLogPanelCollapsed(collapsed) {
            const section = document.getElementById('logSection');
            const button = document.getElementById('logToggleBtn');
            const logArea = document.getElementById('logArea');
            section?.classList.toggle('is-collapsed', collapsed);
            if (button) {
                button.textContent = collapsed ? '展开日志' : '收起日志';
                button.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
            }
            if (logArea) {
                logArea.setAttribute('aria-hidden', collapsed ? 'true' : 'false');
            }
            try {
                localStorage.setItem('logPanelCollapsed', collapsed ? '1' : '0');
            } catch (e) {}
        }

        function toggleLogPanel() {
            const section = document.getElementById('logSection');
            setLogPanelCollapsed(!section?.classList.contains('is-collapsed'));
        }

        function initProductShellInteractions() {
            setLogPanelCollapsed(false);
            setCurrentPageLabel(document.querySelector('.page-view.active')?.id?.replace('Page', '') || 'runCenter');
        }

        function moveGlobalConfigCards() {
            const mount = document.getElementById('configPanelMount');
            if (!mount) return;

            const createEl = (tag, attrs = {}, children = []) => {
                const el = document.createElement(tag);
                Object.entries(attrs).forEach(([key, value]) => {
                    if (value === null || value === undefined) return;
                    if (key === 'className') {
                        el.className = value;
                    } else if (key === 'textContent') {
                        el.textContent = value;
                    } else if (key === 'htmlFor') {
                        el.htmlFor = value;
                    } else if (key === 'dataset') {
                        Object.entries(value).forEach(([dataKey, dataValue]) => {
                            el.dataset[dataKey] = dataValue;
                        });
                    } else {
                        el.setAttribute(key, value);
                    }
                });
                children.filter(Boolean).forEach(child => {
                    el.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
                });
                return el;
            };

            const getOrCreateInput = (id, attrs = {}) => {
                const existing = document.getElementById(id);
                if (existing) {
                    Object.entries(attrs).forEach(([key, value]) => {
                        if (key === 'className') existing.className = value;
                        else if (key === 'textContent') existing.textContent = value;
                        else if (value !== undefined && value !== null) existing.setAttribute(key, value);
                    });
                    return existing;
                }
                return createEl('input', { id, ...attrs });
            };

            const appendField = (parent, labelText, control, metaText) => {
                const field = createEl('div', { className: 'form-group' }, [
                    createEl('label', { htmlFor: control.id || '', textContent: labelText }),
                    control
                ]);
                if (metaText) {
                    field.appendChild(createEl('div', { className: 'field-meta' }, [
                        createEl('span', { textContent: metaText })
                    ]));
                }
                parent.appendChild(field);
                return field;
            };

            const makeCard = (id, title, subtitle, iconClass, className = '') => {
                const card = createEl('section', {
                    className: `card compact-config-card system-config-card ${className}`.trim(),
                    id
                });
                card.appendChild(createEl('div', { className: 'system-config-card-head' }, [
                    createEl('div', { className: 'card-title' }, [
                        createEl('span', { className: iconClass, 'aria-hidden': 'true' }),
                        document.createTextNode(title)
                    ]),
                    subtitle ? createEl('span', { textContent: subtitle }) : null
                ]));
                return card;
            };

            const makeToggle = (id, text) => createEl('label', { className: 'notification-toggle' }, [
                createEl('input', { type: 'checkbox', id }),
                createEl('span', { textContent: text })
            ]);
            const makeNumber = (id, label, value, min, max) => createEl('div', { className: 'form-group' }, [
                createEl('label', { htmlFor: id, textContent: label }),
                createEl('input', { type: 'number', id, min, max, step: '1', value })
            ]);

            if (!document.getElementById('configHealthCard')) {
                const card = makeCard('configHealthCard', '健康状态', '配置可用性', 'icon icon-blue icon-run', 'system-config-health-card');
                card.appendChild(createEl('div', { className: 'system-health-grid' }, [
                    createEl('div', { className: 'system-health-item' }, [
                        createEl('span', { textContent: '模型' }),
                        createEl('strong', { id: 'configCardModelHealth', textContent: '读取中' })
                    ]),
                    createEl('div', { className: 'system-health-item' }, [
                        createEl('span', { textContent: '密钥' }),
                        createEl('strong', { id: 'configSecretHealth', textContent: '读取中' })
                    ]),
                    createEl('div', { className: 'system-health-item' }, [
                        createEl('span', { textContent: '通知' }),
                        createEl('strong', { id: 'configCardNotifyHealth', textContent: '待确认' })
                    ]),
                    createEl('div', { className: 'system-health-item' }, [
                        createEl('span', { textContent: '守护进程' }),
                        createEl('strong', { id: 'configCardMonitorHealth', textContent: '读取中' })
                    ])
                ]));
                mount.appendChild(card);
            }

            if (!document.getElementById('promptGenerationConfigCard')) {
                const card = makeCard('promptGenerationConfigCard', '模型配置', '提示词生成', 'icon icon-green icon-chat', 'system-config-model-card');
                const providerButton = createEl('button', {
                    type: 'button',
                    className: 'model-option',
                    onclick: "setPromptProvider('lumos')",
                    dataset: { promptProvider: 'lumos' }
                }, [
                    createEl('span', { className: 'model-option-title', textContent: 'Lumos Winky' }),
                    createEl('span', { className: 'model-option-desc', textContent: '通过后端安全配置调用模型' })
                ]);
                card.appendChild(createEl('div', { className: 'setting-group' }, [
                    createEl('label', { textContent: '模型来源' }),
                    createEl('div', { className: 'model-options workflow-browser-mode-options', id: 'promptProviderOptions' }, [providerButton])
                ]));

                const panel = createEl('div', { id: 'lumosPromptConfigPanel', dataset: { promptProviderPanel: 'lumos' } });
                const modelSelect = document.getElementById('lumosPromptModelSelect') || createEl('select', {
                    id: 'lumosPromptModelSelect',
                    onchange: 'setLumosPromptModelFromSelect()'
                }, [
                    createEl('option', { value: '', textContent: '正在读取模型列表...' })
                ]);
                modelSelect.classList.add('model-select');
                panel.appendChild(createEl('div', { className: 'form-group' }, [
                    createEl('label', { htmlFor: 'lumosPromptModelSelect', textContent: '提示词模型' }),
                    modelSelect,
                    createEl('div', { className: 'field-meta' }, [
                        document.getElementById('lumosPromptModelStatus') || createEl('span', {
                            id: 'lumosPromptModelStatus',
                            textContent: '读取后选择可用模型'
                        })
                    ])
                ]));
                const statusInput = getOrCreateInput('lumosPromptApiKeyStatus', {
                    type: 'text',
                    value: '等待读取后端配置',
                    readonly: ''
                });
                appendField(panel, '密钥状态', statusInput, '密钥只由后端读取，页面不会显示明文');
                panel.appendChild(getOrCreateInput('lumosPromptModel', { type: 'hidden' }));
                card.appendChild(panel);
                card.appendChild(document.getElementById('doubaoConfigInfo') || createEl('div', {
                    className: 'info-box',
                    id: 'doubaoConfigInfo'
                }));
                card.appendChild(createEl('div', { className: 'input-actions' }, [
                    createEl('button', { className: 'btn btn-secondary', onclick: 'loadLumosPromptModels()', textContent: '刷新模型' }),
                    createEl('button', { className: 'btn btn-secondary', onclick: 'testPromptGenerationConfig()', textContent: '测试模型' })
                ]));
                mount.appendChild(card);

            }

            if (!document.getElementById('notificationConfigCard')) {
                const card = makeCard('notificationConfigCard', '通知', '任务与异常消息', 'icon icon-green icon-link');
                card.appendChild(createEl('div', { className: 'notification-grid' }, [
                    makeToggle('notifyFeishuEnabled', '启用飞书异常通知'),
                    makeToggle('notifyTaskCompletionEnabled', '启用队列完成通知'),
                    makeToggle('notifyServerStartupEnabled', '启用启动异常通知'),
                    makeToggle('notifyStaleProgressEnabled', '启用卡住提醒')
                ]));
                card.appendChild(createEl('div', { className: 'notification-number-grid' }, [
                    makeNumber('notifyStaleThresholdMinutes', '卡住阈值（分钟）', '30', '1', '1440'),
                    makeNumber('notifyCooldownMinutes', '通知冷却（分钟）', '10', '0', '1440')
                ]));
                card.appendChild(createEl('div', { className: 'info-box', id: 'notificationConfigInfo' }));
                mount.appendChild(card);
            }

            if (!document.getElementById('monitoringConfigCard')) {
                const card = makeCard('monitoringConfigCard', '监控', '异常保护与恢复', 'icon icon-blue icon-run');
                card.appendChild(createEl('div', { className: 'notification-grid notification-grid-secondary' }, [
                    makeToggle('notifyLegilScreenshotEnabled', '异常时自动截图'),
                    makeToggle('notifyAutoRecoveryEnabled', '启用自动恢复'),
                    makeToggle('notifyPauseOnFailuresEnabled', '连续失败后暂停确认'),
                    makeToggle('notifyWatchdogRestartEnabled', '守护进程掉线后重启服务')
                ]));
                card.appendChild(createEl('div', { className: 'notification-number-grid' }, [
                    makeNumber('notifyFailureThreshold', '连续失败阈值（次）', '3', '1', '20'),
                    createEl('div', { className: 'form-group notification-status-box' }, [
                        createEl('label', { textContent: '守护进程状态' }),
                        createEl('div', { className: 'info-box', id: 'watchdogStatusInfo', textContent: '等待读取...' })
                    ])
                ]));
                card.appendChild(createEl('div', { className: 'input-actions' }, [
                    createEl('button', { className: 'btn btn-secondary', onclick: 'refreshWatchdogStatus()', textContent: '刷新监控' })
                ]));
                mount.appendChild(card);
            }

            if (!document.getElementById('advancedConnectionConfigCard')) {
                const details = createEl('details', {
                    className: 'card card-wide collapsible-card compact-config-card system-config-card system-advanced-card product-collapsible',
                    id: 'advancedConnectionConfigCard'
                });
                details.appendChild(createEl('summary', { className: 'card-title' }, [
                    createEl('span', { className: 'icon icon-blue icon-link', 'aria-hidden': 'true' }),
                    document.createTextNode('高级连接')
                ]));
                const keyInput = getOrCreateInput('lumosPromptApiKey', {
                    type: 'password',
                    autocomplete: 'off',
                    placeholder: '需要替换 Key 时填写，保存后不会回显'
                });
                appendField(details, '替换 API Key', keyInput, '留空保存不会覆盖已有 Key');
                const apiUrlInput = getOrCreateInput('lumosPromptApiUrl', {
                    type: 'text',
                    placeholder: '留空则使用后端 WINKY_API_BASE_URL'
                });
                appendField(details, 'API 地址', apiUrlInput);
                const providerInput = getOrCreateInput('lumosPromptProvider', {
                    type: 'text',
                    placeholder: '如代理需要指定服务商参数，可在这里填写'
                });
                appendField(details, '服务商参数（可选）', providerInput);
                mount.appendChild(details);
            }

            [
                'configHealthCard',
                'promptGenerationConfigCard',
                'notificationConfigCard',
                'monitoringConfigCard',
                'advancedConnectionConfigCard'
            ].forEach(cardId => {
                const card = document.getElementById(cardId);
                if (card && card.parentElement !== mount) {
                    mount.appendChild(card);
                }
            });
        }

        function switchPage(page) {
            const temporarilyHiddenPages = ['autonomyPolicy'];
            const allowedPages = ['runCenter', 'creative', 'knowledge', 'materialAnalysis', 'taskWorkbook', 'delivery', 'config', 'rename'];
            const targetPage = temporarilyHiddenPages.includes(page) ? 'runCenter' : (allowedPages.includes(page) ? page : 'mass');
            document.getElementById('runCenterPage')?.classList.toggle('active', targetPage === 'runCenter');
            document.getElementById('autonomyPolicyPage')?.classList.toggle('active', targetPage === 'autonomyPolicy');
            document.getElementById('massPage')?.classList.toggle('active', targetPage === 'mass');
            document.getElementById('creativePage')?.classList.toggle('active', targetPage === 'creative');
            document.getElementById('knowledgePage')?.classList.toggle('active', targetPage === 'knowledge');
            document.getElementById('materialAnalysisPage')?.classList.toggle('active', targetPage === 'materialAnalysis');
            document.getElementById('taskWorkbookPage')?.classList.toggle('active', targetPage === 'taskWorkbook');
            document.getElementById('deliveryPage')?.classList.toggle('active', targetPage === 'delivery');
            document.getElementById('configPage')?.classList.toggle('active', targetPage === 'config');
            document.getElementById('renamePage')?.classList.toggle('active', targetPage === 'rename');
            document.getElementById('runCenterPageTab')?.classList.toggle('active', targetPage === 'runCenter');
            document.getElementById('autonomyPolicyPageTab')?.classList.toggle('active', targetPage === 'autonomyPolicy');
            document.getElementById('massPageTab')?.classList.toggle('active', targetPage === 'mass');
            document.getElementById('creativePageTab')?.classList.toggle('active', targetPage === 'creative');
            document.getElementById('knowledgePageTab')?.classList.toggle('active', targetPage === 'knowledge');
            document.getElementById('materialAnalysisPageTab')?.classList.toggle('active', targetPage === 'materialAnalysis');
            document.getElementById('taskWorkbookPageTab')?.classList.toggle('active', targetPage === 'taskWorkbook');
            document.getElementById('deliveryPageTab')?.classList.toggle('active', targetPage === 'delivery');
            document.getElementById('configPageTab')?.classList.toggle('active', targetPage === 'config');
            document.getElementById('renamePageTab')?.classList.toggle('active', targetPage === 'rename');
            document.body.classList.toggle('delivery-mode', targetPage === 'delivery');
            document.body.classList.toggle('config-mode', targetPage === 'config');
            document.body.classList.toggle('run-center-mode', targetPage === 'runCenter');
            document.body.classList.toggle('autonomy-policy-mode', targetPage === 'autonomyPolicy');
            document.body.classList.toggle('creative-mode', targetPage === 'creative');
            document.body.classList.toggle('knowledge-mode', targetPage === 'knowledge');
            document.body.classList.toggle('material-analysis-mode', targetPage === 'materialAnalysis');
            document.body.classList.toggle('task-workbook-mode', targetPage === 'taskWorkbook');
            document.body.classList.toggle('rename-mode', targetPage === 'rename');
            document.getElementById('pageSubtitle').textContent = pageSubtitles[targetPage] || pageSubtitles.mass;
            setCurrentPageLabel(targetPage);
            closeMobileNav();
            if (targetPage === 'runCenter') {
                if (typeof window.startRunCenterPolling === 'function') window.startRunCenterPolling();
            } else if (typeof window.stopRunCenterPolling === 'function') {
                window.stopRunCenterPolling();
            }
            if (targetPage === 'autonomyPolicy' && typeof window.loadAutonomyPolicy === 'function') {
                window.loadAutonomyPolicy({ silent: true });
            }
            if (targetPage === 'creative') {
                document.dispatchEvent(new CustomEvent('creative:auto:visible'));
                if (typeof window.ensureCreativeAutoInitialData === 'function') {
                    if (typeof window.primeCreativeAutoRunState === 'function') window.primeCreativeAutoRunState();
                    window.ensureCreativeAutoInitialData();
                }
            }
            if (targetPage === 'runCenter' || targetPage === 'autonomyPolicy') {
                if (typeof window.startAutonomyDiagnosticsPolling === 'function') window.startAutonomyDiagnosticsPolling();
            } else if (typeof window.stopAutonomyDiagnosticsPolling === 'function') {
                window.stopAutonomyDiagnosticsPolling();
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
                if (typeof saveWorkflowConfig === 'function') {
                    await saveWorkflowConfig({ silent: true });
                }
            } else if (inputId === 'legilReferenceFolder') {
                await checkLegilReferenceFolder({ silent: true });
            } else if (inputId === 'saveFolder') {
                config[inputId] = folderPath;
                if (typeof saveWorkflowConfig === 'function') {
                    await saveWorkflowConfig({ silent: true });
                }
            } else if (inputId === 'resizeInputFolder') {
                await checkResizeInputFolder({ silent: true });
                await saveResizeConfig({ silent: true });
            } else if (inputId === 'resizeOutputFolder') {
                await saveResizeConfig({ silent: true });
            } else if (inputId === 'creativeOutputFolder' || inputId === 'creativeReferenceFolder') {
                await saveCreativeConfig({ silent: true });
            } else if (inputId === 'tablePromptReferenceFolder' || inputId === 'tablePromptOutputFolder') {
                config[inputId] = folderPath;
                if (typeof window.persistTablePromptFolderConfig === 'function') {
                    window.persistTablePromptFolderConfig({ silent: true });
                }
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
            } else if (inputId === 'deliveryInputFolder' || inputId === 'deliveryOutputFolder' || inputId === 'deliveryLogoFolder') {
                config[inputId] = folderPath;
                if (typeof updateDeliveryPreview === 'function') {
                    updateDeliveryPreview();
                }
                if (typeof saveDeliveryRuntimeConfig === 'function') {
                    await saveDeliveryRuntimeConfig({ silent: true, force: true });
                }
            } else if (inputId === 'visionRenameInputFolder') {
                if (typeof window.refreshVisionRenameImageCount === 'function') {
                    await window.refreshVisionRenameImageCount({ silent: true });
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
                if (!options.silent) showToast('请输入 AI 尺寸适配输入文件夹路径', 'error');
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
            if (
                window.ApiClient &&
                typeof window.ApiClient.readJsonResponse === 'function' &&
                window.ApiClient.readJsonResponse !== readJsonResponse
            ) {
                return await window.ApiClient.readJsonResponse(response, fallbackMessage);
            }
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
            if (window.ApiClient && typeof window.ApiClient.fetchJson === 'function') {
                return await window.ApiClient.fetchJson(url, {
                    ...options,
                    timeoutMs,
                    fallbackMessage
                });
            }
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

        initProductShellInteractions();
