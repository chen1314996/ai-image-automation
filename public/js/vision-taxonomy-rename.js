(function () {
    const INCLUDED_STATUSES = ['seed', 'accepted'];
    const STORAGE_KEY = 'visionTaxonomyRename.currentRunId';

    let currentVisionRenameRunId = '';
    let currentVisionRenameStatus = '';
    let currentVisionRenameResumable = false;
    let currentVisionRenameApplyReady = false;
    let visionRenameRunning = false;
    let visionRenameInitialized = false;
    let visionRenameCountTimer = null;
    let countInFlight = null;
    let countInFlightKey = '';
    let lastCountKey = '';
    let lastCountAt = 0;
    let lastCountResult = null;

    function $(id) {
        return document.getElementById(id);
    }

    function normalizeKey(value) {
        return String(value || '').trim().toLowerCase();
    }

    function readVisionRenameInput() {
        return $('visionRenameInputFolder')?.value.trim() ||
            $('deliveryInputFolder')?.value.trim() ||
            $('renameInputFolder')?.value.trim() ||
            '';
    }

    function readIncludedStatuses() {
        const raw = $('visionRenameStatuses')?.value.trim();
        if (!raw) return INCLUDED_STATUSES.slice();
        const statuses = raw.split(',').map(item => item.trim()).filter(Boolean);
        return statuses.length ? statuses : INCLUDED_STATUSES.slice();
    }

    function createVisionRenameRunId() {
        const stamp = new Date()
            .toISOString()
            .replace(/\D/g, '')
            .slice(0, 14);
        const random = Math.random().toString(36).slice(2, 8);
        return `vtr_${stamp}_${random}`;
    }

    function saveCurrentRunId(runId) {
        currentVisionRenameRunId = runId || '';
        try {
            if (currentVisionRenameRunId) {
                localStorage.setItem(STORAGE_KEY, currentVisionRenameRunId);
            } else {
                localStorage.removeItem(STORAGE_KEY);
            }
        } catch (_) {}
    }

    function setVisionRenameInfo(message, type = '') {
        const info = $('visionRenameInfo');
        if (!info) return;
        info.className = `info-box ${type}`.trim();
        info.textContent = message;
    }

    function setVisionRenameButtons() {
        const previewBtn = $('visionRenamePreviewBtn');
        const resumeBtn = $('visionRenameResumeBtn');
        const stopBtn = $('visionRenameStopBtn');
        const applyBtn = $('visionRenameApplyBtn');
        const reportBtn = $('visionRenameReportBtn');
        if (previewBtn) previewBtn.disabled = visionRenameRunning;
        if (resumeBtn) resumeBtn.disabled = visionRenameRunning || !currentVisionRenameRunId || !currentVisionRenameResumable;
        if (stopBtn) stopBtn.disabled = !visionRenameRunning || !currentVisionRenameRunId;
        if (applyBtn) applyBtn.disabled = visionRenameRunning || !currentVisionRenameRunId || !currentVisionRenameApplyReady;
        if (reportBtn) reportBtn.disabled = !currentVisionRenameRunId;
    }

    function setVisionRenameBusy(isBusy) {
        visionRenameRunning = isBusy;
        setVisionRenameButtons();
    }

    function setVisionRenameStats(text) {
        const stats = $('visionRenameStats');
        if (stats) stats.textContent = text;
    }

    function setVisionRenameCount(text, type = '') {
        const target = $('visionRenameImageCount');
        if (!target) return;
        target.className = `field-meta vision-folder-count ${type}`.trim();
        target.textContent = text;
    }

    function publicItemFromRow(row = {}) {
        return {
            status: row.status || '',
            oldName: row.oldName || '',
            newName: row.newName || '',
            confidence: row.confidence,
            confidenceBand: row.confidenceBand || '',
            tagPath: [row.primaryTag, row.secondaryTag, row.tertiaryTag, row.subTag].filter(Boolean).join('/'),
            contentTitle: row.contentTitle || '',
            uncertainty: row.uncertainty || '',
            error: row.error || ''
        };
    }

    function normalizeRunResponse(data) {
        if (data && data.run && !data.items) {
            const run = data.run;
            return {
                success: data.success,
                runId: run.runId,
                status: run.status,
                summary: run.summary || {},
                items: Array.isArray(run.rows) ? run.rows.map(publicItemFromRow) : [],
                resumable: ['running', 'cancelled'].includes(run.status),
                applyReady: run.status === 'previewed',
                message: data.message || ''
            };
        }
        return data || {};
    }

    function renderVisionRenameItems(items = []) {
        const list = $('visionRenamePreviewList');
        if (!list) return;
        list.innerHTML = '';

        if (!Array.isArray(items) || !items.length) {
            const empty = document.createElement('div');
            empty.className = 'rename-empty';
            empty.textContent = '预览后会显示原文件名、新文件名、标签路径和置信度。';
            list.appendChild(empty);
            return;
        }

        items.forEach(item => {
            const row = document.createElement('div');
            const type = item.error ? 'failed' : (item.confidenceBand === 'strong' ? 'ready' : 'skipped');
            row.className = `rename-preview-item ${type}`;

            const original = document.createElement('div');
            original.className = 'rename-preview-name original';
            original.textContent = item.oldName || '';

            const arrow = document.createElement('div');
            arrow.className = 'rename-preview-arrow';
            arrow.textContent = '→';

            const output = document.createElement('div');
            output.className = 'rename-preview-name output';

            const name = document.createElement('div');
            name.textContent = item.newName || item.error || '';
            output.appendChild(name);

            const metaParts = [];
            if (item.confidenceBand) metaParts.push(item.confidenceBand);
            if (Number.isFinite(Number(item.confidence))) metaParts.push(`置信度 ${Number(item.confidence).toFixed(2)}`);
            if (item.tagPath) metaParts.push(item.tagPath);
            if (item.uncertainty) metaParts.push(item.uncertainty);
            if (metaParts.length) {
                const meta = document.createElement('div');
                meta.className = 'resize-batch-item-meta';
                meta.textContent = metaParts.join(' / ');
                output.appendChild(meta);
            }

            row.appendChild(original);
            row.appendChild(arrow);
            row.appendChild(output);
            list.appendChild(row);
        });
    }

    function renderVisionRenameResult(rawData) {
        const data = normalizeRunResponse(rawData);
        const summary = data && data.summary ? data.summary : {};
        const total = Number(summary.total) || 0;
        const completed = Number(summary.completed) || 0;
        const planned = Number(summary.planned ?? summary.renamed) || 0;
        const strong = Number(summary.strong) || 0;
        const weak = Number(summary.weak) || 0;
        const low = Number(summary.low) || 0;
        const failed = Number(summary.failed) || 0;
        const applied = Number(summary.renamed) || 0;
        const prefix = summary.mode === 'apply'
            ? `已重命名 ${applied}`
            : `预览 ${planned}`;
        const progress = total && completed < total ? ` / 已完成 ${completed}/${total}` : ` / 总 ${total}`;
        setVisionRenameStats(`${prefix}${progress} / strong ${strong} / weak ${weak} / low ${low} / 失败 ${failed}`);
        renderVisionRenameItems(Array.isArray(data.items) ? data.items : []);
    }

    function updateRunState(rawData) {
        const data = normalizeRunResponse(rawData);
        saveCurrentRunId(data.runId || currentVisionRenameRunId);
        currentVisionRenameStatus = data.status || '';
        currentVisionRenameResumable = data.resumable === true || ['running', 'cancelled'].includes(currentVisionRenameStatus);
        currentVisionRenameApplyReady = data.applyReady === true || currentVisionRenameStatus === 'previewed';
        setVisionRenameButtons();
        return data;
    }

    async function loadVisionRenameTaxonomyStatus() {
        const target = $('visionRenameTaxonomyInfo');
        if (!target) return;
        try {
            const query = new URLSearchParams();
            readIncludedStatuses().forEach(status => query.append('includeStatuses', status));
            const response = await fetch(`/api/vision-taxonomy-rename/taxonomy-status?${query.toString()}`);
            const data = await response.json();
            if (!response.ok || !data.success) throw new Error(data.message || '读取方向库失败');
            target.textContent = `方向库：知识库当前方向库，使用可用方向 seed/accepted，共 ${data.directionCount || 0} 条；不含归档/禁用方向。版本 ${data.fingerprint || '--'}`;
        } catch (error) {
            target.textContent = error.message || '方向库状态读取失败';
        }
    }

    async function refreshVisionRenameImageCount(options = {}) {
        const inputFolder = readVisionRenameInput();
        const key = normalizeKey(inputFolder);
        if (!inputFolder) {
            setVisionRenameCount('输入文件夹后自动统计图片数量。');
            return { success: false, count: 0 };
        }

        const now = Date.now();
        if (countInFlight && countInFlightKey === key) {
            return countInFlight;
        }
        if (lastCountResult && lastCountKey === key && now - lastCountAt < 1500) {
            return lastCountResult;
        }

        if (!options.silent) {
            setVisionRenameCount('正在统计图片数量...', 'loading');
        }

        countInFlightKey = key;
        countInFlight = fetch('/api/count-images', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ folderPath: inputFolder })
        })
            .then(async response => {
                const data = await response.json();
                if (!response.ok || !data.success) {
                    throw new Error(data.message || '读取图片数量失败');
                }
                setVisionRenameCount(`已识别 ${data.count || 0} 张图片。`);
                lastCountKey = key;
                lastCountAt = Date.now();
                lastCountResult = data;
                return data;
            })
            .catch(error => {
                setVisionRenameCount(error.message || '读取图片数量失败', 'error');
                return { success: false, count: 0, message: error.message };
            })
            .finally(() => {
                countInFlight = null;
                countInFlightKey = '';
            });

        return countInFlight;
    }

    function queueVisionRenameImageCount() {
        window.clearTimeout(visionRenameCountTimer);
        visionRenameCountTimer = window.setTimeout(() => {
            refreshVisionRenameImageCount({ silent: true });
        }, 500);
    }

    function getVisionRenamePayload(runId, options = {}) {
        return {
            runId,
            resume: options.resume === true,
            inputFolder: readVisionRenameInput(),
            mode: 'in-place',
            minConfidence: Number($('visionRenameMinConfidence')?.value || 0.8),
            lowConfidencePolicy: 'apply-weak',
            includeStatuses: readIncludedStatuses(),
            force: false
        };
    }

    async function runVisionTaxonomyPreview(options = {}) {
        const runId = options.resume ? currentVisionRenameRunId : createVisionRenameRunId();
        const payload = getVisionRenamePayload(runId, options);
        if (!payload.inputFolder) {
            if (typeof showToast === 'function') showToast('请选择需要智能视觉重命名的图片文件夹', 'error');
            return;
        }

        saveCurrentRunId(runId);
        currentVisionRenameResumable = false;
        currentVisionRenameApplyReady = false;
        const reportBtn = $('visionRenameReportBtn');
        if (reportBtn) reportBtn.disabled = true;
        setVisionRenameBusy(true);
        setVisionRenameInfo(options.resume ? '正在继续上次视觉分析预览...' : '正在调用视觉模型分析图片，可随时停止本次预览...', 'loading');
        setVisionRenameStats(options.resume ? '继续分析中...' : '分析中...');
        if (!options.resume) renderVisionRenameItems([]);

        try {
            await refreshVisionRenameImageCount({ silent: true });
            if (typeof addFolderHistory === 'function') {
                addFolderHistory('visionRenameInputFolder', payload.inputFolder);
            }
            const data = await fetchJsonWithTimeout('/api/vision-taxonomy-rename/preview', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            }, 60 * 60 * 1000, '智能视觉重命名预览失败');

            const normalized = updateRunState(data);
            renderVisionRenameResult(normalized);
            if (normalized.cancelled) {
                setVisionRenameInfo(normalized.message || '视觉分析预览已停止，可继续上次预览', 'warning');
                if (typeof showToast === 'function') showToast('视觉分析预览已停止');
                return;
            }

            if (!normalized.success) throw new Error(normalized.message || '智能视觉重命名预览失败');
            setVisionRenameInfo(normalized.message || '视觉分析预览完成', 'success');
            if (typeof showToast === 'function') showToast('智能视觉重命名预览完成');
        } catch (error) {
            currentVisionRenameResumable = !!currentVisionRenameRunId;
            currentVisionRenameApplyReady = false;
            setVisionRenameInfo(error.message || '智能视觉重命名预览失败', 'error');
            if (typeof showToast === 'function') showToast(error.message || '智能视觉重命名预览失败', 'error');
        } finally {
            setVisionRenameBusy(false);
        }
    }

    function previewVisionTaxonomyRename() {
        return runVisionTaxonomyPreview({ resume: false });
    }

    function resumeVisionTaxonomyRename() {
        if (!currentVisionRenameRunId) {
            if (typeof showToast === 'function') showToast('没有可继续的视觉分析预览', 'error');
            return;
        }
        return runVisionTaxonomyPreview({ resume: true });
    }

    async function stopVisionTaxonomyRename() {
        if (!visionRenameRunning || !currentVisionRenameRunId) return;
        const stopBtn = $('visionRenameStopBtn');
        if (stopBtn) stopBtn.disabled = true;
        setVisionRenameInfo('正在停止视觉分析预览，已发出的模型请求会尽快中断...', 'loading');

        try {
            const response = await fetch('/api/vision-taxonomy-rename/cancel', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ runId: currentVisionRenameRunId })
            });
            const data = await response.json();
            if (!response.ok || !data.success) throw new Error(data.message || '停止预览失败');
            currentVisionRenameResumable = true;
            currentVisionRenameApplyReady = false;
            setVisionRenameButtons();
            if (typeof showToast === 'function') showToast(data.message || '已发送停止指令');
        } catch (error) {
            setVisionRenameInfo(error.message || '停止预览失败', 'error');
            if (typeof showToast === 'function') showToast(error.message || '停止预览失败', 'error');
            if (stopBtn) stopBtn.disabled = false;
        }
    }

    async function applyVisionTaxonomyRename() {
        if (!currentVisionRenameRunId) {
            if (typeof showToast === 'function') showToast('请先生成智能视觉重命名预览', 'error');
            return;
        }
        const confirmed = window.confirm('将按预览结果在原文件夹内直接重命名图片。是否继续？');
        if (!confirmed) return;

        setVisionRenameBusy(true);
        setVisionRenameInfo('正在原地应用重命名...', 'loading');
        try {
            const data = await fetchJsonWithTimeout('/api/vision-taxonomy-rename/apply', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ runId: currentVisionRenameRunId, applyMode: 'all-suggestions' })
            }, 10 * 60 * 1000, '原地应用重命名失败');
            const normalized = updateRunState(data);
            renderVisionRenameResult(normalized);
            setVisionRenameInfo(normalized.message || '原地重命名完成', normalized.success ? 'success' : 'error');
            if (typeof showToast === 'function') showToast(normalized.message || '原地重命名完成', normalized.success ? 'success' : 'error');
            refreshVisionRenameImageCount({ silent: true });
        } catch (error) {
            setVisionRenameInfo(error.message || '原地应用重命名失败', 'error');
            if (typeof showToast === 'function') showToast(error.message || '原地应用重命名失败', 'error');
        } finally {
            setVisionRenameBusy(false);
        }
    }

    function openVisionRenameReport() {
        if (!currentVisionRenameRunId) return;
        window.open(`/api/vision-taxonomy-rename/runs/${encodeURIComponent(currentVisionRenameRunId)}/report.csv`, '_blank');
    }

    async function restoreVisionRenameRun() {
        let storedRunId = '';
        try {
            storedRunId = localStorage.getItem(STORAGE_KEY) || '';
        } catch (_) {}
        if (!storedRunId) return;

        try {
            const response = await fetch(`/api/vision-taxonomy-rename/runs/${encodeURIComponent(storedRunId)}`);
            if (!response.ok) return;
            const data = normalizeRunResponse(await response.json());
            if (!data.runId) return;
            updateRunState(data);
            renderVisionRenameResult(data);
            if (data.summary?.inputFolder && $('visionRenameInputFolder') && !$('visionRenameInputFolder').value) {
                $('visionRenameInputFolder').value = data.summary.inputFolder;
            }
            if (data.resumable) {
                setVisionRenameInfo(`已恢复上次预览进度：${data.summary?.completed || 0}/${data.summary?.total || 0}，可继续上次预览。`, 'warning');
            } else if (data.applyReady) {
                setVisionRenameInfo('已恢复上次完整预览，可直接应用重命名或重新预览。', 'success');
            }
        } catch (_) {}
    }

    function initVisionTaxonomyRenamePage() {
        if (visionRenameInitialized) {
            setVisionRenameButtons();
            return;
        }
        visionRenameInitialized = true;

        const input = $('visionRenameInputFolder');
        const fallback = $('deliveryInputFolder')?.value.trim() ||
            $('renameInputFolder')?.value.trim() ||
            '';
        if (input && !input.value && fallback) {
            input.value = fallback;
        }
        if (input && typeof addFolderHistory === 'function' && input.value) {
            addFolderHistory('visionRenameInputFolder', input.value);
        }

        input?.addEventListener('blur', () => refreshVisionRenameImageCount({ silent: true }));
        input?.addEventListener('change', queueVisionRenameImageCount);
        input?.addEventListener('input', queueVisionRenameImageCount);
        input?.addEventListener('keydown', event => {
            if (event.key === 'Enter') {
                event.preventDefault();
                input.blur();
                refreshVisionRenameImageCount({ silent: true });
            }
        });

        $('visionRenamePreviewBtn')?.addEventListener('click', previewVisionTaxonomyRename);
        $('visionRenameResumeBtn')?.addEventListener('click', resumeVisionTaxonomyRename);
        $('visionRenameStopBtn')?.addEventListener('click', stopVisionTaxonomyRename);
        $('visionRenameApplyBtn')?.addEventListener('click', applyVisionTaxonomyRename);
        $('visionRenameReportBtn')?.addEventListener('click', openVisionRenameReport);

        renderVisionRenameItems([]);
        setVisionRenameButtons();
        window.loadVisionRenameTaxonomyStatus();
        restoreVisionRenameRun();
    }

    window.initVisionTaxonomyRenamePage = initVisionTaxonomyRenamePage;
    window.loadVisionRenameTaxonomyStatus = loadVisionRenameTaxonomyStatus;
    window.refreshVisionRenameImageCount = refreshVisionRenameImageCount;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initVisionTaxonomyRenamePage);
    } else {
        initVisionTaxonomyRenamePage();
    }
})();
