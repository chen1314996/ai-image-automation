const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const { buildDefaultConfig } = require('../creative-knowledge');
const { CreativeKnowledgeStore } = require('../creative-knowledge/store');
const { emptyCreativeMemory, getActiveMemoryRules } = require('../creative-knowledge/feedback-learning');
const { selectNextDirection } = require('./direction-selector');
const {
    applyPromptGate,
    collectHistoricalCreativeUsage,
    summarizeHistoricalCreativeUsage
} = require('./prompt-gate');
const {
    PROMPT_SCHEMA_VERSION,
    TRANSLATION_AGENT_NAME,
    TRANSLATION_VERSION,
    buildDirectionDefinitions
} = require('./prompt-translator');
const { registerRunAssets } = require('./assets');
const {
    buildCreativeOutputNamingContext
} = require('../output-naming/creative-output-naming');

const DEFAULT_AUTO_CONFIG = {
    mode: 'run-once',
    maxDirectionsPerRun: 1,
    newDirectionsPerSource: 3,
    promptsPerNewDirection: 4,
    maxPromptsPerRun: 250,
    legilSmokeMaxPrompts: 5,
    outputQuantity: 4,
    maxImagesPerRun: 100,
    maxImagesPerDay: 1000,
    browserMode: 'headed',
    failurePauseThreshold: 5,
    generationSettings: {
        imageModel: 'nano-banana-2',
        aspectRatio: '1:1',
        resolution: '2K',
        outputQuantity: 4
    }
};
const UNLIMITED_PROMPT_LIMIT = Number.MAX_SAFE_INTEGER;
const CREATIVE_TARGET_QUEUE_FILE = 'creative-target-queues.json';
const DEFAULT_LEGIL_MIN_WAIT_MS = 60 * 60 * 1000;
const DEFAULT_LEGIL_PER_PROMPT_WAIT_MS = 15 * 60 * 1000;
const CREATIVE_DIMENSION_KEYWORDS = {
    mood: {
        label: '氛围',
        values: {
            '温暖希望': ['温暖', '希望', '灯光', '火光', '守护', '救援'],
            '荒凉孤独': ['荒凉', '孤独', '废墟', '废弃', '空城', '无人'],
            '紧张危机': ['危机', '紧张', '逃', '抢', '争夺', '坍塌', '来袭', '危险'],
            '神秘未知': ['神秘', '未知', '发现', '入口', '遗迹', '宝箱'],
            '幽默轻松': ['趣味', '搞笑', '幽默', '反差'],
            '史诗壮阔': ['巨型', '地标', '史诗', '宏大', '堡垒']
        }
    },
    perspective: {
        label: '视角',
        values: {
            '俯瞰': ['俯瞰', '鸟瞰', '高处'],
            '仰视': ['仰视', '低机位'],
            '平视': ['平视', '正面'],
            '第一人称': ['第一人称', '手持', '打开', '驾驶'],
            '远景': ['远景', '全景', '地标'],
            '微距': ['微距', '特写', '近景']
        }
    },
    time: {
        label: '时间天气',
        values: {
            '暴风雪': ['暴风雪', '风雪', '雪暴'],
            '雪后初晴': ['初晴', '晴', '阳光'],
            '夜晚': ['夜', '夜晚', '雪夜'],
            '黎明': ['黎明', '清晨', '晨光'],
            '正午': ['正午', '白天'],
            '白雾寒潮': ['白雾', '寒潮', '雾']
        }
    },
    narrative: {
        label: '叙事动作',
        values: {
            '初次发现': ['发现', '探索', '入口', '打开'],
            '争夺资源': ['争夺', '抢夺', '资源', '燃料'],
            '正在搭建': ['搭建', '建造', '修建'],
            '被迫撤离': ['撤离', '逃离', '迁徙'],
            '护送救援': ['护送', '救援', '急救', '救命'],
            '修复重启': ['修复', '重启', '抢修']
        }
    },
    scale: {
        label: '规模',
        values: {
            '单体小件': ['药箱', '背包', '物资', '宝箱', '工具', '包装'],
            '小队行动': ['小队', '队伍', '幸存者们', '多人'],
            '中等建筑': ['建筑', '避难所', '仓库', '超市', '医院'],
            '巨型地标': ['巨型', '地标', '堡垒', '高塔', '城墙'],
            '微观细节': ['微观', '细节', '裂纹', '霜', '特写']
        }
    },
    material: {
        label: '材质质感',
        values: {
            '锈蚀金属': ['金属', '锈', '钢架', '铁皮'],
            '裂冰': ['裂冰', '冰裂', '冰层'],
            '厚雪': ['厚雪', '积雪', '雪堆'],
            '旧布料': ['旧布', '布料', '帐篷', '绷带'],
            '破损包装': ['破损包装', '包装', '箱', '袋'],
            '火光雾气': ['火光', '雾气', '蒸汽', '烟']
        }
    },
    subjectRelation: {
        label: '主体关系',
        values: {
            '人与物资': ['物资', '补给', '药品', '燃料', '食物'],
            '小队与灾害': ['小队', '暴风雪', '坍塌', '寒潮'],
            '敌我争夺': ['敌', '抢', '争夺', '对峙'],
            '角色与建筑': ['建筑', '避难所', '医院', '仓库', '超市'],
            '角色与载具': ['载具', '车', '驾驶', '车队']
        }
    },
    hook: {
        label: '广告钩子',
        values: {
            '稀缺奖励': ['稀缺', '奖励', '宝箱', '补给'],
            '危险冲突': ['危险', '危机', '冲突', '争夺'],
            '反差惊喜': ['反差', '惊喜', '隐藏', '发现'],
            '救命价值': ['救命', '急救', '药', '救援'],
            '选择压力': ['选择', '倒计时', '最后'],
            '升级收益': ['升级', '建造', '扩建', '收益']
        }
    }
};

function normalizeAutoBrowserMode(value, fallback = DEFAULT_AUTO_CONFIG.browserMode) {
    if (value === 'headless' || value === 'headed') {
        return value;
    }
    return fallback === 'headless' ? 'headless' : 'headed';
}

function todayKey() {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
}

function canWriteDirectory(dirPath) {
    if (!dirPath) {
        return false;
    }

    try {
        fs.mkdirSync(dirPath, { recursive: true });
        fs.accessSync(dirPath, fs.constants.W_OK);
        return true;
    } catch {
        return false;
    }
}

function toPublicSuggestion(item) {
    if (!item) return null;
    return {
        direction: item.direction,
        score: item.score,
        scoreParts: item.scoreParts,
        materialLearning: item.materialLearning,
        memoryRiskRules: item.memoryRiskRules,
        topMaterialInsight: item.topMaterialInsight,
        reasons: item.reasons
    };
}

function formatRunTimestamp(date = new Date()) {
    const parts = new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}${values.month}${values.day}_${values.hour}${values.minute}${values.second}`;
}

function uniqueStrings(values = []) {
    return Array.from(new Set(safeArray(values)
        .map(value => String(value || '').trim())
        .filter(Boolean)));
}

function directionPathParts(direction = {}) {
    return String(direction.path || direction.name || direction.id || '')
        .split('/')
        .map(part => part.trim())
        .filter(Boolean);
}

function normalizePathKey(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[\\/_\-\s.()[\]{}【】（）"'“”‘’]/g, '');
}

function pathPartsFromValue(value) {
    return String(value || '')
        .split('/')
        .map(part => part.trim())
        .filter(Boolean);
}

function directionDisplayPath(direction = {}) {
    return direction.path || [direction.primaryTag, direction.secondaryTag, direction.tertiaryTag, direction.subTag]
        .filter(Boolean)
        .join('/') || direction.name || direction.id || '';
}

function sameDirectionIdentity(left = {}, right = {}) {
    const leftKeys = [left.id, directionDisplayPath(left), left.name].map(normalizePathKey).filter(Boolean);
    const rightKeys = [right.id, directionDisplayPath(right), right.name].map(normalizePathKey).filter(Boolean);
    return leftKeys.some(key => rightKeys.includes(key));
}

function creativeBriefFromPayload(payload = {}) {
    const envelope = payload && payload.creativeBrief ? payload.creativeBrief : null;
    if (!envelope) return null;
    return envelope.brief || envelope.plan || envelope;
}

function cloneJson(value) {
    return JSON.parse(JSON.stringify(value || {}));
}

function hashText(value) {
    return crypto
        .createHash('sha1')
        .update(String(value || ''))
        .digest('hex')
        .slice(0, 12);
}

function creativeBriefTargetsFromPayload(payload = {}) {
    const brief = creativeBriefFromPayload(payload);
    return safeArray(brief && (brief.creativeTargets || brief.targets));
}

function isSequentialCreativeTargetPayload(payload = {}) {
    if (payload.sequentialTargets === false) return false;
    const brief = creativeBriefFromPayload(payload);
    const targets = creativeBriefTargetsFromPayload(payload);
    return Boolean(
        brief &&
        targets.length > 1 &&
        (brief.packageType === 'creative-target-package' || brief.target === 'source-directions')
    );
}

function payloadForSingleCreativeTarget(payload = {}, target = {}, index = 0, total = 1, queueId = '') {
    const nextPayload = cloneJson(payload);
    const envelope = nextPayload.creativeBrief || nextPayload;
    const brief = envelope.brief || envelope.plan || envelope;
    const singleTarget = {
        ...target,
        selected: true
    };
    const directionPath = singleTarget.sourceDirectionPath || singleTarget.sourceDirectionKey || brief.directionPath || brief.directionKey || '';
    const materialName = singleTarget.sourceMaterialName || singleTarget.materialName || '';

    brief.creativeTargets = [singleTarget];
    brief.targets = [singleTarget];
    brief.targetCount = 1;
    brief.selectedMaterialCount = 1;
    brief.directionPath = directionPath;
    brief.directionKey = directionPath;
    brief.materialName = materialName || brief.materialName || directionPath;
    brief.visualInsight = singleTarget.visualInsight || brief.visualInsight || '';
    brief.retainElements = safeArray(singleTarget.retainElements).length ? safeArray(singleTarget.retainElements) : safeArray(brief.retainElements);
    brief.variationAxes = safeArray(singleTarget.variationAxes).length ? safeArray(singleTarget.variationAxes) : safeArray(brief.variationAxes);
    brief.avoidRules = safeArray(singleTarget.avoidRules).length ? safeArray(singleTarget.avoidRules) : safeArray(brief.avoidRules);
    brief.sequentialQueue = {
        queueId,
        index: index + 1,
        total
    };
    brief.request = `Only process creative target ${index + 1}/${total} in this queue. Expand and generate images for this one TOP material before the next target starts.`;

    nextPayload.creativeBrief = envelope;
    nextPayload.sequentialTargets = false;
    return nextPayload;
}

function creativeBriefDirectionPath(brief = {}) {
    if (!brief || typeof brief !== 'object') return '';
    if (brief.directionPath || brief.directionKey) {
        return String(brief.directionPath || brief.directionKey || '').trim();
    }
    const targets = safeArray(brief.creativeTargets);
    const firstTarget = targets[0] || {};
    return String(firstTarget.sourceDirectionPath || firstTarget.sourceDirectionKey || '').trim();
}

function buildCreativeBriefSelectedDirection(brief = {}, directionLibrary = []) {
    if (!brief || typeof brief !== 'object') return null;
    const targets = safeArray(brief.creativeTargets);
    let pathLabel = creativeBriefDirectionPath(brief) ||
        String(brief.materialName || brief.planId || brief.runId || '素材分析指定方向').trim();
    if (!pathLabel) return null;

    const rawPathLabel = pathLabel;
    const firstTarget = targets[0] || {};
    const namingContext = buildCreativeOutputNamingContext({
        sourceDirectionPath: rawPathLabel,
        sourceRawName: brief.materialName || firstTarget.sourceRawName || firstTarget.sourceMaterialName || '',
        contentTitle: brief.sourceVisualTitle || brief.visualInsight || firstTarget.sourceVisualDirection || '',
        fallbackName: brief.materialName || rawPathLabel,
        directionLibrary,
        strictLibraryTags: true
    });
    if (Array.isArray(namingContext.standardLabelPath) && namingContext.standardLabelPath.length) {
        pathLabel = namingContext.standardLabelPath.join('/');
    }

    const parts = pathLabel.split('/').map(part => part.trim()).filter(Boolean);
    const hash = crypto
        .createHash('sha1')
        .update(JSON.stringify({
            runId: brief.runId || '',
            target: brief.target || '',
            path: pathLabel,
            rawPath: rawPathLabel,
            materialId: brief.materialId || '',
            targetIds: targets.map(target => target.targetId || target.sourceDirectionPath || target.sourceDirectionKey)
        }))
        .digest('hex')
        .slice(0, 12);
    const direction = {
        id: `material_analysis_brief_${hash}`,
        path: pathLabel,
        name: parts[parts.length - 1] || pathLabel,
        primaryTag: parts[0] || '',
        secondaryTag: parts[1] || '',
        tertiaryTag: parts[2] || '',
        subTag: parts.slice(3).join('/'),
        standardLabelPath: namingContext.standardLabelPath || [],
        sourceContentTitle: namingContext.sourceContentTitle || '',
        sourceParsedParts: namingContext.sourceParsedParts || [],
        droppedLabelParts: namingContext.droppedLabelParts || [],
        namingSource: namingContext.namingSource || '',
        tagConfidence: namingContext.tagConfidence || '',
        description: [
            brief.materialName ? `素材：${brief.materialName}` : '',
            brief.visualInsight ? `视觉：${brief.visualInsight}` : '',
            targets.length ? `素材分析任务包覆盖 ${targets.length} 个目标。` : ''
        ].filter(Boolean).join(' '),
        referenceHints: uniqueStrings([
            ...safeArray(brief.retainElements),
            ...safeArray(brief.variationAxes),
            ...targets.flatMap(target => safeArray(target.retainElements))
        ]).slice(0, 20),
        mustKeep: uniqueStrings([
            ...safeArray(brief.retainElements),
            ...targets.flatMap(target => safeArray(target.retainElements))
        ]).join('；'),
        mustAvoid: uniqueStrings([
            ...safeArray(brief.avoidRules),
            ...targets.flatMap(target => safeArray(target.avoidRules))
        ]).join('；'),
        autoRun: true,
        status: 'accepted',
        source: 'material-analysis',
        materialAnalysisBrief: true,
        aggregate: targets.length > 1,
        memberDirectionIds: targets.map(target => target.targetId || target.sourceDirectionPath || target.sourceDirectionKey).filter(Boolean),
        memberDirectionPaths: targets.map(target => target.sourceDirectionPath || target.sourceDirectionKey).filter(Boolean),
        rawDirectionPath: rawPathLabel
    };

    return {
        direction,
        score: 100,
        scoreParts: {
            materialAnalysisBrief: 100
        },
        topMaterialInsight: brief.visualInsight ? {
            path: pathLabel,
            score: 100,
            summary: brief.visualInsight
        } : null,
        reasons: [
            '素材分析 brief 指定方向优先',
            brief.visualInsight ? `视觉依据：${brief.visualInsight}` : ''
        ].filter(Boolean),
        aggregateTarget: targets.length > 1 ? {
            type: 'material-analysis-brief',
            level: 'creativeTargets',
            path: pathLabel,
            directionCount: targets.length,
            directions: targets.map(target => ({
                id: target.targetId || target.sourceDirectionPath || target.sourceDirectionKey,
                path: target.sourceDirectionPath || target.sourceDirectionKey || '',
                description: target.visualSummary || '',
                referenceHints: safeArray(target.retainElements).slice(0, 5)
            }))
        } : null
    };
}

function isRunnableDirection(direction = {}) {
    const status = String(direction.status || 'seed').trim().toLowerCase();
    return direction.autoRun !== false && ['seed', 'accepted'].includes(status);
}

function buildAggregateDirectionId(parts = [], directionIds = []) {
    const hash = crypto
        .createHash('sha1')
        .update(JSON.stringify({ parts, directionIds: uniqueStrings(directionIds).sort() }))
        .digest('hex')
        .slice(0, 12);
    return `direction_group_${hash}`;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function safeArray(value) {
    return Array.isArray(value) ? value : [];
}

function directionSearchText(direction = {}) {
    return [
        directionDisplayPath(direction),
        direction.name,
        direction.description,
        direction.mustKeep,
        direction.mustAvoid,
        safeArray(direction.referenceHints).join(' ')
    ].filter(Boolean).join(' ');
}

function inferDirectionDimensionLabels(direction = {}) {
    const text = directionSearchText(direction);
    const result = {};
    Object.entries(CREATIVE_DIMENSION_KEYWORDS).forEach(([dimensionKey, dimension]) => {
        const matched = [];
        Object.entries(dimension.values).forEach(([value, keywords]) => {
            if (keywords.some(keyword => text.includes(keyword))) {
                matched.push(value);
            }
        });
        result[dimensionKey] = matched;
    });
    return result;
}

function buildDirectionTreeSummary(directions = [], selectedDirection = {}, limit = 90) {
    const root = { children: new Map() };
    safeArray(directions).forEach(direction => {
        const parts = pathPartsFromValue(directionDisplayPath(direction));
        if (!parts.length) return;
        let cursor = root;
        parts.forEach(part => {
            if (!cursor.children.has(part)) {
                cursor.children.set(part, {
                    label: part,
                    count: 0,
                    children: new Map()
                });
            }
            cursor = cursor.children.get(part);
            cursor.count += 1;
        });
    });

    const selectedParts = pathPartsFromValue(directionDisplayPath(selectedDirection));
    const lines = [];
    function renderNode(node, depth, pathParts) {
        if (lines.length >= limit) return;
        const pathKey = pathParts.join('/');
        const isSelectedBranch = selectedParts.length && selectedParts.slice(0, pathParts.length).join('/') === pathKey;
        const marker = isSelectedBranch ? ' *' : '';
        lines.push(`${'  '.repeat(depth)}- ${node.label}${node.count > 1 ? ` (${node.count})` : ''}${marker}`);
        const children = Array.from(node.children.values())
            .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'zh-CN'));
        const childLimit = isSelectedBranch ? 12 : 8;
        children.slice(0, childLimit).forEach(child => renderNode(child, depth + 1, [...pathParts, child.label]));
        if (children.length > childLimit && lines.length < limit) {
            lines.push(`${'  '.repeat(depth + 1)}- ... 还有 ${children.length - childLimit} 个节点`);
        }
    }

    Array.from(root.children.values())
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'zh-CN'))
        .slice(0, 12)
        .forEach(child => renderNode(child, 0, [child.label]));

    return lines.slice(0, limit).join('\n');
}

function findSiblingDirections(directions = [], selectedDirection = {}, limit = 18) {
    const selectedParts = pathPartsFromValue(directionDisplayPath(selectedDirection));
    if (!selectedParts.length) return [];
    const parentPath = selectedParts.slice(0, -1).join('/');
    const siblings = safeArray(directions)
        .filter(direction => !sameDirectionIdentity(direction, selectedDirection))
        .filter(direction => {
            const parts = pathPartsFromValue(directionDisplayPath(direction));
            return parts.length === selectedParts.length && parts.slice(0, -1).join('/') === parentPath;
        })
        .slice(0, limit)
        .map(direction => ({
            id: direction.id || '',
            path: directionDisplayPath(direction),
            label: direction.name || pathPartsFromValue(directionDisplayPath(direction)).slice(-1)[0] || direction.id || '',
            description: direction.description || '',
            dimensions: inferDirectionDimensionLabels(direction)
        }));

    if (siblings.length) {
        return siblings;
    }

    const selectedPath = selectedParts.join('/');
    return safeArray(directions)
        .filter(direction => !sameDirectionIdentity(direction, selectedDirection))
        .filter(direction => directionDisplayPath(direction).startsWith(`${selectedPath}/`))
        .slice(0, limit)
        .map(direction => ({
            id: direction.id || '',
            path: directionDisplayPath(direction),
            label: direction.name || pathPartsFromValue(directionDisplayPath(direction)).slice(-1)[0] || direction.id || '',
            description: direction.description || '',
            dimensions: inferDirectionDimensionLabels(direction)
        }));
}

function buildDimensionCoverage(directions = []) {
    const peers = safeArray(directions);
    const coverage = {};
    Object.entries(CREATIVE_DIMENSION_KEYWORDS).forEach(([dimensionKey, dimension]) => {
        const counts = {};
        Object.keys(dimension.values).forEach(value => {
            counts[value] = 0;
        });
        peers.forEach(direction => {
            const inferred = inferDirectionDimensionLabels(direction)[dimensionKey] || [];
            inferred.forEach(value => {
                counts[value] = (counts[value] || 0) + 1;
            });
        });
        coverage[dimensionKey] = {
            label: dimension.label,
            observed: Object.entries(counts)
                .filter(([, count]) => count > 0)
                .map(([value, count]) => ({ value, count })),
            gaps: Object.entries(counts)
                .filter(([, count]) => count === 0)
                .map(([value]) => value)
                .slice(0, 4)
        };
    });
    return coverage;
}

function collectExistingDirectionsForExclusion(directions = [], selectedDirection = {}, siblings = [], limit = 40) {
    const selectedParts = pathPartsFromValue(directionDisplayPath(selectedDirection));
    const selectedPath = selectedParts.join('/');
    const parentPath = selectedParts.slice(0, -1).join('/');
    const candidates = safeArray(directions)
        .filter(direction => !sameDirectionIdentity(direction, selectedDirection))
        .filter(direction => {
            const pathValue = directionDisplayPath(direction);
            const parts = pathPartsFromValue(pathValue);
            return pathValue.startsWith(`${selectedPath}/`) || parts.slice(0, -1).join('/') === parentPath;
        })
        .map(direction => direction.name || pathPartsFromValue(directionDisplayPath(direction)).slice(-1)[0] || directionDisplayPath(direction))
        .concat(safeArray(siblings).map(item => item.label || item.path))
        .map(value => String(value || '').trim())
        .filter(Boolean);
    return uniqueStrings(candidates).slice(0, limit);
}

function sampleMatchesDirectionIdentity(sample = {}, selectedDirection = {}) {
    const selectedKeys = [selectedDirection.id, directionDisplayPath(selectedDirection)].map(normalizePathKey).filter(Boolean);
    if (!selectedKeys.length) return true;
    const sampleKeys = [
        sample.sourceDirectionId,
        sample.sourceDirectionPath,
        sample.directionId,
        sample.directionPath
    ].map(normalizePathKey).filter(Boolean);
    if (!sampleKeys.length) return true;
    return sampleKeys.some(key => selectedKeys.includes(key));
}

function collectHistoricalPromptHashes(store, selectedDirection = {}, currentRunId = '', limit = 40) {
    const hashes = [];
    const pushHash = (value, meta = {}) => {
        const hash = String(value || '').trim();
        if (!hash || (meta.runId && meta.runId === currentRunId)) return;
        if (!sampleMatchesDirectionIdentity(meta, selectedDirection)) return;
        hashes.push(hash);
    };
    safeArray(store.read('assets.json', { assets: [] }).assets).forEach(asset => {
        pushHash(asset && asset.promptHash, asset || {});
    });

    const runsDir = store.filePath('runs');
    if (fs.existsSync(runsDir)) {
        fs.readdirSync(runsDir)
            .filter(fileName => fileName.endsWith('.json'))
            .filter(fileName => fileName !== `${currentRunId}.json`)
            .forEach(fileName => {
                try {
                    const run = JSON.parse(fs.readFileSync(path.join(runsDir, fileName), 'utf8'));
                    const sourceDirection = run.sourceDirection || {};
                    safeArray(run.prompts).forEach(prompt => pushHash(prompt && prompt.promptHash, {
                        ...(prompt || {}),
                        runId: run.runId,
                        sourceDirectionId: sourceDirection.id,
                        sourceDirectionPath: sourceDirection.path
                    }));
                    safeArray(run.assets).forEach(asset => pushHash(asset && asset.promptHash, {
                        ...(asset || {}),
                        runId: run.runId,
                        sourceDirectionId: sourceDirection.id,
                        sourceDirectionPath: sourceDirection.path
                    }));
                } catch {
                    // Ignore malformed historical run snapshots; Prompt Gate performs its own tolerant reads too.
                }
            });
    }

    return uniqueStrings(hashes).slice(0, limit);
}

function collectRejectedDirectionContext(store, selectedDirection = {}, currentRunId = '', limit = 20) {
    const rejected = [];
    const runsDir = store.filePath('runs');
    if (!fs.existsSync(runsDir)) return rejected;

    fs.readdirSync(runsDir)
        .filter(fileName => fileName.endsWith('.json'))
        .filter(fileName => fileName !== `${currentRunId}.json`)
        .forEach(fileName => {
            try {
                const run = JSON.parse(fs.readFileSync(path.join(runsDir, fileName), 'utf8'));
                const sourceDirection = run.sourceDirection || {};
                if (!sampleMatchesDirectionIdentity({
                    sourceDirectionId: sourceDirection.id,
                    sourceDirectionPath: sourceDirection.path
                }, selectedDirection)) {
                    return;
                }
                safeArray(run.promptQualityReport && run.promptQualityReport.rejectedPrompts).forEach(item => {
                    rejected.push({
                        direction: item.newDirectionName || item.direction || item.contentTitle || '',
                        promptTitle: item.promptTitle || '',
                        reason: item.reason || '',
                        message: item.message || ''
                    });
                });
            } catch {
                // Ignore malformed historical run snapshots.
            }
        });

    return rejected
        .filter(item => item.direction || item.reason || item.message)
        .slice(-limit)
        .reverse();
}

function buildDirectionSystemContext({ directions = [], selected, store, currentRunId = '' }) {
    const selectedDirection = selected && selected.direction ? selected.direction : {};
    const siblings = findSiblingDirections(directions, selectedDirection);
    const siblingDirections = siblings.map(sibling => ({
        id: sibling.id,
        path: sibling.path,
        name: sibling.label,
        description: sibling.description
    }));
    const dimensionCoverage = buildDimensionCoverage(siblingDirections.length ? siblingDirections : [selectedDirection]);
    const historicalUsage = collectHistoricalCreativeUsage(store, currentRunId, {
        maxDirectionSamples: 160,
        maxPromptSamples: 120
    });
    const exclusionContext = {
        existingDirectionNames: collectExistingDirectionsForExclusion(directions, selectedDirection, siblings),
        historicalPromptHashes: collectHistoricalPromptHashes(store, selectedDirection, currentRunId),
        historicalDirectionNames: uniqueStrings(historicalUsage.directionSamples
            .filter(sample => sampleMatchesDirectionIdentity(sample, selectedDirection))
            .map(sample => sample.newDirectionName)
            .filter(Boolean))
            .slice(0, 40),
        rejectedDirections: collectRejectedDirectionContext(store, selectedDirection, currentRunId)
    };

    return {
        selectedNode: directionDisplayPath(selectedDirection),
        targetLevel: pathPartsFromValue(directionDisplayPath(selectedDirection)).length >= 4 ? 'L4' : `L${Math.max(1, pathPartsFromValue(directionDisplayPath(selectedDirection)).length + 1)}`,
        directionTreeSummary: buildDirectionTreeSummary(directions, selectedDirection),
        siblings,
        dimensionCoverage,
        exclusionContext
    };
}

function isFinalLegilPhase(phase) {
    return ['completed', 'stopped', 'interrupted', 'failed'].includes(String(phase || ''));
}

function isFinalRunStatus(status) {
    return ['completed', 'paused', 'failed', 'stopped', 'cancelled'].includes(String(status || ''));
}

function isAgentRunningPhase(phase) {
    const value = String(phase || '');
    return value.startsWith('agent_') && value !== 'agent_completed';
}

function isLegilRunPhase(phase) {
    return String(phase || '').startsWith('legil_');
}

function createCreativeAutoService(options = {}) {
    const rootDir = options.rootDir || options.ROOT_DIR || process.cwd();
    const logger = options.logger || console;
    let activeRunId = null;
    let activeTargetQueue = null;

    function getKnowledgeStore(configOverrides = {}) {
        const knowledgeConfig = buildDefaultConfig(rootDir, configOverrides);
        return {
            knowledgeConfig,
            store: new CreativeKnowledgeStore(knowledgeConfig.dataDir)
        };
    }

    function readKnowledge(configOverrides = {}) {
        const { knowledgeConfig, store } = getKnowledgeStore(configOverrides);
        store.ensureBase();
        const metadata = store.read('metadata.json', {
            importedAt: null,
            counts: {
                directions: 0,
                topMaterials: 0,
                topMaterialInsights: 0,
                referenceImages: 0
            },
            warnings: []
        });
        const directionData = store.read('directions.json', {
            directions: []
        });
        const insightData = store.read('top-material-insights.json', {
            insights: []
        });
        const materialLearningData = store.read('material-learnings.json', {
            learnings: []
        });
        const referenceData = store.read('reference-images.json', {
            images: []
        });
        const schedulerState = store.read('scheduler-state.json', {
            status: 'idle',
            consecutiveFailures: 0,
            daily: {
                date: todayKey(),
                imageCount: 0,
                imageLimit: DEFAULT_AUTO_CONFIG.maxImagesPerDay
            }
        });
        const creativeMemory = store.read('creative-memory.json', emptyCreativeMemory());
        const memoryRules = getActiveMemoryRules(creativeMemory);

        return {
            knowledgeConfig,
            metadata,
            directions: directionData.directions || [],
            insights: insightData.insights || [],
            materialLearnings: materialLearningData.learnings || [],
            referenceImages: referenceData.images || [],
            schedulerState,
            creativeMemory,
            memoryRules
        };
    }

    function buildPreflight(appConfig, knowledge) {
        const creativeConfig = appConfig.creative || {};
        const outputFolder = creativeConfig.outputFolder || 'D:\\工作\\自动化工作流1\\创意拓展\\输出';
        const referenceFolder = creativeConfig.referenceFolder || knowledge.knowledgeConfig.referenceFolder;
        const checks = [
            {
                id: 'knowledgeImported',
                label: '创意知识库已导入',
                ok: Boolean(knowledge.metadata.importedAt && knowledge.directions.length > 0),
                level: 'error'
            },
            {
                id: 'outputFolderWritable',
                label: '输出目录可写',
                ok: canWriteDirectory(outputFolder),
                level: 'error',
                path: outputFolder
            },
            {
                id: 'referenceFolderExists',
                label: '参考图目录存在',
                ok: Boolean(referenceFolder && fs.existsSync(referenceFolder)),
                level: 'warning',
                path: referenceFolder
            },
            {
                id: 'browserModeConfigured',
                label: '浏览器模式已设置',
                ok: true,
                level: 'warning',
                actual: normalizeAutoBrowserMode(creativeConfig.browserMode || DEFAULT_AUTO_CONFIG.browserMode)
            }
        ];

        return {
            ok: checks.every(check => check.ok || check.level !== 'error'),
            checks
        };
    }

    function getStatus(context = {}) {
        const appConfig = context.appConfig || {};
        const knowledge = readKnowledge(context);
        const { store } = getKnowledgeStore(context);
        const selected = selectNextDirection(knowledge.directions, knowledge.insights, {
            limit: Number(context.limit) || 10,
            materialLearnings: knowledge.materialLearnings,
            memoryRules: knowledge.memoryRules
        });
        const daily = knowledge.schedulerState.daily || {};
        const dailyImageCount = daily.date === todayKey() ? Number(daily.imageCount) || 0 : 0;
        const liveLegilTask = getLiveCreativeLegilTask();
        const activeRun = syncLiveLegilRun(store, liveLegilTask, context) || (activeRunId ? getRun(activeRunId, context) : null);
        const resumableRun = activeRun ? null : attachTargetQueueProgress(store, findResumableRun(store, knowledge.schedulerState));
        const schedulerQueue = knowledge.schedulerState && knowledge.schedulerState.targetQueue
            ? knowledge.schedulerState.targetQueue
            : null;
        const visibleQueue = activeRun && activeRun.targetQueueProgress
            ? activeRun.targetQueueProgress
            : (resumableRun && resumableRun.targetQueueProgress ? resumableRun.targetQueueProgress : schedulerQueue);

        return {
            success: true,
            status: activeRun ? 'running' : (resumableRun ? 'idle' : (knowledge.schedulerState.status || 'idle')),
            mode: DEFAULT_AUTO_CONFIG.mode,
            config: {
                ...DEFAULT_AUTO_CONFIG,
                outputFolder: (appConfig.creative && appConfig.creative.outputFolder) || 'D:\\工作\\自动化工作流1\\创意拓展\\输出',
                referenceFolder: (appConfig.creative && appConfig.creative.referenceFolder) || knowledge.knowledgeConfig.referenceFolder,
                browserMode: (appConfig.creative && appConfig.creative.browserMode) || DEFAULT_AUTO_CONFIG.browserMode,
                generationSettings: {
                    ...DEFAULT_AUTO_CONFIG.generationSettings,
                    ...((appConfig.creative && appConfig.creative.generationSettings) || {})
                }
            },
            quota: {
                date: todayKey(),
                usedImagesToday: dailyImageCount,
                maxImagesPerDay: null,
                remainingImagesToday: UNLIMITED_PROMPT_LIMIT,
                unlimitedImages: true,
                promptOutputQuantity: DEFAULT_AUTO_CONFIG.outputQuantity
            },
            knowledge: {
                imported: Boolean(knowledge.metadata.importedAt),
                importedAt: knowledge.metadata.importedAt,
                counts: knowledge.metadata.counts,
                warnings: knowledge.metadata.warnings || []
            },
            preflight: buildPreflight(appConfig, knowledge),
            suggestion: {
                next: toPublicSuggestion(selected.next),
                candidates: selected.candidates.map(toPublicSuggestion)
            },
            targetQueue: visibleQueue,
            legilTask: liveLegilTask ? publicLiveLegilTask(liveLegilTask) : null,
            activeRun,
            resumableRun
        };
    }

    function getRun(runId, context = {}) {
        const { store } = getKnowledgeStore(context);
        store.ensureBase();
        const id = path.basename(String(runId || ''));
        if (!id) {
            return null;
        }
        return attachTargetQueueProgress(store, store.read(path.join('runs', `${id}.json`), null));
    }

    function getLiveCreativeLegilTask() {
        const snapshot = getLegilCreativeProgressSnapshot();
        const progress = snapshot && snapshot.progress ? snapshot.progress : {};
        const taskType = snapshot && (snapshot.taskType || progress.taskType);
        const phase = progress.phase || '';
        if (!snapshot || taskType !== 'creative-batch') {
            return null;
        }

        if (snapshot.running !== true && !isFinalLegilPhase(phase)) {
            return null;
        }

        return {
            snapshot,
            progress,
            runId: String(progress.creativeAutoRunId || '').trim()
        };
    }

    function publicLiveLegilTask(task = {}) {
        const progress = task.progress || {};
        return {
            running: task.snapshot && task.snapshot.running === true,
            stopRequested: task.snapshot && task.snapshot.stopRequested === true,
            taskType: task.snapshot && task.snapshot.taskType,
            runId: task.runId || '',
            phase: progress.phase || '',
            currentAction: progress.currentAction || '',
            completed: Number(progress.completed) || 0,
            total: Number(progress.total) || 0,
            saved: Number(progress.saved) || 0,
            updatedAt: progress.updatedAt || ''
        };
    }

    function syncLiveLegilRun(store, liveTask, context = {}) {
        if (!liveTask || !liveTask.runId) {
            return null;
        }

        const run = getRun(liveTask.runId, context);
        if (!run) {
            return null;
        }

        const progress = liveTask.progress || {};
        const syncedTask = updateLegilTaskState(run.legilTask || {}, {
            status: 'running',
            phase: progress.phase || 'running',
            progress,
            lastSnapshot: liveTask.snapshot
        });
        if (liveTask.snapshot && liveTask.snapshot.running !== true && isFinalLegilPhase(progress.phase)) {
            finalizeLiveLegilRun(store, run, progress, liveTask.snapshot);
            return null;
        }

        const nextRun = updateRun(store, run.runId, {
            status: 'running',
            phase: `legil_${progress.phase || 'running'}`,
            legilProgress: progress,
            legilTask: syncedTask,
            message: progress.currentAction || run.message || 'Legil creative task is running'
        }) || run;

        activeRunId = run.runId;
        return attachTargetQueueProgress(store, nextRun);
    }

    function finalizeLiveLegilRun(store, run = {}, progress = {}, snapshot = null) {
        if (!run || !run.runId) return null;
        if (isFinalRunStatus(run.status) && isLegilRunPhase(run.phase) && run.legilResult) {
            return attachTargetQueueProgress(store, run);
        }

        const savedCount = Number(progress.saved) || 0;
        const failedCount = Number(progress.failed) || 0;
        const successCount = Number(progress.success) || 0;
        const completed = progress.phase === 'completed' && (savedCount > 0 || successCount > 0 || failedCount === 0);
        const paused = progress.phase === 'stopped';
        const completedAt = new Date().toISOString();
        const selected = buildSelectedFromRun(run);
        const finalTask = updateLegilTaskState(run.legilTask || {}, {
            status: completed ? 'completed' : (paused ? 'paused' : 'failed'),
            phase: progress.phase,
            progress,
            lastSnapshot: snapshot,
            completedAt
        });
        const finalRun = updateRun(store, run.runId, {
            status: completed ? 'completed' : (paused ? 'paused' : 'failed'),
            phase: completed ? 'legil_completed' : (paused ? 'legil_paused' : 'legil_failed'),
            completedAt,
            legilProgress: progress,
            legilTask: finalTask,
            legilResult: {
                success: completed,
                phase: progress.phase,
                successCount,
                failedCount,
                savedCount,
                outputTotal: Number(progress.outputTotal) || 0,
                message: progress.currentAction || ''
            },
            message: completed
                ? `Legil 生图完成：成功 ${successCount} 组，失败 ${failedCount} 组，保存 ${savedCount} 张`
                : `Legil 生图未完成：${progress.currentAction || progress.phase}`
        }) || run;

        let runWithAssets = finalRun;
        if (savedCount > 0 && finalRun) {
            try {
                const assetReport = registerRunAssets({
                    store,
                    run: finalRun,
                    progress
                });
                runWithAssets = updateRun(store, run.runId, {
                    assets: assetReport,
                    assetIds: assetReport.assetIds || []
                }) || finalRun;
            } catch (error) {
                if (logger && typeof logger.warn === 'function') {
                    logger.warn(`创意拓展资产登记失败: ${error.message}`);
                }
            }
        }

        notifyCreativeAutoRunFinal(runWithAssets || finalRun, completed ? 'completed' : (paused ? 'paused' : 'failed'));
        updateSelectedDirectionPromptStats(store, selected, {
            imageCountDelta: savedCount,
            failureCountDelta: completed ? 0 : 1,
            lastRunAt: completedAt
        });
        writeSchedulerState(store, {
            status: 'idle',
            currentRunId: null,
            currentAgentTaskRunId: null,
            currentLegilTask: null,
            lastRunId: run.runId,
            lastCompletedAt: completedAt,
            lastLegilPhase: progress.phase,
            consecutiveFailures: completed ? 0 : Number((run.schedulerState && run.schedulerState.consecutiveFailures) || 0) + 1,
            daily: buildDailyAfterLegil(run.schedulerState, savedCount)
        });
        if (activeRunId === run.runId) {
            activeRunId = null;
        }
        startNextQueuedTarget(runWithAssets || finalRun);
        return runWithAssets || finalRun;
    }

    function readRuns(store) {
        store.ensureBase();
        const runsDir = store.filePath('runs');
        if (!fs.existsSync(runsDir)) {
            return [];
        }

        return fs.readdirSync(runsDir)
            .filter(fileName => fileName.endsWith('.json'))
            .map(fileName => store.read(path.join('runs', fileName), null))
            .filter(Boolean)
            .sort((a, b) => Date.parse(b.updatedAt || b.startedAt || b.createdAt || '') - Date.parse(a.updatedAt || a.startedAt || a.createdAt || ''));
    }

    function canResumeRun(run = {}) {
        if (!run || !run.runId) return false;
        if (run.status === 'paused') return true;
        return run.status === 'completed' && run.phase === 'agent_completed' && safeArray(run.prompts).length > 0;
    }

    function reconcileStaleRunningRun(store, run = {}) {
        if (!run || run.status !== 'running') {
            return run;
        }
        if (activeRunId === run.runId) {
            return run;
        }

        const phase = String(run.phase || '');
        const resumablePhase = isAgentRunningPhase(phase) || isLegilRunPhase(phase);
        if (!resumablePhase) {
            return run;
        }

        const reconciledRun = updateRun(store, run.runId, {
            status: 'paused',
            phase: isAgentRunningPhase(phase) ? 'agent_cancelled' : 'legil_paused',
            completedAt: run.completedAt || new Date().toISOString(),
            message: '服务重启或页面刷新后检测到未收尾任务，可点击“继续之前任务”。'
        }) || run;
        writeSchedulerState(store, {
            status: 'idle',
            currentRunId: null,
            currentAgentTaskRunId: null,
            currentLegilTask: null,
            lastRunId: run.runId,
            lastError: reconciledRun.message
        });
        updateTargetQueueFromRun(store, reconciledRun, 'paused');
        return reconciledRun;
    }

    function findResumableRun(store, schedulerState = {}) {
        const candidateIds = uniqueStrings([
            activeRunId,
            schedulerState.currentRunId,
            schedulerState.lastRunId
        ]);

        for (const runId of candidateIds) {
            const run = reconcileStaleRunningRun(store, store.read(path.join('runs', `${path.basename(runId)}.json`), null));
            if (canResumeRun(run)) {
                return run;
            }
        }

        return readRuns(store).map(run => reconcileStaleRunningRun(store, run)).find(canResumeRun) || null;
    }

    function writeRun(store, run) {
        store.write(path.join('runs', `${run.runId}.json`), {
            ...run,
            updatedAt: new Date().toISOString()
        });
    }

    function updateRun(store, runId, updates = {}) {
        const current = store.read(path.join('runs', `${runId}.json`), null);
        if (!current) {
            return null;
        }

        const next = {
            ...current,
            ...updates
        };
        writeRun(store, next);
        return next;
    }

    function writeSchedulerState(store, updates = {}) {
        const current = store.read('scheduler-state.json', {
            version: 1,
            status: 'idle',
            consecutiveFailures: 0,
            daily: {
                date: todayKey(),
                imageCount: 0,
                imageLimit: DEFAULT_AUTO_CONFIG.maxImagesPerDay
            },
            updatedAt: new Date().toISOString()
        });
        const next = {
            ...current,
            ...updates,
            updatedAt: new Date().toISOString()
        };
        Object.keys(next).forEach(key => {
            if (next[key] === null) {
                delete next[key];
            }
        });
        store.write('scheduler-state.json', next);
    }

    function readTargetQueueState(store) {
        const state = store.read(CREATIVE_TARGET_QUEUE_FILE, {
            version: 1,
            queues: []
        });
        return {
            version: Number(state.version) || 1,
            queues: safeArray(state.queues)
        };
    }

    function writeTargetQueueState(store, state = {}) {
        store.write(CREATIVE_TARGET_QUEUE_FILE, {
            version: Number(state.version) || 1,
            queues: safeArray(state.queues),
            updatedAt: new Date().toISOString()
        });
    }

    function targetQueueExpectedPromptCount(target = {}) {
        const newDirectionsPerSource = Math.max(1, Math.min(10, Math.floor(Number(target.newDirectionsPerSource) || 3)));
        const promptGroupsPerNewDirection = Math.max(1, Math.min(10, Math.floor(Number(target.promptGroupsPerNewDirection) || 4)));
        return newDirectionsPerSource * promptGroupsPerNewDirection;
    }

    function buildTargetQueueSummary(targets = []) {
        const normalizedTargets = safeArray(targets);
        return {
            totalTargets: normalizedTargets.length,
            totalExpectedPromptCount: normalizedTargets.reduce((sum, target) => {
                return sum + (Number(target.expectedPromptCount) || targetQueueExpectedPromptCount(target));
            }, 0)
        };
    }

    function publicTargetQueue(queue = null) {
        if (!queue || !queue.queueId) return null;
        const totalTargets = Number(queue.totalTargets) || safeArray(queue.targets).length;
        const currentIndex = Math.max(0, Number(queue.currentIndex) || 0);
        const nextIndex = Math.max(0, Number(queue.nextIndex) || 0);
        const completedTargets = safeArray(queue.completedTargetIds).length;
        const currentTarget = safeArray(queue.targets)[currentIndex] || null;
        return {
            queueId: queue.queueId,
            status: queue.status || 'running',
            totalTargets,
            currentIndex: Math.min(totalTargets, currentIndex + 1),
            nextIndex,
            completedTargets,
            remainingTargets: Math.max(0, totalTargets - completedTargets),
            currentRunId: queue.currentRunId || '',
            currentTargetId: currentTarget && (currentTarget.targetId || currentTarget.targetKey || currentTarget.sourceMaterialId || ''),
            currentTargetName: currentTarget && (currentTarget.sourceMaterialName || currentTarget.materialName || currentTarget.sourceDirectionPath || ''),
            totalExpectedPromptCount: Number(queue.totalExpectedPromptCount) || buildTargetQueueSummary(queue.targets).totalExpectedPromptCount,
            startedAt: queue.startedAt || '',
            updatedAt: queue.updatedAt || ''
        };
    }

    function loadTargetQueue(store, queueId = '') {
        const id = String(queueId || '').trim();
        if (!id) return null;
        return readTargetQueueState(store).queues.find(queue => queue && queue.queueId === id) || null;
    }

    function writeTargetQueue(store, queue = {}) {
        if (!queue || !queue.queueId) return null;
        const state = readTargetQueueState(store);
        const now = new Date().toISOString();
        const nextQueue = {
            ...queue,
            updatedAt: now
        };
        const index = state.queues.findIndex(item => item && item.queueId === queue.queueId);
        if (index >= 0) {
            state.queues[index] = nextQueue;
        } else {
            state.queues.push(nextQueue);
        }
        writeTargetQueueState(store, state);
        return nextQueue;
    }

    function updateTargetQueue(store, queueId = '', updates = {}) {
        const queue = loadTargetQueue(store, queueId);
        if (!queue) return null;
        return writeTargetQueue(store, {
            ...queue,
            ...updates
        });
    }

    function createTargetQueue({ payload, context, targets, queueId }) {
        const now = new Date().toISOString();
        const summary = buildTargetQueueSummary(targets);
        return {
            queueId,
            status: 'running',
            originalPayload: cloneJson(payload),
            context: {
                appConfig: context && context.appConfig ? cloneJson(context.appConfig) : undefined
            },
            targets: safeArray(targets),
            totalTargets: summary.totalTargets,
            totalExpectedPromptCount: summary.totalExpectedPromptCount,
            nextIndex: 0,
            currentIndex: 0,
            currentRunId: '',
            completedTargetIds: [],
            completedRunIds: [],
            failedRunIds: [],
            startedAt: now,
            updatedAt: now
        };
    }

    function attachTargetQueueProgress(store, run = null) {
        if (!run || !run.targetQueue || !run.targetQueue.queueId) return run;
        const queue = loadTargetQueue(store, run.targetQueue.queueId);
        if (!queue) return run;
        const summary = publicTargetQueue(queue);
        return {
            ...run,
            targetQueue: {
                ...summary,
                ...run.targetQueue,
                totalTargets: summary.totalTargets,
                completedTargets: summary.completedTargets,
                remainingTargets: summary.remainingTargets,
                totalExpectedPromptCount: summary.totalExpectedPromptCount,
                queueStatus: summary.status
            },
            targetQueueProgress: summary
        };
    }

    function updateTargetQueueFromRun(store, run = {}, status = '') {
        if (!run || !run.targetQueue || !run.targetQueue.queueId) return null;
        const queue = loadTargetQueue(store, run.targetQueue.queueId);
        if (!queue) return null;
        const targetIndex = Math.max(0, Number(run.targetQueue.index) ? Number(run.targetQueue.index) - 1 : Number(queue.currentIndex) || 0);
        const target = safeArray(queue.targets)[targetIndex] || {};
        const targetId = target.targetId || target.targetKey || target.sourceMaterialId || `target-${targetIndex + 1}`;
        const updates = {
            status: status || run.status || queue.status,
            currentIndex: targetIndex,
            currentRunId: run.runId || queue.currentRunId,
            lastRunId: run.runId || queue.lastRunId || '',
            lastRunStatus: run.status || '',
            lastRunPhase: run.phase || ''
        };
        if (status === 'completed') {
            updates.nextIndex = targetIndex + 1;
            updates.completedTargetIds = uniqueStrings(safeArray(queue.completedTargetIds).concat([targetId]));
            updates.completedRunIds = uniqueStrings(safeArray(queue.completedRunIds).concat([run.runId]));
        }
        if (status === 'failed') {
            updates.failedRunIds = uniqueStrings(safeArray(queue.failedRunIds).concat([run.runId]));
        }
        return updateTargetQueue(store, queue.queueId, updates);
    }

    function buildAggregateSelectedDirection(directions = [], payload = {}) {
        const selectedDirections = safeArray(directions).filter(Boolean);
        if (!selectedDirections.length) {
            throw new Error('没有可迭代的方向');
        }

        const target = payload.targetSelection || {};
        const explicitParts = String(target.path || target.label || '')
            .split('/')
            .map(part => part.trim())
            .filter(Boolean);
        const firstParts = directionPathParts(selectedDirections[0]);
        let commonParts = explicitParts;
        if (!commonParts.length) {
            commonParts = firstParts.filter((part, index) => selectedDirections.every(direction => directionPathParts(direction)[index] === part));
        }
        const pathLabel = commonParts.length ? commonParts.join('/') : `多方向聚合/${selectedDirections.length} 个方向`;
        const directionIds = selectedDirections.map(direction => direction.id);
        const referenceHints = uniqueStrings(selectedDirections.flatMap(direction => safeArray(direction.referenceHints))).slice(0, 20);
        const mustAvoid = uniqueStrings(selectedDirections.map(direction => direction.mustAvoid)).slice(0, 8).join('；');
        const descriptions = selectedDirections
            .map(direction => `${direction.path || direction.name || direction.id}：${direction.description || '无描述'}`)
            .slice(0, 20);
        const aggregateDirection = {
            id: buildAggregateDirectionId(commonParts, directionIds),
            path: pathLabel,
            name: target.label || commonParts[commonParts.length - 1] || '多方向聚合迭代',
            primaryTag: commonParts[0] || '',
            secondaryTag: commonParts[1] || '',
            tertiaryTag: commonParts[2] || '',
            subTag: commonParts.slice(3).join('/'),
            description: [
                `这是由 ${selectedDirections.length} 个方向聚合出来的迭代目标。`,
                '先归纳这些方向的共同题材、视觉机制、参考图线索和用户点击理由，再做更大的创意发散。',
                descriptions.join('；')
            ].filter(Boolean).join(' '),
            referenceHints,
            mustAvoid,
            autoRun: true,
            aggregate: true,
            aggregateLevel: target.level || '',
            aggregateType: target.type || (selectedDirections.length > 1 ? 'multi-direction' : 'direction'),
            memberDirectionIds: directionIds,
            memberDirectionPaths: selectedDirections.map(direction => direction.path || direction.name || direction.id).filter(Boolean)
        };

        return {
            direction: aggregateDirection,
            score: Math.max(...selectedDirections.map(direction => Number(direction.priority) || 0), 0),
            scoreParts: {},
            topMaterialInsight: null,
            reasons: [
                target.type === 'tag' ? `按标签聚合迭代：${pathLabel}` : `多选 ${selectedDirections.length} 个方向迭代`,
                '先总结共同点，再生成更大方向的发散方案'
            ],
            aggregateTarget: {
                type: aggregateDirection.aggregateType,
                level: aggregateDirection.aggregateLevel,
                path: pathLabel,
                directionCount: selectedDirections.length,
                directions: selectedDirections.map(direction => ({
                    id: direction.id,
                    path: direction.path || direction.name || direction.id,
                    description: direction.description || '',
                    referenceHints: safeArray(direction.referenceHints).slice(0, 5)
                }))
            }
        };
    }

    function resolveSelectedDirection(knowledge, payload = {}) {
        const requestedDirectionIds = uniqueStrings(payload.directionIds);
        if (requestedDirectionIds.length) {
            const directions = requestedDirectionIds.map(id => {
                const direction = knowledge.directions.find(item => item.id === id);
                if (!direction) {
                    throw new Error(`未找到指定方向: ${id}`);
                }
                if (!isRunnableDirection(direction)) {
                    throw new Error(`方向已归档或禁跑，不能自动运行: ${direction.path || direction.name || id}`);
                }
                return direction;
            });
            const target = payload.targetSelection || {};
            if (directions.length === 1 && target.type !== 'tag') {
                const scored = selectNextDirection(directions, knowledge.insights, {
                    limit: 1,
                    materialLearnings: knowledge.materialLearnings,
                    memoryRules: knowledge.memoryRules
                }).next;
                return scored || { direction: directions[0], score: 0, reasons: ['按请求指定方向运行'] };
            }
            return buildAggregateSelectedDirection(directions, payload);
        }

        const requestedDirectionId = String(payload.directionId || '').trim();
        if (requestedDirectionId) {
            const direction = knowledge.directions.find(item => item.id === requestedDirectionId);
            if (!direction) {
                throw new Error(`未找到指定方向: ${requestedDirectionId}`);
            }
            if (!isRunnableDirection(direction)) {
                throw new Error(`方向已归档或禁跑，不能自动运行: ${direction.path || direction.name || requestedDirectionId}`);
            }
            const scored = selectNextDirection([direction], knowledge.insights, {
                limit: 1,
                materialLearnings: knowledge.materialLearnings,
                memoryRules: knowledge.memoryRules
            }).next;
            return scored || { direction, score: 0, reasons: ['按请求指定方向运行'] };
        }

        const creativeBrief = creativeBriefFromPayload(payload);
        const briefSelected = buildCreativeBriefSelectedDirection(creativeBrief, knowledge.directions);
        if (briefSelected) {
            return briefSelected;
        }

        const selected = selectNextDirection(knowledge.directions, knowledge.insights, {
            limit: 10,
            materialLearnings: knowledge.materialLearnings,
            memoryRules: knowledge.memoryRules
        }).next;
        if (!selected) {
            throw new Error('没有可自动运行的创意方向');
        }
        return selected;
    }

    function getMatchedReferenceImages(direction, knowledge) {
        const directionIds = safeArray(direction.memberDirectionIds).length
            ? safeArray(direction.memberDirectionIds)
            : [direction.id];
        return safeArray(knowledge.referenceImages)
            .filter(image => safeArray(image.matchedDirectionIds).some(id => directionIds.includes(id)) || directionIds.includes(image.directionId))
            .slice(0, 10)
            .map(image => ({
                id: image.id,
                fileName: image.fileName,
                relativePath: image.relativePath,
                filePath: image.filePath
            }));
    }

    function formatActiveMemoryRules(memoryRules = [], limit = 12) {
        const rules = safeArray(memoryRules)
            .filter(rule => rule && rule.status === 'active' && rule.enabled !== false)
            .slice(0, limit);
        if (!rules.length) {
            return '暂无已启用的反馈学习规则。';
        }

        return rules.map((rule, index) => [
            `${index + 1}. [${rule.scope || 'global'} / ${rule.type || 'preferred'}${rule.target ? ` / ${rule.target}` : ''}] ${rule.title || '未命名规则'}`,
            `   规则：${rule.pattern || ''}`,
            rule.action ? `   应用方式：${rule.action}` : '',
            rule.rationale ? `   来源理解：${rule.rationale}` : ''
        ].filter(Boolean).join('\n')).join('\n');
    }

    function formatHistoricalCreativeContext(history = null) {
        const freshnessNonce = `${Date.now()}-${crypto.randomBytes(2).toString('hex')}`;
        if (!history || (!history.directionNames.length && !history.promptSnippets.length)) {
            return [
                '# Historical uniqueness guard',
                `Fresh generation nonce: ${freshnessNonce}. Do not return cached output; generate new directions and prompts for this run.`,
                'No prior new directions or generated prompts were found for this source direction. Still create fresh directions and avoid generic template repetition.'
            ].join('\n');
        }

        return [
            '# Historical uniqueness guard',
            `Fresh generation nonce: ${freshnessNonce}. Do not return cached output; generate new directions and prompts for this run.`,
            'The following items have already been expanded or generated for this source direction. This run must create brand-new newDirectionName values and brand-new prompts.',
            'Do not reuse these names, do not make near-paraphrases, and do not keep the same subject-action-scene mechanism with only small wording changes.',
            `Historical prompt keys: ${history.promptHistoryCount}; historical direction keys: ${history.directionHistoryCount}.`,
            history.directionNames.length
                ? [
                    'Already-used newDirectionName values:',
                    ...history.directionNames.map((name, index) => `${index + 1}. ${name}`)
                ].join('\n')
                : '',
            history.promptSnippets.length
                ? [
                    'Already-used prompt examples to avoid:',
                    ...history.promptSnippets.map((item, index) => `${index + 1}. ${item.newDirectionName ? `${item.newDirectionName}: ` : ''}${item.prompt}`)
                ].join('\n')
                : ''
        ].filter(Boolean).join('\n');
    }

    function formatDirectionFocusContext(selected = {}) {
        const direction = selected.direction || {};
        const systemContext = selected.directionSystemContext || {};
        const siblings = safeArray(systemContext.siblings)
            .concat(safeArray(selected.siblings))
            .concat(safeArray(direction.siblings))
            .concat(safeArray(direction.peerDirections))
            .slice(0, 16);
        const treeSummary = systemContext.directionTreeSummary || selected.directionTreeSummary || direction.treeSummary || '';
        const dimensionCoverage = systemContext.dimensionCoverage || selected.dimensionCoverage || direction.dimensionCoverage || {};
        const exclusionContext = systemContext.exclusionContext || selected.exclusionContext || {};
        const coverageLines = Object.entries(dimensionCoverage)
            .slice(0, 12)
            .map(([key, value]) => {
                if (!value || typeof value !== 'object') {
                    return `${key}：${value}`;
                }
                const label = value.label || key;
                const observed = safeArray(value.observed)
                    .map(item => `${item.value}(${item.count})`)
                    .join('、') || '暂无';
                const gaps = safeArray(value.gaps).join('、') || '暂无';
                return `${label}：已覆盖 ${observed}；优先补齐 ${gaps}`;
            });
        const existingDirectionNames = safeArray(exclusionContext.existingDirectionNames).slice(0, 30);
        const historicalDirectionNames = safeArray(exclusionContext.historicalDirectionNames).slice(0, 30);
        const historicalPromptHashes = safeArray(exclusionContext.historicalPromptHashes).slice(0, 30);
        const rejectedDirections = safeArray(exclusionContext.rejectedDirections).slice(0, 12);

        return [
            '# 方向树与同级样本校准',
            systemContext.selectedNode ? `当前节点：${systemContext.selectedNode}` : '',
            systemContext.targetLevel ? `目标拓展层级：${systemContext.targetLevel}` : '',
            treeSummary
                ? `方向树摘要：\n${treeSummary}`
                : '当前调用层没有提供完整方向树摘要；请以“方向路径 / 标签 / 方向简述 / 历史去重列表”为粒度锚点，不要越级发散。',
            siblings.length
                ? [
                    '同级样本（用于校准命名粒度和画面具体程度）：',
                    ...siblings.map((item, index) => {
                        const label = item.name || item.label || item.path || item.direction || '';
                        const description = item.description || item.summary || item.directionDescription || '';
                        const dimensions = item.dimensions
                            ? Object.entries(item.dimensions)
                                .filter(([, values]) => safeArray(values).length)
                                .map(([key, values]) => `${key}=${safeArray(values).join('/')}`)
                                .join('；')
                            : '';
                        return `${index + 1}. ${[label, description].filter(Boolean).join('：')}${dimensions ? `（${dimensions}）` : ''}`;
                    }).filter(Boolean)
                ].join('\n')
                : '未提供同级样本；新方向名称必须具体到可直接想象画面母题，禁止写成抽象 L2/L3 概念。',
            coverageLines.length
                ? ['八维覆盖缺口（优先填补 false/低覆盖组合）：', ...coverageLines].join('\n')
                : '八维发散必须覆盖：氛围、视角、时间天气、叙事动作、规模、材质质感、主体关系、广告钩子。',
            [
                '# 排除上下文',
                existingDirectionNames.length ? `已有同级/子级方向名，禁止近似复用：${existingDirectionNames.join('、')}` : '',
                historicalDirectionNames.length ? `历史已生成新方向名，禁止复用：${historicalDirectionNames.join('、')}` : '',
                historicalPromptHashes.length ? `历史 prompt hash，输出时避免相同 prompt 机制：${historicalPromptHashes.join('、')}` : '',
                rejectedDirections.length
                    ? [
                        '近期被 Prompt Gate 拒绝的方向/prompt，避免重复原因：',
                        ...rejectedDirections.map((item, index) => `${index + 1}. ${item.direction || item.promptTitle || '未命名'}：${[item.reason, item.message].filter(Boolean).join(' / ')}`)
                    ].join('\n')
                    : ''
            ].filter(Boolean).join('\n')
        ].filter(Boolean).join('\n');
    }

    function buildAgentInstruction({ selected, referenceImages, payload, config, quota, memoryRules = [], historicalCreativeContext = null }) {
        const direction = selected.direction;
        const insight = selected.topMaterialInsight || null;
        const aggregateTarget = selected.aggregateTarget || null;
        const creativeBrief = creativeBriefFromPayload(payload);
        const creativeBriefTargets = creativeBrief && Array.isArray(creativeBrief.creativeTargets)
            ? creativeBrief.creativeTargets
            : [];
        const expansionTargets = creativeBriefTargets.map(target => {
            const newDirectionsPerSource = Math.max(1, Math.min(10, Math.floor(Number(target.newDirectionsPerSource) || 3)));
            const promptGroupsPerNewDirection = Math.max(1, Math.min(10, Math.floor(Number(target.promptGroupsPerNewDirection) || 4)));
            return {
                ...target,
                newDirectionsPerSource,
                promptGroupsPerNewDirection,
                expectedPromptCount: newDirectionsPerSource * promptGroupsPerNewDirection
            };
        });
        const totalNewDirectionCount = expansionTargets.reduce((sum, target) => sum + target.newDirectionsPerSource, 0);
        const totalExpectedPromptCount = expansionTargets.reduce((sum, target) => sum + target.expectedPromptCount, 0);
        const promptColumnCount = Math.max(5, ...expansionTargets.map(target => target.promptGroupsPerNewDirection));
        const promptHeaders = Array.from({ length: promptColumnCount }, (_, index) => `提示词${index + 1}`);
        const creativeBriefTargetText = creativeBriefTargets.length
            ? expansionTargets.map((target, index) => [
                `${index + 1}. 原始方向：${target.sourceDirectionPath || target.sourceDirectionKey || target.materialName || target.targetId || ''}`,
                `   任务：${target.task || `输出 ${target.newDirectionsPerSource || 3} 个新方向，每个新方向 ${target.promptGroupsPerNewDirection || 4} 组 Legil 提示词`}`,
                `   数量约束：新方向 ${target.newDirectionsPerSource} 个；每个新方向 ${target.promptGroupsPerNewDirection} 条 prompt；本原始方向合计 ${target.expectedPromptCount} 条 prompt`,
                `   视觉洞察：${target.visualSummary || target.visualInsight || ''}`,
                Array.isArray(target.retainElements) && target.retainElements.length ? `   必须保留：${target.retainElements.join('、')}` : '',
                Array.isArray(target.variationAxes) && target.variationAxes.length ? `   变化轴：${target.variationAxes.join('、')}` : '',
                Array.isArray(target.avoidRules) && target.avoidRules.length ? `   避坑规则：${target.avoidRules.join('、')}` : '',
                Array.isArray(target.seedMaterials) && target.seedMaterials.length
                    ? `   参考素材：${target.seedMaterials.slice(0, 5).map(seed => [
                        seed.materialName || seed.materialId || '',
                        seed.visionSummary || seed.hook || seed.suggestedDirection || ''
                    ].filter(Boolean).join('：')).filter(Boolean).join('；')}`
                    : ''
            ].filter(Boolean).join('\n')).join('\n\n')
            : '';
        const aggregateDirections = aggregateTarget && Array.isArray(aggregateTarget.directions)
            ? aggregateTarget.directions
            : [];
        const directionMustAvoid = String(direction.mustAvoid || '').trim();
        const constraints = safeArray(payload.constraints)
            .concat(safeArray(payload.mustAvoid))
            .concat(safeArray(payload.forbiddenRules))
            .concat(directionMustAvoid ? [directionMustAvoid] : [])
            .map(item => String(item || '').trim())
            .filter(Boolean);
        const lines = [
            creativeBrief
                ? [
                    '# 素材分析 brief',
                    '下面的 brief 来自素材分析页，是本轮创意拓展的优先输入；请保留有效视觉机制，沿变化轴扩展，并显式避开风险规则。',
                    `项目：${creativeBrief.projectName || ''} / ${creativeBrief.weekId || ''}`,
                    creativeBrief.packageType ? `任务包类型：${creativeBrief.packageType}` : '',
                    `目标：${creativeBrief.target || ''}`,
                    `素材/方向：${creativeBrief.materialName || creativeBrief.directionPath || creativeBrief.directionKey || ''}`,
                    `方向路径：${creativeBrief.directionPath || creativeBrief.directionKey || ''}`,
                    `视觉洞察：${creativeBrief.visualInsight || ''}`,
                    Array.isArray(creativeBrief.retainElements) && creativeBrief.retainElements.length
                        ? `必须保留：${creativeBrief.retainElements.join('、')}`
                        : '',
                    Array.isArray(creativeBrief.variationAxes) && creativeBrief.variationAxes.length
                        ? `变化轴：${creativeBrief.variationAxes.join('、')}`
                        : '',
                    Array.isArray(creativeBrief.avoidRules) && creativeBrief.avoidRules.length
                        ? `避坑规则：${creativeBrief.avoidRules.join('、')}`
                        : '',
                    creativeBrief.request ? `请求：${creativeBrief.request}` : '',
                    creativeBriefTargetText ? `\n# creativeTargets（必须逐条执行）\n${creativeBriefTargetText}` : '',
                    ''
                ].filter(Boolean).join('\n')
                : '',
            '# 运行一次自动创意',
            '',
            '你正在为项目后台执行 creative-auto run-once 的 Agent-only 阶段。',
            '本次只需要生成新方向和 prompt，不要调用 Legil，不要输出长篇策划文章。',
            '',
            '# 当前必须拓展的原始方向',
            `方向 ID：${direction.id}`,
            `方向路径：${direction.path}`,
            `方向名称：${direction.name || ''}`,
            `方向简述：${direction.description || ''}`,
            direction.mustKeep ? `必须保留：${direction.mustKeep}` : '',
            direction.mustAvoid ? `必须避开：${direction.mustAvoid}` : '',
            `标签：${[direction.primaryTag, direction.secondaryTag, direction.tertiaryTag, direction.subTag].filter(Boolean).join(' / ')}`,
            '',
            '# 自动选题依据',
            `方向评分：${selected.score}`,
            `选择原因：${safeArray(selected.reasons).join('；') || '默认自动选题'}`,
            '',
            formatHistoricalCreativeContext(historicalCreativeContext),
            '',
            formatDirectionFocusContext(selected),
            aggregateTarget
                ? [
                    '',
                    '# 聚合迭代要求',
                    `本次目标类型：${aggregateTarget.type || 'multi-direction'}`,
                    `聚合层级：${aggregateTarget.level || '未指定'}`,
                    `聚合路径：${aggregateTarget.path || direction.path}`,
                    `覆盖细分方向数：${aggregateTarget.directionCount || aggregateDirections.length}`,
                    '请先归纳这些方向的共同点，包括题材母题、角色关系、关键道具、画面机制、参考图中的视觉线索、商业广告点击点和必须避开的误区。',
                    '再在共同点之上做更大方向的创意发散，不要被单个细分方向锁死，也不要只是改名或替换场景名词。',
                    '输出的新方向应能继续向下拆出多个细分方向，而不是只服务于某一张参考图。',
                    aggregateDirections.length
                        ? aggregateDirections.slice(0, 20).map((item, index) => `${index + 1}. ${item.path}：${item.description || '无描述'}`).join('\n')
                        : ''
                ].filter(Boolean).join('\n')
                : '',
            '',
            '# 已确认反馈学习规则',
            '下面这些规则来自人工审核反馈，已经人工确认启用；请在本轮方向拓展中显式遵守。',
            formatActiveMemoryRules(memoryRules),
            '',
            '# TOP 素材信号',
            insight
                ? [
                    `匹配路径：${insight.pathKey || ''}`,
                    `匹配素材数：${insight.materialCount || 0}`,
                    `平均 CTR：${insight.avgCtr ?? ''}`,
                    `平均 D7 ROI：${insight.avgD7IapRoi ?? ''}`,
                    `高表现素材名：${safeArray(insight.topNames).slice(0, 5).join('；')}`,
                    `关键词：${safeArray(insight.keywords).slice(0, 12).join('、')}`
                ].join('\n')
                : '当前方向没有明显 TOP 素材匹配，请按方向简述和项目世界观拓展。',
            '',
            '# 参考图线索',
            direction.referenceHints && direction.referenceHints.length
                ? `方向表参考图字段：${direction.referenceHints.join('；')}`
                : '方向表没有明确参考图字段。',
            referenceImages.length
                ? referenceImages.map((image, index) => `参考图${index + 1}：${image.relativePath || image.fileName}`).join('\n')
                : '参考图目录中没有自动匹配到该方向的图片；不要假装看过图，只能基于方向文字和 TOP 素材信号拓展。',
            '',
            '# 当前 Legil 生图参数',
            `模型：${config.generationSettings.imageModel} / Nano Banana 2`,
            `比例：${config.generationSettings.aspectRatio}`,
            `分辨率：${config.generationSettings.resolution}`,
            `每条 prompt 出图：${config.generationSettings.outputQuantity} 张`,
            quota.unlimitedPrompts
                ? '本次提交 prompt：不限额，Prompt Gate 接受多少就提交多少。'
                : `本次最多提交 prompt：${quota.maxPrompts}`,
            '',
            '# 禁用与避坑规则',
            constraints.length
                ? constraints.map(item => `- ${item}`).join('\n')
                : [
                    '- 不要默认加入赛博、高科技 UI、悬浮设备、机甲、激光界面。',
                    '- 不要使用真实品牌或大面积英文。',
                    '- 不要只换场景名词，必须改变主体关系、动作机制、镜头或广告卖点。',
                    '- 如果画面有文字，文字必须短、醒目、可读。'
                ].join('\n'),
            '',
            '# 输出要求',
            '只输出 JSON，不输出 Markdown 表格、Excel 表格、CSV 表格或任何 spreadsheet-ready 表格；JSON 顶层字段为 candidateDirections。',
            `每个 candidateDirections item 的 prompts 最多 ${promptHeaders.length} 条，按本次目标数量生成，不要为了补齐数量写无效提示词。`,
            'candidateDirections 每一项必须包含 type、sourcePath、targetLevel、label、description、dimensions、duplicateRisk、reason、prompts。dimensions 必须包含 mood、perspective、time、narrative、scale、material、subjectRelation、hook。prompts 为 1-5 个 {title,prompt} 对象。',
            expansionTargets.length
                ? `本次必须逐个执行 creativeTargets：总计 ${expansionTargets.length} 个原始方向、${totalNewDirectionCount} 个新方向、${totalExpectedPromptCount} 条 prompt。每个原始方向的行数和 prompt 数必须严格按该 target 的“数量约束”执行。`
                : '默认输出 3 个新方向，每个新方向 4 条 prompt，共 12 条 prompt。',
            '新方向之间的差异要明显拉开，但不能脱离当前《无尽冬日》冰封末世、3D 卡通广告图、买量素材体系。至少在场景机制、人物关系、危机/奖励道具、镜头距离/角度中改变两项，禁止只改同义词或轻微换景。',
            '即使原始方向是“物品展示/静物展示”，每个新方向也必须至少绑定一个动态关系或行动机制，例如发现、争夺、护送、抢救、交换、撤离、守护或倒计时选择；不要只写物品静置特写。',
            '同一新方向下的不同 prompt 也要有更大的画面差异：每条 prompt 必须使用不同的动作节点、镜头景别、前景道具、空间位置或情绪冲突，同时保留该新方向的核心卖点和可读广告点击点。',
            '所有变化必须仍符合当前体系：冰雪末世求生、明确危险或奖励关系、主体动作清楚、商业级 3D 卡通游戏广告风格，不要漂移到无关题材、写实品牌、纯风景或无法转化的抽象画面。',
            expansionTargets.length
                ? '不要把一个原始方向改写成另一个方向；每一行“参考方向”必须填写对应 target 的原始方向路径。某个 target 只要求 3 条 prompt 时，不要为了填满表头硬补无效提示词。'
                : '',
            '每条 prompt 必须是中文完整长提示词，可直接给 Legil 生成 1:1 方图。'
        ];

        lines.push(
            '',
            '# Current Automation Contract',
            'Output JSON only for this run. Do not output Markdown tables, Excel tables, CSV tables, or spreadsheet-ready tables.',
            'The JSON top-level object must contain candidateDirections.',
            'Each candidateDirections item must contain: type, sourcePath, targetLevel, label, description, dimensions, duplicateRisk, reason, prompts.',
            'dimensions must include mood, perspective, time, narrative, scale, material, subjectRelation, hook.',
            'prompts must be 1-5 objects, each with title and prompt. The prompt field must be the complete final image-generation prompt.'
        );

        return lines.join('\n');
    }

    function buildQuota(context = {}, schedulerState = {}) {
        const daily = schedulerState.daily || {};
        const usedImagesToday = daily.date === todayKey() ? Number(daily.imageCount) || 0 : 0;
        const maxImagesPerDay = null;
        const remainingImagesToday = UNLIMITED_PROMPT_LIMIT;
        const outputQuantity = Number(context.outputQuantity) || DEFAULT_AUTO_CONFIG.outputQuantity;
        const unlimitedPrompts = context.unlimitedPrompts === true;
        const requestedMaxPrompts = Number(context.maxPrompts);
        const maxPrompts = unlimitedPrompts
            ? UNLIMITED_PROMPT_LIMIT
            : Math.max(0, Math.min(
                DEFAULT_AUTO_CONFIG.maxPromptsPerRun,
                Number.isFinite(requestedMaxPrompts) && requestedMaxPrompts > 0 ? Math.floor(requestedMaxPrompts) : DEFAULT_AUTO_CONFIG.maxPromptsPerRun
            ));

        return {
            date: todayKey(),
            usedImagesToday,
            maxImagesPerDay,
            remainingImagesToday,
            unlimitedImages: true,
            unlimitedPrompts,
            outputQuantity,
            maxPrompts,
            expectedImages: unlimitedPrompts ? null : maxPrompts * outputQuantity
        };
    }

    function updateDirectionPromptStats(store, directionId, updates = {}) {
        const data = store.read('directions.json', null);
        if (!data || !Array.isArray(data.directions)) {
            return;
        }

        let changed = false;
        const directions = data.directions.map(direction => {
            if (direction.id !== directionId) {
                return direction;
            }

            changed = true;
            const stats = direction.stats || {};
            return {
                ...direction,
                stats: {
                    ...stats,
                    expandedCount: Math.max(0, Number(stats.expandedCount) || 0) + (Number(updates.expandedCountDelta) || 0),
                    promptCount: Math.max(0, Number(stats.promptCount) || 0) + (Number(updates.promptCountDelta) || 0),
                    imageCount: Math.max(0, Number(stats.imageCount) || 0) + (Number(updates.imageCountDelta) || 0),
                    lastRunAt: updates.lastRunAt || stats.lastRunAt || null,
                    failureCount: Math.max(0, Number(stats.failureCount) || 0) + (Number(updates.failureCountDelta) || 0)
                }
            };
        });

        if (changed) {
            store.write('directions.json', {
                ...data,
                directions,
                updatedAt: new Date().toISOString()
            });
        }
    }

    function updateSelectedDirectionPromptStats(store, selected, updates = {}) {
        const direction = selected && selected.direction ? selected.direction : {};
        const ids = safeArray(direction.memberDirectionIds).length
            ? safeArray(direction.memberDirectionIds)
            : [direction.id];
        uniqueStrings(ids).forEach(id => updateDirectionPromptStats(store, id, updates));
    }

    function buildLegilPayload({ run, prompts, config, extra = {} }) {
        const legilTaskId = extra.legilTaskId
            || (run.legilTask && run.legilTask.taskId)
            || buildLegilTaskId(run, prompts);
        return {
            legilTaskId,
            outputFolder: config.outputFolder,
            referenceFolder: config.referenceFolder,
            browserMode: normalizeAutoBrowserMode(config.browserMode),
            generationSettings: {
                ...DEFAULT_AUTO_CONFIG.generationSettings,
                ...(config.generationSettings || {})
            },
            prompts,
            tableFileName: run.agentOutput && run.agentOutput.fileName
                ? run.agentOutput.fileName
                : `${run.runId}_prompts`,
            creativeAutoRunId: run.runId,
            suppressLegilNotification: true,
            ...extra
        };
    }

    function bypassPromptTranslationForLegil({ prompts, selected, runId = '' }) {
        const sourcePrompts = safeArray(prompts);
        const translatedAt = new Date().toISOString();
        const directionDefinitions = buildDirectionDefinitions(sourcePrompts, selected);
        const translatedPrompts = sourcePrompts.map((item, index) => {
            const prompt = String(item && (item.finalPrompt || item.prompt) || '').replace(/\s+/g, ' ').trim();
            const sourcePromptHash = item && item.sourcePromptHash || hashText(prompt);
            return {
                ...(item || {}),
                index: Number(item && item.index) || index + 1,
                prompt,
                finalPrompt: prompt,
                sourcePromptHash,
                promptSchemaVersion: PROMPT_SCHEMA_VERSION,
                translationVersion: TRANSLATION_VERSION,
                translatedAt,
                rewriteCount: 0,
                selfCheck: {
                    success: true,
                    issues: [],
                    warnings: []
                }
            };
        }).filter(item => item.prompt);

        return {
            prompts: translatedPrompts,
            directionDefinitions,
            report: {
                runId,
                version: TRANSLATION_VERSION,
                promptSchemaVersion: PROMPT_SCHEMA_VERSION,
                translatedAt,
                sourcePromptCount: sourcePrompts.length,
                promptCount: translatedPrompts.length,
                directionDefinitionCount: directionDefinitions.length,
                agentName: TRANSLATION_AGENT_NAME,
                agentRequestPromptCount: 0,
                agentResponsePromptCount: 0,
                agentSkipped: true,
                agentSkipReason: 'Creative Agent already returned final Legil prompts; translator LLM bypassed',
                fallbackUsed: false,
                fallbackReason: '',
                requiredFields: [],
                forbiddenTerms: [],
                selfCheckPassed: translatedPrompts.length,
                selfCheckFailed: 0,
                rewritten: 0,
                success: translatedPrompts.length > 0,
                prompts: translatedPrompts.map(item => ({
                    index: item.index,
                    promptTitle: item.promptTitle,
                    sourceDirectionId: item.sourceDirectionId,
                    sourceDirectionPath: item.sourceDirectionPath,
                    newDirectionName: item.newDirectionName,
                    sourcePromptHash: item.sourcePromptHash,
                    finalPromptHash: hashText(item.finalPrompt),
                    rewriteCount: item.rewriteCount,
                    selfCheck: item.selfCheck
                }))
            }
        };
    }

    function buildLegilTaskId(run = {}, prompts = []) {
        return `legil_task_${hashText([
            run.runId || '',
            safeArray(prompts).map(item => item && (item.promptHash || item.index || item.promptTitle || '')).join(','),
            run.createdAt || ''
        ].join('|'))}`;
    }

    function compactLegilTaskPrompt(item = {}, index = 0) {
        return {
            index: Number(item.index) || index + 1,
            originalIndex: item.originalIndex || '',
            promptHash: item.promptHash || '',
            promptTitle: item.promptTitle || '',
            direction: item.direction || '',
            newDirectionName: item.newDirectionName || item.direction || '',
            sourceDirectionId: item.sourceDirectionId || '',
            sourceDirectionPath: item.sourceDirectionPath || '',
            translationVersion: item.translationVersion || '',
            promptSchemaVersion: item.promptSchemaVersion || ''
        };
    }

    function publicLegilTaskPrompt(item = {}, index = 0) {
        const prompt = compactLegilTaskPrompt(item, index);
        return {
            ...prompt,
            hasPrompt: Boolean(item.finalPrompt || item.prompt)
        };
    }

    function buildLegilTask({ run = {}, payload = {}, prompts = [], status = 'queued', phase = 'queued', startResponse = null, snapshot = null, progress = null, existing = {} }) {
        const now = new Date().toISOString();
        const generationSettings = payload.generationSettings || (run.config && run.config.generationSettings) || {};
        const outputQuantity = Math.max(1, Number(generationSettings.outputQuantity) || DEFAULT_AUTO_CONFIG.outputQuantity);
        const promptItems = safeArray(prompts).length ? safeArray(prompts) : safeArray(run.prompts);
        const taskId = payload.legilTaskId || existing.taskId || buildLegilTaskId(run, promptItems);
        const promptCount = Number(payload.totalPrompts) || promptItems.length || Number(existing.promptCount) || 0;
        const outputTotal = Number(payload.outputTotal)
            || Number(startResponse && startResponse.outputTotal)
            || Number(progress && progress.outputTotal)
            || promptCount * outputQuantity;
        return {
            taskId,
            runId: run.runId || payload.creativeAutoRunId || existing.runId || '',
            taskType: 'creative-batch',
            source: 'creative-auto',
            status,
            phase,
            browserMode: normalizeAutoBrowserMode(payload.browserMode || existing.browserMode || (run.config && run.config.browserMode)),
            outputFolder: payload.outputFolder || existing.outputFolder || (run.config && run.config.outputFolder) || '',
            referenceFolder: payload.referenceFolder || existing.referenceFolder || (run.config && run.config.referenceFolder) || '',
            generationSettings: {
                ...DEFAULT_AUTO_CONFIG.generationSettings,
                ...(generationSettings || existing.generationSettings || {})
            },
            promptCount,
            outputQuantity,
            outputTotal,
            promptHashes: uniqueStrings(promptItems.map(item => item && item.promptHash)),
            prompts: promptItems.map(publicLegilTaskPrompt),
            submittedPromptSource: 'prompt-gate-accepted',
            selectedPromptCount: promptItems.filter(item => !item || item.selected !== false).length,
            progress: progress || existing.progress || null,
            startResponse: startResponse || existing.startResponse || null,
            lastSnapshot: snapshot || existing.lastSnapshot || null,
            createdAt: existing.createdAt || now,
            queuedAt: existing.queuedAt || now,
            startedAt: existing.startedAt || (status === 'running' ? now : ''),
            updatedAt: now,
            completedAt: ['completed', 'paused', 'failed'].includes(status) ? now : (existing.completedAt || ''),
            canPause: status === 'queued' || status === 'running',
            canResume: status === 'paused'
        };
    }

    function updateLegilTaskState(task = {}, updates = {}) {
        const status = updates.status || task.status || 'queued';
        const phase = updates.phase || task.phase || '';
        const now = new Date().toISOString();
        return {
            ...task,
            ...updates,
            status,
            phase,
            progress: updates.progress !== undefined ? updates.progress : task.progress || null,
            startResponse: updates.startResponse !== undefined ? updates.startResponse : task.startResponse || null,
            lastSnapshot: updates.lastSnapshot !== undefined ? updates.lastSnapshot : task.lastSnapshot || null,
            updatedAt: now,
            completedAt: ['completed', 'paused', 'failed'].includes(status) ? (updates.completedAt || task.completedAt || now) : (updates.completedAt || task.completedAt || ''),
            canPause: status === 'queued' || status === 'running',
            canResume: status === 'paused'
        };
    }

    function buildSelectedFromRun(run = {}) {
        return {
            direction: run.sourceDirection || {},
            score: run.selection && run.selection.score ? run.selection.score : 0,
            scoreParts: run.selection && run.selection.scoreParts ? run.selection.scoreParts : {},
            topMaterialInsight: run.selection && run.selection.topMaterialInsight ? run.selection.topMaterialInsight : null,
            reasons: run.selection && run.selection.reasons ? run.selection.reasons : [],
            directionSystemContext: run.directionSystemContext || null,
            siblings: run.directionSystemContext && run.directionSystemContext.siblings ? run.directionSystemContext.siblings : [],
            dimensionCoverage: run.directionSystemContext && run.directionSystemContext.dimensionCoverage ? run.directionSystemContext.dimensionCoverage : {},
            exclusionContext: run.directionSystemContext && run.directionSystemContext.exclusionContext ? run.directionSystemContext.exclusionContext : {},
            directionTreeSummary: run.directionSystemContext && run.directionSystemContext.directionTreeSummary ? run.directionSystemContext.directionTreeSummary : ''
        };
    }

    async function startLegilCreativeBatch(payload) {
        if (typeof options.startLegilCreativeBatch === 'function') {
            return await options.startLegilCreativeBatch(payload);
        }

        const client = options.axios || axios;
        const port = Number(options.PORT) || 3066;
        const response = await client.post(`http://127.0.0.1:${port}/api/legil/creative-batch`, payload, {
            timeout: 30000
        });
        return response && response.data ? response.data : response;
    }

    async function getLegilCreativeProgress() {
        if (typeof options.getLegilCreativeProgress === 'function') {
            return await options.getLegilCreativeProgress();
        }

        const client = options.axios || axios;
        const port = Number(options.PORT) || 3066;
        const response = await client.get(`http://127.0.0.1:${port}/api/legil/creative-progress`, {
            timeout: 30000
        });
        return response && response.data ? response.data : response;
    }

    function getLegilCreativeProgressSnapshot() {
        if (typeof options.getCreativeProgressSnapshot === 'function') {
            return options.getCreativeProgressSnapshot();
        }
        return null;
    }

    function buildDailyAfterLegil(schedulerState, savedCount) {
        const currentDaily = schedulerState && schedulerState.daily ? schedulerState.daily : {};
        const imageLimit = Number(currentDaily.imageLimit) || DEFAULT_AUTO_CONFIG.maxImagesPerDay;
        const currentCount = currentDaily.date === todayKey() ? Number(currentDaily.imageCount) || 0 : 0;
        return {
            date: todayKey(),
            imageCount: Math.max(0, currentCount + (Number(savedCount) || 0)),
            imageLimit
        };
    }

    function notifyCreativeAutoEvent(payload, notifyOptions = {}) {
        if (typeof options.notifyTaskEvent !== 'function') {
            return;
        }

        options.notifyTaskEvent(payload, notifyOptions);
    }

    function notifyCreativeAutoBlocked({ title, message, level = 'warning', category = 'abnormal', extraLines = [], keySuffix = '' }) {
        notifyCreativeAutoEvent({
            level,
            title,
            taskType: '运行一次自动创意',
            message,
            suggestion: '请在网页控制台处理后重新点击“运行一次自动创意”。',
            extraLines
        }, {
            key: `creative-auto-blocked:${keySuffix || title}:${message || ''}`,
            category,
            cooldownMs: level === 'warning' ? 0 : undefined
        });
    }

    function notifyCreativeAutoRunFinal(run, eventType) {
        if (!run) {
            return;
        }

        const result = run.legilResult || {};
        const report = run.promptQualityReport || {};
        const assets = run.assets || {};
        const directionPath = run.sourceDirection && run.sourceDirection.path ? run.sourceDirection.path : '';
        const savedCount = Number(result.savedCount) || Number(assets.newAssetCount) || 0;
        const acceptedCount = Number(report.acceptedPromptCount) || Number(run.promptTotal) || 0;
        const rejectedCount = Number(report.rejectedPromptCount) || Number(run.promptTotalRejected) || 0;
        const failedCount = Number(result.failedCount) || 0;
        const isCompleted = eventType === 'completed';
        const isPaused = eventType === 'paused';
        const promptGateEmpty = isCompleted && acceptedCount <= 0 && rejectedCount > 0;
        const title = promptGateEmpty
            ? '运行一次自动创意未进入生图'
            : (isCompleted
                ? '运行一次自动创意已完成'
                : (isPaused ? '运行一次自动创意已暂停' : '运行一次自动创意异常'));
        const level = promptGateEmpty ? 'warning' : (isCompleted ? 'info' : (isPaused ? 'warning' : 'error'));
        const progress = `prompt ${acceptedCount}/${Number(run.promptTotalRaw) || acceptedCount}，拒绝 ${rejectedCount}，失败 ${failedCount}，保存 ${savedCount}`;
        const extraLines = [
            `runId：${run.runId}`,
            directionPath ? `方向：${directionPath}` : '',
            run.config && run.config.outputFolder ? `输出目录：${run.config.outputFolder}` : '',
            assets.newAssetCount !== undefined ? `资产登记：新增 ${assets.newAssetCount || 0}，匹配 ${assets.matchedFileCount || 0}` : ''
        ].filter(Boolean);

        notifyCreativeAutoEvent({
            level,
            title,
            taskType: '运行一次自动创意',
            progress,
            message: run.message || result.message || '',
            suggestion: promptGateEmpty
                ? 'Prompt Gate 没有接受任何 prompt，请检查禁用词、素材避坑规则和提示词质量后重试。'
                : (isCompleted ? '' : '请检查 Agent 配置、Legil 登录态、输出目录和页面状态后重试。'),
            extraLines
        }, {
            key: `creative-auto-final:${run.runId}:${eventType}`,
            category: promptGateEmpty ? 'abnormal' : (isCompleted ? 'completion' : 'abnormal'),
            cooldownMs: isPaused ? 0 : undefined
        });
    }

    async function pollLegilUntilFinal({ store, run, selected, startResponse }) {
        const pollMs = Math.max(500, Number(options.legilProgressPollMs) || 3000);
        const configuredMaxWaitMs = Number(options.legilProgressMaxWaitMs);
        const maxWaitMs = Math.max(
            pollMs,
            Number.isFinite(configuredMaxWaitMs) && configuredMaxWaitMs > 0
                ? configuredMaxWaitMs
                : Math.max(DEFAULT_LEGIL_MIN_WAIT_MS, (run.promptTotal || 1) * DEFAULT_LEGIL_PER_PROMPT_WAIT_MS)
        );
        const startedAt = Date.now();
        let lastSnapshot = null;
        let consecutiveProgressPollErrors = 0;

        while (Date.now() - startedAt < maxWaitMs) {
            let snapshot = null;
            try {
                snapshot = await getLegilCreativeProgress();
                consecutiveProgressPollErrors = 0;
            } catch (error) {
                const errorText = String(error && error.message ? error.message : error || '');
                const transient = /(ECONNRESET|ETIMEDOUT|ESOCKETTIMEDOUT|ECONNABORTED|socket hang up|network|timeout)/i.test(errorText);
                consecutiveProgressPollErrors += 1;
                if (transient && consecutiveProgressPollErrors <= 5) {
                    if (logger && typeof logger.warn === 'function') {
                        logger.warn(`Legil progress poll transient error ${consecutiveProgressPollErrors}/5: ${errorText}`);
                    }
                    await sleep(Math.min(Math.max(pollMs, 1000) * 2, 10000));
                    continue;
                }
                throw error;
            }
            lastSnapshot = snapshot;
            const progress = snapshot && snapshot.progress ? snapshot.progress : null;

            if (progress) {
                const stoppedWithoutWorker = progress.phase === 'stopping' && snapshot.running === false;
                const liveTaskStatus = snapshot.running
                    ? 'running'
                    : ((isFinalLegilPhase(progress.phase) || stoppedWithoutWorker) ? 'completed' : 'running');
                const liveTask = updateLegilTaskState(run.legilTask || {}, {
                    status: liveTaskStatus,
                    phase: progress.phase || 'running',
                    progress,
                    startResponse,
                    lastSnapshot: snapshot
                });
                updateRun(store, run.runId, {
                    status: liveTaskStatus,
                    phase: `legil_${progress.phase || 'running'}`,
                    legilProgress: progress,
                    legilTask: liveTask,
                    message: progress.currentAction || 'Legil 创意拓展运行中'
                });

                if (isFinalLegilPhase(progress.phase) || stoppedWithoutWorker) {
                    const savedCount = Number(progress.saved) || 0;
                    const failedCount = Number(progress.failed) || 0;
                    const successCount = Number(progress.success) || 0;
                    const completed = progress.phase === 'completed' && (savedCount > 0 || successCount > 0 || failedCount === 0);
                    const paused = progress.phase === 'stopped' || stoppedWithoutWorker;
                    const completedAt = new Date().toISOString();
                    const finalTask = updateLegilTaskState(liveTask, {
                        status: completed ? 'completed' : (paused ? 'paused' : 'failed'),
                        phase: stoppedWithoutWorker ? 'stopped' : progress.phase,
                        progress,
                        startResponse,
                        lastSnapshot: snapshot,
                        completedAt
                    });
                    const finalRun = updateRun(store, run.runId, {
                        status: completed ? 'completed' : (paused ? 'paused' : 'failed'),
                        phase: completed ? 'legil_completed' : (paused ? 'legil_paused' : 'legil_failed'),
                        completedAt,
                        legilProgress: progress,
                        legilTask: finalTask,
                        legilResult: {
                            success: completed,
                            phase: stoppedWithoutWorker ? 'stopped' : progress.phase,
                            successCount,
                            failedCount,
                            savedCount,
                            outputTotal: Number(progress.outputTotal) || 0,
                            message: progress.currentAction || ''
                        },
                        message: completed
                            ? `Legil 生图完成：成功 ${successCount} 组，失败 ${failedCount} 组，保存 ${savedCount} 张`
                            : `Legil 生图未完成：${progress.currentAction || progress.phase}`
                    });
                    let runWithAssets = finalRun;
                    let assetReport = null;
                    if (savedCount > 0 && finalRun) {
                        try {
                            assetReport = registerRunAssets({
                                store,
                                run: finalRun,
                                progress
                            });
                        } catch (error) {
                            assetReport = {
                                success: false,
                                error: error.message,
                                expectedSavedCount: savedCount,
                                matchedFileCount: 0,
                                newAssetCount: 0,
                                duplicateCount: 0,
                                assetIds: [],
                                warnings: ['asset_registration_failed']
                            };
                            if (logger && typeof logger.warn === 'function') {
                                logger.warn(`创意拓展资产登记失败: ${error.message}`);
                            }
                        }

                        runWithAssets = updateRun(store, run.runId, {
                            assets: assetReport,
                            assetIds: assetReport.assetIds || []
                        }) || finalRun;
                    }
                    notifyCreativeAutoRunFinal(runWithAssets || finalRun, completed ? 'completed' : (paused ? 'paused' : 'failed'));
                    updateSelectedDirectionPromptStats(store, selected, {
                        imageCountDelta: savedCount,
                        failureCountDelta: completed ? 0 : 1,
                        lastRunAt: completedAt
                    });
                    writeSchedulerState(store, {
                        status: 'idle',
                        currentRunId: null,
                        currentAgentTaskRunId: null,
                        currentLegilTask: null,
                        lastRunId: run.runId,
                        lastCompletedAt: completedAt,
                        lastLegilPhase: stoppedWithoutWorker ? 'stopped' : progress.phase,
                        consecutiveFailures: completed ? 0 : Number((run.schedulerState && run.schedulerState.consecutiveFailures) || 0) + 1,
                        daily: buildDailyAfterLegil(run.schedulerState, savedCount)
                    });
                    if (activeRunId === run.runId) {
                        activeRunId = null;
                    }
                    return runWithAssets;
                }
            }

            if (snapshot && snapshot.hasProgress === false && snapshot.running === false) {
                const completedAt = new Date().toISOString();
                const pausedTask = updateLegilTaskState(run.legilTask || {}, {
                    status: 'paused',
                    phase: 'stopped',
                    startResponse,
                    lastSnapshot: snapshot,
                    completedAt
                });
                const pausedRun = updateRun(store, run.runId, {
                    status: 'paused',
                    phase: 'legil_paused',
                    completedAt,
                    legilTask: pausedTask,
                    message: 'Legil 当前没有运行中的创意拓展任务，自动创意已停止，可继续之前任务'
                });
                notifyCreativeAutoRunFinal(pausedRun, 'paused');
                writeSchedulerState(store, {
                    status: 'idle',
                    currentRunId: null,
                    currentAgentTaskRunId: null,
                    currentLegilTask: null,
                    lastRunId: run.runId,
                    lastCompletedAt: completedAt,
                    lastLegilPhase: 'stopped'
                });
                if (activeRunId === run.runId) {
                    activeRunId = null;
                }
                return pausedRun;
            }

            await sleep(pollMs);
        }

        const timeoutTask = updateLegilTaskState(run.legilTask || {}, {
            status: 'paused',
            phase: 'poll_timeout',
            startResponse,
            lastSnapshot
        });
        const timeoutRun = updateRun(store, run.runId, {
            status: 'paused',
            phase: 'legil_poll_timeout',
            legilTask: timeoutTask,
            message: 'Legil 已启动，但 creative-auto 等待进度超时；可通过 /api/legil/creative-progress 继续查看'
        });
        notifyCreativeAutoRunFinal(timeoutRun, 'paused');
        writeSchedulerState(store, {
            status: 'idle',
            currentRunId: null,
            currentAgentTaskRunId: null,
            currentLegilTask: null,
            lastRunId: run.runId,
            lastError: 'Legil progress poll timeout'
        });
        if (activeRunId === run.runId) {
            activeRunId = null;
        }
        return timeoutRun;
    }

    async function startLegilAfterAgent({ store, run, selected, prompts, config, legilPayloadExtra = {} }) {
        if (!prompts.length) {
            const completedAt = new Date().toISOString();
            const failedRun = updateRun(store, run.runId, {
                status: 'failed',
                phase: 'prompt_gate_empty',
                completedAt,
                message: 'Prompt Gate 没有接受任何 prompt，未启动 Legil'
            });
            notifyCreativeAutoRunFinal(failedRun, 'failed');
            writeSchedulerState(store, {
                status: 'idle',
                currentRunId: null,
                currentAgentTaskRunId: null,
                currentLegilTask: null,
                lastRunId: run.runId,
                lastError: 'Prompt Gate accepted 0 prompts'
            });
            if (activeRunId === run.runId) {
                activeRunId = null;
            }
            return failedRun;
        }

        const currentRun = store.read(path.join('runs', `${run.runId}.json`), run);
        const legilPayload = buildLegilPayload({
            run: currentRun,
            prompts,
            config,
            extra: legilPayloadExtra
        });
        const queuedTask = buildLegilTask({
            run: currentRun,
            payload: legilPayload,
            prompts,
            status: 'queued',
            phase: 'starting'
        });
        const legilBrowserMode = normalizeAutoBrowserMode(legilPayload.browserMode);
        updateRun(store, run.runId, {
            status: 'running',
            phase: 'legil_starting',
            legilTask: queuedTask,
            legilPayload: {
                ...legilPayload,
                prompts: legilPayload.prompts.map(item => ({
                    index: item.index,
                    originalIndex: item.originalIndex,
                    direction: item.direction,
                    newDirectionName: item.newDirectionName,
                    promptTitle: item.promptTitle,
                    promptHash: item.promptHash,
                    sourceDirectionId: item.sourceDirectionId,
                    sourceDirectionPath: item.sourceDirectionPath,
                    promptSchemaVersion: item.promptSchemaVersion,
                    translationVersion: item.translationVersion,
                    sourcePromptHash: item.sourcePromptHash
                }))
            },
            message: `Prompt Gate 接受 ${prompts.length} 条，正在启动 Legil ${legilBrowserMode} 生图`
        });

        const startResponse = await startLegilCreativeBatch(legilPayload);
        if (!startResponse || startResponse.success === false) {
            const completedAt = new Date().toISOString();
            const failedRun = updateRun(store, run.runId, {
                status: 'failed',
                phase: 'legil_start_failed',
                completedAt,
                legilTask: updateLegilTaskState(queuedTask, {
                    status: 'failed',
                    phase: 'start_failed',
                    startResponse,
                    completedAt
                }),
                message: `Legil 启动失败：${startResponse && startResponse.message ? startResponse.message : '未知错误'}`
            });
            notifyCreativeAutoRunFinal(failedRun, 'failed');
            updateSelectedDirectionPromptStats(store, selected, {
                failureCountDelta: 1,
                lastRunAt: completedAt
            });
            writeSchedulerState(store, {
                status: 'idle',
                currentRunId: null,
                currentAgentTaskRunId: null,
                currentLegilTask: null,
                lastRunId: run.runId,
                lastError: failedRun.message,
                consecutiveFailures: Number((run.schedulerState && run.schedulerState.consecutiveFailures) || 0) + 1
            });
            if (activeRunId === run.runId) {
                activeRunId = null;
            }
            return failedRun;
        }

        const runningTask = updateLegilTaskState(queuedTask, {
            status: 'running',
            phase: 'queued',
            startResponse,
            progress: startResponse.progress || null
        });
        updateRun(store, run.runId, {
            status: 'running',
            phase: 'legil_queued',
            legilTask: runningTask,
            legilProgress: startResponse.progress || null,
            message: startResponse.message || 'Legil 创意拓展任务已启动'
        });
        writeSchedulerState(store, {
            status: 'running',
            currentRunId: run.runId,
            currentAgentTaskRunId: null,
            currentLegilTask: runningTask
        });

        return await pollLegilUntilFinal({
            store,
            run: {
                ...currentRun,
                promptTotal: prompts.length,
                legilTask: runningTask
            },
            selected,
            startResponse
        });
    }

    function continueRunToLegil(runId, payload = {}, context = {}) {
        if (activeRunId) {
            return {
                success: false,
                message: '已有自动创意任务正在运行',
                activeRun: getRun(activeRunId, context)
            };
        }

        if (typeof options.isLegilBusy === 'function' && options.isLegilBusy()) {
            return {
                success: false,
                message: '当前已有 Legil 自动化任务正在运行，请稍后再试'
            };
        }

        const { store } = getKnowledgeStore(context);
        store.ensureBase();
        const run = getRun(runId, context);
        if (!run) {
            return {
                success: false,
                message: '自动创意运行记录不存在'
            };
        }

        if (run.status !== 'completed' || run.phase !== 'agent_completed') {
            return {
                success: false,
                message: '只有已完成 Prompt Gate、尚未进入 Legil 的 run 才能继续生图'
            };
        }

        const hasSelectionPayload = Array.isArray(payload.selectedPromptIndexes)
            || Array.isArray(payload.selectedPromptOriginalIndexes)
            || Array.isArray(payload.selectedPromptHashes);
        const selectedIndexSet = new Set(safeArray(payload.selectedPromptIndexes)
            .map(value => Number(value))
            .filter(Number.isFinite));
        const selectedOriginalIndexSet = new Set(safeArray(payload.selectedPromptOriginalIndexes)
            .map(value => Number(value))
            .filter(Number.isFinite));
        const selectedHashSet = new Set(safeArray(payload.selectedPromptHashes)
            .map(value => String(value || '').trim())
            .filter(Boolean));
        const promptMatchesSelection = item => {
            if (!hasSelectionPayload) return !item || item.selected !== false;
            if (!item) return false;
            if (item.promptHash && selectedHashSet.has(String(item.promptHash))) return true;
            if (Number.isFinite(Number(item.index)) && selectedIndexSet.has(Number(item.index))) return true;
            if (Number.isFinite(Number(item.originalIndex)) && selectedOriginalIndexSet.has(Number(item.originalIndex))) return true;
            return false;
        };
        const allRunPrompts = safeArray(run.prompts);
        const allPrompts = allRunPrompts.filter(promptMatchesSelection);
        const requestedMaxPrompts = Number(payload.maxPrompts);
        const prompts = Number.isFinite(requestedMaxPrompts) && requestedMaxPrompts > 0
            ? allPrompts.slice(0, Math.floor(requestedMaxPrompts))
            : allPrompts;
        if (!prompts.length) {
            return {
                success: false,
                message: hasSelectionPayload
                    ? '请至少勾选 1 条 Prompt Gate 通过的 prompt 后再继续生图'
                    : '本轮没有通过 Prompt Gate 的 prompt，无法继续生图'
            };
        }

        const selected = buildSelectedFromRun(run);
        const creativeConfig = context.appConfig && context.appConfig.creative ? context.appConfig.creative : {};
        const config = {
            ...DEFAULT_AUTO_CONFIG,
            ...(run.config || {}),
            browserMode: normalizeAutoBrowserMode(
                payload.browserMode
                    || creativeConfig.browserMode
                    || (run.config && run.config.browserMode)
                    || DEFAULT_AUTO_CONFIG.browserMode
            )
        };
        const startedAt = new Date().toISOString();
        const promptSelection = hasSelectionPayload
            ? {
                selectedPromptIndexes: Array.from(selectedIndexSet),
                selectedPromptOriginalIndexes: Array.from(selectedOriginalIndexSet),
                selectedPromptHashes: Array.from(selectedHashSet),
                selectedPromptCount: prompts.length,
                skippedPromptCount: Math.max(0, allRunPrompts.length - prompts.length),
                updatedAt: startedAt
            }
            : null;
        const promptSelectionUpdates = hasSelectionPayload
            ? {
                prompts: allRunPrompts.map(item => item ? {
                    ...item,
                    selected: promptMatchesSelection(item)
                } : item),
                promptSelection
            }
            : {};
        const preparedRun = updateRun(store, run.runId, {
            status: 'running',
            phase: 'legil_pending',
            agentOnly: false,
            continuedFromAgentOnly: run.agentOnly === true,
            continuedToLegilAt: startedAt,
            mode: run.agentOnly === true ? 'agent-only-continued-legil' : (run.mode || 'legil-run-once'),
            completedAt: '',
            promptTotal: prompts.length,
            expectedImageTotal: prompts.length * Math.max(1, Number(config.generationSettings && config.generationSettings.outputQuantity) || DEFAULT_AUTO_CONFIG.outputQuantity),
            message: `已从 Prompt Gate 结果继续启动 Legil：${prompts.length} 条 prompt`,
            ...promptSelectionUpdates
        }) || run;

        activeRunId = run.runId;
        writeSchedulerState(store, {
            status: 'running',
            currentRunId: run.runId,
            currentAgentTaskRunId: null,
            lastStartedAt: startedAt
        });

        startLegilAfterAgent({
            store,
            run: preparedRun,
            selected,
            prompts,
            config
        }).catch(error => {
            const failedAt = new Date().toISOString();
            const failedRun = updateRun(store, run.runId, {
                status: 'failed',
                phase: 'legil_continue_failed',
                completedAt: failedAt,
                error: error.message,
                message: '从 Prompt Gate 继续启动 Legil 失败: ' + error.message
            });
            notifyCreativeAutoRunFinal(failedRun, 'failed');
            updateSelectedDirectionPromptStats(store, selected, {
                failureCountDelta: 1,
                lastRunAt: failedAt
            });
            writeSchedulerState(store, {
                status: 'idle',
                currentRunId: null,
                currentAgentTaskRunId: null,
                currentLegilTask: null,
                lastRunId: run.runId,
                lastError: error.message,
                consecutiveFailures: Number((run.schedulerState && run.schedulerState.consecutiveFailures) || 0) + 1
            });
            if (activeRunId === run.runId) {
                activeRunId = null;
            }
            if (logger && typeof logger.error === 'function') {
                logger.error(`从 Prompt Gate 继续启动 Legil 失败: ${error.message}`);
            }
        });

        return {
            success: true,
            message: '已从 Prompt Gate 结果继续启动 Legil',
            run: preparedRun
        };
    }

    function markRunPaused(store, run, updates = {}) {
        const completedAt = updates.completedAt || new Date().toISOString();
        const pausedRun = updateRun(store, run.runId, {
            status: 'paused',
            completedAt,
            ...updates
        }) || {
            ...run,
            status: 'paused',
            completedAt,
            ...updates
        };
        writeSchedulerState(store, {
            status: 'idle',
            currentRunId: null,
            currentAgentTaskRunId: null,
            currentLegilTask: null,
            lastRunId: run.runId,
            lastCompletedAt: completedAt,
            lastError: pausedRun.message || ''
        });
        if (activeRunId === run.runId) {
            activeRunId = null;
        }
        const pausedQueue = updateTargetQueueFromRun(store, pausedRun, 'paused');
        if (pausedQueue && activeTargetQueue && activeTargetQueue.queueId === pausedQueue.queueId) {
            activeTargetQueue = null;
        }
        if (pausedQueue) {
            writeSchedulerState(store, {
                targetQueue: publicTargetQueue(pausedQueue)
            });
        }
        return pausedRun;
    }

    function pauseTargetQueue(queueId = '', context = {}, sourceRun = null) {
        const { store } = getKnowledgeStore(context);
        store.ensureBase();
        const queue = loadTargetQueue(store, queueId);
        if (!queue) {
            return {
                success: false,
                message: '批量队列不存在'
            };
        }

        const currentRunId = String(queue.currentRunId || '').trim();
        if (currentRunId && (!sourceRun || currentRunId !== sourceRun.runId)) {
            const currentRun = store.read(path.join('runs', `${path.basename(currentRunId)}.json`), null);
            if (currentRun && currentRun.status === 'running') {
                return pauseRun(currentRunId, {}, context);
            }
        }

        const pausedQueue = writeTargetQueue(store, {
            ...queue,
            status: 'paused',
            lastRunId: sourceRun && sourceRun.runId ? sourceRun.runId : queue.lastRunId || '',
            lastRunStatus: sourceRun && sourceRun.status ? sourceRun.status : queue.lastRunStatus || '',
            lastRunPhase: sourceRun && sourceRun.phase ? sourceRun.phase : queue.lastRunPhase || ''
        });
        if (activeTargetQueue && activeTargetQueue.queueId === queue.queueId) {
            activeTargetQueue = null;
        }
        writeSchedulerState(store, {
            status: 'idle',
            currentRunId: null,
            currentAgentTaskRunId: null,
            currentLegilTask: null,
            targetQueue: publicTargetQueue(pausedQueue)
        });

        return {
            success: true,
            message: '批量创意队列已暂停',
            queue: publicTargetQueue(pausedQueue),
            run: sourceRun ? attachTargetQueueProgress(store, sourceRun) : null
        };
    }

    function pauseRun(runId, payload = {}, context = {}) {
        const { store } = getKnowledgeStore(context);
        store.ensureBase();
        const run = getRun(runId, context);
        if (!run) {
            return {
                success: false,
                message: '自动创意运行记录不存在'
            };
        }

        if (run.status !== 'running') {
            const liveTask = getLiveCreativeLegilTask();
            if (liveTask && liveTask.runId === run.runId) {
                const stopResult = typeof options.requestLegilTaskStop === 'function'
                    ? options.requestLegilTaskStop()
                    : { success: true, message: 'Stop requested' };
                if (stopResult && stopResult.success === false) {
                    return {
                        success: false,
                        message: stopResult.message || 'Stop failed',
                        run
                    };
                }

                const progress = liveTask.progress || {};
                const stoppingTask = updateLegilTaskState(run.legilTask || {}, {
                    status: 'running',
                    phase: 'stopping',
                    progress: {
                        ...progress,
                        phase: 'stopping',
                        currentAction: stopResult.message || progress.currentAction || 'Stopping Legil creative task'
                    },
                    lastSnapshot: liveTask.snapshot
                });
                const stoppingRun = updateRun(store, run.runId, {
                    status: 'running',
                    phase: 'legil_stopping',
                    legilProgress: {
                        ...progress,
                        phase: 'stopping',
                        currentAction: stopResult.message || progress.currentAction || 'Stopping Legil creative task'
                    },
                    legilTask: {
                        ...stoppingTask,
                        lastSnapshot: liveTask.snapshot
                    },
                    message: stopResult.message || 'Stop requested for live Legil creative task'
                }) || run;
                activeRunId = run.runId;
                return {
                    success: true,
                    message: stopResult.message || 'Stop requested',
                    run: attachTargetQueueProgress(store, stoppingRun)
                };
            }

            const queueId = run.targetQueue && run.targetQueue.queueId;
            const queueStatus = run.targetQueue && (run.targetQueue.queueStatus || run.targetQueue.status);
            if (queueId && queueStatus === 'running') {
                return pauseTargetQueue(queueId, context, run);
            }
            if (activeRunId === run.runId && isFinalRunStatus(run.status)) {
                activeRunId = null;
            }
            return {
                success: true,
                message: isFinalRunStatus(run.status) ? '任务已经不在运行中' : '任务当前不需要暂停',
                run
            };
        }

        const phase = String(run.phase || '');
        if (isAgentRunningPhase(phase)) {
            let agentTask = null;
            let cancelResult = null;
            if (run.agentTaskRunId && typeof options.getCreativeAgentTask === 'function') {
                agentTask = options.getCreativeAgentTask(run.agentTaskRunId);
            }
            if (agentTask && typeof options.cancelCreativeAgentTask === 'function') {
                cancelResult = options.cancelCreativeAgentTask(agentTask);
            }
            const publicTask = cancelResult && cancelResult.task
                ? cancelResult.task
                : (agentTask && typeof options.publicCreativeAgentTask === 'function'
                    ? options.publicCreativeAgentTask(agentTask)
                    : run.agentTask);
            const pausedRun = markRunPaused(store, run, {
                phase: 'agent_cancelled',
                agentTask: publicTask || run.agentTask || null,
                message: '创意 Agent 已暂停；恢复时会基于同一方向重新生成 prompt'
            });
            notifyCreativeAutoRunFinal(pausedRun, 'paused');
            return {
                success: true,
                message: '已暂停创意 Agent 任务',
                run: pausedRun
            };
        }

        const beforeSnapshot = getLegilCreativeProgressSnapshot();
        const stopResult = typeof options.requestLegilTaskStop === 'function'
            ? options.requestLegilTaskStop()
            : { success: true, message: '已发送停止指令' };
        if (stopResult && stopResult.success === false) {
            return {
                success: false,
                message: stopResult.message || '停止失败',
                run
            };
        }

        const afterSnapshot = getLegilCreativeProgressSnapshot() || beforeSnapshot;
        const progress = afterSnapshot && afterSnapshot.progress ? afterSnapshot.progress : null;
        if (!afterSnapshot || afterSnapshot.running === false) {
            const completedAt = new Date().toISOString();
            const pausedTask = updateLegilTaskState(run.legilTask || {}, {
                status: 'paused',
                phase: progress && progress.phase ? progress.phase : 'stopped',
                progress,
                lastSnapshot: afterSnapshot || null,
                completedAt
            });
            const pausedRun = markRunPaused(store, run, {
                phase: 'legil_paused',
                legilProgress: progress || run.legilProgress || null,
                legilTask: pausedTask,
                message: progress && progress.currentAction
                    ? progress.currentAction
                    : '自动创意已停止，可继续之前任务或开始新任务'
            });
            notifyCreativeAutoRunFinal(pausedRun, 'paused');
            return {
                success: true,
                message: '自动创意已停止，可继续之前任务',
                run: pausedRun
            };
        }

        const stoppingTask = updateLegilTaskState(run.legilTask || {}, {
            status: 'running',
            phase: 'stopping',
            progress: progress || run.legilProgress || null,
            lastSnapshot: afterSnapshot || null
        });
        const stoppingRun = updateRun(store, run.runId, {
            status: 'running',
            phase: 'legil_stopping',
            legilProgress: progress || run.legilProgress || null,
            legilTask: stoppingTask,
            message: stopResult.message || '已发送暂停指令，当前 Legil 步骤结束后会停止'
        }) || run;

        return {
            success: true,
            message: stoppingRun.message,
            run: stoppingRun
        };
    }

    function buildResumePayloadFromRun(run = {}) {
        return {
            maxPrompts: run.quota && Number.isFinite(Number(run.quota.maxPrompts)) ? Number(run.quota.maxPrompts) : undefined,
            unlimitedPrompts: run.quota && run.quota.unlimitedPrompts === true,
            fullScale: run.quota && run.quota.unlimitedPrompts === true,
            agentOnly: run.agentOnly === true,
            targetSelection: run.targetSelection || undefined,
            creativeBrief: run.creativeBrief || undefined
        };
    }

    function resumeRun(runId, payload = {}, context = {}) {
        if (activeRunId) {
            return {
                success: false,
                message: '已有自动创意任务正在运行',
                activeRun: getRun(activeRunId, context)
            };
        }

        if (typeof options.isLegilBusy === 'function' && options.isLegilBusy()) {
            return {
                success: false,
                message: '当前已有 Legil 自动化任务正在运行，请稍后再恢复'
            };
        }

        const { store } = getKnowledgeStore(context);
        store.ensureBase();
        const run = getRun(runId, context);
        if (!run) {
            return {
                success: false,
                message: '自动创意运行记录不存在'
            };
        }

        if (run.status === 'completed' && run.phase === 'agent_completed') {
            return continueRunToLegil(runId, payload, context);
        }

        if (run.status !== 'paused') {
            return {
                success: false,
                message: '只有已暂停的自动创意任务可以恢复',
                run
            };
        }

        const selected = buildSelectedFromRun(run);
        const creativeConfig = context.appConfig && context.appConfig.creative ? context.appConfig.creative : {};
        const config = {
            ...DEFAULT_AUTO_CONFIG,
            ...(run.config || {}),
            browserMode: normalizeAutoBrowserMode(
                payload.browserMode
                    || creativeConfig.browserMode
                    || (run.config && run.config.browserMode)
                    || DEFAULT_AUTO_CONFIG.browserMode
            )
        };
        const now = new Date().toISOString();

        if (isAgentRunningPhase(run.phase) || run.phase === 'agent_cancelled') {
            const winkyConfig = typeof options.getStoredWinkyConfig === 'function'
                ? options.getStoredWinkyConfig()
                : {};
            if (!winkyConfig.apiKey || !winkyConfig.apiUrl || !winkyConfig.model) {
                return {
                    success: false,
                    message: '创意 Agent 的 LLM 配置不完整，无法恢复'
                };
            }
            if (typeof options.startCreativeAgentTask !== 'function' || typeof options.getCreativeAgentTask !== 'function') {
                return {
                    success: false,
                    message: '缺少创意 Agent 任务运行能力，无法恢复'
                };
            }

            const agentTask = options.startCreativeAgentTask({
                apiUrl: winkyConfig.apiUrl,
                apiKey: winkyConfig.apiKey,
                model: winkyConfig.model,
                provider: winkyConfig.provider,
                instruction: run.instruction,
                targetCount: DEFAULT_AUTO_CONFIG.newDirectionsPerSource,
                attachments: [],
                suppressNotification: true
            });
            const preparedRun = updateRun(store, run.runId, {
                status: 'running',
                phase: 'agent_running',
                completedAt: '',
                resumedAt: now,
                agentTaskRunId: agentTask.runId,
                agentTask: typeof options.publicCreativeAgentTask === 'function'
                    ? options.publicCreativeAgentTask(agentTask)
                    : agentTask,
                message: '已恢复创意 Agent，正在重新生成 prompt'
            }) || run;
            activeRunId = run.runId;
            writeSchedulerState(store, {
                status: 'running',
                currentRunId: run.runId,
                currentAgentTaskRunId: agentTask.runId,
                lastStartedAt: now
            });
            runAgentOnlyInBackground({
                store,
                run: preparedRun,
                agentTask,
                selected,
                quota: run.quota || {},
                payload: buildResumePayloadFromRun(run),
                config,
                agentOnly: run.agentOnly === true,
                promptTranslatorConfig: winkyConfig
            });
            return {
                success: true,
                message: '已恢复创意 Agent 任务',
                run: preparedRun
            };
        }

        if (!isLegilRunPhase(run.phase)) {
            return {
                success: false,
                message: '这个暂停状态暂不支持恢复，请开始新任务',
                run
            };
        }

        const resumeInfo = typeof options.getCreativeResumeInfo === 'function'
            ? options.getCreativeResumeInfo(true)
            : null;
        const remainingPrompts = resumeInfo && resumeInfo.hasResume && Array.isArray(resumeInfo.prompts)
            ? resumeInfo.prompts.filter(item => item && item.selected !== false)
            : [];
        const prompts = remainingPrompts.length
            ? remainingPrompts
            : safeArray(run.prompts).filter(item => item && item.selected !== false);
        if (!prompts.length) {
            return {
                success: false,
                message: '没有可恢复的剩余 prompt，请开始新任务',
                run
            };
        }

        const preparedRun = updateRun(store, run.runId, {
            status: 'running',
            phase: 'legil_pending',
            completedAt: '',
            resumedAt: now,
            message: `已恢复 Legil 创意拓展，准备继续 ${prompts.length} 条 prompt`
        }) || run;
        activeRunId = run.runId;
        writeSchedulerState(store, {
            status: 'running',
            currentRunId: run.runId,
            currentAgentTaskRunId: null,
            lastStartedAt: now
        });

        startLegilAfterAgent({
            store,
            run: preparedRun,
            selected,
            prompts,
            config,
            legilPayloadExtra: resumeInfo && resumeInfo.hasResume
                ? {
                    resumeMode: true,
                    resumeRunId: resumeInfo.runId
                }
                : {}
        }).catch(error => {
            const failedAt = new Date().toISOString();
            const failedRun = updateRun(store, run.runId, {
                status: 'failed',
                phase: 'legil_resume_failed',
                completedAt: failedAt,
                error: error.message,
                message: '恢复 Legil 创意拓展失败: ' + error.message
            });
            notifyCreativeAutoRunFinal(failedRun, 'failed');
            writeSchedulerState(store, {
                status: 'idle',
                currentRunId: null,
                currentAgentTaskRunId: null,
                currentLegilTask: null,
                lastRunId: run.runId,
                lastError: error.message
            });
            if (activeRunId === run.runId) {
                activeRunId = null;
            }
            if (logger && typeof logger.error === 'function') {
                logger.error(`恢复 Legil 创意拓展失败: ${error.message}`);
            }
        });

        return {
            success: true,
            message: '已恢复 Legil 创意拓展任务',
            run: preparedRun
        };
    }

    async function followAgentTask({ store, run, agentTask, selected, quota, payload, config, agentOnly, promptTranslatorConfig, memoryRules = [] }) {
        const startedAt = Date.now();
        const maxWaitMs = 12 * 60 * 1000;

        while (Date.now() - startedAt < maxWaitMs) {
            const currentTask = options.getCreativeAgentTask(agentTask.runId);
            if (!currentTask) {
                throw new Error('创意 Agent 任务不存在或已过期');
            }

            if (['completed', 'failed', 'cancelled'].includes(String(currentTask.phase || ''))) {
                const publicTask = options.publicCreativeAgentTask(currentTask, true);
                if (currentTask.phase === 'cancelled') {
                    const pausedRun = {
                        ...run,
                        status: 'paused',
                        phase: 'agent_cancelled',
                        completedAt: new Date().toISOString(),
                        agentTask: publicTask,
                        message: publicTask.message || '创意 Agent 已停止，可继续之前任务'
                    };
                    writeRun(store, pausedRun);
                    notifyCreativeAutoRunFinal(pausedRun, 'paused');
                    writeSchedulerState(store, {
                        status: 'idle',
                        currentRunId: null,
                        currentAgentTaskRunId: null,
                        lastRunId: run.runId,
                        lastCompletedAt: pausedRun.completedAt,
                        lastError: pausedRun.message
                    });
                    if (activeRunId === run.runId) {
                        activeRunId = null;
                    }
                    return pausedRun;
                }
                if (currentTask.phase !== 'completed') {
                    throw new Error(publicTask.error || publicTask.message || '创意 Agent 未完成');
                }

                const result = publicTask.result || {};
                const translation = bypassPromptTranslationForLegil({
                    prompts: result.prompts,
                    selected,
                    runId: run.runId
                });
                if (logger && typeof logger.info === 'function') {
                    logger.info(`Prompt Translator skipped: Creative Agent returned ${translation.report.promptCount} final Legil prompts`);
                }
                const gate = applyPromptGate({
                    prompts: translation.prompts,
                    selected,
                    quota,
                    store,
                    runId: run.runId,
                    payload,
                    config,
                    memoryRules
                });
                const prompts = gate.prompts;
                const qualityReport = gate.qualityReport;
                const completedRun = {
                    ...run,
                    status: agentOnly ? 'completed' : 'running',
                    phase: 'agent_completed',
                    completedAt: agentOnly ? new Date().toISOString() : '',
                    promptTotalRaw: safeArray(result.prompts).length,
                    promptTotalTranslated: translation.report.promptCount,
                    promptTotalCandidate: gate.promptQualityReport.candidatePromptCount,
                    promptTotal: prompts.length,
                    promptTotalRejected: gate.promptQualityReport.rejectedPromptCount,
                    expectedImageTotal: gate.promptQualityReport.expectedImageTotal,
                    directionDefinitions: translation.directionDefinitions,
                    prompts,
                    qualityReport,
                    promptQualityReport: gate.promptQualityReport,
                    promptTranslation: translation.report,
                    agentTask: publicTask,
                    agentOutput: {
                        fileName: result.fileName || '',
                        downloadUrl: result.downloadUrl || '',
                        localPath: result.localPath || '',
                        rawText: result.rawText || '',
                        rawTableMarkdown: result.rawTableMarkdown || result.rawText || '',
                        markdownPreview: result.markdownPreview || '',
                        message: result.message || ''
                    },
                    message: agentOnly
                        ? `Agent-only 已生成 ${safeArray(result.prompts).length} 条 prompt，Prompt Gate 接受 ${prompts.length} 条，未调用 Legil`
                        : `Agent 已生成 ${safeArray(result.prompts).length} 条 prompt，Prompt Gate 接受 ${prompts.length} 条，准备调用 Legil`
                };
                writeRun(store, completedRun);
                updateSelectedDirectionPromptStats(store, selected, {
                    expandedCountDelta: 1,
                    promptCountDelta: prompts.length,
                    lastRunAt: completedRun.completedAt || new Date().toISOString()
                });

                if (agentOnly) {
                    notifyCreativeAutoRunFinal(completedRun, 'completed');
                    writeSchedulerState(store, {
                        status: 'idle',
                        currentRunId: null,
                        currentAgentTaskRunId: null,
                        lastRunId: run.runId,
                        lastCompletedAt: completedRun.completedAt
                    });
                    if (activeRunId === run.runId) {
                        activeRunId = null;
                    }
                    return completedRun;
                }

                return await startLegilAfterAgent({
                    store,
                    run: completedRun,
                    selected,
                    prompts,
                    config
                });
            }

            await sleep(2000);
        }

        throw new Error('等待创意 Agent 超时');
    }

    function startNextQueuedTarget(previousRun = {}) {
        const queueId = previousRun && previousRun.targetQueue ? previousRun.targetQueue.queueId : '';
        const queueContext = activeTargetQueue && activeTargetQueue.context ? activeTargetQueue.context : {};
        const { store } = getKnowledgeStore(queueContext);
        store.ensureBase();
        let queue = activeTargetQueue && activeTargetQueue.queueId === queueId
            ? activeTargetQueue
            : loadTargetQueue(store, queueId);

        if (!queue || (queue.currentRunId && queue.currentRunId !== previousRun.runId)) {
            return;
        }

        if (queue.status && queue.status !== 'running') {
            const canRecoverCompletedRun = previousRun.status === 'completed' && queue.currentRunId === previousRun.runId;
            if (canRecoverCompletedRun) {
                queue = writeTargetQueue(store, {
                    ...queue,
                    status: 'running'
                }) || queue;
            } else {
                activeTargetQueue = null;
                return;
            }
        }

        if (previousRun.status !== 'completed') {
            updateTargetQueueFromRun(store, previousRun, previousRun.status === 'paused' ? 'paused' : 'failed');
            if (logger && typeof logger.warn === 'function') {
                logger.warn(`Creative target queue stopped after ${previousRun.runId}: ${previousRun.status || 'unknown'}`);
            }
            activeTargetQueue = null;
            return;
        }

        const completedQueue = updateTargetQueueFromRun(store, previousRun, 'completed') || queue;
        const completedIndex = Math.max(0, Number(previousRun.targetQueue && previousRun.targetQueue.index) ? Number(previousRun.targetQueue.index) - 1 : Number(completedQueue.currentIndex) || 0);
        const nextIndex = completedIndex + 1;
        if (nextIndex >= safeArray(completedQueue.targets).length) {
            const finalQueue = writeTargetQueue(store, {
                ...completedQueue,
                status: 'completed',
                nextIndex,
                currentIndex: completedIndex,
                currentRunId: previousRun.runId
            });
            writeSchedulerState(store, {
                targetQueue: publicTargetQueue(finalQueue)
            });
            if (logger && typeof logger.info === 'function') {
                logger.info(`Creative target queue completed: ${completedQueue.queueId}`);
            }
            activeTargetQueue = null;
            return;
        }

        queue = writeTargetQueue(store, {
            ...completedQueue,
            status: 'running',
            nextIndex,
            currentIndex: nextIndex,
            currentRunId: ''
        }) || completedQueue;
        activeTargetQueue = queue;
        const target = queue.targets[queue.nextIndex];
        const nextPayload = payloadForSingleCreativeTarget(
            queue.originalPayload,
            target,
            queue.nextIndex,
            queue.targets.length,
            queue.queueId
        );

        setTimeout(() => {
            const latestQueue = loadTargetQueue(store, queue.queueId);
            if (!latestQueue || latestQueue.status !== 'running') {
                activeTargetQueue = null;
                return;
            }
            const result = runOnce(nextPayload, queue.context);
            if (!result || result.success === false) {
                if (logger && typeof logger.error === 'function') {
                    logger.error(`Creative target queue failed to start next target: ${result && result.message ? result.message : 'unknown error'}`);
                }
                updateTargetQueue(store, queue.queueId, {
                    status: 'failed',
                    lastError: result && result.message ? result.message : 'unknown error'
                });
                activeTargetQueue = null;
            }
        }, 1000);
    }

    async function runAgentOnlyInBackground({ store, run, agentTask, selected, quota, payload, config, agentOnly, promptTranslatorConfig }) {
        try {
            const finalRun = await followAgentTask({
                store,
                run,
                agentTask,
                selected,
                quota,
                payload,
                config,
                agentOnly,
                promptTranslatorConfig,
                memoryRules: run.memoryRules
            });
            startNextQueuedTarget(finalRun);
        } catch (error) {
            const failedRun = {
                ...run,
                status: 'failed',
                phase: 'agent_failed',
                completedAt: new Date().toISOString(),
                error: error.message,
                message: '自动创意运行失败: ' + error.message
            };
            writeRun(store, failedRun);
            notifyCreativeAutoRunFinal(failedRun, 'failed');
            updateSelectedDirectionPromptStats(store, selected, {
                failureCountDelta: 1,
                lastRunAt: failedRun.completedAt
            });
            writeSchedulerState(store, {
                status: 'idle',
                currentRunId: null,
                currentAgentTaskRunId: null,
                lastRunId: run.runId,
                lastError: error.message,
                consecutiveFailures: Number((run.schedulerState && run.schedulerState.consecutiveFailures) || 0) + 1
            });
            if (activeRunId === run.runId) {
                activeRunId = null;
            }
            if (activeTargetQueue && activeTargetQueue.currentRunId === run.runId) {
                updateTargetQueueFromRun(store, failedRun, 'failed');
                activeTargetQueue = null;
            }
            if (logger && typeof logger.error === 'function') {
                logger.error(`自动创意运行失败: ${error.message}`);
            }
        }
    }

    function runOnce(payload = {}, context = {}) {
        const agentOnly = payload.agentOnly === true;

        if (activeRunId) {
            notifyCreativeAutoBlocked({
                title: '运行一次自动创意未启动',
                message: '已有自动创意任务正在运行',
                keySuffix: 'active-run'
            });
            return {
                success: false,
                message: '已有自动创意任务正在运行',
                activeRun: getRun(activeRunId, context)
            };
        }

        if (typeof options.hasActiveCreativeAgentTask === 'function' && options.hasActiveCreativeAgentTask()) {
            notifyCreativeAutoBlocked({
                title: '运行一次自动创意未启动',
                message: '已有创意 Agent 任务正在运行',
                keySuffix: 'agent-busy'
            });
            return {
                success: false,
                message: '已有创意 Agent 任务正在运行，请等待完成后再试'
            };
        }

        if (!agentOnly && typeof options.isLegilBusy === 'function' && options.isLegilBusy()) {
            notifyCreativeAutoBlocked({
                title: '运行一次自动创意已暂停',
                message: '当前已有 Legil 自动化任务正在运行',
                keySuffix: 'legil-busy'
            });
            return {
                success: false,
                message: '当前已有 Legil 自动化任务正在运行，请稍后再试'
            };
        }

        const appConfig = context.appConfig || {};
        const knowledge = readKnowledge(context);
        const preflight = buildPreflight(appConfig, knowledge);
        if (!preflight.ok) {
            const failedChecks = safeArray(preflight.checks)
                .filter(check => !check.ok && check.level === 'error')
                .map(check => `${check.label}${check.path ? `：${check.path}` : ''}`);
            notifyCreativeAutoBlocked({
                title: '运行一次自动创意 Preflight 未通过',
                message: '环境检查未通过，未启动任务',
                level: 'error',
                keySuffix: 'preflight',
                extraLines: failedChecks
            });
            return {
                success: false,
                message: 'Preflight 检查未通过',
                preflight
            };
        }

        const winkyConfig = typeof options.getStoredWinkyConfig === 'function'
            ? options.getStoredWinkyConfig()
            : {};
        if (!winkyConfig.apiKey || !winkyConfig.apiUrl || !winkyConfig.model) {
            notifyCreativeAutoBlocked({
                title: '运行一次自动创意异常',
                message: '创意 Agent 的 LLM 配置不完整',
                level: 'error',
                keySuffix: 'llm-config'
            });
            return {
                success: false,
                message: '创意 Agent 的 LLM 配置不完整，请先配置 API Key、API URL 和模型 ID'
            };
        }

        if (typeof options.startCreativeAgentTask !== 'function' || typeof options.getCreativeAgentTask !== 'function') {
            throw new Error('缺少创意 Agent 任务运行能力');
        }

        const { store } = getKnowledgeStore(context);
        store.ensureBase();

        let pendingTargetQueue = null;
        if (isSequentialCreativeTargetPayload(payload)) {
            const targets = creativeBriefTargetsFromPayload(payload).filter(target => !target || target.selected !== false);
            const queueId = `creative_queue_${formatRunTimestamp()}_${crypto.randomBytes(3).toString('hex')}`;
            pendingTargetQueue = createTargetQueue({
                queueId,
                payload,
                context,
                targets
            });
            writeTargetQueue(store, pendingTargetQueue);
            payload = payloadForSingleCreativeTarget(payload, targets[0], 0, targets.length, queueId);
            if (logger && typeof logger.info === 'function') {
                logger.info(`Creative target queue started: ${queueId}, targets ${targets.length}`);
            }
        }

        const selectedBase = resolveSelectedDirection(knowledge, payload);
        const directionSystemContext = buildDirectionSystemContext({
            directions: knowledge.directions,
            selected: selectedBase,
            store
        });
        const selected = {
            ...selectedBase,
            directionSystemContext,
            siblings: directionSystemContext.siblings,
            dimensionCoverage: directionSystemContext.dimensionCoverage,
            exclusionContext: directionSystemContext.exclusionContext,
            directionTreeSummary: directionSystemContext.directionTreeSummary
        };
        const creativeConfig = appConfig.creative || {};
        const config = {
            ...DEFAULT_AUTO_CONFIG,
            outputFolder: creativeConfig.outputFolder || 'D:\\工作\\自动化工作流1\\创意拓展\\输出',
            referenceFolder: creativeConfig.referenceFolder || knowledge.knowledgeConfig.referenceFolder,
            browserMode: normalizeAutoBrowserMode(creativeConfig.browserMode || DEFAULT_AUTO_CONFIG.browserMode),
            generationSettings: {
                ...DEFAULT_AUTO_CONFIG.generationSettings,
                ...(creativeConfig.generationSettings || {})
            }
        };
        const requestedMaxPrompts = agentOnly
            ? payload.maxPrompts
            : (payload.maxPrompts || payload.legilMaxPrompts || (payload.fullScale === true ? DEFAULT_AUTO_CONFIG.maxPromptsPerRun : DEFAULT_AUTO_CONFIG.legilSmokeMaxPrompts));
        const quota = buildQuota({
            maxPrompts: requestedMaxPrompts,
            unlimitedPrompts: agentOnly || payload.unlimitedPrompts === true || payload.fullScale === true,
            outputQuantity: config.generationSettings.outputQuantity
        }, knowledge.schedulerState);
        if (quota.maxPrompts <= 0) {
            notifyCreativeAutoBlocked({
                title: '运行一次自动创意已暂停',
                message: '本轮 prompt 上限为 0',
                keySuffix: `quota-${quota.date}`,
                extraLines: ['持续生图模式不受图片额度限制；请检查本轮 prompt 上限设置。']
            });
            return {
                success: false,
                message: '本轮 prompt 上限为 0，无法生成新的 prompt',
                quota
            };
        }

        const referenceImages = getMatchedReferenceImages(selected.direction, knowledge);
        const historicalCreativeContext = summarizeHistoricalCreativeUsage({
            store,
            selectedDirection: selected.direction,
            maxDirections: 30,
            maxPrompts: 12
        });
        const instruction = buildAgentInstruction({
            selected,
            referenceImages,
            payload,
            config,
            quota,
            memoryRules: knowledge.memoryRules,
            historicalCreativeContext
        });
        const runId = `creative_run_${formatRunTimestamp()}_${crypto.randomBytes(3).toString('hex')}`;
        const now = new Date().toISOString();
        const queueBrief = creativeBriefFromPayload(payload);
        const queueInfo = queueBrief && queueBrief.sequentialQueue ? queueBrief.sequentialQueue : null;
        const queueTarget = creativeBriefTargetsFromPayload(payload)[0] || null;
        const run = {
            runId,
            mode: agentOnly ? 'agent-only' : 'legil-run-once',
            agentOnly,
            status: 'running',
            phase: 'agent_running',
            createdAt: now,
            startedAt: now,
            completedAt: '',
            sourceDirection: selected.direction,
            targetSelection: payload.targetSelection || null,
            creativeBrief: payload.creativeBrief || null,
            aggregateTarget: selected.aggregateTarget || null,
            targetQueue: queueInfo ? {
                ...queueInfo,
                targetId: queueTarget && (queueTarget.targetId || queueTarget.targetKey || queueTarget.sourceMaterialId || ''),
                targetName: queueTarget && (queueTarget.sourceMaterialName || queueTarget.materialName || queueTarget.sourceDirectionPath || '')
            } : null,
            selection: {
                score: selected.score,
                scoreParts: selected.scoreParts,
                reasons: selected.reasons,
                topMaterialInsight: selected.topMaterialInsight
            },
            referenceImages,
            config,
            quota,
            schedulerState: knowledge.schedulerState,
            memoryRules: knowledge.memoryRules,
            historicalCreativeContext,
            directionSystemContext,
            instruction,
            promptTotalRaw: 0,
            promptTotalTranslated: 0,
            promptTotal: 0,
            expectedImageTotal: 0,
            directionDefinitions: [],
            prompts: [],
            qualityReport: null,
            promptQualityReport: null,
            promptTranslation: null,
            agentTask: null,
            agentOutput: null,
            legilPayload: null,
            legilTask: null,
            legilProgress: null,
            legilResult: null,
            message: agentOnly
                ? 'Agent-only 已启动，正在生成 prompt'
                : '运行一次自动创意已启动，正在生成 prompt'
        };

        const agentTask = options.startCreativeAgentTask({
            apiUrl: winkyConfig.apiUrl,
            apiKey: winkyConfig.apiKey,
            model: winkyConfig.model,
            provider: winkyConfig.provider,
            instruction,
            targetCount: DEFAULT_AUTO_CONFIG.newDirectionsPerSource,
            attachments: [],
            suppressNotification: true
        });
        run.agentTaskRunId = agentTask.runId;
        run.agentTask = options.publicCreativeAgentTask(agentTask);
        writeRun(store, run);
        writeSchedulerState(store, {
            status: 'running',
            currentRunId: runId,
            currentAgentTaskRunId: agentTask.runId,
            lastStartedAt: now,
            targetQueue: run.targetQueue || null
        });
        activeRunId = runId;
        if (pendingTargetQueue || (activeTargetQueue && queueInfo)) {
            activeTargetQueue = pendingTargetQueue || activeTargetQueue;
            activeTargetQueue.currentRunId = runId;
            activeTargetQueue.currentIndex = Math.max(0, Number(queueInfo && queueInfo.index) ? Number(queueInfo.index) - 1 : Number(activeTargetQueue.currentIndex) || 0);
            activeTargetQueue.nextIndex = activeTargetQueue.currentIndex;
            activeTargetQueue.status = 'running';
            const savedQueue = writeTargetQueue(store, activeTargetQueue);
            writeSchedulerState(store, {
                targetQueue: publicTargetQueue(savedQueue || activeTargetQueue)
            });
        }

        runAgentOnlyInBackground({
            store,
            run,
            agentTask,
            selected,
            quota,
            payload,
            config,
            agentOnly,
            promptTranslatorConfig: winkyConfig
        });

        if (logger && typeof logger.info === 'function') {
            logger.info(`自动创意 ${agentOnly ? 'Agent-only' : 'Legil run-once'} 已启动: ${runId}，方向: ${selected.direction.path}`);
        }

        return {
            success: true,
            message: agentOnly
                ? '运行一次自动创意已启动（agentOnly，不调用 Legil）'
                : `运行一次自动创意已启动，将在 Prompt Gate 后调用 Legil ${normalizeAutoBrowserMode(config.browserMode)} 生图`,
            run
        };
    }

    return {
        continueRunToLegil,
        getRun,
        getStatus,
        pauseRun,
        resumeRun,
        runOnce
    };
}

module.exports = {
    DEFAULT_AUTO_CONFIG,
    createCreativeAutoService
};
