/**
 * ============================================
 * 实时日志系统 - Logger 模块
 * ============================================
 * 第四阶段：实现前后端实时日志推送
 *
 * 使用 SSE（Server-Sent Events）技术
 * 服务器可以主动向前端推送日志消息
 */

class Logger {
    constructor() {
        // 存储所有连接的客户端（前端页面）
        this.clients = [];
    }

    /**
     * 添加客户端连接
     * 当前端页面连接 SSE 时调用
     * @param {Object} res - HTTP 响应对象
     */
    addClient(res) {
        // 设置 SSE 必要的响应头
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',  // SSE 的 MIME 类型
            'Cache-Control': 'no-cache',           // 禁用缓存
            'Connection': 'keep-alive'             // 保持长连接
        });

        // 发送初始连接成功消息
        res.write('data: {"type":"system","message":"日志连接已建立","timestamp":"' + new Date().toISOString() + '"}\n\n');

        // 保存客户端响应对象
        this.clients.push(res);

        // 当客户端断开连接时移除
        res.on('close', () => {
            this.removeClient(res);
        });

        console.log('📡 新的日志客户端已连接，当前连接数:', this.clients.length);
    }

    /**
     * 移除客户端连接
     * @param {Object} res - HTTP 响应对象
     */
    removeClient(res) {
        const index = this.clients.indexOf(res);
        if (index !== -1) {
            this.clients.splice(index, 1);
            console.log('📡 日志客户端已断开，当前连接数:', this.clients.length);
        }
    }

    /**
     * 发送日志到所有连接的客户端
     * @param {string} message - 日志消息
     * @param {string} type - 日志类型：info, warn, error, system, browser
     */
    log(message, type = 'info') {
        // 构建日志对象
        const logData = {
            type: type,
            message: message,
            timestamp: new Date().toISOString()
        };

        // 转换为 SSE 格式
        // SSE 格式：data: {json}\n\n
        const sseData = `data: ${JSON.stringify(logData)}\n\n`;

        // 发送给所有连接的客户端
        this.clients.forEach(client => {
            try {
                client.write(sseData);
            } catch (error) {
                // 如果发送失败，可能是连接已断开
                console.error('发送日志失败:', error.message);
            }
        });

        // 同时在服务器控制台也输出
        const timeStr = new Date().toLocaleTimeString();
        console.log(`[${timeStr}] [${type}] ${message}`);
    }

    /**
     * 快捷方法：发送 info 级别日志
     */
    info(message) {
        this.log(message, 'info');
    }

    /**
     * 快捷方法：发送 warn 级别日志
     */
    warn(message) {
        this.log(message, 'warn');
    }

    /**
     * 快捷方法：发送 error 级别日志
     */
    error(message) {
        this.log(message, 'error');
    }

    /**
     * 快捷方法：发送 system 级别日志（系统消息）
     */
    system(message) {
        this.log(message, 'system');
    }

    /**
     * 快捷方法：发送 browser 级别日志（浏览器操作）
     */
    browser(message) {
        this.log(message, 'browser');
    }
}

// 导出单例实例（确保全局只有一个 Logger）
module.exports = new Logger();
