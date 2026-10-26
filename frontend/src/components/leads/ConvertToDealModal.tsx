"use client";

import { useState } from "react";
import { X, Handshake, ArrowRight, Building2, User, Phone, CheckCircle2 } from "lucide-react";
import { Lead } from "@/lib/mockData";
import { api } from "@/lib/api";
import { useToast } from "@/components/common/ToastProvider";
import CustomDropdown from "@/components/common/CustomDropdown";

interface ConvertToDealModalProps {
  lead: Lead;
  isOpen: boolean;
  onClose: () => void;
  onConverted: (result: { deal_id: string; deal_title: string }) => void;
}

const CONVERT_PIPELINE_STAGES = [
  "Discovery / First Call",
  "Demo Scheduled",
  "Proposal Sent",
  "Negotiation",
  "Closed Won"
];

export default function ConvertToDealModal({
  lead,
  isOpen,
  onClose,
  onConverted
}: ConvertToDealModalProps) {
  const { toast } = useToast();
  const [dealName, setDealName] = useState(
    `${lead.company_name || lead.name || "Client"} - Deal`
  );
  const [dealValue, setDealValue] = useState<string>(
    lead.deal_value ? String(lead.deal_value) : "50000"
  );
  const [pipelineStage, setPipelineStage] = useState(
    "Discovery / First Call"
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dealName.trim()) {
      toast.warning("Validation Error", "Please provide a deal name.");
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await api.convertLead(lead.id, {
        deal_name: dealName.trim(),
        deal_value: Number(dealValue) || 0,
        pipeline_stage: pipelineStage
      });

      toast.success(
        "Lead Converted Successfully",
        `"${result.deal_title || dealName}" is now active in your pipeline.`
      );
      onConverted({
        deal_id: result.deal_id,
        deal_title: result.deal_title || dealName
      });
      onClose();
    } catch (err: any) {
      toast.error("Conversion Failed", err.message || "Failed to convert lead to deal.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-red-50 to-white">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-red-600 text-white flex items-center justify-center shadow-xs">
              <Handshake className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-base">Convert Lead to Deal</h3>
              <p className="text-xs text-slate-500">Create Deal and Contact records simultaneously</p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Lead Summary Card */}
        <div className="px-6 pt-5 pb-2">
          <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200/80 space-y-2">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
              Lead Summary
            </span>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="flex items-center gap-1.5 truncate">
                <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span className="font-bold text-slate-800 truncate">{lead.name}</span>
              </div>
              <div className="flex items-center gap-1.5 truncate font-mono">
                <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span className="text-slate-700 truncate">{lead.phone}</span>
              </div>
              <div className="flex items-center gap-1.5 truncate">
                <Building2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span className="text-slate-700 truncate">{lead.company_name || "Individual"}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Convert Form */}
        <form onSubmit={handleSubmit} className="p-6 pt-3 space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">
              Deal Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              value={dealName}
              onChange={(e) => setDealName(e.target.value)}
              placeholder="e.g. Acme Corp - Enterprise Deal"
              className="w-full bg-slate-50 text-slate-900 text-sm px-3.5 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-red-500 font-medium"
            />
          </div>

          <div className="grid grid-cols-2 gap-3.5">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                Deal Value / Amount (₹) <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-semibold">
                  ₹
                </span>
                <input
                  type="number"
                  min="0"
                  step="1000"
                  required
                  value={dealValue}
                  onChange={(e) => setDealValue(e.target.value)}
                  placeholder="e.g. 50,000"
                  className="w-full bg-slate-50 text-slate-900 text-sm pl-8 pr-3.5 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-red-500 font-bold"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                Pipeline Stage <span className="text-red-500">*</span>
              </label>
              <CustomDropdown
                value={pipelineStage}
                onChange={(val) => setPipelineStage(String(val))}
                options={CONVERT_PIPELINE_STAGES}
                variant="input"
                className="w-full text-sm font-medium"
              />
            </div>
          </div>

          <div className="p-3 bg-emerald-50/70 border border-emerald-200 rounded-xl flex items-start gap-2.5 text-xs text-emerald-800">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <span className="font-bold">Automated local sync:</span>
              <p className="text-[11px] text-emerald-700 leading-relaxed">
                Lead status will update to <span className="font-semibold">Converted</span>, a linked Contact record will be created in PostgreSQL, and the Deal will appear instantly in your Kanban board.
              </p>
            </div>
          </div>

          {/* Action buttons */}
          <div className="pt-3 flex items-center justify-end gap-3 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2.5 text-xs font-semibold text-slate-600 hover:text-slate-900 rounded-xl hover:bg-slate-100 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2.5 bg-red-600 hover:bg-red-700 active:bg-red-800 text-white text-xs font-bold rounded-xl shadow-xs transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {isSubmitting ? (
                <span>Converting...</span>
              ) : (
                <>
                  <span>Confirm & Convert</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
