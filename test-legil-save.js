/**
 * 测试 Legil 图片保存功能
 * 使用 element.screenshot() 方法
 */

const legilAutomation = require('./legil-automation');

async function test() {
    console.log('开始测试 Legil 图片保存...');
    console.log('=====================================\n');

    // 使用简单测试提示词
    const testPrompt = `A cute cat sitting on a windowsill, soft morning light, digital art style`;

    console.log('提示词:', testPrompt);
    console.log('');

    try {
        const result = await legilAutomation.generateImage(testPrompt, 1);

        console.log('\n=====================================');
        if (result.success) {
            console.log('✅ 测试成功！');
            console.log('📁 保存路径:', result.savePath);

            // 验证文件
            const fs = require('fs');
            const stats = fs.statSync(result.savePath);
            console.log('📊 文件大小:', (stats.size / 1024).toFixed(2), 'KB');

            if (stats.size > 10000) {
                console.log('✅ 文件大小正常（>10KB）');
            } else {
                console.log('⚠️ 文件可能有问题（<10KB）');
            }
        } else {
            console.log('❌ 测试失败:', result.message);
        }
        console.log('=====================================');

        process.exit(result.success ? 0 : 1);
    } catch (error) {
        console.error('❌ 测试出错:', error.message);
        process.exit(1);
    }
}

test();
