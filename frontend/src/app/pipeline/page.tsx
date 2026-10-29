"use client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

import { useState, useEffect, useMemo } from "react";
import {
  Handshake,
  Plus,
  Search,
  Building2,
  Trash2,
  X,
  Filter,
  SlidersHorizontal,
  RotateCw,
  MoreVertical,
  ChevronDown,
  ArrowRight,
  ArrowLeft,
  DollarSign,
  Calendar,
  Sparkles,
  GripVertical,
  MessageSquare,
  Phone,
  Mail
} from "lucide-react";
import WhatsAppIcon from "@/components/common/WhatsAppIcon";
import Sidebar from "@/components/layout/Sidebar";
import Header from "@/components/layout/Header";
import FilterSelect from "@/components/common/FilterSelect";
import MoreViewsDropdown from "@/components/common/MoreViewsDropdown";
import ManageCustomFieldsModal from "@/components/common/ManageCustomFieldsModal";
import NewDealDrawer from "@/components/deals/NewDealDrawer";
import DealDetailsDrawer from "@/components/deals/DealDetailsDrawer";
import PipelineStagesModal, {
  PipelineStageConfig,
  DEFAULT_PIPELINE_STAGES,
  STORAGE_KEY
} from "@/components/deals/PipelineStagesModal";
import { api } from "@/lib/api";
import { formatCurrency } from "@/lib/utils";
import { Deal } from "@/lib/mockData";
import { useToast } from "@/components/common/ToastProvider";

const PRIMARY_DEAL_TABS = ["All Deals", "My Deals", "Open Deals", "Won Deals"];
const EXTENDED_DEAL_TAB = "Closing This Month";

const DEALS_MORE_VIEWS = [
  "Closing This Month",
  "Lost Deals",
  "Today's Deals",
  "Recently Created Deals",
  "Recently Modified Deals"
];

export default function PipelineDealsPage() {
  const { toast, confirm } = useToast();
  const [deals, setDeals] = useState<Deal[]>([]);

  // Pipeline Stages state (persisted dynamically in localStorage)
  const [pipelineStages, setPipelineStages] = useState<PipelineStageConfig[]>(DEFAULT_PIPELINE_STAGES);
  const [showStagesModal, setShowStagesModal] = useState(false);

  const [activeTab, setActiveTab] = useState<string>("All Deals");
  const [selectedStage, setSelectedStage] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearchInput, setShowSearchInput] = useState(false);
  const [showAddDrawer, setShowAddDrawer] = useState(false);
  const [selectedDealForDetails, setSelectedDealForDetails] = useState<Deal | null>(null);
  const [showCustomFields, setShowCustomFields] = useState(false);
  const [customFields, setCustomFields] = useState<any[]>([]);

  // Load custom stages from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setPipelineStages(parsed);
        }
      }
    } catch (err) {
      console.error("Failed to read pipeline stages from localStorage:", err);
    }
  }, []);

  const loadDeals = async () => {
    try {
      const data = await api.getDeals();
      setDeals(data || []);
    } catch (e) {
      console.error(e);
    }
  };

  const loadCustomFields = async () => {
    try {
      const cfs = await api.getCustomFields("DEAL");
      setCustomFields(cfs || []);
    } catch {}
  };

  const [contactsList, setContactsList] = useState<any[]>([]);
  const [leadsList, setLeadsList] = useState<any[]>([]);

  useEffect(() => {
    loadDeals();
    loadCustomFields();
    api.getContacts().then((c) => setContactsList(c || [])).catch(() => {});
    api.getLeads().then((l) => setLeadsList(l || [])).catch(() => {});
  }, []);

  const getDealContactDetails = (deal: Deal) => {
    let phone = deal.contact_phone || (deal.custom_data && (deal.custom_data.contact_phone || deal.custom_data.phone)) || "";
    let email = deal.contact_email || (deal.custom_data && (deal.custom_data.contact_email || deal.custom_data.email)) || "";
    let name = deal.contact_name || (deal.custom_data && deal.custom_data.contact_name) || "";

    if (!phone || !email || !name) {
      // 1. Try matching with contacts
      const matchedContact = contactsList.find((c) =>
        (deal.contact_id && String(c.id) === String(deal.contact_id)) ||
        (deal.contact_name && c.name && c.name.toLowerCase() === deal.contact_name.toLowerCase()) ||
        (deal.company_name && c.company_name && c.company_name.toLowerCase() === deal.company_name.toLowerCase()) ||
        (deal.title && c.company_name && deal.title.toLowerCase().includes(c.company_name.toLowerCase()))
      );
      if (matchedContact) {
        if (!phone) phone = matchedContact.phone || "";
        if (!email) email = matchedContact.email || "";
        if (!name) name = matchedContact.name || "";
      }

      // 2. Try matching with leads
      if (!phone || !email) {
        const matchedLead = leadsList.find((l) =>
          (deal.lead_id && String(l.id) === String(deal.lead_id)) ||
          (deal.contact_name && (l.full_name || l.name) && (l.full_name || l.name).toLowerCase() === deal.contact_name.toLowerCase()) ||
          (deal.company_name && l.company_name && l.company_name.toLowerCase() === deal.company_name.toLowerCase()) ||
          (deal.title && l.company_name && deal.title.toLowerCase().includes(l.company_name.toLowerCase()))
        );
        if (matchedLead) {
          if (!phone) phone = matchedLead.phone || "";
          if (!email) email = matchedLead.email || "";
          if (!name) name = matchedLead.full_name || matchedLead.name || "";
        }
      }
    }

    return { phone, email, name };
  };

  const handleDealWhatsApp = (e: React.MouseEvent, deal: Deal) => {
    e.stopPropagation();
    const { phone, name } = getDealContactDetails(deal);
    if (!phone) {
      toast.warning("WhatsApp", `No phone number linked for ${deal.title}.`);
      return;
    }
    const cleanPhone = phone.replace(/[^0-9]/g, "");
    const waPhone = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;
    const msg = encodeURIComponent(`Hello ${name || deal.company_name || "there"},\n\nFollowing up regarding your deal "${deal.title}" with Zigmaa CRM.`);
    window.open(`https://wa.me/${waPhone}?text=${msg}`, "_blank", "noopener,noreferrer");
  };

  const handleDealCall = (e: React.MouseEvent, deal: Deal) => {
    e.stopPropagation();
    const { phone } = getDealContactDetails(deal);
    if (!phone) {
      toast.warning("Phone Call", `No phone number linked for ${deal.title}.`);
      return;
    }
    window.location.href = `tel:${phone}`;
  };

  const handleDealEmail = (e: React.MouseEvent, deal: Deal) => {
    e.stopPropagation();
    const { email, name } = getDealContactDetails(deal);
    if (!email) {
      toast.warning("Email", `No email address linked for ${deal.title}.`);
      return;
    }
    const subject = encodeURIComponent(`Regarding ${deal.title}`);
    const body = encodeURIComponent(
      `Hi ${name || deal.company_name || "Team"},\n\nI am writing to follow up on our deal discussion for "${deal.title}".\n\nPlease let us know when you would like to connect.\n\nBest regards,\nSales Team`
    );
    window.location.href = `mailto:${email}?subject=${subject}&body=${body}`;
  };

  // Publish real-time UI context for Zigmaa AI Copilot screen sight
  useEffect(() => {
    if (typeof window !== "undefined") {
      (window as any).__ZIGMAA_PAGE_STATE = {
        page: "deals",
        activeTab: activeTab,
        viewMode: "kanban",
        selectedStage: selectedStage,
        totalRecords: deals.length,
        visibleCount: deals.length,
        sampleNames: deals.slice(0, 5).map((d) => d.title)
      };
    }
  }, [activeTab, selectedStage, deals]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      if (selectedDealForDetails) {
        (window as any).__ZIGMAA_ACTIVE_DRAWER = {
          type: "deal",
          id: selectedDealForDetails.id,
          name: selectedDealForDetails.title,
          stage: selectedDealForDetails.stage,
          value: selectedDealForDetails.value,
          company: selectedDealForDetails.company_name
        };
      } else {
        if ((window as any).__ZIGMAA_ACTIVE_DRAWER?.type === "deal") {
          (window as any).__ZIGMAA_ACTIVE_DRAWER = null;
        }
      }
    }
  }, [selectedDealForDetails]);

  const handleCreateDealDrawer = async (dealData: Partial<Deal>) => {
    const temp: Deal = {
      id: Date.now(),
      title: dealData.title || "New Deal",
      company_name: dealData.company_name || "Enterprise Client",
      contact_name: dealData.contact_name || "",
      value: Number(dealData.value) || 0,
      deal_value: Number(dealData.value) || 0,
      stage: dealData.stage || (pipelineStages[0]?.label || "New Deal") as any,
      probability: Number(dealData.probability) || 50,
      close_date: dealData.close_date || new Date().toISOString().split("T")[0],
      expected_close_date: dealData.close_date || new Date().toISOString().split("T")[0],
      created_at: new Date().toISOString(),
      custom_data: dealData.custom_data || {}
    };
    setDeals((prev) => [temp, ...prev]);

    await api.createDeal(dealData);
    toast.success("Deal Created", `"${dealData.title}" was added.`);
    loadDeals();
  };

  const handleDelete = async (id: number | string) => {
    const deal = deals.find((d) => String(d.id) === String(id));
    const confirmed = await confirm({
      title: "Delete Deal",
      message: `Are you sure you want to delete ${deal ? `"${deal.title}"` : "this deal"}?`,
      confirmText: "Delete",
      cancelText: "Cancel",
      variant: "danger"
    });

    if (confirmed) {
      setDeals((prev) => prev.filter((d) => String(d.id) !== String(id)));
      await api.deleteDeal(id);
      toast.success("Deal Deleted", "The deal record was removed.");
    }
  };

  const handleStageChange = async (dealId: number | string, newStage: string) => {
    setDeals((prev) => {
      const next = prev.map((d) => (String(d.id) === String(dealId) ? { ...d, stage: newStage as any } : d));
      if (typeof window !== "undefined") {
        try {
          localStorage.setItem("zigmaa_deals", JSON.stringify(next));
        } catch {}
      }
      return next;
    });
    try {
      await api.updateDeal(dealId, { stage: newStage as any });
    } catch (err) {
      console.error("Failed to update deal stage:", err);
    }
    toast.info("Pipeline Updated", `Deal moved to "${newStage}"`);
  };

  const handleExportCsv = () => {
    if (deals.length === 0) {
      toast.warning("Export Warning", "No deals available to export.");
      return;
    }
    const headers = ["Deal Name", "Company", "Contact", "Amount", "Stage", "Probability", "Close Date"];
    const rows = deals.map((d) => [
      `"${d.title}"`,
      `"${d.company_name || ""}"`,
      `"${d.contact_name || ""}"`,
      d.value,
      `"${d.stage}"`,
      `${d.probability}%`,
      `"${d.close_date}"`
    ]);
    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `zigmaa_deals_${new Date().toISOString().split("T")[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success("Export Complete", `Exported ${deals.length} deals.`);
  };

  // Filtered Deals with Lead/Contact single-deal deduplication
  const filteredDeals = useMemo(() => {
    const rawFiltered = deals.filter((d) => {
      // Tab filter
      if (activeTab === "Open Deals" && (d.stage === "Closed Won" || d.stage === "Won" || d.stage === "Lost" || d.stage === "Closed Lost")) return false;
      if (activeTab === "Won Deals" && d.stage !== "Closed Won" && d.stage !== "Won") return false;
      if (activeTab === "Lost Deals" && d.stage !== "Closed Lost" && d.stage !== "Lost") return false;
      if (activeTab === "Closing This Month") {
        const thisMonth = new Date().toISOString().slice(0, 7);
        if (!(d.close_date || d.expected_close_date || "").startsWith(thisMonth)) return false;
      }

      // Stage dropdown filter
      if (selectedStage !== "ALL") {
        const dStage = (d.stage || "").toLowerCase();
        const sel = selectedStage.toLowerCase();
        if (dStage !== sel) return false;
      }

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          d.title.toLowerCase().includes(q) ||
          (d.company_name && d.company_name.toLowerCase().includes(q)) ||
          (d.contact_name && d.contact_name.toLowerCase().includes(q))
        );
      }
      return true;
    });

    // Ensure each deal with a unique id is preserved
    const seen = new Set<string>();
    const uniqueDeals: Deal[] = [];
    for (const d of rawFiltered) {
      const dealKey = String(d.id);
      if (seen.has(dealKey)) continue;
      seen.add(dealKey);
      uniqueDeals.push(d);
    }

    return uniqueDeals;
  }, [deals, activeTab, selectedStage, searchQuery]);

  // Stage options for the filter dropdown
  const stageFilterOptions = useMemo(() => {
    return pipelineStages.map((s) => s.label);
  }, [pipelineStages]);

  return (
    <div className="flex h-screen bg-[#F8FAFC] dark:bg-[#0b0f19] text-slate-900 dark:text-slate-100 font-sans overflow-hidden select-none">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Header />

        <main className="flex-1 overflow-y-auto p-4 lg:p-6 space-y-4 custom-scrollbar bg-[#F8FAFC] dark:bg-[#0b0f19]">
          {/* Controls: Responsive Row Above Board (Single row on wide screens, wraps cleanly on laptops without clipping) */}
          <div className="flex flex-wrap 2xl:flex-nowrap items-center justify-between gap-2 pb-2.5 shrink-0">
            {/* Left: Navigation Tabs + More Views (···) */}
            <div className="flex items-center gap-1 sm:gap-1.5 text-xs sm:text-sm shrink-0 overflow-x-auto max-w-full scrollbar-none">
              {PRIMARY_DEAL_TABS.map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={(e) => {
                    setActiveTab(tab);
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

              {/* Extended Tab (Closing This Month): visible on 2xl large screens or when currently active */}
              <button
                key={EXTENDED_DEAL_TAB}
                type="button"
                onClick={(e) => {
                  setActiveTab(EXTENDED_DEAL_TAB);
                  e.currentTarget.blur();
                }}
                className={`px-2 sm:px-2.5 xl:px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer whitespace-nowrap text-xs xl:text-sm outline-none! focus:outline-none! focus-visible:outline-none! ring-0! focus:ring-0! focus-visible:ring-0! border select-none items-center gap-1.5 ${
                  activeTab === EXTENDED_DEAL_TAB ? "inline-flex" : "hidden 2xl:inline-flex"
                } ${
                  activeTab === EXTENDED_DEAL_TAB
                    ? "bg-red-50 text-red-600 font-bold border-red-200/80 shadow-2xs"
                    : "border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                }`}
                style={{ outline: "none", boxShadow: activeTab === EXTENDED_DEAL_TAB ? undefined : "none" }}
              >
                <span>{EXTENDED_DEAL_TAB}</span>
              </button>

              {/* More Views Dropdown (···) */}
              <MoreViewsDropdown
                views={DEALS_MORE_VIEWS}
                activeView={activeTab}
                onSelect={(view) => {
                  setActiveTab(view);
                }}
              />
            </div>

            {/* Right Actions: [Stage ▾] [Add Deal ▾] [Export] [Pipeline Stages Settings] */}
            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 flex-wrap sm:flex-nowrap">
              {/* Search Toggle */}
              {showSearchInput ? (
                <div className="relative flex items-center">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 pointer-events-none" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search deals..."
                    autoFocus
                    className="w-36 sm:w-44 md:w-52 pl-9 pr-8 h-9 text-xs sm:text-sm bg-white border border-slate-200 rounded-xl focus:border-red-500 outline-none shadow-2xs"
                  />
                  <button
                    onClick={() => {
                      setSearchQuery("");
                      setShowSearchInput(false);
                    }}
                    className="absolute right-2 text-slate-400 hover:text-slate-600"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowSearchInput(true)}
                  className="h-9 w-9 p-0 flex items-center justify-center bg-white border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50 rounded-xl text-xs sm:text-sm font-semibold shadow-2xs transition-colors cursor-pointer shrink-0"
                  title="Search Deals"
                >
                  <Search className="w-4 h-4" />
                </button>
              )}

              {/* Custom Stage Dropdown */}
              <FilterSelect
                placeholder="Stage"
                value={selectedStage}
                options={stageFilterOptions}
                onChange={(val) => {
                  setSelectedStage(val);
                }}
                className="shrink-0 [&>button]:h-9 [&>button]:py-0 [&>button]:px-2 sm:[&>button]:px-2.5 xl:[&>button]:px-3 [&>button]:text-xs sm:[&>button]:text-sm"
              />

              {/* Right Action Buttons */}
              <button
                onClick={() => setShowAddDrawer(true)}
                className="h-9 px-2.5 sm:px-3 xl:px-3.5 bg-red-600 hover:bg-red-700 text-white text-xs sm:text-sm font-semibold rounded-xl shadow-xs transition-all cursor-pointer flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <Plus className="w-4 h-4" />
                <span>Add Deal</span>
              </button>

              <button
                onClick={handleExportCsv}
                className="h-9 px-2.5 sm:px-3 xl:px-3.5 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-xl text-xs sm:text-sm font-semibold shadow-2xs transition-colors cursor-pointer flex items-center justify-center shrink-0 whitespace-nowrap"
              >
                Export
              </button>

              {/* Kanban Pipeline Stages Settings Button */}
              <button
                type="button"
                onClick={() => setShowStagesModal(true)}
                title="Customize Pipeline Stages"
                className="h-9 w-9 p-0 bg-white border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50 rounded-xl text-xs sm:text-sm font-semibold shadow-2xs transition-colors cursor-pointer flex items-center justify-center shrink-0"
              >
                <SlidersHorizontal className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* KANBAN BOARD VIEW (Strictly Kanban: Independent Columns, Red Theme, Horizontal Board Scroll, Individual Column Scroll) */}
          <div className="w-full overflow-x-auto pb-4 pt-1 scrollbar-thin scrollbar-thumb-slate-200">
            <div className="flex items-start gap-4 min-w-max">
              {pipelineStages.map((st, colIndex) => {
                const stageDeals = filteredDeals.filter((d) => {
                  const ds = (d.stage || (d as any).stage_id || "").trim().toLowerCase();
                  const sl = st.label.trim().toLowerCase();
                  const si = st.id.trim().toLowerCase();
                  if (ds === sl || ds === si) return true;
                  if (sl.includes("discovery") && ds.includes("discovery")) return true;
                  if (sl.includes("proposal") && (ds.includes("proposal") || ds.includes("quote"))) return true;
                  if (sl.includes("negotiat") && ds.includes("negotiat")) return true;
                  if (sl.includes("won") && (ds.includes("won") || ds.includes("customer"))) return true;
                  if (sl.includes("lost") && (ds.includes("lost") || ds.includes("disqualif"))) return true;
                  if ((sl.includes("new") || sl.includes("lead")) && (ds.includes("new") || ds.includes("lead"))) return true;

                  // Catch-all: If colIndex is 0 (first column) and deal does not match any other column, show it here
                  if (colIndex === 0) {
                    const matchesOther = pipelineStages.some((otherSt, idx) => {
                      if (idx === 0) return false;
                      const osl = otherSt.label.trim().toLowerCase();
                      const osi = otherSt.id.trim().toLowerCase();
                      if (ds === osl || ds === osi) return true;
                      if (osl.includes("discovery") && ds.includes("discovery")) return true;
                      if (osl.includes("proposal") && (ds.includes("proposal") || ds.includes("quote"))) return true;
                      if (osl.includes("negotiat") && ds.includes("negotiat")) return true;
                      if (osl.includes("won") && (ds.includes("won") || ds.includes("customer"))) return true;
                      if (osl.includes("lost") && (ds.includes("lost") || ds.includes("disqualif"))) return true;
                      if ((osl.includes("new") || osl.includes("lead")) && (ds.includes("new") || ds.includes("lead"))) return true;
                      return false;
                    });
                    if (!matchesOther) return true;
                  }

                  return false;
                });
                const stageTotalValue = stageDeals.reduce((sum, d) => sum + (d.value || d.deal_value || 0), 0);

                return (
                  <div
                    key={st.id || colIndex}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const dealId = e.dataTransfer.getData("dealId");
                      if (dealId) handleStageChange(dealId, st.label);
                    }}
                    className="w-[280px] shrink-0 bg-white rounded-2xl border border-slate-200 shadow-xs flex flex-col h-[calc(100vh-215px)] min-h-[500px] max-h-[700px] transition-all"
                  >
                    {/* Column Header: [Dot] [Grip] [Title] [Count Pill] */}
                    <div className="p-3.5 border-b border-slate-100 flex items-center justify-between select-none shrink-0 bg-white rounded-t-2xl">
                      <div className="flex items-center gap-2">
                        <span className={`w-2.5 h-2.5 rounded-full ${st.dot || "bg-slate-500"} shrink-0`} />
                        <GripVertical className="w-3.5 h-3.5 text-slate-300" />
                        <div>
                          <h3 className="text-[13px] font-bold text-slate-800 tracking-tight truncate max-w-[140px]">
                            {st.label}
                          </h3>
                          <p className="text-[10px] text-slate-400 font-medium">{formatCurrency(stageTotalValue)}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="w-5 h-5 rounded-full bg-slate-100 text-slate-600 text-[11px] font-semibold flex items-center justify-center">
                          {stageDeals.length}
                        </span>
                      </div>
                    </div>

                    {/* Column Body: Individual Vertical Scrollbar */}
                    <div className="flex-1 p-3 space-y-2.5 overflow-y-auto custom-scrollbar flex flex-col">
                      {stageDeals.length === 0 ? (
                        <div className="min-h-[140px] border-2 border-dashed border-slate-200/80 rounded-xl flex items-center justify-center text-slate-400 text-xs font-normal select-none">
                          Drop deal here
                        </div>
                      ) : (
                        stageDeals.map((deal) => {
                          const contactInfo = getDealContactDetails(deal);
                          const displayContactName = contactInfo.name || deal.contact_name;
                          const displayCompanyName =
                            deal.company_name && deal.company_name !== "Enterprise Account"
                              ? deal.company_name
                              : contactInfo.name
                              ? `${contactInfo.name}'s Account`
                              : deal.company_name || "Enterprise Account";

                          return (
                            <div
                              key={deal.id}
                              draggable
                              onDragStart={(e) => e.dataTransfer.setData("dealId", String(deal.id))}
                              onClick={() => setSelectedDealForDetails(deal)}
                              className="border border-slate-200/80 rounded-xl shadow-xs hover:shadow-md transition-shadow p-3.5 bg-white cursor-grab active:cursor-grabbing space-y-2.5 group shrink-0"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <h4 className="font-medium text-slate-800 text-sm group-hover:text-red-600 transition-colors leading-snug truncate">
                                    {deal.title}
                                  </h4>
                                  <p className="text-xs text-slate-500 truncate mt-0.5">
                                    {displayCompanyName}
                                    {displayContactName ? ` • ${displayContactName}` : ""}
                                  </p>
                                </div>
                                <span className="text-[10px] font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full shrink-0">
                                  {deal.probability || st.probability || 50}%
                                </span>
                              </div>

                              <div className="flex items-center justify-between text-xs pt-1">
                                <span className="text-slate-900 font-semibold text-sm">
                                  {formatCurrency(deal.value || deal.deal_value || 0)}
                                </span>
                                <span className="text-[11px] text-slate-500 font-medium">
                                  Due: {deal.close_date || deal.expected_close_date || "Open"}
                                </span>
                              </div>

                              {/* Owner & Stage Progress */}
                              <div className="flex items-center justify-between text-[11px] text-slate-500 pt-0.5">
                                <span className="flex items-center gap-1.5 truncate">
                                  <span className="w-5 h-5 rounded-full bg-red-100 text-red-700 text-[10px] font-bold flex items-center justify-center shrink-0">
                                    {(displayContactName || displayCompanyName || "A").substring(0, 1).toUpperCase()}
                                  </span>
                                  <span className="truncate">{displayContactName || "Assigned Agent"}</span>
                                </span>
                                <span className="text-[10px] font-semibold text-slate-400">
                                  {deal.probability || st.probability || 30}%
                                </span>
                              </div>

                              <div className="w-full bg-slate-100 rounded-full h-1 overflow-hidden">
                                <div
                                  className="bg-red-600 h-1 rounded-full"
                                  style={{ width: `${deal.probability || st.probability || 30}%` }}
                                />
                              </div>

                              {/* Card Footer: One-Click Communication (WhatsApp, Call, Email) + Stage Navigation */}
                              <div
                                className="flex items-center justify-between pt-2.5 border-t border-slate-100 text-xs"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {/* One-Click Action Buttons */}
                                <div className="flex items-center gap-1.5">
                                  {/* 1. WhatsApp Button */}
                                  <button
                                    type="button"
                                    onClick={(e) => handleDealWhatsApp(e, deal)}
                                    className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-emerald-600 bg-emerald-50 hover:bg-emerald-600 hover:text-white active:scale-95 transition-all shadow-2xs cursor-pointer border border-emerald-200/60"
                                    title={
                                      contactInfo.phone
                                        ? `WhatsApp ${displayContactName || displayCompanyName} (${contactInfo.phone})`
                                        : "WhatsApp (No phone number)"
                                    }
                                  >
                                    <WhatsAppIcon className="w-3.5 h-3.5 fill-current" />
                                  </button>

                                  {/* 2. Direct Call Button */}
                                  <button
                                    type="button"
                                    onClick={(e) => handleDealCall(e, deal)}
                                    className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-blue-600 bg-blue-50 hover:bg-blue-600 hover:text-white active:scale-95 transition-all shadow-2xs cursor-pointer border border-blue-200/60"
                                    title={
                                      contactInfo.phone
                                        ? `Call ${displayContactName || displayCompanyName} (${contactInfo.phone})`
                                        : "Call (No phone number)"
                                    }
                                  >
                                    <Phone className="w-3.5 h-3.5" />
                                  </button>

                                  {/* 3. Email Button */}
                                  <button
                                    type="button"
                                    onClick={(e) => handleDealEmail(e, deal)}
                                    className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-rose-600 bg-rose-50 hover:bg-rose-600 hover:text-white active:scale-95 transition-all shadow-2xs cursor-pointer border border-rose-200/60"
                                    title={
                                      contactInfo.email
                                        ? `Email ${displayContactName || displayCompanyName} (${contactInfo.email})`
                                        : "Email (No email address)"
                                    }
                                  >
                                    <Mail className="w-3.5 h-3.5" />
                                  </button>
                                </div>

                                {/* Stage Move Arrows */}
                                <div className="flex items-center gap-1">
                                  {colIndex > 0 && (
                                    <button
                                      type="button"
                                      onClick={() => handleStageChange(deal.id, pipelineStages[colIndex - 1].label)}
                                      className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-md transition-colors cursor-pointer"
                                      title={`Move back to ${pipelineStages[colIndex - 1].label}`}
                                    >
                                      <ArrowLeft className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                  {colIndex < pipelineStages.length - 1 && (
                                    <button
                                      type="button"
                                      onClick={() => handleStageChange(deal.id, pipelineStages[colIndex + 1].label)}
                                      className="p-1 text-red-600 hover:bg-red-50 rounded-md transition-colors cursor-pointer"
                                      title={`Advance to ${pipelineStages[colIndex + 1].label}`}
                                    >
                                      <ArrowRight className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </main>
      </div>

      {/* Add Deal Slide-Over Drawer */}
      <NewDealDrawer
        isOpen={showAddDrawer}
        onClose={() => setShowAddDrawer(false)}
        onSubmit={handleCreateDealDrawer}
        customFields={customFields}
        stages={pipelineStages.map((s) => s.label)}
      />

      {/* Deal Details Overview Drawer */}
      <DealDetailsDrawer
        deal={selectedDealForDetails}
        isOpen={!!selectedDealForDetails}
        onClose={() => setSelectedDealForDetails(null)}
        stages={pipelineStages.map((s) => s.label)}
        onStageChange={async (dealId, newStage) => {
          await handleStageChange(dealId, newStage);
          setSelectedDealForDetails((prev) => (prev ? { ...prev, stage: newStage as any } : null));
        }}
        onDelete={async (dealId) => {
          setSelectedDealForDetails(null);
          await handleDelete(dealId);
        }}
      />

      {/* Manage Custom Fields Modal */}
      <ManageCustomFieldsModal
        entityType="DEAL"
        isOpen={showCustomFields}
        onClose={() => setShowCustomFields(false)}
        onFieldsChanged={() => {
          loadCustomFields();
          loadDeals();
        }}
      />

      {/* Pipeline Stages Settings Modal */}
      <PipelineStagesModal
        isOpen={showStagesModal}
        onClose={() => setShowStagesModal(false)}
        stages={pipelineStages}
        onSave={(newStages) => {
          setPipelineStages(newStages);
        }}
      />
    </div>
  );
}
