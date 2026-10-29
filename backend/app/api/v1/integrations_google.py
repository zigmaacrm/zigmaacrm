from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import datetime, timedelta
from typing import Optional
import urllib.parse
import httpx
import logging

from app.core.config import settings
from app.core.database import get_db
from app.models.organization_user import User
from app.models.integration import UserIntegration
from app.api.deps import get_current_user

logger = logging.getLogger("zigmaa.integrations.google")

router = APIRouter()

GOOGLE_AUTH_BASE = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"

SCOPES = [
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/calendar.events"
]

@router.get("/auth-url")
async def get_google_auth_url(
    current_user: User = Depends(get_current_user)
):
    """
    Generates the Google OAuth authorization URL with required Gmail and Calendar scopes.
    Embeds current user ID in state for verification on callback.
    """
    client_id = settings.GOOGLE_CLIENT_ID
    if not client_id:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Google Client ID is not configured in backend environment."
        )

    params = {
        "client_id": client_id,
        "redirect_uri": settings.GOOGLE_REDIRECT_URI,
        "response_type": "code",
        "scope": " ".join(SCOPES),
        "access_type": "offline",
        "prompt": "consent",
        "state": str(current_user.id)
    }

    url = f"{GOOGLE_AUTH_BASE}?{urllib.parse.urlencode(params)}"
    return {"url": url}

@router.get("/callback")
async def google_oauth_callback(
    code: Optional[str] = Query(None),
    state: Optional[str] = Query(None),
    error: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db)
):
    """
    OAuth2 callback from Google.
    Exchanges code for tokens, retrieves user's Google email, and saves credentials.
    Redirects back to frontend Settings page.
    """
    redirect_fallback = f"{settings.FRONTEND_URL}/settings?tab=email_sync"

    if error or not code:
        logger.warning(f"Google OAuth cancelled or returned error: {error}")
        return RedirectResponse(url=f"{redirect_fallback}&sync=error&message={urllib.parse.quote(error or 'Missing authorization code')}")

    if not state:
        logger.error("Google OAuth callback missing state parameter (user_id)")
        return RedirectResponse(url=f"{redirect_fallback}&sync=error&message=Missing+state+parameter")

    user_id = state.strip()

    # Load target user
    res = await db.execute(select(User).where(User.id == user_id))
    user = res.scalar_one_or_none()
    if not user:
        logger.error(f"User ID from OAuth state ({user_id}) not found in database")
        return RedirectResponse(url=f"{redirect_fallback}&sync=error&message=User+not+found")

    # Exchange code for access & refresh tokens
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            token_resp = await client.post(
                GOOGLE_TOKEN_URL,
                data={
                    "code": code,
                    "client_id": settings.GOOGLE_CLIENT_ID,
                    "client_secret": settings.GOOGLE_CLIENT_SECRET,
                    "redirect_uri": settings.GOOGLE_REDIRECT_URI,
                    "grant_type": "authorization_code"
                }
            )

            if token_resp.status_code != 200:
                err_text = token_resp.text
                logger.error(f"Failed to exchange Google OAuth code: {err_text}")
                return RedirectResponse(url=f"{redirect_fallback}&sync=error&message=Token+exchange+failed")

            token_data = token_resp.json()
            access_token = token_data.get("access_token")
            refresh_token = token_data.get("refresh_token")
            expires_in = token_data.get("expires_in", 3600)
            token_expiry = datetime.utcnow() + timedelta(seconds=expires_in)

            # Fetch Google user profile for email
            userinfo_resp = await client.get(
                GOOGLE_USERINFO_URL,
                headers={"Authorization": f"Bearer {access_token}"}
            )
            google_email = None
            if userinfo_resp.status_code == 200:
                google_email = userinfo_resp.json().get("email")

            google_email = google_email or user.email

            # Update User model
            user.google_email = google_email
            user.google_access_token = access_token
            if refresh_token:
                user.google_refresh_token = refresh_token
            user.google_token_expiry = token_expiry
            user.is_google_connected = True

            # Also update or create UserIntegration record
            int_res = await db.execute(select(UserIntegration).where(UserIntegration.user_id == user.id))
            integration = int_res.scalar_one_or_none()
            if not integration:
                integration = UserIntegration(
                    user_id=user.id,
                    provider="google",
                    google_email=google_email,
                    google_access_token=access_token,
                    google_refresh_token=refresh_token,
                    google_token_expiry=token_expiry,
                    is_google_connected=True
                )
                db.add(integration)
            else:
                integration.google_email = google_email
                integration.google_access_token = access_token
                if refresh_token:
                    integration.google_refresh_token = refresh_token
                integration.google_token_expiry = token_expiry
                integration.is_google_connected = True

            await db.commit()
            logger.info(f"Successfully connected Google OAuth for user {user.id} ({google_email})")

    except Exception as e:
        await db.rollback()
        logger.error(f"Unexpected error in Google OAuth callback: {str(e)}", exc_info=True)
        return RedirectResponse(url=f"{redirect_fallback}&sync=error&message=Internal+error")

    return RedirectResponse(url=f"{redirect_fallback}&sync=success&email={urllib.parse.quote(google_email or '')}")

@router.get("/status")
async def get_google_status(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Returns connection status and linked email for the logged-in user.
    """
    # Check User model directly
    if current_user.is_google_connected and current_user.google_email:
        return {
            "connected": True,
            "email": current_user.google_email,
            "provider": "google"
        }

    # Fallback to UserIntegration table
    int_res = await db.execute(select(UserIntegration).where(UserIntegration.user_id == current_user.id))
    integration = int_res.scalar_one_or_none()
    if integration and integration.is_google_connected and integration.google_email:
        return {
            "connected": True,
            "email": integration.google_email,
            "provider": "google"
        }

    return {
        "connected": False,
        "email": None,
        "provider": "google"
    }

@router.post("/disconnect")
async def disconnect_google(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Clears stored Google OAuth tokens and disconnects integration.
    """
    try:
        current_user.is_google_connected = False
        current_user.google_access_token = None
        current_user.google_refresh_token = None
        current_user.google_token_expiry = None
        current_user.google_email = None

        int_res = await db.execute(select(UserIntegration).where(UserIntegration.user_id == current_user.id))
        integration = int_res.scalar_one_or_none()
        if integration:
            integration.is_google_connected = False
            integration.google_access_token = None
            integration.google_refresh_token = None
            integration.google_token_expiry = None
            integration.google_email = None

        await db.commit()
        logger.info(f"Disconnected Google OAuth for user {current_user.id}")
        return {"success": True, "message": "Google account disconnected successfully."}
    except Exception as e:
        await db.rollback()
        logger.error(f"Error disconnecting Google integration: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to disconnect Google account.")
