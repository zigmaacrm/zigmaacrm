from typing import Optional, List, Union, Dict, Any
import logging
import base64
import re
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.api.deps import get_current_user, get_optional_current_user
from app.models.organization_user import User
from app.models.contact import Contact
from app.models.lead_pipeline import Lead
from app.models.activity import Activity, EmailLog
from app.services.gmail_service import (
    dispatch_email_service,
    build_rfc_compliant_gmail_message,
    wrap_clean_email_html
)

logger = logging.getLogger("zigmaa.emails_api")

router = APIRouter()

class SendEmailPayload(BaseModel):
    to: Union[str, List[str]] = Field(..., description="Recipient email address or list of email addresses")
    subject: str = Field(..., description="Subject of the email")
    body: str = Field(..., description="Plain-text body of the email")
    html_body: Optional[str] = Field(None, description="Optional rich HTML body")
    reply_to: Optional[str] = Field(None, description="Optional custom Reply-To header")
    contact_id: Optional[str] = Field(None, description="Optional Contact ID to associate activity")
    lead_id: Optional[str] = Field(None, description="Optional Lead ID to associate activity")
    deal_id: Optional[str] = Field(None, description="Optional Deal ID")

@router.post("/send")
async def send_email(
    payload: SendEmailPayload,
    current_user: Optional[User] = Depends(get_optional_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Sends an email via the user's authenticated Google OAuth Gmail API using a strict RFC-compliant
    multipart/alternative structure to guarantee high inbox deliverability and prevent Spam classification.
    Falls back to SMTP ONLY if no Google OAuth connection exists for the current user.
    """
    if not payload.subject.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Subject cannot be empty.")
    if not payload.body.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email body cannot be empty.")

    # Determine recipient(s)
    recipients: List[str] = []
    if isinstance(payload.to, list):
        recipients = [r.strip() for r in payload.to if r and r.strip()]
    elif isinstance(payload.to, str):
        recipients = [r.strip() for r in payload.to.split(",") if r and r.strip()]

    if not recipients:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="At least one recipient email is required.")

    results = []
    org_id = current_user.organization_id if current_user and current_user.organization_id else "default-org"

    for to_addr in recipients:
        try:
            res = await dispatch_email_service(
                db=db,
                current_user=current_user,
                to_email=to_addr,
                subject=payload.subject,
                body=payload.body,
                html_body=payload.html_body,
                contact_id=payload.contact_id,
                lead_id=payload.lead_id,
                reply_to=payload.reply_to
            )
            results.append(res)
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error dispatching email to {to_addr}: {e}", exc_info=True)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to dispatch email to {to_addr}: {str(e)}"
            )

    primary_res = results[0] if results else {}
    sender_addr = primary_res.get("sender") or (
        (current_user.google_email if current_user and current_user.google_email else None)
        or (current_user.email if current_user and current_user.email else None)
        or "team@zigmaacrm.com"
    )

    # Associate Activity timeline record if contact_id or lead_id is provided
    activity_rec = None
    if payload.contact_id or payload.lead_id:
        try:
            rfc_id_note = f"\nMessage-ID: {primary_res.get('rfc_message_id', '')}" if primary_res.get('rfc_message_id') else ""
            activity_note = f"Sent Email ({primary_res.get('channel', 'email')}): \"{payload.subject}\"\nTo: {', '.join(recipients)}{rfc_id_note}\n\n{payload.body}"
            activity = Activity(
                organization_id=org_id,
                contact_id=payload.contact_id,
                lead_id=payload.lead_id,
                type="EMAIL",
                notes=activity_note,
                status="COMPLETED"
            )
            db.add(activity)
            await db.commit()
            await db.refresh(activity)
            activity_rec = {
                "id": activity.id,
                "type": activity.type,
                "notes": activity.notes,
                "created_at": activity.created_at.isoformat() if activity.created_at else None
            }
        except Exception as act_err:
            logger.warning(f"Failed to record activity timeline for email: {act_err}")

    return {
        "status": "success",
        "message": f"Email successfully sent to {', '.join(recipients)}",
        "sender": sender_addr,
        "recipients": recipients,
        "subject": payload.subject,
        "channel": primary_res.get("channel"),
        "message_id": primary_res.get("message_id"),
        "rfc_message_id": primary_res.get("rfc_message_id"),
        "thread_id": primary_res.get("thread_id"),
        "activity": activity_rec,
        "results": results
    }
