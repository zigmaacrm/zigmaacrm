import {
  isHostedLidUser,
  isHostedPnUser,
  isJidBroadcast,
  isJidGroup,
  isJidMetaAI,
  isJidNewsletter,
  isLidUser,
  isPnUser,
  jidDecode
} from '@whiskeysockets/baileys';

export const PN_SERVER = 's.whatsapp.net';
export const LID_SERVER = 'lid';

// WhatsApp system accounts that are not real conversations.
const SYSTEM_USERS = new Set(['0', 'server']);

/**
 * True for a JID the CRM must not sync at all: groups, communities,
 * broadcast lists, status updates, channels (newsletters) and bots.
 * Baileys is told to ignore these too, so they are never even decrypted.
 */
export function isIgnoredJid(jid) {
  if (!jid || typeof jid !== 'string') return true;
  return (
    isJidGroup(jid) ||
    isJidBroadcast(jid) ||
    isJidNewsletter(jid) ||
    isJidMetaAI(jid) ||
    jid.endsWith('@call') ||
    jid.endsWith('@bot')
  );
}

/**
 * Splits a 1-to-1 JID into the identifier the chat can be addressed by.
 * Returns null for anything that is not an individual user.
 *
 *   919876543210@s.whatsapp.net   -> { kind: 'pn',  user: '919876543210' }
 *   919876543210:12@s.whatsapp.net-> { kind: 'pn',  user: '919876543210' }
 *   123456789012345@lid           -> { kind: 'lid', user: '123456789012345' }
 */
export function parseUserJid(jid) {
  if (!jid || typeof jid !== 'string' || isIgnoredJid(jid)) return null;
  let normalized = jid.endsWith('@c.us') ? jid.replace(/@c\.us$/, `@${PN_SERVER}`) : jid;
  if (!normalized.includes('@')) {
    const d = digitsOnly(normalized);
    if (/^\d{7,16}$/.test(d)) return { kind: 'pn', user: d };
    return null;
  }
  const decoded = jidDecode(normalized);
  if (!decoded || !decoded.user) return null;
  const user = String(decoded.user);
  if (!/^\d{5,20}$/.test(user) || SYSTEM_USERS.has(user)) return null;
  if (isPnUser(normalized) || isHostedPnUser(normalized)) return { kind: 'pn', user };
  if (isLidUser(normalized) || isHostedLidUser(normalized)) return { kind: 'lid', user };
  return null;
}

export const pnJid = (digits) => `${digits}@${PN_SERVER}`;
export const lidJid = (digits) => `${digits}@${LID_SERVER}`;

/**
 * Builds the { pn, lid } reference of a 1-to-1 chat from every JID we were
 * given for it (the primary address plus the alternate one WhatsApp attaches
 * while accounts migrate from phone numbers to LIDs).
 */
export function chatRefFromJids(...jids) {
  const ref = { pn: null, lid: null };
  for (const jid of jids) {
    const parsed = parseUserJid(jid);
    if (!parsed) continue;
    if (parsed.kind === 'pn' && !ref.pn) ref.pn = parsed.user;
    if (parsed.kind === 'lid' && !ref.lid) ref.lid = parsed.user;
  }
  return ref.pn || ref.lid ? ref : null;
}

/** Canonical JID stored on the chat row: the phone number once it is known. */
export function canonicalJid(ref) {
  if (ref.pn) return pnJid(ref.pn);
  if (ref.lid) return lidJid(ref.lid);
  return null;
}

export function digitsOnly(value) {
  return String(value || '').replace(/[^0-9]/g, '');
}
