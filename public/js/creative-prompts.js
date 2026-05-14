// 创意拓展提示词列表：选择、全选、取消选择和预览提示词。
        function getSelectedCreativePrompts() {
            return (Array.isArray(config.creativePrompts) ? config.creativePrompts : [])
                .filter(item => item && item.selected !== false && String(item.prompt || '').trim());
        }

        function getCreativePromptIndex(item, fallbackIndex = 0) {
            const value = Number(item && item.index);
            return Number.isFinite(value) && value > 0 ? value : fallbackIndex + 1;
        }

        function getCreativeDirectionTitle(item, fallbackIndex = 0) {
            const direction = String(item && item.direction ? item.direction : '').trim();
            if (direction) return direction;
            const sourceRow = item && item.sourceRow ? item.sourceRow : fallbackIndex + 1;
            return `表格第 ${sourceRow} 行`;
        }

        function getCreativeDirectionGroupKey(item, fallbackIndex = 0) {
            const sourceRow = item && Number.isFinite(Number(item.sourceRow)) ? Number(item.sourceRow) : fallbackIndex + 1;
            return `${sourceRow}::${getCreativeDirectionTitle(item, fallbackIndex)}`;
        }

        function getCreativePromptGroups(prompts) {
            const groups = [];
            const groupMap = new Map();
            (Array.isArray(prompts) ? prompts : []).forEach((item, index) => {
                if (!item || !String(item.prompt || '').trim()) return;
                const key = getCreativeDirectionGroupKey(item, index);
                if (!groupMap.has(key)) {
                    const group = {
                        key,
                        title: getCreativeDirectionTitle(item, index),
                        sourceRow: item.sourceRow || '',
                        firstIndex: getCreativePromptIndex(item, index),
                        prompts: []
                    };
                    groupMap.set(key, group);
                    groups.push(group);
                }
                groupMap.get(key).prompts.push(item);
            });
            return groups;
        }

        function normalizeCreativePromptFromResume(item, fallbackIndex = 0, remainingSet = new Set()) {
            const index = getCreativePromptIndex(item, fallbackIndex);
            return {
                index,
                sourceRow: Number(item?.sourceRow) || index,
                sheetName: item?.sheetName || '',
                direction: item?.direction || `上次任务第 ${index} 组`,
                promptTitle: item?.promptTitle || `提示词${index}`,
                promptColumn: item?.promptColumn || null,
                prompt: String(item?.prompt || '').trim(),
                selected: remainingSet.size > 0 ? remainingSet.has(index) : item?.selected !== false
            };
        }

        function applyCreativeResumeInfo(resume) {
            creativeResumeInfo = resume && resume.hasResume ? resume : null;
            if (!creativeResumeInfo) {
                creativeResumeIndexes = [];
                setCreativeStoppedActionsVisible(false);
                return;
            }

            const remainingIndexes = Array.isArray(creativeResumeInfo.remainingIndexes)
                ? creativeResumeInfo.remainingIndexes.map(Number).filter(Number.isFinite)
                : [];
            const remainingSet = new Set(remainingIndexes);
            const restoredPrompts = Array.isArray(creativeResumeInfo.prompts)
                ? creativeResumeInfo.prompts
                    .map((item, index) => normalizeCreativePromptFromResume(item, index, remainingSet))
                    .filter(item => item.prompt)
                : [];

            if (restoredPrompts.length > 0) {
                config.creativePrompts = restoredPrompts;
                config.creativeTableFileName = creativeResumeInfo.tableFileName || '上次创意拓展任务';
                creativeLastRunIndexes = restoredPrompts.map((item, index) => getCreativePromptIndex(item, index));
                renderCreativePromptPreview(config.creativePrompts);
            }

            creativeResumeIndexes = remainingIndexes.length > 0
                ? remainingIndexes
                : restoredPrompts.filter(item => item.selected !== false).map((item, index) => getCreativePromptIndex(item, index));

            if (creativeResumeIndexes.length > 0 && restoredPrompts.length > 0) {
                selectCreativePromptsByIndexes(creativeResumeIndexes);
            }

            if (creativeResumeInfo.outputFolder) {
                config.creativeOutputFolder = creativeResumeInfo.outputFolder;
                const output = document.getElementById('creativeOutputFolder');
                if (output) output.value = config.creativeOutputFolder;
            }
            if (creativeResumeInfo.referenceFolder !== undefined) {
                config.creativeReferenceFolder = creativeResumeInfo.referenceFolder || '';
                const reference = document.getElementById('creativeReferenceFolder');
                if (reference) reference.value = config.creativeReferenceFolder;
            }
            if (creativeResumeInfo.browserMode) {
                config.creativeBrowserMode = normalizeCreativeBrowserMode(creativeResumeInfo.browserMode);
                updateCreativeBrowserModeActiveState();
            }
            if (creativeResumeInfo.generationSettings) {
                config.creativeLegilGeneration = {
                    ...config.creativeLegilGeneration,
                    ...creativeResumeInfo.generationSettings,
                    outputQuantity: Number(creativeResumeInfo.generationSettings.outputQuantity) || config.creativeLegilGeneration.outputQuantity
                };
                updateCreativeLegilGenerationActiveStates();
                refreshCreativeLegilGenerationSummary();
            }
            if (creativeResumeInfo.progress) {
                updateCreativeProgress(creativeResumeInfo.progress);
            }

            setCreativeStoppedActionsVisible(true, creativeResumeIndexes.length);
            const startBtn = document.getElementById('creativeStartBtn');
            if (startBtn) {
                startBtn.disabled = true;
                startBtn.textContent = '请选择继续任务或新任务';
            }

            const infoBox = document.getElementById('creativeBatchInfo');
            if (infoBox) {
                const completed = Number(creativeResumeInfo.completed) || 0;
                const total = Number(creativeResumeInfo.total) || creativeResumeIndexes.length;
                infoBox.className = 'info-box success';
                infoBox.textContent = `已找到上次创意拓展任务：已处理 ${completed}/${total} 组，可继续剩余 ${creativeResumeIndexes.length} 组，或开启新任务。`;
            }
        }

        async function refreshCreativeResumeControls() {
            try {
                const res = await fetch('/api/legil/creative-resume');
                const data = await readJsonResponse(res, '读取创意拓展恢复状态失败');
                if (!data.success) return;
                applyCreativeResumeInfo(data.resume);
            } catch (e) {}
        }

        async function clearCreativeResumeOnServer() {
            try {
                await fetch('/api/legil/creative-resume/clear', { method: 'POST' });
            } catch (e) {}
            creativeResumeInfo = null;
        }

        function setCreativeNewTaskVisible(visible) {
            const btn = document.getElementById('creativeNewTaskBtn');
            if (btn) btn.hidden = visible !== true;
        }

        function setCreativeResumeTaskVisible(visible, remainingCount = 0) {
            const btn = document.getElementById('creativeResumeTaskBtn');
            if (!btn) return;
            btn.hidden = visible !== true;
            btn.disabled = visible !== true || remainingCount <= 0;
            btn.textContent = remainingCount > 0 ? `继续任务（剩余 ${remainingCount} 组）` : '继续任务';
        }

        function setCreativeStoppedActionsVisible(visible, remainingCount = 0) {
            setCreativeResumeTaskVisible(visible === true && remainingCount > 0, remainingCount);
            setCreativeNewTaskVisible(visible === true);
        }

        function selectCreativePromptsByIndexes(indexes) {
            const selected = new Set((indexes || []).map(Number).filter(Number.isFinite));
            (config.creativePrompts || []).forEach((item, index) => {
                item.selected = selected.has(getCreativePromptIndex(item, index));
            });
            renderCreativePromptPreview(config.creativePrompts);
        }

        function getCreativeRemainingRunIndexes(progress) {
            const completed = Math.max(0, Number(progress && progress.completed) || 0);
            const runIndexes = creativeLastRunIndexes.length > 0
                ? creativeLastRunIndexes
                : getSelectedCreativePrompts().map((item, index) => getCreativePromptIndex(item, index));
            return runIndexes.slice(Math.min(completed, runIndexes.length));
        }

        function updateCreativeSelectionCount() {
            const count = document.getElementById('creativeSelectionCount');
            const groups = getCreativePromptGroups(config.creativePrompts);
            const selectedPromptCount = getSelectedCreativePrompts().length;
            const totalPromptCount = Array.isArray(config.creativePrompts) ? config.creativePrompts.length : 0;
            const selectedGroupCount = groups.filter(group => group.prompts.some(item => item.selected !== false)).length;
            if (count) {
                count.textContent = `已选择 ${selectedGroupCount} / ${groups.length} 个方向（${selectedPromptCount} / ${totalPromptCount} 组提示词）`;
            }
            const selectedStat = document.getElementById('creativeStatsSelected');
            if (selectedStat) {
                selectedStat.textContent = selectedPromptCount || 0;
            }
        }

        function toggleCreativePromptGroupSelection(groupKey, checked) {
            getCreativePromptGroups(config.creativePrompts)
                .filter(group => group.key === groupKey)
                .forEach(group => {
                    group.prompts.forEach(item => {
                        item.selected = checked === true;
                    });
                });
            renderCreativePromptPreview(config.creativePrompts);
        }

        function setAllCreativePromptsSelected(selected) {
            (config.creativePrompts || []).forEach(item => {
                item.selected = selected === true;
            });
            renderCreativePromptPreview(config.creativePrompts);
        }

        function renderCreativePromptPreview(prompts) {
            const list = document.getElementById('creativePromptPreview');
            if (!list) return;
            list.textContent = '';

            const safePrompts = Array.isArray(prompts) ? prompts : [];
            if (safePrompts.length === 0) {
                return;
            }

            const selectionBar = document.createElement('div');
            selectionBar.className = 'creative-selection-bar';

            const selectionCount = document.createElement('span');
            selectionCount.className = 'creative-selection-count';
            selectionCount.id = 'creativeSelectionCount';

            const selectAllBtn = document.createElement('button');
            selectAllBtn.type = 'button';
            selectAllBtn.className = 'creative-mini-btn';
            selectAllBtn.textContent = '全选';
            selectAllBtn.onclick = () => setAllCreativePromptsSelected(true);

            const clearBtn = document.createElement('button');
            clearBtn.type = 'button';
            clearBtn.className = 'creative-mini-btn';
            clearBtn.textContent = '全不选';
            clearBtn.onclick = () => setAllCreativePromptsSelected(false);

            selectionBar.appendChild(selectionCount);
            selectionBar.appendChild(selectAllBtn);
            selectionBar.appendChild(clearBtn);
            list.appendChild(selectionBar);

            const groups = getCreativePromptGroups(safePrompts);
            groups.forEach((group, groupIndex) => {
                const selectedCount = group.prompts.filter(item => item.selected !== false).length;
                const card = document.createElement('div');
                card.className = 'creative-preview-item';
                card.id = `creative-direction-${group.firstIndex}`;
                card.classList.toggle('is-unselected', selectedCount === 0);

                const meta = document.createElement('div');
                meta.className = 'creative-preview-meta';

                const label = document.createElement('label');
                label.className = 'creative-check-label';

                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.checked = selectedCount === group.prompts.length;
                checkbox.indeterminate = selectedCount > 0 && selectedCount < group.prompts.length;
                checkbox.onchange = () => toggleCreativePromptGroupSelection(group.key, checkbox.checked);

                const title = document.createElement('span');
                title.className = 'creative-preview-title';
                title.textContent = `#${groupIndex + 1} ${group.title}`;

                const summary = document.createElement('span');
                summary.className = 'creative-preview-count';
                summary.textContent = selectedCount === group.prompts.length
                    ? `${group.prompts.length} 组提示词`
                    : `已选 ${selectedCount}/${group.prompts.length}`;

                label.appendChild(checkbox);
                label.appendChild(title);
                meta.appendChild(label);
                meta.appendChild(summary);
                card.appendChild(meta);
                list.appendChild(card);
            });

            updateCreativeSelectionCount();
        }
