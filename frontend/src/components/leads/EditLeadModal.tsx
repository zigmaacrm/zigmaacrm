"use client";

import { useState, useEffect } from "react";
import { X, Sparkles, Building2, Phone, Mail, DollarSign, Edit3 } from "lucide-react";
import { api } from "@/lib/api";
import { Lead } from "@/lib/mockData";
import { useToast } from "@/components/common/ToastProvider";
import LeadSourceSelect from "@/components/common/LeadSourceSelect";

interface Props {
  lead: Lead | null;
  isOpen: boolean;
  onClose: () => void;
  onLeadUpdated: () => void;
}

export default function EditLeadModal({ lead, isOpen, onClose, onLeadUpdated }: Props) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [adSource, setAdSource] = useState("Meta Ads");
  const [stage, setStage] = useState("New Lead");
  const [dealValue, setDealValue] = useState(0);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (lead) {
      setName(lead.name || "");
      setPhone(lead.phone || "");
      setEmail(lead.email || "");
      setCompanyName(lead.company_name || "");
      setAdSource(lead.ad_source || "Meta Ads");
      setStage(lead.stage || "New Lead");
      setDealValue(Number(lead.deal_value) || 0);
      setNotes(lead.notes || "");
    }
  }, [lead]);

  if (!isOpen || !lead) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !phone.trim()) {
      setError("Please fill in Contact Name and Phone Number.");
      return;
    }
    setSubmitting(true);
    setError("");

    try {
      await api.updateLead(lead!.id, {
        name,
        phone,
        email,
        company_name: companyName,
        ad_source: adSource as any,
        stage: stage as any,
        deal_value: Number(dealValue),
        notes,
      });

      toast.success("Lead Updated", `${name} details updated successfully.`);
      onLeadUpdated();
      onClose();
    } catch (err: any) {
      setError(err.message || "Failed to update lead.");
      toast.error("Update Failed", err.message || "Failed to update lead.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-150 text-slate-800">
      <div className="relative w-full max-w-lg bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-red-50 text-red-600 border border-red-100">
              <Edit3 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Edit Lead</h3>
              <p className="text-xs text-slate-500">Update contact details & deal stage</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
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
                placeholder="Rajesh Sharma"
                className="w-full bg-slate-50 text-slate-900 text-xs px-3.5 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-red-600 focus:bg-white"
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
                className="w-full bg-slate-50 text-slate-900 text-xs px-3.5 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-red-600 focus:bg-white"
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
                placeholder="TechCorp India"
                className="w-full bg-slate-50 text-slate-900 text-xs px-3.5 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-red-600 focus:bg-white"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Email Address</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="rajesh@techcorp.in"
                className="w-full bg-slate-50 text-slate-900 text-xs px-3.5 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-red-600 focus:bg-white"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Source</label>
              <LeadSourceSelect
                value={adSource}
                onChange={(val) => setAdSource(val)}
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Stage</label>
              <select
                value={stage}
                onChange={(e) => setStage(e.target.value)}
                className="w-full bg-slate-50 text-slate-900 text-xs px-2.5 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-red-600 focus:bg-white font-medium"
              >
                <option value="New Lead">New Lead</option>
                <option value="Contacted / Follow-up">Contacted</option>
                <option value="Proposal Sent">Proposal Sent</option>
                <option value="Closed / Won">Closed / Won</option>
                <option value="Lost">Lost</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Deal (₹)</label>
              <input
                type="number"
                value={dealValue}
                onChange={(e) => setDealValue(Number(e.target.value))}
                className="w-full bg-slate-50 text-slate-900 text-xs px-3 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-red-600 focus:bg-white font-bold"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Notes / Requirements</label>
            <textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add key background, requirements, or next steps..."
              className="w-full bg-slate-50 text-slate-900 text-xs p-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-red-600 focus:bg-white"
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
              <span>{submitting ? "Updating..." : "Save Changes"}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
