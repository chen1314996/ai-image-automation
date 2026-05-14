/**
 * 生成等待和超时清理。
 *
 * 这里负责等待 Legil 生成结束，并在超时时尝试清理页面状态。
 */
module.exports = function createGenerationWaiterMethods(deps) {
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
    async waitForGenerationComplete(page, beforeImageKeys = [], options = {}) {
        const baseMaxWaitTime = options.maxWaitTime || 300000;
        const acceptStablePartialOutputs = options.acceptStablePartialOutputs === true;
        const maxWaitTime = acceptStablePartialOutputs
            ? Math.max(baseMaxWaitTime, 360000)
            : baseMaxWaitTime;
        const partialOutputSettleTime = Math.max(15000, Math.min(120000, Number(options.partialOutputSettleTime) || 30000));
        const checkInterval = 3000;
        let waited = 0;
        let sawBusyState = false;
        let readyConfirmations = 0;
        let lastReadySignature = '';
        let firstThreeSlotsSeenAt = null;
        let lastFourthSlotScanAt = 0;
        const beforeKeys = Array.isArray(beforeImageKeys) ? beforeImageKeys : [];
        const expectedOutputCount = LEGIL_OUTPUT_QUANTITIES.includes(Number(options.expectedOutputCount))
            ? Number(options.expectedOutputCount)
            : 1;

        logger.info('等待图片生成中...');

        while (waited < maxWaitTime) {
            // 检查调用方是否请求取消
            if (isAbortRequested(options)) {
                logger.info('⏹️ 检测到取消信号，中断等待');
                throw new Error('操作已取消');
            }

            await interruptibleSleep(checkInterval, options);
            waited += checkInterval;

            const state = await page.evaluate((knownKeys) => {
                const normalizeSrc = (src) => {
                    let value = String(src || '');
                    for (let i = 0; i < 3; i++) {
                        try {
                            const decoded = decodeURIComponent(value);
                            if (decoded === value) break;
                            value = decoded;
                        } catch (e) {
                            break;
                        }
                    }
                    return value;
                };
                const extractImageUrl = (src) => {
                    const normalized = normalizeSrc(src);
                    try {
                        const url = new URL(normalized, window.location.href);
                        const embeddedUrl = url.searchParams.get('url');
                        return embeddedUrl ? normalizeSrc(embeddedUrl) : normalized;
                    } catch (e) {
                        return normalized;
                    }
                };
                const collectImageSources = (img) => {
                    const values = [
                        img.currentSrc,
                        img.src,
                        img.getAttribute('src'),
                        img.getAttribute('data-src'),
                        img.getAttribute('data-original'),
                        img.getAttribute('data-url'),
                        img.dataset?.src,
                        img.dataset?.original,
                        img.dataset?.url
                    ];

                    const srcset = img.getAttribute('srcset') || img.getAttribute('data-srcset') || '';
                    srcset.split(',').forEach(part => {
                        const candidate = part.trim().split(/\s+/)[0];
                        if (candidate) values.push(candidate);
                    });

                    return values
                        .map(value => String(value || '').split('#')[0].trim())
                        .filter(Boolean);
                };
                const pickOutputSource = (img) => {
                    const sources = collectImageSources(img);
                    for (const source of sources) {
                        const outputSrc = extractImageUrl(source);
                        if (outputSrc.includes('/output') && !outputSrc.includes('/input')) {
                            return {
                                src: source,
                                normalizedSrc: normalizeSrc(source),
                                outputSrc
                            };
                        }
                    }

                    return {
                        src: sources[0] || '',
                        normalizedSrc: sources[0] ? normalizeSrc(sources[0]) : '',
                        outputSrc: sources[0] ? extractImageUrl(sources[0]) : ''
                    };
                };

                const keys = new Set();
                for (const src of knownKeys || []) {
                    const raw = String(src || '').split('#')[0];
                    if (!raw) continue;
                    keys.add(raw);
                    keys.add(normalizeSrc(raw));
                    keys.add(extractImageUrl(raw));
                }

                const isVisible = (el) => {
                    const rect = el.getBoundingClientRect();
                    const style = window.getComputedStyle(el);
                    return rect.width > 0 &&
                        rect.height > 0 &&
                        style.visibility !== 'hidden' &&
                        style.display !== 'none' &&
                        style.opacity !== '0';
                };

                const resolveOutputSlotBox = (img) => {
                    const imageRect = img.getBoundingClientRect();
                    let best = {
                        left: imageRect.left,
                        top: imageRect.top,
                        width: imageRect.width,
                        height: imageRect.height
                    };

                    let current = img.parentElement;
                    for (let i = 0; i < 8 && current; i++) {
                        const rect = current.getBoundingClientRect();
                        const style = window.getComputedStyle(current);
                        const isUsefulSlot =
                            rect.left > 260 &&
                            rect.width >= Math.max(90, imageRect.width) &&
                            rect.height >= Math.max(70, imageRect.height) &&
                            rect.width <= 700 &&
                            rect.height <= 520 &&
                            style.visibility !== 'hidden' &&
                            style.display !== 'none' &&
                            style.opacity !== '0';

                        if (isUsefulSlot) {
                            best = {
                                left: rect.left,
                                top: rect.top,
                                width: rect.width,
                                height: rect.height
                            };

                            if (
                                rect.width >= 120 &&
                                rect.height >= 100 &&
                                rect.width <= 360 &&
                                rect.height <= 360
                            ) {
                                break;
                            }
                        }

                        current = current.parentElement;
                    }

                    return best;
                };

                const text = document.body?.innerText || '';
                const busyByText = /生成中|正在生成|排队|处理中|请稍候|loading/i.test(text);
                const busyByElement = Array.from(document.querySelectorAll(
                    'svg[class*="animate-spin"], [class*="loading"], [class*="spin"], [aria-busy="true"]'
                )).some(el => isVisible(el));

                const visibleButtons = Array.from(document.querySelectorAll('button'))
                    .filter(button => isVisible(button));

                const generateButtonReady = visibleButtons.some(button => {
                    const label = button.innerText || button.textContent || '';
                    return /创建图片|重新生成|生成/.test(label) && !/生成中|正在生成|排队|处理中/.test(label) && !button.disabled;
                });

                const generateButtonBusy = visibleButtons.some(button => {
                    const label = button.innerText || button.textContent || '';
                    return /生成中|正在生成|排队|处理中/.test(label) || (button.disabled && /生成/.test(label));
                });

                const newOutputImages = Array.from(document.querySelectorAll('img'))
                    .map((img, index) => {
                        const rect = img.getBoundingClientRect();
                        const slotBox = resolveOutputSlotBox(img);
                        const sourceInfo = pickOutputSource(img);
                        return {
                            index,
                            src: sourceInfo.src,
                            normalizedSrc: sourceInfo.normalizedSrc,
                            outputSrc: sourceInfo.outputSrc,
                            rect,
                            left: slotBox.left,
                            top: slotBox.top,
                            width: slotBox.width,
                            height: slotBox.height,
                            imageWidth: rect.width,
                            imageHeight: rect.height,
                            naturalWidth: img.naturalWidth || 0,
                            naturalHeight: img.naturalHeight || 0,
                            area: Math.max(slotBox.width * slotBox.height, rect.width * rect.height),
                            naturalArea: (img.naturalWidth || 0) * (img.naturalHeight || 0)
                        };
                    })
                    .filter(item =>
                        item.src &&
                            !keys.has(item.src) &&
                            !keys.has(item.normalizedSrc) &&
                            !keys.has(item.outputSrc) &&
                            item.outputSrc.includes('/output') &&
                            !item.outputSrc.includes('/input') &&
                            item.left > 260 &&
                            item.width >= 90 &&
                            item.height >= 70 &&
                            item.imageWidth > 8 &&
                            item.imageHeight > 8 &&
                            (item.area > 6000 || item.naturalArea > 6000)
                    );

                return {
                    busy: busyByText || busyByElement || generateButtonBusy,
                    busyByText,
                    busyByElement,
                    generateButtonBusy,
                    generateButtonReady,
                    newImageCount: newOutputImages.length,
                    newImageKeys: newOutputImages
                        .map(item => item.outputSrc || item.normalizedSrc || item.src)
                        .sort()
                };
            }, beforeKeys).catch(() => ({
                busy: false,
                busyByText: false,
                busyByElement: false,
                generateButtonBusy: false,
                generateButtonReady: false,
                newImageCount: 0,
                newImageKeys: []
            }));

            let scannedOutputImages = await this.getNewOutputImageInfos(page, beforeKeys, expectedOutputCount, {
                scanScroll: false
            });
            let currentRowTop = this.resolveCurrentOutputRowTop(scannedOutputImages);
            let failedOutputSlots = await this.getFailedOutputSlotInfos(page, scannedOutputImages, expectedOutputCount, {
                scanScroll: false,
                currentRowOnly: true,
                targetRowTop: currentRowTop
            });

            if (failedOutputSlots.length > 0 && currentRowTop === null) {
                currentRowTop = this.resolveCurrentOutputRowTop(scannedOutputImages, failedOutputSlots);
            }

            const visibleFinishedSlotCount = Math.min(expectedOutputCount, scannedOutputImages.length + failedOutputSlots.length);
            const shouldScanFourthSlot = expectedOutputCount === 4 &&
                visibleFinishedSlotCount >= 3 &&
                visibleFinishedSlotCount < expectedOutputCount;

            if (shouldScanFourthSlot) {
                if (firstThreeSlotsSeenAt === null) {
                    firstThreeSlotsSeenAt = waited;
                    lastFourthSlotScanAt = waited;
                } else if (waited - lastFourthSlotScanAt >= 30000) {
                    logger.info('已检测到当前行前3个输出槽位完成，横向查看第4张图生成状态...');
                    const hiddenOutputImages = await this.getNewOutputImageInfos(page, beforeKeys, expectedOutputCount, {
                        scanScroll: true,
                        currentRowOnly: true,
                        targetRowTop: currentRowTop
                    });
                    scannedOutputImages = this.mergeOutputImageInfos(scannedOutputImages, hiddenOutputImages);
                    currentRowTop = this.resolveCurrentOutputRowTop(scannedOutputImages, failedOutputSlots);
                    failedOutputSlots = await this.getFailedOutputSlotInfos(page, scannedOutputImages, expectedOutputCount, {
                        scanScroll: true,
                        currentRowOnly: true,
                        targetRowTop: currentRowTop
                    });
                    lastFourthSlotScanAt = waited;
                }
            } else {
                firstThreeSlotsSeenAt = null;
                lastFourthSlotScanAt = 0;
            }

            if (scannedOutputImages.length > state.newImageCount) {
                state.newImageCount = scannedOutputImages.length;
                state.newImageKeys = scannedOutputImages
                    .map(item => item.identity || item.outputSrc || item.src)
                    .filter(Boolean)
                    .sort();
            }
            state.failedImageCount = failedOutputSlots.length;
            state.finishedSlotCount = Math.min(expectedOutputCount, state.newImageCount + state.failedImageCount);
            if (state.busy) {
                sawBusyState = true;
            }

            const hasExpectedOutputs = state.finishedSlotCount >= expectedOutputCount;
            const stillGeneratingCurrentTask = state.generateButtonBusy === true;
            const hasPartialOutputs = state.newImageCount > 0 && state.finishedSlotCount < expectedOutputCount;
            const pageLooksIdle = state.generateButtonReady === true || (sawBusyState && state.busy === false);
            const canAcceptStablePartialOutputs = acceptStablePartialOutputs &&
                hasPartialOutputs &&
                pageLooksIdle &&
                waited >= partialOutputSettleTime;
            const acceptingPartialOutputs = canAcceptStablePartialOutputs && !hasExpectedOutputs;
            const canAcceptStableOutputs = (hasExpectedOutputs || canAcceptStablePartialOutputs) && !stillGeneratingCurrentTask;

            if (canAcceptStableOutputs) {
                const signature = `${(state.newImageKeys || []).join('|')}|failed:${state.failedImageCount}`;
                if (signature && signature === lastReadySignature) {
                    readyConfirmations += 1;
                } else {
                    lastReadySignature = signature;
                    readyConfirmations = 1;
                    if (acceptingPartialOutputs) {
                        logger.warn(`Legil 页面生成状态已结束，但只检测到 ${state.newImageCount}/${expectedOutputCount} 张有效新图，正在按创意拓展页面逻辑二次确认并保存已检测结果...`);
                    } else if (state.failedImageCount > 0) {
                        logger.warn(`检测到 ${state.newImageCount}/${expectedOutputCount} 张有效新图，另有 ${state.failedImageCount} 张失败占位，将跳过失败图并二次确认...`);
                    } else {
                        logger.info(`检测到 ${state.newImageCount}/${expectedOutputCount} 张候选新图，正在二次确认生成状态...`);
                    }
                }

                if (readyConfirmations >= 2) {
                    if (state.busy && !state.generateButtonReady) {
                        logger.warn('页面仍有全局加载/处理中标记，但本次输出图已稳定，继续保存图片');
                    }
                    if (acceptingPartialOutputs) {
                        logger.warn(`✓ Legil 页面已空闲，新图结果已稳定；将保存已检测到的 ${state.newImageCount}/${expectedOutputCount} 张有效图`);
                    } else if (state.failedImageCount > 0) {
                        logger.warn(`✅ 生成状态已稳定结束：${state.newImageCount} 张有效图，跳过 ${state.failedImageCount} 张失败图`);
                    } else {
                        logger.info(`✅ 检测到 ${state.newImageCount} 张新生成图片，且生成状态已稳定结束`);
                    }
                    await interruptibleSleep(1000, options);
                    return true;
                }
            } else {
                if ((state.newImageCount > 0 || state.failedImageCount > 0) && waited % 30000 === 0) {
                    if (state.failedImageCount > 0) {
                        logger.info(`已检测到 ${state.newImageCount}/${expectedOutputCount} 张有效图，${state.failedImageCount} 张失败占位，继续等待其余输出...`);
                    } else {
                        logger.info(`已检测到 ${state.newImageCount}/${expectedOutputCount} 张新图，继续等待其余输出...`);
                    }
                }
                readyConfirmations = 0;
                lastReadySignature = '';
            }

            if (waited % 30000 === 0) {
                logger.info(`⏳ 已等待 ${waited / 1000} 秒...`);
            }
        }

        logger.error('等待图片生成超时');
        return false;
    },

    async cleanupTimedOutGeneration(page, options = {}) {
        if (!page || page.isClosed()) {
            return false;
        }

        throwIfAborted(options);
        logger.warn('⏱️ 当前 Legil 生成等待超时，尝试删除卡住的生成中任务...');

        const rowHandle = await page.evaluateHandle(() => {
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

            const getRect = (el) => {
                const rect = el.getBoundingClientRect();
                return {
                    left: rect.left,
                    top: rect.top,
                    right: rect.right,
                    bottom: rect.bottom,
                    width: rect.width,
                    height: rect.height
                };
            };

            const busyElements = Array.from(document.querySelectorAll(
                'svg[class*="animate-spin"], [class*="loading"], [class*="spin"], [aria-busy="true"], div, span, button'
            )).filter(el => {
                if (!isVisible(el)) return false;
                const text = String(el.innerText || el.textContent || '');
                const className = String(el.className || '');
                const ariaBusy = el.getAttribute('aria-busy') === 'true';
                return ariaBusy ||
                    /animate-spin|loading|spin/i.test(className) ||
                    /生成中|正在生成|排队|处理中|请稍候|loading/i.test(text);
            });

            const candidates = [];
            for (const busyEl of busyElements) {
                let current = busyEl;
                for (let depth = 0; depth < 10 && current; depth++) {
                    const rect = getRect(current);
                    if (
                        rect.left > 300 &&
                        rect.top > 60 &&
                        rect.width >= 420 &&
                        rect.height >= 120 &&
                        rect.height <= 520 &&
                        isVisible(current)
                    ) {
                        const text = String(current.innerText || current.textContent || '');
                        const imageCount = current.querySelectorAll('img').length;
                        const busyCount = current.querySelectorAll('svg[class*="animate-spin"], [class*="loading"], [class*="spin"], [aria-busy="true"]').length;
                        candidates.push({
                            el: current,
                            top: rect.top,
                            left: rect.left,
                            area: rect.width * rect.height,
                            score: (busyCount * 10) + (imageCount * 2) + (/生成中|正在生成|排队|处理中/.test(text) ? 10 : 0) - depth
                        });
                    }
                    current = current.parentElement;
                }
            }

            candidates.sort((a, b) => {
                if (b.score !== a.score) return b.score - a.score;
                if (Math.abs(a.top - b.top) > 8) return a.top - b.top;
                if (a.area !== b.area) return a.area - b.area;
                return a.left - b.left;
            });

            return candidates[0]?.el || null;
        }).catch(() => null);

        const rowElement = rowHandle ? rowHandle.asElement() : null;
        if (!rowElement) {
            logger.warn('未找到可删除的生成中任务行，可能页面结构已变化');
            return false;
        }

        await rowElement.hover({ timeout: 3000 }).catch(() => {});
        await interruptibleSleep(500, options);

        const deleteHandle = await page.evaluateHandle((row) => {
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

            const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
            const rowRect = row.getBoundingClientRect();
            const controls = Array.from(row.querySelectorAll('button, [role="button"], [aria-label], [title], svg, div, span'));
            const candidates = [];

            for (const el of controls) {
                if (!isVisible(el)) continue;
                const rect = el.getBoundingClientRect();
                if (rect.left < rowRect.right - 90 || rect.top > rowRect.top + 80) continue;

                const text = normalizeText(el.innerText || el.textContent || '');
                const aria = normalizeText(el.getAttribute('aria-label'));
                const title = normalizeText(el.getAttribute('title'));
                const className = normalizeText(el.className);
                const html = normalizeText(el.outerHTML || '');
                const deleteLike =
                    /删除|delete|trash|移除|remove/.test(text) ||
                    /删除|delete|trash|移除|remove/.test(aria) ||
                    /删除|delete|trash|移除|remove/.test(title) ||
                    /delete|trash|remove/.test(className) ||
                    /trash|delete|remove/.test(html);

                const clickable = el.closest('button, [role="button"], [aria-label], [title], div') || el;
                candidates.push({
                    el: clickable,
                    top: rect.top,
                    left: rect.left,
                    area: rect.width * rect.height,
                    score: (deleteLike ? 0 : 20) + Math.abs(rowRect.right - rect.right) / 10 + Math.abs(rowRect.top - rect.top) / 10
                });
            }

            candidates.sort((a, b) => {
                if (a.score !== b.score) return a.score - b.score;
                if (Math.abs(a.top - b.top) > 4) return a.top - b.top;
                return b.left - a.left;
            });

            return candidates[0]?.el || null;
        }, rowElement).catch(() => null);

        const deleteElement = deleteHandle ? deleteHandle.asElement() : null;
        if (deleteElement) {
            await deleteElement.click({ timeout: 5000, force: true }).catch(async () => {
                const box = await deleteElement.boundingBox().catch(() => null);
                if (box) {
                    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
                }
            });
        } else {
            const box = await rowElement.boundingBox().catch(() => null);
            if (!box) {
                logger.warn('未找到删除按钮，也无法获取生成中任务行位置');
                return false;
            }
            await page.mouse.click(Math.max(0, box.x + box.width - 18), Math.max(0, box.y + 22));
        }

        await interruptibleSleep(800, options);
        await this.confirmDeleteDialogIfNeeded(page, options);
        await interruptibleSleep(1200, options);
        logger.info('✅ 已尝试删除超时的 Legil 生成中任务，继续后续队列');
        return true;
    },

    async confirmDeleteDialogIfNeeded(page, options = {}) {
        throwIfAborted(options);

        const confirmHandle = await page.evaluateHandle(() => {
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

            const dialogs = Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"], [class*="modal"], [class*="popover"]'))
                .filter(isVisible);
            const roots = dialogs.length ? dialogs : [document.body];
            const candidates = [];

            for (const root of roots) {
                for (const el of root.querySelectorAll('button, [role="button"], div, span')) {
                    if (!isVisible(el)) continue;
                    const text = String(el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
                    if (!/确认|确定|删除|移除|Delete|Remove|OK/i.test(text)) continue;
                    const rect = el.getBoundingClientRect();
                    candidates.push({
                        el: el.closest('button, [role="button"], div') || el,
                        text,
                        top: rect.top,
                        left: rect.left,
                        score: (/删除|移除|Delete|Remove/i.test(text) ? 0 : 5) + (/取消|Cancel/i.test(text) ? 100 : 0)
                    });
                }
            }

            candidates.sort((a, b) => {
                if (a.score !== b.score) return a.score - b.score;
                if (Math.abs(a.top - b.top) > 4) return b.top - a.top;
                return b.left - a.left;
            });

            return candidates[0]?.el || null;
        }).catch(() => null);

        const confirmElement = confirmHandle ? confirmHandle.asElement() : null;
        if (confirmElement) {
            await confirmElement.click({ timeout: 3000, force: true }).catch(() => {});
            logger.info('已确认删除超时任务');
            return true;
        }

        return false;
    },
    };
};
