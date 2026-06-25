const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');

const AUTO_CURATOR_VERSION = 'p3-shadow-auto-curator-v1';
const LOW_CONFIDENCE_THRESHOLD = 0.62;
const AUTO_GRADES = new Set(['good', 'normal', 'bad', 'off_direction', 'text_problem']);

function nowIso() {
    return new Date().toISOString();
}

function safeArray(value) {
    return Array.isArray(value) ? value : [];
}

function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function clampNumber(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(min, Math.min(max, number));
}

function hashNumber(value) {
    const hex = crypto.createHash('sha1').update(String(value || '')).digest('hex').slice(0, 8);
    return parseInt(hex, 16);
}

function getMimeType(filePath = '') {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
    if (ext === '.webp') return 'image/webp';
    if (ext === '.gif') return 'image/gif';
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
    const firstChoice = Array.isArray(data.choices) ? data.choices[0] : null;
    if (!firstChoice) return '';
    if (typeof firstChoice.text === 'string') return firstChoice.text;
    const message = firstChoice.message || {};
    if (typeof message.content === 'string') return message.content;
    if (Array.isArray(message.content)) {
        return message.content
            .map(part => typeof part === 'string' ? part : normalizeText(part && (part.text || part.content)))
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
        throw new Error('Auto Curator did not return parseable JSON');
    }
}

function scoreToGrade(score) {
    if (score >= 78) return 'good';
    if (score >= 56) return 'normal';
    return 'bad';
}

function normalizeAutoGrade(value, fallbackScore) {
    const grade = normalizeText(value).toLowerCase();
    if (AUTO_GRADES.has(grade)) return grade;
    return scoreToGrade(Number(fallbackScore) || 0);
}

function normalizeScoreResult(raw = {}, asset = {}, context = {}) {
    const score = Math.round(clampNumber(
        raw.autoScore !== undefined ? raw.autoScore : raw.score,
        0,
        100,
        50
    ));
    const confidence = Number(clampNumber(raw.confidence, 0, 1, 0.5).toFixed(3));
    const autoGrade = normalizeAutoGrade(raw.autoGrade || raw.grade, score);
    const failureType = normalizeText(raw.failureType || raw.problemType || '');
    const reason = normalizeText(raw.reason || raw.summary || 'Shadow curator generated a quality recommendation.').slice(0, 1200);
    const evidence = safeArray(raw.evidence)
        .map(item => normalizeText(item).slice(0, 240))
        .filter(Boolean)
        .slice(0, 8);

    return {
        version: AUTO_CURATOR_VERSION,
        autoCuratorVersion: AUTO_CURATOR_VERSION,
        mode: 'shadow',
        status: 'scored',
        assetId: asset.assetId || '',
        runId: asset.runId || '',
        score,
        autoScore: score,
        confidence,
        autoGrade,
        failureType,
        reason,
        evidence,
        needsHumanReview: confidence < LOW_CONFIDENCE_THRESHOLD,
        provider: context.provider || 'metadata-shadow',
        model: context.model || '',
        scoredAt: context.scoredAt || nowIso()
    };
}

function buildMetadataShadowScore(asset = {}) {
    const seed = [
        asset.assetId,
        asset.runId,
        asset.promptHash,
        asset.prompt,
        asset.fileName,
        asset.outputIndex
    ].join('|');
    const bucket = hashNumber(seed) % 31;
    const prompt = normalizeText(asset.prompt || asset.promptDirection || asset.promptTitle);
    const hasFile = Boolean(asset.filePath && fs.existsSync(asset.filePath));
    let score = 54 + bucket;
    let autoGrade = scoreToGrade(score);
    let confidence = hasFile ? 0.58 : 0.44;
    const evidence = [];

    if (!hasFile) {
        score = Math.min(score, 55);
        evidence.push('Local image file is missing, so this is metadata-only shadow scoring.');
    }
    if (/文字|text|logo|字幕/i.test(prompt)) {
        confidence = Math.max(0.5, confidence - 0.06);
        evidence.push('Prompt mentions visible text or logo risk; route to human sampling if uncertain.');
    }
    if (/跑题|off.?direction|不符|avoid/i.test(prompt)) {
        score = Math.min(score, 48);
        autoGrade = 'off_direction';
        confidence = Math.max(confidence, 0.6);
        evidence.push('Prompt metadata contains off-direction risk terms.');
    }
    if (/文字差|乱码|text_problem/i.test(prompt)) {
        score = Math.min(score, 46);
        autoGrade = 'text_problem';
        confidence = Math.max(confidence, 0.6);
        evidence.push('Prompt metadata contains text-problem risk terms.');
    }

    return normalizeScoreResult({
        score,
        confidence,
        autoGrade,
        failureType: autoGrade === 'off_direction' || autoGrade === 'text_problem' ? autoGrade : '',
        reason: hasFile
            ? 'Metadata shadow score generated without changing manual review fields.'
            : 'Image file was unavailable; result is intentionally low confidence for human sampling.',
        evidence
    }, asset, {
        provider: 'metadata-shadow',
        model: 'local-deterministic'
    });
}

function buildCuratorMessages(asset = {}, imageUrl) {
    const systemPrompt = [
        'You are Shadow Auto Curator for an AI image generation workflow.',
        'You review generated images, but you must only recommend; never claim to change manual review status.',
        'Score the image as an advertising creative sample against the prompt and direction.',
        'Return strict JSON only with this shape:',
        '{"autoScore":0-100,"confidence":0-1,"autoGrade":"good|normal|bad|off_direction|text_problem","failureType":"","reason":"","evidence":[""]}.',
        'Use off_direction when the image clearly misses the direction or prompt. Use text_problem when visible text/logos/typography are broken.',
        'Keep reasons concise and operational.'
    ].join('\n');

    const userText = [
        '# Asset Metadata',
        JSON.stringify({
            assetId: asset.assetId || '',
            runId: asset.runId || '',
            directionPath: asset.directionPath || asset.sourceDirectionPath || '',
            directionName: asset.directionName || '',
            promptTitle: asset.promptTitle || '',
            promptDirection: asset.promptDirection || '',
            prompt: asset.prompt || '',
            fileName: asset.fileName || ''
        }, null, 2)
    ].join('\n');

    return [
        { role: 'system', content: systemPrompt },
        {
            role: 'user',
            content: [
                { type: 'text', text: userText },
                { type: 'image_url', image_url: { url: imageUrl } }
            ]
        }
    ];
}

async function callWinkyVision({ asset, winkyConfig = {}, scoringClient }) {
    if (typeof scoringClient === 'function') {
        return await scoringClient({
            asset,
            version: AUTO_CURATOR_VERSION,
            messages: buildCuratorMessages(asset, asset.imageUrl || asset.filePath || '')
        });
    }

    if (!winkyConfig.apiKey || !winkyConfig.apiUrl || !winkyConfig.model) {
        throw new Error('Lumos Winky config is incomplete');
    }
    if (!asset.filePath || !fs.existsSync(asset.filePath)) {
        throw new Error('Asset image file is missing');
    }

    const payload = {
        model: winkyConfig.model,
        provider: winkyConfig.provider || undefined,
        messages: buildCuratorMessages(asset, fileToDataUrl(asset.filePath)),
        stream: false,
        response_format: { type: 'json_object' }
    };
    if (/^gpt-5\.5(?:$|[-_.\s])/i.test(winkyConfig.model)) {
        payload.max_completion_tokens = Number(winkyConfig.maxTokens) || 1600;
    } else {
        payload.temperature = 0.18;
        payload.max_tokens = Number(winkyConfig.maxTokens) || 1600;
    }

    const client = winkyConfig.axios || axios;
    const response = await client.post(winkyConfig.apiUrl, payload, {
        timeout: Number(winkyConfig.timeoutMs) || 180000,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        headers: {
            Authorization: `Bearer ${winkyConfig.apiKey}`,
            'Content-Type': 'application/json'
        }
    });
    return extractJsonObject(extractModelText(response && response.data ? response.data : response));
}

async function withRetry(operation, options = {}) {
    const retries = Math.max(0, Math.min(3, Math.floor(Number(options.retries) || 0)));
    let lastError = null;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
        try {
            return await operation(attempt);
        } catch (error) {
            lastError = error;
            if (attempt >= retries) break;
            await new Promise(resolve => setTimeout(resolve, 400 * (attempt + 1)));
        }
    }
    throw lastError;
}

function createAutoCuratorScorer(context = {}) {
    const getStoredWinkyConfig = typeof context.getStoredWinkyConfig === 'function'
        ? context.getStoredWinkyConfig
        : () => ({});
    const scoringClient = context.scoringClient;

    async function scoreAsset(asset = {}, options = {}) {
        const allowMetadataFallback = options.allowMetadataFallback !== false;
        const winkyConfig = {
            ...getStoredWinkyConfig(),
            ...(options.winkyConfig && typeof options.winkyConfig === 'object' ? options.winkyConfig : {})
        };

        const canUseWinky = scoringClient || (winkyConfig.apiKey && winkyConfig.apiUrl && winkyConfig.model && asset.filePath && fs.existsSync(asset.filePath));
        if (!canUseWinky) {
            if (!allowMetadataFallback) {
                throw new Error('Lumos Winky vision is unavailable and metadata fallback is disabled');
            }
            return buildMetadataShadowScore(asset);
        }

        const raw = await withRetry(
            () => callWinkyVision({ asset, winkyConfig, scoringClient }),
            { retries: options.retries }
        );
        return normalizeScoreResult(raw, asset, {
            provider: scoringClient ? 'test-client' : 'lumos-winky',
            model: scoringClient ? 'mock' : winkyConfig.model,
            scoredAt: nowIso()
        });
    }

    return {
        scoreAsset
    };
}

module.exports = {
    AUTO_CURATOR_VERSION,
    LOW_CONFIDENCE_THRESHOLD,
    createAutoCuratorScorer,
    normalizeScoreResult,
    scoreToGrade
};
