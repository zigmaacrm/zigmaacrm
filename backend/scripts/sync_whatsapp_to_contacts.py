import re
import uuid
from datetime import datetime, timezone
import psycopg2

def normalize_digits(phone: str) -> str:
    return re.sub(r"[^0-9]", "", str(phone or ""))

def format_phone(phone: str) -> str:
    digits = normalize_digits(phone)
    if not digits:
        return ""
    if len(digits) == 12 and digits.startswith("91"):
        return f"+91 {digits[2:7]} {digits[7:]}"
    return f"+{digits}"

def is_valid_name(val: str) -> bool:
    if not val:
        return False
    s = val.strip()
    if not s or "∙" in s or "•" in s or "***" in s:
        return False
    digits_only = re.sub(r"[^0-9]", "", s)
    if digits_only == s:
        return False
    if "@s.whatsapp.net" in s or "@lid" in s or "@g.us" in s:
        return False
    return bool(re.search(r"[a-zA-Z\u0B80-\u0BFF]", s))

def run():
    conn = psycopg2.connect("postgresql://postgres:thoufiq@localhost:5432/zigmaa_crm")
    cur = conn.cursor()
    
    # 1. Clean up test row
    cur.execute("DELETE FROM contacts WHERE phone = '+919999999999'")
    conn.commit()

    org_id = "19c9745c-76a8-4cce-87ce-ae9b5ffd68b4"
    user_id = "c82ff83e-ea06-4a8c-a6a6-91a2313636a5"
    user_name = "Mohamed Thoufiq"

    print(f"[*] Starting WhatsApp contacts sync for org {org_id}...")

    # 2. Fetch all unique chats for session 919600471080 and other org chats
    cur.execute("""
        SELECT DISTINCT ON (phone_number)
            id, phone_number, name, push_name, custom_name, verified_name
        FROM whatsapp_chats
        WHERE organization_id = %s
          AND phone_number IS NOT NULL
          AND length(phone_number) >= 8
        ORDER BY phone_number, (last_message_at IS NOT NULL) DESC, last_message_at DESC NULLS LAST
    """, (org_id,))
    chat_rows = cur.fetchall()
    print(f"[*] Found {len(chat_rows)} unique WhatsApp chats")

    # 3. Fetch message contact_name mapping for backfilling missing names
    cur.execute("""
        SELECT DISTINCT ON (phone_number) phone_number, contact_name
        FROM whatsapp_messages
        WHERE organization_id = %s
          AND contact_name IS NOT NULL
          AND contact_name != ''
          AND contact_name NOT LIKE '%%∙%%'
          AND contact_name NOT LIKE '+%%'
        ORDER BY phone_number, timestamp DESC
    """, (org_id,))
    msg_names = {r[0]: r[1].strip() for r in cur.fetchall() if r[1]}

    # 4. Fetch existing contacts in organization
    cur.execute("SELECT id, phone, full_name FROM contacts WHERE organization_id = %s", (org_id,))
    existing_contacts = {}
    for cid, cphone, cname in cur.fetchall():
        d = normalize_digits(cphone)
        last10 = d[-10:] if len(d) >= 10 else d
        if last10:
            existing_contacts[last10] = (cid, cname)

    inserted = 0
    updated = 0
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    for cid, phone, name, push, custom, verified in chat_rows:
        digits = normalize_digits(phone)
        last10 = digits[-10:] if len(digits) >= 10 else digits
        if not last10:
            continue

        # Determine best display name
        best_name = None
        for cand in (custom, name, push, verified, msg_names.get(phone)):
            if cand and is_valid_name(cand):
                best_name = cand.strip()
                break

        formatted_phone = format_phone(digits)
        if not best_name:
            best_name = formatted_phone

        if last10 in existing_contacts:
            existing_id, existing_name = existing_contacts[last10]
            # Update name if existing name is just a phone number and we now have a real name
            if not is_valid_name(existing_name) and is_valid_name(best_name):
                cur.execute("""
                    UPDATE contacts
                    SET full_name = %s, updated_at = %s
                    WHERE id = %s
                """, (best_name, now, existing_id))
                updated += 1
            contact_rec_id = existing_id
        else:
            # Insert new contact
            new_id = str(uuid.uuid4())
            cur.execute("""
                INSERT INTO contacts (
                    id, organization_id, full_name, phone, source,
                    status, lifecycle_stage, assigned_user_id, assigned_user_name,
                    owner_id, owner_name, created_at, updated_at
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, (
                new_id, org_id, best_name, formatted_phone, "WhatsApp",
                "Active", "Lead", user_id, user_name,
                user_id, user_name, now, now
            ))
            existing_contacts[last10] = (new_id, best_name)
            inserted += 1
            contact_rec_id = new_id

        # Also link whatsapp_chats.contact_id and update chat name if missing or masked
        cur.execute("""
            UPDATE whatsapp_chats
            SET contact_id = %s,
                name = CASE 
                    WHEN (name IS NULL OR name = '' OR name LIKE '%%∙%%' OR name LIKE '+%%') AND %s NOT LIKE '+%%' THEN %s
                    ELSE name
                END
            WHERE organization_id = %s
              AND phone_number IS NOT NULL
              AND (phone_number = %s OR RIGHT(regexp_replace(phone_number, '[^0-9]', '', 'g'), 10) = %s)
        """, (contact_rec_id, best_name, best_name, org_id, digits, last10))

        if (inserted + updated) % 200 == 0:
            conn.commit()

    conn.commit()
    print(f"[*] Sync Complete! Inserted: {inserted}, Updated: {updated}")

    # Check total contacts now
    cur.execute("SELECT count(*) FROM contacts WHERE organization_id = %s", (org_id,))
    total = cur.fetchone()[0]
    print(f"[*] Total contacts in org {org_id}: {total}")
    conn.close()

if __name__ == "__main__":
    run()
