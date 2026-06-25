// 改尺寸交付：先完成源图扫描、任务记录落盘和页面任务追踪。
        const DELIVERY_TARGET_SIZES = ['800x800', '1280x720', '1080x1920'];
        const DELIVERY_TARGET_ASPECT_RATIOS = {
            '800x800': '1:1',
            '1280x720': '16:9',
            '1080x1920': '9:16'
        };
        const DELIVERY_NO_TEXT_GUARDRAIL = [
            '纯画面适配：成图中不要新增任何文字、字母、数字、单词、可读标语、伪文字、乱码、签名、水印、logo、UI 文案、价格牌、标签或包装文字。',
            '如果原图已有文字或类似文字的纹理可以保留。'
        ].join('\n');
        const DELIVERY_ALLOWED_CANDIDATE_COUNTS = [1, 2, 3, 4];
        const DELIVERY_TARGET_SIZE_STORAGE_KEY = 'ai-image-automation-delivery-target-sizes-v1';
        const DELIVERY_TARGET_COUNT_STORAGE_KEY = 'ai-image-automation-delivery-target-counts-v1';
        const DELIVERY_TAG_STORAGE_KEY = 'ai-image-automation-delivery-tags-v1';
        const DELIVERY_TAG_LEVELS = {
            primary: {
                inputId: 'deliveryPrimaryTagInput',
                menuId: 'deliveryPrimaryTagMenu',
                buttonId: 'deliveryPrimaryTagMenuButton',
                configKey: 'deliveryPrimaryTag',
                label: '一级标签',
                defaults: ['题材']
            },
            secondary: {
                inputId: 'deliverySecondaryTagInput',
                menuId: 'deliverySecondaryTagMenu',
                buttonId: 'deliverySecondaryTagMenuButton',
                configKey: 'deliverySecondaryTag',
                label: '二级标签',
                defaults: ['载具']
            },
            tertiary: {
                inputId: 'deliveryTertiaryTagInput',
                menuId: 'deliveryTertiaryTagMenu',
                buttonId: 'deliveryTertiaryTagMenuButton',
                configKey: 'deliveryTertiaryTag',
                label: '三级标签',
                defaults: []
            }
        };
        let deliveryCurrentRun = null;
        let deliveryScanning = false;
        let deliveryStatusInterval = null;
        let deliveryFixedStatusInterval = null;
        let deliveryRunTaskActive = false;
        let deliveryConfigHydrated = false;
        let deliveryRuntimeSaveTimer = null;
        let deliveryBeforeUnloadBound = false;
        const deliveryDirtyFieldIds = new Set();

        function initDeliveryPage() {
            config.resizeProvider = 'legil';
            config.deliveryProcessMode = loadDeliveryProcessMode();
            try {
                window.localStorage.setItem('ai-image-automation-resize-provider-v1', 'legil');
            } catch (e) {}
            bindDeliveryProcessModeOptions();
            bindDeliveryTargetSizeOptions();
            bindDeliveryCandidateOptions();
            bindDeliveryNamingPreview();
            initDeliveryTagControls();
            bindDeliveryActions();
            bindDeliveryBeforeUnloadSave();
            updateDeliveryPreview();
            if (typeof loadResizeConfig === 'function') {
                loadResizeConfig()
                    .then(() => loadDeliveryRuntimeConfig())
                    .catch(() => loadDeliveryRuntimeConfig())
                    .finally(() => {
                    deliveryConfigHydrated = true;
                    enforceDeliveryLegilSettings();
                    updateDeliveryPreview();
                    loadLatestDeliveryRun();
                });
            } else {
                deliveryConfigHydrated = true;
                enforceDeliveryLegilSettings();
                loadLatestDeliveryRun();
            }
        }

        function normalizeDeliveryProcessMode(mode) {
            return mode === 'legil-only' ? 'legil-only' : 'full-delivery';
        }

        function loadDeliveryProcessMode() {
            try {
                return normalizeDeliveryProcessMode(window.localStorage.getItem('ai-image-automation-delivery-process-mode-v1') || config.deliveryProcessMode);
            } catch (e) {
                return normalizeDeliveryProcessMode(config.deliveryProcessMode);
            }
        }

        function saveDeliveryProcessMode(mode) {
            config.deliveryProcessMode = normalizeDeliveryProcessMode(mode);
            try {
                window.localStorage.setItem('ai-image-automation-delivery-process-mode-v1', config.deliveryProcessMode);
            } catch (e) {}
        }

        async function loadDeliveryRuntimeConfig() {
            try {
                const res = await fetch('/api/config/resize');
                const data = await res.json();
                if (data && data.success && data.config) {
                    applyDeliveryRuntimeConfig(data.config, { fromLoad: true });
                    return true;
                }
            } catch (e) {}
            return false;
        }

        function markDeliveryFieldDirty(inputId) {
            if (!inputId) return;
            deliveryDirtyFieldIds.add(inputId);
            deliveryConfigHydrated = true;
        }

        function setDeliveryInputValue(inputId, value, options = {}) {
            const input = document.getElementById(inputId);
            if (!input || value === undefined || value === null) return;
            if (deliveryDirtyFieldIds.has(inputId) && options.force !== true) return;
            input.value = String(value);
            config[inputId] = input.value.trim();
        }

        function applyDeliveryRuntimeConfig(dataConfig = {}, options = {}) {
            const source = dataConfig && typeof dataConfig === 'object' ? dataConfig : {};
            const forceApply = options.force === true || options.fromSave === true;
            if (source.inputFolder) setDeliveryInputValue('deliveryInputFolder', source.inputFolder, { force: forceApply });
            if (source.outputFolder) setDeliveryInputValue('deliveryOutputFolder', source.outputFolder, { force: forceApply });
            if (source.logoTemplateFolder || source.logoFolder) {
                setDeliveryInputValue('deliveryLogoFolder', source.logoTemplateFolder || source.logoFolder, { force: forceApply });
            }

            const mode = source.processMode || source.deliveryProcessMode;
            if (mode) {
                saveDeliveryProcessMode(mode);
            }
            if (Array.isArray(source.targetSizes) && source.targetSizes.length) {
                saveDeliveryTargetSizes(source.targetSizes);
            }
            if (source.candidateCountsBySize || source.deliveryCandidateCount || source.candidateCountPerSize) {
                saveDeliveryCandidateCountsBySize(
                    source.candidateCountsBySize || source.deliveryCandidateCount || source.candidateCountPerSize
                );
            }

            const fixedPrompt = typeof source.fixedPromptTemplate === 'string'
                ? source.fixedPromptTemplate
                : (typeof source.fixedPrompt === 'string' ? source.fixedPrompt : '');
            if (fixedPrompt) {
                setDeliveryInputValue('deliveryFixedPrompt', fixedPrompt, { force: forceApply });
            }

            const templates = source.promptTemplates && typeof source.promptTemplates === 'object'
                ? source.promptTemplates
                : {};
            const hasPromptTemplate = Object.values(templates).some(value => typeof value === 'string' && value.trim());
            if (hasPromptTemplate) {
                if (typeof templates.common === 'string') setDeliveryInputValue('deliveryPromptCommon', templates.common, { force: forceApply });
                if (typeof templates['800x800'] === 'string') setDeliveryInputValue('deliveryPrompt800', templates['800x800'], { force: forceApply });
                if (typeof templates['1280x720'] === 'string') setDeliveryInputValue('deliveryPrompt1280', templates['1280x720'], { force: forceApply });
                if (typeof templates['1080x1920'] === 'string') setDeliveryInputValue('deliveryPrompt1080', templates['1080x1920'], { force: forceApply });
            }

            const naming = source.namingRule && typeof source.namingRule === 'object' ? source.namingRule : {};
            if (naming.fixedPrefix || naming.prefix) setDeliveryInputValue('deliveryNamingPrefix', naming.fixedPrefix || naming.prefix, { force: forceApply });
            if (naming.startNumber) setDeliveryInputValue('deliveryStartNumber', naming.startNumber, { force: forceApply });
            if (naming.regionText || naming.region) setDeliveryInputValue('deliveryRegionText', naming.regionText || naming.region, { force: forceApply });
            if (naming.channelText || naming.channel) setDeliveryInputValue('deliveryChannelText', naming.channelText || naming.channel, { force: forceApply });

            const tagLevels = Array.isArray(naming.tagLevels) ? naming.tagLevels : [
                naming.primaryTag || naming.primary,
                naming.secondaryTag || naming.secondary,
                naming.tertiaryTag || naming.tertiary
            ];
            if (tagLevels.some(Boolean)) {
                const lists = getDeliveryTagLists();
                ['primary', 'secondary', 'tertiary'].forEach((level, index) => {
                    const value = String(tagLevels[index] || '').trim();
                    if (!value) return;
                    setDeliveryTagInput(level, value);
                    lists[level] = normalizeDeliveryTagList([...(lists[level] || []), value], DELIVERY_TAG_LEVELS[level].defaults);
                });
                saveDeliveryTagLists(lists);
                renderDeliveryTagControls();
            }

            if (source.inputFolder) addFolderHistory('deliveryInputFolder', source.inputFolder);
            if (source.outputFolder) addFolderHistory('deliveryOutputFolder', source.outputFolder);
            if (source.logoTemplateFolder || source.logoFolder) addFolderHistory('deliveryLogoFolder', source.logoTemplateFolder || source.logoFolder);

            deliveryConfigHydrated = true;
            if (options.fromSave === true) {
                deliveryDirtyFieldIds.clear();
            }
            updateDeliveryProcessModeUI();
            updateDeliveryTargetSizeUI();
            enforceDeliveryLegilSettings();
            updateDeliveryPreview(options);
        }

        function getDeliveryRuntimeConfigForResize(options = {}) {
            if (!deliveryConfigHydrated && options.force !== true) {
                return {};
            }
            const payload = buildDeliveryScanPayload();
            return {
                inputFolder: payload.inputFolder,
                outputFolder: payload.outputFolder,
                logoTemplateFolder: payload.logoTemplateFolder,
                processMode: payload.processMode,
                targetSizes: payload.targetSizes,
                deliveryCandidateCount: getDeliveryCandidateCount(),
                candidateCountPerSize: getDeliveryCandidateCount(),
                candidateCountsBySize: payload.candidateCountsBySize,
                fixedPromptTemplate: getDeliveryFixedPrompt(),
                promptTemplates: payload.promptTemplates,
                namingRule: payload.namingRule
            };
        }

        function buildDeliveryRuntimeConfigSaveBody() {
            return {
                ...getDeliveryRuntimeConfigForResize({ force: true }),
                browserMode: config.resizeBrowserMode || 'headless',
                promptTemplate: config.resizePromptTemplate || '',
                generationSettings: {
                    ...(config.resizeLegilGeneration || {}),
                    outputQuantity: Number(config.resizeLegilGeneration?.outputQuantity) || getDeliveryCandidateCount()
                }
            };
        }

        async function saveDeliveryRuntimeConfigDirect(options = {}) {
            if (!deliveryConfigHydrated && options.force !== true) {
                return true;
            }
            const res = await fetch('/api/config/resize', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(buildDeliveryRuntimeConfigSaveBody()),
                keepalive: options.keepalive === true
            });
            const data = await res.json().catch(() => null);
            if (!res.ok || !data || !data.success) {
                throw new Error((data && data.message) || '保存改尺寸交付配置失败');
            }
            if (data.config && typeof applyDeliveryRuntimeConfig === 'function' && options.applyResponse !== false) {
                applyDeliveryRuntimeConfig(data.config, { fromSave: true });
            }
            return true;
        }

        async function saveDeliveryRuntimeConfig(options = {}) {
            if (!deliveryConfigHydrated && options.force !== true && deliveryDirtyFieldIds.size === 0) {
                return true;
            }
            if (deliveryRuntimeSaveTimer) {
                clearTimeout(deliveryRuntimeSaveTimer);
                deliveryRuntimeSaveTimer = null;
            }
            if (options.direct === true || options.keepalive === true) {
                return saveDeliveryRuntimeConfigDirect(options);
            }
            if (typeof saveResizeConfig !== 'function') {
                return saveDeliveryRuntimeConfigDirect(options);
            }
            return saveResizeConfig({ silent: options.silent !== false });
        }

        function scheduleDeliveryRuntimeConfigSave() {
            if (!deliveryConfigHydrated && deliveryDirtyFieldIds.size === 0) return;
            if (deliveryRuntimeSaveTimer) clearTimeout(deliveryRuntimeSaveTimer);
            deliveryRuntimeSaveTimer = setTimeout(() => {
                saveDeliveryRuntimeConfig({ silent: true }).catch(() => {});
            }, 500);
        }

        function flushDeliveryRuntimeConfigBeforeUnload() {
            if (!deliveryConfigHydrated && deliveryDirtyFieldIds.size === 0) return;
            const body = JSON.stringify(buildDeliveryRuntimeConfigSaveBody());
            try {
                if (navigator.sendBeacon) {
                    const blob = new Blob([body], { type: 'application/json' });
                    navigator.sendBeacon('/api/config/resize', blob);
                    return;
                }
            } catch (e) {}
            try {
                fetch('/api/config/resize', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body,
                    keepalive: true
                });
            } catch (e) {}
        }

        function bindDeliveryBeforeUnloadSave() {
            if (deliveryBeforeUnloadBound) return;
            deliveryBeforeUnloadBound = true;
            window.addEventListener('beforeunload', flushDeliveryRuntimeConfigBeforeUnload);
        }

        function isDeliveryLegilOnlyMode() {
            return normalizeDeliveryProcessMode(config.deliveryProcessMode) === 'legil-only';
        }

        function normalizeDeliveryTargetSizes(value) {
            const rawValues = Array.isArray(value) ? value : (value ? [value] : []);
            const selected = rawValues
                .map(item => String(item || '').trim())
                .filter(size => DELIVERY_TARGET_SIZES.includes(size));
            const unique = DELIVERY_TARGET_SIZES.filter(size => selected.includes(size));
            return unique.length ? unique : [...DELIVERY_TARGET_SIZES];
        }

        function loadDeliveryTargetSizes() {
            try {
                const stored = JSON.parse(window.localStorage.getItem(DELIVERY_TARGET_SIZE_STORAGE_KEY) || '[]');
                return normalizeDeliveryTargetSizes(stored);
            } catch (e) {
                return normalizeDeliveryTargetSizes(config.deliveryTargetSizes || DELIVERY_TARGET_SIZES);
            }
        }

        function saveDeliveryTargetSizes(sizes) {
            config.deliveryTargetSizes = normalizeDeliveryTargetSizes(sizes);
            try {
                window.localStorage.setItem(DELIVERY_TARGET_SIZE_STORAGE_KEY, JSON.stringify(config.deliveryTargetSizes));
            } catch (e) {}
        }

        function getDeliveryTargetSizes() {
            return normalizeDeliveryTargetSizes(config.deliveryTargetSizes || loadDeliveryTargetSizes());
        }

        function normalizeDeliveryCandidateCount(value) {
            const count = Number(value);
            return DELIVERY_ALLOWED_CANDIDATE_COUNTS.includes(count) ? count : 1;
        }

        function getDeliveryUnifiedCandidateCount() {
            return normalizeDeliveryCandidateCount(
                config.resizeLegilGeneration?.outputQuantity || config.deliveryCandidateCount
            );
        }

        function buildUniformDeliveryCandidateCounts(count = getDeliveryUnifiedCandidateCount()) {
            const safeCount = normalizeDeliveryCandidateCount(count);
            return DELIVERY_TARGET_SIZES.reduce((counts, size) => {
                counts[size] = safeCount;
                return counts;
            }, {});
        }

        function loadDeliveryCandidateCountsBySize() {
            return buildUniformDeliveryCandidateCounts();
        }

        function saveDeliveryCandidateCountsBySize(counts) {
            const firstCount = counts && typeof counts === 'object'
                ? DELIVERY_TARGET_SIZES.map(size => counts[size]).find(Boolean)
                : counts;
            const safeCount = normalizeDeliveryCandidateCount(firstCount || getDeliveryUnifiedCandidateCount());
            config.deliveryCandidateCount = safeCount;
            if (config.resizeLegilGeneration) {
                config.resizeLegilGeneration.outputQuantity = safeCount;
            }
            config.deliveryCandidateCountsBySize = buildUniformDeliveryCandidateCounts(safeCount);
            try {
                window.localStorage.removeItem(DELIVERY_TARGET_COUNT_STORAGE_KEY);
            } catch (e) {}
        }

        function getDeliveryCandidateCountsBySize() {
            config.deliveryCandidateCountsBySize = buildUniformDeliveryCandidateCounts();
            return { ...config.deliveryCandidateCountsBySize };
        }

        function getDeliveryCandidateCountForSize(size) {
            return getDeliveryCandidateCount();
        }

        function setDeliverySelectedCandidateCount(count) {
            const safeCount = normalizeDeliveryCandidateCount(count);
            saveDeliveryCandidateCountsBySize(safeCount);
            config.deliveryCandidateCount = safeCount;
            updateDeliveryTargetSizeUI();
            updateDeliveryPreview();
            scheduleDeliveryRuntimeConfigSave();
            if (deliveryCurrentRun) {
                deliveryCurrentRun.candidateCountsBySize = getDeliveryCandidateCountsBySize();
                renderDeliveryJobs(deliveryCurrentRun);
            }
        }

        function bindDeliveryProcessModeOptions() {
            document.querySelectorAll('[data-delivery-process-mode]').forEach(button => {
                button.addEventListener('click', () => {
                    saveDeliveryProcessMode(button.dataset.deliveryProcessMode);
                    updateDeliveryProcessModeUI();
                    enforceDeliveryLegilSettings();
                    updateDeliveryPreview();
                    scheduleDeliveryRuntimeConfigSave();
                    if (deliveryCurrentRun) {
                        renderDeliveryJobs(deliveryCurrentRun);
                    }
                });
            });
            updateDeliveryProcessModeUI();
        }

        function updateDeliveryProcessModeUI() {
            const mode = normalizeDeliveryProcessMode(config.deliveryProcessMode);
            const legilOnly = mode === 'legil-only';
            const page = document.getElementById('deliveryPage');
            if (page) {
                page.classList.toggle('delivery-legil-only', legilOnly);
                page.dataset.deliveryProcessMode = mode;
            }

            document.querySelectorAll('button[data-delivery-process-mode]').forEach(button => {
                button.classList.toggle('active', button.dataset.deliveryProcessMode === mode);
            });

            if (legilOnly) {
                deliveryCurrentRun = null;
                renderDeliveryEmptyRow('固定提示词会直接调用 Legil 批量处理源图，不创建完整交付任务。');
            }

            document.querySelectorAll('[data-delivery-stage="standardize"], [data-delivery-stage="logo"], [data-delivery-stage="naming"], [data-delivery-stage="package"]').forEach(section => {
                section.setAttribute('aria-disabled', legilOnly ? 'true' : 'false');
                section.querySelectorAll('input, button, select, textarea').forEach(control => {
                    control.disabled = legilOnly;
                });
            });

            document.querySelectorAll('.delivery-logo-folder-field').forEach(section => {
                section.setAttribute('aria-disabled', legilOnly ? 'true' : 'false');
                section.querySelectorAll('input, button, select, textarea').forEach(control => {
                    control.disabled = legilOnly;
                });
            });

            const startButton = document.getElementById('deliveryStartBtn');
            if (startButton) {
                startButton.textContent = legilOnly ? '开始固定提示词' : '开始改尺寸交付';
                startButton.title = legilOnly ? '开始固定提示词' : '开始逐张生成三尺寸交付包';
            }
            const flowNote = document.getElementById('deliveryFlowNote');
            if (flowNote) {
                flowNote.textContent = legilOnly
                    ? '使用当前固定提示词逐张处理源图，只保存 Legil 候选图'
                    : '完整交付会逐张闭环输出 final-package，自动完成标准化、LOGO、命名和打包';
            }
            const promptTitle = document.getElementById('deliveryPromptBoxTitle');
            if (promptTitle) {
                promptTitle.textContent = legilOnly ? '固定提示词' : 'Legil 图生图提示词';
            }
            const promptDesc = document.getElementById('deliveryPromptBoxDesc');
            if (promptDesc) {
                promptDesc.textContent = legilOnly
                    ? '这里手动输入本次固定提示词；系统会按 Legil 生成参数里的宽高比和输出数量逐张处理源图。'
                    : '完整交付流程也会先使用这组提示词生成 Legil 候选图，随后继续标准化、LOGO、命名和打包。';
            }
            const fixedFields = document.getElementById('deliveryFixedPromptFields');
            if (fixedFields) fixedFields.hidden = !legilOnly;
            const fullFields = document.getElementById('deliveryFullPromptFields');
            if (fullFields) fullFields.hidden = legilOnly;
            document.querySelectorAll('.delivery-manual-postprocess-action').forEach(button => {
                button.hidden = true;
            });
            updateDeliveryConfigSummary();
        }

        function setDeliveryText(id, value) {
            const target = document.getElementById(id);
            if (target) target.textContent = value;
        }

        function getDeliveryImageModelLabel() {
            const currentModel = config.resizeLegilGeneration?.imageModel || 'gpt-image-2';
            const activeButton = Array.from(document.querySelectorAll('[data-resize-legil-setting="imageModel"]'))
                .find(button => button.classList.contains('active') || button.dataset.value === currentModel);
            const buttonLabel = activeButton?.querySelector('.model-option-title')?.textContent?.trim();
            if (buttonLabel) return buttonLabel;
            const fallbackMap = {
                'gpt-image-2': 'GPT-Image-2',
                'gpt-image-1': 'GPT-Image-1',
                'nano-banana-2': 'Nano Banana 2',
                'image-5-lite': 'GPT-Image-2'
            };
            return fallbackMap[currentModel] || currentModel || 'GPT-Image-2';
        }

        function updateDeliveryConfigSummary() {
            const selectedSizes = getDeliveryTargetSizes();
            const logoFolder = document.getElementById('deliveryLogoFolder')?.value.trim() || config.deliveryLogoFolder || '';
            const parts = getDeliveryNamingParts();
            setDeliveryText('deliverySummarySizes', selectedSizes.join(' / '));
            setDeliveryText('deliverySummaryModel', getDeliveryImageModelLabel());
            setDeliveryText('deliverySummaryStandardize', 'JPG / 390KB / 最低质量 60');
            setDeliveryText('deliverySummaryLogo', logoFolder ? '已配置' : '未配置');
            setDeliveryText('deliverySummaryNaming', `${parts.fixedPrefix || 'GOFCNIM'} + 编号 + ${parts.regionText || '区域'} + ${parts.channelText || '渠道'} + 标签`);
        }

        function bindDeliveryTargetSizeOptions() {
            config.deliveryTargetSizes = loadDeliveryTargetSizes();
            config.deliveryCandidateCountsBySize = loadDeliveryCandidateCountsBySize();

            document.querySelectorAll('[data-delivery-target-size]').forEach(button => {
                button.addEventListener('click', () => {
                    const size = button.dataset.deliveryTargetSize;
                    const current = new Set(getDeliveryTargetSizes());
                    if (current.has(size) && current.size > 1) {
                        current.delete(size);
                    } else {
                        current.add(size);
                    }
                    saveDeliveryTargetSizes(Array.from(current));
                    updateDeliveryTargetSizeUI();
                    enforceDeliveryLegilSettings();
                    updateDeliveryPreview();
                    scheduleDeliveryRuntimeConfigSave();
                    if (deliveryCurrentRun) {
                        deliveryCurrentRun.targetSizes = getDeliveryTargetSizes();
                        deliveryCurrentRun.candidateCountsBySize = getDeliveryCandidateCountsBySize();
                        renderDeliveryJobs(deliveryCurrentRun);
                    }
                });
            });

            renderDeliveryTargetCountOptions();
            updateDeliveryTargetSizeUI();
        }

        function renderDeliveryTargetCountOptions() {
            const container = document.getElementById('deliveryTargetCountOptions');
            if (!container) return;
            const counts = getDeliveryCandidateCountsBySize();
            container.textContent = '';

            DELIVERY_TARGET_SIZES.forEach(size => {
                const row = document.createElement('div');
                row.className = 'delivery-size-count-row';
                row.dataset.deliverySizeCountRow = size;

                const label = document.createElement('span');
                label.className = 'delivery-size-count-label';
                label.textContent = `${size} / ${DELIVERY_TARGET_ASPECT_RATIOS[size]}`;
                row.appendChild(label);

                const options = document.createElement('div');
                options.className = 'delivery-size-count-options';
                DELIVERY_ALLOWED_CANDIDATE_COUNTS.forEach(count => {
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.className = 'setting-option';
                    button.dataset.deliveryTargetCountSize = size;
                    button.dataset.deliveryTargetCount = String(count);
                    button.textContent = `${count}`;
                    button.addEventListener('click', () => {
                        const nextCounts = getDeliveryCandidateCountsBySize();
                        nextCounts[size] = count;
                        saveDeliveryCandidateCountsBySize(nextCounts);
                        config.deliveryCandidateCount = count;
                        if (config.resizeLegilGeneration) {
                            config.resizeLegilGeneration.outputQuantity = count;
                        }
                        updateDeliveryTargetSizeUI();
                        enforceDeliveryLegilSettings();
                        updateDeliveryPreview();
                        scheduleDeliveryRuntimeConfigSave();
                        if (deliveryCurrentRun) {
                            deliveryCurrentRun.candidateCountsBySize = getDeliveryCandidateCountsBySize();
                            renderDeliveryJobs(deliveryCurrentRun);
                        }
                    });
                    options.appendChild(button);
                });
                row.appendChild(options);
                container.appendChild(row);
            });
        }

        function updateDeliveryTargetSizeUI() {
            const legilOnly = isDeliveryLegilOnlyMode();
            const selectedSizes = getDeliveryTargetSizes();
            const counts = getDeliveryCandidateCountsBySize();
            document.querySelectorAll('[data-delivery-target-size]').forEach(button => {
                button.classList.toggle('active', selectedSizes.includes(button.dataset.deliveryTargetSize));
                button.disabled = legilOnly;
                button.setAttribute('aria-disabled', legilOnly ? 'true' : 'false');
            });
            document.querySelectorAll('[data-delivery-size-count-row]').forEach(row => {
                const size = row.dataset.deliverySizeCountRow;
                row.classList.toggle('is-disabled', legilOnly || !selectedSizes.includes(size));
            });
            document.querySelectorAll('[data-delivery-target-count-size]').forEach(button => {
                const size = button.dataset.deliveryTargetCountSize;
                const count = Number(button.dataset.deliveryTargetCount);
                const selected = selectedSizes.includes(size);
                button.classList.toggle('active', selected && counts[size] === count);
                button.disabled = legilOnly || !selected;
            });
            updateDeliveryConfigSummary();
        }

        function bindDeliveryCandidateOptions() {
            document.querySelectorAll('[data-delivery-candidates]').forEach(button => {
                button.addEventListener('click', () => {
                    const count = Number(button.dataset.deliveryCandidates) || 4;
                    setDeliverySelectedCandidateCount(count);
                    document.querySelectorAll('[data-delivery-candidates]').forEach(item => {
                        item.classList.toggle('active', item === button);
                    });
                });
            });
        }

        function enforceDeliveryLegilSettings() {
            if (!config.resizeLegilGeneration) {
                config.resizeLegilGeneration = {};
            }
            if (isDeliveryLegilOnlyMode()) {
                const currentRatios = getDeliveryFixedAspectRatios();
                config.resizeLegilGeneration.aspectRatio = currentRatios[0];
                config.resizeLegilGeneration.aspectRatios = [currentRatios[0]];
                document.querySelectorAll('[data-resize-legil-setting="outputQuantity"]').forEach(button => {
                    const value = Number(button.dataset.value);
                    const allowed = DELIVERY_ALLOWED_CANDIDATE_COUNTS.includes(value);
                    button.hidden = !allowed;
                    button.disabled = !allowed;
                });
                document.querySelectorAll('[data-resize-legil-setting="aspectRatio"]').forEach(button => {
                    button.hidden = false;
                    button.disabled = false;
                    button.title = '固定提示词会使用这里选择的 Legil 宽高比';
                });
                if (typeof updateResizeLegilGenerationActiveStates === 'function') {
                    updateResizeLegilGenerationActiveStates();
                }
                if (typeof refreshResizeLegilGenerationSummary === 'function') {
                    refreshResizeLegilGenerationSummary();
                }
                updateDeliveryTargetSizeUI();
                return;
            }
            const targetSizes = getDeliveryTargetSizes();
            const fixedRatios = targetSizes.map(size => DELIVERY_TARGET_ASPECT_RATIOS[size]).filter(Boolean);
            const primaryCount = getDeliveryUnifiedCandidateCount();
            config.resizeLegilGeneration.aspectRatios = fixedRatios;
            config.resizeLegilGeneration.aspectRatio = fixedRatios[0];
            config.resizeLegilGeneration.outputQuantity = primaryCount;
            config.deliveryCandidateCount = primaryCount;
            config.deliveryCandidateCountsBySize = buildUniformDeliveryCandidateCounts(primaryCount);

            document.querySelectorAll('[data-resize-legil-setting="outputQuantity"]').forEach(button => {
                const value = Number(button.dataset.value);
                const allowed = DELIVERY_ALLOWED_CANDIDATE_COUNTS.includes(value);
                button.hidden = !allowed;
                button.disabled = !allowed;
            });
            document.querySelectorAll('[data-resize-legil-setting="aspectRatio"]').forEach(button => {
                const value = String(button.dataset.value || '');
                const fixed = fixedRatios.includes(value);
                button.classList.toggle('active', fixed);
                button.disabled = true;
                button.title = fixed ? '当前目标尺寸使用该比例' : '未选目标尺寸不使用该比例';
                button.hidden = !DELIVERY_TARGET_SIZES.map(size => DELIVERY_TARGET_ASPECT_RATIOS[size]).includes(value);
            });
            if (typeof updateResizeLegilGenerationActiveStates === 'function') {
                updateResizeLegilGenerationActiveStates();
            }
            if (typeof refreshResizeLegilGenerationSummary === 'function') {
                refreshResizeLegilGenerationSummary();
            }
            updateDeliveryTargetSizeUI();
        }

        function normalizeDeliveryTagList(values, defaults = []) {
            const rawValues = Array.isArray(values) ? values : [];
            const merged = [...defaults, ...rawValues]
                .map(item => String(item || '').trim())
                .filter(Boolean);
            return [...new Set(merged)];
        }

        function normalizeDeliveryTagLists(source = {}) {
            const next = {};
            Object.keys(DELIVERY_TAG_LEVELS).forEach(level => {
                const meta = DELIVERY_TAG_LEVELS[level];
                next[level] = normalizeDeliveryTagList(source[level], meta.defaults);
            });
            return next;
        }

        function loadDeliveryTagLists() {
            try {
                const stored = JSON.parse(window.localStorage.getItem(DELIVERY_TAG_STORAGE_KEY) || '{}');
                return normalizeDeliveryTagLists(stored && typeof stored === 'object' ? stored : config.deliveryTagLists);
            } catch (e) {
                return normalizeDeliveryTagLists(config.deliveryTagLists);
            }
        }

        function saveDeliveryTagLists(lists) {
            config.deliveryTagLists = normalizeDeliveryTagLists(lists);
            try {
                window.localStorage.setItem(DELIVERY_TAG_STORAGE_KEY, JSON.stringify(config.deliveryTagLists));
            } catch (e) {}
        }

        function getDeliveryTagLists() {
            if (!config.deliveryTagLists) {
                config.deliveryTagLists = loadDeliveryTagLists();
            }
            return normalizeDeliveryTagLists(config.deliveryTagLists);
        }

        function getDeliveryTagInput(level) {
            const meta = DELIVERY_TAG_LEVELS[level];
            if (!meta) return '';
            return document.getElementById(meta.inputId)?.value.trim() || '';
        }

        function setDeliveryTagInput(level, value) {
            const meta = DELIVERY_TAG_LEVELS[level];
            if (!meta) return;
            const input = document.getElementById(meta.inputId);
            if (input) input.value = value || '';
            config[meta.configKey] = String(value || '').trim();
        }

        function closeDeliveryTagMenus(exceptLevel = '') {
            Object.keys(DELIVERY_TAG_LEVELS).forEach(level => {
                if (exceptLevel && level === exceptLevel) return;
                const meta = DELIVERY_TAG_LEVELS[level];
                document.getElementById(meta.menuId)?.classList.remove('active');
                document.getElementById(meta.buttonId)?.classList.remove('active');
            });
        }

        function renderDeliveryTagMenu(level) {
            const meta = DELIVERY_TAG_LEVELS[level];
            if (!meta) return;
            const menu = document.getElementById(meta.menuId);
            if (!menu) return;

            const values = getDeliveryTagLists()[level] || [];
            const selectedValue = getDeliveryTagInput(level);
            menu.innerHTML = '';

            if (values.length === 0) {
                const empty = document.createElement('div');
                empty.className = 'rename-tag-empty';
                empty.textContent = '暂无候选标签';
                menu.appendChild(empty);
                return;
            }

            values.forEach(value => {
                const item = document.createElement('div');
                item.className = 'rename-tag-item';
                if (value === selectedValue) item.classList.add('active');
                item.setAttribute('role', 'button');
                item.tabIndex = 0;
                item.addEventListener('mousedown', event => event.preventDefault());
                item.addEventListener('click', () => selectDeliveryTag(level, value));

                const label = document.createElement('span');
                label.className = 'rename-tag-label';
                label.textContent = value;
                item.appendChild(label);

                const deleteButton = document.createElement('button');
                deleteButton.type = 'button';
                deleteButton.className = 'rename-tag-delete';
                deleteButton.textContent = '删除';
                deleteButton.addEventListener('click', event => {
                    event.stopPropagation();
                    deleteDeliveryTag(level, value);
                });
                item.appendChild(deleteButton);
                menu.appendChild(item);
            });
        }

        function renderDeliveryTagControls() {
            Object.keys(DELIVERY_TAG_LEVELS).forEach(level => renderDeliveryTagMenu(level));
        }

        function initDeliveryTagControls() {
            const lists = loadDeliveryTagLists();
            saveDeliveryTagLists(lists);
            Object.keys(DELIVERY_TAG_LEVELS).forEach(level => {
                const meta = DELIVERY_TAG_LEVELS[level];
                const current = config[meta.configKey] || document.getElementById(meta.inputId)?.value.trim() || '';
                const fallback = current || lists[level]?.[0] || '';
                setDeliveryTagInput(level, fallback);
            });
            renderDeliveryTagControls();
        }

        function toggleDeliveryTagMenu(level) {
            const meta = DELIVERY_TAG_LEVELS[level];
            if (!meta) return;
            renderDeliveryTagMenu(level);
            closeDeliveryTagMenus(level);
            document.getElementById(meta.menuId)?.classList.toggle('active');
            document.getElementById(meta.buttonId)?.classList.toggle('active');
        }

        function selectDeliveryTag(level, value) {
            setDeliveryTagInput(level, value);
            closeDeliveryTagMenus();
            updateDeliveryPreview();
            scheduleDeliveryRuntimeConfigSave();
        }

        function addDeliveryTag(level) {
            const meta = DELIVERY_TAG_LEVELS[level];
            if (!meta) return;
            const value = getDeliveryTagInput(level);
            if (!value) {
                showToast(`请输入${meta.label}`, 'error');
                return;
            }
            const lists = getDeliveryTagLists();
            lists[level] = normalizeDeliveryTagList([...(lists[level] || []), value], meta.defaults);
            saveDeliveryTagLists(lists);
            setDeliveryTagInput(level, value);
            renderDeliveryTagControls();
            updateDeliveryPreview();
            scheduleDeliveryRuntimeConfigSave();
            showToast(`${meta.label}已添加`);
        }

        function deleteDeliveryTag(level, value) {
            const meta = DELIVERY_TAG_LEVELS[level];
            if (!meta) return;
            const lists = getDeliveryTagLists();
            lists[level] = (lists[level] || []).filter(item => item !== value);
            saveDeliveryTagLists(lists);
            if (getDeliveryTagInput(level) === value) {
                setDeliveryTagInput(level, lists[level]?.[0] || '');
            }
            renderDeliveryTagControls();
            updateDeliveryPreview();
            scheduleDeliveryRuntimeConfigSave();
            showToast(`${meta.label}已删除`);
        }

        function bindDeliveryNamingPreview() {
            [
                'deliveryInputFolder',
                'deliveryOutputFolder',
                'deliveryLogoFolder',
                'deliveryNamingPrefix',
                'deliveryStartNumber',
                'deliveryRegionText',
                'deliveryChannelText',
                'deliveryPrimaryTagInput',
                'deliverySecondaryTagInput',
                'deliveryTertiaryTagInput'
            ].forEach(inputId => {
                const input = document.getElementById(inputId);
                if (!input) return;
                input.addEventListener('input', () => {
                    markDeliveryFieldDirty(inputId);
                    config[inputId] = input.value.trim();
                    Object.values(DELIVERY_TAG_LEVELS).forEach(meta => {
                        if (meta.inputId === inputId) {
                            config[meta.configKey] = input.value.trim();
                        }
                    });
                    updateDeliveryPreview();
                    scheduleDeliveryRuntimeConfigSave();
                    saveDeliveryRuntimeConfig({
                        silent: true,
                        force: true,
                        direct: true,
                        keepalive: true,
                        applyResponse: false
                    }).catch(() => {});
                });
                const saveImmediately = () => {
                    markDeliveryFieldDirty(inputId);
                    config[inputId] = input.value.trim();
                    Object.values(DELIVERY_TAG_LEVELS).forEach(meta => {
                        if (meta.inputId === inputId) {
                            config[meta.configKey] = input.value.trim();
                        }
                    });
                    updateDeliveryPreview();
                    saveDeliveryRuntimeConfig({ silent: true, force: true, direct: true }).catch(() => {});
                };
                input.addEventListener('change', saveImmediately);
                input.addEventListener('blur', saveImmediately);
            });

            [
                'deliveryFixedPrompt',
                'deliveryPromptCommon',
                'deliveryPrompt800',
                'deliveryPrompt1280',
                'deliveryPrompt1080'
            ].forEach(inputId => {
                const input = document.getElementById(inputId);
                if (!input) return;
                input.addEventListener('input', () => {
                    markDeliveryFieldDirty(inputId);
                    updateDeliveryPreview();
                    scheduleDeliveryRuntimeConfigSave();
                });
                const savePromptImmediately = () => {
                    markDeliveryFieldDirty(inputId);
                    updateDeliveryPreview();
                    saveDeliveryRuntimeConfig({ silent: true, force: true, direct: true }).catch(() => {});
                };
                input.addEventListener('change', savePromptImmediately);
                input.addEventListener('blur', savePromptImmediately);
            });
        }

        function bindDeliveryActions() {
            const previewButton = document.getElementById('deliveryPreviewBtn');
            if (previewButton) {
                previewButton.addEventListener('click', () => scanDeliveryInputFolder());
            }

            const startButton = document.getElementById('deliveryStartBtn');
            if (startButton) {
                startButton.addEventListener('click', () => startDeliveryCandidateGeneration());
            }

            const resumeButton = document.getElementById('deliveryResumeBtn');
            if (resumeButton) {
                resumeButton.addEventListener('click', () => startDeliveryCandidateGeneration({ resume: true }));
            }

            const retryFailedButton = document.getElementById('deliveryRetryFailedBtn');
            if (retryFailedButton) {
                retryFailedButton.addEventListener('click', () => retryAllFailedDeliveryTargets());
            }

            const stopButton = document.getElementById('deliveryStopBtn');
            if (stopButton) {
                stopButton.addEventListener('click', () => stopDeliveryCandidateGeneration());
            }

            const standardizeButton = document.getElementById('deliveryStandardizeBtn');
            if (standardizeButton) {
                standardizeButton.addEventListener('click', () => standardizeDeliveryAllCandidates());
            }

            const finalizeButton = document.getElementById('deliveryFinalizeBtn');
            if (finalizeButton) {
                finalizeButton.addEventListener('click', () => requestDeliveryFinalize());
            }
        }

        function getDeliveryNamingParts() {
            const read = id => document.getElementById(id)?.value.trim() || '';
            const tagLevels = [
                getDeliveryTagInput('primary') || read('deliveryPrimaryTag') || '题材',
                getDeliveryTagInput('secondary') || read('deliverySecondaryTag') || '载具',
                getDeliveryTagInput('tertiary') || read('deliveryTertiaryTag')
            ].map(item => String(item || '').trim()).filter(Boolean);
            return {
                fixedPrefix: read('deliveryNamingPrefix') || 'GOFCNIM',
                prefix: read('deliveryNamingPrefix') || 'GOFCNIM',
                startNumber: read('deliveryStartNumber') || '28930',
                regionText: read('deliveryRegionText') || 'BJ',
                channelText: read('deliveryChannelText') || '广点通',
                primaryTag: tagLevels[0] || '',
                secondaryTag: tagLevels[1] || '',
                tertiaryTag: tagLevels[2] || '',
                tagLevels
            };
        }

        function buildDeliveryBaseName() {
            const parts = getDeliveryNamingParts();
            const exampleBusinessParts = [...(parts.tagLevels || [])];
            if (exampleBusinessParts.length < 3) exampleBusinessParts.push('三级标签');
            if (exampleBusinessParts.length < 4) exampleBusinessParts.push('细分命名');
            return [
                `${parts.fixedPrefix}${parts.startNumber}`,
                parts.regionText,
                parts.channelText,
                ...exampleBusinessParts
            ].filter(Boolean).join('_');
        }

        function buildDeliveryScanPayload() {
            const inputFolder = document.getElementById('deliveryInputFolder')?.value.trim() || config.deliveryInputFolder || '';
            const outputFolder = document.getElementById('deliveryOutputFolder')?.value.trim() || config.deliveryOutputFolder || '';
            const logoTemplateFolder = document.getElementById('deliveryLogoFolder')?.value.trim() || config.deliveryLogoFolder || 'D:\\工作\\GOF\\LOGO模版';
            config.deliveryInputFolder = inputFolder;
            config.deliveryOutputFolder = outputFolder;
            config.deliveryLogoFolder = logoTemplateFolder;
            return {
                inputFolder,
                outputFolder,
                logoTemplateFolder,
                processMode: normalizeDeliveryProcessMode(config.deliveryProcessMode),
                targetSizes: getDeliveryTargetSizes(),
                candidateCountPerSize: getDeliveryCandidateCount(),
                candidateCountsBySize: getDeliveryCandidateCountsBySize(),
                promptTemplates: getDeliveryPromptTemplates(),
                namingRule: getDeliveryNamingParts()
            };
        }

        function getDeliveryPromptTemplates() {
            return {
                common: document.getElementById('deliveryPromptCommon')?.value.trim() || '',
                '800x800': document.getElementById('deliveryPrompt800')?.value.trim() || '',
                '1280x720': document.getElementById('deliveryPrompt1280')?.value.trim() || '',
                '1080x1920': document.getElementById('deliveryPrompt1080')?.value.trim() || ''
            };
        }

        function getDeliveryFixedPrompt() {
            return document.getElementById('deliveryFixedPrompt')?.value.trim() || '';
        }

        function getDeliveryFixedAspectRatios() {
            const settings = config.resizeLegilGeneration || {};
            const rawValues = Array.isArray(settings.aspectRatios) && settings.aspectRatios.length
                ? settings.aspectRatios
                : [settings.aspectRatio || '1:1'];
            const seen = new Set();
            const ratios = rawValues
                .map(value => String(value || '').trim())
                .filter(Boolean)
                .filter(value => {
                    if (seen.has(value)) return false;
                    seen.add(value);
                    return true;
                });
            return ratios.length ? ratios : ['1:1'];
        }

        function getDeliveryFixedGenerationSettings() {
            const aspectRatios = getDeliveryFixedAspectRatios();
            return {
                ...(config.resizeLegilGeneration || {}),
                aspectRatio: aspectRatios[0],
                aspectRatios,
                outputQuantity: Number(config.resizeLegilGeneration?.outputQuantity) || 1
            };
        }

        function buildDeliveryStartPayload(options = {}) {
            enforceDeliveryLegilSettings();
            const scanPayload = buildDeliveryScanPayload();
            return {
                ...scanPayload,
                runId: options.runId || deliveryCurrentRun?.runId || '',
                jobId: options.jobId || '',
                targetSize: options.targetSize || '',
                force: options.force === true,
                failedOnly: options.failedOnly === true,
                browserMode: config.resizeBrowserMode || 'headless',
                candidateCountPerSize: getDeliveryCandidateCount(),
                candidateCountsBySize: getDeliveryCandidateCountsBySize(),
                generationSettings: {
                    ...(config.resizeLegilGeneration || {}),
                    aspectRatios: getDeliverySelectedRatios(),
                    aspectRatio: getDeliverySelectedRatios()[0],
                    outputQuantity: getDeliveryCandidateCount()
                },
                promptTemplates: getDeliveryPromptTemplates()
            };
        }

        function getDeliveryStandardizePayload() {
            return {
                maxOutputBytes: 390 * 1024,
                minQuality: 60
            };
        }

        function updateDeliveryPreview(options = {}) {
            const baseName = buildDeliveryBaseName();
            const folderExample = document.getElementById('deliveryFolderNameExample');
            const imageExample = document.getElementById('deliveryImageNameExample');
            if (folderExample) folderExample.textContent = baseName;
            if (imageExample) imageExample.textContent = `${baseName}_800x800.jpg`;

            const inputFolder = document.getElementById('deliveryInputFolder')?.value.trim() || config.deliveryInputFolder || '';
            const outputFolder = document.getElementById('deliveryOutputFolder')?.value.trim() || config.deliveryOutputFolder || '';
            config.deliveryInputFolder = inputFolder;
            config.deliveryOutputFolder = outputFolder;

            const info = document.getElementById('deliveryInfo');
            if (info && !options.keepInfo) {
                const logoFolder = document.getElementById('deliveryLogoFolder')?.value.trim() || config.deliveryLogoFolder || '';
                info.className = inputFolder && outputFolder ? 'info-box success' : 'info-box';
                const selectedSizes = getDeliveryTargetSizes();
                const selectedRatios = getDeliverySelectedRatios();
                const candidateSummary = `${getDeliveryCandidateCount()}张/比例`;
                const modeText = isDeliveryLegilOnlyMode()
                    ? `固定提示词；使用 Legil 参数宽高比 ${getDeliveryFixedAspectRatios().join('、')}，输出 ${Number(config.resizeLegilGeneration?.outputQuantity) || 1} 张/比例`
                    : `完整交付流程；LOGO 模板目录 ${logoFolder ? '已填写' : '未填写'}`;
                info.textContent = inputFolder && outputFolder
                    ? (isDeliveryLegilOnlyMode()
                        ? `已填写输入输出；${modeText}；点击扫描源图统计图片数量。`
                        : `已填写输入输出；${modeText}；目标尺寸 ${selectedSizes.join('、')}；比例 ${selectedRatios.join('、')}；候选 ${candidateSummary}。点击扫描源图生成真实任务。`)
                    : '请先填写源图文件夹和交付输出文件夹。';
            }
            updateDeliveryConfigSummary();
        }

        async function loadLatestDeliveryRun() {
            if (isDeliveryLegilOnlyMode()) return;
            const inputFolder = document.getElementById('deliveryInputFolder')?.value.trim() || config.deliveryInputFolder || '';
            if (!inputFolder) return;
            try {
                const query = new URLSearchParams({ inputFolder });
                const res = await fetch(`/api/delivery/status?${query.toString()}`);
                const data = await res.json();
                if (data.success && data.hasRun && data.run) {
                    deliveryRunTaskActive = Boolean(data.task && data.task.running);
                    deliveryCurrentRun = data.run;
                    renderDeliveryJobs(data.run);
                    setDeliveryInfoForRun(data.run, '已载入上次扫描的交付任务。');
                    if (data.task && data.task.running) {
                        startDeliveryStatusPolling(data.run.runId);
                    }
                }
            } catch (error) {
                console.warn('加载改尺寸交付状态失败:', error);
            }
        }

        async function scanDeliveryInputFolder() {
            if (deliveryScanning) return;
            const payload = buildDeliveryScanPayload();
            if (!payload.inputFolder || !payload.outputFolder) {
                updateDeliveryPreview();
                showToast('请先填写源图文件夹和交付输出文件夹', 'error');
                return;
            }
            await saveDeliveryRuntimeConfig({ silent: true, force: true });

            const scanButton = document.getElementById('deliveryPreviewBtn');
            const originalText = scanButton ? scanButton.textContent : '';
            const info = document.getElementById('deliveryInfo');
            deliveryScanning = true;
            if (scanButton) {
                scanButton.disabled = true;
                scanButton.textContent = '扫描中';
            }
            if (info) {
                info.className = 'info-box loading';
                info.textContent = isDeliveryLegilOnlyMode()
                    ? '正在统计源图文件夹中的图片数量...'
                    : '正在扫描源图文件夹，并写入交付任务记录...';
            }

            try {
                if (isDeliveryLegilOnlyMode()) {
                    const res = await fetch('/api/count-images', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ folderPath: payload.inputFolder })
                    });
                    const data = await res.json();
                    if (!res.ok || !data.success) {
                        throw new Error(data.message || '扫描源图失败');
                    }
                    deliveryRunTaskActive = false;
                    deliveryCurrentRun = null;
                    renderDeliveryEmptyRow(`固定提示词将直接调用 Legil 批量处理 ${data.count || 0} 张源图，不创建完整交付任务。`);
                    if (info) {
                        info.className = 'info-box success';
                        info.textContent = `已扫描 ${data.count || 0} 张源图；固定提示词会使用 Legil 参数里的宽高比 ${getDeliveryFixedAspectRatios().join('、')} 和输出数量 ${Number(config.resizeLegilGeneration?.outputQuantity) || 1} 张。`;
                    }
                    if (typeof addFolderHistory === 'function') {
                        addFolderHistory('deliveryInputFolder', payload.inputFolder);
                        addFolderHistory('deliveryOutputFolder', payload.outputFolder);
                    }
                    showToast(`已扫描 ${data.count || 0} 张源图`);
                    return;
                }
                const res = await fetch('/api/delivery/scan', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const data = await res.json();
                if (!res.ok || !data.success) {
                    throw new Error(data.message || '扫描源图失败');
                }

                deliveryRunTaskActive = false;
                deliveryCurrentRun = data.run;
                renderDeliveryJobs(data.run);
                setDeliveryInfoForRun(data.run, data.message || '扫描完成。');
                if (typeof addFolderHistory === 'function') {
                    addFolderHistory('deliveryInputFolder', payload.inputFolder);
                    addFolderHistory('deliveryOutputFolder', payload.outputFolder);
                    addFolderHistory('deliveryLogoFolder', payload.logoTemplateFolder);
                }
                showToast(`已扫描 ${data.totalJobs || 0} 张源图`);
            } catch (error) {
                if (info) {
                    info.className = 'info-box error';
                    info.textContent = error.message;
                }
                renderDeliveryEmptyRow(error.message || '扫描失败');
                showToast(error.message || '扫描源图失败', 'error');
            } finally {
                deliveryScanning = false;
                if (scanButton) {
                    scanButton.disabled = false;
                    scanButton.textContent = originalText || '扫描源图';
                }
            }
        }

        function setDeliveryActionButtonsRunning(running) {
            deliveryRunTaskActive = running;
            const startButton = document.getElementById('deliveryStartBtn');
            const resumeButton = document.getElementById('deliveryResumeBtn');
            const retryFailedButton = document.getElementById('deliveryRetryFailedBtn');
            const stopButton = document.getElementById('deliveryStopBtn');
            if (startButton) startButton.disabled = running;
            if (resumeButton) resumeButton.disabled = running;
            if (retryFailedButton) retryFailedButton.disabled = running || (getDeliveryRunTargetStats(deliveryCurrentRun).failed || 0) === 0;
            if (stopButton) stopButton.disabled = !running;
        }

        async function startDeliveryFixedPromptGeneration(options = {}) {
            const inputFolder = document.getElementById('deliveryInputFolder')?.value.trim() || config.deliveryInputFolder || '';
            const outputFolder = document.getElementById('deliveryOutputFolder')?.value.trim() || config.deliveryOutputFolder || '';
            const promptTemplate = getDeliveryFixedPrompt();
            const info = document.getElementById('deliveryInfo');

            if (!inputFolder || !outputFolder) {
                updateDeliveryPreview();
                showToast('请先填写源图文件夹和交付输出文件夹', 'error');
                return;
            }
            if (!promptTemplate) {
                if (info) {
                    info.className = 'info-box error';
                    info.textContent = '请填写本次要发送给 Legil 的固定提示词。';
                }
                showToast('请填写固定提示词', 'error');
                return;
            }

            config.deliveryInputFolder = inputFolder;
            config.deliveryOutputFolder = outputFolder;
            if (typeof addFolderHistory === 'function') {
                addFolderHistory('deliveryInputFolder', inputFolder);
                addFolderHistory('deliveryOutputFolder', outputFolder);
            }
            await saveDeliveryRuntimeConfig({ silent: true, force: true });

            setDeliveryActionButtonsRunning(true);
            if (info) {
                info.className = 'info-box loading';
                info.textContent = options.resume
                    ? '已提交固定提示词继续任务...'
                    : '已提交固定提示词任务：系统会按源图顺序逐张发送到 Legil...';
            }

            try {
                const res = await fetch('/api/legil/resize-batch', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        inputFolder,
                        outputFolder,
                        browserMode: config.resizeBrowserMode || 'headless',
                        promptTemplate,
                        generationSettings: getDeliveryFixedGenerationSettings(),
                        resumeMode: options.resume === true
                    })
                });
                const data = await res.json();
                if (!res.ok || !data.success) {
                    throw new Error(data.message || '启动固定提示词失败');
                }
                if (info) {
                    info.className = 'info-box loading';
                    info.textContent = data.message || '固定提示词已启动。';
                }
                showToast(data.message || '固定提示词已启动');
                startDeliveryFixedStatusPolling();
            } catch (error) {
                if (info) {
                    info.className = 'info-box error';
                    info.textContent = error.message;
                }
                showToast(error.message || '启动固定提示词失败', 'error');
                restoreDeliveryActionButtons();
            }
        }

        async function startDeliveryCandidateGeneration(options = {}) {
            const info = document.getElementById('deliveryInfo');
            if (isDeliveryLegilOnlyMode()) {
                await startDeliveryFixedPromptGeneration(options);
                return;
            }
            if (!deliveryCurrentRun && !options.runId) {
                await scanDeliveryInputFolder();
            }
            const payload = buildDeliveryStartPayload({
                ...options,
                runId: options.runId || deliveryCurrentRun?.runId || ''
            });
            if (!payload.runId) {
                showToast('请先扫描源图，建立交付任务', 'error');
                return;
            }
            await saveDeliveryRuntimeConfig({ silent: true, force: true });

            const endpoint = options.failedOnly
                ? `/api/delivery/runs/${encodeURIComponent(payload.runId)}/retry-failed`
                : (options.resume ? '/api/delivery/resume' : '/api/delivery/start');
            const isFullDeliveryStart = !options.jobId && !options.targetSize && !isDeliveryLegilOnlyMode();
            const startButton = document.getElementById('deliveryStartBtn');
            const resumeButton = document.getElementById('deliveryResumeBtn');
            const stopButton = document.getElementById('deliveryStopBtn');
            setDeliveryActionButtonsRunning(true);
            if (info) {
                info.className = 'info-box loading';
                info.textContent = options.failedOnly
                    ? '已提交全部失败任务补跑，系统只会重跑失败尺寸...'
                    : options.jobId
                    ? (isDeliveryLegilOnlyMode()
                        ? '已提交当前源图的固定提示词任务...'
                        : '已提交当前源图的改尺寸候选生成任务...')
                    : (isFullDeliveryStart
                        ? '已提交逐张闭环改尺寸交付任务：后端会完成一张输出一张...'
                        : '已提交固定提示词任务：系统会按源图顺序逐张发送到 Legil...');
            }

            try {
                const res = await fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const data = await res.json();
                if (!res.ok || !data.success) {
                    throw new Error(data.message || '启动改尺寸任务失败');
                }
                if (data.run) {
                    deliveryCurrentRun = data.run;
                    renderDeliveryJobs(data.run);
                }
                if (info) {
                    info.className = data.totalTargets === 0 ? 'info-box success' : 'info-box loading';
                    info.textContent = data.message || '改尺寸候选生成已启动。';
                }
                showToast(data.message || '已启动改尺寸任务');
                if (data.totalTargets !== 0 || data.postprocess) {
                    startDeliveryStatusPolling(payload.runId);
                } else {
                    restoreDeliveryActionButtons();
                }
            } catch (error) {
                if (info) {
                    info.className = 'info-box error';
                    info.textContent = error.message;
                }
                showToast(error.message || '启动改尺寸任务失败', 'error');
                restoreDeliveryActionButtons();
            }
        }

        async function stopDeliveryCandidateGeneration() {
            const stopButton = document.getElementById('deliveryStopBtn');
            if (stopButton) stopButton.disabled = true;
            try {
                const endpoint = isDeliveryLegilOnlyMode() ? '/api/legil/stop' : '/api/delivery/stop';
                const res = await fetch(endpoint, { method: 'POST' });
                const data = await res.json();
                showToast(data.message || '已发送停止指令');
            } catch (error) {
                showToast(error.message || '停止改尺寸任务失败', 'error');
            }
        }

        async function selectDeliveryCandidate(runId, jobId, targetSize, candidateId) {
            const info = document.getElementById('deliveryInfo');
            try {
                const res = await fetch(`/api/delivery/runs/${encodeURIComponent(runId)}/select-candidate`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ jobId, targetSize, candidateId })
                });
                const data = await res.json();
                if (!res.ok || !data.success) {
                    throw new Error(data.message || '选择候选图失败');
                }
                deliveryCurrentRun = data.run;
                renderDeliveryJobs(data.run);
                setDeliveryInfoForRun(data.run, data.message || '已选择候选图。');
                showToast(data.message || '已选择候选图');
            } catch (error) {
                if (info) {
                    info.className = 'info-box error';
                    info.textContent = error.message;
                }
                showToast(error.message || '选择候选图失败', 'error');
            }
        }

        async function standardizeDeliveryAllCandidates(options = {}) {
            const runId = options.runId || deliveryCurrentRun?.runId || '';
            const info = document.getElementById('deliveryInfo');
            if (!runId) {
                showToast('请先扫描并生成候选图', 'error');
                return;
            }

            const button = document.getElementById('deliveryStandardizeBtn');
            const originalText = button ? button.textContent : '';
            if (button) {
                button.disabled = true;
                button.textContent = '标准化中';
            }
            if (info) {
                info.className = 'info-box loading';
                info.textContent = '正在把全部候选图标准化为精确尺寸 JPG，并压缩到 390KB 内...';
            }

            try {
                const res = await fetch(`/api/delivery/runs/${encodeURIComponent(runId)}/standardize`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        ...getDeliveryStandardizePayload(),
                        jobId: options.jobId || ''
                    })
                });
                const data = await res.json();
                if (!res.ok || !data.success) {
                    throw new Error(data.message || '标准化失败');
                }
                deliveryCurrentRun = data.run;
                renderDeliveryJobs(data.run);
                if (info) {
                    info.className = 'info-box success';
                    info.textContent = data.message || `已标准化 ${data.standardizedCount || 0} 张。`;
                }
                showToast(data.message || '标准化完成');
                return data;
            } catch (error) {
                if (info) {
                    info.className = 'info-box error';
                    info.textContent = error.message;
                }
                showToast(error.message || '标准化失败', 'error');
                checkDeliveryRunStatus(runId);
                return null;
            } finally {
                if (button) {
                    button.disabled = false;
                    button.textContent = originalText || '标准化全部候选';
                }
            }
        }

        async function requestDeliveryFinalize(options = {}) {
            const runId = options.runId || deliveryCurrentRun?.runId || '';
            const info = document.getElementById('deliveryInfo');
            if (!runId) {
                showToast('请先扫描源图', 'error');
                return;
            }
            try {
                await saveDeliveryRuntimeConfig({ silent: true, force: true });
                const res = await fetch(`/api/delivery/runs/${encodeURIComponent(runId)}/finalize`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        logoTemplateFolder: document.getElementById('deliveryLogoFolder')?.value.trim() || config.deliveryLogoFolder || 'D:\\工作\\GOF\\LOGO模版',
                        namingRule: getDeliveryNamingParts()
                    })
                });
                const data = await res.json();
                if (!res.ok || !data.success) {
                    throw new Error(data.message || '不能生成最终交付包');
                }
                if (data.run) {
                    deliveryCurrentRun = data.run;
                    renderDeliveryJobs(deliveryCurrentRun);
                }
                if (info) {
                    info.className = 'info-box success';
                    info.textContent = data.message || '最终交付包已生成';
                }
                showToast(data.message || '最终交付包已生成');
                return data;
            } catch (error) {
                if (info) {
                    info.className = 'info-box error';
                    info.textContent = error.message;
                }
                showToast(error.message || '不能生成最终交付包', 'error');
                return null;
            }
        }

        function restoreDeliveryActionButtons() {
            deliveryRunTaskActive = false;
            const startButton = document.getElementById('deliveryStartBtn');
            const resumeButton = document.getElementById('deliveryResumeBtn');
            const retryFailedButton = document.getElementById('deliveryRetryFailedBtn');
            const stopButton = document.getElementById('deliveryStopBtn');
            if (startButton) startButton.disabled = false;
            if (resumeButton) resumeButton.disabled = false;
            if (retryFailedButton) retryFailedButton.disabled = (getDeliveryRunTargetStats(deliveryCurrentRun).failed || 0) === 0;
            if (stopButton) stopButton.disabled = true;
        }

        function startDeliveryStatusPolling(runId) {
            if (deliveryStatusInterval) {
                clearInterval(deliveryStatusInterval);
                deliveryStatusInterval = null;
            }
            checkDeliveryRunStatus(runId);
            deliveryStatusInterval = setInterval(() => checkDeliveryRunStatus(runId), 3000);
        }

        function startDeliveryFixedStatusPolling() {
            if (deliveryFixedStatusInterval) {
                clearInterval(deliveryFixedStatusInterval);
                deliveryFixedStatusInterval = null;
            }
            checkDeliveryFixedTaskStatus();
            deliveryFixedStatusInterval = setInterval(() => checkDeliveryFixedTaskStatus(), 3000);
        }

        async function checkDeliveryFixedTaskStatus() {
            try {
                const res = await fetch('/api/legil/task-status');
                const data = await res.json();
                if (!data.success) return;
                const progress = data.progress || {};
                const info = document.getElementById('deliveryInfo');
                if (progress.taskType === 'resize-batch' && info) {
                    info.className = data.running ? 'info-box loading' : (progress.failed ? 'info-box error' : 'info-box success');
                    info.textContent = `${progress.currentAction || '固定提示词'}；进度 ${progress.completed || 0}/${progress.total || 0}，成功 ${progress.success || 0}，失败 ${progress.failed || 0}，已保存 ${progress.saved || 0} 张。`;
                }
                if (!data.running) {
                    if (deliveryFixedStatusInterval) {
                        clearInterval(deliveryFixedStatusInterval);
                        deliveryFixedStatusInterval = null;
                    }
                    restoreDeliveryActionButtons();
                } else {
                    setDeliveryActionButtonsRunning(true);
                    const stopButton = document.getElementById('deliveryStopBtn');
                    if (stopButton) {
                        stopButton.disabled = data.stopRequested === true;
                    }
                }
            } catch (error) {
                console.warn('刷新固定提示词状态失败:', error);
            }
        }

        async function checkDeliveryRunStatus(runId) {
            if (!runId) return;
            try {
                const res = await fetch(`/api/delivery/runs/${encodeURIComponent(runId)}`);
                const data = await res.json();
                if (!res.ok || !data.success) {
                    throw new Error(data.message || '获取改尺寸交付状态失败');
                }
                deliveryCurrentRun = data.run;
                renderDeliveryJobs(data.run);
                const progress = data.task && data.task.progress;
                const info = document.getElementById('deliveryInfo');
                if (info && progress) {
                    info.className = data.task.running ? 'info-box loading' : (progress.failed ? 'info-box error' : 'info-box success');
                    const finalPackageText = progress.finalPackageRoot ? `；最终交付包 ${progress.finalPackageRoot}` : '';
                    info.textContent = `${progress.currentAction || '改尺寸候选生成'}；进度 ${progress.completed || 0}/${progress.total || 0}，成功 ${progress.success || 0}，失败 ${progress.failed || 0}，已保存 ${progress.saved || 0} 张${finalPackageText}。`;
                }
                if (!data.task || !data.task.running) {
                    if (deliveryStatusInterval) {
                        clearInterval(deliveryStatusInterval);
                        deliveryStatusInterval = null;
                    }
                    restoreDeliveryActionButtons();
                    if (data.run) {
                        const prefix = data.run.finalPackageRoot
                            ? `最终交付包已生成：${data.run.finalPackageRoot}`
                            : '改尺寸交付状态已更新。';
                        setDeliveryInfoForRun(data.run, prefix);
                    }
                }
            } catch (error) {
                console.warn('刷新改尺寸交付状态失败:', error);
            }
        }

        function setDeliveryInfoForRun(run, prefix = '') {
            const info = document.getElementById('deliveryInfo');
            if (!info || !run) return;
            const reused = run.scan ? Number(run.scan.reusedJobCount) || 0 : 0;
            const created = run.scan ? Number(run.scan.newJobCount) || 0 : 0;
            const modeText = run.processMode === 'legil-only' ? '固定提示词' : '完整交付流程';
            const targetStats = getDeliveryRunTargetStats(run);
            const sourceReuseTargets = run.scan ? Number(run.scan.sourceReuseTargetCount) || 0 : 0;
            const legilTargets = run.scan ? Number(run.scan.legilTargetCount) || Math.max(0, targetStats.total - sourceReuseTargets) : 0;
            const savedTargets = run.scan ? Number(run.scan.estimatedSavedTargetCount) || sourceReuseTargets : 0;
            const reusePlanText = run.scan && (sourceReuseTargets || legilTargets)
                ? `；源图复用 ${sourceReuseTargets} 个尺寸任务，需生图 ${legilTargets} 个尺寸任务，预计节省 ${savedTargets} 个尺寸任务`
                : '';
            info.className = 'info-box success';
            info.textContent = `${prefix} ${modeText}；${run.totalJobs || 0} 张源图；历史复用 ${reused} 个，新增 ${created} 个${reusePlanText}；尺寸任务就绪 ${targetStats.ready}/${targetStats.total}，候选 ${targetStats.candidates} 张，已标准化 ${targetStats.standardized}/${targetStats.total}，失败 ${targetStats.failed}。`.trim();
        }

        function getDeliveryRunTargetSizes(run = {}) {
            return normalizeDeliveryTargetSizes(run.targetSizes && run.targetSizes.length ? run.targetSizes : getDeliveryTargetSizes());
        }

        function getDeliveryRunCandidateCountForSize(run = {}, size) {
            const counts = run.candidateCountsBySize && typeof run.candidateCountsBySize === 'object'
                ? run.candidateCountsBySize
                : {};
            return normalizeDeliveryCandidateCount(counts[size] || run.candidateCountPerSize || getDeliveryCandidateCountForSize(size));
        }

        function isDeliverySourceReuseTarget(target = {}) {
            return target.generationMode === 'source-reuse' || target.reuseSource === true;
        }

        function getDeliveryTargetExpectedCandidateCount(run = {}, target = {}, size = '') {
            return isDeliverySourceReuseTarget(target)
                ? 1
                : getDeliveryRunCandidateCountForSize(run, size);
        }

        function getDeliveryRunTargetStats(run) {
            const jobs = Array.isArray(run?.jobs) ? run.jobs : [];
            const stats = { total: 0, ready: 0, candidates: 0, standardized: 0, failed: 0, generating: 0, sourceReuse: 0, legil: 0 };
            const targetSizes = getDeliveryRunTargetSizes(run);
            jobs.forEach(job => {
                targetSizes.forEach(size => {
                    const target = job.targets?.[size] || {};
                    const status = String(target.status || 'pending');
                    stats.total += 1;
                    if (isDeliverySourceReuseTarget(target)) {
                        stats.sourceReuse += 1;
                    } else {
                        stats.legil += 1;
                    }
                    if (['candidates_ready', 'candidate_selected', 'standardized', 'logo_applied', 'finalized'].includes(status)) {
                        stats.ready += 1;
                    }
                    stats.candidates += Array.isArray(target.candidates) ? target.candidates.length : 0;
                    if (['standardized', 'logo_applied', 'finalized'].includes(status) && hasDeliveryStandardizedOutput(target)) {
                        stats.standardized += 1;
                    }
                    if (status === 'failed') {
                        stats.failed += 1;
                    } else if (status === 'generating') {
                        stats.generating += 1;
                    }
                });
            });
            return stats;
        }

        function updateDeliveryRetryFailedButton(run) {
            const button = document.getElementById('deliveryRetryFailedBtn');
            if (!button) return;
            const stats = getDeliveryRunTargetStats(run);
            const failedCount = stats.failed || 0;
            button.textContent = failedCount > 0 ? `补跑全部失败 ${failedCount}` : '补跑全部失败';
            button.disabled = failedCount === 0 || deliveryRunTaskActive;
        }

        function renderDeliveryJobs(run) {
            const list = document.getElementById('deliveryTaskList');
            if (!list) return;

            const jobs = Array.isArray(run?.jobs) ? run.jobs : [];
            if (jobs.length === 0) {
                renderDeliveryEmptyRow('当前输入文件夹没有可扫描的源图。');
                return;
            }

            const legilOnly = normalizeDeliveryProcessMode(run.processMode || config.deliveryProcessMode) === 'legil-only';
            const targetSizes = getDeliveryRunTargetSizes(run);
            list.innerHTML = jobs.map(job => {
                const sourceName = job.sourceImage?.fileName || '';
                const targetCells = DELIVERY_TARGET_SIZES.map(size => {
                    if (!targetSizes.includes(size)) {
                        return `<td data-label="${escapeDeliveryAttr(size)}">${renderDeliverySkippedTargetCell(size)}</td>`;
                    }
                    const target = job.targets && job.targets[size] ? job.targets[size] : { status: 'pending', candidates: [] };
                    return `<td data-label="${escapeDeliveryAttr(size)}">${renderDeliveryTargetCell(run, job, size, target)}</td>`;
                }).join('');
                const totalCandidates = targetSizes.reduce((sum, size) => {
                    const target = job.targets && job.targets[size] ? job.targets[size] : null;
                    return sum + (Array.isArray(target?.candidates) ? target.candidates.length : 0);
                }, 0);
                const expectedCandidates = targetSizes.reduce((sum, size) => {
                    const target = job.targets && job.targets[size] ? job.targets[size] : null;
                    return sum + getDeliveryTargetExpectedCandidateCount(run, target || {}, size);
                }, 0);
                return `
                    <tr>
                        <td data-label="源图">
                            <div class="delivery-job-main">${escapeDeliveryHtml(job.baseName || '')}</div>
                            <div class="delivery-job-sub">${escapeDeliveryHtml(sourceName)}</div>
                        </td>
                        ${targetCells}
                        <td data-label="候选">
                            <div class="delivery-target-cell">
                                <span>${escapeDeliveryHtml(String(totalCandidates))}/${escapeDeliveryHtml(String(expectedCandidates))} 张</span>
                                <button type="button" class="btn btn-secondary delivery-mini-action" onclick="generateDeliveryJobCandidates('${escapeDeliveryAttr(run.runId)}', '${escapeDeliveryAttr(job.jobId)}')">补跑此图</button>
                            </div>
                        </td>
                        <td data-label="LOGO">${renderDeliveryPostprocessPill(job, 'logo', legilOnly)}</td>
                        <td data-label="命名">${renderDeliveryPostprocessPill(job, 'naming', legilOnly)}</td>
                        <td data-label="打包">${renderDeliveryPostprocessPill(job, 'package', legilOnly)}</td>
                    </tr>
                `;
            }).join('');
            updateDeliveryRetryFailedButton(run);
        }

        function renderDeliveryTargetCell(run, job, size, target) {
            const status = target.status || 'pending';
            const candidates = Array.isArray(target.candidates) ? target.candidates : [];
            const sourceReuse = isDeliverySourceReuseTarget(target);
            const candidateCount = getDeliveryTargetExpectedCandidateCount(run, target, size);
            const aspectRatio = target.aspectRatio || DELIVERY_TARGET_ASPECT_RATIOS[size] || '';
            const thumbs = candidates.slice(0, 4).map((candidate, index) => {
                const src = `/api/delivery/image?runId=${encodeURIComponent(run.runId)}&path=${encodeURIComponent(candidate.filePath || '')}`;
                const title = candidate.fileName || candidate.candidateId || '候选图';
                const candidateOrdinal = Number(candidate.candidateIndex) || index + 1;
                const candidateLabel = candidate.source === 'source-reuse' ? '源图' : `候选 ${candidateOrdinal}`;
                const textRisk = candidate.textProblem === true || ['medium', 'high'].includes(String(candidate.textQuality?.riskLevel || '').toLowerCase());
                const riskTitle = textRisk ? ` · 疑似文字污染：${candidate.textQuality?.reason || candidate.textQuality?.riskLevel || '需要复核'}` : '';
                return `
                    <div class="delivery-candidate-choice">
                        <button type="button" class="delivery-candidate-preview" title="查看大图${escapeDeliveryAttr(riskTitle)}" onclick="previewDeliveryCandidate('${escapeDeliveryAttr(run.runId)}', '${escapeDeliveryAttr(candidate.filePath || '')}', '${escapeDeliveryAttr(title)}')">
                            <img class="delivery-candidate-thumb" src="${src}" alt="${escapeDeliveryHtml(title)}" title="${escapeDeliveryHtml(title)}">
                        </button>
                        <div class="delivery-candidate-label">${escapeDeliveryHtml(candidateLabel)}${textRisk ? '<span class="delivery-text-risk">文字风险</span>' : ''}</div>
                    </div>
                `;
            }).join('');
            const error = target.error ? `<div class="delivery-target-meta">${escapeDeliveryHtml(target.error)}</div>` : '';
            const standardizedItems = getDeliveryStandardizedItems(target);
            const finalizedItems = Array.isArray(target.finalizedCandidates) ? target.finalizedCandidates : [];
            const textRiskCount = candidates.filter(candidate => candidate.textProblem === true || ['medium', 'high'].includes(String(candidate.textQuality?.riskLevel || '').toLowerCase())).length;
            const candidateMeta = candidates.length && !sourceReuse
                ? `<div class="delivery-target-meta ${textRiskCount ? 'is-warn' : 'is-ok'}">${textRiskCount ? `已标记 ${escapeDeliveryHtml(String(textRiskCount))} 张文字风险；有干净候选时后处理会跳过风险图` : '全部候选文字质检通过或未发现风险'}</div>`
                : '';
            const sourceReuseMeta = sourceReuse
                ? `<div class="delivery-target-meta is-ok">跳过 Legil · 源图 ${escapeDeliveryHtml(target.sourceDimensions || job.sourceImage?.dimensions || '')}</div>`
                : `<div class="delivery-target-meta">Legil 候选 ${escapeDeliveryHtml(String(candidates.length))}/${escapeDeliveryHtml(String(candidateCount))} 张</div>`;
            const standardized = standardizedItems.length
                ? `<div class="delivery-target-meta is-ok">已标准化：${escapeDeliveryHtml(String(standardizedItems.length))} 张 / ${escapeDeliveryHtml(standardizedItems[0]?.dimensions || size)} / ${escapeDeliveryHtml(standardizedItems[0]?.sizeKb || '')}KB</div>`
                : '';
            const finalized = finalizedItems.length
                ? `<div class="delivery-target-meta is-ok">最终交付：${escapeDeliveryHtml(String(finalizedItems.length))} 张</div>`
                : '';
            const retry = status === 'failed'
                ? `<button type="button" class="btn btn-secondary delivery-mini-action" onclick="retryDeliveryTarget('${escapeDeliveryAttr(run.runId)}', '${escapeDeliveryAttr(job.jobId)}', '${escapeDeliveryAttr(size)}')">补跑失败尺寸</button>`
                : '';
            return `
                <div class="delivery-target-cell${sourceReuse ? ' is-source-reuse' : ''}">
                    ${renderDeliveryStatusPill(sourceReuse ? 'source-reuse' : status, {
                        label: sourceReuse ? '源图复用' : `${size} ${getDeliveryTargetStatusLabel(status)}`,
                        title: sourceReuse ? `${size} 命中源图比例，跳过 Legil` : `${size} 目标状态`
                    })}
                    <div class="delivery-target-meta">${escapeDeliveryHtml(aspectRatio)} · ${sourceReuse ? '1/1 张' : `${escapeDeliveryHtml(String(candidates.length))}/${escapeDeliveryHtml(String(candidateCount))} 张`}</div>
                    ${sourceReuseMeta}
                    ${thumbs ? `<div class="delivery-candidate-strip">${thumbs}</div>` : ''}
                    ${candidateMeta}
                    ${standardized}
                    ${finalized}
                    ${error}
                    ${retry}
                </div>
            `;
        }

        function getDeliveryTargetStatusLabel(status) {
            const safeStatus = String(status || 'pending');
            const labels = {
                pending: '待生成',
                generating: '生成中',
                candidates_ready: '候选就绪',
                candidate_selected: '已选候选',
                standardized: '已标准化',
                logo_applied: '已加 LOGO',
                finalized: '已交付',
                failed: '失败'
            };
            return labels[safeStatus] || safeStatus;
        }

        function getDeliveryStandardizedItems(target = {}) {
            if (Array.isArray(target.standardizedCandidates) && target.standardizedCandidates.length) {
                return target.standardizedCandidates;
            }
            return target.standardizedPath ? [target.standardized || { outputPath: target.standardizedPath }] : [];
        }

        function hasDeliveryStandardizedOutput(target = {}) {
            return getDeliveryStandardizedItems(target).length > 0;
        }

        function renderDeliveryPostprocessPill(job = {}, type, legilOnly) {
            if (legilOnly) {
                return renderDeliveryStatusPill('skipped', { label: '跳过' });
            }
            const postprocess = job.postprocess || {};
            const anyFailed = job.status === 'failed';
            const isFinalized = postprocess.finalized === true || postprocess.packaged === true || job.status === 'finalized';
            const logoDone = postprocess.logoApplied === true || isFinalized;
            const namingDone = postprocess.renamed === true || isFinalized;
            const packageDone = postprocess.packaged === true || isFinalized;
            const doneMap = {
                logo: logoDone,
                naming: namingDone,
                package: packageDone
            };
            if (doneMap[type]) {
                return renderDeliveryStatusPill('finalized', { label: '已完成' });
            }
            return renderDeliveryStatusPill(anyFailed ? 'failed' : 'pending', { label: anyFailed ? '失败' : '待处理' });
        }

        function renderDeliverySkippedTargetCell(size) {
            return `
                <div class="delivery-target-cell is-skipped">
                    ${renderDeliveryStatusPill('skipped', {
                        label: `${size} 未选`,
                        title: '本轮不生成该目标尺寸'
                    })}
                    <div class="delivery-target-meta">${escapeDeliveryHtml(DELIVERY_TARGET_ASPECT_RATIOS[size] || '')} · 已跳过</div>
                </div>
            `;
        }

        function generateDeliveryJobCandidates(runId, jobId) {
            startDeliveryCandidateGeneration({ runId, jobId, resume: true });
        }

        function retryDeliveryTarget(runId, jobId, targetSize) {
            startDeliveryCandidateGeneration({ runId, jobId, targetSize, resume: true, force: true });
        }

        function retryAllFailedDeliveryTargets() {
            if (!deliveryCurrentRun || !deliveryCurrentRun.runId) {
                showToast('请先扫描或加载交付任务', 'error');
                return;
            }
            const failedCount = getDeliveryRunTargetStats(deliveryCurrentRun).failed || 0;
            if (failedCount === 0) {
                showToast('当前没有失败任务需要补跑');
                updateDeliveryRetryFailedButton(deliveryCurrentRun);
                return;
            }
            startDeliveryCandidateGeneration({
                runId: deliveryCurrentRun.runId,
                resume: true,
                failedOnly: true
            });
        }

        function previewDeliveryCandidate(runId, filePath, title) {
            const src = `/api/delivery/image?runId=${encodeURIComponent(runId)}&path=${encodeURIComponent(filePath || '')}`;
            let modal = document.getElementById('deliveryPreviewModal');
            if (!modal) {
                modal = document.createElement('div');
                modal.id = 'deliveryPreviewModal';
                modal.className = 'delivery-preview-modal';
                modal.innerHTML = `
                    <div class="delivery-preview-dialog">
                        <div class="delivery-preview-header">
                            <strong id="deliveryPreviewTitle"></strong>
                            <button type="button" class="btn btn-secondary delivery-mini-action" id="deliveryPreviewCloseBtn">关闭</button>
                        </div>
                        <img id="deliveryPreviewImage" alt="候选预览">
                        <div class="delivery-preview-actions">
                            <button type="button" class="btn btn-secondary" id="deliveryPreviewOpenBtn">打开大图</button>
                        </div>
                    </div>
                `;
                document.body.appendChild(modal);
                modal.addEventListener('click', event => {
                    if (event.target === modal) {
                        modal.classList.remove('active');
                    }
                });
                modal.querySelector('#deliveryPreviewCloseBtn')?.addEventListener('click', () => {
                    modal.classList.remove('active');
                });
            }
            modal.querySelector('#deliveryPreviewTitle').textContent = title || '候选预览';
            modal.querySelector('#deliveryPreviewImage').src = src;
            modal.querySelector('#deliveryPreviewOpenBtn').onclick = () => window.open(src, '_blank');
            modal.classList.add('active');
        }

        function renderDeliveryEmptyRow(message) {
            const list = document.getElementById('deliveryTaskList');
            if (!list) return;
            list.innerHTML = `
                <tr>
                    <td colspan="8">${escapeDeliveryHtml(message || '暂无改尺寸任务。')}</td>
                </tr>
            `;
            updateDeliveryRetryFailedButton(null);
        }

        function renderDeliveryStatusPill(status, options = {}) {
            const safeStatus = String(status || 'pending').toLowerCase();
            const label = options.label || safeStatus;
            const className = [
                'delivery-status-pill',
                safeStatus === 'source-reuse' ? 'is-source-reuse' : '',
                safeStatus === 'skipped' ? 'is-skipped' : '',
                safeStatus === 'pending' ? 'is-pending' : '',
                ['completed', 'candidates_ready', 'candidate_selected', 'standardized', 'logo_applied', 'finalized'].includes(safeStatus) ? 'is-completed' : '',
                safeStatus === 'generating' ? 'is-generating' : '',
                safeStatus === 'failed' ? 'is-failed' : ''
            ].filter(Boolean).join(' ');
            const title = options.title ? ` title="${escapeDeliveryHtml(options.title)}"` : '';
            return `<span class="${className}"${title}>${escapeDeliveryHtml(label)}</span>`;
        }

        function escapeDeliveryHtml(value) {
            return String(value ?? '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }

        function getDeliverySelectedRatios() {
            return getDeliveryTargetSizes().map(size => DELIVERY_TARGET_ASPECT_RATIOS[size]).filter(Boolean);
        }

        function getDeliveryCandidateCount() {
            return getDeliveryUnifiedCandidateCount();
        }

        function escapeDeliveryAttr(value) {
            return escapeDeliveryHtml(value).replace(/`/g, '&#96;');
        }
