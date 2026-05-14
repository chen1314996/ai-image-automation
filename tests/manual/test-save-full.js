/**
 * 测试保存完整大图
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
    console.log('测试保存完整大图');
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

        console.log('🔍 查找缩略图...');

        // 找到缩略图元素
        const thumbnailHandle = await legilPage.evaluateHandle(() => {
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

            return bestImg;
        });

        const thumbnailElement = await thumbnailHandle.asElement();
        if (!thumbnailElement) {
            throw new Error('未找到缩略图');
        }

        // 获取缩略图信息
        const thumbInfo = await thumbnailElement.evaluate(el => ({
            src: el.src,
            width: el.naturalWidth,
            height: el.naturalHeight
        }));

        console.log(`找到缩略图: ${thumbInfo.width}x${thumbInfo.height}`);
        console.log('点击缩略图打开大图...');

        // 点击缩略图
        await thumbnailElement.click();
        console.log('已点击，等待弹窗...');

        // 等待弹窗出现
        await sleep(3000);

        // 查找完整大图
        console.log('查找完整大图...');

        const fullImageSrc = await legilPage.evaluate(() => {
            // 方法1：查找弹窗/模态框中的大图
            const modalSelectors = [
                'div[role="dialog"] img',
                '.ant-modal img',
                '[class*="modal"] img',
                '[class*="preview"] img',
                '[class*="lightbox"] img',
                '[class*="fullscreen"] img'
            ];

            for (const selector of modalSelectors) {
                const imgs = document.querySelectorAll(selector);
                for (const img of imgs) {
                    if (img.naturalWidth > 500 && img.naturalHeight > 500) {
                        return img.src;
                    }
                }
            }

            // 方法2：查找页面中最大的图片
            const allImgs = document.querySelectorAll('img');
            let bestImg = null;
            let maxArea = 0;

            for (const img of allImgs) {
                if (img.naturalWidth > 800 && img.naturalHeight > 800) {
                    const area = img.naturalWidth * img.naturalHeight;
                    if (area > maxArea) {
                        maxArea = area;
                        bestImg = img;
                    }
                }
            }

            if (bestImg) {
                return bestImg.src;
            }

            return null;
        });

        let downloadSrc;

        if (!fullImageSrc) {
            console.log('未找到弹窗大图，从缩略图 URL 获取原图...');
            downloadSrc = thumbInfo.src;
            if (downloadSrc.includes('resize')) {
                downloadSrc = downloadSrc.replace(/resize,w_\d+,h_\d+,/, '');
                console.log('已移除 resize 参数');
            }
        } else {
            console.log(`找到完整大图: ${fullImageSrc.substring(0, 80)}...`);
            downloadSrc = fullImageSrc;
        }

        // 下载图片
        console.log('下载图片...');

        const context = legilPage.context();
        const response = await context.request.get(downloadSrc);

        if (!response.ok()) {
            throw new Error(`下载失败: HTTP ${response.status()}`);
        }

        const buffer = await response.body();
        console.log(`下载完成: ${(buffer.length / 1024).toFixed(2)} KB`);

        // 保存文件
        if (!fs.existsSync(SAVE_FOLDER)) {
            fs.mkdirSync(SAVE_FOLDER, { recursive: true });
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
        const fileName = `legil_full_${timestamp}.png`;
        const savePath = path.join(SAVE_FOLDER, fileName);

        fs.writeFileSync(savePath, buffer);

        const stats = fs.statSync(savePath);
        console.log('\n========================================');
        console.log('✅ 保存成功！');
        console.log(`📁 ${savePath}`);
        console.log(`📊 ${(stats.size / 1024).toFixed(2)} KB`);
        console.log('========================================');

        // 关闭弹窗
        await legilPage.keyboard.press('Escape');

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
