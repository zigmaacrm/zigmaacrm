const express = require('express');
const cors = require('cors');
const qrcode = require('qrcode');
const pino = require('pino');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

let ffmpegPath = null;
try {
  ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
} catch (e) {
  console.warn('[WhatsApp Bridge] @ffmpeg-installer/ffmpeg not loaded:', e.message);
}

// Global crash guards so Bad MAC / Session Errors NEVER terminate the bridge process
process.on('uncaughtException', (err) => {
  console.warn('[WhatsApp Error Guard] Caught exception:', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.warn('[WhatsApp Error Guard] Caught rejection:', reason?.message || reason);
});
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  downloadMediaMessage
} = require('@whiskeysockets/baileys');

const app = express();
app.use(cors());
app.use(express.json({ limit: '25mb' }));

const PORT = process.env.PORT || 5001;
const BACKEND_BASE = (process.env.FASTAPI_BASE_URL || 'https://zigmaacrm-backend.onrender.com').trim().replace(/\/+$/, '');
const FASTAPI_WEBHOOK_URL = process.env.FASTAPI_WEBHOOK_URL || `${BACKEND_BASE}/api/v1/webhooks/whatsapp/inbound-qr`;
const FASTAPI_BULK_SYNC_URL = process.env.FASTAPI_BULK_SYNC_URL || `${BACKEND_BASE}/api/v1/whatsapp/contacts/bulk-sync`;
const FASTAPI_SYNC_HISTORY_URL = process.env.FASTAPI_SYNC_HISTORY_URL || `${BACKEND_BASE}/api/v1/whatsapp/chats/sync-history`;
const FASTAPI_STATUS_UPDATE_URL = process.env.FASTAPI_STATUS_UPDATE_URL || `${BACKEND_BASE}/api/v1/webhooks/whatsapp/status-update`;

// Legacy single-session auth directory
const AUTH_DIR = path.join(__dirname, 'auth_info_baileys');
// Multi-user sessions directory
const SESSIONS_BASE_DIR = path.join(__dirname, 'sessions');
if (!fs.existsSync(SESSIONS_BASE_DIR)) {
  fs.mkdirSync(SESSIONS_BASE_DIR, { recursive: true });
}

// Uploads directory for decrypted WhatsApp media
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const MONO_UPLOADS_DIR = path.join(__dirname, '..', 'uploads', 'whatsapp');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
try { if (!fs.existsSync(MONO_UPLOADS_DIR)) fs.mkdirSync(MONO_UPLOADS_DIR, { recursive: true }); } catch (_) {}

app.use('/media/whatsapp', express.static(UPLOADS_DIR));
app.use('/media/whatsapp', express.static(MONO_UPLOADS_DIR));
app.use('/uploads/whatsapp', express.static(UPLOADS_DIR));
app.use('/uploads/whatsapp', express.static(MONO_UPLOADS_DIR));

async function convertAudioToWhatsAppPtt(inputBuffer) {
  if (!ffmpegPath || !inputBuffer || inputBuffer.length === 0) {
    const fallbackWaveform = new Uint8Array(64);
    for (let i = 0; i < 64; i++) fallbackWaveform[i] = Math.floor(15 + Math.random() * 25);
    return { filePath: null, buffer: inputBuffer, seconds: 1, waveform: fallbackWaveform };
  }

  const tmpId = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const tmpIn = path.join(UPLOADS_DIR, `ptt_in_${tmpId}.bin`);
  const tmpOut = path.join(UPLOADS_DIR, `ptt_out_${tmpId}.ogg`);

  try {
    fs.writeFileSync(tmpIn, inputBuffer);

    // Official WhatsApp PTT Audio Transcoder
    const { execFileSync } = require('child_process');
    execFileSync(ffmpegPath, [
      '-y',
      '-i', tmpIn,
      '-vn',
      '-c:a', 'libopus',
      '-b:a', '48k',
      '-ar', '48000',
      '-ac', '1',
      '-avoid_negative_ts', 'make_zero',
      '-f', 'ogg',
      tmpOut
    ], { stdio: 'pipe' });

    const oggBuffer = fs.readFileSync(tmpOut);

    // Compute duration
    let durationSeconds = 1;
    try {
      const mm = await import('music-metadata');
      const meta = await mm.parseFile(tmpOut);
      if (meta?.format?.duration && isFinite(meta.format.duration)) {
        durationSeconds = Math.max(1, Math.round(meta.format.duration));
      }
    } catch (_) {}

    // Generate WhatsApp 64-point amplitude waveform
    let waveform = null;
    try {
      const AudioContext = require('audio-decode');
      const decoded = await AudioContext(oggBuffer);
      const channelData = decoded.getChannelData(0);
      const blockSize = Math.floor(channelData.length / 64);
      waveform = new Uint8Array(64);
      for (let i = 0; i < 64; i++) {
        let sum = 0;
        for (let j = 0; j < blockSize; j++) {
          sum += Math.abs(channelData[i * blockSize + j] || 0);
        }
        const avg = sum / (blockSize || 1);
        waveform[i] = Math.min(100, Math.max(5, Math.floor(avg * 150)));
      }
    } catch (_) {
      waveform = new Uint8Array(64);
      for (let i = 0; i < 64; i++) {
        waveform[i] = Math.floor(20 + Math.sin(i / 3) * 15 + Math.random() * 20);
      }
    }

    try { fs.unlinkSync(tmpIn); } catch (_) {}

    return {
      filePath: tmpOut,
      buffer: oggBuffer,
      seconds: durationSeconds,
      waveform: waveform
    };
  } catch (err) {
    console.error('[WhatsApp PTT Audio Transcode Error]:', err.message);
    try { if (fs.existsSync(tmpIn)) fs.unlinkSync(tmpIn); } catch (_) {}
    try { if (fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut); } catch (_) {}
    const fallbackWaveform = new Uint8Array(64);
    for (let i = 0; i < 64; i++) fallbackWaveform[i] = Math.floor(15 + Math.random() * 25);
    return {
      filePath: null,
      buffer: inputBuffer,
      seconds: 1,
      waveform: fallbackWaveform
    };
  }
}

// Global In-Memory Caches
const msgStore = new Map();
const sentFromCrmMsgIds = new Set();
const logger = pino({ level: 'silent' });

// ==========================================
// Multi-Session Architecture Store
// Map<sessionId, SessionObject>
// ==========================================
const sessions = new Map();

function sanitizeSessionId(raw) {
  if (!raw || typeof raw !== 'string') return 'default';
  const clean = raw.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
  return clean || 'default';
}

function getSessionAuthDir(sId) {
  if (sId === 'default' && fs.existsSync(AUTH_DIR)) {
    return AUTH_DIR;
  }
  return path.join(SESSIONS_BASE_DIR, `session_${sId}`);
}

function loadLidMappingsForSession(session) {
  if (!session || !fs.existsSync(session.authDir)) return;
  try {
    const files = fs.readdirSync(session.authDir);
    for (const f of files) {
      if (f.startsWith('lid-mapping-') && !f.includes('_reverse') && f.endsWith('.json')) {
        const phone = f.replace('lid-mapping-', '').replace('.json', '');
        try {
          const lid = JSON.parse(fs.readFileSync(path.join(session.authDir, f), 'utf8'));
          if (lid) session.lidToPhoneMap.set(String(lid).trim(), String(phone).trim());
        } catch (_) {}
      }
    }
  } catch (err) {
    console.error(`[WhatsApp Gateway] Failed to index LID mappings for ${session.id}:`, err.message);
  }
}

function getSession(sessionId, createIfMissing = true) {
  const sId = sanitizeSessionId(sessionId);
  if (sessions.has(sId)) {
    return sessions.get(sId);
  }
  if (!createIfMissing) {
    return null;
  }
  const authDir = getSessionAuthDir(sId);
  if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true });
  }
  const session = {
    id: sId,
    sock: null,
    qr: null,
    status: 'DISCONNECTED', // 'DISCONNECTED' | 'SCAN_QR' | 'CONNECTED'
    phone: null,
    name: null,
    avatarUrl: null,
    isStarting: false,
    authDir: authDir,
    lidToPhoneMap: new Map(),
    pendingContacts: new Map(),
    contactsStore: new Map(),
    syncTimeout: null,
    reconnectTimer: null,
    isFetchingAvatar: false
  };
  sessions.set(sId, session);
  loadLidMappingsForSession(session);
  return session;
}

function isValidMobileNumber(phone) {
  if (!phone) return false;
  const clean = String(phone).replace(/[^0-9]/g, '');
  return clean.length >= 8 && clean.length <= 13;
}

function resolvePhoneFromJid(jid, session) {
  if (!jid) return null;
  const str = String(jid).trim();
  if (
    str === 'status@broadcast' ||
    str.endsWith('@g.us') ||
    str.endsWith('@broadcast') ||
    str.endsWith('@newsletter')
  ) {
    return null;
  }
  if (str.endsWith('@s.whatsapp.net') || str.endsWith('@c.us')) {
    const raw = str.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
    return isValidMobileNumber(raw) ? raw : null;
  }
  if (str.endsWith('@lid')) {
    const cleanLid = str.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
    if (session && session.lidToPhoneMap.has(cleanLid)) {
      const mapped = session.lidToPhoneMap.get(cleanLid);
      return isValidMobileNumber(mapped) ? mapped : null;
    }
    if (session && fs.existsSync(session.authDir)) {
      const revFile = path.join(session.authDir, `lid-mapping-${cleanLid}_reverse.json`);
      if (fs.existsSync(revFile)) {
        try {
          const pn = JSON.parse(fs.readFileSync(revFile, 'utf8'));
          if (pn) {
            const cleanPn = String(pn).replace(/[^0-9]/g, '');
            if (isValidMobileNumber(cleanPn)) {
              if (session) session.lidToPhoneMap.set(cleanLid, cleanPn);
              return cleanPn;
            }
          }
        } catch (_) {}
      }
    }
    return null;
  }
  return null;
}

function extractMessageBody(m) {
  if (!m) return '';
  let msg = m;
  while (
    msg.ephemeralMessage?.message ||
    msg.viewOnceMessage?.message ||
    msg.viewOnceMessageV2?.message ||
    msg.documentWithCaptionMessage?.message ||
    msg.editedMessage?.message?.protocolMessage?.editedMessage ||
    msg.deviceSentMessage?.message
  ) {
    msg =
      msg.ephemeralMessage?.message ||
      msg.viewOnceMessage?.message ||
      msg.viewOnceMessageV2?.message ||
      msg.documentWithCaptionMessage?.message ||
      msg.editedMessage?.message?.protocolMessage?.editedMessage ||
      msg.deviceSentMessage?.message;
  }

  if (typeof msg.conversation === 'string' && msg.conversation.trim()) {
    return msg.conversation.trim();
  }
  if (typeof msg.extendedTextMessage?.text === 'string' && msg.extendedTextMessage.text.trim()) {
    const text = msg.extendedTextMessage.text.trim();
    const contextInfo = msg.extendedTextMessage.contextInfo;
    if (contextInfo?.quotedMessage) {
      const q = contextInfo.quotedMessage;
      let qText = (typeof q.conversation === 'string' ? q.conversation : '') ||
                  (typeof q.extendedTextMessage?.text === 'string' ? q.extendedTextMessage.text : '') ||
                  (typeof q.imageMessage?.caption === 'string' ? q.imageMessage.caption : '') ||
                  (q.audioMessage ? 'Voice note' : '') ||
                  (q.imageMessage ? 'Photo' : '') ||
                  (q.stickerMessage ? 'Sticker' : '') ||
                  (q.documentMessage ? 'Document' : '') ||
                  '';
      qText = qText.replace(/[\r\n]+/g, ' ').trim().slice(0, 100);
      if (qText) {
        const sender = contextInfo.fromMe ? 'You' : 'Contact';
        return `> *${sender}*: ${qText}\n\n${text}`;
      }
    }
    return text;
  }
  if (typeof msg.imageMessage?.caption === 'string' && msg.imageMessage.caption.trim()) {
    return msg.imageMessage.caption.trim();
  }
  if (typeof msg.videoMessage?.caption === 'string' && msg.videoMessage.caption.trim()) {
    return msg.videoMessage.caption.trim();
  }
  if (typeof msg.documentMessage?.caption === 'string' && msg.documentMessage.caption.trim()) {
    return msg.documentMessage.caption.trim();
  }
  if (msg.reactionMessage) {
    const emoji = msg.reactionMessage.text || '';
    return emoji ? `Reacted ${emoji}` : '';
  }
  if (msg.buttonsResponseMessage?.selectedDisplayText) {
    return msg.buttonsResponseMessage.selectedDisplayText;
  }
  if (msg.listResponseMessage?.title) {
    return msg.listResponseMessage.title;
  }
  if (msg.templateButtonReplyMessage?.selectedId) {
    return msg.templateButtonReplyMessage.selectedId;
  }
  if (msg.imageMessage) return '[Image Attachment]';
  if (msg.documentMessage) return '[Document Attachment]';
  if (msg.audioMessage) return '[Voice Note]';
  if (msg.stickerMessage) return '[Sticker]';
  if (msg.contactMessage) return '[Contact Card]';
  if (msg.locationMessage) return '[Location]';
  return '';
}

function unwrapMessage(m) {
  if (!m) return null;
  let msg = m;
  while (
    msg.ephemeralMessage?.message ||
    msg.viewOnceMessage?.message ||
    msg.viewOnceMessageV2?.message ||
    msg.documentWithCaptionMessage?.message ||
    msg.editedMessage?.message?.protocolMessage?.editedMessage ||
    msg.deviceSentMessage?.message
  ) {
    msg =
      msg.ephemeralMessage?.message ||
      msg.viewOnceMessage?.message ||
      msg.viewOnceMessageV2?.message ||
      msg.documentWithCaptionMessage?.message ||
      msg.editedMessage?.message?.protocolMessage?.editedMessage ||
      msg.deviceSentMessage?.message;
  }
  return msg;
}

function extractQuotedContext(rawMessage) {
  if (!rawMessage) return null;
  const unwrapped = unwrapMessage(rawMessage);
  if (!unwrapped) return null;
  const contextInfo =
    unwrapped?.extendedTextMessage?.contextInfo ||
    unwrapped?.imageMessage?.contextInfo ||
    unwrapped?.videoMessage?.contextInfo ||
    unwrapped?.audioMessage?.contextInfo ||
    unwrapped?.documentMessage?.contextInfo ||
    unwrapped?.stickerMessage?.contextInfo;

  if (!contextInfo?.quotedMessage) return null;
  const qMsg = unwrapMessage(contextInfo.quotedMessage);
  let qText = extractMessageBody(qMsg);
  if (!qText) {
    if (qMsg?.imageMessage) qText = '📷 Photo';
    else if (qMsg?.audioMessage) qText = qMsg.audioMessage.ptt ? '🎤 Voice message' : '🎵 Audio';
    else if (qMsg?.videoMessage) qText = '🎥 Video';
    else if (qMsg?.documentMessage) qText = '📄 ' + (qMsg.documentMessage.fileName || 'Document');
    else if (qMsg?.stickerMessage) qText = 'Sticker';
    else qText = '[Attachment]';
  }

  const rawSender = contextInfo.participant || contextInfo.remoteJid || '';
  const cleanSender = rawSender.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
  return {
    sender: cleanSender ? '+' + cleanSender : 'Contact',
    text: qText || ''
  };
}

async function decryptAndSaveMedia(msgObj) {
  try {
    const rawM = unwrapMessage(msgObj?.message);
    if (!rawM) return null;

    let mediaType = null;
    let extension = 'bin';
    let mimeType = 'application/octet-stream';
    let fileName = null;
    let caption = null;
    let isVoiceNote = false;
    let durationSecs = 0;

    if (rawM.imageMessage) {
      mediaType = 'image';
      mimeType = rawM.imageMessage.mimetype || 'image/jpeg';
      extension = mimeType.includes('png') ? 'png' : 'jpg';
      fileName = `img_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.${extension}`;
      caption = rawM.imageMessage.caption || '';
    } else if (rawM.audioMessage) {
      isVoiceNote = !!rawM.audioMessage.ptt;
      mediaType = isVoiceNote ? 'ptt' : 'audio';
      mimeType = rawM.audioMessage.mimetype || 'audio/ogg';
      extension = mimeType.includes('mp4') || mimeType.includes('m4a') ? 'mp4' : 'ogg';
      durationSecs = rawM.audioMessage.seconds || 0;
      const durTag = durationSecs > 0 ? `_${durationSecs}s` : '';
      fileName = `voice${durTag}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.${extension}`;
    } else if (rawM.videoMessage) {
      mediaType = 'video';
      mimeType = rawM.videoMessage.mimetype || 'video/mp4';
      extension = 'mp4';
      fileName = `vid_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.${extension}`;
      caption = rawM.videoMessage.caption || '';
    } else if (rawM.documentMessage) {
      mediaType = 'document';
      mimeType = rawM.documentMessage.mimetype || 'application/pdf';
      const origName = rawM.documentMessage.fileName || 'file.pdf';
      const origExt = origName.includes('.') ? origName.split('.').pop() : 'pdf';
      fileName = `doc_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.${origExt}`;
      caption = rawM.documentMessage.caption || origName;
    } else if (rawM.stickerMessage) {
      mediaType = 'sticker';
      mimeType = rawM.stickerMessage.mimetype || 'image/webp';
      extension = 'webp';
      fileName = `sticker_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.webp`;
    } else {
      return null;
    }

    const buffer = await downloadMediaMessage(
      msgObj,
      'buffer',
      {},
      { logger, reuploadRequest: () => Promise.resolve() }
    );

    if (!buffer || buffer.length === 0) return null;

    const filePath = path.join(UPLOADS_DIR, fileName);
    fs.writeFileSync(filePath, buffer);
    try {
      if (fs.existsSync(MONO_UPLOADS_DIR)) {
        fs.writeFileSync(path.join(MONO_UPLOADS_DIR, fileName), buffer);
      }
    } catch (_) {}
    const mediaUrl = `/media/whatsapp/${fileName}`;

    return {
      message_type: mediaType,
      media_url: mediaUrl,
      file_name: fileName,
      caption: caption || '',
      is_voice_note: isVoiceNote,
      duration: durationSecs,
      file_size: buffer.length,
      media_base64: buffer.toString('base64')
    };
  } catch (err) {
    console.error('[WhatsApp Media Decrypt Error]:', err.message);
    return null;
  }
}

function scheduleContactSync(session) {
  if (!session) return;
  if (session.syncTimeout) clearTimeout(session.syncTimeout);
  session.syncTimeout = setTimeout(async () => {
    if (session.pendingContacts.size === 0) return;
    const list = Array.from(session.pendingContacts.values());
    session.pendingContacts.clear();

    console.log(`[WhatsApp Gateway:${session.id}] Dispatching ${list.length} direct contacts to CRM bulk-sync...`);

    // Batch in chunks of 50
    for (let i = 0; i < list.length; i += 50) {
      const batch = list.slice(i, i + 50);
      try {
        await fetch(FASTAPI_BULK_SYNC_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contacts: batch,
            assigned_user_id: session.id !== 'default' ? session.id : null,
            session_id: session.ownerPhone || session.id
          })
        });
      } catch (err) {
        console.error(`[WhatsApp Gateway:${session.id}] Bulk-sync dispatch failed:`, err.message);
      }
    }
  }, 1500);
}

// Session Initializer
async function initWhatsApp(sessionId = 'default', forceClean = false) {
  const session = getSession(sessionId, true);
  if (session.isStarting) return;
  session.isStarting = true;

  if (session.reconnectTimer) {
    clearTimeout(session.reconnectTimer);
    session.reconnectTimer = null;
  }

  if (session.sock) {
    try {
      const oldSock = session.sock;
      session.sock = null;
      oldSock.ev.removeAllListeners();
      oldSock.ws?.close();
      oldSock.end?.();
    } catch (_) {}
  }

  try {
    if (forceClean && fs.existsSync(session.authDir)) {
      try {
        fs.rmSync(session.authDir, { recursive: true, force: true });
      } catch (e) {
        console.error(`[WhatsApp Gateway:${session.id}] Error clearing auth directory:`, e);
      }
    }

    if (!fs.existsSync(session.authDir)) {
      fs.mkdirSync(session.authDir, { recursive: true });
    }
    loadLidMappingsForSession(session);

    const { state, saveCreds } = await useMultiFileAuthState(session.authDir);
    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1015901307], isLatest: true }));

    const thisSock = makeWASocket({
      version,
      logger,
      printQRInTerminal: false,
      auth: state,
      browser: ['Zigmaa CRM Business', 'Chrome', '124.0.0.0'],
      syncFullHistory: false,
      markOnlineOnConnect: true,
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000,
      keepAliveIntervalMs: 25000,
      getMessage: async (key) => {
        return msgStore.get(key.id) || undefined;
      }
    });

    session.sock = thisSock;
    session.sock.ev.on('creds.update', saveCreds);

    session.sock.ev.on('connection.update', async (update) => {
      // Guard: Ignore events from old/replaced sockets
      if (session.sock !== thisSock) return;

      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        session.status = 'SCAN_QR';
        session.phone = null;
        try {
          session.qr = await qrcode.toDataURL(qr, { width: 320, margin: 2 });
          console.log(`[WhatsApp Gateway:${session.id}] New QR code generated.`);
        } catch (err) {
          console.error(`[WhatsApp Gateway:${session.id}] Error creating QR image:`, err);
        }
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        console.log(`[WhatsApp Gateway:${session.id}] Connection closed. Status code: ${statusCode}. Reconnecting: ${shouldReconnect}`);

        if (session.sock === thisSock) {
          try {
            thisSock.ev.removeAllListeners();
            thisSock.ws?.close();
            thisSock.end?.();
          } catch (_) {}
          session.sock = null;
        }

        if (statusCode === DisconnectReason.loggedOut) {
          session.status = 'DISCONNECTED';
          session.qr = null;
          session.phone = null;
          session.ownerPhone = null;
          session.name = null;
          session.avatarUrl = null;
          if (fs.existsSync(session.authDir)) {
            try {
              fs.rmSync(session.authDir, { recursive: true, force: true });
            } catch (_) {}
          }
          session.isStarting = false;
          try {
            fetch(FASTAPI_STATUS_UPDATE_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                session_id: session.id,
                assigned_user_id: session.id !== 'default' ? session.id : null,
                phone: null,
                status: 'DISCONNECTED',
                logged_out: true
              })
            }).catch(() => {});
          } catch (_) {}
          // Do NOT auto-reconnect on explicit logout - wait for user to click Scan QR
        } else if (statusCode === 440) {
          console.warn(`[WhatsApp Gateway:${session.id}] Status 440 (Conflict). Waiting 5s for clean reconnect...`);
          session.status = session.phone ? 'CONNECTING' : 'DISCONNECTED';
          session.isStarting = false;
          if (session.reconnectTimer) clearTimeout(session.reconnectTimer);
          session.reconnectTimer = setTimeout(() => {
            session.reconnectTimer = null;
            initWhatsApp(session.id, false);
          }, 5000);
        } else {
          session.status = session.phone ? 'CONNECTING' : 'DISCONNECTED';
          session.isStarting = false;
          if (session.reconnectTimer) clearTimeout(session.reconnectTimer);
          session.reconnectTimer = setTimeout(() => {
            session.reconnectTimer = null;
            initWhatsApp(session.id, false);
          }, 2500);
        }
      } else if (connection === 'open') {
        session.status = 'CONNECTED';
        session.qr = null;

        const rawId = session.sock?.user?.id || '';
        const phone = rawId.split(':')[0] || rawId.split('@')[0];
        session.phone = phone ? `+${phone}` : null;
        session.name = session.sock?.user?.name || 'Zigmaa Linked Account';

        try {
          const clean = phone ? phone.replace(/[^0-9]/g, '') : '';
          if (clean) {
            const jid = `${clean}@s.whatsapp.net`;
            session.sock.profilePictureUrl(jid, 'image')
              .then(url => { session.avatarUrl = url || null; })
              .catch(() => { session.avatarUrl = null; });
          }
        } catch (_) {}

        console.log(`[WhatsApp Gateway:${session.id}] Connected successfully! Phone: ${session.phone} (${session.name})`);
        session.isStarting = false;

        // Notify FastAPI about session connection and phone mapping
        try {
          fetch(FASTAPI_STATUS_UPDATE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              session_id: session.id,
              assigned_user_id: session.id !== 'default' ? session.id : null,
              phone: session.phone,
              name: session.name,
              status: 'CONNECTED'
            })
          }).catch(() => {});
        } catch (_) {}

        try {
          if (session.sock.uploadPreKeys) {
            await session.sock.uploadPreKeys(50);
          }
        } catch (_) {}
      }
    });

    // History sync
    session.sock.ev.on('messaging-history.set', async ({ contacts, chats, messages }) => {
      console.log(`[WhatsApp Gateway:${session.id}] Messaging history event: ${chats?.length || 0} chats, ${messages?.length || 0} messages.`);
      
      // 1. Sync contacts from history
      if (Array.isArray(contacts)) {
        for (const c of contacts) {
          if (!c.id || (!c.id.endsWith('@s.whatsapp.net') && !c.id.endsWith('@c.us'))) continue;
          const clean = resolvePhoneFromJid(c.id, session);
          if (clean && clean.length >= 8 && clean.length <= 13) {
            if (c.lid) {
              const cleanLid = String(c.lid).split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
              if (cleanLid) session.lidToPhoneMap.set(cleanLid, clean);
            }
            const phonebookName = c.name || null;
            const pushName = c.notify || c.verifiedName || null;
            const bestName = phonebookName || pushName || null;
            const item = {
              phone: clean,
              name: bestName,
              phonebook_name: phonebookName,
              push_name: pushName,
              jid: c.id,
              avatar_url: null
            };
            if (session.contactsStore) session.contactsStore.set(clean, item);
            session.pendingContacts.set(clean, item);
          }
        }
        if (session.pendingContacts.size > 0) {
          scheduleContactSync(session);
        }
      }

      // 2. Extract messages from history
      const validMessages = [];
      const coveredPhones = new Set();
      if (Array.isArray(messages)) {
        for (const msg of messages) {
          const remoteJid = msg.key?.remoteJid || '';
          if (!remoteJid || (!remoteJid.endsWith('@s.whatsapp.net') && !remoteJid.endsWith('@c.us'))) {
            continue;
          }
          const cleanPhone = resolvePhoneFromJid(remoteJid, session);
          if (!cleanPhone || cleanPhone.length < 8 || cleanPhone.length > 13) continue;

          let mediaPayload = null;
          try {
            mediaPayload = await decryptAndSaveMedia(msg);
          } catch (_) {}

          let body = extractMessageBody(msg.message);
          if (!body && mediaPayload) {
            if (mediaPayload.is_voice_note) {
              const d = mediaPayload.duration || 3;
              body = `🎤 Voice message (${d}s)`;
            } else {
              body = mediaPayload.caption || `[${(mediaPayload.message_type || 'Attachment').toUpperCase()}]`;
            }
          }
          if (!body) continue;

          const fromMe = Boolean(msg.key?.fromMe);
          const savedContact = session.contactsStore ? session.contactsStore.get(cleanPhone) : null;
          const contactName = savedContact?.phonebook_name || savedContact?.name || msg.pushName || null;
          const ts = typeof msg.messageTimestamp === 'number'
            ? msg.messageTimestamp
            : (msg.messageTimestamp?.low || Math.floor(Date.now() / 1000));

          coveredPhones.add(cleanPhone);
          validMessages.push({
            phone_number: cleanPhone,
            contact_name: contactName,
            message_body: body,
            meta_message_id: msg.key?.id,
            timestamp: ts,
            direction: fromMe ? 'OUTBOUND' : 'INBOUND',
            message_type: mediaPayload?.message_type || 'text',
            media_url: mediaPayload?.media_url || null,
            file_name: mediaPayload?.file_name || null,
            caption: mediaPayload?.caption || null,
            is_voice_note: Boolean(mediaPayload?.is_voice_note),
            media_base64: mediaPayload?.media_base64 || null,
            quoted_context: extractQuotedContext(msg.message)
          });
        }
      }

      // 3. Register top 20 recent direct chats as contacts
      if (Array.isArray(chats)) {
        const directChats = chats
          .filter(c => c.id && (c.id.endsWith('@s.whatsapp.net') || c.id.endsWith('@c.us')))
          .sort((a, b) => {
            const tsA = typeof a.conversationTimestamp === 'number' ? a.conversationTimestamp : (a.conversationTimestamp?.low || 0);
            const tsB = typeof b.conversationTimestamp === 'number' ? b.conversationTimestamp : (b.conversationTimestamp?.low || 0);
            return tsB - tsA;
          });

        for (const chat of directChats.slice(0, 20)) {
          const cleanPhone = resolvePhoneFromJid(chat.id, session);
          if (!cleanPhone || cleanPhone.length < 8 || cleanPhone.length > 13) continue;

          const savedContact = session.contactsStore ? session.contactsStore.get(cleanPhone) : null;
          const bestName = savedContact?.phonebook_name || chat.name || savedContact?.name || null;
          session.pendingContacts.set(cleanPhone, {
            phone: cleanPhone,
            name: bestName,
            phonebook_name: savedContact?.phonebook_name || null,
            push_name: savedContact?.push_name || null,
            jid: chat.id,
            avatar_url: null
          });
        }
        if (session.pendingContacts.size > 0) {
          scheduleContactSync(session);
        }
      }

      if (validMessages.length > 0) {
        console.log(`[WhatsApp Gateway:${session.id}] Dispatching ${validMessages.length} direct messages to CRM sync-history...`);
        for (let i = 0; i < validMessages.length; i += 40) {
          const batch = validMessages.slice(i, i + 40);
          try {
            await fetch(FASTAPI_SYNC_HISTORY_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                messages: batch,
                assigned_user_id: session.id !== 'default' ? session.id : null,
                session_id: session.ownerPhone || session.id
              })
            });
          } catch (err) {
            console.error(`[WhatsApp Gateway:${session.id}] Sync history batch failed:`, err.message);
          }
        }
      }
    });

    // Chats upsert (Captures 20 active conversations on connection)
    session.sock.ev.on('chats.upsert', async (newChats) => {
      if (!Array.isArray(newChats) || newChats.length === 0) return;
      const directChats = newChats
        .filter(c => c.id && (c.id.endsWith('@s.whatsapp.net') || c.id.endsWith('@c.us')))
        .sort((a, b) => {
          const tsA = typeof a.conversationTimestamp === 'number' ? a.conversationTimestamp : (a.conversationTimestamp?.low || 0);
          const tsB = typeof b.conversationTimestamp === 'number' ? b.conversationTimestamp : (b.conversationTimestamp?.low || 0);
          return tsB - tsA;
        });

      for (const chat of directChats.slice(0, 20)) {
        const cleanPhone = resolvePhoneFromJid(chat.id, session);
        if (!cleanPhone || cleanPhone.length < 8 || cleanPhone.length > 13) continue;
        const savedContact = session.contactsStore ? session.contactsStore.get(cleanPhone) : null;
        const bestName = savedContact?.phonebook_name || chat.name || savedContact?.name || null;
        session.pendingContacts.set(cleanPhone, {
          phone: cleanPhone,
          name: bestName,
          phonebook_name: savedContact?.phonebook_name || null,
          push_name: savedContact?.push_name || null,
          jid: chat.id,
          avatar_url: null
        });
      }

      if (session.pendingContacts.size > 0) {
        scheduleContactSync(session);
      }
    });

    // Contacts initial set (Phonebook address book dumped on connection)
    session.sock.ev.on('contacts.set', ({ contacts: setContacts }) => {
      if (!Array.isArray(setContacts) || setContacts.length === 0) return;
      console.log(`[WhatsApp Gateway:${session.id}] Received contacts.set with ${setContacts.length} contacts.`);
      for (const c of setContacts) {
        if (!c.id || (!c.id.endsWith('@s.whatsapp.net') && !c.id.endsWith('@c.us'))) continue;
        const clean = resolvePhoneFromJid(c.id, session);
        if (clean && clean.length >= 8 && clean.length <= 13) {
          if (c.lid) {
            const cleanLid = String(c.lid).split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
            if (cleanLid) session.lidToPhoneMap.set(cleanLid, clean);
          }
          const existing = session.contactsStore ? session.contactsStore.get(clean) : null;
          const phonebookName = c.name || existing?.phonebook_name || null;
          const pushName = c.notify || c.verifiedName || existing?.push_name || null;
          const bestName = phonebookName || pushName || existing?.name || null;
          const item = {
            phone: clean,
            name: bestName,
            phonebook_name: phonebookName,
            push_name: pushName,
            jid: c.id,
            avatar_url: null
          };
          if (session.contactsStore) session.contactsStore.set(clean, item);
          session.pendingContacts.set(clean, item);
        }
      }
      if (session.pendingContacts.size > 0) {
        scheduleContactSync(session);
      }
    });

    // Contacts upsert
    session.sock.ev.on('contacts.upsert', (newContacts) => {
      if (!Array.isArray(newContacts)) return;
      for (const c of newContacts) {
        if (!c.id || (!c.id.endsWith('@s.whatsapp.net') && !c.id.endsWith('@c.us'))) {
          continue;
        }
        const clean = resolvePhoneFromJid(c.id, session);
        if (clean && clean.length >= 8 && clean.length <= 13) {
          if (c.lid) {
            const cleanLid = String(c.lid).split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
            if (cleanLid) session.lidToPhoneMap.set(cleanLid, clean);
          }
          const existing = session.contactsStore ? session.contactsStore.get(clean) : null;
          const phonebookName = c.name || existing?.phonebook_name || null;
          const pushName = c.notify || c.verifiedName || existing?.push_name || null;
          const bestName = phonebookName || pushName || existing?.name || null;
          const item = {
            phone: clean,
            name: bestName,
            phonebook_name: phonebookName,
            push_name: pushName,
            jid: c.id,
            avatar_url: null
          };
          if (session.contactsStore) session.contactsStore.set(clean, item);
          session.pendingContacts.set(clean, item);
        }
      }
      if (session.pendingContacts.size > 0) {
        scheduleContactSync(session);
      }
    });

    // Contacts update (Address book name changes on the phone)
    session.sock.ev.on('contacts.update', (updatedContacts) => {
      if (!Array.isArray(updatedContacts)) return;
      for (const c of updatedContacts) {
        if (!c.id || (!c.id.endsWith('@s.whatsapp.net') && !c.id.endsWith('@c.us'))) {
          continue;
        }
        const clean = resolvePhoneFromJid(c.id, session);
        if (clean && clean.length >= 8 && clean.length <= 13) {
          if (c.lid) {
            const cleanLid = String(c.lid).split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
            if (cleanLid) session.lidToPhoneMap.set(cleanLid, clean);
          }
          const existing = session.contactsStore ? session.contactsStore.get(clean) : null;
          const phonebookName = c.name || existing?.phonebook_name || null;
          const pushName = c.notify || c.verifiedName || existing?.push_name || null;
          const bestName = phonebookName || pushName || existing?.name || null;
          const item = {
            phone: clean,
            name: bestName,
            phonebook_name: phonebookName,
            push_name: pushName,
            jid: c.id,
            avatar_url: null
          };
          if (session.contactsStore) session.contactsStore.set(clean, item);
          session.pendingContacts.set(clean, item);
        }
      }
      if (session.pendingContacts.size > 0) {
        scheduleContactSync(session);
      }
    });

    // Messages upsert
    session.sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (!Array.isArray(messages)) return;

      for (const msg of messages) {
        try {
          const msgId = msg.key?.id;
          if (msgId) {
            msgStore.set(msgId, msg.message);
            if (msgStore.size > 2000) {
              const firstKey = msgStore.keys().next().value;
              msgStore.delete(firstKey);
            }
          }

          const remoteJid = msg.key?.remoteJid || '';
          if (
            remoteJid === 'status@broadcast' ||
            remoteJid.endsWith('@broadcast') ||
            remoteJid.endsWith('@newsletter') ||
            remoteJid.endsWith('@g.us')
          ) {
            continue;
          }

          const fromMe = Boolean(msg.key?.fromMe);
          if (fromMe && msgId && sentFromCrmMsgIds.has(msgId)) {
            continue;
          }

          const senderPhone = resolvePhoneFromJid(remoteJid, session);
          if (!senderPhone || senderPhone.length < 7) {
            continue;
          }

          let mediaPayload = null;
          try {
            mediaPayload = await decryptAndSaveMedia(msg);
          } catch (_) {}

          let body = extractMessageBody(msg.message);
          if (!body && mediaPayload) {
            if (mediaPayload.is_voice_note) {
              const d = mediaPayload.duration || 3;
              body = `🎤 Voice message (${d}s)`;
            } else {
              body = mediaPayload.caption || `[${(mediaPayload.message_type || 'Attachment').toUpperCase()}]`;
            }
          }
          if (!body) continue;

          const savedContact = session.contactsStore ? session.contactsStore.get(senderPhone) : null;
          const contactName = savedContact?.phonebook_name || savedContact?.name || msg.pushName || null;
          const ts = typeof msg.messageTimestamp === 'number'
            ? msg.messageTimestamp
            : (msg.messageTimestamp?.low || Math.floor(Date.now() / 1000));

          const quotedCtx = extractQuotedContext(msg.message);
          const effectiveSession = session.ownerPhone || session.id;
          const payload = {
            phone_number: senderPhone,
            contact_name: contactName,
            message_body: body,
            meta_message_id: msgId,
            timestamp: ts,
            direction: fromMe ? 'OUTBOUND' : 'INBOUND',
            message_type: mediaPayload?.message_type || 'text',
            media_url: mediaPayload?.media_url || null,
            file_name: mediaPayload?.file_name || null,
            caption: mediaPayload?.caption || null,
            is_voice_note: Boolean(mediaPayload?.is_voice_note),
            media_base64: mediaPayload?.media_base64 || null,
            quoted_context: quotedCtx,
            assigned_user_id: session.id !== 'default' ? session.id : null,
            session_id: effectiveSession
          };

          fetch(FASTAPI_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          }).catch((err) => {
            console.error(`[WhatsApp Gateway:${session.id}] Webhook dispatch error:`, err.message);
          });
        } catch (msgErr) {
          console.error(`[WhatsApp Gateway:${session.id}] Message processing error:`, msgErr.message);
        }
      }
    });

  } catch (err) {
    console.error(`[WhatsApp Gateway:${session.id}] Init error:`, err);
    session.isStarting = false;
    session.status = 'DISCONNECTED';
  }
}

// Disconnect helper
async function disconnectSession(sessionId) {
  const session = getSession(sessionId, false);
  if (!session) return;
  if (session.sock) {
    try { await session.sock.logout(); } catch (_) {}
    try { session.sock.end(undefined); } catch (_) {}
  }
  session.status = 'DISCONNECTED';
  session.qr = null;
  session.phone = null;
  session.name = null;
  session.avatarUrl = null;
  session.isStarting = false;
  if (fs.existsSync(session.authDir)) {
    try {
      fs.rmSync(session.authDir, { recursive: true, force: true });
    } catch (_) {}
  }
  sessions.delete(session.id);
}

// ==========================================
// Express Routes
// ==========================================

app.get('/status', (req, res) => {
  const rawId = req.query.sessionId || req.query.session_id || req.query.userId || req.query.user_id;
  if (!rawId || rawId === 'keepalive' || req.query.ping) {
    let anyConnected = false;
    let anyPhone = null;
    for (const s of sessions.values()) {
      if (s.status === 'CONNECTED' && s.phone) {
        anyConnected = true;
        anyPhone = s.phone;
        break;
      }
    }
    return res.json({
      status: anyConnected ? 'CONNECTED' : 'ONLINE',
      phone: anyPhone,
      gateway_online: true,
      uptime: process.uptime()
    });
  }

  const sId = sanitizeSessionId(rawId);
  let session = getSession(sId, false);
  if (!session) {
    for (const s of sessions.values()) {
      if (s.ownerPhone === sId || (s.status === 'CONNECTED' && s.phone)) {
        session = s;
        break;
      }
    }
  }

  if (!session) {
    const authDir = getSessionAuthDir(sId);
    if (fs.existsSync(path.join(authDir, 'creds.json'))) {
      session = getSession(sId, true);
      initWhatsApp(sId, false);
    } else {
      return res.json({
        status: 'DISCONNECTED',
        phone: null,
        name: null,
        avatar_url: null,
        qr: null,
        session_id: sId
      });
    }
  }

  if (session.status === 'CONNECTED' && session.phone && !session.avatarUrl && session.sock && !session.isFetchingAvatar) {
    session.isFetchingAvatar = true;
    try {
      const clean = session.phone.replace(/[^0-9]/g, '');
      if (clean) {
        const jid = `${clean}@s.whatsapp.net`;
        session.sock.profilePictureUrl(jid, 'image')
          .then(url => { session.avatarUrl = url || null; })
          .catch(() => { session.avatarUrl = null; })
          .finally(() => { session.isFetchingAvatar = false; });
      } else {
        session.isFetchingAvatar = false;
      }
    } catch (_) {
      session.isFetchingAvatar = false;
    }
  }

  res.json({
    status: session.status,
    phone: session.phone,
    name: session.name,
    avatar_url: session.avatarUrl,
    qr: session.qr,
    session_id: sId
  });
});

app.get('/avatar/:phone', async (req, res) => {
  try {
    const sId = sanitizeSessionId(req.query.sessionId || req.query.session_id);
    let session = getSession(sId, false);
    if (!session || session.status !== 'CONNECTED' || !session.sock) {
      // Fallback to any connected session
      for (const s of sessions.values()) {
        if (s.status === 'CONNECTED' && s.sock) {
          session = s;
          break;
        }
      }
    }
    const clean = req.params.phone.replace(/[^0-9]/g, '');
    if (!clean || !session?.sock || session.status !== 'CONNECTED') {
      return res.json({ phone: clean, avatar_url: null });
    }
    const jid = `${clean}@s.whatsapp.net`;
    const url = await session.sock.profilePictureUrl(jid, 'image').catch(() => null);
    res.json({ phone: clean, avatar_url: url || null });
  } catch (_) {
    res.json({ phone: req.params.phone, avatar_url: null });
  }
});

app.post('/refresh-qr', async (req, res) => {
  try {
    const sId = sanitizeSessionId(req.query.sessionId || req.query.session_id || req.body?.sessionId || req.body?.session_id);
    const session = getSession(sId, true);
    
    // If QR code is already ready and active, return immediately!
    if (session.status === 'SCAN_QR' && session.qr) {
      return res.json({ success: true, qr: session.qr, status: 'SCAN_QR', session_id: sId });
    }

    if (session.status === 'CONNECTED' && session.phone) {
      return res.json({ success: true, status: 'CONNECTED', phone: session.phone, session_id: sId });
    }

    if (!session.isStarting) {
      initWhatsApp(sId, true);
    }

    // Wait up to 5s for QR code to be generated so the frontend modal gets it instantly
    let waited = 0;
    while (!session.qr && session.status !== 'CONNECTED' && waited < 5000) {
      await new Promise(r => setTimeout(r, 250));
      waited += 250;
    }

    res.json({
      success: true,
      qr: session.qr || null,
      status: session.status || 'SCAN_QR',
      session_id: sId,
      message: session.qr ? 'QR ready' : 'Generating QR code...'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/disconnect', async (req, res) => {
  try {
    const sId = sanitizeSessionId(req.query.sessionId || req.query.session_id || req.body?.sessionId || req.body?.session_id);
    await disconnectSession(sId);
    try {
      fetch(FASTAPI_STATUS_UPDATE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sId,
          assigned_user_id: sId !== 'default' ? sId : null,
          phone: null,
          status: 'DISCONNECTED'
        })
      }).catch(() => {});
    } catch (_) {}
    res.json({ success: true, session_id: sId, message: `WhatsApp session ${sId} disconnected and logged out successfully.` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Helper to resolve the best active socket for outbound sending
function resolveSendingSession(requestedId) {
  if (requestedId) {
    const sId = sanitizeSessionId(requestedId);
    const s = getSession(sId, false);
    if (s && s.status === 'CONNECTED' && s.sock) return s;
    const cleanReq = String(requestedId).replace(/[^0-9]/g, '');
    if (cleanReq) {
      for (const sess of sessions.values()) {
        if (sess.status === 'CONNECTED' && sess.sock) {
          if (sess.ownerPhone === cleanReq || (sess.phone && sess.phone.replace(/[^0-9]/g, '') === cleanReq)) {
            return sess;
          }
        }
      }
    }
  }
  const def = sessions.get('default');
  if (def && def.status === 'CONNECTED' && def.sock) return def;
  for (const sess of sessions.values()) {
    if (sess.status === 'CONNECTED' && sess.sock) return sess;
  }
  return null;
}

// Modify chat state (Pin / Unpin / Archive / Unarchive) directly on WhatsApp
app.post('/chat-modify', async (req, res) => {
  try {
    const { phone_number, pin, archive, session_id, assigned_user_id } = req.body;
    const session = resolveSendingSession(session_id || assigned_user_id);
    if (!session || !session.sock || session.status !== 'CONNECTED') {
      return res.status(503).json({ success: false, error: 'Session not connected' });
    }
    const cleanPhone = (phone_number || '').replace(/[^0-9]/g, '');
    if (!cleanPhone) {
      return res.status(400).json({ success: false, error: 'phone_number is required' });
    }
    const jid = cleanPhone + '@s.whatsapp.net';
    if (typeof pin === 'boolean') {
      await session.sock.chatModify({ pin }, jid);
    }
    if (typeof archive === 'boolean') {
      await session.sock.chatModify({ archive }, jid);
    }
    res.json({ success: true, phone_number: cleanPhone, pin, archive });
  } catch (err) {
    console.error('[WhatsApp chatModify Error]:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Admin wipe all sessions and auth directories cleanly
app.post('/admin/wipe-sessions', async (req, res) => {
  try {
    const secretKey = req.query.secret_key || req.body?.secret_key;
    if (secretKey !== 'zigmaa_super_wipe_whatsapp_2026') {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    for (const session of sessions.values()) {
      try {
        if (session.sock) {
          session.sock.ev.removeAllListeners();
          session.sock.ws?.close();
          session.sock.end?.();
        }
      } catch (_) {}
    }
    sessions.clear();

    for (const d of [SESSIONS_BASE_DIR, AUTH_DIR, UPLOADS_DIR]) {
      if (fs.existsSync(d)) {
        try {
          const files = fs.readdirSync(d);
          for (const f of files) {
            const p = path.join(d, f);
            if (fs.lstatSync(p).isDirectory()) {
              fs.rmSync(p, { recursive: true, force: true });
            } else {
              fs.unlinkSync(p);
            }
          }
        } catch (_) {}
      }
    }
    res.json({ success: true, message: 'All Baileys sessions wiped cleanly.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/send-message', async (req, res) => {
  try {
    const { 
      session_id, 
      recipient_phone, 
      phone_number, 
      text, 
      message, 
      file_base64, 
      file_name, 
      file_type, 
      assigned_user_id 
    } = req.body;
    const destPhone = recipient_phone || phone_number;
    const bodyText = (text !== undefined ? text : message) || '';

    if (!destPhone || (!bodyText && !file_base64)) {
      return res.status(400).json({ success: false, error: 'recipient_phone and text or file are required.' });
    }

    const cleanPhone = String(destPhone).replace(/[^0-9]/g, '');
    const cleanRecipient = `${cleanPhone}@s.whatsapp.net`;

    const targetSession = resolveSendingSession(session_id || assigned_user_id);
    const targetSock = targetSession?.sock;

    if (!targetSock || targetSession?.status !== 'CONNECTED') {
      return res.status(404).json({ success: false, error: 'Session not active' });
    }

    let result;
    if (file_base64) {
      const pureBase64 = file_base64.includes(',') ? file_base64.split(',')[1] : file_base64;
      const fileBuffer = Buffer.from(pureBase64, 'base64');
      const mime = file_type || 'application/octet-stream';
      if (mime.startsWith('image/')) {
        result = await targetSock.sendMessage(cleanRecipient, { image: fileBuffer, caption: bodyText.trim() });
      } else if (mime.startsWith('audio/')) {
        result = await targetSock.sendMessage(cleanRecipient, { audio: fileBuffer, mimetype: 'audio/mp4', ptt: true });
      } else {
        result = await targetSock.sendMessage(cleanRecipient, { document: fileBuffer, mimetype: mime, fileName: file_name || 'file.pdf', caption: bodyText.trim() });
      }
    } else {
      result = await targetSock.sendMessage(cleanRecipient, { text: bodyText.trim() });
    }

    const messageId = result?.key?.id || `wamid.qr_out_${Date.now()}`;
    if (messageId) sentFromCrmMsgIds.add(messageId);

    return res.json({ success: true, message_id: messageId, result });
  } catch (err) {
    console.error('[WhatsApp /send-message Error]:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/send', async (req, res) => {
  try {
    const { 
      phone_number, 
      message, 
      file_base64, 
      file_name, 
      file_type,
      quoted_message_id,
      quoted_text,
      quoted_from_me,
      session_id,
      assigned_user_id
    } = req.body;

    if (!phone_number || (!message && !file_base64)) {
      return res.status(400).json({ success: false, error: 'phone_number and message or file are required.' });
    }

    const session = resolveSendingSession(session_id || assigned_user_id);
    if (!session || !session.sock || session.status !== 'CONNECTED') {
      return res.status(503).json({
        success: false,
        error: 'WhatsApp is not connected for this user account. Please scan the QR code first.'
      });
    }

    const cleanPhone = phone_number.replace(/[^0-9]/g, '');
    const jid = `${cleanPhone}@s.whatsapp.net`;

    let sendOptions = {};
    if (quoted_message_id) {
      sendOptions.quoted = {
        key: {
          remoteJid: jid,
          fromMe: Boolean(quoted_from_me),
          id: quoted_message_id
        },
        message: {
          conversation: (quoted_text || '').slice(0, 500)
        }
      };
    }

    let result;
    if (file_base64) {
      const pureBase64 = file_base64.includes(',') ? file_base64.split(',')[1] : file_base64;
      const fileBuffer = Buffer.from(pureBase64, 'base64');
      const mime = file_type || 'application/octet-stream';

      if (mime.startsWith('image/')) {
        result = await session.sock.sendMessage(jid, {
          image: fileBuffer,
          caption: (message || '').trim(),
          mimetype: mime
        }, sendOptions);
      } else if (mime.startsWith('video/')) {
        result = await session.sock.sendMessage(jid, {
          video: fileBuffer,
          caption: (message || '').trim(),
          mimetype: mime
        }, sendOptions);
      } else if (mime.startsWith('audio/')) {
        const pttData = await convertAudioToWhatsAppPtt(fileBuffer);
        result = await session.sock.sendMessage(jid, {
          audio: pttData.buffer,
          mimetype: 'audio/ogg; codecs=opus',
          ptt: true,
          seconds: pttData.seconds || 1,
          waveform: pttData.waveform
        }, sendOptions);
        if (pttData.filePath) {
          setTimeout(() => { try { fs.unlinkSync(pttData.filePath); } catch (_) {} }, 30000);
        }
      } else {
        result = await session.sock.sendMessage(jid, {
          document: fileBuffer,
          mimetype: mime,
          fileName: file_name || 'document.pdf',
          caption: (message || '').trim()
        }, sendOptions);
      }
    } else {
      result = await session.sock.sendMessage(jid, { text: (message || '').trim() }, sendOptions);
    }

    const messageId = result?.key?.id || `wamid.qr_out_${Date.now()}`;
    if (messageId) {
      sentFromCrmMsgIds.add(messageId);
      if (sentFromCrmMsgIds.size > 2000) {
        const first = sentFromCrmMsgIds.values().next().value;
        sentFromCrmMsgIds.delete(first);
      }
    }

    console.log(`[WhatsApp Outbound Success:${session.id}] To: ${cleanPhone}, ID: ${messageId}`);
    res.json({
      success: true,
      message_id: messageId,
      status: 'SENT',
      session_id: session.id
    });
  } catch (err) {
    console.error('[WhatsApp Outbound Error]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/whatsapp/send-voice', async (req, res) => {
  try {
    const { phone_number, audio_base64, session_id, assigned_user_id } = req.body;
    if (!phone_number || !audio_base64) {
      return res.status(400).json({ success: false, error: 'phone_number and audio_base64 are required.' });
    }
    const session = resolveSendingSession(session_id || assigned_user_id);
    if (!session || !session.sock || session.status !== 'CONNECTED') {
      return res.status(503).json({ success: false, error: 'WhatsApp is not connected for this user account.' });
    }
    const cleanPhone = phone_number.replace(/[^0-9]/g, '');
    const jid = `${cleanPhone}@s.whatsapp.net`;
    const pureBase64 = audio_base64.includes(',') ? audio_base64.split(',')[1] : audio_base64;
    const fileBuffer = Buffer.from(pureBase64, 'base64');

    const pttData = await convertAudioToWhatsAppPtt(fileBuffer);

    const result = await session.sock.sendMessage(jid, {
      audio: pttData.buffer,
      mimetype: 'audio/ogg; codecs=opus',
      ptt: true,
      seconds: pttData.seconds || 1,
      waveform: pttData.waveform
    });
    const messageId = result?.key?.id || `wamid.voice_${Date.now()}`;
    if (messageId) {
      sentFromCrmMsgIds.add(messageId);
      if (sentFromCrmMsgIds.size > 2000) {
        const first = sentFromCrmMsgIds.values().next().value;
        sentFromCrmMsgIds.delete(first);
      }
    }
    console.log(`[WhatsApp Voice Note Sent:${session.id}] To: ${cleanPhone}, ID: ${messageId}, Duration: ${pttData.seconds}s`);
    if (pttData.filePath) {
      setTimeout(() => { try { fs.unlinkSync(pttData.filePath); } catch (_) {} }, 30000);
    }
    res.json({
      success: true,
      message_id: messageId,
      status: 'SENT',
      converted_ogg_base64: pttData.buffer.toString('base64'),
      duration_seconds: pttData.seconds,
      session_id: session.id
    });
  } catch (err) {
    console.error('[WhatsApp Voice Send Error]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// React to a message
app.post('/api/whatsapp/react', async (req, res) => {
  try {
    const { phone_number, message_id, emoji, from_me, session_id, assigned_user_id } = req.body;
    if (!phone_number || !message_id) {
      return res.status(400).json({ success: false, error: 'phone_number and message_id are required' });
    }
    const session = resolveSendingSession(session_id || assigned_user_id);
    if (!session || !session.sock || session.status !== 'CONNECTED') {
      return res.status(503).json({ success: false, error: 'WhatsApp is not connected.' });
    }
    const cleanPhone = phone_number.replace(/[^0-9]/g, '');
    const jid = `${cleanPhone}@s.whatsapp.net`;
    const messageKey = {
      remoteJid: jid,
      fromMe: Boolean(from_me),
      id: message_id
    };
    await session.sock.sendMessage(jid, {
      react: {
        text: emoji || '',
        key: messageKey
      }
    });
    res.json({ success: true, emoji: emoji || null, session_id: session.id });
  } catch (err) {
    console.error('[WhatsApp React Error]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Edit message
app.post('/api/whatsapp/edit-message', async (req, res) => {
  try {
    const { phone_number, message_id, text, session_id, assigned_user_id } = req.body;
    if (!phone_number || !message_id || !text) {
      return res.status(400).json({ success: false, error: 'phone_number, message_id and text are required' });
    }
    const session = resolveSendingSession(session_id || assigned_user_id);
    if (!session || !session.sock || session.status !== 'CONNECTED') {
      return res.status(503).json({ success: false, error: 'WhatsApp is not connected.' });
    }
    const cleanPhone = phone_number.replace(/[^0-9]/g, '');
    const jid = `${cleanPhone}@s.whatsapp.net`;
    const messageKey = {
      remoteJid: jid,
      fromMe: true,
      id: message_id
    };
    await session.sock.sendMessage(jid, {
      text: text.trim(),
      edit: messageKey
    });
    res.json({ success: true, text: text.trim(), session_id: session.id });
  } catch (err) {
    console.error('[WhatsApp Edit Error]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Delete message
app.post('/api/whatsapp/delete-message', async (req, res) => {
  try {
    const { phone_number, message_id, delete_for_everyone, from_me, session_id, assigned_user_id } = req.body;
    if (!phone_number || !message_id) {
      return res.status(400).json({ success: false, error: 'phone_number and message_id are required' });
    }
    if (delete_for_everyone) {
      const session = resolveSendingSession(session_id || assigned_user_id);
      if (!session || !session.sock || session.status !== 'CONNECTED') {
        return res.status(503).json({ success: false, error: 'WhatsApp is not connected.' });
      }
      const cleanPhone = phone_number.replace(/[^0-9]/g, '');
      const jid = `${cleanPhone}@s.whatsapp.net`;
      const messageKey = {
        remoteJid: jid,
        fromMe: from_me !== undefined ? Boolean(from_me) : true,
        id: message_id
      };
      await session.sock.sendMessage(jid, { delete: messageKey });
    }
    res.json({ success: true, deleted: true });
  } catch (err) {
    console.error('[WhatsApp Delete Error]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`========================================================`);
  console.log(`Zigmaa Multi-Session WhatsApp Gateway running on http://localhost:${PORT}`);
  console.log(`Webhook destination: ${FASTAPI_WEBHOOK_URL}`);
  console.log(`Bulk sync destination: ${FASTAPI_BULK_SYNC_URL}`);
  console.log(`========================================================`);

  // 1. Initialize default session only if legacy credentials exist
  if (fs.existsSync(path.join(AUTH_DIR, 'creds.json'))) {
    initWhatsApp('default', false);
  }

  // 2. Automatically restore all saved user sessions
  try {
    if (fs.existsSync(SESSIONS_BASE_DIR)) {
      const entries = fs.readdirSync(SESSIONS_BASE_DIR);
      for (const entry of entries) {
        if (entry.startsWith('session_')) {
          const sId = entry.replace('session_', '');
          if (sId && sId !== 'default') {
            console.log(`[WhatsApp Gateway] Restoring saved session: ${sId}`);
            initWhatsApp(sId, false);
          }
        }
      }
    }
  } catch (e) {
    console.warn('[WhatsApp Gateway] Error restoring sessions:', e.message);
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[WhatsApp Gateway Fatal] Port ${PORT} is already in use by another instance! Exiting to prevent conflict.`);
    process.exit(1);
  } else {
    console.error('[WhatsApp Gateway Server Error]:', err);
  }
});
