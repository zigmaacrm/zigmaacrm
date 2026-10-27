import os
import smtplib
import asyncio
from pathlib import Path
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.image import MIMEImage
from app.core.config import settings

def _send_email_sync(to_email: str, subject: str, html_body: str, plain_body: str = "", image_path: str = None):
    # Use 'related' to embed inline image seamlessly with 'alternative' text & html
    msg = MIMEMultipart("related")
    msg["Subject"] = subject
    msg["From"] = f"{settings.SMTP_FROM_NAME} <{settings.SMTP_FROM_EMAIL}>"
    msg["To"] = to_email

    msg_alt = MIMEMultipart("alternative")
    msg.attach(msg_alt)

    if plain_body:
        msg_alt.attach(MIMEText(plain_body, "plain", "utf-8"))
    msg_alt.attach(MIMEText(html_body, "html", "utf-8"))

    # Resolve logo image
    logo_file = image_path
    if not logo_file or not os.path.exists(logo_file):
        candidate_paths = [
            Path(__file__).resolve().parent.parent / "assets" / "crmlogo.png",
            Path(__file__).resolve().parent.parent.parent.parent / "frontend" / "public" / "crmlogo.png",
        ]
        for p in candidate_paths:
            if p.exists():
                logo_file = str(p)
                break

    if logo_file and os.path.exists(logo_file):
        try:
            with open(logo_file, "rb") as f:
                img = MIMEImage(f.read())
                img.add_header("Content-ID", "<zigmaa_logo>")
                img.add_header("Content-Disposition", "inline", filename="crmlogo.png")
                msg.attach(img)
        except Exception as e:
            print(f"[EMAIL] Warning: Could not attach inline logo: {e}")

    sent = False
    last_err = None

    # Priority 1: Port 465 (SSL)
    try:
        with smtplib.SMTP_SSL(settings.SMTP_HOST or "smtp.gmail.com", 465, timeout=15) as server:
            server.ehlo()
            server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
            server.sendmail(settings.SMTP_FROM_EMAIL, [to_email], msg.as_string())
            sent = True
    except Exception as e:
        last_err = e
        print(f"[EMAIL NOTICE] Port 465 SSL dispatch attempt note: {e}")

    # Priority 2: Port 587 (STARTTLS)
    if not sent:
        try:
            with smtplib.SMTP(settings.SMTP_HOST or "smtp.gmail.com", 587, timeout=15) as server:
                server.ehlo()
                server.starttls()
                server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
                server.sendmail(settings.SMTP_FROM_EMAIL, [to_email], msg.as_string())
                sent = True
        except Exception as e:
            last_err = e
            print(f"[EMAIL NOTICE] Port 587 STARTTLS dispatch attempt note: {e}")

    if not sent:
        raise RuntimeError(f"Unable to dispatch email to {to_email}: {last_err}")

async def send_email_async(to_email: str, subject: str, html_body: str, plain_body: str = ""):
    await asyncio.to_thread(_send_email_sync, to_email, subject, html_body, plain_body)

async def send_otp_email(to_email: str, otp_code: str):
    # Format subject as "Use {otp_code} to ..." so Gmail automatically recognizes and renders the "Copy code" card on top
    subject = f"Use {otp_code} to reset your Zigmaa CRM password"

    plain_body = f"""Use {otp_code} to reset your Zigmaa CRM password

Zigmaa CRM received a request to verify your account and reset your password for {to_email}. Use this code to proceed:

{otp_code}

This code will expire in 10 minutes.
If you don't recognize this request, you can safely ignore this email.

You received this email to let you know about important changes to your Zigmaa CRM account and services.
"""

    html_body = f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{subject}</title>
</head>
<body style="margin: 0; padding: 24px 12px; background-color: #f8f9fa; font-family: 'Google Sans', Roboto, -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; color: #202124;">
  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
    <tr>
      <td align="center">
        <!-- Main Card Container (Matches Google Light Theme in Image 5) -->
        <div style="max-width: 540px; margin: 0 auto; background-color: #ffffff; border: 1px solid #dadce0; border-radius: 8px; padding: 40px 44px; text-align: left; box-sizing: border-box;">
          
          <!-- Zigmaa CRM Centered Logo -->
          <div style="text-align: center; margin-bottom: 20px;">
            <table role="presentation" border="0" cellspacing="0" cellpadding="0" style="margin: 0 auto;">
              <tr>
                <td align="center">
                  <img src="cid:zigmaa_logo" alt="Zigmaa CRM Logo" width="46" height="46" style="display: block; margin: 0 auto; border: 0;" />
                </td>
              </tr>
              <tr>
                <td align="center" style="padding-top: 8px;">
                  <span style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 20px; font-weight: 700; color: #111827; letter-spacing: -0.5px;">
                    <span style="color: #E60012;">Zigmaa</span> CRM
                  </span>
                </td>
              </tr>
            </table>
          </div>

          <!-- Title (Matches Image 5) -->
          <h1 style="font-family: 'Google Sans', Roboto, Arial, sans-serif; font-size: 22px; font-weight: 500; color: #202124; text-align: center; margin: 18px 0 20px 0; line-height: 1.33;">
            Verify recovery email
          </h1>

          <!-- Thin horizontal separator (Matches Image 5) -->
          <div style="border-top: 1px solid #dadce0; margin: 0 0 24px 0;"></div>

          <!-- Description paragraph (Matches Image 5) -->
          <p style="font-size: 14px; line-height: 1.5; color: #3c4043; margin: 0 0 20px 0;">
            <strong style="color: #202124;">Zigmaa CRM</strong> received a request to reset your password or verify your account for <span style="color: #202124; font-weight: 500;">{to_email}</span>. Use this code to proceed:
          </p>

          <!-- 6-digit Code (Clean, Centered, No Forms/Borders as in Image 5) -->
          <div style="font-family: 'Google Sans', Roboto, monospace, sans-serif; font-size: 38px; font-weight: 500; letter-spacing: 6px; color: #202124; text-align: center; margin: 34px 0; user-select: all;">
            {otp_code}
          </div>

          <!-- Expiry Notice (Matches Image 5) -->
          <p style="font-size: 14px; line-height: 1.5; color: #3c4043; margin: 0 0 16px 0;">
            This code will expire in 10 minutes.
          </p>

          <!-- Security note (Matches Image 5) -->
          <p style="font-size: 14px; line-height: 1.5; color: #3c4043; margin: 0 0 24px 0;">
            If you don't recognize this request, you can safely ignore this email.
          </p>

          <!-- Bottom Footer Notice (Matches Image 5) -->
          <div style="border-top: 1px solid #dadce0; margin-top: 28px; padding-top: 16px;">
            <p style="font-size: 11px; line-height: 1.4; color: #70757a; text-align: center; margin: 0;">
              You received this email to let you know about important changes to your Zigmaa CRM account and services.
            </p>
          </div>

        </div>
      </td>
    </tr>
  </table>
</body>
</html>
"""

    await send_email_async(to_email, subject, html_body, plain_body)
