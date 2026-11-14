import crypto from 'node:crypto';
import { NOW_UTC } from './db.js';
import { canonicalJid, pnJid } from './jid.js';
import { getLogger } from './logger.js';
import { messageFromRow, reactionDisplay } from './message-parser.js';

const CHUNK = 400;
const NAME_CACHE_LIMIT = 50_000;
const RECENT_SENT_LIMIT = 500;

/** SQL fragment ranking delivery states so a status can only move forward. */
const statusRank = (expr) =>
  `(CASE ${expr} WHEN 'PENDING' THEN 0 WHEN 'FAILED' THEN 1 WHEN 'SENT' THEN 2 WHEN 'DELIVERED' THEN 3 WHEN 'READ' THEN 4 ELSE 2 END)`;

const chunked = (list, size = CHUNK) => {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

const cleanName = (value) => {
  if (typeof value !== 'string') return null;
  const s = value.replace(/[\u0000-\u001f]/g, ' ').trim();
  return s ? s.slice(0, 255) : null;
};

const refKey = (ref) => (ref.pn ? `pn:${ref.pn}` : `lid:${ref.lid}`);

/**
 * All chat / message persistence for ONE linked WhatsApp account.
 *
 * Every statement is scoped by (organization_id, session_id) where session_id
 * is the connected phone number, so two tenants, or two numbers of one tenant,
 * can never read or write each other's rows. Nothing here ever touches the CRM
 * contacts / leads tables.
 *
 * Callers must serialise writes per account (the session does, through its
 * ingest queue); the LID <-> phone merge logic relies on that.
 */
export class ChatStore {
  constructor({ db, organizationId, accountId }) {
    if (!organizationId || !accountId) throw new Error('ChatStore needs an organization and an account');
    this.db = db;
    this.org = organizationId;
    this.account = accountId;
    this.log = getLogger({ mod: 'store', account: accountId });

    this.chatByPn = new Map();
    this.chatByLid = new Map();
    this.lidToPn = new Map();
    this.pnToLid = new Map();
    this.names = new Map();
    this.recentSent = new Map();
  }

  // --------------------------------------------------------------------- //
  // LID <-> phone number mapping (strictly per account)
  // --------------------------------------------------------------------- //

  /** Records a mapping. Returns true when it is new information. */
  learnMapping(lid, pn) {
    if (!lid || !pn) return false;
    if (this.lidToPn.get(lid) === pn) return false;
    this.lidToPn.set(lid, pn);
    this.pnToLid.set(pn, lid);
    return true;
  }

  /** Fills in whichever half of the reference we already know. */
  completeRef(ref) {
    const out = { pn: ref.pn || null, lid: ref.lid || null };
    if (out.lid && !out.pn) out.pn = this.lidToPn.get(out.lid) || null;
    if (out.pn && !out.lid) out.lid = this.pnToLid.get(out.pn) || null;
    if (out.pn && out.lid) this.learnMapping(out.lid, out.pn);
    return out;
  }

  // --------------------------------------------------------------------- //
  // Chat resolution
  // --------------------------------------------------------------------- //

  _cacheChat(row) {
    if (row.phone_number) this.chatByPn.set(row.phone_number, row.id);
    if (row.lid) this.chatByLid.set(row.lid, row.id);
  }

  _cachedChatId(ref) {
    const byPn = ref.pn ? this.chatByPn.get(ref.pn) : undefined;
    const byLid = ref.lid ? this.chatByLid.get(ref.lid) : undefined;
    if (ref.pn && ref.lid) {
      // Only trust the cache when both identifiers agree on one chat.
      return byPn && byPn === byLid ? byPn : undefined;
    }
    return byPn || byLid;
  }

  /**
   * Maps chat references to chat ids, creating rows when `create` is set.
   * Handles the three LID cases:
   *   - a LID-only chat learns its phone number  -> the row is promoted
   *   - a phone chat learns its LID              -> the LID is recorded
   *   - both rows already exist for one contact  -> they are merged
   *
   * @returns Map<refKey, chatId>  (use ChatStore.keyOf(ref) to look up)
   */
  async resolveChats(refs, { create = true } = {}) {
    const result = new Map();
    const pending = new Map();
    // Learn every mapping in the batch first, so a LID-only reference that is
    // listed before its "LID + phone" twin is not created as a separate chat.
    for (const raw of refs) {
      if (raw?.pn && raw.lid) this.learnMapping(raw.lid, raw.pn);
    }
    for (const raw of refs) {
      if (!raw || (!raw.pn && !raw.lid)) continue;
      const ref = this.completeRef(raw);
      const key = refKey(ref);
      const cached = this._cachedChatId(ref);
      if (cached) {
        result.set(key, cached);
        if (ref.lid) result.set(`lid:${ref.lid}`, cached);
        continue;
      }
      const prev = pending.get(key);
      pending.set(key, prev ? { pn: prev.pn || ref.pn, lid: prev.lid || ref.lid } : ref);
    }
    if (pending.size === 0) return result;

    for (const group of chunked([...pending.values()])) {
      const pns = [...new Set(group.map((r) => r.pn).filter(Boolean))];
      const lids = [...new Set(group.map((r) => r.lid).filter(Boolean))];
      const existing = await this.db.query(
        `SELECT id, jid, phone_number, lid FROM whatsapp_chats
         WHERE organization_id = $1 AND session_id = $2 AND merged_into IS NULL
           AND (phone_number = ANY($3::text[]) OR lid = ANY($4::text[]))`,
        [this.org, this.account, pns, lids]
      );
      const rowByPn = new Map();
      const rowByLid = new Map();
      for (const row of existing.rows) {
        if (row.phone_number) rowByPn.set(row.phone_number, row);
        if (row.lid) rowByLid.set(row.lid, row);
      }

      const toCreate = [];
      for (const ref of group) {
        const key = refKey(ref);
        const viaPn = ref.pn ? rowByPn.get(ref.pn) : null;
        const viaLid = ref.lid ? rowByLid.get(ref.lid) : null;

        if (viaPn && viaLid && viaPn.id !== viaLid.id) {
          await this._mergeChats(viaPn, viaLid);
          viaPn.lid = viaPn.lid || ref.lid;
          rowByLid.set(ref.lid, viaPn);
          this._cacheChat(viaPn);
          result.set(key, viaPn.id);
        } else if (viaPn) {
          if (ref.lid && !viaPn.lid) {
            await this.db.query(
              `UPDATE whatsapp_chats SET lid = $2, updated_at = ${NOW_UTC} WHERE id = $1 AND lid IS NULL`,
              [viaPn.id, ref.lid]
            );
            viaPn.lid = ref.lid;
            rowByLid.set(ref.lid, viaPn);
          }
          this._cacheChat(viaPn);
          result.set(key, viaPn.id);
        } else if (viaLid) {
          if (ref.pn && !viaLid.phone_number) {
            const promoted = await this._promoteChat(viaLid, ref.pn);
            rowByPn.set(ref.pn, promoted);
            this._cacheChat(promoted);
            result.set(key, promoted.id);
          } else {
            this._cacheChat(viaLid);
            result.set(key, viaLid.id);
          }
        } else if (create) {
          toCreate.push(ref);
        }
        if (ref.lid && result.has(key)) result.set(`lid:${ref.lid}`, result.get(key));
      }

      if (toCreate.length) {
        const rows = toCreate.map((ref) => {
          const hint = this.names.get(refKey(ref)) || (ref.lid ? this.names.get(`lid:${ref.lid}`) : null) || {};
          return {
            id: crypto.randomUUID(),
            jid: canonicalJid(ref),
            pn: ref.pn,
            lid: ref.lid,
            name: hint.name || null,
            push_name: hint.notify || null,
            verified_name: hint.verified || null
          };
        });
        const inserted = await this.db.query(
          `INSERT INTO whatsapp_chats (id, organization_id, session_id, jid, phone_number, lid, name, push_name, verified_name, created_at, updated_at)
           SELECT r.id, $1, $2, r.jid, r.pn, r.lid, r.name, r.push_name, r.verified_name, ${NOW_UTC}, ${NOW_UTC}
           FROM jsonb_to_recordset($3::jsonb) AS r(id text, jid text, pn text, lid text, name text, push_name text, verified_name text)
           ON CONFLICT (organization_id, session_id, jid) DO UPDATE
             SET lid = COALESCE(whatsapp_chats.lid, EXCLUDED.lid),
                 phone_number = COALESCE(whatsapp_chats.phone_number, EXCLUDED.phone_number),
                 updated_at = ${NOW_UTC}
           RETURNING id, jid, phone_number, lid`,
          [this.org, this.account, JSON.stringify(rows)]
        );
        const byJid = new Map(inserted.rows.map((r) => [r.jid, r]));
        for (const ref of toCreate) {
          const row = byJid.get(canonicalJid(ref));
          if (!row) continue;
          this._cacheChat(row);
          const key = refKey(ref);
          result.set(key, row.id);
          if (ref.lid) result.set(`lid:${ref.lid}`, row.id);
        }
      }
    }
    return result;
  }

  /** Reads the chat id for `ref` out of a resolveChats() result. */
  lookup(resolved, ref) {
    if (!ref) return null;
    const full = this.completeRef(ref);
    return (full.pn && resolved.get(`pn:${full.pn}`)) || (full.lid && resolved.get(`lid:${full.lid}`)) || null;
  }

  /** Looks a chat up without creating it. */
  async findChatId(ref) {
    const map = await this.resolveChats([ref], { create: false });
    return this.lookup(map, ref);
  }

  /** A LID-only chat just learnt its phone number. */
  async _promoteChat(row, pn) {
    try {
      const res = await this.db.tx(async (client) => {
        const updated = await client.query(
          `UPDATE whatsapp_chats SET phone_number = $2, jid = $3, updated_at = ${NOW_UTC}
           WHERE id = $1 RETURNING id, jid, phone_number, lid`,
          [row.id, pn, pnJid(pn)]
        );
        await client.query('UPDATE whatsapp_messages SET phone_number = $2 WHERE chat_id = $1 AND phone_number IS NULL', [
          row.id,
          pn
        ]);
        return updated.rows[0];
      });
      this.log.info({ chat: row.id }, 'LID chat resolved to a phone number');
      return res;
    } catch (err) {
      if (err.code !== '23505') throw err;
      // A phone-number row appeared concurrently (e.g. "New chat" in the CRM): merge into it.
      const other = await this.db.query(
        `SELECT id, jid, phone_number, lid FROM whatsapp_chats
         WHERE organization_id = $1 AND session_id = $2 AND jid = $3 AND merged_into IS NULL`,
        [this.org, this.account, pnJid(pn)]
      );
      if (other.rowCount === 0) throw err;
      await this._mergeChats(other.rows[0], row);
      return { ...other.rows[0], lid: other.rows[0].lid || row.lid };
    }
  }

  /** Folds the LID row `drop` into the phone-number row `keep`. */
  async _mergeChats(keep, drop) {
    await this.db.tx(async (client) => {
      // No feed bump for the moved messages: clients reload the thread when
      // they see the tombstone below.
      await client.query(
        'UPDATE whatsapp_messages SET chat_id = $1, phone_number = COALESCE(phone_number, $3) WHERE chat_id = $2',
        [keep.id, drop.id, keep.phone_number]
      );
      await client.query(
        `UPDATE whatsapp_chats k SET
            lid = COALESCE(k.lid, d.lid),
            name = COALESCE(k.name, d.name),
            push_name = COALESCE(k.push_name, d.push_name),
            verified_name = COALESCE(k.verified_name, d.verified_name),
            custom_name = COALESCE(k.custom_name, d.custom_name),
            avatar_url = COALESCE(k.avatar_url, d.avatar_url),
            unread_count = k.unread_count + d.unread_count,
            is_pinned = k.is_pinned OR d.is_pinned,
            is_blocked = k.is_blocked OR d.is_blocked,
            is_muted = k.is_muted OR d.is_muted,
            is_archived = CASE WHEN k.last_message_at IS NULL THEN d.is_archived ELSE k.is_archived END,
            contact_id = COALESCE(k.contact_id, d.contact_id),
            lead_id = COALESCE(k.lead_id, d.lead_id),
            converted_at = COALESCE(k.converted_at, d.converted_at),
            converted_by = COALESCE(k.converted_by, d.converted_by),
            updated_at = ${NOW_UTC}
         FROM whatsapp_chats d
         WHERE k.id = $1 AND d.id = $2`,
        [keep.id, drop.id]
      );
      // Tombstone: frees the LID for the surviving row and lets open clients follow the redirect.
      await client.query(
        `UPDATE whatsapp_chats SET merged_into = $1, lid = NULL, phone_number = NULL, unread_count = 0,
                jid = 'merged:' || id, updated_at = ${NOW_UTC}
         WHERE id = $2`,
        [keep.id, drop.id]
      );
    });
    for (const [k, v] of this.chatByLid) if (v === drop.id) this.chatByLid.set(k, keep.id);
    for (const [k, v] of this.chatByPn) if (v === drop.id) this.chatByPn.set(k, keep.id);
    await this.refreshChatSummaries([keep.id]);
    this.log.info({ keep: keep.id, drop: drop.id }, 'merged LID chat into phone-number chat');
  }

  // --------------------------------------------------------------------- //
  // Names (address book + push names). Only ever applied to chats that
  // already exist: the phone's contact list is never imported.
  // --------------------------------------------------------------------- //

  _rememberName(key, patch) {
    const prev = this.names.get(key) || {};
    const next = {
      name: patch.name ?? prev.name ?? null,
      notify: patch.notify ?? prev.notify ?? null,
      verified: patch.verified ?? prev.verified ?? null
    };
    const changed = next.name !== prev.name || next.notify !== prev.notify || next.verified !== prev.verified;
    if (changed) {
      if (!this.names.has(key) && this.names.size >= NAME_CACHE_LIMIT) {
        this.names.delete(this.names.keys().next().value);
      }
      this.names.set(key, next);
    }
    return changed;
  }

  /**
   * @param entries [{ pn, lid, name, notify, verified }]
   */
  async applyNames(entries) {
    const changed = [];
    for (const e of entries) {
      const ref = this.completeRef({ pn: e.pn, lid: e.lid });
      if (!ref.pn && !ref.lid) continue;
      const patch = { name: cleanName(e.name), notify: cleanName(e.notify), verified: cleanName(e.verified) };
      if (!patch.name && !patch.notify && !patch.verified) continue;
      let any = false;
      if (ref.pn) any = this._rememberName(`pn:${ref.pn}`, patch) || any;
      if (ref.lid) any = this._rememberName(`lid:${ref.lid}`, patch) || any;
      if (any) changed.push({ pn: ref.pn, lid: ref.lid, ...patch });
    }
    for (const group of chunked(changed)) {
      await this.db.query(
        `UPDATE whatsapp_chats c SET
            name = CASE 
              WHEN v.name IS NOT NULL AND v.name != '' AND v.name NOT LIKE '%∙%' THEN v.name 
              WHEN (c.name IS NULL OR c.name LIKE '%∙%') AND v.notify IS NOT NULL AND v.notify != '' THEN v.notify
              ELSE c.name 
            END,
            push_name = COALESCE(v.notify, c.push_name),
            verified_name = COALESCE(v.verified, c.verified_name),
            updated_at = ${NOW_UTC}
         FROM jsonb_to_recordset($3::jsonb) AS v(pn text, lid text, name text, notify text, verified text)
         WHERE c.organization_id = $1 AND c.session_id = $2 AND c.merged_into IS NULL
           AND ((v.pn IS NOT NULL AND c.phone_number = v.pn) OR (v.lid IS NOT NULL AND c.lid = v.lid))
           AND (COALESCE(v.name, c.name) IS DISTINCT FROM c.name
             OR COALESCE(v.notify, c.push_name) IS DISTINCT FROM c.push_name
             OR COALESCE(v.verified, c.verified_name) IS DISTINCT FROM c.verified_name)`,
        [this.org, this.account, JSON.stringify(group)]
      );
    }
    return changed.length;
  }

  // --------------------------------------------------------------------- //
  // Messages
  // --------------------------------------------------------------------- //

  /**
   * Inserts / updates parsed messages. Idempotent on the WhatsApp message id,
   * so history sync, live delivery and retries can overlap freely.
   *
   * @param records  parseMessage() results, each extended with { chatId, phone }
   * @param opts.source  'live' | 'history' | 'crm'
   * @param opts.live    publish on the realtime feed and count unread
   * @returns rows: [{ id, wa_id, chat_id, media_status, from_me, inserted }]
   */
  async saveMessages(records, { source = 'live', live = true, extras = new Map() } = {}) {
    // The same id can legitimately appear twice in one batch; keep the richer copy.
    const unique = new Map();
    for (const rec of records) {
      if (!rec?.chatId || !rec.waId) continue;
      const prev = unique.get(rec.waId);
      if (!prev || (prev.type === 'ciphertext' && rec.type !== 'ciphertext')) unique.set(rec.waId, rec);
    }
    const list = [...unique.values()].sort((a, b) => a.timestamp - b.timestamp);
    if (list.length === 0) return [];

    const saved = [];
    for (const group of chunked(list)) {
      const rows = group.map((rec, idx) => {
        const extra = extras.get(rec.waId) || {};
        const isMedia = rec.hasMedia && ['image', 'video', 'gif', 'audio', 'ptt', 'document', 'sticker'].includes(rec.type);
        let mediaStatus = 'none';
        if (extra.mediaId) mediaStatus = 'ready';
        else if (isMedia) mediaStatus = live ? 'pending' : 'remote';
        return {
          id: crypto.randomUUID(),
          chat_id: rec.chatId,
          phone_number: rec.phone || null,
          remote_jid: rec.remoteJid || null,
          wa_id: rec.waId,
          from_me: rec.fromMe,
          type: rec.type,
          body: rec.body || '',
          caption: rec.caption || null,
          mime_type: extra.mimeType || rec.mimeType || null,
          file_name: extra.fileName || rec.fileName || null,
          media_size: extra.mediaSize || rec.fileSize || null,
          media_duration: rec.duration || null,
          is_voice_note: Boolean(rec.isVoiceNote),
          media_status: mediaStatus,
          media_id: extra.mediaId || null,
          quoted_id: rec.quoted?.id || null,
          quoted_context: rec.quoted ? JSON.stringify(rec.quoted) : null,
          payload: rec.payload ? JSON.stringify(rec.payload) : null,
          raw_b64: rec.raw ? rec.raw.toString('base64') : null,
          reactions: rec.reactions ? JSON.stringify(rec.reactions) : null,
          reaction: reactionDisplay(rec.reactions),
          status: rec.status,
          ts: rec.timestamp,
          source: extra.source || source,
          sender_user_id: extra.senderUserId || null,
          client_ref: extra.clientRef || null,
          contact_name: rec.pushName || null,
          is_deleted: Boolean(rec.isDeleted),
          live,
          ord: idx
        };
      });

      const res = await this.db.query(
        `INSERT INTO whatsapp_messages AS m (
            id, organization_id, session_id, chat_id, phone_number, remote_jid, meta_message_id, direction, from_me,
            message_type, message_body, caption, mime_type, file_name, media_size, media_duration, is_voice_note,
            media_status, media_id, quoted_message_id, quoted_context, payload, raw_message, reactions, reaction,
            status, timestamp, created_at, updated_at, source, sender_user_id, client_ref, contact_name, is_deleted, feed_at)
         SELECT r.id, $1, $2, r.chat_id, r.phone_number, r.remote_jid, r.wa_id,
                CASE WHEN r.from_me THEN 'OUTBOUND' ELSE 'INBOUND' END, r.from_me,
                r.type, COALESCE(r.body, ''), r.caption, r.mime_type, r.file_name, r.media_size, r.media_duration,
                COALESCE(r.is_voice_note, FALSE), r.media_status, r.media_id, r.quoted_id, r.quoted_context, r.payload,
                CASE WHEN r.raw_b64 IS NULL THEN NULL ELSE decode(r.raw_b64, 'base64') END,
                r.reactions, r.reaction, r.status, to_timestamp(r.ts) AT TIME ZONE 'UTC', ${NOW_UTC}, ${NOW_UTC},
                r.source, r.sender_user_id, r.client_ref, r.contact_name, COALESCE(r.is_deleted, FALSE),
                CASE WHEN r.live THEN ${NOW_UTC} ELSE NULL END
         FROM (
           SELECT * FROM jsonb_to_recordset($3::jsonb) AS x(
             id text, chat_id text, phone_number text, remote_jid text, wa_id text, from_me boolean, type text, body text,
             caption text, mime_type text, file_name text, media_size bigint, media_duration int, is_voice_note boolean,
             media_status text, media_id text, quoted_id text, quoted_context text, payload text, raw_b64 text,
             reactions text, reaction text, status text, ts double precision, source text, sender_user_id text,
             client_ref text, contact_name text, is_deleted boolean, live boolean, ord int)
           ORDER BY x.ord
         ) r
         ON CONFLICT (organization_id, session_id, meta_message_id) DO UPDATE SET
            chat_id = COALESCE(m.chat_id, EXCLUDED.chat_id),
            remote_jid = COALESCE(m.remote_jid, EXCLUDED.remote_jid),
            phone_number = COALESCE(m.phone_number, EXCLUDED.phone_number),
            from_me = COALESCE(m.from_me, EXCLUDED.from_me),
            message_type = CASE
                WHEN m.message_type IN ('ciphertext', 'unsupported') AND EXCLUDED.message_type <> 'ciphertext' THEN EXCLUDED.message_type
                ELSE m.message_type END,
            message_body = CASE
                WHEN COALESCE(m.is_deleted, FALSE) THEN m.message_body
                WHEN m.message_type IN ('ciphertext', 'unsupported') OR COALESCE(m.message_body, '') = '' THEN EXCLUDED.message_body
                ELSE m.message_body END,
            caption = COALESCE(m.caption, EXCLUDED.caption),
            mime_type = COALESCE(m.mime_type, EXCLUDED.mime_type),
            file_name = COALESCE(m.file_name, EXCLUDED.file_name),
            media_size = COALESCE(m.media_size, EXCLUDED.media_size),
            media_duration = COALESCE(m.media_duration, EXCLUDED.media_duration),
            is_voice_note = COALESCE(m.is_voice_note, FALSE) OR EXCLUDED.is_voice_note,
            raw_message = COALESCE(m.raw_message, EXCLUDED.raw_message),
            media_id = COALESCE(m.media_id, EXCLUDED.media_id),
            media_status = CASE
                WHEN m.media_status IN ('ready', 'pending', 'legacy') THEN m.media_status
                WHEN EXCLUDED.media_id IS NOT NULL THEN 'ready'
                WHEN EXCLUDED.media_status IN ('pending', 'remote') AND m.raw_message IS NULL THEN EXCLUDED.media_status
                ELSE COALESCE(m.media_status, EXCLUDED.media_status) END,
            quoted_message_id = COALESCE(m.quoted_message_id, EXCLUDED.quoted_message_id),
            quoted_context = COALESCE(m.quoted_context, EXCLUDED.quoted_context),
            payload = COALESCE(m.payload, EXCLUDED.payload),
            reactions = COALESCE(EXCLUDED.reactions, m.reactions),
            reaction = COALESCE(EXCLUDED.reaction, m.reaction),
            status = CASE WHEN ${statusRank('EXCLUDED.status')} > ${statusRank('m.status')} THEN EXCLUDED.status ELSE m.status END,
            source = CASE WHEN EXCLUDED.source = 'crm' THEN 'crm' ELSE COALESCE(m.source, EXCLUDED.source) END,
            sender_user_id = COALESCE(m.sender_user_id, EXCLUDED.sender_user_id),
            client_ref = COALESCE(m.client_ref, EXCLUDED.client_ref),
            is_deleted = COALESCE(m.is_deleted, FALSE) OR EXCLUDED.is_deleted,
            updated_at = ${NOW_UTC},
            feed_at = COALESCE(EXCLUDED.feed_at, m.feed_at)
         RETURNING m.id, m.meta_message_id AS wa_id, m.chat_id, m.media_status, m.from_me, (xmax = 0) AS inserted`,
        [this.org, this.account, JSON.stringify(rows)]
      );
      saved.push(...res.rows);
    }

    // Unread counters: only brand-new inbound messages that arrived live.
    const unread = new Map();
    if (live) {
      for (const row of saved) {
        if (row.inserted && !row.from_me) unread.set(row.chat_id, (unread.get(row.chat_id) || 0) + 1);
      }
    }
    await this.refreshChatSummaries([...new Set(saved.map((r) => r.chat_id).filter(Boolean))], unread);
    return saved;
  }

  /** Recomputes the "last message" columns of the given chats. */
  async refreshChatSummaries(chatIds, unreadDelta = new Map()) {
    for (const group of chunked(chatIds)) {
      const deltas = group.filter((id) => unreadDelta.get(id)).map((id) => ({ chat_id: id, n: unreadDelta.get(id) }));
      await this.db.query(
        `UPDATE whatsapp_chats c SET
            last_message_id = lm.wa_id,
            last_message_preview = lm.preview,
            last_message_type = lm.message_type,
            last_message_at = lm.ts,
            last_message_from_me = lm.from_me,
            last_message_status = lm.status,
            unread_count = c.unread_count + COALESCE(u.n, 0),
            updated_at = ${NOW_UTC}
         FROM unnest($3::text[]) AS ids(chat_id)
         CROSS JOIN LATERAL (
            SELECT meta_message_id AS wa_id,
                   CASE WHEN COALESCE(is_deleted, FALSE) THEN '' ELSE left(COALESCE(NULLIF(caption, ''), message_body, ''), 300) END AS preview,
                   CASE WHEN COALESCE(is_deleted, FALSE) THEN 'revoked' ELSE COALESCE(message_type, 'text') END AS message_type,
                   COALESCE(timestamp, created_at) AS ts,
                   COALESCE(from_me, direction = 'OUTBOUND') AS from_me,
                   status
            FROM whatsapp_messages
            WHERE chat_id = ids.chat_id
            ORDER BY timestamp DESC NULLS LAST, seq DESC NULLS LAST
            LIMIT 1
         ) lm
         LEFT JOIN jsonb_to_recordset($4::jsonb) AS u(chat_id text, n int) ON u.chat_id = ids.chat_id
         WHERE c.id = ids.chat_id AND c.organization_id = $1 AND c.session_id = $2`,
        [this.org, this.account, group, JSON.stringify(deltas)]
      );
    }
  }

  /**
   * Applies delivery / read receipts. A status only ever moves forward.
   * @param updates [{ waId, status }]
   */
  async applyStatuses(updates) {
    const latest = new Map();
    for (const u of updates) if (u?.waId && u.status) latest.set(u.waId, u.status);
    if (latest.size === 0) return 0;
    let changed = 0;
    for (const group of chunked([...latest].map(([wa_id, status]) => ({ wa_id, status })))) {
      const res = await this.db.query(
        `UPDATE whatsapp_messages m SET status = v.status, updated_at = ${NOW_UTC}, feed_at = ${NOW_UTC}
         FROM jsonb_to_recordset($3::jsonb) AS v(wa_id text, status text)
         WHERE m.organization_id = $1 AND m.session_id = $2 AND m.meta_message_id = v.wa_id
           AND (
             (v.status = 'FAILED' AND m.status IN ('PENDING', 'SENT'))
             OR (v.status <> 'FAILED' AND ${statusRank('v.status')} > ${statusRank('m.status')})
           )
         RETURNING m.chat_id, m.meta_message_id AS wa_id, m.status, COALESCE(m.from_me, m.direction = 'OUTBOUND') AS from_me`,
        [this.org, this.account, JSON.stringify(group)]
      );
      changed += res.rowCount;
      if (res.rowCount === 0) continue;

      const ownRows = res.rows.filter((r) => r.from_me && r.chat_id);
      if (ownRows.length) {
        await this.db.query(
          `UPDATE whatsapp_chats c SET last_message_status = v.status, updated_at = ${NOW_UTC}
           FROM jsonb_to_recordset($1::jsonb) AS v(chat_id text, wa_id text, status text)
           WHERE c.id = v.chat_id AND c.last_message_id = v.wa_id`,
          [JSON.stringify(ownRows)]
        );
      }
      // Incoming messages reported as read => the user read the chat on the phone.
      const readElsewhere = [...new Set(res.rows.filter((r) => !r.from_me && r.status === 'READ').map((r) => r.chat_id))];
      if (readElsewhere.length) {
        await this.db.query(
          `UPDATE whatsapp_chats SET unread_count = 0, updated_at = ${NOW_UTC}
           WHERE id = ANY($1::text[]) AND organization_id = $2 AND session_id = $3 AND unread_count <> 0`,
          [readElsewhere, this.org, this.account]
        );
      }
    }
    return changed;
  }

  /** "Delete for everyone": the content is removed, a tombstone stays. */
  async markRevoked(waIds) {
    const ids = [...new Set(waIds.filter(Boolean))];
    if (!ids.length) return;
    const res = await this.db.query(
      `UPDATE whatsapp_messages SET is_deleted = TRUE, message_body = '', caption = NULL, payload = NULL,
              raw_message = NULL, quoted_context = NULL, reaction = NULL, reactions = NULL,
              media_status = 'none', updated_at = ${NOW_UTC}, feed_at = ${NOW_UTC}
       WHERE organization_id = $1 AND session_id = $2 AND meta_message_id = ANY($3::text[])
       RETURNING chat_id, media_id`,
      [this.org, this.account, ids]
    );
    const mediaIds = res.rows.map((r) => r.media_id).filter(Boolean);
    if (mediaIds.length) {
      await this.db.query(
        `UPDATE whatsapp_messages SET media_id = NULL
         WHERE organization_id = $1 AND session_id = $2 AND media_id = ANY($3::text[])`,
        [this.org, this.account, mediaIds]
      );
    }
    await this.refreshChatSummaries([...new Set(res.rows.map((r) => r.chat_id).filter(Boolean))]);
    return mediaIds;
  }

  async applyEdit(waId, { body, caption }) {
    const res = await this.db.query(
      `UPDATE whatsapp_messages SET
          message_body = $4,
          caption = CASE WHEN message_type = 'text' THEN caption ELSE $5 END,
          is_edited = TRUE, updated_at = ${NOW_UTC}, feed_at = ${NOW_UTC}
       WHERE organization_id = $1 AND session_id = $2 AND meta_message_id = $3 AND NOT COALESCE(is_deleted, FALSE)
       RETURNING chat_id`,
      [this.org, this.account, waId, body || '', caption || body || null]
    );
    await this.refreshChatSummaries([...new Set(res.rows.map((r) => r.chat_id).filter(Boolean))]);
    return res.rowCount;
  }

  /**
   * @param side 'me' | 'them'
   * @param text emoji, or '' / null to remove the reaction
   */
  async applyReaction(waId, side, text) {
    const current = await this.db.query(
      'SELECT id, reactions FROM whatsapp_messages WHERE organization_id = $1 AND session_id = $2 AND meta_message_id = $3',
      [this.org, this.account, waId]
    );
    if (current.rowCount === 0) return 0;
    let reactions = {};
    try {
      reactions = current.rows[0].reactions ? JSON.parse(current.rows[0].reactions) : {};
    } catch {
      reactions = {};
    }
    if (text) reactions[side] = String(text).slice(0, 16);
    else delete reactions[side];
    const has = Object.keys(reactions).length > 0;
    await this.db.query(
      `UPDATE whatsapp_messages SET reactions = $2, reaction = $3, updated_at = ${NOW_UTC}, feed_at = ${NOW_UTC} WHERE id = $1`,
      [current.rows[0].id, has ? JSON.stringify(reactions) : null, has ? reactionDisplay(reactions) : null]
    );
    return 1;
  }

  // --------------------------------------------------------------------- //
  // Chat state coming from the phone (archive / pin / mute / read)
  // --------------------------------------------------------------------- //

  /**
   * @param updates [{ chatId, unread?, archived?, pinned?, muted?, blocked?, name? }]
   *        undefined fields are left untouched.
   */
  async applyChatState(updates) {
    const rows = updates
      .filter((u) => u?.chatId)
      .map((u) => ({
        id: u.chatId,
        unread: Number.isInteger(u.unread) ? u.unread : null,
        mark_unread: u.markUnread === true,
        archived: typeof u.archived === 'boolean' ? u.archived : null,
        pinned: typeof u.pinned === 'boolean' ? u.pinned : null,
        muted: typeof u.muted === 'boolean' ? u.muted : null,
        blocked: typeof u.blocked === 'boolean' ? u.blocked : null
      }));
    for (const group of chunked(rows)) {
      await this.db.query(
        `UPDATE whatsapp_chats c SET
            unread_count = CASE
                WHEN v.unread IS NOT NULL THEN GREATEST(v.unread, 0)
                WHEN v.mark_unread AND c.unread_count = 0 THEN 1
                ELSE c.unread_count END,
            is_archived = COALESCE(v.archived, c.is_archived),
            is_pinned = COALESCE(v.pinned, c.is_pinned),
            pinned_at = CASE WHEN v.pinned IS TRUE AND NOT c.is_pinned THEN ${NOW_UTC} WHEN v.pinned IS FALSE THEN NULL ELSE c.pinned_at END,
            is_muted = COALESCE(v.muted, c.is_muted),
            is_blocked = COALESCE(v.blocked, c.is_blocked),
            updated_at = ${NOW_UTC}
         FROM jsonb_to_recordset($3::jsonb) AS v(id text, unread int, mark_unread boolean, archived boolean, pinned boolean, muted boolean, blocked boolean)
         WHERE c.id = v.id AND c.organization_id = $1 AND c.session_id = $2`,
        [this.org, this.account, JSON.stringify(group)]
      );
    }
  }

  // --------------------------------------------------------------------- //
  // Lookups used when sending / downloading
  // --------------------------------------------------------------------- //

  async getChat(chatId) {
    const res = await this.db.query(
      `SELECT * FROM whatsapp_chats WHERE id = $1 AND organization_id = $2 AND session_id = $3 AND merged_into IS NULL`,
      [chatId, this.org, this.account]
    );
    return res.rows[0] || null;
  }

  async getMessageRow(messageId) {
    const res = await this.db.query(
      `SELECT * FROM whatsapp_messages WHERE id = $1 AND organization_id = $2 AND session_id = $3`,
      [messageId, this.org, this.account]
    );
    return res.rows[0] || null;
  }

  async getMessageRowByWaId(waId) {
    const res = await this.db.query(
      `SELECT * FROM whatsapp_messages WHERE meta_message_id = $1 AND organization_id = $2 AND session_id = $3`,
      [waId, this.org, this.account]
    );
    return res.rows[0] || null;
  }

  /** The most recent messages of a chat, newest first (for read receipts / archive). */
  async recentMessageRows(chatId, { limit = 1, inboundOnly = false } = {}) {
    const res = await this.db.query(
      `SELECT id, meta_message_id, remote_jid, from_me, direction, timestamp, status
       FROM whatsapp_messages
       WHERE chat_id = $1 AND organization_id = $2 AND session_id = $3 AND meta_message_id IS NOT NULL
         AND ($4::boolean IS FALSE OR NOT COALESCE(from_me, direction = 'OUTBOUND'))
       ORDER BY timestamp DESC NULLS LAST, seq DESC NULLS LAST
       LIMIT $5`,
      [chatId, this.org, this.account, inboundOnly, limit]
    );
    return res.rows;
  }

  rememberSent(waId, message) {
    if (this.recentSent.size >= RECENT_SENT_LIMIT) this.recentSent.delete(this.recentSent.keys().next().value);
    this.recentSent.set(waId, message);
  }

  /** Baileys calls this when a recipient asks for a message to be re-sent. */
  async getMessageForRetry(key) {
    if (!key?.id) return undefined;
    const cached = this.recentSent.get(key.id);
    if (cached) return cached;
    try {
      const row = await this.getMessageRowByWaId(key.id);
      return row ? messageFromRow(row) : undefined;
    } catch (err) {
      this.log.warn({ err: err.message }, 'getMessage lookup failed');
      return undefined;
    }
  }

  async setMediaResult(messageId, fields) {
    await this.db.query(
      `UPDATE whatsapp_messages SET
          media_id = COALESCE($2, media_id),
          media_status = $3,
          media_error = $4,
          mime_type = COALESCE($5, mime_type),
          media_size = COALESCE($6, media_size),
          updated_at = ${NOW_UTC}, feed_at = ${NOW_UTC}
       WHERE id = $1 AND organization_id = $7 AND session_id = $8`,
      [
        messageId,
        fields.mediaId || null,
        fields.status,
        fields.error ? String(fields.error).slice(0, 255) : null,
        fields.mimeType || null,
        fields.size || null,
        this.org,
        this.account
      ]
    );
  }

  async setChatAvatar(chatId, url) {
    await this.db.query(
      `UPDATE whatsapp_chats SET avatar_url = $2, avatar_fetched_at = ${NOW_UTC}, updated_at = ${NOW_UTC}
       WHERE id = $1 AND organization_id = $3 AND session_id = $4`,
      [chatId, url || null, this.org, this.account]
    );
  }
}
