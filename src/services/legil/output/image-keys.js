/**
 * 图片身份识别工具。
 *
 * 用来记录生成前后的图片地址，判断哪些图片是本次新生成的。
 */
module.exports = function createOutputImageKeyMethods(deps) {
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
    async getImageKeys(page) {
        if (!page || page.isClosed()) {
            return [];
        }

        return page.evaluate(() => {
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

            const keys = new Set();
            for (const img of document.querySelectorAll('img')) {
                const srcList = [
                    img.currentSrc,
                    img.src,
                    img.getAttribute('src'),
                    img.getAttribute('data-src'),
                    img.getAttribute('data-original'),
                    img.getAttribute('data-url'),
                    img.dataset?.src,
                    img.dataset?.original,
                    img.dataset?.url
                ].filter(Boolean);
                const srcset = img.getAttribute('srcset') || img.getAttribute('data-srcset') || '';
                srcset.split(',').forEach(part => {
                    const candidate = part.trim().split(/\s+/)[0];
                    if (candidate) srcList.push(candidate);
                });
                for (const src of srcList) {
                    const raw = String(src).split('#')[0];
                    keys.add(raw);
                    keys.add(normalizeSrc(raw));
                    keys.add(extractImageUrl(raw));
                }
            }
            return Array.from(keys).filter(Boolean);
        }).catch(() => []);
    }

    /**
     * =====================================================
     * 上传参考图到 Legil
     * =====================================================
     */,

    mergeOutputImageInfos(...groups) {
        const merged = new Map();

        for (const group of groups) {
            for (const item of Array.isArray(group) ? group : []) {
                const key = item.identity || item.outputSrc || item.src;
                if (!key) continue;

                const previous = merged.get(key);
                const previousArea = Number(previous?.displayWidth || 0) * Number(previous?.displayHeight || 0);
                const currentArea = Number(item.displayWidth || 0) * Number(item.displayHeight || 0);
                if (!previous || currentArea >= previousArea) {
                    merged.set(key, item);
                }
            }
        }

        return Array.from(merged.values()).sort((a, b) => {
            const topDiff = Number(a.top || 0) - Number(b.top || 0);
            if (Math.abs(topDiff) > 8) return topDiff;
            return Number(a.left || 0) - Number(b.left || 0);
        });
    },

    resolveCurrentOutputRowTop(imageInfos = [], failedInfos = []) {
        const rows = [
            ...(Array.isArray(imageInfos) ? imageInfos : []),
            ...(Array.isArray(failedInfos) ? failedInfos : [])
        ]
            .map(item => Number(item.top))
            .filter(value => Number.isFinite(value));

        if (rows.length === 0) {
            return null;
        }

        return rows.sort((a, b) => a - b)[0];
    }

    /**
     * =====================================================
     * 等待图片生成完成
     * =====================================================
     */,
    };
};
