import hashlib
import hmac
import os
from dataclasses import dataclass
from functools import lru_cache

from app.core.config import settings

RENDER_BRIDGE_URL = "https://zigmaa-whatsapp-bridge.onrender.com"
_LOCAL_HINTS = ("localhost", "127.0.0.1", "loca.lt", "ngrok")


def _running_in_cloud() -> bool:
    return bool(
        os.getenv("RENDER")
        or os.getenv("RENDER_SERVICE_ID")
        or os.getenv("RENDER_EXTERNAL_URL")
        or os.getenv("ENVIRONMENT") == "production"
    )


def gateway_url() -> str:
    """
    Base URL of the Node bridge. Exactly one target is ever used: requests are
    never fanned out to "local and production", which is how a development
    machine used to end up driving production sessions.
    """
    url = (os.getenv("WHATSAPP_GATEWAY_URL") or "").strip().rstrip("/")
    if _running_in_cloud():
        if not url or any(hint in url.lower() for hint in _LOCAL_HINTS):
            return RENDER_BRIDGE_URL
        return url
    return url or "http://localhost:5001"


def _derive(purpose: str) -> str:
    return hmac.new(settings.SECRET_KEY.encode("utf-8"), purpose.encode("utf-8"), hashlib.sha256).hexdigest()


@lru_cache(maxsize=1)
def bridge_token() -> str:
    """
    Shared secret between this API and the bridge. WHATSAPP_BRIDGE_TOKEN wins;
    otherwise both sides derive the same value from SECRET_KEY.
    (Must stay in sync with deriveBridgeToken() in whatsapp-bridge/src/config.js.)
    """
    explicit = (os.getenv("WHATSAPP_BRIDGE_TOKEN") or "").strip()
    return explicit or _derive("zigmaa-whatsapp-bridge-v1")


@lru_cache(maxsize=1)
def media_signing_key() -> bytes:
    return bytes.fromhex(_derive("zigmaa-whatsapp-media-url-v1"))


@dataclass(frozen=True)
class S3Config:
    endpoint: str
    region: str
    bucket: str
    access_key_id: str
    secret_access_key: str
    prefix: str

    @property
    def configured(self) -> bool:
        return bool(self.endpoint and self.bucket and self.access_key_id and self.secret_access_key)


@dataclass(frozen=True)
class MediaConfig:
    storage: str
    max_bytes: int
    s3: S3Config


def _int_env(name: str, default: int) -> int:
    try:
        value = int(os.getenv(name, "") or default)
        return value if value > 0 else default
    except ValueError:
        return default


@lru_cache(maxsize=1)
def media_config() -> MediaConfig:
    storage = (os.getenv("WA_MEDIA_STORAGE") or "db").strip().lower()
    s3 = S3Config(
        endpoint=(os.getenv("WA_MEDIA_S3_ENDPOINT") or "").strip().rstrip("/"),
        region=(os.getenv("WA_MEDIA_S3_REGION") or "auto").strip(),
        bucket=(os.getenv("WA_MEDIA_S3_BUCKET") or "").strip(),
        access_key_id=(os.getenv("WA_MEDIA_S3_ACCESS_KEY_ID") or "").strip(),
        secret_access_key=(os.getenv("WA_MEDIA_S3_SECRET_ACCESS_KEY") or "").strip(),
        prefix=(os.getenv("WA_MEDIA_S3_PREFIX") or "whatsapp").strip().strip("/"),
    )
    if storage not in ("db", "s3"):
        storage = "db"
    if storage == "s3" and not s3.configured:
        raise RuntimeError(
            "WA_MEDIA_STORAGE=s3 requires WA_MEDIA_S3_ENDPOINT, WA_MEDIA_S3_BUCKET, "
            "WA_MEDIA_S3_ACCESS_KEY_ID and WA_MEDIA_S3_SECRET_ACCESS_KEY"
        )
    return MediaConfig(storage=storage, max_bytes=_int_env("WA_MEDIA_MAX_BYTES", 64 * 1024 * 1024), s3=s3)
