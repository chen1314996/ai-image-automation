const fs = require('fs');
const path = require('path');
const axios = require('axios');
const XLSX = require('xlsx');
const { formatDateTimeForFile } = require('./file-utils');
const { readSecrets } = require('./secrets-store');
const {
    normalizeCellText,
    parseCreativePromptWorkbook
} = require('./creative-table-parser');
const {
    STRUCTURED_PROMPT_SUFFIX,
    buildCreativeAgentQualityReport,
    sanitizeCreativePromptItems
} = require('./creative-agent-quality');

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
const CREATIVE_AGENT_ROOT = process.env.CREATIVE_AGENT_ROOT || path.join(__dirname, 'agents', 'creative-expansion-agent');
const CREATIVE_AGENT_OUTPUT_DIR = path.join(__dirname, 'creative_agent_outputs');
const CREATIVE_AGENT_CORE_SKILLS = [
    'reference-analysis-table',
    'batch-iteration-strategy-table',
    'new-direction-expansion-table'
];
const CREATIVE_AGENT_OPTIONAL_SKILLS = [
    'strict-table-direction-iteration',
    'batch-creative-expansion-accelerator'
];
const CREATIVE_AGENT_TEXT_EXTENSIONS = ['.txt', '.md', '.csv', '.json', '.log'];
const CREATIVE_AGENT_TABLE_EXTENSIONS = ['.xlsx', '.xls', '.csv'];
const CREATIVE_AGENT_MAX_TEXT_CHARS = 60000;
const CREATIVE_AGENT_MAX_IMAGES = 12;

function getStoredWinkyConfig() {
    const secrets = readSecrets();
    return {
        apiKey: String(process.env.WINKY_API_KEY || secrets.winkyApiKey || '').trim(),
        apiUrl: String(process.env.WINKY_API_BASE_URL || secrets.winkyApiUrl || '').trim(),
        model: String(process.env.WINKY_MODEL || secrets.winkyModel || '').trim(),
        provider: String(process.env.WINKY_PROVIDER || secrets.winkyProvider || '').trim()
    };
}

function truncateCreativeAgentText(text, maxChars = CREATIVE_AGENT_MAX_TEXT_CHARS) {
    const value = String(text || '');
    if (value.length <= maxChars) {
        return value;
    }
    return `${value.slice(0, maxChars)}\n\n[内容过长，已截断 ${value.length - maxChars} 字]`;
}

function decodeBase64Attachment(contentBase64 = '') {
    const normalized = String(contentBase64 || '').replace(/^data:.*?;base64,/, '');
    return Buffer.from(normalized, 'base64');
}

function detectCreativeAgentAttachmentType(fileName = '', mimeType = '') {
    const ext = path.extname(String(fileName || '')).toLowerCase();
    const mime = String(mimeType || '').toLowerCase();
    if (mime.startsWith('image/') || IMAGE_EXTENSIONS.includes(ext)) return 'image';
    if (CREATIVE_AGENT_TABLE_EXTENSIONS.includes(ext)) return ext === '.csv' ? 'table' : 'spreadsheet';
    if (CREATIVE_AGENT_TEXT_EXTENSIONS.includes(ext) || mime.startsWith('text/')) return 'text';
    return 'other';
}

function extractWorkbookTextForCreativeAgent(fileName, buffer) {
    const ext = path.extname(String(fileName || '')).toLowerCase();
    const workbook = ext === '.csv'
        ? XLSX.read(buffer.toString('utf8').replace(/^\uFEFF/, ''), {
            type: 'string',
            cellDates: false,
            raw: false
        })
        : XLSX.read(buffer, {
            type: 'buffer',
            cellDates: false,
            raw: false
        });

    const parts = [];
    for (const sheetName of workbook.SheetNames || []) {
        const sheet = workbook.Sheets[sheetName];
        const csv = XLSX.utils.sheet_to_csv(sheet, {
            FS: ' | ',
            RS: '\n',
            blankrows: false
        });
        if (csv.trim()) {
            parts.push(`工作表：${sheetName}\n${csv.trim()}`);
        }
    }

    return truncateCreativeAgentText(parts.join('\n\n'));
}

function parseWorkbookRowsForCreativeAgent(fileName, buffer) {
    const ext = path.extname(String(fileName || '')).toLowerCase();
    const workbook = ext === '.csv'
        ? XLSX.read(buffer.toString('utf8').replace(/^\uFEFF/, ''), {
            type: 'string',
            cellDates: false,
            raw: false
        })
        : XLSX.read(buffer, {
            type: 'buffer',
            cellDates: false,
            raw: false
        });

    const sheetName = workbook.SheetNames && workbook.SheetNames[0];
    if (!sheetName) {
        return [];
    }

    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
        header: 1,
        raw: false,
        defval: ''
    });
    const header = (rows[0] || []).map(normalizeCellText);
    const indexMap = {};
    header.forEach((name, index) => {
        indexMap[name] = index;
    });

    const pick = (row, name) => normalizeCellText(row[indexMap[name]]);
    return rows.slice(1)
        .map((row, index) => {
            const primary = pick(row, '一级标签');
            const secondary = pick(row, '二级标签');
            const tertiary = pick(row, '三级标签');
            const subDirection = pick(row, '子方向');
            const iterationDescription = pick(row, '迭代描述');
            const directionDescription = pick(row, '方向描述');
            const referenceImage = pick(row, '参考图');
            const directionName = subDirection || tertiary || secondary || primary || `第${index + 2}行`;
            return {
                originalRowNumber: index + 2,
                primary,
                secondary,
                tertiary,
                subDirection,
                iterationDescription,
                directionDescription,
                referenceImage,
                directionName,
                sourcePath: [primary, secondary, tertiary, subDirection].filter(Boolean).join(' / '),
                executionType: classifyCreativeAgentSourceRow(primary, secondary, tertiary, subDirection)
            };
        })
        .filter(row => row.primary || row.secondary || row.tertiary || row.subDirection || row.iterationDescription || row.directionDescription);
}

function classifyCreativeAgentSourceRow(primary, secondary, tertiary, subDirection) {
    const text = [primary, secondary, tertiary, subDirection].filter(Boolean).join(' ');
    if (/物品|数显|包装|手办/.test(text)) return 'item_display';
    if (/建筑|桥梁|城镇|避难所|城建/.test(text)) return 'structure_scene';
    if (/载具|驾驶|后备箱/.test(text)) return 'vehicle_survival';
    if (/迁徙|运输|导航/.test(text)) return 'migration_route';
    if (/危机|逃跑|来袭|巨兽|崩溃|物资被夺/.test(text)) return 'crisis_conflict';
    if (/角色|BOSS|VLOG|小队|群像|卖惨|排队/.test(text)) return 'character_showcase';
    if (/订单|模拟经营/.test(text)) return 'management_play';
    return 'creative_direction';
}

function summarizeCreativeAgentAttachments(attachments = []) {
    const summaries = [];
    const imageContent = [];
    const safeAttachments = Array.isArray(attachments) ? attachments : [];

    safeAttachments.slice(0, 80).forEach((item, index) => {
        const fileName = path.basename(String(item && item.name ? item.name : `附件${index + 1}`));
        const relativePath = String(item && item.relativePath ? item.relativePath : '').trim();
        const displayName = relativePath || fileName;
        const mimeType = String(item && item.mimeType ? item.mimeType : '');
        const contentBase64 = String(item && item.contentBase64 ? item.contentBase64 : '');
        const type = detectCreativeAgentAttachmentType(fileName, mimeType);
        const summary = {
            name: displayName,
            type,
            content: ''
        };

        try {
            if (contentBase64) {
                const buffer = decodeBase64Attachment(contentBase64);
                if (type === 'spreadsheet' || type === 'table') {
                    summary.content = extractWorkbookTextForCreativeAgent(fileName, buffer);
                } else if (type === 'text') {
                    summary.content = truncateCreativeAgentText(buffer.toString('utf8').replace(/^\uFEFF/, ''));
                } else if (type === 'image') {
                    summary.content = '图片已作为视觉参考随请求发送给模型。';
                    if (imageContent.length < CREATIVE_AGENT_MAX_IMAGES) {
                        imageContent.push({
                            type: 'image_url',
                            image_url: {
                                url: `data:${mimeType || 'image/png'};base64,${contentBase64.replace(/^data:.*?;base64,/, '')}`,
                                detail: 'auto'
                            }
                        });
                    }
                } else {
                    summary.content = '当前文件类型暂未解析正文，仅传递文件名作为参考。';
                }
            } else {
                summary.content = '未提供可读取的文件内容。';
            }
        } catch (error) {
            summary.content = `附件解析失败：${error.message}`;
        }

        summaries.push(summary);
    });

    return {
        summaries,
        imageContent,
        omittedCount: safeAttachments.length > 80 ? safeAttachments.length - 80 : 0
    };
}

function loadCreativeExpansionAgentBundle() {
    const instructions = fs.readFileSync(path.join(CREATIVE_AGENT_ROOT, 'instructions.md'), 'utf8');
    const skillNames = [...CREATIVE_AGENT_CORE_SKILLS, ...CREATIVE_AGENT_OPTIONAL_SKILLS];
    const skills = {};

    for (const skillName of skillNames) {
        const skillPath = path.join(CREATIVE_AGENT_ROOT, 'skills', skillName, 'SKILL.md');
        skills[skillName] = fs.readFileSync(skillPath, 'utf8');
    }

    return { instructions, skills };
}

function selectCreativeAgentSkills(inputText) {
    const selected = new Set(CREATIVE_AGENT_CORE_SKILLS);
    const text = String(inputText || '');

    if (/(Excel|CSV|table|spreadsheet|screenshot|row|rows|direction list|no skip|order|表格|截图|逐行|行号|方向表|清单|不要漏|不跳项|按顺序)/i.test(text)) {
        selected.add('strict-table-direction-iteration');
    }

    if (/(100|dozens|hundreds|batch|large scale|series|dedupe|duplicate|asset pool|几十|上百|批量|大规模|系列化|去重|同质化|扩量|素材池)/i.test(text)) {
        selected.add('batch-creative-expansion-accelerator');
    }

    return [...selected];
}

function buildCreativeAgentUserPrompt({ instruction, targetCount, attachmentSummaries, selectedSkillNames, omittedCount }) {
    const parts = [
        '# User Request',
        String(instruction || '').trim() || '请基于我上传的资料拓展创意方向，并输出可直接用于生图的提示词表格。',
        '',
        '# Selected Skills',
        selectedSkillNames.map(name => `- ${name}`).join('\n')
    ];

    if (targetCount) {
        parts.push('', '# Target Count', `${targetCount} 个方向或素材扩展目标`);
    }

    if (attachmentSummaries.length) {
        const attachmentText = attachmentSummaries
            .map((item, index) => [
                `## Attachment ${index + 1}: ${item.name}`,
                `Type: ${item.type}`,
                item.content || 'No readable text was provided.'
            ].join('\n'))
            .join('\n\n');
        parts.push('', '# Attachment Summaries', attachmentText);
    }

    if (omittedCount > 0) {
        parts.push('', '# Omitted Attachments', `还有 ${omittedCount} 个附件因数量过多未展开，请优先基于已读取内容完成。`);
    }

    parts.push(
        '',
        '# Output Requirements',
        '请输出默认四部分 Markdown 表格，不要把表格放进代码块。第四部分必须命名为“新方向拓展表”，列名固定为：参考方向、新方向名称、方向描述、来源于哪条详细迭代策略、提示词1、提示词2、提示词3、提示词4、提示词5。'
    );

    return parts.join('\n');
}

function buildCreativeAgentMessages({ instruction, targetCount, attachments }) {
    const bundle = loadCreativeExpansionAgentBundle();
    const attachmentData = summarizeCreativeAgentAttachments(attachments);
    const skillSelectionText = [
        instruction,
        ...attachmentData.summaries.map(item => `${item.type} ${item.name} ${item.content}`)
    ].join('\n');
    const selectedSkillNames = selectCreativeAgentSkills(skillSelectionText);
    const selectedSkills = selectedSkillNames
        .map(name => `\n\n## Skill: ${name}\n\n${bundle.skills[name]}`)
        .join('\n');
    const systemPrompt = [
        bundle.instructions,
        '\n\n# Loaded Skills',
        selectedSkills,
        '\n\n# Runtime Rule',
        'Use the loaded skills as execution guidance. The default workflow is reference analysis -> batch iteration strategy -> new direction expansion.'
    ].join('\n');
    const userText = buildCreativeAgentUserPrompt({
        instruction,
        targetCount,
        attachmentSummaries: attachmentData.summaries,
        selectedSkillNames,
        omittedCount: attachmentData.omittedCount
    });
    const userContent = attachmentData.imageContent.length > 0
        ? [{ type: 'text', text: userText }, ...attachmentData.imageContent]
        : userText;

    return {
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent }
        ],
        selectedSkillNames,
        attachmentCount: attachmentData.summaries.length
    };
}

function sanitizeCreativeAgentError(error, apiKey = '') {
    const responseMessage = error && error.response && error.response.data
        ? JSON.stringify(error.response.data)
        : (error && error.message ? error.message : String(error || '未知错误'));
    const key = String(apiKey || '');
    return key ? responseMessage.replaceAll(key, '[REDACTED]') : responseMessage;
}

function extractCreativeAgentResponseText(data) {
    if (typeof data === 'string') return data;
    if (!data || typeof data !== 'object') return '';
    if (typeof data.output_text === 'string') return data.output_text;
    if (typeof data.text === 'string') return data.text;

    const firstChoice = Array.isArray(data.choices) ? data.choices[0] : null;
    if (firstChoice) {
        const message = firstChoice.message || {};
        if (typeof message.content === 'string') return message.content;
        if (Array.isArray(message.content)) {
            return message.content
                .map(part => typeof part === 'string' ? part : (part && (part.text || part.content) ? String(part.text || part.content) : ''))
                .filter(Boolean)
                .join('\n');
        }
        if (typeof firstChoice.text === 'string') return firstChoice.text;
    }

    const firstCandidate = Array.isArray(data.candidates) ? data.candidates[0] : null;
    if (firstCandidate && firstCandidate.content && Array.isArray(firstCandidate.content.parts)) {
        return firstCandidate.content.parts.map(part => part.text || '').join('\n');
    }

    return '';
}

async function callCreativeAgentLlm({ apiUrl, apiKey, model, provider, instruction, targetCount, attachments }) {
    const request = buildCreativeAgentMessages({ instruction, targetCount, attachments });
    const payload = {
        model,
        messages: request.messages,
        temperature: 0.78,
        max_tokens: 12000,
        stream: false
    };

    if (provider) {
        payload.provider = provider;
    }

    const response = await axios.post(apiUrl, payload, {
        timeout: 10 * 60 * 1000,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        }
    });
    const text = extractCreativeAgentResponseText(response.data);
    if (!text.trim()) {
        throw new Error('模型没有返回可读取的表格内容');
    }

    return {
        text,
        selectedSkillNames: request.selectedSkillNames,
        attachmentCount: request.attachmentCount
    };
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
        throw new Error('模型没有返回可解析 JSON');
    }
}

async function callCreativeAgentJson({ apiUrl, apiKey, model, provider, messages, maxTokens = 9000, temperature = 0.72 }) {
    const payload = {
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
        stream: false,
        response_format: { type: 'json_object' }
    };

    if (provider) {
        payload.provider = provider;
    }

    const response = await axios.post(apiUrl, payload, {
        timeout: 10 * 60 * 1000,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        }
    });
    return extractJsonObject(extractCreativeAgentResponseText(response.data));
}

function buildStructuredSourceContext(sourceRows) {
    return sourceRows.map(row => {
        const fields = [
            `第${row.originalRowNumber}行`,
            row.sourcePath,
            row.iterationDescription ? `迭代描述：${row.iterationDescription}` : '',
            row.directionDescription ? `方向描述：${row.directionDescription}` : ''
        ].filter(Boolean);
        return fields.join('｜');
    }).join('\n');
}

function buildStructuredRowPrompt(sourceRow, sourceRows, retryReason = '') {
    return [
        '# 内部批处理任务',
        '你正在为项目后台生成 Excel 的单行结构化数据。不要输出 Markdown，不要解释，只输出合法 JSON。',
        '',
        '# 全部原始方向索引',
        buildStructuredSourceContext(sourceRows),
        '',
        '# 当前必须完整处理的原始行',
        JSON.stringify(sourceRow, null, 2),
        '',
        '# 必须输出的 JSON 结构',
        JSON.stringify({
            referenceAnalysis: {
                referenceName: '',
                buyReason: '',
                buyCore: '',
                reusableMarketingElements: '',
                artReason: '',
                artCore: '',
                reusableArtElements: '',
                avoidRepeating: ''
            },
            detailedStrategy: {
                referenceDirection: '',
                currentAnalysis: '',
                coreReason: '',
                bestVisualMechanism: '',
                easiestRepeatPart: '',
                suggestedIterationAxis: '',
                avoidElements: '',
                subDirections: '',
                concreteSuggestions: '',
                priorityReason: '',
                riskAdvice: ''
            },
            newDirections: [
                {
                    name: '',
                    description: '',
                    sourceStrategy: '',
                    prompts: ['', '', '', '', '']
                }
            ]
        }, null, 2),
        '',
        '# 质量要求',
        '1. newDirections 必须正好 5 条，每条必须相对当前原始方向有明显不同的画面机制。',
        '2. 每条 newDirection 的 prompts 必须正好 5 条。',
        '3. 每条提示词必须是 300-430 个中文字符，不能是关键词列表，必须是一段可直接出图的完整中文画面提示词。',
        '4. 每条提示词都要覆盖：主题、画风、情绪氛围、主体、场景、构图、镜头、光线色彩、材质细节、广告传播点。',
        `5. 每条提示词结尾必须包含：${STRUCTURED_PROMPT_SUFFIX}`,
        '6. 不要把所有提示词写成同一模板；同一新方向下 5 条提示词必须在主体关系、动作机制、镜头景别、空间结构和光线方案上拉开。',
        '7. referenceAnalysis 和 detailedStrategy 每个字段都要具体，不能写泛泛的“氛围好、视觉强”。',
        '8. 保持冰封末世、现实废土、生存资源、3D卡通商业海报质感，默认不要赛博、激光 UI、机甲、悬浮设备。',
        retryReason ? `\n# 上次输出问题\n${retryReason}\n请修正后重新输出 JSON。` : ''
    ].filter(Boolean).join('\n');
}

function normalizeStructuredRowResult(result, sourceRow) {
    const fallbackReference = `第${sourceRow.originalRowNumber}行｜${sourceRow.directionName}`;
    const referenceAnalysis = result && typeof result.referenceAnalysis === 'object' ? result.referenceAnalysis : {};
    const detailedStrategy = result && typeof result.detailedStrategy === 'object' ? result.detailedStrategy : {};
    const newDirections = Array.isArray(result && result.newDirections) ? result.newDirections.slice(0, 5) : [];

    while (newDirections.length < 5) {
        newDirections.push({
            name: `${sourceRow.directionName}拓展方向${newDirections.length + 1}`,
            description: `基于${sourceRow.directionName}继续扩展不同的生存事件与视觉中心。`,
            sourceStrategy: '围绕主体关系、场景机制和镜头语言做差异化扩展',
            prompts: []
        });
    }

    return {
        referenceAnalysis: {
            referenceName: normalizeCellText(referenceAnalysis.referenceName) || fallbackReference,
            buyReason: normalizeCellText(referenceAnalysis.buyReason),
            buyCore: normalizeCellText(referenceAnalysis.buyCore),
            reusableMarketingElements: normalizeCellText(referenceAnalysis.reusableMarketingElements),
            artReason: normalizeCellText(referenceAnalysis.artReason),
            artCore: normalizeCellText(referenceAnalysis.artCore),
            reusableArtElements: normalizeCellText(referenceAnalysis.reusableArtElements),
            avoidRepeating: normalizeCellText(referenceAnalysis.avoidRepeating)
        },
        detailedStrategy: {
            referenceDirection: normalizeCellText(detailedStrategy.referenceDirection) || fallbackReference,
            currentAnalysis: normalizeCellText(detailedStrategy.currentAnalysis),
            coreReason: normalizeCellText(detailedStrategy.coreReason),
            bestVisualMechanism: normalizeCellText(detailedStrategy.bestVisualMechanism),
            easiestRepeatPart: normalizeCellText(detailedStrategy.easiestRepeatPart),
            suggestedIterationAxis: normalizeCellText(detailedStrategy.suggestedIterationAxis),
            avoidElements: normalizeCellText(detailedStrategy.avoidElements),
            subDirections: normalizeCellText(detailedStrategy.subDirections),
            concreteSuggestions: normalizeCellText(detailedStrategy.concreteSuggestions),
            priorityReason: normalizeCellText(detailedStrategy.priorityReason),
            riskAdvice: normalizeCellText(detailedStrategy.riskAdvice)
        },
        newDirections: newDirections.map((direction, directionIndex) => {
            const prompts = Array.isArray(direction && direction.prompts) ? direction.prompts.slice(0, 5).map(normalizeCellText) : [];
            while (prompts.length < 5) {
                prompts.push(`主题：${sourceRow.directionName}的冰封末世拓展画面。画风：高质量3D卡通渲染，商业级游戏宣传海报风格，电影镜头感。情绪氛围：紧张、压迫、带有求生希望。画面内容：幸存者在冰雪废墟中围绕关键资源展开行动，前景有霜雪覆盖的道具与手部动作，中景有角色关系和明确冲突，远景是被风雪吞没的旧文明建筑。构图突出核心物资和人物反应，冷蓝环境光与局部暖光形成对比，材质包含厚雪、磨损金属、破旧布料和雾气层次。整体基调强调一眼可读的广告爆点与末世生存叙事。${STRUCTURED_PROMPT_SUFFIX}`);
            }
            const normalizedDirection = {
                name: normalizeCellText(direction && direction.name) || `${sourceRow.directionName}拓展方向${directionIndex + 1}`,
                description: normalizeCellText(direction && direction.description) || `基于${sourceRow.directionName}扩展新的视觉冲突和广告表达重点。`,
                sourceStrategy: normalizeCellText(direction && direction.sourceStrategy) || '围绕主体关系、场景机制和镜头语言做差异化扩展'
            };
            return {
                ...normalizedDirection,
                prompts: prompts.map((prompt, promptIndex) => ensureStructuredPromptDetail(prompt, sourceRow, normalizedDirection, promptIndex))
            };
        })
    };
}

function removeStructuredPromptSuffix(prompt) {
    return normalizeCellText(prompt).replace(STRUCTURED_PROMPT_SUFFIX, '').trim().replace(/。+$/, '');
}

function trimStructuredPromptBase(text, maxLength) {
    const cleanText = normalizeCellText(text);
    if (cleanText.length <= maxLength) {
        return cleanText;
    }

    const sentences = cleanText
        .split('。')
        .map(sentence => sentence.trim())
        .filter(Boolean);
    let nextText = '';
    for (const sentence of sentences) {
        const candidate = nextText ? `${nextText}。${sentence}` : sentence;
        if (candidate.length > maxLength) {
            break;
        }
        nextText = candidate;
    }

    if (nextText.length >= 280) {
        return nextText;
    }

    return cleanText
        .slice(0, maxLength)
        .replace(/[，、；：][^，、；：。]*$/, '')
        .trim();
}

function appendStructuredPromptSuffix(prompt) {
    const maxBaseLength = 430 - STRUCTURED_PROMPT_SUFFIX.length - 1;
    const base = trimStructuredPromptBase(removeStructuredPromptSuffix(prompt), maxBaseLength);
    return `${base}${base.endsWith('。') ? '' : '。'}${STRUCTURED_PROMPT_SUFFIX}`;
}

function ensureStructuredPromptDetail(prompt, sourceRow, direction, promptIndex) {
    const base = removeStructuredPromptSuffix(prompt);
    const lensVariants = [
        '前景放置带霜的关键道具和角色手部动作，中景安排主要角色形成清晰冲突，远景保留被风雪吞没的废墟轮廓。',
        '前景用破碎冰块、脚印和散落物资制造进入感，中景突出角色与资源的关系，后景以压迫性的旧文明建筑或雪雾拉开空间。',
        '画面采用低机位或斜向构图强化广告冲击，主体动作要一眼可读，视觉中心集中在资源、危险或奖励反馈上。',
        '镜头使用中近景捕捉表情和动作瞬间，同时保留足够环境信息，让观众能快速理解这是极寒生存场景。',
        '构图让冷蓝风雪包围画面边缘，暖光集中在人物、物资或提示信息上，形成缩略图也能读懂的冷暖反差。'
    ];
    const materialVariants = [
        '材质细节需要强调厚雪、半透明冰层、磨损金属、旧布料、霜雾颗粒和被冻裂的木石结构。',
        '角色服装应有补丁、防寒绒毛、冰霜边缘和旧装备绑带，道具表面要有划痕、积雪、结冰水汽与使用痕迹。',
        '环境中加入断裂钢架、旧标识牌、冰封管道、碎石与远处风雪，增强末世废土的真实重量。',
        '光线以冷色环境光为底，辅以火光、灯光、资源发光或警示红光，让主体轮廓和广告卖点更突出。',
        '画面细节避免空泛堆词，要让每个道具、动作和表情都服务于资源稀缺、危机逼近或发现奖励。'
    ];
    const sourceNote = `该画面延续原表“${sourceRow.sourcePath || sourceRow.directionName}”的题材逻辑，并从“${direction.name}”这个新方向继续扩展。`;
    const adNote = '整体要像可直接投放的游戏广告主视觉，信息价值前置，主体关系明确，危险、奖励和求生动机在前三秒内可被识别。';
    const additions = [
        sourceNote,
        lensVariants[promptIndex % lensVariants.length],
        materialVariants[(promptIndex + direction.name.length) % materialVariants.length],
        adNote
    ];

    let next = base;
    for (const addition of additions) {
        if (next.length >= 330) break;
        if (!next.includes(addition)) {
            next += `。${addition}`;
        }
    }

    return appendStructuredPromptSuffix(next);
}

function structuredRowQualityIssue(result) {
    const directions = Array.isArray(result && result.newDirections) ? result.newDirections : [];
    const prompts = directions.flatMap(direction => Array.isArray(direction.prompts) ? direction.prompts : []);
    if (directions.length !== 5) return `新方向数量为 ${directions.length}，必须正好 5 条。`;
    if (prompts.length !== 25) return `提示词数量为 ${prompts.length}，必须正好 25 条。`;
    const avgLength = prompts.reduce((sum, prompt) => sum + normalizeCellText(prompt).length, 0) / prompts.length;
    if (avgLength < 300) return `提示词平均长度只有 ${Math.round(avgLength)} 字，必须显著更详细。`;
    return '';
}

async function generateStructuredRowExpansion(payload, sourceRow, sourceRows) {
    const bundle = loadCreativeExpansionAgentBundle();
    const systemPrompt = [
        bundle.instructions,
        '\n\n# Loaded Skills',
        ['reference-analysis-table', 'batch-iteration-strategy-table', 'new-direction-expansion-table', 'strict-table-direction-iteration', 'batch-creative-expansion-accelerator']
            .map(name => `\n\n## Skill: ${name}\n\n${bundle.skills[name]}`)
            .join('\n'),
        '\n\n# Runtime Rule',
        'This is an internal structured batch call. Follow the Agent quality rules, but output JSON only so the program can assemble the Excel workbook.'
    ].join('\n');

    let retryReason = '';
    for (let attempt = 0; attempt < 2; attempt++) {
        const result = await callCreativeAgentJson({
            apiUrl: payload.apiUrl,
            apiKey: payload.apiKey,
            model: payload.model,
            provider: payload.provider,
            maxTokens: 9000,
            temperature: attempt === 0 ? 0.72 : 0.62,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: buildStructuredRowPrompt(sourceRow, sourceRows, retryReason) }
            ]
        });
        const issue = structuredRowQualityIssue(result);
        if (!issue || attempt === 1) {
            return normalizeStructuredRowResult(result, sourceRow);
        }
        retryReason = issue;
    }

    throw new Error('结构化行生成失败');
}

function parseMarkdownTableRow(line) {
    return String(line || '')
        .trim()
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map(cell => cell.replace(/\\\|/g, '|').trim());
}

function isMarkdownTableSeparator(line) {
    const cells = parseMarkdownTableRow(line);
    return cells.length > 0 && cells.every(cell => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, '')));
}

function cleanCreativeAgentSheetName(name, fallback) {
    const cleaned = String(name || '')
        .replace(/^#+\s*/, '')
        .replace(/^第[一二三四五六七八九十0-9]+部分[：:]?\s*/, '')
        .replace(/[\\/?*\[\]:]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return (cleaned || fallback).slice(0, 31);
}

function uniqueSheetName(workbook, preferredName) {
    const existing = new Set(workbook.SheetNames || []);
    let name = preferredName.slice(0, 31) || 'Sheet';
    let index = 2;
    while (existing.has(name)) {
        const suffix = `_${index}`;
        name = `${preferredName.slice(0, 31 - suffix.length)}${suffix}`;
        index += 1;
    }
    return name;
}

function markdownTablesToWorkbook(markdown) {
    const lines = String(markdown || '').split(/\r?\n/);
    const tables = [];
    let lastHeading = '';
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];
        const trimmed = line.trim();
        if (/^#{1,6}\s+/.test(trimmed) || /^第[一二三四五六七八九十0-9]+部分[：:]/.test(trimmed)) {
            lastHeading = trimmed;
            i += 1;
            continue;
        }

        if (trimmed.includes('|') && i + 1 < lines.length && isMarkdownTableSeparator(lines[i + 1])) {
            const rows = [parseMarkdownTableRow(trimmed)];
            i += 2;
            while (i < lines.length && lines[i].trim().includes('|')) {
                rows.push(parseMarkdownTableRow(lines[i]));
                i += 1;
            }
            tables.push({
                heading: lastHeading,
                rows
            });
            continue;
        }

        i += 1;
    }

    const workbook = XLSX.utils.book_new();
    if (tables.length === 0) {
        const rows = [['Agent输出'], ...String(markdown || '').split(/\r?\n/).map(line => [line])];
        XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Agent输出');
        return workbook;
    }

    tables.forEach((table, index) => {
        const headers = table.rows[0] || [];
        const hasNewDirectionPrompts = headers.includes('新方向名称') && headers.some(header => /^提示词\d+$/.test(header));
        const preferredName = hasNewDirectionPrompts
            ? '新方向拓展表'
            : cleanCreativeAgentSheetName(table.heading, `表格${index + 1}`);
        const sheetName = uniqueSheetName(workbook, preferredName);
        const sheet = XLSX.utils.aoa_to_sheet(table.rows);
        sheet['!cols'] = headers.map(header => ({
            wch: /^提示词\d+$/.test(String(header || '')) ? 42 : 20
        }));
        XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
    });

    return workbook;
}

function buildStrategyOverviewRows() {
    return [
        ['迭代维度', '可拆分方向', '适合扩展的原因', '批量生成建议', '容易重复的风险点', '去重建议', '优先扩展顺序'],
        ['主体关系', '单主体、双主体互救、多人协作、人与巨物、人与巨兽、人与物资', '主体关系变化会直接改变广告语义，不只是换背景', '先按主体关系拆大类，再在每类下细分冲突与任务', '只是换角色脸型会显得同质', '强制让主体数量、力量关系、依赖关系同步变化', '1'],
        ['场景机制', '发现、抢修、护送、争夺、撤离、守夜、失控、交易', '机制决定画面里正在发生什么，最适合批量扩展', '每个方向至少拆出5种不同机制，再配5个镜头变体', '只换地点不换机制会非常像', '用动作词而不是地点词管理素材池', '2'],
        ['广告卖点', '稀缺物资、温度危机、倒计时、路线选择、角色收益、巨物压迫', '卖点决定前几秒能否被读懂', '每组提示词必须有一个明确可视化卖点', '只写氛围会弱化点击动机', '把卖点落到物件、动作或数字信息上', '3'],
        ['镜头语言', '近景特写、中景协作、远景压迫、俯视路径、低机位英雄化', '镜头变化能快速拉开同题材素材差异', '同一方向下5条提示词强制使用不同景别和视角', '反复正面平视会显得模板化', '用镜头距离和前中后景结构去重', '4'],
        ['空间结构', '冰坑、废墟街道、桥梁、车厢、巨兽旁、避难所内部、排行榜展示台', '空间结构让同一个方向具备系列化生产能力', '优先做能承载角色行动和资源冲突的空间', '只换背景名词会没有新画面', '空间必须绑定动作机制', '5'],
        ['光线色彩', '冷蓝风雪、暖橙热源、红色警报、屏幕微光、晨昏边缘光', '冷暖关系能强化冰封末世和广告可读性', '每条提示词都指定主光源、辅光和色彩对比', '全冷色容易平、全暖色会失去极寒感', '按光源功能区分：求生、危险、奖励、未知', '6'],
        ['材质细节', '厚雪、霜、磨损金属、旧布料、裂冰、烟雾、包装破损', '材质是3D广告图完成度的核心', '每条提示词至少写3类可见材质', '只写高质量渲染不够落地', '材质必须服务主体和卖点', '7'],
        ['情绪节奏', '压迫、惊喜、忙乱、守护、失控、希望、幽默反差', '情绪变化能避免同质化并提高素材池覆盖面', '每个方向内部安排不同情绪瞬间', '一直紧张会疲劳', '用情绪词绑定动作和构图，不空喊氛围', '8']
    ];
}

function appendSheet(workbook, sheetName, rows, widths = []) {
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    if (widths.length) {
        sheet['!cols'] = widths.map(wch => ({ wch }));
    }
    XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
}

function buildStructuredCreativeWorkbook(sourceRows, rowResults) {
    const workbook = XLSX.utils.book_new();

    appendSheet(workbook, '原表识别', [
        ['原表序号', '一级标签', '二级标签', '三级标签', '子方向', '迭代描述', '方向描述', '参考图数量', '识别方向名', '执行类型'],
        ...sourceRows.map(row => [
            row.originalRowNumber,
            row.primary,
            row.secondary,
            row.tertiary,
            row.subDirection,
            row.iterationDescription,
            row.directionDescription,
            row.referenceImage ? 1 : '',
            row.directionName,
            row.executionType
        ])
    ], [10, 14, 16, 18, 20, 32, 36, 10, 20, 18]);

    appendSheet(workbook, '参考分析表', [
        ['参考图/编号/方向名', '买量判断_为什么容易出效果', '买量判断_核心优势拆解', '买量判断_可复用投放元素', '美术判断_为什么成立', '美术判断_核心优势拆解', '美术判断_可复用美术元素', '不宜重复的部分'],
        ...rowResults.map(({ sourceRow, result }) => [
            result.referenceAnalysis.referenceName || `第${sourceRow.originalRowNumber}行｜${sourceRow.directionName}`,
            result.referenceAnalysis.buyReason,
            result.referenceAnalysis.buyCore,
            result.referenceAnalysis.reusableMarketingElements,
            result.referenceAnalysis.artReason,
            result.referenceAnalysis.artCore,
            result.referenceAnalysis.reusableArtElements,
            result.referenceAnalysis.avoidRepeating
        ])
    ], [22, 42, 42, 36, 42, 42, 36, 40]);

    appendSheet(workbook, '100组素材迭代策略总表', buildStrategyOverviewRows(), [18, 42, 42, 42, 36, 36, 12]);

    appendSheet(workbook, '逐方向详细迭代策略表', [
        ['参考方向', '当前方向分析', '该方向成立的核心原因', '该方向最值得保留的视觉机制', '该方向最容易重复的部分', '建议重点扩展的迭代轴', '不建议继续重复的元素', '可继续拆出的子方向', '每个子方向的具体画面建议', '适合优先产出的原因', '风险与避坑建议'],
        ...rowResults.map(({ sourceRow, result }) => [
            result.detailedStrategy.referenceDirection || `第${sourceRow.originalRowNumber}行｜${sourceRow.directionName}`,
            result.detailedStrategy.currentAnalysis,
            result.detailedStrategy.coreReason,
            result.detailedStrategy.bestVisualMechanism,
            result.detailedStrategy.easiestRepeatPart,
            result.detailedStrategy.suggestedIterationAxis,
            result.detailedStrategy.avoidElements,
            result.detailedStrategy.subDirections,
            result.detailedStrategy.concreteSuggestions,
            result.detailedStrategy.priorityReason,
            result.detailedStrategy.riskAdvice
        ])
    ], [22, 46, 40, 36, 36, 40, 40, 36, 46, 36, 42]);

    const expansionRows = [['原表序号', '参考方向', '新方向名称', '方向描述', '来源于哪条详细迭代策略', '提示词1', '提示词2', '提示词3', '提示词4', '提示词5']];
    rowResults.forEach(({ sourceRow, result }) => {
        result.newDirections.forEach(direction => {
            expansionRows.push([
                sourceRow.originalRowNumber,
                sourceRow.directionName,
                direction.name,
                direction.description,
                direction.sourceStrategy,
                ...direction.prompts
            ]);
        });
    });
    appendSheet(workbook, '新方向拓展表', expansionRows, [10, 18, 24, 34, 34, 58, 58, 58, 58, 58]);

    return workbook;
}

async function mapLimit(items, limit, worker) {
    const results = new Array(items.length);
    let cursor = 0;
    const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (cursor < items.length) {
            const index = cursor;
            cursor += 1;
            results[index] = await worker(items[index], index);
        }
    });
    await Promise.all(runners);
    return results;
}

function getStructuredSourceRowsFromAttachments(attachments = []) {
    for (const attachment of Array.isArray(attachments) ? attachments : []) {
        const fileName = String(attachment && attachment.name ? attachment.name : '');
        const mimeType = String(attachment && attachment.mimeType ? attachment.mimeType : '');
        const type = detectCreativeAgentAttachmentType(fileName, mimeType);
        if ((type === 'spreadsheet' || type === 'table') && attachment.contentBase64) {
            const rows = parseWorkbookRowsForCreativeAgent(fileName, decodeBase64Attachment(attachment.contentBase64));
            if (rows.length >= 8) {
                return rows;
            }
        }
    }
    return [];
}

async function runStructuredCreativeAgent(payload, sourceRows) {
    const concurrency = Math.max(1, Math.min(2, Number(payload.concurrency) || 2));
    const rowResults = await mapLimit(sourceRows, concurrency, async (sourceRow) => {
        const result = await generateStructuredRowExpansion(payload, sourceRow, sourceRows);
        return { sourceRow, result };
    });

    fs.mkdirSync(CREATIVE_AGENT_OUTPUT_DIR, { recursive: true });
    const fileName = `creative_agent_structured_${formatDateTimeForFile()}.xlsx`;
    const filePath = path.join(CREATIVE_AGENT_OUTPUT_DIR, fileName);
    const workbook = buildStructuredCreativeWorkbook(sourceRows, rowResults);
    const workbookBuffer = XLSX.write(workbook, {
        type: 'buffer',
        bookType: 'xlsx'
    });
    fs.writeFileSync(filePath, workbookBuffer);

    let parsedPrompts = [];
    let qualityReport = buildCreativeAgentQualityReport([]);
    let parseMessage = '';
    try {
        const parsed = parseCreativePromptWorkbook(fileName, workbookBuffer.toString('base64'));
        parsedPrompts = sanitizeCreativePromptItems(parsed.prompts);
        qualityReport = buildCreativeAgentQualityReport(parsedPrompts);
        parseMessage = qualityReport.success
            ? `已从生成表格中提取 ${parsedPrompts.length} 组提示词，质检通过`
            : `已从生成表格中提取 ${parsedPrompts.length} 组提示词；${qualityReport.summary}`;
    } catch (error) {
        parseMessage = `表格已生成，但未提取到提示词：${error.message}`;
    }

    return {
        success: true,
        mode: 'structured-table-batch',
        message: parseMessage,
        fileName,
        downloadUrl: `/api/creative-agent/download/${encodeURIComponent(fileName)}`,
        localPath: filePath,
        prompts: parsedPrompts,
        qualityReport,
        selectedSkills: ['reference-analysis-table', 'batch-iteration-strategy-table', 'new-direction-expansion-table', 'strict-table-direction-iteration', 'batch-creative-expansion-accelerator'],
        attachmentCount: Array.isArray(payload.attachments) ? payload.attachments.length : 0,
        sourceRowCount: sourceRows.length,
        expansionRowCount: rowResults.reduce((sum, item) => sum + item.result.newDirections.length, 0),
        markdownPreview: ''
    };
}

async function runCreativeAgent(payload) {
    const sourceRows = getStructuredSourceRowsFromAttachments(payload.attachments);
    if (sourceRows.length >= 8) {
        return await runStructuredCreativeAgent(payload, sourceRows);
    }

    const agentResult = await callCreativeAgentLlm(payload);

    fs.mkdirSync(CREATIVE_AGENT_OUTPUT_DIR, { recursive: true });
    const fileName = `creative_agent_${formatDateTimeForFile()}.xlsx`;
    const filePath = path.join(CREATIVE_AGENT_OUTPUT_DIR, fileName);
    const workbook = markdownTablesToWorkbook(agentResult.text);
    const workbookBuffer = XLSX.write(workbook, {
        type: 'buffer',
        bookType: 'xlsx'
    });
    fs.writeFileSync(filePath, workbookBuffer);

    let parsedPrompts = [];
    let qualityReport = buildCreativeAgentQualityReport([]);
    let parseMessage = '';
    try {
        const parsed = parseCreativePromptWorkbook(fileName, workbookBuffer.toString('base64'));
        parsedPrompts = sanitizeCreativePromptItems(parsed.prompts);
        qualityReport = buildCreativeAgentQualityReport(parsedPrompts);
        parseMessage = qualityReport.success
            ? `已从生成表格中提取 ${parsedPrompts.length} 组提示词，质检通过`
            : `已从生成表格中提取 ${parsedPrompts.length} 组提示词；${qualityReport.summary}`;
    } catch (error) {
        parseMessage = `表格已生成，但未提取到提示词：${error.message}`;
    }

    return {
        success: true,
        message: parseMessage,
        fileName,
        downloadUrl: `/api/creative-agent/download/${encodeURIComponent(fileName)}`,
        localPath: filePath,
        prompts: parsedPrompts,
        qualityReport,
        selectedSkills: agentResult.selectedSkillNames,
        attachmentCount: agentResult.attachmentCount,
        markdownPreview: truncateCreativeAgentText(agentResult.text, 3000)
    };
}

function getCreativeAgentStatus() {
    const winky = getStoredWinkyConfig();
    return {
        success: true,
        configured: {
            apiKey: Boolean(winky.apiKey),
            apiUrl: Boolean(winky.apiUrl),
            model: Boolean(winky.model)
        },
        defaults: {
            apiUrl: winky.apiUrl,
            model: winky.model,
            provider: winky.provider
        },
        agentRoot: CREATIVE_AGENT_ROOT
    };
}

module.exports = {
    CREATIVE_AGENT_OUTPUT_DIR,
    getCreativeAgentStatus,
    getStoredWinkyConfig,
    runCreativeAgent,
    sanitizeCreativeAgentError
};
