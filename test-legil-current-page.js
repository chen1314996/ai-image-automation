/**
 * 在当前已打开的 Legil 页面上测试图片保存
 * 不关闭浏览器，复用现有页面
 */

const browserController = require('./playwright-controller');
const legilAutomation = require('./legil-automation');
const logger = require('./logger');

async function test() {
    console.log('========================================');
    console.log('在现有页面上测试 Legil 图片保存');
    console.log('========================================\n');

    try {
        // 检查浏览器是否已运行
        if (!browserController.browser) {
            console.log('❌ 浏览器未运行，请先打开浏览器');
            process.exit(1);
        }

        // 获取已打开的 legil 页面
        let page = browserController.getPage('legil');

        if (!page || page.isClosed()) {
            console.log('❌ Legil 页面未找到或已关闭');
            process.exit(1);
        }

        console.log('✅ 找到已打开的 Legil 页面');
        console.log('页面 URL:', await page.url());
        console.log('');

        // 使用简单测试提示词
        const testPrompt = `A cute cat sitting on a windowsill, soft morning light, digital art style`;
        console.log('测试提示词:', testPrompt);
        console.log('');

        // 直接在现有页面上执行自动化流程
        logger.info('========================================');
        logger.info('开始 Legil 自动化流程 - 第 1 张图片');
        logger.info('========================================');

        // 第1步：填入提示词
        logger.info('[步骤1/4] 正在填入提示词...');
        const inputSuccess = await legilAutomation.inputPrompt(page, testPrompt);
        if (!inputSuccess) {
            throw new Error('填入提示词失败');
        }

        // 第2步：点击生成按钮
        logger.info('[步骤2/4] 正在点击生成按钮...');
        const clickSuccess = await legilAutomation.clickGenerateButton(page);
        if (!clickSuccess) {
            throw new Error('点击生成按钮失败');
        }

        // 第3步：等待图片生成完成
        logger.info('[步骤3/4] 等待图片生成完成（约3-5分钟）...');
        const generateSuccess = await legilAutomation.waitForGenerationComplete(page);
        if (!generateSuccess) {
            throw new Error('等待图片生成超时');
        }

        // 第4步：保存生成的图片
        logger.info('[步骤4/4] 正在保存生成的图片...');
        const savePath = await legilAutomation.saveGeneratedImage(page, 1);
        if (!savePath) {
            throw new Error('保存图片失败');
        }

        logger.info('========================================');
        logger.info('✅ 流程完成！图片已保存');
        logger.info(`📁 保存路径: ${savePath}`);
        logger.info('========================================');

        // 验证文件
        const fs = require('fs');
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

        process.exit(0);

    } catch (error) {
        console.error('\n❌ 测试失败:', error.message);
        process.exit(1);
    }
}

test();
