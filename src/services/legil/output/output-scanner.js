/**
 * 结果扫描。
 *
 * 这里负责在 Legil 页面里寻找新图片、失败位置和可保存的图片元素。
 */
module.exports = function createOutputScannerMethods(deps) {
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
    async getNewOutputImageInfos(page, beforeImageKeys = [], limit = 1, scanOptions = {}) {
        const safeLimit = Math.max(1, Math.min(4, Number(limit) || 1));
        const safeScanOptions = {
            scanScroll: scanOptions.scanScroll !== false,
            currentRowOnly: scanOptions.currentRowOnly === true,
            targetRowTop: Number.isFinite(Number(scanOptions.targetRowTop)) ? Number(scanOptions.targetRowTop) : null
        };

        return page.evaluate(async ({ knownKeys, safeLimit, scanOptions }) => {
            const normalizeSrc = (src) => {
                let value = String(src || '').split('#')[0];
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
            const outputIdentity = (src) => {
                const outputSrc = extractImageUrl(src);
                const match = outputSrc.match(/\/output\/[^?#\s)]+/);
                return match ? match[0] : outputSrc;
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
                            outputSrc,
                            identity: outputIdentity(source)
                        };
                    }
                }

                const fallback = sources[0] || '';
                return {
                    src: fallback,
                    normalizedSrc: fallback ? normalizeSrc(fallback) : '',
                    outputSrc: fallback ? extractImageUrl(fallback) : '',
                    identity: fallback ? outputIdentity(fallback) : ''
                };
            };
            const keys = new Set();
            for (const src of knownKeys || []) {
                const raw = String(src || '').split('#')[0];
                if (!raw) continue;
                keys.add(raw);
                keys.add(normalizeSrc(raw));
                keys.add(extractImageUrl(raw));
                keys.add(outputIdentity(raw));
            }

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

                        // 横版/竖版图通常被放在黑底结果槽位里，优先用这个槽位作为生成结果的可见范围。
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

            const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
            const collected = new Map();
            let targetRowTop = Number.isFinite(scanOptions.targetRowTop) ? scanOptions.targetRowTop : null;
            const rowTolerance = 150;

            const isInTargetRow = (top) => {
                if (!scanOptions.currentRowOnly || targetRowTop === null) {
                    return true;
                }
                return Math.abs(Number(top) - Number(targetRowTop)) <= rowTolerance;
            };

            const inferTargetRowTop = () => {
                if (!scanOptions.currentRowOnly || targetRowTop !== null || collected.size === 0) {
                    return;
                }

                targetRowTop = Array.from(collected.values())
                    .map(item => Number(item.top))
                    .filter(value => Number.isFinite(value))
                    .sort((a, b) => a - b)[0] ?? null;
            };

            const getFinalValues = () => Array.from(collected.values())
                .filter(item => isInTargetRow(item.top))
                .sort((a, b) => {
                    const topDiff = a.top - b.top;
                    if (Math.abs(topDiff) > 8) return topDiff;
                    const leftDiff = a.left - b.left;
                    if (Math.abs(leftDiff) > 8) return leftDiff;
                    if (a.naturalArea !== b.naturalArea) return b.naturalArea - a.naturalArea;
                    if (a.area !== b.area) return b.area - a.area;
                    return a.index - b.index;
                })
                .slice(0, safeLimit)
                .map(item => ({
                    index: item.index,
                    src: item.src,
                    outputSrc: item.outputSrc,
                    width: item.naturalWidth,
                    height: item.naturalHeight,
                    displayWidth: item.width,
                    displayHeight: item.height,
                    left: item.left,
                    top: item.top,
                    imageLeft: item.imageLeft,
                    imageTop: item.imageTop,
                    imageDisplayWidth: item.imageWidth,
                    imageDisplayHeight: item.imageHeight,
                    identity: item.identity
                }));

            const collectVisibleOutputs = () => {
                Array.from(document.querySelectorAll('img'))
                    .map((img, index) => {
                    const rect = img.getBoundingClientRect();
                    const slotBox = resolveOutputSlotBox(img);
                    const sourceInfo = pickOutputSource(img);
                    const style = window.getComputedStyle(img);
                    return {
                        index,
                        src: sourceInfo.src,
                        normalizedSrc: sourceInfo.normalizedSrc,
                        outputSrc: sourceInfo.outputSrc,
                        identity: sourceInfo.identity,
                        left: slotBox.left,
                        top: slotBox.top,
                        width: slotBox.width,
                        height: slotBox.height,
                        imageLeft: rect.left,
                        imageTop: rect.top,
                        imageWidth: rect.width,
                        imageHeight: rect.height,
                        naturalWidth: img.naturalWidth || 0,
                        naturalHeight: img.naturalHeight || 0,
                        area: Math.max(slotBox.width * slotBox.height, rect.width * rect.height),
                        naturalArea: (img.naturalWidth || 0) * (img.naturalHeight || 0),
                        visible: !!sourceInfo.src &&
                            rect.width > 0 &&
                            rect.height > 0 &&
                            style.visibility !== 'hidden' &&
                            style.display !== 'none' &&
                            style.opacity !== '0'
                    };
                })
                .filter(item =>
                    item.visible &&
                    item.src &&
                    !keys.has(item.src) &&
                    !keys.has(item.normalizedSrc) &&
                    !keys.has(item.outputSrc) &&
                    !keys.has(item.identity) &&
                    item.outputSrc.includes('/output') &&
                    !item.outputSrc.includes('/input') &&
                    item.left > 260 &&
                    isInTargetRow(item.top) &&
                    item.width >= 90 &&
                    item.height >= 70 &&
                    item.imageWidth > 8 &&
                    item.imageHeight > 8 &&
                    (item.area > 6000 || item.naturalArea > 6000)
                )
                    .forEach(item => {
                        const key = item.identity || item.outputSrc || item.normalizedSrc || item.src;
                        const previous = collected.get(key);
                        if (!previous || item.area > previous.area || item.naturalArea > previous.naturalArea) {
                            collected.set(key, item);
                        }
                    });
            };

            collectVisibleOutputs();
            inferTargetRowTop();

            if (!scanOptions.scanScroll) {
                return getFinalValues();
            }

            const scrollContainers = Array.from(document.querySelectorAll('*'))
                .filter(el => {
                    const rect = el.getBoundingClientRect();
                    const style = window.getComputedStyle(el);
                    return el.scrollWidth > el.clientWidth + 40 &&
                        rect.left > 280 &&
                        rect.top > 60 &&
                        rect.width > 160 &&
                        rect.height > 100 &&
                        (!scanOptions.currentRowOnly || (
                            targetRowTop !== null &&
                            rect.height <= 420 &&
                            targetRowTop >= rect.top - rowTolerance &&
                            targetRowTop <= rect.bottom + rowTolerance
                        )) &&
                        style.display !== 'none' &&
                        style.visibility !== 'hidden';
                })
                .sort((a, b) => {
                    const rectA = a.getBoundingClientRect();
                    const rectB = b.getBoundingClientRect();
                    const areaA = rectA.width * rectA.height;
                    const areaB = rectB.width * rectB.height;
                    return areaB - areaA;
                })
                .slice(0, 8);

            const originalScrolls = scrollContainers.map(el => ({
                el,
                left: el.scrollLeft,
                top: el.scrollTop
            }));

            for (const el of scrollContainers) {
                const maxLeft = Math.max(0, el.scrollWidth - el.clientWidth);
                if (maxLeft <= 0) continue;

                const step = Math.max(120, Math.floor(el.clientWidth * 0.8));
                const positions = new Set([0, maxLeft]);
                for (let pos = step; pos < maxLeft; pos += step) {
                    positions.add(Math.min(maxLeft, pos));
                }

                for (const pos of positions) {
                    el.scrollLeft = pos;
                    el.dispatchEvent(new Event('scroll', { bubbles: true }));
                    await sleep(120);
                    collectVisibleOutputs();
                    inferTargetRowTop();
                    if (collected.size >= safeLimit) break;
                }

                if (collected.size >= safeLimit) break;
            }

            originalScrolls.forEach(item => {
                item.el.scrollLeft = item.left;
                item.el.scrollTop = item.top;
            });

            return getFinalValues();
        }, { knownKeys: beforeImageKeys, safeLimit, scanOptions: safeScanOptions }).catch(() => []);
    },

    async getFailedOutputSlotInfos(page, outputInfos = [], limit = 4, scanOptions = {}) {
        const safeLimit = Math.max(1, Math.min(4, Number(limit) || 1));
        const outputRows = (Array.isArray(outputInfos) ? outputInfos : [])
            .map(item => Number(item.top))
            .filter(value => Number.isFinite(value));
        const safeScanOptions = {
            scanScroll: scanOptions.scanScroll !== false,
            currentRowOnly: scanOptions.currentRowOnly === true,
            targetRowTop: Number.isFinite(Number(scanOptions.targetRowTop)) ? Number(scanOptions.targetRowTop) : null
        };

        return page.evaluate(async ({ outputRows, safeLimit, scanOptions }) => {
            const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
            const failedPattern = /(图片已被.*咬坏|图片.*咬坏|生成失败|图片生成失败|加载失败|图片加载失败|图片损坏|图片异常|出图失败|任务失败|内容违规|审核未通过|无法生成|生成异常|出错了|失败)/;
            const collected = new Map();
            const rowTolerance = 150;
            const targetRowTop = Number.isFinite(scanOptions.targetRowTop) ? scanOptions.targetRowTop : null;

            const isVisible = (el) => {
                const rect = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return rect.width > 0 &&
                    rect.height > 0 &&
                    style.visibility !== 'hidden' &&
                    style.display !== 'none' &&
                    style.opacity !== '0';
            };

            const resolveSlotBox = (el) => {
                let current = el;
                for (let i = 0; i < 8 && current; i++) {
                    const rect = current.getBoundingClientRect();
                    if (rect.left > 300 && rect.width >= 120 && rect.height >= 100) {
                        return {
                            el: current,
                            rect
                        };
                    }
                    current = current.parentElement;
                }

                const rect = el.getBoundingClientRect();
                return {
                    el,
                    rect
                };
            };

            const belongsToCurrentOutputRow = (top) => {
                if (scanOptions.currentRowOnly && targetRowTop !== null) {
                    return Math.abs(Number(targetRowTop) - Number(top)) <= rowTolerance;
                }
                if (!outputRows.length) {
                    return false;
                }
                return outputRows.some(rowTop => Math.abs(Number(rowTop) - Number(top)) <= 140);
            };

            const collectVisibleFailures = () => {
                for (const el of document.querySelectorAll('div, span, p')) {
                    if (!isVisible(el)) continue;

                    const text = String(el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
                    if (!text || !failedPattern.test(text)) continue;

                    const { rect } = resolveSlotBox(el);
                    if (rect.left <= 300 || rect.width < 80 || rect.height < 60) continue;
                    if (!belongsToCurrentOutputRow(rect.top)) continue;

                    const key = `${Math.round(rect.top / 20)}:${Math.round(rect.left / 20)}:${text.slice(0, 24)}`;
                    if (!collected.has(key)) {
                        collected.set(key, {
                            text,
                            left: rect.left,
                            top: rect.top,
                            width: rect.width,
                            height: rect.height
                        });
                    }
                }
            };

            collectVisibleFailures();

            const getFinalValues = () => Array.from(collected.values())
                .sort((a, b) => {
                    const topDiff = a.top - b.top;
                    if (Math.abs(topDiff) > 8) return topDiff;
                    return a.left - b.left;
                })
                .slice(0, safeLimit);

            if (!scanOptions.scanScroll) {
                return getFinalValues();
            }

            const scrollContainers = Array.from(document.querySelectorAll('*'))
                .filter(el => {
                    const rect = el.getBoundingClientRect();
                    const style = window.getComputedStyle(el);
                    return el.scrollWidth > el.clientWidth + 40 &&
                        rect.left > 280 &&
                        rect.top > 60 &&
                        rect.width > 160 &&
                        rect.height > 100 &&
                        (!scanOptions.currentRowOnly || (
                            targetRowTop !== null &&
                            rect.height <= 420 &&
                            targetRowTop >= rect.top - rowTolerance &&
                            targetRowTop <= rect.bottom + rowTolerance
                        )) &&
                        style.display !== 'none' &&
                        style.visibility !== 'hidden';
                })
                .sort((a, b) => {
                    const rectA = a.getBoundingClientRect();
                    const rectB = b.getBoundingClientRect();
                    const areaA = rectA.width * rectA.height;
                    const areaB = rectB.width * rectB.height;
                    return areaB - areaA;
                })
                .slice(0, 8);

            const originalScrolls = scrollContainers.map(el => ({
                el,
                left: el.scrollLeft,
                top: el.scrollTop
            }));

            for (const el of scrollContainers) {
                const maxLeft = Math.max(0, el.scrollWidth - el.clientWidth);
                if (maxLeft <= 0) continue;

                const step = Math.max(120, Math.floor(el.clientWidth * 0.8));
                const positions = new Set([0, maxLeft]);
                for (let pos = step; pos < maxLeft; pos += step) {
                    positions.add(Math.min(maxLeft, pos));
                }

                for (const pos of positions) {
                    el.scrollLeft = pos;
                    el.dispatchEvent(new Event('scroll', { bubbles: true }));
                    await sleep(120);
                    collectVisibleFailures();
                    if (collected.size >= safeLimit) break;
                }

                if (collected.size >= safeLimit) break;
            }

            originalScrolls.forEach(item => {
                item.el.scrollLeft = item.left;
                item.el.scrollTop = item.top;
            });

            return getFinalValues();
        }, {
            outputRows,
            safeLimit,
            scanOptions: safeScanOptions
        }).catch(() => []);
    },

    async getOutputImageElement(page, imageInfo, beforeImageKeys = []) {
        const handle = await page.evaluateHandle(async ({ info, knownKeys }) => {
            const normalizeSrc = (src) => {
                let value = String(src || '').split('#')[0];
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
            const outputIdentity = (src) => {
                const outputSrc = extractImageUrl(src);
                const match = outputSrc.match(/\/output\/[^?#\s)]+/);
                return match ? match[0] : outputSrc;
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
                            outputSrc,
                            identity: outputIdentity(source)
                        };
                    }
                }

                const fallback = sources[0] || '';
                return {
                    src: fallback,
                    normalizedSrc: fallback ? normalizeSrc(fallback) : '',
                    outputSrc: fallback ? extractImageUrl(fallback) : '',
                    identity: fallback ? outputIdentity(fallback) : ''
                };
            };
            const keys = new Set();
            for (const src of knownKeys || []) {
                const raw = String(src || '').split('#')[0];
                if (!raw) continue;
                keys.add(raw);
                keys.add(normalizeSrc(raw));
                keys.add(extractImageUrl(raw));
                keys.add(outputIdentity(raw));
            }

            const targetCandidates = [
                info?.outputSrc,
                info?.src,
                info?.identity
            ].filter(Boolean);
            const targetSet = new Set();
            for (const src of targetCandidates) {
                targetSet.add(String(src).split('#')[0]);
                targetSet.add(normalizeSrc(src));
                targetSet.add(extractImageUrl(src));
                targetSet.add(outputIdentity(src));
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

            const targetRowTop = Number.isFinite(Number(info?.top)) ? Number(info.top) : null;
            const rowTolerance = 150;
            const isInTargetRow = (top) => {
                if (targetRowTop === null) {
                    return true;
                }
                return Math.abs(Number(top) - Number(targetRowTop)) <= rowTolerance;
            };

            const sortCandidates = (candidates) => candidates.sort((a, b) => {
                    const topDiff = a.top - b.top;
                    if (Math.abs(topDiff) > 8) return topDiff;
                    const leftDiff = a.left - b.left;
                    if (Math.abs(leftDiff) > 8) return leftDiff;
                    if (a.naturalArea !== b.naturalArea) return b.naturalArea - a.naturalArea;
                    if (a.area !== b.area) return b.area - a.area;
                    return a.index - b.index;
                });

            const collectCandidates = () => sortCandidates(Array.from(document.querySelectorAll('img'))
                .map((img, index) => {
                    const rect = img.getBoundingClientRect();
                    const slotBox = resolveOutputSlotBox(img);
                    const sourceInfo = pickOutputSource(img);
                    return {
                        img,
                        index,
                        src: sourceInfo.src,
                        normalizedSrc: sourceInfo.normalizedSrc,
                        outputSrc: sourceInfo.outputSrc,
                        identity: sourceInfo.identity,
                        left: slotBox.left,
                        top: slotBox.top,
                        width: slotBox.width,
                        height: slotBox.height,
                        imageLeft: rect.left,
                        imageTop: rect.top,
                        imageWidth: rect.width,
                        imageHeight: rect.height,
                        area: Math.max(slotBox.width * slotBox.height, rect.width * rect.height),
                        naturalArea: (img.naturalWidth || 0) * (img.naturalHeight || 0),
                        visible: isVisible(img)
                    };
                })
                .filter(item =>
                    item.visible &&
                    item.src &&
                    item.left > 260 &&
                    isInTargetRow(item.top) &&
                    item.width >= 90 &&
                    item.height >= 70 &&
                    item.imageWidth > 8 &&
                    item.imageHeight > 8 &&
                    (item.area > 6000 || item.naturalArea > 6000) &&
                    item.outputSrc.includes('/output') &&
                    !item.outputSrc.includes('/input') &&
                    !keys.has(item.src) &&
                    !keys.has(item.normalizedSrc) &&
                    !keys.has(item.outputSrc) &&
                    !keys.has(item.identity) &&
                    (
                        targetSet.has(item.src) ||
                        targetSet.has(item.normalizedSrc) ||
                        targetSet.has(item.outputSrc) ||
                        targetSet.has(item.identity)
                    )
                ));

            let candidates = collectCandidates();
            if (candidates[0]) {
                return candidates[0].img;
            }

            const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
            const scrollContainers = Array.from(document.querySelectorAll('*'))
                .filter(el => {
                    const rect = el.getBoundingClientRect();
                    const style = window.getComputedStyle(el);
                    return el.scrollWidth > el.clientWidth + 40 &&
                        rect.left > 280 &&
                        rect.top > 60 &&
                        rect.width > 160 &&
                        rect.height > 100 &&
                        (
                            targetRowTop === null ||
                            (
                                rect.height <= 420 &&
                                targetRowTop >= rect.top - rowTolerance &&
                                targetRowTop <= rect.bottom + rowTolerance
                            )
                        ) &&
                        style.display !== 'none' &&
                        style.visibility !== 'hidden';
                })
                .sort((a, b) => {
                    const rectA = a.getBoundingClientRect();
                    const rectB = b.getBoundingClientRect();
                    const areaA = rectA.width * rectA.height;
                    const areaB = rectB.width * rectB.height;
                    return areaB - areaA;
                })
                .slice(0, 8);

            const originalScrolls = scrollContainers.map(el => ({
                el,
                left: el.scrollLeft,
                top: el.scrollTop
            }));

            for (const el of scrollContainers) {
                const maxLeft = Math.max(0, el.scrollWidth - el.clientWidth);
                if (maxLeft <= 0) continue;

                const step = Math.max(120, Math.floor(el.clientWidth * 0.8));
                const positions = new Set([0, maxLeft]);
                for (let pos = step; pos < maxLeft; pos += step) {
                    positions.add(Math.min(maxLeft, pos));
                }

                for (const pos of positions) {
                    el.scrollLeft = pos;
                    el.dispatchEvent(new Event('scroll', { bubbles: true }));
                    await sleep(150);
                    candidates = collectCandidates();
                    if (candidates[0]) {
                        return candidates[0].img;
                    }
                }
            }

            originalScrolls.forEach(item => {
                item.el.scrollLeft = item.left;
                item.el.scrollTop = item.top;
            });

            return null;
        }, {
            info: imageInfo || {},
            knownKeys: beforeImageKeys
        }).catch(() => null);

        return handle ? handle.asElement() : null;
    }
    };
};
