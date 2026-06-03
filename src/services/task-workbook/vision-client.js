const fs = require('fs');
const axios = require('axios');
const { getStoredWinkyVisionConfig, classifyVisionApiError } = require('../material-analysis/vision/vision-client');

const DEFAULT_TIMEOUT_MS = 180000;
const DEFAULT_MAX_TOKENS = 2048;
const DEFAULT_TEMPERATURE = 0.2;

function asString(value) {
    return String(value || '').trim();
}

function asList(value, limit = 8) {
    if (!Array.isArray(value)) return [];
    return value
        .map(item => asString(item))
        .filter(Boolean)
        .slice(0, limit);
}

function compactText(value, maxLength = 1200) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function normalizeTaskVisionResult(parsed = {}) {
    const suggestedExpansion = parsed.suggestedExpansion && typeof parsed.suggestedExpansion === 'object'
        ? parsed.suggestedExpansion
        : {};
    const priority = Number(suggestedExpansion.priority ?? parsed.priority ?? parsed.expandScore);
    return {
        visualSummary: asString(parsed.visualSummary || parsed.summary),
        creativeCore: asString(parsed.creativeCore || parsed.hook || parsed.core),
        mustKeep: asList(parsed.mustKeep || parsed.retainElements),
        variationAxes: asList(parsed.variationAxes),
        avoidRules: asList(parsed.avoidRules || parsed.riskNotes),
        riskNotes: asList(parsed.riskNotes || parsed.avoidRules),
        suggestedExpansion: {
            mode: asString(suggestedExpansion.mode || 'creative-expansion'),
            newDirectionsPerSource: Number(suggestedExpansion.newDirectionsPerSource) || 5,
            promptsPerNewDirection: Number(suggestedExpansion.promptsPerNewDirection) || 5,
            priority: Number.isFinite(priority) ? Math.max(0, Math.min(100, Math.round(priority))) : 70
        },
        legilReferencePolicy: {
            useTaskReferenceImagesForLegil: false,
            reason: asString(parsed.legilReferencePolicy && parsed.legilReferencePolicy.reason) ||
                '任务表参考图只用于方向理解和前端预览，不默认上传给 Legil。'
        }
    };
}

function shouldUseMaxCompletionTokens(model) {
    return /^gpt-5\.5(?:$|[-_.\s])/i.test(String(model || '').trim());
}

function imageDataUrl(image = {}) {
    if (image.dataUrl) return image.dataUrl;
    if (!image.filePath) return '';
    const mimeType = image.mimeType || 'image/jpeg';
    const buffer = fs.readFileSync(image.filePath);
    return `data:${mimeType};base64,${buffer.toString('base64')}`;
}

function buildTaskDirectionVisionPrompt(taskDirection = {}) {
    const input = {
        taskDirectionId: taskDirection.taskDirectionId,
        sourceRow: taskDirection.sourceRow,
        sourcePath: taskDirection.sourcePath,
        primaryTag: taskDirection.primaryTag,
        secondaryTag: taskDirection.secondaryTag,
        tertiaryTag: taskDirection.tertiaryTag,
        subDirection: taskDirection.subDirection,
        iterationDescription: taskDirection.iterationDescription,
        directionDescription: taskDirection.directionDescription,
        referenceImageCount: Array.isArray(taskDirection.referenceImages) ? taskDirection.referenceImages.length : 0,
        referenceImagePolicy: {
            forVisionUnderstanding: true,
            forFrontendPreview: true,
            useForLegilReferenceUpload: false
        }
    };

    return `你是游戏广告创意方向整理 Agent，正在把人工策划的自动化任务表行整理成可执行的创意拓展方向卡片。
请结合任务行文本和参考图，提炼这个方向的视觉摘要、创意核心、必须保留元素、可变化轴和避坑规则。

任务行：
${JSON.stringify(input, null, 2)}

重要规则：
1. 参考图只用于理解方向和前端预览，不要建议默认上传给 Legil。
2. 不要把这个任务方向写入正式方向知识库，只输出方向卡片信息。
3. 输出必须是严格 JSON，不要 Markdown，不要解释。
4. mustKeep、variationAxes、avoidRules 每项最多 8 条，短句即可。

请只返回：
{
  "visualSummary": "一句话总结参考图和方向画面",
  "creativeCore": "这个任务真正要验证的创意核心",
  "mustKeep": ["必须保留元素"],
  "variationAxes": ["后续可以变化的轴"],
  "avoidRules": ["生成时应避免的问题"],
  "riskNotes": ["可选风险点"],
  "suggestedExpansion": {
    "mode": "creative-expansion",
    "newDirectionsPerSource": 5,
    "promptsPerNewDirection": 5,
    "priority": 0
  },
  "legilReferencePolicy": {
    "useTaskReferenceImagesForLegil": false,
    "reason": "任务表参考图只用于理解方向和前端预览，避免 Legil 参考图影响创意拓展发散。"
  }
}`;
}

class TaskDirectionVisionClient {
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
        if (!config.apiKey) throw new Error('请先配置 Lumos Winky API Key 后再启动任务方向视觉整理');
        if (!config.apiUrl) throw new Error('请先配置 Lumos Winky API 地址后再启动任务方向视觉整理');
        if (!config.model) throw new Error('请先配置 Lumos Winky 模型后再启动任务方向视觉整理');
        return config;
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

    buildPayload(taskDirection = {}) {
        const config = this.validateConfig();
        const content = [
            {
                type: 'text',
                text: buildTaskDirectionVisionPrompt(taskDirection)
            }
        ];
        (taskDirection.referenceImages || []).slice(0, 3).forEach(image => {
            const dataUrl = imageDataUrl(image);
            if (!dataUrl) return;
            content.push({
                type: 'image_url',
                image_url: {
                    url: dataUrl,
                    detail: 'auto'
                }
            });
        });

        const payload = {
            model: config.model,
            messages: [
                {
                    role: 'user',
                    content
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
        return { config, payload };
    }

    async analyzeTaskDirection({ taskDirection, signal }) {
        const { config, payload } = this.buildPayload(taskDirection);
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
            const error = new Error(`Lumos Winky 任务方向视觉整理失败 HTTP ${response.status}: ${detail}`);
            error.name = 'TaskDirectionVisionApiError';
            error.statusCode = response.status;
            error.detail = detail;
            error.code = code;
            error.fatal = code === 'AUTH_FAILED';
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
        if (!data || typeof data !== 'object') throw new Error('Lumos Winky 返回内容为空');
        if (typeof data.output_text === 'string' && data.output_text.trim()) return data.output_text.trim();
        if (typeof data.text === 'string' && data.text.trim()) return data.text.trim();
        const choice = Array.isArray(data.choices) ? data.choices[0] : null;
        if (choice) {
            const message = choice.message || {};
            if (typeof message.content === 'string' && message.content.trim()) return message.content.trim();
            if (Array.isArray(message.content)) {
                const text = message.content
                    .map(item => (item && (item.text || item.content)) || '')
                    .filter(Boolean)
                    .join('\n')
                    .trim();
                if (text) return text;
            }
            if (typeof choice.text === 'string' && choice.text.trim()) return choice.text.trim();
        }
        throw new Error('Lumos Winky 返回内容为空');
    }

    parseVisionJson(rawText) {
        const text = String(rawText || '').trim();
        const candidates = [
            text,
            text.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim()
        ];
        const first = text.indexOf('{');
        const last = text.lastIndexOf('}');
        if (first !== -1 && last > first) candidates.push(text.slice(first, last + 1));

        for (const candidate of candidates) {
            try {
                const parsed = JSON.parse(candidate);
                const normalized = normalizeTaskVisionResult(parsed);
                if (normalized.visualSummary || normalized.creativeCore || normalized.mustKeep.length) {
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
    TaskDirectionVisionClient,
    normalizeTaskVisionResult,
    buildTaskDirectionVisionPrompt
};
