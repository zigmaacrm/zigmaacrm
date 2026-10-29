import hashlib
import os
import re
import bcrypt
from datetime import datetime, timedelta
from typing import Optional
from jose import jwt, JWTError
from fastapi import HTTPException
from app.core.config import settings

def validate_strong_password(password: str) -> None:
    """
    Validates password strength:
    - Minimum 8 characters
    - At least one capital letter ([A-Z])
    - At least one number ([0-9])
    - At least one special character ([^A-Za-z0-9])
    """
    if not password or len(password) < 8:
        raise HTTPException(
            status_code=400,
            detail="Password must be at least 8 characters long."
        )
    if not re.search(r"[A-Z]", password):
        raise HTTPException(
            status_code=400,
            detail="Password must contain at least one uppercase letter (A-Z)."
        )
    if not re.search(r"[0-9]", password):
        raise HTTPException(
            status_code=400,
            detail="Password must contain at least one number (0-9)."
        )
    if not re.search(r"[^A-Za-z0-9]", password):
        raise HTTPException(
            status_code=400,
            detail="Password must contain at least one special character (e.g. !@#$%^&*)."
        )

def get_password_hash(password: str) -> str:
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(password.encode("utf-8"), salt).decode("utf-8")

def verify_password(plain_password: str, hashed_password: str) -> bool:
    if not hashed_password:
        return False
    if hashed_password.startswith("$2b$") or hashed_password.startswith("$2a$"):
        try:
            return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))
        except Exception:
            return False
    salt = "zigmaa_salt_2026"
    return hashlib.sha256((plain_password + salt).encode("utf-8")).hexdigest() == hashed_password

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    now = datetime.utcnow()
    if expires_delta:
        expire = now + expires_delta
    else:
        expire = now + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({
        "exp": expire,
        "iat": now,
        "type": "access_token"
    })
    encoded_jwt = jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
    return encoded_jwt

def decode_access_token(token: str) -> Optional[dict]:
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        return payload
    except JWTError:
        return None

def create_invitation_token(data: dict) -> str:
    """
    Creates a cryptographically signed invitation token with a strict 24-hour expiration limit.
    """
    to_encode = data.copy()
    now = datetime.utcnow()
    expire = now + timedelta(hours=24)
    to_encode.update({
        "exp": expire,
        "iat": now,
        "type": "team_invitation"
    })
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)

def decode_invitation_token(token: str) -> Optional[dict]:
    """
    Validates the invitation token. Rejects expired tokens (> 24 hours) or invalid signatures.
    """
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        if payload.get("type") != "team_invitation":
            return None
        return payload
    except JWTError:
        return None

