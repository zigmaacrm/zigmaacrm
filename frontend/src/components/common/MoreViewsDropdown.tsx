"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";

interface MoreViewsDropdownProps {
  views: string[];
  activeView: string;
  onSelect: (view: string) => void;
  className?: string;
}

export default function MoreViewsDropdown({
  views,
  activeView,
  onSelect,
  className = "",
}: MoreViewsDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const updatePosition = useCallback(() => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const menuWidth = 256; // 16rem (w-64)
      let left = rect.left;
      if (left + menuWidth > window.innerWidth - 12) {
        left = Math.max(12, window.innerWidth - menuWidth - 12);
      }
      setCoords({
        top: rect.bottom + 6,
        left: Math.max(12, left)
      });
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      updatePosition();

      function handleClickOutside(event: MouseEvent) {
        const target = event.target as Node;
        if (
          menuRef.current &&
          !menuRef.current.contains(target) &&
          buttonRef.current &&
          !buttonRef.current.contains(target)
        ) {
          setIsOpen(false);
        }
      }

      function handleScrollOrResize() {
        updatePosition();
      }

      document.addEventListener("mousedown", handleClickOutside);
      window.addEventListener("scroll", handleScrollOrResize, true);
      window.addEventListener("resize", handleScrollOrResize);

      return () => {
        document.removeEventListener("mousedown", handleClickOutside);
        window.removeEventListener("scroll", handleScrollOrResize, true);
        window.removeEventListener("resize", handleScrollOrResize);
      };
    }
  }, [isOpen, updatePosition]);

  const isMoreActive = views.includes(activeView);

  return (
    <div className={`relative inline-block shrink-0 ${className}`}>
      {/* More Button: ··· */}
      <button
        ref={buttonRef}
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          updatePosition();
          setIsOpen((prev) => !prev);
        }}
        className={`px-2.5 py-1.5 rounded-lg font-bold text-sm transition-all cursor-pointer select-none outline-none focus:outline-none focus:ring-0 border flex items-center justify-center ${
          isOpen || isMoreActive
            ? "border-red-200/80 bg-red-50 text-red-600 shadow-2xs font-bold"
            : "border-transparent text-slate-500 hover:text-slate-900 hover:bg-slate-100"
        }`}
        title="More views"
      >
        ···
      </button>

      {/* Popover Dropdown Menu (Rendered in Portal to escape scroll/overflow clipping) */}
      {isOpen && mounted && typeof document !== "undefined" && createPortal(
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-[99998]"
            onClick={() => setIsOpen(false)}
          />

          <div
            ref={menuRef}
            style={{
              position: "fixed",
              top: `${coords.top}px`,
              left: `${coords.left}px`,
              zIndex: 99999,
            }}
            className="w-64 max-h-80 overflow-y-auto bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl shadow-2xl py-2 animate-in fade-in zoom-in-95 duration-100 select-none custom-scrollbar"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-3 py-1 mb-1 border-b border-slate-100 dark:border-slate-800 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
              More Views
            </div>
            <div className="space-y-0.5">
              {views.map((view) => {
                const isSelected = activeView === view;
                return (
                  <button
                    key={view}
                    type="button"
                    onClick={() => {
                      onSelect(view);
                      setIsOpen(false);
                    }}
                    className={`w-[calc(100%-8px)] mx-1 text-left px-3.5 py-2 text-xs sm:text-sm transition-colors cursor-pointer flex items-center justify-between rounded-xl select-none ${
                      isSelected
                        ? "text-red-600 font-bold bg-red-50/80 dark:bg-red-950/40"
                        : "text-slate-700 dark:text-slate-200 hover:bg-red-50/50 dark:hover:bg-slate-800 hover:text-red-600 font-medium"
                    }`}
                  >
                    <span className="truncate">{view}</span>
                    {isSelected && (
                      <Check className="w-4 h-4 text-red-600 shrink-0 ml-2" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </>,
        document.body
      )}
    </div>
  );
}
