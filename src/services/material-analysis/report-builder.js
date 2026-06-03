const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');
const { MaterialAnalysisService } = require('./importer');
const { MaterialAnalysisStore, safeSegment } = require('./store');
const { MaterialVisionCache } = require('./vision/vision-cache');
const { buildExperienceDocument } = require('./experience-builder');

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

function writeTextFile(filePath, content) {
    ensureDir(path.dirname(filePath));
    const tempPath = `${filePath}.tmp`;
    fs.writeFileSync(tempPath, content, 'utf8');
    fs.renameSync(tempPath, filePath);
}

function readTextFile(filePath) {
    if (!fs.existsSync(filePath)) return '';
    return fs.readFileSync(filePath, 'utf8');
}

function safeText(value, fallback = '--') {
    const text = String(value ?? '').trim();
    return text || fallback;
}

function formatNumber(value, digits = 2) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '--';
    return number.toLocaleString('zh-CN', {
        maximumFractionDigits: digits
    });
}

function formatPercent(value, digits = 2) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '--';
    return `${(number * 100).toLocaleString('zh-CN', {
        maximumFractionDigits: digits
    })}%`;
}

function formatDelta(value, mode = 'number') {
    const number = Number(value);
    if (!Number.isFinite(number)) return '--';
    const sign = number > 0 ? '+' : '';
    return mode === 'percent'
        ? `${sign}${formatPercent(number)}`
        : `${sign}${formatNumber(number)}`;
}

function materialDirection(material = {}) {
    const parsed = material.parsedName || {};
    return [parsed.primary, parsed.secondary, parsed.idea].filter(Boolean).join(' / ') || '--';
}

function directionName(item = {}) {
    return safeText(item.directionKey || [item.primary, item.secondary].filter(Boolean).join('/'));
}

function rowTable(headers = [], rows = []) {
    if (!rows.length) return '暂无数据。';
    const head = `| ${headers.join(' |')} |`;
    const sep = `| ${headers.map(() => '---').join(' |')} |`;
    const body = rows.map(row => `| ${row.map(cell => safeText(cell).replace(/\n/g, ' ')).join(' |')} |`);
    return [head, sep, ...body].join('\n');
}

function bulletList(items = [], fallback = '- 暂无明确结论。') {
    const rows = items.filter(Boolean);
    if (!rows.length) return fallback;
    return rows.map(item => `- ${item}`).join('\n');
}

function topItems(items = [], count = 10) {
    return (Array.isArray(items) ? items : []).slice(0, count);
}

function sum(items = [], key) {
    return items.reduce((total, item) => total + (Number.isFinite(Number(item[key])) ? Number(item[key]) : 0), 0);
}

function average(items = [], getter) {
    const values = items.map(getter).map(Number).filter(Number.isFinite);
    if (!values.length) return null;
    return values.reduce((total, value) => total + value, 0) / values.length;
}

function visionText(result = {}, key) {
    return result && result.vision ? safeText(result.vision[key], '') : '';
}

function uniq(items = []) {
    return [...new Set(items.map(item => safeText(item, '')).filter(Boolean))];
}

function reportDir(rootDir, summary = {}) {
    return path.join(
        rootDir,
        'data',
        'material-analysis',
        'reports',
        safeSegment(summary.projectName, 'unknown-project'),
        safeSegment(summary.weekId, 'unknown-week')
    );
}

function reportPaths(rootDir, summary = {}) {
    const dir = reportDir(rootDir, summary);
    return {
        dir,
        weekly: path.join(dir, 'weekly-report.md'),
        experience: path.join(dir, 'experience.md')
    };
}

function buildReportDescriptor(filePath, label) {
    const exists = fs.existsSync(filePath);
    const content = exists ? readTextFile(filePath) : '';
    const stat = exists ? fs.statSync(filePath) : null;
    const previewLines = content
        .split(/\r?\n/)
        .filter(line => line.trim())
        .slice(0, 10);
    return {
        label,
        exists,
        path: filePath,
        updatedAt: stat ? stat.mtime.toISOString() : null,
        sizeBytes: stat ? stat.size : 0,
        summary: previewLines.join('\n').slice(0, 900),
        content
    };
}

function buildPreviousComparison(current = {}, previousDetail = null) {
    if (!previousDetail || !previousDetail.summary) {
        return {
            hasPrevious: false,
            lines: ['暂无同项目上一份导入记录，本周作为趋势基线。']
        };
    }

    const previous = previousDetail.summary;
    const previousOverview = previousDetail.overview || {};
    const currentOverview = current.overview || {};
    const currentSummary = current.summary || {};
    const lines = [
        `对比基线：${safeText(previous.weekId)}，导入时间 ${safeText(previous.importedAt)}。`,
        `总花费变化：${formatDelta((currentSummary.totalSpend || 0) - (previous.totalSpend || 0))}。`,
        `总安装变化：${formatDelta((currentSummary.totalInstalls || 0) - (previous.totalInstalls || 0))}。`,
        `Top100 消耗占比变化：${formatDelta((currentSummary.top100SpendShare || 0) - (previous.top100SpendShare || 0), 'percent')}。`,
        `D0 ROI 覆盖变化：${formatDelta((currentSummary.d0RoiCoverage || 0) - (previous.d0RoiCoverage || 0), 'percent')}。`,
        `健康分变化：${formatDelta((currentOverview.avgTopHealthScore || 0) - (previousOverview.avgTopHealthScore || 0), 'number')}。`
    ];

    const currentTopDirections = new Set(topItems(current.directions || [], 8).map(directionName));
    const previousTopDirections = new Set(topItems(previousDetail.directions || [], 8).map(directionName));
    const entered = [...currentTopDirections].filter(item => !previousTopDirections.has(item)).slice(0, 5);
    const dropped = [...previousTopDirections].filter(item => !currentTopDirections.has(item)).slice(0, 5);
    if (entered.length) lines.push(`新进入高消耗方向：${entered.join('、')}。`);
    if (dropped.length) lines.push(`退出高消耗方向：${dropped.join('、')}。`);

    return {
        hasPrevious: true,
        previousRunId: previous.runId,
        previousWeekId: previous.weekId,
        lines
    };
}

function buildVisionSummary(context = {}) {
    const status = context.visionStatus || {};
    const successful = context.visionSuccessResults || [];
    const hooks = uniq(successful.map(item => visionText(item, 'hook'))).slice(0, 8);
    const subjects = uniq(successful.map(item => visionText(item, 'mainSubject'))).slice(0, 8);
    const scenes = uniq(successful.map(item => visionText(item, 'scene'))).slice(0, 8);
    const directions = uniq(successful.map(item => visionText(item, 'suggestedDirection'))).slice(0, 8);
    const risks = uniq(successful.flatMap(item => item.vision && Array.isArray(item.vision.riskNotes) ? item.vision.riskNotes : [])).slice(0, 8);

    return {
        statusLine: `视觉识别完成 ${formatNumber(status.successCount || successful.length, 0)}，失败 ${formatNumber(status.failedCount || 0, 0)}，缓存 ${formatNumber(status.cachedCount || 0, 0)}。`,
        hooks,
        subjects,
        scenes,
        directions,
        risks
    };
}

function buildNextActions(context = {}) {
    const summary = context.summary || {};
    const actions = [];
    const goodDirections = topItems(context.goodDirections, 3).map(directionName);
    const riskDirections = topItems(context.riskDirections, 3).map(directionName);
    const visionAxes = uniq(context.visionSuccessResults.flatMap(item => item.vision && Array.isArray(item.vision.variationAxes) ? item.vision.variationAxes : [])).slice(0, 5);

    if ((summary.d0RoiCoverage || 0) < 0.6) {
        actions.push('优先补齐 D0 ROI 覆盖，健康度判断先保持保守，避免只按点击或安装放大素材。');
    } else {
        actions.push('继续把 D0 ROI 作为放量和复刻第一判断口径，CPI/IPM 只做辅助解释。');
    }
    if (goodDirections.length) {
        actions.push(`围绕 ${goodDirections.join('、')} 做小变量复刻，每个方向拆 3-5 个画面变量。`);
    }
    if (riskDirections.length) {
        actions.push(`对 ${riskDirections.join('、')} 控制重复投放，先查高花费低回收的画面承诺是否偏离。`);
    }
    if (visionAxes.length) {
        actions.push(`下周视觉迭代优先使用这些变化轴：${visionAxes.join('、')}。`);
    }
    actions.push('把本周优秀素材沉淀到知识库，把高花费低 D0 ROI 素材加入负样本，形成下周创意拓展约束。');
    return actions;
}

function buildReportContext(detail = {}, previousDetail = null, visionPayload = {}) {
    const summary = detail.summary || {};
    const overview = detail.overview || {};
    const directions = Array.isArray(detail.directions) ? detail.directions : [];
    const top100 = Array.isArray(detail.top100) ? detail.top100 : [];
    const materials = Array.isArray(detail.materials) ? detail.materials : [];
    const visionResults = Array.isArray(visionPayload.results) ? visionPayload.results : [];
    const visionSuccessResults = visionResults.filter(item => item.status === 'success' && item.vision);
    const visionByMaterialId = new Map(visionResults.map(item => [item.materialId, item]));
    const current = { summary, overview, directions };

    return {
        generatedAt: new Date().toISOString(),
        summary,
        overview,
        directions,
        top100,
        materials,
        excellentMaterials: overview.excellentMaterials || [],
        riskMaterials: overview.riskMaterials || [],
        goodDirections: overview.goodDirections || directions.filter(item => ['scale', 'replicate'].includes(item.status && item.status.key)),
        riskDirections: overview.riskDirections || directions.filter(item => ['pause', 'risk'].includes(item.status && item.status.key)),
        visionStatus: visionPayload.status || {},
        visionResults,
        visionSuccessResults,
        visionByMaterialId,
        previous: buildPreviousComparison(current, previousDetail)
    };
}

function buildWeeklyReport(context = {}) {
    const summary = context.summary || {};
    const overview = context.overview || {};
    const vision = buildVisionSummary(context);
    const nextActions = buildNextActions(context);
    const top100Spend = sum(context.top100, 'spend');
    const top100Installs = sum(context.top100, 'installs');
    const top100D0 = average(context.top100, item => item.d0IapRoi);

    const metricRows = [
        ['总花费', formatNumber(summary.totalSpend)],
        ['总安装', formatNumber(summary.totalInstalls, 0)],
        ['Top10 消耗占比', formatPercent(summary.top10SpendShare)],
        ['Top100 消耗占比', formatPercent(summary.top100SpendShare)],
        ['D0 ROI 覆盖', formatPercent(summary.d0RoiCoverage)],
        ['Top100 花费', formatNumber(top100Spend)],
        ['Top100 安装', formatNumber(top100Installs, 0)],
        ['Top100 平均 D0 ROI', formatPercent(top100D0)]
    ];

    const topRows = topItems(context.top100, 10).map(item => [
        `#${item.topRank || '--'}`,
        safeText(item.materialName),
        materialDirection(item),
        formatNumber(item.spend),
        formatPercent(item.d0IapRoi),
        safeText(item.health && item.health.tag && item.health.tag.label)
    ]);

    const excellentRows = topItems(context.excellentMaterials, 8).map(item => [
        safeText(item.materialName),
        materialDirection(item),
        formatNumber(item.spend),
        formatPercent(item.d0IapRoi),
        safeText(item.health && item.health.action)
    ]);

    const riskRows = topItems(context.riskMaterials, 8).map(item => [
        safeText(item.materialName),
        materialDirection(item),
        formatNumber(item.spend),
        formatPercent(item.d0IapRoi),
        safeText(item.health && item.health.action)
    ]);

    const directionRows = topItems(context.directions, 12).map(item => [
        directionName(item),
        formatNumber(item.materialCount, 0),
        formatNumber(item.top100Count, 0),
        formatNumber(item.spend),
        formatPercent(item.d0IapRoi),
        formatNumber(item.avgHealthScore, 0),
        safeText(item.status && item.status.label),
        safeText(item.action)
    ]);

    return [
        `# ${safeText(summary.projectName, '项目')} ${safeText(summary.weekId, '本周')} 素材分析周报`,
        '',
        `生成时间：${context.generatedAt || new Date().toISOString()}`,
        `数据来源：${safeText(summary.sourceFileName)}`,
        `RunId：${safeText(summary.runId)}`,
        '',
        '## 1. 本周核心结论',
        bulletList([
            `项目状态：${safeText(overview.projectStatus)}，Top100 健康分 ${formatNumber(overview.avgTopHealthScore, 0)}。`,
            `D0 ROI 覆盖为 ${formatPercent(summary.d0RoiCoverage)}，本周判断优先使用 D0 ROI，覆盖不足时用 CPI/IPM 辅助解释。`,
            safeText(overview.conclusion, ''),
            `Top100 消耗占全量 ${formatPercent(summary.top100SpendShare)}，头部集中度需要结合 Top10 占比 ${formatPercent(summary.top10SpendShare)} 观察。`
        ]),
        '',
        '## 2. 项目健康度',
        rowTable(['指标', '结果'], [
            ['项目阶段判断', safeText(overview.projectStatus)],
            ['Top100 健康分', formatNumber(overview.avgTopHealthScore, 0)],
            ['优秀素材数', formatNumber((context.excellentMaterials || []).length, 0)],
            ['高风险素材数', formatNumber((context.riskMaterials || []).length, 0)],
            ['D0 ROI 判断口径', (summary.d0RoiCoverage || 0) >= 0.6 ? '可作为主要判断口径' : '覆盖不足，需保守解读']
        ]),
        '',
        '## 3. 核心指标概览',
        rowTable(['指标', '数值'], metricRows),
        '',
        '## 4. Top100 消耗素材概览',
        rowTable(['排名', '素材', '方向', '花费', 'D0 ROI', '健康标签'], topRows),
        '',
        '## 5. 表现优秀素材',
        rowTable(['素材', '方向', '花费', 'D0 ROI', '建议动作'], excellentRows),
        '',
        '## 6. 高风险素材',
        rowTable(['素材', '方向', '花费', 'D0 ROI', '建议动作'], riskRows),
        '',
        '## 7. 方向表现地图',
        rowTable(['方向', '素材数', 'Top100', '花费', 'D0 ROI', '健康分', '状态', '建议动作'], directionRows),
        '',
        '## 8. AI 视觉识别洞察',
        vision.statusLine,
        '',
        bulletList([
            vision.hooks.length ? `主要钩子：${vision.hooks.join('、')}。` : '',
            vision.subjects.length ? `高频主体：${vision.subjects.join('、')}。` : '',
            vision.scenes.length ? `高频场景：${vision.scenes.join('、')}。` : '',
            vision.directions.length ? `视觉建议方向：${vision.directions.join('、')}。` : '',
            vision.risks.length ? `需规避风险：${vision.risks.join('、')}。` : ''
        ], '- 暂无 AI 视觉识别结论，建议先完成 Top100 或核心素材识别。'),
        '',
        '## 9. 相比上一周变化',
        bulletList(context.previous && context.previous.lines),
        '',
        '## 10. 下周行动建议',
        bulletList(nextActions),
        ''
    ].join('\n');
}

function openPath(targetPath, selectFile = false) {
    const normalized = path.resolve(targetPath);
    if (process.platform === 'win32') {
        const args = selectFile ? ['/select,', normalized] : [normalized];
        const child = childProcess.spawn('explorer.exe', args, {
            detached: true,
            stdio: 'ignore',
            windowsHide: true
        });
        child.unref();
        return;
    }

    const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
    const child = childProcess.spawn(opener, [normalized], {
        detached: true,
        stdio: 'ignore'
    });
    child.unref();
}

class MaterialAnalysisReportService {
    constructor(context = {}) {
        this.rootDir = context.ROOT_DIR || context.rootDir || process.cwd();
        this.store = context.store || new MaterialAnalysisStore(this.rootDir);
        this.analysisService = context.analysisService || new MaterialAnalysisService({
            rootDir: this.rootDir,
            logger: context.logger
        });
        this.visionCache = context.visionCache || new MaterialVisionCache(this.rootDir);
    }

    findPreviousImport(summary = {}) {
        const importedAt = String(summary.importedAt || '');
        const imports = this.store.listImports()
            .filter(item => item.runId !== summary.runId)
            .filter(item => safeText(item.projectName, '') === safeText(summary.projectName, ''))
            .filter(item => !importedAt || String(item.importedAt || '') < importedAt)
            .sort((a, b) => String(b.importedAt || '').localeCompare(String(a.importedAt || '')));
        return imports[0] || null;
    }

    loadContext(runId) {
        const detail = this.analysisService.getImport(runId);
        if (!detail.success) return detail;

        let previousDetail = null;
        const previous = this.findPreviousImport(detail.summary);
        if (previous && previous.runId) {
            const loaded = this.analysisService.getImport(previous.runId);
            if (loaded.success) previousDetail = loaded;
        }

        const visionPayload = this.visionCache.readRun(runId) || {
            status: {},
            results: []
        };

        return {
            success: true,
            context: buildReportContext(detail, previousDetail, visionPayload)
        };
    }

    generate(runId) {
        const loaded = this.loadContext(runId);
        if (!loaded.success) return loaded;

        const context = loaded.context;
        const paths = reportPaths(this.rootDir, context.summary);
        const weeklyContent = buildWeeklyReport(context);
        const experienceContent = buildExperienceDocument(context);

        writeTextFile(paths.weekly, weeklyContent);
        writeTextFile(paths.experience, experienceContent);

        return {
            success: true,
            message: '素材分析周报和经验文档已生成',
            summary: context.summary,
            reportDir: paths.dir,
            reports: {
                weekly: buildReportDescriptor(paths.weekly, '周报'),
                experience: buildReportDescriptor(paths.experience, '经验文档')
            }
        };
    }

    getReports(runId) {
        const detail = this.analysisService.getImport(runId);
        if (!detail.success) return detail;

        const paths = reportPaths(this.rootDir, detail.summary);
        return {
            success: true,
            summary: detail.summary,
            reportDir: paths.dir,
            reports: {
                weekly: buildReportDescriptor(paths.weekly, '周报'),
                experience: buildReportDescriptor(paths.experience, '经验文档')
            }
        };
    }

    openReport(runId, type = 'folder') {
        const report = this.getReports(runId);
        if (!report.success) return report;

        const paths = reportPaths(this.rootDir, report.summary);
        const map = {
            folder: paths.dir,
            weekly: paths.weekly,
            experience: paths.experience
        };
        const target = map[type] || paths.dir;
        if (!fs.existsSync(target)) {
            return {
                success: false,
                message: '报告尚未生成，请先生成周报和经验文档'
            };
        }

        openPath(target, type !== 'folder');
        return {
            success: true,
            message: type === 'folder' ? '已打开报告目录' : '已打开报告所在位置',
            path: target
        };
    }
}

function createMaterialReportService(context = {}) {
    return new MaterialAnalysisReportService(context);
}

module.exports = {
    createMaterialReportService,
    MaterialAnalysisReportService,
    buildReportContext,
    buildWeeklyReport,
    reportPaths
};
