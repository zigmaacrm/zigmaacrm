import sys
sys.path.insert(0, 'backend')
import pytest
import asyncio
from app.core.database import AsyncSessionLocal
from app.services.whatsapp import repository
from sqlalchemy import text

@pytest.mark.asyncio
async def test_repository_normalization_and_unlink():
    async with AsyncSessionLocal() as db:
        # 1. Test chat list with raw and with formatted phone
        chats_raw = await repository.list_chats(db, organization_id="19c9745c-76a8-4cce-87ce-ae9b5ffd68b4", session_id="919600471080", limit=10)
        chats_plus = await repository.list_chats(db, organization_id="19c9745c-76a8-4cce-87ce-ae9b5ffd68b4", session_id="+919600471080", limit=10)
        print(f"Raw count: {len(chats_raw)}, Plus count: {len(chats_plus)}")
        assert len(chats_raw) > 0
        assert len(chats_raw) == len(chats_plus)

        # 2. Test chat counts with raw and formatted phone
        counts_raw = await repository.get_chat_counts(db, "19c9745c-76a8-4cce-87ce-ae9b5ffd68b4", "919600471080")
        counts_plus = await repository.get_chat_counts(db, "19c9745c-76a8-4cce-87ce-ae9b5ffd68b4", "+919600471080")
        print(f"Raw counts: {counts_raw}, Plus counts: {counts_plus}")
        assert counts_raw["all"] > 0
        assert counts_raw["all"] == counts_plus["all"]

        # 3. Test unlink on a dummy test user
        dummy_user_id = "00000000-0000-0000-0000-000000000099"
        dummy_org_id = "19c9745c-76a8-4cce-87ce-ae9b5ffd68b4"
        await repository.ensure_user_session(db, dummy_org_id, dummy_user_id)
        await repository.unlink_user_session(db, dummy_org_id, dummy_user_id)
        sess, _ = await repository.get_user_session(db, dummy_org_id, dummy_user_id)
        assert sess is not None
        assert sess["status"] == "NOT_LINKED"
        assert sess["phone_number"] is None
        # Clean up dummy test row
        await db.execute(text("DELETE FROM whatsapp_sessions WHERE user_id = :uid"), {"uid": dummy_user_id})
        await db.commit()

