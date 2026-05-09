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
        this.clients = new Set();
        this.heartbeats = new Map();
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
            'Connection': 'keep-alive',            // 保持长连接
            'X-Accel-Buffering': 'no'
        });

        // 发送初始连接成功消息
        this.writeToClient(res, {
            type: 'system',
            message: '日志连接已建立',
            timestamp: new Date().toISOString()
        });

        // 保存客户端响应对象
        this.clients.add(res);

        // 定期发送注释心跳，避免代理或浏览器长时间无数据后断开
        const heartbeat = setInterval(() => {
            try {
                if (res.destroyed || res.writableEnded) {
                    this.removeClient(res);
                    return;
                }
                res.write(': ping\n\n');
            } catch (error) {
                this.removeClient(res);
            }
        }, 30000);
        this.heartbeats.set(res, heartbeat);

        // 当客户端断开连接时移除
        res.on('close', () => {
            this.removeClient(res);
        });

        res.on('error', () => {
            this.removeClient(res);
        });

        console.log('📡 新的日志客户端已连接，当前连接数:', this.clients.size);
    }

    /**
     * 移除客户端连接
     * @param {Object} res - HTTP 响应对象
     */
    removeClient(res) {
        if (this.clients.has(res)) {
            this.clients.delete(res);
            const heartbeat = this.heartbeats.get(res);
            if (heartbeat) {
                clearInterval(heartbeat);
                this.heartbeats.delete(res);
            }
            console.log('📡 日志客户端已断开，当前连接数:', this.clients.size);
        }
    }

    writeToClient(client, logData) {
        if (!client || client.destroyed || client.writableEnded) {
            this.removeClient(client);
            return false;
        }

        const sseData = `data: ${JSON.stringify(logData)}\n\n`;
        client.write(sseData);
        return true;
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

        // 发送给所有连接的客户端
        for (const client of Array.from(this.clients)) {
            try {
                this.writeToClient(client, logData);
            } catch (error) {
                // 如果发送失败，可能是连接已断开
                console.error('发送日志失败:', error.message);
                this.removeClient(client);
            }
        }

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
