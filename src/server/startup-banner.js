/**
 * Console startup banner.
 */
function printStartupBanner(PORT) {
    console.log('========================================');
    console.log('服务器启动成功');
    console.log('========================================');
    console.log(`请打开浏览器访问: http://localhost:${PORT}`);
    console.log('按 Ctrl+C 可以停止服务器');
    console.log('========================================');
    console.log('已启用功能:');
    console.log('   - 文件夹图片统计');
    console.log('   - Playwright 浏览器自动化与登录状态保存');
    console.log('   - SSE 实时日志系统');
    console.log('   - Lumos Winky 图文提示词生成');
    console.log('   - Legil 平台自动生图与结果保存');
    console.log('   - 完整工作流自动化');
    console.log('========================================');
}

module.exports = {
    printStartupBanner
};
