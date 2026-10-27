from pydantic import BaseModel, EmailStr
from typing import Optional

class UserLogin(BaseModel):
    email: str  # Allows email or username (e.g. zigmaaadmin)
    password: str

class GoogleLoginSchema(BaseModel):
    email: EmailStr
    name: Optional[str] = "Google User"
    picture: Optional[str] = None
    token: Optional[str] = None

class UserCreate(BaseModel):
    email: EmailStr
    password: str
    full_name: str
    organization_name: Optional[str] = None
    company_name: Optional[str] = None
    phone: Optional[str] = None
    contact_number: Optional[str] = None
    role: Optional[str] = "ADMIN"

class SignupRequest(BaseModel):
    email: EmailStr
    password: str
    full_name: str
    company_name: Optional[str] = None
    organization_name: Optional[str] = None
    phone: Optional[str] = None
    contact_number: Optional[str] = None

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: "UserOut"

class UserOut(BaseModel):
    id: str
    organization_id: str
    email: str
    full_name: str
    phone: Optional[str] = None
    role: str
    is_active: bool
    is_super_admin: Optional[bool] = False
    company_name: Optional[str] = None
    organization_name: Optional[str] = None
    picture: Optional[str] = None
    avatar_url: Optional[str] = None
    plan: Optional[str] = None
    trial_ends_at: Optional[str] = None

    class Config:
        from_attributes = True

class OrganizationOut(BaseModel):
    id: str
    name: str
    slug: str
    plan: str

    class Config:
        from_attributes = True

class SendOtpRequest(BaseModel):
    email: EmailStr

class VerifyOtpRequest(BaseModel):
    email: EmailStr
    otp: str

class ResetPasswordRequest(BaseModel):
    email: EmailStr
    otp: str
    new_password: str

class ChangePasswordRequest(BaseModel):
    email: EmailStr
    current_password: str
    new_password: str

class UpdateProfileRequest(BaseModel):
    email: EmailStr
    full_name: Optional[str] = None
    new_email: Optional[EmailStr] = None
    phone: Optional[str] = None
    organization_name: Optional[str] = None
    picture: Optional[str] = None

class SimpleMessageResponse(BaseModel):
    message: str
    success: bool = True
    otp: Optional[str] = None

