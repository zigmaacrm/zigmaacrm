"use client";

import React, { useState, useEffect } from "react";
import {
  X,
  MessageSquare,
  Search,
  Phone,
  User,
  Send,
  Loader2,
  Sparkles,
  Building2,
  Check
} from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/components/common/ToastProvider";

interface NewWhatsAppChatModalProps {
  isOpen: boolean;
  onClose: () => void;
  onChatInitiated: (phone: string, name?: string, initialMsg?: string) => void;
}

export default function NewWhatsAppChatModal({
  isOpen,
  onClose,
  onChatInitiated
}: NewWhatsAppChatModalProps) {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<"direct" | "contacts">("direct");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [message, setMessage] = useState("");
  const [isSending, setIsSending] = useState(false);

  // CRM Contacts list for Tab 2
  const [contacts, setContacts] = useState<any[]>([]);
  const [contactSearch, setContactSearch] = useState("");
  const [isLoadingContacts, setIsLoadingContacts] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setPhoneNumber("");
      setRecipientName("");
      setMessage("");
      setContactSearch("");

      // Fetch contacts that have phone numbers
      setIsLoadingContacts(true);
      Promise.all([
        api.getContacts().catch(() => []),
        api.getLeads().catch(() => [])
      ]).then(([cList, lList]) => {
        const combined: any[] = [];
        const seenPhones = new Set<string>();

        if (Array.isArray(cList)) {
          cList.forEach((c: any) => {
            const rawPhone = (c.phone || "").replace(/[^0-9]/g, "");
            if (rawPhone && !seenPhones.has(rawPhone)) {
              seenPhones.add(rawPhone);
              combined.push({
                id: c.id,
                name: c.full_name || c.name || "Unnamed Contact",
                phone: c.phone,
                cleanPhone: rawPhone,
                company: c.company_name || "Contact",
                type: "Contact"
              });
            }
          });
        }

        if (Array.isArray(lList)) {
          lList.forEach((l: any) => {
            const rawPhone = (l.phone || "").replace(/[^0-9]/g, "");
            if (rawPhone && !seenPhones.has(rawPhone)) {
              seenPhones.add(rawPhone);
              combined.push({
                id: l.id,
                name: `${l.first_name || ""} ${l.last_name || ""}`.trim() || "Unnamed Lead",
                phone: l.phone,
                cleanPhone: rawPhone,
                company: l.company || "Lead",
                type: "Lead"
              });
            }
          });
        }

        setContacts(combined);
      }).finally(() => {
        setIsLoadingContacts(false);
      });
    }
  }, [isOpen]);

  const filteredContacts = contacts.filter((c) => {
    if (!contactSearch.trim()) return true;
    const q = contactSearch.toLowerCase();
    return (
      c.name.toLowerCase().includes(q) ||
      c.phone.toLowerCase().includes(q) ||
      (c.company && c.company.toLowerCase().includes(q))
    );
  });

  const handleSelectContact = (c: any) => {
    setPhoneNumber(c.phone);
    setRecipientName(c.name);
    setActiveTab("direct");
  };

  const handleStartChat = async () => {
    const rawDigits = phoneNumber.replace(/[^0-9]/g, "");
    if (!rawDigits || rawDigits.length < 8) {
      toast.warning("Invalid Phone", "Please enter a valid phone number with country code.");
      return;
    }

    // Auto-prefix 91 for Indian numbers if only 10 digits entered
    const cleanPhone = rawDigits.length === 10 ? `91${rawDigits}` : rawDigits;

    setIsSending(true);
    try {
      if (message.trim()) {
        await api.sendWhatsAppMessage({
          phone_number: cleanPhone,
          message: message.trim()
        });
        toast.success("Message Dispatched", `Sent WhatsApp message to +${cleanPhone}`);
      }
      onChatInitiated(cleanPhone, recipientName.trim(), message.trim());
      onClose();
    } catch (err: any) {
      console.error("Failed to start WhatsApp chat:", err);
      toast.error("Send Failed", err.message || "Could not deliver message via WhatsApp.");
    } finally {
      setIsSending(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden border border-slate-200 dark:border-slate-800 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold">
              <MessageSquare className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                Start New WhatsApp Chat
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Message any phone number directly from Zigmaa CRM
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="px-6 pt-3 pb-1 border-b border-slate-100 dark:border-slate-800 flex gap-2">
          <button
            onClick={() => setActiveTab("direct")}
            className={`pb-2.5 px-3 text-xs font-semibold border-b-2 transition-all cursor-pointer ${
              activeTab === "direct"
                ? "border-emerald-600 text-emerald-600 dark:text-emerald-400"
                : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-300"
            }`}
          >
            Enter Phone Number
          </button>
          <button
            onClick={() => setActiveTab("contacts")}
            className={`pb-2.5 px-3 text-xs font-semibold border-b-2 transition-all cursor-pointer flex items-center gap-1.5 ${
              activeTab === "contacts"
                ? "border-emerald-600 text-emerald-600 dark:text-emerald-400"
                : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-300"
            }`}
          >
            <span>Pick from CRM Contacts</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
              {contacts.length}
            </span>
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-4 flex-1 custom-scrollbar">
          {activeTab === "direct" ? (
            <>
              {/* Phone Input */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center justify-between">
                  <span>Phone Number *</span>
                  <span className="text-[10px] text-slate-400 font-normal">Include country code (e.g. +91)</span>
                </label>
                <div className="relative">
                  <Phone className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="tel"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    placeholder="+91 96004 71080"
                    className="w-full h-10 pl-9 pr-3 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all font-mono"
                    autoFocus
                  />
                </div>
              </div>

              {/* Recipient Name */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Recipient Name (Optional)
                </label>
                <div className="relative">
                  <User className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={recipientName}
                    onChange={(e) => setRecipientName(e.target.value)}
                    placeholder="e.g. Madhavan Retg"
                    className="w-full h-10 pl-9 pr-3 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
                  />
                </div>
              </div>

              {/* Message Body */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center justify-between">
                  <span>First Message (Optional)</span>
                  <span className="text-[10px] text-slate-400 font-normal">Press send to dispatch immediately</span>
                </label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Hello! Reaching out regarding your enquiry with Zigmaa CRM..."
                  rows={3}
                  className="w-full p-3 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all resize-none"
                />

                {/* Quick message chips */}
                <div className="flex flex-wrap gap-1.5 pt-1">
                  <button
                    type="button"
                    onClick={() => setMessage("Hello! Thank you for reaching out to Zigmaa CRM. How can we help you today?")}
                    className="text-[10px] px-2 py-1 rounded-lg bg-slate-100 hover:bg-emerald-50 text-slate-600 hover:text-emerald-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 transition-colors"
                  >
                    👋 Welcome Greeting
                  </button>
                  <button
                    type="button"
                    onClick={() => setMessage("Hi! Following up regarding our product demonstration. Are you available for a quick 10-minute call?")}
                    className="text-[10px] px-2 py-1 rounded-lg bg-slate-100 hover:bg-emerald-50 text-slate-600 hover:text-emerald-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 transition-colors"
                  >
                    📞 Follow-up Call
                  </button>
                </div>
              </div>
            </>
          ) : (
            /* Contacts Search List */
            <div className="space-y-3">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={contactSearch}
                  onChange={(e) => setContactSearch(e.target.value)}
                  placeholder="Search by name, phone, or company..."
                  className="w-full h-9 pl-9 pr-3 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
                  autoFocus
                />
              </div>

              {isLoadingContacts ? (
                <div className="py-8 text-center text-slate-400 text-xs flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-emerald-500" />
                  <span>Loading contacts...</span>
                </div>
              ) : filteredContacts.length === 0 ? (
                <div className="py-8 text-center text-slate-400 text-xs">
                  No contacts found matching &quot;{contactSearch}&quot;
                </div>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-64 overflow-y-auto custom-scrollbar border border-slate-100 dark:border-slate-800 rounded-xl">
                  {filteredContacts.map((c) => (
                    <div
                      key={`${c.type}_${c.id}`}
                      onClick={() => handleSelectContact(c)}
                      className="p-2.5 hover:bg-emerald-50/50 dark:hover:bg-emerald-950/20 cursor-pointer flex items-center justify-between transition-colors group"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 font-bold text-xs flex items-center justify-center shrink-0">
                          {c.name.slice(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate group-hover:text-emerald-600 transition-colors">
                            {c.name}
                          </p>
                          <p className="text-[11px] text-slate-400 truncate">
                            {c.phone} • {c.company}
                          </p>
                        </div>
                      </div>
                      <span className="text-[10px] font-semibold text-emerald-600 opacity-0 group-hover:opacity-100 transition-opacity">
                        Select &rarr;
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 bg-slate-50 dark:bg-slate-800/40 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white rounded-xl transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleStartChat}
            disabled={isSending || !phoneNumber.trim()}
            className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl shadow-xs transition-all flex items-center gap-1.5 cursor-pointer disabled:cursor-not-allowed hover:scale-[1.02] active:scale-[0.98]"
          >
            {isSending ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Sending...</span>
              </>
            ) : (
              <>
                <Send className="w-3.5 h-3.5" />
                <span>{message.trim() ? "Send & Start Chat" : "Open Chat Thread"}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
