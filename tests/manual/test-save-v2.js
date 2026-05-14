/**
 * 右键另存为方式保存 Legil 图片测试 v2
 * 尝试不同的快捷键
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
    console.log('Legil 右键另存为保存测试 v2');
    console.log('========================================\n');

    let browser = null;

    try {
        // 连接到已打开的浏览器
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

        // 设置下载监听
        console.log('📂 设置下载监听...');
        let downloadPath = null;

        legilPage.on('download', async (download) => {
            console.log('\n📥 检测到下载！');
            console.log(`   文件名: ${download.suggestedFilename()}`);

            const tempPath = await download.path();
            if (fs.existsSync(tempPath)) {
                const stats = fs.statSync(tempPath);
                console.log(`   大小: ${(stats.size / 1024).toFixed(2)} KB`);

                if (!fs.existsSync(SAVE_FOLDER)) {
                    fs.mkdirSync(SAVE_FOLDER, { recursive: true });
                }

                const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
                const finalPath = path.join(SAVE_FOLDER, `legil_${timestamp}.png`);
                fs.copyFileSync(tempPath, finalPath);
                downloadPath = finalPath;

                console.log(`✅ 已保存: ${finalPath}`);
            }
        });

        // 查找图片
        console.log('🔍 查找图片...');
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
            throw new Error('未找到图片');
        }

        const imgInfo = await imgElement.evaluate(el => ({
            width: el.naturalWidth,
            height: el.naturalHeight,
            src: el.src
        })).catch(() => null);

        console.log(`找到图片: ${imgInfo?.width}x${imgInfo?.height}`);

        // 尝试多种快捷键方式
        const shortcuts = ['V', 'S', 'v', 's'];

        for (const key of shortcuts) {
            if (downloadPath) break;

            console.log(`\n🖱️  右键点击图片，按 ${key} 键...`);
            await imgElement.click({ button: 'right', force: true });
            await sleep(800);
            await legilPage.keyboard.press(key);

            // 等待下载
            console.log('⏳ 等待下载...');
            let waited = 0;
            while (!downloadPath && waited < 5000) {
                await sleep(500);
                waited += 500;
            }

            if (downloadPath) {
                console.log(`\n✅ 成功！使用 ${key} 键触发下载`);
                break;
            } else {
                console.log(`❌ ${key} 键未触发下载，尝试下一个...`);
                // 按 Escape 关闭菜单
                await legilPage.keyboard.press('Escape');
                await sleep(500);
            }
        }

        if (!downloadPath) {
            console.log('\n⚠️ 所有快捷键都未触发下载');
            console.log('尝试直接通过 fetch 下载图片...');

            // 备用方案：直接在页面内获取图片 blob 并下载
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

                if (!bestImg) return null;

                try {
                    const response = await fetch(bestImg.src);
                    const blob = await response.blob();
                    return {
                        src: bestImg.src,
                        size: blob.size,
                        type: blob.type
                    };
                } catch (e) {
                    return { error: e.message, src: bestImg.src };
                }
            });

            console.log('Fetch 结果:', imageData);
        }

        if (downloadPath) {
            const finalStats = fs.statSync(downloadPath);
            console.log('\n========================================');
            console.log('✅ 保存成功！');
            console.log(`📁 ${downloadPath}`);
            console.log(`📊 ${(finalStats.size / 1024).toFixed(2)} KB`);
            console.log('========================================');
        }

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
