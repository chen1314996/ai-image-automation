const materialAnalysisState = {
    imports: [],
    currentRunId: '',
    top100: [],
    overview: null,
    directions: [],
    visionStatus: null,
    visionResults: [],
    visionFilter: 'all',
    visionPollTimer: null,
    selectedVisionMaterialId: '',
    selectedVisionMaterialIds: new Set(),
    reports: null,
    reportTab: 'weekly',
    reportsGenerating: false,
    creativePayload: null,
    creativeGenerating: false,
    creativeTargets: [],
    selectedCreativeTargetKeys: new Set(),
    creativeTargetOverrides: {},
    creativeExpansionPool: null,
    creativeExpansionLoading: false,
    creativeExpansionGenerating: false,
    creativeDefaultPromptGroups: 5,
    collectingKnowledge: false,
    importing: false
};

const MATERIAL_ANALYSIS_CREATIVE_BRIEF_KEY = 'material-analysis-creative-brief-v1';

const materialAnalysisNumber = new Intl.NumberFormat('zh-CN', {
    maximumFractionDigits: 2
});

const materialAnalysisPercent = new Intl.NumberFormat('zh-CN', {
    style: 'percent',
    maximumFractionDigits: 2
});

function materialAnalysisSetInfo(type, text) {
    const info = document.getElementById('materialAnalysisImportInfo');
    if (!info) return;
    info.className = `info-box ${type || ''}`.trim();
    info.textContent = text;
}

function materialAnalysisText(value, fallback = '--') {
    const text = String(value ?? '').trim();
    return text || fallback;
}

function materialAnalysisFormatNumber(value, fallback = '--') {
    const number = Number(value);
    return Number.isFinite(number) ? materialAnalysisNumber.format(number) : fallback;
}

function materialAnalysisFormatPercent(value, fallback = '--') {
    const number = Number(value);
    return Number.isFinite(number) ? materialAnalysisPercent.format(number) : fallback;
}

function materialAnalysisFormatMetric(value, mode = 'number') {
    if (mode === 'percent') return materialAnalysisFormatPercent(value);
    return materialAnalysisFormatNumber(value);
}

function materialAnalysisShortDate(value) {
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

function materialAnalysisMakeEl(tagName, className, text) {
    const el = document.createElement(tagName);
    if (className) el.className = className;
    if (text !== undefined && text !== null) el.textContent = String(text);
    return el;
}

function materialAnalysisLabelPathText(value) {
    if (Array.isArray(value)) {
        return value.map(part => String(part || '').trim()).filter(Boolean).join(' / ');
    }
    return String(value || '').trim();
}

function materialAnalysisPill(config = {}, fallback = '观察') {
    const pill = materialAnalysisMakeEl('span', `material-analysis-pill ${config.className || 'is-watch'}`, config.label || fallback);
    return pill;
}

function materialAnalysisVisionPill(status) {
    const map = {
        success: { label: '已识别', className: 'is-excellent' },
        failed: { label: '识别失败', className: 'is-bad' },
        pending: { label: '未识别', className: 'is-watch' },
        running: { label: '识别中', className: 'is-good' }
    };
    return materialAnalysisPill(map[status] || map.pending, '未识别');
}

async function materialAnalysisReadResponse(response, fallbackMessage) {
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
        const text = await response.text().catch(() => '');
        if (
            response.status === 404 &&
            /Cannot\s+(GET|POST)\s+\/api\/material-analysis/i.test(text)
        ) {
            throw new Error('素材分析接口未启动，请重启服务后再导入。');
        }
        throw new Error(`${fallbackMessage}（HTTP ${response.status}）`);
    }

    const data = await response.json();
    if (!response.ok) throw new Error(data.message || fallbackMessage);
    return data;
}

function materialAnalysisReadFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        const lowerName = String(file.name || '').toLowerCase();
        reader.onerror = () => reject(new Error('读取文件失败'));
        reader.onload = () => {
            if (lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls')) {
                const binary = new Uint8Array(reader.result);
                let text = '';
                binary.forEach(byte => {
                    text += String.fromCharCode(byte);
                });
                resolve({
                    fileName: file.name,
                    fileContent: btoa(text)
                });
                return;
            }

            resolve({
                fileName: file.name,
                fileContent: String(reader.result || '')
            });
        };

        if (lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls')) {
            reader.readAsArrayBuffer(file);
        } else {
            reader.readAsText(file, 'utf-8');
        }
    });
}

function renderMaterialAnalysisSummary(summary = {}) {
    const kpis = document.getElementById('materialAnalysisKpis');
    if (kpis) {
        const items = [
            ['总花费', materialAnalysisFormatNumber(summary.totalSpend)],
            ['总安装', materialAnalysisFormatNumber(summary.totalInstalls)],
            ['Top100 占比', materialAnalysisFormatPercent(summary.top100SpendShare)],
            ['D0 ROI 覆盖', materialAnalysisFormatPercent(summary.d0RoiCoverage)]
        ];
        kpis.textContent = '';
        items.forEach(([label, value]) => {
            const card = materialAnalysisMakeEl('div', 'material-analysis-kpi');
            card.appendChild(materialAnalysisMakeEl('span', '', label));
            card.appendChild(materialAnalysisMakeEl('strong', '', value));
            kpis.appendChild(card);
        });
    }

    const meta = document.getElementById('materialAnalysisRunMeta');
    if (meta) {
        meta.textContent = summary.runId
            ? `${summary.projectName || '--'} / ${summary.weekId || '--'}，明细 ${materialAnalysisFormatNumber(summary.materialRows)} 条，Top100 ${materialAnalysisFormatNumber(summary.top100Count)} 条，方向解析 ${materialAnalysisFormatPercent(summary.parsedPrimaryRate)}，尺寸解析 ${materialAnalysisFormatPercent(summary.parsedSizeRate)}。`
            : '导入后显示本次数据摘要。';
    }
}

function materialAnalysisCollectDecisionForMaterial(material = {}) {
    const tag = material.health && material.health.tag && material.health.tag.key;
    if (['high_spend_low_roi', 'pause_repeat'].includes(tag)) return 'negative';
    return 'positive';
}

function materialAnalysisCollectDecisionForDirection(direction = {}) {
    const status = direction.status && direction.status.key;
    if (['pause', 'risk'].includes(status)) return 'negative';
    return 'positive';
}

function materialAnalysisCollectButtonText(decision, type = 'material') {
    if (decision === 'negative') return type === 'direction' ? '写入方向避坑' : '写入避坑';
    return type === 'direction' ? '沉淀方向经验' : '沉淀经验';
}

function materialAnalysisDraftButtonText(type = 'material') {
    return type === 'direction' ? '加入候选方向' : '候选方向';
}

function renderMaterialAnalysisMiniList(containerId, materials = []) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.textContent = '';
    if (!Array.isArray(materials) || materials.length === 0) {
        container.textContent = '暂无';
        return;
    }
    materials.slice(0, 5).forEach(item => {
        const row = materialAnalysisMakeEl('div', 'material-analysis-mini-item');
        const main = materialAnalysisMakeEl('span', '', item.materialName || '--');
        const side = materialAnalysisMakeEl('div', 'material-analysis-mini-actions');
        side.appendChild(materialAnalysisMakeEl(
            'strong',
            '',
            `${materialAnalysisFormatNumber(item.spend)} / ${materialAnalysisFormatPercent(item.d0IapRoi)}`
        ));
        const decision = materialAnalysisCollectDecisionForMaterial(item);
        const collectBtn = materialAnalysisMakeEl('button', 'creative-mini-btn', materialAnalysisCollectButtonText(decision));
        collectBtn.type = 'button';
        collectBtn.addEventListener('click', () => collectMaterialAnalysisMaterialKnowledge(item.materialId, decision));
        side.appendChild(collectBtn);
        if (decision !== 'negative') {
            const draftBtn = materialAnalysisMakeEl('button', 'creative-mini-btn', materialAnalysisDraftButtonText());
            draftBtn.type = 'button';
            draftBtn.addEventListener('click', () => createMaterialAnalysisMaterialDirectionDraft(item.materialId));
            side.appendChild(draftBtn);
        }
        row.appendChild(main);
        row.appendChild(side);
        container.appendChild(row);
    });
}

function renderMaterialAnalysisOverview(overview = null) {
    materialAnalysisState.overview = overview || null;
    const score = document.getElementById('materialAnalysisHealthScore');
    const status = document.getElementById('materialAnalysisProjectStatus');
    const conclusion = document.getElementById('materialAnalysisConclusion');

    if (!overview) {
        if (score) score.textContent = '--';
        if (status) status.textContent = '等待导入';
        if (conclusion) conclusion.textContent = '导入后会按 D0 ROI 优先判断项目状态、优秀素材和风险素材。';
        renderMaterialAnalysisMiniList('materialAnalysisExcellentList', []);
        renderMaterialAnalysisMiniList('materialAnalysisRiskList', []);
        return;
    }

    if (score) score.textContent = materialAnalysisFormatNumber(overview.avgTopHealthScore);
    if (status) status.textContent = overview.projectStatus || '--';
    if (conclusion) conclusion.textContent = overview.conclusion || '';
    renderMaterialAnalysisMiniList('materialAnalysisExcellentList', overview.excellentMaterials || []);
    renderMaterialAnalysisMiniList('materialAnalysisRiskList', overview.riskMaterials || []);
}

function materialAnalysisCurrentReport(type = materialAnalysisState.reportTab) {
    const reports = materialAnalysisState.reports && materialAnalysisState.reports.reports;
    return reports && reports[type] ? reports[type] : null;
}

function updateMaterialAnalysisReportButtons() {
    const disabled = materialAnalysisState.reportsGenerating || !materialAnalysisState.currentRunId;
    const creativeDisabled = materialAnalysisState.creativeGenerating || !materialAnalysisState.currentRunId;
    const generateBtn = document.getElementById('materialAnalysisReportGenerateBtn');
    const experienceBtn = document.getElementById('materialAnalysisExperienceGenerateBtn');
    const creativePlanBtn = document.getElementById('materialAnalysisCreativePlanBtn');
    const creativeJumpBtn = document.getElementById('materialAnalysisCreativeJumpBtn');
    const collectWeeklyBtn = document.getElementById('materialAnalysisCollectWeeklyBtn');
    if (generateBtn) {
        generateBtn.disabled = disabled;
        generateBtn.textContent = materialAnalysisState.reportsGenerating ? '生成中...' : '生成周报';
    }
    if (experienceBtn) {
        experienceBtn.disabled = disabled;
        experienceBtn.textContent = materialAnalysisState.reportsGenerating ? '生成中...' : '生成经验文档';
    }
    if (creativePlanBtn) {
        creativePlanBtn.disabled = creativeDisabled;
        creativePlanBtn.textContent = materialAnalysisState.creativeGenerating ? '生成中...' : '生成下周创意计划';
    }
    if (creativeJumpBtn) {
        creativeJumpBtn.disabled = !materialAnalysisState.creativePayload;
    }
    if (collectWeeklyBtn) {
        collectWeeklyBtn.disabled = materialAnalysisState.collectingKnowledge || !materialAnalysisState.currentRunId;
        collectWeeklyBtn.textContent = materialAnalysisState.collectingKnowledge ? '沉淀中...' : '沉淀本周经验';
    }
}

function materialAnalysisCreativeTitle(payload = materialAnalysisState.creativePayload) {
    const data = payload && (payload.brief || payload.plan || payload);
    if (!data) return '尚未生成创意拓展 brief';
    const targetCount = Array.isArray(data.creativeTargets) ? data.creativeTargets.length : 0;
    if (data.packageType === 'creative-target-package' || data.target === 'source-directions') {
        return data.sourceMode === 'vision-selection'
            ? `待拓展素材包：${targetCount} 张 Top100 素材`
            : `待拓展方向包：${targetCount} 个原始方向`;
    }
    if (data.target === 'weekly-plan') return `${data.projectName || '--'} / ${data.weekId || '--'} 下周创意计划`;
    if (data.target === 'direction') return `方向 brief：${data.directionPath || data.directionKey || '--'}`;
    return `素材 brief：${data.materialName || data.materialId || '--'}`;
}

function materialAnalysisUniqueStrings(values = [], limit = 12) {
    const output = [];
    values.flat(Infinity).forEach(value => {
        const text = String(value || '').trim();
        if (text && !output.includes(text)) output.push(text);
    });
    return output.slice(0, limit);
}

function materialAnalysisIsPerformanceMetricText(value = '') {
    return /(\bROI\b|\bD[07]\b|\bCPI\b|\bIPM\b|\bCTR\b|\bCVR\b|花费|安装|消耗|回收|投放成本|获客成本)/i.test(String(value || ''));
}

function materialAnalysisNonMetricStrings(values = [], limit = 12) {
    return materialAnalysisUniqueStrings(values, 100)
        .filter(value => !materialAnalysisIsPerformanceMetricText(value))
        .slice(0, limit);
}

function materialAnalysisCurrentImport() {
    return materialAnalysisState.imports.find(item => item.runId === materialAnalysisState.currentRunId) || {};
}

function materialAnalysisSourceDirectionPath(material = {}, vision = {}) {
    const parsed = material.parsedName || {};
    const parsedParts = [parsed.primary, parsed.secondary, parsed.idea]
        .map(value => String(value || '').trim())
        .filter(Boolean);
    if (parsedParts.length) return parsedParts.join('/');
    const suggested = String(vision.suggestedDirection || '').trim();
    if (suggested) {
        return suggested.split(/[/>｜|]/g).map(part => part.trim()).filter(Boolean).join('/');
    }
    return [vision.mainSubject, vision.scene, vision.hook]
        .map(value => String(value || '').trim())
        .filter(Boolean)
        .slice(0, 3)
        .join('/') || material.materialName || material.materialId || '未命名原始方向';
}

function materialAnalysisSeedMaterialForCreative(material = {}, result = null) {
    const vision = result && result.status === 'success' ? (result.vision || {}) : {};
    return {
        materialId: material.materialId || '',
        materialName: material.materialName || '',
        imageUrl: materialAnalysisImageSrc(material),
        visionStatus: result ? result.status : 'pending',
        visionSummary: vision.summary || '',
        mainSubject: vision.mainSubject || '',
        scene: vision.scene || '',
        event: vision.event || '',
        emotion: vision.emotion || '',
        composition: vision.composition || '',
        color: vision.color || '',
        hook: vision.hook || '',
        suggestedDirection: vision.suggestedDirection || '',
        retainElements: Array.isArray(vision.retainElements) ? vision.retainElements : [],
        variationAxes: Array.isArray(vision.variationAxes) ? vision.variationAxes : [],
        riskNotes: materialAnalysisNonMetricStrings(Array.isArray(vision.riskNotes) ? vision.riskNotes : [], 6)
    };
}

function buildMaterialAnalysisCreativeTargetPackage(materialIds = []) {
    const selectedIds = Array.isArray(materialIds) ? materialIds.filter(Boolean) : [];
    const selectedMaterials = materialAnalysisState.top100
        .filter(material => selectedIds.includes(material.materialId));
    const targets = selectedMaterials.map((material, index) => {
        const result = materialAnalysisGetVisionResult(material.materialId);
        const vision = result && result.status === 'success' ? (result.vision || {}) : {};
        const path = materialAnalysisSourceDirectionPath(material, vision);
        const seed = materialAnalysisSeedMaterialForCreative(material, result);
        const parts = path.split('/').map(part => part.trim()).filter(Boolean);
        return {
            targetId: `material-analysis:${material.materialId || index + 1}`,
            targetKey: material.materialId || `material-${index + 1}`,
            targetType: 'top100-material',
            source: 'material-analysis',
            sourceMode: 'vision-selection',
            sourceMaterialId: material.materialId || '',
            sourceMaterialName: material.materialName || '',
            sourceDirectionKey: path,
            sourceDirectionPath: path,
            sourceDirectionName: parts[parts.length - 1] || path,
            materialName: material.materialName || '',
            selected: true,
            seedMaterialCount: 1,
            seedMaterials: [seed],
            visualInsight: materialAnalysisUniqueStrings([seed.visionSummary || seed.hook || seed.suggestedDirection], 4).join('；'),
            retainElements: materialAnalysisUniqueStrings([seed.retainElements, seed.hook, seed.mainSubject, seed.event], 10),
            variationAxes: materialAnalysisUniqueStrings([seed.variationAxes], 10),
            avoidRules: materialAnalysisNonMetricStrings([seed.riskNotes], 10)
        };
    });
    const currentImport = materialAnalysisCurrentImport();

    return {
        source: 'material-analysis',
        sourceMode: 'vision-selection',
        packageType: 'creative-target-package',
        target: 'source-directions',
        runId: materialAnalysisState.currentRunId,
        projectName: currentImport.projectName || materialAnalysisState.overview?.projectName || '无尽冬日',
        weekId: currentImport.weekId || materialAnalysisState.overview?.weekId || '',
        selectedMaterialCount: selectedMaterials.length,
        targetCount: targets.length,
        creativeTargets: targets,
        targets,
        request: '请在创意拓展页按 Top100 素材逐张处理；每张素材的新方向数和每个新方向提示词数由创意拓展页设置决定。'
    };
}

function sendMaterialAnalysisVisionMaterialsToCreative(materialIds = []) {
    const ids = Array.isArray(materialIds) ? materialIds.filter(Boolean) : [];
    if (!ids.length) {
        showToast('请先勾选要加入创意拓展的素材', 'error');
        return;
    }
    const packagePayload = buildMaterialAnalysisCreativeTargetPackage(ids);
    if (!packagePayload.creativeTargets.length) {
        showToast('未能从已选素材生成待拓展目标', 'error');
        return;
    }
    const preview = packagePayload.creativeTargets
        .slice(0, 8)
        .map((target, index) => `${index + 1}. ${target.sourceMaterialName || target.sourceDirectionPath}（${target.sourceDirectionPath}）`)
        .join('\n');
    const confirmed = confirm(
        `将 ${packagePayload.selectedMaterialCount} 张素材作为 ${packagePayload.targetCount} 个待拓展目标送入创意拓展页，不再按重叠方向合并。\n\n` +
        `${preview}${packagePayload.creativeTargets.length > 8 ? '\n...' : ''}\n\n` +
        '每张素材拓展几个新方向、每个新方向几条提示词，将在创意拓展页统一调整。'
    );
    if (!confirmed) return;
    renderMaterialAnalysisCreativePayload({ brief: packagePayload });
    sendMaterialAnalysisCreativePayloadToCreative({ brief: packagePayload });
}

function sendSelectedMaterialAnalysisVisionToCreative() {
    sendMaterialAnalysisVisionMaterialsToCreative(materialAnalysisSelectedVisionIds());
}

function renderMaterialAnalysisCreativePayload(payload = materialAnalysisState.creativePayload) {
    materialAnalysisState.creativePayload = payload || null;
    const panel = document.getElementById('materialAnalysisCreativeBriefPanel');
    if (!panel) {
        updateMaterialAnalysisReportButtons();
        return;
    }

    panel.textContent = '';
    if (!payload) {
        const empty = materialAnalysisMakeEl('div', 'material-analysis-creative-empty');
        empty.textContent = '从单素材、方向或周报区生成 brief 后，可以一键送入创意拓展页。';
        panel.appendChild(empty);
        updateMaterialAnalysisReportButtons();
        return;
    }

    const data = payload.brief || payload.plan || payload;
    const creativeTargets = Array.isArray(data.creativeTargets) ? data.creativeTargets : (Array.isArray(data.targets) ? data.targets : []);
    const head = materialAnalysisMakeEl('div', 'material-analysis-creative-head');
    head.appendChild(materialAnalysisMakeEl('strong', '', materialAnalysisCreativeTitle(payload)));
    head.appendChild(materialAnalysisMakeEl('span', '', data.packageType || data.target || 'brief'));

    const summary = materialAnalysisMakeEl('div', 'material-analysis-creative-summary');
    [
        ['方向', data.directionPath || data.directionKey],
        ['视觉', data.visualInsight],
        ['保留', Array.isArray(data.retainElements) ? data.retainElements.join('、') : ''],
        ['变化轴', Array.isArray(data.variationAxes) ? data.variationAxes.join('、') : ''],
        ['避坑', Array.isArray(data.avoidRules) ? data.avoidRules.join('、') : ''],
        ['任务目标', creativeTargets.length ? `${creativeTargets.length} 个待拓展目标，已带方向路径、视觉证据和参考素材` : '']
    ].forEach(([label, value]) => {
        if (!value) return;
        const row = materialAnalysisMakeEl('div', 'material-analysis-creative-row');
        row.appendChild(materialAnalysisMakeEl('span', '', label));
        row.appendChild(materialAnalysisMakeEl('strong', '', value));
        summary.appendChild(row);
    });
    creativeTargets.slice(0, 5).forEach((target, index) => {
        const row = materialAnalysisMakeEl('div', 'material-analysis-creative-row');
        row.appendChild(materialAnalysisMakeEl('span', '', `目标${index + 1}`));
        row.appendChild(materialAnalysisMakeEl('strong', '', [
            target.sourceDirectionPath || target.sourceDirectionKey || target.materialName,
            target.seedMaterialCount ? `${target.seedMaterialCount} 张素材` : target.task
        ].filter(Boolean).join('｜')));
        summary.appendChild(row);
    });

    const actions = materialAnalysisMakeEl('div', 'material-analysis-creative-actions');
    const copyBtn = materialAnalysisMakeEl('button', 'btn btn-secondary', '复制 brief');
    copyBtn.type = 'button';
    copyBtn.addEventListener('click', () => copyMaterialAnalysisText(JSON.stringify(data, null, 2), '创意 brief'));
    const jumpBtn = materialAnalysisMakeEl('button', 'btn btn-primary', '跳转创意拓展页');
    jumpBtn.type = 'button';
    jumpBtn.addEventListener('click', () => sendMaterialAnalysisCreativePayloadToCreative(payload));
    actions.appendChild(copyBtn);
    actions.appendChild(jumpBtn);

    panel.appendChild(head);
    panel.appendChild(summary);
    panel.appendChild(actions);
    updateMaterialAnalysisReportButtons();
}

function sanitizeMaterialAnalysisCreativePayloadForCreative(payload) {
    if (!payload) return payload;
    const clone = JSON.parse(JSON.stringify(payload));
    const strip = item => {
        if (!item || typeof item !== 'object') return item;
        delete item.performanceSummary;
        delete item.metrics;
        delete item.agentInstructionText;
        const targets = Array.isArray(item.creativeTargets) ? item.creativeTargets : [];
        const aliasTargets = Array.isArray(item.targets) ? item.targets : [];
        targets.concat(aliasTargets).forEach(target => {
                delete target.performanceSummary;
                delete target.metrics;
                if (Array.isArray(target.seedMaterials)) {
                    target.seedMaterials.forEach(seed => {
                        delete seed.spend;
                        delete seed.installs;
                        delete seed.d0IapRoi;
                        delete seed.d7IapRoi;
                        delete seed.health;
                    });
                }
            });
        if (Array.isArray(item.topMaterials)) {
            item.topMaterials.forEach(material => {
                delete material.spend;
                delete material.installs;
                delete material.d0IapRoi;
                delete material.d7IapRoi;
                delete material.health;
            });
        }
        return item;
    };
    strip(clone);
    strip(clone.brief);
    strip(clone.plan);
    return clone;
}

function persistMaterialAnalysisCreativePayload(payload) {
    const safePayload = sanitizeMaterialAnalysisCreativePayloadForCreative(payload);
    const envelope = {
        source: 'material-analysis',
        receivedAt: new Date().toISOString(),
        type: safePayload && safePayload.plan ? 'plan' : 'brief',
        ...safePayload
    };
    sessionStorage.setItem(MATERIAL_ANALYSIS_CREATIVE_BRIEF_KEY, JSON.stringify(envelope));
    localStorage.setItem(MATERIAL_ANALYSIS_CREATIVE_BRIEF_KEY, JSON.stringify(envelope));
    return envelope;
}

function sendMaterialAnalysisCreativePayloadToCreative(payload = materialAnalysisState.creativePayload) {
    if (!payload) {
        showToast('请先生成素材、方向或下周创意计划 brief', 'error');
        return;
    }
    const envelope = persistMaterialAnalysisCreativePayload(payload);
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

async function generateMaterialAnalysisMaterialCreativeBrief(materialId) {
    if (!materialId) return;
    materialAnalysisState.creativeGenerating = true;
    updateMaterialAnalysisReportButtons();
    try {
        const response = await fetch(`/api/material-analysis/materials/${encodeURIComponent(materialId)}/creative-brief`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ runId: materialAnalysisState.currentRunId })
        });
        const data = await materialAnalysisReadResponse(response, '生成单素材创意 brief 失败');
        renderMaterialAnalysisCreativePayload({ brief: data.brief });
        showToast('单素材 brief 已生成');
    } catch (error) {
        showToast(error.message || '生成单素材创意 brief 失败', 'error');
    } finally {
        materialAnalysisState.creativeGenerating = false;
        updateMaterialAnalysisReportButtons();
    }
}

async function generateMaterialAnalysisDirectionCreativeBrief(directionKey) {
    if (!directionKey) return;
    materialAnalysisState.creativeGenerating = true;
    updateMaterialAnalysisReportButtons();
    try {
        const response = await fetch(`/api/material-analysis/directions/${encodeURIComponent(directionKey)}/creative-brief`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ runId: materialAnalysisState.currentRunId })
        });
        const data = await materialAnalysisReadResponse(response, '生成方向创意 brief 失败');
        renderMaterialAnalysisCreativePayload({ brief: data.brief });
        showToast('方向 brief 已生成');
    } catch (error) {
        showToast(error.message || '生成方向创意 brief 失败', 'error');
    } finally {
        materialAnalysisState.creativeGenerating = false;
        updateMaterialAnalysisReportButtons();
    }
}

async function generateMaterialAnalysisCreativePlan() {
    const runId = materialAnalysisState.currentRunId;
    if (!runId) {
        showToast('请先导入或选择一条素材分析记录', 'error');
        return;
    }
    materialAnalysisState.creativeGenerating = true;
    updateMaterialAnalysisReportButtons();
    try {
        const response = await fetch(`/api/material-analysis/imports/${encodeURIComponent(runId)}/creative-plan`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ limit: 5 })
        });
        const data = await materialAnalysisReadResponse(response, '生成下周创意计划失败');
        renderMaterialAnalysisCreativePayload({ plan: data.plan, planPath: data.planPath });
        showToast('下周创意计划已生成');
    } catch (error) {
        showToast(error.message || '生成下周创意计划失败', 'error');
    } finally {
        materialAnalysisState.creativeGenerating = false;
        updateMaterialAnalysisReportButtons();
    }
}

function jumpMaterialAnalysisCreativePage() {
    sendMaterialAnalysisCreativePayloadToCreative();
}

function materialAnalysisCreativeExpansionSelectedTargets() {
    const selected = materialAnalysisState.selectedCreativeTargetKeys;
    return materialAnalysisState.creativeTargets.filter(target => selected.has(target.targetKey));
}

function materialAnalysisCreativeExpansionPromptGroups(target) {
    const override = materialAnalysisState.creativeTargetOverrides[target.targetKey];
    const value = override !== undefined && override !== ''
        ? override
        : materialAnalysisState.creativeDefaultPromptGroups;
    const number = Number(value);
    if (!Number.isFinite(number)) return 5;
    return Math.max(1, Math.min(10, Math.floor(number)));
}

function materialAnalysisCreativeExpansionEstimate() {
    const selectedTargets = materialAnalysisCreativeExpansionSelectedTargets();
    const promptCount = selectedTargets.reduce((sum, target) => {
        return sum + 2 * materialAnalysisCreativeExpansionPromptGroups(target);
    }, 0);
    const imageCount = promptCount * (Number(config?.creativeLegilGeneration?.outputQuantity) || 1);
    return {
        selectedTargetCount: selectedTargets.length,
        promptCount,
        imageCount
    };
}

function updateMaterialAnalysisCreativeExpansionButtons() {
    const loadBtn = document.getElementById('materialAnalysisCreativeTargetsLoadBtn');
    const generateBtn = document.getElementById('materialAnalysisCreativeExpansionGenerateBtn');
    const exportBtn = document.getElementById('materialAnalysisCreativeExpansionExportBtn');
    const sendBtn = document.getElementById('materialAnalysisCreativeExpansionSendBtn');
    const defaultInput = document.getElementById('materialAnalysisCreativePromptGroupsInput');
    const estimate = materialAnalysisCreativeExpansionEstimate();
    const busy = materialAnalysisState.creativeExpansionLoading || materialAnalysisState.creativeExpansionGenerating;

    if (loadBtn) {
        loadBtn.disabled = busy || !materialAnalysisState.currentRunId;
        loadBtn.textContent = materialAnalysisState.creativeExpansionLoading ? '加载中...' : '加载 TOP100 素材';
    }
    if (generateBtn) {
        generateBtn.disabled = busy || estimate.selectedTargetCount === 0;
        generateBtn.textContent = materialAnalysisState.creativeExpansionGenerating ? '生成中...' : '生成拓展提示词池';
    }
    if (exportBtn) exportBtn.disabled = busy || !materialAnalysisState.creativeExpansionPool;
    if (sendBtn) sendBtn.disabled = busy || !materialAnalysisState.creativeExpansionPool || !Array.isArray(materialAnalysisState.creativeExpansionPool.prompts) || materialAnalysisState.creativeExpansionPool.prompts.length === 0;
    if (defaultInput) {
        defaultInput.disabled = busy;
        defaultInput.value = materialAnalysisState.creativeDefaultPromptGroups;
    }
}

function updateMaterialAnalysisCreativeExpansionMeta() {
    const meta = document.getElementById('materialAnalysisCreativeExpansionMeta');
    const estimate = materialAnalysisCreativeExpansionEstimate();
    if (meta) {
        const targetCount = materialAnalysisState.creativeTargets.length;
        const pool = materialAnalysisState.creativeExpansionPool;
        const poolText = pool ? `，当前池 ${pool.promptCount || 0} 组` : '';
        meta.textContent = targetCount
            ? `已加载 ${targetCount} 张 Top100 素材，已选 ${estimate.selectedTargetCount} 张，预计 ${estimate.promptCount} 组提示词 / ${estimate.imageCount} 张图${poolText}`
            : '加载后按 Top100 素材逐张生成待拓展目标，不按重叠方向合并。';
    }
    updateMaterialAnalysisCreativeExpansionButtons();
}

function renderMaterialAnalysisCreativeTargets(targets = materialAnalysisState.creativeTargets) {
    materialAnalysisState.creativeTargets = Array.isArray(targets) ? targets : [];
    const list = document.getElementById('materialAnalysisCreativeTargetsList');
    if (!list) {
        updateMaterialAnalysisCreativeExpansionMeta();
        return;
    }
    list.textContent = '';

    if (!materialAnalysisState.creativeTargets.length) {
        list.textContent = '尚未加载 TOP100 素材。';
        updateMaterialAnalysisCreativeExpansionMeta();
        return;
    }

    materialAnalysisState.creativeTargets.forEach((target, index) => {
        const checked = materialAnalysisState.selectedCreativeTargetKeys.has(target.targetKey);
        const item = materialAnalysisMakeEl('div', 'material-analysis-creative-target');
        item.classList.toggle('is-selected', checked);

        const head = materialAnalysisMakeEl('div', 'material-analysis-creative-target-head');
        const label = materialAnalysisMakeEl('label', 'material-analysis-creative-target-check');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = checked;
        checkbox.addEventListener('change', () => {
            toggleMaterialAnalysisCreativeTarget(target.targetKey, checkbox.checked);
        });
        const title = materialAnalysisMakeEl('span', '', `#${index + 1} ${target.sourceMaterialName || target.materialName || target.sourceDirectionPath || target.targetKey}`);
        label.appendChild(checkbox);
        label.appendChild(title);

        const overrideWrap = materialAnalysisMakeEl('div', 'material-analysis-creative-target-override');
        overrideWrap.appendChild(materialAnalysisMakeEl('span', '', '提示词组数'));
        const input = document.createElement('input');
        input.type = 'number';
        input.min = '1';
        input.max = '10';
        input.step = '1';
        input.value = materialAnalysisState.creativeTargetOverrides[target.targetKey] || '';
        input.placeholder = String(materialAnalysisState.creativeDefaultPromptGroups);
        input.addEventListener('change', () => setMaterialAnalysisCreativeTargetOverride(target.targetKey, input.value));
        overrideWrap.appendChild(input);

        head.appendChild(label);
        head.appendChild(overrideWrap);

        const stats = materialAnalysisMakeEl('div', 'material-analysis-creative-target-stats');
        [
            `${materialAnalysisFormatNumber(target.materialCount)} 条素材`,
            `花费 ${materialAnalysisFormatNumber(target.spend)}`,
            `安装 ${materialAnalysisFormatNumber(target.installs)}`,
            `视觉 ${materialAnalysisFormatNumber(target.visionReadyCount)}/${materialAnalysisFormatNumber(target.materialCount)}`
        ].forEach(text => stats.appendChild(materialAnalysisMakeEl('span', '', text)));

        const summary = materialAnalysisMakeEl('p', '', target.visualSummary || target.performanceSummary || '');
        const tags = materialAnalysisMakeEl('div', 'material-analysis-creative-target-tags');
        [
            ...(Array.isArray(target.retainElements) ? target.retainElements.slice(0, 3) : []),
            ...(Array.isArray(target.variationAxes) ? target.variationAxes.slice(0, 3) : [])
        ].filter(Boolean).slice(0, 6).forEach(text => tags.appendChild(materialAnalysisMakeEl('span', '', text)));

        item.appendChild(head);
        item.appendChild(stats);
        item.appendChild(summary);
        item.appendChild(tags);
        list.appendChild(item);
    });

    updateMaterialAnalysisCreativeExpansionMeta();
}

function renderMaterialAnalysisCreativeExpansionPool(pool = materialAnalysisState.creativeExpansionPool) {
    materialAnalysisState.creativeExpansionPool = pool || null;
    const panel = document.getElementById('materialAnalysisCreativePoolPanel');
    if (!panel) {
        updateMaterialAnalysisCreativeExpansionMeta();
        return;
    }
    panel.textContent = '';
    if (!pool) {
        panel.textContent = '提示词池生成后会显示目标数、提示词数和存储路径。';
        updateMaterialAnalysisCreativeExpansionMeta();
        return;
    }

    const head = materialAnalysisMakeEl('div', 'material-analysis-creative-head');
    head.appendChild(materialAnalysisMakeEl('strong', '', `${pool.projectName || '--'} / ${pool.weekId || '--'} 提示词池`));
    head.appendChild(materialAnalysisMakeEl('span', '', `${pool.promptCount || 0} 组`));

    const rows = materialAnalysisMakeEl('div', 'material-analysis-creative-summary');
    [
        ['目标模式', Array.isArray(pool.settings?.aggregateBy) ? pool.settings.aggregateBy.join('/') : 'Top100 素材'],
        ['素材', `${pool.targetCount || 0} 张 Top100 素材 × ${pool.settings?.newDirectionsPerSource || 3} 个新方向`],
        ['默认组数', `${pool.settings?.defaultPromptGroupsPerNewDirection || 4} 组`],
        ['扩展ID', pool.expansionId],
        ['提醒', Array.isArray(pool.warnings) && pool.warnings.length ? pool.warnings.join('；') : '已生成可送入量产的提示词池']
    ].forEach(([label, value]) => {
        if (!value) return;
        const row = materialAnalysisMakeEl('div', 'material-analysis-creative-row');
        row.appendChild(materialAnalysisMakeEl('span', '', label));
        row.appendChild(materialAnalysisMakeEl('strong', '', value));
        rows.appendChild(row);
    });

    const preview = materialAnalysisMakeEl('div', 'material-analysis-creative-pool-preview');
    (pool.prompts || []).slice(0, 6).forEach(prompt => {
        const item = materialAnalysisMakeEl('div', 'material-analysis-creative-pool-prompt');
        item.appendChild(materialAnalysisMakeEl('strong', '', prompt.direction || prompt.promptTitle || '--'));
        const standardLabelPath = materialAnalysisLabelPathText(prompt.standardLabelPath);
        const saveNamePreview = String(prompt.outputNameBase || '').trim();
        if (standardLabelPath || saveNamePreview) {
            item.appendChild(materialAnalysisMakeEl(
                'small',
                'material-analysis-creative-naming',
                [
                    standardLabelPath ? `标准标签：${standardLabelPath}` : '',
                    saveNamePreview ? `保存名：${saveNamePreview}` : ''
                ].filter(Boolean).join('；')
            ));
        }
        item.appendChild(materialAnalysisMakeEl('span', '', prompt.prompt || ''));
        preview.appendChild(item);
    });

    panel.appendChild(head);
    panel.appendChild(rows);
    panel.appendChild(preview);
    updateMaterialAnalysisCreativeExpansionMeta();
}

function resetMaterialAnalysisCreativeExpansion() {
    materialAnalysisState.creativeTargets = [];
    materialAnalysisState.selectedCreativeTargetKeys.clear();
    materialAnalysisState.creativeTargetOverrides = {};
    materialAnalysisState.creativeExpansionPool = null;
    renderMaterialAnalysisCreativeTargets([]);
    renderMaterialAnalysisCreativeExpansionPool(null);
}

function setMaterialAnalysisCreativeDefaultPromptGroups(value) {
    materialAnalysisState.creativeDefaultPromptGroups = Math.max(1, Math.min(10, Math.floor(Number(value) || 4)));
    updateMaterialAnalysisCreativeExpansionMeta();
    renderMaterialAnalysisCreativeTargets();
}

function setMaterialAnalysisCreativeTargetOverride(targetKey, value) {
    if (!targetKey) return;
    const text = String(value || '').trim();
    if (!text) {
        delete materialAnalysisState.creativeTargetOverrides[targetKey];
    } else {
        materialAnalysisState.creativeTargetOverrides[targetKey] = Math.max(1, Math.min(10, Math.floor(Number(text) || materialAnalysisState.creativeDefaultPromptGroups)));
    }
    updateMaterialAnalysisCreativeExpansionMeta();
}

function toggleMaterialAnalysisCreativeTarget(targetKey, checked) {
    if (!targetKey) return;
    if (checked) {
        materialAnalysisState.selectedCreativeTargetKeys.add(targetKey);
    } else {
        materialAnalysisState.selectedCreativeTargetKeys.delete(targetKey);
    }
    renderMaterialAnalysisCreativeTargets();
}

function selectAllMaterialAnalysisCreativeTargets() {
    materialAnalysisState.creativeTargets.forEach(target => materialAnalysisState.selectedCreativeTargetKeys.add(target.targetKey));
    renderMaterialAnalysisCreativeTargets();
}

function clearMaterialAnalysisCreativeTargets() {
    materialAnalysisState.selectedCreativeTargetKeys.clear();
    renderMaterialAnalysisCreativeTargets();
}

async function loadMaterialAnalysisCreativeTargets() {
    const runId = materialAnalysisState.currentRunId;
    if (!runId) {
        showToast('请先导入或选择一条素材分析记录', 'error');
        return;
    }
    materialAnalysisState.creativeExpansionLoading = true;
    updateMaterialAnalysisCreativeExpansionButtons();
    try {
        const response = await fetch(`/api/material-analysis/imports/${encodeURIComponent(runId)}/creative-targets?defaultPromptGroupsPerNewDirection=${encodeURIComponent(materialAnalysisState.creativeDefaultPromptGroups)}`);
        const data = await materialAnalysisReadResponse(response, '加载 TOP100 创意方向失败');
        materialAnalysisState.creativeTargetOverrides = {};
        materialAnalysisState.selectedCreativeTargetKeys = new Set();
        renderMaterialAnalysisCreativeTargets(data.targets || []);
        showToast(`已加载 ${Array.isArray(data.targets) ? data.targets.length : 0} 张 TOP100 素材`);
    } catch (error) {
        showToast(error.message || '加载 TOP100 素材拓展目标失败', 'error');
    } finally {
        materialAnalysisState.creativeExpansionLoading = false;
        updateMaterialAnalysisCreativeExpansionButtons();
    }
}

async function generateMaterialAnalysisCreativeExpansion() {
    const runId = materialAnalysisState.currentRunId;
    const selectedTargets = materialAnalysisCreativeExpansionSelectedTargets();
    if (!runId) {
        showToast('请先导入或选择一条素材分析记录', 'error');
        return;
    }
    if (!selectedTargets.length) {
        showToast('请至少勾选一张要拓展的 Top100 素材', 'error');
        return;
    }

    materialAnalysisState.creativeExpansionGenerating = true;
    updateMaterialAnalysisCreativeExpansionButtons();
    renderMaterialAnalysisCreativeExpansionPool({
        projectName: materialAnalysisState.overview?.projectName || '',
        weekId: '',
        promptCount: 0,
        targetCount: selectedTargets.length,
        warnings: ['正在调用 Lumos Winky 生成提示词池']
    });

    try {
        const overrides = {};
        selectedTargets.forEach(target => {
            if (materialAnalysisState.creativeTargetOverrides[target.targetKey] !== undefined) {
                overrides[target.targetKey] = materialAnalysisCreativeExpansionPromptGroups(target);
            }
        });
        const response = await fetch(`/api/material-analysis/imports/${encodeURIComponent(runId)}/creative-expansion`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                targetKeys: selectedTargets.map(target => target.targetKey),
                defaultPromptGroupsPerNewDirection: materialAnalysisState.creativeDefaultPromptGroups,
                overrides
            })
        });
        const data = await materialAnalysisReadResponse(response, '生成 TOP100 拓展提示词池失败');
        renderMaterialAnalysisCreativeExpansionPool(data.pool || null);
        showToast(`提示词池已生成：${data.pool?.promptCount || 0} 组`);
    } catch (error) {
        renderMaterialAnalysisCreativeExpansionPool(null);
        showToast(error.message || '生成 TOP100 拓展提示词池失败', 'error');
    } finally {
        materialAnalysisState.creativeExpansionGenerating = false;
        updateMaterialAnalysisCreativeExpansionButtons();
    }
}

async function exportMaterialAnalysisCreativeExpansionJs() {
    const pool = materialAnalysisState.creativeExpansionPool;
    if (!pool || !pool.expansionId) {
        showToast('请先生成提示词池', 'error');
        return;
    }
    try {
        const response = await fetch(`/api/material-analysis/creative-expansions/${encodeURIComponent(pool.expansionId)}/export-js`, {
            method: 'POST'
        });
        const data = await materialAnalysisReadResponse(response, '导出 JS 快照失败');
        showToast(data.message || 'JS 快照已导出');
    } catch (error) {
        showToast(error.message || '导出 JS 快照失败', 'error');
    }
}

function sendMaterialAnalysisPromptPoolToCreative() {
    const pool = materialAnalysisState.creativeExpansionPool;
    const prompts = Array.isArray(pool && pool.prompts) ? pool.prompts : [];
    if (!prompts.length) {
        showToast('请先生成提示词池', 'error');
        return;
    }

    config.creativePrompts = prompts.map((item, index) => ({
        ...item,
        index: index + 1,
        sourceRow: Number(item.sourceRow) || index + 1,
        selected: item.selected !== false
    }));
    config.creativeTableFileName = `${pool.projectName || '素材分析'}_${pool.weekId || 'week'}_${pool.expansionId || 'prompt-pool'}.json`;
    if (typeof renderCreativePromptPreview === 'function') {
        renderCreativePromptPreview(config.creativePrompts);
    }
    const infoBox = document.getElementById('creativeTableInfo');
    if (infoBox) {
        infoBox.className = 'info-box success';
        infoBox.textContent = `✅ 已载入素材分析提示词池：${config.creativePrompts.length} 组，可勾选后开始量产。`;
    }
    if (typeof switchPage === 'function') {
        switchPage('creative');
    }
    setTimeout(() => {
        document.getElementById('creativePromptPreview')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 120);
    showToast(`已送入创意拓展提示词池：${config.creativePrompts.length} 组`);
}

function renderMaterialAnalysisReports(payload = materialAnalysisState.reports) {
    materialAnalysisState.reports = payload || null;
    const status = document.getElementById('materialAnalysisReportStatus');
    const paths = document.getElementById('materialAnalysisReportPaths');
    const preview = document.getElementById('materialAnalysisReportPreview');
    const current = materialAnalysisCurrentReport();
    const weekly = materialAnalysisCurrentReport('weekly');
    const experience = materialAnalysisCurrentReport('experience');

    document.querySelectorAll('[data-material-report-tab]').forEach(button => {
        button.classList.toggle('active', button.dataset.materialReportTab === materialAnalysisState.reportTab);
    });

    if (status) {
        if (!materialAnalysisState.currentRunId) {
            status.textContent = '导入或选择一条素材分析记录后，可以生成周报和经验文档。';
        } else if (!weekly && !experience) {
            status.textContent = '尚未生成报告。点击生成后会保存 weekly-report.md 和 experience.md。';
        } else {
            const generated = [weekly, experience].filter(item => item && item.exists).length;
            status.textContent = `报告状态：已生成 ${generated} / 2，目录 ${materialAnalysisState.reports?.reportDir || '--'}`;
        }
    }

    if (paths) {
        paths.textContent = '';
        if (!materialAnalysisState.reports || (!weekly && !experience)) {
            paths.textContent = '尚未生成报告。';
        } else {
            [
                ['周报', weekly],
                ['经验文档', experience]
            ].forEach(([label, item]) => {
                const row = materialAnalysisMakeEl('div', 'material-analysis-report-path-row');
                row.appendChild(materialAnalysisMakeEl('strong', '', label));
                row.appendChild(materialAnalysisMakeEl('span', '', item && item.exists ? item.path : '尚未生成'));
                paths.appendChild(row);
            });
        }
    }

    if (preview) {
        if (current && current.exists && current.content) {
            preview.textContent = current.content;
        } else if (materialAnalysisState.currentRunId) {
            preview.textContent = '当前报告尚未生成。点击“生成周报”或“生成经验文档”即可同时生成两份 Markdown。';
        } else {
            preview.textContent = '导入数据后生成周报和经验文档。';
        }
    }

    updateMaterialAnalysisReportButtons();
}

function setMaterialAnalysisReportTab(type) {
    materialAnalysisState.reportTab = type === 'experience' ? 'experience' : 'weekly';
    renderMaterialAnalysisReports();
}

async function copyMaterialAnalysisText(text, label = '内容') {
    const value = String(text || '');
    if (!value.trim()) {
        showToast(`${label}为空，无法复制`, 'error');
        return;
    }
    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(value);
        } else {
            const textarea = document.createElement('textarea');
            textarea.value = value;
            textarea.setAttribute('readonly', 'readonly');
            textarea.style.position = 'fixed';
            textarea.style.left = '-9999px';
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
        }
        showToast(`${label}已复制`);
    } catch (error) {
        showToast(`${label}复制失败：${error.message}`, 'error');
    }
}

async function copyMaterialAnalysisReport(type) {
    const report = materialAnalysisCurrentReport(type);
    if (!report || !report.exists || !report.content) {
        showToast('报告尚未生成，无法复制', 'error');
        return;
    }
    await copyMaterialAnalysisText(report.content, report.label || '报告');
}

async function loadMaterialAnalysisReports(runId, options = {}) {
    if (!runId) {
        renderMaterialAnalysisReports(null);
        return;
    }
    try {
        const response = await fetch(`/api/material-analysis/imports/${encodeURIComponent(runId)}/reports`);
        const data = await materialAnalysisReadResponse(response, '读取素材分析报告失败');
        renderMaterialAnalysisReports(data);
    } catch (error) {
        if (!options.silent) showToast(error.message || '读取素材分析报告失败', 'error');
        renderMaterialAnalysisReports(null);
    }
}

async function generateMaterialAnalysisReports() {
    const runId = materialAnalysisState.currentRunId;
    if (!runId) {
        showToast('请先导入或选择一条素材分析记录', 'error');
        return;
    }
    materialAnalysisState.reportsGenerating = true;
    updateMaterialAnalysisReportButtons();
    try {
        const response = await fetch(`/api/material-analysis/imports/${encodeURIComponent(runId)}/reports/generate`, {
            method: 'POST'
        });
        const data = await materialAnalysisReadResponse(response, '生成素材分析报告失败');
        renderMaterialAnalysisReports(data);
        showToast(data.message || '素材分析报告已生成');
    } catch (error) {
        showToast(error.message || '生成素材分析报告失败', 'error');
    } finally {
        materialAnalysisState.reportsGenerating = false;
        updateMaterialAnalysisReportButtons();
    }
}

async function openMaterialAnalysisReport(type = 'folder') {
    const runId = materialAnalysisState.currentRunId;
    if (!runId) {
        showToast('请先导入或选择一条素材分析记录', 'error');
        return;
    }
    try {
        const response = await fetch(`/api/material-analysis/imports/${encodeURIComponent(runId)}/reports/open`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type })
        });
        const data = await materialAnalysisReadResponse(response, '打开素材分析报告位置失败');
        showToast(data.message || '已打开报告位置');
    } catch (error) {
        showToast(error.message || '打开素材分析报告位置失败', 'error');
    }
}

async function collectMaterialAnalysisKnowledge(url, payload, fallbackMessage, confirmText) {
    if (!materialAnalysisState.currentRunId) {
        showToast('请先导入或选择一条素材分析记录', 'error');
        return null;
    }
    if (confirmText && !window.confirm(confirmText)) {
        return null;
    }

    materialAnalysisState.collectingKnowledge = true;
    updateMaterialAnalysisReportButtons();
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                runId: materialAnalysisState.currentRunId,
                confirm: true,
                ...(payload || {})
            })
        });
        const data = await materialAnalysisReadResponse(response, fallbackMessage);
        showToast(data.message || '已沉淀到素材经验池', 'success');
        if (typeof loadCreativeKnowledgePage === 'function') {
            loadCreativeKnowledgePage({ silent: true }).catch(() => {});
        }
        return data;
    } catch (error) {
        showToast(error.message || fallbackMessage, 'error');
        return null;
    } finally {
        materialAnalysisState.collectingKnowledge = false;
        updateMaterialAnalysisReportButtons();
    }
}

async function collectMaterialAnalysisMaterialKnowledge(materialId, decision = 'positive') {
    if (!materialId) return null;
    const material = materialAnalysisState.top100.find(item => item.materialId === materialId) || {};
    const isNegative = decision === 'negative';
    return await collectMaterialAnalysisKnowledge(
        `/api/material-analysis/materials/${encodeURIComponent(materialId)}/collect-knowledge`,
        {
            decision,
            reason: isNegative
                ? (material.health && material.health.action) || '人工确认该素材存在风险，写入避坑规则。'
                : (material.health && material.health.action) || '人工确认该素材值得复刻，沉淀到素材经验池。'
        },
        isNegative ? '写入素材避坑经验失败' : '沉淀素材经验失败',
        isNegative
            ? `确认把「${material.materialName || materialId}」写入长期避坑经验？`
            : `确认把「${material.materialName || materialId}」沉淀到素材经验池？它不会直接进入方向库。`
    );
}

async function collectMaterialAnalysisDirectionKnowledge(directionKey, decision = 'positive') {
    if (!directionKey) return null;
    const direction = materialAnalysisState.directions.find(item => item.directionKey === directionKey) || {};
    const isNegative = decision === 'negative';
    return await collectMaterialAnalysisKnowledge(
        `/api/material-analysis/directions/${encodeURIComponent(directionKey)}/collect-knowledge`,
        {
            decision,
            reason: direction.action || (isNegative ? '人工确认该方向存在风险，写入避坑规则。' : '人工确认该方向值得下一轮复刻。')
        },
        isNegative ? '写入方向避坑经验失败' : '沉淀方向经验失败',
        isNegative
            ? `确认把「${directionKey}」写入长期方向风险？`
            : `确认把「${directionKey}」沉淀到素材经验池？它不会直接进入方向库。`
    );
}

async function collectMaterialAnalysisWeeklyLearnings() {
    const runId = materialAnalysisState.currentRunId;
    if (!runId) {
        showToast('请先导入或选择一条素材分析记录', 'error');
        return null;
    }
    return await collectMaterialAnalysisKnowledge(
        `/api/material-analysis/imports/${encodeURIComponent(runId)}/collect-weekly-learnings`,
        {
            positiveLimit: 3,
            negativeLimit: 3
        },
        '沉淀本周素材分析经验失败',
        '确认把本周 Top 素材和风险素材各 3 条沉淀到素材经验池？负向经验会同步进入 Prompt Gate 避坑规则。'
    );
}

async function createMaterialAnalysisDirectionDraft(url, payload, fallbackMessage, confirmText) {
    if (!materialAnalysisState.currentRunId) {
        showToast('请先导入或选择一条素材分析记录', 'error');
        return null;
    }
    if (confirmText && !window.confirm(confirmText)) {
        return null;
    }
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                runId: materialAnalysisState.currentRunId,
                confirm: true,
                ...(payload || {})
            })
        });
        const data = await materialAnalysisReadResponse(response, fallbackMessage);
        showToast(data.message || '已加入本地成长方向草案', 'success');
        if (typeof loadCreativeKnowledgeDrafts === 'function') {
            loadCreativeKnowledgeDrafts().catch(() => {});
        }
        return data;
    } catch (error) {
        showToast(error.message || fallbackMessage, 'error');
        return null;
    }
}

async function createMaterialAnalysisMaterialDirectionDraft(materialId) {
    if (!materialId) return null;
    const material = materialAnalysisState.top100.find(item => item.materialId === materialId) || {};
    return await createMaterialAnalysisDirectionDraft(
        `/api/material-analysis/materials/${encodeURIComponent(materialId)}/create-direction-draft`,
        {
            decision: 'positive',
            reason: (material.health && material.health.action) || '人工选择该素材方向进入候选方向。'
        },
        '素材转为方向草案失败',
        `确认把「${material.materialName || materialId}」转为本地成长方向草案？参考图将标记为待手动上传。`
    );
}

async function createMaterialAnalysisDirectionDirectionDraft(directionKey) {
    if (!directionKey) return null;
    const direction = materialAnalysisState.directions.find(item => item.directionKey === directionKey) || {};
    return await createMaterialAnalysisDirectionDraft(
        `/api/material-analysis/directions/${encodeURIComponent(directionKey)}/create-direction-draft`,
        {
            decision: 'positive',
            reason: direction.action || '人工选择该方向进入候选方向。'
        },
        '方向转为方向草案失败',
        `确认把「${directionKey}」转为本地成长方向草案？参考图将标记为待手动上传。`
    );
}

function renderMaterialAnalysisDirectionShare(directions = []) {
    const chart = document.getElementById('materialAnalysisShareChart');
    const meta = document.getElementById('materialAnalysisShareMeta');
    if (!chart) return;
    chart.textContent = '';

    const rows = (Array.isArray(directions) ? directions : [])
        .filter(item => Number(item.spend) > 0)
        .sort((a, b) => (Number(b.spend) || 0) - (Number(a.spend) || 0));
    const totalSpend = rows.reduce((sum, item) => sum + (Number(item.spend) || 0), 0);
    if (meta) {
        meta.textContent = totalSpend > 0 ? `Top ${Math.min(10, rows.length)} / 共 ${rows.length} 个方向` : '等待方向数据';
    }
    if (!rows.length || totalSpend <= 0) {
        chart.textContent = '导入数据后按二级标签展示消耗占比。';
        return;
    }

    rows.slice(0, 10).forEach(item => {
        const share = totalSpend > 0 ? (Number(item.spend) || 0) / totalSpend : 0;
        const row = materialAnalysisMakeEl('div', 'material-analysis-share-row');
        const label = materialAnalysisMakeEl('div', 'material-analysis-share-label');
        label.appendChild(materialAnalysisMakeEl('strong', '', item.secondary || item.directionKey || '--'));
        label.appendChild(materialAnalysisMakeEl('span', '', item.primary || '--'));

        const track = materialAnalysisMakeEl('div', 'material-analysis-share-track');
        const bar = materialAnalysisMakeEl('div', 'material-analysis-share-bar');
        bar.style.width = `${Math.max(2, Math.round(share * 100))}%`;
        track.appendChild(bar);

        const value = materialAnalysisMakeEl(
            'div',
            'material-analysis-share-value',
            `${materialAnalysisFormatPercent(share)} / ${materialAnalysisFormatNumber(item.spend)}`
        );
        row.appendChild(label);
        row.appendChild(track);
        row.appendChild(value);
        chart.appendChild(row);
    });
}

function renderMaterialAnalysisDirections(directions = [], summary = {}) {
    materialAnalysisState.directions = Array.isArray(directions) ? directions : [];
    renderMaterialAnalysisDirectionShare(materialAnalysisState.directions);
    const tbody = document.getElementById('materialAnalysisDirectionBody');
    const meta = document.getElementById('materialAnalysisDirectionMeta');
    if (meta) {
        meta.textContent = summary.runId
            ? `${summary.projectName || '--'} / ${summary.weekId || '--'}，共 ${materialAnalysisState.directions.length} 个方向分组`
            : '导入后按一级/二级方向聚合。';
    }
    if (!tbody) return;

    tbody.textContent = '';
    if (materialAnalysisState.directions.length === 0) {
        const row = document.createElement('tr');
        const cell = materialAnalysisMakeEl('td', '', '导入数据后显示方向表现。');
        cell.colSpan = 11;
        row.appendChild(cell);
        tbody.appendChild(row);
        return;
    }

    materialAnalysisState.directions.slice(0, 30).forEach(item => {
        const row = document.createElement('tr');
        const cells = [
            item.directionKey || '--',
            materialAnalysisFormatNumber(item.materialCount),
            materialAnalysisFormatNumber(item.top100Count),
            materialAnalysisFormatNumber(item.spend),
            materialAnalysisFormatNumber(item.installs),
            materialAnalysisFormatNumber(item.cpi),
            materialAnalysisFormatNumber(item.ipm),
            materialAnalysisFormatPercent(item.d0IapRoi),
            materialAnalysisFormatNumber(item.avgHealthScore),
            item.status || {},
            item.action || '--'
        ];

        cells.forEach((value, index) => {
            const cell = materialAnalysisMakeEl('td', index === 0 ? 'material-analysis-direction-cell' : '', '');
            if (index === 9) {
                cell.appendChild(materialAnalysisPill(value, '观察'));
            } else if (index === 10) {
                const actionWrap = materialAnalysisMakeEl('div', 'material-analysis-row-action');
                actionWrap.appendChild(materialAnalysisMakeEl('span', '', String(value || '--')));
                const briefBtn = materialAnalysisMakeEl('button', 'creative-mini-btn', '加入创意拓展');
                briefBtn.type = 'button';
                briefBtn.addEventListener('click', () => generateMaterialAnalysisDirectionCreativeBrief(item.directionKey));
                const decision = materialAnalysisCollectDecisionForDirection(item);
                const collectBtn = materialAnalysisMakeEl('button', 'creative-mini-btn', materialAnalysisCollectButtonText(decision, 'direction'));
                collectBtn.type = 'button';
                collectBtn.addEventListener('click', () => collectMaterialAnalysisDirectionKnowledge(item.directionKey, decision));
                const draftBtn = materialAnalysisMakeEl('button', 'creative-mini-btn', materialAnalysisDraftButtonText('direction'));
                draftBtn.type = 'button';
                draftBtn.addEventListener('click', () => createMaterialAnalysisDirectionDirectionDraft(item.directionKey));
                actionWrap.appendChild(briefBtn);
                actionWrap.appendChild(collectBtn);
                if (decision !== 'negative') {
                    actionWrap.appendChild(draftBtn);
                }
                cell.appendChild(actionWrap);
            } else {
                cell.textContent = value;
            }
            row.appendChild(cell);
        });
        tbody.appendChild(row);
    });
}

function materialAnalysisGetVisionResult(materialId) {
    return materialAnalysisState.visionResults.find(item => item.materialId === materialId) || null;
}

function materialAnalysisVisionStatusOf(material) {
    const result = materialAnalysisGetVisionResult(material.materialId);
    return result ? result.status : 'pending';
}

function materialAnalysisImageSrc(material = {}) {
    if (!material.materialId || !materialAnalysisState.currentRunId) {
        return material.contentUrl || '';
    }
    return `/api/material-analysis/imports/${encodeURIComponent(materialAnalysisState.currentRunId)}/materials/${encodeURIComponent(material.materialId)}/image`;
}

function materialAnalysisHasImageSource(material = {}) {
    return Boolean(material.contentUrl || material.contentText);
}

function materialAnalysisDirectionText(material = {}) {
    const parsed = material.parsedName || {};
    return [parsed.primary, parsed.secondary, parsed.idea]
        .map(value => String(value || '').trim())
        .filter(Boolean)
        .join(' / ');
}

function ensureMaterialAnalysisImagePreview() {
    let overlay = document.getElementById('materialAnalysisImagePreview');
    if (overlay) return overlay;

    overlay = materialAnalysisMakeEl('div', 'material-analysis-image-preview');
    overlay.id = 'materialAnalysisImagePreview';
    overlay.hidden = true;
    overlay.tabIndex = -1;

    const dialog = materialAnalysisMakeEl('div', 'material-analysis-image-preview-dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'materialAnalysisImagePreviewTitle');
    dialog.addEventListener('click', event => event.stopPropagation());

    const closeButton = materialAnalysisMakeEl('button', 'material-analysis-image-preview-close', '×');
    closeButton.type = 'button';
    closeButton.setAttribute('aria-label', '关闭大图预览');
    closeButton.addEventListener('click', closeMaterialAnalysisImagePreview);

    const frame = materialAnalysisMakeEl('div', 'material-analysis-image-preview-frame');
    const image = document.createElement('img');
    image.alt = '素材大图';
    image.decoding = 'async';
    image.referrerPolicy = 'no-referrer';
    const failed = materialAnalysisMakeEl('div', 'material-analysis-image-preview-failed', '大图加载失败');
    failed.hidden = true;
    image.addEventListener('load', () => {
        image.hidden = false;
        failed.hidden = true;
    });
    image.addEventListener('error', () => {
        image.hidden = true;
        failed.hidden = false;
    });
    frame.appendChild(image);
    frame.appendChild(failed);

    const footer = materialAnalysisMakeEl('div', 'material-analysis-image-preview-footer');
    const title = materialAnalysisMakeEl('strong', '');
    title.id = 'materialAnalysisImagePreviewTitle';
    const meta = materialAnalysisMakeEl('span', '');
    footer.appendChild(title);
    footer.appendChild(meta);

    dialog.appendChild(closeButton);
    dialog.appendChild(frame);
    dialog.appendChild(footer);
    overlay.appendChild(dialog);
    overlay.addEventListener('click', closeMaterialAnalysisImagePreview);
    document.body.appendChild(overlay);

    if (!document.body.dataset.materialAnalysisPreviewEscBound) {
        document.body.dataset.materialAnalysisPreviewEscBound = 'true';
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape') closeMaterialAnalysisImagePreview();
        });
    }

    return overlay;
}

function openMaterialAnalysisImagePreview(materialId) {
    const material = materialAnalysisState.top100.find(item => item.materialId === materialId);
    if (!material || !materialAnalysisHasImageSource(material)) {
        showToast('该素材暂无可预览图片', 'error');
        return;
    }

    const overlay = ensureMaterialAnalysisImagePreview();
    const image = overlay.querySelector('img');
    const failed = overlay.querySelector('.material-analysis-image-preview-failed');
    const title = overlay.querySelector('#materialAnalysisImagePreviewTitle');
    const meta = overlay.querySelector('.material-analysis-image-preview-footer span');
    const direction = materialAnalysisDirectionText(material);

    if (failed) failed.hidden = true;
    if (image) {
        image.hidden = false;
        image.src = '';
        image.alt = material.materialName || '素材大图';
        image.src = materialAnalysisImageSrc(material);
    }
    if (title) title.textContent = `#${material.topRank || '--'} ${material.materialName || '--'}`;
    if (meta) meta.textContent = direction || '素材大图预览';

    overlay.hidden = false;
    document.body.classList.add('material-analysis-preview-open');
    requestAnimationFrame(() => {
        overlay.classList.add('is-open');
        overlay.focus();
    });
}

function closeMaterialAnalysisImagePreview() {
    const overlay = document.getElementById('materialAnalysisImagePreview');
    if (!overlay || overlay.hidden) return;
    overlay.classList.remove('is-open');
    document.body.classList.remove('material-analysis-preview-open');
    window.setTimeout(() => {
        if (!overlay.classList.contains('is-open')) {
            overlay.hidden = true;
        }
    }, 120);
}

function materialAnalysisSelectedVisionIds() {
    return [...materialAnalysisState.selectedVisionMaterialIds]
        .filter(materialId => materialAnalysisState.top100.some(material => material.materialId === materialId));
}

function updateMaterialAnalysisVisionSelectionUi() {
    const selectedCount = materialAnalysisSelectedVisionIds().length;
    const meta = document.getElementById('materialAnalysisVisionSelectionMeta');
    const startButton = document.getElementById('materialAnalysisVisionStartBtn');
    const allButton = document.getElementById('materialAnalysisVisionAllBtn');
    const clearTaskButton = document.getElementById('materialAnalysisVisionClearBtn');
    const selectVisibleButton = document.getElementById('materialAnalysisVisionSelectVisibleBtn');
    const clearSelectionButton = document.getElementById('materialAnalysisVisionClearSelectionBtn');
    const sendCreativeButton = document.getElementById('materialAnalysisVisionSendCreativeBtn');
    const running = Boolean(materialAnalysisState.visionStatus && materialAnalysisState.visionStatus.running);
    if (meta) {
        meta.textContent = selectedCount
            ? `已勾选 ${selectedCount} 张素材，可识别或加入创意拓展方向队列`
            : '未勾选时会默认识别当前 Top100';
    }
    if (startButton) {
        startButton.textContent = selectedCount ? `识别已勾选 ${selectedCount}` : '开始 AI 视觉识别';
        startButton.disabled = running || !materialAnalysisState.currentRunId;
    }
    if (allButton) allButton.disabled = running || !materialAnalysisState.currentRunId;
    if (clearTaskButton) clearTaskButton.disabled = !materialAnalysisState.currentRunId;
    if (selectVisibleButton) selectVisibleButton.disabled = running || !materialAnalysisCurrentVisionItems().length;
    if (clearSelectionButton) clearSelectionButton.disabled = running || selectedCount === 0;
    if (sendCreativeButton) {
        sendCreativeButton.disabled = selectedCount === 0 || !materialAnalysisState.currentRunId;
        sendCreativeButton.textContent = selectedCount
            ? `将已选素材方向加入创意拓展 ${selectedCount}`
            : '将已选素材方向加入创意拓展';
    }
}

function toggleMaterialAnalysisVisionSelection(materialId, checked) {
    if (!materialId) return;
    if (checked) {
        materialAnalysisState.selectedVisionMaterialIds.add(materialId);
    } else {
        materialAnalysisState.selectedVisionMaterialIds.delete(materialId);
    }
    updateMaterialAnalysisVisionSelectionUi();
    renderMaterialAnalysisVisionWall();
}

function materialAnalysisCurrentVisionItems() {
    const filter = materialAnalysisState.visionFilter || 'all';
    return materialAnalysisState.top100.filter(material => {
        const status = materialAnalysisVisionStatusOf(material);
        if (filter === 'all') return true;
        if (filter === 'pending') return status === 'pending';
        return status === filter;
    });
}

function selectVisibleMaterialAnalysisVision() {
    materialAnalysisCurrentVisionItems().forEach(material => {
        materialAnalysisState.selectedVisionMaterialIds.add(material.materialId);
    });
    updateMaterialAnalysisVisionSelectionUi();
    renderMaterialAnalysisVisionWall();
}

function clearMaterialAnalysisVisionSelection() {
    materialAnalysisState.selectedVisionMaterialIds.clear();
    updateMaterialAnalysisVisionSelectionUi();
    renderMaterialAnalysisVisionWall();
}

function renderMaterialAnalysisVisionStatus(status = null) {
    materialAnalysisState.visionStatus = status || null;
    const startButton = document.getElementById('materialAnalysisVisionStartBtn');
    const refreshButton = document.getElementById('materialAnalysisVisionRefreshBtn');
    const clearTaskButton = document.getElementById('materialAnalysisVisionClearBtn');
    const progressBar = document.getElementById('materialAnalysisVisionProgressBar');
    const progressText = document.getElementById('materialAnalysisVisionProgressText');
    const statusText = document.getElementById('materialAnalysisVisionStatusText');
    const stats = document.getElementById('materialAnalysisVisionStats');

    const total = Number(status && status.total) || 0;
    const completed = Number(status && status.completed) || 0;
    const percent = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;
    const running = Boolean(status && status.running);

    if (startButton) startButton.disabled = running || !materialAnalysisState.currentRunId;
    if (refreshButton) refreshButton.disabled = running;
    if (clearTaskButton) clearTaskButton.disabled = !materialAnalysisState.currentRunId;
    if (progressBar) progressBar.style.width = `${percent}%`;
    if (progressText) progressText.textContent = total ? `${completed} / ${total}` : '--';
    if (statusText) statusText.textContent = status && status.message ? status.message : '等待启动视觉识别';

    if (stats) {
        stats.textContent = '';
        [
            ['已识别', status && status.successCount],
            ['失败', status && status.failedCount],
            ['缺链接', status && status.missingImageCount],
            ['缓存', status && status.cachedCount],
            ['未识别', status && status.pendingCount]
        ].forEach(([label, value]) => {
            const item = materialAnalysisMakeEl('div', 'material-analysis-vision-stat');
            item.appendChild(materialAnalysisMakeEl('strong', '', materialAnalysisFormatNumber(value || 0)));
            item.appendChild(materialAnalysisMakeEl('span', '', label));
            stats.appendChild(item);
        });
    }
    updateMaterialAnalysisVisionSelectionUi();
}

function renderMaterialAnalysisVisionWall() {
    const wall = document.getElementById('materialAnalysisVisionWall');
    if (!wall) return;
    wall.textContent = '';

    if (!materialAnalysisState.top100.length) {
        wall.textContent = '导入数据后显示 Top100 素材视觉墙。';
        renderMaterialAnalysisVisionDetail(null);
        updateMaterialAnalysisVisionSelectionUi();
        return;
    }

    const items = materialAnalysisCurrentVisionItems();

    if (!items.length) {
        wall.textContent = '当前筛选下没有素材。';
        renderMaterialAnalysisVisionDetail(null);
        updateMaterialAnalysisVisionSelectionUi();
        return;
    }

    items.slice(0, 100).forEach(material => {
        const result = materialAnalysisGetVisionResult(material.materialId);
        const vision = result && result.vision ? result.vision : {};
        const status = result ? result.status : 'pending';
        const checked = materialAnalysisState.selectedVisionMaterialIds.has(material.materialId);
        const tile = materialAnalysisMakeEl('div', 'material-analysis-vision-tile');
        if (materialAnalysisState.selectedVisionMaterialId === material.materialId) {
            tile.classList.add('is-selected');
        }
        if (checked) {
            tile.classList.add('is-checked');
        }

        const selectLabel = materialAnalysisMakeEl('label', 'material-analysis-vision-select');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = checked;
        checkbox.addEventListener('change', event => {
            event.stopPropagation();
            toggleMaterialAnalysisVisionSelection(material.materialId, event.target.checked);
        });
        selectLabel.appendChild(checkbox);
        selectLabel.appendChild(materialAnalysisMakeEl('span', '', '选择'));

        const media = materialAnalysisMakeEl('button', 'material-analysis-vision-media');
        media.type = 'button';
        media.addEventListener('click', () => selectMaterialAnalysisVision(material.materialId));
        media.addEventListener('dblclick', event => {
            event.preventDefault();
            event.stopPropagation();
            openMaterialAnalysisImagePreview(material.materialId);
        });
        if (materialAnalysisHasImageSource(material)) {
            const img = document.createElement('img');
            img.src = materialAnalysisImageSrc(material);
            img.alt = material.materialName || '素材图片';
            img.loading = 'lazy';
            img.referrerPolicy = 'no-referrer';
            img.addEventListener('error', () => {
                media.classList.add('is-image-failed');
                media.textContent = '缩略图加载失败';
            }, { once: true });
            media.appendChild(img);
        } else {
            media.textContent = '无图片';
        }

        const body = materialAnalysisMakeEl('div', 'material-analysis-vision-body');
        const head = materialAnalysisMakeEl('div', 'material-analysis-vision-tile-head');
        head.appendChild(materialAnalysisMakeEl('strong', '', `#${material.topRank || '--'}`));
        head.appendChild(materialAnalysisVisionPill(status));
        body.appendChild(head);
        body.appendChild(materialAnalysisMakeEl('div', 'material-analysis-vision-title', material.materialName || '--'));
        body.appendChild(materialAnalysisMakeEl('p', '', vision.summary || (status === 'failed' ? result.error : '等待识别')));

        const tags = materialAnalysisMakeEl('div', 'material-analysis-vision-tags');
        [vision.mainSubject, vision.scene, vision.hook, vision.suggestedDirection].filter(Boolean).slice(0, 4).forEach(text => {
            tags.appendChild(materialAnalysisMakeEl('span', '', text));
        });
        body.appendChild(tags);

        const actions = materialAnalysisMakeEl('div', 'material-analysis-vision-actions');
        const detailBtn = materialAnalysisMakeEl('button', 'btn btn-secondary', '详情');
        detailBtn.type = 'button';
        detailBtn.addEventListener('click', () => selectMaterialAnalysisVision(material.materialId));
        const retryBtn = materialAnalysisMakeEl('button', 'btn btn-secondary', '重跑');
        retryBtn.type = 'button';
        retryBtn.addEventListener('click', () => retryMaterialAnalysisVision(material.materialId));
        const briefBtn = materialAnalysisMakeEl('button', 'btn btn-primary', '加入方向队列');
        briefBtn.type = 'button';
        briefBtn.addEventListener('click', () => sendMaterialAnalysisVisionMaterialsToCreative([material.materialId]));
        const collectBtn = materialAnalysisMakeEl('button', 'btn btn-secondary', '收录');
        collectBtn.type = 'button';
        collectBtn.addEventListener('click', () => collectMaterialAnalysisMaterialKnowledge(
            material.materialId,
            materialAnalysisCollectDecisionForMaterial(material)
        ));
        const draftBtn = materialAnalysisMakeEl('button', 'btn btn-secondary', '候选方向');
        draftBtn.type = 'button';
        draftBtn.addEventListener('click', () => createMaterialAnalysisMaterialDirectionDraft(material.materialId));
        actions.appendChild(detailBtn);
        actions.appendChild(retryBtn);
        actions.appendChild(briefBtn);
        actions.appendChild(collectBtn);
        if (materialAnalysisCollectDecisionForMaterial(material) !== 'negative') {
            actions.appendChild(draftBtn);
        }
        body.appendChild(actions);

        tile.appendChild(selectLabel);
        tile.appendChild(media);
        tile.appendChild(body);
        wall.appendChild(tile);
    });

    if (!materialAnalysisState.selectedVisionMaterialId || !items.some(item => item.materialId === materialAnalysisState.selectedVisionMaterialId)) {
        materialAnalysisState.selectedVisionMaterialId = items[0].materialId;
    }
    renderMaterialAnalysisVisionDetail(materialAnalysisState.selectedVisionMaterialId);
    updateMaterialAnalysisVisionSelectionUi();
}

function renderMaterialAnalysisVisionDetail(materialId) {
    const panel = document.getElementById('materialAnalysisVisionDetail');
    if (!panel) return;
    panel.textContent = '';
    const material = materialAnalysisState.top100.find(item => item.materialId === materialId);
    if (!material) {
        panel.textContent = '选择素材后查看视觉洞察。';
        return;
    }

    const result = materialAnalysisGetVisionResult(material.materialId);
    const vision = result && result.vision ? result.vision : {};
    panel.appendChild(materialAnalysisMakeEl('h4', '', `#${material.topRank || '--'} ${material.materialName || '--'}`));
    panel.appendChild(materialAnalysisVisionPill(result ? result.status : 'pending'));
        const detailActions = materialAnalysisMakeEl('div', 'material-analysis-creative-actions');
        const briefBtn = materialAnalysisMakeEl('button', 'btn btn-primary', '加入方向队列');
        briefBtn.type = 'button';
        briefBtn.addEventListener('click', () => sendMaterialAnalysisVisionMaterialsToCreative([material.materialId]));
        const collectPositiveBtn = materialAnalysisMakeEl('button', 'btn btn-secondary', '收录为正向证据');
        collectPositiveBtn.type = 'button';
        collectPositiveBtn.addEventListener('click', () => collectMaterialAnalysisMaterialKnowledge(material.materialId, 'positive'));
        const collectRiskBtn = materialAnalysisMakeEl('button', 'btn btn-secondary', '写入负向经验');
        collectRiskBtn.type = 'button';
        collectRiskBtn.addEventListener('click', () => collectMaterialAnalysisMaterialKnowledge(material.materialId, 'negative'));
        const draftBtn = materialAnalysisMakeEl('button', 'btn btn-secondary', '加入候选方向');
        draftBtn.type = 'button';
        draftBtn.addEventListener('click', () => createMaterialAnalysisMaterialDirectionDraft(material.materialId));
        detailActions.appendChild(briefBtn);
        detailActions.appendChild(collectPositiveBtn);
        detailActions.appendChild(collectRiskBtn);
        detailActions.appendChild(draftBtn);
        panel.appendChild(detailActions);

    if (!result) {
        panel.appendChild(materialAnalysisMakeEl('p', '', '该素材尚未识别。'));
        return;
    }
    if (result.status === 'failed') {
        panel.appendChild(materialAnalysisMakeEl('p', '', result.error || '识别失败'));
        return;
    }

    const fields = [
        ['总结', vision.summary],
        ['主体', vision.mainSubject],
        ['场景', vision.scene],
        ['事件', vision.event],
        ['情绪', vision.emotion],
        ['构图', vision.composition],
        ['色彩', vision.color],
        ['钩子', vision.hook],
        ['建议方向', vision.suggestedDirection],
        ['迭代建议', result.iterationAdvice]
    ];
    fields.forEach(([label, value]) => {
        if (!value) return;
        const row = materialAnalysisMakeEl('div', 'material-analysis-vision-detail-row');
        row.appendChild(materialAnalysisMakeEl('span', '', label));
        row.appendChild(materialAnalysisMakeEl('strong', '', value));
        panel.appendChild(row);
    });

    [
        ['保留元素', vision.retainElements],
        ['变化轴', vision.variationAxes],
        ['风险点', vision.riskNotes]
    ].forEach(([label, list]) => {
        if (!Array.isArray(list) || !list.length) return;
        const row = materialAnalysisMakeEl('div', 'material-analysis-vision-detail-row');
        row.appendChild(materialAnalysisMakeEl('span', '', label));
        row.appendChild(materialAnalysisMakeEl('strong', '', list.join('、')));
        panel.appendChild(row);
    });
}

function selectMaterialAnalysisVision(materialId) {
    materialAnalysisState.selectedVisionMaterialId = materialId;
    renderMaterialAnalysisVisionWall();
}

function setMaterialAnalysisVisionFilter(filter) {
    materialAnalysisState.visionFilter = filter || 'all';
    document.querySelectorAll('[data-material-vision-filter]').forEach(button => {
        button.classList.toggle('active', button.dataset.materialVisionFilter === materialAnalysisState.visionFilter);
    });
    renderMaterialAnalysisVisionWall();
}

function renderMaterialAnalysisTop100(top100 = [], summary = {}) {
    materialAnalysisState.top100 = Array.isArray(top100) ? top100 : [];
    const tbody = document.getElementById('materialAnalysisTopBody');
    const meta = document.getElementById('materialAnalysisTopMeta');
    if (meta) {
        meta.textContent = summary.runId
            ? `${summary.projectName || '--'} / ${summary.weekId || '--'}，按花费排序前 ${materialAnalysisState.top100.length} 条`
            : '尚未选择导入记录。';
    }
    if (!tbody) return;

    tbody.textContent = '';
    if (materialAnalysisState.top100.length === 0) {
        const row = document.createElement('tr');
        const cell = materialAnalysisMakeEl('td', '', '导入数据后显示 Top100。');
        cell.colSpan = 13;
        row.appendChild(cell);
        tbody.appendChild(row);
        return;
    }

    materialAnalysisState.top100.forEach(item => {
        const row = document.createElement('tr');
        const direction = [
            item.parsedName && item.parsedName.primary,
            item.parsedName && item.parsedName.secondary,
            item.parsedName && item.parsedName.idea
        ].filter(Boolean).join(' / ') || '--';
        const cells = [
            item.topRank || '',
            item.materialName || '',
            materialAnalysisFormatNumber(item.spend),
            materialAnalysisFormatNumber(item.installs),
            materialAnalysisFormatMetric(item.ctr, 'percent'),
            materialAnalysisFormatMetric(item.cvr, 'percent'),
            materialAnalysisFormatNumber(item.cpi),
            materialAnalysisFormatNumber(item.ipm),
            materialAnalysisFormatMetric(item.d0IapRoi, 'percent'),
            item.health && item.health.tag,
            direction,
            (item.parsedName && item.parsedName.size) || '--',
            item.health && item.health.action
        ];

        cells.forEach((value, index) => {
            const className = index === 1
                ? 'material-analysis-name-cell'
                : (index === 10 ? 'material-analysis-direction-cell' : '');
            const cell = materialAnalysisMakeEl('td', className, '');
            if (index === 9) {
                cell.appendChild(materialAnalysisPill(value, '观察'));
            } else if (index === 12) {
                const actionWrap = materialAnalysisMakeEl('div', 'material-analysis-row-action');
                actionWrap.appendChild(materialAnalysisMakeEl('span', '', value || '--'));
                const briefBtn = materialAnalysisMakeEl('button', 'creative-mini-btn', '加入创意拓展');
                briefBtn.type = 'button';
                briefBtn.addEventListener('click', () => generateMaterialAnalysisMaterialCreativeBrief(item.materialId));
                const decision = materialAnalysisCollectDecisionForMaterial(item);
                const collectBtn = materialAnalysisMakeEl('button', 'creative-mini-btn', materialAnalysisCollectButtonText(decision));
                collectBtn.type = 'button';
                collectBtn.addEventListener('click', () => collectMaterialAnalysisMaterialKnowledge(item.materialId, decision));
                const draftBtn = materialAnalysisMakeEl('button', 'creative-mini-btn', materialAnalysisDraftButtonText());
                draftBtn.type = 'button';
                draftBtn.addEventListener('click', () => createMaterialAnalysisMaterialDirectionDraft(item.materialId));
                actionWrap.appendChild(briefBtn);
                actionWrap.appendChild(collectBtn);
                if (decision !== 'negative') {
                    actionWrap.appendChild(draftBtn);
                }
                cell.appendChild(actionWrap);
            } else {
                cell.textContent = value || '--';
            }
            row.appendChild(cell);
        });
        tbody.appendChild(row);
    });
}

function resetMaterialAnalysisCurrentImport(message = '已清空当前素材分析记录。') {
    materialAnalysisState.currentRunId = '';
    materialAnalysisState.top100 = [];
    materialAnalysisState.overview = null;
    materialAnalysisState.directions = [];
    materialAnalysisState.visionStatus = null;
    materialAnalysisState.visionResults = [];
    materialAnalysisState.selectedVisionMaterialId = '';
    materialAnalysisState.selectedVisionMaterialIds.clear();
    if (materialAnalysisState.visionPollTimer) {
        clearTimeout(materialAnalysisState.visionPollTimer);
        materialAnalysisState.visionPollTimer = null;
    }

    renderMaterialAnalysisSummary({});
    renderMaterialAnalysisOverview(null);
    renderMaterialAnalysisDirections([], {});
    renderMaterialAnalysisTop100([], {});
    renderMaterialAnalysisVisionStatus(null);
    renderMaterialAnalysisReports(null);
    renderMaterialAnalysisCreativePayload(null);
    resetMaterialAnalysisCreativeExpansion();
    renderMaterialAnalysisVisionWall();
    materialAnalysisSetInfo('', message);
}

function renderMaterialAnalysisImports(imports = []) {
    materialAnalysisState.imports = Array.isArray(imports) ? imports : [];
    const list = document.getElementById('materialAnalysisImportList');
    if (!list) return;
    list.textContent = '';

    if (materialAnalysisState.imports.length === 0) {
        list.textContent = '暂无导入记录。';
        return;
    }

    materialAnalysisState.imports.slice(0, 12).forEach(item => {
        const row = materialAnalysisMakeEl('div', 'material-analysis-import-item');
        row.classList.toggle('is-current', item.runId === materialAnalysisState.currentRunId);
        const copy = materialAnalysisMakeEl('div');
        copy.appendChild(materialAnalysisMakeEl('div', 'material-analysis-import-title', `${item.projectName || '--'} / ${item.weekId || '--'}`));
        copy.appendChild(materialAnalysisMakeEl(
            'div',
            'material-analysis-import-meta',
            `${item.sourceFileName || '--'} · ${materialAnalysisShortDate(item.importedAt)} · 明细 ${materialAnalysisFormatNumber(item.materialRows)} · Top100 ${materialAnalysisFormatNumber(item.top100Count)}`
        ));
        const button = materialAnalysisMakeEl('button', 'btn btn-secondary', '查看 Top100');
        button.type = 'button';
        button.addEventListener('click', () => loadMaterialAnalysisTop100(item.runId));
        const deleteButton = materialAnalysisMakeEl('button', 'btn btn-danger material-analysis-import-delete', '删除');
        deleteButton.type = 'button';
        deleteButton.title = '删除这条历史导入';
        deleteButton.addEventListener('click', () => deleteMaterialAnalysisImport(item.runId));
        row.appendChild(copy);
        row.appendChild(button);
        row.appendChild(deleteButton);
        list.appendChild(row);
    });
}

async function deleteMaterialAnalysisImport(runId) {
    if (!runId) return;
    const item = materialAnalysisState.imports.find(entry => entry.runId === runId) || {};
    const title = `${item.projectName || '--'} / ${item.weekId || '--'}`;
    const confirmed = window.confirm(`确定删除这条历史导入吗？\n\n${title}\n${item.sourceFileName || runId}\n\n删除后，这条记录的 Top100 表格和明细将从历史导入中移除。`);
    if (!confirmed) return;

    const wasCurrent = materialAnalysisState.currentRunId === runId;
    document.querySelectorAll('.material-analysis-import-delete').forEach(button => {
        button.disabled = true;
    });

    try {
        const response = await fetch(`/api/material-analysis/imports/${encodeURIComponent(runId)}`, {
            method: 'DELETE'
        });
        const data = await materialAnalysisReadResponse(response, '删除素材分析导入记录失败');
        const nextImports = Array.isArray(data.imports)
            ? data.imports
            : materialAnalysisState.imports.filter(entry => entry.runId !== runId);
        renderMaterialAnalysisImports(nextImports);

        if (wasCurrent) {
            if (nextImports[0] && nextImports[0].runId) {
                await loadMaterialAnalysisTop100(nextImports[0].runId, { silent: true });
            } else {
                resetMaterialAnalysisCurrentImport('历史导入已清空，可以重新导入素材数据表。');
            }
        }

        showToast(data.message || '素材分析导入记录已删除');
    } catch (error) {
        showToast(error.message || '删除素材分析导入记录失败', 'error');
        renderMaterialAnalysisImports(materialAnalysisState.imports);
    }
}

async function loadMaterialAnalysisImports(options = {}) {
    const list = document.getElementById('materialAnalysisImportList');
    if (list && !options.silent) list.textContent = '正在读取历史导入...';

    try {
        const response = await fetch('/api/material-analysis/imports');
        const data = await materialAnalysisReadResponse(response, '读取素材分析导入记录失败');
        renderMaterialAnalysisImports(data.imports || []);
        if (!options.keepCurrent && !materialAnalysisState.currentRunId && !materialAnalysisState.importing && data.imports && data.imports[0]) {
            await loadMaterialAnalysisTop100(data.imports[0].runId, { silent: true });
        }
    } catch (error) {
        if (list) list.textContent = error.message || '读取素材分析导入记录失败';
    }
}

async function loadMaterialAnalysisTop100(runId, options = {}) {
    if (!runId) return;
    const isNewRun = materialAnalysisState.currentRunId !== runId;
    materialAnalysisState.currentRunId = runId;
    if (isNewRun) {
        materialAnalysisState.selectedVisionMaterialIds.clear();
        materialAnalysisState.selectedVisionMaterialId = '';
        renderMaterialAnalysisCreativePayload(null);
        resetMaterialAnalysisCreativeExpansion();
    }

    try {
        const response = await fetch(`/api/material-analysis/imports/${encodeURIComponent(runId)}/top100`);
        const data = await materialAnalysisReadResponse(response, '读取素材分析 Top100 失败');
        renderMaterialAnalysisSummary(data.summary || {});
        renderMaterialAnalysisOverview(data.overview || null);
        renderMaterialAnalysisTop100(data.top100 || [], data.summary || {});
        await loadMaterialAnalysisDirections(runId, { silent: true });
        await loadMaterialAnalysisVision(runId, { silent: true });
        await loadMaterialAnalysisReports(runId, { silent: true });
        if (!options.silent) showToast('已加载素材分析 Top100');
    } catch (error) {
        materialAnalysisSetInfo('error', error.message || '读取素材分析 Top100 失败');
    }
}

async function loadMaterialAnalysisDirections(runId, options = {}) {
    if (!runId) return;
    try {
        const response = await fetch(`/api/material-analysis/imports/${encodeURIComponent(runId)}/directions`);
        const data = await materialAnalysisReadResponse(response, '读取素材分析方向表现失败');
        renderMaterialAnalysisDirections(data.directions || [], data.summary || {});
    } catch (error) {
        if (!options.silent) {
            materialAnalysisSetInfo('error', error.message || '读取素材分析方向表现失败');
        }
    }
}

async function loadMaterialAnalysisVision(runId, options = {}) {
    if (!runId) return;
    try {
        const [statusResponse, resultsResponse] = await Promise.all([
            fetch(`/api/material-analysis/imports/${encodeURIComponent(runId)}/vision/status`),
            fetch(`/api/material-analysis/imports/${encodeURIComponent(runId)}/vision/results`)
        ]);
        const statusData = await materialAnalysisReadResponse(statusResponse, '读取视觉识别进度失败');
        const resultsData = await materialAnalysisReadResponse(resultsResponse, '读取视觉识别结果失败');
        materialAnalysisState.visionResults = Array.isArray(resultsData.results) ? resultsData.results : [];
        renderMaterialAnalysisVisionStatus(resultsData.status || statusData.status || null);
        renderMaterialAnalysisVisionWall();
        if ((resultsData.status && resultsData.status.running) || (statusData.status && statusData.status.running)) {
            materialAnalysisScheduleVisionPoll(runId);
        }
    } catch (error) {
        if (!options.silent) {
            materialAnalysisSetInfo('error', error.message || '读取视觉识别失败');
        }
    }
}

function materialAnalysisScheduleVisionPoll(runId) {
    if (materialAnalysisState.visionPollTimer) {
        clearTimeout(materialAnalysisState.visionPollTimer);
    }
    materialAnalysisState.visionPollTimer = setTimeout(async () => {
        await loadMaterialAnalysisVision(runId, { silent: true });
        const status = materialAnalysisState.visionStatus;
        if (status && status.running) {
            materialAnalysisScheduleVisionPoll(runId);
        }
    }, 3000);
}

async function startMaterialAnalysisVision(options = {}) {
    const runId = materialAnalysisState.currentRunId;
    if (!runId) {
        showToast('请先导入或选择一条素材分析记录', 'error');
        return;
    }
    const selectedIds = options.all === true ? [] : materialAnalysisSelectedVisionIds();
    const button = document.getElementById('materialAnalysisVisionStartBtn');
    if (button) button.disabled = true;
    try {
        const response = await fetch(`/api/material-analysis/imports/${encodeURIComponent(runId)}/vision/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                concurrency: 3,
                retries: 1,
                materialIds: selectedIds
            })
        });
        const data = await response.json().catch(() => ({
            message: `启动视觉识别失败（HTTP ${response.status}）`
        }));
        if (!response.ok) {
            if (data.status) {
                renderMaterialAnalysisVisionStatus(data.status);
                await loadMaterialAnalysisVision(runId, { silent: true });
            }
            throw new Error(data.message || '启动视觉识别失败');
        }
        renderMaterialAnalysisVisionStatus(data.status || null);
        materialAnalysisScheduleVisionPoll(runId);
        showToast(data.message || '视觉识别已启动');
    } catch (error) {
        showToast(error.message || '启动视觉识别失败', 'error');
        if (button) button.disabled = false;
    }
}

async function clearMaterialAnalysisVisionTask() {
    const runId = materialAnalysisState.currentRunId;
    if (!runId) {
        showToast('请先导入或选择一条素材分析记录', 'error');
        return;
    }

    const confirmed = window.confirm('确定清除当前视觉识别任务状态？已识别结果会保留，未完成素材可重新识别。');
    if (!confirmed) return;

    const button = document.getElementById('materialAnalysisVisionClearBtn');
    if (button) button.disabled = true;
    if (materialAnalysisState.visionPollTimer) {
        clearTimeout(materialAnalysisState.visionPollTimer);
        materialAnalysisState.visionPollTimer = null;
    }

    try {
        const response = await fetch(`/api/material-analysis/imports/${encodeURIComponent(runId)}/vision/clear`, {
            method: 'POST'
        });
        const data = await materialAnalysisReadResponse(response, '清除视觉识别任务失败');
        materialAnalysisState.visionResults = Array.isArray(data.results) ? data.results : materialAnalysisState.visionResults;
        renderMaterialAnalysisVisionStatus(data.status || null);
        renderMaterialAnalysisVisionWall();
        showToast(data.message || '已清除视觉识别任务状态');
    } catch (error) {
        showToast(error.message || '清除视觉识别任务失败', 'error');
    } finally {
        updateMaterialAnalysisVisionSelectionUi();
    }
}

async function retryMaterialAnalysisVision(materialId) {
    if (!materialId) return;
    try {
        const response = await fetch(`/api/material-analysis/materials/${encodeURIComponent(materialId)}/vision/retry`, {
            method: 'POST'
        });
        const data = await materialAnalysisReadResponse(response, '重跑视觉识别失败');
        if (data.result) {
            const index = materialAnalysisState.visionResults.findIndex(item => item.materialId === data.result.materialId);
            if (index >= 0) {
                materialAnalysisState.visionResults[index] = data.result;
            } else {
                materialAnalysisState.visionResults.push(data.result);
            }
        }
        renderMaterialAnalysisVisionStatus(data.status || materialAnalysisState.visionStatus);
        renderMaterialAnalysisVisionWall();
        showToast(data.message || '单素材视觉识别完成');
    } catch (error) {
        showToast(error.message || '重跑视觉识别失败', 'error');
    }
}

async function importMaterialAnalysisFile() {
    const fileInput = document.getElementById('materialAnalysisFileInput');
    const projectName = materialAnalysisText(document.getElementById('materialAnalysisProjectName')?.value, '无尽冬日');
    const weekId = materialAnalysisText(document.getElementById('materialAnalysisWeekId')?.value, '未填写周次');
    const file = fileInput && fileInput.files && fileInput.files[0];

    if (!file) {
        materialAnalysisSetInfo('error', '请先选择素材数据表。');
        showToast('请先选择素材数据表', 'error');
        return;
    }

    const importButton = document.getElementById('materialAnalysisImportBtn');
    if (importButton) importButton.disabled = true;
    materialAnalysisState.importing = true;
    materialAnalysisSetInfo('loading', '正在读取并导入素材数据...');

    try {
        const filePayload = await materialAnalysisReadFile(file);
        const response = await fetch('/api/material-analysis/import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                projectName,
                weekId,
                ...filePayload
            })
        });
        const data = await materialAnalysisReadResponse(response, '导入素材分析数据失败');
        materialAnalysisState.currentRunId = data.summary && data.summary.runId ? data.summary.runId : '';
        materialAnalysisState.selectedVisionMaterialIds.clear();
        materialAnalysisState.selectedVisionMaterialId = '';
        renderMaterialAnalysisSummary(data.summary || {});
        renderMaterialAnalysisOverview(data.overview || null);
        renderMaterialAnalysisDirections(data.directions || [], data.summary || {});
        renderMaterialAnalysisTop100(data.top100 || [], data.summary || {});
        renderMaterialAnalysisVisionStatus(null);
        materialAnalysisState.visionResults = [];
        materialAnalysisState.reports = null;
        renderMaterialAnalysisCreativePayload(null);
        resetMaterialAnalysisCreativeExpansion();
        renderMaterialAnalysisReports(null);
        renderMaterialAnalysisVisionWall();
        await loadMaterialAnalysisImports({ keepCurrent: true, silent: true });
        materialAnalysisSetInfo('success', `导入完成：明细 ${materialAnalysisFormatNumber(data.summary?.materialRows)} 条，Top100 已生成。`);
        showToast('素材分析导入完成');
    } catch (error) {
        materialAnalysisSetInfo('error', error.message || '导入素材分析数据失败');
        showToast(error.message || '导入素材分析数据失败', 'error');
    } finally {
        materialAnalysisState.importing = false;
        if (importButton) importButton.disabled = false;
    }
}

window.addEventListener('DOMContentLoaded', () => {
    renderMaterialAnalysisCreativePayload(null);
    renderMaterialAnalysisCreativeTargets([]);
    renderMaterialAnalysisCreativeExpansionPool(null);
    loadMaterialAnalysisImports({ silent: true });
});
