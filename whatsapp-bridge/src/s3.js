import crypto from 'node:crypto';

const hmac = (key, data) => crypto.createHmac('sha256', key).update(data, 'utf8').digest();
const sha256Hex = (data) => crypto.createHash('sha256').update(data, 'utf8').digest('hex');

/** RFC 3986 encoding as required by AWS Signature Version 4. */
export function encodeRfc3986(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

const encodeKeyPath = (key) => key.split('/').map(encodeRfc3986).join('/');

/**
 * Builds a SigV4 pre-signed URL for an S3-compatible object store
 * (AWS S3, Cloudflare R2, Supabase Storage, MinIO ...). Dependency-free; the
 * API has the same routine in Python so both services address the same objects.
 *
 * `pathStyle` (default) produces  https://endpoint/bucket/key  which every
 * S3-compatible provider accepts.
 */
export function presignUrl(s3, { method = 'GET', key, expiresIn = 300, now = new Date(), pathStyle = true } = {}) {
  if (!key) throw new Error('presignUrl: key is required');
  const endpoint = new URL(s3.endpoint);
  const host = endpoint.host;
  const basePath = endpoint.pathname.replace(/\/+$/, '');
  const canonicalUri = pathStyle
    ? `${basePath}/${encodeRfc3986(s3.bucket)}/${encodeKeyPath(key)}`
    : `${basePath}/${encodeKeyPath(key)}`;

  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const region = s3.region || 'auto';
  const scope = `${dateStamp}/${region}/s3/aws4_request`;

  const query = [
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', `${s3.accessKeyId}/${scope}`],
    ['X-Amz-Date', amzDate],
    ['X-Amz-Expires', String(expiresIn)],
    ['X-Amz-SignedHeaders', 'host']
  ]
    .map(([k, v]) => `${encodeRfc3986(k)}=${encodeRfc3986(v)}`)
    .sort()
    .join('&');

  const canonicalRequest = [method.toUpperCase(), canonicalUri, query, `host:${host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');

  const kDate = hmac(`AWS4${s3.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, 's3');
  const kSigning = hmac(kService, 'aws4_request');
  const signature = hmac(kSigning, stringToSign).toString('hex');

  return `${endpoint.protocol}//${host}${canonicalUri}?${query}&X-Amz-Signature=${signature}`;
}
