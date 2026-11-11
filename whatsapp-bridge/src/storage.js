import crypto from 'node:crypto';
import { NOW_UTC } from './db.js';
import { getLogger } from './logger.js';
import { presignUrl } from './s3.js';

const log = getLogger({ mod: 'storage' });

const EXT_BY_MIME = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/3gpp': '3gp',
  'video/quicktime': 'mov',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/amr': 'amr',
  'audio/webm': 'webm',
  'application/pdf': 'pdf'
};

export function extensionFor(mimeType, fileName) {
  const fromName = typeof fileName === 'string' && fileName.includes('.') ? fileName.split('.').pop().toLowerCase() : '';
  if (/^[a-z0-9]{1,8}$/.test(fromName)) return fromName;
  const base = String(mimeType || '').split(';')[0].trim().toLowerCase();
  return EXT_BY_MIME[base] || 'bin';
}

/**
 * Persistent media storage shared with the API.
 *
 *   db  -> bytes live in whatsapp_media.data (no extra infrastructure; the
 *          default, and what survives a redeploy out of the box)
 *   s3  -> bytes live in an S3-compatible bucket (R2 / S3 / Supabase ...),
 *          whatsapp_media keeps only the object key
 *
 * Nothing is ever written to the container's filesystem.
 */
export class MediaStorage {
  constructor({ db, config }) {
    this.db = db;
    this.driver = config.storage;
    this.s3 = config.s3;
    this.maxBytes = config.maxBytes;
  }

  _objectKey(org, account, id, mimeType, fileName) {
    const prefix = this.s3.prefix ? `${this.s3.prefix}/` : '';
    return `${prefix}${org}/${account}/${id}.${extensionFor(mimeType, fileName)}`;
  }

  /** Stores a file and returns its whatsapp_media row id. */
  async put({ organizationId, accountId, buffer, mimeType, fileName }) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error('refusing to store an empty media file');
    if (buffer.length > this.maxBytes) {
      const err = new Error(`media file is larger than the ${Math.round(this.maxBytes / 1048576)} MB limit`);
      err.code = 'MEDIA_TOO_LARGE';
      throw err;
    }
    const id = crypto.randomUUID();
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    const mime = mimeType ? String(mimeType).slice(0, 127) : null;
    const name = fileName ? String(fileName).slice(0, 255) : null;

    if (this.driver === 's3') {
      const key = this._objectKey(organizationId, accountId, id, mime, name);
      const url = presignUrl(this.s3, { method: 'PUT', key, expiresIn: 600 });
      const res = await fetch(url, {
        method: 'PUT',
        body: buffer,
        headers: { 'Content-Type': (mime || 'application/octet-stream').split(';')[0] },
        signal: AbortSignal.timeout(120_000)
      });
      if (!res.ok) {
        throw new Error(`object storage rejected the upload (HTTP ${res.status})`);
      }
      await this.db.query(
        `INSERT INTO whatsapp_media (id, organization_id, session_id, storage, storage_key, mime_type, file_name, size_bytes, sha256, created_at)
         VALUES ($1, $2, $3, 's3', $4, $5, $6, $7, $8, ${NOW_UTC})`,
        [id, organizationId, accountId, key, mime, name, buffer.length, sha256]
      );
    } else {
      await this.db.query(
        `INSERT INTO whatsapp_media (id, organization_id, session_id, storage, data, mime_type, file_name, size_bytes, sha256, created_at)
         VALUES ($1, $2, $3, 'db', $4, $5, $6, $7, $8, ${NOW_UTC})`,
        [id, organizationId, accountId, buffer, mime, name, buffer.length, sha256]
      );
    }
    return { id, size: buffer.length, sha256, mimeType: mime, fileName: name };
  }

  /** Metadata only (no bytes). */
  async describe({ organizationId, accountId, mediaId }) {
    const res = await this.db.query(
      `SELECT id, storage, storage_key, mime_type, file_name, size_bytes
       FROM whatsapp_media WHERE id = $1 AND organization_id = $2 AND session_id = $3`,
      [mediaId, organizationId, accountId]
    );
    const row = res.rows[0];
    if (!row) return null;
    return { id: row.id, storage: row.storage, storageKey: row.storage_key, mimeType: row.mime_type, fileName: row.file_name, size: row.size_bytes };
  }

  /**
   * What to hand to Baileys as the media payload: the bytes for database
   * storage, or a short-lived pre-signed `{ url }` for object storage (Baileys
   * then streams it straight from the bucket).
   */
  async sendSource({ organizationId, accountId, mediaId }) {
    const info = await this.describe({ organizationId, accountId, mediaId });
    if (!info) return null;
    if (info.storage === 's3' && info.storageKey) {
      return { url: presignUrl(this.s3, { method: 'GET', key: info.storageKey, expiresIn: 600 }) };
    }
    const media = await this.get({ organizationId, accountId, mediaId });
    return media ? media.buffer : null;
  }

  /** Loads a stored file, scoped to the owning organization + account. */
  async get({ organizationId, accountId, mediaId }) {
    const res = await this.db.query(
      `SELECT id, storage, storage_key, data, mime_type, file_name, size_bytes
       FROM whatsapp_media WHERE id = $1 AND organization_id = $2 AND session_id = $3`,
      [mediaId, organizationId, accountId]
    );
    const row = res.rows[0];
    if (!row) return null;
    let buffer = row.data;
    if (row.storage === 's3') {
      const url = presignUrl(this.s3, { method: 'GET', key: row.storage_key, expiresIn: 300 });
      const got = await fetch(url, { signal: AbortSignal.timeout(120_000) });
      if (!got.ok) throw new Error(`object storage returned HTTP ${got.status}`);
      buffer = Buffer.from(await got.arrayBuffer());
    }
    if (!buffer) return null;
    return { id: row.id, buffer, mimeType: row.mime_type, fileName: row.file_name, size: row.size_bytes };
  }

  async remove({ organizationId, accountId, mediaIds }) {
    const ids = [...new Set((mediaIds || []).filter(Boolean))];
    if (!ids.length) return;
    const res = await this.db.query(
      `DELETE FROM whatsapp_media WHERE id = ANY($1::text[]) AND organization_id = $2 AND session_id = $3
       RETURNING storage, storage_key`,
      [ids, organizationId, accountId]
    );
    for (const row of res.rows) {
      if (row.storage !== 's3' || !row.storage_key) continue;
      try {
        await fetch(presignUrl(this.s3, { method: 'DELETE', key: row.storage_key, expiresIn: 120 }), {
          method: 'DELETE',
          signal: AbortSignal.timeout(30_000)
        });
      } catch (err) {
        log.warn({ err: err.message }, 'could not delete object from bucket');
      }
    }
  }
}
