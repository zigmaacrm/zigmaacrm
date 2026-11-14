import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const BRIDGE_DIR = path.resolve(here, '..');

/**
 * Minimal KEY=VALUE parser so the bridge has no dotenv dependency.
 */
export function parseEnvFile(file) {
  const out = {};
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return out;
  }
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) out[key] = value;
  }
  return out;
}

// Settings the bridge shares with the API. In local development they are read
// from the backend's .env so nothing has to be configured twice.
const SHARED_KEYS = [
  'DATABASE_URL',
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
  'POSTGRES_SERVER',
  'POSTGRES_PORT',
  'POSTGRES_DB',
  'SECRET_KEY',
  'WHATSAPP_BRIDGE_TOKEN',
  'WA_MEDIA_STORAGE',
  'WA_MEDIA_MAX_BYTES',
  'WA_MEDIA_S3_ENDPOINT',
  'WA_MEDIA_S3_REGION',
  'WA_MEDIA_S3_BUCKET',
  'WA_MEDIA_S3_ACCESS_KEY_ID',
  'WA_MEDIA_S3_SECRET_ACCESS_KEY',
  'WA_MEDIA_S3_PREFIX'
];

export function loadEnvFiles(env = process.env, bridgeDir = BRIDGE_DIR) {
  const own = parseEnvFile(path.join(bridgeDir, '.env'));
  for (const [k, v] of Object.entries(own)) {
    if (env[k] === undefined) env[k] = v;
  }
  for (const file of [path.join(bridgeDir, '..', 'backend', '.env'), path.join(bridgeDir, '..', '.env')]) {
    const shared = parseEnvFile(file);
    for (const key of SHARED_KEYS) {
      if (env[key] === undefined && shared[key] !== undefined && shared[key] !== '') env[key] = shared[key];
    }
  }
}

/**
 * Turns the DATABASE_URL used by the API (SQLAlchemy / asyncpg flavoured) into
 * a node-postgres connection config.
 */
export function parseDatabaseUrl(rawUrl, env = process.env) {
  let url = String(rawUrl || '').trim().replace(/[\r\n]/g, '');
  if (!url) {
    if (!env.POSTGRES_PASSWORD) return null;
    return {
      host: env.POSTGRES_SERVER || 'localhost',
      port: Number(env.POSTGRES_PORT || 5432),
      user: env.POSTGRES_USER || 'postgres',
      password: env.POSTGRES_PASSWORD,
      database: env.POSTGRES_DB || 'zigmaa_crm',
      sslMode: null
    };
  }
  const schemeMatch = url.match(/^([a-z0-9+]+):\/\//i);
  if (!schemeMatch) throw new Error('DATABASE_URL is not a valid connection URL');
  const scheme = schemeMatch[1].toLowerCase();
  if (!scheme.startsWith('postgres')) {
    throw new Error(`The WhatsApp bridge requires PostgreSQL (DATABASE_URL uses "${scheme}")`);
  }
  let rest = url.slice(schemeMatch[0].length);

  let query = '';
  const qIdx = rest.indexOf('?');
  if (qIdx !== -1) {
    query = rest.slice(qIdx + 1);
    rest = rest.slice(0, qIdx);
  }

  // Passwords may contain an unescaped "@", so the host part starts at the LAST "@".
  let userInfo = '';
  let hostPart = rest;
  const at = rest.lastIndexOf('@');
  if (at !== -1) {
    userInfo = rest.slice(0, at);
    hostPart = rest.slice(at + 1);
  }
  let user = userInfo;
  let password = '';
  const colon = userInfo.indexOf(':');
  if (colon !== -1) {
    user = userInfo.slice(0, colon);
    password = userInfo.slice(colon + 1);
  }
  const safeDecode = (s) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  };

  let database = '';
  const slash = hostPart.indexOf('/');
  if (slash !== -1) {
    database = hostPart.slice(slash + 1);
    hostPart = hostPart.slice(0, slash);
  }
  let host = hostPart;
  let port = 5432;
  const portMatch = hostPart.match(/^(.*):(\d+)$/);
  if (portMatch) {
    host = portMatch[1];
    port = Number(portMatch[2]);
  }
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);

  const params = new URLSearchParams(query);
  const sslMode = (params.get('sslmode') || params.get('ssl') || '').toLowerCase() || null;

  return {
    host: host || 'localhost',
    port,
    user: safeDecode(user) || 'postgres',
    password: safeDecode(password),
    database: safeDecode(database) || 'postgres',
    sslMode
  };
}

/**
 * @returns {false | 'require' | 'verify'} TLS mode for the database connection.
 */
export function resolveSsl(dbConfig, env = process.env) {
  const override = (env.WA_DB_SSL || env.PGSSLMODE || '').toLowerCase();
  const mode = override || dbConfig.sslMode || '';
  if (['false', '0', 'disable', 'off', 'no', 'allow'].includes(mode)) return false;
  if (['verify-ca', 'verify-full'].includes(mode)) return 'verify';
  if (['true', '1', 'require', 'prefer', 'on', 'yes'].includes(mode)) return 'require';
  const local = ['localhost', '127.0.0.1', '::1', 'db', 'postgres'].includes(dbConfig.host);
  // Hosted Postgres (Render external URL, Supabase, Neon ...) needs TLS; a
  // private-network host name without dots usually does not.
  return !local && dbConfig.host.includes('.') ? 'require' : false;
}

/**
 * The API and the bridge authenticate each other with one shared secret.
 * WHATSAPP_BRIDGE_TOKEN wins; otherwise it is derived from the API's
 * SECRET_KEY so local development needs no extra configuration.
 */
export function deriveBridgeToken(env = process.env) {
  const explicit = (env.WHATSAPP_BRIDGE_TOKEN || '').trim();
  if (explicit) return explicit;
  const secret = (env.SECRET_KEY || 'ZIGMAA_SUPER_SECRET_KEY_2026_PRODUCTION_READY').trim();
  return crypto.createHmac('sha256', secret).update('zigmaa-whatsapp-bridge-v1').digest('hex');
}

function intEnv(env, name, fallback) {
  const n = Number(env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/**
 * The [os, browser, version] identity the linked device registers with.
 *
 * "Desktop" as the browser registers a desktop-class companion, which is what
 * makes the phone send the full chat history.
 *
 * Do NOT use Browsers.macOS('Desktop') / Browsers.windows('Desktop') together
 * with full history sync: Baileys 7 then announces the native macOS / Windows
 * app sub-platform, and WhatsApp's servers close the connection during
 * registration, before a QR code is ever issued (verified against the live
 * service with Baileys 7.0.0-rc14). Any other OS label keeps the web
 * sub-platform and registers normally.
 */
export function resolveBrowser(env = process.env) {
  const raw = (env.WA_BROWSER || '').trim();
  if (raw) {
    const parts = raw.split(',').map((s) => s.trim());
    if (parts.length === 3 && parts.every(Boolean)) return parts;
  }
  return ['Ubuntu', 'Chrome', '22.04.4'];
}

/** True for an identity WhatsApp currently refuses at registration. */
export function isRejectedDesktopIdentity(browser, syncFullHistory) {
  return Boolean(syncFullHistory) && ['Mac OS', 'Windows'].includes(browser[0]) && browser[1] === 'Desktop';
}

export function buildConfig(env = process.env) {
  const db = parseDatabaseUrl(env.DATABASE_URL, env);
  if (!db) {
    throw new Error(
      'DATABASE_URL is not set. The WhatsApp bridge stores sessions, chats and media in PostgreSQL ' +
        'and cannot start without it (set DATABASE_URL to the same database the API uses).'
    );
  }
  const bridgeToken = deriveBridgeToken(env);
  if (!bridgeToken) {
    throw new Error(
      'No bridge credential configured. Set WHATSAPP_BRIDGE_TOKEN (or SECRET_KEY) to the same value the API uses; ' +
        'the bridge refuses to run without authentication.'
    );
  }

  const onRender = Boolean(env.RENDER || env.RENDER_SERVICE_ID);
  const backendBaseUrl = (
    env.FASTAPI_BASE_URL ||
    env.BACKEND_BASE_URL ||
    (onRender ? 'https://zigmaacrm-backend.onrender.com' : 'http://localhost:8000')
  )
    .trim()
    .replace(/\/+$/, '');

  const storage = (env.WA_MEDIA_STORAGE || 'db').trim().toLowerCase();
  if (!['db', 's3'].includes(storage)) {
    throw new Error(`WA_MEDIA_STORAGE must be "db" or "s3" (got "${storage}")`);
  }
  const s3 = {
    endpoint: (env.WA_MEDIA_S3_ENDPOINT || '').trim().replace(/\/+$/, ''),
    region: (env.WA_MEDIA_S3_REGION || 'auto').trim(),
    bucket: (env.WA_MEDIA_S3_BUCKET || '').trim(),
    accessKeyId: (env.WA_MEDIA_S3_ACCESS_KEY_ID || '').trim(),
    secretAccessKey: (env.WA_MEDIA_S3_SECRET_ACCESS_KEY || '').trim(),
    prefix: (env.WA_MEDIA_S3_PREFIX || 'whatsapp').trim().replace(/^\/+|\/+$/g, '')
  };
  if (storage === 's3' && !(s3.endpoint && s3.bucket && s3.accessKeyId && s3.secretAccessKey)) {
    throw new Error(
      'WA_MEDIA_STORAGE=s3 requires WA_MEDIA_S3_ENDPOINT, WA_MEDIA_S3_BUCKET, WA_MEDIA_S3_ACCESS_KEY_ID and WA_MEDIA_S3_SECRET_ACCESS_KEY'
    );
  }

  return {
    port: intEnv(env, 'PORT', 5001),
    host: env.HOST || '0.0.0.0',
    instanceId: `${os.hostname()}:${process.pid}:${crypto.randomBytes(3).toString('hex')}`,
    logLevel: (env.WA_LOG_LEVEL || 'info').toLowerCase(),
    baileysLogLevel: (env.WA_BAILEYS_LOG_LEVEL || 'warn').toLowerCase(),
    bridgeToken,
    backendBaseUrl,
    publicUrl: (env.RENDER_EXTERNAL_URL || env.BRIDGE_PUBLIC_URL || '').trim().replace(/\/+$/, '') || null,
    db: {
      host: db.host,
      port: db.port,
      user: db.user,
      password: db.password,
      database: db.database,
      ssl: resolveSsl(db, env),
      poolMax: intEnv(env, 'WA_DB_POOL_MAX', 8)
    },
    media: {
      storage,
      s3,
      maxBytes: intEnv(env, 'WA_MEDIA_MAX_BYTES', 64 * 1024 * 1024),
      downloadConcurrency: intEnv(env, 'WA_MEDIA_CONCURRENCY', 3),
      downloadTimeoutMs: intEnv(env, 'WA_MEDIA_TIMEOUT_MS', 90_000)
    },
    session: {
      syncFullHistory: (env.WA_SYNC_FULL_HISTORY || 'true').toLowerCase() !== 'false',
      browser: resolveBrowser(env),
      qrTtlMs: intEnv(env, 'WA_QR_TTL_MS', 60_000),
      leaseTtlSeconds: intEnv(env, 'WA_LEASE_TTL_SECONDS', 45),
      heartbeatMs: intEnv(env, 'WA_HEARTBEAT_MS', 15_000)
    }
  };
}
