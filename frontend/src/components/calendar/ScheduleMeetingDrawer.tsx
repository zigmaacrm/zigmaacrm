"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  X,
  CalendarCheck,
  Video,
  Copy,
  Check,
  Search,
  User,
  Building2,
  Clock,
  Sparkles,
  PhoneCall,
  Loader2,
  ExternalLink
} from "lucide-react";
import { api, formatGoogleCalendarUrl } from "@/lib/api";
import { CalendarEvent, Contact } from "@/lib/mockData";
import { useToast } from "@/components/common/ToastProvider";

interface ScheduleMeetingDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (event: CalendarEvent) => void;
  initialDate?: Date | null;
  initialHour?: number;
}

const EVENT_TYPES = [
  { id: "Product Demo", label: "Product Demo", icon: Video, color: "text-rose-600 bg-rose-50 border-rose-200" },
  { id: "Discovery Call", label: "Discovery Call", icon: PhoneCall, color: "text-blue-600 bg-blue-50 border-blue-200" },
  { id: "Follow-up", label: "Follow-up", icon: Clock, color: "text-amber-600 bg-amber-50 border-amber-200" },
  { id: "Closing Meeting", label: "Closing Meeting", icon: Sparkles, color: "text-emerald-600 bg-emerald-50 border-emerald-200" }
] as const;

export default function ScheduleMeetingDrawer({
  isOpen,
  onClose,
  onSuccess,
  initialDate,
  initialHour = 10
}: ScheduleMeetingDrawerProps) {
  const { toast } = useToast();

  const [visible, setVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Form fields
  const [title, setTitle] = useState("");
  const [eventType, setEventType] = useState<"Product Demo" | "Discovery Call" | "Follow-up" | "Closing Meeting">("Product Demo");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [includeGoogleMeet, setIncludeGoogleMeet] = useState(true);
  const [meetUrl, setMeetUrl] = useState("https://meet.google.com/zgm-sales-demo");
  const [customLocation, setCustomLocation] = useState("");
  const [copiedLink, setCopiedLink] = useState(false);

  // Associated Contact / Lead state
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [contactSearch, setContactSearch] = useState("");
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Attendee manual fields (auto-populated by contact)
  const [attendeeName, setAttendeeName] = useState("");
  const [attendeeEmail, setAttendeeEmail] = useState("");
  const [notes, setNotes] = useState("");

  // Animated close handler
  const handleClose = useCallback(() => {
    setVisible(false);
    setTimeout(() => {
      onClose();
    }, 280);
  }, [onClose]);

  // Handle ESC key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        handleClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, handleClose]);

  // Close contact search dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
    }
    if (isDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isDropdownOpen]);

  // Initialization when drawer opens
  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => setVisible(true), 10);

      // Generate dates
      const baseDate = initialDate ? new Date(initialDate) : new Date();
      if (!initialDate) {
        baseDate.setMinutes(0, 0, 0);
        baseDate.setHours(baseDate.getHours() + 1);
      } else {
        baseDate.setHours(initialHour, 0, 0, 0);
      }

      const endDateTime = new Date(baseDate.getTime() + 45 * 60 * 1000); // 45m default

      const pad = (n: number) => String(n).padStart(2, "0");
      const formatForInput = (d: Date) =>
        `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

      setStartTime(formatForInput(baseDate));
      setEndTime(formatForInput(endDateTime));

      // Generate unique Google Meet demo room
      const code = Math.random().toString(36).substring(2, 6) + "-" + Math.random().toString(36).substring(2, 5);
      setMeetUrl(`https://meet.google.com/zgm-${code}`);

      // Reset form fields
      setTitle("");
      setEventType("Product Demo");
      setIncludeGoogleMeet(true);
      setCustomLocation("");
      setSelectedContact(null);
      setContactSearch("");
      setAttendeeName("");
      setAttendeeEmail("");
      setNotes("");
      setSubmitting(false);

      // Fetch contacts
      api.getContacts()
        .then((data) => {
          if (Array.isArray(data)) {
            setContacts(data);
          }
        })
        .catch((err) => {
          console.warn("Failed to load contacts for calendar auto-fill:", err);
        });

      return () => clearTimeout(timer);
    } else {
      setVisible(false);
    }
  }, [isOpen, initialDate, initialHour]);

  // Quick duration setter
  const setQuickDuration = (minutes: number) => {
    if (!startTime) return;
    const start = new Date(startTime);
    const end = new Date(start.getTime() + minutes * 60 * 1000);
    const pad = (n: number) => String(n).padStart(2, "0");
    setEndTime(`${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}T${pad(end.getHours())}:${pad(end.getMinutes())}`);
  };

  // Filtered contacts based on search
  const filteredContacts = useMemo(() => {
    if (!contactSearch.trim()) return contacts.slice(0, 20);
    const q = contactSearch.toLowerCase();
    return contacts.filter(
      (c) =>
        (c.name && c.name.toLowerCase().includes(q)) ||
        (c.company_name && c.company_name.toLowerCase().includes(q)) ||
        (c.email && c.email.toLowerCase().includes(q)) ||
        (c.phone && c.phone.toLowerCase().includes(q))
    ).slice(0, 25);
  }, [contacts, contactSearch]);

  // Contact selection handler (Auto-fill requirement)
  const handleSelectContact = (c: Contact) => {
    setSelectedContact(c);
    setContactSearch(c.name || "Selected Contact");
    // Auto-fill attendee fields as requested:
    // Attendee Name -> contact.full_name / contact.name
    // Attendee Email -> contact.email
    // Retains contact_id in the event payload
    if (c.name) setAttendeeName(c.name);
    if (c.email) setAttendeeEmail(c.email);
    setIsDropdownOpen(false);
  };

  const handleClearContact = () => {
    setSelectedContact(null);
    setContactSearch("");
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(meetUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  // Submit Handler
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      toast.warning("Validation", "Meeting title is required.");
      return;
    }
    if (!startTime) {
      toast.warning("Validation", "Start time is required.");
      return;
    }

    setSubmitting(true);

    const generatedLocation = includeGoogleMeet
      ? meetUrl || "https://meet.google.com/zgm-live-meet"
      : customLocation || "In-person / Phone";

    const payload: Partial<CalendarEvent> = {
      title: title.trim(),
      event_type: eventType,
      start_time: startTime,
      end_time: endTime || startTime,
      meeting_link: includeGoogleMeet ? meetUrl : undefined,
      location: generatedLocation,
      meet_url: includeGoogleMeet ? meetUrl : undefined,
      attendee_name: attendeeName.trim() || undefined,
      attendee_email: attendeeEmail.trim() || undefined,
      contact_id: selectedContact ? selectedContact.id : undefined,
      lead_or_deal: selectedContact ? `${selectedContact.name}${selectedContact.company_name ? ` (${selectedContact.company_name})` : ""}` : undefined,
      notes: notes.trim() || undefined,
      description: notes.trim() || undefined,
      google_calendar_synced: false
    };

    try {
      const saved = await api.createEvent(payload);

      if (saved.google_calendar_synced || saved.google_event_id) {
        toast.success("Meeting Scheduled", "Synced to Google Calendar & Google Meet created!");
      } else {
        toast.success("Meeting Scheduled", "Meeting scheduled successfully!");
      }
      onSuccess(saved);
      handleClose();
    } catch (err) {
      console.error("Failed to save calendar meeting:", err);
      toast.error("Error", "Could not save meeting. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Schedule Meeting"
      className="fixed inset-0 z-50 overflow-hidden"
    >
      {/* 1. Fixed overlay backdrop */}
      <div
        onClick={handleClose}
        className={`fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-50 transition-opacity duration-300 ${
          visible ? "opacity-100" : "opacity-0"
        }`}
      />

      {/* 2. Full-height right slide-over drawer */}
      <div
        className={`fixed inset-y-0 right-0 z-50 w-full max-w-xl bg-white shadow-2xl flex flex-col h-full border-l border-slate-200 transition-transform duration-300 ease-out transform ${
          visible ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Sticky Top Header */}
        <div className="px-6 py-4.5 border-b border-slate-200/80 bg-slate-50/70 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-100 text-red-600 flex items-center justify-center shadow-xs">
              <CalendarCheck className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 leading-tight">Schedule Meeting</h2>
              <p className="text-xs text-slate-500 font-medium">
                Book client demos, follow-up calls, and sync with calendar
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors cursor-pointer"
            title="Close Drawer (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Middle Form Container */}
        <form
          id="schedule-meeting-form"
          onSubmit={handleSubmit}
          className="flex-1 overflow-y-auto px-6 py-5 space-y-4 custom-scrollbar"
        >
          {/* Meeting Subject / Title */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Meeting Subject / Title <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Product Demo with CloudScale Technologies"
              className="w-full bg-slate-50 text-slate-900 text-xs px-3.5 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-red-500 focus:bg-white font-medium transition-all"
            />
          </div>

          {/* Associated Lead / Deal (Searchable Select Dropdown with Auto-Fill) */}
          <div className="relative" ref={dropdownRef}>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-bold text-slate-700">
                Associated Lead / Contact (Optional)
              </label>
              {selectedContact && (
                <span className="text-[11px] font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                  Auto-fill Active
                </span>
              )}
            </div>

            <div className="relative">
              <input
                type="text"
                value={contactSearch}
                onChange={(e) => {
                  setContactSearch(e.target.value);
                  setIsDropdownOpen(true);
                }}
                onFocus={() => setIsDropdownOpen(true)}
                placeholder="Search contact by name, company, email..."
                className="w-full bg-slate-50 text-slate-900 text-xs pl-9 pr-9 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-red-500 focus:bg-white font-medium transition-all"
              />
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              {contactSearch && (
                <button
                  type="button"
                  onClick={handleClearContact}
                  className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 cursor-pointer"
                  title="Clear contact filter"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Dropdown Results */}
            {isDropdownOpen && (
              <div className="absolute z-20 left-0 right-0 mt-1.5 max-h-56 overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-xl p-1.5 custom-scrollbar space-y-1">
                <button
                  type="button"
                  onClick={() => {
                    handleClearContact();
                    setIsDropdownOpen(false);
                  }}
                  className="w-full text-left px-3 py-2 text-xs text-slate-500 hover:bg-slate-50 rounded-lg flex items-center justify-between"
                >
                  <span>• None / Internal Meeting</span>
                  <span className="text-[10px] text-slate-400">Clear</span>
                </button>

                {filteredContacts.length > 0 ? (
                  filteredContacts.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => handleSelectContact(c)}
                      className="w-full text-left px-3 py-2 text-xs rounded-lg hover:bg-red-50 hover:text-red-700 transition-colors flex items-center justify-between group"
                    >
                      <div className="truncate pr-2">
                        <span className="font-bold text-slate-900 group-hover:text-red-700 block truncate">
                          {c.name}
                        </span>
                        <span className="text-[11px] text-slate-400 group-hover:text-red-500 block truncate">
                          {c.company_name ? `${c.company_name} • ` : ""}{c.email || c.phone || "No email"}
                        </span>
                      </div>
                      <span className="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-600 group-hover:bg-red-100 group-hover:text-red-700">
                        Select
                      </span>
                    </button>
                  ))
                ) : (
                  <div className="p-3 text-center text-xs text-slate-400">
                    No contacts found matching &quot;{contactSearch}&quot;
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Meeting Type Selection */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">Meeting Type</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {EVENT_TYPES.map((m) => {
                const Icon = m.icon;
                const isSelected = eventType === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setEventType(m.id)}
                    className={`py-2 px-2.5 rounded-xl text-xs font-semibold border transition-all text-center flex flex-col items-center gap-1 cursor-pointer ${
                      isSelected
                        ? "bg-red-50 border-red-500 text-red-600 font-bold shadow-2xs ring-1 ring-red-500/30"
                        : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span className="truncate w-full">{m.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Start Date & Time and End Date & Time */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Start Date & Time <span className="text-red-500">*</span>
              </label>
              <input
                type="datetime-local"
                required
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full bg-slate-50 text-slate-900 text-xs px-3.5 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-red-500 focus:bg-white font-medium"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">End Date & Time</label>
              <input
                type="datetime-local"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full bg-slate-50 text-slate-900 text-xs px-3.5 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-red-500 focus:bg-white font-medium"
              />
            </div>
          </div>

          {/* Quick Duration Chips */}
          <div className="flex items-center gap-2 pt-0.5">
            <span className="text-xs font-bold text-slate-500">Quick Duration:</span>
            <div className="flex items-center gap-1.5">
              {[15, 30, 45, 60].map((mins) => (
                <button
                  key={mins}
                  type="button"
                  onClick={() => setQuickDuration(mins)}
                  className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-red-50 hover:text-red-600 text-slate-700 text-xs font-bold transition-colors cursor-pointer border border-slate-200/60"
                >
                  {mins}m
                </button>
              ))}
            </div>
          </div>

          {/* Add Google Meet Link (Toggle switch) */}
          <div className="p-3.5 bg-red-50/60 border border-red-200/70 rounded-xl space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Video className="w-4 h-4 text-red-600" />
                <span className="text-xs font-bold text-red-950">Add Google Meet Video Link</span>
              </div>

              {/* Toggle Switch */}
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeGoogleMeet}
                  onChange={(e) => setIncludeGoogleMeet(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-red-600"></div>
              </label>
            </div>

            {includeGoogleMeet ? (
              <div className="flex items-center gap-2 bg-white px-3 py-2 rounded-lg border border-red-200 text-xs">
                <span className="text-red-700 font-mono font-medium truncate flex-1">{meetUrl}</span>
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="text-red-700 hover:text-red-900 flex items-center gap-1 text-[11px] font-bold cursor-pointer shrink-0"
                >
                  {copiedLink ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                      <span className="text-emerald-600">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>
            ) : (
              <div>
                <input
                  type="text"
                  value={customLocation}
                  onChange={(e) => setCustomLocation(e.target.value)}
                  placeholder="Custom location (e.g. Office Boardroom, Zoom link, Phone)"
                  className="w-full bg-white text-slate-900 text-xs px-3 py-2 rounded-lg border border-red-200 focus:outline-none focus:ring-1 focus:ring-red-500 font-medium"
                />
              </div>
            )}
          </div>

          {/* Attendee Name & Email (Auto-filled by contact or manual) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Attendee Name
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={attendeeName}
                  onChange={(e) => setAttendeeName(e.target.value)}
                  placeholder="e.g. Sarah Jenkins"
                  className="w-full bg-slate-50 text-slate-900 text-xs pl-8 pr-3 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-red-500 focus:bg-white font-medium"
                />
                <User className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-3" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Attendee Email
              </label>
              <input
                type="email"
                value={attendeeEmail}
                onChange={(e) => setAttendeeEmail(e.target.value)}
                placeholder="sarah@example.com"
                className="w-full bg-slate-50 text-slate-900 text-xs px-3.5 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-red-500 focus:bg-white font-medium"
              />
            </div>
          </div>

          {/* Meeting Agenda & Notes */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Meeting Agenda & Notes
            </label>
            <textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Outline meeting points, goals, and follow-ups..."
              className="w-full bg-slate-50 text-slate-900 text-xs p-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-red-500 focus:bg-white font-medium custom-scrollbar"
            />
          </div>
        </form>

        {/* 3. Sticky Bottom Footer Bar */}
        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/80 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span>Auto-syncs with Google Calendar</span>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleClose}
              disabled={submitting}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-200/50 rounded-xl transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="schedule-meeting-form"
              disabled={submitting}
              className="px-5 py-2.5 bg-red-600 hover:bg-red-700 active:bg-red-800 text-white text-xs font-bold rounded-xl shadow-md shadow-red-600/20 transition-all disabled:opacity-50 flex items-center gap-2 cursor-pointer"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                <span>Save Schedule</span>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
