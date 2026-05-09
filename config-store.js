const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, 'automation-config.json');

function readConfig() {
    try {
        if (!fs.existsSync(CONFIG_PATH)) {
            return {};
        }

        const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
        if (!raw.trim()) {
            return {};
        }

        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
        return {};
    }
}

function writeConfig(config) {
    const safeConfig = config && typeof config === 'object' ? config : {};
    fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(safeConfig, null, 2)}\n`, 'utf8');
}

function updateConfig(updates) {
    const current = readConfig();
    const next = {
        ...current,
        ...(updates && typeof updates === 'object' ? updates : {})
    };
    writeConfig(next);
    return next;
}

module.exports = {
    CONFIG_PATH,
    readConfig,
    updateConfig,
    writeConfig
};
