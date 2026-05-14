/**
 * 在当前页面上测试 Legil 图片保存（保持浏览器运行）
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const STORAGE_STATE_FILE = path.join(__dirname, 'storage_state.json');
const SAVE_FOLDER = 'D:\\工作\\自动化工作流1\\输出';

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function test() {
    console.log('========================================');
    console.log('测试 Legil 图片保存');
    console.log('========================================\n');

    let browser, context, page;

    try {
        // 启动浏览器
        console.log('🚀 启动浏览器...');
        browser = await chromium.launch({
            headless: false,
            slowMo: 100,
            args: [
                '--window-size=1280,800',
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-blink-features=AutomationControlled',
                '--disable-web-security'
            ]
        });

        // 加载存储状态（如果有）
        const contextOptions = { viewport: { width: 1280, height: 800 } };
        if (fs.existsSync(STORAGE_STATE_FILE)) {
            console.log('📂 加载已保存的登录状态...');
            contextOptions.storageState = STORAGE_STATE_FILE;
        }

        context = await browser.newContext(contextOptions);
        page = await context.newPage();

        // 打开 Legil
        console.log('🌐 打开 Legil 平台...');
        await page.goto('https://lumos.diandian.info/legil/image-to-image', {
            waitUntil: 'networkidle',
            timeout: 30000
        });

        console.log('✅ Legil 已打开');
        console.log('💡 请确保已登录并调整好参数，然后按 Enter 键开始测试...');
        console.log('（不要关闭浏览器窗口）\n');

        // 等待用户按 Enter
        await new Promise(resolve => {
            process.stdin.once('data', () => resolve());
        });

        // 测试提示词
        const testPrompt = `A cute cat sitting on a windowsill, soft morning light, digital art style`;
        console.log('\n测试提示词:', testPrompt);
        console.log('');

        // 填入提示词
        console.log('[步骤1/4] 填入提示词...');
        await page.waitForLoadState('networkidle');
        await sleep(2000);

        // 查找输入框
        const inputSelectors = [
            'textarea[placeholder*="描述"]',
            'textarea[placeholder*="提示"]',
            'textarea[placeholder*="prompt"]',
            'textarea',
            'input[type="text"]'
        ];

        let inputElement = null;
        for (const selector of inputSelectors) {
            try {
                inputElement = await page.waitForSelector(selector, { timeout: 2000 });
                if (inputElement) {
                    const isVisible = await inputElement.isVisible().catch(() => false);
                    if (isVisible) {
                        console.log(`找到输入框: ${selector}`);
                        break;
                    }
                }
            } catch (e) {}
        }

        if (!inputElement) {
            // 查找所有 textarea
            const allInputs = await page.$$('textarea, input[type="text"]');
            console.log(`页面中找到 ${allInputs.length} 个可输入元素`);
            for (const el of allInputs) {
                const isVisible = await el.isVisible().catch(() => false);
                if (isVisible) {
                    inputElement = el;
                    break;
                }
            }
        }

        if (!inputElement) {
            throw new Error('未找到输入框');
        }

        await inputElement.click();
        await inputElement.fill('');
        await inputElement.fill(testPrompt);
        console.log('✅ 提示词已填入\n');

        // 点击生成按钮
        console.log('[步骤2/4] 点击生成按钮...');
        const buttonSelectors = [
            'button:has-text("创建图片")',
            'button:has-text("重新生成")',
            'button:has-text("生成")'
        ];

        let buttonFound = false;
        for (const selector of buttonSelectors) {
            try {
                const button = await page.waitForSelector(selector, { timeout: 2000 });
                if (button) {
                    const isVisible = await button.isVisible().catch(() => false);
                    const isEnabled = await button.isEnabled().catch(() => false);
                    if (isVisible && isEnabled) {
                        console.log(`找到生成按钮: ${selector}`);
                        await button.click();
                        console.log('✅ 已点击生成按钮\n');
                        buttonFound = true;
                        break;
                    }
                }
            } catch (e) {}
        }

        if (!buttonFound) {
            throw new Error('未找到生成按钮');
        }

        // 等待生成完成
        console.log('[步骤3/4] 等待图片生成完成（约3-5分钟）...');
        const maxWaitTime = 300000;
        const checkInterval = 3000;
        let waited = 0;

        while (waited < maxWaitTime) {
            await sleep(checkInterval);
            waited += checkInterval;

            const createButton = await page.$('button:has-text("创建图片")');
            if (createButton) {
                const isVisible = await createButton.isVisible().catch(() => false);
                if (isVisible) {
                    console.log('✅ 检测到"创建图片"按钮，生成完成');
                    await sleep(3000);
                    break;
                }
            }

            if (waited % 30000 === 0) {
                console.log(`⏳ 已等待 ${waited / 1000} 秒...`);
            }

            if (waited >= maxWaitTime) {
                throw new Error('等待图片生成超时');
            }
        }

        // 保存图片
        console.log('[步骤4/4] 保存生成的图片...');

        if (!fs.existsSync(SAVE_FOLDER)) {
            fs.mkdirSync(SAVE_FOLDER, { recursive: true });
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
        const fileName = `legil_test_${timestamp}.png`;
        const savePath = path.join(SAVE_FOLDER, fileName);

        // 查找图片
        const imgHandle = await page.evaluateHandle(() => {
            const allImgs = document.querySelectorAll('img');
            let bestImg = null;
            let maxArea = 0;

            for (const img of allImgs) {
                const rect = img.getBoundingClientRect();
                if (rect.left > 400 && rect.width > 100 && rect.height > 100) {
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
            throw new Error('未找到生成的图片');
        }

        // 截图保存
        await imgElement.screenshot({ path: savePath });

        // 验证文件
        const stats = fs.statSync(savePath);
        console.log('\n========================================');
        console.log('✅ 测试成功！');
        console.log('📁 保存路径:', savePath);
        console.log('📊 文件大小:', (stats.size / 1024).toFixed(2), 'KB');

        if (stats.size > 10000) {
            console.log('✅ 文件大小正常（>10KB）');
        } else {
            console.log('⚠️ 文件可能有问题（<10KB）');
        }
        console.log('========================================');

        // 保存登录状态
        await context.storageState({ path: STORAGE_STATE_FILE });
        console.log('\n💾 登录状态已保存');

        console.log('\n按 Enter 键关闭浏览器...');
        await new Promise(resolve => process.stdin.once('data', () => resolve()));

    } catch (error) {
        console.error('\n❌ 测试失败:', error.message);
        console.log('\n按 Enter 键关闭浏览器...');
        await new Promise(resolve => process.stdin.once('data', () => resolve()));
    } finally {
        if (browser) {
            await browser.close();
        }
        process.exit(0);
    }
}

test();
