import pino from 'pino';

let root = pino({ level: 'info', base: undefined, timestamp: pino.stdTimeFunctions.isoTime });
let baileysLevel = 'warn';

export function configureLogging({ logLevel, baileysLogLevel }) {
  root = pino({ level: logLevel || 'info', base: undefined, timestamp: pino.stdTimeFunctions.isoTime });
  baileysLevel = baileysLogLevel || 'warn';
}

/** Structured application logger. Never log message bodies or credentials. */
export function getLogger(bindings = {}) {
  return root.child(bindings);
}

/**
 * Baileys is very chatty and logs decrypted payloads at debug level, so it gets
 * its own (quieter) level.
 */
export function getBaileysLogger(sessionId) {
  return root.child({ lib: 'baileys', session: sessionId }, { level: baileysLevel });
}
