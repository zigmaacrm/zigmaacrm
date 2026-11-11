import { getLogger } from './logger.js';

const log = getLogger({ mod: 'notify' });

/**
 * Tells the API "something changed for this session" so its realtime stream
 * wakes up immediately instead of on its next poll tick.
 *
 * This is purely a latency optimisation: the data itself is already committed
 * to PostgreSQL before the ping is sent, so a lost ping (API asleep, different
 * worker, network blip) only delays the UI by a couple of seconds.
 */
export class BackendNotifier {
  constructor({ baseUrl, token, minIntervalMs = 120 }) {
    this.url = `${baseUrl}/api/v1/whatsapp/internal/notify`;
    this.token = token;
    this.minIntervalMs = minIntervalMs;
    this.state = new Map();
    this.failures = 0;
  }

  ping(sessionId) {
    if (!sessionId) return;
    let st = this.state.get(sessionId);
    if (!st) {
      st = { timer: null, inFlight: false, dirty: false };
      this.state.set(sessionId, st);
    }
    if (st.inFlight || st.timer) {
      st.dirty = true;
      return;
    }
    st.timer = setTimeout(() => this._send(sessionId, st), this.minIntervalMs);
    st.timer.unref?.();
  }

  async _send(sessionId, st) {
    st.timer = null;
    st.inFlight = true;
    st.dirty = false;
    try {
      const res = await fetch(this.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` },
        body: JSON.stringify({ session_id: sessionId }),
        signal: AbortSignal.timeout(4000)
      });
      if (!res.ok && this.failures++ % 50 === 0) {
        log.warn({ status: res.status }, 'API rejected a realtime notification');
      }
    } catch (err) {
      if (this.failures++ % 50 === 0) {
        log.debug({ err: err.message }, 'API not reachable for realtime notification (clients fall back to polling)');
      }
    } finally {
      st.inFlight = false;
      if (st.dirty) this.ping(sessionId);
      else this.state.delete(sessionId);
    }
  }
}
