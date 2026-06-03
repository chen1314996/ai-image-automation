/**
 * 图片重命名页面接口。
 */
const {
    DEFAULT_RENAME_PREFIX,
    buildRenamePlan,
    renameImages
} = require('../services/image-renamer');
const {
    buildResizePlan,
    resizeImages
} = require('../services/image-resizer');
const {
    DEFAULT_LOGO_FILE_NAME,
    applyLogoOverlay,
    buildLogoOverlayPlan
} = require('../services/image-logo-overlay');
const {
    PACKAGE_TARGET_SIZES,
    buildPackagePlan,
    packageImages
} = require('../services/image-packager');
const { createPostprocessTraceService } = require('../services/postprocess-trace');

function pickResponseItems(items = [], limit = 80) {
    return items.slice(0, limit).map(item => ({
        originalName: item.originalName,
        outputName: item.outputName,
        chinesePart: item.chinesePart,
        dimensions: item.dimensions || '',
        originalDimensions: item.originalDimensions || '',
        targetDimensions: item.targetDimensions || '',
        cropSummary: item.cropSummary || '',
        logoFileName: item.logoFileName || '',
        logoDimensions: item.logoDimensions || '',
        folderName: item.folderName || '',
        groupName: item.groupName || '',
        fileCount: item.fileCount || 0,
        sizes: Array.isArray(item.sizes) ? item.sizes : [],
        files: Array.isArray(item.files)
            ? item.files.map(file => ({
                originalName: file.originalName,
                size: file.size,
                sourcePath: file.sourcePath || '',
                outputPath: file.outputPath || ''
            }))
            : [],
        quality: item.quality || '',
        sizeBytes: item.sizeBytes || 0,
        sequenceNumber: item.sequenceNumber || '',
        sourcePath: item.sourcePath || '',
        outputPath: item.outputPath || '',
        sourceAssetId: item.sourceAssetId || '',
        sourceRunId: item.sourceRunId || '',
        sourcePromptId: item.sourcePromptId || '',
        derivativeId: item.derivativeId || '',
        reason: item.reason || ''
    }));
}

function pickRenamePayload(body = {}) {
    return {
        inputFolder: body && body.inputFolder,
        outputFolder: body && body.outputFolder,
        prefix: body && body.prefix,
        fixedPrefix: body && body.fixedPrefix,
        startNumber: body && body.startNumber,
        regionText: body && body.regionText,
        channelText: body && body.channelText,
        primaryTag: body && body.primaryTag,
        secondaryTag: body && body.secondaryTag
    };
}

function pickResizePayload(body = {}) {
    return {
        inputFolder: body && body.inputFolder,
        outputFolder: body && body.outputFolder,
        targetSize: body && body.targetSize
    };
}

function pickLogoPayload(body = {}) {
    return {
        inputFolder: body && body.inputFolder,
        outputFolder: body && body.outputFolder,
        logoFileName: body && body.logoFileName
    };
}

function pickPackagePayload(body = {}) {
    return {
        inputFolder: body && body.inputFolder,
        outputFolder: body && body.outputFolder
    };
}

module.exports = function registerRenameRoutes(app, context) {
    const { logger } = context;
    const traceService = createPostprocessTraceService(context);

    function attachTrace(operation, result, successItemsKey, config = {}) {
        try {
            const trace = traceService.recordOperationResult({
                operation,
                result,
                successItemsKey,
                failedItemsKey: 'failed',
                config
            });
            if (trace && trace.derivativeCount) {
                logger.info(`S10后处理追溯已登记：${operation} ${trace.derivativeCount} 个派生产物`);
            }
            return trace;
        } catch (error) {
            logger.warn(`S10后处理追溯登记失败：${operation} - ${error.message}`);
            return {
                success: false,
                message: error.message
            };
        }
    }

    app.post('/api/postprocess/prepare-assets', (req, res) => {
        try {
            const result = traceService.prepareAssets(req.body || {});
            logger.info(`S10已准备后处理输入目录：${result.outputFolder}，资产 ${result.count} 张`);
            res.json({
                ...result,
                message: `已准备 ${result.count} 张资产，可送入重命名或改尺寸`
            });
        } catch (error) {
            res.status(400).json({
                success: false,
                message: error.message
            });
        }
    });

    app.post('/api/rename-images/preview', (req, res) => {
        try {
            const plan = buildRenamePlan(pickRenamePayload(req.body || {}));

            res.json({
                success: true,
                config: {
                    inputFolder: plan.inputFolder,
                    outputFolder: plan.outputFolder,
                    prefix: plan.prefix || DEFAULT_RENAME_PREFIX,
                    rule: plan.rule
                },
                totalImages: plan.totalImages,
                readyCount: plan.readyCount,
                skippedCount: plan.skippedCount,
                outputFolderExists: plan.outputFolderExists,
                items: pickResponseItems(plan.items),
                skipped: pickResponseItems(plan.skipped),
                message: `已生成预览：可重命名 ${plan.readyCount} 张，跳过 ${plan.skippedCount} 张`
            });
        } catch (error) {
            res.json({
                success: false,
                message: error.message
            });
        }
    });

    app.post('/api/rename-images/run', (req, res) => {
        try {
            const result = renameImages(pickRenamePayload(req.body || {}));
            const trace = attachTrace('rename', result, 'copied', result.rule || {});

            logger.system('图片重命名任务完成');
            logger.info(`输入文件夹: ${result.inputFolder}`);
            logger.info(`输出文件夹: ${result.outputFolder}`);
            logger.info(`成功复制并重命名 ${result.copiedCount} 张，跳过 ${result.skippedCount} 张，失败 ${result.failedCount} 张`);

            res.json({
                success: result.failedCount === 0,
                config: {
                    inputFolder: result.inputFolder,
                    outputFolder: result.outputFolder,
                    prefix: result.prefix || DEFAULT_RENAME_PREFIX,
                    rule: result.rule
                },
                totalImages: result.totalImages,
                readyCount: result.readyCount,
                skippedCount: result.skippedCount,
                copiedCount: result.copiedCount,
                failedCount: result.failedCount,
                trace,
                items: pickResponseItems(result.copied),
                skipped: pickResponseItems(result.skipped),
                failed: pickResponseItems(result.failed),
                message: result.failedCount === 0
                    ? `已输出 ${result.copiedCount} 张重命名图片`
                    : `已输出 ${result.copiedCount} 张，失败 ${result.failedCount} 张`
            });
        } catch (error) {
            res.json({
                success: false,
                message: error.message
            });
        }
    });

    app.post('/api/resize-images/preview', (req, res) => {
        try {
            const plan = buildResizePlan(pickResizePayload(req.body || {}));

            res.json({
                success: true,
                config: {
                    inputFolder: plan.inputFolder,
                    outputFolder: plan.outputFolder,
                    targetSize: plan.targetSize,
                    maxOutputKb: plan.maxOutputKb,
                    minQuality: plan.minQuality,
                    outputExtension: plan.outputExtension
                },
                totalImages: plan.totalImages,
                readyCount: plan.readyCount,
                skippedCount: plan.skippedCount,
                outputFolderExists: plan.outputFolderExists,
                items: pickResponseItems(plan.items),
                skipped: pickResponseItems(plan.skipped),
                message: `已生成改尺寸预览：可处理 ${plan.readyCount} 张，跳过 ${plan.skippedCount} 张`
            });
        } catch (error) {
            res.json({
                success: false,
                message: error.message
            });
        }
    });

    app.post('/api/resize-images/run', async (req, res) => {
        try {
            const result = await resizeImages(pickResizePayload(req.body || {}));
            const trace = attachTrace('resize', result, 'resized', {
                targetSize: result.targetSize
            });

            logger.system('本地批量改尺寸任务完成');
            logger.info(`输入文件夹: ${result.inputFolder}`);
            logger.info(`输出文件夹: ${result.outputFolder}`);
            logger.info(`目标尺寸: ${result.targetSize}，输出 JPG，最大 ${result.maxOutputKb}KB`);
            logger.info(`成功输出 ${result.resizedCount} 张，跳过 ${result.skippedCount} 张，失败 ${result.failedCount} 张`);

            res.json({
                success: result.failedCount === 0,
                config: {
                    inputFolder: result.inputFolder,
                    outputFolder: result.outputFolder,
                    targetSize: result.targetSize,
                    maxOutputKb: result.maxOutputKb,
                    minQuality: result.minQuality,
                    outputExtension: result.outputExtension
                },
                totalImages: result.totalImages,
                readyCount: result.readyCount,
                skippedCount: result.skippedCount,
                resizedCount: result.resizedCount,
                failedCount: result.failedCount,
                trace,
                items: pickResponseItems(result.resized),
                skipped: pickResponseItems(result.skipped),
                failed: pickResponseItems(result.failed),
                message: result.failedCount === 0
                    ? `已输出 ${result.resizedCount} 张 JPG 图片`
                    : `已输出 ${result.resizedCount} 张，失败 ${result.failedCount} 张`
            });
        } catch (error) {
            res.json({
                success: false,
                message: error.message
            });
        }
    });

    app.post('/api/logo-overlay/preview', (req, res) => {
        try {
            const plan = buildLogoOverlayPlan(pickLogoPayload(req.body || {}));

            res.json({
                success: true,
                config: {
                    inputFolder: plan.inputFolder,
                    outputFolder: plan.outputFolder,
                    logoFileName: plan.logoFileName || DEFAULT_LOGO_FILE_NAME,
                    logoPath: plan.logoPath,
                    logoDimensions: plan.logoDimensions,
                    maxOutputKb: plan.maxOutputKb,
                    minQuality: plan.minQuality,
                    outputExtension: plan.outputExtension
                },
                totalImages: plan.totalImages,
                readyCount: plan.readyCount,
                skippedCount: plan.skippedCount,
                outputFolderExists: plan.outputFolderExists,
                items: pickResponseItems(plan.items),
                skipped: pickResponseItems(plan.skipped),
                message: `已生成加LOGO预览：可处理 ${plan.readyCount} 张，跳过 ${plan.skippedCount} 张`
            });
        } catch (error) {
            res.json({
                success: false,
                message: error.message
            });
        }
    });

    app.post('/api/logo-overlay/run', async (req, res) => {
        try {
            const result = await applyLogoOverlay(pickLogoPayload(req.body || {}));
            const trace = attachTrace('logo', result, 'applied', {
                logoFileName: result.logoFileName
            });

            logger.system('本地批量加LOGO任务完成');
            logger.info(`待处理图片目录: ${result.inputFolder}`);
            logger.info(`输出目录: ${result.outputFolder}`);
            logger.info(`LOGO文件: ${result.logoFileName} (${result.logoDimensions})`);
            logger.info(`成功输出 ${result.appliedCount} 张，跳过 ${result.skippedCount} 张，失败 ${result.failedCount} 张`);

            res.json({
                success: result.failedCount === 0,
                config: {
                    inputFolder: result.inputFolder,
                    outputFolder: result.outputFolder,
                    logoFileName: result.logoFileName || DEFAULT_LOGO_FILE_NAME,
                    logoPath: result.logoPath,
                    logoDimensions: result.logoDimensions,
                    maxOutputKb: result.maxOutputKb,
                    minQuality: result.minQuality,
                    outputExtension: result.outputExtension
                },
                totalImages: result.totalImages,
                readyCount: result.readyCount,
                skippedCount: result.skippedCount,
                appliedCount: result.appliedCount,
                failedCount: result.failedCount,
                trace,
                items: pickResponseItems(result.applied),
                skipped: pickResponseItems(result.skipped),
                failed: pickResponseItems(result.failed),
                message: result.failedCount === 0
                    ? `已输出 ${result.appliedCount} 张加LOGO图片`
                    : `已输出 ${result.appliedCount} 张，失败 ${result.failedCount} 张`
            });
        } catch (error) {
            res.json({
                success: false,
                message: error.message
            });
        }
    });

    app.post('/api/package-images/preview', (req, res) => {
        try {
            const plan = buildPackagePlan(pickPackagePayload(req.body || {}));

            res.json({
                success: true,
                config: {
                    inputFolder: plan.inputFolder,
                    outputFolder: plan.outputFolder,
                    requiredSizes: plan.requiredSizes || PACKAGE_TARGET_SIZES
                },
                totalImages: plan.totalImages,
                totalGroups: plan.totalGroups,
                readyCount: plan.readyCount,
                skippedCount: plan.skippedCount,
                outputFolderExists: plan.outputFolderExists,
                items: pickResponseItems(plan.items),
                skipped: pickResponseItems(plan.skipped),
                message: `已生成打包预览：可打包 ${plan.readyCount} 组，跳过 ${plan.skippedCount} 项`
            });
        } catch (error) {
            res.json({
                success: false,
                message: error.message
            });
        }
    });

    app.post('/api/package-images/run', (req, res) => {
        try {
            const result = packageImages(pickPackagePayload(req.body || {}));
            const trace = attachTrace('package', result, 'packaged', {
                requiredSizes: result.requiredSizes
            });

            logger.system('本地批量打包文件夹任务完成');
            logger.info(`待打包图片目录: ${result.inputFolder}`);
            logger.info(`打包输出目录: ${result.outputFolder}`);
            logger.info(`成功打包 ${result.packagedCount} 组，跳过 ${result.skippedCount} 项，失败 ${result.failedCount} 组`);

            res.json({
                success: result.failedCount === 0,
                config: {
                    inputFolder: result.inputFolder,
                    outputFolder: result.outputFolder,
                    requiredSizes: result.requiredSizes || PACKAGE_TARGET_SIZES
                },
                totalImages: result.totalImages,
                totalGroups: result.totalGroups,
                readyCount: result.readyCount,
                skippedCount: result.skippedCount,
                packagedCount: result.packagedCount,
                failedCount: result.failedCount,
                trace,
                items: pickResponseItems(result.packaged),
                skipped: pickResponseItems(result.skipped),
                failed: pickResponseItems(result.failed),
                message: result.failedCount === 0
                    ? `已打包 ${result.packagedCount} 个文件夹`
                    : `已打包 ${result.packagedCount} 个文件夹，失败 ${result.failedCount} 组`
            });
        } catch (error) {
            res.json({
                success: false,
                message: error.message
            });
        }
    });
};
