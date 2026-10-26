"use client";

import { useState } from "react";
import {
  FileCode,
  Plus,
  MessageSquare,
  Mail,
  Copy,
  Check,
  Trash2,
  X,
  Sparkles
} from "lucide-react";
import Sidebar from "@/components/layout/Sidebar";
import Header from "@/components/layout/Header";

interface TemplateItem {
  id: number;
  title: string;
  type: "WhatsApp" | "Email";
  content: string;
  category: "Follow-up" | "Welcome" | "Demo Invite" | "Invoice";
}

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<TemplateItem[]>([
    {
      id: 1,
      title: "Immediate Lead Greeting (WhatsApp)",
      type: "WhatsApp",
      category: "Welcome",
      content: "Hello {{name}}, thank you for reaching out to us regarding our services. When would be a good time for a quick 10-minute discovery call?"
    },
    {
      id: 2,
      title: "Google Calendar Demo Invite (Email)",
      type: "Email",
      category: "Demo Invite",
      content: "Hi {{name}},\n\nI'm excited to showcase our CRM solution. Please find the scheduled Google Calendar invite attached or click our meeting link below.\n\nBest regards,\nAlexander Vance"
    },
    {
      id: 3,
      title: "Post-Consultation Follow-up",
      type: "WhatsApp",
      category: "Follow-up",
      content: "Hi {{name}}, great speaking with you today! I've sent the commercial proposal over to {{email}}. Let me know if you have any questions."
    }
  ]);

  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [title, setTitle] = useState("");
  const [type, setType] = useState<"WhatsApp" | "Email">("WhatsApp");
  const [category, setCategory] = useState<"Follow-up" | "Welcome" | "Demo Invite" | "Invoice">("Follow-up");
  const [content, setContent] = useState("");

  const handleCopy = (id: number, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !content) return;
    const newT: TemplateItem = {
      id: Date.now(),
      title,
      type,
      category,
      content
    };
    setTemplates([newT, ...templates]);
    setTitle("");
    setContent("");
    setShowAddModal(false);
  };

  const handleDelete = (id: number) => {
    setTemplates(templates.filter(t => t.id !== id));
  };

  return (
    <div className="flex h-screen bg-[#F8FAFC] text-slate-900 font-sans overflow-hidden select-none">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Header />

        <main className="flex-1 overflow-y-auto p-6 lg:p-8 space-y-6 custom-scrollbar">
          {/* Action Row */}
          <div className="flex items-center justify-end">
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-1.5 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-semibold shadow-sm transition-all"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Create Template</span>
            </button>
          </div>

          {/* Templates Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {templates.map((tpl) => (
              <div
                key={tpl.id}
                className="p-5 rounded-2xl bg-white border border-slate-200 shadow-xs hover:border-red-200 transition-all flex flex-col justify-between space-y-3"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <div className={`p-1.5 rounded-lg ${tpl.type === "WhatsApp" ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-600"}`}>
                      {tpl.type === "WhatsApp" ? <MessageSquare className="w-4 h-4" /> : <Mail className="w-4 h-4" />}
                    </div>
                    <div>
                      <span className="text-[10px] font-bold text-slate-400 uppercase">{tpl.category}</span>
                      <h3 className="text-xs font-bold text-slate-900">{tpl.title}</h3>
                    </div>
                  </div>
                  <button
                    onClick={() => handleDelete(tpl.id)}
                    className="p-1 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 text-xs text-slate-700 whitespace-pre-wrap font-sans">
                  {tpl.content}
                </div>

                <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                  <span className="text-[11px] text-slate-400 font-medium">Click to copy template:</span>
                  <button
                    onClick={() => handleCopy(tpl.id, tpl.content)}
                    className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors"
                  >
                    {copiedId === tpl.id ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                        <span className="text-emerald-700 font-bold">Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </main>
      </div>

      {/* Add Template Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-4 border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-slate-900 text-base">Create Message Template</h3>
              <button onClick={() => setShowAddModal(false)} className="p-1 rounded text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreate} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Template Name *</label>
                <input
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Follow-up after Demo"
                  className="w-full bg-slate-50 text-slate-900 text-xs px-3.5 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Channel</label>
                  <select
                    value={type}
                    onChange={(e) => setType(e.target.value as any)}
                    className="w-full bg-slate-50 text-slate-900 text-xs px-3.5 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-red-500"
                  >
                    <option value="WhatsApp">WhatsApp</option>
                    <option value="Email">Email</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Category</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as any)}
                    className="w-full bg-slate-50 text-slate-900 text-xs px-3.5 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-red-500"
                  >
                    <option value="Follow-up">Follow-up</option>
                    <option value="Welcome">Welcome</option>
                    <option value="Demo Invite">Demo Invite</option>
                    <option value="Invoice">Invoice</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Message Content *</label>
                <textarea
                  rows={4}
                  required
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="Write your template text. You can use {{name}}, {{company}} placeholders..."
                  className="w-full bg-slate-50 text-slate-900 text-xs p-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-red-500"
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
                  Save Template
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
