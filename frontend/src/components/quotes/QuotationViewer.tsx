"use client";

import { useState, useEffect } from "react";
import { Invoice, OrganizationSettings } from "@/lib/mockData";
import { formatCurrency, formatDate } from "@/lib/utils";
import { api } from "@/lib/api";

interface QuotationViewerProps {
  invoice: Invoice;
  orgSettings?: OrganizationSettings | null;
  className?: string;
}

// Convert INR amount to Words in Indian numbering format
export function getAmountInWords(amount: number): string {
  const units = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];
  const teens = [
    "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen",
    "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"
  ];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

  function convertTwoDigit(n: number): string {
    if (n === 0) return "";
    if (n < 10) return units[n];
    if (n < 20) return teens[n - 10];
    const rem = n % 10;
    return tens[Math.floor(n / 10)] + (rem > 0 ? " " + units[rem] : "");
  }

  let num = Math.round(amount);
  if (num === 0) return "Rupees Zero Only";

  const crore = Math.floor(num / 10000000);
  num %= 10000000;
  const lakh = Math.floor(num / 100000);
  num %= 100000;
  const thousand = Math.floor(num / 1000);
  num %= 1000;
  const hundred = Math.floor(num / 100);
  const rem = num % 100;

  const parts: string[] = [];
  if (crore > 0) parts.push(convertTwoDigit(crore) + " Crore");
  if (lakh > 0) parts.push(convertTwoDigit(lakh) + " Lakh");
  if (thousand > 0) parts.push(convertTwoDigit(thousand) + " Thousand");
  if (hundred > 0) parts.push(units[hundred] + " Hundred");
  if (rem > 0) parts.push(convertTwoDigit(rem));

  return "Rupees " + parts.join(" ") + " Only";
}

export default function QuotationViewer({
  invoice,
  orgSettings: propOrgSettings,
  className = ""
}: QuotationViewerProps) {
  const [org, setOrg] = useState<OrganizationSettings | null>(propOrgSettings || null);

  useEffect(() => {
    if (propOrgSettings) {
      setOrg(propOrgSettings);
      return;
    }

    const loadOrg = async () => {
      try {
        const data = await api.getOrganizationSettings();
        setOrg(data);
      } catch (e) {
        console.error("Failed to load organization branding:", e);
      }
    };

    loadOrg();

    if (typeof window !== "undefined") {
      const handleUpdate = () => loadOrg();
      window.addEventListener("zigmaa_org_settings_updated", handleUpdate);
      window.addEventListener("zigmaa_user_updated", handleUpdate);
      return () => {
        window.removeEventListener("zigmaa_org_settings_updated", handleUpdate);
        window.removeEventListener("zigmaa_user_updated", handleUpdate);
      };
    }
  }, [propOrgSettings]);

  // Seller info derived from invoice custom fields, dynamic settings, or defaults
  const sellerName = invoice.company_name || org?.company_name || "ZIGMAA TECH";
  const sellerLogo = invoice.company_logo || org?.logo_url || null;
  const sellerPhone = invoice.company_phone || org?.phone || "";
  const sellerAddress = invoice.company_address || org?.address || "3/41A, Ebenezer Castle, Kamaraj Nagar 3rd Street, Thoothukudi";
  const sellerTagline = invoice.company_tagline || org?.tagline || "Empowering Digital Innovation";

  // Document details
  const clientName = invoice.client_name || invoice.patient_name || "Client";
  const clientPhone = invoice.client_phone || invoice.phone || "";
  const clientAddress = invoice.client_address || invoice.recipient_address || (invoice.client_company ? invoice.client_company : "");
  const subject = invoice.subject || (invoice.notes && !invoice.notes.includes("Payment terms") ? invoice.notes : "Website Design & Development");

  // Date formatting (e.g. October 26, 2026)
  const dateObj = invoice.issue_date
    ? new Date(invoice.issue_date)
    : invoice.created_at
    ? new Date(invoice.created_at)
    : new Date();
  const formattedDate = dateObj.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric"
  });

  const items = invoice.items || [];
  const discount = Number(invoice.discount || 0);
  const subtotal = items.reduce(
    (s, it) => s + (it.amount !== undefined ? Number(it.amount) : (Number(it.qty) || 1) * (Number(it.unit_price) || 0)),
    0
  );
  const grandTotal = invoice.total_amount !== undefined ? Number(invoice.total_amount) : Math.max(0, subtotal - discount);

  return (
    <div
      className={`quotation-a4-sheet max-w-2xl mx-auto p-10 sm:p-14 bg-white shadow-xl border border-slate-200 text-slate-900 print:shadow-none print:border-none print:p-0 print:m-0 print:max-w-none print:w-full font-sans ${className}`}
    >
      <style jsx global>{`
        @media print {
          @page {
            size: A4 portrait;
            margin: 15mm;
          }
          body {
            background: #ffffff !important;
            color: #000000 !important;
            print-color-adjust: exact;
            -webkit-print-color-adjust: exact;
          }
          .quotation-a4-sheet {
            box-shadow: none !important;
            border: none !important;
            padding: 0 !important;
            width: 100% !important;
            max-width: 100% !important;
          }
          nav, header, aside, .no-print, button {
            display: none !important;
          }
        }
      `}</style>

      {/* Top Header: Company Name & Tagline (Left) + Logo (Right) */}
      <div className="flex items-start justify-between gap-6 pb-2">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight leading-none uppercase">
            {sellerName}
          </h1>
          <p className="text-xs sm:text-sm font-semibold text-slate-700 mt-2">
            {sellerTagline}
          </p>
        </div>

        <div>
          {sellerLogo ? (
            <img
              src={sellerLogo}
              alt={sellerName}
              className="h-16 w-auto max-w-[170px] object-contain"
            />
          ) : (
            <div className="w-16 h-16 bg-[#E11D48] text-white flex flex-col items-center justify-center rounded-sm shadow-2xs p-1 select-none">
              <svg className="w-7 h-7 text-white fill-current" viewBox="0 0 24 24">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
              </svg>
              <span className="text-[9px] font-black tracking-tighter uppercase mt-0.5 leading-none">
                ZIGMAA
              </span>
              <span className="text-[7px] font-bold tracking-widest uppercase leading-none">
                TECH
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Centered Document Title */}
      <div className="text-center my-8">
        <h2 className="text-xl font-bold text-slate-900 tracking-normal">
          Quotation
        </h2>
      </div>

      {/* BILL TO (Left) & DATE (Right) */}
      <div className="grid grid-cols-2 gap-6 items-start text-xs text-slate-900">
        <div className="space-y-1">
          <p className="font-bold text-slate-900 tracking-wider text-xs uppercase">
            BILL TO
          </p>
          <p className="text-sm font-normal text-slate-900 pt-0.5">{clientName}</p>
          {clientPhone && <p className="text-xs text-slate-800">{clientPhone}</p>}
          {clientAddress && <p className="text-xs text-slate-800">{clientAddress}</p>}
        </div>

        <div className="space-y-1">
          <p className="font-bold text-slate-900 tracking-wider text-xs uppercase">
            DATE
          </p>
          <p className="text-xs text-slate-900 pt-0.5">{formattedDate}</p>
        </div>
      </div>

      {/* SUBJECT (Left) & ADDRESS (Right) */}
      <div className="grid grid-cols-2 gap-6 items-start text-xs text-slate-900 mt-6 pb-2">
        <div className="space-y-1">
          <p className="font-bold text-slate-900 tracking-wider text-xs uppercase">
            SUBJECT
          </p>
          <p className="text-xs text-slate-900 pt-0.5">{subject}</p>
        </div>

        <div className="space-y-1">
          <p className="font-bold text-slate-900 tracking-wider text-xs uppercase">
            ADDRESS
          </p>
          <p className="text-xs text-slate-900 pt-0.5 leading-relaxed">{sellerAddress}</p>
        </div>
      </div>

      {/* Line Items Table */}
      <div className="mt-8 border-t-2 border-slate-950 pt-2">
        <div className="flex justify-between items-center text-xs font-bold text-slate-950 pb-2 border-b border-slate-950">
          <span>Description</span>
          <span className="text-right">Amount</span>
        </div>

        <div className="divide-y divide-slate-200">
          {items.map((it, idx) => {
            const lineAmt =
              it.amount !== undefined
                ? Number(it.amount)
                : (Number(it.qty) || 1) * (Number(it.unit_price) || 0);
            return (
              <div
                key={idx}
                className="flex justify-between items-center py-3 text-xs text-slate-900"
              >
                <span className="font-normal">{it.description || "Service"}</span>
                <span className="font-medium font-mono text-right">
                  ₹ &nbsp; {lineAmt.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
            );
          })}
        </div>

        {/* Total Row */}
        <div className="border-t-2 border-slate-950 pt-4 flex justify-end">
          <div className="text-right">
            <div className="text-base font-bold text-slate-950">
              Total ₹ &nbsp; {grandTotal.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className="border-b-2 border-slate-950 mt-1"></div>
          </div>
        </div>
      </div>

      {/* Footer: Terms & Conditions, Question line & Thank you */}
      <div className="mt-10 text-xs text-slate-900 space-y-3.5 leading-relaxed">
        {/* User-defined Terms & Conditions */}
        {invoice.notes && (
          <div className="space-y-1">
            <p className="font-bold text-slate-950 uppercase tracking-wider text-[11px]">
              Terms & Conditions
            </p>
            <p className="font-normal text-slate-700 whitespace-pre-line text-xs">
              {invoice.notes}
            </p>
          </div>
        )}

        {sellerPhone && (
          <p className="font-normal text-slate-800 pt-1">
            If you have any questions regarding this quotation, please contact us at {sellerPhone}
          </p>
        )}

        <div className="pt-6 text-base font-medium text-slate-900">
          Thank you
        </div>
      </div>
    </div>
  );
}
