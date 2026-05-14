/**
 * 测试配置
 */

const path = require('path');

module.exports = {
    // 测试服务器配置
    server: {
        port: 3056, // 使用不同端口避免冲突
        baseUrl: 'http://localhost:3056'
    },

    // 测试数据路径
    testData: {
        inputFolder: path.join(__dirname, '..', 'data', 'input'),
        outputFolder: path.join(__dirname, '..', 'data', 'output'),
        legilRefFolder: path.join(__dirname, '..', 'data', 'legil-ref')
    },

    // 超时配置
    timeouts: {
        api: 10000,
        browser: 30000,
        workflow: 300000 // 5分钟
    },

    // 测试图片URL（用于下载测试图片）
    testImages: [
        'https://via.placeholder.com/500x500/667eea/ffffff?text=Test+Image+1',
        'https://via.placeholder.com/500x500/764ba2/ffffff?text=Test+Image+2'
    ]
};
