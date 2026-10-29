import os
from pathlib import Path
from dotenv import load_dotenv
from pydantic_settings import BaseSettings

# Explicitly load .env from backend directory and workspace root
backend_dir = Path(__file__).resolve().parent.parent.parent
load_dotenv(backend_dir / ".env")
load_dotenv(backend_dir.parent / ".env")

class Settings(BaseSettings):
    PROJECT_NAME: str = "Zigmaa CRM API"
    VERSION: str = "1.0.0"
    API_V1_STR: str = "/api/v1"
    
    # AI Keys (Loaded from .env)
    GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "")
    GROQ_API_KEY: str = os.getenv("GROQ_API_KEY", "")
    
    # DB Configuration: Read strictly from environment (.env)
    POSTGRES_USER: str = os.getenv("POSTGRES_USER", "postgres")
    POSTGRES_PASSWORD: str = os.getenv("POSTGRES_PASSWORD", "")
    POSTGRES_SERVER: str = os.getenv("POSTGRES_SERVER", "localhost")
    POSTGRES_PORT: str = os.getenv("POSTGRES_PORT", "5432")
    POSTGRES_DB: str = os.getenv("POSTGRES_DB", "zigmaa_crm")
    
    DATABASE_URL: str = os.getenv(
        "DATABASE_URL",
        f"postgresql+asyncpg://{POSTGRES_USER}:{POSTGRES_PASSWORD}@{POSTGRES_SERVER}:{POSTGRES_PORT}/{POSTGRES_DB}" if POSTGRES_PASSWORD else "sqlite+aiosqlite:///./zigmaa_crm.db"
    )
    
    # Security
    SECRET_KEY: str = os.getenv("SECRET_KEY", "ZIGMAA_SUPER_SECRET_KEY_2026_PRODUCTION_READY")
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24  # 1 day (24 hours)

    # Redis & Celery
    REDIS_URL: str = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    CELERY_BROKER_URL: str = os.getenv("CELERY_BROKER_URL", "redis://localhost:6379/0")
    CELERY_RESULT_BACKEND: str = os.getenv("CELERY_RESULT_BACKEND", "redis://localhost:6379/0")

    # SMTP Configuration (Loaded from .env with production fallback)
    SMTP_HOST: str = os.getenv("SMTP_HOST", "smtp.gmail.com")
    SMTP_PORT: int = int(os.getenv("SMTP_PORT", "587"))
    SMTP_USER: str = os.getenv("SMTP_USER") or "zigmaatech@gmail.com"
    SMTP_PASSWORD: str = os.getenv("SMTP_PASSWORD") or "fhgu cnck rkhj anmq"
    SMTP_FROM_NAME: str = os.getenv("SMTP_FROM_NAME", "Zigmaacrm")
    SMTP_FROM_EMAIL: str = os.getenv("SMTP_FROM_EMAIL") or "zigmaatech@gmail.com"

    # WhatsApp Meta Cloud API Configuration
    WHATSAPP_VERIFY_TOKEN: str = os.getenv("WHATSAPP_VERIFY_TOKEN", "zigmaa_wa_secure_webhook_token_2026")
    WHATSAPP_ACCESS_TOKEN: str = os.getenv("WHATSAPP_ACCESS_TOKEN", "") or os.getenv("WHATSAPP_API_TOKEN", "")
    WHATSAPP_API_TOKEN: str = os.getenv("WHATSAPP_ACCESS_TOKEN", "") or os.getenv("WHATSAPP_API_TOKEN", "")
    WHATSAPP_PHONE_NUMBER_ID: str = os.getenv("WHATSAPP_PHONE_NUMBER_ID", "1445856311935813")

    # Google OAuth & Integrations (Gmail & Google Calendar)
    GOOGLE_CLIENT_ID: str = os.getenv("GOOGLE_CLIENT_ID", "") or os.getenv("NEXT_PUBLIC_GOOGLE_CLIENT_ID", "")
    GOOGLE_CLIENT_SECRET: str = os.getenv("GOOGLE_CLIENT_SECRET", "")
    GOOGLE_REDIRECT_URI: str = os.getenv("GOOGLE_REDIRECT_URI", "http://localhost:8000/api/v1/integrations/google/callback")
    FRONTEND_URL: str = os.getenv("FRONTEND_URL", "http://localhost:3000")

    class Config:
        env_file = ".env"
        extra = "allow"

settings = Settings()
