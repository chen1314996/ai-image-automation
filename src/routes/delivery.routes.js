const {
    createDeliveryPostprocessStore,
    DELIVERY_TARGET_ASPECT_RATIOS
} = require('../services/delivery-postprocess/store');
const {
    normalizeDeliveryCandidateCount,
    normalizeDeliveryPromptTemplates,
    buildDeliveryPrompt
} = require('../services/delivery-postprocess/candidate-config');
const {
    DEFAULT_MAX_OUTPUT_BYTES,
    DEFAULT_MAX_OUTPUT_KB,
    DEFAULT_MIN_JPEG_QUALITY,
    buildStandardizedOutputPath,
    standardizeImageToTarget
} = require('../services/delivery-postprocess/standardize');
const {
    finalizeDeliveryRun
} = require('../services/delivery-postprocess/finalize');

function pickScanPayload(body = {}) {
    const source = body && typeof body === 'object' ? body : {};
    const namingRule = source.namingRule && typeof source.namingRule === 'object' ? source.namingRule : {};
    return {
        inputFolder: source.inputFolder,
        outputFolder: source.outputFolder,
        logoTemplateFolder: source.logoTemplateFolder || source.logoFolder,
        processMode: source.processMode,
        targetSizes: Array.isArray(source.targetSizes) ? source.targetSizes : [],
        candidateCountPerSize: source.candidateCountPerSize,
        candidateCountsBySize: source.candidateCountsBySize && typeof source.candidateCountsBySize === 'object'
            ? source.candidateCountsBySize
            : {},
        promptTemplates: source.promptTemplates,
        namingRule: {
            fixedPrefix: namingRule.fixedPrefix || namingRule.prefix || source.fixedPrefix || source.prefix,
            startNumber: namingRule.startNumber || source.startNumber,
            regionText: namingRule.regionText || namingRule.region || source.regionText || source.region,
            channelText: namingRule.channelText || namingRule.channel || source.channelText || source.channel,
            primaryTag: namingRule.primaryTag || namingRule.primary || source.primaryTag || source.primary,
            secondaryTag: namingRule.secondaryTag || namingRule.secondary || source.secondaryTag || source.secondary,
            tertiaryTag: namingRule.tertiaryTag || namingRule.tertiary || source.tertiaryTag || source.tertiary,
            tagLevels: Array.isArray(namingRule.tagLevels) ? namingRule.tagLevels : source.tagLevels
        }
    };
}

function publicRun(run) {
    if (!run) {
        return null;
    }
    return {
        runId: run.runId,
        status: run.status,
        inputFolder: run.inputFolder,
        outputFolder: run.outputFolder,
        logoTemplateFolder: run.logoTemplateFolder || '',
        finalPackageRoot: run.finalPackageRoot || '',
        processMode: run.processMode,
        targetSizes: run.targetSizes,
        candidateCountPerSize: run.candidateCountPerSize,
        candidateCountsBySize: run.candidateCountsBySize,
        promptTemplates: run.promptTemplates,
        namingRule: run.namingRule,
        totalJobs: run.totalJobs,
        completedJobs: run.completedJobs,
        failedJobs: run.failedJobs,
        currentJobIndex: run.currentJobIndex,
        jobs: Array.isArray(run.jobs) ? run.jobs : [],
        scan: run.scan,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt
    };
}

function normalizeBrowserMode(value) {
    return value === 'headed' ? 'headed' : 'headless';
}

function isTargetReady(target, candidateCount) {
    const status = String(target && target.status || '');
    const candidates = Array.isArray(target && target.candidates) ? target.candidates : [];
    return candidates.length >= candidateCount &&
        ['candidates_ready', 'candidate_selected', 'standardized', 'logo_applied', 'finalized'].includes(status);
}

function targetNeedsGeneration(target, candidateCount, force = false) {
    if (force) {
        return true;
    }
    if (!target) {
        return true;
    }
    if (isTargetReady(target, candidateCount)) {
        return false;
    }
    const status = String(target.status || 'pending');
    return ['pending', 'failed', 'generating'].includes(status) ||
        !Array.isArray(target.candidates) ||
        target.candidates.length < candidateCount;
}

function getCandidateCountForTarget(run, target, size, options = {}) {
    const optionCounts = options.candidateCountsBySize && typeof options.candidateCountsBySize === 'object'
        ? options.candidateCountsBySize
        : {};
    const runCounts = run && run.candidateCountsBySize && typeof run.candidateCountsBySize === 'object'
        ? run.candidateCountsBySize
        : {};
    return normalizeDeliveryCandidateCount(
        optionCounts[size] ||
        runCounts[size] ||
        options.candidateCountPerSize ||
        options.candidateCount ||
        options.outputQuantity ||
        target && target.candidateCount ||
        run && run.candidateCountPerSize
    );
}

function collectRunnableTargets(run, options = {}) {
    const jobs = Array.isArray(run && run.jobs) ? run.jobs : [];
    const targetSizes = Array.isArray(run && run.targetSizes) && run.targetSizes.length
        ? run.targetSizes
        : Object.keys(DELIVERY_TARGET_ASPECT_RATIOS);
    const onlyJobId = String(options.jobId || '').trim();
    const onlyTargetSize = String(options.targetSize || options.size || '').trim();
    const force = options.force === true;
    const requestedCandidateCount = options.candidateCountPerSize || options.candidateCount || options.outputQuantity;
    const tasks = [];

    jobs.forEach((job, jobIndex) => {
        if (onlyJobId && job.jobId !== onlyJobId) {
            return;
        }
        targetSizes.forEach((size, sizeIndex) => {
            if (onlyTargetSize && size !== onlyTargetSize) {
                return;
            }
            const target = job.targets && job.targets[size] ? job.targets[size] : null;
            const candidateCount = getCandidateCountForTarget(run, target, size, {
                ...options,
                candidateCountPerSize: requestedCandidateCount || options.candidateCountPerSize
            });
            if (!targetNeedsGeneration(target, candidateCount, force)) {
                return;
            }
            tasks.push({
                job,
                jobIndex,
                size,
                sizeIndex,
                target,
                candidateCount,
                aspectRatio: DELIVERY_TARGET_ASPECT_RATIOS[size]
            });
        });
    });

    return tasks;
}

function updateJobStatus(job, targetSizes) {
    const targets = job && job.targets ? job.targets : {};
    const statuses = targetSizes.map(size => String(targets[size] && targets[size].status || 'pending'));
    if (statuses.every(status => ['candidates_ready', 'candidate_selected', 'standardized', 'logo_applied', 'finalized'].includes(status))) {
        job.status = 'candidates_ready';
    } else if (statuses.some(status => status === 'failed')) {
        job.status = 'failed';
    } else if (statuses.some(status => status === 'generating')) {
        job.status = 'generating';
    } else {
        job.status = 'pending';
    }
    job.updatedAt = new Date().toISOString();
}

function updateRunStatusFromTargets(run, fallbackStatus = '') {
    const jobs = Array.isArray(run.jobs) ? run.jobs : [];
    const targetSizes = Array.isArray(run.targetSizes) && run.targetSizes.length
        ? run.targetSizes
        : Object.keys(DELIVERY_TARGET_ASPECT_RATIOS);
    jobs.forEach(job => updateJobStatus(job, targetSizes));

    const statuses = [];
    jobs.forEach(job => {
        targetSizes.forEach(size => {
            statuses.push(String(job.targets && job.targets[size] && job.targets[size].status || 'pending'));
        });
    });

    if (fallbackStatus) {
        run.status = fallbackStatus;
    } else if (statuses.length && statuses.every(status => ['candidates_ready', 'candidate_selected', 'standardized', 'logo_applied', 'finalized'].includes(status))) {
        run.status = 'waiting_selection';
    } else if (statuses.some(status => status === 'failed')) {
        run.status = 'failed';
    } else if (statuses.some(status => status === 'generating')) {
        run.status = 'running';
    } else {
        run.status = 'scanned';
    }
}

function buildCandidateOutputFolder(path, run, job, targetSize) {
    return path.join(
        run.outputFolder,
        run.runId,
        'stage-ai',
        job.folderName || job.baseName || job.jobId,
        targetSize
    );
}

function buildCandidateRecords({ savePaths, job, targetSize, aspectRatio }) {
    const now = new Date().toISOString();
    return (Array.isArray(savePaths) ? savePaths : []).map((filePath, index) => ({
        candidateId: `cand_${job.jobId}_${targetSize}_${String(index + 1).padStart(2, '0')}`,
        filePath,
        fileName: String(filePath || '').split(/[\\/]/).pop() || '',
        targetSize,
        aspectRatio,
        selected: false,
        source: 'legil',
        generatedAt: now
    }));
}

function isCandidateReadyStatus(status) {
    return ['candidates_ready', 'candidate_selected', 'standardized', 'logo_applied', 'finalized'].includes(String(status || ''));
}

function validateAllTargetsSelected(job, targetSizes) {
    const missing = [];
    targetSizes.forEach(size => {
        const target = job && job.targets ? job.targets[size] : null;
        if (!target || !target.selectedCandidateId) {
            missing.push(size);
        }
    });
    return {
        ok: missing.length === 0,
        missing
    };
}

function findCandidate(target, candidateId) {
    const candidates = Array.isArray(target && target.candidates) ? target.candidates : [];
    return candidates.find(candidate => candidate && candidate.candidateId === candidateId) || null;
}

function getTargetCandidates(target) {
    return Array.isArray(target && target.candidates)
        ? target.candidates.filter(candidate => candidate && candidate.filePath)
        : [];
}

function hasStandardizedCandidates(target) {
    return Boolean(
        target &&
        (
            (Array.isArray(target.standardizedCandidates) && target.standardizedCandidates.length) ||
            target.standardizedPath
        )
    );
}

function shouldCompleteFullDelivery(run, options = {}) {
    const processMode = String(options.processMode || run && run.processMode || 'full-delivery');
    return processMode !== 'legil-only' &&
        !String(options.jobId || '').trim() &&
        !String(options.targetSize || options.size || '').trim();
}

module.exports = function registerDeliveryRoutes(app, context) {
    const {
        rootDir,
        logger,
        fs,
        path,
        appConfig,
        automationState,
        legilAutomation,
        normalizeLegilGenerationSettings,
        isLegilBusy,
        sleepWithLegilStop,
        isLegilStopRequested,
        notifyLegilResult
    } = context;
    const store = createDeliveryPostprocessStore({ rootDir });
    const deliveryTask = {
        running: false,
        stopRequested: false,
        runId: ''
    };

    function getRunFromRequest(source = {}) {
        const runId = String(source.runId || '').trim();
        if (runId) {
            return store.readRun(runId);
        }
        return store.getLatestRun(source.inputFolder);
    }

    function getDeliveryGenerationSettings(body = {}, targetSize = '') {
        const fallbackSettings = appConfig.resize && appConfig.resize.generationSettings
            ? appConfig.resize.generationSettings
            : legilAutomation.getConfig().settings;
        const normalized = normalizeLegilGenerationSettings(
            body.generationSettings && typeof body.generationSettings === 'object'
                ? body.generationSettings
                : fallbackSettings,
            fallbackSettings
        );
        const aspectRatio = DELIVERY_TARGET_ASPECT_RATIOS[targetSize] || normalized.aspectRatio;
        return {
            ...normalized,
            aspectRatio,
            outputQuantity: normalizeDeliveryCandidateCount(body.candidateCountPerSize || normalized.outputQuantity)
        };
    }

    async function standardizeDeliveryRun(runId, body = {}) {
        const run = store.readRun(runId);
        if (!run) {
            throw new Error('未找到三尺寸交付 run');
        }
        const targetSizes = Array.isArray(run.targetSizes) && run.targetSizes.length
            ? run.targetSizes
            : Object.keys(DELIVERY_TARGET_ASPECT_RATIOS);
        const onlyJobId = String(body.jobId || '').trim();
        const jobs = (Array.isArray(run.jobs) ? run.jobs : []).filter(job => !onlyJobId || job.jobId === onlyJobId);
        if (jobs.length === 0) {
            throw new Error('未找到要标准化的 job');
        }

        const maxOutputBytes = Number(body.maxOutputBytes) > 0
            ? Number(body.maxOutputBytes)
            : DEFAULT_MAX_OUTPUT_BYTES;
        const minQuality = Number(body.minQuality) > 0
            ? Number(body.minQuality)
            : DEFAULT_MIN_JPEG_QUALITY;
        const standardized = [];
        const failed = [];

        for (const job of jobs) {
            for (const targetSize of targetSizes) {
                const target = job.targets[targetSize];
                const candidates = getTargetCandidates(target);
                if (!candidates.length) {
                    failed.push({
                        jobId: job.jobId,
                        targetSize,
                        reason: '该尺寸还没有候选图'
                    });
                    continue;
                }

                const standardizedCandidates = [];
                const targetFailures = [];
                const candidateCount = candidates.length;

                for (let index = 0; index < candidates.length; index++) {
                    const candidate = candidates[index];
                    const candidateIndex = index + 1;
                    const outputPath = buildStandardizedOutputPath({
                        outputFolder: run.outputFolder,
                        runId: run.runId,
                        folderName: job.folderName,
                        baseName: job.baseName,
                        targetSize,
                        candidateIndex,
                        candidateCount
                    });

                    try {
                        const result = await standardizeImageToTarget(candidate.filePath, outputPath, targetSize, {
                            maxOutputBytes,
                            minQuality
                        });
                        const standardizedItem = {
                            candidateId: candidate.candidateId || `candidate_${candidateIndex}`,
                            candidateIndex,
                            candidateCount,
                            outputPath: result.outputPath,
                            quality: result.quality,
                            sizeBytes: result.sizeBytes,
                            sizeKb: result.sizeKb,
                            dimensions: result.outputDimensions,
                            maxOutputKb: result.maxOutputKb,
                            minQuality: result.minQuality,
                            standardizedAt: new Date().toISOString()
                        };
                        standardizedCandidates.push(standardizedItem);
                        standardized.push({
                            jobId: job.jobId,
                            baseName: job.baseName,
                            targetSize,
                            candidateId: standardizedItem.candidateId,
                            candidateIndex,
                            candidateCount,
                            ...result
                        });
                    } catch (error) {
                        const failure = {
                            jobId: job.jobId,
                            baseName: job.baseName,
                            targetSize,
                            candidateId: candidate.candidateId || `candidate_${candidateIndex}`,
                            candidateIndex,
                            candidateCount,
                            reason: error.message
                        };
                        targetFailures.push(failure);
                        failed.push(failure);
                    }
                }

                target.standardizedCandidates = standardizedCandidates;
                target.standardizedPath = standardizedCandidates[0]?.outputPath || '';
                target.status = targetFailures.length ? 'failed' : 'standardized';
                target.error = targetFailures.length
                    ? `标准化失败：${targetFailures.map(item => item.reason).join('；')}`
                    : '';
                target.standardized = standardizedCandidates[0] || null;
                target.updatedAt = new Date().toISOString();
            }
            const allStandardized = targetSizes.every(size => job.targets[size] && hasStandardizedCandidates(job.targets[size]));
            job.postprocess = {
                ...(job.postprocess || {}),
                standardized: allStandardized
            };
            updateJobStatus(job, run.targetSizes);
        }

        updateRunStatusFromTargets(run, failed.length ? 'failed' : '');
        store.saveRun(run);
        logger.info(`S10.5 标准化完成：成功 ${standardized.length} 张，失败 ${failed.length} 张`);

        return {
            success: failed.length === 0,
            run,
            standardized,
            failed,
            standardizedCount: standardized.length,
            failedCount: failed.length,
            maxOutputKb: Math.round(maxOutputBytes / 1024) || DEFAULT_MAX_OUTPUT_KB,
            minQuality,
            message: failed.length
                ? `标准化完成但有 ${failed.length} 张失败`
                : `已标准化 ${standardized.length} 张 JPG，尺寸精确且小于 ${Math.round(maxOutputBytes / 1024) || DEFAULT_MAX_OUTPUT_KB}KB`
        };
    }

    async function finalizeDeliveryRunById(runId, body = {}) {
        const run = store.readRun(runId);
        if (!run) {
            throw new Error('未找到三尺寸交付 run');
        }
        const targetSizes = Array.isArray(run.targetSizes) && run.targetSizes.length
            ? run.targetSizes
            : Object.keys(DELIVERY_TARGET_ASPECT_RATIOS);
        const notStandardized = [];
        (Array.isArray(run.jobs) ? run.jobs : []).forEach(job => {
            targetSizes.forEach(size => {
                const target = job.targets && job.targets[size];
                if (!hasStandardizedCandidates(target)) {
                    notStandardized.push(`${job.baseName || job.jobId} / ${size}`);
                }
            });
        });
        if (notStandardized.length) {
            const error = new Error(`请先执行标准化，再生成最终交付包。未标准化：${notStandardized.join('；')}`);
            error.missing = notStandardized;
            throw error;
        }

        const result = await finalizeDeliveryRun(run, {
            logoTemplateFolder: body && (body.logoTemplateFolder || body.logoFolder),
            namingRule: body && body.namingRule,
            maxOutputBytes: body && body.maxOutputBytes,
            minQuality: body && body.minQuality
        });
        store.saveRun(result.run);
        logger.system('S10 三尺寸最终交付包已生成');
        logger.info(`LOGO 模板目录: ${result.logoTemplateFolder}`);
        logger.info(`最终交付目录: ${result.finalPackageRoot}`);
        logger.info(`最终输出 ${result.finalizedCount} 张，失败 ${result.failedCount} 张`);
        return result;
    }

    async function runDeliveryCandidates(runId, options = {}) {
        let run = store.readRun(runId);
        if (!run) {
            throw new Error('未找到三尺寸交付 run');
        }
        store.applyTargetConfig(run, options);

        const promptTemplates = normalizeDeliveryPromptTemplates({
            ...(run.promptTemplates || {}),
            ...(options.promptTemplates || {})
        });
        run.promptTemplates = promptTemplates;
        run.candidateCountPerSize = normalizeDeliveryCandidateCount(options.candidateCountPerSize || run.candidateCountPerSize);

        const tasks = collectRunnableTargets(run, options);
        const completeDelivery = options.completeDelivery === true;
        const postprocessOnly = completeDelivery && tasks.length === 0;
        if (tasks.length === 0 && !postprocessOnly) {
            updateRunStatusFromTargets(run);
            store.saveRun(run);
            logger.info(`S10.3 三尺寸交付没有需要补跑的 target：${run.runId}`);
            return {
                success: true,
                message: '没有缺失或失败的 target 需要生成',
                generatedTargets: 0,
                failedTargets: 0
            };
        }

        const previousSaveFolder = legilAutomation.saveFolder;
        const previousReferenceFolder = legilAutomation.referenceFolder;
        const previousReferenceImages = Array.isArray(legilAutomation.referenceImages)
            ? [...legilAutomation.referenceImages]
            : [];
        const previousRefIndex = legilAutomation.currentRefIndex;
        const previousGenerationSettings = {
            ...legilAutomation.getConfig().settings
        };

        const browserMode = normalizeBrowserMode(options.browserMode || appConfig.resize && appConfig.resize.browserMode);
        const headless = browserMode === 'headless';
        const outputTotal = tasks.reduce((sum, task) => sum + task.candidateCount, 0);
        let outputSequence = 1;
        let generatedTargets = 0;
        let failedTargets = 0;
        let savedTotal = 0;
        let stopped = false;
        let interruptedMessage = '';
        const shouldAbort = () => deliveryTask.stopRequested === true ||
            (typeof isLegilStopRequested === 'function' && isLegilStopRequested());

        deliveryTask.running = true;
        deliveryTask.stopRequested = false;
        deliveryTask.runId = run.runId;
        automationState.legilTaskRunning = true;
        automationState.legilStopRequested = false;
        automationState.legilTaskType = 'delivery-candidates';
        automationState.legilTaskProgress = {
            taskType: 'delivery-candidates',
            phase: 'running',
            total: tasks.length,
            completed: 0,
            success: 0,
            failed: 0,
            saved: 0,
            outputTotal,
            browserMode,
            currentName: '',
            currentAction: 'S10.3 三尺寸候选生成已开始',
            startedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        run.status = 'running';
        store.saveRun(run);

        logger.system('========================================');
        logger.system(completeDelivery ? '开始完整改尺寸交付' : '开始 S10.3 Legil 三尺寸候选生成');
        logger.info(`Run: ${run.runId}`);
        logger.info(`候选 target 数量: ${tasks.length}`);
        logger.info(`运行模式: ${headless ? '无头模式' : '有头模式'}`);
        if (completeDelivery) {
            logger.info('候选完成后将自动标准化、加 LOGO 并生成最终交付包');
        }
        logger.system('========================================');

        const updateProgress = (patch = {}) => {
            automationState.legilTaskProgress = {
                ...(automationState.legilTaskProgress || {}),
                taskType: 'delivery-candidates',
                total: tasks.length,
                outputTotal,
                browserMode,
                ...patch,
                updatedAt: new Date().toISOString()
            };
        };

        try {
            for (let index = 0; index < tasks.length; index++) {
                if (shouldAbort()) {
                    stopped = true;
                    break;
                }

                run = store.readRun(run.runId) || run;
                const task = tasks[index];
                const job = (run.jobs || []).find(item => item.jobId === task.job.jobId);
                if (!job || !job.targets || !job.targets[task.size]) {
                    failedTargets += 1;
                    continue;
                }

                const target = job.targets[task.size];
                const generationSettings = getDeliveryGenerationSettings({
                    ...options,
                    candidateCountPerSize: task.candidateCount
                }, task.size);
                const outputFolder = buildCandidateOutputFolder(path, run, job, task.size);
                fs.mkdirSync(outputFolder, { recursive: true });

                target.status = 'generating';
                target.aspectRatio = task.aspectRatio;
                target.candidateCount = task.candidateCount;
                target.candidates = [];
                target.error = '';
                target.updatedAt = new Date().toISOString();
                updateJobStatus(job, run.targetSizes);
                store.saveRun(run);

                const sourceImageName = job.sourceImage && job.sourceImage.fileName || '';
                const prompt = buildDeliveryPrompt({
                    promptTemplates,
                    targetSize: task.size,
                    aspectRatio: task.aspectRatio,
                    baseName: job.baseName,
                    sourceFileName: sourceImageName
                });

                updateProgress({
                    phase: 'running',
                    currentIndex: index + 1,
                    completed: generatedTargets + failedTargets,
                    success: generatedTargets,
                    failed: failedTargets,
                    saved: savedTotal,
                    currentName: `${job.baseName || sourceImageName} ${task.size}`,
                    currentAction: `正在生成 ${index + 1}/${tasks.length}: ${sourceImageName} -> ${task.size}（${task.aspectRatio}）`
                });

                logger.info('');
                logger.info(`🖼️ S10.3 正在生成 ${job.groupIndex || task.jobIndex + 1}/${run.totalJobs}：${sourceImageName} -> ${task.size}（${task.aspectRatio}），候选 ${task.candidateCount} 张`);

                try {
                    const result = await legilAutomation.generateImage(prompt, index + 1, {
                        referenceImagePath: job.sourceImage.filePath,
                        saveFolder: outputFolder,
                        headless,
                        generationSettings,
                        outputSequence,
                        outputTotal,
                        runId: run.runId,
                        referenceImageIndex: job.groupIndex || task.jobIndex + 1,
                        totalReferenceImages: run.totalJobs,
                        referenceImageName: sourceImageName,
                        promptIndexWithinImage: task.sizeIndex + 1,
                        totalPromptsForImage: run.targetSizes.length,
                        promptTitleName: task.size,
                        taskType: '三尺寸交付候选',
                        acceptStablePartialOutputs: true,
                        autoRecoveryEnabled: appConfig.notifications.autoRecoveryEnabled,
                        captureErrorScreenshot: appConfig.notifications.legilScreenshotEnabled,
                        shouldAbort
                    });

                    run = store.readRun(run.runId) || run;
                    const currentJob = (run.jobs || []).find(item => item.jobId === job.jobId);
                    const currentTarget = currentJob && currentJob.targets ? currentJob.targets[task.size] : target;
                    const savePaths = result && result.success ? result.savePaths || [] : [];
                    const candidates = buildCandidateRecords({
                        savePaths,
                        job,
                        targetSize: task.size,
                        aspectRatio: task.aspectRatio
                    });

                    currentTarget.candidates = candidates;
                    currentTarget.updatedAt = new Date().toISOString();
                    currentTarget.candidateCount = task.candidateCount;
                    currentTarget.aspectRatio = task.aspectRatio;
                    savedTotal += candidates.length;
                    outputSequence += Math.max(candidates.length, task.candidateCount);

                    if (result && result.success && candidates.length >= task.candidateCount) {
                        generatedTargets += 1;
                        currentTarget.status = 'candidates_ready';
                        currentTarget.error = '';
                        logger.info(`✅ S10.3 target 完成：${sourceImageName} -> ${task.size}，保存 ${candidates.length} 张候选`);
                    } else if (shouldAbort() || String(result && result.message || '').includes('操作已取消')) {
                        stopped = true;
                        currentTarget.status = candidates.length ? 'failed' : 'pending';
                        currentTarget.error = '任务已停止';
                        logger.warn('⏹️ S10.3 三尺寸候选生成已停止');
                    } else {
                        failedTargets += 1;
                        currentTarget.status = 'failed';
                        currentTarget.error = result && result.message
                            ? `${result.message}${candidates.length ? `；已保存 ${candidates.length}/${task.candidateCount} 张` : ''}`
                            : `候选数量不足：${candidates.length}/${task.candidateCount}`;
                        logger.error(`❌ S10.3 target 失败：${sourceImageName} -> ${task.size}: ${currentTarget.error}`);
                    }

                    updateJobStatus(currentJob, run.targetSizes);
                    updateRunStatusFromTargets(run, stopped ? 'stopped' : '');
                    store.saveRun(run);

                    updateProgress({
                        phase: stopped ? 'stopped' : 'running',
                        currentIndex: index + 1,
                        completed: generatedTargets + failedTargets,
                        success: generatedTargets,
                        failed: failedTargets,
                        saved: savedTotal,
                        currentAction: stopped
                            ? 'S10.3 三尺寸候选生成已停止'
                            : `已完成 ${generatedTargets + failedTargets}/${tasks.length} 个 target`
                    });

                    if (stopped) {
                        break;
                    }
                } catch (error) {
                    if (shouldAbort() || error.message === '操作已取消') {
                        stopped = true;
                        target.status = 'pending';
                        target.error = '任务已停止';
                        target.updatedAt = new Date().toISOString();
                        store.saveRun(run);
                        break;
                    }

                    failedTargets += 1;
                    run = store.readRun(run.runId) || run;
                    const currentJob = (run.jobs || []).find(item => item.jobId === job.jobId);
                    const currentTarget = currentJob && currentJob.targets ? currentJob.targets[task.size] : target;
                    currentTarget.status = 'failed';
                    currentTarget.error = error.message;
                    currentTarget.updatedAt = new Date().toISOString();
                    updateJobStatus(currentJob, run.targetSizes);
                    updateRunStatusFromTargets(run);
                    store.saveRun(run);
                    updateProgress({
                        phase: 'running',
                        currentIndex: index + 1,
                        completed: generatedTargets + failedTargets,
                        success: generatedTargets,
                        failed: failedTargets,
                        saved: savedTotal,
                        currentAction: `target 失败：${error.message}`
                    });
                    logger.error(`❌ S10.3 target 出错：${error.message}`);
                }

                if (index < tasks.length - 1) {
                    try {
                        await sleepWithLegilStop(5000);
                    } catch (error) {
                        stopped = true;
                        break;
                    }
                }
            }

            run = store.readRun(run.runId) || run;
            updateRunStatusFromTargets(run, stopped ? 'stopped' : '');
            store.saveRun(run);

            let finalResult = null;
            updateProgress({
                phase: stopped ? 'stopped' : (failedTargets > 0 ? 'failed' : 'completed'),
                completed: generatedTargets + failedTargets,
                success: generatedTargets,
                failed: failedTargets,
                saved: savedTotal,
                currentAction: stopped
                    ? `S10.3 已停止：完成 ${generatedTargets} 个，失败 ${failedTargets} 个`
                    : `S10.3 完成：完成 ${generatedTargets} 个，失败 ${failedTargets} 个`
            });
            logger.system(stopped
                ? `⏹️ S10.3 三尺寸候选生成已停止：完成 ${generatedTargets} 个，失败 ${failedTargets} 个`
                : `✅ S10.3 三尺寸候选生成完成：完成 ${generatedTargets} 个，失败 ${failedTargets} 个`);

            if (completeDelivery && !stopped && failedTargets === 0) {
                logger.system('开始自动生成最终交付包');
                updateProgress({
                    phase: 'standardizing',
                    currentAction: '候选生成完成，正在标准化全部候选图...'
                });
                const standardizedResult = await standardizeDeliveryRun(run.runId, options);
                if (!standardizedResult.success) {
                    throw new Error(standardizedResult.message || '标准化全部候选失败');
                }

                updateProgress({
                    phase: 'finalizing',
                    saved: standardizedResult.standardizedCount,
                    currentAction: '标准化完成，正在加 LOGO 并生成最终交付包...'
                });
                finalResult = await finalizeDeliveryRunById(run.runId, options);
                if (finalResult.failedCount > 0) {
                    throw new Error(`最终交付包生成完成，但有 ${finalResult.failedCount} 张失败`);
                }
                run = finalResult.run;

                updateProgress({
                    phase: 'completed',
                    completed: tasks.length,
                    success: tasks.length,
                    failed: 0,
                    saved: finalResult.finalizedCount,
                    finalizedCount: finalResult.finalizedCount,
                    finalPackageRoot: finalResult.finalPackageRoot,
                    currentAction: `最终交付包已生成：${finalResult.finalPackageRoot}`
                });
                logger.system(`✅ 完整改尺寸交付完成：${finalResult.finalPackageRoot}`);
            }
        } catch (error) {
            interruptedMessage = error && error.message ? error.message : String(error || '未知错误');
            run = store.readRun(run.runId) || run;
            updateRunStatusFromTargets(run, 'failed');
            store.saveRun(run);
            updateProgress({
                phase: 'interrupted',
                completed: generatedTargets + failedTargets,
                success: generatedTargets,
                failed: failedTargets,
                saved: savedTotal,
                currentAction: `S10.3 被中断：${interruptedMessage}`
            });
            logger.error(`❌ S10.3 三尺寸候选生成被中断: ${interruptedMessage}`);
        } finally {
            if (typeof notifyLegilResult === 'function') {
                notifyLegilResult('delivery-candidates', {
                    successCount: generatedTargets,
                    failedCount: failedTargets,
                    interrupted: Boolean(interruptedMessage),
                    message: interruptedMessage || (stopped ? '任务已停止' : `任务完成：成功 ${generatedTargets} 个 target，失败 ${failedTargets} 个 target`)
                });
            }
            legilAutomation.saveFolder = previousSaveFolder;
            legilAutomation.referenceFolder = previousReferenceFolder;
            legilAutomation.referenceImages = previousReferenceImages;
            legilAutomation.currentRefIndex = previousRefIndex;
            legilAutomation.generationSettings = previousGenerationSettings;
            deliveryTask.running = false;
            deliveryTask.stopRequested = false;
            deliveryTask.runId = '';
            automationState.legilTaskRunning = false;
            automationState.legilStopRequested = false;
            automationState.legilTaskType = null;
        }

        return {
            success: !interruptedMessage,
            message: interruptedMessage || (stopped ? '任务已停止' : 'S10.3 三尺寸候选生成完成'),
            generatedTargets,
            failedTargets,
            finalPackageRoot: run.finalPackageRoot || ''
        };
    }

    function startDeliveryRun(req, res, extraOptions = {}) {
        const body = req.body || {};
        const requestOptions = {
            ...body,
            ...extraOptions
        };
        if (isLegilBusy()) {
            return res.json({
                success: false,
                message: '当前已有自动化任务正在运行，请稍后再试'
            });
        }

        const run = getRunFromRequest(requestOptions);
        if (!run) {
            return res.status(404).json({
                success: false,
                message: '请先扫描 OK 图，建立 delivery run'
            });
        }
        store.applyTargetConfig(run, requestOptions);
        store.saveRun(run);

        const tasks = collectRunnableTargets(run, requestOptions);
        const completeDelivery = shouldCompleteFullDelivery(run, requestOptions);
        if (tasks.length === 0 && !completeDelivery) {
            updateRunStatusFromTargets(run);
            store.saveRun(run);
            return res.json({
                success: true,
                run: publicRun(run),
                totalTargets: 0,
                message: '没有缺失或失败的 target 需要生成'
            });
        }

        res.json({
            success: true,
            runId: run.runId,
            totalTargets: tasks.length,
            postprocess: completeDelivery,
            message: completeDelivery
                ? `已启动完整改尺寸交付，共 ${tasks.length} 个 target；任务结束时会直接生成最终交付包。`
                : `已启动 S10.3 Legil 三尺寸候选生成，共 ${tasks.length} 个 target。请通过任务列表和日志查看进度。`
        });

        setImmediate(() => {
            runDeliveryCandidates(run.runId, {
                ...requestOptions,
                completeDelivery
            }).catch(error => {
                logger.error(`${completeDelivery ? '完整改尺寸交付' : 'S10.3'} 后台任务异常: ${error.message}`);
            });
        });
    }

    app.post('/api/delivery/scan', (req, res) => {
        try {
            const run = store.scanInputFolder(pickScanPayload(req.body || {}));
            logger.info(`S10.2 三尺寸交付已扫描 OK 图：${run.totalJobs} 个 job，复用 ${run.scan.reusedJobCount} 个，新建 ${run.scan.newJobCount} 个`);
            res.json({
                success: true,
                run: publicRun(run),
                jobs: run.jobs,
                totalJobs: run.totalJobs,
                targetSizes: run.targetSizes,
                dataRoot: store.dataRoot,
                message: `已扫描 ${run.totalJobs} 张 OK 图，生成 ${run.totalJobs} 个三尺寸交付 job`
            });
        } catch (error) {
            res.status(400).json({
                success: false,
                message: error.message
            });
        }
    });

    app.post('/api/delivery/start', (req, res) => {
        startDeliveryRun(req, res);
    });

    app.post('/api/delivery/resume', (req, res) => {
        startDeliveryRun(req, res);
    });

    app.post('/api/delivery/stop', (req, res) => {
        if (!deliveryTask.running && automationState.legilTaskType !== 'delivery-candidates') {
            return res.json({
                success: true,
                message: '当前没有正在运行的三尺寸候选任务'
            });
        }
        deliveryTask.stopRequested = true;
        automationState.legilStopRequested = true;
        if (automationState.legilTaskProgress) {
            automationState.legilTaskProgress = {
                ...automationState.legilTaskProgress,
                phase: 'stopping',
                currentAction: '正在停止 S10.3 三尺寸候选生成...',
                updatedAt: new Date().toISOString()
            };
        }
        res.json({
            success: true,
            message: '已发送停止指令，当前 target 结束后会安全停止'
        });
    });

    app.post('/api/delivery/runs/:runId/retry-target', (req, res) => {
        startDeliveryRun(req, res, {
            runId: req.params.runId,
            jobId: req.body && req.body.jobId,
            targetSize: req.body && (req.body.targetSize || req.body.size),
            force: req.body && req.body.force === true
        });
    });

    app.post('/api/delivery/runs/:runId/select-candidate', (req, res) => {
        try {
            const run = store.readRun(req.params.runId);
            if (!run) {
                return res.status(404).json({
                    success: false,
                    message: '未找到三尺寸交付 run'
                });
            }

            const body = req.body || {};
            const jobId = String(body.jobId || '').trim();
            const targetSize = String(body.targetSize || body.size || '').trim();
            const candidateId = String(body.candidateId || '').trim();
            const job = (Array.isArray(run.jobs) ? run.jobs : []).find(item => item.jobId === jobId);
            const target = job && job.targets ? job.targets[targetSize] : null;
            const candidate = findCandidate(target, candidateId);

            if (!job || !target || !candidate) {
                return res.status(400).json({
                    success: false,
                    message: '未找到要选择的候选图'
                });
            }

            const previousSelectedCandidateId = String(target.selectedCandidateId || '');
            const selectionChanged = previousSelectedCandidateId && previousSelectedCandidateId !== candidateId;
            target.candidates = target.candidates.map(item => ({
                ...item,
                selected: item.candidateId === candidateId
            }));
            target.selectedCandidateId = candidateId;
            if (selectionChanged) {
                target.standardizedPath = '';
                target.logoPath = '';
                target.finalPath = '';
                delete target.standardized;
            }
            target.status = !selectionChanged && ['standardized', 'logo_applied', 'finalized'].includes(String(target.status || ''))
                ? target.status
                : 'candidate_selected';
            target.error = '';
            target.updatedAt = new Date().toISOString();
            updateJobStatus(job, run.targetSizes);
            updateRunStatusFromTargets(run);
            store.saveRun(run);

            logger.info(`S10.4 已选择最终候选：${job.baseName} / ${targetSize} / ${candidate.fileName || candidateId}`);
            res.json({
                success: true,
                run: publicRun(run),
                job,
                target,
                message: `已选择 ${targetSize} 最终候选`
            });
        } catch (error) {
            res.status(400).json({
                success: false,
                message: error.message
            });
        }
    });

    app.post('/api/delivery/runs/:runId/standardize', async (req, res) => {
        try {
            const result = await standardizeDeliveryRun(req.params.runId, req.body || {});
            res.json({
                success: result.success,
                run: publicRun(result.run),
                standardized: result.standardized,
                failed: result.failed,
                standardizedCount: result.standardizedCount,
                failedCount: result.failedCount,
                maxOutputKb: result.maxOutputKb,
                minQuality: result.minQuality,
                message: result.message
            });
        } catch (error) {
            res.status(400).json({
                success: false,
                message: error.message
            });
        }
    });

    app.post('/api/delivery/runs/:runId/finalize', async (req, res) => {
        try {
            const result = await finalizeDeliveryRunById(req.params.runId, req.body || {});
            res.json({
                success: result.failedCount === 0,
                run: publicRun(result.run),
                logoTemplateFolder: result.logoTemplateFolder,
                logoTemplates: result.logoTemplates,
                finalPackageRoot: result.finalPackageRoot,
                finalized: result.finalized,
                failed: result.failed,
                finalizedCount: result.finalizedCount,
                failedCount: result.failedCount,
                message: result.failedCount
                    ? `最终交付包生成完成，但有 ${result.failedCount} 张失败`
                    : `最终交付包已生成：${result.finalPackageRoot}`
            });
        } catch (error) {
            res.status(400).json({
                success: false,
                message: error.message,
                missing: error.missing || undefined
            });
        }
    });

    app.get('/api/delivery/status', (req, res) => {
        try {
            const run = store.getLatestRun(req.query && req.query.inputFolder);
            res.json({
                success: true,
                hasRun: Boolean(run),
                run: publicRun(run),
                task: {
                    running: deliveryTask.running,
                    stopRequested: deliveryTask.stopRequested,
                    runId: deliveryTask.runId,
                    progress: automationState.legilTaskType === 'delivery-candidates'
                        ? automationState.legilTaskProgress
                        : null
                }
            });
        } catch (error) {
            res.status(400).json({
                success: false,
                message: error.message
            });
        }
    });

    app.get('/api/delivery/runs', (req, res) => {
        try {
            res.json({
                success: true,
                runs: store.listRuns()
            });
        } catch (error) {
            res.status(400).json({
                success: false,
                message: error.message
            });
        }
    });

    app.get('/api/delivery/runs/:runId', (req, res) => {
        try {
            const run = store.readRun(req.params.runId);
            if (!run) {
                return res.status(404).json({
                    success: false,
                    message: '未找到三尺寸交付 run'
                });
            }
            res.json({
                success: true,
                run: publicRun(run),
                task: {
                    running: deliveryTask.running,
                    stopRequested: deliveryTask.stopRequested,
                    runId: deliveryTask.runId,
                    progress: automationState.legilTaskType === 'delivery-candidates'
                        ? automationState.legilTaskProgress
                        : null
                }
            });
        } catch (error) {
            res.status(400).json({
                success: false,
                message: error.message
            });
        }
    });

    app.get('/api/delivery/image', (req, res) => {
        try {
            const run = store.readRun(req.query && req.query.runId);
            const requestedPath = String(req.query && req.query.path || '').trim();
            if (!run || !requestedPath) {
                return res.status(404).end();
            }

            const resolvedPath = path.resolve(requestedPath);
            const allowedRoots = [run.inputFolder, run.outputFolder]
                .filter(Boolean)
                .map(folder => path.resolve(folder).toLowerCase());
            const resolvedLower = resolvedPath.toLowerCase();
            const allowed = allowedRoots.some(root =>
                resolvedLower === root || resolvedLower.startsWith(root + path.sep.toLowerCase())
            );
            if (!allowed || !fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isFile()) {
                return res.status(404).end();
            }

            res.sendFile(resolvedPath);
        } catch (error) {
            res.status(404).end();
        }
    });
};
