from sqlalchemy import Column, String, Text, DateTime, Boolean, ForeignKey, Enum as SQLEnum
from sqlalchemy.orm import relationship
import enum
from datetime import datetime
from app.models.base import TimeStampedBase, generate_uuid

class MessageDirection(str, enum.Enum):
    INBOUND = "INBOUND"
    OUTBOUND = "OUTBOUND"

class MessageStatus(str, enum.Enum):
    SENT = "SENT"
    DELIVERED = "DELIVERED"
    READ = "READ"
    FAILED = "FAILED"

class WhatsAppMessage(TimeStampedBase):
    __tablename__ = "whatsapp_messages"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(String(36), ForeignKey("organizations.id"), nullable=True, index=True)
    contact_id = Column(String(36), ForeignKey("contacts.id"), nullable=True, index=True)
    assigned_user_id = Column(String(36), ForeignKey("users.id"), nullable=True, index=True)
    business_phone_number_id = Column(String(100), nullable=True, index=True)
    phone_number = Column(String(50), nullable=False, index=True)
    direction = Column(String(20), default="INBOUND", index=True)  # INBOUND, OUTBOUND
    message_body = Column(Text, nullable=False)
    message_type = Column(String(50), default="text")  # text, template, image, document, audio, ptt, video
    media_url = Column(String(500), nullable=True)
    media_base64 = Column(Text, nullable=True)
    file_name = Column(String(255), nullable=True)
    caption = Column(Text, nullable=True)
    is_voice_note = Column(Boolean, default=False, nullable=True)
    meta_message_id = Column(String(255), nullable=True, index=True)
    status = Column(String(50), default="SENT", index=True)  # SENT, DELIVERED, READ, FAILED
    timestamp = Column(DateTime, default=datetime.utcnow, nullable=True, index=True)
    reaction = Column(String(50), nullable=True)
    is_deleted = Column(Boolean, default=False, nullable=True)
    session_id = Column(String(100), nullable=True, index=True)
    quoted_context = Column(Text, nullable=True)

    organization = relationship("Organization")
    contact = relationship("Contact")
    assigned_user = relationship("User")
