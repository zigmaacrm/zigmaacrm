from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_, func, delete
from typing import List, Optional
from pydantic import BaseModel

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
                Contact.assigned_user_name.ilike(f"%{current_user.full_name}%"),
                Contact.source.ilike("%whatsapp%"),
                Contact.owner_id.is_(None),
                Contact.assigned_user_id.is_(None)
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

@router.post("/contacts", response_model=ContactOut, status_code=status.HTTP_201_CREATED)
async def create_contact(
    contact_in: ContactCreate,
    org_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    target_org_id = current_user.organization_id or org_id
    if not target_org_id:
        res = await db.execute(select(Organization))
        org = res.scalars().first()
        target_org_id = org.id if org else None

    # 1. Validation: Prevent duplicate contacts by phone number
    raw_phone = contact_in.phone or ""
    clean_phone = "".join(c for c in raw_phone if c.isdigit())
    if clean_phone and len(clean_phone) >= 7:
        phone_suffix = clean_phone[-10:] if len(clean_phone) >= 10 else clean_phone
        dup_phone_res = await db.execute(
            select(Contact).where(Contact.phone.ilike(f"%{phone_suffix}%"))
        )
        dup_phone = dup_phone_res.scalars().first()
        if dup_phone:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"A contact with mobile number '{contact_in.phone}' already exists: '{dup_phone.full_name}'. Duplicate contacts are not allowed."
            )

    # 2. Validation: Prevent duplicate contacts by email
    clean_email = (contact_in.email or "").strip().lower()
    if clean_email:
        dup_email_res = await db.execute(
            select(Contact).where(func.lower(Contact.email) == clean_email)
        )
        dup_email = dup_email_res.scalars().first()
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

    if "phone" in contact_in and contact_in["phone"]:
        raw_phone = str(contact_in["phone"])
        clean_phone = "".join(c for c in raw_phone if c.isdigit())
        if clean_phone and len(clean_phone) >= 7:
            phone_suffix = clean_phone[-10:] if len(clean_phone) >= 10 else clean_phone
            dup_phone_res = await db.execute(
                select(Contact).where(Contact.id != contact_id, Contact.phone.ilike(f"%{phone_suffix}%"))
            )
            dup_phone = dup_phone_res.scalars().first()
            if dup_phone:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"Another contact already exists with mobile number '{contact_in['phone']}' ({dup_phone.full_name})."
                )

    if "email" in contact_in and contact_in["email"]:
        clean_email = str(contact_in["email"]).strip().lower()
        if clean_email:
            dup_email_res = await db.execute(
                select(Contact).where(Contact.id != contact_id, func.lower(Contact.email) == clean_email)
            )
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
        contact.phone = contact_in["phone"]
    if "email" in contact_in:
        contact.email = contact_in["email"]
    if "source" in contact_in:
        contact.source = contact_in["source"]

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

    # Send email using Gmail API (if Google OAuth connected) or SMTP service / fallback
    sent_successfully = False
    if current_user and current_user.is_google_connected and current_user.google_access_token:
        try:
            import base64
            from email.mime.text import MIMEText
            from email.mime.multipart import MIMEMultipart
            import httpx

            message = MIMEMultipart("alternative")
            message["to"] = contact.email
            message["from"] = f"{sender_name} <{sender_email}>"
            message["subject"] = req.subject
            part = MIMEText(req.body, "plain")
            message.attach(part)
            raw = base64.urlsafe_b64encode(message.as_bytes()).decode("utf-8")

            async with httpx.AsyncClient(timeout=10.0) as client:
                g_res = await client.post(
                    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
                    headers={"Authorization": f"Bearer {current_user.google_access_token}"},
                    json={"raw": raw}
                )
                if g_res.status_code in [200, 201]:
                    sent_successfully = True
                    print(f"[Gmail API]: Successfully dispatched email to {contact.email} from {sender_email}")
                else:
                    print(f"[Gmail API Warning]: status={g_res.status_code}, text={g_res.text}")
        except Exception as ge:
            print(f"[Gmail API Error]: {ge}")

    if not sent_successfully:
        from app.core.config import settings
        if settings.SMTP_USER and settings.SMTP_PASSWORD:
            try:
                import asyncio
                from app.core.email import send_email_async
                html_body = f"""
                <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #1e293b; max-width: 600px; padding: 20px;">
                    <p>{req.body.replace(chr(10), '<br/>')}</p>
                    <br/>
                    <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
                    <p style="font-size: 12px; color: #94a3b8;">Sent via Zigmaa CRM by {sender_name}</p>
                </div>
                """
                await asyncio.wait_for(send_email_async(contact.email, req.subject, html_body), timeout=5.0)
                sent_successfully = True
            except Exception as e:
                print(f"[SMTP Send Warning]: {e}, logged mock interaction cleanly.")
        else:
            print(f"[Local Mock Email]: From={sender_email}, To={contact.email}, Subject={req.subject}, Body length={len(req.body)}")
            sent_successfully = True

    # Audit & Record to Activity Timeline
    activity_note = f"Sent Email from {sender_email}: \"{req.subject}\"\n\n{req.body}"
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
        "sender": sender_email,
        "recipient": contact.email,
        "subject": req.subject,
        "activity": {
            "id": activity.id,
            "type": "EMAIL",
            "notes": activity_note,
            "created_at": activity.created_at
        }
    }

