"use client";

import React, { useState, useEffect } from "react";
import {
  X,
  Mail,
  Send,
  Loader2,
  Bold,
  Italic,
  List,
  Sparkles,
  Paperclip,
  AlertTriangle,
  Link as LinkIcon,
  ShieldCheck
} from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/components/common/ToastProvider";
import ConnectEmailModal from "@/components/settings/ConnectEmailModal";

interface SendEmailModalProps {
  isOpen: boolean;
  onClose: () => void;
  contact: {
    id: string | number;
    name: string;
    email?: string | null;
  };
  onSent?: (activity?: any) => void;
}

export default function SendEmailModal({
  isOpen,
  onClose,
  contact,
  onSent
}: SendEmailModalProps) {
  const { toast } = useToast();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  // Email sync connection check
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [senderEmail, setSenderEmail] = useState<string>("");
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [loadingStatus, setLoadingStatus] = useState<boolean>(true);
  const [connectingGoogle, setConnectingGoogle] = useState<boolean>(false);
  const [showConnectModal, setShowConnectModal] = useState(false);

  const checkSyncStatus = async () => {
    setLoadingStatus(true);
    try {
      // 1. Check local cached user first for immediate hydration
      const cached = api.getCurrentUser();
      if (cached) {
        setCurrentUser(cached);
        if (cached.is_google_connected && cached.google_email) {
          setSenderEmail(cached.google_email);
          setIsConnected(true);
        } else if (cached.email) {
          setSenderEmail(cached.email);
        }
      }

      // 2. Fetch live Google OAuth status, backend user, and sync state in parallel
      const [googleStatus, userProfile, emailSync] = await Promise.all([
        api.getGoogleStatus().catch(() => null),
        api.getMe().catch(() => null),
        api.getEmailSync().catch(() => null)
      ]);

      const activeUser = userProfile || cached;
      if (activeUser) setCurrentUser(activeUser);

      // Verify connection strictly against CURRENT USER's credentials, NOT contact's email
      if (googleStatus && googleStatus.connected && googleStatus.email) {
        setIsConnected(true);
        setSenderEmail(googleStatus.email);
      } else if (activeUser?.is_google_connected && activeUser?.google_email) {
        setIsConnected(true);
        setSenderEmail(activeUser.google_email);
      } else if (emailSync && emailSync.is_connected && emailSync.email) {
        setIsConnected(true);
        setSenderEmail(emailSync.email);
      } else {
        setIsConnected(false);
        setSenderEmail(activeUser?.email || "your account");
      }
    } catch (err) {
      console.error("Failed to check email sync status:", err);
    } finally {
      setLoadingStatus(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      checkSyncStatus();
    }
  }, [isOpen]);

  const handleConnectGoogle = async () => {
    setConnectingGoogle(true);
    try {
      const data = await api.getGoogleAuthUrl();
      if (data?.url) {
        window.location.href = data.url;
      } else {
        setShowConnectModal(true);
      }
    } catch {
      setShowConnectModal(true);
    } finally {
      setConnectingGoogle(false);
    }
  };

  if (!isOpen) return null;

  const handleInsertTemplate = (type: "intro" | "followup") => {
    if (type === "intro") {
      setSubject(`Introduction: Zigmaa CRM Solutions for ${contact.name}`);
      setBody(
        `Hi ${contact.name},\n\nIt was great connecting with you. I wanted to follow up and introduce our enterprise CRM capabilities tailored for your team's workflow.\n\nWould you be open for a brief 10-minute demo this week?\n\nBest regards,\nMohamed Thoufiq\nZigmaa CRM Team`
      );
    } else if (type === "followup") {
      setSubject(`Following up on our conversation - ${contact.name}`);
      setBody(
        `Hi ${contact.name},\n\nI hope you are having a productive week. Checking in to see if you have any questions regarding the proposal we discussed.\n\nLooking forward to hearing your thoughts.\n\nWarm regards,\nMohamed Thoufiq`
      );
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!contact.email) {
      toast.error("Missing Email", "This contact does not have a registered email address.");
      return;
    }

    if (!subject.trim()) {
      toast.warning("Validation", "Please enter an email subject line.");
      return;
    }

    if (!body.trim()) {
      toast.warning("Validation", "Please compose an email body before sending.");
      return;
    }

    setSending(true);
    try {
      const res = await api.sendContactEmail(contact.id, {
        subject: subject.trim(),
        body: body.trim()
      });

      toast.success("Email Sent", `Successfully delivered to ${contact.email}`);
      setSubject("");
      setBody("");
      onClose();
      if (onSent) onSent(res?.activity);
    } catch (err: any) {
      toast.error("Failed to Send", err.message || "Could not dispatch email via SMTP server.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-60 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl shadow-2xl max-w-xl w-full border border-slate-200 overflow-hidden flex flex-col animate-in zoom-in-95 duration-150 text-slate-800">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-red-100 text-red-600 flex items-center justify-center shrink-0">
              <Mail className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-sm">Send Email</h3>
              <p className="text-[11px] text-slate-500">In-app direct composer</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSend} className="p-6 space-y-4">
          
          {/* Zigmaa Email Disconnected Warning Banner - Validates Current User's Connected Gmail, NOT contact */}
          {!isConnected && !loadingStatus && (
            <div className="p-4 rounded-xl bg-amber-50/90 border border-amber-200/90 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-amber-900">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <p className="leading-relaxed">
                    <span className="font-bold underline">{senderEmail || currentUser?.email || "Your account"}</span> isn&apos;t connected to Google / Gmail in Zigmaa.
                  </p>
                  <p className="text-[11px] text-amber-700 mt-0.5">
                    Connect your Gmail in Settings before you can use it to send emails to contacts from your CRM.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0 self-start sm:self-auto">
                <button
                  type="button"
                  onClick={handleConnectGoogle}
                  disabled={connectingGoogle}
                  className="px-3.5 py-1.5 bg-[#e11d48] hover:bg-[#be123c] active:bg-[#9f1239] text-white rounded-lg text-xs font-bold shadow-2xs transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24">
                    <path fill="#ffffff" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                    <path fill="#ffffff" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                    <path fill="#ffffff" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                    <path fill="#ffffff" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
                  </svg>
                  <span>{connectingGoogle ? "Connecting..." : "Connect Gmail"}</span>
                </button>
              </div>
            </div>
          )}

          {/* Sender Strip (From: Current User's Connected Google Email) */}
          <div className="flex items-center gap-3 text-xs bg-slate-50 px-3.5 py-2.5 rounded-xl border border-slate-200/80">
            <span className="font-bold text-slate-400 w-12 shrink-0">From:</span>
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <span className="font-bold text-slate-800 truncate">
                {currentUser?.full_name || "Current User"}
              </span>
              <span className="text-slate-400">&lt;</span>
              <span className={`font-medium truncate ${isConnected ? "text-slate-700" : "text-amber-700"}`}>
                {senderEmail || currentUser?.email || "No account connected"}
              </span>
              <span className="text-slate-400">&gt;</span>

              {isConnected ? (
                <span className="ml-auto px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span>Gmail Synced</span>
                </span>
              ) : (
                <span className="ml-auto px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200 shrink-0 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                  <span>Not Synced</span>
                </span>
              )}
            </div>
          </div>

          {/* Recipient Strip (To: Target Contact) */}
          <div className="flex items-center gap-3 text-xs bg-slate-50 px-3.5 py-2.5 rounded-xl border border-slate-200/80">
            <span className="font-bold text-slate-400 w-12 shrink-0">To:</span>
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-bold text-slate-800 truncate">{contact.name}</span>
              <span className="text-slate-400">&lt;</span>
              <span className="text-red-600 font-medium truncate">
                {contact.email || "No email available"}
              </span>
              <span className="text-slate-400">&gt;</span>
            </div>
          </div>

          {/* Subject Field */}
          <div className="space-y-1">
            <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Subject
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Following up on demo call / Proposal summary"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full bg-white border border-slate-200 rounded-xl px-3.5 py-2 text-xs font-medium text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500 shadow-2xs"
            />
          </div>

          {/* Quick AI / Template Chips */}
          <div className="flex items-center gap-2 pt-1 flex-wrap">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-red-500" />
              <span>Quick Templates:</span>
            </span>
            <button
              type="button"
              onClick={() => handleInsertTemplate("intro")}
              className="px-2.5 py-1 bg-red-50 hover:bg-red-100 text-red-700 rounded-lg text-[11px] font-semibold border border-red-200/60 transition-colors cursor-pointer"
            >
              Intro & Demo
            </button>
            <button
              type="button"
              onClick={() => handleInsertTemplate("followup")}
              className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-[11px] font-semibold border border-slate-200 transition-colors cursor-pointer"
            >
              Follow-up
            </button>
          </div>

          {/* Email Body & Toolbar */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Message Body
              </label>
              <div className="flex items-center gap-1 text-slate-400 text-xs">
                <span className="text-[10px] font-mono">{body.length} chars</span>
              </div>
            </div>

            <div className="border border-slate-200 rounded-xl overflow-hidden focus-within:ring-2 focus-within:ring-red-500 focus-within:border-transparent transition-all shadow-2xs">
              {/* Minimal Formatting Toolbar */}
              <div className="flex items-center gap-1 px-3 py-1.5 bg-slate-50 border-b border-slate-200 text-slate-500">
                <button
                  type="button"
                  onClick={() => setBody((prev) => prev + " **bold** ")}
                  className="p-1 hover:bg-slate-200 rounded text-slate-600 transition-colors cursor-pointer"
                  title="Bold"
                >
                  <Bold className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  onClick={() => setBody((prev) => prev + " *italic* ")}
                  className="p-1 hover:bg-slate-200 rounded text-slate-600 transition-colors cursor-pointer"
                  title="Italic"
                >
                  <Italic className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  onClick={() => setBody((prev) => prev + "\n- Item 1\n- Item 2")}
                  className="p-1 hover:bg-slate-200 rounded text-slate-600 transition-colors cursor-pointer"
                  title="List"
                >
                  <List className="w-3 h-3" />
                </button>
              </div>

              <textarea
                required
                rows={6}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Write your email here..."
                className="w-full p-3.5 text-xs text-slate-800 placeholder-slate-400 focus:outline-none resize-none bg-white font-sans leading-relaxed"
              />
            </div>
          </div>

          {/* Footer Controls */}
          <div className="pt-2 flex items-center justify-between border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
            >
              Discard
            </button>

            <button
              type="submit"
              disabled={sending || !contact.email || !isConnected}
              title={!isConnected ? "Please connect your Google account in Settings to send emails" : ""}
              className="px-5 py-2 bg-red-600 hover:bg-red-700 active:bg-red-800 text-white rounded-xl text-xs font-bold transition-all shadow-xs shadow-red-600/20 cursor-pointer flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {sending ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Sending...</span>
                </>
              ) : (
                <>
                  <Send className="w-3.5 h-3.5" />
                  <span>Send Email</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* Connect Email Modal invoked from warning banner */}
      <ConnectEmailModal
        isOpen={showConnectModal}
        onClose={() => setShowConnectModal(false)}
        defaultEmail={senderEmail || currentUser?.email || ""}
        onConnected={(data) => {
          setIsConnected(true);
          setSenderEmail(data.email || currentUser?.email || "");
          setShowConnectModal(false);
          toast.success("Ready to Send", `Connected ${data.email || "account"}. You can now send emails.`);
        }}
      />
    </div>
  );
}
