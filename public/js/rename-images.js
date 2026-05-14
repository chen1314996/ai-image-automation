// 图片重命名页：预览新名称，并复制输出到指定文件夹。
        const renameRuleStorageKey = 'ai-image-automation-rename-rule-v2';
        const renameTagsStorageKey = 'ai-image-automation-rename-tags-v1';
        const renameDefaultTags = {
            '题材': ['载具']
        };
        const resizeBatchStorageKey = 'ai-image-automation-rename-resize-batch-v1';
        const resizeBatchTargetSizes = ['800x800', '1080x1920', '1280x720'];
        const logoBatchStorageKey = 'ai-image-automation-rename-logo-batch-v1';
        const defaultLogoBatchFileName = '1-国内LOGO模板-800x800.png';
        const packageBatchStorageKey = 'ai-image-automation-rename-package-batch-v1';
        const packageBatchTargetSizes = ['800x800', '1080x1920', '1280x720'];
        const defaultPackageBatchOutputFolder = 'D:\\工作\\自动化工作流1\\重命名\\一键打包';
        const renameToolFolderMigrations = {
            'D:\\工作\\自动化工作流1\\创意拓展\\改尺寸输出': 'D:\\工作\\自动化工作流1\\重命名\\改尺寸',
            'D:\\工作\\自动化工作流1\\创意拓展\\加LOGO输出': 'D:\\工作\\自动化工作流1\\重命名\\加LOGO'
        };

        function normalizeRenameToolFolder(folderPath) {
            return renameToolFolderMigrations[folderPath] || folderPath || '';
        }

        function loadRenameRule() {
            try {
                const parsed = JSON.parse(localStorage.getItem(renameRuleStorageKey) || '{}');
                return parsed && typeof parsed === 'object' ? parsed : {};
            } catch (e) {
                return {};
            }
        }

        function saveRenameRule(rule = {}) {
            try {
                localStorage.setItem(renameRuleStorageKey, JSON.stringify(rule));
            } catch (e) {}
        }

        function normalizeRenameTags(tags) {
            const source = tags && typeof tags === 'object' ? tags : renameDefaultTags;
            const normalized = {};

            Object.keys(source).forEach(primary => {
                const primaryName = String(primary || '').trim();
                if (!primaryName) return;

                const children = Array.isArray(source[primary]) ? source[primary] : [];
                const secondaryTags = children
                    .map(item => String(item || '').trim())
                    .filter(Boolean);
                normalized[primaryName] = secondaryTags.length ? [...new Set(secondaryTags)] : ['默认'];
            });

            return Object.keys(normalized).length ? normalized : { ...renameDefaultTags };
        }

        function loadRenameTags() {
            try {
                const parsed = JSON.parse(localStorage.getItem(renameTagsStorageKey) || '{}');
                return normalizeRenameTags(parsed);
            } catch (e) {
                return normalizeRenameTags(renameDefaultTags);
            }
        }

        function saveRenameTags(tags) {
            try {
                localStorage.setItem(renameTagsStorageKey, JSON.stringify(normalizeRenameTags(tags)));
            } catch (e) {}
        }

        function getRenameTags() {
            return normalizeRenameTags(config.renameTags || loadRenameTags());
        }

        function setRenameTags(tags) {
            config.renameTags = normalizeRenameTags(tags);
            saveRenameTags(config.renameTags);
        }

        function setRenameTagInput(type, value) {
            const inputId = type === 'primary' ? 'renamePrimaryTagInput' : 'renameSecondaryTagInput';
            const input = document.getElementById(inputId);
            if (input) input.value = value || '';
        }

        function getRenameTagInput(type) {
            const inputId = type === 'primary' ? 'renamePrimaryTagInput' : 'renameSecondaryTagInput';
            return document.getElementById(inputId)?.value.trim() || '';
        }

        function closeRenameTagMenus(exceptType = '') {
            ['primary', 'secondary'].forEach(type => {
                if (exceptType && type === exceptType) return;
                const menuId = type === 'primary' ? 'renamePrimaryTagMenu' : 'renameSecondaryTagMenu';
                const buttonId = type === 'primary' ? 'renamePrimaryTagMenuButton' : 'renameSecondaryTagMenuButton';
                document.getElementById(menuId)?.classList.remove('active');
                document.getElementById(buttonId)?.classList.remove('active');
            });
        }

        function renderRenameTagMenu(type) {
            const tags = getRenameTags();
            const menu = document.getElementById(type === 'primary' ? 'renamePrimaryTagMenu' : 'renameSecondaryTagMenu');
            if (!menu) return;

            const primary = getRenameTagInput('primary') || config.renamePrimaryTag;
            const values = type === 'primary' ? Object.keys(tags) : (tags[primary] || []);
            const selectedValue = type === 'primary' ? config.renamePrimaryTag : config.renameSecondaryTag;
            menu.innerHTML = '';

            if (values.length === 0) {
                const empty = document.createElement('div');
                empty.className = 'rename-tag-empty';
                empty.textContent = '暂无标签';
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
                item.addEventListener('click', () => selectRenameTag(type, value));
                item.addEventListener('keydown', event => {
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        selectRenameTag(type, value);
                    }
                });

                const label = document.createElement('span');
                label.className = 'rename-tag-label';
                label.textContent = value;
                item.appendChild(label);

                const deleteButton = document.createElement('button');
                deleteButton.type = 'button';
                deleteButton.className = 'rename-tag-delete';
                deleteButton.textContent = '删除';
                deleteButton.addEventListener('mousedown', event => event.preventDefault());
                deleteButton.addEventListener('click', event => {
                    event.stopPropagation();
                    deleteRenameTag(type, value);
                });
                item.appendChild(deleteButton);

                menu.appendChild(item);
            });
        }

        function renderRenameTagControls() {
            const tags = getRenameTags();
            const primaryTags = Object.keys(tags);
            const primary = primaryTags.includes(config.renamePrimaryTag)
                ? config.renamePrimaryTag
                : primaryTags[0];
            const secondaryTags = tags[primary] || [];
            const secondary = secondaryTags.includes(config.renameSecondaryTag)
                ? config.renameSecondaryTag
                : secondaryTags[0];

            config.renamePrimaryTag = primary;
            config.renameSecondaryTag = secondary;
            setRenameTagInput('primary', primary);
            setRenameTagInput('secondary', secondary);
            renderRenameTagMenu('primary');
            renderRenameTagMenu('secondary');
            updateRenameExample();
        }

        function toggleRenameTagMenu(type) {
            const menuId = type === 'primary' ? 'renamePrimaryTagMenu' : 'renameSecondaryTagMenu';
            const buttonId = type === 'primary' ? 'renamePrimaryTagMenuButton' : 'renameSecondaryTagMenuButton';
            const menu = document.getElementById(menuId);
            const button = document.getElementById(buttonId);
            if (!menu || !button) return;

            renderRenameTagMenu(type);
            const willOpen = !menu.classList.contains('active');
            closeRenameTagMenus(type);
            menu.classList.toggle('active', willOpen);
            button.classList.toggle('active', willOpen);
        }

        function selectRenameTag(type, value) {
            if (type === 'primary') {
                const tags = getRenameTags();
                config.renamePrimaryTag = value;
                config.renameSecondaryTag = (tags[value] || [])[0] || '';
                setRenameTagInput('primary', config.renamePrimaryTag);
                setRenameTagInput('secondary', config.renameSecondaryTag);
            } else {
                config.renameSecondaryTag = value;
                setRenameTagInput('secondary', value);
            }
            persistCurrentRenameRule();
            renderRenameTagMenu('primary');
            renderRenameTagMenu('secondary');
            closeRenameTagMenus();
            updateRenameExample();
        }

        function initRenamePage() {
            const input = document.getElementById('renameInputFolder');
            const output = document.getElementById('renameOutputFolder');
            const storedRule = loadRenameRule();

            config.renameTags = loadRenameTags();
            config.renameFixedPrefix = storedRule.fixedPrefix || config.renameFixedPrefix;
            config.renameStartNumber = storedRule.startNumber || config.renameStartNumber;
            config.renameRegionText = storedRule.regionText || config.renameRegionText;
            config.renameChannelText = storedRule.channelText || config.renameChannelText;
            config.renamePrimaryTag = storedRule.primaryTag || config.renamePrimaryTag;
            config.renameSecondaryTag = storedRule.secondaryTag || config.renameSecondaryTag;

            if (input) {
                input.value = config.renameInputFolder || input.value;
                addFolderHistory('renameInputFolder', input.value);
            }
            if (output) {
                output.value = config.renameOutputFolder || output.value;
                addFolderHistory('renameOutputFolder', output.value);
            }

            [
                ['renameFixedPrefix', 'renameFixedPrefix'],
                ['renameStartNumber', 'renameStartNumber'],
                ['renameRegionText', 'renameRegionText'],
                ['renameChannelText', 'renameChannelText']
            ].forEach(([elementId, configKey]) => {
                const element = document.getElementById(elementId);
                if (!element) return;
                element.value = config[configKey] || element.value;
                element.addEventListener('input', () => {
                    config[configKey] = element.value.trim();
                    persistCurrentRenameRule();
                    updateRenameExample();
                });
            });

            [
                ['renamePrimaryTagInput', 'renamePrimaryTag'],
                ['renameSecondaryTagInput', 'renameSecondaryTag']
            ].forEach(([elementId, configKey]) => {
                const element = document.getElementById(elementId);
                if (!element) return;
                element.addEventListener('input', () => {
                    config[configKey] = element.value.trim();
                    persistCurrentRenameRule();
                    updateRenameExample();
                });
                element.addEventListener('keydown', event => {
                    if (event.key === 'Enter') {
                        event.preventDefault();
                        if (configKey === 'renamePrimaryTag') {
                            addRenamePrimaryTag();
                        } else {
                            addRenameSecondaryTag();
                        }
                    }
                });
            });

            document.addEventListener('click', event => {
                if (!event.target.closest('.rename-tag-row')) {
                    closeRenameTagMenus();
                }
            });

            renderRenameTagControls();
            renderRenameResults(null);
        }

        function persistCurrentRenameRule() {
            saveRenameRule({
                fixedPrefix: config.renameFixedPrefix,
                startNumber: config.renameStartNumber,
                regionText: config.renameRegionText,
                channelText: config.renameChannelText,
                primaryTag: config.renamePrimaryTag,
                secondaryTag: config.renameSecondaryTag
            });
        }

        function getRenamePayload() {
            const readInputValue = (id, fallback = '') => {
                const element = document.getElementById(id);
                return element ? element.value.trim() : fallback;
            };
            const inputFolder = readInputValue('renameInputFolder');
            const outputFolder = readInputValue('renameOutputFolder');
            const fixedPrefix = readInputValue('renameFixedPrefix', config.renameFixedPrefix);
            const startNumber = readInputValue('renameStartNumber', config.renameStartNumber);
            const regionText = readInputValue('renameRegionText', config.renameRegionText);
            const channelText = readInputValue('renameChannelText', config.renameChannelText);
            const primaryTag = readInputValue('renamePrimaryTagInput', config.renamePrimaryTag);
            const secondaryTag = readInputValue('renameSecondaryTagInput', config.renameSecondaryTag);

            config.renameInputFolder = inputFolder;
            config.renameOutputFolder = outputFolder;
            config.renameFixedPrefix = fixedPrefix;
            config.renameStartNumber = startNumber;
            config.renameRegionText = regionText;
            config.renameChannelText = channelText;
            config.renamePrimaryTag = primaryTag;
            config.renameSecondaryTag = secondaryTag;
            persistCurrentRenameRule();

            return {
                inputFolder,
                outputFolder,
                fixedPrefix,
                startNumber,
                regionText,
                channelText,
                primaryTag,
                secondaryTag
            };
        }

        function getRenameValidationError(payload) {
            if (!payload.inputFolder) return '请输入输入图片文件夹';
            if (!payload.outputFolder) return '请输入输出文件夹';
            if (!payload.fixedPrefix) return '请输入固定前缀';
            if (!/^\d+$/.test(String(payload.startNumber || ''))) return '请输入有效的起始编号';
            if (!payload.regionText) return '请输入区域/代号文本';
            if (!payload.channelText) return '请输入渠道文本';
            if (!payload.primaryTag) return '请选择一级标签';
            if (!payload.secondaryTag) return '请选择二级标签';
            return '';
        }

        function updateRenameExample() {
            const payload = getRenamePayload();
            const sampleChinese = '第一人称驾驶载具上的雪夜护送';
            const sampleDimensions = '800x800';
            const example = [
                `${payload.fixedPrefix}${payload.startNumber || '28930'}`,
                payload.regionText || 'BJ',
                payload.channelText || '广点通',
                payload.primaryTag || '题材',
                payload.secondaryTag || '载具',
                sampleChinese,
                sampleDimensions
            ].filter(Boolean).join('_') + '.png';
            const target = document.getElementById('renameExampleName');
            if (target) target.textContent = example;
        }

        function addRenamePrimaryTag() {
            const primary = getRenameTagInput('primary');
            if (!primary) return showToast('请输入一级标签名称', 'error');

            const tags = getRenameTags();
            if (!tags[primary]) {
                tags[primary] = ['默认'];
            }
            setRenameTags(tags);
            config.renamePrimaryTag = primary;
            config.renameSecondaryTag = tags[primary][0];
            renderRenameTagControls();
            persistCurrentRenameRule();
            showToast('一级标签已添加');
        }

        function deleteRenamePrimaryTag(primary) {
            const tags = getRenameTags();
            if (!primary || !tags[primary]) return;
            if (Object.keys(tags).length <= 1) {
                showToast('至少保留一个一级标签', 'error');
                return;
            }

            delete tags[primary];
            setRenameTags(tags);
            const nextPrimary = Object.keys(tags)[0];
            config.renamePrimaryTag = nextPrimary;
            config.renameSecondaryTag = tags[nextPrimary][0];
            renderRenameTagControls();
            persistCurrentRenameRule();
            showToast('一级标签已删除');
        }

        function addRenameSecondaryTag() {
            const primary = getRenameTagInput('primary') || config.renamePrimaryTag;
            if (!primary) return showToast('请先选择一级标签', 'error');

            const secondary = getRenameTagInput('secondary');
            if (!secondary) return showToast('请输入二级标签名称', 'error');

            const tags = getRenameTags();
            tags[primary] = Array.isArray(tags[primary]) ? tags[primary] : [];
            if (!tags[primary].includes(secondary)) {
                tags[primary].push(secondary);
            }
            setRenameTags(tags);
            config.renamePrimaryTag = primary;
            config.renameSecondaryTag = secondary;
            renderRenameTagControls();
            persistCurrentRenameRule();
            showToast('二级标签已添加');
        }

        function deleteRenameSecondaryTag(secondary) {
            const primary = getRenameTagInput('primary') || config.renamePrimaryTag;
            const tags = getRenameTags();
            if (!primary || !secondary || !Array.isArray(tags[primary])) return;
            if (tags[primary].length <= 1) {
                showToast('至少保留一个二级标签', 'error');
                return;
            }

            tags[primary] = tags[primary].filter(item => item !== secondary);
            setRenameTags(tags);
            config.renamePrimaryTag = primary;
            config.renameSecondaryTag = tags[primary][0];
            renderRenameTagControls();
            persistCurrentRenameRule();
            showToast('二级标签已删除');
        }

        function deleteRenameTag(type, value) {
            if (type === 'primary') {
                deleteRenamePrimaryTag(value);
            } else {
                deleteRenameSecondaryTag(value);
            }
        }

        function setRenameBusy(isBusy) {
            const previewBtn = document.getElementById('renamePreviewBtn');
            const runBtn = document.getElementById('renameRunBtn');
            if (previewBtn) previewBtn.disabled = isBusy;
            if (runBtn) runBtn.disabled = isBusy;
        }

        function setRenameInfo(message, type = '') {
            const info = document.getElementById('renameInfo');
            if (!info) return;
            info.className = `info-box ${type}`.trim();
            info.textContent = message;
        }

        function setRenameStats(text) {
            const stats = document.getElementById('renameStats');
            if (stats) stats.textContent = text;
        }

        function createRenamePreviewItem(item, type = 'ready') {
            const row = document.createElement('div');
            row.className = `rename-preview-item ${type}`;

            const original = document.createElement('div');
            original.className = 'rename-preview-name original';
            original.textContent = item.originalName || '';

            const arrow = document.createElement('div');
            arrow.className = 'rename-preview-arrow';
            arrow.textContent = '→';

            const output = document.createElement('div');
            output.className = 'rename-preview-name output';
            output.textContent = item.outputName || item.reason || '';

            row.appendChild(original);
            row.appendChild(arrow);
            row.appendChild(output);
            return row;
        }

        function renderRenameResults(data) {
            const list = document.getElementById('renamePreviewList');
            if (!list) return;
            list.innerHTML = '';

            if (!data) {
                setRenameStats('尚未生成预览');
                const empty = document.createElement('div');
                empty.className = 'rename-empty';
                empty.textContent = '预览后会显示原文件名和新文件名。';
                list.appendChild(empty);
                return;
            }

            const total = Number(data.totalImages) || 0;
            const ready = Number(data.readyCount ?? data.copiedCount) || 0;
            const skipped = Number(data.skippedCount) || 0;
            const failed = Number(data.failedCount) || 0;
            const copied = Number(data.copiedCount) || 0;
            const outputText = data.copiedCount !== undefined
                ? `已输出 ${copied} / 可处理 ${ready} / 跳过 ${skipped} / 失败 ${failed}`
                : `共 ${total} 张 / 可处理 ${ready} / 跳过 ${skipped}`;
            setRenameStats(outputText);

            const items = Array.isArray(data.items) ? data.items : [];
            const skippedItems = Array.isArray(data.skipped) ? data.skipped : [];
            const failedItems = Array.isArray(data.failed) ? data.failed : [];

            if (items.length === 0 && skippedItems.length === 0 && failedItems.length === 0) {
                const empty = document.createElement('div');
                empty.className = 'rename-empty';
                empty.textContent = '没有可显示的图片。';
                list.appendChild(empty);
                return;
            }

            items.forEach(item => list.appendChild(createRenamePreviewItem(item, 'ready')));
            failedItems.forEach(item => list.appendChild(createRenamePreviewItem(item, 'failed')));
            skippedItems.forEach(item => list.appendChild(createRenamePreviewItem(item, 'skipped')));
        }

        async function previewRenameImages() {
            const payload = getRenamePayload();
            const validationError = getRenameValidationError(payload);
            if (validationError) return showToast(validationError, 'error');

            addFolderHistory('renameInputFolder', payload.inputFolder);
            addFolderHistory('renameOutputFolder', payload.outputFolder);
            setRenameInfo('正在生成预览...', 'loading');
            setRenameBusy(true);

            try {
                const data = await fetchJsonWithTimeout('/api/rename-images/preview', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                }, 60000, '预览命名失败，请重启服务器后刷新页面');

                if (!data.success) {
                    throw new Error(data.message || '预览失败');
                }

                renderRenameResults(data);
                setRenameInfo(data.message || '预览已生成', 'success');
                showToast('命名预览已生成');
            } catch (error) {
                renderRenameResults(null);
                setRenameInfo(error.message || '预览命名失败', 'error');
                showToast(error.message || '预览命名失败', 'error');
            } finally {
                setRenameBusy(false);
            }
        }

        async function runRenameImages() {
            const payload = getRenamePayload();
            const validationError = getRenameValidationError(payload);
            if (validationError) return showToast(validationError, 'error');

            const confirmed = window.confirm('将复制图片到输出文件夹并使用新名称保存，原文件不会修改。是否继续？');
            if (!confirmed) return;

            addFolderHistory('renameInputFolder', payload.inputFolder);
            addFolderHistory('renameOutputFolder', payload.outputFolder);
            setRenameInfo('正在复制并重命名...', 'loading');
            setRenameBusy(true);

            try {
                const data = await fetchJsonWithTimeout('/api/rename-images/run', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                }, 10 * 60 * 1000, '重命名输出失败，请重启服务器后刷新页面');

                renderRenameResults(data);
                if (!data.success) {
                    setRenameInfo(data.message || '重命名输出未完全完成', 'error');
                    showToast(data.message || '重命名输出未完全完成', 'error');
                    return;
                }

                setRenameInfo(data.message || '重命名输出完成', 'success');
                showToast('重命名输出完成');
            } catch (error) {
                setRenameInfo(error.message || '重命名输出失败', 'error');
                showToast(error.message || '重命名输出失败', 'error');
            } finally {
                setRenameBusy(false);
            }
        }

        function loadResizeBatchSettings() {
            try {
                const parsed = JSON.parse(localStorage.getItem(resizeBatchStorageKey) || '{}');
                return parsed && typeof parsed === 'object' ? parsed : {};
            } catch (e) {
                return {};
            }
        }

        function saveResizeBatchSettings() {
            try {
                localStorage.setItem(resizeBatchStorageKey, JSON.stringify({
                    inputFolder: config.resizeBatchInputFolder,
                    outputFolder: config.resizeBatchOutputFolder,
                    targetSize: config.resizeBatchTargetSize
                }));
            } catch (e) {}
        }

        function initResizeBatchPanel() {
            const stored = loadResizeBatchSettings();
            const renameOutputFolder = document.getElementById('renameOutputFolder')?.value.trim() || config.renameOutputFolder;
            const input = document.getElementById('resizeBatchInputFolder');
            const output = document.getElementById('resizeBatchOutputFolder');

            config.resizeBatchInputFolder = normalizeRenameToolFolder(stored.inputFolder || renameOutputFolder || config.resizeBatchInputFolder);
            config.resizeBatchOutputFolder = normalizeRenameToolFolder(stored.outputFolder || config.resizeBatchOutputFolder);
            config.resizeBatchTargetSize = resizeBatchTargetSizes.includes(stored.targetSize)
                ? stored.targetSize
                : (resizeBatchTargetSizes.includes(config.resizeBatchTargetSize) ? config.resizeBatchTargetSize : '800x800');

            if (input) {
                input.value = config.resizeBatchInputFolder;
                addFolderHistory('resizeBatchInputFolder', input.value);
            }
            if (output) {
                output.value = config.resizeBatchOutputFolder;
                addFolderHistory('resizeBatchOutputFolder', output.value);
            }

            updateResizeBatchTargetButtons();
            renderResizeBatchResults(null);
        }

        function setResizeBatchTargetSize(targetSize) {
            if (!resizeBatchTargetSizes.includes(targetSize)) return;
            config.resizeBatchTargetSize = targetSize;
            updateResizeBatchTargetButtons();
            saveResizeBatchSettings();
        }

        function updateResizeBatchTargetButtons() {
            document.querySelectorAll('[data-resize-batch-size]').forEach(button => {
                button.classList.toggle('active', button.dataset.resizeBatchSize === config.resizeBatchTargetSize);
            });
        }

        function getResizeBatchPayload() {
            const inputFolder = document.getElementById('resizeBatchInputFolder')?.value.trim() || '';
            const outputFolder = document.getElementById('resizeBatchOutputFolder')?.value.trim() || '';
            const targetSize = resizeBatchTargetSizes.includes(config.resizeBatchTargetSize)
                ? config.resizeBatchTargetSize
                : '800x800';

            config.resizeBatchInputFolder = inputFolder;
            config.resizeBatchOutputFolder = outputFolder;
            config.resizeBatchTargetSize = targetSize;
            saveResizeBatchSettings();

            return {
                inputFolder,
                outputFolder,
                targetSize
            };
        }

        function getResizeBatchValidationError(payload) {
            if (!payload.inputFolder) return '请输入改尺寸输入目录';
            if (!payload.outputFolder) return '请输入改尺寸输出目录';
            if (!resizeBatchTargetSizes.includes(payload.targetSize)) return '请选择目标尺寸';
            return '';
        }

        function setResizeBatchBusy(isBusy) {
            const previewBtn = document.getElementById('resizeBatchPreviewBtn');
            const runBtn = document.getElementById('resizeBatchRunBtn');
            if (previewBtn) previewBtn.disabled = isBusy;
            if (runBtn) runBtn.disabled = isBusy;
        }

        function setResizeBatchInfo(message, type = '') {
            const info = document.getElementById('resizeBatchImageInfo');
            if (!info) return;
            info.className = `info-box ${type}`.trim();
            info.textContent = message;
        }

        function setResizeBatchStats(text) {
            const stats = document.getElementById('resizeBatchStats');
            if (stats) stats.textContent = text;
        }

        function formatResizeBatchFileSize(bytes) {
            const value = Number(bytes) || 0;
            if (!value) return '';
            return `${Math.round(value / 1024)}KB`;
        }

        function createResizeBatchPreviewItem(item, type = 'ready') {
            const row = document.createElement('div');
            row.className = `rename-preview-item resize-batch-preview-item ${type}`;

            const original = document.createElement('div');
            original.className = 'rename-preview-name original';
            original.textContent = item.originalName || '';

            const arrow = document.createElement('div');
            arrow.className = 'rename-preview-arrow';
            arrow.textContent = '→';

            const output = document.createElement('div');
            output.className = 'rename-preview-name output resize-batch-output-name';

            const outputName = document.createElement('div');
            outputName.textContent = item.outputName || item.reason || '';
            output.appendChild(outputName);

            const metaParts = [];
            if (item.originalDimensions && item.targetDimensions) {
                metaParts.push(`${item.originalDimensions} → ${item.targetDimensions}`);
            }
            if (item.cropSummary) metaParts.push(item.cropSummary);
            if (item.quality) metaParts.push(`质量 ${item.quality}`);
            if (item.sizeBytes) metaParts.push(formatResizeBatchFileSize(item.sizeBytes));
            if (item.reason && item.outputName) metaParts.push(item.reason);

            if (metaParts.length) {
                const meta = document.createElement('div');
                meta.className = 'resize-batch-item-meta';
                meta.textContent = metaParts.join(' / ');
                output.appendChild(meta);
            }

            row.appendChild(original);
            row.appendChild(arrow);
            row.appendChild(output);
            return row;
        }

        function renderResizeBatchResults(data) {
            const list = document.getElementById('resizeBatchPreviewList');
            if (!list) return;
            list.innerHTML = '';

            if (!data) {
                setResizeBatchStats('尚未生成预览');
                const empty = document.createElement('div');
                empty.className = 'rename-empty';
                empty.textContent = '预览后会显示原文件名、新文件名和裁剪方式。';
                list.appendChild(empty);
                return;
            }

            const total = Number(data.totalImages) || 0;
            const ready = Number(data.readyCount ?? data.resizedCount) || 0;
            const skipped = Number(data.skippedCount) || 0;
            const failed = Number(data.failedCount) || 0;
            const resized = Number(data.resizedCount) || 0;
            const outputText = data.resizedCount !== undefined
                ? `已输出 ${resized} / 可处理 ${ready} / 跳过 ${skipped} / 失败 ${failed}`
                : `共 ${total} 张 / 可处理 ${ready} / 跳过 ${skipped}`;
            setResizeBatchStats(outputText);

            const items = Array.isArray(data.items) ? data.items : [];
            const skippedItems = Array.isArray(data.skipped) ? data.skipped : [];
            const failedItems = Array.isArray(data.failed) ? data.failed : [];

            if (items.length === 0 && skippedItems.length === 0 && failedItems.length === 0) {
                const empty = document.createElement('div');
                empty.className = 'rename-empty';
                empty.textContent = '没有可显示的图片。';
                list.appendChild(empty);
                return;
            }

            items.forEach(item => list.appendChild(createResizeBatchPreviewItem(item, 'ready')));
            failedItems.forEach(item => list.appendChild(createResizeBatchPreviewItem(item, 'failed')));
            skippedItems.forEach(item => list.appendChild(createResizeBatchPreviewItem(item, 'skipped')));
        }

        async function previewResizeBatchImages() {
            const payload = getResizeBatchPayload();
            const validationError = getResizeBatchValidationError(payload);
            if (validationError) return showToast(validationError, 'error');

            addFolderHistory('resizeBatchInputFolder', payload.inputFolder);
            addFolderHistory('resizeBatchOutputFolder', payload.outputFolder);
            setResizeBatchInfo('正在生成改尺寸预览...', 'loading');
            setResizeBatchBusy(true);

            try {
                const data = await fetchJsonWithTimeout('/api/resize-images/preview', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                }, 60000, '预览改尺寸失败，请重启服务器后刷新页面');

                if (!data.success) {
                    throw new Error(data.message || '预览失败');
                }

                renderResizeBatchResults(data);
                setResizeBatchInfo(data.message || '改尺寸预览已生成', 'success');
                showToast('改尺寸预览已生成');
            } catch (error) {
                renderResizeBatchResults(null);
                setResizeBatchInfo(error.message || '预览改尺寸失败', 'error');
                showToast(error.message || '预览改尺寸失败', 'error');
            } finally {
                setResizeBatchBusy(false);
            }
        }

        async function runResizeBatchImages() {
            const payload = getResizeBatchPayload();
            const validationError = getResizeBatchValidationError(payload);
            if (validationError) return showToast(validationError, 'error');

            const confirmed = window.confirm('将图片等比缩放并居中裁剪为目标尺寸，统一输出为 JPG，原文件不会修改。是否继续？');
            if (!confirmed) return;

            addFolderHistory('resizeBatchInputFolder', payload.inputFolder);
            addFolderHistory('resizeBatchOutputFolder', payload.outputFolder);
            setResizeBatchInfo('正在批量改尺寸...', 'loading');
            setResizeBatchBusy(true);

            try {
                const data = await fetchJsonWithTimeout('/api/resize-images/run', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                }, 20 * 60 * 1000, '批量改尺寸失败，请重启服务器后刷新页面');

                renderResizeBatchResults(data);
                if (!data.success) {
                    setResizeBatchInfo(data.message || '批量改尺寸未完全完成', 'error');
                    showToast(data.message || '批量改尺寸未完全完成', 'error');
                    return;
                }

                setResizeBatchInfo(data.message || '批量改尺寸完成', 'success');
                showToast('批量改尺寸完成');
            } catch (error) {
                setResizeBatchInfo(error.message || '批量改尺寸失败', 'error');
                showToast(error.message || '批量改尺寸失败', 'error');
            } finally {
                setResizeBatchBusy(false);
            }
        }

        function loadLogoBatchSettings() {
            try {
                const parsed = JSON.parse(localStorage.getItem(logoBatchStorageKey) || '{}');
                return parsed && typeof parsed === 'object' ? parsed : {};
            } catch (e) {
                return {};
            }
        }

        function saveLogoBatchSettings() {
            try {
                localStorage.setItem(logoBatchStorageKey, JSON.stringify({
                    inputFolder: config.logoBatchInputFolder,
                    outputFolder: config.logoBatchOutputFolder,
                    logoFileName: config.logoBatchFileName
                }));
            } catch (e) {}
        }

        function initLogoBatchPanel() {
            const stored = loadLogoBatchSettings();
            const resizeOutputFolder = document.getElementById('resizeBatchOutputFolder')?.value.trim() || config.resizeBatchOutputFolder;
            const input = document.getElementById('logoBatchInputFolder');
            const output = document.getElementById('logoBatchOutputFolder');
            const logoFile = document.getElementById('logoBatchFileName');

            config.logoBatchInputFolder = normalizeRenameToolFolder(stored.inputFolder || resizeOutputFolder || config.logoBatchInputFolder);
            config.logoBatchOutputFolder = normalizeRenameToolFolder(stored.outputFolder || config.logoBatchOutputFolder);
            config.logoBatchFileName = stored.logoFileName || config.logoBatchFileName || defaultLogoBatchFileName;

            if (input) {
                input.value = config.logoBatchInputFolder;
                addFolderHistory('logoBatchInputFolder', input.value);
            }
            if (output) {
                output.value = config.logoBatchOutputFolder;
                addFolderHistory('logoBatchOutputFolder', output.value);
            }
            if (logoFile) {
                logoFile.value = config.logoBatchFileName;
                logoFile.addEventListener('input', () => {
                    config.logoBatchFileName = logoFile.value.trim();
                    saveLogoBatchSettings();
                });
            }

            renderLogoBatchResults(null);
        }

        function getLogoBatchPayload() {
            const inputFolder = document.getElementById('logoBatchInputFolder')?.value.trim() || '';
            const outputFolder = document.getElementById('logoBatchOutputFolder')?.value.trim() || '';
            const logoFileName = document.getElementById('logoBatchFileName')?.value.trim() || '';

            config.logoBatchInputFolder = inputFolder;
            config.logoBatchOutputFolder = outputFolder;
            config.logoBatchFileName = logoFileName;
            saveLogoBatchSettings();

            return {
                inputFolder,
                outputFolder,
                logoFileName
            };
        }

        function getLogoBatchValidationError(payload) {
            if (!payload.inputFolder) return '请输入待处理图片目录';
            if (!payload.outputFolder) return '请输入加LOGO输出目录';
            if (!payload.logoFileName) return '请输入LOGO文件名称';
            return '';
        }

        function setLogoBatchBusy(isBusy) {
            const previewBtn = document.getElementById('logoBatchPreviewBtn');
            const runBtn = document.getElementById('logoBatchRunBtn');
            if (previewBtn) previewBtn.disabled = isBusy;
            if (runBtn) runBtn.disabled = isBusy;
        }

        function setLogoBatchInfo(message, type = '') {
            const info = document.getElementById('logoBatchInfo');
            if (!info) return;
            info.className = `info-box ${type}`.trim();
            info.textContent = message;
        }

        function setLogoBatchStats(text) {
            const stats = document.getElementById('logoBatchStats');
            if (stats) stats.textContent = text;
        }

        function createLogoBatchPreviewItem(item, type = 'ready') {
            const row = document.createElement('div');
            row.className = `rename-preview-item logo-batch-preview-item ${type}`;

            const original = document.createElement('div');
            original.className = 'rename-preview-name original';
            original.textContent = item.originalName || '';

            const arrow = document.createElement('div');
            arrow.className = 'rename-preview-arrow';
            arrow.textContent = '→';

            const output = document.createElement('div');
            output.className = 'rename-preview-name output resize-batch-output-name';

            const outputName = document.createElement('div');
            outputName.textContent = item.outputName || item.reason || '';
            output.appendChild(outputName);

            const metaParts = [];
            if (item.originalDimensions) metaParts.push(item.originalDimensions);
            if (item.logoFileName) metaParts.push(`LOGO ${item.logoFileName}`);
            if (item.logoDimensions) metaParts.push(`LOGO尺寸 ${item.logoDimensions}`);
            if (item.quality) metaParts.push(`质量 ${item.quality}`);
            if (item.sizeBytes) metaParts.push(formatResizeBatchFileSize(item.sizeBytes));
            if (item.reason && item.outputName) metaParts.push(item.reason);

            if (metaParts.length) {
                const meta = document.createElement('div');
                meta.className = 'resize-batch-item-meta';
                meta.textContent = metaParts.join(' / ');
                output.appendChild(meta);
            }

            row.appendChild(original);
            row.appendChild(arrow);
            row.appendChild(output);
            return row;
        }

        function renderLogoBatchResults(data) {
            const list = document.getElementById('logoBatchPreviewList');
            if (!list) return;
            list.innerHTML = '';

            if (!data) {
                setLogoBatchStats('尚未生成预览');
                const empty = document.createElement('div');
                empty.className = 'rename-empty';
                empty.textContent = '预览后会显示原文件名、输出文件名和LOGO尺寸。';
                list.appendChild(empty);
                return;
            }

            const total = Number(data.totalImages) || 0;
            const ready = Number(data.readyCount ?? data.appliedCount) || 0;
            const skipped = Number(data.skippedCount) || 0;
            const failed = Number(data.failedCount) || 0;
            const applied = Number(data.appliedCount) || 0;
            const outputText = data.appliedCount !== undefined
                ? `已输出 ${applied} / 可处理 ${ready} / 跳过 ${skipped} / 失败 ${failed}`
                : `共 ${total} 张 / 可处理 ${ready} / 跳过 ${skipped}`;
            setLogoBatchStats(outputText);

            const items = Array.isArray(data.items) ? data.items : [];
            const skippedItems = Array.isArray(data.skipped) ? data.skipped : [];
            const failedItems = Array.isArray(data.failed) ? data.failed : [];

            if (items.length === 0 && skippedItems.length === 0 && failedItems.length === 0) {
                const empty = document.createElement('div');
                empty.className = 'rename-empty';
                empty.textContent = '没有可显示的图片。';
                list.appendChild(empty);
                return;
            }

            items.forEach(item => list.appendChild(createLogoBatchPreviewItem(item, 'ready')));
            failedItems.forEach(item => list.appendChild(createLogoBatchPreviewItem(item, 'failed')));
            skippedItems.forEach(item => list.appendChild(createLogoBatchPreviewItem(item, 'skipped')));
        }

        async function previewLogoBatchImages() {
            const payload = getLogoBatchPayload();
            const validationError = getLogoBatchValidationError(payload);
            if (validationError) return showToast(validationError, 'error');

            addFolderHistory('logoBatchInputFolder', payload.inputFolder);
            addFolderHistory('logoBatchOutputFolder', payload.outputFolder);
            setLogoBatchInfo('正在生成加LOGO预览...', 'loading');
            setLogoBatchBusy(true);

            try {
                const data = await fetchJsonWithTimeout('/api/logo-overlay/preview', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                }, 60000, '预览加LOGO失败，请重启服务器后刷新页面');

                if (!data.success) {
                    throw new Error(data.message || '预览失败');
                }

                renderLogoBatchResults(data);
                const logoText = data.config?.logoDimensions
                    ? `${data.message}，LOGO尺寸 ${data.config.logoDimensions}`
                    : (data.message || '加LOGO预览已生成');
                setLogoBatchInfo(logoText, 'success');
                showToast('加LOGO预览已生成');
            } catch (error) {
                renderLogoBatchResults(null);
                setLogoBatchInfo(error.message || '预览加LOGO失败', 'error');
                showToast(error.message || '预览加LOGO失败', 'error');
            } finally {
                setLogoBatchBusy(false);
            }
        }

        async function runLogoBatchImages() {
            const payload = getLogoBatchPayload();
            const validationError = getLogoBatchValidationError(payload);
            if (validationError) return showToast(validationError, 'error');

            const confirmed = window.confirm('将把同目录中的PNG LOGO原样覆盖到其它图片上，统一输出为JPG，原文件不会修改。是否继续？');
            if (!confirmed) return;

            addFolderHistory('logoBatchInputFolder', payload.inputFolder);
            addFolderHistory('logoBatchOutputFolder', payload.outputFolder);
            setLogoBatchInfo('正在批量加LOGO...', 'loading');
            setLogoBatchBusy(true);

            try {
                const data = await fetchJsonWithTimeout('/api/logo-overlay/run', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                }, 20 * 60 * 1000, '批量加LOGO失败，请重启服务器后刷新页面');

                renderLogoBatchResults(data);
                if (!data.success) {
                    setLogoBatchInfo(data.message || '批量加LOGO未完全完成', 'error');
                    showToast(data.message || '批量加LOGO未完全完成', 'error');
                    return;
                }

                setLogoBatchInfo(data.message || '批量加LOGO完成', 'success');
                showToast('批量加LOGO完成');
            } catch (error) {
                setLogoBatchInfo(error.message || '批量加LOGO失败', 'error');
                showToast(error.message || '批量加LOGO失败', 'error');
            } finally {
                setLogoBatchBusy(false);
            }
        }

        function loadPackageBatchSettings() {
            try {
                const parsed = JSON.parse(localStorage.getItem(packageBatchStorageKey) || '{}');
                return parsed && typeof parsed === 'object' ? parsed : {};
            } catch (e) {
                return {};
            }
        }

        function savePackageBatchSettings() {
            try {
                localStorage.setItem(packageBatchStorageKey, JSON.stringify({
                    inputFolder: config.packageBatchInputFolder,
                    outputFolder: config.packageBatchOutputFolder
                }));
            } catch (e) {}
        }

        function initPackageBatchPanel() {
            const stored = loadPackageBatchSettings();
            const logoOutputFolder = document.getElementById('logoBatchOutputFolder')?.value.trim() || config.logoBatchOutputFolder;
            const input = document.getElementById('packageBatchInputFolder');
            const output = document.getElementById('packageBatchOutputFolder');

            config.packageBatchInputFolder = normalizeRenameToolFolder(stored.inputFolder || logoOutputFolder || config.packageBatchInputFolder);
            config.packageBatchOutputFolder = normalizeRenameToolFolder(stored.outputFolder || config.packageBatchOutputFolder || defaultPackageBatchOutputFolder);

            if (input) {
                input.value = config.packageBatchInputFolder;
                addFolderHistory('packageBatchInputFolder', input.value);
            }
            if (output) {
                output.value = config.packageBatchOutputFolder;
                addFolderHistory('packageBatchOutputFolder', output.value);
            }

            renderPackageBatchResults(null);
        }

        function getPackageBatchPayload() {
            const inputFolder = document.getElementById('packageBatchInputFolder')?.value.trim() || '';
            const outputFolder = document.getElementById('packageBatchOutputFolder')?.value.trim() || '';

            config.packageBatchInputFolder = inputFolder;
            config.packageBatchOutputFolder = outputFolder;
            savePackageBatchSettings();

            return {
                inputFolder,
                outputFolder
            };
        }

        function getPackageBatchValidationError(payload) {
            if (!payload.inputFolder) return '请输入待打包图片目录';
            if (!payload.outputFolder) return '请输入打包输出目录';
            return '';
        }

        function setPackageBatchBusy(isBusy) {
            const previewBtn = document.getElementById('packageBatchPreviewBtn');
            const runBtn = document.getElementById('packageBatchRunBtn');
            if (previewBtn) previewBtn.disabled = isBusy;
            if (runBtn) runBtn.disabled = isBusy;
        }

        function setPackageBatchInfo(message, type = '') {
            const info = document.getElementById('packageBatchInfo');
            if (!info) return;
            info.className = `info-box ${type}`.trim();
            info.textContent = message;
        }

        function setPackageBatchStats(text) {
            const stats = document.getElementById('packageBatchStats');
            if (stats) stats.textContent = text;
        }

        function createPackageBatchPreviewItem(item, type = 'ready') {
            const row = document.createElement('div');
            row.className = `rename-preview-item package-batch-preview-item ${type}`;

            const original = document.createElement('div');
            original.className = 'rename-preview-name original';
            original.textContent = item.originalName || item.groupName || '';

            const arrow = document.createElement('div');
            arrow.className = 'rename-preview-arrow';
            arrow.textContent = '→';

            const output = document.createElement('div');
            output.className = 'rename-preview-name output resize-batch-output-name';

            const outputName = document.createElement('div');
            outputName.textContent = item.outputName || item.folderName || item.reason || '';
            output.appendChild(outputName);

            const metaParts = [];
            const sizes = Array.isArray(item.sizes) ? item.sizes.filter(Boolean) : [];
            const files = Array.isArray(item.files) ? item.files : [];

            if (item.fileCount) metaParts.push(`${item.fileCount} 张`);
            if (sizes.length) metaParts.push(`尺寸 ${sizes.join(' / ')}`);
            if (files.length) metaParts.push(files.map(file => `${file.size || '-'}：${file.originalName || ''}`).join('；'));
            if (item.reason && (item.outputName || item.folderName)) metaParts.push(item.reason);

            if (metaParts.length) {
                const meta = document.createElement('div');
                meta.className = 'resize-batch-item-meta';
                meta.textContent = metaParts.join(' / ');
                output.appendChild(meta);
            }

            row.appendChild(original);
            row.appendChild(arrow);
            row.appendChild(output);
            return row;
        }

        function renderPackageBatchResults(data) {
            const list = document.getElementById('packageBatchPreviewList');
            if (!list) return;
            list.innerHTML = '';

            if (!data) {
                setPackageBatchStats('尚未生成预览');
                const empty = document.createElement('div');
                empty.className = 'rename-empty';
                empty.textContent = '预览后会显示每组文件夹名、三张尺寸图和跳过原因。';
                list.appendChild(empty);
                return;
            }

            const totalImages = Number(data.totalImages) || 0;
            const totalGroups = Number(data.totalGroups) || 0;
            const ready = Number(data.readyCount ?? data.packagedCount) || 0;
            const skipped = Number(data.skippedCount) || 0;
            const failed = Number(data.failedCount) || 0;
            const packaged = Number(data.packagedCount) || 0;
            const outputText = data.packagedCount !== undefined
                ? `已打包 ${packaged} 组 / 可打包 ${ready} 组 / 跳过 ${skipped} 项 / 失败 ${failed} 组`
                : `共 ${totalImages} 张 / ${totalGroups} 组 / 可打包 ${ready} 组 / 跳过 ${skipped} 项`;
            setPackageBatchStats(outputText);

            const items = Array.isArray(data.items) ? data.items : [];
            const skippedItems = Array.isArray(data.skipped) ? data.skipped : [];
            const failedItems = Array.isArray(data.failed) ? data.failed : [];

            if (items.length === 0 && skippedItems.length === 0 && failedItems.length === 0) {
                const empty = document.createElement('div');
                empty.className = 'rename-empty';
                empty.textContent = '没有可显示的图片。';
                list.appendChild(empty);
                return;
            }

            items.forEach(item => list.appendChild(createPackageBatchPreviewItem(item, 'ready')));
            failedItems.forEach(item => list.appendChild(createPackageBatchPreviewItem(item, 'failed')));
            skippedItems.forEach(item => list.appendChild(createPackageBatchPreviewItem(item, 'skipped')));
        }

        async function previewPackageBatchImages() {
            const payload = getPackageBatchPayload();
            const validationError = getPackageBatchValidationError(payload);
            if (validationError) return showToast(validationError, 'error');

            addFolderHistory('packageBatchInputFolder', payload.inputFolder);
            addFolderHistory('packageBatchOutputFolder', payload.outputFolder);
            setPackageBatchInfo('正在生成打包预览...', 'loading');
            setPackageBatchBusy(true);

            try {
                const data = await fetchJsonWithTimeout('/api/package-images/preview', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                }, 60000, '预览打包失败，请重启服务器后刷新页面');

                if (!data.success) {
                    throw new Error(data.message || '预览失败');
                }

                renderPackageBatchResults(data);
                const requiredText = Array.isArray(data.config?.requiredSizes)
                    ? `，目标尺寸 ${data.config.requiredSizes.join(' / ')}`
                    : '';
                setPackageBatchInfo(`${data.message || '打包预览已生成'}${requiredText}`, 'success');
                showToast('打包预览已生成');
            } catch (error) {
                renderPackageBatchResults(null);
                setPackageBatchInfo(error.message || '预览打包失败', 'error');
                showToast(error.message || '预览打包失败', 'error');
            } finally {
                setPackageBatchBusy(false);
            }
        }

        async function runPackageBatchImages() {
            const payload = getPackageBatchPayload();
            const validationError = getPackageBatchValidationError(payload);
            if (validationError) return showToast(validationError, 'error');

            const confirmed = window.confirm(`将按 ${packageBatchTargetSizes.join(' / ')} 三种尺寸把同组图片复制到新文件夹，原文件不会修改。是否继续？`);
            if (!confirmed) return;

            addFolderHistory('packageBatchInputFolder', payload.inputFolder);
            addFolderHistory('packageBatchOutputFolder', payload.outputFolder);
            setPackageBatchInfo('正在批量打包文件夹...', 'loading');
            setPackageBatchBusy(true);

            try {
                const data = await fetchJsonWithTimeout('/api/package-images/run', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                }, 10 * 60 * 1000, '批量打包失败，请重启服务器后刷新页面');

                renderPackageBatchResults(data);
                if (!data.success) {
                    setPackageBatchInfo(data.message || '批量打包未完全完成', 'error');
                    showToast(data.message || '批量打包未完全完成', 'error');
                    return;
                }

                setPackageBatchInfo(data.message || '批量打包完成', 'success');
                showToast('批量打包完成');
            } catch (error) {
                setPackageBatchInfo(error.message || '批量打包失败', 'error');
                showToast(error.message || '批量打包失败', 'error');
            } finally {
                setPackageBatchBusy(false);
            }
        }
