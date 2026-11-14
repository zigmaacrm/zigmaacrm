import { deserialize } from './auth-store.js';
import { NOW_UTC } from './db.js';
import { getLogger } from './logger.js';
import { BridgeError, WASession } from './session.js';

const log = getLogger({ mod: 'manager' });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Process-wide singleton registry: Map<sessionId, WASession>.
 *
 * A session object (and its socket) is created once and then only ever looked
 * up. Status checks, page navigation in the CRM and repeated "connect" calls
 * all resolve to the same live object; nothing in here recreates a socket that
 * already exists.
 */
export class SessionManager {
  constructor({ db, config, storage, notifier }) {
    this.db = db;
    this.config = config;
    this.storage = storage;
    this.notifier = notifier;
    this.sessions = new Map();
    this.creating = new Map();
    this.reconcileTimer = null;
    this.closing = false;
  }

  get(id) {
    const session = this.sessions.get(id);
    return session && !session.removed ? session : null;
  }

  list() {
    return [...this.sessions.values()].filter((s) => !s.removed);
  }

  _build(row) {
    const session = new WASession({
      id: row.id,
      organizationId: row.organization_id,
      userId: row.user_id,
      deps: {
        db: this.db,
        config: this.config,
        storage: this.storage,
        notifier: this.notifier,
        onRemoved: (id) => {
          if (this.sessions.get(id) === session) this.sessions.delete(id);
        }
      }
    });
    this.sessions.set(row.id, session);
    return session;
  }

  /**
   * Idempotent "make sure this user's session is running".
   * Creates the database row on first use, then starts (or simply returns)
   * the singleton session.
   */
  async ensure({ id, organizationId, userId }) {
    if (this.closing) throw new BridgeError(503, 'The WhatsApp gateway is restarting.');
    if (!ID_RE.test(String(id || '')) || !ID_RE.test(String(organizationId || '')) || !ID_RE.test(String(userId || ''))) {
      throw new BridgeError(400, 'session, organization and user ids are required.');
    }
    const live = this.get(id);
    if (live) {
      if (live.organizationId !== organizationId || live.userId !== userId) {
        throw new BridgeError(409, 'This session belongs to a different organization or user.');
      }
      await live.start();
      return live;
    }
    if (this.creating.has(id)) return this.creating.get(id);

    const work = (async () => {
      const res = await this.db.query(
        `INSERT INTO whatsapp_sessions (id, organization_id, user_id, status, desired_state, created_at, updated_at)
         VALUES ($1, $2, $3, 'DISCONNECTED', 'running', ${NOW_UTC}, ${NOW_UTC})
         ON CONFLICT (organization_id, user_id) DO UPDATE SET desired_state = 'running', updated_at = ${NOW_UTC}
         RETURNING id, organization_id, user_id`,
        [id, organizationId, userId]
      );
      const row = res.rows[0];
      if (row.organization_id !== organizationId || row.user_id !== userId) {
        throw new BridgeError(409, 'This session belongs to a different organization or user.');
      }
      const session = this._build(row);
      await session.start();
      return session;
    })().finally(() => this.creating.delete(id));
    this.creating.set(id, work);
    return work;
  }

  /** Unlinks the device and wipes the pairing, whether or not it is running here. */
  async logout(id) {
    let session = this.get(id);
    if (!session) {
      const res = await this.db.query('SELECT id, organization_id, user_id, creds FROM whatsapp_sessions WHERE id = $1', [id]);
      const row = res.rows[0];
      if (!row) return { status: 'LOGGED_OUT' };
      if (!row.creds) {
        await this.db.query(
          `UPDATE whatsapp_sessions SET status = 'LOGGED_OUT', desired_state = 'stopped', qr = NULL, qr_expires_at = NULL,
                  owner_instance = NULL, heartbeat_at = NULL, updated_at = ${NOW_UTC} WHERE id = $1`,
          [id]
        );
        this.notifier.ping(id);
        return { status: 'LOGGED_OUT' };
      }
      // Bring the session up briefly so WhatsApp can be told to remove the device.
      session = this._build(row);
      await session.start().catch(() => {});
      for (let i = 0; i < 24 && session.status !== 'CONNECTED' && !session.removed; i++) await sleep(500);
    }
    if (session.removed) return { status: 'LOGGED_OUT' };
    return session.logout();
  }

  /** Starts every paired session after a process start. */
  async bootPersisted() {
    await this._expireAbandonedQr();
    const res = await this.db.query(
      `SELECT id, organization_id, user_id, creds FROM whatsapp_sessions WHERE desired_state = 'running' AND creds IS NOT NULL`
    );
    let started = 0;
    for (const row of res.rows) {
      if (this.closing) break;
      if (this.sessions.has(row.id)) continue;
      if (!this._isPaired(row.creds)) continue;
      const session = this._build(row);
      session.start().catch((err) => log.error({ session: row.id, err: err.message }, 'failed to start persisted session'));
      started += 1;
      await sleep(250); // do not open dozens of sockets in the same instant
    }
    log.info({ started }, 'persisted sessions resumed');
    return started;
  }

  _isPaired(credsText) {
    try {
      const c = deserialize(credsText);
      return Boolean((c?.registered || c?.account) && c?.me?.id);
    } catch {
      return false;
    }
  }

  /** A QR code nobody scanned must not look "live" after a restart. */
  async _expireAbandonedQr() {
    await this.db.query(
      `UPDATE whatsapp_sessions
       SET status = 'NOT_LINKED', desired_state = 'stopped', qr = NULL, qr_expires_at = NULL, updated_at = ${NOW_UTC}
       WHERE status IN ('SCAN_QR', 'CONNECTING', 'QR_EXPIRED')
         AND (creds IS NULL OR (creds::jsonb #>> '{registered}') IS NULL OR (creds::jsonb #>> '{registered}') != 'true')
         AND updated_at < ${NOW_UTC} - interval '2 minutes'`
    );
  }

  /**
   * Picks up sessions that should be running but are not driven by anyone:
   * a "connect" that was stored while the bridge was asleep, or a session whose
   * previous owner process died.
   */
  async reconcile() {
    if (this.closing) return;
    try {
      await this._expireAbandonedQr();
      const res = await this.db.query(
        `SELECT id, organization_id, user_id, creds, updated_at FROM whatsapp_sessions
         WHERE desired_state = 'running'
           AND (owner_instance IS NULL OR heartbeat_at IS NULL
                OR heartbeat_at < ${NOW_UTC} - make_interval(secs => $1))`,
        [this.config.session.leaseTtlSeconds]
      );
      for (const row of res.rows) {
        if (this.closing) return;
        const existing = this.sessions.get(row.id);
        if (existing && !existing.removed) {
          if (!existing.sock && !existing.reconnectTimer && !existing.startPromise && existing.paired) {
            existing.start().catch(() => {});
          }
          continue;
        }
        const paired = row.creds ? this._isPaired(row.creds) : false;
        const fresh = row.updated_at && Date.now() - new Date(row.updated_at).getTime() < 120_000;
        if (!paired && !fresh) continue;
        log.info({ session: row.id, paired }, 'adopting unattended session');
        this._build(row)
          .start()
          .catch((err) => log.error({ session: row.id, err: err.message }, 'failed to adopt session'));
      }
    } catch (err) {
      log.warn({ err: err.message }, 'reconcile pass failed');
    }
  }

  startReconciler(intervalMs = 20_000) {
    this.reconcileTimer = setInterval(() => this.reconcile(), intervalMs);
    this.reconcileTimer.unref?.();
  }

  /** Graceful shutdown: sockets close, pairings and leases are handed over. */
  async shutdown() {
    this.closing = true;
    if (this.reconcileTimer) clearInterval(this.reconcileTimer);
    await Promise.allSettled(this.list().map((s) => s.stop()));
    this.sessions.clear();
  }
}
