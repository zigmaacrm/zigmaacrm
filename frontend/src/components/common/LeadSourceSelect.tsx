"use client";

import React, { useState, useRef, useEffect, useMemo } from "react";
import { ChevronDown, Check, Search } from "lucide-react";
import { SourceIcon } from "@/components/common/SourceBadge";

export const DEFAULT_LEAD_SOURCES = [
  "Manual",
  "Meta Ads",
  "Google Ads",
  "Website Form",
  "Referral",
  "Cold Outreach",
  "WhatsApp",
  "Instagram",
  "LinkedIn Ads",
  "YouTube",
  "Advertisement",
  "Direct / Walk-in"
];

export interface LeadSourceSelectProps {
  value: string;
  onChange: (value: string) => void;
  options?: string[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

export default function LeadSourceSelect({
  value,
  onChange,
  options = DEFAULT_LEAD_SOURCES,
  placeholder = "Select Lead Source",
  className = "",
  disabled = false
}: LeadSourceSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  // Focus search input when popover opens
  useEffect(() => {
    if (isOpen) {
      setSearch("");
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
    }
  }, [isOpen]);

  const filteredOptions = useMemo(() => {
    if (!search.trim()) return options;
    return options.filter((opt) =>
      opt.toLowerCase().includes(search.toLowerCase())
    );
  }, [options, search]);

  const selectedValue = value || options[0] || "Manual";

  return (
    <div ref={containerRef} className={`relative w-full ${className}`}>
      {/* Trigger Button - Form Input Style matching outer dropdown */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setIsOpen((prev) => !prev)}
        className={`w-full h-10 px-3.5 flex items-center justify-between gap-2.5 bg-slate-50 border rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer select-none outline-none shadow-2xs ${
          isOpen
            ? "border-red-500 ring-2 ring-red-100 bg-white"
            : "border-slate-200 hover:border-slate-300 hover:bg-white"
        } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <SourceIcon source={selectedValue} className="w-4.5 h-4.5 shrink-0" />
          <span className="truncate text-slate-900 font-semibold">
            {selectedValue || placeholder}
          </span>
        </div>

        <ChevronDown
          className={`w-4 h-4 shrink-0 transition-transform duration-200 ${
            isOpen ? "rotate-180 text-red-600" : "text-slate-400"
          }`}
        />
      </button>

      {/* Modern Popover Dropdown Menu */}
      {isOpen && (
        <div className="absolute left-0 right-0 top-full mt-1.5 w-full min-w-[240px] bg-white border border-slate-200/90 rounded-2xl shadow-2xl py-2 z-50 animate-in fade-in zoom-in-95 duration-100">
          {/* Header & Quick Search */}
          <div className="px-3 pb-2 pt-1 border-b border-slate-100">
            <div className="flex items-center justify-between mb-1.5 px-1">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                Select Lead Source
              </span>
            </div>
            {options.length > 5 && (
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder="Filter sources..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-red-500 focus:bg-white"
                />
              </div>
            )}
          </div>

          {/* Options List */}
          <div className="max-h-56 overflow-y-auto custom-scrollbar p-1.5 space-y-0.5">
            {filteredOptions.length === 0 ? (
              <div className="py-4 text-center text-xs text-slate-400 font-medium">
                No matching sources
              </div>
            ) : (
              filteredOptions.map((opt) => {
                const active = selectedValue === opt;
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => {
                      onChange(opt);
                      setIsOpen(false);
                    }}
                    className={`w-full text-left px-3 py-2 text-xs font-semibold rounded-xl transition-all cursor-pointer flex items-center justify-between ${
                      active
                        ? "bg-red-50 text-red-600 font-bold"
                        : "text-slate-700 hover:bg-slate-50 hover:text-slate-900"
                    }`}
                  >
                    <div className="flex items-center gap-2.5 truncate">
                      <SourceIcon source={opt} className="w-4.5 h-4.5 shrink-0" />
                      <span className="truncate">{opt}</span>
                    </div>
                    {active && <Check className="w-4 h-4 text-red-600 shrink-0 ml-2" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
