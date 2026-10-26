"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import {
  X,
  Building2,
  DollarSign,
  Calendar,
  Percent,
  User,
  Search,
  Check,
  ChevronDown
} from "lucide-react";
import { Deal, Contact } from "@/lib/mockData";
import { api } from "@/lib/api";
import { useToast } from "@/components/common/ToastProvider";
import CustomDropdown from "@/components/common/CustomDropdown";
import CustomDatePicker from "@/components/common/CustomDatePicker";

interface NewDealDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (dealData: Partial<Deal>) => Promise<void>;
  customFields?: any[];
  currentUser?: any;
  stages?: string[];
}

const PIPELINE_STAGES = [
  "New Deal",
  "Discovery",
  "Proposal Sent",
  "Negotiation",
  "Closed Won",
  "Closed Lost"
];

export default function NewDealDrawer({
  isOpen,
  onClose,
  onSubmit,
  customFields = [],
  currentUser,
  stages = []
}: NewDealDrawerProps) {
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const activeStages = stages && stages.length > 0 ? stages : PIPELINE_STAGES;

  // Form State
  const [title, setTitle] = useState("");
  const [value, setValue] = useState("");
  const [stage, setStage] = useState("New Deal");
  const [companyName, setCompanyName] = useState("");
  const [contactName, setContactName] = useState("");
  const [selectedContactId, setSelectedContactId] = useState<number | string | null>(null);
  const [probability, setProbability] = useState("50");
  const [closeDate, setCloseDate] = useState("");
  const [customData, setCustomData] = useState<Record<string, any>>({});

  // Contacts for searchable dropdown
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactSearch, setContactSearch] = useState("");
  const [isContactDropdownOpen, setIsContactDropdownOpen] = useState(false);
  const contactDropdownRef = useRef<HTMLDivElement>(null);

  // Load contacts from backend on mount or when opened
  useEffect(() => {
    if (isOpen) {
      api.getContacts()
        .then((data) => {
          if (Array.isArray(data)) setContacts(data);
        })
        .catch(() => {});

      // Set default target close date to 14 days from now
      const defaultDate = new Date(Date.now() + 14 * 86400000).toISOString().split("T")[0];
      setCloseDate(defaultDate);
    }
  }, [isOpen]);

  // Close contact dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        contactDropdownRef.current &&
        !contactDropdownRef.current.contains(event.target as Node)
      ) {
        setIsContactDropdownOpen(false);
      }
    }
    if (isContactDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isContactDropdownOpen]);

  // Filter contacts by query
  const filteredContacts = useMemo(() => {
    if (!contactSearch.trim()) return contacts.slice(0, 15);
    const q = contactSearch.toLowerCase();
    return contacts.filter(
      (c) =>
        (c.name && c.name.toLowerCase().includes(q)) ||
        (c.email && c.email.toLowerCase().includes(q)) ||
        (c.phone && c.phone.toLowerCase().includes(q)) ||
        (c.company_name && c.company_name.toLowerCase().includes(q))
    ).slice(0, 20);
  }, [contacts, contactSearch]);

  const handleSelectContact = (c: Contact) => {
    setSelectedContactId(c.id);
    setContactName(c.name);
    setContactSearch(c.name);
    if (c.company_name && !companyName) {
      setCompanyName(c.company_name);
    }
    setIsContactDropdownOpen(false);
  };

  const handleClearContact = () => {
    setSelectedContactId(null);
    setContactName("");
    setContactSearch("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!title.trim()) {
      toast.warning("Validation", "Deal title is required.");
      return;
    }

    if (!value || Number(value) < 0) {
      toast.warning("Validation", "Please provide a valid deal amount.");
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit({
        title: title.trim(),
        value: Number(value) || 0,
        deal_value: Number(value) || 0,
        stage: (stage === "Closed Won" ? "Won" : stage === "Closed Lost" ? "Lost" : stage) as any,
        company_name: companyName.trim() || (contactName ? `${contactName}'s Account` : "Enterprise Client"),
        contact_name: contactName.trim(),
        contact_id: selectedContactId || undefined,
        contact_phone: contacts.find((c) => String(c.id) === String(selectedContactId))?.phone || undefined,
        contact_email: contacts.find((c) => String(c.id) === String(selectedContactId))?.email || undefined,
        probability: Number(probability) || 50,
        close_date: closeDate || new Date().toISOString().split("T")[0],
        expected_close_date: closeDate || new Date().toISOString().split("T")[0],
        custom_data: {
          ...customData,
          company_name: companyName.trim() || (contactName ? `${contactName}'s Account` : "Enterprise Client"),
          contact_name: contactName.trim(),
          contact_phone: contacts.find((c) => String(c.id) === String(selectedContactId))?.phone || undefined,
          contact_email: contacts.find((c) => String(c.id) === String(selectedContactId))?.email || undefined
        },
        custom_properties: customData
      } as any);

      // Reset Form
      setTitle("");
      setValue("");
      setStage("New Deal");
      setCompanyName("");
      setContactName("");
      setContactSearch("");
      setSelectedContactId(null);
      setProbability("50");
      setCustomData({});
      onClose();
    } catch (err: any) {
      toast.error("Error", err.message || "Failed to create deal.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden flex justify-end animate-in fade-in duration-200">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs transition-opacity"
        onClick={onClose}
      />

      {/* Slide Drawer Container */}
      <div className="relative w-full max-w-lg bg-white h-full shadow-2xl flex flex-col z-10 animate-in slide-in-from-right duration-300 border-l border-slate-200">
        
        {/* Header */}
        <div className="p-4 px-6 border-b border-slate-200/80 bg-white flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-base font-bold text-slate-900">Create New Deal</h2>
            <p className="text-xs text-slate-500 font-medium mt-0.5">
              Add a new sales opportunity to track through your pipeline
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
            title="Close drawer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Form Body */}
        <form
          id="new-deal-drawer-form"
          onSubmit={handleSubmit}
          className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar"
        >
          {/* SECTION 1: DEAL DETAILS */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
              <DollarSign className="w-4 h-4 text-red-600" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                1. Deal Details
              </h3>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                Deal Name / Title <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Enterprise Cloud ERP Migration Contract"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl text-xs px-3.5 py-2.5 text-slate-900 outline-none focus:ring-2 focus:ring-red-100 focus:border-red-400 font-medium transition-all"
              />
            </div>

            <div className="grid grid-cols-2 gap-3.5">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Deal Value (₹) <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">
                    ₹
                  </span>
                  <input
                    type="number"
                    required
                    min="0"
                    step="any"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder="250000"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl text-xs pl-7 pr-3 py-2.5 text-slate-900 outline-none focus:ring-2 focus:ring-red-100 focus:border-red-400 font-semibold transition-all"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Pipeline Stage <span className="text-red-500">*</span>
                </label>
                <CustomDropdown
                  value={stage}
                  options={activeStages}
                  onChange={(val) => setStage(val)}
                  variant="input"
                />
              </div>
            </div>
          </div>

          {/* SECTION 2: ASSOCIATED CONTACT & COMPANY */}
          <div className="space-y-4 pt-2">
            <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
              <Building2 className="w-4 h-4 text-red-600" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                2. Associated Contact & Company
              </h3>
            </div>

            {/* Primary Contact Searchable Dropdown */}
            <div className="relative" ref={contactDropdownRef}>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                Primary Contact
              </label>
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search contacts by name, email, phone..."
                  value={contactSearch}
                  onFocus={() => setIsContactDropdownOpen(true)}
                  onChange={(e) => {
                    setContactSearch(e.target.value);
                    setContactName(e.target.value);
                    setIsContactDropdownOpen(true);
                  }}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl text-xs pl-8.5 pr-8 py-2.5 text-slate-900 outline-none focus:ring-2 focus:ring-red-100 focus:border-red-400 font-medium transition-all"
                />
                {contactSearch && (
                  <button
                    type="button"
                    onClick={handleClearContact}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Dropdown Menu */}
              {isContactDropdownOpen && (
                <div className="absolute left-0 right-0 top-full mt-1.5 max-h-56 overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-xl z-20 divide-y divide-slate-100 custom-scrollbar text-xs">
                  {filteredContacts.length === 0 ? (
                    <div className="p-3.5 text-center text-slate-400">
                      No matching contacts found. You can still type custom name.
                    </div>
                  ) : (
                    filteredContacts.map((c) => {
                      const isSelected = selectedContactId === c.id;
                      return (
                        <div
                          key={c.id}
                          onClick={() => handleSelectContact(c)}
                          className={`p-2.5 px-3 hover:bg-red-50/50 cursor-pointer flex items-center justify-between transition-colors ${
                            isSelected ? "bg-red-50/70" : ""
                          }`}
                        >
                          <div className="min-w-0">
                            <p className="font-semibold text-slate-800 truncate">{c.name}</p>
                            <p className="text-[11px] text-slate-500 truncate">
                              {c.company_name ? `${c.company_name} • ` : ""}
                              {c.email || c.phone || "No contact info"}
                            </p>
                          </div>
                          {isSelected && <Check className="w-4 h-4 text-red-600 shrink-0" />}
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>

            {/* Company Name */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                Company Name
              </label>
              <input
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="Acme Global Corporation"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl text-xs px-3.5 py-2.5 text-slate-900 outline-none focus:ring-2 focus:ring-red-100 focus:border-red-400 font-medium transition-all"
              />
            </div>
          </div>

          {/* SECTION 3: PROBABILITY & FORECAST */}
          <div className="space-y-4 pt-2">
            <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
              <Calendar className="w-4 h-4 text-red-600" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                3. Probability & Forecast
              </h3>
            </div>

            <div className="grid grid-cols-2 gap-3.5">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-bold text-slate-700">
                    Win Probability
                  </label>
                  <span className="text-xs font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded-full border border-red-100">
                    {probability}%
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="5"
                  value={probability}
                  onChange={(e) => setProbability(e.target.value)}
                  className="w-full accent-red-600 cursor-pointer h-2 bg-slate-200 rounded-lg mt-2"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Expected Close Date
                </label>
                <CustomDatePicker
                  value={closeDate}
                  onChange={(val) => setCloseDate(val)}
                  placeholder="Select close date"
                />
              </div>
            </div>
          </div>

          {/* SECTION 4: CUSTOM FIELDS (IF ANY) */}
          {customFields.length > 0 && (
            <div className="space-y-3 pt-2">
              <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
                <span className="w-2 h-2 rounded-full bg-slate-400" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                  Custom Attributes
                </h3>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {customFields.map((cf) => {
                  const fKey = cf.key || cf.field_key || cf.label.toLowerCase().replace(/[^a-z0-9]/g, "_");
                  const fType = (cf.field_type || "TEXT").toUpperCase();

                  return (
                    <div key={cf.id || fKey}>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        {cf.label} {cf.is_required && <span className="text-red-500">*</span>}
                      </label>
                      {fType === "SELECT" ? (
                        <select
                          value={customData[fKey] || ""}
                          onChange={(e) =>
                            setCustomData({ ...customData, [fKey]: e.target.value })
                          }
                          required={cf.is_required}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl text-xs px-3.5 py-2 text-slate-900 outline-none focus:ring-2 focus:ring-red-100 font-medium"
                        >
                          <option value="">Select option</option>
                          {(cf.options || []).map((opt: string) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      ) : fType === "BOOLEAN" ? (
                        <label className="flex items-center gap-2 pt-2 text-xs font-semibold text-slate-700 cursor-pointer">
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
                          onChange={(e) =>
                            setCustomData({ ...customData, [fKey]: e.target.value })
                          }
                          required={cf.is_required}
                          placeholder={cf.label}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl text-xs px-3.5 py-2 text-slate-900 outline-none focus:ring-2 focus:ring-red-100 font-medium"
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
            className="px-4 py-2.5 text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="new-deal-drawer-form"
            disabled={submitting}
            className="px-5 py-2.5 bg-red-600 hover:bg-red-700 active:bg-red-800 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-red-600/20 cursor-pointer disabled:opacity-50 flex items-center gap-2"
          >
            {submitting ? "Creating Deal..." : "Create Deal"}
          </button>
        </div>

      </div>
    </div>
  );
}
