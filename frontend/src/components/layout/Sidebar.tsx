"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import {
  LayoutDashboard,
  BookUser,
  User,
  Handshake,
  CalendarDays,
  ListTodo,
  Bot,
  Settings,
  ChevronLeft,
  ArrowLeftToLine,
  Maximize2,
  PanelLeftOpen,
  FileText,
  MessageSquare
} from "lucide-react";
import { cn } from "@/lib/utils";

export default function Sidebar() {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [hidden, setHidden] = useState(false);
  const [hasInteracted, setHasInteracted] = useState(false);
  const [hoveredItem, setHoveredItem] = useState<{ name: string; top: number; icon: any } | null>(null);

  useEffect(() => {
    setMounted(true);
    try {
      const savedState = localStorage.getItem("zigmaa_sidebar_expanded");
      if (savedState !== null) {
        setExpanded(savedState === "true");
      }
      const savedHidden = localStorage.getItem("zigmaa_sidebar_hidden");
      if (savedHidden !== null) {
        setHidden(savedHidden === "true");
      }
    } catch {
      // Ignore localStorage access restrictions
    }
  }, []);

  const handleCollapse = () => {
    setHasInteracted(true);
    setExpanded(false);
    setHidden(false);
    if (typeof window !== "undefined") {
      localStorage.setItem("zigmaa_sidebar_expanded", "false");
      localStorage.setItem("zigmaa_sidebar_hidden", "false");
      window.dispatchEvent(new CustomEvent("zigmaa_sidebar_toggle", { detail: { hidden: false, expanded: false } }));
    }
  };

  const handleHide = () => {
    setHasInteracted(true);
    setHidden(true);
    if (typeof window !== "undefined") {
      localStorage.setItem("zigmaa_sidebar_hidden", "true");
      window.dispatchEvent(new CustomEvent("zigmaa_sidebar_toggle", { detail: { hidden: true, expanded } }));
    }
  };

  const handleShow = () => {
    setHasInteracted(true);
    setHidden(false);
    setExpanded(true);
    if (typeof window !== "undefined") {
      localStorage.setItem("zigmaa_sidebar_hidden", "false");
      localStorage.setItem("zigmaa_sidebar_expanded", "true");
      window.dispatchEvent(new CustomEvent("zigmaa_sidebar_toggle", { detail: { hidden: false, expanded: true } }));
    }
  };

  const handleExpand = () => {
    setHasInteracted(true);
    setExpanded(true);
    setHidden(false);
    if (typeof window !== "undefined") {
      localStorage.setItem("zigmaa_sidebar_expanded", "true");
      localStorage.setItem("zigmaa_sidebar_hidden", "false");
      window.dispatchEvent(new CustomEvent("zigmaa_sidebar_toggle", { detail: { hidden: false, expanded: true } }));
    }
  };

  const toggleExpand = () => {
    if (!expanded) {
      handleExpand();
    } else {
      handleCollapse();
    }
  };

  const handleMouseEnter = (e: React.MouseEvent<HTMLDivElement>, name: string, icon: any) => {
    if (expanded) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setHoveredItem({
      name,
      top: rect.top + rect.height / 2,
      icon
    });
  };

  const currentPath = pathname || "";

  const navSections = [
    {
      title: "OVERVIEW",
      items: [{ name: "Dashboard", href: "/", icon: LayoutDashboard }]
    },
    {
      title: "SALES",
      items: [
        { name: "Contacts", href: "/contacts", icon: User },
        { name: "Deals", href: "/pipeline", icon: Handshake }
      ]
    },
    {
      title: "ACTIVITIES",
      items: [
        { name: "Tasks", href: "/tasks", icon: ListTodo },
        { name: "Quotations", href: "/quotes", icon: FileText },
        { name: "Calendar & Schedule", href: "/events", icon: CalendarDays }
      ]
    },
    {
      title: "AUTOMATIONS",
      items: [
        { name: "Automations", href: "/automations", icon: Bot }
      ]
    },
    {
      title: "ENGAGEMENT",
      items: [
        { name: "WhatsApp", href: "/whatsapp", icon: MessageSquare }
      ]
    },
    {
      title: "SETTINGS",
      items: [{ name: "Settings", href: "/settings", icon: Settings }]
    }
  ];



  return (
    <>
      {/* Floating Trigger to Show Sidebar when Hidden (Image 3) */}
      {hidden && (
        <button
          onClick={handleShow}
          className="fixed top-3 left-4 z-50 p-2.5 bg-white hover:bg-slate-50 border border-slate-200 hover:border-red-300 text-slate-700 hover:text-red-600 rounded-xl shadow-xs transition-all cursor-pointer flex items-center justify-center group"
          title="Show sidebar"
        >
          <PanelLeftOpen className="w-4.5 h-4.5 text-slate-600 group-hover:text-red-600" />
        </button>
      )}

      <aside
        suppressHydrationWarning
        className={cn(
          "bg-[#0B0F19] text-slate-300 flex flex-col border-r border-[#1E293B] shadow-2xl z-40 shrink-0 select-none h-screen relative",
          hasInteracted && "transition-[width] duration-300 ease-in-out",
          hidden ? "w-0 p-0 border-none overflow-hidden" : expanded ? "w-60" : "w-16"
        )}
        onMouseLeave={() => setHoveredItem(null)}
      >
        {/* Top Header Row with Logo & Workspace Name */}
        <div className="h-16 flex items-center justify-between px-3 border-b border-[#1E293B] bg-[#0B0F19]">
          <button
            onClick={toggleExpand}
            className="flex items-center gap-2.5 w-full p-1 rounded-xl hover:bg-white/10 transition-colors group text-left cursor-pointer"
            title={expanded ? "Click to collapse sidebar" : "Click to expand sidebar"}
          >
            <img
              src="/crmlogo.png"
              alt="Zigmaa CRM"
              className="h-9 w-9 rounded-xl object-cover shrink-0 select-none pointer-events-none group-hover:scale-105 transition-transform"
            />
            {expanded && (
              <div className="flex-1 flex items-center justify-between min-w-0 pr-1">
                <span className="font-bold text-sm text-white truncate tracking-tight">
                  Zigmaa CRM
                </span>
                <div className="p-1 rounded-lg bg-white/5 text-slate-400 group-hover:text-white">
                  <ChevronLeft className="w-3.5 h-3.5" />
                </div>
              </div>
            )}
          </button>
        </div>

        {/* Navigation Menu with Section Titles */}
        <nav
          className="flex-1 py-3 px-2.5 space-y-4 overflow-y-auto no-scrollbar flex flex-col [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
          style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
        >
          {navSections.map((section) => (
            <div key={section.title} className="space-y-1">
              {/* Section Header Title (Visible only when expanded) */}
              {expanded ? (
                <div className="px-3 pt-2 pb-1 text-[10px] font-extrabold text-slate-400 uppercase tracking-wider">
                  {section.title}
                </div>
              ) : (
                <div className="h-1 my-1 border-t border-[#1E293B]" />
              )}

              {/* Section Items */}
              {section.items.map((item) => {
                const Icon = item.icon;
                const isActive =
                  item.href === "/"
                    ? currentPath === "/"
                    : currentPath.startsWith(item.href) ||
                      (item.href === "/pipeline" && currentPath.startsWith("/deals"));

                return (
                  <div
                    key={item.name}
                    className="relative group w-full flex justify-center"
                    onMouseEnter={(e) => handleMouseEnter(e, item.name, item.icon)}
                    onMouseLeave={() => setHoveredItem(null)}
                  >
                    <Link
                      href={item.href}
                      prefetch={true}
                      onClick={() => {
                        if (typeof window !== "undefined" && currentPath !== item.href) {
                          window.dispatchEvent(new CustomEvent("zigmaa_nav_start", { detail: { to: item.href } }));
                        }
                      }}
                      className={cn(
                        "rounded-xl transition-all duration-150 relative flex items-center font-semibold text-xs active:scale-[0.98]",
                        expanded
                          ? "w-full px-3.5 py-2.5 justify-start gap-3"
                          : "w-11 h-11 justify-center p-2.5",
                        isActive
                          ? "bg-gradient-to-r from-red-600 to-rose-600 text-white shadow-lg shadow-red-950/60 font-bold"
                          : "text-slate-300 hover:text-white hover:bg-white/10"
                      )}
                    >
                      {/* Active Left Glowing Strip Indicator */}
                      {isActive && (
                        <span className="absolute -left-2.5 top-1/2 -translate-y-1/2 w-1.5 h-6 bg-rose-400 rounded-r-full shadow-glow" />
                      )}

                      <Icon
                        className={cn(
                          "h-4 w-4 shrink-0 transition-transform group-hover:scale-105",
                          isActive ? "text-white" : "text-slate-400 group-hover:text-white"
                        )}
                      />
                      {expanded && <span className="truncate text-xs font-semibold">{item.name}</span>}
                    </Link>
                  </div>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Bottom Actions Section */}
        <div className="p-2.5 border-t border-[#1E293B] w-full flex justify-center">
          {expanded ? (
            /* Expanded Mode: Collapse & Hide Controls (Image 1) */
            <div className="w-full bg-[#111827]/90 border border-slate-700/60 rounded-xl p-1 flex items-center justify-between text-xs">
              <button
                onClick={handleCollapse}
                className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 transition-colors font-medium cursor-pointer"
                title="Collapse sidebar"
              >
                <ArrowLeftToLine className="w-3.5 h-3.5 text-slate-400" />
                <span>Collapse</span>
              </button>
              <div className="w-px h-4 bg-slate-700/60" />
              <button
                onClick={handleHide}
                className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 transition-colors font-medium cursor-pointer"
                title="Hide sidebar"
              >
                <Maximize2 className="w-3.5 h-3.5 text-slate-400" />
                <span>Hide</span>
              </button>
            </div>
          ) : (
            /* Collapsed Mode: Sleek, high-contrast Show button */
            <div className="relative group flex justify-center w-full">
              <button
                onClick={handleExpand}
                className="w-11 h-11 rounded-xl bg-slate-900/90 hover:bg-gradient-to-tr hover:from-red-600 hover:to-rose-600 border border-slate-700/80 hover:border-red-500/50 text-slate-300 hover:text-white flex flex-col items-center justify-center gap-0.5 transition-all duration-200 cursor-pointer shadow-md hover:shadow-lg hover:shadow-red-950/60 active:scale-95"
                title="Expand sidebar"
              >
                <PanelLeftOpen className="w-4 h-4 text-slate-400 group-hover:text-white transition-transform group-hover:scale-110" />
                <span className="text-[9px] font-extrabold uppercase tracking-wider text-slate-400 group-hover:text-white leading-none">
                  Show
                </span>
              </button>
              
              {/* Flyout Tooltip on hover */}
              <div className="opacity-0 group-hover:opacity-100 pointer-events-none absolute left-14 top-1/2 -translate-y-1/2 px-2.5 py-1.5 bg-[#111827] text-white text-xs font-bold rounded-xl shadow-2xl border border-slate-700 whitespace-nowrap z-50 transition-opacity duration-150 flex items-center gap-1.5">
                <PanelLeftOpen className="w-3.5 h-3.5 text-rose-400" />
                <span>Expand Sidebar</span>
              </div>
            </div>
          )}
        </div>

      {/* Dynamic Fixed Flyout Tooltip (Renders cleanly outside nav overflow clipping) */}
      {!expanded && hoveredItem && (
        <div
          className="fixed left-20 -translate-y-1/2 px-3.5 py-2 bg-[#111827] text-white text-xs font-bold rounded-xl shadow-2xl border border-slate-700 z-50 flex items-center gap-2.5 whitespace-nowrap pointer-events-none transition-all duration-150 animate-in fade-in zoom-in-95"
          style={{ top: `${hoveredItem.top}px` }}
        >
          <hoveredItem.icon className="w-4 h-4 text-rose-400" />
          <span>{hoveredItem.name}</span>
        </div>
      )}
    </aside>
  </>
  );
}
