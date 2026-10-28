"use client";

import { useState, useEffect } from "react";
import {
  X,
  Phone,
  Mail,
  Building2,
  Calendar,
  Handshake,
  Clock,
  Send,
  Plus,
  MessageSquare,
  Globe,
  Tag,
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  UserCheck,
  FileText,
  Activity as ActivityIcon,
  Sparkles,
  RefreshCw,
  AlertTriangle,
  Lightbulb,
  TrendingUp,
  Edit2,
  Check,
  Briefcase
} from "lucide-react";
import Link from "next/link";
import { Contact, Deal } from "@/lib/mockData";
import { api } from "@/lib/api";
import { formatCurrency, formatDate } from "@/lib/utils";
import { useToast } from "@/components/common/ToastProvider";
import SendEmailModal from "@/components/contacts/SendEmailModal";
import CallDialerModal from "@/components/common/CallDialerModal";
import LeadSourceSelect from "@/components/common/LeadSourceSelect";
import { SourceBadge } from "@/components/common/SourceBadge";
import WhatsAppIcon from "@/components/common/WhatsAppIcon";
import CustomDropdown from "@/components/common/CustomDropdown";

interface ContactSlideDrawerProps {
  contact: Contact | null;
  isOpen: boolean;
  onClose: () => void;
  onUpdated?: () => void;
  onOpenCreateDeal?: (contact: Contact) => void;
  initialEditMode?: boolean;
}

const LIFECYCLE_STEPS = [
  { id: "New", label: "New" },
  { id: "Contacted", label: "Contacted" },
  { id: "Interested", label: "Interested" },
  { id: "Qualified", label: "Qualified" },
  { id: "Customer", label: "Won / Customer" }
];

export default function ContactSlideDrawer({
  contact,
  isOpen,
  onClose,
  onUpdated,
  onOpenCreateDeal,
  initialEditMode = false
}: ContactSlideDrawerProps) {
  const { toast } = useToast();
  const [detail, setDetail] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"Overview" | "Timeline" | "Activities" | "Notes">("Overview");

  // Inline Editing State (Twozo style)
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    company_name: "",
    designation: "",
    source: "Manual",
    assigned_to: "Mohamed Thoufiq"
  });
  const [savingField, setSavingField] = useState(false);
  
  // Note logger state
  const [newNote, setNewNote] = useState("");
  const [submittingNote, setSubmittingNote] = useState(false);

  // Quick Deal Modal State
  const [showQuickDeal, setShowQuickDeal] = useState(false);
  const [dealTitle, setDealTitle] = useState("");
  const [dealValue, setDealValue] = useState("");
  const [dealStage, setDealStage] = useState("Discovery");
  const [savingDeal, setSavingDeal] = useState(false);

  // AI Insights State
  const [aiInsights, setAiInsights] = useState<any>(null);
  const [loadingAi, setLoadingAi] = useState(false);

  // Send Email Modal State
  const [showSendEmail, setShowSendEmail] = useState(false);

  // In-app Phone Call Dialer Modal State
  const [showCallModal, setShowCallModal] = useState(false);

  const fetchAiInsights = async (contactId: string | number, forceRefresh: boolean = false) => {
    setLoadingAi(true);
    try {
      const data = await api.getContactAIInsights(contactId, forceRefresh);
      setAiInsights(data);
    } catch {
      setAiInsights(null);
    } finally {
      setLoadingAi(false);
    }
  };

  useEffect(() => {
    if (isOpen && contact) {
      setLoading(true);
      api.getContactDetail(contact.id)
        .then((res) => {
          const c = res || contact;
          setDetail(c);
          const parts = (c.name || "").trim().split(/\s+/);
          setEditForm({
            firstName: parts[0] || "",
            lastName: parts.slice(1).join(" ") || "",
            email: c.email || "",
            phone: c.phone || "",
            company_name: c.company_name || "",
            designation: c.designation || c.job_title || "",
            source: c.source || "Manual",
            assigned_to: c.assigned_to || (c as any).assigned_user_name || "Mohamed Thoufiq"
          });
        })
        .catch(() => {
          setDetail(contact);
          const parts = (contact.name || "").trim().split(/\s+/);
          setEditForm({
            firstName: parts[0] || "",
            lastName: parts.slice(1).join(" ") || "",
            email: contact.email || "",
            phone: contact.phone || "",
            company_name: contact.company_name || "",
            designation: (contact as any).designation || contact.job_title || "",
            source: contact.source || "Manual",
            assigned_to: contact.assigned_to || (contact as any).assigned_user_name || "Mohamed Thoufiq"
          });
        })
        .finally(() => {
          setLoading(false);
        });
      
      setDealTitle(`${contact.company_name || contact.name} - Deal`);
      setDealValue("");
      fetchAiInsights(contact.id, false);
      if (initialEditMode) {
        setActiveTab("Overview");
        setEditingField("firstName");
        setTimeout(() => {
          const el = document.getElementById("basic-information-section");
          if (el) {
            el.scrollIntoView({ behavior: "smooth", block: "center" });
          }
        }, 150);
      } else {
        setEditingField(null);
      }

      if (typeof window !== "undefined") {
        (window as any).__ZIGMAA_ACTIVE_DRAWER = {
          type: "contact",
          id: contact.id,
          name: contact.name,
          email: contact.email,
          phone: contact.phone,
          company: contact.company_name,
          stage: contact.lifecycle_stage || contact.status || "New"
        };
      }

      return () => {
        if (typeof window !== "undefined") {
          (window as any).__ZIGMAA_ACTIVE_DRAWER = null;
        }
      };
    } else {
      if (typeof window !== "undefined") {
        (window as any).__ZIGMAA_ACTIVE_DRAWER = null;
      }
    }
  }, [isOpen, contact, initialEditMode]);

  const handleSaveField = async (field: string) => {
    if (!currentContact) return;
    setSavingField(true);
    const prevDetail = detail;
    const fullName = `${editForm.firstName.trim()} ${editForm.lastName.trim()}`.trim() || currentContact.name;
    const payload: any = {
      name: fullName,
      full_name: fullName,
      email: editForm.email.trim(),
      phone: editForm.phone.trim(),
      company: editForm.company_name.trim(),
      company_name: editForm.company_name.trim(),
      designation: editForm.designation.trim(),
      job_title: editForm.designation.trim(),
      source: editForm.source.trim(),
      assigned_to: editForm.assigned_to.trim(),
      assigned_user_name: editForm.assigned_to.trim()
    };

    // Optimistically update drawer detail view
    setDetail((prev: any) => ({
      ...prev,
      ...payload
    }));
    setEditingField(null);
    toast.success("Contact Updated", `${field} saved successfully.`);

    try {
      const updated = await api.updateContact(currentContact.id, payload);
      if (updated) {
        setDetail((prev: any) => ({
          ...prev,
          ...updated
        }));
      }
      if (onUpdated) onUpdated();
    } catch (err: any) {
      setDetail(prevDetail);
      toast.error("Update Failed", err.message || "Could not save changes. Reverted.");
    } finally {
      setSavingField(false);
    }
  };

  if (!isOpen || !contact) return null;

  const currentContact = detail || contact;
  const currentStage = currentContact.lifecycle_stage || currentContact.status || "New";
  const linkedDeals = currentContact.deals || [];
  const timelineActivities = currentContact.activities || [];
  const customData = currentContact.custom_data || {};

  const handleStageSelect = async (stepId: string) => {
    try {
      const updated = {
        ...currentContact,
        status: stepId,
        lifecycle_stage: stepId
      };
      setDetail(updated);

      await api.updateContact(currentContact.id, {
        status: stepId,
        lifecycle_stage: stepId
      });

      toast.success("Lifecycle Updated", `Status progressed to "${stepId}".`);
      if (onUpdated) onUpdated();
    } catch (err: any) {
      toast.error("Update Failed", err.message || "Failed to update status.");
    }
  };

  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNote.trim()) return;
    setSubmittingNote(true);
    try {
      const newAct = {
        id: Date.now(),
        type: "NOTE",
        notes: newNote.trim(),
        created_at: new Date().toISOString()
      };
      setDetail((prev: any) => ({
        ...prev,
        activities: [newAct, ...(prev?.activities || [])]
      }));
      setNewNote("");
      toast.success("Note Saved", "Interaction recorded to contact notes.");
      if (onUpdated) onUpdated();
    } catch {
      toast.error("Error", "Could not log note.");
    } finally {
      setSubmittingNote(false);
    }
  };

  const handleCreateDealDirect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dealTitle.trim() || !dealValue) {
      toast.warning("Validation", "Please provide a deal title and value.");
      return;
    }

    setSavingDeal(true);
    try {
      const createdDeal = await api.createDeal({
        title: dealTitle.trim(),
        company_name: currentContact.company_name || currentContact.name,
        contact_name: currentContact.name,
        contact_phone: currentContact.phone,
        contact_email: currentContact.email,
        contact_id: currentContact.id,
        value: Number(dealValue) || 0,
        deal_value: Number(dealValue) || 0,
        stage: dealStage,
        probability: dealStage === "Won" ? 100 : 50,
        close_date: new Date(Date.now() + 14 * 86400000).toISOString().split("T")[0]
      });

      // Advance contact lifecycle stage to reflect the converted deal
      const targetLifecycle = dealStage === "Won" ? "Customer" : "Qualified";

      await api.updateContact(currentContact.id, {
        lifecycle_stage: targetLifecycle,
        status: targetLifecycle,
        custom_data: {
          has_open_deal: true,
          latest_deal_id: createdDeal.id,
          latest_deal_title: dealTitle.trim(),
          latest_deal_stage: dealStage
        }
      }).catch(() => {});

      setDetail((prev: any) => {
        const existingDeals = prev?.deals || [];
        const existingIdx = existingDeals.findIndex(
          (d: any) => String(d.id) === String(createdDeal.id) || (d.contact_id && String(d.contact_id) === String(currentContact.id))
        );
        const updatedDeals = existingIdx >= 0
          ? existingDeals.map((d: any, idx: number) => (idx === existingIdx ? createdDeal : d))
          : [createdDeal, ...existingDeals];

        return {
          ...prev,
          lifecycle_stage: targetLifecycle,
          status: targetLifecycle,
          total_deals: updatedDeals.length,
          deals: updatedDeals
        };
      });

      toast.success(
        "Deal Created & Converted",
        `Created "${dealTitle}" in "${dealStage}" stage. Contact converted to "${targetLifecycle}".`
      );
      setShowQuickDeal(false);
      if (onUpdated) onUpdated();
    } catch (err: any) {
      toast.error("Error", err.message || "Could not create deal.");
    } finally {
      setSavingDeal(false);
    }
  };

  const currentStepIdx = LIFECYCLE_STEPS.findIndex((s) => s.id.toLowerCase() === currentStage.toLowerCase());

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-slate-900/40 backdrop-blur-xs flex justify-end animate-in fade-in duration-150">
      <div className="relative w-full max-w-2xl bg-white border-l border-slate-200 shadow-2xl flex flex-col h-full overflow-hidden text-slate-800">
        
        {/* TOP HEADER: Twozo Style */}
        <div className="p-6 bg-slate-50 border-b border-slate-200">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-4">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-red-600 to-rose-500 text-white font-black text-xl flex items-center justify-center shadow-lg shadow-red-600/20 shrink-0">
                {(currentContact.name || "C").substring(0, 1).toUpperCase()}
              </div>

              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-xl font-extrabold text-slate-900">{currentContact.name}</h2>
                  <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200">
                    {currentStage}
                  </span>
                </div>

                <div className="flex items-center gap-3 text-xs text-slate-500 font-medium mt-1">
                  <span>{currentContact.job_title ? `${currentContact.job_title} at ` : ""}{currentContact.company_name || "Independent"}</span>
                  <span>•</span>
                  <span className="flex items-center gap-1 text-slate-600">
                    <UserCheck className="w-3.5 h-3.5 text-slate-400" />
                    <span>Owner: {currentContact.assigned_to || "Mohamed Thoufiq"}</span>
                  </span>
                </div>
              </div>
            </div>

            <button
              onClick={onClose}
              className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Quick Action Buttons */}
          <div className="flex items-center gap-2 mt-4 pt-4 border-t border-slate-200/70">
            {currentContact.phone && (
              <a
                href={`tel:${currentContact.phone}`}
                onClick={() => {
                  api.createActivity({
                    contact_id: String(currentContact.id),
                    type: "CALL",
                    notes: `Call Clicked: Outbound call triggered for ${currentContact.name || currentContact.phone}`,
                    status: "COMPLETED"
                  }).catch(() => {});
                }}
                className="px-3.5 py-1.5 bg-white border border-slate-200 hover:bg-slate-100 hover:border-slate-300 text-slate-700 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-2xs cursor-pointer"
                title={`Call ${currentContact.phone}`}
              >
                <Phone className="w-3.5 h-3.5 text-slate-500" />
                <span>Call</span>
              </a>
            )}

            {currentContact.phone && (
              <a
                href={`https://wa.me/${currentContact.phone.replace(/[^0-9]/g, "")}`}
                target="_blank"
                rel="noreferrer"
                className="px-3.5 py-1.5 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 text-emerald-700 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-2xs"
              >
                <WhatsAppIcon className="w-3.5 h-3.5 fill-current text-emerald-600" />
                <span>WhatsApp</span>
              </a>
            )}

            {/* In-app Send Email Action Button */}
            <button
              type="button"
              onClick={() => setShowSendEmail(true)}
              className="px-3.5 py-1.5 bg-white border border-slate-200 hover:bg-slate-100 hover:border-slate-300 text-slate-700 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-2xs cursor-pointer"
              title="Compose & Send Email"
            >
              <Mail className="w-3.5 h-3.5 text-slate-500" />
              <span>Send Email</span>
            </button>

            <button
              onClick={() => setShowQuickDeal(true)}
              className="px-3.5 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-xs ml-auto cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Deal</span>
            </button>
          </div>
        </div>

        {/* 2. LIFECYCLE STATUS CHEVRON BAR (Interactive Clickable Step Indicator) */}
        <div className="bg-white border-b border-slate-200 px-6 py-3 overflow-x-auto">
          <div className="flex items-center w-full min-w-[500px] border border-slate-200 rounded-xl overflow-hidden bg-slate-50/50">
            {LIFECYCLE_STEPS.map((step, idx) => {
              const isPassed = currentStepIdx >= 0 && idx < currentStepIdx;
              const isCurrent = currentStepIdx === idx || (currentStepIdx === -1 && idx === 0 && step.id === "New");

              return (
                <button
                  key={step.id}
                  onClick={() => handleStageSelect(step.id)}
                  className={`flex-1 py-2 px-3 text-center text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer border-r border-slate-200 last:border-r-0 ${
                    isCurrent
                      ? "bg-red-600 text-white shadow-inner"
                      : isPassed
                      ? "bg-red-50 text-red-700 hover:bg-red-100"
                      : "bg-white text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                  }`}
                  title={`Set status to ${step.label}`}
                >
                  {isPassed ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-red-600" />
                  ) : null}
                  <span className="truncate">{step.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 3. CONTENT TABS: [ Overview | Timeline | Activities | Notes ] */}
        <div className="border-b border-slate-200 px-6 bg-white flex items-center gap-6">
          {(["Overview", "Timeline", "Activities", "Notes"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`py-3 text-xs font-bold border-b-2 transition-colors cursor-pointer ${
                activeTab === tab
                  ? "border-red-600 text-red-600"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* TAB CONTENT BODY */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar bg-slate-50/30">
          
          {/* TAB 1: OVERVIEW */}
          {activeTab === "Overview" && (
            <div className="space-y-6 animate-in fade-in duration-100">
              {/* ✨ ZIGMAA AI: TWOZO-INSPIRED LEAD INTELLIGENCE WIDGET */}
              <div className="p-5 rounded-2xl bg-gradient-to-br from-white via-red-50/20 to-slate-50 border border-red-200/70 shadow-sm space-y-4 relative overflow-hidden">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-gradient-to-r from-red-600 to-rose-600 text-white text-[11px] font-extrabold shadow-xs tracking-wide">
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>Zigmaa AI</span>
                    </span>
                    <span className="text-xs font-bold text-slate-900">
                      Lead Intelligence & Win Predictor
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => fetchAiInsights(currentContact.id, true)}
                    disabled={loadingAi}
                    className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 hover:text-red-600 transition-colors shadow-2xs cursor-pointer flex items-center gap-1 text-[11px] font-semibold disabled:opacity-50"
                    title="Refresh AI Analysis"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${loadingAi ? "animate-spin text-red-600" : ""}`} />
                    <span>{loadingAi ? "Analyzing..." : "Refresh"}</span>
                  </button>
                </div>

                {loadingAi ? (
                  <div className="py-4 space-y-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-xl bg-red-100/70 animate-pulse flex items-center justify-center">
                        <Sparkles className="w-4 h-4 text-red-500 animate-spin" />
                      </div>
                      <div className="space-y-1.5 flex-1">
                        <div className="h-3 w-48 bg-slate-200 rounded animate-pulse" />
                        <div className="h-2 w-32 bg-slate-100 rounded animate-pulse" />
                      </div>
                    </div>
                    <div className="h-10 bg-white/80 rounded-xl border border-slate-200/60 animate-pulse" />
                    <div className="h-14 bg-white/80 rounded-xl border border-slate-200/60 animate-pulse" />
                  </div>
                ) : aiInsights ? (
                  <div className="space-y-4">
                    {/* Win Chance Meter & Intent Tier Strip */}
                    <div className="p-3.5 rounded-xl bg-white border border-slate-200/90 shadow-2xs flex items-center justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                            <TrendingUp className="w-3.5 h-3.5 text-slate-500" />
                            <span>Win Probability</span>
                          </span>
                          <span className={`text-xs font-black ${
                            aiInsights.win_percentage >= 70
                              ? "text-emerald-600"
                              : aiInsights.win_percentage >= 40
                              ? "text-amber-600"
                              : "text-rose-600"
                          }`}>
                            {aiInsights.win_percentage}% Chance
                          </span>
                        </div>

                        {/* Progress Bar */}
                        <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
                          <div
                            className={`h-2.5 rounded-full transition-all duration-500 ${
                              aiInsights.win_percentage >= 70
                                ? "bg-gradient-to-r from-emerald-500 to-teal-500"
                                : aiInsights.win_percentage >= 40
                                ? "bg-gradient-to-r from-amber-400 to-amber-500"
                                : "bg-gradient-to-r from-rose-400 to-red-500"
                            }`}
                            style={{ width: `${aiInsights.win_percentage}%` }}
                          />
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                          Intent Tier
                        </span>
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-extrabold mt-0.5 ${
                          aiInsights.intent_tier === "High"
                            ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                            : aiInsights.intent_tier === "Medium"
                            ? "bg-amber-50 text-amber-700 border border-amber-200"
                            : "bg-slate-100 text-slate-700 border border-slate-200"
                        }`}>
                          {aiInsights.intent_tier} Intent
                        </span>
                      </div>
                    </div>

                    {/* Key Insight */}
                    {aiInsights.key_insight && (
                      <div className="p-3 bg-red-50/50 rounded-xl border border-red-100 text-xs text-slate-800 font-medium leading-relaxed">
                        <span className="font-bold text-red-700">AI Summary: </span>
                        <span>{aiInsights.key_insight}</span>
                      </div>
                    )}

                    {/* How to Convert Actionable Tips */}
                    {aiInsights.conversion_tips && aiInsights.conversion_tips.length > 0 && (
                      <div className="space-y-1.5">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
                          <Lightbulb className="w-3.5 h-3.5 text-amber-500" />
                          <span>How to Convert (Recommended Strategy)</span>
                        </span>
                        <div className="space-y-1">
                          {aiInsights.conversion_tips.map((tip: string, i: number) => (
                            <div key={i} className="flex items-start gap-2 text-xs text-slate-700 font-medium bg-white p-2.5 rounded-xl border border-slate-200/80 shadow-2xs">
                              <span className="w-4 h-4 rounded-full bg-red-100 text-red-700 text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                                {i + 1}
                              </span>
                              <span>{tip}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Risk Warning Alert */}
                    {aiInsights.risk_warning && (
                      <div className="flex items-center gap-2 p-2.5 rounded-xl bg-amber-50/80 border border-amber-200/80 text-amber-800 text-xs font-semibold">
                        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                        <span><span className="font-bold">Deal Roadblock:</span> {aiInsights.risk_warning}</span>
                      </div>
                    )}

                    {/* Engine Footer */}
                    <div className="flex items-center justify-between text-[10px] text-slate-400 font-medium pt-1">
                      <span>Powered by {aiInsights.engine || "Gemini Flash / Heuristic Engine"}</span>
                      <span>Cached 1h</span>
                    </div>
                  </div>
                ) : null}
              </div>

              {/* Key Metrics */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-4 rounded-2xl bg-white border border-slate-200/90 shadow-2xs">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                    Active Deals
                  </span>
                  <div className="flex items-center gap-2 mt-1">
                    <Handshake className="w-4 h-4 text-indigo-600" />
                    <span className="text-xl font-black text-slate-900">
                      {currentContact.total_deals ?? linkedDeals.length ?? 0}
                    </span>
                  </div>
                </div>

                <div className="p-4 rounded-2xl bg-white border border-slate-200/90 shadow-2xs">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                    Total Lifetime Value (LTV)
                  </span>
                  <div className="flex items-center gap-1.5 mt-1">
                    <span className="text-xl font-black text-emerald-600">
                      {formatCurrency(currentContact.lifetime_value ?? 0)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Basic Information Card (Twozo style with inline edit pens) */}
              <div id="basic-information-section" className="p-5 rounded-2xl bg-white border border-slate-200 space-y-4 shadow-2xs">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">Basic Information</h3>
                  <span className="text-[11px] text-slate-400">Click pencil to edit any field</span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                  {/* First Name */}
                  <div className={`p-3 rounded-xl border transition-all ${editingField === "firstName" ? "bg-red-50/40 border-red-300 ring-2 ring-red-500/20" : "bg-slate-50/70 border-slate-200/80 hover:bg-slate-100/60 group"}`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] font-semibold text-slate-500">First Name</span>
                      {editingField !== "firstName" && (
                        <button
                          type="button"
                          onClick={() => setEditingField("firstName")}
                          className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-red-600 transition-opacity cursor-pointer"
                          title="Edit First Name"
                        >
                          <Edit2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                    {editingField === "firstName" ? (
                      <div className="flex items-center gap-1.5 mt-1">
                        <input
                          type="text"
                          autoFocus
                          value={editForm.firstName}
                          onChange={(e) => setEditForm({ ...editForm, firstName: e.target.value })}
                          className="w-full bg-white border border-slate-300 rounded px-2 py-1 text-xs font-bold text-slate-900 focus:outline-none focus:border-red-500"
                        />
                        <button
                          type="button"
                          disabled={savingField}
                          onClick={() => handleSaveField("First Name")}
                          className="p-1 rounded bg-red-600 text-white hover:bg-red-700 cursor-pointer disabled:opacity-50"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingField(null)}
                          className="p-1 rounded bg-slate-200 text-slate-600 hover:bg-slate-300 cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <p className="font-bold text-slate-900 text-xs truncate">
                        {editForm.firstName || "—"}
                      </p>
                    )}
                  </div>

                  {/* Last Name */}
                  <div className={`p-3 rounded-xl border transition-all ${editingField === "lastName" ? "bg-red-50/40 border-red-300 ring-2 ring-red-500/20" : "bg-slate-50/70 border-slate-200/80 hover:bg-slate-100/60 group"}`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] font-semibold text-slate-500">Last Name</span>
                      {editingField !== "lastName" && (
                        <button
                          type="button"
                          onClick={() => setEditingField("lastName")}
                          className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-red-600 transition-opacity cursor-pointer"
                          title="Edit Last Name"
                        >
                          <Edit2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                    {editingField === "lastName" ? (
                      <div className="flex items-center gap-1.5 mt-1">
                        <input
                          type="text"
                          autoFocus
                          value={editForm.lastName}
                          onChange={(e) => setEditForm({ ...editForm, lastName: e.target.value })}
                          className="w-full bg-white border border-slate-300 rounded px-2 py-1 text-xs font-bold text-slate-900 focus:outline-none focus:border-red-500"
                        />
                        <button
                          type="button"
                          disabled={savingField}
                          onClick={() => handleSaveField("Last Name")}
                          className="p-1 rounded bg-red-600 text-white hover:bg-red-700 cursor-pointer disabled:opacity-50"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingField(null)}
                          className="p-1 rounded bg-slate-200 text-slate-600 hover:bg-slate-300 cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <p className="font-bold text-slate-900 text-xs truncate">
                        {editForm.lastName || "—"}
                      </p>
                    )}
                  </div>

                  {/* Emails */}
                  <div className={`p-3 rounded-xl border transition-all ${editingField === "email" ? "bg-red-50/40 border-red-300 ring-2 ring-red-500/20" : "bg-slate-50/70 border-slate-200/80 hover:bg-slate-100/60 group"}`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] font-semibold text-slate-500">Emails</span>
                      {editingField !== "email" && (
                        <button
                          type="button"
                          onClick={() => setEditingField("email")}
                          className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-red-600 transition-opacity cursor-pointer"
                          title="Edit Email"
                        >
                          <Edit2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                    {editingField === "email" ? (
                      <div className="flex items-center gap-1.5 mt-1">
                        <input
                          type="email"
                          autoFocus
                          value={editForm.email}
                          onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                          className="w-full bg-white border border-slate-300 rounded px-2 py-1 text-xs font-bold text-slate-900 focus:outline-none focus:border-red-500"
                        />
                        <button
                          type="button"
                          disabled={savingField}
                          onClick={() => handleSaveField("Email")}
                          className="p-1 rounded bg-red-600 text-white hover:bg-red-700 cursor-pointer disabled:opacity-50"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingField(null)}
                          className="p-1 rounded bg-slate-200 text-slate-600 hover:bg-slate-300 cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <p className="font-bold text-red-600 text-xs truncate">
                        {editForm.email || "—"}
                      </p>
                    )}
                  </div>

                  {/* Phones */}
                  <div className={`p-3 rounded-xl border transition-all ${editingField === "phone" ? "bg-red-50/40 border-red-300 ring-2 ring-red-500/20" : "bg-slate-50/70 border-slate-200/80 hover:bg-slate-100/60 group"}`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] font-semibold text-slate-500">Phones</span>
                      {editingField !== "phone" && (
                        <button
                          type="button"
                          onClick={() => setEditingField("phone")}
                          className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-red-600 transition-opacity cursor-pointer"
                          title="Edit Phone"
                        >
                          <Edit2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                    {editingField === "phone" ? (
                      <div className="flex items-center gap-1.5 mt-1">
                        <input
                          type="text"
                          autoFocus
                          value={editForm.phone}
                          onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                          className="w-full bg-white border border-slate-300 rounded px-2 py-1 text-xs font-bold text-slate-900 focus:outline-none focus:border-red-500 font-mono"
                        />
                        <button
                          type="button"
                          disabled={savingField}
                          onClick={() => handleSaveField("Phone")}
                          className="p-1 rounded bg-red-600 text-white hover:bg-red-700 cursor-pointer disabled:opacity-50"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingField(null)}
                          className="p-1 rounded bg-slate-200 text-slate-600 hover:bg-slate-300 cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-1">
                        {editForm.phone ? (
                          <a
                            href={`tel:${editForm.phone}`}
                            onClick={() => {
                              api.createActivity({
                                contact_id: String(currentContact.id),
                                type: "CALL",
                                notes: `Call Clicked: Outbound call triggered for ${currentContact.name || editForm.phone}`,
                                status: "COMPLETED"
                              }).catch(() => {});
                            }}
                            className="font-bold text-blue-600 hover:text-blue-800 hover:underline text-xs font-mono truncate"
                            title={`Call ${editForm.phone}`}
                          >
                            {editForm.phone}
                          </a>
                        ) : (
                          <p className="font-bold text-slate-900 text-xs font-mono truncate">—</p>
                        )}
                        {editForm.phone && (
                          <a
                            href={`tel:${editForm.phone}`}
                            onClick={() => {
                              api.createActivity({
                                contact_id: String(currentContact.id),
                                type: "CALL",
                                notes: `Call Clicked: Outbound call triggered for ${currentContact.name || editForm.phone}`,
                                status: "COMPLETED"
                              }).catch(() => {});
                            }}
                            className="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors cursor-pointer"
                            title={`Call ${editForm.phone}`}
                          >
                            <Phone className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Company */}
                  <div className={`p-3 rounded-xl border transition-all ${editingField === "company_name" ? "bg-red-50/40 border-red-300 ring-2 ring-red-500/20" : "bg-slate-50/70 border-slate-200/80 hover:bg-slate-100/60 group"}`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] font-semibold text-slate-500">Company</span>
                      {editingField !== "company_name" && (
                        <button
                          type="button"
                          onClick={() => setEditingField("company_name")}
                          className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-red-600 transition-opacity cursor-pointer"
                          title="Edit Company"
                        >
                          <Edit2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                    {editingField === "company_name" ? (
                      <div className="flex items-center gap-1.5 mt-1">
                        <input
                          type="text"
                          autoFocus
                          value={editForm.company_name}
                          onChange={(e) => setEditForm({ ...editForm, company_name: e.target.value })}
                          className="w-full bg-white border border-slate-300 rounded px-2 py-1 text-xs font-bold text-slate-900 focus:outline-none focus:border-red-500"
                        />
                        <button
                          type="button"
                          disabled={savingField}
                          onClick={() => handleSaveField("Company")}
                          className="p-1 rounded bg-red-600 text-white hover:bg-red-700 cursor-pointer disabled:opacity-50"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingField(null)}
                          className="p-1 rounded bg-slate-200 text-slate-600 hover:bg-slate-300 cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <p className="font-bold text-slate-800 text-xs truncate">
                        {editForm.company_name || <span className="text-slate-400 font-normal">Click to add</span>}
                      </p>
                    )}
                  </div>

                  {/* Designation */}
                  <div className={`p-3 rounded-xl border transition-all ${editingField === "designation" ? "bg-red-50/40 border-red-300 ring-2 ring-red-500/20" : "bg-slate-50/70 border-slate-200/80 hover:bg-slate-100/60 group"}`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] font-semibold text-slate-500">Designation</span>
                      {editingField !== "designation" && (
                        <button
                          type="button"
                          onClick={() => setEditingField("designation")}
                          className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-red-600 transition-opacity cursor-pointer"
                          title="Edit Designation"
                        >
                          <Edit2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                    {editingField === "designation" ? (
                      <div className="flex items-center gap-1.5 mt-1">
                        <input
                          type="text"
                          autoFocus
                          value={editForm.designation}
                          onChange={(e) => setEditForm({ ...editForm, designation: e.target.value })}
                          className="w-full bg-white border border-slate-300 rounded px-2 py-1 text-xs font-bold text-slate-900 focus:outline-none focus:border-red-500"
                        />
                        <button
                          type="button"
                          disabled={savingField}
                          onClick={() => handleSaveField("Designation")}
                          className="p-1 rounded bg-red-600 text-white hover:bg-red-700 cursor-pointer disabled:opacity-50"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingField(null)}
                          className="p-1 rounded bg-slate-200 text-slate-600 hover:bg-slate-300 cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <p className="font-bold text-slate-800 text-xs truncate">
                        {editForm.designation || <span className="text-slate-400 font-normal">Click to add</span>}
                      </p>
                    )}
                  </div>

                  {/* Sales Owner */}
                  <div className={`p-3 rounded-xl border transition-all ${editingField === "assigned_to" ? "bg-red-50/40 border-red-300 ring-2 ring-red-500/20" : "bg-slate-50/70 border-slate-200/80 hover:bg-slate-100/60 group"}`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] font-semibold text-slate-500">Sales Owner</span>
                      {editingField !== "assigned_to" && (
                        <button
                          type="button"
                          onClick={() => setEditingField("assigned_to")}
                          className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-red-600 transition-opacity cursor-pointer"
                          title="Edit Sales Owner"
                        >
                          <Edit2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                    {editingField === "assigned_to" ? (
                      <div className="flex items-center gap-1.5 mt-1">
                        <input
                          type="text"
                          autoFocus
                          value={editForm.assigned_to}
                          onChange={(e) => setEditForm({ ...editForm, assigned_to: e.target.value })}
                          className="w-full bg-white border border-slate-300 rounded px-2 py-1 text-xs font-bold text-slate-900 focus:outline-none focus:border-red-500"
                        />
                        <button
                          type="button"
                          disabled={savingField}
                          onClick={() => handleSaveField("Sales Owner")}
                          className="p-1 rounded bg-red-600 text-white hover:bg-red-700 cursor-pointer disabled:opacity-50"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingField(null)}
                          className="p-1 rounded bg-slate-200 text-slate-600 hover:bg-slate-300 cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <div className="w-4 h-4 rounded-full bg-slate-200 text-slate-600 text-[9px] font-bold flex items-center justify-center shrink-0">
                          {(editForm.assigned_to || "M").substring(0, 1).toUpperCase()}
                        </div>
                        <p className="font-bold text-slate-800 text-xs truncate">
                          {editForm.assigned_to || "Mohamed Thoufiq"}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Lead Source */}
                  <div className={`p-3 rounded-xl border transition-all ${editingField === "source" ? "bg-red-50/40 border-red-300 ring-2 ring-red-500/20" : "bg-slate-50/70 border-slate-200/80 hover:bg-slate-100/60 group"}`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] font-semibold text-slate-500">Lead Source</span>
                      {editingField !== "source" && (
                        <button
                          type="button"
                          onClick={() => setEditingField("source")}
                          className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-red-600 transition-opacity cursor-pointer"
                          title="Edit Lead Source"
                        >
                          <Edit2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                    {editingField === "source" ? (
                      <div className="flex items-center gap-1.5 mt-1">
                        <div className="flex-1">
                          <LeadSourceSelect
                            value={editForm.source}
                            onChange={(val) => setEditForm({ ...editForm, source: val })}
                          />
                        </div>
                        <button
                          type="button"
                          disabled={savingField}
                          onClick={() => handleSaveField("Lead Source")}
                          className="h-10 px-2.5 rounded-xl bg-red-600 text-white hover:bg-red-700 cursor-pointer disabled:opacity-50 flex items-center justify-center shrink-0"
                          title="Save"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingField(null)}
                          className="h-10 px-2.5 rounded-xl bg-slate-200 text-slate-600 hover:bg-slate-300 cursor-pointer flex items-center justify-center shrink-0"
                          title="Cancel"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <div className="mt-1">
                        <SourceBadge source={editForm.source || currentContact.source || "Manual"} />
                      </div>
                    )}
                  </div>
                </div>

                {/* Additional Metadata Strip */}
                <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500 flex-wrap gap-2">
                  <div className="flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-slate-400" />
                    <span>Created: <strong className="text-slate-700 font-semibold">{currentContact.created_at ? formatDate(currentContact.created_at) : "—"}</strong></span>
                  </div>
                </div>
              </div>

              {/* Dynamic Custom Attributes Card */}
              {Object.keys(customData).length > 0 && (
                <div className="p-5 rounded-2xl bg-white border border-slate-200 space-y-3 shadow-2xs">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Custom Attributes</h3>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    {Object.entries(customData).map(([k, v]) => (
                      <div key={k} className="bg-slate-50 p-3 rounded-xl border border-slate-200/80">
                        <span className="text-slate-400 block text-[10px] font-semibold uppercase">{k.replace(/_/g, " ")}</span>
                        <span className="font-bold text-slate-900 mt-0.5 block">{typeof v === "boolean" ? (v ? "Yes" : "No") : String(v)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Linked Deals Card */}
              <div className="p-5 rounded-2xl bg-white border border-slate-200 space-y-3.5 shadow-2xs">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Linked Deals ({linkedDeals.length})
                  </h3>
                  <button
                    onClick={() => setShowQuickDeal(true)}
                    className="text-xs font-bold text-red-600 hover:text-red-700 flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Create Deal</span>
                  </button>
                </div>

                {linkedDeals.length === 0 ? (
                  <div className="p-4 text-center text-xs text-slate-500 bg-slate-50 rounded-xl border border-slate-200">
                    No deals linked to this contact yet. Click "+ Deal" above to create one.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {linkedDeals.map((d: any) => (
                      <div key={d.id} className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between hover:border-red-200 transition-colors">
                        <div>
                          <h4 className="text-xs font-bold text-slate-900">{d.title}</h4>
                          <div className="flex items-center gap-2 text-[11px] text-slate-500 mt-1">
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                              {d.stage || d.status || "OPEN"}
                            </span>
                            <span>Close: {d.expected_close_date || "—"}</span>
                          </div>
                        </div>
                        <span className="text-sm font-black text-red-600">
                          {formatCurrency(d.deal_value || d.value || 0)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 2 & 3: TIMELINE / ACTIVITIES */}
          {(activeTab === "Timeline" || activeTab === "Activities") && (
            <div className="space-y-4 animate-in fade-in duration-100">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500 block">
                Activity & Interaction History
              </span>

              {timelineActivities.length === 0 ? (
                <div className="p-8 text-center bg-white rounded-2xl border border-slate-200 text-xs text-slate-500">
                  <ActivityIcon className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                  <p className="font-semibold text-slate-700">No activities recorded</p>
                  <p className="text-slate-400 mt-0.5">Calls, meetings, and updates will be logged here.</p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {timelineActivities.map((act: any) => (
                    <div key={act.id} className="p-4 bg-white rounded-2xl border border-slate-200 shadow-2xs flex items-start gap-3">
                      <div className="p-2 rounded-xl bg-red-100 text-red-600 shrink-0 mt-0.5">
                        <Clock className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-slate-800">{act.notes || act.description || "Activity recorded"}</p>
                        <span className="text-[11px] text-slate-400 block mt-1">
                          {act.created_at ? formatDate(act.created_at) : "Recently"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 4: NOTES TAB (Rich Note Logger) */}
          {activeTab === "Notes" && (
            <div className="space-y-4 animate-in fade-in duration-100">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500 block">
                Call & Meeting Notes
              </span>

              <form onSubmit={handleAddNote} className="p-4 bg-white rounded-2xl border border-slate-200 shadow-2xs space-y-3">
                <textarea
                  rows={3}
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder="Record summary of client call, key requirements, negotiation takeaways..."
                  className="w-full bg-slate-50 text-slate-900 text-xs p-3.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-red-500 focus:bg-white resize-none"
                />
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-slate-400 font-medium">Recorded to interaction timeline</span>
                  <button
                    type="submit"
                    disabled={submittingNote}
                    className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold shadow-xs transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>{submittingNote ? "Saving..." : "Save Note"}</span>
                  </button>
                </div>
              </form>

              {/* Past notes */}
              <div className="space-y-2.5">
                {timelineActivities.filter((a: any) => a.type === "NOTE" || a.notes).map((act: any) => (
                  <div key={act.id} className="p-4 bg-white rounded-2xl border border-slate-200 shadow-2xs space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] text-slate-400">
                      <span className="font-bold text-slate-600 flex items-center gap-1.5">
                        <FileText className="w-3.5 h-3.5 text-slate-400" />
                        <span>Call Note</span>
                      </span>
                      <span>{act.created_at ? formatDate(act.created_at) : "Recently"}</span>
                    </div>
                    <p className="text-xs text-slate-800 leading-relaxed font-medium">{act.notes}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>

      </div>

      {/* QUICK CREATE DEAL MODAL */}
      {showQuickDeal && (
        <div className="fixed inset-0 z-60 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full border border-slate-200 overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-red-100 text-red-600 flex items-center justify-center">
                  <Handshake className="w-4 h-4" />
                </div>
                <h3 className="font-bold text-slate-900 text-sm">Create Deal for {currentContact.name}</h3>
              </div>
              <button
                onClick={() => setShowQuickDeal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateDealDirect} className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Deal Title <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={dealTitle}
                  onChange={(e) => setDealTitle(e.target.value)}
                  className="w-full bg-slate-50 text-slate-900 text-xs px-3 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-red-500 font-medium"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Deal Value (₹) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    required
                    min={0}
                    placeholder="e.g. 50000"
                    value={dealValue}
                    onChange={(e) => setDealValue(e.target.value)}
                    className="w-full bg-slate-50 text-slate-900 text-xs px-3 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-red-500 font-semibold"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Pipeline Stage
                  </label>
                  <CustomDropdown
                    value={dealStage}
                    onChange={(val) => setDealStage(String(val))}
                    options={["New Deal", "Discovery", "Proposal Sent", "Negotiation", "Won"]}
                    variant="input"
                    className="w-full text-xs font-medium"
                  />
                </div>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowQuickDeal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-500 hover:text-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingDeal}
                  className="px-5 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold shadow-xs cursor-pointer disabled:opacity-50"
                >
                  {savingDeal ? "Creating..." : "Create Deal"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* In-app Send Email Modal */}
      <SendEmailModal
        isOpen={showSendEmail}
        onClose={() => setShowSendEmail(false)}
        contact={{
          id: currentContact.id,
          name: currentContact.name,
          email: currentContact.email
        }}
        onSent={(newActivity) => {
          if (newActivity) {
            setDetail((prev: any) => ({
              ...prev,
              activities: [newActivity, ...(prev?.activities || [])]
            }));
          }
          if (onUpdated) onUpdated();
        }}
      />

      {/* In-app Call Dialer Modal */}
      <CallDialerModal
        isOpen={showCallModal}
        onClose={() => setShowCallModal(false)}
        contact={{
          id: currentContact.id,
          name: currentContact.name,
          phone: currentContact.phone,
          company_name: currentContact.company_name,
          email: currentContact.email
        }}
        onCallLogged={() => {
          if (currentContact?.id) {
            api.getContactDetail(currentContact.id).then((res) => {
              if (res) setDetail(res);
            }).catch(() => {});
          }
          if (onUpdated) onUpdated();
        }}
      />

    </div>
  );
}
