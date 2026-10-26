"use client";

import { useState, useEffect } from "react";
import {
  Receipt,
  Plus,
  Trash2,
  Calendar,
  CreditCard,
  CheckCircle2,
  X,
  Filter
} from "lucide-react";
import Sidebar from "@/components/layout/Sidebar";
import Header from "@/components/layout/Header";
import { api } from "@/lib/api";
import { formatCurrency } from "@/lib/utils";
import { Expense } from "@/lib/mockData";
import { useToast } from "@/components/common/ToastProvider";
import CustomDropdown from "@/components/common/CustomDropdown";
import CustomDatePicker from "@/components/common/CustomDatePicker";

export default function ExpensesPage() {
  const { toast, confirm } = useToast();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [showAddModal, setShowAddModal] = useState(false);

  // Form
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<"Marketing" | "Software" | "Office" | "Travel" | "Salaries" | "Other">("Software");
  const [amount, setAmount] = useState<number>(0);
  const [date, setDate] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"Card" | "UPI" | "Bank Transfer" | "Cash">("Card");
  const [status, setStatus] = useState<"Paid" | "Pending">("Paid");

  const loadExpenses = async () => {
    try {
      const data = await api.getExpenses();
      setExpenses(data);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    loadExpenses();
    setDate(new Date().toISOString().split("T")[0]);
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !amount) return;
    await api.createExpense({
      title,
      category,
      amount: Number(amount) || 0,
      date,
      payment_method: paymentMethod,
      status
    });
    setTitle("");
    setAmount(0);
    setShowAddModal(false);
    toast.success("Expense Added", `"${title}" was recorded.`);
    loadExpenses();
  };

  const handleDelete = async (id: number | string) => {
    const expense = expenses.find((ex) => String(ex.id) === String(id));
    const confirmed = await confirm({
      title: "Delete Expense",
      message: `Are you sure you want to delete ${expense ? `"${expense.title}"` : "this expense"}?`,
      confirmText: "Delete",
      cancelText: "Cancel",
      variant: "danger"
    });

    if (confirmed) {
      await api.deleteExpense(id);
      toast.success("Expense Deleted", "The record was removed.");
      loadExpenses();
    }
  };


  const filtered = expenses.filter(
    (e) => categoryFilter === "All" || e.category === categoryFilter
  );

  const totalExpenseAmount = expenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

  return (
    <div className="flex h-screen bg-[#F8FAFC] dark:bg-[#0b0f19] text-slate-900 dark:text-slate-100 font-sans overflow-hidden select-none">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Header />

        <main className="flex-1 overflow-y-auto p-6 lg:p-8 space-y-6 custom-scrollbar bg-[#F8FAFC] dark:bg-[#0b0f19]">
          {/* Controls Row */}
          <div className="flex items-center justify-end gap-3">
            <CustomDropdown
              value={categoryFilter}
              onChange={(val) => setCategoryFilter(String(val))}
              size="sm"
              variant="input"
              className="w-44 text-xs font-semibold"
              options={[
                { value: "All", label: "All Categories" },
                { value: "Marketing", label: "Marketing" },
                { value: "Software", label: "Software" },
                { value: "Office", label: "Office" },
                { value: "Travel", label: "Travel" },
                { value: "Salaries", label: "Salaries" },
                { value: "Other", label: "Other" },
              ]}
            />

            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-1.5 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-semibold shadow-sm transition-all"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Expense</span>
            </button>
          </div>

          {/* Quick Metrics (Zero-Default) */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="p-4 rounded-xl bg-white border border-slate-200 border-t-[3px] border-t-rose-500 shadow-xs flex items-center justify-between">
              <div>
                <p className="text-[11px] font-bold text-slate-400 uppercase">Total Expenses</p>
                <p className="text-2xl font-bold text-slate-900 mt-1">{formatCurrency(totalExpenseAmount)}</p>
              </div>
              <div className="p-2 rounded-full bg-rose-50 text-rose-600">
                <Receipt className="w-4 h-4" />
              </div>
            </div>

            <div className="p-4 rounded-xl bg-white border border-slate-200 border-t-[3px] border-t-red-600 shadow-xs flex items-center justify-between">
              <div>
                <p className="text-[11px] font-bold text-slate-400 uppercase">Total Records</p>
                <p className="text-2xl font-bold text-slate-900 mt-1">{expenses.length}</p>
              </div>
              <div className="p-2 rounded-full bg-red-50 text-red-600">
                <Calendar className="w-4 h-4" />
              </div>
            </div>

            <div className="p-4 rounded-xl bg-white border border-slate-200 border-t-[3px] border-t-emerald-500 shadow-xs flex items-center justify-between">
              <div>
                <p className="text-[11px] font-bold text-slate-400 uppercase">Paid Expenses</p>
                <p className="text-2xl font-bold text-emerald-600 mt-1">
                  {expenses.filter(e => e.status === "Paid").length}
                </p>
              </div>
              <div className="p-2 rounded-full bg-emerald-50 text-emerald-600">
                <CheckCircle2 className="w-4 h-4" />
              </div>
            </div>
          </div>

          {/* Expenses List or Zero State */}
          {expenses.length === 0 ? (
            <div className="p-12 rounded-2xl bg-white border border-slate-200 shadow-xs text-center space-y-3">
              <div className="w-12 h-12 rounded-full bg-red-50 text-red-600 flex items-center justify-center mx-auto">
                <Receipt className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-800">No expenses recorded</h3>
                <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                  Start from zero. Record team software, marketing ads, or business expenses.
                </p>
              </div>
              <button
                onClick={() => setShowAddModal(true)}
                className="px-4 py-2 bg-red-600 text-white text-xs font-bold rounded-xl"
              >
                Record First Expense
              </button>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-100 text-slate-400 font-bold uppercase text-[11px] bg-slate-50/50">
                    <th className="py-3 px-4">Title / Description</th>
                    <th className="py-3 px-4">Category</th>
                    <th className="py-3 px-4">Date</th>
                    <th className="py-3 px-4">Payment Method</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Amount</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map((exp) => (
                    <tr key={exp.id} className="hover:bg-slate-50 transition-colors">
                      <td className="py-3 px-4 font-semibold text-slate-900">{exp.title}</td>
                      <td className="py-3 px-4">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-50 text-red-600 border border-red-100">
                          {exp.category}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-slate-600">{exp.date}</td>
                      <td className="py-3 px-4 text-slate-600">{exp.payment_method}</td>
                      <td className="py-3 px-4">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            exp.status === "Paid"
                              ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                              : "bg-amber-50 text-amber-700 border border-amber-200"
                          }`}
                        >
                          {exp.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-bold text-slate-900">{formatCurrency(exp.amount)}</td>
                      <td className="py-3 px-4 text-right">
                        <button
                          onClick={() => handleDelete(exp.id)}
                          className="p-1 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </main>
      </div>

      {/* Add Expense Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-4 border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-slate-900 text-base">Record Business Expense</h3>
              <button onClick={() => setShowAddModal(false)} className="p-1 rounded text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreate} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Expense Title *</label>
                <input
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. AWS Cloud Hosting / Google Ads"
                  className="w-full bg-slate-50 text-slate-900 text-xs px-3.5 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Category</label>
                  <CustomDropdown
                    value={category}
                    onChange={(val) => setCategory(val as any)}
                    options={["Software", "Marketing", "Office", "Travel", "Salaries", "Other"]}
                    variant="input"
                    className="w-full text-xs font-medium"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Amount (₹) *</label>
                  <input
                    type="number"
                    required
                    value={amount}
                    onChange={(e) => setAmount(Number(e.target.value))}
                    className="w-full bg-slate-50 text-slate-900 text-xs px-3.5 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-red-500 font-bold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Payment Date</label>
                  <CustomDatePicker
                    value={date}
                    onChange={(d) => setDate(d)}
                    placeholder="Select payment date"
                    className="w-full text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Payment Method</label>
                  <CustomDropdown
                    value={paymentMethod}
                    onChange={(val) => setPaymentMethod(val as any)}
                    options={[
                      { value: "Card", label: "Corporate Card" },
                      { value: "UPI", label: "UPI" },
                      { value: "Bank Transfer", label: "Bank Transfer (NEFT/RTGS)" },
                      { value: "Cash", label: "Cash" },
                    ]}
                    variant="input"
                    className="w-full text-xs font-medium"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Status</label>
                <CustomDropdown
                  value={status}
                  onChange={(val) => setStatus(val as any)}
                  options={[
                    { value: "Paid", label: "Paid", dotColor: "bg-emerald-500" },
                    { value: "Pending", label: "Pending Approval", dotColor: "bg-amber-500" },
                  ]}
                  variant="input"
                  className="w-full text-xs font-medium"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-500 hover:text-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-red-600 text-white text-xs font-bold rounded-xl shadow hover:bg-red-700"
                >
                  Save Expense
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
