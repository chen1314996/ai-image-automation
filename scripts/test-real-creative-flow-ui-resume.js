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
    if (!response.ok) throw new Error(`${pathname} HTTP ${response.status}: ${data.message || JSON.stringify(data).slice(0, 200)}`);
    return data;
}

async function latestRuns(limit = 12) {
    const data = await api(`/api/creative-knowledge/runs?limit=${limit}`);
    return Array.isArray(data.runs) ? data.runs : [];
}

async function getRunFromHistory(runId) {
    const runs = await latestRuns(30);
    return runs.find(run => run.runId === runId) || null;
}

async function waitHistoryRun(runId, predicate, timeoutMs = 240000) {
    const started = Date.now();
    let last = null;
    while (Date.now() - started < timeoutMs) {
        last = await getRunFromHistory(runId);
        if (last && predicate(last)) return last;
        await sleep(3000);
    }
    throw new Error(`等待历史 run 超时：${last ? `${last.status}/${last.phase}/${last.message}` : runId}`);
}

async function loadRunInPage(page, runId) {
    await page.evaluate(async id => {
        if (typeof window.loadCreativeAutoRunFromHistory === 'function') {
            await window.loadCreativeAutoRunFromHistory(id);
        }
    }, runId);
    await page.waitForSelector('#creativeDirectionReviewPanel:not([hidden]) .creative-direction-review-card', { timeout: 30000 });
}

async function main() {
    const existingSummaryPath = path.join(ART, 'summary.json');
    const latest = (await latestRuns(8)).find(run => run.phase === 'pending_direction_review');
    if (!latest) throw new Error('没有找到 pending_direction_review 的真实候选审核 run');
    const runId = latest.runId;

    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
    page.on('dialog', async dialog => { await dialog.accept(); });
    await page.goto('http://localhost:3066', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => window.switchPage && window.switchPage('creative'));
    await page.waitForSelector('#creativePage.active', { timeout: 15000 });
    await loadRunInPage(page, runId);
    await page.screenshot({ path: path.join(ART, '03-candidate-review-resumed-1440.png'), fullPage: false });

    const candidateCheck = await page.locator('#creativeDirectionReviewPanel .creative-direction-review-card').evaluateAll((cards, bannedWords) => cards.map(card => {
        const tags = Array.from(card.querySelectorAll('.creative-direction-review-tags span')).map(element => element.textContent.trim()).filter(Boolean);
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
    const completed = await waitHistoryRun(
        runId,
        current => current.status === 'completed' || ['direction_review_continue_failed', 'prompt_gate_empty'].includes(current.phase),
        240000
    );
    if (completed.phase === 'direction_review_continue_failed') throw new Error(`审核后生成 prompt 失败：${completed.message || completed.lastError}`);
    await page.evaluate(() => window.loadCreativeAutoRunFromHistory && window.loadCreativeAutoRunFromHistory(arguments[0]), runId).catch(() => {});
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(ART, '04-prompt-generated-resumed-1440.png'), fullPage: false });

    const runText = JSON.stringify(completed);
    const editedTags = ['红色信号', '暖光目标', '近景主体'];
    const editedTagsInRun = editedTags.filter(tag => runText.includes(tag));

    const productionSettings = await page.evaluate(() => {
        const details = document.getElementById('creativeLegilGenerationConfigCard');
        const output = document.getElementById('creativeOutputFolder');
        const bar = document.querySelector('#creativeDirectionReviewPanel .creative-direction-review-bottom-bar');
        const cards = Array.from(document.querySelectorAll('#creativeDirectionReviewPanel .creative-direction-review-card')).map(card => {
            const rect = card.getBoundingClientRect();
            return { h: Math.round(rect.height), w: Math.round(rect.width), overflow: card.scrollHeight > card.clientHeight };
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

    await page.evaluate(() => window.switchPage && window.switchPage('knowledge'));
    await page.waitForSelector('#knowledgePage.active', { timeout: 15000 });
    await page.evaluate(() => window.loadCreativeKnowledgePage && window.loadCreativeKnowledgePage({ silent: true }));
    await page.waitForTimeout(3000);
    await page.screenshot({ path: path.join(ART, '06-knowledge-after-flow-resumed-1440.png'), fullPage: false });
    const knowledgeText = await page.locator('#knowledgePage').innerText();

    const prior = fs.existsSync(existingSummaryPath) ? JSON.parse(fs.readFileSync(existingSummaryPath, 'utf8')) : {};
    const summary = {
        ...prior,
        runId,
        stableCandidateCount: cardCountBefore,
        candidateCheck,
        deletedCount,
        draftInfo,
        completed: {
            status: completed.status,
            phase: completed.phase,
            promptTotal: Number(completed.promptTotal) || 0,
            promptRejected: Number(completed.promptTotalRejected) || 0,
            message: completed.message
        },
        editedTagsInRun,
        promptGateReadEditedTags: editedTagsInRun.length >= 2,
        productionSettings,
        knowledgeReturn: {
            hasDraftSignal: /成长|草案|方向/.test(knowledgeText),
            hasEditedTagInKnowledgePage: editedTags.some(tag => knowledgeText.includes(tag))
        },
        screenshotsDir: ART
    };
    fs.writeFileSync(existingSummaryPath, JSON.stringify(summary, null, 2), 'utf8');
    console.log(JSON.stringify(summary, null, 2));
    await browser.close();
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
