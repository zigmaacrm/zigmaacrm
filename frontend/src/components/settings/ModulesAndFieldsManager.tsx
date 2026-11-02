"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Users,
  DollarSign,
  Plus,
  Trash2,
  Lock,
  ArrowLeft,
  Sliders,
  Type,
  Hash,
  ListFilter,
  Calendar,
  ToggleRight,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  
  ChevronRight,
  X
} from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/components/common/ToastProvider";

export interface CustomFieldRecord {
  id: string;
  module: string;
  entity_type?: string;
  label: string;
  key: string;
  field_key?: string;
  field_type: "text" | "number" | "select" | "date" | "boolean" | string;
  options?: string[] | null;
  is_required?: boolean;
  is_active?: boolean;
  created_at?: string;
}

interface StandardFieldDef {
  label: string;
  key: string;
  type: string;
  required: boolean;
  description: string;
}

const STANDARD_CONTACT_FIELDS: StandardFieldDef[] = [
  { label: "Contact Name", key: "full_name", type: "Text", required: true, description: "Full legal or display name of the contact" },
  { label: "Phone", key: "phone", type: "Phone / Text", required: true, description: "Primary contact mobile number" },
  { label: "Email", key: "email", type: "Email", required: false, description: "Primary email address" },
  { label: "Company", key: "company_name", type: "Text", required: false, description: "Organization or enterprise name" },
  { label: "Source", key: "source", type: "Dropdown", required: false, description: "Acquisition channel (Meta, Google, WhatsApp, etc.)" },
  { label: "Lifecycle Stage", key: "lifecycle_stage", type: "Dropdown", required: false, description: "Sales journey stage (New, Contacted, Customer)" },
  { label: "Owner", key: "owner_name", type: "User", required: false, description: "Assigned CRM agent or account executive" }
];

const STANDARD_DEAL_FIELDS: StandardFieldDef[] = [
  { label: "Deal Name", key: "title", type: "Text", required: true, description: "Descriptive name for the opportunity" },
  { label: "Stage", key: "stage_id", type: "Pipeline Stage", required: true, description: "Current stage in sales pipeline" },
  { label: "Amount", key: "deal_value", type: "Currency (₹)", required: true, description: "Projected monetary deal value" },
  { label: "Closing Date", key: "expected_close_date", type: "Date", required: false, description: "Target date for deal completion" },
  { label: "Company", key: "company_name", type: "Text", required: false, description: "Associated account or company" },
  { label: "Contact", key: "contact_id", type: "Reference", required: false, description: "Primary associated contact" },
  { label: "Owner", key: "owner_name", type: "User", required: false, description: "Assigned sales rep" }
];

export default function ModulesAndFieldsManager({
  initialModule,
  readOnly = false
}: {
  initialModule?: "contacts" | "deals" | null;
  readOnly?: boolean;
}) {
  const { toast, confirm } = useToast();

  const [activeModule, setActiveModule] = useState<"contacts" | "deals" | null>(initialModule || null);
  const [contactCustomFields, setContactCustomFields] = useState<CustomFieldRecord[]>([]);
  const [dealCustomFields, setDealCustomFields] = useState<CustomFieldRecord[]>([]);
  const [loading, setLoading] = useState(false);

  // Add Field Modal State
  const [showAddModal, setShowAddModal] = useState(false);
  const [fieldLabel, setFieldLabel] = useState("");
  const [fieldKey, setFieldKey] = useState("");
  const [isKeyManuallyEdited, setIsKeyManuallyEdited] = useState(false);
  const [fieldType, setFieldType] = useState<"text" | "number" | "select" | "date" | "boolean">("text");
  const [dropdownOptions, setDropdownOptions] = useState("");
  const [isRequired, setIsRequired] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const loadAllCustomFields = useCallback(async () => {
    setLoading(true);
    try {
      const [contactsData, dealsData] = await Promise.all([
        api.getCustomFields("contacts"),
        api.getCustomFields("deals")
      ]);
      setContactCustomFields(contactsData || []);
      setDealCustomFields(dealsData || []);
    } catch (e) {
      console.warn("Error loading custom fields", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAllCustomFields();
  }, [loadAllCustomFields]);

  // Auto-slugify key from label
  const handleLabelChange = (val: string) => {
    setFieldLabel(val);
    if (!isKeyManuallyEdited) {
      const slug = val
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
      setFieldKey(slug);
    }
  };

  const resetForm = () => {
    setFieldLabel("");
    setFieldKey("");
    setIsKeyManuallyEdited(false);
    setFieldType("text");
    setDropdownOptions("");
    setIsRequired(false);
  };

  const handleOpenAddModal = () => {
    resetForm();
    setShowAddModal(true);
  };

  const handleSaveField = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeModule) return;

    const trimmedLabel = fieldLabel.trim();
    if (!trimmedLabel) {
      toast.warning("Validation Error", "Please provide a field label.");
      return;
    }

    let finalKey = fieldKey.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
    if (!finalKey) {
      finalKey = trimmedLabel.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    }

    if (fieldType === "select" && !dropdownOptions.trim()) {
      toast.warning("Options Required", "Please provide at least one option for dropdown field (comma-separated).");
      return;
    }

    const optionsList = fieldType === "select"
      ? dropdownOptions.split(",").map((s) => s.trim()).filter(Boolean)
      : null;

    setSubmitting(true);
    try {
      await api.createCustomField({
        module: activeModule,
        label: trimmedLabel,
        key: finalKey,
        field_type: fieldType,
        options: optionsList,
        is_required: isRequired,
        is_active: true
      });

      toast.success(
        "Field Created",
        `Custom field "${trimmedLabel}" has been added to ${activeModule === "contacts" ? "Contacts" : "Deals"}.`
      );
      setShowAddModal(false);
      resetForm();
      await loadAllCustomFields();
    } catch (err: any) {
      toast.error("Failed to Create Field", err.message || "An unexpected error occurred.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteField = async (field: CustomFieldRecord) => {
    if (!activeModule) return;

    const confirmed = await confirm({
      title: "Delete Custom Field",
      message: `Are you sure you want to remove the field "${field.label}" (${field.key}) from ${activeModule === "contacts" ? "Contacts" : "Deals"}? Existing values in records will be preserved in database backups.`,
      confirmText: "Delete Field",
      cancelText: "Cancel",
      variant: "danger"
    });

    if (confirmed) {
      try {
        await api.deleteCustomField(field.id, activeModule);
        toast.info("Field Removed", `Custom field "${field.label}" was deleted.`);
        await loadAllCustomFields();
      } catch (err: any) {
        toast.error("Delete Failed", err.message || "Could not delete custom field.");
      }
    }
  };

  const renderFieldTypeBadge = (type: string) => {
    const t = (type || "").toLowerCase();
    switch (t) {
      case "text":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200">
            <Type className="w-3.5 h-3.5 text-slate-500" />
            <span>Text</span>
          </span>
        );
      case "number":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
            <Hash className="w-3.5 h-3.5 text-blue-500" />
            <span>Number</span>
          </span>
        );
      case "select":
      case "dropdown":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-purple-50 text-purple-700 border border-purple-200">
            <ListFilter className="w-3.5 h-3.5 text-purple-500" />
            <span>Dropdown</span>
          </span>
        );
      case "date":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
            <Calendar className="w-3.5 h-3.5 text-amber-500" />
            <span>Date</span>
          </span>
        );
      case "boolean":
      case "toggle":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <ToggleRight className="w-3.5 h-3.5 text-emerald-500" />
            <span>Toggle</span>
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200">
            <span>{type}</span>
          </span>
        );
    }
  };

  // ==========================================
  // VIEW 1: MODULES DIRECTORY (CARDS VIEW)
  // ==========================================
  if (!activeModule) {
    return (
      <div className="space-y-6">

        {/* Modules Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Card 1: Contacts Module */}
          <div
            onClick={() => setActiveModule("contacts")}
            className="group bg-white rounded-2xl border border-slate-200/90 hover:border-red-400 p-6 shadow-xs hover:shadow-md transition-all cursor-pointer flex flex-col justify-between"
          >
            <div className="space-y-4">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-red-50 text-red-600 flex items-center justify-center border border-red-100 group-hover:bg-red-600 group-hover:text-white transition-colors shadow-2xs">
                    <Users className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-slate-900 group-hover:text-red-600 transition-colors">Contacts</h3>
                    <p className="text-xs text-slate-500 font-medium">Clients, prospects, and company representatives</p>
                  </div>
                </div>
                <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
                  System Core
                </span>
              </div>

              {/* Standard Fields Preview */}
              <div>
                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-2">Standard Attributes:</span>
                <div className="flex flex-wrap gap-1.5">
                  {STANDARD_CONTACT_FIELDS.map((f) => (
                    <span key={f.key} className="px-2.5 py-1 bg-slate-50 border border-slate-200/80 rounded-lg text-xs font-medium text-slate-700">
                      {f.label}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* Footer with custom field count */}
            <div className="pt-6 mt-6 border-t border-slate-100 flex items-center justify-between text-xs font-semibold">
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-1 rounded-lg bg-red-50 text-red-700 font-bold border border-red-200/60">
                  {contactCustomFields.length} {contactCustomFields.length === 1 ? "Custom Field" : "Custom Fields"}
                </span>
              </div>
              <span className="text-red-600 flex items-center gap-1 group-hover:translate-x-0.5 transition-transform font-bold">
                Configure Fields
                <ChevronRight className="w-4 h-4" />
              </span>
            </div>
          </div>

          {/* Card 2: Deals Module */}
          <div
            onClick={() => setActiveModule("deals")}
            className="group bg-white rounded-2xl border border-slate-200/90 hover:border-red-400 p-6 shadow-xs hover:shadow-md transition-all cursor-pointer flex flex-col justify-between"
          >
            <div className="space-y-4">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-100 group-hover:bg-emerald-600 group-hover:text-white transition-colors shadow-2xs">
                    <DollarSign className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-slate-900 group-hover:text-red-600 transition-colors">Deals / Opportunities</h3>
                    <p className="text-xs text-slate-500 font-medium">Pipeline revenue, closing probability, and stages</p>
                  </div>
                </div>
                <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
                  System Core
                </span>
              </div>

              {/* Standard Fields Preview */}
              <div>
                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-2">Standard Attributes:</span>
                <div className="flex flex-wrap gap-1.5">
                  {STANDARD_DEAL_FIELDS.map((f) => (
                    <span key={f.key} className="px-2.5 py-1 bg-slate-50 border border-slate-200/80 rounded-lg text-xs font-medium text-slate-700">
                      {f.label}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* Footer with custom field count */}
            <div className="pt-6 mt-6 border-t border-slate-100 flex items-center justify-between text-xs font-semibold">
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 font-bold border border-emerald-200/60">
                  {dealCustomFields.length} {dealCustomFields.length === 1 ? "Custom Field" : "Custom Fields"}
                </span>
              </div>
              <span className="text-red-600 flex items-center gap-1 group-hover:translate-x-0.5 transition-transform font-bold">
                Configure Fields
                <ChevronRight className="w-4 h-4" />
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ==========================================
  // VIEW 2: MODULE DETAIL & FIELD MANAGER
  // ==========================================
  const currentCustomFields = activeModule === "contacts" ? contactCustomFields : dealCustomFields;
  const currentStandardFields = activeModule === "contacts" ? STANDARD_CONTACT_FIELDS : STANDARD_DEAL_FIELDS;
  const moduleTitle = activeModule === "contacts" ? "Contacts" : "Deals";

  return (
    <div className="space-y-6">
      {/* Detail Top Header */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setActiveModule(null)}
            className="p-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-600 hover:text-slate-900 transition-colors cursor-pointer"
            title="Back to all modules"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-slate-900">{moduleTitle} Module Fields</h2>
              <span className="px-2 py-0.5 text-[11px] font-bold rounded-md bg-red-50 text-red-600 border border-red-200">
                {currentCustomFields.length} Custom
              </span>
            </div>
            <p className="text-xs text-slate-500 font-medium mt-0.5">
              Customize schema fields for {moduleTitle.toLowerCase()}. All custom attributes are available in column customizers and detail drawers.
            </p>
          </div>
        </div>

        {!readOnly ? (
          <button
            type="button"
            onClick={handleOpenAddModal}
            className="h-10 px-4 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs sm:text-sm font-semibold shadow-xs transition-colors cursor-pointer flex items-center justify-center gap-2 shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>Add Custom Field</span>
          </button>
        ) : (
          <div className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 border border-slate-200 text-slate-600 rounded-xl text-xs font-semibold shrink-0">
            <Lock className="w-3.5 h-3.5 text-slate-500" />
            <span>View Only (Sales Rep)</span>
          </div>
        )}
      </div>

      {/* SECTION 1: CUSTOM ATTRIBUTES */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div>
            <h3 className="text-sm font-bold text-slate-900">Custom Attributes ({currentCustomFields.length})</h3>
            <p className="text-xs text-slate-500">Dynamic user-defined fields stored in JSONB</p>
          </div>
        </div>

        {currentCustomFields.length === 0 ? (
          <div className="py-14 text-center px-4">
            <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-3">
              <Sliders className="w-6 h-6" />
            </div>
            <p className="text-sm font-bold text-slate-900">No custom fields created yet</p>
            <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1 mb-4">
              Add attributes like GST Number, PAN, Industry Category, or Alternate Contact to enrich your records.
            </p>
            {!readOnly ? (
              <button
                type="button"
                onClick={handleOpenAddModal}
                className="px-3.5 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-semibold shadow-xs transition-colors cursor-pointer inline-flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Create First Custom Field</span>
              </button>
            ) : (
              <p className="text-xs text-slate-400 font-medium">Custom schema fields are managed by workspace administrators.</p>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="bg-slate-50/80 border-b border-slate-200/80 text-xs font-bold text-slate-700 select-none">
                  <th className="py-3 px-5">Field Label</th>
                  <th className="py-3 px-5">API Key</th>
                  <th className="py-3 px-5">Type</th>
                  <th className="py-3 px-5">Mandatory</th>
                  <th className="py-3 px-5">Status</th>
                  {!readOnly && <th className="py-3 px-5 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700 text-xs">
                {currentCustomFields.map((field) => (
                  <tr key={field.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="py-3.5 px-5 font-bold text-slate-900">
                      {field.label}
                    </td>
                    <td className="py-3.5 px-5 font-mono text-xs text-slate-500">
                      <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                        {field.key}
                      </span>
                    </td>
                    <td className="py-3.5 px-5">
                      <div className="flex flex-col gap-1 items-start">
                        {renderFieldTypeBadge(field.field_type)}
                        {field.field_type === "select" && Array.isArray(field.options) && (
                          <span className="text-[10px] text-slate-400 font-medium">
                            {field.options.slice(0, 3).join(", ")}
                            {field.options.length > 3 ? ` +${field.options.length - 3} more` : ""}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3.5 px-5">
                      {field.is_required ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                          Required
                        </span>
                      ) : (
                        <span className="text-slate-400 font-medium">Optional</span>
                      )}
                    </td>
                    <td className="py-3.5 px-5">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                        <CheckCircle2 className="w-2.5 h-2.5" />
                        Active
                      </span>
                    </td>
                    {!readOnly && (
                      <td className="py-3.5 px-5 text-right">
                        <button
                          type="button"
                          onClick={() => handleDeleteField(field)}
                          className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                          title="Delete custom field"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* SECTION 2: STANDARD ATTRIBUTES (LOCKED) */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div>
            <h3 className="text-sm font-bold text-slate-900">Standard System Fields ({currentStandardFields.length})</h3>
            <p className="text-xs text-slate-500">Built-in attributes essential for pipeline stages, telephony, and communications</p>
          </div>
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-600 border border-slate-200">
            <Lock className="w-3 h-3 text-slate-400" />
            System Locked
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="bg-slate-50/80 border-b border-slate-200/80 text-xs font-bold text-slate-700 select-none">
                <th className="py-3 px-5">Field Label</th>
                <th className="py-3 px-5">Key</th>
                <th className="py-3 px-5">Type</th>
                <th className="py-3 px-5">Constraint</th>
                <th className="py-3 px-5">Description</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700 text-xs">
              {currentStandardFields.map((f) => (
                <tr key={f.key} className="hover:bg-slate-50/40 transition-colors">
                  <td className="py-3 px-5 font-bold text-slate-800 flex items-center gap-2">
                    <span>{f.label}</span>
                    <Lock className="w-3 h-3 text-slate-400 shrink-0" />
                  </td>
                  <td className="py-3 px-5 font-mono text-slate-400 text-[11px]">{f.key}</td>
                  <td className="py-3 px-5 text-slate-600 font-medium">{f.type}</td>
                  <td className="py-3 px-5">
                    {f.required ? (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
                        System Mandatory
                      </span>
                    ) : (
                      <span className="text-slate-400">Optional</span>
                    )}
                  </td>
                  <td className="py-3 px-5 text-slate-500">{f.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODAL: ADD CUSTOM FIELD */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-100">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full border border-slate-200 overflow-hidden flex flex-col">
            {/* Modal Header */}
            <div className="px-6 py-4.5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-red-50 text-red-600 border border-red-100">
                  <Sliders className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Add Field to {moduleTitle}</h3>
                  <p className="text-[11px] text-slate-500 font-medium">Define a dynamic attribute for all {moduleTitle.toLowerCase()}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Form */}
            <form onSubmit={handleSaveField} className="p-6 space-y-4">
              {/* Field Label */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Field Label <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. GST Number, Alternate Phone, Industry"
                  value={fieldLabel}
                  onChange={(e) => handleLabelChange(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-red-500 focus:bg-white transition-all"
                />
              </div>

              {/* Field Key (Slug) */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5 flex items-center justify-between">
                  <span>API Key</span>
                  <span className="text-[10px] text-slate-400 font-mono font-normal">Auto-generated</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. gst_number"
                  value={fieldKey}
                  onChange={(e) => {
                    setIsKeyManuallyEdited(true);
                    setFieldKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"));
                  }}
                  className="w-full px-3.5 py-2 bg-slate-100/70 border border-slate-200 rounded-xl text-xs font-mono font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:bg-white transition-all"
                />
              </div>

              {/* Field Type */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Field Type <span className="text-red-500">*</span>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: "text", label: "Text", icon: <Type className="w-3.5 h-3.5 text-slate-600" /> },
                    { id: "number", label: "Number", icon: <Hash className="w-3.5 h-3.5 text-blue-600" /> },
                    { id: "select", label: "Dropdown", icon: <ListFilter className="w-3.5 h-3.5 text-purple-600" /> },
                    { id: "date", label: "Date", icon: <Calendar className="w-3.5 h-3.5 text-amber-600" /> },
                    { id: "boolean", label: "Toggle (Yes/No)", icon: <ToggleRight className="w-3.5 h-3.5 text-emerald-600" /> }
                  ].map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setFieldType(t.id as any)}
                      className={`px-3 py-2 rounded-xl border text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer ${
                        fieldType === t.id
                          ? "border-red-600 bg-red-50/50 text-red-700 shadow-2xs font-bold"
                          : "border-slate-200 bg-white hover:bg-slate-50 text-slate-700"
                      }`}
                    >
                      {t.icon}
                      <span>{t.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Conditional: Dropdown Options */}
              {fieldType === "select" && (
                <div className="pt-1">
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">
                    Dropdown Options (comma-separated) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Retail, Wholesale, Enterprise, Government"
                    value={dropdownOptions}
                    onChange={(e) => setDropdownOptions(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-red-500 focus:bg-white transition-all"
                  />
                  <p className="text-[10px] text-slate-400 mt-1">Separate options with commas.</p>
                </div>
              )}

              {/* Mandatory Checkbox */}
              <div className="pt-2">
                <label className="flex items-center gap-2.5 cursor-pointer text-xs font-semibold text-slate-700 select-none">
                  <input
                    type="checkbox"
                    checked={isRequired}
                    onChange={(e) => setIsRequired(e.target.checked)}
                    className="w-4 h-4 rounded text-red-600 focus:ring-red-500 border-slate-300"
                  />
                  <span>Make this a required field</span>
                </label>
              </div>

              {/* Actions */}
              <div className="pt-4 flex items-center justify-end gap-2.5 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold shadow-xs transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                >
                  {submitting ? "Saving..." : "Save Field"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
