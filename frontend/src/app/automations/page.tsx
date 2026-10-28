"use client";

import { useState, useEffect } from "react";
import {
  Zap,
  Plus,
  Play,
  CheckCircle2,
  Clock,
  MessageSquare,
  Mail,
  UserCheck,
  AlertCircle,
  ArrowRight,
  Search,
  X,
  ShieldCheck,
  Sliders,
  Trash2,
  RefreshCw,
  Send,
  Layers,
  CheckSquare,
  Activity,
  History,
  FileText
} from "lucide-react";
import Sidebar from "@/components/layout/Sidebar";
import Header from "@/components/layout/Header";
import NewWorkflowDrawer from "@/components/automations/NewWorkflowDrawer";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import { useToast } from "@/components/common/ToastProvider";

interface WorkflowRule {
  id: string;
  organization_id?: string;
  name: string;
  module: "CONTACT" | "DEAL" | string;
  trigger_event: string;
  conditions?: Record<string, any>;
  actions?: any[];
  is_active: boolean;
  created_at: string;
  updated_at?: string;
  last_executed?: string | null;
  execution_count?: number;
}

interface WorkflowLog {
  id: string;
  workflow_id: string;
  workflow_name?: string;
  entity_id?: string;
  action_type: string;
  status: "SUCCESS" | "FAILED" | string;
  error_message?: string | null;
  executed_at: string;
}

export default function AutomationsPage() {
  const { toast, confirm } = useToast();
  const [workflows, setWorkflows] = useState<WorkflowRule[]>([]);
  const [logs, setLogs] = useState<WorkflowLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingLogs, setLoadingLogs] = useState(false);

  // Navigation Tabs: [ All Workflows | History Logs ]
  const [activeTab, setActiveTab] = useState<"All Workflows" | "History Logs">("All Workflows");
  const [searchQuery, setSearchQuery] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);

  const loadWorkflows = async () => {
    setLoading(true);
    try {
      const data = await api.getWorkflows();
      setWorkflows(data || []);
    } catch (e) {
      console.error(e);
      setWorkflows([]);
    } finally {
      setLoading(false);
    }
  };

  const loadLogs = async () => {
    setLoadingLogs(true);
    try {
      const data = await api.getWorkflowHistory();
      setLogs(data || []);
    } catch (e) {
      console.error(e);
      setLogs([]);
    } finally {
      setLoadingLogs(false);
    }
  };

  useEffect(() => {
    loadWorkflows();
    loadLogs();
  }, []);

  const handleToggle = async (id: string, currentStatus: boolean, name: string) => {
    // Optimistic UI update
    setWorkflows((prev) =>
      prev.map((w) => (w.id === id ? { ...w, is_active: !currentStatus } : w))
    );

    try {
      await api.toggleWorkflow(id);
      toast.info(
        "Workflow Toggled",
        `"${name}" is now ${!currentStatus ? "Active" : "Paused"}.`
      );
    } catch {
      toast.error("Error", "Could not toggle workflow.");
      loadWorkflows();
    }
  };

  const handleDelete = async (id: string, name: string) => {
    const confirmed = await confirm({
      title: "Delete Workflow",
      message: `Are you sure you want to permanently delete the workflow rule "${name}"?`,
      confirmText: "Delete",
      cancelText: "Cancel",
      variant: "danger"
    });

    if (confirmed) {
      setWorkflows((prev) => prev.filter((w) => w.id !== id));
      try {
        await api.deleteWorkflow(id);
        toast.success("Workflow Deleted", `Removed "${name}".`);
      } catch {
        toast.error("Error", "Failed to delete workflow.");
        loadWorkflows();
      }
    }
  };

  const filteredWorkflows = workflows.filter((w) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      w.name.toLowerCase().includes(q) ||
      w.trigger_event.toLowerCase().includes(q) ||
      w.module.toLowerCase().includes(q)
    );
  });

  const getActionBadge = (actions?: any[]) => {
    if (!actions || actions.length === 0) return "General Action";
    const act = actions[0]?.action || "";
    if (act.includes("WHATSAPP")) return "WhatsApp";
    if (act.includes("EMAIL")) return "Email Sync";
    if (act.includes("DEAL")) return "Deals Module";
    if (act.includes("TASK")) return "Task Automation";
    if (act.includes("ASSIGN")) return "Auto-Assign";
    return act;
  };

  const formatTriggerLabel = (event: string) => {
    if (event === "CONTACT_CREATED") return "New Contact / Enquiry Created";
    if (event === "STAGE_CHANGED") return "Deal Stage Changed";
    if (event === "LIFECYCLE_CHANGED") return "Lifecycle Status Updated";
    if (event === "TASK_OVERDUE") return "Task Past Due Date";
    return event.replace(/_/g, " ");
  };

  return (
    <div className="flex h-screen bg-[#F8FAFC] dark:bg-[#0b0f19] text-slate-900 dark:text-slate-100 font-sans overflow-hidden select-none">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Header />

        <main className="flex-1 overflow-y-auto p-4 lg:p-6 space-y-4 custom-scrollbar bg-[#F8FAFC] dark:bg-[#0b0f19]">
          {/* Top Control Bar: Search on left, Refresh + Tabs + Create on right */}
          <div className="flex flex-wrap xl:flex-nowrap items-center justify-between gap-2 pb-2.5 shrink-0">
            {/* Left: Search input filling available space */}
            <div className="relative flex-1 min-w-[200px] sm:min-w-[240px] max-w-md">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search workflows by name or event..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500 shadow-2xs font-medium"
              />
            </div>

            {/* Right: Refresh button (near All Workflows on left), Tabs, and Create Workflow */}
            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 flex-wrap sm:flex-nowrap">
              <button
                type="button"
                onClick={() => {
                  if (activeTab === "History Logs") loadLogs();
                  else loadWorkflows();
                }}
                className="px-3 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 hover:text-slate-900 rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-2xs transition-colors cursor-pointer"
                title="Refresh"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${(activeTab === "History Logs" ? loadingLogs : loading) ? "animate-spin text-red-600" : ""}`} />
                <span>Refresh</span>
              </button>

              {/* Navigation Tabs */}
              <div className="flex items-center gap-1 bg-white p-1 rounded-xl border border-slate-200 shadow-2xs">
                {(["All Workflows", "History Logs"] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setActiveTab(tab)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                      activeTab === tab
                        ? "bg-red-50 text-red-600 shadow-2xs"
                        : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>

              {/* Create Workflow Button */}
              <button
                onClick={() => setShowCreateModal(true)}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-xl shadow-xs transition-all cursor-pointer flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" />
                <span>Create Workflow</span>
              </button>
            </div>
          </div>

          {/* TAB 1: ALL WORKFLOWS (TABLE VIEW) */}
          {activeTab === "All Workflows" && (
            <div className="space-y-4">

              {/* Table Container */}
              <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="bg-slate-50/80 border-b border-slate-200/80 text-xs font-bold text-slate-700 uppercase tracking-wider">
                        <th className="py-3.5 px-4 w-16 text-center border-r border-slate-200/80">Status</th>
                        <th className="px-4 py-3.5 border-r border-slate-200/80">Workflow Name & Module</th>
                        <th className="px-4 py-3.5 border-r border-slate-200/80">Trigger Event</th>
                        <th className="px-4 py-3.5 border-r border-slate-200/80">Configured Action</th>
                        <th className="px-4 py-3.5 border-r border-slate-200/80 text-center">Executions</th>
                        <th className="px-4 py-3.5 border-r border-slate-200/80">Last Executed</th>
                        <th className="px-4 py-3.5 text-right">Actions</th>
                      </tr>
                    </thead>

                    <tbody className="divide-y divide-slate-100 text-slate-700 font-medium text-xs">
                      {loading ? (
                        <tr>
                          <td colSpan={7} className="py-24 text-center">
                            <div className="max-w-md mx-auto space-y-2">
                              <RefreshCw className="w-6 h-6 text-red-600 animate-spin mx-auto" />
                              <p className="text-xs font-semibold text-slate-500">Loading workflows...</p>
                            </div>
                          </td>
                        </tr>
                      ) : filteredWorkflows.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="py-24 text-center">
                            <div className="max-w-md mx-auto space-y-2">
                              <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
                                <Zap className="w-6 h-6" />
                              </div>
                              <p className="text-base font-bold text-slate-900">No workflows created yet</p>
                              <p className="text-xs text-slate-500">
                                Click &apos;+ Create Workflow&apos; to build your first automatic WhatsApp responder or lead assignment rule.
                              </p>
                              <button
                                onClick={() => setShowCreateModal(true)}
                                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold shadow-xs transition-all cursor-pointer inline-flex items-center gap-1.5 mt-2"
                              >
                                <Plus className="w-3.5 h-3.5" />
                                <span>Create Workflow</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      ) : (
                        filteredWorkflows.map((wf) => (
                          <tr key={wf.id} className="hover:bg-slate-50/80 transition-colors">
                            {/* Status Live Toggle */}
                            <td className="py-3 px-4 text-center border-r border-slate-100">
                              <button
                                onClick={() => handleToggle(wf.id, wf.is_active, wf.name)}
                                className={`w-9 h-5 flex items-center rounded-full p-0.5 transition-colors cursor-pointer mx-auto ${
                                  wf.is_active ? "bg-emerald-500" : "bg-slate-300"
                                }`}
                                title={wf.is_active ? "Click to pause workflow" : "Click to activate workflow"}
                              >
                                <div
                                  className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${
                                    wf.is_active ? "translate-x-4" : "translate-x-0"
                                  }`}
                                />
                              </button>
                            </td>

                            {/* Name & Module */}
                            <td className="p-4 border-r border-slate-100">
                              <div className="flex items-center gap-2.5">
                                <div>
                                  <span className="font-bold text-slate-900 block text-xs">
                                    {wf.name}
                                  </span>
                                  <div className="flex items-center gap-1.5 mt-0.5">
                                    <span className="text-[10px] font-bold px-2 py-0.2 rounded-md bg-slate-100 text-slate-600 border border-slate-200">
                                      {wf.module === "CONTACT" ? "Contacts" : "Deals"}
                                    </span>
                                    {wf.is_active ? (
                                      <span className="text-[10px] font-bold text-emerald-600 flex items-center gap-0.5">
                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block animate-pulse" />
                                        Active
                                      </span>
                                    ) : (
                                      <span className="text-[10px] font-bold text-slate-400">Paused</span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </td>

                            {/* Trigger Event */}
                            <td className="p-4 border-r border-slate-100 font-medium text-slate-800">
                              <div className="flex items-center gap-1.5">
                                <Zap className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                                <span>{formatTriggerLabel(wf.trigger_event)}</span>
                              </div>
                            </td>

                            {/* Configured Action */}
                            <td className="p-4 border-r border-slate-100">
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                                <Layers className="w-3 h-3 text-indigo-500" />
                                <span>{getActionBadge(wf.actions)}</span>
                              </span>
                            </td>

                            {/* Execution Counts */}
                            <td className="p-4 border-r border-slate-100 text-center">
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold font-mono bg-slate-100 text-slate-700 border border-slate-200">
                                <Activity className="w-3 h-3 text-slate-400" />
                                {wf.execution_count ?? 0}
                              </span>
                            </td>

                            {/* Last Executed */}
                            <td className="p-4 border-r border-slate-100 text-slate-500 font-mono text-[11px]">
                              {wf.last_executed ? formatDate(wf.last_executed) : "Never"}
                            </td>

                            {/* Actions */}
                            <td className="p-4 text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                <button
                                  onClick={() => handleDelete(wf.id, wf.name)}
                                  className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                                  title="Delete Workflow"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: HISTORY LOGS */}
          {activeTab === "History Logs" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600">Execution Audit Trail</h3>
                  <p className="text-[11px] text-slate-400">Live transaction records from PostgreSQL workflow_logs</p>
                </div>

                <button
                  onClick={() => loadLogs()}
                  className="px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-2xs transition-colors cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loadingLogs ? "animate-spin text-red-600" : ""}`} />
                  <span>Refresh Logs</span>
                </button>
              </div>

              <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="bg-slate-50/80 border-b border-slate-200/80 text-xs font-bold text-slate-700 uppercase tracking-wider">
                        <th className="px-4 py-3.5 border-r border-slate-200/80">Status</th>
                        <th className="px-4 py-3.5 border-r border-slate-200/80">Workflow Triggered</th>
                        <th className="px-4 py-3.5 border-r border-slate-200/80">Action Executed</th>
                        <th className="px-4 py-3.5 border-r border-slate-200/80">Execution Time</th>
                        <th className="px-4 py-3.5 text-right">Details</th>
                      </tr>
                    </thead>

                    <tbody className="divide-y divide-slate-100 text-slate-700 font-medium text-xs">
                      {loadingLogs ? (
                        <tr>
                          <td colSpan={5} className="py-20 text-center">
                            <RefreshCw className="w-6 h-6 text-red-600 animate-spin mx-auto mb-2" />
                            <p className="text-xs text-slate-500 font-semibold">Loading execution logs...</p>
                          </td>
                        </tr>
                      ) : logs.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-20 text-center">
                            <History className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                            <p className="text-sm font-bold text-slate-800">No execution logs yet</p>
                            <p className="text-xs text-slate-400 mt-0.5">Logs will automatically populate when workflow rules fire.</p>
                          </td>
                        </tr>
                      ) : (
                        logs.map((log) => (
                          <tr key={log.id} className="hover:bg-slate-50/80 transition-colors">
                            <td className="p-4 border-r border-slate-100">
                              <span
                                className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                                  log.status === "SUCCESS"
                                    ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                    : "bg-rose-50 text-rose-700 border border-rose-200"
                                }`}
                              >
                                {log.status === "SUCCESS" ? (
                                  <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                                ) : (
                                  <AlertCircle className="w-3 h-3 text-rose-600" />
                                )}
                                <span>{log.status}</span>
                              </span>
                            </td>

                            <td className="p-4 border-r border-slate-100 font-bold text-slate-900">
                              {log.workflow_name || "Workflow Rule"}
                            </td>

                            <td className="p-4 border-r border-slate-100 font-mono text-slate-700">
                              {log.action_type}
                            </td>

                            <td className="p-4 border-r border-slate-100 font-mono text-slate-500 text-[11px]">
                              {formatDate(log.executed_at)}
                            </td>

                            <td className="p-4 text-right text-slate-500">
                              {log.error_message ? (
                                <span className="text-rose-600 font-mono text-[10px]">{log.error_message}</span>
                              ) : (
                                <span className="text-emerald-600 font-mono text-[10px]">OK 200</span>
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

        </main>
      </div>

      {/* Zigmaa Slide-Over Workflow Builder Drawer */}
      <NewWorkflowDrawer
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreated={() => {
          loadWorkflows();
          loadLogs();
        }}
      />
    </div>
  );
}
