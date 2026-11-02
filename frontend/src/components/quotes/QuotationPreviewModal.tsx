"use client";

import { useEffect, useState } from "react";
import {
  X,
  Printer,
  Download,
  Share2,
  Mail,
  Send,
  Check,
  ExternalLink
} from "lucide-react";
import { Invoice, OrganizationSettings } from "@/lib/mockData";
import { api } from "@/lib/api";
import QuotationViewer from "./QuotationViewer";
import { useToast } from "@/components/common/ToastProvider";

interface QuotationPreviewModalProps {
  invoice: Invoice | null;
  isOpen: boolean;
  onClose: () => void;
  orgSettings?: OrganizationSettings | null;
}

export default function QuotationPreviewModal({
  invoice,
  isOpen,
  onClose,
  orgSettings: initialOrg
}: QuotationPreviewModalProps) {
  const { toast } = useToast();
  const [org, setOrg] = useState<OrganizationSettings | null>(initialOrg || null);
  const [copiedLink, setCopiedLink] = useState(false);

  useEffect(() => {
    if (initialOrg) {
      setOrg(initialOrg);
      return;
    }
    if (isOpen) {
      api.getOrganizationSettings().then((res) => {
        if (res) setOrg(res);
      });
    }
  }, [isOpen, initialOrg]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !invoice) return null;

  const docNumber = invoice.invoice_number || invoice.bill_number || `QT-2026-001`;
  const docTitle = "QUOTATION";
  const sellerName = org?.company_name || "Arsath Thoufiq's Workspace";
  const signatoryName = org?.signatory_name || "Arsath Thoufiq";
  const clientName = invoice.client_name || "Client";
  const totalAmount = invoice.total_amount || 0;
  const formattedTotal = `₹${totalAmount.toLocaleString("en-IN")}`;

  // 1-Click Print Trigger
  const handlePrint = () => {
    window.print();
  };

  // Download PDF via Backend Server
  const handleDownloadPdf = () => {
    const pdfUrl = `http://localhost:8000/api/v1/invoices/${invoice.id}/pdf`;
    window.open(pdfUrl, "_blank", "noopener,noreferrer");
  };

  // WhatsApp Share Dispatcher
  const handleShareWhatsApp = () => {
    const rawPhone = (invoice.client_phone || invoice.phone || "").replace(/\D/g, "");
    if (!rawPhone) {
      toast.warning("Phone Number Missing", "Client phone number is not available for WhatsApp sharing.");
    }
    const targetPhone = rawPhone.length === 10 ? `91${rawPhone}` : rawPhone;
    const msg = `Hello ${clientName},\n\nHere is your official ${docTitle} ${docNumber} for ${formattedTotal} from ${sellerName}.\n\nPlease review the deliverables and let us know your approval.\n\nBest regards,\n${signatoryName}\n${sellerName}`;
    const waUrl = `https://wa.me/${targetPhone}?text=${encodeURIComponent(msg)}`;
    window.open(waUrl, "_blank", "noopener,noreferrer");
  };

  // Synced Email Dispatcher
  const handleSendEmail = () => {
    const targetEmail = invoice.client_email || invoice.email || "";
    const subject = `Quotation ${docNumber} for ${clientName} - ${sellerName}`;
    const body = `Dear ${clientName},\n\nPlease find details for your commercial quotation ${docNumber} amounting to ${formattedTotal}.\n\nPayment terms: ${invoice.notes || "50% advance, balance upon milestone delivery"}\n\nBank Transfer & UPI details are included in the quotation.\n\nBest regards,\n${signatoryName}\n${sellerName}`;
    const mailto = `mailto:${targetEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = mailto;
    toast.success("Email Dispatcher Opened", `Drafted quotation email to ${targetEmail || "client"}`);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Quotation Preview"
      className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-2 sm:p-6 print:p-0 print:bg-white animate-in fade-in duration-200"
    >
      <div className="relative w-full max-w-4xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[94vh] print:max-h-none print:shadow-none print:border-none print:rounded-none">
        
        {/* Top Control Bar (Hidden on print) */}
        <div className="px-5 py-3.5 bg-slate-900 text-white flex flex-wrap items-center justify-between gap-3 shrink-0 print:hidden select-none">
          <div className="flex items-center gap-2.5">
            <span className="font-mono font-bold text-sm text-white">
              {docNumber}
            </span>
            <span className="px-2 py-0.5 rounded text-[10px] font-extrabold uppercase bg-red-600 text-white">
              {docTitle}
            </span>
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-white/10 text-slate-300">
              {invoice.status || "DRAFT"}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* Share to WhatsApp */}
            <button
              type="button"
              onClick={handleShareWhatsApp}
              className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1.5 transition-all shadow-xs cursor-pointer"
              title="Share quotation via WhatsApp"
            >
              <Share2 className="w-3.5 h-3.5" />
              <span>WhatsApp</span>
            </button>

            {/* Send via Synced Email */}
            <button
              type="button"
              onClick={handleSendEmail}
              className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold flex items-center gap-1.5 transition-all shadow-xs cursor-pointer"
              title="Open email composer with pre-filled quote"
            >
              <Mail className="w-3.5 h-3.5" />
              <span>Email</span>
            </button>

            {/* Download Server PDF */}
            <button
              type="button"
              onClick={handleDownloadPdf}
              className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
              title="Download high-resolution PDF"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download PDF</span>
            </button>

            {/* Print Trigger */}
            <button
              type="button"
              onClick={handlePrint}
              className="px-3.5 py-1.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold flex items-center gap-1.5 shadow-xs transition-all cursor-pointer"
              title="Print document directly"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print</span>
            </button>

            {/* Close */}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer ml-1"
              title="Close modal (Esc)"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Scrollable Printable A4 Document Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-8 bg-slate-100/70 custom-scrollbar print:overflow-visible print:p-0 print:bg-white">
          <QuotationViewer invoice={invoice} orgSettings={org} />
        </div>

      </div>
    </div>
  );
}
