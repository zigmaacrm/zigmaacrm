import sys
sys.path.insert(0, 'backend')
import os
import shutil
import asyncio
from app.core.database import AsyncSessionLocal
from sqlalchemy import text

async def wipe_all():
    print("=== STARTING COMPLETE WHATSAPP DATA WIPE (LOCAL) ===")
    async with AsyncSessionLocal() as db:
        # 1. Nullify contact_id foreign keys in referencing tables
        fk_tables = ["deals", "activities", "calendar_events", "invoices", "tasks"]
        for tbl in fk_tables:
            try:
                res = await db.execute(text(f"""
                    UPDATE {tbl} SET contact_id = NULL 
                    WHERE contact_id IN (
                        SELECT id FROM contacts 
                        WHERE source = 'WHATSAPP' 
                           OR (custom_data->>'whatsapp_name') IS NOT NULL
                           OR (custom_data->>'phonebook_name') IS NOT NULL
                           OR (custom_data->>'channel') = 'meta_whatsapp_cloud_api'
                    )
                """))
                print(f"Nullified contact_id on {res.rowcount} {tbl} records.")
            except Exception as e:
                print(f"Note on {tbl}: {e}")

        # 2. Delete all WhatsApp messages
        m_del = await db.execute(text("DELETE FROM whatsapp_messages"))
        print(f"Deleted {m_del.rowcount} records from whatsapp_messages.")

        # 3. Delete all WhatsApp contacts
        c_del = await db.execute(text("""
            DELETE FROM contacts 
            WHERE source = 'WHATSAPP' 
               OR (custom_data->>'whatsapp_name') IS NOT NULL
               OR (custom_data->>'phonebook_name') IS NOT NULL
               OR (custom_data->>'channel') = 'meta_whatsapp_cloud_api'
        """))
        print(f"Deleted {c_del.rowcount} WhatsApp contacts.")

        # 4. Reset whatsapp_phone_number on all users
        u_upd = await db.execute(text("""
            UPDATE users SET whatsapp_phone_number = NULL, whatsapp_phone_number_id = NULL
        """))
        print(f"Reset linked WhatsApp phone on {u_upd.rowcount} users.")

        await db.commit()

    # 5. Clean local uploads/whatsapp directory
    uploads_dir = os.path.join(os.getcwd(), 'uploads', 'whatsapp')
    if os.path.exists(uploads_dir):
        for f in os.listdir(uploads_dir):
            try:
                p = os.path.join(uploads_dir, f)
                if os.path.isfile(p):
                    os.unlink(p)
                elif os.path.isdir(p):
                    shutil.rmtree(p)
            except Exception as e:
                print(f"Failed to remove upload file {f}: {e}")
        print("Cleaned uploads/whatsapp directory.")

    # 6. Clean whatsapp-bridge auth & sessions directory
    bridge_sessions = os.path.join(os.getcwd(), 'whatsapp-bridge', 'sessions')
    bridge_auth = os.path.join(os.getcwd(), 'whatsapp-bridge', 'auth_info_baileys')
    bridge_uploads = os.path.join(os.getcwd(), 'whatsapp-bridge', 'uploads')
    for d in [bridge_sessions, bridge_auth, bridge_uploads]:
        if os.path.exists(d):
            try:
                for f in os.listdir(d):
                    p = os.path.join(d, f)
                    if os.path.isfile(p):
                        os.unlink(p)
                    elif os.path.isdir(p):
                        shutil.rmtree(p)
                print(f"Cleaned {d}")
            except Exception as e:
                print(f"Error cleaning {d}: {e}")

    print("=== LOCAL WHATSAPP DATA WIPE COMPLETED SUCCESSFULLY ===")

if __name__ == '__main__':
    asyncio.run(wipe_all())
