// 运行一次自动创意：自动选题、创意助手、提示词质检、生图平台 和资产回流状态
let creativeAutoCurrentRunId = '';
        let creativeAutoStatusInterval = null;
        let creativeAutoLastStatus = null;
        let creativeAutoLastSuggestion = null;
        let creativeAutoLastRun = null;
        let creativeAutoHistoryOffset = 0;
        const CREATIVE_AUTO_HISTORY_PAGE_SIZE = 8;
        let creativeAutoDirections = [];
        let creativeAutoSelectedTargets = [];
        let creativeAutoTargetLevel = 'all';
        let creativeAutoExternalBrief = null;
        const CREATIVE_AUTO_MATERIAL_BRIEF_KEY = 'material-analysis-creative-brief-v1';
        const CREATIVE_AUTO_ETA_STORAGE_KEY = 'creative-auto-eta-basis-v2';
        const CREATIVE_AUTO_ETA_DEFAULT_MINUTES_PER_GROUP = 5;
        const CREATIVE_AUTO_ETA_TARGET_SWITCH_BUFFER_MINUTES = 0.5;
        const CREATIVE_AUTO_ETA_MIN_SAMPLE_MINUTES = 3;
        const CREATIVE_AUTO_ETA_MAX_SAMPLE_MINUTES = 60;
        const creativeAutoEtaStateByRun = new Map();
        const CREATIVE_AUTO_TARGET_QUEUE_DEFAULTS = {
            newDirectionsPerSource: 4,
            promptGroupsPerNewDirection: 2,
            diversityMode: 'balanced',
            historyScope: 'recent30',
            candidateMultiplier: 2
        };

        const CREATIVE_AUTO_MODE_DEFAULTS = {
            agentOnly: {
                label: '只生成提示词',
                maxPrompts: 25,
                agentOnly: true,
                fullScale: false,
                unlimitedPrompts: true,
                confirmNote: '只运行创意助手和提示词质检，不调用生图平台，不生成图片；提示词质检接受多少就保留多少。'
            },
            smoke: {
                label: '小批量验证',
                maxPrompts: 1,
                agentOnly: false,
                fullScale: false,
                confirmNote: '提交 1 条通过质检的提示词，预计生成约 4 张图。'
            },
            full: {
                label: '持续生图',
                maxPrompts: 25,
                agentOnly: false,
                fullScale: true,
                unlimitedPrompts: true,
                confirmNote: '不按 25 条或每日图片额度截断，提示词质检接受多少就持续提交多少。'
            }
        };

        function creativeAutoSetText(id, text) {
            const el = document.getElementById(id);
            if (el) el.textContent = text;
        }

        function updateCreativeMiniStatus({ stage, source, progress, state } = {}) {
            creativeAutoSetText('creativeMiniStage', stage || '待启动');
            creativeAutoSetText('creativeMiniSource', source || '未导入方向');
            creativeAutoSetText('creativeMiniProgress', progress || '0 / 0');
            const status = document.getElementById('creativeMiniStatus');
            if (status && state) status.dataset.state = state;
        }

        function creativeAutoBriefData(payload = creativeAutoExternalBrief) {
            if (!payload) return null;
            return payload.brief || payload.plan || payload;
        }

        function creativeAutoBriefTitle(payload = creativeAutoExternalBrief) {
            const data = creativeAutoBriefData(payload);
            if (!data) return '上游 brief';
            const targetCount = getCreativeAutoBriefTargets(payload).length;
            if (data.packageType === 'creative-target-package' || data.target === 'source-directions') {
                return `待拓展方向包：${targetCount} 个原始方向`;
            }
            if (data.target === 'weekly-plan') return `${data.projectName || '--'} / ${data.weekId || '--'} 下周创意计划`;
            if (data.target === 'direction') return `方向 brief：${data.directionPath || data.directionKey || '--'}`;
            return `素材 brief：${data.materialName || data.materialId || '--'}`;
        }

        function creativeAutoSourceName(payload = creativeAutoExternalBrief) {
            const data = creativeAutoBriefData(payload) || {};
            const targets = getCreativeAutoBriefTargets(payload);
            const source = payload?.source || data.source || targets[0]?.source || '';
            if (source === 'task-workbook') return '方案迭代';
            if (source === 'creative-knowledge') return '方向库';
            if (source === 'material-analysis') return '素材分析';
            return source || '素材分析';
        }

        function renderCreativeAutoSourceHint(payload = creativeAutoExternalBrief) {
            const hint = document.getElementById('creativeSourceHint');
            if (!hint) return;
            const data = creativeAutoBriefData(payload);
            const targets = getCreativeAutoBriefTargets(payload);
            if (!data && !targets.length) {
                hint.textContent = '来源任务包：等待从素材分析或方案迭代送入方向。';
                return;
            }
            const count = targets.length || 1;
            hint.textContent = `来源任务包：${creativeAutoSourceName(payload)} · ${count} 个原始方向`;
        }

        function sanitizeCreativeAutoMaterialBriefPayload(payload) {
            if (!payload) return null;
            const clone = JSON.parse(JSON.stringify(payload));
            const strip = item => {
                if (!item || typeof item !== 'object') return;
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
            };
            strip(clone);
            strip(clone.brief);
            strip(clone.plan);
            return clone;
        }

        function renderCreativeAutoMaterialBrief(payload = creativeAutoExternalBrief) {
            const panel = document.getElementById('creativeAutoBriefPanel');
            const body = document.getElementById('creativeAutoBriefBody');
            if (!panel || !body) return;
            const data = creativeAutoBriefData(payload);
            if (!data) {
                panel.hidden = true;
                body.textContent = '';
                renderCreativeAutoSourceHint(null);
                return;
            }
            renderCreativeAutoSourceHint(payload);
            panel.hidden = false;
            body.textContent = '';
            const creativeTargets = getCreativeAutoBriefTargets(payload);
            [
                ['来源', creativeAutoSourceName(payload)],
                ['标题', creativeAutoBriefTitle(payload)],
                ['任务包', data.packageType ? `${data.packageType} / ${creativeTargets.length || 0} 个目标` : ''],
                ['方向', data.directionPath || data.directionKey],
                ['视觉', data.visualInsight],
                ['保留', Array.isArray(data.retainElements) ? data.retainElements.join('、') : ''],
                ['变化轴', Array.isArray(data.variationAxes) ? data.variationAxes.join('、') : ''],
                ['避坑', Array.isArray(data.avoidRules) ? data.avoidRules.join('、') : ''],
                ['请求', data.request]
            ].forEach(([label, value]) => {
                if (!value) return;
                const row = document.createElement('div');
                row.className = 'creative-brief-row';
                const key = document.createElement('span');
                key.textContent = label;
                const text = document.createElement('strong');
                text.textContent = value;
                row.appendChild(key);
                row.appendChild(text);
                body.appendChild(row);
            });
            creativeTargets.slice(0, 8).forEach((target, index) => {
                const row = document.createElement('div');
                row.className = 'creative-brief-row';
                const key = document.createElement('span');
                key.textContent = `目标${index + 1}`;
                const text = document.createElement('strong');
                text.textContent = [
                    target.sourceDirectionPath || target.sourceDirectionKey || target.materialName || '',
                    target.seedMaterialCount ? `${target.seedMaterialCount} 张素材` : (target.task || '')
                ].filter(Boolean).join(' / ');
                row.appendChild(key);
                row.appendChild(text);
                body.appendChild(row);
            });
        }

        function loadCreativeAutoMaterialBrief(payload = null) {
            let next = payload;
            if (!next) {
                const stored = sessionStorage.getItem(CREATIVE_AUTO_MATERIAL_BRIEF_KEY) ||
                    localStorage.getItem(CREATIVE_AUTO_MATERIAL_BRIEF_KEY);
                if (stored) {
                    try {
                        next = JSON.parse(stored);
                    } catch (error) {
                        next = null;
                    }
                }
            }
            creativeAutoExternalBrief = sanitizeCreativeAutoMaterialBriefPayload(next);
            if (getCreativeAutoBriefTargets(creativeAutoExternalBrief).length) {
                clearCreativeAutoManualDirectionSelection();
            }
            renderCreativeAutoMaterialBrief(creativeAutoExternalBrief);
            renderCreativeAutoTargetQueue();
            updateCreativeS3Flow(creativeAutoLastRun, creativeAutoLastStatus);
            return creativeAutoExternalBrief;
        }

        function clearCreativeAutoMaterialBrief() {
            creativeAutoExternalBrief = null;
            sessionStorage.removeItem(CREATIVE_AUTO_MATERIAL_BRIEF_KEY);
            localStorage.removeItem(CREATIVE_AUTO_MATERIAL_BRIEF_KEY);
            renderCreativeAutoMaterialBrief(null);
            renderCreativeAutoTargetQueue();
            updateCreativeS3Flow(creativeAutoLastRun, creativeAutoLastStatus);
            showToast('已清空上游 brief');
        }

        function clearCreativeAutoManualDirectionSelection() {
            creativeAutoSelectedTargets = [];
            const manualToggle = document.getElementById('creativeAutoManualDirection');
            const input = document.getElementById('creativeAutoDirectionId');
            if (manualToggle) manualToggle.checked = false;
            if (input) input.value = '';
            renderCreativeAutoSelectedTargets();
            renderCreativeAutoDirectionTree();
        }

        function getCreativeAutoPromptMode() {
            const checked = document.querySelector('input[name="creativeAutoPromptMode"]:checked');
            if (checked && CREATIVE_AUTO_MODE_DEFAULTS[checked.value]) return checked.value;
            if (document.getElementById('creativeAutoFullScale')?.checked === true) return 'full';
            return 'full';
        }

        function getCreativeAutoModeConfig(mode = getCreativeAutoPromptMode()) {
            return CREATIVE_AUTO_MODE_DEFAULTS[mode] || CREATIVE_AUTO_MODE_DEFAULTS.full;
        }

        function setCreativeAutoInfo(className, text) {
            const infoBox = document.getElementById('creativeAutoInfo');
            if (!infoBox) return;
            infoBox.className = className;
            infoBox.textContent = text;
        }

        function clampCreativeAutoSmallCount(value, fallback = 1) {
            const numberValue = Number(value);
            if (!Number.isFinite(numberValue)) return fallback;
            return Math.max(1, Math.min(10, Math.floor(numberValue)));
        }

        function getCreativeAutoTargetQueueDefaults() {
            const diversityMode = document.getElementById('creativeAutoDiversityMode')?.value || CREATIVE_AUTO_TARGET_QUEUE_DEFAULTS.diversityMode;
            const historyScope = document.getElementById('creativeAutoHistoryScope')?.value || CREATIVE_AUTO_TARGET_QUEUE_DEFAULTS.historyScope;
            const candidateMultiplier = clampCreativeAutoSmallCount(
                document.getElementById('creativeAutoCandidateMultiplier')?.value,
                CREATIVE_AUTO_TARGET_QUEUE_DEFAULTS.candidateMultiplier
            );
            return {
                newDirectionsPerSource: clampCreativeAutoSmallCount(
                    document.getElementById('creativeAutoNewDirectionsPerSource')?.value,
                    CREATIVE_AUTO_TARGET_QUEUE_DEFAULTS.newDirectionsPerSource
                ),
                promptGroupsPerNewDirection: clampCreativeAutoSmallCount(
                    document.getElementById('creativeAutoPromptsPerNewDirection')?.value,
                    CREATIVE_AUTO_TARGET_QUEUE_DEFAULTS.promptGroupsPerNewDirection
                ),
                diversityMode: ['stable', 'balanced', 'explore'].includes(diversityMode) ? diversityMode : CREATIVE_AUTO_TARGET_QUEUE_DEFAULTS.diversityMode,
                historyScope: ['recent10', 'recent30', 'all'].includes(historyScope) ? historyScope : CREATIVE_AUTO_TARGET_QUEUE_DEFAULTS.historyScope,
                candidateMultiplier: Math.max(1, Math.min(5, candidateMultiplier))
            };
        }

        function getCreativeAutoBriefTargets(payload = creativeAutoExternalBrief) {
            const data = creativeAutoBriefData(payload);
            if (!data) return [];
            return Array.isArray(data.creativeTargets)
                ? data.creativeTargets
                : (Array.isArray(data.targets) ? data.targets : []);
        }

        function creativeAutoQueueTargetId(target = {}, index = 0) {
            return String(
                target.targetId ||
                target.id ||
                target.sourceDirectionId ||
                target.sourceDirectionPath ||
                target.sourceDirectionKey ||
                target.path ||
                target.label ||
                `target-${index + 1}`
            );
        }

        function normalizeCreativeAutoQueueTarget(target = {}, index = 0, source = 'material-analysis') {
            const path = target.sourceDirectionPath || target.sourceDirectionKey || target.path || target.label || target.materialName || target.sourceDirectionName || '';
            const parts = String(path).split('/').map(part => part.trim()).filter(Boolean);
            const targetId = creativeAutoQueueTargetId(target, index);
            return {
                ...target,
                targetId,
                targetType: target.targetType || 'source-direction',
                source: target.source || source,
                sourceDirectionPath: path,
                sourceDirectionKey: target.sourceDirectionKey || path,
                sourceDirectionName: target.sourceDirectionName || target.name || parts[parts.length - 1] || path || `方向 ${index + 1}`,
                seedMaterialCount: Number(target.seedMaterialCount) || (Array.isArray(target.seedMaterials) ? target.seedMaterials.length : 0),
                selected: target.selected !== false
            };
        }

        function getCreativeAutoManualQueueTargets() {
            const selection = getCreativeAutoManualDirectionSelection();
            return selection.targets.map((target, index) => normalizeCreativeAutoQueueTarget({
                ...target,
                targetId: target.id,
                source: 'creative-knowledge',
                sourceDirectionPath: target.path || target.label || target.id,
                sourceDirectionKey: target.path || target.label || target.id,
                sourceDirectionName: target.label || target.path || target.id,
                visualInsight: target.descriptions && target.descriptions[0] ? target.descriptions[0] : '',
                retainElements: [],
                variationAxes: [],
                avoidRules: []
            }, index, 'creative-knowledge'));
        }

        function getCreativeAutoTargetQueueTargets() {
            const manualTargets = getCreativeAutoManualQueueTargets();
            if (manualTargets.length) {
                return manualTargets;
            }
            const briefTargets = getCreativeAutoBriefTargets();
            if (briefTargets.length) {
                return briefTargets.map((target, index) => normalizeCreativeAutoQueueTarget(target, index, target.source || 'material-analysis'));
            }
            return [];
        }

        function creativeAutoTargetPromptCount(target = {}) {
            const settings = getCreativeAutoTargetQueueDefaults();
            return settings.newDirectionsPerSource * settings.promptGroupsPerNewDirection;
        }

        function getCreativeAutoTargetQueueExpectedPromptCount() {
            return getCreativeAutoTargetQueueTargets()
                .filter(target => target.selected !== false)
                .reduce((sum, target) => sum + creativeAutoTargetPromptCount(target), 0);
        }

        function validateCreativeAutoTargetQueueForRun() {
            const briefTargets = getCreativeAutoBriefTargets().filter(target => target && target.selected !== false);
            const queueTargets = getCreativeAutoTargetQueueTargets().filter(target => target && target.selected !== false);
            const manualDirection = getCreativeAutoManualDirectionSelection();

            if (briefTargets.length > 1 && manualDirection.ids.length) {
                return `上游已带入 ${briefTargets.length} 个目标，但当前仍有手动方向选择。请先清空方向库选择，避免只跑 1 个方向。`;
            }
            if (briefTargets.length > 1 && queueTargets.length !== briefTargets.length) {
                return `上游目标数是 ${briefTargets.length}，当前待拓展队列只有 ${queueTargets.length}。请重新从素材分析或方案迭代页送入目标包后再启动。`;
            }
            return '';
        }

        function getCreativeAutoPromptCount() {
            return getCreativeAutoRunSettings().maxPrompts;
        }

        function getCreativeAutoLegilOutputQuantity() {
            const generationSettings = (typeof config !== 'undefined' && config && config.creativeLegilGeneration)
                ? config.creativeLegilGeneration
                : {};
            const outputQuantity = Number(generationSettings.outputQuantity);
            return Number.isFinite(outputQuantity) && outputQuantity > 0 ? outputQuantity : 1;
        }

        function getCreativeAutoRunSettings() {
            const mode = getCreativeAutoPromptMode();
            const modeConfig = getCreativeAutoModeConfig(mode);
            const queuePromptCount = getCreativeAutoTargetQueueExpectedPromptCount();
            const unlimitedPrompts = modeConfig.unlimitedPrompts === true;
            const maxPrompts = modeConfig.fullScale
                ? Math.max(25, queuePromptCount || 25)
                : (queuePromptCount && modeConfig.agentOnly ? queuePromptCount : modeConfig.maxPrompts);
            const outputQuantity = getCreativeAutoLegilOutputQuantity();
            return {
                mode,
                label: modeConfig.label,
                maxPrompts,
                unlimitedPrompts,
                fullScale: modeConfig.fullScale,
                agentOnly: modeConfig.agentOnly,
                outputQuantity,
                expectedImages: modeConfig.agentOnly ? 0 : (unlimitedPrompts ? null : maxPrompts * outputQuantity),
                confirmNote: modeConfig.confirmNote
            };
        }

        function creativeAutoUnique(values = []) {
            return Array.from(new Set(values.map(value => String(value || '').trim()).filter(Boolean)));
        }

        function getCreativeAutoDirectionById(directionId) {
            return creativeAutoDirections.find(direction => direction.id === directionId) || null;
        }

        function getCreativeAutoDirectionLabel(direction = null, fallbackId = '') {
            if (!direction) return formatCreativeAutoFallbackDirectionLabel(fallbackId);
            return direction.path || direction.name || direction.id || fallbackId || '';
        }

        function formatCreativeAutoFallbackDirectionLabel(directionId = '') {
            const id = String(directionId || '').trim();
            if (!id) return '';
            if (/^direction_[a-z0-9]+$/i.test(id)) return `方向 ${id.slice(-6).toUpperCase()}`;
            return id;
        }

        function getCreativeAutoDirectionOrder(direction = {}, fallback = 999999) {
            const value = Number(direction.rowNumber ?? direction.sourceSheetRow ?? direction.orderIndex);
            return Number.isFinite(value) && value > 0 ? value : fallback;
        }

        function getCreativeAutoManualInputDirectionIds() {
            const enabled = document.getElementById('creativeAutoManualDirection')?.checked === true;
            if (!enabled || creativeAutoSelectedTargets.length) return [];
            return creativeAutoUnique(String(document.getElementById('creativeAutoDirectionId')?.dataset.directionIds || '').split(/[,，\s]+/));
        }

        function getCreativeAutoSelectedDirectionIds() {
            const selectedIds = creativeAutoSelectedTargets.flatMap(target => target.directionIds || []);
            return creativeAutoUnique(selectedIds.concat(getCreativeAutoManualInputDirectionIds()));
        }

        function getCreativeAutoManualDirectionId() {
            return getCreativeAutoSelectedDirectionIds()[0] || '';
        }

        function getCreativeAutoManualDirectionSelection() {
            const ids = getCreativeAutoSelectedDirectionIds();
            const manualIds = getCreativeAutoManualInputDirectionIds();
            const targets = creativeAutoSelectedTargets.length
                ? creativeAutoSelectedTargets
                : manualIds.map(id => {
                    const direction = getCreativeAutoDirectionById(id);
                    return {
                        type: 'direction',
                        id: `direction:${id}`,
                        label: getCreativeAutoDirectionLabel(direction, id),
                        path: getCreativeAutoDirectionLabel(direction, id),
                        directionIds: [id]
                    };
                });
            const label = targets.length
                ? (targets.length === 1 ? targets[0].label : `${targets.length} 个目标 / ${ids.length} 个方向`)
                : '';
            return { id: ids[0] || '', ids, targets, label };
        }

        function getCreativeAutoSuggestionLabel(next = creativeAutoLastSuggestion) {
            const direction = next && next.direction ? next.direction : null;
            return direction ? (direction.path || direction.name || direction.id || '未命名方向') : '暂无推荐方向';
        }

        function getCreativeAutoBriefTargetLabel(payload = creativeAutoExternalBrief) {
            const data = creativeAutoBriefData(payload);
            if (!data) return '';
            if (data.directionPath || data.directionKey) {
                return data.directionPath || data.directionKey;
            }
            if (Array.isArray(data.creativeTargets) && data.creativeTargets.length) {
                const first = data.creativeTargets[0];
                const firstPath = first.sourceDirectionPath || first.sourceDirectionKey || first.materialName || '';
                return data.creativeTargets.length > 1
                    ? `${firstPath} 等 ${data.creativeTargets.length} 个目标`
                    : firstPath;
            }
            return data.materialName || '';
        }

        function getCreativeAutoEffectiveTargetLabel() {
            const manualDirection = getCreativeAutoManualDirectionSelection();
            if (manualDirection.ids.length) return `手动 ${manualDirection.label}`;
            const briefLabel = getCreativeAutoBriefTargetLabel();
            if (briefLabel) return `${creativeAutoSourceName()} ${briefLabel}`;
            return getCreativeAutoSuggestionLabel();
        }

        function updateCreativeS3StepState(activeIndex = 0, hasError = false) {
            document.querySelectorAll('.creative-s3-step').forEach((step, index) => {
                step.classList.toggle('is-active', index === activeIndex);
                step.classList.toggle('is-done', index < activeIndex && !hasError);
                step.classList.toggle('is-error', hasError && index === activeIndex);
            });
        }

        function renderCreativeS3Reasons(next = creativeAutoLastSuggestion) {
            const container = document.getElementById('creativeS3DirectionReasons');
            if (!container) return;
            container.textContent = '';
            const reasons = next && Array.isArray(next.reasons) ? next.reasons.filter(Boolean) : [];
            if (!reasons.length) {
                const empty = document.createElement('span');
                empty.className = 'creative-s3-reason';
                empty.textContent = '等待推荐理由';
                container.appendChild(empty);
                return;
            }
            reasons.forEach(reason => {
                const item = document.createElement('span');
                item.className = 'creative-s3-reason';
                item.textContent = reason;
                container.appendChild(item);
            });
        }

        function updateCreativeS3Flow(run = null, status = creativeAutoLastStatus) {
            const knowledge = status && status.knowledge ? status.knowledge : {};
            const quota = status && status.quota ? status.quota : {};
            const preflight = status && status.preflight ? status.preflight : {};
            const manualDirection = getCreativeAutoManualDirectionSelection();
            const settings = getCreativeAutoRunSettings();

            const directionCount = knowledge.counts && knowledge.counts.directions ? knowledge.counts.directions : 0;
            creativeAutoSetText(
                'creativeS3DataSourceText',
                knowledge.imported
                    ? `已导入 ${directionCount} 个方向，图片额度不限`
                    : '知识库未导入'
            );
            creativeAutoSetText(
                'creativeS3TargetText',
                getCreativeAutoEffectiveTargetLabel()
            );
            creativeAutoSetText(
                'creativeS3ModeText',
                settings.agentOnly
                    ? `${settings.label}，不限额`
                    : (settings.unlimitedPrompts ? `${settings.label}，不限额` : `${settings.label}，预计 ${settings.expectedImages} 张`)
            );

            let activeIndex = preflight.ok === false ? 0 : 1;
            let hasError = false;
            const overallComplete = isCreativeAutoOverallComplete(run || {});
            if (run) {
                if (run.status === 'failed') {
                    activeIndex = 2;
                    hasError = true;
                } else if (overallComplete) {
                    activeIndex = 3;
                } else if (run.status === 'paused') {
                    activeIndex = 2;
                } else if (String(run.phase || '').startsWith('agent_')) {
                    activeIndex = 1;
                } else if (String(run.phase || '').startsWith('legil_')) {
                    activeIndex = 2;
                }
            }
            updateCreativeS3StepState(activeIndex, hasError);

            if (!run) {
                creativeAutoSetText('creativeS3ProgressText', preflight.ok === false ? '先处理检查项' : '等待启动');
                creativeAutoSetText('creativeS3ReviewText', '完成后进入资产审核');
                updateCreativeS3ReviewPanel(null);
                return;
            }

            const report = run.promptQualityReport || {};
            const legil = run.legilProgress || {};
            const result = run.legilResult || {};
            const accepted = Number(report.acceptedPromptCount) || Number(run.promptTotal) || 0;
            const rejected = Number(report.rejectedPromptCount) || Number(run.promptTotalRejected) || 0;
            const saved = Number(legil.saved) || Number(result.savedCount) || Number(run.assets?.newAssetCount) || 0;
            const failed = Number(legil.failed) || Number(result.failedCount) || 0;
            const queueLabel = getCreativeAutoRunQueueLabel(run);
            creativeAutoSetText(
                'creativeS3ProgressText',
                (overallComplete
                    ? `完成：通过 ${accepted}，丢弃 ${rejected}，保存 ${saved}`
                    : `${run.phase || run.status || '运行中'}：通过 ${accepted}，丢弃 ${rejected}，失败 ${failed}`) +
                    (queueLabel ? `；${queueLabel}` : '')
            );
            creativeAutoSetText(
                'creativeS3ReviewText',
                overallComplete
                    ? (run.agentOnly ? '仅提示词，无图片审核' : `可审核 ${saved || Number(run.assets?.newAssetCount) || 0} 张`)
                    : '等待运行完成'
            );
            updateCreativeS3ReviewPanel(run);
        }

        function syncCreativeAutoPromptMode(options = {}) {
            const mode = getCreativeAutoPromptMode();
            const config = getCreativeAutoModeConfig(mode);
            const fullScale = document.getElementById('creativeAutoFullScale');

            document.querySelectorAll('.creative-prompt-mode').forEach(label => {
                const input = label.querySelector('input[name="creativeAutoPromptMode"]');
                label.classList.toggle('active', Boolean(input && input.checked));
            });

            if (fullScale) fullScale.checked = config.fullScale;
            updateCreativeS3Flow(creativeAutoLastRun, creativeAutoLastStatus);
        }

        function normalizeCreativeAutoDirectionText(value) {
            return String(value || '').trim().toLowerCase();
        }

        function directionMatchesCreativeAutoSearch(direction = {}, keyword = '') {
            if (!keyword) return true;
            return [
                direction.id,
                direction.path,
                direction.name,
                direction.description,
                direction.primaryTag,
                direction.secondaryTag,
                direction.tertiaryTag,
                direction.subTag
            ].some(value => normalizeCreativeAutoDirectionText(value).includes(keyword));
        }

        function appendCreativeAutoDirectionMeta(container, label, value) {
            const numberValue = Number(value) || 0;
            if (!numberValue) return;
            const chip = document.createElement('span');
            chip.textContent = `${label} ${numberValue}`;
            container.appendChild(chip);
        }

        function getCreativeAutoReferenceImages(direction = {}) {
            return Array.isArray(direction.referenceImages) ? direction.referenceImages.filter(image => image && image.imageUrl) : [];
        }

        function getCreativeAutoDirectionStats(direction = {}) {
            const stats = direction.knowledgeStats || {};
            return {
                referenceCount: Number(stats.matchedReferenceCount) || 0,
                runCount: Number(stats.runCount) || 0,
                assetCount: Number(stats.assetCount) || 0,
                promptCount: Number(direction.stats && direction.stats.promptCount) || 0
            };
        }

        function buildCreativeAutoTargetCards(directions = []) {
            const aggregateMap = new Map();
            directions.forEach((direction, index) => {
                const parts = String(direction.path || direction.name || direction.id || '未分类')
                    .split('/')
                    .map(part => part.trim())
                    .filter(Boolean);
                const directionOrder = getCreativeAutoDirectionOrder(direction, index + 1);
                for (let level = 1; level <= Math.min(3, parts.length); level += 1) {
                    const path = parts.slice(0, level).join('/');
                    const key = `tag:${level}:${path}`;
                    if (!aggregateMap.has(key)) {
                        aggregateMap.set(key, {
                            type: 'tag',
                            id: key,
                            level,
                            label: path,
                            path,
                            order: directionOrder,
                            directionIds: [],
                            descriptions: [],
                            referenceImages: [],
                            stats: { referenceCount: 0, runCount: 0, assetCount: 0, promptCount: 0 }
                        });
                    }
                    const target = aggregateMap.get(key);
                    target.order = Math.min(Number(target.order) || directionOrder, directionOrder);
                    const stats = getCreativeAutoDirectionStats(direction);
                    target.directionIds.push(direction.id);
                    if (direction.description && target.descriptions.length < 4) target.descriptions.push(direction.description);
                    target.referenceImages.push(...getCreativeAutoReferenceImages(direction));
                    target.stats.referenceCount += stats.referenceCount;
                    target.stats.runCount += stats.runCount;
                    target.stats.assetCount += stats.assetCount;
                    target.stats.promptCount += stats.promptCount;
                }
            });

            const aggregateTargets = Array.from(aggregateMap.values()).map(target => ({
                ...target,
                directionIds: creativeAutoUnique(target.directionIds),
                referenceImages: target.referenceImages.slice(0, 4)
            }));
            const directionTargets = directions.map(direction => ({
                type: 'direction',
                id: `direction:${direction.id}`,
                level: '细分方向',
                label: getCreativeAutoDirectionLabel(direction, direction.id),
                path: getCreativeAutoDirectionLabel(direction, direction.id),
                order: getCreativeAutoDirectionOrder(direction),
                directionIds: [direction.id],
                descriptions: [direction.description || ''],
                referenceImages: getCreativeAutoReferenceImages(direction),
                stats: getCreativeAutoDirectionStats(direction)
            }));
            return aggregateTargets.concat(directionTargets);
        }

        function creativeAutoTargetMatchesLevel(target = {}) {
            if (creativeAutoTargetLevel === 'all') return true;
            if (creativeAutoTargetLevel === 'direction') return target.type === 'direction';
            return target.type === 'tag' && String(target.level) === String(creativeAutoTargetLevel);
        }

        function creativeAutoTargetMatchesSearch(target = {}, keyword = '') {
            if (!keyword) return true;
            return [
                target.label,
                target.path,
                target.level,
                ...(target.descriptions || [])
            ].some(value => normalizeCreativeAutoDirectionText(value).includes(keyword));
        }

        function isCreativeAutoTargetSelected(target = {}) {
            return creativeAutoSelectedTargets.some(item => item.id === target.id);
        }

        function syncCreativeAutoSelectedInput() {
            const selection = getCreativeAutoManualDirectionSelection();
            const manualToggle = document.getElementById('creativeAutoManualDirection');
            const input = document.getElementById('creativeAutoDirectionId');
            if (manualToggle) manualToggle.checked = selection.ids.length > 0;
            if (input) {
                input.value = selection.label || '';
                input.dataset.directionIds = selection.ids.join(',');
            }
        }

        function renderCreativeAutoSelectedTargets() {
            const container = document.getElementById('creativeAutoSelectedTargets');
            if (!container) return;
            container.textContent = '';
            if (!creativeAutoSelectedTargets.length) {
                const briefLabel = getCreativeAutoBriefTargetLabel();
                container.textContent = briefLabel
                    ? `未手动选择，默认使用${creativeAutoSourceName()}方向包：${briefLabel}`
                    : '未选择，默认使用自动推荐。';
                return;
            }
            creativeAutoSelectedTargets.forEach(target => {
                const chip = document.createElement('button');
                chip.type = 'button';
                chip.className = 'creative-selected-target-chip';
                chip.textContent = `${target.level === '细分方向' ? '方向' : `${target.level}级标签`}：${target.label}`;
                chip.title = '点击移除';
                chip.addEventListener('click', () => toggleCreativeAutoTarget(target, false));
                container.appendChild(chip);
            });
        }

        function renderCreativeAutoTargetQueue() {
            const panel = document.getElementById('creativeAutoTargetQueuePanel');
            const meta = document.getElementById('creativeAutoTargetQueueMeta');
            const list = document.getElementById('creativeAutoTargetQueueList');
            if (!panel || !meta || !list) return;

            const targets = getCreativeAutoTargetQueueTargets();
            const expectedPrompts = getCreativeAutoTargetQueueExpectedPromptCount();
            const directionDefaults = getCreativeAutoTargetQueueDefaults();
            const expectedCandidateDirections = targets.length * directionDefaults.newDirectionsPerSource * directionDefaults.candidateMultiplier;
            const expectedSelectedDirections = targets.length * directionDefaults.newDirectionsPerSource;
            const manualSelection = getCreativeAutoManualDirectionSelection();
            const sourceLabel = manualSelection.ids.length
                ? '方向库选择'
                : (getCreativeAutoBriefTargets().length ? creativeAutoSourceName() : (targets.length ? '方向库选择' : '自动推荐'));

            meta.textContent = targets.length
                ? `${sourceLabel}：${targets.length} 个原始方向，先生成 ${expectedCandidateDirections} 个候选方向，筛选 ${expectedSelectedDirections} 个新方向，预计 ${expectedPrompts} 条提示词。数量在这里统一调整。`
                : '默认使用自动推荐；从素材分析、方案迭代或方向库加入后在这里统一调整。';
            renderCreativeAutoSourceHint(creativeAutoExternalBrief);
            updateCreativeMiniStatus({
                stage: creativeAutoLastRun ? getCreativeAutoStageText(creativeAutoLastRun) : '待启动',
                source: targets.length ? `${sourceLabel} · ${targets.length} 个方向` : '未导入方向',
                progress: targets.length ? `0 / ${targets.length}` : '0 / 0',
                state: targets.length ? 'ready' : 'idle'
            });
            list.textContent = '';

            if (!targets.length) {
                list.textContent = '暂无待拓展方向。未选择时会使用自动推荐方向。';
                return;
            }

            targets.forEach((target, index) => {
                const targetId = creativeAutoQueueTargetId(target, index);
                const card = document.createElement('div');
                card.className = 'creative-target-queue-card';

                const top = document.createElement('div');
                top.className = 'creative-target-queue-card-top';
                const title = document.createElement('strong');
                title.textContent = `${index + 1}. ${target.sourceDirectionPath || target.sourceDirectionName || targetId}`;
                const badge = document.createElement('span');
                badge.textContent = target.source === 'material-analysis'
                    ? `素材 ${target.seedMaterialCount || 0}`
                    : (target.source || '方向库');
                top.appendChild(title);
                top.appendChild(badge);
                card.appendChild(top);

                const desc = document.createElement('div');
                desc.className = 'creative-target-queue-desc';
                desc.textContent = [
                    target.visualInsight,
                    Array.isArray(target.retainElements) && target.retainElements.length ? `保留：${target.retainElements.slice(0, 6).join('、')}` : '',
                    Array.isArray(target.avoidRules) && target.avoidRules.length ? `避坑：${target.avoidRules.slice(0, 4).join('、')}` : ''
                ].filter(Boolean).join(' ｜ ') || '使用方向路径和方向库信息拓展。';
                card.appendChild(desc);

                list.appendChild(card);
            });
        }

        function buildCreativeAutoRunCreativeBrief() {
            const targets = getCreativeAutoTargetQueueTargets().filter(target => target.selected !== false);
            if (!targets.length) {
                return creativeAutoExternalBrief || undefined;
            }

            const baseEnvelope = creativeAutoExternalBrief
                ? JSON.parse(JSON.stringify(creativeAutoExternalBrief))
                : {
                    source: 'creative-auto',
                    receivedAt: new Date().toISOString(),
                    type: 'brief'
                };
            const baseData = creativeAutoBriefData(baseEnvelope) || {};
            const settings = getCreativeAutoTargetQueueDefaults();
            const candidateDirectionsPerSource = settings.newDirectionsPerSource * settings.candidateMultiplier;
            const enrichedTargets = targets.map((target, index) => {
                const targetId = creativeAutoQueueTargetId(target, index);
                return {
                    ...target,
                    targetId,
                    targetType: target.targetType || 'source-direction',
                    selected: true,
                    newDirectionsPerSource: settings.newDirectionsPerSource,
                    candidateDirectionsPerSource,
                    promptGroupsPerNewDirection: settings.promptGroupsPerNewDirection,
                    diversityMode: settings.diversityMode,
                    historyScope: settings.historyScope,
                    candidateMultiplier: settings.candidateMultiplier,
                    expectedPromptCount: settings.newDirectionsPerSource * settings.promptGroupsPerNewDirection,
                    task: `先生成 ${candidateDirectionsPerSource} 个候选方向，筛选 ${settings.newDirectionsPerSource} 个新方向，每个新方向 ${settings.promptGroupsPerNewDirection} 组生图提示词`
                };
            });
            const source = baseData.source || baseEnvelope.source || enrichedTargets[0]?.source || 'creative-auto';
            const nextData = {
                ...baseData,
                source,
                packageType: 'creative-target-package',
                target: 'source-directions',
                sourceMode: baseData.sourceMode || (source === 'material-analysis' ? 'vision-selection' : 'direction-selection'),
                defaults: getCreativeAutoTargetQueueDefaults(),
                targetCount: enrichedTargets.length,
                creativeTargets: enrichedTargets,
                targets: enrichedTargets,
                request: '请逐个执行 creativeTargets；每个原始方向的新方向数和每个新方向提示词数以 target 字段为准，只生成提示词，不调用生图平台。'
            };

            return {
                ...baseEnvelope,
                source,
                type: 'brief',
                brief: nextData
            };
        }

        function toggleCreativeAutoTarget(target = {}, forceSelected) {
            const shouldSelect = forceSelected === undefined ? !isCreativeAutoTargetSelected(target) : forceSelected;
            if (shouldSelect) {
                creativeAutoSelectedTargets = creativeAutoSelectedTargets
                    .filter(item => item.id !== target.id)
                    .concat([target]);
            } else {
                creativeAutoSelectedTargets = creativeAutoSelectedTargets.filter(item => item.id !== target.id);
            }
            syncCreativeAutoSelectedInput();
            renderCreativeAutoDirectionTree();
            renderCreativeAutoSelectedTargets();
            renderCreativeAutoTargetQueue();
            updateCreativeS3Flow(creativeAutoLastRun, creativeAutoLastStatus);
        }

        function renderCreativeAutoTargetCard(container, target = {}) {
            const card = document.createElement('label');
            card.className = 'creative-direction-leaf creative-direction-card';
            card.classList.toggle('is-selected', isCreativeAutoTargetSelected(target));
            const suggestionId = creativeAutoLastSuggestion?.direction?.id || '';
            card.classList.toggle('is-suggested', target.directionIds.includes(suggestionId));

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.dataset.directionId = target.directionIds.join(',');
            checkbox.checked = isCreativeAutoTargetSelected(target);
            checkbox.addEventListener('change', () => toggleCreativeAutoTarget(target, checkbox.checked));
            card.appendChild(checkbox);

            const body = document.createElement('span');
            body.className = 'creative-direction-leaf-body';
            const top = document.createElement('span');
            top.className = 'creative-direction-card-top';
            const title = document.createElement('strong');
            title.textContent = target.label || '未命名目标';
            const level = document.createElement('em');
            level.textContent = target.type === 'tag' ? `${target.level}级标签` : '细分方向';
            top.appendChild(title);
            top.appendChild(level);
            body.appendChild(top);

            const desc = document.createElement('span');
            desc.className = 'creative-direction-leaf-desc';
            desc.textContent = target.type === 'tag'
                ? `覆盖 ${target.directionIds.length} 个细分方向，用于归纳共同点后做大方向迭代。`
                : (target.descriptions && target.descriptions[0]) || '未记录描述';
            body.appendChild(desc);

            const refs = document.createElement('span');
            refs.className = 'creative-direction-card-refs';
            const images = (target.referenceImages || []).slice(0, 3);
            if (images.length) {
                images.forEach(image => {
                    const img = document.createElement('img');
                    img.src = image.imageUrl;
                    img.alt = image.fileName || target.label;
                    img.loading = 'lazy';
                    img.decoding = 'async';
                    refs.appendChild(img);
                });
            } else {
                const empty = document.createElement('span');
                empty.className = 'creative-direction-ref-empty';
                empty.textContent = '暂无参考图';
                refs.appendChild(empty);
            }
            body.appendChild(refs);

            const meta = document.createElement('span');
            meta.className = 'creative-direction-leaf-meta';
            appendCreativeAutoDirectionMeta(meta, '方向', target.directionIds.length);
            appendCreativeAutoDirectionMeta(meta, '参考图', target.stats.referenceCount);
            appendCreativeAutoDirectionMeta(meta, 'run', target.stats.runCount);
            appendCreativeAutoDirectionMeta(meta, '资产', target.stats.assetCount);
            if (target.directionIds.includes(suggestionId)) {
                const recommended = document.createElement('span');
                recommended.textContent = '含当前推荐';
                meta.appendChild(recommended);
            }
            body.appendChild(meta);
            card.appendChild(body);
            container.appendChild(card);
        }

        function getCreativeAutoFilteredDirectionTargets() {
            const keyword = normalizeCreativeAutoDirectionText(document.getElementById('creativeAutoDirectionSearch')?.value || '');
            const directionFiltered = creativeAutoDirections.filter(direction => directionMatchesCreativeAutoSearch(direction, keyword));
            const targets = buildCreativeAutoTargetCards(directionFiltered)
                .filter(target => creativeAutoTargetMatchesSearch(target, keyword))
                .filter(target => creativeAutoTargetMatchesLevel(target));
            return {
                directionFiltered,
                targets
            };
        }

        function selectAllCreativeAutoVisibleTargets() {
            const { targets } = getCreativeAutoFilteredDirectionTargets();
            if (!targets.length) {
                showToast('当前筛选下没有可全选的方向', 'error');
                return;
            }
            const next = new Map(creativeAutoSelectedTargets.map(target => [target.id, target]));
            targets.forEach(target => next.set(target.id, target));
            creativeAutoSelectedTargets = Array.from(next.values());
            syncCreativeAutoSelectedInput();
            renderCreativeAutoDirectionTree();
            renderCreativeAutoSelectedTargets();
            renderCreativeAutoTargetQueue();
            updateCreativeS3Flow(creativeAutoLastRun, creativeAutoLastStatus);
            showToast(`已全选当前筛选的 ${targets.length} 个目标`);
        }

        function renderCreativeAutoDirectionTree() {
            const container = document.getElementById('creativeAutoDirectionTree');
            const summary = document.getElementById('creativeAutoDirectionSummary');
            if (!container) return;
            container.textContent = '';

            const { directionFiltered, targets } = getCreativeAutoFilteredDirectionTargets();
            const selected = getCreativeAutoManualDirectionSelection();
            if (summary) {
                summary.textContent = selected.ids.length
                    ? `已选 ${selected.targets.length} 个目标 / ${selected.ids.length} 个方向`
                    : `显示 ${directionFiltered.length} / ${creativeAutoDirections.length} 个方向`;
            }

            if (!creativeAutoDirections.length) {
                container.textContent = '还没有加载到方向库。';
                return;
            }
            if (!targets.length) {
                container.textContent = '没有匹配的方向。';
                return;
            }

            const sortedTargets = targets.slice().sort((a, b) => {
                const aLevel = a.type === 'tag' ? Number(a.level) || 0 : 9;
                const bLevel = b.type === 'tag' ? Number(b.level) || 0 : 9;
                return aLevel - bLevel || Number(a.order) - Number(b.order);
            });
            sortedTargets.forEach(target => renderCreativeAutoTargetCard(container, target));
        }

        function setCreativeAutoSelectedDirection(directionId = '') {
            const id = String(directionId || '').trim();
            const direction = getCreativeAutoDirectionById(id);
            creativeAutoSelectedTargets = direction ? [{
                type: 'direction',
                id: `direction:${id}`,
                level: '细分方向',
                label: getCreativeAutoDirectionLabel(direction, id),
                path: getCreativeAutoDirectionLabel(direction, id),
                directionIds: [id],
                descriptions: [direction.description || ''],
                referenceImages: getCreativeAutoReferenceImages(direction),
                stats: getCreativeAutoDirectionStats(direction)
            }] : [];
            syncCreativeAutoSelectedInput();
            renderCreativeAutoDirectionTree();
            renderCreativeAutoSelectedTargets();
            renderCreativeAutoTargetQueue();
            updateCreativeS3Flow(creativeAutoLastRun, creativeAutoLastStatus);
        }

        function setCreativeAutoTargetLevel(level = 'all') {
            creativeAutoTargetLevel = ['all', '1', '2', '3', 'direction'].includes(String(level)) ? String(level) : 'all';
            document.querySelectorAll('#creativeAutoTargetLevelOptions [data-creative-target-level]').forEach(button => {
                button.classList.toggle('active', button.dataset.creativeTargetLevel === creativeAutoTargetLevel);
            });
            renderCreativeAutoDirectionTree();
        }

        async function loadCreativeAutoDirections() {
            const container = document.getElementById('creativeAutoDirectionTree');
            if (!container) return null;
            container.textContent = '正在加载方向地图...';
            try {
                const res = await fetch('/api/creative-knowledge/directions?limit=500');
                const data = await readJsonResponse(res, '读取方向地图失败');
                if (!data.success) throw new Error(data.message || '读取方向地图失败');
                creativeAutoDirections = Array.isArray(data.directions) ? data.directions : [];
                renderCreativeAutoDirectionTree();
                renderCreativeAutoSelectedTargets();
                renderCreativeAutoTargetQueue();
                updateCreativeS3Flow(creativeAutoLastRun, creativeAutoLastStatus);
                return data;
            } catch (error) {
                container.textContent = error.message || '读取方向地图失败';
                return null;
            }
        }

        function useCreativeAutoSuggestedDirection() {
            const directionId = creativeAutoLastSuggestion?.direction?.id || '';
            if (!directionId) {
                showToast('当前没有可勾选的推荐方向', 'error');
                return;
            }
            setCreativeAutoSelectedDirection(directionId);
        }

        function updateCreativeS3ReviewPanel(run = null) {
            const button = document.getElementById('creativeS3ReviewBtn');
            const title = document.getElementById('creativeS3ReviewTitle');
            const hint = document.getElementById('creativeS3ReviewHint');
            const panel = document.getElementById('creativeS3ReviewPanel');
            if (!button || !title || !hint) return;
            button.onclick = null;
            if (panel) panel.classList.remove('is-ready');

            if (!run || !run.runId) {
                button.disabled = true;
                button.dataset.runId = '';
                title.textContent = '结果审核';
                hint.textContent = '运行完成后，可直接进入知识库资产审核。';
                return;
            }

            button.dataset.runId = run.runId;
            const saved = Number(run.legilProgress?.saved)
                || Number(run.legilResult?.savedCount)
                || Number(run.assets?.newAssetCount)
                || 0;
            if (run.status === 'completed' && !run.agentOnly) {
                if (panel) panel.classList.add('is-ready');
                button.disabled = false;
                button.textContent = '打开本轮审核';
                button.onclick = () => openCreativeReviewForRun(run.runId);
                title.textContent = '结果审核';
                hint.textContent = `任务 ${run.runId}，已保存 ${saved} 张；点击后筛选本轮资产。`;
            } else if (run.status === 'completed' && run.agentOnly) {
                const accepted = Number(run.promptTotal) || (Array.isArray(run.prompts) ? run.prompts.length : 0);
                if (panel && accepted > 0) panel.classList.add('is-ready');
                button.disabled = accepted <= 0;
                button.textContent = '继续用提示词生图';
                button.onclick = () => continueCreativeAutoRunToLegil(run.runId);
                title.textContent = '提示词质检已完成';
                hint.textContent = `任务 ${run.runId} 已保留 ${accepted} 条提示词；可先在下方查看，也可以继续调用生图平台生成图片。`;
            } else {
                button.disabled = true;
                button.textContent = '打开本轮审核';
                title.textContent = '结果审核';
                hint.textContent = '运行还未完成，完成后会开放本轮审核入口。';
            }
        }

        function renderCreativeS3RunHistory(runs = [], total = runs.length) {
            const container = document.getElementById('creativeRunHistory');
            if (!container) return;
            container.textContent = '';

            if (!runs.length) {
                const empty = document.createElement('div');
                empty.className = 'creative-s3-empty';
                empty.textContent = '暂无历史任务。';
                container.appendChild(empty);
                return;
            }

            const offset = Math.max(0, Number(creativeAutoHistoryOffset) || 0);
            const currentStart = total > 0 ? offset + 1 : 0;
            const currentEnd = Math.min(offset + runs.length, total);
            const pageSize = CREATIVE_AUTO_HISTORY_PAGE_SIZE;

            const meta = document.createElement('div');
            meta.className = 'creative-s3-history-meta creative-s3-history-toolbar';
            const label = document.createElement('span');
            label.textContent = `显示 ${currentStart}-${currentEnd} / ${total} 条任务，面板高度固定为 2 条`;
            meta.appendChild(label);

            const pager = document.createElement('div');
            pager.className = 'creative-s3-history-pager';
            const prevBtn = document.createElement('button');
            prevBtn.type = 'button';
            prevBtn.className = 'creative-mini-btn';
            prevBtn.textContent = '上一页';
            prevBtn.disabled = offset <= 0;
            prevBtn.addEventListener('click', () => loadCreativeS3RunHistory({
                offset: Math.max(0, offset - pageSize)
            }));
            const nextBtn = document.createElement('button');
            nextBtn.type = 'button';
            nextBtn.className = 'creative-mini-btn';
            nextBtn.textContent = '下一页';
            nextBtn.disabled = offset + runs.length >= total;
            nextBtn.addEventListener('click', () => loadCreativeS3RunHistory({
                offset: offset + pageSize
            }));
            pager.appendChild(prevBtn);
            pager.appendChild(nextBtn);
            meta.appendChild(pager);
            container.appendChild(meta);

            const list = document.createElement('div');
            list.className = 'creative-run-history-scroll';
            container.appendChild(list);

            runs.forEach(run => {
                const item = document.createElement('div');
                item.className = 'creative-run-history-item';

                const top = document.createElement('div');
                top.className = 'creative-run-history-top';
                const id = document.createElement('strong');
                id.textContent = run.runId || '未知任务';
                const pill = document.createElement('span');
                pill.className = `creative-s3-status-pill ${run.status === 'completed' ? 'is-ok' : (run.status === 'failed' ? 'is-error' : 'is-running')}`;
                pill.textContent = `${run.status || '--'} / ${run.phase || '--'}`;
                top.appendChild(id);
                top.appendChild(pill);
                item.appendChild(top);

                const direction = document.createElement('div');
                direction.className = 'creative-run-history-direction';
                direction.textContent = run.sourceDirection && run.sourceDirection.path ? run.sourceDirection.path : '未记录方向';
                item.appendChild(direction);

                const stats = document.createElement('div');
                stats.className = 'creative-run-history-stats';
                [
                    ['提示词', `${run.promptTotal || 0}/${run.promptTotalRaw || run.promptTotal || 0}`],
                    ['丢弃', run.promptTotalRejected || 0],
                    ['保存', run.savedCount || 0],
                    ['资产', run.assetCount || (Array.isArray(run.assetIds) ? run.assetIds.length : 0)]
                ].forEach(([label, value]) => {
                    const stat = document.createElement('span');
                    stat.textContent = `${label} ${value}`;
                    stats.appendChild(stat);
                });
                item.appendChild(stats);

                const actions = document.createElement('div');
                actions.className = 'creative-run-history-actions';
                const inspectBtn = document.createElement('button');
                inspectBtn.type = 'button';
                inspectBtn.className = 'creative-mini-btn';
                inspectBtn.textContent = '回看进度';
                inspectBtn.addEventListener('click', () => loadCreativeAutoRunFromHistory(run.runId));
                actions.appendChild(inspectBtn);

                const reviewBtn = document.createElement('button');
                reviewBtn.type = 'button';
                reviewBtn.className = 'creative-mini-btn';
                if (run.agentOnly === true) {
                    reviewBtn.textContent = '查看提示词';
                    reviewBtn.addEventListener('click', () => loadCreativeAutoRunFromHistory(run.runId));
                    const continueBtn = document.createElement('button');
                    continueBtn.type = 'button';
                    continueBtn.className = 'creative-mini-btn';
                    continueBtn.textContent = '继续生图';
                    continueBtn.disabled = run.status !== 'completed' || Number(run.promptTotal) <= 0;
                    continueBtn.addEventListener('click', () => continueCreativeAutoRunToLegil(run.runId));
                    actions.appendChild(reviewBtn);
                    actions.appendChild(continueBtn);
                    item.appendChild(actions);
                    list.appendChild(item);
                    return;
                }
                reviewBtn.textContent = '审核资产';
                reviewBtn.addEventListener('click', () => openCreativeReviewForRun(run.runId));
                actions.appendChild(reviewBtn);
                item.appendChild(actions);

                list.appendChild(item);
            });
        }

        function hasLegacyCreativeResume() {
            return Boolean(creativeResumeInfo && creativeResumeInfo.hasResume && Number(creativeResumeInfo.remainingCount) > 0);
        }

        function canResumeCreativeAutoRun(run = creativeAutoLastRun) {
            if (hasLegacyCreativeResume()) return true;
            if (!run || !run.runId) return false;
            if (run.status === 'paused') return true;
            const queue = run.targetQueueProgress || run.targetQueue || null;
            if (
                run.status === 'completed' &&
                String(run.phase || '') === 'legil_completed' &&
                queue &&
                String(queue.nextAction || '') === 'advance_next_target'
            ) {
                return true;
            }
            return run.status === 'completed' && run.phase === 'agent_completed' && Number(run.promptTotal) > 0;
        }

        function isCreativeAutoPausedRun(run = creativeAutoLastRun) {
            return String(run && run.status || '').toLowerCase() === 'paused' ||
                String(run && run.phase || '').toLowerCase() === 'paused' ||
                String(run && run.phase || '').toLowerCase() === 'legil_paused';
        }

        function isCreativeAutoStaleRunningText(value) {
            const text = String(value || '').trim();
            if (!text) return false;
            if (/已暂停|暂停|已停止|停止|失败|完成|未完成|可继续|继续之前任务/.test(text)) return false;
            return /正在生成|正在处理|运行中|生成第\s*\d+|等待.*开始|排队中|running|queued/i.test(text);
        }

        function pickCreativeAutoDisplayText(...values) {
            for (const value of values) {
                const text = String(value || '').trim();
                if (text && !isCreativeAutoStaleRunningText(text)) return text;
            }
            return '';
        }

        function getCreativeAutoDisplayMessage(run = {}, legil = run.legilProgress || {}) {
            if (isCreativeAutoPausedRun(run)) {
                return pickCreativeAutoDisplayText(
                    run.message,
                    run.currentAction,
                    legil && legil.currentAction,
                    run.legilResult && run.legilResult.message
                ) || '任务已暂停，可继续之前任务';
            }
            return run.message || run.currentAction || (legil && legil.currentAction) || '自动创意运行中...';
        }

        function getCreativeAutoLiveLegilTask(run = creativeAutoLastRun) {
            if (run && String(run.status || '').toLowerCase() !== 'running') return null;
            const task = creativeAutoLastStatus && creativeAutoLastStatus.legilTask;
            if (!task || task.running !== true || task.taskType !== 'creative-batch') return null;

            const taskRunId = String(task.runId || '').trim();
            const runId = String((run && run.runId) || creativeAutoCurrentRunId || '').trim();
            if (taskRunId && runId && taskRunId !== runId) return null;

            return task;
        }

        function setCreativeAutoRunning(running, run = creativeAutoLastRun) {
            const runBtn = document.getElementById('creativeAutoRunBtn');
            const stopBtn = document.getElementById('creativeAutoStopBtn');
            const refreshBtn = document.getElementById('creativeAutoRefreshBtn');
            const resumeBtn = document.getElementById('creativeAutoResumeBtn');
            const newTaskBtn = document.getElementById('creativeAutoNewTaskBtn');
            const stickyBtn = document.getElementById('creativeStickyPrimaryBtn');
            const runStatus = String(run && run.status || '').toLowerCase();
            const phase = String(run && run.phase || '');
            const liveLegilTask = getCreativeAutoLiveLegilTask(run);
            const liveLegilRunning = Boolean(liveLegilTask);
            const isStopping = (running && (phase.includes('stopping') || phase.includes('stop'))) ||
                (liveLegilTask && liveLegilTask.stopRequested === true);
            const queue = run && (run.targetQueueProgress || run.targetQueue);
            const runRunning = running === true || runStatus === 'running';
            const queueRunning = runRunning && queue && String(queue.queueStatus || queue.status || '') === 'running';
            const effectivelyRunning = runRunning || queueRunning || liveLegilRunning;
            const canResume = !effectivelyRunning && canResumeCreativeAutoRun(run);
            if (runBtn) {
                runBtn.hidden = canResume;
                runBtn.disabled = effectivelyRunning;
                runBtn.textContent = effectivelyRunning ? '运行中...' : '开始创意拓展产图';
            }
            if (stopBtn) {
                stopBtn.hidden = !effectivelyRunning;
                stopBtn.disabled = !effectivelyRunning || isStopping;
                stopBtn.textContent = isStopping ? '停止中...' : '停止任务';
            }
            if (refreshBtn) refreshBtn.disabled = effectivelyRunning;
            if (resumeBtn) {
                resumeBtn.hidden = !canResume;
                resumeBtn.disabled = !canResume;
            }
            if (newTaskBtn) {
                newTaskBtn.hidden = !canResume;
                newTaskBtn.disabled = !canResume || effectivelyRunning;
                newTaskBtn.textContent = '新任务';
            }
            if (stickyBtn) {
                stickyBtn.classList.toggle('btn-danger', effectivelyRunning);
                stickyBtn.classList.toggle('btn-primary', !effectivelyRunning);
                stickyBtn.disabled = isStopping;
                if (effectivelyRunning) {
                    stickyBtn.textContent = isStopping ? '停止中...' : '停止任务';
                    stickyBtn.dataset.creativeStickyAction = 'stop';
                } else if (canResume) {
                    stickyBtn.textContent = '继续产图';
                    stickyBtn.dataset.creativeStickyAction = 'resume';
                } else {
                    stickyBtn.textContent = '开始产图';
                    stickyBtn.dataset.creativeStickyAction = 'start';
                }
            }
        }

        function handleCreativeStickyPrimaryAction() {
            const action = document.getElementById('creativeStickyPrimaryBtn')?.dataset.creativeStickyAction || 'start';
            if (action === 'stop') {
                stopCreativeAutoRun();
                return;
            }
            if (action === 'resume') {
                resumeCreativeAutoRun();
                return;
            }
            startCreativeAutoRun();
        }

        window.handleCreativeStickyPrimaryAction = handleCreativeStickyPrimaryAction;

        function renderCreativeAutoChecks(preflight = {}) {
            const checks = Array.isArray(preflight.checks) ? preflight.checks : [];
            const visibleIds = new Set([
                'knowledgeImported',
                'outputFolderWritable',
                'referenceFolderExists',
                'browserModeConfigured'
            ]);
            const checkMap = new Map(checks
                .filter(check => visibleIds.has(String(check.id || '')))
                .map(check => [String(check.id || ''), check]));

            document.querySelectorAll('[data-creative-check-id]').forEach(item => {
                const check = checkMap.get(item.dataset.creativeCheckId || '');
                const stateClass = check
                    ? (check.ok ? 'status-online' : (check.level === 'error' ? 'status-offline' : 'status-busy'))
                    : 'status-busy';
                item.className = `status-item product-status-item creative-check-status-item ${stateClass}`;
                if (check?.path || check?.actual) {
                    item.title = check.path || check.actual;
                } else {
                    item.removeAttribute('title');
                }
            });
        }

        function renderCreativeAutoStatus(data = {}) {
            const knowledge = data.knowledge || {};
            const quota = data.quota || {};
            const next = data.suggestion && data.suggestion.next ? data.suggestion.next : null;
            const activeRun = data.activeRun || null;
            const resumableRun = data.resumableRun || null;
            const latestRun = data.latestRun || null;
            creativeAutoLastStatus = data;
            creativeAutoLastSuggestion = next;

            const knowledgeEl = document.getElementById('creativeAutoKnowledge');
            const remainingEl = document.getElementById('creativeAutoRemaining');
            const scoreEl = document.getElementById('creativeAutoNextScore');
            const assetEl = document.getElementById('creativeAutoAssetCount');
            const directionEl = document.getElementById('creativeAutoDirection');

            if (knowledgeEl) {
                const count = knowledge.counts && knowledge.counts.directions ? knowledge.counts.directions : 0;
                knowledgeEl.textContent = knowledge.imported ? String(count) : '未导入';
            }
            if (remainingEl) {
                remainingEl.textContent = quota.unlimitedImages ? '不限额' : `${quota.remainingImagesToday ?? '--'}/${quota.maxImagesPerDay ?? '--'}`;
            }
            if (scoreEl) {
                scoreEl.textContent = next ? String(next.score || 0) : '--';
            }
            if (assetEl) {
                const assets = activeRun && activeRun.assets ? activeRun.assets : null;
                assetEl.textContent = assets ? String(assets.newAssetCount || 0) : '--';
            }
            if (directionEl) {
                const briefLabel = getCreativeAutoBriefTargetLabel();
                if (briefLabel) {
                    directionEl.textContent = `${creativeAutoSourceName()}指定：${briefLabel}`;
                } else if (next && next.direction) {
                    const reasons = Array.isArray(next.reasons) && next.reasons.length
                        ? `：${next.reasons.join('；')}`
                        : '';
                    directionEl.textContent = `${next.direction.path || next.direction.name || '未命名方向'}${reasons}`;
                } else {
                    directionEl.textContent = '暂无可运行方向。';
                }
            }

            renderCreativeS3Reasons(next);
            renderCreativeAutoDirectionTree();
            renderCreativeAutoChecks(data.preflight || {});
            if (activeRun) {
                creativeAutoCurrentRunId = activeRun.runId;
                renderCreativeAutoRun(activeRun);
                if (activeRun.status === 'running') {
                    startCreativeAutoPolling();
                }
            } else if (resumableRun) {
                creativeAutoCurrentRunId = resumableRun.runId;
                creativeAutoLastRun = resumableRun;
                renderCreativeAutoRun(resumableRun);
                setCreativeAutoRunning(false, resumableRun);
                setCreativeAutoInfo('info-box loading', getCreativeAutoDisplayMessage(resumableRun) || '已找到可继续的上次任务');
            } else if (latestRun) {
                creativeAutoCurrentRunId = latestRun.runId;
                creativeAutoLastRun = latestRun;
                renderCreativeAutoRun(latestRun);
                setCreativeAutoRunning(false, latestRun);
                setCreativeAutoInfo('info-box success', latestRun.message || '已加载最近一次自动创意结果');
            } else {
                creativeAutoLastRun = null;
                creativeAutoCurrentRunId = null;
                renderCreativeAutoIdlePanels();
                updateCreativeS3Flow(null, data);
                setCreativeAutoRunning(false);
            }
        }

        function renderCreativeAutoIdlePanels() {
            const panel = document.getElementById('creativeAutoProgressPanel');
            const progressLabel = document.getElementById('creativeAutoProgressLabel');
            const progressText = document.getElementById('creativeAutoProgressText');
            const estimateText = document.getElementById('creativeAutoEstimateText');
            const progressBar = document.getElementById('creativeAutoProgressBar');
            const statusText = document.getElementById('creativeAutoCurrentStatusText');
            const detail = document.getElementById('creativeAutoRunDetail');
            const acceptedEl = document.getElementById('creativeAutoAccepted');
            const rejectedEl = document.getElementById('creativeAutoRejected');
            const savedEl = document.getElementById('creativeAutoSaved');
            const failedEl = document.getElementById('creativeAutoFailed');

            if (panel) panel.classList.add('active');
            if (progressLabel) progressLabel.textContent = '等待启动';
            if (progressText) progressText.textContent = '0 / 0';
            if (estimateText) {
                estimateText.textContent = '预计完成时间：计算中';
                estimateText.title = '启动任务后会根据当前队列和生图进度估算。';
            }
            if (progressBar) {
                progressBar.style.width = '0%';
                progressBar.classList.remove('success');
            }
            if (statusText) statusText.textContent = '选择方向后，点击“开始创意拓展产图”。';
            if (detail) detail.textContent = '';
            if (acceptedEl) acceptedEl.textContent = '0';
            if (rejectedEl) rejectedEl.textContent = '0';
            if (savedEl) savedEl.textContent = '0';
            if (failedEl) failedEl.textContent = '0';
            renderCreativeAutoPromptPanel({});
            clearCreativeAutoRecentAssets({}, '生图完成并写入资产索引后，这里会显示最近图片和反馈入口。');
            updateCreativeMiniStatus({
                stage: '待启动',
                source: getCreativeAutoTargetQueueTargets().length ? `${creativeAutoSourceName()} · ${getCreativeAutoTargetQueueTargets().length} 个方向` : '未导入方向',
                progress: '0 / 0',
                state: getCreativeAutoTargetQueueTargets().length ? 'ready' : 'idle'
            });
        }

        function getCreativeAutoProgress(run = {}) {
            const legil = run.legilProgress || null;
            if (legil) {
                const total = Math.max(0, Number(legil.total) || Number(run.promptTotal) || 0);
                const completed = Math.max(0, Number(legil.completed) || 0);
                return {
                    label: '生图平台',
                    total,
                    completed: String(legil.phase || '') === 'completed' ? total : completed
                };
            }

            if (run.promptQualityReport) {
                const total = Math.max(0, Number(run.promptQualityReport.rawPromptCount) || Number(run.promptTotalRaw) || 0);
                return {
                    label: '提示词质检',
                    total,
                    completed: Math.max(0, Number(run.promptTotal) || 0)
                };
            }

            return {
                label: '创意助手拓展',
                total: 1,
                completed: ['agent_completed', 'legil_starting', 'legil_queued'].includes(run.phase) ? 1 : 0
            };
        }

        function formatCreativeAutoEstimateMinutes(minutes) {
            const value = Math.max(1, Math.ceil(Number(minutes) || 0));
            if (value < 60) return `约 ${value} 分钟`;
            if (value >= 1440) {
                const days = Math.floor(value / 1440);
                const hours = Math.round((value % 1440) / 60);
                if (hours >= 24) return `约 ${days + 1} 天`;
                return hours ? `约 ${days} 天 ${hours} 小时` : `约 ${days} 天`;
            }
            const hours = Math.floor(value / 60);
            const remain = value % 60;
            return remain ? `约 ${hours} 小时 ${remain} 分钟` : `约 ${hours} 小时`;
        }

        function safeCreativeAutoLocalStorage(action, fallback = null) {
            try {
                return action();
            } catch (error) {
                return fallback;
            }
        }

        function readCreativeAutoEtaStoredBasis() {
            const raw = safeCreativeAutoLocalStorage(() => localStorage.getItem(CREATIVE_AUTO_ETA_STORAGE_KEY), '');
            if (!raw) return null;
            try {
                const data = JSON.parse(raw);
                const minutesPerGroup = Number(data.minutesPerGroup);
                if (!Number.isFinite(minutesPerGroup) ||
                    minutesPerGroup < CREATIVE_AUTO_ETA_MIN_SAMPLE_MINUTES ||
                    minutesPerGroup > CREATIVE_AUTO_ETA_MAX_SAMPLE_MINUTES) {
                    return null;
                }
                return {
                    minutesPerGroup,
                    runId: String(data.runId || ''),
                    updatedAt: Number(data.updatedAt) || 0
                };
            } catch (error) {
                return null;
            }
        }

        function writeCreativeAutoEtaStoredBasis(runId, minutesPerGroup) {
            const value = Number(minutesPerGroup);
            if (!Number.isFinite(value) ||
                value < CREATIVE_AUTO_ETA_MIN_SAMPLE_MINUTES ||
                value > CREATIVE_AUTO_ETA_MAX_SAMPLE_MINUTES) {
                return;
            }
            safeCreativeAutoLocalStorage(() => localStorage.setItem(CREATIVE_AUTO_ETA_STORAGE_KEY, JSON.stringify({
                runId: String(runId || ''),
                minutesPerGroup: value,
                updatedAt: Date.now()
            })));
        }

        function getCreativeAutoEtaRunId(run = {}) {
            return String(run.runId || creativeAutoCurrentRunId || 'creative-auto-active').trim();
        }

        function getCreativeAutoEtaProgressKey(run = {}, progress = getCreativeAutoProgress(run)) {
            const queue = getCreativeAutoQueueProgress(run);
            return [
                getCreativeAutoEtaRunId(run),
                queue.current || 0,
                Number(progress.total) || 0
            ].join('|');
        }

        function resetCreativeAutoEtaSegment(run = {}, reason = 'manual') {
            const runId = getCreativeAutoEtaRunId(run);
            if (!runId) return null;
            const progress = getCreativeAutoProgress(run || {});
            const state = {
                runId,
                reason,
                progressKey: getCreativeAutoEtaProgressKey(run || {}, progress),
                lastCompleted: Math.max(0, Number(progress.completed) || 0),
                lastAt: Date.now(),
                calibrated: false,
                minutesPerGroup: null,
                basisSource: 'pending'
            };
            creativeAutoEtaStateByRun.set(runId, state);
            return state;
        }

        function getCreativeAutoEtaState(run = {}, progress = getCreativeAutoProgress(run)) {
            const runId = getCreativeAutoEtaRunId(run);
            if (!runId) return null;
            const progressKey = getCreativeAutoEtaProgressKey(run, progress);
            let state = creativeAutoEtaStateByRun.get(runId);
            if (!state || state.progressKey !== progressKey) {
                state = {
                    runId,
                    reason: state ? 'target-changed' : 'loaded',
                    progressKey,
                    lastCompleted: Math.max(0, Number(progress.completed) || 0),
                    lastAt: Date.now(),
                    calibrated: false,
                    minutesPerGroup: null,
                    basisSource: 'pending'
                };
                creativeAutoEtaStateByRun.set(runId, state);
            }
            return state;
        }

        function updateCreativeAutoEtaCalibration(run = {}, progress = getCreativeAutoProgress(run)) {
            const state = getCreativeAutoEtaState(run, progress);
            if (!state || run.status !== 'running') return state;
            if (!run.legilProgress || Number(progress.total) <= 0) return state;

            const completed = Math.max(0, Number(progress.completed) || 0);
            const now = Date.now();
            const deltaCompleted = completed - Number(state.lastCompleted || 0);
            const deltaMs = now - Number(state.lastAt || now);

            if (!state.calibrated && deltaCompleted > 0 && deltaMs > 0) {
                const sampleMinutes = (deltaMs / 60000) / deltaCompleted;
                if (Number.isFinite(sampleMinutes) &&
                    sampleMinutes >= CREATIVE_AUTO_ETA_MIN_SAMPLE_MINUTES &&
                    sampleMinutes <= CREATIVE_AUTO_ETA_MAX_SAMPLE_MINUTES) {
                    state.minutesPerGroup = sampleMinutes;
                    state.calibrated = true;
                    state.basisSource = 'current-segment';
                    writeCreativeAutoEtaStoredBasis(state.runId, sampleMinutes);
                }
            }

            state.lastCompleted = completed;
            state.lastAt = now;
            return state;
        }

        function getCreativeAutoEtaBasis(run = {}, etaState = null) {
            if (etaState &&
                etaState.calibrated &&
                Number(etaState.minutesPerGroup) >= CREATIVE_AUTO_ETA_MIN_SAMPLE_MINUTES &&
                Number(etaState.minutesPerGroup) <= CREATIVE_AUTO_ETA_MAX_SAMPLE_MINUTES) {
                return {
                    minutesPerGroup: Number(etaState.minutesPerGroup),
                    source: 'current-segment',
                    calibrated: true
                };
            }

            const stored = readCreativeAutoEtaStoredBasis();
            if (stored) {
                return {
                    minutesPerGroup: stored.minutesPerGroup,
                    source: stored.runId === getCreativeAutoEtaRunId(run) ? 'same-run-history' : 'history',
                    calibrated: false
                };
            }

            return {
                minutesPerGroup: CREATIVE_AUTO_ETA_DEFAULT_MINUTES_PER_GROUP,
                source: 'default',
                calibrated: false
            };
        }

        function getCreativeAutoQueueProgress(run = {}) {
            const queue = run.targetQueueProgress || run.targetQueue || {};
            const total = Math.max(
                0,
                Number(queue.total) ||
                Number(queue.targetCount) ||
                Number(queue.totalTargets) ||
                Number(run.targetCount) ||
                0
            );
            const currentRaw = Math.max(
                0,
                Number(queue.currentIndex) ||
                Number(queue.currentTargetIndex) ||
                Number(queue.targetIndex) ||
                Number(queue.index) ||
                0
            );
            const completedRaw = Math.max(
                0,
                Number(queue.completed) ||
                Number(queue.completedTargets) ||
                Number(queue.finishedTargets) ||
                0
            );
            const completed = completedRaw || (currentRaw > 0 ? currentRaw - 1 : 0);
            const current = currentRaw || (total && completed < total ? completed + 1 : completed);
            return {
                total,
                completed: total ? Math.min(completed, total) : completed,
                current: total ? Math.min(Math.max(current, 1), total) : current
            };
        }

        function isCreativeAutoOverallComplete(run = {}) {
            if (!run || run.status !== 'completed') return false;
            const queue = run.targetQueueProgress || run.targetQueue || null;
            const totalTargets = queue
                ? Math.max(0, Number(queue.totalTargets) || Number(queue.total) || 0)
                : 0;
            if (totalTargets > 1) {
                return String(queue.queueStatus || queue.status || '').toLowerCase() === 'completed';
            }
            return true;
        }

        function getCreativeAutoGroupsPerTarget(run = {}, progress = getCreativeAutoProgress(run)) {
            const queue = getCreativeAutoQueueProgress(run);
            const queueRaw = run.targetQueueProgress || run.targetQueue || {};
            const totalGroups = Math.max(0, Number(progress.total) || 0);
            const averageGroupsPerTarget = queue.total
                ? Math.ceil((Number(queueRaw.totalExpectedPromptCount) || 0) / queue.total)
                : 0;
            const defaultGroupsPerTarget = CREATIVE_AUTO_TARGET_QUEUE_DEFAULTS.newDirectionsPerSource *
                CREATIVE_AUTO_TARGET_QUEUE_DEFAULTS.promptGroupsPerNewDirection;
            return Math.max(
                1,
                totalGroups || Number(run.promptTotal) || averageGroupsPerTarget || defaultGroupsPerTarget
            );
        }

        function getCreativeAutoOverallProgress(run = {}, progress = getCreativeAutoProgress(run)) {
            const queue = getCreativeAutoQueueProgress(run);
            const phaseTotal = Math.max(0, Number(progress.total) || 0);
            const phaseCompleted = Math.max(0, Math.min(phaseTotal, Number(progress.completed) || 0));
            if (!queue.total || queue.total <= 1) {
                return {
                    label: progress.label || '整体进度',
                    total: phaseTotal,
                    completed: phaseCompleted,
                    percent: phaseTotal > 0 ? Math.round((phaseCompleted / phaseTotal) * 100) : 0,
                    currentCompleted: phaseCompleted,
                    currentTotal: phaseTotal,
                    currentLabel: progress.label || '',
                    queue
                };
            }

            const groupsPerTarget = getCreativeAutoGroupsPerTarget(run, progress);
            const queueRaw = run.targetQueueProgress || run.targetQueue || {};
            const expectedTotal = Number(queueRaw.totalExpectedPromptCount) || 0;
            const total = Math.max(queue.total * groupsPerTarget, expectedTotal, phaseTotal);
            const completedTargets = Math.max(0, Math.min(queue.total, Number(queue.completed) || 0));
            const completed = isCreativeAutoOverallComplete(run)
                ? total
                : Math.max(0, Math.min(total, (completedTargets * groupsPerTarget) + phaseCompleted));
            return {
                label: '整体进度',
                total,
                completed,
                percent: total > 0 ? Math.round((completed / total) * 100) : 0,
                currentCompleted: phaseCompleted,
                currentTotal: phaseTotal,
                currentLabel: progress.label || '',
                groupsPerTarget,
                queue
            };
        }

        function getCreativeAutoEstimate(run = {}, progress = getCreativeAutoProgress(run), etaState = null) {
            if (!run || !run.status) {
                return {
                    text: '预计完成时间：计算中',
                    title: '启动任务后会根据当前队列和生图进度估算。'
                };
            }
            if (isCreativeAutoOverallComplete(run)) return { text: '预计完成时间：已完成', title: '任务已完成。' };
            if (run.status === 'paused') return { text: '预计完成时间：已暂停', title: '任务已暂停，继续后会重新计算预计完成时间。' };
            if (run.status === 'failed') return { text: '预计完成时间：任务失败', title: run.message || '任务失败。' };

            const queue = getCreativeAutoQueueProgress(run);
            const overall = getCreativeAutoOverallProgress(run, progress);
            const totalGroups = Math.max(0, Number(progress.total) || 0);
            const completedGroups = Math.max(0, Math.min(totalGroups, Number(progress.completed) || 0));
            const currentRemainingGroups = totalGroups ? Math.max(0, totalGroups - completedGroups) : 0;
            const remainingTargets = queue.total
                ? Math.max(0, queue.total - Math.max(queue.current || 1, 1))
                : 0;
            const totalRemainingGroups = Math.max(0, Number(overall.total) - Number(overall.completed));

            const basis = getCreativeAutoEtaBasis(run, etaState);
            const remainingMinutes = (totalRemainingGroups * basis.minutesPerGroup) +
                (remainingTargets * CREATIVE_AUTO_ETA_TARGET_SWITCH_BUFFER_MINUTES);

            if (!Number.isFinite(remainingMinutes) || remainingMinutes <= 0) {
                return {
                    text: '预计完成时间：计算中',
                    title: '当前阶段缺少足够进度数据，暂时无法估算。'
                };
            }

            const basisLabel = formatCreativeAutoEstimateMinutes(basis.minutesPerGroup).replace(/^约\s*/, '');
            const titlePrefix = basis.source === 'current-segment'
                ? `按本次运行段第一次有效生成耗时估算，单组约 ${basisLabel}；同一段连续运行不反复滚动平均。`
                : (basis.source === 'default'
                    ? `暂无本次任务实际耗时，先按默认单组耗时 ${basisLabel}估算；完成一组后会校准。`
                    : `当前使用上次有效生成速度估算，单组耗时约 ${basisLabel}；继续完成一组后会重新校准。`);
            return {
                text: `预计完成时间：${formatCreativeAutoEstimateMinutes(remainingMinutes)}`,
                title: `${titlePrefix} 当前方向剩余 ${currentRemainingGroups} 组，剩余方向 ${remainingTargets} 个，预计剩余 ${totalRemainingGroups} 组。`
            };
        }

        window.CreativeAutoRuntime = {
            getProgress: getCreativeAutoProgress,
            getQueueProgress: getCreativeAutoQueueProgress,
            getOverallProgress: getCreativeAutoOverallProgress,
            updateEtaCalibration: updateCreativeAutoEtaCalibration,
            getEstimate: getCreativeAutoEstimate,
            resetEtaSegment: resetCreativeAutoEtaSegment,
            formatEstimateMinutes: formatCreativeAutoEstimateMinutes
        };

        function appendCreativeAutoDetail(container, label, value) {
            if (!container || value === undefined || value === null || value === '') return;
            const row = document.createElement('div');
            row.className = 'creative-auto-run-detail-row';
            const key = document.createElement('strong');
            key.textContent = label;
            const val = document.createElement('span');
            val.textContent = String(value);
            row.appendChild(key);
            row.appendChild(val);
            container.appendChild(row);
        }

        function getCreativeAutoAcceptedPrompts(run = {}) {
            return Array.isArray(run.prompts)
                ? run.prompts.filter(Boolean)
                : [];
        }

        function getCreativeAutoSelectedPrompts(run = {}) {
            return getCreativeAutoAcceptedPrompts(run).filter(item => item.selected !== false);
        }

        function getCreativeAutoPromptText(item = {}) {
            return String(item.finalPrompt || item.prompt || '').trim();
        }

        function getCreativeAutoFailedPrompts(run = {}) {
            const sources = [
                run.legilProgress && run.legilProgress.failedPromptResults,
                run.legilTask && run.legilTask.progress && run.legilTask.progress.failedPromptResults
            ];
            const seen = new Set();
            return sources.flatMap(source => Array.isArray(source) ? source : [])
                .filter(Boolean)
                .filter(item => {
                    const key = [
                        item.promptHash || '',
                        item.promptListIndex || '',
                        item.displayIndex || '',
                        item.sourceRow || '',
                        item.promptTitle || ''
                    ].join('|');
                    if (seen.has(key)) return false;
                    seen.add(key);
                    return true;
                });
        }

        function getCreativeAutoStageText(run = {}) {
            const queue = run.targetQueueProgress || run.targetQueue || null;
            const queueStatus = queue && String(queue.queueStatus || queue.status || '');
            if (queue && String(queue.nextAction || '') === 'advance_next_target') {
                return '当前目标已完成，队列可继续推进到下一个目标';
            }
            if (queue && queueStatus === 'completed') {
                return '目标队列已完成';
            }
            if (queue && run.status === 'completed' && String(run.phase || '') === 'legil_completed') {
                return '当前目标批次已完成';
            }
            if (run.legilProgress && String(run.legilProgress.phase || '') === 'completed') {
                return '当前生图批次已完成';
            }
            if (run.status === 'paused') {
                return '任务已暂停，可继续之前任务';
            }
            return '';
        }

        function setCreativeAutoPromptSelected(runId = '', item = {}, selected = true) {
            const targetRunId = String(runId || '').trim();
            if (!targetRunId || !creativeAutoLastRun || creativeAutoLastRun.runId !== targetRunId) return;
            const prompts = Array.isArray(creativeAutoLastRun.prompts) ? creativeAutoLastRun.prompts : [];
            const target = prompts.find(prompt => {
                if (!prompt) return false;
                if (item.promptHash && prompt.promptHash === item.promptHash) return true;
                if (item.originalIndex !== undefined && prompt.originalIndex === item.originalIndex) return true;
                return Number(prompt.index) === Number(item.index);
            });
            if (target) target.selected = selected === true;
        }

        function buildCreativeAutoPromptSelection(run = {}) {
            const selectedPrompts = getCreativeAutoSelectedPrompts(run);
            return {
                selectedPromptIndexes: selectedPrompts
                    .map(item => Number(item.index))
                    .filter(Number.isFinite),
                selectedPromptOriginalIndexes: selectedPrompts
                    .map(item => Number(item.originalIndex))
                    .filter(Number.isFinite),
                selectedPromptHashes: selectedPrompts
                    .map(item => String(item.promptHash || '').trim())
                    .filter(Boolean)
            };
        }

        async function copyCreativeAutoText(text, label = '内容') {
            const value = String(text || '').trim();
            if (!value) {
                showToast('没有可复制的内容', 'error');
                return;
            }
            try {
                await navigator.clipboard.writeText(value);
                showToast(`${label} 已复制`);
            } catch {
                const textarea = document.createElement('textarea');
                textarea.value = value;
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand('copy');
                document.body.removeChild(textarea);
                showToast(`${label} 已复制`);
            }
        }

        function makeCreativeMiniButton(label, onClick) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'creative-mini-btn';
            button.textContent = label;
            button.addEventListener('click', onClick);
            return button;
        }

        function renderCreativeAutoEmptyState(container, titleText, messageText, actions = []) {
            if (!container) return;
            container.textContent = '';
            const header = document.createElement('div');
            header.className = 'creative-auto-prompt-header';
            const title = document.createElement('strong');
            title.textContent = titleText;
            header.appendChild(title);
            if (actions.length) {
                const actionWrap = document.createElement('div');
                actionWrap.className = 'creative-auto-prompt-actions';
                actions.forEach(action => actionWrap.appendChild(action));
                header.appendChild(actionWrap);
            }
            container.appendChild(header);
            const empty = document.createElement('div');
            empty.className = 'creative-auto-empty-state';
            empty.textContent = messageText;
            container.appendChild(empty);
        }

        function renderCreativeAutoPromptPanel(run = {}) {
            const container = document.getElementById('creativeAutoPromptPanel');
            if (!container) return;
            container.textContent = '';

            const acceptedPrompts = getCreativeAutoAcceptedPrompts(run);
            const selectedPrompts = getCreativeAutoSelectedPrompts(run);
            const failedPrompts = getCreativeAutoFailedPrompts(run);
            const rejectedPrompts = Array.isArray(run.promptQualityReport?.rejectedPrompts)
                ? run.promptQualityReport.rejectedPrompts
                : [];
            if (!acceptedPrompts.length && !rejectedPrompts.length && !failedPrompts.length) {
                renderCreativeAutoEmptyState(
                    container,
                    '提示词质检结果',
                    run && run.runId
                        ? '本轮还没有可展示的 提示词质检结果。创意助手产出并通过质检后会显示通过、丢弃和可复制提示词。'
                        : '开始创意拓展产图后，这里会显示提示词质检通过和丢弃的提示词。'
                );
                return;
            }

            const header = document.createElement('div');
            header.className = 'creative-auto-prompt-header';
            const title = document.createElement('strong');
            title.textContent = `提示词质检结果：通过 ${acceptedPrompts.length} 条，已选 ${selectedPrompts.length} 条，丢弃 ${rejectedPrompts.length} 条，失败 ${failedPrompts.length} 条`;
            header.appendChild(title);

            const actions = document.createElement('div');
            actions.className = 'creative-auto-prompt-actions';
            if (acceptedPrompts.length) {
                actions.appendChild(makeCreativeMiniButton('复制全部通过提示词', () => {
                    const content = acceptedPrompts
                        .map((item, index) => `【提示词 ${index + 1}】${item.promptTitle || item.newDirectionName || ''}\n${getCreativeAutoPromptText(item)}`)
                        .join('\n\n');
                    copyCreativeAutoText(content, '全部通过提示词');
                }));
            }
            if (run.status === 'completed' && run.agentOnly === true && acceptedPrompts.length) {
                const continueButton = makeCreativeMiniButton('继续调用生图平台', () => continueCreativeAutoRunToLegil(run.runId));
                continueButton.disabled = selectedPrompts.length === 0;
                actions.appendChild(continueButton);
            }
            if (failedPrompts.length && run.status !== 'running') {
                actions.appendChild(makeCreativeMiniButton('重试失败提示词', () => retryCreativeAutoFailedPrompts(run.runId)));
            }
            header.appendChild(actions);
            container.appendChild(header);

            const list = document.createElement('div');
            list.className = 'creative-auto-prompt-list';

            acceptedPrompts.forEach((item, index) => {
                const card = document.createElement('div');
                card.className = 'creative-auto-prompt-card';

                const top = document.createElement('div');
                top.className = 'creative-auto-prompt-title';
                const selector = document.createElement('label');
                selector.className = 'creative-auto-prompt-selector';
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.checked = item.selected !== false;
                checkbox.addEventListener('change', () => {
                    setCreativeAutoPromptSelected(run.runId, item, checkbox.checked);
                    renderCreativeAutoPromptPanel(creativeAutoLastRun || run);
                });
                selector.appendChild(checkbox);
                const name = document.createElement('span');
                name.textContent = `${index + 1}. ${item.promptTitle || item.newDirectionName || item.direction || '提示词'}`;
                selector.appendChild(name);
                top.appendChild(selector);
                top.appendChild(makeCreativeMiniButton('复制', () => copyCreativeAutoText(getCreativeAutoPromptText(item), `提示词 ${index + 1}`)));
                card.appendChild(top);
                card.classList.toggle('is-unselected', item.selected === false);

                const meta = document.createElement('div');
                meta.className = 'creative-auto-prompt-meta';
                meta.textContent = [
                    item.newDirectionName || item.direction || '',
                    item.promptHash ? `hash ${item.promptHash}` : '',
                    item.translationVersion || ''
                ].filter(Boolean).join(' · ');
                card.appendChild(meta);

                const text = document.createElement('div');
                text.className = 'creative-auto-prompt-text';
                text.textContent = getCreativeAutoPromptText(item);
                card.appendChild(text);
                list.appendChild(card);
            });

            rejectedPrompts.slice(0, 20).forEach((item, index) => {
                const card = document.createElement('div');
                card.className = 'creative-auto-prompt-card is-rejected';
                const top = document.createElement('div');
                top.className = 'creative-auto-prompt-title';
                const name = document.createElement('span');
                name.textContent = `丢弃 ${index + 1}. ${item.promptTitle || item.newDirectionName || item.direction || '提示词'}`;
                top.appendChild(name);
                card.appendChild(top);
                const meta = document.createElement('div');
                meta.className = 'creative-auto-prompt-meta';
                meta.textContent = `${item.reason || 'rejected'} · ${item.message || '提示词质检已丢弃'}`;
                card.appendChild(meta);
                list.appendChild(card);
            });

            failedPrompts.slice(0, 20).forEach((item, index) => {
                const card = document.createElement('div');
                card.className = 'creative-auto-prompt-card is-rejected';
                const top = document.createElement('div');
                top.className = 'creative-auto-prompt-title';
                const name = document.createElement('span');
                name.textContent = `失败 ${index + 1}. ${item.promptTitle || item.newDirectionName || item.direction || '提示词'}`;
                top.appendChild(name);
                if (getCreativeAutoPromptText(item)) {
                    top.appendChild(makeCreativeMiniButton('复制', () => copyCreativeAutoText(getCreativeAutoPromptText(item), `失败提示词 ${index + 1}`)));
                }
                card.appendChild(top);
                const meta = document.createElement('div');
                meta.className = 'creative-auto-prompt-meta';
                meta.textContent = [
                    item.displayIndex ? `批次序号 ${item.displayIndex}` : '',
                    item.promptHash ? `hash ${item.promptHash}` : '',
                    item.error || item.message || '生图生成失败'
                ].filter(Boolean).join(' · ');
                card.appendChild(meta);
                list.appendChild(card);
            });

            container.appendChild(list);
        }

        function clearCreativeAutoRecentAssets(run = {}, message = '') {
            const container = document.getElementById('creativeAutoRecentAssets');
            if (!container) return;
            const actions = run && run.runId
                ? [makeCreativeMiniButton('进入反馈审核', () => openCreativeReviewForRun(run.runId))]
                : [];
            renderCreativeAutoEmptyState(
                container,
                '最近产出',
                message || '生图完成并写入资产索引后，这里会显示最近图片和反馈入口。',
                actions
            );
        }

        function creativeAutoAssetTitle(asset = {}) {
            return asset.promptTitle || asset.newDirectionName || asset.promptDirection || asset.fileName || asset.assetId || '产出图片';
        }

        function renderCreativeAutoRecentAssets(run = {}, assets = [], total = assets.length) {
            const container = document.getElementById('creativeAutoRecentAssets');
            if (!container) return;
            container.textContent = '';
            if (!run || !run.runId) {
                clearCreativeAutoRecentAssets(run);
                return;
            }
            if (!assets.length) {
                const message = run.status === 'completed'
                    ? '本轮暂未找到已写入资产索引的图片。可以刷新产出，或进入反馈审核查看本轮记录。'
                    : '生图平台还没有完成可回流的图片。任务完成后会在这里显示最近产出。';
                renderCreativeAutoEmptyState(container, '最近产出：暂无图片', message, [
                    makeCreativeMiniButton('刷新产出', () => loadCreativeAutoRecentAssets(run, { force: true })),
                    makeCreativeMiniButton('进入反馈审核', () => openCreativeReviewForRun(run.runId))
                ]);
                return;
            }

            const header = document.createElement('div');
            header.className = 'creative-auto-recent-assets-header';
            const title = document.createElement('strong');
            title.textContent = `最近产出：${assets.length}/${total || assets.length} 张`;
            header.appendChild(title);
            const actions = document.createElement('div');
            actions.className = 'creative-auto-prompt-actions';
            actions.appendChild(makeCreativeMiniButton('刷新产出', () => loadCreativeAutoRecentAssets(run, { force: true })));
            actions.appendChild(makeCreativeMiniButton('进入反馈审核', () => openCreativeReviewForRun(run.runId)));
            header.appendChild(actions);
            container.appendChild(header);

            const grid = document.createElement('div');
            grid.className = 'creative-auto-recent-assets-grid';
            assets.slice(0, 8).forEach(asset => {
                const item = document.createElement('button');
                item.type = 'button';
                item.className = 'creative-auto-recent-asset';
                item.title = '打开本轮资产审核';
                item.addEventListener('click', () => openCreativeReviewForRun(run.runId));

                const media = document.createElement('span');
                media.className = 'creative-auto-recent-asset-media';
                if (asset.imageUrl) {
                    const img = document.createElement('img');
                    img.src = asset.imageUrl;
                    img.alt = creativeAutoAssetTitle(asset);
                    img.loading = 'lazy';
                    media.appendChild(img);
                } else {
                    media.textContent = '无预览';
                    media.classList.add('is-missing');
                }
                item.appendChild(media);

                const text = document.createElement('span');
                text.className = 'creative-auto-recent-asset-text';
                text.appendChild(Object.assign(document.createElement('strong'), {
                    textContent: creativeAutoAssetTitle(asset)
                }));
                const meta = document.createElement('span');
                meta.textContent = [
                    asset.outputIndex ? `#${asset.outputIndex}` : '',
                    asset.reviewStatus || 'unreviewed',
                    asset.legilTaskId ? `task ${asset.legilTaskId}` : ''
                ].filter(Boolean).join(' · ');
                text.appendChild(meta);
                item.appendChild(text);
                grid.appendChild(item);
            });
            container.appendChild(grid);
        }

        async function loadCreativeAutoRecentAssets(run = {}, options = {}) {
            if (!run || !run.runId || run.agentOnly === true) {
                clearCreativeAutoRecentAssets(
                    run,
                    run && run.agentOnly === true
                        ? '当前是只生成提示词模式，不会调用生图平台；继续调用生图平台后这里会显示最近产出。'
                        : ''
                );
                return null;
            }
            const container = document.getElementById('creativeAutoRecentAssets');
            if (!container) return null;
            if (!options.force && container.dataset.runId === run.runId && container.dataset.loaded === 'true') {
                return null;
            }
            container.dataset.runId = run.runId;
            container.dataset.loaded = 'loading';
            try {
                const query = new URLSearchParams({
                    runId: run.runId,
                    limit: '8',
                    existsOnly: 'true'
                });
                const res = await fetch(`/api/creative-knowledge/assets?${query.toString()}`);
                const data = await readJsonResponse(res, '读取最近产出失败');
                if (!data.success) throw new Error(data.message || '读取最近产出失败');
                renderCreativeAutoRecentAssets(run, Array.isArray(data.assets) ? data.assets : [], Number(data.total) || 0);
                container.dataset.loaded = 'true';
                return data;
            } catch (error) {
                container.dataset.loaded = 'error';
                renderCreativeAutoEmptyState(container, '最近产出读取失败', error.message || '读取最近产出失败', [
                    makeCreativeMiniButton('重试', () => loadCreativeAutoRecentAssets(run, { force: true })),
                    makeCreativeMiniButton('进入反馈审核', () => openCreativeReviewForRun(run.runId))
                ]);
                return null;
            }
        }

        function renderCreativeAutoRun(run = {}) {
            creativeAutoLastRun = run;
            const panel = document.getElementById('creativeAutoProgressPanel');
            const progressLabel = document.getElementById('creativeAutoProgressLabel');
            const progressText = document.getElementById('creativeAutoProgressText');
            const estimateText = document.getElementById('creativeAutoEstimateText');
            const progressBar = document.getElementById('creativeAutoProgressBar');
            const statusText = document.getElementById('creativeAutoCurrentStatusText');
            const detail = document.getElementById('creativeAutoRunDetail');
            const acceptedEl = document.getElementById('creativeAutoAccepted');
            const rejectedEl = document.getElementById('creativeAutoRejected');
            const savedEl = document.getElementById('creativeAutoSaved');
            const failedEl = document.getElementById('creativeAutoFailed');

            const progress = getCreativeAutoProgress(run);
            const overallProgress = getCreativeAutoOverallProgress(run, progress);
            const total = Math.max(0, Number(overallProgress.total) || 0);
            const completed = Math.max(0, Math.min(total, Number(overallProgress.completed) || 0));
            const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
            const report = run.promptQualityReport || {};
            const legil = run.legilProgress || {};
            const result = run.legilResult || {};
            const queueLabel = getCreativeAutoRunQueueLabel(run);
            const stageText = getCreativeAutoStageText(run);
            const failedPrompts = getCreativeAutoFailedPrompts(run);
            const displayMessage = getCreativeAutoDisplayMessage(run, legil);
            const overallComplete = isCreativeAutoOverallComplete(run);

            if (panel) panel.classList.add('active');
            if (progressLabel) progressLabel.textContent = queueLabel ? `整体进度 · ${queueLabel}` : (overallProgress.label || '整体进度');
            if (progressText) progressText.textContent = total ? `${completed} / ${total}` : '0 / 0';
            const etaState = updateCreativeAutoEtaCalibration(run, progress);
            const estimate = getCreativeAutoEstimate(run, progress, etaState);
            if (estimateText) {
                estimateText.textContent = estimate.text;
                estimateText.title = estimate.title || '';
            }
            if (progressBar) {
                progressBar.style.width = `${pct}%`;
                progressBar.classList.toggle('success', overallComplete);
            }
            if (statusText) {
                statusText.textContent = displayMessage;
            }
            if (acceptedEl) acceptedEl.textContent = Number(report.acceptedPromptCount) || Number(run.promptTotal) || 0;
            if (rejectedEl) rejectedEl.textContent = Number(report.rejectedPromptCount) || Number(run.promptTotalRejected) || 0;
            if (savedEl) savedEl.textContent = Number(legil.saved) || Number(result.savedCount) || 0;
            if (failedEl) failedEl.textContent = Number(legil.failed) || Number(result.failedCount) || 0;
            updateCreativeMiniStatus({
                stage: run.status === 'paused' ? '已暂停' : (overallComplete ? '已完成' : (run.status === 'failed' ? '失败' : '运行中')),
                source: queueLabel || getCreativeAutoEffectiveTargetLabel(),
                progress: total ? `${completed} / ${total}` : '0 / 0',
                state: run.status === 'failed' ? 'error' : (overallComplete ? 'done' : (run.status === 'paused' ? 'paused' : 'running'))
            });

            if (detail) {
                detail.textContent = '';
                const planReport = run.directionPlanReport || {};
                const repairReport = run.directionPlanRepairReport || {};
                const planSummary = planReport.candidateExtensionCount
                    ? `候选 ${planReport.candidateExtensionCount}，入选 ${planReport.selectedExtensionCount || 0}，淘汰 ${planReport.rejectedExtensionCount || 0}，输出 ${planReport.selectedPromptCount || 0} 条提示词`
                    : '';
                const repairSummary = repairReport && repairReport.attempts && repairReport.attempts.length
                    ? `修复 ${repairReport.attempts.length} 轮，补候选 ${repairReport.generatedPromptCount || 0} 条，最终 ${repairReport.finalAcceptedPromptCount || 0}/${repairReport.targetPromptCount || 0}`
                    : '';
                appendCreativeAutoDetail(detail, '任务 ID', run.runId);
                appendCreativeAutoDetail(detail, '闃舵', `${run.status || ''} / ${run.phase || ''}`);
                appendCreativeAutoDetail(detail, '阶段说明', stageText);
                appendCreativeAutoDetail(detail, '方向规划', planSummary);
                appendCreativeAutoDetail(detail, '自动修复', repairSummary);
                appendCreativeAutoDetail(detail, '队列', queueLabel);
                appendCreativeAutoDetail(detail, '当前方向进度', overallProgress.currentTotal ? `${overallProgress.currentCompleted} / ${overallProgress.currentTotal}` : '');
                appendCreativeAutoDetail(detail, '方向', run.sourceDirection && run.sourceDirection.path);
                appendCreativeAutoDetail(detail, '棰濆害', run.quota && run.quota.unlimitedImages ? '不限额' : (run.quota ? `${run.quota.expectedImages || 0} 寮?/ 鍓╀綑 ${run.quota.remainingImagesToday ?? '--'}` : ''));
                appendCreativeAutoDetail(detail, '预计完成时间', estimate.text.replace(/^预计完成时间：/, ''));
                appendCreativeAutoDetail(detail, '失败提示词', failedPrompts.length ? `${failedPrompts.length} 条，可重试` : '');
                appendCreativeAutoDetail(detail, '资产', run.assets ? `新增 ${run.assets.newAssetCount || 0}，匹配 ${run.assets.matchedFileCount || 0}` : '');
                const files = run.assets && Array.isArray(run.assets.filePaths) ? run.assets.filePaths.slice(0, 4) : [];
                if (files.length) appendCreativeAutoDetail(detail, '文件', files.join(' | '));
            }
            renderCreativeAutoPromptPanel(run);
            const savedCount = Number(result.savedCount) || Number(run.assets?.newAssetCount) || 0;
            if (run.agentOnly !== true && savedCount > 0) {
                loadCreativeAutoRecentAssets(run).catch(() => {});
            } else {
                const message = run.agentOnly === true
                    ? '当前是只生成提示词模式，还没有进入生图环节。点击“继续调用生图平台”后会回流最近产出。'
                    : '生图任务完成并写入资产索引后，这里会显示最近产出和反馈入口。';
                clearCreativeAutoRecentAssets(run, message);
            }

            setCreativeAutoRunning(run.status === 'running', run);
            updateCreativeS3Flow(run, creativeAutoLastStatus);
            if (run.status === 'completed' && overallComplete) {
                setCreativeAutoInfo('info-box success', `自动创意完成：保存 ${Number(result.savedCount) || Number(run.assets?.newAssetCount) || 0} 张，任务 ${run.runId}`);
                loadCreativeS3RunHistory({ silent: true });
            } else if (run.status === 'completed') {
                setCreativeAutoInfo('info-box loading', stageText || '当前目标批次已完成，队列可继续推进');
                loadCreativeS3RunHistory({ silent: true });
            } else if (run.status === 'failed') {
                setCreativeAutoInfo('info-box error', run.message || '自动创意运行失败');
                loadCreativeS3RunHistory({ silent: true });
            } else if (run.status === 'paused') {
                setCreativeAutoInfo('info-box loading', displayMessage || '自动创意已停止，可继续之前任务');
                loadCreativeS3RunHistory({ silent: true });
            } else {
                setCreativeAutoInfo('info-box loading', displayMessage || '自动创意运行中...');
            }
        }

        function startCreativeAutoPolling() {
            if (creativeAutoStatusInterval) {
                clearInterval(creativeAutoStatusInterval);
            }
            creativeAutoStatusInterval = setInterval(pollCreativeAutoRun, 3000);
        }

        function stopCreativeAutoPolling() {
            if (creativeAutoStatusInterval) {
                clearInterval(creativeAutoStatusInterval);
                creativeAutoStatusInterval = null;
            }
        }

        async function pollCreativeAutoRun() {
            if (!creativeAutoCurrentRunId) {
                stopCreativeAutoPolling();
                return;
            }

            try {
                const res = await fetch(`/api/creative-auto/runs/${encodeURIComponent(creativeAutoCurrentRunId)}`);
                const data = await readJsonResponse(res, '读取自动创意运行记录失败');
                if (!data.success || !data.run) return;
                renderCreativeAutoRun(data.run);
                if (['completed', 'failed', 'paused'].includes(String(data.run.status || ''))) {
                    loadCreativeS3RunHistory({ silent: true });
                    const statusData = await loadCreativeAutoStatus({ silent: true });
                    const nextRun = statusData && statusData.activeRun ? statusData.activeRun : null;
                    const queueRunning = statusData && statusData.targetQueue && String(statusData.targetQueue.status || '') === 'running';
                    if (nextRun && nextRun.runId && nextRun.runId !== creativeAutoCurrentRunId) {
                        creativeAutoCurrentRunId = nextRun.runId;
                        renderCreativeAutoRun(nextRun);
                        startCreativeAutoPolling();
                        return;
                    }
                    if (queueRunning) {
                        if (creativeAutoLastRun) {
                            creativeAutoLastRun.targetQueueProgress = statusData.targetQueue;
                            creativeAutoLastRun.targetQueue = {
                                ...(creativeAutoLastRun.targetQueue || {}),
                                ...statusData.targetQueue,
                                queueStatus: statusData.targetQueue.status
                            };
                            setCreativeAutoRunning(false, creativeAutoLastRun);
                        }
                        return;
                    }
                    stopCreativeAutoPolling();
                }
            } catch (error) {
                setCreativeAutoInfo('info-box error', error.message || '读取自动创意状态失败');
            }
        }

        async function loadCreativeAutoStatus(options = {}) {
            const silent = options.silent === true;
            if (!silent) {
                setCreativeAutoInfo('info-box loading', '正在刷新自动创意状态...');
            }

            try {
                const res = await fetch('/api/creative-auto/status');
                const data = await readJsonResponse(res, '读取自动创意状态失败');
                if (!data.success) {
                    throw new Error(data.message || '璇诲彇澶辫触');
                }
                renderCreativeAutoStatus(data);
                loadCreativeS3RunHistory({ silent: true });
                if (!silent) {
                    setCreativeAutoInfo('info-box success', '自动创意状态已刷新');
                }
                return data;
            } catch (error) {
                setCreativeAutoInfo('info-box error', error.message || '读取自动创意状态失败');
                if (!silent) showToast(error.message || '读取自动创意状态失败', 'error');
                return null;
            }
        }

        window.loadCreativeAutoStatus = loadCreativeAutoStatus;

        function buildCreativeAutoStartConfirmation(settings = getCreativeAutoRunSettings()) {
            const queueTargets = getCreativeAutoTargetQueueTargets();
            const queueLine = queueTargets.length
                ? `待拓展方向：${queueTargets.length} 个，将按队列逐个拓展并生图，预计 ${getCreativeAutoTargetQueueExpectedPromptCount()} 条提示词\n`
                : '';
            const expectedLine = settings.agentOnly
                ? '本次不会调用生图平台，也不会消耗图片额度；提示词质检接受多少就保留多少。'
                : (settings.unlimitedPrompts
                    ? '本次不会按数量截断，提示词质检接受多少提示词就持续提交多少。'
                    : `本次最多 ${settings.maxPrompts} 条提示词，预计最多 ${settings.expectedImages} 张图。`);
            return (
                '确认启动“开始创意拓展产图”：\n\n' +
                `模式：${settings.label}\n` +
                `目标：${getCreativeAutoEffectiveTargetLabel()}\n` +
                queueLine +
                `${expectedLine}\n` +
                `${settings.confirmNote}\n\n` +
                '点击“确定”开始。'
            );
        }

        function confirmCreativeAutoRunStart(settings = getCreativeAutoRunSettings()) {
            const confirmed = confirm(buildCreativeAutoStartConfirmation(settings));
            if (!confirmed) return false;
            if (settings.mode === 'full') {
                return confirm('持续生图不会按 25 条或每日图片额度截断。请确认已经准备好让生图平台持续执行。');
            }
            return true;
        }

        async function startCreativeAutoRun(options = {}) {
            const settings = getCreativeAutoRunSettings();
            const directionDefaults = getCreativeAutoTargetQueueDefaults();
            const manualDirection = getCreativeAutoManualDirectionSelection();
            const maxPrompts = settings.maxPrompts;
            const fullScale = settings.fullScale;
            const creativeBriefForRun = buildCreativeAutoRunCreativeBrief();
            const targetValidationMessage = validateCreativeAutoTargetQueueForRun();
            if (targetValidationMessage) {
                setCreativeAutoInfo('info-box error', targetValidationMessage);
                showToast(targetValidationMessage, 'error');
                return;
            }
            const targetSelection = manualDirection.targets.length === 1
                ? {
                    type: manualDirection.targets[0].type,
                    level: manualDirection.targets[0].level,
                    label: manualDirection.targets[0].label,
                    path: manualDirection.targets[0].path,
                    directionIds: manualDirection.ids
                }
                : (manualDirection.targets.length > 1 ? {
                    type: 'multi',
                    level: 'mixed',
                    label: manualDirection.label,
                    path: manualDirection.label,
                    directionIds: manualDirection.ids,
                    targets: manualDirection.targets.map(target => ({
                        type: target.type,
                        level: target.level,
                        label: target.label,
                        path: target.path,
                        directionIds: target.directionIds
                    }))
                } : null);
            if (options.confirmed !== true) {
                if (!confirmCreativeAutoRunStart(settings)) return;
            }

            setCreativeAutoRunning(true);
            setCreativeAutoInfo('info-box loading', '正在启动创意拓展产图...');

            try {
                const saved = await saveCreativeConfig({ silent: true });
                if (!saved) {
                    throw new Error('创意拓展配置保存失败');
                }

                const data = await fetchJsonWithTimeout('/api/creative-auto/run-once', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        maxPrompts,
                        unlimitedPrompts: settings.unlimitedPrompts,
                        fullScale,
                        agentOnly: settings.agentOnly,
                        creativePromptStyle: (typeof config !== 'undefined' && config && config.creativePromptStyle) ? config.creativePromptStyle : 'cinematic_photo',
                        directionPlanning: {
                            enabled: true,
                            candidateExtensionsPerSource: directionDefaults.newDirectionsPerSource * directionDefaults.candidateMultiplier,
                            selectedExtensionsPerSource: directionDefaults.newDirectionsPerSource,
                            promptsPerExtension: directionDefaults.promptGroupsPerNewDirection,
                            diversityMode: directionDefaults.diversityMode,
                            historyScope: directionDefaults.historyScope,
                            candidateMultiplier: directionDefaults.candidateMultiplier,
                            minScore: 70,
                            preferredScore: 85,
                            maxRepairAttempts: 2
                        },
                        directionIds: manualDirection.ids.length ? manualDirection.ids : undefined,
                        directionId: manualDirection.ids.length === 1 ? manualDirection.ids[0] : undefined,
                        targetSelection: targetSelection || undefined,
                        creativeBrief: creativeBriefForRun || undefined
                    })
                }, 120000, '启动创意拓展产图失败，请重启服务器后刷新页面');

                if (!data.success || !data.run) {
                    throw new Error(data.message || '启动失败');
                }

                creativeAutoCurrentRunId = data.run.runId;
                resetCreativeAutoEtaSegment(data.run, 'new-run');
                renderCreativeAutoRun(data.run);
                startCreativeAutoPolling();
                addLog(`创意拓展产图已启动：${data.run.runId}`, 'success');
                showToast('创意拓展产图已启动');
            } catch (error) {
                setCreativeAutoRunning(false);
                setCreativeAutoInfo('info-box error', error.message || '启动创意拓展产图失败');
                showToast(error.message || '启动创意拓展产图失败', 'error');
            }
        }

        async function loadCreativeS3RunHistory(options = {}) {
            const container = document.getElementById('creativeRunHistory');
            if (!container) return null;
            if (!options.silent) {
                container.textContent = '正在加载历史记录...';
            }
            try {
                const requestedOffset = Number.isFinite(Number(options.offset))
                    ? Math.max(0, Math.floor(Number(options.offset)))
                    : creativeAutoHistoryOffset;
                const query = new URLSearchParams({
                    limit: String(CREATIVE_AUTO_HISTORY_PAGE_SIZE),
                    offset: String(requestedOffset)
                });
                const res = await fetch(`/api/creative-knowledge/runs?${query.toString()}`);
                const data = await readJsonResponse(res, '读取自动创意历史失败');
                if (!data.success) throw new Error(data.message || '读取自动创意历史失败');
                creativeAutoHistoryOffset = Number(data.offset) || requestedOffset;
                renderCreativeS3RunHistory(Array.isArray(data.runs) ? data.runs : [], Number(data.total) || 0);
                return data;
            } catch (error) {
                container.textContent = error.message || '读取历史记录失败';
                return null;
            }
        }

        async function loadCreativeAutoRunFromHistory(runId) {
            if (!runId) return;
            setCreativeAutoInfo('info-box loading', `正在回看 ${runId}...`);
            try {
                const res = await fetch(`/api/creative-auto/runs/${encodeURIComponent(runId)}`);
                const data = await readJsonResponse(res, '读取自动创意运行记录失败');
                if (!data.success || !data.run) throw new Error(data.message || '读取自动创意运行记录失败');
                creativeAutoCurrentRunId = data.run.runId;
                renderCreativeAutoRun(data.run);
                setCreativeAutoInfo('info-box success', `已加载 任务 ${data.run.runId}`);
                document.getElementById('creativeAutoProgressPanel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            } catch (error) {
                setCreativeAutoInfo('info-box error', error.message || '读取自动创意运行记录失败');
                showToast(error.message || '读取自动创意运行记录失败', 'error');
            }
        }

        function getCreativeAutoRunQueueLabel(run = {}) {
            const queue = run.targetQueue || run.targetQueueProgress || null;
            if (!queue || Number(queue.totalTargets) <= 1) return '';
            const current = Number(queue.currentIndex || queue.index) || 1;
            const total = Number(queue.totalTargets || queue.total) || 0;
            const promptTotal = Number(queue.totalExpectedPromptCount) || 0;
            return [
                total ? `目标 ${current}/${total}` : '',
                promptTotal ? `总提示词约 ${promptTotal}` : ''
            ].filter(Boolean).join('，');
        }

        async function continueCreativeAutoRunToLegil(runId = '') {
            const targetRunId = String(runId || creativeAutoCurrentRunId || '').trim();
            if (!targetRunId) {
                showToast('还没有可继续生图的任务', 'error');
                return;
            }

            const run = creativeAutoLastRun && creativeAutoLastRun.runId === targetRunId ? creativeAutoLastRun : null;
            const selectedPrompts = getCreativeAutoSelectedPrompts(run || {});
            const promptCount = run ? selectedPrompts.length : '';
            if (run && promptCount === 0) {
                showToast('请至少勾选 1 条提示词再继续生图', 'error');
                return;
            }
            const browserModeLabel = typeof getCreativeBrowserModeLabel === 'function'
                ? getCreativeBrowserModeLabel(config.creativeBrowserMode)
                : config.creativeBrowserMode;
            const confirmed = confirm(
                `确认用当前勾选的 ${promptCount || ''} 条提示词继续调用生图平台：\n\n` +
                `这会开始 ${browserModeLabel} 浏览器自动化；图片数量不按每日额度截断。`
            );
            if (!confirmed) return;

            setCreativeAutoRunning(true);
            setCreativeAutoInfo('info-box loading', `正在从提示词质检结果继续启动生图平台：${targetRunId}`);

            try {
                const saved = await saveCreativeConfig({ silent: true });
                if (!saved) {
                    throw new Error('创意拓展配置保存失败');
                }

                const data = await fetchJsonWithTimeout(`/api/creative-auto/runs/${encodeURIComponent(targetRunId)}/start-legil`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        ...(run ? buildCreativeAutoPromptSelection(run) : {}),
                        browserMode: config.creativeBrowserMode
                    })
                }, 30000, '继续启动生图平台失败');

                if (!data.success || !data.run) {
                    throw new Error(data.message || '继续启动生图平台失败');
                }

                creativeAutoCurrentRunId = data.run.runId;
                resetCreativeAutoEtaSegment(data.run, 'continue-legil');
                renderCreativeAutoRun(data.run);
                startCreativeAutoPolling();
                loadCreativeS3RunHistory({ silent: true });
                showToast('已继续调用生图平台');
                addLog(`已从提示词质检结果继续调用生图平台：${data.run.runId}`, 'success');
            } catch (error) {
                setCreativeAutoRunning(false);
                setCreativeAutoInfo('info-box error', error.message || '继续启动生图平台失败');
                showToast(error.message || '继续启动生图平台失败', 'error');
            }
        }

        async function retryCreativeAutoFailedPrompts(runId = '') {
            const targetRunId = String(runId || creativeAutoCurrentRunId || creativeAutoLastRun?.runId || '').trim();
            if (!targetRunId) {
                showToast('还没有可重试的任务', 'error');
                return;
            }
            const run = creativeAutoLastRun && creativeAutoLastRun.runId === targetRunId ? creativeAutoLastRun : null;
            const failedPrompts = getCreativeAutoFailedPrompts(run || {});
            if (!failedPrompts.length) {
                showToast('没有可重试的失败提示词', 'error');
                return;
            }
            const confirmed = confirm(`确认只重试 ${failedPrompts.length} 条失败提示词？\n\n这会重新调用生图平台，并把重试结果追加到当前任务记录。`);
            if (!confirmed) return;

            setCreativeAutoRunning(true, run || creativeAutoLastRun);
            setCreativeAutoInfo('info-box loading', `正在重试失败提示词：${targetRunId}`);

            try {
                const saved = await saveCreativeConfig({ silent: true });
                if (!saved) {
                    throw new Error('创意拓展配置保存失败');
                }

                const data = await fetchJsonWithTimeout(`/api/creative-auto/runs/${encodeURIComponent(targetRunId)}/retry-failed-prompts`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        browserMode: config.creativeBrowserMode
                    })
                }, 30000, '重试失败提示词 失败');

                if (!data.success || !data.run) {
                    throw new Error(data.message || '重试失败提示词 失败');
                }

                creativeAutoCurrentRunId = data.run.runId;
                resetCreativeAutoEtaSegment(data.run, 'retry-failed');
                renderCreativeAutoRun(data.run);
                startCreativeAutoPolling();
                loadCreativeS3RunHistory({ silent: true });
                showToast('已开始重试失败提示词');
                addLog(`已开始重试失败提示词：${data.run.runId}`, 'success');
            } catch (error) {
                setCreativeAutoRunning(false, creativeAutoLastRun);
                setCreativeAutoInfo('info-box error', error.message || '重试失败提示词 失败');
                showToast(error.message || '重试失败提示词 失败', 'error');
            }
        }

        async function resumeCreativeAutoRun(runId = '') {
            const targetRunId = String(runId || creativeAutoCurrentRunId || creativeAutoLastRun?.runId || '').trim();
            if (!targetRunId) {
                if (typeof refreshCreativeResumeControls === 'function') {
                    await refreshCreativeResumeControls();
                }
                if (hasLegacyCreativeResume() && typeof resumeCreativeStoppedTask === 'function') {
                    await resumeCreativeStoppedTask();
                    return;
                }
                showToast('还没有可恢复的自动创意任务', 'error');
                return;
            }

            const run = creativeAutoLastRun && creativeAutoLastRun.runId === targetRunId ? creativeAutoLastRun : null;
            if ((!run || !canResumeCreativeAutoRun(run)) && hasLegacyCreativeResume() && typeof resumeCreativeStoppedTask === 'function') {
                await resumeCreativeStoppedTask();
                return;
            }
            if (run && run.status === 'completed' && run.phase === 'agent_completed') {
                await continueCreativeAutoRunToLegil(targetRunId);
                return;
            }

            const confirmed = confirm('确认继续之前的自动创意任务？\n\n如果上次停在生图阶段，会从剩余提示词继续；如果停在创意助手阶段，会基于同一方向重新生成提示词。');
            if (!confirmed) return;

            setCreativeAutoRunning(true, run || creativeAutoLastRun);
            setCreativeAutoInfo('info-box loading', `正在恢复自动创意：${targetRunId}`);

            try {
                const saved = await saveCreativeConfig({ silent: true });
                if (!saved) {
                    throw new Error('创意拓展配置保存失败');
                }

                const data = await fetchJsonWithTimeout(`/api/creative-auto/runs/${encodeURIComponent(targetRunId)}/resume`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        ...(run ? buildCreativeAutoPromptSelection(run) : {}),
                        browserMode: config.creativeBrowserMode
                    })
                }, 30000, '恢复自动创意任务失败');

                if (!data.success || !data.run) {
                    throw new Error(data.message || '恢复自动创意任务失败');
                }

                creativeAutoCurrentRunId = data.run.runId;
                resetCreativeAutoEtaSegment(data.run, 'resume');
                renderCreativeAutoRun(data.run);
                startCreativeAutoPolling();
                loadCreativeS3RunHistory({ silent: true });
                showToast('已恢复自动创意任务');
                addLog(`已恢复自动创意任务：${data.run.runId}`, 'success');
            } catch (error) {
                setCreativeAutoRunning(false, creativeAutoLastRun);
                setCreativeAutoInfo('info-box error', error.message || '恢复自动创意任务失败');
                showToast(error.message || '恢复自动创意任务失败', 'error');
            }
        }

        async function loadCreativeAutoNewTaskGuardStatus() {
            try {
                const data = window.ApiClient && typeof window.ApiClient.fetchJson === 'function'
                    ? await window.ApiClient.fetchJson('/api/run-state/summary', {
                        timeoutMs: 8000,
                        fallbackMessage: '读取运行状态失败',
                        toastOnError: false
                    })
                    : await (async () => {
                        const res = await fetch('/api/run-state/summary');
                        return await readJsonResponse(res, '读取运行状态失败');
                    })();
                const runs = Array.isArray(data && data.runs) ? data.runs : [];
                const activeRun = data && data.activeRun && data.activeRun.runType === 'creative-auto'
                    ? data.activeRun
                    : runs.find(run => run && run.runType === 'creative-auto' && run.status === 'running') || null;
                return {
                    activeRun: activeRun && activeRun.status === 'running' ? activeRun : null,
                    targetQueue: activeRun ? (activeRun.targetQueueProgress || activeRun.targetQueue || null) : null
                };
            } catch (error) {
                const statusData = await loadCreativeAutoStatus({ silent: true });
                return {
                    activeRun: statusData && statusData.activeRun ? statusData.activeRun : null,
                    targetQueue: statusData && statusData.targetQueue ? statusData.targetQueue : null
                };
            }
        }

        async function startNewCreativeAutoTask() {
            if (creativeAutoLastRun && creativeAutoLastRun.status === 'running') {
                showToast('当前任务还在运行，请先停止后再开始新任务', 'error');
                return;
            }
            const targetValidationMessage = validateCreativeAutoTargetQueueForRun();
            if (targetValidationMessage) {
                setCreativeAutoInfo('info-box error', targetValidationMessage);
                showToast(targetValidationMessage, 'error');
                return;
            }
            if (!confirmCreativeAutoRunStart(getCreativeAutoRunSettings())) return;

            setCreativeAutoInfo('info-box loading', '正在确认当前是否有运行中的自动创意任务...');
            const statusData = await loadCreativeAutoNewTaskGuardStatus();
            const activeRun = statusData && statusData.activeRun ? statusData.activeRun : null;
            const targetQueue = statusData && statusData.targetQueue ? statusData.targetQueue : null;
            const queueRunning = targetQueue && String(targetQueue.status || targetQueue.queueStatus || '') === 'running';
            if (activeRun || queueRunning) {
                const run = activeRun || creativeAutoLastRun || null;
                if (run && run.runId) {
                    creativeAutoCurrentRunId = run.runId;
                    renderCreativeAutoRun(run);
                    startCreativeAutoPolling();
                } else {
                    setCreativeAutoRunning(true, {
                        status: 'running',
                        targetQueueProgress: targetQueue,
                        targetQueue
                    });
                }
                setCreativeAutoInfo('info-box loading', '已有自动创意任务正在运行，请先停止后再开始新任务。');
                showToast('当前任务还在运行，请先停止后再开始新任务', 'error');
                return;
            }
            creativeAutoCurrentRunId = '';
            creativeAutoLastRun = null;
            creativeAutoEtaStateByRun.clear();
            stopCreativeAutoPolling();
            setCreativeAutoRunning(false, null);
            updateCreativeS3Flow(null, creativeAutoLastStatus);
            setCreativeAutoInfo('info-box loading', '准备开始一个新的自动创意任务...');
            await startCreativeAutoRun({ confirmed: true });
        }

        async function openCreativeReviewForRun(runId = '') {
            const targetRunId = String(runId || document.getElementById('creativeS3ReviewBtn')?.dataset.runId || creativeAutoCurrentRunId || '').trim();
            if (!targetRunId) {
                showToast('还没有可审核的任务', 'error');
                return;
            }

            if (typeof switchPage === 'function') {
                switchPage('knowledge');
            }

            const search = document.getElementById('knowledgeAssetSearch');
            const reviewFilter = document.getElementById('knowledgeAssetReviewFilter');
            if (search) search.value = targetRunId;
            if (reviewFilter) reviewFilter.value = '';

            try {
                if (typeof loadCreativeKnowledgeAssets === 'function') {
                    await loadCreativeKnowledgeAssets();
                } else if (typeof loadCreativeKnowledgePage === 'function') {
                    await loadCreativeKnowledgePage({ silent: true });
                }
                document.getElementById('knowledgeAssetList')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                setCreativeAutoInfo('info-box success', `已跳转知识库审核 任务 ${targetRunId}`);
            } catch (error) {
                showToast(error.message || '打开资产审核失败', 'error');
            }
        }

        async function stopCreativeAutoRun() {
            const stopBtn = document.getElementById('creativeAutoStopBtn');
            if (stopBtn) {
                stopBtn.disabled = true;
                stopBtn.textContent = '停止中...';
            }
            setCreativeAutoInfo('info-box loading', '正在发送停止指令...');

            try {
                const targetRunId = String(creativeAutoCurrentRunId || creativeAutoLastRun?.runId || '').trim();
                if (!targetRunId) {
                    const fallbackRes = await fetch('/api/legil/stop', { method: 'POST' });
                    const fallbackData = await readJsonResponse(fallbackRes, '停止生图任务失败');
                    if (!fallbackData.success) {
                        throw new Error(fallbackData.message || '停止失败');
                    }
                    setCreativeAutoInfo('info-box loading', fallbackData.message || '已发送生图停止指令');
                    addLog('已发送创意拓展生图停止指令', 'system');
                    if (stopBtn) {
                        stopBtn.disabled = true;
                        stopBtn.textContent = '停止任务';
                    }
                    return;
                }

                const res = await fetch(`/api/creative-auto/runs/${encodeURIComponent(targetRunId)}/pause`, {
                    method: 'POST'
                });
                const data = await readJsonResponse(res, '停止自动创意任务失败');
                if (!data.success) {
                    throw new Error(data.message || '停止失败');
                }

                if (data.run) {
                    creativeAutoCurrentRunId = data.run.runId;
                    renderCreativeAutoRun(data.run);
                }
                if (data.queue && creativeAutoLastRun) {
                    creativeAutoLastRun.targetQueueProgress = data.queue;
                    creativeAutoLastRun.targetQueue = {
                        ...(creativeAutoLastRun.targetQueue || {}),
                        ...data.queue,
                        queueStatus: data.queue.status
                    };
                    renderCreativeAutoRun(creativeAutoLastRun);
                }
                setCreativeAutoInfo('info-box loading', data.message || '已发送暂停指令');

                addLog('已发送自动创意停止指令', 'system');
                if (data.run && data.run.status === 'running') {
                    startCreativeAutoPolling();
                } else {
                    stopCreativeAutoPolling();
                    loadCreativeAutoStatus({ silent: true });
                }
            } catch (error) {
                setCreativeAutoInfo('info-box error', error.message || '停止失败');
                showToast(error.message || '停止失败', 'error');
                setCreativeAutoRunning(creativeAutoLastRun?.status === 'running', creativeAutoLastRun);
            }
        }

        let creativeAutoInitialDataLoaded = false;

        async function primeCreativeAutoRunState() {
            try {
                const data = window.ApiClient && typeof window.ApiClient.fetchJson === 'function'
                    ? await window.ApiClient.fetchJson('/api/run-state/summary', {
                        timeoutMs: 8000,
                        fallbackMessage: '读取运行状态失败',
                        toastOnError: false
                    })
                    : await (async () => {
                        const res = await fetch('/api/run-state/summary');
                        return await readJsonResponse(res, '读取运行状态失败');
                    })();
                const run = data && data.activeRun && data.activeRun.runType === 'creative-auto'
                    ? data.activeRun
                    : null;
                if (!run || !run.runId) return null;
                creativeAutoCurrentRunId = run.runId;
                creativeAutoLastRun = run;
                renderCreativeAutoRun(run);
                setCreativeAutoRunning(run.status === 'running', run);
                if (run.status === 'running') {
                    startCreativeAutoPolling();
                } else {
                    stopCreativeAutoPolling();
                }
                return run;
            } catch (error) {
                return null;
            }
        }

        function ensureCreativeAutoInitialData() {
            if (creativeAutoInitialDataLoaded) return;
            creativeAutoInitialDataLoaded = true;
            primeCreativeAutoRunState();
            loadCreativeAutoStatus({ silent: true });
            loadCreativeAutoDirections();
            loadCreativeS3RunHistory({ silent: true });
        }

        window.ensureCreativeAutoInitialData = ensureCreativeAutoInitialData;
        window.primeCreativeAutoRunState = primeCreativeAutoRunState;

        document.addEventListener('DOMContentLoaded', () => {
            loadCreativeAutoMaterialBrief();
            if (document.getElementById('creativePage')?.classList.contains('active')) {
                ensureCreativeAutoInitialData();
            }
            const fullScale = document.getElementById('creativeAutoFullScale');
            document.querySelectorAll('input[name="creativeAutoPromptMode"]').forEach(input => {
                input.addEventListener('change', () => syncCreativeAutoPromptMode());
            });
            fullScale?.addEventListener('change', () => syncCreativeAutoPromptMode({ preserveValue: false }));
            document.getElementById('creativeAutoManualDirection')?.addEventListener('change', () => {
                if (document.getElementById('creativeAutoManualDirection')?.checked !== true) {
                    setCreativeAutoSelectedDirection('');
                    return;
                }
                updateCreativeS3Flow(creativeAutoLastRun, creativeAutoLastStatus);
                renderCreativeAutoDirectionTree();
                renderCreativeAutoTargetQueue();
            });
            document.getElementById('creativeAutoDirectionId')?.addEventListener('input', () => {
                const inputValue = String(document.getElementById('creativeAutoDirectionId')?.value || '').trim();
                const manualToggle = document.getElementById('creativeAutoManualDirection');
                if (manualToggle) manualToggle.checked = Boolean(inputValue);
                creativeAutoSelectedTargets = [];
                renderCreativeAutoSelectedTargets();
                updateCreativeS3Flow(creativeAutoLastRun, creativeAutoLastStatus);
                renderCreativeAutoDirectionTree();
                renderCreativeAutoTargetQueue();
            });
            document.getElementById('creativeAutoNewDirectionsPerSource')?.addEventListener('input', () => {
                renderCreativeAutoTargetQueue();
                updateCreativeS3Flow(creativeAutoLastRun, creativeAutoLastStatus);
            });
            document.getElementById('creativeAutoPromptsPerNewDirection')?.addEventListener('input', () => {
                renderCreativeAutoTargetQueue();
                updateCreativeS3Flow(creativeAutoLastRun, creativeAutoLastStatus);
            });
            ['creativeAutoDiversityMode', 'creativeAutoHistoryScope'].forEach(id => {
                document.getElementById(id)?.addEventListener('change', () => {
                    renderCreativeAutoTargetQueue();
                    updateCreativeS3Flow(creativeAutoLastRun, creativeAutoLastStatus);
                });
            });
            document.getElementById('creativeAutoCandidateMultiplier')?.addEventListener('input', () => {
                renderCreativeAutoTargetQueue();
                updateCreativeS3Flow(creativeAutoLastRun, creativeAutoLastStatus);
            });
            document.getElementById('creativeAutoDirectionSearch')?.addEventListener('input', () => renderCreativeAutoDirectionTree());
            document.querySelectorAll('#creativeAutoTargetLevelOptions [data-creative-target-level]').forEach(button => {
                button.addEventListener('click', () => setCreativeAutoTargetLevel(button.dataset.creativeTargetLevel || 'all'));
            });
            document.getElementById('creativeAutoUseSuggestedDirectionBtn')?.addEventListener('click', () => useCreativeAutoSuggestedDirection());
            document.getElementById('creativeAutoSelectAllDirectionBtn')?.addEventListener('click', () => selectAllCreativeAutoVisibleTargets());
            document.getElementById('creativeAutoClearDirectionBtn')?.addEventListener('click', () => setCreativeAutoSelectedDirection(''));
            renderCreativeAutoTargetQueue();
            syncCreativeAutoPromptMode();
        });

        document.addEventListener('creative:auto:visible', () => {
            primeCreativeAutoRunState();
            ensureCreativeAutoInitialData();
        });
