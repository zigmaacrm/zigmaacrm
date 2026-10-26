"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import {
  Calendar as CalendarIcon,
  Plus,
  Clock,
  User,
  Video,
  Download,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  CalendarCheck2,
  Trash2,
  Building2,
  CalendarCheck,
  PhoneCall,
  Sparkles,
  CalendarDays
} from "lucide-react";
import Sidebar from "@/components/layout/Sidebar";
import Header from "@/components/layout/Header";
import ScheduleMeetingDrawer from "@/components/calendar/ScheduleMeetingDrawer";
import { api, formatGoogleCalendarUrl, downloadIcsFile } from "@/lib/api";
import { CalendarEvent, Lead, Deal } from "@/lib/mockData";
import { useToast } from "@/components/common/ToastProvider";

export default function EventsCalendarPage() {
  const { toast, confirm } = useToast();
  const [mounted, setMounted] = useState(false);

  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [currentDate, setCurrentDate] = useState<Date>(new Date());
  const [viewMode, setViewMode] = useState<"Month" | "Week" | "Day">("Month");
  const [filterType, setFilterType] = useState<string>("All");

  // Slide Drawer State
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [drawerDate, setDrawerDate] = useState<Date | null>(null);
  const [drawerHour, setDrawerHour] = useState<number>(10);

  const loadAllData = useCallback(async () => {
    try {
      const [eventsData, leadsData, dealsData] = await Promise.all([
        api.getEvents(),
        api.getLeads(),
        api.getDeals()
      ]);
      setEvents(eventsData || []);
      setLeads(leadsData || []);
      setDeals(dealsData || []);
    } catch (e) {
      console.error("Error loading calendar data", e);
    }
  }, []);

  useEffect(() => {
    setMounted(true);
    loadAllData();
  }, [loadAllData]);

  // Open drawer helper
  const openDrawerWithDate = (targetDate: Date, hour = 10) => {
    setDrawerDate(targetDate);
    setDrawerHour(hour);
    setIsDrawerOpen(true);
  };

  const handleMeetingCreated = (saved: CalendarEvent) => {
    setEvents((prev) => {
      const filtered = prev.filter((e) => String(e.id) !== String(saved.id));
      return [saved, ...filtered];
    });
    // Re-sync with API
    api.getEvents().then((fresh) => {
      if (Array.isArray(fresh)) setEvents(fresh);
    }).catch(() => {});
  };

  const handleDeleteEvent = async (id: number | string) => {
    const event = events.find((e) => String(e.id) === String(id));
    const confirmed = await confirm({
      title: "Delete Meeting",
      message: `Are you sure you want to delete ${event ? `"${event.title}"` : "this meeting"}?`,
      confirmText: "Delete",
      cancelText: "Cancel",
      variant: "danger"
    });

    if (confirmed) {
      setEvents((prev) => prev.filter((e) => String(e.id) !== String(id)));
      try {
        await api.deleteEvent(id);
        toast.success("Meeting Deleted", "The calendar event was removed.");
      } catch (e) {
        console.error("Failed to delete event:", e);
      }
    }
  };

  const handleOpenGoogleCalendar = (ev: CalendarEvent) => {
    const url = formatGoogleCalendarUrl(ev);
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const handleDownloadIcs = (ev: CalendarEvent) => {
    downloadIcsFile(ev);
  };

  // Navigation handlers
  const handlePrev = () => {
    if (viewMode === "Month") {
      setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
    } else if (viewMode === "Week") {
      const d = new Date(currentDate);
      d.setDate(d.getDate() - 7);
      setCurrentDate(d);
    } else {
      const d = new Date(currentDate);
      d.setDate(d.getDate() - 1);
      setCurrentDate(d);
    }
  };

  const handleNext = () => {
    if (viewMode === "Month") {
      setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
    } else if (viewMode === "Week") {
      const d = new Date(currentDate);
      d.setDate(d.getDate() + 7);
      setCurrentDate(d);
    } else {
      const d = new Date(currentDate);
      d.setDate(d.getDate() + 1);
      setCurrentDate(d);
    }
  };

  const resetToToday = () => {
    setCurrentDate(new Date());
  };

  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayIndex = new Date(year, month, 1).getDay();

  // Filter events
  const filteredEvents = useMemo(() => {
    return events.filter((e) => {
      if (filterType === "All") return true;
      if (filterType === "Demos") return e.event_type === "Product Demo" || e.event_type === "Demo";
      if (filterType === "Discovery") return e.event_type === "Discovery Call";
      if (filterType === "Follow-up") return e.event_type === "Follow-up" || e.event_type === "Call";
      if (filterType === "Closing") return e.event_type === "Closing Meeting";
      return e.event_type === filterType;
    });
  }, [events, filterType]);

  // Week days calculation for Week View
  const weekDays = useMemo(() => {
    const curr = new Date(currentDate);
    const dayOfWeek = curr.getDay(); // 0 is Sunday
    const sunday = new Date(curr);
    sunday.setDate(curr.getDate() - dayOfWeek);

    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(sunday);
      d.setDate(sunday.getDate() + i);
      days.push(d);
    }
    return days;
  }, [currentDate]);

  // Metrics computation
  const totalScheduled = events.length;
  const productDemosCount = events.filter((e) => e.event_type === "Product Demo" || e.event_type === "Demo").length;
  const followUpCallsCount = events.filter((e) => e.event_type === "Follow-up" || e.event_type === "Call" || e.event_type === "Discovery Call").length;

  // Today's Meetings count calculation
  const todaysMeetingsCount = useMemo(() => {
    if (!mounted) return 0;
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const todayPrefix = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    return events.filter((e) => (e.start_time || "").startsWith(todayPrefix)).length;
  }, [events, mounted]);

  // Colored chips for events on calendar grid (emerald for Demos, rose for Calls, blue for Reviews)
  const getEventChipBadge = (type?: string) => {
    switch (type) {
      case "Product Demo":
      case "Demo":
        return {
          bg: "bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100",
          dot: "bg-emerald-500",
          icon: Video,
          label: "Demo"
        };
      case "Discovery Call":
      case "Call":
      case "Follow-up":
        return {
          bg: "bg-rose-50 text-rose-800 border-rose-200 hover:bg-rose-100",
          dot: "bg-rose-500",
          icon: PhoneCall,
          label: "Call"
        };
      case "Closing Meeting":
      case "Review":
      case "Closing":
        return {
          bg: "bg-blue-50 text-blue-800 border-blue-200 hover:bg-blue-100",
          dot: "bg-blue-500",
          icon: Sparkles,
          label: "Review"
        };
      default:
        return {
          bg: "bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100",
          dot: "bg-amber-500",
          icon: Clock,
          label: type
        };
    }
  };

  const formatEventDateDisplay = (isoStr: string) => {
    if (!isoStr) return "";
    try {
      const d = new Date(isoStr);
      return d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric"
      });
    } catch {
      return isoStr.slice(0, 10);
    }
  };

  const formatEventTimeDisplay = (startStr: string, endStr?: string) => {
    if (!startStr) return "";
    try {
      const s = new Date(startStr);
      const startTimePart = s.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true
      });
      if (!endStr) return startTimePart;
      const e = new Date(endStr);
      const endTimePart = e.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true
      });
      return `${startTimePart} – ${endTimePart}`;
    } catch {
      return startStr;
    }
  };

  return (
    <div className="flex h-screen bg-[#F8FAFC] dark:bg-[#0b0f19] text-slate-900 dark:text-slate-100 font-sans overflow-hidden select-none">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Header />

        <main className="flex-1 overflow-y-auto p-6 lg:p-8 space-y-6 custom-scrollbar bg-[#F8FAFC] dark:bg-[#0b0f19]">
          {/* Controls & Actions Row */}
          <div className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-semibold shadow-2xs">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              Google Calendar Ready
            </span>

            <div className="flex items-center gap-2.5">
              <button
                onClick={() => window.open("https://calendar.google.com", "_blank")}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-white border border-slate-200 text-slate-700 hover:border-red-500 hover:text-red-600 rounded-xl text-xs font-semibold shadow-xs transition-colors cursor-pointer"
                title="Open Google Calendar in New Tab"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Open Google Calendar</span>
              </button>

              <button
                onClick={() => openDrawerWithDate(new Date())}
                className="flex items-center gap-1.5 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-semibold shadow-sm transition-all cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Schedule Meeting</span>
              </button>
            </div>
          </div>

          {/* Top KPI Metric Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Card 1: Total Scheduled */}
            <div className="p-4 rounded-xl bg-white border border-slate-200 border-t-[3px] border-t-red-600 shadow-xs flex items-center justify-between">
              <div>
                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Total Scheduled</p>
                <p className="text-2xl font-bold text-slate-900 mt-1">{totalScheduled}</p>
                <p className="text-[10px] text-slate-400 mt-0.5">Active upcoming events</p>
              </div>
              <div className="p-2.5 rounded-xl bg-red-50 text-red-600">
                <CalendarIcon className="w-5 h-5" />
              </div>
            </div>

            {/* Card 2: Today's Meetings (Replaced non-metric card) */}
            <div className="p-4 rounded-xl bg-white border border-slate-200 border-t-[3px] border-t-emerald-500 shadow-xs flex items-center justify-between">
              <div>
                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Today&apos;s Meetings</p>
                <p className="text-2xl font-bold text-emerald-600 mt-1">{todaysMeetingsCount}</p>
                <p className="text-[10px] text-emerald-600/80 mt-0.5">Booked for today</p>
              </div>
              <div className="p-2.5 rounded-xl bg-emerald-50 text-emerald-600">
                <CalendarCheck2 className="w-5 h-5" />
              </div>
            </div>

            {/* Card 3: Product Demos */}
            <div className="p-4 rounded-xl bg-white border border-slate-200 border-t-[3px] border-t-blue-500 shadow-xs flex items-center justify-between">
              <div>
                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Product Demos</p>
                <p className="text-2xl font-bold text-slate-900 mt-1">{productDemosCount}</p>
                <p className="text-[10px] text-slate-400 mt-0.5">Live presentations</p>
              </div>
              <div className="p-2.5 rounded-xl bg-blue-50 text-blue-600">
                <Video className="w-5 h-5" />
              </div>
            </div>

            {/* Card 4: Follow-up Calls */}
            <div className="p-4 rounded-xl bg-white border border-slate-200 border-t-[3px] border-t-amber-500 shadow-xs flex items-center justify-between">
              <div>
                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Follow-up Calls</p>
                <p className="text-2xl font-bold text-slate-900 mt-1">{followUpCallsCount}</p>
                <p className="text-[10px] text-slate-400 mt-0.5">Discovery & client calls</p>
              </div>
              <div className="p-2.5 rounded-xl bg-amber-50 text-amber-600">
                <Clock className="w-5 h-5" />
              </div>
            </div>
          </div>

          {/* Main Grid: Interactive Calendar & Schedule Panel */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Calendar Container (8 cols) */}
            <div className="lg:col-span-8 p-6 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-4">
              {/* Calendar Controls & View Switcher */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
                <div className="flex items-center gap-3">
                  <h2 className="text-base font-bold text-slate-900">
                    {viewMode === "Month" && `${monthNames[month]} ${year}`}
                    {viewMode === "Week" &&
                      `${monthNames[weekDays[0].getMonth()]} ${weekDays[0].getDate()} – ${
                        monthNames[weekDays[6].getMonth()] !== monthNames[weekDays[0].getMonth()]
                          ? monthNames[weekDays[6].getMonth()] + " "
                          : ""
                      }${weekDays[6].getDate()}, ${weekDays[6].getFullYear()}`}
                    {viewMode === "Day" &&
                      currentDate.toLocaleDateString("en-US", {
                        weekday: "long",
                        month: "long",
                        day: "numeric",
                        year: "numeric"
                      })}
                  </h2>

                  <button
                    onClick={resetToToday}
                    className="px-2.5 py-1 text-[11px] font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors cursor-pointer"
                  >
                    Today
                  </button>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={handlePrev}
                      className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600 transition-colors cursor-pointer"
                      title="Previous"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button
                      onClick={handleNext}
                      className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600 transition-colors cursor-pointer"
                      title="Next"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* View Toggles [ Month | Week | Day ] */}
                <div className="flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200/80">
                  {(["Month", "Week", "Day"] as const).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setViewMode(mode)}
                      className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                        viewMode === mode
                          ? "bg-white text-red-600 shadow-xs font-bold"
                          : "text-slate-600 hover:text-slate-900"
                      }`}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
              </div>

              {/* VIEW 1: MONTH VIEW */}
              {viewMode === "Month" && (
                <div className="space-y-2">
                  <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-bold text-slate-400 uppercase pb-1">
                    <span>Sun</span>
                    <span>Mon</span>
                    <span>Tue</span>
                    <span>Wed</span>
                    <span>Thu</span>
                    <span>Fri</span>
                    <span>Sat</span>
                  </div>

                  <div className="grid grid-cols-7 gap-1.5">
                    {/* Padding before day 1 */}
                    {Array.from({ length: firstDayIndex }).map((_, idx) => (
                      <div
                        key={`empty-${idx}`}
                        className="h-24 bg-slate-50/40 rounded-xl border border-dashed border-slate-100"
                      />
                    ))}

                    {/* Real Days of the month */}
                    {Array.from({ length: daysInMonth }).map((_, idx) => {
                      const dayNum = idx + 1;
                      const dayDateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;
                      const dayEvents = filteredEvents.filter((e) => (e.start_time || "").startsWith(dayDateStr));
                      const isToday =
                        mounted &&
                        new Date().getDate() === dayNum &&
                        new Date().getMonth() === month &&
                        new Date().getFullYear() === year;

                      const thisCellDate = new Date(year, month, dayNum);

                      return (
                        <div
                          key={`day-${dayNum}`}
                          onClick={() => openDrawerWithDate(thisCellDate)}
                          className={`group h-24 p-2 rounded-xl border text-xs flex flex-col justify-between transition-all cursor-pointer relative hover:shadow-xs ${
                            isToday
                              ? "border-red-500 bg-red-50/25 ring-1 ring-red-500/30"
                              : "border-slate-100 bg-white hover:border-red-300 hover:bg-slate-50/60"
                          }`}
                          title={`Click to schedule a meeting on ${dayDateStr}`}
                        >
                          <div className="flex items-center justify-between">
                            <span
                              className={`w-6 h-6 flex items-center justify-center rounded-full text-[11px] font-semibold ${
                                isToday ? "bg-red-600 text-white shadow-2xs font-bold" : "text-slate-700"
                              }`}
                            >
                              {dayNum}
                            </span>
                            <span className="opacity-0 group-hover:opacity-100 transition-opacity text-[10px] text-red-600 font-bold">
                              + Add
                            </span>
                          </div>

                          {/* Event Colored Chips on booked days */}
                          <div className="space-y-1 overflow-hidden mt-1">
                            {dayEvents.slice(0, 2).map((ev) => {
                              const chip = getEventChipBadge(ev.event_type);
                              return (
                                <div
                                  key={ev.id}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openDrawerWithDate(thisCellDate);
                                  }}
                                  className={`text-[10px] truncate px-1.5 py-0.5 rounded-md font-semibold border flex items-center gap-1 transition-all ${chip.bg}`}
                                  title={`${ev.title} (${ev.event_type})`}
                                >
                                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${chip.dot}`} />
                                  <span className="truncate">{ev.title}</span>
                                </div>
                              );
                            })}
                            {dayEvents.length > 2 && (
                              <span className="text-[9px] font-bold text-slate-500 pl-1 block">
                                +{dayEvents.length - 2} more
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* VIEW 2: WEEK VIEW */}
              {viewMode === "Week" && (
                <div className="space-y-3">
                  <div className="grid grid-cols-7 gap-2">
                    {weekDays.map((d, index) => {
                      const dayNum = d.getDate();
                      const dayName = d.toLocaleDateString("en-US", { weekday: "short" });
                      const pad = (n: number) => String(n).padStart(2, "0");
                      const dateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(dayNum)}`;
                      const isToday =
                        mounted &&
                        new Date().getDate() === dayNum &&
                        new Date().getMonth() === d.getMonth() &&
                        new Date().getFullYear() === d.getFullYear();
                      const dayEvents = filteredEvents.filter((e) => (e.start_time || "").startsWith(dateStr));

                      return (
                        <div
                          key={`week-day-${index}`}
                          className={`rounded-xl border p-2 flex flex-col min-h-[360px] transition-all ${
                            isToday ? "border-red-500 bg-red-50/20" : "border-slate-200 bg-white"
                          }`}
                        >
                          <div
                            onClick={() => openDrawerWithDate(d)}
                            className="text-center pb-2 border-b border-slate-100 cursor-pointer hover:bg-slate-50 rounded-lg p-1 transition-colors"
                            title="Click to schedule on this day"
                          >
                            <span className="text-[10px] font-bold text-slate-400 uppercase block">{dayName}</span>
                            <span
                              className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold mt-0.5 ${
                                isToday ? "bg-red-600 text-white" : "text-slate-800"
                              }`}
                            >
                              {dayNum}
                            </span>
                          </div>

                          {/* Events for this week day */}
                          <div className="space-y-1.5 mt-2 flex-1 overflow-y-auto custom-scrollbar">
                            {dayEvents.map((ev) => {
                              const chip = getEventChipBadge(ev.event_type);
                              return (
                                <div
                                  key={ev.id}
                                  onClick={() => openDrawerWithDate(d)}
                                  className={`p-1.5 rounded-lg border text-left cursor-pointer transition-all hover:shadow-xs ${chip.bg}`}
                                >
                                  <p className="text-[10px] font-bold truncate leading-tight">{ev.title}</p>
                                  <p className="text-[9px] opacity-80 mt-0.5">
                                    {formatEventTimeDisplay(ev.start_time, ev.end_time)}
                                  </p>
                                </div>
                              );
                            })}

                            <button
                              onClick={() => openDrawerWithDate(d)}
                              className="w-full py-1.5 mt-1 border border-dashed border-slate-200 hover:border-red-300 hover:bg-red-50/50 rounded-lg text-[10px] text-slate-400 hover:text-red-600 font-semibold transition-all cursor-pointer"
                            >
                              + Add
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* VIEW 3: DAY VIEW */}
              {viewMode === "Day" && (
                <div className="space-y-3">
                  <div className="p-3 bg-red-50/50 border border-red-100 rounded-xl flex items-center justify-between text-xs">
                    <span className="font-semibold text-red-950">
                      Day Agenda: {currentDate.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", year: "numeric" })}
                    </span>
                    <button
                      onClick={() => openDrawerWithDate(currentDate)}
                      className="px-3 py-1 bg-red-600 text-white rounded-lg text-xs font-semibold hover:bg-red-700 cursor-pointer"
                    >
                      + Schedule Meeting
                    </button>
                  </div>

                  {/* Hourly timeline */}
                  <div className="divide-y divide-slate-100 border border-slate-100 rounded-xl overflow-hidden max-h-[420px] overflow-y-auto custom-scrollbar">
                    {[8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18].map((hour) => {
                      const pad = (n: number) => String(n).padStart(2, "0");
                      const hourDateStr = `${currentDate.getFullYear()}-${pad(currentDate.getMonth() + 1)}-${pad(currentDate.getDate())}T${pad(hour)}`;
                      const hourEvents = filteredEvents.filter((e) => (e.start_time || "").startsWith(hourDateStr));
                      const displayHour = hour > 12 ? `${hour - 12}:00 PM` : hour === 12 ? "12:00 PM" : `${hour}:00 AM`;

                      return (
                        <div
                          key={hour}
                          onClick={() => openDrawerWithDate(currentDate, hour)}
                          className="flex items-start p-2.5 hover:bg-slate-50 transition-colors group cursor-pointer"
                        >
                          <div className="w-20 text-[11px] font-bold text-slate-400 shrink-0 pt-1">
                            {displayHour}
                          </div>

                          <div className="flex-1 space-y-1">
                            {hourEvents.length > 0 ? (
                              hourEvents.map((ev) => {
                                const chip = getEventChipBadge(ev.event_type);
                                return (
                                  <div
                                    key={ev.id}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      openDrawerWithDate(currentDate, hour);
                                    }}
                                    className={`p-2 rounded-xl border flex items-center justify-between gap-2 cursor-pointer ${chip.bg}`}
                                  >
                                    <div>
                                      <span className="text-[11px] font-bold">{ev.title}</span>
                                      <p className="text-[10px] opacity-80">
                                        {formatEventTimeDisplay(ev.start_time, ev.end_time)} {ev.attendee_name ? `• ${ev.attendee_name}` : ""}
                                      </p>
                                    </div>
                                    {(ev.meeting_link || ev.meet_url || ev.location?.includes("http")) && (
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          window.open(ev.meeting_link || ev.meet_url || ev.location, "_blank");
                                        }}
                                        className="px-2 py-1 bg-white/90 text-red-700 hover:bg-white text-[10px] font-bold rounded-lg shadow-2xs flex items-center gap-1 cursor-pointer"
                                      >
                                        <Video className="w-3 h-3" />
                                        <span>Join</span>
                                      </button>
                                    )}
                                  </div>
                                );
                              })
                            ) : (
                              <div className="h-6 flex items-center text-[11px] text-slate-300 group-hover:text-red-600 transition-colors font-medium">
                                + Click to schedule at {displayHour}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Upcoming Schedule Panel (4 cols) */}
            <div className="lg:col-span-4 space-y-4">
              <div className="p-6 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">Upcoming Schedule</h3>
                    <p className="text-[11px] text-slate-400">Scheduled client interactions</p>
                  </div>
                  <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-red-50 text-red-600 border border-red-100">
                    {filteredEvents.length} meetings
                  </span>
                </div>

                {filteredEvents.length === 0 ? (
                  <div className="py-12 text-center space-y-3">
                    <div className="w-12 h-12 rounded-2xl bg-red-50 text-red-600 flex items-center justify-center mx-auto shadow-2xs">
                      <CalendarDays className="w-6 h-6" />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-slate-700">No events scheduled</p>
                      <p className="text-[11px] text-slate-400 mt-0.5 max-w-[220px] mx-auto leading-relaxed">
                        Tap any calendar date cell to schedule a client meeting and sync with Google.
                      </p>
                    </div>
                    {/* Duplicate button removed as requested in Section 4.2 */}
                  </div>
                ) : (
                  <div className="space-y-3 max-h-[480px] overflow-y-auto custom-scrollbar pr-0.5">
                    {filteredEvents.map((ev) => {
                      const chip = getEventChipBadge(ev.event_type);
                      const BadgeIcon = chip.icon;
                      const meetLink = ev.meeting_link || ev.meet_url || (ev.location?.includes("http") ? ev.location : "https://meet.google.com/new");
                      const hasMeet = Boolean(meetLink && meetLink.includes("meet.google.com"));

                      return (
                        <div
                          key={ev.id}
                          className="p-3.5 rounded-xl border border-slate-200 hover:border-red-300 transition-all bg-slate-50/40 hover:bg-white shadow-2xs space-y-2.5"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <span
                                className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md border ${chip.bg}`}
                              >
                                <BadgeIcon className="w-3 h-3" />
                                {ev.event_type}
                              </span>
                              <h4 className="text-xs font-bold text-slate-900 mt-1.5 leading-snug">{ev.title}</h4>
                            </div>

                            <button
                              onClick={() => handleDeleteEvent(ev.id)}
                              className="text-slate-300 hover:text-rose-600 p-1 rounded-md transition-colors cursor-pointer"
                              title="Delete meeting"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          <div className="text-[11px] text-slate-500 space-y-1.5 pt-0.5">
                            {/* Time range badge */}
                            <div className="inline-flex items-center gap-1.5 font-semibold text-slate-700 bg-white px-2 py-1 rounded-lg border border-slate-200/80 shadow-2xs">
                              <Clock className="w-3.5 h-3.5 text-red-600 shrink-0" />
                              <span>
                                {formatEventDateDisplay(ev.start_time)} • {formatEventTimeDisplay(ev.start_time, ev.end_time)}
                              </span>
                            </div>

                            {ev.lead_or_deal && (
                              <div className="flex items-center gap-1.5 truncate text-red-700 font-medium">
                                <Building2 className="w-3.5 h-3.5 shrink-0 text-red-500" />
                                <span className="truncate">{ev.lead_or_deal}</span>
                              </div>
                            )}

                            {ev.attendee_name && (
                              <div className="flex items-center gap-1.5 truncate text-slate-600">
                                <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                <span className="truncate font-medium">
                                  {ev.attendee_name} {ev.attendee_email ? `(${ev.attendee_email})` : ""}
                                </span>
                              </div>
                            )}
                          </div>

                          {/* Quick Actions Row with Join Google Meet Button */}
                          <div className="pt-2 border-t border-slate-200/60 flex items-center gap-2">
                            {hasMeet ? (
                              <button
                                onClick={() => window.open(meetLink, "_blank")}
                                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold rounded-lg shadow-2xs transition-colors cursor-pointer"
                                title="Join Google Meet Room"
                              >
                                <Video className="w-3.5 h-3.5" />
                                <span>Join Google Meet</span>
                              </button>
                            ) : (
                              <button
                                onClick={() => handleOpenGoogleCalendar(ev)}
                                className="flex-1 flex items-center justify-center gap-1 px-2.5 py-1.5 bg-red-600 hover:bg-red-700 text-white text-[11px] font-semibold rounded-lg shadow-2xs transition-colors cursor-pointer"
                              >
                                <CalendarCheck className="w-3.5 h-3.5" />
                                <span>Add to GCal</span>
                              </button>
                            )}

                            <button
                              onClick={() => handleOpenGoogleCalendar(ev)}
                              className="p-1.5 border border-slate-200 hover:bg-red-50 hover:text-red-700 text-slate-600 rounded-lg text-[11px] transition-colors cursor-pointer"
                              title="Sync to Google Calendar"
                            >
                              <CalendarCheck className="w-3.5 h-3.5" />
                            </button>

                            <button
                              onClick={() => handleDownloadIcs(ev)}
                              className="p-1.5 border border-slate-200 hover:bg-slate-100 text-slate-600 rounded-lg text-[11px] transition-colors cursor-pointer"
                              title="Download .ics Calendar File"
                            >
                              <Download className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </main>
      </div>

      {/* Schedule Meeting Slide-Over Drawer */}
      <ScheduleMeetingDrawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        onSuccess={handleMeetingCreated}
        initialDate={drawerDate}
        initialHour={drawerHour}
      />
    </div>
  );
}
