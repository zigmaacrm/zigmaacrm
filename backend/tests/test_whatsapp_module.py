"""
Unit tests for the WhatsApp Suite backend module.
Asserts schema synchronization, serializers, media HMAC signing, and schema parser.
"""
import hashlib
from pathlib import Path

import pytest

from app.services.whatsapp.media import (
    base_mime,
    extension_for,
    safe_filename,
    signed_media_path,
    verify_signature,
)
from app.services.whatsapp.schema import parse_schema, read_schema
from app.services.whatsapp.serializers import (
    chat_display_name,
    message_preview,
    serialize_chat,
    serialize_message,
    serialize_session,
)


def test_schema_files_are_byte_identical():
    """whatsapp-bridge/schema.sql and backend/app/services/whatsapp/schema.sql must stay identical."""
    backend_schema = Path(__file__).resolve().parent.parent / "app" / "services" / "whatsapp" / "schema.sql"
    bridge_schema = Path(__file__).resolve().parent.parent.parent / "whatsapp-bridge" / "schema.sql"

    assert backend_schema.exists(), f"Backend schema missing at {backend_schema}"
    assert bridge_schema.exists(), f"Bridge schema missing at {bridge_schema}"

    backend_bytes = backend_schema.read_bytes()
    bridge_bytes = bridge_schema.read_bytes()

    assert (
        backend_bytes == bridge_bytes
    ), "schema.sql in whatsapp-bridge and backend/app/services/whatsapp have diverged!"


def test_schema_parser():
    sample = """
    -- Simple comment
    CREATE TABLE test_table (id INT);

    -- @requires users, organizations
    -- @once migration_step_1
    ALTER TABLE test_table ADD COLUMN name TEXT;
    """
    stmts = parse_schema(sample)
    assert len(stmts) == 2
    assert stmts[0].sql == "CREATE TABLE test_table (id INT)"
    assert stmts[0].requires == []
    assert stmts[0].once is None

    assert stmts[1].sql == "ALTER TABLE test_table ADD COLUMN name TEXT"
    assert stmts[1].requires == ["users", "organizations"]
    assert stmts[1].once == "migration_step_1"


def test_chat_display_name():
    assert chat_display_name({"custom_name": "VIP Client", "name": "John Doe"}) == "VIP Client"
    assert chat_display_name({"name": "John Doe", "push_name": "JD"}) == "John Doe"
    assert chat_display_name({"phone_number": "919876543210"}) == "+91 98765 43210"
    assert chat_display_name({"phone_number": "919876543210"}, own_phone="919876543210") == "You (Message yourself)"


def test_message_preview():
    assert message_preview("text", "Hello there") == "Hello there"
    assert message_preview("image", "Check this out") == "📷 Check this out"
    assert message_preview("image", "") == "📷 Photo"
    assert message_preview("ptt", "") == "🎤 Voice message"
    assert message_preview("document", "", file_name="invoice.pdf") == "📄 invoice.pdf"
    assert message_preview("sticker", "") == "Sticker"
    assert message_preview("revoked", "deleted text") == "This message was deleted"


def test_media_hmac_signing():
    org_id = "org-test-123"
    ident = "media-uuid-456"
    now = 1700000000.0

    url = signed_media_path("m", ident, org_id, now=now)
    assert "/api/v1/whatsapp/media/m/media-uuid-456?" in url

    # Parse query params
    from urllib.parse import parse_qs, urlparse
    parsed = urlparse(url)
    qs = parse_qs(parsed.query)

    assert qs["o"][0] == org_id
    expires = qs["e"][0]
    sig = qs["s"][0]

    # Valid signature check
    assert verify_signature("m", ident, org_id, expires, sig, now=now) is True

    # Tampered org check
    assert verify_signature("m", ident, "different-org", expires, sig, now=now) is False

    # Tampered signature check
    assert verify_signature("m", ident, org_id, expires, "bad-signature", now=now) is False

    # Expired timestamp check
    assert verify_signature("m", ident, org_id, expires, sig, now=now + 1000000) is False


def test_safe_filename():
    assert safe_filename("my report / file * name?.pdf") == "my report _ file _ name_.pdf"
    assert safe_filename("") == "file"
    assert extension_for("image/jpeg", "photo.jpg") == "jpg"
    assert extension_for("audio/ogg", None) == "ogg"

