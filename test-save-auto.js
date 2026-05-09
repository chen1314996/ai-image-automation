/**
 * 自动测试脚本 - 无需手动按 Enter
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SAVE_FOLDER = 'D:\\工作\\自动化工作流1\\输出';
const STORAGE_STATE = './storage_state.json';

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function testSave() {
    console.log('========================================');
    console.log('Legil 图片保存测试 - 自动版');
    console.log('========================================\n');

    let browser, context, page;

    try {
        console.log('🚀 启动浏览器...');
        browser = await chromium.launch({
            headless: false,
            slowMo: 100,
            args: [
                '--window-size=1400,900',
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage'
            ]
        });

        const contextOptions = { viewport: { width: 1400, height: 900 } };
        if (fs.existsSync(STORAGE_STATE)) {
            console.log('📂 加载已保存的登录状态...');
            contextOptions.storageState = STORAGE_STATE;
        }

        context = await browser.newContext(contextOptions);
        page = await context.newPage();

        console.log('🌐 打开 Legil 平台...');
        await page.goto('https://lumos.diandian.info/legil/image-to-image', {
            waitUntil: 'networkidle',
            timeout: 60000
        });

        console.log('✅ Legil 已打开');
        console.log('⏳ 等待 5 秒让页面稳定...\n');
        await sleep(5000);

        console.log('🔍 开始查找并保存图片...\n');

        if (!fs.existsSync(SAVE_FOLDER)) {
            fs.mkdirSync(SAVE_FOLDER, { recursive: true });
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
        const fileName = `legil_test_${timestamp}.png`;
        const savePath = path.join(SAVE_FOLDER, fileName);

        console.log('查找页面中右侧区域的图片...');

        const imgHandle = await page.evaluateHandle(() => {
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

        const imgElement = await imgHandle.asElement();

        if (!imgElement) {
            throw new Error('未找到符合条件的图片（右侧区域、尺寸大于200x200）');
        }

        const imgInfo = await imgElement.evaluate(el => ({
            width: el.naturalWidth,
            height: el.naturalHeight,
            complete: el.complete,
            src: el.src
        })).catch(() => null);

        console.log(`找到图片:`);
        console.log(`  - 原始尺寸: ${imgInfo?.width || '?'}x${imgInfo?.height || '?'}`);
        console.log(`  - 加载完成: ${imgInfo?.complete ? '是' : '否'}`);
        console.log(`  - 图片地址: ${imgInfo?.src?.substring(0, 80)}...\n`);

        if (!imgInfo?.complete || imgInfo?.width === 0) {
            console.log('等待图片加载完成...');
            await sleep(3000);
        }

        console.log('使用 Playwright element.screenshot() 保存...');
        await imgElement.screenshot({ path: savePath });

        if (fs.existsSync(savePath)) {
            const stats = fs.statSync(savePath);
            console.log('\n========================================');
            console.log('✅ 图片保存成功！');
            console.log(`📁 保存路径: ${savePath}`);
            console.log(`📊 文件大小: ${(stats.size / 1024).toFixed(2)} KB`);

            if (stats.size > 10000) {
                console.log('✅ 文件大小正常（>10KB），图片有效');
            } else if (stats.size > 1000) {
                console.log('⚠️ 文件较小，可能有问题');
            } else {
                console.log('❌ 文件太小，保存失败');
            }
            console.log('========================================');
        } else {
            throw new Error('文件未能保存');
        }

        await context.storageState({ path: STORAGE_STATE });

        console.log('\n💡 请打开保存的图片文件，确认是否正常显示');
        console.log('浏览器将在 10 秒后自动关闭...');
        await sleep(10000);

    } catch (error) {
        console.error('\n❌ 测试失败:', error.message);
        console.log('浏览器将在 5 秒后关闭...');
        await sleep(5000);
    } finally {
        if (browser) {
            await browser.close();
        }
        process.exit(0);
    }
}

testSave();
