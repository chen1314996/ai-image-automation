const fs = require('fs');
const path = require('path');
const axios = require('axios');

const MIME_BY_EXT = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp'
};

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

function guessMimeType(source, headerMime = '') {
    const cleanHeader = String(headerMime || '').split(';')[0].trim().toLowerCase();
    if (cleanHeader.startsWith('image/')) return cleanHeader;
    const ext = path.extname(String(source || '').split('?')[0]).toLowerCase();
    return MIME_BY_EXT[ext] || 'image/jpeg';
}

function normalizeUrl(value) {
    return String(value || '').trim();
}

class MaterialImageFetcher {
    constructor(options = {}) {
        this.axios = options.axios || axios;
        this.timeoutMs = Number(options.timeoutMs) || 30000;
        this.maxBytes = Number(options.maxBytes) || MAX_IMAGE_BYTES;
    }

    async fetchImage(material = {}) {
        const source = normalizeUrl(material.contentUrl || material.contentText);
        if (!source) {
            throw new Error('素材没有可识别的图片链接');
        }

        if (/^data:image\//i.test(source)) {
            const match = source.match(/^data:(image\/[^;]+);base64,(.+)$/i);
            if (!match) throw new Error('图片 Data URL 格式不正确');
            return {
                sourceUrl: source.slice(0, 120),
                mimeType: match[1].toLowerCase(),
                dataUrl: source,
                sizeBytes: Buffer.from(match[2], 'base64').length
            };
        }

        if (/^https?:\/\//i.test(source)) {
            return await this.fetchRemoteImage(source);
        }

        return this.readLocalImage(source);
    }

    async fetchRemoteImage(url) {
        const response = await this.axios.get(url, {
            responseType: 'arraybuffer',
            timeout: this.timeoutMs,
            maxContentLength: this.maxBytes,
            validateStatus: () => true
        });

        if (response.status < 200 || response.status >= 300) {
            throw new Error(`图片下载失败 HTTP ${response.status}`);
        }

        const buffer = Buffer.from(response.data);
        if (buffer.length <= 0) {
            throw new Error('图片内容为空');
        }
        if (buffer.length > this.maxBytes) {
            throw new Error(`图片超过 ${(this.maxBytes / 1024 / 1024).toFixed(0)}MB 限制`);
        }

        const mimeType = guessMimeType(url, response.headers && response.headers['content-type']);
        return {
            sourceUrl: url,
            mimeType,
            dataUrl: `data:${mimeType};base64,${buffer.toString('base64')}`,
            sizeBytes: buffer.length
        };
    }

    readLocalImage(filePath) {
        const normalizedPath = path.resolve(String(filePath || '').replace(/["']/g, '').trim());
        if (!fs.existsSync(normalizedPath)) {
            throw new Error(`本地图片不存在：${normalizedPath}`);
        }
        const stat = fs.statSync(normalizedPath);
        if (!stat.isFile()) {
            throw new Error(`图片路径不是文件：${normalizedPath}`);
        }
        if (stat.size <= 0) {
            throw new Error('图片文件为空');
        }
        if (stat.size > this.maxBytes) {
            throw new Error(`图片超过 ${(this.maxBytes / 1024 / 1024).toFixed(0)}MB 限制`);
        }

        const mimeType = guessMimeType(normalizedPath);
        const buffer = fs.readFileSync(normalizedPath);
        return {
            sourceUrl: normalizedPath,
            mimeType,
            dataUrl: `data:${mimeType};base64,${buffer.toString('base64')}`,
            sizeBytes: buffer.length
        };
    }
}

module.exports = {
    MaterialImageFetcher,
    guessMimeType
};
