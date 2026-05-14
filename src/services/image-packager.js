const fs = require('fs');
const path = require('path');

const { naturalCompareByName, sortNaturallyByName } = require('../../file-utils');
const {
    IMAGE_EXTENSIONS,
    normalizeInputPath,
    sanitizeFileNamePart,
    trimBaseName
} = require('./image-renamer');

const PACKAGE_TARGET_SIZES = ['800x800', '1080x1920', '1280x720'];

function assertDirectory(folderPath, label) {
    if (!folderPath) {
        throw new Error(`请输入${label}`);
    }
    if (!fs.existsSync(folderPath)) {
        throw new Error(`${label}不存在，请检查路径是否正确`);
    }
    if (!fs.statSync(folderPath).isDirectory()) {
        throw new Error(`${label}不是文件夹`);
    }
}

function normalizePackageOptions(options = {}) {
    const inputFolder = normalizeInputPath(options.inputFolder);
    const outputFolder = normalizeInputPath(options.outputFolder);

    assertDirectory(inputFolder, '待打包图片目录');

    if (!outputFolder) {
        throw new Error('请输入打包输出目录');
    }

    if (fs.existsSync(outputFolder) && !fs.statSync(outputFolder).isDirectory()) {
        throw new Error('打包输出路径不是文件夹');
    }

    if (path.resolve(inputFolder).toLowerCase() === path.resolve(outputFolder).toLowerCase()) {
        throw new Error('待打包图片目录和打包输出目录不能相同');
    }

    return {
        inputFolder,
        outputFolder
    };
}

function parseSizedImageName(fileName) {
    const stem = path.parse(String(fileName || '')).name;
    const match = stem.match(/^(.*)_(\d{2,5}x\d{2,5})$/i);

    if (!match || !match[1]) {
        return null;
    }

    return {
        groupBaseName: match[1],
        size: match[2].toLowerCase()
    };
}

function getUniquePackageFolderName(outputFolder, baseName, usedNames) {
    const safeBaseName = trimBaseName(sanitizeFileNamePart(baseName, 'package'));
    let counter = 1;
    let folderName = safeBaseName;

    while (
        usedNames.has(folderName.toLowerCase()) ||
        fs.existsSync(path.join(outputFolder, folderName))
    ) {
        counter += 1;
        const suffix = `_${String(counter).padStart(2, '0')}`;
        folderName = `${trimBaseName(safeBaseName, suffix.length)}${suffix}`;
    }

    usedNames.add(folderName.toLowerCase());
    return folderName;
}

function buildPackagePlan(options = {}) {
    const { inputFolder, outputFolder } = normalizePackageOptions(options);
    const files = sortNaturallyByName(fs.readdirSync(inputFolder));
    const imageFiles = files.filter(file => IMAGE_EXTENSIONS.includes(path.extname(file).toLowerCase()));
    const groups = new Map();
    const skipped = [];

    imageFiles.forEach(file => {
        const parsed = parseSizedImageName(file);

        if (!parsed) {
            skipped.push({
                originalName: file,
                reason: '未识别到末尾尺寸'
            });
            return;
        }

        if (!PACKAGE_TARGET_SIZES.includes(parsed.size)) {
            skipped.push({
                originalName: file,
                targetDimensions: parsed.size,
                reason: `尺寸 ${parsed.size} 不在目标尺寸内`
            });
            return;
        }

        const folderName = sanitizeFileNamePart(parsed.groupBaseName, 'package');
        const groupKey = folderName.toLowerCase();

        if (!groups.has(groupKey)) {
            groups.set(groupKey, {
                groupName: parsed.groupBaseName,
                folderName,
                filesBySize: new Map()
            });
        }

        const group = groups.get(groupKey);
        if (!group.filesBySize.has(parsed.size)) {
            group.filesBySize.set(parsed.size, []);
        }
        group.filesBySize.get(parsed.size).push({
            originalName: file,
            sourcePath: path.join(inputFolder, file),
            size: parsed.size
        });
    });

    const usedNames = new Set();
    const items = [];

    Array.from(groups.values())
        .sort((a, b) => naturalCompareByName(a.folderName, b.folderName))
        .forEach(group => {
            const missingSizes = PACKAGE_TARGET_SIZES.filter(size => !group.filesBySize.has(size));
            const duplicateSizes = PACKAGE_TARGET_SIZES.filter(size => (group.filesBySize.get(size) || []).length > 1);
            const groupFiles = PACKAGE_TARGET_SIZES
                .flatMap(size => group.filesBySize.get(size) || [])
                .map(file => ({
                    originalName: file.originalName,
                    size: file.size,
                    sourcePath: file.sourcePath
                }));

            if (duplicateSizes.length) {
                skipped.push({
                    originalName: group.folderName,
                    folderName: group.folderName,
                    outputName: group.folderName,
                    sizes: groupFiles.map(file => file.size),
                    files: groupFiles,
                    reason: `同一尺寸重复：${duplicateSizes.join('、')}`
                });
                return;
            }

            if (missingSizes.length) {
                skipped.push({
                    originalName: group.folderName,
                    folderName: group.folderName,
                    outputName: group.folderName,
                    sizes: groupFiles.map(file => file.size),
                    files: groupFiles,
                    reason: `缺少尺寸：${missingSizes.join('、')}`
                });
                return;
            }

            const outputName = getUniquePackageFolderName(outputFolder, group.folderName, usedNames);
            const outputPath = path.join(outputFolder, outputName);
            const requiredFiles = PACKAGE_TARGET_SIZES.map(size => {
                const file = group.filesBySize.get(size)[0];
                return {
                    originalName: file.originalName,
                    size,
                    sourcePath: file.sourcePath,
                    outputPath: path.join(outputPath, file.originalName)
                };
            });

            items.push({
                originalName: group.folderName,
                outputName,
                folderName: outputName,
                groupName: group.groupName,
                outputPath,
                fileCount: requiredFiles.length,
                sizes: PACKAGE_TARGET_SIZES,
                files: requiredFiles
            });
        });

    return {
        inputFolder,
        outputFolder,
        requiredSizes: PACKAGE_TARGET_SIZES,
        totalImages: imageFiles.length,
        totalGroups: groups.size,
        readyCount: items.length,
        skippedCount: skipped.length,
        outputFolderExists: fs.existsSync(outputFolder),
        items,
        skipped
    };
}

function packageImages(options = {}) {
    const plan = buildPackagePlan(options);
    fs.mkdirSync(plan.outputFolder, { recursive: true });

    const packaged = [];
    const failed = [];

    plan.items.forEach(item => {
        try {
            fs.mkdirSync(item.outputPath, { recursive: true });
            item.files.forEach(file => {
                fs.copyFileSync(file.sourcePath, file.outputPath);
            });
            packaged.push(item);
        } catch (error) {
            failed.push({
                ...item,
                reason: error.message
            });
        }
    });

    return {
        ...plan,
        packaged,
        failed,
        packagedCount: packaged.length,
        failedCount: failed.length
    };
}

module.exports = {
    PACKAGE_TARGET_SIZES,
    buildPackagePlan,
    packageImages,
    parseSizedImageName
};
