const taskWorkbookState = {
    imports: [],
    currentImportId: '',
    summary: null,
    taskDirections: [],
    hierarchyDefinitions: [],
    visionStatus: null,
    visionResults: [],
    selectedIds: new Set(),
    activeGroupKey: '',
    searchText: '',
    statusFilter: 'all',
    groupLevel: 4,
    activeDetailId: '',
    pollTimer: null,
    importing: false
};

const TASK_WORKBOOK_CREATIVE_BRIEF_KEY = 'material-analysis-creative-brief-v1';

function taskWorkbookEl(tagName, className = '', text = '') {
    const el = document.createElement(tagName);
    if (className) el.className = className;
    if (text !== undefined && text !== null && text !== '') el.textContent = String(text);
    return el;
}

function taskWorkbookSetInfo(type, text) {
    const box = document.getElementById('taskWorkbookImportInfo');
    if (!box) return;
    box.className = `info-box ${type || ''}`.trim();
    box.textContent = text;
}

function taskWorkbookShortDate(value) {
    if (!value) return '--';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '--';
    return date.toLocaleString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function taskWorkbookReadResponse(response, fallbackMessage) {
    const routeMissingMessage = `${fallbackMessage}（HTTP 404）。后端任务表接口未加载，请重启服务后再试。`;
    return response.json()
        .catch(() => {
            throw new Error(response.status === 404
                ? routeMissingMessage
                : `${fallbackMessage}（HTTP ${response.status}）`);
        })
        .then(data => {
            if (!response.ok) {
                throw new Error(data.message || (response.status === 404
                    ? routeMissingMessage
                    : `${fallbackMessage}（HTTP ${response.status}）`));
            }
            return data;
        });
}

function taskWorkbookReadFileAsBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('读取任务表文件失败'));
        reader.onload = () => {
            const result = String(reader.result || '');
            const comma = result.indexOf(',');
            resolve({
                fileName: file.name,
                fileContent: comma >= 0 ? result.slice(comma + 1) : result
            });
        };
        reader.readAsDataURL(file);
    });
}

function taskWorkbookResultMap() {
    return new Map((taskWorkbookState.visionResults || []).map(item => [item.taskDirectionId, item]));
}

function taskWorkbookDirectionStatus(direction = {}, result = null) {
    const actual = result || taskWorkbookResultMap().get(direction.taskDirectionId);
    if (actual && actual.status === 'success') return 'ready';
    if (actual && actual.missingImage) return 'missing-image';
    if (actual && actual.status === 'failed') return 'risky';
    if (direction.status === 'missing-image') return 'missing-image';
    return 'pending';
}

function activateTaskWorkbookDirection(taskDirectionId) {
    taskWorkbookState.activeDetailId = taskDirectionId || '';
    document.querySelectorAll('.task-workbook-direction-card.is-active').forEach(card => {
        card.classList.remove('is-active');
    });
    const activeCard = document.querySelector(`.task-workbook-direction-card[data-task-direction-id="${CSS.escape(taskWorkbookState.activeDetailId)}"]`);
    if (activeCard) activeCard.classList.add('is-active');
    renderTaskWorkbookDetail(taskWorkbookState.activeDetailId);
}

function taskWorkbookImagePreviewEl() {
    let overlay = document.getElementById('taskWorkbookImagePreview');
    if (overlay) return overlay;

    overlay = taskWorkbookEl('div', 'task-workbook-image-preview');
    overlay.id = 'taskWorkbookImagePreview';
    overlay.hidden = true;
    overlay.innerHTML = `
        <div class="task-workbook-image-preview-dialog" role="dialog" aria-modal="true" aria-label="任务表参考图预览">
            <button type="button" class="task-workbook-image-preview-close" aria-label="关闭大图">×</button>
            <div class="task-workbook-image-preview-frame">
                <img alt="任务表参考图大图">
            </div>
            <div class="task-workbook-image-preview-meta">
                <strong></strong>
                <span></span>
            </div>
        </div>
    `;
    overlay.addEventListener('click', event => {
        if (event.target === overlay) closeTaskWorkbookImagePreview();
    });
    overlay.querySelector('.task-workbook-image-preview-close')?.addEventListener('click', closeTaskWorkbookImagePreview);
    document.body.appendChild(overlay);
    return overlay;
}

function openTaskWorkbookImagePreview(image = {}, direction = {}) {
    if (!image.imageUrl) return;
    const overlay = taskWorkbookImagePreviewEl();
    const img = overlay.querySelector('img');
    const title = overlay.querySelector('strong');
    const meta = overlay.querySelector('span');
    if (img) {
        img.src = image.imageUrl;
        img.alt = image.sourceCell || direction.sourcePath || '任务表参考图';
    }
    if (title) title.textContent = direction.sourcePath || '任务表参考图';
    if (meta) {
        meta.textContent = [
            direction.sourceRow ? `第 ${direction.sourceRow} 行` : '',
            image.sourceCell ? `单元格 ${image.sourceCell}` : '',
            image.fileName || ''
        ].filter(Boolean).join(' · ');
    }
    overlay.hidden = false;
    overlay.classList.add('is-open');
    document.body.classList.add('task-workbook-preview-open');
}

function closeTaskWorkbookImagePreview() {
    const overlay = document.getElementById('taskWorkbookImagePreview');
    if (!overlay) return;
    overlay.classList.remove('is-open');
    overlay.hidden = true;
    document.body.classList.remove('task-workbook-preview-open');
}

function taskWorkbookStatusLabel(status) {
    const map = {
        ready: '已整理',
        pending: '待整理',
        risky: '待重试 / 有风险',
        'missing-image': '缺图'
    };
    return map[status] || '待整理';
}

function taskWorkbookStatusClass(status) {
    if (status === 'ready') return 'is-ready';
    if (status === 'risky') return 'is-risky';
    if (status === 'missing-image') return 'is-missing';
    return 'is-pending';
}

function taskWorkbookGroupKey(direction = {}, level = taskWorkbookState.groupLevel) {
    const parts = [
        direction.primaryTag,
        direction.secondaryTag,
        direction.tertiaryTag,
        direction.subDirection
    ].map(part => String(part || '').trim()).filter(Boolean);
    return parts.slice(0, Math.max(1, Math.min(4, Number(level) || 4))).join('/') || direction.sourcePath || '未分组';
}

function taskWorkbookSearchBlob(direction = {}, result = null) {
    const vision = result && result.vision ? result.vision : {};
    return [
        direction.sourcePath,
        direction.iterationDescription,
        direction.directionDescription,
        vision.visualSummary,
        vision.creativeCore,
        Array.isArray(vision.mustKeep) ? vision.mustKeep.join(' ') : '',
        Array.isArray(vision.variationAxes) ? vision.variationAxes.join(' ') : '',
        Array.isArray(vision.avoidRules) ? vision.avoidRules.join(' ') : ''
    ].join(' ').toLowerCase();
}

function taskWorkbookFilteredDirections() {
    const resultById = taskWorkbookResultMap();
    const search = taskWorkbookState.searchText.toLowerCase();
    return taskWorkbookState.taskDirections.filter(direction => {
        const result = resultById.get(direction.taskDirectionId);
        const status = taskWorkbookDirectionStatus(direction, result);
        if (taskWorkbookState.statusFilter !== 'all' && status !== taskWorkbookState.statusFilter) return false;
        if (taskWorkbookState.activeGroupKey && taskWorkbookGroupKey(direction) !== taskWorkbookState.activeGroupKey) return false;
        if (search && !taskWorkbookSearchBlob(direction, result).includes(search)) return false;
        return true;
    });
}

function renderTaskWorkbookMetrics() {
    const resultById = taskWorkbookResultMap();
    const ready = taskWorkbookState.taskDirections
        .filter(direction => taskWorkbookDirectionStatus(direction, resultById.get(direction.taskDirectionId)) === 'ready')
        .length;
    const images = taskWorkbookState.taskDirections
        .reduce((sum, direction) => sum + (Array.isArray(direction.referenceImages) ? direction.referenceImages.length : 0), 0);
    const setText = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.textContent = String(value);
    };
    setText('taskWorkbookMetricDirections', taskWorkbookState.taskDirections.length);
    setText('taskWorkbookMetricImages', images);
    setText('taskWorkbookMetricReady', ready);
    setText('taskWorkbookMetricSelected', taskWorkbookState.selectedIds.size);
}

function renderTaskWorkbookVisionStatus(status = taskWorkbookState.visionStatus) {
    taskWorkbookState.visionStatus = status || taskWorkbookState.visionStatus;
    const current = taskWorkbookState.visionStatus || {};
    const total = Number(current.total) || taskWorkbookState.taskDirections.length || 0;
    const completed = Number(current.completed) || 0;
    const percent = total ? Math.min(100, Math.round((completed / total) * 100)) : 0;
    const text = document.getElementById('taskWorkbookVisionStatusText');
    const progressText = document.getElementById('taskWorkbookVisionProgressText');
    const progressBar = document.getElementById('taskWorkbookVisionProgressBar');
    const stats = document.getElementById('taskWorkbookVisionStats');
    if (text) text.textContent = current.message || '等待启动任务方向视觉整理';
    if (progressText) progressText.textContent = total ? `${completed}/${total} · ${percent}%` : '--';
    if (progressBar) progressBar.style.width = `${percent}%`;
    if (stats) {
        stats.textContent = '';
        [
            [current.successCount || 0, '成功'],
            [current.failedCount || 0, '失败/风险'],
            [current.cachedCount || 0, '缓存'],
            [current.pendingCount || 0, '待整理']
        ].forEach(([value, label]) => {
            const item = taskWorkbookEl('div');
            item.appendChild(taskWorkbookEl('strong', '', value));
            item.appendChild(taskWorkbookEl('span', '', label));
            stats.appendChild(item);
        });
    }
    const running = current.running === true || current.state === 'pausing';
    const hasImport = Boolean(taskWorkbookState.currentImportId);
    const startBtn = document.getElementById('taskWorkbookVisionStartBtn');
    const pauseBtn = document.getElementById('taskWorkbookVisionPauseBtn');
    const resumeBtn = document.getElementById('taskWorkbookVisionResumeBtn');
    if (startBtn) startBtn.disabled = !hasImport || running;
    if (pauseBtn) pauseBtn.disabled = !hasImport || !running;
    if (resumeBtn) resumeBtn.disabled = !hasImport || running;
}

function renderTaskWorkbookImports(imports = taskWorkbookState.imports) {
    taskWorkbookState.imports = Array.isArray(imports) ? imports : [];
    const list = document.getElementById('taskWorkbookImportList');
    if (!list) return;
    list.textContent = '';
    if (!taskWorkbookState.imports.length) {
        list.textContent = '暂无任务表导入记录。';
        return;
    }
    taskWorkbookState.imports.slice(0, 12).forEach(item => {
        const row = taskWorkbookEl('div', 'task-workbook-import-item');
        row.classList.toggle('is-current', item.importId === taskWorkbookState.currentImportId);
        const copy = taskWorkbookEl('div');
        copy.appendChild(taskWorkbookEl('div', 'task-workbook-import-title', item.fileName || item.importId));
        copy.appendChild(taskWorkbookEl(
            'div',
            'task-workbook-import-meta',
            `${taskWorkbookShortDate(item.importedAt)} · 方向 ${item.taskDirectionCount || 0} · 参考图 ${item.taskReferenceImageCount || 0}`
        ));
        const actions = taskWorkbookEl('div', 'task-workbook-import-actions');
        const loadBtn = taskWorkbookEl('button', 'btn btn-secondary', '查看');
        loadBtn.type = 'button';
        loadBtn.addEventListener('click', () => loadTaskWorkbookImport(item.importId));
        const deleteBtn = taskWorkbookEl('button', 'btn btn-danger', '删除');
        deleteBtn.type = 'button';
        deleteBtn.addEventListener('click', () => deleteTaskWorkbookImport(item.importId));
        actions.appendChild(loadBtn);
        actions.appendChild(deleteBtn);
        row.appendChild(copy);
        row.appendChild(actions);
        list.appendChild(row);
    });
}

function renderTaskWorkbookGroups() {
    const container = document.getElementById('taskWorkbookGroupList');
    if (!container) return;
    container.textContent = '';
    const resultById = taskWorkbookResultMap();
    const groups = new Map();
    taskWorkbookState.taskDirections.forEach(direction => {
        const key = taskWorkbookGroupKey(direction);
        const group = groups.get(key) || {
            key,
            total: 0,
            ready: 0,
            risky: 0,
            selected: 0
        };
        const status = taskWorkbookDirectionStatus(direction, resultById.get(direction.taskDirectionId));
        group.total += 1;
        if (status === 'ready') group.ready += 1;
        if (status === 'risky' || status === 'missing-image') group.risky += 1;
        if (taskWorkbookState.selectedIds.has(direction.taskDirectionId)) group.selected += 1;
        groups.set(key, group);
    });
    if (!groups.size) {
        container.textContent = '导入任务表后显示分组。';
        return;
    }
    const allBtn = taskWorkbookEl('button', 'task-workbook-group-item', `全部方向 · ${taskWorkbookState.taskDirections.length}`);
    allBtn.type = 'button';
    allBtn.classList.toggle('active', !taskWorkbookState.activeGroupKey);
    allBtn.addEventListener('click', () => {
        taskWorkbookState.activeGroupKey = '';
        renderTaskWorkbookPool();
    });
    container.appendChild(allBtn);

    Array.from(groups.values())
        .sort((a, b) => b.total - a.total || a.key.localeCompare(b.key, 'zh-CN'))
        .forEach(group => {
            const btn = taskWorkbookEl('button', 'task-workbook-group-item');
            btn.type = 'button';
            btn.classList.toggle('active', taskWorkbookState.activeGroupKey === group.key);
            btn.title = group.key;
            const title = taskWorkbookEl('strong', '', group.key);
            const meta = taskWorkbookEl('span', '', `${group.total} 行 · 已整理 ${group.ready}${group.risky ? ` · 风险 ${group.risky}` : ''}${group.selected ? ` · 已选 ${group.selected}` : ''}`);
            btn.appendChild(title);
            btn.appendChild(meta);
            btn.addEventListener('click', () => {
                taskWorkbookState.activeGroupKey = taskWorkbookState.activeGroupKey === group.key ? '' : group.key;
                renderTaskWorkbookPool();
            });
            container.appendChild(btn);
        });
}

function renderTaskWorkbookDirectionCard(direction, result = null) {
    const status = taskWorkbookDirectionStatus(direction, result);
    const vision = result && result.status === 'success' ? result.vision || {} : null;
    const card = taskWorkbookEl('div', `task-workbook-direction-card ${taskWorkbookStatusClass(status)}`);
    card.dataset.taskDirectionId = direction.taskDirectionId;
    if (taskWorkbookState.selectedIds.has(direction.taskDirectionId)) card.classList.add('is-selected');
    if (taskWorkbookState.activeDetailId === direction.taskDirectionId) card.classList.add('is-active');
    card.tabIndex = 0;
    card.addEventListener('click', event => {
        if (event.target.closest('button, input, a')) return;
        activateTaskWorkbookDirection(direction.taskDirectionId);
    });
    card.addEventListener('keydown', event => {
        if ((event.key === 'Enter' || event.key === ' ') && !event.target.closest('button, input, a')) {
            event.preventDefault();
            activateTaskWorkbookDirection(direction.taskDirectionId);
        }
    });

    const head = taskWorkbookEl('div', 'task-workbook-direction-head');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = taskWorkbookState.selectedIds.has(direction.taskDirectionId);
    checkbox.addEventListener('click', event => event.stopPropagation());
    checkbox.addEventListener('change', () => toggleTaskWorkbookDirection(direction.taskDirectionId, checkbox.checked));
    const title = taskWorkbookEl('div');
    title.appendChild(taskWorkbookEl('strong', '', direction.sourcePath || '未命名方向'));
    title.appendChild(taskWorkbookEl('span', '', `第 ${direction.sourceRow} 行 · ${direction.referenceImages?.length || 0} 张参考图`));
    const pill = taskWorkbookEl('span', `task-workbook-status ${taskWorkbookStatusClass(status)}`, taskWorkbookStatusLabel(status));
    head.appendChild(checkbox);
    head.appendChild(title);
    head.appendChild(pill);
    card.appendChild(head);

    const desc = taskWorkbookEl('div', 'task-workbook-direction-desc', direction.iterationDescription || direction.directionDescription || '--');
    card.appendChild(desc);

    const thumbRow = taskWorkbookEl('div', 'task-workbook-thumbs');
    (direction.referenceImages || []).slice(0, 4).forEach(image => {
        const img = document.createElement('img');
        img.src = image.imageUrl;
        img.alt = image.sourceCell || '参考图';
        img.loading = 'lazy';
        img.title = '双击查看完整大图';
        img.addEventListener('dblclick', event => {
            event.stopPropagation();
            openTaskWorkbookImagePreview(image, direction);
        });
        thumbRow.appendChild(img);
    });
    if (!thumbRow.children.length) {
        thumbRow.appendChild(taskWorkbookEl('span', 'task-workbook-no-image', '缺少参考图'));
    }
    card.appendChild(thumbRow);

    const summary = taskWorkbookEl('div', 'task-workbook-vision-summary');
    summary.textContent = vision
        ? (vision.visualSummary || vision.creativeCore || 'AI 视觉整理已完成')
        : (result && result.error ? result.error : '等待 AI 视觉整理');
    card.appendChild(summary);

    const actions = taskWorkbookEl('div', 'task-workbook-card-actions');
    const detailBtn = taskWorkbookEl('button', 'creative-mini-btn', '查看');
    detailBtn.type = 'button';
    detailBtn.addEventListener('click', event => {
        event.stopPropagation();
        activateTaskWorkbookDirection(direction.taskDirectionId);
    });
    const retryBtn = taskWorkbookEl('button', 'creative-mini-btn', '重试');
    retryBtn.type = 'button';
    retryBtn.disabled = status === 'ready';
    retryBtn.addEventListener('click', event => {
        event.stopPropagation();
        retryTaskWorkbookDirection(direction.taskDirectionId);
    });
    actions.appendChild(detailBtn);
    actions.appendChild(retryBtn);
    card.appendChild(actions);
    return card;
}

function renderTaskWorkbookDirections() {
    const container = document.getElementById('taskWorkbookDirectionList');
    if (!container) return;
    container.textContent = '';
    const resultById = taskWorkbookResultMap();
    const directions = taskWorkbookFilteredDirections();
    if (!directions.length) {
        container.textContent = taskWorkbookState.taskDirections.length ? '当前筛选下没有任务方向。' : '导入任务表后显示行级任务方向。';
        return;
    }
    directions.forEach(direction => {
        container.appendChild(renderTaskWorkbookDirectionCard(direction, resultById.get(direction.taskDirectionId)));
    });
}

function renderTaskWorkbookSelectionMeta() {
    const meta = document.getElementById('taskWorkbookSelectionMeta');
    if (!meta) return;
    const selected = taskWorkbookState.taskDirections
        .filter(direction => taskWorkbookState.selectedIds.has(direction.taskDirectionId));
    meta.textContent = selected.length
        ? `已选择 ${selected.length} 个行级任务方向；进入 Legil 时不会默认上传任务表参考图。`
        : '尚未选择任务方向。';
    const sendBtn = document.getElementById('taskWorkbookSendCreativeBtn');
    if (sendBtn) sendBtn.disabled = selected.length === 0;
}

function renderTaskWorkbookDetail(taskDirectionId = '') {
    const container = document.getElementById('taskWorkbookDetail');
    if (!container) return;
    const filteredDirections = taskWorkbookFilteredDirections();
    const requestedId = taskDirectionId || taskWorkbookState.activeDetailId;
    const direction = filteredDirections.find(item => item.taskDirectionId === requestedId) ||
        taskWorkbookState.taskDirections.find(item => item.taskDirectionId === requestedId) ||
        filteredDirections[0];
    if (!direction) {
        taskWorkbookState.activeDetailId = '';
        container.textContent = '选择方向后查看参考图和 AI 视觉整理摘要。';
        return;
    }
    taskWorkbookState.activeDetailId = direction.taskDirectionId;
    const result = taskWorkbookResultMap().get(direction.taskDirectionId);
    const vision = result && result.status === 'success' ? result.vision || {} : {};
    container.textContent = '';
    container.appendChild(taskWorkbookEl('h3', '', direction.sourcePath || '未命名方向'));
    container.appendChild(taskWorkbookEl('p', 'task-workbook-detail-meta', `第 ${direction.sourceRow} 行 · ${direction.taskDirectionId}`));
    const imageGrid = taskWorkbookEl('div', 'task-workbook-detail-images');
    (direction.referenceImages || []).forEach(image => {
        const img = document.createElement('img');
        img.src = image.imageUrl;
        img.alt = image.sourceCell || '参考图';
        img.loading = 'lazy';
        img.title = '双击查看完整大图';
        img.addEventListener('dblclick', () => openTaskWorkbookImagePreview(image, direction));
        imageGrid.appendChild(img);
    });
    container.appendChild(imageGrid);
    [
        ['迭代描述', direction.iterationDescription],
        ['方向描述', direction.directionDescription],
        ['视觉摘要', vision.visualSummary || (result && result.error) || '等待整理'],
        ['创意核心', vision.creativeCore],
        ['必须保留', Array.isArray(vision.mustKeep) ? vision.mustKeep.join('、') : ''],
        ['变化轴', Array.isArray(vision.variationAxes) ? vision.variationAxes.join('、') : ''],
        ['避坑规则', Array.isArray(vision.avoidRules) ? vision.avoidRules.join('、') : ''],
        ['Legil 参考图策略', '不默认上传任务表参考图']
    ].forEach(([label, value]) => {
        const row = taskWorkbookEl('div', 'task-workbook-detail-row');
        row.appendChild(taskWorkbookEl('span', '', label));
        row.appendChild(taskWorkbookEl('strong', '', value || '--'));
        container.appendChild(row);
    });
}

function renderTaskWorkbookPool() {
    renderTaskWorkbookMetrics();
    renderTaskWorkbookVisionStatus();
    renderTaskWorkbookGroups();
    renderTaskWorkbookDirections();
    renderTaskWorkbookSelectionMeta();
    renderTaskWorkbookDetail();
}

function toggleTaskWorkbookDirection(taskDirectionId, checked) {
    if (checked) {
        taskWorkbookState.selectedIds.add(taskDirectionId);
    } else {
        taskWorkbookState.selectedIds.delete(taskDirectionId);
    }
    renderTaskWorkbookPool();
}

function selectVisibleTaskWorkbookDirections() {
    taskWorkbookFilteredDirections().forEach(direction => taskWorkbookState.selectedIds.add(direction.taskDirectionId));
    renderTaskWorkbookPool();
    showToast('已勾选当前筛选方向');
}

function clearTaskWorkbookSelection() {
    taskWorkbookState.selectedIds.clear();
    renderTaskWorkbookPool();
}

async function importTaskWorkbookFile() {
    const input = document.getElementById('taskWorkbookFileInput');
    const file = input && input.files && input.files[0];
    if (!file) {
        showToast('请先选择自动化任务表', 'error');
        return;
    }
    const button = document.getElementById('taskWorkbookImportBtn');
    if (button) button.disabled = true;
    taskWorkbookState.importing = true;
    taskWorkbookSetInfo('loading', '正在读取并导入任务表，包含嵌入图片时会稍慢...');
    try {
        const filePayload = await taskWorkbookReadFileAsBase64(file);
        const response = await fetch('/api/task-workbooks/import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(filePayload)
        });
        const data = await taskWorkbookReadResponse(response, '导入自动化任务表失败');
        taskWorkbookState.currentImportId = data.importId;
        taskWorkbookState.summary = data.summary || null;
        taskWorkbookState.taskDirections = Array.isArray(data.taskDirections) ? data.taskDirections : [];
        taskWorkbookState.hierarchyDefinitions = Array.isArray(data.hierarchyDefinitions) ? data.hierarchyDefinitions : [];
        taskWorkbookState.visionResults = [];
        taskWorkbookState.visionStatus = null;
        taskWorkbookState.selectedIds.clear();
        taskWorkbookState.activeGroupKey = '';
        renderTaskWorkbookPool();
        await loadTaskWorkbookImports({ keepCurrent: true, silent: true });
        taskWorkbookSetInfo('success', `导入完成：${data.summary?.taskDirectionCount || 0} 个任务方向，${data.summary?.taskReferenceImageCount || 0} 张参考图。正在尝试启动视觉整理...`);
        showToast('任务表导入完成');
        await startTaskWorkbookVision({ auto: true });
    } catch (error) {
        taskWorkbookSetInfo('error', error.message || '导入自动化任务表失败');
        showToast(error.message || '导入自动化任务表失败', 'error');
    } finally {
        taskWorkbookState.importing = false;
        if (button) button.disabled = false;
    }
}

async function loadTaskWorkbookImports(options = {}) {
    const list = document.getElementById('taskWorkbookImportList');
    if (list && !options.silent) list.textContent = '正在读取历史导入...';
    try {
        const response = await fetch('/api/task-workbooks/imports');
        const data = await taskWorkbookReadResponse(response, '读取任务表导入记录失败');
        renderTaskWorkbookImports(data.imports || []);
        if (!options.keepCurrent && !taskWorkbookState.currentImportId && data.imports && data.imports[0]) {
            await loadTaskWorkbookImport(data.imports[0].importId, { silent: true });
        }
    } catch (error) {
        if (list) list.textContent = error.message || '读取任务表导入记录失败';
    }
}

async function loadTaskWorkbookImport(importId, options = {}) {
    if (!importId) return;
    try {
        const response = await fetch(`/api/task-workbooks/imports/${encodeURIComponent(importId)}`);
        const data = await taskWorkbookReadResponse(response, '读取任务方向池失败');
        taskWorkbookState.currentImportId = importId;
        taskWorkbookState.summary = data.summary || null;
        taskWorkbookState.taskDirections = Array.isArray(data.taskDirections) ? data.taskDirections : [];
        taskWorkbookState.hierarchyDefinitions = Array.isArray(data.hierarchyDefinitions) ? data.hierarchyDefinitions : [];
        taskWorkbookState.visionStatus = data.visionStatus || null;
        taskWorkbookState.visionResults = Array.isArray(data.visionResults) ? data.visionResults : [];
        taskWorkbookState.selectedIds.clear();
        taskWorkbookState.activeGroupKey = '';
        renderTaskWorkbookImports(taskWorkbookState.imports);
        renderTaskWorkbookPool();
        if (taskWorkbookState.visionStatus && taskWorkbookState.visionStatus.running) {
            scheduleTaskWorkbookVisionPoll();
        }
        if (!options.silent) showToast('已加载任务方向池');
    } catch (error) {
        taskWorkbookSetInfo('error', error.message || '读取任务方向池失败');
        showToast(error.message || '读取任务方向池失败', 'error');
    }
}

async function deleteTaskWorkbookImport(importId) {
    if (!importId) return;
    const confirmed = confirm('确定删除这条任务表导入记录吗？导出的行级参考图和视觉整理结果也会删除。');
    if (!confirmed) return;
    try {
        const response = await fetch(`/api/task-workbooks/imports/${encodeURIComponent(importId)}`, {
            method: 'DELETE'
        });
        const data = await taskWorkbookReadResponse(response, '删除任务表导入记录失败');
        if (taskWorkbookState.currentImportId === importId) {
            taskWorkbookState.currentImportId = '';
            taskWorkbookState.summary = null;
            taskWorkbookState.taskDirections = [];
            taskWorkbookState.visionResults = [];
            taskWorkbookState.visionStatus = null;
            taskWorkbookState.selectedIds.clear();
            renderTaskWorkbookPool();
        }
        renderTaskWorkbookImports(data.imports || []);
        showToast(data.message || '任务表导入记录已删除');
    } catch (error) {
        showToast(error.message || '删除任务表导入记录失败', 'error');
    }
}

async function refreshTaskWorkbookCurrent() {
    if (!taskWorkbookState.currentImportId) {
        await loadTaskWorkbookImports();
        return;
    }
    await loadTaskWorkbookImport(taskWorkbookState.currentImportId, { silent: true });
}

async function startTaskWorkbookVision(options = {}) {
    if (!taskWorkbookState.currentImportId) {
        if (!options.auto) showToast('请先导入或选择任务表', 'error');
        return;
    }
    try {
        const response = await fetch(`/api/task-workbooks/imports/${encodeURIComponent(taskWorkbookState.currentImportId)}/vision/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                concurrency: 1,
                maxRetriesPerRow: 3
            })
        });
        const data = await taskWorkbookReadResponse(response, '启动任务方向视觉整理失败');
        taskWorkbookState.visionStatus = data.status || taskWorkbookState.visionStatus;
        renderTaskWorkbookVisionStatus();
        scheduleTaskWorkbookVisionPoll();
        if (!options.auto) showToast(data.message || '任务方向视觉整理已启动');
    } catch (error) {
        taskWorkbookSetInfo(options.auto ? 'warning' : 'error', error.message || '启动任务方向视觉整理失败');
        if (!options.auto) showToast(error.message || '启动任务方向视觉整理失败', 'error');
    }
}

async function pauseTaskWorkbookVision() {
    if (!taskWorkbookState.currentImportId) return;
    try {
        const response = await fetch(`/api/task-workbooks/imports/${encodeURIComponent(taskWorkbookState.currentImportId)}/vision/pause`, {
            method: 'POST'
        });
        const data = await taskWorkbookReadResponse(response, '暂停任务方向视觉整理失败');
        taskWorkbookState.visionStatus = data.status || taskWorkbookState.visionStatus;
        renderTaskWorkbookVisionStatus();
        showToast(data.message || '已发送暂停指令');
    } catch (error) {
        showToast(error.message || '暂停任务方向视觉整理失败', 'error');
    }
}

async function resumeTaskWorkbookVision() {
    if (!taskWorkbookState.currentImportId) return;
    try {
        const response = await fetch(`/api/task-workbooks/imports/${encodeURIComponent(taskWorkbookState.currentImportId)}/vision/resume`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                concurrency: 1,
                maxRetriesPerRow: 3
            })
        });
        const data = await taskWorkbookReadResponse(response, '继续任务方向视觉整理失败');
        taskWorkbookState.visionStatus = data.status || taskWorkbookState.visionStatus;
        renderTaskWorkbookVisionStatus();
        scheduleTaskWorkbookVisionPoll();
        showToast(data.message || '任务方向视觉整理已继续');
    } catch (error) {
        showToast(error.message || '继续任务方向视觉整理失败', 'error');
    }
}

function scheduleTaskWorkbookVisionPoll() {
    if (taskWorkbookState.pollTimer) clearTimeout(taskWorkbookState.pollTimer);
    taskWorkbookState.pollTimer = setTimeout(async () => {
        if (!taskWorkbookState.currentImportId) return;
        try {
            const [statusResponse, resultsResponse] = await Promise.all([
                fetch(`/api/task-workbooks/imports/${encodeURIComponent(taskWorkbookState.currentImportId)}/vision/status`),
                fetch(`/api/task-workbooks/imports/${encodeURIComponent(taskWorkbookState.currentImportId)}/vision/results`)
            ]);
            const statusData = await taskWorkbookReadResponse(statusResponse, '读取视觉整理状态失败');
            const resultsData = await taskWorkbookReadResponse(resultsResponse, '读取视觉整理结果失败');
            taskWorkbookState.visionStatus = statusData.status || resultsData.status || taskWorkbookState.visionStatus;
            taskWorkbookState.visionResults = Array.isArray(resultsData.results) ? resultsData.results : taskWorkbookState.visionResults;
            renderTaskWorkbookPool();
            if (taskWorkbookState.visionStatus && taskWorkbookState.visionStatus.running) {
                scheduleTaskWorkbookVisionPoll();
            }
        } catch (error) {
            taskWorkbookSetInfo('error', error.message || '读取视觉整理状态失败');
        }
    }, 3000);
}

async function retryTaskWorkbookDirection(taskDirectionId) {
    if (!taskWorkbookState.currentImportId || !taskDirectionId) return;
    try {
        const response = await fetch(`/api/task-workbooks/imports/${encodeURIComponent(taskWorkbookState.currentImportId)}/directions/${encodeURIComponent(taskDirectionId)}/vision/retry`, {
            method: 'POST'
        });
        const data = await taskWorkbookReadResponse(response, '重试任务方向视觉整理失败');
        if (data.result) {
            const index = taskWorkbookState.visionResults.findIndex(item => item.taskDirectionId === data.result.taskDirectionId);
            if (index >= 0) taskWorkbookState.visionResults[index] = data.result;
            else taskWorkbookState.visionResults.push(data.result);
        }
        taskWorkbookState.visionStatus = data.status || taskWorkbookState.visionStatus;
        renderTaskWorkbookPool();
        showToast(data.message || '单行重试完成');
    } catch (error) {
        showToast(error.message || '重试任务方向视觉整理失败', 'error');
    }
}

function buildTaskWorkbookCreativePackage() {
    const resultById = taskWorkbookResultMap();
    const selected = taskWorkbookState.taskDirections
        .filter(direction => taskWorkbookState.selectedIds.has(direction.taskDirectionId));
    const targets = selected.map((direction, index) => {
        const result = resultById.get(direction.taskDirectionId);
        const vision = result && result.status === 'success' ? result.vision || {} : {};
        return {
            targetId: `task-workbook:${direction.taskDirectionId}`,
            targetKey: direction.taskDirectionId,
            targetType: 'task-direction',
            source: 'task-workbook',
            sourceMode: 'task-workbook-row',
            taskImportId: taskWorkbookState.currentImportId,
            taskDirectionId: direction.taskDirectionId,
            sourceRow: direction.sourceRow,
            sourceDirectionPath: direction.sourcePath,
            sourceDirectionKey: direction.sourcePath,
            sourceDirectionName: direction.subDirection || direction.tertiaryTag || direction.sourcePath,
            selected: true,
            seedMaterialCount: Array.isArray(direction.referenceImages) ? direction.referenceImages.length : 0,
            seedMaterials: (direction.referenceImages || []).map(image => ({
                imageId: image.imageId,
                imageUrl: image.imageUrl,
                sourceCell: image.sourceCell
            })),
            visualInsight: vision.visualSummary || vision.creativeCore || direction.iterationDescription || '',
            retainElements: Array.isArray(vision.mustKeep) ? vision.mustKeep : [],
            variationAxes: Array.isArray(vision.variationAxes) ? vision.variationAxes : [],
            avoidRules: Array.isArray(vision.avoidRules) ? vision.avoidRules : [],
            taskDirection: {
                primaryTag: direction.primaryTag,
                secondaryTag: direction.secondaryTag,
                tertiaryTag: direction.tertiaryTag,
                subDirection: direction.subDirection,
                iterationDescription: direction.iterationDescription,
                directionDescription: direction.directionDescription,
                referenceImagePolicy: {
                    useTaskReferenceImagesForLegil: false
                }
            }
        };
    });
    const summary = taskWorkbookState.summary || {};
    return {
        source: 'task-workbook',
        sourceMode: 'task-workbook-selection',
        packageType: 'creative-target-package',
        target: 'source-directions',
        runId: taskWorkbookState.currentImportId,
        importId: taskWorkbookState.currentImportId,
        fileName: summary.fileName || '',
        selectedTaskDirectionCount: selected.length,
        targetCount: targets.length,
        useTaskReferenceImagesForLegil: false,
        creativeTargets: targets,
        targets,
        request: '请按自动化任务表选中的行级任务方向逐个处理；任务表参考图只作为方向理解和前端预览，不默认上传给 Legil。'
    };
}

function sendSelectedTaskWorkbookDirectionsToCreative() {
    if (!taskWorkbookState.selectedIds.size) {
        showToast('请先勾选要送入创意拓展的任务方向', 'error');
        return;
    }
    const packagePayload = buildTaskWorkbookCreativePackage();
    const preview = packagePayload.creativeTargets
        .slice(0, 8)
        .map((target, index) => `${index + 1}. 第 ${target.sourceRow} 行 · ${target.sourceDirectionPath}`)
        .join('\n');
    const confirmed = confirm(
        `将 ${packagePayload.targetCount} 个行级任务方向送入创意拓展。\n\n` +
        `${preview}${packagePayload.targetCount > 8 ? '\n...' : ''}\n\n` +
        '进入 Legil 时不会默认上传任务表参考图。'
    );
    if (!confirmed) return;

    const envelope = {
        source: 'task-workbook',
        receivedAt: new Date().toISOString(),
        type: 'brief',
        brief: packagePayload
    };
    sessionStorage.setItem(TASK_WORKBOOK_CREATIVE_BRIEF_KEY, JSON.stringify(envelope));
    localStorage.setItem(TASK_WORKBOOK_CREATIVE_BRIEF_KEY, JSON.stringify(envelope));
    if (typeof window.loadCreativeAutoMaterialBrief === 'function') {
        window.loadCreativeAutoMaterialBrief(envelope);
    }
    if (typeof switchPage === 'function') {
        switchPage('creative');
    }
    setTimeout(() => {
        document.getElementById('creativeAutoBriefPanel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 120);
    showToast('已送入创意拓展页');
}

let taskWorkbookInitialized = false;

function initTaskWorkbookPage() {
    if (taskWorkbookInitialized) return;
    taskWorkbookInitialized = true;
    document.getElementById('taskWorkbookSearchInput')?.addEventListener('input', event => {
        taskWorkbookState.searchText = event.target.value || '';
        renderTaskWorkbookPool();
    });
    document.getElementById('taskWorkbookGroupLevel')?.addEventListener('change', event => {
        taskWorkbookState.groupLevel = Number(event.target.value) || 4;
        taskWorkbookState.activeGroupKey = '';
        renderTaskWorkbookPool();
    });
    document.getElementById('taskWorkbookStatusFilter')?.addEventListener('change', event => {
        taskWorkbookState.statusFilter = event.target.value || 'all';
        renderTaskWorkbookPool();
    });
    window.addEventListener('keydown', event => {
        if (event.key === 'Escape') closeTaskWorkbookImagePreview();
    });
    renderTaskWorkbookPool();
    loadTaskWorkbookImports({ silent: true });
}

if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', initTaskWorkbookPage);
} else {
    initTaskWorkbookPage();
}
