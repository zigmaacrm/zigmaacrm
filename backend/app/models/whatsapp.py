from sqlalchemy import Column, String, Text, DateTime, ForeignKey, Enum as SQLEnum
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
    message_type = Column(String(50), default="text")  # text, template, image, document
    meta_message_id = Column(String(255), nullable=True, index=True)
    status = Column(String(50), default="SENT", index=True)  # SENT, DELIVERED, READ, FAILED
    timestamp = Column(DateTime, default=datetime.utcnow, nullable=True, index=True)

    organization = relationship("Organization")
    contact = relationship("Contact")
    assigned_user = relationship("User")
