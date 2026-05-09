/**
 * 截图检查工具
 * 定期截图以便远程查看运行状态
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:3055';
const SCREENSHOT_DIR = path.join(__dirname, 'status-checks');

if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

async function takeStatusScreenshot() {
    console.log(`[${new Date().toLocaleTimeString()}] 📸 正在截图...`);

    let browser;
    try {
        browser = await chromium.launch({ headless: true });
        const page = await browser.newPage({
            viewport: { width: 1400, height: 900 }
        });

        await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(2000);

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `status-check-${timestamp}.png`;
        const filepath = path.join(SCREENSHOT_DIR, filename);

        await page.screenshot({ path: filepath, fullPage: true });
        console.log(`  ✅ 截图已保存: ${filename}`);

        return filepath;
    } catch (error) {
        console.error(`  ❌ 截图失败: ${error.message}`);
        return null;
    } finally {
        if (browser) await browser.close();
    }
}

// 如果直接运行，执行一次截图
if (require.main === module) {
    takeStatusScreenshot().then(filepath => {
        if (filepath) {
            console.log(`\n📄 截图路径: ${filepath}`);
        }
        process.exit(filepath ? 0 : 1);
    });
}

module.exports = { takeStatusScreenshot };
