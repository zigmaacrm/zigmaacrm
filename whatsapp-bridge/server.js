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
const FASTAPI_WEBHOOK_URL = process.env.FASTAPI_WEBHOOK_URL || 'http://localhost:8000/api/v1/webhooks/whatsapp/inbound-qr';
const FASTAPI_BULK_SYNC_URL = process.env.FASTAPI_BULK_SYNC_URL || 'http://localhost:8000/api/v1/whatsapp/contacts/bulk-sync';
const AUTH_DIR = path.join(__dirname, 'auth_info_baileys');

// State
let sock = null;
let latestQR = null;
let connectionStatus = 'DISCONNECTED'; // 'DISCONNECTED' | 'SCAN_QR' | 'CONNECTED'
let connectedPhone = null;
let connectedName = null;
let isStarting = false;

// Contacts buffer
let syncTimeout = null;
const pendingContacts = new Map();

const logger = pino({ level: 'silent' });

function resolvePhoneFromJid(jid) {
  if (!jid) return null;
  const str = String(jid).trim();
  if (str === 'status@broadcast' || str.endsWith('@g.us') || str.endsWith('@broadcast')) {
    return null;
  }
  if (str.endsWith('@s.whatsapp.net') || str.endsWith('@c.us')) {
    const raw = str.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
    return raw && raw.length >= 7 ? raw : null;
  }
  if (str.endsWith('@lid')) {
    const cleanLid = str.split('@')[0].split(':')[0];
    const revFile = path.join(AUTH_DIR, `lid-mapping-${cleanLid}_reverse.json`);
    if (fs.existsSync(revFile)) {
      try {
        const pn = JSON.parse(fs.readFileSync(revFile, 'utf8'));
        if (pn) return pn.toString().replace(/[^0-9]/g, '');
      } catch (_) {}
    }
  }
  return null;
}

function extractMessageBody(m) {
  if (!m) return '';
  const msg =
    m.ephemeralMessage?.message ||
    m.viewOnceMessage?.message ||
    m.viewOnceMessageV2?.message ||
    m.documentWithCaptionMessage?.message ||
    m;

  return (
    msg.conversation ||
    msg.extendedTextMessage?.text ||
    msg.imageMessage?.caption ||
    msg.videoMessage?.caption ||
    msg.documentMessage?.caption ||
    msg.buttonsResponseMessage?.selectedDisplayText ||
    msg.listResponseMessage?.title ||
    msg.templateButtonReplyMessage?.selectedId ||
    (msg.imageMessage ? '[Image Attachment]' : '') ||
    (msg.documentMessage ? '[Document Attachment]' : '') ||
    (msg.audioMessage ? '[Voice Note]' : '') ||
    (msg.stickerMessage ? '[Sticker]' : '') ||
    (msg.contactMessage ? '[Contact Card]' : '') ||
    (msg.locationMessage ? '[Location]' : '') ||
    ''
  );
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

async function initWhatsApp(forceClean = false) {
  if (isStarting) return;
  isStarting = true;

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
      defaultQueryTimeoutMs: 60000
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
        const { messages } = chatUpdate;
        if (!messages || !messages.length) return;

        for (const msg of messages) {
          // Strictly ignore outbound messages sent by us so CRM messages are never duplicated
          if (msg.key?.fromMe) continue;

          const remoteJid = msg.key?.remoteJid || '';
          if (!remoteJid || remoteJid === 'status@broadcast' || remoteJid.endsWith('@g.us') || remoteJid.endsWith('@broadcast')) {
            continue;
          }

          let phone = resolvePhoneFromJid(remoteJid);
          if (!phone && msg.key?.participant) {
            phone = resolvePhoneFromJid(msg.key.participant);
          }
          if (!phone && msg.key?.remoteJidAlt) {
            phone = resolvePhoneFromJid(msg.key.remoteJidAlt);
          }

          if (!phone) {
            console.log(`[WhatsApp Message Skipped] Cannot resolve phone from JID: ${remoteJid}`);
            continue;
          }

          const isFromMe = Boolean(msg.key?.fromMe);
          const contactName = msg.pushName || '';
          const body = extractMessageBody(msg.message);

          if (!body && !msg.message?.imageMessage && !msg.message?.documentMessage && !msg.message?.audioMessage) {
            continue;
          }

          const direction = isFromMe ? 'OUTBOUND' : 'INBOUND';
          console.log(`[WhatsApp ${direction}] Phone: ${phone} (${contactName}) - "${body.slice(0, 50)}"`);

          try {
            await fetch(FASTAPI_WEBHOOK_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                phone_number: phone,
                contact_name: contactName,
                message_body: body || '[Attachment Received]',
                meta_message_id: msg.key.id || `wamid.qr_${Date.now()}`,
                timestamp: Number(msg.messageTimestamp) || Math.floor(Date.now() / 1000),
                direction: direction
              })
            });
          } catch (webhookErr) {
            console.error('[WhatsApp Gateway] Failed to forward message to FastAPI:', webhookErr.message);
          }
        }
      } catch (err) {
        console.error('[WhatsApp Gateway] Error handling messages.upsert:', err);
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
    const { phone_number, message } = req.body;
    if (!phone_number || !message) {
      return res.status(400).json({ success: false, error: 'phone_number and message are required.' });
    }

    if (connectionStatus !== 'CONNECTED' || !sock) {
      return res.status(503).json({
        success: false,
        error: 'WhatsApp is not connected via QR. Please scan the QR code first.'
      });
    }

    const cleanPhone = phone_number.replace(/[^0-9]/g, '');
    const jid = `${cleanPhone}@s.whatsapp.net`;

    const result = await sock.sendMessage(jid, { text: message.trim() });
    const messageId = result?.key?.id || `wamid.qr_out_${Date.now()}`;

    console.log(`[WhatsApp Outbound Success] To: ${cleanPhone}, ID: ${messageId}`);
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

app.listen(PORT, () => {
  console.log(`========================================================`);
  console.log(`Zigmaa WhatsApp QR Gateway running on http://localhost:${PORT}`);
  console.log(`Webhook destination: ${FASTAPI_WEBHOOK_URL}`);
  console.log(`Bulk sync destination: ${FASTAPI_BULK_SYNC_URL}`);
  console.log(`========================================================`);
  initWhatsApp(false);
});
