/**
 * Compatibility entry point.
 *
 * Keep `node server.js` and `npm start` working while the real server
 * startup code lives under src/server/.
 */
require('./src/server/start');
