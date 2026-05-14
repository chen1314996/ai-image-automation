/**
 * 完整测试运行器
 */

const TestUtils = require('./test-utils');
const config = require('./test-config');
const APITests = require('./api-tests');
const FunctionTests = require('./function-tests');
const IntegrationTests = require('./integration-tests');

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

class TestRunner {
    constructor() {
        this.utils = new TestUtils();
        this.serverProcess = null;
        this.results = {
            api: null,
            function: null,
            integration: null
        };
    }

    async run() {
        console.log('='.repeat(70));
        console.log('🧪 AI生图自动化平台 - 完整测试套件');
        console.log('='.repeat(70));

        // 设置测试数据
        this.utils.setupTestData(config.testData);

        // 启动测试服务器
        const serverStarted = await this.startTestServer();
        if (!serverStarted) {
            console.error('❌ 无法启动测试服务器，测试中止');
            process.exit(1);
        }

        // 等待服务器启动
        await this.utils.sleep(3000);

        try {
            // 运行API测试
            const apiTests = new APITests(config.server.baseUrl);
            this.results.api = await apiTests.runAll();

            // 运行功能测试
            const funcTests = new FunctionTests(config.server.baseUrl);
            this.results.function = await funcTests.runAll();

            // 运行集成测试
            const intTests = new IntegrationTests(config.server.baseUrl);
            this.results.integration = await intTests.runAll();

        } finally {
            // 停止服务器
            await this.stopTestServer();

            // 清理测试数据
            this.utils.cleanupTestData(config.testData);
        }

        // 生成最终报告
        this.generateFinalReport();
    }

    async startTestServer() {
        console.log('\n🚀 启动测试服务器...');

        return new Promise((resolve) => {
            // 复制server.js到测试端口
            const testServerPath = path.join(__dirname, '..', '..', 'server.js');

            this.serverProcess = spawn('node', [testServerPath], {
                env: { ...process.env, PORT: config.server.port },
                stdio: 'pipe'
            });

            let started = false;

            this.serverProcess.stdout.on('data', (data) => {
                const output = data.toString();
                if (output.includes('服务器启动成功')) {
                    console.log('✅ 测试服务器已启动');
                    started = true;
                    resolve(true);
                }
            });

            this.serverProcess.stderr.on('data', (data) => {
                const output = data.toString();
                // 端口占用错误
                if (output.includes('EADDRINUSE')) {
                    console.log('⚠️ 端口被占用，尝试使用备用端口...');
                    config.server.port = 3057;
                    config.server.baseUrl = 'http://localhost:3057';
                    // 重试
                    this.serverProcess = spawn('node', [testServerPath], {
                        env: { ...process.env, PORT: config.server.port },
                        stdio: 'pipe'
                    });
                }
            });

            // 超时处理
            setTimeout(() => {
                if (!started) {
                    console.log('⏱️ 服务器启动超时，但继续尝试...');
                    resolve(true);
                }
            }, 5000);
        });
    }

    async stopTestServer() {
        if (this.serverProcess) {
            console.log('\n🛑 停止测试服务器...');
            this.serverProcess.kill();
            await this.utils.sleep(1000);
        }
    }

    generateFinalReport() {
        console.log('\n' + '='.repeat(70));
        console.log('📊 最终测试报告');
        console.log('='.repeat(70));

        let totalTests = 0;
        let totalPassed = 0;
        let totalFailed = 0;

        // 汇总各测试套件结果
        Object.entries(this.results).forEach(([name, result]) => {
            if (result) {
                console.log(`\n${name.toUpperCase()} 测试:`);
                console.log(`  总计: ${result.total}`);
                console.log(`  通过: ${result.passed}`);
                console.log(`  失败: ${result.failed}`);
                console.log(`  通过率: ${result.passRate}%`);

                totalTests += result.total;
                totalPassed += result.passed;
                totalFailed += result.failed;
            }
        });

        const overallPassRate = totalTests > 0
            ? ((totalPassed / totalTests) * 100).toFixed(1)
            : 0;

        console.log('\n' + '='.repeat(70));
        console.log('📈 总体统计');
        console.log('='.repeat(70));
        console.log(`总计测试: ${totalTests} 项`);
        console.log(`通过: ${totalPassed} 项`);
        console.log(`失败: ${totalFailed} 项`);
        console.log(`总体通过率: ${overallPassRate}%`);

        // 保存报告
        const reportDir = path.join(__dirname, '..', 'reports');
        if (!fs.existsSync(reportDir)) {
            fs.mkdirSync(reportDir, { recursive: true });
        }

        const reportPath = path.join(reportDir, `test-report-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
        fs.writeFileSync(reportPath, JSON.stringify({
            timestamp: new Date().toISOString(),
            summary: {
                total: totalTests,
                passed: totalPassed,
                failed: totalFailed,
                passRate: overallPassRate
            },
            details: this.results
        }, null, 2));

        console.log(`\n📄 完整报告已保存: ${reportPath}`);

        // 返回结果
        if (totalFailed > 0) {
            console.log('\n⚠️ 测试未全部通过，请检查失败项目');
            process.exit(1);
        } else {
            console.log('\n✅ 所有测试通过！');
            process.exit(0);
        }
    }
}

// 运行测试
const runner = new TestRunner();
runner.run().catch(err => {
    console.error('测试运行出错:', err);
    process.exit(1);
});
