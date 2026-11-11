/**
 * Zigmaa CRM · WhatsApp bridge
 *
 * Keeps one Baileys socket per CRM user alive and mirrors every 1-to-1 chat
 * into PostgreSQL. All durable state (pairing credentials, signal keys, chats,
 * messages, media) lives in the database, so this process can be restarted,
 * redeployed or moved at any time without anyone having to scan a QR code again.
 *
 * Module map:
 *   src/config.js           environment + connection settings
 *   src/db.js               pool, transactions, schema runner (schema.sql)
 *   src/auth-store.js       Baileys auth state backed by PostgreSQL
 *   src/session.js          one linked device: lifecycle, reconnects, ingestion
 *   src/session-manager.js  singleton registry Map<sessionId, WASession>
 *   src/store.js            chat / message persistence, LID <-> phone merging
 *   src/media.js            background media download, voice-note transcoding
 *   src/storage.js          media storage drivers (database or S3-compatible)
 *   src/http.js             token-protected internal API used by the CRM API
 */
import { buildConfig, isRejectedDesktopIdentity, loadEnvFiles } from './src/config.js';
import { applySchema, createPool, Db } from './src/db.js';
import { createHttpApp } from './src/http.js';
import { configureLogging, getLogger } from './src/logger.js';
import { BackendNotifier } from './src/notify.js';
import { SessionManager } from './src/session-manager.js';
import { MediaStorage } from './src/storage.js';

loadEnvFiles();

let config;
try {
  config = buildConfig();
} catch (err) {
  console.error(`[whatsapp-bridge] configuration error: ${err.message}`);
  process.exit(1);
}
configureLogging(config);
const log = getLogger({ mod: 'main' });

if (isRejectedDesktopIdentity(config.session.browser, config.session.syncFullHistory)) {
  log.warn(
    { browser: config.session.browser },
    'WA_BROWSER selects the native macOS/Windows desktop identity with full history sync; ' +
      'WhatsApp currently closes such connections before issuing a QR code'
  );
}

// One tenant's protocol hiccup must not take every other tenant's connection
// down with it, so stray errors are logged (with their stack) and survived.
process.on('unhandledRejection', (reason) => {
  log.error({ err: reason?.message || String(reason), stack: reason?.stack }, 'unhandled promise rejection');
});
process.on('uncaughtException', (err) => {
  log.error({ err: err?.message, stack: err?.stack }, 'uncaught exception');
});

async function main() {
  const db = new Db(createPool(config.db));

  // The database is a hard dependency; wait for it rather than start half-working.
  for (let attempt = 1; ; attempt++) {
    try {
      await applySchema(db);
      break;
    } catch (err) {
      if (attempt >= 10) throw err;
      log.warn({ attempt, err: err.message }, 'database not ready, retrying');
      await new Promise((resolve) => setTimeout(resolve, Math.min(15_000, 1000 * attempt)));
    }
  }

  const storage = new MediaStorage({ db, config: config.media });
  const notifier = new BackendNotifier({ baseUrl: config.backendBaseUrl, token: config.bridgeToken });
  const manager = new SessionManager({ db, config, storage, notifier });
  const app = createHttpApp({ manager, config });

  const server = app.listen(config.port, config.host, () => {
    log.info(
      {
        port: config.port,
        instance: config.instanceId,
        database: `${config.db.host}:${config.db.port}/${config.db.database}`,
        media_storage: config.media.storage,
        api: config.backendBaseUrl
      },
      'WhatsApp bridge listening'
    );
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      log.error(`port ${config.port} is already in use by another bridge instance; exiting`);
      process.exit(1);
    }
    log.error({ err: err.message }, 'http server error');
  });

  await manager.bootPersisted();
  manager.startReconciler();

  // Free-tier hosts put idle services to sleep, which would drop every socket.
  if (config.publicUrl) {
    const timer = setInterval(() => {
      fetch(`${config.publicUrl}/health`, { signal: AbortSignal.timeout(10_000) }).catch(() => {});
    }, 4 * 60 * 1000);
    timer.unref?.();
  }

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ signal }, 'shutting down: closing sockets and releasing session leases');
    const hardExit = setTimeout(() => process.exit(0), 12_000);
    hardExit.unref?.();
    server.close();
    await manager.shutdown().catch((err) => log.error({ err: err.message }, 'error while stopping sessions'));
    await db.close().catch(() => {});
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  log.error({ err: err.message, stack: err.stack }, 'bridge failed to start');
  process.exit(1);
});
