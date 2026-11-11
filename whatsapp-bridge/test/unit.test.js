import assert from 'node:assert/strict';
import { test } from 'node:test';
import { proto, WAMessageStubType } from '@whiskeysockets/baileys';
import { deriveBridgeToken, parseDatabaseUrl, resolveSsl } from '../src/config.js';
import { parseSchema, readSchemaFile } from '../src/db.js';
import { canonicalJid, chatRefFromJids, isIgnoredJid, parseUserJid } from '../src/jid.js';
import { editedText, messageFromRow, parseMessage, phonesFromVcard, reactionDisplay, statusName } from '../src/message-parser.js';
import { presignUrl } from '../src/s3.js';
import { isMuted } from '../src/session.js';
import { extensionFor } from '../src/storage.js';

const ME = new Set(['919000000001', '111000111000111']);
const key = (over = {}) => ({ remoteJid: '919876543210@s.whatsapp.net', id: 'ABCDEF0123456789', fromMe: false, ...over });

// ------------------------------------------------------------------ config
test('DATABASE_URL: asyncpg scheme, "@" in password, ssl flag', () => {
  const cfg = parseDatabaseUrl('postgresql+asyncpg://crm_user:p@ss:word@db.example.com:6543/zigmaa?ssl=require');
  assert.equal(cfg.host, 'db.example.com');
  assert.equal(cfg.port, 6543);
  assert.equal(cfg.user, 'crm_user');
  assert.equal(cfg.password, 'p@ss:word');
  assert.equal(cfg.database, 'zigmaa');
  assert.equal(resolveSsl(cfg, {}), 'require');
});

test('DATABASE_URL: local database uses no TLS, percent-encoding is decoded', () => {
  const cfg = parseDatabaseUrl('postgresql://postgres:a%40b@localhost/zigmaa_crm');
  assert.equal(cfg.password, 'a@b');
  assert.equal(cfg.port, 5432);
  assert.equal(resolveSsl(cfg, {}), false);
  assert.equal(resolveSsl({ ...cfg, host: 'dpg-abc.oregon-postgres.render.com' }, {}), 'require');
  assert.equal(resolveSsl({ ...cfg, host: 'dpg-abc.oregon-postgres.render.com' }, { WA_DB_SSL: 'disable' }), false);
});

test('DATABASE_URL: sqlite is rejected, POSTGRES_* variables are a fallback', () => {
  assert.throws(() => parseDatabaseUrl('sqlite+aiosqlite:///./zigmaa_crm.db'), /requires PostgreSQL/);
  const cfg = parseDatabaseUrl('', { POSTGRES_PASSWORD: 'x', POSTGRES_SERVER: 'pg', POSTGRES_DB: 'crm', POSTGRES_USER: 'u', POSTGRES_PORT: '5433' });
  assert.deepEqual([cfg.host, cfg.port, cfg.user, cfg.database], ['pg', 5433, 'u', 'crm']);
  assert.equal(parseDatabaseUrl('', {}), null);
});

test('bridge token: explicit wins, otherwise derived from SECRET_KEY, never a built-in default', () => {
  assert.equal(deriveBridgeToken({ WHATSAPP_BRIDGE_TOKEN: 'abc', SECRET_KEY: 's' }), 'abc');
  const derived = deriveBridgeToken({ SECRET_KEY: 's3cret' });
  assert.match(derived, /^[0-9a-f]{64}$/);
  assert.equal(derived, deriveBridgeToken({ SECRET_KEY: 's3cret' }));
  assert.notEqual(derived, deriveBridgeToken({ SECRET_KEY: 'other' }));
  assert.equal(deriveBridgeToken({}), null);
});

// ------------------------------------------------------------------ schema
test('schema.sql parses, and directives attach to the statement below them', () => {
  const statements = parseSchema(readSchemaFile());
  assert.ok(statements.length > 40);
  const reattribution = statements.find((s) => s.once === 'legacy_org_reattribution');
  assert.deepEqual(reattribution.requires, ['users']);
  assert.match(reattribution.sql, /^UPDATE whatsapp_messages m/);
  assert.ok(statements.every((s) => !s.sql.trim().endsWith(';')));
  // the explanatory header mentions the directives but must not create any
  assert.equal(statements[0].once, null);
  assert.deepEqual(statements[0].requires, []);
  const onces = statements.filter((s) => s.once).map((s) => s.once);
  assert.equal(new Set(onces).size, onces.length, '@once names must be unique');
});

// ---------------------------------------------------------------------- s3
test('SigV4 pre-signed URL matches the AWS documentation example', () => {
  const url = presignUrl(
    {
      endpoint: 'https://examplebucket.s3.amazonaws.com',
      region: 'us-east-1',
      bucket: 'examplebucket',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'
    },
    { method: 'GET', key: 'test.txt', expiresIn: 86400, now: new Date('2013-05-24T00:00:00Z'), pathStyle: false }
  );
  assert.ok(url.startsWith('https://examplebucket.s3.amazonaws.com/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256'));
  assert.ok(url.endsWith('X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404'), url);
});

test('path-style URLs encode the object key', () => {
  const url = presignUrl(
    { endpoint: 'https://acc.r2.cloudflarestorage.com', region: 'auto', bucket: 'wa', accessKeyId: 'k', secretAccessKey: 's' },
    { method: 'PUT', key: 'whatsapp/org 1/a+b.jpg' }
  );
  assert.ok(url.startsWith('https://acc.r2.cloudflarestorage.com/wa/whatsapp/org%201/a%2Bb.jpg?'));
});

// --------------------------------------------------------------------- jid
test('only individual users are accepted; groups, status, channels and bots are ignored', () => {
  for (const jid of ['120363012345678901@g.us', 'status@broadcast', '12345@broadcast', '120363@newsletter', '13135550002@bot', '']) {
    assert.equal(isIgnoredJid(jid), true, jid);
    assert.equal(parseUserJid(jid), null, jid);
  }
  assert.deepEqual(parseUserJid('919876543210@s.whatsapp.net'), { kind: 'pn', user: '919876543210' });
  assert.deepEqual(parseUserJid('919876543210:17@s.whatsapp.net'), { kind: 'pn', user: '919876543210' });
  assert.deepEqual(parseUserJid('919876543210@c.us'), { kind: 'pn', user: '919876543210' });
  assert.deepEqual(parseUserJid('123456789012345@lid'), { kind: 'lid', user: '123456789012345' });
  assert.equal(parseUserJid('0@s.whatsapp.net'), null);
});

test('chat reference combines the primary and alternate address', () => {
  assert.deepEqual(chatRefFromJids('123456789012345@lid', '919876543210@s.whatsapp.net'), { pn: '919876543210', lid: '123456789012345' });
  assert.deepEqual(chatRefFromJids('123456789012345@lid', undefined), { pn: null, lid: '123456789012345' });
  assert.equal(chatRefFromJids('120363012345678901@g.us'), null);
  assert.equal(canonicalJid({ pn: '919876543210', lid: '1' }), '919876543210@s.whatsapp.net');
  assert.equal(canonicalJid({ pn: null, lid: '123456789012345' }), '123456789012345@lid');
});

// ------------------------------------------------------------------ parser
test('plain text and extended text', () => {
  const a = parseMessage({ key: key(), messageTimestamp: 1700000000, pushName: 'Asha', message: { conversation: 'hello' } }, ME);
  assert.equal(a.type, 'text');
  assert.equal(a.body, 'hello');
  assert.equal(a.pushName, 'Asha');
  assert.equal(a.status, 'DELIVERED');
  assert.equal(a.timestamp, 1700000000);
  assert.equal(a.raw, null);

  const b = parseMessage({ key: key({ fromMe: true }), status: 4, message: { extendedTextMessage: { text: 'sent from phone' } } }, ME);
  assert.equal(b.fromMe, true);
  assert.equal(b.status, 'READ');
  assert.equal(b.pushName, null);
});

test('quoted replies carry id, direction, type and preview', () => {
  const msg = {
    key: key(),
    message: {
      extendedTextMessage: {
        text: 'sure',
        contextInfo: {
          stanzaId: 'QUOTED1',
          participant: '919000000001@s.whatsapp.net',
          quotedMessage: { imageMessage: { caption: 'price list', url: 'https://x', mediaKey: Buffer.from('k') } }
        }
      }
    }
  };
  const rec = parseMessage(msg, ME);
  assert.deepEqual(rec.quoted, { id: 'QUOTED1', from_me: true, type: 'image', text: 'price list' });

  msg.message.extendedTextMessage.contextInfo.participant = '919876543210@s.whatsapp.net';
  msg.message.extendedTextMessage.contextInfo.quotedMessage = { audioMessage: { ptt: true, url: 'https://x' } };
  assert.deepEqual(parseMessage(msg, ME).quoted, { id: 'QUOTED1', from_me: false, type: 'ptt', text: 'Voice message' });
});

test('media messages: image, video, gif, voice note, audio, document, sticker', () => {
  const media = (content) => parseMessage({ key: key(), message: content }, ME);

  const image = media({ imageMessage: { url: 'https://mmg/x', mediaKey: Buffer.from('k'), mimetype: 'image/jpeg', caption: 'see this', fileLength: 2048, jpegThumbnail: Buffer.alloc(4000) } });
  assert.deepEqual([image.type, image.caption, image.body, image.mimeType, image.fileSize, image.hasMedia], ['image', 'see this', 'see this', 'image/jpeg', 2048, true]);
  assert.ok(Buffer.isBuffer(image.raw));
  assert.ok(image.raw.length < 500, 'thumbnail must be stripped from the stored descriptor');
  const restored = proto.Message.decode(image.raw);
  assert.equal(restored.imageMessage.url, 'https://mmg/x');
  assert.equal(restored.imageMessage.jpegThumbnail?.length || 0, 0);

  assert.equal(media({ videoMessage: { url: 'u', seconds: 12 } }).type, 'video');
  assert.equal(media({ videoMessage: { url: 'u', gifPlayback: true } }).type, 'gif');

  const ptt = media({ audioMessage: { url: 'u', ptt: true, seconds: 7, mimetype: 'audio/ogg; codecs=opus' } });
  assert.deepEqual([ptt.type, ptt.isVoiceNote, ptt.duration], ['ptt', true, 7]);
  const audio = media({ audioMessage: { url: 'u', ptt: false } });
  assert.deepEqual([audio.type, audio.isVoiceNote], ['audio', false]);

  const doc = media({ documentWithCaptionMessage: { message: { documentMessage: { url: 'u', fileName: 'quote.pdf', mimetype: 'application/pdf', caption: 'the quote' } } } });
  assert.deepEqual([doc.type, doc.fileName, doc.caption, doc.mimeType], ['document', 'quote.pdf', 'the quote', 'application/pdf']);

  const sticker = media({ stickerMessage: { url: 'u', mimetype: 'image/webp' } });
  assert.deepEqual([sticker.type, sticker.mimeType], ['sticker', 'image/webp']);
});

test('contact cards and locations become structured payloads', () => {
  const vcard = 'BEGIN:VCARD\nVERSION:3.0\nFN:Ravi Kumar\nTEL;type=CELL;waid=919812345678:+91 98123 45678\nEND:VCARD';
  const card = parseMessage({ key: key(), message: { contactMessage: { displayName: 'Ravi Kumar', vcard } } }, ME);
  assert.equal(card.type, 'contact');
  assert.equal(card.body, 'Ravi Kumar');
  assert.deepEqual(card.payload.contacts[0].phones, ['919812345678']);
  assert.deepEqual(phonesFromVcard('TEL;TYPE=WORK:+1 (415) 555-0100'), ['14155550100']);

  const many = parseMessage({ key: key(), message: { contactsArrayMessage: { contacts: [{ displayName: 'A', vcard }, { displayName: 'B', vcard }] } } }, ME);
  assert.equal(many.payload.contacts.length, 2);

  const loc = parseMessage({ key: key(), message: { locationMessage: { degreesLatitude: 13.08, degreesLongitude: 80.27, name: 'Office' } } }, ME);
  assert.deepEqual([loc.type, loc.payload.latitude, loc.payload.longitude, loc.body], ['location', 13.08, 80.27, 'Office']);
});

test('protocol traffic never becomes a chat row', () => {
  const silent = [
    { protocolMessage: { type: 0, key: key() } },
    { reactionMessage: { text: '👍', key: key() } },
    { senderKeyDistributionMessage: { groupId: 'x' } },
    { pollUpdateMessage: {} }
  ];
  for (const message of silent) assert.equal(parseMessage({ key: key(), message }, ME), null);
  assert.equal(parseMessage({ key: key() }, ME), null);
  assert.equal(parseMessage({ key: { id: 'x' }, message: { conversation: 'no jid' } }, ME), null);
});

test('stubs: revoke, undecryptable, view-once', () => {
  const revoked = parseMessage({ key: key(), messageStubType: WAMessageStubType.REVOKE }, ME);
  assert.deepEqual([revoked.type, revoked.isDeleted], ['revoked', true]);

  const cipher = parseMessage({ key: key(), messageStubType: WAMessageStubType.CIPHERTEXT, messageStubParameters: ['Bad MAC'] }, ME);
  assert.equal(cipher.type, 'ciphertext');

  const viewOnce = parseMessage({ key: key(), message: { viewOnceMessageV2: { message: { imageMessage: { url: 'u', caption: 'secret' } } } } }, ME);
  assert.deepEqual([viewOnce.type, viewOnce.hasMedia, viewOnce.body, viewOnce.raw], ['view_once', false, '', null]);
});

test('unknown content is kept as "unsupported" instead of being dropped', () => {
  const rec = parseMessage({ key: key(), message: { someFutureMessage: { foo: 1 } } }, ME);
  assert.equal(rec.type, 'unsupported');
  assert.equal(rec.payload.kind, 'some future');
});

test('history reactions, status names, edits, retry reconstruction', () => {
  const rec = parseMessage(
    { key: key(), message: { conversation: 'ok' }, reactions: [{ key: { fromMe: true }, text: '👍' }, { key: { fromMe: false }, text: '❤️' }] },
    ME
  );
  assert.deepEqual(rec.reactions, { me: '👍', them: '❤️' });
  assert.equal(reactionDisplay(rec.reactions), '❤️👍');
  assert.equal(reactionDisplay(null), null);

  assert.deepEqual([0, 1, 2, 3, 4, 5].map(statusName), ['FAILED', 'PENDING', 'SENT', 'DELIVERED', 'READ', 'READ']);
  assert.equal(statusName(undefined), null);

  assert.deepEqual(editedText({ editedMessage: { message: { conversation: 'fixed typo' } } }), { body: 'fixed typo', caption: null, type: 'text' });
  assert.equal(editedText({ conversation: 'not an edit' }), null);

  assert.equal(messageFromRow({ message_body: 'hello again' }).conversation, 'hello again');
  const raw = Buffer.from(proto.Message.encode({ imageMessage: { url: 'https://mmg/y' } }).finish());
  assert.equal(messageFromRow({ raw_message: raw, message_body: 'caption' }).imageMessage.url, 'https://mmg/y');
});

// ------------------------------------------------------------------- misc
test('mute expiry: forever, seconds, milliseconds, past', () => {
  const now = Date.parse('2026-01-01T00:00:00Z');
  assert.equal(isMuted(-1, now), true);
  assert.equal(isMuted(0, now), false);
  assert.equal(isMuted(now / 1000 + 60, now), true);
  assert.equal(isMuted(now + 60_000, now), true);
  assert.equal(isMuted(now - 60_000, now), false, 'an expired millisecond timestamp is not muted');
  assert.equal(isMuted(now / 1000 - 60, now), false);
});

test('file extensions for stored media', () => {
  assert.equal(extensionFor('audio/ogg; codecs=opus', null), 'ogg');
  assert.equal(extensionFor('application/pdf', 'Quote Final.PDF'), 'pdf');
  assert.equal(extensionFor('application/x-unknown', 'noext'), 'bin');
});
