"use client";

import { useState, useEffect } from "react";
import { X, User, Building2, Tag, ShieldCheck, Phone, Mail, Sliders } from "lucide-react";
import { Contact } from "@/lib/mockData";
import { api } from "@/lib/api";
import { useToast } from "@/components/common/ToastProvider";
import CustomDropdown from "@/components/common/CustomDropdown";
import LeadSourceSelect from "@/components/common/LeadSourceSelect";

interface NewContactDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (contactData: Partial<Contact>) => Promise<void>;
  customFields?: any[];
  currentUser?: any;
}

const SOURCES = [
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
  "Manual"
];

const LIFECYCLE_STAGES = [
  "New",
  "Contacted",
  "Interested",
  "Qualified",
  "Won / Customer"
];

export default function NewContactDrawer({
  isOpen,
  onClose,
  onSubmit,
  customFields = [],
  currentUser
}: NewContactDrawerProps) {
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);

  // Form State
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [countryCode, setCountryCode] = useState("+91");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [designation, setDesignation] = useState("");
  const [source, setSource] = useState("Manual");
  const [lifecycleStage, setLifecycleStage] = useState("New");
  const [assignedOwner, setAssignedOwner] = useState(
    currentUser?.full_name || "Mohamed Thoufiq"
  );
  const [customData, setCustomData] = useState<Record<string, any>>({});
  const [teamMembers, setTeamMembers] = useState<any[]>([]);

  useEffect(() => {
    if (isOpen) {
      api.getTeamMembers().then((members) => {
        if (Array.isArray(members) && members.length > 0) {
          setTeamMembers(members);
        }
      }).catch(() => {});
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();
    if (!fullName) {
      toast.warning("Validation", "First name or full name is required.");
      return;
    }

    const cleanPhone = phone.trim();
    if (!cleanPhone) {
      toast.warning("Validation", "Mobile phone number is required.");
      return;
    }

    const formattedPhone = cleanPhone.startsWith("+")
      ? cleanPhone
      : `${countryCode} ${cleanPhone}`;

    const stageValue = lifecycleStage === "Won / Customer" ? "Customer" : lifecycleStage;

    const payload: Partial<Contact> = {
      name: fullName,
      phone: formattedPhone,
      email: email.trim() || undefined,
      company_name: companyName.trim() || undefined,
      job_title: designation.trim() || undefined,
      source: source as any,
      status: stageValue as any,
      lifecycle_stage: stageValue as any,
      assigned_to: assignedOwner || "Mohamed Thoufiq",
      custom_data: customData,
      custom_properties: customData
    } as any;

    setSubmitting(true);
    try {
      await onSubmit(payload);
      // Reset form
      setFirstName("");
      setLastName("");
      setPhone("");
      setEmail("");
      setCompanyName("");
      setDesignation("");
      setSource("Manual");
      setLifecycleStage("New");
      setCustomData({});
      onClose();
    } catch (err: any) {
      toast.error("Error", err.message || "Failed to create contact.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-slate-900/40 backdrop-blur-xs flex justify-end animate-in fade-in duration-200">
      <div className="relative w-full max-w-xl bg-white border-l border-slate-200 shadow-2xl flex flex-col h-full overflow-hidden text-slate-800 animate-in slide-in-from-right duration-300">
        
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-200/80 bg-slate-50/70 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-100 text-red-600 flex items-center justify-center shadow-xs">
              <User className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">Create New Contact</h2>
              <p className="text-xs text-slate-500 font-medium">Add an individual client or business lead</p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Form Body */}
        <form onSubmit={handleSubmit} id="new-contact-drawer-form" className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
          
          {/* SECTION 1: BASIC DETAILS */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 pb-1 border-b border-slate-100">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                1. Basic Details
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  First Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="Rahul"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 focus:border-red-500 focus:bg-white focus:ring-2 focus:ring-red-100 rounded-xl text-xs px-3.5 py-2.5 text-slate-900 transition-all font-medium outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Last Name
                </label>
                <input
                  type="text"
                  placeholder="Sharma"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 focus:border-red-500 focus:bg-white focus:ring-2 focus:ring-red-100 rounded-xl text-xs px-3.5 py-2.5 text-slate-900 transition-all font-medium outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Mobile Number <span className="text-red-500">*</span>
              </label>
              <div className="flex items-center gap-2">
                <select
                  value={countryCode}
                  onChange={(e) => setCountryCode(e.target.value)}
                  className="bg-slate-50 border border-slate-200 rounded-xl text-xs px-2.5 py-2.5 text-slate-800 font-semibold focus:outline-none focus:ring-2 focus:ring-red-100"
                >
                  <option value="+91">🇮🇳 +91</option>
                  <option value="+1">🇺🇸 +1</option>
                  <option value="+44">🇬🇧 +44</option>
                  <option value="+971">🇦🇪 +971</option>
                  <option value="+65">🇸🇬 +65</option>
                </select>
                <div className="relative flex-1">
                  <Phone className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="tel"
                    required
                    placeholder="98765 43210"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 focus:border-red-500 focus:bg-white focus:ring-2 focus:ring-red-100 rounded-xl text-xs pl-9 pr-3.5 py-2.5 text-slate-900 transition-all font-medium outline-none font-mono"
                  />
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Email Address
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="email"
                  placeholder="rahul.sharma@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 focus:border-red-500 focus:bg-white focus:ring-2 focus:ring-red-100 rounded-xl text-xs pl-9 pr-3.5 py-2.5 text-slate-900 transition-all font-medium outline-none"
                />
              </div>
            </div>
          </div>

          {/* SECTION 2: COMPANY & ROLE */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 pb-1 border-b border-slate-100">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                2. Company & Role
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Company Name
                </label>
                <div className="relative">
                  <Building2 className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Acme Global Inc"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 focus:border-red-500 focus:bg-white focus:ring-2 focus:ring-red-100 rounded-xl text-xs pl-9 pr-3.5 py-2.5 text-slate-900 transition-all font-medium outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Designation / Role
                </label>
                <input
                  type="text"
                  placeholder="VP of Growth"
                  value={designation}
                  onChange={(e) => setDesignation(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 focus:border-red-500 focus:bg-white focus:ring-2 focus:ring-red-100 rounded-xl text-xs px-3.5 py-2.5 text-slate-900 transition-all font-medium outline-none"
                />
              </div>
            </div>
          </div>

          {/* SECTION 3: LEAD TRACKING & OWNERSHIP */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 pb-1 border-b border-slate-100">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                3. Lead Tracking & Assignment
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Lead Source
                </label>
                <LeadSourceSelect
                  value={source}
                  onChange={(val) => setSource(val)}
                  options={SOURCES}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Lifecycle Stage
                </label>
                <CustomDropdown
                  value={lifecycleStage}
                  options={LIFECYCLE_STAGES}
                  onChange={(val) => setLifecycleStage(val)}
                  variant="input"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Assigned Owner
              </label>
              {teamMembers.length > 0 ? (
                <CustomDropdown
                  value={assignedOwner}
                  options={teamMembers.map(m => ({
                    value: m.full_name,
                    label: `${m.full_name} (${m.role === "ADMIN" ? "Admin" : m.role === "MANAGER" ? "Manager" : "Sales Rep"})`
                  }))}
                  onChange={(val) => setAssignedOwner(val)}
                  variant="input"
                />
              ) : (
                <input
                  type="text"
                  value={assignedOwner}
                  onChange={(e) => setAssignedOwner(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 focus:border-red-500 focus:bg-white focus:ring-2 focus:ring-red-100 rounded-xl text-xs px-3.5 py-2.5 text-slate-900 font-medium outline-none"
                  placeholder="Mohamed Thoufiq"
                />
              )}
            </div>
          </div>

          {/* SECTION 4: DYNAMIC CUSTOM ATTRIBUTES */}
          {customFields.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 pb-1 border-b border-slate-100">
                <Sliders className="w-3.5 h-3.5 text-slate-400" />
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  4. Custom Attributes
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3.5">
                {customFields.map((cf) => {
                  const fKey = cf.key || cf.field_key || cf.label.toLowerCase().replace(/[^a-z0-9]/g, "_");
                  const fType = (cf.field_type || "TEXT").toUpperCase();

                  return (
                    <div key={cf.id || fKey}>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        {cf.label} {cf.is_required && <span className="text-red-500">*</span>}
                      </label>
                      {fType === "SELECT" ? (
                        <select
                          value={customData[fKey] || ""}
                          onChange={(e) => setCustomData({ ...customData, [fKey]: e.target.value })}
                          required={cf.is_required}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl text-xs px-3.5 py-2.5 text-slate-900 outline-none focus:ring-2 focus:ring-red-100 font-medium"
                        >
                          <option value="">Select option</option>
                          {(cf.options || []).map((opt: string) => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                      ) : fType === "BOOLEAN" ? (
                        <label className="flex items-center gap-2 pt-2.5 text-xs font-semibold text-slate-700 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={!!customData[fKey]}
                            onChange={(e) => setCustomData({ ...customData, [fKey]: e.target.checked })}
                            className="w-4 h-4 rounded text-red-600 focus:ring-red-500 border-slate-300"
                          />
                          <span>Yes / Enabled</span>
                        </label>
                      ) : (
                        <input
                          type={fType === "NUMBER" ? "number" : fType === "DATE" ? "date" : "text"}
                          value={customData[fKey] || ""}
                          onChange={(e) => setCustomData({ ...customData, [fKey]: e.target.value })}
                          required={cf.is_required}
                          placeholder={cf.label}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl text-xs px-3.5 py-2.5 text-slate-900 outline-none focus:ring-2 focus:ring-red-100 font-medium"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

        </form>

        {/* Fixed Footer */}
        <div className="p-4 px-6 border-t border-slate-200 bg-white flex items-center justify-end gap-3 shrink-0 shadow-lg">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="new-contact-drawer-form"
            disabled={submitting}
            className="px-5 py-2.5 bg-red-600 hover:bg-red-700 active:bg-red-800 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-red-600/20 cursor-pointer disabled:opacity-50 flex items-center gap-2"
          >
            {submitting ? "Creating Contact..." : "Create Contact"}
          </button>
        </div>

      </div>
    </div>
  );
}
