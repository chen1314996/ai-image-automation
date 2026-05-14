/**
 * 测试 fetch + blob 方式保存图片
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SAVE_FOLDER = 'D:\\工作\\自动化工作流1\\输出';

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function test() {
    console.log('========================================');
    console.log('测试 fetch + blob 方式保存图片');
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

        // 使用 fetch + blob 方式获取图片
        const imageData = await legilPage.evaluate(async () => {
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

            if (!bestImg) {
                return { error: '未找到图片' };
            }

            try {
                const response = await fetch(bestImg.src);
                const blob = await response.blob();

                return new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onloadend = () => {
                        resolve({
                            success: true,
                            src: bestImg.src,
                            size: blob.size,
                            type: blob.type,
                            base64: reader.result.split(',')[1]
                        });
                    };
                    reader.onerror = () => {
                        resolve({ error: 'FileReader 失败' });
                    };
                    reader.readAsDataURL(blob);
                });

            } catch (e) {
                return { error: e.message };
            }
        });

        if (imageData.error) {
            throw new Error(imageData.error);
        }

        console.log(`✅ 获取图片数据成功！`);
        console.log(`   大小: ${(imageData.size / 1024).toFixed(2)} KB`);
        console.log(`   类型: ${imageData.type}`);
        console.log(`   地址: ${imageData.src.substring(0, 60)}...\n`);

        // 保存文件
        if (!fs.existsSync(SAVE_FOLDER)) {
            fs.mkdirSync(SAVE_FOLDER, { recursive: true });
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
        const fileName = `legil_fetch_${timestamp}.png`;
        const savePath = path.join(SAVE_FOLDER, fileName);

        const buffer = Buffer.from(imageData.base64, 'base64');
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
