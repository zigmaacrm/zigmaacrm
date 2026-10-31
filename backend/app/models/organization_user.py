from sqlalchemy import Column, String, Boolean, ForeignKey, DateTime, Integer, Text
from sqlalchemy.orm import relationship
from app.models.base import TimeStampedBase

class Organization(TimeStampedBase):
    __tablename__ = "organizations"

    name = Column(String(255), nullable=False)
    slug = Column(String(100), unique=True, index=True, nullable=False)
    plan = Column(String(50), default="PRO")  # FREE_TRIAL, STARTER, PRO, ENTERPRISE
    trial_ends_at = Column(DateTime, nullable=True)
    status = Column(String(50), default="ACTIVE")  # ACTIVE, EXPIRED, SUSPENDED
    max_users = Column(Integer, default=15, nullable=True)
    max_whatsapp = Column(Integer, default=1500, nullable=True)

    users = relationship("User", back_populates="organization", cascade="all, delete-orphan")
    leads = relationship("Lead", back_populates="organization", cascade="all, delete-orphan")
    contacts = relationship("Contact", back_populates="organization", cascade="all, delete-orphan")
    pipelines = relationship("Pipeline", back_populates="organization", cascade="all, delete-orphan")
    deals = relationship("Deal", back_populates="organization", cascade="all, delete-orphan")
    invoices = relationship("Invoice", back_populates="organization", cascade="all, delete-orphan")

class User(TimeStampedBase):
    __tablename__ = "users"

    organization_id = Column(String(36), ForeignKey("organizations.id"), nullable=False, index=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    full_name = Column(String(255), nullable=False)
    phone = Column(String(50), nullable=True, index=True)
    role = Column(String(50), default="SALES_REP")  # SUPER_ADMIN, ADMIN, SALES_MANAGER, SALES_REP
    is_active = Column(Boolean, default=True)
    is_super_admin = Column(Boolean, default=False)
    avatar_url = Column(String(1000), nullable=True)

    # Google OAuth (Gmail & Google Calendar) Integration
    google_email = Column(String(255), nullable=True)
    google_access_token = Column(Text, nullable=True)
    google_refresh_token = Column(Text, nullable=True)
    google_token_expiry = Column(DateTime, nullable=True)
    is_google_connected = Column(Boolean, default=False)

    # WhatsApp Specific Configuration (Multi-Number Setup)
    whatsapp_phone_number = Column(String(50), nullable=True)
    whatsapp_phone_number_id = Column(String(100), nullable=True, index=True)

    organization = relationship("Organization", back_populates="users")
