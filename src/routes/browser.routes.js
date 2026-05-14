/**
 * 浏览器、文件夹选择、图片数量统计相关接口。
 */
module.exports = function registerBrowserRoutes(app, context) {
    const __dirname = context.rootDir;
    const {
        automationState,
        browserController,
        chooseFolderWithNativeDialog,
        doubaoAutomation,
        fs,
        IMAGE_EXTENSIONS,
        logger,
        normalizeInputPath,
        path,
        sortNaturallyByName,
        workflowController
    } = context;

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

        if (typeof folderPath !== 'string' || !folderPath.trim()) {
            console.log('   ❌ 错误：未提供路径');
            return res.json({
                success: false,
                count: 0,
                message: '请提供文件夹路径'
            });
        }

        // 规范化路径：去除引号、trim，并统一使用正斜杠（兼容Windows）
        let normalizedPath = normalizeInputPath(folderPath);

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

            const imageFiles = sortNaturallyByName(files).filter(file => {
                const ext = path.extname(file).toLowerCase();
                return IMAGE_EXTENSIONS.includes(ext);
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
    app.post('/api/select-folder', async (req, res) => {
        const { currentPath } = req.body || {};

        try {
            const result = await chooseFolderWithNativeDialog(typeof currentPath === 'string' ? currentPath : '');
            if (result.cancelled) {
                return res.json({
                    success: false,
                    cancelled: true,
                    message: '已取消选择文件夹'
                });
            }

            if (!result.folderPath) {
                return res.json({
                    success: false,
                    message: '未选择文件夹'
                });
            }

            const validationPath = normalizeInputPath(result.folderPath);
            if (!fs.existsSync(validationPath) || !fs.statSync(validationPath).isDirectory()) {
                return res.json({
                    success: false,
                    message: '选择的路径不是有效文件夹'
                });
            }

            res.json({
                success: true,
                folderPath: result.folderPath,
                message: '文件夹已选择'
            });
        } catch (error) {
            res.json({
                success: false,
                message: '打开文件夹选择器失败: ' + error.message
            });
        }
    });



    app.post('/api/open-website', async (req, res) => {
        const { name, url } = req.body;

        console.log('\n🌐 收到打开网站请求');
        console.log('   名称:', name);
        console.log('   网址:', url);

        // 验证参数
        if (!name) {
            return res.json({
                success: false,
                message: '请提供网站名称'
            });
        }

        if (name === 'doubao') {
            return res.json({
                success: true,
                message: '豆包已改为 API 调用，无需打开豆包网页'
            });
        }

        if (!url) {
            return res.json({
                success: false,
                message: '请提供网站网址'
            });
        }

        if (workflowController.isRunning || automationState.legilTaskRunning) {
            return res.json({
                success: false,
                message: '自动化任务运行中，暂不能切换浏览器页面'
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
     * 请求参数：{ legilUrl: "Legil网址" }
     * 返回数据：{ success: true/false, results: {doubao, legil}, message: "提示信息" }
     */
    app.post('/api/open-both-websites', async (req, res) => {
        const { legilUrl } = req.body;

        console.log('\n🌐 收到打开自动化网站的请求');
        console.log('   豆包: 已改为 API 调用，无需网页');
        console.log('   Legil:', legilUrl);

        // 验证参数
        if (!legilUrl) {
            return res.json({
                success: false,
                message: '请提供 Legil 网站网址'
            });
        }

        if (workflowController.isRunning || automationState.legilTaskRunning) {
            return res.json({
                success: false,
                message: '自动化任务运行中，暂不能重新打开浏览器页面'
            });
        }

        try {
            new URL(legilUrl);
        } catch {
            return res.json({
                success: false,
                message: 'Legil 网址格式不正确'
            });
        }

        try {
            const results = {
                doubao: true,
                legil: false
            };

            // 豆包提示词阶段已改为 API 调用，这里只需要打开 Legil 网页。
            results.legil = await browserController.openWebsite('legil', legilUrl);

            if (results.legil) {
                res.json({
                    success: true,
                    results: results,
                    message: '豆包 API 无需网页，Legil 网站已成功打开'
                });
            } else {
                res.json({
                    success: false,
                    results: results,
                    message: 'Legil 网站打开失败，豆包 API 无需网页'
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
            if (workflowController.isRunning || automationState.legilTaskRunning) {
                return res.json({
                    success: false,
                    message: '自动化任务运行中，请先停止任务再关闭浏览器'
                });
            }

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
                doubao: false,
                legil: browserController.isPageOpen('legil')
            },
            doubaoApiConfigured: doubaoAutomation.getConfig().apiKeyConfigured
        };

        res.json({
            success: true,
            status: status
        });
    });
};
