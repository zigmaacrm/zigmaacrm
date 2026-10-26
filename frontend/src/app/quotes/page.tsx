"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import {
  FileText,
  Plus,
  Search,
  Printer,
  Download,
  Trash2,
  ExternalLink,
  DollarSign,
  Receipt,
  CheckCircle2,
  Clock,
  Building2,
  User,
  Filter
} from "lucide-react";
import Sidebar from "@/components/layout/Sidebar";
import Header from "@/components/layout/Header";
import CreateQuoteDrawer from "@/components/quotes/CreateQuoteDrawer";
import QuotationPreviewModal from "@/components/quotes/QuotationPreviewModal";
import { api } from "@/lib/api";
import { Invoice } from "@/lib/mockData";
import { formatCurrency, formatDate } from "@/lib/utils";
import { useToast } from "@/components/common/ToastProvider";
import CustomDropdown from "@/components/common/CustomDropdown";

export default function QuotesPage() {
  const { toast, confirm } = useToast();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("ALL");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");

  // Drawer & Modal State
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [drawerDocType, setDrawerDocType] = useState<"QUOTE" | "INVOICE">("QUOTE");
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  const loadInvoices = useCallback(async () => {
    try {
      const data = await api.getInvoices();
      setInvoices(data || []);
    } catch (e) {
      console.error("Failed to load invoices:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadInvoices();
  }, [loadInvoices]);

  const handleOpenCreateDrawer = (type: "QUOTE" | "INVOICE") => {
    setDrawerDocType(type);
    setIsDrawerOpen(true);
  };

  const handleCreated = (saved: Invoice) => {
    setInvoices((prev) => [saved, ...prev.filter((i) => String(i.id) !== String(saved.id))]);
    loadInvoices();
  };

  const handlePreview = (inv: Invoice) => {
    setSelectedInvoice(inv);
    setIsPreviewOpen(true);
  };

  const handleDelete = async (id: number | string) => {
    const inv = invoices.find((i) => String(i.id) === String(id));
    const confirmed = await confirm({
      title: "Delete Document",
      message: `Are you sure you want to delete ${inv?.invoice_number || "this document"}?`,
      confirmText: "Delete",
      cancelText: "Cancel",
      variant: "danger"
    });

    if (confirmed) {
      setInvoices((prev) => prev.filter((i) => String(i.id) !== String(id)));
      try {
        await api.deleteInvoice(id);
        toast.success("Deleted", "Document removed successfully.");
      } catch (e) {
        console.error(e);
      }
    }
  };

  // Filtered List
  const filteredInvoices = useMemo(() => {
    return invoices.filter((inv) => {
      if (typeFilter !== "ALL" && (inv.type || "QUOTE").toUpperCase() !== typeFilter) {
        return false;
      }
      if (statusFilter !== "ALL" && (inv.status || "DRAFT").toUpperCase() !== statusFilter) {
        return false;
      }
      if (search.trim()) {
        const q = search.toLowerCase();
        const num = (inv.invoice_number || inv.bill_number || "").toLowerCase();
        const client = (inv.client_name || inv.patient_name || "").toLowerCase();
        const comp = (inv.client_company || "").toLowerCase();
        return num.includes(q) || client.includes(q) || comp.includes(q);
      }
      return true;
    });
  }, [invoices, typeFilter, statusFilter, search]);

  // Metric Computations
  const totalCount = invoices.length;
  const totalValue = invoices.reduce((sum, i) => sum + (Number(i.total_amount) || 0), 0);
  const quotesCount = invoices.filter((i) => (i.type || "QUOTE").toUpperCase() === "QUOTE").length;
  const invoicesCount = invoices.filter((i) => (i.type || "").toUpperCase() === "INVOICE").length;

  return (
    <div className="flex h-screen bg-[#F8FAFC] dark:bg-[#0b0f19] text-slate-900 dark:text-slate-100 font-sans overflow-hidden select-none">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Header />

        <main className="flex-1 overflow-y-auto p-6 lg:p-8 space-y-6 custom-scrollbar bg-[#F8FAFC] dark:bg-[#0b0f19]">
          {/* Header Bar */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
                  Quotes & Invoicing
                </h1>
                <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-semibold shadow-2xs">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  PDF Engine Ready
                </span>
              </div>
              <p className="text-xs text-slate-500 font-medium mt-0.5">
                Generate enterprise quotations, tax invoices, and commercial proposals
              </p>
            </div>

            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => handleOpenCreateDrawer("QUOTE")}
                className="flex items-center gap-1.5 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-semibold shadow-sm transition-all cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Create Quote</span>
              </button>

              <button
                type="button"
                onClick={() => handleOpenCreateDrawer("INVOICE")}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-white border border-slate-200 text-slate-700 hover:border-red-500 hover:text-red-600 rounded-xl text-xs font-semibold shadow-xs transition-colors cursor-pointer"
              >
                <Receipt className="w-4 h-4" />
                <span>+ Tax Invoice</span>
              </button>
            </div>
          </div>

          {/* KPI Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-4 rounded-xl bg-white border border-slate-200 border-t-[3px] border-t-red-600 shadow-xs flex items-center justify-between">
              <div>
                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Total Value</p>
                <p className="text-2xl font-bold text-slate-900 mt-1">{formatCurrency(totalValue)}</p>
                <p className="text-[10px] text-slate-400 mt-0.5">{totalCount} total documents</p>
              </div>
              <div className="p-2.5 rounded-xl bg-red-50 text-red-600">
                <DollarSign className="w-5 h-5" />
              </div>
            </div>

            <div className="p-4 rounded-xl bg-white border border-slate-200 border-t-[3px] border-t-blue-500 shadow-xs flex items-center justify-between">
              <div>
                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Quotations</p>
                <p className="text-2xl font-bold text-slate-900 mt-1">{quotesCount}</p>
                <p className="text-[10px] text-slate-400 mt-0.5">Commercial estimates</p>
              </div>
              <div className="p-2.5 rounded-xl bg-blue-50 text-blue-600">
                <FileText className="w-5 h-5" />
              </div>
            </div>

            <div className="p-4 rounded-xl bg-white border border-slate-200 border-t-[3px] border-t-emerald-500 shadow-xs flex items-center justify-between">
              <div>
                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Tax Invoices</p>
                <p className="text-2xl font-bold text-slate-900 mt-1">{invoicesCount}</p>
                <p className="text-[10px] text-slate-400 mt-0.5">Issued bills</p>
              </div>
              <div className="p-2.5 rounded-xl bg-emerald-50 text-emerald-600">
                <Receipt className="w-5 h-5" />
              </div>
            </div>

            <div className="p-4 rounded-xl bg-white border border-slate-200 border-t-[3px] border-t-amber-500 shadow-xs flex items-center justify-between">
              <div>
                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Active Pipeline Deals</p>
                <p className="text-2xl font-bold text-slate-900 mt-1">Proposal Stage</p>
                <p className="text-[10px] text-slate-400 mt-0.5">Automated stage sync</p>
              </div>
              <div className="p-2.5 rounded-xl bg-amber-50 text-amber-600">
                <CheckCircle2 className="w-5 h-5" />
              </div>
            </div>
          </div>

          {/* Table Container */}
          <div className="p-6 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-4">
            {/* Filter row */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
              <div className="relative flex-1 max-w-sm">
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by quote/invoice #, client, or company..."
                  className="w-full bg-slate-50 text-slate-900 text-xs pl-8 pr-3 py-2 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-red-500 font-medium"
                />
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
              </div>

              <div className="flex items-center gap-2">
                {/* Type Filter */}
                <CustomDropdown
                  value={typeFilter}
                  onChange={(val) => setTypeFilter(String(val))}
                  size="sm"
                  variant="input"
                  className="w-36 text-xs"
                  options={[
                    { value: "ALL", label: "All Types" },
                    { value: "QUOTE", label: "Quotations" },
                    { value: "INVOICE", label: "Tax Invoices" },
                  ]}
                />

                {/* Status Filter */}
                <CustomDropdown
                  value={statusFilter}
                  onChange={(val) => setStatusFilter(String(val))}
                  size="sm"
                  variant="input"
                  className="w-40 text-xs"
                  options={[
                    { value: "ALL", label: "All Statuses" },
                    { value: "DRAFT", label: "Draft", dotColor: "bg-slate-400" },
                    { value: "SENT", label: "Sent / Proposal", dotColor: "bg-blue-500" },
                    { value: "PAID", label: "Paid", dotColor: "bg-emerald-500" },
                    { value: "OVERDUE", label: "Overdue", dotColor: "bg-rose-500" },
                  ]}
                />
              </div>
            </div>

            {/* Invoices & Quotes Table */}
            {filteredInvoices.length === 0 ? (
              <div className="py-16 text-center space-y-3">
                <div className="w-12 h-12 rounded-2xl bg-red-50 text-red-600 flex items-center justify-center mx-auto shadow-2xs">
                  <FileText className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-800">No documents found</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Create your first quotation or invoice with instant PDF generation.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleOpenCreateDrawer("QUOTE")}
                  className="px-4 py-2 bg-red-600 text-white rounded-xl text-xs font-bold shadow-xs hover:bg-red-700 transition-colors cursor-pointer"
                >
                  + Create First Quote
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-400 font-bold uppercase text-[10px] tracking-wider">
                      <th className="py-3 px-4">Document #</th>
                      <th className="py-3 px-4">Client / Company</th>
                      <th className="py-3 px-3 text-center">Type</th>
                      <th className="py-3 px-3 text-center">Status</th>
                      <th className="py-3 px-4">Date</th>
                      <th className="py-3 px-4 text-right">Amount (₹)</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredInvoices.map((inv) => {
                      const docNo = inv.invoice_number || inv.bill_number || `DOC-${inv.id}`;
                      const isQuote = (inv.type || "QUOTE").toUpperCase() === "QUOTE";
                      return (
                        <tr
                          key={inv.id}
                          className="hover:bg-slate-50/70 transition-colors group cursor-pointer"
                          onClick={() => handlePreview(inv)}
                        >
                          <td className="py-3.5 px-4 font-mono font-bold text-slate-900 group-hover:text-red-600">
                            {docNo}
                          </td>
                          <td className="py-3.5 px-4">
                            <span className="font-bold text-slate-900 block truncate max-w-[200px]">
                              {inv.client_name || inv.patient_name || "Client"}
                            </span>
                            {inv.client_company && (
                              <span className="text-[10px] text-slate-400 block truncate max-w-[200px]">
                                {inv.client_company}
                              </span>
                            )}
                          </td>
                          <td className="py-3.5 px-3 text-center">
                            <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                              isQuote
                                ? "bg-blue-50 text-blue-700 border border-blue-200"
                                : "bg-emerald-50 text-emerald-700 border border-emerald-200"
                            }`}>
                              {isQuote ? "Quote" : "Invoice"}
                            </span>
                          </td>
                          <td className="py-3.5 px-3 text-center">
                            <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                              inv.status === "PAID"
                                ? "bg-emerald-100 text-emerald-800"
                                : inv.status === "SENT"
                                ? "bg-purple-50 text-purple-700 border border-purple-200"
                                : "bg-slate-100 text-slate-600"
                            }`}>
                              {inv.status || "DRAFT"}
                            </span>
                          </td>
                          <td className="py-3.5 px-4 text-slate-500 font-medium">
                            {inv.issue_date || (inv.created_at ? formatDate(inv.created_at) : "—")}
                          </td>
                          <td className="py-3.5 px-4 text-right font-black text-slate-900">
                            {formatCurrency(inv.total_amount)}
                          </td>
                          <td className="py-3.5 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => handlePreview(inv)}
                                className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-600 transition-colors"
                                title="View & Print Preview"
                              >
                                <Printer className="w-3.5 h-3.5" />
                              </button>

                              <button
                                type="button"
                                onClick={() => window.open(`http://localhost:8000/api/v1/invoices/${inv.id}/pdf`, "_blank")}
                                className="p-1.5 rounded-lg border border-slate-200 hover:bg-red-50 hover:text-red-600 text-slate-600 transition-colors"
                                title="Download PDF View"
                              >
                                <Download className="w-3.5 h-3.5" />
                              </button>

                              <button
                                type="button"
                                onClick={() => handleDelete(inv.id)}
                                className="p-1.5 rounded-lg border border-slate-200 hover:bg-rose-50 text-slate-400 hover:text-rose-600 transition-colors"
                                title="Delete Document"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </main>
      </div>

      {/* Slide-over Create Quote Drawer */}
      <CreateQuoteDrawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        onSuccess={handleCreated}
        initialType={drawerDocType}
      />

      {/* Quote Preview & Print Modal */}
      <QuotationPreviewModal
        invoice={selectedInvoice}
        isOpen={isPreviewOpen}
        onClose={() => setIsPreviewOpen(false)}
      />
    </div>
  );
}
