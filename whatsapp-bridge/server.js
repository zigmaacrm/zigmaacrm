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
app.use(express.json());

const PORT = process.env.PORT || 5001;
const FASTAPI_WEBHOOK_URL = process.env.FASTAPI_WEBHOOK_URL || 'http://localhost:8000/api/v1/webhooks/whatsapp/inbound-qr';
const AUTH_DIR = path.join(__dirname, 'auth_info_baileys');

// State
let sock = null;
let latestQR = null;
let connectionStatus = 'DISCONNECTED'; // 'DISCONNECTED' | 'SCAN_QR' | 'CONNECTED'
let connectedPhone = null;
let connectedName = null;
let isStarting = false;

const logger = pino({ level: 'silent' });

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
    const { version, isLatest } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1015901307], isLatest: true }));

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
          // Restart clean to allow fresh scan
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

    // Listen for incoming messages
    sock.ev.on('messages.upsert', async (chatUpdate) => {
      try {
        const { messages, type } = chatUpdate;
        if (type !== 'notify' || !messages || !messages.length) return;

        for (const msg of messages) {
          // Ignore messages sent by ourselves or status broadcasts
          if (msg.key.fromMe || msg.key.remoteJid === 'status@broadcast') continue;
          if (!msg.message) continue;

          const remoteJid = msg.key.remoteJid || '';
          // Only process standard WhatsApp 1-on-1 chats (or group chats if needed)
          if (!remoteJid.endsWith('@s.whatsapp.net')) continue;

          const senderPhone = remoteJid.replace('@s.whatsapp.net', '').replace(/[^0-9]/g, '');
          const contactName = msg.pushName || '';

          // Extract text
          const body =
            msg.message.conversation ||
            msg.message.extendedTextMessage?.text ||
            msg.message.imageMessage?.caption ||
            msg.message.videoMessage?.caption ||
            msg.message.documentMessage?.caption ||
            (msg.message.imageMessage ? '[Image Attachment]' : '') ||
            (msg.message.documentMessage ? '[Document Attachment]' : '') ||
            (msg.message.audioMessage ? '[Voice Note]' : '') ||
            '';

          if (!body && !msg.message.imageMessage && !msg.message.documentMessage) continue;

          console.log(`[WhatsApp Inbound] From: ${senderPhone} (${contactName}) - "${body.slice(0, 50)}"`);

          // Forward to FastAPI webhook
          try {
            await fetch(FASTAPI_WEBHOOK_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                phone_number: senderPhone,
                contact_name: contactName,
                message_body: body || '[Attachment Received]',
                meta_message_id: msg.key.id || `wamid.qr_${Date.now()}`,
                timestamp: Number(msg.messageTimestamp) || Math.floor(Date.now() / 1000)
              })
            });
          } catch (webhookErr) {
            console.error('[WhatsApp Gateway] Failed to forward inbound message to FastAPI:', webhookErr.message);
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
  console.log(`========================================================`);
  initWhatsApp(false);
});

