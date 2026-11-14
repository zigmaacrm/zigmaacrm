import {
  getContentType,
  jidDecode,
  normalizeMessageContent,
  proto,
  WAMessageStatus,
  WAMessageStubType
} from '@whiskeysockets/baileys';

const MAX_RAW_BYTES = 96 * 1024;
const MAX_BODY_CHARS = 65_000;

/** proto Long | number | string -> number (0 when absent). */
export function toNum(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number(value) || 0;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value.toNumber === 'function') return value.toNumber();
  if (typeof value.low === 'number') return value.low;
  return Number(value) || 0;
}

const STATUS_NAMES = {
  [WAMessageStatus.ERROR]: 'FAILED',
  [WAMessageStatus.PENDING]: 'PENDING',
  [WAMessageStatus.SERVER_ACK]: 'SENT',
  [WAMessageStatus.DELIVERY_ACK]: 'DELIVERED',
  [WAMessageStatus.READ]: 'READ',
  [WAMessageStatus.PLAYED]: 'READ'
};

export function statusName(status) {
  if (status === null || status === undefined) return null;
  return STATUS_NAMES[status] || null;
}

/** Media-bearing message kinds and the type stored in whatsapp_messages. */
const MEDIA_KINDS = {
  imageMessage: 'image',
  videoMessage: 'video',
  ptvMessage: 'video',
  audioMessage: 'audio',
  documentMessage: 'document',
  stickerMessage: 'sticker'
};

/** Content keys that never become a row on their own. */
const SILENT_KINDS = new Set([
  'protocolMessage',
  'reactionMessage',
  'encReactionMessage',
  'senderKeyDistributionMessage',
  'pollUpdateMessage',
  'keepInChatMessage',
  'pinInChatMessage',
  'messageContextInfo',
  'encEventResponseMessage',
  'secretEncryptedMessage',
  'associatedChildMessage',
  'statusNotificationMessage',
  'botInvokeMessage',
  'commentMessage',
  'encCommentMessage',
  'fastRatchetKeySenderKeyDistributionMessage'
]);

const clip = (text, max = MAX_BODY_CHARS) => {
  const s = typeof text === 'string' ? text : '';
  return s.length > max ? s.slice(0, max) : s;
};

/** Pulls every phone number out of a vCard, preferring WhatsApp's waid. */
export function phonesFromVcard(vcard) {
  const phones = [];
  if (typeof vcard !== 'string') return phones;
  for (const line of vcard.split(/\r?\n/)) {
    if (!/^(item\d+\.)?TEL/i.test(line)) continue;
    const waid = line.match(/waid=(\d{6,20})/i);
    const value = line.slice(line.lastIndexOf(':') + 1);
    const digits = waid ? waid[1] : value.replace(/[^0-9]/g, '');
    if (digits.length >= 6 && !phones.includes(digits)) phones.push(digits);
  }
  return phones;
}

function contactEntry(c) {
  const vcard = typeof c?.vcard === 'string' ? c.vcard : '';
  let name = c?.displayName || '';
  if (!name) {
    const fn = vcard.match(/^FN:(.+)$/m);
    if (fn) name = fn[1].trim();
  }
  return { name: clip(name, 255), vcard: clip(vcard, 8000), phones: phonesFromVcard(vcard) };
}

/**
 * Describes the visible content of a (normalised) proto.Message.
 * Returns null when the message carries nothing a chat thread would show.
 */
export function describeContent(content) {
  if (!content) return null;
  const kind = getContentType(content);
  if (!kind) return null;
  if (SILENT_KINDS.has(kind)) return null;

  const base = {
    kind,
    type: 'text',
    body: '',
    caption: null,
    mimeType: null,
    fileName: null,
    fileSize: null,
    duration: null,
    isVoiceNote: false,
    hasMedia: false,
    payload: null,
    contextInfo: null
  };

  if (kind === 'conversation') {
    return { ...base, body: clip(content.conversation) };
  }
  if (kind === 'extendedTextMessage') {
    const m = content.extendedTextMessage || {};
    return { ...base, body: clip(m.text), contextInfo: m.contextInfo || null };
  }

  if (MEDIA_KINDS[kind]) {
    const m = content[kind] || {};
    let type = MEDIA_KINDS[kind];
    let isVoiceNote = false;
    if (kind === 'audioMessage' && m.ptt) {
      type = 'ptt';
      isVoiceNote = true;
    }
    if (kind === 'videoMessage' && m.gifPlayback) type = 'gif';
    const caption = typeof m.caption === 'string' && m.caption.trim() ? clip(m.caption) : null;
    const mimeType = typeof m.mimetype === 'string' ? m.mimetype.slice(0, 127) : (type === 'sticker' ? 'image/webp' : null);
    const fileName = kind === 'documentMessage' ? clip(m.fileName || m.title || 'document', 255) : (type === 'sticker' ? 'sticker.webp' : null);
    return {
      ...base,
      type,
      body: caption || (type === 'sticker' ? '[sticker]' : ''),
      caption,
      mimeType,
      fileName,
      fileSize: toNum(m.fileLength) || null,
      duration: toNum(m.seconds) || null,
      isVoiceNote,
      hasMedia: Boolean(m.url || m.directPath || m.mediaKey),
      contextInfo: m.contextInfo || null
    };
  }

  if (kind === 'contactMessage') {
    const entry = contactEntry(content.contactMessage);
    return {
      ...base,
      type: 'contact',
      body: entry.name,
      payload: { contacts: [entry] },
      contextInfo: content.contactMessage?.contextInfo || null
    };
  }
  if (kind === 'contactsArrayMessage') {
    const list = (content.contactsArrayMessage?.contacts || []).map(contactEntry).slice(0, 50);
    return {
      ...base,
      type: 'contact',
      body: content.contactsArrayMessage?.displayName || list.map((c) => c.name).filter(Boolean).join(', '),
      payload: { contacts: list },
      contextInfo: content.contactsArrayMessage?.contextInfo || null
    };
  }

  if (kind === 'locationMessage' || kind === 'liveLocationMessage') {
    const m = content[kind] || {};
    const label = [m.name, m.address].filter(Boolean).join(' · ');
    return {
      ...base,
      type: 'location',
      body: clip(label || m.caption || '', 500),
      payload: {
        latitude: typeof m.degreesLatitude === 'number' ? m.degreesLatitude : null,
        longitude: typeof m.degreesLongitude === 'number' ? m.degreesLongitude : null,
        name: m.name || null,
        address: m.address || null,
        url: m.url || null,
        live: kind === 'liveLocationMessage'
      },
      contextInfo: m.contextInfo || null
    };
  }

  if (kind.startsWith('pollCreationMessage')) {
    const m = content[kind] || {};
    return {
      ...base,
      type: 'poll',
      body: clip(m.name || 'Poll', 500),
      payload: { options: (m.options || []).map((o) => o.optionName).filter(Boolean).slice(0, 20) },
      contextInfo: m.contextInfo || null
    };
  }

  // Interactive / business message variants: fall back to their readable text.
  const textual = {
    buttonsResponseMessage: (m) => m.selectedDisplayText || m.selectedButtonId,
    listResponseMessage: (m) => m.title || m.singleSelectReply?.selectedRowId,
    templateButtonReplyMessage: (m) => m.selectedDisplayText || m.selectedId,
    interactiveResponseMessage: (m) => m.body?.text,
    buttonsMessage: (m) => m.contentText || m.headerText || m.text,
    listMessage: (m) => [m.title, m.description].filter(Boolean).join('\n'),
    templateMessage: (m) =>
      m.hydratedTemplate?.hydratedContentText || m.hydratedFourRowTemplate?.hydratedContentText || m.fourRowTemplate?.content?.text,
    interactiveMessage: (m) => m.body?.text || m.header?.title,
    highlyStructuredMessage: (m) => m.hydratedHsm?.hydratedTemplate?.hydratedContentText,
    groupInviteMessage: (m) => m.caption || `Group invite: ${m.groupName || ''}`.trim(),
    eventMessage: (m) => [m.name, m.description].filter(Boolean).join('\n'),
    productMessage: (m) => m.product?.title || m.body,
    orderMessage: (m) => m.message || m.orderTitle,
    requestPhoneNumberMessage: () => 'Requested your phone number',
    call: () => 'Call',
    callLogMesssage: () => 'Call',
    scheduledCallCreationMessage: (m) => m.title || 'Scheduled call'
  };
  if (textual[kind]) {
    const m = content[kind] || {};
    const body = textual[kind](m);
    if (typeof body === 'string' && body.trim()) {
      return { ...base, body: clip(body), contextInfo: m.contextInfo || null };
    }
  }

  const label = kind.replace(/Message(V\d+)?$/i, '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return { ...base, type: 'unsupported', body: '', payload: { kind: label } };
}

/** Short single-line text used for the quoted-reply strip. */
export function previewText(desc) {
  if (!desc) return '';
  const text = (desc.caption || desc.body || '').replace(/\s+/g, ' ').trim();
  if (text) return text.slice(0, 200);
  switch (desc.type) {
    case 'image':
      return 'Photo';
    case 'video':
      return 'Video';
    case 'gif':
      return 'GIF';
    case 'ptt':
      return 'Voice message';
    case 'audio':
      return 'Audio';
    case 'document':
      return desc.fileName || 'Document';
    case 'sticker':
      return 'Sticker';
    case 'contact':
      return 'Contact';
    case 'location':
      return 'Location';
    case 'poll':
      return 'Poll';
    default:
      return 'Message';
  }
}

function extractQuoted(contextInfo, meUsers) {
  if (!contextInfo?.stanzaId || !contextInfo.quotedMessage) return null;
  const quotedDesc = describeContent(normalizeMessageContent(contextInfo.quotedMessage));
  const participantUser = contextInfo.participant ? jidDecode(contextInfo.participant)?.user : null;
  return {
    id: String(contextInfo.stanzaId),
    from_me: Boolean(participantUser && meUsers.has(String(participantUser))),
    type: quotedDesc?.type || 'text',
    text: previewText(quotedDesc)
  };
}

/**
 * The media descriptor (url, directPath, mediaKey ...) is all that is needed
 * to download a file later, so the stored copy drops thumbnails and quoted
 * context. Returns null when there is nothing worth keeping.
 */
function encodeForStorage(content, kind) {
  try {
    const inner = content[kind];
    if (!inner || typeof inner !== 'object') return null;
    const slim = { ...inner };
    delete slim.jpegThumbnail;
    delete slim.contextInfo;
    delete slim.pngThumbnail;
    delete slim.thumbnailDirectPath;
    delete slim.thumbnailSha256;
    delete slim.thumbnailEncSha256;
    delete slim.streamingSidecar;
    const bytes = proto.Message.encode({ [kind]: slim }).finish();
    if (bytes.length === 0 || bytes.length > MAX_RAW_BYTES) return null;
    return Buffer.from(bytes);
  } catch {
    return null;
  }
}

function collectReactions(msg) {
  const out = {};
  for (const r of msg.reactions || []) {
    if (!r) continue;
    const side = r.key?.fromMe ? 'me' : 'them';
    if (r.text) out[side] = String(r.text).slice(0, 16);
    else delete out[side];
  }
  return Object.keys(out).length ? out : null;
}

export function reactionDisplay(reactions) {
  if (!reactions) return null;
  const parts = [];
  for (const side of ['them', 'me']) {
    if (reactions[side] && !parts.includes(reactions[side])) parts.push(reactions[side]);
  }
  return parts.length ? parts.join('').slice(0, 50) : null;
}

/**
 * Converts a Baileys WAMessage into the flat record the store persists.
 * Returns null for anything that should not appear in a 1-to-1 thread
 * (protocol traffic, reactions, key distribution, empty stubs ...).
 *
 * @param msg      WAMessage
 * @param meUsers  Set of the linked account's own user ids (phone + LID)
 */
export function parseMessage(msg, meUsers = new Set()) {
  const key = msg?.key;
  if (!key?.id || !key.remoteJid) return null;

  const fromMe = Boolean(key.fromMe);
  const timestamp = toNum(msg.messageTimestamp) || Math.floor(Date.now() / 1000);
  const rawContent = msg.message || null;
  const viewOnce = Boolean(
    key.isViewOnce || rawContent?.viewOnceMessage || rawContent?.viewOnceMessageV2 || rawContent?.viewOnceMessageV2Extension
  );

  const record = {
    waId: String(key.id),
    remoteJid: key.remoteJid,
    remoteJidAlt: key.remoteJidAlt || null,
    fromMe,
    timestamp,
    pushName: !fromMe && typeof msg.pushName === 'string' && msg.pushName.trim() ? msg.pushName.trim().slice(0, 255) : null,
    verifiedName: !fromMe && typeof msg.verifiedBizName === 'string' ? msg.verifiedBizName.slice(0, 255) : null,
    status: fromMe ? statusName(msg.status) || 'SENT' : 'DELIVERED',
    type: 'text',
    body: '',
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
    kind: null,
    reactions: collectReactions(msg),
    isDeleted: false
  };

  const content = normalizeMessageContent(rawContent);

  if (!content || !getContentType(content)) {
    if (msg.messageStubType === WAMessageStubType.REVOKE) {
      return { ...record, type: 'revoked', isDeleted: true };
    }
    if (msg.messageStubType === WAMessageStubType.CIPHERTEXT) {
      // Not decryptable yet. Baileys asks the sender to resend; the row is
      // replaced when the real message arrives under the same id.
      return { ...record, type: viewOnce ? 'view_once' : 'ciphertext' };
    }
    if (viewOnce) return { ...record, type: 'view_once' };
    return null;
  }

  const desc = describeContent(content);
  if (!desc) return null;

  record.kind = desc.kind;
  record.type = desc.type;
  record.body = desc.body || '';
  record.caption = desc.caption;
  record.mimeType = desc.mimeType;
  record.fileName = desc.fileName;
  record.fileSize = desc.fileSize;
  record.duration = desc.duration;
  record.isVoiceNote = desc.isVoiceNote;
  record.hasMedia = desc.hasMedia;
  record.payload = desc.payload;
  record.quoted = extractQuoted(desc.contextInfo, meUsers);

  if (viewOnce && desc.hasMedia) {
    // View-once media cannot be opened on linked devices; WhatsApp Web shows a
    // notice instead of the content, and so do we.
    record.type = 'view_once';
    record.hasMedia = false;
    record.body = '';
    record.caption = null;
    return record;
  }

  if (desc.type !== 'text' && desc.type !== 'unsupported') {
    record.raw = encodeForStorage(content, desc.kind);
  }
  return record;
}

/** Rebuilds a proto.Message from a stored row (for retries, quotes, downloads). */
export function messageFromRow(row) {
  if (row.raw_message) {
    try {
      return proto.Message.decode(row.raw_message);
    } catch {
      /* fall through */
    }
  }
  const text = row.message_body || row.caption || '';
  if (!text) return undefined;
  return proto.Message.fromObject({ conversation: text });
}

/** Extracts the new text of an edited message from a messages.update payload. */
export function editedText(updateMessage) {
  const inner = updateMessage?.editedMessage?.message || updateMessage?.protocolMessage?.editedMessage || null;
  const content = normalizeMessageContent(inner);
  const desc = describeContent(content);
  if (!desc) return null;
  return { body: desc.body || '', caption: desc.caption, type: desc.type };
}
