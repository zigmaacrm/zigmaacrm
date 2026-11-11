-- ============================================================================
-- Zigmaa CRM · WhatsApp module schema
--
-- This file exists twice and both copies must stay byte-identical:
--     whatsapp-bridge/schema.sql
--     backend/app/services/whatsapp/schema.sql
-- (backend/tests/test_whatsapp_module.py asserts that they match.)
--
-- Both the Node bridge and every FastAPI worker run it at boot, inside one
-- transaction that holds an advisory lock, so the services can start in any
-- order. Every statement is idempotent.
--
-- Runner rules (implemented in whatsapp-bridge/src/db.js and
-- backend/app/services/whatsapp/schema.py):
--   * statements end with a semicolon at the end of a line
--   * "-- @requires a, b"  -> skip the next statement unless those tables exist
--   * "-- @once name"      -> run the next statement a single time, ever
--                             (recorded in whatsapp_schema_meta)
--
-- All timestamps are naive UTC (TIMESTAMP WITHOUT TIME ZONE), matching the
-- rest of the CRM schema.
-- ============================================================================

CREATE TABLE IF NOT EXISTS whatsapp_schema_meta (
    name VARCHAR(100) PRIMARY KEY,
    applied_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT timezone('utc', clock_timestamp())
);

-- ----------------------------------------------------------------------------
-- 1. Linked-device sessions: one row per CRM user (organization_id + user_id).
--    Holds the Baileys credentials, so a restart never logs anybody out.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS whatsapp_sessions (
    id VARCHAR(64) PRIMARY KEY,
    organization_id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    phone_number VARCHAR(32),
    lid VARCHAR(64),
    push_name VARCHAR(255),
    platform VARCHAR(64),
    avatar_url TEXT,
    status VARCHAR(32) NOT NULL DEFAULT 'DISCONNECTED',
    desired_state VARCHAR(16) NOT NULL DEFAULT 'stopped',
    qr TEXT,
    qr_expires_at TIMESTAMP WITHOUT TIME ZONE,
    creds TEXT,
    owner_instance VARCHAR(96),
    heartbeat_at TIMESTAMP WITHOUT TIME ZONE,
    last_connected_at TIMESTAMP WITHOUT TIME ZONE,
    last_disconnect_code INTEGER,
    last_disconnect_reason VARCHAR(255),
    last_disconnect_at TIMESTAMP WITHOUT TIME ZONE,
    history_sync_status VARCHAR(32),
    history_sync_progress INTEGER,
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT timezone('utc', clock_timestamp()),
    updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT timezone('utc', clock_timestamp())
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_wa_sessions_org_user ON whatsapp_sessions (organization_id, user_id);

-- ----------------------------------------------------------------------------
-- 2. Signal key store (pre-keys, sessions, app-state keys, LID mappings ...).
--    Written on every ratchet step; this is what keeps decryption working
--    across restarts.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS whatsapp_session_keys (
    session_id VARCHAR(64) NOT NULL,
    key_type VARCHAR(40) NOT NULL,
    key_id TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT timezone('utc', clock_timestamp()),
    PRIMARY KEY (session_id, key_type, key_id)
);

-- ----------------------------------------------------------------------------
-- 3. Chats. Scoped by organization_id + session_id, where session_id is the
--    connected phone number (digits). Never joined into contacts / leads
--    unless a user explicitly converts the chat.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS whatsapp_chats (
    id VARCHAR(36) PRIMARY KEY,
    organization_id VARCHAR(36) NOT NULL,
    session_id VARCHAR(64) NOT NULL,
    jid VARCHAR(128) NOT NULL,
    phone_number VARCHAR(32),
    lid VARCHAR(64),
    name VARCHAR(255),
    push_name VARCHAR(255),
    verified_name VARCHAR(255),
    custom_name VARCHAR(255),
    avatar_url TEXT,
    avatar_fetched_at TIMESTAMP WITHOUT TIME ZONE,
    last_message_id VARCHAR(255),
    last_message_preview TEXT,
    last_message_type VARCHAR(32),
    last_message_at TIMESTAMP WITHOUT TIME ZONE,
    last_message_from_me BOOLEAN,
    last_message_status VARCHAR(16),
    unread_count INTEGER NOT NULL DEFAULT 0,
    is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
    pinned_at TIMESTAMP WITHOUT TIME ZONE,
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    is_muted BOOLEAN NOT NULL DEFAULT FALSE,
    is_blocked BOOLEAN NOT NULL DEFAULT FALSE,
    contact_id VARCHAR(36),
    lead_id VARCHAR(36),
    converted_at TIMESTAMP WITHOUT TIME ZONE,
    converted_by VARCHAR(36),
    merged_into VARCHAR(36),
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT timezone('utc', clock_timestamp()),
    updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT timezone('utc', clock_timestamp())
);

-- merged_into: WhatsApp can address the same person by phone number or by LID.
-- When both turn out to be one contact the LID row is folded into the phone
-- row and kept as a tombstone, so open clients can follow the redirect.
ALTER TABLE whatsapp_chats ADD COLUMN IF NOT EXISTS merged_into VARCHAR(36);

CREATE UNIQUE INDEX IF NOT EXISTS uq_wa_chats_scope_jid ON whatsapp_chats (organization_id, session_id, jid);
CREATE INDEX IF NOT EXISTS idx_wa_chats_list ON whatsapp_chats (organization_id, session_id, last_message_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_wa_chats_phone ON whatsapp_chats (organization_id, session_id, phone_number);
CREATE INDEX IF NOT EXISTS idx_wa_chats_lid ON whatsapp_chats (organization_id, session_id, lid);
CREATE INDEX IF NOT EXISTS idx_wa_chats_feed ON whatsapp_chats (organization_id, session_id, updated_at);

-- ----------------------------------------------------------------------------
-- 4. Media blobs. storage = 'db' keeps the bytes here (survives redeploys with
--    no extra infrastructure); storage = 's3' keeps only the object key.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS whatsapp_media (
    id VARCHAR(36) PRIMARY KEY,
    organization_id VARCHAR(36) NOT NULL,
    session_id VARCHAR(64) NOT NULL,
    storage VARCHAR(16) NOT NULL DEFAULT 'db',
    storage_key TEXT,
    data BYTEA,
    mime_type VARCHAR(127),
    file_name VARCHAR(255),
    size_bytes BIGINT,
    sha256 VARCHAR(64),
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT timezone('utc', clock_timestamp())
);

-- Media is already compressed; EXTERNAL skips TOAST compression so byte-range
-- reads (audio / video seeking) do not have to inflate the whole value.
ALTER TABLE whatsapp_media ALTER COLUMN data SET STORAGE EXTERNAL;

CREATE INDEX IF NOT EXISTS idx_wa_media_scope ON whatsapp_media (organization_id, session_id);

-- ----------------------------------------------------------------------------
-- 5. Messages. The table predates this module, so it is created with the
--    legacy columns and then extended in place.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS whatsapp_messages (
    id VARCHAR(36) PRIMARY KEY,
    organization_id VARCHAR(36),
    contact_id VARCHAR(36),
    contact_name VARCHAR(255),
    assigned_user_id VARCHAR(36),
    business_phone_number_id VARCHAR(100),
    phone_number VARCHAR(50),
    direction VARCHAR(20) DEFAULT 'INBOUND',
    message_body TEXT NOT NULL DEFAULT '',
    message_type VARCHAR(50) DEFAULT 'text',
    media_url VARCHAR(500),
    media_base64 TEXT,
    file_name VARCHAR(255),
    caption TEXT,
    is_voice_note BOOLEAN DEFAULT FALSE,
    meta_message_id VARCHAR(255),
    status VARCHAR(50) DEFAULT 'SENT',
    timestamp TIMESTAMP WITHOUT TIME ZONE,
    reaction VARCHAR(50),
    is_deleted BOOLEAN DEFAULT FALSE,
    session_id VARCHAR(100),
    quoted_context TEXT,
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT timezone('utc', clock_timestamp()),
    updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT timezone('utc', clock_timestamp())
);

CREATE SEQUENCE IF NOT EXISTS whatsapp_message_seq;

ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS chat_id VARCHAR(36);
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS remote_jid VARCHAR(128);
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS from_me BOOLEAN;
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS seq BIGINT;
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS mime_type VARCHAR(127);
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS media_id VARCHAR(36);
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS media_status VARCHAR(16);
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS media_size BIGINT;
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS media_duration INTEGER;
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS media_error VARCHAR(255);
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS quoted_message_id VARCHAR(255);
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS payload TEXT;
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS raw_message BYTEA;
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS reactions TEXT;
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS is_edited BOOLEAN DEFAULT FALSE;
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS source VARCHAR(16);
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS sender_user_id VARCHAR(36);
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS client_ref VARCHAR(64);
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS feed_at TIMESTAMP WITHOUT TIME ZONE;

-- A chat that is still only known by its LID has no phone number yet.
ALTER TABLE whatsapp_messages ALTER COLUMN phone_number DROP NOT NULL;
ALTER TABLE whatsapp_messages ALTER COLUMN message_body SET DEFAULT '';
ALTER TABLE whatsapp_messages ALTER COLUMN created_at SET DEFAULT timezone('utc', clock_timestamp());
ALTER TABLE whatsapp_messages ALTER COLUMN updated_at SET DEFAULT timezone('utc', clock_timestamp());
ALTER TABLE whatsapp_messages ALTER COLUMN seq SET DEFAULT nextval('whatsapp_message_seq');

-- ----------------------------------------------------------------------------
-- 6. One-time repair + migration of rows written by the previous integration.
-- ----------------------------------------------------------------------------

-- @once legacy_timestamp_backfill
UPDATE whatsapp_messages SET timestamp = created_at WHERE timestamp IS NULL;

-- The old live-message webhook filed every message under the first
-- organization in the table. Re-attribute each row to the organization of the
-- user whose device received it.
-- @requires users
-- @once legacy_org_reattribution
UPDATE whatsapp_messages m
SET organization_id = u.organization_id
FROM users u
WHERE m.assigned_user_id = u.id
  AND m.session_id IS NOT NULL
  AND m.organization_id IS DISTINCT FROM u.organization_id;

-- The old ingest path was check-then-insert, so the same WhatsApp message could
-- be stored twice. Keep one copy (preferring the one that carries media).
-- @once legacy_duplicate_cleanup
DELETE FROM whatsapp_messages
WHERE id IN (
    SELECT id FROM (
        SELECT id,
               row_number() OVER (
                   PARTITION BY organization_id, session_id, meta_message_id
                   ORDER BY (media_url IS NOT NULL OR media_base64 IS NOT NULL) DESC, created_at ASC, id ASC
               ) AS rn
        FROM whatsapp_messages
        WHERE organization_id IS NOT NULL AND session_id IS NOT NULL AND meta_message_id IS NOT NULL
    ) ranked
    WHERE rn > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_wa_messages_scope_waid ON whatsapp_messages (organization_id, session_id, meta_message_id);

-- @once legacy_chats_from_messages
INSERT INTO whatsapp_chats (id, organization_id, session_id, jid, phone_number, name, created_at, updated_at)
SELECT gen_random_uuid()::text,
       g.organization_id,
       g.session_id,
       g.phone_number || '@s.whatsapp.net',
       g.phone_number,
       g.contact_name,
       timezone('utc', clock_timestamp()),
       timezone('utc', clock_timestamp())
FROM (
    SELECT organization_id,
           session_id,
           phone_number,
           max(contact_name) FILTER (WHERE contact_name !~ '^[+0-9 ()-]+$') AS contact_name
    FROM whatsapp_messages
    WHERE chat_id IS NULL
      AND organization_id IS NOT NULL
      AND session_id ~ '^[0-9]{8,15}$'
      AND phone_number ~ '^[0-9]{8,15}$'
    GROUP BY organization_id, session_id, phone_number
) g
ON CONFLICT (organization_id, session_id, jid) DO NOTHING;

-- @once legacy_link_messages_to_chats
UPDATE whatsapp_messages m
SET chat_id = c.id,
    from_me = (m.direction = 'OUTBOUND'),
    remote_jid = c.jid,
    source = COALESCE(m.source, 'legacy')
FROM whatsapp_chats c
WHERE m.chat_id IS NULL
  AND m.organization_id = c.organization_id
  AND m.session_id = c.session_id
  AND m.phone_number = c.phone_number;

-- @once legacy_media_status
UPDATE whatsapp_messages
SET media_status = CASE
        WHEN media_url IS NOT NULL OR media_base64 IS NOT NULL THEN 'legacy'
        WHEN message_type IN ('image', 'video', 'gif', 'audio', 'ptt', 'document', 'sticker') THEN 'unavailable'
        ELSE 'none'
    END
WHERE media_status IS NULL;

-- @once legacy_seq_backfill
UPDATE whatsapp_messages m
SET seq = s.rn
FROM (
    SELECT id, row_number() OVER (ORDER BY COALESCE(timestamp, created_at), created_at, id) AS rn
    FROM whatsapp_messages
    WHERE seq IS NULL
) s
WHERE m.id = s.id;

-- @once legacy_seq_setval
SELECT setval('whatsapp_message_seq', GREATEST((SELECT COALESCE(max(seq), 0) FROM whatsapp_messages), 1));

CREATE INDEX IF NOT EXISTS idx_wa_messages_thread ON whatsapp_messages (chat_id, timestamp DESC, seq DESC);
CREATE INDEX IF NOT EXISTS idx_wa_messages_feed ON whatsapp_messages (organization_id, session_id, feed_at) WHERE feed_at IS NOT NULL;

-- @once legacy_chat_last_message
UPDATE whatsapp_chats c
SET last_message_id = lm.meta_message_id,
    last_message_preview = left(COALESCE(NULLIF(lm.caption, ''), lm.message_body, ''), 300),
    last_message_type = COALESCE(lm.message_type, 'text'),
    last_message_at = COALESCE(lm.timestamp, lm.created_at),
    last_message_from_me = (lm.direction = 'OUTBOUND'),
    last_message_status = lm.status
FROM (
    SELECT DISTINCT ON (chat_id) chat_id, meta_message_id, caption, message_body, message_type, timestamp, created_at, direction, status
    FROM whatsapp_messages
    WHERE chat_id IS NOT NULL
    ORDER BY chat_id, COALESCE(timestamp, created_at) DESC, seq DESC
) lm
WHERE lm.chat_id = c.id
  AND c.last_message_at IS NULL;

-- @once legacy_chat_unread
UPDATE whatsapp_chats c
SET unread_count = u.n
FROM (
    SELECT chat_id, count(*)::int AS n
    FROM whatsapp_messages
    WHERE chat_id IS NOT NULL AND direction = 'INBOUND' AND status NOT IN ('READ', 'PLAYED')
    GROUP BY chat_id
) u
WHERE u.chat_id = c.id;

