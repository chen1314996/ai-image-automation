// 知识库只读页：方向、资产和 run 的可视化入口。
        const creativeKnowledgeState = {
            overview: null,
            directions: [],
            drafts: [],
            assets: [],
            runs: [],
            memory: null,
            visualDnaWorkbench: null,
            autoCurator: {
                report: null,
                goldenSet: null
            },
            selectedDirectionIds: new Set(),
            filteredDirections: [],
            directionTotal: 0,
            assetDetailGroup: null,
            selectedAssetId: '',
            feishuSync: null
        };

        const KNOWLEDGE_FEISHU_SOURCE_LABELS = {
            directions: '方向',
            topMaterials: 'TOP素材',
            referenceImages: '参考图线索'
        };

        const knowledgeNumberFormatter = new Intl.NumberFormat('zh-CN');
        const KNOWLEDGE_REVIEW_STATUS = {
            unreviewed: { label: '未审', className: 'is-unreviewed' },
            good: { label: '好图', className: 'is-good' },
            normal: { label: '一般', className: 'is-normal' },
            bad: { label: '坏图', className: 'is-bad' },
            rejected: { label: '废图', className: 'is-rejected' }
        };
        const KNOWLEDGE_REVIEW_ACTIONS = [
            { value: 'good', label: '好图' },
            { value: 'normal', label: '一般' },
            { value: 'bad', label: '坏图' },
            { value: 'rejected', label: '废图' }
        ];
        const KNOWLEDGE_AUTO_GRADE = {
            good: { label: '好图', className: 'is-good' },
            normal: { label: '一般', className: 'is-normal' },
            bad: { label: '坏图', className: 'is-bad' },
            off_direction: { label: '跑题', className: 'is-off-direction' },
            text_problem: { label: '文字问题', className: 'is-text-problem' }
        };
        const KNOWLEDGE_FEEDBACK_TAGS = [
            '跑题',
            '重复',
            '构图弱',
            '主体不清',
            '文字差',
            '风格不符',
            '过度科幻',
            '参考图未跟随',
            '可以量产',
            '可以拓展'
        ];
        const KNOWLEDGE_DIRECTION_STATUS = {
            seed: { label: '种子', className: 'is-normal' },
            draft: { label: '草案', className: 'is-paused' },
            accepted: { label: '已采纳', className: 'is-ok' },
            rejected: { label: '已拒绝', className: 'is-error' },
            archived: { label: '已归档', className: 'is-paused' },
            disabled: { label: '禁跑', className: 'is-error' }
        };

        function knowledgeDirectionStatus(direction = {}) {
            const status = String(direction.status || 'seed').trim().toLowerCase();
            if (direction.autoRun === false && status !== 'archived') return 'disabled';
            return KNOWLEDGE_DIRECTION_STATUS[status] ? status : 'seed';
        }

        function knowledgeDirectionSourceLabel(source = '') {
            const labels = {
                seed: '方向种子表',
                agent: '创意拓展沉淀',
                'material-analysis': '素材分析沉淀',
                'task-workbook': '方案迭代沉淀',
                imported: '外部导入'
            };
            return labels[String(source || '').trim()] || '知识库沉淀';
        }

        function knowledgeDirectionUpdatedAt(direction = {}) {
            return direction.updatedAt || direction.createdAt || direction.importedAt || direction.stats?.lastRunAt || '';
        }

        function knowledgeDirectionIsRunnable(direction = {}) {
            const status = knowledgeDirectionStatus(direction);
            return !['disabled', 'archived', 'rejected'].includes(status) && direction.autoRun !== false;
        }

        function knowledgeDirectionMatchesPerformance(direction = {}, filterValue = '') {
            const stats = direction.knowledgeStats || {};
            if (!filterValue) return true;
            if (filterValue === 'runnable') return knowledgeDirectionIsRunnable(direction);
            if (filterValue === 'references') {
                return (Number(stats.activeReferenceCount) || 0) > 0 ||
                    (Number(stats.matchedReferenceCount) || 0) > 0 ||
                    (Array.isArray(direction.referenceImages) && direction.referenceImages.length > 0) ||
                    (Array.isArray(direction.referencePool) && direction.referencePool.length > 0);
            }
            if (filterValue === 'assets') return (Number(stats.assetCount) || 0) > 0;
            if (filterValue === 'runs') return (Number(stats.runCount) || 0) > 0;
            if (filterValue === 'evidence') return (Number(stats.evidenceCount) || Number(direction.evidenceCount) || 0) > 0;
            return true;
        }

        function knowledgeCurrentDirectionFilters() {
            return {
                source: document.getElementById('knowledgeDirectionSourceFilter')?.value || '',
                status: document.getElementById('knowledgeDirectionStatusFilter')?.value || '',
                performance: document.getElementById('knowledgeDirectionPerformanceFilter')?.value || ''
            };
        }

        function knowledgeFilteredDirections(directions = creativeKnowledgeState.directions) {
            const filters = knowledgeCurrentDirectionFilters();
            return (Array.isArray(directions) ? directions : []).filter(direction => {
                if (filters.source && String(direction.source || '').trim() !== filters.source) return false;
                if (filters.status && knowledgeDirectionStatus(direction) !== filters.status) return false;
                return knowledgeDirectionMatchesPerformance(direction, filters.performance);
            });
        }

        function knowledgeDirectionSelectionId(direction = {}) {
            return String(direction.id || '').trim();
        }

        function knowledgeSelectedDirections() {
            const selectedIds = creativeKnowledgeState.selectedDirectionIds || new Set();
            return creativeKnowledgeState.directions.filter(direction => selectedIds.has(knowledgeDirectionSelectionId(direction)));
        }

        function knowledgeDirectionStatusPill(status, text) {
            const config = KNOWLEDGE_DIRECTION_STATUS[status] || KNOWLEDGE_DIRECTION_STATUS.seed;
            return knowledgeMakeEl('span', `knowledge-status-pill ${config.className}`, text || config.label);
        }

        function setKnowledgeInfo(className, text) {
            const infoBox = document.getElementById('knowledgeInfo');
            if (!infoBox) return;
            infoBox.className = className;
            infoBox.textContent = text;
        }

        function knowledgeFormatNumber(value) {
            const numberValue = Number(value);
            return Number.isFinite(numberValue) ? knowledgeNumberFormatter.format(numberValue) : '--';
        }

        function knowledgeFormatPercent(value) {
            const numberValue = Number(value);
            return Number.isFinite(numberValue) ? `${Math.round(numberValue * 100)}%` : '--';
        }

        function knowledgeFormatDate(value) {
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

        function knowledgeText(value, fallback = '') {
            const text = String(value ?? '').trim();
            return text || fallback;
        }

        function knowledgeShortText(value, maxLength = 90) {
            const text = knowledgeText(value);
            if (text.length <= maxLength) return text;
            return text.slice(0, maxLength - 1) + '…';
        }

        function knowledgeExtractPromptField(prompt, label, maxLength = 90) {
            const text = knowledgeText(prompt);
            if (!text) return '';
            const labels = ['主题', '画风', '情绪感', '画面内容', '整体基调'];
            const nextLabels = labels.filter(item => item !== label).join('|');
            const pattern = new RegExp(`${label}[：:]\\s*([\\s\\S]*?)(?=[，,；;。]\\s*(?:${nextLabels})[：:]|[。\\n]|$)`);
            const match = text.match(pattern);
            return knowledgeShortText(match && match[1] ? match[1].trim() : '', maxLength);
        }

        function knowledgeAssetSummary(asset = {}) {
            const coreText = knowledgeExtractPromptField(asset.prompt, '画面内容', 98)
                || knowledgeShortText(asset.prompt || '未记录画面核心内容', 98);
            return {
                direction: knowledgeShortText(asset.directionPath || asset.directionName || '未记录方向', 72),
                theme: knowledgeShortText(asset.promptDirection || asset.directionName || knowledgeExtractPromptField(asset.prompt, '主题', 76) || asset.fileName || '未记录主题', 76),
                core: knowledgeDnaLocalizeText(coreText)
            };
        }

        function knowledgeAssetGroupKey(asset = {}) {
            return [
                asset.runId || 'unknown-run',
                asset.promptHash || asset.promptIndex || asset.promptDirection || asset.prompt || asset.assetId || 'unknown-prompt'
            ].join('::');
        }

        function knowledgeAssetTime(asset = {}) {
            const value = new Date(asset.savedAt || asset.recordedAt || 0).getTime();
            return Number.isFinite(value) ? value : 0;
        }

        function buildKnowledgeAssetGroups(assets = []) {
            const groupsByKey = new Map();
            assets.forEach(asset => {
                const key = knowledgeAssetGroupKey(asset);
                if (!groupsByKey.has(key)) {
                    groupsByKey.set(key, {
                        key,
                        assets: [],
                        latestTime: 0,
                        representative: asset
                    });
                }
                const group = groupsByKey.get(key);
                group.assets.push(asset);
                group.latestTime = Math.max(group.latestTime, knowledgeAssetTime(asset));
            });

            return Array.from(groupsByKey.values())
                .map(group => {
                    group.assets.sort((a, b) => {
                        const outputDiff = (Number(a.outputIndex) || 0) - (Number(b.outputIndex) || 0);
                        if (outputDiff !== 0) return outputDiff;
                        return knowledgeAssetTime(a) - knowledgeAssetTime(b);
                    });
                    group.representative = group.assets.find(asset => asset.imageUrl) || group.assets[0] || {};
                    return group;
                })
                .sort((a, b) => b.latestTime - a.latestTime);
        }

        function knowledgeReviewStatus(asset = {}) {
            const status = String(asset.reviewStatus || (asset.review && asset.review.status) || 'unreviewed').trim();
            return KNOWLEDGE_REVIEW_STATUS[status] ? status : 'unreviewed';
        }

        function knowledgeReviewLabel(status) {
            return (KNOWLEDGE_REVIEW_STATUS[status] || KNOWLEDGE_REVIEW_STATUS.unreviewed).label;
        }

        function knowledgeReviewClass(status) {
            return (KNOWLEDGE_REVIEW_STATUS[status] || KNOWLEDGE_REVIEW_STATUS.unreviewed).className;
        }

        function knowledgeGroupReviewCounts(group = {}) {
            const counts = {
                unreviewed: 0,
                good: 0,
                normal: 0,
                bad: 0,
                rejected: 0
            };
            (group.assets || []).forEach(asset => {
                const status = knowledgeReviewStatus(asset);
                counts[status] = (counts[status] || 0) + 1;
            });
            return counts;
        }

        function knowledgeRenderReviewPill(status, text) {
            return knowledgeMakeEl(
                'span',
                `knowledge-review-pill ${knowledgeReviewClass(status)}`,
                text || knowledgeReviewLabel(status)
            );
        }

        function knowledgeAutoReview(asset = {}) {
            return asset.autoReview && typeof asset.autoReview === 'object' ? asset.autoReview : null;
        }

        function knowledgeAutoGradeConfig(grade) {
            return KNOWLEDGE_AUTO_GRADE[String(grade || '').trim()] || {
                label: grade || 'Pending',
                className: 'is-unreviewed'
            };
        }

        function knowledgeRenderAutoPill(autoReview = null, compact = false) {
            const review = autoReview || {};
            if (!review || review.status !== 'scored') {
                return knowledgeMakeEl('span', 'knowledge-auto-pill is-unreviewed', '待自动评审');
            }
            const grade = knowledgeAutoGradeConfig(review.autoGrade);
            const text = compact
                ? `${Math.round(Number(review.autoScore) || 0)} / ${knowledgeFormatPercent(review.confidence)} / ${grade.label}`
                : `评分 ${Math.round(Number(review.autoScore) || 0)} · 置信度 ${knowledgeFormatPercent(review.confidence)} · ${grade.label}`;
            const pill = knowledgeMakeEl(
                'span',
                `knowledge-auto-pill ${grade.className}${review.needsHumanReview ? ' needs-human' : ''}`,
                text
            );
            pill.title = review.needsHumanReview ? '需要人工复核' : (review.reason || '');
            return pill;
        }

        function knowledgeSetText(id, text) {
            const el = document.getElementById(id);
            if (el) el.textContent = text;
        }

        function knowledgeClear(el) {
            if (el) el.textContent = '';
        }

        function knowledgeMakeEl(tagName, className, text) {
            const el = document.createElement(tagName);
            if (className) el.className = className;
            if (text !== undefined && text !== null) el.textContent = String(text);
            return el;
        }

        function knowledgeAppendMeta(container, label, value) {
            if (!container) return;
            const item = knowledgeMakeEl('span', 'knowledge-meta-chip');
            const key = knowledgeMakeEl('strong', '', label);
            const val = document.createTextNode(String(value));
            item.appendChild(key);
            item.appendChild(val);
            container.appendChild(item);
        }

        function knowledgeFormatVisualDnaTop(items = [], dimension = '') {
            const values = Array.isArray(items) ? items : [];
            return values.length
                ? values.slice(0, 3)
                    .map(item => knowledgeDnaDisplayLabel(item.value || item.name || item, dimension))
                    .filter(Boolean)
                    .join('、')
                : '--';
        }

        function knowledgeVisualDnaLine(data = {}) {
            const summary = data.visualDnaSummary || data;
            const dna = summary.visualDna || data.visualDna || {};
            const tags = knowledgeDirectionTagValues({ ...data, visualDna: dna }, 5);
            if (tags.length) return `方向标签：${tags.join('、')}`;
            if (!Object.keys(dna || {}).length && summary.summaryText) return knowledgeDnaLocalizeText(summary.summaryText.replace(/^视觉\s*DNA\s*[:：]\s*/i, '方向标签：'));
            return '方向标签：标签待分析';
        }

        function knowledgeCandidateText(candidate = {}) {
            const tags = knowledgeDirectionTagValues(candidate, 8);
            const risks = knowledgeDirectionRiskTags(candidate, 5);
            return [
                candidate.name,
                knowledgeDnaLocalizeText(candidate.description),
                candidate.score ? `分数：${candidate.score}` : '',
                tags.length ? `方向标签：${tags.join('、')}` : '',
                candidate.scoreSummary ? `值得保留：${knowledgeDnaLocalizeText(candidate.scoreSummary)}` : '',
                candidate.dedupeReason ? `注意：${knowledgeDnaLocalizeText(candidate.dedupeReason)}` : '',
                risks.length ? `风险标签：${risks.join('、')}` : '',
                candidate.productionAdvice ? `投产建议：${knowledgeDnaLocalizeText(candidate.productionAdvice)}` : ''
            ].filter(Boolean).join('\n');
        }

        async function knowledgeCopyCandidate(candidate = {}) {
            const text = knowledgeCandidateText(candidate);
            if (!text) return;
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(text);
            } else {
                const textarea = document.createElement('textarea');
                textarea.value = text;
                textarea.style.position = 'fixed';
                textarea.style.left = '-9999px';
                document.body.appendChild(textarea);
                textarea.focus();
                textarea.select();
                document.execCommand('copy');
                textarea.remove();
            }
            if (typeof showToast === 'function') showToast('候选方向已复制', 'success');
        }

        function renderKnowledgeCandidateCard(candidate = {}) {
            const card = knowledgeMakeEl('div', `direction-candidate-card is-${candidate.status || 'selected'}`);
            const top = knowledgeMakeEl('div', 'direction-candidate-top');
            top.appendChild(knowledgeMakeEl('strong', '', knowledgeVisibleText(candidate.name, 40, '未命名候选方向')));
            top.appendChild(knowledgeMakeEl('span', '', `${candidate.status === 'rejected' ? '淘汰' : '入选'} · ${candidate.score || '--'} 分`));
            card.appendChild(top);
            card.appendChild(renderKnowledgeDirectionTagPills(knowledgeDirectionTagValues(candidate), {
                emptyText: '标签待分析'
            }));
            if (candidate.description) {
                card.appendChild(knowledgeMakeEl('p', 'direction-candidate-desc', knowledgeDnaLocalizeText(candidate.description)));
            }
            [
                ['值得保留', candidate.scoreSummary || (Array.isArray(candidate.scoreReasons) ? candidate.scoreReasons.join('、') : candidate.visualHook)],
                ['注意', candidate.dedupeReason || candidate.riskNote],
                ['投产建议', candidate.productionAdvice]
            ].forEach(([label, value]) => {
                const row = knowledgeMakeEl('div', 'direction-candidate-field');
                row.appendChild(knowledgeMakeEl('span', '', label));
                row.appendChild(knowledgeMakeEl('em', '', knowledgeDnaLocalizeText(value || '--')));
                card.appendChild(row);
            });
            const risks = knowledgeDirectionRiskTags(candidate);
            if (risks.length) {
                card.appendChild(renderKnowledgeDirectionTagPills(risks, { risk: true }));
            }
            const actions = knowledgeMakeEl('div', 'direction-candidate-actions');
            const copyBtn = knowledgeMakeEl('button', 'creative-mini-btn', '复制');
            copyBtn.type = 'button';
            copyBtn.addEventListener('click', () => knowledgeCopyCandidate(candidate).catch(error => {
                if (typeof showToast === 'function') showToast(error.message || '复制失败', 'error');
            }));
            actions.appendChild(copyBtn);
            ['送入草案', '标记优秀', '标记风险'].forEach(label => {
                const button = knowledgeMakeEl('button', 'creative-mini-btn', label);
                button.type = 'button';
                button.disabled = true;
                button.title = '第一版只读展示，后续接入写入操作';
                actions.appendChild(button);
            });
            card.appendChild(actions);
            return card;
        }

        function renderKnowledgeDirectionCandidateReview(review = null) {
            if (!review || (!Array.isArray(review.selected) && !Array.isArray(review.rejected))) return null;
            const selected = Array.isArray(review.selected) ? review.selected : [];
            const rejected = Array.isArray(review.rejected) ? review.rejected : [];
            const details = knowledgeMakeEl('details', 'direction-candidate-review');
            const summary = knowledgeMakeEl('summary', '');
            summary.appendChild(knowledgeMakeEl('strong', '', '方向候选审核记录'));
            summary.appendChild(knowledgeMakeEl('span', '', `入选 ${review.selectedCount || selected.length} 个 / 淘汰 ${review.rejectedCount || rejected.length} 个`));
            details.appendChild(summary);
            const grid = knowledgeMakeEl('div', 'direction-candidate-grid');
            selected.concat(rejected).forEach(candidate => grid.appendChild(renderKnowledgeCandidateCard(candidate)));
            if (!grid.children.length) {
                grid.appendChild(knowledgeMakeEl('div', 'knowledge-empty', '本次 run 没有记录候选方向明细'));
            }
            details.appendChild(grid);
            return details;
        }

        async function fetchKnowledgeJson(url, fallbackMessage, options) {
            const response = await fetch(url, options);
            if (typeof readJsonResponse === 'function') {
                return await readJsonResponse(response, fallbackMessage);
            }
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.message || fallbackMessage);
            }
            return data;
        }

        function buildKnowledgeQuery(inputId, extra = {}) {
            const params = new URLSearchParams();
            const keyword = document.getElementById(inputId)?.value.trim();
            if (keyword) params.set('q', keyword);
            Object.entries(extra).forEach(([key, value]) => {
                if (value !== undefined && value !== null && value !== '') {
                    params.set(key, value);
                }
            });
            const text = params.toString();
            return text ? `?${text}` : '';
        }

        function knowledgeFieldMapToText(fieldMap = {}) {
            return Object.entries(fieldMap || {})
                .map(([key, value]) => `${key}=${value || ''}`)
                .join('\n');
        }

        function knowledgeTextToFieldMap(text = '') {
            return String(text || '')
                .split(/\r?\n/)
                .map(line => line.trim())
                .filter(Boolean)
                .reduce((map, line) => {
                    const separatorIndex = line.indexOf('=');
                    if (separatorIndex < 0) return map;
                    const key = line.slice(0, separatorIndex).trim();
                    const value = line.slice(separatorIndex + 1).trim();
                    if (key) map[key] = value;
                    return map;
                }, {});
        }

        function setKnowledgeFeishuInfo(className, text) {
            const infoBox = document.getElementById('knowledgeFeishuSyncInfo');
            if (!infoBox) return;
            infoBox.className = className;
            infoBox.textContent = text;
        }

        function renderKnowledgeFeishuSourceConfig(key, source = {}) {
            const section = document.querySelector(`[data-feishu-source="${key}"]`);
            if (!section) return;
            section.querySelectorAll('[data-feishu-field]').forEach(field => {
                const fieldName = field.dataset.feishuField;
                if (field.type === 'checkbox') {
                    field.checked = source[fieldName] === true;
                } else {
                    field.value = source[fieldName] ?? '';
                }
            });
            const fieldMap = section.querySelector('[data-feishu-field-map]');
            if (fieldMap) {
                fieldMap.value = knowledgeFieldMapToText(source.fieldMap || {});
            }
        }

        function collectKnowledgeFeishuSourceConfig(key) {
            const section = document.querySelector(`[data-feishu-source="${key}"]`);
            const source = {};
            if (!section) return source;
            section.querySelectorAll('[data-feishu-field]').forEach(field => {
                const fieldName = field.dataset.feishuField;
                source[fieldName] = field.type === 'checkbox' ? field.checked : field.value.trim();
            });
            const fieldMap = section.querySelector('[data-feishu-field-map]');
            source.fieldMap = knowledgeTextToFieldMap(fieldMap ? fieldMap.value : '');
            return source;
        }

        function renderKnowledgeFeishuStatus(status = {}) {
            const syncConfig = status.config || {};
            const validation = status.validation || {};
            const cache = status.cache || {};
            const lastOperation = status.lastOperation || null;
            creativeKnowledgeState.feishuSync = status;

            knowledgeSetText('knowledgeFeishuSyncEnabled', syncConfig.enabled ? '已启用' : '未启用');
            knowledgeSetText('knowledgeFeishuSyncCache', cache.exists ? knowledgeFormatDate(cache.updatedAt) : '无缓存');
            knowledgeSetText('knowledgeFeishuSyncLastOp', lastOperation ? `${lastOperation.mode || 'sync'} / ${lastOperation.status || '--'}` : '无记录');

            const enabledInput = document.getElementById('knowledgeFeishuSyncSwitch');
            if (enabledInput) enabledInput.checked = syncConfig.enabled === true;
            const domainInput = document.getElementById('knowledgeFeishuDomain');
            if (domainInput) domainInput.value = syncConfig.domain || 'feishu';
            const appIdInput = document.getElementById('knowledgeFeishuAppId');
            if (appIdInput) appIdInput.value = syncConfig.appId || '';
            const appSecretInput = document.getElementById('knowledgeFeishuAppSecret');
            if (appSecretInput) {
                appSecretInput.value = '';
                appSecretInput.placeholder = syncConfig.appSecretConfigured ? '已配置，重新填写可覆盖' : '填写后仅保存在本机';
            }

            Object.keys(KNOWLEDGE_FEISHU_SOURCE_LABELS).forEach(key => {
                renderKnowledgeFeishuSourceConfig(key, syncConfig.sources && syncConfig.sources[key]);
            });

            const messages = validation.warnings || [];
            if (messages.length) {
                setKnowledgeFeishuInfo('info-box error', messages.join('；'));
            } else {
                setKnowledgeFeishuInfo('info-box success', cache.exists ? '飞书同步配置可用，已有本地缓存' : '飞书同步配置可用');
            }
        }

        function collectKnowledgeFeishuSyncPayload() {
            const payload = {
                enabled: document.getElementById('knowledgeFeishuSyncSwitch')?.checked === true,
                domain: document.getElementById('knowledgeFeishuDomain')?.value || 'feishu',
                appId: document.getElementById('knowledgeFeishuAppId')?.value.trim() || '',
                appSecret: document.getElementById('knowledgeFeishuAppSecret')?.value.trim() || '',
                sources: {}
            };
            Object.keys(KNOWLEDGE_FEISHU_SOURCE_LABELS).forEach(key => {
                payload.sources[key] = collectKnowledgeFeishuSourceConfig(key);
            });
            return payload;
        }

        function renderKnowledgeFeishuPreview(preview = {}, warnings = []) {
            const container = document.getElementById('knowledgeFeishuPreview');
            if (!container) return;
            knowledgeClear(container);

            Object.entries(KNOWLEDGE_FEISHU_SOURCE_LABELS).forEach(([key, label]) => {
                const stats = preview[key] || {};
                const card = knowledgeMakeEl('div', 'knowledge-feishu-preview-card');
                card.appendChild(knowledgeMakeEl('strong', '', label));
                if (stats.disabled) {
                    card.appendChild(knowledgeMakeEl('span', '', '未启用，本地数据保持不变'));
                } else {
                    card.appendChild(knowledgeMakeEl('span', '', `新增 ${Number(stats.added) || 0}`));
                    card.appendChild(knowledgeMakeEl('span', '', `更新 ${Number(stats.updated) || 0}`));
                    card.appendChild(knowledgeMakeEl('span', '', `不变 ${Number(stats.unchanged) || 0}`));
                    card.appendChild(knowledgeMakeEl('span', '', `保留本地 ${Number(stats.ignored) || 0}`));
                }
                container.appendChild(card);
            });

            if (Array.isArray(warnings) && warnings.length) {
                const warningCard = knowledgeMakeEl('div', 'knowledge-feishu-preview-card');
                warningCard.appendChild(knowledgeMakeEl('strong', '', '警告'));
                warnings.slice(0, 5).forEach(message => warningCard.appendChild(knowledgeMakeEl('span', '', message)));
                container.appendChild(warningCard);
            }
        }

        function setKnowledgeFeishuButtonsDisabled(disabled) {
            [
                'knowledgeFeishuSaveBtn',
                'knowledgeFeishuTestBtn',
                'knowledgeFeishuPreviewBtn',
                'knowledgeFeishuSyncBtn'
            ].forEach(id => {
                const button = document.getElementById(id);
                if (button) button.disabled = disabled;
            });
        }

        async function loadKnowledgeFeishuSyncStatus() {
            try {
                const data = await fetchKnowledgeJson('/api/creative-knowledge/feishu-sync/status', '读取飞书同步状态失败');
                renderKnowledgeFeishuStatus(data);
                return data;
            } catch (error) {
                setKnowledgeFeishuInfo('info-box error', error.message || '读取飞书同步状态失败');
                return null;
            }
        }

        async function saveKnowledgeFeishuSyncConfig() {
            try {
                setKnowledgeFeishuButtonsDisabled(true);
                setKnowledgeFeishuInfo('info-box loading', '正在保存飞书同步配置...');
                const data = await fetchKnowledgeJson('/api/creative-knowledge/feishu-sync/config', '保存飞书同步配置失败', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(collectKnowledgeFeishuSyncPayload())
                });
                await loadKnowledgeFeishuSyncStatus();
                setKnowledgeFeishuInfo('info-box success', data.message || '飞书同步配置已保存');
                if (typeof showToast === 'function') showToast('飞书同步配置已保存', 'success');
                return true;
            } catch (error) {
                setKnowledgeFeishuInfo('info-box error', error.message || '保存飞书同步配置失败');
                if (typeof showToast === 'function') showToast(error.message || '保存飞书同步配置失败', 'error');
                return false;
            } finally {
                setKnowledgeFeishuButtonsDisabled(false);
            }
        }

        async function testKnowledgeFeishuSync() {
            const saved = await saveKnowledgeFeishuSyncConfig();
            if (!saved) return;
            try {
                setKnowledgeFeishuButtonsDisabled(true);
                setKnowledgeFeishuInfo('info-box loading', '正在测试飞书读取...');
                const data = await fetchKnowledgeJson('/api/creative-knowledge/feishu-sync/test', '测试飞书读取失败', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({})
                });
                setKnowledgeFeishuInfo(data.success ? 'info-box success' : 'info-box error', data.message || '测试完成');
                if (typeof showToast === 'function') showToast(data.message || '测试完成', data.success ? 'success' : 'error');
            } catch (error) {
                setKnowledgeFeishuInfo('info-box error', error.message || '测试飞书读取失败');
                if (typeof showToast === 'function') showToast(error.message || '测试飞书读取失败', 'error');
            } finally {
                setKnowledgeFeishuButtonsDisabled(false);
            }
        }

        async function previewKnowledgeFeishuSync() {
            const saved = await saveKnowledgeFeishuSyncConfig();
            if (!saved) return;
            try {
                setKnowledgeFeishuButtonsDisabled(true);
                setKnowledgeFeishuInfo('info-box loading', '正在读取飞书并生成预览...');
                const data = await fetchKnowledgeJson('/api/creative-knowledge/feishu-sync/preview', '预览飞书同步失败', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({})
                });
                renderKnowledgeFeishuPreview(data.preview || {}, data.warnings || []);
                setKnowledgeFeishuInfo(data.success ? 'info-box success' : 'info-box error', data.message || '预览完成');
            } catch (error) {
                setKnowledgeFeishuInfo('info-box error', error.message || '预览飞书同步失败');
                if (typeof showToast === 'function') showToast(error.message || '预览飞书同步失败', 'error');
            } finally {
                setKnowledgeFeishuButtonsDisabled(false);
            }
        }

        async function runKnowledgeFeishuSync() {
            const confirmed = window.confirm('确认从飞书只读同步到本地知识库？本操作不会写回飞书。');
            if (!confirmed) return;
            const saved = await saveKnowledgeFeishuSyncConfig();
            if (!saved) return;
            try {
                setKnowledgeFeishuButtonsDisabled(true);
                setKnowledgeFeishuInfo('info-box loading', '正在执行飞书只读同步...');
                const data = await fetchKnowledgeJson('/api/creative-knowledge/feishu-sync/sync', '执行飞书同步失败', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({})
                });
                renderKnowledgeFeishuPreview(data.preview || {}, data.warnings || []);
                setKnowledgeFeishuInfo(data.success ? 'info-box success' : 'info-box error', data.message || '同步完成');
                await Promise.all([
                    loadKnowledgeFeishuSyncStatus(),
                    loadCreativeKnowledgePage({ silent: true })
                ]);
                if (typeof showToast === 'function') showToast(data.message || '飞书同步完成', data.success ? 'success' : 'error');
            } catch (error) {
                setKnowledgeFeishuInfo('info-box error', error.message || '执行飞书同步失败');
                if (typeof showToast === 'function') showToast(error.message || '执行飞书同步失败', 'error');
            } finally {
                setKnowledgeFeishuButtonsDisabled(false);
            }
        }

        function renderKnowledgeFeishuStatus(status = {}) {
            const syncConfig = status.config || {};
            const validation = status.validation || {};
            const cache = status.cache || {};
            const writeback = status.writeback || {};
            creativeKnowledgeState.feishuSync = status;

            knowledgeSetText('knowledgeFeishuSyncEnabled', syncConfig.enabled ? '已启用' : '未启用');
            knowledgeSetText('knowledgeFeishuSyncCache', cache.exists ? knowledgeFormatDate(cache.updatedAt) : '无读取记录');
            knowledgeSetText('knowledgeFeishuSyncLastOp', `待写回 ${writeback.pendingCount || 0} / 已写回 ${writeback.syncedCount || 0}`);

            const enabledInput = document.getElementById('knowledgeFeishuSyncSwitch');
            if (enabledInput) enabledInput.checked = syncConfig.enabled === true;
            const domainInput = document.getElementById('knowledgeFeishuDomain');
            if (domainInput) domainInput.value = syncConfig.domain || 'feishu';
            const urlInput = document.getElementById('knowledgeFeishuDirectionUrl');
            if (urlInput) urlInput.value = syncConfig.sourceUrl || '';
            const sheetIdInput = document.getElementById('knowledgeFeishuSheetId');
            if (sheetIdInput) sheetIdInput.value = syncConfig.sheetId || '';
            const appIdInput = document.getElementById('knowledgeFeishuAppId');
            if (appIdInput) appIdInput.value = syncConfig.appId || '';
            const appSecretInput = document.getElementById('knowledgeFeishuAppSecret');
            if (appSecretInput) {
                appSecretInput.value = '';
                appSecretInput.placeholder = syncConfig.appSecretConfigured ? '已配置，重新填写可替换' : '填写后只保存在本机';
            }

            const messages = validation.warnings || [];
            if (messages.length) {
                setKnowledgeFeishuInfo('info-box error', messages.join('；'));
            } else {
                setKnowledgeFeishuInfo('info-box success', cache.exists ? '飞书方向表配置可用，已有读取记录' : '飞书方向表配置可用');
            }
        }

        function collectKnowledgeFeishuSyncPayload() {
            return {
                enabled: document.getElementById('knowledgeFeishuSyncSwitch')?.checked === true,
                domain: document.getElementById('knowledgeFeishuDomain')?.value || 'feishu',
                sourceUrl: document.getElementById('knowledgeFeishuDirectionUrl')?.value.trim() || '',
                sheetId: document.getElementById('knowledgeFeishuSheetId')?.value.trim() || '',
                appId: document.getElementById('knowledgeFeishuAppId')?.value.trim() || '',
                appSecret: document.getElementById('knowledgeFeishuAppSecret')?.value.trim() || ''
            };
        }

        function renderKnowledgeFeishuPreview(preview = {}, warnings = []) {
            const container = document.getElementById('knowledgeFeishuPreview');
            if (!container) return;
            knowledgeClear(container);

            if (preview.preview) {
                const stats = preview.preview;
                const card = knowledgeMakeEl('div', 'knowledge-feishu-preview-card');
                card.appendChild(knowledgeMakeEl('strong', '', '方向表读取预览'));
                card.appendChild(knowledgeMakeEl('span', '', `读取 ${Number(stats.total) || 0} 条`));
                card.appendChild(knowledgeMakeEl('span', '', `新增 ${Number(stats.added) || 0}`));
                card.appendChild(knowledgeMakeEl('span', '', `更新 ${Number(stats.updated) || 0}`));
                card.appendChild(knowledgeMakeEl('span', '', `不变 ${Number(stats.unchanged) || 0}`));
                container.appendChild(card);

                (stats.items || []).filter(item => item.status !== 'unchanged').slice(0, 6).forEach(item => {
                    const itemCard = knowledgeMakeEl('div', 'knowledge-feishu-preview-card');
                    itemCard.appendChild(knowledgeMakeEl('strong', '', item.status === 'added' ? '新增方向' : '更新方向'));
                    itemCard.appendChild(knowledgeMakeEl('span', '', item.path || item.name || '--'));
                    if (item.rowNumber) itemCard.appendChild(knowledgeMakeEl('span', '', `飞书第 ${item.rowNumber} 行`));
                    container.appendChild(itemCard);
                });
            }

            if (Array.isArray(preview.candidates)) {
                const card = knowledgeMakeEl('div', 'knowledge-feishu-preview-card');
                card.appendChild(knowledgeMakeEl('strong', '', '写回飞书预览'));
                card.appendChild(knowledgeMakeEl('span', '', `待写回 ${Number(preview.pendingCount) || 0} 条`));
                if (Number(preview.priorityCount) > 0) {
                    card.appendChild(knowledgeMakeEl('span', '', `标签完整优先 ${Number(preview.priorityCount)} 条`));
                }
                card.appendChild(knowledgeMakeEl('span', '', '写入列：A:H'));
                card.appendChild(knowledgeMakeEl('span', '', '新行底色：黄色'));
                container.appendChild(card);
                preview.candidates.slice(0, 6).forEach(item => {
                    const itemCard = knowledgeMakeEl('div', 'knowledge-feishu-preview-card');
                    itemCard.appendChild(knowledgeMakeEl('strong', '', item.priorityWriteback ? '优先写回方向' : '待写回方向'));
                    itemCard.appendChild(knowledgeMakeEl('span', '', item.path || item.name || '--'));
                    if (item.priorityWriteback) {
                        itemCard.appendChild(knowledgeMakeEl('span', '', '已采纳 + 标签完整'));
                    }
                    container.appendChild(itemCard);
                });
            }

            if (Array.isArray(warnings) && warnings.length) {
                const warningCard = knowledgeMakeEl('div', 'knowledge-feishu-preview-card');
                warningCard.appendChild(knowledgeMakeEl('strong', '', '提示'));
                warnings.slice(0, 5).forEach(message => warningCard.appendChild(knowledgeMakeEl('span', '', message)));
                container.appendChild(warningCard);
            }
        }

        function setKnowledgeFeishuButtonsDisabled(disabled) {
            [
                'knowledgeFeishuSaveBtn',
                'knowledgeFeishuTestBtn',
                'knowledgeFeishuPreviewBtn',
                'knowledgeFeishuSyncBtn',
                'knowledgeFeishuWritebackPreviewBtn',
                'knowledgeFeishuWritebackSyncBtn',
                'knowledgeFeishuControlCardBtn'
            ].forEach(id => {
                const button = document.getElementById(id);
                if (button) button.disabled = disabled;
            });
        }

        async function loadKnowledgeFeishuSyncStatus() {
            try {
                const data = await fetchKnowledgeJson('/api/creative-knowledge/feishu-direction/status', '读取飞书方向表状态失败');
                renderKnowledgeFeishuStatus(data);
                return data;
            } catch (error) {
                setKnowledgeFeishuInfo('info-box error', error.message || '读取飞书方向表状态失败');
                return null;
            }
        }

        async function saveKnowledgeFeishuSyncConfig() {
            try {
                setKnowledgeFeishuButtonsDisabled(true);
                setKnowledgeFeishuInfo('info-box loading', '正在保存飞书方向表配置...');
                const data = await fetchKnowledgeJson('/api/creative-knowledge/feishu-direction/config', '保存飞书方向表配置失败', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(collectKnowledgeFeishuSyncPayload())
                });
                await loadKnowledgeFeishuSyncStatus();
                setKnowledgeFeishuInfo('info-box success', data.message || '飞书方向表配置已保存');
                if (typeof showToast === 'function') showToast('飞书方向表配置已保存', 'success');
                return true;
            } catch (error) {
                setKnowledgeFeishuInfo('info-box error', error.message || '保存飞书方向表配置失败');
                if (typeof showToast === 'function') showToast(error.message || '保存飞书方向表配置失败', 'error');
                return false;
            } finally {
                setKnowledgeFeishuButtonsDisabled(false);
            }
        }

        async function testKnowledgeFeishuSync() {
            const saved = await saveKnowledgeFeishuSyncConfig();
            if (!saved) return;
            try {
                setKnowledgeFeishuButtonsDisabled(true);
                setKnowledgeFeishuInfo('info-box loading', '正在测试飞书方向表读取...');
                const data = await fetchKnowledgeJson('/api/creative-knowledge/feishu-direction/test', '测试飞书方向表读取失败', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({})
                });
                setKnowledgeFeishuInfo(data.success ? 'info-box success' : 'info-box error', data.message || '测试完成');
                if (typeof showToast === 'function') showToast(data.message || '测试完成', data.success ? 'success' : 'error');
            } catch (error) {
                setKnowledgeFeishuInfo('info-box error', error.message || '测试飞书方向表读取失败');
                if (typeof showToast === 'function') showToast(error.message || '测试飞书方向表读取失败', 'error');
            } finally {
                setKnowledgeFeishuButtonsDisabled(false);
            }
        }

        async function previewKnowledgeFeishuSync() {
            const saved = await saveKnowledgeFeishuSyncConfig();
            if (!saved) return;
            try {
                setKnowledgeFeishuButtonsDisabled(true);
                setKnowledgeFeishuInfo('info-box loading', '正在读取飞书方向表并生成预览...');
                const data = await fetchKnowledgeJson('/api/creative-knowledge/feishu-direction/preview-import', '预览飞书方向表更新失败', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({})
                });
                renderKnowledgeFeishuPreview(data, data.warnings || []);
                setKnowledgeFeishuInfo(data.success ? 'info-box success' : 'info-box error', data.message || '预览完成');
            } catch (error) {
                setKnowledgeFeishuInfo('info-box error', error.message || '预览飞书方向表更新失败');
                if (typeof showToast === 'function') showToast(error.message || '预览飞书方向表更新失败', 'error');
            } finally {
                setKnowledgeFeishuButtonsDisabled(false);
            }
        }

        async function runKnowledgeFeishuSync() {
            const confirmed = window.confirm('确认把飞书方向表的新增和更新写入本地知识库？本操作不会写回飞书。');
            if (!confirmed) return;
            const saved = await saveKnowledgeFeishuSyncConfig();
            if (!saved) return;
            try {
                setKnowledgeFeishuButtonsDisabled(true);
                setKnowledgeFeishuInfo('info-box loading', '正在更新飞书方向表到本地知识库...');
                const data = await fetchKnowledgeJson('/api/creative-knowledge/feishu-direction/sync-import', '更新飞书方向表到知识库失败', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({})
                });
                renderKnowledgeFeishuPreview(data, data.warnings || []);
                setKnowledgeFeishuInfo(data.success ? 'info-box success' : 'info-box error', data.message || '更新完成');
                await Promise.all([
                    loadKnowledgeFeishuSyncStatus(),
                    loadCreativeKnowledgePage({ silent: true })
                ]);
                if (typeof showToast === 'function') showToast(data.message || '飞书方向表已更新到知识库', data.success ? 'success' : 'error');
            } catch (error) {
                setKnowledgeFeishuInfo('info-box error', error.message || '更新飞书方向表到知识库失败');
                if (typeof showToast === 'function') showToast(error.message || '更新飞书方向表到知识库失败', 'error');
            } finally {
                setKnowledgeFeishuButtonsDisabled(false);
            }
        }

        async function previewKnowledgeFeishuWriteback() {
            const saved = await saveKnowledgeFeishuSyncConfig();
            if (!saved) return;
            try {
                setKnowledgeFeishuButtonsDisabled(true);
                setKnowledgeFeishuInfo('info-box loading', '正在预览已采纳方向写回...');
                const data = await fetchKnowledgeJson('/api/creative-knowledge/feishu-direction/preview-writeback', '预览已采纳方向写回失败', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({})
                });
                renderKnowledgeFeishuPreview(data, data.warnings || []);
                setKnowledgeFeishuInfo(data.success ? 'info-box success' : 'info-box error', data.message || '写回预览完成');
            } catch (error) {
                setKnowledgeFeishuInfo('info-box error', error.message || '预览已采纳方向写回失败');
                if (typeof showToast === 'function') showToast(error.message || '预览已采纳方向写回失败', 'error');
            } finally {
                setKnowledgeFeishuButtonsDisabled(false);
            }
        }

        async function syncKnowledgeFeishuWriteback() {
            const confirmed = window.confirm('确认把已采纳的新方向写回飞书？系统会按标签位置插入新行，并只给 A:H 标黄色。');
            if (!confirmed) return;
            const saved = await saveKnowledgeFeishuSyncConfig();
            if (!saved) return;
            try {
                setKnowledgeFeishuButtonsDisabled(true);
                setKnowledgeFeishuInfo('info-box loading', '正在同步已采纳方向到飞书...');
                const data = await fetchKnowledgeJson('/api/creative-knowledge/feishu-direction/sync-writeback', '同步已采纳方向到飞书失败', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({})
                });
                setKnowledgeFeishuInfo(data.success ? 'info-box success' : 'info-box error', data.message || '写回完成');
                await loadKnowledgeFeishuSyncStatus();
                if (typeof showToast === 'function') showToast(data.message || '写回完成', data.success ? 'success' : 'error');
            } catch (error) {
                setKnowledgeFeishuInfo('info-box error', error.message || '同步已采纳方向到飞书失败');
                if (typeof showToast === 'function') showToast(error.message || '同步已采纳方向到飞书失败', 'error');
            } finally {
                setKnowledgeFeishuButtonsDisabled(false);
            }
        }

        async function sendKnowledgeFeishuControlCard() {
            try {
                setKnowledgeFeishuButtonsDisabled(true);
                setKnowledgeFeishuInfo('info-box loading', '正在发送飞书控制面板...');
                const data = await fetchKnowledgeJson('/api/feishu-cli/send-card', '发送飞书控制面板失败', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        title: 'AI图片生产远程控制台',
                        summary: '远程值班面板：状态、进度、日志、继续、停止和系统面板；重启服务器仅在无运行任务时执行。'
                    })
                });
                setKnowledgeFeishuInfo(data.success ? 'info-box success' : 'info-box error', data.message || '控制面板已发送');
                if (typeof showToast === 'function') showToast(data.message || '控制面板已发送', data.success ? 'success' : 'error');
            } catch (error) {
                setKnowledgeFeishuInfo('info-box error', error.message || '发送飞书控制面板失败');
            } finally {
                setKnowledgeFeishuButtonsDisabled(false);
            }
        }

        function renderKnowledgeOverview(data = {}) {
            const counts = data.counts || {};
            const dnaOverview = data.visualDnaOverview || {};
            const dnaCounts = dnaOverview.counts || {};
            knowledgeSetText('knowledgeDirectionCount', knowledgeFormatNumber(counts.directions));
            knowledgeSetText('knowledgeMaterialCount', knowledgeFormatNumber(counts.topMaterials));
            knowledgeSetText('knowledgeReferenceCount', knowledgeFormatNumber(counts.referenceImages));
            knowledgeSetText('knowledgeAssetCount', knowledgeFormatNumber(counts.assets));
            knowledgeSetText('knowledgeRunCount', knowledgeFormatNumber(counts.runs));
            knowledgeSetText('knowledgeSavedCount', knowledgeFormatNumber(counts.savedImages));
            knowledgeSetText('knowledgeDirectionRunCount', knowledgeFormatNumber(counts.directionsWithRuns));
            knowledgeSetText('knowledgeDirectionRefCount', knowledgeFormatNumber(counts.directionsWithReferenceImages));
            knowledgeSetText('knowledgeAssetFileCount', `${knowledgeFormatNumber(counts.assetsWithFiles)} / ${knowledgeFormatNumber(counts.assets)}`);
            knowledgeSetText(
                'knowledgeGrowthStats',
                `成功案例 ${knowledgeFormatNumber(counts.directionEvidence)} · 新方向 ${knowledgeFormatNumber(counts.acceptedDirections)} · 禁跑 ${knowledgeFormatNumber(counts.disabledDirections)}`
            );
            knowledgeSetText(
                'knowledgeReviewStats',
                `已审 ${knowledgeFormatNumber(counts.reviewedAssets)} · 好 ${knowledgeFormatNumber(counts.goodAssets)} · 坏 ${knowledgeFormatNumber((Number(counts.badAssets) || 0) + (Number(counts.rejectedAssets) || 0))}`
            );
            knowledgeSetText('knowledgeDnaCoverage', `${knowledgeFormatNumber(dnaCounts.coveredDirections)} / ${knowledgeFormatNumber(dnaCounts.totalDirections || counts.directions)}`);
            knowledgeSetText('knowledgeDnaTopAtmospheres', knowledgeFormatVisualDnaTop(dnaOverview.topAtmospheres, 'atmosphere'));
            knowledgeSetText('knowledgeDnaTopCameras', knowledgeFormatVisualDnaTop(dnaOverview.topCameras, 'camera'));
            knowledgeSetText('knowledgeDnaMissingEvent', knowledgeFormatNumber(dnaCounts.missingEventDirections));
            knowledgeSetText('knowledgeDnaMissingHook', knowledgeFormatNumber(dnaCounts.missingVisualHookDirections));
            knowledgeSetText('knowledgeImportedAt', knowledgeFormatDate(data.importedAt));
            updateKnowledgeDirectionSelectionUI();
        }

        function updateKnowledgeDirectionSelectionUI() {
            const selected = knowledgeSelectedDirections();
            const runnableSelected = selected.filter(knowledgeDirectionIsRunnable);
            const filtered = creativeKnowledgeState.filteredDirections || [];
            const selectableVisibleCount = filtered.filter(knowledgeDirectionIsRunnable).length;
            const totalDirections = creativeKnowledgeState.directionTotal || creativeKnowledgeState.directions.length || 0;
            const hint = document.getElementById('knowledgeCreativeLinkHint');
            const summary = document.getElementById('knowledgeSelectedDirectionSummary');
            const sendBtn = document.getElementById('knowledgeSendSelectedDirectionsBtn');
            const stickySendBtn = document.getElementById('knowledgeStickySendBtn');

            if (hint) {
                hint.textContent = runnableSelected.length
                    ? `已选 ${runnableSelected.length} 个方向，可送入创意拓展。`
                    : `来自知识库的 ${selectableVisibleCount || totalDirections || 0} 个可拓展方向，可筛选后送入创意拓展。`;
            }
            if (summary) {
                summary.textContent = runnableSelected.length
                    ? runnableSelected.slice(0, 4).map(direction => knowledgeDirectionLabel(direction)).join('、') + (runnableSelected.length > 4 ? ` 等 ${runnableSelected.length} 个方向` : '')
                    : '尚未选择方向。';
            }
            [sendBtn, stickySendBtn].forEach(button => {
                if (!button) return;
                button.disabled = runnableSelected.length === 0;
                button.textContent = runnableSelected.length ? `送入创意拓展（${runnableSelected.length}）` : '送入创意拓展';
            });
        }

        function buildKnowledgeTagTree(directions = []) {
            const root = new Map();

            function knowledgeDirectionOrder(direction = {}, fallback = 999999) {
                const value = Number(direction.rowNumber ?? direction.sourceSheetRow ?? direction.orderIndex);
                return Number.isFinite(value) && value > 0 ? value : fallback;
            }

            function ensureNode(children, name, order) {
                const key = name || '未分类';
                if (!children.has(key)) {
                    children.set(key, {
                        name: key,
                        order,
                        count: 0,
                        referenceCount: 0,
                        runCount: 0,
                        assetCount: 0,
                        children: new Map()
                    });
                }
                const node = children.get(key);
                node.order = Math.min(Number(node.order) || order, order);
                return node;
            }

            directions.forEach((direction, index) => {
                const stats = direction.knowledgeStats || {};
                const order = knowledgeDirectionOrder(direction, index + 1);
                const parts = String(direction.path || direction.name || '未分类')
                    .split('/')
                    .map(part => part.trim())
                    .filter(Boolean);
                if (parts.length === 0) parts.push('未分类');

                let children = root;
                parts.forEach(part => {
                    const node = ensureNode(children, part, order);
                    node.count += 1;
                    node.referenceCount += Number(stats.matchedReferenceCount) || 0;
                    node.runCount += Number(stats.runCount) || 0;
                    node.assetCount += Number(stats.assetCount) || 0;
                    children = node.children;
                });
            });

            return root;
        }

        function renderKnowledgeTagNode(node, level) {
            const item = knowledgeMakeEl('div', `knowledge-tag-node level-${Math.min(level, 3)}`);
            const row = knowledgeMakeEl('div', 'knowledge-tag-row');
            const name = knowledgeMakeEl('span', 'knowledge-tag-name', knowledgeVisibleText(node.name));
            const count = knowledgeMakeEl('span', 'knowledge-tag-count', `${node.count} 方向`);
            row.appendChild(name);
            row.appendChild(count);
            item.appendChild(row);

            const meta = knowledgeMakeEl('div', 'knowledge-tag-meta');
            knowledgeAppendMeta(meta, 'run ', node.runCount);
            knowledgeAppendMeta(meta, '资产 ', node.assetCount);
            knowledgeAppendMeta(meta, '参考 ', node.referenceCount);
            item.appendChild(meta);

            const children = Array.from(node.children.values())
                .sort((a, b) => Number(a.order) - Number(b.order));
            children.forEach(child => item.appendChild(renderKnowledgeTagNode(child, level + 1)));
            return item;
        }

        function renderKnowledgeTagMap(directions = []) {
            const container = document.getElementById('knowledgeTagMap');
            if (!container) return;
            knowledgeClear(container);

            if (!directions.length) {
                container.appendChild(knowledgeMakeEl('div', 'knowledge-empty', '暂无方向数据。导入方向表或从创意拓展沉淀方向后，这里会显示方向分布。'));
                return;
            }

            const tree = buildKnowledgeTagTree(directions);
            const primaryGroups = Array.from(tree.values())
                .sort((a, b) => Number(a.order) - Number(b.order));

            const overview = knowledgeMakeEl('div', 'knowledge-tag-overview');
            const totals = primaryGroups.reduce((sum, node) => ({
                directions: sum.directions + (Number(node.count) || 0),
                assets: sum.assets + (Number(node.assetCount) || 0),
                references: sum.references + (Number(node.referenceCount) || 0),
                runs: sum.runs + (Number(node.runCount) || 0)
            }), { directions: 0, assets: 0, references: 0, runs: 0 });
            [
                ['一级分组', primaryGroups.length],
                ['方向', totals.directions],
                ['资产', totals.assets],
                ['参考图', totals.references],
                ['运行', totals.runs]
            ].forEach(([label, value]) => {
                const item = knowledgeMakeEl('div', 'knowledge-tag-overview-item');
                item.appendChild(knowledgeMakeEl('strong', '', knowledgeFormatNumber(value)));
                item.appendChild(knowledgeMakeEl('span', '', label));
                overview.appendChild(item);
            });
            container.appendChild(overview);

            const board = knowledgeMakeEl('div', 'knowledge-tag-board');
            primaryGroups.forEach(node => {
                const card = knowledgeMakeEl('section', 'knowledge-tag-group-card');
                const head = knowledgeMakeEl('div', 'knowledge-tag-group-head');
                const title = knowledgeMakeEl('div', 'knowledge-tag-group-title');
                title.appendChild(knowledgeMakeEl('em', 'knowledge-tag-level-label', '一级分组'));
                title.appendChild(knowledgeMakeEl('strong', '', knowledgeVisibleText(node.name)));
                title.appendChild(knowledgeMakeEl('span', '', `${knowledgeFormatNumber(node.count)} 个方向`));
                head.appendChild(title);
                const meta = knowledgeMakeEl('div', 'knowledge-meta-row');
                knowledgeAppendMeta(meta, '资产 ', node.assetCount);
                knowledgeAppendMeta(meta, '参考图 ', node.referenceCount);
                knowledgeAppendMeta(meta, '运行 ', node.runCount);
                head.appendChild(meta);
                card.appendChild(head);

                const branches = Array.from(node.children.values())
                    .sort((a, b) => Number(a.order) - Number(b.order));
                const maxActivity = Math.max(1, ...branches.map(branch => (
                    (Number(branch.assetCount) || 0) +
                    (Number(branch.referenceCount) || 0) +
                    (Number(branch.runCount) || 0)
                )));
                if (!branches.length) {
                    card.appendChild(knowledgeMakeEl('div', 'knowledge-empty', '该分组下暂无二级方向。'));
                } else {
                    const branchGrid = knowledgeMakeEl('div', 'knowledge-tag-branch-grid');
                    branches.slice(0, 8).forEach(branch => {
                        const branchRow = knowledgeMakeEl('div', 'knowledge-tag-branch-row');
                        const activity = (
                            (Number(branch.assetCount) || 0) +
                            (Number(branch.referenceCount) || 0) +
                            (Number(branch.runCount) || 0)
                        );
                        branchRow.style.setProperty('--tag-activity', `${Math.max(8, Math.round(activity / maxActivity * 100))}%`);
                        const branchTitle = knowledgeMakeEl('div', 'knowledge-tag-branch-title');
                        branchTitle.appendChild(knowledgeMakeEl('em', 'knowledge-tag-level-label', '二级方向'));
                        branchTitle.appendChild(knowledgeMakeEl('strong', '', knowledgeVisibleText(branch.name)));
                        branchTitle.appendChild(knowledgeMakeEl('span', '', `${knowledgeFormatNumber(branch.count)} 方向`));
                        branchRow.appendChild(branchTitle);

                        const childNames = Array.from(branch.children.values())
                            .sort((a, b) => Number(a.order) - Number(b.order))
                            .slice(0, 6)
                            .map(child => knowledgeVisibleText(child.name));
                        const childWrap = knowledgeMakeEl('div', 'knowledge-tag-child-chips');
                        if (childNames.length) {
                            childNames.forEach(name => childWrap.appendChild(knowledgeMakeEl('span', 'knowledge-tag-chip', name)));
                        } else {
                            childWrap.appendChild(knowledgeMakeEl('span', 'knowledge-tag-chip is-empty', '暂无下级标签'));
                        }
                        branchRow.appendChild(childWrap);

                        const branchMeta = knowledgeMakeEl('div', 'knowledge-tag-count-stack');
                        [
                            ['资产', branch.assetCount],
                            ['参考图', branch.referenceCount],
                            ['运行', branch.runCount]
                        ].forEach(([label, value]) => {
                            const item = knowledgeMakeEl('span', '');
                            item.appendChild(knowledgeMakeEl('strong', '', knowledgeFormatNumber(value)));
                            item.appendChild(document.createTextNode(label));
                            branchMeta.appendChild(item);
                        });
                        branchRow.appendChild(branchMeta);
                        branchGrid.appendChild(branchRow);
                    });
                    if (branches.length > 8) {
                        const more = knowledgeMakeEl('div', 'knowledge-tag-more', `还有 ${branches.length - 8} 个二级分组，可通过方向库搜索查看。`);
                        branchGrid.appendChild(more);
                    }
                    card.appendChild(branchGrid);
                }
                board.appendChild(card);
            });
            container.appendChild(board);
        }

        const KNOWLEDGE_REFERENCE_SLOTS = [
            { slot: 1, label: '主视觉锚点', roleTag: 'primary', useFor: 'main_visual_anchor' },
            { slot: 2, label: '差异参考', roleTag: 'secondary', useFor: 'variation_reference' },
            { slot: 3, label: '细节参考', roleTag: 'detail', useFor: 'detail_reference' }
        ];

        function knowledgeReferenceInSlot(direction = {}, slot) {
            return (Array.isArray(direction.referencePool) ? direction.referencePool : [])
                .find(reference => Number(reference.slot) === Number(slot) && reference.status === 'active') || null;
        }

        function knowledgeReferenceImage(reference = {}) {
            if (!reference || !reference.imageUrl) return null;
            const img = document.createElement('img');
            img.src = reference.imageUrl;
            img.alt = reference.fileName || `slot ${reference.slot || ''}`;
            img.loading = 'lazy';
            return img;
        }

        function knowledgeReferenceNotesPrompt(reference = {}, fallback = '') {
            return window.prompt('参考图备注', reference.visualNotes || fallback || '') || '';
        }

        async function knowledgeUploadReferenceFile(directionId, slot, file, extra = {}) {
            const form = new FormData();
            form.append('referenceImage', file);
            form.append('slot', String(slot));
            form.append('roleTag', extra.roleTag || '');
            form.append('useFor', extra.useFor || '');
            form.append('visualNotes', extra.visualNotes || '');
            const data = await fetchKnowledgeJson(`/api/creative-knowledge/directions/${encodeURIComponent(directionId)}/references`, '上传参考图失败', {
                method: 'POST',
                body: form
            });
            await Promise.all([loadCreativeKnowledgeDirections(), loadCreativeKnowledgePage({ silent: true })]);
            if (typeof showToast === 'function') showToast(data.message || '参考图已上传', 'success');
            return data;
        }

        async function knowledgeReplaceReferenceFile(reference, file, extra = {}) {
            const form = new FormData();
            form.append('referenceImage', file);
            form.append('roleTag', extra.roleTag || reference.roleTag || '');
            form.append('useFor', extra.useFor || reference.useFor || '');
            form.append('visualNotes', extra.visualNotes !== undefined ? extra.visualNotes : (reference.visualNotes || ''));
            const data = await fetchKnowledgeJson(`/api/creative-knowledge/references/${encodeURIComponent(reference.id)}/replace`, '替换参考图失败', {
                method: 'POST',
                body: form
            });
            await Promise.all([loadCreativeKnowledgeDirections(), loadCreativeKnowledgePage({ silent: true })]);
            if (typeof showToast === 'function') showToast(data.message || '参考图已替换', 'success');
            return data;
        }

        function knowledgeOpenReplaceCompare(reference, file) {
            return new Promise(resolve => {
                const objectUrl = URL.createObjectURL(file);
                const overlay = knowledgeMakeEl('div', 'knowledge-reference-replace-overlay');
                const modal = knowledgeMakeEl('div', 'knowledge-reference-replace-modal');
                const title = knowledgeMakeEl('div', 'knowledge-reference-replace-title');
                title.appendChild(knowledgeMakeEl('strong', '', '替换参考图'));
                title.appendChild(knowledgeMakeEl('span', '', '旧图会自动归档，不会删除'));
                const compare = knowledgeMakeEl('div', 'knowledge-reference-compare');
                const oldBox = knowledgeMakeEl('div', 'knowledge-reference-compare-box');
                oldBox.appendChild(knowledgeMakeEl('span', '', '旧图'));
                const oldImg = knowledgeReferenceImage(reference);
                if (oldImg) oldBox.appendChild(oldImg);
                const newBox = knowledgeMakeEl('div', 'knowledge-reference-compare-box');
                newBox.appendChild(knowledgeMakeEl('span', '', '新图'));
                const newImg = document.createElement('img');
                newImg.src = objectUrl;
                newImg.alt = file.name || 'new reference';
                newBox.appendChild(newImg);
                compare.appendChild(oldBox);
                compare.appendChild(newBox);
                const actions = knowledgeMakeEl('div', 'knowledge-reference-modal-actions');
                const cancelBtn = knowledgeMakeEl('button', 'btn btn-secondary', '取消');
                const confirmBtn = knowledgeMakeEl('button', 'btn btn-primary', '确认替换');
                const cleanup = value => {
                    URL.revokeObjectURL(objectUrl);
                    overlay.remove();
                    resolve(value);
                };
                cancelBtn.type = 'button';
                confirmBtn.type = 'button';
                cancelBtn.addEventListener('click', () => cleanup(false));
                confirmBtn.addEventListener('click', () => cleanup(true));
                actions.appendChild(cancelBtn);
                actions.appendChild(confirmBtn);
                modal.appendChild(title);
                modal.appendChild(compare);
                modal.appendChild(actions);
                overlay.appendChild(modal);
                document.body.appendChild(overlay);
            });
        }

        function knowledgeOpenReferencePreview(reference = {}) {
            if (!reference.imageUrl) return;
            const overlay = knowledgeMakeEl('div', 'knowledge-reference-preview-overlay');
            const modal = knowledgeMakeEl('div', 'knowledge-reference-preview-modal');
            const head = knowledgeMakeEl('div', 'knowledge-reference-preview-head');
            head.appendChild(knowledgeMakeEl('strong', '', reference.fileName || `参考图 ${reference.slot || ''}`));
            const closeBtn = knowledgeMakeEl('button', 'knowledge-reference-preview-close', '×');
            closeBtn.type = 'button';
            closeBtn.setAttribute('aria-label', '关闭预览');
            head.appendChild(closeBtn);
            const img = document.createElement('img');
            img.src = reference.imageUrl;
            img.alt = reference.fileName || `参考图 ${reference.slot || ''}`;
            const close = () => overlay.remove();
            closeBtn.addEventListener('click', close);
            overlay.addEventListener('click', event => {
                if (event.target === overlay) close();
            });
            modal.appendChild(head);
            modal.appendChild(img);
            overlay.appendChild(modal);
            document.body.appendChild(overlay);
        }

        async function knowledgeRemoveReferenceFromSlot(reference = {}) {
            if (!reference.id) return;
            const data = await fetchKnowledgeJson(`/api/creative-knowledge/references/${encodeURIComponent(reference.id)}/archive`, '移除参考图失败', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reason: 'Removed from active reference pool.' })
            });
            await Promise.all([loadCreativeKnowledgeDirections(), loadCreativeKnowledgePage({ silent: true })]);
            if (typeof showToast === 'function') showToast(data.message || '参考图已移除，可重新上传', 'success');
        }

        async function knowledgeArchiveReference(referenceId) {
            const reason = window.prompt('归档原因（可留空）', '') || '';
            const data = await fetchKnowledgeJson(`/api/creative-knowledge/references/${encodeURIComponent(referenceId)}/archive`, '归档参考图失败', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reason })
            });
            await Promise.all([loadCreativeKnowledgeDirections(), loadCreativeKnowledgePage({ silent: true })]);
            if (typeof showToast === 'function') showToast(data.message || '参考图已归档', 'success');
        }

        async function knowledgeRejectReference(referenceId) {
            const reason = window.prompt('标记不适合的原因', '') || '';
            const data = await fetchKnowledgeJson(`/api/creative-knowledge/references/${encodeURIComponent(referenceId)}/reject`, '标记不适合失败', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reason })
            });
            await Promise.all([loadCreativeKnowledgeDirections(), loadCreativeKnowledgePage({ silent: true })]);
            if (typeof showToast === 'function') showToast(data.message || '参考图已标记不适合', 'success');
        }

        async function knowledgeDeleteReference(referenceId) {
            const previewResponse = await fetch(`/api/creative-knowledge/references/${encodeURIComponent(referenceId)}`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ confirm: false })
            });
            const preview = await previewResponse.json();
            const impact = preview.impact || {};
            const ok = window.confirm(`永久删除参考图？\n影响范围：${impact.promptContext || '将保留 deleted 元数据'}\n${impact.metadata || ''}`);
            if (!ok) return;
            const reason = window.prompt('永久删除原因（可留空）', '') || '';
            const data = await fetchKnowledgeJson(`/api/creative-knowledge/references/${encodeURIComponent(referenceId)}`, '永久删除参考图失败', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ confirm: true, reason })
            });
            await Promise.all([loadCreativeKnowledgeDirections(), loadCreativeKnowledgePage({ silent: true })]);
            if (typeof showToast === 'function') showToast(data.message || '参考图已删除', 'success');
        }

        async function knowledgeSetPrimaryReference(directionId, referenceId) {
            const data = await fetchKnowledgeJson(`/api/creative-knowledge/directions/${encodeURIComponent(directionId)}/references/reorder`, '设为主参考失败', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ referenceId, slot: 1 })
            });
            await Promise.all([loadCreativeKnowledgeDirections(), loadCreativeKnowledgePage({ silent: true })]);
            if (typeof showToast === 'function') showToast(data.message || '已设为主参考', 'success');
        }

        function renderKnowledgeReferencePool(direction = {}) {
            const pool = knowledgeMakeEl('div', 'knowledge-reference-pool');
            const slots = knowledgeMakeEl('div', 'knowledge-reference-slot-grid');
            KNOWLEDGE_REFERENCE_SLOTS.forEach(slotConfig => {
                const reference = knowledgeReferenceInSlot(direction, slotConfig.slot);
                const slot = knowledgeMakeEl('div', `knowledge-reference-slot${reference ? ' has-image' : ' is-empty'}`);
                const top = knowledgeMakeEl('div', 'knowledge-reference-slot-top');
                top.appendChild(knowledgeMakeEl('strong', '', `参考图 ${slotConfig.slot}`));
                top.appendChild(knowledgeMakeEl('span', '', slotConfig.label));
                slot.appendChild(top);

                const fileInput = document.createElement('input');
                fileInput.type = 'file';
                fileInput.accept = '.jpg,.jpeg,.png,.webp,.gif,image/*';
                fileInput.className = 'knowledge-reference-file-input';
                const handleReferenceFile = async file => {
                    if (!file) return;
                    try {
                        if (reference) {
                            const ok = await knowledgeOpenReplaceCompare(reference, file);
                            if (!ok) return;
                            await knowledgeReplaceReferenceFile(reference, file, {
                                visualNotes: reference.visualNotes || ''
                            });
                        } else {
                            await knowledgeUploadReferenceFile(direction.id, slotConfig.slot, file, {
                                roleTag: slotConfig.roleTag,
                                useFor: slotConfig.useFor,
                                visualNotes: ''
                            });
                        }
                    } catch (error) {
                        setKnowledgeInfo('info-box error', error.message || '参考图操作失败');
                    } finally {
                        fileInput.value = '';
                    }
                };
                fileInput.addEventListener('change', async () => {
                    const file = fileInput.files && fileInput.files[0];
                    await handleReferenceFile(file);
                });
                slot.appendChild(fileInput);

                const media = knowledgeMakeEl('div', 'knowledge-reference-media');
                const getDroppedImageFile = event => Array.from(event.dataTransfer?.files || [])
                    .find(file => file && (
                        String(file.type || '').startsWith('image/') ||
                        /\.(jpe?g|png|webp|gif)$/i.test(file.name || '')
                    ));
                media.addEventListener('dragenter', event => {
                    if (!event.dataTransfer || !Array.from(event.dataTransfer.types || []).includes('Files')) return;
                    event.preventDefault();
                    media.classList.add('is-drag-over');
                });
                media.addEventListener('dragover', event => {
                    if (!event.dataTransfer || !Array.from(event.dataTransfer.types || []).includes('Files')) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'copy';
                    media.classList.add('is-drag-over');
                });
                media.addEventListener('dragleave', event => {
                    if (!event.relatedTarget || !media.contains(event.relatedTarget)) {
                        media.classList.remove('is-drag-over');
                    }
                });
                media.addEventListener('drop', async event => {
                    event.preventDefault();
                    media.classList.remove('is-drag-over');
                    const file = getDroppedImageFile(event);
                    if (!file) {
                        setKnowledgeInfo('info-box error', '请拖入 jpg、png、webp 或 gif 图片。');
                        return;
                    }
                    await handleReferenceFile(file);
                });
                if (reference) {
                    const img = knowledgeReferenceImage(reference);
                    if (img) media.appendChild(img);
                    media.title = '双击放大，悬浮可删除，拖拽图片可替换';
                    media.addEventListener('dblclick', () => knowledgeOpenReferencePreview(reference));

                    const deleteBtn = knowledgeMakeEl('button', 'knowledge-reference-delete-button', '×');
                    deleteBtn.type = 'button';
                    deleteBtn.setAttribute('aria-label', '删除参考图');
                    deleteBtn.title = '删除参考图';
                    deleteBtn.addEventListener('click', event => {
                        event.stopPropagation();
                        knowledgeRemoveReferenceFromSlot(reference).catch(error => setKnowledgeInfo('info-box error', error.message || '移除参考图失败'));
                    });
                    media.appendChild(deleteBtn);

                    const replaceBtn = knowledgeMakeEl('button', 'knowledge-reference-replace-chip', '替换');
                    replaceBtn.type = 'button';
                    replaceBtn.addEventListener('click', event => {
                        event.stopPropagation();
                        fileInput.click();
                    });
                    media.appendChild(replaceBtn);
                } else {
                    media.classList.add('is-upload-target');
                    media.tabIndex = 0;
                    media.setAttribute('role', 'button');
                    media.setAttribute('aria-label', `上传${slotConfig.label}`);
                    media.appendChild(knowledgeMakeEl('strong', '', '+'));
                    media.appendChild(knowledgeMakeEl('span', '', '点击或拖拽上传'));
                    media.addEventListener('click', () => fileInput.click());
                    media.addEventListener('keydown', event => {
                        if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            fileInput.click();
                        }
                    });
                }
                slot.appendChild(media);
                slots.appendChild(slot);
            });
            pool.appendChild(slots);
            return pool;
        }

        function knowledgeDirectionTagStatus(direction = {}) {
            const summary = direction.directionTagSummary || {};
            const status = direction.tagReferenceStatus || {};
            const count = Number(summary.referenceImageCount) ||
                Number(direction.knowledgeStats && direction.knowledgeStats.activeReferenceCount) ||
                Number(direction.knowledgeStats && direction.knowledgeStats.matchedReferenceCount) ||
                0;
            const analyzed = Boolean(summary.analysis && (summary.analysis.source === 'reference-vision' || summary.analysis.source === 'manual'));
            if (summary.referenceImageStatus || status.status) {
                return {
                    status: summary.referenceImageStatus || status.status,
                    label: summary.referenceImageStatusLabel || status.label || `${count} 图`,
                    message: summary.referenceImageMessage || status.message || (analyzed ? '已分析' : '待分析'),
                    count,
                    confidence: Number(summary.confidence) || 0,
                    analyzed,
                    needsMoreReferences: summary.needsMoreReferences === true || status.needsMoreReferences === true
                };
            }
            if (count <= 0) return { status: 'missing', label: '0 图', message: '待补参考图', count, confidence: 0, analyzed: false, needsMoreReferences: true };
            if (count < 3) return { status: 'insufficient', label: `${count} 图`, message: analyzed ? '已分析，建议补图' : '参考图偏少', count, confidence: Number(summary.confidence) || 0, analyzed, needsMoreReferences: true };
            return { status: analyzed ? 'analyzed' : 'ready', label: `${count} 图`, message: analyzed ? '已分析' : '可分析', count, confidence: Number(summary.confidence) || 0, analyzed, needsMoreReferences: false };
        }

        function renderKnowledgeDirectionTagStatus(direction = {}) {
            const state = knowledgeDirectionTagStatus(direction);
            const row = knowledgeMakeEl('div', `knowledge-direction-tag-state is-${String(state.status || 'ready').replace(/[^a-z0-9-]/gi, '')}`);
            row.appendChild(knowledgeMakeEl('span', 'knowledge-direction-tag-state-count', state.label || `${state.count || 0} 图`));
            row.appendChild(knowledgeMakeEl('span', 'knowledge-direction-tag-state-text', state.message || '待分析'));
            if (state.confidence) row.appendChild(knowledgeMakeEl('span', 'knowledge-direction-tag-state-score', `可信度 ${Math.round(state.confidence * 100)}%`));
            return row;
        }

        async function knowledgeAnalyzeDirectionTags(direction = {}, force = false) {
            const id = knowledgeDirectionSelectionId(direction);
            if (!id) return;
            const label = force ? '重新分析参考图' : '分析方向标签';
            try {
                setKnowledgeInfo('info-box loading', `${label}中...`);
                const data = await fetchKnowledgeJson(
                    `/api/creative-knowledge/directions/${encodeURIComponent(id)}/tags/${force ? 'reanalyze' : 'analyze'}`,
                    `${label}失败`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({})
                    }
                );
                await loadCreativeKnowledgeDirections();
                setKnowledgeInfo('info-box success', data.message || `${label}完成`);
                if (typeof showToast === 'function') showToast(data.message || `${label}完成`, 'success');
            } catch (error) {
                setKnowledgeInfo('info-box error', error.message || `${label}失败`);
                if (typeof showToast === 'function') showToast(error.message || `${label}失败`, 'error');
            }
        }

        async function knowledgeBatchAnalyzeDirectionTags() {
            const button = document.getElementById('knowledgeBatchAnalyzeTagsBtn');
            try {
                if (button) button.disabled = true;
                setKnowledgeInfo('info-box loading', '正在批量补齐方向标签...');
                const data = await fetchKnowledgeJson('/api/creative-knowledge/direction-tags/batch-analyze', '批量补齐方向标签失败', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ limit: 12 })
                });
                await Promise.all([
                    loadCreativeKnowledgeDirections(),
                    loadCreativeKnowledgePage({ silent: true }).catch(() => null)
                ]);
                const message = data.message || `批量补齐完成：分析 ${data.analyzed || 0} 个方向`;
                setKnowledgeInfo(data.failed ? 'info-box error' : 'info-box success', message);
                if (typeof showToast === 'function') showToast(message, data.failed ? 'error' : 'success');
            } catch (error) {
                setKnowledgeInfo('info-box error', error.message || '批量补齐方向标签失败');
                if (typeof showToast === 'function') showToast(error.message || '批量补齐方向标签失败', 'error');
            } finally {
                if (button) button.disabled = false;
            }
        }

        function knowledgeTagsToInput(tags = []) {
            return knowledgeUniqueTags(tags, 12).join('、');
        }

        function openKnowledgeDirectionTagEditor(direction = {}) {
            const id = knowledgeDirectionSelectionId(direction);
            if (!id) return;
            const summary = direction.directionTagSummary || {};
            const overlay = knowledgeMakeEl('div', 'knowledge-tag-editor-overlay');
            const modal = knowledgeMakeEl('div', 'knowledge-tag-editor-modal');
            const head = knowledgeMakeEl('div', 'knowledge-tag-editor-head');
            head.appendChild(knowledgeMakeEl('strong', '', '手动覆盖方向标签'));
            head.appendChild(knowledgeMakeEl('span', '', knowledgeVisibleText(direction.path || direction.name, 72, '未命名方向')));
            const closeBtn = knowledgeMakeEl('button', 'knowledge-reference-preview-close', '×');
            head.appendChild(closeBtn);
            modal.appendChild(head);

            [
                { key: 'mainTags', label: '主标签', value: knowledgeTagsToInput(summary.mainTags || knowledgeDirectionTagValues(direction, 5)) },
                { key: 'extraTags', label: '扩展标签', value: knowledgeTagsToInput(summary.extraTags || []) },
                { key: 'riskTags', label: '风险标签', value: knowledgeTagsToInput(summary.riskTags || knowledgeDirectionRiskTags(direction, 5)) },
                { key: 'summary', label: '摘要', value: summary.summary || '' }
            ].forEach(field => {
                const group = knowledgeMakeEl('label', 'knowledge-tag-editor-field');
                group.appendChild(knowledgeMakeEl('span', '', field.label));
                const input = field.key === 'summary' ? document.createElement('textarea') : document.createElement('input');
                input.value = field.value || '';
                input.dataset.tagField = field.key;
                input.placeholder = field.key === 'summary' ? '一句话说明这个方向的画面重点' : '用顿号分隔，保持短中文标签';
                group.appendChild(input);
                modal.appendChild(group);
            });

            const footer = knowledgeMakeEl('div', 'knowledge-reference-modal-actions');
            const cancel = knowledgeMakeEl('button', 'btn btn-secondary', '取消');
            const save = knowledgeMakeEl('button', 'btn btn-primary', '保存覆盖');
            footer.appendChild(cancel);
            footer.appendChild(save);
            modal.appendChild(footer);
            overlay.appendChild(modal);
            document.body.appendChild(overlay);

            const close = () => overlay.remove();
            closeBtn.addEventListener('click', close);
            cancel.addEventListener('click', close);
            overlay.addEventListener('click', event => {
                if (event.target === overlay) close();
            });
            save.addEventListener('click', async () => {
                const value = key => modal.querySelector(`[data-tag-field="${key}"]`)?.value || '';
                const payload = {
                    mainTags: knowledgeSplitDirectionTags(value('mainTags')).slice(0, 5),
                    extraTags: knowledgeSplitDirectionTags(value('extraTags')).slice(0, 8),
                    riskTags: knowledgeSplitDirectionTags(value('riskTags')).slice(0, 6),
                    summary: value('summary').trim()
                };
                try {
                    save.disabled = true;
                    setKnowledgeInfo('info-box loading', '正在保存方向标签...');
                    const data = await fetchKnowledgeJson(
                        `/api/creative-knowledge/directions/${encodeURIComponent(id)}/tags/manual`,
                        '保存方向标签失败',
                        {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(payload)
                        }
                    );
                    close();
                    await loadCreativeKnowledgeDirections();
                    setKnowledgeInfo('info-box success', data.message || '方向标签已保存');
                    if (typeof showToast === 'function') showToast(data.message || '方向标签已保存', 'success');
                } catch (error) {
                    save.disabled = false;
                    setKnowledgeInfo('info-box error', error.message || '保存方向标签失败');
                    if (typeof showToast === 'function') showToast(error.message || '保存方向标签失败', 'error');
                }
            });
        }

        function renderKnowledgeDirections(directions = [], total = directions.length) {
            const container = document.getElementById('knowledgeDirectionList');
            const meta = document.getElementById('knowledgeDirectionMeta');
            if (!container) return;
            knowledgeClear(container);
            creativeKnowledgeState.filteredDirections = directions;
            if (meta) {
                const selectedCount = knowledgeSelectedDirections().length;
                meta.textContent = `显示 ${directions.length} / ${total} 个方向 · 已选 ${selectedCount} 个 · 可送入 ${directions.filter(knowledgeDirectionIsRunnable).length} 个`;
            }
            updateKnowledgeDirectionSelectionUI();

            if (!directions.length) {
                container.appendChild(knowledgeMakeEl('div', 'knowledge-empty', '当前筛选下没有方向。调整来源、状态或表现筛选后再选择。'));
                return;
            }

            directions.forEach(direction => {
                const stats = direction.knowledgeStats || {};
                const directionId = knowledgeDirectionSelectionId(direction);
                const runnable = knowledgeDirectionIsRunnable(direction);
                const selected = creativeKnowledgeState.selectedDirectionIds.has(directionId);
                const item = knowledgeMakeEl('div', `knowledge-direction-item${selected ? ' is-selected' : ''}${runnable ? '' : ' is-disabled'}`);
                item.dataset.directionId = directionId;
                const title = knowledgeMakeEl('div', 'knowledge-direction-title');
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.className = 'knowledge-direction-checkbox';
                checkbox.checked = selected;
                checkbox.disabled = !directionId || !runnable;
                checkbox.setAttribute('aria-label', `选择方向：${knowledgeDirectionLabel(direction)}`);
                checkbox.addEventListener('change', () => toggleKnowledgeDirectionSelection(directionId, checkbox.checked));
                title.appendChild(checkbox);
                title.appendChild(knowledgeMakeEl('strong', '', knowledgeVisibleText(direction.path || direction.name, 72, '未命名方向')));
                const directionStatus = knowledgeDirectionStatus(direction);
                title.appendChild(knowledgeDirectionStatusPill(directionStatus));
                item.appendChild(title);

                item.appendChild(knowledgeMakeEl(
                    'div',
                    'knowledge-direction-desc',
                    knowledgeVisibleText(direction.description, 120, '无描述')
                ));

                const tagPanel = knowledgeMakeEl('div', 'knowledge-direction-tags');
                tagPanel.appendChild(knowledgeMakeEl('strong', '', '方向标签'));
                tagPanel.appendChild(renderKnowledgeDirectionTagPills(knowledgeDirectionTagValues(direction), {
                    compact: true,
                    emptyText: '标签待分析'
                }));
                item.appendChild(tagPanel);
                item.appendChild(renderKnowledgeReferencePool(direction));

                const metaRow = knowledgeMakeEl('div', 'knowledge-meta-row');
                knowledgeAppendMeta(metaRow, '来源 ', knowledgeDirectionSourceLabel(direction.source));
                knowledgeAppendMeta(metaRow, '参考图 ', (Number(stats.activeReferenceCount) || Number(stats.matchedReferenceCount) || 0));
                knowledgeAppendMeta(metaRow, '运行 ', Number(stats.runCount) || 0);
                knowledgeAppendMeta(metaRow, '资产 ', Number(stats.assetCount) || 0);
                knowledgeAppendMeta(metaRow, '成功案例 ', Number(direction.evidenceCount || (direction.evidenceStats && direction.evidenceStats.successCaseCount)) || 0);
                knowledgeAppendMeta(metaRow, '提示词 ', Number(direction.stats && direction.stats.promptCount) || 0);
                item.appendChild(metaRow);

                const actions = knowledgeMakeEl('div', 'knowledge-item-actions');
                if (runnable) {
                    const selectBtn = knowledgeMakeEl('button', 'btn btn-secondary', selected ? '取消选择' : '选择方向');
                    selectBtn.type = 'button';
                    selectBtn.addEventListener('click', () => toggleKnowledgeDirectionSelection(directionId, !selected));
                    actions.appendChild(selectBtn);
                }
                const analyzeBtn = knowledgeMakeEl('button', 'btn btn-secondary', '分析方向标签');
                analyzeBtn.type = 'button';
                analyzeBtn.addEventListener('click', () => knowledgeAnalyzeDirectionTags(direction, false));
                actions.appendChild(analyzeBtn);

                const reanalyzeBtn = knowledgeMakeEl('button', 'btn btn-secondary', '重新分析参考图');
                reanalyzeBtn.type = 'button';
                reanalyzeBtn.addEventListener('click', () => knowledgeAnalyzeDirectionTags(direction, true));
                actions.appendChild(reanalyzeBtn);

                const manualTagBtn = knowledgeMakeEl('button', 'btn btn-secondary', '手动覆盖');
                manualTagBtn.type = 'button';
                manualTagBtn.addEventListener('click', () => openKnowledgeDirectionTagEditor(direction));
                actions.appendChild(manualTagBtn);

                if (knowledgeDirectionStatus(direction) === 'disabled') {
                    const enableBtn = knowledgeMakeEl('button', 'btn btn-secondary', '恢复可跑');
                    enableBtn.type = 'button';
                    enableBtn.addEventListener('click', () => updateKnowledgeDirectionStatus(direction.id, direction.source === 'agent' ? 'accepted' : 'seed'));
                    actions.appendChild(enableBtn);
                } else if (knowledgeDirectionStatus(direction) !== 'archived') {
                    const disableBtn = knowledgeMakeEl('button', 'btn btn-secondary', '禁跑');
                    disableBtn.type = 'button';
                    disableBtn.addEventListener('click', () => updateKnowledgeDirectionStatus(direction.id, 'disabled'));
                    actions.appendChild(disableBtn);
                }
                if (knowledgeDirectionStatus(direction) !== 'archived') {
                    const archiveBtn = knowledgeMakeEl('button', 'btn btn-secondary', '归档');
                    archiveBtn.type = 'button';
                    archiveBtn.addEventListener('click', () => updateKnowledgeDirectionStatus(direction.id, 'archived'));
                    actions.appendChild(archiveBtn);

                    const mergeBtn = knowledgeMakeEl('button', 'btn btn-secondary', '合并');
                    mergeBtn.type = 'button';
                    mergeBtn.addEventListener('click', () => mergeKnowledgeDirection(direction.id));
                    actions.appendChild(mergeBtn);
                }
                if (actions.children.length) {
                    item.appendChild(actions);
                }

                container.appendChild(item);
            });
        }

        function renderKnowledgeDirectionListFromState() {
            const filtered = knowledgeFilteredDirections();
            renderKnowledgeTagMap(filtered);
            renderKnowledgeDirections(filtered, creativeKnowledgeState.directionTotal || creativeKnowledgeState.directions.length);
        }

        function toggleKnowledgeDirectionSelection(directionId, selected) {
            const id = String(directionId || '').trim();
            if (!id) return;
            const direction = creativeKnowledgeState.directions.find(item => knowledgeDirectionSelectionId(item) === id);
            if (selected && direction && !knowledgeDirectionIsRunnable(direction)) {
                if (typeof showToast === 'function') showToast('该方向当前不可送入生产，请先恢复可跑。', 'error');
                return;
            }
            if (selected) {
                creativeKnowledgeState.selectedDirectionIds.add(id);
            } else {
                creativeKnowledgeState.selectedDirectionIds.delete(id);
            }
            renderKnowledgeDirectionListFromState();
        }

        function selectKnowledgeVisibleDirections() {
            knowledgeFilteredDirections()
                .filter(knowledgeDirectionIsRunnable)
                .forEach(direction => {
                    const id = knowledgeDirectionSelectionId(direction);
                    if (id) creativeKnowledgeState.selectedDirectionIds.add(id);
                });
            renderKnowledgeDirectionListFromState();
            if (typeof showToast === 'function') showToast('已选择当前筛选全部内容');
        }

        function invertKnowledgeVisibleDirections() {
            knowledgeFilteredDirections()
                .filter(knowledgeDirectionIsRunnable)
                .forEach(direction => {
                    const id = knowledgeDirectionSelectionId(direction);
                    if (!id) return;
                    if (creativeKnowledgeState.selectedDirectionIds.has(id)) {
                        creativeKnowledgeState.selectedDirectionIds.delete(id);
                    } else {
                        creativeKnowledgeState.selectedDirectionIds.add(id);
                    }
                });
            renderKnowledgeDirectionListFromState();
            if (typeof showToast === 'function') showToast('已反选当前筛选方向');
        }

        function clearKnowledgeSelectedDirections() {
            creativeKnowledgeState.selectedDirectionIds.clear();
            renderKnowledgeDirectionListFromState();
            if (typeof showToast === 'function') showToast('已清空方向选择');
        }

        function buildKnowledgeDirectionCreativeTarget(direction = {}, index = 0) {
            const stats = direction.knowledgeStats || {};
            const references = (Array.isArray(direction.referencePool) && direction.referencePool.length)
                ? direction.referencePool
                : (Array.isArray(direction.referenceImages) ? direction.referenceImages : []);
            const evidencePreview = Array.isArray(direction.evidencePreview) ? direction.evidencePreview : [];
            const pathParts = String(direction.path || direction.name || '').split('/').map(part => part.trim()).filter(Boolean);
            return {
                targetId: `knowledge:${direction.id || index + 1}`,
                targetKey: direction.id || direction.path || `knowledge-${index + 1}`,
                targetType: 'knowledge-direction',
                source: 'creative-knowledge',
                sourceMode: 'knowledge-direction-selection',
                sourceDirectionId: direction.id || '',
                sourceDirectionPath: direction.path || direction.name || '',
                sourceDirectionKey: direction.path || direction.id || '',
                sourceDirectionName: direction.name || pathParts[pathParts.length - 1] || direction.path || `方向 ${index + 1}`,
                selected: true,
                seedMaterialCount: references.length,
                seedMaterials: references.slice(0, 6).map(reference => ({
                    imageId: reference.id || reference.imageId || '',
                    imageUrl: reference.imageUrl || '',
                    fileName: reference.fileName || '',
                    source: 'knowledge-reference'
                })),
                visualInsight: knowledgeShortText(direction.description || evidencePreview.map(item => item.whyGood || item.summary || '').filter(Boolean).join('；'), 180),
                retainElements: direction.mustKeep ? [direction.mustKeep] : [],
                variationAxes: pathParts.slice(0, 3),
                avoidRules: direction.mustAvoid ? [direction.mustAvoid] : [],
                knowledgeDirection: {
                    id: direction.id || '',
                    sourceLabel: knowledgeDirectionSourceLabel(direction.source),
                    statusLabel: (KNOWLEDGE_DIRECTION_STATUS[knowledgeDirectionStatus(direction)] || KNOWLEDGE_DIRECTION_STATUS.seed).label,
                    primaryTag: direction.primaryTag || pathParts[0] || '',
                    secondaryTag: direction.secondaryTag || pathParts[1] || '',
                    tertiaryTag: direction.tertiaryTag || pathParts[2] || '',
                    subDirection: direction.subTag || direction.name || pathParts[3] || '',
                    referenceCount: Number(stats.activeReferenceCount) || Number(stats.matchedReferenceCount) || references.length || 0,
                    runCount: Number(stats.runCount) || 0,
                    assetCount: Number(stats.assetCount) || 0,
                    evidenceCount: Number(stats.evidenceCount) || Number(direction.evidenceCount) || 0
                }
            };
        }

        function buildKnowledgeCreativePackage() {
            const selected = knowledgeSelectedDirections().filter(knowledgeDirectionIsRunnable);
            const targets = selected.map(buildKnowledgeDirectionCreativeTarget);
            return {
                source: 'creative-knowledge',
                sourceMode: 'knowledge-direction-selection',
                packageType: 'creative-target-package',
                target: 'source-directions',
                selectedDirectionCount: selected.length,
                targetCount: targets.length,
                creativeTargets: targets,
                targets,
                request: '请按知识库已选方向逐个拓展；参考图仅作为方向理解和前端预览，是否上传到生图平台由创意拓展页设置决定。'
            };
        }

        function sendKnowledgeSelectedDirectionsToCreative() {
            const packagePayload = buildKnowledgeCreativePackage();
            if (!packagePayload.creativeTargets.length) {
                if (typeof showToast === 'function') showToast('请先选择可送入生产的方向', 'error');
                return;
            }
            const preview = packagePayload.creativeTargets
                .slice(0, 8)
                .map((target, index) => `${index + 1}. ${target.sourceDirectionPath || target.sourceDirectionName}`)
                .join('\n');
            const confirmed = window.confirm(
                `将 ${packagePayload.targetCount} 个知识库方向送入创意拓展。\n\n` +
                `${preview}${packagePayload.targetCount > 8 ? '\n...' : ''}\n\n` +
                '每个方向拓展几个新方向、每个新方向生成几条提示词，将在创意拓展页统一调整。'
            );
            if (!confirmed) return;

            const envelope = {
                source: 'creative-knowledge',
                receivedAt: new Date().toISOString(),
                type: 'brief',
                brief: packagePayload
            };
            sessionStorage.setItem('material-analysis-creative-brief-v1', JSON.stringify(envelope));
            localStorage.setItem('material-analysis-creative-brief-v1', JSON.stringify(envelope));
            if (typeof window.loadCreativeAutoMaterialBrief === 'function') {
                window.loadCreativeAutoMaterialBrief(envelope);
            }
            if (typeof switchPage === 'function') {
                switchPage('creative');
            }
            setTimeout(() => {
                document.getElementById('creativeAutoTargetQueuePanel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 120);
            if (typeof showToast === 'function') showToast('已送入创意拓展页');
        }

        async function updateKnowledgeDirectionStatus(directionId, status) {
            const reason = window.prompt(status === 'disabled' ? '记录禁跑原因（可留空）' : '记录状态调整原因（可留空）', '') || '';
            try {
                const body = { status, reason };
                if (status === 'seed' || status === 'accepted') {
                    body.autoRun = true;
                }
                await fetchKnowledgeJson(`/api/creative-knowledge/directions/${encodeURIComponent(directionId)}/status`, '更新方向状态失败', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });
                await Promise.all([loadCreativeKnowledgeDirections(), loadCreativeKnowledgeDrafts(), loadCreativeKnowledgePage({ silent: true })]);
                if (typeof showToast === 'function') showToast('方向状态已更新', 'success');
            } catch (error) {
                setKnowledgeInfo('info-box error', error.message || '更新方向状态失败');
            }
        }

        async function mergeKnowledgeDirection(directionId) {
            const targetDirectionId = window.prompt('输入要合并到的目标方向 ID', '') || '';
            if (!targetDirectionId.trim()) return;
            const reason = window.prompt('记录合并原因（可留空）', '') || '';
            try {
                await fetchKnowledgeJson(`/api/creative-knowledge/directions/${encodeURIComponent(directionId)}/merge`, '合并方向失败', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ targetDirectionId: targetDirectionId.trim(), reason })
                });
                await Promise.all([loadCreativeKnowledgeDirections(), loadCreativeKnowledgeDrafts(), loadCreativeKnowledgePage({ silent: true })]);
                if (typeof showToast === 'function') showToast('方向已合并并归档源方向', 'success');
            } catch (error) {
                setKnowledgeInfo('info-box error', error.message || '合并方向失败');
            }
        }

        function knowledgeDraftRiskClass(level = '') {
            if (level === 'high') return 'is-risk-high';
            if (level === 'medium') return 'is-risk-medium';
            return 'is-risk-low';
        }

        function renderKnowledgeDraftGovernanceSummary(counts = {}) {
            const container = document.getElementById('knowledgeDraftGovernanceSummary');
            if (!container) return;
            knowledgeClear(container);
            [
                ['缺方向标签', counts.missingDna || 0, 'missing_dna'],
                ['缺参考图', counts.missingReference || 0, 'missing_reference'],
                ['高重复风险', counts.highDuplicateRisk || 0, 'high_duplicate_risk'],
                ['已有好图证据', counts.hasGoodEvidence || 0, 'has_good_evidence'],
                ['可直接采纳', counts.readyToAccept || 0, 'ready_to_accept'],
                ['需要编辑', counts.needsEdit || 0, 'needs_edit']
            ].forEach(([label, value, filterValue]) => {
                const item = knowledgeMakeEl('button', 'knowledge-draft-queue-chip', '');
                item.type = 'button';
                item.addEventListener('click', () => {
                    const filter = document.getElementById('knowledgeDraftGovernanceFilter');
                    if (filter) filter.value = filterValue;
                    loadCreativeKnowledgeDrafts().catch(error => setKnowledgeInfo('info-box error', error.message));
                });
                item.appendChild(knowledgeMakeEl('strong', '', knowledgeFormatNumber(value)));
                item.appendChild(knowledgeMakeEl('span', '', label));
                container.appendChild(item);
            });
        }

        function renderKnowledgeDraftMetric(label, value, className = '') {
            const item = knowledgeMakeEl('div', `knowledge-draft-metric ${className}`.trim());
            item.appendChild(knowledgeMakeEl('span', '', label));
            item.appendChild(knowledgeMakeEl('strong', '', value));
            return item;
        }

        function renderKnowledgeDraftChecks(draft = {}) {
            const governance = draft.governance || {};
            const preflight = governance.preflight || {};
            const checks = knowledgeMakeEl('div', 'knowledge-draft-checks');
            [
                ['必须有名称', Boolean(draft.name), 'hard'],
                ['必须有路径', Boolean(draft.path), 'hard'],
                ['建议有 description', Boolean(draft.description), 'soft'],
                [
                    preflight.needsDna === true
                        ? '建议补齐方向标签'
                        : '方向标签已满足',
                    !(preflight.needsDna === true),
                    'soft'
                ],
                [
                    preflight.needsReference === true
                        ? '缺参考图，采纳后标记待补图'
                        : '参考图已满足',
                    !(preflight.needsReference === true),
                    'soft'
                ],
                [
                    preflight.shouldMerge === true
                        ? '重复风险高，建议合并'
                        : '重复风险可控',
                    !(preflight.shouldMerge === true),
                    'soft'
                ]
            ].forEach(([label, ok, type]) => {
                const row = knowledgeMakeEl('span', `knowledge-draft-check ${ok ? 'is-ok' : (type === 'hard' ? 'is-error' : 'is-warning')}`);
                row.appendChild(document.createTextNode(ok ? '✓ ' : '! '));
                row.appendChild(document.createTextNode(label));
                checks.appendChild(row);
            });
            return checks;
        }

        function renderKnowledgeDrafts(drafts = [], total = drafts.length, counts = {}, governanceCounts = {}) {
            const container = document.getElementById('knowledgeDraftList');
            const meta = document.getElementById('knowledgeDraftMeta');
            if (!container) return;
            knowledgeClear(container);
            renderKnowledgeDraftGovernanceSummary(governanceCounts);
            if (meta) {
                meta.textContent = `显示 ${drafts.length} / ${total} 个草案 · 待审 ${counts.draft || 0} · 已采纳 ${counts.accepted || 0} · 已拒绝 ${counts.rejected || 0}`;
            }

            if (!drafts.length) {
                container.appendChild(knowledgeMakeEl('div', 'knowledge-empty', '暂无方向草案。可在运行记录里从某次 run 提取，也可以从资产详情里收录好方向。'));
                return;
            }

            drafts.forEach(draft => {
                const governance = draft.governance || {};
                const dna = governance.dnaCompleteness || {};
                const item = knowledgeMakeEl('div', `knowledge-draft-item ${knowledgeDraftRiskClass(governance.duplicateRiskLevel)}`);
                const top = knowledgeMakeEl('div', 'knowledge-direction-title');
                top.appendChild(knowledgeMakeEl('strong', '', knowledgeVisibleText(draft.path || draft.name, 72, '未命名方向草案')));
                top.appendChild(knowledgeDirectionStatusPill(draft.status || 'draft'));
                item.appendChild(top);

                item.appendChild(knowledgeMakeEl('div', 'knowledge-direction-desc', knowledgeVisibleText(draft.description, 160, '无描述')));

                const metrics = knowledgeMakeEl('div', 'knowledge-draft-metrics');
                metrics.appendChild(renderKnowledgeDraftMetric('标签完整度', dna.label || `${dna.count || 0} / ${dna.total || 6}`, (Number(dna.count) || 0) >= Number(dna.total || 6) ? 'is-ok' : 'is-warning'));
                metrics.appendChild(renderKnowledgeDraftMetric('参考图', `${Number(governance.referenceCount) || 0} / ${Number(governance.referenceTarget) || 3}`, Number(governance.referenceCount) > 0 ? 'is-ok' : 'is-warning'));
                metrics.appendChild(renderKnowledgeDraftMetric('重复风险', governance.duplicateRiskLabel || '低', knowledgeDraftRiskClass(governance.duplicateRiskLevel)));
                metrics.appendChild(renderKnowledgeDraftMetric('Prompt 样本', knowledgeFormatNumber(governance.promptSampleCount || draft.promptCount || 0)));
                metrics.appendChild(renderKnowledgeDraftMetric('成功案例', knowledgeFormatNumber(governance.successCaseCount || 0), Number(governance.successCaseCount) > 0 ? 'is-ok' : ''));
                item.appendChild(metrics);

                item.appendChild(renderKnowledgeDraftChecks(draft));

                const metaRow = knowledgeMakeEl('div', 'knowledge-meta-row');
                knowledgeAppendMeta(metaRow, '来源任务 ', draft.sourceRunId || '--');
                knowledgeAppendMeta(metaRow, '父方向 ', knowledgeVisibleText(draft.sourceDirectionPath || draft.sourceDirectionName, 72, '--'));
                knowledgeAppendMeta(metaRow, '方向标签 ', knowledgeDirectionTagValues(draft, 3).join('、') || knowledgeVisibleText(draft.visualHook || (governance.visualDna && (governance.visualDna.visualHook || [])[0]), 40, '--'));
                knowledgeAppendMeta(metaRow, '策略 ', knowledgeVisibleText(draft.sourceStrategy, 48, '--'));
                item.appendChild(metaRow);

                if (Array.isArray(draft.similarDirections) && draft.similarDirections.length) {
                    const similar = knowledgeMakeEl('div', 'knowledge-draft-similar');
                    draft.similarDirections.slice(0, 4).forEach(direction => {
                        similar.appendChild(knowledgeDirectionStatusPill(
                            knowledgeDirectionStatus(direction),
                            `${direction.id || '--'} · ${knowledgeVisibleText(direction.path || direction.name, 36, '--')}`
                        ));
                    });
                    item.appendChild(similar);
                }

                if (Array.isArray(draft.prompts) && draft.prompts.length) {
                    const details = document.createElement('details');
                    details.className = 'knowledge-draft-prompts';
                    const summary = document.createElement('summary');
                    summary.textContent = `查看 ${draft.prompts.length} 条样例提示词`;
                    details.appendChild(summary);
                    draft.prompts.slice(0, 5).forEach(prompt => {
                        details.appendChild(knowledgeMakeEl('div', 'knowledge-run-message', knowledgeVisibleText(prompt.prompt || prompt.finalPrompt || prompt.title, 180)));
                    });
                    item.appendChild(details);
                }

                const decision = draft.decisionReason || draft.rejectionReason || draft.archiveReason || draft.mergeReason;
                if (decision) {
                    item.appendChild(knowledgeMakeEl('div', 'knowledge-run-message', `决策记录：${knowledgeVisibleText(decision, 160)}`));
                }

                const actions = knowledgeMakeEl('div', 'knowledge-item-actions');
                if ((draft.status || 'draft') === 'draft') {
                    const acceptBtn = knowledgeMakeEl('button', 'btn btn-primary', '采纳');
                    acceptBtn.type = 'button';
                    acceptBtn.addEventListener('click', () => acceptKnowledgeDraft(draft.id));
                    actions.appendChild(acceptBtn);

                    const mergeBtn = knowledgeMakeEl('button', 'btn btn-secondary', '合并');
                    mergeBtn.type = 'button';
                    mergeBtn.addEventListener('click', () => mergeKnowledgeDraft(draft.id));
                    actions.appendChild(mergeBtn);

                    const rejectBtn = knowledgeMakeEl('button', 'btn btn-secondary', '拒绝');
                    rejectBtn.type = 'button';
                    rejectBtn.addEventListener('click', () => rejectKnowledgeDraft(draft.id));
                    actions.appendChild(rejectBtn);

                    const archiveBtn = knowledgeMakeEl('button', 'btn btn-secondary', '归档');
                    archiveBtn.type = 'button';
                    archiveBtn.addEventListener('click', () => archiveKnowledgeDraft(draft.id));
                    actions.appendChild(archiveBtn);
                }
                if (actions.children.length) item.appendChild(actions);
                container.appendChild(item);
            });
        }

        async function acceptKnowledgeDraft(draftId, allowSimilar = false, confirmPreflight = false, cachedPayload = null) {
            const body = cachedPayload || {
                reason: window.prompt('为什么这个方向值得进入本地成长层？', '') || '',
                priority: Number(window.prompt('优先级 1-100，默认 50', '50') || '50') || 50,
                autoRun: true
            };
            body.allowSimilar = allowSimilar;
            body.confirmPreflight = confirmPreflight;
            try {
                const response = await fetch(`/api/creative-knowledge/direction-drafts/${encodeURIComponent(draftId)}/accept`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });
                const data = await response.json();
                if (response.status === 409 && data.needsPreflightConfirmation) {
                    const preflight = data.preflight || {};
                    const messages = []
                        .concat(preflight.hardErrors || [])
                        .concat(preflight.warnings || []);
                    if (window.confirm(`采纳前检查：\n${messages.join('\n')}\n\n仍要采纳并进入正式方向库吗？`)) {
                        return acceptKnowledgeDraft(draftId, allowSimilar, true, body);
                    }
                    return;
                }
                if (response.status === 409 && data.needsConfirmation) {
                    const summary = (data.similarDirections || []).map(item => `${item.id} ${item.path || item.name}`).join('\n');
                    if (window.confirm(`发现相似方向，仍要采纳为新方向吗？\n${summary}`)) {
                        return acceptKnowledgeDraft(draftId, true, confirmPreflight, body);
                    }
                    return;
                }
                if (!response.ok || data.success === false) {
                    throw new Error(data.message || '采纳方向草案失败');
                }
                await Promise.all([loadCreativeKnowledgeDirections(), loadCreativeKnowledgeDrafts(), loadCreativeKnowledgePage({ silent: true })]);
                if (typeof showToast === 'function') showToast(data.message || '方向已采纳', 'success');
            } catch (error) {
                setKnowledgeInfo('info-box error', error.message || '采纳方向草案失败');
            }
        }

        async function rejectKnowledgeDraft(draftId) {
            const reason = window.prompt('拒绝原因（会保留为反例）', '') || '';
            try {
                await fetchKnowledgeJson(`/api/creative-knowledge/direction-drafts/${encodeURIComponent(draftId)}/reject`, '拒绝方向草案失败', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ reason })
                });
                await Promise.all([loadCreativeKnowledgeDrafts(), loadCreativeKnowledgePage({ silent: true })]);
                if (typeof showToast === 'function') showToast('方向草案已拒绝', 'success');
            } catch (error) {
                setKnowledgeInfo('info-box error', error.message || '拒绝方向草案失败');
            }
        }

        async function archiveKnowledgeDraft(draftId) {
            const reason = window.prompt('归档原因（可留空）', '') || '';
            try {
                await fetchKnowledgeJson(`/api/creative-knowledge/direction-drafts/${encodeURIComponent(draftId)}/archive`, '归档方向草案失败', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ reason })
                });
                await Promise.all([loadCreativeKnowledgeDrafts(), loadCreativeKnowledgePage({ silent: true })]);
                if (typeof showToast === 'function') showToast('方向草案已归档', 'success');
            } catch (error) {
                setKnowledgeInfo('info-box error', error.message || '归档方向草案失败');
            }
        }

        async function mergeKnowledgeDraft(draftId) {
            const targetDirectionId = window.prompt('输入要合并到的目标方向 ID', '') || '';
            if (!targetDirectionId.trim()) return;
            const reason = window.prompt('合并原因（可留空）', '') || '';
            try {
                await fetchKnowledgeJson(`/api/creative-knowledge/direction-drafts/${encodeURIComponent(draftId)}/merge`, '合并方向草案失败', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ targetDirectionId: targetDirectionId.trim(), reason })
                });
                await Promise.all([loadCreativeKnowledgeDrafts(), loadCreativeKnowledgePage({ silent: true })]);
                if (typeof showToast === 'function') showToast('方向草案已合并', 'success');
            } catch (error) {
                setKnowledgeInfo('info-box error', error.message || '合并方向草案失败');
            }
        }

        async function extractKnowledgeDraftsFromRun(runId) {
            if (!runId) return;
            try {
                const data = await fetchKnowledgeJson(`/api/creative-knowledge/direction-drafts/from-run/${encodeURIComponent(runId)}`, '从任务提取方向草案失败', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({})
                });
                await Promise.all([loadCreativeKnowledgeDrafts(), loadCreativeKnowledgePage({ silent: true })]);
                setKnowledgeInfo('info-box success', data.message || '方向草案已提取');
                if (typeof showToast === 'function') showToast(data.message || '方向草案已提取', 'success');
            } catch (error) {
                setKnowledgeInfo('info-box error', error.message || '从任务提取方向草案失败');
            }
        }

        function setKnowledgeAutoCuratorInfo(className, text) {
            const infoBox = document.getElementById('knowledgeAutoCuratorInfo');
            if (!infoBox) return;
            infoBox.className = className;
            infoBox.textContent = text;
        }

        function renderKnowledgeAutoCuratorSamples(report = {}) {
            const lowList = document.getElementById('knowledgeAutoLowQueue');
            const detailList = document.getElementById('knowledgeAutoSampleDetails');
            if (lowList) {
                knowledgeClear(lowList);
                const items = Array.isArray(report.lowConfidenceQueue) ? report.lowConfidenceQueue : [];
                if (!items.length) {
                    lowList.appendChild(knowledgeMakeEl('div', 'knowledge-empty', '暂无低置信样本。'));
                } else {
                    items.slice(0, 8).forEach(asset => {
                        const item = knowledgeMakeEl('button', 'knowledge-auto-sample needs-human');
                        item.type = 'button';
                        item.addEventListener('click', () => openKnowledgeAssetDetail(asset));
                        if (asset.imageUrl) {
                            const img = document.createElement('img');
                            img.src = asset.imageUrl;
                            img.alt = asset.fileName || asset.assetId || 'asset';
                            img.loading = 'lazy';
                            item.appendChild(img);
                        }
                        const body = knowledgeMakeEl('span', 'knowledge-auto-sample-body');
                        body.appendChild(knowledgeMakeEl('strong', '', asset.fileName || asset.assetId || '--'));
                        body.appendChild(knowledgeRenderAutoPill(asset.autoReview, true));
                        body.appendChild(knowledgeMakeEl('em', '', '需要人工复核'));
                        item.appendChild(body);
                        lowList.appendChild(item);
                    });
                }
            }
            if (detailList) {
                knowledgeClear(detailList);
                const details = Array.isArray(report.sampleDetails) ? report.sampleDetails : [];
                if (!details.length) {
                    detailList.appendChild(knowledgeMakeEl('div', 'knowledge-empty', '暂无自动评审记录。'));
                } else {
                    details.slice(0, 10).forEach(asset => {
                        const row = knowledgeMakeEl('div', `knowledge-auto-detail-row${asset.autoReview && asset.autoReview.needsHumanReview ? ' needs-human' : ''}`);
                        row.appendChild(knowledgeMakeEl('strong', '', asset.promptTitle || asset.fileName || asset.assetId || '--'));
                        row.appendChild(knowledgeRenderAutoPill(asset.autoReview));
                        row.appendChild(knowledgeMakeEl('span', '', knowledgeShortText(asset.reason || asset.prompt || '', 140)));
                        row.appendChild(knowledgeRenderReviewPill(knowledgeReviewStatus(asset), `人工 ${knowledgeReviewLabel(knowledgeReviewStatus(asset))}`));
                        detailList.appendChild(row);
                    });
                }
            }
        }

        function renderKnowledgeAutoCurator(report = {}, goldenSet = {}) {
            const queue = report.queue || {};
            const consistency = report.consistency || {};
            const goldenSummary = goldenSet.summary || report.goldenSet || {};
            const goldenCounts = goldenSummary.counts || {};
            knowledgeSetText('knowledgeAutoPending', knowledgeFormatNumber(queue.pending));
            knowledgeSetText('knowledgeAutoScored', knowledgeFormatNumber(queue.scored));
            knowledgeSetText('knowledgeAutoLow', knowledgeFormatNumber(queue.lowConfidence));
            knowledgeSetText('knowledgeAutoConsistency', consistency.total ? `${knowledgeFormatPercent(consistency.accuracy)} / ${knowledgeFormatNumber(consistency.total)}` : '--');
            knowledgeSetText('knowledgeGoldenGood', knowledgeFormatNumber(goldenCounts.good));
            knowledgeSetText('knowledgeGoldenBad', knowledgeFormatNumber(goldenCounts.bad));
            knowledgeSetText('knowledgeGoldenOff', knowledgeFormatNumber(goldenCounts.off_direction));
            knowledgeSetText('knowledgeGoldenText', knowledgeFormatNumber(goldenCounts.text_problem));
            renderKnowledgeAutoCuratorSamples(report);
        }

        async function loadKnowledgeAutoCurator() {
            const [report, goldenSet] = await Promise.all([
                fetchKnowledgeJson('/api/auto-curator/shadow-report?limit=24', '读取自动评审报告失败'),
                fetchKnowledgeJson('/api/auto-curator/golden-set?limit=80', '读取人工样本失败')
            ]);
            creativeKnowledgeState.autoCurator.report = report;
            creativeKnowledgeState.autoCurator.goldenSet = goldenSet;
            renderKnowledgeAutoCurator(report, goldenSet);
            return { report, goldenSet };
        }

        async function scoreKnowledgeVisibleAssets() {
            const assetIds = creativeKnowledgeState.assets.map(asset => asset.assetId).filter(Boolean);
            if (!assetIds.length) {
                setKnowledgeAutoCuratorInfo('info-box error', '当前列表没有可评审资产。');
                return;
            }
            try {
                setKnowledgeAutoCuratorInfo('info-box loading', '正在评审当前资产...');
                const data = await fetchKnowledgeJson('/api/auto-curator/score-assets', '自动评审失败', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ assetIds, limit: assetIds.length, retries: 1 })
                });
                await Promise.all([loadCreativeKnowledgeAssets(), loadKnowledgeAutoCurator()]);
                setKnowledgeAutoCuratorInfo('info-box success', `已评审 ${data.summary && data.summary.scored || 0} 张；低置信 ${data.summary && data.summary.lowConfidence || 0} 张。`);
            } catch (error) {
                setKnowledgeAutoCuratorInfo('info-box error', error.message || '自动评审失败');
            }
        }

        async function scoreKnowledgeUnreviewedAssets() {
            try {
                setKnowledgeAutoCuratorInfo('info-box loading', '正在评审未审核资产...');
                const data = await fetchKnowledgeJson('/api/auto-curator/score-assets', '自动评审失败', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ reviewStatus: 'unreviewed', onlyMissing: true, limit: 60, retries: 1 })
                });
                await Promise.all([loadCreativeKnowledgeAssets(), loadKnowledgeAutoCurator()]);
                setKnowledgeAutoCuratorInfo('info-box success', `已评审 ${data.summary && data.summary.scored || 0} 张；跳过 ${data.summary && data.summary.skipped || 0} 张。`);
            } catch (error) {
                setKnowledgeAutoCuratorInfo('info-box error', error.message || '自动评审失败');
            }
        }

        async function importKnowledgeGoldenReviewed() {
            try {
                setKnowledgeAutoCuratorInfo('info-box loading', '正在导入人工审核样本...');
                const data = await fetchKnowledgeJson('/api/auto-curator/golden-set/import', '导入人工样本失败', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ fromReviewed: true, limit: 300 })
                });
                await loadKnowledgeAutoCurator();
                setKnowledgeAutoCuratorInfo('info-box success', `样本集共 ${data.total} 条；本次导入 ${data.imported} 条。`);
            } catch (error) {
                setKnowledgeAutoCuratorInfo('info-box error', error.message || '导入样本失败');
            }
        }

        async function evaluateKnowledgeGoldenSet() {
            try {
                setKnowledgeAutoCuratorInfo('info-box loading', '正在评估人工样本...');
                const data = await fetchKnowledgeJson('/api/auto-curator/golden-set/evaluate', '评估人工样本失败', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ scoreMissing: true, limit: 120 })
                });
                await loadKnowledgeAutoCurator();
                setKnowledgeAutoCuratorInfo('info-box success', `样本准确率 ${knowledgeFormatPercent(data.accuracy)}，共 ${data.total} 条。`);
            } catch (error) {
                setKnowledgeAutoCuratorInfo('info-box error', error.message || '评估样本失败');
            }
        }

        function renderKnowledgeAssets(assets = [], total = assets.length) {
            const container = document.getElementById('knowledgeAssetList');
            const meta = document.getElementById('knowledgeAssetMeta');
            if (!container) return;
            knowledgeClear(container);
            const groups = buildKnowledgeAssetGroups(assets);
            if (meta) meta.textContent = `显示 ${groups.length} 组提示词 / ${total} 张资产`;

            if (!assets.length) {
                container.appendChild(knowledgeMakeEl('div', 'knowledge-empty', '暂无资产记录'));
                return;
            }

            groups.forEach(group => {
                const asset = group.representative;
                const summary = knowledgeAssetSummary(asset);
                const reviewCounts = knowledgeGroupReviewCounts(group);
                const autoReview = knowledgeAutoReview(asset);
                const item = knowledgeMakeEl('div', `knowledge-asset-item${autoReview && autoReview.needsHumanReview ? ' needs-human-review' : ''}`);
                const media = knowledgeMakeEl('div', 'knowledge-asset-media');
                if (asset.imageUrl) {
                    const link = knowledgeMakeEl('button', 'knowledge-asset-thumb');
                    link.type = 'button';
                    link.title = '查看本组图片和详情';
                    link.addEventListener('click', () => openKnowledgeAssetDetail(group));
                    const img = document.createElement('img');
                    img.src = asset.imageUrl;
                    img.alt = summary.theme || asset.fileName || asset.assetId || 'asset';
                    img.loading = 'lazy';
                    img.addEventListener('error', () => {
                        media.textContent = '';
                        media.appendChild(knowledgeMakeEl('span', '', '图片不可读'));
                        media.classList.add('is-missing');
                    });
                    link.appendChild(img);
                    media.appendChild(link);
                    if (group.assets.length > 1) {
                        media.appendChild(knowledgeMakeEl('span', 'knowledge-asset-count', `${group.assets.length} 张`));
                    }
                    media.appendChild(knowledgeRenderReviewPill(knowledgeReviewStatus(asset)));
                    media.appendChild(knowledgeRenderAutoPill(autoReview, true));
                } else {
                    media.classList.add('is-missing');
                    media.appendChild(knowledgeMakeEl('span', '', '无预览'));
                }
                item.appendChild(media);

                const body = knowledgeMakeEl('div', 'knowledge-asset-body');
                body.appendChild(knowledgeMakeEl('div', 'knowledge-asset-title', summary.theme));
                body.appendChild(knowledgeMakeEl('div', 'knowledge-asset-path', summary.direction));
                body.appendChild(knowledgeMakeEl('div', 'knowledge-asset-core', `画面核心：${summary.core}`));
                const reviewRow = knowledgeMakeEl('div', 'knowledge-asset-review-row');
                Object.entries(reviewCounts)
                    .filter(([, count]) => count > 0)
                    .forEach(([status, count]) => {
                        reviewRow.appendChild(knowledgeRenderReviewPill(status, `${knowledgeReviewLabel(status)} ${count}`));
                    });
                const collection = asset.directionCollection || (group.assets.find(item => item.directionCollection) || {}).directionCollection;
                if (collection) {
                    reviewRow.appendChild(knowledgeDirectionStatusPill('accepted', knowledgeCollectionLabel(collection)));
                }
                reviewRow.appendChild(knowledgeRenderAutoPill(autoReview));
                body.appendChild(reviewRow);

                item.appendChild(body);
                container.appendChild(item);
            });
        }

        function knowledgeAppendDetailRow(container, label, value, className = '') {
            if (!container) return;
            const text = knowledgeText(value, '--');
            const row = knowledgeMakeEl('div', `knowledge-detail-row ${className}`.trim());
            row.appendChild(knowledgeMakeEl('strong', '', label));
            row.appendChild(knowledgeMakeEl('span', '', text));
            container.appendChild(row);
        }

        function closeKnowledgeAssetDetail() {
            document.getElementById('knowledgeAssetDetailModal')?.classList.remove('active');
            creativeKnowledgeState.assetDetailGroup = null;
            creativeKnowledgeState.selectedAssetId = '';
        }

        function knowledgeNormalizeAssetGroup(assetOrGroup = {}) {
            return Array.isArray(assetOrGroup.assets)
                ? assetOrGroup
                : { assets: [assetOrGroup], representative: assetOrGroup };
        }

        function knowledgeSelectedAsset(group) {
            const groupAssets = (group && group.assets ? group.assets : []).filter(Boolean);
            return groupAssets.find(asset => asset.assetId === creativeKnowledgeState.selectedAssetId)
                || group.representative
                || groupAssets[0]
                || {};
        }

        function selectKnowledgeReviewAsset(assetId) {
            creativeKnowledgeState.selectedAssetId = assetId || '';
            renderKnowledgeAssetDetail();
        }

        function setKnowledgeReviewStatus(status) {
            const panel = document.getElementById('knowledgeReviewPanel');
            if (!panel) return;
            panel.dataset.status = status;
            panel.querySelectorAll('[data-review-status]').forEach(button => {
                button.classList.toggle('active', button.dataset.reviewStatus === status);
            });
        }

        function toggleKnowledgeReviewTag(tag) {
            const button = document.querySelector(`[data-review-tag="${CSS.escape(tag)}"]`);
            if (button) button.classList.toggle('active');
        }

        function renderKnowledgeReviewPanel(asset = {}) {
            const review = asset.review || {};
            const status = knowledgeReviewStatus(asset);
            const labels = Array.isArray(asset.reviewLabels) ? asset.reviewLabels : (Array.isArray(review.labels) ? review.labels : []);
            const panel = knowledgeMakeEl('div', 'knowledge-review-panel');
            panel.id = 'knowledgeReviewPanel';
            panel.dataset.assetId = asset.assetId || '';
            panel.dataset.status = status === 'unreviewed' ? 'normal' : status;

            const heading = knowledgeMakeEl('div', 'knowledge-review-heading');
            heading.appendChild(knowledgeMakeEl('strong', '', `审核图 ${asset.outputIndex || ''}`.trim()));
            heading.appendChild(knowledgeRenderReviewPill(status));
            panel.appendChild(heading);

            const actions = knowledgeMakeEl('div', 'knowledge-review-actions');
            KNOWLEDGE_REVIEW_ACTIONS.forEach(action => {
                const button = knowledgeMakeEl('button', `knowledge-review-action ${action.value === panel.dataset.status ? 'active' : ''}`, action.label);
                button.type = 'button';
                button.dataset.reviewStatus = action.value;
                button.addEventListener('click', () => setKnowledgeReviewStatus(action.value));
                actions.appendChild(button);
            });
            panel.appendChild(actions);

            const tags = knowledgeMakeEl('div', 'knowledge-review-tags');
            KNOWLEDGE_FEEDBACK_TAGS.forEach(tag => {
                const button = knowledgeMakeEl('button', `knowledge-review-tag ${labels.includes(tag) ? 'active' : ''}`, tag);
                button.type = 'button';
                button.dataset.reviewTag = tag;
                button.addEventListener('click', () => button.classList.toggle('active'));
                tags.appendChild(button);
            });
            panel.appendChild(tags);

            const note = document.createElement('textarea');
            note.id = 'knowledgeReviewNote';
            note.placeholder = '写一句原因，例如：主体清楚但文字偏乱。';
            note.value = asset.reviewNote || review.note || '';
            panel.appendChild(note);

            const footer = knowledgeMakeEl('div', 'knowledge-review-footer');
            const save = knowledgeMakeEl('button', 'btn btn-primary', '保存审核');
            save.type = 'button';
            save.addEventListener('click', submitKnowledgeAssetReview);
            footer.appendChild(save);
            panel.appendChild(footer);

            return panel;
        }

        function renderKnowledgeAutoReviewPanel(asset = {}) {
            const autoReview = knowledgeAutoReview(asset);
            const panel = knowledgeMakeEl('div', `knowledge-auto-review-panel${autoReview && autoReview.needsHumanReview ? ' needs-human' : ''}`);
            const heading = knowledgeMakeEl('div', 'knowledge-review-heading');
            heading.appendChild(knowledgeMakeEl('strong', '', '自动评审建议'));
            heading.appendChild(knowledgeRenderAutoPill(autoReview));
            panel.appendChild(heading);

            if (!autoReview) {
                panel.appendChild(knowledgeMakeEl('div', 'knowledge-run-message', '暂无自动评审建议。自动评审只提供参考，不会覆盖人工审核结果。'));
                return panel;
            }

            const meta = knowledgeMakeEl('div', 'knowledge-meta-row');
            knowledgeAppendMeta(meta, '评分 ', autoReview.autoScore ?? autoReview.score ?? '--');
            knowledgeAppendMeta(meta, '置信度 ', knowledgeFormatPercent(autoReview.confidence));
            knowledgeAppendMeta(meta, '判断 ', knowledgeAutoGradeConfig(autoReview.autoGrade).label);
            knowledgeAppendMeta(meta, '版本 ', autoReview.autoCuratorVersion || autoReview.version || '--');
            panel.appendChild(meta);
            if (autoReview.needsHumanReview) {
                panel.appendChild(knowledgeMakeEl('div', 'knowledge-auto-human-note', '需要人看：低置信或失败类型需要人工抽样确认。'));
            }
            panel.appendChild(knowledgeMakeEl('div', 'knowledge-run-message', autoReview.reason || '--'));
            if (Array.isArray(autoReview.evidence) && autoReview.evidence.length) {
                const evidence = knowledgeMakeEl('div', 'knowledge-auto-evidence');
                autoReview.evidence.slice(0, 5).forEach(item => evidence.appendChild(knowledgeMakeEl('span', '', item)));
                panel.appendChild(evidence);
            }
            return panel;
        }

        function knowledgeDirectionLabel(direction = {}) {
            return direction.path || direction.name || direction.id || '未命名方向';
        }

        function knowledgeCollectionLabel(collection = null) {
            if (!collection) return '未收录';
            if (collection.status === 'accepted_as_new') return '已新增方向';
            if (collection.status === 'merged') return '已并入方向';
            return collection.status || '已收录';
        }

        function renderKnowledgeDirectionCollectionPanel(asset = {}, groupAssets = []) {
            const collection = asset.directionCollection || (groupAssets.find(item => item.directionCollection) || {}).directionCollection || null;
            const panel = knowledgeMakeEl('div', 'knowledge-collect-panel');
            panel.id = 'knowledgeCollectDirectionPanel';
            panel.dataset.assetId = asset.assetId || '';

            const heading = knowledgeMakeEl('div', 'knowledge-review-heading');
            heading.appendChild(knowledgeMakeEl('strong', '', '方向沉淀'));
            heading.appendChild(knowledgeDirectionStatusPill(collection ? 'accepted' : 'seed', knowledgeCollectionLabel(collection)));
            panel.appendChild(heading);

            if (collection) {
                const note = knowledgeMakeEl(
                    'div',
                    'knowledge-run-message',
                    `已收录到：${collection.targetDirectionPath || collection.targetDirectionId || '--'}${collection.whyGood ? `；原因：${collection.whyGood}` : ''}`
                );
                panel.appendChild(note);
                return panel;
            }

            const reviewStatus = knowledgeReviewStatus(asset);
            const labels = Array.isArray(asset.reviewLabels) ? asset.reviewLabels : [];
            if (reviewStatus === 'unreviewed') {
                panel.appendChild(knowledgeMakeEl('div', 'knowledge-run-message', '建议先审核图片，再收录方向。'));
            }

            const modeRow = knowledgeMakeEl('div', 'knowledge-collect-mode-row');
            [
                { value: 'merge', label: '并入已有方向' },
                { value: 'new', label: '新增为子方向' }
            ].forEach((option, index) => {
                const label = knowledgeMakeEl('label', 'knowledge-collect-mode');
                const input = document.createElement('input');
                input.type = 'radio';
                input.name = 'knowledgeCollectMode';
                input.value = option.value;
                input.checked = index === 0;
                input.addEventListener('change', () => updateKnowledgeCollectMode(panel));
                label.appendChild(input);
                label.appendChild(knowledgeMakeEl('span', '', option.label));
                modeRow.appendChild(label);
            });
            panel.appendChild(modeRow);

            const directionSelect = document.createElement('select');
            directionSelect.id = 'knowledgeCollectTargetDirection';
            const preferredDirectionId = asset.directionId || '';
            creativeKnowledgeState.directions.forEach(direction => {
                const option = document.createElement('option');
                option.value = direction.id;
                option.textContent = `${direction.id} · ${knowledgeDirectionLabel(direction)}`;
                if (direction.id === preferredDirectionId) option.selected = true;
                directionSelect.appendChild(option);
            });
            const targetGroup = knowledgeMakeEl('div', 'form-group knowledge-collect-target');
            targetGroup.appendChild(knowledgeMakeEl('label', '', '目标/父级方向'));
            targetGroup.appendChild(directionSelect);
            panel.appendChild(targetGroup);

            const nameInput = document.createElement('input');
            nameInput.id = 'knowledgeCollectDirectionName';
            nameInput.value = asset.promptDirection || asset.promptTitle || '';
            nameInput.placeholder = '新方向名称';
            const nameGroup = knowledgeMakeEl('div', 'form-group knowledge-collect-new-only');
            nameGroup.appendChild(knowledgeMakeEl('label', '', '新子方向名称'));
            nameGroup.appendChild(nameInput);
            panel.appendChild(nameGroup);

            const description = document.createElement('textarea');
            description.id = 'knowledgeCollectDirectionDescription';
            description.placeholder = '新方向描述，可留空';
            description.value = asset.promptDirection || '';
            const descriptionGroup = knowledgeMakeEl('div', 'form-group knowledge-collect-new-only');
            descriptionGroup.appendChild(knowledgeMakeEl('label', '', '新方向描述'));
            descriptionGroup.appendChild(description);
            panel.appendChild(descriptionGroup);

            const whyGood = document.createElement('textarea');
            whyGood.id = 'knowledgeCollectWhyGood';
            whyGood.placeholder = '为什么这个方向值得继续沉淀';
            whyGood.value = asset.reviewNote || labels.join('、') || '';
            const whyGroup = knowledgeMakeEl('div', 'form-group');
            whyGroup.appendChild(knowledgeMakeEl('label', '', '为什么好'));
            whyGroup.appendChild(whyGood);
            panel.appendChild(whyGroup);

            const footer = knowledgeMakeEl('div', 'knowledge-review-footer');
            const save = knowledgeMakeEl('button', 'btn btn-primary', '收录方向');
            save.type = 'button';
            save.addEventListener('click', () => submitKnowledgeDirectionCollection());
            footer.appendChild(save);
            panel.appendChild(footer);

            updateKnowledgeCollectMode(panel);
            return panel;
        }

        function updateKnowledgeCollectMode(panel) {
            const mode = panel.querySelector('input[name="knowledgeCollectMode"]:checked')?.value || 'merge';
            panel.querySelectorAll('.knowledge-collect-new-only').forEach(el => {
                el.hidden = mode !== 'new';
            });
            const target = panel.querySelector('.knowledge-collect-target');
            if (target) target.hidden = false;
        }

        function knowledgePostprocessOperationLabel(operation) {
            const labels = {
                rename: '重命名',
                resize: '改尺寸',
                logo: '加 LOGO',
                package: '打包'
            };
            return labels[operation] || operation || '后处理';
        }

        function knowledgePostprocessStatusText(asset = {}) {
            const postprocess = asset.postprocess || {};
            const labels = [];
            if (postprocess.renamed) labels.push('已重命名');
            if (postprocess.resized) labels.push('已改尺寸');
            if (postprocess.logoApplied) labels.push('已加 LOGO');
            if (postprocess.packaged) labels.push('已打包');
            return labels.length ? labels.join(' / ') : '未后处理';
        }

        function knowledgeDefaultPostprocessOutputFolder(inputFolder, stageName) {
            const folder = String(inputFolder || '').trim();
            if (!folder) return '';
            return folder.replace(/([\\\/])selected-assets\1/i, `$1${stageName}$1`);
        }

        async function prepareKnowledgeAssetsForPostprocess(assetIds = []) {
            const selectedIds = Array.from(new Set((assetIds || []).filter(Boolean)));
            if (!selectedIds.length) {
                setKnowledgeInfo('info-box error', '请先选择要送入后处理的资产');
                return;
            }

            try {
                const data = await fetchKnowledgeJson('/api/postprocess/prepare-assets', '准备后处理输入目录失败', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ assetIds: selectedIds })
                });

                const input = document.getElementById('renameInputFolder');
                const output = document.getElementById('renameOutputFolder');
                if (input) {
                    input.value = data.outputFolder || '';
                    config.renameInputFolder = input.value;
                    if (typeof addFolderHistory === 'function') addFolderHistory('renameInputFolder', input.value);
                }
                if (output && data.outputFolder) {
                    const renameOutput = knowledgeDefaultPostprocessOutputFolder(data.outputFolder, 'renamed-assets');
                    output.value = renameOutput || output.value;
                    config.renameOutputFolder = output.value;
                    if (typeof addFolderHistory === 'function') addFolderHistory('renameOutputFolder', output.value);
                }

                closeKnowledgeAssetDetail();
                if (typeof switchPage === 'function') {
                    switchPage('rename');
                }
                setTimeout(() => {
                    document.getElementById('renamePage')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }, 80);
                const message = data.message || `已准备 ${data.count || selectedIds.length} 张资产`;
                setKnowledgeInfo('info-box success', message);
                if (typeof showToast === 'function') showToast(message, 'success');
            } catch (error) {
                setKnowledgeInfo('info-box error', error.message || '准备后处理输入目录失败');
                if (typeof showToast === 'function') showToast(error.message || '准备后处理输入目录失败', 'error');
            }
        }

        function renderKnowledgePostprocessPanel(asset = {}, groupAssets = []) {
            const postprocess = asset.postprocess || {};
            const derivatives = Array.isArray(postprocess.derivatives) ? postprocess.derivatives : [];
            const panel = knowledgeMakeEl('div', 'knowledge-collect-panel');

            const heading = knowledgeMakeEl('div', 'knowledge-review-heading');
            heading.appendChild(knowledgeMakeEl('strong', '', '后处理追溯'));
            heading.appendChild(knowledgeRenderReviewPill(
                derivatives.length ? 'good' : 'unreviewed',
                knowledgePostprocessStatusText(asset)
            ));
            panel.appendChild(heading);

            const actions = knowledgeMakeEl('div', 'knowledge-review-footer');
            const currentButton = knowledgeMakeEl('button', 'btn btn-secondary', '当前图送入交付处理');
            currentButton.type = 'button';
            currentButton.disabled = !asset.assetId || !asset.fileExists;
            currentButton.addEventListener('click', () => prepareKnowledgeAssetsForPostprocess([asset.assetId]));
            actions.appendChild(currentButton);

            const groupButton = knowledgeMakeEl('button', 'btn btn-primary', '本组送入交付处理');
            groupButton.type = 'button';
            const groupAssetIds = groupAssets.filter(item => item.assetId && item.fileExists).map(item => item.assetId);
            groupButton.disabled = groupAssetIds.length === 0;
            groupButton.addEventListener('click', () => prepareKnowledgeAssetsForPostprocess(groupAssetIds));
            actions.appendChild(groupButton);
            panel.appendChild(actions);

            if (!derivatives.length) {
                panel.appendChild(knowledgeMakeEl('div', 'knowledge-run-message', '还没有命名、改尺寸、加 LOGO 或打包产物。'));
                return panel;
            }

            const list = knowledgeMakeEl('div', 'knowledge-detail-file-list');
            list.appendChild(knowledgeMakeEl('strong', '', `派生文件 ${postprocess.completedCount || 0}/${postprocess.derivativeCount || derivatives.length}`));
            derivatives.slice(0, 8).forEach(derivative => {
                const row = knowledgeMakeEl('div', 'knowledge-detail-file-item');
                row.appendChild(knowledgeMakeEl('span', 'knowledge-detail-file-index', knowledgePostprocessOperationLabel(derivative.operation)));
                const text = [
                    derivative.outputPath || derivative.outputName || '--',
                    derivative.targetSize ? `尺寸 ${derivative.targetSize}` : '',
                    derivative.fileExists ? '' : '文件不可读'
                ].filter(Boolean).join(' / ');
                row.appendChild(knowledgeMakeEl('span', 'knowledge-detail-file-path', text));
                list.appendChild(row);
            });
            panel.appendChild(list);
            return panel;
        }

        async function submitKnowledgeDirectionCollection(allowSimilar = false) {
            const panel = document.getElementById('knowledgeCollectDirectionPanel');
            if (!panel || !panel.dataset.assetId) return;
            const mode = panel.querySelector('input[name="knowledgeCollectMode"]:checked')?.value || 'merge';
            const payload = {
                mode,
                targetDirectionId: document.getElementById('knowledgeCollectTargetDirection')?.value || '',
                parentDirectionId: document.getElementById('knowledgeCollectTargetDirection')?.value || '',
                name: document.getElementById('knowledgeCollectDirectionName')?.value || '',
                description: document.getElementById('knowledgeCollectDirectionDescription')?.value || '',
                whyGood: document.getElementById('knowledgeCollectWhyGood')?.value || '',
                allowSimilar
            };

            if (mode === 'new' && !payload.name.trim()) {
                setKnowledgeInfo('info-box error', '请先填写新方向名称');
                return;
            }

            try {
                const response = await fetch(`/api/creative-knowledge/assets/${encodeURIComponent(panel.dataset.assetId)}/collect-direction`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const data = await response.json();
                if (response.status === 409 && data.needsConfirmation) {
                    const summary = (data.similarDirections || []).map(item => `${item.id} ${item.name || item.path}`).join('\n');
                    if (window.confirm(`发现相似方向，仍要新增吗？\n${summary}`)) {
                        return submitKnowledgeDirectionCollection(true);
                    }
                    return;
                }
                if (!response.ok || data.success === false) {
                    throw new Error(data.message || '收录方向失败');
                }

                await Promise.all([
                    loadCreativeKnowledgeDirections(),
                    loadCreativeKnowledgeAssets(),
                    fetchKnowledgeJson('/api/creative-knowledge/overview', '读取知识库总览失败').then(overview => {
                        creativeKnowledgeState.overview = overview;
                        renderKnowledgeOverview(overview);
                    })
                ]);

                const collection = {
                    status: data.status,
                    mode: data.mode,
                    evidenceId: data.evidence && data.evidence.evidenceId,
                    targetDirectionId: data.direction && data.direction.id,
                    targetDirectionPath: data.direction && data.direction.path,
                    whyGood: data.evidence && data.evidence.whyGood,
                    collectedAt: data.evidence && data.evidence.createdAt
                };
                if (creativeKnowledgeState.assetDetailGroup) {
                    const updatedIds = new Set(data.assetIds || []);
                    creativeKnowledgeState.assetDetailGroup.assets = creativeKnowledgeState.assetDetailGroup.assets.map(item => (
                        updatedIds.has(item.assetId) ? { ...item, directionCollection: collection } : item
                    ));
                    if (creativeKnowledgeState.assetDetailGroup.representative && updatedIds.has(creativeKnowledgeState.assetDetailGroup.representative.assetId)) {
                        creativeKnowledgeState.assetDetailGroup.representative = {
                            ...creativeKnowledgeState.assetDetailGroup.representative,
                            directionCollection: collection
                        };
                    }
                    renderKnowledgeAssetDetail();
                }
                setKnowledgeInfo('info-box success', data.message || '方向已收录');
                if (typeof showToast === 'function') showToast(data.message || '方向已收录', 'success');
            } catch (error) {
                setKnowledgeInfo('info-box error', error.message || '收录方向失败');
                if (typeof showToast === 'function') showToast(error.message || '收录方向失败', 'error');
            }
        }

        async function submitKnowledgeAssetReview() {
            const panel = document.getElementById('knowledgeReviewPanel');
            if (!panel || !panel.dataset.assetId) return;
            const payload = {
                status: panel.dataset.status || 'normal',
                labels: Array.from(panel.querySelectorAll('[data-review-tag].active')).map(button => button.dataset.reviewTag),
                note: document.getElementById('knowledgeReviewNote')?.value || ''
            };
            try {
                const data = await fetchKnowledgeJson(`/api/creative-knowledge/assets/${encodeURIComponent(panel.dataset.assetId)}/review`, '保存审核失败', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const updatedAsset = data.asset;
                creativeKnowledgeState.assets = creativeKnowledgeState.assets.map(asset => (
                    asset.assetId === updatedAsset.assetId ? updatedAsset : asset
                ));
                if (creativeKnowledgeState.assetDetailGroup) {
                    creativeKnowledgeState.assetDetailGroup.assets = creativeKnowledgeState.assetDetailGroup.assets.map(asset => (
                        asset.assetId === updatedAsset.assetId ? updatedAsset : asset
                    ));
                    if (creativeKnowledgeState.assetDetailGroup.representative
                        && creativeKnowledgeState.assetDetailGroup.representative.assetId === updatedAsset.assetId) {
                        creativeKnowledgeState.assetDetailGroup.representative = updatedAsset;
                    }
                }
                await Promise.all([loadCreativeKnowledgeAssets(), loadKnowledgeAutoCurator()]);
                renderKnowledgeAssetDetail();
                const overview = await fetchKnowledgeJson('/api/creative-knowledge/overview', '读取知识库总览失败');
                creativeKnowledgeState.overview = overview;
                renderKnowledgeOverview(overview);
                setKnowledgeInfo('info-box success', `已标记为${knowledgeReviewLabel(updatedAsset.reviewStatus)}`);
            } catch (error) {
                setKnowledgeInfo('info-box error', error.message || '保存审核失败');
                if (typeof showToast === 'function') showToast(error.message || '保存审核失败', 'error');
            }
        }

        function openKnowledgeAssetDetail(assetOrGroup = {}) {
            const group = knowledgeNormalizeAssetGroup(assetOrGroup);
            creativeKnowledgeState.assetDetailGroup = group;
            creativeKnowledgeState.selectedAssetId = (group.representative && group.representative.assetId)
                || (group.assets && group.assets[0] && group.assets[0].assetId)
                || '';
            renderKnowledgeAssetDetail();
        }

        function renderKnowledgeAssetDetail() {
            const modal = document.getElementById('knowledgeAssetDetailModal');
            const content = document.getElementById('knowledgeAssetDetailContent');
            if (!modal || !content) return;

            const group = creativeKnowledgeState.assetDetailGroup;
            if (!group) return;
            const groupAssets = group.assets.filter(Boolean);
            const asset = knowledgeSelectedAsset(group);
            const summary = knowledgeAssetSummary(asset);
            knowledgeClear(content);

            const header = knowledgeMakeEl('div', 'knowledge-detail-header');
            header.appendChild(knowledgeMakeEl('div', 'knowledge-detail-kicker', summary.direction));
            header.appendChild(knowledgeMakeEl('h3', '', summary.theme));
            header.appendChild(knowledgeMakeEl('p', '', summary.core));
            content.appendChild(header);

            const layout = knowledgeMakeEl('div', 'knowledge-detail-layout');
            const preview = knowledgeMakeEl('div', 'knowledge-detail-preview');
            const imageAssets = groupAssets.filter(item => item.imageUrl);
            if (imageAssets.length) {
                const gallery = knowledgeMakeEl('div', `knowledge-detail-gallery ${imageAssets.length === 1 ? 'is-single' : ''}`);
                imageAssets.forEach((imageAsset, index) => {
                    const imageSummary = knowledgeAssetSummary(imageAsset);
                    const imageLink = knowledgeMakeEl(
                        'button',
                        `knowledge-detail-gallery-item ${imageAsset.assetId === asset.assetId ? 'active' : ''}`
                    );
                    imageLink.type = 'button';
                    imageLink.title = `${imageAsset.fileName || `第 ${index + 1} 张`}，双击查看原图`;
                    imageLink.addEventListener('click', () => selectKnowledgeReviewAsset(imageAsset.assetId));
                    imageLink.addEventListener('dblclick', () => {
                        const opened = window.open(imageAsset.imageUrl, '_blank', 'noopener');
                        if (opened) opened.opener = null;
                    });
                    const img = document.createElement('img');
                    img.src = imageAsset.imageUrl;
                    img.alt = imageSummary.theme || summary.theme;
                    imageLink.appendChild(img);
                    imageLink.appendChild(knowledgeMakeEl('span', 'knowledge-gallery-index', `图 ${imageAsset.outputIndex || index + 1}`));
                    imageLink.appendChild(knowledgeRenderReviewPill(knowledgeReviewStatus(imageAsset)));
                    gallery.appendChild(imageLink);
                });
                preview.appendChild(gallery);
            } else {
                preview.appendChild(knowledgeMakeEl('span', '', '无预览'));
                preview.classList.add('is-missing');
            }
            layout.appendChild(preview);

            const details = knowledgeMakeEl('div', 'knowledge-detail-fields');
            knowledgeAppendDetailRow(details, '标签方向', asset.directionPath || asset.directionName);
            knowledgeAppendDetailRow(details, '主题', summary.theme);
            knowledgeAppendDetailRow(details, '画面核心内容', summary.core);
            knowledgeAppendDetailRow(details, '任务 ID', asset.runId);
            knowledgeAppendDetailRow(details, '提示词', asset.promptIndex ? `${asset.promptTitle || '提示词'} / ${asset.promptIndex}` : asset.promptTitle);
            knowledgeAppendDetailRow(details, '本组图片', `${groupAssets.length} 张`);
            knowledgeAppendDetailRow(details, '保存时间', knowledgeFormatDate(asset.savedAt));
            knowledgeAppendDetailRow(details, '完整提示词', asset.prompt, 'is-long');
            knowledgeAppendDetailRow(details, '后处理', knowledgePostprocessStatusText(asset));
            details.appendChild(renderKnowledgeAutoReviewPanel(asset));
            details.appendChild(renderKnowledgeReviewPanel(asset));
            details.appendChild(renderKnowledgeDirectionCollectionPanel(asset, groupAssets));
            details.appendChild(renderKnowledgePostprocessPanel(asset, groupAssets));
            const files = knowledgeMakeEl('div', 'knowledge-detail-file-list');
            files.appendChild(knowledgeMakeEl('strong', '', '本组文件'));
            groupAssets.forEach((imageAsset, index) => {
                const row = knowledgeMakeEl('div', 'knowledge-detail-file-item');
                row.appendChild(knowledgeMakeEl('span', 'knowledge-detail-file-index', `图 ${imageAsset.outputIndex || index + 1}`));
                row.appendChild(knowledgeMakeEl('span', 'knowledge-detail-file-path', imageAsset.filePath || imageAsset.fileName || '--'));
                files.appendChild(row);
            });
            details.appendChild(files);
            layout.appendChild(details);

            content.appendChild(layout);
            modal.classList.add('active');
        }

        function renderKnowledgeRuns(runs = [], total = runs.length) {
            const container = document.getElementById('knowledgeRunList');
            if (!container) return;
            knowledgeClear(container);

            if (!runs.length) {
                container.appendChild(knowledgeMakeEl('div', 'knowledge-empty', '暂无运行记录'));
                return;
            }

            const summary = knowledgeMakeEl('div', 'knowledge-list-meta', `显示 ${runs.length} / ${total} 条 run`);
            container.appendChild(summary);

            runs.forEach(run => {
                const item = knowledgeMakeEl('div', 'knowledge-run-item');
                const top = knowledgeMakeEl('div', 'knowledge-run-top');
                top.appendChild(knowledgeMakeEl('strong', '', run.runId ? `任务 ${run.runId}` : '未知任务'));
                top.appendChild(knowledgeMakeEl(
                    'span',
                    `knowledge-status-pill ${run.status === 'completed' ? 'is-ok' : (run.status === 'failed' ? 'is-error' : 'is-running')}`,
                    `${run.status || '--'} / ${run.phase || '--'}`
                ));
                item.appendChild(top);

                item.appendChild(knowledgeMakeEl('div', 'knowledge-run-direction', knowledgeVisibleText(run.sourceDirection && run.sourceDirection.path, 72, '未记录方向')));

                const meta = knowledgeMakeEl('div', 'knowledge-meta-row');
                knowledgeAppendMeta(meta, '提示词 ', `${run.promptTotal}/${run.promptTotalRaw || run.promptTotal}`);
                knowledgeAppendMeta(meta, '丢弃 ', run.promptTotalRejected || 0);
                knowledgeAppendMeta(meta, '保存 ', run.savedCount || 0);
                knowledgeAppendMeta(meta, '资产 ', run.assetCount || run.assetIds.length || 0);
                knowledgeAppendMeta(meta, '开始 ', knowledgeFormatDate(run.startedAt || run.createdAt));
                item.appendChild(meta);

                if (run.message) {
                    item.appendChild(knowledgeMakeEl('div', 'knowledge-run-message', knowledgeVisibleText(run.message, 150)));
                }
                const candidateReview = renderKnowledgeDirectionCandidateReview(run.directionCandidateReview);
                if (candidateReview) item.appendChild(candidateReview);
                const actions = knowledgeMakeEl('div', 'knowledge-item-actions');
                const draftBtn = knowledgeMakeEl('button', 'btn btn-secondary', '提取方向草案');
                draftBtn.type = 'button';
                draftBtn.disabled = !run.runId;
                draftBtn.addEventListener('click', () => extractKnowledgeDraftsFromRun(run.runId));
                actions.appendChild(draftBtn);
                item.appendChild(actions);
                container.appendChild(item);
            });
        }

        async function loadCreativeKnowledgeDirections() {
            const data = await fetchKnowledgeJson(
                `/api/creative-knowledge/directions${buildKnowledgeQuery('knowledgeDirectionSearch', { limit: 500 })}`,
                '读取方向库失败'
            );
            creativeKnowledgeState.directions = Array.isArray(data.directions) ? data.directions : [];
            creativeKnowledgeState.directionTotal = Number(data.total) || creativeKnowledgeState.directions.length;
            const knownIds = new Set(creativeKnowledgeState.directions.map(knowledgeDirectionSelectionId).filter(Boolean));
            Array.from(creativeKnowledgeState.selectedDirectionIds).forEach(id => {
                if (!knownIds.has(id)) creativeKnowledgeState.selectedDirectionIds.delete(id);
            });
            renderKnowledgeDirectionListFromState();
            return data;
        }

        async function loadCreativeKnowledgeDrafts() {
            const status = document.getElementById('knowledgeDraftStatusFilter')?.value || '';
            const governance = document.getElementById('knowledgeDraftGovernanceFilter')?.value || '';
            const data = await fetchKnowledgeJson(
                `/api/creative-knowledge/direction-drafts${buildKnowledgeQuery('knowledgeDraftSearch', { limit: 80, status, governance })}`,
                '读取方向草案失败'
            );
            creativeKnowledgeState.drafts = Array.isArray(data.drafts) ? data.drafts : [];
            renderKnowledgeDrafts(
                creativeKnowledgeState.drafts,
                Number(data.total) || creativeKnowledgeState.drafts.length,
                data.counts || {},
                data.governanceCounts || {}
            );
            return data;
        }

        async function loadCreativeKnowledgeAssets() {
            const reviewStatus = document.getElementById('knowledgeAssetReviewFilter')?.value || '';
            const data = await fetchKnowledgeJson(
                `/api/creative-knowledge/assets${buildKnowledgeQuery('knowledgeAssetSearch', { limit: 48, reviewStatus })}`,
                '读取资产库失败'
            );
            creativeKnowledgeState.assets = Array.isArray(data.assets) ? data.assets : [];
            renderKnowledgeAssets(creativeKnowledgeState.assets, Number(data.total) || creativeKnowledgeState.assets.length);
            return data;
        }

        async function loadCreativeKnowledgeRuns() {
            const data = await fetchKnowledgeJson(
                `/api/creative-knowledge/runs${buildKnowledgeQuery('knowledgeRunSearch', { limit: 30 })}`,
                '读取运行记录失败'
            );
            creativeKnowledgeState.runs = Array.isArray(data.runs) ? data.runs : [];
            renderKnowledgeRuns(creativeKnowledgeState.runs, Number(data.total) || creativeKnowledgeState.runs.length);
            return data;
        }

        const KNOWLEDGE_DNA_DIMENSION_LABELS = {
            atmosphere: '标签',
            camera: '标签',
            event: '标签',
            scale: '标签',
            visualHook: '标签'
        };

        const KNOWLEDGE_DNA_TAG_CLASS = {
            atmosphere: 'is-atmosphere',
            camera: 'is-camera',
            event: 'is-event',
            scale: 'is-scale',
            visualHook: 'is-hook'
        };

        const KNOWLEDGE_DNA_DISPLAY_LABELS = {
            'comic relief under danger': '危中幽默',
            'urgent hope': '急迫希望',
            'last chance pressure': '最后机会',
            'surprise reward': '惊喜奖励',
            'low-angle close foreground': '低机位近景',
            'macro prop with human stakes': '道具特写',
            'top-down map-like view': '地图俯瞰',
            'evacuation countdown': '撤离倒计时',
            'temporary bridge': '临时桥',
            'blocked entrance': '入口受阻',
            'collapsing shelter': '庇护坍塌',
            'escort through danger': '护送穿越',
            'frozen vehicle route': '冰面车路',
            'repair restart': '维修重启',
            'evacuation': '撤离',
            'danger': '危险',
            'hope': '希望',
            'warm hope': '温暖希望',
            'warning': '警示',
            'discovery': '发现',
            'first person': '第一人称',
            'first-person': '第一人称',
            'overhead': '俯瞰',
            'top down': '俯瞰',
            'close-up': '近景',
            'close up': '近景',
            'low angle': '低机位'
        };

        function knowledgeDnaDisplayKey(value = '') {
            return String(value || '')
                .trim()
                .replace(/[()（）\d]+/g, '')
                .replace(/[_/]+/g, ' ')
                .replace(/\s+/g, ' ')
                .toLowerCase();
        }

        function knowledgeDnaHookLabel(value = '') {
            const text = String(value || '').trim();
            if (!text) return '';
            if (text.length <= 8 && !/[a-z]/i.test(text)) return text;
            const rules = [
                [/方向正确|主体明确|一眼|吸引人/, '主体明确'],
                [/没啥吸引|常规图|吸引力弱/, '吸引力弱'],
                [/探索发现感弱|发现感弱/, '探索弱'],
                [/多余.*文字|上下.*文字|文字信息|英文|小字|包装|品牌|标识|地名|UI/, '文字干扰'],
                [/信号弹|信号|光束/, '信号线索'],
                [/标语|文字|短牌|中文/, '中文标语'],
                [/路标|指示牌|箭头/, '指示路标'],
                [/巨型|地标/, '巨型地标'],
                [/暖光|暖灯|窗口|灯/, '暖光目标'],
                [/选择压力|犹豫|是否|转向|分叉/, '选择压力'],
                [/守护|保护阵型|围成保护|护住/, '守护动作'],
                [/手套|伸手|手部|拉扯/, '手部动作'],
                [/绳梯|绳索|绳结|攀/, '绳索攀爬'],
                [/工具箱|工具小件|破冰工具/, '工具箱'],
                [/零件包|维修零件|破损零件/, '维修零件'],
                [/搭建支架|搭建|支架/, '搭建动作'],
                [/车辆|车辙|雪橇|小推车|载具/, '载具路线'],
                [/桥|桥面|断桥/, '桥梁通行'],
                [/裂缝|裂冰|冰裂/, '冰裂危机'],
                [/补给|物资|药包|木柴|热汤/, '物资补给'],
                [/地图|路线/, '地图线索'],
                [/入口|仓门|门/, '入口目标'],
                [/火光|暖炉|炉/, '火光庇护'],
                [/冰洞|天窗|洞口/, '洞口撤离'],
                [/队列|排队|订单/, '订单队列']
            ];
            const found = rules.find(([pattern]) => pattern.test(text));
            if (found) return found[1];
            return text.slice(0, 8);
        }

        function knowledgeDnaDisplayLabel(value = '', dimension = '') {
            const raw = String(value || '').trim();
            if (!raw) return '';
            if (dimension === 'visualHook') return knowledgeDnaHookLabel(raw);
            const key = knowledgeDnaDisplayKey(raw);
            if (KNOWLEDGE_DNA_DISPLAY_LABELS[key]) return KNOWLEDGE_DNA_DISPLAY_LABELS[key];
            if (/^[a-z0-9\s-]+$/i.test(raw)) {
                if (key.includes('comic')) return '危中幽默';
                if (key.includes('urgent') && key.includes('hope')) return '急迫希望';
                if (key.includes('last') && key.includes('chance')) return '最后机会';
                if (key.includes('surprise') || key.includes('reward')) return '惊喜奖励';
                if (key.includes('low') && key.includes('angle')) return '低机位';
                if (key.includes('macro') || key.includes('prop')) return '道具特写';
                if (key.includes('top') || key.includes('overhead') || key.includes('map')) return '俯瞰';
                if (key.includes('evac')) return '撤离';
                if (key.includes('shelter')) return '庇护所';
                if (key.includes('escort')) return '护送';
                if (key.includes('repair')) return '维修';
                if (key.includes('danger')) return '危险';
                if (key.includes('hope')) return '希望';
                return '未归类';
            }
            const localizedRaw = knowledgeDnaLocalizeText(raw);
            return localizedRaw.length > 8 ? localizedRaw.slice(0, 8) : localizedRaw;
        }

        function knowledgeNormalizeDirectionTag(value = '', dimension = '') {
            let text = String(value || '').trim();
            if (!text) return '';
            text = text
                .replace(/^(visualHook|dedupeReason|riskNote|productionAdvice)\s*[:：]\s*/i, '')
                .replace(/^(氛围|视角|事件|钩子|视觉钩子|DNA|视觉 DNA)\s*[:：]\s*/i, '')
                .replace(/[。；;,.，、]+$/g, '')
                .trim();
            const label = knowledgeDnaLocalizeText(knowledgeDnaDisplayLabel(text, dimension));
            if (!label || label === '未归类') return '';
            if (/^(感|镜头|动作|抓手|视觉|方向|主体|画面|制作|风险)$/.test(label)) return '';
            return label.length > 8 ? label.slice(0, 8) : label;
        }

        function knowledgeSplitDirectionTags(value, dimension = '') {
            if (Array.isArray(value)) return value.flatMap(item => knowledgeSplitDirectionTags(item, dimension));
            if (value && typeof value === 'object') return Object.values(value).flatMap(item => knowledgeSplitDirectionTags(item, dimension));
            return String(value || '')
                .split(/[、,，;；\n|/]+/)
                .map(item => knowledgeNormalizeDirectionTag(item, dimension))
                .filter(Boolean);
        }

        function knowledgeUniqueTags(values = [], limit = 5) {
            const seen = new Set();
            const output = [];
            values.forEach(value => {
                const tag = knowledgeNormalizeDirectionTag(value);
                if (!tag || seen.has(tag)) return;
                seen.add(tag);
                output.push(tag);
            });
            return output.slice(0, limit);
        }

        function knowledgeDirectionTagValues(source = {}, limit = 5) {
            const visualDna = source.visualDna && typeof source.visualDna === 'object' ? source.visualDna : {};
            const dimensions = source.dimensions && typeof source.dimensions === 'object' ? source.dimensions : {};
            const directTags = [
                source.mainTags,
                source.directionTags,
                source.tags,
                source.extraTags
            ].flatMap(item => knowledgeSplitDirectionTags(item));
            const legacyTags = [
                visualDna.mainTags,
                visualDna.atmosphere,
                visualDna.camera,
                visualDna.event,
                visualDna.visualHook,
                dimensions.mood,
                dimensions.atmosphere,
                dimensions.perspective,
                dimensions.camera,
                dimensions.narrative,
                dimensions.event,
                dimensions.hook,
                dimensions.visualHook,
                source.visualHook
            ].flatMap(item => knowledgeSplitDirectionTags(item));
            const textTags = [
                source.name,
                source.newDirectionName,
                source.path,
                source.description
            ].flatMap(item => knowledgeSplitDirectionTags(item)).filter(tag => tag.length <= 6);
            return knowledgeUniqueTags(directTags.concat(legacyTags, textTags), limit);
        }

        function knowledgeDirectionRiskTags(source = {}, limit = 5) {
            return knowledgeUniqueTags([
                source.riskTags,
                source.avoidRules,
                source.riskNote,
                source.duplicateRisk
            ].flatMap(item => knowledgeSplitDirectionTags(item)), limit);
        }

        function renderKnowledgeDirectionTagPills(tags = [], options = {}) {
            const row = knowledgeMakeEl('div', `direction-tag-pill-row${options.risk ? ' is-risk' : ''}${options.compact ? ' is-compact' : ''}`.trim());
            const list = knowledgeUniqueTags(tags, options.limit || 5);
            if (!list.length) {
                row.appendChild(knowledgeMakeEl('span', 'direction-tag-pill is-empty', options.emptyText || '标签待分析'));
                return row;
            }
            list.forEach(tagText => {
                const tag = knowledgeMakeEl('span', 'direction-tag-pill', tagText);
                tag.title = tagText;
                row.appendChild(tag);
            });
            if (Array.isArray(tags) && tags.length > list.length) {
                row.appendChild(knowledgeMakeEl('span', 'direction-tag-pill is-more', `+${tags.length - list.length}`));
            }
            return row;
        }

        function knowledgeDnaValueWithCount(item = {}, dimension = '') {
            const label = knowledgeVisibleText(knowledgeDnaDisplayLabel(item.value || item.name || item, dimension), 24, '--');
            const count = Number(item.count) || 0;
            return count ? `${label}(${count})` : label;
        }

        function knowledgeEscapeRegExp(value = '') {
            return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        }

        function knowledgeDnaLocalizeText(text = '') {
            let output = String(text || '');
            Object.entries(KNOWLEDGE_DNA_DISPLAY_LABELS)
                .sort((a, b) => b[0].length - a[0].length)
                .forEach(([from, to]) => {
                    output = output.replace(new RegExp(knowledgeEscapeRegExp(from), 'gi'), to);
                });
            [
                ['macro prop with human stakes', '道具特写'],
                ['comic relief under danger', '危中幽默'],
                ['urgent hope', '急迫希望'],
                ['low-angle close foreground', '低机位近景'],
                ['collapsing shelter', '庇护坍塌'],
                ['escort through danger', '护送穿越'],
                ['frozen vehicle route', '冰面车路'],
                ['repair restart', '维修重启'],
                ['evacuation countdown', '撤离倒计时'],
                ['temporary bridge', '临时桥'],
                ['blocked entrance', '入口受阻'],
                ['surprise reward', '惊喜奖励'],
                ['last chance pressure', '最后机会'],
                ['top-down map-like view', '地图俯瞰'],
                ['over-shoulder pursuit', '越肩追逐'],
                ['moral tradeoff', '取舍抉择'],
                ['resource contest', '资源争夺'],
                ['seeded axis 的 frozen vehicle route', '冻车路线标签'],
                ['visible hook 为 signal flare clue', '画面重点改为信号弹线索'],
                ['静态氛围', '静态场景'],
                ['风景氛围', '风景感'],
                ['场景氛围', '场景感'],
                ['情绪氛围', '情绪感'],
                ['冰雪氛围', '冰雪感'],
                ['事件机制', '画面机制'],
                ['明确事件', '明确动作'],
                ['广告钩子', '画面重点'],
                ['紧张氛围', '紧张感'],
                ['冰雪末日氛围', '冰雪末日感'],
                ['多视角', '多镜头'],
                ['不同视角', '不同镜头'],
                ['direction tags complete', '标签完整'],
                ['matches high-performing tags', '命中高表现标签'],
                ['covers gap tags', '覆盖缺口标签'],
                ['tag combo is new in current pool', '本轮组合新'],
                ['hits risk tags', '命中风险标签'],
                ['direction tags', '方向标签'],
                ['DNA完整度高', '标签完整'],
                ['DNA基本可用', '标签可用'],
                ['DNA维度缺失', '标签缺失'],
                ['DNA组合有差异', '标签组合有差异'],
                ['本轮DNA组合重复', '本轮标签组合重复'],
                ['匹配高采纳DNA', '匹配高采纳标签'],
                ['历史DNA组合重复', '历史标签组合重复'],
                ['命中风险DNA', '命中风险标签'],
                ['seeded axis', '方向标签'],
                ['visible hook', '画面重点'],
                ['visual hook', '画面重点'],
                ['signal flare clue', '信号弹线索'],
                ['视觉 DNA 组合', '方向标签组合'],
                ['视觉DNA组合', '方向标签组合'],
                ['视觉 DNA', '方向标签'],
                ['视觉DNA', '方向标签']
            ].forEach(([from, to]) => {
                output = output.replace(new RegExp(knowledgeEscapeRegExp(from), 'gi'), to);
            });
            output = output
                .replace(/\b(visualDna|atmosphere|camera|event|visualHook)\b\s*/gi, '')
                .replace(/\bDNA\b/gi, '方向标签')
                .replace(/DNA/g, '方向标签')
                .replace(/视觉\s*钩子/g, '画面重点')
                .replace(/钩子/g, '重点')
                .replace(/视角/g, '镜头')
                .replace(/事件/g, '动作')
                .replace(/氛围/g, '感')
                .replace(/\s{2,}/g, ' ')
                .trim();
            return output;
        }

        function knowledgeVisibleText(value = '', maxLength = 90, fallback = '') {
            const localized = knowledgeDnaLocalizeText(knowledgeText(value, fallback));
            return knowledgeShortText(localized || fallback, maxLength);
        }

        function setKnowledgeVisualDnaInfo(className, text) {
            const infoBox = document.getElementById('knowledgeVisualDnaInfo');
            if (!infoBox) return;
            infoBox.className = className;
            infoBox.textContent = text;
        }

        function knowledgeDnaPreferenceText(items = [], limit = 5) {
            const values = Array.isArray(items) ? items : [];
            return values.length
                ? values.slice(0, limit).map(item => knowledgeDnaValueWithCount(item)).join('、')
                : '--';
        }

        function knowledgeDnaSourceText(sample = {}) {
            const labels = {
                feedback: '反馈采纳',
                'direction-evidence': '成功案例',
                'direction-expansion-history': '入选候选',
                'direction-drafts': '已采纳方向'
            };
            return sample.sourceLabel || labels[sample.source] || sample.source || '样本';
        }

        function renderKnowledgeDnaChip(label = '', value = '', dimension = '') {
            const chip = knowledgeMakeEl('span', `knowledge-dna-chip ${KNOWLEDGE_DNA_TAG_CLASS[dimension] || ''}`.trim());
            const val = knowledgeMakeEl('em', '', value || '--');
            chip.appendChild(val);
            chip.title = value || '方向标签';
            return chip;
        }

        function renderKnowledgeDnaTags(source = {}) {
            const row = knowledgeMakeEl('div', 'knowledge-dna-tags');
            const dna = source && source.visualDna && typeof source.visualDna === 'object' ? source.visualDna : {};
            const legacyTags = Array.isArray(source) ? source : (Array.isArray(source.tags) ? source.tags : []);
            const values = [
                ['方向标签', knowledgeDnaDisplayLabel((dna.atmosphere || [legacyTags[0]])[0], 'atmosphere'), 'atmosphere'],
                ['方向标签', knowledgeDnaDisplayLabel((dna.camera || [legacyTags[1]])[0], 'camera'), 'camera'],
                ['方向标签', knowledgeDnaDisplayLabel((dna.event || [legacyTags[2]])[0], 'event'), 'event'],
                ['方向标签', knowledgeDnaDisplayLabel((dna.visualHook || [legacyTags[4] || legacyTags[3]])[0], 'visualHook'), 'visualHook']
            ].filter(([, value]) => value);
            if (!values.length) {
                row.appendChild(knowledgeMakeEl('span', 'is-empty', '标签待分析'));
                return row;
            }
            values.forEach(([label, value, dimension]) => row.appendChild(renderKnowledgeDnaChip(label, value, dimension)));
            return row;
        }

        function renderKnowledgeDnaSample(sample = {}) {
            const item = knowledgeMakeEl('div', 'knowledge-dna-sample');
            const top = knowledgeMakeEl('div', 'knowledge-dna-sample-top');
            top.appendChild(knowledgeMakeEl('strong', '', knowledgeVisibleText(sample.name || sample.directionPath, 48, '未命名采纳样本')));
            top.appendChild(knowledgeMakeEl('span', '', knowledgeDnaSourceText(sample)));
            item.appendChild(top);
            if (sample.directionPath) {
                item.appendChild(knowledgeMakeEl('em', 'knowledge-dna-path', knowledgeVisibleText(sample.directionPath, 72)));
            }
            item.appendChild(renderKnowledgeDnaTags(sample));
            if (sample.evidence) {
                item.appendChild(knowledgeMakeEl('p', 'knowledge-dna-evidence', knowledgeShortText(knowledgeDnaLocalizeText(sample.evidence), 112)));
            }
            return item;
        }

        function renderKnowledgeDnaPreferenceTags(items = [], dimension = '', limit = 4) {
            const row = knowledgeMakeEl('div', 'knowledge-dna-preference-tags');
            const values = Array.isArray(items) ? items.slice(0, limit) : [];
            if (!values.length) {
                row.appendChild(knowledgeMakeEl('span', 'knowledge-dna-preference-empty', '--'));
                return row;
            }
            values.forEach(item => {
                const itemDimension = item.dimension || dimension;
                const tag = knowledgeMakeEl('span', `knowledge-dna-preference-tag ${KNOWLEDGE_DNA_TAG_CLASS[itemDimension] || (dimension === 'risk' ? 'is-risk' : '')}`.trim());
                const label = knowledgeMakeEl('em', '', knowledgeNormalizeDirectionTag(item.value || item.name || item, itemDimension) || '--');
                const count = knowledgeMakeEl('b', '', knowledgeFormatNumber(item.count || 0));
                tag.appendChild(label);
                tag.appendChild(count);
                tag.title = `${knowledgeVisibleText(item.value || item.name || item, 32, '--')}：${Number(item.count) || 0} 次`;
                row.appendChild(tag);
            });
            return row;
        }

        function renderKnowledgeDnaAdoptionBoard(groups = []) {
            const container = document.getElementById('knowledgeDnaAdoptionBoard');
            if (!container) return;
            knowledgeClear(container);
            const list = Array.isArray(groups) ? groups : [];
            if (!list.length) {
                container.appendChild(knowledgeMakeEl('div', 'knowledge-empty', '暂无采纳样本。审核好图、采纳方向或运行创意拓展后，这里会形成维护记录。'));
                return;
            }

            list.slice(0, 10).forEach(group => {
                const card = knowledgeMakeEl('article', 'knowledge-dna-adoption-group');
                const head = knowledgeMakeEl('div', 'knowledge-dna-group-head');
                head.appendChild(knowledgeMakeEl('strong', '', knowledgeVisibleText(group.label || group.path, 56, '未分组')));
                head.appendChild(knowledgeMakeEl('span', '', knowledgeFormatNumber(group.sampleCount || 0)));
                card.appendChild(head);

                const sources = group.sources || {};
                const meta = knowledgeMakeEl('div', 'knowledge-meta-row');
                knowledgeAppendMeta(meta, '反馈 ', sources.feedback || 0);
                knowledgeAppendMeta(meta, '案例 ', sources.evidence || 0);
                knowledgeAppendMeta(meta, '入选 ', sources.history || 0);
                knowledgeAppendMeta(meta, '采纳 ', sources.drafts || 0);
                card.appendChild(meta);

                const samples = knowledgeMakeEl('div', 'knowledge-dna-sample-list');
                (Array.isArray(group.samples) ? group.samples : []).slice(0, 6).forEach(sample => {
                    samples.appendChild(renderKnowledgeDnaSample(sample));
                });
                if (!samples.children.length) {
                    samples.appendChild(knowledgeMakeEl('div', 'knowledge-empty', '该方向暂未展开样本明细'));
                }
                card.appendChild(samples);
                container.appendChild(card);
            });
        }

        function renderKnowledgeDnaPreferenceBoard(groups = []) {
            const container = document.getElementById('knowledgeDnaPreferenceBoard');
            if (!container) return;
            knowledgeClear(container);
            const list = Array.isArray(groups) ? groups : [];
            if (!list.length) {
                container.appendChild(knowledgeMakeEl('div', 'knowledge-empty', '暂无风格偏好统计。'));
                return;
            }

            list.slice(0, 12).forEach(group => {
                const card = knowledgeMakeEl('article', 'knowledge-dna-preference-group');
                const head = knowledgeMakeEl('div', 'knowledge-dna-group-head');
                head.appendChild(knowledgeMakeEl('strong', '', knowledgeVisibleText(group.label || group.path, 56, '未分组')));
                head.appendChild(knowledgeMakeEl('span', '', `${knowledgeFormatNumber(group.sampleCount || 0)} 样本`));
                card.appendChild(head);

                const prefs = group.preferences || {};
                const allPreferenceTags = ['atmosphere', 'camera', 'event', 'scale', 'visualHook']
                    .flatMap(key => (Array.isArray(prefs[key]) ? prefs[key] : []).map(item => ({ ...item, dimension: key })))
                    .sort((a, b) => (Number(b.count) || 0) - (Number(a.count) || 0));
                [
                    ['高频标签', allPreferenceTags, 'mixed', 10],
                    ['风险标签', prefs.risks || prefs.riskTags || prefs.avoid || [], 'risk', 6],
                    ['缺口标签', prefs.gaps || prefs.missingTags || prefs.opportunityTags || [], 'gap', 6]
                ].forEach(([label, items, key, limit]) => {
                    const row = knowledgeMakeEl('div', 'knowledge-dna-preference-line');
                    row.appendChild(knowledgeMakeEl('strong', '', label));
                    row.appendChild(renderKnowledgeDnaPreferenceTags(items, key, limit));
                    card.appendChild(row);
                });
                container.appendChild(card);
            });
        }

        function renderKnowledgeDnaRuleDrafts(rules = []) {
            const container = document.getElementById('knowledgeDnaRuleDrafts');
            if (!container) return;
            knowledgeClear(container);
            container.appendChild(knowledgeMakeEl('div', 'knowledge-memory-section-title', '方向标签规则草案预览'));
            const list = Array.isArray(rules) ? rules : [];
            if (!list.length) {
                container.appendChild(knowledgeMakeEl('div', 'knowledge-empty', '当前样本不足，暂未形成可沉淀的规则草案。'));
                return;
            }
            list.slice(0, 6).forEach(rule => {
                const item = knowledgeMakeEl('div', 'knowledge-dna-rule-item');
                item.appendChild(knowledgeMakeEl('strong', '', knowledgeDnaLocalizeText(rule.title || '未命名规则草案')));
                item.appendChild(knowledgeMakeEl('p', '', knowledgeDnaLocalizeText(rule.pattern || rule.action || '')));
                const meta = knowledgeMakeEl('div', 'knowledge-meta-row');
                knowledgeAppendMeta(meta, '类型 ', knowledgeMemoryRuleTypeLabel(rule.type));
                knowledgeAppendMeta(meta, '作用域 ', knowledgeMemoryRuleScopeLabel(rule));
                knowledgeAppendMeta(meta, '可信度 ', Math.round((Number(rule.confidence) || 0) * 100) + '%');
                item.appendChild(meta);
                if (Array.isArray(rule.evidence) && rule.evidence.length) {
                    item.appendChild(knowledgeMakeEl('em', '', knowledgeDnaLocalizeText(rule.evidence.slice(0, 3).join('；'))));
                }
                container.appendChild(item);
            });
        }

        function renderKnowledgeVisualDnaWorkbench(data = {}) {
            creativeKnowledgeState.visualDnaWorkbench = data || null;
            const counts = data.counts || {};
            knowledgeSetText('knowledgeDnaWorkbenchParents', knowledgeFormatNumber(counts.parentDirections));
            knowledgeSetText('knowledgeDnaWorkbenchSamples', knowledgeFormatNumber(counts.adoptionSamples));
            knowledgeSetText('knowledgeDnaWorkbenchRules', knowledgeFormatNumber(counts.suggestedRules));
            renderKnowledgeDnaAdoptionBoard(data.adoptionPatterns || []);
            renderKnowledgeDnaPreferenceBoard(data.stylePreferences || []);
            renderKnowledgeDnaRuleDrafts(data.suggestedRules || []);
            setKnowledgeVisualDnaInfo(
                'info-box success',
                `方向标签工作台已刷新：采纳样本 ${knowledgeFormatNumber(counts.adoptionSamples || 0)} 条，候选规则 ${knowledgeFormatNumber(counts.suggestedRules || 0)} 条。`
            );
        }

        async function loadKnowledgeVisualDnaWorkbench() {
            const data = await fetchKnowledgeJson('/api/creative-knowledge/visual-dna/workbench', '读取方向标签工作台失败');
            renderKnowledgeVisualDnaWorkbench(data);
            return data;
        }

        async function generateKnowledgeVisualDnaRules() {
            const button = document.getElementById('knowledgeDnaRuleDraftBtn');
            try {
                if (button) {
                    button.disabled = true;
                    button.textContent = '生成中...';
                }
                setKnowledgeVisualDnaInfo('info-box loading', '正在把高频方向标签转成经验规则草案...');
                const data = await fetchKnowledgeJson('/api/creative-knowledge/visual-dna/rule-drafts', '生成标签规则草案失败', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ limit: 12 })
                });
                if (data.memory) {
                    creativeKnowledgeState.memory = data.memory;
                    renderCreativeKnowledgeMemory(data.memory || {});
                } else {
                    await loadCreativeKnowledgeMemory();
                }
                await loadKnowledgeVisualDnaWorkbench();
                setKnowledgeVisualDnaInfo(data.success ? 'info-box success' : 'info-box error', data.message || '标签规则草案已处理');
                if (typeof showToast === 'function') showToast(data.message || '标签规则草案已处理', data.success ? 'success' : 'error');
            } catch (error) {
                setKnowledgeVisualDnaInfo('info-box error', error.message || '生成标签规则草案失败');
            } finally {
                if (button) {
                    button.disabled = false;
                    button.textContent = '生成标签规则草案';
                }
            }
        }

        function knowledgeMemoryRuleTypeLabel(type) {
            const labels = {
                preferred: '偏好',
                avoid: '规避',
                prompt: '提示词',
                priority: '优先级',
                style: '风格'
            };
            return labels[type] || type || '规则';
        }

        function knowledgeMemoryRuleScopeLabel(rule = {}) {
            if (rule.scope === 'dimension') return `标签层：${knowledgeVisibleText(rule.target, 48, '未指定')}`;
            if (rule.scope === 'node') return `方向层：${knowledgeVisibleText(rule.target, 48, '未指定')}`;
            return '全局';
        }

        function renderKnowledgeMemoryReport(memory = {}) {
            const container = document.getElementById('knowledgeMemoryReport');
            if (!container) return;
            knowledgeClear(container);
            const report = (Array.isArray(memory.recentReports) && memory.recentReports[0])
                || (Array.isArray(memory.learningReports) && memory.learningReports[0])
                || null;
            if (!report) {
                container.appendChild(knowledgeMakeEl('div', 'knowledge-empty', '还没有学习报告。审核一批图后点击“消化最近反馈”。'));
                return;
            }

            const card = knowledgeMakeEl('div', 'knowledge-memory-report-card');
            card.appendChild(knowledgeMakeEl('strong', '', knowledgeVisibleText(report.title, 72, '反馈学习报告')));
            card.appendChild(knowledgeMakeEl('p', '', knowledgeVisibleText(report.summary, 180, '本轮已生成反馈学习结果。')));

            const groups = [
                ['正向偏好', report.positiveFindings],
                ['负向规避', report.negativeFindings],
                ['下轮建议', report.nextRunAdvice]
            ];
            groups.forEach(([title, items]) => {
                if (!Array.isArray(items) || !items.length) return;
                const block = knowledgeMakeEl('div', 'knowledge-memory-report-group');
                block.appendChild(knowledgeMakeEl('span', '', title));
                const list = knowledgeMakeEl('ul', '');
                items.slice(0, 5).forEach(item => {
                    list.appendChild(knowledgeMakeEl('li', '', knowledgeVisibleText(item, 140)));
                });
                block.appendChild(list);
                card.appendChild(block);
            });
            container.appendChild(card);
        }

        function createKnowledgeMemoryField(rule, field, label, multiline = false) {
            const group = knowledgeMakeEl('label', 'knowledge-memory-field');
            group.appendChild(knowledgeMakeEl('span', '', label));
            const input = multiline ? document.createElement('textarea') : document.createElement('input');
            input.value = knowledgeDnaLocalizeText(rule[field] || '');
            input.dataset.memoryField = field;
            if (multiline) input.rows = 2;
            group.appendChild(input);
            return group;
        }

        function renderKnowledgeMemoryRule(rule = {}, mode = 'draft') {
            const item = knowledgeMakeEl('div', `knowledge-memory-rule ${mode === 'active' ? 'is-active' : 'is-draft'}`);
            item.dataset.ruleId = rule.ruleId || '';
            const top = knowledgeMakeEl('div', 'knowledge-memory-rule-top');
            top.appendChild(knowledgeMakeEl('strong', '', knowledgeVisibleText(rule.title, 72, '未命名规则')));
            top.appendChild(knowledgeMakeEl('span', 'knowledge-status-pill is-ok', `${knowledgeMemoryRuleTypeLabel(rule.type)} / ${knowledgeMemoryRuleScopeLabel(rule)}`));
            item.appendChild(top);

            item.appendChild(createKnowledgeMemoryField(rule, 'title', '标题'));
            item.appendChild(createKnowledgeMemoryField(rule, 'pattern', '规则', true));
            item.appendChild(createKnowledgeMemoryField(rule, 'action', '下轮怎么用', true));
            item.appendChild(createKnowledgeMemoryField(rule, 'rationale', '为什么这样总结', true));

            const meta = knowledgeMakeEl('div', 'knowledge-meta-row');
            knowledgeAppendMeta(meta, '可信度 ', Math.round((Number(rule.confidence) || 0) * 100) + '%');
            knowledgeAppendMeta(meta, '证据 ', Array.isArray(rule.sourceFeedbackIds) ? rule.sourceFeedbackIds.length : 0);
            knowledgeAppendMeta(meta, '状态 ', rule.status || mode);
            item.appendChild(meta);

            if (Array.isArray(rule.evidence) && rule.evidence.length) {
                item.appendChild(knowledgeMakeEl('div', 'knowledge-memory-evidence', knowledgeDnaLocalizeText(rule.evidence.slice(0, 3).join('；'))));
            }

            const actions = knowledgeMakeEl('div', 'knowledge-item-actions');
            const saveBtn = knowledgeMakeEl('button', 'btn btn-secondary', '保存修改');
            saveBtn.type = 'button';
            saveBtn.addEventListener('click', () => saveCreativeMemoryRule(rule.ruleId));
            actions.appendChild(saveBtn);

            if (mode === 'draft') {
                const acceptBtn = knowledgeMakeEl('button', 'btn btn-primary', '启用');
                acceptBtn.type = 'button';
                acceptBtn.addEventListener('click', () => acceptCreativeMemoryRule(rule.ruleId));
                actions.appendChild(acceptBtn);

                const rejectBtn = knowledgeMakeEl('button', 'btn btn-secondary', '拒绝');
                rejectBtn.type = 'button';
                rejectBtn.addEventListener('click', () => rejectCreativeMemoryRule(rule.ruleId));
                actions.appendChild(rejectBtn);
            } else {
                const disableBtn = knowledgeMakeEl('button', 'btn btn-secondary', '禁用');
                disableBtn.type = 'button';
                disableBtn.addEventListener('click', () => disableCreativeMemoryRule(rule.ruleId));
                actions.appendChild(disableBtn);
            }
            item.appendChild(actions);
            return item;
        }

        function renderCreativeKnowledgeMemory(memory = {}) {
            const meta = document.getElementById('knowledgeMemoryMeta');
            const draftList = document.getElementById('knowledgeMemoryDraftList');
            const activeList = document.getElementById('knowledgeMemoryActiveList');
            if (meta) {
                const stats = memory.stats || {};
                meta.textContent = `草案 ${stats.totalDraftRules || 0} · 已启用 ${stats.activeRules || 0} · 学习 ${stats.totalLearningRuns || 0} 次`;
            }
            renderKnowledgeMemoryReport(memory);
            if (draftList) {
                knowledgeClear(draftList);
                draftList.appendChild(knowledgeMakeEl('div', 'knowledge-memory-section-title', '待确认规则草案'));
                const drafts = Array.isArray(memory.draftRules) ? memory.draftRules : [];
                if (!drafts.length) {
                    draftList.appendChild(knowledgeMakeEl('div', 'knowledge-empty', '暂无规则草案'));
                } else {
                    drafts.forEach(rule => draftList.appendChild(renderKnowledgeMemoryRule(rule, 'draft')));
                }
            }
            if (activeList) {
                knowledgeClear(activeList);
                activeList.appendChild(knowledgeMakeEl('div', 'knowledge-memory-section-title', '已启用规则'));
                const activeRules = Array.isArray(memory.activeRules) ? memory.activeRules : [];
                if (!activeRules.length) {
                    activeList.appendChild(knowledgeMakeEl('div', 'knowledge-empty', '暂无已启用规则'));
                } else {
                    activeRules.forEach(rule => activeList.appendChild(renderKnowledgeMemoryRule(rule, 'active')));
                }
            }
        }

        async function loadCreativeKnowledgeMemory() {
            const data = await fetchKnowledgeJson('/api/creative-knowledge/memory', '读取反馈记忆失败');
            creativeKnowledgeState.memory = data.memory || null;
            renderCreativeKnowledgeMemory(creativeKnowledgeState.memory || {});
            return data;
        }

        function collectMemoryRulePayload(ruleId) {
            const item = document.querySelector(`.knowledge-memory-rule[data-rule-id="${CSS.escape(ruleId)}"]`);
            const payload = {};
            if (!item) return payload;
            item.querySelectorAll('[data-memory-field]').forEach(field => {
                payload[field.dataset.memoryField] = field.value.trim();
            });
            return payload;
        }

        async function saveCreativeMemoryRule(ruleId) {
            try {
                const data = await fetchKnowledgeJson(`/api/creative-knowledge/memory/rules/${encodeURIComponent(ruleId)}`, '保存反馈规则失败', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(collectMemoryRulePayload(ruleId))
                });
                creativeKnowledgeState.memory = data.memory;
                renderCreativeKnowledgeMemory(data.memory || {});
                if (typeof showToast === 'function') showToast('反馈规则已保存', 'success');
            } catch (error) {
                setKnowledgeInfo('info-box error', error.message || '保存反馈规则失败');
            }
        }

        async function acceptCreativeMemoryRule(ruleId) {
            await saveCreativeMemoryRule(ruleId);
            try {
                const data = await fetchKnowledgeJson(`/api/creative-knowledge/memory/rules/${encodeURIComponent(ruleId)}/accept`, '启用反馈规则失败', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(collectMemoryRulePayload(ruleId))
                });
                creativeKnowledgeState.memory = data.memory;
                renderCreativeKnowledgeMemory(data.memory || {});
                if (typeof showToast === 'function') showToast('规则已启用，下轮 Agent 会读取', 'success');
            } catch (error) {
                setKnowledgeInfo('info-box error', error.message || '启用反馈规则失败');
            }
        }

        async function rejectCreativeMemoryRule(ruleId) {
            const reason = window.prompt('拒绝原因（可留空，会保留为反例记录）', '') || '';
            try {
                const data = await fetchKnowledgeJson(`/api/creative-knowledge/memory/rules/${encodeURIComponent(ruleId)}/reject`, '拒绝反馈规则失败', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ reason })
                });
                creativeKnowledgeState.memory = data.memory;
                renderCreativeKnowledgeMemory(data.memory || {});
                if (typeof showToast === 'function') showToast('规则草案已拒绝', 'success');
            } catch (error) {
                setKnowledgeInfo('info-box error', error.message || '拒绝反馈规则失败');
            }
        }

        async function disableCreativeMemoryRule(ruleId) {
            const reason = window.prompt('禁用原因（可留空）', '') || '';
            try {
                const data = await fetchKnowledgeJson(`/api/creative-knowledge/memory/rules/${encodeURIComponent(ruleId)}/disable`, '禁用反馈规则失败', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ reason })
                });
                creativeKnowledgeState.memory = data.memory;
                renderCreativeKnowledgeMemory(data.memory || {});
                if (typeof showToast === 'function') showToast('规则已禁用', 'success');
            } catch (error) {
                setKnowledgeInfo('info-box error', error.message || '禁用反馈规则失败');
            }
        }

        async function runCreativeFeedbackLearning() {
            const button = document.getElementById('knowledgeMemoryLearnBtn');
            try {
                if (button) {
                    button.disabled = true;
                    button.textContent = '学习中...';
                }
                setKnowledgeInfo('info-box loading', 'Feedback Learning Agent 正在消化最近反馈...');
                const data = await fetchKnowledgeJson('/api/creative-knowledge/memory/learn', '反馈学习失败', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ limit: 80 })
                });
                creativeKnowledgeState.memory = data.memory;
                renderCreativeKnowledgeMemory(data.memory || {});
                setKnowledgeInfo('info-box success', data.message || '已生成反馈学习规则草案');
            } catch (error) {
                setKnowledgeInfo('info-box error', error.message || '反馈学习失败');
            } finally {
                if (button) {
                    button.disabled = false;
                    button.textContent = '消化最近反馈';
                }
            }
        }

        async function loadCreativeKnowledgePage(options = {}) {
            if (!options.silent) {
                setKnowledgeInfo('info-box loading', '正在读取知识库...');
            }

            try {
                const [overview] = await Promise.all([
                    fetchKnowledgeJson('/api/creative-knowledge/overview', '读取知识库总览失败'),
                    loadCreativeKnowledgeDirections(),
                    loadCreativeKnowledgeDrafts(),
                    loadCreativeKnowledgeAssets(),
                    loadKnowledgeAutoCurator(),
                    loadKnowledgeVisualDnaWorkbench(),
                    loadCreativeKnowledgeMemory(),
                    loadCreativeKnowledgeRuns()
                ]);
                creativeKnowledgeState.overview = overview;
                renderKnowledgeOverview(overview);
                if (!options.silent) {
                    setKnowledgeInfo('info-box success', '知识库已刷新');
                }
                return overview;
            } catch (error) {
                setKnowledgeInfo('info-box error', error.message || '读取知识库失败');
                if (!options.silent && typeof showToast === 'function') {
                    showToast(error.message || '读取知识库失败', 'error');
                }
                return null;
            }
        }

        function debounceCreativeKnowledge(fn, waitMs = 250) {
            let timer = null;
            return (...args) => {
                clearTimeout(timer);
                timer = setTimeout(() => fn(...args), waitMs);
            };
        }

        document.addEventListener('DOMContentLoaded', () => {
            if (!document.getElementById('knowledgePage')) return;

            loadCreativeKnowledgePage({ silent: true });
            loadKnowledgeFeishuSyncStatus();
            document.getElementById('knowledgeDirectionSearch')?.addEventListener(
                'input',
                debounceCreativeKnowledge(() => loadCreativeKnowledgeDirections().catch(error => setKnowledgeInfo('info-box error', error.message)))
            );
            [
                'knowledgeDirectionSourceFilter',
                'knowledgeDirectionStatusFilter',
                'knowledgeDirectionPerformanceFilter'
            ].forEach(id => {
                document.getElementById(id)?.addEventListener('change', renderKnowledgeDirectionListFromState);
            });
            document.getElementById('knowledgeSelectVisibleDirectionsBtn')?.addEventListener('click', selectKnowledgeVisibleDirections);
            document.getElementById('knowledgeInvertVisibleDirectionsBtn')?.addEventListener('click', invertKnowledgeVisibleDirections);
            document.getElementById('knowledgeClearSelectedDirectionsBtn')?.addEventListener('click', clearKnowledgeSelectedDirections);
            document.getElementById('knowledgeBatchAnalyzeTagsBtn')?.addEventListener('click', knowledgeBatchAnalyzeDirectionTags);
            document.getElementById('knowledgeAssetSearch')?.addEventListener(
                'input',
                debounceCreativeKnowledge(() => loadCreativeKnowledgeAssets().catch(error => setKnowledgeInfo('info-box error', error.message)))
            );
            document.getElementById('knowledgeDraftSearch')?.addEventListener(
                'input',
                debounceCreativeKnowledge(() => loadCreativeKnowledgeDrafts().catch(error => setKnowledgeInfo('info-box error', error.message)))
            );
            document.getElementById('knowledgeDraftStatusFilter')?.addEventListener(
                'change',
                () => loadCreativeKnowledgeDrafts().catch(error => setKnowledgeInfo('info-box error', error.message))
            );
            document.getElementById('knowledgeDraftGovernanceFilter')?.addEventListener(
                'change',
                () => loadCreativeKnowledgeDrafts().catch(error => setKnowledgeInfo('info-box error', error.message))
            );
            document.getElementById('knowledgeAssetReviewFilter')?.addEventListener(
                'change',
                () => loadCreativeKnowledgeAssets().catch(error => setKnowledgeInfo('info-box error', error.message))
            );
            document.getElementById('knowledgeRunSearch')?.addEventListener(
                'input',
                debounceCreativeKnowledge(() => loadCreativeKnowledgeRuns().catch(error => setKnowledgeInfo('info-box error', error.message)))
            );
            document.addEventListener('keydown', event => {
                if (event.key === 'Escape') closeKnowledgeAssetDetail();
            });
        });
