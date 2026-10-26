"use client";

import { useState, useEffect } from "react";
import { X, UserPlus, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/components/common/ToastProvider";
import LeadSourceSelect from "@/components/common/LeadSourceSelect";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onLeadAdded?: () => void;
}

export default function AddLeadModal({ isOpen, onClose, onLeadAdded }: Props) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [adSource, setAdSource] = useState("Meta Ads");
  const [stage, setStage] = useState("New Lead");
  const [notes, setNotes] = useState("");
  const [customFields, setCustomFields] = useState<any[]>([]);
  const [customData, setCustomData] = useState<Record<string, any>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (isOpen) {
      api.getCustomFields("LEAD").then((res) => {
        setCustomFields(res || []);
      }).catch(() => {});
    }
  }, [isOpen]);

  if (!isOpen) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name || !phone) {
      setError("Please fill in Contact Name and Phone Number.");
      return;
    }
    setSubmitting(true);
    setError("");

    try {
      await api.createLead({
        name,
        phone,
        email,
        company_name: companyName,
        ad_source: adSource as any,
        stage: stage as any,
        notes,
        custom_fields: customData
      });
      toast.success("Lead Created", `${name} added to your pipeline.`);
      if (onLeadAdded) onLeadAdded();
      onClose();
    } catch (err: any) {
      setError(err.message || "Failed to create lead.");
      toast.error("Failed to Create Lead", err.message || "Please check your inputs.");
    } finally {
      setSubmitting(false);
    }
  }


  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-fade-in text-slate-800">
      <div className="relative w-full max-w-lg bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-indigo-50 text-indigo-600 border border-indigo-100">
              <UserPlus className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Add New Lead & Contact</h3>
              <p className="text-xs text-slate-500">Capture incoming B2B / B2C inquiry</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Contact Name *</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Rajesh Sharma"
                className="w-full bg-slate-50 text-slate-900 text-xs px-3.5 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:bg-white"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Phone Number *</label>
              <input
                type="text"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+91 98765 43210"
                className="w-full bg-slate-50 text-slate-900 text-xs px-3.5 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:bg-white"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Company Name</label>
              <input
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="e.g. TechCorp India"
                className="w-full bg-slate-50 text-slate-900 text-xs px-3.5 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:bg-white"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Corporate Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="rajesh@techcorp.in"
                className="w-full bg-slate-50 text-slate-900 text-xs px-3.5 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:bg-white"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Lead Source</label>
            <LeadSourceSelect
              value={adSource}
              onChange={(val) => setAdSource(val)}
            />
          </div>

          {/* Dynamic Custom Fields */}
          {customFields.length > 0 && (
            <div className="space-y-3 pt-2 border-t border-slate-100">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
                Custom Attributes
              </span>
              <div className="grid grid-cols-2 gap-3">
                {customFields.map((cf) => (
                  <div key={cf.id}>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      {cf.label} {cf.is_required && <span className="text-red-500">*</span>}
                    </label>
                    {cf.field_type === "SELECT" ? (
                      <select
                        value={customData[cf.field_key] || ""}
                        onChange={(e) => setCustomData({ ...customData, [cf.field_key]: e.target.value })}
                        required={cf.is_required}
                        className="w-full bg-slate-50 text-slate-900 text-xs px-3 py-2 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-600"
                      >
                        <option value="">Select option</option>
                        {(cf.options || []).map((opt: string) => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    ) : cf.field_type === "BOOLEAN" ? (
                      <label className="flex items-center gap-2 pt-2 text-xs font-semibold text-slate-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={!!customData[cf.field_key]}
                          onChange={(e) => setCustomData({ ...customData, [cf.field_key]: e.target.checked })}
                          className="w-4 h-4 rounded text-red-600 focus:ring-red-500 border-slate-300"
                        />
                        <span>Yes / Enabled</span>
                      </label>
                    ) : (
                      <input
                        type={cf.field_type === "NUMBER" ? "number" : cf.field_type === "DATE" ? "date" : "text"}
                        value={customData[cf.field_key] || ""}
                        onChange={(e) => setCustomData({ ...customData, [cf.field_key]: e.target.value })}
                        required={cf.is_required}
                        placeholder={cf.label}
                        className="w-full bg-slate-50 text-slate-900 text-xs px-3 py-2 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-600"
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Inquiry Description & Requirements</label>
            <textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Interested in enterprise annual software package for 50 team members"
              className="w-full bg-slate-50 text-slate-900 text-xs p-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:bg-white"
            />
          </div>

          <div className="pt-2 flex items-center justify-end gap-3 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-bold text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex items-center gap-2 px-5 py-2.5 bg-red-600 hover:bg-red-700 active:bg-red-800 text-white text-xs font-bold rounded-xl shadow-xs transition-all disabled:opacity-50 cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>{submitting ? "Saving..." : "Save Lead"}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

