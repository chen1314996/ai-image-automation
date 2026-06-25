const path = require('path');
const crypto = require('crypto');
const {
    CreativeKnowledgeStore,
    readJsonFile,
    writeJsonFile
} = require('../creative-knowledge/store');

const POLICY_FILE = 'policy.json';
const EVENTS_FILE = 'policy-events.json';

const LEVELS = ['L0', 'L1', 'L2', 'L3', 'L4', 'L5'];

const DEFAULT_POLICY = {
    version: 1,
    policyVersion: 1,
    autonomyLevel: 'L2',
    thresholds: {
        autoGoodScore: 85,
        autoGoodConfidence: 0.75,
        maxConsecutiveFailures: 3,
        maxUnscoredAssets: 800
    },
    permissions: {
        allowAutoGood: false,
        allowAutoReject: false,
        allowAutoArchiveReference: false,
        allowAutoDisableDirection: false,
        allowAutoPromoteCanaryRule: false,
        allowAutoStartLoop: false
    },
    updatedAt: ''
};

const ACTIONS = {
    auto_good: {
        label: 'Auto Good',
        permission: 'allowAutoGood',
        requiredLevel: 'L2',
        risk: 'medium',
        modules: ['asset-review', 'weekly-decisions']
    },
    auto_reject: {
        label: 'Auto Reject',
        permission: 'allowAutoReject',
        requiredLevel: 'L3',
        risk: 'high',
        modules: ['asset-review', 'feedback-learning', 'weekly-decisions']
    },
    archive_reference: {
        label: 'Archive Reference',
        permission: 'allowAutoArchiveReference',
        requiredLevel: 'L3',
        risk: 'high',
        modules: ['reference-images', 'visual-dna', 'weekly-decisions']
    },
    disable_direction: {
        label: 'Disable Direction',
        permission: 'allowAutoDisableDirection',
        requiredLevel: 'L3',
        risk: 'critical',
        modules: ['direction-library', 'creative-auto', 'weekly-decisions']
    },
    promote_canary_rule: {
        label: 'Promote Canary Rule',
        permission: 'allowAutoPromoteCanaryRule',
        requiredLevel: 'L3',
        risk: 'high',
        modules: ['prompt-gate', 'feedback-learning', 'weekly-decisions']
    },
    start_loop: {
        label: 'Start Loop',
        permission: 'allowAutoStartLoop',
        requiredLevel: 'L3',
        risk: 'high',
        modules: ['creative-auto', 'legil', 'run-center']
    }
};

const ACTION_ALIASES = {
    autoGood: 'auto_good',
    auto_good: 'auto_good',
    allowAutoGood: 'auto_good',
    autoReject: 'auto_reject',
    auto_reject: 'auto_reject',
    allowAutoReject: 'auto_reject',
    archiveReference: 'archive_reference',
    archive_reference: 'archive_reference',
    autoArchiveReference: 'archive_reference',
    allowAutoArchiveReference: 'archive_reference',
    disableDirection: 'disable_direction',
    disable_direction: 'disable_direction',
    autoDisableDirection: 'disable_direction',
    allowAutoDisableDirection: 'disable_direction',
    promoteCanaryRule: 'promote_canary_rule',
    promote_canary_rule: 'promote_canary_rule',
    highImpactRule: 'promote_canary_rule',
    autoPromoteCanaryRule: 'promote_canary_rule',
    allowAutoPromoteCanaryRule: 'promote_canary_rule',
    startLoop: 'start_loop',
    start_loop: 'start_loop',
    runOnce: 'start_loop',
    autoStartLoop: 'start_loop',
    allowAutoStartLoop: 'start_loop'
};

const THRESHOLD_RANGES = {
    autoGoodScore: { min: 70, max: 95, recommendedMin: 82, recommendedMax: 90 },
    autoGoodConfidence: { min: 0.5, max: 0.95, recommendedMin: 0.7, recommendedMax: 0.85 },
    maxConsecutiveFailures: { min: 1, max: 10, recommendedMin: 2, recommendedMax: 5 },
    maxUnscoredAssets: { min: 100, max: 5000, recommendedMin: 500, recommendedMax: 1200 }
};

function nowIso() {
    return new Date().toISOString();
}

function levelIndex(level) {
    const value = String(level || '').trim().toUpperCase();
    const index = LEVELS.indexOf(value);
    return index >= 0 ? index : LEVELS.indexOf(DEFAULT_POLICY.autonomyLevel);
}

function normalizeLevel(level) {
    const value = String(level || '').trim().toUpperCase();
    return LEVELS.includes(value) ? value : DEFAULT_POLICY.autonomyLevel;
}

function normalizeAction(action) {
    const raw = String(action || '').trim();
    return ACTION_ALIASES[raw] || ACTION_ALIASES[raw.replace(/^policy\./, '')] || raw;
}

function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
}

function toBoolean(value, fallback = false) {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'boolean') return value;
    const text = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on', 'enabled'].includes(text)) return true;
    if (['0', 'false', 'no', 'off', 'disabled'].includes(text)) return false;
    return fallback;
}

function clampNumber(value, fallback, min, max, integer = true) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    const clamped = Math.max(min, Math.min(max, number));
    return integer ? Math.round(clamped) : Number(clamped.toFixed(3));
}

function defaultEvents() {
    return {
        version: 1,
        updatedAt: '',
        events: []
    };
}

function normalizePolicy(raw = {}) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const policy = cloneJson(DEFAULT_POLICY);
    const permissions = source.permissions && typeof source.permissions === 'object' ? source.permissions : {};
    const thresholds = source.thresholds && typeof source.thresholds === 'object' ? source.thresholds : {};

    policy.version = 1;
    policy.policyVersion = Math.max(1, Math.round(Number(source.policyVersion || source.revision || policy.policyVersion) || 1));
    policy.autonomyLevel = normalizeLevel(source.autonomyLevel);
    Object.keys(policy.permissions).forEach(key => {
        policy.permissions[key] = toBoolean(permissions[key], policy.permissions[key]);
    });
    policy.thresholds.autoGoodScore = clampNumber(thresholds.autoGoodScore, policy.thresholds.autoGoodScore, 0, 100);
    policy.thresholds.autoGoodConfidence = clampNumber(thresholds.autoGoodConfidence, policy.thresholds.autoGoodConfidence, 0, 1, false);
    policy.thresholds.maxConsecutiveFailures = clampNumber(thresholds.maxConsecutiveFailures, policy.thresholds.maxConsecutiveFailures, 1, 100);
    policy.thresholds.maxUnscoredAssets = clampNumber(thresholds.maxUnscoredAssets, policy.thresholds.maxUnscoredAssets, 0, 100000);
    policy.updatedAt = source.updatedAt || '';
    return policy;
}

function publicActionCatalog() {
    return Object.entries(ACTIONS).map(([action, config]) => ({
        action,
        ...config
    }));
}

function createEventId(action, createdAt) {
    return `policy_event_${createdAt.replace(/[-:.TZ]/g, '').slice(0, 14)}_${crypto
        .createHash('sha1')
        .update(`${action}:${createdAt}:${Math.random()}`)
        .digest('hex')
        .slice(0, 8)}`;
}

function contextText(context = {}) {
    return [
        context.module,
        context.targetId,
        context.ruleId,
        context.directionId,
        context.runId
    ].map(value => String(value || '').trim()).filter(Boolean).join(' / ');
}

class AutonomyPolicyService {
    constructor(options = {}) {
        this.rootDir = options.rootDir || options.ROOT_DIR || process.cwd();
        this.dataDir = options.dataDir || path.join(this.rootDir, 'data', 'creative-knowledge');
        this.store = options.store || new CreativeKnowledgeStore(this.dataDir);
    }

    ensureBase() {
        this.store.ensureBase();
        const policyPath = this.store.filePath(POLICY_FILE);
        if (!require('fs').existsSync(policyPath)) {
            writeJsonFile(policyPath, normalizePolicy({
                ...DEFAULT_POLICY,
                updatedAt: nowIso()
            }));
        }
        const eventsPath = this.store.filePath(EVENTS_FILE);
        if (!require('fs').existsSync(eventsPath)) {
            writeJsonFile(eventsPath, defaultEvents());
        }
    }

    readPolicy() {
        this.ensureBase();
        const policy = normalizePolicy(readJsonFile(this.store.filePath(POLICY_FILE), DEFAULT_POLICY));
        if (!policy.updatedAt) {
            policy.updatedAt = nowIso();
            this.writePolicy(policy, { bumpVersion: false });
        }
        return policy;
    }

    writePolicy(nextPolicy, options = {}) {
        const current = options.currentPolicy || normalizePolicy(readJsonFile(this.store.filePath(POLICY_FILE), DEFAULT_POLICY));
        const normalized = normalizePolicy(nextPolicy);
        normalized.policyVersion = options.bumpVersion === false
            ? Math.max(1, Number(normalized.policyVersion) || Number(current.policyVersion) || 1)
            : Math.max(Number(current.policyVersion) || 1, Number(normalized.policyVersion) || 1) + 1;
        normalized.updatedAt = nowIso();
        writeJsonFile(this.store.filePath(POLICY_FILE), normalized);
        return normalized;
    }

    readEvents() {
        this.ensureBase();
        const data = readJsonFile(this.store.filePath(EVENTS_FILE), defaultEvents());
        return {
            version: data.version || 1,
            updatedAt: data.updatedAt || '',
            events: Array.isArray(data.events) ? data.events : []
        };
    }

    writeEvents(eventsData) {
        writeJsonFile(this.store.filePath(EVENTS_FILE), {
            version: 1,
            updatedAt: nowIso(),
            events: Array.isArray(eventsData.events) ? eventsData.events.slice(0, 500) : []
        });
    }

    getPolicy() {
        const policy = this.readPolicy();
        return {
            success: true,
            policy,
            actionCatalog: publicActionCatalog(),
            thresholdRanges: THRESHOLD_RANGES,
            preview: this.previewPolicy(policy)
        };
    }

    savePolicy(payload = {}) {
        const current = this.readPolicy();
        const policy = this.writePolicy({
            ...current,
            ...(payload && typeof payload === 'object' ? payload : {}),
            version: 1
        }, { currentPolicy: current });
        this.appendEvent({
            type: 'policy_changed',
            action: 'policy_change',
            allowed: true,
            reason: `Policy saved as version ${policy.policyVersion}`,
            requiredLevel: policy.autonomyLevel,
            currentLevel: policy.autonomyLevel,
            context: {
                source: payload.source || 'autonomy-policy-page',
                beforeVersion: current.policyVersion,
                afterVersion: policy.policyVersion
            },
            decision: {
                status: 'done'
            }
        });
        return {
            success: true,
            message: `策略已保存，版本号 ${policy.policyVersion}`,
            policy,
            preview: this.previewPolicy(policy)
        };
    }

    previewPolicy(policy = this.readPolicy()) {
        const enabled = publicActionCatalog()
            .filter(item => policy.permissions[item.permission] === true)
            .map(item => item.action);
        const blocked = publicActionCatalog()
            .filter(item => policy.permissions[item.permission] !== true || levelIndex(policy.autonomyLevel) < levelIndex(item.requiredLevel))
            .map(item => ({
                action: item.action,
                permission: item.permission,
                requiredLevel: item.requiredLevel,
                reason: policy.permissions[item.permission] !== true
                    ? 'permission_disabled'
                    : 'level_too_low'
            }));
        return {
            autonomyLevel: policy.autonomyLevel,
            enabledActions: enabled,
            blockedActions: blocked,
            affectedModules: Array.from(new Set(
                publicActionCatalog()
                    .filter(item => enabled.includes(item.action))
                    .flatMap(item => item.modules)
            )),
            riskCount: enabled.filter(action => {
                const config = ACTIONS[action];
                return config && ['high', 'critical'].includes(config.risk);
            }).length
        };
    }

    canPerformAction(action, context = {}) {
        const normalizedAction = normalizeAction(action);
        const config = ACTIONS[normalizedAction];
        const policy = this.readPolicy();
        if (!config) {
            const result = {
                allowed: false,
                action: normalizedAction,
                reason: `Unknown policy action: ${String(action || '')}`,
                reasonCode: 'unknown_action',
                requiredLevel: 'L5',
                currentLevel: policy.autonomyLevel
            };
            this.recordDeniedAction(result, context);
            return result;
        }

        const currentLevel = policy.autonomyLevel;
        const requiredLevel = config.requiredLevel;
        if (levelIndex(currentLevel) < levelIndex(requiredLevel)) {
            const result = {
                allowed: false,
                action: normalizedAction,
                reason: `${config.label} requires ${requiredLevel}; current level is ${currentLevel}.`,
                reasonCode: 'level_too_low',
                requiredLevel,
                currentLevel
            };
            this.recordDeniedAction(result, context);
            return result;
        }

        if (policy.permissions[config.permission] !== true) {
            const result = {
                allowed: false,
                action: normalizedAction,
                reason: `${config.permission} is disabled in policy version ${policy.policyVersion}.`,
                reasonCode: 'permission_disabled',
                requiredLevel,
                currentLevel
            };
            this.recordDeniedAction(result, context);
            return result;
        }

        return {
            allowed: true,
            action: normalizedAction,
            reason: 'Allowed by autonomy policy.',
            reasonCode: 'allowed',
            requiredLevel,
            currentLevel,
            policyVersion: policy.policyVersion
        };
    }

    recordDeniedAction(result, context = {}) {
        if (!result || result.allowed === true) return null;
        const existingEvents = this.readEvents();
        const createdAt = nowIso();
        const config = ACTIONS[result.action] || {};
        const event = {
            id: createEventId(result.action || 'unknown', createdAt),
            type: 'policy_denied',
            action: result.action || '',
            actionLabel: config.label || result.action || '',
            allowed: false,
            reason: result.reason || '',
            reasonCode: result.reasonCode || '',
            requiredLevel: result.requiredLevel || '',
            currentLevel: result.currentLevel || '',
            context: {
                ...(context && typeof context === 'object' ? context : {}),
                summary: contextText(context)
            },
            decision: {
                status: 'pending',
                pool: 'weekly',
                recommendedAction: 'review_policy_or_defer',
                title: `Policy denied: ${config.label || result.action || 'unknown action'}`
            },
            createdAt
        };
        existingEvents.events = [event].concat(existingEvents.events || []);
        this.writeEvents(existingEvents);
        return event;
    }

    appendEvent(event = {}) {
        const existingEvents = this.readEvents();
        const createdAt = event.createdAt || nowIso();
        const item = {
            id: event.id || createEventId(event.action || event.type || 'event', createdAt),
            type: event.type || 'policy_event',
            action: event.action || '',
            allowed: event.allowed === true,
            reason: event.reason || '',
            requiredLevel: event.requiredLevel || '',
            currentLevel: event.currentLevel || '',
            context: event.context || {},
            decision: event.decision || {},
            createdAt
        };
        existingEvents.events = [item].concat(existingEvents.events || []);
        this.writeEvents(existingEvents);
        return item;
    }

    listEvents(query = {}) {
        const data = this.readEvents();
        const limit = Math.max(1, Math.min(200, Math.floor(Number(query.limit) || 80)));
        const type = String(query.type || '').trim();
        const events = type
            ? data.events.filter(event => String(event.type || '') === type)
            : data.events;
        return {
            success: true,
            total: events.length,
            events: events.slice(0, limit),
            updatedAt: data.updatedAt || ''
        };
    }
}

function createAutonomyPolicyService(options = {}) {
    return new AutonomyPolicyService(options);
}

module.exports = {
    ACTIONS,
    DEFAULT_POLICY,
    LEVELS,
    THRESHOLD_RANGES,
    AutonomyPolicyService,
    createAutonomyPolicyService,
    normalizeAction
};
