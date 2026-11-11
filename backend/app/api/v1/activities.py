from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_
from typing import List, Optional

from app.core.database import get_db
from app.models.activity import Activity
from app.models.organization_user import Organization, User
from app.api.deps import get_current_user
from app.schemas.activity_schema import ActivityCreate, ActivityOut

router = APIRouter()

@router.get("/activities", response_model=List[ActivityOut])
async def get_activities(
    contact_id: Optional[str] = Query(None),
    lead_id: Optional[str] = Query(None),
    deal_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    query = select(Activity).order_by(Activity.created_at.desc())
    if current_user.organization_id:
        query = query.where(Activity.organization_id == current_user.organization_id)
    if contact_id:
        query = query.where(Activity.contact_id == contact_id)
    if lead_id:
        query = query.where(Activity.lead_id == lead_id)
    if deal_id:
        query = query.where(Activity.deal_id == deal_id)
    result = await db.execute(query)
    return result.scalars().all()

@router.post("/activities", response_model=ActivityOut)
async def create_activity(
    activity_in: ActivityCreate,
    org_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    target_org_id = current_user.organization_id or org_id
    if not target_org_id:
        res = await db.execute(select(Organization))
        org = res.scalars().first()
        target_org_id = org.id if org else "default_org"

    act = Activity(
        organization_id=target_org_id,
        user_id=current_user.id,
        contact_id=activity_in.contact_id,
        lead_id=activity_in.lead_id,
        deal_id=activity_in.deal_id,
        type=activity_in.type,
        notes=activity_in.notes,
        status=activity_in.status or "COMPLETED",
        scheduled_at=activity_in.scheduled_at
    )
    db.add(act)
    await db.commit()
    await db.refresh(act)
    return act
