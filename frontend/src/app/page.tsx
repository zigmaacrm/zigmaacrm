"use client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import {
  Users,
  TrendingUp,
  AlertTriangle,
  Clock,
  Calendar,
  CheckCircle2,
  ChevronDown,
  Phone,
  MessageSquare,
  Mail,
  ChevronRight,
  Plus,
  Trash2,
  ExternalLink,
  Briefcase,
  Share2,
  Globe,
  Megaphone,
  CheckSquare,
  Square,
  ArrowUpRight,
  RefreshCw,
  Sparkles,
  PhoneCall
} from "lucide-react";
import Sidebar from "@/components/layout/Sidebar";
import Header from "@/components/layout/Header";
import ContactSlideDrawer from "@/components/contacts/ContactSlideDrawer";
import NewTaskDrawer from "@/components/tasks/NewTaskDrawer";
import { api } from "@/lib/api";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Contact, Task } from "@/lib/mockData";
import { useToast } from "@/components/common/ToastProvider";

interface DashboardMetrics {
  range_type: string;
  total_leads: number;
  all_time_leads: number;
  today_leads: number;
  pipeline_value: number;
  active_deals_count: number;
  won_revenue: number;
  won_deals_count: number;
  conversion_rate: number;
  pending_followups: number;
  source_breakdown: Array<{ source: string; count: number; percentage: number }>;
  stage_breakdown: Array<{ title: string; count: number; value: number; color?: string }>;
  recent_leads: Array<{
    id: string;
    full_name: string;
    email?: string;
    phone?: string;
    company_name?: string;
    source?: string;
    lifecycle_stage?: string;
    created_at?: string;
  }>;
  today_due_tasks: Array<{
    id: string | number;
    title: string;
    activity_type?: string;
    due_date?: string;
    due_time?: string;
    priority?: string;
    status?: string;
    contact_name?: string;
    contact_id?: string;
  }>;
}

export default function DashboardPage() {
  const { toast } = useToast();
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState("Last 30 Days");
  const [showDateDropdown, setShowDateDropdown] = useState(false);

  // Drawers
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [showAddTaskDrawer, setShowAddTaskDrawer] = useState(false);

  // Local task completion toggle
  const [completedTasks, setCompletedTasks] = useState<Set<string | number>>(new Set());

  // User details & live clock state
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [activeRole, setActiveRole] = useState<string>("ADMIN");
  const [currentTime, setCurrentTime] = useState<Date | null>(null);

  useEffect(() => {
    // Initialize live running clock
    setCurrentTime(new Date());
    const clockTimer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    // Sync logged-in user profile & active role
    if (typeof window !== "undefined") {
      setActiveRole(api.getActiveRole());
      const loadUser = () => {
        const u = api.getCurrentUser();
        if (u) setCurrentUser(u);
      };
      loadUser();
      api.getMe().then((me) => {
        if (me) setCurrentUser(me);
      }).catch(() => {});
      window.addEventListener("zigmaa_user_updated", loadUser);
      window.addEventListener("zigmaa_role_changed", () => {
        setActiveRole(api.getActiveRole());
      });
      window.addEventListener("storage", loadUser);

      return () => {
        clearInterval(clockTimer);
        window.removeEventListener("zigmaa_user_updated", loadUser);
        window.removeEventListener("storage", loadUser);
      };
    }

    return () => clearInterval(clockTimer);
  }, []);

  const getGreeting = () => {
    if (!currentTime) return "Good day";
    const hour = currentTime.getHours();
    if (hour >= 5 && hour < 12) return "Good morning";
    if (hour >= 12 && hour < 17) return "Good afternoon";
    return "Good evening";
  };

  const getUserDisplayName = () => {
    let rawName = "";
    if (currentUser?.full_name) {
      rawName = currentUser.full_name;
    } else if (currentUser?.name) {
      rawName = currentUser.name;
    } else if (activeRole === "SALES_REP") {
      rawName = "Sarah Jenkins";
    } else {
      rawName = "Alexander Vance";
    }
    // Cleanly strip any trailing role in parentheses e.g. "(Admin)" or "(Sales Rep)"
    return rawName.replace(/\s*[\(\[][^)]*[\)\]]/gi, "").trim();
  };

  const formattedDate = useMemo(() => {
    if (!currentTime) return "";
    return currentTime.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "short",
      day: "numeric"
    });
  }, [currentTime]);

  const formattedTime = useMemo(() => {
    if (!currentTime) return "";
    return currentTime.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true
    });
  }, [currentTime]);

  const fetchDashboardMetrics = async (range: string) => {
    try {
      setLoading(true);
      const data = await api.getDashboardMetrics(range, true);
      if (data) {
        setMetrics(data);
      }
    } catch (e) {
      console.error("Failed to load dashboard metrics:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardMetrics(dateRange);
  }, [dateRange]);

  // Publish real-time UI context for Zigmaa AI Copilot
  useEffect(() => {
    if (typeof window !== "undefined") {
      (window as any).__ZIGMAA_PAGE_STATE = {
        page: "/",
        screenName: "Dashboard Overview",
        activeTab: "Overview",
        dateRange,
        metricsSummary: metrics
          ? {
              totalLeads: metrics.total_leads,
              todayLeads: metrics.today_leads,
              pipelineValue: metrics.pipeline_value,
              wonRevenue: metrics.won_revenue,
              activeDeals: metrics.active_deals_count,
              pendingFollowups: metrics.pending_followups,
              conversionRate: `${metrics.conversion_rate}%`
            }
          : null,
        recentLeads: metrics?.recent_leads?.slice(0, 5).map((l) => ({
          name: l.full_name,
          company: l.company_name,
          stage: l.lifecycle_stage,
          source: l.source
        })),
        todayTasks: metrics?.today_due_tasks?.slice(0, 5).map((t) => ({
          title: t.title,
          priority: t.priority,
          status: t.status,
          contact: t.contact_name
        }))
      };
    }
  }, [dateRange, metrics]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      if (selectedContact) {
        (window as any).__ZIGMAA_ACTIVE_DRAWER = {
          type: "contact",
          id: selectedContact.id,
          name: selectedContact.name,
          stage: selectedContact.status || selectedContact.lifecycle_stage || "New",
          company: selectedContact.company_name,
          phone: selectedContact.phone,
          email: selectedContact.email
        };
      } else {
        if ((window as any).__ZIGMAA_ACTIVE_DRAWER?.type === "contact") {
          (window as any).__ZIGMAA_ACTIVE_DRAWER = null;
        }
      }
    }
  }, [selectedContact]);

  const handleOpenContact = async (contactSummary: any) => {
    try {
      const fullContact = await api.getContactDetail(contactSummary.id);
      if (fullContact) {
        setSelectedContact(fullContact);
        return;
      }
    } catch {}
    // Fallback object matching Contact interface
    setSelectedContact({
      id: contactSummary.id,
      name: contactSummary.full_name,
      email: contactSummary.email || "",
      phone: contactSummary.phone || "",
      company_name: contactSummary.company_name || "",
      status: contactSummary.lifecycle_stage || "NEW",
      source: contactSummary.source || "MANUAL",
      created_at: contactSummary.created_at || new Date().toISOString()
    } as any);
  };

  const handleToggleTask = async (taskId: string | number) => {
    const isCompleted = completedTasks.has(taskId);
    const next = new Set(completedTasks);
    if (isCompleted) {
      next.delete(taskId);
    } else {
      next.add(taskId);
    }
    setCompletedTasks(next);

    try {
      await api.toggleTaskStatus(taskId);
      toast.success(
        isCompleted ? "Task Reopened" : "Task Completed",
        isCompleted ? "Task marked as pending" : "Task marked as completed"
      );
    } catch (e) {
      // Revert if API fails
      setCompletedTasks(completedTasks);
      toast.error("Error", "Could not update task status");
    }
  };

  // Deduplicate and aggregate sources into clean, unique categories without repetitions
  const deduplicatedSources = useMemo(() => {
    if (!metrics?.source_breakdown) return [];

    const map = new Map<string, { label: string; count: number }>();

    for (const item of metrics.source_breakdown) {
      if (!item.count || item.count <= 0) continue;
      const s = (item.source || "").toUpperCase().replace(/[-_]/g, " ");
      let canon = "Manual";
      if (s.includes("META") || s.includes("FACEBOOK") || s.includes("INSTAGRAM")) {
        canon = "Meta Ads";
      } else if (s.includes("GOOGLE")) {
        canon = "Google Ads";
      } else if (s.includes("WHATSAPP")) {
        canon = "WhatsApp";
      } else if (s.includes("WEB") || s.includes("FORM")) {
        canon = "Website Form";
      } else if (s.includes("CSV") || s.includes("EXCEL") || s.includes("IMPORT")) {
        canon = "Excel / CSV Import";
      } else if (s.includes("REFERRAL")) {
        canon = "Referral";
      } else if (s.includes("COLD") || s.includes("OUTREACH")) {
        canon = "Cold Outreach";
      } else if (s.includes("LINKEDIN")) {
        canon = "LinkedIn Ads";
      } else if (s.includes("YOUTUBE")) {
        canon = "YouTube";
      } else {
        canon = item.source?.trim() || "Manual";
      }

      const existing = map.get(canon);
      if (existing) {
        existing.count += item.count;
      } else {
        map.set(canon, { label: canon, count: item.count });
      }
    }

    const total = Array.from(map.values()).reduce((acc, curr) => acc + curr.count, 0) || metrics.total_leads || 1;

    return Array.from(map.values())
      .sort((a, b) => b.count - a.count)
      .map((item) => ({
        source: item.label,
        count: item.count,
        percentage: Math.round((item.count / total) * 1000) / 10
      }));
  }, [metrics?.source_breakdown, metrics?.total_leads]);

  // Helper for source icon & styling
  const getSourceMeta = (source: string) => {
    const s = (source || "").toUpperCase();
    if (s.includes("META") || s.includes("FACEBOOK") || s.includes("INSTAGRAM")) {
      return { label: "Meta Ads", icon: Megaphone, color: "bg-blue-500", text: "text-blue-600", bg: "bg-blue-50" };
    }
    if (s.includes("WEBSITE") || s.includes("FORM") || s.includes("WEB")) {
      return { label: "Website Form", icon: Share2, color: "bg-emerald-500", text: "text-emerald-600", bg: "bg-emerald-50" };
    }
    if (s.includes("GOOGLE")) {
      return { label: "Google Ads", icon: Globe, color: "bg-amber-500", text: "text-amber-600", bg: "bg-amber-50" };
    }
    if (s.includes("WHATSAPP")) {
      return { label: "WhatsApp", icon: MessageSquare, color: "bg-emerald-600", text: "text-emerald-600", bg: "bg-emerald-50" };
    }
    if (s.includes("CSV") || s.includes("EXCEL") || s.includes("IMPORT")) {
      return { label: "Excel / CSV Import", icon: Users, color: "bg-indigo-500", text: "text-indigo-600", bg: "bg-indigo-50" };
    }
    if (s.includes("REFERRAL")) {
      return { label: "Referral", icon: Users, color: "bg-purple-500", text: "text-purple-600", bg: "bg-purple-50" };
    }
    if (s.includes("COLD")) {
      return { label: "Cold Outreach", icon: Phone, color: "bg-cyan-500", text: "text-cyan-600", bg: "bg-cyan-50" };
    }
    return { label: source || "Manual", icon: Users, color: "bg-slate-500", text: "text-slate-600", bg: "bg-slate-50" };
  };

  // Helper for task activity icon
  const getActivityIcon = (type?: string) => {
    switch (type) {
      case "Call":
        return "📞";
      case "WhatsApp":
        return "💬";
      case "Email":
        return "📧";
      case "Meeting":
        return "🤝";
      default:
        return "📝";
    }
  };

  return (
    <div className="flex h-screen bg-[#F8FAFC] dark:bg-[#0b0f19] text-slate-900 dark:text-slate-100 font-sans overflow-hidden select-none">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Header />

        <main className="flex-1 overflow-y-auto p-4 lg:p-6 space-y-5 pb-6 custom-scrollbar bg-[#F8FAFC] dark:bg-[#0b0f19]">
          {/* Dynamic Greeting & Live Clock Header Controls */}
          <div className="flex flex-wrap items-center justify-between gap-4 pb-1">
            <div>
              <h1 className="text-xl lg:text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
                <span>
                  {getGreeting()}, <span className="text-red-600 dark:text-rose-500">{getUserDisplayName()}</span>
                </span>
              </h1>
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400 font-medium mt-1">
                <span className="flex items-center gap-1.5 font-medium">
                  <Calendar className="w-3.5 h-3.5 text-slate-400" />
                  <span>{formattedDate || "Today"}</span>
                </span>
                <span className="text-slate-300 dark:text-slate-700 font-bold">•</span>
                <span className="flex items-center gap-1.5 font-semibold text-slate-700 dark:text-slate-200 font-mono">
                  <Clock className="w-3.5 h-3.5 text-red-600 dark:text-rose-400 animate-pulse" />
                  <span suppressHydrationWarning>{formattedTime || "--:--:--"}</span>
                </span>
                <span className="text-slate-300 dark:text-slate-700 font-bold">•</span>
                <span>Real-time CRM metrics & revenue pipeline</span>
              </div>
            </div>

            {/* Actions: Date Range Selector + Refresh */}
            <div className="flex items-center gap-2.5">
              <button
                onClick={() => fetchDashboardMetrics(dateRange)}
                disabled={loading}
                title="Refresh Metrics"
                className="p-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-xl shadow-2xs transition-all cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin text-red-600" : ""}`} />
              </button>

              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowDateDropdown(!showDateDropdown)}
                  className="flex items-center gap-2 px-3.5 py-2 bg-white border border-slate-200 hover:border-slate-300 text-slate-700 rounded-xl text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
                >
                  <Calendar className="w-3.5 h-3.5 text-slate-400" />
                  <span>{dateRange}</span>
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                </button>

                {showDateDropdown && (
                  <div className="absolute right-0 mt-2 w-44 bg-white rounded-xl shadow-lg border border-slate-200 py-1.5 z-40 text-xs">
                    {["Today", "Yesterday", "Last 7 Days", "Last 30 Days", "This Month", "All Time"].map((range) => (
                      <button
                        key={range}
                        onClick={() => {
                          setDateRange(range);
                          setShowDateDropdown(false);
                        }}
                        className="w-full text-left px-3.5 py-2 text-slate-700 hover:bg-slate-50 flex items-center justify-between cursor-pointer"
                      >
                        <span>{range}</span>
                        {dateRange === range && <span className="text-red-600 font-bold">✓</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <button
                onClick={() => setShowAddTaskDrawer(true)}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-semibold shadow-xs transition-all cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Task</span>
              </button>
            </div>
          </div>

          {/* 1. TOP 4 HIGH-IMPACT KPI CARDS */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Card 1: Total Leads */}
            <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-xs flex flex-col justify-between hover:shadow-md transition-shadow relative overflow-hidden border-t-[3px] border-t-blue-500">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase text-slate-400 tracking-wider">
                  Total Leads
                </span>
                <div className="p-2 rounded-xl bg-blue-50 text-blue-600">
                  <Users className="w-4.5 h-4.5" />
                </div>
              </div>
              <div className="mt-3">
                <div className="text-2xl lg:text-3xl font-bold text-slate-900 tracking-tight">
                  {loading ? (
                    <div className="h-8 w-16 bg-slate-100 rounded-md animate-pulse" />
                  ) : (
                    metrics?.total_leads ?? 0
                  )}
                </div>
                <div className="flex items-center gap-1.5 mt-2">
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                    +{metrics?.today_leads ?? 0} today
                  </span>
                  <span className="text-[11px] text-slate-400">
                    ({metrics?.all_time_leads ?? 0} all-time)
                  </span>
                </div>
              </div>
            </div>

            {/* Card 2: Active Pipeline Value */}
            <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-xs flex flex-col justify-between hover:shadow-md transition-shadow relative overflow-hidden border-t-[3px] border-t-amber-500">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase text-slate-400 tracking-wider">
                  Active Pipeline Value
                </span>
                <div className="p-2 rounded-xl bg-amber-50 text-amber-600">
                  <Briefcase className="w-4.5 h-4.5" />
                </div>
              </div>
              <div className="mt-3">
                <div className="text-2xl lg:text-3xl font-bold text-slate-900 tracking-tight">
                  {loading ? (
                    <div className="h-8 w-24 bg-slate-100 rounded-md animate-pulse" />
                  ) : (
                    formatCurrency(metrics?.pipeline_value ?? 0)
                  )}
                </div>
                <div className="flex items-center gap-1.5 mt-2">
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                    {metrics?.active_deals_count ?? 0} active deals
                  </span>
                  <span className="text-[11px] text-slate-400">in progression</span>
                </div>
              </div>
            </div>

            {/* Card 3: Closed Won Revenue */}
            <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-xs flex flex-col justify-between hover:shadow-md transition-shadow relative overflow-hidden border-t-[3px] border-t-emerald-500">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase text-slate-400 tracking-wider">
                  Closed Revenue
                </span>
                <div className="p-2 rounded-xl bg-emerald-50 text-emerald-600">
                  <TrendingUp className="w-4.5 h-4.5" />
                </div>
              </div>
              <div className="mt-3">
                <div className="text-2xl lg:text-3xl font-bold text-slate-900 tracking-tight">
                  {loading ? (
                    <div className="h-8 w-24 bg-slate-100 rounded-md animate-pulse" />
                  ) : (
                    formatCurrency(metrics?.won_revenue ?? 0)
                  )}
                </div>
                <div className="flex items-center gap-1.5 mt-2">
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                    {metrics?.conversion_rate ?? 0}% win rate
                  </span>
                  <span className="text-[11px] text-slate-400">
                    ({metrics?.won_deals_count ?? 0} won)
                  </span>
                </div>
              </div>
            </div>

            {/* Card 4: Pending Follow-ups */}
            <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-xs flex flex-col justify-between hover:shadow-md transition-shadow relative overflow-hidden border-t-[3px] border-t-rose-500">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase text-slate-400 tracking-wider">
                  Pending Follow-ups
                </span>
                <div className="p-2 rounded-xl bg-rose-50 text-rose-600">
                  <AlertTriangle className="w-4.5 h-4.5" />
                </div>
              </div>
              <div className="mt-3">
                <div className="text-2xl lg:text-3xl font-bold text-slate-900 tracking-tight">
                  {loading ? (
                    <div className="h-8 w-16 bg-slate-100 rounded-md animate-pulse" />
                  ) : (
                    metrics?.pending_followups ?? 0
                  )}
                </div>
                <div className="flex items-center gap-1.5 mt-2">
                  {(metrics?.pending_followups ?? 0) > 0 ? (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                      Needs action
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-50 text-slate-600 border border-slate-200">
                      All caught up
                    </span>
                  )}
                  <span className="text-[11px] text-slate-400">due or overdue</span>
                </div>
              </div>
            </div>
          </div>

          {/* 2. MIDDLE SECTION: PIPELINE STAGES & SOURCE BREAKDOWN */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            {/* Left: Pipeline Stage Distribution (8 Cols) */}
            <div className="lg:col-span-8 p-5 lg:p-6 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Pipeline Stage Distribution</h3>
                  <p className="text-xs text-slate-500 font-medium">
                    Deal value and volume progression across pipeline stages
                  </p>
                </div>
                <Link
                  href="/pipeline"
                  className="flex items-center gap-1 text-xs font-semibold text-red-600 hover:underline"
                >
                  <span>Deals Board</span>
                  <ArrowUpRight className="w-3.5 h-3.5" />
                </Link>
              </div>

              {loading ? (
                <div className="space-y-3 py-4">
                  {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="h-9 bg-slate-50 rounded-xl animate-pulse" />
                  ))}
                </div>
              ) : (() => {
                const activeStages = (metrics?.stage_breakdown || []).filter((s) => (s.count || 0) > 0);
                if (activeStages.length === 0) {
                  return (
                    <div className="py-8 text-center text-xs text-slate-400">
                      No active pipeline deals created yet.
                    </div>
                  );
                }
                const maxVal = Math.max(...activeStages.map((s) => s.value || 0), 1);
                return (
                  <div className="space-y-3.5">
                    {activeStages.map((st, idx) => {
                      const widthPct = Math.max(5, Math.min(100, ((st.value || 0) / maxVal) * 100));
                      return (
                        <div key={idx} className="space-y-1.5">
                          <div className="flex items-center justify-between text-xs">
                            <div className="flex items-center gap-2">
                              <span
                                className="w-2.5 h-2.5 rounded-full"
                                style={{ backgroundColor: st.color || "#3b82f6" }}
                              />
                              <span className="font-semibold text-slate-800">{st.title}</span>
                              <span className="text-[11px] text-slate-400 font-medium">
                                ({st.count} {st.count === 1 ? "deal" : "deals"})
                              </span>
                            </div>
                            <span className="font-bold text-slate-900 font-mono">
                              {formatCurrency(st.value)}
                            </span>
                          </div>
                          <div className="h-2.5 w-full bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-500"
                              style={{
                                width: `${widthPct}%`,
                                backgroundColor: st.color || "#3b82f6"
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>

            {/* Right: Lead Source Performance (4 Cols) */}
            <div className="lg:col-span-4 p-5 lg:p-6 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Source Performance</h3>
                  <p className="text-xs text-slate-500 font-medium">Distribution by inbound channel</p>
                </div>
                <Megaphone className="w-4 h-4 text-slate-400" />
              </div>

              {loading ? (
                <div className="space-y-3 py-4">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-9 bg-slate-50 rounded-xl animate-pulse" />
                  ))}
                </div>
              ) : deduplicatedSources.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-400">
                  No inbound sources recorded yet.
                </div>
              ) : (
                <div className="space-y-3">
                  {deduplicatedSources.map((src, idx) => {
                    const meta = getSourceMeta(src.source);
                    const Icon = meta.icon;

                    return (
                      <div key={idx} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-1.5">
                            <Icon className={`w-3.5 h-3.5 ${meta.text}`} />
                            <span className="font-semibold text-slate-700">{meta.label}</span>
                          </div>
                          <span className="font-bold text-slate-900 font-mono">
                            {src.count} ({src.percentage}%)
                          </span>
                        </div>
                        <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full ${meta.color} transition-all duration-500`}
                            style={{ width: `${Math.max(src.percentage, 2)}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* 3. BOTTOM OPERATIONAL FEEDS: RECENT INBOUND LEADS & TODAY'S DUE TASKS */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            {/* Bottom Left: Recent Inbound Leads (7 Cols) */}
            <div className="lg:col-span-7 p-6 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Recent Inbound Leads</h3>
                  <p className="text-xs text-slate-500 font-medium">
                    Latest contacts captured into your database
                  </p>
                </div>
                <Link
                  href="/contacts"
                  className="flex items-center gap-1 text-xs font-semibold text-red-600 hover:underline"
                >
                  <span>View All Contacts</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </Link>
              </div>

              {loading ? (
                <div className="space-y-3 py-4">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <div key={i} className="h-10 bg-slate-50 rounded-xl animate-pulse" />
                  ))}
                </div>
              ) : (metrics?.recent_leads?.length ?? 0) === 0 ? (
                <div className="py-10 text-center text-xs text-slate-400">
                  No contacts found in PostgreSQL yet.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-100 text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                        <th className="py-2 px-2">Contact Name</th>
                        <th className="py-2 px-2">Company</th>
                        <th className="py-2 px-2">Source</th>
                        <th className="py-2 px-2">Stage</th>
                        <th className="py-2 px-2 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {metrics?.recent_leads.map((c) => {
                        const meta = getSourceMeta(c.source || "");

                        return (
                          <tr
                            key={c.id}
                            className="hover:bg-slate-50/80 transition-colors group cursor-pointer"
                            onClick={() => handleOpenContact(c)}
                          >
                            <td className="py-2.5 px-2 font-semibold text-slate-900 flex items-center gap-2">
                              <div className="w-6 h-6 rounded-full bg-slate-100 border border-slate-200 text-slate-700 flex items-center justify-center font-bold text-[10px] shrink-0">
                                {c.full_name?.charAt(0)?.toUpperCase() || "C"}
                              </div>
                              <span className="truncate max-w-[130px] group-hover:text-red-600 transition-colors">
                                {c.full_name}
                              </span>
                            </td>
                            <td className="py-2.5 px-2 text-slate-600 truncate max-w-[110px]">
                              {c.company_name || "—"}
                            </td>
                            <td className="py-2.5 px-2">
                              <span
                                className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${meta.bg} ${meta.text}`}
                              >
                                {meta.label}
                              </span>
                            </td>
                            <td className="py-2.5 px-2">
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600">
                                {c.lifecycle_stage || "NEW"}
                              </span>
                            </td>
                            <td className="py-2.5 px-2 text-right">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleOpenContact(c);
                                }}
                                className="p-1 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                                title="Open Drawer"
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Bottom Right: Today's Due Tasks (5 Cols) */}
            <div className="lg:col-span-5 p-6 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Today's Due Tasks</h3>
                  <p className="text-xs text-slate-500 font-medium">
                    Immediate action checklist for your day
                  </p>
                </div>
                <Link
                  href="/tasks"
                  className="flex items-center gap-1 text-xs font-semibold text-red-600 hover:underline"
                >
                  <span>All Tasks</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </Link>
              </div>

              {loading ? (
                <div className="space-y-3 py-4">
                  {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="h-10 bg-slate-50 rounded-xl animate-pulse" />
                  ))}
                </div>
              ) : (metrics?.today_due_tasks?.length ?? 0) === 0 ? (
                <div className="py-10 text-center space-y-2">
                  <div className="w-10 h-10 rounded-full bg-emerald-50 text-emerald-600 mx-auto flex items-center justify-center">
                    <CheckCircle2 className="w-5 h-5" />
                  </div>
                  <p className="text-xs font-semibold text-slate-700">No overdue tasks!</p>
                  <p className="text-[11px] text-slate-400">You are all caught up for today.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {metrics?.today_due_tasks.map((task) => {
                    const isDone =
                      completedTasks.has(task.id) ||
                      (task.status || "").toUpperCase() === "COMPLETED";

                    return (
                      <div
                        key={task.id}
                        className={`p-3 rounded-xl border transition-all flex items-start gap-2.5 ${
                          isDone
                            ? "bg-slate-50/60 border-slate-200 opacity-60"
                            : "bg-white border-slate-200/90 shadow-2xs hover:border-red-300"
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => handleToggleTask(task.id)}
                          className="mt-0.5 text-slate-400 hover:text-red-600 transition-colors cursor-pointer"
                        >
                          {isDone ? (
                            <CheckSquare className="w-4 h-4 text-emerald-600" />
                          ) : (
                            <Square className="w-4 h-4" />
                          )}
                        </button>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs">{getActivityIcon(task.activity_type)}</span>
                            <h4
                              className={`text-xs font-bold truncate leading-tight ${
                                isDone ? "line-through text-slate-400" : "text-slate-900"
                              }`}
                            >
                              {task.title}
                            </h4>
                          </div>

                          <div className="flex items-center gap-2 text-[10px] text-slate-500 mt-1">
                            {task.contact_name && (
                              <span className="font-medium text-slate-700 truncate max-w-[110px]">
                                {task.contact_name}
                              </span>
                            )}
                            {task.due_date && (
                              <span className="font-mono text-slate-400">
                                {task.due_date} {task.due_time || ""}
                              </span>
                            )}
                            <span
                              className={`px-1.5 py-0.2 rounded font-bold ${
                                task.priority === "Urgent" || task.priority === "High"
                                  ? "bg-rose-50 text-rose-700"
                                  : task.priority === "Medium"
                                  ? "bg-amber-50 text-amber-700"
                                  : "bg-slate-100 text-slate-600"
                              }`}
                            >
                              {task.priority || "Medium"}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </main>
      </div>

      {/* Slide Drawer for Contact Click */}
      <ContactSlideDrawer
        contact={selectedContact}
        isOpen={!!selectedContact}
        onClose={() => setSelectedContact(null)}
      />

      {/* Slide Drawer for Add Task */}
      <NewTaskDrawer
        isOpen={showAddTaskDrawer}
        onClose={() => setShowAddTaskDrawer(false)}
        onSubmit={async (taskData) => {
          await api.createTask(taskData);
          setShowAddTaskDrawer(false);
          fetchDashboardMetrics(dateRange);
        }}
      />
    </div>
  );
}
