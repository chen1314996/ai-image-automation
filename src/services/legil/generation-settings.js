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
        normalizeImageUrl,
        isLegilOutputUrl,
        extractLegilImageUrl,
        isPageLocalImageUrl,
        LEGIL_DEFAULT_SETTINGS,
        LEGIL_IMAGE_MODEL_OPTIONS,
        LEGIL_ASPECT_RATIOS,
        LEGIL_RESOLUTIONS,
        LEGIL_OUTPUT_QUANTITIES,
        IMAGE_EXTENSIONS,
        LEGIL_IMAGE_TO_IMAGE_URL,
        LEGIL_ERROR_SCREENSHOT_DIR
    } = deps;

    return {
    async detectCurrentImageModel(page) {
        const labels = this.getImageModelOptions().map(option => option.label);
        return page.evaluate((modelLabels) => {
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

            const candidates = [];
            for (const el of document.querySelectorAll('button, [role="button"], [aria-haspopup], [class*="select"], [class*="dropdown"], div, span')) {
                if (!isVisible(el)) continue;
                const rect = el.getBoundingClientRect();
                if (rect.left < 180 || rect.left > 520 || rect.top < 60 || rect.top > 180 || rect.width > 340 || rect.height > 100) continue;

                const text = normalizeText(el.innerText || el.textContent || '');
                const label = modelLabels.find(item => text === item || text.includes(item));
                if (!label) continue;

                candidates.push({
                    label,
                    top: rect.top,
                    left: rect.left,
                    area: rect.width * rect.height
                });
            }

            candidates.sort((a, b) => {
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
                return el.closest('button, [role="button"], [aria-haspopup], [class*="select"], [class*="dropdown"], [class*="trigger"]') || el;
            };

            const candidates = [];
            for (const el of document.querySelectorAll('button, [role="button"], [aria-haspopup], [class*="select"], [class*="dropdown"], [class*="trigger"], div, span')) {
                if (!isVisible(el)) continue;
                const rect = el.getBoundingClientRect();
                if (rect.left < 180 || rect.left > 520 || rect.top < 60 || rect.top > 180 || rect.width > 340 || rect.height > 100) continue;

                const text = normalizeText(el.innerText || el.textContent || '');
                if (!modelLabels.some(label => text === label || text.includes(label))) continue;

                const clickable = clickableFor(el);
                if (!isVisible(clickable)) continue;
                const clickableRect = clickable.getBoundingClientRect();
                if (clickableRect.left < 180 || clickableRect.left > 520 || clickableRect.width > 360 || clickableRect.height > 120) continue;

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
        }, labels).catch(() => null);

        return handle ? handle.asElement() : null;
    },

    async clickImageModelOption(page, targetLabel, minTop = 0, options = {}) {
        const handle = await page.evaluateHandle(({ label, optionMinTop }) => {
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
                return el.closest('button, [role="option"], [role="menuitem"], [role="button"], [class*="option"], [class*="item"], [class*="select"], [class*="dropdown"], div') || el;
            };

            const candidates = [];
            for (const el of document.querySelectorAll('button, [role="option"], [role="menuitem"], [role="button"], [class*="option"], [class*="item"], div, span')) {
                if (!isVisible(el)) continue;
                const text = normalizeText(el.innerText || el.textContent || '');
                if (!(text === label || text.includes(label))) continue;

                const clickable = clickableFor(el);
                if (!isVisible(clickable)) continue;
                const rect = clickable.getBoundingClientRect();
                if (rect.left < 180 || rect.left > 520 || rect.top < optionMinTop || rect.width > 360 || rect.height > 80) continue;

                candidates.push({
                    el: clickable,
                    top: rect.top,
                    left: rect.left,
                    area: rect.width * rect.height
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
        }, {
            label: targetLabel,
            optionMinTop: Number.isFinite(minTop) ? minTop : 0
        }).catch(() => null);

        const optionElement = handle ? handle.asElement() : null;
        if (!optionElement) {
            return false;
        }

        await optionElement.click();
        await interruptibleSleep(500, options);
        return true;
    },

    async hasOpenImagePreviewModal(page) {
        if (!page || page.isClosed()) {
            return false;
        }

        return page.evaluate(() => {
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
    },

    async closeOpenPreviewModal(page, options = {}) {
        if (!page || page.isClosed()) {
            return false;
        }

        const hadModal = await this.hasOpenImagePreviewModal(page);
        if (!hadModal) {
            return false;
        }

        logger.info('检测到未关闭的大图弹窗，正在关闭...');

        for (let attempt = 0; attempt < 4; attempt++) {
            const clickedClose = await page.evaluate(() => {
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
            }).catch(() => ({ clicked: false, box: null }));

            await browserController.sleep(500).catch(() => {});
            if (!(await this.hasOpenImagePreviewModal(page))) {
                logger.info('✅ 大图弹窗已关闭');
                return true;
            }

            await page.keyboard.press('Escape').catch(() => {});
            await browserController.sleep(500).catch(() => {});
            if (!(await this.hasOpenImagePreviewModal(page))) {
                logger.info('✅ 大图弹窗已关闭');
                return true;
            }

            if (clickedClose?.box) {
                await page.mouse.click(clickedClose.box.x, clickedClose.box.y).catch(() => {});
                await browserController.sleep(500).catch(() => {});
                if (!(await this.hasOpenImagePreviewModal(page))) {
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

            await trigger.click();
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

        await optionElement.click();
        await interruptibleSleep(300, options);
        return true;
    },

    async applyGenerationSettings(page, settings = this.generationSettings, options = {}) {
        const normalized = this.normalizeGenerationSettings(settings);
        logger.info(`Legil 参数: 模型 ${this.getImageModelLabel(normalized.imageModel)}，宽高比 ${normalized.aspectRatio}，分辨率 ${normalized.resolution}，输出数量 ${normalized.outputQuantity}`);
        const applied = { ...normalized };

        await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
        await interruptibleSleep(500, options);
        await this.closeOpenPreviewModal(page, options);

        await this.ensureImageModel(page, normalized.imageModel, options);

        const tasks = [
            { label: '宽高比', value: normalized.aspectRatio },
            { label: '分辨率', value: normalized.resolution },
            { label: '输出数量', value: String(normalized.outputQuantity) }
        ];

        for (const task of tasks) {
            throwIfAborted(options);
            await this.closeOpenPreviewModal(page, options);
            const clicked = await this.clickLegilSettingOption(page, task.value, options);
            if (clicked) {
                logger.info(`✅ 已应用 ${task.label}: ${task.value}`);
            } else {
                logger.warn(`未找到 Legil ${task.label}选项 "${task.value}"，继续使用页面当前值`);
                if (task.label === '输出数量') {
                    applied.outputQuantity = 1;
                }
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
                            await button.click();
                            logger.info('已点击生成按钮');
                            return true;
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
