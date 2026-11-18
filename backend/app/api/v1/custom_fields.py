import re
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_, and_
from typing import List, Optional, Any
from pydantic import BaseModel, Field
from datetime import datetime

from app.core.database import get_db
from app.models.custom_field import CustomField
from app.models.organization_user import Organization

router = APIRouter()

def slugify_key(text: str) -> str:
    s = text.lower().strip()
    s = re.sub(r"[^\w\s-]", "", s)
    s = re.sub(r"[\s-]+", "_", s)
    return s.strip("_") or "custom_field"

class CustomFieldCreate(BaseModel):
    module: Optional[str] = "contacts"  # contacts, deals, companies
    entity_type: Optional[str] = None
    label: str
    key: Optional[str] = None
    field_key: Optional[str] = None
    field_type: str = "text"  # text, number, select, date, boolean
    options: Optional[List[str]] = None
    is_required: Optional[bool] = False
    is_active: Optional[bool] = True

class CustomFieldOut(BaseModel):
    id: str
    organization_id: Optional[str] = None
    module: str
    entity_type: Optional[str] = None
    label: str
    key: str
    field_key: Optional[str] = None
    field_type: str
    options: Optional[Any] = None
    is_required: bool = False
    is_active: bool = True
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True

def normalize_module(module: Optional[str], entity_type: Optional[str]) -> tuple[str, str]:
    raw = (module or entity_type or "contacts").lower().strip()
    if raw in ["contact", "contacts", "lead", "leads"]:
        return "contacts", "CONTACT"
    elif raw in ["deal", "deals", "pipeline"]:
        return "deals", "DEAL"
    elif raw in ["company", "companies", "account", "accounts"]:
        return "companies", "COMPANY"
    return raw, raw.upper()

@router.get("/custom-fields", response_model=List[CustomFieldOut])
async def get_custom_fields(
    module: Optional[str] = Query(None),
    entity_type: Optional[str] = Query(None),
    include_inactive: bool = Query(False),
    org_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db)
):
    query = select(CustomField).order_by(CustomField.created_at.asc())

    filter_module = module or entity_type
    if filter_module:
        norm_mod, norm_ent = normalize_module(filter_module, None)
        query = query.where(
            or_(
                CustomField.module == norm_mod,
                CustomField.module == norm_mod.rstrip("s"),
                CustomField.entity_type == norm_ent,
                CustomField.entity_type == norm_ent + "S"
            )
        )

    if not include_inactive:
        query = query.where(CustomField.is_active.is_(True))

    if org_id:
        query = query.where(CustomField.organization_id == org_id)

    result = await db.execute(query)
    fields = result.scalars().all()

    # Ensure module, key, and field_type are formatted cleanly in output
    out = []
    for f in fields:
        mod = f.module or (f.entity_type.lower() + "s" if f.entity_type else "contacts")
        k = f.key or f.field_key or slugify_key(f.label)
        out.append(
            CustomFieldOut(
                id=f.id,
                organization_id=f.organization_id,
                module=mod,
                entity_type=f.entity_type or mod.upper(),
                label=f.label,
                key=k,
                field_key=k,
                field_type=(f.field_type or "text").lower(),
                options=f.options if (f.field_type or "").lower() == "select" else None,
                is_required=bool(f.is_required),
                is_active=bool(f.is_active if f.is_active is not None else True),
                created_at=f.created_at,
                updated_at=f.updated_at
            )
        )
    return out

@router.post("/custom-fields", response_model=CustomFieldOut, status_code=status.HTTP_201_CREATED)
async def create_custom_field(
    field_in: CustomFieldCreate,
    org_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db)
):
    if not field_in.label or not field_in.label.strip():
        raise HTTPException(status_code=400, detail="Field label is required")

    norm_module, norm_entity = normalize_module(field_in.module, field_in.entity_type)
    key_candidate = field_in.key or field_in.field_key or slugify_key(field_in.label)
    norm_key = slugify_key(key_candidate)

    # Resolve organization_id if not provided
    if not org_id:
        res = await db.execute(select(Organization))
        org = res.scalars().first()
        org_id = org.id if org else "default_org"

    # Check for active existing field with the same key in this module
    existing_res = await db.execute(
        select(CustomField).where(
            or_(
                CustomField.module == norm_module,
                CustomField.entity_type == norm_entity
            ),
            or_(
                CustomField.key == norm_key,
                CustomField.field_key == norm_key
            )
        )
    )
    existing_field = existing_res.scalar_one_or_none()

    f_type = (field_in.field_type or "text").lower()
    opts = field_in.options if f_type == "select" else None

    if existing_field:
        if existing_field.is_active:
            raise HTTPException(
                status_code=400,
                detail=f"A custom field with key '{norm_key}' already exists for module '{norm_module}'."
            )
        # Re-activate soft-deleted field and update attributes
        existing_field.label = field_in.label.strip()
        existing_field.field_type = f_type
        existing_field.options = opts
        existing_field.is_required = bool(field_in.is_required)
        existing_field.is_active = True
        existing_field.key = norm_key
        existing_field.field_key = norm_key
        existing_field.module = norm_module
        existing_field.entity_type = norm_entity
        await db.commit()
        await db.refresh(existing_field)
        return CustomFieldOut(
            id=existing_field.id,
            organization_id=existing_field.organization_id,
            module=norm_module,
            entity_type=norm_entity,
            label=existing_field.label,
            key=norm_key,
            field_key=norm_key,
            field_type=f_type,
            options=opts,
            is_required=existing_field.is_required,
            is_active=True,
            created_at=existing_field.created_at,
            updated_at=existing_field.updated_at
        )

    cf = CustomField(
        organization_id=org_id,
        module=norm_module,
        entity_type=norm_entity,
        label=field_in.label.strip(),
        key=norm_key,
        field_key=norm_key,
        field_type=f_type,
        options=opts,
        is_required=bool(field_in.is_required),
        is_active=True
    )
    db.add(cf)
    await db.commit()
    await db.refresh(cf)

    return CustomFieldOut(
        id=cf.id,
        organization_id=cf.organization_id,
        module=norm_module,
        entity_type=norm_entity,
        label=cf.label,
        key=norm_key,
        field_key=norm_key,
        field_type=f_type,
        options=opts,
        is_required=cf.is_required,
        is_active=True,
        created_at=cf.created_at,
        updated_at=cf.updated_at
    )

@router.delete("/custom-fields/{field_id}")
async def delete_custom_field(
    field_id: str,
    hard_delete: bool = Query(True),
    db: AsyncSession = Depends(get_db)
):
    res = await db.execute(select(CustomField).where(CustomField.id == field_id))
    cf = res.scalar_one_or_none()
    if not cf:
        return {"status": "success", "message": "Custom field already deleted", "id": field_id}

    await db.delete(cf)
    await db.commit()
    return {
        "status": "success",
        "message": "Custom field deleted successfully",
        "id": field_id
    }
