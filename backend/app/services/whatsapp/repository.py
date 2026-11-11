"""
Database queries for WhatsApp Suite.
Every single query is strictly scoped by organization_id and session_id (the user's connected phone number).
Zero auto-creation of CRM contacts or leads: WhatsApp data lives exclusively in whatsapp_chats
and whatsapp_messages. Conversion to CRM only happens via explicit call to convert_chat_to_lead.
"""
import datetime
import logging
import uuid
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger("zigmaa.whatsapp.repository")

NOW_UTC = "timezone('utc', clock_timestamp())"
STALE_HEARTBEAT_SECONDS = 180


async def get_user_session(
    db: AsyncSession, organization_id: str, user_id: str
) -> Tuple[Optional[Dict[str, Any]], bool]:
    """
    Retrieves the WhatsApp session for a specific user within an organization.
    Returns (session_row, is_stale).
    """
    stmt = text(
        """SELECT id, organization_id, user_id, phone_number, lid, push_name, platform,
                  avatar_url, status, desired_state, qr, qr_expires_at, owner_instance,
                  heartbeat_at, last_connected_at, last_disconnect_code, last_disconnect_reason,
                  last_disconnect_at, history_sync_status, history_sync_progress,
                  created_at, updated_at
           FROM whatsapp_sessions
           WHERE organization_id = :org_id AND user_id = :user_id"""
    )
    result = await db.execute(stmt, {"org_id": organization_id, "user_id": user_id})
    row = result.mappings().first()
    if not row:
        return None, False

    row_dict = dict(row)
    heartbeat = row_dict.get("heartbeat_at")
    is_stale = False
    if heartbeat:
        now = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
        if (now - heartbeat).total_seconds() > STALE_HEARTBEAT_SECONDS:
            is_stale = True

    return row_dict, is_stale


async def ensure_user_session(
    db: AsyncSession, organization_id: str, user_id: str
) -> Dict[str, Any]:
    """
    Ensures a whatsapp_sessions row exists for the user.
    """
    session, _ = await get_user_session(db, organization_id, user_id)
    if session:
        return session

    new_id = f"wa_{user_id.replace('-', '')[:24]}"
    stmt = text(
        f"""INSERT INTO whatsapp_sessions (id, organization_id, user_id, status, desired_state, created_at, updated_at)
           VALUES (:id, :org_id, :user_id, 'DISCONNECTED', 'running', {NOW_UTC}, {NOW_UTC})
           ON CONFLICT (organization_id, user_id) DO UPDATE SET updated_at = {NOW_UTC}
           RETURNING id, organization_id, user_id, phone_number, lid, push_name, platform,
                     avatar_url, status, desired_state, qr, qr_expires_at, owner_instance,
                     heartbeat_at, last_connected_at, last_disconnect_code, last_disconnect_reason,
                     last_disconnect_at, history_sync_status, history_sync_progress,
                     created_at, updated_at"""
    )
    result = await db.execute(stmt, {"id": new_id, "org_id": organization_id, "user_id": user_id})
    await db.commit()
    return dict(result.mappings().first())


async def update_user_session_qr(
    db: AsyncSession, organization_id: str, user_id: str, qr: Optional[str], status: str = "SCAN_QR"
) -> None:
    """Persists generated QR code to the database row so all clients get it immediately."""
    stmt = text(
        f"""UPDATE whatsapp_sessions
           SET qr = :qr, status = :status, updated_at = {NOW_UTC}
           WHERE organization_id = :org_id AND user_id = :user_id"""
    )
    await db.execute(stmt, {"qr": qr, "status": status, "org_id": organization_id, "user_id": user_id})
    await db.commit()


async def list_chats(
    db: AsyncSession,
    *,
    organization_id: str,
    session_id: str,
    filter_type: str = "all",
    search: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
) -> List[Dict[str, Any]]:
    """
    Lists 1-to-1 WhatsApp chats scoped to organization_id and session_id (the connected phone number).
    Left joins CRM leads and contacts to surface linkage metadata if converted.
    """
    conditions = [
        "c.organization_id = :org_id",
        "c.session_id = :session_id",
        "c.merged_into IS NULL",
        "(c.jid NOT LIKE '%@lid' OR c.phone_number IS NOT NULL OR c.last_message_at IS NOT NULL)",
    ]
    params: Dict[str, Any] = {
        "org_id": organization_id,
        "session_id": session_id,
        "limit": max(1, min(limit, 100)),
        "offset": max(0, offset),
    }

    if filter_type == "unread":
        conditions.append("c.unread_count > 0")
        conditions.append("c.is_archived = FALSE")
    elif filter_type == "pinned":
        conditions.append("c.is_pinned = TRUE")
    elif filter_type == "archived":
        conditions.append("c.is_archived = TRUE")
    else:  # "all"
        conditions.append("c.is_archived = FALSE")

    if search and search.strip():
        term = f"%{search.strip()}%"
        params["search"] = term
        conditions.append(
            "(c.name ILIKE :search OR c.phone_number ILIKE :search OR c.custom_name ILIKE :search OR c.push_name ILIKE :search OR c.last_message_preview ILIKE :search)"
        )

    where_clause = " AND ".join(conditions)

    sql = f"""
        SELECT c.*,
               l.full_name AS lead_name,
               l.status AS lead_status,
               l.company_name AS lead_company,
               l.email AS lead_email,
               ct.full_name AS contact_name,
               ct.company_name AS contact_company,
               ct.email AS contact_email
        FROM whatsapp_chats c
        LEFT JOIN leads l ON l.id = c.lead_id AND l.organization_id = c.organization_id
        LEFT JOIN contacts ct ON ct.id = c.contact_id AND ct.organization_id = c.organization_id
        WHERE {where_clause}
        ORDER BY c.is_pinned DESC, c.last_message_at DESC NULLS LAST, c.created_at DESC
        LIMIT :limit OFFSET :offset
    """

    result = await db.execute(text(sql), params)
    return [dict(row) for row in result.mappings().all()]


async def get_chat_counts(
    db: AsyncSession, organization_id: str, session_id: str
) -> Dict[str, int]:
    """
    Returns counts for tab badges: all, unread, pinned, archived.
    """
    sql = text(
        """SELECT
               COUNT(*) FILTER (WHERE is_archived = FALSE) AS all_count,
               COUNT(*) FILTER (WHERE unread_count > 0 AND is_archived = FALSE) AS unread_count,
               COUNT(*) FILTER (WHERE is_pinned = TRUE) AS pinned_count,
               COUNT(*) FILTER (WHERE is_archived = TRUE) AS archived_count
           FROM whatsapp_chats
           WHERE organization_id = :org_id 
             AND session_id = :session_id 
             AND merged_into IS NULL
             AND (jid NOT LIKE '%@lid' OR phone_number IS NOT NULL OR last_message_at IS NOT NULL)"""
    )
    result = await db.execute(sql, {"org_id": organization_id, "session_id": session_id})
    row = result.mappings().first()
    if not row:
        return {"all": 0, "unread": 0, "pinned": 0, "archived": 0}
    return {
        "all": int(row["all_count"] or 0),
        "unread": int(row["unread_count"] or 0),
        "pinned": int(row["pinned_count"] or 0),
        "archived": int(row["archived_count"] or 0),
    }


async def get_chat(
    db: AsyncSession, organization_id: str, session_id: str, chat_id: str
) -> Optional[Dict[str, Any]]:
    """
    Retrieves a single chat by id, resolving tombstones (merged_into) if applicable.
    """
    sql = text(
        """SELECT c.*,
                  l.full_name AS lead_name,
                  l.status AS lead_status,
                  l.company_name AS lead_company,
                  l.email AS lead_email,
                  ct.full_name AS contact_name,
                  ct.company_name AS contact_company,
                  ct.email AS contact_email
           FROM whatsapp_chats c
           LEFT JOIN leads l ON l.id = c.lead_id AND l.organization_id = c.organization_id
           LEFT JOIN contacts ct ON ct.id = c.contact_id AND ct.organization_id = c.organization_id
           WHERE c.id = :chat_id AND c.organization_id = :org_id AND c.session_id = :session_id"""
    )
    result = await db.execute(sql, {"chat_id": chat_id, "org_id": organization_id, "session_id": session_id})
    row = result.mappings().first()
    if not row:
        return None

    row_dict = dict(row)
    if row_dict.get("merged_into"):
        return await get_chat(db, organization_id, session_id, row_dict["merged_into"])

    return row_dict


async def update_chat_flags(
    db: AsyncSession,
    *,
    organization_id: str,
    session_id: str,
    chat_id: str,
    is_pinned: Optional[bool] = None,
    is_archived: Optional[bool] = None,
    is_muted: Optional[bool] = None,
    is_blocked: Optional[bool] = None,
    custom_name: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """
    Updates UI flags or custom name on a chat.
    """
    updates = [f"updated_at = {NOW_UTC}"]
    params: Dict[str, Any] = {
        "chat_id": chat_id,
        "org_id": organization_id,
        "session_id": session_id,
    }

    if is_pinned is not None:
        updates.append("is_pinned = :is_pinned")
        updates.append(f"pinned_at = (CASE WHEN :is_pinned THEN {NOW_UTC} ELSE NULL END)")
        params["is_pinned"] = is_pinned

    if is_archived is not None:
        updates.append("is_archived = :is_archived")
        params["is_archived"] = is_archived

    if is_muted is not None:
        updates.append("is_muted = :is_muted")
        params["is_muted"] = is_muted

    if is_blocked is not None:
        updates.append("is_blocked = :is_blocked")
        params["is_blocked"] = is_blocked

    if custom_name is not None:
        updates.append("custom_name = :custom_name")
        params["custom_name"] = custom_name.strip() or None

    sql = f"""
        UPDATE whatsapp_chats
        SET {', '.join(updates)}
        WHERE id = :chat_id AND organization_id = :org_id AND session_id = :session_id
        RETURNING id
    """
    res = await db.execute(text(sql), params)
    if not res.first():
        return None
    await db.commit()
    return await get_chat(db, organization_id, session_id, chat_id)


async def mark_chat_read(
    db: AsyncSession, organization_id: str, session_id: str, chat_id: str
) -> None:
    """
    Clears unread count and marks inbound messages as READ.
    """
    await db.execute(
        text(
            f"""UPDATE whatsapp_chats
               SET unread_count = 0, updated_at = {NOW_UTC}
               WHERE id = :chat_id AND organization_id = :org_id AND session_id = :session_id"""
        ),
        {"chat_id": chat_id, "org_id": organization_id, "session_id": session_id},
    )
    await db.execute(
        text(
            f"""UPDATE whatsapp_messages
               SET status = 'READ', updated_at = {NOW_UTC}
               WHERE chat_id = :chat_id AND organization_id = :org_id
                 AND (direction = 'INBOUND' OR from_me = FALSE)
                 AND status NOT IN ('READ', 'PLAYED')"""
        ),
        {"chat_id": chat_id, "org_id": organization_id},
    )
    await db.commit()


async def list_messages(
    db: AsyncSession,
    *,
    organization_id: str,
    chat_id: str,
    before_seq: Optional[int] = None,
    limit: int = 50,
) -> List[Dict[str, Any]]:
    """
    Fetches message history for a chat, ordered oldest to newest.
    """
    conditions = [
        "m.organization_id = :org_id",
        "m.chat_id = :chat_id",
    ]
    params: Dict[str, Any] = {
        "org_id": organization_id,
        "chat_id": chat_id,
        "limit": max(1, min(limit, 100)),
    }

    if before_seq is not None:
        conditions.append("m.seq < :before_seq")
        params["before_seq"] = before_seq

    where_clause = " AND ".join(conditions)

    sql = f"""
        SELECT m.id, m.chat_id, m.meta_message_id, m.from_me, m.direction,
               m.message_type, m.message_body, m.caption, m.timestamp, m.created_at,
               m.seq, m.status, m.is_deleted, m.is_edited, m.reaction, m.reactions,
               m.quoted_context, m.quoted_message_id, m.media_id, m.media_status,
               m.mime_type, m.file_name, m.media_size, m.media_duration, m.is_voice_note,
               m.media_error, m.media_url, m.payload, m.source, m.client_ref
        FROM whatsapp_messages m
        WHERE {where_clause}
        ORDER BY m.seq DESC NULLS LAST, m.timestamp DESC
        LIMIT :limit
    """
    result = await db.execute(text(sql), params)
    rows = [dict(r) for r in result.mappings().all()]
    rows.reverse()
    return rows


async def convert_chat_to_lead(
    db: AsyncSession,
    *,
    organization_id: str,
    session_id: str,
    chat_id: str,
    user_id: str,
    user_name: str,
    lead_name: Optional[str] = None,
    company_name: Optional[str] = None,
    email: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Explicitly converts a WhatsApp conversation to a CRM Lead & Contact.
    NEVER triggered automatically.
    """
    chat = await get_chat(db, organization_id, session_id, chat_id)
    if not chat:
        raise ValueError("Chat not found.")

    phone = chat.get("phone_number") or ""
    final_name = (
        lead_name
        or chat.get("custom_name")
        or chat.get("name")
        or chat.get("push_name")
        or phone
        or "WhatsApp Lead"
    ).strip()

    contact_id = chat.get("contact_id")
    lead_id = chat.get("lead_id")

    # 1. Create or link Contact
    if not contact_id:
        contact_id = str(uuid.uuid4())
        await db.execute(
            text(
                f"""INSERT INTO contacts (id, organization_id, full_name, phone, email, company_name,
                                         source, status, lifecycle_stage, assigned_user_id, assigned_user_name,
                                         owner_id, owner_name, created_at, updated_at)
                   VALUES (:id, :org_id, :full_name, :phone, :email, :company, 'WhatsApp', 'QUALIFIED', 'Lead',
                           :uid, :uname, :uid, :uname, {NOW_UTC}, {NOW_UTC})"""
            ),
            {
                "id": contact_id,
                "org_id": organization_id,
                "full_name": final_name,
                "phone": phone,
                "email": email,
                "company": company_name,
                "uid": user_id,
                "uname": user_name,
            },
        )

    # 2. Create or link Lead
    if not lead_id:
        lead_id = str(uuid.uuid4())
        await db.execute(
            text(
                f"""INSERT INTO leads (id, organization_id, full_name, phone, email, company_name,
                                      source, status, assigned_user_id, created_at, updated_at)
                   VALUES (:id, :org_id, :full_name, :phone, :email, :company, 'WHATSAPP', 'NEW',
                           :uid, {NOW_UTC}, {NOW_UTC})"""
            ),
            {
                "id": lead_id,
                "org_id": organization_id,
                "full_name": final_name,
                "phone": phone or "+0000000000",
                "email": email,
                "company": company_name,
                "uid": user_id,
            },
        )

    # 3. Update WhatsApp chat with link pointers
    await db.execute(
        text(
            f"""UPDATE whatsapp_chats
               SET contact_id = :cid, lead_id = :lid, converted_at = {NOW_UTC},
                   converted_by = :uid, updated_at = {NOW_UTC}
               WHERE id = :chat_id AND organization_id = :org_id AND session_id = :session_id"""
        ),
        {
            "cid": contact_id,
            "lid": lead_id,
            "uid": user_id,
            "chat_id": chat_id,
            "org_id": organization_id,
            "session_id": session_id,
        },
    )
    await db.commit()

    updated = await get_chat(db, organization_id, session_id, chat_id)
    return updated or {}


async def purge_legacy_auto_leads(db: AsyncSession, organization_id: str) -> int:
    """
    Cleans up junk records in the CRM contacts table that were auto-created from raw WhatsApp sync
    by previous faulty versions without explicit user conversion.
    Safe: Preserves explicitly converted records referenced by whatsapp_chats.
    """
    res = await db.execute(
        text(
            """DELETE FROM contacts
               WHERE organization_id = :org_id
                 AND (source ILIKE '%whatsapp%' OR full_name LIKE 'WhatsApp Lead%')
                 AND id NOT IN (SELECT contact_id FROM whatsapp_chats WHERE contact_id IS NOT NULL AND organization_id = :org_id)
               RETURNING id"""
        ),
        {"org_id": organization_id},
    )
    deleted_ids = res.scalars().all()
    await db.commit()
    logger.info("Purged %d legacy auto-created WhatsApp contacts for org %s", len(deleted_ids), organization_id)
    return len(deleted_ids)

