const fs = require('fs');
const path = require('path');
const axios = require('axios');
const logger = require('./logger');
const doubaoAutomation = require('./doubao-automation');
const { readSecrets } = require('./secrets-store');

const DEFAULT_LUMOS_PROMPT_TEMPLATE = '参考这张图，生成五组不同的画面提示词，画面直观、主题明确，高质量3D卡通渲染，商业级游戏广告主视觉风格，电影镜头感，尽可能详细。';
const LUMOS_PROVIDER = 'lumos';
const DOUBAO_PROVIDER = 'doubao';
const IMAGE_MIME_BY_EXT = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp'
};
const MAX_IMAGE_SIZE_BYTES = 20 * 1024 * 1024;

function cleanText(value) {
    return String(value || '').trim();
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

function normalizePromptProvider(provider, fallback = DOUBAO_PROVIDER) {
    const value = cleanText(provider).toLowerCase();
    if (value === LUMOS_PROVIDER || value === 'winky' || value === 'lumos-winky') {
        return LUMOS_PROVIDER;
    }
    if (value === DOUBAO_PROVIDER || value === 'ark' || value === 'volcengine') {
        return DOUBAO_PROVIDER;
    }
    return fallback === LUMOS_PROVIDER ? LUMOS_PROVIDER : DOUBAO_PROVIDER;
}

function isAbortRequested(options = {}) {
    if (typeof options.shouldAbort === 'function' && options.shouldAbort()) {
        return true;
    }
    return Boolean(options.signal && options.signal.aborted);
}

function throwIfAborted(options = {}) {
    if (isAbortRequested(options)) {
        throw new Error('操作已取消');
    }
}

function getStoredWinkyConfig() {
    const secrets = readSecrets();
    return {
        apiKey: cleanText(process.env.WINKY_API_KEY || secrets.winkyApiKey),
        apiUrl: cleanText(process.env.WINKY_API_BASE_URL || secrets.winkyApiUrl),
        model: cleanText(process.env.WINKY_MODEL || secrets.winkyModel),
        provider: cleanText(process.env.WINKY_PROVIDER || secrets.winkyProvider)
    };
}

function getWinkyApiKeySource() {
    if (process.env.WINKY_API_KEY) return '环境变量 WINKY_API_KEY';
    if (readSecrets().winkyApiKey) return '本机密钥文件';
    return '未配置';
}

function readImageAsDataUrl(imagePath) {
    const normalizedPath = cleanText(imagePath).replace(/["']/g, '');
    if (!normalizedPath) {
        throw new Error('图片路径不能为空');
    }
    if (!fs.existsSync(normalizedPath)) {
        throw new Error(`图片文件不存在: ${normalizedPath}`);
    }

    const stat = fs.statSync(normalizedPath);
    if (!stat.isFile()) {
        throw new Error(`图片路径不是文件: ${normalizedPath}`);
    }

    const ext = path.extname(normalizedPath).toLowerCase();
    const mimeType = IMAGE_MIME_BY_EXT[ext];
    if (!mimeType) {
        throw new Error(`不支持的图片格式: ${ext || '未知'}`);
    }
    if (stat.size <= 0) {
        throw new Error('图片文件为空，无法调用提示词模型');
    }
    if (stat.size > MAX_IMAGE_SIZE_BYTES) {
        logger.warn(`⚠️ 图片文件较大（${(stat.size / 1024 / 1024).toFixed(1)}MB），Lumos Winky API 可能返回图片过大错误`);
    }

    const base64 = fs.readFileSync(normalizedPath).toString('base64');
    return `data:${mimeType};base64,${base64}`;
}

function extractContentFromApiResponse(data) {
    if (typeof data === 'string') return data.trim();
    if (!data || typeof data !== 'object') return '';
    if (typeof data.output_text === 'string') return data.output_text.trim();
    if (typeof data.text === 'string') return data.text.trim();

    const choice = Array.isArray(data.choices) ? data.choices[0] : null;
    if (choice) {
        if (typeof choice.text === 'string') return choice.text.trim();
        const message = choice.message || {};
        if (typeof message.content === 'string') return message.content.trim();
        if (Array.isArray(message.content)) {
            return message.content
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
        }
    }

    const candidate = Array.isArray(data.candidates) ? data.candidates[0] : null;
    if (candidate && candidate.content && Array.isArray(candidate.content.parts)) {
        return candidate.content.parts.map(part => part.text || '').join('\n').trim();
    }

    return '';
}

function getJsonCandidates(text) {
    const candidates = new Set();
    const trimmed = normalizePromptText(text);
    if (!trimmed) return [];

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

function extractPromptsFromParsedJson(parsed) {
    let source = null;
    if (Array.isArray(parsed)) {
        source = parsed;
    } else if (parsed && typeof parsed === 'object') {
        source = parsed.prompts || parsed.promptWords || parsed.items || parsed.data || parsed.result;
    }

    if (!Array.isArray(source)) return [];

    return source
        .map(item => {
            if (typeof item === 'string') return item;
            if (item && typeof item === 'object') {
                return item.prompt || item.content || item.text || item.description || '';
            }
            return '';
        })
        .map(normalizePromptText)
        .filter(Boolean);
}

function extractNumberedPrompts(text) {
    const normalized = normalizePromptText(text)
        .replace(/^```(?:json|plaintext|text)?\s*/i, '')
        .replace(/```$/i, '')
        .trim();
    const pattern = /(?:^|\n)\s*(?:(?:第\s*)?\d+\s*(?:组|条|[.、\)）:：])|\d+[ \t]+)\s*([\s\S]*?)(?=(?:\n\s*(?:(?:第\s*)?\d+\s*(?:组|条|[.、\)）:：])|\d+[ \t]+)\s*)|$)/g;
    const prompts = [];
    let match;

    while ((match = pattern.exec(normalized)) !== null) {
        const prompt = normalizePromptText(match[1]);
        if (prompt) prompts.push(prompt);
    }

    return prompts;
}

function parsePromptsFromText(text, providerLabel = '提示词模型') {
    const normalized = normalizePromptText(text);
    if (!normalized) {
        throw new Error(`${providerLabel} 返回内容为空`);
    }

    for (const candidate of getJsonCandidates(normalized)) {
        try {
            const prompts = extractPromptsFromParsedJson(JSON.parse(candidate));
            if (prompts.length > 0) {
                return prompts;
            }
        } catch {}
    }

    const fallbackPrompts = extractNumberedPrompts(normalized);
    if (fallbackPrompts.length > 0) {
        logger.warn(`⚠️ ${providerLabel} 未返回严格 JSON，已使用编号兜底解析`);
        return fallbackPrompts;
    }

    logger.error(`${providerLabel} 原始返回预览: ${compactForLog(normalized, 800)}`);
    throw new Error(`${providerLabel} 未返回有效提示词，只解析到 ${fallbackPrompts.length} 组`);
}

function buildLumosInstruction(promptTemplate) {
    const userInstruction = normalizePromptText(promptTemplate) || DEFAULT_LUMOS_PROMPT_TEMPLATE;
    return `${userInstruction}

请严格只返回下面这种 JSON 对象，不要添加 Markdown、代码块、解释、寒暄或资料来源。下面是默认 5 条示例；如果用户上方要求其他数量，请按该数量调整 prompts 数组长度：
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
1. prompts 数量必须与用户上方指令要求的组数一致；如果用户没有明确数量，默认返回 5 条。
2. 每条提示词都必须独立完整，适合直接发送到生图平台。
3. 每条提示词可以是中文或中英混合，不要因为包含中文而省略细节。
4. 不要把同一条提示词拆成多个数组项。`;
}

function shouldUseMaxCompletionTokens(model) {
    return /^gpt-5\.5(?:$|[-_.\s])/i.test(cleanText(model));
}

class PromptGenerationService {
    normalizeConfig(payload = {}, fallback = {}) {
        const source = payload && typeof payload === 'object' ? payload : {};
        const fallbackSource = fallback && typeof fallback === 'object' ? fallback : {};
        const storedWinky = getStoredWinkyConfig();
        const sourceLumos = source.lumos && typeof source.lumos === 'object' ? source.lumos : {};
        const fallbackLumos = fallbackSource.lumos && typeof fallbackSource.lumos === 'object' ? fallbackSource.lumos : {};
        const fallbackPrompt = doubaoAutomation.getConfig().promptTemplate || DEFAULT_LUMOS_PROMPT_TEMPLATE;

        return {
            provider: normalizePromptProvider(
                source.provider || source.promptProvider,
                normalizePromptProvider(fallbackSource.provider || fallbackSource.promptProvider, DOUBAO_PROVIDER)
            ),
            lumos: {
                model: cleanText(sourceLumos.model || source.lumosModel || fallbackLumos.model || storedWinky.model),
                baseUrl: cleanText(sourceLumos.baseUrl || source.lumosApiUrl || fallbackLumos.baseUrl || storedWinky.apiUrl),
                provider: cleanText(sourceLumos.provider || source.lumosProvider || fallbackLumos.provider || storedWinky.provider),
                promptTemplate: normalizePromptText(
                    sourceLumos.promptTemplate ||
                    source.lumosPromptTemplate ||
                    fallbackLumos.promptTemplate ||
                    fallbackPrompt
                )
            }
        };
    }

    getPublicConfig(config = {}) {
        const normalized = this.normalizeConfig(config, config);
        const storedWinky = getStoredWinkyConfig();
        const doubaoConfig = doubaoAutomation.getConfig();

        return {
            ...normalized,
            providers: [
                { value: DOUBAO_PROVIDER, label: '豆包 / 火山方舟' },
                { value: LUMOS_PROVIDER, label: 'Lumos Winky' }
            ],
            doubao: {
                modelId: doubaoConfig.modelId || '',
                modelLabel: doubaoConfig.modelLabel || doubaoConfig.modelId || '',
                apiKeyConfigured: Boolean(doubaoConfig.apiKeyConfigured)
            },
            lumos: {
                ...normalized.lumos,
                model: normalized.lumos.model || storedWinky.model,
                baseUrl: normalized.lumos.baseUrl || storedWinky.apiUrl,
                provider: normalized.lumos.provider || storedWinky.provider,
                apiKeyConfigured: Boolean(storedWinky.apiKey),
                apiKeySource: getWinkyApiKeySource(),
                configured: Boolean(storedWinky.apiKey && (normalized.lumos.baseUrl || storedWinky.apiUrl) && (normalized.lumos.model || storedWinky.model))
            }
        };
    }

    validateConfigForRun(config = {}) {
        const normalized = this.normalizeConfig(config, config);
        if (normalized.provider === DOUBAO_PROVIDER) {
            const doubaoConfig = doubaoAutomation.getConfig();
            if (!doubaoConfig.apiKeyConfigured || !doubaoConfig.modelId) {
                return {
                    success: false,
                    message: '请先在提示词生成模型配置中完成豆包 API Key 和模型 ID / Endpoint ID'
                };
            }
            return { success: true, provider: DOUBAO_PROVIDER, model: doubaoConfig.modelId };
        }

        const storedWinky = getStoredWinkyConfig();
        const lumos = {
            ...normalized.lumos,
            model: normalized.lumos.model || storedWinky.model,
            baseUrl: normalized.lumos.baseUrl || storedWinky.apiUrl,
            provider: normalized.lumos.provider || storedWinky.provider
        };

        if (!storedWinky.apiKey) {
            return {
                success: false,
                message: 'Lumos Winky API Key 未配置，请先在后端密钥中配置 WINKY_API_KEY'
            };
        }
        if (!lumos.baseUrl) {
            return {
                success: false,
                message: 'Lumos Winky API URL 未配置，请先配置 WINKY_API_BASE_URL 或在页面填写 API URL'
            };
        }
        if (!lumos.model) {
            return {
                success: false,
                message: 'Lumos Winky 模型未配置，请先选择或填写模型 ID'
            };
        }
        try {
            new URL(lumos.baseUrl);
        } catch {
            return {
                success: false,
                message: 'Lumos Winky API URL 格式不正确'
            };
        }

        return { success: true, provider: LUMOS_PROVIDER, model: lumos.model };
    }

    async generatePromptsFromImage(imagePath, config = {}, options = {}) {
        const normalized = this.normalizeConfig(config, config);
        if (normalized.provider === DOUBAO_PROVIDER) {
            const result = await doubaoAutomation.fullAutomation(imagePath, options);
            return {
                ...result,
                provider: DOUBAO_PROVIDER,
                model: doubaoAutomation.getConfig().modelId || ''
            };
        }

        try {
            const result = await this.createLumosPromptsFromImage(imagePath, normalized, options);
            return {
                success: true,
                response: JSON.stringify({ prompts: result.prompts }, null, 2),
                rawResponse: result.rawResponse,
                prompts: result.prompts,
                provider: LUMOS_PROVIDER,
                model: result.model,
                message: `已通过 Lumos Winky 获取 ${result.prompts.length} 组提示词`
            };
        } catch (error) {
            const message = this.sanitizeLumosError(error);
            logger.error(`❌ Lumos Winky 生成提示词失败: ${message}`);
            return {
                success: false,
                response: null,
                rawResponse: null,
                prompts: [],
                provider: LUMOS_PROVIDER,
                model: normalized.lumos.model || '',
                message
            };
        }
    }

    async createLumosPromptsFromImage(imagePath, config = {}, options = {}) {
        throwIfAborted(options);
        const validation = this.validateConfigForRun({ ...config, provider: LUMOS_PROVIDER });
        if (!validation.success) {
            throw new Error(validation.message);
        }

        const storedWinky = getStoredWinkyConfig();
        const lumos = {
            ...config.lumos,
            model: config.lumos.model || storedWinky.model,
            baseUrl: config.lumos.baseUrl || storedWinky.apiUrl,
            provider: config.lumos.provider || storedWinky.provider
        };
        const imageName = path.basename(cleanText(imagePath));
        const imageIndex = Number(options.imageIndex) || 1;
        const totalImages = Number(options.totalImages) || 1;

        logger.info('========================================');
        logger.info(`🔁 开始处理第 ${imageIndex}/${totalImages} 张参考图（Lumos Winky）`);
        logger.info(`图片路径: ${imagePath}`);
        logger.info(`提示词模型: Lumos Winky / ${lumos.model}`);
        logger.info('========================================');

        logger.info('正在读取本地参考图...');
        const dataUrl = readImageAsDataUrl(imagePath);
        throwIfAborted(options);

        logger.info(`✅ 参考图读取完成: ${imageName}`);
        logger.info('正在调用 Lumos Winky 图文模型...');
        const rawResponse = await this.callLumosVisionApi(dataUrl, lumos, options);

        throwIfAborted(options);
        logger.info('正在解析 Lumos Winky 返回的提示词...');
        const prompts = parsePromptsFromText(rawResponse, 'Lumos Winky');

        logger.info(`✅ Lumos Winky 已返回 ${prompts.length} 组提示词`);
        prompts.forEach((prompt, index) => {
            logger.info(` 提示词${index + 1}: ${compactForLog(prompt, 120)}`);
        });

        return {
            prompts,
            rawResponse,
            model: lumos.model
        };
    }

    async callLumosVisionApi(imageDataUrl, lumos = {}, options = {}) {
        const storedWinky = getStoredWinkyConfig();
        const payload = {
            model: lumos.model,
            messages: [
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: buildLumosInstruction(lumos.promptTemplate) },
                        {
                            type: 'image_url',
                            image_url: {
                                url: imageDataUrl
                            }
                        }
                    ]
                }
            ],
            stream: false
        };
        if (shouldUseMaxCompletionTokens(lumos.model)) {
            payload.max_completion_tokens = 8192;
        } else {
            payload.temperature = 0.75;
            payload.max_tokens = 8192;
        }

        if (lumos.provider) {
            payload.provider = lumos.provider;
        }

        try {
            const response = await axios.post(lumos.baseUrl, payload, {
                headers: {
                    Authorization: `Bearer ${storedWinky.apiKey}`,
                    'Content-Type': 'application/json'
                },
                timeout: 180000,
                signal: options.signal || undefined,
                validateStatus: () => true,
                maxContentLength: Infinity,
                maxBodyLength: Infinity
            });

            if (response.status < 200 || response.status >= 300) {
                throw new Error(`Lumos Winky API 请求失败（HTTP ${response.status}）：${this.extractErrorDetail(response.data)}`);
            }

            const text = extractContentFromApiResponse(response.data);
            if (!text) {
                throw new Error('Lumos Winky API 返回中没有可解析的文本内容');
            }
            return text;
        } catch (error) {
            if (error && error.name === 'CanceledError') {
                throw new Error('操作已取消');
            }
            if (error && error.code === 'ECONNABORTED') {
                throw new Error('Lumos Winky API 请求超时，请稍后重试或切换模型');
            }
            throw error;
        }
    }

    async listLumosModels(config = {}) {
        const normalized = this.normalizeConfig(config, config);
        const storedWinky = getStoredWinkyConfig();
        const apiKey = storedWinky.apiKey;
        const baseUrl = normalized.lumos.baseUrl || storedWinky.apiUrl;

        if (!apiKey) {
            return {
                success: false,
                models: [],
                message: 'Lumos Winky API Key 未配置'
            };
        }
        if (!baseUrl) {
            return {
                success: false,
                models: [],
                message: 'Lumos Winky API URL 未配置'
            };
        }

        try {
            const modelsUrl = this.getModelsEndpoint(baseUrl);
            const response = await axios.get(modelsUrl, {
                headers: {
                    Authorization: `Bearer ${apiKey}`
                },
                timeout: 30000,
                validateStatus: () => true
            });

            if (response.status < 200 || response.status >= 300) {
                return {
                    success: false,
                    models: [],
                    message: `模型列表读取失败（HTTP ${response.status}）：${this.extractErrorDetail(response.data)}`
                };
            }

            const source = Array.isArray(response.data?.data)
                ? response.data.data
                : (Array.isArray(response.data?.models) ? response.data.models : []);
            const models = source
                .map(item => {
                    const id = cleanText(typeof item === 'string' ? item : (item && (item.id || item.name || item.model)));
                    return id ? { value: id, label: id } : null;
                })
                .filter(Boolean);

            return {
                success: models.length > 0,
                models,
                message: models.length > 0 ? `读取到 ${models.length} 个 Lumos Winky 模型` : '未读取到可用模型，请手动填写模型 ID'
            };
        } catch (error) {
            return {
                success: false,
                models: [],
                message: this.sanitizeLumosError(error)
            };
        }
    }

    getModelsEndpoint(apiUrl) {
        const url = new URL(apiUrl);
        url.search = '';
        if (/\/chat\/completions\/?$/i.test(url.pathname)) {
            url.pathname = url.pathname.replace(/\/chat\/completions\/?$/i, '/models');
        } else if (!/\/models\/?$/i.test(url.pathname)) {
            url.pathname = url.pathname.replace(/\/+$/g, '') + '/models';
        }
        return url.toString();
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

    sanitizeLumosError(error) {
        const storedWinky = getStoredWinkyConfig();
        const message = error && error.response && error.response.data
            ? this.extractErrorDetail(error.response.data)
            : (error && error.message ? error.message : String(error || '未知错误'));
        return storedWinky.apiKey ? String(message).replaceAll(storedWinky.apiKey, '[REDACTED]') : String(message);
    }
}

module.exports = new PromptGenerationService();
module.exports.normalizePromptProvider = normalizePromptProvider;
