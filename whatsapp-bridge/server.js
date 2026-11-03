const express = require('express');
const cors = require('cors');
const qrcode = require('qrcode');
const pino = require('pino');
const path = require('path');
const fs = require('fs');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.PORT || 5001;
const BACKEND_BASE = process.env.FASTAPI_BASE_URL || (process.env.RENDER ? 'https://zigmaacrm-backend.onrender.com' : 'http://127.0.0.1:8000');
const FASTAPI_WEBHOOK_URL = process.env.FASTAPI_WEBHOOK_URL || `${BACKEND_BASE}/api/v1/webhooks/whatsapp/inbound-qr`;
const FASTAPI_BULK_SYNC_URL = process.env.FASTAPI_BULK_SYNC_URL || `${BACKEND_BASE}/api/v1/whatsapp/contacts/bulk-sync`;
const FASTAPI_STATUS_UPDATE_URL = process.env.FASTAPI_STATUS_UPDATE_URL || `${BACKEND_BASE}/api/v1/webhooks/whatsapp/status-update`;
const AUTH_DIR = path.join(__dirname, 'auth_info_baileys');

// State
let sock = null;
let latestQR = null;
let connectionStatus = 'DISCONNECTED'; // 'DISCONNECTED' | 'SCAN_QR' | 'CONNECTED'
let connectedPhone = null;
let connectedName = null;
let isStarting = false;

// In-Memory Caches
const lidToPhoneMap = new Map();
const msgStore = new Map();

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
    return msg.extendedTextMessage.text.trim();
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

    // 1. Direct Contact Sync (Ignore @g.us group chats, only accept direct @c.us and @s.whatsapp.net)
    sock.ev.on('messaging-history.set', ({ contacts }) => {
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

          // Strictly ignore outbound messages sent by us so CRM messages are never duplicated
          if (msg.key?.fromMe) continue;

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

          const contactName = msg.pushName || '';
          const body = extractMessageBody(msg.message);

          if (!body && !msg.message?.imageMessage && !msg.message?.documentMessage && !msg.message?.audioMessage) {
            if (msg.messageStubType) {
              console.log(`[WhatsApp Decrypt Waiting] Stub type: ${msg.messageStubType}, Phone: ${phone}, Params:`, msg.messageStubParameters || []);
            } else {
              console.log(`[WhatsApp Inbound Notice] Empty body from ${phone}, message keys:`, Object.keys(msg.message || {}));
            }
            continue;
          }

          console.log(`[WhatsApp INBOUND] Phone: ${phone} (${contactName}) - "${(body || '').slice(0, 50)}"`);

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
                direction: 'INBOUND'
              })
            });
            if (!res.ok) {
              console.error(`[WhatsApp Gateway] Webhook returned status ${res.status}: ${await res.text()}`);
            } else {
              console.log(`[WhatsApp Inbound Forwarded] Successfully delivered to CRM for ${phone}`);
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
          if (u.update?.message && !u.key?.fromMe) {
            const remoteJid = u.key?.remoteJid || '';
            const phone = resolvePhoneFromJid(remoteJid);
            const body = extractMessageBody(u.update.message);
            if (phone && (body || u.update.message?.imageMessage || u.update.message?.documentMessage)) {
              console.log(`[WhatsApp Decrypted Inbound] Phone: ${phone} - "${(body || '').slice(0, 50)}"`);
              try {
                await fetch(FASTAPI_WEBHOOK_URL, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    phone_number: phone,
                    contact_name: '',
                    message_body: body || '[Attachment Received]',
                    meta_message_id: id,
                    timestamp: Math.floor(Date.now() / 1000),
                    direction: 'INBOUND'
                  })
                });
                console.log(`[WhatsApp Decrypted Forwarded] Successfully delivered to CRM for ${phone}`);
              } catch (decErr) {
                console.error('[WhatsApp Gateway] Failed to forward decrypted message to FastAPI:', decErr.message);
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
app.get('/status', (req, res) => {
  res.json({
    status: connectionStatus,
    phone: connectedPhone,
    name: connectedName,
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
    const { phone_number, message, file_base64, file_name, file_type } = req.body;
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
        });
      } else if (mime.startsWith('audio/')) {
        result = await sock.sendMessage(jid, {
          audio: fileBuffer,
          mimetype: mime,
          ptt: true
        });
      } else {
        result = await sock.sendMessage(jid, {
          document: fileBuffer,
          mimetype: mime,
          fileName: file_name || 'document.pdf',
          caption: (message || '').trim()
        });
      }
    } else {
      result = await sock.sendMessage(jid, { text: message.trim() });
    }

    const messageId = result?.key?.id || `wamid.qr_out_${Date.now()}`;

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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`========================================================`);
  console.log(`Zigmaa WhatsApp QR Gateway running on http://localhost:${PORT}`);
  console.log(`Webhook destination: ${FASTAPI_WEBHOOK_URL}`);
  console.log(`Bulk sync destination: ${FASTAPI_BULK_SYNC_URL}`);
  console.log(`========================================================`);
  initWhatsApp(false);
});
