/**
 * 测试工具类
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

class TestUtils {
    constructor() {
        this.results = [];
    }

    /**
     * 记录测试结果
     */
    logTest(testName, passed, message = '', details = {}) {
        const result = {
            name: testName,
            passed,
            message,
            timestamp: new Date().toISOString(),
            ...details
        };
        this.results.push(result);

        const icon = passed ? '✅' : '❌';
        console.log(`${icon} ${testName}${message ? ': ' + message : ''}`);

        return result;
    }

    /**
     * 获取测试报告
     */
    getReport() {
        const passed = this.results.filter(r => r.passed).length;
        const failed = this.results.filter(r => !r.passed).length;
        return {
            total: this.results.length,
            passed,
            failed,
            passRate: this.results.length > 0 ? ((passed / this.results.length) * 100).toFixed(1) : 0,
            results: this.results
        };
    }

    /**
     * 打印测试报告
     */
    printReport() {
        const report = this.getReport();
        console.log('\n' + '='.repeat(60));
        console.log('📊 测试报告');
        console.log('='.repeat(60));
        console.log(`总计: ${report.total} 项`);
        console.log(`通过: ${report.passed} 项`);
        console.log(`失败: ${report.failed} 项`);
        console.log(`通过率: ${report.passRate}%`);
        console.log('='.repeat(60));

        if (report.failed > 0) {
            console.log('\n❌ 失败项目:');
            this.results.filter(r => !r.passed).forEach((r, i) => {
                console.log(`  ${i + 1}. ${r.name}`);
                if (r.message) console.log(`     ${r.message}`);
            });
        }

        return report;
    }

    /**
     * 保存测试报告
     */
    saveReport(outputPath) {
        const report = this.getReport();
        fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
        console.log(`\n📄 测试报告已保存: ${outputPath}`);
    }

    /**
     * 创建测试数据目录
     */
    setupTestData(testDataConfig) {
        console.log('\n📁 设置测试数据...');

        // 创建测试图片
        Object.values(testDataConfig).forEach(folder => {
            if (!fs.existsSync(folder)) {
                fs.mkdirSync(folder, { recursive: true });
                console.log(`  创建目录: ${folder}`);
            }
        });

        // 创建测试图片文件
        const testImagePath = path.join(testDataConfig.inputFolder, 'test-image-1.png');
        if (!fs.existsSync(testImagePath)) {
            // 创建一个简单的1x1像素的PNG
            const pngData = Buffer.from([
                0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG签名
                0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
                0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
                0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
                0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41,
                0x54, 0x08, 0xD7, 0x63, 0xF8, 0x0F, 0x00, 0x00,
                0x01, 0x01, 0x00, 0x05, 0x18, 0xD8, 0x4E, 0x00,
                0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE,
                0x42, 0x60, 0x82
            ]);
            fs.writeFileSync(testImagePath, pngData);
            console.log(`  创建测试图片: ${testImagePath}`);
        }

        // 创建Legil参考图
        const legilRefPath = path.join(testDataConfig.legilRefFolder, 'reference-1.png');
        if (!fs.existsSync(legilRefPath)) {
            fs.copyFileSync(testImagePath, legilRefPath);
            console.log(`  创建参考图: ${legilRefPath}`);
        }

        return true;
    }

    /**
     * 清理测试数据
     */
    cleanupTestData(testDataConfig) {
        console.log('\n🧹 清理测试数据...');
        try {
            if (fs.existsSync(testDataConfig.outputFolder)) {
                fs.rmSync(testDataConfig.outputFolder, { recursive: true, force: true });
                console.log(`  清理: ${testDataConfig.outputFolder}`);
            }
        } catch (e) {
            console.log(`  警告: 清理失败 ${e.message}`);
        }
    }

    /**
     * HTTP请求工具
     */
    async request(url, options = {}) {
        return new Promise((resolve, reject) => {
            const client = url.startsWith('https') ? https : http;
            const req = client.request(url, options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        resolve({ status: res.statusCode, data: parsed, headers: res.headers });
                    } catch {
                        resolve({ status: res.statusCode, data, headers: res.headers });
                    }
                });
            });
            req.on('error', reject);
            req.setTimeout(options.timeout || 10000, () => {
                req.destroy();
                reject(new Error('Request timeout'));
            });
            if (options.body) {
                req.write(JSON.stringify(options.body));
            }
            req.end();
        });
    }

    /**
     * 等待指定时间
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * 重试函数
     */
    async retry(fn, maxAttempts = 3, delay = 1000) {
        for (let i = 0; i < maxAttempts; i++) {
            try {
                return await fn();
            } catch (e) {
                if (i === maxAttempts - 1) throw e;
                await this.sleep(delay);
            }
        }
    }
}

module.exports = TestUtils;
