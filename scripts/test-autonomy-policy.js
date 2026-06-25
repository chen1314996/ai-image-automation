const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createAutonomyPolicyService } = require('../src/services/autonomy-policy');

function tempDataDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'autonomy-policy-'));
}

function run() {
    const dataDir = tempDataDir();
    const service = createAutonomyPolicyService({
        rootDir: process.cwd(),
        dataDir
    });

    const initial = service.getPolicy();
    assert.strictEqual(initial.success, true);
    assert.strictEqual(initial.policy.autonomyLevel, 'L2');
    assert.strictEqual(initial.policy.permissions.allowAutoDisableDirection, false);

    const highImpactRule = service.canPerformAction('promote_canary_rule', {
        module: 'prompt-gate',
        ruleId: 'rule_high_impact',
        impact: 'high'
    });
    assert.strictEqual(highImpactRule.allowed, false);
    assert.strictEqual(highImpactRule.requiredLevel, 'L3');
    assert.strictEqual(highImpactRule.currentLevel, 'L2');
    assert.ok(highImpactRule.reason);

    const disableDirection = service.canPerformAction('disable_direction', {
        module: 'direction-library',
        directionId: 'dir_risky'
    });
    assert.strictEqual(disableDirection.allowed, false);
    assert.strictEqual(disableDirection.currentLevel, 'L2');
    assert.ok(disableDirection.reason);

    service.savePolicy({
        autonomyLevel: 'L3',
        permissions: {
            allowAutoGood: false,
            allowAutoReject: false,
            allowAutoArchiveReference: false,
            allowAutoDisableDirection: false,
            allowAutoPromoteCanaryRule: false,
            allowAutoStartLoop: false
        },
        thresholds: initial.policy.thresholds
    });

    const l3NoPermission = service.canPerformAction('promote_canary_rule', {
        module: 'prompt-gate',
        ruleId: 'rule_high_impact'
    });
    assert.strictEqual(l3NoPermission.allowed, false);
    assert.strictEqual(l3NoPermission.reasonCode, 'permission_disabled');
    assert.strictEqual(l3NoPermission.currentLevel, 'L3');

    const saved = service.savePolicy({
        autonomyLevel: 'L3',
        permissions: {
            allowAutoGood: false,
            allowAutoReject: false,
            allowAutoArchiveReference: false,
            allowAutoDisableDirection: false,
            allowAutoPromoteCanaryRule: true,
            allowAutoStartLoop: false
        },
        thresholds: initial.policy.thresholds
    });
    assert.ok(saved.policy.policyVersion >= 3);

    const l3Explicit = service.canPerformAction('promote_canary_rule', {
        module: 'prompt-gate',
        ruleId: 'rule_canary'
    });
    assert.strictEqual(l3Explicit.allowed, true);
    assert.strictEqual(l3Explicit.currentLevel, 'L3');

    const l3StillDenied = service.canPerformAction('disable_direction', {
        module: 'direction-library',
        directionId: 'dir_still_protected'
    });
    assert.strictEqual(l3StillDenied.allowed, false);
    assert.strictEqual(l3StillDenied.reasonCode, 'permission_disabled');

    const events = service.listEvents({ type: 'policy_denied', limit: 20 });
    assert.strictEqual(events.success, true);
    assert.ok(events.events.length >= 4);
    assert.ok(events.events.every(event => event.reason));
    assert.ok(events.events.some(event => event.decision && event.decision.pool === 'weekly'));

    console.log('autonomy policy tests passed');
}

run();
