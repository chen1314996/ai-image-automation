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
    analyzeDeliveryCandidateTextQuality,
    isCandidateTextRisky,
    sortCandidatesByTextQuality
} = require('../services/delivery-postprocess/text-guard');
const {
    DEFAULT_MAX_OUTPUT_BYTES,
    DEFAULT_MAX_OUTPUT_KB,
    DEFAULT_MIN_JPEG_QUALITY,
    DELIVERY_TARGET_DIMENSIONS,
    buildStandardizedOutputPath,
    standardizeImageToTarget
} = require('../services/delivery-postprocess/standardize');
const {
    finalizeDeliveryRun,
    buildFinalImagePath
} = require('../services/delivery-postprocess/finalize');
const {
    readImageDimensions
} = require('../services/image-renamer');

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
    if (target && (target.generationMode === 'source-reuse' || target.reuseSource === true)) {
        return false;
    }
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
    const failedOnly = options.failedOnly === true;
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
            if (failedOnly && String(target && target.status || '') !== 'failed') {
                return;
            }
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

function jobHasFailedTarget(job, targetSizes) {
    const targets = job && job.targets ? job.targets : {};
    return targetSizes.some(size => String(targets[size] && targets[size].status || '') === 'failed');
}

function updateJobStatus(job, targetSizes) {
    const targets = job && job.targets ? job.targets : {};
    const statuses = targetSizes.map(size => String(targets[size] && targets[size].status || 'pending'));
    if (statuses.length && statuses.every(status => status === 'finalized')) {
        job.status = 'finalized';
    } else if (statuses.every(status => ['candidates_ready', 'candidate_selected', 'standardized', 'logo_applied', 'finalized'].includes(status))) {
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
    } else if (statuses.length && statuses.every(status => status === 'finalized')) {
        run.status = 'finalized';
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

function getMinimumLegilCandidateDimensions(targetSize) {
    const target = DELIVERY_TARGET_DIMENSIONS[targetSize];
    if (!target) {
        return null;
    }
    return {
        width: Math.max(512, Math.floor(target.width * 0.9)),
        height: Math.max(512, Math.floor(target.height * 0.9))
    };
}

function isUsableLegilCandidateFile(filePath, targetSize) {
    if (!filePath || !require('fs').existsSync(filePath)) {
        return false;
    }
    const min = getMinimumLegilCandidateDimensions(targetSize);
    if (!min) {
        return true;
    }
    const dimensions = readImageDimensions(filePath);
    if (!dimensions || !dimensions.width || !dimensions.height) {
        logger.warn(`跳过无法读取尺寸的 Legil 候选：${filePath}`);
        return false;
    }
    if (dimensions.width < min.width || dimensions.height < min.height) {
        logger.warn(`跳过低分辨率 Legil 候选：${filePath} (${dimensions.width}x${dimensions.height})，目标 ${targetSize}`);
        return false;
    }
    return true;
}

function buildCandidateRecords({ savePaths, job, targetSize, aspectRatio }) {
    const now = new Date().toISOString();
    return (Array.isArray(savePaths) ? savePaths : [])
        .filter(filePath => isUsableLegilCandidateFile(filePath, targetSize))
        .map((filePath, index) => ({
        candidateId: `cand_${job.jobId}_${targetSize}_${String(index + 1).padStart(2, '0')}`,
        candidateIndex: index + 1,
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
    const candidates = Array.isArray(target && target.candidates)
        ? target.candidates.filter(candidate => candidate && candidate.filePath)
        : [];
    const sorted = sortCandidatesByTextQuality(candidates);
    const safeCandidates = sorted.filter(candidate => !isCandidateTextRisky(candidate));
    return safeCandidates.length ? safeCandidates : sorted;
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

function getExistingStandardizedOutput(outputPath, targetSize) {
    if (!outputPath || !DELIVERY_TARGET_DIMENSIONS[targetSize] || !require('fs').existsSync(outputPath)) {
        return null;
    }
    const dimensions = readImageDimensions(outputPath);
    const target = DELIVERY_TARGET_DIMENSIONS[targetSize];
    if (!dimensions || dimensions.width !== target.width || dimensions.height !== target.height) {
        return null;
    }
    const stat = require('fs').statSync(outputPath);
    return {
        outputPath,
        targetSize,
        width: target.width,
        height: target.height,
        quality: null,
        sizeBytes: stat.size,
        sizeKb: Math.round(stat.size / 1024),
        maxOutputKb: DEFAULT_MAX_OUTPUT_KB,
        minQuality: DEFAULT_MIN_JPEG_QUALITY,
        sourceDimensions: '',
        outputDimensions: `${target.width}x${target.height}`,
        reusedExisting: true
    };
}

function isValidFinalOutputFile(filePath, targetSize) {
    if (!filePath || !DELIVERY_TARGET_DIMENSIONS[targetSize] || !require('fs').existsSync(filePath)) {
        return false;
    }
    const dimensions = readImageDimensions(filePath);
    const target = DELIVERY_TARGET_DIMENSIONS[targetSize];
    return Boolean(dimensions && dimensions.width === target.width && dimensions.height === target.height);
}

function getExpectedFinalOutputPaths(run, job, targetSize) {
    const target = job && job.targets ? job.targets[targetSize] : null;
    const finalizedCandidates = Array.isArray(target && target.finalizedCandidates)
        ? target.finalizedCandidates
        : [];
    if (finalizedCandidates.length) {
        const candidateCount = finalizedCandidates.length;
        return finalizedCandidates.map((item, index) => {
            return item.outputPath || buildFinalImagePath(
                run,
                job,
                targetSize,
                Number(item.candidateIndex) || index + 1,
                Number(item.candidateCount) || candidateCount
            );
        });
    }

    const fallbackPath = target && (
        target.finalPath ||
        (target.finalized && target.finalized.outputPath)
    );
    const standardizedCount = Array.isArray(target && target.standardizedCandidates) && target.standardizedCandidates.length
        ? target.standardizedCandidates.length
        : 1;
    return [
        fallbackPath || buildFinalImagePath(run, job, targetSize, 1, standardizedCount)
    ];
}

function getMissingFinalTargetSizes(run, job, targetSizes) {
    return targetSizes.filter(size => {
        const target = job && job.targets ? job.targets[size] : null;
        if (!target || String(target.status || '') !== 'finalized') {
            return true;
        }
        const outputPaths = getExpectedFinalOutputPaths(run, job, size);
        return !outputPaths.length || outputPaths.some(filePath => !isValidFinalOutputFile(filePath, size));
    });
}

function shouldAllowPartialPostprocess(options = {}) {
    return options.allowPartialPostprocess !== false && options.allowPartial !== false;
}

function shouldCompleteFullDelivery(run, options = {}) {
    const processMode = String(options.processMode || run && run.processMode || 'full-delivery');
    return processMode !== 'legil-only' &&
        !String(options.jobId || '').trim() &&
        !String(options.targetSize || options.size || '').trim();
}

function shouldCompleteJobDelivery(run, options = {}) {
    const processMode = String(options.processMode || run && run.processMode || 'full-delivery');
    return processMode !== 'legil-only' &&
        Boolean(String(options.jobId || '').trim()) &&
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
        const targetAspectRatio = DELIVERY_TARGET_ASPECT_RATIOS[targetSize] || '';
        const aspectRatio = targetAspectRatio || normalized.aspectRatio;
        const settings = {
            ...normalized,
            aspectRatio,
            outputQuantity: normalizeDeliveryCandidateCount(body.candidateCountPerSize || normalized.outputQuantity)
        };
        if (targetAspectRatio) {
            settings.aspectRatios = [aspectRatio];
        }
        return settings;
    }

    async function inspectCandidateTextQuality(candidates = [], options = {}) {
        const enabled = options.textGuardEnabled !== false && options.enableTextGuard !== false;
        if (!enabled || !Array.isArray(candidates) || !candidates.length) {
            return candidates;
        }

        for (const candidate of candidates) {
            if (typeof options.shouldAbort === 'function' && options.shouldAbort()) {
                break;
            }

            const textQuality = await analyzeDeliveryCandidateTextQuality(candidate);
            candidate.textQuality = textQuality;
            candidate.textProblem = isCandidateTextRisky(candidate);

            if (candidate.textProblem) {
                logger.warn(`候选图疑似有文字污染：${candidate.fileName || candidate.candidateId}，风险 ${textQuality.riskLevel}，${textQuality.reason || '无详细原因'}`);
            } else if (textQuality.status === 'unchecked') {
                logger.warn(`候选图文字质检未完成：${candidate.fileName || candidate.candidateId}，${textQuality.reason}`);
            } else {
                logger.info(`候选图文字质检通过：${candidate.fileName || candidate.candidateId}`);
            }
        }

        return candidates;
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
        const allowPartial = shouldAllowPartialPostprocess(body);
        const forceStandardize = body.force === true || body.forceStandardize === true;
        const standardized = [];
        const failed = [];
        let reusedExistingCount = 0;

        for (const job of jobs) {
            for (const targetSize of targetSizes) {
                const target = job.targets[targetSize];
                const candidates = getTargetCandidates(target);
                if (!candidates.length) {
                    failed.push({
                        jobId: job.jobId,
                        baseName: job.baseName,
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
                        const existingResult = forceStandardize
                            ? null
                            : getExistingStandardizedOutput(outputPath, targetSize);
                        const result = existingResult || await standardizeImageToTarget(candidate.filePath, outputPath, targetSize, {
                            maxOutputBytes,
                            minQuality
                        });
                        if (existingResult) {
                            reusedExistingCount += 1;
                        }
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
                            textProblem: candidate.textProblem === true,
                            textQuality: candidate.textQuality || null,
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
                updateJobStatus(job, run.targetSizes);
                updateRunStatusFromTargets(run, failed.length && !allowPartial ? 'failed' : '');
                store.saveRun(run);
            }
            const allStandardized = targetSizes.every(size => job.targets[size] && hasStandardizedCandidates(job.targets[size]));
            job.postprocess = {
                ...(job.postprocess || {}),
                standardized: allStandardized
            };
            updateJobStatus(job, run.targetSizes);
            store.saveRun(run);
        }

        updateRunStatusFromTargets(run, failed.length && !allowPartial ? 'failed' : '');
        store.saveRun(run);
        if (failed.length && allowPartial && standardized.length) {
            logger.warn(`S10.5 标准化部分完成：成功 ${standardized.length} 张，跳过/失败 ${failed.length} 张`);
        } else if (reusedExistingCount > 0) {
            logger.info(`S10.5 标准化完成：成功 ${standardized.length} 张，其中复用已存在文件 ${reusedExistingCount} 张，失败 ${failed.length} 张`);
        } else {
            logger.info(`S10.5 标准化完成：成功 ${standardized.length} 张，失败 ${failed.length} 张`);
        }

        return {
            success: failed.length === 0 || (allowPartial && standardized.length > 0),
            partial: failed.length > 0 && standardized.length > 0,
            run,
            standardized,
            failed,
            standardizedCount: standardized.length,
            failedCount: failed.length,
            reusedExistingCount,
            maxOutputKb: Math.round(maxOutputBytes / 1024) || DEFAULT_MAX_OUTPUT_KB,
            minQuality,
            message: failed.length
                ? `标准化部分完成：成功 ${standardized.length} 张，跳过/失败 ${failed.length} 张`
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
        const onlyJobId = String(body.jobId || '').trim();
        const allowPartial = shouldAllowPartialPostprocess(body);
        const notStandardized = [];
        (Array.isArray(run.jobs) ? run.jobs : []).forEach(job => {
            if (onlyJobId && job.jobId !== onlyJobId) {
                return;
            }
            targetSizes.forEach(size => {
                const target = job.targets && job.targets[size];
                if (!hasStandardizedCandidates(target)) {
                    notStandardized.push(`${job.baseName || job.jobId} / ${size}`);
                }
            });
        });
        if (notStandardized.length && !allowPartial) {
            const error = new Error(`请先执行标准化，再生成最终交付包。未标准化：${notStandardized.join('；')}`);
            error.missing = notStandardized;
            throw error;
        } else if (notStandardized.length) {
            logger.warn(`S10 最终交付包将跳过 ${notStandardized.length} 个未标准化 target`);
        }

        const result = await finalizeDeliveryRun(run, {
            logoTemplateFolder: body && (body.logoTemplateFolder || body.logoFolder),
            namingRule: body && body.namingRule,
            maxOutputBytes: body && body.maxOutputBytes,
            minQuality: body && body.minQuality,
            allowPartial,
            force: body && body.force,
            forceFinalize: body && body.forceFinalize,
            jobId: body && body.jobId,
            runStatus: body && body.runStatus,
            onProgress: updatedRun => store.saveRun(updatedRun)
        });
        store.saveRun(result.run);
        logger.system(result.failedCount
            ? 'S10 三尺寸最终交付包已部分生成'
            : 'S10 三尺寸最终交付包已生成');
        logger.info(`LOGO 模板目录: ${result.logoTemplateFolder}`);
        logger.info(`最终交付目录: ${result.finalPackageRoot}`);
        logger.info(`最终输出 ${result.finalizedCount} 张，失败 ${result.failedCount} 张`);
        return result;
    }

    function isDeliveryJobFinalized(run, job, targetSizes) {
        return targetSizes.length > 0 && getMissingFinalTargetSizes(run, job, targetSizes).length === 0;
    }

    async function runDeliveryJobClosedLoop(runId, jobId, options = {}, state) {
        let run = store.readRun(runId);
        if (!run) {
            throw new Error(`delivery run not found: ${runId}`);
        }
        const targetSizes = Array.isArray(run.targetSizes) && run.targetSizes.length
            ? run.targetSizes
            : Object.keys(DELIVERY_TARGET_ASPECT_RATIOS);
        const jobIndex = (Array.isArray(run.jobs) ? run.jobs : []).findIndex(item => item.jobId === jobId);
        const job = jobIndex >= 0 ? run.jobs[jobIndex] : null;
        if (!job) {
            throw new Error(`delivery job not found: ${jobId}`);
        }
        const missingFinalTargetSizes = getMissingFinalTargetSizes(run, job, targetSizes);
        if (missingFinalTargetSizes.length === 0) {
            if (state && typeof state.updateProgress === 'function') {
                state.updateProgress({
                    phase: 'skipping',
                    currentJobIndex: jobIndex + 1,
                    currentName: job.baseName || (job.sourceImage && job.sourceImage.fileName) || '',
                    completed: state.completedTargets,
                    success: state.generatedTargets,
                    failed: state.failedTargets,
                    saved: state.savedTotal,
                    currentAction: `Closed-loop job ${jobIndex + 1}/${run.totalJobs}: already finalized, skipping`
                });
            }
            return {
                run,
                skipped: true,
                generatedTargets: 0,
                failedTargets: 0,
                finalizedCount: 0
            };
        }
        missingFinalTargetSizes.forEach(size => {
            const target = job.targets && job.targets[size];
            if (target && String(target.status || '') === 'finalized') {
                target.status = hasStandardizedCandidates(target) ? 'standardized' : 'candidate_selected';
                target.finalPath = '';
                target.finalizedCandidates = [];
                target.finalized = null;
                target.logoPath = '';
                target.logoApplied = false;
                target.updatedAt = new Date().toISOString();
            }
        });
        if (missingFinalTargetSizes.length) {
            job.status = targetSizes.every(size => job.targets && job.targets[size] && job.targets[size].status === 'finalized')
                ? 'finalized'
                : 'candidates_ready';
            job.postprocess = {
                ...(job.postprocess || {}),
                logoApplied: false,
                renamed: false,
                packaged: false,
                finalized: false,
                finalPackageFolder: ''
            };
            job.updatedAt = new Date().toISOString();
            run.status = 'running';
            store.saveRun(run);
        }

        const tasks = collectRunnableTargets(run, {
            ...options,
            jobId
        });
        const sourceImageName = job.sourceImage && job.sourceImage.fileName || '';
        job.status = tasks.length ? 'generating' : job.status;
        run.status = 'running';
        store.saveRun(run);

        state.updateProgress({
            phase: tasks.length ? 'running' : 'standardizing',
            currentJobIndex: jobIndex + 1,
            currentName: job.baseName || sourceImageName,
            currentAction: tasks.length
                ? `Closed-loop job ${jobIndex + 1}/${run.totalJobs}: generating ${tasks.length} Legil target(s)`
                : `Closed-loop job ${jobIndex + 1}/${run.totalJobs}: source-reuse/postprocess only`
        });

        let jobGeneratedTargets = 0;
        let jobFailedTargets = 0;
        let stopped = false;

        for (let index = 0; index < tasks.length; index++) {
            if (state.shouldAbort()) {
                stopped = true;
                break;
            }

            run = store.readRun(run.runId) || run;
            const task = tasks[index];
            const currentJob = (run.jobs || []).find(item => item.jobId === jobId);
            if (!currentJob || !currentJob.targets || !currentJob.targets[task.size]) {
                jobFailedTargets += 1;
                state.failedTargets += 1;
                state.completedTargets += 1;
                continue;
            }

            const target = currentJob.targets[task.size];
            const generationSettings = getDeliveryGenerationSettings({
                ...options,
                candidateCountPerSize: task.candidateCount
            }, task.size);
            const outputFolder = buildCandidateOutputFolder(path, run, currentJob, task.size);
            fs.mkdirSync(outputFolder, { recursive: true });

            target.status = 'generating';
            target.aspectRatio = task.aspectRatio;
            target.candidateCount = task.candidateCount;
            target.candidates = [];
            target.error = '';
            target.updatedAt = new Date().toISOString();
            updateJobStatus(currentJob, run.targetSizes);
            store.saveRun(run);

            const prompt = buildDeliveryPrompt({
                promptTemplates: state.promptTemplates,
                targetSize: task.size,
                aspectRatio: task.aspectRatio,
                baseName: currentJob.baseName,
                sourceFileName: sourceImageName
            });
            const targetSequence = state.completedTargets + 1;

            state.updateProgress({
                phase: 'running',
                currentIndex: targetSequence,
                completed: state.completedTargets,
                success: state.generatedTargets,
                failed: state.failedTargets,
                saved: state.savedTotal,
                currentName: `${currentJob.baseName || sourceImageName} ${task.size}`,
                currentAction: `Closed-loop Legil ${targetSequence}/${state.totalLegilTargets}: ${sourceImageName} -> ${task.size}`
            });

            logger.info('');
            logger.info(`S11 closed-loop Legil target ${targetSequence}/${state.totalLegilTargets}: ${sourceImageName} -> ${task.size} (${task.aspectRatio})`);

            try {
                const result = await legilAutomation.generateImage(prompt, targetSequence, {
                    referenceImagePath: currentJob.sourceImage.filePath,
                    saveFolder: outputFolder,
                    headless: state.headless,
                    generationSettings,
                    outputSequence: state.outputSequence,
                    outputTotal: state.outputTotal,
                    runId: run.runId,
                    referenceImageIndex: currentJob.groupIndex || jobIndex + 1,
                    totalReferenceImages: run.totalJobs,
                    referenceImageName: sourceImageName,
                    promptIndexWithinImage: task.sizeIndex + 1,
                    totalPromptsForImage: run.targetSizes.length,
                    promptTitleName: task.size,
                    taskType: 'delivery-closed-loop',
                    acceptStablePartialOutputs: true,
                    autoRecoveryEnabled: appConfig.notifications.autoRecoveryEnabled,
                    captureErrorScreenshot: appConfig.notifications.legilScreenshotEnabled,
                    shouldAbort: state.shouldAbort
                });

                run = store.readRun(run.runId) || run;
                const latestJob = (run.jobs || []).find(item => item.jobId === jobId);
                const latestTarget = latestJob && latestJob.targets ? latestJob.targets[task.size] : target;
                const savePaths = result && result.success ? result.savePaths || [] : [];
                const candidates = await inspectCandidateTextQuality(buildCandidateRecords({
                    savePaths,
                    job: latestJob || currentJob,
                    targetSize: task.size,
                    aspectRatio: task.aspectRatio
                }), {
                    shouldAbort: state.shouldAbort,
                    textGuardEnabled: options.textGuardEnabled,
                    enableTextGuard: options.enableTextGuard
                });

                latestTarget.candidates = candidates;
                latestTarget.updatedAt = new Date().toISOString();
                latestTarget.candidateCount = task.candidateCount;
                latestTarget.aspectRatio = task.aspectRatio;
                state.savedTotal += candidates.length;
                state.outputSequence += Math.max(candidates.length, task.candidateCount);

                if (result && result.success && candidates.length >= task.candidateCount) {
                    jobGeneratedTargets += 1;
                    state.generatedTargets += 1;
                    latestTarget.status = 'candidates_ready';
                    latestTarget.error = '';
                    logger.info(`S11 closed-loop target completed: ${sourceImageName} -> ${task.size}, saved ${candidates.length}`);
                } else if (state.shouldAbort() || String(result && result.message || '').includes('cancel')) {
                    stopped = true;
                    latestTarget.status = candidates.length ? 'failed' : 'pending';
                    latestTarget.error = 'Task stopped';
                    logger.warn('S11 closed-loop delivery stopped during Legil generation');
                } else {
                    jobFailedTargets += 1;
                    state.failedTargets += 1;
                    latestTarget.status = 'failed';
                    latestTarget.error = result && result.message
                        ? `${result.message}${candidates.length ? `; saved ${candidates.length}/${task.candidateCount}` : ''}`
                        : `Not enough candidates: ${candidates.length}/${task.candidateCount}`;
                    logger.error(`S11 closed-loop target failed: ${sourceImageName} -> ${task.size}: ${latestTarget.error}`);
                }

                state.completedTargets = state.generatedTargets + state.failedTargets;
                updateJobStatus(latestJob, run.targetSizes);
                updateRunStatusFromTargets(run, stopped ? 'stopped' : 'running');
                store.saveRun(run);

                state.updateProgress({
                    phase: stopped ? 'stopped' : 'running',
                    currentIndex: targetSequence,
                    completed: state.completedTargets,
                    success: state.generatedTargets,
                    failed: state.failedTargets,
                    saved: state.savedTotal,
                    currentAction: stopped
                        ? 'Closed-loop delivery stopped'
                        : `Closed-loop Legil completed ${state.completedTargets}/${state.totalLegilTargets}`
                });

                if (stopped) {
                    break;
                }
            } catch (error) {
                if (state.shouldAbort() || error.message === '操作已取消') {
                    stopped = true;
                    target.status = 'pending';
                    target.error = 'Task stopped';
                    target.updatedAt = new Date().toISOString();
                    store.saveRun(run);
                    break;
                }

                jobFailedTargets += 1;
                state.failedTargets += 1;
                state.completedTargets = state.generatedTargets + state.failedTargets;
                run = store.readRun(run.runId) || run;
                const latestJob = (run.jobs || []).find(item => item.jobId === jobId);
                const latestTarget = latestJob && latestJob.targets ? latestJob.targets[task.size] : target;
                latestTarget.status = 'failed';
                latestTarget.error = error.message;
                latestTarget.updatedAt = new Date().toISOString();
                updateJobStatus(latestJob, run.targetSizes);
                updateRunStatusFromTargets(run, 'running');
                store.saveRun(run);
                state.updateProgress({
                    phase: 'running',
                    currentIndex: state.completedTargets,
                    completed: state.completedTargets,
                    success: state.generatedTargets,
                    failed: state.failedTargets,
                    saved: state.savedTotal,
                    currentAction: `Closed-loop target failed: ${error.message}`
                });
                logger.error(`S11 closed-loop target error: ${error.message}`);
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

        if (stopped) {
            return {
                run: store.readRun(runId) || run,
                stopped: true,
                generatedTargets: jobGeneratedTargets,
                failedTargets: jobFailedTargets,
                finalizedCount: 0
            };
        }

        run = store.readRun(runId) || run;
        const generatedJob = (Array.isArray(run.jobs) ? run.jobs : []).find(item => item.jobId === jobId);
        if (generatedJob) {
            const allTargetsReady = targetSizes.every(size => {
                const target = generatedJob.targets && generatedJob.targets[size];
                if (!target) return false;
                if (target.generationMode === 'source-reuse' || target.reuseSource === true) return true;
                return isTargetReady(target, getCandidateCountForTarget(run, target, size, options));
            });
            generatedJob.postprocess = {
                ...(generatedJob.postprocess || {}),
                allCandidatesGenerated: allTargetsReady,
                allTargetsSelected: allTargetsReady
            };
            generatedJob.updatedAt = new Date().toISOString();
            store.saveRun(run);
        }

        const allowPartialPostprocess = shouldAllowPartialPostprocess(options);
        const postprocessOptions = {
            ...options,
            jobId,
            allowPartialPostprocess,
            runStatus: 'running'
        };

        state.updateProgress({
            phase: 'standardizing',
            currentJobIndex: jobIndex + 1,
            currentName: job.baseName || sourceImageName,
            currentAction: `Closed-loop job ${jobIndex + 1}/${run.totalJobs}: standardizing`
        });
        const standardizedResult = await standardizeDeliveryRun(run.runId, postprocessOptions);
        if (!standardizedResult.success || standardizedResult.standardizedCount === 0) {
            throw new Error(standardizedResult.message || 'Standardize failed');
        }
        if (standardizedResult.failedCount > 0) {
            logger.warn(`S11 closed-loop job standardized with ${standardizedResult.failedCount} failed/skipped target(s)`);
        }

        state.updateProgress({
            phase: 'finalizing',
            currentJobIndex: jobIndex + 1,
            currentName: job.baseName || sourceImageName,
            saved: standardizedResult.standardizedCount,
            currentAction: `Closed-loop job ${jobIndex + 1}/${run.totalJobs}: finalizing package`
        });
        const finalResult = await finalizeDeliveryRunById(run.runId, postprocessOptions);
        if (finalResult.finalizedCount === 0) {
            throw new Error('Final package did not produce any images');
        }
        if (finalResult.failedCount > 0 && !allowPartialPostprocess) {
            throw new Error(`Final package completed with ${finalResult.failedCount} failed image(s)`);
        }

        state.finalizedCount += finalResult.finalizedCount;
        state.finalPackageRoot = finalResult.finalPackageRoot;
        run = finalResult.run;
        if (run.status !== 'finalized') {
            run.status = 'running';
        }
        store.saveRun(run);

        state.updateProgress({
            phase: 'running',
            currentJobIndex: jobIndex + 1,
            completed: state.completedTargets,
            success: state.generatedTargets,
            failed: state.failedTargets,
            saved: state.savedTotal,
            finalizedCount: state.finalizedCount,
            finalPackageRoot: state.finalPackageRoot,
            currentAction: `Closed-loop job ${jobIndex + 1}/${run.totalJobs} finalized`
        });
        logger.system(`S11 closed-loop job finalized: ${job.baseName || sourceImageName}`);

        return {
            run,
            generatedTargets: jobGeneratedTargets,
            failedTargets: jobFailedTargets,
            finalizedCount: finalResult.finalizedCount,
            standardizedCount: standardizedResult.standardizedCount,
            finalPackageRoot: finalResult.finalPackageRoot
        };
    }

    async function runDeliveryJobsClosedLoop(runId, options = {}) {
        let run = store.readRun(runId);
        if (!run) {
            throw new Error('鏈壘鍒颁笁灏哄浜や粯 run');
        }
        store.applyTargetConfig(run, options);

        const promptTemplates = normalizeDeliveryPromptTemplates({
            ...(run.promptTemplates || {}),
            ...(options.promptTemplates || {})
        });
        run.promptTemplates = promptTemplates;
        run.candidateCountPerSize = normalizeDeliveryCandidateCount(options.candidateCountPerSize || run.candidateCountPerSize);

        const targetSizes = Array.isArray(run.targetSizes) && run.targetSizes.length
            ? run.targetSizes
            : Object.keys(DELIVERY_TARGET_ASPECT_RATIOS);
        const onlyJobId = String(options.jobId || '').trim();
        const failedOnly = options.failedOnly === true;
        const jobs = (Array.isArray(run.jobs) ? run.jobs : []).filter(job => {
            if (onlyJobId && job.jobId !== onlyJobId) {
                return false;
            }
            if (failedOnly && !jobHasFailedTarget(job, targetSizes)) {
                return false;
            }
            return true;
        });
        const legilTasks = collectRunnableTargets(run, options);
        const sourceReuseTargetCount = jobs.reduce((sum, job) => {
            return sum + targetSizes.filter(size => {
                const target = job.targets && job.targets[size];
                return target && (target.generationMode === 'source-reuse' || target.reuseSource === true);
            }).length;
        }, 0);

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
        const outputTotal = legilTasks.reduce((sum, task) => sum + task.candidateCount, 0);
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
            total: legilTasks.length,
            totalJobs: jobs.length,
            legilTargetTotal: legilTasks.length,
            sourceReuseTargetCount,
            completed: 0,
            success: 0,
            failed: 0,
            saved: 0,
            outputTotal,
            browserMode,
            currentName: '',
            currentAction: 'Closed-loop full delivery started',
            startedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        run.status = 'running';
        store.saveRun(run);

        logger.system('========================================');
        logger.system('S11 closed-loop full delivery started');
        logger.info(`Run: ${run.runId}`);
        logger.info(`Jobs: ${jobs.length}`);
        logger.info(`Legil targets: ${legilTasks.length}`);
        logger.info(`Source-reuse targets: ${sourceReuseTargetCount}`);
        logger.info(`Browser mode: ${headless ? 'headless' : 'headed'}`);
        logger.system('========================================');

        const updateProgress = (patch = {}) => {
            automationState.legilTaskProgress = {
                ...(automationState.legilTaskProgress || {}),
                taskType: 'delivery-candidates',
                total: legilTasks.length,
                totalJobs: jobs.length,
                legilTargetTotal: legilTasks.length,
                sourceReuseTargetCount,
                outputTotal,
                browserMode,
                ...patch,
                updatedAt: new Date().toISOString()
            };
        };

        const state = {
            promptTemplates,
            headless,
            outputTotal,
            outputSequence: 1,
            totalLegilTargets: legilTasks.length,
            generatedTargets: 0,
            failedTargets: 0,
            completedTargets: 0,
            savedTotal: 0,
            finalizedCount: 0,
            finalPackageRoot: '',
            shouldAbort,
            updateProgress
        };

        try {
            for (let index = 0; index < jobs.length; index++) {
                if (shouldAbort()) {
                    stopped = true;
                    break;
                }
                run = store.readRun(run.runId) || run;
                const latestJob = (run.jobs || []).find(item => item.jobId === jobs[index].jobId);
                if (!latestJob) {
                    state.failedTargets += 1;
                    continue;
                }

                const result = await runDeliveryJobClosedLoop(run.runId, latestJob.jobId, options, state);
                run = result.run || store.readRun(run.runId) || run;
                if (result.stopped) {
                    stopped = true;
                    break;
                }
                store.saveRun(run);

                if (!result.skipped && index < jobs.length - 1) {
                    try {
                        await sleepWithLegilStop(5000);
                    } catch (error) {
                        stopped = true;
                        break;
                    }
                }
            }

            run = store.readRun(run.runId) || run;
            if (stopped) {
                updateRunStatusFromTargets(run, 'stopped');
            } else if (jobs.length && (run.jobs || []).every(job => isDeliveryJobFinalized(run, job, targetSizes))) {
                run.status = 'finalized';
                run.finalizedAt = run.finalizedAt || new Date().toISOString();
            } else {
                updateRunStatusFromTargets(run);
            }
            store.saveRun(run);

            updateProgress({
                phase: stopped ? 'stopped' : (state.failedTargets > 0 ? 'failed' : 'completed'),
                completed: state.completedTargets,
                success: state.generatedTargets,
                failed: state.failedTargets,
                saved: state.savedTotal,
                finalizedCount: state.finalizedCount,
                finalPackageRoot: run.finalPackageRoot || state.finalPackageRoot,
                currentAction: stopped
                    ? `Closed-loop delivery stopped after ${state.completedTargets}/${state.totalLegilTargets} Legil target(s)`
                    : `Closed-loop full delivery completed: ${state.finalizedCount} final image(s)`
            });
            logger.system(stopped
                ? `S11 closed-loop full delivery stopped: generated ${state.generatedTargets}, failed ${state.failedTargets}`
                : `S11 closed-loop full delivery completed: generated ${state.generatedTargets}, failed ${state.failedTargets}, finalized ${state.finalizedCount}`);
        } catch (error) {
            interruptedMessage = error && error.message ? error.message : String(error || 'Unknown error');
            run = store.readRun(run.runId) || run;
            updateRunStatusFromTargets(run, 'failed');
            store.saveRun(run);
            updateProgress({
                phase: 'interrupted',
                completed: state.completedTargets,
                success: state.generatedTargets,
                failed: state.failedTargets,
                saved: state.savedTotal,
                finalizedCount: state.finalizedCount,
                finalPackageRoot: run.finalPackageRoot || state.finalPackageRoot,
                currentAction: `Closed-loop delivery interrupted: ${interruptedMessage}`
            });
            logger.error(`S11 closed-loop full delivery interrupted: ${interruptedMessage}`);
        } finally {
            if (typeof notifyLegilResult === 'function') {
                notifyLegilResult('delivery-candidates', {
                    successCount: state.generatedTargets,
                    failedCount: state.failedTargets,
                    interrupted: Boolean(interruptedMessage),
                    message: interruptedMessage || (stopped
                        ? 'Closed-loop delivery stopped'
                        : `Closed-loop delivery completed: generated ${state.generatedTargets}, failed ${state.failedTargets}, finalized ${state.finalizedCount}`)
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
            message: interruptedMessage || (stopped ? 'Closed-loop delivery stopped' : 'Closed-loop full delivery completed'),
            generatedTargets: state.generatedTargets,
            failedTargets: state.failedTargets,
            finalizedCount: state.finalizedCount,
            finalPackageRoot: run.finalPackageRoot || state.finalPackageRoot
        };
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
                    const candidates = await inspectCandidateTextQuality(buildCandidateRecords({
                        savePaths,
                        job,
                        targetSize: task.size,
                        aspectRatio: task.aspectRatio
                    }), {
                        shouldAbort,
                        textGuardEnabled: options.textGuardEnabled,
                        enableTextGuard: options.enableTextGuard
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

            if (completeDelivery && !stopped) {
                const allowPartialPostprocess = shouldAllowPartialPostprocess(options);
                if (failedTargets > 0 && allowPartialPostprocess) {
                    logger.warn(`S10.3 有 ${failedTargets} 个 target 失败，继续后处理已成功候选`);
                }
                logger.system('开始自动生成最终交付包');
                updateProgress({
                    phase: 'standardizing',
                    currentAction: failedTargets > 0 && allowPartialPostprocess
                        ? '候选生成部分完成，正在标准化已成功候选图...'
                        : '候选生成完成，正在标准化全部候选图...'
                });
                const postprocessOptions = {
                    ...options,
                    allowPartialPostprocess
                };
                const standardizedResult = await standardizeDeliveryRun(run.runId, postprocessOptions);
                if (!standardizedResult.success || standardizedResult.standardizedCount === 0) {
                    throw new Error(standardizedResult.message || '标准化全部候选失败');
                }
                if (standardizedResult.failedCount > 0) {
                    logger.warn(`S10.5 标准化存在 ${standardizedResult.failedCount} 个跳过/失败项，继续生成可交付文件`);
                }

                updateProgress({
                    phase: 'finalizing',
                    saved: standardizedResult.standardizedCount,
                    currentAction: standardizedResult.failedCount > 0
                        ? '标准化部分完成，正在为成功项加 LOGO 并生成交付包...'
                        : '标准化完成，正在加 LOGO 并生成最终交付包...'
                });
                finalResult = await finalizeDeliveryRunById(run.runId, postprocessOptions);
                if (finalResult.finalizedCount === 0) {
                    throw new Error('最终交付包没有生成任何图片');
                }
                if (finalResult.failedCount > 0 && !allowPartialPostprocess) {
                    throw new Error(`最终交付包生成完成，但有 ${finalResult.failedCount} 张失败`);
                }
                run = finalResult.run;

                const partialFinal = finalResult.failedCount > 0 || failedTargets > 0 || standardizedResult.failedCount > 0;
                updateProgress({
                    phase: 'completed',
                    completed: tasks.length,
                    success: generatedTargets,
                    failed: Math.max(failedTargets, finalResult.failedCount || 0, standardizedResult.failedCount || 0),
                    saved: finalResult.finalizedCount,
                    finalizedCount: finalResult.finalizedCount,
                    finalPackageRoot: finalResult.finalPackageRoot,
                    currentAction: partialFinal
                        ? `最终交付包已部分生成：${finalResult.finalPackageRoot}；失败/跳过 ${Math.max(failedTargets, finalResult.failedCount || 0, standardizedResult.failedCount || 0)} 项`
                        : `最终交付包已生成：${finalResult.finalPackageRoot}`
                });
                logger.system(partialFinal
                    ? `✅ 完整改尺寸交付部分完成：${finalResult.finalPackageRoot}，失败/跳过 ${Math.max(failedTargets, finalResult.failedCount || 0, standardizedResult.failedCount || 0)} 项`
                    : `✅ 完整改尺寸交付完成：${finalResult.finalPackageRoot}`);
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
        const completeJobDelivery = shouldCompleteJobDelivery(run, requestOptions);
        if (requestOptions.failedOnly === true && tasks.length === 0) {
            updateRunStatusFromTargets(run);
            store.saveRun(run);
            return res.json({
                success: true,
                run: publicRun(run),
                totalTargets: 0,
                failedOnly: true,
                message: '没有失败任务需要补跑'
            });
        }
        if (tasks.length === 0 && !completeDelivery && !completeJobDelivery) {
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
            postprocess: completeDelivery || completeJobDelivery,
            failedOnly: requestOptions.failedOnly === true,
            message: requestOptions.failedOnly === true
                ? `已启动失败任务补跑，共 ${tasks.length} 个 target；完成后会继续生成最终交付包。`
                : completeDelivery
                ? `已启动完整改尺寸交付，共 ${tasks.length} 个 target；任务结束时会直接生成最终交付包。`
                : `已启动 S10.3 Legil 三尺寸候选生成，共 ${tasks.length} 个 target。请通过任务列表和日志查看进度。`
        });

        setImmediate(() => {
            const runner = (completeDelivery || completeJobDelivery) ? runDeliveryJobsClosedLoop : runDeliveryCandidates;
            runner(run.runId, {
                ...requestOptions,
                completeDelivery: completeDelivery || completeJobDelivery
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

    app.post('/api/delivery/runs/:runId/retry-failed', (req, res) => {
        startDeliveryRun(req, res, {
            runId: req.params.runId,
            failedOnly: true
        });
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
