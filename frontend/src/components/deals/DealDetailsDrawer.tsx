"use client";

import { useState, useEffect, useCallback } from "react";
import {
  X,
  Building2,
  Calendar,
  DollarSign,
  User,
  Clock,
  ExternalLink,
  Percent,
  CheckCircle2,
  AlertCircle,
  Tag,
  Briefcase,
  FileText,
  Plus,
  Download,
  Printer,
  Share2,
  Mail,
  Phone,
  MessageSquare,
  Send
} from "lucide-react";
import WhatsAppIcon from "@/components/common/WhatsAppIcon";
import { Deal, Invoice } from "@/lib/mockData";
import { formatCurrency, formatDate } from "@/lib/utils";
import { useToast } from "@/components/common/ToastProvider";
import { api } from "@/lib/api";
import CreateQuoteDrawer from "@/components/quotes/CreateQuoteDrawer";
import QuotationPreviewModal from "@/components/quotes/QuotationPreviewModal";

interface DealDetailsDrawerProps {
  deal: Deal | null;
  isOpen: boolean;
  onClose: () => void;
  onStageChange?: (dealId: number | string, newStage: string) => Promise<void>;
  onDelete?: (dealId: number | string) => Promise<void>;
  stages?: string[];
}

const STAGES = [
  "New Deal",
  "Discovery",
  "Proposal Sent",
  "Negotiation",
  "Won",
  "Lost"
];

export default function DealDetailsDrawer({
  deal,
  isOpen,
  onClose,
  onStageChange,
  onDelete,
  stages = []
}: DealDetailsDrawerProps) {
  const { toast } = useToast();
  const activeStages = stages && stages.length > 0 ? stages : STAGES;
  const [showQuoteDrawer, setShowQuoteDrawer] = useState(false);
  const [dealQuotes, setDealQuotes] = useState<Invoice[]>([]);
  const [previewInvoice, setPreviewInvoice] = useState<Invoice | null>(null);
  const [dealNotes, setDealNotes] = useState<any[]>([]);
  const [newNote, setNewNote] = useState("");
  const [submittingNote, setSubmittingNote] = useState(false);

  const loadDealQuotes = useCallback(async () => {
    if (!deal?.id) return;
    try {
      const data = await api.getInvoices({ deal_id: String(deal.id) });
      setDealQuotes(data || []);
    } catch {}
  }, [deal?.id]);

  const loadDealNotes = useCallback(async () => {
    if (!deal?.id) return;
    try {
      const acts = await api.getActivities({ deal_id: String(deal.id) });
      const notesOnly = (acts || []).filter((a: any) => (a.type || "").toUpperCase() === "NOTE" || a.notes);
      setDealNotes(notesOnly);
    } catch {}
  }, [deal?.id]);

  useEffect(() => {
    if (isOpen && deal?.id) {
      loadDealQuotes();
      loadDealNotes();
    }
  }, [isOpen, deal?.id, loadDealQuotes, loadDealNotes]);

  const handleAddDealNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNote.trim() || !deal?.id) return;
    setSubmittingNote(true);
    try {
      const noteText = newNote.trim();
      const savedAct = await api.createActivity({
        deal_id: String(deal.id),
        contact_id: deal.contact_id ? String(deal.contact_id) : undefined,
        type: "NOTE",
        notes: noteText
      });
      const newAct = savedAct || {
        id: "act_" + Date.now(),
        type: "NOTE",
        notes: noteText,
        created_at: new Date().toISOString()
      };
      setDealNotes((prev) => [newAct, ...prev]);
      setNewNote("");
      toast.success("Note Saved", "Interaction note recorded to deal.");
    } catch (err: any) {
      toast.error("Error", err.message || "Could not save note.");
    } finally {
      setSubmittingNote(false);
    }
  };

  if (!isOpen || !deal) return null;

  const currentStage = deal.stage || "New Deal";

  const handleStageSelect = async (newStage: string) => {
    if (newStage === currentStage) return;
    if (onStageChange) {
      await onStageChange(deal.id, newStage);
    }
  };

  const handleQuoteSuccess = async (saved: Invoice) => {
    loadDealQuotes();
    if (onStageChange) {
      await onStageChange(deal.id, "Proposal Sent");
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden flex justify-end animate-in fade-in duration-200">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs transition-opacity"
        onClick={onClose}
      />

      {/* Slide Drawer */}
      <div className="relative w-full max-w-lg bg-white h-full shadow-2xl flex flex-col z-10 animate-in slide-in-from-right duration-300 border-l border-slate-200">
        
        {/* Header */}
        <div className="p-5 border-b border-slate-200 bg-white flex items-start justify-between shrink-0">
          <div className="min-w-0 pr-3">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-red-50 text-red-700 border border-red-200 mb-1.5">
              <Briefcase className="w-3 h-3" />
              {currentStage}
            </span>
            <h2 className="text-lg font-bold text-slate-900 truncate">
              {deal.title}
            </h2>
            <p className="text-xs text-slate-500 font-medium mt-0.5 truncate">
              {deal.company_name || "Enterprise Account"}
              {deal.contact_name ? ` • ${deal.contact_name}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer shrink-0"
            title="Close drawer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar text-xs">
          
          {/* Key Deal Highlights Banner */}
          <div className="grid grid-cols-2 gap-3.5">
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 shadow-2xs">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                Deal Amount
              </span>
              <div className="flex items-center gap-1.5 mt-1">
                <span className="text-2xl font-black text-slate-900">
                  {formatCurrency(deal.value || deal.deal_value || 0)}
                </span>
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 shadow-2xs">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                Win Probability
              </span>
              <div className="flex items-center gap-1.5 mt-1">
                <span className="text-2xl font-black text-red-600">
                  {deal.probability || 50}%
                </span>
              </div>
            </div>
          </div>

          {/* Pipeline Stage Tracker */}
          <div className="p-4 rounded-2xl bg-white border border-slate-200/80 shadow-2xs space-y-3">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-700 block">
              Stage Progress
            </span>
            <div className="grid grid-cols-3 gap-2">
              {activeStages.map((st) => {
                const isActive = currentStage.toLowerCase().includes(st.toLowerCase());
                return (
                  <button
                    key={st}
                    type="button"
                    onClick={() => handleStageSelect(st)}
                    className={`px-2.5 py-2 rounded-xl text-center font-semibold text-xs transition-all border cursor-pointer truncate ${
                      isActive
                        ? "bg-red-600 text-white border-red-600 shadow-xs"
                        : "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100"
                    }`}
                  >
                    {st}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Deal Metadata Information Card */}
          <div className="p-5 rounded-2xl bg-white border border-slate-200/80 shadow-2xs space-y-3">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-700 block">
              Deal Information
            </span>

            <div className="space-y-3 divide-y divide-slate-100 text-slate-700">
              <div className="flex items-center justify-between pt-2">
                <span className="text-slate-400 flex items-center gap-1.5 font-medium">
                  <Building2 className="w-3.5 h-3.5" /> Company
                </span>
                <span className="font-semibold text-slate-800">
                  {deal.company_name || "—"}
                </span>
              </div>

              <div className="flex items-center justify-between pt-2">
                <span className="text-slate-400 flex items-center gap-1.5 font-medium">
                  <User className="w-3.5 h-3.5" /> Primary Contact
                </span>
                <span className="font-semibold text-slate-800">
                  {deal.contact_name || "—"}
                </span>
              </div>

              {/* Direct Communication Quick Bar */}
              <div className="pt-2 flex items-center justify-between bg-slate-50 p-2.5 rounded-xl border border-slate-200/60">
                <span className="text-slate-500 font-medium text-[11px]">Quick Reach Out</span>
                <div className="flex items-center gap-2">
                  <a
                    href={
                      (deal.contact_phone || (deal.custom_data && (deal.custom_data.contact_phone || deal.custom_data.phone)))
                        ? `/whatsapp?phone=${(deal.contact_phone || (deal.custom_data && (deal.custom_data.contact_phone || deal.custom_data.phone)) || "").replace(/[^0-9]/g, "")}&name=${encodeURIComponent(deal.contact_name || "")}`
                        : undefined
                    }
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
                      (deal.contact_phone || (deal.custom_data && (deal.custom_data.contact_phone || deal.custom_data.phone)))
                        ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-600 hover:text-white border border-emerald-200 cursor-pointer"
                        : "bg-slate-100 text-slate-400 pointer-events-none opacity-50"
                    }`}
                    title="Open in WhatsApp Suite"
                  >
                    <WhatsAppIcon className="w-3.5 h-3.5 fill-current" />
                    <span>WhatsApp</span>
                  </a>

                  <a
                    href={
                      (deal.contact_phone || (deal.custom_data && (deal.custom_data.contact_phone || deal.custom_data.phone)))
                        ? `tel:${deal.contact_phone || (deal.custom_data && (deal.custom_data.contact_phone || deal.custom_data.phone))}`
                        : undefined
                    }
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
                      (deal.contact_phone || (deal.custom_data && (deal.custom_data.contact_phone || deal.custom_data.phone)))
                        ? "bg-blue-50 text-blue-700 hover:bg-blue-600 hover:text-white border border-blue-200 cursor-pointer"
                        : "bg-slate-100 text-slate-400 pointer-events-none opacity-50"
                    }`}
                    title="Call Contact"
                  >
                    <Phone className="w-3 h-3" />
                    <span>Call</span>
                  </a>

                  <a
                    href={
                      (deal.contact_email || (deal.custom_data && (deal.custom_data.contact_email || deal.custom_data.email)))
                        ? `mailto:${deal.contact_email || (deal.custom_data && (deal.custom_data.contact_email || deal.custom_data.email))}?subject=${encodeURIComponent(`Regarding ${deal.title}`)}`
                        : undefined
                    }
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
                      (deal.contact_email || (deal.custom_data && (deal.custom_data.contact_email || deal.custom_data.email)))
                        ? "bg-rose-50 text-rose-700 hover:bg-rose-600 hover:text-white border border-rose-200 cursor-pointer"
                        : "bg-slate-100 text-slate-400 pointer-events-none opacity-50"
                    }`}
                    title="Send Email"
                  >
                    <Mail className="w-3 h-3" />
                    <span>Email</span>
                  </a>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2">
                <span className="text-slate-400 flex items-center gap-1.5 font-medium">
                  <Calendar className="w-3.5 h-3.5" /> Target Close Date
                </span>
                <span className="font-mono font-medium text-slate-800">
                  {deal.close_date || deal.expected_close_date || "Open"}
                </span>
              </div>

              <div className="flex items-center justify-between pt-2">
                <span className="text-slate-400 flex items-center gap-1.5 font-medium">
                  <Clock className="w-3.5 h-3.5" /> Created Date
                </span>
                <span className="text-slate-600">
                  {deal.created_at ? formatDate(deal.created_at) : "Recently"}
                </span>
              </div>
            </div>
          </div>

          {/* Custom Attributes if available */}
          {deal.custom_data && Object.keys(deal.custom_data).length > 0 && (
            <div className="p-5 rounded-2xl bg-white border border-slate-200/80 shadow-2xs space-y-3">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-700 block">
                Custom Attributes
              </span>
              <div className="grid grid-cols-2 gap-3">
                {Object.entries(deal.custom_data).map(([key, val]) => (
                  <div key={key} className="bg-slate-50 p-2.5 rounded-xl border border-slate-200/60">
                    <span className="text-[10px] text-slate-400 font-bold uppercase block truncate">
                      {key.replace(/_/g, " ")}
                    </span>
                    <span className="text-xs font-semibold text-slate-800 truncate block mt-0.5">
                      {String(val || "—")}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Quotes & Proposals Card */}
          <div className="p-5 rounded-2xl bg-white border border-slate-200/80 shadow-2xs space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-700 block">
                  Quotes & Commercial Proposals
                </span>
                <span className="text-[11px] text-slate-400">
                  {dealQuotes.length} document{dealQuotes.length === 1 ? "" : "s"} generated
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowQuoteDrawer(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold shadow-xs transition-all cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Create Quotation</span>
              </button>
            </div>

            {dealQuotes.length > 0 ? (
              <div className="space-y-2 pt-1">
                {dealQuotes.map((q) => {
                  const rawPhone = (q.client_phone || q.phone || deal.contact_phone || "").replace(/\D/g, "");
                  const targetPhone = rawPhone.length === 10 ? `91${rawPhone}` : rawPhone;
                  const waMsg = `Hello ${q.client_name || deal.contact_name || "Client"},\n\nHere is your official Quotation ${q.invoice_number || q.bill_number} for ₹${(q.total_amount || 0).toLocaleString("en-IN")}.\n\nPlease let us know your approval.`;
                  const waUrl = `https://wa.me/${targetPhone}?text=${encodeURIComponent(waMsg)}`;

                  const targetEmail = q.client_email || q.email || deal.contact_email || "";
                  const mailtoUrl = `mailto:${targetEmail}?subject=${encodeURIComponent(`Quotation ${q.invoice_number || q.bill_number} for ${deal.title}`)}&body=${encodeURIComponent(`Dear Client,\n\nPlease find attached the quotation ${q.invoice_number || q.bill_number} amounting to ₹${(q.total_amount || 0).toLocaleString("en-IN")}.\n\nBest regards,\nSales Operations`)}`;

                  return (
                    <div
                      key={q.id}
                      className="p-3 bg-slate-50 hover:bg-red-50/40 rounded-xl border border-slate-200/80 flex items-center justify-between transition-colors"
                    >
                      <div className="truncate pr-2">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-slate-900 text-xs">
                            {q.invoice_number || q.bill_number}
                          </span>
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-white border border-slate-200 text-slate-600">
                            {q.type || "QUOTE"}
                          </span>
                        </div>
                        <span className="text-[11px] text-slate-500 block truncate mt-0.5">
                          {formatCurrency(q.total_amount)} • {q.issue_date || "Recent"}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => setPreviewInvoice(q)}
                          className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 transition-colors cursor-pointer"
                          title="View and Print Quotation"
                        >
                          <Printer className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => window.open(waUrl, "_blank", "noopener,noreferrer")}
                          className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-emerald-50 hover:text-emerald-600 text-slate-700 transition-colors cursor-pointer"
                          title="Share to WhatsApp"
                        >
                          <Share2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => window.location.href = mailtoUrl}
                          className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-blue-50 hover:text-blue-600 text-slate-700 transition-colors cursor-pointer"
                          title="Send via Email"
                        >
                          <Mail className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => window.open(`http://localhost:8000/api/v1/invoices/${q.id}/pdf`, "_blank")}
                          className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-red-50 hover:text-red-600 text-slate-700 transition-colors cursor-pointer"
                          title="Download PDF"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="p-3 text-center bg-slate-50 rounded-xl border border-dashed border-slate-200 text-slate-400 text-xs">
                No quotes generated yet for this deal.
              </div>
            )}
          </div>

          {/* Internal Notes & Activity Section */}
          <div className="p-5 rounded-2xl bg-white border border-slate-200/80 shadow-2xs space-y-3.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                <MessageSquare className="w-3.5 h-3.5 text-red-600" />
                Internal Notes & Activity
              </span>
              <span className="text-[11px] text-slate-400 font-medium">
                {dealNotes.length} note{dealNotes.length === 1 ? "" : "s"}
              </span>
            </div>

            {/* Note Input Box */}
            <form onSubmit={handleAddDealNote} className="space-y-2">
              <textarea
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                placeholder="Log a call summary, discussion notes, or next action items..."
                rows={2}
                className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500 focus:bg-white transition-all resize-none shadow-2xs"
              />
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={submittingNote || !newNote.trim()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold shadow-xs transition-all cursor-pointer"
                >
                  <Send className="w-3 h-3" />
                  <span>{submittingNote ? "Saving..." : "Add Note"}</span>
                </button>
              </div>
            </form>

            {/* Notes List */}
            {dealNotes.length > 0 ? (
              <div className="space-y-2.5 pt-1">
                {dealNotes.map((act) => (
                  <div
                    key={act.id}
                    className="p-3 bg-slate-50 rounded-xl border border-slate-200/80 space-y-1.5"
                  >
                    <div className="flex items-center justify-between">
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-white text-slate-700 border border-slate-200">
                        <FileText className="w-2.5 h-2.5 text-red-600" />
                        Internal Note
                      </span>
                      <span className="text-[10px] text-slate-400">
                        {act.created_at ? formatDate(act.created_at) : "Recently"}
                      </span>
                    </div>
                    <p className="text-xs text-slate-700 whitespace-pre-wrap leading-relaxed">
                      {act.notes || act.description || "—"}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-4 text-center bg-slate-50 rounded-xl border border-dashed border-slate-200 text-slate-400 text-xs">
                <FileText className="w-6 h-6 mx-auto mb-1.5 text-slate-300 stroke-[1.5]" />
                <p className="font-medium text-slate-600">No notes recorded yet</p>
                <p className="text-[11px] text-slate-400 mt-0.5">Use the box above to log internal discussion notes.</p>
              </div>
            )}
          </div>

        </div>

        {/* Footer */}
        <div className="p-4 px-6 border-t border-slate-200 bg-white flex items-center justify-between shrink-0">
          {onDelete ? (
            <button
              type="button"
              onClick={() => {
                onClose();
                onDelete(deal.id);
              }}
              className="text-xs font-semibold text-rose-600 hover:text-rose-700 hover:bg-rose-50 px-3 py-2 rounded-xl transition-colors cursor-pointer"
            >
              Delete Deal
            </button>
          ) : (
            <div />
          )}

          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>

      </div>

      {/* Create Quote Drawer */}
      <CreateQuoteDrawer
        isOpen={showQuoteDrawer}
        onClose={() => setShowQuoteDrawer(false)}
        deal={deal}
        onSuccess={handleQuoteSuccess}
      />

      {/* Quote Preview Modal */}
      <QuotationPreviewModal
        invoice={previewInvoice}
        isOpen={Boolean(previewInvoice)}
        onClose={() => setPreviewInvoice(null)}
      />
    </div>
  );
}
