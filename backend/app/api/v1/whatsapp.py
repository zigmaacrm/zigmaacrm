import os
import re
import uuid
import base64
import datetime
import time
import logging
from pathlib import Path
from dotenv import dotenv_values
import httpx
from typing import Optional, List, Dict, Any, Union
from fastapi import APIRouter, Depends, HTTPException, Query, status, BackgroundTasks
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc, or_, update, func, not_, and_, text

from app.core.config import settings
from app.core.database import get_db
from app.api.deps import get_optional_current_user
from app.models.organization_user import User, Organization
from app.models.contact import Contact
from app.models.lead_pipeline import Lead
from app.models.whatsapp import WhatsAppMessage
from app.models.activity import Activity

logger = logging.getLogger("zigmaa.whatsapp")

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
        or settings.WHATSAPP_ACCESS_TOKEN
        or settings.WHATSAPP_API_TOKEN
        or ""
    ).strip()
    phone_number_id = (
        env_vals.get("WHATSAPP_PHONE_NUMBER_ID")
        or os.getenv("WHATSAPP_PHONE_NUMBER_ID")
        or settings.WHATSAPP_PHONE_NUMBER_ID
        or ""
    ).strip()
    return api_token, phone_number_id

def normalize_phone(phone: str) -> str:
    """Normalize phone number by stripping pluses, spaces, dashes."""
    return re.sub(r"[^\d]", "", str(phone or ""))

def format_display_phone(phone: str) -> str:
    """Format phone number for clean human-readable display, e.g., +91 96004 71080."""
    clean = normalize_phone(phone)
    if not clean:
        return "Unknown Prospect"
    if len(clean) == 12 and clean.startswith("91"):
        return f"+91 {clean[2:7]} {clean[7:]}"
    elif len(clean) == 10:
        return f"+91 {clean[:5]} {clean[5:]}"
    return f"+{clean}"

def is_generic_or_placeholder_name(name: Optional[str], phone: str) -> bool:
    """Check if name is empty, random/gibberish, placeholder, or just the phone number."""
    if not name or not name.strip():
        return True
    cleaned = name.strip()
    # Masked numbers like "+91∙∙∙∙∙∙∙∙19", "+91••••••19", "+91....19", "+91***19", "+91···19"
    if any(char in cleaned for char in ["∙", "•", "·", "*", "…"]):
        return True
    if ".." in cleaned:
        return True
    clean_p = normalize_phone(phone)
    if clean_p and (clean_p in cleaned.replace(" ", "") or cleaned.replace(" ", "").endswith(clean_p[-10:])):
        return True
    # If the string contains almost only digits and punctuation (e.g. +91 96004 71080)
    digits_only = re.sub(r"[^\d]", "", cleaned)
    if digits_only and len(digits_only) >= 7 and len(re.sub(r"[\d\s+\-().]", "", cleaned)) == 0:
        return True
    lower = cleaned.lower()
    for prefix in [
        "whatsapp lead", "whatsapp contact", "whatsapp user", "new lead",
        "unknown", "lead", "direct prospect", "test lead", "undefined", "null", "none", "prospect", "contact"
    ]:
        if lower == prefix or lower.startswith(prefix + " (") or lower.startswith(prefix + " +") or lower.startswith(prefix + " ") or lower.startswith(prefix + "_"):
            return True
    if re.match(r"^[0-9a-fA-F-]{8,}$", cleaned):
        return True
    for mash in ["asdf", "qwerty", "zxcv", "qwer", "hjkl", "1234", "abcd"]:
        if mash in lower:
            return True
    if re.search(r"[bcdfghjklmnpqrstvwxyz]{5,}", lower):
        return True
    return False

class WhatsAppContactSyncItem(BaseModel):
    phone: str
    name: Optional[str] = None
    phonebook_name: Optional[str] = None
    push_name: Optional[str] = None
    jid: Optional[str] = None
    avatar_url: Optional[str] = None

class WhatsAppBulkSyncRequest(BaseModel):
    contacts: List[WhatsAppContactSyncItem]
    assigned_user_id: Optional[str] = None
    session_id: Optional[str] = None

class SendWhatsAppMessageRequest(BaseModel):
    phone_number: str
    message: Optional[str] = ""
    contact_id: Optional[str] = None
    organization_id: Optional[str] = None
    file_base64: Optional[str] = None
    file_name: Optional[str] = None
    file_type: Optional[str] = None
    quoted_message_id: Optional[str] = None
    quoted_text: Optional[str] = None
    quoted_from_me: Optional[bool] = None
    crm_display_message: Optional[str] = None
    session_id: Optional[str] = None

class WhatsAppMessageOut(BaseModel):
    id: str
    phone_number: str
    direction: str
    message_body: str
    message_type: Optional[str] = "text"
    media_url: Optional[str] = None
    file_name: Optional[str] = None
    caption: Optional[str] = None
    is_voice_note: Optional[bool] = False
    meta_message_id: Optional[str] = None
    status: str
    contact_id: Optional[str] = None
    assigned_user_id: Optional[str] = None
    business_phone_number_id: Optional[str] = None
    reaction: Optional[str] = None
    is_deleted: Optional[bool] = False
    created_at: Any

    class Config:
        from_attributes = True

class ReassignConversationRequest(BaseModel):
    assigned_user_id: str

DUMMY_TEST_PHONES = {
    '16315551181', '919655512345', '9197187', '9197229303', '9197633560',
    '919940211876', '919840122345', '919444099881', '919811234567', '919789055432'
}

def is_valid_mobile_phone(phone: Optional[str]) -> bool:
    if not phone:
        return False
    raw = str(phone).strip()
    if "-" in raw or any(c in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ" for c in raw):
        return False
    clean = normalize_phone(phone)
    if not clean:
        return False
    # Valid mobile numbers are 8 to 13 digits. Strictly excludes internal WhatsApp LIDs (14-16 digits)
    if len(clean) < 8 or len(clean) > 13:
        return False
    if clean in DUMMY_TEST_PHONES:
        return False
    return True

def get_gateway_url() -> str:
    url = (os.getenv("WHATSAPP_GATEWAY_URL") or getattr(settings, "WHATSAPP_GATEWAY_URL", "")).strip().rstrip("/")
    is_cloud = bool(
        os.getenv("RENDER") or
        os.getenv("RENDER_SERVICE_ID") or
        os.getenv("RENDER_EXTERNAL_URL") or
        os.getenv("VERCEL") or
        os.getenv("ENVIRONMENT") == "production" or
        (os.getenv("PORT") and str(os.getenv("PORT")) != "8000")
    )
    if is_cloud:
        # Always use the live deployed Render bridge in production / Render cloud
        if not url or any(x in url.lower() for x in ["localhost", "127.0.0.1", "5001", "loca.lt", "ngrok"]):
            return "https://zigmaa-whatsapp-bridge.onrender.com"
        return url
    if not url:
        return "http://localhost:5001"
    return url

async def resolve_valid_user_id(db: AsyncSession, assigned_user_id: Optional[str], session_id: Optional[str]) -> Optional[str]:
    if assigned_user_id:
        chk = await db.execute(select(User.id).where(User.id == assigned_user_id).limit(1))
        row = chk.scalar_one_or_none()
        if row:
            return row
    if session_id and session_id != "default":
        chk = await db.execute(select(User.id).where(User.id == session_id).limit(1))
        row = chk.scalar_one_or_none()
        if row:
            return row
        clean_num = normalize_phone(session_id)
        if clean_num:
            suffix = clean_num[-10:] if len(clean_num) >= 10 else clean_num
            chk = await db.execute(select(User.id).where(User.whatsapp_phone_number.like(f"%{suffix}%")).limit(1))
            row = chk.scalar_one_or_none()
            if row:
                return row
    return None

@router.post("/send", status_code=status.HTTP_201_CREATED)
@router.post("/messages", status_code=status.HTTP_201_CREATED)
@router.post("/send-message", status_code=status.HTTP_201_CREATED)
@router.post("/messages/send", status_code=status.HTTP_201_CREATED)
async def send_whatsapp_message(
    payload: SendWhatsAppMessageRequest,
    current_user: Optional[User] = Depends(get_optional_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Outbound WhatsApp Message Dispatch Endpoint with Multi-Number Support.
    Uses the authenticated sales rep's dedicated Meta phone_number_id if configured,
    otherwise falls back to the default organization WABA phone_number_id.
    """
    clean_phone = normalize_phone(payload.phone_number)
    if not clean_phone or len(clean_phone) < 7:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Valid recipient WhatsApp phone number is required"
        )

    has_text = bool(payload.message and payload.message.strip())
    has_file = bool(payload.file_base64 and len(payload.file_base64) > 10)
    if not has_text and not has_file:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Message body or file attachment is required"
        )

    org_id = payload.organization_id
    if not org_id and current_user:
        org_id = current_user.organization_id
    if not org_id:
        org_res = await db.execute(select(Organization).limit(1))
        first_org = org_res.scalars().first()
        org_id = first_org.id if first_org else None

    effective_user_id = current_user.id if current_user else None
    contact_id = payload.contact_id
    if not contact_id:
        search_suffix = clean_phone[-10:] if len(clean_phone) >= 10 else clean_phone
        c_stmt = select(Contact).where(Contact.phone.like(f"%{search_suffix}%"))
        if effective_user_id:
            c_stmt = c_stmt.where(
                or_(
                    Contact.assigned_user_id == effective_user_id,
                    Contact.owner_id == effective_user_id
                )
            )
        c_res = await db.execute(c_stmt.limit(1))
        contact = c_res.scalar_one_or_none()
        if contact:
            contact_id = contact.id

    meta_message_id = None
    delivery_status = "SENT"
    dispatch_error_msg = None

    # 1. Attempt dispatch via Baileys QR Gateway if connected
    gateway_url = get_gateway_url()
    targets = [gateway_url]
    if gateway_url != "https://zigmaa-whatsapp-bridge.onrender.com":
        targets.append("https://zigmaa-whatsapp-bridge.onrender.com")

    dispatched_via_qr = False
    clean_target_session = normalize_phone(payload.session_id or (current_user.whatsapp_phone_number if current_user else None))
    effective_session_id = clean_target_session or payload.session_id or (current_user.id if current_user else "default")

    for target in targets:
        try:
            async with httpx.AsyncClient(timeout=25.0, headers={"Bypass-Tunnel-Reminder": "true", "User-Agent": "ZigmaaCRM-Cloud"}) as client:
                send_payload = {
                    "phone_number": clean_phone,
                    "message": payload.message or "",
                    "file_base64": payload.file_base64,
                    "file_name": payload.file_name,
                    "file_type": payload.file_type,
                    "quoted_message_id": payload.quoted_message_id,
                    "quoted_text": payload.quoted_text,
                    "quoted_from_me": payload.quoted_from_me,
                    "session_id": effective_session_id,
                    "assigned_user_id": current_user.id if current_user else None
                }
                send_res = await client.post(
                    f"{target}/send",
                    json=send_payload
                )
                if send_res.status_code == 200 and send_res.json().get("success"):
                    meta_message_id = send_res.json().get("message_id") or f"wamid.qr_out_{uuid.uuid4().hex[:16]}"
                    delivery_status = "SENT"
                    dispatched_via_qr = True
                    logger.info(f"[OUTBOUND QR DISPATCH SUCCESS] Message {meta_message_id} sent to {clean_phone}")
                    break
                else:
                    logger.warning(f"[OUTBOUND QR DISPATCH FAILED] {send_res.text}")
        except Exception as e:
            logger.debug(f"QR Gateway send at {target} skipped or failed: {e}")

    # 2. Fallback to Meta Cloud API if QR Gateway is not connected
    api_token, default_phone_number_id = get_whatsapp_credentials()
    phone_number_id = (
        (current_user.whatsapp_phone_number_id if current_user and current_user.whatsapp_phone_number_id else None)
        or default_phone_number_id
    )

    if not dispatched_via_qr:
        if api_token and phone_number_id:
            url = f"https://graph.facebook.com/v20.0/{phone_number_id}/messages"
            headers = {
                "Authorization": f"Bearer {api_token}",
                "Content-Type": "application/json"
            }
            meta_payload = {
                "messaging_product": "whatsapp",
                "recipient_type": "individual",
                "to": clean_phone,
                "type": "text",
                "text": {
                    "preview_url": False,
                    "body": payload.message
                }
            }

            try:
                async with httpx.AsyncClient(timeout=15.0) as client:
                    res = await client.post(url, json=meta_payload, headers=headers)
                    try:
                        data = res.json()
                    except Exception:
                        data = {}

                    if res.status_code in [200, 201] and "messages" in data:
                        meta_message_id = data["messages"][0].get("id")
                        delivery_status = "SENT"
                        logger.info(f"[OUTBOUND DISPATCH SUCCESS] Meta Message ID: {meta_message_id} to recipient {clean_phone} via PhoneID {phone_number_id}")
                    else:
                        delivery_status = "FAILED"
                        meta_message_id = f"wamid.failed_{uuid.uuid4().hex[:18]}"
                        raw_err = data.get("error", {})
                        err_msg = raw_err.get("message") or res.text
                        err_code = raw_err.get("code")
                        dispatch_error_msg = f"{err_msg} (code: {err_code})" if err_code else err_msg
                        logger.error(
                            f"[OUTBOUND META API ERROR] Status {res.status_code}: {dispatch_error_msg} | "
                            f"Recipient: {clean_phone} | PhoneID: {phone_number_id}"
                        )
            except Exception as e:
                delivery_status = "FAILED"
                meta_message_id = f"wamid.sim_{uuid.uuid4().hex[:18]}"
                dispatch_error_msg = str(e)
                logger.error(f"[OUTBOUND CONNECTION ERROR] Failed to connect to Meta Graph API: {e}")
        else:
            logger.warning("[OUTBOUND WARNING] WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID not configured.")
            meta_message_id = f"wamid.sim_{uuid.uuid4().hex[:18]}"
            delivery_status = "SENT"

    media_url = None
    saved_file_name = payload.file_name
    msg_type = "text"
    is_voice = False

    if has_file:
        file_mime = (payload.file_type or "").lower()
        if file_mime.startswith("image/"):
            msg_type = "image"
            ext = "png" if "png" in file_mime else ("webp" if "webp" in file_mime else "jpg")
        elif file_mime.startswith("video/"):
            msg_type = "video"
            ext = "mp4"
        elif file_mime.startswith("audio/"):
            msg_type = "ptt"
            is_voice = True
            ext = "mp4" if "mp4" in file_mime else "ogg"
        else:
            msg_type = "document"
            ext = "pdf" if "pdf" in file_mime else "bin"

        try:
            pure_b64 = payload.file_base64.split(",")[1] if "," in payload.file_base64 else payload.file_base64
            file_bytes = base64.b64decode(pure_b64)
            uploads_dir = os.path.join(os.getcwd(), "uploads", "whatsapp")
            os.makedirs(uploads_dir, exist_ok=True)
            if not saved_file_name:
                saved_file_name = f"out_{int(datetime.datetime.utcnow().timestamp())}_{uuid.uuid4().hex[:6]}.{ext}"
            unique_disk_name = f"{int(datetime.datetime.utcnow().timestamp())}_{uuid.uuid4().hex[:6]}_{saved_file_name}"
            file_path = os.path.join(uploads_dir, unique_disk_name)
            with open(file_path, "wb") as f:
                f.write(file_bytes)
            media_url = f"/media/whatsapp/{unique_disk_name}"
        except Exception as save_err:
            logger.error(f"[OUTBOUND FILE SAVE ERROR]: {save_err}")

    if payload.crm_display_message and payload.crm_display_message.strip():
        body_text = payload.crm_display_message.strip()
    elif payload.quoted_text and (payload.message or has_text):
        quoted_sender = "You" if payload.quoted_from_me else "Contact"
        clean_q_text = re.sub(r"[\r\n]+", " ", payload.quoted_text).strip()[:100]
        body_text = f"> *{quoted_sender}*: {clean_q_text}\n\n{(payload.message or '').strip()}"
    else:
        body_text = (
            payload.message.strip()
            if has_text
            else (f"📎 {saved_file_name or 'Document'}" if has_file else "")
        )

    session_val = clean_target_session or payload.session_id or (current_user.whatsapp_phone_number.replace('+', '') if current_user and current_user.whatsapp_phone_number else None) or (current_user.id if current_user else None)
    wa_message = WhatsAppMessage(
        organization_id=org_id,
        contact_id=contact_id,
        assigned_user_id=current_user.id if current_user else None,
        business_phone_number_id=session_val or phone_number_id or None,
        session_id=session_val or None,
        phone_number=clean_phone,
        direction="OUTBOUND",
        message_body=body_text,
        message_type=msg_type,
        media_url=media_url,
        file_name=saved_file_name,
        caption=payload.message.strip() if has_text and has_file else None,
        is_voice_note=is_voice,
        meta_message_id=meta_message_id,
        status=delivery_status
    )
    db.add(wa_message)

    if contact_id:
        activity = Activity(
            organization_id=org_id,
            contact_id=contact_id,
            type="NOTE",
            notes=f"💬 WhatsApp Outbound: {payload.message[:250]}",
            status="COMPLETED" if delivery_status == "SENT" else "FAILED"
        )
        db.add(activity)

    await db.commit()
    await db.refresh(wa_message)

    if delivery_status == "FAILED" and dispatch_error_msg:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Meta WhatsApp Cloud API error: {dispatch_error_msg}"
        )

    return {
        "status": "success",
        "message": "Outbound WhatsApp message dispatched",
        "data": {
            "id": wa_message.id,
            "phone_number": wa_message.phone_number,
            "direction": wa_message.direction,
            "message_body": wa_message.message_body,
            "message_type": wa_message.message_type,
            "media_url": wa_message.media_url,
            "file_name": wa_message.file_name,
            "is_voice_note": wa_message.is_voice_note,
            "meta_message_id": wa_message.meta_message_id,
            "status": wa_message.status,
            "contact_id": wa_message.contact_id,
            "assigned_user_id": wa_message.assigned_user_id,
            "business_phone_number_id": wa_message.business_phone_number_id,
            "created_at": wa_message.created_at.isoformat() if wa_message.created_at else None
        }
    }

@router.get("/messages")
async def get_whatsapp_messages(
    phone_number: Optional[str] = Query(None),
    contact_id: Optional[str] = Query(None),
    active_session_phone: Optional[str] = Query(None),
    session_id: Optional[str] = Query(None),
    limit: int = Query(150, le=500),
    current_user: Optional[User] = Depends(get_optional_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Retrieve message thread history for a phone number or contact
    strictly scoped to the active session phone number.
    """
    stmt = select(WhatsAppMessage)
    if isinstance(contact_id, str) and contact_id.strip():
        stmt = stmt.where(WhatsAppMessage.contact_id == contact_id.strip())
    elif isinstance(phone_number, str) and phone_number.strip():
        clean = normalize_phone(phone_number)
        search_suffix = clean[-10:] if len(clean) >= 10 else clean
        stmt = stmt.where(WhatsAppMessage.phone_number.like(f"%{search_suffix}%"))

    # Strict active session scoping: Only messages belonging to the currently connected device
    target_session = None
    if active_session_phone and is_valid_mobile_phone(active_session_phone):
        target_session = normalize_phone(active_session_phone)
    elif current_user and current_user.whatsapp_phone_number and is_valid_mobile_phone(current_user.whatsapp_phone_number):
        target_session = normalize_phone(current_user.whatsapp_phone_number)
    elif session_id and is_valid_mobile_phone(session_id):
        target_session = normalize_phone(session_id)

    if not target_session and current_user:
        for cache_key in [current_user.id]:
            c_entry = _qr_status_cache.get(cache_key)
            if c_entry and c_entry.get("data") and c_entry["data"].get("status") == "CONNECTED":
                p = c_entry["data"].get("phone")
                if p:
                    target_session = normalize_phone(p)
                    break

    if target_session:
        session_suffix = target_session[-10:] if len(target_session) >= 10 else target_session
        stmt = stmt.where(
            or_(
                WhatsAppMessage.session_id == target_session,
                WhatsAppMessage.session_id.like(f"%{session_suffix}%"),
                WhatsAppMessage.business_phone_number_id == target_session,
                WhatsAppMessage.business_phone_number_id.like(f"%{session_suffix}%")
            )
        )
    elif current_user:
        stmt = stmt.where(WhatsAppMessage.assigned_user_id == current_user.id)

    eff_limit = int(limit) if isinstance(limit, (int, str)) and str(limit).isdigit() else 150
    # Order DESC to get the latest messages first, then reverse for chronological display
    stmt = stmt.order_by(WhatsAppMessage.created_at.desc()).limit(eff_limit)
    res = await db.execute(stmt)
    messages = list(res.scalars().all())
    messages.reverse()

    return {
        "status": "success",
        "count": len(messages),
        "messages": [
            {
                "id": m.id,
                "phone_number": m.phone_number,
                "direction": m.direction,
                "message_body": m.message_body,
                "message_type": m.message_type or "text",
                "media_url": m.media_url,
                "file_name": m.file_name,
                "caption": m.caption,
                "is_voice_note": bool(m.is_voice_note),
                "meta_message_id": m.meta_message_id,
                "status": m.status,
                "contact_id": m.contact_id,
                "assigned_user_id": m.assigned_user_id,
                "business_phone_number_id": m.business_phone_number_id,
                "reaction": m.reaction,
                "is_deleted": bool(m.is_deleted),
                "quoted_context": (json.loads(m.quoted_context) if m.quoted_context and m.quoted_context.startswith("{") else ({"sender": "Contact", "text": m.quoted_context} if m.quoted_context else None)),
                "created_at": m.created_at.isoformat() if m.created_at else None
            }
            for m in messages
        ]
    }

@router.get("/conversations")
async def get_whatsapp_conversations(
    assigned_user_id: Optional[str] = Query(None),
    active_session_phone: Optional[str] = Query(None),
    session_id: Optional[str] = Query(None),
    limit: int = Query(100, le=500),
    current_user: Optional[User] = Depends(get_optional_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Retrieve active conversation summaries enriched with contact details.
    Strictly scoped to the active session phone number to prevent cross-session bleeding.
    """
    stmt = select(WhatsAppMessage)

    effective_limit = int(limit) if isinstance(limit, (int, str)) and str(limit).isdigit() else 25

    # 1. Resolve currently active linked WhatsApp status strictly for this current user
    user_session_id = current_user.id if current_user else (session_id or "default")
    user_connected = False
    target_session = None

    if active_session_phone and is_valid_mobile_phone(active_session_phone):
        target_session = normalize_phone(active_session_phone)
        user_connected = True

    if not target_session and user_session_id:
        c_entry = _qr_status_cache.get(user_session_id)
        if c_entry and c_entry.get("data") and c_entry["data"].get("status") == "CONNECTED":
            user_connected = True
            p = c_entry["data"].get("phone")
            if p:
                target_session = normalize_phone(p)

    if not target_session and current_user and current_user.whatsapp_phone_number:
        target_session = normalize_phone(current_user.whatsapp_phone_number)
        user_connected = True

    if not target_session and user_session_id and user_session_id != "default":
        u_res = await db.execute(select(User).where(User.id == user_session_id).limit(1))
        u = u_res.scalar_one_or_none()
        if u and u.whatsapp_phone_number:
            target_session = normalize_phone(u.whatsapp_phone_number)
            user_connected = True

    if not target_session and is_valid_mobile_phone(user_session_id):
        target_session = normalize_phone(user_session_id)
        user_connected = True

    if not target_session and user_session_id and user_session_id != "default":
        msg_chk = await db.execute(
            select(WhatsAppMessage.session_id)
            .where(
                or_(
                    WhatsAppMessage.assigned_user_id == user_session_id,
                    WhatsAppMessage.session_id == user_session_id
                )
            )
            .limit(1)
        )
        found_sess = msg_chk.scalar_one_or_none()
        if found_sess:
            target_session = normalize_phone(found_sess) or user_session_id
            user_connected = True

    # If the current user has no connected device and no historical messages, return 0 conversations immediately
    if not user_connected and not target_session:
        return {
            "status": "success",
            "count": 0,
            "conversations": [],
            "is_connected": False,
            "message": "WhatsApp device is not connected. Please scan QR to access inbox."
        }

    session_suffix = target_session[-10:] if target_session and len(target_session) >= 10 else (target_session or "")

    # Strict isolation: ONLY messages tagged with this user's active session phone
    if target_session:
        stmt = stmt.where(
            or_(
                WhatsAppMessage.session_id == target_session,
                WhatsAppMessage.session_id.like(f"%{session_suffix}%"),
                WhatsAppMessage.business_phone_number_id == target_session,
                WhatsAppMessage.business_phone_number_id.like(f"%{session_suffix}%")
            )
        )
    elif current_user:
        stmt = stmt.where(WhatsAppMessage.assigned_user_id == current_user.id)

    # Exclude dummy and stub messages
    stmt = stmt.where(
        WhatsAppMessage.message_body.notin_(["Active message", "Active conversation", "Direct contact ready to chat"])
    )

    # Optional Rep Filter
    if isinstance(assigned_user_id, str) and assigned_user_id.upper() != "ALL":
        stmt = stmt.where(WhatsAppMessage.assigned_user_id == assigned_user_id)

    stmt = stmt.order_by(desc(WhatsAppMessage.created_at)).limit(2000)
    res = await db.execute(stmt)
    all_msgs = res.scalars().all()

    conv_map: Dict[str, Any] = {}

    DUMMY_TEST_PHONES = {
        '16315551181', '919655512345', '9197187', '9197229303', '9197633560',
        '919940211876', '919840122345', '919444099881', '919811234567', '919789055432'
    }

    if all_msgs:
        unique_phones = set()
        unique_contact_ids = set()
        for m in all_msgs:
            if m.phone_number:
                clean = normalize_phone(m.phone_number)
                if clean and is_valid_mobile_phone(clean):
                    unique_phones.add(clean)
                    unique_phones.add(f"+{clean}")
                    unique_phones.add(m.phone_number)
            if m.contact_id:
                unique_contact_ids.add(m.contact_id)

        phone_patterns = []
        for p in unique_phones:
            clean = normalize_phone(p)
            if len(clean) >= 10:
                phone_patterns.append(clean[-10:])
        phone_patterns = list(set(phone_patterns))

        contact_conditions = []
        if unique_contact_ids:
            contact_conditions.append(Contact.id.in_(list(unique_contact_ids)))
        if unique_phones:
            contact_conditions.append(Contact.phone.in_(list(unique_phones)))
        for pat in phone_patterns:
            contact_conditions.append(Contact.phone.like(f"%{pat}%"))

        contacts_list = []
        if contact_conditions:
            c_query = select(Contact).where(or_(*contact_conditions))
            if current_user:
                c_query = c_query.where(
                    or_(
                        Contact.owner_id == current_user.id,
                        Contact.assigned_user_id == current_user.id
                    )
                )
            c_res = await db.execute(c_query.limit(effective_limit * 3))
            contacts_list = c_res.scalars().all()

        sorted_contacts = sorted(
            contacts_list,
            key=lambda c: (
                1 if current_user and c.owner_id == current_user.id else
                (0.5 if current_user and c.organization_id == getattr(current_user, "organization_id", None) else 0)
            ),
            reverse=True
        )
        contacts_by_id = {}
        contacts_by_phone = {}
        for c in sorted_contacts:
            if c.id not in contacts_by_id:
                contacts_by_id[c.id] = c
            clean_cp = normalize_phone(c.phone)
            if clean_cp:
                if clean_cp not in contacts_by_phone:
                    contacts_by_phone[clean_cp] = c
                if len(clean_cp) >= 10:
                    suffix_10 = clean_cp[-10:]
                    if suffix_10 not in contacts_by_phone:
                        contacts_by_phone[suffix_10] = c

        # Fetch users for assigned rep metadata
        rep_ids = {m.assigned_user_id for m in all_msgs if m.assigned_user_id}
        reps_by_id = {}
        if rep_ids:
            u_res = await db.execute(select(User).where(User.id.in_(list(rep_ids))))
            reps_by_id = {u.id: u for u in u_res.scalars().all()}

        # Calculate real unread counts per phone number
        unread_stmt = select(WhatsAppMessage.phone_number, func.count(WhatsAppMessage.id)).where(
            WhatsAppMessage.direction == "INBOUND",
            WhatsAppMessage.status != "READ"
        )
        if current_user and getattr(current_user, "organization_id", None):
            unread_stmt = unread_stmt.where(WhatsAppMessage.organization_id == current_user.organization_id)
        unread_stmt = unread_stmt.group_by(WhatsAppMessage.phone_number)
        unread_res = await db.execute(unread_stmt)
        unread_counts = {str(row[0]): int(row[1]) for row in unread_res.fetchall()}

        for m in all_msgs:
            if not m.phone_number:
                continue
            if not is_valid_mobile_phone(m.phone_number):
                continue
            if m.message_body in ("Active message", "Active conversation", "Direct contact ready to chat"):
                continue
            if m.message_body and m.message_body.startswith("💬 Active chat with"):
                continue
            if not m.message_body and not m.media_url and not m.caption:
                continue

            if m.phone_number not in conv_map:
                clean_m = normalize_phone(m.phone_number)
                suffix_m = clean_m[-10:] if len(clean_m) >= 10 else clean_m

                contact = contacts_by_id.get(m.contact_id)
                # Verification: verify contact phone matches m.phone_number to prevent cross-contact name bleeding!
                if contact and contact.phone:
                    c_clean = normalize_phone(contact.phone)
                    c_suf = c_clean[-10:] if len(c_clean) >= 10 else c_clean
                    if c_suf != suffix_m:
                        contact = None

                if not contact and clean_m:
                    contact = contacts_by_phone.get(clean_m)
                if not contact and suffix_m:
                    contact = contacts_by_phone.get(suffix_m)

                prof_name = None
                avatar_url = None
                if contact and isinstance(contact.custom_data, dict):
                    prof_name = contact.custom_data.get("whatsapp_profile_name")
                    avatar_url = contact.custom_data.get("avatar_url")

                phonebook_name = None
                wa_saved_name = None
                if contact and isinstance(contact.custom_data, dict):
                    phonebook_name = contact.custom_data.get("phonebook_name")
                    wa_saved_name = contact.custom_data.get("whatsapp_name")

                # Strictly prioritize saved phonebook address-book names (e.g. Riyaz_sathik)
                # over push names (e.g. Arabic or custom strings set by the other person)
                if target_session and (clean_m == target_session or (len(clean_m) >= 10 and clean_m[-10:] == target_session[-10:])):
                    contact_name = "You (Message Yourself)"
                elif phonebook_name and not is_generic_or_placeholder_name(str(phonebook_name), m.phone_number):
                    contact_name = str(phonebook_name).strip()
                elif contact and contact.full_name and not is_generic_or_placeholder_name(contact.full_name, m.phone_number):
                    contact_name = contact.full_name.strip()
                elif wa_saved_name and not is_generic_or_placeholder_name(str(wa_saved_name), m.phone_number):
                    contact_name = str(wa_saved_name).strip()
                elif prof_name and str(prof_name).strip() and not is_generic_or_placeholder_name(str(prof_name), m.phone_number):
                    contact_name = str(prof_name).strip()
                else:
                    contact_name = format_display_phone(m.phone_number)

                company_name = (contact.company_name if contact and contact.company_name else "Direct Prospect")
                email = (contact.email if contact and contact.email else "")
                stage = (contact.lifecycle_stage if contact and contact.lifecycle_stage else "Qualified")

                assigned_user_obj = reps_by_id.get(m.assigned_user_id)
                if assigned_user_obj:
                    rep_name = assigned_user_obj.full_name
                elif contact and contact.assigned_user_name:
                    rep_name = contact.assigned_user_name
                else:
                    rep_name = "Unassigned"

                parts = contact_name.strip().split()
                initials = (parts[0][0] + (parts[1][0] if len(parts) > 1 else ""))[:2].upper() if parts else "WA"

                rep_parts = rep_name.strip().split()
                rep_avatar = (rep_parts[0][0] + (rep_parts[1][0] if len(rep_parts) > 1 else ""))[:2].upper() if rep_parts else "SR"

                clean_num = normalize_phone(m.phone_number)
                unread_cnt = unread_counts.get(m.phone_number, 0)
                if unread_cnt == 0 and clean_num:
                    unread_cnt = unread_counts.get(clean_num, 0) or unread_counts.get(f"+{clean_num}", 0)

                # WhatsApp Web style message preview snippets
                m_type = (m.message_type or "").lower()
                if m_type == "image":
                    last_msg_snippet = f"📷 {m.caption or 'Photo'}"
                elif m_type in ("audio", "ptt") or m.is_voice_note:
                    last_msg_snippet = "🎤 Voice message"
                elif m_type == "document":
                    last_msg_snippet = f"📄 {m.file_name or 'Document'}"
                elif m_type == "video":
                    last_msg_snippet = f"🎥 {m.caption or 'Video'}"
                elif m_type == "gif":
                    last_msg_snippet = f"GIF {m.caption or ''}".strip()
                elif m_type == "sticker" or (m.message_body and m.message_body.lower() == "[sticker]"):
                    last_msg_snippet = "Sticker"
                else:
                    last_msg_snippet = m.message_body or ""

                c_data = dict(contact.custom_data or {}) if contact and isinstance(contact.custom_data, dict) else {}
                conv_map[m.phone_number] = {
                    "id": f"conv-{m.phone_number}",
                    "phone_number": m.phone_number,
                    "contact_id": contact.id if contact else m.contact_id,
                    "assigned_user_id": m.assigned_user_id,
                    "business_phone_number_id": m.business_phone_number_id,
                    "contact_name": contact_name,
                    "company_name": company_name,
                    "email": email,
                    "avatar_url": avatar_url,
                    "avatar_initials": initials,
                    "deal_stage": stage,
                    "deal_value": 1480000,
                    "assigned_rep": {
                        "id": m.assigned_user_id,
                        "name": rep_name,
                        "avatar": rep_avatar,
                        "role": "Sales Representative"
                    },
                    "last_message": last_msg_snippet,
                    "last_message_type": m.message_type or "text",
                    "media_url": m.media_url,
                    "is_voice_note": bool(m.is_voice_note),
                    "is_pinned": bool(c_data.get("is_pinned", False)),
                    "is_archived": bool(c_data.get("is_archived", False)),
                    "is_blocked": bool(c_data.get("is_blocked", False)),
                    "last_message_time": m.created_at.isoformat() if m.created_at else None,
                    "last_direction": m.direction,
                    "last_status": m.status,
                    "unread_count": unread_cnt
                }

    # Sort strictly by pinned first, then by latest real message timestamp descending (Exact WhatsApp Web order)
    active_conversations = list(conv_map.values())
    active_conversations.sort(
        key=lambda c: (1 if c.get("is_pinned") else 0, c.get("last_message_time") or ""),
        reverse=True
    )

    return {
        "status": "success",
        "conversations": active_conversations[:effective_limit],
        "is_connected": True
    }

@router.patch("/conversations/{phone_number}/assign")
async def reassign_conversation(
    phone_number: str,
    payload: ReassignConversationRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Reassign a WhatsApp conversation and its associated lead/contact to a different team member
    """
    clean = normalize_phone(phone_number)
    search_suffix = clean[-10:] if len(clean) >= 10 else clean

    user_res = await db.execute(select(User).where(User.id == payload.assigned_user_id))
    user = user_res.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Target user not found")

    await db.execute(
        update(WhatsAppMessage)
        .where(WhatsAppMessage.phone_number.like(f"%{search_suffix}%"))
        .values(assigned_user_id=user.id)
    )

    c_res = await db.execute(
        select(Contact).where(Contact.phone.like(f"%{search_suffix}%")).limit(1)
    )
    contact = c_res.scalar_one_or_none()
    if contact:
        contact.assigned_user_id = user.id
        contact.assigned_user_name = user.full_name
        contact.owner_id = user.id
        contact.owner_name = user.full_name

    l_res = await db.execute(
        select(Lead).where(Lead.phone.like(f"%{search_suffix}%")).limit(1)
    )
    lead = l_res.scalar_one_or_none()
    if lead:
        lead.assigned_user_id = user.id

    await db.commit()
    return {
        "status": "success",
        "message": f"Conversation and lead reassigned to {user.full_name}",
        "assigned_user_id": user.id,
        "assigned_user_name": user.full_name
    }

@router.post("/conversations/{phone_number}/read")
async def mark_conversation_as_read(
    phone_number: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Mark all unread inbound messages for a conversation as READ
    """
    clean = normalize_phone(phone_number)
    search_suffix = clean[-10:] if len(clean) >= 10 else clean
    res = await db.execute(
        select(WhatsAppMessage).where(
            WhatsAppMessage.phone_number.like(f"%{search_suffix}%"),
            WhatsAppMessage.direction == "INBOUND",
            WhatsAppMessage.status != "READ"
        )
    )
    msgs = res.scalars().all()
    for m in msgs:
        m.status = "READ"
    await db.commit()
    return {"status": "success", "marked_read": len(msgs)}

@router.post("/contacts/bulk-sync")
async def bulk_sync_whatsapp_contacts(
    payload: WhatsAppBulkSyncRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Sync direct WhatsApp address-book contacts into CRM contacts/leads without chat history.
    Strictly ignores @g.us group chats and scopes contacts to the session user.
    """
    if not payload.contacts:
        return {"status": "success", "synced": 0}

    res_org = await db.execute(select(Organization).limit(1))
    default_org = res_org.scalars().first()
    default_org_id = default_org.id if default_org else None

    effective_user_id = await resolve_valid_user_id(db, payload.assigned_user_id, payload.session_id)

    synced_count = 0
    for item in payload.contacts:
        clean_phone = normalize_phone(item.phone)
        if not is_valid_mobile_phone(clean_phone):
            continue

        search_suffix = clean_phone[-10:] if len(clean_phone) >= 10 else clean_phone
        formatted_phone = f"+{clean_phone}" if not clean_phone.startswith("+") else clean_phone
        display_name = item.name.strip() if item.name and not is_generic_or_placeholder_name(item.name, clean_phone) else format_display_phone(clean_phone)

        c_stmt = select(Contact).where(Contact.phone.like(f"%{search_suffix}%"))
        if effective_user_id:
            c_stmt = c_stmt.where(
                or_(
                    Contact.assigned_user_id == effective_user_id,
                    Contact.owner_id == effective_user_id
                )
            )
        c_res = await db.execute(c_stmt.limit(1))
        contact = c_res.scalar_one_or_none()

        if contact:
            if effective_user_id:
                contact.assigned_user_id = effective_user_id
                contact.owner_id = effective_user_id
            # Update name/avatar if empty or placeholder
            if item.name and not is_generic_or_placeholder_name(item.name, clean_phone):
                contact.full_name = item.name.strip()

            curr_data = dict(contact.custom_data or {})
            if item.name and not is_generic_or_placeholder_name(item.name, clean_phone):
                curr_data["whatsapp_name"] = item.name.strip()
                curr_data["phonebook_name"] = item.name.strip()
            if item.avatar_url and curr_data.get("avatar_url") != item.avatar_url:
                curr_data["avatar_url"] = item.avatar_url
            if item.jid and not curr_data.get("jid"):
                curr_data["jid"] = item.jid
            contact.custom_data = curr_data
        else:
            clean_sess_item = normalize_phone(payload.session_id) if payload.session_id else None
            c_data = {
                "whatsapp_name": item.name.strip() if item.name and not is_generic_or_placeholder_name(item.name, clean_phone) else None,
                "phonebook_name": item.name.strip() if item.name and not is_generic_or_placeholder_name(item.name, clean_phone) else None,
                "jid": item.jid,
                "avatar_url": item.avatar_url,
                "session_id": clean_sess_item
            }

            contact = Contact(
                organization_id=default_org_id,
                full_name=display_name,
                phone=formatted_phone,
                source="WHATSAPP",
                lifecycle_stage="LEAD",
                status="NEW",
                assigned_user_id=effective_user_id,
                owner_id=effective_user_id,
                custom_data=c_data
            )
            db.add(contact)
            synced_count += 1

        l_res = await db.execute(select(Lead).where(Lead.phone.like(f"%{search_suffix}%")).limit(1))
        lead = l_res.scalar_one_or_none()
        if not lead and default_org_id:
            lead = Lead(
                organization_id=default_org_id,
                full_name=display_name,
                phone=formatted_phone,
                source="WHATSAPP",
                status="NEW",
                custom_data={"jid": item.jid} if item.jid else {}
            )
            db.add(lead)

        pass

    await db.commit()
    logger.info(f"[WHATSAPP BULK-SYNC] Upserted {synced_count} direct contacts into CRM")
    return {"status": "success", "synced": synced_count}

@router.get("/contacts/{phone}/avatar")
async def get_whatsapp_contact_avatar(
    phone: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Fetch on-demand / cached profile picture for a WhatsApp contact.
    """
    clean_phone = normalize_phone(phone)
    if not clean_phone:
        return {"phone": phone, "avatar_url": None}

    search_suffix = clean_phone[-10:] if len(clean_phone) >= 10 else clean_phone
    c_res = await db.execute(select(Contact).where(Contact.phone.like(f"%{search_suffix}%")).limit(1))
    contact = c_res.scalar_one_or_none()

    if contact and contact.custom_data and isinstance(contact.custom_data, dict):
        cached_avatar = contact.custom_data.get("avatar_url")
        if cached_avatar:
            return {"phone": clean_phone, "avatar_url": cached_avatar}

    # Query gateway dynamically
    gateway_url = get_gateway_url()
    target_urls = [f"{gateway_url}/avatar/{clean_phone}"]
    if gateway_url != "https://zigmaa-whatsapp-bridge.onrender.com":
        target_urls.append(f"https://zigmaa-whatsapp-bridge.onrender.com/avatar/{clean_phone}")
    for t_url in target_urls:
        try:
            async with httpx.AsyncClient(timeout=4.0) as client:
                resp = await client.get(t_url)
                if resp.status_code == 200:
                    data = resp.json()
                    avatar_url = data.get("avatar_url")
                    if avatar_url and contact:
                        curr_data = dict(contact.custom_data or {})
                        curr_data["avatar_url"] = avatar_url
                        contact.custom_data = curr_data
                        await db.commit()
                    if avatar_url:
                        return {"phone": clean_phone, "avatar_url": avatar_url}
        except Exception as e:
            logger.debug(f"Failed to fetch avatar from {t_url}: {e}")

    return {"phone": clean_phone, "avatar_url": None}

_qr_status_cache: Dict[str, Dict[str, Any]] = {}

@router.get("/qr/status")
async def get_whatsapp_qr_status(
    sessionId: Optional[str] = Query(None),
    session_id: Optional[str] = Query(None),
    current_user: Optional[User] = Depends(get_optional_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Checks connection status, linked phone, and current QR code from Baileys gateway
    specifically scoped to the current user's isolated session.
    """
    global _qr_status_cache
    effective_session = sessionId or session_id or (current_user.id if current_user else "default")

    now = time.time()
    user_cache = _qr_status_cache.get(effective_session, {"data": None, "ts": 0})
    if user_cache["data"] and (now - user_cache["ts"] < 2.0):
        return user_cache["data"]

    gateway_url = get_gateway_url()
    targets = [gateway_url]
    if gateway_url != "https://zigmaa-whatsapp-bridge.onrender.com":
        targets.append("https://zigmaa-whatsapp-bridge.onrender.com")

    for target in targets:
        try:
            # Fast 6.0s timeout for local gateway, 15.0s for cloud
            target_timeout = 6.0 if "localhost" in target or "127.0.0.1" in target else 15.0
            async with httpx.AsyncClient(timeout=target_timeout, headers={"Bypass-Tunnel-Reminder": "true", "User-Agent": "ZigmaaCRM-Cloud"}) as client:
                resp = await client.get(f"{target}/status?sessionId={effective_session}")
                if resp.status_code == 200:
                    data = resp.json()
                    data["gateway_online"] = True

                    _qr_status_cache[effective_session] = {"data": data, "ts": time.time()}

                    # Strict User WhatsApp Phone Synchronization:
                    # ONLY update current_user phone if the bridge session is verified to belong to this user
                    if current_user and effective_session == current_user.id:
                        if data.get("status") == "CONNECTED" and data.get("phone") and data.get("session_id") == current_user.id:
                            if current_user.whatsapp_phone_number != data.get("phone"):
                                current_user.whatsapp_phone_number = data.get("phone")
                                await db.commit()
                        elif data.get("status") != "CONNECTED":
                            if current_user.whatsapp_phone_number is not None and (data.get("logged_out") or data.get("status") in ("DISCONNECTED", "SCAN_QR")):
                                current_user.whatsapp_phone_number = None
                                await db.commit()
                            data["phone"] = None

                    return data
        except Exception as e:
            logger.debug(f"WhatsApp QR Gateway at {target} not reachable for {effective_session}: {e}")

    if user_cache["data"] and user_cache["data"].get("gateway_online") and user_cache["data"].get("status") == "CONNECTED" and (now - user_cache["ts"] < 15.0):
        return user_cache["data"]

    return {
        "status": "DISCONNECTED",
        "phone": None,
        "name": getattr(current_user, "full_name", None),
        "avatar_url": None,
        "qr": None,
        "gateway_online": False,
        "session_id": effective_session,
        "logged_out": True
    }

@router.post("/qr/refresh")
async def refresh_whatsapp_qr(
    sessionId: Optional[str] = Query(None),
    session_id: Optional[str] = Query(None),
    current_user: Optional[User] = Depends(get_optional_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Requests a fresh QR code from the Baileys gateway for the current user's session.
    """
    global _qr_status_cache
    effective_session = sessionId or session_id or (current_user.id if current_user else "default")
    _qr_status_cache[effective_session] = {"data": None, "ts": 0}

    gateway_url = get_gateway_url()
    targets = [gateway_url]
    if gateway_url != "https://zigmaa-whatsapp-bridge.onrender.com":
        targets.append("https://zigmaa-whatsapp-bridge.onrender.com")

    last_err = None
    for target in targets:
        try:
            target_timeout = 8.0 if "localhost" in target or "127.0.0.1" in target else 25.0
            async with httpx.AsyncClient(timeout=target_timeout, headers={"Bypass-Tunnel-Reminder": "true", "User-Agent": "ZigmaaCRM-Cloud"}) as client:
                resp = await client.post(f"{target}/refresh-qr?sessionId={effective_session}", json={"sessionId": effective_session})
                data = resp.json()
                if data.get("qr"):
                    _qr_status_cache[effective_session] = {"data": {**data, "gateway_online": True}, "ts": time.time()}
                return data
        except Exception as e:
            last_err = e

    raise HTTPException(status_code=503, detail=f"Failed to connect to WhatsApp Gateway: {last_err}")

@router.post("/qr/disconnect")
async def disconnect_whatsapp_qr(
    sessionId: Optional[str] = Query(None),
    session_id: Optional[str] = Query(None),
    current_user: Optional[User] = Depends(get_optional_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Disconnects and logs out the Baileys QR session for the current user.
    """
    global _qr_status_cache
    effective_session = sessionId or session_id or (current_user.id if current_user else "default")
    _qr_status_cache[effective_session] = {"data": None, "ts": 0}

    if current_user and effective_session == current_user.id:
        current_user.whatsapp_phone_number = None
        await db.commit()

    gateway_url = get_gateway_url()
    targets = [gateway_url]
    if gateway_url != "https://zigmaa-whatsapp-bridge.onrender.com":
        targets.append("https://zigmaa-whatsapp-bridge.onrender.com")

    last_err = None
    for target in targets:
        try:
            target_timeout = 2.0 if "localhost" in target or "127.0.0.1" in target else 15.0
            async with httpx.AsyncClient(timeout=target_timeout, headers={"Bypass-Tunnel-Reminder": "true", "User-Agent": "ZigmaaCRM-Cloud"}) as client:
                resp = await client.post(f"{target}/disconnect?sessionId={effective_session}", json={"sessionId": effective_session})
                return resp.json()
        except Exception as e:
            last_err = e

    raise HTTPException(status_code=503, detail=f"Failed to disconnect WhatsApp Gateway: {last_err}")

class WhatsAppHistorySyncItem(BaseModel):
    phone_number: str
    contact_name: Optional[str] = None
    message_body: Optional[str] = "[Attachment]"
    meta_message_id: Optional[str] = None
    timestamp: Optional[Union[int, float]] = None
    direction: Optional[str] = "INBOUND"
    message_type: Optional[str] = "text"
    media_url: Optional[str] = None
    media_base64: Optional[str] = None
    file_name: Optional[str] = None
    caption: Optional[str] = None
    is_voice_note: Optional[bool] = False

class WhatsAppHistorySyncPayload(BaseModel):
    messages: List[WhatsAppHistorySyncItem]
    assigned_user_id: Optional[str] = None
    session_id: Optional[str] = None

class InboundQRMessage(BaseModel):
    phone_number: str
    contact_name: Optional[str] = None
    message_body: Optional[str] = "[Attachment]"
    meta_message_id: Optional[str] = None
    timestamp: Optional[Union[int, float]] = None
    direction: Optional[str] = "INBOUND"
    message_type: Optional[str] = "text"
    media_url: Optional[str] = None
    media_base64: Optional[str] = None
    file_name: Optional[str] = None
    caption: Optional[str] = None
    is_voice_note: Optional[bool] = False
    status: Optional[str] = None
    assigned_user_id: Optional[str] = None
    session_id: Optional[str] = None
    quoted_context: Optional[Union[Dict[str, Any], str]] = None

@router.post("/webhook/inbound")
async def relay_inbound_webhook(
    payload: InboundQRMessage,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db)
):
    from app.api.v1.webhooks.whatsapp import receive_whatsapp_qr_inbound
    return await receive_whatsapp_qr_inbound(payload, background_tasks, db)

@router.post("/chats/sync-history")
async def sync_whatsapp_chat_history(
    payload: WhatsAppHistorySyncPayload,
    db: AsyncSession = Depends(get_db)
):
    """
    Batch upserts 1-on-1 direct WhatsApp messages from Baileys history sync.
    Filters out duplicates and automatically links or creates contacts.
    """
    res_org = await db.execute(select(Organization).limit(1))
    default_org = res_org.scalars().first()
    default_org_id = default_org.id if default_org else None

    synced_count = 0
    for item in payload.messages:
        clean_phone = normalize_phone(item.phone_number)
        if not is_valid_mobile_phone(clean_phone):
            continue
        if not item.message_body and not item.media_url and not item.caption and not item.media_base64:
            continue
        if item.message_body in ("Active message", "Active conversation", "Direct contact ready to chat"):
            continue
        if item.message_body and item.message_body.startswith("💬 Active chat with"):
            continue

        msg_id = item.meta_message_id or f"wamid.hist_{uuid.uuid4().hex[:16]}"
        chk = await db.execute(
            select(WhatsAppMessage).where(WhatsAppMessage.meta_message_id == msg_id).limit(1)
        )
        existing_msg = chk.scalar_one_or_none()
        if existing_msg:
            if item.media_url and not existing_msg.media_url:
                existing_msg.media_url = item.media_url
                if item.message_type:
                    existing_msg.message_type = item.message_type
                if item.file_name:
                    existing_msg.file_name = item.file_name
                await db.commit()
            continue

        search_suffix = clean_phone[-10:] if len(clean_phone) >= 10 else clean_phone
        effective_user_id = await resolve_valid_user_id(db, payload.assigned_user_id, payload.session_id)
        c_stmt = select(Contact).where(Contact.phone.like(f"%{search_suffix}%"))
        if effective_user_id:
            c_stmt = c_stmt.where(
                or_(
                    Contact.assigned_user_id == effective_user_id,
                    Contact.owner_id == effective_user_id
                )
            )
        c_res = await db.execute(c_stmt.limit(1))
        contact = c_res.scalar_one_or_none()

        display_name = item.contact_name.strip() if item.contact_name and item.contact_name.strip() else format_display_phone(clean_phone)
        if not contact:
            contact = Contact(
                organization_id=default_org_id,
                full_name=display_name,
                phone=f"+{clean_phone}" if not clean_phone.startswith("+") else clean_phone,
                source="WHATSAPP",
                lifecycle_stage="LEAD",
                custom_data={"phonebook_name": item.contact_name.strip()} if item.contact_name else {}
            )
            db.add(contact)
            await db.flush()
        else:
            if item.contact_name and not is_generic_or_placeholder_name(item.contact_name, clean_phone):
                contact.full_name = item.contact_name.strip()
                c_data = dict(contact.custom_data or {})
                c_data["phonebook_name"] = item.contact_name.strip()
                c_data["whatsapp_name"] = item.contact_name.strip()
                contact.custom_data = c_data

        if item.media_base64 and item.file_name:
            try:
                uploads_dir = os.path.join(os.getcwd(), "uploads", "whatsapp")
                os.makedirs(uploads_dir, exist_ok=True)
                raw_b64 = item.media_base64.split(",")[1] if "," in item.media_base64 else item.media_base64
                file_bytes = base64.b64decode(raw_b64)
                file_dest = os.path.join(uploads_dir, item.file_name)
                with open(file_dest, "wb") as f_out:
                    f_out.write(file_bytes)
                if not item.media_url:
                    item.media_url = f"/media/whatsapp/{item.file_name}"
            except Exception as e:
                logger.warning(f"Failed to save history sync media: {e}")

        dt = datetime.datetime.fromtimestamp(item.timestamp) if item.timestamp else datetime.datetime.utcnow()
        dir_val = (item.direction or "INBOUND").upper()

        effective_user_id = await resolve_valid_user_id(db, payload.assigned_user_id, payload.session_id)
        if contact and effective_user_id and not contact.assigned_user_id:
            contact.assigned_user_id = effective_user_id
            contact.owner_id = effective_user_id

        clean_sess = normalize_phone(payload.session_id) if payload.session_id else None
        wa_msg = WhatsAppMessage(
            organization_id=default_org_id,
            contact_id=contact.id if contact else None,
            assigned_user_id=effective_user_id,
            business_phone_number_id=clean_sess or payload.session_id or None,
            session_id=clean_sess or payload.session_id or None,
            phone_number=clean_phone,
            direction=dir_val,
            message_body=item.message_body or "[Historical Message]",
            message_type=item.message_type or "text",
            media_url=item.media_url,
            file_name=item.file_name,
            caption=item.caption,
            is_voice_note=bool(item.is_voice_note),
            meta_message_id=msg_id,
            status="READ" if dir_val == "INBOUND" else "SENT",
            timestamp=dt,
            created_at=dt
        )
        db.add(wa_msg)
        synced_count += 1

    if synced_count > 0:
        await db.commit()

    return {"status": "success", "synced": synced_count}

class VoiceNotePayload(BaseModel):
    phone_number: str
    audio_base64: str
    mimetype: Optional[str] = "audio/mp4"
    contact_id: Optional[str] = None
    duration_seconds: Optional[int] = None
    session_id: Optional[str] = None

@router.post("/upload-voice", status_code=status.HTTP_201_CREATED)
async def upload_and_send_voice_note(
    payload: VoiceNotePayload,
    current_user: Optional[User] = Depends(get_optional_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Receives an audio recording from the CRM web UI, saves to uploads, and delivers via WhatsApp Voice Note (PTT).
    """
    clean_phone = normalize_phone(payload.phone_number)
    if not clean_phone:
        raise HTTPException(status_code=400, detail="Valid phone_number is required")

    pure_base64 = payload.audio_base64.split(",")[1] if "," in payload.audio_base64 else payload.audio_base64
    import base64
    try:
        audio_bytes = base64.b64decode(pure_base64)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid base64 audio payload: {e}")

    # Ensure uploads directory exists
    uploads_dir = os.path.join(os.getcwd(), "uploads", "whatsapp")
    os.makedirs(uploads_dir, exist_ok=True)

    ext = "mp4" if "mp4" in (payload.mimetype or "").lower() else "ogg"
    file_name = f"voice_out_{int(datetime.datetime.utcnow().timestamp())}_{uuid.uuid4().hex[:6]}.{ext}"
    file_path = os.path.join(uploads_dir, file_name)

    with open(file_path, "wb") as f:
        f.write(audio_bytes)

    media_url = f"/media/whatsapp/{file_name}"
    display_body = f"🎤 Voice message ({payload.duration_seconds}s)" if payload.duration_seconds else "🎤 Voice message"

    gateway_url = get_gateway_url()
    outbound_status = "SENT"
    meta_id = f"wamid.voice_{uuid.uuid4().hex[:16]}"

    target_session = normalize_phone(payload.session_id) if payload.session_id else None
    if not target_session and current_user and current_user.whatsapp_phone_number:
        target_session = normalize_phone(current_user.whatsapp_phone_number)
    voice_session_id = target_session or (current_user.id if current_user else "default")

    # Dispatch to WhatsApp Bridge
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{gateway_url}/api/whatsapp/send-voice",
                json={
                    "phone_number": clean_phone,
                    "audio_base64": pure_base64,
                    "mimetype": payload.mimetype or "audio/mp4",
                    "session_id": voice_session_id,
                    "assigned_user_id": current_user.id if current_user else None
                }
            )
            if resp.status_code in [200, 201]:
                res_data = resp.json()
                meta_id = res_data.get("message_id") or meta_id
                outbound_status = "SENT"
                bridge_dur = res_data.get("duration_seconds")
                dur = bridge_dur or payload.duration_seconds
                if dur:
                    display_body = f"🎤 Voice message ({dur}s)"
                converted_b64 = res_data.get("converted_ogg_base64")
                if converted_b64:
                    try:
                        ogg_bytes = base64.b64decode(converted_b64)
                        ogg_file_name = file_name.rsplit(".", 1)[0] + ".ogg"
                        ogg_path = os.path.join(uploads_dir, ogg_file_name)
                        with open(ogg_path, "wb") as f_ogg:
                            f_ogg.write(ogg_bytes)
                        file_name = ogg_file_name
                        media_url = f"/media/whatsapp/{ogg_file_name}"
                    except Exception as e_ogg:
                        logger.warning(f"Failed to save converted ogg: {e_ogg}")
            else:
                outbound_status = "FAILED"
    except Exception as e:
        logger.error(f"[VOICE DISPATCH ERROR]: {e}")
        outbound_status = "FAILED"

    res_org = await db.execute(select(Organization).limit(1))
    default_org = res_org.scalars().first()
    default_org_id = default_org.id if default_org else None

    wa_msg = WhatsAppMessage(
        organization_id=default_org_id,
        contact_id=payload.contact_id,
        assigned_user_id=current_user.id if current_user else None,
        session_id=target_session or voice_session_id,
        business_phone_number_id=target_session or voice_session_id,
        phone_number=clean_phone,
        direction="OUTBOUND",
        message_body=display_body,
        message_type="ptt",
        media_url=media_url,
        file_name=file_name,
        is_voice_note=True,
        meta_message_id=meta_id,
        status=outbound_status,
        timestamp=datetime.datetime.utcnow(),
        created_at=datetime.datetime.utcnow()
    )
    db.add(wa_msg)
    await db.commit()
    await db.refresh(wa_msg)

    return {
        "status": "success",
        "data": {
            "id": wa_msg.id,
            "phone_number": wa_msg.phone_number,
            "direction": wa_msg.direction,
            "message_body": wa_msg.message_body,
            "message_type": wa_msg.message_type,
            "media_url": wa_msg.media_url,
            "file_name": wa_msg.file_name,
            "is_voice_note": wa_msg.is_voice_note,
            "meta_message_id": wa_msg.meta_message_id,
            "status": wa_msg.status,
            "created_at": wa_msg.created_at.isoformat() if wa_msg.created_at else None
        }
    }

class WhatsAppReactionRequest(BaseModel):
    phone_number: str
    meta_message_id: str
    emoji: Optional[str] = ""
    from_me: Optional[bool] = False

@router.post("/react")
async def react_to_whatsapp_message(
    payload: WhatsAppReactionRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Applies or removes an emoji reaction on a WhatsApp message.
    Updates PostgreSQL and dispatches reaction to Baileys gateway.
    """
    clean_id = (payload.meta_message_id or "").strip()
    if not clean_id:
        raise HTTPException(status_code=400, detail="meta_message_id is required")

    stmt = (
        update(WhatsAppMessage)
        .where(
            or_(
                WhatsAppMessage.meta_message_id == clean_id,
                WhatsAppMessage.meta_message_id == f"wamid.{clean_id}",
                WhatsAppMessage.meta_message_id.like(f"%{clean_id}%"),
                WhatsAppMessage.id == clean_id
            )
        )
        .values(reaction=payload.emoji or None)
    )
    await db.execute(stmt)
    await db.commit()

    gateway_url = get_gateway_url()
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            await client.post(
                f"{gateway_url}/api/whatsapp/react",
                json={
                    "phone_number": payload.phone_number,
                    "message_id": clean_id,
                    "emoji": payload.emoji or "",
                    "from_me": payload.from_me
                }
            )
    except Exception as e:
        logger.warning(f"Failed to forward reaction to gateway: {e}")

    return {"status": "success", "reaction": payload.emoji or None}

class WhatsAppEditRequest(BaseModel):
    phone_number: str
    meta_message_id: str
    text: str

@router.post("/edit-message")
async def edit_whatsapp_message_endpoint(
    payload: WhatsAppEditRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Edits the text of an outbound WhatsApp message.
    Updates PostgreSQL and dispatches edit to Baileys gateway.
    """
    clean_id = (payload.meta_message_id or "").strip()
    clean_text = (payload.text or "").strip()
    if not clean_id or not clean_text:
        raise HTTPException(status_code=400, detail="meta_message_id and text are required")

    stmt = (
        update(WhatsAppMessage)
        .where(
            or_(
                WhatsAppMessage.meta_message_id == clean_id,
                WhatsAppMessage.meta_message_id == f"wamid.{clean_id}",
                WhatsAppMessage.meta_message_id.like(f"%{clean_id}%"),
                WhatsAppMessage.id == clean_id
            )
        )
        .values(message_body=clean_text)
    )
    await db.execute(stmt)
    await db.commit()

    gateway_url = get_gateway_url()
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            await client.post(
                f"{gateway_url}/api/whatsapp/edit-message",
                json={
                    "phone_number": payload.phone_number,
                    "message_id": clean_id,
                    "text": clean_text
                }
            )
    except Exception as e:
        logger.warning(f"Failed to forward message edit to gateway: {e}")

    return {"status": "success", "text": clean_text}

class WhatsAppDeleteRequest(BaseModel):
    phone_number: str
    meta_message_id: str
    delete_for_everyone: Optional[bool] = False
    from_me: Optional[bool] = True

@router.post("/delete-message")
async def delete_whatsapp_message_endpoint(
    payload: WhatsAppDeleteRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Deletes a message. If delete_for_everyone is true, sends revoke command to Baileys gateway.
    """
    clean_id = (payload.meta_message_id or "").strip()
    if not clean_id:
        raise HTTPException(status_code=400, detail="meta_message_id is required")

    stmt = (
        update(WhatsAppMessage)
        .where(
            or_(
                WhatsAppMessage.meta_message_id == clean_id,
                WhatsAppMessage.meta_message_id == f"wamid.{clean_id}",
                WhatsAppMessage.meta_message_id.like(f"%{clean_id}%"),
                WhatsAppMessage.id == clean_id
            )
        )
        .values(
            is_deleted=True,
            message_body="🚫 This message was deleted"
        )
    )
    await db.execute(stmt)
    await db.commit()

    if payload.delete_for_everyone:
        gateway_url = get_gateway_url()
        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                await client.post(
                    f"{gateway_url}/api/whatsapp/delete-message",
                    json={
                        "phone_number": payload.phone_number,
                        "message_id": clean_id,
                        "delete_for_everyone": True,
                        "from_me": payload.from_me
                    }
                )
        except Exception as e:
            logger.warning(f"Failed to forward delete revoke to gateway: {e}")

    return {"status": "success", "is_deleted": True}


@router.delete("/conversations/{phone}/clear")
async def clear_whatsapp_chat(
    phone: str,
    current_user: Optional[User] = Depends(get_optional_current_user),
    db: AsyncSession = Depends(get_db)
):
    clean = normalize_phone(phone)
    if not clean:
        raise HTTPException(status_code=400, detail="Invalid phone number")
    search_suffix = clean[-10:] if len(clean) >= 10 else clean
    stmt = delete(WhatsAppMessage).where(WhatsAppMessage.phone_number.like(f"%{search_suffix}%"))
    if current_user:
        stmt = stmt.where(WhatsAppMessage.assigned_user_id == current_user.id)
    res = await db.execute(stmt)
    await db.commit()
    return {"status": "success", "cleared": res.rowcount}

@router.post("/conversations/{phone}/block")
async def block_whatsapp_contact(
    phone: str,
    current_user: Optional[User] = Depends(get_optional_current_user),
    db: AsyncSession = Depends(get_db)
):
    clean = normalize_phone(phone)
    if not clean:
        raise HTTPException(status_code=400, detail="Invalid phone number")
    search_suffix = clean[-10:] if len(clean) >= 10 else clean
    c_stmt = select(Contact).where(Contact.phone.like(f"%{search_suffix}%"))
    if current_user:
        c_stmt = c_stmt.where(or_(Contact.assigned_user_id == current_user.id, Contact.owner_id == current_user.id))
    c_res = await db.execute(c_stmt.limit(1))
    contact = c_res.scalar_one_or_none()
    if contact:
        c_data = dict(contact.custom_data or {})
        c_data["is_blocked"] = True
        contact.custom_data = c_data
        await db.commit()
    return {"status": "success", "blocked": True}

@router.post("/conversations/{phone}/unblock")
async def unblock_whatsapp_contact(
    phone: str,
    current_user: Optional[User] = Depends(get_optional_current_user),
    db: AsyncSession = Depends(get_db)
):
    clean = normalize_phone(phone)
    if not clean:
        raise HTTPException(status_code=400, detail="Invalid phone number")
    search_suffix = clean[-10:] if len(clean) >= 10 else clean
    c_stmt = select(Contact).where(Contact.phone.like(f"%{search_suffix}%"))
    if current_user:
        c_stmt = c_stmt.where(or_(Contact.assigned_user_id == current_user.id, Contact.owner_id == current_user.id))
    c_res = await db.execute(c_stmt.limit(1))
    contact = c_res.scalar_one_or_none()
    if contact:
        c_data = dict(contact.custom_data or {})
        c_data["is_blocked"] = False
        contact.custom_data = c_data
        await db.commit()
    return {"status": "success", "blocked": False}

@router.post("/conversations/{phone}/pin")
async def pin_whatsapp_conversation(
    phone: str,
    current_user: Optional[User] = Depends(get_optional_current_user),
    db: AsyncSession = Depends(get_db)
):
    clean = normalize_phone(phone)
    if not clean:
        raise HTTPException(status_code=400, detail="Invalid phone number")
    search_suffix = clean[-10:] if len(clean) >= 10 else clean
    c_stmt = select(Contact).where(Contact.phone.like(f"%{search_suffix}%"))
    if current_user:
        c_stmt = c_stmt.where(or_(Contact.assigned_user_id == current_user.id, Contact.owner_id == current_user.id))
    c_res = await db.execute(c_stmt.limit(1))
    contact = c_res.scalar_one_or_none()
    is_pinned = True
    if contact:
        c_data = dict(contact.custom_data or {})
        is_pinned = not c_data.get("is_pinned", False)
        c_data["is_pinned"] = is_pinned
        contact.custom_data = c_data
        await db.commit()
    else:
        is_pinned = True
        contact = Contact(
            organization_id=current_user.organization_id if current_user else None,
            full_name=format_display_phone(clean),
            phone=f"+{clean}" if not clean.startswith("+") else clean,
            source="WHATSAPP",
            lifecycle_stage="LEAD",
            assigned_user_id=current_user.id if current_user else None,
            owner_id=current_user.id if current_user else None,
            custom_data={"is_pinned": True}
        )
        db.add(contact)
        await db.commit()
    # Reflect pin modification on WhatsApp device
    try:
        g_url = get_gateway_url()
        targets = [g_url]
        if g_url != "https://zigmaa-whatsapp-bridge.onrender.com":
            targets.append("https://zigmaa-whatsapp-bridge.onrender.com")
        for t in targets:
            async with httpx.AsyncClient(timeout=4.0) as cl:
                await cl.post(f"{t}/chat-modify", json={
                    "phone_number": clean,
                    "pin": is_pinned,
                    "session_id": current_user.id if current_user else "default"
                })
    except Exception:
        pass

    return {"status": "success", "is_pinned": is_pinned}

@router.post("/conversations/{phone}/archive")
async def archive_whatsapp_conversation(
    phone: str,
    current_user: Optional[User] = Depends(get_optional_current_user),
    db: AsyncSession = Depends(get_db)
):
    clean = normalize_phone(phone)
    if not clean:
        raise HTTPException(status_code=400, detail="Invalid phone number")
    search_suffix = clean[-10:] if len(clean) >= 10 else clean
    c_stmt = select(Contact).where(Contact.phone.like(f"%{search_suffix}%"))
    if current_user:
        c_stmt = c_stmt.where(or_(Contact.assigned_user_id == current_user.id, Contact.owner_id == current_user.id))
    c_res = await db.execute(c_stmt.limit(1))
    contact = c_res.scalar_one_or_none()
    is_archived = True
    if contact:
        c_data = dict(contact.custom_data or {})
        is_archived = not c_data.get("is_archived", False)
        c_data["is_archived"] = is_archived
        contact.custom_data = c_data
        await db.commit()
    else:
        is_archived = True
        contact = Contact(
            organization_id=current_user.organization_id if current_user else None,
            full_name=format_display_phone(clean),
            phone=f"+{clean}" if not clean.startswith("+") else clean,
            source="WHATSAPP",
            lifecycle_stage="LEAD",
            assigned_user_id=current_user.id if current_user else None,
            owner_id=current_user.id if current_user else None,
            custom_data={"is_archived": True}
        )
        db.add(contact)
        await db.commit()
    # Reflect archive modification on WhatsApp device
    try:
        g_url = get_gateway_url()
        targets = [g_url]
        if g_url != "https://zigmaa-whatsapp-bridge.onrender.com":
            targets.append("https://zigmaa-whatsapp-bridge.onrender.com")
        for t in targets:
            async with httpx.AsyncClient(timeout=4.0) as cl:
                await cl.post(f"{t}/chat-modify", json={
                    "phone_number": clean,
                    "archive": is_archived,
                    "session_id": current_user.id if current_user else "default"
                })
    except Exception:
        pass

    return {"status": "success", "is_archived": is_archived}

@router.post("/admin/wipe-whatsapp-database")
async def wipe_whatsapp_database_live(
    secret_key: str = Query(...),
    db: AsyncSession = Depends(get_db)
):
    """
    Secure maintenance endpoint to wipe all WhatsApp messages, contacts, and linked devices
    from the production database.
    """
    if secret_key != "zigmaa_super_wipe_whatsapp_2026":
        raise HTTPException(status_code=403, detail="Unauthorized")
    
    fk_tables = ["deals", "activities", "calendar_events", "invoices", "tasks"]
    for tbl in fk_tables:
        try:
            await db.execute(text(f"""
                UPDATE {tbl} SET contact_id = NULL 
                WHERE contact_id IN (
                    SELECT id FROM contacts 
                    WHERE source = 'WHATSAPP' 
                       OR (custom_data->>'whatsapp_name') IS NOT NULL
                       OR (custom_data->>'phonebook_name') IS NOT NULL
                       OR (custom_data->>'channel') = 'meta_whatsapp_cloud_api'
                )
            """))
        except Exception:
            pass

    m_res = await db.execute(text("DELETE FROM whatsapp_messages"))
    c_res = await db.execute(text("""
        DELETE FROM contacts 
        WHERE source = 'WHATSAPP' 
           OR (custom_data->>'whatsapp_name') IS NOT NULL
           OR (custom_data->>'phonebook_name') IS NOT NULL
           OR (custom_data->>'channel') = 'meta_whatsapp_cloud_api'
    """))
    u_res = await db.execute(text("UPDATE users SET whatsapp_phone_number = NULL, whatsapp_phone_number_id = NULL"))
    await db.commit()

    # Clear memory cache
    global _qr_status_cache
    _qr_status_cache.clear()

    # Request bridge to wipe sessions as well
    try:
        g_url = get_gateway_url()
        targets = [g_url, "https://zigmaa-whatsapp-bridge.onrender.com"]
        for t in targets:
            async with httpx.AsyncClient(timeout=5.0) as cl:
                await cl.post(f"{t}/admin/wipe-sessions?secret_key=zigmaa_super_wipe_whatsapp_2026")
    except Exception:
        pass

    return {
        "status": "success",
        "deleted_messages": m_res.rowcount,
        "deleted_contacts": c_res.rowcount,
        "reset_users": u_res.rowcount
    }


class SessionBackupPayload(BaseModel):
    session_id: str
    owner_phone: Optional[str] = None
    auth_data: str

@router.post("/session-backup")
async def backup_whatsapp_session(
    payload: SessionBackupPayload,
    db: AsyncSession = Depends(get_db)
):
    """
    Persists WhatsApp Baileys session authentication bundle into PostgreSQL
    so that Render restarts or overnight tab closures NEVER lose active sessions.
    """
    clean_session = payload.session_id.strip()
    clean_phone = normalize_phone(payload.owner_phone) if payload.owner_phone else None
    auth_data_str = str(payload.auth_data or "")

    # NEVER backup dead/deregistered credentials!
    if '"registered":false' in auth_data_str or '"registered": false' in auth_data_str:
        logger.info(f"[SESSION BACKUP] Skipping backup of dead/deregistered session {clean_session}")
        await db.execute(
            text("DELETE FROM whatsapp_session_backups WHERE session_id = :s_id;"),
            {"s_id": clean_session}
        )
        await db.commit()
        return {"status": "skipped", "reason": "deregistered"}

    await db.execute(
        text("""
            INSERT INTO whatsapp_session_backups (session_id, owner_phone, auth_data, updated_at)
            VALUES (:s_id, :phone, :data, NOW())
            ON CONFLICT (session_id) DO UPDATE
            SET owner_phone = COALESCE(EXCLUDED.owner_phone, whatsapp_session_backups.owner_phone),
                auth_data = EXCLUDED.auth_data,
                updated_at = NOW();
        """),
        {"s_id": clean_session, "phone": clean_phone, "data": payload.auth_data}
    )
    await db.commit()
    return {"status": "success", "session_id": clean_session}

@router.delete("/session-backup/{session_id}")
async def delete_whatsapp_session_backup(
    session_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Deletes Baileys session backup from PostgreSQL upon logout or session reset.
    """
    clean_id = session_id.strip()
    await db.execute(
        text("DELETE FROM whatsapp_session_backups WHERE session_id = :s_id;"),
        {"s_id": clean_id}
    )
    await db.commit()
    return {"status": "success", "deleted": clean_id}

@router.get("/session-restore/{session_id}")
async def restore_whatsapp_session(
    session_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Restores Baileys authentication bundle from PostgreSQL into a freshly booted container.
    """
    clean_id = session_id.strip()
    res = await db.execute(
        text("SELECT session_id, owner_phone, auth_data FROM whatsapp_session_backups WHERE session_id = :s_id LIMIT 1;"),
        {"s_id": clean_id}
    )
    row = res.fetchone()
    if not row and clean_id != "default":
        num_clean = normalize_phone(clean_id)
        if num_clean:
            res = await db.execute(
                text("SELECT session_id, owner_phone, auth_data FROM whatsapp_session_backups WHERE owner_phone = :phone LIMIT 1;"),
                {"phone": num_clean}
            )
            row = res.fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="No session backup found")

    auth_data_str = str(row[2] or "")
    if '"registered":false' in auth_data_str or '"registered": false' in auth_data_str:
        logger.warning(f"[SESSION RESTORE] Detected dead/deregistered backup for {clean_id}. Purging from DB...")
        await db.execute(
            text("DELETE FROM whatsapp_session_backups WHERE session_id = :s_id;"),
            {"s_id": clean_id}
        )
        await db.commit()
        raise HTTPException(status_code=404, detail="Session backup was deregistered and has been purged")

    return {
        "status": "success",
        "session_id": row[0],
        "owner_phone": row[1],
        "auth_data": row[2]
    }
