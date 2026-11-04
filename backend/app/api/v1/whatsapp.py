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
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc, or_, update, func

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
    jid: Optional[str] = None
    avatar_url: Optional[str] = None

class WhatsAppBulkSyncRequest(BaseModel):
    contacts: List[WhatsAppContactSyncItem]

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

def get_gateway_url() -> str:
    url = (os.getenv("WHATSAPP_GATEWAY_URL") or getattr(settings, "WHATSAPP_GATEWAY_URL", "")).strip().rstrip("/")
    if os.getenv("RENDER") or os.getenv("ENVIRONMENT") == "production":
        # Always use the live deployed Render bridge in production / Render cloud
        if not url or any(x in url.lower() for x in ["localhost", "127.0.0.1", "5001", "loca.lt", "ngrok"]):
            return "https://zigmaa-whatsapp-bridge.onrender.com"
        return url
    if not url:
        return "http://localhost:5001"
    return url

@router.post("/send", status_code=status.HTTP_201_CREATED)
@router.post("/messages", status_code=status.HTTP_201_CREATED)
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

    contact_id = payload.contact_id
    if not contact_id:
        search_suffix = clean_phone[-10:] if len(clean_phone) >= 10 else clean_phone
        c_res = await db.execute(select(Contact).where(Contact.phone.like(f"%{search_suffix}%")).limit(1))
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

    for target in targets:
        try:
            async with httpx.AsyncClient(timeout=25.0, headers={"Bypass-Tunnel-Reminder": "true", "User-Agent": "ZigmaaCRM-Cloud"}) as client:
                st_res = await client.get(f"{target}/status")
                if st_res.status_code == 200 and st_res.json().get("status") == "CONNECTED":
                    send_payload = {
                        "phone_number": clean_phone,
                        "message": payload.message or "",
                        "file_base64": payload.file_base64,
                        "file_name": payload.file_name,
                        "file_type": payload.file_type,
                        "quoted_message_id": payload.quoted_message_id,
                        "quoted_text": payload.quoted_text,
                        "quoted_from_me": payload.quoted_from_me
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
            logger.debug(f"QR Gateway check at {target} skipped or failed: {e}")

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

    wa_message = WhatsAppMessage(
        organization_id=org_id,
        contact_id=contact_id,
        assigned_user_id=current_user.id if current_user else None,
        business_phone_number_id=phone_number_id or None,
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
    limit: int = Query(150, le=500),
    db: AsyncSession = Depends(get_db)
):
    """
    Retrieve message thread history for a phone number or contact
    """
    stmt = select(WhatsAppMessage)
    if contact_id:
        stmt = stmt.where(WhatsAppMessage.contact_id == contact_id)
    elif phone_number:
        clean = normalize_phone(phone_number)
        search_suffix = clean[-10:] if len(clean) >= 10 else clean
        stmt = stmt.where(WhatsAppMessage.phone_number.like(f"%{search_suffix}%"))

    # Order DESC to get the latest messages first, then reverse for chronological display
    stmt = stmt.order_by(WhatsAppMessage.created_at.desc()).limit(limit)
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
                "created_at": m.created_at.isoformat() if m.created_at else None
            }
            for m in messages
        ]
    }

@router.get("/conversations")
async def get_whatsapp_conversations(
    assigned_user_id: Optional[str] = Query(None),
    limit: int = Query(25, le=100),
    current_user: Optional[User] = Depends(get_optional_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Retrieve active conversation summaries enriched with contact details.
    Scoped by sales rep / assigned user.
    """
    stmt = select(WhatsAppMessage)

    # Scoping logic:
    # 1. If logged in as SALES_REP: only show chats assigned to them
    if current_user and (current_user.role or "").lower() == "sales_rep":
        stmt = stmt.where(WhatsAppMessage.assigned_user_id == current_user.id)
    # 2. If an explicit filter is requested by Admin:
    elif assigned_user_id and assigned_user_id.lower() != "all":
        stmt = stmt.where(WhatsAppMessage.assigned_user_id == assigned_user_id)

    stmt = stmt.order_by(desc(WhatsAppMessage.created_at)).limit(limit * 5)
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
                if clean and clean not in DUMMY_TEST_PHONES and len(clean) >= 7:
                    unique_phones.add(clean)
                    unique_phones.add(f"+{clean}")
                    unique_phones.add(m.phone_number)
            if m.contact_id:
                unique_contact_ids.add(m.contact_id)

        contact_conditions = []
        if unique_contact_ids:
            contact_conditions.append(Contact.id.in_(list(unique_contact_ids)))
        if unique_phones:
            contact_conditions.append(Contact.phone.in_(list(unique_phones)))

        contacts_list = []
        if contact_conditions:
            c_res = await db.execute(select(Contact).where(or_(*contact_conditions)).limit(limit * 2))
            contacts_list = c_res.scalars().all()

        contacts_by_id = {c.id: c for c in contacts_list}
        contacts_by_phone = {normalize_phone(c.phone): c for c in contacts_list if c.phone}

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
            clean_check = normalize_phone(m.phone_number)
            if not clean_check or clean_check in DUMMY_TEST_PHONES or len(clean_check) < 7:
                continue

            if m.phone_number not in conv_map:
                contact = contacts_by_id.get(m.contact_id)
                if not contact:
                    clean_m = normalize_phone(m.phone_number)
                    contact = contacts_by_phone.get(clean_m)
                    if not contact and len(clean_m) >= 10:
                        suffix = clean_m[-10:]
                        for cp, c_obj in contacts_by_phone.items():
                            if cp.endswith(suffix):
                                contact = c_obj
                                break

                prof_name = None
                avatar_url = None
                if contact and isinstance(contact.custom_data, dict):
                    prof_name = contact.custom_data.get("whatsapp_profile_name")
                    avatar_url = contact.custom_data.get("avatar_url")

                wa_saved_name = None
                if contact and isinstance(contact.custom_data, dict):
                    wa_saved_name = contact.custom_data.get("whatsapp_name") or contact.custom_data.get("whatsapp_profile_name")

                if wa_saved_name and not is_generic_or_placeholder_name(str(wa_saved_name), m.phone_number):
                    contact_name = str(wa_saved_name).strip()
                elif contact and contact.full_name and not is_generic_or_placeholder_name(contact.full_name, m.phone_number):
                    contact_name = contact.full_name.strip()
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
                else:
                    last_msg_snippet = m.message_body or ""

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
                    "last_message_time": m.created_at.isoformat() if m.created_at else None,
                    "last_direction": m.direction,
                    "last_status": m.status,
                    "unread_count": unread_cnt
                }

    # Return ONLY real active conversations with actual sent or received messages
    active_conversations = list(conv_map.values())
    active_conversations.sort(
        key=lambda c: c.get("last_message_time") or "",
        reverse=True
    )

    return {
        "status": "success",
        "conversations": active_conversations[:limit]
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
    Strictly ignores @g.us group chats and does not insert any chat messages.
    """
    if not payload.contacts:
        return {"status": "success", "synced": 0}

    res_org = await db.execute(select(Organization).limit(1))
    default_org = res_org.scalars().first()
    default_org_id = default_org.id if default_org else None

    synced_count = 0
    for item in payload.contacts:
        clean_phone = normalize_phone(item.phone)
        if not clean_phone or len(clean_phone) < 7:
            continue

        search_suffix = clean_phone[-10:] if len(clean_phone) >= 10 else clean_phone
        formatted_phone = f"+{clean_phone}" if not clean_phone.startswith("+") else clean_phone
        display_name = item.name.strip() if item.name and not is_generic_or_placeholder_name(item.name, clean_phone) else format_display_phone(clean_phone)

        c_res = await db.execute(select(Contact).where(Contact.phone.like(f"%{search_suffix}%")).limit(1))
        contact = c_res.scalar_one_or_none()

        if contact:
            # Update name/avatar if empty or placeholder
            if (not contact.full_name or is_generic_or_placeholder_name(contact.full_name, clean_phone)) and item.name:
                contact.full_name = item.name.strip()

            curr_data = dict(contact.custom_data or {})
            if item.avatar_url and curr_data.get("avatar_url") != item.avatar_url:
                curr_data["avatar_url"] = item.avatar_url
                contact.custom_data = curr_data
            if item.jid and not curr_data.get("jid"):
                curr_data["jid"] = item.jid
                contact.custom_data = curr_data
        else:
            c_data = {}
            if item.jid:
                c_data["jid"] = item.jid
            if item.avatar_url:
                c_data["avatar_url"] = item.avatar_url

            contact = Contact(
                organization_id=default_org_id,
                full_name=display_name,
                phone=formatted_phone,
                source="WHATSAPP",
                lifecycle_stage="LEAD",
                status="NEW",
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
    gateway_url = getattr(settings, "WHATSAPP_GATEWAY_URL", "http://localhost:5001")
    try:
        async with httpx.AsyncClient(timeout=4.0) as client:
            resp = await client.get(f"{gateway_url}/avatar/{clean_phone}")
            if resp.status_code == 200:
                data = resp.json()
                avatar_url = data.get("avatar_url")
                if avatar_url and contact:
                    curr_data = dict(contact.custom_data or {})
                    curr_data["avatar_url"] = avatar_url
                    contact.custom_data = curr_data
                    await db.commit()
                return {"phone": clean_phone, "avatar_url": avatar_url}
    except Exception as e:
        logger.debug(f"Failed to fetch avatar from gateway for {clean_phone}: {e}")

    return {"phone": clean_phone, "avatar_url": None}

_qr_status_cache: Dict[str, Any] = {"data": None, "ts": 0}

@router.get("/qr/status")
async def get_whatsapp_qr_status():
    """
    Checks connection status, linked phone, and current QR code from Baileys gateway.
    Supports in-memory high-speed caching and fast cloud failover.
    """
    global _qr_status_cache
    now = time.time()
    # Return fresh cache (within 2 seconds) instantly to prevent polling storm
    if _qr_status_cache["data"] and (now - _qr_status_cache["ts"] < 2.0):
        return _qr_status_cache["data"]

    gateway_url = get_gateway_url()
    targets = [gateway_url]
    if gateway_url != "https://zigmaa-whatsapp-bridge.onrender.com":
        targets.append("https://zigmaa-whatsapp-bridge.onrender.com")

    for target in targets:
        try:
            async with httpx.AsyncClient(timeout=15.0, headers={"Bypass-Tunnel-Reminder": "true", "User-Agent": "ZigmaaCRM-Cloud"}) as client:
                resp = await client.get(f"{target}/status")
                if resp.status_code == 200:
                    data = resp.json()
                    data["gateway_online"] = True
                    _qr_status_cache["data"] = data
                    _qr_status_cache["ts"] = time.time()
                    return data
        except Exception as e:
            logger.debug(f"WhatsApp QR Gateway at {target} not reachable: {e}")

    # Fallback to slightly older cache (up to 15s) ONLY if we had a successful online status
    if _qr_status_cache["data"] and _qr_status_cache["data"].get("gateway_online") and (now - _qr_status_cache["ts"] < 15.0):
        return _qr_status_cache["data"]

    return {
        "status": "DISCONNECTED",
        "phone": None,
        "name": None,
        "qr": None,
        "gateway_online": False
    }

@router.post("/qr/refresh")
async def refresh_whatsapp_qr():
    """
    Requests a fresh QR code from the Baileys gateway.
    """
    global _qr_status_cache
    _qr_status_cache["ts"] = 0  # Invalidate cache immediately

    gateway_url = get_gateway_url()
    targets = [gateway_url]
    if gateway_url != "https://zigmaa-whatsapp-bridge.onrender.com":
        targets.append("https://zigmaa-whatsapp-bridge.onrender.com")

    last_err = None
    for target in targets:
        try:
            async with httpx.AsyncClient(timeout=20.0, headers={"Bypass-Tunnel-Reminder": "true", "User-Agent": "ZigmaaCRM-Cloud"}) as client:
                resp = await client.post(f"{target}/refresh-qr")
                return resp.json()
        except Exception as e:
            last_err = e

    raise HTTPException(status_code=503, detail=f"Failed to connect to WhatsApp Gateway: {last_err}")

@router.post("/qr/disconnect")
async def disconnect_whatsapp_qr():
    """
    Disconnects and logs out the Baileys QR session.
    """
    global _qr_status_cache
    _qr_status_cache["ts"] = 0  # Invalidate cache immediately
    gateway_url = get_gateway_url()
    targets = [gateway_url]
    if gateway_url != "https://zigmaa-whatsapp-bridge.onrender.com":
        targets.append("https://zigmaa-whatsapp-bridge.onrender.com")

    last_err = None
    for target in targets:
        try:
            async with httpx.AsyncClient(timeout=25.0, headers={"Bypass-Tunnel-Reminder": "true", "User-Agent": "ZigmaaCRM-Cloud"}) as client:
                resp = await client.post(f"{target}/disconnect")
                return resp.json()
        except Exception as e:
            last_err = e

    raise HTTPException(status_code=503, detail=f"Failed to disconnect WhatsApp Gateway: {last_err}")

class WhatsAppHistorySyncItem(BaseModel):
    phone_number: str
    contact_name: Optional[str] = None
    message_body: str
    meta_message_id: Optional[str] = None
    timestamp: Optional[int] = None
    direction: Optional[str] = "INBOUND"
    message_type: Optional[str] = "text"
    media_url: Optional[str] = None
    file_name: Optional[str] = None
    caption: Optional[str] = None
    is_voice_note: Optional[bool] = False

class WhatsAppHistorySyncPayload(BaseModel):
    messages: List[WhatsAppHistorySyncItem]

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
        if not clean_phone or len(clean_phone) < 7:
            continue

        msg_id = item.meta_message_id or f"wamid.hist_{uuid.uuid4().hex[:16]}"
        chk = await db.execute(
            select(WhatsAppMessage.id).where(WhatsAppMessage.meta_message_id == msg_id).limit(1)
        )
        if chk.scalar_one_or_none():
            continue

        search_suffix = clean_phone[-10:] if len(clean_phone) >= 10 else clean_phone
        c_res = await db.execute(select(Contact).where(Contact.phone.like(f"%{search_suffix}%")).limit(1))
        contact = c_res.scalar_one_or_none()

        display_name = item.contact_name.strip() if item.contact_name and item.contact_name.strip() else format_display_phone(clean_phone)
        if not contact:
            contact = Contact(
                organization_id=default_org_id,
                full_name=display_name,
                phone=f"+{clean_phone}" if not clean_phone.startswith("+") else clean_phone,
                source="WHATSAPP",
                lifecycle_stage="LEAD"
            )
            db.add(contact)
            await db.flush()

        dt = datetime.datetime.fromtimestamp(item.timestamp) if item.timestamp else datetime.datetime.utcnow()
        dir_val = (item.direction or "INBOUND").upper()

        wa_msg = WhatsAppMessage(
            organization_id=default_org_id,
            contact_id=contact.id if contact else None,
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

    # Dispatch to WhatsApp Bridge
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{gateway_url}/api/whatsapp/send-voice",
                json={
                    "phone_number": clean_phone,
                    "audio_base64": pure_base64,
                    "mimetype": payload.mimetype or "audio/mp4"
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
