/**
 * Legil config methods.
 *
 * Methods are copied from the original LegilAutomation class and grouped by
 * responsibility so the automation flow is easier to inspect.
 */
module.exports = function createConfigMethodsMethods(deps) {
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
        LEGIL_DEFAULT_MODEL_PARAMETER_PROFILE,
        LEGIL_MODEL_PARAMETER_PROFILES,
        IMAGE_EXTENSIONS,
        LEGIL_IMAGE_TO_IMAGE_URL,
        LEGIL_ERROR_SCREENSHOT_DIR
    } = deps;

    function cleanReferenceNameForOutput(value) {
        const rawName = path.parse(String(value || '')).name.trim();
        if (!rawName) {
            return '';
        }

        const cleanedName = rawName
            .replace(/([_\-\s]+)(提示词|画面提示词|生图提示词|图片提示词|prompt|imageprompt)\s*\d*$/i, '')
            .replace(/^(提示词|画面提示词|生图提示词|图片提示词|prompt|imageprompt)\s*\d*$/i, '')
            .replace(/[_\-\s]+$/g, '')
            .trim();

        return cleanedName ? sanitizeFileNamePart(cleanedName, 50) : '';
    }

    function cleanPromptTitleForOutput(value) {
        const rawName = String(value || '').trim();
        if (!rawName) {
            return '';
        }

        const cleanedName = rawName
            .replace(/^(提示词|画面提示词|生图提示词|图片提示词|prompt|imageprompt)\s*\d*$/i, '')
            .replace(/^(提示词|画面提示词|生图提示词|图片提示词|prompt|imageprompt)\s*\d*\s*[:：-]\s*/i, '')
            .replace(/^第\s*\d+\s*[组条]\s*/i, '')
            .replace(/^\d+\s*[.、):：-]\s*/, '')
            .replace(/[_\-\s]+$/g, '')
            .trim();

        return cleanedName ? sanitizeFileNamePart(cleanedName, 28) : '';
    }

    return {
    buildOutputFileName(promptIndex, options = {}) {
        const timestamp = formatDateTimeForFile();
        const variantIndex = Number.isFinite(Number(options.variantIndex)) && Number(options.variantIndex) > 0
            ? Math.floor(Number(options.variantIndex))
            : 1;
        const outputSequenceBase = Number(options.outputSequence);
        const outputSequence = Number.isFinite(outputSequenceBase) && outputSequenceBase > 0
            ? outputSequenceBase + variantIndex - 1
            : outputSequenceBase;

        if (Number.isFinite(outputSequence) && outputSequence > 0) {
            const outputTotal = Number(options.outputTotal);
            const sequenceWidth = Math.max(4, String(Number.isFinite(outputTotal) && outputTotal > 0 ? Math.floor(outputTotal) : Math.floor(outputSequence)).length);
            const sequencePart = padNumber(outputSequence, sequenceWidth);
            const promptNumber = Number(options.promptIndexWithinImage ?? promptIndex);
            const promptPart = padNumber(promptNumber, 2);
            const runPart = sanitizeFileNamePart(options.runId || timestamp, 30);
            const safeOutputNameBase = sanitizeFileNamePart(options.outputNameBase, 120);

            if (safeOutputNameBase && safeOutputNameBase !== 'image') {
                return `${runPart}_${sequencePart}_${safeOutputNameBase}_v${padNumber(variantIndex, 2)}_${timestamp}.png`;
            }

            const refIndex = Number(options.referenceImageIndex);
            if (Number.isFinite(refIndex) && refIndex > 0) {
                const totalRefs = Number(options.totalReferenceImages);
                const refWidth = Math.max(3, String(Number.isFinite(totalRefs) && totalRefs > 0 ? Math.floor(totalRefs) : Math.floor(refIndex)).length);
                const refPart = padNumber(refIndex, refWidth);
                const safeRefName = cleanReferenceNameForOutput(options.referenceImageName);
                const refNamePart = safeRefName ? `_${safeRefName}` : '';
                const safePromptTitle = cleanPromptTitleForOutput(options.promptTitleName || options.promptTitle || options.promptName);
                const promptTitlePart = safePromptTitle ? `_${safePromptTitle}` : '';
                return `${runPart}_${sequencePart}_ref${refPart}_prompt${promptPart}_v${padNumber(variantIndex, 2)}${refNamePart}${promptTitlePart}_${timestamp}.png`;
            }

            return `${runPart}_${sequencePart}_prompt${promptPart}_v${padNumber(variantIndex, 2)}_${timestamp}.png`;
        }

        return `legil_${promptIndex}_v${padNumber(variantIndex, 2)}_${timestamp}.png`;
    }

    /**
     * 设置保存文件夹
     */,

    setSaveFolder(folderPath) {
        this.saveFolder = folderPath;
        logger.info(`已设置 Legil 保存文件夹: ${folderPath}`);
    }

    /**
     * 设置参考图文件夹
     */,

    setReferenceFolder(folderPath) {
        this.referenceFolder = folderPath;
        logger.info(`已设置 Legil 参考图文件夹: ${folderPath}`);
        // 重新扫描参考图
        this.scanReferenceImages();
    },

    getImageModelLabel(modelValue = this.generationSettings.imageModel) {
        const option = LEGIL_IMAGE_MODEL_OPTIONS.find(item => item.value === modelValue);
        return option ? option.label : LEGIL_IMAGE_MODEL_OPTIONS[0].label;
    },

    getImageModelOptions() {
        return LEGIL_IMAGE_MODEL_OPTIONS.map(option => ({ ...option }));
    },

    getModelParameterProfile(modelValue = this.generationSettings.imageModel) {
        const model = String(modelValue || '').trim();
        const profile = LEGIL_MODEL_PARAMETER_PROFILES[model] || LEGIL_DEFAULT_MODEL_PARAMETER_PROFILE;
        return {
            defaultAspectRatio: profile.defaultAspectRatio || LEGIL_DEFAULT_SETTINGS.aspectRatio,
            defaultResolution: profile.defaultResolution || LEGIL_DEFAULT_SETTINGS.resolution,
            defaultOutputQuantity: Number(profile.defaultOutputQuantity) || LEGIL_DEFAULT_SETTINGS.outputQuantity,
            aspectRatios: Array.isArray(profile.aspectRatios) && profile.aspectRatios.length
                ? [...profile.aspectRatios]
                : [...LEGIL_ASPECT_RATIOS],
            resolutions: Array.isArray(profile.resolutions) && profile.resolutions.length
                ? [...profile.resolutions]
                : [...LEGIL_RESOLUTIONS],
            outputQuantities: Array.isArray(profile.outputQuantities) && profile.outputQuantities.length
                ? [...profile.outputQuantities]
                : [...LEGIL_OUTPUT_QUANTITIES],
            outputQuantityControl: profile.outputQuantityControl || 'button'
        };
    },

    getGenerationOptionsForModel(modelValue = this.generationSettings.imageModel) {
        const profile = this.getModelParameterProfile(modelValue);
        return {
            imageModels: this.getImageModelOptions(),
            aspectRatios: [...profile.aspectRatios],
            resolutions: [...profile.resolutions],
            outputQuantities: [...profile.outputQuantities],
            outputQuantityControl: profile.outputQuantityControl
        };
    },

    normalizeGenerationSettings(settings = {}) {
        const next = {
            ...this.generationSettings,
            ...(settings && typeof settings === 'object' ? settings : {})
        };

        const imageModel = LEGIL_IMAGE_MODEL_OPTIONS.some(option => option.value === String(next.imageModel))
            ? String(next.imageModel)
            : LEGIL_DEFAULT_SETTINGS.imageModel;
        const profile = this.getModelParameterProfile(imageModel);
        const aspectRatio = profile.aspectRatios.includes(String(next.aspectRatio))
            ? String(next.aspectRatio)
            : profile.defaultAspectRatio;
        const resolution = profile.resolutions.includes(String(next.resolution))
            ? String(next.resolution)
            : profile.defaultResolution;
        const outputQuantityNumber = Number(next.outputQuantity);
        const outputQuantity = profile.outputQuantities.includes(outputQuantityNumber)
            ? outputQuantityNumber
            : profile.defaultOutputQuantity;

        const normalizeAspectRatios = (value) => {
            const rawValues = Array.isArray(value) ? value : (value ? [value] : []);
            const seen = new Set();
            return rawValues
                .map(item => String(item || '').trim())
                .filter(item => profile.aspectRatios.includes(item))
                .filter(item => {
                    if (seen.has(item)) return false;
                    seen.add(item);
                    return true;
                });
        };
        const aspectRatios = normalizeAspectRatios(Array.isArray(next.aspectRatios) ? next.aspectRatios : next.aspectRatio);

        const normalized = {
            imageModel,
            aspectRatio: aspectRatios[0] || aspectRatio,
            resolution,
            outputQuantity
        };

        if (Array.isArray(next.aspectRatios)) {
            normalized.aspectRatios = aspectRatios.length ? aspectRatios : [normalized.aspectRatio];
        }

        return normalized;
    },

    setGenerationSettings(settings = {}) {
        this.generationSettings = this.normalizeGenerationSettings(settings);
        logger.info(`已设置 Legil 生成参数: 模型 ${this.getImageModelLabel(this.generationSettings.imageModel)}, 宽高比 ${this.generationSettings.aspectRatio}, 分辨率 ${this.generationSettings.resolution}, 输出数量 ${this.generationSettings.outputQuantity}`);
        return this.getConfig();
    },

    getConfig() {
        const options = this.getGenerationOptionsForModel(this.generationSettings.imageModel);
        return {
            settings: { ...this.generationSettings },
            defaultSettings: { ...LEGIL_DEFAULT_SETTINGS },
            options,
            modelParameterProfiles: Object.fromEntries(
                this.getImageModelOptions().map(option => [
                    option.value,
                    this.getModelParameterProfile(option.value)
                ])
            )
        };
    },

    scanReferenceImages() {
        try {
            if (!fs.existsSync(this.referenceFolder)) {
                logger.warn(`参考图文件夹不存在: ${this.referenceFolder}`);
                this.referenceImages = [];
                return;
            }

            const files = fs.readdirSync(this.referenceFolder);
            const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif'];

            this.referenceImages = sortNaturallyByName(files)
                .filter(file => {
                    const ext = path.extname(file).toLowerCase();
                    return imageExtensions.includes(ext);
                })
                .map(file => path.join(this.referenceFolder, file));

            logger.info(`📁 Legil参考图文件夹扫描完成: 找到 ${this.referenceImages.length} 张参考图`);

            if (this.referenceImages.length > 0) {
                logger.info(`   参考图列表: ${this.referenceImages.map(f => path.basename(f)).join(', ')}`);
            }

        } catch (error) {
            logger.error(`扫描参考图文件夹失败: ${error.message}`);
            this.referenceImages = [];
        }
    }

    /**
     * 获取下一张参考图（循环使用）
     */,

    getNextReferenceImage() {
        if (this.referenceImages.length === 0) {
            return null;
        }

        const image = this.referenceImages[this.currentRefIndex];
        this.currentRefIndex = (this.currentRefIndex + 1) % this.referenceImages.length;

        return image;
    }

    /**
     * =====================================================
     * 主流程：生成图片并保存（带参考图上传）
     * =====================================================
     */
    };
};
