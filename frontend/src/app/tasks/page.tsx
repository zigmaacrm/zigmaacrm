"use client";

import { useState, useEffect, useMemo } from "react";
import {
  CheckSquare,
  Plus,
  Clock,
  Trash2,
  CheckCircle2,
  X,
  AlertCircle,
  Filter,
  Search,
  SlidersHorizontal,
  RotateCw,
  MoreVertical,
  Square,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ArrowRight,
  ArrowLeft,
  Calendar,
  UserCheck,
  Check,
  Phone,
  MessageSquare,
  Mail,
  Users,
  CheckSquare as ToDoIcon,
  PhoneCall
} from "lucide-react";
import Sidebar from "@/components/layout/Sidebar";
import Header from "@/components/layout/Header";
import FilterSelect from "@/components/common/FilterSelect";
import MoreViewsDropdown from "@/components/common/MoreViewsDropdown";
import CustomDropdown from "@/components/common/CustomDropdown";
import NewTaskDrawer from "@/components/tasks/NewTaskDrawer";
import ContactSlideDrawer from "@/components/contacts/ContactSlideDrawer";
import CallDialerModal from "@/components/common/CallDialerModal";
import { api } from "@/lib/api";
import { Task, Contact } from "@/lib/mockData";
import { useToast } from "@/components/common/ToastProvider";

const PRIMARY_TASK_TABS = [
  "All Tasks",
  "To Do",
  "Pending",
  "Overdue"
];

const EXTENDED_TASK_TAB = "Completed";

const TASKS_MORE_VIEWS = [
  "Completed",
  "My Tasks",
  "In Progress",
  "Today's Tasks",
  "Recently Created Tasks",
  "Recently Modified Tasks"
];

const TASK_STATUS_OPTIONS = [
  { value: "To Do", label: "To Do", dotColor: "bg-slate-400", pillClass: "bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200" },
  { value: "Pending", label: "Pending", dotColor: "bg-amber-500", pillClass: "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100" },
  { value: "In Progress", label: "In Progress", dotColor: "bg-blue-500", pillClass: "bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100" },
  { value: "Completed", label: "Completed", dotColor: "bg-emerald-500", pillClass: "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100" },
];

/**
 * Checks whether an allocated task has exceeded its scheduled due date and/or time (delayed / overdue).
 */
const isTaskDelayed = (task?: { due_date?: string; due_time?: string; status?: string } | null): boolean => {
  if (!task || !task.due_date) return false;
  const s = (task.status || "").toUpperCase().trim();
  if (s === "COMPLETED" || s === "DONE" || s === "WON") return false;

  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const curDateStr = `${year}-${month}-${day}`;

  const datePart = task.due_date.split("T")[0].trim();
  if (!datePart) return false;

  // Past calendar day
  if (datePart < curDateStr) {
    return true;
  }

  // Same day: check if specific allocated due time has passed
  if (datePart === curDateStr && task.due_time) {
    const timeStr = task.due_time.trim().toLowerCase();
    let targetHours = -1;
    let targetMins = 0;

    if (timeStr.includes("pm") || timeStr.includes("am")) {
      const isPm = timeStr.includes("pm");
      const cleaned = timeStr.replace(/(am|pm|\s)/g, "");
      const parts = cleaned.split(":");
      targetHours = parseInt(parts[0] || "0", 10);
      targetMins = parseInt(parts[1] || "0", 10);
      if (isPm && targetHours < 12) targetHours += 12;
      if (!isPm && targetHours === 12) targetHours = 0;
    } else if (timeStr.includes(":")) {
      const parts = timeStr.split(":");
      targetHours = parseInt(parts[0] || "0", 10);
      targetMins = parseInt(parts[1] || "0", 10);
    }

    if (targetHours >= 0) {
      const curMinutes = now.getHours() * 60 + now.getMinutes();
      const dueMinutes = targetHours * 60 + targetMins;
      if (curMinutes > dueMinutes) {
        return true;
      }
    }
  }

  return false;
};

const normalizeTaskStatus = (
  status?: string,
  task?: { due_date?: string; due_time?: string; status?: string } | null
): "To Do" | "Pending" | "In Progress" | "Completed" => {
  const s = (status || "").toUpperCase().trim();
  if (s === "COMPLETED" || s === "DONE" || s === "WON") return "Completed";

  // If the admin-allocated task time is delayed/overdue, automatically set as Pending
  if (task && isTaskDelayed(task)) {
    return "Pending";
  }

  if (s === "PENDING") return "Pending";
  if (s === "IN PROGRESS" || s === "IN_PROGRESS") return "In Progress";
  if (s === "TODO" || s === "TO DO" || s === "TO-DO") return "To Do";
  return "Pending";
};

const TASK_STATUSES = [
  "To Do",
  "Pending",
  "Overdue",
  "In Progress",
  "Completed"
];

export default function TasksPage() {
  const { toast, confirm } = useToast();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [currentUser, setCurrentUser] = useState<any>(null);

  const [activeTab, setActiveTab] = useState<string>("All Tasks");
  const [selectedStatus, setSelectedStatus] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [showAddDrawer, setShowAddDrawer] = useState(false);
  const [selectedContactForDrawer, setSelectedContactForDrawer] = useState<Contact | null>(null);
  const [pageSize, setPageSize] = useState(20);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<number | string>>(new Set());
  const [callModalTask, setCallModalTask] = useState<Task | null>(null);
  const [activeStatusMenuTaskId, setActiveStatusMenuTaskId] = useState<number | string | null>(null);

  const loadTasks = async () => {
    try {
      const data = await api.getTasks(true);
      if (Array.isArray(data)) {
        // Deduplicate tasks by id to prevent duplicate key console errors
        const seen = new Set<string>();
        const uniqueTasks: Task[] = [];
        for (const t of data) {
          const key = String(t.id);
          if (!seen.has(key)) {
            seen.add(key);
            const isCompleted = t.status === "Completed" || t.status === "COMPLETED";
            const delayed = !isCompleted && isTaskDelayed(t);
            uniqueTasks.push({
              ...t,
              status: delayed ? "Pending" : (t.status || "To Do")
            });
          }
        }
        setTasks(uniqueTasks);
      } else {
        setTasks([]);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const overdueCount = useMemo(() => {
    return tasks.filter((t) => isTaskDelayed(t)).length;
  }, [tasks]);

  useEffect(() => {
    const user = api.getCurrentUser();
    if (user) setCurrentUser(user);
    api.getMe().then((p: any) => {
      if (p) setCurrentUser(p);
    }).catch(() => {});
    loadTasks();
  }, []);

  const handleCreateTaskDrawer = async (taskData: Partial<Task>) => {
    try {
      const created = await api.createTask(taskData);
      setTasks((prev) => {
        const withoutDup = prev.filter((t) => String(t.id) !== String(created.id));
        return [created, ...withoutDup];
      });
      setShowAddDrawer(false);
      toast.success("Task Created", `"${taskData.title}" was added.`);
      await loadTasks();
    } catch (err: any) {
      toast.error("Error", err?.message || "Could not create task.");
    }
  };

  const handleDelete = async (id: number | string) => {
    const task = tasks.find((t) => String(t.id) === String(id));
    const confirmed = await confirm({
      title: "Delete Task",
      message: `Are you sure you want to delete ${task ? `"${task.title}"` : "this task"}?`,
      confirmText: "Delete",
      cancelText: "Cancel",
      variant: "danger"
    });

    if (confirmed) {
      setTasks((prev) => prev.filter((t) => String(t.id) !== String(id)));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      await api.deleteTask(id);
      toast.success("Task Deleted", "The task was removed.");
      await loadTasks();
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    const count = selectedIds.size;
    const confirmed = await confirm({
      title: "Delete Selected Tasks",
      message: `Are you sure you want to permanently delete ${count} selected ${count === 1 ? "task" : "tasks"}?`,
      confirmText: "Delete",
      cancelText: "Cancel",
      variant: "danger"
    });

    if (confirmed) {
      const idsToDelete = Array.from(selectedIds);
      setTasks((prev) => prev.filter((t) => !selectedIds.has(t.id)));
      setSelectedIds(new Set());
      for (const id of idsToDelete) {
        await api.deleteTask(id);
      }
      toast.success("Tasks Deleted", `Successfully removed ${count} ${count === 1 ? "task" : "tasks"}.`);
    }
  };

  const handleBulkComplete = async () => {
    if (selectedIds.size === 0) return;
    const count = selectedIds.size;
    const idsToComplete = Array.from(selectedIds);
    setTasks((prev) =>
      prev.map((t) => (selectedIds.has(t.id) ? { ...t, status: "COMPLETED" } : t))
    );
    setSelectedIds(new Set());
    for (const id of idsToComplete) {
      await api.updateTask(id, { status: "COMPLETED" });
    }
    toast.success("Tasks Completed", `Marked ${count} ${count === 1 ? "task" : "tasks"} as Completed.`);
  };

  const handleSetStatus = async (taskId: number | string, newStatus: string) => {
    const targetTask = tasks.find((t) => String(t.id) === String(taskId));
    const isDelayed = targetTask ? isTaskDelayed(targetTask) : false;

    // Overdue tasks cannot be reverted to "To Do" by sales representatives while the due date is in the past
    if (newStatus === "To Do" && isDelayed) {
      toast.warning(
        "Action Not Allowed",
        "Changing an overdue task to 'To Do' is not permitted for Sales Representatives while past its due date. Please reschedule the due date or mark as In Progress / Completed."
      );
      return;
    }

    setTasks((prev) =>
      prev.map((t) => (String(t.id) === String(taskId) ? { ...t, status: newStatus } : t))
    );
    try {
      await api.updateTask(taskId, { status: newStatus });
      toast.info("Status Updated", `Task marked as "${newStatus}"`);
    } catch {
      toast.error("Error", "Could not update task status.");
    }
  };

  const handleToggleStatus = async (task: Task) => {
    const isComp = task.status === "Completed" || task.status === "COMPLETED";
    const nextStatus = isComp ? "Pending" : "Completed";
    await handleSetStatus(task.id, nextStatus);
  };

  const handleOpenContactDrawer = async (contactId?: string | number, fallbackName?: string) => {
    if (contactId) {
      try {
        const c = await api.getContactDetail(contactId);
        if (c) {
          setSelectedContactForDrawer(c);
          return;
        }
      } catch {}
    }
    // Fallback lightweight contact
    setSelectedContactForDrawer({
      id: contactId || `temp-${Date.now()}`,
      name: fallbackName || "Contact Details",
      email: "",
      phone: "",
      company_name: "",
      status: "NEW"
    } as any);
  };

  const handleExportCsv = () => {
    if (tasks.length === 0) {
      toast.warning("Export Warning", "No tasks available to export.");
      return;
    }
    const headers = ["Subject", "Due Date", "Priority", "Status", "Related To"];
    const rows = tasks.map((t) => [
      `"${t.title}"`,
      `"${t.due_date}"`,
      `"${t.priority}"`,
      `"${t.status}"`,
      `"${t.related_to || ""}"`
    ]);
    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `zigmaa_tasks_${new Date().toISOString().split("T")[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success("Export Complete", `Exported ${tasks.length} tasks.`);
  };

  // Filtered Tasks
  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      const isDelayed = isTaskDelayed(t);
      const normStatus = normalizeTaskStatus(t.status, t);
      const isCompleted = normStatus === "Completed";

      // Tab filter
      if (activeTab === "To Do") {
        if (normStatus !== "To Do" || isDelayed) return false;
      } else if (activeTab === "Pending") {
        // Clicking Pending filter: show tasks with Pending status + any delayed tasks
        if (normStatus !== "Pending" && !isDelayed) return false;
      } else if (activeTab === "Overdue" || activeTab === "Overdue Tasks") {
        // Clicking Overdue filter: show all delayed / overdue tasks
        if (!isDelayed) return false;
      } else if (activeTab === "In Progress") {
        if (normStatus !== "In Progress") return false;
      } else if (activeTab === "Completed") {
        if (!isCompleted) return false;
      } else if (activeTab === "Today's Tasks") {
        const todayStr = new Date().toISOString().split("T")[0];
        if (t.due_date?.split("T")[0] !== todayStr) return false;
      } else if (activeTab === "My Tasks") {
        if (!currentUser) return true;
        const myName = (currentUser.full_name || "").toLowerCase().trim();
        const myEmail = (currentUser.email || "").toLowerCase().trim();
        const myId = currentUser.id;
        const assigned = (t.assigned_to || "").toLowerCase().trim();
        const isAssigned = (myName && assigned.includes(myName)) || (myEmail && assigned.includes(myEmail)) || t.owner_id === myId;
        if (!isAssigned) return false;
      }

      // Status dropdown filter
      if (selectedStatus !== "ALL") {
        if (selectedStatus === "Overdue") {
          if (!isDelayed) return false;
        } else if (selectedStatus === "Pending") {
          if (normStatus !== "Pending" && !isDelayed) return false;
        } else if (normStatus !== selectedStatus) {
          return false;
        }
      }

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          t.title.toLowerCase().includes(q) ||
          (t.related_to && t.related_to.toLowerCase().includes(q)) ||
          (t.contact_name && t.contact_name.toLowerCase().includes(q)) ||
          (t.assigned_to && t.assigned_to.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [tasks, activeTab, selectedStatus, searchQuery, currentUser]);

  // Publish real-time UI context for Zigmaa AI Copilot
  useEffect(() => {
    if (typeof window !== "undefined") {
      (window as any).__ZIGMAA_PAGE_STATE = {
        page: "/tasks",
        screenName: "Tasks Management",
        activeTab,
        selectedStatus,
        totalTasks: tasks.length,
        visibleCount: filteredTasks.length,
        sampleTasks: filteredTasks.slice(0, 5).map((t) => ({
          title: t.title,
          status: t.status,
          priority: t.priority,
          dueDate: t.due_date,
          contact: t.contact_name
        }))
      };
    }
  }, [activeTab, selectedStatus, tasks, filteredTasks]);

  const totalPages = Math.ceil(filteredTasks.length / pageSize) || 1;
  const paginatedTasks = filteredTasks.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const startIdx = filteredTasks.length === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const endIdx = Math.min(currentPage * pageSize, filteredTasks.length);

  const toggleSelectAll = () => {
    if (selectedIds.size === paginatedTasks.length && paginatedTasks.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(paginatedTasks.map((t) => t.id)));
    }
  };

  const toggleSelectOne = (id: number | string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  return (
    <div className="flex h-screen bg-[#F8FAFC] dark:bg-[#0b0f19] text-slate-900 dark:text-slate-100 font-sans overflow-hidden select-none">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Header />

        <main className="flex-1 flex flex-col min-h-0 bg-[#F8FAFC] dark:bg-[#0b0f19] overflow-hidden p-4 lg:p-6 pb-2">
          {/* Controls: Responsive Row Above Table (Single row on wide screens, wraps cleanly on laptops without clipping) */}
          <div className="flex flex-wrap 2xl:flex-nowrap items-center justify-between gap-2 pb-2.5 shrink-0">
            {/* Left: Navigation Tabs + More Views (···) */}
            <div className="flex items-center gap-1 sm:gap-1.5 text-xs sm:text-sm shrink-0 overflow-x-auto max-w-full scrollbar-none">
              {PRIMARY_TASK_TABS.map((tab) => {
                const isTabActive = activeTab === tab || (tab === "Overdue" && activeTab === "Overdue Tasks");
                return (
                  <button
                    key={tab}
                    type="button"
                    onClick={(e) => {
                      setActiveTab(tab);
                      setCurrentPage(1);
                      e.currentTarget.blur();
                    }}
                    className={`px-2 sm:px-2.5 xl:px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer whitespace-nowrap text-xs xl:text-sm outline-none! focus:outline-none! focus-visible:outline-none! ring-0! focus:ring-0! focus-visible:ring-0! border select-none inline-flex items-center gap-1.5 ${
                      isTabActive
                        ? "bg-red-50 text-red-600 font-bold border-red-200/80 shadow-2xs"
                        : "border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                    }`}
                    style={{ outline: "none", boxShadow: isTabActive ? undefined : "none" }}
                  >
                    <span>{tab}</span>
                    {tab === "Overdue" && overdueCount > 0 && (
                      <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-rose-100 text-rose-700">
                        {overdueCount}
                      </span>
                    )}
                  </button>
                );
              })}

              {/* Extended Tab (Completed): visible on 2xl large screens or when currently selected */}
              <button
                key={EXTENDED_TASK_TAB}
                type="button"
                onClick={(e) => {
                  setActiveTab(EXTENDED_TASK_TAB);
                  setCurrentPage(1);
                  e.currentTarget.blur();
                }}
                className={`px-2 sm:px-2.5 xl:px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer whitespace-nowrap text-xs xl:text-sm outline-none! focus:outline-none! focus-visible:outline-none! ring-0! focus:ring-0! focus-visible:ring-0! border select-none items-center gap-1.5 ${
                  activeTab === EXTENDED_TASK_TAB ? "inline-flex" : "hidden 2xl:inline-flex"
                } ${
                  activeTab === EXTENDED_TASK_TAB
                    ? "bg-red-50 text-red-600 font-bold border-red-200/80 shadow-2xs"
                    : "border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                }`}
                style={{ outline: "none", boxShadow: activeTab === EXTENDED_TASK_TAB ? undefined : "none" }}
              >
                <span>{EXTENDED_TASK_TAB}</span>
              </button>

              {/* More Views Dropdown (···) */}
              <MoreViewsDropdown
                views={TASKS_MORE_VIEWS}
                activeView={activeTab}
                onSelect={(view) => {
                  setActiveTab(view);
                  setCurrentPage(1);
                }}
              />
            </div>

            {/* Right Actions: [Search] [Status ▾] [Add Task] [Export] */}
            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 flex-wrap sm:flex-nowrap">
              {/* Search Box - matching Contacts compact width */}
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search tasks..."
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="pl-8.5 pr-3 h-9 bg-white border border-slate-200 rounded-xl text-xs sm:text-sm font-medium text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500 w-24 sm:w-28 md:w-32 lg:w-36 shadow-2xs transition-all"
                />
              </div>

              {/* Custom Status Dropdown */}
              <FilterSelect
                placeholder="Status"
                value={selectedStatus}
                options={TASK_STATUSES}
                onChange={(val) => {
                  setSelectedStatus(val);
                  setCurrentPage(1);
                }}
                className="shrink-0 [&>button]:h-9 [&>button]:py-0 [&>button]:px-2 sm:[&>button]:px-2.5 xl:[&>button]:px-3 [&>button]:text-xs sm:[&>button]:text-sm"
              />

              {/* Add Task Button */}
              <button
                type="button"
                onClick={() => setShowAddDrawer(true)}
                className="h-9 px-2.5 sm:px-3 xl:px-3.5 bg-red-600 hover:bg-red-700 active:bg-red-800 text-white text-xs sm:text-sm font-semibold rounded-xl shadow-xs transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <Plus className="w-4 h-4" />
                <span>Add Task</span>
              </button>

              {/* Export Button */}
              <button
                type="button"
                onClick={handleExportCsv}
                className="h-9 px-2.5 sm:px-3 xl:px-3.5 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-xl text-xs sm:text-sm font-semibold shadow-2xs transition-colors cursor-pointer flex items-center justify-center shrink-0 whitespace-nowrap"
              >
                Export
              </button>
            </div>
          </div>

          {/* MAIN TABLE CONTAINER: Stretches full remaining height so footer is strictly anchored at the bottom */}
          <div className="bg-white border border-slate-200/80 rounded-xl shadow-xs flex-1 flex flex-col min-h-0 overflow-hidden">
            {/* Scrollable table body area */}
            <div className="flex-1 overflow-auto custom-scrollbar">
              <table className="w-full border-separate border-spacing-0 text-left text-sm min-w-[1050px]">
                <thead className="sticky top-0 z-10 bg-slate-50/90 backdrop-blur-xs">
                  <tr className="text-[12px] font-semibold text-slate-500 select-none">
                    <th className="py-3.5 px-4 w-14 min-w-[56px] text-center border-b border-slate-200/80">
                      <div className="flex items-center justify-center">
                        <button
                          type="button"
                          onClick={toggleSelectAll}
                          className="flex items-center justify-center cursor-pointer text-slate-400 hover:text-slate-600 transition-colors"
                          title={selectedIds.size === paginatedTasks.length && paginatedTasks.length > 0 ? "Deselect All" : "Select All"}
                        >
                          {selectedIds.size > 0 && selectedIds.size === paginatedTasks.length ? (
                            <CheckSquare className="w-4 h-4 text-red-600" />
                          ) : (
                            <Square className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                    </th>
                    <th className="py-3.5 px-5 min-w-[150px] border-b border-slate-200/80 font-semibold text-slate-700">
                      <span>Activities</span>
                    </th>
                    <th className="py-3.5 px-5 min-w-[240px] border-b border-slate-200/80 font-semibold text-slate-700">
                      <span>Subject</span>
                    </th>
                    <th className="py-3.5 px-5 min-w-[210px] border-b border-slate-200/80 font-semibold text-slate-700">
                      <span>Related Contact</span>
                    </th>
                    <th className="py-3.5 px-5 min-w-[160px] border-b border-slate-200/80 font-semibold text-slate-700">
                      <span>Assigned To</span>
                    </th>
                    <th className="py-3.5 px-5 min-w-[140px] whitespace-nowrap border-b border-slate-200/80 font-semibold text-slate-700">
                      <span>Due Date</span>
                    </th>
                    <th className="py-3.5 px-5 min-w-[120px] border-b border-slate-200/80 font-semibold text-slate-700">
                      <span>Priority</span>
                    </th>
                    <th className="py-3.5 px-5 min-w-[140px] whitespace-nowrap border-b border-slate-200/80 font-semibold text-slate-700">
                      <span>Status</span>
                    </th>
                    <th className="py-3.5 px-5 min-w-[120px] text-right border-b border-slate-200/80 font-semibold text-slate-700">
                      <span>Actions</span>
                    </th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-100 text-slate-700 font-medium text-sm">
                  {paginatedTasks.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-24 text-center">
                        <div className="max-w-md mx-auto space-y-1.5">
                          <p className="text-base font-bold text-slate-900">No tasks found</p>
                          <p className="text-sm text-slate-500">Tasks you create or filter will show up here.</p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    paginatedTasks.map((task, idx) => {
                      const isSelected = selectedIds.has(task.id);
                      const isCompleted = task.status === "Completed" || task.status === "COMPLETED";

                      // Determine activity icon & badge style
                      const actType = (task.activity_type || "To-Do").toLowerCase();
                      let ActivityIcon = ToDoIcon;
                      let iconColor = "text-slate-600 bg-slate-100";
                      if (actType.includes("call")) {
                        ActivityIcon = Phone;
                        iconColor = "text-blue-600 bg-blue-50";
                      } else if (actType.includes("whatsapp")) {
                        ActivityIcon = MessageSquare;
                        iconColor = "text-emerald-600 bg-emerald-50";
                      } else if (actType.includes("email")) {
                        ActivityIcon = Mail;
                        iconColor = "text-purple-600 bg-purple-50";
                      } else if (actType.includes("meeting")) {
                        ActivityIcon = Users;
                        iconColor = "text-indigo-600 bg-indigo-50";
                      }

                      // Due date color logic
                      const todayStr = new Date().toISOString().split("T")[0];
                      const isOverdue = isTaskDelayed(task);
                      const isToday = task.due_date?.split("T")[0] === todayStr && !isCompleted && !isOverdue;

                      const contactDisplayName = task.contact_name || task.related_to;

                      return (
                        <tr
                          key={`table-task-${task.id}-${idx}`}
                          className={`hover:bg-slate-50/80 transition-colors cursor-pointer group ${
                            isSelected ? "bg-red-50/40" : ""
                          }`}
                        >
                          {/* Selection Checkbox */}
                          <td
                            className="py-4 px-4 text-center border-b border-slate-100"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleSelectOne(task.id);
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

                          {/* Activities Column: Clean Icon + Label without redundant select square */}
                          <td className="py-4 px-5 border-b border-slate-100">
                            <div className="flex items-center gap-2.5">
                              <span
                                className={`p-1.5 rounded-lg inline-flex items-center justify-center shrink-0 ${iconColor}`}
                                title={task.activity_type || "To-Do"}
                              >
                                <ActivityIcon className="w-4 h-4" />
                              </span>
                              <span className="text-xs font-semibold text-slate-700 whitespace-nowrap">
                                {task.activity_type || "To-Do"}
                              </span>
                            </div>
                          </td>

                          {/* Subject: Spacious & Clear */}
                          <td className="py-4 px-5 border-b border-slate-100 font-medium text-slate-900 group-hover:text-red-600 transition-colors">
                            <div className="flex flex-col gap-0.5">
                              <span className={`text-xs font-semibold ${isCompleted ? "line-through text-slate-400" : "text-slate-900"}`}>
                                {task.title}
                              </span>
                              {task.description && (
                                <span className="text-[11px] text-slate-400 line-clamp-1 font-normal max-w-[320px]">
                                  {task.description}
                                </span>
                              )}
                            </div>
                          </td>

                          {/* Related Contact: Clean Avatar + Contact Name + Company Name */}
                          <td className="py-4 px-5 border-b border-slate-100" onClick={(e) => e.stopPropagation()}>
                            {contactDisplayName ? (
                              <div
                                onClick={() => handleOpenContactDrawer(task.contact_id, contactDisplayName)}
                                className="inline-flex items-center gap-2.5 hover:bg-slate-100/80 p-1.5 -ml-1.5 rounded-xl cursor-pointer transition-colors"
                                title="View Contact Details"
                              >
                                <div className="w-7 h-7 rounded-full bg-slate-100 text-slate-700 text-[11px] font-bold flex items-center justify-center shrink-0 border border-slate-200">
                                  {contactDisplayName.substring(0, 2).toUpperCase()}
                                </div>
                                <div className="min-w-0">
                                  <span className="text-xs font-semibold text-slate-800 hover:text-red-600 block truncate max-w-[200px]">
                                    {contactDisplayName}
                                  </span>
                                  {task.contact_company && (
                                    <span className="text-[11px] text-slate-400 block truncate max-w-[200px]">
                                      {task.contact_company}
                                    </span>
                                  )}
                                </div>
                              </div>
                            ) : (
                              <span className="text-xs text-slate-400 font-normal">—</span>
                            )}
                          </td>

                          {/* Assigned To: Spacious Avatar + Name */}
                          <td className="py-4 px-5 border-b border-slate-100">
                            <div className="flex items-center gap-2.5">
                              <div className="w-7 h-7 rounded-full bg-red-50 text-red-700 text-[11px] font-bold flex items-center justify-center border border-red-200 shrink-0">
                                {(task.assigned_to || "M").substring(0, 1).toUpperCase()}
                              </div>
                              <span className="text-slate-700 text-xs font-medium truncate max-w-[150px]">
                                {task.assigned_to || "Mohamed Thoufiq"}
                              </span>
                            </div>
                          </td>

                          {/* Due Date: Clean Single-line Date with Icon (No Time) */}
                          <td className="py-4 px-5 border-b border-slate-100 whitespace-nowrap min-w-[140px]">
                            <div className="flex items-center gap-1.5 whitespace-nowrap">
                              <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                              <span className={`text-xs font-semibold whitespace-nowrap ${
                                isOverdue
                                  ? "text-rose-600 font-bold"
                                  : isToday
                                  ? "text-amber-600 font-bold"
                                  : "text-slate-700"
                              }`}>
                                {task.due_date ? task.due_date.split("T")[0] : "—"}
                              </span>
                            </div>
                          </td>

                          {/* Priority: Clean Tag */}
                          <td className="py-4 px-5 border-b border-slate-100">
                            <span
                              className={`px-2.5 py-1 rounded-full text-[10px] font-bold border inline-block ${
                                task.priority === "Urgent"
                                  ? "bg-rose-100 text-rose-800 border-rose-300 font-extrabold"
                                  : task.priority === "High"
                                  ? "bg-rose-50 text-rose-700 border-rose-200"
                                  : task.priority === "Medium"
                                  ? "bg-amber-50 text-amber-700 border-amber-200"
                                  : "bg-slate-100 text-slate-600 border-slate-200"
                              }`}
                            >
                              {task.priority || "Medium"}
                            </span>
                          </td>

                          {/* Status: Interactive Status Dropdown Menu (Click to select Pending, To Do, In Progress, Completed) */}
                          <td className="py-4 px-5 border-b border-slate-100 min-w-[140px] whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                            {(() => {
                              const norm = normalizeTaskStatus(task.status, task);
                              const currentStatusObj =
                                TASK_STATUS_OPTIONS.find((o) => o.value === norm) || TASK_STATUS_OPTIONS[1];

                              return (
                                <div className="relative inline-block text-left">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setActiveStatusMenuTaskId((prev) => (prev === task.id ? null : task.id))
                                    }
                                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold border transition-all cursor-pointer shadow-2xs hover:scale-105 active:scale-95 whitespace-nowrap shrink-0 select-none ${currentStatusObj.pillClass}`}
                                    title="Click to change status to Pending, To Do, In Progress, or Completed"
                                  >
                                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${currentStatusObj.dotColor}`} />
                                    <span className="whitespace-nowrap leading-none">{currentStatusObj.label}</span>
                                    <ChevronDown className="w-3 h-3 text-slate-400 opacity-60 ml-0.5 shrink-0" />
                                  </button>

                                  {/* Dropdown Menu to choose any status */}
                                  {activeStatusMenuTaskId === task.id && (
                                    <>
                                      <div
                                        className="fixed inset-0 z-40"
                                        onClick={() => setActiveStatusMenuTaskId(null)}
                                      />
                                      <div className="absolute left-0 top-full mt-1.5 w-44 bg-white border border-slate-200/90 rounded-xl shadow-2xl py-1.5 z-50 text-xs animate-in fade-in zoom-in-95 duration-100">
                                        <div className="px-3 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100 mb-1">
                                          Change Status
                                        </div>
                                        {TASK_STATUS_OPTIONS.map((opt) => {
                                          const active = opt.value === norm;
                                          const isOptionDisabled = opt.value === "To Do" && isTaskDelayed(task);

                                          return (
                                            <button
                                              key={opt.value}
                                              type="button"
                                              onClick={() => {
                                                if (isOptionDisabled) {
                                                  toast.warning(
                                                    "Action Not Allowed",
                                                    "Changing an overdue task to 'To Do' is not permitted for Sales Representatives while past its due date. Please reschedule the due date or mark as In Progress / Completed."
                                                  );
                                                  setActiveStatusMenuTaskId(null);
                                                  return;
                                                }
                                                handleSetStatus(task.id, opt.value);
                                                setActiveStatusMenuTaskId(null);
                                              }}
                                              title={isOptionDisabled ? "Cannot set overdue task to 'To Do'" : undefined}
                                              className={`w-full text-left px-3 py-1.5 flex items-center justify-between text-xs font-semibold cursor-pointer transition-colors whitespace-nowrap ${
                                                isOptionDisabled
                                                  ? "opacity-50 hover:bg-slate-50 cursor-not-allowed"
                                                  : active
                                                  ? "bg-red-50 text-red-600 font-bold"
                                                  : "text-slate-700 hover:bg-slate-50"
                                              }`}
                                            >
                                              <div className="flex items-center gap-2">
                                                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${opt.dotColor}`} />
                                                <span className="whitespace-nowrap">{opt.label}</span>
                                              </div>
                                              {isOptionDisabled ? (
                                                <span className="text-[10px] text-amber-600 font-medium">Overdue</span>
                                              ) : active ? (
                                                <Check className="w-3.5 h-3.5 text-red-600 shrink-0" />
                                              ) : null}
                                            </button>
                                          );
                                        })}
                                      </div>
                                    </>
                                  )}
                                </div>
                              );
                            })()}
                          </td>

                          {/* Actions: Quick Triggers for Done + Call/WhatsApp + Delete */}
                          <td className="py-4 px-5 text-right border-b border-slate-100" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-end gap-1.5">
                              {/* Dedicated Quick Mark Done Action Button */}
                              <button
                                type="button"
                                onClick={() => handleToggleStatus(task)}
                                className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                                  isCompleted
                                    ? "text-emerald-600 hover:bg-emerald-50"
                                    : "text-slate-400 hover:text-emerald-600 hover:bg-emerald-50"
                                }`}
                                title={isCompleted ? "Completed (Click to mark Pending)" : "Mark as Completed"}
                              >
                                <CheckCircle2 className="w-4 h-4" />
                              </button>

                              {task.contact_phone && (
                                <>
                                  <a
                                    href={`tel:${task.contact_phone}`}
                                    className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer"
                                    title={`Call ${task.contact_name || task.contact_phone}`}
                                  >
                                    <Phone className="w-3.5 h-3.5" />
                                  </a>
                                  <a
                                    href={`https://wa.me/${task.contact_phone.replace(/[^0-9]/g, "")}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                                    title={`WhatsApp ${task.contact_name || ""}`}
                                  >
                                    <MessageSquare className="w-3.5 h-3.5" />
                                  </a>
                                </>
                              )}

                              <button
                                type="button"
                                onClick={() => handleDelete(task.id)}
                                className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                                title="Delete Task"
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

            {/* TABLE FOOTER: Pagination & Bulk Action Bar matching Contacts Section */}
            <div className="p-3.5 border-t border-slate-200/80 bg-white flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500 font-medium shrink-0">
              {/* Left: Showing entries & Page Navigation Buttons + Bulk Actions */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-slate-700">
                  Showing <span className="font-bold">{startIdx}</span>-
                  <span className="font-bold">{endIdx}</span> of{" "}
                  <span className="font-bold">{filteredTasks.length}</span>
                </span>

                <div className="flex items-center gap-1 ml-2">
                  <button
                    type="button"
                    disabled={currentPage <= 1}
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>

                  <span className="px-2.5 py-1 rounded-md bg-red-600 text-white font-bold text-xs shadow-2xs">
                    {currentPage}
                  </span>

                  <button
                    type="button"
                    disabled={currentPage >= totalPages}
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Bulk Action Controls Matching Contacts Section */}
                {selectedIds.size > 0 && (
                  <div className="flex items-center gap-2 ml-3 animate-in fade-in duration-150 flex-wrap">
                    <span className="text-xs font-semibold text-red-600 bg-red-50 px-2.5 py-1 rounded-full border border-red-200">
                      {selectedIds.size} {selectedIds.size === 1 ? "task" : "tasks"} selected
                    </span>

                    <button
                      type="button"
                      onClick={handleBulkComplete}
                      className="bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 font-medium text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5 cursor-pointer transition-colors shadow-2xs"
                      title="Mark Selected Tasks as Done"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Mark Done</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleBulkDelete}
                      className="bg-rose-50 text-rose-600 border border-rose-200 hover:bg-rose-100 font-medium text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5 cursor-pointer transition-colors shadow-2xs"
                      title="Delete Selected Tasks"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-rose-600" />
                      <span>Delete Selected</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setSelectedIds(new Set())}
                      className="text-slate-500 hover:text-slate-700 text-xs px-2 py-1 rounded-md hover:bg-slate-100 transition-colors cursor-pointer font-medium"
                    >
                      Deselect All
                    </button>
                  </div>
                )}
              </div>

              {/* Right: Per Page Select Dropdown with Clean Spacing */}
              <div className="flex items-center gap-3 pr-2">
                <CustomDropdown
                  value={pageSize}
                  options={[
                    { value: 10, label: "Showing 10 Per Page" },
                    { value: 20, label: "Showing 20 Per Page" },
                    { value: 25, label: "Showing 25 Per Page" },
                    { value: 50, label: "Showing 50 Per Page" }
                  ]}
                  onChange={(val) => {
                    setPageSize(Number(val));
                    setCurrentPage(1);
                  }}
                  variant="minimal"
                  align="right"
                />
              </div>
            </div>
          </div>
        </main>
      </div>

      {/* Add Task Slide-Over Drawer */}
      <NewTaskDrawer
        isOpen={showAddDrawer}
        onClose={() => setShowAddDrawer(false)}
        onSubmit={handleCreateTaskDrawer}
        currentUser={currentUser}
      />

      {/* Contact Details Drawer (When Related Contact is Clicked) */}
      <ContactSlideDrawer
        contact={selectedContactForDrawer}
        isOpen={!!selectedContactForDrawer}
        onClose={() => setSelectedContactForDrawer(null)}
      />

      {/* In-app Call Dialer Modal */}
      {callModalTask && (
        <CallDialerModal
          isOpen={Boolean(callModalTask)}
          onClose={() => setCallModalTask(null)}
          contact={{
            id: callModalTask.contact_id || callModalTask.id,
            name: callModalTask.contact_name,
            phone: callModalTask.contact_phone
          }}
          onCallLogged={loadTasks}
        />
      )}
    </div>
  );
}
