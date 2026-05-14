/**
 * 直接下载测试 - 使用 request API
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SAVE_FOLDER = 'D:\\工作\\自动化工作流1\\输出';

async function test() {
    console.log('========================================');
    console.log('测试 request API 直接下载');
    console.log('========================================\n');

    let browser = null;

    try {
        console.log('🔌 连接到浏览器...');
        browser = await chromium.connectOverCDP('http://localhost:9222');
        console.log('✅ 已连接\n');

        // 找到 Legil 页面
        const contexts = browser.contexts();
        let legilPage = null;

        for (const context of contexts) {
            for (const page of context.pages()) {
                if (page.url().includes('legil')) {
                    legilPage = page;
                    break;
                }
            }
        }

        if (!legilPage) {
            throw new Error('未找到 Legil 页面');
        }

        console.log('🔍 查找图片...');

        // 获取图片地址
        const imgSrc = await legilPage.evaluate(() => {
            const allImgs = document.querySelectorAll('img');
            let bestImg = null;
            let maxArea = 0;

            for (const img of allImgs) {
                const rect = img.getBoundingClientRect();
                if (rect.left > 400 && rect.width > 200 && rect.height > 200) {
                    const area = rect.width * rect.height;
                    if (area > maxArea) {
                        maxArea = area;
                        bestImg = img;
                    }
                }
            }

            return bestImg ? bestImg.src : null;
        });

        if (!imgSrc) {
            throw new Error('未找到图片');
        }

        console.log(`找到图片地址: ${imgSrc.substring(0, 60)}...\n`);

        // 使用 request API 下载
        console.log('使用 Playwright request API 下载...');
        const context = legilPage.context();
        const response = await context.request.get(imgSrc);

        if (!response.ok()) {
            throw new Error(`下载失败: HTTP ${response.status()}`);
        }

        const buffer = await response.body();
        console.log(`下载完成: ${(buffer.length / 1024).toFixed(2)} KB\n`);

        // 保存文件
        if (!fs.existsSync(SAVE_FOLDER)) {
            fs.mkdirSync(SAVE_FOLDER, { recursive: true });
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
        const fileName = `legil_request_${timestamp}.png`;
        const savePath = path.join(SAVE_FOLDER, fileName);

        fs.writeFileSync(savePath, buffer);

        const stats = fs.statSync(savePath);
        console.log('========================================');
        console.log('✅ 保存成功！');
        console.log(`📁 ${savePath}`);
        console.log(`📊 ${(stats.size / 1024).toFixed(2)} KB`);
        console.log('========================================');

    } catch (error) {
        console.error('\n❌ 错误:', error.message);
    } finally {
        console.log('\n按 Enter 关闭...');
        await new Promise(resolve => process.stdin.once('data', resolve));
        if (browser) await browser.close();
        process.exit(0);
    }
}

test();
