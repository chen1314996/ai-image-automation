/**
 * ============================================
 * 完整工作流控制器（第九阶段）
 * ============================================
 * 核心功能：
 * 1. 循环处理输入文件夹中的所有参考图
 * 2. 每张参考图：调用提示词模型 API → 获取多组提示词 → Legil生成图片
 * 3. 单张图提示词处理完后，自动处理下一张
 * 4. 直到所有参考图处理完毕
 */

const fs = require('fs');
const path = require('path');
const promptGenerationService = require('./prompt-generation-service');
const legilAutomation = require('./legil-automation');
const logger = require('./logger');
const { formatDateTimeForFile, sanitizeFileNamePart, sortNaturallyByName } = require('./file-utils');
const {
    buildCreativeOutputNamingContext
} = require('./src/services/output-naming/creative-output-naming');
const {
    extractSourceBusinessName
} = require('./src/services/output-naming/source-business-name');

class WorkflowController {
    constructor() {
        this.isRunning = false;
        this.currentIndex = 0;
        this.totalImages = 0;
        this.imageFiles = [];
        this.inputFolder = 'D:\\工作\\自动化工作流1\\批量产图\\输入';
        this.outputFolder = 'D:\\工作\\自动化工作流1\\批量产图\\输出';
        // Legil参考图文件夹
        this.legilReferenceFolder = 'D:\\工作\\自动化工作流1\\批量产图\\参考图';
        this.stats = {
            processed: 0,
            failed: 0,
            totalGenerated: 0
        };
        // 详细进度状态（阶段10新增）
        this.currentStatus = {
            phase: 'idle', // idle, processing_image, extracting_prompts, generating_in_legil, completed, error
            currentImageIndex: 0,
            totalImages: 0,
            currentImageName: '',
            currentPromptIndex: 0,
            totalPrompts: 0,
            currentAction: '', // 当前正在执行的动作描述
            error: null
        };
        // 用于强制停止的信号
        this.abortController = null;
        this.pendingPromises = [];
        this.currentRunId = '';
        this.resumeSnapshot = null;
        this.currentImagePrompts = [];
        this.currentImagePath = '';
        this.nextResumeImageIndex = 0;
        this.nextResumePromptIndex = 0;
        this.browserMode = 'headless';
        this.headless = true;
        this.promptGenerationConfig = promptGenerationService.normalizeConfig({});
        this.generationSettings = {
            ...legilAutomation.getConfig().settings
        };
        this.consecutiveLegilFailures = 0;
        this.pauseOnConsecutiveFailures = true;
        this.consecutiveFailureThreshold = 3;
        this.autoRecoveryEnabled = true;
        this.captureErrorScreenshot = true;
    }

    /**
     * =====================================================
     * 更新当前状态（推送到前端）
     * =====================================================
     */
    updateStatus(updates) {
        this.currentStatus = { ...this.currentStatus, ...updates };
        // 通过日志系统推送状态更新
        const statusMsg = JSON.stringify({
            type: 'workflow_status',
            status: this.currentStatus
        });
        // 这里可以通过 logger 的特殊方式推送，或者前端通过轮询获取
    }

    normalizeFolderPath(folderPath) {
        if (typeof folderPath !== 'string') {
            return '';
        }
        return folderPath.replace(/["']/g, '').trim();
    }

    ensureDirectory(folderPath, label) {
        const normalizedPath = this.normalizeFolderPath(folderPath);
        if (!normalizedPath) {
            throw new Error(`${label}不能为空`);
        }

        if (!fs.existsSync(normalizedPath)) {
            fs.mkdirSync(normalizedPath, { recursive: true });
        }

        const stats = fs.statSync(normalizedPath);
        if (!stats.isDirectory()) {
            throw new Error(`${label}不是文件夹`);
        }

        return normalizedPath;
    }

    validateStart(inputFolder, outputFolder, legilRefFolder) {
        if (this.isRunning) {
            return {
                success: false,
                message: '工作流正在运行中，请勿重复启动'
            };
        }

        const resolvedInput = this.normalizeFolderPath(inputFolder) || this.inputFolder;
        const resolvedOutput = this.normalizeFolderPath(outputFolder) || this.outputFolder;
        const resolvedLegilRef = this.normalizeFolderPath(legilRefFolder) || this.legilReferenceFolder;

        try {
            if (!fs.existsSync(resolvedInput)) {
                return {
                    success: false,
                    message: `输入文件夹不存在: ${resolvedInput}`
                };
            }

            const inputStats = fs.statSync(resolvedInput);
            if (!inputStats.isDirectory()) {
                return {
                    success: false,
                    message: `输入路径不是文件夹: ${resolvedInput}`
                };
            }

            const imageFiles = this.getImageFiles(resolvedInput);
            if (imageFiles.length === 0) {
                return {
                    success: false,
                    message: '输入文件夹中没有图片'
                };
            }

            const safeOutput = this.ensureDirectory(resolvedOutput, '输出文件夹');

            return {
                success: true,
                inputFolder: resolvedInput,
                outputFolder: safeOutput,
                legilReferenceFolder: resolvedLegilRef,
                totalImages: imageFiles.length
            };
        } catch (error) {
            return {
                success: false,
                message: error.message
            };
        }
    }

    isAbortRequested() {
        return !this.isRunning || (this.abortController && this.abortController.signal.aborted);
    }

    getCancellationOptions() {
        return {
            signal: this.abortController ? this.abortController.signal : null,
            shouldAbort: () => this.isAbortRequested()
        };
    }

    normalizeBrowserMode(value, fallback = 'headless') {
        if (value === 'headless' || value === 'headed') {
            return value;
        }
        return fallback === 'headed' ? 'headed' : 'headless';
    }

    setPromptGenerationConfig(config = {}) {
        this.promptGenerationConfig = promptGenerationService.normalizeConfig(config, this.promptGenerationConfig);
        return promptGenerationService.getPublicConfig(this.promptGenerationConfig);
    }

    buildResumeSnapshot() {
        if (!this.totalImages || !Array.isArray(this.imageFiles) || this.imageFiles.length === 0) {
            return null;
        }

        let imageIndex = Number.isFinite(Number(this.nextResumeImageIndex))
            ? Math.floor(Number(this.nextResumeImageIndex))
            : this.currentIndex;
        let promptIndex = Number.isFinite(Number(this.nextResumePromptIndex))
            ? Math.floor(Number(this.nextResumePromptIndex))
            : 0;

        imageIndex = Math.max(0, Math.min(imageIndex, this.imageFiles.length));
        const imagePath = imageIndex < this.imageFiles.length ? this.imageFiles[imageIndex] : '';
        const currentPromptTotal = this.currentImagePath === imagePath && Array.isArray(this.currentImagePrompts)
            ? this.currentImagePrompts.length
            : 0;
        const promptLimit = currentPromptTotal > 0
            ? currentPromptTotal
            : Math.max(0, Number(this.currentStatus.totalPrompts) || 0);

        promptIndex = promptLimit > 0
            ? Math.max(0, Math.min(promptIndex, promptLimit))
            : 0;

        if (promptLimit > 0 && promptIndex >= promptLimit) {
            imageIndex += 1;
            promptIndex = 0;
        }

        if (imageIndex >= this.imageFiles.length) {
            return null;
        }

        const canReusePrompts = this.currentImagePath === imagePath &&
            Array.isArray(this.currentImagePrompts) &&
            this.currentImagePrompts.length > 0;

        return {
            inputFolder: this.inputFolder,
            outputFolder: this.outputFolder,
            legilReferenceFolder: this.legilReferenceFolder,
            browserMode: this.browserMode,
            headless: this.headless,
            promptGeneration: promptGenerationService.normalizeConfig(this.promptGenerationConfig, this.promptGenerationConfig),
            generationSettings: {
                ...this.generationSettings
            },
            imageFiles: [...this.imageFiles],
            totalImages: this.totalImages,
            imageIndex,
            promptIndex,
            totalPrompts: currentPromptTotal,
            prompts: canReusePrompts ? [...this.currentImagePrompts] : [],
            stats: { ...this.stats },
            runId: this.currentRunId || formatDateTimeForFile(),
            savedAt: new Date().toISOString()
        };
    }

    getResumeInfo() {
        const snapshot = this.resumeSnapshot;
        if (!snapshot || !Array.isArray(snapshot.imageFiles) || snapshot.imageIndex >= snapshot.imageFiles.length) {
            return {
                hasResume: false
            };
        }

        const imagePath = snapshot.imageFiles[snapshot.imageIndex];
        return {
            hasResume: true,
            inputFolder: snapshot.inputFolder,
            outputFolder: snapshot.outputFolder,
            legilReferenceFolder: snapshot.legilReferenceFolder,
            browserMode: snapshot.browserMode || 'headless',
            promptGeneration: promptGenerationService.getPublicConfig(snapshot.promptGeneration || this.promptGenerationConfig),
            generationSettings: snapshot.generationSettings && typeof snapshot.generationSettings === 'object'
                ? { ...snapshot.generationSettings }
                : { ...legilAutomation.getConfig().settings },
            imageIndex: snapshot.imageIndex + 1,
            totalImages: snapshot.totalImages || snapshot.imageFiles.length,
            imageName: imagePath ? path.basename(imagePath) : '',
            promptIndex: (() => {
                const promptTotal = Array.isArray(snapshot.prompts) && snapshot.prompts.length > 0
                    ? snapshot.prompts.length
                    : Math.max(0, Number(snapshot.totalPrompts) || 0);
                const promptIndex = Math.max(0, Number(snapshot.promptIndex) || 0);
                return promptTotal > 0 ? Math.min(promptIndex + 1, promptTotal) : 0;
            })(),
            totalPrompts: Array.isArray(snapshot.prompts) && snapshot.prompts.length > 0
                ? snapshot.prompts.length
                : Math.max(0, Number(snapshot.totalPrompts) || 0),
            stats: snapshot.stats || {},
            savedAt: snapshot.savedAt || ''
        };
    }

    buildPromptTitleForFile(promptText) {
        const raw = String(promptText || '').replace(/\r/g, '\n').trim();
        if (!raw) {
            return '';
        }

        const cleanTitle = (value) => {
            let text = String(value || '')
                .replace(/^[\s"'“”‘’《》【】\[\]（）()]+|[\s"'“”‘’《》【】\[\]（）()]+$/g, '')
                .replace(/^第\s*\d+\s*[组条]\s*/i, '')
                .replace(/^\d+\s*[.、):：-]\s*/, '')
                .replace(/^(标题|主题|方向|创意方向|画面标题|场景标题|提示词|画面提示词|生图提示词|图片提示词|prompt|title)\s*\d*\s*[:：-]\s*/i, '')
                .replace(/\s+/g, ' ')
                .trim();

            text = text.split(/[。！？!?；;，,\n]/)[0].trim();

            if (!text || /^(提示词|画面提示词|生图提示词|图片提示词|prompt|imageprompt)\s*\d*$/i.test(text)) {
                return '';
            }

            return text.slice(0, 24);
        };

        const lines = raw
            .split('\n')
            .map(line => line.trim())
            .filter(Boolean)
            .slice(0, 8);
        const candidates = [];

        for (const line of lines) {
            const explicitTitle = line.match(/(?:^|[\s【\[(（])(?:标题|主题|方向|创意方向|画面标题|场景标题|title)\s*[:：]\s*([^。！？!?；;，,\n]{2,40})/i);
            if (explicitTitle) {
                candidates.push(explicitTitle[1]);
            }

            const leadingTitle = line.match(/^[\s"'“”‘’《》【\[\(（]*([^"'“”‘’《》【】\[\]（）()。！？!?；;，,\n:：]{2,30})[\s"'“”‘’》】\]\)）]*[:：]/);
            if (leadingTitle) {
                candidates.push(leadingTitle[1]);
            }
        }

        const quotedTitle = raw.match(/[《【“"]([^》】”"]{2,30})[》】”"]/);
        if (quotedTitle) {
            candidates.push(quotedTitle[1]);
        }

        candidates.push(lines[0] || raw);

        for (const candidate of candidates) {
            const title = cleanTitle(candidate);
            if (title) {
                return title;
            }
        }

        return '';
    }

    buildOutputNameBaseForPrompt(promptData, fallbackTitle = '') {
        if (!promptData || typeof promptData !== 'object') {
            return '';
        }

        const standardLabelPath = Array.isArray(promptData.standardLabelPath)
            ? promptData.standardLabelPath.filter(Boolean)
            : [
                promptData.primaryTag,
                promptData.secondaryTag,
                promptData.tertiaryTag
            ].filter(Boolean);
        const contentTitle = promptData.contentTitle ||
            promptData.newDirectionName ||
            promptData.direction ||
            promptData.outputNameBase ||
            promptData.title ||
            fallbackTitle;
        const sourceDirectionPath = promptData.sourceDirectionPath ||
            promptData.directionPath ||
            promptData.matchedDirection ||
            (standardLabelPath.length ? standardLabelPath.join('/') : '');
        const namingContext = buildCreativeOutputNamingContext({
            ...promptData,
            standardLabelPath,
            sourceDirectionPath,
            contentTitle,
            fallbackName: contentTitle || promptData.outputNameBase || fallbackTitle,
            strictLibraryTags: false
        });

        return namingContext.outputNameBase || promptData.outputNameBase || '';
    }

    stripTrailingReferenceIndex(value) {
        const text = String(value || '').trim();
        if (!text) {
            return '';
        }

        if (/[\u3400-\u9fff\uf900-\ufaff]/u.test(text)) {
            return text
                .replace(/\d{1,3}$/u, '')
                .replace(/_+$/g, '')
                .trim();
        }

        return text;
    }

    buildOutputNameBaseForReferenceImage(imageName) {
        const parsed = extractSourceBusinessName(imageName);
        if (!parsed) {
            return '';
        }

        const businessParts = Array.isArray(parsed.businessParts) && parsed.businessParts.length
            ? [...parsed.businessParts]
            : String(parsed.businessName || '').split('_').filter(Boolean);

        if (!businessParts.length) {
            return '';
        }

        businessParts[businessParts.length - 1] = this.stripTrailingReferenceIndex(
            businessParts[businessParts.length - 1]
        );

        return businessParts
            .map(part => sanitizeFileNamePart(part, 80))
            .filter(Boolean)
            .join('_');
    }

    buildWorkflowOutputNameBase(referenceOutputNameBase, promptData = {}, promptTitleName = '') {
        const referenceBase = sanitizeFileNamePart(referenceOutputNameBase, 90);
        if (referenceBase) {
            const titleCandidate = promptTitleName ||
                promptData.promptTitle ||
                promptData.title ||
                promptData.name ||
                '';
            const promptTitle = sanitizeFileNamePart(titleCandidate, 50);
            if (promptTitle && promptTitle !== referenceBase && !referenceBase.endsWith(`_${promptTitle}`)) {
                return `${referenceBase}_${promptTitle}`;
            }
            return referenceBase;
        }

        return promptData.outputNameBase || this.buildOutputNameBaseForPrompt(promptData, promptTitleName);
    }

    normalizeWorkflowPromptItems(prompts = []) {
        return (Array.isArray(prompts) ? prompts : [])
            .map((item, index) => {
                if (typeof item === 'string') {
                    const prompt = item.trim();
                    return prompt ? {
                        index: index + 1,
                        prompt,
                        content: prompt
                    } : null;
                }

                if (!item || typeof item !== 'object') {
                    return null;
                }

                const prompt = [
                    item.prompt,
                    item.content,
                    item.finalPrompt,
                    item.promptText,
                    item.text,
                    item.description
                ].find(value => typeof value === 'string' && value.trim());

                if (!prompt) {
                    return null;
                }

                return {
                    ...item,
                    index: Number.isFinite(Number(item.index)) && Number(item.index) > 0 ? Number(item.index) : index + 1,
                    prompt: prompt.trim(),
                    content: typeof item.content === 'string' && item.content.trim() ? item.content.trim() : prompt.trim()
                };
            })
            .filter(Boolean);
    }

    resolvePromptTextFilePath(savePaths = []) {
        const firstPath = Array.isArray(savePaths) ? savePaths.find(Boolean) : '';
        if (!firstPath) {
            return '';
        }
        const parsed = path.parse(firstPath);
        const sharedStem = parsed.name
            .replace(/_v\d+_\d{8}_\d{6}$/i, '')
            .replace(/_v\d+$/i, '');
        return path.join(parsed.dir, `${sharedStem || parsed.name}.prompt.txt`);
    }

    buildPromptTextFileContent(promptItem = {}, meta = {}) {
        const savedPaths = Array.isArray(meta.savedPaths) ? meta.savedPaths : [];
        const outputNames = savedPaths.map(filePath => path.basename(filePath)).filter(Boolean);
        return [
            `Generated at: ${meta.savedAt || new Date().toISOString()}`,
            `Run ID: ${meta.runId || ''}`,
            `Reference image: ${meta.referenceImageName || ''}`,
            `Reference index: ${meta.referenceImageIndex || ''}/${meta.totalReferenceImages || ''}`,
            `Prompt group: ${meta.displayIndex || promptItem.index || ''}/${meta.totalPrompts || ''}`,
            `Prompt title: ${promptItem.promptTitle || promptItem.title || meta.promptTitleName || ''}`,
            `Direction: ${promptItem.newDirectionName || promptItem.direction || promptItem.contentTitle || ''}`,
            `Matched direction: ${promptItem.matchedDirectionPath || promptItem.sourceDirectionPath || ''}`,
            `Content name: ${promptItem.contentName || promptItem.contentTitle || ''}`,
            `Output name base: ${promptItem.outputNameBase || ''}`,
            '',
            'Output images:',
            ...(outputNames.length ? outputNames.map(name => `- ${name}`) : ['-']),
            '',
            'Prompt:',
            promptItem.prompt || promptItem.finalPrompt || promptItem.content || ''
        ].join('\n');
    }

    savePromptTextFileForPromptGroup(savePaths = [], promptItem = {}, meta = {}) {
        const promptFilePath = this.resolvePromptTextFilePath(savePaths);
        if (!promptFilePath) {
            return '';
        }
        fs.writeFileSync(promptFilePath, this.buildPromptTextFileContent(promptItem, {
            ...meta,
            savedPaths: savePaths
        }), 'utf8');
        return promptFilePath;
    }

    saveExtractedPromptsForImage(promptItems = [], imagePath = '', imageIndex = 0, totalImages = 0) {
        if (!Array.isArray(promptItems) || promptItems.length === 0 || !this.outputFolder) {
            return null;
        }

        const promptsDir = path.join(this.outputFolder, 'prompts');
        fs.mkdirSync(promptsDir, { recursive: true });

        const imageName = path.basename(imagePath);
        const imageStem = sanitizeFileNamePart(path.parse(imageName).name || `ref${imageIndex}`, 80);
        const refIndex = String(Math.max(0, Number(imageIndex) || 0)).padStart(3, '0');
        const baseName = `${this.currentRunId || formatDateTimeForFile()}_ref${refIndex}_${imageStem}_prompts`;
        const jsonPath = path.join(promptsDir, `${baseName}.json`);
        const textPath = path.join(promptsDir, `${baseName}.txt`);
        const savedAt = new Date().toISOString();
        const publicPromptConfig = promptGenerationService.getPublicConfig(this.promptGenerationConfig);
        const promptRecords = promptItems.map((item, index) => ({
            index: index + 1,
            promptTitle: item.promptTitle || item.title || item.name || '',
            direction: item.newDirectionName || item.direction || item.contentTitle || '',
            outputNameBase: item.outputNameBase || '',
            prompt: item.prompt || item.content || ''
        }));

        fs.writeFileSync(jsonPath, JSON.stringify({
            savedAt,
            runId: this.currentRunId || '',
            source: 'mass-workflow',
            referenceImage: {
                index: imageIndex,
                total: totalImages,
                name: imageName,
                path: imagePath
            },
            promptGeneration: publicPromptConfig,
            prompts: promptRecords
        }, null, 2), 'utf8');

        fs.writeFileSync(textPath, [
            `Generated at: ${savedAt}`,
            `Run ID: ${this.currentRunId || ''}`,
            `Reference image: ${imageName}`,
            `Reference index: ${imageIndex}/${totalImages}`,
            `Prompt model: Lumos Winky / ${(publicPromptConfig.lumos && publicPromptConfig.lumos.model) || ''}`,
            '',
            ...promptRecords.flatMap(item => [
                `# Prompt ${item.index}${item.promptTitle ? ` - ${item.promptTitle}` : ''}`,
                item.direction ? `Direction: ${item.direction}` : '',
                item.outputNameBase ? `Output name base: ${item.outputNameBase}` : '',
                item.prompt,
                ''
            ].filter(line => line !== ''))
        ].join('\n'), 'utf8');

        return { jsonPath, textPath };
    }

    clearResume() {
        this.resumeSnapshot = null;
    }

    /**
     * =====================================================
     * 主流程：启动完整工作流
     * =====================================================
     * @param {string} inputFolder - 参考图文件夹路径
     * @param {string} outputFolder - 输出文件夹路径
     * @param {string} legilRefFolder - Legil参考图文件夹路径（可选）
     */
    async startWorkflow(inputFolder, outputFolder, legilRefFolder, options = {}) {
        const resumeSnapshot = options && options.resumeSnapshot ? options.resumeSnapshot : null;
        const validation = resumeSnapshot
            ? {
                success: true,
                inputFolder: resumeSnapshot.inputFolder,
                outputFolder: resumeSnapshot.outputFolder,
                legilReferenceFolder: resumeSnapshot.legilReferenceFolder,
                totalImages: Array.isArray(resumeSnapshot.imageFiles) ? resumeSnapshot.imageFiles.length : 0
            }
            : this.validateStart(inputFolder, outputFolder, legilRefFolder);

        if (!validation.success) {
            this.updateStatus({
                phase: 'error',
                currentAction: validation.message,
                error: validation.message
            });
            return validation;
        }

        this.isRunning = true;
        this.abortController = new AbortController();
        this.inputFolder = validation.inputFolder;
        this.outputFolder = validation.outputFolder;
        this.legilReferenceFolder = validation.legilReferenceFolder;
        const requestedBrowserMode = options && typeof options.browserMode === 'string'
            ? options.browserMode
            : (typeof options.headless === 'boolean' ? (options.headless ? 'headless' : 'headed') : '');
        this.browserMode = this.normalizeBrowserMode(
            requestedBrowserMode || (resumeSnapshot && resumeSnapshot.browserMode) || this.browserMode,
            'headless'
        );
        this.headless = this.browserMode === 'headless';
        this.promptGenerationConfig = promptGenerationService.normalizeConfig(
            (options && options.promptGeneration) || (resumeSnapshot && resumeSnapshot.promptGeneration) || this.promptGenerationConfig,
            (resumeSnapshot && resumeSnapshot.promptGeneration) || this.promptGenerationConfig
        );
        const requestedGenerationSettings = options && options.generationSettings && typeof options.generationSettings === 'object'
            ? options.generationSettings
            : null;
        this.generationSettings = legilAutomation.normalizeGenerationSettings(
            requestedGenerationSettings || (resumeSnapshot && resumeSnapshot.generationSettings) || this.generationSettings
        );
        this.consecutiveLegilFailures = 0;
        this.pauseOnConsecutiveFailures = options.pauseOnConsecutiveFailures !== false;
        this.consecutiveFailureThreshold = Math.max(1, Math.min(20, Number(options.consecutiveFailureThreshold) || 3));
        this.autoRecoveryEnabled = options.autoRecoveryEnabled !== false;
        this.captureErrorScreenshot = options.captureErrorScreenshot !== false;
        this.stats = resumeSnapshot && resumeSnapshot.stats
            ? { processed: 0, failed: 0, totalGenerated: 0, ...resumeSnapshot.stats }
            : { processed: 0, failed: 0, totalGenerated: 0 };
        this.currentRunId = resumeSnapshot && resumeSnapshot.runId ? resumeSnapshot.runId : formatDateTimeForFile();
        this.clearResume();

        // 确保前端传入的输出目录真正用于 Legil 图片保存
        legilAutomation.setSaveFolder(this.outputFolder);

        // 设置Legil参考图文件夹
        if (this.legilReferenceFolder) {
            legilAutomation.setReferenceFolder(this.legilReferenceFolder);
            logger.info(`已设置 Legil 参考图文件夹: ${this.legilReferenceFolder}`);
        }

        // 初始化状态
        this.updateStatus({
            phase: 'starting',
            currentImageIndex: 0,
            totalImages: 0,
            currentImageName: '',
            currentPromptIndex: 0,
            totalPrompts: 0,
            browserMode: this.browserMode,
            currentAction: '正在初始化工作流...',
            error: null
        });

        logger.info('========================================');
        logger.info('🚀 启动完整工作流 - 第九阶段');
        logger.info('========================================');
        logger.info(`输入文件夹: ${this.inputFolder}`);
        logger.info(`输出文件夹: ${this.outputFolder}`);
        logger.info(`运行模式: ${this.headless ? '无头模式' : '有头模式'}`);
        const promptConfigForLog = promptGenerationService.getPublicConfig(this.promptGenerationConfig);
        const promptProviderLabel = `Lumos Winky / ${promptConfigForLog.lumos.model || '未填写模型'}`;
        logger.info(`提示词生成模型: ${promptProviderLabel}`);

        try {
            // 第1步：获取所有参考图
            this.imageFiles = resumeSnapshot && Array.isArray(resumeSnapshot.imageFiles)
                ? [...resumeSnapshot.imageFiles]
                : this.getImageFiles(this.inputFolder);
            this.totalImages = this.imageFiles.length;
            const startImageIndex = resumeSnapshot
                ? Math.max(0, Math.min(Number(resumeSnapshot.imageIndex) || 0, this.totalImages - 1))
                : 0;
            this.currentIndex = startImageIndex;

            if (this.totalImages === 0) {
                this.isRunning = false;
                return {
                    success: false,
                    message: '输入文件夹中没有图片'
                };
            }

            if (resumeSnapshot) {
                logger.info(`找到 ${this.totalImages} 张参考图，将从第 ${startImageIndex + 1} 张继续处理...`);
            } else {
                logger.info(`找到 ${this.totalImages} 张参考图，开始处理...`);
            }

            // 第2步：循环处理每张参考图
            for (let i = startImageIndex; i < this.totalImages; i++) {
                // 每次循环开始时检查是否已停止
                if (!this.isRunning) {
                    logger.info('⏹️ 工作流已停止，退出循环');
                    break;
                }

                this.currentIndex = i;
                const imagePath = this.imageFiles[i];
                const imageName = path.basename(imagePath);

                // 更新状态（阶段10）
                this.updateStatus({
                    phase: 'processing_image',
                    currentImageIndex: i + 1,
                    totalImages: this.totalImages,
                    currentImageName: imageName,
                    currentPromptIndex: 0,
                    totalPrompts: 0,
                    currentAction: `正在处理第 ${i + 1}/${this.totalImages} 张参考图: ${imageName}`
                });

                logger.info('');
                logger.info('========================================');
                logger.info(`📷 正在处理第 ${i + 1}/${this.totalImages} 张参考图`);
                logger.info(`文件名: ${imageName}`);
                logger.info('========================================');

                try {
                    // 处理单张参考图（传入当前索引和总数，用于显示进度）
                    const processOptions = resumeSnapshot && i === startImageIndex
                        ? {
                            startPromptIndex: Number(resumeSnapshot.promptIndex) || 0,
                            prompts: Array.isArray(resumeSnapshot.prompts) ? resumeSnapshot.prompts : [],
                            headless: this.headless
                        }
                        : { headless: this.headless };
                    await this.processSingleImage(imagePath, i + 1, this.totalImages, processOptions);
                    this.stats.processed++;

                    // 如果不是最后一张，短暂等待后继续下一张参考图。
                    // 豆包已改为 API 调用，不再需要打开网页或新建对话。
                    if (i < this.totalImages - 1 && this.isRunning) {
                        this.updateStatus({
                            currentAction: `等待冷却时间，准备处理下一张参考图...`
                        });
                        logger.info('');
                        logger.info('⏳ 准备处理下一张参考图...');
                        logger.info('⏸️ 等待5秒后继续下一张...');
                        await this.sleep(5000);
                        if (!this.isRunning) break;
                    }

                } catch (error) {
                    const imageName = path.basename(imagePath);
                    const errorMessage = error && error.message ? error.message : String(error);

                    if (this.isAbortRequested() || errorMessage.includes('取消') || errorMessage.includes('停止')) {
                        logger.info('⏹️ 工作流已停止，退出当前图片处理');
                        break;
                    }

                    const isTimeout = errorMessage.includes('超时');

                    if (isTimeout) {
                        logger.error(`❌ 图片处理超时: ${imageName}`);
                        logger.error(`   原因: ${errorMessage}`);
                        logger.error(`   该图片将被记录到失败日志，继续处理下一张...`);
                    } else {
                        logger.error(`❌ 处理失败: ${errorMessage}`);
                    }

                    this.updateStatus({
                        phase: 'error',
                        currentAction: `处理失败: ${errorMessage}`,
                        error: errorMessage
                    });
                    this.stats.failed++;

                    // 尝试恢复：API 模式下无需新开豆包对话，短暂等待后继续下一张。
                    if (i < this.totalImages - 1 && this.isRunning) {
                        logger.info('⏸️ 等待10秒后继续下一张参考图...');
                        await this.sleep(10000);
                        if (!this.isRunning) break;
                    }
                }
            }

            const stopped = this.abortController && this.abortController.signal.aborted;
            if (stopped || !this.isRunning) {
                this.isRunning = false;
                this.updateStatus({
                    phase: 'stopped',
                    currentAction: '工作流已停止'
                });
                logger.info('⏹️ 工作流已停止');
                return {
                    success: false,
                    message: '工作流已停止',
                    stats: this.stats,
                    totalImages: this.totalImages
                };
            }

            // 第3步：完成总结
            this.isRunning = false;
            this.clearResume();
            const finalPromptTotal = Math.max(0, Number(this.currentStatus.totalPrompts) || 0);
            this.updateStatus({
                phase: 'completed',
                currentAction: '工作流已完成',
                currentPromptIndex: finalPromptTotal,
                totalPrompts: finalPromptTotal
            });

            logger.info('');
            logger.info('========================================');
            logger.info('✅ 完整工作流执行完毕！');
            logger.info('========================================');
            logger.info(`处理结果:`);
            logger.info(`  - 成功: ${this.stats.processed} 张`);
            logger.info(`  - 失败: ${this.stats.failed} 张`);
            logger.info(`  - 共生成: ${this.stats.totalGenerated} 张图片`);
            logger.info('========================================');

            return {
                success: true,
                message: '工作流执行完毕',
                stats: this.stats,
                totalImages: this.totalImages
            };

        } catch (error) {
            this.isRunning = false;
            const errorMessage = error && error.message ? error.message : String(error);
            this.updateStatus({
                phase: 'error',
                currentAction: `工作流执行失败: ${errorMessage}`,
                error: errorMessage
            });
            logger.error(`❌ 工作流执行失败: ${errorMessage}`);
            return {
                success: false,
                message: errorMessage,
                stats: this.stats
            };
        } finally {
            this.abortController = null;
        }
    }

    /**
     * =====================================================
     * 处理单张参考图
     * =====================================================
     * 流程：
     * 1. 调用提示词模型 API 获取多组提示词
     * 2. 每组提示词在Legil生成图片
     * 3. 本轮结束
     */
    async processSingleImage(imagePath, imageIndex, totalImages, options = {}) {
        const imageName = path.basename(imagePath);
        const referenceOutputNameBase = this.buildOutputNameBaseForReferenceImage(imageName);
        const startPromptIndex = Math.max(0, Math.floor(Number(options.startPromptIndex) || 0));
        const cachedPrompts = this.normalizeWorkflowPromptItems(options.prompts);
        if (referenceOutputNameBase) {
            logger.info(`Reference output name base: ${referenceOutputNameBase}`);
        }

        logger.info('');
        logger.info('╔════════════════════════════════════════════════════════════╗');
        logger.info(`║ 📷 参考图 ${imageIndex}/${totalImages}: ${imageName}`);
        logger.info('╠════════════════════════════════════════════════════════════╣');
        logger.info(cachedPrompts.length > 0
            ? `║ [步骤1] 使用停止前缓存的 ${cachedPrompts.length} 组提示词继续...`
            : '║ [步骤1] 提示词模型：读取参考图并获取提示词...');
        logger.info('╚════════════════════════════════════════════════════════════╝');

        let promptItems = cachedPrompts;

        if (promptItems.length === 0) {
            const publicPromptConfig = promptGenerationService.getPublicConfig(this.promptGenerationConfig);
            const providerLabel = `Lumos Winky / ${publicPromptConfig.lumos.model || '未填写模型'}`;

            // 更新状态 - 正在通过提示词模型生成提示词。
            this.updateStatus({
                phase: 'extracting_prompts',
                currentAction: `正在调用${providerLabel}生成提示词: ${imageName}`,
                promptProvider: publicPromptConfig.provider,
                promptModel: publicPromptConfig.lumos.model
            });
            logger.info(`提示词生成模型: ${providerLabel}`);

            const promptResult = await promptGenerationService.generatePromptsFromImage(imagePath, this.promptGenerationConfig, {
                imageIndex,
                totalImages,
                ...this.getCancellationOptions()
            });

            if (!promptResult.success || !Array.isArray(promptResult.prompts) || promptResult.prompts.length === 0) {
                throw new Error(promptResult.message || '提示词模型生成失败');
            }

            promptItems = this.normalizeWorkflowPromptItems(promptResult.prompts);
        } else {
            logger.info(`✅ 已加载停止前缓存的 ${promptItems.length} 组提示词`);
        }

        if (promptItems.length === 0) {
            logger.error('提取提示词失败: 提示词模型未返回有效提示词');
            throw new Error('提示词模型生成失败');
        }

        promptItems = promptItems.map(item => {
            const promptTitleName = this.buildPromptTitleForFile(
                item.title || item.promptTitle || item.name || item.prompt
            );
            const outputNameBase = this.buildWorkflowOutputNameBase(referenceOutputNameBase, item, promptTitleName);
            return {
                ...item,
                promptTitle: item.promptTitle || item.title || promptTitleName,
                promptTitleName,
                outputNameBase
            };
        });

        const totalPrompts = promptItems.length;
        const effectiveStartPromptIndex = Math.min(startPromptIndex, totalPrompts);

        logger.info(`✅ 成功获取 ${promptItems.length} 组提示词`);

        // 保存提示词到内存，供前端查看
        this.lastExtractedPrompts = promptItems.map(item => item.prompt);
        this.currentImagePath = imagePath;
        this.currentImagePrompts = promptItems.map(item => ({ ...item }));
        this.nextResumeImageIndex = imageIndex - 1;
        this.nextResumePromptIndex = effectiveStartPromptIndex;
        logger.info('💾 提示词已缓存，可通过API获取');
        try {
            const promptSaveResult = this.saveExtractedPromptsForImage(promptItems, imagePath, imageIndex, totalImages);
            if (promptSaveResult && promptSaveResult.textPath) {
                logger.info(`💾 提示词已保存到本地: ${path.relative(this.outputFolder, promptSaveResult.textPath)}`);
            }
        } catch (promptSaveError) {
            logger.warn(`提示词本地保存失败: ${promptSaveError.message}`);
        }

        // 更新状态 - 正在提取提示词
        this.updateStatus({
            phase: 'extracting_prompts',
            currentPromptIndex: effectiveStartPromptIndex,
            totalPrompts,
            currentAction: `已提取 ${promptItems.length} 组提示词`
        });

        // 步骤2：Legil生成 - 每组提示词生成1张图片
        logger.info('');
        logger.info('╔════════════════════════════════════════════════════════════╗');
        logger.info(`║ [步骤2] Legil：每组提示词生成1张图片（共 ${totalPrompts} 组）`);
        logger.info('╚════════════════════════════════════════════════════════════╝');

        if (effectiveStartPromptIndex > 0 && effectiveStartPromptIndex < totalPrompts) {
            logger.info(`↩️ 继续上次任务：从第 ${effectiveStartPromptIndex + 1}/${totalPrompts} 组提示词开始`);
        }

        for (let i = effectiveStartPromptIndex; i < promptItems.length; i++) {
            const promptData = promptItems[i];
            const promptText = promptData.prompt;
            const promptTitleName = promptData.promptTitleName || promptData.promptTitle || this.buildPromptTitleForFile(promptText);
            const outputNameBase = this.buildWorkflowOutputNameBase(referenceOutputNameBase, promptData, promptTitleName);

            if (!promptText || typeof promptText !== 'string') {
                logger.warn(`提示词 ${i + 1}/${totalPrompts} 为空，跳过`);
                continue;
            }

            this.nextResumeImageIndex = imageIndex - 1;
            this.nextResumePromptIndex = i;

            // 更新状态 - 正在Legil生成图片
            this.updateStatus({
                phase: 'generating_in_legil',
                currentPromptIndex: i + 1,
                totalPrompts,
                currentAction: `正在Legil生成第 ${i + 1}/${totalPrompts} 组提示词`
            });

            logger.info('');
            logger.info(`┌────────────────────────────────────────────────────────────┐`);
            logger.info(`│ 🎨 提示词 ${i + 1}/${totalPrompts}`);
            logger.info(`├────────────────────────────────────────────────────────────┤`);
            logger.info(`│ ${promptText.substring(0, 50)}...`);
            logger.info(`└────────────────────────────────────────────────────────────┘`);

            const legilOutputQuantity = Number(this.generationSettings.outputQuantity) || 1;
            const nextOutputSequence = this.stats.totalGenerated + 1;
            const legilResult = await legilAutomation.generateImage(promptText, i + 1, {
                saveFolder: this.outputFolder,
                referenceFolder: this.legilReferenceFolder,
                headless: options.headless === true || this.headless === true,
                generationSettings: this.generationSettings,
                outputSequence: nextOutputSequence,
                outputTotal: totalImages * promptItems.length * legilOutputQuantity,
                runId: this.currentRunId,
                referenceImageIndex: imageIndex,
                totalReferenceImages: totalImages,
                referenceImageName: imageName,
                outputNameBase,
                promptTitleName,
                promptIndexWithinImage: i + 1,
                totalPromptsForImage: promptItems.length,
                taskType: '量产工作流',
                acceptStablePartialOutputs: true,
                autoRecoveryEnabled: this.autoRecoveryEnabled,
                captureErrorScreenshot: this.captureErrorScreenshot,
                ...this.getCancellationOptions()
            });

            if (legilResult.success) {
                this.consecutiveLegilFailures = 0;
                const savedCount = Number(legilResult.savedCount) || 1;
                const resultSavePaths = Array.isArray(legilResult.savePaths)
                    ? legilResult.savePaths
                    : (legilResult.savePath ? [legilResult.savePath] : []);
                try {
                    const promptFilePath = this.savePromptTextFileForPromptGroup(resultSavePaths, {
                        ...promptData,
                        prompt: promptText,
                        promptTitle: promptData.promptTitle || promptData.title || promptTitleName,
                        outputNameBase
                    }, {
                        savedAt: new Date().toISOString(),
                        runId: this.currentRunId,
                        displayIndex: i + 1,
                        totalPrompts,
                        promptTitleName,
                        referenceImageName: imageName,
                        referenceImageIndex: imageIndex,
                        totalReferenceImages: totalImages
                    });
                    if (promptFilePath) {
                        logger.info(`Prompt text saved: ${path.basename(promptFilePath)}`);
                    }
                } catch (promptFileError) {
                    logger.warn(`Prompt text save failed: ${promptFileError.message}`);
                }
                this.stats.totalGenerated += savedCount;
                this.nextResumePromptIndex = i + 1;
                if (this.nextResumePromptIndex >= promptItems.length) {
                    this.nextResumeImageIndex = imageIndex;
                    this.nextResumePromptIndex = 0;
                }
                logger.info(`✅ 提示词 ${i + 1}/${totalPrompts} 生成成功，保存 ${savedCount} 张图片`);
                // 更新状态 - 图片已保存
                this.updateStatus({
                    totalPrompts,
                    currentAction: `第 ${i + 1}/${totalPrompts} 组已保存 ${savedCount} 张图片`
                });
            } else {
                if (this.isAbortRequested()) {
                    logger.info('⏹️ 工作流已停止，中断 Legil 生成循环');
                    break;
                }
                logger.error(`❌ 提示词 ${i + 1}/${totalPrompts} 生成失败: ${legilResult.message}`);
                this.consecutiveLegilFailures += 1;
                if (this.pauseOnConsecutiveFailures && this.consecutiveLegilFailures >= this.consecutiveFailureThreshold) {
                    this.resumeSnapshot = this.buildResumeSnapshot();
                    this.updateStatus({
                        phase: 'stopped',
                        currentAction: `Legil 连续失败 ${this.consecutiveLegilFailures} 次，工作流已暂停等待确认`,
                        error: legilResult.message
                    });
                    logger.warn(`Legil 连续失败 ${this.consecutiveLegilFailures} 次，工作流已暂停等待确认。`);
                    this.isRunning = false;
                    throw new Error(`Legil 连续失败 ${this.consecutiveLegilFailures} 次，工作流已暂停等待确认`);
                }
            }

            // 每张图片之间等待5秒
            if (i < promptItems.length - 1 && this.isRunning) {
                logger.info('⏳ 等待5秒后继续下一张...');
                await this.sleep(5000);
            }
        }

        if (this.isAbortRequested()) {
            throw new Error('工作流已停止');
        }

        logger.info('');
        logger.info('╔════════════════════════════════════════════════════════════╗');
        logger.info(`║ ✅ 参考图 ${imageIndex}/${totalImages} 处理完毕！`);
        logger.info(`║    已处理 ${totalPrompts} 组提示词，准备下一张...`);
        logger.info('╚════════════════════════════════════════════════════════════╝');
    }

    /**
     * =====================================================
     * 获取文件夹中的所有图片文件
     * =====================================================
     */
    getImageFiles(folderPath) {
        if (!fs.existsSync(folderPath)) {
            throw new Error('输入文件夹不存在');
        }

        const files = fs.readdirSync(folderPath);
        const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif'];

        return sortNaturallyByName(files)
            .filter(file => {
                const ext = path.extname(file).toLowerCase();
                return imageExtensions.includes(ext);
            })
            .map(file => path.join(folderPath, file));
    }

    /**
     * =====================================================
     * 获取当前工作流状态
     * =====================================================
     */
    getStatus() {
        const completed = this.currentStatus.phase === 'completed';
        const progress = this.totalImages > 0
            ? (completed ? 100 : Math.min(99, Math.round((this.stats.processed / this.totalImages) * 100)))
            : 0;

        return {
            runId: this.currentRunId,
            isRunning: this.isRunning,
            currentIndex: this.currentIndex,
            totalImages: this.totalImages,
            currentImage: this.imageFiles[this.currentIndex] || null,
            browserMode: this.browserMode,
            promptGeneration: promptGenerationService.getPublicConfig(this.promptGenerationConfig),
            stats: this.stats,
            progress,
            lastExtractedPrompts: this.lastExtractedPrompts || null,
            // 阶段10新增：详细状态
            currentStatus: this.currentStatus
        };
    }

    /**
     * =====================================================
     * 获取最近一次提取的提示词
     * =====================================================
     */
    getLastExtractedPrompts() {
        return this.lastExtractedPrompts || null;
    }

    /**
     * =====================================================
     * 停止工作流（强制中断）
     * =====================================================
     */
    async stopWorkflow() {
        if (this.isRunning) {
            this.resumeSnapshot = this.buildResumeSnapshot();
            this.isRunning = false;
            // 触发 abort 信号以中断正在进行的操作
            if (this.abortController) {
                this.abortController.abort();
                this.abortController = null;
            }
            this.updateStatus({
                phase: 'stopped',
                currentAction: '工作流已停止'
            });
            logger.info('⏹️ 工作流已停止');
            if (this.resumeSnapshot) {
                const info = this.getResumeInfo();
                logger.info(`已保存可继续任务：第 ${info.imageIndex}/${info.totalImages} 张参考图，提示词 ${info.promptIndex}/${info.totalPrompts}`);
            }
            return { success: true, message: '工作流已停止' };
        }
        return { success: false, message: '工作流未运行' };
    }

    async resumeWorkflow(options = {}) {
        if (this.isRunning) {
            return {
                success: false,
                message: '工作流正在运行中，请勿重复启动'
            };
        }

        const snapshot = this.resumeSnapshot;
        if (!snapshot || !Array.isArray(snapshot.imageFiles) || snapshot.imageIndex >= snapshot.imageFiles.length) {
            return {
                success: false,
                message: '没有可继续的上次任务'
            };
        }

        logger.info('↩️ 准备继续上次停止的工作流...');
        return this.startWorkflow(
            snapshot.inputFolder,
            snapshot.outputFolder,
            snapshot.legilReferenceFolder,
            {
                ...options,
                resumeSnapshot: snapshot
            }
        );
    }

    /**
     * =====================================================
     * 重置工作流状态
     * =====================================================
     */
    resetStatus() {
        this.currentStatus = {
            phase: 'idle',
            currentImageIndex: 0,
            totalImages: 0,
            currentImageName: '',
            currentPromptIndex: 0,
            totalPrompts: 0,
            currentAction: '',
            error: null
        };
    }

    /**
     * =====================================================
     * 可中断的 sleep
     * =====================================================
     */
    async sleep(ms) {
        if (!this.isRunning) return;
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                cleanup();
                resolve();
            }, ms);

            const checkInterval = setInterval(() => {
                if (!this.isRunning) {
                    cleanup();
                    reject(new Error('工作流已停止'));
                }
            }, 100);

            function cleanup() {
                clearTimeout(timeout);
                clearInterval(checkInterval);
            }
        }).catch(() => {}); // 忽略停止时的错误
    }
}

// 导出单例实例
module.exports = new WorkflowController();
