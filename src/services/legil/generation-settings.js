/**
 * Legil generation settings.
 *
 * Methods are copied from the original LegilAutomation class and grouped by
 * responsibility so the automation flow is easier to inspect.
 */
module.exports = function createGenerationSettingsMethods(deps) {
    const {
        browserController,
        logger,
        fs,
        path,
        formatDateTimeForFile,
        padNumber,
        sanitizeFileNamePart,
        sortNaturallyByName,
        isAbortRequested,
        throwIfAborted,
        interruptibleSleep,
        withTimeout,
        normalizeImageUrl,
        isLegilOutputUrl,
        extractLegilImageUrl,
        isPageLocalImageUrl,
        LEGIL_DEFAULT_SETTINGS,
        LEGIL_IMAGE_MODEL_OPTIONS,
        LEGIL_ASPECT_RATIOS,
        LEGIL_RESOLUTIONS,
        LEGIL_OUTPUT_QUANTITIES,
        LEGIL_DEFAULT_MODEL_PARAMETER_PROFILE,
        LEGIL_MODEL_PARAMETER_PROFILES,
        IMAGE_EXTENSIONS,
        LEGIL_IMAGE_TO_IMAGE_URL,
        LEGIL_ERROR_SCREENSHOT_DIR
    } = deps;

    return {
    async detectCurrentImageModel(page) {
        const labels = this.getImageModelOptions().map(option => option.label);
        return page.evaluate((modelLabels) => {
            const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim();
            const normalizeModelText = (value) => normalizeText(value).toLowerCase().replace(/[\s_-]+/g, '');
            const modelEntries = modelLabels.map(label => ({
                label,
                key: normalizeModelText(label)
            }));
            const modelLabelPattern = /(\u56fe\u751f\u56fe\s*\u6a21\u578b|\u751f\u56fe\s*\u6a21\u578b|\u6a21\u578b|image\s*model|model)/i;

            const isVisible = (el) => {
                if (!el || !(el instanceof Element)) return false;
                const rect = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return rect.width > 0 &&
                    rect.height > 0 &&
                    style.visibility !== 'hidden' &&
                    style.display !== 'none' &&
                    style.opacity !== '0';
            };
            const findModelLabel = (text) => {
                const key = normalizeModelText(text);
                return modelEntries.find(entry => key === entry.key || key.includes(entry.key))?.label || '';
            };
            const hasModelSettingLabel = (el) => {
                let current = el;
                for (let depth = 0; depth < 5 && current; depth += 1) {
                    const text = normalizeText(current.innerText || current.textContent || '');
                    if (modelLabelPattern.test(text)) return true;
                    current = current.parentElement;
                }
                return false;
            };
            const scoreElement = (el, label) => {
                const rect = el.getBoundingClientRect();
                const area = rect.width * rect.height;
                let score = 0;
                if (hasModelSettingLabel(el)) score += 80;
                if (el.matches('button, [role="button"], [role="combobox"], [aria-haspopup]')) score += 40;
                if (/select|dropdown|trigger|combobox/i.test(String(el.className || ''))) score += 25;
                if (normalizeText(el.innerText || el.textContent || '') === label) score += 20;
                if (rect.left >= 0 && rect.left <= Math.max(720, window.innerWidth * 0.62)) score += 10;
                if (rect.top >= 0 && rect.top <= Math.max(360, window.innerHeight * 0.5)) score += 10;
                if (area > 90000) score -= 60;
                if (rect.width > 720 || rect.height > 180) score -= 50;
                return score;
            };

            const candidates = [];
            for (const el of document.querySelectorAll('button, [role="button"], [role="combobox"], [aria-haspopup], [class*="select"], [class*="Select"], [class*="dropdown"], [class*="Dropdown"], [class*="trigger"], [class*="Trigger"], div, span')) {
                if (!isVisible(el)) continue;
                const rect = el.getBoundingClientRect();
                if (rect.top < 0 || rect.left < -20 || rect.top > window.innerHeight || rect.left > window.innerWidth) continue;
                const text = normalizeText(el.innerText || el.textContent || '');
                const label = findModelLabel(text);
                if (!label) continue;
                candidates.push({
                    label,
                    score: scoreElement(el, label),
                    top: rect.top,
                    left: rect.left,
                    area: rect.width * rect.height
                });
            }

            candidates.sort((a, b) => {
                if (a.score !== b.score) return b.score - a.score;
                const topDiff = a.top - b.top;
                if (Math.abs(topDiff) > 4) return topDiff;
                const leftDiff = a.left - b.left;
                if (Math.abs(leftDiff) > 4) return leftDiff;
                return a.area - b.area;
            });

            return candidates[0]?.label || '';
        }, labels).catch(() => '');
    },

    async findImageModelTrigger(page) {
        const labels = this.getImageModelOptions().map(option => option.label);
        const handle = await page.evaluateHandle((modelLabels) => {
            const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim();
            const normalizeModelText = (value) => normalizeText(value).toLowerCase().replace(/[\s_-]+/g, '');
            const modelEntries = modelLabels.map(label => ({
                label,
                key: normalizeModelText(label)
            }));
            const modelLabelPattern = /(\u56fe\u751f\u56fe\s*\u6a21\u578b|\u751f\u56fe\s*\u6a21\u578b|\u6a21\u578b|image\s*model|model)/i;
            const interactiveSelector = 'button, [role="button"], [role="combobox"], [aria-haspopup], [class*="select"], [class*="Select"], [class*="dropdown"], [class*="Dropdown"], [class*="trigger"], [class*="Trigger"]';

            const isVisible = (el) => {
                if (!el || !(el instanceof Element)) return false;
                const rect = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return rect.width > 0 &&
                    rect.height > 0 &&
                    style.visibility !== 'hidden' &&
                    style.display !== 'none' &&
                    style.opacity !== '0';
            };
            const findModelLabel = (text) => {
                const key = normalizeModelText(text);
                return modelEntries.find(entry => key === entry.key || key.includes(entry.key))?.label || '';
            };
            const clickableFor = (el) => {
                return el.closest(interactiveSelector) || el;
            };
            const containsModelSettingLabel = (el) => {
                let current = el;
                for (let depth = 0; depth < 6 && current; depth += 1) {
                    const text = normalizeText(current.innerText || current.textContent || '');
                    if (modelLabelPattern.test(text)) return true;
                    current = current.parentElement;
                }
                return false;
            };
            const scoreClickable = (clickable, matchedByModelName) => {
                const rect = clickable.getBoundingClientRect();
                const area = rect.width * rect.height;
                let score = 0;
                if (matchedByModelName) score += 80;
                if (containsModelSettingLabel(clickable)) score += 70;
                if (clickable.matches('button, [role="button"], [role="combobox"], [aria-haspopup]')) score += 45;
                if (/select|dropdown|trigger|combobox/i.test(String(clickable.className || ''))) score += 30;
                if (rect.left >= 0 && rect.left <= Math.max(760, window.innerWidth * 0.7)) score += 8;
                if (rect.top >= 0 && rect.top <= Math.max(420, window.innerHeight * 0.6)) score += 8;
                if (area > 100000) score -= 80;
                if (rect.width > 760 || rect.height > 180) score -= 70;
                return score;
            };

            const candidates = [];
            const pushCandidate = (el, matchedByModelName = false) => {
                const clickable = clickableFor(el);
                if (!isVisible(clickable)) return;
                const rect = clickable.getBoundingClientRect();
                if (rect.top < 0 || rect.left < -20 || rect.top > window.innerHeight || rect.left > window.innerWidth) return;
                candidates.push({
                    el: clickable,
                    score: scoreClickable(clickable, matchedByModelName),
                    top: rect.top,
                    left: rect.left,
                    area: rect.width * rect.height
                });
            };

            for (const el of document.querySelectorAll(`${interactiveSelector}, div, span`)) {
                if (!isVisible(el)) continue;
                const text = normalizeText(el.innerText || el.textContent || '');
                if (findModelLabel(text)) {
                    pushCandidate(el, true);
                }
            }

            const labelsInPage = Array.from(document.querySelectorAll('label, div, span, p'))
                .filter(isVisible)
                .filter(el => modelLabelPattern.test(normalizeText(el.innerText || el.textContent || '')))
                .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);

            for (const labelEl of labelsInPage) {
                let root = labelEl;
                for (let depth = 0; depth < 7 && root; depth += 1) {
                    const controls = Array.from(root.querySelectorAll(interactiveSelector)).filter(isVisible);
                    for (const control of controls) {
                        pushCandidate(control, false);
                    }
                    root = root.parentElement;
                }
            }

            const unique = [];
            const seen = new Set();
            for (const candidate of candidates) {
                if (seen.has(candidate.el)) continue;
                seen.add(candidate.el);
                unique.push(candidate);
            }

            unique.sort((a, b) => {
                if (a.score !== b.score) return b.score - a.score;
                const topDiff = a.top - b.top;
                if (Math.abs(topDiff) > 4) return topDiff;
                const leftDiff = a.left - b.left;
                if (Math.abs(leftDiff) > 4) return leftDiff;
                return a.area - b.area;
            });

            return unique[0]?.el || null;
        }, labels).catch(() => null);

        return handle ? handle.asElement() : null;
    },

    async clickImageModelOption(page, targetLabel, minTop = 0, options = {}) {
        const handle = await page.evaluateHandle(({ label, optionMinTop }) => {
            const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim();
            const normalizeModelText = (value) => normalizeText(value).toLowerCase().replace(/[\s_-]+/g, '');
            const targetKey = normalizeModelText(label);
            const optionRootSelector = '[role="listbox"], [role="menu"], [role="dialog"], [class*="popover"], [class*="Popover"], [class*="dropdown"], [class*="Dropdown"], [class*="select"], [class*="Select"]';
            const clickableSelector = 'button, [role="option"], [role="menuitem"], [role="button"], [class*="option"], [class*="Option"], [class*="item"], [class*="Item"], [data-value]';

            const isVisible = (el) => {
                if (!el || !(el instanceof Element)) return false;
                const rect = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return rect.width > 0 &&
                    rect.height > 0 &&
                    style.visibility !== 'hidden' &&
                    style.display !== 'none' &&
                    style.opacity !== '0';
            };
            const textMatches = (text) => {
                const key = normalizeModelText(text);
                return key === targetKey || key.includes(targetKey);
            };
            const clickableFor = (el) => {
                return el.closest(clickableSelector) || el;
            };
            const isInOptionRoot = (el) => !!el.closest(optionRootSelector);

            const candidates = [];
            for (const el of document.querySelectorAll(`${clickableSelector}, div, span`)) {
                if (!isVisible(el)) continue;
                const text = normalizeText(el.innerText || el.textContent || el.getAttribute('data-value') || '');
                if (!textMatches(text)) continue;

                const clickable = clickableFor(el);
                if (!isVisible(clickable)) continue;
                const rect = clickable.getBoundingClientRect();
                const area = rect.width * rect.height;
                if (rect.top < -20 || rect.left < -20 || rect.top > window.innerHeight || rect.left > window.innerWidth) continue;
                if (rect.width > 820 || rect.height > 180) continue;

                const inOptionRoot = isInOptionRoot(clickable);
                const respectsTriggerPosition = rect.top >= optionMinTop - 8;
                const role = String(clickable.getAttribute('role') || '').toLowerCase();
                let score = 0;
                if (inOptionRoot) score += 90;
                if (role === 'option' || role === 'menuitem') score += 70;
                if (clickable.matches('button, [role="button"]')) score += 35;
                if (/option|item/i.test(String(clickable.className || ''))) score += 30;
                if (respectsTriggerPosition) score += 20;
                if (normalizeModelText(text) === targetKey) score += 15;
                if (area > 90000) score -= 70;
                if (!inOptionRoot && !respectsTriggerPosition) score -= 50;

                candidates.push({
                    el: clickable,
                    score,
                    top: rect.top,
                    left: rect.left,
                    area
                });
            }

            candidates.sort((a, b) => {
                if (a.score !== b.score) return b.score - a.score;
                const topDiff = a.top - b.top;
                if (Math.abs(topDiff) > 4) return topDiff;
                const leftDiff = a.left - b.left;
                if (Math.abs(leftDiff) > 4) return leftDiff;
                return a.area - b.area;
            });

            return candidates[0]?.el || null;
        }, {
            label: targetLabel,
            optionMinTop: Number.isFinite(minTop) ? minTop : 0
        }).catch(() => null);

        const optionElement = handle ? handle.asElement() : null;
        if (!optionElement) {
            return false;
        }

        const clicked = await this.clickLegilElementWithFallback(page, optionElement, `image model option ${targetLabel}`, options);
        if (!clicked) {
            return false;
        }
        await interruptibleSleep(500, options);
        return true;
    },

    async clickLegilElementWithFallback(page, element, label = 'Legil element', options = {}) {
        if (!page || page.isClosed() || !element) {
            return false;
        }

        const clickTimeoutMs = Number(options.legilClickTimeoutMs) || 3000;

        try {
            await element.click({ timeout: clickTimeoutMs });
            return true;
        } catch (clickError) {
            logger.warn(`${label} click timed out or was intercepted, trying fallback: ${String(clickError.message || clickError).split('\n')[0]}`);
        }

        const box = await element.boundingBox().catch(() => null);
        if (box && Number.isFinite(box.x) && Number.isFinite(box.y) && box.width > 0 && box.height > 0) {
            try {
                await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
                return true;
            } catch (mouseError) {
                logger.warn(`${label} coordinate click failed, trying DOM click: ${String(mouseError.message || mouseError).split('\n')[0]}`);
            }
        }

        try {
            await element.evaluate((el) => {
                if (typeof el.click === 'function') {
                    el.click();
                    return;
                }

                el.dispatchEvent(new MouseEvent('click', {
                    bubbles: true,
                    cancelable: true,
                    view: window
                }));
            });
            return true;
        } catch (domError) {
            logger.warn(`${label} DOM click failed: ${String(domError.message || domError).split('\n')[0]}`);
            return false;
        }
    },

    async hasOpenImagePreviewModal(page, options = {}) {
        if (!page || page.isClosed()) {
            return false;
        }

        const timeoutMs = Number(options.modalDetectTimeoutMs) || 2500;
        const assumeOpenOnTimeout = options.assumeOpenOnTimeout === true;
        const detectPromise = page.evaluate(() => {
            const isVisible = (el) => {
                const rect = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return rect.width > 0 &&
                    rect.height > 0 &&
                    style.visibility !== 'hidden' &&
                    style.display !== 'none' &&
                    style.opacity !== '0';
            };

            const dialogs = Array.from(document.querySelectorAll(
                '[role="dialog"], [aria-modal="true"], [class*="Modal_modalContent"], [class*="Modal_modalFullscreen"], [class*="modal"][data-state="open"], [class*="lightbox"], [class*="fullscreen"]'
            ));

            return dialogs.some(dialog => {
                if (!isVisible(dialog)) return false;
                const rect = dialog.getBoundingClientRect();
                if (rect.width < 260 || rect.height < 220) return false;
                return !!dialog.querySelector('img');
            });
        }).catch(() => false);

        return withTimeout(detectPromise, timeoutMs, 'detect image preview modal').catch(error => {
            if (error?.code === 'OPERATION_TIMEOUT') {
                logger.warn(`检测大图弹窗超时 ${timeoutMs}ms，改用兜底关闭流程`);
                return assumeOpenOnTimeout;
            }
            return false;
        });
    },

    async closeOpenPreviewModal(page, options = {}) {
        if (!page || page.isClosed()) {
            return false;
        }

        const modalOptions = {
            ...options,
            modalDetectTimeoutMs: Number(options.modalDetectTimeoutMs) || 2500
        };
        const hadModal = await this.hasOpenImagePreviewModal(page, {
            ...modalOptions,
            assumeOpenOnTimeout: true
        });
        if (!hadModal) {
            return false;
        }

        logger.info('检测到未关闭的大图弹窗，正在关闭...');

        for (let attempt = 0; attempt < 4; attempt++) {
            throwIfAborted(options);

            const closeEvaluateTimeoutMs = Number(options.modalCloseEvaluateTimeoutMs) || 2500;
            const clickedClose = await withTimeout(page.evaluate(() => {
                const isVisible = (el) => {
                    const rect = el.getBoundingClientRect();
                    const style = window.getComputedStyle(el);
                    return rect.width > 0 &&
                        rect.height > 0 &&
                        style.visibility !== 'hidden' &&
                        style.display !== 'none' &&
                        style.opacity !== '0';
                };

                const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
                const dialogs = Array.from(document.querySelectorAll(
                    '[role="dialog"], [aria-modal="true"], [class*="Modal_modalContent"], [class*="Modal_modalFullscreen"], [class*="modal"][data-state="open"], [class*="lightbox"], [class*="fullscreen"]'
                ))
                    .filter(dialog => {
                        if (!isVisible(dialog) || !dialog.querySelector('img')) return false;
                        const rect = dialog.getBoundingClientRect();
                        return rect.width >= 260 && rect.height >= 220;
                    })
                    .sort((a, b) => {
                        const aRect = a.getBoundingClientRect();
                        const bRect = b.getBoundingClientRect();
                        return (bRect.width * bRect.height) - (aRect.width * aRect.height);
                    });

                const dialog = dialogs[0];
                if (!dialog) return { clicked: false, box: null };

                const dialogRect = dialog.getBoundingClientRect();
                const controls = Array.from(dialog.querySelectorAll(
                    'button, [role="button"], [aria-label], [title], [class*="close"], [class*="Close"], svg'
                ));

                const candidates = [];
                for (const el of controls) {
                    if (!isVisible(el)) continue;

                    const rect = el.getBoundingClientRect();
                    const text = normalizeText(el.innerText || el.textContent || '');
                    const aria = normalizeText(el.getAttribute('aria-label'));
                    const title = normalizeText(el.getAttribute('title'));
                    const className = normalizeText(el.className);
                    const closeLike = text === 'x' ||
                        text === '×' ||
                        text.includes('关闭') ||
                        text.includes('close') ||
                        aria.includes('关闭') ||
                        aria.includes('close') ||
                        title.includes('关闭') ||
                        title.includes('close') ||
                        className.includes('close');
                    const nearTopRight = rect.left >= dialogRect.right - 90 && rect.top <= dialogRect.top + 90;

                    if (closeLike || nearTopRight) {
                        const clickable = el.closest('button, [role="button"], [aria-label], [title], [class*="close"], [class*="Close"]') || el;
                        candidates.push({
                            el: clickable,
                            top: rect.top,
                            left: rect.left,
                            score: (closeLike ? 0 : 10) + (nearTopRight ? 0 : 5)
                        });
                    }
                }

                candidates.sort((a, b) => {
                    if (a.score !== b.score) return a.score - b.score;
                    if (Math.abs(a.top - b.top) > 4) return a.top - b.top;
                    return b.left - a.left;
                });

                if (candidates[0]?.el) {
                    if (typeof candidates[0].el.click === 'function') {
                        candidates[0].el.click();
                    } else {
                        candidates[0].el.dispatchEvent(new MouseEvent('click', {
                            bubbles: true,
                            cancelable: true,
                            view: window
                        }));
                    }
                    return {
                        clicked: true,
                        box: {
                            x: Math.max(0, dialogRect.right - 28),
                            y: Math.max(0, dialogRect.top + 28)
                        }
                    };
                }

                return {
                    clicked: false,
                    box: {
                        x: Math.max(0, dialogRect.right - 28),
                        y: Math.max(0, dialogRect.top + 28)
                    }
                };
            }).catch(() => ({ clicked: false, box: null })), closeEvaluateTimeoutMs, 'click image preview close').catch(error => {
                if (error?.code === 'OPERATION_TIMEOUT') {
                    logger.warn(`关闭大图弹窗脚本超时 ${closeEvaluateTimeoutMs}ms，改用 Esc/坐标兜底`);
                }
                return { clicked: false, box: null };
            });

            await browserController.sleep(500).catch(() => {});
            if (!(await this.hasOpenImagePreviewModal(page, modalOptions))) {
                logger.info('✅ 大图弹窗已关闭');
                return true;
            }

            await page.keyboard.press('Escape').catch(() => {});
            await browserController.sleep(500).catch(() => {});
            if (!(await this.hasOpenImagePreviewModal(page, modalOptions))) {
                logger.info('✅ 大图弹窗已关闭');
                return true;
            }

            if (clickedClose?.box) {
                await page.mouse.click(clickedClose.box.x, clickedClose.box.y).catch(() => {});
                await browserController.sleep(500).catch(() => {});
                if (!(await this.hasOpenImagePreviewModal(page, modalOptions))) {
                    logger.info('✅ 大图弹窗已关闭');
                    return true;
                }
            }
        }

        logger.warn('大图弹窗仍未关闭，后续点击可能被页面弹窗拦截');
        return false;
    },

    async ensureImageModel(page, imageModel, options = {}) {
        const targetModel = LEGIL_IMAGE_MODEL_OPTIONS.some(item => item.value === imageModel)
            ? imageModel
            : LEGIL_DEFAULT_SETTINGS.imageModel;
        const targetLabel = this.getImageModelLabel(targetModel);

        try {
            throwIfAborted(options);

            const currentLabel = await this.detectCurrentImageModel(page);
            if (currentLabel === targetLabel) {
                logger.info(`✅ Legil 图生图模型已是 ${targetLabel}`);
                return true;
            }

            logger.info(`正在切换 Legil 图生图模型: ${targetLabel}`);
            const trigger = await this.findImageModelTrigger(page);
            if (!trigger) {
                logger.warn('未找到 Legil 图生图模型切换入口，继续使用页面当前模型');
                return false;
            }

            const triggerBox = await trigger.boundingBox().catch(() => null);
            const minTop = triggerBox ? triggerBox.y + triggerBox.height - 4 : 100;

            const opened = await this.clickLegilElementWithFallback(page, trigger, `image model trigger ${targetLabel}`, options);
            if (!opened) {
                logger.warn('未找到 Legil 图生图模型切换入口，继续使用页面当前模型');
                return false;
            }
            await interruptibleSleep(500, options);

            const clicked = await this.clickImageModelOption(page, targetLabel, minTop, options);
            if (!clicked) {
                logger.warn(`未找到 Legil 图生图模型选项 "${targetLabel}"，继续使用页面当前模型`);
                await page.keyboard.press('Escape').catch(() => {});
                return false;
            }

            const verifiedLabel = await this.detectCurrentImageModel(page);
            if (verifiedLabel && verifiedLabel !== targetLabel) {
                logger.warn(`Legil 图生图模型可能未切换成功，当前检测为 "${verifiedLabel}"`);
                return false;
            }

            logger.info(`✅ 已应用 Legil 图生图模型: ${targetLabel}`);
            return true;
        } catch (error) {
            logger.warn(`切换 Legil 图生图模型失败，将继续使用页面当前模型: ${error.message}`);
            await page.keyboard.press('Escape').catch(() => {});
            return false;
        }
    },

    async clickLegilSettingOption(page, value, options = {}) {
        const target = String(value);
        const optionHandle = await page.evaluateHandle((targetText) => {
            const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim();
            const isVisible = (el) => {
                const rect = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return rect.width > 0 &&
                    rect.height > 0 &&
                    style.visibility !== 'hidden' &&
                    style.display !== 'none' &&
                    style.opacity !== '0';
            };

            const clickableFor = (el) => {
                return el.closest('button, [role="button"], [class*="radio"], [class*="option"], [class*="item"], [class*="segment"], div') || el;
            };

            const candidates = [];
            for (const el of document.querySelectorAll('button, [role="button"], div, span')) {
                if (!isVisible(el)) continue;
                const rect = el.getBoundingClientRect();
                if (rect.left < 180 || rect.left > 480 || rect.top < 80) continue;

                const text = normalizeText(el.innerText || el.textContent || '');
                if (text !== targetText) continue;

                const clickable = clickableFor(el);
                if (!isVisible(clickable)) continue;
                const clickableRect = clickable.getBoundingClientRect();
                if (clickableRect.left < 180 || clickableRect.left > 480 || clickableRect.width > 260 || clickableRect.height > 80) continue;

                candidates.push({
                    el: clickable,
                    top: clickableRect.top,
                    left: clickableRect.left,
                    area: clickableRect.width * clickableRect.height
                });
            }

            candidates.sort((a, b) => {
                const topDiff = a.top - b.top;
                if (Math.abs(topDiff) > 4) return topDiff;
                const leftDiff = a.left - b.left;
                if (Math.abs(leftDiff) > 4) return leftDiff;
                return a.area - b.area;
            });

            return candidates[0]?.el || null;
        }, target).catch(() => null);

        const optionElement = optionHandle ? optionHandle.asElement() : null;
        if (!optionElement) {
            return false;
        }

        const clicked = await this.clickLegilElementWithFallback(page, optionElement, `Legil setting option ${target}`, options);
        if (!clicked) {
            return false;
        }
        await interruptibleSleep(300, options);
        return true;
    },

    async detectOutputQuantityValue(page) {
        if (!page || page.isClosed()) {
            return 0;
        }

        return page.evaluate(() => {
            const normalizeText = value => String(value || '').replace(/\s+/g, ' ').trim();
            const isVisible = (el) => {
                if (!el || !(el instanceof Element)) return false;
                const rect = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return rect.width > 0 &&
                    rect.height > 0 &&
                    style.visibility !== 'hidden' &&
                    style.display !== 'none' &&
                    style.opacity !== '0';
            };
            const parseQuantity = (value) => {
                const number = Number(String(value || '').match(/[1-4]/)?.[0]);
                return Number.isFinite(number) && number >= 1 && number <= 4 ? number : 0;
            };
            const labelPattern = /输出数量|杈撳嚭鏁伴噺|output\s*quantity/i;

            const sliders = Array.from(document.querySelectorAll('input[type="range"], [role="slider"]'))
                .filter(isVisible)
                .sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top);
            for (const slider of sliders) {
                const value = parseQuantity(slider.getAttribute('aria-valuenow') || slider.value || slider.getAttribute('aria-valuetext'));
                if (value) return value;
            }

            const labels = Array.from(document.querySelectorAll('div, span, p, label'))
                .filter(isVisible)
                .filter(el => labelPattern.test(normalizeText(el.innerText || el.textContent || '')))
                .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);

            for (const label of labels) {
                let current = label;
                for (let depth = 0; depth < 7 && current; depth += 1) {
                    const text = normalizeText(current.innerText || current.textContent || '');
                    const values = text.match(/\b[1-4]\b/g);
                    if (values && values.length) {
                        return Number(values[values.length - 1]);
                    }
                    current = current.parentElement;
                }
            }

            return 0;
        }).catch(() => 0);
    },

    async scrollOutputQuantityIntoView(page, options = {}) {
        if (!page || page.isClosed()) {
            return false;
        }

        const scrolled = await page.evaluate(() => {
            const normalizeText = value => String(value || '').replace(/\s+/g, ' ').trim();
            const isVisibleBox = (el) => {
                if (!el || !(el instanceof Element)) return false;
                const rect = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return rect.width > 0 &&
                    rect.height > 0 &&
                    style.visibility !== 'hidden' &&
                    style.display !== 'none' &&
                    style.opacity !== '0';
            };
            const labelPattern = /输出数量|output\s*quantity/i;
            const candidates = Array.from(document.querySelectorAll('div, aside, section, main'))
                .filter(el => {
                    const rect = el.getBoundingClientRect();
                    const style = window.getComputedStyle(el);
                    return rect.left >= 180 &&
                        rect.left <= 620 &&
                        rect.width >= 220 &&
                        rect.width <= 420 &&
                        rect.height >= 360 &&
                        (el.scrollHeight - el.clientHeight > 40 || ['auto', 'scroll'].includes(style.overflowY));
                })
                .sort((a, b) => {
                    const ar = a.getBoundingClientRect();
                    const br = b.getBoundingClientRect();
                    if (Math.abs(a.scrollHeight - b.scrollHeight) > 10) return b.scrollHeight - a.scrollHeight;
                    return ar.left - br.left;
                });

            const leftPanel = candidates[0] || null;
            if (!leftPanel) {
                window.scrollBy(0, 260);
                return false;
            }

            const labels = Array.from(leftPanel.querySelectorAll('div, span, p, label'))
                .filter(el => labelPattern.test(normalizeText(el.innerText || el.textContent || '')));
            const target = labels[0] || leftPanel.querySelector('input[type="range"], [role="slider"]');
            if (target) {
                target.scrollIntoView({ block: 'center', inline: 'nearest' });
                return true;
            }

            leftPanel.scrollTop = Math.max(leftPanel.scrollTop, leftPanel.scrollHeight - leftPanel.clientHeight);
            return true;
        }).catch(() => false);

        await interruptibleSleep(300, options);
        return scrolled;
    },

    async setOutputQuantityWithSlider(page, targetQuantity, options = {}) {
        const target = Math.max(1, Math.min(4, Number(targetQuantity) || 1));
        await this.scrollOutputQuantityIntoView(page, options);

        const directSet = await page.evaluate((value) => {
            const normalizeText = text => String(text || '').replace(/\s+/g, ' ').trim();
            const isVisible = (el) => {
                if (!el || !(el instanceof Element)) return false;
                const rect = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return rect.width > 0 &&
                    rect.height > 0 &&
                    style.visibility !== 'hidden' &&
                    style.display !== 'none' &&
                    style.opacity !== '0';
            };
            const labelPattern = /输出数量|杈撳嚭鏁伴噺|output\s*quantity/i;
            const findRoot = () => {
                const labels = Array.from(document.querySelectorAll('div, span, p, label'))
                    .filter(isVisible)
                    .filter(el => labelPattern.test(normalizeText(el.innerText || el.textContent || '')))
                    .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
                for (const label of labels) {
                    let current = label;
                    for (let depth = 0; depth < 8 && current; depth += 1) {
                        if (current.querySelector('input[type="range"]')) {
                            return current;
                        }
                        current = current.parentElement;
                    }
                }
                return document.body;
            };
            const range = findRoot().querySelector('input[type="range"]');
            if (!range || !isVisible(range)) return false;

            const min = Number(range.min || range.getAttribute('aria-valuemin')) || 1;
            const max = Number(range.max || range.getAttribute('aria-valuemax')) || 4;
            const next = Math.max(min, Math.min(max, Number(value) || min));
            range.value = String(next);
            range.setAttribute('value', String(next));
            range.dispatchEvent(new Event('input', { bubbles: true }));
            range.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
        }, target).catch(() => false);

        if (directSet) {
            await interruptibleSleep(300, options);
            if ((await this.detectOutputQuantityValue(page)) === target) {
                return true;
            }
        }

        const dragPoint = await page.evaluate((value) => {
            const normalizeText = text => String(text || '').replace(/\s+/g, ' ').trim();
            const isVisible = (el) => {
                if (!el || !(el instanceof Element)) return false;
                const rect = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return rect.width > 0 &&
                    rect.height > 0 &&
                    style.visibility !== 'hidden' &&
                    style.display !== 'none' &&
                    style.opacity !== '0';
            };
            const findSlider = () => {
                const labelPattern = /输出数量|output\s*quantity/i;
                const labels = Array.from(document.querySelectorAll('div, span, p, label'))
                    .filter(isVisible)
                    .filter(el => labelPattern.test(normalizeText(el.innerText || el.textContent || '')));

                for (const label of labels) {
                    let current = label;
                    for (let depth = 0; depth < 8 && current; depth += 1) {
                        const slider = current.querySelector('[role="slider"]');
                        if (slider && isVisible(slider)) {
                            return slider;
                        }
                        current = current.parentElement;
                    }
                }

                return Array.from(document.querySelectorAll('[role="slider"]'))
                    .filter(isVisible)
                    .filter(slider => {
                        const rect = slider.getBoundingClientRect();
                        return rect.left >= 180 && rect.left <= 560 && rect.top >= 300;
                    })[0] || null;
            };

            const slider = findSlider();
            if (!slider) return null;

            let track = slider.parentElement;
            for (let depth = 0; depth < 5 && track; depth += 1) {
                const rect = track.getBoundingClientRect();
                if (rect.width >= 120 && rect.height >= 8 && rect.height <= 40) {
                    break;
                }
                track = track.parentElement;
            }
            if (!track) return null;

            const trackRect = track.getBoundingClientRect();
            const thumbRect = slider.getBoundingClientRect();
            const min = Number(slider.getAttribute('aria-valuemin')) || 1;
            const max = Number(slider.getAttribute('aria-valuemax')) || 4;
            const next = Math.max(min, Math.min(max, Number(value) || min));
            const ratio = max > min ? (next - min) / (max - min) : 1;
            const endX = trackRect.left + Math.max(1, Math.min(trackRect.width - 1, trackRect.width * ratio));
            const y = trackRect.top + trackRect.height / 2;

            return {
                startX: thumbRect.left + thumbRect.width / 2,
                startY: thumbRect.top + thumbRect.height / 2,
                endX,
                endY: y,
                currentValue: Number(slider.getAttribute('aria-valuenow')) || 0
            };
        }, target).catch(() => null);

        if (dragPoint && Number.isFinite(dragPoint.endX) && Number.isFinite(dragPoint.endY)) {
            await page.mouse.move(dragPoint.startX, dragPoint.startY).catch(() => {});
            await page.mouse.down().catch(() => {});
            await page.mouse.move(dragPoint.endX, dragPoint.endY, { steps: 8 }).catch(() => {});
            await page.mouse.up().catch(() => {});
            await interruptibleSleep(700, options);
            if ((await this.detectOutputQuantityValue(page)) === target) {
                return true;
            }

            await page.mouse.click(dragPoint.endX, dragPoint.endY).catch(() => {});
            await interruptibleSleep(500, options);
            if ((await this.detectOutputQuantityValue(page)) === target) {
                return true;
            }
        }

        const clickPoint = await page.evaluate((value) => {
            const normalizeText = text => String(text || '').replace(/\s+/g, ' ').trim();
            const isVisible = (el) => {
                if (!el || !(el instanceof Element)) return false;
                const rect = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return rect.width > 0 &&
                    rect.height > 0 &&
                    style.visibility !== 'hidden' &&
                    style.display !== 'none' &&
                    style.opacity !== '0';
            };
            const labelPattern = /输出数量|杈撳嚭鏁伴噺|output\s*quantity/i;
            const findRoot = () => {
                const labels = Array.from(document.querySelectorAll('div, span, p, label'))
                    .filter(isVisible)
                    .filter(el => labelPattern.test(normalizeText(el.innerText || el.textContent || '')))
                    .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
                for (const label of labels) {
                    let current = label;
                    for (let depth = 0; depth < 8 && current; depth += 1) {
                        const rect = current.getBoundingClientRect();
                        if (
                            rect.left >= 180 &&
                            rect.left <= 560 &&
                            rect.width >= 160 &&
                            (current.querySelector('input[type="range"], [role="slider"]') || depth >= 2)
                        ) {
                            return current;
                        }
                        current = current.parentElement;
                    }
                }
                return document.body;
            };
            const root = findRoot();
            const slider = Array.from(root.querySelectorAll('input[type="range"], [role="slider"]'))
                .filter(isVisible)
                .sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0];
            const trackCandidates = [];

            if (slider) {
                let current = slider;
                for (let depth = 0; depth < 6 && current; depth += 1) {
                    const rect = current.getBoundingClientRect();
                    if (rect.width >= 120 && rect.width <= 320 && rect.height >= 4 && rect.height <= 60) {
                        trackCandidates.push(current);
                    }
                    current = current.parentElement;
                }
            }

            for (const el of root.querySelectorAll('div, span')) {
                if (!isVisible(el)) continue;
                const rect = el.getBoundingClientRect();
                if (rect.left < 180 || rect.left > 560 || rect.width < 120 || rect.width > 320 || rect.height < 3 || rect.height > 36) continue;
                trackCandidates.push(el);
            }

            const track = trackCandidates
                .sort((a, b) => {
                    const ar = a.getBoundingClientRect();
                    const br = b.getBoundingClientRect();
                    if (Math.abs(br.width - ar.width) > 4) return br.width - ar.width;
                    return br.top - ar.top;
                })[0];
            if (!track) return null;

            const rect = track.getBoundingClientRect();
            const min = Number(slider?.getAttribute('aria-valuemin') || slider?.min) || 1;
            const max = Number(slider?.getAttribute('aria-valuemax') || slider?.max) || 4;
            const ratio = max > min ? (Math.max(min, Math.min(max, Number(value) || min)) - min) / (max - min) : 1;
            return {
                x: rect.left + Math.max(1, Math.min(rect.width - 1, rect.width * ratio)),
                y: rect.top + rect.height / 2
            };
        }, target).catch(() => null);

        if (!clickPoint || !Number.isFinite(clickPoint.x) || !Number.isFinite(clickPoint.y)) {
            return false;
        }

        await page.mouse.click(clickPoint.x, clickPoint.y).catch(() => {});
        await interruptibleSleep(500, options);
        return (await this.detectOutputQuantityValue(page)) === target;
    },

    async ensureOutputQuantity(page, outputQuantity, profile = {}, options = {}) {
        const target = Math.max(1, Math.min(4, Number(outputQuantity) || 1));

        if (profile.outputQuantityControl !== 'slider') {
            const current = await this.detectOutputQuantityValue(page);
            if (current === target) {
                return true;
            }

            const clicked = await this.clickLegilSettingOption(page, String(target), options);
            if (clicked) {
                return true;
            }
            return false;
        }

        const sliderSet = await this.setOutputQuantityWithSlider(page, target, options);
        if (!sliderSet) {
            return false;
        }

        const detected = await this.detectOutputQuantityValue(page);
        return !detected || detected === target;
    },

    async applyGenerationSettings(page, settings = this.generationSettings, options = {}) {
        const normalized = this.normalizeGenerationSettings(settings);
        logger.info(`Legil 参数: 模型 ${this.getImageModelLabel(normalized.imageModel)}，宽高比 ${normalized.aspectRatio}，分辨率 ${normalized.resolution}，输出数量 ${normalized.outputQuantity}`);
        const applied = { ...normalized };
        const profile = this.getModelParameterProfile(normalized.imageModel);

        await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
        await interruptibleSleep(500, options);
        await this.closeOpenPreviewModal(page, options);

        await this.ensureImageModel(page, normalized.imageModel, options);

        const tasks = [
            { label: '宽高比', value: normalized.aspectRatio, type: 'option' },
            { label: '分辨率', value: normalized.resolution, type: 'option' },
            { label: '输出数量', value: String(normalized.outputQuantity), type: 'quantity' }
        ];

        for (const task of tasks) {
            throwIfAborted(options);
            await this.closeOpenPreviewModal(page, options);
            const clicked = task.type === 'quantity'
                ? await this.ensureOutputQuantity(page, normalized.outputQuantity, profile, options)
                : await this.clickLegilSettingOption(page, task.value, options);
            if (clicked) {
                logger.info(`✅ 已应用 ${task.label}: ${task.value}`);
                if (task.type === 'quantity') {
                    if (profile.outputQuantityControl === 'slider') {
                        const detected = await this.detectOutputQuantityValue(page);
                        if (detected) {
                            logger.info(`✅ 已确认输出数量: ${detected}`);
                        }
                    } else {
                        logger.info(`✅ 已按按钮模式应用输出数量: ${task.value}`);
                    }
                }
            } else {
                if (task.label === '输出数量') {
                    if (profile.outputQuantityControl === 'slider') {
                        throw new Error(`未能确认 Legil ${task.label} ${task.value}，已停止以避免静默降级为1张`);
                    }
                    logger.warn(`未能确认 Legil ${task.label} ${task.value}，继续使用页面当前值以兼容非滑杆模型`);
                    continue;
                }
                logger.warn(`未找到 Legil ${task.label}选项 "${task.value}"，继续使用页面当前值`);
            }
        }

        await interruptibleSleep(500, options);
        return applied;
    }

    /**
     * =====================================================
     * 点击生成按钮
     * =====================================================
     */,

    async clickGenerateButton(page, options = {}) {
        try {
            throwIfAborted(options);
            const buttonSelectors = [
                'button:has-text("创建图片")',
                'button:has-text("重新生成")',
                'button:has-text("生成")'
            ];

            for (const selector of buttonSelectors) {
                try {
                    const button = await page.waitForSelector(selector, { timeout: 2000 });
                    if (button) {
                        const isVisible = await button.isVisible().catch(() => false);
                        const isEnabled = await button.isEnabled().catch(() => false);
                        if (isVisible && isEnabled) {
                            logger.info(`找到生成按钮: ${selector}`);
                            const clicked = await this.clickLegilElementWithFallback(page, button, `generate button ${selector}`, options);
                            if (clicked) {
                                logger.info('已点击生成按钮');
                                return true;
                            }
                            logger.warn(`生成按钮点击失败，继续尝试下一个选择器: ${selector}`);
                        }
                    }
                } catch (e) {}
            }

            throw new Error('未找到生成按钮');

        } catch (error) {
            logger.error(`点击生成按钮失败: ${error.message}`);
            return false;
        }
    }
    };
};
