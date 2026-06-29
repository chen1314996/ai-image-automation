const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const ART = path.join(ROOT, 'artifacts', 'direction-tags-visual-ui');
fs.mkdirSync(ART, { recursive: true });

const BASE_URL = 'http://localhost:3066';
const BANNED_VISIBLE_TERMS = ['visualHook', 'visualDna', '视觉 DNA', 'DNA', '氛围', '视角', '事件', '钩子'];
const VIEWPORTS = [
    { key: 'desktop-1440', width: 1440, height: 1000 },
    { key: 'desktop-1920', width: 1920, height: 1080 },
    { key: 'mobile-390', width: 390, height: 844 }
];

function writeSummary(results) {
    fs.writeFileSync(path.join(ART, 'summary.json'), JSON.stringify(results, null, 2), 'utf8');
}

async function api(pathname, options = {}) {
    const response = await fetch(`${BASE_URL}${pathname}`, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(`${pathname} HTTP ${response.status}: ${data.message || JSON.stringify(data).slice(0, 240)}`);
    }
    return data;
}

function screenshotPath(name) {
    return path.join(ART, name);
}

async function saveScreenshot(page, filePath) {
    console.log(`[visual-ui] screenshot start ${path.basename(filePath)}`);
    await Promise.race([
        page.screenshot({ path: filePath, fullPage: false }),
        new Promise(resolve => setTimeout(resolve, 12000))
    ]);
    console.log(`[visual-ui] screenshot done ${path.basename(filePath)}`);
}

async function findReviewRun() {
    const data = await api('/api/creative-knowledge/runs?limit=30');
    const runs = Array.isArray(data.runs) ? data.runs : [];
    return runs.find(run => run.phase === 'pending_direction_review')
        || runs.find(run => run.directionCandidateReview && run.directionCandidateReview.selectedCount)
        || null;
}

async function loadCreativeReview(page, runId) {
    await page.goto(BASE_URL, { waitUntil: 'commit', timeout: 15000 }).catch(async () => {
        await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
    });
    await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
    await page.waitForFunction(() => typeof window.switchPage === 'function', null, { timeout: 20000 });
    await page.evaluate(() => window.switchPage && window.switchPage('creative'));
    await page.waitForSelector('#creativePage.active', { timeout: 15000 });
    await page.evaluate(async id => {
        if (typeof window.loadCreativeAutoRunFromHistory === 'function') {
            await window.loadCreativeAutoRunFromHistory(id);
        }
    }, runId);
    await page.waitForSelector('#creativeDirectionReviewPanel:not([hidden]) .creative-direction-review-card', { timeout: 30000 });
}

async function collectCreativeMetrics(page, viewportKey) {
    return page.evaluate((bannedTerms) => {
        const pageEl = document.getElementById('creativePage');
        const panel = document.getElementById('creativeDirectionReviewPanel');
        const bar = panel && panel.querySelector('.creative-direction-review-bottom-bar');
        const settings = document.getElementById('creativeLegilGenerationConfigCard');
        const output = document.getElementById('creativeOutputFolder');
        const bodyOverflow = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
        const visibleText = panel
            ? panel.textContent
            : (pageEl ? pageEl.textContent.slice(0, 8000) : '');
        const bannedVisible = bannedTerms.filter(term => visibleText.includes(term));
        const cards = Array.from(document.querySelectorAll('#creativeDirectionReviewPanel .creative-direction-review-card')).map((card) => {
            const rect = card.getBoundingClientRect();
            const tags = Array.from(card.querySelectorAll('.creative-direction-review-tags span'))
                .map(element => element.textContent.trim())
                .filter(Boolean);
            const tagBoxes = Array.from(card.querySelectorAll('.creative-direction-review-tags span')).map(element => {
                const box = element.getBoundingClientRect();
                return {
                    text: element.textContent.trim(),
                    width: Math.round(box.width),
                    scrollWidth: element.scrollWidth,
                    clientWidth: element.clientWidth,
                    overflowing: element.scrollWidth > element.clientWidth + 1
                };
            });
            const fields = Array.from(card.querySelectorAll('[data-review-field]')).map(field => {
                const box = field.getBoundingClientRect();
                return {
                    name: field.getAttribute('data-review-field'),
                    width: Math.round(box.width),
                    left: Math.round(box.left),
                    right: Math.round(box.right),
                    visible: box.width > 0 && box.height > 0
                };
            });
            return {
                title: card.querySelector('.creative-direction-review-head strong')?.textContent.trim() || '',
                status: card.dataset.reviewStatus || '',
                width: Math.round(rect.width),
                height: Math.round(rect.height),
                textBanned: bannedTerms.filter(term => card.textContent.includes(term)),
                tags,
                tagCount: tags.filter(tag => tag !== '标签待分析').length,
                nonChineseOrLongTags: tags.filter(tag => tag !== '标签待分析' && (/[A-Za-z]/.test(tag) || tag.length > 8)),
                tagBoxes,
                tagOverflowCount: tagBoxes.filter(item => item.overflowing).length,
                fields,
                fieldOverflowCount: fields.filter(field => field.left < 0 || field.right > window.innerWidth + 1).length,
                scrollOverflow: card.scrollWidth > card.clientWidth + 1
            };
        });
        const heights = cards.map(card => card.height);
        const barRect = bar ? (() => {
            const rect = bar.getBoundingClientRect();
            return {
                top: Math.round(rect.top),
                bottom: Math.round(rect.bottom),
                height: Math.round(rect.height),
                width: Math.round(rect.width),
                visible: rect.width > 0 && rect.height > 0
            };
        })() : null;
        const grid = document.querySelector('#creativeDirectionReviewPanel .creative-direction-review-grid');
        const gridRect = grid ? (() => {
            const rect = grid.getBoundingClientRect();
            return { top: Math.round(rect.top), bottom: Math.round(rect.bottom), height: Math.round(rect.height) };
        })() : null;
        const overlapTop = barRect && gridRect ? Math.max(0, barRect.top, gridRect.top) : 0;
        const overlapBottom = barRect && gridRect ? Math.min(window.innerHeight, barRect.bottom, gridRect.bottom) : 0;
        return {
            viewport: { width: window.innerWidth, height: window.innerHeight },
            bodyOverflow,
            bannedVisible,
            cardCount: cards.length,
            cards,
            cardHeightSpread: heights.length ? Math.max(...heights) - Math.min(...heights) : 0,
            bottomBar: barRect,
            grid: gridRect,
            bottomBarObscuresGrid: Boolean(barRect && gridRect && overlapBottom > overlapTop + 4),
            productionSettings: {
                exists: Boolean(settings),
                open: Boolean(settings && settings.open),
                outputFolder: output ? output.value : ''
            }
        };
    }, BANNED_VISIBLE_TERMS);
}

async function collectKnowledgeMetrics(page) {
    await page.evaluate(() => window.switchPage && window.switchPage('knowledge'));
    await page.waitForSelector('#knowledgePage.active', { timeout: 15000 });
    await page.evaluate(() => window.loadCreativeKnowledgePage && window.loadCreativeKnowledgePage({ silent: true }));
    await page.waitForTimeout(2500);
    return page.evaluate((bannedTerms) => {
        const pageEl = document.getElementById('knowledgePage');
        const text = pageEl ? pageEl.textContent.slice(0, 80000) : '';
        const emptyTags = Array.from(document.querySelectorAll('#knowledgePage .knowledge-dna-tags .is-empty, #knowledgePage .knowledge-direction-tags .is-empty'))
            .map(element => element.textContent.trim())
            .filter(Boolean)
            .slice(0, 12);
        return {
            bannedVisible: bannedTerms.filter(term => text.includes(term)),
            bodyOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
            hasDirectionTagsText: text.includes('方向标签'),
            hasAnalyzeAction: /分析方向标签|重新分析参考图|批量补齐标签/.test(text),
            emptyTagSignals: emptyTags,
            hasReferenceInsufficientSignal: /参考图不足|待补图|0\s*\/\s*3|1\s*\/\s*3|2\s*\/\s*3/.test(text),
            hasFailureSignalCopy: /分析失败|重新分析|待分析/.test(text)
        };
    }, BANNED_VISIBLE_TERMS);
}

async function main() {
    const run = await findReviewRun();
    if (!run) throw new Error('没有可用于视觉验收的候选审核 run');

    const browser = await chromium.launch({ headless: true });
    const results = {
        runId: run.runId,
        screenshotsDir: ART,
        viewports: {}
    };
    writeSummary(results);
    const page = await browser.newPage({
        viewport: { width: VIEWPORTS[0].width, height: VIEWPORTS[0].height },
        deviceScaleFactor: 1
    });
    page.on('dialog', async dialog => dialog.accept());
    let loaded = false;

    for (const viewport of VIEWPORTS) {
        console.log(`[visual-ui] viewport start ${viewport.key}`);
        await page.setViewportSize({ width: viewport.width, height: viewport.height });

        if (!loaded) {
            await loadCreativeReview(page, run.runId);
            loaded = true;
        }
        console.log(`[visual-ui] review loaded ${viewport.key}`);
        if (viewport.key === 'mobile-390') {
            const firstName = page.locator('#creativeDirectionReviewPanel .creative-direction-review-card [data-review-field="name"]').first();
            await firstName.fill('超长方向名测试：暴风雪废墟入口红色信号暖光目标近景主体连续文本不撑破布局');
        }

        const shot = screenshotPath(`creative-review-${viewport.key}.png`);
        await saveScreenshot(page, shot);
        console.log(`[visual-ui] metrics start ${viewport.key}`);
        const creativeMetrics = await collectCreativeMetrics(page, viewport.key);
        console.log(`[visual-ui] metrics done ${viewport.key}`);

        results.viewports[viewport.key] = {
            screenshot: shot,
            knowledgeScreenshot: '',
            creative: creativeMetrics,
            knowledge: null
        };
        writeSummary(results);
        console.log(`[visual-ui] viewport done ${viewport.key}`);
    }

    await page.setViewportSize({ width: 1440, height: 1000 });
    const knowledgeShot = screenshotPath('knowledge-desktop-1440.png');
    const knowledgeMetrics = await collectKnowledgeMetrics(page);
    console.log('[visual-ui] knowledge metrics done');
    await saveScreenshot(page, knowledgeShot);
    if (results.viewports['desktop-1440']) {
        results.viewports['desktop-1440'].knowledge = knowledgeMetrics;
        results.viewports['desktop-1440'].knowledgeScreenshot = knowledgeShot;
        writeSummary(results);
    }

    const failures = [];
    Object.entries(results.viewports).forEach(([key, item]) => {
        const creative = item.creative;
        if (creative.bodyOverflow) failures.push(`${key}: 页面存在横向溢出`);
        if (creative.bannedVisible.length) failures.push(`${key}: 创意拓展可见旧字段 ${creative.bannedVisible.join(', ')}`);
        if (creative.cardCount < 1) failures.push(`${key}: 未渲染候选卡片`);
        if (creative.cardHeightSpread > 220) failures.push(`${key}: 候选卡片高度差异过大 ${creative.cardHeightSpread}px`);
        if (creative.bottomBarObscuresGrid) failures.push(`${key}: 底部操作条遮挡候选网格`);
        if (!creative.productionSettings.exists) failures.push(`${key}: 未找到投产设置`);
        if (creative.productionSettings.open) failures.push(`${key}: 投产设置不是默认收起`);
        if (!creative.productionSettings.outputFolder) failures.push(`${key}: 输出目录为空`);
        creative.cards.forEach((card, index) => {
            if (card.textBanned.length) failures.push(`${key}: 候选卡片 ${index + 1} 可见旧字段 ${card.textBanned.join(', ')}`);
            if (card.tagCount > 5) failures.push(`${key}: 候选卡片 ${index + 1} 主标签超过 5 个`);
            if (card.nonChineseOrLongTags.length) failures.push(`${key}: 候选卡片 ${index + 1} 存在过长或英文标签 ${card.nonChineseOrLongTags.join(', ')}`);
            if (card.tagOverflowCount) failures.push(`${key}: 候选卡片 ${index + 1} 有标签文本溢出`);
            if (card.fieldOverflowCount) failures.push(`${key}: 候选卡片 ${index + 1} 编辑字段超出视口`);
            if (card.scrollOverflow) failures.push(`${key}: 候选卡片 ${index + 1} 自身横向溢出`);
        });
        if (item.knowledge) {
            if (item.knowledge.bodyOverflow) failures.push(`${key}: 知识库页面横向溢出`);
            if (item.knowledge.bannedVisible.length) failures.push(`${key}: 知识库可见旧字段 ${item.knowledge.bannedVisible.join(', ')}`);
            if (!item.knowledge.hasDirectionTagsText) failures.push(`${key}: 知识库没有方向标签文案`);
            if (!item.knowledge.hasAnalyzeAction) failures.push(`${key}: 知识库没有分析方向标签动作`);
        }
    });

    results.failures = failures;
    results.success = failures.length === 0;
    writeSummary(results);
    console.log(JSON.stringify(results, null, 2));
    await Promise.race([
        browser.close().catch(() => {}),
        new Promise(resolve => setTimeout(resolve, 3000))
    ]);

    if (failures.length) process.exit(1);
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
