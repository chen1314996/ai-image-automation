/**
 * Legil automation facade.
 *
 * The public singleton export stays compatible with the old root
 * legil-automation.js module, while the class methods are split by
 * responsibility under this directory.
 */
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

const browserController = require('../../../playwright-controller');
const logger = require('../../../logger');
const {
    formatDateTimeForFile,
    padNumber,
    sanitizeFileNamePart,
    sortNaturallyByName
} = require('../../../file-utils');

const constants = require('./constants');
const helpers = require('./helpers');
const createConfigMethodsMethods = require('./config-methods');
const createGenerationFlowMethods = require('./generation-flow');
const createPageActionsMethods = require('./page-actions');
const createGenerationSettingsMethods = require('./generation-settings');
const createOutputDetectionMethods = require('./output-detection');
const createImageSaveMethods = require('./image-save');

const {
    LEGIL_DEFAULT_SETTINGS
} = constants;

class LegilAutomation extends EventEmitter {
    constructor() {
        super();
        // 保存路径（默认输出文件夹）
        this.saveFolder = 'D:\\工作\\自动化工作流1\\输出';
        // 参考图文件夹路径
        this.referenceFolder = 'D:\\工作\\自动化工作流1\\Legil参考图';
        // 存储可用的参考图列表
        this.referenceImages = [];
        // 当前使用的参考图索引
        this.currentRefIndex = 0;
        this.generationSettings = { ...LEGIL_DEFAULT_SETTINGS };
    }
}

const deps = {
    browserController,
    logger,
    fs,
    path,
    formatDateTimeForFile,
    padNumber,
    sanitizeFileNamePart,
    sortNaturallyByName,
    ...helpers,
    ...constants
};

Object.assign(
    LegilAutomation.prototype,
    createConfigMethodsMethods(deps),
    createGenerationFlowMethods(deps),
    createPageActionsMethods(deps),
    createGenerationSettingsMethods(deps),
    createOutputDetectionMethods(deps),
    createImageSaveMethods(deps)
);

module.exports = new LegilAutomation();
module.exports.LegilAutomation = LegilAutomation;
