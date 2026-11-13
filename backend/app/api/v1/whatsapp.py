"""
WhatsApp Suite API Router.
Enforces strict multi-tenant isolation, database-backed persistent sessions,
and zero auto-lead pollution into CRM tables.
"""
import base64
import logging
import os
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from dotenv import dotenv_values
from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    Header,
    HTTPException,
    Query,
    Request,
    Response,
    status,
)
from fastapi.responses import RedirectResponse, StreamingResponse
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_optional_current_user
from app.core.config import settings
from app.core.database import AsyncSessionLocal, get_db
from app.models.organization_user import User
from app.services.whatsapp import bridge, media, repository, serializers
from app.services.whatsapp.realtime import hub, stream_whatsapp_events
from app.services.whatsapp.settings import bridge_token

logger = logging.getLogger("zigmaa.whatsapp.api")

router = APIRouter()


def get_whatsapp_credentials():
    """Read credentials dynamically from .env to pick up any changes without server restart."""
    backend_env = Path(__file__).resolve().parent.parent.parent.parent / ".env"
    env_vals = dotenv_values(backend_env) if backend_env.exists() else {}
    api_token = (
        env_vals.get("WHATSAPP_ACCESS_TOKEN")
        or env_vals.get("WHATSAPP_API_TOKEN")
        or os.getenv("WHATSAPP_ACCESS_TOKEN")
        or os.getenv("WHATSAPP_API_TOKEN")
        or getattr(settings, "WHATSAPP_ACCESS_TOKEN", "")
        or getattr(settings, "WHATSAPP_API_TOKEN", "")
        or ""
    ).strip()
    phone_number_id = (
        env_vals.get("WHATSAPP_PHONE_NUMBER_ID")
        or os.getenv("WHATSAPP_PHONE_NUMBER_ID")
        or getattr(settings, "WHATSAPP_PHONE_NUMBER_ID", "")
        or ""
    ).strip()
    return api_token, phone_number_id


# --------------------------------------------------------------------------- #
# Request / Response Schemas
# --------------------------------------------------------------------------- #

class SendMessagePayload(BaseModel):
    chat_id: Optional[str] = None
    phone_number: Optional[str] = None
    text: Optional[str] = None
    message: Optional[str] = None  # alias for text
    media_id: Optional[str] = None
    file_base64: Optional[str] = None
    file_name: Optional[str] = None
    file_type: Optional[str] = None
    voice_note: bool = False
    quoted_message_id: Optional[str] = None
    client_ref: Optional[str] = None


class ConvertLeadPayload(BaseModel):
    lead_name: Optional[str] = None
    company_name: Optional[str] = None
    email: Optional[str] = None


class ReactPayload(BaseModel):
    phone_number: Optional[str] = None
    meta_message_id: Optional[str] = None
    message_id: Optional[str] = None
    emoji: str = ""
    from_me: bool = False


class EditMessagePayload(BaseModel):
    phone_number: Optional[str] = None
    meta_message_id: Optional[str] = None
    message_id: Optional[str] = None
    text: str


class DeleteMessagePayload(BaseModel):
    phone_number: Optional[str] = None
    meta_message_id: Optional[str] = None
    message_id: Optional[str] = None
    delete_for_everyone: bool = True
    from_me: bool = True


class UploadVoicePayload(BaseModel):
    phone_number: Optional[str] = None
    chat_id: Optional[str] = None
    audio_base64: str
    mimetype: Optional[str] = "audio/ogg; codecs=opus"
    duration_seconds: Optional[int] = None


class UpdateChatFlagsPayload(BaseModel):
    is_pinned: Optional[bool] = None
    is_archived: Optional[bool] = None
    is_muted: Optional[bool] = None
    is_blocked: Optional[bool] = None
    custom_name: Optional[str] = None


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #

def _get_user_session_id(user: User) -> str:
    return f"wa_{str(user.id).replace('-', '')[:24]}"


async def _resolve_active_session_and_phone(
    db: AsyncSession, user: User, requested_phone: Optional[str] = None
) -> Tuple[Dict[str, Any], Optional[str]]:
    session_row, is_stale = await repository.get_user_session(db, user.organization_id, user.id)
    if not session_row:
        session_row = await repository.ensure_user_session(db, user.organization_id, user.id)

    # Clean requested phone (only if it is a real phone number, not a user UUID!)
    clean_req_phone = None
    if requested_phone:
        str_req = str(requested_phone).strip()
        if "-" not in str_req and not str_req.startswith("wa_"):
            clean_digits = re.sub(r"[^0-9]", "", str_req)
            if 7 <= len(clean_digits) <= 15:
                clean_req_phone = clean_digits

    phone = session_row.get("phone_number") or getattr(user, "whatsapp_phone_number", None) or clean_req_phone
    clean_phone = re.sub(r"[^0-9]", "", str(phone or "")) if phone else None
    return session_row, clean_phone


# --------------------------------------------------------------------------- #
# 1. Lifecycle & Persistent Sessions
# --------------------------------------------------------------------------- #

@router.get("/status")
@router.get("/health")
async def get_gateway_status():
    """
    Lightweight health/warm-up ping. Wakes the Render bridge service if sleeping,
    so subsequent QR generation has zero cold-start delay.
    """
    return await bridge.gateway_status()


@router.post("/connect")
async def connect_whatsapp_session(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Connects to WhatsApp Gateway and immediately returns pre-rendered QR Data URL (0ms if cached, <2s fresh).
    """
    sid = _get_user_session_id(current_user)
    await repository.ensure_user_session(db, current_user.organization_id, current_user.id)
    try:
        bridge_resp = await bridge.connect_session(sid, current_user.organization_id, current_user.id)
    except bridge.BridgeError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message)

    session_row, is_stale = await repository.get_user_session(db, current_user.organization_id, current_user.id)
    serialized = serializers.serialize_session(session_row, gateway_online=True, stale=is_stale)
    qr_data = bridge_resp.get("qr_code") or bridge_resp.get("qr") or serialized.get("qr")
    if qr_data:
        serialized["qr"] = qr_data
        serialized["qr_code"] = qr_data
        serialized["status"] = "SCAN_QR"
        try:
            await repository.update_user_session_qr(db, current_user.organization_id, current_user.id, qr_data, status="SCAN_QR")
        except Exception as e:
            logger.warning("Could not persist session QR: %s", e)
    return serialized


@router.get("/qr")
async def get_whatsapp_qr(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Returns latest cached QR Data URL immediately.
    """
    sid = _get_user_session_id(current_user)
    session_row, is_stale = await repository.get_user_session(db, current_user.organization_id, current_user.id)
    qr_from_bridge = None
    try:
        b_res = await bridge.get_session_qr(sid)
        qr_from_bridge = b_res.get("qr_code") or b_res.get("qr")
    except Exception:
        pass

    serialized = serializers.serialize_session(session_row, gateway_online=True, stale=is_stale)
    final_qr = qr_from_bridge or serialized.get("qr")
    if final_qr:
        serialized["qr"] = final_qr
        serialized["qr_code"] = final_qr
        serialized["status"] = "SCAN_QR"
        try:
            await repository.update_user_session_qr(db, current_user.organization_id, current_user.id, final_qr, status="SCAN_QR")
        except Exception as e:
            logger.warning("Could not persist session QR: %s", e)
    return serialized


@router.get("/sessions/me")
@router.get("/qr/status")
async def get_my_session_status(
    sessionId: Optional[str] = Query(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Returns current user's persistent WhatsApp session state, connection status, and QR code.
    Reads auth state directly from PostgreSQL, surviving all page refreshes and server restarts.
    """
    session_row, is_stale = await repository.get_user_session(db, current_user.organization_id, current_user.id)
    gateway_online = await bridge.health()

    status = (session_row.get("status") if session_row else None) or "NOT_LINKED"

    # If the session is explicitly NOT_LINKED or LOGGED_OUT, or has no creds: strictly report as NOT_LINKED / LOGGED_OUT.
    # Never fabricate a CONNECTED state when the session has been explicitly unlinked!
    if status in ("NOT_LINKED", "LOGGED_OUT") or not (session_row and session_row.get("creds")):
        if session_row:
            session_row = dict(session_row)
            session_row["phone_number"] = None
            if status not in ("NOT_LINKED", "LOGGED_OUT", "SCAN_QR", "CONNECTING"):
                session_row["status"] = "NOT_LINKED"
        return serializers.serialize_session(session_row, gateway_online=gateway_online, stale=is_stale)

    # If the database does not have an active QR yet, check if bridge has one cached
    if (not session_row or not session_row.get("qr")) and not (session_row and session_row.get("phone_number")):
        try:
            sid = _get_user_session_id(current_user)
            b_res = await bridge.get_session_qr(sid)
            qr_val = b_res.get("qr_code") or b_res.get("qr")
            if qr_val:
                await repository.update_user_session_qr(db, current_user.organization_id, current_user.id, qr_val, status="SCAN_QR")
                session_row, is_stale = await repository.get_user_session(db, current_user.organization_id, current_user.id)
        except Exception:
            pass

    # If session_row is CONNECTED, ensure phone_number is synced bi-directionally between session and user
    if session_row and session_row.get("status") == "CONNECTED":
        sess_phone = session_row.get("phone_number")
        if sess_phone and not current_user.whatsapp_phone_number:
            try:
                current_user.whatsapp_phone_number = sess_phone
                await db.execute(
                    text("UPDATE users SET whatsapp_phone_number = :p WHERE id = :uid"),
                    {"p": sess_phone, "uid": current_user.id}
                )
                await db.commit()
            except Exception:
                pass
        elif not sess_phone and current_user.whatsapp_phone_number:
            session_row = dict(session_row)
            session_row["phone_number"] = current_user.whatsapp_phone_number

    return serializers.serialize_session(session_row, gateway_online=gateway_online, stale=is_stale)


@router.post("/sessions/me/qr")
@router.post("/qr/refresh")
async def refresh_qr_code(
    sessionId: Optional[str] = Query(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Requests a fresh pairing QR code from the Node bridge.
    The socket is preserved as a singleton.
    """
    sid = _get_user_session_id(current_user)
    await repository.ensure_user_session(db, current_user.organization_id, current_user.id)

    try:
        bridge_resp = await bridge.request_qr(sid, current_user.organization_id, current_user.id)
    except bridge.BridgeError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message)

    session_row, is_stale = await repository.get_user_session(db, current_user.organization_id, current_user.id)
    serialized = serializers.serialize_session(session_row, gateway_online=True, stale=is_stale)
    qr_data = bridge_resp.get("qr_code") or bridge_resp.get("qr") or serialized.get("qr")
    if qr_data:
        serialized["qr"] = qr_data
        serialized["qr_code"] = qr_data
        serialized["status"] = "SCAN_QR"
        try:
            await repository.update_user_session_qr(db, current_user.organization_id, current_user.id, qr_data, status="SCAN_QR")
        except Exception as e:
            logger.warning("Could not persist session QR: %s", e)
    return serialized


class PairingCodeRequest(BaseModel):
    phone: Optional[str] = None
    phone_number: Optional[str] = None


@router.post("/sessions/me/pairing-code")
@router.post("/pairing-code")
async def request_pairing_code_endpoint(
    payload: PairingCodeRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Generates an 8-character WhatsApp pairing code for linking without scanning a QR code.
    Matches WhatsApp mobile's 'Link with phone number instead'.
    """
    phone = payload.phone or payload.phone_number
    if not phone:
        raise HTTPException(status_code=400, detail="Phone number is required for pairing code")

    clean = re.sub(r"[^0-9]", "", str(phone or ""))
    if len(clean) == 10 and clean[0] in "6789":
        clean = f"91{clean}"
    if len(clean) < 8:
        raise HTTPException(status_code=400, detail="Please include country code, e.g. 919600471080")

    sid = _get_user_session_id(current_user)
    await repository.ensure_user_session(db, current_user.organization_id, current_user.id)
    try:
        return await bridge.request_pairing_code(sid, clean, current_user.organization_id, current_user.id)
    except bridge.BridgeError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message)


@router.post("/sessions/me/logout")
@router.post("/qr/disconnect")
async def logout_whatsapp_session(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Explicitly unlinks the WhatsApp account and clears session keys upon user request only.
    """
    sid = _get_user_session_id(current_user)
    try:
        await bridge.logout_session(sid)
    except Exception as exc:
        logger.warning("Bridge logout notification returned: %s", exc)

    # Completely wipe database session row, Signal keys, and user whatsapp_phone_number
    await repository.unlink_user_session(db, current_user.organization_id, current_user.id)
    current_user.whatsapp_phone_number = None

    try:
        from app.api.v1.webhooks.whatsapp import _qr_status_cache
        _qr_status_cache.pop(current_user.id, None)
    except Exception:
        pass

    hub.notify(sid)
    return {"status": "NOT_LINKED", "message": "WhatsApp device unlinked successfully."}


# --------------------------------------------------------------------------- #
# 2. Chats / Conversations
# --------------------------------------------------------------------------- #

@router.get("/chats")
@router.get("/conversations")
async def list_user_chats(
    filter: str = Query("all", alias="filter_type"),
    search: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    active_session_phone: Optional[str] = Query(None),
    session_id: Optional[str] = Query(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Lists 1-on-1 WhatsApp conversations for the logged-in user.
    Excludes groups (@g.us) and broadcast status.
    Strictly isolated: never mixes with CRM leads unless explicitly converted.
    """
    clean_req_phone = None
    for cand in (active_session_phone, session_id):
        if cand and "-" not in str(cand) and not str(cand).startswith("wa_"):
            clean_digits = re.sub(r"[^0-9]", "", str(cand))
            if 7 <= len(clean_digits) <= 15:
                clean_req_phone = clean_digits
                break

    session_row, phone = await _resolve_active_session_and_phone(db, current_user, requested_phone=clean_req_phone)
    if not phone:
        # Strictly multi-tenant & user isolated: User has not linked their WhatsApp device yet.
        # Never leak other users' conversations or fall back to cross-user sessions.
        return {
            "status": "success",
            "conversations": [],
            "chats": [],
            "counts": {"all": 0, "unread": 0, "pinned": 0, "archived": 0},
            "pagination": {"limit": limit, "offset": offset, "total": 0},
        }

    chats = await repository.list_chats(
        db,
        organization_id=current_user.organization_id,
        session_id=phone,
        filter_type=filter,
        search=search,
        limit=limit,
        offset=offset,
    )
    counts = await repository.get_chat_counts(db, current_user.organization_id, phone)
    serialized = [serializers.serialize_chat(c, own_phone=phone) for c in chats]

    return {
        "status": "success",
        "conversations": serialized,
        "chats": serialized,
        "counts": counts,
    }


@router.get("/chats/{chat_id}")
async def get_single_chat(
    chat_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    session_row, phone = await _resolve_active_session_and_phone(db, current_user)
    if not phone:
        raise HTTPException(status_code=404, detail="No linked WhatsApp session.")

    chat = await repository.get_chat(db, current_user.organization_id, phone, chat_id)
    if not chat:
        raise HTTPException(status_code=404, detail="Conversation not found.")

    return serializers.serialize_chat(chat, own_phone=phone)


@router.patch("/chats/{chat_id}")
async def update_chat_flags(
    chat_id: str,
    payload: UpdateChatFlagsPayload,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    session_row, phone = await _resolve_active_session_and_phone(db, current_user)
    if not phone:
        raise HTTPException(status_code=400, detail="No active WhatsApp session.")

    updated = await repository.update_chat_flags(
        db,
        organization_id=current_user.organization_id,
        session_id=phone,
        chat_id=chat_id,
        is_pinned=payload.is_pinned,
        is_archived=payload.is_archived,
        is_muted=payload.is_muted,
        is_blocked=payload.is_blocked,
        custom_name=payload.custom_name,
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Chat not found.")

    sid = _get_user_session_id(current_user)
    if payload.is_pinned is not None or payload.is_archived is not None:
        try:
            await bridge.modify_chat(sid, chat_id, pin=payload.is_pinned, archive=payload.is_archived)
        except Exception:
            pass

    return serializers.serialize_chat(updated, own_phone=phone)


@router.post("/conversations/{chat_id}/pin")
@router.post("/chats/{chat_id}/pin")
async def toggle_pin_conversation(
    chat_id: str,
    pinned: bool = Query(True),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await update_chat_flags(chat_id, UpdateChatFlagsPayload(is_pinned=pinned), current_user, db)


@router.post("/conversations/{chat_id}/archive")
@router.post("/chats/{chat_id}/archive")
async def toggle_archive_conversation(
    chat_id: str,
    archived: bool = Query(True),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await update_chat_flags(chat_id, UpdateChatFlagsPayload(is_archived=archived), current_user, db)


@router.post("/conversations/{chat_id}/read")
@router.post("/chats/{chat_id}/read")
async def mark_conversation_read(
    chat_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    session_row, phone = await _resolve_active_session_and_phone(db, current_user)
    if phone:
        await repository.mark_chat_read(db, current_user.organization_id, phone, chat_id)
        sid = _get_user_session_id(current_user)
        try:
            await bridge.mark_read(sid, chat_id, 0)
        except Exception:
            pass
        hub.notify(sid)

    return {"status": "success"}


# --------------------------------------------------------------------------- #
# 3. Explicit Conversion to CRM (Zero Auto-Creation)
# --------------------------------------------------------------------------- #

@router.post("/chats/{chat_id}/convert-lead")
@router.post("/conversations/{chat_id}/convert-lead")
async def convert_chat_to_lead_endpoint(
    chat_id: str,
    payload: ConvertLeadPayload = ConvertLeadPayload(),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    STRICT OPT-IN: Converts an existing WhatsApp conversation into a CRM Lead & Contact.
    This is NEVER performed automatically.
    """
    session_row, phone = await _resolve_active_session_and_phone(db, current_user)
    if not phone:
        raise HTTPException(status_code=400, detail="WhatsApp is not connected.")

    try:
        updated_chat = await repository.convert_chat_to_lead(
            db,
            organization_id=current_user.organization_id,
            session_id=phone,
            chat_id=chat_id,
            user_id=current_user.id,
            user_name=current_user.full_name or "Sales Team",
            lead_name=payload.lead_name,
            company_name=payload.company_name,
            email=payload.email,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))

    return {
        "status": "success",
        "message": "WhatsApp conversation successfully added to CRM Leads.",
        "chat": serializers.serialize_chat(updated_chat, own_phone=phone),
    }


# --------------------------------------------------------------------------- #
# 4. Messages History & Dispatching
# --------------------------------------------------------------------------- #

@router.get("/chats/{chat_id}/messages")
@router.get("/messages")
async def list_chat_messages(
    chat_id: Optional[str] = None,
    chat_id_query: Optional[str] = Query(None, alias="chat_id"),
    phone_number: Optional[str] = Query(None),
    phone: Optional[str] = Query(None),
    contact_id: Optional[str] = Query(None),
    active_session_phone: Optional[str] = Query(None),
    session_id: Optional[str] = Query(None),
    before_seq: Optional[int] = Query(None),
    limit: int = Query(100, ge=1, le=200),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    requested_phone = active_session_phone or session_id
    session_row, own_phone = await _resolve_active_session_and_phone(db, current_user, requested_phone=requested_phone)

    target_chat_id = chat_id or chat_id_query
    search_num = phone_number or phone
    clean_p = re.sub(r"[^0-9]", "", str(search_num or "")) if search_num else None

    if not target_chat_id and clean_p:
        # 1. Resolve chat_id by phone number in chats table
        clean_10 = clean_p[-10:] if len(clean_p) >= 10 else clean_p
        chats = await repository.list_chats(
            db,
            organization_id=current_user.organization_id,
            session_id=own_phone or clean_p,
            search=clean_10,
            limit=5,
        )
        if chats:
            target_chat_id = chats[0]["id"]
        else:
            # 2. Lookup in whatsapp_messages directly
            stmt = text(
                """SELECT chat_id FROM whatsapp_messages
                   WHERE organization_id = :org_id AND (phone_number LIKE :p10 OR phone_number = :clean_p)
                   ORDER BY seq DESC NULLS LAST, created_at DESC LIMIT 1"""
            )
            res = await db.execute(stmt, {"org_id": current_user.organization_id, "p10": f"%{clean_10}%", "clean_p": clean_p})
            target_chat_id = res.scalar()

    rows: List[Dict[str, Any]] = []
    if target_chat_id:
        rows = await repository.list_messages(
            db,
            organization_id=current_user.organization_id,
            chat_id=target_chat_id,
            before_seq=before_seq,
            limit=limit,
        )
    elif clean_p:
        clean_10 = clean_p[-10:] if len(clean_p) >= 10 else clean_p
        stmt = text(
            """SELECT m.*
               FROM whatsapp_messages m
               WHERE m.organization_id = :org_id AND (m.phone_number LIKE :p10 OR m.phone_number = :clean_p)
               ORDER BY m.seq DESC NULLS LAST, m.created_at DESC
               LIMIT :limit"""
        )
        res = await db.execute(stmt, {"org_id": current_user.organization_id, "p10": f"%{clean_10}%", "clean_p": clean_p, "limit": limit})
        rows = [dict(r._mapping) for r in res.fetchall()]
        rows.reverse()

    serialized = [serializers.serialize_message(r, current_user.organization_id) for r in rows]

    return {
        "status": "success",
        "chat_id": target_chat_id,
        "messages": serialized,
        "count": len(serialized),
    }


@router.post("/chats/{chat_id}/messages")
@router.post("/send")
async def send_whatsapp_message(
    payload: SendMessagePayload,
    chat_id: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Dispatches outbound WhatsApp text, rich media, or quoted replies through the Node bridge.
    Updates the database immediately and streams progress to all devices.
    """
    session_row, phone = await _resolve_active_session_and_phone(db, current_user)
    if not phone:
        raise HTTPException(
            status_code=400,
            detail="Your WhatsApp account is not linked. Please scan the QR code first.",
        )

    target_chat_id = chat_id or payload.chat_id
    if not target_chat_id and payload.phone_number:
        clean_p = payload.phone_number.replace("+", "").replace(" ", "").replace("-", "")
        chats = await repository.list_chats(
            db,
            organization_id=current_user.organization_id,
            session_id=phone,
            search=clean_p,
            limit=1,
        )
        if chats:
            target_chat_id = chats[0]["id"]
        else:
            # Check number validity via bridge
            target_chat_id = f"{clean_p}@s.whatsapp.net"

    if not target_chat_id:
        raise HTTPException(status_code=400, detail="Target chat or recipient phone number required.")

    media_id = payload.media_id
    if payload.file_base64 and not media_id:
        raw_b64 = payload.file_base64
        if "," in raw_b64:
            raw_b64 = raw_b64.split(",", 1)[1]
        data_bytes = base64.b64decode(raw_b64)
        stored = await media.store_media(
            db,
            organization_id=current_user.organization_id,
            session_id=phone,
            data=data_bytes,
            mime_type=payload.file_type or "application/octet-stream",
            file_name=payload.file_name or "attachment",
        )
        await db.commit()
        media_id = stored["id"]

    sid = _get_user_session_id(current_user)
    text_content = payload.text or payload.message or ""

    bridge_body = {
        "chat_id": target_chat_id,
        "text": text_content,
        "media_id": media_id,
        "voice_note": payload.voice_note,
        "quoted_message_id": payload.quoted_message_id,
        "client_ref": payload.client_ref,
        "sender_user_id": current_user.id,
    }

    try:
        bridge_res = await bridge.send_message(sid, bridge_body)
    except bridge.BridgeError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message)

    hub.notify(sid)
    if phone:
        hub.notify(phone)

    return {
        "status": "success",
        "data": bridge_res,
        "message": "Dispatched to WhatsApp.",
    }


@router.post("/upload-voice")
async def upload_voice_note(
    payload: UploadVoicePayload,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Receives voice note audio from browser microphone and dispatches directly as PTT (voice note).
    """
    send_payload = SendMessagePayload(
        chat_id=payload.chat_id,
        phone_number=payload.phone_number,
        file_base64=payload.audio_base64,
        file_type=payload.mimetype or "audio/ogg; codecs=opus",
        file_name="voice_note.ogg",
        voice_note=True,
    )
    return await send_whatsapp_message(send_payload, payload.chat_id, current_user, db)


@router.post("/react")
async def react_to_message(
    payload: ReactPayload,
    current_user: User = Depends(get_current_user),
):
    sid = _get_user_session_id(current_user)
    mid = payload.message_id or payload.meta_message_id
    if not mid:
        raise HTTPException(status_code=400, detail="Message ID is required.")
    return await bridge.react(sid, mid, payload.emoji)


@router.post("/edit-message")
async def edit_whatsapp_message(
    payload: EditMessagePayload,
    current_user: User = Depends(get_current_user),
):
    sid = _get_user_session_id(current_user)
    mid = payload.message_id or payload.meta_message_id
    if not mid:
        raise HTTPException(status_code=400, detail="Message ID is required.")
    return await bridge.edit_message(sid, mid, payload.text)


@router.post("/delete-message")
async def delete_whatsapp_message(
    payload: DeleteMessagePayload,
    current_user: User = Depends(get_current_user),
):
    sid = _get_user_session_id(current_user)
    mid = payload.message_id or payload.meta_message_id
    if not mid:
        raise HTTPException(status_code=400, detail="Message ID is required.")
    return await bridge.revoke_message(sid, mid)


# --------------------------------------------------------------------------- #
# 5. Secure Media Streaming
# --------------------------------------------------------------------------- #

@router.get("/media/{kind}/{ident}")
async def serve_media(
    kind: str,
    ident: str,
    request: Request,
    o: Optional[str] = Query(None),
    e: Optional[str] = Query(None),
    s: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: Optional[User] = Depends(get_optional_current_user),
):
    """
    Streams media content securely:
    - Validates HMAC signature or user authentication.
    - Prevents arbitrary cross-tenant file leakage.
    - Supports HTTP Range headers for seamless audio/video scrub and seeking.
    """
    target_org = (current_user.organization_id if current_user else None) or o
    if not target_org:
        raise HTTPException(status_code=401, detail="Authentication or signature required.")

    if not current_user:
        if not e or not s or not media.verify_signature(kind, ident, target_org, e, s):
            raise HTTPException(status_code=403, detail="Invalid or expired media signature.")

    meta = await media.load_media_meta(db, ident, target_org)
    if not meta:
        raise HTTPException(status_code=404, detail="Media not found.")

    if meta.get("storage") == "s3" and meta.get("storage_key"):
        return RedirectResponse(media.presigned_download_url(meta["storage_key"]))

    total_size = meta.get("size") or 0
    mime_type = meta.get("mime_type") or "application/octet-stream"
    range_header = request.headers.get("range")
    byte_range = media.parse_range(range_header, total_size) if range_header else None

    if byte_range:
        start, end = byte_range
        chunk = await media.read_media_bytes(db, ident, target_org, start, end)
        headers = {
            "Content-Range": f"bytes {start}-{end}/{total_size}",
            "Accept-Ranges": "bytes",
            "Content-Length": str(len(chunk)),
            "Content-Type": mime_type,
        }
        return Response(content=chunk, status_code=206, headers=headers)

    full_bytes = await media.read_media_bytes(db, ident, target_org)
    headers = {
        "Accept-Ranges": "bytes",
        "Content-Length": str(len(full_bytes)),
        "Content-Type": mime_type,
    }
    return Response(content=full_bytes, status_code=200, headers=headers)


# --------------------------------------------------------------------------- #
# 6. Realtime Synchronization Feed
# --------------------------------------------------------------------------- #

@router.get("/realtime")
async def realtime_event_stream(
    request: Request,
    current_user: User = Depends(get_current_user),
):
    """
    Live Server-Sent Events (SSE) feed for instant synchronization across all open tabs.
    Wakes up immediately on notifications without long polling delays.
    """
    return StreamingResponse(
        stream_whatsapp_events(
            request,
            AsyncSessionLocal,
            current_user.organization_id,
            current_user.id,
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/internal/notify")
async def internal_notify_ping(
    payload: Dict[str, Any],
    authorization: Optional[str] = Header(None),
):
    """
    Internal notification webhook for the Node bridge to ping the API upon new events.
    """
    expected_token = bridge_token()
    given_token = ""
    if authorization and authorization.lower().startswith("bearer "):
        given_token = authorization[7:].strip()

    if given_token != expected_token:
        raise HTTPException(status_code=401, detail="Unauthorized")

    sid = payload.get("session_id")
    if sid:
        hub.notify(str(sid))

    return {"status": "ok"}


# --------------------------------------------------------------------------- #
# 7. Database Maintenance & Cleanup
# --------------------------------------------------------------------------- #

@router.post("/maintenance/purge-auto-leads")
async def purge_legacy_whatsapp_leads(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    One-time cleanup endpoint to purge old bogus WhatsApp contacts that were
    auto-created before this update.
    """
    deleted_count = await repository.purge_legacy_auto_leads(db, current_user.organization_id)
    return {
        "status": "success",
        "deleted_count": deleted_count,
        "message": f"Successfully removed {deleted_count} unlinked auto-created WhatsApp contacts.",
    }
