/**
 * API接口测试
 */

const TestUtils = require('./test-utils');
const config = require('./test-config');

class APITests {
    constructor(baseUrl) {
        this.baseUrl = baseUrl || config.server.baseUrl;
        this.utils = new TestUtils();
    }

    async runAll() {
        console.log('\n' + '='.repeat(60));
        console.log('🔌 API接口测试');
        console.log('='.repeat(60));

        await this.testServerHealth();
        await this.testCountImages();
        await this.testConfigEndpoints();
        await this.testBrowserStatus();
        await this.testWorkflowStatus();

        return this.utils.printReport();
    }

    /**
     * 测试服务器健康状态
     */
    async testServerHealth() {
        try {
            const res = await this.utils.request(this.baseUrl + '/');
            const passed = res.status === 200 && res.data.includes('<!DOCTYPE html>');
            this.utils.logTest('服务器首页访问', passed, `状态码: ${res.status}`);
        } catch (e) {
            this.utils.logTest('服务器首页访问', false, e.message);
        }
    }

    /**
     * 测试统计图片接口
     */
    async testCountImages() {
        // 测试空路径
        try {
            const res = await this.utils.request(this.baseUrl + '/api/count-images', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: { folderPath: '' }
            });
            const passed = !res.data.success && res.data.message.includes('路径');
            this.utils.logTest('统计图片-空路径校验', passed);
        } catch (e) {
            this.utils.logTest('统计图片-空路径校验', false, e.message);
        }

        // 测试无效路径
        try {
            const res = await this.utils.request(this.baseUrl + '/api/count-images', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: { folderPath: 'C:\\NonExistentPath' }
            });
            const passed = !res.data.success;
            this.utils.logTest('统计图片-无效路径', passed);
        } catch (e) {
            this.utils.logTest('统计图片-无效路径', false, e.message);
        }

        // 测试有效路径
        try {
            const res = await this.utils.request(this.baseUrl + '/api/count-images', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: { folderPath: config.testData.inputFolder }
            });
            const passed = res.data.success && typeof res.data.count === 'number';
            this.utils.logTest('统计图片-有效路径', passed, `找到 ${res.data.count} 张图片`);
        } catch (e) {
            this.utils.logTest('统计图片-有效路径', false, e.message);
        }
    }

    /**
     * 测试配置接口
     */
    async testConfigEndpoints() {
        // 保存配置
        try {
            const res = await this.utils.request(this.baseUrl + '/api/config/legil-ref-folder', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: { folderPath: config.testData.legilRefFolder }
            });
            const passed = res.data.success;
            this.utils.logTest('保存Legil配置', passed);
        } catch (e) {
            this.utils.logTest('保存Legil配置', false, e.message);
        }

        // 获取配置
        try {
            const res = await this.utils.request(this.baseUrl + '/api/config/legil-ref-folder');
            const passed = res.data.success && res.data.folderPath;
            this.utils.logTest('获取Legil配置', passed);
        } catch (e) {
            this.utils.logTest('获取Legil配置', false, e.message);
        }
    }

    /**
     * 测试浏览器状态接口
     */
    async testBrowserStatus() {
        try {
            const res = await this.utils.request(this.baseUrl + '/api/browser-status');
            const passed = res.data.success &&
                typeof res.data.status.browserRunning === 'boolean';
            this.utils.logTest('获取浏览器状态', passed);
        } catch (e) {
            this.utils.logTest('获取浏览器状态', false, e.message);
        }
    }

    /**
     * 测试工作流状态接口
     */
    async testWorkflowStatus() {
        try {
            const res = await this.utils.request(this.baseUrl + '/api/workflow/status');
            const passed = res.data.success &&
                typeof res.data.status.isRunning === 'boolean';
            this.utils.logTest('获取工作流状态', passed);
        } catch (e) {
            this.utils.logTest('获取工作流状态', false, e.message);
        }
    }
}

module.exports = APITests;
