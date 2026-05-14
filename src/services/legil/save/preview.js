/**
 * 预览图和截图兜底保存。
 *
 * 当直接下载不稳定时，打开预览图并截图保存。
 */
module.exports = function createPreviewSaveMethods(deps) {
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
    async screenshotImageElementToFile(page, imageInfo, savePath, beforeImageKeys = [], options = {}) {
        throwIfAborted(options);
        const imageElement = await this.getOutputImageElement(page, imageInfo, beforeImageKeys);

        if (!imageElement) {
            throw new Error('未找到可截图的输出图片元素');
        }

        await imageElement.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
        await interruptibleSleep(300, options);

        try {
            await imageElement.screenshot({ path: savePath, timeout: 8000 });
        } catch (error) {
            const box = await imageElement.boundingBox();
            if (!box || box.width <= 0 || box.height <= 0) {
                throw error;
            }
            await page.screenshot({
                path: savePath,
                clip: {
                    x: Math.max(0, box.x),
                    y: Math.max(0, box.y),
                    width: box.width,
                    height: box.height
                },
                timeout: 8000
            });
        }

        return this.validateSavedImageFile(savePath);
    },

    async screenshotElementToFile(page, element, savePath, options = {}) {
        throwIfAborted(options);

        if (!element) {
            throw new Error('未找到可截图的图片元素');
        }

        await element.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
        await interruptibleSleep(300, options);

        try {
            await element.screenshot({ path: savePath, timeout: 8000 });
        } catch (error) {
            const box = await element.boundingBox();
            if (!box || box.width <= 0 || box.height <= 0) {
                throw error;
            }

            await page.screenshot({
                path: savePath,
                clip: {
                    x: Math.max(0, box.x),
                    y: Math.max(0, box.y),
                    width: box.width,
                    height: box.height
                },
                timeout: 8000
            });
        }

        return this.validateSavedImageFile(savePath);
    },

    async clickImageElement(page, element, options = {}) {
        throwIfAborted(options);

        try {
            await element.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
            await element.click({ timeout: 5000 });
            return true;
        } catch (clickError) {
            logger.warn(`点击输出图失败，尝试坐标点击: ${clickError.message.split('\n')[0]}`);
        }

        const box = await element.boundingBox().catch(() => null);
        if (!box || box.width <= 0 || box.height <= 0) {
            return false;
        }

        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        return true;
    },

    async getOpenedPreviewImageElement(page, fallbackSrc) {
        const handle = await page.evaluateHandle(({ fallbackSrc }) => {
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
                return match ? match[0] : '';
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

                let current = img;
                for (let i = 0; i < 4 && current; i++) {
                    if (current.tagName === 'A' && current.getAttribute('href')) {
                        values.push(current.getAttribute('href'));
                    }
                    values.push(
                        current.getAttribute('data-download-url'),
                        current.getAttribute('data-href'),
                        current.dataset?.downloadUrl,
                        current.dataset?.href
                    );
                    current = current.parentElement;
                }

                return Array.from(new Set(values
                    .map(value => String(value || '').split('#')[0].trim())
                    .filter(Boolean)));
            };
            const isVisible = (el) => {
                const rect = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return rect.width > 0 &&
                    rect.height > 0 &&
                    style.visibility !== 'hidden' &&
                    style.display !== 'none' &&
                    style.opacity !== '0';
            };

            const fallbackIdentity = outputIdentity(fallbackSrc);
            if (!fallbackIdentity) {
                return null;
            }

            const selectors = [
                'div[role="dialog"] img',
                '.ant-modal img',
                '[class*="modal"] img',
                '[class*="preview"] img',
                '[class*="lightbox"] img',
                '[class*="fullscreen"] img',
                'img'
            ];

            const candidates = [];
            for (const selector of selectors) {
                for (const img of document.querySelectorAll(selector)) {
                    if (!isVisible(img)) continue;
                    const sources = collectImageSources(img);
                    if (!sources.some(src => outputIdentity(src) === fallbackIdentity)) continue;

                    const rect = img.getBoundingClientRect();
                    candidates.push({
                        img,
                        inPreview: /dialog|modal|preview|lightbox|fullscreen/i.test(selector),
                        left: rect.left,
                        top: rect.top,
                        area: rect.width * rect.height,
                        naturalArea: (img.naturalWidth || 0) * (img.naturalHeight || 0)
                    });
                }
            }

            candidates.sort((a, b) => {
                if (a.inPreview !== b.inPreview) return a.inPreview ? -1 : 1;
                if (a.naturalArea !== b.naturalArea) return b.naturalArea - a.naturalArea;
                if (a.area !== b.area) return b.area - a.area;
                const topDiff = a.top - b.top;
                if (Math.abs(topDiff) > 8) return topDiff;
                return a.left - b.left;
            });

            return candidates[0]?.img || null;
        }, { fallbackSrc }).catch(() => null);

        return handle ? handle.asElement() : null;
    },

    async saveOpenedPreviewToFile(page, previewElement, fallbackElement, fallbackSrc, savePath, options = {}) {
        throwIfAborted(options);

        const sourceElement = previewElement || fallbackElement;
        const sourceInfo = sourceElement
            ? await sourceElement.evaluate(el => ({
                src: el.currentSrc || el.src || '',
                width: el.naturalWidth || 0,
                height: el.naturalHeight || 0,
                displayWidth: el.getBoundingClientRect().width || 0,
                displayHeight: el.getBoundingClientRect().height || 0,
                candidates: (() => {
                    const values = [
                        el.currentSrc,
                        el.src,
                        el.getAttribute('src'),
                        el.getAttribute('data-src'),
                        el.getAttribute('data-original'),
                        el.getAttribute('data-url'),
                        el.dataset?.src,
                        el.dataset?.original,
                        el.dataset?.url
                    ];

                    const srcset = el.getAttribute('srcset') || el.getAttribute('data-srcset') || '';
                    srcset.split(',').forEach(part => {
                        const candidate = part.trim().split(/\s+/)[0];
                        if (candidate) values.push(candidate);
                    });

                    let current = el;
                    for (let i = 0; i < 5 && current; i++) {
                        if (current.tagName === 'A' && current.getAttribute('href')) {
                            values.push(current.getAttribute('href'));
                        }
                        values.push(
                            current.getAttribute('data-download-url'),
                            current.getAttribute('data-href'),
                            current.dataset?.downloadUrl,
                            current.dataset?.href
                        );
                        current = current.parentElement;
                    }

                    return Array.from(new Set(values
                        .map(value => String(value || '').split('#')[0].trim())
                        .filter(Boolean)));
                })()
            })).catch(() => null)
            : null;

        const sourceCandidates = Array.from(new Set([
            ...(Array.isArray(sourceInfo?.candidates) ? sourceInfo.candidates : []),
            sourceInfo?.src,
            fallbackSrc
        ]
            .map(value => String(value || '').trim())
            .filter(Boolean)));
        let savedSize = 0;

        const allowThumbnailCandidate = Number(sourceInfo?.width || 0) >= 700 ||
            Number(sourceInfo?.height || 0) >= 700 ||
            Number(sourceInfo?.displayWidth || 0) >= 700 ||
            Number(sourceInfo?.displayHeight || 0) >= 700;
        const downloadCandidates = [];
        const seenDownloadUrls = new Set();

        for (const candidate of sourceCandidates) {
            for (const variant of this.buildDownloadUrlVariants(candidate, page.url())) {
                if (variant.isThumbnail && !allowThumbnailCandidate) {
                    continue;
                }
                if (seenDownloadUrls.has(variant.url)) {
                    continue;
                }
                seenDownloadUrls.add(variant.url);
                downloadCandidates.push(variant);
            }
        }

        if (downloadCandidates.length === 0 && sourceCandidates.some(src => isLegilOutputUrl(src))) {
            logger.warn('只找到缩略图地址，跳过直接保存缩略图，改用后续大图截图兜底');
        }

        for (let i = 0; i < downloadCandidates.length && !savedSize; i++) {
            const candidate = downloadCandidates[i];
            logger.info(`尝试保存大图：${candidate.label}`);

            try {
                savedSize = i === 0
                    ? await this.downloadImageToFileWithRetries(page, candidate.url, savePath, options)
                    : await this.downloadImageToFile(page, candidate.url, savePath, options);
                if (savedSize) break;
            } catch (downloadError) {
                logger.warn(`${candidate.label}直链下载失败: ${downloadError.message}`);
            }

            try {
                savedSize = await this.downloadImageByBrowserNavigation(page, candidate.url, savePath, options);
                if (savedSize) {
                    logger.info('已通过浏览器真实图片响应保存大图');
                    break;
                }
            } catch (browserDownloadError) {
                logger.warn(`${candidate.label}浏览器下载失败: ${browserDownloadError.message}`);
            }

            try {
                savedSize = await this.fetchImageInPageToFile(page, candidate.url, savePath, options);
                if (savedSize) break;
            } catch (pageFetchError) {
                logger.warn(`${candidate.label}页面内下载失败: ${pageFetchError.message}`);
            }
        }

        const localCandidates = sourceCandidates.filter(isPageLocalImageUrl);
        for (const localUrl of localCandidates) {
            try {
                savedSize = await this.fetchImageInPageToFile(page, localUrl, savePath, options);
                if (savedSize) {
                    logger.info('已通过大图弹窗内存图片保存');
                    return savedSize;
                }
            } catch (localError) {
                logger.warn(`大图弹窗内存图片保存失败: ${localError.message}`);
            }
        }

        if (!savedSize) {
            logger.warn('所有大图下载方式失败，改用大图弹窗截图保存');
            savedSize = await this.screenshotElementToFile(page, sourceElement, savePath, options);
        }

        return savedSize;
    },

    async saveOutputImageByOpening(page, imageInfo, savePath, beforeImageKeys = [], options = {}) {
        let previewOpen = false;

        try {
            throwIfAborted(options);

            const thumbnailElement = await this.getOutputImageElement(page, imageInfo, beforeImageKeys);
            if (!thumbnailElement) {
                throw new Error('未找到本次输出图缩略图');
            }

            const thumbInfo = await thumbnailElement.evaluate(el => {
                const values = [
                    el.currentSrc,
                    el.src,
                    el.getAttribute('src'),
                    el.getAttribute('data-src'),
                    el.getAttribute('data-original'),
                    el.getAttribute('data-url'),
                    el.dataset?.src,
                    el.dataset?.original,
                    el.dataset?.url
                ];

                const srcset = el.getAttribute('srcset') || el.getAttribute('data-srcset') || '';
                srcset.split(',').forEach(part => {
                    const candidate = part.trim().split(/\s+/)[0];
                    if (candidate) values.push(candidate);
                });

                return {
                    src: el.src,
                    currentSrc: el.currentSrc || el.src,
                    width: el.naturalWidth || 0,
                    height: el.naturalHeight || 0,
                    candidates: Array.from(new Set(values
                        .map(value => String(value || '').split('#')[0].trim())
                        .filter(Boolean)))
                };
            });

            const thumbSrc = (thumbInfo.candidates || []).find(src => isLegilOutputUrl(src)) || thumbInfo.currentSrc || thumbInfo.src;
            if (!isLegilOutputUrl(thumbSrc)) {
                throw new Error('候选图片不是 Legil 输出图，已停止保存以避免拿到参考图或历史图');
            }

            logger.info(`打开输出图大图: ${thumbInfo.width}x${thumbInfo.height}`);
            const clicked = await this.clickImageElement(page, thumbnailElement, options);
            if (!clicked) {
                throw new Error('点击输出图失败');
            }

            previewOpen = true;
            await interruptibleSleep(3000, options);

            let previewElement = null;
            for (let attempt = 0; attempt < 4; attempt++) {
                previewElement = await this.getOpenedPreviewImageElement(page, thumbSrc);
                if (previewElement) {
                    break;
                }
                await interruptibleSleep(1000, options);
            }
            const savedSize = await this.saveOpenedPreviewToFile(page, previewElement, thumbnailElement, thumbSrc, savePath, options);

            return savedSize;
        } finally {
            if (previewOpen) {
                await this.closeOpenPreviewModal(page, options).catch(() => {});
            }
        }
    },
    };
};
