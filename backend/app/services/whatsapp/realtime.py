"""
Server-Sent Events (SSE) realtime feed for WhatsApp.
Enables instantaneous chat & message synchronization across all open browser tabs and devices.
"""
import asyncio
import json
import logging
import time
from typing import AsyncGenerator, Dict, Optional, Set

from fastapi import Request
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.whatsapp.repository import (
    get_chat_counts,
    get_user_session,
    list_chats,
)
from app.services.whatsapp.serializers import (
    serialize_chat,
    serialize_message,
    serialize_session,
)

logger = logging.getLogger("zigmaa.whatsapp.realtime")


class RealtimeHub:
    """
    Lightweight in-memory notification hub.
    When the Node bridge or internal actions push updates, the hub wakes up
    active SSE listeners for that session immediately without waiting for poll timeouts.
    """

    def __init__(self):
        self._listeners: Dict[str, Set[asyncio.Event]] = {}

    def subscribe(self, session_key: str) -> asyncio.Event:
        ev = asyncio.Event()
        if session_key not in self._listeners:
            self._listeners[session_key] = set()
        self._listeners[session_key].add(ev)
        return ev

    def unsubscribe(self, session_key: str, ev: asyncio.Event) -> None:
        if session_key in self._listeners:
            self._listeners[session_key].discard(ev)
            if not self._listeners[session_key]:
                del self._listeners[session_key]

    def notify(self, session_key: str) -> None:
        events = self._listeners.get(session_key)
        if events:
            for ev in list(events):
                ev.set()


hub = RealtimeHub()


async def stream_whatsapp_events(
    request: Request,
    db_factory,
    organization_id: str,
    user_id: str,
) -> AsyncGenerator[str, None]:
    """
    Yields SSE formatted strings for WhatsApp updates:
    - session (connection state, QR changes, device info)
    - counts (unread, pinned, total chat badges)
    - chat_update (last message, preview, unread status)
    - message (new incoming or outgoing messages)
    - ping (keep-alive)
    """
    last_session_status: Optional[str] = None
    last_qr: Optional[str] = None
    last_phone: Optional[str] = None
    last_msg_seq: int = 0

    # Initialize last_msg_seq to current max
    async with db_factory() as db:
        res = await db.execute(text("SELECT COALESCE(MAX(seq), 0) FROM whatsapp_messages WHERE organization_id = :org"), {"org": organization_id})
        last_msg_seq = int(res.scalar() or 0)

    # We listen on both user_id and session_id (phone) keys
    user_key = f"wa_{user_id.replace('-', '')[:24]}"
    ev_user = hub.subscribe(user_key)
    ev_phone = None
    active_phone: Optional[str] = None

    try:
        while not await request.is_disconnected():
            async with db_factory() as db:
                session_row, is_stale = await get_user_session(db, organization_id, user_id)
                current_phone = session_row.get("phone_number") if session_row else None

                # If phone number appeared or changed, subscribe to phone-scoped notifications as well
                if current_phone and current_phone != active_phone:
                    if ev_phone and active_phone:
                        hub.unsubscribe(active_phone, ev_phone)
                    active_phone = current_phone
                    ev_phone = hub.subscribe(active_phone)

                # 1. Emit Session State Update if changed
                cur_status = session_row.get("status") if session_row else "NOT_LINKED"
                cur_qr = session_row.get("qr") if session_row else None
                if (
                    cur_status != last_session_status
                    or cur_qr != last_qr
                    or current_phone != last_phone
                    or last_session_status is None
                ):
                    session_payload = serialize_session(session_row, stale=is_stale)
                    yield f"event: session\ndata: {json.dumps(session_payload)}\n\n"
                    last_session_status = cur_status
                    last_qr = cur_qr
                    last_phone = current_phone

                # 2. If connected, emit updated counts and new messages
                if current_phone:
                    counts = await get_chat_counts(db, organization_id, current_phone)
                    yield f"event: counts\ndata: {json.dumps(counts)}\n\n"

                    # Fetch any new messages since last sequence
                    msg_res = await db.execute(
                        text(
                            """SELECT m.id, m.chat_id, m.meta_message_id, m.from_me, m.direction,
                                      m.message_type, m.message_body, m.caption, m.timestamp, m.created_at,
                                      m.seq, m.status, m.is_deleted, m.is_edited, m.reaction, m.reactions,
                                      m.quoted_context, m.quoted_message_id, m.media_id, m.media_status,
                                      m.mime_type, m.file_name, m.media_size, m.media_duration, m.is_voice_note,
                                      m.media_error, m.media_url, m.payload, m.source, m.client_ref
                               FROM whatsapp_messages m
                               WHERE m.organization_id = :org AND m.session_id = :sid AND m.seq > :seq
                               ORDER BY m.seq ASC
                               LIMIT 30"""
                        ),
                        {"org": organization_id, "sid": current_phone, "seq": last_msg_seq},
                    )
                    new_msgs = [dict(r) for r in msg_res.mappings().all()]
                    for m in new_msgs:
                        if m.get("seq") and m["seq"] > last_msg_seq:
                            last_msg_seq = m["seq"]
                        msg_data = serialize_message(m, organization_id)
                        yield f"event: message\ndata: {json.dumps(msg_data)}\n\n"

            # 3. Wait for hub signal or fallback 3-second heartbeat
            ev_user.clear()
            if ev_phone:
                ev_phone.clear()

            tasks = [asyncio.create_task(ev_user.wait())]
            if ev_phone:
                tasks.append(asyncio.create_task(ev_phone.wait()))

            done, pending = await asyncio.wait(
                tasks, timeout=3.0, return_when=asyncio.FIRST_COMPLETED
            )
            for t in pending:
                t.cancel()

            # Keep alive SSE ping
            yield ": ping\n\n"

    except asyncio.CancelledError:
        pass
    finally:
        hub.unsubscribe(user_key, ev_user)
        if ev_phone and active_phone:
            hub.unsubscribe(active_phone, ev_phone)

