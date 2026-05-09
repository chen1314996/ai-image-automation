/**
 * 快速测试 - 针对现有服务器
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:3055';
const results = [];

function logTest(name, passed, message = '') {
    const icon = passed ? '✅' : '❌';
    results.push({ name, passed, message });
    console.log(`${icon} ${name}${message ? ': ' + message : ''}`);
}

async function request(path, options = {}) {
    return new Promise((resolve, reject) => {
        const req = http.request(BASE_URL + path, options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, data: JSON.parse(data) });
                } catch {
                    resolve({ status: res.statusCode, data });
                }
            });
        });
        req.on('error', reject);
        req.setTimeout(5000, () => {
            req.destroy();
            reject(new Error('Timeout'));
        });
        if (options.body) {
            req.write(JSON.stringify(options.body));
        }
        req.end();
    });
}

async function runTests() {
    console.log('='.repeat(60));
    console.log('🧪 快速API测试');
    console.log('='.repeat(60));

    // 测试1: 首页
    try {
        const res = await request('/');
        logTest('首页访问', res.status === 200 && res.data.includes('<!DOCTYPE html>'));
    } catch (e) {
        logTest('首页访问', false, e.message);
    }

    // 测试2: 统计图片 - 有效路径
    try {
        const res = await request('/api/count-images', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: { folderPath: 'D:\\工作\\自动化工作流1\\输入' }
        });
        logTest('统计图片-有效路径', res.data.success, `找到 ${res.data.count} 张图片`);
    } catch (e) {
        logTest('统计图片-有效路径', false, e.message);
    }

    // 测试3: 统计图片 - 空路径
    try {
        const res = await request('/api/count-images', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: { folderPath: '' }
        });
        logTest('统计图片-空路径校验', !res.data.success);
    } catch (e) {
        logTest('统计图片-空路径校验', false, e.message);
    }

    // 测试4: 浏览器状态
    try {
        const res = await request('/api/browser-status');
        logTest('浏览器状态API', res.data.success && typeof res.data.status.browserRunning === 'boolean');
    } catch (e) {
        logTest('浏览器状态API', false, e.message);
    }

    // 测试5: 工作流状态
    try {
        const res = await request('/api/workflow/status');
        logTest('工作流状态API', res.data.success && typeof res.data.status.isRunning === 'boolean');
    } catch (e) {
        logTest('工作流状态API', false, e.message);
    }

    // 测试6: 保存Legil配置
    try {
        const res = await request('/api/config/legil-ref-folder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: { folderPath: 'D:\\工作\\自动化工作流1\\Legil参考图' }
        });
        logTest('保存Legil配置', res.data.success);
    } catch (e) {
        logTest('保存Legil配置', false, e.message);
    }

    // 测试7: 获取Legil配置
    try {
        const res = await request('/api/config/legil-ref-folder');
        logTest('获取Legil配置', res.data.success);
    } catch (e) {
        logTest('获取Legil配置', false, e.message);
    }

    // 报告
    console.log('\n' + '='.repeat(60));
    console.log('📊 测试报告');
    console.log('='.repeat(60));
    const passed = results.filter(r => r.passed).length;
    console.log(`总计: ${results.length} 项`);
    console.log(`通过: ${passed} 项`);
    console.log(`失败: ${results.length - passed} 项`);
    console.log(`通过率: ${((passed / results.length) * 100).toFixed(1)}%`);

    return results.length === passed;
}

runTests().then(allPassed => {
    process.exit(allPassed ? 0 : 1);
}).catch(err => {
    console.error('测试出错:', err);
    process.exit(1);
});
