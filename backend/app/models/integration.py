from sqlalchemy import Column, String, Boolean, ForeignKey, DateTime, Text
from sqlalchemy.orm import relationship
from app.models.base import TimeStampedBase

class UserIntegration(TimeStampedBase):
    __tablename__ = "user_integrations"

    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True, index=True)
    provider = Column(String(50), default="google", nullable=False)
    google_email = Column(String(255), nullable=True)
    google_access_token = Column(Text, nullable=True)
    google_refresh_token = Column(Text, nullable=True)
    google_token_expiry = Column(DateTime, nullable=True)
    is_google_connected = Column(Boolean, default=False)

    user = relationship("User", backref="user_integration")

class OAuthToken(TimeStampedBase):
    __tablename__ = "oauth_tokens"

    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    provider = Column(String(50), default="google", nullable=False, index=True)
    access_token = Column(Text, nullable=True)
    refresh_token = Column(Text, nullable=True)
    expires_at = Column(DateTime, nullable=True)
    email = Column(String(255), nullable=True)
    is_connected = Column(Boolean, default=True)

    user = relationship("User", backref="oauth_tokens")

