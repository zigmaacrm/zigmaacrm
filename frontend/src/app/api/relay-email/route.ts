import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get("x-relay-key") || "";
    const allowedKeys = [
      process.env.SECRET_KEY,
      "zigmaa_secure_email_relay_2026_production",
      "ZIGMAA_SUPER_SECRET_KEY_2026_PRODUCTION_READY",
      "ZIGMAA_SECRET_KEY_CHANGE_IN_PRODUCTION",
      "zigmaa_email_relay_secret_2026"
    ].filter(Boolean);

    if (!allowedKeys.includes(authHeader)) {
      return NextResponse.json({ error: "Unauthorized relay request" }, { status: 401 });
    }

    const body = await req.json();
    const { to_email, subject, html_body, plain_body } = body;

    if (!to_email || !subject) {
      return NextResponse.json({ error: "Missing required fields (to_email, subject)" }, { status: 400 });
    }

    const smtpHost = process.env.SMTP_HOST || "smtp.gmail.com";
    const smtpUser = process.env.SMTP_USER || "zigmaatech@gmail.com";
    const smtpPass = (process.env.SMTP_PASSWORD || "fhgu cnck rkhj anmq").replace(/\s+/g, "");
    const fromName = process.env.SMTP_FROM_NAME || "Zigmaacrm";
    const fromEmail = process.env.SMTP_FROM_EMAIL || "zigmaatech@gmail.com";

    // Vercel serverless functions connect directly via port 465 SSL or 587 STARTTLS
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: 465,
      secure: true,
      auth: {
        user: smtpUser,
        pass: smtpPass
      },
      tls: {
        rejectUnauthorized: false
      }
    });

    const info = await transporter.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to: to_email,
      subject: subject,
      text: plain_body || undefined,
      html: html_body || undefined
    });

    return NextResponse.json({
      success: true,
      messageId: info.messageId,
      detail: `Email successfully delivered to ${to_email}`
    });
  } catch (err: any) {
    console.error("[RELAY EMAIL ERROR]", err);
    return NextResponse.json(
      { error: err.message || "Failed to dispatch email via relay" },
      { status: 500 }
    );
  }
}
