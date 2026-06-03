const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

function assertContains(fileName, checks) {
    const text = read(fileName);
    checks.forEach(check => {
        const ok = check instanceof RegExp ? check.test(text) : text.includes(check);
        assert.ok(ok, `${fileName} missing ${check.toString()}`);
    });
}

assertContains('public/index.html', [
    'creative-s3-workbench',
    'id="creativeS3DataSourceText"',
    'id="creativeS3TargetText"',
    'id="creativeS3ModeText"',
    'id="creativeS3ProgressText"',
    'id="creativeS3ReviewText"',
    'id="creativeS3DirectionReasons"',
    'id="creativeAutoManualDirection"',
    'id="creativeAutoDirectionId"',
    'id="creativeAutoUseSuggestedDirectionBtn"',
    'id="creativeAutoClearDirectionBtn"',
    'id="creativeAutoDirectionSummary"',
    'id="creativeAutoDirectionSearch"',
    'id="creativeAutoTargetLevelOptions"',
    'id="creativeAutoSelectedTargets"',
    'id="creativeAutoDirectionTree"',
    'name="creativeAutoPromptMode"',
    'value="agentOnly"',
    'value="smoke"',
    'value="full"',
    'id="creativeS3ReviewBtn"',
    'id="creativeRunHistory"',
    'id="creativeAutoRunBtn"',
    'id="creativeAutoProgressPanel"',
    'id="creativeAutoPromptPanel"',
    'id="creativeAutoRecentAssets"',
]);

assertContains('public/js/creative-auto.js', [
    'getCreativeAutoRunSettings',
    'getCreativeAutoManualDirectionId',
    'getCreativeAutoManualDirectionSelection',
    'loadCreativeAutoDirections',
    'getCreativeAutoSelectedDirectionIds',
    'setCreativeAutoTargetLevel',
    'getCreativeAutoDirectionOrder',
    'renderCreativeAutoDirectionTree',
    'toggleCreativeAutoTarget',
    'setCreativeAutoSelectedDirection',
    'directionIds: manualDirection.ids.length',
    'targetSelection: targetSelection || undefined',
    'renderCreativeS3Reasons',
    'updateCreativeS3Flow',
    'loadCreativeS3RunHistory',
    'openCreativeReviewForRun',
    'continueCreativeAutoRunToLegil',
    'renderCreativeAutoPromptPanel',
    'renderCreativeAutoIdlePanels',
    'loadCreativeAutoRecentAssets',
    'renderCreativeAutoRecentAssets',
    '/start-legil',
    '/api/creative-knowledge/assets',
    '/api/creative-knowledge/runs?',
    '/api/creative-auto/run-once',
    'agentOnly: settings.agentOnly',
    'directionId: manualDirection.ids.length === 1'
]);

assertContains('public/css/feature-pages.css', [
    '.creative-s3-workbench',
    '.creative-s3-flow',
    '.creative-s3-step',
    '.creative-direction-picker',
    '.creative-direction-library',
    '.creative-target-level-options',
    '.creative-direction-tree',
    '.creative-direction-card',
    '.creative-selected-targets',
    '.creative-direction-leaf',
    '.creative-prompt-mode',
    '.creative-auto-prompt-panel',
    '.creative-auto-recent-assets',
    '.creative-auto-recent-assets-grid',
    '.creative-s3-review-panel',
    '.creative-run-history-item',
    '.creative-manual-mode',
    '.creative-manual-grid'
]);

console.log('creative page S3 workbench contract passed');
