import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { downloadMediaMessage, proto } from '@whiskeysockets/baileys';
import { getLogger } from './logger.js';
import { toNum } from './message-parser.js';

const require = createRequire(import.meta.url);
const log = getLogger({ mod: 'media' });

let ffmpegPath = null;
try {
  ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
} catch (err) {
  log.warn({ err: err.message }, 'ffmpeg is not available; recorded voice notes will be sent as plain audio files');
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Converts a browser recording (webm/opus, mp4/aac ...) to the OGG/Opus
 * container WhatsApp requires for a real voice note. Returns null when
 * conversion is impossible, in which case the caller sends a normal audio file.
 */
export async function transcodeToVoiceNote(inputBuffer) {
  if (!ffmpegPath || !inputBuffer?.length) return null;
  const tag = crypto.randomBytes(6).toString('hex');
  const src = path.join(os.tmpdir(), `zg-ptt-${tag}.in`);
  const dst = path.join(os.tmpdir(), `zg-ptt-${tag}.ogg`);
  try {
    await fs.writeFile(src, inputBuffer);
    await new Promise((resolve, reject) => {
      execFile(
        ffmpegPath,
        ['-y', '-i', src, '-vn', '-c:a', 'libopus', '-b:a', '32k', '-ar', '48000', '-ac', '1', '-avoid_negative_ts', 'make_zero', '-f', 'ogg', dst],
        { timeout: 60_000, windowsHide: true },
        (err) => (err ? reject(err) : resolve())
      );
    });
    const out = await fs.readFile(dst);
    return out.length ? out : null;
  } catch (err) {
    log.warn({ err: err.message }, 'voice note transcoding failed');
    return null;
  } finally {
    await fs.unlink(src).catch(() => {});
    await fs.unlink(dst).catch(() => {});
  }
}

/** Builds the minimal WAMessage Baileys needs to download a stored message's media. */
export function waMessageFromRow(row) {
  if (!row?.raw_message || !row.meta_message_id) return null;
  let message;
  try {
    message = proto.Message.decode(row.raw_message);
  } catch {
    return null;
  }
  return {
    key: {
      remoteJid: row.remote_jid,
      id: row.meta_message_id,
      fromMe: row.from_me ?? row.direction === 'OUTBOUND'
    },
    message
  };
}

function declaredSize(waMessage) {
  const m = waMessage?.message || {};
  for (const kind of ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage', 'ptvMessage']) {
    if (m[kind]) return toNum(m[kind].fileLength);
  }
  return 0;
}

/**
 * Downloads media from WhatsApp in the background and moves it to persistent
 * storage. Message rows are written first (media_status = 'pending'), so a
 * chat never waits for a file; the row flips to 'ready' when the bytes are
 * safely stored and the realtime feed pushes the update to open clients.
 */
export class MediaDownloader {
  constructor({ storage, store, organizationId, accountId, getSocket, config, onChange, logger }) {
    this.storage = storage;
    this.store = store;
    this.org = organizationId;
    this.account = accountId;
    this.getSocket = getSocket;
    this.maxBytes = config.maxBytes;
    this.concurrency = config.downloadConcurrency;
    this.timeoutMs = config.downloadTimeoutMs;
    this.onChange = onChange || (() => {});
    this.log = logger || log;
    this.queue = [];
    this.active = 0;
    this.known = new Map();
    this.stopped = false;
  }

  stop() {
    this.stopped = true;
    this.queue = [];
  }

  /**
   * @param messageId  whatsapp_messages.id
   * @param waMessage  { key, message } (live message, or rebuilt from the row)
   * @returns a promise resolving to the final media status
   */
  enqueue(messageId, waMessage, { priority = false } = {}) {
    if (this.stopped) return Promise.resolve('failed');
    const existing = this.known.get(messageId);
    if (existing) return existing.promise;
    let resolve;
    const promise = new Promise((r) => {
      resolve = r;
    });
    const job = { messageId, waMessage, resolve, promise };
    this.known.set(messageId, job);
    if (priority) this.queue.unshift(job);
    else this.queue.push(job);
    this._pump();
    return promise;
  }

  _pump() {
    while (!this.stopped && this.active < this.concurrency && this.queue.length) {
      const job = this.queue.shift();
      this.active += 1;
      this._run(job)
        .catch((err) => {
          this.log.warn({ err: err.message }, 'media job crashed');
          return 'failed';
        })
        .then((status) => {
          this.active -= 1;
          this.known.delete(job.messageId);
          job.resolve(status);
          this._pump();
        });
    }
  }

  async _run(job) {
    const { messageId, waMessage } = job;
    const size = declaredSize(waMessage);
    if (size && size > this.maxBytes) {
      await this.store.setMediaResult(messageId, { status: 'too_large', error: `File is ${Math.round(size / 1048576)} MB` });
      this.onChange();
      return 'too_large';
    }

    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
      const sock = this.getSocket();
      if (!sock) {
        lastErr = new Error('WhatsApp is not connected');
        break;
      }
      try {
        const buffer = await withTimeout(
          downloadMediaMessage(waMessage, 'buffer', {}, { logger: this.log, reuploadRequest: sock.updateMediaMessage }),
          this.timeoutMs,
          'media download'
        );
        if (!buffer?.length) throw new Error('empty media payload');
        const content = waMessage.message || {};
        const inner =
          content.imageMessage || content.videoMessage || content.ptvMessage || content.audioMessage || content.documentMessage || content.stickerMessage || {};
        const isSticker = Boolean(content.stickerMessage);
        const stored = await this.storage.put({
          organizationId: this.org,
          accountId: this.account,
          buffer,
          mimeType: inner.mimetype || (isSticker ? 'image/webp' : null),
          fileName: inner.fileName || (isSticker ? 'sticker.webp' : null)
        });
        await this.store.setMediaResult(messageId, {
          status: 'ready',
          mediaId: stored.id,
          mimeType: stored.mimeType,
          size: stored.size
        });
        this.onChange();
        return 'ready';
      } catch (err) {
        lastErr = err;
        if (err.code === 'MEDIA_TOO_LARGE') {
          await this.store.setMediaResult(messageId, { status: 'too_large', error: err.message });
          this.onChange();
          return 'too_large';
        }
        const httpStatus = err?.output?.statusCode || err?.status;
        if (httpStatus === 404 || httpStatus === 410) break; // gone from WhatsApp's servers and the phone
        await sleep(1000 * (attempt + 1));
      }
    }

    const httpStatus = lastErr?.output?.statusCode || lastErr?.status;
    const gone = httpStatus === 404 || httpStatus === 410;
    await this.store.setMediaResult(messageId, {
      status: gone ? 'unavailable' : 'failed',
      error: gone ? 'This media is no longer available on WhatsApp' : lastErr?.message || 'download failed'
    });
    this.onChange();
    return gone ? 'unavailable' : 'failed';
  }
}
