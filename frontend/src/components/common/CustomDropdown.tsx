"use client";

import React, { useState, useRef, useEffect } from "react";
import { ChevronDown, Check } from "lucide-react";

export interface DropdownOption {
  value: string | number;
  label: string;
  dotColor?: string;
  badgeClass?: string;
  description?: string;
}

export interface CustomDropdownProps {
  value: string | number;
  options: (string | DropdownOption)[];
  onChange: (value: any) => void;
  placeholder?: string;
  variant?: "pill" | "input" | "badge" | "minimal";
  size?: "sm" | "md" | "lg";
  className?: string;
  disabled?: boolean;
  align?: "left" | "right";
  width?: string;
}

// Stage color mapping matching Zigmaa CRM design
export const getStageTheme = (stageName: string = "") => {
  const s = String(stageName).toLowerCase().trim();
  if (s === "new" || s === "new lead" || s === "new deal" || s === "open") {
    return {
      dot: "bg-blue-500",
      pill: "bg-blue-50/70 text-blue-700 border-blue-200 hover:bg-blue-50",
      badge: "bg-blue-50 text-blue-700 border-blue-200"
    };
  }
  if (s === "contacted" || s === "contact made" || s === "follow-up" || s.includes("contact")) {
    return {
      dot: "bg-amber-500",
      pill: "bg-amber-50/70 text-amber-700 border-amber-200 hover:bg-amber-50",
      badge: "bg-amber-50 text-amber-700 border-amber-200"
    };
  }
  if (s === "interested" || s === "discovery") {
    return {
      dot: "bg-indigo-500",
      pill: "bg-indigo-50/70 text-indigo-700 border-indigo-200 hover:bg-indigo-50",
      badge: "bg-indigo-50 text-indigo-700 border-indigo-200"
    };
  }
  if (s === "qualified" || s === "proposal" || s === "proposal sent" || s === "negotiation") {
    return {
      dot: "bg-purple-500",
      pill: "bg-purple-50/70 text-purple-700 border-purple-200 hover:bg-purple-50",
      badge: "bg-purple-50 text-purple-700 border-purple-200"
    };
  }
  if (s === "customer" || s === "won" || s === "closed won" || s === "converted") {
    return {
      dot: "bg-emerald-500",
      pill: "bg-emerald-50/70 text-emerald-700 border-emerald-200 hover:bg-emerald-50",
      badge: "bg-emerald-50 text-emerald-700 border-emerald-200"
    };
  }
  if (s === "lost" || s === "closed lost" || s === "disqualified" || s === "archived") {
    return {
      dot: "bg-rose-500",
      pill: "bg-rose-50/70 text-rose-700 border-rose-200 hover:bg-rose-50",
      badge: "bg-rose-50 text-rose-700 border-rose-200"
    };
  }
  return {
    dot: "bg-slate-400",
    pill: "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100",
    badge: "bg-slate-50 text-slate-700 border-slate-200"
  };
};

export default function CustomDropdown({
  value,
  options,
  onChange,
  placeholder = "Select",
  variant = "input",
  size = "md",
  className = "",
  disabled = false,
  align = "left",
  width
}: CustomDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [openUpward, setOpenUpward] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Normalize options
  const normalizedOptions: DropdownOption[] = options.map((opt) => {
    if (typeof opt === "object" && opt !== null) {
      return opt;
    }
    const theme = getStageTheme(String(opt));
    return {
      value: opt,
      label: String(opt),
      dotColor: theme.dot
    };
  });

  const selectedOption = normalizedOptions.find(
    (o) => String(o.value) === String(value)
  );

  const selectedTheme = getStageTheme(selectedOption ? selectedOption.label : String(value));

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Check viewport position when opening
  useEffect(() => {
    if (isOpen && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      // If less than 200px below, flip upward
      if (spaceBelow < 200 && rect.top > 200) {
        setOpenUpward(true);
      } else {
        setOpenUpward(false);
      }
    }
  }, [isOpen]);

  // Keyboard accessibility
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (e.key === "Escape") {
      setIsOpen(false);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setIsOpen((prev) => !prev);
    }
  };

  // Trigger button styles based on variant
  let triggerClasses = "";
  if (variant === "pill") {
    triggerClasses = `inline-flex items-center gap-1.5 py-1 pl-2.5 pr-2 rounded-full border text-[11px] font-medium transition-all cursor-pointer shadow-2xs select-none ${
      isOpen
        ? "border-red-400 ring-2 ring-red-100 bg-white"
        : selectedTheme.pill
    }`;
  } else if (variant === "badge") {
    triggerClasses = `inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-bold transition-all cursor-pointer shadow-2xs select-none ${
      isOpen
        ? "border-red-500 ring-2 ring-red-100"
        : selectedTheme.badge
    }`;
  } else if (variant === "minimal") {
    triggerClasses = `inline-flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:border-slate-300 text-slate-700 text-xs font-medium transition-all cursor-pointer shadow-2xs select-none ${
      isOpen ? "border-red-500 ring-2 ring-red-100" : ""
    }`;
  } else {
    // default / input variant
    const sizeClasses =
      size === "sm"
        ? "h-8 px-2.5 text-xs rounded-lg"
        : size === "lg"
        ? "h-11 px-4 text-sm rounded-xl"
        : "h-10 px-3.5 text-xs sm:text-sm rounded-xl";

    triggerClasses = `w-full flex items-center justify-between gap-2 bg-slate-50 hover:bg-slate-100/80 border text-slate-800 font-medium transition-all cursor-pointer shadow-2xs select-none ${sizeClasses} ${
      isOpen
        ? "border-red-500 ring-2 ring-red-100 bg-white"
        : "border-slate-200 hover:border-slate-300"
    }`;
  }

  return (
    <div
      ref={containerRef}
      className={`relative inline-block ${className}`}
      style={{ width: width || undefined }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Trigger Button */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen((prev) => !prev)}
        onKeyDown={handleKeyDown}
        className={`${triggerClasses} ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
      >
        <div className="flex items-center gap-1.5 truncate">
          {/* Status Dot for stage variants */}
          {(variant === "pill" || variant === "badge" || selectedOption?.dotColor) && (
            <span
              className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                selectedOption?.dotColor || selectedTheme.dot
              }`}
            />
          )}
          <span className="truncate">
            {selectedOption ? selectedOption.label : placeholder}
          </span>
        </div>

        <ChevronDown
          className={`w-3 h-3 shrink-0 text-slate-400 transition-transform duration-200 ${
            isOpen ? "rotate-180 text-red-500" : ""
          }`}
        />
      </button>

      {/* Custom Dropdown Floating Popover */}
      {isOpen && (
        <div
          className={`absolute z-60 min-w-[150px] w-max max-w-[260px] bg-white border border-slate-200/90 rounded-xl shadow-xl py-1 animate-in fade-in zoom-in-95 duration-100 ${
            align === "right" ? "right-0" : "left-0"
          } ${openUpward ? "bottom-full mb-1.5" : "top-full mt-1.5"}`}
        >
          <div className="max-h-60 overflow-y-auto custom-scrollbar p-1 space-y-0.5">
            {normalizedOptions.map((opt) => {
              const isSelected = String(opt.value) === String(value);
              const optTheme = getStageTheme(opt.label);

              return (
                <button
                  key={String(opt.value)}
                  type="button"
                  onClick={() => {
                    onChange(opt.value);
                    setIsOpen(false);
                  }}
                  className={`w-full flex items-center justify-between gap-2.5 px-3 py-1.5 rounded-lg text-xs transition-colors cursor-pointer text-left select-none ${
                    isSelected
                      ? "bg-red-50 text-red-700 font-semibold"
                      : "text-slate-700 hover:bg-slate-50 hover:text-slate-900"
                  }`}
                >
                  <div className="flex items-center gap-2 truncate">
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${
                        opt.dotColor || optTheme.dot
                      }`}
                    />
                    <span className="truncate">{opt.label}</span>
                  </div>

                  {isSelected && (
                    <Check className="w-3.5 h-3.5 text-red-600 shrink-0" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
