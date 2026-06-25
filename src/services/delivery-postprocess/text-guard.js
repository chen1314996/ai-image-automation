const fs = require('fs');
const path = require('path');
const axios = require('axios');

const { getStoredWinkyVisionConfig } = require('../material-analysis/vision/vision-client');

const TEXT_GUARD_VERSION = 'delivery-text-guard-v1';

function nowIso() {
    return new Date().toISOString();
}

function normalizeText(value, maxLength = 800) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function safeArray(value, limit = 8) {
    return Array.isArray(value)
        ? value.map(item => normalizeText(item, 160)).filter(Boolean).slice(0, limit)
        : [];
}

function getMimeType(filePath = '') {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
    if (ext === '.webp') return 'image/webp';
    return 'image/png';
}

function fileToDataUrl(filePath) {
    const buffer = fs.readFileSync(filePath);
    return `data:${getMimeType(filePath)};base64,${buffer.toString('base64')}`;
}

function extractModelText(data) {
    if (typeof data === 'string') return data;
    if (!data || typeof data !== 'object') return '';
    if (typeof data.output_text === 'string') return data.output_text;
    if (typeof data.text === 'string') return data.text;

    const choice = Array.isArray(data.choices) ? data.choices[0] : null;
    if (!choice) return '';
    if (typeof choice.text === 'string') return choice.text;

    const content = choice.message && choice.message.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        return content
            .map(part => {
                if (!part) return '';
                if (typeof part === 'string') return part;
                return part.text || part.content || '';
            })
            .filter(Boolean)
            .join('\n');
    }
    return '';
}

function extractJsonObject(text) {
    const raw = String(text || '').trim()
        .replace(/^```(?:json)?/i, '')
        .replace(/```$/i, '')
        .trim();
    try {
        return JSON.parse(raw);
    } catch {
        const start = raw.indexOf('{');
        const end = raw.lastIndexOf('}');
        if (start >= 0 && end > start) {
            return JSON.parse(raw.slice(start, end + 1));
        }
        throw new Error('Lumos Winky 未返回可解析的文字质检 JSON');
    }
}

function normalizeRiskLevel(value, hasTextProblem = false) {
    const text = normalizeText(value).toLowerCase();
    if (['none', 'low', 'medium', 'high'].includes(text)) return text;
    return hasTextProblem ? 'high' : 'none';
}

function normalizeTextQuality(raw = {}, context = {}) {
    const hasTextProblem = raw.hasTextProblem === true ||
        raw.textProblem === true ||
        /true|yes|high|medium|文字|英文|乱码|watermark|logo/i.test(String(raw.hasTextProblem || raw.textProblem || ''));
    const riskLevel = normalizeRiskLevel(raw.riskLevel || raw.level, hasTextProblem);
    const score = Number.isFinite(Number(raw.score))
        ? Math.max(0, Math.min(100, Math.round(Number(raw.score))))
        : (hasTextProblem ? 90 : 5);

    return {
        version: TEXT_GUARD_VERSION,
        status: 'checked',
        hasTextProblem,
        textProblem: hasTextProblem,
        riskLevel,
        score,
        detectedTextKinds: safeArray(raw.detectedTextKinds || raw.textKinds || raw.evidence),
        reason: normalizeText(raw.reason || raw.summary || '', 500),
        provider: context.provider || 'lumos-winky',
        model: context.model || '',
        checkedAt: context.checkedAt || nowIso()
    };
}

function buildTextGuardMessages(candidate = {}) {
    const systemPrompt = [
        'You are a strict delivery QA inspector for AI image resizing candidates.',
        'Your only task is to detect unwanted visible text pollution in the image.',
        'Mark hasTextProblem=true if the image contains visible English words, letters, numbers, fake/garbled text, watermark, signature, UI copy, price tags, labels, packaging text, brand-like logos, or corrupted typography.',
        'Mark hasTextProblem=false when the image is visually clean, or when tiny natural texture only vaguely resembles text.',
        'Return JSON only: {"hasTextProblem":boolean,"riskLevel":"none|low|medium|high","score":0-100,"detectedTextKinds":[""],"reason":""}.'
    ].join('\n');

    const userText = [
        '检查这张 Legil 改尺寸候选图是否出现不需要的英文、数字、乱码、伪文字、水印、签名、UI 文案、价格牌、标签、包装文字或品牌样式文字。',
        '如果只是自然纹理、雪地纹路、衣服褶皱、背景噪声，不要误判。',
        '请只返回 JSON。',
        JSON.stringify({
            candidateId: candidate.candidateId || '',
            targetSize: candidate.targetSize || '',
            fileName: candidate.fileName || ''
        })
    ].join('\n');

    return [
        { role: 'system', content: systemPrompt },
        {
            role: 'user',
            content: [
                { type: 'text', text: userText },
                {
                    type: 'image_url',
                    image_url: {
                        url: candidate.imageUrl || fileToDataUrl(candidate.filePath),
                        detail: 'auto'
                    }
                }
            ]
        }
    ];
}

function shouldUseMaxCompletionTokens(model) {
    return /^gpt-5\.5(?:$|[-_.\s])/i.test(String(model || '').trim());
}

async function callWinkyTextGuard({ candidate, winkyConfig = {}, client = axios }) {
    if (!winkyConfig.apiKey || !winkyConfig.apiUrl || !winkyConfig.model) {
        throw new Error('Lumos Winky 配置不完整，跳过候选图文字质检');
    }
    if (!candidate.filePath || !fs.existsSync(candidate.filePath)) {
        throw new Error('候选图文件不存在，无法进行文字质检');
    }

    const payload = {
        model: winkyConfig.model,
        provider: winkyConfig.provider || undefined,
        messages: buildTextGuardMessages(candidate),
        stream: false,
        response_format: { type: 'json_object' }
    };
    if (shouldUseMaxCompletionTokens(winkyConfig.model)) {
        payload.max_completion_tokens = Number(winkyConfig.maxTokens) || 900;
    } else {
        payload.temperature = 0.1;
        payload.max_tokens = Number(winkyConfig.maxTokens) || 900;
    }

    const response = await client.post(winkyConfig.apiUrl, payload, {
        timeout: Number(winkyConfig.timeoutMs) || 120000,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        headers: {
            Authorization: `Bearer ${winkyConfig.apiKey}`,
            'Content-Type': 'application/json'
        },
        validateStatus: () => true
    });

    if (!response || response.status < 200 || response.status >= 300) {
        const detail = normalizeText(response && response.data ? JSON.stringify(response.data) : '', 500);
        throw new Error(`Lumos Winky 文字质检失败 HTTP ${response && response.status}: ${detail}`);
    }

    return extractJsonObject(extractModelText(response.data));
}

async function analyzeDeliveryCandidateTextQuality(candidate = {}, options = {}) {
    const checkedAt = nowIso();
    try {
        if (typeof options.scoringClient === 'function') {
            const raw = await options.scoringClient({
                candidate,
                version: TEXT_GUARD_VERSION,
                messages: buildTextGuardMessages({
                    ...candidate,
                    imageUrl: candidate.imageUrl || candidate.filePath || ''
                })
            });
            return normalizeTextQuality(raw, {
                provider: 'test-client',
                model: 'mock',
                checkedAt
            });
        }

        const winkyConfig = {
            ...getStoredWinkyVisionConfig(),
            ...(options.winkyConfig && typeof options.winkyConfig === 'object' ? options.winkyConfig : {})
        };
        const raw = await callWinkyTextGuard({
            candidate,
            winkyConfig,
            client: options.client || axios
        });
        return normalizeTextQuality(raw, {
            provider: 'lumos-winky',
            model: winkyConfig.model,
            checkedAt
        });
    } catch (error) {
        if (options.throwOnError === true) {
            throw error;
        }
        return {
            version: TEXT_GUARD_VERSION,
            status: 'unchecked',
            hasTextProblem: false,
            textProblem: false,
            riskLevel: 'unknown',
            score: 0,
            detectedTextKinds: [],
            reason: normalizeText(error.message || error, 500),
            provider: 'lumos-winky',
            model: '',
            checkedAt
        };
    }
}

function isCandidateTextRisky(candidate = {}) {
    const quality = candidate.textQuality || {};
    return candidate.textProblem === true ||
        quality.hasTextProblem === true ||
        ['medium', 'high'].includes(String(quality.riskLevel || '').toLowerCase());
}

function sortCandidatesByTextQuality(candidates = []) {
    const source = Array.isArray(candidates) ? candidates : [];
    const safe = source.filter(candidate => !isCandidateTextRisky(candidate));
    const risky = source.filter(candidate => isCandidateTextRisky(candidate));
    return safe.length ? [...safe, ...risky] : source;
}

module.exports = {
    TEXT_GUARD_VERSION,
    analyzeDeliveryCandidateTextQuality,
    isCandidateTextRisky,
    sortCandidatesByTextQuality,
    normalizeTextQuality
};
