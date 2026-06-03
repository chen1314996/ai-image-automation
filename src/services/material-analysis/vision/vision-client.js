const axios = require('axios');
const { readSecrets } = require('../../../../secrets-store');
const { buildVisionPrompt } = require('./prompt-builder');

const DEFAULT_TIMEOUT_MS = 180000;
const DEFAULT_MAX_TOKENS = 2048;
const DEFAULT_TEMPERATURE = 0.2;

function compactText(value, maxLength = 800) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function asString(value) {
    return String(value || '').trim();
}

function asList(value, limit = 6) {
    if (!Array.isArray(value)) return [];
    return value
        .map(item => asString(item))
        .filter(Boolean)
        .slice(0, limit);
}

function normalizeVisionResult(parsed = {}) {
    return {
        summary: asString(parsed.summary),
        mainSubject: asString(parsed.mainSubject),
        scene: asString(parsed.scene),
        event: asString(parsed.event),
        emotion: asString(parsed.emotion),
        composition: asString(parsed.composition),
        color: asString(parsed.color),
        hook: asString(parsed.hook),
        retainElements: asList(parsed.retainElements),
        variationAxes: asList(parsed.variationAxes),
        riskNotes: asList(parsed.riskNotes),
        suggestedDirection: asString(parsed.suggestedDirection)
    };
}

function getStoredWinkyVisionConfig() {
    const secrets = readSecrets();
    return {
        apiKey: String(process.env.WINKY_API_KEY || secrets.winkyApiKey || '').trim(),
        apiUrl: String(process.env.WINKY_API_BASE_URL || secrets.winkyApiUrl || '').trim(),
        model: String(process.env.WINKY_MODEL || secrets.winkyModel || '').trim(),
        provider: String(process.env.WINKY_PROVIDER || secrets.winkyProvider || '').trim()
    };
}

function classifyVisionApiError(statusCode, detail = '') {
    const text = String(detail || '');
    if (statusCode === 401 || statusCode === 403) return 'AUTH_FAILED';
    if (statusCode === 429) return 'RATE_LIMIT';
    if (/context_length|max_tokens|maximum context|token/i.test(text)) return 'TOKEN_LIMIT';
    return 'API_ERROR';
}

function shouldUseMaxCompletionTokens(model) {
    return /^gpt-5\.5(?:$|[-_.\s])/i.test(String(model || '').trim());
}

function isFatalVisionApiCode(code) {
    return code === 'AUTH_FAILED';
}

class MaterialVisionClient {
    constructor(options = {}) {
        this.axios = options.axios || axios;
        this.getConfig = options.getConfig || getStoredWinkyVisionConfig;
        this.timeoutMs = Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS;
        this.temperature = Number.isFinite(Number(options.temperature))
            ? Number(options.temperature)
            : DEFAULT_TEMPERATURE;
        this.maxTokens = Number(options.maxTokens) || DEFAULT_MAX_TOKENS;
    }

    validateConfig() {
        const config = this.getConfig();
        if (!config.apiKey) {
            throw new Error('请先配置 Lumos Winky API Key 后再启动 AI 视觉识别');
        }
        if (!config.apiUrl) {
            throw new Error('请先配置 Lumos Winky API 地址后再启动 AI 视觉识别');
        }
        if (!config.model) {
            throw new Error('请先配置 Lumos Winky 模型后再启动 AI 视觉识别');
        }
        return config;
    }

    buildPayload({ material, imageDataUrl }) {
        const config = this.validateConfig();
        const payload = {
            model: config.model,
            messages: [
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: buildVisionPrompt(material) },
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

        return {
            config,
            payload
        };
    }

    getCacheMeta() {
        const config = this.validateConfig();
        return {
            provider: 'lumos-winky',
            apiUrl: config.apiUrl,
            model: config.model,
            modelProvider: config.provider || ''
        };
    }

    async analyzeImage({ material, imageDataUrl, signal }) {
        const { config, payload } = this.buildPayload({ material, imageDataUrl });
        const response = await this.axios.post(config.apiUrl, payload, {
            headers: {
                Authorization: `Bearer ${config.apiKey}`,
                'Content-Type': 'application/json'
            },
            timeout: this.timeoutMs,
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
            signal,
            validateStatus: () => true
        });

        if (response.status < 200 || response.status >= 300) {
            const detail = this.extractErrorDetail(response.data);
            const code = classifyVisionApiError(response.status, detail);
            const error = new Error(`Lumos Winky 视觉识别请求失败 HTTP ${response.status}: ${detail}`);
            error.name = 'MaterialVisionApiError';
            error.statusCode = response.status;
            error.detail = detail;
            error.code = code;
            error.fatal = isFatalVisionApiCode(code);
            if (code === 'AUTH_FAILED') {
                error.userMessage = 'Lumos Winky 鉴权失败，请检查 Winky API Key、接口地址、模型名和账号权限。';
            } else if (code === 'RATE_LIMIT') {
                error.userMessage = 'Lumos Winky 当前请求频率或额度受限，请稍后重试，或降低并发数量。';
            }
            throw error;
        }

        const rawText = this.extractText(response.data);
        return {
            rawText,
            result: this.parseVisionJson(rawText)
        };
    }

    extractText(data) {
        if (typeof data === 'string') return data.trim();
        if (!data || typeof data !== 'object') {
            throw new Error('Lumos Winky 视觉识别返回内容为空');
        }
        if (typeof data.output_text === 'string' && data.output_text.trim()) {
            return data.output_text.trim();
        }
        if (typeof data.text === 'string' && data.text.trim()) {
            return data.text.trim();
        }

        const choice = Array.isArray(data.choices) ? data.choices[0] : null;
        if (choice) {
            const message = choice.message || {};
            const content = message.content;
            if (typeof content === 'string' && content.trim()) {
                return content.trim();
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
                if (text) return text;
            }
            if (typeof choice.text === 'string' && choice.text.trim()) {
                return choice.text.trim();
            }
        }

        const candidate = Array.isArray(data.candidates) ? data.candidates[0] : null;
        if (candidate && candidate.content && Array.isArray(candidate.content.parts)) {
            const text = candidate.content.parts
                .map(part => part && part.text ? part.text : '')
                .filter(Boolean)
                .join('\n')
                .trim();
            if (text) return text;
        }

        throw new Error('Lumos Winky 视觉识别返回内容为空');
    }

    parseVisionJson(rawText) {
        const text = String(rawText || '').trim();
        const candidates = [
            text,
            text.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim()
        ];
        const first = text.indexOf('{');
        const last = text.lastIndexOf('}');
        if (first !== -1 && last > first) {
            candidates.push(text.slice(first, last + 1));
        }

        for (const candidate of candidates) {
            try {
                const parsed = JSON.parse(candidate);
                const normalized = normalizeVisionResult(parsed);
                if (normalized.summary || normalized.mainSubject || normalized.hook) {
                    return normalized;
                }
            } catch {}
        }

        throw new Error(`Lumos Winky 未返回有效 JSON: ${compactText(text)}`);
    }

    extractErrorDetail(data) {
        if (!data) return '无错误详情';
        if (typeof data === 'string') return compactText(data);
        if (data.error) {
            if (typeof data.error === 'string') return compactText(data.error);
            if (data.error.message) return compactText(data.error.message);
        }
        if (data.message) return compactText(data.message);
        return compactText(JSON.stringify(data));
    }
}

module.exports = {
    MaterialVisionClient,
    normalizeVisionResult,
    classifyVisionApiError,
    getStoredWinkyVisionConfig
};
