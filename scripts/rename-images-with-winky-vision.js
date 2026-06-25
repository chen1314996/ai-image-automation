const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const XLSX = require('xlsx');
const { createCanvas, loadImage } = require('canvas');

const { readSecrets } = require('../secrets-store');

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const ROOT_DIR = path.resolve(__dirname, '..');
const DEFAULT_LABEL_WORKBOOK = path.join(ROOT_DIR, 'sucai', '创意方向种子表.xlsx');
const DEFAULT_OUTPUT_DIR = path.join(ROOT_DIR, 'data', 'rename-analysis', 'winky-first-round');
const DEFAULT_TIMEOUT_MS = 180000;
const DEFAULT_MAX_SIDE = 1024;
const DEFAULT_CONCURRENCY = 2;
const DEFAULT_MIN_CONFIDENCE = 0.72;

function parseArgs(argv) {
    const args = {
        dir: '',
        labelWorkbook: DEFAULT_LABEL_WORKBOOK,
        outDir: DEFAULT_OUTPUT_DIR,
        apply: false,
        force: false,
        limit: 0,
        offset: 0,
        concurrency: DEFAULT_CONCURRENCY,
        minConfidence: DEFAULT_MIN_CONFIDENCE,
        maxSide: DEFAULT_MAX_SIDE
    };

    for (let index = 0; index < argv.length; index++) {
        const arg = argv[index];
        if (arg === '--dir') args.dir = argv[++index] || '';
        else if (arg === '--label-workbook') args.labelWorkbook = argv[++index] || args.labelWorkbook;
        else if (arg === '--out-dir') args.outDir = argv[++index] || args.outDir;
        else if (arg === '--apply') args.apply = true;
        else if (arg === '--force') args.force = true;
        else if (arg === '--limit') args.limit = Number(argv[++index]) || 0;
        else if (arg === '--offset') args.offset = Number(argv[++index]) || 0;
        else if (arg === '--concurrency') args.concurrency = Number(argv[++index]) || DEFAULT_CONCURRENCY;
        else if (arg === '--min-confidence') args.minConfidence = Number(argv[++index]) || DEFAULT_MIN_CONFIDENCE;
        else if (arg === '--max-side') args.maxSide = Number(argv[++index]) || DEFAULT_MAX_SIDE;
        else if (arg === '--help' || arg === '-h') args.help = true;
    }

    return args;
}

function usage() {
    return [
        'Usage:',
        '  node scripts/rename-images-with-winky-vision.js --dir "D:\\工作\\GOF\\国内\\2026\\0525自动化产出筛选\\第一轮筛选"',
        '  node scripts/rename-images-with-winky-vision.js --dir "..." --limit 3',
        '  node scripts/rename-images-with-winky-vision.js --dir "..." --apply',
        '',
        'Options:',
        '  --apply                 Actually rename eligible files. Without this, only writes reports.',
        '  --force                 Re-run Winky even when a cache file exists.',
        '  --limit N               Process only N images.',
        '  --offset N              Skip first N images in sorted order.',
        '  --concurrency N         Parallel Winky requests. Default: 2.',
        '  --min-confidence N      Minimum model confidence for auto-renaming. Default: 0.72.',
        '  --label-workbook PATH   Direction label workbook. Default: sucai/创意方向种子表.xlsx.',
        '  --out-dir PATH          Report/cache directory.'
    ].join('\n');
}

function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
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
        throw new Error('Lumos Winky 配置不完整：需要 WINKY_API_KEY / WINKY_API_BASE_URL / WINKY_MODEL 或 automation-secrets.json 对应字段。');
    }
    return config;
}

function compactText(value) {
    return String(value || '').replace(/\s+/g, '').trim();
}

function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function sanitizeNamePart(value, maxLength = 36) {
    const text = cleanText(value);
    if (!text) return '';
    return text
        .replace(/[\/\\]+/g, '-')
        .replace(/[<>:"|?*\x00-\x1F]/g, '_')
        .replace(/\s+/g, '')
        .replace(/_+/g, '_')
        .replace(/[. ]+$/g, '')
        .replace(/^_+|_+$/g, '')
        .slice(0, maxLength);
}

function isEmptyLabel(value) {
    const text = compactText(value);
    return !text || text === '暂无';
}

function loadTaxonomy(workbookPath) {
    const workbook = XLSX.readFile(workbookPath);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    const last = { primary: '', secondary: '', tertiary: '' };
    const entries = [];

    for (const row of rows) {
        let primary = cleanText(row['一级标签']);
        let secondary = cleanText(row['二级标签']);
        let tertiary = cleanText(row['三级标签']);
        const subTag = cleanText(row['细分标签']);
        const description = cleanText(row['方向简述']);

        if (primary) {
            last.primary = primary;
            last.secondary = '';
            last.tertiary = '';
        } else {
            primary = last.primary;
        }

        if (secondary) {
            last.secondary = secondary;
            last.tertiary = '';
        } else {
            secondary = last.secondary;
        }

        if (tertiary) {
            last.tertiary = tertiary;
        } else {
            tertiary = last.tertiary;
        }

        if (!primary || !secondary || !tertiary) continue;
        entries.push({
            primary,
            secondary,
            tertiary,
            subTag,
            description,
            fullPath: [primary, secondary, tertiary, subTag].filter(Boolean).join('/')
        });
    }

    const primary = new Set();
    const secondary = new Set();
    const tertiary = new Set();
    const full = new Set();
    const tertiaryBySecondary = new Map();
    const subByTertiary = new Map();

    for (const entry of entries) {
        primary.add(labelKey([entry.primary]));
        secondary.add(labelKey([entry.primary, entry.secondary]));
        tertiary.add(labelKey([entry.primary, entry.secondary, entry.tertiary]));
        if (entry.subTag && entry.subTag !== '暂无') {
            full.add(labelKey([entry.primary, entry.secondary, entry.tertiary, entry.subTag]));
        }

        const secondaryKey = labelKey([entry.primary, entry.secondary]);
        if (!tertiaryBySecondary.has(secondaryKey)) tertiaryBySecondary.set(secondaryKey, []);
        if (!tertiaryBySecondary.get(secondaryKey).includes(entry.tertiary)) {
            tertiaryBySecondary.get(secondaryKey).push(entry.tertiary);
        }

        const tertiaryKey = labelKey([entry.primary, entry.secondary, entry.tertiary]);
        if (!subByTertiary.has(tertiaryKey)) subByTertiary.set(tertiaryKey, []);
        if (entry.subTag && entry.subTag !== '暂无' && !subByTertiary.get(tertiaryKey).includes(entry.subTag)) {
            subByTertiary.get(tertiaryKey).push(entry.subTag);
        }
    }

    return {
        entries,
        primary,
        secondary,
        tertiary,
        full,
        tertiaryBySecondary,
        subByTertiary
    };
}

function labelKey(parts) {
    return parts.map(compactText).filter(Boolean).join('/');
}

function taxonomyText(taxonomy) {
    return taxonomy.entries
        .map((entry, index) => {
            const parts = [entry.primary, entry.secondary, entry.tertiary];
            if (entry.subTag && entry.subTag !== '暂无') parts.push(entry.subTag);
            const desc = entry.description ? `：${entry.description.slice(0, 80)}` : '';
            return `${index + 1}. ${parts.join(' / ')}${desc}`;
        })
        .join('\n');
}

function imageFilesIn(dir) {
    return fs.readdirSync(dir)
        .filter(name => IMAGE_EXTENSIONS.has(path.extname(name).toLowerCase()))
        .sort((a, b) => a.localeCompare(b, 'zh-CN'))
        .map(name => path.join(dir, name));
}

function sha1(buffer) {
    return crypto.createHash('sha1').update(buffer).digest('hex');
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
        .filter(part => !/^\d{3,5}[x×]\d{3,5}/i.test(part))
        .filter(part => !/^\(?\d+\)?$/.test(part))
        .slice(-8)
        .join('_');
}

function buildPrompt(filePath, taxonomy) {
    const fileName = path.basename(filePath);
    const hints = originalNameHints(filePath);
    return `你是《无尽冬日》买量创意素材方向库管理员。请只基于图片视觉内容，并参考文件名线索，把图片归入给定方向库标签体系。

目标：生成准确、可维护的重命名标签。宁可降级到二级/三级，也不要强行猜不确定的三级或细分标签。

文件名：${fileName}
文件名可参考线索：${hints || '无'}

方向库标签体系如下。你只能从这里选择一级、二级、三级、细分标签；不能发明新标签：
${taxonomyText(taxonomy)}

判断规则：
1. 一级、二级必须尽量选择方向库里的真实标签；如果不确定，matchLevel 用 "missing"。
2. 三级只有在画面内容明确符合方向库三级时才填写；不确定就留空，matchLevel 降为 "secondary"。
3. 细分标签只有在画面明确符合方向库细分标签时才填写；不确定就留空。
4. 文件名可能包含旧标题、旧标签、尺寸、批次号，它只能作为辅助线索，最终以图片视觉为准。
5. contentTitle 写成 4-14 个中文字符，描述这张图真正画面内容，不要写“提示词1”“1080x1920”“优化版”。
6. confidence 用 0-1 数字，表示标签路径准确度；低于 0.72 代表不建议自动重命名。

只返回严格 JSON，不要 Markdown，不要解释，结构如下：
{
  "visualSummary": "一句话描述画面",
  "primaryTag": "一级标签或空",
  "secondaryTag": "二级标签或空",
  "tertiaryTag": "三级标签或空",
  "subTag": "细分标签或空",
  "matchLevel": "missing|primary|secondary|tertiary|sub",
  "contentTitle": "短标题",
  "confidence": 0.0,
  "evidence": "选择这个标签的视觉证据",
  "uncertainty": "不确定点，没有则空"
}`;
}

function shouldUseMaxCompletionTokens(model) {
    return /^gpt-5\.5(?:$|[-_.\s])/i.test(String(model || '').trim());
}

async function callWinky({ config, filePath, taxonomy, dataUrl }) {
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

    const response = await axios.post(config.apiUrl, payload, {
        headers: {
            Authorization: `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json'
        },
        timeout: DEFAULT_TIMEOUT_MS,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        validateStatus: () => true
    });

    if (response.status < 200 || response.status >= 300) {
        throw new Error(`Winky HTTP ${response.status}: ${extractError(response.data)}`);
    }

    const rawText = extractResponseText(response.data);
    return {
        rawText,
        parsed: parseJson(rawText)
    };
}

function extractError(data) {
    if (!data) return '';
    if (typeof data === 'string') return data.slice(0, 600);
    return JSON.stringify(data).slice(0, 800);
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
        } catch (error) {
            // Try next candidate.
        }
    }
    throw new Error(`无法解析 Winky JSON：${text.slice(0, 500)}`);
}

function normalizeModelTags(parsed, taxonomy) {
    const primary = aliasTag(cleanText(parsed.primaryTag), 1);
    const secondary = aliasTag(cleanText(parsed.secondaryTag), 2, primary);
    const tertiary = aliasTag(cleanText(parsed.tertiaryTag), 3, primary, secondary);
    const subTag = cleanText(parsed.subTag);
    const confidence = clamp(Number(parsed.confidence), 0, 1, 0);
    const notes = [];

    if (!primary || !taxonomy.primary.has(labelKey([primary]))) {
        return {
            primaryTag: '',
            secondaryTag: '',
            tertiaryTag: '',
            subTag: '',
            matchLevel: 'missing',
            validatedConfidence: Math.min(confidence, 0.35),
            validationNotes: ['一级标签未命中方向库']
        };
    }

    if (!secondary || !taxonomy.secondary.has(labelKey([primary, secondary]))) {
        notes.push('二级标签未命中方向库，降级到一级');
        return {
            primaryTag: primary,
            secondaryTag: '',
            tertiaryTag: '',
            subTag: '',
            matchLevel: 'primary',
            validatedConfidence: Math.min(confidence, 0.55),
            validationNotes: notes
        };
    }

    if (!tertiary || !taxonomy.tertiary.has(labelKey([primary, secondary, tertiary]))) {
        if (tertiary) notes.push('三级标签未命中方向库，降级到二级');
        return {
            primaryTag: primary,
            secondaryTag: secondary,
            tertiaryTag: '',
            subTag: '',
            matchLevel: 'secondary',
            validatedConfidence: Math.min(confidence, tertiary ? 0.68 : confidence),
            validationNotes: notes
        };
    }

    let validSubTag = '';
    if (subTag && taxonomy.full.has(labelKey([primary, secondary, tertiary, subTag]))) {
        validSubTag = subTag;
    } else if (subTag) {
        notes.push('细分标签未命中方向库，已忽略');
    }

    return {
        primaryTag: primary,
        secondaryTag: secondary,
        tertiaryTag: tertiary,
        subTag: validSubTag,
        matchLevel: validSubTag ? 'sub' : 'tertiary',
        validatedConfidence: confidence,
        validationNotes: notes
    };
}

function aliasTag(value, level, primary = '', secondary = '') {
    if (!value) return '';
    const compact = compactText(value).toLowerCase();
    const aliases = {
        1: {
            '角色': '角色展示'
        },
        2: {
            '载具': primary === '题材' ? '载具专题' : value,
            'vlog': primary === '角色展示' ? 'Vlog' : value,
            'vlog视角': primary === '角色展示' ? 'Vlog' : value
        },
        3: {
            '发现物品': primary === '题材' && secondary === '探索发现' ? '物品展示' : value,
            '发现巨物': primary === '题材' && secondary === '探索发现' ? '巨物' : value,
            '巨大建筑': primary === '题材' && secondary === '探索发现' ? '建筑' : value,
            '载具': primary === '题材' && secondary === '载具专题' ? '废弃载具' : value,
            '塔防': primary === '玩法' && secondary === '对抗' ? '塔防防御' : value
        }
    };
    return aliases[level] && aliases[level][compact] ? aliases[level][compact] : value;
}

function clamp(value, min, max, fallback) {
    if (!Number.isFinite(value)) return fallback;
    return Math.max(min, Math.min(max, value));
}

function normalizeTitle(value, fallback) {
    const title = sanitizeNamePart(value, 28);
    if (title && !/^(提示词\d*|优化版|新方向\d*|\d{3,5}[x×]\d{3,5}|\(?\d+\)?)$/i.test(title)) {
        return title;
    }
    return sanitizeNamePart(fallback, 28) || '未命名画面';
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
    return match ? match[1] : timestampForFile(filePath);
}

function timestampForFile(filePath) {
    const stat = fs.statSync(filePath);
    const date = new Date(stat.mtime);
    const pad = value => String(value).padStart(2, '0');
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function buildNewName({ filePath, index, classification }) {
    const parts = [
        classification.primaryTag,
        classification.secondaryTag,
        classification.tertiaryTag,
        classification.subTag
    ].filter(part => !isEmptyLabel(part)).map(part => sanitizeNamePart(part, 32));
    const title = normalizeTitle(classification.contentTitle, originalNameHints(filePath));
    const base = [
        sourcePrefix(filePath, index + 1),
        ...parts,
        title,
        sourceTimestamp(filePath)
    ].filter(Boolean).join('_');
    return `${base}${path.extname(filePath).toLowerCase()}`;
}

function uniqueTargetPath(targetDir, fileName, currentPath) {
    let candidate = path.join(targetDir, fileName);
    if (path.resolve(candidate).toLowerCase() === path.resolve(currentPath).toLowerCase()) {
        return candidate;
    }
    if (!fs.existsSync(candidate)) return candidate;
    const parsed = path.parse(fileName);
    for (let index = 2; index < 1000; index++) {
        candidate = path.join(targetDir, `${parsed.name}_dup${String(index).padStart(2, '0')}${parsed.ext}`);
        if (!fs.existsSync(candidate)) return candidate;
    }
    throw new Error(`无法为 ${fileName} 生成不重名的新文件名`);
}

function toCsvCell(value) {
    const text = String(value == null ? '' : value);
    return `"${text.replace(/"/g, '""')}"`;
}

function writeReports(outDir, rows, summary) {
    ensureDir(outDir);
    const jsonPath = path.join(outDir, `vision-rename-report-${summary.runId}.json`);
    const csvPath = path.join(outDir, `vision-rename-report-${summary.runId}.csv`);
    fs.writeFileSync(jsonPath, JSON.stringify({ summary, rows }, null, 2), 'utf8');
    const headers = [
        'status', 'oldName', 'newName', 'confidence', 'matchLevel',
        'primaryTag', 'secondaryTag', 'tertiaryTag', 'subTag',
        'contentTitle', 'visualSummary', 'evidence', 'uncertainty', 'validationNotes'
    ];
    const csv = [
        headers.map(toCsvCell).join(','),
        ...rows.map(row => headers.map(header => toCsvCell(row[header])).join(','))
    ].join('\n');
    fs.writeFileSync(csvPath, `\uFEFF${csv}`, 'utf8');
    return { jsonPath, csvPath };
}

async function runPool(items, concurrency, worker) {
    const results = new Array(items.length);
    let cursor = 0;
    async function next() {
        while (cursor < items.length) {
            const index = cursor++;
            results[index] = await worker(items[index], index);
        }
    }
    const workers = Array.from({ length: Math.max(1, Math.floor(concurrency)) }, next);
    await Promise.all(workers);
    return results;
}

async function classifyFile({ filePath, index, args, config, taxonomy, cacheDir }) {
    const buffer = fs.readFileSync(filePath);
    const hash = sha1(buffer);
    const cachePath = path.join(cacheDir, `${hash}.json`);
    if (!args.force && fs.existsSync(cachePath)) {
        const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
        return {
            ...cached,
            filePath,
            oldName: path.basename(filePath),
            index,
            cached: true
        };
    }

    const image = await imageDataUrl(filePath, args.maxSide);
    const response = await callWinky({
        config,
        filePath,
        taxonomy,
        dataUrl: image.url
    });
    const validated = normalizeModelTags(response.parsed, taxonomy);
    const contentTitle = normalizeTitle(response.parsed.contentTitle, originalNameHints(filePath));
    const result = {
        filePath,
        oldName: path.basename(filePath),
        hash,
        cached: false,
        imageMeta: {
            originalBytes: image.originalBytes,
            originalWidth: image.originalWidth,
            originalHeight: image.originalHeight,
            sentBytes: image.sentBytes
        },
        rawModelResult: response.parsed,
        rawText: response.rawText,
        visualSummary: cleanText(response.parsed.visualSummary),
        contentTitle,
        evidence: cleanText(response.parsed.evidence),
        uncertainty: cleanText(response.parsed.uncertainty),
        ...validated,
        index
    };
    fs.writeFileSync(cachePath, JSON.stringify(result, null, 2), 'utf8');
    return result;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help || !args.dir) {
        console.log(usage());
        process.exit(args.help ? 0 : 1);
    }

    const targetDir = path.resolve(args.dir);
    if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
        throw new Error(`目标目录不存在：${targetDir}`);
    }

    const runId = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
    const outDir = path.resolve(args.outDir);
    const cacheDir = path.join(outDir, 'cache');
    ensureDir(outDir);
    ensureDir(cacheDir);

    const config = readWinkyConfig();
    const taxonomy = loadTaxonomy(path.resolve(args.labelWorkbook));
    let files = imageFilesIn(targetDir);
    if (args.offset > 0) files = files.slice(args.offset);
    if (args.limit > 0) files = files.slice(0, args.limit);

    console.log(`目标目录：${targetDir}`);
    console.log(`图片数量：${files.length}`);
    console.log(`方向库：${taxonomy.entries.length} 条细分记录`);
    console.log(`模式：${args.apply ? 'apply' : 'dry-run'}，并发：${args.concurrency}，最低自动重命名置信度：${args.minConfidence}`);

    let completed = 0;
    const classifications = await runPool(files, args.concurrency, async (filePath, index) => {
        try {
            const result = await classifyFile({ filePath, index, args, config, taxonomy, cacheDir });
            completed += 1;
            console.log(`[${completed}/${files.length}] ${result.cached ? 'cache' : 'winky'} ${path.basename(filePath)} => ${[
                result.primaryTag,
                result.secondaryTag,
                result.tertiaryTag,
                result.subTag
            ].filter(Boolean).join('/')} (${result.validatedConfidence}) ${result.contentTitle}`);
            return result;
        } catch (error) {
            completed += 1;
            console.log(`[${completed}/${files.length}] failed ${path.basename(filePath)}: ${error.message}`);
            return {
                filePath,
                oldName: path.basename(filePath),
                status: 'failed',
                error: error.message,
                validatedConfidence: 0,
                matchLevel: 'missing',
                index
            };
        }
    });

    const rows = [];
    let renameCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    for (const classification of classifications) {
        const oldName = path.basename(classification.filePath);
        const hasUsablePath = Boolean(classification.primaryTag && classification.secondaryTag);
        const eligible = hasUsablePath && classification.validatedConfidence >= args.minConfidence && classification.status !== 'failed';
        const newName = eligible ? buildNewName({ filePath: classification.filePath, index: classification.index, classification }) : '';
        let status = eligible ? 'planned' : 'review';
        let finalNewName = newName;

        if (classification.status === 'failed') {
            status = 'failed';
            failedCount += 1;
        } else if (!eligible) {
            skippedCount += 1;
        } else if (args.apply) {
            const targetPath = uniqueTargetPath(targetDir, newName, classification.filePath);
            fs.renameSync(classification.filePath, targetPath);
            status = 'renamed';
            finalNewName = path.basename(targetPath);
            renameCount += 1;
        } else {
            renameCount += 1;
        }

        rows.push({
            status,
            oldName,
            newName: finalNewName,
            confidence: classification.validatedConfidence || 0,
            matchLevel: classification.matchLevel || '',
            primaryTag: classification.primaryTag || '',
            secondaryTag: classification.secondaryTag || '',
            tertiaryTag: classification.tertiaryTag || '',
            subTag: classification.subTag || '',
            contentTitle: classification.contentTitle || '',
            visualSummary: classification.visualSummary || '',
            evidence: classification.evidence || '',
            uncertainty: classification.uncertainty || '',
            validationNotes: Array.isArray(classification.validationNotes) ? classification.validationNotes.join('；') : '',
            error: classification.error || ''
        });
    }

    const summary = {
        runId,
        mode: args.apply ? 'apply' : 'dry-run',
        targetDir,
        total: files.length,
        renameCount,
        skippedCount,
        failedCount,
        minConfidence: args.minConfidence,
        labelWorkbook: path.resolve(args.labelWorkbook),
        outDir,
        createdAt: new Date().toISOString()
    };
    const reports = writeReports(outDir, rows, summary);
    console.log(JSON.stringify({ summary, reports }, null, 2));
}

main().catch(error => {
    console.error(error.stack || error.message || String(error));
    process.exit(1);
});
