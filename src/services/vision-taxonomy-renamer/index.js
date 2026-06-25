const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const { createCanvas, loadImage } = require('canvas');

const { readSecrets } = require('../../../secrets-store');
const {
    formatDateTimeForFile,
    sortNaturallyByName
} = require('../../../file-utils');

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp']);
const DEFAULT_MAX_SIDE = 1024;
const DEFAULT_CONCURRENCY = 2;
const DEFAULT_TIMEOUT_MS = 180000;
const DEFAULT_MIN_CONFIDENCE = 0.8;
const DEFAULT_INCLUDED_STATUSES = ['seed', 'accepted'];
const EMPTY_LABELS = new Set(['', '暂无', '无', 'none', 'null', '-']);

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

function readJson(filePath, fallback) {
    if (!fs.existsSync(filePath)) return fallback;
    const text = fs.readFileSync(filePath, 'utf8');
    if (!text.trim()) return fallback;
    return JSON.parse(text);
}

function writeJson(filePath, data) {
    ensureDir(path.dirname(filePath));
    const tempPath = `${filePath}.tmp`;
    fs.writeFileSync(tempPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    fs.renameSync(tempPath, filePath);
}

function normalizeInputPath(value) {
    return String(value || '').replace(/["']/g, '').trim();
}

function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function compactText(value) {
    return String(value || '').replace(/\s+/g, '').trim();
}

function isEmptyLabel(value) {
    return EMPTY_LABELS.has(compactText(value).toLowerCase());
}

function sanitizeNamePart(value, maxLength = 36) {
    const text = cleanText(value);
    if (!text || isEmptyLabel(text)) return '';
    return text
        .replace(/[\/\\]+/g, '-')
        .replace(/[<>:"|?*\x00-\x1F]/g, '_')
        .replace(/\s+/g, '')
        .replace(/_+/g, '_')
        .replace(/[. ]+$/g, '')
        .replace(/^_+|_+$/g, '')
        .slice(0, maxLength);
}

function sha1(value) {
    return crypto.createHash('sha1').update(value).digest('hex');
}

function labelKey(parts) {
    return (Array.isArray(parts) ? parts : [])
        .map(compactText)
        .filter(Boolean)
        .join('/');
}

function normalizeStatusList(value) {
    const raw = Array.isArray(value) ? value : DEFAULT_INCLUDED_STATUSES;
    const statuses = raw.map(item => String(item || '').trim()).filter(Boolean);
    return statuses.length ? [...new Set(statuses)] : [...DEFAULT_INCLUDED_STATUSES];
}

function normalizeConfidence(value, fallback = 0) {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue)) return fallback;
    return Math.max(0, Math.min(1, numberValue));
}

function confidenceBand(confidence, minConfidence = DEFAULT_MIN_CONFIDENCE) {
    if (confidence >= minConfidence) return 'strong';
    if (confidence >= 0.65) return 'weak';
    return 'low';
}

function statusForBand(prefix, band) {
    if (band === 'strong') return prefix;
    return `${prefix}_${band}`;
}

function parseJson(rawText) {
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
            return JSON.parse(candidate);
        } catch (_) {}
    }
    throw new Error(`无法解析 Winky JSON: ${text.slice(0, 500)}`);
}

function extractResponseText(data) {
    if (typeof data === 'string') return data.trim();
    if (!data || typeof data !== 'object') throw new Error('Winky 返回为空');
    if (typeof data.output_text === 'string' && data.output_text.trim()) return data.output_text.trim();
    if (typeof data.text === 'string' && data.text.trim()) return data.text.trim();
    const choice = Array.isArray(data.choices) ? data.choices[0] : null;
    if (choice) {
        if (typeof choice.text === 'string' && choice.text.trim()) return choice.text.trim();
        const content = choice.message && choice.message.content;
        if (typeof content === 'string' && content.trim()) return content.trim();
        if (Array.isArray(content)) {
            const text = content.map(item => item && (item.text || item.content || '')).filter(Boolean).join('\n').trim();
            if (text) return text;
        }
    }
    throw new Error('Winky 返回中没有文本内容');
}

function extractError(data) {
    if (!data) return '';
    if (typeof data === 'string') return data.slice(0, 600);
    return JSON.stringify(data).slice(0, 800);
}

function shouldUseMaxCompletionTokens(model) {
    return /^gpt-5/i.test(String(model || ''));
}

function imageFilesIn(dir) {
    return sortNaturallyByName(fs.readdirSync(dir))
        .filter(name => IMAGE_EXTENSIONS.has(path.extname(name).toLowerCase()))
        .map(name => path.join(dir, name));
}

function sourcePrefix(filePath, sequence) {
    const base = path.basename(filePath, path.extname(filePath));
    const match = base.match(/^(\d{8}_\d{6}_\d{3,5})_/);
    if (match) return match[1];
    return `visionrename_${String(sequence).padStart(4, '0')}`;
}

function sourceTimestamp(filePath) {
    const base = path.basename(filePath, path.extname(filePath));
    const match = base.match(/_(\d{8}_\d{6})$/);
    if (match) return match[1];
    const stat = fs.statSync(filePath);
    return formatDateTimeForFile(stat.mtime);
}

function originalNameHints(filePath) {
    const name = path.basename(filePath, path.extname(filePath));
    return name
        .replace(/^\d{8}_\d{6}_\d+_/, '')
        .replace(/_\d{8}_\d{6}$/, '')
        .split('_')
        .filter(Boolean)
        .filter(part => !/^(ref|prompt)\d+$/i.test(part))
        .filter(part => !/^v\d+$/i.test(part))
        .filter(part => !/^GOFCNIM/i.test(part))
        .filter(part => !/^\d{3,5}x\d{3,5}/i.test(part))
        .filter(part => !/^\(?\d+\)?$/.test(part))
        .slice(-8)
        .join('_');
}

function normalizeTitle(value, fallback) {
    const title = sanitizeNamePart(value, 28);
    if (title && !/^(提示词\d*|优化版|新方向\d*|\d{3,5}x\d{3,5}|\(?\d+\)?)$/i.test(title)) {
        return title;
    }
    return sanitizeNamePart(fallback, 28) || '未命名画面';
}

function buildMaterialName({ filePath, index, naming }) {
    const parts = [
        naming.primaryTag,
        naming.secondaryTag,
        naming.tertiaryTag,
        naming.subTag
    ].filter(part => !isEmptyLabel(part)).map(part => sanitizeNamePart(part, 32));
    const title = normalizeTitle(naming.contentTitle, originalNameHints(filePath));
    const base = [
        sourcePrefix(filePath, index + 1),
        ...parts,
        title,
        sourceTimestamp(filePath)
    ].filter(Boolean).join('_');
    return `${base}${path.extname(filePath).toLowerCase()}`;
}

function uniqueNameForPlan(targetDir, preferredName, currentPath, usedNames) {
    const parsed = path.parse(preferredName);
    let candidate = preferredName;
    for (let index = 1; index < 1000; index += 1) {
        const key = candidate.toLowerCase();
        const candidatePath = path.join(targetDir, candidate);
        const samePath = path.resolve(candidatePath).toLowerCase() === path.resolve(currentPath).toLowerCase();
        if (!usedNames.has(key) && (samePath || !fs.existsSync(candidatePath))) {
            usedNames.add(key);
            return candidate;
        }
        const suffix = `_dup${String(index + 1).padStart(2, '0')}`;
        candidate = `${parsed.name}${suffix}${parsed.ext}`;
    }
    throw new Error(`无法生成不重名的新文件名: ${preferredName}`);
}

async function imageDataUrl(filePath, maxSide) {
    const buffer = fs.readFileSync(filePath);
    const image = await loadImage(buffer);
    const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = createCanvas(width, height);
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0, width, height);
    const output = canvas.toBuffer('image/jpeg', { quality: 0.84 });
    return {
        url: `data:image/jpeg;base64,${output.toString('base64')}`,
        originalBytes: buffer.length,
        originalWidth: image.width,
        originalHeight: image.height,
        sentBytes: output.length
    };
}

function normalizeDirection(direction = {}) {
    const pathParts = String(direction.path || '')
        .split('/')
        .map(cleanText)
        .filter(part => !isEmptyLabel(part));
    const primaryTag = cleanText(direction.primaryTag || pathParts[0]);
    const secondaryTag = cleanText(direction.secondaryTag || pathParts[1]);
    const tertiaryTag = cleanText(direction.tertiaryTag || pathParts[2]);
    const subTag = cleanText(direction.subTag || pathParts[3]);
    const parts = [primaryTag, secondaryTag, tertiaryTag, subTag].filter(part => !isEmptyLabel(part));
    if (!parts.length) return null;
    return {
        id: String(direction.id || sha1(parts.join('/')).slice(0, 12)).trim(),
        path: parts.join('/'),
        name: cleanText(direction.name || subTag || tertiaryTag || secondaryTag || primaryTag),
        primaryTag,
        secondaryTag,
        tertiaryTag,
        subTag,
        description: cleanText(direction.description),
        status: String(direction.status || 'seed').trim()
    };
}

function loadKnowledgeTaxonomy(rootDir, options = {}) {
    const dataPath = path.join(rootDir, 'data', 'creative-knowledge', 'directions.json');
    const data = readJson(dataPath, { directions: [], importedAt: null });
    const includedStatuses = normalizeStatusList(options.includeStatuses);
    const statusSet = new Set(includedStatuses);
    const directions = (Array.isArray(data.directions) ? data.directions : [])
        .map(normalizeDirection)
        .filter(Boolean)
        .filter(direction => statusSet.has(direction.status || 'seed'));

    const byId = new Map();
    const byPath = new Map();
    directions.forEach(direction => {
        byId.set(direction.id, direction);
        byPath.set(labelKey([direction.primaryTag, direction.secondaryTag, direction.tertiaryTag, direction.subTag]), direction);
        byPath.set(labelKey([direction.primaryTag, direction.secondaryTag, direction.tertiaryTag]), direction);
        byPath.set(labelKey([direction.primaryTag, direction.secondaryTag]), direction);
    });

    const fingerprint = sha1(JSON.stringify({
        importedAt: data.importedAt || '',
        includedStatuses,
        directions: directions.map(item => ({
            id: item.id,
            path: item.path,
            description: item.description,
            status: item.status
        }))
    })).slice(0, 16);

    return {
        source: 'creative-knowledge',
        dataPath,
        importedAt: data.importedAt || '',
        includedStatuses,
        directionCount: directions.length,
        directions,
        byId,
        byPath,
        fingerprint
    };
}

function taxonomyPromptText(taxonomy) {
    return taxonomy.directions
        .map((entry, index) => {
            const desc = entry.description ? ` - ${entry.description.slice(0, 90)}` : '';
            return `${index + 1}. id=${entry.id}; path=${entry.path}${desc}`;
        })
        .join('\n');
}

function buildPrompt(filePath, taxonomy) {
    const fileName = path.basename(filePath);
    const hints = originalNameHints(filePath);
    return `你是《无尽冬日》买量创意素材方向库管理员。请只基于图片视觉内容，并参考文件名线索，把图片归入系统当前知识库方向库。

目标：生成准确、可维护的重命名标签。宁可降级到二级/三级，也不要强行猜不确定的细分标签。不要使用方向库之外的标签。

文件名：${fileName}
文件名线索：${hints || '无'}

当前知识库方向库：
${taxonomyPromptText(taxonomy)}

判断规则：
1. 优先输出最接近的 directionId；如果细分不确定，可选择更上级或更泛化的方向。
2. primaryTag/secondaryTag/tertiaryTag/subTag 必须与所选 directionId 的 path 一致；不确定的下级可留空。
3. contentTitle 用 4-14 个中文概括画面主体，不要包含尺寸、版本号、提示词编号。
4. confidence 用 0-1 数字表示命名准确度；低置信也要给出最稳的建议。
5. evidence 写一句你为什么这样归类；uncertainty 写不确定点，没有则留空。

只返回 JSON，格式：
{
  "directionId": "direction_xxx",
  "primaryTag": "一级标签",
  "secondaryTag": "二级标签",
  "tertiaryTag": "三级标签或空",
  "subTag": "细分标签或空",
  "contentTitle": "短中文标题",
  "confidence": 0.88,
  "visualSummary": "画面摘要",
  "evidence": "归类证据",
  "uncertainty": "不确定点"
}`;
}

function readWinkyConfig() {
    const secrets = readSecrets();
    const config = {
        apiKey: String(process.env.WINKY_API_KEY || secrets.winkyApiKey || '').trim(),
        apiUrl: String(process.env.WINKY_API_BASE_URL || secrets.winkyApiUrl || '').trim(),
        model: String(process.env.WINKY_MODEL || secrets.winkyModel || '').trim(),
        provider: String(process.env.WINKY_PROVIDER || secrets.winkyProvider || '').trim()
    };
    if (!config.apiKey || !config.apiUrl || !config.model) {
        throw new Error('Lumos Winky 配置不完整，需要 WINKY_API_KEY / WINKY_API_BASE_URL / WINKY_MODEL 或 automation-secrets.json 对应字段');
    }
    return config;
}

async function callWinky({ config, filePath, taxonomy, dataUrl, task }) {
    const payload = {
        model: config.model,
        messages: [
            {
                role: 'user',
                content: [
                    { type: 'text', text: buildPrompt(filePath, taxonomy) },
                    {
                        type: 'image_url',
                        image_url: {
                            url: dataUrl,
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
        payload.max_completion_tokens = 2048;
    } else {
        payload.temperature = 0.1;
        payload.max_tokens = 2048;
    }
    if (config.provider) payload.provider = config.provider;

    const controller = new AbortController();
    if (task) {
        task.controllers.add(controller);
        if (task.cancelled) {
            controller.abort();
        }
    }
    let response;
    try {
        response = await axios.post(config.apiUrl, payload, {
            headers: {
                Authorization: `Bearer ${config.apiKey}`,
                'Content-Type': 'application/json'
            },
            timeout: DEFAULT_TIMEOUT_MS,
            signal: controller.signal,
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
            validateStatus: () => true
        });
    } finally {
        if (task) {
            task.controllers.delete(controller);
        }
    }
    if (response.status < 200 || response.status >= 300) {
        throw new Error(`Winky HTTP ${response.status}: ${extractError(response.data)}`);
    }
    const rawText = extractResponseText(response.data);
    return {
        rawText,
        parsed: parseJson(rawText)
    };
}

function validateModelResult(parsed, taxonomy) {
    const notes = [];
    const rawDirectionId = String(parsed.directionId || parsed.id || '').trim();
    const rawTags = [
        cleanText(parsed.primaryTag),
        cleanText(parsed.secondaryTag),
        cleanText(parsed.tertiaryTag),
        cleanText(parsed.subTag)
    ];
    let direction = rawDirectionId ? taxonomy.byId.get(rawDirectionId) : null;
    if (!direction) {
        const pathMatch = taxonomy.byPath.get(labelKey(rawTags));
        if (pathMatch) {
            direction = pathMatch;
            notes.push('模型 directionId 未命中，已按标签路径匹配方向库');
        }
    }
    if (!direction) {
        return {
            directionId: rawDirectionId,
            primaryTag: rawTags[0] || '',
            secondaryTag: rawTags[1] || '',
            tertiaryTag: rawTags[2] || '',
            subTag: rawTags[3] || '',
            confidence: Math.min(normalizeConfidence(parsed.confidence), 0.45),
            matchLevel: 'missing',
            validationNotes: ['未命中知识库方向库']
        };
    }

    const rawPathKey = labelKey(rawTags);
    const directionPathKey = labelKey([direction.primaryTag, direction.secondaryTag, direction.tertiaryTag, direction.subTag]);
    if (rawPathKey && rawPathKey !== directionPathKey) {
        notes.push('模型标签与 directionId 不一致，已以知识库 directionId 路径为准');
    }

    return {
        directionId: direction.id,
        primaryTag: direction.primaryTag || '',
        secondaryTag: direction.secondaryTag || '',
        tertiaryTag: direction.tertiaryTag || '',
        subTag: direction.subTag || '',
        confidence: normalizeConfidence(parsed.confidence),
        matchLevel: direction.subTag ? 'sub' : (direction.tertiaryTag ? 'tertiary' : (direction.secondaryTag ? 'secondary' : 'primary')),
        validationNotes: notes
    };
}

async function runPool(items, concurrency, worker) {
    const results = new Array(items.length);
    let nextIndex = 0;
    const workers = new Array(Math.max(1, concurrency)).fill(null).map(async () => {
        while (nextIndex < items.length) {
            const index = nextIndex;
            nextIndex += 1;
            results[index] = await worker(items[index], index);
        }
    });
    await Promise.all(workers);
    return results;
}

function writeCsv(filePath, rows) {
    const columns = [
        'status',
        'oldName',
        'newName',
        'confidence',
        'confidenceBand',
        'matchLevel',
        'directionId',
        'primaryTag',
        'secondaryTag',
        'tertiaryTag',
        'subTag',
        'contentTitle',
        'visualSummary',
        'evidence',
        'uncertainty',
        'validationNotes',
        'sourcePath',
        'targetPath',
        'error'
    ];
    const cell = value => `"${String(value == null ? '' : value).replace(/"/g, '""')}"`;
    const lines = [
        columns.map(cell).join(','),
        ...rows.map(row => columns.map(column => cell(row[column])).join(','))
    ];
    fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
}

function publicItem(row) {
    return {
        status: row.status,
        oldName: row.oldName,
        newName: row.newName,
        confidence: row.confidence,
        confidenceBand: row.confidenceBand,
        tagPath: [row.primaryTag, row.secondaryTag, row.tertiaryTag, row.subTag].filter(part => !isEmptyLabel(part)).join('/'),
        contentTitle: row.contentTitle,
        uncertainty: row.uncertainty,
        error: row.error || ''
    };
}

function createVisionTaxonomyRenamer(options = {}) {
    const rootDir = options.rootDir || path.join(__dirname, '..', '..', '..');
    const logger = options.logger || console;
    const dataRoot = path.join(rootDir, 'data', 'vision-taxonomy-renamer');
    const runsRoot = path.join(dataRoot, 'runs');
    const cacheRoot = path.join(dataRoot, 'cache');
    const activeTasks = new Map();

    function ensureStore() {
        ensureDir(runsRoot);
        ensureDir(cacheRoot);
    }

    function runDir(runId) {
        return path.join(runsRoot, sanitizeNamePart(runId, 80) || 'run');
    }

    function runPath(runId) {
        return path.join(runDir(runId), 'run.json');
    }

    function reportPaths(runId) {
        return {
            json: path.join(runDir(runId), 'report.json'),
            csv: path.join(runDir(runId), 'report.csv'),
            undo: path.join(runDir(runId), 'undo-map.json')
        };
    }

    function taxonomyStatus(payload = {}) {
        const taxonomy = loadKnowledgeTaxonomy(rootDir, payload);
        return {
            success: true,
            source: taxonomy.source,
            dataPath: taxonomy.dataPath,
            importedAt: taxonomy.importedAt,
            includedStatuses: taxonomy.includedStatuses,
            directionCount: taxonomy.directionCount,
            fingerprint: taxonomy.fingerprint
        };
    }

    function assertNotCancelled(task) {
        if (task && task.cancelled) {
            const error = new Error('视觉分析预览已停止');
            error.code = 'VTR_CANCELLED';
            throw error;
        }
    }

    async function classifyFile({ filePath, index, config, taxonomy, args, task }) {
        assertNotCancelled(task);
        const buffer = fs.readFileSync(filePath);
        const imageHash = sha1(buffer);
        const cachePath = path.join(cacheRoot, `${imageHash}-${taxonomy.fingerprint}.json`);
        if (!args.force && fs.existsSync(cachePath)) {
            const cached = readJson(cachePath, null);
            if (cached && cached.result) {
                return {
                    ...cached.result,
                    filePath,
                    oldName: path.basename(filePath),
                    index,
                    cached: true
                };
            }
        }

        const image = await imageDataUrl(filePath, args.maxSide);
        assertNotCancelled(task);
        const response = await callWinky({
            config,
            filePath,
            taxonomy,
            dataUrl: image.url,
            task
        });
        assertNotCancelled(task);
        const validated = validateModelResult(response.parsed, taxonomy);
        const result = {
            filePath,
            oldName: path.basename(filePath),
            index,
            cached: false,
            imageHash,
            taxonomyFingerprint: taxonomy.fingerprint,
            imageMeta: {
                originalBytes: image.originalBytes,
                originalWidth: image.originalWidth,
                originalHeight: image.originalHeight,
                sentBytes: image.sentBytes
            },
            rawModelResult: response.parsed,
            rawText: response.rawText,
            visualSummary: cleanText(response.parsed.visualSummary),
            contentTitle: normalizeTitle(response.parsed.contentTitle, originalNameHints(filePath)),
            evidence: cleanText(response.parsed.evidence),
            uncertainty: cleanText(response.parsed.uncertainty),
            ...validated
        };
        writeJson(cachePath, {
            imageHash,
            taxonomyFingerprint: taxonomy.fingerprint,
            createdAt: new Date().toISOString(),
            result
        });
        return result;
    }

    function writeRunAndReports(run) {
        const paths = reportPaths(run.runId);
        ensureDir(runDir(run.runId));
        writeJson(runPath(run.runId), run);
        writeJson(paths.json, {
            summary: run.summary,
            taxonomy: run.taxonomy,
            rows: run.rows
        });
        writeCsv(paths.csv, run.rows);
        return paths;
    }

    function buildPreviewRows({ classified, inputFolder, args, usedNames }) {
        return classified.map((item, index) => {
            const fileIndex = Number.isInteger(item.index) ? item.index : index;
            if (item.error) {
                return {
                    fileIndex,
                    status: 'failed',
                    oldName: path.basename(item.filePath),
                    newName: '',
                    sourcePath: item.filePath,
                    targetPath: '',
                    confidence: 0,
                    confidenceBand: 'failed',
                    matchLevel: item.matchLevel || 'missing',
                    directionId: item.directionId || '',
                    primaryTag: item.primaryTag || '',
                    secondaryTag: item.secondaryTag || '',
                    tertiaryTag: item.tertiaryTag || '',
                    subTag: item.subTag || '',
                    contentTitle: item.contentTitle || '',
                    visualSummary: item.visualSummary || '',
                    evidence: item.evidence || '',
                    uncertainty: item.uncertainty || '',
                    validationNotes: Array.isArray(item.validationNotes) ? item.validationNotes.join('；') : '',
                    error: item.error
                };
            }

            const band = confidenceBand(item.confidence, args.minConfidence);
            const preferredName = buildMaterialName({ filePath: item.filePath, index: fileIndex, naming: item });
            const newName = uniqueNameForPlan(inputFolder, preferredName, item.filePath, usedNames);
            return {
                fileIndex,
                status: statusForBand('planned', band),
                oldName: path.basename(item.filePath),
                newName,
                sourcePath: item.filePath,
                targetPath: path.join(inputFolder, newName),
                confidence: item.confidence || 0,
                confidenceBand: band,
                matchLevel: item.matchLevel || '',
                directionId: item.directionId || '',
                primaryTag: item.primaryTag || '',
                secondaryTag: item.secondaryTag || '',
                tertiaryTag: item.tertiaryTag || '',
                subTag: item.subTag || '',
                contentTitle: item.contentTitle || '',
                visualSummary: item.visualSummary || '',
                evidence: item.evidence || '',
                uncertainty: item.uncertainty || '',
                validationNotes: Array.isArray(item.validationNotes) ? item.validationNotes.join('；') : '',
                error: ''
            };
        });
    }

    function taxonomySnapshot(taxonomy) {
        return {
            source: taxonomy.source,
            dataPath: taxonomy.dataPath,
            importedAt: taxonomy.importedAt,
            includedStatuses: taxonomy.includedStatuses,
            directionCount: taxonomy.directionCount,
            fingerprint: taxonomy.fingerprint
        };
    }

    function sortRowsByFileIndex(rows = []) {
        return rows.slice().sort((a, b) => {
            const left = Number.isInteger(a.fileIndex) ? a.fileIndex : 0;
            const right = Number.isInteger(b.fileIndex) ? b.fileIndex : 0;
            return left - right;
        });
    }

    function summarizeRows({ runId, mode, inputFolder, total, rows, minConfidence, extra = {} }) {
        const counts = rows.reduce((acc, row) => {
            acc[row.confidenceBand] = (acc[row.confidenceBand] || 0) + 1;
            acc[row.status] = (acc[row.status] || 0) + 1;
            return acc;
        }, {});
        return {
            runId,
            mode,
            inputFolder,
            total,
            completed: rows.length,
            planned: rows.filter(row => String(row.status || '').startsWith('planned')).length,
            strong: counts.strong || 0,
            weak: counts.weak || 0,
            low: counts.low || 0,
            failed: counts.failed || 0,
            minConfidence,
            ...extra
        };
    }

    function publicRunResult(run, options = {}) {
        const paths = reportPaths(run.runId);
        return {
            success: options.success !== false,
            cancelled: options.cancelled === true,
            resumable: ['running', 'cancelled'].includes(run.status),
            applyReady: run.status === 'previewed',
            runId: run.runId,
            status: run.status,
            summary: run.summary || {},
            taxonomy: run.taxonomy || {},
            reportJson: paths.json,
            reportCsv: paths.csv,
            items: sortRowsByFileIndex(run.rows || []).slice(0, 120).map(publicItem),
            message: options.message || ''
        };
    }

    function listRuns() {
        ensureStore();
        if (!fs.existsSync(runsRoot)) return [];
        return fs.readdirSync(runsRoot)
            .map(name => readJson(path.join(runsRoot, name, 'run.json'), null))
            .filter(run => run && run.runId);
    }

    function latestRun(payload = {}) {
        const inputFolder = normalizeInputPath(payload.inputFolder);
        const inputKey = inputFolder ? path.resolve(inputFolder).toLowerCase() : '';
        const runs = listRuns()
            .filter(run => !inputKey || path.resolve(run.inputFolder || '').toLowerCase() === inputKey)
            .sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
        return runs[0] || null;
    }

    async function preview(payload = {}) {
        ensureStore();
        const inputFolder = path.resolve(normalizeInputPath(payload.inputFolder));
        if (!payload.inputFolder || !String(payload.inputFolder).trim()) {
            throw new Error('请输入图片文件夹');
        }
        if (!fs.existsSync(inputFolder) || !fs.statSync(inputFolder).isDirectory()) {
            throw new Error(`图片文件夹不存在: ${inputFolder}`);
        }

        const taxonomy = loadKnowledgeTaxonomy(rootDir, payload);
        if (!taxonomy.directionCount) {
            throw new Error('知识库当前方向库为空，请先在知识库页面同步或导入方向库');
        }

        const files = imageFilesIn(inputFolder);
        const offset = Math.max(0, Math.floor(Number(payload.offset) || 0));
        const limit = Math.max(0, Math.floor(Number(payload.limit) || 0));
        const selectedFiles = limit > 0 ? files.slice(offset, offset + limit) : files.slice(offset);
        const requestedRunId = sanitizeNamePart(payload.runId, 80);
        const runId = requestedRunId || `vtr_${formatDateTimeForFile(new Date())}_${sha1(inputFolder).slice(0, 8)}`;
        const config = readWinkyConfig();
        const args = {
            force: payload.force === true,
            maxSide: Math.max(256, Math.min(2048, Math.floor(Number(payload.maxSide) || DEFAULT_MAX_SIDE))),
            minConfidence: normalizeConfidence(payload.minConfidence, DEFAULT_MIN_CONFIDENCE),
            concurrency: Math.max(1, Math.min(4, Math.floor(Number(payload.concurrency) || DEFAULT_CONCURRENCY)))
        };

        const task = {
            runId,
            cancelled: false,
            controllers: new Set(),
            createdAt: new Date().toISOString()
        };
        activeTasks.set(runId, task);

        logger.info && logger.info(`智能视觉重命名预览开始：${inputFolder}，图片 ${selectedFiles.length} 张，方向 ${taxonomy.directionCount} 条`);
        let completed = 0;
        let classified;
        try {
            const usedNames = new Set();
            classified = await runPool(selectedFiles, args.concurrency, async (filePath, index) => {
                assertNotCancelled(task);
                try {
                    const result = await classifyFile({ filePath, index, config, taxonomy, args, task });
                    completed += 1;
                    if (completed % 10 === 0 || completed === selectedFiles.length) {
                        logger.info && logger.info(`智能视觉重命名进度：${completed}/${selectedFiles.length}`);
                    }
                    return result;
                } catch (error) {
                    if (error && (error.code === 'VTR_CANCELLED' || error.code === 'ERR_CANCELED' || error.name === 'CanceledError')) {
                        throw error;
                    }
                    completed += 1;
                    return {
                        filePath,
                        oldName: path.basename(filePath),
                        index,
                        confidence: 0,
                        confidenceBand: 'failed',
                        matchLevel: 'missing',
                        error: error.message
                    };
                }
            });
            if (task.cancelled) {
                assertNotCancelled(task);
            }
            const rows = buildPreviewRows({
                classified,
                inputFolder,
                args,
                usedNames
            });

            const counts = rows.reduce((acc, row) => {
                acc[row.confidenceBand] = (acc[row.confidenceBand] || 0) + 1;
                acc[row.status] = (acc[row.status] || 0) + 1;
                return acc;
            }, {});
            const summary = {
                runId,
                mode: 'preview',
                inputFolder,
                total: selectedFiles.length,
                planned: rows.filter(row => row.status.startsWith('planned')).length,
                strong: counts.strong || 0,
                weak: counts.weak || 0,
                low: counts.low || 0,
                failed: counts.failed || 0,
                minConfidence: args.minConfidence,
                createdAt: new Date().toISOString()
            };
            const run = {
                version: 1,
                runId,
                status: 'previewed',
                inputFolder,
                taxonomy: {
                    source: taxonomy.source,
                    dataPath: taxonomy.dataPath,
                    importedAt: taxonomy.importedAt,
                    includedStatuses: taxonomy.includedStatuses,
                    directionCount: taxonomy.directionCount,
                    fingerprint: taxonomy.fingerprint
                },
                options: args,
                summary,
                rows,
                createdAt: summary.createdAt,
                updatedAt: summary.createdAt
            };
            const paths = writeRunAndReports(run);
            return {
                success: true,
                runId,
                summary,
                taxonomy: run.taxonomy,
                reportJson: paths.json,
                reportCsv: paths.csv,
                items: rows.slice(0, 120).map(publicItem),
                message: `视觉分析预览完成：共 ${summary.total} 张，强 ${summary.strong}，弱 ${summary.weak}，低 ${summary.low}，失败 ${summary.failed}`
            };
        } catch (error) {
            if (task.cancelled || (error && (error.code === 'VTR_CANCELLED' || error.code === 'ERR_CANCELED' || error.name === 'CanceledError'))) {
                return {
                    success: false,
                    cancelled: true,
                    runId,
                    summary: {
                        runId,
                        mode: 'cancelled',
                        inputFolder,
                        total: selectedFiles.length,
                        completed,
                        cancelledAt: new Date().toISOString()
                    },
                    items: [],
                    message: `视觉分析预览已停止，已完成 ${completed}/${selectedFiles.length} 张`
                };
            }
            throw error;
        } finally {
            activeTasks.delete(runId);
        }
    }

    async function previewResumable(payload = {}) {
        ensureStore();
        let inputFolder = path.resolve(normalizeInputPath(payload.inputFolder));
        if (!payload.inputFolder || !String(payload.inputFolder).trim()) {
            throw new Error('请输入图片文件夹');
        }
        if (!fs.existsSync(inputFolder) || !fs.statSync(inputFolder).isDirectory()) {
            throw new Error(`图片文件夹不存在: ${inputFolder}`);
        }

        const taxonomy = loadKnowledgeTaxonomy(rootDir, payload);
        if (!taxonomy.directionCount) {
            throw new Error('知识库当前方向库为空，请先在知识库页面同步或导入方向库');
        }

        const requestedRunId = sanitizeNamePart(payload.runId, 80);
        const existingRun = requestedRunId ? readJson(runPath(requestedRunId), null) : null;
        const shouldResume = payload.resume === true && existingRun && ['running', 'cancelled'].includes(existingRun.status);
        const files = imageFilesIn(inputFolder);
        const offset = Math.max(0, Math.floor(Number(payload.offset) || 0));
        const limit = Math.max(0, Math.floor(Number(payload.limit) || 0));
        const selectedFiles = limit > 0 ? files.slice(offset, offset + limit) : files.slice(offset);
        const runId = requestedRunId || `vtr_${formatDateTimeForFile(new Date())}_${sha1(inputFolder).slice(0, 8)}`;
        const config = readWinkyConfig();
        const args = shouldResume
            ? {
                force: false,
                maxSide: Math.max(256, Math.min(2048, Math.floor(Number(existingRun.options?.maxSide) || DEFAULT_MAX_SIDE))),
                minConfidence: normalizeConfidence(existingRun.options?.minConfidence, DEFAULT_MIN_CONFIDENCE),
                concurrency: Math.max(1, Math.min(4, Math.floor(Number(existingRun.options?.concurrency) || DEFAULT_CONCURRENCY)))
            }
            : {
                force: payload.force === true,
                maxSide: Math.max(256, Math.min(2048, Math.floor(Number(payload.maxSide) || DEFAULT_MAX_SIDE))),
                minConfidence: normalizeConfidence(payload.minConfidence, DEFAULT_MIN_CONFIDENCE),
                concurrency: Math.max(1, Math.min(4, Math.floor(Number(payload.concurrency) || DEFAULT_CONCURRENCY)))
            };

        if (activeTasks.has(runId)) {
            throw new Error('这个视觉分析预览正在运行中，请先等待或停止当前任务');
        }

        let run;
        let runFiles;
        let rows;
        const createdAt = new Date().toISOString();
        if (shouldResume) {
            run = existingRun;
            inputFolder = path.resolve(run.inputFolder || inputFolder);
            runFiles = Array.isArray(run.files) && run.files.length ? run.files : selectedFiles;
            rows = sortRowsByFileIndex(Array.isArray(run.rows) ? run.rows : []);
        } else {
            runFiles = selectedFiles;
            rows = [];
            run = {
                version: 2,
                runId,
                status: 'running',
                inputFolder,
                taxonomy: taxonomySnapshot(taxonomy),
                options: args,
                files: runFiles,
                rows,
                createdAt,
                updatedAt: createdAt,
                summary: summarizeRows({
                    runId,
                    mode: 'preview',
                    inputFolder,
                    total: runFiles.length,
                    rows,
                    minConfidence: args.minConfidence,
                    extra: { createdAt }
                })
            };
            writeRunAndReports(run);
        }

        const task = {
            runId,
            cancelled: false,
            controllers: new Set(),
            createdAt: new Date().toISOString()
        };
        activeTasks.set(runId, task);

        const usedNames = new Set(rows.map(row => String(row.newName || '').toLowerCase()).filter(Boolean));
        const completedPaths = new Set(rows.map(row => path.resolve(row.sourcePath || '').toLowerCase()).filter(Boolean));
        const pendingJobs = runFiles
            .map((filePath, index) => ({ filePath, index }))
            .filter(job => !completedPaths.has(path.resolve(job.filePath).toLowerCase()));

        function persist(status, extra = {}) {
            const now = new Date().toISOString();
            rows = sortRowsByFileIndex(rows);
            run.version = 2;
            run.status = status;
            run.inputFolder = inputFolder;
            run.taxonomy = run.taxonomy || taxonomySnapshot(taxonomy);
            run.options = args;
            run.files = runFiles;
            run.rows = rows;
            run.updatedAt = now;
            run.summary = summarizeRows({
                runId,
                mode: 'preview',
                inputFolder,
                total: runFiles.length,
                rows,
                minConfidence: args.minConfidence,
                extra: {
                    createdAt: run.createdAt || createdAt,
                    updatedAt: now,
                    ...extra
                }
            });
            writeRunAndReports(run);
        }

        logger.info && logger.info(`智能视觉重命名预览${shouldResume ? '恢复' : '开始'}：${inputFolder}，待处理 ${pendingJobs.length}/${runFiles.length} 张，方向 ${taxonomy.directionCount} 条`);
        try {
            if (!pendingJobs.length) {
                persist('previewed', { completedAt: new Date().toISOString() });
                return publicRunResult(run, {
                    message: `视觉分析预览已完成：共 ${run.summary.total} 张，强 ${run.summary.strong}，弱 ${run.summary.weak}，低 ${run.summary.low}，失败 ${run.summary.failed}`
                });
            }

            await runPool(pendingJobs, args.concurrency, async (job) => {
                assertNotCancelled(task);
                let classified;
                try {
                    classified = await classifyFile({
                        filePath: job.filePath,
                        index: job.index,
                        config,
                        taxonomy,
                        args,
                        task
                    });
                } catch (error) {
                    if (error && (error.code === 'VTR_CANCELLED' || error.code === 'ERR_CANCELED' || error.name === 'CanceledError')) {
                        throw error;
                    }
                    classified = {
                        filePath: job.filePath,
                        oldName: path.basename(job.filePath),
                        index: job.index,
                        confidence: 0,
                        confidenceBand: 'failed',
                        matchLevel: 'missing',
                        error: error.message
                    };
                }

                const row = buildPreviewRows({
                    classified: [classified],
                    inputFolder,
                    args,
                    usedNames
                })[0];
                rows.push(row);
                persist('running');

                if (rows.length % 10 === 0 || rows.length === runFiles.length) {
                    logger.info && logger.info(`智能视觉重命名进度：${rows.length}/${runFiles.length}`);
                }
                return row;
            });

            assertNotCancelled(task);
            persist('previewed', { completedAt: new Date().toISOString() });
            return publicRunResult(run, {
                message: `视觉分析预览完成：共 ${run.summary.total} 张，强 ${run.summary.strong}，弱 ${run.summary.weak}，低 ${run.summary.low}，失败 ${run.summary.failed}`
            });
        } catch (error) {
            if (task.cancelled || (error && (error.code === 'VTR_CANCELLED' || error.code === 'ERR_CANCELED' || error.name === 'CanceledError'))) {
                persist('cancelled', { cancelledAt: new Date().toISOString() });
                return publicRunResult(run, {
                    success: false,
                    cancelled: true,
                    message: `视觉分析预览已停止，已完成 ${run.summary.completed}/${run.summary.total} 张，可继续上次预览`
                });
            }
            persist('cancelled', { error: error.message });
            throw error;
        } finally {
            activeTasks.delete(runId);
        }
    }

    function cancel(runId) {
        const id = String(runId || '').trim();
        if (!id) {
            throw new Error('缺少要停止的预览 runId');
        }
        const task = activeTasks.get(id);
        if (!task) {
            return {
                success: true,
                stopped: false,
                runId: id,
                message: '当前没有正在运行的视觉分析预览'
            };
        }
        task.cancelled = true;
        task.controllers.forEach(controller => {
            try {
                controller.abort();
            } catch (_) {}
        });
        return {
            success: true,
            stopped: true,
            runId: id,
            message: '已发送停止视觉分析预览指令'
        };
    }

    function legacyUnused() {
        return null;
    }

    /*
     * The block below is intentionally unreachable; it is kept out by the early
     * return above during the patch transition.
     */
    function _oldPreviewTail(classified, selectedFiles, inputFolder, args, taxonomy, runId, usedNames) {
        const rows = classified.map((item, index) => {
            if (item.error) {
                return {
                    status: 'failed',
                    oldName: path.basename(item.filePath),
                    newName: '',
                    sourcePath: item.filePath,
                    targetPath: '',
                    confidence: 0,
                    confidenceBand: 'failed',
                    matchLevel: item.matchLevel || 'missing',
                    directionId: item.directionId || '',
                    primaryTag: item.primaryTag || '',
                    secondaryTag: item.secondaryTag || '',
                    tertiaryTag: item.tertiaryTag || '',
                    subTag: item.subTag || '',
                    contentTitle: item.contentTitle || '',
                    visualSummary: item.visualSummary || '',
                    evidence: item.evidence || '',
                    uncertainty: item.uncertainty || '',
                    validationNotes: Array.isArray(item.validationNotes) ? item.validationNotes.join('；') : '',
                    error: item.error
                };
            }
            const band = confidenceBand(item.confidence, args.minConfidence);
            const preferredName = buildMaterialName({ filePath: item.filePath, index, naming: item });
            const newName = uniqueNameForPlan(inputFolder, preferredName, item.filePath, usedNames);
            return {
                status: statusForBand('planned', band),
                oldName: path.basename(item.filePath),
                newName,
                sourcePath: item.filePath,
                targetPath: path.join(inputFolder, newName),
                confidence: item.confidence || 0,
                confidenceBand: band,
                matchLevel: item.matchLevel || '',
                directionId: item.directionId || '',
                primaryTag: item.primaryTag || '',
                secondaryTag: item.secondaryTag || '',
                tertiaryTag: item.tertiaryTag || '',
                subTag: item.subTag || '',
                contentTitle: item.contentTitle || '',
                visualSummary: item.visualSummary || '',
                evidence: item.evidence || '',
                uncertainty: item.uncertainty || '',
                validationNotes: Array.isArray(item.validationNotes) ? item.validationNotes.join('；') : '',
                error: ''
            };
        });

        const counts = rows.reduce((acc, row) => {
            acc[row.confidenceBand] = (acc[row.confidenceBand] || 0) + 1;
            acc[row.status] = (acc[row.status] || 0) + 1;
            return acc;
        }, {});
        const summary = {
            runId,
            mode: 'preview',
            inputFolder,
            total: selectedFiles.length,
            planned: rows.filter(row => row.status.startsWith('planned')).length,
            strong: counts.strong || 0,
            weak: counts.weak || 0,
            low: counts.low || 0,
            failed: counts.failed || 0,
            minConfidence: args.minConfidence,
            createdAt: new Date().toISOString()
        };
        const run = {
            version: 1,
            runId,
            status: 'previewed',
            inputFolder,
            taxonomy: {
                source: taxonomy.source,
                dataPath: taxonomy.dataPath,
                importedAt: taxonomy.importedAt,
                includedStatuses: taxonomy.includedStatuses,
                directionCount: taxonomy.directionCount,
                fingerprint: taxonomy.fingerprint
            },
            options: args,
            summary,
            rows,
            createdAt: summary.createdAt,
            updatedAt: summary.createdAt
        };
        const paths = writeRunAndReports(run);
        return {
            success: true,
            runId,
            summary,
            taxonomy: run.taxonomy,
            reportJson: paths.json,
            reportCsv: paths.csv,
            items: rows.slice(0, 120).map(publicItem),
            message: `视觉分析预览完成：共 ${summary.total} 张，强 ${summary.strong}，弱 ${summary.weak}，低 ${summary.low}，失败 ${summary.failed}`
        };
    }

    function apply(runId) {
        ensureStore();
        const run = readJson(runPath(runId), null);
        if (!run || !Array.isArray(run.rows)) {
            throw new Error(`未找到重命名预览 run: ${runId}`);
        }
        if (run.status !== 'previewed') {
            throw new Error('视觉分析预览尚未完整完成，请先继续上次预览');
        }
        const inputRoot = path.resolve(run.inputFolder || '');
        if (!inputRoot || !fs.existsSync(inputRoot) || !fs.statSync(inputRoot).isDirectory()) {
            throw new Error(`预览对应的图片文件夹不存在: ${run.inputFolder || ''}`);
        }

        const plans = run.rows
            .filter(row => String(row.status || '').startsWith('planned'))
            .filter(row => row.sourcePath && row.targetPath && row.oldName !== row.newName);
        const finalTargets = new Set();
        plans.forEach(row => {
            const sourcePath = path.resolve(row.sourcePath);
            const targetPath = path.resolve(row.targetPath);
            if (!sourcePath.toLowerCase().startsWith(inputRoot.toLowerCase() + path.sep.toLowerCase()) ||
                !targetPath.toLowerCase().startsWith(inputRoot.toLowerCase() + path.sep.toLowerCase())) {
                throw new Error(`路径越界，已停止: ${row.oldName}`);
            }
            const key = targetPath.toLowerCase();
            if (finalTargets.has(key)) {
                throw new Error(`目标文件名重复，已停止: ${row.newName}`);
            }
            finalTargets.add(key);
        });

        const tempPlans = [];
        let renamed = 0;
        let failed = 0;
        for (const row of plans) {
            try {
                if (!fs.existsSync(row.sourcePath)) {
                    throw new Error('源文件不存在');
                }
                const tempPath = path.join(inputRoot, `.__vtr_tmp_${crypto.randomBytes(8).toString('hex')}__${path.basename(row.sourcePath)}`);
                fs.renameSync(row.sourcePath, tempPath);
                tempPlans.push({ row, tempPath });
            } catch (error) {
                row.status = 'failed';
                row.error = error.message;
                failed += 1;
            }
        }

        const undo = [];
        for (const item of tempPlans) {
            const { row, tempPath } = item;
            try {
                if (fs.existsSync(row.targetPath)) {
                    throw new Error(`目标文件已存在: ${row.newName}`);
                }
                fs.renameSync(tempPath, row.targetPath);
                row.status = statusForBand('renamed', row.confidenceBand);
                row.error = '';
                renamed += 1;
                undo.push({
                    oldPath: row.sourcePath,
                    newPath: row.targetPath
                });
            } catch (error) {
                try {
                    if (fs.existsSync(tempPath) && !fs.existsSync(row.sourcePath)) {
                        fs.renameSync(tempPath, row.sourcePath);
                    }
                } catch (_) {}
                row.status = 'failed';
                row.error = error.message;
                failed += 1;
            }
        }

        const now = new Date().toISOString();
        run.status = failed ? 'applied_with_failures' : 'applied';
        run.summary = {
            ...(run.summary || {}),
            mode: 'apply',
            renamed,
            failed,
            appliedAt: now
        };
        run.updatedAt = now;
        const paths = writeRunAndReports(run);
        writeJson(paths.undo, undo);
        return {
            success: failed === 0,
            runId,
            renamed,
            failed,
            skipped: run.rows.length - renamed - failed,
            reportJson: paths.json,
            reportCsv: paths.csv,
            undoMap: paths.undo,
            summary: run.summary,
            items: run.rows.slice(0, 120).map(publicItem),
            message: failed === 0
                ? `原地重命名完成：${renamed} 张`
                : `原地重命名完成：${renamed} 张，失败 ${failed} 张`
        };
    }

    function getRun(runId) {
        const run = readJson(runPath(runId), null);
        if (!run) return null;
        const paths = reportPaths(runId);
        return {
            ...run,
            reportJson: paths.json,
            reportCsv: paths.csv,
            undoMap: paths.undo
        };
    }

    function latest(payload = {}) {
        const run = latestRun(payload);
        if (!run) {
            return {
                success: true,
                run: null
            };
        }
        return {
            ...publicRunResult(run),
            run
        };
    }

    return {
        taxonomyStatus,
        preview: previewResumable,
        cancel,
        apply,
        getRun,
        latest,
        reportPaths
    };
}

module.exports = {
    createVisionTaxonomyRenamer,
    loadKnowledgeTaxonomy,
    IMAGE_EXTENSIONS
};
