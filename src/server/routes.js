/**
 * 后台接口目录。
 *
 * 每个 routes 文件负责一组功能；这里统一挂载，方便一眼看到后台有哪些接口模块。
 */
const registerBrowserRoutes = require('../routes/browser.routes');
const registerConfigRoutes = require('../routes/config.routes');
const registerDoubaoRoutes = require('../routes/doubao.routes');
const registerLegilRoutes = require('../routes/legil.routes');
const registerWorkflowRoutes = require('../routes/workflow.routes');
const registerCreativeAgentRoutes = require('../routes/creative-agent.routes');
const registerRenameRoutes = require('../routes/rename.routes');
const registerFeishuRoutes = require('../routes/feishu.routes');
const registerHealthRoutes = require('../routes/health.routes');
const registerLogsRoutes = require('../routes/logs.routes');

function registerRoutes(app, context) {
    registerBrowserRoutes(app, context);
    registerConfigRoutes(app, context);
    registerDoubaoRoutes(app, context);
    registerLegilRoutes(app, context);
    registerWorkflowRoutes(app, context);
    registerCreativeAgentRoutes(app, context);
    registerRenameRoutes(app, context);
    registerFeishuRoutes(app, context);
    registerHealthRoutes(app, context);
    registerLogsRoutes(app, context);
}

module.exports = {
    registerRoutes
};
