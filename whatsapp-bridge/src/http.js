import crypto from 'node:crypto';
import express from 'express';
import { getLogger } from './logger.js';
import { BridgeError } from './session.js';

const log = getLogger({ mod: 'http' });

function tokensMatch(given, expected) {
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(String(expected || ''));
  if (a.length !== b.length || a.length === 0) return false;
  return crypto.timingSafeEqual(a, b);
}

const wrap = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

/**
 * Internal HTTP API of the bridge. It is called only by the CRM API, never by
 * browsers: there is no CORS, and every route except /health requires the
 * shared bridge token. Tenant scoping is enforced by the session itself (each
 * session only ever touches its own organization + phone number).
 */
export function createHttpApp({ manager, config }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  const health = (_req, res) => {
    res.json({ status: 'ONLINE', gateway_online: true, uptime: Math.round(process.uptime()), sessions: manager.list().length });
  };
  app.get('/health', health);
  // Keep-alive pings from older deployments still hit /status; it reveals nothing.
  app.get('/status', health);

  app.use((req, res, next) => {
    const header = req.get('authorization') || '';
    const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : req.get('x-bridge-token');
    if (!tokensMatch(token, config.bridgeToken)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
  });

  const requireSession = (req) => {
    const session = manager.get(req.params.id);
    if (!session) throw new BridgeError(404, 'This WhatsApp session is not running.', 'NOT_RUNNING');
    return session;
  };

  // ---- lifecycle -------------------------------------------------------
  app.post(
    '/sessions/:id/start',
    wrap(async (req, res) => {
      const session = await manager.ensure({
        id: req.params.id,
        organizationId: req.body?.organization_id,
        userId: req.body?.user_id
      });
      res.json(session.snapshot());
    })
  );

  app.get(
    '/sessions/:id',
    wrap(async (req, res) => {
      const session = manager.get(req.params.id);
      if (!session) return res.json({ session_id: req.params.id, status: 'NOT_RUNNING', running: false });
      res.json(session.snapshot());
    })
  );

  app.post(
    '/sessions/:id/qr',
    wrap(async (req, res) => {
      const session = await manager.ensure({
        id: req.params.id,
        organizationId: req.body?.organization_id,
        userId: req.body?.user_id
      });
      await session.requestQr();
      res.json(session.snapshot());
    })
  );

  app.post(
    '/sessions/:id/logout',
    wrap(async (req, res) => {
      const result = await manager.logout(req.params.id);
      res.json({ ...result, status: 'LOGGED_OUT' });
    })
  );

  // ---- messaging -------------------------------------------------------
  app.post(
    '/sessions/:id/messages',
    wrap(async (req, res) => {
      const b = req.body || {};
      const result = await requireSession(req).sendMessage({
        chatId: b.chat_id,
        text: b.text,
        mediaId: b.media_id,
        voiceNote: Boolean(b.voice_note),
        quotedMessageId: b.quoted_message_id,
        contact: b.contact,
        clientRef: b.client_ref,
        senderUserId: b.sender_user_id
      });
      res.json(result);
    })
  );

  app.post(
    '/sessions/:id/messages/:messageId/react',
    wrap(async (req, res) => res.json(await requireSession(req).react(req.params.messageId, req.body?.emoji || '')))
  );
  app.post(
    '/sessions/:id/messages/:messageId/edit',
    wrap(async (req, res) => res.json(await requireSession(req).editMessage(req.params.messageId, req.body?.text)))
  );
  app.post(
    '/sessions/:id/messages/:messageId/revoke',
    wrap(async (req, res) => res.json(await requireSession(req).revokeMessage(req.params.messageId)))
  );
  app.post(
    '/sessions/:id/messages/:messageId/media',
    wrap(async (req, res) => res.json(await requireSession(req).downloadMedia(req.params.messageId)))
  );

  // ---- chats -----------------------------------------------------------
  app.post(
    '/sessions/:id/chats/:chatId/read',
    wrap(async (req, res) => res.json(await requireSession(req).markRead(req.params.chatId, req.body?.count)))
  );
  app.post(
    '/sessions/:id/chats/:chatId/modify',
    wrap(async (req, res) =>
      res.json(await requireSession(req).modifyChat(req.params.chatId, { pin: req.body?.pin, archive: req.body?.archive }))
    )
  );
  app.post(
    '/sessions/:id/chats/:chatId/block',
    wrap(async (req, res) => res.json(await requireSession(req).setBlocked(req.params.chatId, Boolean(req.body?.blocked))))
  );
  app.post(
    '/sessions/:id/chats/:chatId/avatar',
    wrap(async (req, res) => res.json(await requireSession(req).refreshAvatar(req.params.chatId)))
  );
  app.post(
    '/sessions/:id/chats/:chatId/history',
    wrap(async (req, res) => res.json(await requireSession(req).requestOlderHistory(req.params.chatId, req.body?.count)))
  );
  app.post(
    '/sessions/:id/check-number',
    wrap(async (req, res) => res.json(await requireSession(req).checkNumber(req.body?.phone)))
  );

  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof BridgeError) {
      return res.status(err.status).json({ error: err.message, code: err.code });
    }
    if (err?.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'Invalid JSON body' });
    }
    // Baileys rejects with Boom errors carrying an HTTP-like status.
    const boomStatus = err?.output?.statusCode;
    log.error({ err: err?.message, stack: err?.stack }, 'bridge request failed');
    res.status(boomStatus && boomStatus >= 400 && boomStatus < 600 ? 502 : 500).json({
      error: err?.message || 'Internal bridge error',
      code: 'BRIDGE_ERROR'
    });
  });

  return app;
}
