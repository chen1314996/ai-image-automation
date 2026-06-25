function hasCjkText(value) {
    return /[\u3400-\u9fff]/.test(String(value || ''));
}

function hasLikelyUtf8Mojibake(value) {
    return /[\u0080-\u009f\u00c0-\u00ff]/.test(String(value || ''));
}

function recoverUtf8Filename(value) {
    const text = String(value || '');
    if (!text) return '';

    const decoded = Buffer.from(text, 'latin1').toString('utf8');
    if (!decoded || decoded.includes('\ufffd')) return text;

    if (hasLikelyUtf8Mojibake(text) && hasCjkText(decoded)) {
        return decoded;
    }

    return text;
}

function normalizeImportSummaryFileNames(summary) {
    if (!summary || typeof summary !== 'object') return summary;
    const next = { ...summary };
    if (next.fileName) next.fileName = recoverUtf8Filename(next.fileName);
    if (next.sourceFileName) next.sourceFileName = recoverUtf8Filename(next.sourceFileName);
    return next;
}

module.exports = {
    recoverUtf8Filename,
    normalizeImportSummaryFileNames
};
