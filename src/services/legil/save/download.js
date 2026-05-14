/**
 * 图片下载和校验。
 *
 * 优先按图片地址下载，并在保存后检查文件是否真的写入成功。
 */
module.exports = function createImageDownloadMethods(deps) {
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
    resolveDownloadUrl(rawUrl, pageUrl) {
        const extracted = extractLegilImageUrl(rawUrl);
        const withoutResize = extracted.includes('resize')
            ? extracted.replace(/resize,w_\d+,h_\d+,?/, '')
            : extracted;
        return new URL(withoutResize, pageUrl).href;
    },

    buildDownloadUrlVariants(rawUrl, pageUrl) {
        const variants = new Map();
        const addVariant = (url, label, isThumbnail = false) => {
            if (!url || isPageLocalImageUrl(url)) return;

            try {
                const absoluteUrl = new URL(url, pageUrl).href;
                if (!isLegilOutputUrl(absoluteUrl)) return;
                if (!variants.has(absoluteUrl)) {
                    variants.set(absoluteUrl, {
                        url: absoluteUrl,
                        label,
                        isThumbnail
                    });
                }
            } catch (e) {}
        };

        const raw = String(rawUrl || '').trim();
        if (!raw) {
            return [];
        }

        const candidateUrls = [extractLegilImageUrl(raw), raw].filter(Boolean);
        try {
            const parsedRaw = new URL(raw, pageUrl);
            const embeddedUrl = parsedRaw.searchParams.get('url');
            if (embeddedUrl) {
                candidateUrls.unshift(normalizeImageUrl(embeddedUrl));
            }
        } catch (e) {}

        for (const candidate of candidateUrls) {
            let absolute = '';
            try {
                absolute = new URL(candidate, pageUrl).href;
            } catch (e) {
                continue;
            }

            let strippedUrl = absolute;
            let stripped = false;
            try {
                const parsed = new URL(absolute);
                for (const key of ['x-oss-process', 'x-image-process', 'image_process']) {
                    const value = parsed.searchParams.get(key);
                    if (value && /resize|thumbnail|quality|format/i.test(value)) {
                        parsed.searchParams.delete(key);
                        stripped = true;
                    }
                }
                strippedUrl = parsed.href;
            } catch (e) {}

            const regexStripped = strippedUrl.replace(/(?:image\/)?resize,w_\d+(?:,h_\d+)?,?/gi, '');
            if (regexStripped !== strippedUrl) {
                strippedUrl = regexStripped;
                stripped = true;
            }

            if (stripped) {
                addVariant(strippedUrl, '去除缩略参数后的原图地址', false);
            }

            const hasThumbnailMarker = /(?:image\/)?resize,w_\d+|x-oss-process=.*resize|[?&]w=\d+|\/_next\/image/i.test(absolute);
            addVariant(absolute, hasThumbnailMarker ? '页面缩略图地址' : '页面图片地址', hasThumbnailMarker);
        }

        return Array.from(variants.values()).slice(0, 5);
    },

    async downloadImageToFile(page, imageUrl, savePath, options = {}) {
        throwIfAborted(options);
        const context = page.context();
        const headers = {
            referer: page.url()
        };

        try {
            headers.origin = new URL(page.url()).origin;
        } catch (e) {}

        const userAgent = await page.evaluate(() => navigator.userAgent).catch(() => '');
        if (userAgent) {
            headers['user-agent'] = userAgent;
        }
        headers.accept = 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8';

        const response = await context.request.get(imageUrl, { headers });

        if (!response.ok()) {
            throw new Error(`下载失败: HTTP ${response.status()}`);
        }

        const buffer = await response.body();
        if (!buffer || buffer.length === 0) {
            throw new Error('下载的数据为空');
        }

        fs.writeFileSync(savePath, buffer);
        return this.validateSavedImageFile(savePath);
    },

    async downloadImageByBrowserNavigation(page, imageUrl, savePath, options = {}) {
        throwIfAborted(options);

        const imagePage = await page.context().newPage();
        try {
            const response = await imagePage.goto(imageUrl, {
                waitUntil: 'load',
                timeout: 30000,
                referer: page.url()
            });

            if (!response) {
                throw new Error('浏览器未返回图片响应');
            }

            if (!response.ok()) {
                throw new Error(`浏览器打开图片失败: HTTP ${response.status()}`);
            }

            const contentType = String(response.headers()['content-type'] || '').toLowerCase();
            if (contentType && !contentType.includes('image') && !contentType.includes('octet-stream')) {
                throw new Error(`浏览器响应不是图片: ${contentType}`);
            }

            const buffer = await response.body();
            if (!buffer || buffer.length === 0) {
                throw new Error('浏览器下载的数据为空');
            }

            fs.writeFileSync(savePath, buffer);
            return this.validateSavedImageFile(savePath);
        } finally {
            await imagePage.close().catch(() => {});
        }
    },

    async downloadImageToFileWithRetries(page, imageUrl, savePath, options = {}) {
        const maxAttempts = 3;
        const retryDelayMs = 3000;
        let lastError = null;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            throwIfAborted(options);

            try {
                if (attempt > 1) {
                    logger.info(`正在第 ${attempt}/${maxAttempts} 次重试大图直链下载...`);
                }
                return await this.downloadImageToFile(page, imageUrl, savePath, options);
            } catch (error) {
                lastError = error;

                if (attempt < maxAttempts) {
                    logger.warn(`大图直链下载第 ${attempt}/${maxAttempts} 次失败：${error.message}，等待3秒后重试`);
                    await interruptibleSleep(retryDelayMs, options);
                }
            }
        }

        throw lastError || new Error('大图直链下载失败');
    },

    validateSavedImageFile(savePath) {
        if (!fs.existsSync(savePath)) {
            throw new Error('文件未写入');
        }

        const stats = fs.statSync(savePath);
        if (stats.size <= 1000) {
            try {
                fs.unlinkSync(savePath);
            } catch (e) {}
            throw new Error('保存的文件无效');
        }

        return stats.size;
    },

    async fetchImageInPageToFile(page, imageUrl, savePath, options = {}) {
        throwIfAborted(options);

        const base64 = await page.evaluate(async (url) => {
            const response = await fetch(url, {
                credentials: 'include',
                referrer: window.location.href
            });

            if (!response.ok) {
                throw new Error(`页面内下载失败: HTTP ${response.status}`);
            }

            const blob = await response.blob();
            if (!blob || blob.size <= 0) {
                throw new Error('页面内下载的数据为空');
            }

            return await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => {
                    const result = String(reader.result || '');
                    const commaIndex = result.indexOf(',');
                    resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
                };
                reader.onerror = () => reject(new Error('读取图片数据失败'));
                reader.readAsDataURL(blob);
            });
        }, imageUrl);

        const buffer = Buffer.from(base64, 'base64');
        if (!buffer || buffer.length === 0) {
            throw new Error('页面内下载的数据为空');
        }

        fs.writeFileSync(savePath, buffer);
        return this.validateSavedImageFile(savePath);
    },
    };
};
