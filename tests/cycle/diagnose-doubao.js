/**
 * 豆包页面诊断工具
 * 检查豆包页面状态和元素
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const STORAGE_STATE_FILE = path.join(__dirname, '..', 'storage_state.json');

async function diagnoseDoubao() {
    console.log('🔍 开始诊断豆包页面...\n');

    let browser;
    try {
        // 连接到已运行的浏览器（使用远程调试端口）
        console.log('尝试连接到浏览器...');
        browser = await chromium.connectOverCDP('http://localhost:9223');
        console.log('✅ 已连接到浏览器\n');

        // 获取所有页面
        const contexts = browser.contexts();
        console.log(`找到 ${contexts.length} 个上下文\n`);

        for (let i = 0; i < contexts.length; i++) {
            const context = contexts[i];
            const pages = context.pages();
            console.log(`上下文 ${i + 1}: ${pages.length} 个页面`);

            for (let j = 0; j < pages.length; j++) {
                const page = pages[j];
                const url = page.url();
                const title = await page.title().catch(() => 'N/A');
                console.log(`  页面 ${j + 1}: ${title}`);
                console.log(`    URL: ${url}`);

                // 如果是豆包页面，检查关键元素
                if (url.includes('doubao.com')) {
                    console.log('\n  🔍 检查豆包页面元素...');

                    // 检查文件输入框
                    const fileInput = await page.$('input[type="file"]');
                    console.log(`    文件输入框: ${fileInput ? '✅ 存在' : '❌ 不存在'}`);

                    // 检查输入框
                    const inputSelectors = [
                        'div[contenteditable="true"]',
                        '[class*="chat-input"]',
                        '[class*="message-input"]',
                        'textarea:not([aria-hidden="true"])'
                    ];

                    let inputFound = false;
                    for (const selector of inputSelectors) {
                        const el = await page.$(selector);
                        if (el) {
                            const visible = await el.isVisible().catch(() => false);
                            if (visible) {
                                console.log(`    输入框 (${selector}): ✅ 可见`);
                                inputFound = true;
                                break;
                            }
                        }
                    }
                    if (!inputFound) {
                        console.log(`    输入框: ❌ 未找到可见元素`);
                    }

                    // 检查是否有错误信息
                    const errorSelectors = [
                        'text=错误',
                        'text=失败',
                        'text=请重试',
                        '[class*="error"]',
                        '[class*="failed"]'
                    ];

                    for (const selector of errorSelectors) {
                        try {
                            const el = await page.$(selector);
                            if (el) {
                                const text = await el.textContent().catch(() => '');
                                if (text) {
                                    console.log(`    ⚠️  可能的错误: ${text.substring(0, 100)}`);
                                }
                            }
                        } catch (e) {}
                    }

                    // 检查页面内容
                    const bodyText = await page.$eval('body', el => el.innerText).catch(() => '');
                    if (bodyText.includes('登录')) {
                        console.log('    ⚠️  页面显示登录按钮，可能需要重新登录');
                    }
                    if (bodyText.includes('验证')) {
                        console.log('    ⚠️  页面显示验证相关内容');
                    }

                    // 截图保存
                    const screenshotPath = path.join(__dirname, 'diagnose-doubao.png');
                    await page.screenshot({ path: screenshotPath, fullPage: true });
                    console.log(`\n    📸 截图已保存: ${screenshotPath}`);
                }
            }
        }

        console.log('\n✅ 诊断完成');

    } catch (error) {
        console.error('\n❌ 诊断失败:', error.message);
        console.log('\n请确保:');
        console.log('  1. 服务器正在运行 (npm start)');
        console.log('  2. 浏览器已打开 (点击"打开网站"按钮)');
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

diagnoseDoubao();
