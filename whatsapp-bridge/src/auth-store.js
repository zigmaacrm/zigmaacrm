import { BufferJSON, initAuthCreds, proto } from '@whiskeysockets/baileys';
import { NOW_UTC } from './db.js';
import { getLogger } from './logger.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const serialize = (value) => JSON.stringify(value, BufferJSON.replacer);
export const deserialize = (text) => JSON.parse(text, BufferJSON.reviver);

async function withRetry(fn, { attempts = 3, baseDelayMs = 200 } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await sleep(baseDelayMs * 2 ** i);
    }
  }
  throw lastErr;
}

/**
 * Baileys authentication state backed by PostgreSQL.
 *
 *   creds -> whatsapp_sessions.creds          (one JSON document)
 *   keys  -> whatsapp_session_keys            (one row per signal key)
 *
 * Unlike useMultiFileAuthState nothing touches the local filesystem, so a
 * container restart, a redeploy or a second replica never loses the pairing,
 * and every ratchet step is durable the moment Baileys commits it.
 *
 * The session row must already exist (the session manager creates it).
 */
export async function usePostgresAuthState(db, sessionId) {
  const log = getLogger({ mod: 'auth-store', session: sessionId });

  const existing = await db.query('SELECT creds FROM whatsapp_sessions WHERE id = $1', [sessionId]);
  if (existing.rowCount === 0) {
    throw new Error(`whatsapp_sessions row ${sessionId} does not exist`);
  }
  let creds;
  let restored = false;
  if (existing.rows[0].creds) {
    try {
      creds = deserialize(existing.rows[0].creds);
      restored = true;
    } catch (err) {
      log.error({ err: err.message }, 'stored credentials are unreadable; starting a fresh pairing');
    }
  }
  if (!creds) creds = initAuthCreds();

  // --- creds: coalescing, strictly ordered writer -------------------------
  // Baileys emits creds.update in bursts. A queued save always serialises the
  // *latest* state when it runs, so bursts collapse into one write and an old
  // snapshot can never overwrite a newer one.
  let chain = Promise.resolve();
  let queued = null;
  let wiped = false;

  const saveCreds = () => {
    if (wiped) return Promise.resolve();
    if (queued) return queued;
    const run = chain.then(async () => {
      queued = null;
      if (wiped) return;
      const json = serialize(creds);
      const res = await withRetry(() =>
        db.query(`UPDATE whatsapp_sessions SET creds = $2, updated_at = ${NOW_UTC} WHERE id = $1`, [sessionId, json])
      );
      if (res.rowCount === 0) {
        log.warn('session row disappeared while saving credentials');
      }
    });
    queued = run;
    chain = run.catch((err) => {
      log.error({ err: err.message }, 'FAILED to persist credentials; will retry on the next update');
    });
    return run;
  };

  /** Resolves once every queued credential write has reached the database. */
  const flush = async () => {
    await chain;
  };

  // --- signal keys --------------------------------------------------------
  const keys = {
    async get(type, ids) {
      const out = {};
      if (!ids || ids.length === 0) return out;
      const res = await withRetry(() =>
        db.query(
          'SELECT key_id, value FROM whatsapp_session_keys WHERE session_id = $1 AND key_type = $2 AND key_id = ANY($3::text[])',
          [sessionId, type, ids.map(String)]
        )
      );
      for (const row of res.rows) {
        let value;
        try {
          value = deserialize(row.value);
        } catch {
          continue;
        }
        if (type === 'app-state-sync-key' && value) {
          value = proto.Message.AppStateSyncKeyData.fromObject(value);
        }
        out[row.key_id] = value;
      }
      return out;
    },

    async set(data) {
      const upTypes = [];
      const upIds = [];
      const upValues = [];
      const delTypes = [];
      const delIds = [];
      for (const type of Object.keys(data)) {
        const entries = data[type] || {};
        for (const id of Object.keys(entries)) {
          const value = entries[id];
          if (value) {
            upTypes.push(type);
            upIds.push(String(id));
            upValues.push(serialize(value));
          } else {
            delTypes.push(type);
            delIds.push(String(id));
          }
        }
      }
      if (upIds.length === 0 && delIds.length === 0) return;
      if (wiped) return;

      await withRetry(() =>
        db.tx(async (client) => {
          if (upIds.length) {
            await client.query(
              `INSERT INTO whatsapp_session_keys (session_id, key_type, key_id, value, updated_at)
               SELECT $1, t.key_type, t.key_id, t.value, ${NOW_UTC}
               FROM unnest($2::text[], $3::text[], $4::text[]) AS t(key_type, key_id, value)
               ON CONFLICT (session_id, key_type, key_id)
               DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
              [sessionId, upTypes, upIds, upValues]
            );
          }
          if (delIds.length) {
            await client.query(
              `DELETE FROM whatsapp_session_keys k
               USING unnest($2::text[], $3::text[]) AS d(key_type, key_id)
               WHERE k.session_id = $1 AND k.key_type = d.key_type AND k.key_id = d.key_id`,
              [sessionId, delTypes, delIds]
            );
          }
        })
      );
    },

    async clear() {
      await db.query('DELETE FROM whatsapp_session_keys WHERE session_id = $1', [sessionId]);
    }
  };

  /**
   * Permanently removes the pairing (credentials + every signal key). Used
   * only when WhatsApp reports the device as logged out, or the user unlinks.
   */
  const wipe = async () => {
    wiped = true;
    await chain.catch(() => {});
    await db.tx(async (client) => {
      await client.query('DELETE FROM whatsapp_session_keys WHERE session_id = $1', [sessionId]);
      await client.query(
        `UPDATE whatsapp_sessions SET creds = NULL, qr = NULL, qr_expires_at = NULL, updated_at = ${NOW_UTC} WHERE id = $1`,
        [sessionId]
      );
    });
  };

  return { state: { creds, keys }, saveCreds, flush, wipe, restored };
}
