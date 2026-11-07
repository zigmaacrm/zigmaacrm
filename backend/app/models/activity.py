from sqlalchemy import Column, String, Text, ForeignKey, DateTime
from sqlalchemy.orm import relationship
from datetime import datetime
from app.models.base import TimeStampedBase

class Activity(TimeStampedBase):
    __tablename__ = "activities"

    organization_id = Column(String(36), ForeignKey("organizations.id"), nullable=False, index=True)
    lead_id = Column(String(36), ForeignKey("leads.id"), nullable=True)
    contact_id = Column(String(36), ForeignKey("contacts.id"), nullable=True)
    deal_id = Column(String(36), ForeignKey("deals.id"), nullable=True)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=True)
    type = Column(String(50), nullable=False)  # CALL, WHATSAPP, EMAIL, NOTE, STAGE_CHANGE
    notes = Column(Text, nullable=False)
    status = Column(String(50), default="COMPLETED")  # SCHEDULED, COMPLETED
    scheduled_at = Column(DateTime, nullable=True)

    lead = relationship("Lead", back_populates="activities", foreign_keys=[lead_id])
    contact = relationship("Contact", back_populates="activities", foreign_keys=[contact_id])
    deal = relationship("Deal", back_populates="activities")

class MessageLog(TimeStampedBase):
    __tablename__ = "message_logs"

    organization_id = Column(String(36), ForeignKey("organizations.id"), nullable=False, index=True)
    recipient_phone = Column(String(50), nullable=False)
    channel = Column(String(50), default="WHATSAPP")  # WHATSAPP, SMS, EMAIL
    direction = Column(String(20), default="OUTBOUND")  # INBOUND, OUTBOUND
    body = Column(Text, nullable=False)
    status = Column(String(50), default="SENT")  # SENT, DELIVERED, READ, FAILED
    sent_at = Column(DateTime, default=datetime.utcnow)

class EmailLog(TimeStampedBase):
    __tablename__ = "email_logs"

    organization_id = Column(String(36), ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True, index=True)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    contact_id = Column(String(36), ForeignKey("contacts.id", ondelete="SET NULL"), nullable=True, index=True)
    lead_id = Column(String(36), ForeignKey("leads.id", ondelete="SET NULL"), nullable=True, index=True)
    sender = Column(String(255), nullable=False)
    recipient = Column(String(255), nullable=False)
    subject = Column(String(500), nullable=False)
    message_id = Column(String(255), nullable=True)        # Gmail API Message ID
    rfc_message_id = Column(String(255), nullable=True, index=True)    # Standard RFC Message-ID header
    channel = Column(String(50), default="gmail_oauth")    # gmail_oauth, system_smtp
    status = Column(String(50), default="SENT")            # SENT, DELIVERED, FAILED
    sent_at = Column(DateTime, default=datetime.utcnow)
