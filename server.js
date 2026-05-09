/**
 * ============================================
 * 自动化AI生图网页控制平台 - 服务器端代码
 * ============================================
 * 第四阶段：添加实时日志系统（SSE）
 * 新增：服务器主动向前端推送日志
 */

// 引入 express 模块
const express = require('express');

// 引入 path 模块，用于处理文件路径
const path = require('path');

// 引入 fs 模块，文件系统模块
const fs = require('fs');

// 引入 Playwright 浏览器控制器
const browserController = require('./playwright-controller');

// 引入实时日志系统（第四阶段新增）
const logger = require('./logger');

// 引入豆包自动化模块（第五阶段新增）
const doubaoAutomation = require('./doubao-automation');

// 引入 Legil 自动化模块（第七阶段新增）
const legilAutomation = require('./legil-automation');

// 引入工作流控制器（第九阶段新增）
const workflowController = require('./workflow-controller');

/**
 * ============================================
 * 全局配置存储
 * ============================================
 */
const appConfig = {
    legilReferenceFolder: 'D:\\工作\\自动化工作流1\\Legil参考图'
};

// 创建 express 应用实例
const app = express();

// 设置服务器端口
const PORT = 3055;

/**
 * 配置中间件
 */
app.use(express.json());
app.use(express.static('public'));

/**
 * 主页路由
 */
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/**
 * ============================================
 * API 接口：统计文件夹中的图片数量（第二阶段）
 * ============================================
 */
app.post('/api/count-images', (req, res) => {
    const { folderPath } = req.body;

    // 发送日志到前端
    logger.system('收到统计图片请求');
    logger.info('路径: ' + folderPath);

    console.log('\n📂 收到统计图片请求');
    console.log('   路径:', folderPath);

    if (!folderPath) {
        console.log('   ❌ 错误：未提供路径');
        return res.json({
            success: false,
            count: 0,
            message: '请提供文件夹路径'
        });
    }

    let normalizedPath = folderPath.replace(/["']/g, '').trim();

    try {
        if (!fs.existsSync(normalizedPath)) {
            console.log('   ❌ 错误：路径不存在');
            return res.json({
                success: false,
                count: 0,
                message: '路径不存在，请检查路径是否正确'
            });
        }

        const stats = fs.statSync(normalizedPath);
        if (!stats.isDirectory()) {
            console.log('   ❌ 错误：这不是文件夹');
            return res.json({
                success: false,
                count: 0,
                message: '提供的路径不是文件夹'
            });
        }

        const files = fs.readdirSync(normalizedPath);
        console.log('   📋 文件夹内容:', files);

        const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];

        const imageFiles = files.filter(file => {
            const ext = path.extname(file).toLowerCase();
            return imageExtensions.includes(ext);
        });

        console.log('   🖼️  图片文件:', imageFiles);
        console.log('   ✅ 统计完成，共', imageFiles.length, '张图片\n');

        res.json({
            success: true,
            count: imageFiles.length,
            files: imageFiles,
            message: `成功找到 ${imageFiles.length} 张参考图`
        });

    } catch (error) {
        console.log('   ❌ 错误:', error.message);
        res.json({
            success: false,
            count: 0,
            message: '读取文件夹时出错：' + error.message
        });
    }
});

/**
 * ============================================
 * 新增 API 接口：打开单个网站（第三阶段）
 * ============================================
 *
 * 请求方法：POST
 * 请求路径：/api/open-website
 * 请求参数：{ name: "网站标识", url: "网站地址" }
 * 返回数据：{ success: true/false, message: "提示信息" }
 */
app.post('/api/open-website', async (req, res) => {
    const { name, url } = req.body;

    console.log('\n🌐 收到打开网站请求');
    console.log('   名称:', name);
    console.log('   网址:', url);

    // 验证参数
    if (!name || !url) {
        return res.json({
            success: false,
            message: '请提供网站名称和网址'
        });
    }

    // 验证 URL 格式
    try {
        new URL(url);
    } catch {
        return res.json({
            success: false,
            message: '网址格式不正确'
        });
    }

    try {
        // 调用浏览器控制器打开网站
        const success = await browserController.openWebsite(name, url);

        if (success) {
            res.json({
                success: true,
                message: `已成功打开 ${name}`
            });
        } else {
            res.json({
                success: false,
                message: `打开 ${name} 失败`
            });
        }

    } catch (error) {
        console.error('打开网站时出错:', error);
        res.json({
            success: false,
            message: '服务器错误：' + error.message
        });
    }
});

/**
 * ============================================
 * 新增 API 接口：同时打开两个网站（第三阶段）
 * ============================================
 *
 * 请求方法：POST
 * 请求路径：/api/open-both-websites
 * 请求参数：{ doubaoUrl: "豆包网址", legilUrl: "Legil网址" }
 * 返回数据：{ success: true/false, results: {doubao, legil}, message: "提示信息" }
 */
app.post('/api/open-both-websites', async (req, res) => {
    const { doubaoUrl, legilUrl } = req.body;

    console.log('\n🌐 收到同时打开两个网站的请求');
    console.log('   豆包:', doubaoUrl);
    console.log('   Legil:', legilUrl);

    // 验证参数
    if (!doubaoUrl || !legilUrl) {
        return res.json({
            success: false,
            message: '请提供两个网站的网址'
        });
    }

    try {
        // 调用浏览器控制器同时打开两个网站
        const results = await browserController.openBothWebsites(doubaoUrl, legilUrl);

        // 检查是否都成功打开
        const allSuccess = results.doubao && results.legil;

        if (allSuccess) {
            res.json({
                success: true,
                results: results,
                message: '两个网站都已成功打开'
            });
        } else {
            res.json({
                success: false,
                results: results,
                message: `部分网站打开失败 - 豆包: ${results.doubao ? '成功' : '失败'}, Legil: ${results.legil ? '成功' : '失败'}`
            });
        }

    } catch (error) {
        console.error('打开网站时出错:', error);
        res.json({
            success: false,
            message: '服务器错误：' + error.message
        });
    }
});

/**
 * ============================================
 * 新增 API 接口：关闭浏览器（第三阶段）
 * ============================================
 * 用于测试或重置时关闭浏览器
 */
app.post('/api/close-browser', async (req, res) => {
    console.log('\n🔒 收到关闭浏览器请求');

    try {
        await browserController.closeBrowser();
        res.json({
            success: true,
            message: '浏览器已关闭'
        });
    } catch (error) {
        res.json({
            success: false,
            message: '关闭浏览器时出错：' + error.message
        });
    }
});

/**
 * ============================================
 * 新增 API 接口：获取浏览器状态（第三阶段）
 * ============================================
 * 检查浏览器是否已启动、哪些页面已打开
 */
app.get('/api/browser-status', (req, res) => {
    const status = {
        browserRunning: !!browserController.browser,
        pages: {
            doubao: browserController.isPageOpen('doubao'),
            legil: browserController.isPageOpen('legil')
        }
    };

    res.json({
        success: true,
        status: status
    });
});

/**
 * ============================================
 * 第六阶段：完整自动化流程 API 接口
 * ============================================
 *
 * 请求方法：POST
 * 请求路径：/api/doubao/full-automation
 * 请求参数：{ imagePath: "图片路径" }
 * 返回数据：{ success: true/false, response: "豆包回复", prompts: [...], message: "提示信息" }
 */
app.post('/api/doubao/full-automation', async (req, res) => {
    const { imagePath } = req.body;

    console.log('\n🤖 收到完整自动化流程请求（第六阶段）');
    console.log('   图片路径:', imagePath);

    // 验证参数
    if (!imagePath) {
        return res.json({
            success: false,
            response: null,
            prompts: [],
            message: '请提供图片路径'
        });
    }

    // 验证文件是否存在
    const fs = require('fs');
    if (!fs.existsSync(imagePath)) {
        return res.json({
            success: false,
            response: null,
            prompts: [],
            message: '图片文件不存在'
        });
    }

    try {
        // 调用豆包完整自动化流程（上传+获取+提取）
        const result = await doubaoAutomation.fullAutomation(imagePath);
        res.json(result);

    } catch (error) {
        console.error('完整自动化流程出错:', error);
        res.json({
            success: false,
            response: null,
            prompts: [],
            message: '服务器错误：' + error.message
        });
    }
});

/**
 * ============================================
 * 第六阶段：获取已提取的提示词
 * ============================================
 */
app.get('/api/doubao/extracted-prompts', (req, res) => {
    const prompts = doubaoAutomation.getLastExtractedPrompts();

    if (prompts) {
        res.json({
            success: true,
            prompts: prompts,
            message: `获取到 ${prompts.length} 组提示词`
        });
    } else {
        res.json({
            success: false,
            prompts: [],
            message: '尚未提取提示词，请先运行完整流程'
        });
    }
});

/**
 * ============================================
 * 第七阶段：Legil 平台自动化 API 接口
 * ============================================
 *
 * 请求方法：POST
 * 请求路径：/api/legil/generate
 * 请求参数：{ prompt: "提示词", promptIndex: 序号 }
 * 返回数据：{ success: true/false, savePath: "保存路径", message: "提示信息" }
 */
app.post('/api/legil/generate', async (req, res) => {
    const { prompt, promptIndex } = req.body;

    console.log('\n🎨 收到 Legil 生成图片请求（第七阶段）');
    console.log('   提示词序号:', promptIndex);
    console.log('   提示词预览:', prompt ? prompt.substring(0, 50) + '...' : '未提供');

    // 验证参数
    if (!prompt) {
        return res.json({
            success: false,
            savePath: null,
            message: '请提供提示词'
        });
    }

    try {
        // 调用 Legil 自动化模块
        const result = await legilAutomation.generateImage(prompt, promptIndex || 1);
        res.json(result);

    } catch (error) {
        console.error('Legil 自动化出错:', error);
        res.json({
            success: false,
            savePath: null,
            message: '服务器错误：' + error.message
        });
    }
});

/**
 * ============================================
 * 第七阶段：批量生成五张图片
 * ============================================
 */
app.post('/api/legil/batch-generate', async (req, res) => {
    const { prompts } = req.body;

    console.log('\n🎨 收到 Legil 批量生成请求');
    console.log('   提示词数量:', prompts ? prompts.length : 0);

    if (!prompts || !Array.isArray(prompts) || prompts.length === 0) {
        return res.json({
            success: false,
            results: [],
            message: '请提供提示词数组'
        });
    }

    // 先返回接受请求的消息
    res.json({
        success: true,
        message: `已接受批量生成请求，将生成 ${prompts.length} 张图片。请通过日志查看进度。`,
        total: prompts.length
    });

    // 在后台执行批量生成（不阻塞响应）
    (async () => {
        logger.system('开始批量生成图片...');

        for (let i = 0; i < prompts.length; i++) {
            const promptData = prompts[i];
            const promptText = typeof promptData === 'string' ? promptData : promptData.content;

            logger.info(`正在生成第 ${i + 1}/${prompts.length} 张图片...`);

            try {
                const result = await legilAutomation.generateImage(promptText, i + 1);

                if (result.success) {
                    logger.info(`✅ 第 ${i + 1} 张图片生成成功: ${path.basename(result.savePath)}`);
                } else {
                    logger.error(`❌ 第 ${i + 1} 张图片生成失败: ${result.message}`);
                }

                // 每张图片之间等待 5 秒，避免过于频繁
                if (i < prompts.length - 1) {
                    logger.info('等待 5 秒后继续下一张...');
                    await new Promise(resolve => setTimeout(resolve, 5000));
                }

            } catch (error) {
                logger.error(`❌ 第 ${i + 1} 张图片生成时出错: ${error.message}`);
            }
        }

        logger.system('✅ 批量生成完成！');
    })();
});

/**
 * ============================================
 * 第五阶段：豆包自动化 API 接口（基础版，保留兼容）
 * ============================================
 */
app.post('/api/doubao/upload-and-prompt', async (req, res) => {
    const { imagePath } = req.body;

    console.log('\n🤖 收到豆包自动化请求');
    console.log('   图片路径:', imagePath);

    // 验证参数
    if (!imagePath) {
        return res.json({
            success: false,
            response: null,
            message: '请提供图片路径'
        });
    }

    // 验证文件是否存在
    const fs = require('fs');
    if (!fs.existsSync(imagePath)) {
        return res.json({
            success: false,
            response: null,
            message: '图片文件不存在'
        });
    }

    try {
        // 调用豆包自动化模块
        const result = await doubaoAutomation.uploadAndPrompt(imagePath);
        res.json(result);

    } catch (error) {
        console.error('豆包自动化出错:', error);
        res.json({
            success: false,
            response: null,
            message: '服务器错误：' + error.message
        });
    }
});

/**
 * ============================================
 * 第九阶段：完整工作流 API 接口
 * ============================================
 *
 * 请求方法：POST
 * 请求路径：/api/workflow/start
 * 请求参数：{ inputFolder: "输入文件夹路径", outputFolder: "输出文件夹路径" }
 * 返回数据：{ success: true/false, message: "提示信息", stats: {...} }
 */
app.post('/api/workflow/start', async (req, res) => {
    const { inputFolder, outputFolder, legilReferenceFolder } = req.body;

    console.log('\n🔄 收到完整工作流启动请求（第九阶段）');
    console.log('   输入文件夹:', inputFolder || '使用默认路径');
    console.log('   输出文件夹:', outputFolder || '使用默认路径');
    console.log('   Legil参考图文件夹:', legilReferenceFolder || appConfig.legilReferenceFolder || '使用默认路径');

    // 先返回接受请求的消息
    res.json({
        success: true,
        message: '工作流已启动，请在日志中查看进度'
    });

    // 在后台执行工作流（不阻塞响应）
    (async () => {
        try {
            // 使用配置的Legil参考图文件夹
            const legilRefFolder = legilReferenceFolder || appConfig.legilReferenceFolder;
            const result = await workflowController.startWorkflow(inputFolder, outputFolder, legilRefFolder);
            console.log('\n✅ 工作流执行结果:', result.message);
        } catch (error) {
            console.error('\n❌ 工作流执行出错:', error.message);
            logger.error('工作流执行出错: ' + error.message);
        }
    })();
});

/**
 * ============================================
 * 第九阶段：获取工作流状态
 * ============================================
 */
app.get('/api/workflow/status', (req, res) => {
    const status = workflowController.getStatus();

    res.json({
        success: true,
        status: status,
        message: status.isRunning ? '工作流运行中' : '工作流未运行'
    });
});

/**
 * ============================================
 * 获取工作流最近一次提取的提示词
 * ============================================
 */
app.get('/api/workflow/extracted-prompts', (req, res) => {
    const prompts = workflowController.getLastExtractedPrompts();

    if (prompts) {
        res.json({
            success: true,
            prompts: prompts,
            message: `获取到 ${prompts.length} 组提示词`
        });
    } else {
        res.json({
            success: false,
            prompts: [],
            message: '尚未提取提示词，请先运行工作流'
        });
    }
});

/**
 * ============================================
 * 第九阶段：停止工作流
 * ============================================
 */
app.post('/api/workflow/stop', async (req, res) => {
    console.log('\n⏹️ 收到停止工作流请求');

    const result = await workflowController.stopWorkflow();

    res.json({
        success: result.success,
        message: result.message
    });
});

/**
 * ============================================
 * 新增 API：保存 Legil 参考图文件夹配置
 * ============================================
 */
app.post('/api/config/legil-ref-folder', (req, res) => {
    const { folderPath } = req.body;

    console.log('\n📁 收到 Legil 参考图文件夹配置');
    console.log('   路径:', folderPath);

    if (!folderPath) {
        return res.json({
            success: false,
            message: '请提供文件夹路径'
        });
    }

    // 验证路径是否存在
    try {
        if (!fs.existsSync(folderPath)) {
            return res.json({
                success: false,
                message: '路径不存在，请检查路径是否正确'
            });
        }

        const stats = fs.statSync(folderPath);
        if (!stats.isDirectory()) {
            return res.json({
                success: false,
                message: '提供的路径不是文件夹'
            });
        }

        // 保存配置
        appConfig.legilReferenceFolder = folderPath;
        console.log('   ✅ 配置已保存');

        // 同时更新 legil 自动化模块的配置
        legilAutomation.setReferenceFolder(folderPath);

        res.json({
            success: true,
            message: '配置已保存',
            folderPath: folderPath
        });

    } catch (error) {
        console.error('   ❌ 保存配置失败:', error.message);
        res.json({
            success: false,
            message: '保存配置失败: ' + error.message
        });
    }
});

/**
 * ============================================
 * 新增 API：获取 Legil 参考图文件夹配置
 * ============================================
 */
app.get('/api/config/legil-ref-folder', (req, res) => {
    res.json({
        success: true,
        folderPath: appConfig.legilReferenceFolder,
        message: '获取配置成功'
    });
});

/**
 * ============================================
 * 第四阶段：新增 SSE 日志接口
 * ============================================
 *
 * 使用 SSE（Server-Sent Events）技术实现服务器向客户端推送日志
 * 前端通过 EventSource API 连接此接口，实时接收日志
 *
 * 请求方法：GET
 * 请求路径：/api/logs
 */
app.get('/api/logs', (req, res) => {
    console.log('📡 新的日志客户端正在连接...');

    // 将响应对象交给 logger 管理
    logger.addClient(res);

    // 发送初始连接成功消息
    logger.system('实时日志连接已建立');
});

/**
 * 启动服务器
 */
app.listen(PORT, () => {
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
    console.log('   ✅ 豆包自动化（第五阶段）');
    console.log('      - 自动上传参考图片');
    console.log('      - 自动发送提示词');
    console.log('   ✅ 回复提取（第六阶段）');
    console.log('      - 从回复中提取五组提示词');
    console.log('   ✅ Legil 平台自动化（第七阶段）');
    console.log('      - 自动输入提示词生成图片');
    console.log('      - 自动保存生成结果');
    console.log('   ✅ Legil 参考图功能（新增）');
    console.log('      - 自动上传参考图到 Legil');
    console.log('      - 支持循环使用多张参考图');
    console.log('   ✅ 完整工作流自动化（第九阶段）');
    console.log('      - 循环处理所有参考图');
    console.log('      - 自动新开豆包对话');
    console.log('========================================');
});
