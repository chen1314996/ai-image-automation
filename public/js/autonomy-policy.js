// Autonomy policy page: overview, permissions, protection events and thresholds.
(function () {
    const LEVELS = ['L0', 'L1', 'L2', 'L3', 'L4', 'L5'];
    const PERMISSION_LABELS = {
        allowAutoGood: '自动通过优质结果',
        allowAutoReject: '自动拒绝明显失败结果',
        allowAutoArchiveReference: '自动归档低效参考图',
        allowAutoDisableDirection: '自动暂停异常方向',
        allowAutoPromoteCanaryRule: '自动启用验证通过的规则',
        allowAutoStartLoop: '自动启动下一轮任务'
    };
    const PERMISSION_DESC = {
        allowAutoGood: '结果达到分数和置信度要求后，可直接进入可用资产。',
        allowAutoReject: '明显失败的结果可自动进入拒绝队列，减少人工筛选负担。',
        allowAutoArchiveReference: '低质量或失效参考图可自动归档，避免继续影响后续生成。',
        allowAutoDisableDirection: '当某个方向持续异常时，系统可暂停该方向继续产图。',
        allowAutoPromoteCanaryRule: '验证通过的新规则可自动进入生效状态，影响后续质检。',
        allowAutoStartLoop: '当前轮次完成且状态健康时，可自动启动下一轮任务。'
    };
    const THRESHOLD_LABELS = {
        autoGoodScore: '优质结果最低分',
        autoGoodConfidence: '优质结果最低置信度',
        maxConsecutiveFailures: '连续失败上限',
        maxUnscoredAssets: '未评估资产上限'
    };

    let policyState = null;
    let actionCatalog = [];
    let thresholdRanges = {};

    function byId(id) {
        return document.getElementById(id);
    }

    function formatRange(range = {}) {
        if (range.recommendedMin === undefined || range.recommendedMax === undefined) return '--';
        return `${range.recommendedMin} - ${range.recommendedMax}`;
    }

    function levelIndex(level) {
        return Math.max(0, LEVELS.indexOf(String(level || '').toUpperCase()));
    }

    function setInfo(text, className = '') {
        const summary = byId('autonomyPolicyPreviewSummary');
        if (summary) {
            summary.textContent = text;
            summary.className = className;
        }
    }

    function currentPolicyFromForm() {
        const base = policyState || {};
        const policy = {
            version: 1,
            policyVersion: Number(base.policyVersion) || 1,
            autonomyLevel: document.querySelector('.autonomy-level-button.active')?.dataset.level || base.autonomyLevel || 'L2',
            permissions: {},
            thresholds: {}
        };
        Object.keys(PERMISSION_LABELS).forEach(key => {
            policy.permissions[key] = byId(`autonomyPolicyPerm_${key}`)?.checked === true;
        });
        Object.keys(THRESHOLD_LABELS).forEach(key => {
            const input = byId(`autonomyPolicyThreshold_${key}`);
            const value = Number(input && input.value);
            policy.thresholds[key] = Number.isFinite(value) ? value : (base.thresholds && base.thresholds[key]);
        });
        return policy;
    }

    function renderLevels(policy = {}) {
        const control = byId('autonomyPolicyLevelControl');
        if (!control) return;
        control.textContent = '';
        const current = policy.autonomyLevel || 'L2';
        LEVELS.forEach(level => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `autonomy-level-button${level === current ? ' active' : ''}`;
            button.dataset.level = level;
            button.textContent = level;
            button.addEventListener('click', () => {
                control.querySelectorAll('.autonomy-level-button').forEach(item => item.classList.remove('active'));
                button.classList.add('active');
                const hint = byId('autonomyPolicyLevelHint');
                if (hint) hint.textContent = level;
                renderPreview();
            });
            control.appendChild(button);
        });
        const hint = byId('autonomyPolicyLevelHint');
        if (hint) hint.textContent = current;
    }

    function renderPermissions(policy = {}) {
        const list = byId('autonomyPolicyPermissionList');
        if (!list) return;
        list.textContent = '';
        const permissions = policy.permissions || {};
        const catalogByPermission = new Map(actionCatalog.map(item => [item.permission, item]));
        Object.keys(PERMISSION_LABELS).forEach(key => {
            const catalog = catalogByPermission.get(key) || {};
            const row = document.createElement('div');
            row.className = `autonomy-permission-row${catalog.risk === 'critical' || catalog.risk === 'high' ? ' is-danger' : ''}`;

            const main = document.createElement('div');
            main.className = 'autonomy-permission-main';
            const title = document.createElement('strong');
            title.textContent = PERMISSION_LABELS[key];
            const desc = document.createElement('span');
            const requiredText = catalog.requiredLevel ? `最低等级 ${catalog.requiredLevel}` : '无等级限制';
            desc.textContent = `${PERMISSION_DESC[key]} ${requiredText}`;
            main.appendChild(title);
            main.appendChild(desc);
            if (catalog.risk === 'critical' || catalog.risk === 'high') {
                const risk = document.createElement('em');
                risk.className = 'autonomy-risk-mark';
                risk.textContent = catalog.risk === 'critical' ? '强保护' : '需确认';
                main.appendChild(risk);
            }

            const label = document.createElement('label');
            label.className = 'autonomy-switch';
            label.title = key;
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.id = `autonomyPolicyPerm_${key}`;
            input.checked = permissions[key] === true;
            input.addEventListener('change', renderPreview);
            const slider = document.createElement('span');
            label.appendChild(input);
            label.appendChild(slider);

            row.appendChild(main);
            row.appendChild(label);
            list.appendChild(row);
        });
    }

    function renderThresholds(policy = {}) {
        const body = byId('autonomyPolicyThresholdRows');
        if (!body) return;
        body.textContent = '';
        Object.keys(THRESHOLD_LABELS).forEach(key => {
            const row = document.createElement('tr');
            const labelCell = document.createElement('td');
            labelCell.textContent = THRESHOLD_LABELS[key];
            const inputCell = document.createElement('td');
            const range = thresholdRanges[key] || {};
            const input = document.createElement('input');
            input.type = 'number';
            input.id = `autonomyPolicyThreshold_${key}`;
            input.step = key === 'autoGoodConfidence' ? '0.01' : '1';
            input.min = range.min ?? 0;
            input.max = range.max ?? 100000;
            input.value = policy.thresholds && policy.thresholds[key] !== undefined ? policy.thresholds[key] : '';
            input.addEventListener('input', renderPreview);
            inputCell.appendChild(input);
            const rangeCell = document.createElement('td');
            rangeCell.textContent = formatRange(range);
            row.appendChild(labelCell);
            row.appendChild(inputCell);
            row.appendChild(rangeCell);
            body.appendChild(row);
        });
    }

    function buildPreview(policy = currentPolicyFromForm()) {
        const enabled = [];
        const blocked = [];
        const modules = new Set();
        actionCatalog.forEach(item => {
            const hasPermission = policy.permissions && policy.permissions[item.permission] === true;
            const hasLevel = levelIndex(policy.autonomyLevel) >= levelIndex(item.requiredLevel);
            if (hasPermission && hasLevel) {
                enabled.push(item);
                (item.modules || []).forEach(moduleName => modules.add(moduleName));
            } else {
                blocked.push({
                    ...item,
                    blockReason: hasPermission ? '等级不足，继续保护' : '权限未开启'
                });
            }
        });
        return {
            enabled,
            blocked,
            modules: Array.from(modules)
        };
    }

    function updatePolicyOverview(policy, preview) {
        const allowedCount = byId('autonomyPolicyAllowedCount');
        if (allowedCount) allowedCount.textContent = String(preview.enabled.length);

        const highRiskEnabled = preview.enabled.filter(item => item.risk === 'critical' || item.risk === 'high').length;
        const riskCount = byId('autonomyPolicyRiskCount');
        if (riskCount) {
            riskCount.textContent = highRiskEnabled ? `${highRiskEnabled} 项开启` : '全部保护';
            riskCount.className = highRiskEnabled ? 'system-health-value is-warning' : 'system-health-value is-success';
        }

        const levelHint = byId('autonomyPolicyLevelHint');
        if (levelHint) levelHint.textContent = policy.autonomyLevel || 'L2';
    }

    function renderPreview() {
        const panel = byId('autonomyPolicyPreview');
        if (!panel) return;
        panel.textContent = '';
        const policy = currentPolicyFromForm();
        const preview = buildPreview(policy);
        updatePolicyOverview(policy, preview);
        const versionText = policyState ? '已读取' : '未加载';
        setInfo(`${versionText}，${preview.enabled.length} 项可自动执行`);

        const enabled = document.createElement('div');
        enabled.className = 'autonomy-preview-item';
        const enabledTitle = document.createElement('strong');
        enabledTitle.textContent = '保存后允许自动执行';
        const enabledText = document.createElement('span');
        enabledText.textContent = preview.enabled.length
            ? preview.enabled.map(item => PERMISSION_LABELS[item.permission] || item.label).join('、')
            : '当前不会开放自动动作。';
        enabled.appendChild(enabledTitle);
        enabled.appendChild(enabledText);
        panel.appendChild(enabled);

        const blocked = document.createElement('div');
        blocked.className = 'autonomy-preview-item';
        const blockedTitle = document.createElement('strong');
        blockedTitle.textContent = '仍会保护阻断';
        const blockedText = document.createElement('span');
        blockedText.textContent = preview.blocked.length
            ? preview.blocked.map(item => `${PERMISSION_LABELS[item.permission] || item.label}: ${item.blockReason}`).join('；')
            : '当前等级和权限允许所有已登记动作。';
        blocked.appendChild(blockedTitle);
        blocked.appendChild(blockedText);
        panel.appendChild(blocked);

        const modules = document.createElement('div');
        modules.className = 'autonomy-preview-item';
        const modulesTitle = document.createElement('strong');
        modulesTitle.textContent = '影响模块';
        const modulesText = document.createElement('span');
        modulesText.textContent = preview.modules.length ? preview.modules.join('、') : '暂无自动模块受影响。';
        modules.appendChild(modulesTitle);
        modules.appendChild(modulesText);
        panel.appendChild(modules);
    }

    function renderEvents(events = []) {
        const container = byId('autonomyPolicyEvents');
        if (!container) return;
        container.textContent = '';
        const title = document.createElement('div');
        title.className = 'autonomy-preview-item';
        const strong = document.createElement('strong');
        strong.textContent = '最近保护记录';
        const span = document.createElement('span');
        span.textContent = events.length ? '这些记录说明系统已按策略拦截高风险动作。' : '暂时没有被策略拦截的自动动作。';
        title.appendChild(strong);
        title.appendChild(span);
        container.appendChild(title);

        events.slice(0, 8).forEach(event => {
            const item = document.createElement('div');
            item.className = 'autonomy-event-item is-denied';
            const head = document.createElement('strong');
            head.textContent = `${event.actionLabel || event.action || '自动动作'} / 当前 ${event.currentLevel || '--'} / 需要 ${event.requiredLevel || '--'}`;
            const reason = document.createElement('span');
            reason.textContent = event.reason || event.reasonCode || '未记录原因';
            const meta = document.createElement('span');
            meta.textContent = `${event.createdAt || ''} / ${event.context && event.context.summary ? event.context.summary : '等待人工复核'}`;
            item.appendChild(head);
            item.appendChild(reason);
            item.appendChild(meta);
            container.appendChild(item);
        });
    }

    async function loadPolicyEvents() {
        try {
            const data = await window.ApiClient.fetchJson('/api/autonomy-policy/events?type=policy_denied&limit=12', {
                timeoutMs: 30000,
                fallbackMessage: '读取策略事件失败',
                toastOnError: false
            });
            renderEvents(Array.isArray(data.events) ? data.events : []);
            return data;
        } catch (error) {
            renderEvents([]);
            return null;
        }
    }

    function renderPolicy(data = {}) {
        policyState = data.policy || data;
        actionCatalog = Array.isArray(data.actionCatalog) ? data.actionCatalog : actionCatalog;
        thresholdRanges = data.thresholdRanges || thresholdRanges || {};
        renderLevels(policyState);
        renderPermissions(policyState);
        renderThresholds(policyState);
        renderPreview();
        const badge = byId('autonomyPolicyVersionBadge');
        if (badge) {
            badge.textContent = `已保存 ${policyState.policyVersion || 1} 版`;
            badge.className = 'autonomy-stage-badge is-paused';
        }
    }

    async function loadAutonomyPolicy(options = {}) {
        try {
            const data = await window.ApiClient.fetchJson('/api/autonomy-policy', {
                timeoutMs: 30000,
                fallbackMessage: '读取自动化策略失败',
                toastOnError: options.silent !== true
            });
            renderPolicy(data);
            await loadPolicyEvents();
            return data;
        } catch (error) {
            setInfo(error.message || '读取失败', 'is-failed');
            return null;
        }
    }

    async function saveAutonomyPolicy() {
        const payload = currentPolicyFromForm();
        payload.source = 'autonomy-policy-page';
        try {
            const data = await window.ApiClient.fetchJson('/api/autonomy-policy', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                timeoutMs: 12000,
                fallbackMessage: '保存自动化策略失败',
                pendingTarget: '#autonomyPolicySaveBtn',
                pendingText: '保存中'
            });
            renderPolicy(data);
            await loadPolicyEvents();
            if (typeof window.showToast === 'function') {
                window.showToast(`策略已保存：第 ${data.policy && data.policy.policyVersion || ''} 版`);
            }
            return data;
        } catch (error) {
            if (typeof window.showToast === 'function') {
                window.showToast(error.message || '保存自动化策略失败', 'error');
            }
            return null;
        }
    }

    window.loadAutonomyPolicy = loadAutonomyPolicy;
    window.saveAutonomyPolicy = saveAutonomyPolicy;

    function loadWhenActive() {
        if (document.getElementById('autonomyPolicyPage')?.classList.contains('active')) {
            loadAutonomyPolicy({ silent: true });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', loadWhenActive);
    } else {
        loadWhenActive();
    }
})();
