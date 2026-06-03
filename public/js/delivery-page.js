// S10 三尺寸交付：S10.2 先完成 OK 图扫描、delivery run 落盘和页面任务追踪。
        const DELIVERY_TARGET_SIZES = ['800x800', '1280x720', '1080x1920'];
        const DELIVERY_TARGET_ASPECT_RATIOS = {
            '800x800': '1:1',
            '1280x720': '16:9',
            '1080x1920': '9:16'
        };
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
            updateDeliveryPreview();
            if (typeof loadResizeConfig === 'function') {
                loadResizeConfig().finally(() => {
                    enforceDeliveryLegilSettings();
                    updateDeliveryPreview();
                    loadLatestDeliveryRun();
                });
            } else {
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
            return DELIVERY_ALLOWED_CANDIDATE_COUNTS.includes(count) ? count : 4;
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
                    updateDeliveryPreview();
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

            document.querySelectorAll('[data-delivery-stage="logo"], [data-delivery-stage="naming"]').forEach(section => {
                section.setAttribute('aria-disabled', legilOnly ? 'true' : 'false');
                section.querySelectorAll('input, button, select, textarea').forEach(control => {
                    control.disabled = legilOnly;
                });
            });

            const startButton = document.getElementById('deliveryStartBtn');
            if (startButton) {
                startButton.textContent = legilOnly ? '开始仅 Legil AI 适配' : '开始完整改尺寸并生成交付包';
            }
            const flowNote = document.getElementById('deliveryFlowNote');
            if (flowNote) {
                flowNote.textContent = legilOnly
                    ? '仅生成 Legil 候选图，不做最终交付包'
                    : '完整交付会自动标准化、加 LOGO 并输出 final-package';
            }
            document.querySelectorAll('.delivery-manual-postprocess-action').forEach(button => {
                button.hidden = true;
            });
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
            const selectedSizes = getDeliveryTargetSizes();
            const counts = getDeliveryCandidateCountsBySize();
            document.querySelectorAll('[data-delivery-target-size]').forEach(button => {
                button.classList.toggle('active', selectedSizes.includes(button.dataset.deliveryTargetSize));
            });
            document.querySelectorAll('[data-delivery-size-count-row]').forEach(row => {
                const size = row.dataset.deliverySizeCountRow;
                row.classList.toggle('is-disabled', !selectedSizes.includes(size));
            });
            document.querySelectorAll('[data-delivery-target-count-size]').forEach(button => {
                const size = button.dataset.deliveryTargetCountSize;
                const count = Number(button.dataset.deliveryTargetCount);
                const selected = selectedSizes.includes(size);
                button.classList.toggle('active', selected && counts[size] === count);
                button.disabled = !selected;
            });
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
                    config[inputId] = input.value.trim();
                    Object.values(DELIVERY_TAG_LEVELS).forEach(meta => {
                        if (meta.inputId === inputId) {
                            config[meta.configKey] = input.value.trim();
                        }
                    });
                    updateDeliveryPreview();
                });
            });

            [
                'deliveryPromptCommon',
                'deliveryPrompt800',
                'deliveryPrompt1280',
                'deliveryPrompt1080'
            ].forEach(inputId => {
                const input = document.getElementById(inputId);
                if (!input) return;
                input.addEventListener('input', () => {
                    updateDeliveryPreview();
                });
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

        function buildDeliveryStartPayload(options = {}) {
            enforceDeliveryLegilSettings();
            const scanPayload = buildDeliveryScanPayload();
            return {
                ...scanPayload,
                runId: options.runId || deliveryCurrentRun?.runId || '',
                jobId: options.jobId || '',
                targetSize: options.targetSize || '',
                force: options.force === true,
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
                    ? '仅 Legil AI 适配；后续 LOGO、命名、打包将跳过'
                    : `完整改尺寸交付；LOGO 模板目录 ${logoFolder ? '已填写' : '未填写'}`;
                info.textContent = inputFolder && outputFolder
                    ? `已填写输入输出；${modeText}；目标尺寸 ${selectedSizes.join('、')}；比例 ${selectedRatios.join('、')}；候选 ${candidateSummary}。点击扫描 OK 图生成真实任务。`
                    : '请先填写 OK 图输入文件夹和交付输出文件夹。';
            }
        }

        async function loadLatestDeliveryRun() {
            const inputFolder = document.getElementById('deliveryInputFolder')?.value.trim() || config.deliveryInputFolder || '';
            if (!inputFolder) return;
            try {
                const query = new URLSearchParams({ inputFolder });
                const res = await fetch(`/api/delivery/status?${query.toString()}`);
                const data = await res.json();
                if (data.success && data.hasRun && data.run) {
                    deliveryCurrentRun = data.run;
                    renderDeliveryJobs(data.run);
                    setDeliveryInfoForRun(data.run, '已载入上次扫描的 delivery run。');
                    if (data.task && data.task.running) {
                        startDeliveryStatusPolling(data.run.runId);
                    }
                }
            } catch (error) {
                console.warn('加载三尺寸交付状态失败:', error);
            }
        }

        async function scanDeliveryInputFolder() {
            if (deliveryScanning) return;
            const payload = buildDeliveryScanPayload();
            if (!payload.inputFolder || !payload.outputFolder) {
                updateDeliveryPreview();
                showToast('请先填写 OK 图输入文件夹和交付输出文件夹', 'error');
                return;
            }

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
                info.textContent = '正在扫描 OK 图输入文件夹，并写入 data/delivery-postprocess/ ...';
            }

            try {
                const res = await fetch('/api/delivery/scan', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const data = await res.json();
                if (!res.ok || !data.success) {
                    throw new Error(data.message || '扫描 OK 图失败');
                }

                deliveryCurrentRun = data.run;
                renderDeliveryJobs(data.run);
                setDeliveryInfoForRun(data.run, data.message || '扫描完成。');
                if (typeof addFolderHistory === 'function') {
                    addFolderHistory('deliveryInputFolder', payload.inputFolder);
                    addFolderHistory('deliveryOutputFolder', payload.outputFolder);
                    addFolderHistory('deliveryLogoFolder', payload.logoTemplateFolder);
                }
                showToast(`已扫描 ${data.totalJobs || 0} 个 OK 图 job`);
            } catch (error) {
                if (info) {
                    info.className = 'info-box error';
                    info.textContent = error.message;
                }
                renderDeliveryEmptyRow(error.message || '扫描失败');
                showToast(error.message || '扫描 OK 图失败', 'error');
            } finally {
                deliveryScanning = false;
                if (scanButton) {
                    scanButton.disabled = false;
                    scanButton.textContent = originalText || '扫描 OK 图';
                }
            }
        }

        async function startDeliveryCandidateGeneration(options = {}) {
            const info = document.getElementById('deliveryInfo');
            if (!deliveryCurrentRun && !options.runId) {
                await scanDeliveryInputFolder();
            }
            const payload = buildDeliveryStartPayload({
                ...options,
                runId: options.runId || deliveryCurrentRun?.runId || ''
            });
            if (!payload.runId) {
                showToast('请先扫描 OK 图，建立 delivery run', 'error');
                return;
            }

            const endpoint = options.resume ? '/api/delivery/resume' : '/api/delivery/start';
            const isFullDeliveryStart = !options.jobId && !options.targetSize && !isDeliveryLegilOnlyMode();
            const startButton = document.getElementById('deliveryStartBtn');
            const resumeButton = document.getElementById('deliveryResumeBtn');
            const stopButton = document.getElementById('deliveryStopBtn');
            if (startButton) startButton.disabled = true;
            if (resumeButton) resumeButton.disabled = true;
            if (stopButton) stopButton.disabled = false;
            if (info) {
                info.className = 'info-box loading';
                info.textContent = options.jobId
                    ? '已提交当前 OK 图的 Legil 三尺寸候选生成任务...'
                    : (isFullDeliveryStart
                        ? '已提交完整改尺寸任务：后端会直接跑到最终交付包...'
                        : '已提交 S10.3 Legil 三尺寸候选生成任务...');
            }

            try {
                const res = await fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const data = await res.json();
                if (!res.ok || !data.success) {
                    throw new Error(data.message || '启动三尺寸候选生成失败');
                }
                if (data.run) {
                    deliveryCurrentRun = data.run;
                    renderDeliveryJobs(data.run);
                }
                if (info) {
                    info.className = data.totalTargets === 0 ? 'info-box success' : 'info-box loading';
                    info.textContent = data.message || 'S10.3 三尺寸候选生成已启动。';
                }
                showToast(data.message || '已启动三尺寸候选生成');
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
                showToast(error.message || '启动三尺寸候选生成失败', 'error');
                restoreDeliveryActionButtons();
            }
        }

        async function stopDeliveryCandidateGeneration() {
            const stopButton = document.getElementById('deliveryStopBtn');
            if (stopButton) stopButton.disabled = true;
            try {
                const res = await fetch('/api/delivery/stop', { method: 'POST' });
                const data = await res.json();
                showToast(data.message || '已发送停止指令');
            } catch (error) {
                showToast(error.message || '停止三尺寸候选生成失败', 'error');
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
                showToast('请先扫描 OK 图', 'error');
                return;
            }
            try {
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
            const startButton = document.getElementById('deliveryStartBtn');
            const resumeButton = document.getElementById('deliveryResumeBtn');
            const stopButton = document.getElementById('deliveryStopBtn');
            if (startButton) startButton.disabled = false;
            if (resumeButton) resumeButton.disabled = false;
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

        async function checkDeliveryRunStatus(runId) {
            if (!runId) return;
            try {
                const res = await fetch(`/api/delivery/runs/${encodeURIComponent(runId)}`);
                const data = await res.json();
                if (!res.ok || !data.success) {
                    throw new Error(data.message || '获取三尺寸交付状态失败');
                }
                deliveryCurrentRun = data.run;
                renderDeliveryJobs(data.run);
                const progress = data.task && data.task.progress;
                const info = document.getElementById('deliveryInfo');
                if (info && progress) {
                    info.className = data.task.running ? 'info-box loading' : (progress.failed ? 'info-box error' : 'info-box success');
                    const finalPackageText = progress.finalPackageRoot ? `；最终交付包 ${progress.finalPackageRoot}` : '';
                    info.textContent = `${progress.currentAction || 'S10.3 三尺寸候选生成'}；target ${progress.completed || 0}/${progress.total || 0}，成功 ${progress.success || 0}，失败 ${progress.failed || 0}，已保存 ${progress.saved || 0} 张${finalPackageText}。`;
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
                            : '三尺寸交付状态已更新。';
                        setDeliveryInfoForRun(data.run, prefix);
                    }
                }
            } catch (error) {
                console.warn('刷新三尺寸交付状态失败:', error);
            }
        }

        function setDeliveryInfoForRun(run, prefix = '') {
            const info = document.getElementById('deliveryInfo');
            if (!info || !run) return;
            const reused = run.scan ? Number(run.scan.reusedJobCount) || 0 : 0;
            const created = run.scan ? Number(run.scan.newJobCount) || 0 : 0;
            const modeText = run.processMode === 'legil-only' ? '仅 Legil AI 适配' : '完整改尺寸交付';
            const targetStats = getDeliveryRunTargetStats(run);
            info.className = 'info-box success';
            info.textContent = `${prefix} ${modeText}；${run.totalJobs || 0} 个 job；复用 ${reused} 个，新增 ${created} 个；target 就绪 ${targetStats.ready}/${targetStats.total}，候选 ${targetStats.candidates} 张，已标准化 ${targetStats.standardized}/${targetStats.total}，失败 ${targetStats.failed}。`.trim();
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

        function getDeliveryRunTargetStats(run) {
            const jobs = Array.isArray(run?.jobs) ? run.jobs : [];
            const stats = { total: 0, ready: 0, candidates: 0, standardized: 0, failed: 0, generating: 0 };
            const targetSizes = getDeliveryRunTargetSizes(run);
            jobs.forEach(job => {
                targetSizes.forEach(size => {
                    const target = job.targets?.[size] || {};
                    const status = String(target.status || 'pending');
                    stats.total += 1;
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

        function renderDeliveryJobs(run) {
            const list = document.getElementById('deliveryTaskList');
            if (!list) return;

            const jobs = Array.isArray(run?.jobs) ? run.jobs : [];
            if (jobs.length === 0) {
                renderDeliveryEmptyRow('当前输入文件夹没有可扫描的 OK 图。');
                return;
            }

            const legilOnly = normalizeDeliveryProcessMode(run.processMode || config.deliveryProcessMode) === 'legil-only';
            const targetSizes = getDeliveryRunTargetSizes(run);
            list.innerHTML = jobs.map(job => {
                const sourceName = job.sourceImage?.fileName || '';
                const targetCells = DELIVERY_TARGET_SIZES.map(size => {
                    if (!targetSizes.includes(size)) {
                        return `<td>${renderDeliverySkippedTargetCell(size)}</td>`;
                    }
                    const target = job.targets && job.targets[size] ? job.targets[size] : { status: 'pending', candidates: [] };
                    return `<td>${renderDeliveryTargetCell(run, job, size, target)}</td>`;
                }).join('');
                const totalCandidates = targetSizes.reduce((sum, size) => {
                    const target = job.targets && job.targets[size] ? job.targets[size] : null;
                    return sum + (Array.isArray(target?.candidates) ? target.candidates.length : 0);
                }, 0);
                const expectedCandidates = targetSizes.reduce((sum, size) => {
                    return sum + getDeliveryRunCandidateCountForSize(run, size);
                }, 0);
                return `
                    <tr>
                        <td>
                            <div class="delivery-job-main">${escapeDeliveryHtml(job.baseName || '')}</div>
                            <div class="delivery-job-sub">${escapeDeliveryHtml(sourceName)}</div>
                        </td>
                        ${targetCells}
                        <td>
                            <div class="delivery-target-cell">
                                <span>${escapeDeliveryHtml(String(totalCandidates))}/${escapeDeliveryHtml(String(expectedCandidates))} 张</span>
                                <button type="button" class="btn btn-secondary delivery-mini-action" onclick="generateDeliveryJobCandidates('${escapeDeliveryAttr(run.runId)}', '${escapeDeliveryAttr(job.jobId)}')">补跑此图</button>
                            </div>
                        </td>
                        <td>${renderDeliveryPostprocessPill(job, 'logo', legilOnly)}</td>
                        <td>${renderDeliveryPostprocessPill(job, 'naming', legilOnly)}</td>
                        <td>${renderDeliveryPostprocessPill(job, 'package', legilOnly)}</td>
                    </tr>
                `;
            }).join('');
        }

        function renderDeliveryTargetCell(run, job, size, target) {
            const status = target.status || 'pending';
            const candidates = Array.isArray(target.candidates) ? target.candidates : [];
            const candidateCount = Number(target.candidateCount || run.candidateCountPerSize || getDeliveryCandidateCount()) || 4;
            const aspectRatio = target.aspectRatio || DELIVERY_TARGET_ASPECT_RATIOS[size] || '';
            const thumbs = candidates.slice(0, 4).map((candidate, index) => {
                const src = `/api/delivery/image?runId=${encodeURIComponent(run.runId)}&path=${encodeURIComponent(candidate.filePath || '')}`;
                const title = candidate.fileName || candidate.candidateId || '候选图';
                const candidateOrdinal = Number(candidate.candidateIndex) || index + 1;
                return `
                    <div class="delivery-candidate-choice">
                        <button type="button" class="delivery-candidate-preview" title="查看大图" onclick="previewDeliveryCandidate('${escapeDeliveryAttr(run.runId)}', '${escapeDeliveryAttr(candidate.filePath || '')}', '${escapeDeliveryAttr(title)}')">
                            <img class="delivery-candidate-thumb" src="${src}" alt="${escapeDeliveryHtml(title)}" title="${escapeDeliveryHtml(title)}">
                        </button>
                        <div class="delivery-candidate-label">候选 ${escapeDeliveryHtml(String(candidateOrdinal))}</div>
                    </div>
                `;
            }).join('');
            const error = target.error ? `<div class="delivery-target-meta">${escapeDeliveryHtml(target.error)}</div>` : '';
            const standardizedItems = getDeliveryStandardizedItems(target);
            const finalizedItems = Array.isArray(target.finalizedCandidates) ? target.finalizedCandidates : [];
            const candidateMeta = candidates.length
                ? '<div class="delivery-target-meta is-ok">全部候选将进入交付</div>'
                : '';
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
                <div class="delivery-target-cell">
                    ${renderDeliveryStatusPill(status, {
                        label: `${size} ${status}`,
                        title: `${size} 目标状态`
                    })}
                    <div class="delivery-target-meta">${escapeDeliveryHtml(aspectRatio)} · ${candidates.length}/${candidateCount} 张</div>
                    ${thumbs ? `<div class="delivery-candidate-strip">${thumbs}</div>` : ''}
                    ${candidateMeta}
                    ${standardized}
                    ${finalized}
                    ${error}
                    ${retry}
                </div>
            `;
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
                return renderDeliveryStatusPill('finalized', { label: 'done' });
            }
            return renderDeliveryStatusPill(anyFailed ? 'failed' : 'pending', { label: anyFailed ? 'failed' : 'pending' });
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
        }

        function renderDeliveryStatusPill(status, options = {}) {
            const safeStatus = String(status || 'pending').toLowerCase();
            const label = options.label || safeStatus;
            const className = [
                'delivery-status-pill',
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
