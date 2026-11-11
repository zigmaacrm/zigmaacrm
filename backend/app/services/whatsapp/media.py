"""
Media storage and signed download URLs.

Browsers load media through <img>/<audio>/<video>, which cannot send an
Authorization header. Instead of leaving files world-readable (as the old
/media/whatsapp/* route did), every URL handed to a client carries an HMAC
signature bound to the media id, the owning organization and an expiry. URLs
are only ever generated for rows the authenticated caller is allowed to see.
"""
import hashlib
import hmac
import os
import re
import time
import uuid
from typing import Any, Dict, Optional, Tuple

import httpx
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.services.whatsapp.s3 import presign_url
from app.services.whatsapp.settings import media_config, media_signing_key

NOW_UTC = "timezone('utc', clock_timestamp())"

URL_PREFIX = f"{settings.API_V1_STR}/whatsapp/media"
_BUCKET_SECONDS = 12 * 60 * 60

# Only these types are ever rendered inline. Everything else (HTML, SVG,
# scripts, office documents, PDFs ...) is sent as a download, so a file received
# over WhatsApp can never execute in the CRM's origin.
INLINE_MIME_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "video/mp4",
    "video/webm",
    "video/3gpp",
    "video/quicktime",
    "audio/ogg",
    "audio/mpeg",
    "audio/mp4",
    "audio/aac",
    "audio/amr",
    "audio/webm",
    "audio/wav",
    "audio/x-wav",
}

_EXT_BY_MIME = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "video/mp4": "mp4",
    "video/3gpp": "3gp",
    "video/quicktime": "mov",
    "audio/ogg": "ogg",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/aac": "aac",
    "audio/amr": "amr",
    "audio/webm": "webm",
    "application/pdf": "pdf",
}


def base_mime(mime_type: Optional[str]) -> str:
    return (mime_type or "application/octet-stream").split(";")[0].strip().lower()


def extension_for(mime_type: Optional[str], file_name: Optional[str]) -> str:
    if file_name and "." in file_name:
        ext = file_name.rsplit(".", 1)[-1].lower()
        if re.fullmatch(r"[a-z0-9]{1,8}", ext):
            return ext
    return _EXT_BY_MIME.get(base_mime(mime_type), "bin")


def safe_filename(name: Optional[str], fallback: str = "file") -> str:
    cleaned = re.sub(r"[\x00-\x1f\"\\/:*?<>|]+", "_", (name or "").strip()).strip(". ")
    return (cleaned or fallback)[:150]


# --------------------------------------------------------------------------- #
# Signed URLs
# --------------------------------------------------------------------------- #

def _signature(kind: str, ident: str, organization_id: str, expires: int) -> str:
    message = f"{kind}:{ident}:{organization_id}:{expires}".encode("utf-8")
    return hmac.new(media_signing_key(), message, hashlib.sha256).hexdigest()[:40]


def _expiry(now: Optional[float] = None) -> int:
    # Bucketed so the URL of a given file is stable for hours (browser cache
    # friendly) while still expiring within 12-24 h.
    current = int(now if now is not None else time.time())
    return (current // _BUCKET_SECONDS + 2) * _BUCKET_SECONDS


def signed_media_path(kind: str, ident: str, organization_id: str, now: Optional[float] = None) -> str:
    """kind: 'm' = whatsapp_media row, 'l' = legacy file referenced by a message row."""
    expires = _expiry(now)
    sig = _signature(kind, ident, organization_id, expires)
    return f"{URL_PREFIX}/{kind}/{ident}?o={organization_id}&e={expires}&s={sig}"


def verify_signature(kind: str, ident: str, organization_id: str, expires: Any, signature: str, now: Optional[float] = None) -> bool:
    try:
        exp = int(expires)
    except (TypeError, ValueError):
        return False
    if exp < int(now if now is not None else time.time()):
        return False
    expected = _signature(kind, ident, organization_id, exp)
    return hmac.compare_digest(expected, str(signature or ""))


# --------------------------------------------------------------------------- #
# Storage
# --------------------------------------------------------------------------- #

class MediaTooLarge(Exception):
    pass


def _object_key(organization_id: str, session_id: str, media_id: str, mime_type: Optional[str], file_name: Optional[str]) -> str:
    cfg = media_config()
    prefix = f"{cfg.s3.prefix}/" if cfg.s3.prefix else ""
    return f"{prefix}{organization_id}/{session_id}/{media_id}.{extension_for(mime_type, file_name)}"


def _presign(method: str, key: str, expires_in: int = 300) -> str:
    s3 = media_config().s3
    return presign_url(
        endpoint=s3.endpoint,
        region=s3.region,
        bucket=s3.bucket,
        access_key_id=s3.access_key_id,
        secret_access_key=s3.secret_access_key,
        key=key,
        method=method,
        expires_in=expires_in,
    )


async def store_media(
    db: AsyncSession,
    *,
    organization_id: str,
    session_id: str,
    data: bytes,
    mime_type: Optional[str],
    file_name: Optional[str],
) -> Dict[str, Any]:
    """Persists an uploaded file (database or bucket) and returns its row id. Does not commit."""
    cfg = media_config()
    if not data:
        raise ValueError("empty upload")
    if len(data) > cfg.max_bytes:
        raise MediaTooLarge(f"File is larger than the {cfg.max_bytes // (1024 * 1024)} MB limit")

    media_id = str(uuid.uuid4())
    mime = (mime_type or "application/octet-stream")[:127]
    name = safe_filename(file_name, fallback=f"file.{extension_for(mime, None)}")
    digest = hashlib.sha256(data).hexdigest()

    if cfg.storage == "s3":
        key = _object_key(organization_id, session_id, media_id, mime, name)
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.put(_presign("PUT", key, 600), content=data, headers={"Content-Type": base_mime(mime)})
        if resp.status_code >= 300:
            raise RuntimeError(f"object storage rejected the upload (HTTP {resp.status_code})")
        await db.execute(
            text(
                f"""INSERT INTO whatsapp_media (id, organization_id, session_id, storage, storage_key, mime_type, file_name, size_bytes, sha256, created_at)
                    VALUES (:id, :org, :sid, 's3', :key, :mime, :name, :size, :sha, {NOW_UTC})"""
            ),
            {"id": media_id, "org": organization_id, "sid": session_id, "key": key, "mime": mime, "name": name, "size": len(data), "sha": digest},
        )
    else:
        await db.execute(
            text(
                f"""INSERT INTO whatsapp_media (id, organization_id, session_id, storage, data, mime_type, file_name, size_bytes, sha256, created_at)
                    VALUES (:id, :org, :sid, 'db', :data, :mime, :name, :size, :sha, {NOW_UTC})"""
            ),
            {"id": media_id, "org": organization_id, "sid": session_id, "data": data, "mime": mime, "name": name, "size": len(data), "sha": digest},
        )
    return {"id": media_id, "mime_type": mime, "file_name": name, "size": len(data)}


async def delete_media(db: AsyncSession, *, organization_id: str, session_id: str, media_ids) -> None:
    ids = [m for m in dict.fromkeys(media_ids or []) if m]
    if not ids:
        return
    rows = (
        await db.execute(
            text(
                """DELETE FROM whatsapp_media
                   WHERE id = ANY(:ids) AND organization_id = :org AND session_id = :sid
                   RETURNING storage, storage_key"""
            ),
            {"ids": ids, "org": organization_id, "sid": session_id},
        )
    ).all()
    for storage, key in rows:
        if storage == "s3" and key:
            try:
                async with httpx.AsyncClient(timeout=30.0) as client:
                    await client.delete(_presign("DELETE", key, 120))
            except Exception:
                pass


def parse_range(header: Optional[str], size: int) -> Optional[Tuple[int, int]]:
    """Parses a single-range 'bytes=a-b' header. Returns inclusive (start, end) or None."""
    if not header or size <= 0:
        return None
    match = re.fullmatch(r"\s*bytes=(\d*)-(\d*)\s*", header)
    if not match:
        return None
    first, last = match.group(1), match.group(2)
    if first == "" and last == "":
        return None
    if first == "":
        length = int(last)
        if length <= 0:
            return None
        return max(0, size - length), size - 1
    start = int(first)
    end = int(last) if last != "" else size - 1
    if start >= size or start > end:
        return None
    return start, min(end, size - 1)


async def load_media_meta(db: AsyncSession, media_id: str, organization_id: str) -> Optional[Dict[str, Any]]:
    row = (
        await db.execute(
            text(
                """SELECT id, storage, storage_key, mime_type, file_name, sha256,
                          COALESCE(size_bytes, octet_length(data)) AS size
                   FROM whatsapp_media WHERE id = :id AND organization_id = :org"""
            ),
            {"id": media_id, "org": organization_id},
        )
    ).mappings().first()
    return dict(row) if row else None


async def read_media_bytes(db: AsyncSession, media_id: str, organization_id: str, start: Optional[int] = None, end: Optional[int] = None) -> bytes:
    if start is None:
        value = (
            await db.execute(
                text("SELECT data FROM whatsapp_media WHERE id = :id AND organization_id = :org"),
                {"id": media_id, "org": organization_id},
            )
        ).scalar()
    else:
        value = (
            await db.execute(
                text(
                    "SELECT substring(data FROM :start FOR :length) FROM whatsapp_media WHERE id = :id AND organization_id = :org"
                ),
                {"id": media_id, "org": organization_id, "start": start + 1, "length": end - start + 1},
            )
        ).scalar()
    return bytes(value) if value is not None else b""


def presigned_download_url(storage_key: str) -> str:
    return _presign("GET", storage_key, 600)


# --------------------------------------------------------------------------- #
# Files written by the previous integration
# --------------------------------------------------------------------------- #

def legacy_upload_dirs():
    backend_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
    repo_root = os.path.dirname(backend_dir)
    return [
        os.path.join(repo_root, "uploads", "whatsapp"),
        os.path.join(backend_dir, "uploads", "whatsapp"),
        os.path.join(repo_root, "whatsapp-bridge", "uploads"),
        os.path.join(os.getcwd(), "uploads", "whatsapp"),
    ]


def find_legacy_file(media_url: Optional[str], file_name: Optional[str]) -> Optional[str]:
    """Locates a file the old bridge saved to local disk. Never follows path separators."""
    candidates = []
    for value in (media_url, file_name):
        if value:
            name = os.path.basename(str(value).replace("\\", "/"))
            if name and name not in (".", "..") and name not in candidates:
                candidates.append(name)
    for directory in legacy_upload_dirs():
        for name in candidates:
            path = os.path.join(directory, name)
            if os.path.isfile(path):
                return path
    return None


def sniff_mime(head: bytes, file_name: Optional[str], declared_type: Optional[str]) -> str:
    """Best-effort content type for legacy files that were stored without one."""
    if head.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if head.startswith(b"\x89PNG"):
        return "image/png"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    if head.startswith(b"GIF8"):
        return "image/gif"
    if head.startswith(b"OggS"):
        return "audio/ogg"
    if head.startswith(b"ID3") or head[:2] == b"\xff\xfb":
        return "audio/mpeg"
    if head.startswith(b"\x1aE\xdf\xa3"):
        return "audio/webm" if (declared_type or "") in ("audio", "ptt") else "video/webm"
    if head.startswith(b"%PDF"):
        return "application/pdf"
    if head[4:8] == b"ftyp":
        return "audio/mp4" if (declared_type or "") in ("audio", "ptt") else "video/mp4"
    return "application/octet-stream"
