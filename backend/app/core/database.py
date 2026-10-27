import os
import logging
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import declarative_base
from app.core.config import settings

logger = logging.getLogger("zigmaa.database")

# DB Configuration: Preferences settings.DATABASE_URL or environment variable
db_url = os.getenv("DATABASE_URL", settings.DATABASE_URL)
if db_url.startswith("postgresql://"):
    db_url = db_url.replace("postgresql://", "postgresql+asyncpg://", 1)

# Asyncpg requires 'ssl=' instead of 'sslmode='
if "sslmode=" in db_url:
    db_url = db_url.replace("sslmode=", "ssl=")

connect_args = {}
engine_kwargs = {
    "connect_args": connect_args,
    "echo": False,
    "pool_pre_ping": True,
}
if db_url.startswith("sqlite"):
    connect_args["check_same_thread"] = False
else:
    # High-concurrency PostgreSQL async connection pool
    engine_kwargs.update({
        "pool_size": 20,
        "max_overflow": 10,
        "pool_recycle": 300,
        "pool_timeout": 30,
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
