import base64
import json
import logging
from datetime import datetime, timedelta
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional, Dict, Any, Union

import httpx
from fastapi import HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.integration import OAuthToken, UserIntegration
from app.models.organization_user import User

logger = logging.getLogger("zigmaa.gmail_service")

GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GMAIL_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send"

async def get_user_google_oauth(user_id: str, db: AsyncSession) -> Optional[Dict[str, Any]]:
    """
    Looks up active Google OAuth credentials across oauth_tokens, user_integrations, and users tables.
    """
    if not user_id:
        return None

    # 1. Check oauth_tokens table
    try:
        res = await db.execute(
            select(OAuthToken).where(
                OAuthToken.user_id == user_id,
                OAuthToken.provider == "google",
                OAuthToken.is_connected == True
            ).limit(1)
        )
        token_rec = res.scalar_one_or_none()
        if token_rec and (token_rec.access_token or token_rec.refresh_token):
            return {
                "source": "oauth_tokens",
                "user_id": user_id,
                "email": token_rec.email,
                "access_token": token_rec.access_token,
                "refresh_token": token_rec.refresh_token,
                "expires_at": token_rec.expires_at
            }
    except Exception as e:
        logger.debug(f"oauth_tokens check note: {e}")

    # 2. Check user_integrations table
    try:
        res = await db.execute(
            select(UserIntegration).where(
                UserIntegration.user_id == user_id,
                UserIntegration.provider == "google",
                UserIntegration.is_google_connected == True
            ).limit(1)
        )
        int_rec = res.scalar_one_or_none()
        if int_rec and (int_rec.google_access_token or int_rec.google_refresh_token):
            return {
                "source": "user_integrations",
                "user_id": user_id,
                "email": int_rec.google_email,
                "access_token": int_rec.google_access_token,
                "refresh_token": int_rec.google_refresh_token,
                "expires_at": int_rec.google_token_expiry
            }
    except Exception as e:
        logger.debug(f"user_integrations check note: {e}")

    # 3. Check users table
    try:
        res = await db.execute(select(User).where(User.id == user_id).limit(1))
        user_rec = res.scalar_one_or_none()
        if user_rec and user_rec.is_google_connected and (user_rec.google_access_token or user_rec.google_refresh_token):
            return {
                "source": "users",
                "user_id": user_id,
                "email": user_rec.google_email or user_rec.email,
                "access_token": user_rec.google_access_token,
                "refresh_token": user_rec.google_refresh_token,
                "expires_at": user_rec.google_token_expiry
            }
    except Exception as e:
        logger.debug(f"users check note: {e}")

    return None

async def refresh_google_access_token(
    user_id: str,
    refresh_token: str,
    db: AsyncSession
) -> Optional[str]:
    """
    Refreshes an expired Google access token using the stored refresh_token.
    Persists the fresh token across oauth_tokens, user_integrations, and users tables.
    """
    if not refresh_token:
        return None

    client_id = settings.GOOGLE_CLIENT_ID
    client_secret = settings.GOOGLE_CLIENT_SECRET
    if not client_id or not client_secret:
        logger.error("Cannot refresh Google token: GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET is missing.")
        return None

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            token_resp = await client.post(
                GOOGLE_TOKEN_URL,
                data={
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "refresh_token": refresh_token,
                    "grant_type": "refresh_token"
                }
            )

            if token_resp.status_code == 200:
                token_data = token_resp.json()
                new_access_token = token_data.get("access_token")
                expires_in = token_data.get("expires_in", 3600)
                new_expiry = datetime.utcnow() + timedelta(seconds=expires_in)

                # Persist across all token stores
                try:
                    await db.execute(
                        update(User).where(User.id == user_id).values(
                            google_access_token=new_access_token,
                            google_token_expiry=new_expiry,
                            is_google_connected=True
                        )
                    )
                except Exception:
                    pass

                try:
                    await db.execute(
                        update(UserIntegration).where(UserIntegration.user_id == user_id).values(
                            google_access_token=new_access_token,
                            google_token_expiry=new_expiry,
                            is_google_connected=True
                        )
                    )
                except Exception:
                    pass

                try:
                    await db.execute(
                        update(OAuthToken).where(
                            OAuthToken.user_id == user_id,
                            OAuthToken.provider == "google"
                        ).values(
                            access_token=new_access_token,
                            expires_at=new_expiry,
                            is_connected=True
                        )
                    )
                except Exception:
                    pass

                await db.commit()
                logger.info(f"Successfully refreshed and stored Google OAuth access token for user {user_id}")
                return new_access_token
            else:
                logger.error(f"Google token refresh failed: status={token_resp.status_code}, response={token_resp.text}")
                return None
    except Exception as e:
        logger.error(f"Exception during Google token refresh: {e}", exc_info=True)
        return None

def build_mime_message(
    sender_name: str,
    sender_email: str,
    to_email: str,
    subject: str,
    body: str,
    html_body: Optional[str] = None
) -> str:
    """
    Creates an RFC 2822 / MIME multipart message and returns its base64url encoded representation.
    """
    msg = MIMEMultipart("alternative")
    msg["To"] = to_email
    msg["From"] = f"{sender_name} <{sender_email}>" if sender_name else sender_email
    msg["Subject"] = subject

    # Plain text part
    plain_text = body.strip() if body else ""
    part_plain = MIMEText(plain_text, "plain", "utf-8")
    msg.attach(part_plain)

    # HTML part
    if not html_body:
        html_body = f"""
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #1e293b; max-width: 600px; padding: 20px;">
            <p>{plain_text.replace(chr(10), '<br/>')}</p>
            <br/>
            <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
            <p style="font-size: 12px; color: #94a3b8;">Sent via Zigmaa CRM by {sender_name or sender_email}</p>
        </div>
        """
    part_html = MIMEText(html_body, "html", "utf-8")
    msg.attach(part_html)

    return base64.urlsafe_b64encode(msg.as_bytes()).decode("utf-8")

async def send_via_gmail_api(
    access_token: str,
    raw_mime_b64: str
) -> httpx.Response:
    """
    Calls Google Gmail API endpoint to send a message.
    """
    async with httpx.AsyncClient(timeout=20.0) as client:
        return await client.post(
            GMAIL_SEND_URL,
            headers={
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json"
            },
            json={"raw": raw_mime_b64}
        )

async def dispatch_email_service(
    db: AsyncSession,
    current_user: Optional[User],
    to_email: str,
    subject: str,
    body: str,
    html_body: Optional[str] = None
) -> Dict[str, Any]:
    """
    Main dispatch service:
    1. Checks if current_user has active Google OAuth tokens in oauth_tokens, user_integrations, or users.
    2. If OAuth exists:
       - Checks token freshness and auto-refreshes if needed.
       - Dispatches via Google Gmail API (POST https://gmail.googleapis.com/gmail/v1/users/me/messages/send).
       - If Google returns 401 Unauthorized, automatically refreshes token and retries once.
       - Guarantees email syncs directly to the user's authentic Gmail "Sent" folder.
       - STRICT REQUIREMENT: Does NOT invoke or touch SMTP for OAuth-connected users!
    3. If NO OAuth record exists:
       - Only then falls back to system SMTP credentials in .env.
    """
    clean_to = to_email.strip()
    if not clean_to or "@" not in clean_to:
        raise HTTPException(status_code=400, detail="Invalid recipient email address.")

    user_id = str(current_user.id) if current_user else None
    oauth_record = await get_user_google_oauth(user_id, db) if user_id else None

    # =========================================================================
    # PATH A: Authenticated User with Google OAuth
    # =========================================================================
    if oauth_record and (oauth_record.get("access_token") or oauth_record.get("refresh_token")):
        sender_email = (
            oauth_record.get("email")
            or (current_user.google_email if current_user and current_user.google_email else None)
            or (current_user.email if current_user and current_user.email else None)
        )
        sender_name = (
            (current_user.full_name if current_user and current_user.full_name else None)
            or "Zigmaa User"
        )

        access_token = oauth_record.get("access_token")
        refresh_token = oauth_record.get("refresh_token")
        expires_at = oauth_record.get("expires_at")

        # Proactively check token expiry (refresh if expired or within 60s of expiring)
        now = datetime.utcnow()
        if not access_token or (expires_at and (expires_at - now).total_seconds() < 60):
            if refresh_token:
                logger.info(f"[Gmail Dispatch] Access token expired or nearing expiry for {sender_email}. Refreshing...")
                fresh_token = await refresh_google_access_token(user_id, refresh_token, db)
                if fresh_token:
                    access_token = fresh_token

        if not access_token and refresh_token:
            access_token = await refresh_google_access_token(user_id, refresh_token, db)

        if not access_token:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Your Google OAuth session has expired. Please reconnect your Google account in Settings > Email Sync."
            )

        raw_mime = build_mime_message(sender_name, sender_email, clean_to, subject, body, html_body)

        # Attempt 1: Send via Gmail API
        resp = await send_via_gmail_api(access_token, raw_mime)

        # Attempt 2: If 401 Unauthorized, refresh token and retry
        if resp.status_code == 401 and refresh_token:
            logger.warning(f"[Gmail Dispatch] Received 401 Unauthorized from Gmail API. Exchanging refresh token for fresh access token...")
            new_token = await refresh_google_access_token(user_id, refresh_token, db)
            if new_token:
                access_token = new_token
                resp = await send_via_gmail_api(access_token, raw_mime)

        if resp.status_code in [200, 201]:
            resp_data = resp.json()
            gmail_msg_id = resp_data.get("id")
            thread_id = resp_data.get("threadId")
            logger.info(f"[Gmail API SUCCESS] Message {gmail_msg_id} sent to {clean_to} from {sender_email} (Sent Folder Synced)")
            return {
                "status": "success",
                "channel": "gmail_oauth",
                "message_id": gmail_msg_id,
                "thread_id": thread_id,
                "sender": sender_email,
                "recipient": clean_to,
                "subject": subject
            }
        else:
            err_detail = "Gmail API dispatch failed"
            try:
                err_json = resp.json()
                err_detail = err_json.get("error", {}).get("message") or resp.text
            except Exception:
                err_detail = resp.text

            logger.error(f"[Gmail API ERROR] status={resp.status_code}: {err_detail}")
            # STRICT RULE: Do NOT fallback to SMTP for OAuth connected users. Raise error so user is aware.
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Gmail API dispatch error ({resp.status_code}): {err_detail}"
            )

    # =========================================================================
    # PATH B: Non-OAuth Fallback to System SMTP
    # =========================================================================
    logger.info(f"[SMTP Dispatch] User {user_id} has no Google OAuth connection. Using system SMTP credentials.")
    sender_name = (current_user.full_name if current_user and current_user.full_name else None) or settings.SMTP_FROM_NAME or "Zigmaa CRM"
    sender_email = settings.SMTP_FROM_EMAIL or "noreply@zigmaacrm.com"

    if settings.SMTP_USER and settings.SMTP_PASSWORD:
        from app.core.email import send_email_async
        effective_html = html_body or f"""
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #1e293b; max-width: 600px; padding: 20px;">
            <p>{body.replace(chr(10), '<br/>')}</p>
            <br/>
            <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
            <p style="font-size: 12px; color: #94a3b8;">Sent via Zigmaa CRM by {sender_name}</p>
        </div>
        """
        try:
            await send_email_async(clean_to, subject, effective_html, body)
            logger.info(f"[SMTP SUCCESS] Dispatched email to {clean_to} from {sender_email}")
            return {
                "status": "success",
                "channel": "system_smtp",
                "sender": sender_email,
                "recipient": clean_to,
                "subject": subject
            }
        except Exception as e:
            logger.error(f"[SMTP FAILED] {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to dispatch email via SMTP server: {str(e)}"
            )
    else:
        # Dev / Mock Mode when no SMTP configured
        logger.info(f"[Local Mock Email] From={sender_email}, To={clean_to}, Subject={subject}")
        return {
            "status": "success",
            "channel": "mock_development",
            "sender": sender_email,
            "recipient": clean_to,
            "subject": subject
        }
