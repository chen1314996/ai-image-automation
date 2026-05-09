/**
 * 独立测试脚本 - 验证 Legil 图片保存功能
 * 直接在已登录的浏览器页面上测试
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// 配置
const SAVE_FOLDER = 'D:\\工作\\自动化工作流1\\输出';
const STORAGE_STATE = './storage_state.json';

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function testSave() {
    console.log('========================================');
    console.log('Legil 图片保存独立测试');
    console.log('使用 Playwright element.screenshot()');
    console.log('========================================\n');

    let browser, context, page;

    try {
        // 启动浏览器
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

        // 创建上下文
        const contextOptions = { viewport: { width: 1400, height: 900 } };
        if (fs.existsSync(STORAGE_STATE)) {
            console.log('📂 加载已保存的登录状态...');
            contextOptions.storageState = STORAGE_STATE;
        }

        context = await browser.newContext(contextOptions);
        page = await context.newPage();

        // 打开 Legil
        console.log('🌐 打开 Legil 平台...');
        await page.goto('https://lumos.diandian.info/legil/image-to-image', {
            waitUntil: 'networkidle',
            timeout: 60000
        });

        console.log('✅ Legil 已打开\n');
        console.log('💡 请确保：');
        console.log('   1. 已登录 Legil');
        console.log('   2. 已经生成好一张图片');
        console.log('   3. 图片显示在右侧历史区域');
        console.log('\n准备好后按 Enter 键开始保存测试...\n');

        // 等待用户按 Enter
        process.stdin.resume();
        await new Promise(resolve => process.stdin.once('data', resolve));

        console.log('\n🔍 开始查找并保存图片...\n');

        // 确保保存目录存在
        if (!fs.existsSync(SAVE_FOLDER)) {
            fs.mkdirSync(SAVE_FOLDER, { recursive: true });
        }

        // 生成文件名
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
        const fileName = `legil_test_${timestamp}.png`;
        const savePath = path.join(SAVE_FOLDER, fileName);

        console.log('查找页面中右侧区域的图片...');

        // 在浏览器内找到右侧最新/最大的图片
        const imgHandle = await page.evaluateHandle(() => {
            const allImgs = document.querySelectorAll('img');
            let bestImg = null;
            let maxArea = 0;

            for (const img of allImgs) {
                const rect = img.getBoundingClientRect();
                // 筛选条件：
                // 1. 在右侧区域（left > 400）
                // 2. 尺寸足够大（width > 200, height > 200）
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

        // 获取图片信息
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

        // 等待图片完全加载
        if (!imgInfo?.complete || imgInfo?.width === 0) {
            console.log('等待图片加载完成...');
            await sleep(3000);
        }

        // 使用 Playwright 元素截图保存
        // 这是核心方法：绕过 Canvas CORS，直接截取渲染后的元素
        console.log('使用 Playwright element.screenshot() 保存...');
        await imgElement.screenshot({ path: savePath });

        // 验证文件
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

        // 保存登录状态
        await context.storageState({ path: STORAGE_STATE });

        console.log('\n💡 提示：请打开保存的图片文件，确认是否正常显示');
        console.log('按 Enter 键关闭浏览器...');

        await new Promise(resolve => process.stdin.once('data', resolve));

    } catch (error) {
        console.error('\n❌ 测试失败:', error.message);
        console.log('\n按 Enter 键关闭浏览器...');
        await new Promise(resolve => process.stdin.once('data', resolve));
    } finally {
        if (browser) {
            await browser.close();
        }
        process.exit(0);
    }
}

testSave();
