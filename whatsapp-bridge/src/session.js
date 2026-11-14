import makeWASocket, {
  Browsers,
  Curve,
  DisconnectReason,
  fetchLatestWaWebVersion,
  generateMessageIDV2,
  jidDecode,
  makeCacheableSignalKeyStore,
  WAMessageStubType
} from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import { usePostgresAuthState } from './auth-store.js';
import { NOW_UTC } from './db.js';
import { chatRefFromJids, digitsOnly, isIgnoredJid, lidJid, parseUserJid, pnJid } from './jid.js';
import { getBaileysLogger, getLogger } from './logger.js';
import { MediaDownloader, transcodeToVoiceNote, waMessageFromRow } from './media.js';
import { editedText, messageFromRow, parseMessage, statusName, toNum } from './message-parser.js';
import { ChatStore } from './store.js';

export class BridgeError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code || null;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const PERSISTABLE = new Set([
  'status',
  'desired_state',
  'phone_number',
  'lid',
  'push_name',
  'platform',
  'avatar_url',
  'qr',
  'qr_expires_at',
  'last_connected_at',
  'last_disconnect_code',
  'last_disconnect_reason',
  'last_disconnect_at',
  'history_sync_status',
  'history_sync_progress',
  'owner_instance',
  'heartbeat_at'
]);

/** Marker for "set this column to the database's current UTC time". */
const SQL_NOW = Symbol('now');

const HISTORY_TYPE_NAMES = {
  0: 'INITIAL_BOOTSTRAP',
  1: 'INITIAL_STATUS',
  2: 'FULL',
  3: 'RECENT',
  4: 'PUSH_NAME',
  5: 'NON_BLOCKING_DATA',
  6: 'ON_DEMAND'
};
const HISTORY_ON_DEMAND = 6;
const HISTORY_RECENT = 3;

/** WhatsApp sends mute expiry as -1 (forever), seconds or milliseconds. */
export function isMuted(muteEndTime, now = Date.now()) {
  const until = toNum(muteEndTime);
  if (until === -1) return true;
  if (until <= 0) return false;
  const untilMs = until > 1e11 ? until : until * 1000;
  return untilMs > now;
}

// WhatsApp Web protocol version. The one bundled with Baileys is used unless
// the server rejects it as outdated (HTTP 405), in which case the current
// web version is fetched once and reused by every session.
let fetchedWaVersion = null;
let versionFetch = null;
async function refreshWaVersion() {
  if (!versionFetch) {
    versionFetch = fetchLatestWaWebVersion({ signal: AbortSignal.timeout(8000) })
      .then((res) => {
        if (res?.isLatest && Array.isArray(res.version)) fetchedWaVersion = res.version;
        return fetchedWaVersion;
      })
      .catch(() => fetchedWaVersion)
      .finally(() => {
        versionFetch = null;
      });
  }
  return versionFetch;
}

/**
 * One linked WhatsApp device for one CRM user.
 *
 * Invariants that keep sessions from dropping:
 *   - exactly one socket per session; `start()` is idempotent and never tears
 *     down a socket that is alive, connecting or scheduled to reconnect
 *   - credentials and signal keys live in PostgreSQL and the in-memory auth
 *     state is reused across reconnects
 *   - the pairing is wiped ONLY when WhatsApp reports the device as logged out
 *     (401) or the user unlinks; every other close reconnects in the background
 *   - a database lease stops two bridge processes (deploy overlap, a stray dev
 *     machine) from fighting over the same account
 */
export class WASession {
  constructor({ id, organizationId, userId, deps }) {
    this.id = id;
    this.organizationId = organizationId;
    this.userId = userId;
    this.db = deps.db;
    this.config = deps.config;
    this.storage = deps.storage;
    this.notifier = deps.notifier;
    this.onRemoved = deps.onRemoved || (() => {});
    this.log = getLogger({ mod: 'session', session: id });

    this.status = 'DISCONNECTED';
    this.sock = null;
    this.generation = 0;
    this.auth = null;
    this.accountId = null;
    this.lid = null;
    this.pushName = null;
    this.platform = null;
    this.avatarUrl = null;
    this.meUsers = new Set();
    this.store = null;
    this.media = null;

    this.qr = null;
    this.latestQrDataUrl = null;
    this.qrTimestamp = 0;
    this.qrWaiters = new Set();
    this.connectingStartedAt = 0;
    this.qrExpiresAt = null;
    this.qrCount = 0;
    this.lastDisconnect = null;
    this.historyStatus = null;
    this.historyProgress = null;

    this.reconnectAttempts = 0;
    this.unpairedFailures = 0;
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this.startPromise = null;
    this.stopping = false;
    this.removed = false;

    this.ingest = Promise.resolve();
    this.persistChain = Promise.resolve();
    this.avatarChain = Promise.resolve();
    this.ownSends = new Map();
  }

  // ------------------------------------------------------------------ //
  // State helpers
  // ------------------------------------------------------------------ //

  get paired() {
    const creds = this.auth?.state?.creds;
    return Boolean((creds?.registered || creds?.account) && creds?.me?.id);
  }

  snapshot() {
    const currentQr = this.status === 'SCAN_QR' ? (this.qr || this.latestQrDataUrl) : null;
    return {
      session_id: this.id,
      organization_id: this.organizationId,
      user_id: this.userId,
      status: this.status,
      phone: this.accountId,
      name: this.pushName,
      avatar_url: this.avatarUrl,
      qr: currentQr,
      qr_code: currentQr,
      qr_expires_at: this.status === 'SCAN_QR' && this.qrExpiresAt ? new Date(this.qrExpiresAt).toISOString() : null,
      qr_timestamp: this.qrTimestamp || null,
      paired: this.paired,
      running: Boolean(this.sock || this.reconnectTimer || this.startPromise),
      last_disconnect: this.lastDisconnect,
      history_sync: this.historyStatus ? { status: this.historyStatus, progress: this.historyProgress } : null
    };
  }

  async _persist(patch) {
    const sets = [];
    const params = [this.id];
    for (const [column, value] of Object.entries(patch)) {
      if (!PERSISTABLE.has(column)) throw new Error(`cannot persist column ${column}`);
      if (value === SQL_NOW) {
        sets.push(`${column} = ${NOW_UTC}`);
      } else if (column === 'qr_expires_at' && value !== null) {
        params.push(Number(value) / 1000);
        sets.push(`${column} = to_timestamp($${params.length}) AT TIME ZONE 'UTC'`);
      } else {
        params.push(value);
        sets.push(`${column} = $${params.length}`);
      }
    }
    if (!sets.length) return;
    sets.push(`updated_at = ${NOW_UTC}`);
    // Chained so state writes reach the database in the order they happened
    // (pooled connections would otherwise let a slow write land last).
    const run = this.persistChain.then(async () => {
      try {
        await this.db.query(`UPDATE whatsapp_sessions SET ${sets.join(', ')} WHERE id = $1`, params);
      } catch (err) {
        this.log.error({ err: err.message }, 'could not persist session state');
      }
    });
    this.persistChain = run;
    await run;
  }

  async _setStatus(status, extra = {}) {
    const changed = this.status !== status;
    this.status = status;
    await this._persist({ status, ...extra });
    if (changed) this.log.info({ status }, 'session status changed');
    this.notifier.ping(this.id);
  }

  _enqueue(fn) {
    const run = this.ingest.then(fn);
    this.ingest = run.catch((err) => {
      this.log.error({ err: err.message, stack: err.stack }, 'event ingestion failed');
    });
    return run;
  }

  // ------------------------------------------------------------------ //
  // Lease: at most one bridge process drives a session
  // ------------------------------------------------------------------ //

  async _acquireLease() {
    const res = await this.db.query(
      `UPDATE whatsapp_sessions
       SET owner_instance = $2, heartbeat_at = ${NOW_UTC}
       WHERE id = $1
         AND (owner_instance IS NULL OR owner_instance = $2 OR heartbeat_at IS NULL
              OR heartbeat_at < ${NOW_UTC} - make_interval(secs => $3))
       RETURNING id`,
      [this.id, this.config.instanceId, this.config.session.leaseTtlSeconds]
    );
    return res.rowCount === 1;
  }

  async _releaseLease() {
    try {
      await this.db.query(
        'UPDATE whatsapp_sessions SET owner_instance = NULL, heartbeat_at = NULL WHERE id = $1 AND owner_instance = $2',
        [this.id, this.config.instanceId]
      );
    } catch (err) {
      this.log.warn({ err: err.message }, 'could not release session lease');
    }
  }

  _startHeartbeat() {
    this._stopHeartbeat();
    this.heartbeatTimer = setInterval(async () => {
      try {
        const mine = await this._acquireLease();
        if (!mine && !this.stopping) {
          this.log.warn('lease taken over by another bridge instance; standing down');
          await this._standDown();
        }
      } catch (err) {
        this.log.warn({ err: err.message }, 'heartbeat failed');
      }
    }, this.config.session.heartbeatMs);
    this.heartbeatTimer.unref?.();
  }

  _stopHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  /** Another instance owns the session: drop our socket and check back later. */
  async _standDown() {
    this._closeSocket();
    this._stopHeartbeat();
    this._scheduleReconnect(this.config.session.leaseTtlSeconds * 500, { count: false });
  }

  // ------------------------------------------------------------------ //
  // Lifecycle
  // ------------------------------------------------------------------ //

  /**
   * Makes sure the session is running. Safe to call on every page load:
   * if a socket exists, is connecting, or a reconnect is scheduled, nothing
   * happens.
   */
  async start() {
    if (this.removed) throw new BridgeError(410, 'This session was unlinked. Start a new one.');
    if (this.sock || this.startPromise || this.reconnectTimer) return this.snapshot();
    this.stopping = false;
    this.startPromise = this._connect().finally(() => {
      this.startPromise = null;
    });
    await this.startPromise;
    return this.snapshot();
  }

  _closeSocket() {
    const sock = this.sock;
    this.sock = null;
    this.connectingStartedAt = 0;
    this.generation += 1; // every event from the old socket is now stale
    if (sock) {
      try {
        sock.end(undefined);
      } catch {
        /* already closed */
      }
    }
  }

  _clearReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  _scheduleReconnect(delayMs, { count = true } = {}) {
    if (this.stopping || this.removed) return;
    this._clearReconnect();
    if (count) this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.stopping || this.removed || this.sock || this.startPromise) return;
      this.startPromise = this._connect().finally(() => {
        this.startPromise = null;
      });
    }, Math.max(0, delayMs));
  }

  _backoffMs() {
    const base = Math.min(30_000, 1000 * 2 ** Math.min(this.reconnectAttempts, 5));
    return base + Math.floor(Math.random() * 500);
  }

  _adoptAccount(me) {
    const pn = me?.id ? digitsOnly(jidDecode(me.id)?.user) : '';
    if (!pn) return false;
    const lid = me.lid ? digitsOnly(jidDecode(me.lid)?.user) : null;
    if (this.accountId !== pn || !this.store) {
      this.media?.stop();
      this.accountId = pn;
      this.store = new ChatStore({ db: this.db, organizationId: this.organizationId, accountId: pn });
      this.media = new MediaDownloader({
        storage: this.storage,
        store: this.store,
        organizationId: this.organizationId,
        accountId: pn,
        getSocket: () => (this.status === 'CONNECTED' ? this.sock : null),
        config: this.config.media,
        onChange: () => this.notifier.ping(this.id),
        logger: getLogger({ mod: 'media', session: this.id })
      });
    }
    this.lid = lid || this.lid;
    this.meUsers = new Set([pn, this.lid].filter(Boolean));
    if (lid) this.store.learnMapping(lid, pn);
    if (me.name && me.name !== '~') this.pushName = String(me.name).slice(0, 255);
    this._persist({ phone_number: pn }).catch(() => {});
    return true;
  }

  async _connect() {
    if (this.stopping || this.removed) return;
    this.connectingStartedAt = Date.now();
    try {
      if (!(await this._acquireLease())) {
        this.log.info('session is owned by another bridge instance; waiting');
        this.status = this.paired ? 'CONNECTING' : this.status;
        this._scheduleReconnect(this.config.session.leaseTtlSeconds * 500, { count: false });
        return;
      }

      if (!this.auth) {
        this.auth = await usePostgresAuthState(this.db, this.id);
        if (this.auth.restored) this.log.info('credentials restored from the database');
      }
      const creds = this.auth.state.creds;
      // Strip provisional/unregistered `me` so Baileys does not attempt bogus stream reconnects
      if (!this.paired && creds.me) {
        delete creds.me;
        delete creds.pairingCode;
        this.accountId = null;
        this.lid = null;
        await this.auth.saveCreds().catch(() => {});
      }
      if (this.paired && creds.me?.id) this._adoptAccount(creds.me);
      if (creds.platform) this.platform = String(creds.platform).slice(0, 64);

      const baileysLog = getBaileysLogger(this.id);
      this.generation += 1;
      const gen = this.generation;
      this.qrCount = 0;

      if (!fetchedWaVersion) {
        try {
          await refreshWaVersion();
        } catch (_) {}
      }
      const waVersion = fetchedWaVersion || [2, 3000, 1054063488];

      const sock = makeWASocket({
        version: waVersion,
        logger: baileysLog,
        auth: { creds, keys: makeCacheableSignalKeyStore(this.auth.state.keys, baileysLog) },
        // Desktop-class companion => the phone sends the full history.
        // See resolveBrowser() in config.js for why this is not macOS('Desktop').
        browser: this.config.session.browser || ['Ubuntu', 'Chrome', '22.04.4'],
        syncFullHistory: this.config.session.syncFullHistory,
        shouldSyncHistoryMessage: () => true,
        // Staying "unavailable" keeps push notifications working on the phone.
        markOnlineOnConnect: false,
        connectTimeoutMs: 30_000,
        defaultQueryTimeoutMs: 60_000,
        keepAliveIntervalMs: 25_000,
        qrTimeout: 180_000,
        generateHighQualityLinkPreview: false,
        // Groups, status, channels and broadcasts are dropped before decryption.
        shouldIgnoreJid: (jid) => isIgnoredJid(jid),
        getMessage: async (key) => (this.store ? this.store.getMessageForRetry(key) : undefined)
      });
      this.sock = sock;
      this._startHeartbeat();
      sock.ev.process((events) => this._onEvents(events, gen, sock));

      if (this.status !== 'CONNECTED') {
        await this._setStatus(this.paired ? 'CONNECTING' : this.status === 'SCAN_QR' ? 'SCAN_QR' : 'CONNECTING', {
          desired_state: 'running',
          ...(this.accountId ? { phone_number: this.accountId } : {})
        });
      }
    } catch (err) {
      this.log.error({ err: err.message }, 'failed to open WhatsApp socket');
      this._closeSocket();
      this._stopHeartbeat();
      this._scheduleReconnect(this._backoffMs());
    }
  }

  _onEvents(events, gen, sock) {
    if (gen !== this.generation || this.sock !== sock) return;

    if (events['creds.update']) {
      // Ordered + coalesced inside the auth store; errors are logged there.
      this.auth.saveCreds().catch(() => {});
    }
    if (events['connection.update']) {
      this._onConnectionUpdate(events['connection.update'], gen, sock).catch((err) => {
        this.log.error({ err: err.message }, 'connection.update handler failed');
      });
    }
    const historyStatus = events['messaging-history.status'];
    if (historyStatus && historyStatus.syncType === HISTORY_RECENT) {
      // Queued behind the chunks themselves so "complete" is recorded last.
      this._enqueue(async () => {
        this.historyStatus = historyStatus.status === 'complete' ? 'COMPLETE' : 'PAUSED';
        if (historyStatus.status === 'complete') this.historyProgress = 100;
        await this._persist({ history_sync_status: this.historyStatus, history_sync_progress: this.historyProgress });
        this.notifier.ping(this.id);
      });
    }

    const hasData =
      events['messaging-history.set'] ||
      events['messages.upsert'] ||
      events['messages.update'] ||
      events['messages.reaction'] ||
      events['chats.upsert'] ||
      events['chats.update'] ||
      events['contacts.upsert'] ||
      events['contacts.update'] ||
      events['lid-mapping.update'] ||
      events['blocklist.set'] ||
      events['blocklist.update'];
    if (hasData) {
      this._enqueue(() => this._ingest(events));
    }
  }

  async _onConnectionUpdate(update, gen, sock) {
    const { connection, lastDisconnect, qr, isNewLogin } = update;

    if (qr) {
      if (this.pairingCode || this.pairingPhone) {
        // Pairing code is active; do not overwrite pairing code state with QR
        return;
      }
      const dataUrl = await QRCode.toDataURL(qr, { width: 320, margin: 2 });
      if (gen !== this.generation) return;
      // Baileys keeps the first code for 60 s and every later one for 20 s.
      const ttl = this.qrCount === 0 ? this.config.session.qrTtlMs : 20_000;
      this.qrCount += 1;
      this.qr = dataUrl;
      this.latestQrDataUrl = dataUrl;
      this.qrTimestamp = Date.now();
      this.qrExpiresAt = Date.now() + ttl;
      await this._setStatus('SCAN_QR', { qr: dataUrl, qr_expires_at: this.qrExpiresAt, desired_state: 'running' });
      this.log.info({ session: this.id }, 'WhatsApp QR code ready for scanning');
      this.notifier.ping(this.id);
      for (const waiter of this.qrWaiters) {
        try { waiter({ status: 'qr_ready', qr_code: dataUrl, qr: dataUrl }); } catch {}
      }
      this.qrWaiters.clear();
    }

    if (isNewLogin) {
      // The phone accepted the code. WhatsApp now closes the stream with 515
      // and expects an immediate reconnect with the new credentials.
      this.log.info({ session: this.id }, 'WhatsApp pairing accepted by phone; establishing connection');
      this.qr = null;
      this.latestQrDataUrl = null;
      this.qrTimestamp = 0;
      this.qrExpiresAt = null;
      if (this.auth.state.creds.me) this._adoptAccount(this.auth.state.creds.me);
      await this.auth?.saveCreds().catch(() => {});
      await this._setStatus('CONNECTING', {
        qr: null,
        qr_expires_at: null,
        desired_state: 'running',
        ...(this.accountId ? { phone_number: this.accountId } : {})
      });
    }

    if (connection === 'open') {
      if (gen !== this.generation) return;
      this.reconnectAttempts = 0;
      this.unpairedFailures = 0;
      this.qr = null;
      this.latestQrDataUrl = null;
      this.qrTimestamp = 0;
      this.qrExpiresAt = null;
      for (const waiter of this.qrWaiters) {
        try { waiter({ status: 'connected', qr_code: null, qr: null }); } catch {}
      }
      this.qrWaiters.clear();
      this._adoptAccount(sock.user || this.auth.state.creds.me);
      if (this.auth.state.creds.platform) this.platform = String(this.auth.state.creds.platform).slice(0, 64);
      this.log.info({ session: this.id, phone: this.accountId, name: this.pushName }, 'WhatsApp connected successfully! Ready to send and receive messages');
      await this._setStatus('CONNECTED', {
        desired_state: 'running',
        phone_number: this.accountId,
        lid: this.lid,
        push_name: this.pushName,
        platform: this.platform,
        qr: null,
        qr_expires_at: null,
        last_connected_at: SQL_NOW,
        last_disconnect_code: null,
        last_disconnect_reason: null
      });
      this.lastDisconnect = null;
      this.log.info({ phone: this.accountId }, 'WhatsApp connected');
      this._afterOpen(sock, gen).catch((err) => this.log.debug({ err: err.message }, 'post-connect tasks failed'));
    }

    if (connection === 'close') {
      await this._onClose(lastDisconnect, gen, sock);
    }
  }

  async _afterOpen(sock, gen) {
    if (this.store) {
      await this.db.query(
        `UPDATE whatsapp_messages SET media_status = 'remote', updated_at = ${NOW_UTC}
         WHERE organization_id = $1 AND session_id = $2 AND media_status = 'pending'
           AND updated_at < ${NOW_UTC} - interval '3 minutes'`,
        [this.organizationId, this.accountId]
      );
    }
    if (this.media) {
      try {
        const recentRes = await this.db.query(
          `SELECT id, raw_message, chat_id, meta_message_id FROM whatsapp_messages
           WHERE organization_id = $1 AND (session_id = $2 OR session_id = $3)
             AND media_status IN ('remote', 'pending')
             AND raw_message IS NOT NULL
           ORDER BY created_at DESC LIMIT 60`,
          [this.organizationId, this.accountId, this.id]
        );
        for (const row of recentRes.rows) {
          const wam = waMessageFromRow(row);
          if (wam) this.media.enqueue(row.id, wam, { priority: false }).catch(() => {});
        }
      } catch (mErr) {
        this.log.debug({ err: mErr.message }, 'failed to auto-enqueue recent media');
      }
    }
    try {
      const url = await sock.profilePictureUrl(pnJid(this.accountId), 'image', 10_000);
      if (gen === this.generation) {
        this.avatarUrl = url || null;
        await this._persist({ avatar_url: this.avatarUrl });
        this.notifier.ping(this.id);
      }
    } catch {
      /* no profile picture, or privacy settings hide it */
    }
  }

  async _onClose(lastDisconnect, gen, sock) {
    if (gen !== this.generation || (this.sock && this.sock !== sock)) return;
    const error = lastDisconnect?.error;
    const code = error?.output?.statusCode ?? error?.statusCode ?? null;
    const reason = String(error?.message || 'connection closed').slice(0, 255);

    this.sock = null;
    this.connectingStartedAt = 0;
    this._stopHeartbeat();
    this.lastDisconnect = { code, reason, at: new Date().toISOString() };
    for (const waiter of this.qrWaiters) {
      try { waiter({ status: 'closed', qr_code: null, qr: null, error: reason }); } catch {}
    }
    this.qrWaiters.clear();
    if (this.stopping || this.removed) return;

    this.log.info({ code, reason, paired: this.paired }, 'WhatsApp connection closed');
    await this.auth?.flush().catch(() => {});
    const record = { last_disconnect_code: code, last_disconnect_reason: reason, last_disconnect_at: SQL_NOW };

    const isConflict = /conflict|replaced/i.test(reason);
    const isRestart = /restart/i.test(reason);
    const isDeviceRemoved =
      error?.fullErrorNode?.content?.[0]?.attrs?.type === 'device_removed' ||
      error?.reasonNode?.attrs?.type === 'device_removed' ||
      /device_removed/i.test(reason) ||
      /device_removed/i.test(JSON.stringify(error || {}));

    // 401: WhatsApp says this device is no longer linked.
    // If device was unlinked by user on phone (device_removed), immediately mark as logged out.
    // WARNING: Baileys wraps stream conflicts in 401 ("Stream Errored (conflict)").
    // True logouts happen only when the user explicitly unlinks the device.
    // Stream collisions or restarts must NEVER destroy the stored pairing!
    // NEVER unpair or wipe credentials during an unconfirmed pairing attempt.
    if (this.paired && (isDeviceRemoved || (code === DisconnectReason.loggedOut && !isConflict && !isRestart))) {
      await this._becomeLoggedOut(record);
      return;
    }

    // The account itself is refused (banned / multi-device unavailable).
    // Retrying cannot help; keep the pairing and wait for the user.
    if (code === DisconnectReason.forbidden || code === DisconnectReason.multideviceMismatch) {
      await this._setStatus('DISCONNECTED', { ...record, desired_state: 'stopped', qr: null, qr_expires_at: null });
      await this._releaseLease();
      return;
    }

    if (!this.paired) {
      this.qr = null;
      this.latestQrDataUrl = null;
      this.qrTimestamp = 0;
      this.qrExpiresAt = null;
      this.pairingCode = null;
      this.pairingPhone = null;
      const qrWasShown = this.qrCount > 0;
      if (isConflict || isRestart || (!qrWasShown && this.unpairedFailures < 5)) {
        // Transient stream collision, restart or initial connect: keep session alive.
        this.unpairedFailures += 1;
        await this._setStatus('CONNECTING', record);
        this._scheduleReconnect(1500 * this.unpairedFailures, { count: false });
        return;
      }
      // Nobody scanned in time. Do not burn QR codes in the background;
      // a new one is generated when the user asks for it.
      this.unpairedFailures = 0;
      await this._setStatus('QR_EXPIRED', { ...record, desired_state: 'stopped', qr: null, qr_expires_at: null });
      await this._releaseLease();
      return;
    }

    // Paired session: always reconnect in the background.
    let delay;
    if (code === DisconnectReason.restartRequired || isRestart) {
      delay = 0; // 515 right after pairing, or a server-requested restart
      this.reconnectAttempts = 0;
    } else if (code === DisconnectReason.connectionReplaced || isConflict) {
      // 440 or stream conflict: another connection used these credentials. Back off so two
      // processes or overlapping sockets do not knock each other out in a tight loop.
      delay = Math.max(5000, this._backoffMs() * 2);
    } else if (code === 405) {
      await refreshWaVersion();
      delay = 2000;
    } else {
      delay = this._backoffMs();
    }
    await this._setStatus('CONNECTING', record);
    this._scheduleReconnect(delay, { count: delay > 0 });
  }

  async _becomeLoggedOut(record = {}, { byUser = false } = {}) {
    this.log.warn(
      byUser ? 'device unlinked by the user; clearing the stored pairing' : 'WhatsApp reported the device as logged out; clearing the stored pairing'
    );
    this._clearReconnect();
    this._stopHeartbeat();
    this.media?.stop();
    try {
      if (this.auth) await this.auth.wipe();
      else {
        await this.db.query('DELETE FROM whatsapp_session_keys WHERE session_id = $1', [this.id]);
        await this.db.query('UPDATE whatsapp_sessions SET creds = NULL WHERE id = $1', [this.id]);
      }
    } catch (err) {
      this.log.error({ err: err.message }, 'failed to wipe credentials');
    }
    this.auth = null;
    this.qr = null;
    this.latestQrDataUrl = null;
    this.qrTimestamp = 0;
    this.connectingStartedAt = 0;
    this.qrExpiresAt = null;
    this.removed = true;
    // The row no longer points at a phone number, so the API stops serving
    // that inbox. The chats themselves stay in the database and reappear if
    // the same number is linked again.
    this.accountId = null;
    this.lid = null;
    this.pushName = null;
    this.avatarUrl = null;
    this.store = null;
    this.historyStatus = null;
    this.historyProgress = null;
    await this._setStatus('LOGGED_OUT', {
      ...record,
      desired_state: 'stopped',
      phone_number: null,
      lid: null,
      push_name: null,
      avatar_url: null,
      qr: null,
      qr_expires_at: null,
      history_sync_status: null,
      history_sync_progress: null,
      owner_instance: null,
      heartbeat_at: null
    });
    this.onRemoved(this.id);
  }

  /** User pressed "Log out": unlink the device on WhatsApp and wipe the pairing. */
  async logout() {
    this.stopping = true;
    this._clearReconnect();
    const sock = this.sock;
    if (sock) {
      try {
        // Tells the phone to remove this linked device, then closes the stream.
        await Promise.race([sock.logout('Unlinked from Zigmaa CRM'), sleep(8000)]);
      } catch (err) {
        this.log.debug({ err: err.message }, 'logout request failed (device may already be unlinked)');
      }
    }
    this._closeSocket();
    await this._becomeLoggedOut(
      {
        last_disconnect_code: DisconnectReason.loggedOut,
        last_disconnect_reason: 'Unlinked by user',
        last_disconnect_at: SQL_NOW
      },
      { byUser: true }
    );
    return this.snapshot();
  }

  /** Process shutdown: close the socket but keep the pairing and intent. */
  async stop() {
    this.stopping = true;
    this._clearReconnect();
    this._stopHeartbeat();
    this.media?.stop();
    this._closeSocket();
    await this.auth?.flush().catch(() => {});
    if (this.paired && this.status !== 'LOGGED_OUT') {
      this.status = 'CONNECTING';
      await this._persist({ status: 'CONNECTING' });
    }
    await this._releaseLease();
  }

  /**
   * Waits for a valid QR code to be available, returning it as quickly as possible.
   * - If a valid cached QR (< 20s old) exists in memory, returns immediately (0ms).
   * - Detects stale sockets stuck in CONNECTING >8s without QR and force-restarts them.
   * - Awaits the Baileys QR event and resolves immediately upon arrival.
   */
  async waitForQr(timeoutMs = 10000) {
    if (this.removed) throw new BridgeError(410, 'This session was unlinked. Start a new one.');
    if (this.paired || this.status === 'CONNECTED') return this.snapshot();

    // If not paired, clear any dangling unconfirmed credentials so Baileys emits a fresh QR
    if (!this.paired && (this.auth?.state?.creds?.me || this.pairingCode)) {
      if (this.auth?.state?.creds) {
        delete this.auth.state.creds.me;
        delete this.auth.state.creds.pairingCode;
        await this.auth.saveCreds().catch(() => {});
      }
      this.accountId = null;
      this.lid = null;
      this.pairingPhone = null;
      this.pairingCode = null;
      if (this.sock) {
        this._closeSocket();
        this._clearReconnect();
      }
    }

    // 1. Instant in-memory cache check (< 20s old)
    if (this.status === 'SCAN_QR' && this.latestQrDataUrl && Date.now() - this.qrTimestamp < 20_000) {
      const snap = this.snapshot();
      return {
        ...snap,
        status: 'SCAN_QR',
        qr: this.latestQrDataUrl,
        qr_code: this.latestQrDataUrl,
        cached: true
      };
    }

    // 2. Stale socket check: stuck in CONNECTING for > 8 seconds without emitting a QR
    if (
      this.sock &&
      this.status === 'CONNECTING' &&
      this.connectingStartedAt > 0 &&
      Date.now() - this.connectingStartedAt > 8000 &&
      !this.latestQrDataUrl
    ) {
      this.log.warn('Stale socket detected (>8s in connecting without QR); force-closing and restarting');
      this._closeSocket();
      this._clearReconnect();
    }

    // 3. Ensure socket is running
    if (!this.sock && !this.startPromise && !this.reconnectTimer) {
      this.unpairedFailures = 0;
      this.stopping = false;
      await this.start();
    }

    // 4. Return immediately if state transitioned to connected or QR during start()
    if (this.paired || this.status === 'CONNECTED') return this.snapshot();
    if (this.latestQrDataUrl && this.status === 'SCAN_QR') {
      const snap = this.snapshot();
      return {
        ...snap,
        status: 'SCAN_QR',
        qr: this.latestQrDataUrl,
        qr_code: this.latestQrDataUrl
      };
    }

    // Fast-path for mocked/headless environments without Baileys event emitter
    if (!this.sock?.ev || timeoutMs <= 0) {
      return this.snapshot();
    }

    // 5. Await first QR event or timeout
    return new Promise((resolve) => {
      let timer = null;
      const waiter = (res) => {
        if (timer) clearTimeout(timer);
        this.qrWaiters.delete(waiter);
        const snap = this.snapshot();
        resolve({
          ...snap,
          status: res?.status === 'qr_ready' ? 'SCAN_QR' : snap.status,
          qr: res?.qr_code || snap.qr,
          qr_code: res?.qr_code || snap.qr_code || snap.qr
        });
      };
      this.qrWaiters.add(waiter);

      timer = setTimeout(() => {
        this.qrWaiters.delete(waiter);
        const snap = this.snapshot();
        resolve({
          ...snap,
          timeout: true
        });
      }, timeoutMs);
    });
  }

  /**
   * Asks for a fresh QR code. Does nothing while a code is still valid, while
   * the phone is completing the pairing, or once the device is linked, so a
   * UI refresh can never interrupt a login in progress.
   */
  async requestQr(timeoutMs = 10000) {
    return this.waitForQr(timeoutMs);
  }

  async requestPairingCode(phoneNumber) {
    const clean = String(phoneNumber || '').replace(/[^0-9]/g, '');
    if (!clean || clean.length < 8) throw new BridgeError(400, 'Invalid phone number for pairing code');

    if (this.paired) {
      return { status: 'connected', phone: this.accountId };
    }

    this.pairingPhone = clean;
    this.pairingCode = null;

    // 1. Wipe any stale unpaired state to start completely clean
    this._closeSocket();
    this._clearReconnect();
    await this.db.query('DELETE FROM whatsapp_session_keys WHERE session_id = $1', [this.id]);
    await this.db.query("UPDATE whatsapp_sessions SET creds = NULL, qr = NULL, status = 'CONNECTING' WHERE id = $1", [this.id]);
    this.auth = null;

    // 2. Connect fresh socket with standard browser identity
    this.startPromise = this._connect();
    await this.startPromise;
    this.startPromise = null;

    // 3. Wait until socket WS is open and requestPairingCode is ready
    let attempts = 0;
    while ((!this.sock?.ws || this.sock.ws.isClosed || !this.sock.requestPairingCode) && attempts < 40) {
      await new Promise((r) => setTimeout(r, 250));
      attempts++;
    }
    if (!this.sock?.requestPairingCode) throw new BridgeError(500, 'WhatsApp socket failed to initialize');

    // Brief stabilization pause
    await new Promise((r) => setTimeout(r, 500));

    try {
      const code = await this.sock.requestPairingCode(clean);
      this.pairingPhone = clean;
      this.pairingCode = code;
      await this._setStatus('CONNECTING', { desired_state: 'running', phone_number: clean });
      this.log.info({ phone: clean, code }, 'WhatsApp pairing code generated successfully');
      return { status: 'pairing_code', pairing_code: code, phone: clean };
    } catch (err) {
      this.log.error({ err: err.message, phone: clean }, 'Pairing code generation error');
      throw new BridgeError(502, `Failed to generate pairing code: ${err.message}. Please use the QR Code scan tab.`, 'PAIRING_FAILED');
    }
  }

  // ------------------------------------------------------------------ //
  // Event ingestion
  // ------------------------------------------------------------------ //

  async _ingest(events) {
    const store = this.store;
    if (!store) return;
    let touched = false;

    const mapping = events['lid-mapping.update'];
    if (mapping) {
      await this._learnMappings(Array.isArray(mapping) ? mapping : [mapping]);
    }
    if (events['messaging-history.set']) {
      await this._ingestHistory(events['messaging-history.set']);
      touched = true;
    }
    for (const name of ['contacts.upsert', 'contacts.update']) {
      if (events[name]?.length) {
        touched = (await this._ingestContacts(events[name])) || touched;
      }
    }
    for (const name of ['chats.upsert', 'chats.update']) {
      if (events[name]?.length) {
        touched = (await this._ingestChatState(events[name])) || touched;
      }
    }
    if (events['messages.upsert']?.messages?.length) {
      touched = (await this._ingestLiveMessages(events['messages.upsert'].messages)) || touched;
    }
    if (events['messages.update']?.length) {
      touched = (await this._ingestMessageUpdates(events['messages.update'])) || touched;
    }
    if (events['messages.reaction']?.length) {
      for (const { key, reaction } of events['messages.reaction']) {
        if (!key?.id || isIgnoredJid(key.remoteJid)) continue;
        const side = reaction?.key?.fromMe ? 'me' : 'them';
        touched = (await store.applyReaction(String(key.id), side, reaction?.text || '')) > 0 || touched;
      }
    }
    const blocked = events['blocklist.set']?.blocklist || null;
    const blockDelta = events['blocklist.update'] || null;
    if (blocked || blockDelta) {
      touched = (await this._ingestBlocklist(blocked, blockDelta)) || touched;
    }

    if (touched) this.notifier.ping(this.id);
  }

  async _learnMappings(pairs) {
    const refs = [];
    for (const pair of pairs) {
      const ref = chatRefFromJids(pair?.pn, pair?.lid);
      if (ref?.pn && ref.lid && this.store.learnMapping(ref.lid, ref.pn)) refs.push(ref);
    }
    // Promote / merge chats that were stored under the LID before it was known.
    if (refs.length) await this.store.resolveChats(refs, { create: false });
    return refs.length;
  }

  async _ingestContacts(contacts) {
    const entries = [];
    const mappings = [];
    for (const c of contacts) {
      const ref = chatRefFromJids(c?.id, c?.lid, c?.phoneNumber);
      if (!ref) continue;
      if (ref.pn && ref.lid) mappings.push({ pn: pnJid(ref.pn), lid: lidJid(ref.lid) });
      if (c.name || c.notify || c.verifiedName) {
        entries.push({ pn: ref.pn, lid: ref.lid, name: c.name, notify: c.notify, verified: c.verifiedName });
      }
    }
    if (mappings.length) await this._learnMappings(mappings);
    const changed = entries.length ? await this.store.applyNames(entries) : 0;
    return changed > 0;
  }

  async _ingestChatState(updates) {
    const wanted = [];
    for (const u of updates) {
      const ref = chatRefFromJids(u?.id, u?.lidJid, u?.pnJid);
      if (!ref) continue;
      const state = {};
      if (typeof u.archived === 'boolean') state.archived = u.archived;
      if ('pinned' in u) state.pinned = toNum(u.pinned) > 0;
      if ('muteEndTime' in u) state.muted = isMuted(u.muteEndTime);
      // Counts are derived from the messages we store; only "read" (0) and
      // "marked unread" (-1) coming from the phone are applied.
      if (u.unreadCount === 0) state.unread = 0;
      else if (typeof u.unreadCount === 'number' && u.unreadCount < 0) state.markUnread = true;
      if (Object.keys(state).length) wanted.push({ ref, state });
    }
    if (!wanted.length) return false;
    const resolved = await this.store.resolveChats(
      wanted.map((w) => w.ref),
      { create: false }
    );
    const rows = wanted
      .map((w) => ({ chatId: this.store.lookup(resolved, w.ref), ...w.state }))
      .filter((r) => r.chatId);
    if (rows.length) await this.store.applyChatState(rows);
    return rows.length > 0;
  }

  async _ingestBlocklist(fullList, delta) {
    const apply = async (jids, blocked) => {
      const refs = jids.map((j) => chatRefFromJids(j)).filter(Boolean);
      if (!refs.length) return 0;
      const resolved = await this.store.resolveChats(refs, { create: false });
      const rows = refs.map((ref) => ({ chatId: this.store.lookup(resolved, ref), blocked })).filter((r) => r.chatId);
      if (rows.length) await this.store.applyChatState(rows);
      return rows.length;
    };
    let n = 0;
    if (fullList) n += await apply(fullList, true);
    if (delta?.blocklist?.length) n += await apply(delta.blocklist, delta.type === 'add');
    return n > 0;
  }

  /** Parses raw WAMessages into store records for 1-to-1 chats only. */
  _parseBatch(messages) {
    const records = [];
    for (const msg of messages) {
      const key = msg?.key;
      if (!key?.remoteJid || isIgnoredJid(key.remoteJid)) continue;
      const ref = chatRefFromJids(key.remoteJid, key.remoteJidAlt);
      if (!ref) continue;
      let rec;
      try {
        rec = parseMessage(msg, this.meUsers);
      } catch (err) {
        this.log.warn({ err: err.message }, 'could not parse a message; skipped');
        continue;
      }
      if (!rec) continue;
      rec.ref = ref;
      rec.wam = msg;
      records.push(rec);
    }
    return records;
  }

  async _attachChats(records, extraRefs = []) {
    const resolved = await this.store.resolveChats([...records.map((r) => r.ref), ...extraRefs], { create: true });
    for (const rec of records) {
      rec.chatId = this.store.lookup(resolved, rec.ref);
      rec.phone = this.store.completeRef(rec.ref).pn;
    }
    return resolved;
  }

  async _ingestLiveMessages(messages) {
    const records = this._parseBatch(messages);
    if (!records.length) return false;
    await this._attachChats(records);

    const names = records
      .filter((r) => !r.fromMe && (r.pushName || r.verifiedName))
      .map((r) => ({ pn: r.ref.pn, lid: r.ref.lid, notify: r.pushName, verified: r.verifiedName }));
    if (names.length) await this.store.applyNames(names);

    const extras = new Map();
    for (const rec of records) {
      const own = this.ownSends.get(rec.waId);
      if (own) extras.set(rec.waId, own);
    }
    const saved = await this.store.saveMessages(records, { source: 'live', live: true, extras });

    const byWaId = new Map(records.map((r) => [r.waId, r]));
    for (const row of saved) {
      if (row.media_status !== 'pending') continue;
      const rec = byWaId.get(row.wa_id);
      if (rec?.wam?.message) this.media.enqueue(row.id, { key: rec.wam.key, message: rec.wam.message });
    }
    return saved.length > 0;
  }

  async _ingestMessageUpdates(updates) {
    const statuses = [];
    const revoked = [];
    const edits = [];
    for (const { key, update } of updates) {
      if (!key?.id || !update || isIgnoredJid(key.remoteJid)) continue;
      if (update.messageStubType === WAMessageStubType.REVOKE || ('message' in update && update.message === null)) {
        revoked.push(String(key.id));
        continue;
      }
      if (update.message?.editedMessage) {
        const edit = editedText(update.message);
        if (edit) edits.push({ waId: String(key.id), ...edit });
      }
      if (update.status !== undefined && update.status !== null) {
        const status = statusName(update.status);
        if (status) statuses.push({ waId: String(key.id), status });
      }
    }
    let touched = false;
    if (statuses.length) touched = (await this.store.applyStatuses(statuses)) > 0 || touched;
    for (const edit of edits) touched = (await this.store.applyEdit(edit.waId, edit)) > 0 || touched;
    if (revoked.length) {
      const mediaIds = await this.store.markRevoked(revoked);
      if (mediaIds?.length) {
        await this.storage.remove({ organizationId: this.organizationId, accountId: this.accountId, mediaIds }).catch(() => {});
      }
      touched = true;
    }
    return touched;
  }

  async _ingestHistory(history) {
    const { chats = [], contacts = [], messages = [], lidPnMappings = [], syncType, progress } = history;
    const store = this.store;

    if (lidPnMappings.length) await this._learnMappings(lidPnMappings);
    if (contacts.length) await this._ingestContacts(contacts);

    const chatInfos = [];
    for (const chat of chats) {
      const ref = chatRefFromJids(chat?.id, chat?.pnJid, chat?.lidJid);
      if (ref) chatInfos.push({ ref, chat });
    }

    const records = this._parseBatch(messages);
    // Only conversations that actually exist on the phone become chats; the
    // address book is never turned into rows.
    const active = chatInfos.filter(
      (ci) => toNum(ci.chat.conversationTimestamp) > 0 || toNum(ci.chat.lastMsgTimestamp) > 0 || ci.chat.messages?.length
    );
    const resolved = await this._attachChats(
      records,
      active.map((ci) => ci.ref)
    );

    const names = [];
    for (const ci of chatInfos) {
      const name = ci.chat.displayName || ci.chat.name;
      if (name) names.push({ pn: ci.ref.pn, lid: ci.ref.lid, name });
    }
    if (names.length) await store.applyNames(names);

    if (records.length) {
      await store.saveMessages(records, { source: 'history', live: false });
    }

    if (syncType !== HISTORY_ON_DEMAND) {
      const states = [];
      for (const ci of active) {
        const chatId = store.lookup(resolved, ci.ref);
        if (!chatId) continue;
        const unread = toNum(ci.chat.unreadCount);
        states.push({
          chatId,
          unread: unread >= 0 ? unread : undefined,
          markUnread: unread < 0 || ci.chat.markedAsUnread === true,
          archived: Boolean(ci.chat.archived),
          pinned: toNum(ci.chat.pinned) > 0,
          muted: isMuted(ci.chat.muteEndTime)
        });
      }
      if (states.length) await store.applyChatState(states);
    }

    this.historyStatus = HISTORY_TYPE_NAMES[syncType] || 'SYNCING';
    this.historyProgress = typeof progress === 'number' ? progress : this.historyProgress;
    await this._persist({ history_sync_status: this.historyStatus, history_sync_progress: this.historyProgress });
    this.log.info(
      { type: this.historyStatus, progress, chats: active.length, messages: records.length },
      'history chunk stored'
    );
    this.notifier.ping(this.id);
  }

  // ------------------------------------------------------------------ //
  // Commands
  // ------------------------------------------------------------------ //

  _requireSocket() {
    if (!this.sock || this.status !== 'CONNECTED' || !this.store) {
      throw new BridgeError(409, 'WhatsApp is not connected for this account right now.', 'NOT_CONNECTED');
    }
    return this.sock;
  }

  async _requireChat(chatId) {
    const chat = await this.store.getChat(chatId);
    if (!chat) throw new BridgeError(404, 'Chat not found for this WhatsApp account.');
    const jid = chat.phone_number ? pnJid(chat.phone_number) : chat.lid ? lidJid(chat.lid) : null;
    if (!jid) throw new BridgeError(409, 'This chat has no WhatsApp address.');
    return { chat, jid };
  }

  _keyForRow(row, fallbackJid) {
    return {
      remoteJid: row.remote_jid || fallbackJid,
      id: row.meta_message_id,
      fromMe: row.from_me ?? row.direction === 'OUTBOUND'
    };
  }

  /**
   * Sends a message from the CRM.
   * @param p { chatId, text, mediaId, voiceNote, quotedMessageId, contact, clientRef, senderUserId }
   */
  async sendMessage(p) {
    const sock = this._requireSocket();
    const { chat, jid } = await this._requireChat(p.chatId);
    const text = typeof p.text === 'string' ? p.text : '';
    const extra = { source: 'crm', senderUserId: p.senderUserId || null, clientRef: p.clientRef || null };
    let content;

    if (p.mediaId) {
      const scope = { organizationId: this.organizationId, accountId: this.accountId };
      const info = await this.storage.describe({ ...scope, mediaId: p.mediaId });
      if (!info) throw new BridgeError(404, 'Uploaded file not found.');
      const mime = String(info.mimeType || 'application/octet-stream');
      const base = mime.split(';')[0].trim().toLowerCase();
      const caption = text.trim() || undefined;
      extra.mediaId = info.id;
      extra.mimeType = mime;
      extra.fileName = info.fileName;
      extra.mediaSize = info.size;

      if (base.startsWith('audio/')) {
        const media = await this.storage.get({ ...scope, mediaId: p.mediaId });
        if (!media) throw new BridgeError(404, 'Uploaded file not found.');
        // Browsers record webm/opus or mp4/aac. WhatsApp only renders a voice
        // note for OGG/Opus, and cannot play webm at all, so those are converted.
        const mustConvert = Boolean(p.voiceNote) || base === 'audio/webm';
        const ogg = mustConvert ? await transcodeToVoiceNote(media.buffer) : null;
        if (ogg) {
          // Keep what was actually sent, so the CRM plays the same file the contact receives.
          const stored = await this.storage.put({
            ...scope,
            buffer: ogg,
            mimeType: 'audio/ogg; codecs=opus',
            fileName: p.voiceNote ? 'voice-note.ogg' : 'audio.ogg'
          });
          await this.storage.remove({ ...scope, mediaIds: [media.id] }).catch(() => {});
          extra.mediaId = stored.id;
          extra.mimeType = stored.mimeType;
          extra.fileName = stored.fileName;
          extra.mediaSize = stored.size;
          content = { audio: ogg, ptt: Boolean(p.voiceNote), mimetype: 'audio/ogg; codecs=opus' };
        } else if (base === 'audio/webm') {
          // Conversion unavailable: deliver it as a file rather than as audio nobody can play.
          content = { document: media.buffer, mimetype: 'audio/webm', fileName: media.fileName || 'audio.webm' };
        } else {
          content = { audio: media.buffer, ptt: false, mimetype: mime };
        }
      } else {
        // Buffer for database storage, { url } (pre-signed) for object storage.
        const source = await this.storage.sendSource({ ...scope, mediaId: p.mediaId });
        if (!source) throw new BridgeError(404, 'Uploaded file not found.');
        if (base === 'image/webp') {
          content = { sticker: source };
        } else if (base.startsWith('image/')) {
          content = { image: source, caption, mimetype: base };
        } else if (base.startsWith('video/')) {
          content = { video: source, caption, mimetype: base };
        } else {
          content = { document: source, mimetype: base, fileName: info.fileName || 'file', caption };
        }
      }
    } else if (p.contact?.vcard) {
      const displayName = String(p.contact.name || 'Contact').slice(0, 255);
      content = { contacts: { displayName, contacts: [{ displayName, vcard: String(p.contact.vcard) }] } };
    } else {
      if (!text.trim()) throw new BridgeError(400, 'Message text is empty.');
      content = { text };
    }

    const options = { messageId: generateMessageIDV2(sock.user?.id) };
    if (p.quotedMessageId) {
      const quotedRow = await this.store.getMessageRow(p.quotedMessageId);
      if (quotedRow?.meta_message_id && quotedRow.chat_id === chat.id) {
        options.quoted = {
          key: this._keyForRow(quotedRow, jid),
          message: messageFromRow(quotedRow) || { conversation: '' }
        };
      }
    }

    // Registered before sending, so the echo Baileys emits for our own message
    // is recognised and not downloaded again.
    this.ownSends.set(options.messageId, extra);
    const forget = setTimeout(() => this.ownSends.delete(options.messageId), 120_000);
    forget.unref?.();

    let sent;
    try {
      sent = await sock.sendMessage(jid, content, options);
    } catch (err) {
      this.ownSends.delete(options.messageId);
      throw new BridgeError(502, `WhatsApp did not accept the message: ${err.message}`, 'SEND_FAILED');
    }
    if (!sent?.key?.id) throw new BridgeError(502, 'WhatsApp did not return a message id.', 'SEND_FAILED');
    if (sent.message) this.store.rememberSent(sent.key.id, sent.message);

    const row = await this._enqueue(async () => {
      const rec = parseMessage(sent, this.meUsers);
      if (!rec) return null;
      rec.chatId = chat.id;
      rec.phone = chat.phone_number || null;
      rec.remoteJid = sent.key.remoteJid || jid;
      rec.status = 'SENT'; // the stanza reached WhatsApp's server
      const saved = await this.store.saveMessages([rec], {
        source: 'crm',
        live: true,
        extras: new Map([[rec.waId, extra]])
      });
      return saved[0] || null;
    });
    this.notifier.ping(this.id);
    return { id: row?.id || null, wa_message_id: sent.key.id, chat_id: chat.id };
  }

  async _messageContext(messageId) {
    const row = await this.store.getMessageRow(messageId);
    if (!row?.meta_message_id || !row.chat_id) throw new BridgeError(404, 'Message not found.');
    const { jid } = await this._requireChat(row.chat_id);
    return { row, jid, key: this._keyForRow(row, jid) };
  }

  async react(messageId, emoji) {
    const sock = this._requireSocket();
    const { row, jid, key } = await this._messageContext(messageId);
    const text = typeof emoji === 'string' ? emoji.slice(0, 16) : '';
    await sock.sendMessage(jid, { react: { text, key } });
    await this._enqueue(() => this.store.applyReaction(row.meta_message_id, 'me', text));
    this.notifier.ping(this.id);
    return { ok: true };
  }

  async editMessage(messageId, text) {
    const sock = this._requireSocket();
    const { row, jid, key } = await this._messageContext(messageId);
    if (!key.fromMe) throw new BridgeError(403, 'Only your own messages can be edited.');
    const body = String(text || '').trim();
    if (!body) throw new BridgeError(400, 'Edited text is empty.');
    await sock.sendMessage(jid, { text: body, edit: key });
    await this._enqueue(() => this.store.applyEdit(row.meta_message_id, { body, caption: null }));
    this.notifier.ping(this.id);
    return { ok: true };
  }

  async revokeMessage(messageId) {
    const sock = this._requireSocket();
    const { row, jid, key } = await this._messageContext(messageId);
    if (!key.fromMe) throw new BridgeError(403, 'Only your own messages can be deleted for everyone.');
    await sock.sendMessage(jid, { delete: key });
    const mediaIds = await this._enqueue(() => this.store.markRevoked([row.meta_message_id]));
    if (mediaIds?.length) {
      await this.storage.remove({ organizationId: this.organizationId, accountId: this.accountId, mediaIds }).catch(() => {});
    }
    this.notifier.ping(this.id);
    return { ok: true };
  }

  /** Sends read receipts (blue ticks) for the newest unread incoming messages. */
  async markRead(chatId, count = 1) {
    const sock = this._requireSocket();
    const { jid } = await this._requireChat(chatId);
    const limit = Math.max(1, Math.min(100, Number(count) || 1));
    const rows = await this.store.recentMessageRows(chatId, { limit, inboundOnly: true });
    const unread = rows.filter((r) => r.status !== 'READ');
    if (!unread.length) return { ok: true, receipts: 0 };
    await sock.readMessages(unread.map((r) => ({ remoteJid: r.remote_jid || jid, id: r.meta_message_id, fromMe: false })));
    await this.db.query(
      `UPDATE whatsapp_messages SET status = 'READ', updated_at = ${NOW_UTC}
       WHERE id = ANY($1::text[]) AND organization_id = $2 AND session_id = $3`,
      [unread.map((r) => r.id), this.organizationId, this.accountId]
    );
    return { ok: true, receipts: unread.length };
  }

  /** Mirrors pin / archive onto the phone. */
  async modifyChat(chatId, { pin, archive }) {
    const sock = this._requireSocket();
    const { jid } = await this._requireChat(chatId);
    if (typeof pin === 'boolean') {
      await sock.chatModify({ pin }, jid);
    }
    if (typeof archive === 'boolean') {
      const [last] = await this.store.recentMessageRows(chatId, { limit: 1 });
      if (!last?.timestamp) throw new BridgeError(409, 'An empty chat cannot be archived.');
      await sock.chatModify(
        {
          archive,
          lastMessages: [{ key: this._keyForRow(last, jid), messageTimestamp: Math.floor(new Date(last.timestamp).getTime() / 1000) }]
        },
        jid
      );
    }
    return { ok: true };
  }

  async setBlocked(chatId, blocked) {
    const sock = this._requireSocket();
    const { chat, jid } = await this._requireChat(chatId);
    await sock.updateBlockStatus(jid, blocked ? 'block' : 'unblock');
    await this._enqueue(() => this.store.applyChatState([{ chatId: chat.id, blocked: Boolean(blocked) }]));
    this.notifier.ping(this.id);
    return { ok: true, blocked: Boolean(blocked) };
  }

  /** Fetches a media file that was not downloaded yet (history, or a failed attempt). */
  async downloadMedia(messageId) {
    this._requireSocket();
    const row = await this.store.getMessageRow(messageId);
    if (!row) throw new BridgeError(404, 'Message not found.');
    if (row.media_status === 'ready' && row.media_id) return { status: 'ready', mediaId: row.media_id, media_id: row.media_id };
    const waMessage = waMessageFromRow(row);
    if (!waMessage) {
      await this.store.setMediaResult(row.id, { status: 'unavailable', error: 'No download information was stored for this file' });
      this.notifier.ping(this.id);
      return { status: 'unavailable' };
    }
    if (!waMessage.key.remoteJid) {
      const { jid } = await this._requireChat(row.chat_id);
      waMessage.key.remoteJid = jid;
    }
    await this.store.setMediaResult(row.id, { status: 'pending' });
    this.notifier.ping(this.id);
    try {
      await this.media.enqueue(row.id, waMessage, { priority: true });
    } catch (err) {
      this.log.warn({ err: err?.message, messageId }, 'downloadMedia failed');
    }
    const updated = await this.store.getMessageRow(messageId);
    return {
      status: updated?.media_status || 'ready',
      mediaId: updated?.media_id || null,
      media_id: updated?.media_id || null
    };
  }

  /** Refreshes a chat's profile picture (WhatsApp's URLs expire after a while). */
  async refreshAvatar(chatId) {
    const sock = this._requireSocket();
    const { chat, jid } = await this._requireChat(chatId);
    const run = this.avatarChain.then(async () => {
      let url = null;
      try {
        url = (await sock.profilePictureUrl(jid, 'image', 10_000)) || null;
      } catch {
        url = null; // hidden by privacy settings, or no picture
      }
      await this.store.setChatAvatar(chat.id, url);
      await sleep(200); // stay well under WhatsApp's rate limit
      return url;
    });
    this.avatarChain = run.catch(() => {});
    const url = await run;
    this.notifier.ping(this.id);
    return { avatar_url: url };
  }

  /** Is this phone number on WhatsApp, and what is its canonical address? */
  async checkNumber(phone) {
    const sock = this._requireSocket();
    const digits = digitsOnly(phone);
    if (digits.length < 7 || digits.length > 15) throw new BridgeError(400, 'Enter the number with its country code.');
    const res = await sock.onWhatsApp(digits);
    const hit = (res || []).find((r) => r?.exists);
    if (!hit) return { exists: false, phone: digits };
    const parsed = parseUserJid(hit.jid);
    return { exists: true, phone: parsed?.kind === 'pn' ? parsed.user : digits, jid: hit.jid };
  }

  /** Asks the phone for messages older than the oldest one stored for a chat. */
  async requestOlderHistory(chatId, count = 50) {
    const sock = this._requireSocket();
    const { jid } = await this._requireChat(chatId);
    const res = await this.db.query(
      `SELECT meta_message_id, remote_jid, from_me, direction, timestamp FROM whatsapp_messages
       WHERE chat_id = $1 AND organization_id = $2 AND session_id = $3 AND meta_message_id IS NOT NULL
       ORDER BY timestamp ASC NULLS LAST, seq ASC NULLS LAST LIMIT 1`,
      [chatId, this.organizationId, this.accountId]
    );
    const oldest = res.rows[0];
    if (!oldest?.timestamp) throw new BridgeError(409, 'No message to anchor the history request on.');
    const requestId = await sock.fetchMessageHistory(
      Math.max(1, Math.min(100, Number(count) || 50)),
      this._keyForRow(oldest, jid),
      new Date(oldest.timestamp).getTime()
    );
    return { ok: true, request_id: requestId || null };
  }
}
