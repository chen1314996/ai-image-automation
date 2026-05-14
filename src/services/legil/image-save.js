/**
 * Legil 图片保存入口。
 *
 * 这里只负责把 save/ 目录里的下载、截图和保存流程组装起来，外部引用方式保持不变。
 */
const createImageDownloadMethods = require('./save/download');
const createPreviewSaveMethods = require('./save/preview');
const createImageSaveFlowMethods = require('./save/save-flow');

module.exports = function createImageSaveMethods(deps) {
    return {
        ...createImageDownloadMethods(deps),
        ...createPreviewSaveMethods(deps),
        ...createImageSaveFlowMethods(deps)
    };
};
