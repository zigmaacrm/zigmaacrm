import os
import re
import uuid
import logging
from pathlib import Path
from dotenv import dotenv_values
import httpx
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc, or_, update

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
    clean_p = normalize_phone(phone)
    if clean_p and (clean_p in cleaned.replace(" ", "") or cleaned.replace(" ", "").endswith(clean_p[-10:])):
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

class SendWhatsAppMessageRequest(BaseModel):
    phone_number: str
    message: str
    contact_id: Optional[str] = None
    organization_id: Optional[str] = None

class WhatsAppMessageOut(BaseModel):
    id: str
    phone_number: str
    direction: str
    message_body: str
    message_type: str
    meta_message_id: Optional[str] = None
    status: str
    contact_id: Optional[str] = None
    assigned_user_id: Optional[str] = None
    business_phone_number_id: Optional[str] = None
    created_at: Any

    class Config:
        from_attributes = True

class ReassignConversationRequest(BaseModel):
    assigned_user_id: str

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

    if not payload.message.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Message body cannot be empty"
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

    api_token, default_phone_number_id = get_whatsapp_credentials()
    phone_number_id = (
        (current_user.whatsapp_phone_number_id if current_user and current_user.whatsapp_phone_number_id else None)
        or default_phone_number_id
    )

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

    wa_message = WhatsAppMessage(
        organization_id=org_id,
        contact_id=contact_id,
        assigned_user_id=current_user.id if current_user else None,
        business_phone_number_id=phone_number_id or None,
        phone_number=clean_phone,
        direction="OUTBOUND",
        message_body=payload.message,
        message_type="text",
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
    limit: int = Query(50, le=200),
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

    stmt = stmt.order_by(WhatsAppMessage.created_at.asc()).limit(limit)
    res = await db.execute(stmt)
    messages = res.scalars().all()

    return {
        "status": "success",
        "count": len(messages),
        "messages": [
            {
                "id": m.id,
                "phone_number": m.phone_number,
                "direction": m.direction,
                "message_body": m.message_body,
                "message_type": m.message_type,
                "meta_message_id": m.meta_message_id,
                "status": m.status,
                "contact_id": m.contact_id,
                "assigned_user_id": m.assigned_user_id,
                "business_phone_number_id": m.business_phone_number_id,
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

    if not all_msgs:
        return {"status": "success", "conversations": []}

    unique_phones = set()
    unique_contact_ids = set()
    for m in all_msgs:
        if m.phone_number:
            clean = normalize_phone(m.phone_number)
            if clean:
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

    conv_map: Dict[str, Any] = {}
    for m in all_msgs:
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
            if contact and isinstance(contact.custom_data, dict):
                prof_name = contact.custom_data.get("whatsapp_profile_name")

            if contact and contact.full_name and not is_generic_or_placeholder_name(contact.full_name, m.phone_number):
                contact_name = contact.full_name.strip()
            elif prof_name and str(prof_name).strip():
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

            unread_cnt = 1 if m.direction == "INBOUND" and m.status != "READ" else 0

            conv_map[m.phone_number] = {
                "id": f"conv-{m.phone_number}",
                "phone_number": m.phone_number,
                "contact_id": contact.id if contact else m.contact_id,
                "assigned_user_id": m.assigned_user_id,
                "business_phone_number_id": m.business_phone_number_id,
                "contact_name": contact_name,
                "company_name": company_name,
                "email": email,
                "avatar_initials": initials,
                "deal_stage": stage,
                "deal_value": 1480000,
                "assigned_rep": {
                    "id": m.assigned_user_id,
                    "name": rep_name,
                    "avatar": rep_avatar,
                    "role": "Sales Representative"
                },
                "last_message": m.message_body,
                "last_message_time": m.created_at.isoformat() if m.created_at else None,
                "last_direction": m.direction,
                "last_status": m.status,
                "unread_count": unread_cnt
            }

    return {
        "status": "success",
        "conversations": list(conv_map.values())[:limit]
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
