import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { BRIDGE_DIR } from './config.js';
import { getLogger } from './logger.js';

const { Pool, types } = pg;
const log = getLogger({ mod: 'db' });

// TIMESTAMP WITHOUT TIME ZONE columns hold naive UTC everywhere in the CRM.
// node-postgres would otherwise read them as *local* time.
types.setTypeParser(1114, (v) => (v === null ? null : new Date(`${v.replace(' ', 'T')}Z`)));
// BIGINT (message seq, byte sizes) comfortably fits a double for our ranges.
types.setTypeParser(20, (v) => (v === null ? null : Number(v)));

/** SQL expression for "now" as naive UTC, usable in any statement. */
export const NOW_UTC = "timezone('utc', clock_timestamp())";

/** Advisory lock key shared with the API's schema runner. */
export const SCHEMA_LOCK_KEY = 815_001_771;

const TRANSIENT_CONNECT_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
  'ENOTFOUND',
  'EAI_AGAIN',
  '57P03', // cannot_connect_now (database starting up)
  '53300' // too_many_connections
]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createPool(dbConfig) {
  const pool = new Pool({
    host: dbConfig.host,
    port: dbConfig.port,
    user: dbConfig.user,
    password: dbConfig.password,
    database: dbConfig.database,
    ssl: dbConfig.ssl ? { rejectUnauthorized: dbConfig.ssl === 'verify' } : false,
    max: dbConfig.poolMax || 8,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
    keepAlive: true,
    application_name: 'zigmaa-whatsapp-bridge'
  });
  // Without this listener a dropped idle connection (database restart, pooler
  // recycle) would be an unhandled 'error' event and kill every live session.
  pool.on('error', (err) => log.warn({ err: err.message }, 'idle postgres connection dropped'));
  return pool;
}

export class Db {
  constructor(pool) {
    this.pool = pool;
  }

  async _connect() {
    let lastErr;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        return await this.pool.connect();
      } catch (err) {
        lastErr = err;
        const transient =
          TRANSIENT_CONNECT_CODES.has(err.code) || /timeout exceeded when trying to connect/i.test(err.message || '');
        if (!transient) throw err;
        await sleep(250 * 2 ** attempt);
      }
    }
    throw lastErr;
  }

  /** Runs one statement. Only connection *establishment* is retried. */
  async query(text, params) {
    const client = await this._connect();
    try {
      return await client.query(text, params);
    } finally {
      client.release();
    }
  }

  /** Runs `fn(client)` inside a transaction. */
  async tx(fn) {
    const client = await this._connect();
    let broken = false;
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        broken = true;
      }
      throw err;
    } finally {
      client.release(broken ? true : undefined);
    }
  }

  async close() {
    await this.pool.end();
  }
}

const DIRECTIVE_RE = /^--\s*@(requires|once)\s+(.+?)\s*$/i;

/**
 * Splits schema.sql into statements and attaches the "-- @requires" /
 * "-- @once" directives found in the comment lines directly above each one.
 */
export function parseSchema(sqlText) {
  const statements = [];
  let buffer = [];
  let requires = [];
  let once = null;
  for (const line of sqlText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (buffer.length === 0) {
      if (trimmed === '') continue;
      if (trimmed.startsWith('--')) {
        const m = trimmed.match(DIRECTIVE_RE);
        if (m) {
          if (m[1].toLowerCase() === 'requires') {
            requires.push(...m[2].split(',').map((s) => s.trim()).filter(Boolean));
          } else {
            once = m[2].trim();
          }
        }
        continue;
      }
    }
    buffer.push(line);
    if (trimmed.endsWith(';')) {
      const sql = buffer.join('\n').trim().replace(/;$/, '');
      statements.push({ sql, requires, once });
      buffer = [];
      requires = [];
      once = null;
    }
  }
  if (buffer.join('').trim()) {
    throw new Error('schema.sql ends with an unterminated statement');
  }
  return statements;
}

export function readSchemaFile() {
  return fs.readFileSync(path.join(BRIDGE_DIR, 'schema.sql'), 'utf8');
}

/**
 * Applies the WhatsApp schema. Safe to call concurrently from several
 * processes: everything happens in one transaction behind an advisory lock.
 */
export async function applySchema(db, sqlText = readSchemaFile()) {
  const statements = parseSchema(sqlText);
  // Line endings must not change the fingerprint (Windows checkouts use CRLF).
  const fingerprint = `schema:${crypto.createHash('sha256').update(sqlText.replace(/\r\n/g, '\n')).digest('hex').slice(0, 32)}`;

  const applied = await db.tx(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock($1)', [SCHEMA_LOCK_KEY]);

    const metaExists = await client.query("SELECT to_regclass('whatsapp_schema_meta') IS NOT NULL AS ok");
    if (metaExists.rows[0].ok) {
      const current = await client.query('SELECT 1 FROM whatsapp_schema_meta WHERE name = $1', [fingerprint]);
      if (current.rowCount > 0) return false;
    }

    let allPrerequisitesMet = true;
    for (const st of statements) {
      if (st.requires.length) {
        let missing = false;
        for (const table of st.requires) {
          const r = await client.query('SELECT to_regclass($1) IS NOT NULL AS ok', [table]);
          if (!r.rows[0].ok) missing = true;
        }
        if (missing) {
          allPrerequisitesMet = false;
          continue;
        }
      }
      if (st.once) {
        const done = await client.query('SELECT 1 FROM whatsapp_schema_meta WHERE name = $1', [st.once]);
        if (done.rowCount > 0) continue;
      }
      await client.query(st.sql);
      if (st.once) {
        await client.query('INSERT INTO whatsapp_schema_meta (name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [st.once]);
      }
    }
    // Only remember the fingerprint when nothing was skipped, so a statement
    // waiting on a table created by the API later still gets its turn.
    if (allPrerequisitesMet) {
      await client.query('INSERT INTO whatsapp_schema_meta (name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [fingerprint]);
    }
    return true;
  });
  if (applied) log.info('whatsapp schema applied');
  return applied;
}
