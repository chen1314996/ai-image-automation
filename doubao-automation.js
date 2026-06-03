/**
 * Legacy prompt-generation adapter.
 *
 * The public API and many call sites still use the historical "doubao"
 * names, but all LLM requests in this module are routed through Lumos Winky.
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const logger = require('./logger');
const { readSecrets, updateSecrets } = require('./secrets-store');

const DEFAULT_PROMPT_TEMPLATE = '参考这张图，生成五组不同的画面提示词，画面直观、主题明确，高质量 3D 卡通渲染，商业级游戏广告主视觉风格，电影镜头感，尽可能详细。';
const LEGACY_PROVIDER = 'lumos-winky';
const DEFAULT_TIMEOUT_MS = 180000;
const DEFAULT_MAX_TOKENS = 8192;

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
    return typeof value === 'string' ? value.replace(/["']/g, '').trim() : '';
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

function getStoredWinkyConfig() {
    const secrets = readSecrets();
    return {
        apiKey: String(process.env.WINKY_API_KEY || secrets.winkyApiKey || '').trim(),
        apiUrl: String(process.env.WINKY_API_BASE_URL || secrets.winkyApiUrl || '').trim(),
        model: String(process.env.WINKY_MODEL || secrets.winkyModel || '').trim(),
        provider: String(process.env.WINKY_PROVIDER || secrets.winkyProvider || '').trim()
    };
}

function isLegacyArkUrl(value) {
    return /ark\.cn-|volces\.com|volcengine/i.test(String(value || ''));
}

function isAbortRequested(options = {}) {
    return Boolean(
        (typeof options.shouldAbort === 'function' && options.shouldAbort()) ||
        (options.signal && options.signal.aborted)
    );
}

function throwIfAborted(options = {}) {
    if (isAbortRequested(options)) {
        throw new Error('操作已取消');
    }
}

function shouldUseMaxCompletionTokens(model) {
    return /^gpt-5\.5(?:$|[-_.\s])/i.test(String(model || '').trim());
}

class DoubaoAutomation {
    constructor() {
        this.promptTemplate = DEFAULT_PROMPT_TEMPLATE;
        this.modelId = '';
        this.baseUrl = '';
        this.provider = '';
        this.apiKey = '';
        this.temperature = 0.75;
        this.maxTokens = DEFAULT_MAX_TOKENS;
        this.requestTimeoutMs = DEFAULT_TIMEOUT_MS;
        this.lastExtractedPrompts = null;
        this.lastRawResponse = '';
    }

    async uploadAndPrompt(imagePath, options = {}) {
        return this.fullAutomation(imagePath, options);
    }

    async fullAutomation(imagePath, options = {}) {
        try {
            const result = await this.createPromptsFromImage(imagePath, options);
            return {
                success: true,
                response: JSON.stringify({ prompts: result.prompts }, null, 2),
                rawResponse: result.rawResponse,
                prompts: result.prompts,
                provider: LEGACY_PROVIDER,
                model: result.model,
                message: `已通过 Lumos Winky 获取 ${result.prompts.length} 组提示词`
            };
        } catch (error) {
            const message = error && error.message ? error.message : String(error);
            logger.error(`Lumos Winky 生成提示词失败: ${message}`);
            return {
                success: false,
                response: null,
                rawResponse: null,
                prompts: [],
                provider: LEGACY_PROVIDER,
                model: this.getConfig().modelId || '',
                message
            };
        }
    }

    async generatePromptsFromImage(imagePath, options = {}) {
        const result = await this.createPromptsFromImage(imagePath, options);
        return result.prompts;
    }

    async createPromptsFromImage(imagePath, options = {}) {
        throwIfAborted(options);
        const config = this.validateConfigForRun();

        const normalizedImagePath = normalizeInputPath(imagePath);
        const imageName = path.basename(normalizedImagePath || '');
        const imageIndex = Number(options.imageIndex) || 1;
        const totalImages = Number(options.totalImages) || 1;

        logger.info('========================================');
        logger.info(`开始处理第 ${imageIndex}/${totalImages} 张参考图（Lumos Winky）`);
        logger.info(`图片路径: ${normalizedImagePath}`);
        logger.info(`提示词模型: Lumos Winky / ${config.model}`);
        logger.info('========================================');

        logger.info('正在读取本地参考图...');
        const dataUrl = this.readImageAsDataUrl(normalizedImagePath);

        throwIfAborted(options);
        logger.info(`参考图读取完成: ${imageName}`);
        logger.info('正在调用 Lumos Winky 图文模型...');

        const rawResponse = await this.callWinkyVisionApi(dataUrl, options);

        throwIfAborted(options);
        logger.info('正在解析 Lumos Winky 返回的提示词...');

        const prompts = this.parsePromptsFromApiText(rawResponse);
        this.lastExtractedPrompts = prompts;
        this.lastRawResponse = rawResponse;

        logger.info(`Lumos Winky 已返回 ${prompts.length} 组提示词`);
        prompts.forEach((prompt, index) => {
            logger.info(` 提示词 ${index + 1}: ${compactForLog(prompt, 120)}`);
        });

        return {
            prompts,
            rawResponse,
            model: config.model
        };
    }

    getEffectiveConfig() {
        const storedWinky = getStoredWinkyConfig();
        return {
            apiKey: storedWinky.apiKey || this.apiKey,
            apiUrl: storedWinky.apiUrl || this.baseUrl,
            model: storedWinky.model || this.modelId,
            provider: storedWinky.provider || this.provider
        };
    }

    validateConfigForRun() {
        const config = this.getEffectiveConfig();
        if (!config.apiKey) {
            throw new Error('请先配置 Lumos Winky API Key');
        }
        if (!config.apiUrl) {
            throw new Error('请先配置 Lumos Winky API URL');
        }
        if (!config.model) {
            throw new Error('请先配置 Lumos Winky 模型');
        }
        try {
            new URL(config.apiUrl);
        } catch {
            throw new Error('Lumos Winky API URL 格式不正确');
        }
        if (isLegacyArkUrl(config.apiUrl)) {
            throw new Error('当前禁止使用火山/方舟接口，请配置 Lumos Winky API URL');
        }
        return config;
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
            throw new Error('图片文件为空，无法调用 Lumos Winky');
        }

        if (stat.size > MAX_IMAGE_SIZE_BYTES) {
            logger.warn(`图片文件较大（${(stat.size / 1024 / 1024).toFixed(1)}MB），Lumos Winky 可能返回图片过大错误`);
        }

        const base64 = fs.readFileSync(imagePath).toString('base64');
        return `data:${mimeType};base64,${base64}`;
    }

    buildApiInstruction() {
        const userInstruction = normalizePromptText(this.promptTemplate) || DEFAULT_PROMPT_TEMPLATE;
        return `${userInstruction}

请严格只返回下面这种 JSON 对象，不要添加 Markdown、代码块、解释、寒暄或资料来源。下面是默认 5 条示例；如果用户上方要求其他数量，请按该数量调整 prompts 数组长度：
{
  "prompts": [
    "第 1 组完整生图提示词",
    "第 2 组完整生图提示词",
    "第 3 组完整生图提示词",
    "第 4 组完整生图提示词",
    "第 5 组完整生图提示词"
  ]
}

硬性要求：
1. prompts 数量必须与用户上方指令要求的组数一致；如果用户没有明确数量，默认返回 5 条。
2. 每条提示词都必须独立完整，适合直接发送到生图平台。
3. 每条提示词可以是中文或中英混合，不要因为包含中文而省略细节。
4. 不要把同一条提示词拆成多个数组项。`;
    }

    async callDoubaoVisionApi(imageDataUrl, options = {}) {
        return this.callWinkyVisionApi(imageDataUrl, options);
    }

    async callWinkyVisionApi(imageDataUrl, options = {}) {
        const config = this.validateConfigForRun();
        const payload = {
            model: config.model,
            messages: [
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: this.buildApiInstruction() },
                        {
                            type: 'image_url',
                            image_url: {
                                url: imageDataUrl,
                                detail: 'auto'
                            }
                        }
                    ]
                }
            ],
            stream: false,
            response_format: { type: 'json_object' }
        };

        if (shouldUseMaxCompletionTokens(config.model)) {
            payload.max_completion_tokens = this.maxTokens;
        } else {
            payload.temperature = this.temperature;
            payload.max_tokens = this.maxTokens;
        }

        if (config.provider) {
            payload.provider = config.provider;
        }

        try {
            const response = await axios.post(config.apiUrl, payload, {
                headers: {
                    Authorization: `Bearer ${config.apiKey}`,
                    'Content-Type': 'application/json'
                },
                timeout: this.requestTimeoutMs,
                signal: options.signal || undefined,
                validateStatus: () => true,
                maxContentLength: Infinity,
                maxBodyLength: Infinity
            });

            if (response.status < 200 || response.status >= 300) {
                const detail = this.extractErrorDetail(response.data);
                throw new Error(`Lumos Winky 请求失败（HTTP ${response.status}）：${detail}`);
            }

            return this.extractContentFromApiResponse(response.data);
        } catch (error) {
            if (error && error.name === 'CanceledError') {
                throw new Error('操作已取消');
            }

            if (error && error.code === 'ECONNABORTED') {
                throw new Error('Lumos Winky 请求超时，请稍后重试或检查网络');
            }

            if (error && error.response) {
                const detail = this.extractErrorDetail(error.response.data);
                throw new Error(`Lumos Winky 请求失败（HTTP ${error.response.status}）：${detail}`);
            }

            throw error;
        }
    }

    extractContentFromApiResponse(data) {
        if (typeof data === 'string' && data.trim()) return data.trim();
        if (!data || typeof data !== 'object') {
            throw new Error('Lumos Winky 返回为空或格式不正确');
        }
        if (typeof data.output_text === 'string' && data.output_text.trim()) return data.output_text.trim();
        if (typeof data.text === 'string' && data.text.trim()) return data.text.trim();

        const choice = Array.isArray(data.choices) ? data.choices[0] : null;
        if (choice) {
            if (typeof choice.text === 'string' && choice.text.trim()) return choice.text.trim();
            const message = choice.message || {};
            const content = message.content;
            if (typeof content === 'string' && content.trim()) return content.trim();
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
                if (text) return text;
            }
        }

        const candidate = Array.isArray(data.candidates) ? data.candidates[0] : null;
        if (candidate && candidate.content && Array.isArray(candidate.content.parts)) {
            const text = candidate.content.parts.map(part => part.text || '').join('\n').trim();
            if (text) return text;
        }

        throw new Error('Lumos Winky 返回中没有可解析的文本内容');
    }

    parsePromptsFromApiText(responseText) {
        const text = normalizePromptText(responseText);
        if (!text) {
            throw new Error('Lumos Winky 返回内容为空');
        }

        const jsonCandidates = this.getJsonCandidates(text);
        for (const candidate of jsonCandidates) {
            try {
                const parsed = JSON.parse(candidate);
                const prompts = this.extractPromptsFromParsedJson(parsed);
                if (prompts.length > 0) {
                    return prompts;
                }
            } catch {}
        }

        const fallbackPrompts = this.extractNumberedPrompts(text);
        if (fallbackPrompts.length > 0) {
            logger.warn('Lumos Winky 未返回严格 JSON，已使用编号兜底解析');
            return fallbackPrompts;
        }

        logger.error(`Lumos Winky 原始返回预览: ${compactForLog(text, 800)}`);
        throw new Error(`Lumos Winky 未返回有效提示词，只解析到 ${fallbackPrompts.length} 组`);
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
                if (typeof item === 'string') return item;
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

        const pattern = /(?:^|\n)\s*(?:第\s*)?\d+\s*(?:组|条|[.、)）:：])\s*([\s\S]*?)(?=(?:\n\s*(?:第\s*)?\d+\s*(?:组|条|[.、)）:：])\s*)|$)/g;
        const prompts = [];
        let match;

        while ((match = pattern.exec(normalized)) !== null) {
            const prompt = normalizePromptText(match[1]);
            if (prompt) {
                prompts.push(prompt);
            }
        }

        return prompts;
    }

    extractErrorDetail(data) {
        if (!data) return '无错误详情';
        if (typeof data === 'string') return compactForLog(data, 800);
        if (data.error) {
            if (typeof data.error === 'string') return compactForLog(data.error, 800);
            if (data.error.message) return compactForLog(data.error.message, 800);
        }
        if (data.message) return compactForLog(data.message, 800);
        return compactForLog(JSON.stringify(data), 800);
    }

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
        return this.getEffectiveConfig().apiKey;
    }

    getApiKeySource() {
        if (process.env.WINKY_API_KEY) return '环境变量 WINKY_API_KEY';
        if (readSecrets().winkyApiKey) return '本机密钥文件';
        if (this.apiKey) return '内存配置';
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
        updateSecrets({ winkyApiKey: nextApiKey });
        logger.info('Lumos Winky API Key 已保存到本机密钥文件（不会在前端回显）');
    }

    clearApiKey() {
        this.apiKey = '';
        updateSecrets({ winkyApiKey: '' });
    }

    setPrompt(promptTemplate) {
        if (typeof promptTemplate !== 'string' || !promptTemplate.trim()) {
            throw new Error('固定指令不能为空');
        }

        const nextPrompt = promptTemplate.trim();
        if (nextPrompt.length > 10000) {
            throw new Error('固定指令过长，请控制在 10000 字以内');
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
            throw new Error('Lumos Winky 模型不能为空');
        }

        const nextModelId = modelId.trim();
        if (nextModelId.length > 300) {
            throw new Error('模型名过长，请检查是否填写正确');
        }

        this.modelId = nextModelId;
        updateSecrets({ winkyModel: nextModelId });
        return this.getConfig();
    }

    setBaseUrl(baseUrl) {
        if (typeof baseUrl !== 'string' || !baseUrl.trim()) {
            throw new Error('Lumos Winky API URL 不能为空');
        }

        const nextBaseUrl = baseUrl.trim();
        try {
            new URL(nextBaseUrl);
        } catch {
            throw new Error('Lumos Winky API URL 格式不正确');
        }
        if (isLegacyArkUrl(nextBaseUrl)) {
            throw new Error('当前禁止保存火山/方舟接口，请填写 Lumos Winky API URL');
        }

        this.baseUrl = nextBaseUrl;
        updateSecrets({ winkyApiUrl: nextBaseUrl });
        return this.getConfig();
    }

    setProvider(provider) {
        this.provider = String(provider || '').trim();
        updateSecrets({ winkyProvider: this.provider });
        return this.getConfig();
    }

    setConfig(config = {}) {
        if (!config || typeof config !== 'object') {
            return this.getConfig();
        }
        const hasLegacyArkConfig = isLegacyArkUrl(config.baseUrl);

        if (Object.prototype.hasOwnProperty.call(config, 'promptTemplate')) {
            this.setPrompt(config.promptTemplate);
        }

        if (Object.prototype.hasOwnProperty.call(config, 'instruction')) {
            this.setPrompt(config.instruction);
        }

        if (!hasLegacyArkConfig && Object.prototype.hasOwnProperty.call(config, 'modelId') && String(config.modelId || '').trim()) {
            this.setModelId(config.modelId);
        }

        if (!hasLegacyArkConfig && Object.prototype.hasOwnProperty.call(config, 'baseUrl') && String(config.baseUrl || '').trim()) {
            this.setBaseUrl(config.baseUrl);
        }

        if (Object.prototype.hasOwnProperty.call(config, 'provider')) {
            this.setProvider(config.provider);
        }

        if (Object.prototype.hasOwnProperty.call(config, 'apiKey') && String(config.apiKey || '').trim()) {
            this.setApiKey(config.apiKey);
        }

        if (config.clearApiKey === true) {
            this.clearApiKey();
        }

        return this.getConfig();
    }

    getConfig() {
        const effective = this.getEffectiveConfig();
        const apiKeyConfigured = Boolean(effective.apiKey);
        return {
            provider: LEGACY_PROVIDER,
            promptTemplate: this.promptTemplate,
            modelId: effective.model,
            modelLabel: effective.model || '未填写',
            baseUrl: effective.apiUrl,
            winkyProvider: effective.provider,
            apiKeyConfigured,
            apiKeySource: this.getApiKeySource(),
            defaultPromptTemplate: DEFAULT_PROMPT_TEMPLATE,
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
        return null;
    }
}

module.exports = new DoubaoAutomation();
