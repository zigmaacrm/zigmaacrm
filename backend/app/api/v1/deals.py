from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_
from typing import List, Optional, Any, Dict
from pydantic import BaseModel

from app.core.database import get_db
from app.models.deal import Deal
from app.models.lead_pipeline import Pipeline, PipelineStage, Lead
from app.models.contact import Contact
from app.models.organization_user import Organization, User
from app.api.deps import get_current_user
from app.models.activity import Activity
from app.schemas.deal_schema import DealCreate, DealOut, DealStageMove

router = APIRouter()

class DealStageUpdate(BaseModel):
    stage_id: Optional[str] = None
    stage: Optional[str] = None

@router.get("/deals")
async def get_deals(
    pipeline_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    query = select(Deal).order_by(Deal.id.desc())
    if pipeline_id:
        query = query.where(Deal.pipeline_id == pipeline_id)
    if current_user.role == "SALES_REP":
        query = query.where(
            or_(
                Deal.owner_id == current_user.id,
                Deal.assigned_user_id == current_user.id,
                Deal.owner_name.ilike(f"%{current_user.full_name}%")
            )
        )
    result = await db.execute(query)
    deals = result.scalars().all()

    stages_res = await db.execute(select(PipelineStage))
    all_stages = stages_res.scalars().all()
    stage_map = {s.id: s.title for s in all_stages}

    # Fetch contacts and leads to resolve contact details (phone, email, name, company)
    contacts_res = await db.execute(select(Contact))
    contacts_map = {c.id: c for c in contacts_res.scalars().all()}
    
    leads_res = await db.execute(select(Lead))
    leads_map = {l.id: l for l in leads_res.scalars().all()}

    legacy_map = {
        "Lead In": "New Deal",
        "Contact Made": "Discovery"
    }

    out = []
    for d in deals:
        raw_stage = (d.custom_data or {}).get("stage") or stage_map.get(d.stage_id, d.stage_id) or "New Deal"
        stage_name = legacy_map.get(raw_stage, raw_stage)
        cd = d.custom_data or {}
        contact = contacts_map.get(d.contact_id) if d.contact_id else None
        lead = leads_map.get(d.lead_id) if d.lead_id else None

        c_name = cd.get("contact_name") or (contact.name if contact else None) or (lead.full_name if lead else None) or ""
        comp_name = cd.get("company_name") or (contact.company_name if contact else None) or (lead.company_name if lead else None) or ""
        c_phone = cd.get("contact_phone") or cd.get("phone") or (contact.phone if contact else None) or (lead.phone if lead else None) or ""
        c_email = cd.get("contact_email") or cd.get("email") or (contact.email if contact else None) or (lead.email if lead else None) or ""

        out.append({
            "id": d.id,
            "organization_id": d.organization_id,
            "pipeline_id": d.pipeline_id,
            "stage_id": d.stage_id,
            "stage": stage_name,
            "title": d.title,
            "company_name": comp_name,
            "contact_name": c_name,
            "contact_phone": c_phone,
            "contact_email": c_email,
            "deal_value": d.deal_value,
            "value": d.deal_value,
            "currency": d.currency,
            "expected_close_date": d.expected_close_date,
            "close_date": d.expected_close_date,
            "status": d.status,
            "custom_data": {
                **cd,
                "company_name": comp_name,
                "contact_name": c_name,
                "contact_phone": c_phone,
                "contact_email": c_email
            },
            "custom_properties": d.custom_properties or d.custom_data or {},
            "lead_id": d.lead_id,
            "contact_id": d.contact_id,
            "assigned_user_id": d.assigned_user_id,
            "owner_id": d.owner_id,
            "owner_name": d.owner_name,
            "created_at": d.created_at.isoformat() if d.created_at else None,
            "updated_at": d.updated_at.isoformat() if d.updated_at else None
        })
    return out

@router.get("/deals/board")
async def get_deals_board(
    pipeline_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    # Retrieve pipeline
    if pipeline_id:
        p_res = await db.execute(select(Pipeline).where(Pipeline.id == pipeline_id))
        pipeline = p_res.scalar_one_or_none()
    else:
        p_res = await db.execute(select(Pipeline).order_by(Pipeline.is_default.desc(), Pipeline.created_at.asc()))
        pipeline = p_res.scalars().first()

    if not pipeline:
        return {"pipeline": None, "stages": []}

    stages_res = await db.execute(
        select(PipelineStage)
        .where(PipelineStage.pipeline_id == pipeline.id)
        .order_by(PipelineStage.stage_order.asc())
    )
    stages = stages_res.scalars().all()

    # Retrieve deals for this pipeline
    deals_query = select(Deal).where(Deal.pipeline_id == pipeline.id)
    if current_user.role == "SALES_REP":
        deals_query = deals_query.where(
            or_(
                Deal.owner_id == current_user.id,
                Deal.assigned_user_id == current_user.id,
                Deal.owner_name.ilike(f"%{current_user.full_name}%")
            )
        )
    deals_res = await db.execute(deals_query.order_by(Deal.updated_at.desc()))
    deals = deals_res.scalars().all()

    # Pre-fetch contacts and leads
    contacts_res = await db.execute(select(Contact))
    contacts_map = {c.id: c for c in contacts_res.scalars().all()}
    
    leads_res = await db.execute(select(Lead))
    leads_map = {l.id: l for l in leads_res.scalars().all()}

    # Also map lead / contact company and names if needed
    # Deduplicate deals so that each contact or lead only has ONE active deal across the entire board
    deduped_deals = []
    seen_entities = set()
    for d in deals:
        key = f"c_{d.contact_id}" if d.contact_id else f"l_{d.lead_id}" if d.lead_id else f"id_{d.id}"
        if key in seen_entities:
            continue
        seen_entities.add(key)
        deduped_deals.append(d)

    board_stages = []
    for st in stages:
        stage_deals = []
        total_value = 0.0
        for d in deduped_deals:
            # match by stage_id or case-insensitive title match
            if d.stage_id == st.id or d.stage_id == st.title:
                total_value += float(d.deal_value or 0.0)
                cd = d.custom_data or {}
                contact = contacts_map.get(d.contact_id) if d.contact_id else None
                lead = leads_map.get(d.lead_id) if d.lead_id else None

                c_name = cd.get("contact_name") or (contact.name if contact else None) or (lead.full_name if lead else None) or ""
                comp_name = cd.get("company_name") or (contact.company_name if contact else None) or (lead.company_name if lead else None) or ""
                c_phone = cd.get("contact_phone") or cd.get("phone") or (contact.phone if contact else None) or (lead.phone if lead else None) or ""
                c_email = cd.get("contact_email") or cd.get("email") or (contact.email if contact else None) or (lead.email if lead else None) or ""

                stage_deals.append({
                    "id": d.id,
                    "title": d.title,
                    "deal_value": d.deal_value,
                    "currency": d.currency,
                    "stage_id": d.stage_id,
                    "stage": st.title,
                    "probability": st.probability,
                    "expected_close_date": d.expected_close_date,
                    "company_name": comp_name,
                    "contact_name": c_name,
                    "contact_phone": c_phone,
                    "contact_email": c_email,
                    "assigned_user_id": d.assigned_user_id,
                    "status": d.status,
                    "custom_data": {
                        **cd,
                        "company_name": comp_name,
                        "contact_name": c_name,
                        "contact_phone": c_phone,
                        "contact_email": c_email
                    },
                    "custom_properties": d.custom_properties or d.custom_data or {},
                    "created_at": d.created_at.isoformat() if d.created_at else None
                })
        board_stages.append({
            "id": st.id,
            "title": st.title,
            "stage_order": st.stage_order,
            "probability": st.probability,
            "color_code": st.color_code,
            "count": len(stage_deals),
            "total_value": total_value,
            "deals": stage_deals
        })

    return {
        "pipeline": {
            "id": pipeline.id,
            "name": pipeline.name
        },
        "stages": board_stages
    }

@router.post("/deals")
async def create_deal(
    deal_in: DealCreate,
    org_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if not org_id or not isinstance(org_id, str):
        res = await db.execute(select(Organization))
        org = res.scalars().first()
        org_id = org.id if org else "default_org"

    # Resolve pipeline & stage if not provided or provided as names
    pipeline_id = deal_in.pipeline_id
    if not pipeline_id:
        p_res = await db.execute(select(Pipeline).order_by(Pipeline.is_default.desc(), Pipeline.created_at.asc()))
        first_p = p_res.scalars().first()
        pipeline_id = first_p.id if first_p else "default_pipeline"

    stage_input = (deal_in.stage or deal_in.stage_id or "New Deal").strip()
    
    # 1. Search PipelineStage by title or ID
    st_res = await db.execute(
        select(PipelineStage).where(
            PipelineStage.pipeline_id == pipeline_id,
            (PipelineStage.title.ilike(f"%{stage_input}%")) | (PipelineStage.id == stage_input)
        )
    )
    found_st = st_res.scalars().first()

    # 2. Check stage synonyms if not exact
    if not found_st:
        synonyms_map = {
            "New Deal": ["new", "lead in", "new deal"],
            "Discovery": ["discovery", "contact made", "contacted", "qualifying"],
            "Proposal Sent": ["proposal", "proposal sent", "quote"],
            "Negotiation": ["negotiation", "negotiating"],
            "Won": ["won", "closed won", "customer"],
            "Lost": ["lost", "closed lost"]
        }
        for st_canonical, syn_list in synonyms_map.items():
            if any(syn in stage_input.lower() for syn in syn_list):
                syn_res = await db.execute(
                    select(PipelineStage).where(
                        PipelineStage.pipeline_id == pipeline_id,
                        PipelineStage.title.ilike(f"%{st_canonical}%")
                    )
                )
                found_st = syn_res.scalars().first()
                if found_st:
                    break

    # 3. Default to first stage of pipeline if still unmatched
    if not found_st:
        st_first = await db.execute(
            select(PipelineStage).where(PipelineStage.pipeline_id == pipeline_id).order_by(PipelineStage.stage_order.asc())
        )
        found_st = st_first.scalars().first()

    stage_id = found_st.id if found_st else "default_stage"
    resolved_stage_title = found_st.title if found_st else stage_input

    owner_id = deal_in.owner_id or (current_user.id if current_user else None)
    owner_name = deal_in.owner_name or deal_in.assigned_user_name or (current_user.full_name if current_user else "Mohamed Thoufiq")
    assigned_user_id = deal_in.assigned_user_id or owner_id

    custom_props = dict(deal_in.custom_properties or deal_in.custom_data or {})
    custom_props["stage"] = resolved_stage_title

    is_won = "won" in resolved_stage_title.lower()
    is_lost = "lost" in resolved_stage_title.lower()
    deal_status = "WON" if is_won else "LOST" if is_lost else (deal_in.status or "OPEN")

    # 4. Strict Deduplication: Only ONE active deal per contact or lead is allowed across pipeline stages
    existing_deal = None
    conditions = []
    if deal_in.contact_id:
        conditions.append(Deal.contact_id == deal_in.contact_id)
    if deal_in.lead_id:
        conditions.append(Deal.lead_id == deal_in.lead_id)

    if conditions:
        existing_res = await db.execute(
            select(Deal).where(or_(*conditions)).order_by(Deal.updated_at.desc(), Deal.created_at.desc())
        )
        existing_deals = existing_res.scalars().all()
        if existing_deals:
            existing_deal = existing_deals[0]
            # If multiple redundant deals exist for this lead/contact, purge the duplicates
            if len(existing_deals) > 1:
                for dup_d in existing_deals[1:]:
                    await db.delete(dup_d)

    if existing_deal:
        deal = existing_deal
        deal.pipeline_id = pipeline_id
        deal.stage_id = stage_id
        if deal_in.title:
            deal.title = deal_in.title
        if deal_in.deal_value is not None:
            deal.deal_value = deal_in.deal_value
        if deal_in.currency:
            deal.currency = deal_in.currency
        if deal_in.expected_close_date:
            deal.expected_close_date = deal_in.expected_close_date
        deal.status = deal_status
        deal.custom_data = {**(deal.custom_data or {}), **custom_props, "stage": resolved_stage_title}
        deal.custom_properties = {**(deal.custom_properties or {}), **custom_props, "stage": resolved_stage_title}
        if deal_in.contact_id:
            deal.contact_id = deal_in.contact_id
        if deal_in.lead_id:
            deal.lead_id = deal_in.lead_id
        deal.owner_name = owner_name
        deal.assigned_user_id = assigned_user_id
    else:
        deal = Deal(
            organization_id=org_id,
            pipeline_id=pipeline_id,
            stage_id=stage_id,
            lead_id=deal_in.lead_id,
            contact_id=deal_in.contact_id,
            title=deal_in.title,
            deal_value=deal_in.deal_value,
            currency=deal_in.currency or "INR",
            expected_close_date=deal_in.expected_close_date,
            status=deal_status,
            custom_data=custom_props,
            custom_properties=custom_props,
            assigned_user_id=assigned_user_id,
            owner_id=owner_id,
            owner_name=owner_name
        )
        db.add(deal)

    # If linked to a contact, update contact's lifecycle stage and metadata
    if deal_in.contact_id:
        c_res = await db.execute(select(Contact).where(Contact.id == deal_in.contact_id))
        contact_obj = c_res.scalar_one_or_none()
        if contact_obj:
            if is_won:
                contact_obj.lifecycle_stage = "Customer"
                contact_obj.status = "CUSTOMER"
            elif any(w in resolved_stage_title.lower() for w in ["proposal", "negotiation"]):
                contact_obj.lifecycle_stage = "Qualified"
                contact_obj.status = "QUALIFIED"
            elif "discovery" in resolved_stage_title.lower():
                contact_obj.lifecycle_stage = "Interested"
                contact_obj.status = "INTERESTED"

            c_cd = dict(contact_obj.custom_data or {})
            c_cd["has_open_deal"] = True
            c_cd["latest_deal_id"] = deal.id
            c_cd["latest_deal_title"] = deal_in.title
            c_cd["latest_deal_stage"] = resolved_stage_title
            contact_obj.custom_data = c_cd

    await db.commit()
    await db.refresh(deal)

    return {
        "id": deal.id,
        "organization_id": deal.organization_id,
        "pipeline_id": deal.pipeline_id,
        "stage_id": deal.stage_id,
        "stage": resolved_stage_title,
        "title": deal.title,
        "deal_value": deal.deal_value,
        "value": deal.deal_value,
        "currency": deal.currency,
        "expected_close_date": deal.expected_close_date,
        "close_date": deal.expected_close_date,
        "status": deal.status,
        "custom_data": custom_props,
        "custom_properties": custom_props,
        "lead_id": deal.lead_id,
        "contact_id": deal.contact_id,
        "assigned_user_id": deal.assigned_user_id,
        "owner_id": deal.owner_id,
        "owner_name": deal.owner_name,
        "created_at": deal.created_at.isoformat() if deal.created_at else None,
        "updated_at": deal.updated_at.isoformat() if deal.updated_at else None
    }

@router.patch("/deals/{deal_id}")
async def update_deal(
    deal_id: str,
    deal_in: dict,
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(select(Deal).where(Deal.id == deal_id))
    deal = result.scalar_one_or_none()
    if not deal:
        raise HTTPException(status_code=404, detail="Deal not found")

    if "custom_properties" in deal_in:
        deal.custom_properties = deal_in["custom_properties"]
        deal.custom_data = deal_in["custom_properties"]
    elif "custom_data" in deal_in:
        deal.custom_data = deal_in["custom_data"]
        deal.custom_properties = deal_in["custom_data"]

    # If stage or stage_id is passed to update_deal, handle stage resolution properly
    target_stage = deal_in.get("stage") or deal_in.get("stage_id")
    if target_stage:
        st_res = await db.execute(
            select(PipelineStage).where(
                (PipelineStage.id == target_stage) | (PipelineStage.title.ilike(target_stage))
            )
        )
        stage_obj = st_res.scalars().first()
        if not stage_obj:
            synonyms_map = {
                "New Deal": ["lead in", "new deal", "new"],
                "Discovery": ["contact made", "discovery", "qualifying"],
                "Proposal Sent": ["proposal sent", "proposal"],
                "Negotiation": ["negotiation", "negotiating"],
                "Won": ["won", "closed won"],
                "Lost": ["lost", "closed lost"],
            }
            for std_name, syns in synonyms_map.items():
                if target_stage.lower() in syns or any(s in target_stage.lower() for s in syns):
                    st_res = await db.execute(
                        select(PipelineStage).where(PipelineStage.title.ilike(std_name))
                    )
                    stage_obj = st_res.scalars().first()
                    if stage_obj:
                        break
        if stage_obj:
            deal.stage_id = stage_obj.id
            cdata = dict(deal.custom_data or {})
            cdata["stage"] = stage_obj.title
            deal.custom_data = cdata
            if "won" in stage_obj.title.lower():
                deal.status = "WON"
            elif "lost" in stage_obj.title.lower():
                deal.status = "LOST"

    for key, val in deal_in.items():
        if key not in ["id", "created_at", "custom_properties", "custom_data", "stage", "stage_id"] and hasattr(deal, key):
            setattr(deal, key, val)

    await db.commit()
    await db.refresh(deal)
    return deal

@router.patch("/deals/{deal_id}/stage")
@router.patch("/deals/{deal_id}/move-stage")
async def update_deal_stage(
    deal_id: str,
    move_in: DealStageUpdate,
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(select(Deal).where(Deal.id == deal_id))
    deal = result.scalar_one_or_none()
    if not deal:
        raise HTTPException(status_code=404, detail="Deal not found")

    target_stage = move_in.stage_id or move_in.stage
    if not target_stage:
        raise HTTPException(status_code=400, detail="stage_id or stage is required")

    # Try resolving stage by ID or Title
    stage_res = await db.execute(
        select(PipelineStage).where(
            (PipelineStage.id == target_stage) | (PipelineStage.title.ilike(target_stage))
        )
    )
    stage = stage_res.scalars().first()

    if not stage:
        synonyms_map = {
            "New Deal": ["lead in", "new deal", "new"],
            "Discovery": ["contact made", "discovery", "qualifying"],
            "Proposal Sent": ["proposal sent", "proposal"],
            "Negotiation": ["negotiation", "negotiating"],
            "Won": ["won", "closed won"],
            "Lost": ["lost", "closed lost"],
        }
        for std_name, syns in synonyms_map.items():
            if target_stage.lower() in syns or any(s in target_stage.lower() for s in syns):
                stage_res = await db.execute(
                    select(PipelineStage).where(PipelineStage.title.ilike(std_name))
                )
                stage = stage_res.scalars().first()
                if stage:
                    break

    # If still not found, create a new PipelineStage dynamically to guarantee foreign key integrity
    if not stage:
        import uuid
        new_stage = PipelineStage(
            id=str(uuid.uuid4()),
            pipeline_id=deal.pipeline_id,
            title=target_stage,
            stage_order=99,
            probability=50,
            color_code="#6366F1"
        )
        db.add(new_stage)
        await db.flush()
        stage = new_stage

    deal.stage_id = stage.id
    stage_title = stage.title

    # Update deal status if moved to won or lost
    if "won" in stage_title.lower():
        deal.status = "WON"
    elif "lost" in stage_title.lower():
        deal.status = "LOST"
    else:
        deal.status = "OPEN"

    # Always persist human-readable stage in custom_data as well
    cdata = dict(deal.custom_data or {})
    cdata["stage"] = stage_title
    deal.custom_data = cdata

    # Log activity
    act = Activity(
        organization_id=deal.organization_id,
        deal_id=deal.id,
        lead_id=deal.lead_id,
        type="STAGE_CHANGE",
        notes=f"Deal stage moved to '{stage_title}'",
        status="COMPLETED"
    )
    db.add(act)
    await db.commit()
    await db.refresh(deal)
    return {
        "success": True,
        "deal_id": deal.id,
        "stage_id": deal.stage_id,
        "stage": stage_title,
        "status": deal.status
    }

@router.delete("/deals/{deal_id}")
async def delete_deal(
    deal_id: str,
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(select(Deal).where(Deal.id == deal_id))
    deal = result.scalar_one_or_none()
    if not deal:
        raise HTTPException(status_code=404, detail="Deal not found")
    await db.delete(deal)
    await db.commit()
    return {"message": "Deal deleted successfully"}
