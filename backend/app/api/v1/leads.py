from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_
from typing import List, Optional
from datetime import datetime

from app.core.database import get_db
from app.api.deps import get_current_user
from app.models.organization_user import Organization, User
from app.models.lead_pipeline import Lead, Pipeline, PipelineStage
from app.models.contact import Contact
from app.models.deal import Deal
from app.models.activity import Activity
from app.schemas.lead_schema import LeadCreate, LeadOut, BulkUploadResponse, LeadConvertRequest, LeadConvertResponse
from app.services.lead_service import LeadService
from app.services.csv_parser_service import CSVParserService

router = APIRouter()

@router.get("/leads", response_model=List[LeadOut])
async def get_leads(
    org_id: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    source: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    query = select(Lead).order_by(Lead.id.desc())

    # Multi-tenant isolation: strictly scope to current user's organization
    target_org = current_user.organization_id or org_id
    if target_org:
        query = query.where(Lead.organization_id == target_org)

    # Role-based scoping: sales reps can only view leads assigned to them
    if (current_user.role or "").upper() == "SALES_REP":
        query = query.where(
            or_(
                Lead.assigned_user_id == current_user.id,
                Lead.assigned_user_id.is_(None)
            )
        )

    if search:
        term = f"%{search}%"
        query = query.where(or_(Lead.full_name.ilike(term), Lead.phone.ilike(term), Lead.email.ilike(term), Lead.company_name.ilike(term)))
    if status:
        query = query.where(Lead.status == status)
    if source:
        query = query.where(Lead.source == source)

    result = await db.execute(query)
    return result.scalars().all()

@router.post("/leads", response_model=LeadOut)
async def create_lead(
    lead_in: LeadCreate,
    org_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    target_org = current_user.organization_id or org_id
    if not target_org:
        res = await db.execute(select(Organization))
        org = res.scalars().first()
        target_org = org.id if org else "default_org"

    # Auto-assign sales rep if created by a sales rep
    if (current_user.role or "").upper() == "SALES_REP" and not lead_in.assigned_user_id:
        lead_in.assigned_user_id = current_user.id

    try:
        lead = await LeadService.create_lead(db, target_org, lead_in)
        return lead
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/leads/bulk-upload", response_model=BulkUploadResponse)
async def bulk_upload(
    file: UploadFile = File(...),
    org_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db)
):
    if not org_id:
        res = await db.execute(select(Organization))
        org = res.scalars().first()
        org_id = org.id if org else "default_org"

    contents = await file.read()
    rows = CSVParserService.parse_csv_bytes(contents)

    success_count = 0
    duplicate_count = 0
    total_processed = len(rows)

    for idx, row in enumerate(rows):
        full_name = row.get("full_name") or row.get("Name") or f"Lead {idx+1}"
        phone = row.get("phone") or row.get("Phone") or ""
        email = row.get("email") or row.get("Email")
        source = row.get("source") or row.get("Source") or "CSV_IMPORT"
        company_name = row.get("company_name") or row.get("Company") or ""

        if not phone:
            continue

        existing = await db.execute(
            select(Lead).where(Lead.organization_id == org_id, Lead.phone == phone)
        )
        if existing.scalar_one_or_none():
            duplicate_count += 1
            continue

        lead = Lead(
            organization_id=org_id,
            full_name=full_name,
            phone=phone,
            email=email,
            company_name=company_name,
            source=source,
            status="NEW"
        )
        db.add(lead)
        success_count += 1

    await db.commit()
    return BulkUploadResponse(
        success_count=success_count,
        duplicate_count=duplicate_count,
        total_processed=total_processed,
        message=f"Bulk ingestion finished. Processed {total_processed} rows: {success_count} inserted, {duplicate_count} duplicates skipped."
    )

@router.get("/leads/{lead_id}", response_model=LeadOut)
async def get_lead(
    lead_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    result = await db.execute(select(Lead).where(Lead.id == lead_id))
    lead = result.scalar_one_or_none()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    if current_user.organization_id and lead.organization_id and lead.organization_id != current_user.organization_id:
        raise HTTPException(status_code=403, detail="Access denied: Lead belongs to another organization.")
    if (current_user.role or "").upper() == "SALES_REP" and lead.assigned_user_id and lead.assigned_user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Access denied: Lead is not assigned to you.")
    return lead

@router.patch("/leads/{lead_id}", response_model=LeadOut)
async def update_lead(
    lead_id: str,
    patch_data: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    result = await db.execute(select(Lead).where(Lead.id == lead_id))
    lead = result.scalar_one_or_none()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    if current_user.organization_id and lead.organization_id and lead.organization_id != current_user.organization_id:
        raise HTTPException(status_code=403, detail="Access denied: Cannot update a lead from another organization.")
    if (current_user.role or "").upper() == "SALES_REP" and lead.assigned_user_id and lead.assigned_user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Access denied: You can only update your assigned leads.")

    # Map fields
    if "name" in patch_data and "full_name" not in patch_data:
        patch_data["full_name"] = patch_data["name"]
    if "ad_source" in patch_data and "source" not in patch_data:
        patch_data["source"] = patch_data["ad_source"]
    if "stage" in patch_data and "status" not in patch_data:
        patch_data["status"] = patch_data["stage"]

    allowed_fields = ["full_name", "email", "phone", "company_name", "source", "status", "notes", "custom_fields", "tags", "assigned_user_id"]
    for key, val in patch_data.items():
        if key in allowed_fields and val is not None:
            setattr(lead, key, val)

    await db.commit()
    await db.refresh(lead)
    return lead

@router.delete("/leads/{lead_id}")
async def delete_lead(
    lead_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    result = await db.execute(select(Lead).where(Lead.id == lead_id))
    lead = result.scalar_one_or_none()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    if current_user.organization_id and lead.organization_id and lead.organization_id != current_user.organization_id:
        raise HTTPException(status_code=403, detail="Access denied: Cannot delete a lead from another organization.")
    if (current_user.role or "").upper() == "SALES_REP":
        raise HTTPException(status_code=403, detail="Access denied: Sales representatives are not authorized to delete leads.")

    await db.delete(lead)
    await db.commit()
    return {"message": "Lead deleted successfully", "success": True}

@router.post("/leads/{lead_id}/convert", response_model=LeadConvertResponse)
async def convert_lead(
    lead_id: str,
    payload: LeadConvertRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    # 1. Fetch Lead
    result = await db.execute(select(Lead).where(Lead.id == lead_id))
    lead = result.scalar_one_or_none()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    if current_user.organization_id and lead.organization_id and lead.organization_id != current_user.organization_id:
        raise HTTPException(status_code=403, detail="Access denied: Cannot convert a lead from another organization.")

    org_id = lead.organization_id

    # 2. Mark Lead as CONVERTED
    lead.status = "CONVERTED"

    # 3. Create or find Contact in contacts table
    contact_q = select(Contact).where(
        Contact.organization_id == org_id,
        or_(Contact.phone == lead.phone, Contact.email == lead.email)
    ) if lead.email else select(Contact).where(
        Contact.organization_id == org_id,
        Contact.phone == lead.phone
    )
    contact_res = await db.execute(contact_q)
    contact = contact_res.scalars().first()

    if not contact:
        contact = Contact(
            organization_id=org_id,
            full_name=lead.full_name,
            phone=lead.phone,
            email=lead.email,
            company_name=lead.company_name,
            status="Customer",
            assigned_user_id=lead.assigned_user_id
        )
        db.add(contact)
        await db.flush()

    # 4. Resolve Pipeline and Stage
    pipeline_id = payload.pipeline_id
    if not pipeline_id:
        p_res = await db.execute(select(Pipeline).where(Pipeline.organization_id == org_id, Pipeline.is_default == True))
        pipeline = p_res.scalars().first()
        if not pipeline:
            p_res = await db.execute(select(Pipeline).where(Pipeline.organization_id == org_id))
            pipeline = p_res.scalars().first()
        if not pipeline:
            pipeline = Pipeline(organization_id=org_id, name="Standard Sales Pipeline", is_default=True)
            db.add(pipeline)
            await db.flush()
        pipeline_id = pipeline.id

    stage_id = None
    if payload.pipeline_stage:
        stg_res = await db.execute(
            select(PipelineStage).where(
                PipelineStage.pipeline_id == pipeline_id,
                or_(
                    PipelineStage.id == payload.pipeline_stage,
                    PipelineStage.title.ilike(f"%{payload.pipeline_stage}%")
                )
            )
        )
        matched_stage = stg_res.scalars().first()
        if matched_stage:
            stage_id = matched_stage.id

    if not stage_id:
        first_stg_res = await db.execute(
            select(PipelineStage).where(PipelineStage.pipeline_id == pipeline_id).order_by(PipelineStage.stage_order.asc())
        )
        first_stg = first_stg_res.scalars().first()
        if not first_stg:
            first_stg = PipelineStage(
                pipeline_id=pipeline_id,
                title="Discovery / First Call",
                stage_order=0,
                probability=20,
                color_code="#3B82F6"
            )
            db.add(first_stg)
            await db.flush()
        stage_id = first_stg.id

    # 5. Create Deal
    deal_title = payload.deal_name or (f"{lead.company_name or lead.full_name} - Deal")
    deal_val = float(payload.deal_value or 0.0)
    deal = Deal(
        organization_id=org_id,
        pipeline_id=pipeline_id,
        stage_id=stage_id,
        lead_id=lead.id,
        contact_id=contact.id,
        title=deal_title,
        deal_value=deal_val,
        currency="INR",
        expected_close_date=payload.expected_close_date or (datetime.utcnow().strftime("%Y-%m-%d")),
        assigned_user_id=lead.assigned_user_id,
        status="OPEN"
    )
    db.add(deal)
    await db.flush()

    # 6. Log Activity
    act = Activity(
        organization_id=org_id,
        lead_id=lead.id,
        deal_id=deal.id,
        user_id=lead.assigned_user_id,
        type="STAGE_CHANGE",
        notes=f"Converted to Deal '{deal.title}' (Value: ₹{deal.deal_value:,.2f})",
        status="COMPLETED"
    )
    db.add(act)

    # 7. Commit transaction
    await db.commit()
    await db.refresh(deal)

    return LeadConvertResponse(
        success=True,
        message="Lead converted to Deal successfully",
        lead_id=str(lead.id),
        contact_id=str(contact.id),
        deal_id=str(deal.id),
        deal_title=str(deal.title)
    )


