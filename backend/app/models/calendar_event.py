from sqlalchemy import Column, String, ForeignKey, DateTime, Text, Boolean
from sqlalchemy.orm import relationship
from app.models.base import TimeStampedBase, generate_uuid

class CalendarEvent(TimeStampedBase):
    __tablename__ = "calendar_events"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(String(36), ForeignKey("organizations.id"), nullable=True, index=True)
    title = Column(String(255), nullable=False)
    event_type = Column(String(50), default="Product Demo")  # Product Demo, Discovery Call, Follow-up, Closing Meeting
    start_time = Column(String(50), nullable=False)          # ISO format e.g. "2026-10-16T10:00"
    end_time = Column(String(50), nullable=True)            # ISO format e.g. "2026-10-16T11:00"
    meeting_link = Column(String(500), nullable=True)        # e.g. "https://meet.google.com/..."
    meet_link = Column(String(500), nullable=True)           # e.g. "https://meet.google.com/..."
    google_event_id = Column(String(255), nullable=True, index=True) # Remote Google Calendar Event ID
    location = Column(String(500), nullable=True)
    attendee_name = Column(String(255), nullable=True)
    attendee_email = Column(String(255), nullable=True)
    contact_id = Column(String(36), ForeignKey("contacts.id"), nullable=True, index=True)
    lead_or_deal = Column(String(255), nullable=True)
    notes = Column(Text, nullable=True)
    google_calendar_synced = Column(Boolean, default=False)
    owner_id = Column(String(36), ForeignKey("users.id"), nullable=True, index=True)
    owner_name = Column(String(255), default="Mohamed Thoufiq")

    contact = relationship("Contact", backref="calendar_events", lazy="joined")
