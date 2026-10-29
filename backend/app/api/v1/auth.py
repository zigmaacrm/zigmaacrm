import secrets
import re
from typing import Optional
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, status, Header, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_, func
from app.core.database import get_db
from app.core.security import (
    verify_password,
    get_password_hash,
    create_access_token,
    decode_invitation_token,
    validate_strong_password
)
from app.models.organization_user import User, Organization
from app.models.organization_setting import OrganizationSetting
from app.models.otp import PasswordResetOTP
from app.core.email import send_otp_email
from app.api.deps import get_current_user
from app.schemas.auth_schema import (
    UserLogin, UserCreate, SignupRequest, GoogleLoginSchema, TokenResponse, UserOut,
    SendOtpRequest, VerifyOtpRequest, ResetPasswordRequest, SimpleMessageResponse,
    ChangePasswordRequest, UpdateProfileRequest
)

router = APIRouter()

@router.post("/google", response_model=TokenResponse)
async def google_login(payload: GoogleLoginSchema, db: AsyncSession = Depends(get_db)):
    clean_email = payload.email.lower().strip()
    result = await db.execute(select(User).where(User.email == clean_email))
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"This Gmail account ({clean_email}) is not registered with Zigmaa CRM. Please sign up or contact your administrator."
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account has been deactivated. Please contact your administrator."
        )

    user_updated = False
    # STRICT: Do not take name from Google. Only provide the registered full name given in sign up.
    # Only take the Google profile photo (picture) and email.
    if payload.picture and payload.picture.strip():
        user.avatar_url = payload.picture.strip()
        user_updated = True

    if user_updated:
        await db.commit()
        await db.refresh(user)

    token = create_access_token({
        "sub": str(user.id),
        "email": user.email,
        "org_id": str(user.organization_id) if user.organization_id else "",
        "role": user.role
    })
    user_out = await _build_user_out(user, db)
    return TokenResponse(
        access_token=token,
        token_type="bearer",
        user=user_out
    )


async def _build_user_out(user: User, db: AsyncSession) -> UserOut:
    company_name = None
    plan = "PRO"
    trial_ends_at = None
    if user.organization_id:
        org_res = await db.execute(select(Organization).where(Organization.id == user.organization_id))
        org = org_res.scalar_one_or_none()
        if org:
            company_name = org.name
            plan = org.plan or "PRO"
            trial_ends_at = org.trial_ends_at.isoformat() if org.trial_ends_at else None

        org_set_res = await db.execute(
            select(OrganizationSetting).where(OrganizationSetting.organization_id == user.organization_id)
        )
        org_set = org_set_res.scalars().first()
        if org_set and org_set.company_name:
            company_name = org_set.company_name

    is_super = bool(
        getattr(user, "is_super_admin", False)
        or (user.role or "").upper() in ["SUPER_ADMIN", "SUPERADMIN"]
        or (user.email and user.email.lower() in ["admin@zigmaa.com", "zigmaaadmin", "zigmaaadmin@zigmaa.com"])
    )

    avatar = getattr(user, "avatar_url", None)
    return UserOut(
        id=user.id,
        organization_id=user.organization_id or "",
        email=user.email,
        full_name=user.full_name,
        phone=getattr(user, "phone", None),
        role=user.role,
        is_active=user.is_active,
        is_super_admin=is_super,
        company_name=company_name or "Zigmaa Workspace",
        organization_name=company_name or "Zigmaa Workspace",
        picture=avatar,
        avatar_url=avatar,
        plan=plan,
        trial_ends_at=trial_ends_at
    )

DUMMY_BCRYPT_HASH = get_password_hash("ZigmaaDummyTimingProtectionPassword2026")

@router.post("/login", response_model=TokenResponse)
async def login(
    login_in: UserLogin,
    x_portal: Optional[str] = Header(None, alias="X-Portal"),
    db: AsyncSession = Depends(get_db)
):
    clean_identifier = login_in.email.lower().strip()
    result = await db.execute(
        select(User).where(
            or_(
                User.email == clean_identifier,
                User.email == f"{clean_identifier}@zigmaa.com"
            )
        ).limit(1)
    )
    user = result.scalars().first()
    
    # Timing-attack resistant verification (OWASP / CWE-208):
    # Always perform full bcrypt hash computation to avoid user enumeration via latency delta
    target_hash = user.hashed_password if user else DUMMY_BCRYPT_HASH
    is_valid_pw = verify_password(login_in.password, target_hash)

    if not user or not is_valid_pw:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password"
        )

    # Super Admin is STRICTLY NOT allowed to log in via normal CRM login:
    # Must use the dedicated Master Admin Portal (/admin)
    is_super = bool(
        getattr(user, "is_super_admin", False)
        or (user.role or "").upper() in ["SUPER_ADMIN", "SUPERADMIN"]
        or (user.email and user.email.lower() in ["admin@zigmaa.com", "zigmaaadmin", "zigmaaadmin@zigmaa.com"])
    )
    if is_super and x_portal != "super_admin":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password"
        )
    
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account is deactivated. Please contact your administrator."
        )

    token = create_access_token({
        "sub": str(user.id),
        "email": user.email,
        "org_id": str(user.organization_id) if user.organization_id else "",
        "role": user.role
    })
    user_out = await _build_user_out(user, db)
    return TokenResponse(
        access_token=token,
        token_type="bearer",
        user=user_out
    )

@router.post("/signup", response_model=TokenResponse)
@router.post("/register", response_model=TokenResponse)
async def signup(user_in: SignupRequest, db: AsyncSession = Depends(get_db)):
    # Validate password strength (min 8 chars, 1 uppercase, 1 number, 1 special character)
    validate_strong_password(user_in.password)

    clean_email = user_in.email.lower().strip()
    raw_company = (user_in.company_name or user_in.organization_name or "").strip()
    raw_phone = (user_in.phone or user_in.contact_number or "").strip()

    # Rule 1: Email already registered check
    email_check = await db.execute(select(User).where(func.lower(User.email) == clean_email))
    if email_check.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"This email address ({clean_email}) is already registered. Please sign in or use a different email."
        )

    # Rule 2: Company name already registered check
    if raw_company:
        org_check = await db.execute(
            select(Organization).where(func.lower(Organization.name) == raw_company.lower())
        )
        if org_check.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"The company name '{raw_company}' is already registered. Please choose a different company name or sign in."
            )

        setting_check = await db.execute(
            select(OrganizationSetting).where(func.lower(OrganizationSetting.company_name) == raw_company.lower())
        )
        if setting_check.scalars().first():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"The company name '{raw_company}' is already registered. Please choose a different company name or sign in."
            )

    # Rule 3: Phone number already registered check
    if raw_phone:
        digits = re.sub(r"\D", "", raw_phone)
        if len(digits) >= 10:
            last_10 = digits[-10:]

            # Check User phone
            users_with_phone = await db.execute(select(User.phone).where(User.phone.is_not(None)))
            for (u_p,) in users_with_phone.all():
                if u_p and re.sub(r"\D", "", u_p)[-10:] == last_10:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"This phone number ({raw_phone}) is already registered with an existing account. Please use a different phone number or sign in."
                    )

            # Check OrganizationSetting phone
            settings_with_phone = await db.execute(select(OrganizationSetting.phone).where(OrganizationSetting.phone.is_not(None)))
            for (s_p,) in settings_with_phone.all():
                if s_p and re.sub(r"\D", "", s_p)[-10:] == last_10:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"This phone number ({raw_phone}) is already registered with an existing account. Please use a different phone number or sign in."
                    )

    # Determine company/workspace name
    workspace_name = raw_company or f"{user_in.full_name.strip()}'s Workspace"
    org_slug = workspace_name.lower().replace(" ", "-")
    now = datetime.utcnow()
    trial_expiry = now + timedelta(days=7)
    org = Organization(
        name=workspace_name,
        slug=f"{org_slug}-{secrets.token_hex(3)}",
        plan="FREE_TRIAL",
        status="ACTIVE",
        trial_ends_at=trial_expiry,
        max_users=5,
        max_whatsapp=500
    )
    db.add(org)
    await db.flush()

    # Create User with admin role (strictly "admin", Workspace Owner)
    user = User(
        organization_id=org.id,
        email=clean_email,
        hashed_password=get_password_hash(user_in.password),
        full_name=user_in.full_name.strip(),
        phone=raw_phone if raw_phone else None,
        role="admin",
        is_active=True
    )
    db.add(user)
    await db.flush()

    # Automatically set up initial organization_settings for that workspace
    initial_settings = OrganizationSetting(
        organization_id=org.id,
        company_name=workspace_name,
        email=clean_email,
        phone=raw_phone if raw_phone else "+91 98765 43210",
        signatory_name=user_in.full_name.strip(),
        signatory_designation="Authorized Signatory"
    )
    db.add(initial_settings)

    await db.commit()
    await db.refresh(user)

    token = create_access_token({
        "sub": str(user.id),
        "email": user.email,
        "org_id": str(user.organization_id) if user.organization_id else "",
        "role": user.role
    })
    user_out = await _build_user_out(user, db)
    return TokenResponse(
        access_token=token,
        token_type="bearer",
        user=user_out
    )

@router.get("/me", response_model=UserOut)
async def get_me(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if not current_user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid session")
    return await _build_user_out(current_user, db)

@router.post("/send-otp", response_model=SimpleMessageResponse)
@router.post("/forgot-password", response_model=SimpleMessageResponse)
async def send_otp(payload: SendOtpRequest, db: AsyncSession = Depends(get_db)):
    clean_email = payload.email.lower().strip()
    
    # Strictly check if user exists in database
    result = await db.execute(select(User).where(User.email == clean_email))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="This email address is not registered with Zigmaa CRM. Please verify the email or sign up."
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account has been deactivated. Please contact your workspace administrator."
        )

    # Invalidate any existing unused OTPs for this email to prevent multiple valid codes
    existing_otps_res = await db.execute(
        select(PasswordResetOTP).where(
            PasswordResetOTP.email == clean_email,
            PasswordResetOTP.is_used == False
        )
    )
    for old_otp in existing_otps_res.scalars().all():
        old_otp.is_used = True

    # Generate cryptographically secure 6-digit OTP
    otp_code = f"{secrets.randbelow(900000) + 100000}"
    expires_at = datetime.utcnow() + timedelta(minutes=10)

    # Save to database
    otp_record = PasswordResetOTP(
        email=clean_email,
        otp_code=otp_code,
        expires_at=expires_at,
        is_used=False
    )
    db.add(otp_record)
    await db.commit()

    # Send OTP email via SMTP (using SSL 465 / STARTTLS 587)
    try:
        await send_otp_email(clean_email, otp_code)
    except Exception as e:
        print(f"[OTP ERROR] Failed to dispatch OTP email: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to dispatch OTP email: {str(e)}"
        )

    return SimpleMessageResponse(
        message=f"Verification code sent successfully to {clean_email}",
        success=True,
        otp=None
    )

@router.post("/verify-otp", response_model=SimpleMessageResponse)
async def verify_otp(payload: VerifyOtpRequest, db: AsyncSession = Depends(get_db)):
    clean_email = payload.email.lower().strip()
    clean_otp = payload.otp.strip()

    # Fetch latest unused OTP for this email
    stmt = (
        select(PasswordResetOTP)
        .where(
            PasswordResetOTP.email == clean_email,
            PasswordResetOTP.otp_code == clean_otp,
            PasswordResetOTP.is_used == False
        )
        .order_by(PasswordResetOTP.created_at.desc())
    )
    result = await db.execute(stmt)
    otp_record = result.scalars().first()

    if not otp_record:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or already used verification code."
        )

    if datetime.utcnow() > otp_record.expires_at:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Verification code has expired. Please request a new code."
        )

    return SimpleMessageResponse(
        message="Verification code confirmed successfully."
    )

@router.post("/reset-password", response_model=SimpleMessageResponse)
async def reset_password(payload: ResetPasswordRequest, db: AsyncSession = Depends(get_db)):
    # Validate password strength (min 8 chars, 1 uppercase, 1 number, 1 special character)
    validate_strong_password(payload.new_password)

    clean_email = payload.email.lower().strip()
    clean_otp = payload.otp.strip()

    # Validate OTP
    stmt = (
        select(PasswordResetOTP)
        .where(
            PasswordResetOTP.email == clean_email,
            PasswordResetOTP.otp_code == clean_otp,
            PasswordResetOTP.is_used == False
        )
        .order_by(PasswordResetOTP.created_at.desc())
    )
    result = await db.execute(stmt)
    otp_record = result.scalars().first()

    if not otp_record or datetime.utcnow() > otp_record.expires_at:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired verification code."
        )

    # Mark OTP as used
    otp_record.is_used = True

    # Find user and update password
    user_res = await db.execute(select(User).where(User.email == clean_email))
    user = user_res.scalar_one_or_none()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found."
        )

    user.hashed_password = get_password_hash(payload.new_password)
    await db.commit()

    return SimpleMessageResponse(
        message="Password has been reset successfully. You can now log in with your new password."
    )

@router.post("/change-password", response_model=SimpleMessageResponse)
async def change_password(payload: ChangePasswordRequest, db: AsyncSession = Depends(get_db)):
    clean_email = payload.email.lower().strip()
    result = await db.execute(select(User).where(User.email == clean_email))
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Account not found."
        )

    if not verify_password(payload.current_password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password is incorrect."
        )

    # Validate strong password (min 8 chars, 1 uppercase, 1 number, 1 special character)
    validate_strong_password(payload.new_password)

    user.hashed_password = get_password_hash(payload.new_password)
    await db.commit()

    return SimpleMessageResponse(
        message="Password updated successfully."
    )

@router.post("/update-profile", response_model=UserOut)
async def update_profile(payload: UpdateProfileRequest, db: AsyncSession = Depends(get_db)):
    clean_email = payload.email.lower().strip()
    result = await db.execute(select(User).where(User.email == clean_email))
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found."
        )

    if payload.full_name:
        user.full_name = payload.full_name.strip()

    if payload.new_email and payload.new_email.lower().strip() != clean_email:
        new_clean = payload.new_email.lower().strip()
        existing = await db.execute(select(User).where(User.email == new_clean))
        if existing.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email address is already in use by another account."
            )
        user.email = new_clean

    if payload.organization_name and user.organization_id:
        org_res = await db.execute(select(Organization).where(Organization.id == user.organization_id))
        org = org_res.scalar_one_or_none()
        if org:
            org.name = payload.organization_name.strip()

    if payload.picture is not None:
        user.avatar_url = payload.picture.strip() if payload.picture else None

    # Synchronize OrganizationSetting for this user's organization
    if user.organization_id:
        setting_res = await db.execute(
            select(OrganizationSetting).where(OrganizationSetting.organization_id == user.organization_id)
        )
        setting = setting_res.scalars().first()
        if setting:
            if payload.full_name:
                setting.signatory_name = payload.full_name.strip()
            if payload.organization_name:
                setting.company_name = payload.organization_name.strip()
            if payload.new_email:
                setting.email = payload.new_email.lower().strip()
            if payload.picture is not None:
                setting.logo_url = payload.picture.strip() if payload.picture else None

    await db.commit()
    await db.refresh(user)

    return await _build_user_out(user, db)

class AcceptInvitationRequest(BaseModel):
    token: str
    password: str

@router.get("/verify-invitation")
async def verify_invitation(token: str = Query(...), db: AsyncSession = Depends(get_db)):
    payload = decode_invitation_token(token)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This invitation link has expired (24-hour limit) or is invalid. Please ask your administrator to resend the invite."
        )
    user_id = payload.get("sub")
    user_res = await db.execute(select(User).where(User.id == user_id))
    user = user_res.scalar_one_or_none()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Invited user account not found."
        )
    return {
        "valid": True,
        "email": user.email,
        "full_name": user.full_name,
        "role": user.role
    }

@router.post("/accept-invitation", response_model=TokenResponse)
async def accept_invitation(payload: AcceptInvitationRequest, db: AsyncSession = Depends(get_db)):
    # Validate strong password (min 8 chars, 1 uppercase, 1 number, 1 special character)
    validate_strong_password(payload.password)

    token_data = decode_invitation_token(payload.token)
    if not token_data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This invitation link has expired (24-hour limit) or is invalid. Please ask your administrator to resend the invite."
        )
    user_id = token_data.get("sub")
    user_res = await db.execute(select(User).where(User.id == user_id))
    user = user_res.scalar_one_or_none()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Invited user account not found."
        )

    # Set the permanent password and activate user
    user.hashed_password = get_password_hash(payload.password)
    user.is_active = True
    await db.commit()
    await db.refresh(user)

    # Issue access token so user is automatically authenticated and logged in
    token = create_access_token({
        "sub": str(user.id),
        "email": user.email,
        "org_id": str(user.organization_id) if user.organization_id else "",
        "role": user.role
    })
    user_out = await _build_user_out(user, db)
    return TokenResponse(
        access_token=token,
        token_type="bearer",
        user=user_out
    )


