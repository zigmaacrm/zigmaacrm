from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_, func, delete
from typing import List, Optional, Dict, Any
from pydantic import BaseModel
from datetime import datetime

from app.core.database import get_db
from app.models.contact import Contact
from app.models.deal import Deal
from app.models.activity import Activity
from app.models.organization_user import Organization, User
from app.api.deps import get_current_user, get_optional_current_user
from app.schemas.contact_schema import ContactCreate, ContactOut

router = APIRouter()

@router.get("/contacts/verify-whatsapp")
async def verify_whatsapp_contacts(
    db: AsyncSession = Depends(get_db)
):
    """
    Direct verification endpoint to check if records with source='WhatsApp'
    exist in the PostgreSQL database contacts table.
    """
    total_res = await db.execute(select(func.count(Contact.id)))
    total_contacts = total_res.scalar() or 0

    wa_res = await db.execute(
        select(Contact)
        .where(Contact.source.ilike("%whatsapp%"))
        .order_by(Contact.created_at.desc())
    )
    wa_contacts = wa_res.scalars().all()

    return {
        "status": "success",
        "total_contacts_in_db": total_contacts,
        "whatsapp_contacts_count": len(wa_contacts),
        "whatsapp_contacts": [
            {
                "id": c.id,
                "full_name": c.full_name,
                "phone": c.phone,
                "source": c.source,
                "lifecycle_stage": c.lifecycle_stage,
                "created_at": c.created_at.isoformat() if c.created_at else None
            }
            for c in wa_contacts
        ]
    }

@router.get("/contacts", response_model=List[ContactOut])
async def get_contacts(
    search: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    source: Optional[str] = Query(None),
    org_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    query = select(Contact).order_by(Contact.created_at.desc())
    if current_user.role == "SALES_REP":
        query = query.where(
            or_(
                Contact.owner_id == current_user.id,
                Contact.assigned_user_id == current_user.id,
                Contact.owner_name.ilike(f"%{current_user.full_name}%"),
                Contact.assigned_user_name.ilike(f"%{current_user.full_name}%")
            )
        )
    target_org = org_id or current_user.organization_id
    if target_org:
        query = query.where(Contact.organization_id == target_org)
    if status:
        query = query.where(Contact.status == status)
    if source:
        query = query.where(Contact.source.ilike(f"%{source}%"))
    if search:
        term = f"%{search}%"
        query = query.where(
            or_(
                Contact.full_name.ilike(term),
                Contact.phone.ilike(term),
                Contact.email.ilike(term),
                Contact.company_name.ilike(term)
            )
        )
    result = await db.execute(query)
    contacts = result.scalars().all()

    # Calculate total deals and lifetime value for each contact
    out_list = []
    for c in contacts:
        deal_count_res = await db.execute(
            select(func.count(Deal.id)).where(Deal.contact_id == c.id)
        )
        deal_count = deal_count_res.scalar() or 0

        # Calculate sum of won deals
        ltv_res = await db.execute(
            select(func.sum(Deal.deal_value)).where(
                Deal.contact_id == c.id,
                Deal.status.ilike("%WON%")
            )
        )
        lifetime_value = ltv_res.scalar() or 0.0

        c_dict = {
            "id": c.id,
            "organization_id": c.organization_id,
            "full_name": c.full_name,
            "name": c.full_name,
            "email": c.email,
            "phone": c.phone,
            "company_name": c.company_name,
            "company": c.company_name,
            "designation": c.designation or c.job_title,
            "job_title": c.job_title or c.designation,
            "status": c.status or c.lifecycle_stage or "NEW",
            "lifecycle_stage": c.lifecycle_stage or c.status or "NEW",
            "source": c.source or "MANUAL",
            "custom_data": c.custom_data or {},
            "custom_properties": c.custom_properties or c.custom_data or {},
            "assigned_user_name": c.assigned_user_name or "Mohamed Thoufiq",
            "assigned_to": c.assigned_user_name or "Mohamed Thoufiq",
            "assigned_user_id": c.assigned_user_id,
            "created_at": c.created_at,
            "updated_at": c.updated_at,
            "total_deals": deal_count,
            "lifetime_value": float(lifetime_value)
        }
        out_list.append(c_dict)

    return out_list

@router.get("/contacts/{contact_id}")
async def get_contact_detail(
    contact_id: str,
    db: AsyncSession = Depends(get_db)
):
    res = await db.execute(select(Contact).where(Contact.id == contact_id))
    contact = res.scalar_one_or_none()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")

    # Fetch linked deals
    deals_res = await db.execute(select(Deal).where(Deal.contact_id == contact.id).order_by(Deal.created_at.desc()))
    deals = deals_res.scalars().all()

    # Fetch timeline activities
    deal_ids = [d.id for d in deals]
    conditions = [
        or_(
            Activity.contact_id == contact.id,
            Activity.lead_id == contact.id
        )
    ]
    if deal_ids:
        conditions.append(Activity.deal_id.in_(deal_ids))

    act_res = await db.execute(
        select(Activity)
        .where(or_(*conditions))
        .order_by(Activity.created_at.desc())
    )
    activities = act_res.scalars().all()

    deal_count = len(deals)
    ltv = sum(float(d.deal_value or 0.0) for d in deals if "won" in (d.status or "").lower())

    return {
        "id": contact.id,
        "organization_id": contact.organization_id,
        "full_name": contact.full_name,
        "email": contact.email,
        "phone": contact.phone,
        "company_name": contact.company_name,
        "designation": contact.designation or contact.job_title,
        "job_title": contact.job_title or contact.designation,
        "status": contact.status or contact.lifecycle_stage or "NEW",
        "lifecycle_stage": contact.lifecycle_stage or contact.status or "NEW",
        "source": contact.source or "MANUAL",
        "custom_data": contact.custom_data or {},
        "assigned_user_name": contact.assigned_user_name or "Mohamed Thoufiq",
        "assigned_user_id": contact.assigned_user_id,
        "created_at": contact.created_at,
        "updated_at": contact.updated_at,
        "total_deals": deal_count,
        "lifetime_value": ltv,
        "deals": [
            {
                "id": d.id,
                "title": d.title,
                "deal_value": d.deal_value,
                "currency": d.currency,
                "status": d.status,
                "expected_close_date": d.expected_close_date,
                "created_at": d.created_at
            }
            for d in deals
        ],
        "activities": [
            {
                "id": a.id,
                "type": a.type,
                "notes": a.notes,
                "status": a.status,
                "created_at": a.created_at
            }
            for a in activities
        ]
    }

# In-memory cache fallback for AI insights with 1 hour TTL
_ai_insights_cache = {}

@router.get("/contacts/{contact_id}/ai-insights")
async def get_contact_ai_insights(
    contact_id: str,
    refresh: bool = Query(False),
    db: AsyncSession = Depends(get_db)
):
    import time
    from app.services.ai_insights import AIInsightsService

    cache_key = f"ai_insights_{contact_id}"
    now = time.time()

    # Check cache if not explicitly refreshing
    if not refresh and cache_key in _ai_insights_cache:
        cached_entry = _ai_insights_cache[cache_key]
        if now - cached_entry["timestamp"] < 3600:  # 1 hour cache
            return cached_entry["data"]

    # Try Redis cache if available
    try:
        import redis.asyncio as aioredis
        from app.core.config import settings
        r = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
        if not refresh:
            cached_val = await r.get(cache_key)
            if cached_val:
                import json
                return json.loads(cached_val)
    except Exception:
        r = None

    # Fetch contact
    res = await db.execute(select(Contact).where(Contact.id == contact_id))
    contact = res.scalar_one_or_none()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")

    # Fetch linked deals
    deals_res = await db.execute(select(Deal).where(Deal.contact_id == contact.id))
    deals = deals_res.scalars().all()
    deals_data = [
        {"id": d.id, "title": d.title, "deal_value": d.deal_value, "status": d.status}
        for d in deals
    ]

    # Fetch past activities & notes
    deal_ids = [d.id for d in deals]
    conditions = [Activity.lead_id == contact.id]
    if deal_ids:
        conditions.append(Activity.deal_id.in_(deal_ids))

    act_res = await db.execute(
        select(Activity)
        .where(or_(*conditions))
        .order_by(Activity.created_at.desc())
    )
    activities = act_res.scalars().all()
    notes = [
        a.notes for a in activities if a.notes
    ]

    contact_dict = {
        "id": contact.id,
        "full_name": contact.full_name,
        "company_name": contact.company_name,
        "job_title": contact.job_title,
        "status": contact.status,
        "lifecycle_stage": contact.lifecycle_stage,
        "source": contact.source,
        "custom_data": contact.custom_data or {}
    }

    # Run AI Analysis
    insights = await AIInsightsService.analyze_prospect(contact_dict, notes, deals_data)

    # Store in cache
    _ai_insights_cache[cache_key] = {
        "timestamp": now,
        "data": insights
    }
    if r:
        try:
            import json
            await r.setex(cache_key, 3600, json.dumps(insights))
            await r.aclose()
        except Exception:
            pass

    return insights

class BulkImportContactItem(BaseModel):
    name: Optional[str] = None
    full_name: Optional[str] = None
    phone: Optional[str] = ""
    email: Optional[str] = None
    company_name: Optional[str] = None
    company: Optional[str] = None
    designation: Optional[str] = None
    job_title: Optional[str] = None
    source: Optional[str] = "Excel/CSV Import"
    status: Optional[str] = "NEW"
    lifecycle_stage: Optional[str] = "NEW"
    custom_data: Optional[Dict[str, Any]] = None

class BulkImportContactsPayload(BaseModel):
    contacts: List[BulkImportContactItem]
    upsert: Optional[bool] = True

@router.post("/contacts/bulk-import")
async def bulk_import_contacts(
    payload: BulkImportContactsPayload,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    target_org_id = current_user.organization_id
    if not target_org_id:
        res = await db.execute(select(Organization))
        org = res.scalars().first()
        target_org_id = org.id if org else None

    default_owner = current_user.full_name or "Mohamed Thoufiq"

    # Pre-fetch existing contacts for fast lookup strictly scoped to target_org_id
    existing_query = select(Contact)
    if target_org_id:
        existing_query = existing_query.where(Contact.organization_id == target_org_id)
    existing_contacts_res = await db.execute(existing_query)
    all_existing = existing_contacts_res.scalars().all()

    phone_map = {}
    email_map = {}
    for c in all_existing:
        if c.phone:
            clean = "".join(ch for ch in c.phone if ch.isdigit())
            if len(clean) >= 7:
                phone_map[clean[-10:]] = c
        if c.email:
            email_map[c.email.strip().lower()] = c

    created_count = 0
    updated_count = 0
    skipped_count = 0

    batch_seen_phones = set()
    batch_seen_emails = set()

    for item in payload.contacts:
        c_name = (item.name or item.full_name or "Unnamed Contact").strip()
        raw_phone = (item.phone or "").strip()
        clean_digits = "".join(ch for ch in raw_phone if ch.isdigit())
        phone_suffix = clean_digits[-10:] if len(clean_digits) >= 10 else (clean_digits if len(clean_digits) >= 7 else None)
        clean_email = (item.email or "").strip().lower() if item.email else None
        c_company = item.company_name or item.company
        c_job = item.designation or item.job_title
        c_status = item.status or item.lifecycle_stage or "NEW"
        c_source = item.source or "Excel/CSV Import"

        # Check existing
        existing_contact = None
        if phone_suffix and phone_suffix in phone_map:
            existing_contact = phone_map[phone_suffix]
        elif clean_email and clean_email in email_map:
            existing_contact = email_map[clean_email]

        if existing_contact:
            if payload.upsert:
                if c_name and c_name != "Unnamed Contact":
                    existing_contact.full_name = c_name
                if c_company:
                    existing_contact.company_name = c_company
                if c_job:
                    existing_contact.designation = c_job
                    existing_contact.job_title = c_job
                if c_status:
                    existing_contact.status = c_status
                    existing_contact.lifecycle_stage = c_status
                if item.custom_data:
                    existing_contact.custom_data = {**(existing_contact.custom_data or {}), **item.custom_data}
                updated_count += 1
            else:
                skipped_count += 1
            continue

        # Intra-batch duplicate check
        if phone_suffix and phone_suffix in batch_seen_phones:
            skipped_count += 1
            continue
        if clean_email and clean_email in batch_seen_emails:
            skipped_count += 1
            continue

        # Create new
        new_c = Contact(
            organization_id=target_org_id,
            full_name=c_name,
            phone=raw_phone,
            email=clean_email,
            company_name=c_company,
            designation=c_job,
            job_title=c_job,
            status=c_status,
            lifecycle_stage=c_status,
            source=c_source,
            custom_data=item.custom_data or {},
            assigned_user_id=current_user.id,
            assigned_user_name=default_owner,
            owner_id=current_user.id,
            owner_name=default_owner
        )
        db.add(new_c)
        if phone_suffix:
            phone_map[phone_suffix] = new_c
            batch_seen_phones.add(phone_suffix)
        if clean_email:
            email_map[clean_email] = new_c
            batch_seen_emails.add(clean_email)
        created_count += 1

    await db.commit()

    return {
        "status": "success",
        "total_processed": len(payload.contacts),
        "created": created_count,
        "updated": updated_count,
        "skipped": skipped_count,
        "total_ingested": created_count + updated_count,
        "duplicates_skipped": skipped_count
    }

@router.post("/contacts", response_model=ContactOut, status_code=status.HTTP_201_CREATED)
async def create_contact(
    contact_in: ContactCreate,
    org_id: Optional[str] = Query(None),
    upsert: Optional[bool] = Query(False),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    target_org_id = current_user.organization_id or org_id
    if not target_org_id:
        res = await db.execute(select(Organization))
        org = res.scalars().first()
        target_org_id = org.id if org else None

    # 1. Validation: Prevent duplicate contacts by phone number within the same organization
    raw_phone = contact_in.phone or ""
    clean_phone = "".join(c for c in raw_phone if c.isdigit())
    dup_phone = None
    if clean_phone and len(clean_phone) >= 7:
        phone_suffix = clean_phone[-10:] if len(clean_phone) >= 10 else clean_phone
        dup_query = select(Contact).where(Contact.phone.ilike(f"%{phone_suffix}%"))
        if target_org_id:
            dup_query = dup_query.where(Contact.organization_id == target_org_id)
        dup_phone_res = await db.execute(dup_query)
        dup_phone = dup_phone_res.scalars().first()

    # 2. Validation: Prevent duplicate contacts by email within the same organization
    clean_email = (contact_in.email or "").strip().lower()
    dup_email = None
    if clean_email:
        dup_email_query = select(Contact).where(func.lower(Contact.email) == clean_email)
        if target_org_id:
            dup_email_query = dup_email_query.where(Contact.organization_id == target_org_id)
        dup_email_res = await db.execute(dup_email_query)
        dup_email = dup_email_res.scalars().first()

    existing_contact = dup_phone or dup_email
    if existing_contact:
        if upsert:
            designation = contact_in.designation or contact_in.job_title
            c_name = contact_in.name or contact_in.full_name
            c_company = contact_in.company or contact_in.company_name
            if c_name and c_name != "Unnamed Contact":
                existing_contact.full_name = c_name
            if c_company:
                existing_contact.company_name = c_company
            if designation:
                existing_contact.designation = designation
                existing_contact.job_title = designation
            if contact_in.status or contact_in.lifecycle_stage:
                existing_contact.status = contact_in.status or contact_in.lifecycle_stage
                existing_contact.lifecycle_stage = contact_in.lifecycle_stage or contact_in.status
            custom_props = contact_in.custom_properties or contact_in.custom_data or {}
            if custom_props:
                existing_contact.custom_data = {**(existing_contact.custom_data or {}), **custom_props}
            await db.commit()
            await db.refresh(existing_contact)
            return existing_contact
        else:
            if dup_phone:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"A contact with mobile number '{contact_in.phone}' already exists: '{dup_phone.full_name}'. Duplicate contacts are not allowed."
                )
            if dup_email:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"A contact with email '{contact_in.email}' already exists: '{dup_email.full_name}'. Duplicate contacts are not allowed."
                )

    designation = contact_in.designation or contact_in.job_title
    assigned_name = contact_in.assigned_to or contact_in.assigned_user_name or (current_user.full_name if current_user else "Mohamed Thoufiq")
    owner_id = current_user.id if current_user else None
    owner_name = current_user.full_name if current_user else assigned_name
    custom_props = contact_in.custom_properties or contact_in.custom_data or {}
    c_name = contact_in.name or contact_in.full_name or "Unnamed Contact"
    c_company = contact_in.company or contact_in.company_name

    try:
        contact = Contact(
            organization_id=target_org_id,
            full_name=c_name,
            email=contact_in.email,
            phone=contact_in.phone or "",
            company_name=c_company,
            designation=designation,
            job_title=contact_in.job_title or designation,
            status=contact_in.status or contact_in.lifecycle_stage or "NEW",
            lifecycle_stage=contact_in.lifecycle_stage or contact_in.status or "NEW",
            source=contact_in.source or "MANUAL",
            custom_data=custom_props,
            custom_properties=custom_props,
            assigned_user_name=assigned_name,
            assigned_user_id=owner_id,
            owner_id=owner_id,
            owner_name=owner_name
        )
        db.add(contact)
        await db.commit()
        await db.refresh(contact)
    except Exception as e:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to create contact: {str(e)}"
        )

    return {
        "id": contact.id,
        "organization_id": contact.organization_id,
        "full_name": contact.full_name,
        "name": contact.full_name,
        "email": contact.email,
        "phone": contact.phone,
        "company_name": contact.company_name,
        "company": contact.company_name,
        "designation": contact.designation,
        "job_title": contact.job_title,
        "status": contact.status,
        "lifecycle_stage": contact.lifecycle_stage,
        "source": contact.source,
        "custom_data": contact.custom_data or {},
        "custom_properties": contact.custom_properties or contact.custom_data or {},
        "assigned_user_name": contact.assigned_user_name,
        "assigned_to": contact.assigned_user_name,
        "assigned_user_id": contact.assigned_user_id,
        "created_at": contact.created_at,
        "updated_at": contact.updated_at,
        "total_deals": 0,
        "lifetime_value": 0.0
    }

@router.patch("/contacts/{contact_id}")
@router.put("/contacts/{contact_id}")
async def update_contact(
    contact_id: str,
    contact_in: dict,
    db: AsyncSession = Depends(get_db)
):
    res = await db.execute(select(Contact).where(Contact.id == contact_id))
    contact = res.scalar_one_or_none()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")

    target_org_id = contact.organization_id

    # Only validate phone uniqueness if phone is actually being changed to a different number
    if "phone" in contact_in and contact_in["phone"]:
        raw_phone = str(contact_in["phone"]).strip()
        clean_phone = "".join(c for c in raw_phone if c.isdigit())
        curr_clean_phone = "".join(c for c in (contact.phone or "") if c.isdigit())
        if clean_phone and len(clean_phone) >= 7 and clean_phone != curr_clean_phone:
            phone_suffix = clean_phone[-10:] if len(clean_phone) >= 10 else clean_phone
            dup_stmt = select(Contact).where(
                Contact.id != contact_id,
                Contact.phone.ilike(f"%{phone_suffix}%")
            )
            if target_org_id:
                dup_stmt = dup_stmt.where(Contact.organization_id == target_org_id)
            dup_phone_res = await db.execute(dup_stmt)
            dup_phone = dup_phone_res.scalars().first()
            if dup_phone:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"Another contact already exists with mobile number '{contact_in['phone']}' ({dup_phone.full_name})."
                )

    # Only validate email uniqueness if email is actually being changed to a different email
    if "email" in contact_in and contact_in["email"]:
        clean_email = str(contact_in["email"]).strip().lower()
        curr_clean_email = str(contact.email or "").strip().lower()
        if clean_email and clean_email != curr_clean_email:
            dup_stmt = select(Contact).where(
                Contact.id != contact_id,
                func.lower(Contact.email) == clean_email
            )
            if target_org_id:
                dup_stmt = dup_stmt.where(Contact.organization_id == target_org_id)
            dup_email_res = await db.execute(dup_stmt)
            dup_email = dup_email_res.scalars().first()
            if dup_email:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"Another contact already exists with email '{contact_in['email']}' ({dup_email.full_name})."
                )

    # 1. Map standard names
    if "full_name" in contact_in and contact_in["full_name"]:
        contact.full_name = str(contact_in["full_name"]).strip()
    elif "name" in contact_in and contact_in["name"]:
        contact.full_name = str(contact_in["name"]).strip()

    if "company_name" in contact_in:
        contact.company_name = contact_in["company_name"]
    elif "company" in contact_in:
        contact.company_name = contact_in["company"]

    if "designation" in contact_in:
        contact.designation = contact_in["designation"]
        contact.job_title = contact_in["designation"]
    elif "job_title" in contact_in:
        contact.job_title = contact_in["job_title"]
        contact.designation = contact_in["job_title"]

    if "assigned_user_name" in contact_in:
        contact.assigned_user_name = contact_in["assigned_user_name"]
    elif "assigned_to" in contact_in:
        contact.assigned_user_name = contact_in["assigned_to"]

    if "lifecycle_stage" in contact_in:
        contact.lifecycle_stage = contact_in["lifecycle_stage"]
        contact.status = contact_in["lifecycle_stage"]
    elif "status" in contact_in:
        contact.status = contact_in["status"]
        contact.lifecycle_stage = contact_in["status"]

    if "phone" in contact_in:
        contact.phone = str(contact_in["phone"]).strip() if contact_in["phone"] else None
    if "email" in contact_in:
        contact.email = str(contact_in["email"]).strip() if contact_in["email"] else None
    if "source" in contact_in:
        contact.source = contact_in["source"]

    contact.updated_at = datetime.utcnow()

    # 2. Custom properties & custom data handling
    if "custom_properties" in contact_in and isinstance(contact_in["custom_properties"], dict):
        current_props = dict(contact.custom_properties or {})
        current_props.update(contact_in["custom_properties"])
        contact.custom_properties = current_props
        contact.custom_data = current_props
    elif "custom_data" in contact_in and isinstance(contact_in["custom_data"], dict):
        current_data = dict(contact.custom_data or {})
        current_data.update(contact_in["custom_data"])
        contact.custom_data = current_data
        contact.custom_properties = current_data

    # Map any dynamic custom fields passed as top-level keys
    known_cols = {
        "id", "organization_id", "full_name", "name", "phone", "email",
        "company", "company_name", "designation", "job_title", "source",
        "status", "lifecycle_stage", "custom_data", "custom_properties",
        "assigned_user_name", "assigned_to", "assigned_user_id", "owner_id",
        "owner_name", "created_at", "updated_at", "total_deals", "lifetime_value"
    }
    extra_fields = {k: v for k, v in contact_in.items() if k not in known_cols}
    if extra_fields:
        curr_props = dict(contact.custom_properties or {})
        curr_props.update(extra_fields)
        contact.custom_properties = curr_props
        contact.custom_data = curr_props

    await db.commit()
    await db.refresh(contact)

    return {
        "id": contact.id,
        "organization_id": contact.organization_id,
        "full_name": contact.full_name,
        "name": contact.full_name,
        "email": contact.email,
        "phone": contact.phone,
        "company_name": contact.company_name,
        "company": contact.company_name,
        "designation": contact.designation,
        "job_title": contact.job_title,
        "status": contact.status,
        "lifecycle_stage": contact.lifecycle_stage,
        "source": contact.source,
        "custom_data": contact.custom_data or {},
        "custom_properties": contact.custom_properties or {},
        "assigned_user_name": contact.assigned_user_name,
        "assigned_to": contact.assigned_user_name,
        "created_at": contact.created_at,
        "updated_at": contact.updated_at
    }

class BulkDeleteContactsRequest(BaseModel):
    contact_ids: List[str]

@router.delete("/contacts/bulk-delete")
async def bulk_delete_contacts(
    payload: BulkDeleteContactsRequest,
    db: AsyncSession = Depends(get_db)
):
    if not payload.contact_ids:
        return {"message": "No contact IDs provided", "deleted_count": 0}

    # Delete associated activities if any
    await db.execute(
        delete(Activity).where(
            or_(
                Activity.contact_id.in_(payload.contact_ids),
                Activity.lead_id.in_(payload.contact_ids)
            )
        )
    )

    # Delete contacts
    result = await db.execute(
        delete(Contact).where(Contact.id.in_(payload.contact_ids))
    )
    await db.commit()
    deleted_count = result.rowcount or len(payload.contact_ids)

    return {
        "status": "success",
        "message": f"{deleted_count} contacts deleted successfully",
        "deleted_count": deleted_count
    }

@router.delete("/contacts/{contact_id}")
async def delete_contact(
    contact_id: str,
    db: AsyncSession = Depends(get_db)
):
    res = await db.execute(select(Contact).where(Contact.id == contact_id))
    contact = res.scalar_one_or_none()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")

    await db.delete(contact)
    await db.commit()
    return {"message": "Contact deleted successfully"}


from pydantic import BaseModel

class SendEmailRequest(BaseModel):
    subject: str
    body: str

@router.post("/contacts/{contact_id}/send-email")
async def send_contact_email(
    contact_id: str,
    req: SendEmailRequest,
    current_user: Optional[User] = Depends(get_optional_current_user),
    db: AsyncSession = Depends(get_db)
):
    res = await db.execute(select(Contact).where(Contact.id == contact_id))
    contact = res.scalar_one_or_none()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")

    if not contact.email:
        raise HTTPException(status_code=400, detail="This contact does not have a registered email address")

    if not req.subject.strip() or not req.body.strip():
        raise HTTPException(status_code=400, detail="Subject and body cannot be empty")

    sender_email = (
        (current_user.google_email if current_user and current_user.google_email else None)
        or (current_user.email if current_user and current_user.email else None)
        or "team@zigmaacrm.com"
    )
    sender_name = (current_user.full_name if current_user and current_user.full_name else None) or contact.assigned_user_name or "Team"

    # Send email using Gmail API (if Google OAuth connected) or fallback to SMTP
    from app.services.gmail_service import dispatch_email_service
    dispatch_res = await dispatch_email_service(
        db=db,
        current_user=current_user,
        to_email=contact.email,
        subject=req.subject,
        body=req.body,
        contact_id=contact.id
    )

    actual_sender = dispatch_res.get("sender") or sender_email

    # Audit & Record to Activity Timeline
    rfc_id_note = f"\nMessage-ID: {dispatch_res.get('rfc_message_id', '')}" if dispatch_res.get('rfc_message_id') else ""
    activity_note = f"Sent Email ({dispatch_res.get('channel', 'email')}) from {actual_sender}: \"{req.subject}\"{rfc_id_note}\n\n{req.body}"
    activity = Activity(
        organization_id=contact.organization_id or (current_user.organization_id if current_user else "default-org"),
        contact_id=contact.id,
        lead_id=None,
        type="EMAIL",
        notes=activity_note,
        status="COMPLETED"
    )
    db.add(activity)
    await db.commit()

    return {
        "status": "success",
        "message": f"Email successfully sent to {contact.email}",
        "sender": actual_sender,
        "recipient": contact.email,
        "subject": req.subject,
        "channel": dispatch_res.get("channel"),
        "message_id": dispatch_res.get("message_id"),
        "rfc_message_id": dispatch_res.get("rfc_message_id"),
        "thread_id": dispatch_res.get("thread_id"),
        "activity": {
            "id": activity.id,
            "type": "EMAIL",
            "notes": activity_note,
            "created_at": activity.created_at
        }
    }

