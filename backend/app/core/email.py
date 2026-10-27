import os
import json
import smtplib
import socket
import ssl
import asyncio
import urllib.request
import urllib.error
from pathlib import Path
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from app.core.config import settings

def _create_ipv4_socket(host: str, port: int, timeout: int = 5):
    """
    Strictly forces IPv4 connection to prevent [Errno 101] Network is unreachable
    on cloud environments where outbound IPv6 is disabled.
    """
    last_err = None
    try:
        addrs = socket.getaddrinfo(host, port, socket.AF_INET, socket.SOCK_STREAM)
    except Exception as e:
        addrs = []
        last_err = e

    for af, socktype, proto, canonname, sa in addrs:
        sock = None
        try:
            sock = socket.socket(af, socktype, proto)
            sock.settimeout(timeout)
            sock.connect(sa)
            return sock
        except Exception as e:
            last_err = e
            if sock:
                sock.close()

    # Fallback to standard connection if AF_INET was empty
    if not addrs:
        return socket.create_connection((host, port), timeout)
    raise last_err or OSError(f"Could not connect to {host}:{port} via IPv4")

class IPv4SMTP_SSL(smtplib.SMTP_SSL):
    def _get_socket(self, host, port, timeout):
        sock = _create_ipv4_socket(host, port, timeout)
        ctx = self.context if self.context is not None else ssl.create_default_context()
        return ctx.wrap_socket(sock, server_hostname=self._host)

class IPv4SMTP(smtplib.SMTP):
    def _get_socket(self, host, port, timeout):
        return _create_ipv4_socket(host, port, timeout)

def _dispatch_via_https_relay(to_email: str, subject: str, html_body: str, plain_body: str = "") -> bool:
    """
    HTTPS Port 443 relay for cloud environments (e.g. Render Free Tier)
    where outbound SMTP ports (25, 465, 587) are firewalled and blocked.
    """
    relay_urls = [
        "https://zigmaacrm.vercel.app/api/relay-email",
        "http://localhost:3000/api/relay-email"
    ]
    payload = json.dumps({
        "to_email": to_email,
        "subject": subject,
        "html_body": html_body,
        "plain_body": plain_body
    }).encode("utf-8")

    secret_key = "ZIGMAA_SUPER_SECRET_KEY_2026_PRODUCTION_READY"

    for url in relay_urls:
        try:
            req = urllib.request.Request(
                url,
                data=payload,
                headers={
                    "Content-Type": "application/json",
                    "x-relay-key": secret_key,
                    "User-Agent": "ZigmaaCRM-Backend/1.0"
                },
                method="POST"
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                if resp.status == 200:
                    resp_data = json.loads(resp.read().decode("utf-8"))
                    print(f"[EMAIL RELAY SUCCESS] Dispatched via {url}: {resp_data}")
                    return True
        except Exception as relay_err:
            print(f"[EMAIL RELAY ATTEMPT] {url} note: {relay_err}")
    return False

def _send_email_sync(to_email: str, subject: str, html_body: str, plain_body: str = "", image_path: str = None):
    # Pure multipart alternative (HTML + plain text) - ZERO image attachments!
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = f"{settings.SMTP_FROM_NAME} <{settings.SMTP_FROM_EMAIL}>"
    msg["To"] = to_email

    if plain_body:
        msg.attach(MIMEText(plain_body, "plain", "utf-8"))
    msg.attach(MIMEText(html_body, "html", "utf-8"))

    sent = False
    last_err = None
    smtp_host = settings.SMTP_HOST or "smtp.gmail.com"

    # ON RENDER / CLOUD ENVIRONMENTS:
    # Render Free Tier firewalls ports 25, 465, and 587, causing silent packet drops (8-16s timeout).
    # Therefore, on Render, PRIORITY 1 is the high-speed HTTPS Relay (Port 443), delivering in ~2 seconds!
    is_render = bool(os.getenv("RENDER") or os.getenv("RENDER_SERVICE_ID"))

    if is_render:
        try:
            print("[EMAIL] Detected Render environment. Dispatching via high-speed HTTPS relay...")
            if _dispatch_via_https_relay(to_email, subject, html_body, plain_body):
                return
        except Exception as e:
            last_err = e
            print(f"[EMAIL NOTICE] HTTPS Relay attempt note: {e}")

    # Priority 1 (Local): Port 587 (STARTTLS) strictly via IPv4 (~4s delivery on localhost)
    try:
        with IPv4SMTP(smtp_host, 587, timeout=5) as server:
            server.ehlo()
            server.starttls()
            server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
            server.sendmail(settings.SMTP_FROM_EMAIL, [to_email], msg.as_string())
            sent = True
    except Exception as e:
        last_err = e
        print(f"[EMAIL NOTICE] Port 587 STARTTLS dispatch attempt note: {e}")

    # Priority 2: Port 465 (SSL) strictly via IPv4 as backup
    if not sent:
        try:
            with IPv4SMTP_SSL(smtp_host, 465, timeout=5) as server:
                server.ehlo()
                server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
                server.sendmail(settings.SMTP_FROM_EMAIL, [to_email], msg.as_string())
                sent = True
        except Exception as e:
            last_err = e
            print(f"[EMAIL NOTICE] Port 465 SSL dispatch attempt note: {e}")

    # Priority 3 (Fallback for non-Render if SMTP failed): HTTPS Relay
    if not sent:
        try:
            if _dispatch_via_https_relay(to_email, subject, html_body, plain_body):
                sent = True
        except Exception as e:
            last_err = e
            print(f"[EMAIL NOTICE] Final HTTPS Relay attempt note: {e}")

    if not sent:
        raise RuntimeError(f"Unable to dispatch email to {to_email}: {last_err}")

async def send_email_async(to_email: str, subject: str, html_body: str, plain_body: str = ""):
    await asyncio.to_thread(_send_email_sync, to_email, subject, html_body, plain_body)

async def send_otp_email(to_email: str, otp_code: str):
    # Subject: "Use {otp_code} to reset your Zigmaa CRM password" triggers native OTP banner in Gmail
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
        <!-- Main Card Container -->
        <div style="max-width: 540px; margin: 0 auto; background-color: #ffffff; border: 1px solid #dadce0; border-radius: 8px; padding: 40px 44px; text-align: left; box-sizing: border-box;">
          
          <!-- Zigmaa CRM Centered Logo (Hosted CDN image - ZERO file attachments) -->
          <div style="text-align: center; margin-bottom: 20px;">
            <table role="presentation" border="0" cellspacing="0" cellpadding="0" style="margin: 0 auto;">
              <tr>
                <td align="center">
                  <img src="https://zigmaacrm.vercel.app/crmlogo.png" alt="Zigmaa CRM Logo" width="46" height="46" style="display: block; margin: 0 auto; border: 0;" />
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

          <!-- Title -->
          <h1 style="font-family: 'Google Sans', Roboto, Arial, sans-serif; font-size: 22px; font-weight: 500; color: #202124; text-align: center; margin: 18px 0 20px 0; line-height: 1.33;">
            Verify recovery email
          </h1>

          <!-- Thin horizontal separator -->
          <div style="border-top: 1px solid #dadce0; margin: 0 0 24px 0;"></div>

          <!-- Description paragraph -->
          <p style="font-size: 14px; line-height: 1.5; color: #3c4043; margin: 0 0 20px 0;">
            <strong style="color: #202124;">Zigmaa CRM</strong> received a request to reset your password or verify your account for <span style="color: #202124; font-weight: 500;">{to_email}</span>. Use this code to proceed:
          </p>

          <!-- 6-digit Code (Clean, Centered, No Forms/Borders) -->
          <div style="font-family: 'Google Sans', Roboto, monospace, sans-serif; font-size: 38px; font-weight: 500; letter-spacing: 6px; color: #202124; text-align: center; margin: 34px 0; user-select: all;">
            {otp_code}
          </div>

          <!-- Expiry Notice -->
          <p style="font-size: 14px; line-height: 1.5; color: #3c4043; margin: 0 0 16px 0;">
            This code will expire in 10 minutes.
          </p>

          <!-- Security note -->
          <p style="font-size: 14px; line-height: 1.5; color: #3c4043; margin: 0 0 24px 0;">
            If you don't recognize this request, you can safely ignore this email.
          </p>

          <!-- Bottom Footer Notice -->
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
