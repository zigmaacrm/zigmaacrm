from pydantic import BaseModel
from typing import Optional, Dict, Any
from datetime import datetime

class ContactBase(BaseModel):
    full_name: Optional[str] = "Unnamed Contact"
    name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = ""
    company_name: Optional[str] = None
    company: Optional[str] = None
    designation: Optional[str] = None
    job_title: Optional[str] = None
    status: Optional[str] = "NEW"
    lifecycle_stage: Optional[str] = "NEW"
    source: Optional[str] = "MANUAL"
    custom_data: Optional[Dict[str, Any]] = {}
    custom_properties: Optional[Dict[str, Any]] = {}
    assigned_user_name: Optional[str] = "Mohamed Thoufiq"
    assigned_to: Optional[str] = None

class ContactCreate(ContactBase):
    pass

class ContactOut(ContactBase):
    id: str
    organization_id: Optional[str] = None
    assigned_user_id: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    total_deals: Optional[int] = 0
    lifetime_value: Optional[float] = 0.0

    class Config:
        from_attributes = True
