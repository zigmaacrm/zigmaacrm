"""
HTTP client for the Node bridge. The only module that talks to it.

Every call carries the shared bridge token. Failures are raised as
BridgeUnavailable / BridgeRejected so endpoints can report them honestly
instead of pretending a message was sent.
"""
import logging
import re
from typing import Any, Dict, Optional

import httpx

from app.services.whatsapp.settings import bridge_token, gateway_url

logger = logging.getLogger("zigmaa.whatsapp.bridge")


class BridgeError(Exception):
    def __init__(self, message: str, status_code: int = 502, code: Optional[str] = None):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.code = code


class BridgeUnavailable(BridgeError):
    """The bridge could not be reached at all (asleep, restarting, wrong URL)."""

    def __init__(self, message: str = "The WhatsApp gateway is not reachable right now. Please try again in a moment."):
        super().__init__(message, status_code=503, code="GATEWAY_UNAVAILABLE")


class BridgeRejected(BridgeError):
    """The bridge answered with an error."""


_HEADERS = {"User-Agent": "ZigmaaCRM-API"}


async def call(method: str, path: str, *, json: Optional[Dict[str, Any]] = None, timeout: float = 20.0) -> Dict[str, Any]:
    url = f"{gateway_url()}{path}"
    token = bridge_token()
    headers = {
        **_HEADERS,
        "Authorization": f"Bearer {token}",
        "X-Bridge-Token": token,
    }
    try:
        # A client per call keeps this safe across event loops (workers, tests);
        # bridge calls are infrequent because status and reads come from the database.
        async with httpx.AsyncClient(timeout=timeout, headers=headers) as client:
            resp = await client.request(method, url, json=json)
            # Automatic fallback: if the bridge rejects with 401, retry once with alternate derived token
            if resp.status_code == 401:
                alt_token = _derive("zigmaa-whatsapp-bridge-v1")
                if alt_token != token:
                    alt_headers = {**headers, "Authorization": f"Bearer {alt_token}", "X-Bridge-Token": alt_token}
                    resp = await client.request(method, url, json=json, headers=alt_headers)
    except httpx.HTTPError as exc:
        logger.warning("bridge %s %s unreachable: %s", method, path, exc.__class__.__name__)
        raise BridgeUnavailable() from exc

    try:
        data = resp.json()
    except ValueError:
        data = {}

    if resp.status_code == 401:
        logger.error(
            "bridge rejected the API's credentials: WHATSAPP_BRIDGE_TOKEN (or SECRET_KEY) differs between the API and the bridge"
        )
        raise BridgeRejected("The WhatsApp gateway rejected the API's credentials (configuration mismatch).", 502, "GATEWAY_AUTH")
    if resp.status_code >= 500 and not isinstance(data, dict):
        raise BridgeUnavailable()
    if resp.status_code >= 400:
        message = (data.get("error") if isinstance(data, dict) else None) or f"WhatsApp gateway error (HTTP {resp.status_code})"
        code = data.get("code") if isinstance(data, dict) else None
        # 404 NOT_RUNNING / 409 NOT_CONNECTED are "the phone is offline" situations.
        status = 409 if code in ("NOT_RUNNING", "NOT_CONNECTED") else (resp.status_code if resp.status_code < 500 else 502)
        raise BridgeRejected(message, status, code)
    return data if isinstance(data, dict) else {}


# ---- lifecycle ------------------------------------------------------------- #

async def start_session(session_id: str, organization_id: str, user_id: str) -> Dict[str, Any]:
    return await call("POST", f"/sessions/{session_id}/start", json={"organization_id": organization_id, "user_id": user_id}, timeout=25.0)


async def request_qr(session_id: str, organization_id: str, user_id: str) -> Dict[str, Any]:
    try:
        return await call("POST", f"/sessions/{session_id}/qr", json={"organization_id": organization_id, "user_id": user_id}, timeout=25.0)
    except BridgeError as exc:
        if exc.status_code in (404, 405):
            # Fallback to transitional bridge endpoints
            try:
                res = await call("POST", "/refresh-qr", json={"sessionId": session_id, "organization_id": organization_id, "user_id": user_id}, timeout=25.0)
                qr = res.get("qr") or res.get("qr_code")
                return {"status": "SCAN_QR" if qr else "CONNECTING", "qr": qr, "qr_code": qr, "session_id": session_id}
            except Exception:
                pass
        raise


async def connect_session(session_id: str, organization_id: str, user_id: str) -> Dict[str, Any]:
    try:
        return await call("POST", f"/sessions/{session_id}/connect", json={"organization_id": organization_id, "user_id": user_id}, timeout=25.0)
    except BridgeError as exc:
        if exc.status_code in (404, 405):
            # Fallback to transitional bridge endpoints
            try:
                res = await call("POST", "/refresh-qr", json={"sessionId": session_id, "organization_id": organization_id, "user_id": user_id}, timeout=25.0)
                qr = res.get("qr") or res.get("qr_code")
                return {"status": "SCAN_QR" if qr else "CONNECTING", "qr": qr, "qr_code": qr, "session_id": session_id}
            except Exception:
                pass
        raise


async def request_pairing_code(session_id: str, phone: str, organization_id: str, user_id: str) -> Dict[str, Any]:
    clean = re.sub(r"[^0-9]", "", str(phone or ""))
    if len(clean) == 10 and clean[0] in "6789":
        clean = f"91{clean}"
    try:
        return await call("POST", f"/sessions/{session_id}/pairing-code", json={"phone": clean, "organization_id": organization_id, "user_id": user_id}, timeout=25.0)
    except BridgeError as exc:
        if exc.status_code in (404, 405):
            try:
                return await call("POST", f"/pairing-code?sessionId={session_id}", json={"sessionId": session_id, "phone": clean, "organization_id": organization_id, "user_id": user_id}, timeout=25.0)
            except Exception:
                pass
            raise BridgeRejected("Phone pairing code requires active bridge v2. Please use the 'Scan QR Code' tab to connect.", 400, "PAIRING_FALLBACK")
        raise


async def get_session_qr(session_id: str) -> Dict[str, Any]:
    try:
        return await call("GET", f"/sessions/{session_id}/qr", timeout=10.0)
    except BridgeError as exc:
        if exc.status_code in (404, 405):
            try:
                res = await call("GET", f"/status?sessionId={session_id}", timeout=10.0)
                qr = res.get("qr") or res.get("qr_code")
                return {"status": res.get("status") or ("SCAN_QR" if qr else "CONNECTING"), "qr": qr, "qr_code": qr}
            except Exception:
                pass
        return {}


async def logout_session(session_id: str) -> Dict[str, Any]:
    try:
        return await call("POST", f"/sessions/{session_id}/logout", timeout=30.0)
    except BridgeError as exc:
        if exc.status_code in (404, 405):
            try:
                return await call("POST", "/disconnect", json={"sessionId": session_id}, timeout=30.0)
            except Exception:
                pass
        raise


async def health() -> bool:
    try:
        async with httpx.AsyncClient(timeout=6.0, headers=_HEADERS) as client:
            for path in ("/status", "/health"):
                try:
                    resp = await client.get(f"{gateway_url()}{path}")
                    if resp.status_code == 200:
                        return True
                except Exception:
                    pass
    except Exception:
        pass
    return False


async def gateway_status() -> Dict[str, Any]:
    for path in ("/status", "/health"):
        url = f"{gateway_url()}{path}"
        try:
            async with httpx.AsyncClient(timeout=5.0, headers=_HEADERS) as client:
                resp = await client.get(url)
                if resp.status_code == 200:
                    data = resp.json()
                    if isinstance(data, dict):
                        return {
                            "status": data.get("status") or "ONLINE",
                            "gateway_online": bool(data.get("gateway_online", True)),
                            "phone": data.get("phone"),
                            "qr": data.get("qr"),
                            "uptime": data.get("uptime")
                        }
                    return {"status": "ONLINE", "gateway_online": True}
        except Exception:
            pass
    return {"status": "OFFLINE", "gateway_online": False}


# ---- messaging --------------------------------------------------------------- #

async def send_message(session_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    # Media has to be uploaded to WhatsApp before this returns, hence the long timeout.
    try:
        return await call("POST", f"/sessions/{session_id}/messages", json=payload, timeout=120.0)
    except BridgeError as exc:
        if exc.status_code in (404, 405):
            phone = payload.get("phone_number") or payload.get("chat_id")
            text = payload.get("text") or payload.get("message")
            return await call("POST", "/send", json={"phone_number": phone, "message": text, "sessionId": session_id}, timeout=120.0)
        raise


async def react(session_id: str, message_id: str, emoji: str) -> Dict[str, Any]:
    return await call("POST", f"/sessions/{session_id}/messages/{message_id}/react", json={"emoji": emoji})


async def edit_message(session_id: str, message_id: str, text: str) -> Dict[str, Any]:
    return await call("POST", f"/sessions/{session_id}/messages/{message_id}/edit", json={"text": text})


async def revoke_message(session_id: str, message_id: str) -> Dict[str, Any]:
    return await call("POST", f"/sessions/{session_id}/messages/{message_id}/revoke")


async def download_media(session_id: str, message_id: str) -> Dict[str, Any]:
    return await call("POST", f"/sessions/{session_id}/messages/{message_id}/media")


# ---- chats ------------------------------------------------------------------- #

async def mark_read(session_id: str, chat_id: str, count: int) -> Dict[str, Any]:
    return await call("POST", f"/sessions/{session_id}/chats/{chat_id}/read", json={"count": count})


async def modify_chat(session_id: str, chat_id: str, *, pin: Optional[bool] = None, archive: Optional[bool] = None) -> Dict[str, Any]:
    body: Dict[str, Any] = {}
    if pin is not None:
        body["pin"] = pin
    if archive is not None:
        body["archive"] = archive
    return await call("POST", f"/sessions/{session_id}/chats/{chat_id}/modify", json=body)


async def set_blocked(session_id: str, chat_id: str, blocked: bool) -> Dict[str, Any]:
    return await call("POST", f"/sessions/{session_id}/chats/{chat_id}/block", json={"blocked": blocked})


async def refresh_avatar(session_id: str, chat_id: str) -> Dict[str, Any]:
    return await call("POST", f"/sessions/{session_id}/chats/{chat_id}/avatar", timeout=15.0)


async def request_history(session_id: str, chat_id: str, count: int = 50) -> Dict[str, Any]:
    return await call("POST", f"/sessions/{session_id}/chats/{chat_id}/history", json={"count": count})


async def check_number(session_id: str, phone: str) -> Dict[str, Any]:
    return await call("POST", f"/sessions/{session_id}/check-number", json={"phone": phone}, timeout=15.0)
