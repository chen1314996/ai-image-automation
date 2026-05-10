/**
 * ============================================
 * 豆包大模型 API 模块（替代原豆包网页自动化）
 * ============================================
 *
 * 现在的流程不再打开豆包网页、不再上传到网页、不再等待网页回复。
 * 本模块只做一件事：
 *   传入本地参考图路径 -> 调用火山方舟豆包图文大模型 API -> 返回 5 组规整提示词数组。
 *
 * API Key 读取顺序：
 *   1. 环境变量 ARK_API_KEY
 *   2. 环境变量 VOLCENGINE_API_KEY
 *   3. 环境变量 DOUBAO_API_KEY
 *   4. 本机 automation-secrets.json（已加入 .gitignore，不会提交到仓库）
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const logger = require('./logger');
const { readSecrets, updateSecrets } = require('./secrets-store');

const DEFAULT_PROMPT_TEMPLATE = '参考这张图，生成五组不同的画面提示词，画面直观、主题明确，高质量3D卡通渲染，商业级游戏宣传海报风格，电影镜头感，尽可能详细。';
const DEFAULT_API_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';

const IMAGE_MIME_BY_EXT = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp'
};

const SUPPORTED_IMAGE_EXTENSIONS = Object.keys(IMAGE_MIME_BY_EXT);
const MAX_IMAGE_SIZE_BYTES = 20 * 1024 * 1024;

function normalizeInputPath(value) {
    if (typeof value !== 'string') {
        return '';
    }
    return value.replace(/["']/g, '').trim();
}

function normalizePromptText(value) {
    return String(value || '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/\u0000/g, '')
        .trim();
}

function compactForLog(value, maxLength = 500) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function isAbortRequested(options = {}) {
    if (typeof options.shouldAbort === 'function' && options.shouldAbort()) {
        return true;
    }
    return !!(options.signal && options.signal.aborted);
}

function throwIfAborted(options = {}) {
    if (isAbortRequested(options)) {
        throw new Error('操作已取消');
    }
}

class DoubaoAutomation {
    constructor() {
        const secrets = readSecrets();

        // 固定文字指令：前端可修改，保存到 automation-config.json。
        this.promptTemplate = DEFAULT_PROMPT_TEMPLATE;

        // 火山方舟模型 ID / Endpoint ID：用户在前端填写。
        this.modelId = '';

        // 默认使用火山方舟 OpenAI 兼容 Chat Completions 地址。
        this.baseUrl = process.env.ARK_BASE_URL || DEFAULT_API_BASE_URL;

        // API Key 只保存在内存或本机密钥文件，不会通过 getConfig 返回明文。
        this.apiKey = typeof secrets.doubaoApiKey === 'string' ? secrets.doubaoApiKey : '';

        this.temperature = 0.75;
        this.maxTokens = 8192;
        this.requestTimeoutMs = 180000;
        this.lastExtractedPrompts = null;
        this.lastRawResponse = '';
    }

    /**
     * 兼容旧接口名：原来这里会操作豆包网页，现在直接走 API。
     */
    async uploadAndPrompt(imagePath, options = {}) {
        return this.fullAutomation(imagePath, options);
    }

    /**
     * 兼容旧“完整豆包流程”接口：
     * 旧：上传网页 -> 等回复 -> 提取
     * 新：读取本地图片 -> 调豆包 API -> 返回 prompts
     */
    async fullAutomation(imagePath, options = {}) {
        try {
            const result = await this.createPromptsFromImage(imagePath, options);
            return {
                success: true,
                response: JSON.stringify({ prompts: result.prompts }, null, 2),
                rawResponse: result.rawResponse,
                prompts: result.prompts,
                message: `已通过豆包 API 获取 ${result.prompts.length} 组提示词`
            };
        } catch (error) {
            const message = error && error.message ? error.message : String(error);
            logger.error(`❌ 豆包 API 生成提示词失败: ${message}`);
            return {
                success: false,
                response: null,
                rawResponse: null,
                prompts: [],
                message
            };
        }
    }

    /**
     * 独立 API 函数：传入本地参考图路径，直接返回 5 组提示词数组。
     * 其他模块如果只想拿数组，可以直接调用这个方法。
     */
    async generatePromptsFromImage(imagePath, options = {}) {
        const result = await this.createPromptsFromImage(imagePath, options);
        return result.prompts;
    }

    async createPromptsFromImage(imagePath, options = {}) {
        throwIfAborted(options);
        this.validateConfigForRun();

        const normalizedImagePath = normalizeInputPath(imagePath);
        const imageName = path.basename(normalizedImagePath || '');
        const imageIndex = Number(options.imageIndex) || 1;
        const totalImages = Number(options.totalImages) || 1;

        logger.info('========================================');
        logger.info(`🔄 开始处理第 ${imageIndex}/${totalImages} 张参考图（豆包 API）`);
        logger.info(`图片路径: ${normalizedImagePath}`);
        logger.info('========================================');

        logger.info('正在读取本地参考图...');
        const dataUrl = this.readImageAsDataUrl(normalizedImagePath);

        throwIfAborted(options);
        logger.info(`✅ 参考图读取完成: ${imageName}`);
        logger.info(`正在调用豆包大模型 API（模型ID: ${this.modelId}）...`);

        const rawResponse = await this.callDoubaoVisionApi(dataUrl, options);

        throwIfAborted(options);
        logger.info('正在解析豆包 API 返回的 5 组提示词...');

        const prompts = this.parsePromptsFromApiText(rawResponse);
        this.lastExtractedPrompts = prompts;
        this.lastRawResponse = rawResponse;

        logger.info(`✅ 豆包 API 已返回 ${prompts.length} 组提示词`);
        prompts.forEach((prompt, index) => {
            logger.info(` 提示词 ${index + 1}: ${compactForLog(prompt, 120)}`);
        });

        return {
            prompts,
            rawResponse
        };
    }

    validateConfigForRun() {
        const apiKey = this.getApiKey();
        if (!apiKey) {
            throw new Error('请先在“豆包配置”中填写火山方舟 API Key，或设置环境变量 ARK_API_KEY');
        }

        if (!this.modelId || typeof this.modelId !== 'string' || !this.modelId.trim()) {
            throw new Error('请先在“豆包配置”中填写模型 ID / Endpoint ID');
        }

        if (!this.baseUrl || typeof this.baseUrl !== 'string' || !this.baseUrl.trim()) {
            throw new Error('豆包 API 地址为空，请检查配置');
        }
    }

    readImageAsDataUrl(imagePath) {
        if (!imagePath) {
            throw new Error('图片路径不能为空');
        }

        if (!fs.existsSync(imagePath)) {
            throw new Error(`图片文件不存在: ${imagePath}`);
        }

        const stat = fs.statSync(imagePath);
        if (!stat.isFile()) {
            throw new Error(`图片路径不是文件: ${imagePath}`);
        }

        const ext = path.extname(imagePath).toLowerCase();
        const mimeType = IMAGE_MIME_BY_EXT[ext];
        if (!mimeType) {
            throw new Error(`不支持的图片格式: ${ext || '未知'}，请使用 ${SUPPORTED_IMAGE_EXTENSIONS.join(', ')}`);
        }

        if (stat.size <= 0) {
            throw new Error('图片文件为空，无法调用豆包 API');
        }

        if (stat.size > MAX_IMAGE_SIZE_BYTES) {
            logger.warn(`⚠️ 图片文件较大（${(stat.size / 1024 / 1024).toFixed(1)}MB），API 可能返回图片过大错误`);
        }

        const base64 = fs.readFileSync(imagePath).toString('base64');
        return `data:${mimeType};base64,${base64}`;
    }

    buildApiInstruction() {
        const userInstruction = normalizePromptText(this.promptTemplate) || DEFAULT_PROMPT_TEMPLATE;

        // 让模型只返回 JSON，避免再做网页时期那种复杂纯文本/代码块提取。
        return `${userInstruction}

请严格只返回下面这个 JSON 对象，不要添加 Markdown、代码块、解释、寒暄或资料来源：
{
  "prompts": [
    "第1组完整生图提示词",
    "第2组完整生图提示词",
    "第3组完整生图提示词",
    "第4组完整生图提示词",
    "第5组完整生图提示词"
  ]
}

硬性要求：
1. prompts 必须刚好 5 条。
2. 每条提示词都必须独立完整，适合直接发送到生图平台。
3. 每条提示词可以是中文或中英混合，不要因为包含中文而省略。
4. 不要把同一条提示词拆成多个数组项。`;
    }

    async callDoubaoVisionApi(imageDataUrl, options = {}) {
        const apiKey = this.getApiKey();
        const payload = {
            model: this.modelId.trim(),
            messages: [
                {
                    role: 'user',
                    content: [
                        {
                            type: 'text',
                            text: this.buildApiInstruction()
                        },
                        {
                            type: 'image_url',
                            image_url: {
                                url: imageDataUrl
                            }
                        }
                    ]
                }
            ],
            temperature: this.temperature,
            max_tokens: this.maxTokens
        };

        try {
            const response = await axios.post(this.baseUrl.trim(), payload, {
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                timeout: this.requestTimeoutMs,
                signal: options.signal || undefined,
                validateStatus: () => true
            });

            if (response.status < 200 || response.status >= 300) {
                const detail = this.extractErrorDetail(response.data);
                throw new Error(`豆包 API 请求失败（HTTP ${response.status}）：${detail}`);
            }

            return this.extractContentFromApiResponse(response.data);
        } catch (error) {
            if (error && error.name === 'CanceledError') {
                throw new Error('操作已取消');
            }

            if (error && error.code === 'ECONNABORTED') {
                throw new Error('豆包 API 请求超时，请稍后重试或检查网络');
            }

            if (error && error.response) {
                const detail = this.extractErrorDetail(error.response.data);
                throw new Error(`豆包 API 请求失败（HTTP ${error.response.status}）：${detail}`);
            }

            throw error;
        }
    }

    extractContentFromApiResponse(data) {
        if (!data || typeof data !== 'object') {
            throw new Error('豆包 API 返回为空或格式不正确');
        }

        const choice = Array.isArray(data.choices) ? data.choices[0] : null;
        const message = choice && choice.message ? choice.message : null;
        const content = message ? message.content : null;

        if (typeof content === 'string') {
            const text = content.trim();
            if (text) {
                return text;
            }
        }

        if (Array.isArray(content)) {
            const text = content
                .map(item => {
                    if (!item) return '';
                    if (typeof item === 'string') return item;
                    if (typeof item.text === 'string') return item.text;
                    if (typeof item.content === 'string') return item.content;
                    return '';
                })
                .filter(Boolean)
                .join('\n')
                .trim();

            if (text) {
                return text;
            }
        }

        throw new Error('豆包 API 返回中没有可解析的文本内容');
    }

    parsePromptsFromApiText(responseText) {
        const text = normalizePromptText(responseText);
        if (!text) {
            throw new Error('豆包 API 返回内容为空');
        }

        const jsonCandidates = this.getJsonCandidates(text);
        for (const candidate of jsonCandidates) {
            try {
                const parsed = JSON.parse(candidate);
                const prompts = this.extractPromptsFromParsedJson(parsed);
                if (prompts.length >= 5) {
                    return prompts.slice(0, 5);
                }
            } catch (error) {
                // 继续尝试下一个候选 JSON。
            }
        }

        // 轻量兜底：如果模型偶尔没有遵守 JSON，只按常见编号切开。
        // 这不是旧网页提取逻辑，只是防止 API 偶发返回格式漂移导致整个工作流中断。
        const fallbackPrompts = this.extractNumberedPrompts(text);
        if (fallbackPrompts.length >= 5) {
            logger.warn('⚠️ 豆包 API 未返回严格 JSON，已使用编号兜底解析');
            return fallbackPrompts.slice(0, 5);
        }

        logger.error(`豆包 API 原始返回预览: ${compactForLog(text, 800)}`);
        throw new Error(`豆包 API 未返回 5 组规整提示词，只解析到 ${fallbackPrompts.length} 组`);
    }

    getJsonCandidates(text) {
        const candidates = new Set();
        const trimmed = text.trim();

        candidates.add(trimmed);
        candidates.add(trimmed.replace(/^```(?:json|JSON)?\s*/i, '').replace(/```$/i, '').trim());

        const firstObject = trimmed.indexOf('{');
        const lastObject = trimmed.lastIndexOf('}');
        if (firstObject !== -1 && lastObject > firstObject) {
            candidates.add(trimmed.slice(firstObject, lastObject + 1));
        }

        const firstArray = trimmed.indexOf('[');
        const lastArray = trimmed.lastIndexOf(']');
        if (firstArray !== -1 && lastArray > firstArray) {
            candidates.add(trimmed.slice(firstArray, lastArray + 1));
        }

        return Array.from(candidates).filter(Boolean);
    }

    extractPromptsFromParsedJson(parsed) {
        let source = null;

        if (Array.isArray(parsed)) {
            source = parsed;
        } else if (parsed && typeof parsed === 'object') {
            source = parsed.prompts || parsed.promptWords || parsed.items || parsed.data || parsed.result;
        }

        if (!Array.isArray(source)) {
            return [];
        }

        return source
            .map(item => {
                if (typeof item === 'string') {
                    return item;
                }
                if (item && typeof item === 'object') {
                    return item.prompt || item.content || item.text || item.description || '';
                }
                return '';
            })
            .map(normalizePromptText)
            .filter(prompt => prompt.length > 0);
    }

    extractNumberedPrompts(text) {
        const normalized = text
            .replace(/^```(?:json|plaintext|text)?\s*/i, '')
            .replace(/```$/i, '')
            .trim();

        const pattern = /(?:^|\n)\s*(?:第\s*)?([1-5])\s*(?:组|条|\.|、|\)|）|:|：)\s*([\s\S]*?)(?=(?:\n\s*(?:第\s*)?[1-5]\s*(?:组|条|\.|、|\)|）|:|：)\s*)|$)/g;
        const prompts = [];
        let match;

        while ((match = pattern.exec(normalized)) !== null) {
            const prompt = normalizePromptText(match[2]);
            if (prompt) {
                prompts.push(prompt);
            }
        }

        return prompts;
    }

    extractErrorDetail(data) {
        if (!data) {
            return '无错误详情';
        }

        if (typeof data === 'string') {
            return compactForLog(data, 800);
        }

        if (data.error) {
            if (typeof data.error === 'string') {
                return compactForLog(data.error, 800);
            }
            if (data.error.message) {
                return compactForLog(data.error.message, 800);
            }
        }

        if (data.message) {
            return compactForLog(data.message, 800);
        }

        return compactForLog(JSON.stringify(data), 800);
    }

    /**
     * 兼容旧接口：旧版本会从网页回复里提取。
     * 新版本只解析 API 返回的 JSON/编号文本，供历史接口兜底使用。
     */
    extractPrompts(response) {
        try {
            const prompts = this.parsePromptsFromApiText(response);
            this.lastExtractedPrompts = prompts;
            return {
                success: true,
                prompts,
                message: `成功解析 ${prompts.length} 组提示词`
            };
        } catch (error) {
            return {
                success: false,
                prompts: [],
                message: error.message
            };
        }
    }

    getApiKey() {
        return (
            process.env.ARK_API_KEY ||
            process.env.VOLCENGINE_API_KEY ||
            process.env.DOUBAO_API_KEY ||
            this.apiKey ||
            ''
        ).trim();
    }

    getApiKeySource() {
        if (process.env.ARK_API_KEY) return '环境变量 ARK_API_KEY';
        if (process.env.VOLCENGINE_API_KEY) return '环境变量 VOLCENGINE_API_KEY';
        if (process.env.DOUBAO_API_KEY) return '环境变量 DOUBAO_API_KEY';
        if (this.apiKey) return '本机密钥文件';
        return '未配置';
    }

    setApiKey(apiKey) {
        if (typeof apiKey !== 'string' || !apiKey.trim()) {
            throw new Error('API Key 不能为空');
        }

        const nextApiKey = apiKey.trim();
        if (nextApiKey.length < 8) {
            throw new Error('API Key 看起来过短，请检查是否填写完整');
        }

        this.apiKey = nextApiKey;
        updateSecrets({ doubaoApiKey: nextApiKey });
        logger.info('✅ 火山方舟 API Key 已保存到本机密钥文件（不会在前端回显）');
    }

    clearApiKey() {
        this.apiKey = '';
        updateSecrets({ doubaoApiKey: '' });
    }

    setPrompt(promptTemplate) {
        if (typeof promptTemplate !== 'string' || !promptTemplate.trim()) {
            throw new Error('豆包固定指令不能为空');
        }

        const nextPrompt = promptTemplate.trim();
        if (nextPrompt.length > 10000) {
            throw new Error('豆包固定指令过长，请控制在10000字以内');
        }

        this.promptTemplate = nextPrompt;
        return this.getConfig();
    }

    resetPrompt() {
        this.promptTemplate = DEFAULT_PROMPT_TEMPLATE;
        return this.getConfig();
    }

    setModelId(modelId) {
        if (typeof modelId !== 'string' || !modelId.trim()) {
            throw new Error('模型 ID / Endpoint ID 不能为空');
        }

        const nextModelId = modelId.trim();
        if (nextModelId.length > 300) {
            throw new Error('模型 ID / Endpoint ID 过长，请检查是否填写正确');
        }

        this.modelId = nextModelId;
        return this.getConfig();
    }

    setBaseUrl(baseUrl) {
        if (typeof baseUrl !== 'string' || !baseUrl.trim()) {
            throw new Error('API 地址不能为空');
        }

        try {
            new URL(baseUrl.trim());
        } catch {
            throw new Error('API 地址格式不正确');
        }

        this.baseUrl = baseUrl.trim();
        return this.getConfig();
    }

    setConfig(config = {}) {
        if (!config || typeof config !== 'object') {
            return this.getConfig();
        }

        if (Object.prototype.hasOwnProperty.call(config, 'promptTemplate')) {
            this.setPrompt(config.promptTemplate);
        }

        if (Object.prototype.hasOwnProperty.call(config, 'instruction')) {
            this.setPrompt(config.instruction);
        }

        if (Object.prototype.hasOwnProperty.call(config, 'modelId')) {
            this.setModelId(config.modelId);
        }

        if (Object.prototype.hasOwnProperty.call(config, 'baseUrl') && config.baseUrl) {
            this.setBaseUrl(config.baseUrl);
        }

        if (Object.prototype.hasOwnProperty.call(config, 'apiKey') && String(config.apiKey || '').trim()) {
            this.setApiKey(config.apiKey);
        }

        if (config.clearApiKey === true) {
            this.clearApiKey();
        }

        // 旧版前端曾传 chatModel（快速/思考/专家网页模型）。API 版不再使用，保留静默兼容。
        return this.getConfig();
    }

    getConfig() {
        const apiKeyConfigured = !!this.getApiKey();
        return {
            promptTemplate: this.promptTemplate,
            modelId: this.modelId,
            modelLabel: this.modelId || '未填写',
            baseUrl: this.baseUrl,
            apiKeyConfigured,
            apiKeySource: this.getApiKeySource(),
            defaultPromptTemplate: DEFAULT_PROMPT_TEMPLATE,
            // 保留空数组，避免旧前端读取 modelOptions 时报错。
            modelOptions: []
        };
    }

    getLastExtractedPrompts() {
        return this.lastExtractedPrompts;
    }

    getLastRawResponse() {
        return this.lastRawResponse;
    }

    getCurrentPage() {
        // API 版没有豆包网页页面，保留该方法只为避免历史调用崩溃。
        return null;
    }
}

module.exports = new DoubaoAutomation();
