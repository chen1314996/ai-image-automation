const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const { MaterialAnalysisService } = require('./importer');
const { MaterialVisionCache } = require('./vision/vision-cache');
const { safeSegment } = require('./store');
const { getStoredWinkyConfig: defaultGetStoredWinkyConfig } = require('../../../creative-agent-service');
const {
    buildCreativeOutputNamingContext
} = require('../output-naming/creative-output-naming');

const DEFAULT_NEW_DIRECTIONS_PER_SOURCE = 3;
const DEFAULT_PROMPT_GROUPS_PER_NEW_DIRECTION = 4;
const DEFAULT_VARIATION_AXES = ['场景', '人物关系', '道具', '镜头'];
const DEFAULT_AVOID_RULES = ['主体过小', '危险关系不清', '画面承诺与转化落差过大'];
const JS_SNAPSHOT_RELATIVE_PATH = path.join('public', 'generated', 'material-creative-prompt-pool.js');

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

function readJson(filePath, fallback) {
    if (!fs.existsSync(filePath)) return fallback;
    const text = fs.readFileSync(filePath, 'utf8');
    if (!text.trim()) return fallback;
    return JSON.parse(text);
}

function writeJson(filePath, data) {
    ensureDir(path.dirname(filePath));
    const tempPath = `${filePath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tempPath, filePath);
}

function hashId(prefix, values) {
    return `${prefix}_${crypto.createHash('sha1').update(values.map(value => String(value || '')).join('|')).digest('hex').slice(0, 12)}`;
}

function compactText(value) {
    return String(value ?? '').trim();
}

function toNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function formatNumber(value, digits = 2) {
    const number = toNumber(value);
    if (number === null) return '--';
    return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: digits }).format(number);
}

function formatPercent(value, digits = 2) {
    const number = toNumber(value);
    if (number === null) return '--';
    return new Intl.NumberFormat('zh-CN', { style: 'percent', maximumFractionDigits: digits }).format(number);
}

function clampInteger(value, fallback, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(min, Math.min(max, Math.floor(number)));
}

function uniqueList(values = [], limit = 10) {
    const seen = new Set();
    const output = [];
    for (const value of values.flat(Infinity)) {
        const text = compactText(value);
        if (!text || seen.has(text)) continue;
        seen.add(text);
        output.push(text);
        if (output.length >= limit) break;
    }
    return output;
}

function average(items, key) {
    const values = items.map(item => Number(item[key])).filter(Number.isFinite);
    if (!values.length) return null;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sum(items, key) {
    return items.reduce((total, item) => total + (Number(item[key]) || 0), 0);
}

function directionLevelsFromMaterial(material = {}, vision = {}) {
    const parsed = material.parsedName || {};
    const parts = Array.isArray(parsed.parts) ? parsed.parts : [];
    const primary = compactText(parsed.primary) || '未分类';
    const categoryIndex = parts.findIndex(part => compactText(part) === primary);
    const suffixParts = categoryIndex >= 0
        ? parts.slice(categoryIndex + 1).filter(part => compactText(part) && compactText(part) !== compactText(parsed.size))
        : [];
    const secondary = compactText(parsed.secondary) || compactText(suffixParts[0]) || '未拆二级';
    const tertiary = compactText(parsed.idea) || compactText(suffixParts[1]) || compactText(vision.suggestedDirection) || '未拆三级';
    const concretePoint = compactText(suffixParts.slice(2).join('/')) ||
        compactText(vision.hook) ||
        compactText(parsed.idea) ||
        compactText(material.materialName) ||
        '未命名创意点';

    return {
        primary,
        secondary,
        tertiary,
        concretePoint
    };
}

function directionPathFromLevels(levels = {}) {
    const values = [levels.primary, levels.secondary, levels.tertiary, levels.concretePoint]
        .map(compactText)
        .filter(Boolean);
    return values.filter((value, index) => index === 0 || value !== values[index - 1]).join('/');
}

function visualInsightFromResult(result = null) {
    if (!result) return '';
    if (result.status !== 'success') {
        return compactText(result.userMessage || result.error || result.errorDetail);
    }
    const vision = result.vision || {};
    return uniqueList([
        vision.summary,
        vision.mainSubject ? `主体：${vision.mainSubject}` : '',
        vision.scene ? `场景：${vision.scene}` : '',
        vision.event ? `事件：${vision.event}` : '',
        vision.hook ? `钩子：${vision.hook}` : '',
        result.iterationAdvice
    ], 6).join('；');
}

function visualSuggestedDirectionFromResult(result = null) {
    if (!result || result.status !== 'success') {
        return '';
    }
    const vision = result.vision || {};
    return compactText(vision.suggestedDirection);
}

function targetPerformanceSummary(target = {}) {
    return [
        `Top100素材 ${formatNumber(target.materialCount, 0)} 条`,
        `花费 ${formatNumber(target.spend)}`,
        `安装 ${formatNumber(target.installs, 0)}`,
        `CTR ${formatPercent(target.ctr)}`,
        `CVR ${formatPercent(target.cvr)}`,
        `CPI ${formatNumber(target.cpi)}`,
        `IPM ${formatNumber(target.ipm)}`,
        `D0 ROI ${formatPercent(target.d0IapRoi)}`
    ].join('，');
}

function normalizePromptGroupsByTarget(targets = [], overrides = {}, defaultValue = DEFAULT_PROMPT_GROUPS_PER_NEW_DIRECTION) {
    const result = {};
    targets.forEach(target => {
        result[target.targetKey] = clampInteger(
            overrides[target.targetKey],
            defaultValue,
            1,
            10
        );
    });
    return result;
}

function extractJsonObject(text) {
    const raw = String(text || '').trim()
        .replace(/^```(?:json)?/i, '')
        .replace(/```$/i, '')
        .trim();
    try {
        return JSON.parse(raw);
    } catch {
        const start = raw.indexOf('{');
        const end = raw.lastIndexOf('}');
        if (start >= 0 && end > start) {
            return JSON.parse(raw.slice(start, end + 1));
        }
        throw new Error('模型没有返回可解析 JSON');
    }
}

function extractResponseText(data) {
    if (typeof data === 'string') return data;
    if (!data || typeof data !== 'object') return '';
    if (typeof data.output_text === 'string') return data.output_text;
    if (typeof data.text === 'string') return data.text;
    const firstChoice = Array.isArray(data.choices) ? data.choices[0] : null;
    if (!firstChoice) return '';
    if (typeof firstChoice.text === 'string') return firstChoice.text;
    const message = firstChoice.message || {};
    if (typeof message.content === 'string') return message.content;
    if (Array.isArray(message.content)) {
        return message.content.map(part => {
            if (typeof part === 'string') return part;
            return part && (part.text || part.content) ? String(part.text || part.content) : '';
        }).filter(Boolean).join('\n');
    }
    return '';
}

function buildTargetExpansionMessages(target, settings, retryReason = '') {
    const schema = {
        newDirections: [
            {
                name: '新方向名称',
                description: '方向描述，说明与原方向的差异',
                sourceStrategy: '来自哪个变化轴或视觉机制',
                prompts: [
                    {
                        title: '提示词标题',
                        prompt: '可直接给 Legil 使用的中文画面提示词'
                    }
                ]
            }
        ]
    };
    const system = [
        '你是游戏广告创意拓展 Agent，专门把素材分析方向变成 Legil 可执行画面提示词。',
        '只输出合法 JSON，不输出 Markdown，不解释。',
        `每个原始目标必须输出 ${settings.newDirectionsPerSource} 个差异化新方向；当 targetType=top100-material 时，必须把它当作单张 Top100 素材处理，不要与同方向素材合并。`,
        `每个新方向必须输出 ${settings.promptGroupsPerNewDirection} 组中文画面提示词。`,
        '每组提示词必须包含主体、动作、场景、危险/奖励关系、构图、光线、材质、广告可读性，避免空泛风格词。',
        '必须保留 retainElements，沿 variationAxes 变化，并避开 avoidRules。'
    ].join('\n');

    const user = [
        '# 原始目标 target',
        JSON.stringify(target, null, 2),
        '',
        '# 数量要求',
        `newDirectionsPerSource=${settings.newDirectionsPerSource}`,
        `promptGroupsPerNewDirection=${settings.promptGroupsPerNewDirection}`,
        '',
        retryReason ? `# 上次输出问题\n${retryReason}\n` : '',
        '# 必须输出 JSON Schema',
        JSON.stringify(schema, null, 2)
    ].join('\n');

    return [
        { role: 'system', content: system },
        { role: 'user', content: user }
    ];
}

function shouldUseMaxCompletionTokens(model) {
    return /^gpt-5\.5(?:$|[-_.\s])/i.test(String(model || '').trim());
}

async function callWinkyJson({ config, target, settings, retryReason = '' }) {
    const payload = {
        model: config.model,
        messages: buildTargetExpansionMessages(target, settings, retryReason),
        stream: false,
        response_format: { type: 'json_object' }
    };
    if (shouldUseMaxCompletionTokens(config.model)) {
        payload.max_completion_tokens = 12000;
    } else {
        payload.temperature = 0.72;
        payload.max_tokens = 12000;
    }
    if (config.provider) {
        payload.provider = config.provider;
    }

    const response = await axios.post(config.apiUrl, payload, {
        timeout: 10 * 60 * 1000,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        headers: {
            Authorization: `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json'
        }
    });
    return extractJsonObject(extractResponseText(response.data));
}

function normalizeLlmDirections(result, target, settings) {
    const warnings = [];
    const rawDirections = Array.isArray(result && result.newDirections) ? result.newDirections : [];
    if (rawDirections.length < settings.newDirectionsPerSource) {
        warnings.push(`${target.sourceDirectionPath} 只返回 ${rawDirections.length}/${settings.newDirectionsPerSource} 个新方向`);
    }

    const newDirections = rawDirections.slice(0, settings.newDirectionsPerSource).map((direction, directionIndex) => {
        const rawPrompts = Array.isArray(direction && direction.prompts) ? direction.prompts : [];
        if (rawPrompts.length < settings.promptGroupsPerNewDirection) {
            warnings.push(`${target.sourceDirectionPath} / ${direction && direction.name ? direction.name : `新方向${directionIndex + 1}`} 只返回 ${rawPrompts.length}/${settings.promptGroupsPerNewDirection} 组提示词`);
        }
        return {
            name: compactText(direction && direction.name) || `新方向${directionIndex + 1}`,
            description: compactText(direction && direction.description),
            sourceStrategy: compactText(direction && direction.sourceStrategy),
            prompts: rawPrompts.slice(0, settings.promptGroupsPerNewDirection)
                .map((prompt, promptIndex) => ({
                    title: compactText(prompt && prompt.title) || `提示词${promptIndex + 1}`,
                    prompt: compactText(typeof prompt === 'string' ? prompt : (prompt && prompt.prompt))
                }))
                .filter(prompt => prompt.prompt)
        };
    }).filter(direction => direction.prompts.length > 0);

    if (!newDirections.length) {
        throw new Error(`${target.sourceDirectionPath} 没有生成可用提示词`);
    }

    return { newDirections, warnings };
}

function targetQualityIssue(result, settings) {
    const directions = Array.isArray(result && result.newDirections) ? result.newDirections : [];
    if (directions.length < settings.newDirectionsPerSource) {
        return `新方向数量不足：需要 ${settings.newDirectionsPerSource} 个，实际 ${directions.length} 个。`;
    }
    const badDirection = directions.slice(0, settings.newDirectionsPerSource).find(direction => {
        const prompts = Array.isArray(direction && direction.prompts) ? direction.prompts : [];
        return prompts.length < settings.promptGroupsPerNewDirection;
    });
    if (badDirection) {
        const prompts = Array.isArray(badDirection.prompts) ? badDirection.prompts : [];
        return `方向“${badDirection.name || '未命名'}”提示词不足：需要 ${settings.promptGroupsPerNewDirection} 组，实际 ${prompts.length} 组。`;
    }
    return '';
}

class MaterialCreativeExpansionService {
    constructor(context = {}) {
        this.rootDir = context.ROOT_DIR || context.rootDir || process.cwd();
        this.analysisService = context.analysisService || new MaterialAnalysisService(context);
        this.visionCache = context.visionCache || new MaterialVisionCache(this.rootDir);
        this.llmClient = context.llmClient || null;
        this.getStoredWinkyConfig = context.getStoredWinkyConfig || defaultGetStoredWinkyConfig;
        this.directionLibrary = context.directionLibrary || null;
    }

    getDetail(runId) {
        const detail = this.analysisService.getImport(runId);
        if (!detail.success) return detail;
        return detail;
    }

    visionResultsById(runId) {
        const payload = this.visionCache.readRun(runId);
        const results = payload && Array.isArray(payload.results) ? payload.results : [];
        return new Map(results.map(result => [result.materialId, result]));
    }

    getCreativeTargets(runId, options = {}) {
        const detail = this.getDetail(runId);
        if (!detail.success) return detail;

        const visionResults = this.visionResultsById(detail.summary.runId);
        const top100 = (detail.top100 || []).slice(0, 100);

        const defaultPromptGroups = clampInteger(
            options.defaultPromptGroupsPerNewDirection || options.promptGroupsPerNewDirection,
            DEFAULT_PROMPT_GROUPS_PER_NEW_DIRECTION,
            1,
            10
        );
        const directionLibrary = this.readDirectionLibrary(options);
        const hasDirectionLibrary = Array.isArray(directionLibrary) ? directionLibrary.length > 0 : Boolean(directionLibrary);

        const targets = top100.map(material => {
            const result = visionResults.get(material.materialId) || null;
            const successVision = result && result.status === 'success' ? [result] : [];
            const vision = successVision[0] ? (successVision[0].vision || {}) : {};
            const levels = directionLevelsFromMaterial(material, vision);
            const rawSourceDirectionPath = directionPathFromLevels(levels) || material.materialName || material.materialId;
            const namingContext = buildCreativeOutputNamingContext({
                sourceDirectionPath: rawSourceDirectionPath,
                sourceRawName: material.materialName || '',
                contentTitle: visualSuggestedDirectionFromResult(result) || levels.concretePoint || levels.tertiary,
                fallbackName: levels.concretePoint || levels.tertiary || material.materialName || material.materialId,
                directionLibrary,
                strictLibraryTags: true
            });
            const standardLabelPath = Array.isArray(namingContext.standardLabelPath)
                ? namingContext.standardLabelPath
                : [];
            const fallbackDirectionPath = [levels.primary, levels.secondary].map(compactText).filter(Boolean).join('/');
            const sourceDirectionPath = standardLabelPath.length
                ? standardLabelPath.join('/')
                : (hasDirectionLibrary ? fallbackDirectionPath : rawSourceDirectionPath);
            const normalizedLevels = {
                ...levels,
                primary: namingContext.primaryTag || levels.primary,
                secondary: namingContext.secondaryTag || levels.secondary,
                tertiary: namingContext.tertiaryTag || '',
                concretePoint: namingContext.sourceContentTitle || levels.concretePoint
            };
            const targetKey = material.materialId;
            const materialSeed = {
                materialId: material.materialId,
                materialName: material.materialName,
                topRank: material.topRank,
                spend: material.spend,
                installs: material.installs,
                d0IapRoi: material.d0IapRoi,
                contentUrl: material.contentUrl || ''
            };
            const target = {
                source: 'material-analysis',
                packageType: 'creative-expansion-target',
                targetId: hashId('mat_creative_target', [detail.summary.runId, material.materialId]),
                targetType: 'top100-material',
                targetKey,
                sourceMaterialId: material.materialId,
                sourceMaterialName: material.materialName,
                sourceDirectionKey: sourceDirectionPath,
                sourceDirectionPath,
                sourceDirectionName: standardLabelPath[standardLabelPath.length - 1] || levels.secondary || levels.primary || '',
                sourceRawName: material.materialName,
                sourceContentTitle: namingContext.sourceContentTitle || '',
                sourceParsedParts: namingContext.sourceParsedParts || [],
                droppedLabelParts: namingContext.droppedLabelParts || [],
                standardLabelPath,
                primaryTag: namingContext.primaryTag || '',
                secondaryTag: namingContext.secondaryTag || '',
                tertiaryTag: namingContext.tertiaryTag || '',
                namingSource: namingContext.namingSource || '',
                tagConfidence: namingContext.tagConfidence || '',
                sourceVisualDirection: visualSuggestedDirectionFromResult(result),
                levels: normalizedLevels,
                materialName: material.materialName,
                materialCount: 1,
                topRankStart: Number(material.topRank) || 9999,
                topRankEnd: Number(material.topRank) || 0,
                spend: Number(material.spend) || 0,
                installs: Number(material.installs) || 0,
                ctr: average([material], 'ctr'),
                cvr: average([material], 'cvr'),
                cpi: average([material], 'cpi'),
                ipm: average([material], 'ipm'),
                d0IapRoi: average([material], 'd0IapRoi'),
                visionReadyCount: successVision.length,
                visionTotalCount: result ? 1 : 0,
                visualSummary: uniqueList(successVision.map(visualInsightFromResult), 4).join('；') || '该素材暂无成功视觉识别结果，先按素材名称和投放指标拓展。',
                retainElements: uniqueList([
                    successVision.map(result => result.vision && result.vision.retainElements),
                    successVision.map(result => result.vision && result.vision.hook),
                    successVision.map(result => result.vision && result.vision.mainSubject),
                    levels.tertiary,
                    levels.concretePoint
                ], 8),
                variationAxes: uniqueList([
                    successVision.map(result => result.vision && result.vision.variationAxes),
                    DEFAULT_VARIATION_AXES
                ], 8),
                avoidRules: uniqueList([
                    successVision.map(result => result.vision && result.vision.riskNotes),
                    material.health && material.health.action,
                    DEFAULT_AVOID_RULES
                ], 8),
                seedMaterials: [materialSeed],
                promptGroupsPerNewDirection: defaultPromptGroups,
                newDirectionsPerSource: DEFAULT_NEW_DIRECTIONS_PER_SOURCE
            };
            target.performanceSummary = targetPerformanceSummary(target);
            target.task = `基于该 Top100 素材输出 ${DEFAULT_NEW_DIRECTIONS_PER_SOURCE} 个差异化新方向，每个新方向输出 ${defaultPromptGroups} 组可直接给 Legil 使用的中文画面提示词。`;
            return target;
        }).sort((a, b) => {
            const spendDelta = (Number(b.spend) || 0) - (Number(a.spend) || 0);
            if (spendDelta) return spendDelta;
            return (Number(a.topRankStart) || 9999) - (Number(b.topRankStart) || 9999);
        }).slice(0, 100);

        return {
            success: true,
            summary: detail.summary,
            settings: {
                targetMode: 'top100-material',
                aggregateBy: ['Top100 素材'],
                newDirectionsPerSource: DEFAULT_NEW_DIRECTIONS_PER_SOURCE,
                defaultPromptGroupsPerNewDirection: defaultPromptGroups
            },
            targets
        };
    }

    async expandTarget(target, settings) {
        if (this.llmClient) {
            const result = await this.llmClient({ target, settings });
            return normalizeLlmDirections(result, target, settings);
        }

        const config = this.getStoredWinkyConfig();
        if (!config.apiKey || !config.apiUrl || !config.model) {
            throw new Error('Lumos Winky 未配置完整：请先配置 WINKY_API_KEY、WINKY_API_BASE_URL 和 WINKY_MODEL');
        }

        let retryReason = '';
        let lastResult = null;
        for (let attempt = 0; attempt < 2; attempt++) {
            lastResult = await callWinkyJson({ config, target, settings, retryReason });
            const issue = targetQualityIssue(lastResult, settings);
            if (!issue) break;
            retryReason = issue;
        }
        return normalizeLlmDirections(lastResult, target, settings);
    }

    async createPromptPool(runId, payload = {}) {
        const targetResult = this.getCreativeTargets(runId, {
            defaultPromptGroupsPerNewDirection: payload.defaultPromptGroupsPerNewDirection
        });
        if (!targetResult.success) return targetResult;

        const requestedKeys = new Set((Array.isArray(payload.targetKeys) ? payload.targetKeys : [])
            .map(compactText)
            .filter(Boolean));
        const selectedTargets = targetResult.targets.filter(target => {
            if (!requestedKeys.size) return true;
            return requestedKeys.has(target.targetKey) || requestedKeys.has(target.targetId);
        });

        if (!selectedTargets.length) {
            return {
                success: false,
                message: '请至少选择一张 TOP100 素材'
            };
        }

        const defaultPromptGroups = clampInteger(
            payload.defaultPromptGroupsPerNewDirection,
            DEFAULT_PROMPT_GROUPS_PER_NEW_DIRECTION,
            1,
            10
        );
        const overrides = payload.overrides && typeof payload.overrides === 'object' ? payload.overrides : {};
        const promptGroupsByTarget = normalizePromptGroupsByTarget(selectedTargets, overrides, defaultPromptGroups);
        const directionLibrary = this.readDirectionLibrary(payload);
        const expandedTargets = [];
        const prompts = [];
        const warnings = [];

        for (const [targetIndex, target] of selectedTargets.entries()) {
            const settings = {
                newDirectionsPerSource: DEFAULT_NEW_DIRECTIONS_PER_SOURCE,
                promptGroupsPerNewDirection: promptGroupsByTarget[target.targetKey] || defaultPromptGroups
            };
            const result = await this.expandTarget({
                ...target,
                promptGroupsPerNewDirection: settings.promptGroupsPerNewDirection,
                newDirectionsPerSource: settings.newDirectionsPerSource,
                task: `基于该 Top100 素材输出 ${settings.newDirectionsPerSource} 个差异化新方向，每个新方向输出 ${settings.promptGroupsPerNewDirection} 组可直接给 Legil 使用的中文画面提示词。`
            }, settings);
            warnings.push(...result.warnings);
            const expandedTarget = {
                ...target,
                promptGroupsPerNewDirection: settings.promptGroupsPerNewDirection,
                newDirectionsPerSource: settings.newDirectionsPerSource,
                newDirections: result.newDirections
            };
            expandedTargets.push(expandedTarget);

            result.newDirections.forEach((direction, directionIndex) => {
                direction.prompts.forEach((prompt, promptIndex) => {
                    const index = prompts.length + 1;
                    const promptTitle = prompt.title || `${direction.name}-提示词${promptIndex + 1}`;
                    const sourceRawName = target.sourceRawName || target.sourceMaterialName || target.materialName;
                    const rawNameNamingContext = buildCreativeOutputNamingContext({
                        sourceRawName,
                        newDirectionName: direction.name,
                        contentTitle: direction.name,
                        promptTitle,
                        fallbackName: direction.name,
                        directionLibrary
                    });
                    const directionNamingContext = buildCreativeOutputNamingContext({
                        sourceDirectionId: target.sourceDirectionId || '',
                        sourceDirectionPath: target.sourceDirectionPath,
                        sourceRawName,
                        referenceFolderPath: target.sourceVisualDirection || '',
                        newDirectionName: direction.name,
                        contentTitle: direction.name,
                        promptTitle,
                        fallbackName: direction.name,
                        directionLibrary
                    });
                    const namingContext = rawNameNamingContext.standardLabelPath && rawNameNamingContext.standardLabelPath.length
                        ? rawNameNamingContext
                        : directionNamingContext;
                    prompts.push({
                        promptId: hashId('mat_prompt', [target.targetKey, direction.name, promptIndex + 1, prompt.prompt]),
                        index,
                        sourceRow: targetIndex * DEFAULT_NEW_DIRECTIONS_PER_SOURCE + directionIndex + 1,
                        source: 'material-analysis',
                        sourceRunId: targetResult.summary.runId,
                        sourceMaterialId: target.sourceMaterialId || '',
                        sourceMaterialName: target.sourceMaterialName || target.materialName || '',
                        sourceRawName: target.sourceRawName || target.sourceMaterialName || target.materialName || '',
                        sourceDirectionKey: target.sourceDirectionKey || target.targetKey,
                        sourceDirectionPath: target.sourceDirectionPath,
                        sourceVisualDirection: target.sourceVisualDirection || '',
                        primaryTag: namingContext.primaryTag || '',
                        secondaryTag: namingContext.secondaryTag || '',
                        tertiaryTag: namingContext.tertiaryTag || '',
                        standardLabelPath: namingContext.standardLabelPath || [],
                        sourceParsedParts: namingContext.sourceParsedParts || [],
                        sourceContentTitle: namingContext.sourceContentTitle || '',
                        droppedLabelParts: namingContext.droppedLabelParts || [],
                        newDirectionName: direction.name,
                        contentTitle: namingContext.contentTitle || direction.name,
                        outputNameBase: namingContext.outputNameBase || direction.name,
                        namingSource: namingContext.namingSource || '',
                        tagConfidence: namingContext.tagConfidence || '',
                        direction: `${target.sourceDirectionPath} / ${direction.name}`,
                        promptTitle,
                        prompt: prompt.prompt,
                        selected: true,
                        meta: {
                            sourceStrategy: direction.sourceStrategy || '',
                            directionDescription: direction.description || '',
                            targetId: target.targetId
                        }
                    });
                });
            });
        }

        const expansionId = `creative_expansion_${targetResult.summary.runId}_${Date.now()}`;
        const pool = {
            source: 'material-analysis',
            packageType: 'creative-prompt-pool',
            expansionId,
            projectName: targetResult.summary.projectName || '',
            weekId: targetResult.summary.weekId || '',
            runId: targetResult.summary.runId,
            createdAt: new Date().toISOString(),
            settings: {
                targetMode: 'top100-material',
                aggregateBy: ['Top100 素材'],
                newDirectionsPerSource: DEFAULT_NEW_DIRECTIONS_PER_SOURCE,
                defaultPromptGroupsPerNewDirection: defaultPromptGroups,
                promptGroupsByTarget
            },
            targetCount: expandedTargets.length,
            promptCount: prompts.length,
            targets: expandedTargets,
            prompts,
            warnings
        };

        const jsonPath = this.promptPoolPath(pool);
        writeJson(jsonPath, pool);
        this.updateIndex(pool, jsonPath);
        const jsPath = this.exportJsSnapshot(pool);

        return {
            success: true,
            pool,
            jsonPath,
            jsPath
        };
    }

    promptPoolPath(pool) {
        return path.join(
            this.rootDir,
            'data',
            'material-analysis',
            'creative-expansions',
            safeSegment(pool.projectName, 'project'),
            safeSegment(pool.weekId, 'week'),
            `${safeSegment(pool.expansionId, 'expansion')}.json`
        );
    }

    indexPath() {
        return path.join(this.rootDir, 'data', 'material-analysis', 'creative-expansions', 'index.json');
    }

    updateIndex(pool, jsonPath) {
        const indexPath = this.indexPath();
        const current = readJson(indexPath, []);
        const nextItem = {
            expansionId: pool.expansionId,
            projectName: pool.projectName,
            weekId: pool.weekId,
            runId: pool.runId,
            createdAt: pool.createdAt,
            targetCount: pool.targetCount,
            promptCount: pool.promptCount,
            jsonPath
        };
        const next = [nextItem, ...current.filter(item => item.expansionId !== pool.expansionId)].slice(0, 50);
        writeJson(indexPath, next);
    }

    listPromptPools() {
        return {
            success: true,
            pools: readJson(this.indexPath(), [])
        };
    }

    readPromptPool(expansionId) {
        const id = compactText(expansionId);
        const found = readJson(this.indexPath(), []).find(item => item.expansionId === id);
        if (!found || !found.jsonPath || !fs.existsSync(found.jsonPath)) {
            return {
                success: false,
                message: '提示词池不存在'
            };
        }
        return {
            success: true,
            pool: readJson(found.jsonPath, null),
            jsonPath: found.jsonPath
        };
    }

    readDirectionLibrary(payload = {}) {
        if (Array.isArray(payload.directionLibrary) || typeof payload.directionLibrary === 'string') {
            return payload.directionLibrary;
        }
        if (payload.directionLibrary && typeof payload.directionLibrary === 'object') {
            return payload.directionLibrary;
        }
        if (Array.isArray(this.directionLibrary) || typeof this.directionLibrary === 'string') {
            return this.directionLibrary;
        }
        if (this.directionLibrary && typeof this.directionLibrary === 'object') {
            return this.directionLibrary;
        }

        const filePath = path.join(this.rootDir, 'data', 'creative-knowledge', 'directions.json');
        try {
            const data = readJson(filePath, { directions: [] });
            return Array.isArray(data && data.directions) ? data.directions : [];
        } catch {
            return [];
        }
    }

    exportJsSnapshot(poolOrId) {
        const pool = typeof poolOrId === 'string'
            ? this.readPromptPool(poolOrId).pool
            : poolOrId;
        if (!pool || !pool.expansionId) {
            throw new Error('提示词池不存在，无法导出 JS 快照');
        }

        const jsPath = path.join(this.rootDir, JS_SNAPSHOT_RELATIVE_PATH);
        ensureDir(path.dirname(jsPath));
        const content = [
            'window.MATERIAL_CREATIVE_PROMPT_POOL = ',
            JSON.stringify(pool, null, 2),
            ';\n'
        ].join('');
        fs.writeFileSync(jsPath, content, 'utf8');
        return jsPath;
    }
}

function createMaterialCreativeExpansionService(context) {
    return new MaterialCreativeExpansionService(context);
}

module.exports = {
    createMaterialCreativeExpansionService,
    MaterialCreativeExpansionService,
    DEFAULT_NEW_DIRECTIONS_PER_SOURCE,
    DEFAULT_PROMPT_GROUPS_PER_NEW_DIRECTION,
    directionLevelsFromMaterial,
    directionPathFromLevels
};
