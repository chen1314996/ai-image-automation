const fs = require('fs');
const path = require('path');

// 本文件只负责保存本机敏感配置，例如火山方舟 API Key。
// automation-secrets.json 已加入 .gitignore，默认不会提交到 Git 仓库。
const SECRETS_PATH = path.join(__dirname, 'automation-secrets.json');

function readSecrets() {
    try {
        if (!fs.existsSync(SECRETS_PATH)) {
            return {};
        }

        const raw = fs.readFileSync(SECRETS_PATH, 'utf8').replace(/^\uFEFF/, '');
        if (!raw.trim()) {
            return {};
        }

        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
        return {};
    }
}

function writeSecrets(secrets) {
    const safeSecrets = secrets && typeof secrets === 'object' ? secrets : {};
    fs.writeFileSync(SECRETS_PATH, `${JSON.stringify(safeSecrets, null, 2)}\n`, 'utf8');
}

function updateSecrets(updates) {
    const current = readSecrets();
    const next = {
        ...current,
        ...(updates && typeof updates === 'object' ? updates : {})
    };
    writeSecrets(next);
    return next;
}

module.exports = {
    SECRETS_PATH,
    readSecrets,
    writeSecrets,
    updateSecrets
};
