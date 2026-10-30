from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from typing import List, Optional
from pydantic import BaseModel
from datetime import datetime

from app.core.database import get_db
from app.models.calendar_event import CalendarEvent
from app.models.contact import Contact
from app.models.activity import Activity
from app.models.organization_user import Organization, User
from app.api.deps import get_optional_current_user
from app.api.v1.integrations_google import create_google_calendar_event, delete_google_calendar_event

router = APIRouter()

class CalendarEventCreate(BaseModel):
    title: str
    event_type: Optional[str] = "Product Demo"
    start_time: str
    end_time: Optional[str] = None
    meeting_link: Optional[str] = None
    location: Optional[str] = None
    attendee_name: Optional[str] = None
    attendee_email: Optional[str] = None
    contact_id: Optional[str] = None
    notes: Optional[str] = None
    description: Optional[str] = None
    lead_or_deal: Optional[str] = None
    google_calendar_synced: Optional[bool] = False

class CalendarEventOut(BaseModel):
    id: str
    title: str
    event_type: str
    start_time: str
    end_time: Optional[str] = None
    meeting_link: Optional[str] = None
    meet_link: Optional[str] = None
    google_event_id: Optional[str] = None
    location: Optional[str] = None
    meet_url: Optional[str] = None
    attendee_name: Optional[str] = None
    attendee_email: Optional[str] = None
    contact_id: Optional[str] = None
    lead_or_deal: Optional[str] = None
    notes: Optional[str] = None
    description: Optional[str] = None
    google_calendar_synced: bool
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True

def _serialize_event(e: CalendarEvent) -> dict:
    meet = e.meet_link or e.meeting_link or (e.location if e.location and "http" in e.location else None)
    return {
        "id": e.id,
        "title": e.title,
        "event_type": e.event_type or "Product Demo",
        "start_time": e.start_time,
        "end_time": e.end_time or e.start_time,
        "meeting_link": meet,
        "meet_link": meet,
        "google_event_id": e.google_event_id,
        "location": e.location or meet or "Online Google Meet",
        "meet_url": meet,
        "attendee_name": e.attendee_name or "",
        "attendee_email": e.attendee_email or "",
        "contact_id": e.contact_id,
        "lead_or_deal": e.lead_or_deal or "",
        "notes": e.notes or "",
        "description": e.notes or "",
        "google_calendar_synced": bool(e.google_calendar_synced or e.google_event_id),
        "created_at": e.created_at
    }

@router.get("/calendar/events", response_model=List[CalendarEventOut])
@router.get("/events", response_model=List[CalendarEventOut])
async def get_calendar_events(
    contact_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db)
):
    query = select(CalendarEvent).order_by(CalendarEvent.start_time.asc())
    if contact_id:
        query = query.where(CalendarEvent.contact_id == contact_id)
    result = await db.execute(query)
    events = result.scalars().all()
    return [_serialize_event(e) for e in events]

@router.post("/calendar/events", response_model=CalendarEventOut, status_code=status.HTTP_201_CREATED)
@router.post("/events", response_model=CalendarEventOut, status_code=status.HTTP_201_CREATED)
async def create_calendar_event(
    payload: CalendarEventCreate,
    current_user: Optional[User] = Depends(get_optional_current_user),
    db: AsyncSession = Depends(get_db)
):
    if not payload.title or not payload.title.strip():
        raise HTTPException(status_code=400, detail="Meeting title is required")
    if not payload.start_time:
        raise HTTPException(status_code=400, detail="Start time is required")

    combined_notes = (payload.notes or payload.description or "").strip()
    clean_meet = (payload.meeting_link or "").strip()
    clean_loc = (payload.location or "").strip()
    if not clean_loc and clean_meet:
        clean_loc = clean_meet
    elif not clean_meet and clean_loc and "http" in clean_loc:
        clean_meet = clean_loc

    # Retrieve contact if contact_id provided
    contact = None
    target_org_id = None
    if payload.contact_id:
        res = await db.execute(select(Contact).where(Contact.id == payload.contact_id))
        contact = res.scalar_one_or_none()
        if contact and contact.organization_id:
            target_org_id = contact.organization_id

    if not target_org_id:
        if current_user and current_user.organization_id:
            target_org_id = current_user.organization_id
        else:
            res = await db.execute(select(Organization))
            org = res.scalars().first()
            target_org_id = org.id if org else None

    # Derive attendee name and email if empty and contact exists
    att_name = payload.attendee_name
    att_email = payload.attendee_email
    lead_deal = payload.lead_or_deal
    if contact:
        if not att_name:
            att_name = contact.full_name
        if not att_email:
            att_email = contact.email
        if not lead_deal:
            company_str = f" ({contact.company_name})" if contact.company_name else ""
            lead_deal = f"[Contact] {contact.full_name}{company_str}"

    # Auto-Sync with Google Calendar if current user or active workspace user has Google connected
    sync_user = current_user
    if not sync_user or not sync_user.is_google_connected:
        u_query = select(User).where(User.is_google_connected == True)
        if target_org_id:
            u_query = u_query.where(User.organization_id == target_org_id)
        u_res = await db.execute(u_query)
        connected_u = u_res.scalars().first()
        if connected_u:
            sync_user = connected_u

    google_event_id = None
    meet_link = clean_meet or None

    if sync_user and sync_user.is_google_connected:
        try:
            gcal_res = await create_google_calendar_event(
                user=sync_user,
                event_data={
                    "title": payload.title.strip(),
                    "description": combined_notes,
                    "start_time": payload.start_time,
                    "end_time": payload.end_time or payload.start_time,
                    "attendee_name": att_name,
                    "attendee_email": att_email
                },
                db=db
            )
            if gcal_res.get("success"):
                google_event_id = gcal_res.get("google_event_id")
                if gcal_res.get("meet_link"):
                    meet_link = gcal_res.get("meet_link")
                    clean_loc = meet_link
                clean_meet = meet_link or clean_meet
        except Exception as ge:
            print(f"[Google Calendar Sync Warning]: {ge}")

    event = CalendarEvent(
        organization_id=target_org_id,
        title=payload.title.strip(),
        event_type=payload.event_type or "Product Demo",
        start_time=payload.start_time,
        end_time=payload.end_time or payload.start_time,
        meeting_link=clean_meet or None,
        meet_link=meet_link or clean_meet or None,
        google_event_id=google_event_id,
        location=clean_loc or "Online Google Meet",
        attendee_name=att_name or None,
        attendee_email=att_email or None,
        contact_id=payload.contact_id or None,
        lead_or_deal=lead_deal or None,
        notes=combined_notes or None,
        google_calendar_synced=bool(google_event_id or payload.google_calendar_synced),
        owner_id=sync_user.id if sync_user else None,
        owner_name=sync_user.full_name if (sync_user and sync_user.full_name) else "Mohamed Thoufiq"
    )

    db.add(event)

    # Append activity entry in activities table if linked to contact
    if payload.contact_id:
        activity_text = f"Scheduled Meeting: {payload.title} ({payload.event_type})\nStart: {payload.start_time}"
        if clean_meet:
            activity_text += f"\nMeeting Link: {clean_meet}"
        if combined_notes:
            activity_text += f"\nAgenda: {combined_notes}"

        # Parse scheduled datetime if valid ISO format
        sched_dt = None
        try:
            sched_dt = datetime.fromisoformat(payload.start_time.replace("Z", "+00:00"))
        except Exception:
            sched_dt = None

        activity = Activity(
            organization_id=target_org_id or "default-org",
            contact_id=payload.contact_id,
            lead_id=None,
            deal_id=None,
            user_id=sync_user.id if sync_user else None,
            type="MEETING",
            notes=activity_text,
            status="SCHEDULED",
            scheduled_at=sched_dt
        )
        db.add(activity)

    await db.commit()
    await db.refresh(event)

    return _serialize_event(event)

@router.delete("/calendar/events/{event_id}")
@router.delete("/events/{event_id}")
async def delete_calendar_event(
    event_id: str,
    current_user: Optional[User] = Depends(get_optional_current_user),
    db: AsyncSession = Depends(get_db)
):
    res = await db.execute(select(CalendarEvent).where(CalendarEvent.id == event_id))
    event = res.scalar_one_or_none()
    if not event:
        raise HTTPException(status_code=404, detail="Calendar event not found")

    # If linked to Google Calendar, delete remotely via Google API
    if event.google_event_id:
        sync_user = current_user
        if not sync_user or not sync_user.is_google_connected:
            if event.owner_id:
                u_res = await db.execute(select(User).where(User.id == event.owner_id))
                sync_user = u_res.scalar_one_or_none()
            if not sync_user or not sync_user.is_google_connected:
                u_res = await db.execute(select(User).where(User.is_google_connected == True))
                sync_user = u_res.scalars().first()

        if sync_user and sync_user.is_google_connected:
            try:
                await delete_google_calendar_event(
                    user=sync_user,
                    google_event_id=event.google_event_id,
                    db=db
                )
            except Exception as ge:
                print(f"[Google Calendar Delete Warning]: {ge}")

    await db.delete(event)
    await db.commit()
    return {"message": "Meeting deleted successfully", "id": event_id}
