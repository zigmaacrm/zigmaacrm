"use client";

import { useState, useEffect } from "react";
import {
  Receipt,
  Plus,
  Trash2,
  CheckCircle2,
  Printer,
  Search,
  CreditCard,
  FileText,
  DollarSign,
  X
} from "lucide-react";
import Sidebar from "@/components/layout/Sidebar";
import Header from "@/components/layout/Header";
import { api } from "@/lib/api";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Invoice, InvoiceItem } from "@/lib/mockData";
import { useToast } from "@/components/common/ToastProvider";

export default function BillingPage() {
  const { toast, confirm } = useToast();
  const [invoices, setInvoices] = useState<Invoice[]>([]);

  const [clientName, setClientName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"Bank Transfer" | "UPI" | "Card" | "Cash">("Bank Transfer");
  const [items, setItems] = useState<InvoiceItem[]>([
    { name: "Software Subscription / Professional Services", qty: 1, unit_price: 0, total: 0 }
  ]);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const loadInvoices = async () => {
    try {
      const data = await api.getInvoices();
      setInvoices(data);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    loadInvoices();
  }, []);

  const handleAddItem = () => {
    setItems([...items, { name: "Custom Integration / Onboarding", qty: 1, unit_price: 0, total: 0 }]);
  };

  const handleRemoveItem = (idx: number) => {
    if (items.length <= 1) return;
    setItems(items.filter((_, i) => i !== idx));
  };

  const handleItemChange = (idx: number, field: keyof InvoiceItem, value: any) => {
    const next = [...items];
    (next[idx] as any)[field] = value;
    if (field === "qty" || field === "unit_price") {
      next[idx].total = Number(next[idx].qty || 0) * Number(next[idx].unit_price || 0);
    }
    setItems(next);
  };

  const grandTotal = items.reduce((sum, item) => sum + (Number(item.qty || 0) * Number(item.unit_price || 0)), 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientName) return;
    setSubmitting(true);

    try {
      const newInv = await api.createInvoice({
        client_name: clientName,
        phone,
        email,
        items,
        total_amount: grandTotal,
        payment_method: paymentMethod as any,
        status: "Paid"
      });

      setClientName("");
      setPhone("");
      setEmail("");
      setItems([{ name: "Software Subscription / Professional Services", qty: 1, unit_price: 0, total: 0 }]);
      setShowCreateModal(false);
      setSelectedInvoice(newInv);
      toast.success("Invoice Created", `Invoice ${newInv.bill_number} generated.`);
      loadInvoices();
    } catch (err) {
      console.error("Billing creation error", err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: number | string) => {
    const inv = invoices.find((i) => String(i.id) === String(id));
    const confirmed = await confirm({
      title: "Delete Invoice",
      message: `Are you sure you want to delete invoice ${inv ? inv.bill_number : ""}?`,
      confirmText: "Delete",
      cancelText: "Cancel",
      variant: "danger"
    });

    if (confirmed) {
      await api.deleteInvoice(id);
      toast.success("Invoice Deleted", "The record was removed.");
      loadInvoices();
    }
  };


  const totalInvoiced = invoices.reduce((sum, inv) => sum + (Number(inv.total_amount) || 0), 0);

  return (
    <div className="flex h-screen bg-[#F8FAFC] dark:bg-[#0b0f19] text-slate-900 dark:text-slate-100 font-sans overflow-hidden select-none">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Header />

        <main className="flex-1 overflow-y-auto p-6 lg:p-8 space-y-6 custom-scrollbar bg-[#F8FAFC] dark:bg-[#0b0f19]">
          {/* Action Row */}
          <div className="flex items-center justify-end">
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-1.5 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-semibold shadow-sm transition-all"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Create Invoice</span>
            </button>
          </div>

          {/* Metrics */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="p-4 rounded-xl bg-white border border-slate-200 border-t-[3px] border-t-red-600 shadow-xs flex items-center justify-between">
              <div>
                <p className="text-[11px] font-bold text-slate-400 uppercase">Total Invoiced</p>
                <p className="text-2xl font-bold text-slate-900 mt-1">{formatCurrency(totalInvoiced)}</p>
              </div>
              <div className="p-2 rounded-full bg-red-50 text-red-600">
                <Receipt className="w-4 h-4" />
              </div>
            </div>

            <div className="p-4 rounded-xl bg-white border border-slate-200 border-t-[3px] border-t-emerald-500 shadow-xs flex items-center justify-between">
              <div>
                <p className="text-[11px] font-bold text-slate-400 uppercase">Paid Invoices</p>
                <p className="text-2xl font-bold text-emerald-600 mt-1">
                  {invoices.filter(i => i.status === "Paid").length}
                </p>
              </div>
              <div className="p-2 rounded-full bg-emerald-50 text-emerald-600">
                <CheckCircle2 className="w-4 h-4" />
              </div>
            </div>

            <div className="p-4 rounded-xl bg-white border border-slate-200 border-t-[3px] border-t-blue-500 shadow-xs flex items-center justify-between">
              <div>
                <p className="text-[11px] font-bold text-slate-400 uppercase">Total Count</p>
                <p className="text-2xl font-bold text-slate-900 mt-1">{invoices.length}</p>
              </div>
              <div className="p-2 rounded-full bg-blue-50 text-blue-600">
                <FileText className="w-4 h-4" />
              </div>
            </div>
          </div>

          {/* Invoices Table or Zero State */}
          {invoices.length === 0 ? (
            <div className="p-12 rounded-2xl bg-white border border-slate-200 shadow-xs text-center space-y-3">
              <div className="w-12 h-12 rounded-full bg-red-50 text-red-600 flex items-center justify-center mx-auto">
                <Receipt className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-800">No invoices generated yet</h3>
                <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                  Start from zero. Create professional customer invoices with custom line items.
                </p>
              </div>
              <button
                onClick={() => setShowCreateModal(true)}
                className="px-4 py-2 bg-red-600 text-white text-xs font-bold rounded-xl"
              >
                Create First Invoice
              </button>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-100 text-slate-400 font-bold uppercase text-[11px] bg-slate-50/50">
                    <th className="py-3 px-4">Invoice #</th>
                    <th className="py-3 px-4">Client Name</th>
                    <th className="py-3 px-4">Date</th>
                    <th className="py-3 px-4">Payment Method</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Amount</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {invoices.map((inv) => (
                    <tr key={inv.id} className="hover:bg-slate-50 transition-colors">
                      <td className="py-3 px-4 font-mono font-bold text-slate-900">{inv.bill_number}</td>
                      <td className="py-3 px-4 font-semibold text-slate-800">
                        {inv.client_name || inv.patient_name || "Client"}
                      </td>
                      <td className="py-3 px-4 text-slate-600">{new Date(inv.created_at || Date.now()).toLocaleDateString()}</td>
                      <td className="py-3 px-4 text-slate-600">{inv.payment_method}</td>
                      <td className="py-3 px-4">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                          {inv.status || "Paid"}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-bold text-slate-900">{formatCurrency(inv.total_amount)}</td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => setSelectedInvoice(inv)}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-red-600 hover:bg-red-50"
                            title="View / Print"
                          >
                            <Printer className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDelete(inv.id)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                            title="Delete"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </main>
      </div>

      {/* Create Invoice Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 space-y-4 border border-slate-200 max-h-[90vh] overflow-y-auto custom-scrollbar">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-slate-900 text-base">Generate Commercial Invoice</h3>
              <button onClick={() => setShowCreateModal(false)} className="p-1 rounded text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Client / Company Name *</label>
                  <input
                    type="text"
                    required
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                    placeholder="e.g. Acme Technologies"
                    className="w-full bg-slate-50 text-slate-900 text-xs px-3.5 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-red-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Phone</label>
                  <input
                    type="text"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+91..."
                    className="w-full bg-slate-50 text-slate-900 text-xs px-3.5 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-red-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Billing Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="billing@acme.com"
                  className="w-full bg-slate-50 text-slate-900 text-xs px-3.5 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>

              {/* Line Items */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-700">Invoice Items</span>
                  <button
                    type="button"
                    onClick={handleAddItem}
                    className="text-xs font-semibold text-red-600 hover:underline flex items-center gap-1"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Add Item</span>
                  </button>
                </div>

                {items.map((item, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={item.name}
                      onChange={(e) => handleItemChange(idx, "name", e.target.value)}
                      placeholder="Item description"
                      className="flex-1 bg-slate-50 text-slate-900 text-xs px-3 py-2 rounded-xl border border-slate-200"
                    />
                    <input
                      type="number"
                      min="1"
                      value={item.qty}
                      onChange={(e) => handleItemChange(idx, "qty", Number(e.target.value))}
                      className="w-16 bg-slate-50 text-slate-900 text-xs px-2 py-2 rounded-xl border border-slate-200 text-center"
                    />
                    <input
                      type="number"
                      value={item.unit_price}
                      onChange={(e) => handleItemChange(idx, "unit_price", Number(e.target.value))}
                      placeholder="Price"
                      className="w-24 bg-slate-50 text-slate-900 text-xs px-2 py-2 rounded-xl border border-slate-200 font-bold"
                    />
                    {items.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveItem(idx)}
                        className="text-slate-400 hover:text-rose-600 p-1"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {/* Total & Payment Method */}
              <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 mb-1">Payment Method</label>
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value as any)}
                    className="bg-slate-50 text-slate-800 text-xs px-2.5 py-1.5 rounded-lg border border-slate-200"
                  >
                    <option value="Bank Transfer">Bank Transfer (NEFT)</option>
                    <option value="UPI">UPI / Instant Pay</option>
                    <option value="Card">Card</option>
                    <option value="Cash">Cash</option>
                  </select>
                </div>

                <div className="text-right">
                  <span className="text-xs text-slate-400 font-medium">Grand Total:</span>
                  <p className="text-lg font-bold text-slate-900">{formatCurrency(grandTotal)}</p>
                </div>
              </div>

              <div className="pt-2 flex justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-500 hover:text-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 bg-red-600 text-white text-xs font-bold rounded-xl shadow hover:bg-red-700"
                >
                  Generate Invoice
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Printable Invoice Modal */}
      {selectedInvoice && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-4 border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Receipt className="w-5 h-5 text-red-600" />
                <span className="font-bold text-slate-900 text-sm">Invoice #{selectedInvoice.bill_number}</span>
              </div>
              <button onClick={() => setSelectedInvoice(null)} className="p-1 rounded text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="text-xs space-y-3">
              <div className="flex justify-between text-slate-600">
                <span>Client: <strong>{selectedInvoice.client_name || selectedInvoice.patient_name}</strong></span>
                <span>Date: {new Date(selectedInvoice.created_at || Date.now()).toLocaleDateString()}</span>
              </div>

              <div className="border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100">
                {selectedInvoice.items.map((it, idx) => (
                  <div key={idx} className="p-2.5 flex justify-between">
                    <span>{it.name} (x{it.qty})</span>
                    <span className="font-bold">{formatCurrency(it.total || it.unit_price * it.qty)}</span>
                  </div>
                ))}
              </div>

              <div className="flex justify-between text-sm font-bold pt-2 border-t border-slate-100">
                <span>Total Amount:</span>
                <span className="text-red-600">{formatCurrency(selectedInvoice.total_amount)}</span>
              </div>
            </div>

            <div className="pt-2 flex justify-end gap-2 border-t border-slate-100">
              <button
                onClick={() => window.print()}
                className="px-4 py-2 bg-red-600 text-white text-xs font-bold rounded-xl shadow hover:bg-red-700 flex items-center gap-1.5"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Print Invoice</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
