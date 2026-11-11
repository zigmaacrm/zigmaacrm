"""
SigV4 pre-signed URLs for S3-compatible object storage (AWS S3, Cloudflare R2,
Supabase Storage, MinIO). Dependency-free mirror of whatsapp-bridge/src/s3.js,
so both services address the same objects without an SDK.
"""
import datetime
import hashlib
import hmac
from typing import Optional
from urllib.parse import quote, urlsplit


def _rfc3986(value: str) -> str:
    return quote(value, safe="-_.~")


def _encode_key(key: str) -> str:
    return "/".join(_rfc3986(part) for part in key.split("/"))


def _hmac(key: bytes, data: str) -> bytes:
    return hmac.new(key, data.encode("utf-8"), hashlib.sha256).digest()


def presign_url(
    *,
    endpoint: str,
    region: str,
    bucket: str,
    access_key_id: str,
    secret_access_key: str,
    key: str,
    method: str = "GET",
    expires_in: int = 300,
    now: Optional[datetime.datetime] = None,
    path_style: bool = True,
) -> str:
    if not key:
        raise ValueError("presign_url: key is required")
    parts = urlsplit(endpoint)
    host = parts.netloc
    base_path = parts.path.rstrip("/")
    canonical_uri = (
        f"{base_path}/{_rfc3986(bucket)}/{_encode_key(key)}" if path_style else f"{base_path}/{_encode_key(key)}"
    )

    moment = now or datetime.datetime.now(datetime.timezone.utc)
    amz_date = moment.strftime("%Y%m%dT%H%M%SZ")
    date_stamp = amz_date[:8]
    region = region or "auto"
    scope = f"{date_stamp}/{region}/s3/aws4_request"

    query_pairs = [
        ("X-Amz-Algorithm", "AWS4-HMAC-SHA256"),
        ("X-Amz-Credential", f"{access_key_id}/{scope}"),
        ("X-Amz-Date", amz_date),
        ("X-Amz-Expires", str(expires_in)),
        ("X-Amz-SignedHeaders", "host"),
    ]
    query = "&".join(sorted(f"{_rfc3986(k)}={_rfc3986(v)}" for k, v in query_pairs))

    canonical_request = "\n".join([method.upper(), canonical_uri, query, f"host:{host}\n", "host", "UNSIGNED-PAYLOAD"])
    string_to_sign = "\n".join(
        ["AWS4-HMAC-SHA256", amz_date, scope, hashlib.sha256(canonical_request.encode("utf-8")).hexdigest()]
    )
    k_date = _hmac(("AWS4" + secret_access_key).encode("utf-8"), date_stamp)
    k_region = _hmac(k_date, region)
    k_service = _hmac(k_region, "s3")
    k_signing = _hmac(k_service, "aws4_request")
    signature = hmac.new(k_signing, string_to_sign.encode("utf-8"), hashlib.sha256).hexdigest()

    return f"{parts.scheme}://{host}{canonical_uri}?{query}&X-Amz-Signature={signature}"
