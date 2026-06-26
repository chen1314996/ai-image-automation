/**
 * 后台接口目录。
 *
 * 每个 routes 文件负责一组功能；这里统一挂载，方便一眼看到后台有哪些接口模块。
 */
const registerBrowserRoutes = require('../routes/browser.routes');
const registerConfigRoutes = require('../routes/config.routes');
const registerDoubaoRoutes = require('../routes/doubao.routes');
const registerJimengRoutes = require('../routes/jimeng.routes');
const registerLegilRoutes = require('../routes/legil.routes');
const registerWorkflowRoutes = require('../routes/workflow.routes');
const registerCreativeAgentRoutes = require('../routes/creative-agent.routes');
const registerCreativeKnowledgeRoutes = require('../routes/creative-knowledge.routes');
const registerAutoCuratorRoutes = require('../routes/auto-curator.routes');
const registerCreativeAutoRoutes = require('../routes/creative-auto.routes');
const registerMaterialAnalysisRoutes = require('../routes/material-analysis.routes');
const registerTaskWorkbookRoutes = require('../routes/task-workbook.routes');
const registerTablePromptRoutes = require('../routes/table-prompts.routes');
const registerBatchRetouchRoutes = require('../routes/batch-retouch.routes');
const registerDeliveryRoutes = require('../routes/delivery.routes');
const registerRenameRoutes = require('../routes/rename.routes');
const registerVisionTaxonomyRenameRoutes = require('../routes/vision-taxonomy-rename.routes');
const registerFeishuRoutes = require('../routes/feishu.routes');
const registerHealthRoutes = require('../routes/health.routes');
const registerLogsRoutes = require('../routes/logs.routes');
const registerRunStateRoutes = require('../routes/run-state.routes');
const registerAutonomyPolicyRoutes = require('../routes/autonomy-policy.routes');

function registerRoutes(app, context) {
    registerRunStateRoutes(app, context);
    registerAutonomyPolicyRoutes(app, context);
    registerBrowserRoutes(app, context);
    registerConfigRoutes(app, context);
    registerDoubaoRoutes(app, context);
    registerJimengRoutes(app, context);
    registerLegilRoutes(app, context);
    registerWorkflowRoutes(app, context);
    registerCreativeAgentRoutes(app, context);
    registerCreativeKnowledgeRoutes(app, context);
    registerAutoCuratorRoutes(app, context);
    registerCreativeAutoRoutes(app, context);
    registerMaterialAnalysisRoutes(app, context);
    registerTaskWorkbookRoutes(app, context);
    registerTablePromptRoutes(app, context);
    registerBatchRetouchRoutes(app, context);
    registerDeliveryRoutes(app, context);
    registerRenameRoutes(app, context);
    registerVisionTaxonomyRenameRoutes(app, context);
    registerFeishuRoutes(app, context);
    registerHealthRoutes(app, context);
    registerLogsRoutes(app, context);
}

module.exports = {
    registerRoutes
};
