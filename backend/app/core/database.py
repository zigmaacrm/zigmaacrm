import os
import logging
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import declarative_base
from app.core.config import settings

logger = logging.getLogger("zigmaa.database")

# DB Configuration: Preferences settings.DATABASE_URL or environment variable
db_url = (os.getenv("DATABASE_URL", settings.DATABASE_URL) or "").strip().replace("\r", "").replace("\n", "")
if db_url.startswith("postgresql://"):
    db_url = db_url.replace("postgresql://", "postgresql+asyncpg://", 1)

# Automatically URL-encode '@' in password if present
if db_url.count("@") > 1 and "://" in db_url:
    try:
        scheme, rest = db_url.split("://", 1)
        userpass, host_part = rest.rsplit("@", 1)
        if ":" in userpass:
            user, password = userpass.split(":", 1)
            db_url = f"{scheme}://{user}:{password.replace('@', '%40')}@{host_part}"
    except Exception:
        pass

# Auto-switch to transaction pooler port (6543) if using Supabase pooler on session port (5432)
if "pooler.supabase.com:5432" in db_url:
    db_url = db_url.replace("pooler.supabase.com:5432", "pooler.supabase.com:6543")

# Asyncpg requires 'ssl=' instead of 'sslmode='
if "sslmode=" in db_url:
    db_url = db_url.replace("sslmode=", "ssl=")

connect_args = {}
if "postgresql" in db_url:
    # Disable asyncpg statement cache for Supabase transaction pooler (pgbouncer) compatibility
    connect_args["statement_cache_size"] = 0

engine_kwargs = {
    "connect_args": connect_args,
    "echo": False,
    "pool_pre_ping": True,
}
if db_url.startswith("sqlite"):
    connect_args["check_same_thread"] = False
else:
    # Safe Supabase / PostgreSQL async connection pool that prevents exceeding pool_size: 15
    engine_kwargs.update({
        "pool_size": 4,
        "max_overflow": 2,
        "pool_recycle": 60,
        "pool_timeout": 15,
        "pool_pre_ping": True,
    })

engine = create_async_engine(db_url, **engine_kwargs)

AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
Base = declarative_base()

async def get_db():
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()
