"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import {
  X,
  Phone,
  MessageSquare,
  Mail,
  Users,
  CheckSquare,
  Calendar,
  Clock,
  User,
  Search,
  Check,
  ChevronDown,
  AlertCircle
} from "lucide-react";
import { Task, Contact } from "@/lib/mockData";
import { api } from "@/lib/api";
import { useToast } from "@/components/common/ToastProvider";
import CustomDropdown from "@/components/common/CustomDropdown";
import CustomDatePicker from "@/components/common/CustomDatePicker";

interface NewTaskDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (taskData: Partial<Task>) => Promise<void>;
  currentUser?: any;
}

const ACTIVITY_TYPES = [
  { id: "Call", label: "Call", icon: Phone, color: "text-blue-600 bg-blue-50 border-blue-200" },
  { id: "WhatsApp", label: "WhatsApp", icon: MessageSquare, color: "text-emerald-600 bg-emerald-50 border-emerald-200" },
  { id: "Email", label: "Email", icon: Mail, color: "text-purple-600 bg-purple-50 border-purple-200" },
  { id: "Meeting", label: "Meeting", icon: Users, color: "text-indigo-600 bg-indigo-50 border-indigo-200" },
  { id: "To-Do", label: "To-Do", icon: CheckSquare, color: "text-slate-700 bg-slate-100 border-slate-200" }
];

const PRIORITIES = ["Low", "Medium", "High", "Urgent"];

const STATUS_OPTIONS = [
  { value: "Pending", label: "Pending", dotColor: "bg-amber-500" },
  { value: "To Do", label: "To Do", dotColor: "bg-slate-400" },
  { value: "In Progress", label: "In Progress", dotColor: "bg-blue-500" },
  { value: "Completed", label: "Completed", dotColor: "bg-emerald-500" },
];

export default function NewTaskDrawer({
  isOpen,
  onClose,
  onSubmit,
  currentUser
}: NewTaskDrawerProps) {
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);

  // Form State
  const [title, setTitle] = useState("");
  const [activityType, setActivityType] = useState("Call");
  const [dueDate, setDueDate] = useState("");
  const [dueTime, setDueTime] = useState("");
  const [priority, setPriority] = useState<string>("Medium");
  const [status, setStatus] = useState<string>("Pending");
  const [assignedTo, setAssignedTo] = useState(currentUser?.full_name || "Mohamed Thoufiq");
  const [description, setDescription] = useState("");

  // Contact association
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactSearch, setContactSearch] = useState("");
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [isContactDropdownOpen, setIsContactDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      api.getContacts()
        .then((data) => {
          if (Array.isArray(data)) setContacts(data);
        })
        .catch(() => {});

      // Prefill due date to tomorrow
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split("T")[0];
      setDueDate(tomorrow);
      setDueTime("04:30 PM");
    }
  }, [isOpen]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsContactDropdownOpen(false);
      }
    }
    if (isContactDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isContactDropdownOpen]);

  const filteredContacts = useMemo(() => {
    if (!contactSearch.trim()) return contacts.slice(0, 15);
    const q = contactSearch.toLowerCase();
    return contacts.filter(
      (c) =>
        (c.name && c.name.toLowerCase().includes(q)) ||
        (c.company_name && c.company_name.toLowerCase().includes(q)) ||
        (c.email && c.email.toLowerCase().includes(q)) ||
        (c.phone && c.phone.toLowerCase().includes(q))
    ).slice(0, 20);
  }, [contacts, contactSearch]);

  const handleSelectContact = (c: Contact) => {
    setSelectedContact(c);
    setContactSearch(c.name);
    setIsContactDropdownOpen(false);
  };

  const handleClearContact = () => {
    setSelectedContact(null);
    setContactSearch("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!title.trim()) {
      toast.warning("Validation", "Task title / subject is required.");
      return;
    }

    if (!dueDate) {
      toast.warning("Validation", "Please select a due date.");
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit({
        title: title.trim(),
        activity_type: activityType,
        due_date: dueDate,
        due_time: dueTime.trim() || undefined,
        priority: priority as any,
        status: status || "Pending",
        assigned_to: assignedTo.trim() || "Mohamed Thoufiq",
        description: description.trim() || undefined,
        contact_id: selectedContact?.id || undefined,
        contact_name: selectedContact?.name || (contactSearch.trim() || undefined),
        contact_phone: selectedContact?.phone || undefined,
        contact_company: selectedContact?.company_name || undefined
      });

      // Reset form
      setTitle("");
      setActivityType("Call");
      setPriority("Medium");
      setStatus("Pending");
      setDescription("");
      setSelectedContact(null);
      setContactSearch("");
      onClose();
    } catch (err: any) {
      toast.error("Error", err.message || "Failed to create task.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

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
        <div className="p-4 px-6 border-b border-slate-200 bg-white flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-base font-bold text-slate-900">Create New Task</h2>
            <p className="text-xs text-slate-500 font-medium mt-0.5">
              Schedule follow-ups, client meetings, calls, and to-do items
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
            title="Close drawer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Form Body */}
        <form
          id="new-task-drawer-form"
          onSubmit={handleSubmit}
          className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar text-xs"
        >
          {/* SECTION 1: TASK IDENTITY */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
              <CheckSquare className="w-4 h-4 text-red-600" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                1. Task Identity
              </h3>
            </div>

            {/* Subject / Title */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                Subject / Task Title <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Schedule discovery call regarding Enterprise ERP migration"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl text-xs px-3.5 py-2.5 text-slate-900 outline-none focus:ring-2 focus:ring-red-100 focus:border-red-400 font-medium transition-all"
              />
            </div>

            {/* Activity Type Selection Pills */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-2">
                Activity Type <span className="text-red-500">*</span>
              </label>
              <div className="grid grid-cols-5 gap-2">
                {ACTIVITY_TYPES.map((act) => {
                  const Icon = act.icon;
                  const isSelected = activityType === act.id;
                  return (
                    <button
                      key={act.id}
                      type="button"
                      onClick={() => setActivityType(act.id)}
                      className={`flex flex-col items-center justify-center p-2.5 rounded-xl border transition-all cursor-pointer select-none ${
                        isSelected
                          ? "bg-red-50 text-red-600 border-red-300 font-bold shadow-xs ring-1 ring-red-400"
                          : "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100 font-medium"
                      }`}
                    >
                      <Icon className="w-4 h-4 mb-1" />
                      <span className="text-[11px] leading-tight">{act.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* SECTION 2: ASSOCIATIONS & SCHEDULE */}
          <div className="space-y-4 pt-2">
            <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
              <Calendar className="w-4 h-4 text-red-600" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                2. Related Contact & Schedule
              </h3>
            </div>

            {/* Searchable Contact Selector */}
            <div className="relative" ref={dropdownRef}>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                Related Contact (CRM Link)
              </label>
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search contacts by name, email, phone or company..."
                  value={contactSearch}
                  onFocus={() => setIsContactDropdownOpen(true)}
                  onChange={(e) => {
                    setContactSearch(e.target.value);
                    setIsContactDropdownOpen(true);
                  }}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl text-xs pl-8.5 pr-8 py-2.5 text-slate-900 outline-none focus:ring-2 focus:ring-red-100 focus:border-red-400 font-medium transition-all"
                />
                {contactSearch && (
                  <button
                    type="button"
                    onClick={handleClearContact}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Contact Dropdown Popover */}
              {isContactDropdownOpen && (
                <div className="absolute left-0 right-0 top-full mt-1.5 max-h-56 overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-xl z-20 divide-y divide-slate-100 custom-scrollbar text-xs">
                  {filteredContacts.length === 0 ? (
                    <div className="p-3.5 text-center text-slate-400">
                      No matching contacts found.
                    </div>
                  ) : (
                    filteredContacts.map((c) => {
                      const isSelected = selectedContact?.id === c.id;
                      return (
                        <div
                          key={c.id}
                          onClick={() => handleSelectContact(c)}
                          className={`p-2.5 px-3 hover:bg-red-50/50 cursor-pointer flex items-center justify-between transition-colors ${
                            isSelected ? "bg-red-50/70" : ""
                          }`}
                        >
                          <div className="min-w-0">
                            <p className="font-semibold text-slate-800 truncate">{c.name}</p>
                            <p className="text-[11px] text-slate-500 truncate">
                              {c.company_name ? `${c.company_name} • ` : ""}
                              {c.phone || c.email || "No contact info"}
                            </p>
                          </div>
                          {isSelected && <Check className="w-4 h-4 text-red-600 shrink-0" />}
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>

            {/* Due Date & Due Time in Grid */}
            <div className="grid grid-cols-2 gap-3.5">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Due Date <span className="text-red-500">*</span>
                </label>
                <CustomDatePicker
                  value={dueDate}
                  onChange={(val) => setDueDate(val)}
                  placeholder="Select due date"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Due Time (Optional)
                </label>
                <div className="relative">
                  <Clock className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={dueTime}
                    onChange={(e) => setDueTime(e.target.value)}
                    placeholder="e.g. 04:30 PM"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl text-xs pl-8.5 pr-3 py-2.5 text-slate-900 outline-none focus:ring-2 focus:ring-red-100 focus:border-red-400 font-medium transition-all"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* SECTION 3: ASSIGNMENT & PRIORITY */}
          <div className="space-y-4 pt-2">
            <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
              <User className="w-4 h-4 text-red-600" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                3. Assignment & Priority
              </h3>
            </div>

            <div className="grid grid-cols-2 gap-3.5">
              {/* Priority */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Priority
                </label>
                <CustomDropdown
                  value={priority}
                  options={PRIORITIES.map(p => ({
                    value: p,
                    label: p,
                    dotColor: p === "High" ? "bg-red-500" : p === "Medium" ? "bg-amber-500" : "bg-blue-500"
                  }))}
                  onChange={(val) => setPriority(val)}
                  variant="input"
                />
              </div>

              {/* Status */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Status
                </label>
                <CustomDropdown
                  value={status}
                  options={STATUS_OPTIONS}
                  onChange={(val) => setStatus(val)}
                  variant="input"
                />
              </div>
            </div>

            {/* Assigned To */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                Assigned To
              </label>
              <input
                type="text"
                value={assignedTo}
                onChange={(e) => setAssignedTo(e.target.value)}
                placeholder="Mohamed Thoufiq"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl text-xs px-3.5 py-2.5 text-slate-900 outline-none focus:ring-2 focus:ring-red-100 focus:border-red-400 font-medium transition-all"
              />
            </div>

            {/* Description / Notes */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                Notes & Instructions
              </label>
              <textarea
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Include agenda, context, or key talking points..."
                className="w-full bg-slate-50 border border-slate-200 rounded-xl text-xs px-3.5 py-2.5 text-slate-900 outline-none focus:ring-2 focus:ring-red-100 focus:border-red-400 font-medium transition-all resize-none"
              />
            </div>
          </div>
        </form>

        {/* Fixed Sticky Footer */}
        <div className="p-4 px-6 border-t border-slate-200 bg-white flex items-center justify-end gap-3 shrink-0 shadow-lg">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2.5 text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="new-task-drawer-form"
            disabled={submitting}
            className="px-5 py-2.5 bg-red-600 hover:bg-red-700 active:bg-red-800 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-red-600/20 cursor-pointer disabled:opacity-50 flex items-center gap-2"
          >
            {submitting ? "Creating Task..." : "Create Task"}
          </button>
        </div>

      </div>
    </div>
  );
}
