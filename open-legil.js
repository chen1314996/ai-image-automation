/**
 * 打开 Legil 平台供用户登录
 */

const browserController = require('./playwright-controller');

async function openLegil() {
    console.log('正在打开 Legil 平台...');
    console.log('网址: https://lumos.diandian.info/legil/image-to-image');
    console.log('\n请登录后告诉我，我会保存登录状态。\n');

    try {
        const success = await browserController.openWebsite(
            'legil',
            'https://lumos.diandian.info/legil/image-to-image'
        );

        if (success) {
            console.log('✅ Legil 平台已打开');
            console.log('请在浏览器中完成登录');
            console.log('登录完成后按 Ctrl+C 关闭此程序，然后告诉我');

            // 保持程序运行
            await new Promise(() => {});
        } else {
            console.log('❌ 打开失败');
            process.exit(1);
        }
    } catch (error) {
        console.error('错误:', error.message);
        process.exit(1);
    }
}

openLegil();
