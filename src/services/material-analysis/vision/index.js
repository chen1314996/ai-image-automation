const { MaterialAnalysisStore } = require('../store');
const { analyzeMaterialRun } = require('../analyzer');
const { hydrateContentUrlsFromRows, workbookRowsFromText } = require('../importer');
const { MaterialImageFetcher } = require('./image-fetcher');
const { MaterialVisionCache } = require('./vision-cache');
const { MaterialVisionClient } = require('./vision-client');

const DEFAULT_CONCURRENCY = 3;
const DEFAULT_RETRIES = 1;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function clampInteger(value, fallback, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(min, Math.min(max, Math.floor(number)));
}

function compactMaterial(material = {}) {
    return {
        materialId: material.materialId,
        runId: material.runId,
        topRank: material.topRank,
        materialName: material.materialName,
        contentUrl: material.contentUrl,
        spend: material.spend,
        d0IapRoi: material.d0IapRoi,
        cpi: material.cpi,
        ipm: material.ipm,
        ctr: material.ctr,
        cvr: material.cvr,
        parsedName: material.parsedName,
        health: material.health
    };
}

function materialImageSource(material = {}) {
    return String(material.contentUrl || material.contentText || '').trim();
}

function hasMaterialImageSource(material = {}) {
    const source = materialImageSource(material);
    if (!source) return false;
    if (/^data:image\//i.test(source)) return true;
    if (/^https?:\/\/\S+/i.test(source)) return true;
    return /\.(png|jpe?g|webp|gif|bmp)(\?.*)?$/i.test(source);
}

function buildMissingImageResult(runId, material) {
    const now = new Date().toISOString();
    return {
        material: compactMaterial(material),
        materialId: material.materialId,
        runId,
        status: 'failed',
        missingImage: true,
        error: '素材没有可识别的图片链接，请确认表格“素材内容”列包含图片 URL、Data URL 或本地图片路径。',
        startedAt: now,
        finishedAt: now,
        updatedAt: now
    };
}

function isFatalVisionError(error) {
    return Boolean(error && error.fatal);
}

function fatalVisionMessage(error) {
    if (!error) return '视觉识别任务被中断';
    return error.userMessage || error.message || String(error);
}

function isModelLimitText(value) {
    return /reached the set inference limit|Safe Experience Mode|model service has been paused|inference limit|推理限制|模型服务被暂停/i.test(String(value || ''));
}

function shouldReuseVisionResult(result) {
    if (!result) return false;
    if (result.missingImage || result.fatal) return false;
    if (result.errorCode === 'MODEL_INFERENCE_LIMIT') return false;
    if (isModelLimitText(result.error) || isModelLimitText(result.errorDetail)) return false;
    return true;
}

function isSameVisionProviderCache(cached = {}, cacheMeta = null) {
    if (!cacheMeta || !cacheMeta.provider) return true;
    if (!cached.provider) return false;
    return cached.provider === cacheMeta.provider &&
        (!cacheMeta.model || cached.model === cacheMeta.model) &&
        (!cacheMeta.modelProvider || cached.modelProvider === cacheMeta.modelProvider);
}

function emptyStatus(runId) {
    return {
        runId,
        state: 'idle',
        running: false,
        total: 0,
        completed: 0,
        successCount: 0,
        failedCount: 0,
        cachedCount: 0,
        imageReadyCount: 0,
        missingImageCount: 0,
        pendingCount: 0,
        startedAt: null,
        finishedAt: null,
        updatedAt: null,
        message: '尚未启动视觉识别'
    };
}

class MaterialVisionService {
    constructor(options = {}) {
        this.rootDir = options.ROOT_DIR || options.rootDir || process.cwd();
        this.logger = options.logger;
        this.store = options.store || new MaterialAnalysisStore(this.rootDir);
        this.cache = options.cache || new MaterialVisionCache(this.rootDir);
        this.fetcher = options.fetcher || new MaterialImageFetcher(options.fetcherOptions);
        this.client = options.client || new MaterialVisionClient({
            axios: options.axios
        });
        this.tasks = new Map();
    }

    log(type, message) {
        const method = type === 'success' ? 'info' : type;
        if (this.logger && typeof this.logger[method] === 'function') {
            this.logger[method](message);
        }
    }

    loadRunMaterials(runId) {
        const summary = this.store.findImport(runId);
        if (!summary) {
            throw new Error('素材分析导入记录不存在');
        }
        const materials = this.hydrateStoredMaterials(runId, this.store.readImportFile(runId, 'normalized-materials.json', []));
        const top100 = this.hydrateStoredMaterials(runId, this.store.readImportFile(runId, 'top100.json', []));
        const analysis = analyzeMaterialRun(summary, materials, top100);
        return {
            summary,
            materials: analysis.materials,
            top100: analysis.top100
        };
    }

    hydrateStoredMaterials(runId, materials = []) {
        if (!Array.isArray(materials) || !materials.length) return [];
        if (materials.some(material => material.contentUrl)) return materials;
        const summary = this.store.findImport(runId);
        const sourceText = this.store.readImportTextFile(runId, 'source.csv', '');
        if (!summary || !sourceText) return materials;
        try {
            const parsed = workbookRowsFromText(sourceText, summary.sourceFileName || 'source.csv');
            return hydrateContentUrlsFromRows(materials, parsed.rows);
        } catch (error) {
            return materials;
        }
    }

    findMaterial(materialId) {
        const imports = this.store.listImports();
        for (const item of imports) {
            const detail = this.loadRunMaterials(item.runId);
            const material = detail.top100.find(row => row.materialId === materialId) ||
                detail.materials.find(row => row.materialId === materialId);
            if (material) {
                return {
                    runId: item.runId,
                    summary: detail.summary,
                    material
                };
            }
        }
        return null;
    }

    getRunPayload(runId) {
        const payload = this.cache.readRun(runId) || {
            status: emptyStatus(runId),
            results: []
        };
        return this.normalizeStaleRunPayload(runId, payload);
    }

    writeRunPayload(runId, status, results) {
        return this.cache.writeRun(runId, {
            status,
            results
        });
    }

    normalizeStaleRunPayload(runId, payload) {
        if (!payload || !payload.status || payload.status.running !== true || this.tasks.has(runId)) {
            return payload;
        }

        const results = Array.isArray(payload.results) ? payload.results : [];
        const now = new Date().toISOString();
        const status = this.summarizeResults(runId, results, {
            ...(payload.status || {}),
            state: 'interrupted',
            running: false,
            finishedAt: payload.status.finishedAt || now,
            updatedAt: now,
            message: '上次视觉识别在服务器重启或异常中断后已自动解锁，可重新开始识别'
        });
        return this.writeRunPayload(runId, status, results);
    }

    cancelRun(runId) {
        const task = this.tasks.get(runId);
        if (!task) return false;
        task.cancelled = true;
        this.tasks.delete(runId);
        this.log('warn', `绱犳潗鍒嗘瀽瑙嗚璇嗗埆浠诲姟宸插彇娑堬細${runId}`);
        return true;
    }

    clearRun(runId) {
        const task = this.tasks.get(runId);
        if (task) {
            task.cancelled = true;
            this.tasks.delete(runId);
        }

        const payload = this.cache.readRun(runId) || {
            status: emptyStatus(runId),
            results: []
        };
        const results = Array.isArray(task && task.results)
            ? task.results
            : (Array.isArray(payload.results) ? payload.results : []);
        const now = new Date().toISOString();
        const status = results.length
            ? this.summarizeResults(runId, results, {
                ...(payload.status || {}),
                state: 'idle',
                running: false,
                finishedAt: now,
                updatedAt: now,
                message: '已清除视觉识别任务状态，已识别结果会保留，可重新开始识别'
            })
            : {
                ...emptyStatus(runId),
                state: 'idle',
                running: false,
                finishedAt: now,
                updatedAt: now,
                message: '已清除视觉识别任务状态，可重新开始识别'
            };

        this.writeRunPayload(runId, status, results);
        this.log('warn', `素材分析视觉识别任务已清除：${runId}`);
        return {
            success: true,
            status,
            results,
            message: status.message
        };
    }

    deleteTaskIfCurrent(task) {
        if (task && this.tasks.get(task.runId) === task) {
            this.tasks.delete(task.runId);
        }
    }

    getStatus(runId) {
        const task = this.tasks.get(runId);
        if (task) return { success: true, status: task.status };
        const payload = this.getRunPayload(runId);
        return { success: true, status: payload.status || emptyStatus(runId) };
    }

    getResults(runId) {
        const task = this.tasks.get(runId);
        if (task) {
            return {
                success: true,
                status: task.status,
                results: task.results
            };
        }
        const payload = this.getRunPayload(runId);
        return {
            success: true,
            status: payload.status || emptyStatus(runId),
            results: Array.isArray(payload.results) ? payload.results : []
        };
    }

    summarizeResults(runId, results = [], base = {}) {
        const successCount = results.filter(item => item.status === 'success').length;
        const failedCount = results.filter(item => item.status === 'failed').length;
        const cachedCount = results.filter(item => item.status === 'success' && item.source === 'cache').length;
        const pendingCount = results.filter(item => !item.status || item.status === 'pending').length;
        const missingImageCount = results.filter(item => item.missingImage).length;
        const total = results.length;
        const defaultState = pendingCount > 0 ? 'partial' : 'completed';
        const defaultMessage = `视觉识别结果：成功 ${successCount}，失败 ${failedCount}，未识别 ${pendingCount}`;
        return {
            ...emptyStatus(runId),
            ...base,
            state: base.state || defaultState,
            running: false,
            total,
            completed: successCount + failedCount,
            successCount,
            failedCount,
            cachedCount,
            imageReadyCount: Math.max(0, total - missingImageCount),
            missingImageCount,
            pendingCount,
            updatedAt: new Date().toISOString(),
            message: base.message || defaultMessage
        };
    }

    startRun(runId, options = {}) {
        if (this.tasks.has(runId)) {
            return {
                success: true,
                status: this.tasks.get(runId).status,
                message: '视觉识别已经在运行'
            };
        }

        const { top100 } = this.loadRunMaterials(runId);
        const allMaterials = top100.slice(0, 100);
        const selectedIds = Array.isArray(options.materialIds)
            ? new Set(options.materialIds.map(value => String(value || '').trim()).filter(Boolean))
            : null;
        const targetMaterials = selectedIds && selectedIds.size
            ? allMaterials.filter(material => selectedIds.has(material.materialId))
            : allMaterials;
        if (selectedIds && selectedIds.size && !targetMaterials.length) {
            return {
                success: false,
                status: emptyStatus(runId),
                message: '没有匹配到需要识别的素材'
            };
        }
        const targetIds = new Set(targetMaterials.map(material => material.materialId));
        const materials = targetMaterials.filter(hasMaterialImageSource);
        const missingMaterials = targetMaterials.filter(material => !hasMaterialImageSource(material));
        const previous = this.getRunPayload(runId);
        const previousResults = Array.isArray(previous.results) ? previous.results : [];
        const resultsById = new Map(previousResults.map(item => [item.materialId, item]));
        const results = allMaterials.map(material => {
            const previousResult = resultsById.get(material.materialId);
            if (!targetIds.has(material.materialId)) {
                return previousResult || {
                    material: compactMaterial(material),
                    materialId: material.materialId,
                    runId,
                    status: 'pending',
                    imageHash: this.cache.imageHashForMaterial(material),
                    updatedAt: null
                };
            }
            if (!hasMaterialImageSource(material)) {
                return buildMissingImageResult(runId, material);
            }
            if (shouldReuseVisionResult(previousResult)) return previousResult;
            return {
                material: compactMaterial(material),
                materialId: material.materialId,
                runId,
                status: 'pending',
                imageHash: this.cache.imageHashForMaterial(material),
                updatedAt: null
            };
        });

        if (!materials.length) {
            const blockedStatus = {
                ...emptyStatus(runId),
                state: 'blocked',
                running: false,
                total: targetMaterials.length,
                completed: missingMaterials.length,
                failedCount: missingMaterials.length,
                imageReadyCount: 0,
                missingImageCount: missingMaterials.length,
                pendingCount: 0,
                startedAt: new Date().toISOString(),
                finishedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                message: 'Top100 没有可识别的图片链接，请先确认表格“素材内容”列是否包含图片 URL。'
            };
            this.writeRunPayload(runId, blockedStatus, results);
            return {
                success: false,
                status: blockedStatus,
                message: blockedStatus.message
            };
        }

        this.client.validateConfig();
        const status = {
            ...emptyStatus(runId),
            state: 'running',
            running: true,
            total: targetMaterials.length,
            completed: missingMaterials.length,
            failedCount: missingMaterials.length,
            imageReadyCount: materials.length,
            missingImageCount: missingMaterials.length,
            pendingCount: materials.length,
            startedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            message: missingMaterials.length
                ? `视觉识别已启动：可识别 ${materials.length} 条，缺图片链接 ${missingMaterials.length} 条`
                : '视觉识别已启动'
        };

        const task = {
            runId,
            materials,
            results,
            status,
            targetMaterialIds: [...targetIds],
            concurrency: clampInteger(options.concurrency, DEFAULT_CONCURRENCY, 1, 5),
            retries: clampInteger(options.retries, DEFAULT_RETRIES, 0, 2)
        };

        this.tasks.set(runId, task);
        this.writeRunPayload(runId, status, results);
        this.log('system', `素材分析视觉识别启动：${runId}，Top100 共 ${materials.length} 条`);

        setImmediate(() => {
            this.runTask(task).catch(error => {
                task.status.state = 'failed';
                task.status.running = false;
                task.status.message = error.message || '视觉识别任务异常';
                task.status.finishedAt = new Date().toISOString();
                this.writeRunPayload(runId, task.status, task.results);
                this.deleteTaskIfCurrent(task);
                this.log('error', `素材分析视觉识别任务异常：${error.message}`);
            });
        });

        return {
            success: true,
            status,
            message: '视觉识别已启动'
        };
    }

    async runTask(task) {
        let nextIndex = 0;
        const workers = Array.from({ length: task.concurrency }, async () => {
            while (nextIndex < task.materials.length && !task.cancelled) {
                if (task.fatalError) break;
                const index = nextIndex;
                nextIndex += 1;
                await this.processMaterial(task, task.materials[index], index);
            }
        });

        await Promise.all(workers);
        if (task.cancelled) {
            this.deleteTaskIfCurrent(task);
            return;
        }
        task.status.state = task.fatalError ? 'failed' : (task.status.failedCount > 0 && task.status.successCount === 0 ? 'failed' : 'completed');
        task.status.running = false;
        task.status.pendingCount = 0;
        task.status.finishedAt = new Date().toISOString();
        task.status.updatedAt = task.status.finishedAt;
        task.status.message = task.fatalError
            ? fatalVisionMessage(task.fatalError)
            : `视觉识别完成：成功 ${task.status.successCount}，失败 ${task.status.failedCount}，缓存 ${task.status.cachedCount}`;
        this.writeRunPayload(task.runId, task.status, task.results);
        this.deleteTaskIfCurrent(task);
        this.log('success', `素材分析视觉识别完成：${task.runId}，成功 ${task.status.successCount}，失败 ${task.status.failedCount}`);
    }

    getClientCacheMeta() {
        if (!this.client || typeof this.client.getCacheMeta !== 'function') return null;
        try {
            return this.client.getCacheMeta();
        } catch (error) {
            return null;
        }
    }

    async processMaterial(task, material, index) {
        if (task.cancelled) return;
        const resultIndex = task.results.findIndex(item => item.materialId === material.materialId);
        const imageHash = this.cache.imageHashForMaterial(material);
        const startedAt = new Date().toISOString();
        const cached = this.cache.readImageCache(imageHash);
        const cacheMeta = this.getClientCacheMeta();

        if (!task.forceRefresh && cached && cached.status === 'success' && cached.vision && isSameVisionProviderCache(cached, cacheMeta)) {
            if (task.cancelled) return;
            task.results[resultIndex] = this.buildSuccessResult(task.runId, material, {
                imageHash,
                vision: cached.vision,
                rawText: cached.rawText || '',
                source: 'cache',
                cacheMeta,
                startedAt,
                finishedAt: new Date().toISOString()
            });
            task.status.cachedCount += 1;
            task.status.successCount += 1;
            this.updateProgress(task, material, index, '复用缓存');
            return;
        }

        this.log('info', `视觉识别 ${index + 1}/${task.materials.length}：${material.materialName || material.materialId}`);

        let lastError = null;
        for (let attempt = 0; attempt <= task.retries; attempt += 1) {
            try {
                const image = await this.fetcher.fetchImage(material);
                const response = await this.client.analyzeImage({
                    material,
                    imageDataUrl: image.dataUrl
                });
                if (task.cancelled) return;
                const finishedAt = new Date().toISOString();
                const successResult = this.buildSuccessResult(task.runId, material, {
                    imageHash,
                    vision: response.result,
                    rawText: response.rawText,
                    source: 'api',
                    image,
                    cacheMeta,
                    startedAt,
                    finishedAt
                });
                task.results[resultIndex] = successResult;
                this.cache.writeImageCache(imageHash, {
                    status: 'success',
                    sourceUrl: material.contentUrl,
                    ...(cacheMeta || {}),
                    vision: response.result,
                    rawText: response.rawText
                });
                task.status.successCount += 1;
                this.updateProgress(task, material, index, '识别成功');
                return;
            } catch (error) {
                if (task.cancelled) return;
                lastError = error;
                if (isFatalVisionError(error)) break;
                if (attempt < task.retries) {
                    await sleep(600 + attempt * 600);
                }
            }
        }

        if (task.cancelled) return;
        task.results[resultIndex] = this.buildFailedResult(task.runId, material, imageHash, lastError, startedAt);
        task.status.failedCount += 1;
        this.updateProgress(task, material, index, '识别失败');
        this.log('warn', `视觉识别失败：${material.materialName || material.materialId}，${lastError && lastError.message}`);
        if (isFatalVisionError(lastError)) {
            task.fatalError = lastError;
        }
    }

    buildSuccessResult(runId, material, payload) {
        const vision = payload.vision || {};
        return {
            material: compactMaterial(material),
            materialId: material.materialId,
            runId,
            status: 'success',
            imageHash: payload.imageHash,
            source: payload.source,
            ...(payload.cacheMeta || {}),
            vision,
            iterationAdvice: this.buildIterationAdvice(material, vision),
            rawText: payload.rawText,
            imageMeta: payload.image ? {
                mimeType: payload.image.mimeType,
                sizeBytes: payload.image.sizeBytes,
                sourceUrl: payload.image.sourceUrl
            } : undefined,
            startedAt: payload.startedAt,
            finishedAt: payload.finishedAt,
            updatedAt: payload.finishedAt
        };
    }

    buildFailedResult(runId, material, imageHash, error, startedAt) {
        const now = new Date().toISOString();
        return {
            material: compactMaterial(material),
            materialId: material.materialId,
            runId,
            status: 'failed',
            imageHash,
            error: error && error.message ? error.message : String(error || '识别失败'),
            errorCode: error && error.code ? error.code : undefined,
            errorDetail: error && error.detail ? error.detail : undefined,
            fatal: Boolean(error && error.fatal),
            userMessage: error && error.userMessage ? error.userMessage : undefined,
            startedAt,
            finishedAt: now,
            updatedAt: now
        };
    }

    buildIterationAdvice(material = {}, vision = {}) {
        const retain = Array.isArray(vision.retainElements) ? vision.retainElements.slice(0, 3) : [];
        const axes = Array.isArray(vision.variationAxes) ? vision.variationAxes.slice(0, 4) : [];
        const risks = Array.isArray(vision.riskNotes) ? vision.riskNotes.slice(0, 2) : [];
        const healthAction = material.health && material.health.action ? material.health.action : '';
        return [
            retain.length ? `保留：${retain.join('、')}` : '',
            axes.length ? `迭代：${axes.join('、')}` : '',
            risks.length ? `注意：${risks.join('、')}` : '',
            healthAction ? `投放动作：${healthAction}` : ''
        ].filter(Boolean).join('。');
    }

    updateProgress(task, material, index, message) {
        if (task.cancelled) return;
        task.status.completed += 1;
        task.status.pendingCount = Math.max(0, task.status.total - task.status.completed);
        task.status.updatedAt = new Date().toISOString();
        task.status.message = `${message}：${index + 1}/${task.status.total}`;
        this.writeRunPayload(task.runId, task.status, task.results);
    }

    async retryMaterial(materialId) {
        const found = this.findMaterial(materialId);
        if (!found) {
            return {
                success: false,
                message: '素材不存在'
            };
        }
        const runId = found.runId;
        if (this.tasks.has(runId)) {
            return {
                success: false,
                message: '该周视觉识别正在运行，请完成后再单张重跑'
            };
        }

        if (!hasMaterialImageSource(found.material)) {
            const payload = this.getRunPayload(runId);
            const results = Array.isArray(payload.results) ? payload.results : [];
            const result = buildMissingImageResult(runId, found.material);
            const existingIndex = results.findIndex(item => item.materialId === materialId);
            if (existingIndex >= 0) {
                results[existingIndex] = result;
            } else {
                results.push(result);
            }
            const finalStatus = this.summarizeResults(runId, results, {
                state: 'blocked',
                message: result.error,
                finishedAt: new Date().toISOString()
            });
            this.writeRunPayload(runId, finalStatus, results);
            return {
                success: false,
                status: finalStatus,
                result,
                message: result.error
            };
        }

        this.client.validateConfig();
        const payload = this.getRunPayload(runId);
        const status = {
            ...(payload.status || emptyStatus(runId)),
            state: 'running',
            running: true,
            total: 1,
            completed: 0,
            successCount: 0,
            failedCount: 0,
            cachedCount: 0,
            pendingCount: 1,
            startedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            message: '单素材视觉识别重跑中'
        };
        const task = {
            runId,
            materials: [found.material],
            results: Array.isArray(payload.results) ? payload.results : [],
            status,
            concurrency: 1,
            retries: DEFAULT_RETRIES,
            forceRefresh: true
        };
        const existingIndex = task.results.findIndex(item => item.materialId === materialId);
        const nextResult = {
            material: compactMaterial(found.material),
            materialId,
            runId,
            status: 'pending',
            imageHash: this.cache.imageHashForMaterial(found.material),
            updatedAt: null
        };
        if (existingIndex >= 0) {
            task.results[existingIndex] = nextResult;
        } else {
            task.results.push(nextResult);
        }
        await this.processMaterial(task, found.material, 0);
        const finalStatus = this.summarizeResults(runId, task.results, {
            finishedAt: new Date().toISOString(),
            message: task.status.failedCount ? '单素材视觉识别失败' : '单素材视觉识别完成'
        });
        this.writeRunPayload(runId, finalStatus, task.results);
        return {
            success: task.status.failedCount === 0,
            status: finalStatus,
            result: task.results.find(item => item.materialId === materialId),
            message: task.status.failedCount ? '单素材视觉识别失败' : '单素材视觉识别完成'
        };
    }
}

function createMaterialVisionService(options) {
    return new MaterialVisionService(options);
}

module.exports = {
    createMaterialVisionService,
    MaterialVisionService
};
