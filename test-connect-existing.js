/**
 * 连接到已打开的浏览器页面测试右键保存
 * 使用 Chrome DevTools Protocol (CDP)
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
    console.log('连接到已打开的 Legil 页面');
    console.log('使用右键另存为方式保存');
    console.log('========================================\n');

    let browser = null;

    try {
        // 连接到已打开的浏览器
        console.log('🔌 尝试连接到已打开的浏览器...');
        console.log('   地址: http://localhost:9222');

        try {
            browser = await chromium.connectOverCDP('http://localhost:9222');
            console.log('✅ 成功连接到浏览器\n');
        } catch (e) {
            console.log('❌ 无法连接到浏览器');
            console.log('   可能原因：');
            console.log('   1. 浏览器没有开启远程调试端口');
            console.log('   2. 浏览器已关闭');
            console.log('\n请重新启动服务器后再试');
            process.exit(1);
        }

        // 获取所有上下文和页面
        const contexts = browser.contexts();
        console.log(`📂 找到 ${contexts.length} 个浏览器上下文`);

        let legilPage = null;

        for (const context of contexts) {
            const pages = context.pages();
            console.log(`   上下文中有 ${pages.length} 个页面`);

            for (const page of pages) {
                const url = page.url();
                console.log(`   - ${url.substring(0, 80)}...`);

                if (url.includes('legil') || url.includes('lumos')) {
                    legilPage = page;
                    console.log('   ✅ 找到 Legil 页面！\n');
                    break;
                }
            }
            if (legilPage) break;
        }

        if (!legilPage) {
            throw new Error('未找到 Legil 页面');
        }

        // 设置下载监听
        console.log('📂 设置下载监听...\n');
        let downloadPath = null;

        legilPage.on('download', async (download) => {
            console.log('📥 检测到下载事件！');
            console.log(`   建议文件名: ${download.suggestedFilename()}`);

            const tempPath = await download.path();
            console.log(`   临时路径: ${tempPath}`);

            if (fs.existsSync(tempPath)) {
                const stats = fs.statSync(tempPath);
                console.log(`   文件大小: ${(stats.size / 1024).toFixed(2)} KB`);

                // 复制到目标文件夹
                if (!fs.existsSync(SAVE_FOLDER)) {
                    fs.mkdirSync(SAVE_FOLDER, { recursive: true });
                }

                const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
                const finalName = `legil_${timestamp}.png`;
                const finalPath = path.join(SAVE_FOLDER, finalName);

                fs.copyFileSync(tempPath, finalPath);
                downloadPath = finalPath;

                console.log(`✅ 文件已保存到: ${finalPath}\n`);
            }
        });

        // 在 Legil 页面上执行保存操作
        console.log('🔍 在页面上查找图片...');

        const imgHandle = await legilPage.evaluateHandle(() => {
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
        console.log(`  - 地址: ${imgInfo?.src?.substring(0, 60)}...\n`);

        // 右键点击图片
        console.log('🖱️  右键点击图片...');
        await imgElement.click({ button: 'right', force: true });
        await sleep(500);

        // 按 V 键选择"图片另存为"
        console.log('⌨️  按 V 键选择"图片另存为"...');
        await legilPage.keyboard.press('V');

        // 等待下载完成
        console.log('⏳ 等待下载完成（最多15秒）...');
        let waited = 0;
        while (!downloadPath && waited < 15000) {
            await sleep(500);
            waited += 500;
            process.stdout.write('.');
        }
        console.log('');

        if (downloadPath) {
            const finalStats = fs.statSync(downloadPath);
            console.log('\n========================================');
            console.log('✅ 保存成功！');
            console.log(`📁 文件路径: ${downloadPath}`);
            console.log(`📊 文件大小: ${(finalStats.size / 1024).toFixed(2)} KB`);
            console.log('========================================');
        } else {
            console.log('\n❌ 下载超时');
            console.log('提示：如果弹出保存对话框，请手动保存或检查快捷键设置');
        }

    } catch (error) {
        console.error('\n❌ 错误:', error.message);
    } finally {
        console.log('\n按 Enter 键断开连接...');
        await new Promise(resolve => process.stdin.once('data', resolve));

        if (browser) {
            await browser.close();
        }
        process.exit(0);
    }
}

test();
