const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const { buildDefaultConfig } = require('../creative-knowledge');
const { CreativeKnowledgeStore } = require('../creative-knowledge/store');
const { emptyCreativeMemory, getActiveMemoryRules } = require('../creative-knowledge/feedback-learning');
const {
    DIRECTION_TAGS_FILE,
    buildDirectionTagsIndex,
    directionMatchKey,
    emptyDirectionTags,
    normalizeDirectionTagsForRecord
} = require('../direction-tags');
const { selectNextDirection } = require('./direction-selector');
const {
    applyPromptGate,
    buildForbiddenTerms,
    collectHistoricalCreativeUsage,
    summarizeHistoricalCreativeUsage
} = require('./prompt-gate');
const {
    buildDirectionPlanConfig,
    selectDirectionExtensions,
    selectDirectionPlanExtensions
} = require('./direction-plan-gate');
const {
    PROMPT_SCHEMA_VERSION,
    TRANSLATION_AGENT_NAME,
    TRANSLATION_VERSION,
    buildDirectionDefinitions
} = require('./prompt-translator');
const {
    buildStyleInstruction,
    CREATIVE_PROMPT_STYLE_DEFAULT,
    getCreativePromptStyle,
    normalizeCreativePromptStyle
} = require('./prompt-style');
const { registerRunAssets } = require('./assets');
const {
    buildCreativeOutputNamingContext
} = require('../output-naming/creative-output-naming');
const {
    extractDirectionPlansFromText,
    flattenDirectionPlansToPromptItems,
    isWinkyTimeoutError
} = require('../../../creative-agent-service');

const DEFAULT_AUTO_CONFIG = {
    mode: 'run-once',
    maxDirectionsPerRun: 1,
    newDirectionsPerSource: 4,
    promptsPerNewDirection: 2,
    directionPlanning: {
        enabled: true,
        candidateExtensionsPerSource: 8,
        selectedExtensionsPerSource: 4,
        promptsPerExtension: 2,
        minScore: 70,
        preferredScore: 85,
        maxRepairAttempts: 2,
        diversityMode: 'balanced',
        historyScope: 'recent30',
        candidateMultiplier: 2
    },
    maxPromptsPerRun: 250,
    legilSmokeMaxPrompts: 5,
    outputQuantity: 4,
    maxImagesPerRun: 100,
    maxImagesPerDay: 1000,
    browserMode: 'headed',
    creativePromptStyle: CREATIVE_PROMPT_STYLE_DEFAULT,
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
const DIRECTION_EXPANSION_HISTORY_FILE = 'direction-expansion-history.json';
const DIRECTION_EXPANSION_HISTORY_MAX_ITEMS = 2000;
const CREATIVE_DIVERSITY_AXIS_POOL = [
    { key: 'subject-action', label: 'Change the subject-action relationship', options: ['rescue handoff', 'resource contest', 'hidden discovery', 'evacuation countdown', 'repair restart', 'escort through danger'] },
    { key: 'visual-hook', label: 'Change the visible hook', options: ['foreground prop reveal', 'split-second choice', 'warm light target', 'broken ice obstacle', 'signal flare clue', 'scarce reward container'] },
    { key: 'camera', label: 'Change camera and composition', options: ['low-angle close foreground', 'top-down map-like view', 'over-shoulder pursuit', 'wide landmark scale', 'macro prop with human stakes', 'diagonal motion path'] },
    { key: 'emotion', label: 'Change emotional tension', options: ['urgent hope', 'moral tradeoff', 'surprise reward', 'protective teamwork', 'last chance pressure', 'comic relief under danger'] },
    { key: 'scene-mechanism', label: 'Change scene mechanism', options: ['blocked entrance', 'collapsing shelter', 'frozen vehicle route', 'abandoned clinic', 'temporary bridge', 'storm shelter queue'] }
];
const VISUAL_DNA_GAP_POOL = {
    atmosphere: ['紧张危机', '史诗壮阔', '温暖希望', '神秘未知', '荒凉孤独'],
    camera: ['第一人称', '俯瞰', '平视', '低机位', '近景物件'],
    event: ['撤离', '发现', '求救', '护送', '争夺', '修复'],
    visualHook: ['巨型地标', '近景物件', '暖光目标', '信号灯', '补给箱']
};
const DEFAULT_LEGIL_MIN_WAIT_MS = 60 * 60 * 1000;
const DEFAULT_LEGIL_PER_PROMPT_WAIT_MS = 15 * 60 * 1000;
const STALE_RUNNING_RECONCILE_GRACE_MS = 5 * 60 * 1000;
const TARGET_QUEUE_PREFETCH_MAX_ATTEMPTS = 3;
const TARGET_QUEUE_PREFETCH_RETRY_DELAY_MS = 1000;
const TARGET_QUEUE_PREFETCH_WAIT_MS = 2000;
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

function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
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
    const prefixedDirectionIds = [singleTarget.id, singleTarget.targetId]
        .map(value => String(value || ''))
        .filter(value => value.startsWith('direction:'))
        .map(value => value.replace(/^direction:/, ''));
    const targetDirectionIds = uniqueStrings(singleTarget.directionIds)
        .concat(uniqueStrings([
            singleTarget.directionId,
            singleTarget.sourceDirectionId,
            ...prefixedDirectionIds
        ]))
        .filter(Boolean);
    const directionId = targetDirectionIds[0] || '';
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

    if (directionId) {
        nextPayload.directionId = directionId;
        nextPayload.directionIds = [directionId];
    } else {
        delete nextPayload.directionId;
        delete nextPayload.directionIds;
    }
    nextPayload.targetSelection = {
        type: singleTarget.targetType === 'top100-material' ? 'material' : (singleTarget.type || 'direction'),
        level: singleTarget.level || '',
        label: singleTarget.label || singleTarget.sourceDirectionName || directionPath || materialName,
        path: directionPath || singleTarget.path || '',
        directionIds: directionId ? [directionId] : [],
        targetId: singleTarget.targetId || singleTarget.id || '',
        queueId,
        index: index + 1,
        total
    };
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

function visualDnaValues(value) {
    if (Array.isArray(value)) return value.flatMap(item => visualDnaValues(item));
    if (value && typeof value === 'object') {
        return [value.value, value.label, value.name, value.text].flatMap(item => visualDnaValues(item));
    }
    return String(value || '')
        .split(/[、，；;,|/]+/)
        .map(normalizeText)
        .filter(Boolean);
}

function getVisualDnaAliasValue(object = {}, aliases = []) {
    if (!object || typeof object !== 'object') return [];
    return aliases.flatMap(alias => visualDnaValues(object[alias]));
}

function addVisualDnaCount(map, value, weight = 1, source = {}) {
    visualDnaValues(value).forEach(item => {
        const key = normalizePathKey(item);
        if (!key) return;
        const current = map.get(key) || {
            value: item,
            count: 0,
            sources: []
        };
        current.count += weight;
        if (source.type || source.id || source.label) {
            current.sources.push(source);
        }
        map.set(key, current);
    });
}

function topVisualDnaCounts(map, limit = 5) {
    return Array.from(map.values())
        .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value, 'zh-CN'))
        .slice(0, limit)
        .map(item => ({
            value: item.value,
            count: item.count,
            sources: item.sources.slice(0, 4)
        }));
}

function directionRecordMatchesSelected(direction = {}, record = {}) {
    if (!direction || !record) return false;
    const directionId = normalizeText(direction.id);
    const idFields = [
        record.directionId,
        record.targetDirectionId,
        record.sourceDirectionId,
        record.matchedDirectionId
    ].map(normalizeText).filter(Boolean);
    if (directionId && idFields.includes(directionId)) return true;

    const directionPath = normalizePathKey(directionDisplayPath(direction) || direction.name || direction.id);
    const recordPath = normalizePathKey(
        record.directionPath ||
        record.targetDirectionPath ||
        record.sourceDirectionPath ||
        record.path ||
        record.referenceDirection ||
        record.directionKey ||
        record.target ||
        record.scope && record.scope.target
    );
    const recordName = normalizePathKey(record.name || record.newDirectionName || record.extensionName || record.targetDirectionName);
    if (!directionPath) return false;
    return Boolean(recordPath && (directionPath === recordPath || directionPath.includes(recordPath) || recordPath.includes(directionPath)))
        || Boolean(recordName && directionPath.includes(recordName));
}

function addVisualDnaFromRecord(accumulator, record = {}, options = {}) {
    if (!record || typeof record !== 'object') return;
    const source = {
        type: options.type || '',
        id: options.id || record.id || record.feedbackId || record.evidenceId || record.runId || '',
        label: options.label || record.path || record.directionPath || record.sourceDirectionPath || record.name || record.newDirectionName || ''
    };
    const weight = Number(options.weight) || 1;
    const visualDna = record.visualDna && typeof record.visualDna === 'object' ? record.visualDna : {};
    const dimensions = record.dimensions && typeof record.dimensions === 'object' ? record.dimensions : {};
    const inferred = inferDirectionDimensionLabels({
        ...record,
        description: [
            record.description,
            record.visualHook,
            record.productionAdvice,
            record.prompt,
            record.finalPrompt,
            record.note,
            record.comment
        ].filter(Boolean).join(' ')
    });

    addVisualDnaCount(accumulator.atmosphere, getVisualDnaAliasValue(visualDna, ['atmosphere', 'mood', '氛围', '情绪']), weight, source);
    addVisualDnaCount(accumulator.atmosphere, getVisualDnaAliasValue(dimensions, ['atmosphere', 'mood', 'tone', '氛围']), weight, source);
    addVisualDnaCount(accumulator.atmosphere, inferred.mood, Math.max(1, weight - 0.25), source);

    addVisualDnaCount(accumulator.camera, getVisualDnaAliasValue(visualDna, ['camera', 'perspective', 'view', 'angle', '视角', '镜头']), weight, source);
    addVisualDnaCount(accumulator.camera, getVisualDnaAliasValue(dimensions, ['camera', 'perspective', 'view', 'angle', 'shot', '视角']), weight, source);
    addVisualDnaCount(accumulator.camera, inferred.perspective, Math.max(1, weight - 0.25), source);

    addVisualDnaCount(accumulator.event, getVisualDnaAliasValue(visualDna, ['event', 'narrative', 'action', '事件', '叙事', '动作']), weight, source);
    addVisualDnaCount(accumulator.event, getVisualDnaAliasValue(dimensions, ['event', 'narrative', 'action', 'moment', '事件', '叙事']), weight, source);
    addVisualDnaCount(accumulator.event, inferred.narrative, Math.max(1, weight - 0.25), source);

    addVisualDnaCount(accumulator.visualHook, getVisualDnaAliasValue(visualDna, ['visualHook', 'hook', '钩子', '视觉钩子']), weight, source);
    addVisualDnaCount(accumulator.visualHook, getVisualDnaAliasValue(dimensions, ['visualHook', 'hook', 'pictureHook', '钩子']), weight, source);
    addVisualDnaCount(accumulator.visualHook, record.visualHook || record.hook || record.pictureHook, weight, source);

    addVisualDnaCount(accumulator.risks, record.riskNote || record.duplicateRisk || record.mustAvoid || record.avoid || record.note, Math.max(1, weight - 0.5), source);
}

function readRecentRunsForVisualDna(store, currentRunId = '', limit = 40) {
    const runsDir = store.filePath('runs');
    if (!fs.existsSync(runsDir)) return [];
    return fs.readdirSync(runsDir)
        .filter(fileName => fileName.endsWith('.json'))
        .filter(fileName => fileName !== `${currentRunId}.json`)
        .map(fileName => {
            try {
                return JSON.parse(fs.readFileSync(path.join(runsDir, fileName), 'utf8'));
            } catch {
                return null;
            }
        })
        .filter(Boolean)
        .sort((a, b) => new Date(b.startedAt || b.createdAt || 0).getTime() - new Date(a.startedAt || a.createdAt || 0).getTime())
        .slice(0, limit);
}

function collectMemoryRuleRecords(memory = {}) {
    return safeArray(memory.rules)
        .concat(safeArray(memory.globalRules))
        .concat(safeArray(memory.nodeRules))
        .concat(safeArray(memory.dimensionRules))
        .concat(safeArray(memory.items));
}

function buildVisualDnaPreferenceContext({ store, selectedDirection = {}, directions = [], currentRunId = '' }) {
    const accumulator = {
        atmosphere: new Map(),
        camera: new Map(),
        event: new Map(),
        visualHook: new Map(),
        risks: new Map()
    };
    const evidenceSources = [];
    const addRecord = (record, options = {}) => {
        addVisualDnaFromRecord(accumulator, record, options);
        evidenceSources.push({
            type: options.type || '',
            id: options.id || record.id || record.feedbackId || record.runId || '',
            label: options.label || record.path || record.name || record.newDirectionName || ''
        });
    };

    addRecord(selectedDirection, { type: 'directions', id: selectedDirection.id || '', label: directionDisplayPath(selectedDirection), weight: 1 });
    safeArray(directions)
        .filter(direction => sameDirectionIdentity(direction, selectedDirection))
        .forEach(direction => addRecord(direction, { type: 'directions', id: direction.id || '', label: directionDisplayPath(direction), weight: 1 }));

    safeArray(store.read('feedback.json', { feedback: [] }).feedback)
        .filter(feedback => directionRecordMatchesSelected(selectedDirection, feedback))
        .forEach(feedback => {
            const status = String(feedback.status || feedback.reviewStatus || '').toLowerCase();
            const isAccepted = ['good', 'normal', 'accepted', 'adopted'].includes(status);
            addRecord(feedback, {
                type: 'feedback',
                id: feedback.feedbackId || feedback.id || '',
                label: feedback.directionPath || feedback.targetDirectionPath || '',
                weight: isAccepted ? 3 : 1
            });
        });

    safeArray(store.read('direction-evidence.json', { evidence: [] }).evidence)
        .filter(entry => directionRecordMatchesSelected(selectedDirection, entry))
        .forEach(entry => addRecord(entry, {
            type: 'direction-evidence',
            id: entry.evidenceId || entry.id || '',
            label: entry.targetDirectionPath || entry.directionPath || '',
            weight: 3
        }));

    safeArray(store.read('direction-drafts.json', { drafts: [] }).drafts)
        .filter(draft => directionRecordMatchesSelected(selectedDirection, draft))
        .forEach(draft => addRecord(draft, {
            type: 'direction-drafts',
            id: draft.id || draft.draftId || '',
            label: draft.path || draft.name || '',
            weight: ['accepted', 'adopted', 'ready'].includes(String(draft.status || '').toLowerCase()) ? 2.5 : 1
        }));

    safeArray(readDirectionExpansionHistory(store).items)
        .filter(item => directionRecordMatchesSelected(selectedDirection, item))
        .forEach(item => addRecord(item, {
            type: 'direction-expansion-history',
            id: item.runId || item.dedupeKey || '',
            label: item.newDirectionName || item.extensionName || '',
            weight: 2
        }));

    readRecentRunsForVisualDna(store, currentRunId).forEach(run => {
        const runDirection = run.sourceDirection || {};
        if (!directionRecordMatchesSelected(selectedDirection, {
            sourceDirectionId: runDirection.id,
            sourceDirectionPath: runDirection.path,
            sourceDirectionName: runDirection.name
        })) return;
        safeArray(run.directionPlanReport && run.directionPlanReport.selectedExtensions)
            .forEach(extension => addRecord(extension, {
                type: 'runs',
                id: run.runId || '',
                label: extension.name || extension.extensionName || '',
                weight: 1.5
            }));
    });

    collectMemoryRuleRecords(store.read('creative-memory.json', emptyCreativeMemory()))
        .filter(rule => directionRecordMatchesSelected(selectedDirection, rule) || directionRecordMatchesSelected(selectedDirection, rule.scope || {}))
        .forEach(rule => addRecord(rule, {
            type: 'creative-memory',
            id: rule.ruleId || rule.id || '',
            label: rule.title || '',
            weight: rule.type === 'avoid' ? 2 : 1
        }));

    const topValues = {
        atmosphere: topVisualDnaCounts(accumulator.atmosphere, 6),
        camera: topVisualDnaCounts(accumulator.camera, 6),
        event: topVisualDnaCounts(accumulator.event, 6),
        visualHook: topVisualDnaCounts(accumulator.visualHook, 6),
        risks: topVisualDnaCounts(accumulator.risks, 6)
    };
    const compact = {
        atmosphere: topValues.atmosphere.slice(0, 4).map(item => item.value),
        camera: topValues.camera.slice(0, 4).map(item => item.value),
        event: topValues.event.slice(0, 4).map(item => item.value),
        visualHook: topValues.visualHook.slice(0, 4).map(item => item.value),
        risks: topValues.risks.slice(0, 5).map(item => item.value)
    };
    const gaps = Object.fromEntries(Object.entries(VISUAL_DNA_GAP_POOL).map(([key, pool]) => [
        key,
        pool.filter(value => !safeArray(compact[key]).some(item => normalizePathKey(item) === normalizePathKey(value))).slice(0, 3)
    ]));
    return {
        version: 'creative-auto-visual-dna-preference-v1',
        directionId: selectedDirection.id || '',
        directionPath: directionDisplayPath(selectedDirection),
        evidenceCount: evidenceSources.length,
        sourceCount: evidenceSources.length,
        sources: evidenceSources.slice(0, 16),
        topValues,
        highAdoption: compact,
        atmosphere: compact.atmosphere,
        camera: compact.camera,
        event: compact.event,
        visualHook: compact.visualHook,
        risks: compact.risks,
        gaps
    };
}

function formatVisualDnaPreferenceContext(context = {}, compact = false) {
    if (!context || !context.evidenceCount) {
        return '';
    }
    const joinValues = (values, fallback = '暂无') => safeArray(values).filter(Boolean).slice(0, compact ? 3 : 5).join('、') || fallback;
    const gaps = Object.values(context.gaps || {})
        .flatMap(items => safeArray(items))
        .slice(0, compact ? 4 : 8);
    const lines = [
        compact ? '# Current Direction DNA' : '# 当前方向 DNA 偏好',
        `- 高频氛围：${joinValues(context.atmosphere)}`,
        `- 高频视角：${joinValues(context.camera)}`,
        `- 高采纳事件：${joinValues(context.event)}`,
        `- 视觉钩子：${joinValues(context.visualHook)}`,
        `- 高风险：${joinValues(context.risks)}`,
        `- 缺口：${joinValues(gaps)}`
    ];
    return lines.join('\n');
}

const DIRECTION_TAG_GAP_POOL = [
    '暖光目标',
    '物资补给',
    '信号线索',
    '地图线索',
    '入口目标',
    '救援目标',
    '撤离压力',
    '交易队列',
    '选择压力',
    '冰裂危机',
    '风雪压迫',
    '手部动作',
    '低机位',
    '俯瞰',
    '第一人称'
];

function addDirectionTagCount(map, value, weight = 1, source = '') {
    normalizeDirectionTagsForRecord({ directionTags: value }, { limit: 12 }).tags.forEach(tag => {
        const current = map.get(tag) || { value: tag, count: 0, score: 0, sources: [] };
        current.count += 1;
        current.score += weight;
        if (source && current.sources.length < 10) current.sources.push(source);
        map.set(tag, current);
    });
}

function addDirectionRiskTagCount(map, value, weight = 1, source = '') {
    normalizeDirectionTagsForRecord({ riskTags: value }, { riskLimit: 6 }).riskTags.forEach(tag => {
        const current = map.get(tag) || { value: tag, count: 0, score: 0, sources: [] };
        current.count += 1;
        current.score += weight;
        if (source && current.sources.length < 10) current.sources.push(source);
        map.set(tag, current);
    });
}

function topDirectionTagCounts(map, limit = 8) {
    return Array.from(map.values())
        .sort((a, b) => b.score - a.score || b.count - a.count || a.value.localeCompare(b.value))
        .slice(0, limit);
}

function directionTagComboKeyFromRecord(record = {}) {
    const tags = normalizeDirectionTagsForRecord(record, { limit: 5 }).tags;
    return tags.slice(0, 3).join('+');
}

function buildDirectionTagPreferenceContext({ store, selectedDirection = {}, directions = [], currentRunId = '', strategy = 'stable' }) {
    const tags = new Map();
    const risks = new Map();
    const combos = new Map();
    const sources = [];
    const addRecord = (record = {}, weight = 1, source = '') => {
        const normalized = normalizeDirectionTagsForRecord(record, { limit: 8, riskLimit: 6 });
        normalized.tags.forEach(tag => addDirectionTagCount(tags, tag, weight, source));
        normalized.riskTags.forEach(tag => addDirectionRiskTagCount(risks, tag, weight, source));
        const combo = directionTagComboKeyFromRecord(record);
        if (combo) {
            const current = combos.get(combo) || { value: combo, count: 0, score: 0 };
            current.count += 1;
            current.score += weight;
            combos.set(combo, current);
        }
        if (normalized.tags.length || normalized.riskTags.length) sources.push(source);
    };

    addRecord(selectedDirection, 1, 'direction');
    safeArray(directions)
        .filter(direction => sameDirectionIdentity(direction, selectedDirection))
        .forEach(direction => addRecord(direction, 1, 'direction'));
    safeArray(store.read('feedback.json', { feedback: [] }).feedback)
        .filter(feedback => directionRecordMatchesSelected(selectedDirection, feedback))
        .forEach(feedback => {
            const status = String(feedback.status || feedback.reviewStatus || '').toLowerCase();
            addRecord(feedback, ['good', 'normal', 'accepted', 'adopted'].includes(status) ? 4 : 1, 'feedback');
        });
    safeArray(store.read('direction-evidence.json', { evidence: [] }).evidence)
        .filter(entry => directionRecordMatchesSelected(selectedDirection, entry))
        .forEach(entry => addRecord(entry, 3, 'evidence'));
    safeArray(store.read('direction-drafts.json', { drafts: [] }).drafts)
        .filter(draft => directionRecordMatchesSelected(selectedDirection, draft))
        .forEach(draft => addRecord(draft, ['accepted', 'adopted', 'ready'].includes(String(draft.status || '').toLowerCase()) ? 3 : 1, 'draft'));
    safeArray(readDirectionExpansionHistory(store).items)
        .filter(item => directionRecordMatchesSelected(selectedDirection, item))
        .forEach(item => addRecord(item, 2, 'history'));
    readRecentRunsForVisualDna(store, currentRunId).forEach(run => {
        const runDirection = run.sourceDirection || {};
        if (!directionRecordMatchesSelected(selectedDirection, {
            sourceDirectionId: runDirection.id,
            sourceDirectionPath: runDirection.path,
            sourceDirectionName: runDirection.name
        })) return;
        safeArray(run.directionPlanReport && run.directionPlanReport.selectedExtensions)
            .forEach(extension => addRecord(extension, 1.5, 'run'));
    });

    const topTags = topDirectionTagCounts(tags, 12);
    const topRiskTags = topDirectionTagCounts(risks, 8);
    const repeatedCombos = topDirectionTagCounts(combos, 8).filter(item => item.count >= 2);
    const highTagValues = topTags.slice(0, 8).map(item => item.value);
    const gapTags = DIRECTION_TAG_GAP_POOL
        .filter(tag => !highTagValues.some(value => normalizePathKey(value) === normalizePathKey(tag)))
        .slice(0, 6);
    return {
        version: 'creative-auto-direction-tags-v1',
        strategy: ['explore', 'stable'].includes(strategy) ? strategy : 'stable',
        directionId: selectedDirection.id || '',
        directionPath: directionDisplayPath(selectedDirection),
        evidenceCount: sources.length,
        highTags: highTagValues,
        topTags,
        riskTags: topRiskTags.map(item => item.value),
        gapTags,
        repeatedCombos: repeatedCombos.map(item => item.value),
        sources: sources.slice(0, 20)
    };
}

function formatDirectionTagPreferenceContext(context = {}, compact = false) {
    if (!context || !context.evidenceCount) return '';
    const joinValues = (values, fallback = '暂无') => safeArray(values).filter(Boolean).slice(0, compact ? 4 : 8).join('、') || fallback;
    const strategyText = context.strategy === 'explore'
        ? '探索拓展：优先补缺口标签，同时保留 1-2 个高表现标签做锚点'
        : '稳定拓展：优先复用高表现标签，并替换动作/道具/空间形成安全变体';
    return [
        compact ? '# Direction Tags' : '# 当前方向标签偏好',
        `- 策略：${strategyText}`,
        `- 高表现标签：${joinValues(context.highTags)}`,
        `- 缺口标签：${joinValues(context.gapTags)}`,
        `- 避坑标签：${joinValues(context.riskTags)}`,
        `- 重复组合：${joinValues(context.repeatedCombos)}`
    ].join('\n');
}

function readDirectionExpansionHistory(store) {
    const data = store.read(DIRECTION_EXPANSION_HISTORY_FILE, {
        version: 1,
        items: []
    });
    return {
        version: 1,
        updatedAt: data.updatedAt || '',
        items: safeArray(data.items)
    };
}

function writeDirectionExpansionHistory(store, history) {
    const items = safeArray(history && history.items)
        .filter(item => item && typeof item === 'object')
        .slice(-DIRECTION_EXPANSION_HISTORY_MAX_ITEMS);
    store.write(DIRECTION_EXPANSION_HISTORY_FILE, {
        version: 1,
        updatedAt: new Date().toISOString(),
        items
    });
    return items;
}

function historyLimitFromScope(scope = 'recent30') {
    if (scope === 'recent10') return 10;
    if (scope === 'all') return DIRECTION_EXPANSION_HISTORY_MAX_ITEMS;
    return 30;
}

function directionExpansionHistoryForSelected(store, selectedDirection = {}, scope = 'recent30') {
    const history = readDirectionExpansionHistory(store);
    return history.items
        .filter(item => sampleMatchesDirectionIdentity(item, selectedDirection))
        .slice(-historyLimitFromScope(scope))
        .reverse();
}

function makeDirectionDedupeKey(item = {}) {
    return hashText([
        item.sourceDirectionId,
        item.sourceDirectionPath,
        item.newDirectionName || item.extensionName || item.name,
        item.visualHook,
        item.dedupeReason
    ].map(value => String(value || '').trim()).filter(Boolean).join('|'));
}

function seededIndex(seed, salt, length) {
    if (!length) return 0;
    const hex = crypto.createHash('sha1').update(`${seed}:${salt}`).digest('hex').slice(0, 8);
    return parseInt(hex, 16) % length;
}

function buildCreativeDiversityAxes(seed = '', mode = 'balanced') {
    const count = mode === 'stable' ? 2 : (mode === 'explore' ? 4 : 3);
    return CREATIVE_DIVERSITY_AXIS_POOL
        .map((axis, index) => {
            const option = axis.options[seededIndex(seed, `${axis.key}:${index}`, axis.options.length)];
            return {
                key: axis.key,
                label: axis.label,
                option
            };
        })
        .sort((left, right) => seededIndex(seed, left.key, 1000) - seededIndex(seed, right.key, 1000))
        .slice(0, count);
}

function normalizeDiversityMode(value) {
    return ['stable', 'balanced', 'explore'].includes(value) ? value : 'balanced';
}

function normalizeHistoryScope(value) {
    return ['recent10', 'recent30', 'all'].includes(value) ? value : 'recent30';
}

function buildDirectionDiversityContext({ store, selectedDirection = {}, payload = {}, config = {}, runId = '' } = {}) {
    const planConfig = buildDirectionPlanConfig(payload, config);
    const mode = normalizeDiversityMode(planConfig.diversityMode);
    const historyScope = normalizeHistoryScope(planConfig.historyScope);
    const seed = String(
        payload.runSeed ||
        (payload.directionPlanning && payload.directionPlanning.runSeed) ||
        runId ||
        `${todayKey()}-${crypto.randomBytes(3).toString('hex')}`
    );
    const history = directionExpansionHistoryForSelected(store, selectedDirection, historyScope);
    return {
        seed,
        mode,
        historyScope,
        candidateMultiplier: planConfig.candidateMultiplier,
        axes: buildCreativeDiversityAxes(`${seed}:${selectedDirection.id || selectedDirection.path || ''}`, mode),
        history
    };
}

function formatDirectionDiversityContext(context = null) {
    if (!context) return '';
    const axes = safeArray(context.axes);
    const history = safeArray(context.history).slice(0, 16);
    return [
        '# Direction diversity brief',
        `Run diversity seed: ${context.seed || ''}`,
        `Diversity mode: ${context.mode || 'balanced'}; history scope: ${context.historyScope || 'recent30'}; candidate multiplier: ${context.candidateMultiplier || 2}.`,
        axes.length
            ? [
                'Use these seeded exploration axes for this run:',
                ...axes.map((axis, index) => `${index + 1}. ${axis.label}: ${axis.option}`)
            ].join('\n')
            : '',
        history.length
            ? [
                'Previously selected extensions for this source direction. Avoid reusing their names, visual hooks, or subject-action mechanisms:',
                ...history.map((item, index) => `${index + 1}. ${item.newDirectionName || item.extensionName || item.name || ''}; hook=${item.visualHook || ''}; reason=${item.dedupeReason || ''}`)
            ].join('\n')
            : 'No dedicated expansion-history entries found for this source direction yet.',
        'Every selected new direction in this run must differ from the history and from the other candidates by at least two axes: subject-action, visual hook, camera/composition, emotional tension, scene mechanism, or reward/danger prop.'
    ].filter(Boolean).join('\n');
}

function appendDirectionExpansionHistory(store, { run = {}, selected = {}, directionPlanGate = null, diversityContext = null } = {}) {
    const selectedDirection = selected.direction || run.sourceDirection || {};
    const selectedExtensions = safeArray(directionPlanGate && directionPlanGate.selectedExtensions);
    if (!selectedExtensions.length) return [];

    const history = readDirectionExpansionHistory(store);
    const now = new Date().toISOString();
    const existingKeys = new Set(safeArray(history.items).map(makeDirectionDedupeKey).filter(Boolean));
    const additions = selectedExtensions.map(extension => {
        const entry = {
            runId: run.runId || '',
            createdAt: now,
            sourceDirectionId: extension.sourceDirectionId || selectedDirection.id || '',
            sourceDirectionPath: extension.sourceDirectionPath || selectedDirection.path || '',
            newDirectionName: extension.name || extension.extensionName || extension.newDirectionName || extension.direction || '',
            extensionName: extension.name || extension.extensionName || '',
            extensionKey: extension.extensionKey || '',
            visualHook: extension.visualHook || '',
            dedupeReason: extension.dedupeReason || '',
            description: extension.description || '',
            productionAdvice: extension.productionAdvice || '',
            score: Number(extension.score) || 0,
            diversitySeed: diversityContext && diversityContext.seed ? diversityContext.seed : '',
            diversityMode: diversityContext && diversityContext.mode ? diversityContext.mode : '',
            creativeAxes: safeArray(diversityContext && diversityContext.axes).map(axis => `${axis.key}:${axis.option}`)
        };
        return {
            ...entry,
            dedupeKey: makeDirectionDedupeKey(entry)
        };
    }).filter(entry => entry.dedupeKey && !existingKeys.has(entry.dedupeKey));

    if (!additions.length) return [];
    writeDirectionExpansionHistory(store, {
        items: history.items.concat(additions)
    });
    return additions;
}

function collectDirectionPlanHistoryUsage(store, run = {}, selected = {}, payload = {}, config = {}) {
    const planConfig = buildDirectionPlanConfig(payload, config);
    const selectedDirection = selected.direction || run.sourceDirection || {};
    const usage = collectHistoricalCreativeUsage(store, run.runId, {
        maxDirectionSamples: 160,
        maxPromptSamples: 120
    });
    usage.directionExpansionHistory = directionExpansionHistoryForSelected(store, selectedDirection, planConfig.historyScope);
    return usage;
}

function buildDirectionSystemContext({ directions = [], selected, store, currentRunId = '', tagStrategy = 'stable' }) {
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
    const visualDnaPreferenceContext = buildVisualDnaPreferenceContext({
        store,
        selectedDirection,
        directions,
        currentRunId
    });
    const directionTagPreferenceContext = buildDirectionTagPreferenceContext({
        store,
        selectedDirection,
        directions,
        currentRunId,
        strategy: tagStrategy
    });
    const exclusionContext = {
        existingDirectionNames: collectExistingDirectionsForExclusion(directions, selectedDirection, siblings),
        historicalPromptHashes: collectHistoricalPromptHashes(store, selectedDirection, currentRunId),
        historicalExpansionNames: directionExpansionHistoryForSelected(store, selectedDirection, 'recent30')
            .map(item => item.newDirectionName || item.extensionName || item.name)
            .filter(Boolean)
            .slice(0, 30),
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
        exclusionContext,
        visualDnaPreferenceContext,
        directionTagPreferenceContext
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

    function directionTagRecordForDirection(direction = {}, tagsIndex = new Map()) {
        const record = [
            direction.id,
            direction.path,
            direction.name
        ].map(normalizeText).filter(Boolean)
            .map(key => tagsIndex.get(key) || tagsIndex.get(directionMatchKey(key)))
            .find(Boolean) || {};
        const fallback = normalizeDirectionTagsForRecord(direction);
        return {
            directionTags: safeArray(record.tags).length ? safeArray(record.tags) : fallback.tags,
            riskTags: safeArray(record.riskTags).length ? safeArray(record.riskTags) : fallback.riskTags,
            directionTagSummary: {
                ...record,
                directionId: record.directionId || direction.id || '',
                path: record.path || direction.path || direction.name || '',
                name: record.name || direction.name || direction.path || '',
                tags: safeArray(record.tags).length ? safeArray(record.tags) : fallback.tags,
                riskTags: safeArray(record.riskTags).length ? safeArray(record.riskTags) : fallback.riskTags
            }
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
        const directionTagsData = store.read(DIRECTION_TAGS_FILE, emptyDirectionTags());
        const directionTagsIndex = buildDirectionTagsIndex(directionTagsData);
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
            directions: safeArray(directionData.directions).map(direction => ({
                ...direction,
                ...directionTagRecordForDirection(direction, directionTagsIndex)
            })),
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
        const reconciledRecoverableQueue = reconcileTargetQueueMismatches(store);
        const activeRun = syncLiveLegilRun(store, liveLegilTask, context) || (activeRunId ? getRun(activeRunId, context) : null);
        const latestRun = activeRun ? null : attachTargetQueueProgress(store, readRuns(store)[0] || null);
        const baseResumableRun = activeRun ? null : attachTargetQueueProgress(store, findResumableRun(store, knowledge.schedulerState));
        const baseRecoverableQueue = baseResumableRun ? targetQueueRecoverySummary(store, baseResumableRun) : null;
        const recoverableQueue = baseRecoverableQueue || (!baseResumableRun ? reconciledRecoverableQueue : null);
        const resumableRun = recoverableQueue && baseResumableRun
            ? {
                ...baseResumableRun,
                targetQueueProgress: recoverableQueue,
                targetQueue: {
                    ...(baseResumableRun.targetQueue || {}),
                    ...recoverableQueue
                }
            }
            : baseResumableRun;
        const schedulerQueue = knowledge.schedulerState && knowledge.schedulerState.targetQueue
            ? knowledge.schedulerState.targetQueue
            : null;
        const latestRunIsResumable = latestRun && (canResumeRun(latestRun) || canAdvanceTargetQueueFromRun(store, latestRun));
        const latestRunSupersedesResumable = latestRun && !latestRunIsResumable &&
            (!resumableRun || (latestRun.runId !== resumableRun.runId && runTimestamp(latestRun) > runTimestamp(resumableRun)));
        const visibleResumableRun = latestRunIsResumable ? latestRun : (latestRunSupersedesResumable ? null : resumableRun);
        const visibleLatestRun = activeRun ? null : (latestRunIsResumable ? null : (latestRunSupersedesResumable ? latestRun : (!resumableRun ? latestRun : null)));
        const visibleRun = activeRun || visibleResumableRun || visibleLatestRun || null;
        const visibleQueue = activeRun && activeRun.targetQueueProgress
            ? activeRun.targetQueueProgress
            : (visibleRun && visibleRun.targetQueueProgress
                ? visibleRun.targetQueueProgress
                : (recoverableQueue || (visibleResumableRun && visibleResumableRun.targetQueueProgress ? visibleResumableRun.targetQueueProgress : schedulerQueue)));

        return {
            success: true,
            status: activeRun ? 'running' : (visibleResumableRun ? 'idle' : (knowledge.schedulerState.status || 'idle')),
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
            recoverableQueue,
            legilTask: liveLegilTask ? publicLiveLegilTask(liveLegilTask) : null,
            activeRun,
            resumableRun: visibleResumableRun,
            latestRun: visibleLatestRun
        };
    }

    function compactDiagnosticsRun(run = null) {
        if (!run || !run.runId) return null;
        const legilResult = run.legilResult || {};
        const legilProgress = run.legilProgress || {};
        const assets = run.assets || {};
        const promptQualityReport = run.promptQualityReport || {};
        const sourceDirection = run.sourceDirection || {};
        const queue = run.targetQueueProgress || run.targetQueue || null;
        return {
            runId: run.runId || '',
            status: run.status || '',
            phase: run.phase || '',
            mode: run.mode || '',
            agentOnly: run.agentOnly === true,
            sourceDirection: {
                id: sourceDirection.id || '',
                path: sourceDirection.path || '',
                name: sourceDirection.name || ''
            },
            promptTotalRaw: Number(run.promptTotalRaw) || 0,
            promptTotal: Number(run.promptTotal) || 0,
            promptAccepted: Number(promptQualityReport.acceptedPromptCount) || Number(run.promptTotal) || 0,
            promptRejected: Number(promptQualityReport.rejectedPromptCount) || Number(run.promptTotalRejected) || 0,
            expectedImageTotal: Number(run.expectedImageTotal) || Number(promptQualityReport.expectedImageTotal) || 0,
            savedCount: Number(legilResult.savedCount) || Number(legilProgress.saved) || Number(assets.newAssetCount) || 0,
            failedCount: Number(legilResult.failedCount) || Number(legilProgress.failed) || 0,
            targetQueue: queue ? {
                queueId: queue.queueId || '',
                status: queue.queueStatus || queue.status || '',
                currentIndex: Number(queue.currentIndex) || 0,
                totalTargets: Number(queue.totalTargets) || 0,
                remainingTargets: Number(queue.remainingTargets) || 0
            } : null,
            createdAt: run.createdAt || '',
            startedAt: run.startedAt || '',
            completedAt: run.completedAt || '',
            updatedAt: run.updatedAt || run.completedAt || run.startedAt || run.createdAt || '',
            message: run.message || ''
        };
    }

    function compactDiagnosticsQueue(queue = null) {
        if (!queue) return null;
        const summary = queue.queueId && Array.isArray(queue.targets) ? publicTargetQueue(queue) : queue;
        if (!summary || !summary.queueId) return null;
        return {
            queueId: summary.queueId,
            status: summary.status || '',
            totalTargets: Number(summary.totalTargets) || 0,
            completedTargets: Number(summary.completedTargets) || 0,
            remainingTargets: Number(summary.remainingTargets) || 0,
            currentIndex: Number(summary.currentIndex) || 0,
            nextIndex: Number(summary.nextIndex) || 0,
            currentRunId: summary.currentRunId || '',
            lastRunId: summary.lastRunId || '',
            lastRunStatus: summary.lastRunStatus || '',
            lastRunPhase: summary.lastRunPhase || '',
            currentTargetId: summary.currentTargetId || '',
            currentTargetName: summary.currentTargetName || '',
            totalExpectedPromptCount: Number(summary.totalExpectedPromptCount) || 0,
            nextAction: summary.nextAction || '',
            startedAt: summary.startedAt || '',
            updatedAt: summary.updatedAt || ''
        };
    }

    function buildDiagnosticsReviewCounts(assets = []) {
        const counts = {
            unreviewed: 0,
            reviewed: 0,
            good: 0,
            normal: 0,
            bad: 0,
            rejected: 0
        };
        safeArray(assets).forEach(asset => {
            const status = String(asset.reviewStatus || (asset.review && asset.review.status) || 'unreviewed').trim().toLowerCase();
            const normalized = ['good', 'normal', 'bad', 'rejected'].includes(status) ? status : 'unreviewed';
            counts[normalized] = (counts[normalized] || 0) + 1;
            if (normalized !== 'unreviewed') {
                counts.reviewed += 1;
            }
        });
        return counts;
    }

    function buildDiagnosticsKnowledgeCounts(store, knowledge = {}, runs = []) {
        const assets = safeArray(store.read('assets.json', { assets: [] }).assets);
        const feedback = safeArray(store.read('feedback.json', { feedback: [] }).feedback);
        const drafts = safeArray(store.read('direction-drafts.json', { drafts: [] }).drafts);
        const evidence = safeArray(store.read('direction-evidence.json', { evidence: [] }).evidence);
        const materialLearnings = safeArray(store.read('material-learnings.json', { learnings: [] }).learnings);
        const reviewCounts = buildDiagnosticsReviewCounts(assets);
        const memory = knowledge.creativeMemory || emptyCreativeMemory();
        const activeRules = getActiveMemoryRules(memory);
        const queues = readTargetQueueState(store).queues;
        const completedRuns = runs.filter(run => run && run.status === 'completed');

        return {
            directions: safeArray(knowledge.directions).length,
            topMaterials: Number(knowledge.metadata && knowledge.metadata.counts && knowledge.metadata.counts.topMaterials) || 0,
            topMaterialInsights: safeArray(knowledge.insights).length || Number(knowledge.metadata && knowledge.metadata.counts && knowledge.metadata.counts.topMaterialInsights) || 0,
            referenceImages: safeArray(knowledge.referenceImages).length,
            assets: assets.length,
            assetsWithFiles: assets.filter(asset => asset && asset.filePath && fs.existsSync(asset.filePath)).length,
            unreviewedAssets: reviewCounts.unreviewed,
            reviewedAssets: reviewCounts.reviewed,
            feedback: feedback.length,
            directionDrafts: drafts.length,
            directionEvidence: evidence.length,
            materialLearnings: materialLearnings.length,
            activeMemoryRules: activeRules.length,
            learningReports: safeArray(memory.learningReports).length,
            runs: runs.length,
            completedRuns: completedRuns.length,
            savedImages: assets.length || runs.reduce((sum, run) => {
                const result = run.legilResult || {};
                const progress = run.legilProgress || {};
                const assetReport = run.assets || {};
                return sum + (Number(result.savedCount) || Number(progress.saved) || Number(assetReport.newAssetCount) || 0);
            }, 0),
            queues: safeArray(queues).length,
            pausedQueues: safeArray(queues).filter(queue => queue && queue.status === 'paused').length,
            runningQueues: safeArray(queues).filter(queue => queue && queue.status === 'running').length
        };
    }

    function findLatestTargetQueue(store) {
        return safeArray(readTargetQueueState(store).queues)
            .slice()
            .sort((a, b) => Date.parse(b.updatedAt || b.startedAt || '') - Date.parse(a.updatedAt || a.startedAt || ''))[0] || null;
    }

    function buildDiagnosticsPolicySummary(context = {}) {
        const creativeConfig = (context.appConfig && context.appConfig.creative) || {};
        return {
            stageLabel: 'L2 单轮自动',
            autonomyLevel: 'L2',
            loopMode: 'run-once',
            policyMode: 'baseline-readonly',
            riskLevel: 'normal',
            allowedActions: {
                analyze: true,
                generatePrompt: true,
                sendToLegil: true,
                autoCurate: false,
                autoChangePolicy: false,
                autoRollback: false
            },
            protectedTools: ['批量产图', '改尺寸', '素材分析', '任务方向池', '配置'],
            budget: {
                dailyImages: null,
                weeklyImages: null,
                maxLegilOccupancyMinutes: null,
                outputQuantity: Number(creativeConfig.generationSettings && creativeConfig.generationSettings.outputQuantity) || DEFAULT_AUTO_CONFIG.outputQuantity
            },
            updatedAt: new Date().toISOString()
        };
    }

    function buildDiagnosticsWarnings({ knowledge, preflight, schedulerState, targetQueue, legilResume, knowledgeCounts }) {
        const warnings = [];
        safeArray(knowledge.metadata && knowledge.metadata.warnings).slice(0, 12).forEach((message, index) => {
            warnings.push({
                severity: 'P1',
                code: `knowledge_warning_${index + 1}`,
                message,
                source: 'knowledge'
            });
        });
        safeArray(preflight.checks).forEach(check => {
            if (check.ok) return;
            warnings.push({
                severity: check.level === 'error' ? 'P0' : 'P1',
                code: `preflight_${check.id || 'check'}`,
                message: `${check.label || check.id || '预检'}未通过`,
                source: 'preflight',
                path: check.path || ''
            });
        });
        const daily = schedulerState.daily || {};
        if (daily.date && daily.date !== todayKey()) {
            warnings.push({
                severity: 'P1',
                code: 'scheduler_daily_stale',
                message: `scheduler-state daily 日期仍是 ${daily.date}，今日视图会按 ${todayKey()} 归零展示`,
                source: 'scheduler-state'
            });
        }
        if (targetQueue && targetQueue.status === 'paused' && Number(targetQueue.remainingTargets) > 0) {
            warnings.push({
                severity: 'P1',
                code: 'target_queue_paused',
                message: `目标队列暂停，剩余 ${targetQueue.remainingTargets} 个目标`,
                source: 'target-queue'
            });
        }
        if (legilResume && legilResume.hasResume) {
            warnings.push({
                severity: 'P1',
                code: 'legil_resume_available',
                message: `存在可继续的 Legil 创意任务，剩余 ${Number(legilResume.remainingCount) || 0} 条 prompt`,
                source: 'legil-resume'
            });
        }
        if (Number(knowledgeCounts.unreviewedAssets) > 0) {
            warnings.push({
                severity: Number(knowledgeCounts.unreviewedAssets) > 1000 ? 'P0' : 'P1',
                code: 'assets_unreviewed',
                message: `未评审资产 ${knowledgeCounts.unreviewedAssets} 条`,
                source: 'knowledge-assets'
            });
        }
        return warnings;
    }

    function getDiagnostics(context = {}) {
        const appConfig = context.appConfig || {};
        const knowledge = readKnowledge(context);
        const { store } = getKnowledgeStore(context);
        store.ensureBase();

        const schedulerState = store.read('scheduler-state.json', {
            version: 1,
            status: 'idle',
            consecutiveFailures: 0,
            daily: {
                date: todayKey(),
                imageCount: 0,
                imageLimit: DEFAULT_AUTO_CONFIG.maxImagesPerDay
            },
            updatedAt: ''
        });
        const runs = readRuns(store);
        const activeRun = activeRunId ? getRun(activeRunId, context) : null;
        const lastRun = activeRun || runs[0] || null;
        const liveLegilTask = getLiveCreativeLegilTask();
        const latestQueue = findLatestTargetQueue(store);
        const targetQueue = compactDiagnosticsQueue(
            (activeRun && (activeRun.targetQueueProgress || activeRun.targetQueue)) ||
            schedulerState.targetQueue ||
            latestQueue
        );
        const legilResume = typeof options.getCreativeResumeInfo === 'function'
            ? options.getCreativeResumeInfo(false)
            : { hasResume: false };
        const preflight = buildPreflight(appConfig, knowledge);
        const knowledgeCounts = buildDiagnosticsKnowledgeCounts(store, knowledge, runs);
        const policySummary = buildDiagnosticsPolicySummary(context);
        const warnings = buildDiagnosticsWarnings({
            knowledge,
            preflight,
            schedulerState,
            targetQueue,
            legilResume,
            knowledgeCounts
        });

        return {
            success: true,
            schemaVersion: 1,
            generatedAt: new Date().toISOString(),
            serviceStatus: {
                status: activeRun ? 'running' : (schedulerState.status || 'idle'),
                stageLabel: policySummary.stageLabel,
                mode: DEFAULT_AUTO_CONFIG.mode,
                activeRunId: activeRun && activeRun.runId ? activeRun.runId : '',
                currentRunId: schedulerState.currentRunId || '',
                currentAgentTaskRunId: schedulerState.currentAgentTaskRunId || '',
                lastRunId: schedulerState.lastRunId || (lastRun && lastRun.runId) || '',
                lastError: schedulerState.lastError || '',
                consecutiveFailures: Number(schedulerState.consecutiveFailures) || 0,
                legilRunning: Boolean(liveLegilTask && liveLegilTask.snapshot && liveLegilTask.snapshot.running === true),
                preflightOk: preflight.ok === true,
                updatedAt: schedulerState.updatedAt || ''
            },
            schedulerState,
            targetQueue,
            lastRun: compactDiagnosticsRun(lastRun),
            legilResume: {
                hasResume: legilResume && legilResume.hasResume === true,
                runId: legilResume && legilResume.runId || '',
                phase: legilResume && legilResume.phase || '',
                remainingCount: Number(legilResume && legilResume.remainingCount) || 0,
                completed: Number(legilResume && legilResume.completed) || 0,
                total: Number(legilResume && legilResume.total) || 0,
                updatedAt: legilResume && legilResume.updatedAt || ''
            },
            knowledgeCounts,
            policySummary,
            warnings
        };
    }

    function enrichDirectionCandidateTags(candidate = {}) {
        const fallback = normalizeDirectionTagsForRecord(candidate);
        return {
            ...candidate,
            directionTags: safeArray(candidate.directionTags).length ? safeArray(candidate.directionTags) : fallback.tags,
            riskTags: safeArray(candidate.riskTags).length ? safeArray(candidate.riskTags) : fallback.riskTags
        };
    }

    function enrichRunDirectionTags(run = null) {
        if (!run || typeof run !== 'object') return run;
        const next = { ...run };
        if (next.directionPlanReport && typeof next.directionPlanReport === 'object') {
            next.directionPlanReport = {
                ...next.directionPlanReport,
                selectedExtensions: safeArray(next.directionPlanReport.selectedExtensions).map(enrichDirectionCandidateTags),
                lowScoreSelectedExtensions: safeArray(next.directionPlanReport.lowScoreSelectedExtensions).map(enrichDirectionCandidateTags),
                rejectedExtensions: safeArray(next.directionPlanReport.rejectedExtensions).map(enrichDirectionCandidateTags)
            };
        }
        if (next.directionCandidateReview && typeof next.directionCandidateReview === 'object') {
            next.directionCandidateReview = {
                ...next.directionCandidateReview,
                selected: safeArray(next.directionCandidateReview.selected).map(enrichDirectionCandidateTags),
                rejected: safeArray(next.directionCandidateReview.rejected).map(enrichDirectionCandidateTags)
            };
        }
        return next;
    }

    function getRun(runId, context = {}) {
        const { store } = getKnowledgeStore(context);
        store.ensureBase();
        const id = path.basename(String(runId || ''));
        if (!id) {
            return null;
        }
        return attachTargetQueueProgress(store, enrichRunDirectionTags(store.read(path.join('runs', `${id}.json`), null)));
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
        let finalRun = updateRun(store, run.runId, {
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
        if (run.legilRetry && run.legilRetry.active && finalRun) {
            finalRun = updateRun(store, run.runId, appendLegilRetryFinalUpdates(run, {
                status: finalRun.status,
                phase: finalRun.phase,
                completedAt
            }, progress, finalRun.legilResult || {}, completedAt)) || finalRun;
        }

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

    function getRunFinalLegilProgress(run = {}) {
        const candidates = [
            run.legilProgress,
            run.legilTask && run.legilTask.progress,
            run.legilTask && run.legilTask.lastSnapshot && run.legilTask.lastSnapshot.progress
        ];
        return candidates.find(progress => progress && isFinalLegilPhase(progress.phase)) || null;
    }

    function legilSnapshotMatchesRun(snapshot = null, run = {}, progress = null) {
        if (!run || !run.runId) return false;
        const snapshotProgress = progress || (snapshot && snapshot.progress) || {};
        const snapshotRunId = String(snapshotProgress.creativeAutoRunId || '').trim();
        const taskRunId = String(run.legilTask && run.legilTask.runId || '').trim();
        if (snapshotRunId && snapshotRunId !== run.runId) return false;
        if (!snapshotRunId && taskRunId && taskRunId !== run.runId) return false;
        return Boolean(snapshotRunId || taskRunId || getRunFinalLegilProgress(run));
    }

    function reconcileFinalLegilRun(store, run = {}, snapshot = null) {
        if (!run || !run.runId || run.status !== 'running' || !isLegilRunPhase(run.phase)) {
            return run;
        }

        const snapshotProgress = snapshot && snapshot.progress ? snapshot.progress : null;
        const progress = snapshotProgress && isFinalLegilPhase(snapshotProgress.phase)
            ? snapshotProgress
            : getRunFinalLegilProgress(run);
        if (!progress || !isFinalLegilPhase(progress.phase)) {
            return run;
        }
        if (snapshot && snapshot.running === true) {
            return run;
        }
        if (!legilSnapshotMatchesRun(snapshot, run, progress)) {
            return run;
        }

        if (logger && typeof logger.warn === 'function') {
            logger.warn(`Reconciling stale creative-auto Legil final state: ${run.runId} / ${progress.phase}`);
        }
        return finalizeLiveLegilRun(store, run, progress, snapshot || (run.legilTask && run.legilTask.lastSnapshot) || null) || run;
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

    function runTimestamp(run = {}) {
        const value = Date.parse(run.updatedAt || run.completedAt || run.startedAt || run.createdAt || '');
        return Number.isFinite(value) ? value : 0;
    }

    function canResumeRun(run = {}) {
        if (!run || !run.runId) return false;
        if (run.status === 'paused') return true;
        return run.status === 'completed' && run.phase === 'agent_completed' && safeArray(run.prompts).length > 0;
    }

    function canAdvanceTargetQueueFromRun(store, run = {}) {
        if (!run || !run.runId || run.status !== 'completed' || !isLegilRunPhase(run.phase)) return false;
        if (!run.targetQueue || !run.targetQueue.queueId) return false;

        const queue = loadTargetQueue(store, run.targetQueue.queueId);
        if (!queue || queue.currentRunId !== run.runId) return false;

        const targetIndex = Math.max(0, Number(run.targetQueue.index) ? Number(run.targetQueue.index) - 1 : Number(queue.currentIndex) || 0);
        if (queue.status === 'completed') {
            const totalTargets = Number(queue.totalTargets) || safeArray(queue.targets).length;
            const completedTargets = safeArray(queue.completedTargetIds).length;
            const skippedTargets = safeArray(queue.skippedTargets).length || safeArray(queue.skippedTargetIds).length || safeArray(queue.skippedTargetIndexes).length;
            if (totalTargets > 0 && completedTargets + skippedTargets >= totalTargets) {
                return false;
            }
        }
        return targetIndex + 1 < safeArray(queue.targets).length;
    }

    function targetQueueRecoverySummary(store, run = {}) {
        if (!canAdvanceTargetQueueFromRun(store, run)) return null;

        const queue = loadTargetQueue(store, run.targetQueue.queueId);
        const summary = publicTargetQueue(queue);
        if (!summary) return null;

        return {
            ...summary,
            nextAction: 'advance_next_target',
            recoverableRunId: run.runId,
            lastRunStatus: run.status || '',
            lastRunPhase: run.phase || ''
        };
    }

    function reconcileTargetQueueMismatches(store) {
        const state = readTargetQueueState(store);
        let recoverableQueue = null;
        let changed = false;
        const queues = state.queues.map(queue => {
            if (!queue || !queue.queueId || !queue.currentRunId || !['running', 'paused', 'completed'].includes(String(queue.status || ''))) {
                return queue;
            }

            const runId = path.basename(String(queue.currentRunId || ''));
            const run = store.read(path.join('runs', `${runId}.json`), null);
            if (!canAdvanceTargetQueueFromRun(store, run)) {
                return queue;
            }

            const nextQueue = {
                ...queue,
                status: queue.status === 'completed' ? 'paused' : queue.status,
                nextAction: 'advance_next_target',
                recoverableRunId: run.runId,
                lastRunId: run.runId,
                lastRunStatus: run.status || '',
                lastRunPhase: run.phase || ''
            };
            changed = true;
            recoverableQueue = {
                ...publicTargetQueue(nextQueue),
                nextAction: 'advance_next_target',
                recoverableRunId: run.runId,
                lastRunStatus: run.status || '',
                lastRunPhase: run.phase || ''
            };
            return nextQueue;
        });

        if (changed) {
            writeTargetQueueState(store, {
                ...state,
                queues
            });
            if (recoverableQueue) {
                writeSchedulerState(store, {
                    status: 'idle',
                    currentRunId: null,
                    currentAgentTaskRunId: null,
                    currentLegilTask: null,
                    lastRunId: recoverableQueue.recoverableRunId,
                    targetQueue: recoverableQueue
                });
            }
        }

        return recoverableQueue;
    }

    function reconcileStaleRunningRun(store, run = {}) {
        if (!run || run.status !== 'running') {
            return run;
        }
        const finalLegilRun = reconcileFinalLegilRun(store, run);
        if (finalLegilRun && finalLegilRun.status !== 'running') {
            return finalLegilRun;
        }
        if (activeRunId === run.runId) {
            return run;
        }

        const phase = String(run.phase || '');
        const resumablePhase = isAgentRunningPhase(phase) || isLegilRunPhase(phase);
        if (!resumablePhase) {
            return run;
        }
        const lastTouchedAt = Date.parse(run.updatedAt || run.startedAt || run.createdAt || '');
        if (Number.isFinite(lastTouchedAt) && Date.now() - lastTouchedAt < STALE_RUNNING_RECONCILE_GRACE_MS) {
            return run;
        }
        if (isAgentRunningPhase(phase) && run.agentTaskRunId && typeof options.getCreativeAgentTask === 'function') {
            const agentTask = options.getCreativeAgentTask(run.agentTaskRunId);
            const publicTask = agentTask && typeof options.publicCreativeAgentTask === 'function'
                ? options.publicCreativeAgentTask(agentTask)
                : null;
            if (agentTask && (!publicTask || publicTask.running !== false)) {
                return {
                    ...run,
                    agentTask: publicTask || run.agentTask || null
                };
            }
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
            if (canResumeRun(run) || canAdvanceTargetQueueFromRun(store, run)) {
                return run;
            }
        }

        return readRuns(store)
            .map(run => reconcileStaleRunningRun(store, run))
            .find(run => canResumeRun(run) || canAdvanceTargetQueueFromRun(store, run)) || null;
    }

    function findBlockingRunningRun(store, schedulerState = {}) {
        const targetQueue = schedulerState && schedulerState.targetQueue ? schedulerState.targetQueue : null;
        const queueState = readTargetQueueState(store);
        const runningQueueRunIds = queueState.queues
            .filter(queue => queue && queue.status === 'running' && queue.currentRunId)
            .map(queue => queue.currentRunId);
        const candidateIds = uniqueStrings([
            activeRunId,
            schedulerState.currentRunId,
            targetQueue && targetQueue.currentRunId,
            ...runningQueueRunIds
        ]);

        for (const runId of candidateIds) {
            const run = reconcileStaleRunningRun(store, store.read(path.join('runs', `${path.basename(runId)}.json`), null));
            if (run && run.status === 'running') {
                return attachTargetQueueProgress(store, run);
            }
        }

        return null;
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
        const skippedTargets = safeArray(queue.skippedTargets).length || safeArray(queue.skippedTargetIds).length || safeArray(queue.skippedTargetIndexes).length;
        const processedTargets = Math.min(totalTargets, completedTargets + skippedTargets);
        const publicStatus = String(queue.status || 'running') === 'completed' && totalTargets > 0 && processedTargets < totalTargets
            ? 'paused'
            : (queue.status || 'running');
        const currentTarget = safeArray(queue.targets)[currentIndex] || null;
        return {
            queueId: queue.queueId,
            status: publicStatus,
            totalTargets,
            currentIndex: Math.min(totalTargets, currentIndex + 1),
            nextIndex,
            completedTargets,
            remainingTargets: Math.max(0, totalTargets - processedTargets),
            currentRunId: queue.currentRunId || '',
            lastRunId: queue.lastRunId || '',
            lastRunStatus: queue.lastRunStatus || '',
            lastRunPhase: queue.lastRunPhase || '',
            nextAction: queue.nextAction || '',
            nextPreparingRunId: queue.nextPreparingRunId || '',
            nextPreparedRunId: queue.nextPreparedRunId || '',
            nextPrepareIndex: Number.isFinite(Number(queue.nextPrepareIndex)) ? Number(queue.nextPrepareIndex) : null,
            nextPreparePhase: queue.nextPreparePhase || '',
            skippedTargets: safeArray(queue.skippedTargets),
            rawPromptCount: Number(queue.rawPromptCount) || 0,
            acceptedPromptCount: Number(queue.acceptedPromptCount) || 0,
            rejectedPromptCount: Number(queue.rejectedPromptCount) || 0,
            failedPromptCount: Number(queue.failedPromptCount) || 0,
            savedImageCount: Number(queue.savedImageCount) || 0,
            currentTargetId: currentTarget && (currentTarget.targetId || currentTarget.targetKey || currentTarget.sourceMaterialId || ''),
            currentTargetName: currentTarget && (currentTarget.sourceMaterialName || currentTarget.materialName || currentTarget.sourceDirectionPath || ''),
            totalExpectedPromptCount: Number(queue.totalExpectedPromptCount) || buildTargetQueueSummary(queue.targets).totalExpectedPromptCount,
            startedAt: queue.startedAt || '',
            updatedAt: queue.updatedAt || ''
        };
    }

    function targetQueueRunStatsFromRun(run = {}) {
        const result = run.legilResult || {};
        const progress = run.legilProgress || {};
        const report = run.promptQualityReport || {};
        const assets = run.assets || {};
        return {
            rawPromptCount: Number(run.promptTotalRaw) || Number(report.rawPromptCount) || 0,
            acceptedPromptCount: Number(report.acceptedPromptCount) || Number(run.promptTotal) || 0,
            rejectedPromptCount: Number(report.rejectedPromptCount) || Number(run.promptTotalRejected) || 0,
            failedPromptCount: Number(result.failedCount) || Number(progress.failed) || 0,
            savedImageCount: Number(result.savedCount) || Number(progress.saved) || Number(assets.newAssetCount) || 0,
            assetCount: Number(assets.newAssetCount) || 0
        };
    }

    function mergeTargetQueueRunStats(queue = {}, run = {}) {
        const runId = String(run.runId || '').trim();
        if (!runId) return {};
        const previousByRun = queue.runStatsById && typeof queue.runStatsById === 'object' ? queue.runStatsById : {};
        const previousStats = previousByRun[runId] || {};
        const nextStats = targetQueueRunStatsFromRun(run);
        const fields = [
            'rawPromptCount',
            'acceptedPromptCount',
            'rejectedPromptCount',
            'failedPromptCount',
            'savedImageCount',
            'assetCount'
        ];
        const updates = {
            runStatsById: {
                ...previousByRun,
                [runId]: nextStats
            }
        };
        fields.forEach(field => {
            const currentTotal = Number(queue[field]) || 0;
            const previousValue = Number(previousStats[field]) || 0;
            const nextValue = Number(nextStats[field]) || 0;
            updates[field] = Math.max(0, currentTotal - previousValue + nextValue);
        });
        return updates;
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
        const nextStatus = status === 'completed' && queue.status !== 'completed'
            ? 'running'
            : (status || run.status || queue.status);
        const updates = {
            status: nextStatus,
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
            Object.assign(updates, mergeTargetQueueRunStats(queue, run));
        }
        if (status === 'failed') {
            updates.failedRunIds = uniqueStrings(safeArray(queue.failedRunIds).concat([run.runId]));
        }
        return updateTargetQueue(store, queue.queueId, updates);
    }

    function targetQueueIndexFromRun(run = {}, queue = {}) {
        return Math.max(0, Number(run.targetQueue && run.targetQueue.index)
            ? Number(run.targetQueue.index) - 1
            : Number(queue.currentIndex) || 0);
    }

    function targetQueueTargetId(target = {}, index = 0) {
        return target.targetId || target.targetKey || target.sourceMaterialId || target.id || `target-${index + 1}`;
    }

    function skippedTargetIndexes(queue = {}) {
        const indexes = safeArray(queue.skippedTargetIndexes)
            .map(value => Number(value))
            .filter(Number.isFinite);
        safeArray(queue.skippedTargets).forEach(item => {
            const index = Number(item && item.index);
            if (Number.isFinite(index)) {
                indexes.push(index);
            }
        });
        return new Set(indexes);
    }

    function nextRunnableTargetIndex(queue = {}, startIndex = 0) {
        const targets = safeArray(queue.targets);
        const skipped = skippedTargetIndexes(queue);
        for (let index = Math.max(0, Number(startIndex) || 0); index < targets.length; index += 1) {
            if (!skipped.has(index)) {
                return index;
            }
        }
        return -1;
    }

    function queuePrefetchAttempt(queue = {}, index = 0) {
        const attempts = queue.prefetchAttemptsByIndex || {};
        return Math.max(0, Number(attempts[index]) || 0);
    }

    function clearQueuePrefetchFields(queue = {}, updates = {}) {
        return {
            ...queue,
            nextPreparingRunId: '',
            nextPreparedRunId: '',
            nextPrepareIndex: null,
            nextPreparePhase: '',
            nextPrepareError: '',
            nextPrepareAttempt: 0,
            ...updates
        };
    }

    function targetQueueContext(queue = {}) {
        return queue && queue.context && typeof queue.context === 'object' ? queue.context : {};
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
            .filter(image => {
                const status = String(image.status || (image.deleted ? 'deleted' : 'active')).trim().toLowerCase();
                if (status !== 'active' || image.deleted) return false;
                return safeArray(image.matchedDirectionIds).some(id => directionIds.includes(id)) || directionIds.includes(image.directionId);
            })
            .sort((a, b) => (Number(a.slot || a.sourceSlot) || 99) - (Number(b.slot || b.sourceSlot) || 99))
            .slice(0, 3)
            .map(image => ({
                id: image.id,
                fileName: image.fileName,
                relativePath: image.relativePath,
                filePath: image.filePath,
                slot: Number(image.slot || image.sourceSlot) || 0,
                roleTag: image.roleTag || '',
                useFor: image.useFor || '',
                visualNotes: image.visualNotes || ''
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
                `Fresh generation nonce: ${freshnessNonce}. Do not return cached output; generate fresh direction candidates for this run.`,
                'No prior new directions or generated prompts were found for this source direction. Still create fresh direction candidates and avoid generic template repetition.'
            ].join('\n');
        }

        return [
            '# Historical uniqueness guard',
            `Fresh generation nonce: ${freshnessNonce}. Do not return cached output; generate fresh direction candidates for this run.`,
            'The following items have already been expanded or generated for this source direction. This run must create brand-new newDirectionName values and brand-new visual mechanisms.',
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
        const historicalExpansionNames = safeArray(exclusionContext.historicalExpansionNames).slice(0, 30);
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

    function buildAgentInstruction({ selected, referenceImages, payload, config, quota, memoryRules = [], historicalCreativeContext = null, diversityContext = null }) {
        const direction = selected.direction;
        const insight = selected.topMaterialInsight || null;
        const aggregateTarget = selected.aggregateTarget || null;
        const creativeBrief = creativeBriefFromPayload(payload);
        const creativeBriefTargets = creativeBrief && Array.isArray(creativeBrief.creativeTargets)
            ? creativeBrief.creativeTargets
            : [];
        const instructionPlanConfig = buildDirectionPlanConfig(payload, config);
        const expansionTargets = creativeBriefTargets.map(target => {
            const newDirectionsPerSource = Math.max(1, Math.min(10, Math.floor(Number(target.newDirectionsPerSource) || 3)));
            const promptGroupsPerNewDirection = Math.max(1, Math.min(10, Math.floor(Number(target.promptGroupsPerNewDirection) || 4)));
            const candidateDirectionsPerSource = Math.max(
                newDirectionsPerSource,
                Math.min(30, Math.floor(Number(target.candidateDirectionsPerSource) || (newDirectionsPerSource * instructionPlanConfig.candidateMultiplier)))
            );
            return {
                ...target,
                newDirectionsPerSource,
                candidateDirectionsPerSource,
                promptGroupsPerNewDirection,
                expectedPromptCount: newDirectionsPerSource * promptGroupsPerNewDirection
            };
        });
        const totalNewDirectionCount = expansionTargets.reduce((sum, target) => sum + target.newDirectionsPerSource, 0);
        const totalCandidateDirectionCount = expansionTargets.reduce((sum, target) => sum + target.candidateDirectionsPerSource, 0);
        const totalExpectedPromptCount = expansionTargets.reduce((sum, target) => sum + target.expectedPromptCount, 0);
        const promptColumnCount = Math.max(5, ...expansionTargets.map(target => target.promptGroupsPerNewDirection));
        const promptHeaders = Array.from({ length: promptColumnCount }, (_, index) => `提示词${index + 1}`);
        const directionPlanConfig = instructionPlanConfig;
        const creativeBriefTargetText = creativeBriefTargets.length
            ? expansionTargets.map((target, index) => [
                `${index + 1}. 原始方向：${target.sourceDirectionPath || target.sourceDirectionKey || target.materialName || target.targetId || ''}`,
                `   任务：${target.task || `输出 ${target.newDirectionsPerSource || 3} 个新方向，每个新方向 ${target.promptGroupsPerNewDirection || 4} 组 Legil 提示词`}`,
                `   数量约束：先生成候选方向 ${target.candidateDirectionsPerSource} 个；筛选入选新方向 ${target.newDirectionsPerSource} 个；每个新方向 ${target.promptGroupsPerNewDirection} 条 prompt；本原始方向合计 ${target.expectedPromptCount} 条 prompt`,
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
        const compactAgentInstruction = payload.compactAgentInstruction === true;
        const diversityBrief = formatDirectionDiversityContext(diversityContext);
        const visualDnaBrief = formatVisualDnaPreferenceContext(
            selected.visualDnaPreferenceContext || (selected.directionSystemContext && selected.directionSystemContext.visualDnaPreferenceContext),
            compactAgentInstruction
        );
        const directionTagBrief = formatDirectionTagPreferenceContext(
            selected.directionTagPreferenceContext || (selected.directionSystemContext && selected.directionSystemContext.directionTagPreferenceContext),
            compactAgentInstruction
        );
        if (compactAgentInstruction) {
            const targetDirectionCount = Math.max(1, totalNewDirectionCount || directionPlanConfig.selectedExtensionsPerSource || DEFAULT_AUTO_CONFIG.newDirectionsPerSource);
            const promptsPerDirection = Math.max(1, expansionTargets[0]?.promptGroupsPerNewDirection || directionPlanConfig.promptsPerExtension || DEFAULT_AUTO_CONFIG.promptsPerNewDirection);
            const targetCandidateCount = Math.max(targetDirectionCount * 2, directionPlanConfig.candidateExtensionsPerSource || targetDirectionCount * 2);
            const targetText = expansionTargets.length
                ? expansionTargets.map((target, index) => [
                    `${index + 1}. sourcePath=${target.sourceDirectionPath || target.sourceDirectionKey || target.materialName || direction.path}`,
                    `newDirectionCount=${target.newDirectionsPerSource}`,
                    `candidateDirectionCount=${target.candidateDirectionsPerSource}`,
                    `promptsPerDirection=${target.promptGroupsPerNewDirection}`,
                    target.visualSummary || target.visualInsight ? `visualInsight=${target.visualSummary || target.visualInsight}` : ''
                ].filter(Boolean).join('; ')).join('\n')
                : `1. sourcePath=${direction.path}; newDirectionCount=${targetDirectionCount}; candidateDirectionCount=${targetCandidateCount}; promptsPerDirection=${promptsPerDirection}`;
            const referenceText = referenceImages.length
                ? referenceImages.slice(0, 3).map((image, index) => `ref${image.slot || index + 1}: ${[
                    image.roleTag || '',
                    image.useFor || '',
                    image.visualNotes || '',
                    image.relativePath || image.fileName
                ].filter(Boolean).join(' / ')}`).join('\n')
                : '';
            return [
                '# Creative Auto Fast Prompt Generation',
                'Return compact JSON only. No markdown. No table. No explanation.',
                'directionPlans is the primary output. Do not set directionPlans to [].',
                `For each source direction, generate a candidate pool of newDirectionCount * 2 extensions, then mirror only the best newDirectionCount items in candidateDirections.`,
                'Stage 1 is direction-only: do not generate promptPair, prompts, finalPrompt, or long image prompts.',
                '',
                `Source direction id: ${direction.id || ''}`,
                `Source direction path: ${direction.path || ''}`,
                `Source direction name: ${direction.name || ''}`,
                `Source description: ${direction.description || ''}`,
                diversityBrief,
                directionTagBrief,
                visualDnaBrief,
                insight ? `Top material signal: ${insight.pathKey || ''}; materialCount=${insight.materialCount || 0}; keywords=${safeArray(insight.keywords).slice(0, 8).join('/')}` : '',
                referenceText,
                '',
                '# Targets',
                targetText,
                '',
                '# Must Follow',
                '- Generate short direction candidates only; full Legil prompts will be generated after backend scoring.',
                '- Style: high quality 3D cartoon commercial game ad poster, frozen apocalypse survival world.',
                '- Each new direction must change at least two of: subject relationship, action mechanism, camera angle, scene structure, reward/danger prop, emotional hook.',
                '- Avoid real brands, large English text, cyber UI, mecha, laser screens, and pure scenery.',
                '- If text appears in the image, it must be short, readable Chinese.',
                constraints.length ? constraints.slice(0, 6).map(item => `- Avoid: ${item}`).join('\n') : '',
                '',
                '# JSON Schema',
                JSON.stringify({
                    directionPlans: [{
                        sourceDirectionPath: direction.path || '',
                        currentJudgment: 'short judgment',
                        exclusionSummary: 'what must be different from existing ideas',
                        extensions: [{
                            extensionKey: 'candidate-1',
                            extensionType: 'candidate',
                            name: 'specific event-based new direction name',
                            description: 'one sentence describing the visual mechanism',
                            visualHook: 'clear visible hook',
                            dimensions: {
                                mood: '',
                                perspective: '',
                                narrative: '',
                                hook: ''
                            },
                            dedupeReason: 'why this differs from existing directions',
                            riskNote: 'controllable production risk',
                            productionAdvice: 'how to make it readable'
                        }]
                    }],
                    candidateDirections: [{
                        type: 'new-direction',
                        sourcePath: direction.path || '',
                        targetLevel: 'L4',
                        label: '具体新方向名',
                        description: '一句话说明画面机制',
                        dimensions: {
                            mood: '',
                            perspective: '',
                            time: '',
                            narrative: '',
                            scale: '',
                            material: '',
                            subjectRelation: '',
                            hook: ''
                        },
                        duplicateRisk: 'low',
                        reason: '为什么值得生成'
                    }]
                }, null, 2),
                '',
                `Return exactly ${targetCandidateCount} directionPlans[].extensions[] candidates in total for this source direction unless Targets specify per-source candidateDirectionCount.`,
                `Return exactly ${targetDirectionCount} candidateDirections as the compatibility mirror of your best directions.`,
                `Do not include prompts in candidateDirections during stage 1; promptsPerDirection=${promptsPerDirection} is for the backend second stage.`,
                'Do not repeat the source direction name as a new direction label.',
                'Keep each direction candidate concise but visually complete.'
            ].filter(Boolean).join('\n');
        }
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
            diversityBrief,
            '',
            formatDirectionFocusContext(selected),
            '',
            directionTagBrief,
            '',
            visualDnaBrief,
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
            `提示词风格：${getCreativePromptStyle(config.creativePromptStyle).label}`,
            '比例、分辨率、输出数量只作为 Legil 参数使用，不要写进 prompt 文本。',
            buildStyleInstruction(config.creativePromptStyle),
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
            '只输出 JSON，不输出 Markdown 表格、Excel 表格、CSV 表格或任何 spreadsheet-ready 表格；JSON 顶层字段必须包含 directionPlans 和 candidateDirections。',
            `隐藏式方向规划：每个原始方向先生成 ${directionPlanConfig.candidateExtensionsPerSource} 个候选延展方向，后台会自动评分、去重和淘汰；不要要求人工预览或勾选。`,
            `第一阶段只生成短方向候选，不生成 promptPair、prompts、finalPrompt 或任何长生图提示词；入选后后台会单独进入第二阶段生成 prompt。`,
            `directionPlans 每一项必须包含 sourceDirectionPath、currentJudgment、exclusionSummary、extensions；extensions 默认 ${directionPlanConfig.candidateExtensionsPerSource} 个候选，每个 extension 必须包含 extensionKey、extensionType、name、description、visualHook、dimensions、dedupeReason、riskNote、productionAdvice；dimensions 至少包含 mood、perspective、narrative、hook。`,
            `candidateDirections 是兼容旧解析器的扁平字段，只放最终推荐延展方向即可；第一阶段不要在 candidateDirections 里写 prompts。`,
            'candidateDirections 每一项必须包含 type、sourcePath、targetLevel、label、description、dimensions、duplicateRisk、reason。dimensions 必须包含 mood、perspective、time、narrative、scale、material、subjectRelation、hook。',
            expansionTargets.length
                ? `本次必须逐个执行 creativeTargets：总计 ${expansionTargets.length} 个原始方向。每个原始方向先产候选延展池，再由后台自动筛选；最终推荐数量和 prompt 数参考 target 的“数量约束”。`
                : `默认后台候选 ${directionPlanConfig.candidateExtensionsPerSource} 个延展，自动入选 ${directionPlanConfig.selectedExtensionsPerSource} 个延展；入选后第二阶段再为每个延展生成 ${directionPlanConfig.promptsPerExtension} 条 prompt，最终约 ${directionPlanConfig.selectedExtensionsPerSource * directionPlanConfig.promptsPerExtension} 条 prompt。`,
            '新方向之间的差异要明显拉开，但不能脱离当前《无尽冬日》冰封末世、3D 卡通广告图、买量素材体系。至少在场景机制、人物关系、危机/奖励道具、镜头距离/角度中改变两项，禁止只改同义词或轻微换景。',
            '即使原始方向是“物品展示/静物展示”，每个新方向也必须至少绑定一个动态关系或行动机制，例如发现、争夺、护送、抢救、交换、撤离、守护或倒计时选择；不要只写物品静置特写。',
            '同一候选池内的新方向要有更大的画面差异：不同方向必须使用不同的动作节点、镜头景别、前景道具、空间位置或情绪冲突，同时保留该新方向的核心卖点和可读广告点击点。',
            '所有变化必须仍符合当前体系：冰雪末世求生、明确危险或奖励关系、主体动作清楚、商业级 3D 卡通游戏广告风格，不要漂移到无关题材、写实品牌、纯风景或无法转化的抽象画面。',
            expansionTargets.length
                ? '不要把一个原始方向改写成另一个方向；每一行“参考方向”必须填写对应 target 的原始方向路径。某个 target 只要求 3 条 prompt 时，不要为了填满表头硬补无效提示词。'
                : '',
            `最终 prompt 数量目标为入选后每个方向 ${directionPlanConfig.promptsPerExtension} 条，但第一阶段不要生成这些 prompt。`
        ];

        lines.push(
            '',
            '# Current Automation Contract',
            'Output JSON only for this run. Do not output Markdown tables, Excel tables, CSV tables, or spreadsheet-ready tables.',
            'The JSON top-level object must contain directionPlans and candidateDirections.',
            'Stage 1 is direction-only. Do not output promptPair, prompts, finalPrompt, or long image-generation prompts.',
            'directionPlans[].extensions[] must include name, description, visualHook, dimensions, dedupeReason, riskNote, and productionAdvice.',
            'directionPlans[].extensions[].dimensions should include mood, perspective, narrative, and hook so Direction Plan Gate can score visual DNA.',
            'Each candidateDirections item must contain: type, sourcePath, targetLevel, label, description, dimensions, duplicateRisk, reason.',
            'dimensions must include mood, perspective, time, narrative, scale, material, subjectRelation, hook.',
            '',
            '# Fast Response Contract',
            'Prefer a compact JSON response so the automation can continue quickly.',
            'Do not set directionPlans to []; directionPlans[].extensions[] is the primary candidate pool for scoring.',
            `DirectionPlans candidate target for this run is ${expansionTargets.length ? totalCandidateDirectionCount : directionPlanConfig.candidateExtensionsPerSource} extensions total; use each target's candidate count when creativeTargets are present.`,
            `candidateDirections is only a compatibility mirror of the best ${Math.max(1, totalNewDirectionCount || directionPlanConfig.selectedExtensionsPerSource)} directions; the backend will score directionPlans first.`,
            `Do not include prompts in candidateDirections; promptsPerDirection=${Math.max(1, expansionTargets[0]?.promptGroupsPerNewDirection || directionPlanConfig.promptsPerExtension)} is for the backend second stage.`,
            'Keep each direction candidate concise but visually complete.'
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

    function shouldUseMaxCompletionTokensForRepair(model = '') {
        return /\bgpt-5\b|\bo[134]\b|reasoning/i.test(String(model || ''));
    }

    function extractWinkyRepairText(data) {
        const choice = data && Array.isArray(data.choices) ? data.choices[0] : null;
        const message = choice && choice.message ? choice.message : {};
        const content = message.content !== undefined ? message.content : (choice && choice.text);
        if (Array.isArray(content)) {
            return content.map(part => {
                if (typeof part === 'string') return part;
                if (part && typeof part === 'object') {
                    return part.text || part.content || '';
                }
                return '';
            }).join('\n').trim();
        }
        return String(content || '').trim();
    }

    function buildRepairJsonPayload({ model, provider, messages, maxTokens = 9000, temperature = 0.62 }) {
        const payload = {
            model,
            messages,
            stream: false,
            response_format: { type: 'json_object' }
        };
        if (shouldUseMaxCompletionTokensForRepair(model)) {
            payload.max_completion_tokens = maxTokens;
        } else {
            payload.temperature = temperature;
            payload.max_tokens = maxTokens;
        }
        if (provider) {
            payload.provider = provider;
        }
        return payload;
    }

    async function callWinkyRepairJson({ winkyConfig = {}, messages = [], timeout = 10 * 60 * 1000 }) {
        if (!winkyConfig.apiKey || !winkyConfig.apiUrl || !winkyConfig.model) {
            throw new Error('Winky 修复调用缺少 API Key、API URL 或模型');
        }
        const client = options.axios || axios;
        const response = await client.post(
            winkyConfig.apiUrl,
            buildRepairJsonPayload({
                model: winkyConfig.model,
                provider: winkyConfig.provider,
                messages
            }),
            {
                timeout,
                headers: {
                    Authorization: `Bearer ${winkyConfig.apiKey}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        const text = extractWinkyRepairText(response && response.data);
        if (!text) {
            throw new Error('Winky 修复调用返回为空');
        }
        return text;
    }

    function compactRepairPromptItem(item = {}) {
        return {
            index: item.index || '',
            direction: item.newDirectionName || item.direction || item.extensionName || '',
            promptTitle: item.promptTitle || '',
            visualHook: item.visualHook || '',
            score: item.directionPlanScore || '',
            scoreSummary: item.directionPlanScoreSummary || ''
        };
    }

    const REPAIR_FORBIDDEN_TERM_REPLACEMENTS = {
        '真实品牌': '商标水印',
        '品牌 logo': '商标标识',
        '品牌logo': '商标标识',
        '强赛博': '过强科幻感',
        '高科技 UI': '科幻操作屏',
        '高科技UI': '科幻操作屏',
        '悬浮设备': '漂浮装置',
        '机甲': '重型装甲装置',
        '激光界面': '发光屏幕',
        '大面积英文': '复杂字母标语',
        '枪支': '危险道具',
        '重军事': '重型对抗',
        '军事': '对抗',
        '血腥': '不适画面',
        '过度血腥': '过度不适画面'
    };

    function escapeRegExp(value = '') {
        return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function sanitizeRepairForbiddenText(value = '', forbiddenTerms = []) {
        let text = String(value || '');
        safeArray(forbiddenTerms)
            .map(term => String(term || '').trim())
            .filter(Boolean)
            .sort((a, b) => b.length - a.length)
            .forEach(term => {
                const replacement = REPAIR_FORBIDDEN_TERM_REPLACEMENTS[term] || '风险元素';
                text = text.replace(new RegExp(escapeRegExp(term), 'g'), replacement);
            });
        Object.entries(REPAIR_FORBIDDEN_TERM_REPLACEMENTS).forEach(([term, replacement]) => {
            text = text.replace(new RegExp(escapeRegExp(term), 'g'), replacement);
        });
        return text.replace(/\s+/g, ' ').trim();
    }

    function buildRepairRiskPolicy(forbiddenTerms = []) {
        return [
            '最终 prompt 只描述应该出现在画面里的内容，不写“避免/不要/禁止”这类负面排除句。',
            '风险元素统一改写为安全表达：商标水印、复杂字母标语、科幻操作屏、重型装甲装置、危险道具、重型对抗、过度不适画面都不要作为画面主体出现。',
            `内部禁用词已重写为安全表达：${sanitizeRepairForbiddenText(safeArray(forbiddenTerms).join('、'), forbiddenTerms)}`
        ].join('\n');
    }

    function sanitizeRepairPromptItem(item = {}, forbiddenTerms = []) {
        const next = { ...item };
        ['prompt', 'finalPrompt', 'promptText', 'sourcePrompt'].forEach(key => {
            if (next[key]) {
                next[key] = sanitizeRepairForbiddenText(next[key], forbiddenTerms);
            }
        });
        ['direction', 'newDirectionName', 'contentTitle', 'outputNameBase', 'promptTitle'].forEach(key => {
            if (next[key]) {
                next[key] = sanitizeRepairForbiddenText(next[key], forbiddenTerms);
            }
        });
        return next;
    }

    function targetAcceptedPromptCount({ quota = {}, payload = {}, config = {} }) {
        const planConfig = buildDirectionPlanConfig(payload, config);
        const planTarget = Math.max(1, planConfig.selectedExtensionsPerSource * planConfig.promptsPerExtension);
        if (quota.unlimitedPrompts) {
            return planTarget;
        }
        const quotaMax = Math.max(0, Number(quota.maxPrompts) || 0);
        return quotaMax > 0 ? Math.max(1, Math.min(planTarget, quotaMax)) : planTarget;
    }

    function buildDirectionRepairMessages({ selected, payload, config, run, directionPlanReport, promptQualityReport, acceptedPrompts, targetPromptCount, attemptIndex, directionOnly = false }) {
        const direction = selected && selected.direction ? selected.direction : {};
        const planConfig = buildDirectionPlanConfig(payload, config);
        const forbiddenTerms = buildForbiddenTerms({
            direction,
            payload,
            config
        });
        const repairRiskPolicy = buildRepairRiskPolicy(forbiddenTerms);
        const acceptedNames = uniqueStrings(safeArray(acceptedPrompts).map(item => item.newDirectionName || item.direction || item.extensionName));
        const rejectedExtensions = safeArray(directionPlanReport && directionPlanReport.rejectedExtensions)
            .slice(0, 10)
            .map(item => ({
                ...item,
                name: sanitizeRepairForbiddenText(item.name, forbiddenTerms),
                extensionKey: sanitizeRepairForbiddenText(item.extensionKey, forbiddenTerms),
                reason: sanitizeRepairForbiddenText(item.reason, forbiddenTerms)
            }));
        const rejectedPrompts = safeArray(promptQualityReport && promptQualityReport.rejectedPrompts)
            .slice(0, 12)
            .map(item => ({
                direction: sanitizeRepairForbiddenText(item.newDirectionName || item.direction || '', forbiddenTerms),
                promptTitle: sanitizeRepairForbiddenText(item.promptTitle || '', forbiddenTerms),
                reason: item.reason || '',
                message: sanitizeRepairForbiddenText(item.message || '', forbiddenTerms)
            }));
        const acceptedCompact = safeArray(acceptedPrompts)
            .slice(0, 12)
            .map(item => sanitizeRepairPromptItem(compactRepairPromptItem(item), forbiddenTerms));
        const missingPromptCount = Math.max(0, targetPromptCount - safeArray(acceptedPrompts).length);

        const systemPrompt = [
            '你是自动创意修复 Agent，只负责为后台自动化补生成或重写失败的方向规划。',
            '只输出严格 JSON object，不要 Markdown，不要代码块，不要解释。',
            'JSON 顶层必须包含 directionPlans 和 candidateDirections。',
            directionOnly
                ? 'directionPlans[].extensions[] 必须包含 extensionKey、extensionType、name、description、visualHook、dimensions、dedupeReason、riskNote、productionAdvice；dimensions 至少包含 mood、perspective、narrative、hook；不要包含 promptPair。'
                : 'directionPlans[].extensions[] 必须包含 extensionKey、extensionType、name、description、visualHook、dimensions、dedupeReason、riskNote、productionAdvice、promptPair；dimensions 至少包含 mood、perspective、narrative、hook。',
            directionOnly
                ? '本轮是方向级修复：只补短方向候选，不要生成 promptPair、prompts、finalPrompt 或长生图提示词。'
                : `Each extension.promptPair must contain exactly ${planConfig.promptsPerExtension} complete Chinese prompts.`,
            directionOnly
                ? '入选方向的 prompt 会在第二阶段单独生成；这里请把 visualHook、dedupeReason、productionAdvice 写完整。'
                : '每个 promptPair 的条数必须跟当前 promptsPerExtension 一致，并包含 主题、画风、情绪氛围、画面内容、整体基调。',
            '不要复用已接受方向名，不要重复被淘汰方向的问题，不要输出抽象方向名。',
            '最终 prompt 字段只能写正向画面描述，不要写任何“避免/不要/禁止/不能出现”排除句，也不要复述风险词清单。'
        ].join('\n');
        const userPrompt = [
            '# 修复任务',
            `这是第 ${attemptIndex + 1} 轮自动修复。当前目标至少保留 ${targetPromptCount} 条 prompt，还缺 ${missingPromptCount} 条。`,
            directionOnly
                ? `请补生成 ${planConfig.candidateExtensionsPerSource} 个新的短候选延展方向，不要写 promptPair。`
                : `请补生成 ${Math.max(planConfig.selectedExtensionsPerSource, Math.ceil(missingPromptCount / Math.max(1, planConfig.promptsPerExtension)) + 2)} 个新的候选延展方向，每个延展 ${planConfig.promptsPerExtension} 条 promptPair。`,
            '',
            '# 当前原始方向',
            JSON.stringify({
                id: direction.id || '',
                path: direction.path || '',
                name: direction.name || '',
                description: direction.description || '',
                tags: [direction.primaryTag, direction.secondaryTag, direction.tertiaryTag, direction.subTag].filter(Boolean),
                mustKeep: direction.mustKeep || '',
                riskPolicy: repairRiskPolicy
            }, null, 2),
            '',
            '# 已接受内容，禁止复用或近似改写',
            JSON.stringify({
                acceptedNames,
                acceptedPrompts: acceptedCompact
            }, null, 2),
            '',
            '# Direction Plan Gate 淘汰原因',
            JSON.stringify({
                summary: directionPlanReport && directionPlanReport.summary,
                qualifiedExtensionCount: directionPlanReport && directionPlanReport.qualifiedExtensionCount,
                targetSelectedExtensionCount: directionPlanReport && directionPlanReport.targetSelectedExtensionCount,
                lowScoreSelectedExtensions: safeArray(directionPlanReport && directionPlanReport.lowScoreSelectedExtensions),
                rejectedExtensions
            }, null, 2),
            '',
            '# Prompt Gate 拒绝原因',
            JSON.stringify({
                rejectionSummary: promptQualityReport && promptQualityReport.rejectionSummary,
                rejectedPrompts
            }, null, 2),
            '',
            '# 输出要求',
            `0. This is direction-level repair: optimize or regenerate candidate extensions so at least ${planConfig.selectedExtensionsPerSource} directions score >= ${planConfig.minScore}. Do not merely add prompt text under weak directions.`,
            `0.1 Generate up to ${planConfig.candidateExtensionsPerSource} candidate extensions if needed; the backend will select the best ${planConfig.selectedExtensionsPerSource}.`,
            directionOnly ? '0.2 Direction-only repair: do not output promptPair/prompts/finalPrompt in this round.' : '',
            '1. 只补新候选，不要重复已接受方向名。',
            '2. 方向名称必须具体到一个可见事件，不要写“氛围感/主题拓展/高级感”。',
            '3. 每个 extension 必须写清 visualHook 和 dedupeReason。',
            directionOnly
                ? '4. 第一阶段只写方向结构字段，不写 prompt 字段。'
                : '4. prompt 字段只写正向画面内容，不写风险排除句，不写禁用词字面量，不复述风险清单。',
            '5. 仍然保持冰封末世、资源稀缺、现实废土、高质量3D卡通商业广告海报风格。',
            '',
            '# 兼容字段',
            'candidateDirections 只放你认为最值得进入旧解析器的最终推荐延展。'
        ].join('\n');

        return [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ];
    }

    async function generateDirectionRepairPrompts({ selected, payload, config, run, directionPlanReport, promptQualityReport, acceptedPrompts, targetPromptCount, attemptIndex, winkyConfig, directionOnly = false }) {
        const startedAt = new Date().toISOString();
        const report = {
            attempt: attemptIndex + 1,
            startedAt,
            completedAt: '',
            success: false,
            generatedPromptCount: 0,
            directionPlanCount: 0,
            error: ''
        };
        try {
            const text = await callWinkyRepairJson({
                winkyConfig,
                messages: buildDirectionRepairMessages({
                    selected,
                    payload,
                    config,
                    run,
                    directionPlanReport,
                    promptQualityReport,
                    acceptedPrompts,
                    targetPromptCount,
                    attemptIndex,
                    directionOnly
                })
            });
            const directionPlans = extractDirectionPlansFromText(text);
            const forbiddenTerms = buildForbiddenTerms({
                direction: selected && selected.direction ? selected.direction : {},
                payload,
                config
            });
            const prompts = flattenDirectionPlansToPromptItems(directionPlans)
                .map((item, index) => ({
                    ...sanitizeRepairPromptItem(item, forbiddenTerms),
                    index: index + 1,
                    repairAttempt: attemptIndex + 1,
                    source: 'direction-plan-repair'
                }));
            report.completedAt = new Date().toISOString();
            report.success = prompts.length > 0 || directionPlans.length > 0;
            report.generatedPromptCount = prompts.length;
            report.directionPlanCount = directionPlans.length;
            return {
                prompts,
                directionPlans,
                rawText: text,
                report
            };
        } catch (error) {
            report.completedAt = new Date().toISOString();
            report.error = error.message || String(error);
            return {
                prompts: [],
                directionPlans: [],
                rawText: '',
                report
            };
        }
    }

    function compactDirectionExtensionForPromptStage(extension = {}) {
        const tagSummary = normalizeDirectionTagsForRecord(extension, { limit: 8, riskLimit: 6 });
        return {
            sourceDirectionId: extension.sourceDirectionId || '',
            sourceDirectionPath: extension.sourceDirectionPath || '',
            extensionKey: extension.extensionKey || '',
            extensionType: extension.extensionType || '',
            name: extension.name || extension.extensionName || extension.newDirectionName || '',
            description: extension.description || extension.extensionDescription || '',
            directionTags: safeArray(extension.directionTags).length ? safeArray(extension.directionTags) : tagSummary.tags,
            mainTags: safeArray(extension.mainTags),
            extraTags: safeArray(extension.extraTags),
            riskTags: safeArray(extension.riskTags).length ? safeArray(extension.riskTags) : tagSummary.riskTags,
            visualHook: extension.visualHook || '',
            dedupeReason: extension.dedupeReason || '',
            riskNote: extension.riskNote || '',
            productionAdvice: extension.productionAdvice || '',
            dimensions: extension.dimensions || {},
            directionPlanScore: extension.score || extension.directionPlanScore || '',
            directionPlanScoreSummary: extension.scoreSummary || extension.directionPlanScoreSummary || ''
        };
    }

    function directionReviewModeFromPayload(payload = {}, config = {}) {
        const value = normalizeText(
            (payload.directionReview && payload.directionReview.mode)
            || (payload.directionPlanning && payload.directionPlanning.reviewMode)
            || (config.directionPlanning && config.directionPlanning.reviewMode)
            || 'auto'
        ).toLowerCase();
        return value === 'manual' || value === 'human' ? 'manual' : 'auto';
    }

    function candidateReviewKey(candidate = {}, index = 0) {
        return normalizeText(candidate.reviewKey || candidate.extensionKey || candidate.name || candidate.newDirectionName || candidate.direction)
            || `candidate-${index + 1}`;
    }

    function normalizeReviewCandidate(candidate = {}, index = 0, status = 'selected') {
        const dimensions = candidate.dimensions && typeof candidate.dimensions === 'object' ? candidate.dimensions : {};
        const mainTags = safeArray(candidate.mainTags).map(normalizeText).filter(Boolean);
        const extraTags = safeArray(candidate.extraTags).map(normalizeText).filter(Boolean);
        const editedDirectionTags = mainTags.concat(extraTags);
        const tagSummary = normalizeDirectionTagsForRecord({
            ...candidate,
            directionTags: safeArray(candidate.directionTags).length
                ? candidate.directionTags
                : editedDirectionTags
        }, { limit: 8, riskLimit: 6 });
        const directionTags = safeArray(candidate.directionTags).length
            ? safeArray(candidate.directionTags).map(normalizeText).filter(Boolean)
            : (editedDirectionTags.length ? editedDirectionTags : tagSummary.tags);
        const riskTags = safeArray(candidate.riskTags).length
            ? safeArray(candidate.riskTags).map(normalizeText).filter(Boolean)
            : tagSummary.riskTags;
        return {
            ...candidate,
            reviewKey: candidateReviewKey(candidate, index),
            status,
            index: Number(candidate.index) || index + 1,
            name: normalizeText(candidate.name || candidate.extensionName || candidate.newDirectionName || candidate.direction),
            description: normalizeText(candidate.description || candidate.extensionDescription || candidate.directionDescription),
            visualHook: normalizeText(candidate.visualHook || candidate.hook || candidate.pictureHook),
            dedupeReason: normalizeText(candidate.dedupeReason || candidate.dedupReason || candidate.reason),
            riskNote: normalizeText(candidate.riskNote || candidate.qualityRisk || candidate.duplicateRisk),
            productionAdvice: normalizeText(candidate.productionAdvice || candidate.makingAdvice || candidate.sourceStrategy),
            directionTags,
            mainTags: mainTags.length ? mainTags : directionTags.slice(0, 5),
            extraTags,
            riskTags,
            avoidRules: safeArray(candidate.avoidRules).map(normalizeText).filter(Boolean),
            dimensions,
            score: Number(candidate.score || candidate.directionPlanScore) || 0,
            scoreSummary: normalizeText(candidate.scoreSummary || candidate.directionPlanScoreSummary),
            scoreReasons: safeArray(candidate.scoreReasons)
        };
    }

    function buildDirectionCandidateReview(directionPlanGate = {}) {
        const report = directionPlanGate.directionPlanReport || {};
        const selected = safeArray(directionPlanGate.selectedExtensions)
            .map((candidate, index) => normalizeReviewCandidate(candidate, index, 'selected'));
        const rejected = safeArray(report.rejectedExtensions)
            .map((candidate, index) => normalizeReviewCandidate(candidate, index, 'rejected'));
        return {
            mode: 'manual',
            status: 'pending',
            selectedCount: Number(report.selectedExtensionCount) || selected.length,
            rejectedCount: Number(report.rejectedExtensionCount) || rejected.length,
            selected,
            rejected,
            updatedAt: new Date().toISOString()
        };
    }

    function selectedReviewCandidatesFromPayload(run = {}, payload = {}) {
        const review = run.directionCandidateReview || {};
        const reviewCandidates = safeArray(review.selected).concat(safeArray(review.rejected));
        const existingByKey = new Map(reviewCandidates.map((candidate, index) => [
            candidateReviewKey(candidate, index),
            candidate
        ]));
        const payloadCandidates = safeArray(payload.candidates || payload.selectedCandidates);
        const sourceCandidates = payloadCandidates.length ? payloadCandidates : safeArray(review.selected);
        return sourceCandidates
            .map((candidate, index) => {
                const key = candidateReviewKey(candidate, index);
                const mergedCandidate = {
                    ...(existingByKey.get(key) || {}),
                    ...candidate,
                    reviewKey: key
                };
                const editedTags = safeArray(candidate.mainTags)
                    .concat(safeArray(candidate.extraTags))
                    .map(normalizeText)
                    .filter(Boolean);
                if (editedTags.length && !safeArray(candidate.directionTags).length) {
                    mergedCandidate.directionTags = editedTags;
                }
                return normalizeReviewCandidate(mergedCandidate, index, candidate.status || 'selected');
            })
            .filter(candidate => candidate && candidate.status !== 'deleted' && candidate.selected !== false && candidate.name);
    }

    function buildReviewedDirectionPlanGate(run = {}, candidates = []) {
        const previousReport = run.directionPlanReport || {};
        const selectedExtensions = safeArray(candidates).map((candidate, index) => ({
            ...candidate,
            index: index + 1,
            extensionKey: candidate.extensionKey || candidate.reviewKey || `manual-${index + 1}`,
            extensionType: candidate.extensionType || 'manual-reviewed',
            score: Number(candidate.score) || Number(candidate.directionPlanScore) || 100,
            scoreSummary: candidate.scoreSummary || '人工审核采纳'
        }));
        const selectedExtensionsReport = selectedExtensions.map(item => ({
            name: item.name,
            extensionKey: item.extensionKey,
            extensionType: item.extensionType,
            score: item.score,
            scoreSummary: item.scoreSummary,
            directionTags: safeArray(item.directionTags),
            mainTags: safeArray(item.mainTags),
            extraTags: safeArray(item.extraTags),
            riskTags: safeArray(item.riskTags),
            visualHook: item.visualHook,
            dedupeReason: item.dedupeReason,
            riskNote: item.riskNote,
            productionAdvice: item.productionAdvice,
            dimensions: item.dimensions || {},
            promptCount: 0,
            reviewKey: item.reviewKey
        }));
        return {
            prompts: [],
            selectedExtensions,
            directionPlanReport: {
                ...previousReport,
                success: selectedExtensions.length > 0,
                checkedAt: new Date().toISOString(),
                manualReview: true,
                reviewStatus: 'approved',
                selectedExtensionCount: selectedExtensions.length,
                selectedPromptCount: 0,
                rejectedExtensionCount: Math.max(0, Number(previousReport.candidateExtensionCount || 0) - selectedExtensions.length),
                selectedExtensions: selectedExtensionsReport,
                summary: `人工审核采纳 ${selectedExtensions.length} 个候选方向，准备生成 prompt`
            }
        };
    }

    function buildSelectedDirectionPromptMessages({ selected, payload, config, directionPlanGate }) {
        const direction = selected && selected.direction ? selected.direction : {};
        const planConfig = buildDirectionPlanConfig(payload, config);
        const forbiddenTerms = buildForbiddenTerms({
            direction,
            payload,
            config
        });
        const selectedExtensions = safeArray(directionPlanGate && directionPlanGate.selectedExtensions)
            .map(compactDirectionExtensionForPromptStage);
        const systemPrompt = [
            '你是 Legil 生图提示词生成 Agent。',
            '只输出严格 JSON object，不要 Markdown，不要代码块，不要解释。',
            '你只负责给已经通过 Direction Plan Gate 的入选方向生成完整 promptPair；不要新增方向、不要改方向名。',
            'JSON 顶层必须包含 directionPlans。directionPlans[].extensions[] 必须和输入 selectedExtensions 一一对应。',
            `每个 extension.promptPair 必须正好 ${planConfig.promptsPerExtension} 条中文完整长 prompt。`,
            'prompt 字段只写正向画面内容，不写“避免/不要/禁止/不能出现”排除句，也不要复述风险词清单。'
        ].join('\n');
        const userPrompt = [
            '# 原始方向',
            JSON.stringify({
                id: direction.id || '',
                path: direction.path || '',
                name: direction.name || '',
                description: direction.description || '',
                tags: [direction.primaryTag, direction.secondaryTag, direction.tertiaryTag, direction.subTag].filter(Boolean)
            }, null, 2),
            '',
            '# 入选方向',
            JSON.stringify({
                promptsPerExtension: planConfig.promptsPerExtension,
                selectedExtensions
            }, null, 2),
            '',
            '# 生成要求',
            [
                `1. 必须只为上面的 ${selectedExtensions.length} 个 selectedExtensions 生成 promptPair。`,
                `2. 每个 promptPair 正好 ${planConfig.promptsPerExtension} 条；不要多，不要少。`,
                '3. 每条 prompt 必须是一段自然中文镜头描述，不要写“主题：/画风：/画面内容：/核心构图：”字段模板。',
                '4. 同一方向下的多条 prompt 必须在主体组合、动作机制、镜头角度、空间结构、前景道具、光线方案、情绪瞬间或广告钩子中至少改变两项。',
                '5. 每条 prompt 必须明显体现该方向的 directionTags，尤其是 mainTags；不要只写泛泛场景。',
                '6. riskTags 只用于规避，不要把风险词字面写进 prompt。',
                '7. 保留每个方向的 visualHook、dedupeReason、riskNote、productionAdvice，不要改写方向名称。',
                `8. 遵守当前提示词风格：${getCreativePromptStyle(config.creativePromptStyle).label}；不要把比例、分辨率、输出数量写进 prompt。`,
                buildStyleInstruction(config.creativePromptStyle),
                forbiddenTerms.length
                    ? `9. 内部风险词只用于规避，不要写进 prompt 字面：${sanitizeRepairForbiddenText(forbiddenTerms.join('、'), forbiddenTerms)}`
                    : ''
            ].filter(Boolean).join('\n'),
            '',
            '# 输出 JSON schema',
            JSON.stringify({
                directionPlans: [{
                    sourceDirectionPath: direction.path || '',
                    extensions: selectedExtensions.map((extension, index) => ({
                        extensionKey: extension.extensionKey || `selected-${index + 1}`,
                        extensionType: extension.extensionType || 'selected',
                        name: extension.name,
                        description: extension.description,
                        directionTags: extension.directionTags,
                        mainTags: extension.mainTags,
                        extraTags: extension.extraTags,
                        riskTags: extension.riskTags,
                        visualHook: extension.visualHook,
                        dedupeReason: extension.dedupeReason,
                        riskNote: extension.riskNote,
                        productionAdvice: extension.productionAdvice,
                        promptPair: Array.from({ length: planConfig.promptsPerExtension }, (_, promptIndex) => ({
                            title: `提示词${promptIndex + 1}`,
                            prompt: '完整中文提示词'
                        }))
                    }))
                }]
            }, null, 2)
        ].join('\n');

        return [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ];
    }

    function attachSelectedDirectionTagsToPrompts(prompts = [], directionPlanGate = {}) {
        const selectedExtensions = safeArray(directionPlanGate && directionPlanGate.selectedExtensions)
            .map(compactDirectionExtensionForPromptStage);
        const byKey = new Map();
        selectedExtensions.forEach(extension => {
            [
                extension.extensionKey,
                extension.name,
                extension.extensionName,
                extension.newDirectionName
            ].map(normalizeText).filter(Boolean).forEach(key => byKey.set(key, extension));
        });
        return safeArray(prompts).map(prompt => {
            const match = byKey.get(normalizeText(prompt.extensionKey))
                || byKey.get(normalizeText(prompt.extensionName))
                || byKey.get(normalizeText(prompt.newDirectionName))
                || byKey.get(normalizeText(prompt.direction));
            if (!match) return prompt;
            return {
                ...prompt,
                directionTags: safeArray(match.directionTags).length ? safeArray(match.directionTags) : safeArray(prompt.directionTags),
                mainTags: safeArray(match.mainTags).length ? safeArray(match.mainTags) : safeArray(prompt.mainTags),
                extraTags: safeArray(match.extraTags).length ? safeArray(match.extraTags) : safeArray(prompt.extraTags),
                riskTags: safeArray(match.riskTags).length ? safeArray(match.riskTags) : safeArray(prompt.riskTags),
                visualHook: prompt.visualHook || match.visualHook,
                riskNote: prompt.riskNote || match.riskNote,
                productionAdvice: prompt.productionAdvice || match.productionAdvice,
                dedupeReason: prompt.dedupeReason || match.dedupeReason
            };
        });
    }

    async function generatePromptsForSelectedDirections({ selected, payload, config, directionPlanGate, winkyConfig }) {
        const startedAt = new Date().toISOString();
        const report = {
            startedAt,
            completedAt: '',
            success: false,
            selectedExtensionCount: safeArray(directionPlanGate && directionPlanGate.selectedExtensions).length,
            generatedPromptCount: 0,
            directionPlanCount: 0,
            error: ''
        };
        try {
            const text = await callWinkyRepairJson({
                winkyConfig,
                messages: buildSelectedDirectionPromptMessages({
                    selected,
                    payload,
                    config,
                    directionPlanGate
                })
            });
            const directionPlans = extractDirectionPlansFromText(text);
            const forbiddenTerms = buildForbiddenTerms({
                direction: selected && selected.direction ? selected.direction : {},
                payload,
                config
            });
            const prompts = attachSelectedDirectionTagsToPrompts(
                flattenDirectionPlansToPromptItems(directionPlans),
                directionPlanGate
            )
                .map((item, index) => ({
                    ...sanitizeRepairPromptItem(item, forbiddenTerms),
                    index: index + 1,
                    source: 'selected-direction-prompt-stage'
                }));
            report.completedAt = new Date().toISOString();
            report.success = prompts.length > 0;
            report.generatedPromptCount = prompts.length;
            report.directionPlanCount = directionPlans.length;
            return {
                prompts,
                directionPlans,
                rawText: text,
                report
            };
        } catch (error) {
            report.completedAt = new Date().toISOString();
            report.error = error.message || String(error);
            return {
                prompts: [],
                directionPlans: [],
                rawText: '',
                report
            };
        }
    }

    async function selectDirectionPlansWithRepair({ directionPlans, selected, payload, config, store, run, winkyConfig }) {
        const planConfig = buildDirectionPlanConfig(payload, config);
        const targetPromptCount = targetAcceptedPromptCount({ quota: { unlimitedPrompts: true }, payload, config });
        const maxRepairAttempts = Math.max(0, Number(planConfig.maxRepairAttempts) || 0);
        let candidateDirectionPlans = safeArray(directionPlans).slice();
        let directionPlanGate = null;
        const repairReport = {
            enabled: maxRepairAttempts > 0,
            maxRepairAttempts,
            attempts: [],
            generatedPromptCount: 0,
            finalQualifiedExtensionCount: 0,
            finalSelectedExtensionCount: 0,
            finalSelectedBelowMinScoreCount: 0,
            lowScoreFallbackUsed: false,
            candidatePoolFallbackUsed: false,
            success: false,
            summary: ''
        };

        for (let attemptIndex = 0; attemptIndex <= maxRepairAttempts; attemptIndex += 1) {
            directionPlanGate = selectDirectionPlanExtensions({
                directionPlans: candidateDirectionPlans,
                selected,
                payload,
                config,
                historyUsage: collectDirectionPlanHistoryUsage(store, run, selected, payload, config)
            });

            const directionReport = directionPlanGate.directionPlanReport || {};
            if (directionReport.needsRepair !== true || attemptIndex >= maxRepairAttempts) {
                break;
            }

            const acceptedExtensions = safeArray(directionPlanGate.selectedExtensions)
                .filter(item => Number(item.score) >= planConfig.minScore)
                .map(compactDirectionExtensionForPromptStage);
            const repair = await generateDirectionRepairPrompts({
                selected,
                payload,
                config,
                run,
                directionPlanReport: directionReport,
                promptQualityReport: null,
                acceptedPrompts: acceptedExtensions,
                targetPromptCount,
                attemptIndex,
                winkyConfig,
                directionOnly: true
            });
            repairReport.attempts.push(repair.report);
            repairReport.generatedPromptCount += repair.report.generatedPromptCount || 0;
            if (logger && typeof logger.info === 'function') {
                logger.info(repair.report.success
                    ? `Direction candidate repair attempt ${repair.report.attempt}: generated ${repair.report.directionPlanCount} direction plan candidates`
                    : `Direction candidate repair attempt ${repair.report.attempt} failed: ${repair.report.error || 'no direction plans generated'}`);
            }
            if (!safeArray(repair.directionPlans).length) {
                break;
            }
            candidateDirectionPlans = candidateDirectionPlans.concat(repair.directionPlans);
        }

        const finalReport = directionPlanGate && directionPlanGate.directionPlanReport
            ? directionPlanGate.directionPlanReport
            : {};
        repairReport.finalQualifiedExtensionCount = finalReport.qualifiedExtensionCount || 0;
        repairReport.finalSelectedExtensionCount = finalReport.selectedExtensionCount || 0;
        repairReport.finalSelectedBelowMinScoreCount = finalReport.selectedBelowMinScoreCount || 0;
        repairReport.lowScoreFallbackUsed = finalReport.fallbackLowScoreUsed === true;
        repairReport.candidatePoolFallbackUsed = finalReport.candidatePoolComplete === false;
        repairReport.success = safeArray(directionPlanGate && directionPlanGate.selectedExtensions).length > 0;
        repairReport.summary = repairReport.attempts.length
            ? `方向候选修复 ${repairReport.attempts.length} 轮，70分方向 ${repairReport.finalQualifiedExtensionCount}/${planConfig.selectedExtensionsPerSource}${repairReport.lowScoreFallbackUsed || repairReport.candidatePoolFallbackUsed ? '，三轮后兜底' : ''}`
            : `方向候选无需修复，70分方向 ${repairReport.finalQualifiedExtensionCount}/${planConfig.selectedExtensionsPerSource}${repairReport.lowScoreFallbackUsed || repairReport.candidatePoolFallbackUsed ? '，兜底' : ''}`;

        return {
            directionPlanGate,
            repairReport,
            directionPlans: candidateDirectionPlans
        };
    }

    async function applyPromptGatesWithRepair({ translation, selected, quota, store, run, payload, config, memoryRules, winkyConfig, skipDirectionRepair = false }) {
        const basePlanConfig = buildDirectionPlanConfig(payload, config);
        const gatePayload = skipDirectionRepair
            ? {
                ...(payload || {}),
                directionPlanning: {
                    ...((payload && payload.directionPlanning) || {}),
                    candidateExtensionsPerSource: basePlanConfig.selectedExtensionsPerSource
                }
            }
            : payload;
        const planConfig = buildDirectionPlanConfig(gatePayload, config);
        const targetPromptCount = targetAcceptedPromptCount({ quota, payload, config });
        const maxRepairAttempts = skipDirectionRepair
            ? 0
            : Math.max(0, Number(planConfig.maxRepairAttempts) || 0);
        let candidatePrompts = safeArray(translation.prompts).slice();
        let directionPlanGate = null;
        let gate = null;
        const repairReport = {
            enabled: maxRepairAttempts > 0,
            targetPromptCount,
            maxRepairAttempts,
            attempts: [],
            generatedPromptCount: 0,
            finalAcceptedPromptCount: 0,
            success: false,
            summary: ''
        };

        for (let attemptIndex = 0; attemptIndex <= maxRepairAttempts; attemptIndex += 1) {
            directionPlanGate = selectDirectionExtensions({
                prompts: candidatePrompts,
                selected,
                payload: gatePayload,
                config,
                historyUsage: collectDirectionPlanHistoryUsage(store, run, selected, gatePayload, config)
            });
            gate = applyPromptGate({
                prompts: directionPlanGate.prompts,
                selected,
                quota,
                store,
                runId: run.runId,
                payload: gatePayload,
                config,
                memoryRules
            });

            const directionReport = directionPlanGate.directionPlanReport || {};
            const directionPlanReady = directionReport.needsRepair !== true
                && Number(directionReport.selectedExtensionCount) >= planConfig.selectedExtensionsPerSource;
            const promptGateReady = gate.prompts.length >= targetPromptCount;

            if ((promptGateReady && directionPlanReady) || attemptIndex >= maxRepairAttempts) {
                break;
            }

            const scoreRepairNeeded = Number(directionReport.qualifiedExtensionCount) < planConfig.selectedExtensionsPerSource;
            const acceptedPromptsForRepair = scoreRepairNeeded
                ? gate.prompts.filter(item => Number(item.directionPlanScore) >= planConfig.minScore)
                : gate.prompts;

            const repair = await generateDirectionRepairPrompts({
                selected,
                payload,
                config,
                run,
                directionPlanReport: directionPlanGate.directionPlanReport,
                promptQualityReport: gate.promptQualityReport,
                acceptedPrompts: acceptedPromptsForRepair,
                targetPromptCount,
                attemptIndex,
                winkyConfig
            });
            repairReport.attempts.push(repair.report);
            repairReport.generatedPromptCount += repair.report.generatedPromptCount || 0;
            if (logger && typeof logger.info === 'function') {
                logger.info(repair.report.success
                    ? `Direction repair attempt ${repair.report.attempt}: generated ${repair.report.generatedPromptCount} prompt candidates`
                    : `Direction repair attempt ${repair.report.attempt} failed: ${repair.report.error || 'no prompts generated'}`);
            }
            if (!repair.prompts.length) {
                break;
            }
            candidatePrompts = candidatePrompts.concat(repair.prompts);
        }

        repairReport.finalAcceptedPromptCount = gate && gate.prompts ? gate.prompts.length : 0;
        repairReport.finalQualifiedExtensionCount = directionPlanGate && directionPlanGate.directionPlanReport
            ? directionPlanGate.directionPlanReport.qualifiedExtensionCount
            : 0;
        repairReport.finalSelectedExtensionCount = directionPlanGate && directionPlanGate.directionPlanReport
            ? directionPlanGate.directionPlanReport.selectedExtensionCount
            : 0;
        repairReport.finalSelectedBelowMinScoreCount = directionPlanGate && directionPlanGate.directionPlanReport
            ? directionPlanGate.directionPlanReport.selectedBelowMinScoreCount
            : 0;
        repairReport.directionPlanPassed = directionPlanGate && directionPlanGate.directionPlanReport
            ? directionPlanGate.directionPlanReport.needsRepair !== true
            : false;
        repairReport.lowScoreFallbackUsed = directionPlanGate && directionPlanGate.directionPlanReport
            ? directionPlanGate.directionPlanReport.fallbackLowScoreUsed === true
            : false;
        repairReport.candidatePoolFallbackUsed = directionPlanGate && directionPlanGate.directionPlanReport
            ? directionPlanGate.directionPlanReport.candidatePoolComplete === false
            : false;
        repairReport.success = repairReport.finalAcceptedPromptCount >= targetPromptCount;
        repairReport.summary = skipDirectionRepair
            ? `二阶段方向候选已预筛，跳过 prompt 阶段补候选；最终接受 ${repairReport.finalAcceptedPromptCount}/${targetPromptCount} 条`
            : (repairReport.attempts.length
            ? `自动修复 ${repairReport.attempts.length} 轮，补候选 ${repairReport.generatedPromptCount} 条，最终接受 ${repairReport.finalAcceptedPromptCount}/${targetPromptCount} 条，70分方向 ${repairReport.finalQualifiedExtensionCount}/${planConfig.selectedExtensionsPerSource}${repairReport.lowScoreFallbackUsed || repairReport.candidatePoolFallbackUsed ? '，三轮后兜底' : ''}`
            : `无需自动修复，最终接受 ${repairReport.finalAcceptedPromptCount}/${targetPromptCount} 条，70分方向 ${repairReport.finalQualifiedExtensionCount}/${planConfig.selectedExtensionsPerSource}${repairReport.lowScoreFallbackUsed || repairReport.candidatePoolFallbackUsed ? '，兜底' : ''}`);

        return {
            directionPlanGate,
            gate,
            repairReport
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

    function notifyCreativeTargetQueueFinal(queue = {}, previousRun = {}) {
        const summary = publicTargetQueue(queue) || {};
        if (!summary.queueId) {
            return;
        }

        const totalTargets = Number(summary.totalTargets) || safeArray(queue.targets).length;
        const completedTargets = Number(summary.completedTargets) || safeArray(queue.completedTargetIds).length;
        const skippedTargets = safeArray(summary.skippedTargets).length;
        const failedRuns = safeArray(queue.failedRunIds).length;
        const expectedPrompts = Number(summary.totalExpectedPromptCount) || 0;
        const rawPrompts = Number(summary.rawPromptCount) || 0;
        const acceptedPrompts = Number(summary.acceptedPromptCount) || 0;
        const rejectedPrompts = Number(summary.rejectedPromptCount) || 0;
        const failedPrompts = Number(summary.failedPromptCount) || 0;
        const savedImages = Number(summary.savedImageCount) || 0;
        const hasRunStats = Object.keys(queue.runStatsById || {}).length > 0;
        const promptText = expectedPrompts > 0
            ? `${acceptedPrompts}/${expectedPrompts}`
            : `${acceptedPrompts}`;
        const savedText = hasRunStats ? `${savedImages} 张` : '见运行中心';
        const queueLine = skippedTargets > 0
            ? `队列：${completedTargets}/${totalTargets}，跳过 ${skippedTargets}`
            : `队列：${completedTargets}/${totalTargets}`;
        const promptLine = `提示词：通过 ${promptText}，拒绝 ${rejectedPrompts}${rawPrompts > 0 ? `，原始 ${rawPrompts}` : ''}`;
        const outputLine = `产图：失败 ${failedPrompts}，保存 ${savedText}`;
        const extraLines = [
            queueLine,
            promptLine,
            outputLine,
            failedRuns > 0 ? `异常 run：${failedRuns}` : '',
            previousRun && previousRun.config && previousRun.config.outputFolder ? `输出目录：${previousRun.config.outputFolder}` : '',
            `queueId：${summary.queueId}`
        ].filter(Boolean);

        notifyCreativeAutoEvent({
            level: failedRuns > 0 ? 'warning' : 'info',
            title: failedRuns > 0 ? '创意队列完成，含异常' : '创意队列已完成',
            taskType: '创意目标队列',
            progress: queueLine,
            message: skippedTargets > 0
                ? `全部可运行目标已处理，跳过 ${skippedTargets} 个目标。`
                : '全部目标已处理完成。',
            suggestion: '可进入知识库审核资产，或继续交付处理。',
            extraLines
        }, {
            key: `creative-target-queue-final:${summary.queueId}:${summary.updatedAt || previousRun.runId || ''}`,
            category: 'completion',
            cooldownMs: 0,
            immediate: true
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
        const isQueuedRun = Boolean(run.targetQueue && run.targetQueue.queueId);
        if (isQueuedRun && isCompleted) {
            if (logger && typeof logger.info === 'function') {
                logger.info(`Creative target queue run completed silently: ${run.runId}`);
            }
            return;
        }
        const promptGateEmpty = isCompleted && acceptedCount <= 0 && rejectedCount > 0;
        const title = promptGateEmpty
            ? '运行一次自动创意未进入生图'
            : (isCompleted
                ? '运行一次自动创意已完成'
                : (isPaused
                    ? (isQueuedRun ? '创意队列已暂停' : '运行一次自动创意已暂停')
                    : (isQueuedRun ? '创意队列异常' : '运行一次自动创意异常')));
        const level = promptGateEmpty ? 'warning' : (isCompleted ? 'info' : (isPaused ? 'warning' : 'error'));
        const progress = `prompt ${acceptedCount}/${Number(run.promptTotalRaw) || acceptedCount}，拒绝 ${rejectedCount}，失败 ${failedCount}，保存 ${savedCount}`;
        const extraLines = [
            `runId：${run.runId}`,
            isQueuedRun ? `队列：${run.targetQueue.currentIndex || 0}/${run.targetQueue.totalTargets || 0}` : '',
            directionPath ? `方向：${directionPath}` : '',
            run.config && run.config.outputFolder ? `输出目录：${run.config.outputFolder}` : '',
            assets.newAssetCount !== undefined ? `资产登记：新增 ${assets.newAssetCount || 0}，匹配 ${assets.matchedFileCount || 0}` : ''
        ].filter(Boolean);

        notifyCreativeAutoEvent({
            level,
            title,
            taskType: isQueuedRun ? '创意目标队列' : '运行一次自动创意',
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
                    let finalRun = updateRun(store, run.runId, {
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
                    if (run.legilRetry && run.legilRetry.active && finalRun) {
                        finalRun = updateRun(store, run.runId, appendLegilRetryFinalUpdates(run, {
                            status: finalRun.status,
                            phase: finalRun.phase,
                            completedAt
                        }, progress, finalRun.legilResult || {}, completedAt)) || finalRun;
                    }
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
                    startNextQueuedTarget(runWithAssets || finalRun);
                    return runWithAssets || finalRun;
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

    function isPipelinePrefetchEnabled(context = {}) {
        const creativeConfig = context.appConfig && context.appConfig.creative ? context.appConfig.creative : {};
        if (creativeConfig.pipelinePrefetch === false) return false;
        const depth = Number(creativeConfig.pipelinePrefetchDepth);
        return !(Number.isFinite(depth) && depth <= 0);
    }

    function createPrefetchAgentRun({ store, payload, context, queue, target, index, attempt }) {
        const appConfig = context.appConfig || {};
        const knowledge = readKnowledge(context);
        const preflight = buildPreflight(appConfig, knowledge);
        if (!preflight.ok) {
            throw new Error('Preflight check failed before target prefetch');
        }

        const winkyConfig = typeof options.getStoredWinkyConfig === 'function'
            ? options.getStoredWinkyConfig()
            : {};
        if (!winkyConfig.apiKey || !winkyConfig.apiUrl || !winkyConfig.model) {
            throw new Error('Creative Agent LLM configuration is incomplete');
        }
        if (typeof options.startCreativeAgentTask !== 'function' || typeof options.getCreativeAgentTask !== 'function') {
            throw new Error('Creative Agent task runner is not configured');
        }

        const selectedBase = resolveSelectedDirection(knowledge, payload);
        const directionSystemContext = buildDirectionSystemContext({
            directions: knowledge.directions,
            selected: selectedBase,
            store,
            tagStrategy: (payload.directionPlanning && (payload.directionPlanning.tagStrategy || payload.directionPlanning.expansionStrategy))
                || 'stable'
        });
        const selected = {
            ...selectedBase,
            directionSystemContext,
            siblings: directionSystemContext.siblings,
            dimensionCoverage: directionSystemContext.dimensionCoverage,
            exclusionContext: directionSystemContext.exclusionContext,
            visualDnaPreferenceContext: directionSystemContext.visualDnaPreferenceContext,
            directionTagPreferenceContext: directionSystemContext.directionTagPreferenceContext,
            directionTreeSummary: directionSystemContext.directionTreeSummary
        };
        const creativeConfig = appConfig.creative || {};
        const config = {
            ...DEFAULT_AUTO_CONFIG,
            outputFolder: creativeConfig.outputFolder || 'D:\\工作\\自动化工作流1\\创意拓展\\输出',
            referenceFolder: creativeConfig.referenceFolder || knowledge.knowledgeConfig.referenceFolder,
            browserMode: normalizeAutoBrowserMode(creativeConfig.browserMode || DEFAULT_AUTO_CONFIG.browserMode),
            creativePromptStyle: normalizeCreativePromptStyle(payload.creativePromptStyle || creativeConfig.creativePromptStyle || DEFAULT_AUTO_CONFIG.creativePromptStyle),
            directionPlanning: {
                ...DEFAULT_AUTO_CONFIG.directionPlanning,
                ...(creativeConfig.directionPlanning || {}),
                ...(payload.directionPlanning || {})
            },
            generationSettings: {
                ...DEFAULT_AUTO_CONFIG.generationSettings,
                ...(creativeConfig.generationSettings || {})
            }
        };
        const requestedMaxPrompts = payload.maxPrompts
            || payload.legilMaxPrompts
            || (payload.fullScale === true ? DEFAULT_AUTO_CONFIG.maxPromptsPerRun : DEFAULT_AUTO_CONFIG.legilSmokeMaxPrompts);
        const quota = buildQuota({
            maxPrompts: requestedMaxPrompts,
            unlimitedPrompts: payload.unlimitedPrompts === true || payload.fullScale === true,
            outputQuantity: config.generationSettings.outputQuantity
        }, knowledge.schedulerState);
        if (quota.maxPrompts <= 0) {
            throw new Error('Prompt quota is 0; cannot prefetch target prompts');
        }

        const referenceImages = getMatchedReferenceImages(selected.direction, knowledge);
        const runId = `creative_run_${formatRunTimestamp()}_${crypto.randomBytes(3).toString('hex')}`;
        const diversityContext = buildDirectionDiversityContext({
            store,
            selectedDirection: selected.direction,
            payload,
            config,
            runId
        });
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
            historicalCreativeContext,
            diversityContext
        });
        const now = new Date().toISOString();
        const queueBrief = creativeBriefFromPayload(payload);
        const queueInfo = queueBrief && queueBrief.sequentialQueue ? queueBrief.sequentialQueue : null;
        const queueTarget = creativeBriefTargetsFromPayload(payload)[0] || target || null;
        const run = {
            runId,
            mode: 'legil-prefetch',
            agentOnly: true,
            prefetch: {
                queueId: queue.queueId,
                index,
                total: safeArray(queue.targets).length,
                targetId: targetQueueTargetId(target, index),
                attempt,
                maxAttempts: TARGET_QUEUE_PREFETCH_MAX_ATTEMPTS,
                startedAt: now
            },
            status: 'running',
            phase: 'agent_prefetch_running',
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
            directionDiversityContext: diversityContext,
            directionSystemContext,
            instruction,
            promptTotalRaw: 0,
            promptTotalTranslated: 0,
            promptTotal: 0,
            expectedImageTotal: 0,
            directionDefinitions: [],
            prompts: [],
            qualityReport: null,
            directionPlanReport: null,
            directionPlanRepairReport: null,
            promptQualityReport: null,
            promptTranslation: null,
            agentTask: null,
            agentOutput: null,
            legilPayload: null,
            legilTask: null,
            legilProgress: null,
            legilResult: null,
            message: `Pipeline prefetch started for target ${index + 1}/${safeArray(queue.targets).length}`
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

        return {
            run,
            agentTask,
            selected,
            quota,
            payload,
            config,
            promptTranslatorConfig: winkyConfig
        };
    }

    function handleTargetPrefetchFailure({ store, queueId, index, attempt, runId = '', error, context = {} }) {
        const latestQueue = loadTargetQueue(store, queueId);
        if (!latestQueue || latestQueue.status !== 'running') {
            return null;
        }
        const target = safeArray(latestQueue.targets)[index] || {};
        const targetId = targetQueueTargetId(target, index);
        const message = error && error.message ? error.message : String(error || 'unknown prefetch error');
        const failedAt = new Date().toISOString();
        if (runId) {
            updateRun(store, runId, {
                status: 'failed',
                phase: 'agent_prefetch_failed',
                completedAt: failedAt,
                error: message,
                message: `Pipeline prefetch failed for target ${index + 1}: ${message}`
            });
        }

        const attemptsByIndex = {
            ...(latestQueue.prefetchAttemptsByIndex || {}),
            [index]: attempt
        };
        if (attempt >= TARGET_QUEUE_PREFETCH_MAX_ATTEMPTS) {
            const skippedRecord = {
                index,
                displayIndex: index + 1,
                targetId,
                targetName: target.sourceMaterialName || target.materialName || target.sourceDirectionPath || '',
                attempts: attempt,
                error: message,
                skippedAt: failedAt
            };
            const skippedTargets = safeArray(latestQueue.skippedTargets)
                .filter(item => Number(item && item.index) !== index)
                .concat([skippedRecord]);
            const skippedTargetIndexes = uniqueStrings(safeArray(latestQueue.skippedTargetIndexes).concat([String(index)]))
                .map(value => Number(value))
                .filter(Number.isFinite);
            const skippedTargetIds = uniqueStrings(safeArray(latestQueue.skippedTargetIds).concat([targetId]));
            const skippedQueue = writeTargetQueue(store, clearQueuePrefetchFields(latestQueue, {
                prefetchAttemptsByIndex: attemptsByIndex,
                skippedTargets,
                skippedTargetIndexes,
                skippedTargetIds,
                nextAction: 'prefetch_skipped'
            }));
            if (logger && typeof logger.warn === 'function') {
                logger.warn(`Creative target prefetch skipped after ${attempt} failures: ${latestQueue.queueId} target ${index + 1}, ${message}`);
            }
            const currentRunId = String(skippedQueue.currentRunId || latestQueue.currentRunId || '').trim();
            const currentRun = currentRunId ? store.read(path.join('runs', `${path.basename(currentRunId)}.json`), null) : null;
            if (currentRun && currentRun.status === 'running') {
                setTimeout(() => maybePrefetchNextQueuedTarget({
                    store,
                    run: currentRun,
                    context: targetQueueContext(skippedQueue) || context
                }), TARGET_QUEUE_PREFETCH_RETRY_DELAY_MS);
            } else if (currentRun && currentRun.status === 'completed') {
                setTimeout(() => startNextQueuedTarget(currentRun), TARGET_QUEUE_PREFETCH_WAIT_MS);
            }
            return skippedQueue;
        }

        const retryQueue = writeTargetQueue(store, clearQueuePrefetchFields(latestQueue, {
            prefetchAttemptsByIndex: attemptsByIndex,
            nextAction: 'prefetch_retry',
            nextPrepareError: message
        }));
        if (logger && typeof logger.warn === 'function') {
            logger.warn(`Creative target prefetch failed attempt ${attempt}/${TARGET_QUEUE_PREFETCH_MAX_ATTEMPTS}: ${latestQueue.queueId} target ${index + 1}, retrying`);
        }
        setTimeout(() => {
            const queueForRetry = loadTargetQueue(store, queueId);
            if (!queueForRetry || queueForRetry.status !== 'running') return;
            startQueuedTargetPrefetch({
                store,
                queue: queueForRetry,
                index,
                context: targetQueueContext(queueForRetry) || context
            });
        }, TARGET_QUEUE_PREFETCH_RETRY_DELAY_MS);
        return retryQueue;
    }

    function startQueuedTargetPrefetch({ store, queue, index, context = {} }) {
        if (!queue || queue.status !== 'running') return null;
        if (!isPipelinePrefetchEnabled(context)) return null;
        if (typeof options.hasActiveCreativeAgentTask === 'function' && options.hasActiveCreativeAgentTask()) {
            setTimeout(() => {
                const latestQueue = loadTargetQueue(store, queue.queueId);
                if (!latestQueue || latestQueue.status !== 'running') return;
                if (latestQueue.nextPreparingRunId || latestQueue.nextPreparedRunId) return;
                startQueuedTargetPrefetch({
                    store,
                    queue: latestQueue,
                    index,
                    context: targetQueueContext(latestQueue) || context
                });
            }, TARGET_QUEUE_PREFETCH_WAIT_MS);
            return null;
        }

        const targets = safeArray(queue.targets);
        const target = targets[index];
        if (!target) return null;
        const attempt = queuePrefetchAttempt(queue, index) + 1;
        const payload = payloadForSingleCreativeTarget(
            queue.originalPayload,
            target,
            index,
            targets.length,
            queue.queueId
        );
        let bundle = null;
        try {
            bundle = createPrefetchAgentRun({
                store,
                payload,
                context,
                queue,
                target,
                index,
                attempt
            });
        } catch (error) {
            handleTargetPrefetchFailure({
                store,
                queueId: queue.queueId,
                index,
                attempt,
                error,
                context
            });
            return null;
        }

        const preparingQueue = writeTargetQueue(store, {
            ...queue,
            nextPreparingRunId: bundle.run.runId,
            nextPreparedRunId: '',
            nextPrepareIndex: index,
            nextPreparePhase: 'agent_running',
            nextPrepareAttempt: attempt,
            nextPrepareError: '',
            nextAction: 'prefetch_next_target'
        });
        activeTargetQueue = preparingQueue || queue;
        writeSchedulerState(store, {
            targetQueue: publicTargetQueue(preparingQueue || queue)
        });
        if (logger && typeof logger.info === 'function') {
            logger.info(`Creative target prefetch started: ${queue.queueId} target ${index + 1}/${targets.length}, attempt ${attempt}`);
        }

        followAgentTask({
            store,
            run: bundle.run,
            agentTask: bundle.agentTask,
            selected: bundle.selected,
            quota: bundle.quota,
            payload: bundle.payload,
            config: bundle.config,
            agentOnly: true,
            promptTranslatorConfig: bundle.promptTranslatorConfig,
            memoryRules: bundle.run.memoryRules,
            prefetch: true
        }).then(completedRun => {
            const latestQueue = loadTargetQueue(store, queue.queueId);
            if (!latestQueue || latestQueue.status !== 'running') return;
            if (latestQueue.nextPreparingRunId !== completedRun.runId) return;
            const preparedQueue = writeTargetQueue(store, clearQueuePrefetchFields(latestQueue, {
                nextPreparedRunId: completedRun.runId,
                nextPrepareIndex: index,
                nextPreparePhase: 'agent_completed',
                nextPrepareAttempt: attempt,
                nextAction: 'prefetch_ready'
            }));
            activeTargetQueue = preparedQueue || latestQueue;
            writeSchedulerState(store, {
                targetQueue: publicTargetQueue(preparedQueue || latestQueue)
            });
            if (logger && typeof logger.info === 'function') {
                logger.info(`Creative target prefetch ready: ${queue.queueId} target ${index + 1}/${targets.length}, run ${completedRun.runId}`);
            }
        }).catch(error => {
            handleTargetPrefetchFailure({
                store,
                queueId: queue.queueId,
                index,
                attempt,
                runId: bundle.run.runId,
                error,
                context
            });
        });

        return preparingQueue;
    }

    function maybePrefetchNextQueuedTarget({ store, run, context = {} }) {
        if (!run || !run.targetQueue || !run.targetQueue.queueId) return null;
        const queue = loadTargetQueue(store, run.targetQueue.queueId);
        if (!queue || queue.status !== 'running') return null;
        if (!isPipelinePrefetchEnabled(context || targetQueueContext(queue))) return null;
        if (queue.nextPreparingRunId || queue.nextPreparedRunId) return null;

        const currentIndex = targetQueueIndexFromRun(run, queue);
        const nextIndex = nextRunnableTargetIndex(queue, currentIndex + 1);
        if (nextIndex < 0) return null;
        return startQueuedTargetPrefetch({
            store,
            queue,
            index: nextIndex,
            context: targetQueueContext(queue) || context
        });
    }

    function startPreparedQueuedTargetLegil({ store, queue, previousRun, preparedRun, nextIndex }) {
        const prompts = safeArray(preparedRun.prompts).filter(item => item && item.selected !== false);
        if (!prompts.length) {
            return skipPreparedQueuedTarget({
                store,
                queue,
                previousRun,
                preparedRun,
                nextIndex,
                reason: 'Prompt Gate accepted 0 prompts for prefetched target'
            });
        }
        const selected = buildSelectedFromRun(preparedRun);
        const config = {
            ...DEFAULT_AUTO_CONFIG,
            ...(preparedRun.config || {})
        };
        const preparedQueue = writeTargetQueue(store, clearQueuePrefetchFields(queue, {
            status: 'running',
            currentIndex: nextIndex,
            nextIndex,
            currentRunId: preparedRun.runId,
            lastRunId: previousRun.runId || queue.lastRunId || '',
            lastRunStatus: previousRun.status || '',
            lastRunPhase: previousRun.phase || '',
            nextAction: 'start_prepared_legil'
        })) || queue;
        activeTargetQueue = preparedQueue;
        activeRunId = preparedRun.runId;
        const preparedForLegil = updateRun(store, preparedRun.runId, {
            status: 'running',
            phase: 'legil_pending',
            agentOnly: false,
            mode: 'legil-run-once',
            completedAt: '',
            message: `Pipeline prefetch ready; starting Legil for target ${nextIndex + 1}/${safeArray(queue.targets).length}`
        }) || preparedRun;
        writeSchedulerState(store, {
            status: 'running',
            currentRunId: preparedRun.runId,
            currentAgentTaskRunId: null,
            targetQueue: publicTargetQueue(preparedQueue)
        });
        startLegilAfterAgent({
            store,
            run: preparedForLegil,
            selected,
            prompts,
            config
        }).catch(error => {
            const failedAt = new Date().toISOString();
            const failedRun = updateRun(store, preparedRun.runId, {
                status: 'failed',
                phase: 'legil_prefetch_start_failed',
                completedAt: failedAt,
                error: error.message,
                message: 'Pipeline prepared run failed to start Legil: ' + error.message
            });
            updateTargetQueueFromRun(store, failedRun || preparedForLegil, 'failed');
            writeSchedulerState(store, {
                status: 'idle',
                currentRunId: null,
                currentAgentTaskRunId: null,
                currentLegilTask: null,
                lastRunId: preparedRun.runId,
                lastError: error.message
            });
            if (activeRunId === preparedRun.runId) {
                activeRunId = null;
            }
            if (logger && typeof logger.error === 'function') {
                logger.error(`Pipeline prepared run failed to start Legil: ${error.message}`);
            }
        });
        return {
            success: true,
            queue: publicTargetQueue(preparedQueue),
            run: preparedForLegil
        };
    }

    function skipPreparedQueuedTarget({ store, queue, previousRun, preparedRun, nextIndex, reason = '' }) {
        const targets = safeArray(queue.targets);
        const target = targets[nextIndex] || {};
        const targetId = targetQueueTargetId(target, nextIndex);
        const skippedAt = new Date().toISOString();
        const skippedRecord = {
            index: nextIndex,
            displayIndex: nextIndex + 1,
            targetId,
            targetName: target.sourceMaterialName || target.materialName || target.sourceDirectionPath || '',
            runId: preparedRun.runId || '',
            error: reason || preparedRun.message || 'Prefetched target has no accepted prompts',
            skippedAt
        };
        const skippedTargets = safeArray(queue.skippedTargets)
            .filter(item => Number(item && item.index) !== nextIndex)
            .concat([skippedRecord]);
        const skippedTargetIndexes = uniqueStrings(safeArray(queue.skippedTargetIndexes).concat([String(nextIndex)]))
            .map(value => Number(value))
            .filter(Number.isFinite);
        const skippedTargetIds = uniqueStrings(safeArray(queue.skippedTargetIds).concat([targetId]));
        const completedIndex = targetQueueIndexFromRun(previousRun, queue);
        const skippedQueue = writeTargetQueue(store, clearQueuePrefetchFields(queue, {
            status: 'running',
            currentIndex: completedIndex,
            nextIndex: nextIndex + 1,
            currentRunId: previousRun.runId || queue.currentRunId || '',
            lastRunId: preparedRun.runId || queue.lastRunId || '',
            lastRunStatus: preparedRun.status || '',
            lastRunPhase: preparedRun.phase || '',
            skippedTargets,
            skippedTargetIndexes,
            skippedTargetIds,
            nextAction: 'prefetch_prompt_gate_empty',
            ...mergeTargetQueueRunStats(queue, preparedRun)
        })) || queue;
        activeTargetQueue = skippedQueue;
        writeSchedulerState(store, {
            status: 'idle',
            currentRunId: null,
            currentAgentTaskRunId: null,
            currentLegilTask: null,
            lastRunId: previousRun.runId || preparedRun.runId || '',
            targetQueue: publicTargetQueue(skippedQueue)
        });
        if (logger && typeof logger.warn === 'function') {
            logger.warn(`Creative target queue skipped prefetched empty run: ${queue.queueId} target ${nextIndex + 1}, run ${preparedRun.runId}`);
        }
        setTimeout(() => startNextQueuedTarget(previousRun), TARGET_QUEUE_PREFETCH_WAIT_MS);
        return {
            success: true,
            queue: publicTargetQueue(skippedQueue),
            skippedPreparedRun: true,
            nextIndex: nextRunnableTargetIndex(skippedQueue, nextIndex + 1)
        };
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
        maybePrefetchNextQueuedTarget({
            store,
            run: currentRun,
            context: (() => {
                const queue = currentRun.targetQueue && currentRun.targetQueue.queueId
                    ? loadTargetQueue(store, currentRun.targetQueue.queueId)
                    : null;
                return targetQueueContext(queue);
            })()
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
            generationSettings: {
                ...(DEFAULT_AUTO_CONFIG.generationSettings || {}),
                ...((run.config && run.config.generationSettings) || {}),
                ...((payload && payload.generationSettings) || {})
            },
            browserMode: normalizeAutoBrowserMode(
                payload.browserMode
                    || creativeConfig.browserMode
                    || (run.config && run.config.browserMode)
                    || DEFAULT_AUTO_CONFIG.browserMode
            )
        };
        const requestedOutputQuantity = Number(payload.outputQuantity || (payload.generationSettings && payload.generationSettings.outputQuantity));
        if (Number.isFinite(requestedOutputQuantity) && requestedOutputQuantity > 0) {
            config.outputQuantity = Math.max(1, Math.min(20, Math.floor(requestedOutputQuantity)));
            config.generationSettings.outputQuantity = config.outputQuantity;
        }
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
            config,
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

    function continueRunFromDirectionReview(runId, payload = {}, context = {}) {
        if (activeRunId) {
            return {
                success: false,
                message: '已有自动创意任务正在运行',
                activeRun: getRun(activeRunId, context)
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
        if (run.phase !== 'pending_direction_review') {
            return {
                success: false,
                message: '当前任务没有停在候选方向审核阶段'
            };
        }

        const candidates = selectedReviewCandidatesFromPayload(run, payload);
        if (!candidates.length) {
            return {
                success: false,
                message: '请至少采纳 1 个候选方向后再生成 prompt'
            };
        }

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
        const promptOnly = payload.promptOnly === true || payload.agentOnly === true || run.agentOnly === true;
        if (!promptOnly && typeof options.isLegilBusy === 'function' && options.isLegilBusy()) {
            return {
                success: false,
                message: '当前已有 Legil 自动化任务正在运行，请稍后再试'
            };
        }
        const winkyConfig = typeof options.getStoredWinkyConfig === 'function'
            ? options.getStoredWinkyConfig()
            : {};
        if (!winkyConfig.apiKey || !winkyConfig.apiUrl || !winkyConfig.model) {
            return {
                success: false,
                message: '创意 Agent 的 LLM 配置不完整，无法生成 prompt'
            };
        }

        const selected = buildSelectedFromRun(run);
        const directionPlanGate = buildReviewedDirectionPlanGate(run, candidates);
        const startedAt = new Date().toISOString();
        const updatedReview = {
            ...(run.directionCandidateReview || {}),
            status: 'approved',
            selectedCount: candidates.length,
            selected: candidates.map((candidate, index) => normalizeReviewCandidate(candidate, index, 'selected')),
            rejected: safeArray(run.directionCandidateReview && run.directionCandidateReview.rejected),
            updatedAt: startedAt
        };
        const preparedRun = updateRun(store, run.runId, {
            status: 'running',
            phase: 'direction_review_prompt_running',
            completedAt: '',
            resumedAt: startedAt,
            agentOnly: promptOnly,
            mode: promptOnly ? 'agent-only-direction-review' : (run.mode || 'legil-run-once'),
            directionCandidateReview: updatedReview,
            pendingDirectionReview: {
                ...(run.pendingDirectionReview || {}),
                status: 'approved',
                approvedAt: startedAt,
                updatedAt: startedAt,
                selectedCandidates: candidates,
                directionPlanGate
            },
            directionPlanReport: directionPlanGate.directionPlanReport,
            message: `人工审核已采纳 ${candidates.length} 个候选方向，正在生成 prompt`
        }) || run;

        activeRunId = run.runId;
        writeSchedulerState(store, {
            status: 'running',
            currentRunId: run.runId,
            currentAgentTaskRunId: null,
            lastStartedAt: startedAt
        });

        continueDirectionReviewInBackground({
            store,
            run: preparedRun,
            selected,
            payload: {
                ...buildResumePayloadFromRun(run),
                ...(run.reviewPayload || {}),
                ...(payload || {}),
                directionPlanning: {
                    ...((run.config && run.config.directionPlanning) || {}),
                    ...((run.reviewPayload && run.reviewPayload.directionPlanning) || {}),
                    ...((payload && payload.directionPlanning) || {}),
                    selectedExtensionsPerSource: candidates.length,
                    candidateExtensionsPerSource: candidates.length,
                    maxRepairAttempts: 0
                }
            },
            config,
            quota: run.quota || {},
            promptOnly,
            directionPlanGate,
            winkyConfig
        }).catch(error => {
            const failedAt = new Date().toISOString();
            const failedRun = updateRun(store, run.runId, {
                status: 'failed',
                phase: 'direction_review_continue_failed',
                completedAt: failedAt,
                error: error.message,
                message: '候选方向审核后生成 prompt 失败: ' + error.message
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
            if (activeRunId === run.runId) activeRunId = null;
            if (logger && typeof logger.error === 'function') {
                logger.error(`候选方向审核后生成 prompt 失败: ${error.message}`);
            }
        });

        return {
            success: true,
            message: promptOnly ? '已开始基于审核候选生成 prompt' : '已开始基于审核候选生成 prompt，并将在 Prompt Gate 后调用 Legil',
            run: preparedRun
        };
    }

    async function continueDirectionReviewInBackground({ store, run, selected, payload, config, quota, promptOnly, directionPlanGate, winkyConfig }) {
        const selectedDirectionPromptStage = await generatePromptsForSelectedDirections({
            selected,
            payload,
            config,
            directionPlanGate,
            winkyConfig
        });
        const agentPrompts = selectedDirectionPromptStage.prompts;
        const translation = bypassPromptTranslationForLegil({
            prompts: agentPrompts,
            selected,
            runId: run.runId
        });
        const gates = await applyPromptGatesWithRepair({
            translation,
            selected,
            quota,
            store,
            run,
            payload,
            config,
            memoryRules: run.memoryRules || [],
            winkyConfig,
            skipDirectionRepair: true
        });
        const gate = gates.gate;
        const prompts = gate.prompts;
        const qualityReport = gate.qualityReport;
        const plannedDirectionDefinitions = safeArray(translation.directionDefinitions).length
            ? translation.directionDefinitions
            : buildDirectionDefinitions(agentPrompts, selected);
        const directionExpansionHistoryAdditions = appendDirectionExpansionHistory(store, {
            run,
            selected,
            directionPlanGate,
            diversityContext: run.directionDiversityContext
        });
        const completedAt = promptOnly ? new Date().toISOString() : '';
        const completedRun = updateRun(store, run.runId, {
            status: promptOnly ? 'completed' : 'running',
            phase: 'agent_completed',
            completedAt,
            promptTotalRaw: agentPrompts.length,
            promptTotalTranslated: translation.report.promptCount,
            promptTotalDirectionPlanned: directionPlanGate.directionPlanReport.selectedPromptCount,
            promptTotalCandidate: gate.promptQualityReport.candidatePromptCount,
            promptTotal: prompts.length,
            promptTotalRejected: gate.promptQualityReport.rejectedPromptCount,
            expectedImageTotal: gate.promptQualityReport.expectedImageTotal,
            directionDefinitions: plannedDirectionDefinitions,
            prompts,
            qualityReport,
            directionExpansionHistoryAdditions,
            directionPlanReport: directionPlanGate.directionPlanReport,
            directionCandidateReport: directionPlanGate.directionPlanReport,
            selectedDirectionPromptReport: selectedDirectionPromptStage.report,
            directionPlanRepairReport: gates.repairReport,
            promptQualityReport: gate.promptQualityReport,
            promptTranslation: translation.report,
            agentOutput: {
                ...(run.agentOutput || {}),
                twoStagePromptGeneration: true,
                selectedDirectionPromptCount: selectedDirectionPromptStage.report
                    ? selectedDirectionPromptStage.report.generatedPromptCount
                    : 0,
                selectedDirectionPromptRawText: selectedDirectionPromptStage.rawText || ''
            },
            message: promptOnly
                ? `人工审核方向后已生成 ${agentPrompts.length} 条 prompt，Prompt Gate 接受 ${prompts.length} 条，未调用 Legil`
                : `人工审核方向后已生成 ${agentPrompts.length} 条 prompt，Prompt Gate 接受 ${prompts.length} 条，准备调用 Legil`
        }) || run;
        updateSelectedDirectionPromptStats(store, selected, {
            expandedCountDelta: 1,
            promptCountDelta: prompts.length,
            lastRunAt: completedRun.completedAt || new Date().toISOString()
        });

        if (promptOnly) {
            notifyCreativeAutoRunFinal(completedRun, 'completed');
            writeSchedulerState(store, {
                status: 'idle',
                currentRunId: null,
                currentAgentTaskRunId: null,
                lastRunId: run.runId,
                lastCompletedAt: completedRun.completedAt
            });
            if (activeRunId === run.runId) activeRunId = null;
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
        const finalizedRun = reconcileFinalLegilRun(store, run, afterSnapshot);
        if (finalizedRun && finalizedRun.status !== 'running') {
            return {
                success: true,
                message: finalizedRun.message || '自动创意任务已完成',
                run: finalizedRun
            };
        }
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

    function failedPromptResultsFromRun(run = {}) {
        const sources = [
            run.legilProgress && run.legilProgress.failedPromptResults,
            run.legilTask && run.legilTask.progress && run.legilTask.progress.failedPromptResults
        ];
        const seen = new Set();
        return sources.flatMap(safeArray)
            .filter(Boolean)
            .filter(item => {
                const key = [
                    item.promptHash || '',
                    item.promptListIndex || '',
                    item.displayIndex || '',
                    item.sourceRow || '',
                    item.promptTitle || '',
                    item.error || item.message || ''
                ].join('|');
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
    }

    function matchPromptForFailedResult(prompts = [], failed = {}) {
        return safeArray(prompts).find(prompt => {
            if (!prompt) return false;
            if (failed.promptHash && prompt.promptHash === failed.promptHash) return true;
            if (failed.promptListIndex && Number(prompt.index) === Number(failed.promptListIndex)) return true;
            if (failed.promptListIndex && Number(prompt.originalIndex) === Number(failed.promptListIndex)) return true;
            if (failed.sourceRow && Number(prompt.sourceRow) === Number(failed.sourceRow)) return true;
            if (failed.promptTitle && prompt.promptTitle === failed.promptTitle) return true;
            return false;
        }) || null;
    }

    function buildRetryPromptsFromRun(run = {}, failedResults = []) {
        const prompts = safeArray(run.prompts);
        return safeArray(failedResults)
            .map((failed, index) => {
                const matched = matchPromptForFailedResult(prompts, failed);
                if (!matched) return null;
                return {
                    ...matched,
                    index: Number(matched.index) || Number(failed.promptListIndex) || index + 1,
                    originalIndex: matched.originalIndex || matched.index || failed.promptListIndex || index + 1,
                    selected: true,
                    retryOf: {
                        promptListIndex: failed.promptListIndex || '',
                        displayIndex: failed.displayIndex || '',
                        failedAt: failed.failedAt || '',
                        error: failed.error || failed.message || ''
                    }
                };
            })
            .filter(item => item && (item.finalPrompt || item.prompt));
    }

    function appendLegilRetryFinalUpdates(run = {}, updates = {}, progress = {}, result = {}, completedAt = new Date().toISOString()) {
        const retry = run.legilRetry && run.legilRetry.active ? run.legilRetry : null;
        if (!retry) return updates;

        const retryRecord = {
            ...retry,
            active: false,
            status: updates.status || '',
            phase: updates.phase || '',
            completedAt,
            progress,
            result
        };
        return {
            ...updates,
            legilRetry: retryRecord,
            legilRetries: safeArray(run.legilRetries).concat([retryRecord]).slice(-20),
            legilProgressHistory: safeArray(run.legilProgressHistory)
                .concat(run.legilProgress ? [run.legilProgress] : [])
                .slice(-20),
            legilResultHistory: safeArray(run.legilResultHistory)
                .concat(run.legilResult ? [run.legilResult] : [])
                .slice(-20)
        };
    }

    function retryFailedPrompts(runId, payload = {}, context = {}) {
        if (activeRunId) {
            return {
                success: false,
                message: 'A creative-auto run is already running',
                activeRun: getRun(activeRunId, context)
            };
        }

        if (typeof options.isLegilBusy === 'function' && options.isLegilBusy()) {
            return {
                success: false,
                message: 'Legil is busy; retry failed prompts after the current task finishes'
            };
        }

        const { store } = getKnowledgeStore(context);
        store.ensureBase();
        const run = getRun(runId, context);
        if (!run) {
            return {
                success: false,
                message: 'Creative-auto run not found'
            };
        }
        if (run.status === 'running') {
            return {
                success: false,
                message: 'The run is still running; retry failed prompts after the current batch finishes',
                run
            };
        }

        const failedResults = failedPromptResultsFromRun(run);
        const prompts = buildRetryPromptsFromRun(run, failedResults);
        if (!prompts.length) {
            return {
                success: false,
                message: 'No retryable failed prompts were found',
                run,
                failedPromptResults: failedResults
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
        const retryId = 'legil_retry_' + formatRunTimestamp() + '_' + crypto.randomBytes(3).toString('hex');
        const preparedRun = updateRun(store, run.runId, {
            status: 'running',
            phase: 'legil_retry_pending',
            completedAt: '',
            resumedAt: now,
            legilRetry: {
                retryId,
                active: true,
                status: 'running',
                phase: 'legil_retry_pending',
                failedPromptCount: failedResults.length,
                retryPromptCount: prompts.length,
                failedPromptResults,
                startedAt: now
            },
            message: 'Preparing to retry ' + prompts.length + ' failed prompt(s)'
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
            legilPayloadExtra: {
                retryMode: true,
                retryId,
                retryFailedPromptCount: failedResults.length,
                legilTaskId: buildLegilTaskId(preparedRun, prompts) + '_' + retryId
            }
        }).catch(error => {
            const failedAt = new Date().toISOString();
            const failedRun = updateRun(store, run.runId, appendLegilRetryFinalUpdates(preparedRun, {
                status: 'failed',
                phase: 'legil_retry_failed',
                completedAt: failedAt,
                error: error.message,
                message: 'Retry failed prompts failed: ' + error.message
            }, null, {
                success: false,
                message: error.message
            }, failedAt));
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
                logger.error('Retry failed prompts failed: ' + error.message);
            }
        });

        return {
            success: true,
            message: 'Retrying ' + prompts.length + ' failed prompt(s)',
            run: preparedRun,
            failedPromptResults: failedResults,
            retryPromptCount: prompts.length
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

        if (canAdvanceTargetQueueFromRun(store, run)) {
            const queuedRun = attachTargetQueueProgress(store, run);
            const advanceResult = startNextQueuedTarget(queuedRun);
            if (advanceResult && advanceResult.queue) {
                writeSchedulerState(store, {
                    targetQueue: advanceResult.queue
                });
            }
            return {
                success: true,
                message: '已继续创意目标队列，准备启动下一个目标',
                run: attachTargetQueueProgress(store, getRun(run.runId, context) || run),
                targetQueue: advanceResult && advanceResult.queue
                    ? advanceResult.queue
                    : (targetQueueRecoverySummary(store, run) || (queuedRun && queuedRun.targetQueueProgress) || null)
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
            let resumedQueue = null;
            if (run.targetQueue && run.targetQueue.queueId) {
                resumedQueue = updateTargetQueue(store, run.targetQueue.queueId, {
                    status: 'running',
                    currentRunId: run.runId,
                    lastRunId: run.runId,
                    lastRunStatus: 'running',
                    lastRunPhase: 'agent_running'
                });
            }
            writeSchedulerState(store, {
                status: 'running',
                currentRunId: run.runId,
                currentAgentTaskRunId: agentTask.runId,
                lastStartedAt: now,
                targetQueue: resumedQueue ? publicTargetQueue(resumedQueue) : (run.targetQueue || null)
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

    async function followAgentTask({ store, run, agentTask, selected, quota, payload, config, agentOnly, promptTranslatorConfig, memoryRules = [], prefetch = false }) {
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
                    if (prefetch) {
                        throw new Error(publicTask.message || 'Creative Agent prefetch was cancelled');
                    }
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
                const hasDirectionCandidates = safeArray(result.directionPlans)
                    .some(plan => safeArray(plan && plan.extensions).length > 0);
                let agentPrompts = safeArray(result.prompts);
                let directionCandidateStage = null;
                let selectedDirectionPromptStage = null;

                if (hasDirectionCandidates && agentPrompts.length === 0) {
                    directionCandidateStage = await selectDirectionPlansWithRepair({
                        directionPlans: result.directionPlans,
                        selected,
                        payload,
                        config,
                        store,
                        run,
                        winkyConfig: promptTranslatorConfig
                    });
                    if (logger && typeof logger.info === 'function') {
                        logger.info(`Direction Candidate Gate: ${directionCandidateStage.directionPlanGate.directionPlanReport.summary}`);
                        logger.info(`Direction candidate repair: ${directionCandidateStage.repairReport.summary}`);
                    }
                    if (directionReviewModeFromPayload(payload, config) === 'manual') {
                        const pausedAt = new Date().toISOString();
                        const pendingReview = buildDirectionCandidateReview(directionCandidateStage.directionPlanGate);
                        const pausedRun = markRunPaused(store, run, {
                            phase: 'pending_direction_review',
                            completedAt: pausedAt,
                            directionReviewMode: 'manual',
                            directionCandidateReview: pendingReview,
                            pendingDirectionReview: {
                                status: 'pending',
                                mode: 'manual',
                                createdAt: pausedAt,
                                updatedAt: pausedAt,
                                directionPlanGate: directionCandidateStage.directionPlanGate,
                                repairReport: directionCandidateStage.repairReport,
                                directionPlans: directionCandidateStage.directionPlans,
                                promptOnly: agentOnly === true
                            },
                            directionPlanReport: directionCandidateStage.directionPlanGate.directionPlanReport,
                            directionCandidateReport: directionCandidateStage.directionPlanGate.directionPlanReport,
                            directionCandidateRepairReport: directionCandidateStage.repairReport,
                            agentTask: publicTask,
                            agentOutput: {
                                fileName: result.fileName || '',
                                downloadUrl: result.downloadUrl || '',
                                localPath: result.localPath || '',
                                rawText: result.rawText || '',
                                rawTableMarkdown: result.rawTableMarkdown || result.rawText || '',
                                markdownPreview: result.markdownPreview || '',
                                message: result.message || '',
                                directionPlans: result.directionPlans || [],
                                directionPlanCount: result.directionPlanCount || 0,
                                candidateDirections: result.candidateDirections || [],
                                candidateDirectionCount: result.candidateDirectionCount || 0,
                                twoStagePromptGeneration: true,
                                pendingDirectionReview: true
                            },
                            reviewPayload: payload,
                            message: `候选方向审核模式：已生成 ${pendingReview.selected.length + pendingReview.rejected.length} 个候选，等待人工确认后再生成 prompt`
                        });
                        notifyCreativeAutoRunFinal(pausedRun, 'paused');
                        return pausedRun;
                    }
                    selectedDirectionPromptStage = await generatePromptsForSelectedDirections({
                        selected,
                        payload,
                        config,
                        directionPlanGate: directionCandidateStage.directionPlanGate,
                        winkyConfig: promptTranslatorConfig
                    });
                    if (logger && typeof logger.info === 'function') {
                        logger.info(selectedDirectionPromptStage.report.success
                            ? `Selected direction prompt stage generated ${selectedDirectionPromptStage.report.generatedPromptCount} final prompts`
                            : `Selected direction prompt stage failed: ${selectedDirectionPromptStage.report.error || 'no prompts generated'}`);
                    }
                    agentPrompts = selectedDirectionPromptStage.prompts;
                }

                const translation = bypassPromptTranslationForLegil({
                    prompts: agentPrompts,
                    selected,
                    runId: run.runId
                });
                if (logger && typeof logger.info === 'function') {
                    logger.info(`Prompt Translator skipped: ${translation.report.promptCount} final Legil prompts are ready`);
                }
                const gates = await applyPromptGatesWithRepair({
                    translation,
                    selected,
                    quota,
                    store,
                    run,
                    payload,
                    config,
                    memoryRules,
                    winkyConfig: promptTranslatorConfig,
                    skipDirectionRepair: Boolean(directionCandidateStage && selectedDirectionPromptStage)
                });
                const directionPlanGate = gates.directionPlanGate;
                const gate = gates.gate;
                if (logger && typeof logger.info === 'function') {
                    logger.info(`Direction Plan Gate: ${directionPlanGate.directionPlanReport.summary}`);
                    logger.info(`Direction repair: ${gates.repairReport.summary}`);
                }
                const plannedDirectionDefinitions = buildDirectionDefinitions(directionPlanGate.prompts, selected);
                const prompts = gate.prompts;
                const qualityReport = gate.qualityReport;
                const repairMessageSuffix = gates.repairReport.attempts.length
                    ? `，自动修复 ${gates.repairReport.attempts.length} 轮`
                    : '';
                const directionExpansionHistoryAdditions = appendDirectionExpansionHistory(store, {
                    run,
                    selected,
                    directionPlanGate,
                    diversityContext: run.directionDiversityContext
                });
                const completedRun = {
                    ...run,
                    status: agentOnly ? 'completed' : 'running',
                    phase: 'agent_completed',
                    completedAt: agentOnly ? new Date().toISOString() : '',
                    promptTotalRaw: agentPrompts.length,
                    promptTotalTranslated: translation.report.promptCount,
                    promptTotalDirectionPlanned: directionPlanGate.directionPlanReport.selectedPromptCount,
                    promptTotalCandidate: gate.promptQualityReport.candidatePromptCount,
                    promptTotal: prompts.length,
                    promptTotalRejected: gate.promptQualityReport.rejectedPromptCount,
                    expectedImageTotal: gate.promptQualityReport.expectedImageTotal,
                    directionDefinitions: plannedDirectionDefinitions,
                    prompts,
                    qualityReport,
                    directionDiversityContext: run.directionDiversityContext || null,
                    directionExpansionHistoryAdditions,
                    directionPlanReport: directionPlanGate.directionPlanReport,
                    directionCandidateReport: directionCandidateStage && directionCandidateStage.directionPlanGate
                        ? directionCandidateStage.directionPlanGate.directionPlanReport
                        : null,
                    directionCandidateRepairReport: directionCandidateStage ? directionCandidateStage.repairReport : null,
                    selectedDirectionPromptReport: selectedDirectionPromptStage ? selectedDirectionPromptStage.report : null,
                    directionPlanRepairReport: gates.repairReport,
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
                        message: result.message || '',
                        directionPlans: result.directionPlans || [],
                        directionPlanCount: result.directionPlanCount || 0,
                        candidateDirections: result.candidateDirections || [],
                        candidateDirectionCount: result.candidateDirectionCount || 0,
                        twoStagePromptGeneration: Boolean(selectedDirectionPromptStage),
                        selectedDirectionPromptCount: selectedDirectionPromptStage && selectedDirectionPromptStage.report
                            ? selectedDirectionPromptStage.report.generatedPromptCount
                            : 0
                    },
                    message: agentOnly
                        ? `Agent-only 已生成 ${agentPrompts.length} 条 prompt，方向规划入选 ${directionPlanGate.directionPlanReport.selectedExtensionCount} 个延展${repairMessageSuffix}，Prompt Gate 接受 ${prompts.length} 条，未调用 Legil`
                        : `Agent 已生成 ${agentPrompts.length} 条 prompt，方向规划入选 ${directionPlanGate.directionPlanReport.selectedExtensionCount} 个延展${repairMessageSuffix}，Prompt Gate 接受 ${prompts.length} 条，准备调用 Legil`
                };
                writeRun(store, completedRun);
                updateSelectedDirectionPromptStats(store, selected, {
                    expandedCountDelta: 1,
                    promptCountDelta: prompts.length,
                    lastRunAt: completedRun.completedAt || new Date().toISOString()
                });

                if (agentOnly) {
                    if (prefetch) {
                        return completedRun;
                    }
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
            return null;
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
                return null;
            }
        }

        if (previousRun.status !== 'completed') {
            const stoppedQueue = updateTargetQueueFromRun(store, previousRun, previousRun.status === 'paused' ? 'paused' : 'failed') || queue;
            if (logger && typeof logger.warn === 'function') {
                logger.warn(`Creative target queue stopped after ${previousRun.runId}: ${previousRun.status || 'unknown'}`);
            }
            activeTargetQueue = null;
            return {
                success: false,
                queue: publicTargetQueue(stoppedQueue)
            };
        }

        const completedQueue = updateTargetQueueFromRun(store, previousRun, 'completed') || queue;
        const completedIndex = targetQueueIndexFromRun(previousRun, completedQueue);
        const nextIndex = nextRunnableTargetIndex(completedQueue, completedIndex + 1);
        if (nextIndex >= safeArray(completedQueue.targets).length) {
            const finalQueue = writeTargetQueue(store, {
                ...completedQueue,
                status: 'completed',
                nextIndex: safeArray(completedQueue.targets).length,
                currentIndex: completedIndex,
                currentRunId: previousRun.runId,
                nextAction: '',
                lastError: '',
                nextPreparingRunId: '',
                nextPreparedRunId: '',
                nextPrepareIndex: null,
                nextPreparePhase: '',
                nextPrepareError: '',
                nextPrepareAttempt: 0
            });
            writeSchedulerState(store, {
                targetQueue: publicTargetQueue(finalQueue)
            });
            if (logger && typeof logger.info === 'function') {
                logger.info(`Creative target queue completed: ${completedQueue.queueId}`);
            }
            notifyCreativeTargetQueueFinal(finalQueue, previousRun);
            activeTargetQueue = null;
            return {
                success: true,
                queue: publicTargetQueue(finalQueue),
                completed: true
            };
        }

        if (nextIndex < 0) {
            const finalQueue = writeTargetQueue(store, {
                ...completedQueue,
                status: 'completed',
                nextIndex: safeArray(completedQueue.targets).length,
                currentIndex: completedIndex,
                currentRunId: previousRun.runId,
                nextAction: '',
                lastError: '',
                nextPreparingRunId: '',
                nextPreparedRunId: '',
                nextPrepareIndex: null,
                nextPreparePhase: '',
                nextPrepareError: '',
                nextPrepareAttempt: 0
            });
            writeSchedulerState(store, {
                targetQueue: publicTargetQueue(finalQueue)
            });
            if (logger && typeof logger.info === 'function') {
                logger.info(`Creative target queue completed with skipped targets: ${completedQueue.queueId}`);
            }
            notifyCreativeTargetQueueFinal(finalQueue, previousRun);
            activeTargetQueue = null;
            return {
                success: true,
                queue: publicTargetQueue(finalQueue),
                completed: true
            };
        }

        const preparedRunId = String(completedQueue.nextPreparedRunId || '').trim();
        const preparedIndex = Number(completedQueue.nextPrepareIndex);
        if (preparedRunId && preparedIndex === nextIndex) {
            const preparedRun = store.read(path.join('runs', `${path.basename(preparedRunId)}.json`), null);
            if (preparedRun && preparedRun.status === 'completed' && preparedRun.phase === 'agent_completed') {
                if (logger && typeof logger.info === 'function') {
                    logger.info(`Creative target queue using prefetched run: ${completedQueue.queueId} target ${nextIndex + 1}, run ${preparedRunId}`);
                }
                return startPreparedQueuedTargetLegil({
                    store,
                    queue: completedQueue,
                    previousRun,
                    preparedRun,
                    nextIndex
                });
            }
        }

        const preparingRunId = String(completedQueue.nextPreparingRunId || '').trim();
        const preparingIndex = Number(completedQueue.nextPrepareIndex);
        if (preparingRunId && preparingIndex === nextIndex) {
            const waitingQueue = writeTargetQueue(store, {
                ...completedQueue,
                status: 'running',
                nextIndex,
                currentIndex: completedIndex,
                currentRunId: previousRun.runId,
                nextAction: 'waiting_for_prefetch'
            }) || completedQueue;
            activeTargetQueue = waitingQueue;
            writeSchedulerState(store, {
                targetQueue: publicTargetQueue(waitingQueue)
            });
            setTimeout(() => startNextQueuedTarget(previousRun), TARGET_QUEUE_PREFETCH_WAIT_MS);
            return {
                success: true,
                queue: publicTargetQueue(waitingQueue),
                waitingForPrefetch: true,
                nextIndex
            };
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
            const latestRunId = String(latestQueue.currentRunId || '').trim();
            if (latestRunId && latestRunId !== previousRun.runId) {
                activeTargetQueue = latestQueue;
                if (logger && typeof logger.warn === 'function') {
                    logger.warn(`Creative target queue skipped duplicate next-target start: ${queue.queueId}, active run ${latestRunId}`);
                }
                return;
            }
            const latestCurrentIndex = Math.max(0, Number(latestQueue.currentIndex) || 0);
            const latestNextIndex = Math.max(0, Number(latestQueue.nextIndex) || 0);
            if (latestCurrentIndex !== nextIndex || latestNextIndex !== nextIndex) {
                activeTargetQueue = latestQueue;
                if (logger && typeof logger.warn === 'function') {
                    logger.warn(`Creative target queue skipped stale next-target start: ${queue.queueId}, expected index ${nextIndex}, actual ${latestCurrentIndex}/${latestNextIndex}`);
                }
                return;
            }
            const result = runOnce(nextPayload, queue.context);
            if (!result || result.success === false) {
                const message = result && result.message ? String(result.message) : 'unknown error';
                const refreshedQueue = loadTargetQueue(store, queue.queueId);
                const claimedRunId = refreshedQueue && String(refreshedQueue.currentRunId || '').trim();
                if (/已有自动创意任务正在运行|already running/i.test(message) && claimedRunId && claimedRunId !== previousRun.runId) {
                    activeTargetQueue = refreshedQueue;
                    if (logger && typeof logger.warn === 'function') {
                        logger.warn(`Creative target queue duplicate start ignored after ${queue.queueId}: ${message}`);
                    }
                    return;
                }
                if (result && result.policy && result.policy.allowed === false) {
                    const blockedQueue = updateTargetQueue(store, queue.queueId, {
                        status: 'paused',
                        currentRunId: previousRun.runId || '',
                        currentIndex: nextIndex,
                        nextIndex,
                        nextAction: 'policy_blocked',
                        lastError: message,
                        lastPolicyBlock: result.policy
                    });
                    writeSchedulerState(store, {
                        status: 'idle',
                        currentRunId: null,
                        currentAgentTaskRunId: null,
                        currentLegilTask: null,
                        lastRunId: previousRun.runId || queue.lastRunId || '',
                        lastError: message,
                        targetQueue: publicTargetQueue(blockedQueue || queue)
                    });
                    activeTargetQueue = null;
                    if (logger && typeof logger.warn === 'function') {
                        logger.warn(`Creative target queue paused by policy guard: ${queue.queueId}, ${message}`);
                    }
                    return;
                }
                if (logger && typeof logger.error === 'function') {
                    logger.error(`Creative target queue failed to start next target: ${message}`);
                }
                updateTargetQueue(store, queue.queueId, {
                    status: 'failed',
                    lastError: message
                });
                activeTargetQueue = null;
            }
        }, 1000);

        return {
            success: true,
            queue: publicTargetQueue(queue),
            completed: false,
            nextIndex
        };
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
            if (isWinkyTimeoutError(error && error.message ? error.message : error)) {
                const pausedMessage = 'Winky 连续超时，本轮自动创意已暂停队列，可稍后点击继续重试；如果反复出现，建议缩小批量后再跑。';
                const pausedRun = markRunPaused(store, run, {
                    phase: 'agent_winky_timeout',
                    error: pausedMessage,
                    message: pausedMessage
                });
                notifyCreativeAutoRunFinal(pausedRun, 'paused');
                if (logger && typeof logger.warn === 'function') {
                    logger.warn(pausedMessage);
                }
                return;
            }

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
        const incomingBrief = creativeBriefFromPayload(payload);
        const incomingQueueInfo = incomingBrief && incomingBrief.sequentialQueue ? incomingBrief.sequentialQueue : null;
        const isAutomaticStart = payload.automatic === true ||
            payload.autoStarted === true ||
            context.automatic === true ||
            (incomingQueueInfo && Number(incomingQueueInfo.index) > 1);

        if (isAutomaticStart && typeof options.canPerformAction === 'function') {
            const policyResult = options.canPerformAction('start_loop', {
                module: 'creative-auto',
                automatic: true,
                mode: agentOnly ? 'agent-only' : 'legil-run-once',
                runId: context.previousRunId || '',
                queueId: incomingQueueInfo && incomingQueueInfo.queueId || '',
                queueIndex: incomingQueueInfo && incomingQueueInfo.index || '',
                source: payload.source || context.source || 'creative-auto',
                targetId: payload.targetSelection && payload.targetSelection.targetId || '',
                targetLabel: payload.targetSelection && payload.targetSelection.label || ''
            });
            if (!policyResult.allowed) {
                notifyCreativeAutoBlocked({
                    title: '自动创意启动被 Policy Guard 拦截',
                    message: policyResult.reason || '当前自治策略不允许自动启动闭环任务',
                    level: 'warn',
                    keySuffix: 'policy-start-loop'
                });
                return {
                    success: false,
                    message: policyResult.reason || '当前自治策略不允许自动启动闭环任务',
                    policy: policyResult
                };
            }
        }

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
        const blockingRun = findBlockingRunningRun(store, knowledge.schedulerState);
        if (blockingRun) {
            notifyCreativeAutoBlocked({
                title: '运行一次自动创意未启动',
                message: '已有自动创意任务正在运行',
                keySuffix: 'persisted-running-run'
            });
            return {
                success: false,
                message: '已有自动创意任务正在运行',
                activeRun: blockingRun
            };
        }

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
            store,
            tagStrategy: (payload.directionPlanning && (payload.directionPlanning.tagStrategy || payload.directionPlanning.expansionStrategy))
                || 'stable'
        });
        const selected = {
            ...selectedBase,
            directionSystemContext,
            siblings: directionSystemContext.siblings,
            dimensionCoverage: directionSystemContext.dimensionCoverage,
            exclusionContext: directionSystemContext.exclusionContext,
            visualDnaPreferenceContext: directionSystemContext.visualDnaPreferenceContext,
            directionTagPreferenceContext: directionSystemContext.directionTagPreferenceContext,
            directionTreeSummary: directionSystemContext.directionTreeSummary
        };
        const creativeConfig = appConfig.creative || {};
        const config = {
            ...DEFAULT_AUTO_CONFIG,
            outputFolder: creativeConfig.outputFolder || 'D:\\工作\\自动化工作流1\\创意拓展\\输出',
            referenceFolder: creativeConfig.referenceFolder || knowledge.knowledgeConfig.referenceFolder,
            browserMode: normalizeAutoBrowserMode(creativeConfig.browserMode || DEFAULT_AUTO_CONFIG.browserMode),
            creativePromptStyle: normalizeCreativePromptStyle(payload.creativePromptStyle || creativeConfig.creativePromptStyle || DEFAULT_AUTO_CONFIG.creativePromptStyle),
            directionPlanning: {
                ...DEFAULT_AUTO_CONFIG.directionPlanning,
                ...(creativeConfig.directionPlanning || {}),
                ...(payload.directionPlanning || {})
            },
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
        const runId = `creative_run_${formatRunTimestamp()}_${crypto.randomBytes(3).toString('hex')}`;
        const diversityContext = buildDirectionDiversityContext({
            store,
            selectedDirection: selected.direction,
            payload,
            config,
            runId
        });
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
            historicalCreativeContext,
            diversityContext
        });
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
            directionDiversityContext: diversityContext,
            directionSystemContext,
            instruction,
            promptTotalRaw: 0,
            promptTotalTranslated: 0,
            promptTotal: 0,
            expectedImageTotal: 0,
            directionDefinitions: [],
            prompts: [],
            qualityReport: null,
            directionPlanReport: null,
            directionPlanRepairReport: null,
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
        __test: {
            applyPromptGatesWithRepair,
            appendDirectionExpansionHistory,
            buildDirectionDiversityContext,
            buildDirectionRepairMessages,
            buildSelectedDirectionPromptMessages,
            generateDirectionRepairPrompts,
            generatePromptsForSelectedDirections,
            selectDirectionPlansWithRepair
        },
        continueRunToLegil,
        continueRunFromDirectionReview,
        getDiagnostics,
        getRun,
        getStatus,
        pauseRun,
        retryFailedPrompts,
        resumeRun,
        runOnce
    };
}

module.exports = {
    DEFAULT_AUTO_CONFIG,
    createCreativeAutoService
};
