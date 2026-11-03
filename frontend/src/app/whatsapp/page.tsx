"use client";

import React, { useState, useRef, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import {
  MessageSquare,
  Search,
  Phone,
  Video,
  Send,
  Paperclip,
  Check,
  CheckCheck,
  Plus,
  FileText,
  Calendar,
  Handshake,
  User,
  Building2,
  Mail,
  MoreVertical,
  Smile,
  ShieldCheck,
  Sparkles,
  ChevronDown,
  Clock,
  ArrowRight,
  ExternalLink,
  Download,
  File,
  X,
  PanelRightClose,
  PanelRightOpen,
  CheckCircle2,
  Tag,
  Zap,
  RefreshCw,
  Loader2,
  Edit2,
  QrCode,
  Mic,
  MicOff,
  Play,
  Pause,
  Trash2,
  ImageIcon,
  Volume2
} from "lucide-react";
import Sidebar from "@/components/layout/Sidebar";
import Header from "@/components/layout/Header";
import WhatsAppIcon from "@/components/common/WhatsAppIcon";
import type { Invoice } from "@/types";
import WhatsAppQRModal from "@/components/whatsapp/WhatsAppQRModal";
import NewWhatsAppChatModal from "@/components/whatsapp/NewWhatsAppChatModal";
import { useToast } from "@/components/common/ToastProvider";
import { useTheme } from "@/context/ThemeContext";
import { formatCurrency, cn } from "@/lib/utils";
import { api } from "@/lib/api";

export interface WhatsAppMessage {
  id: string;
  sender: "inbound" | "outbound";
  text: string;
  timestamp: string;
  timeLabel: string;
  dateGroup: "Today" | "Yesterday" | "Earlier";
  status?: "SENT" | "DELIVERED" | "READ" | "FAILED" | "PENDING";
  messageType?: string;
  mediaUrl?: string | null;
  fileName?: string | null;
  caption?: string | null;
  isVoiceNote?: boolean;
  attachment?: {
    type: "pdf" | "image" | "audio" | "document" | "video" | "sticker";
    name: string;
    size?: string;
    url?: string;
  };
}

function cleanDisplayCaption(text?: string | null, fileName?: string | null): string {
  if (!text) return "";
  const t = text.trim();
  const lower = t.toLowerCase();
  const dummyPlaceholders = [
    "[image attachment]",
    "[voice note]",
    "[document attachment]",
    "[sticker]",
    "[contact card]",
    "[location]",
    "[attachment received]",
    "📷 photo",
    "🎥 video",
    "🎤 voice message",
    "🎵 audio",
    "document",
    "image attachment",
    "voice note",
    "sticker"
  ];
  if (dummyPlaceholders.includes(lower)) return "";
  if (lower.startsWith("📎 ") && lower.includes("attachment")) return "";
  if (fileName && (t === fileName.trim() || t === `📎 ${fileName.trim()}`)) return "";
  if (/^🎤\s*Voice message/i.test(t)) return "";
  if (/^📷\s*Photo/i.test(t)) return "";
  if (/^🎥\s*Video/i.test(t)) return "";
  if (/^📄\s*.+$/i.test(t) && fileName && t.includes(fileName)) return "";
  return t;
}

function VoiceNotePlayer({ audioUrl, isOutbound, isDark }: { audioUrl: string; isOutbound: boolean; isDark: boolean }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
    }
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration || 0);
    }
  };

  const handleEnded = () => {
    setIsPlaying(false);
    setCurrentTime(0);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    if (audioRef.current) {
      audioRef.current.currentTime = val;
      setCurrentTime(val);
    }
  };

  const formatSecs = (sec: number) => {
    if (isNaN(sec) || !isFinite(sec)) return "0:00";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  };

  return (
    <div className={cn(
      "flex items-center gap-3 p-2.5 rounded-xl mt-1.5 w-60 sm:w-72 transition-all border",
      isDark ? "bg-black/40 border-white/10" : (isOutbound ? "bg-white/70 border-emerald-200" : "bg-slate-50 border-slate-200")
    )}>
      <audio
        ref={audioRef}
        src={audioUrl}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={handleEnded}
        preload="metadata"
      />
      <button
        type="button"
        onClick={togglePlay}
        className={cn(
          "w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition-transform active:scale-95 shadow-sm text-white",
          isOutbound ? "bg-emerald-600 hover:bg-emerald-500" : "bg-emerald-600 hover:bg-emerald-500"
        )}
      >
        {isPlaying ? <Pause className="w-4 h-4 fill-white" /> : <Play className="w-4 h-4 fill-white ml-0.5" />}
      </button>

      <div className="flex-1 min-w-0">
        <input
          type="range"
          min={0}
          max={duration || 100}
          value={currentTime}
          onChange={handleSeek}
          className="w-full h-1.5 bg-slate-300 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-emerald-500"
        />
        <div className="flex justify-between text-[10px] text-slate-500 dark:text-slate-400 mt-1 font-mono">
          <span>{formatSecs(currentTime)}</span>
          <span>{duration > 0 ? formatSecs(duration) : "0:00"}</span>
        </div>
      </div>

      <div className="shrink-0 text-emerald-500">
        <Mic className="w-4 h-4" />
      </div>
    </div>
  );
}

export interface WhatsAppConversation {
  id: string;
  contact_id?: string;
  contactName: string;
  companyName: string;
  phone: string;
  email: string;
  avatar_url?: string | null;
  avatarInitials: string;
  avatarColor: string;
  assignedRep: {
    id?: string;
    name: string;
    avatar: string;
    role: string;
  };
  businessPhoneNumberId?: string;
  dealStage: string;
  dealValue: number;
  dealCloseDate: string;
  unreadCount: number;
  isAssignedToMe: boolean;
  notes: Array<{
    id: string;
    text: string;
    author: string;
    timestamp: string;
  }>;
  lastMessage?: string;
  lastMessageTime?: string;
}

const META_TEMPLATES = [
  {
    id: "welcome_greeting",
    name: "Welcome Greeting",
    tag: "Utility",
    content: "Hello {{name}}, thank you for reaching out to Zigmaa CRM! How can we assist your business today?"
  },
  {
    id: "gst_quote_link",
    name: "Quotation PDF Link",
    tag: "Marketing",
    content: "Hi {{name}}, please find your official quotation from our team. Please review the itemized proposal and let us know if you have any questions."
  },
  {
    id: "sales_followup",
    name: "Follow-up",
    tag: "Utility",
    content: "Greetings {{name}}, just checking in on your CRM deployment timeline. Would you like to schedule a 15-minute product walkthrough this week?"
  },
  {
    id: "payment_reminder",
    name: "Payment Acknowledgment",
    tag: "Authentication",
    content: "Dear {{name}}, we have received your purchase confirmation for Zigmaa Enterprise. Our onboarding team will activate your instance within 2 hours."
  }
];

const EMOJI_LIST = [
  "😊", "😂", "🤣", "❤️", "👍", "🔥", "🙏", "🎉", 
  "👏", "✨", "💯", "🎯", "💼", "🤝", "🚀", "📞", 
  "💬", "💰", "📄", "💡", "😍", "🥰", "😎", "🙌", 
  "👌", "✌️", "💪", "🌟", "⭐", "✅", "❌", "❓"
];

const AVATAR_GRADIENTS = [
  "from-blue-600 to-indigo-700",
  "from-emerald-600 to-teal-700",
  "from-amber-600 to-orange-700",
  "from-purple-600 to-pink-700",
  "from-rose-600 to-red-700",
  "from-cyan-600 to-blue-700"
];

function parseUtcDate(dateVal?: string | number): Date {
  if (!dateVal) return new Date();
  if (typeof dateVal === "number") {
    return new Date(dateVal * (dateVal < 1e11 ? 1000 : 1));
  }
  const str = String(dateVal).trim();
  if (/^\d{10,13}$/.test(str)) {
    const num = parseInt(str, 10);
    return new Date(num * (num < 1e11 ? 1000 : 1));
  }
  // Ensure UTC ISO string without explicit offset is treated as UTC so browser converts to local IST
  if (str.includes("T") && !str.endsWith("Z") && !/[+-]\d{2}:?\d{2}$/.test(str)) {
    return new Date(str + "Z");
  }
  return new Date(str);
}

function formatTime(isoStr?: string | number): string {
  if (!isoStr) return "Just now";
  try {
    const d = parseUtcDate(isoStr);
    if (isNaN(d.getTime())) return "Today";
    // Format using browser local timezone (IST)
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "Today";
  }
}

function format_display_phone(phone: string): string {
  const clean = phone.replace(/[^0-9]/g, "");
  if (!clean) return "Unknown Prospect";
  if (clean.length === 12 && clean.startsWith("91")) {
    return `+91 ${clean.slice(2, 7)} ${clean.slice(7)}`;
  } else if (clean.length === 10) {
    return `+91 ${clean.slice(0, 5)} ${clean.slice(5)}`;
  }
  return `+${clean}`;
}

function ContactAvatar({
  avatarUrl,
  name,
  initials,
  color,
  size = "w-11 h-11",
  rounded = "rounded-full",
  textClass = "text-xs"
}: {
  avatarUrl?: string | null;
  name?: string;
  initials: string;
  color?: string;
  size?: string;
  rounded?: string;
  textClass?: string;
}) {
  const [imgError, setImgError] = useState(false);

  if (avatarUrl && !imgError) {
    return (
      <img
        src={avatarUrl}
        alt={name || "Contact"}
        onError={() => setImgError(true)}
        className={cn(size, rounded, "object-cover shrink-0 shadow-xs")}
      />
    );
  }

  return (
    <div
      className={cn(
        size,
        rounded,
        "bg-gradient-to-br flex items-center justify-center font-bold text-white shrink-0 shadow-xs",
        color || "from-emerald-600 to-teal-700",
        textClass
      )}
    >
      {initials}
    </div>
  );
}

export default function WhatsAppPage() {
  const { toast } = useToast();
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const [conversations, setConversations] = useState<WhatsAppConversation[]>([]);
  const [activePhone, setActivePhone] = useState<string>("");
  const [messages, setMessages] = useState<WhatsAppMessage[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterTab, setFilterTab] = useState<"All" | "Unassigned" | "My Chats">("All");
  const [messageInput, setMessageInput] = useState("");
  const [showTemplateSelector, setShowTemplateSelector] = useState(false);
  const [showRightDrawer, setShowRightDrawer] = useState(true);
  const [showNewNoteModal, setShowNewNoteModal] = useState(false);
  const [newNoteText, setNewNoteText] = useState("");
  const [showQuotePickerModal, setShowQuotePickerModal] = useState(false);
  const [availableQuotes, setAvailableQuotes] = useState<Invoice[]>([]);
  const [loadingQuotes, setLoadingQuotes] = useState(false);

  const handleOpenQuotePicker = async () => {
    setShowQuotePickerModal(true);
    setLoadingQuotes(true);
    try {
      const quotes = await api.getInvoices();
      setAvailableQuotes(Array.isArray(quotes) ? quotes : []);
    } catch (err) {
      console.error("Failed to load quotations:", err);
    } finally {
      setLoadingQuotes(false);
    }
  };

  const handleSendSelectedQuote = (quote: Invoice) => {
    if (!activeChat) return;
    const firstName = activeChat.contactName.split(" ")[0] || "there";
    const quoteNumber = quote.invoice_number || quote.bill_number || `QT-${quote.id}`;
    const amountStr = formatCurrency(quote.total_amount || 0);
    const quoteMsg = `Hi ${firstName}, here is your quotation details:\n• Document: ${quoteNumber}\n• Subject: ${quote.subject || "Quotation"}\n• Total Amount: ${amountStr}`;
    handleSendMessage(quoteMsg);
    setShowQuotePickerModal(false);
    toast.success("Quotation Sent", `Quotation ${quoteNumber} sent to ${activeChat.contactName}`);
  };

  // Multi-Number Rep State
  // QR WhatsApp State
  const [showQRModal, setShowQRModal] = useState(false);
  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const [qrStatus, setQrStatus] = useState<"DISCONNECTED" | "SCAN_QR" | "CONNECTED">("DISCONNECTED");
  const [qrPhone, setQrPhone] = useState<string | null>(null);

  useEffect(() => {
    const fetchStatus = () => {
      api.getWhatsAppQRStatus().then((data) => {
        setQrStatus(data.status);
        setQrPhone(data.phone);
      }).catch(() => {});
    };
    fetchStatus();
    const keepAlive = setInterval(fetchStatus, 4 * 60 * 1000);
    return () => clearInterval(keepAlive);
  }, []);

  const [currentUser, setCurrentUser] = useState<any>(null);
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [selectedRepFilter, setSelectedRepFilter] = useState<string>("ALL");
  const [isReassigning, setIsReassigning] = useState(false);

  const isAdmin = useMemo(() => {
    const role = (currentUser?.role || "").toLowerCase();
    return role.includes("admin") || role.includes("owner");
  }, [currentUser]);

  const [isLoadingConversations, setIsLoadingConversations] = useState(true);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const emojiPickerRef = useRef<HTMLDivElement | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState("");
  const [isSavingName, setIsSavingName] = useState(false);

  const chatBottomRef = useRef<HTMLDivElement>(null);
  const isUserScrolledUpRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isPollingRef = useRef(false);

  // Media Lightbox & Voice Note State
  const [selectedImagePreview, setSelectedImagePreview] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      mediaRecorder.start(100);
      setIsRecording(true);
      setRecordingDuration(0);

      recordingTimerRef.current = setInterval(() => {
        setRecordingDuration((prev) => prev + 1);
      }, 1000);
    } catch (err: any) {
      toast.error("Microphone Access", "Please allow microphone access to record voice notes.");
    }
  };

  const cancelRecording = () => {
    if (mediaRecorderRef.current) {
      try {
        mediaRecorderRef.current.stop();
        mediaRecorderRef.current.stream?.getTracks().forEach((t) => t.stop());
      } catch (_) {}
    }
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    setIsRecording(false);
    setRecordingDuration(0);
    audioChunksRef.current = [];
  };

  const sendRecording = async () => {
    if (!mediaRecorderRef.current || !activeChat) return;

    const mimeType = mediaRecorderRef.current.mimeType || "audio/mp4";
    const duration = recordingDuration;

    mediaRecorderRef.current.onstop = async () => {
      mediaRecorderRef.current?.stream?.getTracks().forEach((t) => t.stop());
      const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
      audioChunksRef.current = [];

      const reader = new FileReader();
      reader.readAsDataURL(audioBlob);
      reader.onloadend = async () => {
        const base64Audio = reader.result as string;
        const cleanPhone = activeChat.phone.replace(/[^0-9]/g, "");
        const tempVoiceId = `voice-${Date.now()}`;

        const optimisticMsg: WhatsAppMessage = {
          id: tempVoiceId,
          sender: "outbound",
          text: `🎤 Voice message (${duration}s)`,
          timestamp: new Date().toISOString(),
          timeLabel: formatTime(new Date().toISOString()),
          dateGroup: "Today",
          status: "SENT",
          messageType: "ptt",
          isVoiceNote: true,
          attachment: {
            type: "audio",
            name: `voice_${duration}s.mp4`,
            url: URL.createObjectURL(audioBlob)
          }
        };
        setMessages((prev) => [...prev, optimisticMsg]);
        setIsSending(true);

        try {
          const res = await api.uploadWhatsAppVoice({
            phone_number: cleanPhone,
            audio_base64: base64Audio,
            mimetype: mimeType,
            contact_id: activeChat.contact_id,
            duration_seconds: duration
          });
          if (res && res.status === "success") {
            const savedData = res.data;
            const apiBase = process.env.NEXT_PUBLIC_API_URL?.replace("/api/v1", "") || "http://localhost:8000";
            const fullMediaUrl = savedData?.media_url
              ? (savedData.media_url.startsWith("http") ? savedData.media_url : `${apiBase}${savedData.media_url}`)
              : undefined;

            setMessages((prev) =>
              prev.map((m) =>
                m.id === tempVoiceId
                  ? {
                      ...m,
                      id: savedData?.id || m.id,
                      status: "DELIVERED",
                      mediaUrl: fullMediaUrl || m.mediaUrl,
                      attachment: {
                        ...m.attachment!,
                        url: fullMediaUrl || m.attachment!.url
                      }
                    }
                  : m
              )
            );
            loadConversations(true);
            toast.success("Voice Note Sent", `Voice note delivered to ${activeChat.contactName}`);
          } else {
            toast.error("Voice Note Failed", "Failed to deliver voice note.");
          }
        } catch (e: any) {
          toast.error("Voice Note Failed", "Failed to deliver voice note.");
        } finally {
          setIsSending(false);
        }
      };
    };

    try {
      mediaRecorderRef.current.stop();
    } catch (_) {}
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    setIsRecording(false);
  };

  const handleChatInitiated = useCallback((phone: string, name?: string, initialMsg?: string) => {
    const cleanPhone = phone.replace(/[^0-9]/g, "");
    setConversations((prev) => {
      const exists = prev.find((c) => c.phone.replace(/[^0-9]/g, "") === cleanPhone);
      if (exists) {
        if (name && (!exists.contactName || exists.contactName.includes("+"))) {
          exists.contactName = name;
        }
        if (initialMsg) {
          exists.lastMessage = initialMsg;
          exists.lastMessageTime = new Date().toISOString();
        }
        return [...prev];
      }
      const newConv: WhatsAppConversation = {
        id: `conv_${cleanPhone}`,
        contactName: name || format_display_phone(cleanPhone),
        companyName: "Direct Prospect",
        phone: cleanPhone,
        email: "",
        avatarInitials: (name || "WA").slice(0, 2).toUpperCase(),
        avatarColor: AVATAR_GRADIENTS[Math.floor(Math.random() * AVATAR_GRADIENTS.length)],
        assignedRep: {
          name: currentUser?.full_name || "Sales Rep",
          avatar: currentUser?.avatar_url || "",
          role: currentUser?.role || "Sales Rep"
        },
        dealStage: "New Prospect",
        dealValue: 0,
        dealCloseDate: "",
        unreadCount: 0,
        isAssignedToMe: true,
        notes: [],
        lastMessage: initialMsg || "Conversation started",
        lastMessageTime: new Date().toISOString()
      };
      return [newConv, ...prev];
    });

    setActivePhone(cleanPhone);
  }, [currentUser]);

  // Active conversation object
  const activeChat = useMemo(() => {
    return (
      conversations.find((c) => c.phone.replace(/[^0-9]/g, "") === activePhone.replace(/[^0-9]/g, "")) ||
      conversations[0] ||
      null
    );
  }, [conversations, activePhone]);

  // Transform backend raw conversation into WhatsAppConversation
  const mapBackendConv = (raw: any, index: number): WhatsAppConversation => {
    const name = raw.contact_name || `WhatsApp User (+${raw.phone_number})`;
    const parts = name.trim().split(" ");
    const initials = (parts[0][0] + (parts[1] ? parts[1][0] : "")).toUpperCase();
    const grad = AVATAR_GRADIENTS[index % AVATAR_GRADIENTS.length];

    const repName = raw.assigned_rep?.name || (raw.assigned_user_id ? "Assigned Rep" : "Unassigned");
    const repParts = repName.trim().split(" ");
    const repInitials = (repParts[0][0] + (repParts[1] ? repParts[1][0] : "")).toUpperCase();

    const loggedInUser = currentUser || api.getCurrentUser();
    const isMine = raw.assigned_user_id
      ? raw.assigned_user_id === loggedInUser?.id
      : true;

    return {
      id: raw.id || `conv-${raw.phone_number}`,
      contact_id: raw.contact_id,
      contactName: name,
      companyName: raw.company_name || "",
      phone: raw.phone_number.startsWith("+") ? raw.phone_number : `+${raw.phone_number}`,
      email: raw.email || "",
      avatar_url: raw.avatar_url || null,
      avatarInitials: initials || "WA",
      avatarColor: grad,
      assignedRep: {
        id: raw.assigned_user_id || raw.assigned_rep?.id || "",
        name: repName,
        avatar: repInitials || "SR",
        role: raw.assigned_rep?.role || (repName === "Unassigned" ? "Unassigned" : "Sales Rep")
      },
      businessPhoneNumberId: raw.business_phone_number_id,
      dealStage: raw.deal_stage || "Qualified",
      dealValue: raw.deal_value || 1480000,
      dealCloseDate: "28 Oct 2026",
      unreadCount: raw.unread_count || 0,
      isAssignedToMe: isMine,
      lastMessage: raw.last_message,
      lastMessageTime: raw.last_message_time,
      notes: (() => {
        if (typeof window !== "undefined") {
          try {
            const saved = localStorage.getItem(`wa_notes_${raw.phone_number}`);
            if (saved) return JSON.parse(saved);
          } catch (e) {}
        }
        return Array.isArray(raw.notes) ? raw.notes : [];
      })()
    };
  };

  // Load conversations from backend
  const loadConversations = useCallback(async (isSilent = false, repFilter?: string) => {
    if (!isSilent) setIsLoadingConversations(true);
    else setIsRefreshing(true);

    try {
      const activeFilter = repFilter !== undefined ? repFilter : selectedRepFilter;
      const repParam = activeFilter === "ALL" ? undefined : activeFilter;
      const data = await api.getWhatsAppConversations(40, repParam);
      if (data && data.status === "success" && Array.isArray(data.conversations)) {
        const mapped = data.conversations.map(mapBackendConv);
        setConversations(mapped);

        // Check if a specific contact/phone was requested via URL query params
        const urlParams = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
        const targetPhone = urlParams?.get("phone")?.replace(/[^0-9]/g, "");
        const targetName = urlParams?.get("name");
        const targetText = urlParams?.get("text");

        if (targetText) {
          setMessageInput(decodeURIComponent(targetText));
        }

        if (targetPhone) {
          const match = mapped.find((c: any) => c.phone.replace(/[^0-9]/g, "") === targetPhone);
          if (match) {
            setActivePhone(match.phone);
          } else {
            // Auto-create on-the-fly conversation card so user can chat immediately
            const newConv: WhatsAppConversation = {
              id: `nav_${targetPhone}`,
              contactName: targetName ? decodeURIComponent(targetName) : format_display_phone(targetPhone),
              companyName: "CRM Contact",
              phone: targetPhone,
              email: "",
              avatarInitials: (targetName || "WA").slice(0, 2).toUpperCase(),
              avatarColor: AVATAR_GRADIENTS[0],
              assignedRep: {
                name: currentUser?.full_name || "Sales Rep",
                avatar: currentUser?.avatar_url || "",
                role: currentUser?.role || "Sales Rep"
              },
              dealStage: "Lead",
              dealValue: 0,
              dealCloseDate: "",
              unreadCount: 0,
              isAssignedToMe: true,
              notes: [],
              lastMessage: targetText ? decodeURIComponent(targetText) : "Start of conversation",
              lastMessageTime: new Date().toISOString()
            };
            setConversations([newConv, ...mapped]);
            setActivePhone(targetPhone);
          }
        } else {
          // If no active phone yet, pick the first conversation
          setActivePhone((prev) => {
            if (!prev && mapped.length > 0) {
              return mapped[0].phone;
            }
            return prev;
          });
        }
      }
    } catch (e: any) {
      console.warn("Could not fetch conversations", e);
    } finally {
      setIsLoadingConversations(false);
      setIsRefreshing(false);
    }
  }, [selectedRepFilter, currentUser]);

  // Load current user and team members
  useEffect(() => {
    const user = api.getCurrentUser();
    if (user) {
      setCurrentUser(user);
    }
    api.getTeamMembers()
      .then((members) => {
        if (Array.isArray(members)) setTeamMembers(members);
      })
      .catch((err) => console.warn("Failed to load team members", err));
  }, []);

  // Load message stream for active phone
  const loadMessages = useCallback(async (phone: string, isSilent = false) => {
    if (!phone) return;
    if (!isSilent) setIsLoadingMessages(true);

    try {
      const clean = phone.replace(/[^0-9]/g, "");
      const data = await api.getWhatsAppMessages({ phone_number: clean });

      if (data && data.status === "success" && Array.isArray(data.messages)) {
        const mappedMsgs: WhatsAppMessage[] = data.messages.map((m: any) => {
          let mediaFullUrl = m.media_url;
          if (mediaFullUrl && !mediaFullUrl.startsWith("http")) {
            const apiBase = process.env.NEXT_PUBLIC_API_URL?.replace("/api/v1", "") || "http://localhost:8000";
            mediaFullUrl = `${apiBase}${mediaFullUrl}`;
          }

          let attachment: WhatsAppMessage["attachment"] = undefined;
          const mType = (m.message_type || "").toLowerCase();
          const isVoice = m.is_voice_note || mType === "ptt" || mType === "audio";
          const isImg = mType === "image" || (mediaFullUrl && (mediaFullUrl.endsWith(".jpg") || mediaFullUrl.endsWith(".png") || mediaFullUrl.endsWith(".jpeg")));
          const isVideo = mType === "video" || (mediaFullUrl && (mediaFullUrl.endsWith(".mp4") || mediaFullUrl.endsWith(".mov") || mediaFullUrl.endsWith(".webm")));
          const isSticker = mType === "sticker" || (mediaFullUrl && mediaFullUrl.endsWith(".webp"));
          const isDoc = mType === "document" || (!isImg && !isVideo && !isVoice && !isSticker && !!mediaFullUrl);

          if (isImg) {
            attachment = {
              type: "image",
              name: m.file_name || "Photo",
              url: mediaFullUrl
            };
          } else if (isVideo) {
            attachment = {
              type: "video",
              name: m.file_name || "Video",
              url: mediaFullUrl
            };
          } else if (isSticker) {
            attachment = {
              type: "sticker",
              name: m.file_name || "Sticker",
              url: mediaFullUrl
            };
          } else if (isVoice) {
            attachment = {
              type: "audio",
              name: m.file_name || "Voice note",
              url: mediaFullUrl
            };
          } else if (isDoc) {
            attachment = {
              type: "pdf",
              name: m.file_name || "Document",
              size: "Document",
              url: mediaFullUrl
            };
          }

          return {
            id: m.id,
            sender: m.direction === "INBOUND" ? "inbound" : "outbound",
            text: m.message_body,
            timestamp: m.created_at || "Today",
            timeLabel: formatTime(m.created_at),
            dateGroup: "Today",
            status: m.status || "DELIVERED",
            messageType: m.message_type || "text",
            mediaUrl: mediaFullUrl,
            fileName: m.file_name,
            caption: m.caption,
            isVoiceNote: isVoice,
            attachment
          };
        });

        setMessages((prev) => {
          // Preserve any in-flight optimistic messages so messages NEVER disappear/stutter
          const pendingOptimistic = prev.filter((m) =>
            (m.id.startsWith("temp-") || m.id.startsWith("voice-")) &&
            !mappedMsgs.some((serverM) =>
              serverM.id === m.id ||
              (serverM.sender === "outbound" &&
               (serverM.text === m.text || (m.isVoiceNote && serverM.isVoiceNote)))
            )
          );
          return [...mappedMsgs, ...pendingOptimistic];
        });

        // Mark unread messages as read in backend and update conversation list badge
        api.markWhatsAppConversationRead(clean).catch(() => {});
        setConversations((prev) =>
          prev.map((c) =>
            c.phone.replace(/[^0-9]/g, "") === clean ? { ...c, unreadCount: 0 } : c
          )
        );
      }
    } catch (e: any) {
      console.warn("Could not fetch messages for", phone, e);
    } finally {
      setIsLoadingMessages(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  // Load messages whenever activePhone changes
  useEffect(() => {
    if (activePhone) {
      loadMessages(activePhone);
      // Mark read in backend
      api.markWhatsAppConversationRead(activePhone).catch(() => {});
    }
  }, [activePhone, loadMessages]);

  // Lazy load avatar for active contact if missing
  useEffect(() => {
    if (!activeChat || activeChat.avatar_url) return;
    const clean = activeChat.phone.replace(/[^0-9]/g, "");
    if (!clean) return;

    api.getWhatsAppContactAvatar(clean).then((res) => {
      if (res?.avatar_url) {
        setConversations((prev) =>
          prev.map((c) =>
            c.phone.replace(/[^0-9]/g, "") === clean
              ? { ...c, avatar_url: res.avatar_url }
              : c
          )
        );
      }
    });
  }, [activeChat?.phone]);

  // Close emoji picker on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(e.target as Node)) {
        setShowEmojiPicker(false);
      }
    };
    if (showEmojiPicker) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showEmojiPicker]);

  // Polling: throttled refresh (8s) with document visibility guard & overlap prevention
  useEffect(() => {
    const poll = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      if (isPollingRef.current) return;
      isPollingRef.current = true;
      try {
        await loadConversations(true);
        if (activePhone && !isSending) {
          await loadMessages(activePhone, true);
        }
      } catch (err) {
        console.warn("WhatsApp background sync error:", err);
      } finally {
        isPollingRef.current = false;
      }
    };

    const interval = setInterval(poll, 4000);

    const handleVisibility = () => {
      if (typeof document !== "undefined" && !document.hidden) {
        poll();
      }
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibility);
    }

    return () => {
      clearInterval(interval);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibility);
      }
    };
  }, [activePhone, loadConversations, loadMessages]);

  // Auto-scroll when messages update (only if user hasn't scrolled up to view older messages)
  useEffect(() => {
    if (!isUserScrolledUpRef.current) {
      chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  // Filter conversations
  const filteredConversations = useMemo(() => {
    return conversations.filter((c) => {
      if (filterTab === "My Chats" && !c.isAssignedToMe) return false;
      if (filterTab === "Unassigned" && c.assignedRep.name !== "Unassigned") return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesName = c.contactName.toLowerCase().includes(q);
        const matchesPhone = c.phone.replace(/[^0-9]/g, "").includes(q.replace(/[^0-9]/g, ""));
        const matchesCompany = c.companyName.toLowerCase().includes(q);
        return matchesName || matchesPhone || matchesCompany;
      }
      return true;
    });
  }, [conversations, filterTab, searchQuery]);

  // Select conversation
  const handleSelectChat = async (phone: string) => {
    isUserScrolledUpRef.current = false;
    setActivePhone(phone);
    setConversations((prev) =>
      prev.map((c) =>
        c.phone.replace(/[^0-9]/g, "") === phone.replace(/[^0-9]/g, "")
          ? { ...c, unreadCount: 0 }
          : c
      )
    );
    try {
      await api.markWhatsAppConversationRead(phone.replace(/[^0-9]/g, ""));
    } catch (_) {}
  };

  // Send message action
  const handleSendMessage = async (textToSend?: string) => {
    const text = (textToSend ?? messageInput).trim();
    if (!text || !activeChat) return;

    const cleanPhone = activeChat.phone.replace(/[^0-9]/g, "");

    // 1. Optimistic message update
    const tempId = `temp-${Date.now()}`;
    const optimisticMsg: WhatsAppMessage = {
      id: tempId,
      sender: "outbound",
      text,
      timestamp: "Today",
      timeLabel: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      dateGroup: "Today",
      status: "SENT"
    };

    setMessages((prev) => [...prev, optimisticMsg]);
    setMessageInput("");
    setShowTemplateSelector(false);
    setIsSending(true);

    try {
      const res = await api.sendWhatsAppMessage({
        phone_number: cleanPhone,
        message: text,
        contact_id: activeChat.contact_id
      });

      if (res && res.status === "success") {
        const savedData = res.data;
        // Seamlessly update optimistic message with real server ID and delivery status
        setMessages((prev) =>
          prev.map((m) =>
            m.id === tempId
              ? {
                  ...m,
                  id: savedData?.id || m.id,
                  status: (savedData?.status as any) || "DELIVERED",
                  timeLabel: formatTime(savedData?.created_at) || m.timeLabel
                }
              : m
          )
        );
        loadConversations(true);
      }
    } catch (err: any) {
      toast.error("Failed to send message", err.message || "Please check Meta Cloud connection.");
    } finally {
      setIsSending(false);
    }
  };

  // Select Meta template
  const handleSelectTemplate = (template: typeof META_TEMPLATES[0]) => {
    if (!activeChat) return;
    const firstName = activeChat.contactName.split(" ")[0] || "Valued Client";
    const customizedText = template.content.replace("{{name}}", firstName);
    setMessageInput(customizedText);
    setShowTemplateSelector(false);
  };

  // Fast-send Meta template immediately
  const handleFastSendTemplate = (template: typeof META_TEMPLATES[0]) => {
    if (!activeChat) return;
    const firstName = activeChat.contactName.split(" ")[0] || "Valued Client";
    const customizedText = template.content.replace("{{name}}", firstName);
    handleSendMessage(customizedText);
  };

  // Keydown handler
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // Listen for "/"
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setMessageInput(val);
    if (val.endsWith("/")) {
      setShowTemplateSelector(true);
    }
  };

  // Quick Action: Send GST Quote Link
  const handleQuickSendQuote = () => {
    if (!activeChat) return;
    const quoteUrl = `https://zigmaa.crm/quotes/view/INV-2026-${Math.floor(100 + Math.random() * 900)}`;
    const firstName = activeChat.contactName.split(" ")[0];
    const quoteMsg = `Hi ${firstName}, here is your formal GST quotation: ${quoteUrl}\nAmount: ${formatCurrency(activeChat.dealValue)} (Inclusive of 18% IGST).`;
    handleSendMessage(quoteMsg);
    toast.success("Quotation Link Sent", `GST Quote link dispatched to ${activeChat.contactName}`);
  };

  // Quick Action: Create Deal
  const handleQuickCreateDeal = async () => {
    if (!activeChat) return;
    try {
      const dealTitle = `${activeChat.contactName || activeChat.companyName || "WhatsApp Prospect"} - Deal`;
      const created = await api.createDeal({
        title: dealTitle,
        contact_id: activeChat.contact_id ? String(activeChat.contact_id) : undefined,
        contact_name: activeChat.contactName,
        contact_phone: activeChat.phone,
        company_name: activeChat.companyName,
        stage: "New Deal",
        stage_id: "New Deal",
        value: 50000,
        deal_value: 50000,
        currency: "INR"
      });
      toast.success("Deal Created & Linked", `Deal "${created.title}" added to pipeline in New Deal stage.`);
    } catch (err: any) {
      toast.error("Deal Creation Failed", err.message || "Could not create deal for WhatsApp contact.");
    }
  };

  // Explicit Contact Name Update Action
  const handleSaveContactName = async () => {
    if (!activeChat || !editedName.trim()) return;
    const newName = editedName.trim();
    setIsSavingName(true);
    try {
      if (activeChat.contact_id) {
        await api.updateWhatsAppContactName({
          contactId: activeChat.contact_id,
          newName
        });
      }
      setConversations((prev) =>
        prev.map((c) =>
          c.phone.replace(/[^0-9]/g, "") === activeChat.phone.replace(/[^0-9]/g, "")
            ? {
                ...c,
                contactName: newName,
                avatarInitials: (newName.split(" ")[0][0] + (newName.split(" ")[1] ? newName.split(" ")[1][0] : "")).toUpperCase()
              }
            : c
        )
      );
      toast.success("Contact Name Updated", `Saved as "${newName}"`);
      setIsEditingName(false);
    } catch {
      toast.error("Update Failed", "Could not save contact name.");
    } finally {
      setIsSavingName(false);
    }
  };

  // Quick Action: Add Internal Note
  const handleAddNoteSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNoteText.trim() || !activeChat) return;

    const authorName = currentUser?.full_name || "Internal Staff";
    const newNote = {
      id: `note-${Date.now()}`,
      text: newNoteText.trim(),
      author: authorName,
      timestamp: "Just now"
    };

    const updatedNotes = [newNote, ...(activeChat.notes || [])];
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem(`wa_notes_${activeChat.phone}`, JSON.stringify(updatedNotes));
      } catch (err) {}
    }

    setConversations((prev) =>
      prev.map((c) =>
        c.phone === activeChat.phone ? { ...c, notes: updatedNotes } : c
      )
    );

    setNewNoteText("");
    setShowNewNoteModal(false);
    toast.success("Note Saved", "CRM context note recorded.");
  };

  // Handle Stage Change
  const handleStageChange = (newStage: string) => {
    if (!activeChat) return;
    setConversations((prev) =>
      prev.map((c) => (c.phone === activeChat.phone ? { ...c, dealStage: newStage } : c))
    );
    toast.info("Stage Updated", `Deal stage changed to ${newStage}`);
  };

  // Handle Deal Value Change
  const handleDealValueChange = (valStr: string) => {
    if (!activeChat) return;
    const num = parseInt(valStr.replace(/[^0-9]/g, ""), 10) || 0;
    setConversations((prev) =>
      prev.map((c) => (c.phone === activeChat.phone ? { ...c, dealValue: num } : c))
    );
  };

  // Real File & Document Upload
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !activeChat) return;
    const file = files[0];

    if (file.size > 16 * 1024 * 1024) {
      toast.error("File Too Large", "Maximum file size for WhatsApp is 16MB.");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      const base64Data = reader.result as string;
      await handleSendAttachment(file, base64Data);
    };
    reader.readAsDataURL(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSendAttachment = async (file: File, base64Data: string) => {
    if (!activeChat) return;
    const cleanPhone = activeChat.phone.replace(/[^0-9]/g, "");

    const tempId = `temp-${Date.now()}`;
    const isImg = file.type.startsWith("image/");
    const isVideo = file.type.startsWith("video/");
    const isAudio = file.type.startsWith("audio/");
    const attType: any = isImg ? "image" : isVideo ? "video" : isAudio ? "audio" : "pdf";

    const optimisticMsg: WhatsAppMessage = {
      id: tempId,
      sender: "outbound",
      text: (isImg || isVideo || isAudio) ? "" : `📎 ${file.name}`,
      timestamp: "Today",
      timeLabel: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      dateGroup: "Today",
      status: "SENT",
      attachment: {
        type: attType,
        name: file.name,
        size: `${Math.round(file.size / 1024)} KB`,
        url: base64Data
      }
    };

    setMessages((prev) => [...prev, optimisticMsg]);
    setIsSending(true);

    try {
      const res = await api.sendWhatsAppMessage({
        phone_number: cleanPhone,
        message: (isImg || isVideo || isAudio) ? "" : `📎 ${file.name}`,
        contact_id: activeChat.contact_id,
        file_base64: base64Data,
        file_name: file.name,
        file_type: file.type
      });

      if (res && res.status === "success") {
        const savedData = res.data;
        const apiBase = process.env.NEXT_PUBLIC_API_URL?.replace("/api/v1", "") || "http://localhost:8000";
        const fullMediaUrl = savedData?.media_url
          ? (savedData.media_url.startsWith("http") ? savedData.media_url : `${apiBase}${savedData.media_url}`)
          : undefined;

        setMessages((prev) =>
          prev.map((m) =>
            m.id === tempId
              ? {
                  ...m,
                  id: savedData?.id || m.id,
                  status: (savedData?.status as any) || "DELIVERED",
                  mediaUrl: fullMediaUrl || m.mediaUrl,
                  attachment: {
                    ...m.attachment!,
                    url: fullMediaUrl || m.attachment!.url
                  }
                }
              : m
          )
        );
        loadConversations(true);
        toast.success("Attachment Dispatched", `Sent ${file.name} to ${activeChat.contactName}`);
      }
    } catch (err: any) {
      toast.error("Failed to send attachment", err.message || "Please check WhatsApp connection.");
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className={cn(
      "flex h-screen font-sans overflow-hidden select-none transition-colors",
      isDark ? "bg-[#090A0F] text-slate-100" : "bg-[#F8FAFC] text-slate-800"
    )}>
      {/* Main Sidebar */}
      <Sidebar />

      {/* Main Area */}
      <div className={cn(
        "flex-1 flex flex-col min-w-0 overflow-hidden transition-colors",
        isDark ? "bg-[#090A0F]" : "bg-[#F8FAFC]"
      )}>
        {/* CRM Global Header */}
        <Header title="WhatsApp Business Suite" />

        {/* 3-Column WhatsApp Suite Workspace */}
        <div className="flex-1 flex min-h-0 overflow-hidden relative">

          {/* ========================================================= */}
          {/* COLUMN A: Chat Conversation Thread List (~320px width)    */}
          {/* ========================================================= */}
          <div className={cn(
            "w-72 xl:w-80 shrink-0 flex flex-col transition-colors border-r z-10",
            isDark ? "bg-[#090A0F] border-[#1E293B]" : "bg-white border-slate-200"
          )}>
            {/* Top Header */}
            <div className={cn(
              "p-3.5 sm:p-4 border-b flex flex-col gap-3 transition-colors shrink-0",
              isDark ? "bg-[#0D0F17]/80 border-[#1E293B]" : "bg-slate-50/90 border-slate-200"
            )}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-[#25D366] text-white flex items-center justify-center shadow-xs shrink-0">
                    <WhatsAppIcon className="w-4 h-4 fill-white" />
                  </div>
                  <h2 className={cn("font-bold text-base tracking-tight", isDark ? "text-white" : "text-slate-900")}>
                    WhatsApp Inbox
                  </h2>
                </div>

                <button
                  onClick={() => loadConversations(false)}
                  className={cn(
                    "p-1.5 rounded-lg border transition-all cursor-pointer hover:scale-105 active:scale-95",
                    isDark ? "text-slate-400 hover:text-white border-white/5 hover:bg-white/5" : "text-slate-500 hover:text-slate-900 border-slate-200/80 hover:bg-slate-100"
                  )}
                  title="Refresh conversations"
                >
                  <RefreshCw className={cn("w-3.5 h-3.5", isRefreshing && "animate-spin text-emerald-500")} />
                </button>
              </div>

              {/* Linked Device Status Button */}
              <button
                onClick={() => setShowQRModal(true)}
                className={cn(
                  "w-full flex items-center justify-between px-3 py-2 rounded-xl border text-xs font-semibold transition-all cursor-pointer shadow-2xs hover:scale-[1.01] active:scale-[0.99]",
                  qrStatus === "CONNECTED"
                    ? isDark
                      ? "bg-emerald-950/40 border-emerald-800/60 text-emerald-300 hover:bg-emerald-900/50"
                      : "bg-emerald-50 border-emerald-300 text-emerald-800 hover:bg-emerald-100"
                    : isDark
                      ? "bg-slate-800/80 border-slate-700/80 text-slate-300 hover:border-emerald-500 hover:text-emerald-400"
                      : "bg-white border-slate-200 text-slate-700 hover:border-emerald-500 hover:text-emerald-700"
                )}
                title="WhatsApp Linked Device Status"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className={cn(
                    "w-2 h-2 rounded-full shrink-0",
                    qrStatus === "CONNECTED" ? "bg-emerald-500 animate-pulse" : "bg-slate-400"
                  )} />
                  <span className="font-semibold truncate">
                    {qrStatus === "CONNECTED"
                      ? `Linked: ${qrPhone || "+91 96004 71080"}`
                      : "Link WhatsApp Device (Scan QR)"}
                  </span>
                </div>
                <span className={cn(
                  "text-[10px] font-bold px-2 py-0.5 rounded-lg shrink-0",
                  qrStatus === "CONNECTED"
                    ? "bg-emerald-600 text-white"
                    : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-600"
                )}>
                  {qrStatus === "CONNECTED" ? "Connected" : "Scan QR"}
                </span>
              </button>

              {/* Search Bar & New Chat Button */}
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Filter by name or phone..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className={cn(
                      "w-full rounded-xl pl-9 pr-8 py-2 text-xs focus:outline-none transition-all border shadow-2xs",
                      isDark
                        ? "bg-[#131B2E]/90 border-[#1E293B] text-white placeholder-slate-400 focus:border-emerald-500/60"
                        : "bg-white border-slate-200 text-slate-900 placeholder-slate-400 focus:border-emerald-500"
                    )}
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery("")}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-white"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setShowNewChatModal(true)}
                  className="h-8.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm transition-all hover:scale-105 active:scale-95 shrink-0 cursor-pointer"
                  title="Start a new WhatsApp chat with any phone number"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>New Chat</span>
                </button>
              </div>

              {/* Segmented Filter Control */}
              <div className={cn(
                "flex items-center gap-1 p-1 rounded-xl border transition-colors",
                isDark ? "bg-[#131B2E]/60 border-[#1E293B]" : "bg-slate-100/90 border-slate-200/80"
              )}>
                {(["All", "My Chats", "Unassigned"] as const).map((tab) => {
                  const count =
                    tab === "All"
                      ? conversations.length
                      : tab === "My Chats"
                      ? conversations.filter((c) => c.isAssignedToMe).length
                      : conversations.filter((c) => c.assignedRep.name === "Unassigned").length;

                  return (
                    <button
                      key={tab}
                      onClick={() => setFilterTab(tab)}
                      className={cn(
                        "flex-1 py-1.5 px-1.5 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap",
                        filterTab === tab
                          ? (isDark
                              ? "bg-emerald-600 text-white shadow-xs"
                              : "bg-white text-slate-900 shadow-xs")
                          : (isDark
                              ? "text-slate-400 hover:text-slate-200 hover:bg-white/5"
                              : "text-slate-600 hover:text-slate-900 hover:bg-slate-200/60")
                      )}
                    >
                      <span>{tab}</span>
                      <span
                        className={cn(
                          "text-[10px] px-1.5 py-0.2 rounded-full font-bold",
                          filterTab === tab
                            ? (isDark ? "bg-emerald-700 text-white" : "bg-slate-100 text-slate-800")
                            : (isDark ? "bg-white/10 text-slate-400" : "bg-slate-200 text-slate-600")
                        )}
                      >
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Conversation List */}
            <div className={cn(
              "flex-1 overflow-y-auto divide-y scrollbar-thin transition-colors pt-0.5",
              isDark
                ? "divide-[#1E293B]/40 scrollbar-thumb-slate-800"
                : "divide-slate-100 scrollbar-thumb-slate-200"
            )}>
              {isLoadingConversations && conversations.length === 0 ? (
                <div className="p-6 space-y-4">
                  {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="flex items-center gap-3 animate-pulse">
                      <div className={cn("w-11 h-11 rounded-full", isDark ? "bg-white/5" : "bg-slate-200")} />
                      <div className="flex-1 space-y-2">
                        <div className={cn("h-3 w-28 rounded-md", isDark ? "bg-white/5" : "bg-slate-200")} />
                        <div className={cn("h-2 w-36 rounded-md", isDark ? "bg-white/5" : "bg-slate-100")} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : filteredConversations.length === 0 ? (
                <div className="p-8 text-center text-slate-400 text-xs">
                  <MessageSquare className="w-8 h-8 text-slate-400 mx-auto mb-2 opacity-50" />
                  <p className={isDark ? "text-slate-400" : "text-slate-600"}>No WhatsApp conversations yet.</p>
                  <p className="text-[11px] text-slate-400 mt-1">
                    Incoming messages will appear here automatically.
                  </p>
                </div>
              ) : (
                filteredConversations.map((conv) => {
                  const isSelected = activeChat?.phone === conv.phone;

                  return (
                    <div
                      key={conv.id}
                      onClick={() => handleSelectChat(conv.phone)}
                      className={cn(
                        "p-3.5 flex items-start gap-3 cursor-pointer transition-all relative group",
                        isSelected
                          ? isDark
                            ? "bg-[#131B2E] border-l-3 border-emerald-500 shadow-inner"
                            : "bg-emerald-50/90 border-l-3 border-emerald-600 shadow-xs"
                          : isDark
                          ? "hover:bg-white/[0.03]"
                          : "hover:bg-slate-50"
                      )}
                    >
                      {/* Avatar */}
                      <div className="relative shrink-0">
                        <ContactAvatar
                          avatarUrl={conv.avatar_url}
                          name={conv.contactName}
                          initials={conv.avatarInitials}
                          color={conv.avatarColor}
                          size="w-11 h-11"
                          rounded="rounded-full"
                          textClass="text-xs"
                        />
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-0.5">
                          <h4
                            className={cn(
                              "text-xs truncate",
                              isSelected
                                ? isDark ? "text-white font-bold" : "text-emerald-950 font-bold"
                                : isDark ? "text-slate-200 font-semibold" : "text-slate-900 font-semibold"
                            )}
                          >
                            {conv.contactName}
                          </h4>
                          <span className={cn(
                            "text-[10px] shrink-0 font-medium ml-1",
                            conv.unreadCount > 0 && !isSelected ? "text-emerald-600 dark:text-emerald-400 font-bold" : "text-slate-400"
                          )}>
                            {formatTime(conv.lastMessageTime)}
                          </span>
                        </div>

                        {conv.companyName && conv.companyName !== "Direct Prospect" && (
                          <div className={cn("text-[11px] font-medium truncate mb-0.5 text-emerald-600 dark:text-emerald-400")}>
                            {conv.companyName}
                          </div>
                        )}

                        {/* Last message preview + unread pill */}
                        <div className="flex items-center justify-between gap-1">
                          <div className={cn(
                            "flex items-center gap-1 text-[11px] truncate min-w-0",
                            conv.unreadCount > 0 && !isSelected
                              ? isDark ? "text-slate-200 font-semibold" : "text-slate-900 font-semibold"
                              : isDark ? "text-slate-400" : "text-slate-500"
                          )}>
                            <span className="truncate">
                              {conv.lastMessage || "Click to open conversation"}
                            </span>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            {conv.unreadCount > 0 && !isSelected && (
                              <span className="min-w-4.5 h-4.5 px-1.5 rounded-full bg-emerald-500 text-white text-[10px] font-bold flex items-center justify-center shrink-0 shadow-2xs">
                                {conv.unreadCount}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* ========================================================= */}
          {/* COLUMN B: Middle Column: Active Chat Thread Window (Flex) */}
          {/* ========================================================= */}
          <div className={cn(
            "flex-1 flex flex-col relative min-w-0 transition-colors",
            isDark ? "bg-[#0D0B14]" : "bg-[#F0F2F5]"
          )}>
            {activeChat ? (
              <>
                {/* Chat Header */}
                <div className={cn(
                  "h-16 px-4 sm:px-5 border-b backdrop-blur-md flex items-center justify-between shrink-0 z-10 transition-colors gap-3 overflow-hidden",
                  isDark ? "border-[#1E293B] bg-[#090A0F]/90 text-white" : "border-slate-200 bg-white/95 text-slate-900 shadow-2xs"
                )}>
                  {/* Contact Identity (Protected from shrinking/overlapping) */}
                  <div className="flex items-center gap-3 min-w-0 flex-1 overflow-hidden">
                    <ContactAvatar
                      avatarUrl={activeChat.avatar_url}
                      name={activeChat.contactName}
                      initials={activeChat.avatarInitials}
                      color={activeChat.avatarColor}
                      size="w-10 h-10"
                      rounded="rounded-full"
                      textClass="text-xs"
                    />
                    <div className="min-w-0 flex-1 overflow-hidden">
                      <div className="flex items-center gap-2 min-w-0">
                        <h3 className={cn("font-bold text-sm sm:text-base truncate leading-snug shrink min-w-0", isDark ? "text-white" : "text-slate-900")}>
                          {activeChat.contactName}
                        </h3>
                        <span className={cn(
                          "text-[10px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap shrink-0",
                          isDark
                            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                            : "bg-emerald-50 text-emerald-700 border-emerald-200"
                        )}>
                          {activeChat.dealStage}
                        </span>
                      </div>
                      <div className={cn(
                        "flex items-center gap-2 text-xs truncate mt-0.5",
                        isDark ? "text-slate-400" : "text-slate-500"
                      )}>
                        <span className="font-mono text-[11px] shrink-0 font-medium">{activeChat.phone}</span>
                        <span className="text-slate-300 dark:text-slate-700 hidden sm:inline">•</span>
                        {activeChat.lastMessageTime ? (
                          <span className="text-slate-400 dark:text-slate-400 text-[11px] truncate">
                            last seen {formatTime(activeChat.lastMessageTime)}
                          </span>
                        ) : (
                          <span className="text-slate-400 dark:text-slate-400 text-[11px] truncate">
                            Direct WhatsApp
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Header Actions (Never crowd or overlap contact identity) */}
                  <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                    <button
                      onClick={handleQuickCreateDeal}
                      className={cn(
                        "inline-flex items-center justify-center gap-1.5 h-9 px-2.5 sm:px-3 rounded-xl border text-xs font-semibold whitespace-nowrap transition-all cursor-pointer shadow-2xs hover:scale-102 active:scale-98 shrink-0",
                        isDark
                          ? "bg-white/5 hover:bg-white/10 text-slate-200 border-[#1E293B]"
                          : "bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200"
                      )}
                      title="Create or link pipeline deal"
                    >
                      <Handshake className="w-4 h-4 text-indigo-500 shrink-0" />
                      <span className="hidden xl:inline">Create Deal</span>
                    </button>

                    <button
                      onClick={handleOpenQuotePicker}
                      className="inline-flex items-center justify-center gap-1.5 h-9 px-2.5 sm:px-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold whitespace-nowrap shadow-sm shadow-emerald-600/25 transition-all cursor-pointer hover:scale-102 active:scale-98 shrink-0"
                      title="Select and send quotation to contact"
                    >
                      <FileText className="w-3.5 h-3.5 shrink-0" />
                      <span className="hidden sm:inline">Send Quote</span>
                    </button>

                    {/* Right Drawer Toggle */}
                    <button
                      onClick={() => setShowRightDrawer(!showRightDrawer)}
                      className={cn(
                        "h-9 w-9 flex items-center justify-center rounded-xl border transition-all cursor-pointer shrink-0 hover:scale-102 active:scale-98",
                        isDark
                          ? (showRightDrawer
                              ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                              : "bg-white/5 text-slate-400 hover:text-white border-[#1E293B]")
                          : (showRightDrawer
                              ? "bg-emerald-50 text-emerald-700 border-emerald-300"
                              : "bg-slate-50 text-slate-600 hover:text-slate-900 border-slate-200")
                      )}
                      title={showRightDrawer ? "Hide CRM context drawer" : "Show CRM context drawer"}
                    >
                      {showRightDrawer ? (
                        <PanelRightClose className="w-4 h-4" />
                      ) : (
                        <PanelRightOpen className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Message Stream Area */}
                <div
                  onScroll={(e) => {
                    const el = e.currentTarget;
                    const isUp = el.scrollHeight - el.scrollTop - el.clientHeight > 80;
                    isUserScrolledUpRef.current = isUp;
                  }}
                  className={cn(
                    "flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 scrollbar-thin",
                    isDark ? "scrollbar-thumb-slate-800" : "scrollbar-thumb-slate-300"
                  )}
                >
                  {/* Subtle Date Separator */}
                  <div className="flex items-center justify-center my-3">
                    <span className={cn(
                      "px-3 py-1 rounded-full text-[11px] font-semibold border",
                      isDark
                        ? "bg-white/5 text-slate-400 border-white/5"
                        : "bg-white/80 text-slate-600 border-slate-200/80 shadow-2xs"
                    )}>
                      Meta WhatsApp Verified Channel • End-to-End Encrypted
                    </span>
                  </div>

                  {isLoadingMessages && messages.length === 0 ? (
                    <div className={cn(
                      "flex items-center justify-center py-12 gap-2",
                      isDark ? "text-slate-400" : "text-slate-500"
                    )}>
                      <Loader2 className="w-5 h-5 animate-spin text-emerald-500" />
                      <span className="text-xs">Loading message history...</span>
                    </div>
                  ) : messages.length === 0 ? (
                    <div className={cn(
                      "text-center py-12 space-y-2",
                      isDark ? "text-slate-400" : "text-slate-500"
                    )}>
                      <p className="text-xs">No previous message history with this contact.</p>
                      <p className="text-[11px] opacity-75">
                        Type below or select a template to start conversation via Meta Cloud API.
                      </p>
                    </div>
                  ) : (
                    messages.map((msg) => {
                      const isOutbound = msg.sender === "outbound";
                      const cleanText = cleanDisplayCaption(msg.text, msg.fileName);
                      const isSticker = msg.attachment?.type === "sticker";

                      return (
                        <div
                          key={msg.id}
                          className={cn(
                            "flex flex-col",
                            isOutbound ? "items-end" : "items-start"
                          )}
                        >
                          <div
                            className={cn(
                              "rounded-2xl p-3.5 max-w-[85%] sm:max-w-[70%] text-sm leading-relaxed transition-all shadow-xs",
                              isSticker && !cleanText
                                ? "bg-transparent border-0 shadow-none p-1"
                                : (isOutbound
                                    ? (isDark
                                        ? "bg-emerald-600/25 border border-emerald-500/30 text-white rounded-tr-sm ml-auto"
                                        : "bg-[#D9FDD3] border border-[#C2EBC0] text-slate-900 rounded-tr-sm ml-auto shadow-2xs")
                                    : (isDark
                                        ? "bg-white/5 border border-white/10 text-white rounded-tl-sm"
                                        : "bg-white border border-slate-200/90 text-slate-900 rounded-tl-sm shadow-2xs"))
                            )}
                          >
                            {/* Sticker Preview */}
                            {msg.attachment?.type === "sticker" && msg.attachment.url && (
                              <div className="my-1 cursor-pointer select-none">
                                <img
                                  src={msg.attachment.url}
                                  alt="WhatsApp Sticker"
                                  className="w-32 h-32 object-contain"
                                />
                              </div>
                            )}

                            {/* Image Preview Card */}
                            {msg.attachment?.type === "image" && msg.attachment.url && (
                              <div className="mt-1 mb-2 rounded-xl overflow-hidden border border-black/10 dark:border-white/10 max-w-xs cursor-pointer group shadow-sm">
                                <img
                                  src={msg.attachment.url}
                                  alt="WhatsApp Image"
                                  className="w-full max-h-64 object-cover rounded-xl transition-transform group-hover:scale-102"
                                  onClick={() => setSelectedImagePreview(msg.attachment?.url || null)}
                                />
                              </div>
                            )}

                            {/* Video Player Card */}
                            {msg.attachment?.type === "video" && msg.attachment.url && (
                              <div className="mt-1 mb-2 rounded-xl overflow-hidden border border-black/10 dark:border-white/10 max-w-xs shadow-sm bg-black">
                                <video
                                  src={msg.attachment.url}
                                  controls
                                  preload="metadata"
                                  className="w-full max-h-72 rounded-xl object-contain"
                                />
                              </div>
                            )}

                            {/* Voice Note / Audio Player */}
                            {(msg.isVoiceNote || msg.messageType === "ptt" || msg.attachment?.type === "audio") && (
                              <VoiceNotePlayer
                                audioUrl={msg.attachment?.url || msg.mediaUrl || ""}
                                isOutbound={isOutbound}
                                isDark={isDark}
                              />
                            )}

                            {/* Document Card if present */}
                            {(msg.attachment?.type === "pdf" || msg.attachment?.type === "document") && (
                              <div className={cn(
                                "mt-2 p-3 rounded-xl flex items-center justify-between gap-3 border shadow-2xs",
                                isDark
                                  ? "bg-black/40 border-white/10"
                                  : (isOutbound ? "bg-white/70 border-emerald-200" : "bg-slate-50 border-slate-200")
                              )}>
                                <div className="flex items-center gap-2.5 min-w-0">
                                  <div className="p-2 rounded-lg bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 shrink-0">
                                    <File className="w-4 h-4" />
                                  </div>
                                  <div className="min-w-0">
                                    <div className={cn("text-xs font-semibold truncate", isDark ? "text-white" : "text-slate-900")}>
                                      {msg.attachment.name}
                                    </div>
                                    <div className={cn("text-[10px]", isDark ? "text-slate-400" : "text-slate-500")}>
                                      {msg.attachment.size || "Document"}
                                    </div>
                                  </div>
                                </div>

                                <a
                                  href={msg.attachment.url || "#"}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => {
                                    if (!msg.attachment?.url) {
                                      e.preventDefault();
                                      toast.info("Document Download", `Opening ${msg.attachment?.name}`);
                                    }
                                  }}
                                  className={cn(
                                    "p-1.5 rounded-lg transition-colors shrink-0",
                                    isDark ? "bg-white/10 hover:bg-white/20 text-slate-200" : "bg-slate-200/70 hover:bg-slate-300 text-slate-700"
                                  )}
                                  title="Download document"
                                >
                                  <Download className="w-3.5 h-3.5" />
                                </a>
                              </div>
                            )}

                            {/* Message Text (Hide if placeholder, only display real user message or caption) */}
                            {cleanText ? (
                              <p className="whitespace-pre-wrap select-text mt-1">{cleanText}</p>
                            ) : null}

                            {/* Message Footer: Time + Status Tick */}
                            <div className={cn(
                              "flex items-center justify-end gap-1.5 mt-1.5 text-[10px] font-medium",
                              isDark ? "text-slate-400" : "text-slate-500"
                            )}>
                              <span>{msg.timeLabel}</span>
                              {isOutbound && (
                                <span title={msg.status === "READ" ? "Read" : "Delivered"}>
                                  {msg.status === "PENDING" ? (
                                    <Clock className="w-3.5 h-3.5 text-slate-400" />
                                  ) : (
                                    <CheckCheck
                                      className={cn(
                                        "w-3.5 h-3.5",
                                        msg.status === "READ" ? "text-[#53bdeb]" : (isDark ? "text-slate-400" : "text-slate-400")
                                      )}
                                    />
                                  )}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}

                  <div ref={chatBottomRef} />
                </div>

                {/* Template Selector Dropdown / Suggestion Popover */}
                {showTemplateSelector && (
                  <div className={cn(
                    "mx-4 mb-2 p-3 border rounded-2xl shadow-2xl backdrop-blur-md animate-in fade-in slide-in-from-bottom-2 z-20",
                    isDark
                      ? "bg-[#131B2E] border-emerald-500/30 text-white"
                      : "bg-white border-emerald-400/40 text-slate-900 shadow-xl"
                  )}>
                    <div className={cn("flex items-center justify-between pb-2 mb-2 border-b", isDark ? "border-[#1E293B]" : "border-slate-200")}>
                      <div className="flex items-center gap-1.5 text-xs font-bold">
                        <Zap className="w-3.5 h-3.5 text-emerald-500" />
                        <span className={isDark ? "text-white" : "text-slate-900"}>Meta Cloud Pre-Approved WhatsApp Templates</span>
                      </div>
                      <button
                        onClick={() => setShowTemplateSelector(false)}
                        className={isDark ? "text-slate-400 hover:text-white" : "text-slate-500 hover:text-slate-900"}
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {META_TEMPLATES.map((tpl) => (
                        <div
                          key={tpl.id}
                          className={cn(
                            "p-2.5 rounded-xl border transition-all group flex flex-col justify-between",
                            isDark
                              ? "bg-white/5 hover:bg-emerald-500/10 border-white/5 hover:border-emerald-500/30"
                              : "bg-slate-50 hover:bg-emerald-50/70 border-slate-200 hover:border-emerald-300"
                          )}
                        >
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <span className={cn(
                                "text-xs font-bold transition-colors",
                                isDark ? "text-slate-200 group-hover:text-emerald-400" : "text-slate-800 group-hover:text-emerald-700"
                              )}>
                                {tpl.name}
                              </span>
                              <span className={cn(
                                "text-[10px] font-semibold px-1.5 py-0.2 rounded-md",
                                isDark ? "bg-white/10 text-slate-400" : "bg-slate-200 text-slate-600"
                              )}>
                                {tpl.tag}
                              </span>
                            </div>
                            <p className={cn(
                              "text-[11px] line-clamp-2 leading-relaxed",
                              isDark ? "text-slate-400" : "text-slate-600"
                            )}>
                              {tpl.content.replace("{{name}}", activeChat.contactName.split(" ")[0])}
                            </p>
                          </div>

                          <div className={cn("flex items-center justify-end gap-1.5 mt-2 pt-1 border-t", isDark ? "border-white/5" : "border-slate-200")}>
                            <button
                              onClick={() => handleSelectTemplate(tpl)}
                              className={cn(
                                "px-2 py-0.5 rounded-md text-[10px] font-medium transition-colors",
                                isDark ? "bg-white/5 hover:bg-white/10 text-slate-300" : "bg-slate-200 hover:bg-slate-300 text-slate-700"
                              )}
                            >
                              Insert
                            </button>
                            <button
                              onClick={() => handleFastSendTemplate(tpl)}
                              className="px-2.5 py-0.5 rounded-md text-[10px] font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow-2xs"
                            >
                              ⚡ Send Now
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Message Input Dock (Fixed at bottom) */}
                <div className={cn(
                  "p-3.5 sm:p-4 border-t backdrop-blur-md shrink-0 transition-colors",
                  isDark ? "border-[#1E293B] bg-[#090A0F]/90" : "border-slate-200 bg-white/95"
                )}>
                  {/* Quick Action Pills & Hints Bar */}
                  <div className="flex items-center justify-between gap-2 mb-2.5">
                    <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-0.5 flex-1 min-w-0">
                      <button
                        onClick={() => setShowTemplateSelector(!showTemplateSelector)}
                        className={cn(
                          "h-8 px-3 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap shrink-0 shadow-2xs hover:scale-102 active:scale-98",
                          showTemplateSelector
                            ? "bg-emerald-600 text-white shadow-xs shadow-emerald-500/30"
                            : (isDark
                                ? "bg-white/5 hover:bg-white/10 text-emerald-400 border border-emerald-500/30"
                                : "bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-300")
                        )}
                      >
                        <Zap className="w-3.5 h-3.5" />
                        <span>Templates (/)</span>
                      </button>

                      <button
                        onClick={() => {
                          setMessageInput("Hi " + activeChat.contactName.split(" ")[0] + ", thanks for reaching out! Let us schedule a quick call.");
                        }}
                        className={cn(
                          "h-8 px-3 rounded-xl text-xs font-medium border transition-all cursor-pointer whitespace-nowrap shrink-0 hover:scale-102 active:scale-98",
                          isDark
                            ? "bg-white/5 hover:bg-white/10 text-slate-300 border-white/5"
                            : "bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200"
                        )}
                      >
                        ⚡ Quick Greeting
                      </button>

                      <button
                        onClick={handleOpenQuotePicker}
                        className={cn(
                          "h-8 px-3 rounded-xl text-xs font-medium border transition-all cursor-pointer whitespace-nowrap shrink-0 hover:scale-102 active:scale-98",
                          isDark
                            ? "bg-white/5 hover:bg-white/10 text-slate-300 border-white/5"
                            : "bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200"
                        )}
                      >
                        ⚡ Share Quotation Link
                      </button>
                    </div>

                    <div className={cn("text-[11px] shrink-0 hidden lg:flex items-center gap-1 pl-2 whitespace-nowrap", isDark ? "text-slate-400" : "text-slate-500")}>
                      <span>Press</span>
                      <kbd className={cn("px-1.5 py-0.5 rounded-md text-[10px] font-mono border", isDark ? "bg-white/10 border-white/10 text-slate-300" : "bg-slate-100 border-slate-300 text-slate-700")}>
                        Enter ↵
                      </kbd>
                      <span>to send</span>
                    </div>
                  </div>

                  {/* Input row */}
                  {isRecording ? (
                    <div className={cn(
                      "flex items-center justify-between gap-3 border rounded-2xl p-2.5 transition-all shadow-md animate-in fade-in slide-in-from-bottom-1",
                      isDark ? "bg-red-950/20 border-red-500/30 text-white" : "bg-red-50 border-red-200 text-slate-900"
                    )}>
                      <div className="flex items-center gap-3">
                        <span className="relative flex h-3 w-3">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
                        </span>
                        <span className="text-xs font-bold text-red-500 tracking-wider font-mono">
                          {Math.floor(recordingDuration / 60)}:{(recordingDuration % 60) < 10 ? "0" : ""}{recordingDuration % 60}
                        </span>
                        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                          Recording voice message...
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={cancelRecording}
                          className="h-8 px-3 rounded-xl text-xs font-semibold flex items-center gap-1.5 bg-slate-200 hover:bg-slate-300 dark:bg-white/10 dark:hover:bg-white/20 text-slate-700 dark:text-slate-300 transition-colors"
                          title="Discard recording"
                        >
                          <Trash2 className="w-3.5 h-3.5 text-red-500" />
                          <span>Cancel</span>
                        </button>
                        <button
                          type="button"
                          onClick={sendRecording}
                          className="h-8 px-4 rounded-xl text-xs font-bold flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white shadow-xs transition-transform active:scale-95"
                          title="Send voice note"
                        >
                          <Send className="w-3.5 h-3.5" />
                          <span>Send</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className={cn(
                      "flex items-center gap-1.5 border rounded-2xl p-1.5 transition-all shadow-xs",
                      isDark
                        ? "bg-[#131B2E] border-[#1E293B] focus-within:border-emerald-500/60 focus-within:ring-2 focus-within:ring-emerald-500/10"
                        : "bg-slate-50 border-slate-200 focus-within:border-emerald-500 focus-within:bg-white focus-within:ring-2 focus-within:ring-emerald-500/10"
                    )}>
                      {/* Hidden file input */}
                      <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleFileUpload}
                        className="hidden"
                        accept="image/*,video/*,audio/*,application/pdf,.doc,.docx,.xls,.xlsx,.csv,.txt"
                      />

                      {/* Attachment Button */}
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className={cn(
                          "h-9 w-9 flex items-center justify-center rounded-xl transition-all cursor-pointer shrink-0 hover:scale-105 active:scale-95",
                          isDark ? "text-slate-400 hover:text-emerald-400 hover:bg-white/5" : "text-slate-500 hover:text-emerald-600 hover:bg-slate-200/60"
                        )}
                        title="Attach photos, videos, audio, or documents"
                      >
                        <Paperclip className="w-4 h-4" />
                      </button>

                      {/* Text Area */}
                      <textarea
                        rows={1}
                        value={messageInput}
                        onChange={handleInputChange}
                        onKeyDown={handleKeyDown}
                        placeholder='Type a message or press "/" for Meta templates...'
                        className={cn(
                          "flex-1 bg-transparent border-0 text-xs sm:text-sm focus:outline-none focus:ring-0 resize-none py-2 px-2 max-h-32 min-h-[38px] leading-relaxed",
                          isDark ? "text-white placeholder-slate-400" : "text-slate-900 placeholder-slate-400"
                        )}
                      />

                      {/* Add Emoji */}
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                          className={cn(
                            "h-9 w-9 flex items-center justify-center rounded-xl transition-all cursor-pointer shrink-0 hover:scale-105 active:scale-95",
                            showEmojiPicker
                              ? "bg-amber-500/20 text-amber-500"
                              : isDark ? "text-slate-400 hover:text-amber-400 hover:bg-white/5" : "text-slate-500 hover:text-amber-500 hover:bg-slate-200/60"
                          )}
                          title="Add emoji"
                        >
                          <Smile className="w-4 h-4" />
                        </button>

                        {showEmojiPicker && (
                          <div
                            ref={emojiPickerRef}
                            className={cn(
                              "absolute bottom-12 right-0 z-40 p-3 rounded-2xl shadow-2xl border w-72 backdrop-blur-md animate-in fade-in zoom-in-95 duration-150",
                              isDark ? "bg-[#131B2E]/95 border-[#1E293B] text-white" : "bg-white/95 border-slate-200 text-slate-900"
                            )}
                          >
                            <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-100 dark:border-slate-800">
                              <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400">Quick Emojis</span>
                              <button
                                type="button"
                                onClick={() => setShowEmojiPicker(false)}
                                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-0.5 cursor-pointer"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            <div className="grid grid-cols-8 gap-1.5 text-lg select-none">
                              {EMOJI_LIST.map((emoji) => (
                                <button
                                  key={emoji}
                                  type="button"
                                  onClick={() => {
                                    setMessageInput((prev) => prev + emoji);
                                  }}
                                  className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-slate-100 dark:hover:bg-white/10 transition-transform active:scale-125 cursor-pointer text-base"
                                >
                                  {emoji}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Dynamic Send / Mic Button (WhatsApp Web Style) */}
                      {messageInput.trim() ? (
                        <button
                          type="button"
                          onClick={() => handleSendMessage()}
                          disabled={isSending}
                          className="h-9 w-9 rounded-xl font-bold transition-all flex items-center justify-center shrink-0 cursor-pointer shadow-sm shadow-emerald-500/25 bg-gradient-to-r from-emerald-600 to-teal-500 text-white hover:scale-105 active:scale-95"
                          title="Send message"
                        >
                          {isSending ? (
                            <Loader2 className="w-4 h-4 animate-spin text-white" />
                          ) : (
                            <Send className="w-4 h-4" />
                          )}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={startRecording}
                          className={cn(
                            "h-9 w-9 rounded-xl font-bold transition-all flex items-center justify-center shrink-0 cursor-pointer shadow-sm hover:scale-105 active:scale-95",
                            isDark ? "bg-white/5 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" : "bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200"
                          )}
                          title="Record WhatsApp voice note"
                        >
                          <Mic className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center p-8 space-y-3">
                <MessageSquare className={cn("w-12 h-12 opacity-40", isDark ? "text-slate-600" : "text-slate-400")} />
                <h3 className={cn("font-bold text-base", isDark ? "text-white" : "text-slate-900")}>Select a conversation</h3>
                <p className={cn("text-xs text-center max-w-sm", isDark ? "text-slate-500" : "text-slate-500")}>
                  Choose a contact from the left list to view WhatsApp message thread, or wait for new inbound leads.
                </p>
              </div>
            )}
          </div>

          {/* ========================================================= */}
          {/* COLUMN C: CRM Context & Quick Actions Drawer (~300px)     */}
          {/* ========================================================= */}
          {showRightDrawer && activeChat && (
            <div className={cn(
              "w-72 xl:w-80 shrink-0 border-l flex flex-col overflow-y-auto scrollbar-thin transition-colors z-10",
              isDark ? "border-[#1E293B] bg-[#090A0F] scrollbar-thumb-slate-800" : "border-slate-200 bg-white scrollbar-thumb-slate-300"
            )}>
              {/* Header */}
              <div className={cn(
                "h-16 px-5 border-b flex items-center justify-between transition-colors shrink-0",
                isDark ? "border-[#1E293B] bg-[#0D0F17]/90" : "border-slate-200 bg-slate-50/90"
              )}>
                <div className="flex items-center gap-2">
                  <User className="w-4 h-4 text-emerald-500" />
                  <span className={cn("font-bold text-xs uppercase tracking-wider", isDark ? "text-white" : "text-slate-900")}>
                    CRM Lead Context
                  </span>
                </div>
                <button
                  onClick={() => setShowRightDrawer(false)}
                  className={cn(
                    "p-1.5 rounded-xl border transition-all cursor-pointer hover:scale-105 active:scale-95",
                    isDark ? "text-slate-400 hover:text-white border-white/5 hover:bg-white/5" : "text-slate-500 hover:text-slate-900 border-slate-200 hover:bg-slate-100"
                  )}
                  title="Close context panel"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Customer Profile Card */}
              <div className={cn("p-4 border-b space-y-3.5", isDark ? "border-[#1E293B]/60" : "border-slate-200")}>
                <div className="flex items-center gap-3">
                  <ContactAvatar
                    avatarUrl={activeChat.avatar_url}
                    name={activeChat.contactName}
                    initials={activeChat.avatarInitials}
                    color={activeChat.avatarColor}
                    size="w-12 h-12"
                    rounded="rounded-2xl"
                    textClass="text-base"
                  />
                  <div className="min-w-0 flex-1">
                    {!isEditingName ? (
                      <div className="flex items-center gap-1.5 group/name">
                        <h4 className={cn("font-bold text-sm truncate", isDark ? "text-white" : "text-slate-900")}>
                          {activeChat.contactName}
                        </h4>
                        <button
                          onClick={() => {
                            setEditedName(activeChat.contactName);
                            setIsEditingName(true);
                          }}
                          className={cn(
                            "opacity-60 group-hover/name:opacity-100 p-0.5 rounded transition-all cursor-pointer",
                            isDark ? "hover:bg-white/10 text-slate-400 hover:text-emerald-400" : "hover:bg-slate-100 text-slate-500 hover:text-emerald-600"
                          )}
                          title="Edit Contact Name"
                        >
                          <Edit2 className="w-3 h-3" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <input
                          type="text"
                          value={editedName}
                          onChange={(e) => setEditedName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleSaveContactName();
                            if (e.key === "Escape") setIsEditingName(false);
                          }}
                          autoFocus
                          className={cn(
                            "border rounded-lg px-2 py-1 text-xs focus:outline-none w-full shadow-2xs",
                            isDark ? "bg-[#131B2E] border-emerald-500/50 text-white" : "bg-white border-emerald-500 text-slate-900"
                          )}
                          placeholder="Contact name..."
                        />
                        <button
                          onClick={handleSaveContactName}
                          disabled={isSavingName}
                          className="p-1 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white transition-colors shrink-0"
                          title="Save name"
                        >
                          {isSavingName ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                        </button>
                        <button
                          onClick={() => setIsEditingName(false)}
                          className={cn(
                            "p-1 rounded-md transition-colors shrink-0",
                            isDark ? "bg-white/10 hover:bg-white/20 text-slate-400 hover:text-white" : "bg-slate-100 hover:bg-slate-200 text-slate-600 hover:text-slate-900"
                          )}
                          title="Cancel"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                    <p className={cn("text-xs truncate", isDark ? "text-slate-400" : "text-slate-500")}>
                      {activeChat.companyName || "Not Found"}
                    </p>
                    <span className={cn(
                      "inline-block mt-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold border shadow-2xs",
                      isDark ? "bg-indigo-500/10 text-indigo-400 border-indigo-500/20" : "bg-indigo-50 text-indigo-700 border-indigo-200"
                    )}>
                      High Intent Prospect
                    </span>
                  </div>
                </div>

                {/* Contact details */}
                <div className="space-y-2 pt-1 text-xs">
                  <div className={cn("flex items-center gap-2.5 p-2 rounded-xl border transition-colors", isDark ? "bg-white/5 border-white/5 text-slate-200" : "bg-slate-50 border-slate-200/80 text-slate-700")}>
                    <Phone className="w-3.5 h-3.5 shrink-0 text-emerald-500" />
                    <span className="font-mono text-[11px] truncate select-all">{activeChat.phone}</span>
                  </div>
                  <div className={cn("flex items-center gap-2.5 p-2 rounded-xl border transition-colors", isDark ? "bg-white/5 border-white/5 text-slate-200" : "bg-slate-50 border-slate-200/80 text-slate-700")}>
                    <Mail className="w-3.5 h-3.5 shrink-0 text-indigo-500" />
                    <span className="truncate select-all">{activeChat.email || "Not Found"}</span>
                  </div>
                  <div className={cn("flex items-center gap-2.5 p-2 rounded-xl border transition-colors", isDark ? "bg-white/5 border-white/5 text-slate-200" : "bg-slate-50 border-slate-200/80 text-slate-700")}>
                    <Building2 className="w-3.5 h-3.5 shrink-0 text-amber-500" />
                    <span className="truncate">{activeChat.companyName || "Not Found"}</span>
                  </div>
                </div>


              </div>

              {/* Deal Status & Pipeline */}
              <div className={cn("p-4 border-b space-y-3.5", isDark ? "border-[#1E293B]/60" : "border-slate-200")}>
                <div className="flex items-center justify-between">
                  <span className={cn("font-bold text-xs flex items-center gap-1.5", isDark ? "text-slate-300" : "text-slate-700")}>
                    <Handshake className="w-4 h-4 text-indigo-500" />
                    Pipeline & Deal
                  </span>
                  <span className={cn(
                    "text-[10px] font-bold px-2 py-0.5 rounded-full border shadow-2xs",
                    isDark ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" : "text-emerald-700 bg-emerald-50 border-emerald-200"
                  )}>
                    Active
                  </span>
                </div>

                {/* Deal Stage Selector */}
                <div>
                  <label className={cn("block text-[11px] font-semibold mb-1", isDark ? "text-slate-400" : "text-slate-600")}>
                    Current Deal Stage
                  </label>
                  <select
                    value={activeChat.dealStage}
                    onChange={(e) => handleStageChange(e.target.value)}
                    className={cn(
                      "w-full h-9 border rounded-xl px-3 text-xs focus:outline-none focus:border-emerald-500 cursor-pointer transition-colors shadow-2xs font-medium",
                      isDark ? "bg-[#131B2E] border-[#1E293B] text-white" : "bg-slate-50 border-slate-200 text-slate-900 focus:bg-white"
                    )}
                  >
                    <option value="Discovery">Discovery</option>
                    <option value="Qualified">Qualified</option>
                    <option value="Proposal">Proposal</option>
                    <option value="Negotiation">Negotiation</option>
                    <option value="Won">Won</option>
                    <option value="Lost">Lost</option>
                  </select>
                </div>

                {/* Deal Value */}
                <div>
                  <label className={cn("block text-[11px] font-semibold mb-1", isDark ? "text-slate-400" : "text-slate-600")}>
                    Deal Value (INR)
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={formatCurrency(activeChat.dealValue)}
                      onChange={(e) => handleDealValueChange(e.target.value)}
                      className={cn(
                        "w-full h-9 border rounded-xl px-3 text-xs font-bold focus:outline-none focus:border-emerald-500 font-mono transition-colors shadow-2xs",
                        isDark ? "bg-[#131B2E] border-[#1E293B] text-emerald-400" : "bg-slate-50 border-slate-200 text-emerald-700 focus:bg-white"
                      )}
                    />
                  </div>
                </div>

                <div className={cn("flex items-center justify-between text-xs pt-1 border-t", isDark ? "border-white/5 text-slate-400" : "border-slate-200/80 text-slate-500")}>
                  <span>Target Close Date:</span>
                  <span className={cn("font-semibold", isDark ? "text-slate-200" : "text-slate-800")}>{activeChat.dealCloseDate}</span>
                </div>
              </div>

              {/* Quick Actions Panel */}
              <div className={cn("p-4 border-b space-y-2.5", isDark ? "border-[#1E293B]/60" : "border-slate-200")}>
                <span className={cn("font-bold text-xs block mb-1 uppercase tracking-wider", isDark ? "text-slate-400" : "text-slate-500")}>
                  Internal Notes & CRM
                </span>

                <button
                  onClick={() => setShowNewNoteModal(true)}
                  className={cn(
                    "w-full h-9 flex items-center justify-center gap-2 px-3 rounded-xl border text-xs font-semibold transition-all cursor-pointer shadow-2xs hover:scale-101 active:scale-98",
                    isDark ? "bg-white/5 hover:bg-white/10 text-slate-200 border-[#1E293B]" : "bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200"
                  )}
                >
                  <Plus className="w-3.5 h-3.5 text-emerald-500" />
                  <span>Add Internal Note</span>
                </button>
              </div>

              {/* Notes & Activity Timeline */}
              <div className="p-4 flex-1 space-y-3">
                <div className="flex items-center justify-between">
                  <span className={cn("font-bold text-xs uppercase tracking-wider", isDark ? "text-slate-400" : "text-slate-500")}>
                    Activity & Notes ({activeChat.notes.length})
                  </span>
                </div>

                <div className="space-y-2.5">
                  {activeChat.notes.length === 0 ? (
                    <div className={cn("p-4 rounded-xl border border-dashed text-center text-xs", isDark ? "border-white/10 text-slate-400" : "border-slate-200 text-slate-500")}>
                      No internal notes recorded yet. Click &quot;Add Internal Note&quot; above.
                    </div>
                  ) : (
                    activeChat.notes.map((note) => (
                      <div
                        key={note.id}
                        className={cn(
                          "p-3 rounded-xl border text-xs space-y-1.5 transition-colors",
                          isDark ? "bg-[#131B2E]/60 border-[#1E293B]" : "bg-slate-50 border-slate-200"
                        )}
                      >
                        <p className={cn("leading-relaxed", isDark ? "text-slate-200" : "text-slate-800")}>{note.text}</p>
                        <div className={cn("flex items-center justify-between text-[10px] pt-1 border-t", isDark ? "border-white/5 text-slate-400" : "border-slate-200 text-slate-500")}>
                          <span className="font-semibold text-emerald-600 dark:text-emerald-400">{note.author}</span>
                          <span>{note.timestamp}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

        </div>
      </div>

      {/* Modal: Add Internal Note */}
      {showNewNoteModal && activeChat && (
        <div className={cn(
          "fixed inset-0 z-50 backdrop-blur-xs flex items-center justify-center p-4",
          isDark ? "bg-black/80" : "bg-slate-900/40"
        )}>
          <div className={cn(
            "border rounded-2xl p-5 max-w-md w-full shadow-2xl animate-in fade-in zoom-in-95",
            isDark ? "bg-[#131B2E] border-[#1E293B]" : "bg-white border-slate-200 text-slate-900"
          )}>
            <div className="flex items-center justify-between mb-4">
              <h3 className={cn("font-bold text-sm flex items-center gap-2", isDark ? "text-white" : "text-slate-900")}>
                <Plus className="w-4 h-4 text-emerald-500" />
                Add Internal Note for {activeChat.contactName}
              </h3>
              <button
                onClick={() => setShowNewNoteModal(false)}
                className={isDark ? "text-slate-400 hover:text-white" : "text-slate-400 hover:text-slate-700"}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddNoteSubmit} className="space-y-4">
              <div>
                <textarea
                  rows={4}
                  value={newNoteText}
                  onChange={(e) => setNewNoteText(e.target.value)}
                  placeholder="Record customer preferences, budget discussion, or next steps..."
                  className={cn(
                    "w-full border rounded-xl p-3 text-xs focus:outline-none focus:border-emerald-500",
                    isDark ? "bg-[#090A0F] border-[#1E293B] text-white placeholder-slate-500" : "bg-slate-50 border-slate-200 text-slate-900 placeholder-slate-400 focus:bg-white"
                  )}
                  autoFocus
                />
              </div>

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowNewNoteModal(false)}
                  className={cn("px-3.5 py-2 rounded-xl text-xs font-medium", isDark ? "text-slate-300 hover:bg-white/5" : "text-slate-600 hover:bg-slate-100")}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!newNoteText.trim()}
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white transition-all disabled:opacity-50"
                >
                  Save Note
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* WhatsApp QR Scan Modal */}
            {/* Modal: Select Quotation to Send */}
      {showQuotePickerModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className={cn(
            "w-full max-w-lg rounded-2xl shadow-2xl border overflow-hidden flex flex-col max-h-[85vh]",
            isDark ? "bg-[#0D0F17] border-[#1E293B]" : "bg-white border-slate-200"
          )}>
            <div className="flex items-center justify-between p-4 border-b border-slate-100 dark:border-white/10">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400">
                  <FileText className="w-5 h-5" />
                </div>
                <div>
                  <h3 className={cn("text-sm font-bold", isDark ? "text-white" : "text-slate-900")}>
                    Send Quotation to {activeChat?.contactName || "Contact"}
                  </h3>
                  <p className="text-xs text-slate-500">
                    Select a quotation from your records or send a custom quote PDF
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowQuotePickerModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto space-y-3 flex-1 scrollbar-thin">
              {/* Option to upload custom PDF directly */}
              <div className={cn(
                "p-3 rounded-xl border border-dashed flex items-center justify-between gap-3",
                isDark ? "border-white/15 bg-white/5" : "border-slate-300 bg-slate-50/50"
              )}>
                <div className="flex items-center gap-2.5">
                  <File className="w-4 h-4 text-emerald-500" />
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Send custom PDF file from device
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowQuotePickerModal(false);
                    fileInputRef.current?.click();
                  }}
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold shadow-2xs cursor-pointer"
                >
                  Upload PDF
                </button>
              </div>

              <div className="pt-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block mb-2">
                  Existing Quotations ({availableQuotes.length})
                </span>

                {loadingQuotes ? (
                  <div className="py-8 flex flex-col items-center justify-center gap-2 text-slate-400 text-xs">
                    <Loader2 className="w-5 h-5 animate-spin text-emerald-500" />
                    <span>Loading quotations...</span>
                  </div>
                ) : availableQuotes.length === 0 ? (
                  <div className="py-8 text-center text-xs text-slate-400">
                    No quotations found in CRM. You can create one in Quotations section or upload a PDF.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {availableQuotes.map((q) => (
                      <div
                        key={q.id}
                        className={cn(
                          "p-3 rounded-xl border flex items-center justify-between gap-3 transition-all hover:scale-[1.005]",
                          isDark ? "bg-white/5 border-white/10 hover:border-emerald-500/50" : "bg-white border-slate-200 hover:border-emerald-400 shadow-2xs"
                        )}
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs font-bold text-slate-900 dark:text-white">
                              {q.invoice_number || q.bill_number || `QT-${q.id}`}
                            </span>
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-slate-300">
                              {q.status || "Quote"}
                            </span>
                          </div>
                          <p className="text-xs text-slate-500 truncate mt-0.5">
                            {q.client_name || q.recipient_name || "Client"} {q.subject ? `• ${q.subject}` : ""}
                          </p>
                          <p className="text-xs font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">
                            {formatCurrency(q.total_amount || 0)}
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleSendSelectedQuote(q)}
                          className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold shadow-2xs transition-all flex items-center gap-1.5 shrink-0 cursor-pointer"
                        >
                          <Send className="w-3 h-3" />
                          <span>Send Quote</span>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <WhatsAppQRModal
        isOpen={showQRModal}
        onClose={() => setShowQRModal(false)}
        onStatusChange={(status, phone) => {
          setQrStatus(status);
          setQrPhone(phone);
        }}
      />

      {/* Start New WhatsApp Chat Modal */}
      <NewWhatsAppChatModal
        isOpen={showNewChatModal}
        onClose={() => setShowNewChatModal(false)}
        onChatInitiated={handleChatInitiated}
      />

      {/* Image Preview Lightbox Modal */}
      {selectedImagePreview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in"
          onClick={() => setSelectedImagePreview(null)}
        >
          <div
            className="relative max-w-4xl max-h-[90vh] bg-transparent rounded-2xl overflow-hidden shadow-2xl flex flex-col items-center"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="absolute top-3 right-3 flex items-center gap-2 z-10">
              <a
                href={selectedImagePreview}
                download
                target="_blank"
                rel="noopener noreferrer"
                className="p-2 rounded-full bg-black/60 hover:bg-black/80 text-white transition-colors"
                title="Download full size"
              >
                <Download className="w-5 h-5" />
              </a>
              <button
                type="button"
                onClick={() => setSelectedImagePreview(null)}
                className="p-2 rounded-full bg-black/60 hover:bg-black/80 text-white transition-colors cursor-pointer"
                title="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <img
              src={selectedImagePreview}
              alt="WhatsApp Preview"
              className="max-w-full max-h-[85vh] object-contain rounded-xl shadow-2xl"
            />
          </div>
        </div>
      )}
    </div>
  );
}
