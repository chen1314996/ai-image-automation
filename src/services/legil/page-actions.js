/**
 * Legil page actions.
 *
 * Methods are copied from the original LegilAutomation class and grouped by
 * responsibility so the automation flow is easier to inspect.
 */
module.exports = function createPageActionsMethods(deps) {
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
    async captureErrorScreenshot(page, error, options = {}) {
        if (options.captureErrorScreenshot === false || !page || page.isClosed()) {
            return '';
        }

        try {
            fs.mkdirSync(LEGIL_ERROR_SCREENSHOT_DIR, { recursive: true });
            const timestamp = formatDateTimeForFile();
            const promptPart = padNumber(Number(options.promptIndexWithinImage || options.promptIndex || 0) || 0, 2);
            const runPart = sanitizeFileNamePart(options.runId || 'legil_error', 40);
            const fileName = `${runPart}_prompt${promptPart}_${timestamp}.png`;
            const screenshotPath = path.join(LEGIL_ERROR_SCREENSHOT_DIR, fileName);
            await page.screenshot({
                path: screenshotPath,
                fullPage: true,
                timeout: 10000
            });
            logger.warn(`已保存 Legil 异常截图: ${screenshotPath}`);
            this.emit('legil-exception', {
                screenshotPath,
                message: error && error.message ? error.message : String(error || '未知错误'),
                promptIndex: options.promptIndexWithinImage || options.promptIndex,
                runId: options.runId || '',
                referenceImageName: options.referenceImageName || '',
                taskType: options.taskType || '',
                stage: options.stage || ''
            });
            return screenshotPath;
        } catch (screenshotError) {
            logger.warn(`保存 Legil 异常截图失败: ${screenshotError.message}`);
            return '';
        }
    },

    async refreshLegilPageOnce(page, options = {}) {
        if (!page || page.isClosed()) {
            return false;
        }

        try {
            logger.warn('Legil 可能卡住，正在自动刷新页面并重试一次...');
            await page.reload({
                waitUntil: 'domcontentloaded',
                timeout: 30000
            });
            await interruptibleSleep(8000, options);
            await this.ensureLegilImageToImagePage(page, options);
            return true;
        } catch (error) {
            logger.warn(`Legil 自动刷新失败: ${error.message}`);
            return false;
        }
    },

    async countLegilReferenceImages(page) {
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
            const findReferenceRoot = () => {
                const labelPattern = /参考图片|参考图|Reference/i;
                const labels = Array.from(document.querySelectorAll('div, span, p, label'))
                    .filter(isVisible)
                    .filter(el => labelPattern.test(normalizeText(el.innerText || el.textContent || '')))
                    .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);

                for (const label of labels) {
                    let current = label;
                    for (let depth = 0; depth < 9 && current; depth += 1) {
                        const rect = current.getBoundingClientRect();
                        const text = normalizeText(current.innerText || current.textContent || '');
                        if (
                            rect.left >= 150 &&
                            rect.left <= 720 &&
                            rect.width >= 220 &&
                            rect.width <= 520 &&
                            rect.height >= 240 &&
                            (current.querySelector('input[type="file"]') || /点击|拖拽|粘贴|上传|Ctrl\+V|upload|paste/i.test(text))
                        ) {
                            return current;
                        }
                        current = current.parentElement;
                    }
                }

                const uploadRoots = Array.from(document.querySelectorAll('aside, section, main, div'))
                    .filter(isVisible)
                    .filter(el => {
                        const rect = el.getBoundingClientRect();
                        const text = normalizeText(el.innerText || el.textContent || '');
                        return rect.left >= 150 &&
                            rect.left <= 720 &&
                            rect.width >= 220 &&
                            rect.width <= 520 &&
                            rect.height >= 260 &&
                            (el.querySelector('input[type="file"]') || /点击|拖拽|粘贴|上传|Ctrl\+V|upload|paste/i.test(text));
                    })
                    .sort((a, b) => {
                        const ar = a.getBoundingClientRect();
                        const br = b.getBoundingClientRect();
                        if (Math.abs(a.scrollHeight - b.scrollHeight) > 8) return b.scrollHeight - a.scrollHeight;
                        return ar.left - br.left;
                    });
                return uploadRoots[0] || document.body;
            };

            const root = findReferenceRoot();
            return Array.from(root.querySelectorAll('img'))
                .filter(isVisible)
                .filter(img => {
                    const rect = img.getBoundingClientRect();
                    return rect.width >= 48 &&
                        rect.height >= 48 &&
                        rect.left >= 150 &&
                        rect.left <= 760;
                }).length;
        }).catch(() => 0);
    },

    async waitForLegilReferenceImageCount(page, expectedCount, options = {}) {
        const target = Math.max(0, Number(expectedCount) || 0);
        const timeoutMs = Number(options.referenceUploadTimeoutMs) || 45000;
        const startedAt = Date.now();
        let lastCount = await this.countLegilReferenceImages(page);

        while (Date.now() - startedAt < timeoutMs) {
            throwIfAborted(options);
            lastCount = await this.countLegilReferenceImages(page);
            if (lastCount >= target) {
                return {
                    success: true,
                    count: lastCount
                };
            }
            await interruptibleSleep(800, options);
        }

        return {
            success: false,
            count: lastCount
        };
    },

    async findLegilNextReferenceUploadTarget(page) {
        if (!page || page.isClosed()) {
            return null;
        }

        const handle = await page.evaluateHandle(() => {
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
            const uploadSlotFor = (el, uploadPattern) => {
                let current = el;
                for (let depth = 0; depth < 7 && current; depth += 1) {
                    const rect = current.getBoundingClientRect();
                    const text = normalizeText(current.innerText || current.textContent || current.getAttribute?.('aria-label') || current.getAttribute?.('title') || '');
                    const hasVisibleImage = Array.from(current.querySelectorAll?.('img') || [])
                        .some(img => {
                            if (!isVisible(img)) return false;
                            const imageRect = img.getBoundingClientRect();
                            return imageRect.width >= 40 && imageRect.height >= 40;
                        });
                    if (
                        !hasVisibleImage &&
                        uploadPattern.test(text) &&
                        rect.width >= 120 &&
                        rect.height >= 90 &&
                        rect.width <= 360 &&
                        rect.height <= 260
                    ) {
                        return current.closest('label, button, [role="button"], [class*="upload"], [class*="Upload"]') || current;
                    }
                    current = current.parentElement;
                }
                return null;
            };
            const findReferenceRoot = () => {
                const labelPattern = /参考图片|参考图|Reference/i;
                const labels = Array.from(document.querySelectorAll('div, span, p, label'))
                    .filter(isVisible)
                    .filter(el => labelPattern.test(normalizeText(el.innerText || el.textContent || '')))
                    .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);

                for (const label of labels) {
                    let current = label;
                    for (let depth = 0; depth < 9 && current; depth += 1) {
                        const rect = current.getBoundingClientRect();
                        const text = normalizeText(current.innerText || current.textContent || '');
                        if (
                            rect.left >= 150 &&
                            rect.left <= 720 &&
                            rect.width >= 220 &&
                            rect.width <= 520 &&
                            rect.height >= 240 &&
                            (current.querySelector('input[type="file"]') || /点击|拖拽|粘贴|上传|Ctrl\+V|upload|paste/i.test(text))
                        ) {
                            return current;
                        }
                        current = current.parentElement;
                    }
                }

                const roots = Array.from(document.querySelectorAll('aside, section, main, div'))
                    .filter(isVisible)
                    .filter(el => {
                        const rect = el.getBoundingClientRect();
                        const text = normalizeText(el.innerText || el.textContent || '');
                        return rect.left >= 150 &&
                            rect.left <= 720 &&
                            rect.width >= 220 &&
                            rect.width <= 520 &&
                            rect.height >= 260 &&
                            (el.querySelector('input[type="file"]') || /点击|拖拽|粘贴|上传|Ctrl\+V|upload|paste/i.test(text));
                    })
                    .sort((a, b) => {
                        const ar = a.getBoundingClientRect();
                        const br = b.getBoundingClientRect();
                        if (Math.abs(a.scrollHeight - b.scrollHeight) > 8) return b.scrollHeight - a.scrollHeight;
                        return ar.left - br.left;
                    });
                return roots[0] || document.body;
            };

            const root = findReferenceRoot();
            if (root && root.scrollHeight > root.clientHeight) {
                root.scrollTop = root.scrollHeight;
            }

            const uploadPattern = /点击|拖拽|粘贴|上传|Ctrl\+V|upload|paste/i;
            const interactiveUploadPattern = /\u70b9\u51fb|\u62d6\u62fd|\u7c98\u8d34|Ctrl\+V|click|drag|upload|paste/i;
            const candidates = Array.from(root.querySelectorAll('label, button, [role="button"], div, input[type="file"]'))
                .map(el => {
                    const rect = el.getBoundingClientRect();
                    const text = normalizeText(el.innerText || el.textContent || el.getAttribute('aria-label') || el.getAttribute('title') || '');
                    const isFileInput = el.matches('input[type="file"]');
                    const hasVisibleImage = Array.from(el.querySelectorAll?.('img') || [])
                        .some(img => {
                            if (!isVisible(img)) return false;
                            const imageRect = img.getBoundingClientRect();
                            return imageRect.width >= 40 && imageRect.height >= 40;
                        });
                    const uploadLike = isFileInput || (!hasVisibleImage && interactiveUploadPattern.test(text));
                    const visible = isFileInput ? true : isVisible(el);
                    if (!visible || !uploadLike) return null;
                    if (!isFileInput && (rect.width < 70 || rect.height < 45)) return null;
                    const slot = isFileInput ? el : uploadSlotFor(el, uploadPattern);
                    if (!slot) return null;
                    const slotRect = slot.getBoundingClientRect();
                    return {
                        el: slot,
                        top: rect.top,
                        bottom: slotRect.bottom,
                        left: slotRect.left,
                        area: Math.max(1, slotRect.width * slotRect.height),
                        isFileInput
                    };
                })
                .filter(Boolean)
                .filter(item => item.left >= 150 && item.left <= 760)
                .sort((a, b) => {
                    if (Math.abs(b.bottom - a.bottom) > 4) return b.bottom - a.bottom;
                    if (a.isFileInput !== b.isFileInput) return a.isFileInput ? 1 : -1;
                    return b.area - a.area;
                });

            return candidates[0]?.el || null;
        }).catch(() => null);

        return handle ? handle.asElement() : null;
    },

    async uploadSingleReferenceImageToNextSlot(page, filePath, label, expectedCount, options = {}) {
        throwIfAborted(options);
        const target = await this.findLegilNextReferenceUploadTarget(page);
        if (!target) {
            logger.warn(`未找到 ${label} 的新增上传位置`);
            return false;
        }
        const targetInfo = await target.evaluate(el => {
            const rect = el.getBoundingClientRect();
            return {
                text: String(el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60),
                width: Math.round(rect.width),
                height: Math.round(rect.height),
                top: Math.round(rect.top),
                left: Math.round(rect.left)
            };
        }).catch(() => null);
        if (targetInfo) {
            logger.info(`${label} 上传槽定位：${targetInfo.width}x${targetInfo.height} @ ${targetInfo.left},${targetInfo.top} ${targetInfo.text ? `「${targetInfo.text}」` : ''}`);
        }

        const targetIsInput = await target.evaluate(el => el.matches?.('input[type="file"]') === true).catch(() => false);
        let scopedInput = targetIsInput ? target : null;

        if (scopedInput) {
            await scopedInput.setInputFiles(filePath);
        } else {
            const chooserPromise = page.waitForEvent('filechooser', {
                timeout: Number(options.referenceFileChooserTimeoutMs) || 5000
            }).catch(() => null);

            const clicked = await this.clickLegilElementWithFallback(page, target, `${label} upload slot`, options);
            if (!clicked) {
                return false;
            }

            const chooser = await chooserPromise;
            if (chooser) {
                await chooser.setFiles(filePath);
                logger.info(`${label} 已通过空槽文件选择器上传`);
            } else {
                logger.warn(`${label} 点击空槽后未触发文件选择器，已取消上传以避免覆盖已有参考图`);
                return false;
            }
        }

        logger.info(`已上传${label}: ${path.basename(filePath)}`);
        const waited = await this.waitForLegilReferenceImageCount(page, expectedCount, options);
        if (!waited.success) {
            logger.warn(`${label} 上传后缩略图数量未达到预期：${waited.count}/${expectedCount}`);
            return false;
        }
        logger.info(`${label} 上传成功，当前参考图数量 ${waited.count}/${expectedCount}`);
        await interruptibleSleep(1000, options);
        return true;
    },

    async uploadRetouchReferenceImages(page, inputImagePath, styleImagePaths = [], options = {}) {
        try {
            throwIfAborted(options);

            const inputPath = String(inputImagePath || '').trim();
            const stylePaths = (Array.isArray(styleImagePaths) ? styleImagePaths : [])
                .map(filePath => String(filePath || '').trim())
                .filter(Boolean);
            const paths = [inputPath, ...stylePaths]
                .filter(filePath => IMAGE_EXTENSIONS.includes(path.extname(filePath).toLowerCase()))
                .filter(filePath => {
                    try {
                        return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
                    } catch (error) {
                        return false;
                    }
                });

            if (!inputPath || paths[0] !== inputPath || paths.length === 0) {
                logger.warn('批量修图缺少可上传的图一输入图');
                return false;
            }

            const expectedTotal = paths.length;
            logger.info(`准备按 Legil 槽位逐张上传批量修图参考图：图一 1 张，风格参考图 ${Math.max(0, expectedTotal - 1)} 张`);
            paths.forEach((filePath, index) => {
                logger.info(`${index === 0 ? '图一' : `风格参考图 ${index}`}：${path.basename(filePath)}`);
            });

            await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
            await interruptibleSleep(1500, options);

            const baseCount = await this.countLegilReferenceImages(page);
            if (baseCount > 0) {
                logger.warn(`上传前检测到 Legil 参考图片区已有 ${baseCount} 张图，继续按新增槽位上传并校验总数`);
            }

            for (let i = 0; i < paths.length; i++) {
                const label = i === 0 ? '图一' : `风格参考图 ${i}/${paths.length - 1}`;
                const expectedCount = baseCount + i + 1;
                const uploaded = await this.uploadSingleReferenceImageToNextSlot(page, paths[i], label, expectedCount, options);
                if (!uploaded) {
                    return false;
                }
            }

            const finalCount = await this.countLegilReferenceImages(page);
            if (finalCount < baseCount + expectedTotal) {
                logger.warn(`批量修图参考图上传校验失败：${finalCount}/${baseCount + expectedTotal}`);
                return false;
            }

            logger.info(`批量修图参考图上传校验通过：${finalCount}/${baseCount + expectedTotal}`);
            return true;
        } catch (error) {
            logger.error(`批量修图逐张上传参考图失败: ${error.message}`);
            return false;
        }
    },

    async uploadReferenceImages(page, imagePaths = [], options = {}) {
        try {
            throwIfAborted(options);

            const paths = (Array.isArray(imagePaths) ? imagePaths : [])
                .map(filePath => String(filePath || '').trim())
                .filter(Boolean)
                .filter(filePath => IMAGE_EXTENSIONS.includes(path.extname(filePath).toLowerCase()))
                .filter(filePath => {
                    try {
                        return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
                    } catch (error) {
                        return false;
                    }
                });

            if (paths.length === 0) {
                logger.warn('没有可上传的多图参考图');
                return false;
            }

            if (options.uploadMode === 'retouch-sequential-slots') {
                return this.uploadRetouchReferenceImages(page, paths[0], paths.slice(1), options);
            }

            logger.info(`准备按顺序上传 ${paths.length} 张参考图`);
            paths.forEach((filePath, index) => {
                logger.info(`${index === 0 ? '图一' : `风格参考图 ${index}`}：${path.basename(filePath)}`);
            });

            await page.waitForLoadState('networkidle');
            await interruptibleSleep(2000, options);

            const findFileInput = async () => {
                const selectors = [
                    'input[type="file"]',
                    'input[type="file"][accept*="image"]',
                    '[class*="upload"] input[type="file"]',
                    '[class*="reference"] input[type="file"]',
                    'input[type="file"][name*="image"]',
                    'input[type="file"][name*="file"]'
                ];

                for (const selector of selectors) {
                    const input = await page.$(selector).catch(() => null);
                    if (input) {
                        return input;
                    }
                }
                return null;
            };

            let fileInput = await findFileInput();
            if (!fileInput) {
                logger.info('未找到文件输入框，尝试点击上传入口...');
                const uploadButtonSelectors = [
                    'button:has-text("上传")',
                    'button:has-text("参考图")',
                    'button:has-text("图片")',
                    '[class*="upload"]',
                    '[class*="reference"]',
                    'div[class*="upload"]',
                    'div[class*="reference"]'
                ];
                for (const selector of uploadButtonSelectors) {
                    const button = await page.$(selector).catch(() => null);
                    if (!button) continue;
                    const visible = await button.isVisible().catch(() => false);
                    if (!visible) continue;
                    await button.click();
                    await interruptibleSleep(1500, options);
                    fileInput = await findFileInput();
                    if (fileInput) break;
                }
            }

            if (!fileInput) {
                logger.warn('未找到多图上传文件输入框');
                return false;
            }

            try {
                await fileInput.setInputFiles(paths);
                logger.info(`已一次性选择 ${paths.length} 张参考图`);
                await interruptibleSleep(Math.max(3000, paths.length * 800), options);
                return true;
            } catch (multiUploadError) {
                logger.warn(`一次性多图上传失败，改为逐张上传: ${multiUploadError.message}`);
            }

            for (let i = 0; i < paths.length; i++) {
                throwIfAborted(options);
                fileInput = await findFileInput();
                if (!fileInput) {
                    logger.warn(`第 ${i + 1}/${paths.length} 张上传前未找到文件输入框`);
                    return false;
                }
                await fileInput.setInputFiles(paths[i]);
                logger.info(`已选择第 ${i + 1}/${paths.length} 张参考图: ${path.basename(paths[i])}`);
                await interruptibleSleep(2500, options);
            }

            logger.info('多图参考图上传流程完成');
            return true;
        } catch (error) {
            logger.error(`多图参考图上传失败: ${error.message}`);
            return false;
        }
    }

    /**
     * 扫描参考图文件夹中的所有图片
     */,

    async ensureLegilImageToImagePage(page, options = {}) {
        throwIfAborted(options);

        const hasControls = async () => page.evaluate(() => {
            const isVisible = (el) => {
                const rect = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return rect.width > 0 &&
                    rect.height > 0 &&
                    style.visibility !== 'hidden' &&
                    style.display !== 'none' &&
                    style.opacity !== '0';
            };

            const hasFileInput = document.querySelectorAll('input[type="file"]').length > 0;
            const hasPromptInput = Array.from(document.querySelectorAll('textarea, input[type="text"]'))
                .some(el => isVisible(el));
            const hasGenerateButton = Array.from(document.querySelectorAll('button'))
                .some(button => isVisible(button) && /创建图片|生成|重新生成/.test(button.innerText || button.textContent || ''));

            return {
                hasFileInput,
                hasPromptInput,
                hasGenerateButton,
                text: (document.body?.innerText || '').slice(0, 800)
            };
        }).catch(() => ({
            hasFileInput: false,
            hasPromptInput: false,
            hasGenerateButton: false,
            text: ''
        }));

        let controls = await hasControls();
        if (controls.hasPromptInput && controls.hasGenerateButton) {
            return true;
        }

        const currentUrl = page.url();
        if (!currentUrl.includes('/legil/image-ai/image-to-image')) {
            logger.warn('当前未停留在 Legil 图生图页面，正在重新进入图生图页面...');
            await page.goto(LEGIL_IMAGE_TO_IMAGE_URL, {
                waitUntil: 'domcontentloaded',
                timeout: 30000
            }).catch(() => {});
            await interruptibleSleep(5000, options);
            controls = await hasControls();
            if (controls.hasPromptInput && controls.hasGenerateButton) {
                return true;
            }
        }

        if (/登录|login|sign in/i.test(controls.text) && !controls.hasPromptInput) {
            throw new Error('Legil 自动化浏览器未登录或登录已过期，请在自动化浏览器中登录 Legil 后重试');
        }

        throw new Error('未进入 Legil 图生图页面，请先打开 Legil 图生图页面后重试');
    },

    async uploadReferenceImage(page, options = {}) {
        try {
            throwIfAborted(options);

            let imagePath = '';
            const directReferenceImagePath = typeof options.referenceImagePath === 'string'
                ? options.referenceImagePath.trim()
                : '';

            if (directReferenceImagePath) {
                const ext = path.extname(directReferenceImagePath).toLowerCase();
                if (!IMAGE_EXTENSIONS.includes(ext)) {
                    logger.warn(`指定参考图格式不支持，跳过: ${directReferenceImagePath}`);
                    return false;
                }

                if (!fs.existsSync(directReferenceImagePath)) {
                    logger.warn(`指定参考图文件不存在，跳过: ${directReferenceImagePath}`);
                    return false;
                }

                const stats = fs.statSync(directReferenceImagePath);
                if (!stats.isFile()) {
                    logger.warn(`指定参考图不是文件，跳过: ${directReferenceImagePath}`);
                    return false;
                }

                imagePath = directReferenceImagePath;
            } else {
                // 确保已扫描参考图
                if (this.referenceImages.length === 0) {
                    this.scanReferenceImages();
                }

                if (this.referenceImages.length === 0) {
                    logger.warn('没有可用的参考图');
                    return false;
                }

                // 获取下一张参考图
                imagePath = this.getNextReferenceImage();
                if (!imagePath) {
                    logger.warn('无法获取参考图');
                    return false;
                }

                if (!fs.existsSync(imagePath)) {
                    logger.warn(`参考图文件不存在，跳过: ${imagePath}`);
                    this.scanReferenceImages();
                    return false;
                }
            }

            logger.info(`准备上传参考图: ${path.basename(imagePath)}`);

            // 等待页面完全加载
            await page.waitForLoadState('networkidle');
            await interruptibleSleep(2000, options);

            // 尝试找到文件上传输入框
            const fileInputSelectors = [
                'input[type="file"]',
                'input[type="file"][accept*="image"]',
                '[class*="upload"] input[type="file"]',
                '[class*="reference"] input[type="file"]',
                'input[type="file"][name*="image"]',
                'input[type="file"][name*="file"]'
            ];

            let fileInput = null;

            // 尝试每个选择器
            for (const selector of fileInputSelectors) {
                try {
                    fileInput = await page.$(selector);
                    if (fileInput) {
                        const isVisible = await fileInput.isVisible().catch(() => false);
                        // 文件输入框可能是隐藏的，所以不需要检查可见性
                        logger.info(`找到文件上传输入框: ${selector}`);
                        break;
                    }
                } catch (e) {}
            }

            // 如果没找到，尝试查找所有 input[type="file"]
            if (!fileInput) {
                const allFileInputs = await page.$$('input[type="file"]');
                for (const input of allFileInputs) {
                    fileInput = input;
                    logger.info(`找到文件上传输入框（备选）`);
                    break;
                }
            }

            if (!fileInput) {
                // 尝试点击上传按钮来触发文件选择
                logger.info('尝试点击上传按钮...');
                const uploadButtonSelectors = [
                    'button:has-text("上传")',
                    'button:has-text("参考图")',
                    'button:has-text("图片")',
                    '[class*="upload"]',
                    '[class*="reference"]',
                    'button svg[xmlns]',
                    'div[class*="upload"]',
                    'div[class*="reference"]'
                ];

                for (const selector of uploadButtonSelectors) {
                    try {
                        const button = await page.$(selector);
                        if (button) {
                            const isVisible = await button.isVisible().catch(() => false);
                            if (isVisible) {
                                await button.click();
                                logger.info(`点击上传按钮: ${selector}`);
                                await interruptibleSleep(2000, options);

                                // 点击后再次查找文件输入框
                                const fileInputAfterClick = await page.$('input[type="file"]');
                                if (fileInputAfterClick) {
                                    fileInput = fileInputAfterClick;
                                    break;
                                }
                            }
                        }
                    } catch (e) {}
                }
            }

            if (!fileInput) {
                logger.warn('未找到文件上传输入框');
                return false;
            }

            // 上传文件
            await fileInput.setInputFiles(imagePath);
            logger.info(`已选择参考图文件: ${path.basename(imagePath)}`);

            // 等待上传完成
            await interruptibleSleep(3000, options);

            // 检查是否有上传按钮需要点击
            const confirmUploadSelectors = [
                'button:has-text("上传")',
                'button:has-text("确认")',
                'button:has-text("确定")',
                'button[type="submit"]'
            ];

            for (const selector of confirmUploadSelectors) {
                try {
                    const button = await page.$(selector);
                    if (button) {
                        const isVisible = await button.isVisible().catch(() => false);
                        const isEnabled = await button.isEnabled().catch(() => false);
                        if (isVisible && isEnabled) {
                            const btnText = await button.textContent().catch(() => '');
                            if (btnText.includes('上传') || btnText.includes('确认') || btnText.includes('确定')) {
                                await button.click();
                                logger.info(`点击确认上传按钮: ${selector}`);
                                await interruptibleSleep(2000, options);
                                break;
                            }
                        }
                    }
                } catch (e) {}
            }

            logger.info('参考图上传流程完成');
            return true;

        } catch (error) {
            logger.error(`上传参考图失败: ${error.message}`);
            return false;
        }
    }

    /**
     * =====================================================
     * 填入提示词
     * =====================================================
     */,

    async inputPrompt(page, prompt, options = {}) {
        try {
            throwIfAborted(options);
            const promptText = typeof prompt === 'string' ? prompt.trim() : '';
            if (!promptText) {
                throw new Error('提示词为空');
            }

            // 等待页面完全加载
            await page.waitForLoadState('networkidle');
            await interruptibleSleep(2000, options);

            // 可能的选择器列表
            const inputSelectors = [
                'textarea[placeholder*="描述"]',
                'textarea[placeholder*="提示"]',
                'textarea',
                'input[type="text"]'
            ];

            let inputElement = null;

            // 尝试每个选择器
            for (const selector of inputSelectors) {
                try {
                    inputElement = await page.waitForSelector(selector, { timeout: 2000 });
                    if (inputElement) {
                        const isVisible = await inputElement.isVisible().catch(() => false);
                        if (isVisible) {
                            logger.info(`找到输入框: ${selector}`);
                            break;
                        }
                    }
                } catch (e) {}
            }

            // 如果上面没找到，查找页面中所有 textarea
            if (!inputElement) {
                const allInputs = await page.$$('textarea, input[type="text"]');
                for (const el of allInputs) {
                    const isVisible = await el.isVisible().catch(() => false);
                    if (isVisible) {
                        inputElement = el;
                        break;
                    }
                }
            }

            if (!inputElement) {
                throw new Error('未找到输入框');
            }

            // 清空并填入提示词
            await inputElement.click();
            await inputElement.fill('');
            await inputElement.fill(promptText);
            logger.info('提示词已填入');
            return true;

        } catch (error) {
            logger.error(`填入提示词失败: ${error.message}`);
            return false;
        }
    }
    };
};
