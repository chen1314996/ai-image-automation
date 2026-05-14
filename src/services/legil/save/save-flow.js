/**
 * 图片保存主流程。
 *
 * 这里决定保存几张图、按什么顺序保存，以及下载失败时如何兜底。
 */
module.exports = function createImageSaveFlowMethods(deps) {
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
    async saveGeneratedImages(page, promptIndex, options = {}) {
        try {
            throwIfAborted(options);

            if (!fs.existsSync(this.saveFolder)) {
                fs.mkdirSync(this.saveFolder, { recursive: true });
            }

            const expectedOutputCount = LEGIL_OUTPUT_QUANTITIES.includes(Number(options.expectedOutputCount))
                ? Number(options.expectedOutputCount)
                : 1;
            const beforeKeys = Array.isArray(options.beforeImageKeys) ? options.beforeImageKeys : [];
            const imageInfos = await this.getNewOutputImageInfos(page, beforeKeys, expectedOutputCount, {
                scanScroll: true,
                currentRowOnly: true
            });

            if (imageInfos.length === 0) {
                throw new Error('未找到本次新生成的输出图');
            }

            if (imageInfos.length < expectedOutputCount) {
                logger.warn(`只检测到 ${imageInfos.length}/${expectedOutputCount} 张新输出图，将保存已检测到的图片`);
            }

            const savePaths = [];

            for (let i = 0; i < imageInfos.length; i++) {
                throwIfAborted(options);
                await this.closeOpenPreviewModal(page, options).catch(() => {});
                const info = imageInfos[i];
                const outputUrl = info.outputSrc || info.src || '';

                if (!isLegilOutputUrl(outputUrl)) {
                    logger.warn(`跳过非输出图地址: ${outputUrl.substring(0, 80)}...`);
                    continue;
                }

                const fileName = this.buildOutputFileName(promptIndex, {
                    ...options,
                    variantIndex: i + 1
                });
                const savePath = path.join(this.saveFolder, fileName);

                logger.info(`正在打开并保存第 ${i + 1}/${imageInfos.length} 张输出图: ${outputUrl.substring(0, 80)}...`);

                try {
                    const savedSize = await this.saveOutputImageByOpening(page, info, savePath, beforeKeys, options);
                    logger.info(`✅ 图片保存成功: ${fileName} (${(savedSize / 1024).toFixed(2)} KB)`);
                    savePaths.push(savePath);
                } catch (saveError) {
                    logger.error(`第 ${i + 1}/${imageInfos.length} 张输出图保存失败: ${saveError.message}`);
                }
            }

            return savePaths;
        } catch (error) {
            logger.error(`保存图片失败: ${error.message}`);
            await page.keyboard.press('Escape').catch(() => {});
            return [];
        }
    }

    /**
     * =====================================================
     * 保存生成的图片（点击缩略图打开大图后保存）
     * =====================================================
     */,

    async saveGeneratedImage(page, promptIndex, options = {}) {
        try {
            throwIfAborted(options);

            // 确保保存目录存在
            if (!fs.existsSync(this.saveFolder)) {
                fs.mkdirSync(this.saveFolder, { recursive: true });
            }

            // 生成文件名。工作流会传入全局流水号，确保资源管理器按名称排序时就是生成顺序。
            const fileName = this.buildOutputFileName(promptIndex, options);
            const savePath = path.join(this.saveFolder, fileName);

            logger.info('正在查找缩略图...');

            const beforeKeys = Array.isArray(options.beforeImageKeys) ? options.beforeImageKeys : [];

            // 第1步：优先选择本次生成后新出现的右侧大图，避免保存历史图或参考图
            const thumbnailHandle = await page.evaluateHandle((knownKeys) => {
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
                for (const src of knownKeys || []) {
                    const raw = String(src || '').split('#')[0];
                    if (!raw) continue;
                    keys.add(raw);
                    keys.add(normalizeSrc(raw));
                    keys.add(extractImageUrl(raw));
                }

                const candidates = Array.from(document.querySelectorAll('img'))
                    .map((img, index) => {
                        const rect = img.getBoundingClientRect();
                        const src = (img.currentSrc || img.src || '').split('#')[0];
                        const normalizedSrc = normalizeSrc(src);
                        const outputSrc = extractImageUrl(src);
                        const visible = !!src &&
                            rect.width > 0 &&
                            rect.height > 0 &&
                            window.getComputedStyle(img).visibility !== 'hidden' &&
                            window.getComputedStyle(img).display !== 'none';
                        return {
                            img,
                            index,
                            src,
                            normalizedSrc,
                            outputSrc,
                            isOutput: outputSrc.includes('/output') && !outputSrc.includes('/input'),
                            isNew: src && !keys.has(src) && !keys.has(normalizedSrc) && !keys.has(outputSrc),
                            isRightSide: rect.left > 300,
                            area: rect.width * rect.height,
                            naturalArea: (img.naturalWidth || 0) * (img.naturalHeight || 0),
                            width: rect.width,
                            height: rect.height,
                            naturalWidth: img.naturalWidth || 0,
                            naturalHeight: img.naturalHeight || 0,
                            visible
                        };
                    })
                    .filter(item =>
                        item.visible &&
                        item.isNew &&
                        item.isOutput &&
                        item.isRightSide &&
                        item.width > 128 &&
                        item.height > 128 &&
                        item.naturalWidth > 128 &&
                        item.naturalHeight > 128
                    )
                    .sort((a, b) => {
                        if (a.isNew !== b.isNew) return a.isNew ? -1 : 1;
                        if (a.naturalArea !== b.naturalArea) return b.naturalArea - a.naturalArea;
                        if (a.area !== b.area) return b.area - a.area;
                        return b.index - a.index;
                    });

                return candidates[0]?.img || null;
            }, beforeKeys);

            const thumbnailElement = await thumbnailHandle.asElement();
            if (!thumbnailElement) {
                throw new Error('未找到缩略图');
            }

            // 获取缩略图信息
            const thumbInfo = await thumbnailElement.evaluate(el => ({
                src: el.src,
                currentSrc: el.currentSrc || el.src,
                width: el.naturalWidth,
                height: el.naturalHeight
            }));

            const thumbSrc = thumbInfo.currentSrc || thumbInfo.src;
            if (!isLegilOutputUrl(thumbSrc)) {
                throw new Error('候选图片不是 Legil 输出图，已停止保存以避免拿到参考图或历史图');
            }

            logger.info(`找到缩略图: ${thumbInfo.width}x${thumbInfo.height}`);
            logger.info('点击缩略图打开大图...');

            // 第2步：使用 Playwright 点击缩略图（模拟真实点击）
            await thumbnailElement.click();
            logger.info('已点击，等待大图弹窗...');

            // 等待弹窗出现
            await interruptibleSleep(3000, options);

            // 第3步：获取完整大图的地址
            logger.info('查找完整大图...');

            // 先尝试查找弹窗中的大图
            let fullImageSrc = await page.evaluate(({ fallbackSrc }) => {
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
                const fallbackIdentity = outputIdentity(fallbackSrc);

                // 方法1：查找弹窗/模态框中与当前缩略图同一张输出图的大图
                const modalSelectors = [
                    'div[role="dialog"] img',
                    '.ant-modal img',
                    '[class*="modal"] img',
                    '[class*="preview"] img',
                    '[class*="lightbox"] img',
                    '[class*="fullscreen"] img'
                ];

                for (const selector of modalSelectors) {
                    const imgs = document.querySelectorAll(selector);
                    for (const img of imgs) {
                        const src = img.currentSrc || img.src || '';
                        if (src &&
                            fallbackIdentity &&
                            outputIdentity(src) === fallbackIdentity &&
                            img.naturalWidth > 500 &&
                            img.naturalHeight > 500) {
                            return src;
                        }
                    }
                }

                // 方法2：查找页面中与当前缩略图同源的最大右侧图片（可能是展开后的）
                const allImgs = document.querySelectorAll('img');
                let bestImg = null;
                let maxArea = 0;

                for (const img of allImgs) {
                    const rect = img.getBoundingClientRect();
                    const src = img.currentSrc || img.src || '';
                    // 查找尺寸大于800的大图
                    if (src &&
                        fallbackIdentity &&
                        outputIdentity(src) === fallbackIdentity &&
                        rect.left > 300 &&
                        img.naturalWidth > 800 &&
                        img.naturalHeight > 800) {
                        const area = img.naturalWidth * img.naturalHeight;
                        if (area > maxArea) {
                            maxArea = area;
                            bestImg = img;
                        }
                    }
                }

                if (bestImg) {
                    return bestImg.currentSrc || bestImg.src;
                }

                return fallbackSrc || null;
            }, { fallbackSrc: thumbSrc });

            // 如果没找到大图，尝试从缩略图 URL 推断
            if (!fullImageSrc) {
                logger.info('未找到弹窗大图，尝试从缩略图 URL 获取原图...');
                fullImageSrc = thumbSrc;
            }

            if (!fullImageSrc) {
                throw new Error('未找到可下载的图片地址');
            }

            if (!isLegilOutputUrl(fullImageSrc)) {
                throw new Error('下载地址不是 Legil 输出图，已停止保存以避免拿到参考图或历史图');
            }

            // Legil 的 URL 格式：包含 resize 参数，移除后获取原图
            if (fullImageSrc.includes('resize')) {
                fullImageSrc = fullImageSrc.replace(/resize,w_\d+,h_\d+,?/, '');
                logger.info('已移除 resize 参数');
            }

            logger.info(`找到完整大图: ${fullImageSrc.substring(0, 80)}...`);

            // 第4步：下载图片
            logger.info('正在保存图片...');
            throwIfAborted(options);

            let savedSize = 0;
            const fullDownloadUrl = this.resolveDownloadUrl(fullImageSrc, page.url());

            try {
                savedSize = await this.downloadImageToFileWithRetries(page, fullDownloadUrl, savePath, options);
            } catch (downloadError) {
                logger.warn(`直链下载失败，尝试页面内下载: ${downloadError.message}`);
            }

            if (!savedSize) {
                try {
                    savedSize = await this.fetchImageInPageToFile(page, fullDownloadUrl, savePath, options);
                } catch (pageFetchError) {
                    logger.warn(`页面内下载失败，改用图片元素截图保存: ${pageFetchError.message}`);
                }
            }

            if (!savedSize) {
                await thumbnailElement.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
                await thumbnailElement.screenshot({ path: savePath, timeout: 8000 });
                savedSize = this.validateSavedImageFile(savePath);
            }

            // 验证文件
            if (fs.existsSync(savePath)) {
                const stats = fs.statSync(savePath);
                if (stats.size > 1000) {
                    logger.info(`✅ 图片保存成功: ${fileName} (${(stats.size/1024).toFixed(2)} KB)`);

                    // 关闭弹窗（按 Escape）
                    await page.keyboard.press('Escape');
                    await interruptibleSleep(500, options);

                    return savePath;
                }
            }

            throw new Error('保存的文件无效');

        } catch (error) {
            logger.error(`保存图片失败: ${error.message}`);
            await page.keyboard.press('Escape').catch(() => {});
            return null;
        }
    }
    };
};
