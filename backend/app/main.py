import os
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.core.database import engine, Base
from app.api.v1 import auth, organizations, leads, pipelines, deals, activities, webhooks, automations, invoices, contacts, custom_fields, copilot, tasks, dashboard, calendar, settings as settings_router, team, telephony, whatsapp, super_admin, integrations_google, emails

app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    openapi_url=f"{settings.API_V1_STR}/openapi.json"
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Ensure uploads and media directories exist across monorepo layouts
import httpx
from fastapi import HTTPException, Response
from fastapi.responses import FileResponse

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
repo_root = os.path.dirname(backend_dir)
possible_upload_roots = [
    os.path.join(repo_root, "uploads"),
    os.path.join(backend_dir, "uploads"),
    os.path.join(os.getcwd(), "uploads"),
]
uploads_dir = next((d for d in possible_upload_roots if os.path.exists(d)), possible_upload_roots[0])
wa_uploads_dir = os.path.join(uploads_dir, "whatsapp")
os.makedirs(wa_uploads_dir, exist_ok=True)

# Smart Media Router: serves local media, or proxies from WhatsApp gateway if cross-container (e.g. Render)
@app.get("/media/whatsapp/{filename:path}")
@app.get("/uploads/whatsapp/{filename:path}")
async def serve_whatsapp_media(filename: str):
    search_dirs = [
        os.path.join(repo_root, "whatsapp-bridge", "uploads"),
        os.path.join(repo_root, "whatsapp-bridge", "uploads", "whatsapp"),
        os.path.join(repo_root, "uploads", "whatsapp"),
        os.path.join(backend_dir, "uploads", "whatsapp"),
        os.path.join(os.getcwd(), "uploads", "whatsapp"),
        wa_uploads_dir
    ]
    for d in search_dirs:
        candidate = os.path.join(d, filename)
        if os.path.exists(candidate) and os.path.isfile(candidate):
            mime_type = "application/octet-stream"
            fn_lower = filename.lower()
            if fn_lower.endswith((".jpg", ".jpeg")):
                mime_type = "image/jpeg"
            elif fn_lower.endswith(".png"):
                mime_type = "image/png"
            elif fn_lower.endswith(".webp"):
                mime_type = "image/webp"
            elif fn_lower.endswith(".pdf"):
                mime_type = "application/pdf"
            elif fn_lower.endswith((".mp4", ".mov")):
                mime_type = "video/mp4"
            else:
                try:
                    with open(candidate, "rb") as probe_f:
                        head = probe_f.read(16)
                    if head.startswith(b"\x1aE\xdf\xa3"):
                        mime_type = "audio/webm"
                    elif head.startswith(b"OggS"):
                        mime_type = "audio/ogg"
                    elif head.startswith(b"ID3") or head[:2] == b"\xff\xfb":
                        mime_type = "audio/mpeg"
                    elif b"ftyp" in head:
                        mime_type = "audio/mp4"
                    elif fn_lower.endswith(".ogg"):
                        mime_type = "audio/ogg"
                except Exception:
                    if fn_lower.endswith(".ogg"):
                        mime_type = "audio/ogg"
            return FileResponse(candidate, media_type=mime_type, headers={"Access-Control-Allow-Origin": "*"})

    # 2. Check Database persistent base64 store (Survives container restarts & redeployments)
    try:
        from app.core.database import AsyncSessionLocal
        from sqlalchemy import text
        import base64
        async with AsyncSessionLocal() as db_sess:
            q_res = await db_sess.execute(
                text("SELECT media_base64, message_type FROM whatsapp_messages WHERE file_name = :fn OR media_url LIKE :pat LIMIT 1"),
                {"fn": filename, "pat": f"%{filename}%"}
            )
            row = q_res.fetchone()
            if row and row[0]:
                raw_b64 = str(row[0])
                if "," in raw_b64:
                    raw_b64 = raw_b64.split(",")[1]
                file_bytes = base64.b64decode(raw_b64)
                dest = os.path.join(wa_uploads_dir, filename)
                try:
                    with open(dest, "wb") as out_f:
                        out_f.write(file_bytes)
                except Exception:
                    pass
                fn_lower = filename.lower()
                mime_type = "image/webp" if fn_lower.endswith(".webp") else ("image/jpeg" if fn_lower.endswith((".jpg", ".jpeg")) else ("image/png" if fn_lower.endswith(".png") else ("application/pdf" if fn_lower.endswith(".pdf") else ("video/mp4" if fn_lower.endswith((".mp4", ".mov")) else ("audio/ogg" if fn_lower.endswith((".ogg", ".opus")) else "application/octet-stream")))))
                return Response(content=file_bytes, media_type=mime_type, headers={"Access-Control-Allow-Origin": "*"})
    except Exception as db_err:
        logger.warning(f"Failed to fetch media from DB: {db_err}")

    # 3. Cross-container cloud proxy: If Render backend doesn't have the file locally, proxy from WhatsApp bridge gateway
    gateway_url = (os.getenv("WHATSAPP_GATEWAY_URL") or "https://zigmaa-whatsapp-bridge.onrender.com").rstrip("/")
    target_urls = [
        f"{gateway_url}/media/whatsapp/{filename}",
        f"http://localhost:5001/media/whatsapp/{filename}",
        f"https://zigmaa-whatsapp-bridge.onrender.com/media/whatsapp/{filename}"
    ]
    for target in target_urls:
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.get(target)
                if resp.status_code == 200:
                    dest = os.path.join(wa_uploads_dir, filename)
                    try:
                        with open(dest, "wb") as out_f:
                            out_f.write(resp.content)
                    except Exception:
                        pass
                    content_type = resp.headers.get("content-type") or "application/octet-stream"
                    return Response(content=resp.content, media_type=content_type, headers={"Access-Control-Allow-Origin": "*"})
        except Exception:
            pass

    raise HTTPException(status_code=404, detail="Media file not found")

class SmartStaticFiles(StaticFiles):
    async def get_response(self, path: str, scope):
        resp = await super().get_response(path, scope)
        if isinstance(resp, FileResponse):
            try:
                with open(resp.path, "rb") as f:
                    head = f.read(16)
                if head.startswith(b"\x1aE\xdf\xa3"):
                    resp.media_type = "audio/webm"
                    resp.headers["content-type"] = "audio/webm"
                elif head.startswith(b"OggS"):
                    resp.media_type = "audio/ogg"
                    resp.headers["content-type"] = "audio/ogg"
                elif head.startswith(b"ID3") or head[:2] == b"\xff\xfb":
                    resp.media_type = "audio/mpeg"
                    resp.headers["content-type"] = "audio/mpeg"
            except Exception:
                pass
        return resp

app.mount("/media", SmartStaticFiles(directory=uploads_dir), name="media")
app.mount("/uploads", SmartStaticFiles(directory=uploads_dir), name="uploads")

# Router includes
app.include_router(auth.router, prefix=f"{settings.API_V1_STR}/auth", tags=["Auth"])
app.include_router(auth.router, prefix=settings.API_V1_STR, tags=["Auth-Direct"])
app.include_router(auth.router, prefix="/auth", tags=["Auth-Root"])
app.include_router(organizations.router, prefix=settings.API_V1_STR, tags=["Organizations"])

app.include_router(dashboard.router, prefix=f"{settings.API_V1_STR}/dashboard", tags=["Dashboard"])
app.include_router(settings_router.router, prefix=f"{settings.API_V1_STR}/settings", tags=["Settings"])
app.include_router(team.router, prefix=f"{settings.API_V1_STR}/settings/team", tags=["Team"])
app.include_router(team.router, prefix=f"{settings.API_V1_STR}/team", tags=["Team-Direct"])
app.include_router(team.router, prefix=f"{settings.API_V1_STR}/users", tags=["Users"])
app.include_router(super_admin.router, prefix=f"{settings.API_V1_STR}/admin", tags=["Super Admin"])
app.include_router(leads.router, prefix=settings.API_V1_STR, tags=["Leads"])
app.include_router(contacts.router, prefix=settings.API_V1_STR, tags=["Contacts"])
app.include_router(pipelines.router, prefix=settings.API_V1_STR, tags=["Pipelines"])
app.include_router(deals.router, prefix=settings.API_V1_STR, tags=["Deals"])
app.include_router(tasks.router, prefix=f"{settings.API_V1_STR}/tasks", tags=["Tasks"])
app.include_router(tasks.router, prefix=settings.API_V1_STR, tags=["Tasks-Root"])
app.include_router(custom_fields.router, prefix=settings.API_V1_STR, tags=["Custom Fields"])
app.include_router(activities.router, prefix=settings.API_V1_STR, tags=["Activities"])
app.include_router(calendar.router, prefix=settings.API_V1_STR, tags=["Calendar"])
app.include_router(webhooks.router, prefix=f"{settings.API_V1_STR}/webhooks", tags=["Webhooks"])
app.include_router(webhooks.router, prefix=settings.API_V1_STR, tags=["Webhooks-Direct"])
app.include_router(whatsapp.router, prefix=f"{settings.API_V1_STR}/whatsapp", tags=["WhatsApp"])
app.include_router(whatsapp.router, prefix="/whatsapp", tags=["WhatsApp-Root"])
app.include_router(whatsapp.router, prefix=settings.API_V1_STR, tags=["WhatsApp-Direct"])
app.include_router(automations.router, prefix=settings.API_V1_STR, tags=["Automations"])
app.include_router(invoices.router, prefix=settings.API_V1_STR, tags=["Invoices"])
app.include_router(copilot.router, prefix=settings.API_V1_STR, tags=["AI Copilot"])
app.include_router(telephony.router, prefix=settings.API_V1_STR, tags=["Telephony"])
app.include_router(telephony.router, prefix=f"{settings.API_V1_STR}/telephony", tags=["Telephony-Direct"])
app.include_router(integrations_google.router, prefix=f"{settings.API_V1_STR}/integrations/google", tags=["Google-Integration"])
app.include_router(emails.router, prefix=f"{settings.API_V1_STR}/emails", tags=["Emails"])
app.include_router(emails.router, prefix=settings.API_V1_STR, tags=["Emails-Direct"])

@app.on_event("startup")
async def on_startup():
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
            try:
                from sqlalchemy import text
                await conn.execute(text("ALTER TABLE custom_fields ADD COLUMN IF NOT EXISTS module VARCHAR(50);"))
                await conn.execute(text("ALTER TABLE custom_fields ADD COLUMN IF NOT EXISTS key VARCHAR(100);"))
                await conn.execute(text("ALTER TABLE custom_fields ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;"))
                await conn.execute(text("ALTER TABLE contacts ADD COLUMN IF NOT EXISTS custom_properties JSONB DEFAULT '{}'::jsonb;"))
                await conn.execute(text("ALTER TABLE deals ADD COLUMN IF NOT EXISTS custom_properties JSONB DEFAULT '{}'::jsonb;"))
                await conn.execute(text("ALTER TABLE organizations ADD COLUMN IF NOT EXISTS max_users INTEGER DEFAULT 15;"))
                await conn.execute(text("ALTER TABLE organizations ADD COLUMN IF NOT EXISTS max_whatsapp INTEGER DEFAULT 1500;"))
                await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(50);"))
                await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS google_email VARCHAR(255);"))
                await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS google_access_token TEXT;"))
                await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS google_refresh_token TEXT;"))
                await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS google_token_expiry TIMESTAMP WITHOUT TIME ZONE;"))
                await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_google_connected BOOLEAN DEFAULT FALSE;"))
                await conn.execute(text("ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS google_event_id VARCHAR(255);"))
                await conn.execute(text("ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS contact_name VARCHAR(255);"))
                await conn.execute(text("ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS meet_link VARCHAR(500);"))
                # WhatsApp Multi-Number Support
                await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS whatsapp_phone_number VARCHAR(50);"))
                await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS whatsapp_phone_number_id VARCHAR(100);"))
                await conn.execute(text("ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS assigned_user_id VARCHAR(36);"))
                await conn.execute(text("ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS business_phone_number_id VARCHAR(100);"))
                # WhatsApp Media & Reactions & Metadata Support
                await conn.execute(text("ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS media_url VARCHAR(500);"))
                await conn.execute(text("ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS media_base64 TEXT;"))
                await conn.execute(text("ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS file_name VARCHAR(255);"))
                await conn.execute(text("ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS caption TEXT;"))
                await conn.execute(text("ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS is_voice_note BOOLEAN DEFAULT FALSE;"))
                await conn.execute(text("ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS reaction VARCHAR(50);"))
                await conn.execute(text("ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE;"))
                await conn.execute(text("ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'SENT';"))
                await conn.execute(text("ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS timestamp TIMESTAMP WITHOUT TIME ZONE;"))
                await conn.execute(text("ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS meta_message_id VARCHAR(255);"))
                await conn.execute(text("ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS message_type VARCHAR(50) DEFAULT 'text';"))
                await conn.execute(text("ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS session_id VARCHAR(100);"))
                await conn.execute(text("ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS quoted_context TEXT;"))
                # OAuth Tokens Table (Gmail OAuth Integration)
                await conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS oauth_tokens (
                        id VARCHAR(36) PRIMARY KEY,
                        user_id VARCHAR(36) NOT NULL,
                        provider VARCHAR(50) NOT NULL DEFAULT 'google',
                        access_token TEXT,
                        refresh_token TEXT,
                        expires_at TIMESTAMP WITHOUT TIME ZONE,
                        email VARCHAR(255),
                        is_connected BOOLEAN DEFAULT TRUE,
                        created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),
                        updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
                    );
                """))
                await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_oauth_tokens_user_provider ON oauth_tokens (user_id, provider);"))
                # Email Logs Transaction Table (RFC-Compliant Delivery Tracking)
                await conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS email_logs (
                        id VARCHAR(36) PRIMARY KEY,
                        organization_id VARCHAR(36),
                        user_id VARCHAR(36),
                        contact_id VARCHAR(36),
                        lead_id VARCHAR(36),
                        sender VARCHAR(255) NOT NULL,
                        recipient VARCHAR(255) NOT NULL,
                        subject VARCHAR(500) NOT NULL,
                        message_id VARCHAR(255),
                        rfc_message_id VARCHAR(255),
                        channel VARCHAR(50) DEFAULT 'gmail_oauth',
                        status VARCHAR(50) DEFAULT 'SENT',
                        sent_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),
                        created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),
                        updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
                    );
                """))
                try:
                    await conn.execute(text("ALTER TABLE email_logs ALTER COLUMN organization_id DROP NOT NULL;"))
                except Exception:
                    pass
                try:
                    await conn.execute(text("ALTER TABLE email_logs DROP CONSTRAINT IF EXISTS email_logs_organization_id_fkey;"))
                except Exception:
                    pass
                await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_email_logs_org ON email_logs (organization_id);"))
                await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_email_logs_rfc_msgid ON email_logs (rfc_message_id);"))
                # WhatsApp Session Multi-Instance Cloud Persistence Table
                await conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS whatsapp_session_backups (
                        session_id VARCHAR(100) PRIMARY KEY,
                        owner_phone VARCHAR(50),
                        auth_data TEXT NOT NULL,
                        updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
                    );
                """))
                # Clean up corrupt WhatsApp Linked Device IDs (@lid) and invalid length numbers
                await conn.execute(text("DELETE FROM whatsapp_messages WHERE LENGTH(REGEXP_REPLACE(phone_number, '[^0-9]', '', 'g')) > 13 OR LENGTH(REGEXP_REPLACE(phone_number, '[^0-9]', '', 'g')) < 8;"))
                await conn.execute(text("DELETE FROM contacts WHERE source = 'WHATSAPP' AND (LENGTH(REGEXP_REPLACE(phone, '[^0-9]', '', 'g')) > 13 OR LENGTH(REGEXP_REPLACE(phone, '[^0-9]', '', 'g')) < 8);"))
                # Normalize legacy session IDs to user WhatsApp phone numbers so chat history is never orphaned
                await conn.execute(text("UPDATE whatsapp_messages SET session_id = '916379816912', business_phone_number_id = '916379816912' WHERE session_id = '82830648669123136365';"))
                # Fast index for high-speed WhatsApp polling and conversation loading
                await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_wa_msgs_session_created ON whatsapp_messages (session_id, created_at DESC);"))
                await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_wa_msgs_biz_phone ON whatsapp_messages (business_phone_number_id, created_at DESC);"))
                # Clean up legacy bogus deals
                await conn.execute(text("DELETE FROM deals WHERE deal_value = 1480000 OR (title ILIKE '%test%' AND deal_value >= 1400000);"))
            except Exception as e:
                print(f"[STARTUP MIGRATION] Schema check note: {e}")
    except Exception as e:
        print(f"[STARTUP DB INIT NOTE] Initial schema sync deferred or failed: {e}")

    try:
        from app.services.whatsapp.schema import apply_schema
        await apply_schema(engine)
    except Exception as e:
        print(f"[STARTUP WHATSAPP SCHEMA] apply_schema note: {e}")

    # Background keep-alive task to keep WhatsApp Bridge gateway on Render permanently awake 24/7
    async def keep_bridge_awake():
        import asyncio
        while True:
            await asyncio.sleep(240)
            try:
                g_url = (os.getenv("WHATSAPP_GATEWAY_URL") or "https://zigmaa-whatsapp-bridge.onrender.com").rstrip("/")
                async with httpx.AsyncClient(timeout=10.0) as client:
                    await client.get(f"{g_url}/status?sessionId=keepalive")
            except Exception:
                pass
    import asyncio
    asyncio.create_task(keep_bridge_awake())

    # Background task: Ensure WhatsApp contacts are synchronized into CRM database table
    async def auto_sync_wa_contacts():
        await asyncio.sleep(5)
        try:
            from app.core.database import AsyncSessionLocal
            from sqlalchemy import text
            async with AsyncSessionLocal() as session:
                q_chats = await session.execute(text("SELECT count(*) FROM whatsapp_chats WHERE phone_number IS NOT NULL AND length(phone_number) >= 8"))
                num_chats = q_chats.scalar() or 0
                q_cts = await session.execute(text("SELECT count(*) FROM contacts WHERE source = 'WhatsApp'"))
                num_cts = q_cts.scalar() or 0
                if num_chats > 0 and num_cts < (num_chats // 2):
                    logger.info(f"[AUTO-SYNC] Syncing {num_chats} WhatsApp chats to CRM contacts (current: {num_cts})...")
                    await session.execute(text("""
                        INSERT INTO contacts (
                            id, organization_id, full_name, phone, source,
                            status, lifecycle_stage, created_at, updated_at
                        )
                        SELECT 
                            gen_random_uuid()::varchar,
                            c.organization_id,
                            COALESCE(
                                NULLIF(NULLIF(c.name, ''), '+%'),
                                NULLIF(NULLIF(c.push_name, ''), '+%'),
                                NULLIF(NULLIF(c.verified_name, ''), '+%'),
                                '+' || regexp_replace(c.phone_number, '[^0-9]', '', 'g')
                            ),
                            '+' || regexp_replace(c.phone_number, '[^0-9]', '', 'g'),
                            'WhatsApp',
                            'Active',
                            'Lead',
                            NOW(),
                            NOW()
                        FROM whatsapp_chats c
                        WHERE c.phone_number IS NOT NULL 
                          AND length(regexp_replace(c.phone_number, '[^0-9]', '', 'g')) >= 8
                          AND NOT EXISTS (
                              SELECT 1 FROM contacts ct 
                              WHERE ct.organization_id = c.organization_id 
                                AND regexp_replace(ct.phone, '[^0-9]', '', 'g') = regexp_replace(c.phone_number, '[^0-9]', '', 'g')
                          )
                        GROUP BY c.organization_id, c.phone_number, c.name, c.push_name, c.verified_name
                        ON CONFLICT DO NOTHING;
                    """))
                    await session.commit()
                    logger.info("[AUTO-SYNC] WhatsApp contacts successfully populated in CRM database.")
        except Exception as e:
            logger.warning(f"[AUTO-SYNC] WhatsApp contacts sync note: {e}")

    asyncio.create_task(auto_sync_wa_contacts())

@app.get("/")
async def root():
    return {
        "app": "Zigmaa CRM Production API",
        "version": settings.VERSION,
        "docs": "/docs"
    }

@app.get("/health")
@app.get(f"{settings.API_V1_STR}/health")
async def health_check():
    return {"status": "ok", "app": "Zigmaa CRM", "timestamp": "healthy"}


@app.get("/api/v1/migrate-db")
async def migrate_db():
    from sqlalchemy import text
    results = []
    queries = [
        "ALTER TABLE custom_fields ADD COLUMN IF NOT EXISTS module VARCHAR(50);",
        "ALTER TABLE custom_fields ADD COLUMN IF NOT EXISTS key VARCHAR(100);",
        "ALTER TABLE custom_fields ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;",
        "ALTER TABLE contacts ADD COLUMN IF NOT EXISTS custom_properties JSONB DEFAULT '{}'::jsonb;",
        "ALTER TABLE deals ADD COLUMN IF NOT EXISTS custom_properties JSONB DEFAULT '{}'::jsonb;",
        "ALTER TABLE organizations ADD COLUMN IF NOT EXISTS max_users INTEGER DEFAULT 15;",
        "ALTER TABLE organizations ADD COLUMN IF NOT EXISTS max_whatsapp INTEGER DEFAULT 1500;",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(50);",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS google_email VARCHAR(255);",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS google_access_token TEXT;",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS google_refresh_token TEXT;",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS google_token_expiry TIMESTAMP WITHOUT TIME ZONE;",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_google_connected BOOLEAN DEFAULT FALSE;",
        "ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS google_event_id VARCHAR(255);",
        "ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS meet_link VARCHAR(500);",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS whatsapp_phone_number VARCHAR(50);",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS whatsapp_phone_number_id VARCHAR(100);",
        "ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS assigned_user_id VARCHAR(36);",
        "ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS business_phone_number_id VARCHAR(100);",
        "ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS media_url VARCHAR(500);",
        "ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS media_base64 TEXT;",
        "ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS file_name VARCHAR(255);",
        "ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS caption TEXT;",
        "ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS is_voice_note BOOLEAN DEFAULT FALSE;",
        "ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS reaction VARCHAR(50);",
        "ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE;",
        "ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'SENT';",
        "ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS timestamp TIMESTAMP WITHOUT TIME ZONE;",
        "ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS meta_message_id VARCHAR(255);",
        "ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS message_type VARCHAR(50) DEFAULT 'text';"
    ]
    async with engine.begin() as conn:
        for q in queries:
            try:
                await conn.execute(text(q))
                results.append({"query": q, "status": "ok"})
            except Exception as e:
                results.append({"query": q, "status": f"error: {e}"})
    return {"status": "success", "results": results}

@app.get("/api/v1/debug-db")
async def debug_db():
    from app.core.database import AsyncSessionLocal, db_url
    from sqlalchemy import text
    masked_url = db_url
    if "@" in masked_url:
        parts = masked_url.split("@")
        masked_url = f"{parts[0][:15]}...@{parts[-1]}"
    try:
        async with AsyncSessionLocal() as session:
            res = await session.execute(text("SELECT count(*) FROM users;"))
            count = res.scalar()
            return {"status": "connected", "database_url_target": masked_url, "user_count": count}
    except Exception as e:
        import traceback
        return {"status": "error", "database_url_target": masked_url, "error": str(e), "trace": traceback.format_exc()}

from fastapi import Request
from fastapi.responses import JSONResponse

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    import traceback
    traceback.print_exc()
    response = JSONResponse(
        status_code=500,
        content={"detail": str(exc)}
    )
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Credentials"] = "true"
    response.headers["Access-Control-Allow-Methods"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "*"
    return response


import asyncio
import logging

keepalive_logger = logging.getLogger("zigmaa.keepalive")

async def keepalive_cloud_services_loop():
    """
    24/7 background pinger running in FastAPI.
    Pings the WhatsApp Bridge gateway and Backend every 4 minutes (240s)
    so Render free tier NEVER spins down or enters sleep mode.
    Even when all user laptop tabs are closed at night, the bridge stays alive!
    """
    bridge_url = (os.getenv("WHATSAPP_GATEWAY_URL") or "https://zigmaa-whatsapp-bridge.onrender.com").rstrip("/")
    backend_url = "https://zigmaacrm-backend.onrender.com"

    await asyncio.sleep(10)
    keepalive_logger.info("[KEEPALIVE] 24/7 Cloud Bridge Keep-Alive Loop started.")

    while True:
        try:
            async with httpx.AsyncClient(timeout=30.0, headers={"User-Agent": "ZigmaaCRM-KeepAlive/2.0"}) as client:
                try:
                    await client.get(f"{bridge_url}/status?ping=keepalive")
                except Exception as e:
                    keepalive_logger.debug(f"[KEEPALIVE] Bridge ping error: {e}")

                try:
                    await client.get(f"{backend_url}/health")
                except Exception as e:
                    keepalive_logger.debug(f"[KEEPALIVE] Backend ping error: {e}")
        except Exception as e:
            keepalive_logger.debug(f"[KEEPALIVE] Worker loop exception: {e}")

        await asyncio.sleep(240)

@app.on_event("startup")
async def start_keepalive_worker():
    asyncio.create_task(keepalive_cloud_services_loop())
