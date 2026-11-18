"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { SlidersHorizontal, RotateCcw, Lock, Check, Sliders, Sparkles } from "lucide-react";
import { api } from "@/lib/api";

export interface ColumnDefinition {
  id: string;
  label: string;
  locked?: boolean;
  isCustom?: boolean;
}

export interface CustomFieldItem {
  id: string;
  module: string;
  label: string;
  key: string;
  field_key?: string;
  field_type: string;
  options?: string[] | null;
  is_required?: boolean;
  is_active?: boolean;
}

/**
 * Custom Hook to handle column preferences persistence in localStorage
 */
export function useColumnVisibility(
  storageKey: string,
  columns: ColumnDefinition[],
  extraColumns: ColumnDefinition[] = []
) {
  const combinedColumns = useMemo(() => {
    const map = new Map<string, ColumnDefinition>();
    columns.forEach((c) => map.set(c.id, c));
    extraColumns.forEach((c) => {
      if (!map.has(c.id)) {
        map.set(c.id, c);
      }
    });
    return Array.from(map.values());
  }, [columns, extraColumns]);

  const getDefaultState = useCallback(() => {
    const state: Record<string, boolean> = {};
    combinedColumns.forEach((col) => {
      state[col.id] = true;
    });
    return state;
  }, [combinedColumns]);

  // Read initial state once from localStorage during lazy initialization
  const [visibleColumns, setVisibleColumns] = useState<Record<string, boolean>>(() => {
    const state: Record<string, boolean> = {};
    columns.forEach((col) => {
      state[col.id] = true;
    });
    extraColumns.forEach((col) => {
      state[col.id] = true;
    });

    if (typeof window !== "undefined") {
      try {
        const stored = localStorage.getItem(storageKey);
        if (stored) {
          const parsed = JSON.parse(stored);
          if (typeof parsed === "object" && parsed !== null) {
            columns.forEach((col) => {
              if (col.locked) {
                state[col.id] = true;
              } else if (typeof parsed[col.id] === "boolean") {
                state[col.id] = parsed[col.id];
              }
            });
            extraColumns.forEach((col) => {
              if (col.locked) {
                state[col.id] = true;
              } else if (typeof parsed[col.id] === "boolean") {
                state[col.id] = parsed[col.id];
              }
            });
          }
        }
      } catch (e) {
        console.warn("Failed to read column preferences from localStorage", e);
      }
    }
    return state;
  });
  const [isLoaded, setIsLoaded] = useState(true);

  // When combinedColumns change, update visibleColumns: add new columns, and purge removed custom fields
  // Return `prev` if no change so React avoids infinite re-render loops
  useEffect(() => {
    setVisibleColumns((prev) => {
      let hasChanges = false;
      const next = { ...prev };
      const validIds = new Set(combinedColumns.map((c) => c.id));

      // 1. Purge removed / deleted fields so they NEVER linger
      Object.keys(next).forEach((key) => {
        if (!validIds.has(key)) {
          delete next[key];
          hasChanges = true;
        }
      });

      // 2. Add new unconfigured columns
      combinedColumns.forEach((col) => {
        if (col.locked) {
          if (next[col.id] !== true) {
            next[col.id] = true;
            hasChanges = true;
          }
        } else if (next[col.id] === undefined) {
          next[col.id] = true;
          hasChanges = true;
        }
      });

      if (hasChanges && typeof window !== "undefined") {
        try {
          localStorage.setItem(storageKey, JSON.stringify(next));
        } catch (_) {}
      }

      return hasChanges ? next : prev;
    });
  }, [combinedColumns, storageKey]);

  const toggleColumn = useCallback((columnId: string) => {
    const col = combinedColumns.find((c) => c.id === columnId);
    if (col?.locked) return;

    setVisibleColumns((prev) => {
      const updated = {
        ...prev,
        [columnId]: !prev[columnId]
      };
      try {
        localStorage.setItem(storageKey, JSON.stringify(updated));
      } catch (e) {
        console.warn("Failed to persist column preferences", e);
      }
      return updated;
    });
  }, [combinedColumns, storageKey]);

  const resetColumns = useCallback(() => {
    const defaultState = getDefaultState();
    setVisibleColumns(defaultState);
    try {
      localStorage.setItem(storageKey, JSON.stringify(defaultState));
    } catch (e) {
      console.warn("Failed to reset column preferences in localStorage", e);
    }
  }, [getDefaultState, storageKey]);

  return {
    visibleColumns,
    toggleColumn,
    resetColumns,
    isLoaded
  };
}

interface ColumnCustomizerPopoverProps {
  storageKey: string;
  module?: "contacts" | "deals" | "companies" | string;
  columns: ColumnDefinition[];
  visibleColumns: Record<string, boolean>;
  onToggle: (columnId: string) => void;
  onReset: () => void;
  onOpenCustomFields?: () => void;
  onCustomFieldsLoaded?: (fields: CustomFieldItem[]) => void;
  buttonClassName?: string;
  tooltipText?: string;
}

export default function ColumnCustomizerPopover({
  module,
  columns,
  visibleColumns,
  onToggle,
  onReset,
  onOpenCustomFields,
  onCustomFieldsLoaded,
  buttonClassName,
  tooltipText = "Customize Columns"
}: ColumnCustomizerPopoverProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [moduleCustomFields, setModuleCustomFields] = useState<CustomFieldItem[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  // Store onCustomFieldsLoaded callback in a ref to avoid dependency-driven re-render loops
  const onCustomFieldsLoadedRef = useRef(onCustomFieldsLoaded);
  onCustomFieldsLoadedRef.current = onCustomFieldsLoaded;

  // Load custom fields if module is provided
  const loadModuleCustomFields = useCallback(async () => {
    if (!module) return;
    try {
      const data = await api.getCustomFields(module);
      const activeFields = (data || []).filter((f: any) => f.is_active !== false);
      setModuleCustomFields((prev) => {
        if (
          prev.length === activeFields.length &&
          prev.every((p, i) => (p.key || p.id) === (activeFields[i]?.key || activeFields[i]?.id))
        ) {
          return prev;
        }
        return activeFields;
      });
      if (onCustomFieldsLoadedRef.current) {
        onCustomFieldsLoadedRef.current(activeFields);
      }
    } catch (e) {
      console.warn("Failed to load custom fields in ColumnCustomizerPopover", e);
    }
  }, [module]);

  useEffect(() => {
    loadModuleCustomFields();

    const handleCustomFieldsUpdated = (e: any) => {
      if (!module || !e.detail?.module || e.detail.module.includes(module.toLowerCase().slice(0, 4))) {
        loadModuleCustomFields();
      }
    };
    window.addEventListener("zigmaa_custom_fields_updated", handleCustomFieldsUpdated);
    return () => {
      window.removeEventListener("zigmaa_custom_fields_updated", handleCustomFieldsUpdated);
    };
  }, [loadModuleCustomFields, module]);

  // Combine standard columns with dynamically loaded custom fields
  const allColumns = useMemo(() => {
    const list = [...columns];
    const existingIds = new Set(list.map((c) => c.id));

    moduleCustomFields.forEach((cf) => {
      const colId = cf.key || cf.field_key || cf.label.toLowerCase().replace(/[^a-z0-9]/g, "_");
      if (!existingIds.has(colId)) {
        list.push({
          id: colId,
          label: cf.label,
          isCustom: true
        });
        existingIds.add(colId);
      }
    });

    return list;
  }, [columns, moduleCustomFields]);

  // Close on outside click or Escape
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleKeyDown);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const totalColumns = allColumns.length;
  const visibleCount = allColumns.filter((col) => col.locked || visibleColumns[col.id] !== false).length;
  const hasHiddenColumns = visibleCount < totalColumns;

  return (
    <div className="relative shrink-0" ref={containerRef}>
      {/* Slider Button */}
      <button
        type="button"
        onClick={() => {
          if (!isOpen && module) {
            loadModuleCustomFields();
          }
          setIsOpen((prev) => !prev);
        }}
        className={buttonClassName || `w-9 h-9 bg-white border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50 rounded-xl shadow-2xs transition-all cursor-pointer flex items-center justify-center relative ${
          isOpen ? "ring-2 ring-red-500/20 border-red-300 text-red-600 bg-red-50/20" : ""
        }`}
        aria-label={tooltipText}
        aria-expanded={isOpen}
        title={tooltipText}
      >
        <SlidersHorizontal className="w-4 h-4" />
        {/* Subtle dot badge if custom column visibility active */}
        {hasHiddenColumns && (
          <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-red-600 rounded-full" />
        )}
      </button>

      {/* Floating Menu Popover */}
      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-76 bg-white rounded-2xl shadow-xl border border-slate-200 py-3 z-50 animate-in fade-in zoom-in-95 duration-150 select-none">
          {/* Header */}
          <div className="px-3.5 pb-2.5 mb-1 border-b border-slate-100 flex items-center justify-between">
            <div className="flex flex-col">
              <span className="text-xs font-bold text-slate-900 tracking-tight">Customize Columns</span>
              <span className="text-[11px] text-slate-400 font-medium">
                {visibleCount} of {totalColumns} visible
              </span>
            </div>

            <button
              type="button"
              onClick={onReset}
              className="text-[11px] font-semibold text-red-600 hover:text-red-700 flex items-center gap-1 cursor-pointer hover:underline transition-colors py-1 px-1.5 rounded-md hover:bg-red-50"
              title="Restore all default columns"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Reset</span>
            </button>
          </div>

          {/* Column List */}
          <div className="px-1.5 py-1 max-h-[320px] overflow-y-auto space-y-0.5 custom-scrollbar">
            {allColumns.map((col) => {
              const isLocked = !!col.locked;
              const isChecked = isLocked || visibleColumns[col.id] !== false;

              return (
                <div
                  key={col.id}
                  onClick={() => {
                    if (!isLocked) {
                      onToggle(col.id);
                    }
                  }}
                  className={`flex items-center justify-between px-2.5 py-2 rounded-xl text-xs transition-colors ${
                    isLocked
                      ? "cursor-default text-slate-500 bg-slate-50/50"
                      : "cursor-pointer hover:bg-slate-50 text-slate-700"
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    {/* Custom Styled Checkbox */}
                    <div
                      className={`w-4 h-4 rounded-md flex items-center justify-center transition-all ${
                        isLocked
                          ? "bg-slate-200 text-slate-500 border border-slate-300"
                          : isChecked
                          ? "bg-red-600 text-white border border-red-600 shadow-2xs"
                          : "border border-slate-300 bg-white hover:border-slate-400"
                      }`}
                    >
                      {isChecked && <Check className="w-3 h-3 stroke-[2.5]" />}
                    </div>

                    <span className={`truncate font-medium ${isLocked ? "text-slate-500 font-normal" : "text-slate-800"}`}>
                      {col.label}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {col.isCustom && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-red-600 bg-red-50 border border-red-200/60 px-1.5 py-0.5 rounded-md">
                        <Sparkles className="w-2.5 h-2.5" />
                        Custom
                      </span>
                    )}

                    {isLocked && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-md">
                        <Lock className="w-2.5 h-2.5" />
                        Locked
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Footer Link to Modules & Custom Fields Settings */}
          <div className="pt-2 mt-1 px-3 border-t border-slate-100">
            {onOpenCustomFields ? (
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  onOpenCustomFields();
                }}
                className="w-full text-center text-[11px] text-slate-500 hover:text-slate-800 font-medium py-1.5 hover:bg-slate-50 rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Sliders className="w-3 h-3 text-slate-400" />
                <span>Manage Modules & Fields</span>
              </button>
            ) : (
              <a
                href={`/settings?tab=modules`}
                onClick={() => setIsOpen(false)}
                className="w-full text-center text-[11px] text-slate-500 hover:text-slate-800 font-medium py-1.5 hover:bg-slate-50 rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Sliders className="w-3 h-3 text-slate-400" />
                <span>Manage Modules & Fields</span>
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
