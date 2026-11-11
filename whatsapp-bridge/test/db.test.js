// Integration tests against a real, throw-away PostgreSQL database.
// Skipped automatically when no database server is reachable.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { addTransactionCapability, DisconnectReason, initAuthCreds, makeCacheableSignalKeyStore, proto } from '@whiskeysockets/baileys';
import { usePostgresAuthState } from '../src/auth-store.js';
import { applySchema, NOW_UTC } from '../src/db.js';
import { WASession } from '../src/session.js';
import { SessionManager } from '../src/session-manager.js';
import { MediaStorage } from '../src/storage.js';
import { ChatStore } from '../src/store.js';
import { createScratchDb } from './helpers/scratch-db.js';

const scratch = await createScratchDb();
const skip = scratch ? false : 'no PostgreSQL server available';
const db = scratch?.db;

const ORG_A = crypto.randomUUID();
const ORG_B = crypto.randomUUID();
const USER_A = crypto.randomUUID();
const USER_B = crypto.randomUUID();
const PHONE_A = '919000000001';
const PHONE_B = '919000000002';

const quietLogger = {
  level: 'silent',
  child: () => quietLogger,
  trace() {},
  debug() {},
  info() {},
  warn() {},
  error() {}
};

const rec = (over = {}) => ({
  waId: crypto.randomBytes(8).toString('hex').toUpperCase(),
  remoteJid: '919876543210@s.whatsapp.net',
  fromMe: false,
  timestamp: Math.floor(Date.now() / 1000),
  pushName: null,
  status: 'DELIVERED',
  type: 'text',
  body: 'hello',
  caption: null,
  mimeType: null,
  fileName: null,
  fileSize: null,
  duration: null,
  isVoiceNote: false,
  hasMedia: false,
  quoted: null,
  payload: null,
  raw: null,
  reactions: null,
  isDeleted: false,
  ...over
});

async function insertSession(id, org, user) {
  await db.query(
    `INSERT INTO whatsapp_sessions (id, organization_id, user_id, status, desired_state, created_at, updated_at)
     VALUES ($1, $2, $3, 'DISCONNECTED', 'running', ${NOW_UTC}, ${NOW_UTC}) ON CONFLICT (id) DO NOTHING`,
    [id, org, user]
  );
}

before(async () => {
  if (skip) return;
  // --- the database as the previous integration left it ---------------------
  await db.query(`CREATE TABLE organizations (id VARCHAR(36) PRIMARY KEY, name VARCHAR(255))`);
  await db.query(`CREATE TABLE users (id VARCHAR(36) PRIMARY KEY, organization_id VARCHAR(36) NOT NULL, whatsapp_phone_number VARCHAR(50))`);
  await db.query(`
    CREATE TABLE whatsapp_messages (
      id VARCHAR(36) PRIMARY KEY, organization_id VARCHAR(36), contact_id VARCHAR(36), contact_name VARCHAR(255),
      assigned_user_id VARCHAR(36), business_phone_number_id VARCHAR(100), phone_number VARCHAR(50) NOT NULL,
      direction VARCHAR(20) DEFAULT 'INBOUND', message_body TEXT NOT NULL, message_type VARCHAR(50) DEFAULT 'text',
      media_url VARCHAR(500), media_base64 TEXT, file_name VARCHAR(255), caption TEXT, is_voice_note BOOLEAN DEFAULT FALSE,
      meta_message_id VARCHAR(255), status VARCHAR(50) DEFAULT 'SENT', timestamp TIMESTAMP, reaction VARCHAR(50),
      is_deleted BOOLEAN DEFAULT FALSE, session_id VARCHAR(100), quoted_context TEXT,
      created_at TIMESTAMP NOT NULL, updated_at TIMESTAMP NOT NULL)`);
  await db.query('INSERT INTO organizations VALUES ($1, $2), ($3, $4)', [ORG_A, 'Org A', ORG_B, 'Org B']);
  await db.query('INSERT INTO users VALUES ($1, $2, NULL), ($3, $4, NULL)', [USER_A, ORG_A, USER_B, ORG_B]);

  const legacy = (o) => [
    crypto.randomUUID(), o.org, o.user, o.phone, o.direction || 'INBOUND', o.body || 'legacy', o.type || 'text',
    o.mediaUrl || null, o.waId, o.status || 'DELIVERED', o.session, o.name || null, o.ts
  ];
  const rows = [
    // org B's device, but the old webhook filed the live message under org A (the "first organization" bug)
    legacy({ org: ORG_A, user: USER_B, phone: '919811111111', waId: 'LEG-1', session: PHONE_B, name: 'Meena', ts: '2026-01-01 10:00:00' }),
    legacy({ org: ORG_B, user: USER_B, phone: '919811111111', waId: 'LEG-2', session: PHONE_B, direction: 'OUTBOUND', status: 'READ', ts: '2026-01-01 10:05:00', body: 'latest from us' }),
    // the same WhatsApp message stored twice; one copy has media
    legacy({ org: ORG_A, user: USER_A, phone: '919822222222', waId: 'LEG-DUP', session: PHONE_A, ts: '2026-01-02 09:00:00' }),
    legacy({ org: ORG_A, user: USER_A, phone: '919822222222', waId: 'LEG-DUP', session: PHONE_A, ts: '2026-01-02 09:00:01', mediaUrl: '/media/whatsapp/img_1.jpg', type: 'image' }),
    legacy({ org: ORG_A, user: USER_A, phone: '919822222222', waId: 'LEG-3', session: PHONE_A, ts: '2026-01-02 09:10:00', type: 'audio' }),
    // Meta Cloud API row without a QR session: must be left alone
    legacy({ org: ORG_A, user: null, phone: '919833333333', waId: 'wamid.meta', session: null, ts: '2026-01-03 09:00:00' })
  ];
  for (const r of rows) {
    await db.query(
      `INSERT INTO whatsapp_messages (id, organization_id, assigned_user_id, phone_number, direction, message_body, message_type,
                                      media_url, meta_message_id, status, session_id, contact_name, timestamp, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::timestamp,$13::timestamp,$13::timestamp)`,
      r
    );
  }
  await applySchema(db);
});

after(async () => {
  if (scratch) await scratch.destroy();
});

describe('schema + legacy migration', { skip }, () => {
  test('is idempotent and records its fingerprint', async () => {
    assert.equal(await applySchema(db), false, 'second run is a no-op');
    const meta = await db.query("SELECT count(*)::int AS n FROM whatsapp_schema_meta WHERE name LIKE 'schema:%'");
    assert.equal(meta.rows[0].n, 1);
  });

  test('rows are re-attributed to the organization that owns the device', async () => {
    const res = await db.query("SELECT organization_id FROM whatsapp_messages WHERE meta_message_id = 'LEG-1'");
    assert.equal(res.rows[0].organization_id, ORG_B);
  });

  test('duplicate messages collapse to one copy, keeping the one with media', async () => {
    const res = await db.query("SELECT media_url, media_status FROM whatsapp_messages WHERE meta_message_id = 'LEG-DUP'");
    assert.equal(res.rowCount, 1);
    assert.equal(res.rows[0].media_url, '/media/whatsapp/img_1.jpg');
    assert.equal(res.rows[0].media_status, 'legacy');
    const audio = await db.query("SELECT media_status FROM whatsapp_messages WHERE meta_message_id = 'LEG-3'");
    assert.equal(audio.rows[0].media_status, 'unavailable');
  });

  test('chats are created per (organization, connected number) with summaries', async () => {
    const chats = await db.query('SELECT organization_id, session_id, jid, phone_number, name, last_message_preview, last_message_from_me, unread_count FROM whatsapp_chats ORDER BY phone_number');
    assert.equal(chats.rowCount, 2);
    const [b, a] = chats.rows;
    assert.deepEqual([b.organization_id, b.session_id, b.jid, b.name], [ORG_B, PHONE_B, '919811111111@s.whatsapp.net', 'Meena']);
    assert.equal(b.last_message_preview, 'latest from us');
    assert.equal(b.last_message_from_me, true);
    assert.equal(b.unread_count, 1);
    assert.deepEqual([a.organization_id, a.session_id, a.phone_number], [ORG_A, PHONE_A, '919822222222']);

    const linked = await db.query('SELECT count(*)::int AS n FROM whatsapp_messages WHERE chat_id IS NOT NULL AND seq IS NOT NULL');
    assert.equal(linked.rows[0].n, 4);
    const meta = await db.query("SELECT chat_id, session_id FROM whatsapp_messages WHERE meta_message_id = 'wamid.meta'");
    assert.equal(meta.rows[0].chat_id, null, 'rows without a QR session are not pulled into any inbox');
  });
});

describe('PostgreSQL auth state', { skip }, () => {
  const SID = `auth-${crypto.randomUUID()}`;

  test('credentials and signal keys survive a "restart"', async () => {
    await insertSession(SID, ORG_A, crypto.randomUUID());
    const first = await usePostgresAuthState(db, SID);
    assert.equal(first.restored, false);
    const creds = first.state.creds;
    creds.me = { id: '919000000001:7@s.whatsapp.net', name: 'Owner', lid: '111000111000111:7@lid' };
    creds.accountSyncCounter = 3;
    await Promise.all([first.saveCreds(), first.saveCreds(), first.saveCreds()]);

    const preKey = { public: crypto.randomBytes(32), private: crypto.randomBytes(32) };
    const sessionBlob = crypto.randomBytes(180);
    await first.state.keys.set({
      'pre-key': { 1: preKey, 2: preKey },
      session: { '919876543210.0': sessionBlob },
      'lid-mapping': { 919876543210: '123456789012345', '123456789012345_reverse': '919876543210' },
      'app-state-sync-key': { 'AAAA/b+c=': { keyData: crypto.randomBytes(32), timestamp: 1700000000 } },
      'device-list': { 919876543210: ['0', '3'] }
    });
    await first.flush();

    // A brand-new process: nothing in memory, everything comes from the database.
    const second = await usePostgresAuthState(db, SID);
    assert.equal(second.restored, true);
    assert.equal(second.state.creds.me.id, '919000000001:7@s.whatsapp.net');
    assert.equal(second.state.creds.accountSyncCounter, 3);
    assert.deepEqual(Buffer.from(second.state.creds.noiseKey.private), Buffer.from(creds.noiseKey.private));
    assert.deepEqual(Buffer.from(second.state.creds.signedIdentityKey.public), Buffer.from(creds.signedIdentityKey.public));
    assert.equal(second.state.creds.advSecretKey, creds.advSecretKey);

    const keys = await second.state.keys.get('pre-key', ['1', '2', '3']);
    assert.deepEqual(Object.keys(keys).sort(), ['1', '2']);
    assert.ok(Buffer.isBuffer(keys['1'].private));
    assert.deepEqual(keys['1'].private, preKey.private);
    assert.deepEqual((await second.state.keys.get('session', ['919876543210.0']))['919876543210.0'], sessionBlob);
    assert.deepEqual((await second.state.keys.get('device-list', ['919876543210']))['919876543210'], ['0', '3']);
    const mapping = await second.state.keys.get('lid-mapping', ['919876543210', '123456789012345_reverse']);
    assert.equal(mapping['919876543210'], '123456789012345');
    assert.equal(mapping['123456789012345_reverse'], '919876543210');
    const appKey = (await second.state.keys.get('app-state-sync-key', ['AAAA/b+c=']))['AAAA/b+c='];
    assert.ok(appKey instanceof proto.Message.AppStateSyncKeyData);
    assert.equal(appKey.keyData.length, 32);
  });

  test('null deletes a key; unknown ids are simply absent', async () => {
    const auth = await usePostgresAuthState(db, SID);
    await auth.state.keys.set({ 'pre-key': { 1: null }, session: { 'nobody.0': null } });
    const keys = await auth.state.keys.get('pre-key', ['1', '2']);
    assert.deepEqual(Object.keys(keys), ['2']);
    assert.deepEqual(await auth.state.keys.get('session', []), {});
  });

  test('works under Baileys own caching + transaction wrappers', async () => {
    const auth = await usePostgresAuthState(db, SID);
    const cached = makeCacheableSignalKeyStore(auth.state.keys, quietLogger);
    const keys = addTransactionCapability(cached, quietLogger, { maxCommitRetries: 2, delayBetweenTriesMs: 10 });
    const blob = crypto.randomBytes(64);
    await keys.transaction(async () => {
      await keys.set({ session: { 'txn.1': blob, 'txn.2': blob } });
      const inside = await keys.get('session', ['txn.1']);
      assert.deepEqual(inside['txn.1'], blob, 'reads inside a transaction see pending writes');
    }, 'test');
    const fresh = await usePostgresAuthState(db, SID);
    const stored = await fresh.state.keys.get('session', ['txn.1', 'txn.2']);
    assert.deepEqual(stored['txn.1'], blob);
    assert.deepEqual(stored['txn.2'], blob);
  });

  test('sessions never share keys', async () => {
    const other = `auth-${crypto.randomUUID()}`;
    await insertSession(other, ORG_B, crypto.randomUUID());
    const auth = await usePostgresAuthState(db, other);
    assert.deepEqual(await auth.state.keys.get('pre-key', ['2']), {});
    assert.equal(auth.restored, false);
  });

  test('wipe removes the pairing for good and later saves cannot resurrect it', async () => {
    const auth = await usePostgresAuthState(db, SID);
    await auth.wipe();
    await auth.saveCreds();
    await auth.state.keys.set({ 'pre-key': { 9: { public: Buffer.alloc(32), private: Buffer.alloc(32) } } });
    const row = await db.query('SELECT creds FROM whatsapp_sessions WHERE id = $1', [SID]);
    assert.equal(row.rows[0].creds, null);
    const left = await db.query('SELECT count(*)::int AS n FROM whatsapp_session_keys WHERE session_id = $1', [SID]);
    assert.equal(left.rows[0].n, 0);
    assert.equal((await usePostgresAuthState(db, SID)).restored, false);
  });

  test('a missing session row is an error, not a silent new identity', async () => {
    await assert.rejects(() => usePostgresAuthState(db, 'does-not-exist'), /does not exist/);
  });
});

describe('chat store', { skip }, () => {
  const ACCOUNT = '919111111111';
  const store = () => new ChatStore({ db, organizationId: ORG_A, accountId: ACCOUNT });
  const chatRow = async (id) => (await db.query('SELECT * FROM whatsapp_chats WHERE id = $1', [id])).rows[0];
  const messagesOf = async (chatId) =>
    (await db.query('SELECT * FROM whatsapp_messages WHERE chat_id = $1 ORDER BY timestamp, seq', [chatId])).rows;

  test('creates one chat per contact and reuses it', async () => {
    const s = store();
    const refs = [{ pn: '919800000001', lid: null }, { pn: '919800000002', lid: null }, { pn: '919800000001', lid: null }];
    const resolved = await s.resolveChats(refs);
    const a = s.lookup(resolved, refs[0]);
    const b = s.lookup(resolved, refs[1]);
    assert.ok(a && b && a !== b);
    assert.equal(s.lookup(resolved, refs[2]), a);
    // a second store instance (fresh cache) finds the same rows
    assert.equal(await store().findChatId({ pn: '919800000001' }), a);
    assert.equal((await chatRow(a)).jid, '919800000001@s.whatsapp.net');
  });

  test('a LID-only chat is promoted when its phone number becomes known', async () => {
    const s = store();
    const lid = '500000000000001';
    const first = s.lookup(await s.resolveChats([{ pn: null, lid }]), { lid });
    assert.equal((await chatRow(first)).jid, `${lid}@lid`);
    assert.equal((await chatRow(first)).phone_number, null);
    await s.saveMessages([rec({ chatId: first, phone: null, remoteJid: `${lid}@lid` })]);

    const again = s.lookup(await s.resolveChats([{ pn: '919800000010', lid }]), { lid });
    assert.equal(again, first, 'same row, no duplicate chat');
    const row = await chatRow(first);
    assert.deepEqual([row.jid, row.phone_number, row.lid], ['919800000010@s.whatsapp.net', '919800000010', lid]);
    assert.equal((await messagesOf(first))[0].phone_number, '919800000010');
    // later LID-only traffic lands in the same chat
    assert.equal(await store().findChatId({ lid }), first);
  });

  test('a LID chat and a phone chat for the same person are merged', async () => {
    const s = store();
    const lid = '500000000000002';
    const pn = '919800000020';
    const lidChat = s.lookup(await s.resolveChats([{ lid }]), { lid });
    const pnChat = s.lookup(await s.resolveChats([{ pn }]), { pn });
    assert.notEqual(lidChat, pnChat);
    await s.saveMessages([rec({ chatId: lidChat, remoteJid: `${lid}@lid`, body: 'via lid', timestamp: 1700000100 })]);
    await s.saveMessages([rec({ chatId: pnChat, phone: pn, body: 'via pn', timestamp: 1700000200 })]);

    const merged = s.lookup(await s.resolveChats([{ pn, lid }]), { pn, lid });
    assert.equal(merged, pnChat);
    assert.deepEqual((await messagesOf(pnChat)).map((m) => m.message_body), ['via lid', 'via pn']);
    const tomb = await chatRow(lidChat);
    assert.equal(tomb.merged_into, pnChat);
    assert.equal(tomb.lid, null);
    const kept = await chatRow(pnChat);
    assert.deepEqual([kept.lid, kept.unread_count, kept.last_message_preview], [lid, 2, 'via pn']);
    assert.equal(await store().findChatId({ lid }), pnChat);
  });

  test('a LID-only reference listed before its mapped twin does not create two chats', async () => {
    const s = store();
    const lid = '500000000000003';
    const pn = '919800000030';
    const resolved = await s.resolveChats([{ lid }, { pn, lid }]);
    assert.equal(s.lookup(resolved, { lid }), s.lookup(resolved, { pn, lid }));
    const rows = await db.query(
      'SELECT count(*)::int AS n FROM whatsapp_chats WHERE organization_id = $1 AND session_id = $2 AND (phone_number = $3 OR lid = $4)',
      [ORG_A, ACCOUNT, pn, lid]
    );
    assert.equal(rows.rows[0].n, 1);
  });

  test('different contacts are never merged', async () => {
    const s = store();
    const resolved = await s.resolveChats([
      { pn: '919800000041', lid: '500000000000041' },
      { pn: '919800000042', lid: '500000000000042' }
    ]);
    const a = s.lookup(resolved, { pn: '919800000041' });
    const b = s.lookup(resolved, { pn: '919800000042' });
    assert.notEqual(a, b);
    assert.equal(await s.findChatId({ lid: '500000000000041' }), a);
    assert.equal(await s.findChatId({ lid: '500000000000042' }), b);
    assert.equal(await s.findChatId({ lid: '500000000000099' }), null, 'unknown LID resolves to nothing');
  });

  test('messages are idempotent on the WhatsApp id; status only moves forward', async () => {
    const s = store();
    const pn = '919800000050';
    const chatId = s.lookup(await s.resolveChats([{ pn }]), { pn });
    const out = rec({ chatId, phone: pn, fromMe: true, status: 'SENT', body: 'quote attached' });

    const first = await s.saveMessages([out]);
    assert.equal(first[0].inserted, true);
    const again = await s.saveMessages([{ ...out, status: 'PENDING' }, { ...out, status: 'PENDING' }]);
    assert.equal(again.length, 1);
    assert.equal(again[0].inserted, false);
    assert.equal((await messagesOf(chatId)).length, 1);
    assert.equal((await messagesOf(chatId))[0].status, 'SENT');

    assert.equal(await s.applyStatuses([{ waId: out.waId, status: 'READ' }]), 1);
    assert.equal(await s.applyStatuses([{ waId: out.waId, status: 'DELIVERED' }]), 0, 'READ cannot fall back to DELIVERED');
    assert.equal(await s.applyStatuses([{ waId: out.waId, status: 'FAILED' }]), 0, 'a read message cannot become failed');
    const row = (await messagesOf(chatId))[0];
    assert.equal(row.status, 'READ');
    assert.equal((await chatRow(chatId)).last_message_status, 'READ');
    assert.ok(row.feed_at, 'live changes are published on the realtime feed');
  });

  test('unread counts follow live inbound messages and reads on the phone', async () => {
    const s = store();
    const pn = '919800000060';
    const chatId = s.lookup(await s.resolveChats([{ pn }]), { pn });
    const m1 = rec({ chatId, phone: pn, body: 'one', timestamp: 1700000001 });
    const m2 = rec({ chatId, phone: pn, body: 'two', timestamp: 1700000002 });
    await s.saveMessages([m1, m2]);
    await s.saveMessages([m1]); // redelivery must not count twice
    await s.saveMessages([rec({ chatId, phone: pn, fromMe: true, status: 'SENT', body: 'reply', timestamp: 1700000003 })]);
    let chat = await chatRow(chatId);
    assert.deepEqual([chat.unread_count, chat.last_message_preview, chat.last_message_from_me], [2, 'reply', true]);

    // "read-self" receipt: the user opened the chat on the phone
    await s.applyStatuses([{ waId: m2.waId, status: 'READ' }]);
    chat = await chatRow(chatId);
    assert.equal(chat.unread_count, 0);

    await s.applyChatState([{ chatId, markUnread: true, pinned: true, archived: true }]);
    chat = await chatRow(chatId);
    assert.deepEqual([chat.unread_count, chat.is_pinned, chat.is_archived], [1, true, true]);
    assert.ok(chat.pinned_at);
    await s.applyChatState([{ chatId, unread: 0, pinned: false }]);
    chat = await chatRow(chatId);
    assert.deepEqual([chat.unread_count, chat.is_pinned, chat.pinned_at, chat.is_archived], [0, false, null, true]);
  });

  test('history import does not raise unread counters or flood the realtime feed', async () => {
    const s = store();
    const pn = '919800000070';
    const chatId = s.lookup(await s.resolveChats([{ pn }]), { pn });
    const batch = Array.from({ length: 900 }, (_, i) => rec({ chatId, phone: pn, body: `old ${i}`, timestamp: 1600000000 + i }));
    const saved = await s.saveMessages(batch, { source: 'history', live: false });
    assert.equal(saved.length, 900);
    const chat = await chatRow(chatId);
    assert.deepEqual([chat.unread_count, chat.last_message_preview], [0, 'old 899']);
    const feed = await db.query('SELECT count(*)::int AS n FROM whatsapp_messages WHERE chat_id = $1 AND feed_at IS NOT NULL', [chatId]);
    assert.equal(feed.rows[0].n, 0);
    const order = await db.query('SELECT message_body FROM whatsapp_messages WHERE chat_id = $1 ORDER BY timestamp DESC, seq DESC LIMIT 2', [chatId]);
    assert.deepEqual(order.rows.map((r) => r.message_body), ['old 899', 'old 898']);
  });

  test('an undecryptable placeholder is replaced when the real message arrives', async () => {
    const s = store();
    const pn = '919800000080';
    const chatId = s.lookup(await s.resolveChats([{ pn }]), { pn });
    const waId = 'CIPHER-1';
    await s.saveMessages([rec({ chatId, phone: pn, waId, type: 'ciphertext', body: '' })]);
    const raw = Buffer.from(proto.Message.encode({ imageMessage: { url: 'https://mmg/z', mimetype: 'image/jpeg' } }).finish());
    const saved = await s.saveMessages([rec({ chatId, phone: pn, waId, type: 'image', body: 'photo', caption: 'photo', hasMedia: true, raw, mimeType: 'image/jpeg' })]);
    assert.equal(saved[0].inserted, false);
    assert.equal(saved[0].media_status, 'pending', 'the caller must still queue the download');
    const row = (await messagesOf(chatId))[0];
    assert.deepEqual([row.message_type, row.message_body, row.mime_type], ['image', 'photo', 'image/jpeg']);
    assert.ok(row.raw_message.length > 0);
    assert.equal((await chatRow(chatId)).unread_count, 1, 'counted once, when it first arrived');
  });

  test('reactions, edits and "delete for everyone"', async () => {
    const s = store();
    const pn = '919800000090';
    const chatId = s.lookup(await s.resolveChats([{ pn }]), { pn });
    const m = rec({ chatId, phone: pn, fromMe: true, status: 'SENT', body: 'orignal' });
    await s.saveMessages([m]);

    await s.applyReaction(m.waId, 'them', '❤️');
    await s.applyReaction(m.waId, 'me', '👍');
    let row = (await messagesOf(chatId))[0];
    assert.deepEqual(JSON.parse(row.reactions), { them: '❤️', me: '👍' });
    assert.equal(row.reaction, '❤️👍');
    await s.applyReaction(m.waId, 'them', '');
    await s.applyReaction(m.waId, 'me', '');
    row = (await messagesOf(chatId))[0];
    assert.deepEqual([row.reactions, row.reaction], [null, null]);

    await s.applyEdit(m.waId, { body: 'original', caption: null });
    row = (await messagesOf(chatId))[0];
    assert.deepEqual([row.message_body, row.is_edited], ['original', true]);
    assert.equal((await chatRow(chatId)).last_message_preview, 'original');

    await s.markRevoked([m.waId]);
    row = (await messagesOf(chatId))[0];
    assert.deepEqual([row.is_deleted, row.message_body], [true, '']);
    const chat = await chatRow(chatId);
    assert.deepEqual([chat.last_message_type, chat.last_message_preview], ['revoked', '']);
    assert.equal(await s.applyEdit(m.waId, { body: 'too late' }), 0, 'a deleted message cannot be edited back');
  });

  test('address-book names only decorate existing chats; the contact list is never imported', async () => {
    const s = store();
    const pn = '919800000100';
    const chatId = s.lookup(await s.resolveChats([{ pn }]), { pn });
    const before = (await db.query('SELECT count(*)::int AS n FROM whatsapp_chats WHERE organization_id = $1 AND session_id = $2', [ORG_A, ACCOUNT])).rows[0].n;
    const phoneBook = Array.from({ length: 300 }, (_, i) => ({ pn: `9197000${String(i).padStart(5, '0')}`, name: `Phone contact ${i}` }));
    await s.applyNames([...phoneBook, { pn, name: 'Saved Name', notify: 'push name' }]);
    const afterCount = (await db.query('SELECT count(*)::int AS n FROM whatsapp_chats WHERE organization_id = $1 AND session_id = $2', [ORG_A, ACCOUNT])).rows[0].n;
    assert.equal(afterCount, before);
    const row = await chatRow(chatId);
    assert.deepEqual([row.name, row.push_name], ['Saved Name', 'push name']);
    // a chat created later for a known phone contact picks its saved name up
    const later = s.lookup(await s.resolveChats([{ pn: '919700000007' }]), { pn: '919700000007' });
    assert.equal((await chatRow(later)).name, 'Phone contact 7');
  });

  test('nothing is ever written to the CRM contacts or leads tables', async () => {
    const tables = await db.query("SELECT to_regclass('contacts') AS contacts, to_regclass('leads') AS leads");
    assert.deepEqual([tables.rows[0].contacts, tables.rows[0].leads], [null, null], 'the bridge works without those tables existing at all');
  });
});

describe('tenant + session isolation', { skip }, () => {
  test('two organizations linked to chats with the same contact stay separate', async () => {
    const contact = '919855555555';
    const a = new ChatStore({ db, organizationId: ORG_A, accountId: '919222222221' });
    const b = new ChatStore({ db, organizationId: ORG_B, accountId: '919222222222' });
    const chatA = a.lookup(await a.resolveChats([{ pn: contact }]), { pn: contact });
    const chatB = b.lookup(await b.resolveChats([{ pn: contact }]), { pn: contact });
    assert.notEqual(chatA, chatB);

    const sameWaId = 'SHARED-ID-1';
    await a.saveMessages([rec({ chatId: chatA, phone: contact, waId: sameWaId, body: 'for org A' })]);
    await b.saveMessages([rec({ chatId: chatB, phone: contact, waId: sameWaId, body: 'for org B' })]);
    assert.equal((await a.getMessageRowByWaId(sameWaId)).message_body, 'for org A');
    assert.equal((await b.getMessageRowByWaId(sameWaId)).message_body, 'for org B');

    assert.equal(await a.getChat(chatB), null, 'a chat id from another tenant resolves to nothing');
    assert.equal(await b.getChat(chatA), null);
    const foreign = await b.getMessageRowByWaId(sameWaId);
    assert.equal(await a.getMessageRow(foreign.id), null);
    assert.equal(await a.applyStatuses([{ waId: 'nonexistent', status: 'READ' }]), 0);
  });

  test('one organization, two connected numbers: separate inboxes', async () => {
    const contact = '919866666666';
    const n1 = new ChatStore({ db, organizationId: ORG_A, accountId: '919333333331' });
    const n2 = new ChatStore({ db, organizationId: ORG_A, accountId: '919333333332' });
    const c1 = n1.lookup(await n1.resolveChats([{ pn: contact }]), { pn: contact });
    const c2 = n2.lookup(await n2.resolveChats([{ pn: contact }]), { pn: contact });
    assert.notEqual(c1, c2);
    // a LID mapping learnt on one number does not leak into the other
    n1.learnMapping('500000000000777', contact);
    assert.equal(await n2.findChatId({ lid: '500000000000777' }), null);
    assert.equal(await n1.findChatId({ lid: '500000000000777' }), c1);
  });

  test('media is only readable inside its own organization + number', async () => {
    const storage = new MediaStorage({ db, config: { storage: 'db', s3: {}, maxBytes: 1024 * 1024 } });
    const bytes = crypto.randomBytes(5000);
    const stored = await storage.put({ organizationId: ORG_A, accountId: '919333333331', buffer: bytes, mimeType: 'image/jpeg', fileName: 'a.jpg' });
    const own = await storage.get({ organizationId: ORG_A, accountId: '919333333331', mediaId: stored.id });
    assert.deepEqual(own.buffer, bytes);
    assert.equal(await storage.get({ organizationId: ORG_B, accountId: '919333333331', mediaId: stored.id }), null);
    assert.equal(await storage.get({ organizationId: ORG_A, accountId: '919333333332', mediaId: stored.id }), null);
    await assert.rejects(
      () => storage.put({ organizationId: ORG_A, accountId: 'x', buffer: Buffer.alloc(2 * 1024 * 1024), mimeType: 'video/mp4' }),
      (err) => err.code === 'MEDIA_TOO_LARGE'
    );
    await storage.remove({ organizationId: ORG_B, accountId: '919333333331', mediaIds: [stored.id] });
    assert.ok(await storage.get({ organizationId: ORG_A, accountId: '919333333331', mediaId: stored.id }), 'another tenant cannot delete it');
    await storage.remove({ organizationId: ORG_A, accountId: '919333333331', mediaIds: [stored.id] });
    assert.equal(await storage.get({ organizationId: ORG_A, accountId: '919333333331', mediaId: stored.id }), null);
  });
});

describe('session lifecycle (no network)', { skip }, () => {
  const baseConfig = (instanceId) => ({
    instanceId,
    session: { syncFullHistory: true, qrTtlMs: 60_000, leaseTtlSeconds: 45, heartbeatMs: 15_000 },
    media: { storage: 'db', maxBytes: 1024 * 1024, downloadConcurrency: 1, downloadTimeoutMs: 1000 }
  });

  /** A session whose socket creation is replaced by a counter. */
  async function fakeSession({ paired = true, instanceId = 'instance-1' } = {}) {
    const id = crypto.randomUUID();
    await insertSession(id, ORG_A, id);
    const pings = [];
    const session = new WASession({
      id,
      organizationId: ORG_A,
      userId: id,
      deps: { db, config: baseConfig(instanceId), storage: null, notifier: { ping: (s) => pings.push(s) }, onRemoved: () => {} }
    });
    session.auth = await usePostgresAuthState(db, id);
    if (paired) {
      session.auth.state.creds.me = { id: '919444444444:3@s.whatsapp.net', name: 'Rep' };
      await session.auth.saveCreds();
      await session.auth.state.keys.set({ session: { 'peer.0': crypto.randomBytes(32) } });
    }
    session.connects = [];
    session._connect = async () => {
      session.connects.push(Date.now());
    };
    const fakeSock = { end() {} };
    session.sock = fakeSock;
    const close = (code, message = 'closed') =>
      session._onClose({ error: { output: { statusCode: code }, message }, date: new Date() }, session.generation, fakeSock);
    const row = async () => (await db.query('SELECT * FROM whatsapp_sessions WHERE id = $1', [id])).rows[0];
    const keyCount = async () => (await db.query('SELECT count(*)::int AS n FROM whatsapp_session_keys WHERE session_id = $1', [id])).rows[0].n;
    return { session, close, row, keyCount, pings, fakeSock };
  }

  const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  test('515 (restart required after pairing) reconnects immediately and keeps the pairing', async () => {
    const { session, close, row, keyCount } = await fakeSession();
    await close(DisconnectReason.restartRequired, 'Stream Errored (restart required)');
    await settle(40);
    assert.equal(session.connects.length, 1);
    const r = await row();
    assert.equal(r.status, 'CONNECTING');
    assert.ok(r.creds, 'credentials are untouched');
    assert.equal(await keyCount(), 1);
    session._clearReconnect();
  });

  for (const [name, code] of [
    ['connection closed (428)', DisconnectReason.connectionClosed],
    ['connection lost / timed out (408)', DisconnectReason.connectionLost],
    ['bad session / unknown stream error (500)', DisconnectReason.badSession],
    ['service unavailable (503)', DisconnectReason.unavailableService],
    ['connection replaced (440)', DisconnectReason.connectionReplaced],
    ['no status code at all', undefined]
  ]) {
    test(`${name} never wipes credentials and schedules a background reconnect`, async () => {
      const { session, close, row, keyCount } = await fakeSession();
      await close(code);
      const r = await row();
      assert.equal(r.status, 'CONNECTING');
      assert.equal(r.desired_state, 'running');
      assert.ok(r.creds);
      assert.equal(await keyCount(), 1);
      assert.ok(session.reconnectTimer, 'a reconnect is scheduled');
      assert.equal(session.removed, false);
      session._clearReconnect();
    });
  }

  test('401 (logged out) is the only close that destroys the pairing', async () => {
    const { session, close, row, keyCount, pings } = await fakeSession();
    await close(DisconnectReason.loggedOut, 'Connection Failure');
    const r = await row();
    assert.equal(r.status, 'LOGGED_OUT');
    assert.equal(r.desired_state, 'stopped');
    assert.equal(r.creds, null);
    assert.equal(await keyCount(), 0);
    assert.equal(session.reconnectTimer, null);
    assert.equal(session.removed, true);
    assert.equal(session.connects.length, 0);
    assert.ok(pings.length > 0, 'clients are told immediately');
    await assert.rejects(() => session.start(), /unlinked/);
  });

  test('403 (account refused) stops retrying but keeps the pairing', async () => {
    const { session, close, row } = await fakeSession();
    await close(DisconnectReason.forbidden);
    const r = await row();
    assert.deepEqual([r.status, r.desired_state], ['DISCONNECTED', 'stopped']);
    assert.ok(r.creds);
    assert.equal(session.reconnectTimer, null);
  });

  test('an unscanned QR code expires quietly instead of regenerating forever', async () => {
    const { session, close, row } = await fakeSession({ paired: false });
    session.qrCount = 3;
    session.status = 'SCAN_QR';
    await close(DisconnectReason.timedOut, 'QR refs attempts ended');
    const r = await row();
    assert.deepEqual([r.status, r.desired_state, r.qr], ['QR_EXPIRED', 'stopped', null]);
    assert.equal(session.reconnectTimer, null);
    assert.equal(session.connects.length, 0);
    // asking for a new code is what starts it again
    await session.requestQr();
    assert.equal(session.connects.length, 1);
  });

  test('events from a replaced socket are ignored', async () => {
    const { session, row } = await fakeSession();
    const staleGeneration = session.generation;
    const staleSock = session.sock;
    session._closeSocket();
    await session._onClose({ error: { output: { statusCode: 401 } } }, staleGeneration, staleSock);
    assert.ok((await row()).creds, 'a stale 401 must not log the session out');
    assert.equal(session.removed, false);
  });

  test('start() is idempotent while a socket exists, is connecting, or a reconnect is pending', async () => {
    const { session, close } = await fakeSession();
    await session.start();
    await session.start();
    assert.equal(session.connects.length, 0, 'a live socket is never recreated');
    await close(DisconnectReason.connectionClosed);
    await session.start();
    await session.requestQr();
    assert.equal(session.connects.length, 0, 'the scheduled reconnect is left alone');
    session._clearReconnect();
  });

  test('only one bridge instance can hold a session; a stale lease is taken over', async () => {
    const one = await fakeSession({ instanceId: 'instance-1' });
    const two = new WASession({
      id: one.session.id,
      organizationId: ORG_A,
      userId: one.session.id,
      deps: { db, config: baseConfig('instance-2'), storage: null, notifier: { ping() {} } }
    });
    assert.equal(await one.session._acquireLease(), true);
    assert.equal(await one.session._acquireLease(), true, 're-entrant for the owner');
    assert.equal(await two._acquireLease(), false);

    await db.query(`UPDATE whatsapp_sessions SET heartbeat_at = ${NOW_UTC} - interval '5 minutes' WHERE id = $1`, [one.session.id]);
    assert.equal(await two._acquireLease(), true, 'the previous owner stopped sending heartbeats');
    assert.equal(await one.session._acquireLease(), false);

    await two._releaseLease();
    assert.equal(await one.session._acquireLease(), true);
  });

  test('graceful shutdown keeps the pairing and frees the lease for the next process', async () => {
    const { session, row } = await fakeSession();
    await session._acquireLease();
    session.status = 'CONNECTED';
    await session.stop();
    const r = await row();
    assert.equal(r.status, 'CONNECTING');
    assert.equal(r.desired_state, 'running');
    assert.equal(r.owner_instance, null);
    assert.ok(r.creds);
  });

  test('after a restart the manager resumes paired sessions only', async () => {
    const paired = await fakeSession();
    const unpaired = await fakeSession({ paired: false });
    await paired.session.stop();
    await db.query(
      `UPDATE whatsapp_sessions SET status = 'SCAN_QR', desired_state = 'running', qr = 'data:image/png;base64,xx',
              updated_at = ${NOW_UTC} - interval '10 minutes' WHERE id = $1`,
      [unpaired.session.id]
    );

    const started = [];
    const manager = new SessionManager({ db, config: baseConfig('instance-9'), storage: null, notifier: { ping() {} } });
    const build = manager._build.bind(manager);
    manager._build = (r) => {
      const s = build(r);
      s.start = async () => {
        started.push(r.id);
      };
      return s;
    };
    await manager.bootPersisted();
    assert.ok(started.includes(paired.session.id), 'paired session resumes without a QR scan');
    assert.ok(!started.includes(unpaired.session.id), 'an abandoned QR is not restarted');
    const r = await unpaired.row();
    assert.deepEqual([r.status, r.desired_state, r.qr], ['QR_EXPIRED', 'stopped', null]);
    // looking a session up returns the same object every time
    assert.equal(manager.get(paired.session.id), manager.get(paired.session.id));
    await assert.rejects(
      () => manager.ensure({ id: paired.session.id, organizationId: ORG_B, userId: paired.session.id }),
      /different organization/
    );
  });
});
