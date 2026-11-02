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

  // Seller info derived from dynamic settings or defaults
  const sellerName = org?.company_name || "Arsath Thoufiq's Workspace";
  const sellerLogo = org?.logo_url || null;
  const sellerEmail = org?.email || "thoufiqarsath84@gmail.com";
  const sellerPhone = org?.phone || "+91 98765 43210";
  const sellerAddress = org?.address || "Chennai Tech Park, Guindy, Chennai, Tamil Nadu 600032";
  const sellerGstin = org?.gstin || "33AAECZ9920K1ZX";
  const signatoryName = org?.signatory_name || "Arsath Thoufiq";
  const signatoryDesig = org?.signatory_designation || "Authorized Signatory";
  const bankName = org?.bank_name || "HDFC Bank Ltd";
  const accountNumber = org?.account_number || "50200084729104";
  const ifscCode = org?.ifsc_code || "HDFC0001244";
  const upiId = org?.upi_id || "zigmaa@hdfcbank";

  // Document details
  const docNumber = invoice.invoice_number || invoice.bill_number || `QT-2026-001`;
  const docTitle = "COMMERCIAL QUOTATION";
  const items = invoice.items || [];
  const subtotal = invoice.subtotal !== undefined ? invoice.subtotal : items.reduce((s, it) => s + (it.qty * it.unit_price), 0);
  const taxAmount = invoice.tax_amount !== undefined ? invoice.tax_amount : items.reduce((s, it) => s + (it.qty * it.unit_price * ((it.tax_rate ?? 18) / 100)), 0);
  const discount = invoice.discount || 0;
  const grandTotal = invoice.total_amount !== undefined ? invoice.total_amount : Math.max(0, subtotal + taxAmount - discount);
  const amountWords = getAmountInWords(grandTotal);

  // Avatar initials fallback
  const companyInitials = sellerName
    ? sellerName
        .split(" ")
        .map((w) => w[0])
        .filter(Boolean)
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : "AT";

  return (
    <div
      className={`quotation-a4-sheet max-w-3xl mx-auto p-8 sm:p-10 bg-white shadow-xl border border-slate-200 text-slate-800 print:shadow-none print:border-none print:p-0 print:m-0 print:max-w-none print:w-full ${className}`}
    >
      <style jsx global>{`
        @media print {
          @page {
            size: A4 portrait;
            margin: 12mm;
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

      {/* 1. Header: Seller Branding (Left) + Document Metadata (Right) */}
      <div className="flex flex-col sm:flex-row items-start justify-between gap-6 pb-6 border-b border-slate-200">
        <div className="space-y-1.5 max-w-md">
          {/* Logo or Brand Avatar */}
          <div className="flex items-center gap-3">
            {sellerLogo ? (
              <img
                src={sellerLogo}
                alt={sellerName}
                className="h-12 w-auto max-w-[190px] object-contain rounded-lg"
              />
            ) : (
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-red-600 to-rose-700 text-white font-black text-base flex items-center justify-center shadow-xs select-none">
                {companyInitials}
              </div>
            )}
            <div>
              <span className="text-lg font-black text-slate-900 tracking-tight leading-tight block">
                {sellerName}
              </span>
              <span className="inline-block px-2 py-0.5 rounded text-[10px] font-extrabold uppercase tracking-wider bg-slate-900 text-white">
                {docTitle}
              </span>
            </div>
          </div>

          <p className="text-xs text-slate-600 font-medium pt-1 leading-relaxed">
            {sellerAddress}
          </p>
          <p className="text-[11px] text-slate-500 font-mono">
            GSTIN: <span className="font-semibold text-slate-700">{sellerGstin}</span> • {sellerEmail} • {sellerPhone}
          </p>
        </div>

        {/* Right Column: Quote Number, Dates & Status */}
        <div className="text-left sm:text-right space-y-1 sm:self-start">
          <div className="font-mono text-xl font-black text-slate-900 tracking-tight">
            {docNumber}
          </div>
          <p className="text-xs text-slate-600">
            <span className="font-semibold text-slate-400">Issue Date: </span>
            <span className="font-medium text-slate-800">
              {invoice.issue_date || (invoice.created_at ? formatDate(invoice.created_at) : new Date().toISOString().split("T")[0])}
            </span>
          </p>
          {invoice.due_date && (
            <p className="text-xs text-slate-600">
              <span className="font-semibold text-slate-400">Valid Until: </span>
              <span className="font-medium text-slate-800">{invoice.due_date}</span>
            </p>
          )}
          <div className="pt-1.5">
            <span
              className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wide border ${
                invoice.status === "PAID"
                  ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                  : invoice.status === "SENT"
                  ? "bg-blue-50 text-blue-800 border-blue-200"
                  : "bg-slate-100 text-slate-700 border-slate-200"
              }`}
            >
              Status: {invoice.status || "DRAFT"}
            </span>
          </div>
        </div>
      </div>

      {/* 2. Bill To (Client) & Issued By (Seller) Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-6">
        <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/90 space-y-1">
          <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest block">
            PROPOSAL PREPARED FOR
          </span>
          <p className="text-sm font-bold text-slate-900">
            {invoice.client_name || invoice.patient_name || "Valued Client"}
          </p>
          {invoice.client_company && (
            <p className="text-xs font-semibold text-slate-700">
              {invoice.client_company}
            </p>
          )}
          {invoice.client_email && (
            <p className="text-xs text-slate-500 font-medium">
              {invoice.client_email}
            </p>
          )}
          {(invoice.client_phone || invoice.phone) && (
            <p className="text-xs text-slate-500 font-mono">
              {invoice.client_phone || invoice.phone}
            </p>
          )}
        </div>

        <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/90 space-y-1">
          <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest block">
            ISSUED & MANAGED BY
          </span>
          <p className="text-sm font-bold text-slate-900 truncate">
            {sellerName}
          </p>
          <p className="text-xs text-slate-600 line-clamp-1">
            {sellerAddress}
          </p>
          <p className="text-xs text-slate-500">
            Helpline: {sellerPhone}
          </p>
          <p className="text-xs text-slate-500">
            Support: {sellerEmail}
          </p>
        </div>
      </div>

      {/* 3. Dynamic Line Items Table */}
      <div className="border border-slate-200 rounded-xl overflow-hidden mb-6">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="bg-slate-100/90 text-slate-700 font-extrabold uppercase text-[10px] tracking-wider border-b border-slate-200">
              <th className="py-3 px-3 text-center w-10">#</th>
              <th className="py-3 px-4">ITEM & DESCRIPTION</th>
              <th className="py-3 px-3 text-center w-16">QTY</th>
              <th className="py-3 px-4 text-right w-28">RATE (₹)</th>
              <th className="py-3 px-3 text-center w-16">TAX</th>
              <th className="py-3 px-4 text-right w-32">AMOUNT (₹)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.length > 0 ? (
              items.map((it, idx) => {
                const lineAmt = it.amount !== undefined ? it.amount : (it.qty * it.unit_price);
                return (
                  <tr key={idx} className="hover:bg-slate-50/60 transition-colors">
                    <td className="py-3.5 px-3 text-center text-slate-400 font-medium">
                      {idx + 1}
                    </td>
                    <td className="py-3.5 px-4 font-semibold text-slate-900">
                      {it.description || it.name || "Scope Item"}
                    </td>
                    <td className="py-3.5 px-3 text-center text-slate-700 font-medium">
                      {it.qty}
                    </td>
                    <td className="py-3.5 px-4 text-right font-medium text-slate-700 font-mono">
                      {formatCurrency(it.unit_price)}
                    </td>
                    <td className="py-3.5 px-3 text-center text-slate-500 font-medium">
                      {it.tax_rate !== undefined ? `${it.tax_rate}%` : "18%"}
                    </td>
                    <td className="py-3.5 px-4 text-right font-bold text-slate-900 font-mono">
                      {formatCurrency(lineAmt)}
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={6} className="py-6 text-center text-slate-400">
                  No line items found in this document.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 4. Financial Summary Card & Amount in Words */}
      <div className="grid grid-cols-1 sm:grid-cols-12 gap-6 items-start pb-6">
        <div className="sm:col-span-7 space-y-3">
          {/* Amount In Words Banner */}
          <div className="p-3.5 rounded-xl bg-purple-50/80 border border-purple-200 text-xs">
            <span className="text-[10px] font-extrabold text-purple-700 uppercase tracking-widest block mb-0.5">
              AMOUNT IN WORDS
            </span>
            <span className="font-bold text-purple-950 block leading-snug">
              {amountWords}
            </span>
          </div>

          {/* Bank Settlement & UPI Details */}
          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-[11px] text-slate-600 space-y-1">
            <span className="font-bold text-slate-800 block text-xs">
              Direct Payment Instructions:
            </span>
            <p className="font-mono text-[11px]">
              Bank: <strong className="text-slate-800">{bankName}</strong> | A/C: <strong className="text-slate-800">{accountNumber}</strong>
            </p>
            <p className="font-mono text-[11px]">
              IFSC: <strong className="text-slate-800">{ifscCode}</strong> | UPI ID: <strong className="text-red-600">{upiId}</strong>
            </p>
          </div>
        </div>

        {/* Totals Breakdown */}
        <div className="sm:col-span-5 space-y-2 text-xs">
          <div className="flex justify-between text-slate-600">
            <span>Subtotal:</span>
            <span className="font-semibold text-slate-900 font-mono">{formatCurrency(subtotal)}</span>
          </div>
          <div className="flex justify-between text-slate-600">
            <span>GST / Tax:</span>
            <span className="font-semibold text-slate-900 font-mono">{formatCurrency(taxAmount)}</span>
          </div>
          {discount > 0 && (
            <div className="flex justify-between text-emerald-700 font-semibold">
              <span>Commercial Discount:</span>
              <span className="font-mono">- {formatCurrency(discount)}</span>
            </div>
          )}
          <div className="pt-2.5 border-t-2 border-slate-900 flex justify-between items-baseline">
            <span className="text-sm font-black text-slate-900 uppercase">Grand Total:</span>
            <span className="text-2xl font-black text-red-600 font-mono">
              {formatCurrency(grandTotal)}
            </span>
          </div>
        </div>
      </div>

      {/* 5. Terms & Authorized Signatory Footer */}
      <div className="pt-4 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-12 gap-6 items-end">
        {/* Left: Terms and Conditions */}
        <div className="sm:col-span-7">
          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 space-y-1">
            <span className="font-extrabold text-slate-800 block text-[10px] uppercase tracking-wider">
              Terms & Conditions
            </span>
            <p className="text-[11px] leading-relaxed">
              {invoice.notes ||
                "Payment terms: 50% advance, balance upon project milestone delivery. Bank Transfer / UPI accepted."}
            </p>
          </div>
        </div>

        {/* Right: Authorized Signatory Block with Clean Signature Line */}
        <div className="sm:col-span-5 flex flex-col items-center sm:items-end text-center sm:text-right">
          <div className="w-56 text-center">
            {/* Signature Underline */}
            <div className="h-12 border-b-2 border-slate-400 mb-2 flex items-end justify-center">
              <span className="text-[10px] italic text-slate-400 select-none pb-0.5">
                Digitally verified signatory
              </span>
            </div>
            <div className="font-bold text-slate-900 text-xs">
              {signatoryName}
            </div>
            <div className="text-[11px] font-semibold text-slate-600">
              {signatoryDesig}
            </div>
            <div className="text-[10px] text-slate-400 truncate mt-0.5">
              {sellerName}
            </div>
          </div>
        </div>
      </div>

      {/* 6. Footer Disclaimer */}
      <div className="pt-6 text-center text-[10px] text-slate-400">
        This quotation is an official electronic commercial offer issued by {sellerName}.
      </div>
    </div>
  );
}
