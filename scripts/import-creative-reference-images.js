const fs = require('fs');
const path = require('path');
const { createCreativeKnowledgeService } = require('../src/services/creative-knowledge');
const { CreativeKnowledgeStore } = require('../src/services/creative-knowledge/store');
const { extractWorkbookReferenceImages } = require('../src/services/creative-knowledge/workbook-reference-images');

const ROOT_DIR = path.resolve(__dirname, '..');

function safeArray(value) {
    return Array.isArray(value) ? value : [];
}

function main() {
    const service = createCreativeKnowledgeService({
        rootDir: ROOT_DIR,
        logger: { info() {}, error() {} }
    });
    const config = service.getConfig();
    const store = new CreativeKnowledgeStore(config.dataDir);
    store.ensureBase();

    const directionsData = store.read('directions.json', {
        version: 1,
        directions: []
    });
    const existingReferences = store.read('reference-images.json', {
        version: 1,
        images: [],
        metadata: {}
    });
    const outputDir = path.join(config.dataDir, 'reference-images', 'workbook');
    const workbookResult = extractWorkbookReferenceImages({
        workbookPath: config.directionWorkbook,
        directions: safeArray(directionsData.directions),
        outputDir
    });

    const nonWorkbookImages = safeArray(existingReferences.images)
        .filter(image => image && image.source !== 'workbook-embedded');
    const images = [
        ...nonWorkbookImages,
        ...safeArray(workbookResult.images)
    ];

    store.write('reference-images.json', {
        version: 1,
        importedAt: new Date().toISOString(),
        images,
        metadata: {
            ...(existingReferences.metadata || {}),
            sourceDir: config.referenceFolder,
            folderImageCount: nonWorkbookImages.length,
            workbookImageCount: safeArray(workbookResult.images).length,
            imageCount: images.length,
            workbook: workbookResult.metadata
        },
        warnings: safeArray(existingReferences.warnings)
            .filter(warning => !String(warning || '').includes('workbook'))
            .concat(safeArray(workbookResult.warnings))
    });

    const metadataPath = store.filePath('metadata.json');
    if (fs.existsSync(metadataPath)) {
        const metadata = store.read('metadata.json', {});
        store.write('metadata.json', {
            ...metadata,
            counts: {
                ...(metadata.counts || {}),
                referenceImages: images.length
            },
            sources: {
                ...(metadata.sources || {}),
                referenceImages: {
                    ...((metadata.sources && metadata.sources.referenceImages) || {}),
                    folderImageCount: nonWorkbookImages.length,
                    workbookImageCount: safeArray(workbookResult.images).length,
                    imageCount: images.length,
                    workbook: workbookResult.metadata
                }
            }
        });
    }

    console.log(`[S1] Imported workbook reference images: ${safeArray(workbookResult.images).length}`);
    console.log(`[S1] Total reference images: ${images.length}`);
}

main();
