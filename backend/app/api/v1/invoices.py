from fastapi import APIRouter, Depends, HTTPException, Query, status, Response
from fastapi.responses import HTMLResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_, func, desc
from typing import List, Optional, Any
from pydantic import BaseModel
from datetime import datetime, date
import json

from app.core.database import get_db
from app.models.invoice import Invoice
from app.models.deal import Deal
from app.models.contact import Contact
from app.models.activity import Activity
from app.models.lead_pipeline import PipelineStage
from app.models.organization_user import Organization, User
from app.models.organization_setting import OrganizationSetting
from app.api.deps import get_optional_current_user

router = APIRouter()

class InvoiceItemSchema(BaseModel):
    description: str
    qty: int = 1
    unit_price: float = 0.0
    tax_rate: float = 18.0
    amount: Optional[float] = None

class InvoiceCreate(BaseModel):
    deal_id: Optional[str] = None
    contact_id: Optional[str] = None
    invoice_number: Optional[str] = None
    client_name: str
    client_company: Optional[str] = None
    client_email: Optional[str] = None
    client_phone: Optional[str] = None
    type: Optional[str] = "QUOTE"  # QUOTE, INVOICE
    status: Optional[str] = "DRAFT"  # DRAFT, SENT, PAID, OVERDUE
    issue_date: Optional[str] = None  # "YYYY-MM-DD"
    due_date: Optional[str] = None    # "YYYY-MM-DD"
    items: List[InvoiceItemSchema] = []
    subtotal: Optional[float] = None
    tax_amount: Optional[float] = None
    discount: Optional[float] = 0.0
    total_amount: Optional[float] = None
    notes: Optional[str] = None

class InvoiceUpdate(BaseModel):
    status: Optional[str] = None
    client_name: Optional[str] = None
    client_company: Optional[str] = None
    client_email: Optional[str] = None
    client_phone: Optional[str] = None
    due_date: Optional[str] = None
    notes: Optional[str] = None
    discount: Optional[float] = None

def _serialize_invoice(inv: Invoice) -> dict:
    items_data = inv.items
    if isinstance(items_data, str):
        try:
            items_data = json.loads(items_data)
        except Exception:
            items_data = []
    elif not items_data:
        items_data = []

    normalized_items = []
    for it in items_data:
        if isinstance(it, dict):
            q = it.get("qty", 1)
            p = float(it.get("unit_price", 0.0))
            amt = float(it.get("amount") or it.get("total") or (q * p))
            normalized_items.append({
                "description": it.get("description") or it.get("name") or "Item",
                "qty": q,
                "unit_price": p,
                "tax_rate": float(it.get("tax_rate", 18.0)),
                "amount": amt
            })

    created_str = None
    if inv.created_at:
        created_str = inv.created_at.isoformat() if hasattr(inv.created_at, "isoformat") else str(inv.created_at)

    updated_str = None
    if inv.updated_at:
        updated_str = inv.updated_at.isoformat() if hasattr(inv.updated_at, "isoformat") else str(inv.updated_at)

    return {
        "id": inv.id,
        "organization_id": inv.organization_id,
        "invoice_number": inv.invoice_number,
        "deal_id": inv.deal_id,
        "contact_id": inv.contact_id,
        "client_name": inv.client_name or "Client",
        "client_company": inv.client_company or "",
        "client_email": inv.client_email or "",
        "client_phone": inv.client_phone or "",
        "type": inv.type or "QUOTE",
        "status": inv.status or "DRAFT",
        "issue_date": str(inv.issue_date) if inv.issue_date else str(date.today()),
        "due_date": str(inv.due_date) if inv.due_date else None,
        "items": normalized_items,
        "subtotal": float(inv.subtotal or 0.0),
        "tax_amount": float(inv.tax_amount or 0.0),
        "discount": float(inv.discount or 0.0),
        "total_amount": float(inv.total_amount or 0.0),
        "notes": inv.notes or "",
        "created_at": created_str,
        "updated_at": updated_str
    }

def number_to_words_inr(number: float) -> str:
    """Convert number to Indian Currency Words format."""
    units = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"]
    teens = ["Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"]
    tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"]

    def convert_two_digit(n: int) -> str:
        if n == 0:
            return ""
        if n < 10:
            return units[n]
        if n < 20:
            return teens[n - 10]
        rem = n % 10
        return tens[n // 10] + (" " + units[rem] if rem > 0 else "")

    num = int(round(number))
    if num == 0:
        return "Rupees Zero Only"

    crore = num // 10000000
    num %= 10000000
    lakh = num // 100000
    num %= 100000
    thousand = num // 1000
    num %= 1000
    hundred = num // 100
    rem = num % 100

    parts = []
    if crore > 0:
        parts.append(convert_two_digit(crore) + " Crore")
    if lakh > 0:
        parts.append(convert_two_digit(lakh) + " Lakh")
    if thousand > 0:
        parts.append(convert_two_digit(thousand) + " Thousand")
    if hundred > 0:
        parts.append(units[hundred] + " Hundred")
    if rem > 0:
        parts.append(convert_two_digit(rem))

    return "Rupees " + " ".join(parts) + " Only"

@router.get("/invoices")
async def get_invoices(
    search: Optional[str] = Query(None),
    doc_type: Optional[str] = Query(None, alias="type"),
    status: Optional[str] = Query(None),
    deal_id: Optional[str] = Query(None),
    contact_id: Optional[str] = Query(None),
    current_user: Optional[User] = Depends(get_optional_current_user),
    db: AsyncSession = Depends(get_db)
):
    query = select(Invoice).order_by(Invoice.created_at.desc())

    if current_user and current_user.organization_id:
        query = query.where(Invoice.organization_id == current_user.organization_id)

    if deal_id:
        query = query.where(Invoice.deal_id == deal_id)
    if contact_id:
        query = query.where(Invoice.contact_id == contact_id)
    if doc_type and doc_type != "ALL":
        query = query.where(Invoice.type == doc_type.upper())
    if status and status != "ALL":
        query = query.where(Invoice.status == status.upper())

    if search:
        term = f"%{search}%"
        query = query.where(
            or_(
                Invoice.invoice_number.ilike(term),
                Invoice.client_name.ilike(term),
                Invoice.client_company.ilike(term),
                Invoice.client_email.ilike(term)
            )
        )

    result = await db.execute(query)
    invoices = result.scalars().all()
    return [_serialize_invoice(inv) for inv in invoices]

@router.post("/invoices", status_code=status.HTTP_201_CREATED)
async def create_invoice(
    payload: InvoiceCreate,
    org_id: Optional[str] = None,
    current_user: Optional[User] = Depends(get_optional_current_user),
    db: AsyncSession = Depends(get_db)
):
    target_org_id = org_id or (current_user.organization_id if current_user else None)
    if not target_org_id:
        res = await db.execute(select(Organization))
        org = res.scalars().first()
        target_org_id = org.id if org else None

    # Calculate item totals, subtotal, tax_amount, and grand total
    computed_items = []
    subtotal = 0.0
    tax_total = 0.0

    for item in payload.items:
        qty = max(1, item.qty)
        unit_price = max(0.0, float(item.unit_price))
        tax_rate = max(0.0, float(item.tax_rate))
        item_amount = round(qty * unit_price, 2)
        item_tax = round(item_amount * (tax_rate / 100.0), 2)

        subtotal += item_amount
        tax_total += item_tax

        computed_items.append({
            "description": item.description,
            "qty": qty,
            "unit_price": unit_price,
            "tax_rate": tax_rate,
            "amount": item_amount
        })

    subtotal = round(subtotal, 2)
    tax_total = round(tax_total, 2)
    discount = max(0.0, round(float(payload.discount or 0.0), 2))
    grand_total = max(0.0, round(subtotal + tax_total - discount, 2))

    # Generate document number if not provided
    doc_type = (payload.type or "QUOTE").upper()
    inv_no = payload.invoice_number
    if not inv_no:
        count_res = await db.execute(select(func.count(Invoice.id)).where(Invoice.type == doc_type))
        count = count_res.scalar() or 0
        year_str = datetime.utcnow().strftime("%Y")
        prefix = "QT" if doc_type == "QUOTE" else "INV"
        inv_no = f"{prefix}-{year_str}-{(count + 1):03d}"

    # Parse dates
    issue_d = date.today()
    if payload.issue_date:
        try:
            issue_d = datetime.strptime(payload.issue_date[:10], "%Y-%m-%d").date()
        except Exception:
            issue_d = date.today()

    due_d = None
    if payload.due_date:
        try:
            due_d = datetime.strptime(payload.due_date[:10], "%Y-%m-%d").date()
        except Exception:
            due_d = None

    default_notes = payload.notes or "Payment terms: 50% advance, balance upon project milestone delivery. Bank Transfer / UPI accepted."

    invoice = Invoice(
        organization_id=target_org_id,
        invoice_number=inv_no,
        deal_id=payload.deal_id or None,
        contact_id=payload.contact_id or None,
        client_name=payload.client_name.strip(),
        client_company=payload.client_company.strip() if payload.client_company else None,
        client_email=payload.client_email.strip() if payload.client_email else None,
        client_phone=payload.client_phone.strip() if payload.client_phone else None,
        type=doc_type,
        status=(payload.status or "DRAFT").upper(),
        issue_date=issue_d,
        due_date=due_d,
        items=computed_items,
        subtotal=subtotal,
        tax_amount=tax_total,
        discount=discount,
        total_amount=grand_total,
        notes=default_notes
    )

    db.add(invoice)

    # If linked to a deal: update deal value, advance stage to 'Proposal Sent', and log activity
    if payload.deal_id:
        deal_res = await db.execute(select(Deal).where(Deal.id == payload.deal_id))
        deal = deal_res.scalar_one_or_none()
        if deal:
            deal.deal_value = grand_total

            # Find 'Proposal Sent' stage in pipeline
            stage_res = await db.execute(
                select(PipelineStage)
                .where(
                    PipelineStage.pipeline_id == deal.pipeline_id,
                    PipelineStage.title.ilike("%Proposal%")
                )
            )
            proposal_stage = stage_res.scalars().first()
            if proposal_stage:
                deal.stage_id = proposal_stage.id

            # Append activity entry for the deal
            activity = Activity(
                organization_id=target_org_id or deal.organization_id or "default-org",
                deal_id=deal.id,
                contact_id=deal.contact_id or payload.contact_id,
                lead_id=deal.lead_id,
                type="NOTE",
                notes=f"Generated {doc_type} #{inv_no} for ₹{grand_total:,.2f}.\nDeal value updated and stage moved to Proposal Sent.",
                status="COMPLETED"
            )
            db.add(activity)

    await db.commit()
    await db.refresh(invoice)

    return _serialize_invoice(invoice)

@router.get("/invoices/{invoice_id}")
async def get_invoice_detail(invoice_id: str, db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(Invoice).where(Invoice.id == invoice_id))
    inv = res.scalar_one_or_none()
    if not inv:
        # Try finding by invoice_number as fallback
        res_num = await db.execute(select(Invoice).where(Invoice.invoice_number == invoice_id))
        inv = res_num.scalar_one_or_none()

    if not inv:
        raise HTTPException(status_code=404, detail="Invoice or quote not found")

    return _serialize_invoice(inv)

@router.patch("/invoices/{invoice_id}")
async def update_invoice(invoice_id: str, payload: InvoiceUpdate, db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(Invoice).where(Invoice.id == invoice_id))
    inv = res.scalar_one_or_none()
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")

    if payload.status:
        inv.status = payload.status.upper()
    if payload.client_name is not None:
        inv.client_name = payload.client_name
    if payload.client_company is not None:
        inv.client_company = payload.client_company
    if payload.client_email is not None:
        inv.client_email = payload.client_email
    if payload.client_phone is not None:
        inv.client_phone = payload.client_phone
    if payload.notes is not None:
        inv.notes = payload.notes
    if payload.due_date is not None:
        try:
            inv.due_date = datetime.strptime(payload.due_date[:10], "%Y-%m-%d").date()
        except Exception:
            pass

    await db.commit()
    await db.refresh(inv)
    return _serialize_invoice(inv)

@router.delete("/invoices/{invoice_id}")
async def delete_invoice(invoice_id: str, db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(Invoice).where(Invoice.id == invoice_id))
    inv = res.scalar_one_or_none()
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")

    await db.delete(inv)
    await db.commit()
    return {"message": "Document deleted successfully", "id": invoice_id}

@router.get("/invoices/{invoice_id}/pdf")
async def generate_invoice_pdf_view(invoice_id: str, db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(Invoice).where(Invoice.id == invoice_id))
    inv = res.scalar_one_or_none()
    if not inv:
        res_num = await db.execute(select(Invoice).where(Invoice.invoice_number == invoice_id))
        inv = res_num.scalar_one_or_none()

    if not inv:
        raise HTTPException(status_code=404, detail="Invoice or quote not found")

    # Fetch dynamic organization settings
    org_setting_res = await db.execute(select(OrganizationSetting).order_by(OrganizationSetting.created_at.desc()))
    org_setting = org_setting_res.scalars().first()

    org_res = await db.execute(select(Organization))
    org = org_res.scalars().first()

    seller_name = (org_setting.company_name if org_setting and org_setting.company_name else None) or (org.name if org and org.name else "Arsath Thoufiq's Workspace")
    seller_logo = org_setting.logo_url if org_setting else None
    seller_email = (org_setting.email if org_setting and org_setting.email else "thoufiqarsath84@gmail.com")
    seller_phone = (org_setting.phone if org_setting and org_setting.phone else "+91 98765 43210")
    seller_address = (org_setting.address if org_setting and org_setting.address else "Chennai Tech Park, Guindy, Chennai, Tamil Nadu 600032")
    seller_gstin = (org_setting.gstin if org_setting and org_setting.gstin else "33AAECZ9920K1ZX")
    signatory_name = (org_setting.signatory_name if org_setting and org_setting.signatory_name else "Arsath Thoufiq")
    signatory_desig = (org_setting.signatory_designation if org_setting and org_setting.signatory_designation else "Authorized Signatory")
    bank_name = (org_setting.bank_name if org_setting and org_setting.bank_name else "HDFC Bank Ltd")
    account_number = (org_setting.account_number if org_setting and org_setting.account_number else "50200084729104")
    ifsc_code = (org_setting.ifsc_code if org_setting and org_setting.ifsc_code else "HDFC0001244")
    upi_id = (org_setting.upi_id if org_setting and org_setting.upi_id else "zigmaa@hdfcbank")

    items = inv.items or []
    subtotal = float(inv.subtotal or 0.0)
    tax_amount = float(inv.tax_amount or 0.0)
    discount = float(inv.discount or 0.0)
    total_amount = float(inv.total_amount or 0.0)
    amount_in_words = number_to_words_inr(total_amount)
    doc_title = "TAX INVOICE" if inv.type == "INVOICE" else "OFFICIAL QUOTATION"
    badge_bg = "#dc2626" if inv.type == "INVOICE" else "#2563eb"

    # Generate item rows HTML
    item_rows = ""
    for idx, it in enumerate(items, 1):
        desc = it.get("description", "Service")
        qty = it.get("qty", 1)
        price = float(it.get("unit_price", 0.0))
        tax = float(it.get("tax_rate", 18.0))
        amt = float(it.get("amount", qty * price))
        item_rows += f"""
        <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 12px 14px; text-align: center; color: #64748b; font-size: 12px;">{idx}</td>
            <td style="padding: 12px 14px; color: #0f172a; font-size: 13px; font-weight: 600;">{desc}</td>
            <td style="padding: 12px 14px; text-align: center; color: #334155; font-size: 13px;">{qty}</td>
            <td style="padding: 12px 14px; text-align: right; color: #334155; font-size: 13px;">₹{price:,.2f}</td>
            <td style="padding: 12px 14px; text-align: center; color: #64748b; font-size: 12px;">{tax:.0f}%</td>
            <td style="padding: 12px 14px; text-align: right; color: #0f172a; font-size: 13px; font-weight: 700;">₹{amt:,.2f}</td>
        </tr>
        """

    logo_or_brand_html = f'<img src="{seller_logo}" style="max-height: 52px; max-width: 200px; object-fit: contain; margin-bottom: 8px;" alt="{seller_name}" />' if seller_logo else f'<span style="font-size: 22px; font-weight: 900; color: #dc2626; letter-spacing: -0.5px;">{seller_name}</span>'

    html_content = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{inv.invoice_number} - {inv.client_name}</title>
    <style>
        @page {{
            size: A4;
            margin: 12mm;
        }}
        body {{
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            color: #0f172a;
            background: #f8fafc;
            margin: 0;
            padding: 24px;
        }}
        .invoice-box {{
            max-width: 820px;
            margin: auto;
            background: #ffffff;
            padding: 40px;
            border-radius: 16px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.05);
            border: 1px solid #e2e8f0;
        }}
        .header-table, .client-table, .items-table, .totals-table {{
            width: 100%;
            border-collapse: collapse;
        }}
        .brand-badge {{
            display: inline-block;
            background: {badge_bg};
            color: #ffffff;
            font-size: 11px;
            font-weight: 800;
            padding: 4px 10px;
            border-radius: 6px;
            letter-spacing: 0.5px;
            text-transform: uppercase;
        }}
        .print-btn {{
            position: fixed;
            top: 20px;
            right: 20px;
            background: #dc2626;
            color: #ffffff;
            border: none;
            padding: 10px 18px;
            font-size: 13px;
            font-weight: 700;
            border-radius: 10px;
            cursor: pointer;
            box-shadow: 0 4px 12px rgba(220, 38, 38, 0.25);
            display: flex;
            align-items: center;
            gap: 8px;
            z-index: 999;
        }}
        .print-btn:hover {{
            background: #b91c1c;
        }}
        @media print {{
            body {{
                background: #ffffff;
                padding: 0;
            }}
            .print-btn {{
                display: none;
            }}
            .invoice-box {{
                box-shadow: none;
                border: none;
                padding: 0;
                width: 100%;
                max-width: 100%;
            }}
        }}
    </style>
</head>
<body>
    <button class="print-btn" onclick="window.print()">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="6 9 6 2 18 2 18 9"></polyline>
            <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
            <rect x="6" y="14" width="12" height="8"></rect>
        </svg>
        Print / Save PDF
    </button>

    <div class="invoice-box">
        <!-- Header -->
        <table class="header-table" style="margin-bottom: 24px;">
            <tr>
                <td style="vertical-align: top; width: 60%;">
                    <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 6px;">
                        {logo_or_brand_html}
                        <span class="brand-badge">{doc_title}</span>
                    </div>
                    <p style="font-size: 12px; color: #475569; font-weight: 600; margin: 2px 0;">{seller_name}</p>
                    <p style="font-size: 11px; color: #64748b; margin: 2px 0;">{seller_address}</p>
                    <p style="font-size: 11px; color: #94a3b8; margin: 2px 0;">GSTIN: {seller_gstin} • {seller_email} • {seller_phone}</p>
                </td>
                <td style="vertical-align: top; text-align: right; width: 40%;">
                    <div style="font-size: 18px; font-weight: 800; color: #0f172a; font-family: monospace;">{inv.invoice_number}</div>
                    <p style="font-size: 12px; color: #64748b; margin: 4px 0;">
                        <strong>Date:</strong> {inv.issue_date or date.today()}
                    </p>
                    {f'<p style="font-size: 12px; color: #64748b; margin: 2px 0;"><strong>Valid Until:</strong> {inv.due_date}</p>' if inv.due_date else ''}
                    <div style="margin-top: 8px;">
                        <span style="display: inline-block; padding: 3px 8px; border-radius: 6px; font-size: 11px; font-weight: 700; background: {'#ecfdf5' if inv.status == 'PAID' else '#eff6ff'}; color: {'#059669' if inv.status == 'PAID' else '#2563eb'};">
                            Status: {inv.status}
                        </span>
                    </div>
                </td>
            </tr>
        </table>

        <hr style="border: none; border-top: 1px solid #e2e8f0; margin-bottom: 24px;" />

        <!-- Bill To & Bill From Section -->
        <table class="client-table" style="margin-bottom: 28px;">
            <tr>
                <td style="width: 50%; vertical-align: top; padding: 16px; background: #f8fafc; border-radius: 12px; border: 1px solid #e2e8f0;">
                    <div style="font-size: 10px; font-weight: 800; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px;">BILLED TO</div>
                    <div style="font-size: 14px; font-weight: 800; color: #0f172a;">{inv.client_name}</div>
                    {f'<div style="font-size: 12px; color: #475569; font-weight: 600; margin-top: 2px;">{inv.client_company}</div>' if inv.client_company else ''}
                    {f'<div style="font-size: 12px; color: #64748b; margin-top: 2px;">{inv.client_email}</div>' if inv.client_email else ''}
                    {f'<div style="font-size: 12px; color: #64748b; margin-top: 2px;">{inv.client_phone}</div>' if inv.client_phone else ''}
                </td>
                <td style="width: 5%;"></td>
                <td style="width: 45%; vertical-align: top; padding: 16px; background: #f8fafc; border-radius: 12px; border: 1px solid #e2e8f0;">
                    <div style="font-size: 10px; font-weight: 800; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px;">ISSUED BY</div>
                    <div style="font-size: 13px; font-weight: 700; color: #0f172a;">{seller_name}</div>
                    <div style="font-size: 12px; color: #64748b; margin-top: 2px;">{seller_address}</div>
                    <div style="font-size: 12px; color: #64748b; margin-top: 2px;">GSTIN: {seller_gstin} | {seller_phone}</div>
                </td>
            </tr>
        </table>

        <!-- Line Items Table -->
        <table class="items-table" style="margin-bottom: 24px; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
            <thead>
                <tr style="background: #f1f5f9; text-align: left; font-size: 11px; text-transform: uppercase; color: #475569; font-weight: 800; letter-spacing: 0.5px;">
                    <th style="padding: 10px 14px; width: 6%; text-align: center;">#</th>
                    <th style="padding: 10px 14px; width: 44%;">ITEM & DESCRIPTION</th>
                    <th style="padding: 10px 14px; width: 12%; text-align: center;">QTY</th>
                    <th style="padding: 10px 14px; width: 14%; text-align: right;">RATE (₹)</th>
                    <th style="padding: 10px 14px; width: 10%; text-align: center;">TAX</th>
                    <th style="padding: 10px 14px; width: 14%; text-align: right;">AMOUNT (₹)</th>
                </tr>
            </thead>
            <tbody>
                {item_rows}
            </tbody>
        </table>

        <!-- Totals & Amount in Words -->
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 28px;">
            <tr>
                <td style="width: 55%; vertical-align: top; padding-right: 20px;">
                    <div style="padding: 14px; background: #faf5ff; border: 1px solid #e9d5ff; border-radius: 10px;">
                        <span style="font-size: 10px; font-weight: 800; text-transform: uppercase; color: #7e22ce; display: block; margin-bottom: 4px;">AMOUNT IN WORDS</span>
                        <span style="font-size: 12px; font-weight: 700; color: #581c87; line-height: 1.4;">{amount_in_words}</span>
                    </div>

                    <div style="margin-top: 14px; font-size: 11px; color: #64748b; line-height: 1.5; padding: 12px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px;">
                        <strong style="color: #334155; display: block; margin-bottom: 3px;">Payment Instructions & Bank Transfer:</strong>
                        Bank: {bank_name} | A/C: {account_number}<br/>
                        IFSC: {ifsc_code} | UPI ID: {upi_id}
                    </div>
                </td>
                <td style="width: 45%; vertical-align: top;">
                    <table style="width: 100%; font-size: 13px; border-collapse: collapse;">
                        <tr>
                            <td style="padding: 6px 0; color: #64748b;">Subtotal:</td>
                            <td style="padding: 6px 0; text-align: right; font-weight: 600; color: #1e293b;">₹{subtotal:,.2f}</td>
                        </tr>
                        <tr>
                            <td style="padding: 6px 0; color: #64748b;">GST / Tax:</td>
                            <td style="padding: 6px 0; text-align: right; font-weight: 600; color: #1e293b;">₹{tax_amount:,.2f}</td>
                        </tr>
                        {f'''<tr>
                            <td style="padding: 6px 0; color: #059669;">Discount:</td>
                            <td style="padding: 6px 0; text-align: right; font-weight: 600; color: #059669;">- ₹{discount:,.2f}</td>
                        </tr>''' if discount > 0 else ''}
                        <tr style="border-top: 2px solid #0f172a; border-bottom: 2px solid #0f172a;">
                            <td style="padding: 10px 0; font-size: 15px; font-weight: 800; color: #0f172a;">Grand Total:</td>
                            <td style="padding: 10px 0; text-align: right; font-size: 18px; font-weight: 900; color: #dc2626;">₹{total_amount:,.2f}</td>
                        </tr>
                    </table>
                </td>
            </tr>
        </table>

        <!-- Notes and Signatory Row -->
        <table style="width: 100%; border-collapse: collapse; margin-top: 10px;">
            <tr>
                <td style="width: 60%; vertical-align: top; padding-right: 20px;">
                    <div style="padding: 14px; background: #f8fafc; border-radius: 10px; border: 1px solid #e2e8f0; font-size: 11px; color: #64748b;">
                        <strong style="color: #334155; display: block; margin-bottom: 4px;">Terms & Conditions:</strong>
                        {inv.notes or "Payment terms: 50% advance, balance upon milestone delivery. Bank transfer or UPI accepted."}
                    </div>
                </td>
                <td style="width: 40%; vertical-align: bottom; text-align: right;">
                    <div style="display: inline-block; text-align: center; width: 220px;">
                        <div style="height: 48px; border-bottom: 1.5px solid #94a3b8; margin-bottom: 6px;"></div>
                        <div style="font-size: 12px; font-weight: 800; color: #0f172a;">{signatory_name}</div>
                        <div style="font-size: 11px; color: #64748b; font-weight: 600;">{signatory_desig}</div>
                        <div style="font-size: 10px; color: #94a3b8; margin-top: 2px;">{seller_name}</div>
                    </div>
                </td>
            </tr>
        </table>

        <div style="margin-top: 24px; text-align: center; font-size: 10px; color: #94a3b8;">
            This is a computer-generated proposal document issued by {seller_name}.
        </div>
    </div>
</body>
</html>
"""
    return HTMLResponse(content=html_content)
