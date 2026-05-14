/**
 * Compatibility wrapper for the Legil automation singleton.
 *
 * The implementation now lives in src/services/legil/ so the generation,
 * output detection, and image saving code can be read separately.
 */
module.exports = require('./src/services/legil');
