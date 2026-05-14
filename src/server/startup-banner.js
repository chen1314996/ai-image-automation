/**
 * 控制台启动提示。
 *
 * 把较长的启动文案放在这里，让 start.js 保持简短。
 */
function printStartupBanner(PORT) {

    console.log('========================================');
    console.log('🚀 服务器启动成功！');
    console.log('========================================');
    console.log(`📍 请打开浏览器访问: http://localhost:${PORT}`);
    console.log('📂 按 Ctrl+C 可以停止服务器');
    console.log('========================================');
    console.log('✨ 已启用功能：');
    console.log('   ✅ 文件夹图片统计（第二阶段）');
    console.log('   ✅ Playwright 浏览器自动化（第三阶段）');
    console.log('      - 登录状态自动保存（只需登录一次）');
    console.log('   ✅ 实时日志系统（第四阶段）');
    console.log('      - 服务器主动推送日志');
    console.log('   ✅ 豆包大模型 API（第五阶段）');
    console.log('      - 读取本地参考图并调用火山方舟 API');
    console.log('      - 直接返回五组规整提示词');
    console.log('   ✅ API 提示词解析（第六阶段）');
    console.log('      - 不再打开豆包网页，不再等待网页回复');
    console.log('   ✅ Legil 平台自动化（第七阶段）');
    console.log('      - 自动输入提示词生成图片');
    console.log('      - 自动保存生成结果');
    console.log('   ✅ Legil 参考图功能（新增）');
    console.log('      - 自动上传参考图到 Legil');
    console.log('      - 支持循环使用多张参考图');
    console.log('   ✅ 完整工作流自动化（第九阶段）');
    console.log('      - 循环处理所有参考图');
    console.log('      - 豆包 API 生成提示词后自动进入 Legil');
    console.log('========================================');
}

module.exports = {
    printStartupBanner
};
