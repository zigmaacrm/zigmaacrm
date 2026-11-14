"""Row -> API JSON. Nothing in here touches the database."""
import datetime
import json
import re
from typing import Any, Dict, Mapping, Optional

from app.services.whatsapp.media import base_mime, signed_media_path

_MEDIA_TYPES = {"image", "video", "gif", "audio", "ptt", "document", "sticker"}


def iso_utc(value: Optional[datetime.datetime]) -> Optional[str]:
    """Columns hold naive UTC; the explicit Z makes browsers convert to local time."""
    if value is None:
        return None
    if value.tzinfo is not None:
        value = value.astimezone(datetime.timezone.utc).replace(tzinfo=None)
    return value.isoformat(timespec="milliseconds") + "Z"


def digits(value: Optional[str]) -> str:
    return re.sub(r"[^0-9]", "", str(value or ""))


def format_phone(phone: Optional[str]) -> Optional[str]:
    clean = digits(phone)
    if not clean:
        return None
    if len(clean) == 12 and clean.startswith("91"):
        return f"+91 {clean[2:7]} {clean[7:]}"
    return f"+{clean}"


def _clean_name(value: Optional[str]) -> Optional[str]:
    name = (value or "").strip()
    return name or None


def is_valid_contact_name(val: Optional[str]) -> bool:
    if not val:
        return False
    s = val.strip()
    if not s:
        return False
    # If it contains masked characters like ∙ or • or ***
    if "∙" in s or "•" in s or "***" in s:
        return False
    # If it is pure digits
    digits_only = re.sub(r"[^0-9]", "", s)
    if digits_only == s:
        return False
    # If it is a phone number format like +91 98401 12345 or +919840112345
    cleaned_symbols = re.sub(r"[\s\+\-\(\)]", "", s)
    if cleaned_symbols.isdigit():
        return False
    # If it looks like a WhatsApp JID or LID
    if "@s.whatsapp.net" in s or "@lid" in s or "@g.us" in s:
        return False
    # It must contain at least one letter or word character (English, Tamil, Hindi, multilingual, etc.)
    if not re.search(r"[a-zA-Z\u0080-\uFFFF]", s):
        return False
    return True


def chat_display_name(row: Mapping[str, Any], own_phone: Optional[str] = None) -> str:
    phone = row.get("phone_number")
    if phone and own_phone and digits(phone) == digits(own_phone):
        return "You (Message yourself)"

    custom_name = _clean_name(row.get("custom_name"))
    if custom_name and is_valid_contact_name(custom_name):
        return custom_name

    contact_name = _clean_name(row.get("contact_name"))
    if contact_name and is_valid_contact_name(contact_name):
        return contact_name

    lead_name = _clean_name(row.get("lead_name"))
    if lead_name and is_valid_contact_name(lead_name):
        return lead_name

    name = _clean_name(row.get("name"))
    if name and is_valid_contact_name(name):
        return name

    msg_contact_name = _clean_name(row.get("msg_contact_name"))
    if msg_contact_name and is_valid_contact_name(msg_contact_name):
        return msg_contact_name

    push_name = _clean_name(row.get("push_name"))
    if push_name and is_valid_contact_name(push_name):
        return push_name

    verified_name = _clean_name(row.get("verified_name"))
    if verified_name and is_valid_contact_name(verified_name):
        return verified_name

    valid_candidates = [
        c for c in (custom_name, contact_name, lead_name, name, msg_contact_name, push_name, verified_name)
        if c and not ("∙" in c or "•" in c or "***" in c)
    ]
    if valid_candidates:
        return valid_candidates[0]

    return format_phone(phone) or (f"+{phone}" if phone else None) or "WhatsApp user"


def message_preview(message_type: Optional[str], text: Optional[str], file_name: Optional[str] = None) -> str:
    """One-line summary used in the chat list, in the style of WhatsApp Web."""
    kind = (message_type or "text").lower()
    body = re.sub(r"\s+", " ", (text or "")).strip()
    if kind == "revoked":
        return "This message was deleted"
    if kind == "image":
        return f"📷 {body or 'Photo'}"
    if kind == "video":
        return f"🎥 {body or 'Video'}"
    if kind == "gif":
        return f"GIF {body}".strip()
    if kind in ("ptt",):
        return "🎤 Voice message"
    if kind == "audio":
        return "🎵 Audio"
    if kind == "document":
        return f"📄 {body or file_name or 'Document'}"
    if kind == "sticker":
        return "Sticker"
    if kind == "contact":
        return f"👤 {body or 'Contact'}"
    if kind == "location":
        return f"📍 {body or 'Location'}"
    if kind == "poll":
        return f"📊 {body or 'Poll'}"
    if kind == "view_once":
        return "View once message"
    if kind == "ciphertext":
        return "Waiting for this message…"
    if kind == "unsupported":
        return "Unsupported message"
    # legacy rows stored quoted replies as "> *Sender*: quoted\n\nreply"
    if body.startswith(">"):
        legacy = re.match(r"^>\s*\*?[^*:]+\*?:\s*.*?\s{2,}(.*)$", (text or "").replace("\n", "  "))
        if legacy and legacy.group(1).strip():
            return legacy.group(1).strip()
    return body


def serialize_chat(row: Mapping[str, Any], own_phone: Optional[str] = None) -> Dict[str, Any]:
    lead_ok = bool(row.get("lead_id") or row.get("lead_name"))
    contact_ok = bool(row.get("contact_id") or row.get("contact_name"))
    phone = row.get("phone_number")
    if not phone and row.get("jid"):
        clean_jid = str(row.get("jid")).split("@")[0]
        if clean_jid.isdigit() and len(clean_jid) >= 7 and len(clean_jid) <= 15:
            phone = clean_jid
    display_phone_val = format_phone(phone) or (f"+{phone}" if phone else None)
    return {
        "id": row["id"],
        "phone_number": phone,
        "phone": display_phone_val or phone,
        "display_phone": display_phone_val,
        "address_type": "phone" if phone else "lid",
        "name": chat_display_name(row, own_phone),
        "saved_name": _clean_name(row.get("name")),
        "push_name": _clean_name(row.get("push_name")),
        "custom_name": _clean_name(row.get("custom_name")),
        "is_self": bool(phone and own_phone and digits(phone) == digits(own_phone)),
        "avatar_url": row.get("avatar_url"),
        "avatar_fetched_at": iso_utc(row.get("avatar_fetched_at")),
        "last_message": {
            "id": row.get("last_message_id"),
            "preview": message_preview(row.get("last_message_type"), row.get("last_message_preview")),
            "type": row.get("last_message_type") or "text",
            "at": iso_utc(row.get("last_message_at")),
            "from_me": bool(row.get("last_message_from_me")),
            "status": row.get("last_message_status"),
        }
        if row.get("last_message_at") is not None
        else None,
        "sort_at": iso_utc(row.get("last_message_at") or row.get("created_at")),
        "unread_count": int(row.get("unread_count") or 0),
        "is_pinned": bool(row.get("is_pinned")),
        "is_archived": bool(row.get("is_archived")),
        "is_muted": bool(row.get("is_muted")),
        "is_blocked": bool(row.get("is_blocked")),
        "merged_into": row.get("merged_into"),
        "contact_id": row.get("contact_id") if contact_ok else None,
        "lead_id": row.get("lead_id") if lead_ok else None,
        "contact_name": chat_display_name(row, own_phone),
        "last_message_text": message_preview(row.get("last_message_type"), row.get("last_message_preview")),
        "last_message_time": iso_utc(row.get("last_message_at")),
        "last_direction": "OUTBOUND" if row.get("last_message_from_me") else "INBOUND",
        "last_status": row.get("last_message_status"),
        "company_name": (row.get("lead_company") if lead_ok else None) or (row.get("contact_company") if contact_ok else None),
        "email": (row.get("lead_email") if lead_ok else None) or (row.get("contact_email") if contact_ok else None),
        "crm": {
            "lead_id": row.get("lead_id") if lead_ok else None,
            "lead_name": row.get("lead_name") if lead_ok else None,
            "lead_status": row.get("lead_status") if lead_ok else None,
            "contact_id": row.get("contact_id") if contact_ok else None,
            "contact_name": row.get("contact_name") if contact_ok else None,
            "company_name": (row.get("lead_company") if lead_ok else None) or (row.get("contact_company") if contact_ok else None),
            "email": (row.get("lead_email") if lead_ok else None) or (row.get("contact_email") if contact_ok else None),
            "converted_at": iso_utc(row.get("converted_at")),
        },
        "updated_at": iso_utc(row.get("updated_at")),
    }


def _parse_json(value: Optional[str]) -> Any:
    if not value:
        return None
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return None


def _quoted(row: Mapping[str, Any]) -> Optional[Dict[str, Any]]:
    raw = row.get("quoted_context")
    if not raw:
        return None
    parsed = _parse_json(raw) if str(raw).lstrip().startswith("{") else None
    if isinstance(parsed, dict):
        return {
            "id": parsed.get("id") or row.get("quoted_message_id"),
            "from_me": parsed.get("from_me"),
            # legacy rows only stored a display name for the quoted sender
            "sender": parsed.get("sender"),
            "type": parsed.get("type") or "text",
            "text": parsed.get("text") or "",
        }
    return {"id": row.get("quoted_message_id"), "from_me": None, "sender": None, "type": "text", "text": str(raw)}


def _media(row: Mapping[str, Any], organization_id: str) -> Optional[Dict[str, Any]]:
    status = row.get("media_status") or "none"
    kind = (row.get("message_type") or "text").lower()
    if status == "none" and kind not in _MEDIA_TYPES:
        return None
    if status == "none":
        status = "unavailable"

    url = None
    if status == "ready" and row.get("media_id"):
        url = signed_media_path("m", row["media_id"], organization_id)
    elif status == "legacy":
        url = signed_media_path("l", row["id"], organization_id)
    elif row.get("id"):
        # For remote, pending, or ready rows where media_id was not explicitly joined:
        # Generate a signed path for this message so the backend streams or downloads it!
        if row.get("media_id"):
            url = signed_media_path("m", row["media_id"], organization_id)
        else:
            url = signed_media_path("msg", row["id"], organization_id)

    mime = row.get("mime_type")
    return {
        "status": status,
        "url": url,
        "mime_type": mime,
        "base_mime": base_mime(mime) if mime else None,
        "file_name": row.get("file_name"),
        "size": row.get("media_size"),
        "duration": row.get("media_duration"),
        "is_voice_note": bool(row.get("is_voice_note")) or kind in ("ptt", "audio"),
        "error": row.get("media_error"),
    }


def serialize_message(row: Mapping[str, Any], organization_id: str) -> Dict[str, Any]:
    from_me = row.get("from_me")
    if from_me is None:
        from_me = (row.get("direction") or "").upper() == "OUTBOUND"
    deleted = bool(row.get("is_deleted"))
    kind = "revoked" if deleted else (row.get("message_type") or "text")
    reactions = _parse_json(row.get("reactions"))
    media_obj = None if deleted else _media(row, organization_id)
    text_content = "" if deleted else (row.get("message_body") or "")
    time_iso = iso_utc(row.get("timestamp") or row.get("created_at"))
    wa_id = row.get("meta_message_id")
    quoted_obj = None if deleted else _quoted(row)
    return {
        "id": row["id"],
        "chat_id": row.get("chat_id"),
        "wa_message_id": wa_id,
        "meta_message_id": wa_id,
        "from_me": bool(from_me),
        "direction": "OUTBOUND" if from_me else "INBOUND",
        "type": kind,
        "message_type": kind,
        "text": text_content,
        "message_body": text_content,
        "caption": None if deleted else row.get("caption"),
        "timestamp": time_iso,
        "created_at": time_iso,
        "seq": row.get("seq"),
        "status": row.get("status"),
        "is_deleted": deleted,
        "is_edited": bool(row.get("is_edited")),
        "reaction": None if deleted else row.get("reaction"),
        "my_reaction": (reactions or {}).get("me") if isinstance(reactions, dict) and not deleted else None,
        "quoted": quoted_obj,
        "quoted_context": quoted_obj,
        "media": media_obj,
        "media_url": (media_obj.get("url") if media_obj else None) or row.get("media_url"),
        "file_name": (media_obj.get("file_name") if media_obj else None) or row.get("file_name"),
        "is_voice_note": bool((media_obj.get("is_voice_note") if media_obj else None) or row.get("is_voice_note")),
        "payload": None if deleted else _parse_json(row.get("payload")),
        "source": row.get("source"),
        "client_ref": row.get("client_ref"),
    }


def serialize_session(row: Optional[Mapping[str, Any]], *, gateway_online: Optional[bool] = None, stale: bool = False) -> Dict[str, Any]:
    if row is None:
        return {
            "status": "NOT_LINKED",
            "linked": False,
            "phone": None,
            "session_id": None,
            "name": None,
            "avatar_url": None,
            "qr": None,
            "qr_code": None,
            "qr_expires_at": None,
            "gateway_online": gateway_online,
            "last_disconnect": None,
            "history_sync": None,
        }
    status = row.get("status") or "DISCONNECTED"
    raw_phone = row.get("phone_number")
    clean_phone_digits = digits(raw_phone) if raw_phone else None

    # If phone_number is not populated in the column, attempt to extract it from creds.me.id
    if not clean_phone_digits and row.get("creds"):
        try:
            creds_data = json.loads(row["creds"]) if isinstance(row["creds"], str) else row["creds"]
            me_id = (creds_data.get("me") or {}).get("id") or ""
            clean_phone_digits = digits(me_id.split("@")[0]) if me_id else None
            if clean_phone_digits:
                raw_phone = clean_phone_digits
        except Exception:
            pass

    linked = (status == "CONNECTED") and bool(clean_phone_digits)
    if status == "CONNECTED":
        show_qr = False
        qr_val = None
    elif not linked:
        show_qr = bool(row.get("qr"))
        status = "SCAN_QR" if show_qr else ("NOT_LINKED" if status in ("DISCONNECTED", "NOT_LINKED", "LOGGED_OUT") else status)
        qr_val = row.get("qr") if show_qr else None
    else:
        if stale and status in ("CONNECTED", "CONNECTING"):
            status = "CONNECTING"
        show_qr = bool(row.get("qr")) and not linked
        qr_val = row.get("qr") if show_qr else None

    last = None
    if row.get("last_disconnect_at") is not None and status != "CONNECTED":
        last = {
            "code": row.get("last_disconnect_code"),
            "reason": row.get("last_disconnect_reason"),
            "at": iso_utc(row.get("last_disconnect_at")),
        }

    return {
        "status": status,
        "linked": linked,
        "phone": (format_phone(raw_phone) or format_phone(clean_phone_digits)) if linked else None,
        "session_id": clean_phone_digits if linked else None,
        "name": row.get("push_name") if linked else None,
        "avatar_url": row.get("avatar_url") if linked else None,
        "qr": qr_val,
        "qr_code": qr_val,
        "qr_expires_at": iso_utc(row.get("qr_expires_at")) if show_qr else None,
        "gateway_online": (not stale) if gateway_online is None else gateway_online,
        "last_disconnect": last,
        "history_sync": {"status": row.get("history_sync_status"), "progress": row.get("history_sync_progress")}
        if row.get("history_sync_status")
        else None,
    }
