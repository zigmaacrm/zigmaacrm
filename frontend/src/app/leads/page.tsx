"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Users,
  Search,
  Plus,
  Upload,
  Download,
  Phone,
  Mail,
  MessageSquare,
  Trash2,
  ExternalLink,
  Edit2,
  ChevronLeft,
  ChevronRight,
  Filter,
  SlidersHorizontal,
  RotateCw,
  LayoutGrid,
  Columns3,
  MoreVertical,
  CheckSquare,
  Square,
  ChevronDown,
  Sparkles,
  ArrowRight,
  ArrowLeft,
  Calendar,
  Building2,
  GripVertical,
  Handshake,
  CheckCircle2
} from "lucide-react";
import Sidebar from "@/components/layout/Sidebar";
import Header from "@/components/layout/Header";
import LeadDetailsDrawer from "@/components/leads/LeadDetailsDrawer";
import AddLeadModal from "@/components/leads/AddLeadModal";
import EditLeadModal from "@/components/leads/EditLeadModal";
import ConvertToDealModal from "@/components/leads/ConvertToDealModal";
import ManageCustomFieldsModal from "@/components/common/ManageCustomFieldsModal";
import FilterSelect from "@/components/common/FilterSelect";
import CustomDropdown from "@/components/common/CustomDropdown";
import CallDialerModal from "@/components/common/CallDialerModal";
import { Sliders } from "lucide-react";
import MoreViewsDropdown from "@/components/common/MoreViewsDropdown";
import { api } from "@/lib/api";
import { formatCurrency } from "@/lib/utils";
import { Lead } from "@/lib/mockData";
import { useToast } from "@/components/common/ToastProvider";

const LEADS_MORE_VIEWS = [
  "All Leads",
  "Converted Leads",
  "Junk Leads",
  "My Converted Leads",
  "My Leads",
  "Not Qualified Leads",
  "Open Leads",
  "Recently Created Leads",
  "Recently Modified Leads",
  "Today's Leads"
];

const LEAD_SOURCES = [
  "Youtube",
  "WhatsApp",
  "Instagram",
  "Advertisement",
  "Cold Call",
  "Employee Referral",
  "Meta Ads",
  "Google Ads",
  "LinkedIn Ads",
  "Website Inbound"
];

const KANBAN_STAGES = [
  { id: "Attempted to Contact", label: "Attempted to Contact", dot: "bg-blue-500", border: "border-blue-200" },
  { id: "Contact in Future", label: "Contact in Future", dot: "bg-purple-500", border: "border-purple-200" },
  { id: "Contacted", label: "Contacted", dot: "bg-emerald-500", border: "border-emerald-200" },
  { id: "Not Contacted", label: "Not Contacted", dot: "bg-amber-500", border: "border-amber-200" },
  { id: "Pre-Qualified", label: "Pre-Qualified", dot: "bg-sky-500", border: "border-sky-200" },
  { id: "Lost Lead", label: "Lost Lead", dot: "bg-rose-500", border: "border-rose-200" }
];

function formatRelativeTime(dateInput?: string | Date): string {
  if (!dateInput) return "Recently";
  try {
    const date = new Date(dateInput);
    if (isNaN(date.getTime())) return "Recently";
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSecs = Math.max(0, Math.floor(diffMs / 1000));
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSecs < 60) return "just now";
    if (diffMins < 60) return `${diffMins} ${diffMins === 1 ? "minute" : "minutes"} ago`;
    if (diffHours < 24) return `${diffHours} ${diffHours === 1 ? "hour" : "hours"} ago`;
    if (diffDays === 1) return "yesterday";
    if (diffDays < 30) return `${diffDays} days ago`;
    return date.toLocaleDateString("en-IN", { month: "short", day: "numeric" });
  } catch {
    return "Recently";
  }
}

export default function LeadsPage() {
  const router = useRouter();
  const { toast, confirm } = useToast();

  useEffect(() => {
    if (typeof window !== "undefined") {
      const search = window.location.search || "";
      router.replace(`/contacts${search}`);
    }
  }, [router]);

  const [leads, setLeads] = useState<Lead[]>([]);
  const [viewMode, setViewMode] = useState<"table" | "kanban">("table");
  const [activeTab, setActiveTab] = useState<string>("All Leads");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSource, setSelectedSource] = useState("ALL");
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [editingLead, setEditingLead] = useState<Lead | null>(null);
  const [convertingLead, setConvertingLead] = useState<Lead | null>(null);
  const [showAddLead, setShowAddLead] = useState(false);
  const [showCustomFields, setShowCustomFields] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [pageSize, setPageSize] = useState(20);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<number | string>>(new Set());
  const [callModalLead, setCallModalLead] = useState<Lead | null>(null);

  const fetchLeads = async () => {
    try {
      const data = await api.getLeads({
        search: searchQuery || undefined,
        source: selectedSource !== "ALL" ? selectedSource : undefined
      });
      setLeads(data || []);
    } catch (e) {
      console.error(e);
      toast.error("Fetch Error", "Could not load leads list.");
    }
  };

  useEffect(() => {
    fetchLeads();
  }, [searchQuery, selectedSource]);

  // Tab Filtering
  const filteredLeads = useMemo(() => {
    return leads.filter((lead) => {
      const isConverted =
        lead.stage === "Closed / Won" ||
        lead.stage === "CONVERTED" ||
        lead.status === "CONVERTED" ||
        lead.status === "Closed / Won";

      if (activeTab === "My Leads") return true;
      if (activeTab === "Open Leads") return !isConverted;
      if (activeTab === "Converted Leads") return isConverted;
      if (activeTab === "Today's Leads") {
        const todayStr = new Date().toISOString().slice(0, 10);
        return (lead.created_at || "").startsWith(todayStr);
      }
      return true;
    });
  }, [leads, activeTab]);

  const handleDeleteLead = async (e: React.MouseEvent, lead: Lead) => {
    e.stopPropagation();
    const confirmed = await confirm({
      title: "Delete Lead",
      message: `Are you sure you want to permanently delete "${lead.name}"? This action cannot be undone.`,
      confirmText: "Delete Lead",
      cancelText: "Keep",
      variant: "danger"
    });

    if (confirmed) {
      const previousLeads = leads;
      // Optimistic removal
      setLeads((prev) => prev.filter((l) => String(l.id) !== String(lead.id)));
      toast.success("Lead Deleted", `"${lead.name}" was removed.`);

      try {
        await api.deleteLead(lead.id);
      } catch (err: any) {
        setLeads(previousLeads);
        toast.error("Delete Failed", err.message || "Could not delete lead. Reverted.");
      }
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    const count = selectedIds.size;
    const confirmed = await confirm({
      title: `Delete ${count} Leads`,
      message: `Are you sure you want to delete ${count} selected lead(s)? This action cannot be undone.`,
      confirmText: `Delete ${count} Leads`,
      cancelText: "Cancel",
      variant: "danger"
    });

    if (confirmed) {
      const previousLeads = leads;
      const idsToDelete = Array.from(selectedIds);
      // Optimistic bulk removal
      setLeads((prev) => prev.filter((l) => !selectedIds.has(l.id)));
      setSelectedIds(new Set());
      toast.success("Bulk Delete Complete", `${count} leads deleted.`);

      try {
        for (const id of idsToDelete) {
          await api.deleteLead(id);
        }
      } catch {
        setLeads(previousLeads);
        toast.error("Bulk Delete Failed", "An error occurred during deletion. Reverted.");
      }
    }
  };

  const handleStageChange = async (leadId: number | string, newStage: string) => {
    setLeads((prev) =>
      prev.map((l) => (String(l.id) === String(leadId) ? { ...l, stage: newStage as any } : l))
    );
    try {
      await api.updateLeadStage(leadId, newStage);
      toast.info("Stage Updated", `Lead moved to "${newStage}"`);
    } catch (e) {
      console.error(e);
      toast.error("Update Failed", "Could not update lead stage.");
    }
  };

  const handleExportCsv = () => {
    if (leads.length === 0) {
      toast.warning("Export Warning", "No leads available to export.");
      return;
    }
    const headers = ["Lead Name", "Company", "Mobile Number", "Email", "Source", "Stage"];
    const rows = leads.map((l) => [
      `"${l.name}"`,
      `"${l.company_name || ""}"`,
      `"${l.phone}"`,
      `"${l.email || ""}"`,
      `"${l.ad_source}"`,
      `"${l.stage}"`
    ]);
    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `zigmaa_leads_${new Date().toISOString().split("T")[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success("Export Complete", `Exported ${leads.length} leads to CSV.`);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === paginatedLeads.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(paginatedLeads.map((l) => l.id)));
    }
  };

  const toggleSelectOne = (id: number | string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const totalPages = Math.ceil(filteredLeads.length / pageSize) || 1;
  const paginatedLeads = filteredLeads.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  return (
    <div className="flex h-screen bg-[#F8FAFC] dark:bg-[#0b0f19] text-slate-900 dark:text-slate-100 font-sans overflow-hidden select-none">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Header />

        <main className="flex-1 overflow-y-auto p-4 lg:p-6 space-y-4 custom-scrollbar bg-[#F8FAFC] dark:bg-[#0b0f19]">
          {/* Controls: Responsive Row Above Table (Single row on wide screens, wraps cleanly on laptops without clipping) */}
          <div className="flex flex-wrap xl:flex-nowrap items-center justify-between gap-2 pb-2.5 shrink-0">
            {/* Left: Navigation Tabs + More Views (···) */}
            <div className="flex items-center gap-1 sm:gap-1.5 text-xs sm:text-sm shrink-0 overflow-x-auto max-w-full scrollbar-none">
              {["All Leads", "My Leads", "Open Leads", "Converted Leads", "Today's Leads"].map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={(e) => {
                    setActiveTab(tab);
                    setCurrentPage(1);
                    e.currentTarget.blur();
                  }}
                  className={`px-2 sm:px-2.5 xl:px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer whitespace-nowrap text-xs xl:text-sm outline-none! focus:outline-none! focus-visible:outline-none! ring-0! focus:ring-0! focus-visible:ring-0! border select-none ${
                    activeTab === tab
                      ? "bg-red-50 text-red-600 font-bold border-red-200/80 shadow-2xs"
                      : "border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                  }`}
                  style={{ outline: "none", boxShadow: activeTab === tab ? undefined : "none" }}
                >
                  {tab}
                </button>
              ))}

              {/* More Views Dropdown (···) */}
              <MoreViewsDropdown
                views={LEADS_MORE_VIEWS}
                activeView={activeTab}
                onSelect={(view) => {
                  setActiveTab(view);
                  setCurrentPage(1);
                }}
              />

              {/* Bulk Actions Indicator */}
              {selectedIds.size > 0 && (
                <div className="flex items-center gap-2 ml-1 px-2.5 py-1 bg-red-50 text-red-700 border border-red-200 rounded-lg text-xs font-bold animate-in fade-in duration-100 shrink-0">
                  <span>{selectedIds.size} selected</span>
                  <button
                    onClick={handleBulkDelete}
                    className="p-1 hover:bg-red-100 rounded text-red-600 transition-colors cursor-pointer"
                    title="Delete Selected Leads"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>

            {/* Right Actions: [Lead Source ▾] [Add Lead ▾] [Export] [ ⊞ | ▥ ] */}
            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 flex-wrap sm:flex-nowrap">
              {/* Custom Lead Source Dropdown */}
              <FilterSelect
                placeholder="Lead Source"
                value={selectedSource}
                options={LEAD_SOURCES}
                onChange={(val) => {
                  setSelectedSource(val);
                  setCurrentPage(1);
                }}
                className="shrink-0 [&>button]:h-9 [&>button]:py-0 [&>button]:px-2.5 sm:[&>button]:px-3 [&>button]:text-xs sm:[&>button]:text-sm"
              />

              {/* Add Lead with Split Dropdown */}
              <div className="relative inline-block shrink-0">
                <div className="inline-flex rounded-xl shadow-xs overflow-hidden h-9">
                  <button
                    onClick={() => setShowAddLead(true)}
                    className="px-3 sm:px-3.5 bg-red-600 hover:bg-red-700 active:bg-red-800 text-white text-xs sm:text-sm font-semibold transition-all cursor-pointer flex items-center gap-1.5 whitespace-nowrap"
                  >
                    <span>Add Lead</span>
                  </button>
                  <button
                    onClick={() => setShowAddMenu(!showAddMenu)}
                    className="px-2 bg-red-700 hover:bg-red-800 text-white text-xs sm:text-sm transition-all cursor-pointer border-l border-red-500/30 flex items-center justify-center"
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                </div>

                {showAddMenu && (
                  <div className="absolute right-0 mt-1.5 w-48 bg-white border border-slate-200 rounded-xl shadow-lg p-1.5 z-30 text-xs sm:text-sm space-y-0.5 animate-in fade-in zoom-in-95 duration-100">
                    <button
                      onClick={() => {
                        setShowAddLead(true);
                        setShowAddMenu(false);
                      }}
                      className="w-full text-left px-3 py-2 hover:bg-red-50 text-slate-700 hover:text-red-600 rounded-lg font-medium flex items-center gap-2 cursor-pointer"
                    >
                      <Plus className="w-4 h-4" />
                      <span>Create Single Lead</span>
                    </button>
                    <Link
                      href="/leads/import"
                      className="w-full text-left px-3 py-2 hover:bg-red-50 text-slate-700 hover:text-red-600 rounded-lg font-medium flex items-center gap-2 cursor-pointer"
                    >
                      <Upload className="w-4 h-4 text-red-600" />
                      <span>Bulk CSV Import</span>
                    </Link>
                  </div>
                )}
              </div>

              {/* Export Button */}
              <button
                onClick={handleExportCsv}
                className="h-9 px-3 sm:px-3.5 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-xl text-xs sm:text-sm font-semibold shadow-2xs transition-colors cursor-pointer flex items-center gap-1.5 shrink-0 whitespace-nowrap"
                title="Export Leads CSV"
              >
                <Download className="w-3.5 h-3.5 text-slate-500" />
                <span>Export</span>
              </button>

              {/* Manage Custom Fields Button */}
              <button
                type="button"
                onClick={() => setShowCustomFields(true)}
                className="h-9 px-2.5 sm:px-3 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-xl text-xs sm:text-sm font-semibold shadow-2xs transition-colors cursor-pointer flex items-center gap-1.5 shrink-0 whitespace-nowrap"
                title="Manage Custom Attributes"
              >
                <Sliders className="w-3.5 h-3.5 text-slate-500" />
                <span>Fields</span>
              </button>
            </div>
          </div>

          {/* TABLE VIEW (Dedicated Table View Only) */}
          <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
            <div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="bg-slate-50/80 border-b border-slate-200/80 text-sm font-semibold text-slate-800">
                        <th className="py-3.5 px-3 w-12 text-center border-r border-slate-200/80">
                          <div className="flex items-center justify-center">
                            <button
                              onClick={toggleSelectAll}
                              className="flex items-center justify-center cursor-pointer text-slate-400 hover:text-slate-600 transition-colors"
                            >
                              {selectedIds.size > 0 && selectedIds.size === paginatedLeads.length ? (
                                <CheckSquare className="w-4 h-4 text-red-600" />
                              ) : (
                                <Square className="w-4 h-4" />
                              )}
                            </button>
                          </div>
                        </th>
                        <th className="px-4 py-3.5 border-r border-slate-200/80">
                          <span>Lead Name</span>
                        </th>
                        <th className="px-4 py-3.5 border-r border-slate-200/80">
                          <span>Contact Info</span>
                        </th>
                        <th className="px-4 py-3.5 border-r border-slate-200/80">
                          <span>Company</span>
                        </th>
                        <th className="px-4 py-3.5 border-r border-slate-200/80">
                          <span>Source</span>
                        </th>
                        <th className="px-4 py-3.5 border-r border-slate-200/80">
                          <span>Stage</span>
                        </th>
                        <th className="px-4 py-3.5 border-r border-slate-200/80">
                          <span>Owner / Assigned Agent</span>
                        </th>
                        <th className="px-4 py-3.5 border-r border-slate-200/80">
                          <span>Created At</span>
                        </th>
                        <th className="px-4 py-3.5 text-right">Actions</th>
                      </tr>
                    </thead>

                    <tbody className="divide-y divide-slate-100 text-slate-700 font-medium text-sm">
                      {paginatedLeads.length === 0 ? (
                        <tr>
                          <td colSpan={9} className="py-24 text-center">
                            <div className="max-w-md mx-auto space-y-1.5">
                              <p className="text-base font-bold text-slate-900">No leads yet</p>
                              <p className="text-sm text-slate-500">Leads you add or import will show up here.</p>
                            </div>
                          </td>
                        </tr>
                      ) : (
                        paginatedLeads.map((lead) => {
                          const isSelected = selectedIds.has(lead.id);

                          // Source Badge Colors: Meta Ads [Blue], Google Ads [Green], Website Form [Purple], Manual/Other [Slate]
                          const srcUpper = (lead.ad_source || (lead as any).source || "").toUpperCase();
                          let sourceBadge = (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                              {lead.ad_source || "Manual"}
                            </span>
                          );
                          if (srcUpper.includes("META")) {
                            sourceBadge = (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                                Meta Ads
                              </span>
                            );
                          } else if (srcUpper.includes("GOOGLE")) {
                            sourceBadge = (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                Google Ads
                              </span>
                            );
                          } else if (srcUpper.includes("WEBSITE") || srcUpper.includes("FORM")) {
                            sourceBadge = (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold bg-purple-50 text-purple-700 border border-purple-200">
                                Website Form
                              </span>
                            );
                          }

                          const isConverted =
                            lead.stage === "Closed / Won" ||
                            lead.stage === "CONVERTED" ||
                            lead.status === "CONVERTED";

                          return (
                            <tr
                              key={lead.id}
                              onClick={() => setSelectedLead(lead)}
                              className={`hover:bg-slate-50/80 transition-colors cursor-pointer group ${
                                isSelected ? "bg-red-50/40" : ""
                              }`}
                            >
                              {/* 1. Checkbox */}
                              <td
                                className="py-3 px-3 text-center"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleSelectOne(lead.id);
                                }}
                              >
                                <div className="flex items-center justify-center">
                                  {isSelected ? (
                                    <CheckSquare className="w-4 h-4 text-red-600" />
                                  ) : (
                                    <Square className="w-4 h-4 text-slate-300 group-hover:text-slate-400" />
                                  )}
                                </div>
                              </td>

                              {/* 2. Lead Name with avatar placeholder */}
                              <td className="p-3">
                                <div className="flex items-center gap-2.5">
                                  <div className="w-7 h-7 rounded-full bg-red-100 text-red-700 text-xs font-bold flex items-center justify-center shrink-0">
                                    {(lead.name || "U").substring(0, 1).toUpperCase()}
                                  </div>
                                  <span className="font-bold text-slate-900 group-hover:text-red-600 transition-colors">
                                    {lead.name}
                                  </span>
                                </div>
                              </td>

                              {/* 3. Contact Info (Mobile Number + Email subtext) */}
                              <td className="p-3 font-medium">
                                <div className="space-y-0.5">
                                  <div className="font-mono text-slate-800 text-xs">{lead.phone || "—"}</div>
                                  {lead.email ? (
                                    <div className="text-[11px] text-slate-400 truncate max-w-[180px]">
                                      {lead.email}
                                    </div>
                                  ) : (
                                    <div className="text-[11px] text-slate-300">No email</div>
                                  )}
                                </div>
                              </td>

                              {/* 4. Company */}
                              <td className="p-3 text-slate-700 font-semibold">
                                {lead.company_name || "Individual"}
                              </td>

                              {/* 5. Source (Badge: Meta [Blue], Google [Green], Website Form [Purple], Manual [Slate]) */}
                              <td className="p-3">
                                {sourceBadge}
                              </td>

                              {/* 6. Stage Dropdown (New Lead, Contacted, Qualified, Lost) */}
                              <td className="p-3" onClick={(e) => e.stopPropagation()}>
                                <CustomDropdown
                                  value={
                                    isConverted
                                      ? "Converted"
                                      : lead.stage === "Contacted / Follow-up"
                                      ? "Contacted"
                                      : lead.stage || "New Lead"
                                  }
                                  options={
                                    isConverted
                                      ? ["New Lead", "Contacted", "Qualified", "Lost", "Converted"]
                                      : ["New Lead", "Contacted", "Qualified", "Lost"]
                                  }
                                  onChange={(val) => handleStageChange(lead.id, val)}
                                  variant="badge"
                                />
                              </td>

                              {/* 7. Owner / Assigned Agent */}
                              <td className="p-3">
                                <div className="flex items-center gap-2">
                                  <div className="w-5 h-5 rounded-full bg-slate-200 text-slate-700 text-[10px] font-bold flex items-center justify-center">
                                    {(lead.name || "A").substring(0, 1).toUpperCase()}
                                  </div>
                                  <span className="text-slate-600 text-xs">Assigned Agent</span>
                                </div>
                              </td>

                              {/* 8. Created At (Relative time e.g. "2 hours ago") */}
                              <td className="p-3 text-slate-500 text-xs whitespace-nowrap">
                                {formatRelativeTime(lead.created_at)}
                              </td>

                              {/* 9. Actions (Call, WhatsApp, Convert to Deal, Delete) */}
                              <td className="p-3 text-right" onClick={(e) => e.stopPropagation()}>
                                <div className="flex items-center justify-end gap-1">
                                  {/* Call */}
                                  {lead.phone && (
                                    <a
                                      href={`tel:${lead.phone}`}
                                      onClick={() => {
                                        api.createActivity({
                                          lead_id: String(lead.id),
                                          type: "CALL",
                                          notes: `Call Clicked: Outbound call triggered for ${lead.name || lead.phone}`,
                                          status: "COMPLETED"
                                        }).catch(() => {});
                                      }}
                                      className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer"
                                      title={`Call ${lead.phone}`}
                                    >
                                      <Phone className="w-3.5 h-3.5" />
                                    </a>
                                  )}

                                  {/* WhatsApp */}
                                  {lead.phone && (
                                    <a
                                      href={`https://wa.me/${lead.phone.replace(/[^0-9]/g, "")}`}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors cursor-pointer"
                                      title="WhatsApp"
                                    >
                                      <MessageSquare className="w-3.5 h-3.5" />
                                    </a>
                                  )}

                                  {/* Convert to Deal */}
                                  {!isConverted && (
                                    <button
                                      type="button"
                                      onClick={() => setConvertingLead(lead)}
                                      className="px-2.5 py-1 text-xs font-bold text-red-600 hover:text-white bg-red-50 hover:bg-red-600 border border-red-200 hover:border-red-600 rounded-lg transition-all flex items-center gap-1 cursor-pointer"
                                      title="Convert to Deal"
                                    >
                                      <Handshake className="w-3 h-3" />
                                      <span>Convert</span>
                                    </button>
                                  )}

                                  {/* Delete */}
                                  <button
                                    onClick={(e) => handleDeleteLead(e, lead)}
                                    className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                                    title="Delete Lead"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                {paginatedLeads.length > 0 && (
                  <div className="p-3.5 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500 font-medium">
                    <span>Showing Page {currentPage} of {totalPages} ({filteredLeads.length} records)</span>
                    <div className="flex items-center gap-1.5">
                      <button
                        disabled={currentPage <= 1}
                        onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                        className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600 disabled:opacity-30 cursor-pointer"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                      <button
                        disabled={currentPage >= totalPages}
                        onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                        className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600 disabled:opacity-30 cursor-pointer"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
        </main>
      </div>

      {/* Lead Details Drawer */}
      {selectedLead && (
        <LeadDetailsDrawer
          lead={selectedLead}
          isOpen={!!selectedLead}
          onClose={() => setSelectedLead(null)}
          onLeadUpdated={fetchLeads}
        />
      )}

      {/* Add Lead Modal */}
      {showAddLead && (
        <AddLeadModal
          isOpen={showAddLead}
          onClose={() => {
            setShowAddLead(false);
            fetchLeads();
          }}
          onLeadAdded={fetchLeads}
        />
      )}

      {/* Edit Lead Modal */}
      {editingLead && (
        <EditLeadModal
          lead={editingLead}
          isOpen={!!editingLead}
          onClose={() => setEditingLead(null)}
          onLeadUpdated={fetchLeads}
        />
      )}

      {/* Convert to Deal Modal */}
      {convertingLead && (
        <ConvertToDealModal
          lead={convertingLead}
          isOpen={!!convertingLead}
          onClose={() => setConvertingLead(null)}
          onConverted={(result) => {
            fetchLeads();
            toast.success(
              "Deal Created",
              `"${result.deal_title}" was added to Deals Pipeline.`
            );
          }}
        />
      )}

      {/* Manage Custom Fields Modal */}
      <ManageCustomFieldsModal
        entityType="LEAD"
        isOpen={showCustomFields}
        onClose={() => setShowCustomFields(false)}
        onFieldsChanged={fetchLeads}
      />

      {/* In-app Call Dialer Modal */}
      {callModalLead && (
        <CallDialerModal
          isOpen={Boolean(callModalLead)}
          onClose={() => setCallModalLead(null)}
          contact={{
            id: callModalLead.id,
            name: callModalLead.name || (callModalLead as any).full_name,
            phone: callModalLead.phone,
            company_name: callModalLead.company_name,
            email: callModalLead.email
          }}
          onCallLogged={fetchLeads}
        />
      )}
    </div>
  );
}
