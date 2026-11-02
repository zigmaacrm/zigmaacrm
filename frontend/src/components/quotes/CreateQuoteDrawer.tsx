"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  X,
  FileText,
  Plus,
  Trash2,
  Building2,
  User,
  Mail,
  Phone,
  Calendar,
  Percent,
  Download,
  CheckCircle2,
  Loader2,
  FileCheck,
  Eye,
  Share2,
  Send,
  Sparkles,
  ShieldCheck,
  MapPin,
  Upload,
  Image as ImageIcon
} from "lucide-react";
import { Deal, Contact, Invoice, OrganizationSettings } from "@/lib/mockData";
import { api } from "@/lib/api";
import { formatCurrency } from "@/lib/utils";
import { useToast } from "@/components/common/ToastProvider";
import CustomDatePicker from "@/components/common/CustomDatePicker";
import CustomDropdown from "@/components/common/CustomDropdown";
import QuotationPreviewModal from "./QuotationPreviewModal";

interface CreateQuoteDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (invoice: Invoice) => void;
  deal?: Deal | null;
  contact?: Contact | null;
  editingInvoice?: Invoice | null;
  initialType?: "QUOTE";
}

interface LineItemState {
  id: string;
  description: string;
  qty: number;
  unit_price: number;
  tax_rate: number;
}

const DEFAULT_LINE_ITEMS: LineItemState[] = [
  {
    id: "item-1",
    description: "Zigmaa CRM Enterprise Suite - Annual Subscription",
    qty: 1,
    unit_price: 36000,
    tax_rate: 18
  },
  {
    id: "item-2",
    description: "Cloud Onboarding, Pipeline Setup & Team Training",
    qty: 1,
    unit_price: 15000,
    tax_rate: 18
  }
];

export default function CreateQuoteDrawer({
  isOpen,
  onClose,
  onSuccess,
  deal,
  contact,
  editingInvoice,
  initialType = "QUOTE"
}: CreateQuoteDrawerProps) {
  const { toast } = useToast();
  const [visible, setVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Document Settings
  const docType = "QUOTE";
  const [quoteId, setQuoteId] = useState("QT-2026-001");
  const [issueDate, setIssueDate] = useState("");
  const [subject, setSubject] = useState("Website Design & Development");
  const [orgSettings, setOrgSettings] = useState<OrganizationSettings | null>(null);

  // Live preview modal state
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [previewInvoiceData, setPreviewInvoiceData] = useState<Invoice | null>(null);

  // Client Info
  const [clientName, setClientName] = useState("");
  const [clientCompany, setClientCompany] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [clientAddress, setClientAddress] = useState("");

  // Sender / Our Company Details
  const [companyName, setCompanyName] = useState("ZIGMAA TECH");
  const [companyTagline, setCompanyTagline] = useState("Empowering Digital Innovation");
  const [companyPhone, setCompanyPhone] = useState("+91 88702 35207");
  const [companyAddress, setCompanyAddress] = useState(
    "3/41A, Ebenezer Castle, Kamaraj Nagar 3rd Street, Thoothukudi"
  );
  const [companyLogo, setCompanyLogo] = useState("/zigmaa-logo.png");
  const logoInputRef = useRef<HTMLInputElement>(null);

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast.warning("File Too Large", "Please select an image file under 2MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const base64 = ev.target?.result as string;
      setCompanyLogo(base64);
      toast.success("Logo Updated", "Company logo updated for this quotation.");
    };
    reader.readAsDataURL(file);
  };

  // Line items
  const [items, setItems] = useState<LineItemState[]>(DEFAULT_LINE_ITEMS);
  const [discount, setDiscount] = useState<number>(0);
  const [notes, setNotes] = useState(
    "1. Payment terms: 50% advance, balance upon project milestone delivery.\n2. Validity: 15 days from issue date.\n3. Bank Transfer / UPI accepted."
  );

  // Smooth slide-over close
  const handleClose = useCallback(() => {
    setVisible(false);
    setTimeout(() => {
      onClose();
    }, 280);
  }, [onClose]);

  // Handle ESC
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        handleClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, handleClose]);

  // Pre-fill on open
  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => setVisible(true), 10);

      const today = new Date().toISOString().split("T")[0];
      setIssueDate(today);

      const generatedNum = `QT-2026-${String(Math.floor(Math.random() * 899) + 101)}`;
      setQuoteId(generatedNum);

      // Load dynamic organization settings
      api.getOrganizationSettings().then((settings) => {
        if (settings) {
          setOrgSettings(settings);
          if (settings.default_terms && !notes) {
            setNotes(settings.default_terms);
          }
        }
      });

      // Load saved sender details from localStorage
      try {
        const savedSender = localStorage.getItem("zigmaa_quote_sender_info");
        if (savedSender) {
          const parsed = JSON.parse(savedSender);
          if (parsed.companyName) setCompanyName(parsed.companyName);
          if (parsed.companyTagline) setCompanyTagline(parsed.companyTagline);
          if (parsed.companyPhone) setCompanyPhone(parsed.companyPhone);
          if (parsed.companyAddress) setCompanyAddress(parsed.companyAddress);
          if (parsed.companyLogo) setCompanyLogo(parsed.companyLogo);
        }
      } catch {}

      if (editingInvoice) {
        setQuoteId(editingInvoice.invoice_number || generatedNum);
        setClientName(editingInvoice.client_name || editingInvoice.patient_name || "");
        setClientCompany(editingInvoice.client_company || "");
        setClientEmail(editingInvoice.client_email || editingInvoice.email || "");
        setClientPhone(editingInvoice.client_phone || editingInvoice.phone || "");
        setClientAddress(editingInvoice.client_address || editingInvoice.recipient_address || "");
        setSubject(editingInvoice.subject || "Website Design & Development");
        if (editingInvoice.company_name) setCompanyName(editingInvoice.company_name);
        if (editingInvoice.company_tagline) setCompanyTagline(editingInvoice.company_tagline);
        if (editingInvoice.company_phone) setCompanyPhone(editingInvoice.company_phone);
        if (editingInvoice.company_address) setCompanyAddress(editingInvoice.company_address);
        if (editingInvoice.company_logo) setCompanyLogo(editingInvoice.company_logo);
        if (editingInvoice.issue_date) setIssueDate(editingInvoice.issue_date);
        if (editingInvoice.items && editingInvoice.items.length > 0) {
          setItems(
            editingInvoice.items.map((it, idx) => ({
              id: `item-${idx}-${Date.now()}`,
              description: it.description || "",
              qty: it.qty || 1,
              unit_price: it.unit_price || 0,
              tax_rate: it.tax_rate ?? 0
            }))
          );
        }
        if (editingInvoice.notes) setNotes(editingInvoice.notes);
        if (editingInvoice.discount) setDiscount(editingInvoice.discount);
      } else if (deal) {
        setClientName(deal.contact_name || deal.title || "Valued Client");
        setClientCompany(deal.company_name || "");
        setClientEmail(deal.contact_email || "");
        setClientPhone(deal.contact_phone || "");
        setClientAddress("");
        setSubject(deal.title || "Website Design & Development");

        // If deal has an existing value, preset first line item
        if (deal.deal_value || deal.value) {
          const val = Number(deal.deal_value || deal.value || 0);
          if (val > 0) {
            setItems([
              {
                id: "deal-item-1",
                description: `${deal.title} - Scope Deliverables`,
                qty: 1,
                unit_price: val,
                tax_rate: 0
              }
            ]);
          }
        }
      } else if (contact) {
        setClientName(contact.name || contact.full_name || "Valued Client");
        setClientCompany(contact.company_name || "");
        setClientEmail(contact.email || "");
        setClientPhone(contact.phone || "");
        setClientAddress("");
        setSubject("Website Design & Development");
      } else {
        setClientName("");
        setClientCompany("");
        setClientEmail("");
        setClientPhone("");
        setClientAddress("");
        setSubject("Website Design & Development");
        setItems([
          {
            id: "item-1",
            description: "5-Page Static Website (Hosting 1Year Free)",
            qty: 1,
            unit_price: 4999,
            tax_rate: 0
          },
          {
            id: "item-2",
            description: "Additional Per Page",
            qty: 1,
            unit_price: 699,
            tax_rate: 0
          },
          {
            id: "item-3",
            description: "Domain 1Year Plan",
            qty: 1,
            unit_price: 1081,
            tax_rate: 0
          }
        ]);
      }

      setDiscount(0);
      setSubmitting(false);

      return () => clearTimeout(timer);
    } else {
      setVisible(false);
    }
  }, [isOpen, deal, contact, editingInvoice, initialType]);

  // Auto-calculation logic
  const subtotal = useMemo(() => {
    return items.reduce((sum, it) => sum + (Number(it.qty) || 0) * (Number(it.unit_price) || 0), 0);
  }, [items]);

  const taxAmount = useMemo(() => {
    return items.reduce((sum, it) => {
      const lineAmt = (Number(it.qty) || 0) * (Number(it.unit_price) || 0);
      const taxRate = Number(it.tax_rate) || 0;
      return sum + lineAmt * (taxRate / 100);
    }, 0);
  }, [items]);

  const grandTotal = useMemo(() => {
    const raw = subtotal + taxAmount - (Number(discount) || 0);
    return Math.max(0, Math.round(raw * 100) / 100);
  }, [subtotal, taxAmount, discount]);

  // Line item manipulation
  const handleAddItem = () => {
    const newItem: LineItemState = {
      id: `item-${Date.now()}`,
      description: "",
      qty: 1,
      unit_price: 0,
      tax_rate: 18
    };
    setItems((prev) => [...prev, newItem]);
  };

  const handleUpdateItem = (id: string, field: keyof LineItemState, val: any) => {
    setItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, [field]: val } : it))
    );
  };

  const handleRemoveItem = (id: string) => {
    if (items.length <= 1) {
      toast.warning("Validation", "At least one line item is required.");
      return;
    }
    setItems((prev) => prev.filter((it) => it.id !== id));
  };

  // Open Live Preview of Current Draft
  const handlePreviewCurrentDraft = () => {
    if (!companyName.trim()) {
      toast.warning("Validation", "Company Name is required.");
      return;
    }
    if (!companyPhone.trim()) {
      toast.warning("Validation", "Company Mobile / Contact Number is required.");
      return;
    }
    if (!companyAddress.trim()) {
      toast.warning("Validation", "Company Address is required.");
      return;
    }
    if (!clientName.trim()) {
      toast.warning("Validation", "Please enter a Client Name to preview.");
      return;
    }
    const draftInvoice: Invoice = {
      id: editingInvoice?.id || "preview-temp",
      invoice_number: quoteId,
      deal_id: deal?.id ? String(deal.id) : undefined,
      contact_id: contact?.id ? String(contact.id) : undefined,
      client_name: clientName.trim(),
      client_company: clientCompany.trim() || undefined,
      client_email: clientEmail.trim() || undefined,
      client_phone: clientPhone.trim() ? (clientPhone.trim().startsWith("+") ? clientPhone.trim() : `+91 ${clientPhone.trim()}`) : undefined,
      client_address: clientAddress.trim() || undefined,
      subject: subject.trim() || "Website Design & Development",
      company_name: companyName.trim(),
      company_tagline: companyTagline.trim() || undefined,
      company_phone: companyPhone.trim(),
      company_address: companyAddress.trim(),
      company_logo: companyLogo || undefined,
      type: docType,
      status: editingInvoice?.status || "DRAFT",
      issue_date: issueDate || new Date().toISOString().split("T")[0],
      items: items.map((it) => ({
        description: it.description.trim() || "Scope Deliverables",
        qty: Number(it.qty) || 1,
        unit_price: Number(it.unit_price) || 0,
        tax_rate: Number(it.tax_rate) || 0,
        amount: (Number(it.qty) || 1) * (Number(it.unit_price) || 0)
      })),
      subtotal: Math.round(subtotal * 100) / 100,
      tax_amount: Math.round(taxAmount * 100) / 100,
      discount: Math.round((Number(discount) || 0) * 100) / 100,
      total_amount: grandTotal,
      notes: notes.trim(),
      created_at: new Date().toISOString()
    };
    setPreviewInvoiceData(draftInvoice);
    setPreviewModalOpen(true);
  };

  // Submit Handler
  const handleSave = async (
    status: "DRAFT" | "SENT",
    dispatchAction: "NONE" | "DOWNLOAD_PDF" | "WHATSAPP" | "EMAIL" = "NONE"
  ) => {
    if (!companyName.trim()) {
      toast.warning("Validation", "Company Name is required.");
      return;
    }
    if (!companyPhone.trim()) {
      toast.warning("Validation", "Company Mobile / Contact Number is required.");
      return;
    }
    if (!companyAddress.trim()) {
      toast.warning("Validation", "Company Address is required.");
      return;
    }
    if (!clientName.trim()) {
      toast.warning("Validation", "Client Name is required.");
      return;
    }
    if (items.some((it) => !it.description.trim())) {
      toast.warning("Validation", "Please provide a description for all line items.");
      return;
    }

    try {
      localStorage.setItem(
        "zigmaa_quote_sender_info",
        JSON.stringify({
          companyName: companyName.trim(),
          companyTagline: companyTagline.trim(),
          companyPhone: companyPhone.trim(),
          companyAddress: companyAddress.trim(),
          companyLogo
        })
      );
    } catch {}

    setSubmitting(true);
    try {
      const payload: Partial<Invoice> = {
        invoice_number: quoteId || undefined,
        deal_id: deal?.id ? String(deal.id) : undefined,
        contact_id: contact?.id ? String(contact.id) : (deal?.contact_id ? String(deal.contact_id) : undefined),
        client_name: clientName.trim(),
        client_company: clientCompany.trim() || undefined,
        client_email: clientEmail.trim() || undefined,
        client_phone: clientPhone.trim() ? (clientPhone.trim().startsWith("+") ? clientPhone.trim() : `+91 ${clientPhone.trim()}`) : undefined,
        client_address: clientAddress.trim() || undefined,
        subject: subject.trim() || "Website Design & Development",
        company_name: companyName.trim(),
        company_tagline: companyTagline.trim() || undefined,
        company_phone: companyPhone.trim(),
        company_address: companyAddress.trim(),
        company_logo: companyLogo || undefined,
        type: docType,
        status: editingInvoice?.status || status,
        issue_date: issueDate || undefined,
        items: items.map((it) => ({
          description: it.description.trim(),
          qty: Number(it.qty) || 1,
          unit_price: Number(it.unit_price) || 0,
          tax_rate: Number(it.tax_rate) || 0,
          amount: (Number(it.qty) || 1) * (Number(it.unit_price) || 0)
        })),
        subtotal: Math.round(subtotal * 100) / 100,
        tax_amount: Math.round(taxAmount * 100) / 100,
        discount: Math.round((Number(discount) || 0) * 100) / 100,
        total_amount: grandTotal,
        notes: notes.trim()
      };

      let saved: Invoice;
      if (editingInvoice?.id) {
        const updated = await api.updateInvoice(editingInvoice.id, payload);
        saved = (updated || { ...editingInvoice, ...payload }) as Invoice;
        toast.success(
          "Quotation Updated",
          `Quotation updated successfully for ₹${grandTotal.toLocaleString("en-IN")}`
        );
      } else {
        saved = await api.createInvoice(payload);
        toast.success(
          "Quotation Created",
          `Quotation generated successfully for ₹${grandTotal.toLocaleString("en-IN")}`
        );
      }

      if (onSuccess) {
        onSuccess(saved);
      }

      if (dispatchAction === "DOWNLOAD_PDF") {
        const printUrl = `http://localhost:8000/api/v1/invoices/${saved.id}/pdf`;
        window.open(printUrl, "_blank", "noopener,noreferrer");
      } else if (dispatchAction === "WHATSAPP") {
        const rawPhone = (clientPhone || "").replace(/\D/g, "");
        const targetPhone = rawPhone.length === 10 ? `91${rawPhone}` : rawPhone;
        const sellerName = orgSettings?.company_name || "Arsath Thoufiq's Workspace";
        const msg = `Hello ${clientName},\n\nHere is your official Quotation ${saved.invoice_number || quoteId} for ₹${grandTotal.toLocaleString("en-IN")} from ${sellerName}.\n\nPlease review and let us know your approval.\n\nBest regards,\n${orgSettings?.signatory_name || "Arsath Thoufiq"}\n${sellerName}`;
        window.open(`https://wa.me/${targetPhone}?text=${encodeURIComponent(msg)}`, "_blank", "noopener,noreferrer");
      } else if (dispatchAction === "EMAIL") {
        const targetEmail = clientEmail || "";
        const sellerName = orgSettings?.company_name || "Arsath Thoufiq's Workspace";
        const subject = `Quotation ${saved.invoice_number || quoteId} for ${clientName} - ${sellerName}`;
        const body = `Dear ${clientName},\n\nPlease find your commercial quotation ${saved.invoice_number || quoteId} amounting to ₹${grandTotal.toLocaleString("en-IN")}.\n\nPayment terms: ${notes}\n\nBest regards,\n${orgSettings?.signatory_name || "Arsath Thoufiq"}\n${sellerName}`;
        window.location.href = `mailto:${targetEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      }

      handleClose();
    } catch (err) {
      console.error("Failed to generate quote/invoice:", err);
      toast.error("Error", "Could not generate document. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Create Quotation"
      className="fixed inset-0 z-50 overflow-hidden"
    >
      {/* 1. Backdrop */}
      <div
        onClick={handleClose}
        className={`fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-50 transition-opacity duration-300 ${
          visible ? "opacity-100" : "opacity-0"
        }`}
      />

      {/* 2. Slide-over Drawer */}
      <div
        className={`fixed inset-y-0 right-0 z-50 w-full max-w-2xl bg-white shadow-2xl flex flex-col h-full border-l border-slate-200 transition-transform duration-300 ease-out transform ${
          visible ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Sticky Top Header */}
        <div className="px-6 py-4 border-b border-slate-200/80 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/80 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-100 dark:bg-red-950/60 text-red-600 dark:text-red-400 flex items-center justify-center shadow-xs">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-900 dark:text-white leading-tight">
                  {editingInvoice ? "Edit Quotation" : "Create Official Quote"}
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800/60">
                  Estimation Engine
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-medium mt-0.5">
                {deal ? `Linked to Deal: ${deal.title}` : "Auto-calculates line items, and generates printable quotation PDF"}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            title="Close Drawer (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Form Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6 custom-scrollbar text-xs">
          {/* SECTION: OUR COMPANY & SENDER INFO (MANDATORY) */}
          <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4 shadow-2xs">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
              <div>
                <span className="text-[10px] font-bold text-red-600 uppercase tracking-wider block">
                  Sender Details (Our Information)
                </span>
                <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                  Company Name, Contact & PDF Logo
                </span>
              </div>
              <span className="text-[10px] font-bold text-slate-500 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-md">
                Appears on Quotation & PDF
              </span>
            </div>

            {/* Logo Upload Box */}
            <div className="flex items-center gap-4 p-3 bg-slate-50 dark:bg-slate-950/50 rounded-xl border border-dashed border-slate-200 dark:border-slate-800">
              <div className="w-16 h-16 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 flex items-center justify-center overflow-hidden shrink-0 shadow-2xs">
                {companyLogo ? (
                  <img
                    src={companyLogo}
                    alt="Logo"
                    className="w-full h-full object-contain p-1"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = "/zigmaa-logo.png";
                    }}
                  />
                ) : (
                  <Building2 className="w-6 h-6 text-slate-400" />
                )}
              </div>

              <div className="flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <input
                    ref={logoInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleLogoUpload}
                  />
                  <button
                    type="button"
                    onClick={() => logoInputRef.current?.click()}
                    className="px-3 py-1.5 bg-red-600 hover:bg-red-700 active:bg-red-800 text-white font-bold text-xs rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>{companyLogo ? "Change Logo" : "Upload Logo"}</span>
                  </button>

                  {companyLogo && companyLogo !== "/zigmaa-logo.png" && (
                    <button
                      type="button"
                      onClick={() => setCompanyLogo("/zigmaa-logo.png")}
                      className="px-2.5 py-1.5 text-slate-500 hover:text-rose-600 text-xs font-semibold rounded-lg hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                    >
                      Reset Default
                    </button>
                  )}
                </div>
                <p className="text-[10px] text-slate-500 dark:text-slate-400">
                  PNG, JPG or SVG (Max 2MB). Displays on the top-right of your quotation.
                </p>
              </div>
            </div>

            {/* Inputs: Company Name, Mobile Number, Address, Tagline */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Company Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="e.g. ZIGMAA TECH"
                  className="w-full bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 text-xs px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 focus:outline-none focus:ring-2 focus:ring-red-500 font-bold"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Company Mobile / Phone <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={companyPhone}
                  onChange={(e) => setCompanyPhone(e.target.value)}
                  placeholder="e.g. +91 88702 35207"
                  className="w-full bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 text-xs px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 focus:outline-none focus:ring-2 focus:ring-red-500 font-semibold font-mono"
                />
                <span className="text-[10px] text-slate-400 mt-0.5 block">
                  Displayed in the contact question line below the total
                </span>
              </div>

              <div className="sm:col-span-2">
                <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Company Address <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={companyAddress}
                  onChange={(e) => setCompanyAddress(e.target.value)}
                  placeholder="e.g. 3/41A, Ebenezer Castle, Kamaraj Nagar 3rd Street, Thoothukudi"
                  className="w-full bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 text-xs px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 focus:outline-none focus:ring-2 focus:ring-red-500 font-medium"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Tagline / Subtitle
                </label>
                <input
                  type="text"
                  value={companyTagline}
                  onChange={(e) => setCompanyTagline(e.target.value)}
                  placeholder="e.g. Empowering Digital Innovation"
                  className="w-full bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 text-xs px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 focus:outline-none focus:ring-2 focus:ring-red-500 font-medium"
                />
              </div>
            </div>
          </div>

          {/* SECTION 1: DATE & SUBJECT */}
          <div className="p-4 rounded-2xl bg-slate-50/80 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 space-y-3.5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                  1. Document Settings
                </span>
                <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                  Quotation Date & Subject
                </span>
              </div>

              <span className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 shadow-2xs">
                Document: <span className="text-red-600 font-extrabold">Quotation</span>
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 border-t border-slate-200/60 dark:border-slate-800">
              <div>
                <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Date <span className="text-red-500">*</span>
                </label>
                <CustomDatePicker
                  value={issueDate}
                  onChange={(d) => setIssueDate(d)}
                  size="sm"
                  placeholder="Select date"
                  className="w-full text-xs"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Subject
                </label>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="e.g. Website Design & Development"
                  className="w-full bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 text-xs px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 focus:outline-none focus:ring-2 focus:ring-red-500 font-medium"
                />
              </div>
            </div>
          </div>

          {/* SECTION 2: CLIENT INFORMATION */}
          <div className="space-y-3">
            <div className="flex items-center justify-between pb-1 border-b border-slate-100 dark:border-slate-800">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                2. Billed To (Client Info)
              </span>
              {(deal || contact) && (
                <span className="text-[10px] font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                  Auto-populated from {deal ? "Deal" : "Contact"}
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Client / Contact Name <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <input
                    type="text"
                    required
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                    placeholder="e.g. Praveen"
                    className="w-full bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 text-xs pl-8 pr-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 focus:outline-none focus:ring-2 focus:ring-red-500 font-medium"
                  />
                  <User className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-3" />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Phone Number
                </label>
                <div className="flex items-center gap-2">
                  <select
                    value="+91"
                    disabled
                    className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs px-2.5 py-2.5 text-slate-800 dark:text-slate-200 font-semibold focus:outline-none cursor-default"
                  >
                    <option value="+91">IN +91</option>
                  </select>
                  <div className="relative flex-1">
                    <input
                      type="tel"
                      value={clientPhone.replace(/^\+91\s*/, "")}
                      onChange={(e) => setClientPhone(e.target.value)}
                      placeholder="e.g. 8489002159"
                      className="w-full bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 text-xs pl-8 pr-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 focus:outline-none focus:ring-2 focus:ring-red-500 font-medium font-mono"
                    />
                    <Phone className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-3" />
                  </div>
                </div>
              </div>

              <div className="sm:col-span-2">
                <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Client Address / City <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={clientAddress}
                    onChange={(e) => setClientAddress(e.target.value)}
                    placeholder="e.g. Tirupur"
                    className="w-full bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 text-xs pl-8 pr-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 focus:outline-none focus:ring-2 focus:ring-red-500 font-medium"
                  />
                  <MapPin className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-3" />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Company / Organization (Optional)
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={clientCompany}
                    onChange={(e) => setClientCompany(e.target.value)}
                    placeholder="e.g. CloudScale Innovations Ltd"
                    className="w-full bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 text-xs pl-8 pr-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 focus:outline-none focus:ring-2 focus:ring-red-500 font-medium"
                  />
                  <Building2 className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-3" />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Email Address (Optional)
                </label>
                <div className="relative">
                  <input
                    type="email"
                    value={clientEmail}
                    onChange={(e) => setClientEmail(e.target.value)}
                    placeholder="e.g. praveen@example.com"
                    className="w-full bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 text-xs pl-8 pr-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 focus:outline-none focus:ring-2 focus:ring-red-500 font-medium"
                  />
                  <Mail className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-3" />
                </div>
              </div>
            </div>
          </div>

          {/* SECTION 3: LINE ITEMS TABLE */}
          <div className="space-y-3">
            <div className="flex items-center justify-between pb-1 border-b border-slate-100">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                3. Deliverables & Line Items
              </span>
              <button
                type="button"
                onClick={handleAddItem}
                className="inline-flex items-center gap-1 text-[11px] font-bold text-red-600 hover:text-red-700 hover:bg-red-50 px-2.5 py-1 rounded-lg transition-colors cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Line Item</span>
              </button>
            </div>

            {/* Line Items Container */}
            <div className="space-y-2.5">
              {items.map((it, idx) => {
                const lineAmt = (Number(it.qty) || 0) * (Number(it.unit_price) || 0);
                return (
                  <div
                    key={it.id}
                    className="p-3 bg-slate-50/70 hover:bg-slate-50 border border-slate-200 rounded-xl space-y-2.5 transition-all"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-bold text-slate-400 uppercase">
                        Item #{idx + 1}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-900">
                          {formatCurrency(lineAmt)}
                        </span>
                        {items.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleRemoveItem(it.id)}
                            className="text-slate-400 hover:text-rose-600 p-1 rounded transition-colors cursor-pointer"
                            title="Remove item"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Description */}
                    <div>
                      <input
                        type="text"
                        value={it.description}
                        onChange={(e) => handleUpdateItem(it.id, "description", e.target.value)}
                        placeholder="Description (e.g. CRM Setup, WhatsApp Integration, Consulting)"
                        className="w-full bg-white text-slate-900 text-xs px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-1 focus:ring-red-500 font-medium"
                      />
                    </div>

                    {/* Quantity, Unit Price, GST % */}
                    <div className="grid grid-cols-3 gap-2.5">
                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 mb-0.5">
                          Quantity
                        </label>
                        <input
                          type="number"
                          min="1"
                          value={it.qty}
                          onChange={(e) => handleUpdateItem(it.id, "qty", Math.max(1, parseInt(e.target.value) || 1))}
                          className="w-full bg-white text-slate-900 text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 text-center font-bold"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 mb-0.5">
                          Unit Price (₹)
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="100"
                          value={it.unit_price}
                          onChange={(e) => handleUpdateItem(it.id, "unit_price", Math.max(0, parseFloat(e.target.value) || 0))}
                          className="w-full bg-white text-slate-900 text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 font-bold text-right"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 mb-0.5">
                          GST Tax Rate
                        </label>
                        <CustomDropdown
                          value={String(it.tax_rate)}
                          onChange={(val) => handleUpdateItem(it.id, "tax_rate", parseFloat(val) || 0)}
                          size="sm"
                          variant="input"
                          className="w-full text-xs font-semibold"
                          options={[
                            { value: "0", label: "0% (Exempt)" },
                            { value: "5", label: "5% GST" },
                            { value: "12", label: "12% GST" },
                            { value: "18", label: "18% GST (Std)" },
                          ]}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Calculations Breakdown Box */}
            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200/80 space-y-2 mt-3">
              <div className="flex justify-between text-slate-600">
                <span>Subtotal (Net Amount):</span>
                <span className="font-semibold text-slate-800">{formatCurrency(subtotal)}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>GST / Tax Amount:</span>
                <span className="font-semibold text-slate-800">{formatCurrency(taxAmount)}</span>
              </div>
              <div className="flex items-center justify-between gap-3 text-slate-600 pt-1">
                <span>Discount (₹):</span>
                <div className="w-32">
                  <input
                    type="number"
                    min="0"
                    value={discount}
                    onChange={(e) => setDiscount(Math.max(0, parseFloat(e.target.value) || 0))}
                    placeholder="0"
                    className="w-full bg-white text-slate-900 text-xs px-2.5 py-1 rounded-lg border border-slate-200 text-right font-bold focus:outline-none focus:ring-1 focus:ring-red-500"
                  />
                </div>
              </div>
              <div className="pt-2 border-t border-slate-200 flex items-center justify-between">
                <div>
                  <span className="text-xs font-bold text-slate-900 block">Grand Total</span>
                  <span className="text-[10px] text-slate-400">Inclusive of all taxes & discounts</span>
                </div>
                <span className="text-xl font-black text-red-600">
                  {formatCurrency(grandTotal)}
                </span>
              </div>
            </div>
          </div>

          {/* SECTION 4: TERMS & CONDITIONS */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300">
                Terms & Conditions
              </label>
              <span className="text-[10px] text-slate-400">
                Appears below total bill & above &apos;Thank you&apos;
              </span>
            </div>
            <textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="1. Payment terms: 50% advance, balance upon project milestone delivery.&#10;2. Validity: 15 days from issue date.&#10;3. Bank Transfer / UPI accepted."
              className="w-full bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 text-xs p-3 rounded-xl border border-slate-200 dark:border-slate-800 focus:outline-none focus:ring-2 focus:ring-red-500 font-medium custom-scrollbar"
            />
          </div>
        </div>

        {/* 3. Sticky Bottom Action Bar */}
        <div className="px-6 py-4 border-t border-slate-200 bg-white flex items-center justify-between shrink-0 shadow-lg">
          <div className="text-xs">
            <span className="text-slate-400 block text-[10px] uppercase font-bold tracking-wider">
              Document Total
            </span>
            <span className="font-black text-slate-900 text-sm">
              {formatCurrency(grandTotal)}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleClose}
              disabled={submitting}
              className="px-3 py-2 text-xs font-semibold text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
            >
              Cancel
            </button>

            {/* Preview Quotation */}
            <button
              type="button"
              onClick={handlePreviewCurrentDraft}
              disabled={submitting}
              className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold rounded-xl transition-all flex items-center gap-1.5 cursor-pointer"
              title="Preview branded quotation in A4 sheet"
            >
              <Eye className="w-3.5 h-3.5 text-slate-600" />
              <span>Preview</span>
            </button>

            {/* Send via WhatsApp */}
            <button
              type="button"
              onClick={() => handleSave("SENT", "WHATSAPP")}
              disabled={submitting}
              className="px-3 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 text-xs font-bold rounded-xl transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              title="Save & dispatch quotation link via WhatsApp"
            >
              <Share2 className="w-3.5 h-3.5 text-emerald-600" />
              <span>WhatsApp</span>
            </button>

            {/* Send via Email */}
            <button
              type="button"
              onClick={() => handleSave("SENT", "EMAIL")}
              disabled={submitting}
              className="px-3 py-2 bg-blue-50 hover:bg-blue-100 text-blue-800 border border-blue-200 text-xs font-bold rounded-xl transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              title="Save & draft quotation email"
            >
              <Mail className="w-3.5 h-3.5 text-blue-600" />
              <span>Email</span>
            </button>

            {/* Save as Draft */}
            <button
              type="button"
              onClick={() => handleSave("DRAFT", "NONE")}
              disabled={submitting}
              className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold rounded-xl transition-all cursor-pointer disabled:opacity-50"
            >
              Draft
            </button>

            {/* Primary: Generate & Download PDF */}
            <button
              type="button"
              onClick={() => handleSave("SENT", "DOWNLOAD_PDF")}
              disabled={submitting}
              className="px-4 py-2.5 bg-red-600 hover:bg-red-700 active:bg-red-800 text-white text-xs font-bold rounded-xl shadow-md shadow-red-600/20 transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Processing...</span>
                </>
              ) : (
                <>
                  <Download className="w-3.5 h-3.5" />
                  <span>Generate & Download PDF</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Branded Quotation Live Preview Modal */}
      <QuotationPreviewModal
        invoice={previewInvoiceData}
        isOpen={previewModalOpen}
        onClose={() => setPreviewModalOpen(false)}
        orgSettings={orgSettings}
      />
    </div>
  );
}
