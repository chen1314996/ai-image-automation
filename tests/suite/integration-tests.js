/**
 * 集成测试 - 测试模块间协作
 */

const TestUtils = require('./test-utils');
const config = require('./test-config');

class IntegrationTests {
    constructor(baseUrl) {
        this.baseUrl = baseUrl || config.server.baseUrl;
        this.utils = new TestUtils();
    }

    async runAll() {
        console.log('\n' + '='.repeat(60));
        console.log('🔗 集成测试');
        console.log('='.repeat(60));

        await this.testConfigToModule();
        await this.testFolderCountToUI();
        await this.testBrowserStatusConsistency();
        await this.testWorkflowStateManagement();

        return this.utils.printReport();
    }

    /**
     * 测试配置保存到模块
     */
    async testConfigToModule() {
        try {
            // 保存配置
            const testPath = 'D:\\TestIntegration';
            const saveRes = await this.utils.request(this.baseUrl + '/api/config/legil-ref-folder', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: { folderPath: testPath }
            });

            if (!saveRes.data.success) {
                this.utils.logTest('配置保存到模块', false, '保存失败');
                return;
            }

            // 获取配置验证
            const getRes = await this.utils.request(this.baseUrl + '/api/config/legil-ref-folder');
            const passed = getRes.data.folderPath === testPath;
            this.utils.logTest('配置保存到模块', passed);

        } catch (e) {
            this.utils.logTest('配置保存到模块', false, e.message);
        }
    }

    /**
     * 测试文件夹统计与UI一致性
     */
    async testFolderCountToUI() {
        try {
            // 获取文件夹统计
            const res = await this.utils.request(this.baseUrl + '/api/count-images', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: { folderPath: config.testData.inputFolder }
            });

            const passed = res.data.success &&
                           typeof res.data.count === 'number' &&
                           Array.isArray(res.data.files);
            this.utils.logTest('文件夹统计API返回格式正确', passed);

            // 验证文件列表不为空（如果有图片）
            if (res.data.count > 0) {
                const hasFiles = res.data.files.length === res.data.count;
                this.utils.logTest('文件列表与计数一致', hasFiles);
            }

        } catch (e) {
            this.utils.logTest('文件夹统计与UI', false, e.message);
        }
    }

    /**
     * 测试浏览器状态一致性
     */
    async testBrowserStatusConsistency() {
        try {
            const res = await this.utils.request(this.baseUrl + '/api/browser-status');

            // 验证状态结构
            const status = res.data.status;
            const hasCorrectStructure =
                typeof status.browserRunning === 'boolean' &&
                typeof status.pages === 'object' &&
                typeof status.pages.doubao === 'boolean' &&
                typeof status.pages.legil === 'boolean';

            this.utils.logTest('浏览器状态API结构正确', hasCorrectStructure);

        } catch (e) {
            this.utils.logTest('浏览器状态一致性', false, e.message);
        }
    }

    /**
     * 测试工作流状态管理
     */
    async testWorkflowStateManagement() {
        try {
            const res = await this.utils.request(this.baseUrl + '/api/workflow/status');

            // 验证状态结构
            const status = res.data.status;
            const hasCorrectStructure =
                typeof status.isRunning === 'boolean' &&
                typeof status.currentIndex === 'number' &&
                typeof status.totalImages === 'number' &&
                typeof status.stats === 'object';

            this.utils.logTest('工作流状态API结构正确', hasCorrectStructure);

            // 验证统计数据
            const stats = status.stats;
            const hasValidStats =
                typeof stats.processed === 'number' &&
                typeof stats.failed === 'number' &&
                typeof stats.totalGenerated === 'number';

            this.utils.logTest('工作流统计数据结构正确', hasValidStats);

        } catch (e) {
            this.utils.logTest('工作流状态管理', false, e.message);
        }
    }
}

module.exports = IntegrationTests;
