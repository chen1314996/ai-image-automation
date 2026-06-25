const fs = require('fs');
const crypto = require('crypto');
const { TaskWorkbookStore } = require('./store');
const { TaskDirectionVisionClient } = require('./vision-client');

const DEFAULT_CONCURRENCY = 1;
const MAX_CONCURRENCY = 2;
const DEFAULT_MAX_ATTEMPTS = 3;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function clampInteger(value, fallback, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(min, Math.min(max, Math.floor(number)));
}

function hashBuffer(buffer) {
    return crypto.createHash('sha1').update(buffer).digest('hex');
}

function hashText(value) {
    return crypto.createHash('sha1').update(String(value || '')).digest('hex');
}

function fileHash(filePath) {
    if (!filePath || !fs.existsSync(filePath)) return '';
    return hashBuffer(fs.readFileSync(filePath));
}

function taskDirectionCacheKey(taskDirection = {}) {
    const imageHashes = (taskDirection.referenceImages || [])
        .map(image => fileHash(image.filePath))
        .filter(Boolean)
        .sort();
    return hashText(JSON.stringify({
        taskDirectionId: taskDirection.taskDirectionId,
        sourcePath: taskDirection.sourcePath,
        iterationDescription: taskDirection.iterationDescription,
        directionDescription: taskDirection.directionDescription,
        imageHashes
    }));
}

function emptyStatus(importId, total = 0) {
    return {
        importId,
        state: 'idle',
        running: false,
        total,
        completed: 0,
        successCount: 0,
        failedCount: 0,
        cachedCount: 0,
        pendingCount: total,
        currentTaskDirectionId: '',
        currentSourcePath: '',
        startedAt: null,
        finishedAt: null,
        updatedAt: new Date().toISOString(),
        message: '等待启动任务方向视觉整理'
    };
}

function publicTaskDirection(taskDirection = {}, result = null) {
    const vision = result && result.status === 'success' ? result.vision : null;
    return {
        ...taskDirection,
        status: result
            ? (result.status === 'success' ? 'ready' : (result.missingImage ? 'missing-image' : 'risky'))
            : taskDirection.status,
        vision
    };
}

function isFatalError(error) {
    return Boolean(error && error.fatal);
}

function isCancelledError(error) {
    return Boolean(error && (
        error.code === 'ERR_CANCELED' ||
        error.name === 'CanceledError' ||
        error.name === 'AbortError'
    ));
}

class TaskDirectionVisionService {
    constructor(options = {}) {
        this.rootDir = options.ROOT_DIR || options.rootDir || process.cwd();
        this.logger = options.logger;
        this.store = options.store || new TaskWorkbookStore(this.rootDir);
        this.client = options.client || new TaskDirectionVisionClient({
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

    ensureImport(importId) {
        const summary = this.store.readSummary(importId);
        if (!summary) throw new Error('任务表导入记录不存在');
        return summary;
    }

    getImport(importId) {
        const summary = this.ensureImport(importId);
        const results = this.store.readVisionResults(importId);
        const resultById = new Map(results.map(item => [item.taskDirectionId, item]));
        const taskDirections = this.store.readTaskDirections(importId)
            .map(direction => publicTaskDirection(direction, resultById.get(direction.taskDirectionId)));
        return {
            success: true,
            summary,
            taskDirections,
            hierarchyDefinitions: this.store.readHierarchyDefinitions(importId),
            visionStatus: this.getStatus(importId).status,
            visionResults: results
        };
    }

    listImports() {
        return {
            success: true,
            imports: this.store.listImports()
        };
    }

    deleteImport(importId) {
        const task = this.tasks.get(importId);
        if (task) {
            task.cancelled = true;
            this.tasks.delete(importId);
        }
        const deleted = this.store.deleteImport(importId);
        return {
            success: Boolean(deleted),
            deleted,
            imports: this.store.listImports(),
            message: deleted ? '任务表导入记录已删除' : '任务表导入记录不存在'
        };
    }

    getStatus(importId) {
        const task = this.tasks.get(importId);
        if (task) return { success: true, status: task.status };
        const summary = this.store.readSummary(importId);
        if (!summary) return { success: false, status: emptyStatus(importId), message: '任务表导入记录不存在' };
        const stored = this.store.readVisionStatus(importId);
        if (stored && stored.running) {
            const status = this.reconcileStaleRunningStatus(importId, stored);
            return {
                success: true,
                status
            };
        }
        return {
            success: true,
            status: stored || emptyStatus(importId, summary.taskDirectionCount || 0)
        };
    }

    getResults(importId) {
        this.ensureImport(importId);
        return {
            success: true,
            status: this.getStatus(importId).status,
            results: this.store.readVisionResults(importId)
        };
    }

    summarize(importId, results, base = {}) {
        const successCount = results.filter(item => item.status === 'success').length;
        const failedCount = results.filter(item => item.status === 'failed').length;
        const cachedCount = results.filter(item => item.status === 'success' && item.source === 'cache').length;
        const pendingCount = results.filter(item => !item.status || item.status === 'pending' || item.status === 'running').length;
        const total = results.length;
        return {
            ...emptyStatus(importId, total),
            ...base,
            total,
            completed: successCount + failedCount,
            successCount,
            failedCount,
            cachedCount,
            pendingCount,
            updatedAt: new Date().toISOString()
        };
    }

    reconcileStaleRunningStatus(importId, stored = {}) {
        const results = this.store.readVisionResults(importId);
        const status = this.summarize(importId, results, {
            ...stored,
            state: 'paused',
            running: false,
            finishedAt: stored.finishedAt || new Date().toISOString(),
            currentTaskDirectionId: '',
            currentSourcePath: '',
            message: '检测到上次视觉整理未正常收尾，已转为暂停，可点击继续处理剩余行'
        });
        this.store.writeVisionStatus(importId, status);
        return status;
    }

    initialResults(importId, targetDirections, options = {}) {
        const previous = this.store.readVisionResults(importId);
        const previousById = new Map(previous.map(item => [item.taskDirectionId, item]));
        const targetIds = new Set(targetDirections.map(item => item.taskDirectionId));
        const allDirections = this.store.readTaskDirections(importId);
        const output = [];

        allDirections.forEach(direction => {
            const previousResult = previousById.get(direction.taskDirectionId);
            if (!targetIds.has(direction.taskDirectionId)) {
                if (previousResult) output.push(previousResult);
                return;
            }
            if (!options.forceRefresh && previousResult && previousResult.status === 'success') {
                output.push(previousResult);
                return;
            }
            output.push({
                taskDirectionId: direction.taskDirectionId,
                importId,
                sourceRow: direction.sourceRow,
                sourcePath: direction.sourcePath,
                status: 'pending',
                attemptCount: 0,
                updatedAt: new Date().toISOString()
            });
        });

        return output;
    }

    targetDirectionsForStart(importId, options = {}) {
        const allDirections = this.store.readTaskDirections(importId);
        const selectedIds = Array.isArray(options.taskDirectionIds)
            ? new Set(options.taskDirectionIds.map(value => String(value || '').trim()).filter(Boolean))
            : null;
        const previous = this.store.readVisionResults(importId);
        const previousById = new Map(previous.map(item => [item.taskDirectionId, item]));

        return allDirections.filter(direction => {
            if (selectedIds && selectedIds.size && !selectedIds.has(direction.taskDirectionId)) return false;
            if (options.resume === true) {
                const previousResult = previousById.get(direction.taskDirectionId);
                return !previousResult || previousResult.status !== 'success';
            }
            if (options.forceRefresh === true) return true;
            const previousResult = previousById.get(direction.taskDirectionId);
            return !previousResult || previousResult.status !== 'success';
        });
    }

    start(importId, options = {}) {
        const summary = this.ensureImport(importId);
        if (this.tasks.has(importId)) {
            return {
                success: true,
                status: this.tasks.get(importId).status,
                message: '任务方向视觉整理已经在运行'
            };
        }

        const targetDirections = this.targetDirectionsForStart(importId, options);
        if (!targetDirections.length) {
            const existingResults = this.store.readVisionResults(importId);
            const status = this.summarize(importId, existingResults, {
                state: 'completed',
                running: false,
                finishedAt: new Date().toISOString(),
                message: '没有需要整理的任务方向，已复用现有结果'
            });
            this.store.writeVisionStatus(importId, status);
            return {
                success: true,
                status,
                message: status.message
            };
        }

        if (targetDirections.some(direction => (direction.referenceImages || []).length > 0)) {
            this.client.validateConfig();
        }

        const results = this.initialResults(importId, targetDirections, {
            forceRefresh: options.forceRefresh === true
        });
        const startedAt = new Date().toISOString();
        const status = this.summarize(importId, results, {
            state: 'running',
            running: true,
            startedAt,
            finishedAt: null,
            message: `任务方向视觉整理已启动：${targetDirections.length} 行待整理`
        });
        const task = {
            importId,
            summary,
            directions: targetDirections,
            results,
            status,
            concurrency: clampInteger(options.concurrency, DEFAULT_CONCURRENCY, 1, MAX_CONCURRENCY),
            maxAttempts: clampInteger(options.maxRetriesPerRow || options.maxAttempts, DEFAULT_MAX_ATTEMPTS, 1, DEFAULT_MAX_ATTEMPTS),
            abortController: typeof AbortController === 'function' ? new AbortController() : null,
            cancelled: false,
            paused: false,
            forceRefresh: options.forceRefresh === true
        };
        this.tasks.set(importId, task);
        this.store.writeVisionResults(importId, results);
        this.store.writeVisionStatus(importId, status);

        setImmediate(() => {
            this.runTask(task).catch(error => {
                task.status.state = 'failed';
                task.status.running = false;
                task.status.finishedAt = new Date().toISOString();
                task.status.message = error.message || '任务方向视觉整理异常';
                this.store.writeVisionStatus(importId, task.status);
                this.tasks.delete(importId);
                this.log('error', `任务方向视觉整理异常：${error.message}`);
            });
        });

        this.log('info', `任务方向视觉整理启动：${importId}，${targetDirections.length} 行`);
        return {
            success: true,
            status,
            message: status.message
        };
    }

    pause(importId) {
        const task = this.tasks.get(importId);
        if (!task) {
            const status = this.getStatus(importId).status;
            return {
                success: true,
                status,
                message: status && status.state === 'paused' ? '任务方向视觉整理已暂停' : '当前没有运行中的任务方向视觉整理'
            };
        }
        task.paused = true;
        task.status.state = 'pausing';
        task.status.message = '正在暂停，当前行完成后停止';
        task.status.updatedAt = new Date().toISOString();
        this.store.writeVisionStatus(importId, task.status);
        if (task.abortController && !task.abortController.signal.aborted) {
            task.abortController.abort();
        }
        return {
            success: true,
            status: task.status,
            message: task.status.message
        };
    }

    resume(importId, options = {}) {
        return this.start(importId, {
            ...options,
            resume: true
        });
    }

    async retry(importId, taskDirectionId) {
        this.ensureImport(importId);
        if (this.tasks.has(importId)) {
            return {
                success: false,
                message: '任务方向视觉整理正在运行，请暂停或等待完成后再单行重试'
            };
        }
        const direction = this.store.readTaskDirections(importId)
            .find(item => item.taskDirectionId === taskDirectionId);
        if (!direction) {
            return {
                success: false,
                message: '任务方向不存在'
            };
        }
        const results = this.store.readVisionResults(importId)
            .filter(item => item.taskDirectionId !== taskDirectionId);
        const task = {
            importId,
            directions: [direction],
            results: results.concat({
                taskDirectionId,
                importId,
                sourceRow: direction.sourceRow,
                sourcePath: direction.sourcePath,
                status: 'pending',
                attemptCount: 0,
                updatedAt: new Date().toISOString()
            }),
            status: {
                ...emptyStatus(importId, 1),
                state: 'running',
                running: true,
                total: 1,
                pendingCount: 1,
                startedAt: new Date().toISOString(),
                message: '单行任务方向视觉整理重试中'
            },
            concurrency: 1,
            maxAttempts: DEFAULT_MAX_ATTEMPTS,
            forceRefresh: true
        };
        await this.processDirection(task, direction, 0);
        const finalStatus = this.summarize(importId, task.results, {
            state: task.status.failedCount ? 'partial' : 'completed',
            running: false,
            finishedAt: new Date().toISOString(),
            message: task.status.failedCount ? '单行重试失败，已保留待重试状态' : '单行重试完成'
        });
        this.store.writeVisionResults(importId, task.results);
        this.store.writeVisionStatus(importId, finalStatus);
        return {
            success: task.status.failedCount === 0,
            status: finalStatus,
            result: task.results.find(item => item.taskDirectionId === taskDirectionId),
            message: finalStatus.message
        };
    }

    async runTask(task) {
        let nextIndex = 0;
        const workers = Array.from({ length: task.concurrency }, async () => {
            while (nextIndex < task.directions.length && !task.cancelled && !task.paused) {
                if (task.fatalError) break;
                const index = nextIndex;
                nextIndex += 1;
                await this.processDirection(task, task.directions[index], index);
            }
        });

        await Promise.all(workers);
        if (task.cancelled) {
            this.tasks.delete(task.importId);
            return;
        }

        const finishedAt = new Date().toISOString();
        const finalState = task.paused
            ? 'paused'
            : (task.fatalError ? 'failed' : (task.status.failedCount > 0 ? 'partial' : 'completed'));
        task.status = this.summarize(task.importId, task.results, {
            ...task.status,
            state: finalState,
            running: false,
            finishedAt,
            currentTaskDirectionId: '',
            currentSourcePath: '',
            message: task.paused
                ? '任务方向视觉整理已暂停，可继续'
                : (task.fatalError
                    ? (task.fatalError.message || '任务方向视觉整理失败')
                    : `任务方向视觉整理完成：成功 ${task.status.successCount}，失败 ${task.status.failedCount}，缓存 ${task.status.cachedCount}`)
        });
        this.store.writeVisionResults(task.importId, task.results);
        this.store.writeVisionStatus(task.importId, task.status);
        this.tasks.delete(task.importId);
        this.log(finalState === 'failed' ? 'error' : 'success', task.status.message);
    }

    async processDirection(task, direction, index) {
        if (task.cancelled || task.paused) return;
        const resultIndex = task.results.findIndex(item => item.taskDirectionId === direction.taskDirectionId);
        const startedAt = new Date().toISOString();
        const cacheKey = taskDirectionCacheKey(direction);

        task.status.currentTaskDirectionId = direction.taskDirectionId;
        task.status.currentSourcePath = direction.sourcePath;
        task.status.message = `正在整理 ${index + 1}/${task.directions.length}：${direction.sourcePath || direction.taskDirectionId}`;
        task.status.updatedAt = new Date().toISOString();
        this.store.writeVisionStatus(task.importId, task.status);

        if (!Array.isArray(direction.referenceImages) || direction.referenceImages.length === 0) {
            this.replaceResult(task, resultIndex, this.buildFailedResult(direction, {
                cacheKey,
                startedAt,
                error: new Error('缺少任务表参考图，无法做视觉整理'),
                missingImage: true
            }));
            task.status.failedCount += 1;
            this.updateProgress(task, '缺少参考图，已标记为有风险');
            return;
        }

        if (!task.forceRefresh) {
            const cached = this.store.readVisionCache(cacheKey);
            if (cached && cached.status === 'success' && cached.vision) {
                this.replaceResult(task, resultIndex, this.buildSuccessResult(direction, {
                    cacheKey,
                    vision: cached.vision,
                    rawText: cached.rawText || '',
                    source: 'cache',
                    startedAt,
                    finishedAt: new Date().toISOString(),
                    cacheMeta: cached.cacheMeta || null
                }));
                task.status.cachedCount += 1;
                task.status.successCount += 1;
                this.updateProgress(task, '复用任务方向视觉缓存');
                return;
            }
        }

        let lastError = null;
        for (let attempt = 1; attempt <= task.maxAttempts; attempt += 1) {
            try {
                const response = await this.client.analyzeTaskDirection({
                    taskDirection: direction,
                    signal: task.abortController ? task.abortController.signal : undefined
                });
                if (task.cancelled || task.paused) return;
                const finishedAt = new Date().toISOString();
                const cacheMeta = typeof this.client.getCacheMeta === 'function' ? this.client.getCacheMeta() : null;
                const result = this.buildSuccessResult(direction, {
                    cacheKey,
                    vision: response.result,
                    rawText: response.rawText,
                    source: 'api',
                    startedAt,
                    finishedAt,
                    attemptCount: attempt,
                    cacheMeta
                });
                this.replaceResult(task, resultIndex, result);
                this.store.writeVisionCache(cacheKey, {
                    status: 'success',
                    vision: response.result,
                    rawText: response.rawText,
                    cacheMeta
                });
                task.status.successCount += 1;
                this.updateProgress(task, '任务方向视觉整理成功');
                return;
            } catch (error) {
                lastError = error;
                if (task.cancelled || task.paused || isCancelledError(error)) return;
                if (isFatalError(error)) break;
                if (attempt < task.maxAttempts) await sleep(800 + attempt * 700);
            }
        }

        if (task.cancelled || task.paused) return;
        this.replaceResult(task, resultIndex, this.buildFailedResult(direction, {
            cacheKey,
            startedAt,
            error: lastError,
            attemptCount: task.maxAttempts
        }));
        task.status.failedCount += 1;
        this.updateProgress(task, '任务方向视觉整理失败，已保留待重试状态');
        if (isFatalError(lastError)) task.fatalError = lastError;
    }

    replaceResult(task, index, result) {
        if (index >= 0) {
            task.results[index] = result;
        } else {
            task.results.push(result);
        }
        this.store.writeVisionResults(task.importId, task.results);
    }

    updateProgress(task, message) {
        task.status.completed += 1;
        task.status.pendingCount = Math.max(0, task.status.total - task.status.completed);
        task.status.updatedAt = new Date().toISOString();
        task.status.message = `${message}：${task.status.completed}/${task.status.total}`;
        this.store.writeVisionStatus(task.importId, task.status);
    }

    buildSuccessResult(direction, payload = {}) {
        const now = payload.finishedAt || new Date().toISOString();
        return {
            taskDirectionId: direction.taskDirectionId,
            importId: direction.importId,
            sourceRow: direction.sourceRow,
            sourcePath: direction.sourcePath,
            groupKey: direction.groupKey,
            status: 'success',
            source: payload.source || 'api',
            cacheKey: payload.cacheKey,
            attemptCount: payload.attemptCount || 1,
            vision: payload.vision,
            rawText: payload.rawText || '',
            referenceImageCount: Array.isArray(direction.referenceImages) ? direction.referenceImages.length : 0,
            legilReferencePolicy: {
                useTaskReferenceImagesForLegil: false,
                reason: '任务表参考图只用于方向理解和前端预览，不默认上传给 Legil。'
            },
            startedAt: payload.startedAt || now,
            finishedAt: now,
            updatedAt: now
        };
    }

    buildFailedResult(direction, payload = {}) {
        const now = new Date().toISOString();
        const error = payload.error || new Error('任务方向视觉整理失败');
        return {
            taskDirectionId: direction.taskDirectionId,
            importId: direction.importId,
            sourceRow: direction.sourceRow,
            sourcePath: direction.sourcePath,
            groupKey: direction.groupKey,
            status: 'failed',
            cacheKey: payload.cacheKey,
            missingImage: Boolean(payload.missingImage),
            retryable: !isFatalError(error),
            attemptCount: payload.attemptCount || DEFAULT_MAX_ATTEMPTS,
            error: error.message || String(error),
            errorCode: error.code || undefined,
            errorDetail: error.detail || undefined,
            fatal: Boolean(error.fatal),
            startedAt: payload.startedAt || now,
            finishedAt: now,
            updatedAt: now
        };
    }
}

function createTaskDirectionVisionService(options) {
    return new TaskDirectionVisionService(options);
}

module.exports = {
    createTaskDirectionVisionService,
    TaskDirectionVisionService,
    taskDirectionCacheKey
};
