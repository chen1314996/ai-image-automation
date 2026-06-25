const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DELIVERY_JS = path.join(ROOT, 'public', 'js', 'delivery-page.js');
const FEATURE_CSS = path.join(ROOT, 'public', 'css', 'feature-pages.css');

function read(filePath) {
    return fs.readFileSync(filePath, 'utf8');
}

function assertIncludes(text, needle, message) {
    assert.ok(text.includes(needle), message || `Expected text to include ${needle}`);
}

function main() {
    const js = read(DELIVERY_JS);
    const css = read(FEATURE_CSS);

    assertIncludes(js, "sourceReuseTargetCount", 'delivery summary should read sourceReuseTargetCount');
    assertIncludes(js, "legilTargetCount", 'delivery summary should read legilTargetCount');
    assertIncludes(js, "estimatedSavedTargetCount", 'delivery summary should read estimatedSavedTargetCount');
    assertIncludes(js, "源图复用", 'delivery UI should show source reuse text');
    assertIncludes(js, "跳过 Legil", 'delivery UI should show skip Legil text');
    assertIncludes(js, "Legil 候选", 'delivery UI should preserve Legil candidate count text');
    assertIncludes(js, "开始逐张生成三尺寸交付包", 'full delivery button should describe closed-loop delivery');
    assertIncludes(js, "完整交付会逐张闭环输出 final-package", 'flow note should describe closed-loop final output');

    assertIncludes(js, "function isDeliverySourceReuseTarget", 'delivery UI should have source-reuse helper');
    assertIncludes(js, "getDeliveryTargetExpectedCandidateCount", 'delivery UI should compute source-reuse expected count separately');
    assertIncludes(js, "sourceReuse ? 'source-reuse' : status", 'source-reuse targets should not render the pending status pill');
    assertIncludes(js, "sourceReuse ? '源图复用'", 'source-reuse targets should render a source-reuse pill label');
    assertIncludes(js, "candidate.source === 'source-reuse' ? '源图'", 'source-reuse thumbnail should be labeled as source image');

    assertIncludes(css, ".delivery-status-pill.is-source-reuse", 'source-reuse pill should have a distinct style');
    assertIncludes(css, ".delivery-target-cell.is-source-reuse", 'source-reuse cells should have a distinct hook');

    console.log('S11 stage 2 delivery UI static test passed');
}

main();
