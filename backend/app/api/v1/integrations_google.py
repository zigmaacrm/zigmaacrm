from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import datetime, timedelta
from typing import Optional
import urllib.parse
import httpx
import logging
import uuid

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

async def ensure_fresh_google_token(user: User, db: AsyncSession) -> Optional[str]:
    """
    Returns a valid Google OAuth access token for the given user.
    If access token is expired or close to expiry (within 60s), refreshes it using refresh_token.
    """
    if not user:
        return None

    # Check User model or fallback to UserIntegration
    refresh_token = user.google_refresh_token
    access_token = user.google_access_token
    token_expiry = user.google_token_expiry
    is_connected = user.is_google_connected

    if not is_connected and not refresh_token and not access_token:
        int_res = await db.execute(select(UserIntegration).where(UserIntegration.user_id == user.id))
        integration = int_res.scalar_one_or_none()
        if integration and integration.is_google_connected:
            refresh_token = integration.google_refresh_token
            access_token = integration.google_access_token
            token_expiry = integration.google_token_expiry
            is_connected = True

    if not is_connected or (not access_token and not refresh_token):
        return None

    now = datetime.utcnow()
    # Check if token is expired or will expire soon
    needs_refresh = False
    if not access_token:
        needs_refresh = True
    elif token_expiry and (token_expiry - now).total_seconds() < 60:
        needs_refresh = True

    if needs_refresh and refresh_token:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                token_resp = await client.post(
                    GOOGLE_TOKEN_URL,
                    data={
                        "client_id": settings.GOOGLE_CLIENT_ID,
                        "client_secret": settings.GOOGLE_CLIENT_SECRET,
                        "refresh_token": refresh_token,
                        "grant_type": "refresh_token"
                    }
                )
                if token_resp.status_code == 200:
                    token_data = token_resp.json()
                    access_token = token_data.get("access_token")
                    expires_in = token_data.get("expires_in", 3600)
                    token_expiry = datetime.utcnow() + timedelta(seconds=expires_in)

                    user.google_access_token = access_token
                    user.google_token_expiry = token_expiry
                    user.is_google_connected = True

                    int_res = await db.execute(select(UserIntegration).where(UserIntegration.user_id == user.id))
                    integration = int_res.scalar_one_or_none()
                    if integration:
                        integration.google_access_token = access_token
                        integration.google_token_expiry = token_expiry
                        integration.is_google_connected = True

                    await db.commit()
                    logger.info(f"Refreshed Google OAuth token for user {user.id}")
                else:
                    logger.warning(f"Failed to refresh Google token: {token_resp.text}")
        except Exception as e:
            logger.error(f"Error during Google token refresh: {e}")

    return access_token

async def create_google_calendar_event(
    user: User,
    event_data: dict,
    db: AsyncSession
) -> dict:
    """
    Creates an event in the user's primary Google Calendar with Google Meet enabled.
    Returns: dict with google_event_id, meet_link, html_link, or error details.
    """
    token = await ensure_fresh_google_token(user, db)
    if not token:
        return {"success": False, "error": "No valid Google OAuth token available for user"}

    title = event_data.get("title") or "Meeting"
    description = event_data.get("description") or event_data.get("notes") or ""
    start_time = event_data.get("start_time")
    end_time = event_data.get("end_time") or start_time

    # Normalize ISO format: Google Calendar requires RFC3339 (e.g. 2026-10-30T10:00:00)
    def to_rfc3339(ts: Optional[str]) -> str:
        if not ts:
            return datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S")
        c = ts.strip().replace(" ", "T")
        if len(c) == 16:
            c = f"{c}:00"
        return c

    start_iso = to_rfc3339(start_time)
    end_iso = to_rfc3339(end_time)

    body = {
        "summary": title,
        "description": description,
        "start": {
            "dateTime": start_iso,
            "timeZone": "Asia/Kolkata"
        },
        "end": {
            "dateTime": end_iso,
            "timeZone": "Asia/Kolkata"
        },
        "conferenceData": {
            "createRequest": {
                "requestId": f"zgm-{uuid.uuid4().hex[:12]}",
                "conferenceSolutionKey": {
                    "type": "hangoutsMeet"
                }
            }
        }
    }

    attendee_email = event_data.get("attendee_email")
    attendee_name = event_data.get("attendee_name")
    if attendee_email and "@" in attendee_email:
        body["attendees"] = [{"email": attendee_email, "displayName": attendee_name or attendee_email}]

    url = "https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(url, headers=headers, json=body)
            if resp.status_code in [200, 201]:
                data = resp.json()
                google_id = data.get("id")
                # Extract Google Meet Link
                meet_link = data.get("hangoutLink")
                if not meet_link:
                    entry_points = data.get("conferenceData", {}).get("entryPoints", [])
                    for ep in entry_points:
                        if ep.get("entryPointType") == "video" and ep.get("uri"):
                            meet_link = ep.get("uri")
                            break
                html_link = data.get("htmlLink")

                logger.info(f"Successfully created Google Calendar event {google_id} with meet {meet_link}")
                return {
                    "success": True,
                    "google_event_id": google_id,
                    "meet_link": meet_link,
                    "html_link": html_link
                }
            else:
                logger.warning(f"Google Calendar event creation returned status {resp.status_code}: {resp.text}")
                return {"success": False, "error": resp.text, "status_code": resp.status_code}
    except Exception as e:
        logger.error(f"Failed to create Google Calendar event: {e}", exc_info=True)
        return {"success": False, "error": str(e)}

async def delete_google_calendar_event(
    user: User,
    google_event_id: str,
    db: AsyncSession
) -> bool:
    """
    Deletes an event from the user's primary Google Calendar by Google event ID.
    Ignores 404/410 if already deleted remotely.
    """
    if not google_event_id:
        return False

    token = await ensure_fresh_google_token(user, db)
    if not token:
        logger.warning(f"Cannot delete Google event {google_event_id}: user has no valid token")
        return False

    url = f"https://www.googleapis.com/calendar/v3/calendars/primary/events/{google_event_id}"
    headers = {"Authorization": f"Bearer {token}"}

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.delete(url, headers=headers)
            if resp.status_code in [200, 204]:
                logger.info(f"Successfully deleted Google Calendar event {google_event_id}")
                return True
            elif resp.status_code in [404, 410]:
                logger.info(f"Google event {google_event_id} already deleted remotely (status {resp.status_code})")
                return True
            else:
                logger.warning(f"Google Calendar delete returned status {resp.status_code}: {resp.text}")
                return False
    except Exception as e:
        logger.error(f"Failed to delete Google Calendar event {google_event_id}: {e}", exc_info=True)
        return False
