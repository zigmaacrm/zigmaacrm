import urllib.parse
from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_, delete
from typing import List, Optional
from pydantic import BaseModel, EmailStr
from datetime import datetime

from app.core.database import get_db
from app.core.security import get_password_hash, create_invitation_token
from app.core.email import send_team_invitation_email
from app.models.organization_user import User, Organization
from app.models.deal import Deal
from app.models.contact import Contact
from app.api.deps import get_current_user, get_current_admin

router = APIRouter()

class InviteMemberRequest(BaseModel):
    full_name: str
    email: EmailStr
    role: str = "sales_rep"  # admin, sales_rep

class UpdateRoleRequest(BaseModel):
    role: str  # admin, sales_rep

class UpdateWhatsAppConfigRequest(BaseModel):
    whatsapp_phone_number: Optional[str] = None
    whatsapp_phone_number_id: Optional[str] = None

@router.get("", status_code=status.HTTP_200_OK)
@router.get("/", status_code=status.HTTP_200_OK)
async def list_team_members(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Strict Organization-Scoped Team Members Query.
    Never returns users from other organizations or seed accounts.
    """
    if not current_user.organization_id:
        return []

    query = (
        select(User)
        .where(User.organization_id == current_user.organization_id)
        .order_by(User.created_at.asc())
    )
    res = await db.execute(query)
    users = res.scalars().all()

    members = []
    for u in users:
        # Count deals assigned to this user strictly within this organization
        deals_count_res = await db.execute(
            select(func.count(Deal.id)).where(
                Deal.organization_id == current_user.organization_id,
                or_(
                    Deal.assigned_user_id == u.id,
                    Deal.owner_id == u.id,
                    Deal.owner_name.ilike(f"%{u.full_name}%")
                )
            )
        )
        deals_count = deals_count_res.scalar() or 0

        # Count leads / contacts assigned to this user strictly within this organization
        contacts_count_res = await db.execute(
            select(func.count(Contact.id)).where(
                Contact.organization_id == current_user.organization_id,
                or_(
                    Contact.assigned_user_id == u.id,
                    Contact.owner_id == u.id,
                    Contact.owner_name.ilike(f"%{u.full_name}%"),
                    Contact.assigned_user_name.ilike(f"%{u.full_name}%")
                )
            )
        )
        contacts_count = contacts_count_res.scalar() or 0

        members.append({
            "id": u.id,
            "organization_id": u.organization_id,
            "full_name": u.full_name,
            "email": u.email,
            "role": u.role,
            "is_active": u.is_active,
            "whatsapp_phone_number": u.whatsapp_phone_number,
            "whatsapp_phone_number_id": u.whatsapp_phone_number_id,
            "assigned_deals_count": deals_count,
            "assigned_leads_count": contacts_count,
            "created_at": u.created_at.isoformat() if u.created_at else None
        })

    return members

@router.put("/{user_id}/whatsapp")
async def update_member_whatsapp(
    user_id: str,
    req: UpdateWhatsAppConfigRequest,
    db: AsyncSession = Depends(get_db),
    admin_user: User = Depends(get_current_admin)
):
    """
    Assign/Update WhatsApp configuration (Phone Number & Meta Phone Number ID) for a sales rep
    """
    res = await db.execute(
        select(User).where(
            User.id == user_id,
            User.organization_id == admin_user.organization_id
        )
    )
    user = res.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found in your organization.")

    user.whatsapp_phone_number = (req.whatsapp_phone_number or "").strip() or None
    user.whatsapp_phone_number_id = (req.whatsapp_phone_number_id or "").strip() or None
    await db.commit()
    await db.refresh(user)

    return {
        "status": "success",
        "message": f"WhatsApp configuration updated for {user.full_name}",
        "user_id": user.id,
        "whatsapp_phone_number": user.whatsapp_phone_number,
        "whatsapp_phone_number_id": user.whatsapp_phone_number_id
    }

@router.post("/invite", status_code=status.HTTP_201_CREATED)
async def invite_team_member(
    req: InviteMemberRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    admin_user: User = Depends(get_current_admin)
):
    clean_email = req.email.lower().strip()
    norm_role = "sales_rep"

    # Strictly assign the inviting admin's organization_id
    org_id = admin_user.organization_id
    if not org_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Creator does not have a linked organization."
        )

    # Fetch organization name for email
    org_res = await db.execute(select(Organization).where(Organization.id == org_id))
    org_obj = org_res.scalar_one_or_none()
    org_name = org_obj.name if org_obj and org_obj.name else "Zigmaa CRM"

    # Check if user already exists
    existing_res = await db.execute(select(User).where(User.email == clean_email))
    existing_user = existing_res.scalar_one_or_none()

    if existing_user:
        # If user exists and is already active with custom password
        if existing_user.is_active and existing_user.organization_id == org_id:
            # Generate a new 24h invitation/setup token to allow password reset/re-invite
            invite_token = create_invitation_token({
                "sub": str(existing_user.id),
                "email": clean_email,
                "name": existing_user.full_name,
                "org_id": str(org_id),
                "role": existing_user.role
            })
            base_url = request.headers.get("origin") or "https://zigmaacrm.vercel.app"
            invite_link = f"{base_url.rstrip('/')}/login?invitation_token={invite_token}&email={clean_email}&name={urllib.parse.quote(existing_user.full_name)}"
            
            try:
                await send_team_invitation_email(clean_email, existing_user.full_name, org_name, invite_link, admin_user.full_name)
            except Exception as e:
                print(f"[INVITE EMAIL NOTICE] Could not send email: {e}")

            return {
                "status": "success",
                "message": f"Resent 24-hour invitation setup link to {existing_user.email}.",
                "invitation_link": invite_link,
                "invitation_token": invite_token,
                "user": {
                    "id": existing_user.id,
                    "organization_id": existing_user.organization_id,
                    "full_name": existing_user.full_name,
                    "email": existing_user.email,
                    "role": existing_user.role,
                    "is_active": existing_user.is_active,
                    "whatsapp_phone_number": existing_user.whatsapp_phone_number,
                    "whatsapp_phone_number_id": existing_user.whatsapp_phone_number_id,
                    "assigned_deals_count": 0,
                    "assigned_leads_count": 0,
                    "created_at": existing_user.created_at.isoformat() if existing_user.created_at else None
                }
            }
        elif existing_user.organization_id != org_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"User with email {clean_email} belongs to another organization."
            )

    # Create new sales representative
    temp_pass = "Zigmaa@2026"
    new_user = User(
        organization_id=org_id,
        email=clean_email,
        full_name=req.full_name.strip(),
        role=norm_role,
        is_active=True,
        hashed_password=get_password_hash(temp_pass)
    )

    db.add(new_user)
    await db.commit()
    await db.refresh(new_user)

    # Generate 24-hour cryptographically signed invitation token
    invite_token = create_invitation_token({
        "sub": str(new_user.id),
        "email": clean_email,
        "name": new_user.full_name,
        "org_id": str(org_id),
        "role": norm_role
    })

    # Build direct setup password link
    base_url = request.headers.get("origin") or "https://zigmaacrm.vercel.app"
    invite_link = f"{base_url.rstrip('/')}/login?invitation_token={invite_token}&email={clean_email}&name={urllib.parse.quote(new_user.full_name)}"

    # Dispatch branded invitation email
    try:
        await send_team_invitation_email(
            clean_email,
            new_user.full_name,
            org_name,
            invite_link,
            admin_user.full_name or "Administrator"
        )
    except Exception as e:
        print(f"[INVITE EMAIL NOTICE] Could not send email: {e}")

    return {
        "status": "success",
        "message": f"Invitation email sent to {new_user.email} with 24-hour setup password link.",
        "invitation_link": invite_link,
        "invitation_token": invite_token,
        "user": {
            "id": new_user.id,
            "organization_id": new_user.organization_id,
            "full_name": new_user.full_name,
            "email": new_user.email,
            "role": new_user.role,
            "is_active": new_user.is_active,
            "whatsapp_phone_number": new_user.whatsapp_phone_number,
            "whatsapp_phone_number_id": new_user.whatsapp_phone_number_id,
            "assigned_deals_count": 0,
            "assigned_leads_count": 0,
            "created_at": new_user.created_at.isoformat() if new_user.created_at else None
        }
    }

@router.patch("/{user_id}/role")
async def update_member_role(
    user_id: str,
    req: UpdateRoleRequest,
    db: AsyncSession = Depends(get_db),
    admin_user: User = Depends(get_current_admin)
):
    raw_role = (req.role or "").strip().lower()
    norm_role = "admin" if "admin" in raw_role else "sales_rep"

    # Verify target user belongs strictly to the admin's organization
    res = await db.execute(
        select(User).where(
            User.id == user_id,
            User.organization_id == admin_user.organization_id
        )
    )
    user = res.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found in your organization.")

    # Prevent admins from demoting or modifying their own role
    if user.id == admin_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot change your own role. Administrator accounts are permanently locked."
        )

    # Locked Admin rule: The primary organization admin cannot be demoted
    if (user.role or "").lower() == "admin":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The organization Administrator role is locked and cannot be demoted."
        )

    # Single Admin rule: Additional team members cannot be promoted to Admin
    if norm_role == "admin":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The organization can have strictly one Administrator. Additional team members must be Sales Representatives."
        )

    user.role = norm_role
    await db.commit()
    await db.refresh(user)

    return {
        "status": "success",
        "message": f"Role updated to {norm_role} for {user.full_name}",
        "user_id": user.id,
        "role": user.role
    }

@router.delete("/{user_id}")
async def remove_team_member(
    user_id: str,
    db: AsyncSession = Depends(get_db),
    admin_user: User = Depends(get_current_admin)
):
    # Verify target user belongs strictly to the admin's organization
    res = await db.execute(
        select(User).where(
            User.id == user_id,
            User.organization_id == admin_user.organization_id
        )
    )
    user = res.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found in your organization.")

    if user.id == admin_user.id:
        raise HTTPException(status_code=400, detail="You cannot delete your own active administrator account.")

    # Enforce that an organization must always retain at least 1 active Admin
    if (user.role or "").lower() == "admin":
        admin_count_res = await db.execute(
            select(func.count(User.id)).where(
                User.organization_id == admin_user.organization_id,
                User.is_active == True,
                or_(
                    User.role.ilike("admin"),
                    User.role.ilike("super_admin")
                )
            )
        )
        active_admins = admin_count_res.scalar() or 0
        if active_admins <= 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Organization must always retain at least 1 active Administrator."
            )

    # Soft delete / deactivate or remove
    user.is_active = False
    await db.delete(user)
    await db.commit()

    return {
        "status": "success",
        "message": f"Team member {user.full_name} has been removed."
    }
