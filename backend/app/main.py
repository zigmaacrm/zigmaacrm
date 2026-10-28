from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.core.database import engine, Base
from app.api.v1 import auth, organizations, leads, pipelines, deals, activities, webhooks, automations, invoices, contacts, custom_fields, copilot, tasks, dashboard, calendar, settings as settings_router, team, telephony, whatsapp, super_admin

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
app.include_router(automations.router, prefix=settings.API_V1_STR, tags=["Automations"])
app.include_router(invoices.router, prefix=settings.API_V1_STR, tags=["Invoices"])
app.include_router(copilot.router, prefix=settings.API_V1_STR, tags=["AI Copilot"])
app.include_router(telephony.router, prefix=settings.API_V1_STR, tags=["Telephony"])
app.include_router(telephony.router, prefix=f"{settings.API_V1_STR}/telephony", tags=["Telephony-Direct"])

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
            except Exception as e:
                print(f"[STARTUP MIGRATION] Schema check note: {e}")
    except Exception as e:
        print(f"[STARTUP DB INIT NOTE] Initial schema sync deferred or failed: {e}")
    try:
        from app.core.database import AsyncSessionLocal
        from app.api.v1.webhooks.whatsapp import backfill_whatsapp_contacts
        async with AsyncSessionLocal() as session:
            await backfill_whatsapp_contacts(session)
    except Exception as e:
        print(f"[STARTUP BACKFILL] WhatsApp backfill skipped or deferred: {e}")

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

@app.get("/api/v1/debug-db")
async def debug_db():
    from app.core.database import AsyncSessionLocal, db_url
    from sqlalchemy import text
    import urllib.parse
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

