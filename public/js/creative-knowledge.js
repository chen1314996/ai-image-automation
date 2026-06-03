// 知识库只读页：方向、资产和 run 的可视化入口。
        const creativeKnowledgeState = {
            overview: null,
            directions: [],
            drafts: [],
            assets: [],
            runs: [],
            memory: null,
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
            const labels = ['主题', '画风', '情绪氛围', '画面内容', '整体基调'];
            const nextLabels = labels.filter(item => item !== label).join('|');
            const pattern = new RegExp(`${label}[：:]\\s*([\\s\\S]*?)(?=[，,；;。]\\s*(?:${nextLabels})[：:]|[。\\n]|$)`);
            const match = text.match(pattern);
            return knowledgeShortText(match && match[1] ? match[1].trim() : '', maxLength);
        }

        function knowledgeAssetSummary(asset = {}) {
            return {
                direction: knowledgeShortText(asset.directionPath || asset.directionName || '未记录方向', 72),
                theme: knowledgeShortText(asset.promptDirection || asset.directionName || knowledgeExtractPromptField(asset.prompt, '主题', 76) || asset.fileName || '未记录主题', 76),
                core: knowledgeExtractPromptField(asset.prompt, '画面内容', 98) || knowledgeShortText(asset.prompt || '未记录画面核心内容', 98)
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
                card.appendChild(knowledgeMakeEl('span', '', '写入列：A:H'));
                card.appendChild(knowledgeMakeEl('span', '', '新行底色：黄色'));
                container.appendChild(card);
                preview.candidates.slice(0, 6).forEach(item => {
                    const itemCard = knowledgeMakeEl('div', 'knowledge-feishu-preview-card');
                    itemCard.appendChild(knowledgeMakeEl('strong', '', '待写回方向'));
                    itemCard.appendChild(knowledgeMakeEl('span', '', item.path || item.name || '--'));
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
                        title: 'AI 生图平台控制面板',
                        summary: '常用按钮：状态、进度、日志、暂停当前任务、继续任务、重启工作流。'
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
            knowledgeSetText('knowledgeImportedAt', knowledgeFormatDate(data.importedAt));
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
            const name = knowledgeMakeEl('span', 'knowledge-tag-name', node.name);
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
                container.appendChild(knowledgeMakeEl('div', 'knowledge-empty', '暂无方向数据'));
                return;
            }

            const tree = buildKnowledgeTagTree(directions);
            Array.from(tree.values())
                .sort((a, b) => Number(a.order) - Number(b.order))
                .forEach(node => container.appendChild(renderKnowledgeTagNode(node, 0)));
        }

        function renderKnowledgeDirections(directions = [], total = directions.length) {
            const container = document.getElementById('knowledgeDirectionList');
            const meta = document.getElementById('knowledgeDirectionMeta');
            if (!container) return;
            knowledgeClear(container);
            if (meta) meta.textContent = `显示 ${directions.length} / ${total} 个方向`;

            if (!directions.length) {
                container.appendChild(knowledgeMakeEl('div', 'knowledge-empty', '暂无方向数据'));
                return;
            }

            directions.forEach(direction => {
                const stats = direction.knowledgeStats || {};
                const item = knowledgeMakeEl('div', 'knowledge-direction-item');
                const title = knowledgeMakeEl('div', 'knowledge-direction-title');
                title.appendChild(knowledgeMakeEl('strong', '', direction.path || direction.name || '未命名方向'));
                const directionStatus = knowledgeDirectionStatus(direction);
                title.appendChild(knowledgeDirectionStatusPill(directionStatus));
                item.appendChild(title);

                item.appendChild(knowledgeMakeEl(
                    'div',
                    'knowledge-direction-desc',
                    knowledgeShortText(direction.description || '无描述', 120)
                ));

                const referenceImages = Array.isArray(direction.referenceImages)
                    ? direction.referenceImages.filter(image => image && image.imageUrl)
                    : [];
                if (referenceImages.length) {
                    const refs = knowledgeMakeEl('div', 'knowledge-reference-strip');
                    referenceImages.slice(0, 3).forEach((image, index) => {
                        const link = knowledgeMakeEl('a', 'knowledge-reference-thumb');
                        link.href = image.imageUrl;
                        link.target = '_blank';
                        link.rel = 'noopener';
                        link.title = image.fileName || `参考图 ${index + 1}`;
                        const img = document.createElement('img');
                        img.src = image.imageUrl;
                        img.alt = image.fileName || `参考图 ${index + 1}`;
                        img.loading = 'lazy';
                        link.appendChild(img);
                        refs.appendChild(link);
                    });
                    item.appendChild(refs);
                }

                const metaRow = knowledgeMakeEl('div', 'knowledge-meta-row');
                knowledgeAppendMeta(metaRow, '参考线索 ', Number(stats.referenceHintCount) || 0);
                knowledgeAppendMeta(metaRow, '匹配图 ', Number(stats.matchedReferenceCount) || 0);
                knowledgeAppendMeta(metaRow, 'run ', Number(stats.runCount) || 0);
                knowledgeAppendMeta(metaRow, '资产 ', Number(stats.assetCount) || 0);
                knowledgeAppendMeta(metaRow, '成功案例 ', Number(direction.evidenceCount || (direction.evidenceStats && direction.evidenceStats.successCaseCount)) || 0);
                knowledgeAppendMeta(metaRow, 'prompt ', Number(direction.stats && direction.stats.promptCount) || 0);
                item.appendChild(metaRow);

                const actions = knowledgeMakeEl('div', 'knowledge-item-actions');
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

        function renderKnowledgeDrafts(drafts = [], total = drafts.length, counts = {}) {
            const container = document.getElementById('knowledgeDraftList');
            const meta = document.getElementById('knowledgeDraftMeta');
            if (!container) return;
            knowledgeClear(container);
            if (meta) {
                meta.textContent = `显示 ${drafts.length} / ${total} 个草案 · 待审 ${counts.draft || 0} · 已采纳 ${counts.accepted || 0} · 已拒绝 ${counts.rejected || 0}`;
            }

            if (!drafts.length) {
                container.appendChild(knowledgeMakeEl('div', 'knowledge-empty', '暂无方向草案。可在运行记录里从某次 run 提取，也可以从资产详情里收录好方向。'));
                return;
            }

            drafts.forEach(draft => {
                const item = knowledgeMakeEl('div', 'knowledge-draft-item');
                const top = knowledgeMakeEl('div', 'knowledge-direction-title');
                top.appendChild(knowledgeMakeEl('strong', '', draft.path || draft.name || '未命名方向草案'));
                top.appendChild(knowledgeDirectionStatusPill(draft.status || 'draft'));
                item.appendChild(top);

                item.appendChild(knowledgeMakeEl('div', 'knowledge-direction-desc', knowledgeShortText(draft.description || '无描述', 160)));

                const metaRow = knowledgeMakeEl('div', 'knowledge-meta-row');
                knowledgeAppendMeta(metaRow, '来源 run ', draft.sourceRunId || '--');
                knowledgeAppendMeta(metaRow, '父方向 ', draft.sourceDirectionPath || draft.sourceDirectionName || '--');
                knowledgeAppendMeta(metaRow, 'prompt ', draft.promptCount || (draft.prompts || []).length || 0);
                knowledgeAppendMeta(metaRow, '策略 ', knowledgeShortText(draft.sourceStrategy || '--', 48));
                item.appendChild(metaRow);

                if (Array.isArray(draft.similarDirections) && draft.similarDirections.length) {
                    const similar = knowledgeMakeEl('div', 'knowledge-draft-similar');
                    draft.similarDirections.slice(0, 4).forEach(direction => {
                        similar.appendChild(knowledgeDirectionStatusPill(
                            knowledgeDirectionStatus(direction),
                            `${direction.id || '--'} · ${knowledgeShortText(direction.path || direction.name, 36)}`
                        ));
                    });
                    item.appendChild(similar);
                }

                if (Array.isArray(draft.prompts) && draft.prompts.length) {
                    const details = document.createElement('details');
                    details.className = 'knowledge-draft-prompts';
                    const summary = document.createElement('summary');
                    summary.textContent = `查看 ${draft.prompts.length} 条样例 prompt`;
                    details.appendChild(summary);
                    draft.prompts.slice(0, 5).forEach(prompt => {
                        details.appendChild(knowledgeMakeEl('div', 'knowledge-run-message', knowledgeShortText(prompt.prompt || prompt.finalPrompt || prompt.title, 180)));
                    });
                    item.appendChild(details);
                }

                const decision = draft.decisionReason || draft.rejectionReason || draft.archiveReason || draft.mergeReason;
                if (decision) {
                    item.appendChild(knowledgeMakeEl('div', 'knowledge-run-message', `决策记录：${knowledgeShortText(decision, 160)}`));
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

        async function acceptKnowledgeDraft(draftId, allowSimilar = false) {
            const reason = window.prompt('为什么这个方向值得进入本地成长层？', '') || '';
            const priorityText = window.prompt('优先级 1-100，默认 50', '50') || '50';
            try {
                const response = await fetch(`/api/creative-knowledge/direction-drafts/${encodeURIComponent(draftId)}/accept`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        reason,
                        priority: Number(priorityText) || 50,
                        autoRun: true,
                        allowSimilar
                    })
                });
                const data = await response.json();
                if (response.status === 409 && data.needsConfirmation) {
                    const summary = (data.similarDirections || []).map(item => `${item.id} ${item.path || item.name}`).join('\n');
                    if (window.confirm(`发现相似方向，仍要采纳为新方向吗？\n${summary}`)) {
                        return acceptKnowledgeDraft(draftId, true);
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
                const data = await fetchKnowledgeJson(`/api/creative-knowledge/direction-drafts/from-run/${encodeURIComponent(runId)}`, '从 run 提取方向草案失败', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({})
                });
                await Promise.all([loadCreativeKnowledgeDrafts(), loadCreativeKnowledgePage({ silent: true })]);
                setKnowledgeInfo('info-box success', data.message || '方向草案已提取');
                if (typeof showToast === 'function') showToast(data.message || '方向草案已提取', 'success');
            } catch (error) {
                setKnowledgeInfo('info-box error', error.message || '从 run 提取方向草案失败');
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
                const item = knowledgeMakeEl('div', 'knowledge-asset-item');
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
            const currentButton = knowledgeMakeEl('button', 'btn btn-secondary', '当前图送入重命名');
            currentButton.type = 'button';
            currentButton.disabled = !asset.assetId || !asset.fileExists;
            currentButton.addEventListener('click', () => prepareKnowledgeAssetsForPostprocess([asset.assetId]));
            actions.appendChild(currentButton);

            const groupButton = knowledgeMakeEl('button', 'btn btn-primary', '本组送入重命名');
            groupButton.type = 'button';
            const groupAssetIds = groupAssets.filter(item => item.assetId && item.fileExists).map(item => item.assetId);
            groupButton.disabled = groupAssetIds.length === 0;
            groupButton.addEventListener('click', () => prepareKnowledgeAssetsForPostprocess(groupAssetIds));
            actions.appendChild(groupButton);
            panel.appendChild(actions);

            if (!derivatives.length) {
                panel.appendChild(knowledgeMakeEl('div', 'knowledge-run-message', '还没有重命名、改尺寸、加 LOGO 或打包产物。'));
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
                await loadCreativeKnowledgeAssets();
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
            knowledgeAppendDetailRow(details, 'runId', asset.runId);
            knowledgeAppendDetailRow(details, 'prompt', asset.promptIndex ? `${asset.promptTitle || 'prompt'} / ${asset.promptIndex}` : asset.promptTitle);
            knowledgeAppendDetailRow(details, '本组图片', `${groupAssets.length} 张`);
            knowledgeAppendDetailRow(details, '保存时间', knowledgeFormatDate(asset.savedAt));
            knowledgeAppendDetailRow(details, '完整 prompt', asset.prompt, 'is-long');
            knowledgeAppendDetailRow(details, '后处理', knowledgePostprocessStatusText(asset));
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
                top.appendChild(knowledgeMakeEl('strong', '', run.runId || '未知 run'));
                top.appendChild(knowledgeMakeEl(
                    'span',
                    `knowledge-status-pill ${run.status === 'completed' ? 'is-ok' : (run.status === 'failed' ? 'is-error' : 'is-running')}`,
                    `${run.status || '--'} / ${run.phase || '--'}`
                ));
                item.appendChild(top);

                item.appendChild(knowledgeMakeEl('div', 'knowledge-run-direction', run.sourceDirection && run.sourceDirection.path ? run.sourceDirection.path : '未记录方向'));

                const meta = knowledgeMakeEl('div', 'knowledge-meta-row');
                knowledgeAppendMeta(meta, 'prompt ', `${run.promptTotal}/${run.promptTotalRaw || run.promptTotal}`);
                knowledgeAppendMeta(meta, '丢弃 ', run.promptTotalRejected || 0);
                knowledgeAppendMeta(meta, '保存 ', run.savedCount || 0);
                knowledgeAppendMeta(meta, '资产 ', run.assetCount || run.assetIds.length || 0);
                knowledgeAppendMeta(meta, '开始 ', knowledgeFormatDate(run.startedAt || run.createdAt));
                item.appendChild(meta);

                if (run.message) {
                    item.appendChild(knowledgeMakeEl('div', 'knowledge-run-message', knowledgeShortText(run.message, 150)));
                }
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
            renderKnowledgeTagMap(creativeKnowledgeState.directions);
            renderKnowledgeDirections(creativeKnowledgeState.directions, Number(data.total) || creativeKnowledgeState.directions.length);
            return data;
        }

        async function loadCreativeKnowledgeDrafts() {
            const status = document.getElementById('knowledgeDraftStatusFilter')?.value || '';
            const data = await fetchKnowledgeJson(
                `/api/creative-knowledge/direction-drafts${buildKnowledgeQuery('knowledgeDraftSearch', { limit: 80, status })}`,
                '读取方向草案失败'
            );
            creativeKnowledgeState.drafts = Array.isArray(data.drafts) ? data.drafts : [];
            renderKnowledgeDrafts(
                creativeKnowledgeState.drafts,
                Number(data.total) || creativeKnowledgeState.drafts.length,
                data.counts || {}
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

        function knowledgeMemoryRuleTypeLabel(type) {
            const labels = {
                preferred: '偏好',
                avoid: '规避',
                prompt: 'Prompt',
                priority: '优先级',
                style: '风格'
            };
            return labels[type] || type || '规则';
        }

        function knowledgeMemoryRuleScopeLabel(rule = {}) {
            if (rule.scope === 'dimension') return `标签层：${rule.target || '未指定'}`;
            if (rule.scope === 'node') return `方向层：${rule.target || '未指定'}`;
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
            card.appendChild(knowledgeMakeEl('strong', '', report.title || '反馈学习报告'));
            card.appendChild(knowledgeMakeEl('p', '', report.summary || '本轮已生成反馈学习结果。'));

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
                    list.appendChild(knowledgeMakeEl('li', '', item));
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
            input.value = rule[field] || '';
            input.dataset.memoryField = field;
            if (multiline) input.rows = 2;
            group.appendChild(input);
            return group;
        }

        function renderKnowledgeMemoryRule(rule = {}, mode = 'draft') {
            const item = knowledgeMakeEl('div', `knowledge-memory-rule ${mode === 'active' ? 'is-active' : 'is-draft'}`);
            item.dataset.ruleId = rule.ruleId || '';
            const top = knowledgeMakeEl('div', 'knowledge-memory-rule-top');
            top.appendChild(knowledgeMakeEl('strong', '', rule.title || '未命名规则'));
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
                item.appendChild(knowledgeMakeEl('div', 'knowledge-memory-evidence', rule.evidence.slice(0, 3).join('；')));
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
