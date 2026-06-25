const path = require('path');

const ROOT_DIR = path.join(__dirname, '..', '..', '..');

const LEGIL_DEFAULT_SETTINGS = {
    imageModel: 'nano-banana-2',
    aspectRatio: '1:1',
    resolution: '2K',
    outputQuantity: 1
};

const LEGIL_IMAGE_MODEL_OPTIONS = [
    { value: 'seedream-4.5', label: 'Seedream 4.5' },
    { value: 'gpt-image-2', label: 'GPT-Image-2' },
    { value: 'gpt-image-1', label: 'GPT-Image-1' },
    { value: 'nano-banana-2', label: 'Nano Banana 2' },
    { value: 'nano-banana-pro', label: 'Nano Banana Pro' },
    { value: 'nano-banana', label: 'Nano Banana' },
    { value: 'imagen-3', label: 'Imagen-3' }
];

const LEGIL_ASPECT_RATIOS = ['1:1', '1:4', '1:8', '2:3', '3:4', '4:5', '9:16', '21:9', '16:9', '5:4', '4:3', '3:2', '8:1', '4:1'];
const LEGIL_RESOLUTIONS = ['512px', '1K', '2K', '4K'];
const LEGIL_OUTPUT_QUANTITIES = [1, 2, 3, 4];
const LEGIL_GPT_IMAGE_ASPECT_RATIOS = ['1:1', '2:3', '3:4', '4:5', '9:16', '16:9', '5:4', '4:3', '3:2', '智能比例'];
const LEGIL_GPT_IMAGE_RESOLUTIONS = ['1K', '2K'];

const LEGIL_DEFAULT_MODEL_PARAMETER_PROFILE = {
    defaultAspectRatio: LEGIL_DEFAULT_SETTINGS.aspectRatio,
    defaultResolution: LEGIL_DEFAULT_SETTINGS.resolution,
    defaultOutputQuantity: LEGIL_DEFAULT_SETTINGS.outputQuantity,
    aspectRatios: LEGIL_ASPECT_RATIOS,
    resolutions: LEGIL_RESOLUTIONS,
    outputQuantities: LEGIL_OUTPUT_QUANTITIES,
    outputQuantityControl: 'button'
};

const LEGIL_GPT_IMAGE_PARAMETER_PROFILE = {
    defaultAspectRatio: '1:1',
    defaultResolution: '2K',
    defaultOutputQuantity: 1,
    aspectRatios: LEGIL_GPT_IMAGE_ASPECT_RATIOS,
    resolutions: LEGIL_GPT_IMAGE_RESOLUTIONS,
    outputQuantities: LEGIL_OUTPUT_QUANTITIES,
    outputQuantityControl: 'slider'
};

const LEGIL_MODEL_PARAMETER_PROFILES = {
    'gpt-image-2': LEGIL_GPT_IMAGE_PARAMETER_PROFILE,
    'gpt-image-1': LEGIL_GPT_IMAGE_PARAMETER_PROFILE
};

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif'];
const LEGIL_IMAGE_TO_IMAGE_URL = 'https://lumos.diandian.info/legil/image-ai/image-to-image';
const LEGIL_ERROR_SCREENSHOT_DIR = path.join(ROOT_DIR, 'runtime', 'legil-error-screenshots');

module.exports = {
    ROOT_DIR,
    LEGIL_DEFAULT_SETTINGS,
    LEGIL_IMAGE_MODEL_OPTIONS,
    LEGIL_ASPECT_RATIOS,
    LEGIL_RESOLUTIONS,
    LEGIL_OUTPUT_QUANTITIES,
    LEGIL_DEFAULT_MODEL_PARAMETER_PROFILE,
    LEGIL_MODEL_PARAMETER_PROFILES,
    IMAGE_EXTENSIONS,
    LEGIL_IMAGE_TO_IMAGE_URL,
    LEGIL_ERROR_SCREENSHOT_DIR
};
