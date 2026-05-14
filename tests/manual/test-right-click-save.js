/**
 * 右键另存为方式保存 Legil 图片测试
 * 完全独立运行，不依赖服务器
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// 配置
const SAVE_FOLDER = 'D:\\工作\\自动化工作流1\\输出';

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function test() {
    console.log('========================================');
    console.log('Legil 右键另存为保存测试');
    console.log('========================================\n');

    let browser, context, page;

    try {
        // 启动浏览器（有界面）
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

        context = await browser.newContext({
            viewport: { width: 1400, height: 900 }
        });

        page = await context.newPage();

        // 设置下载监听
        console.log('📂 设置下载监听...');
        let downloadPath = null;

        page.on('download', async (download) => {
            console.log('📥 检测到下载事件！');
            console.log(`   文件名: ${download.suggestedFilename()}`);

            // 获取下载的文件路径
            const tempPath = await download.path();
            console.log(`   临时路径: ${tempPath}`);

            if (fs.existsSync(tempPath)) {
                const stats = fs.statSync(tempPath);
                console.log(`   文件大小: ${(stats.size / 1024).toFixed(2)} KB`);

                // 复制到目标文件夹
                if (!fs.existsSync(SAVE_FOLDER)) {
                    fs.mkdirSync(SAVE_FOLDER, { recursive: true });
                }

                const finalName = `legil_test_${Date.now()}.png`;
                const finalPath = path.join(SAVE_FOLDER, finalName);
                fs.copyFileSync(tempPath, finalPath);
                downloadPath = finalPath;

                console.log(`✅ 文件已保存到: ${finalPath}`);
            }
        });

        // 打开 Legil
        console.log('\n🌐 打开 Legil 平台...');
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

        console.log('\n🔍 开始查找图片并右键保存...\n');

        // 查找右侧最新的图片
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
            src: el.src
        })).catch(() => null);

        console.log('找到图片:');
        console.log(`  - 尺寸: ${imgInfo?.width || '?'}x${imgInfo?.height || '?'}`);
        console.log(`  - 地址: ${imgInfo?.src?.substring(0, 60)}...`);

        // 右键点击图片
        console.log('\n🖱️  右键点击图片...');
        await imgElement.click({ button: 'right', force: true });
        await sleep(500);

        // 按 V 键选择"图片另存为"
        console.log('⌨️  按 V 键选择"图片另存为"...');
        await page.keyboard.press('V');

        // 等待下载完成
        console.log('⏳ 等待下载完成（最多10秒）...');
        let waited = 0;
        while (!downloadPath && waited < 10000) {
            await sleep(500);
            waited += 500;
        }

        if (downloadPath) {
            const finalStats = fs.statSync(downloadPath);
            console.log('\n========================================');
            console.log('✅ 保存成功！');
            console.log(`📁 文件路径: ${downloadPath}`);
            console.log(`📊 文件大小: ${(finalStats.size / 1024).toFixed(2)} KB`);
            console.log('========================================');
        } else {
            console.log('\n❌ 下载超时，未检测到下载事件');
            console.log('提示：某些浏览器可能需要手动确认保存对话框');
        }

    } catch (error) {
        console.error('\n❌ 错误:', error.message);
    } finally {
        console.log('\n按 Enter 键关闭浏览器...');
        await new Promise(resolve => process.stdin.once('data', resolve));

        if (browser) {
            await browser.close();
        }
        process.exit(0);
    }
}

test();
