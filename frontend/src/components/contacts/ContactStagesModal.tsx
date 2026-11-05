"use client";

import { useState, useEffect } from "react";
import {
  X,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  RotateCcw,
  Check,
  SlidersHorizontal,
  Lock,
  Sparkles
} from "lucide-react";
import { useToast } from "@/components/common/ToastProvider";

export interface ContactStageConfig {
  id: string;
  name: string;
  color: string;
  dot?: string;
  isSystem?: boolean;
}

export const CONTACT_STAGE_COLOR_PRESETS = [
  { name: "Slate", dot: "bg-slate-500", badge: "bg-slate-100 text-slate-700 border-slate-200", border: "border-slate-200", bg: "bg-slate-50/60", text: "text-slate-700", hex: "#64748b" },
  { name: "Blue", dot: "bg-blue-500", badge: "bg-blue-50 text-blue-700 border-blue-200", border: "border-blue-200", bg: "bg-blue-50/60", text: "text-blue-700", hex: "#3b82f6" },
  { name: "Indigo", dot: "bg-indigo-500", badge: "bg-indigo-50 text-indigo-700 border-indigo-200", border: "border-indigo-200", bg: "bg-indigo-50/60", text: "text-indigo-700", hex: "#6366f1" },
  { name: "Purple", dot: "bg-purple-500", badge: "bg-purple-50 text-purple-700 border-purple-200", border: "border-purple-200", bg: "bg-purple-50/60", text: "text-purple-700", hex: "#a855f7" },
  { name: "Amber", dot: "bg-amber-500", badge: "bg-amber-50 text-amber-700 border-amber-200", border: "border-amber-200", bg: "bg-amber-50/60", text: "text-amber-700", hex: "#f59e0b" },
  { name: "Orange", dot: "bg-orange-500", badge: "bg-orange-50 text-orange-700 border-orange-200", border: "border-orange-200", bg: "bg-orange-50/60", text: "text-orange-700", hex: "#f97316" },
  { name: "Emerald", dot: "bg-emerald-500", badge: "bg-emerald-50 text-emerald-700 border-emerald-200", border: "border-emerald-200", bg: "bg-emerald-50/60", text: "text-emerald-700", hex: "#10b981" },
  { name: "Rose", dot: "bg-rose-500", badge: "bg-rose-50 text-rose-700 border-rose-200", border: "border-rose-200", bg: "bg-rose-50/60", text: "text-rose-700", hex: "#f43f5e" }
];

export function getContactStageColorPreset(colorName?: string) {
  if (!colorName) return CONTACT_STAGE_COLOR_PRESETS[0];
  const lower = colorName.toLowerCase();
  return (
    CONTACT_STAGE_COLOR_PRESETS.find((p) => p.name.toLowerCase() === lower) ||
    CONTACT_STAGE_COLOR_PRESETS[0]
  );
}

export const DEFAULT_CONTACT_STAGES: ContactStageConfig[] = [
  { id: "new_leads", name: "New Leads", color: "slate", dot: "bg-slate-500", isSystem: true },
  { id: "contacted", name: "Contacted", color: "blue", dot: "bg-blue-500", isSystem: false },
  { id: "qualified", name: "Qualified", color: "purple", dot: "bg-purple-500", isSystem: false },
  { id: "proposal_sent", name: "Proposal Sent", color: "amber", dot: "bg-amber-500", isSystem: false },
  { id: "customer", name: "Customer", color: "emerald", dot: "bg-emerald-500", isSystem: false },
  { id: "lost", name: "Lost / Unqualified", color: "rose", dot: "bg-rose-500", isSystem: false }
];

export const CONTACT_STAGES_STORAGE_KEY = "zigmaa_contact_stages";

interface ContactStagesModalProps {
  isOpen: boolean;
  onClose: () => void;
  stages: ContactStageConfig[];
  onSave: (newStages: ContactStageConfig[]) => void;
}

export default function ContactStagesModal({
  isOpen,
  onClose,
  stages: initialStages,
  onSave
}: ContactStagesModalProps) {
  const { toast } = useToast();
  const [stages, setStages] = useState<ContactStageConfig[]>(initialStages);

  // New stage form state
  const [newStageName, setNewStageName] = useState("");
  const [selectedColorIndex, setSelectedColorIndex] = useState(1); // default Blue

  // Sync state whenever modal opens with props
  useEffect(() => {
    if (isOpen) {
      setStages(initialStages);
    }
  }, [isOpen, initialStages]);

  if (!isOpen) return null;

  // Move stage up (left in Kanban)
  const moveStage = (index: number, direction: "up" | "down") => {
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= stages.length) return;

    const updated = [...stages];
    const [movedItem] = updated.splice(index, 1);
    updated.splice(targetIndex, 0, movedItem);
    setStages(updated);
  };

  // Update stage name
  const handleNameChange = (index: number, newName: string) => {
    setStages((prev) =>
      prev.map((s, i) => (i === index ? { ...s, name: newName } : s))
    );
  };

  // Change stage color preset
  const handleColorChange = (index: number, preset: typeof CONTACT_STAGE_COLOR_PRESETS[0]) => {
    setStages((prev) =>
      prev.map((s, i) =>
        i === index
          ? { ...s, color: preset.name.toLowerCase(), dot: preset.dot }
          : s
      )
    );
  };

  // Delete non-system stage
  const handleDeleteStage = (index: number) => {
    const stage = stages[index];
    if (stage.isSystem) {
      toast.warning("System Stage", "System stage (New Leads) cannot be deleted.");
      return;
    }
    if (stages.length <= 2) {
      toast.warning("Minimum Stages", "The contact board must retain at least two stages.");
      return;
    }
    setStages((prev) => prev.filter((_, i) => i !== index));
    toast.info("Stage Removed", `Stage "${stage.name}" removed`);
  };

  // Add new stage
  const handleAddStage = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newStageName.trim();
    if (!trimmed) {
      toast.warning("Input Required", "Please enter a stage name");
      return;
    }

    // Check duplicate
    if (stages.some((s) => s.name.toLowerCase() === trimmed.toLowerCase())) {
      toast.warning("Duplicate Stage", "A stage with this name already exists");
      return;
    }

    const colorPreset = CONTACT_STAGE_COLOR_PRESETS[selectedColorIndex] || CONTACT_STAGE_COLOR_PRESETS[0];
    const newStageItem: ContactStageConfig = {
      id: trimmed.toLowerCase().replace(/[^a-z0-9]/g, "_"),
      name: trimmed,
      color: colorPreset.name.toLowerCase(),
      dot: colorPreset.dot,
      isSystem: false
    };

    // Insert before closing stages (Customer / Lost) if present
    const customerIndex = stages.findIndex((s) => s.id === "customer" || s.id === "lost");
    let updated: ContactStageConfig[];
    if (customerIndex !== -1) {
      updated = [...stages.slice(0, customerIndex), newStageItem, ...stages.slice(customerIndex)];
    } else {
      updated = [...stages, newStageItem];
    }

    setStages(updated);
    setNewStageName("");
    toast.success("Stage Added", `Added stage "${trimmed}"`);
  };

  // Reset to default stages
  const handleResetToDefaults = () => {
    if (typeof window !== "undefined" && window.confirm("Reset all contact stages back to default CRM stages?")) {
      setStages(DEFAULT_CONTACT_STAGES);
      toast.info("Reset Complete", "Stages reset to default configuration");
    }
  };

  // Save changes
  const handleSave = () => {
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem(CONTACT_STAGES_STORAGE_KEY, JSON.stringify(stages));
      } catch (err) {
        console.error("Failed to save contact stages to localStorage:", err);
      }
    }
    onSave(stages);
    toast.success("Saved", "Contact stages saved successfully!");
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between shrink-0 bg-slate-50/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-50 text-red-600 flex items-center justify-center border border-red-100 shadow-2xs">
              <SlidersHorizontal className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-800">Contact Stages Settings</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Customize stages, reorder sequence, and adjust colors for your Contacts Kanban board.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleResetToDefaults}
              className="text-xs font-semibold text-slate-500 hover:text-slate-700 flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-white transition-colors cursor-pointer"
              title="Reset to default stages"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset Defaults</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="text-slate-400 hover:text-slate-600 p-2 rounded-xl hover:bg-slate-100 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 custom-scrollbar">
          
          {/* Active Stages Reorder & Edit List */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold text-slate-600 uppercase tracking-wider">
                Active Contact Stages ({stages.length})
              </h3>
              <span className="text-[11px] text-slate-400">
                Sequence determines left-to-right Kanban columns
              </span>
            </div>

            <div className="space-y-2">
              {stages.map((st, index) => {
                const colorPreset = getContactStageColorPreset(st.color);
                return (
                  <div
                    key={st.id || index}
                    className="flex items-center gap-3 p-3 bg-white border border-slate-200 rounded-xl shadow-2xs hover:border-slate-300 transition-colors"
                  >
                    {/* Reorder Buttons */}
                    <div className="flex flex-col gap-0.5 shrink-0">
                      <button
                        type="button"
                        disabled={index === 0}
                        onClick={() => moveStage(index, "up")}
                        className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-20 cursor-pointer disabled:cursor-not-allowed transition-colors"
                        title="Move left on board"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={index === stages.length - 1}
                        onClick={() => moveStage(index, "down")}
                        className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-20 cursor-pointer disabled:cursor-not-allowed transition-colors"
                        title="Move right on board"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Step Number Indicator */}
                    <span className="w-6 h-6 rounded-full bg-slate-100 text-slate-500 text-[11px] font-bold flex items-center justify-center shrink-0">
                      {index + 1}
                    </span>

                    {/* Color Preset Palette Dropdown / Indicator */}
                    <div className="relative group shrink-0">
                      <div
                        className={`w-6 h-6 rounded-full ${colorPreset.dot} shadow-2xs border-2 border-white ring-1 ring-slate-200 cursor-pointer flex items-center justify-center`}
                        title="Hover to pick color"
                      />
                      <div className="hidden group-hover:flex absolute left-0 top-8 z-30 bg-white border border-slate-200 rounded-xl shadow-lg p-2 gap-1.5 min-w-[200px] flex-wrap animate-in fade-in zoom-in-95">
                        {CONTACT_STAGE_COLOR_PRESETS.map((preset) => (
                          <button
                            key={preset.name}
                            type="button"
                            onClick={() => handleColorChange(index, preset)}
                            className={`w-5 h-5 rounded-full ${preset.dot} hover:scale-110 transition-transform cursor-pointer ring-1 ring-slate-200`}
                            title={preset.name}
                          />
                        ))}
                      </div>
                    </div>

                    {/* Stage Label Input */}
                    <div className="flex-1 min-w-0">
                      <input
                        type="text"
                        value={st.name}
                        onChange={(e) => handleNameChange(index, e.target.value)}
                        placeholder="Stage Name"
                        className="w-full text-sm font-semibold text-slate-800 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-red-500 focus:bg-slate-50/50 rounded px-1.5 py-0.5 outline-hidden transition-all"
                      />
                    </div>

                    {/* System or Delete */}
                    <div className="shrink-0 flex items-center pl-1">
                      {st.isSystem ? (
                        <span
                          className="flex items-center gap-1 text-[11px] font-semibold text-slate-400 bg-slate-100 px-2 py-1 rounded-lg"
                          title="Core initial stage for new contacts"
                        >
                          <Lock className="w-3 h-3" />
                          <span>System</span>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleDeleteStage(index)}
                          className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                          title="Delete stage"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Add New Stage Box */}
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-red-600" />
              <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                Add New Contact Stage
              </h4>
            </div>

            <form onSubmit={handleAddStage} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center">
                {/* Stage Name */}
                <div className="sm:col-span-8">
                  <input
                    type="text"
                    value={newStageName}
                    onChange={(e) => setNewStageName(e.target.value)}
                    placeholder="e.g., Demo Scheduled, Follow Up, Negotiation..."
                    className="w-full text-xs font-medium px-3 py-2 bg-white border border-slate-200 rounded-xl focus:border-red-500 focus:ring-1 focus:ring-red-500 outline-hidden transition-all shadow-2xs"
                  />
                </div>

                {/* Add Button */}
                <div className="sm:col-span-4">
                  <button
                    type="submit"
                    className="w-full py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold shadow-2xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Stage</span>
                  </button>
                </div>
              </div>

              {/* Color Preset Selector */}
              <div>
                <span className="block text-[11px] font-semibold text-slate-500 mb-1.5">
                  Stage Color Theme:
                </span>
                <div className="flex items-center gap-2 flex-wrap">
                  {CONTACT_STAGE_COLOR_PRESETS.map((preset, idx) => (
                    <button
                      key={preset.name}
                      type="button"
                      onClick={() => setSelectedColorIndex(idx)}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition-all cursor-pointer ${
                        selectedColorIndex === idx
                          ? "border-red-500 bg-white ring-2 ring-red-100 text-slate-900 font-bold"
                          : "border-slate-200 bg-white hover:bg-slate-100 text-slate-600"
                      }`}
                    >
                      <span className={`w-2.5 h-2.5 rounded-full ${preset.dot}`} />
                      <span>{preset.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            </form>
          </div>

        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between shrink-0 bg-slate-50/50">
          <p className="text-[11px] text-slate-500">
            Changes apply instantly to your Contacts Kanban workspace.
          </p>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-slate-200 hover:bg-slate-100 text-slate-700 text-xs font-semibold rounded-xl transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="px-5 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold rounded-xl shadow-xs transition-colors cursor-pointer flex items-center gap-1.5"
            >
              <Check className="w-4 h-4" />
              <span>Save Stage Settings</span>
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}

