const path = require('path');

const naturalCollator = new Intl.Collator('zh-CN', {
    numeric: true,
    sensitivity: 'base'
});

function naturalCompareByName(a, b) {
    const nameA = path.basename(String(a || ''));
    const nameB = path.basename(String(b || ''));
    const byName = naturalCollator.compare(nameA, nameB);
    if (byName !== 0) {
        return byName;
    }
    return naturalCollator.compare(String(a || ''), String(b || ''));
}

function sortNaturallyByName(items) {
    return [...items].sort(naturalCompareByName);
}

function padNumber(value, width = 2) {
    const numberValue = Number(value);
    const safeNumber = Number.isFinite(numberValue) && numberValue >= 0
        ? Math.floor(numberValue)
        : 0;
    return String(safeNumber).padStart(width, '0');
}

function sanitizeFileNamePart(value, maxLength = 60) {
    const fallback = 'image';
    const text = String(value || '').trim();
    if (!text) {
        return fallback;
    }

    const safe = text
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
        .replace(/\s+/g, '_')
        .replace(/_+/g, '_')
        .replace(/[. ]+$/g, '')
        .replace(/^_+|_+$/g, '');

    return (safe || fallback).slice(0, maxLength);
}

function formatDateTimeForFile(date = new Date()) {
    const year = date.getFullYear();
    const month = padNumber(date.getMonth() + 1, 2);
    const day = padNumber(date.getDate(), 2);
    const hour = padNumber(date.getHours(), 2);
    const minute = padNumber(date.getMinutes(), 2);
    const second = padNumber(date.getSeconds(), 2);
    return `${year}${month}${day}_${hour}${minute}${second}`;
}

module.exports = {
    formatDateTimeForFile,
    naturalCompareByName,
    sortNaturallyByName,
    padNumber,
    sanitizeFileNamePart
};
