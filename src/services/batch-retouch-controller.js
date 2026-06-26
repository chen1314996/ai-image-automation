const nodePath = require('path');
const {
    extractSourceBusinessName,
    sanitizeNamePart
} = require('./output-naming/source-business-name');
const {
    buildManagedOutputNamingContext
} = require('./output-naming/creative-output-naming');

const RETOUCH_AUTOMATION_PREFIX = '自动化';
const RETOUCH_FALLBACK_LABEL = '未分类';
const RETOUCH_TITLE_MAX_CHARS = 8;

function ensureAutomationPrefix(value) {
    const text = sanitizeNamePart(value, 80);
    if (!text) {
        return '';
    }
    return text.startsWith(RETOUCH_AUTOMATION_PREFIX)
        ? text
        : `${RETOUCH_AUTOMATION_PREFIX}${text}`;
}

function cjkChars(value) {
    return String(value || '').match(/[\u3400-\u9fff\uf900-\ufaff]/gu) || [];
}

function shortenRetouchContentTitle(value) {
    let text = String(value || '')
        .replace(new RegExp(RETOUCH_AUTOMATION_PREFIX, 'g'), '')
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
        .replace(/[\s_\-]+/g, '')
        .trim();

    if (cjkChars(text).length <= RETOUCH_TITLE_MAX_CHARS) {
        return text;
    }

    const compactRelation = text.replace(/(上|中|里|内|外|前|后|下|旁|边|处|间)的/g, '');
    if (compactRelation && cjkChars(compactRelation).length <= RETOUCH_TITLE_MAX_CHARS) {
        return compactRelation;
    }

    text = compactRelation || text;
    const chars = cjkChars(text);
    if (chars.length > RETOUCH_TITLE_MAX_CHARS) {
        return chars.slice(-RETOUCH_TITLE_MAX_CHARS).join('');
    }

    return text;
}

function buildManagedRetouchBusinessName(parts = []) {
    const cleaned = (Array.isArray(parts) ? parts : [])
        .map(part => sanitizeNamePart(part, 80))
        .filter(Boolean);

    if (!cleaned.length) {
        return '';
    }

    const contentIndex = cleaned.length >= 4
        ? 3
        : Math.max(0, cleaned.length - 1);
    const standardLabelPath = cleaned.slice(0, contentIndex);
    const contentTitle = shortenRetouchContentTitle(cleaned.slice(contentIndex).join('_'));
    const namingContext = buildManagedOutputNamingContext({
        standardLabelPath,
        contentTitle,
        fallbackName: contentTitle || cleaned.join('_'),
        mode: 'batch-retouch',
        strictLibraryTags: false
    });

    return namingContext.outputNameBase || '';
}

function buildBatchRetouchOutputNameBase(inputImagePath = '') {
    const fileName = nodePath.basename(String(inputImagePath || ''));
    const parsed = extractSourceBusinessName(fileName);
    const businessName = parsed && Array.isArray(parsed.businessParts)
        ? buildManagedRetouchBusinessName(parsed.businessParts)
        : '';
    if (businessName) {
        return sanitizeNamePart(businessName, 120);
    }

    const fallbackStem = sanitizeNamePart(nodePath.parse(fileName).name || 'image', 70);
    return sanitizeNamePart(`${RETOUCH_FALLBACK_LABEL}_${ensureAutomationPrefix(fallbackStem || 'image')}`, 120);
}

function createBatchRetouchController(context) {
    const {
        appConfig,
        automationState,
        DEFAULT_BATCH_RETOUCH_CONFIG,
        fs,
        path,
        formatDateTimeForFile,
        legilAutomation,
        listImageFilesInFolder,
        logger,
        normalizeBrowserMode,
        normalizeInputPath,
        normalizeLegilGenerationSettings,
        persistedConfig,
        updateConfig
    } = context;

    const STYLE_REFERENCE_LIMIT = 10;
    const RETOUCH_TASK_TYPE = 'batch-retouch';

    class BatchRetouchController {
        constructor() {
            this.isRunning = false;
            this.stopRequested = false;
            this.status = this.createIdleStatus();
            this.resumeState = this.normalizeResumeState(persistedConfig.batchRetouchResume);
        }

        normalizeConfig(payload = {}) {
            const source = payload && typeof payload === 'object' ? payload : {};
            const previous = appConfig.batchRetouch || DEFAULT_BATCH_RETOUCH_CONFIG;
            return {
                inputFolder: normalizeInputPath(source.inputFolder) || previous.inputFolder || DEFAULT_BATCH_RETOUCH_CONFIG.inputFolder,
                outputFolder: normalizeInputPath(source.outputFolder) || previous.outputFolder || DEFAULT_BATCH_RETOUCH_CONFIG.outputFolder,
                referenceFolder: normalizeInputPath(source.referenceFolder) || previous.referenceFolder || DEFAULT_BATCH_RETOUCH_CONFIG.referenceFolder,
                prompt: String(source.prompt || previous.prompt || DEFAULT_BATCH_RETOUCH_CONFIG.prompt).trim(),
                browserMode: normalizeBrowserMode(source.browserMode || previous.browserMode, DEFAULT_BATCH_RETOUCH_CONFIG.browserMode),
                generationSettings: normalizeLegilGenerationSettings(
                    source.generationSettings,
                    previous.generationSettings || DEFAULT_BATCH_RETOUCH_CONFIG.generationSettings
                )
            };
        }

        updateConfig(payload = {}) {
            appConfig.batchRetouch = this.normalizeConfig(payload);
            updateConfig({ batchRetouch: appConfig.batchRetouch });
            return this.getPublicConfig();
        }

        getPublicConfig() {
            const legilConfig = legilAutomation.getConfig();
            const config = this.normalizeConfig(appConfig.batchRetouch || {});
            appConfig.batchRetouch = config;
            const generationOptions = typeof legilAutomation.getGenerationOptionsForModel === 'function'
                ? legilAutomation.getGenerationOptionsForModel(config.generationSettings.imageModel)
                : (legilConfig.options || {});
            return {
                ...config,
                generationSettings: {
                    ...config.generationSettings
                },
                defaultGenerationSettings: {
                    ...DEFAULT_BATCH_RETOUCH_CONFIG.generationSettings
                },
                generationOptions: {
                    ...generationOptions
                },
                modelParameterProfiles: legilConfig.modelParameterProfiles || {},
                styleReferenceLimit: STYLE_REFERENCE_LIMIT
            };
        }

        createIdleStatus() {
            return {
                taskType: RETOUCH_TASK_TYPE,
                isRunning: false,
                phase: 'idle',
                runId: '',
                totalInputImages: 0,
                currentInputIndex: 0,
                currentInputName: '',
                styleReferenceTotal: 0,
                styleReferenceUsed: 0,
                outputQuantity: 1,
                expectedOutputTotal: 0,
                completed: 0,
                success: 0,
                failed: 0,
                saved: 0,
                currentAction: '等待启动批量修图任务',
                updatedAt: new Date().toISOString()
            };
        }

        scan(configPayload = {}) {
            const config = this.normalizeConfig(configPayload);
            const inputImages = listImageFilesInFolder(config.inputFolder);
            const styleReferenceImages = listImageFilesInFolder(config.referenceFolder);
            const usedStyleReferenceImages = styleReferenceImages.slice(0, STYLE_REFERENCE_LIMIT);
            const outputQuantity = Number(config.generationSettings.outputQuantity) || 1;
            return {
                success: inputImages.length > 0 && usedStyleReferenceImages.length > 0,
                config,
                inputImages,
                styleReferenceImages,
                usedStyleReferenceImages,
                inputCount: inputImages.length,
                styleReferenceTotal: styleReferenceImages.length,
                styleReferenceUsed: usedStyleReferenceImages.length,
                styleReferenceLimit: STYLE_REFERENCE_LIMIT,
                expectedOutputTotal: inputImages.length * outputQuantity,
                message: this.buildScanMessage(inputImages.length, styleReferenceImages.length, usedStyleReferenceImages.length)
            };
        }

        buildScanMessage(inputCount, styleTotal, styleUsed) {
            if (inputCount === 0) {
                return '输入文件夹未找到可处理图片';
            }
            if (styleUsed === 0) {
                return '风格参考图文件夹未找到可处理图片';
            }
            if (styleTotal > STYLE_REFERENCE_LIMIT) {
                return `找到 ${inputCount} 张输入图；检测到 ${styleTotal} 张风格参考图，本次按文件名顺序使用前 ${STYLE_REFERENCE_LIMIT} 张。`;
            }
            return `找到 ${inputCount} 张输入图，${styleUsed} 张风格参考图。`;
        }

        validateStart(configPayload = {}) {
            const scan = this.scan(configPayload);
            if (!scan.config.prompt) {
                return {
                    ...scan,
                    success: false,
                    message: '请填写 Legil 修图提示词'
                };
            }
            if (!scan.inputCount) {
                return {
                    ...scan,
                    success: false,
                    message: '输入文件夹未找到可处理图片'
                };
            }
            if (!scan.styleReferenceUsed) {
                return {
                    ...scan,
                    success: false,
                    message: '风格参考图文件夹未找到可处理图片'
                };
            }
            if (!scan.config.outputFolder) {
                return {
                    ...scan,
                    success: false,
                    message: '请填写输出文件夹'
                };
            }
            return scan;
        }

        getStatus() {
            return {
                ...this.status,
                isRunning: this.isRunning,
                stopRequested: this.stopRequested || automationState.legilStopRequested === true,
                resume: this.getResumeInfo()
            };
        }

        normalizeResumeState(state) {
            if (!state || typeof state !== 'object') {
                return null;
            }
            const inputImages = Array.isArray(state.inputImages)
                ? state.inputImages.map(normalizeInputPath).filter(Boolean)
                : [];
            const styleReferenceImages = Array.isArray(state.styleReferenceImages)
                ? state.styleReferenceImages.map(normalizeInputPath).filter(Boolean).slice(0, STYLE_REFERENCE_LIMIT)
                : [];
            const nextIndex = Math.max(0, Math.min(Number(state.nextIndex) || 0, inputImages.length));
            if (!inputImages.length || !styleReferenceImages.length || nextIndex >= inputImages.length || state.phase === 'completed') {
                return null;
            }
            const config = this.normalizeConfig(state.config || {});
            return {
                runId: String(state.runId || ''),
                phase: String(state.phase || 'stopped'),
                config,
                inputImages,
                styleReferenceImages,
                styleReferenceTotal: Number(state.styleReferenceTotal) || styleReferenceImages.length,
                nextIndex,
                completed: Number(state.completed) || nextIndex,
                success: Number(state.success) || 0,
                failed: Number(state.failed) || 0,
                saved: Number(state.saved) || 0,
                startedAt: String(state.startedAt || new Date().toISOString()),
                updatedAt: String(state.updatedAt || new Date().toISOString()),
                currentAction: String(state.currentAction || '批量修图任务已暂停，可继续处理剩余输入图')
            };
        }

        setResumeState(state) {
            this.resumeState = this.normalizeResumeState(state);
            updateConfig({ batchRetouchResume: this.resumeState });
            return this.resumeState;
        }

        clearResume() {
            this.resumeState = null;
            updateConfig({ batchRetouchResume: null });
        }

        getResumeInfo(includeImages = false) {
            const resume = this.normalizeResumeState(this.resumeState);
            if (!resume) {
                return { hasResume: false };
            }
            this.resumeState = resume;
            return {
                hasResume: true,
                runId: resume.runId,
                phase: resume.phase,
                nextIndex: resume.nextIndex,
                totalInputImages: resume.inputImages.length,
                remainingCount: Math.max(0, resume.inputImages.length - resume.nextIndex),
                completed: resume.completed,
                success: resume.success,
                failed: resume.failed,
                saved: resume.saved,
                inputFolder: resume.config.inputFolder,
                outputFolder: resume.config.outputFolder,
                referenceFolder: resume.config.referenceFolder,
                browserMode: resume.config.browserMode,
                generationSettings: {
                    ...resume.config.generationSettings
                },
                styleReferenceTotal: resume.styleReferenceTotal,
                styleReferenceUsed: resume.styleReferenceImages.length,
                currentAction: resume.currentAction,
                startedAt: resume.startedAt,
                updatedAt: resume.updatedAt,
                inputImages: includeImages ? resume.inputImages.slice() : undefined,
                styleReferenceImages: includeImages ? resume.styleReferenceImages.slice() : undefined,
                config: includeImages ? { ...resume.config } : undefined
            };
        }

        async start(configPayload = {}, options = {}) {
            if (this.isRunning || automationState.legilTaskRunning) {
                return {
                    success: false,
                    message: '当前已有 Legil 生成任务正在运行，请稍后再启动批量修图'
                };
            }

            const validation = this.validateStart(configPayload);
            if (!validation.success) {
                return {
                    success: false,
                    message: validation.message,
                    scan: validation
                };
            }

            this.updateConfig(validation.config);
            this.clearResume();
            const runId = `batch-retouch-${formatDateTimeForFile()}`;
            this.run({
                runId,
                config: validation.config,
                inputImages: validation.inputImages,
                styleReferenceImages: validation.usedStyleReferenceImages,
                styleReferenceTotal: validation.styleReferenceTotal,
                startIndex: 0,
                baseCompleted: 0,
                baseSuccess: 0,
                baseFailed: 0,
                baseSaved: 0,
                recoveryOptions: options
            });

            return {
                success: true,
                message: `批量修图已启动，将处理 ${validation.inputCount} 张输入图`,
                runId,
                totalInputImages: validation.inputCount,
                styleReferenceUsed: validation.styleReferenceUsed,
                expectedOutputTotal: validation.expectedOutputTotal
            };
        }

        async resume(options = {}) {
            if (this.isRunning || automationState.legilTaskRunning) {
                return {
                    success: false,
                    message: '当前已有 Legil 生成任务正在运行，请稍后再继续批量修图'
                };
            }

            const resume = this.normalizeResumeState(this.resumeState);
            if (!resume) {
                return {
                    success: false,
                    message: '没有可继续的批量修图任务'
                };
            }

            this.run({
                runId: resume.runId || `batch-retouch-${formatDateTimeForFile()}`,
                config: resume.config,
                inputImages: resume.inputImages,
                styleReferenceImages: resume.styleReferenceImages,
                styleReferenceTotal: resume.styleReferenceTotal,
                startIndex: resume.nextIndex,
                baseCompleted: resume.completed,
                baseSuccess: resume.success,
                baseFailed: resume.failed,
                baseSaved: resume.saved,
                recoveryOptions: options
            });

            return {
                success: true,
                message: `已继续批量修图，将从第 ${resume.nextIndex + 1}/${resume.inputImages.length} 张输入图开始`,
                runId: resume.runId
            };
        }

        stop() {
            if (!this.isRunning && automationState.legilTaskType !== RETOUCH_TASK_TYPE) {
                return {
                    success: true,
                    message: '当前没有正在运行的批量修图任务',
                    resume: this.getResumeInfo()
                };
            }

            this.stopRequested = true;
            automationState.legilStopRequested = true;
            this.status = {
                ...this.status,
                phase: 'stopping',
                currentAction: '正在安全停止批量修图任务...',
                updatedAt: new Date().toISOString()
            };
            automationState.legilTaskProgress = { ...this.status };
            logger.warn('已收到批量修图停止指令，当前步骤结束后会安全停止。');
            return {
                success: true,
                message: '已发送停止指令，当前步骤结束后会安全停止',
                resume: this.getResumeInfo()
            };
        }

        async run(runContext) {
            const {
                runId,
                config,
                inputImages,
                styleReferenceImages,
                styleReferenceTotal,
                startIndex,
                baseCompleted,
                baseSuccess,
                baseFailed,
                baseSaved,
                recoveryOptions
            } = runContext;

            const outputQuantity = Number(config.generationSettings.outputQuantity) || 1;
            const totalInputImages = inputImages.length;
            const expectedOutputTotal = totalInputImages * outputQuantity;
            const useHeadless = config.browserMode !== 'headed';
            let completed = Number(baseCompleted) || 0;
            let success = Number(baseSuccess) || 0;
            let failed = Number(baseFailed) || 0;
            let saved = Number(baseSaved) || 0;
            let nextIndex = Math.max(0, Number(startIndex) || 0);
            let consecutiveFailures = 0;

            const previousSaveFolder = legilAutomation.saveFolder;
            const previousReferenceFolder = legilAutomation.referenceFolder;
            const previousReferenceImages = Array.isArray(legilAutomation.referenceImages)
                ? legilAutomation.referenceImages.slice()
                : [];
            const previousRefIndex = legilAutomation.currentRefIndex;
            const previousGenerationSettings = legilAutomation.generationSettings
                ? { ...legilAutomation.generationSettings }
                : {};

            this.isRunning = true;
            this.stopRequested = false;
            automationState.legilTaskRunning = true;
            automationState.legilStopRequested = false;
            automationState.legilTaskType = RETOUCH_TASK_TYPE;

            const setProgress = (updates = {}) => {
                this.status = {
                    taskType: RETOUCH_TASK_TYPE,
                    isRunning: this.isRunning,
                    phase: updates.phase || this.status.phase || 'running',
                    runId,
                    totalInputImages,
                    currentInputIndex: updates.currentInputIndex ?? nextIndex,
                    currentInputName: updates.currentInputName ?? this.status.currentInputName ?? '',
                    styleReferenceTotal,
                    styleReferenceUsed: styleReferenceImages.length,
                    outputQuantity,
                    expectedOutputTotal,
                    completed,
                    success,
                    failed,
                    saved,
                    currentAction: updates.currentAction || this.status.currentAction || '批量修图运行中',
                    updatedAt: new Date().toISOString()
                };
                automationState.legilTaskProgress = { ...this.status };
            };

            try {
                fs.mkdirSync(config.outputFolder, { recursive: true });
                setProgress({
                    phase: 'running',
                    currentInputIndex: Math.min(nextIndex + 1, totalInputImages),
                    currentAction: `批量修图已启动：共 ${totalInputImages} 张输入图，使用 ${styleReferenceImages.length}/${styleReferenceTotal} 张风格参考图`
                });

                logger.system('========================================');
                logger.system('开始批量修图任务');
                logger.info(`输入文件夹: ${config.inputFolder}`);
                logger.info(`输出文件夹: ${config.outputFolder}`);
                logger.info(`风格参考图: 使用 ${styleReferenceImages.length}/${styleReferenceTotal} 张`);
                logger.info(`Legil 提示词: ${config.prompt}`);
                logger.system('========================================');

                for (let i = nextIndex; i < inputImages.length; i++) {
                    if (this.stopRequested || automationState.legilStopRequested) {
                        break;
                    }

                    const inputImage = inputImages[i];
                    const inputName = path.basename(inputImage);
                    const outputNameBase = buildBatchRetouchOutputNameBase(inputName);
                    const outputSequence = saved + 1;
                    nextIndex = i;
                    setProgress({
                        phase: 'uploading',
                        currentInputIndex: i + 1,
                        currentInputName: inputName,
                        currentAction: `正在上传第 ${i + 1}/${totalInputImages} 张输入图及 ${styleReferenceImages.length} 张风格参考图`
                    });

                    logger.system(`批量修图 ${i + 1}/${totalInputImages}: ${inputName}`);
                    logger.info(`批量修图输出命名: ${outputNameBase}`);
                    const result = await legilAutomation.generateImage(config.prompt, i + 1, {
                        saveFolder: config.outputFolder,
                        uploadMode: 'retouch-sequential-slots',
                        retouchInputImagePath: inputImage,
                        styleReferenceImagePaths: styleReferenceImages,
                        refreshBeforeUpload: true,
                        headless: useHeadless,
                        generationSettings: config.generationSettings,
                        strictGenerationSettings: true,
                        strictOutputCount: true,
                        taskType: '批量修图',
                        runId,
                        outputNameBase,
                        outputSequence,
                        outputTotal: expectedOutputTotal,
                        referenceImageName: outputNameBase,
                        referenceImageIndex: i + 1,
                        totalReferenceImages: totalInputImages,
                        expectedOutputCount: outputQuantity,
                        shouldAbort: () => this.stopRequested || automationState.legilStopRequested,
                        autoRecoveryEnabled: recoveryOptions.autoRecoveryEnabled,
                        captureErrorScreenshot: recoveryOptions.captureErrorScreenshot
                    });

                    if (this.stopRequested || automationState.legilStopRequested) {
                        setProgress({
                            phase: 'stopping',
                            currentInputIndex: i + 1,
                            currentInputName: inputName,
                            currentAction: '批量修图任务正在停止...'
                        });
                        break;
                    }

                    completed += 1;
                    nextIndex = i + 1;

                    if (result && result.success) {
                        success += 1;
                        consecutiveFailures = 0;
                        saved += Number(result.savedCount) || (Array.isArray(result.savePaths) ? result.savePaths.length : 1);
                        logger.info(`批量修图成功 ${i + 1}/${totalInputImages}: 已保存 ${Number(result.savedCount) || 1} 张`);
                        setProgress({
                            phase: 'running',
                            currentInputIndex: i + 1,
                            currentInputName: inputName,
                            currentAction: `第 ${i + 1}/${totalInputImages} 张完成，已保存 ${saved}/${expectedOutputTotal} 张`
                        });
                    } else {
                        failed += 1;
                        consecutiveFailures += 1;
                        const message = result && result.message ? result.message : 'Legil 生成失败';
                        logger.error(`批量修图失败 ${i + 1}/${totalInputImages}: ${message}`);
                        setProgress({
                            phase: 'running',
                            currentInputIndex: i + 1,
                            currentInputName: inputName,
                            currentAction: `第 ${i + 1}/${totalInputImages} 张失败：${message}`
                        });

                        const failureThreshold = Number(recoveryOptions.consecutiveFailureThreshold) || 5;
                        if (recoveryOptions.pauseOnConsecutiveFailures !== false && consecutiveFailures >= failureThreshold) {
                            this.stopRequested = true;
                            logger.warn(`批量修图连续失败 ${consecutiveFailures} 次，已自动暂停。`);
                            break;
                        }
                    }

                    if (i < inputImages.length - 1) {
                        await this.sleep(5000);
                    }
                }

                const stopped = this.stopRequested || automationState.legilStopRequested || nextIndex < inputImages.length;
                if (stopped) {
                    setProgress({
                        phase: 'stopped',
                        currentInputIndex: Math.min(nextIndex + 1, totalInputImages),
                        currentInputName: inputImages[nextIndex] ? path.basename(inputImages[nextIndex]) : '',
                        currentAction: `批量修图已暂停：成功 ${success} 张，失败 ${failed} 张，已保存 ${saved} 张`
                    });
                    this.setResumeState({
                        runId,
                        phase: 'stopped',
                        config,
                        inputImages,
                        styleReferenceImages,
                        styleReferenceTotal,
                        nextIndex,
                        completed,
                        success,
                        failed,
                        saved,
                        startedAt: this.status.startedAt || new Date().toISOString(),
                        updatedAt: new Date().toISOString(),
                        currentAction: this.status.currentAction
                    });
                    logger.warn(this.status.currentAction);
                } else {
                    setProgress({
                        phase: 'completed',
                        currentInputIndex: totalInputImages,
                        currentInputName: '',
                        currentAction: `批量修图完成：成功 ${success} 张，失败 ${failed} 张，已保存 ${saved} 张`
                    });
                    this.clearResume();
                    logger.system(this.status.currentAction);
                }
            } catch (error) {
                setProgress({
                    phase: 'error',
                    currentAction: `批量修图任务异常：${error.message}`
                });
                this.setResumeState({
                    runId,
                    phase: 'interrupted',
                    config,
                    inputImages,
                    styleReferenceImages,
                    styleReferenceTotal,
                    nextIndex,
                    completed,
                    success,
                    failed,
                    saved,
                    updatedAt: new Date().toISOString(),
                    currentAction: this.status.currentAction
                });
                logger.error(`批量修图任务异常: ${error.message}`);
            } finally {
                legilAutomation.saveFolder = previousSaveFolder;
                legilAutomation.referenceFolder = previousReferenceFolder;
                legilAutomation.referenceImages = previousReferenceImages;
                legilAutomation.currentRefIndex = previousRefIndex;
                legilAutomation.generationSettings = previousGenerationSettings;
                this.isRunning = false;
                this.stopRequested = false;
                automationState.legilTaskRunning = false;
                automationState.legilStopRequested = false;
                automationState.legilTaskType = null;
                this.status = {
                    ...this.status,
                    isRunning: false,
                    updatedAt: new Date().toISOString()
                };
                automationState.legilTaskProgress = this.status.phase === 'completed' || this.status.phase === 'stopped' || this.status.phase === 'error'
                    ? { ...this.status }
                    : null;
            }
        }

        async sleep(ms) {
            const startedAt = Date.now();
            while (Date.now() - startedAt < ms) {
                if (this.stopRequested || automationState.legilStopRequested) {
                    throw new Error('批量修图任务已停止');
                }
                await new Promise(resolve => setTimeout(resolve, Math.min(500, ms - (Date.now() - startedAt))));
            }
        }
    }

    return new BatchRetouchController();
}

module.exports = {
    createBatchRetouchController,
    buildBatchRetouchOutputNameBase
};
