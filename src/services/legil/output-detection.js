/**
 * Legil 结果识别入口。
 *
 * 这里只负责把 output/ 目录里的小模块组装起来，外部引用方式保持不变。
 */
const createOutputImageKeyMethods = require('./output/image-keys');
const createGenerationWaiterMethods = require('./output/generation-waiter');
const createOutputScannerMethods = require('./output/output-scanner');

module.exports = function createOutputDetectionMethods(deps) {
    return {
        ...createOutputImageKeyMethods(deps),
        ...createGenerationWaiterMethods(deps),
        ...createOutputScannerMethods(deps)
    };
};
