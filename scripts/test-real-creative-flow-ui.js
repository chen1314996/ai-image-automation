const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const ART = path.join(ROOT, 'artifacts', 'real-flow-stage-e');
fs.mkdirSync(ART, { recursive: true });

const banned = ['visualHook', 'visualDna', '氛围', '视角', '事件', '钩子', '视觉 DNA'];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function api(pathname, options = {}) {
    const response = await fetch(`http://localhost:3066${pathname}`, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(`${pathname} HTTP ${response.status}: ${data.message || JSON.stringify(data).slice(0, 200)}`);
    }
    return data;
}

async function waitForRunPhase(runId, predicate, timeoutMs = 240000) {
    const started = Date.now();
    let last = null;
    while (Date.now() - started < timeoutMs) {
        const data = await api('/api/creative-auto/status');
        const run = data.activeRun || data.run || null;
        if (run && (!runId || run.runId === runId)) last = run;
        if (last && predicate(last)) return last;
        await sleep(3000);
    }
    throw new Error(`等待 run 状态超时，最后状态：${last ? `${last.status}/${last.phase}/${last.message}` : '无 run'}`);
}

async function startCreativeRunFromPageBrief(page, overrides = {}) {
    const creativeBrief = await page.evaluate(() => {
        if (typeof buildCreativeAutoRunCreativeBrief === 'function') {
            return buildCreativeAutoRunCreativeBrief();
        }
        return null;
    });
    if (!creativeBrief) throw new Error('页面未生成 creativeBrief，无法启动真实任务');
    const payload = {
        maxPrompts: 1,
        unlimitedPrompts: false,
        fullScale: false,
        agentOnly: true,
        creativePromptStyle: 'cinematic_photo',
        creativeBrief,
        directionPlanning: {
            enabled: true,
            candidateExtensionsPerSource: 2,
            selectedExtensionsPerSource: 1,
            promptsPerExtension: 1,
            diversityMode: 'balanced',
            historyScope: 'recent30',
            candidateMultiplier: 2,
            reviewMode: 'manual',
            tagStrategy: 'stable',
            expansionStrategy: 'stable',
            minScore: 70,
            preferredScore: 85,
            maxRepairAttempts: 2
        },
        directionReview: {
            mode: 'manual'
        },
        ...overrides
    };
    const response = await api('/api/creative-auto/run-once', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    if (!response.success || !response.run) {
        throw new Error(response.message || '启动真实创意拓展任务失败');
    }
    return response.run;
}

async function main() {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
    page.on('dialog', async dialog => {
        await dialog.accept();
    });
    page.on('console', message => {
        if (message.type() === 'error') {
            console.log('[browser console]', message.type(), message.text());
        }
    });

    await page.goto('http://localhost:3066', { waitUntil: 'domcontentloaded' });

    await page.evaluate(() => window.switchPage && window.switchPage('knowledge'));
    await page.waitForSelector('#knowledgeDirectionList .knowledge-direction-item', { timeout: 30000 });
    await page.locator('#knowledgeDirectionList .knowledge-direction-checkbox:not(:disabled)').first().check();
    await page.waitForTimeout(500);
    const selectedSummary = await page.locator('#knowledgeSelectedDirectionSummary').innerText().catch(() => '');
    await page.click('#knowledgeSendSelectedDirectionsBtn');
    await page.waitForSelector('#creativePage.active', { timeout: 15000 });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(ART, '01-creative-first-screen-1440.png'), fullPage: false });

    const firstScreenText = await page.locator('#creativePage').innerText();
    const queueText = await page.locator('#creativeAutoTargetQueuePanel').innerText();
    const firstScreenIsDirectionLed = ['待拓展方向队列', '标签组合策略', '候选方向审核模式', '方向']
        .some(value => firstScreenText.slice(0, 1400).includes(value));

    await page.fill('#creativeAutoNewDirectionsPerSource', '1');
    await page.fill('#creativeAutoPromptsPerNewDirection', '1');
    await page.fill('#creativeAutoCandidateMultiplier', '2');
    await page.selectOption('#creativeAutoTagStrategy', 'stable');
    await page.selectOption('#creativeAutoDirectionReviewMode', 'manual');
    await page.evaluate(() => {
        document.getElementById('creativeAutoNewDirectionsPerSource')?.dispatchEvent(new Event('input', { bubbles: true }));
        document.getElementById('creativeAutoPromptsPerNewDirection')?.dispatchEvent(new Event('input', { bubbles: true }));
        document.getElementById('creativeAutoCandidateMultiplier')?.dispatchEvent(new Event('input', { bubbles: true }));
        document.getElementById('creativeAutoDirectionReviewMode')?.dispatchEvent(new Event('change', { bubbles: true }));
        document.getElementById('creativeAutoTagStrategy')?.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.screenshot({ path: path.join(ART, '02-stable-manual-before-run-1440.png'), fullPage: false });
    const startedRun = await startCreativeRunFromPageBrief(page, {
        directionPlanning: {
            enabled: true,
            candidateExtensionsPerSource: 2,
            selectedExtensionsPerSource: 1,
            promptsPerExtension: 1,
            diversityMode: 'balanced',
            historyScope: 'recent30',
            candidateMultiplier: 2,
            reviewMode: 'manual',
            tagStrategy: 'stable',
            expansionStrategy: 'stable',
            minScore: 70,
            preferredScore: 85,
            maxRepairAttempts: 2
        }
    });
    const run = await waitForRunPhase(startedRun.runId, current => {
        if (['failed', 'cancelled'].includes(current.status)) {
            throw new Error(`创意拓展失败：${current.message || current.lastError || current.phase}`);
        }
        return current.phase === 'pending_direction_review';
    }, 240000);
    await page.evaluate(() => window.loadCreativeAutoStatus && window.loadCreativeAutoStatus());
    await page.waitForSelector('#creativeDirectionReviewPanel:not([hidden]) .creative-direction-review-card', { timeout: 30000 });
    await page.screenshot({ path: path.join(ART, '03-candidate-review-1440.png'), fullPage: false });

    const candidateCheck = await page.locator('#creativeDirectionReviewPanel .creative-direction-review-card').evaluateAll((cards, bannedWords) => cards.map(card => {
        const tags = Array.from(card.querySelectorAll('.creative-direction-review-tags span'))
            .map(element => element.textContent.trim())
            .filter(Boolean);
        const text = card.innerText;
        return {
            title: card.querySelector('strong')?.textContent || '',
            tags,
            tagCount: tags.filter(tag => tag !== '标签待分析').length,
            hasBanned: bannedWords.filter(word => text.includes(word)),
            longOrEnglishTags: tags.filter(tag => tag !== '标签待分析' && (tag.length > 8 || /[a-z]/i.test(tag)))
        };
    }), banned);
    const cardCountBefore = candidateCheck.length;
    if (!cardCountBefore) throw new Error('候选卡片为空');

    const firstCard = page.locator('#creativeDirectionReviewPanel .creative-direction-review-card').first();
    await firstCard.locator('[data-review-field="mainTags"]').fill('红色信号、暖光目标、近景主体');
    await firstCard.locator('[data-review-field="extraTags"]').fill('雪地求生、入口目标');
    await firstCard.locator('[data-review-field="riskTags"]').fill('文字干扰');
    await firstCard.locator('[data-review-field="description"]').fill('真实测试编辑：红色信号和暖光目标指向入口目标，近景主体明确。');

    if (cardCountBefore > 1) {
        await page.locator('#creativeDirectionReviewPanel .creative-direction-review-card').nth(1).locator('button', { hasText: '删除' }).click();
    }
    const deletedCount = await page.locator('#creativeDirectionReviewPanel .creative-direction-review-card.is-deleted').count();

    await firstCard.locator('button', { hasText: '入成长层' }).click();
    await page.waitForFunction(() => /成长层|草案/.test(document.querySelector('#creativeDirectionReviewInfo')?.innerText || ''), null, { timeout: 30000 }).catch(() => {});
    const draftInfo = await page.locator('#creativeDirectionReviewInfo').innerText().catch(() => '');

    await firstCard.locator('button', { hasText: '直接生成 prompt' }).click();
    const completed = await waitForRunPhase(
        run.runId,
        current => current.status === 'completed' || ['direction_review_continue_failed', 'prompt_gate_empty'].includes(current.phase),
        240000
    );
    if (completed.phase === 'direction_review_continue_failed') {
        throw new Error(`审核后生成 prompt 失败：${completed.message || completed.lastError}`);
    }
    await page.evaluate(() => window.loadCreativeAutoStatus && window.loadCreativeAutoStatus());
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(ART, '04-prompt-generated-1440.png'), fullPage: false });

    const runText = JSON.stringify(completed);
    const editedTags = ['红色信号', '暖光目标', '近景主体'];
    const editedTagsInRun = editedTags.filter(tag => runText.includes(tag));
    const promptAccepted = Number(completed.promptTotal) || 0;
    const promptRejected = Number(completed.promptTotalRejected) || 0;

    const productionSettings = await page.evaluate(() => {
        const details = document.getElementById('creativeLegilGenerationConfigCard');
        const output = document.getElementById('creativeOutputFolder');
        const bar = document.querySelector('#creativeDirectionReviewPanel .creative-direction-review-bottom-bar');
        const cards = Array.from(document.querySelectorAll('#creativeDirectionReviewPanel .creative-direction-review-card')).map(card => {
            const rect = card.getBoundingClientRect();
            return {
                h: Math.round(rect.height),
                w: Math.round(rect.width),
                overflow: card.scrollHeight > card.clientHeight
            };
        });
        return {
            settingsVisible: Boolean(details),
            settingsOpen: Boolean(details?.open),
            outputFolder: output?.value || '',
            bottomBar: Boolean(bar),
            bottomBarRect: bar ? (() => {
                const rect = bar.getBoundingClientRect();
                return { top: rect.top, bottom: rect.bottom, height: rect.height };
            })() : null,
            viewportHeight: window.innerHeight,
            cardHeights: cards
        };
    });

    await page.selectOption('#creativeAutoTagStrategy', 'explore');
    await page.selectOption('#creativeAutoDirectionReviewMode', 'manual');
    await page.fill('#creativeAutoNewDirectionsPerSource', '1');
    await page.fill('#creativeAutoPromptsPerNewDirection', '1');
    await page.fill('#creativeAutoCandidateMultiplier', '2');
    await page.evaluate(() => {
        ['creativeAutoTagStrategy', 'creativeAutoDirectionReviewMode'].forEach(id => {
            document.getElementById(id)?.dispatchEvent(new Event('change', { bubbles: true }));
        });
        ['creativeAutoNewDirectionsPerSource', 'creativeAutoPromptsPerNewDirection', 'creativeAutoCandidateMultiplier'].forEach(id => {
            document.getElementById(id)?.dispatchEvent(new Event('input', { bubbles: true }));
        });
    });
    const startedExploreRun = await startCreativeRunFromPageBrief(page, {
        directionPlanning: {
            enabled: true,
            candidateExtensionsPerSource: 2,
            selectedExtensionsPerSource: 1,
            promptsPerExtension: 1,
            diversityMode: 'explore',
            historyScope: 'recent30',
            candidateMultiplier: 2,
            reviewMode: 'manual',
            tagStrategy: 'explore',
            expansionStrategy: 'explore',
            minScore: 70,
            preferredScore: 85,
            maxRepairAttempts: 2
        }
    });
    const exploreRun = await waitForRunPhase(startedExploreRun.runId, current => {
        if (['failed', 'cancelled'].includes(current.status)) {
            throw new Error(`探索拓展失败：${current.message || current.lastError || current.phase}`);
        }
        return current.phase === 'pending_direction_review';
    }, 240000);
    await page.evaluate(() => window.loadCreativeAutoStatus && window.loadCreativeAutoStatus());
    await page.waitForSelector('#creativeDirectionReviewPanel:not([hidden]) .creative-direction-review-card', { timeout: 30000 });
    await page.screenshot({ path: path.join(ART, '05-explore-candidates-1440.png'), fullPage: false });
    const exploreCheck = await page.locator('#creativeDirectionReviewPanel .creative-direction-review-card').evaluateAll(cards => cards.map(card => ({
        title: card.querySelector('strong')?.textContent || '',
        tags: Array.from(card.querySelectorAll('.creative-direction-review-tags span')).map(element => element.textContent.trim()).filter(Boolean),
        text: card.innerText
    })));

    const stableTags = candidateCheck.flatMap(candidate => candidate.tags).filter(Boolean);
    const exploreTags = exploreCheck.flatMap(candidate => candidate.tags).filter(Boolean);
    const newExploreTags = exploreTags.filter(tag => !stableTags.includes(tag));

    await page.evaluate(() => window.switchPage && window.switchPage('knowledge'));
    await page.waitForSelector('#knowledgePage.active', { timeout: 15000 });
    await page.evaluate(() => window.loadCreativeKnowledgePage && window.loadCreativeKnowledgePage({ silent: true }));
    await page.waitForTimeout(3000);
    await page.screenshot({ path: path.join(ART, '06-knowledge-after-flow-1440.png'), fullPage: false });
    const knowledgeText = await page.locator('#knowledgePage').innerText();

    const summary = {
        selectedSummary,
        firstScreenIsDirectionLed,
        queueText: queueText.slice(0, 500),
        runId: run.runId,
        stableCandidateCount: cardCountBefore,
        candidateCheck,
        deletedCount,
        draftInfo,
        completed: {
            status: completed.status,
            phase: completed.phase,
            promptTotal: promptAccepted,
            promptRejected,
            message: completed.message
        },
        editedTagsInRun,
        promptGateReadEditedTags: editedTagsInRun.length >= 2,
        productionSettings,
        explore: {
            runId: exploreRun.runId,
            candidateCount: exploreCheck.length,
            cards: exploreCheck,
            newExploreTags,
            hasNewCombination: newExploreTags.length > 0 || JSON.stringify(exploreCheck) !== JSON.stringify(candidateCheck)
        },
        knowledgeReturn: {
            hasDraftSignal: /成长|草案|方向/.test(knowledgeText),
            hasEditedTagInKnowledgePage: editedTags.some(tag => knowledgeText.includes(tag))
        },
        screenshotsDir: ART
    };
    fs.writeFileSync(path.join(ART, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');
    console.log(JSON.stringify(summary, null, 2));
    await browser.close();
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
