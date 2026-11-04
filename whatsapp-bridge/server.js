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
const BACKEND_BASE = process.env.FASTAPI_BASE_URL || (process.env.RENDER ? 'https://zigmaacrm-backend.onrender.com' : 'http://127.0.0.1:8000');
const FASTAPI_WEBHOOK_URL = process.env.FASTAPI_WEBHOOK_URL || `${BACKEND_BASE}/api/v1/webhooks/whatsapp/inbound-qr`;
const FASTAPI_BULK_SYNC_URL = process.env.FASTAPI_BULK_SYNC_URL || `${BACKEND_BASE}/api/v1/whatsapp/contacts/bulk-sync`;
const FASTAPI_SYNC_HISTORY_URL = process.env.FASTAPI_SYNC_HISTORY_URL || `${BACKEND_BASE}/api/v1/whatsapp/chats/sync-history`;
const FASTAPI_STATUS_UPDATE_URL = process.env.FASTAPI_STATUS_UPDATE_URL || `${BACKEND_BASE}/api/v1/webhooks/whatsapp/status-update`;
const AUTH_DIR = path.join(__dirname, 'auth_info_baileys');

// Uploads directory for decrypted WhatsApp media
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads', 'whatsapp');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}
app.use('/media/whatsapp', express.static(UPLOADS_DIR));
app.use('/uploads/whatsapp', express.static(UPLOADS_DIR));

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

    // Official WhatsApp PTT Audio Transcoder:
    // -vn: strip video/metadata
    // -c:a libopus: Opus compression
    // -b:a 48k: optimal VoIP bitrate
    // -ar 48000: strictly 48kHz (mandatory for WhatsApp)
    // -ac 1: strictly mono (stereo causes "not available" playback error)
    // -avoid_negative_ts make_zero: PREVENTS TIMELINE/TIMESTAMP SYNCHRONIZATION BUGS THAT CAUSE PLAYERS TO CRASH OR SHOW "NOT AVAILABLE"
    // -f ogg: standard Ogg container
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
      const { default: decoder } = await import('audio-decode');
      const audioBuffer = await decoder(oggBuffer);
      const rawData = audioBuffer.getChannelData(0);
      const samples = 64;
      const blockSize = Math.floor(rawData.length / samples);
      const filteredData = [];
      for (let i = 0; i < samples; i++) {
        const blockStart = blockSize * i;
        let sum = 0;
        for (let j = 0; j < blockSize; j++) {
          sum += Math.abs(rawData[blockStart + j] || 0);
        }
        filteredData.push(sum / blockSize);
      }
      const maxVal = Math.max(...filteredData, 0.001);
      const normalizedData = filteredData.map(n => Math.min(1, n / maxVal));
      waveform = new Uint8Array(normalizedData.map(n => Math.max(5, Math.floor(100 * n))));
    } catch (wErr) {
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

// State
let sock = null;
let latestQR = null;
let connectionStatus = 'DISCONNECTED'; // 'DISCONNECTED' | 'SCAN_QR' | 'CONNECTED'
let connectedPhone = null;
let connectedName = null;
let connectedAvatarUrl = null;
let isStarting = false;

// In-Memory Caches
const lidToPhoneMap = new Map();
const msgStore = new Map();
const sentFromCrmMsgIds = new Set();

function loadLidMappings() {
  if (!fs.existsSync(AUTH_DIR)) return;
  try {
    const files = fs.readdirSync(AUTH_DIR);
    for (const f of files) {
      if (f.startsWith('lid-mapping-') && !f.includes('_reverse') && f.endsWith('.json')) {
        const phone = f.replace('lid-mapping-', '').replace('.json', '');
        try {
          const lid = JSON.parse(fs.readFileSync(path.join(AUTH_DIR, f), 'utf8'));
          if (lid) lidToPhoneMap.set(String(lid).trim(), String(phone).trim());
        } catch (_) {}
      }
    }
    console.log(`[WhatsApp Gateway] Indexed ${lidToPhoneMap.size} LID to Phone mappings in memory.`);
  } catch (err) {
    console.error('[WhatsApp Gateway] Failed to index LID mappings:', err.message);
  }
}

// Contacts buffer
let syncTimeout = null;
const pendingContacts = new Map();

const logger = pino({ level: 'silent' });

function resolvePhoneFromJid(jid) {
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
    return raw && raw.length >= 7 ? raw : null;
  }
  if (str.endsWith('@lid')) {
    const cleanLid = str.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
    if (lidToPhoneMap.has(cleanLid)) {
      return lidToPhoneMap.get(cleanLid);
    }
    const revFile = path.join(AUTH_DIR, `lid-mapping-${cleanLid}_reverse.json`);
    if (fs.existsSync(revFile)) {
      try {
        const pn = JSON.parse(fs.readFileSync(revFile, 'utf8'));
        if (pn) {
          const cleanPn = String(pn).replace(/[^0-9]/g, '');
          lidToPhoneMap.set(cleanLid, cleanPn);
          return cleanPn;
        }
      } catch (_) {}
    }
    // Fallback to LID digits so inbound messages are NEVER skipped
    return cleanLid && cleanLid.length >= 7 ? cleanLid : null;
  }
  const clean = str.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
  return clean && clean.length >= 7 ? clean : null;
}

function extractMessageBody(m) {
  if (!m) return '';
  let msg = m;
  // Deep unwrap all Baileys nested message wrappers
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
      let qText = q.conversation ||
                  q.extendedTextMessage?.text ||
                  q.imageMessage?.caption ||
                  q.videoMessage?.caption ||
                  q.documentMessage?.caption ||
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
      fileName = `voice_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.${extension}`;
    } else if (rawM.videoMessage) {
      mediaType = 'video';
      mimeType = rawM.videoMessage.mimetype || 'video/mp4';
      extension = 'mp4';
      fileName = `vid_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.${extension}`;
      caption = rawM.videoMessage.caption || '';
    } else if (rawM.stickerMessage) {
      mediaType = 'sticker';
      mimeType = rawM.stickerMessage.mimetype || 'image/webp';
      extension = 'webp';
      fileName = `sticker_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.${extension}`;
      caption = '';
    } else if (rawM.documentMessage) {
      mediaType = 'document';
      mimeType = rawM.documentMessage.mimetype || 'application/pdf';
      fileName = rawM.documentMessage.fileName || `doc_${Date.now()}.pdf`;
      caption = rawM.documentMessage.caption || '';
    } else {
      return null;
    }

    const buffer = await downloadMediaMessage(
      msgObj,
      'buffer',
      {},
      {
        logger,
        reuploadRequest: sock?.updateMediaMessage
      }
    );

    if (!buffer || buffer.length === 0) {
      return null;
    }

    const filePath = path.join(UPLOADS_DIR, fileName);
    fs.writeFileSync(filePath, buffer);
    const mediaUrl = `/media/whatsapp/${fileName}`;

    return {
      message_type: mediaType,
      media_url: mediaUrl,
      file_name: fileName,
      caption: caption || '',
      is_voice_note: isVoiceNote,
      file_size: buffer.length
    };
  } catch (err) {
    console.error('[WhatsApp Media Decrypt Error]:', err.message);
    return null;
  }
}

function scheduleContactSync() {
  if (syncTimeout) clearTimeout(syncTimeout);
  syncTimeout = setTimeout(async () => {
    if (pendingContacts.size === 0) return;
    const list = Array.from(pendingContacts.values());
    pendingContacts.clear();

    console.log(`[WhatsApp Gateway] Dispatching ${list.length} direct contacts to CRM bulk-sync...`);

    // Batch in chunks of 50
    for (let i = 0; i < list.length; i += 50) {
      const batch = list.slice(i, i + 50);
      try {
        await fetch(FASTAPI_BULK_SYNC_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contacts: batch })
        });
      } catch (err) {
        console.error('[WhatsApp Gateway] Bulk-sync dispatch failed:', err.message);
      }
    }
  }, 1500);
}

// Auto-heal stale or corrupted session ratchet files to guarantee zero Bad MAC errors
function clearCorruptedSessions() {
  if (!fs.existsSync(AUTH_DIR)) return;
  try {
    const files = fs.readdirSync(AUTH_DIR).filter(f => f.startsWith('session-'));
    if (files.length > 0) {
      console.log(`[WhatsApp Gateway] Purged ${files.length} stale session ratchets to prevent Bad MAC.`);
      for (const f of files) {
        try { fs.unlinkSync(path.join(AUTH_DIR, f)); } catch (_) {}
      }
    }
  } catch (_) {}
}

async function initWhatsApp(forceClean = false) {
  if (isStarting) return;
  isStarting = true;

  // Cleanly close any previous socket instance to avoid Status 440 (connectionReplaced)
  if (sock) {
    try {
      sock.ev.removeAllListeners();
      sock.ws?.close();
      sock.end?.();
    } catch (_) {}
    sock = null;
  }

  try {
    if (forceClean && fs.existsSync(AUTH_DIR)) {
      try {
        fs.rmSync(AUTH_DIR, { recursive: true, force: true });
      } catch (e) {
        console.error('Error clearing auth directory:', e);
      }
    }

    if (!fs.existsSync(AUTH_DIR)) {
      fs.mkdirSync(AUTH_DIR, { recursive: true });
    }
    clearCorruptedSessions();
    loadLidMappings();

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1015901307], isLatest: true }));

    sock = makeWASocket({
      version,
      logger,
      printQRInTerminal: false,
      auth: state,
      browser: ['Zigmaa CRM', 'Chrome', '1.0.0'],
      syncFullHistory: false,
      markOnlineOnConnect: true,
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000,
      keepAliveIntervalMs: 25000,
      getMessage: async (key) => {
        return msgStore.get(key.id) || undefined;
      }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        connectionStatus = 'SCAN_QR';
        connectedPhone = null;
        try {
          latestQR = await qrcode.toDataURL(qr, { width: 320, margin: 2 });
          console.log('[WhatsApp Gateway] New QR code generated.');
        } catch (err) {
          console.error('[WhatsApp Gateway] Error creating QR image:', err);
        }
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        console.log(`[WhatsApp Gateway] Connection closed. Status code: ${statusCode}. Reconnecting: ${shouldReconnect}`);

        if (sock) {
          try {
            sock.ev.removeAllListeners();
            sock.ws?.close();
            sock.end?.();
          } catch (_) {}
          sock = null;
        }

        if (statusCode === DisconnectReason.loggedOut) {
          connectionStatus = 'DISCONNECTED';
          latestQR = null;
          connectedPhone = null;
          connectedName = null;
          if (fs.existsSync(AUTH_DIR)) {
            try {
              fs.rmSync(AUTH_DIR, { recursive: true, force: true });
            } catch (_) {}
          }
          isStarting = false;
          setTimeout(() => initWhatsApp(false), 2000);
        } else if (statusCode === 440) {
          console.warn('[WhatsApp Gateway] Status 440 (Conflict). Waiting 5s for clean reconnect...');
          connectionStatus = 'DISCONNECTED';
          isStarting = false;
          setTimeout(() => initWhatsApp(false), 5000);
        } else {
          connectionStatus = 'DISCONNECTED';
          isStarting = false;
          setTimeout(() => initWhatsApp(false), 3000);
        }
      } else if (connection === 'open') {
        connectionStatus = 'CONNECTED';
        latestQR = null;

        const rawId = sock?.user?.id || '';
        const phone = rawId.split(':')[0] || rawId.split('@')[0];
        connectedPhone = phone ? `+${phone}` : null;
        connectedName = sock?.user?.name || 'Zigmaa Linked Account';

        try {
          const clean = phone ? phone.replace(/[^0-9]/g, '') : '';
          if (clean) {
            const jid = `${clean}@s.whatsapp.net`;
            sock.profilePictureUrl(jid, 'image')
              .then(url => { connectedAvatarUrl = url || null; })
              .catch(() => { connectedAvatarUrl = null; });
          }
        } catch (_) {}

        console.log(`[WhatsApp Gateway] Connected successfully! Phone: ${connectedPhone} (${connectedName})`);
        isStarting = false;

        // Proactively upload 50 fresh prekeys to WhatsApp server so inbound decryption never fails
        try {
          if (sock.uploadPreKeys) {
            await sock.uploadPreKeys(50);
            console.log('[WhatsApp Gateway] Fresh prekeys registered with WhatsApp network.');
          }
        } catch (pkErr) {
          console.warn('[WhatsApp Gateway] Prekey upload note:', pkErr.message);
        }
      }
    });

    // 1. Direct Contact & Recent Messages History Sync (Ignore @g.us group chats, only accept direct 1-on-1 chats)
    sock.ev.on('messaging-history.set', async ({ contacts, chats, messages }) => {
      if (contacts && Array.isArray(contacts)) {
        for (const c of contacts) {
          const jid = c.id || '';
          if (jid.endsWith('@g.us') || jid === 'status@broadcast') continue;
          if (!jid.endsWith('@c.us') && !jid.endsWith('@s.whatsapp.net')) continue;
          const phone = jid.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
          if (!phone || phone.length < 7) continue;

          const name = c.name || c.notify || c.verifiedName || null;
          pendingContacts.set(phone, {
            phone,
            name,
            jid,
            avatar_url: null
          });
        }
        scheduleContactSync();
      }

      if (messages && Array.isArray(messages) && messages.length > 0) {
        console.log(`[WhatsApp History Sync] Processing ${messages.length} historical messages from WhatsApp...`);
        let syncedCount = 0;
        for (const msg of messages) {
          const remoteJid = msg.key?.remoteJid || '';
          if (
            !remoteJid ||
            remoteJid.endsWith('@g.us') ||
            remoteJid === 'status@broadcast' ||
            remoteJid.endsWith('@newsletter') ||
            remoteJid.endsWith('@broadcast')
          ) {
            continue;
          }
          const phone = resolvePhoneFromJid(remoteJid);
          const body = extractMessageBody(msg.message);
          if (!phone || (!body && !msg.message?.imageMessage && !msg.message?.documentMessage && !msg.message?.audioMessage)) {
            continue;
          }

          try {
            await fetch(FASTAPI_WEBHOOK_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                phone_number: phone,
                contact_name: msg.pushName || '',
                message_body: body || '[Attachment Received]',
                meta_message_id: msg.key.id || `wamid.hist_${Date.now()}_${Math.random()}`,
                timestamp: Number(msg.messageTimestamp) || Math.floor(Date.now() / 1000),
                direction: msg.key.fromMe ? 'OUTBOUND' : 'INBOUND'
              })
            });
            syncedCount++;
          } catch (_) {}
        }
        console.log(`[WhatsApp History Sync] Successfully synced ${syncedCount} 1-on-1 messages to CRM.`);
      }
    });

    sock.ev.on('contacts.upsert', (contacts) => {
      if (!contacts || !Array.isArray(contacts)) return;
      for (const c of contacts) {
        const jid = c.id || '';
        if (jid.endsWith('@g.us') || jid === 'status@broadcast') continue;
        if (!jid.endsWith('@c.us') && !jid.endsWith('@s.whatsapp.net')) continue;
        const phone = jid.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
        if (!phone || phone.length < 7) continue;

        const name = c.name || c.notify || c.verifiedName || null;
        pendingContacts.set(phone, {
          phone,
          name,
          jid,
          avatar_url: null
        });
      }
      scheduleContactSync();
    });

    // 2. Live Messages (Both Inbound from customers and Outbound from web/mobile)
    sock.ev.on('messages.upsert', async (chatUpdate) => {
      try {
        const { messages, type } = chatUpdate;
        if (!messages || !messages.length) return;

        for (const msg of messages) {
          // Cache message in memory for Baileys getMessage / retry decryptor
          if (msg.key?.id && msg.message) {
            msgStore.set(msg.key.id, msg.message);
            if (msgStore.size > 2000) {
              const firstKey = msgStore.keys().next().value;
              msgStore.delete(firstKey);
            }
          }

          const isFromMe = Boolean(msg.key?.fromMe);

          // If this message was sent directly by this CRM server's /send endpoint,
          // it was ALREADY saved into the database by FastAPI during that HTTP request.
          if (isFromMe && msg.key?.id && sentFromCrmMsgIds.has(msg.key.id)) {
            continue;
          }

          const remoteJid = msg.key?.remoteJid || '';
          if (
            !remoteJid ||
            remoteJid === 'status@broadcast' ||
            remoteJid.endsWith('@g.us') ||
            remoteJid.endsWith('@broadcast') ||
            remoteJid.endsWith('@newsletter')
          ) {
            continue;
          }

          let phone = resolvePhoneFromJid(remoteJid);
          if (!phone && msg.key?.participant) {
            phone = resolvePhoneFromJid(msg.key.participant);
          }
          if (!phone && msg.key?.remoteJidAlt) {
            phone = resolvePhoneFromJid(msg.key.remoteJidAlt);
          }
          if (!phone && remoteJid.endsWith('@lid')) {
            const cleanLid = remoteJid.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
            if (cleanLid) phone = cleanLid;
          }

          if (!phone) {
            console.log(`[WhatsApp Message Skipped] Cannot resolve phone from JID: ${remoteJid}`);
            continue;
          }

          const rawM = unwrapMessage(msg.message);

          // Handle message reaction (both inbound and from web/phone)
          if (rawM?.reactionMessage) {
            const rMsg = rawM.reactionMessage;
            const targetId = rMsg.key?.id;
            const emoji = rMsg.text || '';
            console.log(`[WhatsApp Reaction Received] Target ID: ${targetId}, Emoji: "${emoji}", Phone: ${phone}`);
            if (targetId) {
              try {
                await fetch(`${BACKEND_BASE}/api/v1/webhooks/whatsapp/reaction`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    phone_number: phone,
                    meta_message_id: targetId,
                    reaction: emoji
                  })
                });
              } catch (rErr) {
                console.warn('[WhatsApp Reaction Forward Error]:', rErr.message);
              }
            }
            continue;
          }

          // Handle protocol message (Delete for everyone / Message Edit)
          if (rawM?.protocolMessage) {
            const pMsg = rawM.protocolMessage;
            const targetId = pMsg.key?.id;
            // Type 0 = REVOKE (Delete for everyone)
            if (pMsg.type === 0 && targetId) {
              console.log(`[WhatsApp Revoke Received] Target ID: ${targetId}, Phone: ${phone}`);
              try {
                await fetch(`${BACKEND_BASE}/api/v1/webhooks/whatsapp/revoke`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    phone_number: phone,
                    meta_message_id: targetId
                  })
                });
              } catch (vErr) {
                console.warn('[WhatsApp Revoke Forward Error]:', vErr.message);
              }
              continue;
            }
            // Type 14 = MESSAGE_EDIT
            if (pMsg.type === 14 && targetId && pMsg.editedMessage) {
              const editedText = extractMessageBody(pMsg.editedMessage);
              console.log(`[WhatsApp Edit Received] Target ID: ${targetId}, New text: "${editedText}", Phone: ${phone}`);
              if (editedText) {
                try {
                  await fetch(`${BACKEND_BASE}/api/v1/webhooks/whatsapp/edit`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      phone_number: phone,
                      meta_message_id: targetId,
                      message_body: editedText
                    })
                  });
                } catch (eErr) {
                  console.warn('[WhatsApp Edit Forward Error]:', eErr.message);
                }
              }
              continue;
            }
          }

          const contactName = isFromMe ? null : (msg.pushName || '');
          let mediaInfo = null;
          if (rawM?.imageMessage || rawM?.documentMessage || rawM?.audioMessage || rawM?.videoMessage || rawM?.stickerMessage) {
            mediaInfo = await decryptAndSaveMedia(msg);
          }

          let body = extractMessageBody(msg.message);
          if (!body && mediaInfo) {
            if (mediaInfo.message_type === 'image') body = mediaInfo.caption || '📷 Photo';
            else if (mediaInfo.is_voice_note || mediaInfo.message_type === 'ptt') body = '🎤 Voice message';
            else if (mediaInfo.message_type === 'audio') body = '🎵 Audio';
            else if (mediaInfo.message_type === 'document') body = `📄 ${mediaInfo.file_name || 'Document'}`;
            else if (mediaInfo.message_type === 'video') body = mediaInfo.caption || '🎥 Video';
            else if (mediaInfo.message_type === 'sticker') body = 'Sticker';
          }

          if (!body && !mediaInfo) {
            if (msg.messageStubType) {
              console.log(`[WhatsApp Decrypt Waiting] Stub type: ${msg.messageStubType}, Phone: ${phone}, Params:`, msg.messageStubParameters || []);
            } else {
              console.log(`[WhatsApp Notice] Empty body for ${phone}, message keys:`, Object.keys(msg.message || {}));
            }
            continue;
          }

          let deliveryStatus = 'SENT';
          if (msg.status === 4) deliveryStatus = 'DELIVERED';
          if (msg.status === 5) deliveryStatus = 'READ';

          console.log(`[WhatsApp ${isFromMe ? 'OUTBOUND (Web/Linked)' : 'INBOUND'}] Phone: ${phone}${contactName ? ` (${contactName})` : ''} - "${(body || '').slice(0, 50)}" [Type: ${mediaInfo?.message_type || 'text'}]`);

          try {
            const res = await fetch(FASTAPI_WEBHOOK_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                phone_number: phone,
                contact_name: contactName,
                message_body: body || '[Attachment Received]',
                meta_message_id: msg.key.id || `wamid.qr_${Date.now()}`,
                timestamp: Number(msg.messageTimestamp) || Math.floor(Date.now() / 1000),
                direction: isFromMe ? 'OUTBOUND' : 'INBOUND',
                status: isFromMe ? deliveryStatus : 'DELIVERED',
                message_type: mediaInfo?.message_type || 'text',
                media_url: mediaInfo?.media_url || null,
                file_name: mediaInfo?.file_name || null,
                caption: mediaInfo?.caption || null,
                is_voice_note: !!mediaInfo?.is_voice_note
              })
            });
            if (!res.ok) {
              console.error(`[WhatsApp Gateway] Webhook returned status ${res.status}: ${await res.text()}`);
            } else {
              console.log(`[WhatsApp ${isFromMe ? 'Outbound' : 'Inbound'} Forwarded] Successfully delivered to CRM for ${phone}`);
            }
          } catch (webhookErr) {
            console.error(`[WhatsApp Gateway] Failed to forward message to FastAPI (${FASTAPI_WEBHOOK_URL}):`, webhookErr.message);
          }
        }
      } catch (err) {
        console.error('[WhatsApp Gateway] Error handling messages.upsert:', err);
      }
    });

    // 3. Message Status & Read Receipts (Blue Ticks) + Decrypted Retries
    sock.ev.on('messages.update', async (updates) => {
      try {
        if (!updates || !Array.isArray(updates)) return;
        for (const u of updates) {
          const id = u.key?.id;
          if (!id) continue;

          // Asynchronously decrypted message (e.g. from retry receipt or placeholder resend)
          if (u.update?.message) {
            const isFromMe = Boolean(u.key?.fromMe);
            if (!(isFromMe && sentFromCrmMsgIds.has(id))) {
              const remoteJid = u.key?.remoteJid || '';
              const phone = resolvePhoneFromJid(remoteJid);
              const body = extractMessageBody(u.update.message);
              if (phone && (body || u.update.message?.imageMessage || u.update.message?.documentMessage)) {
                console.log(`[WhatsApp Decrypted ${isFromMe ? 'Outbound' : 'Inbound'}] Phone: ${phone} - "${(body || '').slice(0, 50)}"`);
                try {
                  await fetch(FASTAPI_WEBHOOK_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      phone_number: phone,
                      contact_name: isFromMe ? null : '',
                      message_body: body || '[Attachment Received]',
                      meta_message_id: id,
                      timestamp: Math.floor(Date.now() / 1000),
                      direction: isFromMe ? 'OUTBOUND' : 'INBOUND',
                      status: isFromMe ? 'SENT' : 'DELIVERED'
                    })
                  });
                  console.log(`[WhatsApp Decrypted Forwarded] Successfully delivered to CRM for ${phone}`);
                } catch (decErr) {
                  console.error('[WhatsApp Gateway] Failed to forward decrypted message to FastAPI:', decErr.message);
                }
              }
            }
          }

          const statusNum = u.update?.status;
          if (typeof statusNum !== 'undefined') {
            let statusStr = null;
            // WAMessageStatus: 2: SERVER_ACK (SENT), 3: DELIVERY_ACK (DELIVERED), 4: READ (READ), 5: PLAYED (READ)
            if (statusNum === 4 || statusNum === 5) {
              statusStr = 'READ';
            } else if (statusNum === 3) {
              statusStr = 'DELIVERED';
            } else if (statusNum === 2) {
              statusStr = 'SENT';
            }

            if (statusStr) {
              console.log(`[WhatsApp Receipt] ID: ${id} -> ${statusStr}`);
              try {
                await fetch(FASTAPI_STATUS_UPDATE_URL, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ meta_message_id: id, status: statusStr })
                });
              } catch (_) {}
            }
          }
        }
      } catch (err) {
        console.error('[WhatsApp Gateway] Error handling messages.update:', err);
      }
    });

    sock.ev.on('message-receipt.update', async (receipts) => {
      try {
        if (!receipts || !Array.isArray(receipts)) return;
        for (const r of receipts) {
          const id = r.key?.id;
          if (!id) continue;
          const isRead = Boolean(r.receipt?.readTimestamp);
          const isDelivered = Boolean(r.receipt?.receiptTimestamp);
          const statusStr = isRead ? 'READ' : (isDelivered ? 'DELIVERED' : null);
          if (statusStr) {
            console.log(`[WhatsApp Read Receipt] ID: ${id} -> ${statusStr}`);
            try {
              await fetch(FASTAPI_STATUS_UPDATE_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ meta_message_id: id, status: statusStr })
              });
            } catch (_) {}
          }
        }
      } catch (err) {
        console.error('[WhatsApp Gateway] Error handling message-receipt.update:', err);
      }
    });
  } catch (err) {
    console.error('[WhatsApp Gateway] Initialization error:', err);
    isStarting = false;
  }
}

// REST Endpoints
let isFetchingConnectedAvatar = false;
app.get('/status', (req, res) => {
  if (connectionStatus === 'CONNECTED' && connectedPhone && !connectedAvatarUrl && sock && !isFetchingConnectedAvatar) {
    isFetchingConnectedAvatar = true;
    try {
      const clean = connectedPhone.replace(/[^0-9]/g, '');
      if (clean) {
        const jid = `${clean}@s.whatsapp.net`;
        sock.profilePictureUrl(jid, 'image')
          .then(url => { connectedAvatarUrl = url || null; })
          .catch(() => { connectedAvatarUrl = null; })
          .finally(() => { isFetchingConnectedAvatar = false; });
      } else {
        isFetchingConnectedAvatar = false;
      }
    } catch (_) {
      isFetchingConnectedAvatar = false;
    }
  }
  res.json({
    status: connectionStatus,
    phone: connectedPhone,
    name: connectedName,
    avatar_url: connectedAvatarUrl,
    qr: latestQR
  });
});

app.get('/avatar/:phone', async (req, res) => {
  try {
    const clean = req.params.phone.replace(/[^0-9]/g, '');
    if (!clean || !sock || connectionStatus !== 'CONNECTED') {
      return res.json({ phone: clean, avatar_url: null });
    }
    const jid = `${clean}@s.whatsapp.net`;
    const url = await sock.profilePictureUrl(jid, 'image').catch(() => null);
    res.json({ phone: clean, avatar_url: url || null });
  } catch (_) {
    res.json({ phone: req.params.phone, avatar_url: null });
  }
});

app.post('/refresh-qr', async (req, res) => {
  try {
    if (sock && connectionStatus !== 'CONNECTED') {
      try {
        sock.end(undefined);
      } catch (_) {}
    }
    isStarting = false;
    await initWhatsApp(true);
    res.json({ success: true, message: 'Re-initializing WhatsApp QR code session...' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/disconnect', async (req, res) => {
  try {
    if (sock) {
      try {
        await sock.logout();
      } catch (_) {}
      try {
        sock.end(undefined);
      } catch (_) {}
    }
    connectionStatus = 'DISCONNECTED';
    latestQR = null;
    connectedPhone = null;
    connectedName = null;
    connectedAvatarUrl = null;
    if (fs.existsSync(AUTH_DIR)) {
      try {
        fs.rmSync(AUTH_DIR, { recursive: true, force: true });
      } catch (_) {}
    }
    isStarting = false;
    setTimeout(() => initWhatsApp(false), 1500);
    res.json({ success: true, message: 'WhatsApp session disconnected and logged out successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
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
      quoted_from_me
    } = req.body;

    if (!phone_number || (!message && !file_base64)) {
      return res.status(400).json({ success: false, error: 'phone_number and message or file are required.' });
    }

    if (connectionStatus !== 'CONNECTED' || !sock) {
      return res.status(503).json({
        success: false,
        error: 'WhatsApp is not connected via QR. Please scan the QR code first.'
      });
    }

    const cleanPhone = phone_number.replace(/[^0-9]/g, '');
    const jid = `${cleanPhone}@s.whatsapp.net`;

    // Construct native Baileys quoted reply context if replying to a message
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
        result = await sock.sendMessage(jid, {
          image: fileBuffer,
          caption: (message || '').trim(),
          mimetype: mime
        }, sendOptions);
      } else if (mime.startsWith('video/')) {
        result = await sock.sendMessage(jid, {
          video: fileBuffer,
          caption: (message || '').trim(),
          mimetype: mime
        }, sendOptions);
      } else if (mime.startsWith('audio/')) {
        const pttData = await convertAudioToWhatsAppPtt(fileBuffer);
        result = await sock.sendMessage(jid, {
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
        result = await sock.sendMessage(jid, {
          document: fileBuffer,
          mimetype: mime,
          fileName: file_name || 'document.pdf',
          caption: (message || '').trim()
        }, sendOptions);
      }
    } else {
      result = await sock.sendMessage(jid, { text: (message || '').trim() }, sendOptions);
    }

    const messageId = result?.key?.id || `wamid.qr_out_${Date.now()}`;
    if (messageId) {
      sentFromCrmMsgIds.add(messageId);
      if (sentFromCrmMsgIds.size > 2000) {
        const first = sentFromCrmMsgIds.values().next().value;
        sentFromCrmMsgIds.delete(first);
      }
    }

    console.log(`[WhatsApp Outbound Success] To: ${cleanPhone}, ID: ${messageId}${file_base64 ? ` (File: ${file_name || 'attachment'})` : ''}`);
    res.json({
      success: true,
      message_id: messageId,
      status: 'SENT'
    });
  } catch (err) {
    console.error('[WhatsApp Outbound Error]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/whatsapp/send-voice', async (req, res) => {
  try {
    const { phone_number, audio_base64, mimetype } = req.body;
    if (!phone_number || !audio_base64) {
      return res.status(400).json({ success: false, error: 'phone_number and audio_base64 are required.' });
    }
    if (connectionStatus !== 'CONNECTED' || !sock) {
      return res.status(503).json({ success: false, error: 'WhatsApp is not connected via QR. Please scan the QR code first.' });
    }
    const cleanPhone = phone_number.replace(/[^0-9]/g, '');
    const jid = `${cleanPhone}@s.whatsapp.net`;
    const pureBase64 = audio_base64.includes(',') ? audio_base64.split(',')[1] : audio_base64;
    const fileBuffer = Buffer.from(pureBase64, 'base64');

    // Transcode to clean WhatsApp PTT OGG Opus (RFC 7845)
    const pttData = await convertAudioToWhatsAppPtt(fileBuffer);

    const result = await sock.sendMessage(jid, {
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
    console.log(`[WhatsApp Voice Note Sent] To: ${cleanPhone}, ID: ${messageId}, Duration: ${pttData.seconds}s, Size: ${pttData.buffer.length} bytes`);
    if (pttData.filePath) {
      setTimeout(() => { try { fs.unlinkSync(pttData.filePath); } catch (_) {} }, 30000);
    }
    res.json({
      success: true,
      message_id: messageId,
      status: 'SENT',
      converted_ogg_base64: pttData.buffer.toString('base64'),
      duration_seconds: pttData.seconds
    });
  } catch (err) {
    console.error('[WhatsApp Voice Send Error]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// React to a message (or remove reaction with empty emoji)
app.post('/api/whatsapp/react', async (req, res) => {
  try {
    const { phone_number, message_id, emoji, from_me } = req.body;
    if (!phone_number || !message_id) {
      return res.status(400).json({ success: false, error: 'phone_number and message_id are required' });
    }
    if (connectionStatus !== 'CONNECTED' || !sock) {
      return res.status(503).json({ success: false, error: 'WhatsApp is not connected via QR.' });
    }
    const cleanPhone = phone_number.replace(/[^0-9]/g, '');
    const jid = `${cleanPhone}@s.whatsapp.net`;
    const messageKey = {
      remoteJid: jid,
      fromMe: Boolean(from_me),
      id: message_id
    };
    await sock.sendMessage(jid, {
      react: {
        text: emoji || '',
        key: messageKey
      }
    });
    console.log(`[WhatsApp Reaction Sent] ID: ${message_id}, Emoji: "${emoji || ''}", To: ${cleanPhone}`);
    res.json({ success: true, emoji: emoji || null });
  } catch (err) {
    console.error('[WhatsApp React Error]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Edit an outbound message
app.post('/api/whatsapp/edit-message', async (req, res) => {
  try {
    const { phone_number, message_id, text } = req.body;
    if (!phone_number || !message_id || !text) {
      return res.status(400).json({ success: false, error: 'phone_number, message_id and text are required' });
    }
    if (connectionStatus !== 'CONNECTED' || !sock) {
      return res.status(503).json({ success: false, error: 'WhatsApp is not connected via QR.' });
    }
    const cleanPhone = phone_number.replace(/[^0-9]/g, '');
    const jid = `${cleanPhone}@s.whatsapp.net`;
    const messageKey = {
      remoteJid: jid,
      fromMe: true,
      id: message_id
    };
    await sock.sendMessage(jid, {
      text: text.trim(),
      edit: messageKey
    });
    console.log(`[WhatsApp Edit Sent] ID: ${message_id}, New Text: "${text.trim()}", To: ${cleanPhone}`);
    res.json({ success: true, text: text.trim() });
  } catch (err) {
    console.error('[WhatsApp Edit Error]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Delete message (Delete for everyone using Baileys revoke)
app.post('/api/whatsapp/delete-message', async (req, res) => {
  try {
    const { phone_number, message_id, delete_for_everyone, from_me } = req.body;
    if (!phone_number || !message_id) {
      return res.status(400).json({ success: false, error: 'phone_number and message_id are required' });
    }
    if (delete_for_everyone) {
      if (connectionStatus !== 'CONNECTED' || !sock) {
        return res.status(503).json({ success: false, error: 'WhatsApp is not connected via QR.' });
      }
      const cleanPhone = phone_number.replace(/[^0-9]/g, '');
      const jid = `${cleanPhone}@s.whatsapp.net`;
      const messageKey = {
        remoteJid: jid,
        fromMe: from_me !== undefined ? Boolean(from_me) : true,
        id: message_id
      };
      await sock.sendMessage(jid, { delete: messageKey });
      console.log(`[WhatsApp Delete Revoke Sent] ID: ${message_id}, To: ${cleanPhone}`);
    }
    res.json({ success: true, deleted: true });
  } catch (err) {
    console.error('[WhatsApp Delete Error]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`========================================================`);
  console.log(`Zigmaa WhatsApp QR Gateway running on http://localhost:${PORT}`);
  console.log(`Webhook destination: ${FASTAPI_WEBHOOK_URL}`);
  console.log(`Bulk sync destination: ${FASTAPI_BULK_SYNC_URL}`);
  console.log(`========================================================`);
  initWhatsApp(false);
});
