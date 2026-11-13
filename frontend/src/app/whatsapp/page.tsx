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
  Pencil,
  Ban,
  Info,
  Copy,
  CornerUpLeft,
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
  Volume2,
  UserPlus,
  UserX,
  Pin,
  Archive,
  CheckSquare,
  Square,
  LogOut,
  Film
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
  reaction?: string | null;
  isDeleted?: boolean;
  isEdited?: boolean;
  metaMessageId?: string | null;
  mediaBase64?: string | null;
  quotedContext?: { sender: string; text: string } | null;
  attachment?: {
    type: "pdf" | "image" | "audio" | "document" | "video" | "sticker" | "gif";
    name: string;
    size?: string;
    url?: string;
  };
}


function isValidImageUrl(url?: string | null): boolean {
  if (!url) return false;
  const lower = url.toLowerCase().trim();
  if (
    lower.includes("voice_") ||
    lower.endsWith(".mp4") ||
    lower.endsWith(".ogg") ||
    lower.endsWith(".wav") ||
    lower.endsWith(".bin") ||
    lower.endsWith(".pdf") ||
    lower.endsWith(".docx")
  ) {
    return false;
  }
  return lower.startsWith("http") || lower.startsWith("data:image") || lower.startsWith("/") || lower.includes("googleusercontent");
}

function parseQuotedReply(rawText?: string | null): {
  hasQuote: boolean;
  quotedSender: string;
  quotedText: string;
  body: string;
} {
  if (!rawText) return { hasQuote: false, quotedSender: "", quotedText: "", body: "" };
  const raw = rawText.trim();
  const match = raw.match(/^>\s*\*?([^\n*:]+?)\*?:\s*([^\n]+?)\n+([\s\S]*)$/);
  if (match) {
    return {
      hasQuote: true,
      quotedSender: match[1].trim(),
      quotedText: match[2].trim(),
      body: match[3].trim()
    };
  }
  if (raw.startsWith(">")) {
    const doubleNewlineIdx = raw.indexOf("\n\n");
    if (doubleNewlineIdx !== -1) {
      const header = raw.slice(1, doubleNewlineIdx).trim();
      const body = raw.slice(doubleNewlineIdx + 2).trim();
      const colonIdx = header.indexOf(":");
      if (colonIdx !== -1) {
        const sender = header.slice(0, colonIdx).replace(/\*/g, "").trim();
        const snippet = header.slice(colonIdx + 1).trim();
        return {
          hasQuote: true,
          quotedSender: sender || "Contact",
          quotedText: snippet,
          body
        };
      }
    }
  }
  return { hasQuote: false, quotedSender: "", quotedText: "", body: raw };
}

function formatLastMessagePreview(text?: any): string {
  if (!text) return "";
  const str = typeof text === "string" ? text : (text?.preview || text?.text || text?.body || text?.message || "");
  if (!str || typeof str !== "string") return "";
  const raw = str.trim();
  if (raw.startsWith(">")) {
    const parsed = parseQuotedReply(raw);
    if (parsed.hasQuote && parsed.body) {
      return parsed.body;
    }
    const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
    const nonQuotes = lines.filter((l) => !l.startsWith(">") && !l.startsWith("*"));
    if (nonQuotes.length > 0) {
      return nonQuotes.join(" ");
    }
    return raw.replace(/^>\s*\*?[^*:]+\*?:\s*/, "").trim();
  }
  return raw;
}

function cleanDisplayCaption(text?: any, fileName?: string | null): string {
  if (!text || typeof text !== "string") return "";
  const t = text.trim();
  const lower = t.toLowerCase();

  // Strip all bracketed system markers like [video], [VIDEO], [sticker], [photo], [gif], [attachment], etc.
  if (/^\[(video|photo|image|attachment|media|sticker|voice note|document|audio|gif|contact card|location|empty message)\]$/i.test(t)) return "";
  if (/^(video|photo|image|attachment|media|sticker|gif)$/i.test(lower)) return "";
  if (lower.startsWith("📎 ") && (lower.includes("attachment") || lower.includes("document"))) return "";
  if (fileName && (t === fileName.trim() || t === `📎 ${fileName.trim()}` || lower === fileName.trim().toLowerCase())) return "";
  if (/^🎤\s*Voice message/i.test(t)) return "";
  if (/^📷\s*Photo/i.test(t)) return "";
  if (/^🎥\s*Video/i.test(t)) return "";
  if (/^📄\s*.+$/i.test(t) && fileName && t.includes(fileName)) return "";

  const dummyPlaceholders = [
    "[image attachment]",
    "[voice note]",
    "[document attachment]",
    "[sticker]",
    "[contact card]",
    "[location]",
    "[attachment received]",
    "[video]",
    "[photo]",
    "[gif]",
    "[image]",
    "[attachment]",
    "[media]",
    "[empty message]",
    "📷 photo",
    "🎥 video",
    "🎤 voice message",
    "🎵 audio",
    "document",
    "image attachment",
    "voice note",
    "sticker",
    "video",
    "gif",
    "photo"
  ];
  if (dummyPlaceholders.includes(lower)) return "";
  return t;
}

function getSmartMediaFallback(url?: string | null, step: number = 1): string | null {
  if (!url) return null;
  const fn = url.split("/").pop();
  if (!fn) return null;
  const isHttps = typeof window !== "undefined" && window.location.protocol === "https:";
  if (isHttps) {
    if (step === 1) return `https://zigmaa-whatsapp-bridge.onrender.com/media/whatsapp/${fn}`;
    return null;
  }
  if (step === 1) return `http://localhost:5001/media/whatsapp/${fn}`;
  if (step === 2) return `https://zigmaa-whatsapp-bridge.onrender.com/media/whatsapp/${fn}`;
  return null;
}

const WAVEFORM_BARS = [
  4, 4, 6, 8, 12, 18, 22, 18, 14, 10, 8, 10, 14, 16, 14, 12, 10, 8, 10, 12, 14, 12, 10, 8, 8, 6, 6, 4, 4, 4, 4, 4
];

function VoiceNotePlayer({
  audioUrl,
  isOutbound,
  isDark,
  durationHint = 0,
  avatarUrl,
  contactName,
  senderAvatarUrl,
  timeLabel,
  status
}: {
  audioUrl: string;
  isOutbound: boolean;
  isDark: boolean;
  durationHint?: number;
  avatarUrl?: string | null;
  contactName?: string | null;
  senderAvatarUrl?: string | null;
  timeLabel?: string;
  status?: string;
}) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(durationHint);
  const [speed, setSpeed] = useState<1 | 1.5 | 2>(1);
  const [senderImgFailed, setSenderImgFailed] = useState(false);
  const [contactImgFailed, setContactImgFailed] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (durationHint > 0 && duration <= 0) {
      setDuration(durationHint);
    }
  }, [durationHint, duration]);

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play().then(() => {
        setIsPlaying(true);
      }).catch((err) => {
        console.warn("Audio play notice:", err?.message || err);
      });
    }
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
      const d = audioRef.current.duration;
      if (d && isFinite(d) && d > 0) {
        setDuration(Math.round(d));
      } else if (duration <= 0 && durationHint && durationHint > 0) {
        setDuration(durationHint);
      }
    }
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      const d = audioRef.current.duration;
      if (d && isFinite(d) && d > 0) {
        setDuration(Math.round(d));
      } else if (durationHint && durationHint > 0) {
        setDuration(durationHint);
      }
    }
  };

  const handleEnded = () => {
    setIsPlaying(false);
    setCurrentTime(0);
    if (audioRef.current) {
      audioRef.current.currentTime = 0;
    }
  };

  const handleCycleSpeed = (e: React.MouseEvent) => {
    e.stopPropagation();
    const nextSpeed: 1 | 1.5 | 2 = speed === 1 ? 1.5 : (speed === 1.5 ? 2 : 1);
    setSpeed(nextSpeed);
    if (audioRef.current) {
      audioRef.current.playbackRate = nextSpeed;
    }
  };

  const handleWaveformSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, clickX / rect.width));
    const effective = duration > 0 ? duration : (durationHint > 0 ? durationHint : 10);
    const target = ratio * effective;
    if (audioRef.current) {
      audioRef.current.currentTime = target;
      setCurrentTime(target);
    }
  };

  const formatSecs = (sec: number) => {
    if (isNaN(sec) || !isFinite(sec) || sec <= 0) return "0:00";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  };

  const effectiveDuration = duration > 0 ? duration : (durationHint > 0 ? durationHint : 0);
  const progressRatio = effectiveDuration > 0 ? Math.min(1, currentTime / effectiveDuration) : 0;

  const hasSenderAvatar = Boolean(senderAvatarUrl && isValidImageUrl(senderAvatarUrl) && !senderImgFailed);
  const hasContactAvatar = Boolean(avatarUrl && isValidImageUrl(avatarUrl) && !contactImgFailed);
  const displaySecs = isPlaying ? currentTime : (effectiveDuration > 0 ? effectiveDuration : (durationHint && durationHint > 0 ? durationHint : 0));
  const isSpeedPillActive = isPlaying;

  return (
    <div className="w-[270px] sm:w-[295px] max-w-full select-none flex flex-col justify-between gap-1">
      <audio
        ref={audioRef}
        src={audioUrl}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={handleEnded}
        onError={(e) => {
          setIsPlaying(false);
          const audio = e.currentTarget;
          if (!audio.dataset.step) {
            audio.dataset.step = "1";
            const fallback = getSmartMediaFallback(audioUrl, 1);
            if (fallback) {
              audio.src = fallback;
              return;
            }
          }
          if (audio.dataset.step === "1") {
            audio.dataset.step = "2";
            const fallback = getSmartMediaFallback(audioUrl, 2);
            if (fallback) {
              audio.src = fallback;
              return;
            }
          }
        }}
        preload="metadata"
      />

      {/* Main player row: [Avatar OR Speed Pill] -> [Play Button] -> [Waveform Scrubber] */}
      <div className="flex items-center gap-2">
        {/* Left Side: Avatar with mic badge OR Speed Pill when playing */}
        <div className="shrink-0 flex items-center justify-center">
          {isSpeedPillActive ? (
            <button
              type="button"
              onClick={handleCycleSpeed}
              className={cn(
                "w-10 h-8 rounded-full font-bold text-xs flex items-center justify-center transition-all cursor-pointer shadow-xs select-none",
                isDark
                  ? "bg-black/50 hover:bg-black/70 text-white border border-white/10"
                  : "bg-black/15 hover:bg-black/25 text-slate-800 border border-black/10"
              )}
              title="Cycle playback speed (1x, 1.5x, 2x)"
            >
              {speed}x
            </button>
          ) : isOutbound ? (
            /* Outbound (Me): Linked WhatsApp Avatar with mic badge */
            <div className="relative w-9 h-9">
              <div className="w-9 h-9 rounded-full bg-emerald-700 text-white flex items-center justify-center font-bold text-xs shadow-xs overflow-hidden">
                {hasSenderAvatar ? (
                  <img
                    src={senderAvatarUrl!}
                    alt=""
                    className="w-full h-full object-cover"
                    onError={() => setSenderImgFailed(true)}
                  />
                ) : (
                  <User className="w-4 h-4 text-white/90" />
                )}
              </div>
              <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-[#00a884] text-white flex items-center justify-center shadow-xs border-2 border-[#D9FDD3] dark:border-[#005c4b]">
                <Mic className="w-2 h-2 fill-current" />
              </div>
            </div>
          ) : (
            /* Inbound (Contact): Contact Avatar with mic badge */
            <div className="relative w-9 h-9">
              <div className="w-9 h-9 rounded-full bg-slate-300 dark:bg-slate-700 text-slate-800 dark:text-slate-200 flex items-center justify-center font-bold text-xs shadow-xs overflow-hidden">
                {hasContactAvatar ? (
                  <img
                    src={avatarUrl!}
                    alt=""
                    className="w-full h-full object-cover"
                    onError={() => setContactImgFailed(true)}
                  />
                ) : (
                  <span>{(contactName || "U").charAt(0).toUpperCase()}</span>
                )}
              </div>
              <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-[#00a884] text-white flex items-center justify-center shadow-xs border-2 border-white dark:border-[#202c33]">
                <Mic className="w-2 h-2 fill-current" />
              </div>
            </div>
          )}
        </div>

        {/* Play / Pause button */}
        <button
          type="button"
          onClick={togglePlay}
          className={cn(
            "w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-transform active:scale-95 cursor-pointer",
            isDark ? "text-white hover:bg-white/10" : "text-slate-800 hover:bg-black/5"
          )}
        >
          {isPlaying ? (
            <Pause className="w-5 h-5 fill-current" />
          ) : (
            <Play className="w-5 h-5 fill-current ml-0.5" />
          )}
        </button>

        {/* Waveform Scrubber with Middle-Center Dot (Real WhatsApp Web Image 6) */}
        <div
          onClick={handleWaveformSeek}
          className="relative min-w-0 flex-1 h-7 flex items-center cursor-pointer select-none group px-1"
          title="Click to seek"
        >
          {/* Waveform vertical bars */}
          <div className="w-full flex items-center justify-between gap-[2px] h-5 pointer-events-none">
            {WAVEFORM_BARS.map((h, idx) => {
              const barProgress = idx / (WAVEFORM_BARS.length - 1);
              const isPlayed = progressRatio >= barProgress;
              const barHeight = Math.max(4, Math.round((h / 24) * 20));
              return (
                <div
                  key={idx}
                  className={cn(
                    "flex-1 rounded-full transition-colors duration-100",
                    isPlayed
                      ? (isDark ? "bg-[#53bdeb]" : "bg-[#00a884]")
                      : (isDark ? "bg-[#8696a0]/40" : "bg-black/25")
                  )}
                  style={{ height: `${barHeight}px` }}
                />
              );
            })}
          </div>

          {/* Scrubber round dot - strictly locked to middle center (top-1/2 -translate-y-1/2) */}
          <div
            className={cn(
              "absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full pointer-events-none transition-[left] duration-100 shadow-xs",
              isDark ? "bg-[#53bdeb]" : "bg-[#00a884]"
            )}
            style={{ left: `${Math.max(1, Math.min(99, progressRatio * 100))}%` }}
          />
        </div>
      </div>

      {/* Bottom status row: Duration alone on left, Time + Double Tick on right */}
      <div className={cn(
        "flex items-center justify-between text-[11px] pt-0.5 font-mono",
        isDark ? "text-slate-400" : "text-slate-500"
      )}>
        <div className="pl-1">
          <span>{formatSecs(displaySecs)}</span>
        </div>

        {timeLabel && (
          <div className="flex items-center gap-1 pr-1 font-sans text-[10px] whitespace-nowrap shrink-0">
            <span>{timeLabel}</span>
            {isOutbound && (
              <CheckCheck className={cn("w-3.5 h-3.5 shrink-0", status === "READ" ? "text-[#53bdeb]" : "text-slate-400")} />
            )}
          </div>
        )}
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
  last_direction?: string;
  last_status?: string;
  is_pinned?: boolean;
  is_archived?: boolean;
  is_blocked?: boolean;
  lead_id?: string;
  is_converted?: boolean;
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


const QUICK_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

function MessageBubbleContainer({
  msg,
  isOutbound,
  isDark,
  isNearBottom = false,
  activeContextMenuId,
  activeReactionMenuId,
  setActiveContextMenuId,
  setActiveReactionMenuId,
  onReact,
  onReply,
  onCopy,
  onEdit,
  onDelete,
  onInfo,
  children
}: {
  msg: WhatsAppMessage;
  isOutbound: boolean;
  isDark: boolean;
  isNearBottom?: boolean;
  activeContextMenuId: string | null;
  activeReactionMenuId: string | null;
  setActiveContextMenuId: (id: string | null) => void;
  setActiveReactionMenuId: (id: string | null) => void;
  onReact: (emoji: string) => void;
  onReply: () => void;
  onCopy: () => void;
  onEdit?: () => void;
  onDelete: () => void;
  onInfo: () => void;
  children: React.ReactNode;
}) {
  const [showMoreEmojis, setShowMoreEmojis] = useState(false);
  const showContext = activeContextMenuId === msg.id;
  const showReaction = activeReactionMenuId === msg.id;

  if (msg.isDeleted) {
    return (
      <div className={cn("flex w-full my-0", isOutbound ? "justify-end" : "justify-start")}>
        <div
          className={cn(
            "rounded-2xl px-3.5 py-2 text-xs transition-all shadow-2xs border flex items-center gap-2 italic select-none",
            isOutbound
              ? (isDark ? "bg-[#005c4b]/40 border-emerald-600/20 text-white/70" : "bg-[#D9FDD3]/50 border-[#C2EBC0] text-slate-500")
              : (isDark ? "bg-[#202c33]/40 border-white/5 text-slate-400" : "bg-white border-slate-200 text-slate-500")
          )}
        >
          <Ban className="w-3.5 h-3.5 text-slate-400" />
          <span>{isOutbound ? "You deleted this message" : "This message was deleted"}</span>
          <span className="text-[10px] ml-1 not-italic opacity-60">{msg.timeLabel}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex w-full my-0", isOutbound ? "justify-end" : "justify-start")}>
      <div className="relative group max-w-[85%] sm:max-w-[70%] w-fit">
        {/* Floating Quick Reaction Bar (WhatsApp style: appears above or below bubble on trigger) */}
        {showReaction && (
          <div
            data-msg-menu="true"
            className={cn(
              "absolute z-40 flex items-center gap-1 px-2.5 py-1.5 rounded-full shadow-xl border animate-in fade-in zoom-in-95 duration-150 select-none",
              isNearBottom ? "-bottom-12" : "-top-11",
              isOutbound ? "right-0" : "left-0",
              isDark ? "bg-[#233138] border-white/10 text-white" : "bg-white border-slate-200 text-slate-800"
            )}
            onClick={(e) => e.stopPropagation()}
          >
            {QUICK_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => {
                  onReact(emoji);
                  setActiveReactionMenuId(null);
                }}
                className="w-8 h-8 rounded-full hover:bg-black/10 dark:hover:bg-white/10 flex items-center justify-center text-lg transition-transform hover:scale-125 active:scale-95 cursor-pointer"
              >
                {emoji}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setShowMoreEmojis(!showMoreEmojis)}
              className="w-7 h-7 rounded-full hover:bg-black/10 dark:hover:bg-white/10 flex items-center justify-center text-xs opacity-70 hover:opacity-100 transition-colors cursor-pointer"
              title="More emojis"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Hover Reaction Trigger Smiley Button (Photo 1 & 2 WhatsApp style) */}
        <button
          type="button"
          data-msg-menu="true"
          onClick={(e) => {
            e.stopPropagation();
            setActiveReactionMenuId(showReaction ? null : msg.id);
            setActiveContextMenuId(null);
          }}
          className={cn(
            "absolute top-1/2 -translate-y-1/2 z-20 w-7 h-7 rounded-full flex items-center justify-center transition-all cursor-pointer shadow-xs opacity-0 group-hover:opacity-100",
            isOutbound ? "-left-9" : "-right-9",
            isDark
              ? "bg-[#233138] text-slate-300 hover:text-white border border-white/10 hover:bg-[#2e3e47]"
              : "bg-white text-slate-500 hover:text-slate-800 border border-slate-200 hover:bg-slate-50"
          )}
          title="React to message"
        >
          <Smile className="w-4 h-4" />
        </button>

        {/* Hover Chevron / Action Dropdown Trigger - Strictly anchored to THIS bubble! */}
        <button
          type="button"
          data-msg-menu="true"
          onClick={(e) => {
            e.stopPropagation();
            setActiveContextMenuId(showContext ? null : msg.id);
            setActiveReactionMenuId(null);
          }}
          className={cn(
            "absolute top-1.5 right-1.5 z-20 w-6 h-6 rounded-full flex items-center justify-center transition-all cursor-pointer shadow-xs",
            showContext
              ? "opacity-100 bg-black/25 text-white"
              : "opacity-0 group-hover:opacity-100 bg-black/20 hover:bg-black/40 text-white dark:bg-white/15 dark:hover:bg-white/25"
          )}
          title="Message options"
        >
          <ChevronDown className="w-4 h-4" />
        </button>

        {/* Context Menu Dropdown - Opens UPWARDS if near bottom, DOWNWARDS otherwise */}
        {showContext && (
          <div
            data-msg-menu="true"
            className={cn(
              "absolute z-50 w-44 rounded-xl shadow-2xl border py-1.5 animate-in fade-in zoom-in-95 duration-100 select-none",
              isNearBottom ? "bottom-full mb-1.5" : "top-full mt-1.5",
              isOutbound ? "right-1" : "left-1",
              isDark ? "bg-[#233138] border-white/10 text-slate-100" : "bg-white border-slate-200 text-slate-800"
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => {
                onInfo();
                setActiveContextMenuId(null);
              }}
              className="w-full px-3.5 py-2 text-xs flex items-center gap-2.5 hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer transition-colors"
            >
              <Info className="w-4 h-4 opacity-70" />
              <span>Message info</span>
            </button>
            <button
              type="button"
              onClick={() => {
                onReply();
                setActiveContextMenuId(null);
              }}
              className="w-full px-3.5 py-2 text-xs flex items-center gap-2.5 hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer transition-colors"
            >
              <CornerUpLeft className="w-4 h-4 opacity-70" />
              <span>Reply</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveReactionMenuId(msg.id);
                setActiveContextMenuId(null);
              }}
              className="w-full px-3.5 py-2 text-xs flex items-center gap-2.5 hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer transition-colors"
            >
              <Smile className="w-4 h-4 opacity-70" />
              <span>React</span>
            </button>
            <button
              type="button"
              onClick={() => {
                onCopy();
                setActiveContextMenuId(null);
              }}
              className="w-full px-3.5 py-2 text-xs flex items-center gap-2.5 hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer transition-colors"
            >
              <Copy className="w-4 h-4 opacity-70" />
              <span>Copy</span>
            </button>
            {onEdit && (
              <button
                type="button"
                onClick={() => {
                  onEdit();
                  setActiveContextMenuId(null);
                }}
                className="w-full px-3.5 py-2 text-xs flex items-center gap-2.5 hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer transition-colors"
              >
                <Pencil className="w-4 h-4 opacity-70" />
                <span>Edit</span>
              </button>
            )}
            <div className="h-px bg-slate-200 dark:bg-white/10 my-1" />
            <button
              type="button"
              onClick={() => {
                onDelete();
                setActiveContextMenuId(null);
              }}
              className="w-full px-3.5 py-2 text-xs flex items-center gap-2.5 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 cursor-pointer transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              <span>Delete message</span>
            </button>
          </div>
        )}

        {/* Bubble Content */}
        {children}

        {/* Reaction Pill Badge - Anchored to THIS bubble! */}
        {msg.reaction && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onReact(msg.reaction!);
            }}
            className={cn(
              "absolute -bottom-2.5 px-1.5 py-0.5 rounded-full text-xs shadow-sm border flex items-center gap-1 z-20 cursor-pointer transition-transform hover:scale-110 select-none",
              isOutbound ? "right-2" : "left-2",
              isDark ? "bg-[#202c33] border-white/10 text-white" : "bg-white border-slate-200 text-slate-800"
            )}
            title="Click to remove reaction"
          >
            <span>{msg.reaction}</span>
          </button>
        )}
      </div>
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
  const [filterTab, setFilterTab] = useState<"All" | "Unread" | "Pinned" | "Archived">("All");
  const [isLoggingOutWhatsApp, setIsLoggingOutWhatsApp] = useState(false);
  const [isSearchInChatOpen, setIsSearchInChatOpen] = useState(false);
  const [chatSearchQuery, setChatSearchQuery] = useState("");
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedMsgIds, setSelectedMsgIds] = useState<Set<string>>(new Set());
  const [messageInput, setMessageInput] = useState("");
  const [showTemplateSelector, setShowTemplateSelector] = useState(false);
  const [showRightDrawer, setShowRightDrawer] = useState(true);
  const [showNewNoteModal, setShowNewNoteModal] = useState(false);
  const [newNoteText, setNewNoteText] = useState("");
  const [showQuotePickerModal, setShowQuotePickerModal] = useState(false);
  const [availableQuotes, setAvailableQuotes] = useState<Invoice[]>([]);
  const [loadingQuotes, setLoadingQuotes] = useState(false);

  // Message Actions: Reply, Edit, React, Info, Delete
  const [replyingToMessage, setReplyingToMessage] = useState<WhatsAppMessage | null>(null);
  const [editingMessage, setEditingMessage] = useState<WhatsAppMessage | null>(null);
  const [activeContextMenuId, setActiveContextMenuId] = useState<string | null>(null);
  const [activeReactionMenuId, setActiveReactionMenuId] = useState<string | null>(null);
  const [infoModalMessage, setInfoModalMessage] = useState<WhatsAppMessage | null>(null);
  const [deleteConfirmMessage, setDeleteConfirmMessage] = useState<WhatsAppMessage | null>(null);

  // Dismiss context menu & reaction menu immediately on click anywhere outside
  useEffect(() => {
    if (!activeContextMenuId && !activeReactionMenuId) return;

    const handleWindowClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('[data-msg-menu="true"]')) {
        return;
      }
      setActiveContextMenuId(null);
      setActiveReactionMenuId(null);
    };

    window.addEventListener("mousedown", handleWindowClick);
    return () => {
      window.removeEventListener("mousedown", handleWindowClick);
    };
  }, [activeContextMenuId, activeReactionMenuId]);

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

  // --- Message Action Handlers ---
  const handleReactToMessage = async (msg: WhatsAppMessage, emoji: string) => {
    if (!activeChat) return;
    const newEmoji = msg.reaction === emoji ? "" : emoji;
    setMessages((prev) =>
      prev.map((m) => (m.id === msg.id ? { ...m, reaction: newEmoji || null } : m))
    );
    setActiveReactionMenuId(null);
    setActiveContextMenuId(null);

    const cleanPhone = activeChat.phone.replace(/[^0-9]/g, "");
    const targetId = msg.metaMessageId || msg.id;
    try {
      await api.reactToWhatsAppMessage({
        phoneNumber: cleanPhone,
        messageId: targetId,
        emoji: newEmoji,
        fromMe: msg.sender === "outbound"
      });
    } catch (_) {}
  };

  const handleCopyMessage = (msg: WhatsAppMessage) => {
    const content = msg.text || msg.attachment?.url || "";
    if (content && typeof navigator !== "undefined") {
      navigator.clipboard.writeText(content);
      toast.success("Copied to clipboard", "Message content copied.");
    }
    setActiveContextMenuId(null);
  };

  const handleReplyMessage = (msg: WhatsAppMessage) => {
    setReplyingToMessage(msg);
    setEditingMessage(null);
    setActiveContextMenuId(null);
    if (messageInputRef.current) messageInputRef.current.focus();
  };

  const handleStartEditMessage = (msg: WhatsAppMessage) => {
    setEditingMessage(msg);
    setReplyingToMessage(null);
    setMessageInput(msg.text || "");
    setActiveContextMenuId(null);
    if (messageInputRef.current) messageInputRef.current.focus();
  };

  const handleCancelEdit = () => {
    setEditingMessage(null);
    setMessageInput("");
  };

  const handleSaveEdit = async () => {
    if (!editingMessage || !activeChat || !messageInput.trim()) return;
    const updatedText = messageInput.trim();
    const cleanPhone = activeChat.phone.replace(/[^0-9]/g, "");
    const targetId = editingMessage.metaMessageId || editingMessage.id;

    setMessages((prev) =>
      prev.map((m) =>
        m.id === editingMessage.id ? { ...m, text: updatedText, isEdited: true } : m
      )
    );
    setEditingMessage(null);
    setMessageInput("");

    try {
      await api.editWhatsAppMessage({
        phoneNumber: cleanPhone,
        messageId: targetId,
        text: updatedText
      });
      toast.success("Message Edited", "Updated message delivered.");
    } catch (err: any) {
      toast.error("Edit Failed", err.message || "Failed to update message.");
    }
  };

  const handleDeleteMessage = async (deleteForEveryone: boolean) => {
    if (!deleteConfirmMessage || !activeChat) return;
    const cleanPhone = activeChat.phone.replace(/[^0-9]/g, "");
    const targetId = deleteConfirmMessage.metaMessageId || deleteConfirmMessage.id;
    const isOutbound = deleteConfirmMessage.sender === "outbound";

    if (deleteForEveryone) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === deleteConfirmMessage.id
            ? { ...m, isDeleted: true, text: "🚫 This message was deleted" }
            : m
        )
      );
    } else {
      setMessages((prev) => prev.filter((m) => m.id !== deleteConfirmMessage.id));
    }

    setDeleteConfirmMessage(null);

    try {
      await api.deleteWhatsAppMessage({
        phoneNumber: cleanPhone,
        messageId: targetId,
        deleteForEveryone,
        fromMe: isOutbound
      });
      toast.success(deleteForEveryone ? "Deleted for Everyone" : "Deleted for You");
    } catch (err: any) {
      toast.error("Delete Failed", err.message || "Failed to delete message.");
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

  const [isConvertingLead, setIsConvertingLead] = useState(false);

  const handleConvertToLead = async () => {
    if (!activeChat) return;
    const cleanPhone = activeChat.phone.replace(/[^0-9]/g, "");
    setIsConvertingLead(true);
    try {
      const res = await api.convertWhatsAppChatToLead(activeChat.id, {
        lead_name: activeChat.contactName,
        company_name: activeChat.companyName || undefined,
        email: activeChat.email || undefined,
      });
      toast.success("Added to CRM Leads", `${activeChat.contactName} has been converted and linked to your CRM pipeline.`);
      setConversations((prev) =>
        prev.map((c) =>
          c.id === activeChat.id || c.phone.replace(/[^0-9]/g, "") === cleanPhone
            ? { ...c, is_converted: true, contact_id: res.chat?.contact_id || c.contact_id, lead_id: res.chat?.lead_id }
            : c
        )
      );
    } catch (err: any) {
      toast.error("Conversion Failed", err?.message || "Could not convert contact to CRM lead.");
    } finally {
      setIsConvertingLead(false);
    }
  };

  // Multi-Number Rep State
  // QR WhatsApp State
  const [showQRModal, setShowQRModal] = useState(false);
  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const [qrStatus, setQrStatus] = useState<"DISCONNECTED" | "SCAN_QR" | "CONNECTED" | "CONNECTING" | "NOT_LINKED">(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("zigmaa_whatsapp_status");
      if (saved === "CONNECTED") return "CONNECTED";
      if (saved === "CONNECTING") return "CONNECTING";
    }
    return "NOT_LINKED";
  });
  const [qrPhone, setQrPhone] = useState<string | null>(() => {
    if (typeof window !== "undefined") {
      const savedStatus = localStorage.getItem("zigmaa_whatsapp_status");
      if (savedStatus === "CONNECTED" || savedStatus === "CONNECTING") {
        return localStorage.getItem("zigmaa_whatsapp_phone") || null;
      }
    }
    return null;
  });
  const qrPhoneRef = useRef<string | null>(null);
  qrPhoneRef.current = qrPhone;
  const [linkedUserAvatar, setLinkedUserAvatar] = useState<string | null>(null);
  const [cachedQR, setCachedQR] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<any>(null);

  useEffect(() => {
    // Warm up the WhatsApp bridge immediately upon navigating to the WhatsApp Suite
    api.prewarmWhatsApp().catch(() => {});

    const fetchStatus = () => {
      let sId = currentUser?.id || api.getCurrentUser()?.id;
      if (!sId && typeof window !== "undefined") {
        try {
          const uStr = localStorage.getItem("zigmaa_user") || localStorage.getItem("zigmaa_current_user");
          if (uStr) {
            const p = JSON.parse(uStr);
            sId = p?.id || p?.userId || p?._id;
          }
        } catch (_) {}
      }
      api.getWhatsAppQRStatus(sId || undefined).then((data) => {
        if (data.status === "CONNECTED" && data.phone) {
          setQrStatus("CONNECTED");
          setQrPhone(data.phone);
          qrPhoneRef.current = data.phone;
          try {
            localStorage.setItem("zigmaa_whatsapp_status", "CONNECTED");
            localStorage.setItem("zigmaa_whatsapp_phone", data.phone);
          } catch (_) {}
          loadConversations(true);
        } else if (data.status === "CONNECTING" && data.phone) {
          // Paired session in reconnecting or background state
          setQrPhone(data.phone);
          qrPhoneRef.current = data.phone;
          setQrStatus("CONNECTING");
          try {
            localStorage.setItem("zigmaa_whatsapp_phone", data.phone);
          } catch (_) {}
          loadConversations(true);
        } else if (data.status === "NOT_LINKED" || data.status === "DISCONNECTED" || data.status === "LOGGED_OUT" || data.status === "QR_EXPIRED" || !data.phone) {
          setQrStatus((data.status as any) || "NOT_LINKED");
          setQrPhone(null);
          qrPhoneRef.current = null;
          try {
            localStorage.removeItem("zigmaa_whatsapp_status");
            localStorage.removeItem("zigmaa_whatsapp_phone");
          } catch (_) {}
        } else {
          if (data.status) {
            setQrStatus(data.status as any);
          }
        }
        if (data.qr) {
          setCachedQR(data.qr);
        }
        if (data.avatar_url && data.status === "CONNECTED") {
          setLinkedUserAvatar(data.avatar_url);
        } else if (data.phone && data.status === "CONNECTED") {
          api.getWhatsAppContactAvatar(data.phone).then((res) => {
            if (res?.avatar_url) setLinkedUserAvatar(res.avatar_url);
          }).catch(() => {});
        } else if ((data as any)?.logged_out === true) {
          setLinkedUserAvatar(null);
        }
      }).catch(() => {});
    };
    fetchStatus();
    // Warm keep-alive ping every 45s so cloud bridge never enters sleep/cold-start while tab is open
    const keepAlive = setInterval(fetchStatus, 45 * 1000);
    return () => clearInterval(keepAlive);
  }, [currentUser]);

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
  const messageInputRef = useRef<HTMLTextAreaElement | null>(null);
  const emojiPickerRef = useRef<HTMLDivElement | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const hasAnyLinkedPhone = Boolean(
    qrPhone ||
    currentUser?.whatsapp_phone_number
  );
  const isConnectingState = qrStatus === "CONNECTING" || isLoadingConversations;
  const isTrulyUnlinked = !hasAnyLinkedPhone && qrStatus !== "CONNECTED" && qrStatus !== "CONNECTING" && conversations.length === 0;

  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState("");
  const [isSavingName, setIsSavingName] = useState(false);

  const chatBottomRef = useRef<HTMLDivElement>(null);
  const isUserScrolledUpRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isPollingRef = useRef(false);
  const activePhoneRef = useRef<string>("");
  const chatMessagesCacheRef = useRef<Record<string, WhatsAppMessage[]>>({});
  const conversationsRef = useRef<WhatsAppConversation[]>(conversations);
  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

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
        const cleanSession = qrPhone ? qrPhone.replace(/[^0-9]/g, "") : (qrPhoneRef.current ? qrPhoneRef.current.replace(/[^0-9]/g, "") : undefined);
        const nextList = [...(chatMessagesCacheRef.current[cleanPhone] || messages), optimisticMsg];
        chatMessagesCacheRef.current[cleanPhone] = nextList;
        setMessages(nextList);
        setIsSending(true);

        try {
          const res = await api.uploadWhatsAppVoice({
            phone_number: cleanPhone,
            audio_base64: base64Audio,
            mimetype: mimeType,
            contact_id: activeChat.contact_id,
            duration_seconds: duration,
            session_id: cleanSession
          });
          if (res && res.status === "success") {
            const savedData = res.data;
            const fullMediaUrl = api.getMediaUrl(savedData?.media_url) || undefined;

            const updatedList = (chatMessagesCacheRef.current[cleanPhone] || messages).map((m) =>
              m.id === tempVoiceId
                ? {
                    ...m,
                    id: savedData?.id || m.id,
                    status: "DELIVERED" as any,
                    text: savedData?.message_body || m.text,
                    fileName: savedData?.file_name || m.fileName,
                    mediaUrl: fullMediaUrl || m.mediaUrl,
                    attachment: {
                      ...m.attachment!,
                      name: savedData?.file_name || m.attachment!.name,
                      url: fullMediaUrl || m.attachment!.url
                    }
                  }
                : m
            );
            chatMessagesCacheRef.current[cleanPhone] = updatedList;
            if (activePhoneRef.current === cleanPhone) {
              setMessages(updatedList);
            }
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
    if (!activePhone) return null;
    return (
      conversations.find((c) => c.phone.replace(/[^0-9]/g, "") === activePhone.replace(/[^0-9]/g, "")) ||
      null
    );
  }, [conversations, activePhone]);

  // Transform backend raw conversation into WhatsAppConversation
  const mapBackendConv = (raw: any, index: number): WhatsAppConversation => {
    const rawPhone = String(raw.phone_number || raw.phone || raw.jid || raw.id || "").replace(/@.*$/, "").trim();
    const cleanPhoneDigits = rawPhone.replace(/[^0-9]/g, "");
    const formattedPhone = raw.display_phone || (cleanPhoneDigits ? `+${cleanPhoneDigits}` : (rawPhone ? (rawPhone.startsWith("+") ? rawPhone : `+${rawPhone}`) : ""));
    const phoneVal = formattedPhone || (cleanPhoneDigits ? `+${cleanPhoneDigits}` : "") || rawPhone || "Unknown";

    const name = raw.contact_name || raw.name || raw.custom_name || raw.push_name || (phoneVal !== "Unknown" ? `WhatsApp User (${phoneVal})` : "WhatsApp User");
    const parts = name.trim().split(" ");
    const initials = ((parts[0]?.[0] || "W") + (parts[1]?.[0] || "")).toUpperCase();
    const grad = AVATAR_GRADIENTS[index % AVATAR_GRADIENTS.length];

    const repName = raw.assigned_rep?.name || (raw.assigned_user_id ? "Assigned Rep" : "Unassigned");
    const repParts = repName.trim().split(" ");
    const repInitials = ((repParts[0]?.[0] || "S") + (repParts[1]?.[0] || "R")).toUpperCase();

    const loggedInUser = currentUser || api.getCurrentUser();
    const isMine = raw.assigned_user_id
      ? raw.assigned_user_id === loggedInUser?.id
      : false;

    const isConverted = Boolean(raw.lead_id || raw.crm?.lead_id || raw.contact_id);

    return {
      id: raw.id || `conv-${phoneVal}`,
      contact_id: raw.contact_id || raw.crm?.contact_id,
      lead_id: raw.lead_id || raw.crm?.lead_id,
      is_converted: isConverted,
      contactName: name,
      companyName: raw.company_name || "",
      phone: phoneVal,
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
      dealValue: raw.deal_value || 0,
      dealCloseDate: "28 Oct 2026",
      unreadCount: raw.unread_count || 0,
      isAssignedToMe: isMine,
      lastMessage: formatLastMessagePreview(raw.last_message || raw.last_message_text || raw.last_message_preview),
      lastMessageTime: raw.last_message_time || raw.last_message?.at || raw.sort_at,
      last_direction: raw.last_direction || (raw.last_message?.from_me ? "outbound" : "inbound"),
      last_status: raw.last_status || raw.last_message?.status,
      is_pinned: Boolean(raw.is_pinned),
      is_archived: Boolean(raw.is_archived),
      is_blocked: Boolean(raw.is_blocked),
      notes: (() => {
        if (typeof window !== "undefined" && phoneVal && phoneVal !== "Unknown") {
          try {
            const saved = localStorage.getItem(`wa_notes_${phoneVal}`);
            if (saved) return JSON.parse(saved);
          } catch (e) {}
        }
        return Array.isArray(raw.notes) ? raw.notes : [];
      })()
    };
  };

  // Load conversations from backend
  const loadConversations = useCallback(async (isSilent = false, repFilter?: string) => {
    // Only show grey skeletons on the very first mount when NO conversations exist yet
    if (!isSilent && conversationsRef.current.length === 0) {
      setIsLoadingConversations(true);
    } else if (!isSilent) {
      setIsRefreshing(true);
    }

    try {
      const liveSession = qrPhoneRef.current || qrPhone || (typeof window !== "undefined" ? localStorage.getItem("zigmaa_whatsapp_phone") : null) || currentUser?.whatsapp_phone_number;
      const cleanSession = liveSession ? liveSession.replace(/[^0-9]/g, "") : undefined;
      const sId = currentUser?.id || api.getCurrentUser()?.id || undefined;
      const activeFilter = repFilter !== undefined ? repFilter : selectedRepFilter;
      const repParam = activeFilter === "ALL" ? undefined : activeFilter;

      const data = await api.getWhatsAppConversations(100, repParam, cleanSession, sId);
      if (data && data.status === "success" && Array.isArray(data.conversations)) {
        if (data.conversations.length === 0) {
          // If no conversations returned from server, keep any previously rendered offline conversations
          return;
        }
        const mapped = data.conversations.map(mapBackendConv);

        // Zero-flicker state update: Check if conversation list really changed before triggering React render
        setConversations((prev) => {
          if (!prev || prev.length === 0) return mapped;
          if (prev.length === mapped.length) {
            let hasChanged = false;
            for (let i = 0; i < mapped.length; i++) {
              const m = mapped[i];
              const p = prev[i];
              if (
                !p ||
                p.phone !== m.phone ||
                p.lastMessage !== m.lastMessage ||
                p.lastMessageTime !== m.lastMessageTime ||
                p.unreadCount !== m.unreadCount ||
                p.is_pinned !== m.is_pinned ||
                p.is_archived !== m.is_archived ||
                p.contactName !== m.contactName
              ) {
                hasChanged = true;
                break;
              }
            }
            if (!hasChanged) return prev; // Exact same reference: zero re-render, zero flicker!
          }
          // Merge to preserve client-side avatars and active notes
          const prevMap = new Map(prev.map((c: WhatsAppConversation) => [c.phone.replace(/[^0-9]/g, ""), c]));
          return mapped.map((newConv: WhatsAppConversation) => {
            const clean = newConv.phone.replace(/[^0-9]/g, "");
            const existing = prevMap.get(clean);
            if (existing) {
              return {
                ...newConv,
                avatar_url: newConv.avatar_url || existing.avatar_url,
                notes: existing.notes?.length ? existing.notes : newConv.notes
              };
            }
            return newConv;
          });
        });

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
      if (user.whatsapp_phone_number) {
        setQrPhone(user.whatsapp_phone_number);
        qrPhoneRef.current = user.whatsapp_phone_number;
        setQrStatus("CONNECTED");
        try {
          localStorage.setItem("zigmaa_whatsapp_phone", user.whatsapp_phone_number);
          localStorage.setItem("zigmaa_whatsapp_status", "CONNECTED");
        } catch (_) {}
      }
    }
    // Fresh server fetch to sync linked WhatsApp phone across any laptop or browser
    api.getMe().then((freshUser) => {
      if (freshUser) {
        setCurrentUser(freshUser);
        if (freshUser.whatsapp_phone_number) {
          setQrPhone(freshUser.whatsapp_phone_number);
          qrPhoneRef.current = freshUser.whatsapp_phone_number;
          setQrStatus("CONNECTED");
          try {
            localStorage.setItem("zigmaa_whatsapp_phone", freshUser.whatsapp_phone_number);
            localStorage.setItem("zigmaa_whatsapp_status", "CONNECTED");
          } catch (_) {}
          loadConversations(true);
        } else {
          // If server reports user has no linked WhatsApp phone, clear phone state cleanly
          setQrPhone(null);
          qrPhoneRef.current = null;
          setQrStatus("NOT_LINKED");
          try {
            localStorage.removeItem("zigmaa_whatsapp_phone");
            localStorage.removeItem("zigmaa_whatsapp_status");
          } catch (_) {}
        }
      }
    }).catch(() => {});

    api.getTeamMembers()
      .then((members) => {
        if (Array.isArray(members)) setTeamMembers(members);
      })
      .catch((err) => console.warn("Failed to load team members", err));
  }, []);

  // Load message stream for active phone
  const loadMessages = useCallback(async (phone: string, isSilent = false) => {
    if (!phone) return;
    const clean = phone.replace(/[^0-9]/g, "");

    // Only show loading spinner if we don't already have cached messages
    if (!isSilent && (!chatMessagesCacheRef.current[clean] || chatMessagesCacheRef.current[clean].length === 0)) {
      setIsLoadingMessages(true);
    }

    try {
      const liveSession = qrPhoneRef.current || qrPhone;
      const data = await api.getWhatsAppMessages({ phone_number: clean, active_session_phone: liveSession });

      // Guard: Ignore response if user switched to another contact in the meantime
      if (activePhoneRef.current && activePhoneRef.current !== clean) {
        return;
      }

      if (data && data.status === "success" && Array.isArray(data.messages)) {
        const mappedMsgs: WhatsAppMessage[] = data.messages.map((m: any) => {
          const rawMedia = m.media_url || (m.file_name ? `/media/whatsapp/${m.file_name}` : null);
          const mediaFullUrl = api.getMediaUrl(rawMedia);
          const rawB64 = m.media_base64 || null;

          let attachment: WhatsAppMessage["attachment"] = undefined;
          const mType = (m.message_type || "").toLowerCase();
          const lowerUrl = (mediaFullUrl || "").toLowerCase();
          const lowerFileName = (m.file_name || "").toLowerCase();
          const isVoice = m.is_voice_note || mType === "ptt" || mType === "audio" || lowerUrl.includes(".ogg") || lowerUrl.includes(".opus") || lowerUrl.includes(".mp3") || lowerFileName.includes(".ogg") || lowerFileName.includes(".opus");
          const isImg = mType === "image" || lowerUrl.includes(".jpg") || lowerUrl.includes(".jpeg") || lowerUrl.includes(".png") || lowerFileName.includes(".jpg") || lowerFileName.includes(".jpeg") || lowerFileName.includes(".png");
          const isGif = mType === "gif" || lowerFileName.startsWith("gif_") || lowerUrl.includes("gif_") || lowerUrl.endsWith(".gif") || (m.message_body || "").toLowerCase() === "[gif]";
          const isVideo = !isGif && (mType === "video" || lowerUrl.includes(".mp4") || lowerUrl.includes(".mov") || lowerUrl.includes(".webm") || lowerFileName.includes(".mp4") || lowerFileName.includes(".mov"));
          const isSticker = mType === "sticker" || lowerUrl.includes(".webp") || lowerFileName.startsWith("sticker_") || lowerFileName.endsWith(".webp") || ((m.message_body || "").toLowerCase() === "[sticker]");
          const isDoc = mType === "document" || (!isImg && !isVideo && !isGif && !isVoice && !isSticker && !!mediaFullUrl);

          const base64DataUrl = rawB64
            ? (rawB64.startsWith("data:") ? rawB64 : `data:${isSticker ? "image/webp" : (isImg ? "image/jpeg" : (isVoice ? "audio/ogg" : "application/octet-stream"))};base64,${rawB64}`)
            : null;
          const effectiveUrl = mediaFullUrl || base64DataUrl || undefined;

          if (isImg) {
            attachment = {
              type: "image",
              name: m.file_name || "Photo",
              url: effectiveUrl
            };
          } else if (isGif) {
            attachment = {
              type: "gif",
              name: m.file_name || "GIF",
              url: effectiveUrl
            };
          } else if (isVideo) {
            attachment = {
              type: "video",
              name: m.file_name || "Video",
              url: effectiveUrl
            };
          } else if (isSticker) {
            attachment = {
              type: "sticker",
              name: m.file_name || "Sticker",
              url: effectiveUrl
            };
          } else if (isVoice) {
            attachment = {
              type: "audio",
              name: m.file_name || "Voice note",
              url: effectiveUrl
            };
          } else if (isDoc) {
            attachment = {
              type: "pdf",
              name: m.file_name || "Document",
              size: "Document",
              url: effectiveUrl
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
            mediaUrl: effectiveUrl || null,
            mediaBase64: rawB64,
            fileName: m.file_name,
            caption: m.caption,
            isVoiceNote: isVoice,
            reaction: m.reaction || null,
            isDeleted: Boolean(m.is_deleted),
            metaMessageId: m.meta_message_id || null,
            quotedContext: m.quoted_context || null,
            attachment
          };
        });

        // Compute combined messages with any in-flight optimistic messages
        const prevCached = chatMessagesCacheRef.current[clean] || [];
        const pendingOptimistic = prevCached.filter((m) =>
          (m.id.startsWith("temp-") || m.id.startsWith("voice-")) &&
          !mappedMsgs.some((serverM) =>
            serverM.id === m.id ||
            (serverM.sender === "outbound" &&
             (serverM.text === m.text || (m.isVoiceNote && serverM.isVoiceNote)))
          )
        );
        const finalMsgs = [...mappedMsgs, ...pendingOptimistic];

        // Store into in-memory cache for 0ms instant retrieval on chat switch
        chatMessagesCacheRef.current[clean] = finalMsgs;

        if (activePhoneRef.current === clean) {
          setMessages((prev) => {
            if (prev.length === finalMsgs.length) {
              const lastPrev = prev[prev.length - 1];
              const lastNext = finalMsgs[finalMsgs.length - 1];
              if (lastPrev?.id === lastNext?.id && lastPrev?.status === lastNext?.status && lastPrev?.text === lastNext?.text) {
                return prev;
              }
            }
            return finalMsgs;
          });
          setIsLoadingMessages(false);
        }

        // Mark unread messages as read in backend and update conversation list badge only if unread
        api.markWhatsAppConversationRead(clean).catch(() => {});
        setConversations((prev) => {
          const match = prev.find(c => c.phone.replace(/[^0-9]/g, "") === clean);
          if (!match || match.unreadCount === 0) return prev;
          return prev.map((c) =>
            c.phone.replace(/[^0-9]/g, "") === clean ? { ...c, unreadCount: 0 } : c
          );
        });
      }
    } catch (e: any) {
      console.warn("Could not fetch messages for", phone, e);
    } finally {
      if (activePhoneRef.current === clean) {
        setIsLoadingMessages(false);
      }
    }
  }, []);

  // Initial load and auto-reload on session change
  useEffect(() => {
    if (qrPhone || qrPhoneRef.current) {
      loadConversations(true);
    }
  }, [loadConversations, qrPhone, qrStatus]);

  // Load messages whenever activePhone changes
  useEffect(() => {
    if (activePhone) {
      const clean = activePhone.replace(/[^0-9]/g, "");
      activePhoneRef.current = clean;
      const hasCache = Boolean(chatMessagesCacheRef.current[clean]?.length);
      loadMessages(activePhone, hasCache);
      // Mark read in backend
      api.markWhatsAppConversationRead(clean).catch(() => {});
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
    }).catch(() => {});
  }, [activeChat?.phone]);

  // Background lazy-loader for avatars of the top 20 conversations
  useEffect(() => {
    if (!conversations.length) return;
    const missingAvatars = conversations.filter((c) => !c.avatar_url && c.phone).slice(0, 15);
    if (!missingAvatars.length) return;
    missingAvatars.forEach((c) => {
      const clean = c.phone.replace(/[^0-9]/g, "");
      if (clean) {
        api.getWhatsAppContactAvatar(clean).then((res) => {
          if (res?.avatar_url) {
            setConversations((prev) =>
              prev.map((conv) =>
                conv.phone.replace(/[^0-9]/g, "") === clean ? { ...conv, avatar_url: res.avatar_url } : conv
              )
            );
          }
        }).catch(() => {});
      }
    });
  }, [conversations.length]);

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

  // Polling: high-performance concurrent refresh (2.5s) with document visibility guard & overlap prevention
  useEffect(() => {
    const poll = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      if (isPollingRef.current) return;
      isPollingRef.current = true;
      try {
        const tasks: Promise<any>[] = [loadConversations(true)];
        if (activePhone && !isSending) {
          tasks.push(loadMessages(activePhone, true));
        }
        await Promise.all(tasks);
      } catch (err) {
        console.warn("WhatsApp background sync error:", err);
      } finally {
        isPollingRef.current = false;
      }
    };

    const interval = setInterval(poll, 2500);

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
  }, [activePhone, loadConversations, loadMessages, isSending]);

  // Auto-scroll when messages update (only if user hasn't scrolled up to view older messages)
  useEffect(() => {
    if (!isUserScrolledUpRef.current) {
      chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  // Filter conversations
  const filteredConversations = useMemo(() => {
    return conversations.filter((c) => {
      if (filterTab === "Pinned") return Boolean(c.is_pinned);
      if (filterTab === "Archived") return Boolean(c.is_archived);
      if (filterTab === "Unread") return c.unreadCount > 0 && !c.is_archived;
      if (!searchQuery.trim() && c.is_archived) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const digitsOnly = q.replace(/[^0-9]/g, "");
        const matchesName = (c.contactName || "").toLowerCase().includes(q);
        const matchesPhone = digitsOnly.length > 0 && c.phone.replace(/[^0-9]/g, "").includes(digitsOnly);
        const matchesCompany = (c.companyName || "").toLowerCase().includes(q);
        const matchesLastMessage = (c.lastMessage || "").toLowerCase().includes(q);
        return Boolean(matchesName || matchesPhone || matchesCompany || matchesLastMessage);
      }
      return true;
    });
  }, [conversations, filterTab, searchQuery]);

  const handleLogoutWhatsApp = async () => {
    if (!confirm("Are you sure you want to log out and unlink your WhatsApp session? This will also disconnect WhatsApp on your mobile device.")) {
      return;
    }
    setIsLoggingOutWhatsApp(true);
    try {
      await api.disconnectWhatsAppQR();
      setQrStatus("NOT_LINKED");
      setQrPhone(null);
      qrPhoneRef.current = null;
      setCurrentUser((prev: any) => prev ? { ...prev, whatsapp_phone_number: null, whatsapp_phone_number_id: null } : null);
      try {
        localStorage.removeItem("zigmaa_whatsapp_status");
        localStorage.removeItem("zigmaa_whatsapp_phone");
      } catch (_) {}
      setCachedQR(null);
      setConversations([]);
      setMessages([]);
      setActivePhone("");
      setShowRightDrawer(false);
      setShowQRModal(false);
      toast.success("Logged Out", "WhatsApp session unlinked successfully.");
    } catch (err: any) {
      toast.error("Logout Error", err.message || "Failed to disconnect WhatsApp session.");
    } finally {
      setIsLoggingOutWhatsApp(false);
    }
  };

  // Pin / Archive / Clear / Block / Delete Handlers
  const handleTogglePin = async (phone: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    try {
      const res = await api.pinWhatsAppConversation(phone);
      setConversations((prev) =>
        prev.map((conv) =>
          conv.phone.replace(/[^0-9]/g, "") === phone.replace(/[^0-9]/g, "")
            ? { ...conv, is_pinned: res.is_pinned }
            : conv
        )
      );
      toast.success(res.is_pinned ? "Conversation Pinned" : "Conversation Unpinned");
    } catch (err: any) {
      toast.error("Error", err.message || "Failed to toggle pin");
    }
  };

  const handleToggleArchive = async (phone: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    try {
      const res = await api.archiveWhatsAppConversation(phone);
      setConversations((prev) =>
        prev.map((conv) =>
          conv.phone.replace(/[^0-9]/g, "") === phone.replace(/[^0-9]/g, "")
            ? { ...conv, is_archived: res.is_archived }
            : conv
        )
      );
      toast.success(res.is_archived ? "Conversation Archived" : "Conversation Unarchived");
    } catch (err: any) {
      toast.error("Error", err.message || "Failed to toggle archive");
    }
  };

  const handleClearChat = async () => {
    setShowMoreMenu(false);
    if (!activePhone) return;
    if (!confirm("Are you sure you want to clear all messages in this chat? This cannot be undone.")) return;
    try {
      await api.clearWhatsAppChat(activePhone);
      setMessages([]);
      toast.success("Chat Cleared", "All messages in this conversation have been deleted.");
    } catch (err: any) {
      toast.error("Error", err.message || "Failed to clear chat");
    }
  };

  const handleToggleBlockContact = async () => {
    setShowMoreMenu(false);
    if (!activePhone || !activeChat) return;
    const isCurrentlyBlocked = Boolean(activeChat.is_blocked);
    try {
      if (isCurrentlyBlocked) {
        await api.unblockWhatsAppContact(activePhone);
        toast.success("Contact Unblocked", `${activeChat.contactName} has been unblocked.`);
      } else {
        await api.blockWhatsAppContact(activePhone);
        toast.success("Contact Blocked", `${activeChat.contactName} has been blocked.`);
      }
      setConversations((prev) =>
        prev.map((conv) =>
          conv.phone.replace(/[^0-9]/g, "") === activePhone.replace(/[^0-9]/g, "")
            ? { ...conv, is_blocked: !isCurrentlyBlocked }
            : conv
        )
      );
    } catch (err: any) {
      toast.error("Error", err.message || "Failed to update block status");
    }
  };

  const handleDeleteContact = async () => {
    setShowMoreMenu(false);
    if (!activeChat || !activeChat.contact_id) {
      toast.error("Error", "No linked CRM contact record found to delete.");
      return;
    }
    if (!confirm(`Are you sure you want to delete ${activeChat.contactName} from your CRM contacts?`)) return;
    try {
      await api.deleteContact(activeChat.contact_id);
      toast.success("Contact Deleted", `${activeChat.contactName} removed from CRM.`);
      setConversations((prev) => prev.filter((conv) => conv.phone.replace(/[^0-9]/g, "") !== activePhone.replace(/[^0-9]/g, "")));
      setActivePhone("");
      setMessages([]);
    } catch (err: any) {
      toast.error("Error", err.message || "Failed to delete contact");
    }
  };

  const handleDeleteSelectedMessages = async () => {
    if (selectedMsgIds.size === 0) return;
    if (!confirm(`Delete ${selectedMsgIds.size} selected message(s)?`)) return;
    for (const msgId of Array.from(selectedMsgIds)) {
      try {
        await api.deleteWhatsAppMessage({
          phoneNumber: activePhone,
          messageId: msgId,
          deleteForEveryone: false
        });
      } catch (_) {}
    }
    setMessages((prev) => prev.filter((m) => !selectedMsgIds.has(m.id)));
    setSelectedMsgIds(new Set());
    setIsSelectMode(false);
    toast.success("Deleted", "Selected messages have been removed.");
  };

  // Select conversation
  const handleSelectChat = async (phone: string) => {
    isUserScrolledUpRef.current = false;
    const cleanPhone = phone.replace(/[^0-9]/g, "");
    activePhoneRef.current = cleanPhone;
    setActivePhone(phone);

    // Instant switch from in-memory cache
    if (chatMessagesCacheRef.current[cleanPhone]) {
      setMessages(chatMessagesCacheRef.current[cleanPhone]);
      setIsLoadingMessages(false);
    } else {
      // Clear previous chat messages immediately so they NEVER linger on screen
      setMessages([]);
      setIsLoadingMessages(true);
    }

    setConversations((prev) =>
      prev.map((c) =>
        c.phone.replace(/[^0-9]/g, "") === cleanPhone
          ? { ...c, unreadCount: 0 }
          : c
      )
    );
    try {
      await api.markWhatsAppConversationRead(cleanPhone);
    } catch (_) {}
  };

  // Send message action
  const handleSendMessage = async (textToSend?: string) => {
    const text = (textToSend ?? messageInput).trim();
    if (!text || !activeChat) return;

    const cleanPhone = activeChat.phone.replace(/[^0-9]/g, "");

    let textPayload = text;
    let quotedMessageId: string | undefined = undefined;
    let quotedText: string | undefined = undefined;
    let quotedFromMe: boolean | undefined = undefined;

    if (replyingToMessage) {
      quotedMessageId = replyingToMessage.metaMessageId || replyingToMessage.id;
      const cleanQuotedText = replyingToMessage.text
        ? (parseQuotedReply(replyingToMessage.text).body || replyingToMessage.text)
        : (replyingToMessage.fileName || "Media");
      quotedText = cleanQuotedText.replace(/[\r\n]+/g, " ").trim().slice(0, 100);
      quotedFromMe = replyingToMessage.sender === "outbound";
      const quotedSender = replyingToMessage.sender === "outbound" ? "You" : activeChat.contactName;
      textPayload = `> *${quotedSender}*: ${quotedText}\n\n${text}`;
      setReplyingToMessage(null);
    }

    // 1. Optimistic message update
    const tempId = `temp-${Date.now()}`;
    const optimisticMsg: WhatsAppMessage = {
      id: tempId,
      sender: "outbound",
      text: textPayload,
      timestamp: "Today",
      timeLabel: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      dateGroup: "Today",
      status: "SENT"
    };

    const nextList = [...(chatMessagesCacheRef.current[cleanPhone] || messages), optimisticMsg];
    chatMessagesCacheRef.current[cleanPhone] = nextList;
    setMessages(nextList);
    setMessageInput("");
    setShowTemplateSelector(false);
    setIsSending(true);

    try {
      const cleanSession = qrPhone ? qrPhone.replace(/[^0-9]/g, "") : (qrPhoneRef.current ? qrPhoneRef.current.replace(/[^0-9]/g, "") : undefined);
      const res = await api.sendWhatsAppMessage({
        phone_number: cleanPhone,
        message: text,
        contact_id: activeChat.contact_id,
        quoted_message_id: quotedMessageId,
        quoted_text: quotedText,
        quoted_from_me: quotedFromMe,
        crm_display_message: textPayload,
        session_id: cleanSession
      });

      if (res && res.status === "success") {
        const savedData = res.data;
        // Seamlessly update optimistic message with real server ID and delivery status
        const updatedList = (chatMessagesCacheRef.current[cleanPhone] || messages).map((m) =>
          m.id === tempId
            ? {
                ...m,
                id: savedData?.id || m.id,
                status: (savedData?.status as any) || "DELIVERED",
                timeLabel: formatTime(savedData?.created_at) || m.timeLabel
              }
            : m
        );
        chatMessagesCacheRef.current[cleanPhone] = updatedList;
        if (activePhoneRef.current === cleanPhone) {
          setMessages(updatedList);
        }
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
      if (editingMessage) {
        handleSaveEdit();
      } else {
        handleSendMessage();
      }
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

  const [isAddingContact, setIsAddingContact] = useState(false);
  const [isContactSaved, setIsContactSaved] = useState(false);
  const [isCreatingDeal, setIsCreatingDeal] = useState(false);
  const [isSubmittingNote, setIsSubmittingNote] = useState(false);

  // Add WhatsApp prospect directly to CRM Contacts
  const handleAddToContact = async () => {
    if (!activeChat) return;
    try {
      setIsAddingContact(true);
      const cleanPhone = activeChat.phone.replace(/[^0-9]/g, "");
      const res = await api.createContact({
        name: activeChat.contactName,
        phone: cleanPhone,
        email: activeChat.email || undefined,
        company: activeChat.companyName || "Direct Prospect"
      }, true);
      setIsContactSaved(true);
      if (res && res.id) {
        setConversations((prev) =>
          prev.map((c) =>
            c.phone.replace(/[^0-9]/g, "") === cleanPhone
              ? { ...c, contact_id: String(res.id) }
              : c
          )
        );
      }
      toast.success("Contact Saved", `${activeChat.contactName} (${activeChat.phone}) added to CRM Contacts.`);
    } catch (err: any) {
      toast.error("Failed to Add Contact", err.message || "Could not save contact to CRM.");
    } finally {
      setIsAddingContact(false);
    }
  };

  // Create Deal from CRM Drawer with selected stage & entered amount
  const handleCreateDealFromDrawer = async () => {
    if (!activeChat) return;
    try {
      setIsCreatingDeal(true);
      const dealTitle = `${activeChat.contactName || "WhatsApp Prospect"} - Deal`;
      const val = Number(activeChat.dealValue) || 0;
      const stageName = activeChat.dealStage || "Qualified";
      const created = await api.createDeal({
        title: dealTitle,
        contact_id: activeChat.contact_id ? String(activeChat.contact_id) : undefined,
        contact_name: activeChat.contactName,
        contact_phone: activeChat.phone,
        company_name: activeChat.companyName || "Direct Prospect",
        stage: stageName,
        stage_id: stageName,
        value: val,
        deal_value: val,
        currency: "INR"
      });
      toast.success("Deal Created in CRM", `Deal "${dealTitle}" with ${formatCurrency(val)} added to ${stageName} stage.`);
    } catch (err: any) {
      toast.error("Deal Creation Failed", err.message || "Could not create deal for WhatsApp contact.");
    } finally {
      setIsCreatingDeal(false);
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

  // Quick Action: Add Internal Note Inline
  const handleAddNoteInline = async () => {
    if (!newNoteText.trim() || !activeChat) return;

    try {
      setIsSubmittingNote(true);
      const noteContent = newNoteText.trim();
      const authorName = currentUser?.full_name || "Internal Staff";
      const newNote = {
        id: `note-${Date.now()}`,
        text: noteContent,
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

      // Persist note to CRM Activity log if contact_id exists
      if (activeChat.contact_id) {
        await api.createActivity({
          contact_id: activeChat.contact_id,
          type: "note",
          notes: noteContent
        }).catch(() => {});
      }

      setNewNoteText("");
      toast.success("Note Saved", "CRM context note recorded.");
    } catch (err: any) {
      toast.error("Failed to add note", err.message || "Could not save note.");
    } finally {
      setIsSubmittingNote(false);
    }
  };

  const handleAddNoteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await handleAddNoteInline();
    setShowNewNoteModal(false);
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

    const cleanSession = qrPhone ? qrPhone.replace(/[^0-9]/g, "") : (qrPhoneRef.current ? qrPhoneRef.current.replace(/[^0-9]/g, "") : undefined);
    const nextList = [...(chatMessagesCacheRef.current[cleanPhone] || messages), optimisticMsg];
    chatMessagesCacheRef.current[cleanPhone] = nextList;
    setMessages(nextList);
    setIsSending(true);

    try {
      const res = await api.sendWhatsAppMessage({
        phone_number: cleanPhone,
        message: (isImg || isVideo || isAudio) ? "" : `📎 ${file.name}`,
        contact_id: activeChat.contact_id,
        file_base64: base64Data,
        file_name: file.name,
        file_type: file.type,
        session_id: cleanSession
      });

      if (res && res.status === "success") {
        const savedData = res.data;
        const fullMediaUrl = api.getMediaUrl(savedData?.media_url) || undefined;

        const updatedList = (chatMessagesCacheRef.current[cleanPhone] || messages).map((m) =>
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
        );
        chatMessagesCacheRef.current[cleanPhone] = updatedList;
        if (activePhoneRef.current === cleanPhone) {
          setMessages(updatedList);
        }
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
            "w-80 sm:w-[360px] xl:w-[380px] shrink-0 flex flex-col transition-colors border-r z-10",
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

              {/* Linked Device Status & Logout */}
              {qrStatus === "CONNECTED" && Boolean(qrPhone) && (
                <div className={cn(
                  "w-full flex items-center justify-between px-3 py-2 rounded-xl border text-xs font-semibold transition-all shadow-2xs",
                  isDark
                    ? "bg-emerald-950/40 border-emerald-800/60 text-emerald-300"
                    : "bg-emerald-50 border-emerald-300 text-emerald-800"
                )}>
                  <div className="flex items-center gap-2 min-w-0 flex-1 mr-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                    <span className="font-semibold truncate">
                      Linked: {qrPhone ? (qrPhone.startsWith("+") ? qrPhone : `+${qrPhone}`) : "Connected"}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handleLogoutWhatsApp}
                    disabled={isLoggingOutWhatsApp}
                    className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold text-rose-600 hover:text-white bg-rose-50 hover:bg-rose-600 dark:bg-rose-950/50 dark:hover:bg-rose-600 dark:text-rose-300 dark:hover:text-white border border-rose-200 dark:border-rose-800 rounded-lg transition-all cursor-pointer shrink-0 shadow-2xs"
                    title="Logout WhatsApp Session"
                  >
                    {isLoggingOutWhatsApp ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <LogOut className="w-3 h-3" />
                    )}
                    <span>Logout</span>
                  </button>
                </div>
              )}

              {/* Reconnecting / Background Sync State */}
              {qrStatus === "CONNECTING" && Boolean(qrPhone || currentUser?.whatsapp_phone_number) && (
                <div className={cn(
                  "w-full flex items-center justify-between px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all shadow-2xs",
                  isDark
                    ? "bg-amber-950/40 border-amber-800/60 text-amber-300"
                    : "bg-amber-50 border-amber-300 text-amber-800"
                )}>
                  <div className="flex items-center gap-2 min-w-0 flex-1 mr-2">
                    <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping shrink-0" />
                    <span className="font-semibold text-[11px] truncate">
                      Connecting ({qrPhone || currentUser?.whatsapp_phone_number})...
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handleLogoutWhatsApp}
                    disabled={isLoggingOutWhatsApp}
                    className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold text-rose-600 hover:text-white bg-rose-50 hover:bg-rose-600 dark:bg-rose-950/50 dark:hover:bg-rose-600 dark:text-rose-300 dark:hover:text-white border border-rose-200 dark:border-rose-800 rounded-lg transition-all cursor-pointer shrink-0"
                    title="Unlink Phone"
                  >
                    Unlink
                  </button>
                </div>
              )}

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

              {/* Segmented Filter Control (4 Filters: All, Unread, Pinned, Archived) */}
              <div className={cn(
                "grid grid-cols-4 gap-1 p-1 rounded-xl border transition-colors w-full overflow-hidden",
                isDark ? "bg-[#131B2E]/60 border-[#1E293B]" : "bg-slate-100/90 border-slate-200/80"
              )}>
                {(["All", "Unread", "Pinned", "Archived"] as const).map((tab) => {
                  const hasConversations = conversations.length > 0;
                  const count =
                    !hasConversations && !qrPhone
                      ? 0
                      : tab === "All"
                      ? conversations.filter(c => !c.is_archived).length
                      : tab === "Unread"
                      ? conversations.filter(c => c.unreadCount > 0 && !c.is_archived).length
                      : tab === "Pinned"
                      ? conversations.filter(c => c.is_pinned).length
                      : conversations.filter(c => c.is_archived).length;

                  return (
                    <button
                      key={tab}
                      onClick={() => setFilterTab(tab)}
                      className={cn(
                        "w-full py-1.5 px-0.5 sm:px-1 rounded-lg text-[11px] sm:text-xs font-semibold transition-all flex items-center justify-center gap-1 cursor-pointer whitespace-nowrap",
                        filterTab === tab
                          ? (isDark
                              ? "bg-emerald-600 text-white shadow-xs"
                              : "bg-white text-slate-900 shadow-xs")
                          : (isDark
                              ? "text-slate-400 hover:text-slate-200 hover:bg-white/5"
                              : "text-slate-600 hover:text-slate-900 hover:bg-slate-200/60")
                      )}
                    >
                      <span className="whitespace-nowrap">{tab}</span>
                      <span
                        className={cn(
                          "text-[10px] min-w-4 h-4 px-1 rounded-full font-bold shrink-0 flex items-center justify-center leading-none",
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
              ) : isTrulyUnlinked ? (
                <div className="p-8 text-center flex flex-col items-center justify-center my-auto space-y-3">
                  <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shadow-inner">
                    <QrCode className="w-7 h-7" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-slate-800 dark:text-white">Device Not Linked</h4>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-[200px] leading-relaxed mx-auto">
                      Link your WhatsApp device to view your private conversations securely.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowQRModal(true)}
                    className="mt-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition-all shadow-sm hover:scale-105 active:scale-95 cursor-pointer"
                  >
                    Scan QR Code
                  </button>
                </div>
              ) : filteredConversations.length === 0 ? (
                <div className="p-8 text-center text-slate-400 text-xs">
                  {searchQuery.trim() ? (
                    <Search className="w-8 h-8 text-slate-400 mx-auto mb-2 opacity-50" />
                  ) : (
                    <MessageSquare className="w-8 h-8 text-slate-400 mx-auto mb-2 opacity-50" />
                  )}
                  <p className={isDark ? "text-slate-300 font-medium" : "text-slate-700 font-medium"}>
                    {searchQuery.trim() ? `No chats found for "${searchQuery}"` : "No WhatsApp conversations yet."}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-1">
                    {searchQuery.trim() ? "Try searching for a different name or phone number." : "Incoming messages will appear here automatically."}
                  </p>
                  {searchQuery.trim() && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery("")}
                      className="mt-3 px-3 py-1 text-xs rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer font-medium transition-colors"
                    >
                      Clear search
                    </button>
                  )}
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


                        {/* Last message preview + unread pill */}
                        <div className="flex items-center justify-between gap-1">
                          <div className={cn(
                            "flex items-center gap-1 text-[11px] truncate min-w-0",
                            conv.unreadCount > 0 && !isSelected
                              ? isDark ? "text-slate-200 font-semibold" : "text-slate-900 font-semibold"
                              : isDark ? "text-slate-400" : "text-slate-500"
                          )}>
                            {conv.last_direction === "OUTBOUND" && (
                              <CheckCheck className={cn(
                                "w-3.5 h-3.5 shrink-0 inline mr-0.5",
                                conv.last_status === "READ" ? "text-[#53bdeb]" : "text-slate-400"
                              )} />
                            )}
                            <span className="truncate">
                              {formatLastMessagePreview(conv.lastMessage) || "Click to open conversation"}
                            </span>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            {conv.is_pinned && (
                              <span title="Pinned conversation">
                                <Pin className="w-3 h-3 text-amber-500 fill-amber-500 shrink-0" />
                              </span>
                            )}
                            {conv.unreadCount > 0 && !isSelected && (
                              <span className="min-w-4.5 h-4.5 px-1.5 rounded-full bg-emerald-500 text-white text-[10px] font-bold flex items-center justify-center shrink-0 shadow-2xs">
                                {conv.unreadCount}
                              </span>
                            )}
                            <div className="hidden group-hover:flex items-center gap-0.5 bg-slate-200/80 dark:bg-slate-800/80 rounded-md p-0.5 ml-1">
                              <button
                                type="button"
                                onClick={(e) => handleTogglePin(conv.phone, e)}
                                className="p-1 hover:text-amber-500 transition-colors cursor-pointer"
                                title={conv.is_pinned ? "Unpin chat" : "Pin chat"}
                              >
                                <Pin className={cn("w-3 h-3", conv.is_pinned && "fill-amber-500 text-amber-500")} />
                              </button>
                              <button
                                type="button"
                                onClick={(e) => handleToggleArchive(conv.phone, e)}
                                className="p-1 hover:text-indigo-500 transition-colors cursor-pointer"
                                title={conv.is_archived ? "Unarchive chat" : "Archive chat"}
                              >
                                <Archive className="w-3 h-3" />
                              </button>
                            </div>
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
            {isTrulyUnlinked ? (
              <div className="flex-1 flex flex-col items-center justify-center p-8 space-y-4">
                <div className="w-16 h-16 rounded-3xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shadow-inner">
                  <ShieldCheck className="w-8 h-8" />
                </div>
                <div className="text-center space-y-1">
                  <h3 className={cn("font-bold text-lg", isDark ? "text-white" : "text-slate-900")}>
                    WhatsApp Device Not Linked
                  </h3>
                  <p className={cn("text-xs text-center max-w-sm leading-relaxed", isDark ? "text-slate-400" : "text-slate-500")}>
                    Your WhatsApp device is not connected. All conversations are hidden for security until you scan your personal QR code.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowQRModal(true)}
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition-all shadow-md hover:scale-105 active:scale-95 cursor-pointer flex items-center gap-2"
                >
                  <QrCode className="w-4 h-4" />
                  <span>Scan QR Code to Connect</span>
                </button>
              </div>
            ) : activeChat ? (
              <>
                {/* Chat Header */}
                <div className={cn(
                  "h-16 px-4 sm:px-5 border-b backdrop-blur-md flex items-center justify-between shrink-0 z-20 transition-colors gap-3 overflow-visible",
                  isDark ? "border-[#1E293B] bg-[#090A0F]/90 text-white" : "border-slate-200 bg-white/95 text-slate-900 shadow-2xs"
                )}>
                  {/* Contact Identity - Clicking profile or name opens CRM Lead Context Drawer */}
                  <div
                    onClick={() => setShowRightDrawer(!showRightDrawer)}
                    className="flex items-center gap-3 min-w-0 flex-1 overflow-hidden cursor-pointer hover:opacity-90 transition-opacity select-none group"
                    title="Click to open CRM Lead Context"
                  >
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
                        <h3 className={cn("font-bold text-sm sm:text-base truncate leading-snug shrink min-w-0 group-hover:text-emerald-500 transition-colors", isDark ? "text-white" : "text-slate-900")}>
                          {activeChat.contactName}
                        </h3>
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

                  {/* Header Actions: Add to CRM + Send Quote + Search in Chat + Three Dots Menu */}
                  <div className="relative flex items-center gap-1.5 sm:gap-2 shrink-0">
                    {activeChat.is_converted ? (
                      <span className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-[11px] font-bold shrink-0 select-none">
                        <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                        <span>CRM Lead</span>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={handleConvertToLead}
                        disabled={isConvertingLead}
                        className="inline-flex items-center justify-center gap-1.5 h-9 px-3 sm:px-3.5 rounded-xl bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white text-xs font-bold whitespace-nowrap shadow-sm shadow-red-600/20 transition-all cursor-pointer hover:scale-102 active:scale-98 shrink-0 disabled:opacity-50"
                        title="Add this WhatsApp conversation into CRM Leads"
                      >
                        {isConvertingLead ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <UserPlus className="w-3.5 h-3.5 shrink-0" />
                        )}
                        <span>{isConvertingLead ? "Adding..." : "Add to CRM"}</span>
                      </button>
                    )}

                    <button
                      onClick={handleOpenQuotePicker}
                      className="inline-flex items-center justify-center gap-1.5 h-9 px-3.5 sm:px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold whitespace-nowrap shadow-sm shadow-emerald-600/25 transition-all cursor-pointer hover:scale-102 active:scale-98 shrink-0"
                      title="Select and send quotation to contact"
                    >
                      <FileText className="w-4 h-4 shrink-0" />
                      <span>Send Quote</span>
                    </button>

                    {/* Search Icon Button */}
                    <button
                      type="button"
                      onClick={() => {
                        setIsSearchInChatOpen(!isSearchInChatOpen);
                        if (isSearchInChatOpen) setChatSearchQuery("");
                      }}
                      className={cn(
                        "w-9 h-9 rounded-xl flex items-center justify-center transition-all cursor-pointer",
                        isSearchInChatOpen
                          ? "bg-emerald-600 text-white shadow-xs"
                          : isDark
                          ? "bg-white/5 hover:bg-white/10 text-slate-300"
                          : "bg-slate-100 hover:bg-slate-200 text-slate-700"
                      )}
                      title="Search messages in this chat"
                    >
                      <Search className="w-4 h-4" />
                    </button>

                    {/* Three-dots Menu Button */}
                    <button
                      type="button"
                      onClick={() => setShowMoreMenu(!showMoreMenu)}
                      className={cn(
                        "w-9 h-9 rounded-xl flex items-center justify-center transition-all cursor-pointer",
                        showMoreMenu
                          ? "bg-emerald-600 text-white shadow-xs"
                          : isDark
                          ? "bg-white/5 hover:bg-white/10 text-slate-300"
                          : "bg-slate-100 hover:bg-slate-200 text-slate-700"
                      )}
                      title="More options"
                    >
                      <MoreVertical className="w-4 h-4" />
                    </button>

                    {/* Dropdown Menu */}
                    {showMoreMenu && (
                      <>
                        <div className="fixed inset-0 z-40" onClick={() => setShowMoreMenu(false)} />
                        <div
                          className={cn(
                            "absolute right-0 top-11 w-52 rounded-2xl shadow-xl border py-1.5 z-50 animate-in fade-in zoom-in-95 duration-100",
                          isDark ? "bg-[#1E293B] border-white/10 text-slate-200" : "bg-white border-slate-200 text-slate-800"
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setShowMoreMenu(false);
                            setShowRightDrawer(true);
                          }}
                          className={cn(
                            "w-full px-3.5 py-2 text-xs flex items-center gap-2.5 transition-colors cursor-pointer text-left",
                            isDark ? "hover:bg-white/5" : "hover:bg-slate-50"
                          )}
                        >
                          <Info className="w-4 h-4 text-emerald-500" />
                          <span>Contact info</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setShowMoreMenu(false);
                            setIsSelectMode(!isSelectMode);
                            setSelectedMsgIds(new Set());
                          }}
                          className={cn(
                            "w-full px-3.5 py-2 text-xs flex items-center gap-2.5 transition-colors cursor-pointer text-left",
                            isDark ? "hover:bg-white/5" : "hover:bg-slate-50"
                          )}
                        >
                          <CheckSquare className="w-4 h-4 text-blue-500" />
                          <span>{isSelectMode ? "Exit select mode" : "Select messages"}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setShowMoreMenu(false);
                            if (activePhone) handleTogglePin(activePhone);
                          }}
                          className={cn(
                            "w-full px-3.5 py-2 text-xs flex items-center gap-2.5 transition-colors cursor-pointer text-left",
                            isDark ? "hover:bg-white/5" : "hover:bg-slate-50"
                          )}
                        >
                          <Pin className="w-4 h-4 text-amber-500" />
                          <span>{activeChat?.is_pinned ? "Unpin chat" : "Pin chat"}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setShowMoreMenu(false);
                            if (activePhone) handleToggleArchive(activePhone);
                          }}
                          className={cn(
                            "w-full px-3.5 py-2 text-xs flex items-center gap-2.5 transition-colors cursor-pointer text-left",
                            isDark ? "hover:bg-white/5" : "hover:bg-slate-50"
                          )}
                        >
                          <Archive className="w-4 h-4 text-indigo-500" />
                          <span>{activeChat?.is_archived ? "Unarchive chat" : "Archive chat"}</span>
                        </button>

                        <div className={cn("my-1 border-t", isDark ? "border-white/10" : "border-slate-100")} />

                        <button
                          type="button"
                          onClick={handleClearChat}
                          className={cn(
                            "w-full px-3.5 py-2 text-xs flex items-center gap-2.5 transition-colors cursor-pointer text-left text-amber-600 dark:text-amber-400",
                            isDark ? "hover:bg-white/5" : "hover:bg-slate-50"
                          )}
                        >
                          <Trash2 className="w-4 h-4" />
                          <span>Clear chat</span>
                        </button>

                        <button
                          type="button"
                          onClick={handleToggleBlockContact}
                          className={cn(
                            "w-full px-3.5 py-2 text-xs flex items-center gap-2.5 transition-colors cursor-pointer text-left",
                            activeChat?.is_blocked ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400",
                            isDark ? "hover:bg-white/5" : "hover:bg-slate-50"
                          )}
                        >
                          <Ban className="w-4 h-4" />
                          <span>{activeChat?.is_blocked ? "Unblock contact" : "Block contact"}</span>
                        </button>

                        <button
                          type="button"
                          onClick={handleDeleteContact}
                          className={cn(
                            "w-full px-3.5 py-2 text-xs flex items-center gap-2.5 transition-colors cursor-pointer text-left text-rose-600 dark:text-rose-400 font-semibold",
                            isDark ? "hover:bg-rose-500/10" : "hover:bg-rose-50"
                          )}
                        >
                          <UserX className="w-4 h-4" />
                          <span>Delete contact</span>
                        </button>
                      </div>
                    </>
                    )}
                  </div>
                </div>

                {/* Search In Chat Bar */}
                {isSearchInChatOpen && (
                  <div className={cn(
                    "px-4 py-2 border-b flex items-center gap-2 transition-all",
                    isDark ? "bg-[#131B2E]/90 border-white/5" : "bg-slate-50 border-slate-200"
                  )}>
                    <Search className="w-4 h-4 text-slate-400 shrink-0" />
                    <input
                      type="text"
                      value={chatSearchQuery}
                      onChange={(e) => setChatSearchQuery(e.target.value)}
                      placeholder="Search messages in this conversation..."
                      className={cn(
                        "flex-1 bg-transparent text-xs outline-none",
                        isDark ? "text-white placeholder:text-slate-500" : "text-slate-900 placeholder:text-slate-400"
                      )}
                      autoFocus
                    />
                    {chatSearchQuery && (
                      <button
                        type="button"
                        onClick={() => setChatSearchQuery("")}
                        className="text-xs text-slate-400 hover:text-slate-600 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setIsSearchInChatOpen(false);
                        setChatSearchQuery("");
                      }}
                      className="px-2 py-1 text-[11px] font-semibold text-slate-500 hover:text-slate-700 cursor-pointer"
                    >
                      Done
                    </button>
                  </div>
                )}

                {/* Select Mode Action Bar */}
                {isSelectMode && (
                  <div className={cn(
                    "px-4 py-2 border-b flex items-center justify-between transition-all",
                    isDark ? "bg-emerald-950/60 border-emerald-800/40 text-white" : "bg-emerald-50 border-emerald-200 text-emerald-900"
                  )}>
                    <div className="flex items-center gap-2 text-xs font-semibold">
                      <span>{selectedMsgIds.size} message(s) selected</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleDeleteSelectedMessages}
                        disabled={selectedMsgIds.size === 0}
                        className="px-3 py-1 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-all shadow-xs cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Delete Selected</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setIsSelectMode(false);
                          setSelectedMsgIds(new Set());
                        }}
                        className="px-2.5 py-1 text-xs text-slate-400 hover:text-slate-200 font-semibold cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {/* Message Stream Area */}
                <div
                  onScroll={(e) => {
                    const el = e.currentTarget;
                    const isUp = el.scrollHeight - el.scrollTop - el.clientHeight > 80;
                    isUserScrolledUpRef.current = isUp;
                  }}
                  className={cn(
                    "flex-1 overflow-y-auto px-3 py-3 sm:px-5 sm:py-4 scrollbar-thin",
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
                      <p className="text-xs">
                        {chatSearchQuery.trim() ? `No messages match "${chatSearchQuery}"` : "No previous message history with this contact."}
                      </p>
                      {!chatSearchQuery.trim() && (
                        <p className="text-[11px] opacity-75">
                          Type below or select a template to start conversation via Meta Cloud API.
                        </p>
                      )}
                    </div>
                  ) : (
                    (chatSearchQuery.trim()
                      ? messages.filter((m) => {
                          const q = chatSearchQuery.toLowerCase().trim();
                          return (
                            (m.text || "").toLowerCase().includes(q) ||
                            (m.caption || "").toLowerCase().includes(q) ||
                            (m.fileName || "").toLowerCase().includes(q)
                          );
                        })
                      : messages
                    ).map((msg, idx) => {
                      const isNearBottom = idx >= Math.max(0, messages.length - 6);
                      const isOutbound = msg.sender === "outbound";
                      const isSameSenderAsPrev = idx > 0 && messages[idx - 1]?.sender === msg.sender;
                      const spacingClass = isSameSenderAsPrev ? "mt-0.5 sm:mt-1" : (idx === 0 ? "mt-0" : "mt-2.5 sm:mt-3");
                      const cleanText = cleanDisplayCaption(msg.text, msg.fileName);
                      const isSticker = msg.attachment?.type === "sticker" || msg.messageType === "sticker" || (!cleanText && (msg.text || "").toLowerCase() === "[sticker]");
                      const isGif = msg.attachment?.type === "gif" || msg.messageType === "gif" || (msg.attachment?.name || "").toLowerCase().startsWith("gif_") || (msg.attachment?.url || "").toLowerCase().includes("gif_");
                      const isPureImage = msg.attachment?.type === "image" && !cleanText;
                      const isPureVideo = (msg.attachment?.type === "video" || isGif || msg.messageType === "video" || msg.messageType === "gif") && !cleanText;
                      const isDoc = msg.attachment?.type === "pdf" || msg.attachment?.type === "document";
                      const isVoice = msg.isVoiceNote || msg.messageType === "ptt" || msg.attachment?.type === "audio";
                      const isContactCard = msg.messageType === "contact" || msg.text === "[Contact Card]" || (typeof msg.text === "string" && (msg.text.startsWith('{"type":"contact"') || msg.text.includes("BEGIN:VCARD")));

                      return (
                        <div key={msg.id} className={cn("flex items-center gap-2", spacingClass)}>
                          {isSelectMode && (
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedMsgIds((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(msg.id)) next.delete(msg.id);
                                  else next.add(msg.id);
                                  return next;
                                });
                              }}
                              className="p-1 shrink-0 text-slate-400 hover:text-emerald-500 cursor-pointer self-center"
                            >
                              {selectedMsgIds.has(msg.id) ? (
                                <CheckSquare className="w-5 h-5 text-emerald-500 fill-emerald-500/20" />
                              ) : (
                                <Square className="w-5 h-5" />
                              )}
                            </button>
                          )}
                          <div className="flex-1 min-w-0">
                        <MessageBubbleContainer
                          key={msg.id}
                          msg={msg}
                          isOutbound={isOutbound}
                          isDark={isDark}
                          isNearBottom={isNearBottom}
                          activeContextMenuId={activeContextMenuId}
                          activeReactionMenuId={activeReactionMenuId}
                          setActiveContextMenuId={setActiveContextMenuId}
                          setActiveReactionMenuId={setActiveReactionMenuId}
                          onReact={(emoji) => handleReactToMessage(msg, emoji)}
                          onReply={() => handleReplyMessage(msg)}
                          onCopy={() => handleCopyMessage(msg)}
                          onEdit={isOutbound && !isVoice && !msg.attachment ? () => handleStartEditMessage(msg) : undefined}
                          onDelete={() => setDeleteConfirmMessage(msg)}
                          onInfo={() => setInfoModalMessage(msg)}
                        >
                          {/* 1. Sticker message with transparent background matching WhatsApp Web */}
                          {isSticker && msg.attachment?.url ? (
                            <div
                              className={cn(
                                "select-none transition-all w-fit relative bg-transparent border-0 shadow-none p-0 group",
                                isOutbound ? "ml-auto" : "mr-auto"
                              )}
                            >
                              {(() => {
                                const parsed = parseQuotedReply(cleanText);
                                return (
                                  <>
                                    {parsed.hasQuote && (
                                      <div className={cn(
                                        "w-full min-w-[170px] sm:min-w-[200px] rounded-lg px-2.5 py-1.5 mb-2 border-l-[3.5px] text-xs select-none flex flex-col justify-center transition-all",
                                        isOutbound
                                          ? (isDark ? "bg-black/30 border-l-[#ff5b79]" : "bg-black/5 border-l-[#ff5b79]")
                                          : (isDark ? "bg-black/30 border-l-[#ff5b79]" : "bg-black/5 border-l-[#ff5b79]")
                                      )}>
                                        <div className="font-bold text-[12px] text-[#ff5b79] truncate">
                                          {parsed.quotedSender}
                                        </div>
                                        <div className="text-[11px] text-slate-700 dark:text-slate-300 mt-0.5 line-clamp-2 break-words flex items-center gap-1">
                                          {parsed.quotedText.includes(":") || parsed.quotedText.includes("0:") ? (
                                            <>
                                              <Mic className="w-3 h-3 text-[#ff5b79]" />
                                              <span>{parsed.quotedText}</span>
                                            </>
                                          ) : (
                                            parsed.quotedText
                                          )}
                                        </div>
                                      </div>
                                    )}

                                    <div className="relative rounded-xl overflow-hidden cursor-pointer">
                                      <img
                                        src={msg.attachment.url}
                                        alt="WhatsApp Sticker"
                                        className="w-36 h-36 max-w-[150px] max-h-[150px] object-contain drop-shadow-sm transition-transform hover:scale-105 block select-none pointer-events-auto"
                                        onClick={() => setSelectedImagePreview(msg.attachment?.url || null)}
                                        onError={(e) => {
                                          const img = e.currentTarget;
                                          if (!img.dataset.step) {
                                            img.dataset.step = "1";
                                            const fallback = getSmartMediaFallback(msg.attachment?.url, 1);
                                            if (fallback) {
                                              img.src = fallback;
                                              return;
                                            }
                                          }
                                          if (img.dataset.step === "1") {
                                            img.dataset.step = "2";
                                            const fallback = getSmartMediaFallback(msg.attachment?.url, 2);
                                            if (fallback) {
                                              img.src = fallback;
                                              return;
                                            }
                                          }
                                          img.style.display = "none";
                                        }}
                                      />
                                    </div>

                                    {/* Time discreetly beside / beneath sticker */}
                                    <div className={cn(
                                      "flex items-center justify-end gap-1 text-[11px] font-sans whitespace-nowrap mt-0.5 px-1 select-none",
                                      isDark ? "text-slate-400" : "text-slate-500"
                                    )}>
                                      <span>{msg.timeLabel}</span>
                                      {isOutbound && (
                                        <CheckCheck className={cn("w-3.5 h-3.5 shrink-0", msg.status === "READ" ? "text-[#53bdeb]" : "text-slate-400")} />
                                      )}
                                    </div>
                                  </>
                                );
                              })()}
                            </div>
                          ) : isSticker && !msg.attachment?.url ? (
                            msg.mediaBase64 ? (
                              <div
                                className={cn(
                                  "select-none transition-all w-fit relative bg-transparent border-0 shadow-none p-0 group",
                                  isOutbound ? "ml-auto" : "mr-auto"
                                )}
                              >
                                <div className="relative rounded-xl overflow-hidden cursor-pointer">
                                  <img
                                    src={`data:image/webp;base64,${msg.mediaBase64}`}
                                    alt="WhatsApp Sticker"
                                    className="w-36 h-36 max-w-[150px] max-h-[150px] object-contain drop-shadow-sm transition-transform hover:scale-105 block select-none pointer-events-auto"
                                    onClick={() => setSelectedImagePreview(`data:image/webp;base64,${msg.mediaBase64}`)}
                                  />
                                </div>
                                <div className={cn(
                                  "flex items-center justify-end gap-1 text-[11px] font-sans whitespace-nowrap mt-0.5 px-1 select-none",
                                  isDark ? "text-slate-400" : "text-slate-500"
                                )}>
                                  <span>{msg.timeLabel}</span>
                                  {isOutbound && (
                                    <CheckCheck className={cn("w-3.5 h-3.5 shrink-0", msg.status === "READ" ? "text-[#53bdeb]" : "text-slate-400")} />
                                  )}
                                </div>
                              </div>
                            ) : (
                              <div
                                className={cn(
                                  "rounded-2xl px-3 py-2 text-xs select-none transition-all shadow-xs w-fit flex items-center gap-2",
                                  isOutbound
                                    ? (isDark ? "bg-[#005c4b] text-white rounded-tr-xs ml-auto" : "bg-[#D9FDD3] text-slate-800 rounded-tr-xs shadow-2xs border border-[#C2EBC0]")
                                    : (isDark ? "bg-[#202c33] text-white rounded-tl-xs" : "bg-white text-slate-800 rounded-tl-xs shadow-2xs border border-slate-200/90")
                                )}
                              >
                                <Smile className="w-4 h-4 text-amber-500 shrink-0" />
                                <span className="font-medium">Sticker</span>
                                <span className="text-[10px] opacity-75 ml-1">{msg.timeLabel}</span>
                                {isOutbound && (
                                  <CheckCheck className={cn("w-3.5 h-3.5 shrink-0", msg.status === "READ" ? "text-[#53bdeb]" : "text-slate-400")} />
                                )}
                              </div>
                            )
                          ) : isPureImage ? (
                            /* 2. Pure Image (Preview if URL available, compact fallback card if missing) */
                            msg.attachment?.url ? (
                              <div
                                className={cn(
                                  "rounded-xl p-[3px] shadow-xs select-none transition-all relative overflow-hidden",
                                  isOutbound
                                    ? (isDark ? "bg-[#005c4b] rounded-tr-xs ml-auto" : "bg-[#D9FDD3] rounded-tr-xs ml-auto shadow-2xs border border-[#C2EBC0]")
                                    : (isDark ? "bg-[#202c33] rounded-tl-xs" : "bg-white rounded-tl-xs shadow-2xs border border-slate-200/90")
                                )}
                              >
                                <div className="relative rounded-lg overflow-hidden max-w-[280px] sm:max-w-[340px]">
                                  <img
                                    src={msg.attachment.url}
                                    alt="Photo"
                                    className="w-full max-h-[380px] object-cover rounded-lg block cursor-pointer transition-transform hover:scale-[1.01]"
                                    onClick={() => setSelectedImagePreview(msg.attachment?.url || null)}
                                    onError={(e) => {
                                      const img = e.currentTarget;
                                      if (msg.mediaBase64 && !img.dataset.b64Tried) {
                                        img.dataset.b64Tried = "1";
                                        img.src = `data:image/jpeg;base64,${msg.mediaBase64}`;
                                        return;
                                      }
                                      if (!img.dataset.step) {
                                        img.dataset.step = "1";
                                        const fallback = getSmartMediaFallback(msg.attachment?.url, 1);
                                        if (fallback) {
                                          img.src = fallback;
                                          return;
                                        }
                                      }
                                      if (img.dataset.step === "1") {
                                        img.dataset.step = "2";
                                        const fallback = getSmartMediaFallback(msg.attachment?.url, 2);
                                        if (fallback) {
                                          img.src = fallback;
                                          return;
                                        }
                                      }
                                      img.style.display = "none";
                                      const fallback = img.nextElementSibling;
                                      if (fallback) fallback.classList.remove("hidden");
                                    }}
                                  />
                                  <div className="hidden p-3 flex items-center gap-2 text-xs">
                                    <span className="text-base">📷</span>
                                    <span className="font-medium truncate">{msg.attachment?.name || msg.fileName || "Photo"}</span>
                                  </div>
                                  <div className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded-md bg-black/60 backdrop-blur-xs text-white text-[10px] font-medium flex items-center gap-1 shadow-sm pointer-events-none">
                                    <span>{msg.timeLabel}</span>
                                    {isOutbound && (
                                      <CheckCheck
                                        className={cn(
                                          "w-3.5 h-3.5",
                                          msg.status === "READ" ? "text-[#53bdeb]" : "text-white/80"
                                        )}
                                      />
                                    )}
                                  </div>
                                </div>
                              </div>
                            ) : (
                              <div
                                className={cn(
                                  "rounded-xl px-3 py-2 text-xs flex items-center gap-2 select-none shadow-xs w-fit",
                                  isOutbound
                                    ? (isDark ? "bg-[#005c4b] text-white rounded-tr-xs ml-auto" : "bg-[#D9FDD3] text-slate-800 rounded-tr-xs shadow-2xs border border-[#C2EBC0]")
                                    : (isDark ? "bg-[#202c33] text-white rounded-tl-xs" : "bg-white text-slate-800 rounded-tl-xs shadow-2xs border border-slate-200/90")
                                )}
                              >
                                <span className="text-base shrink-0">📷</span>
                                <span className="font-medium truncate max-w-[170px] sm:max-w-[220px]">
                                  {msg.attachment?.name || msg.fileName || "Photo"}
                                </span>
                                <span className="text-[10px] opacity-75 ml-2 whitespace-nowrap">{msg.timeLabel}</span>
                                {isOutbound && (
                                  <CheckCheck className={cn("w-3.5 h-3.5 shrink-0", msg.status === "READ" ? "text-[#53bdeb]" : "text-slate-400")} />
                                )}
                              </div>
                            )
                          ) : isPureVideo && msg.attachment?.url ? (
                            /* 3. Pure Video / Animated GIF */
                            <div
                              className={cn(
                                "rounded-2xl p-1 select-none transition-all relative overflow-hidden shadow-xs",
                                isOutbound
                                  ? (isDark ? "bg-[#005c4b] rounded-tr-xs ml-auto" : "bg-[#D9FDD3] rounded-tr-xs ml-auto shadow-2xs border border-[#C2EBC0]")
                                  : (isDark ? "bg-[#202c33] rounded-tl-xs" : "bg-[#f0f2f5] rounded-tl-xs shadow-2xs border border-slate-200/60")
                              )}
                            >
                              <div className="relative rounded-xl overflow-hidden max-w-[290px] sm:max-w-[340px] bg-black">
                                {isGif ? (
                                  <div className="relative group cursor-pointer" onClick={() => setSelectedImagePreview(msg.attachment?.url || null)}>
                                    <video
                                      src={msg.attachment.url}
                                      autoPlay
                                      loop
                                      muted
                                      playsInline
                                      className="w-full max-h-[340px] rounded-xl object-contain block"
                                    />
                                    <div className="absolute bottom-2 left-2 px-1.5 py-0.5 rounded bg-black/60 backdrop-blur-xs text-white text-[10px] font-bold tracking-wider uppercase pointer-events-none">
                                      GIF
                                    </div>
                                  </div>
                                ) : (
                                  <video
                                    src={msg.attachment.url}
                                    controls
                                    preload="metadata"
                                    className="w-full max-h-[340px] rounded-xl object-contain block"
                                  />
                                )}
                                <div className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded-md bg-black/60 backdrop-blur-xs text-white text-[10px] font-medium flex items-center gap-1 shadow-sm pointer-events-none">
                                  <span>{msg.timeLabel}</span>
                                  {isOutbound && (
                                    <CheckCheck
                                      className={cn(
                                        "w-3.5 h-3.5",
                                        msg.status === "READ" ? "text-[#53bdeb]" : "text-white/80"
                                      )}
                                    />
                                  )}
                                </div>
                              </div>
                            </div>
                          ) : isPureVideo && !msg.attachment?.url ? (
                            <div
                              className={cn(
                                "rounded-2xl px-3 py-2 text-xs select-none transition-all shadow-xs w-fit flex items-center gap-2",
                                isOutbound
                                  ? (isDark ? "bg-[#005c4b] text-white rounded-tr-xs ml-auto" : "bg-[#D9FDD3] text-slate-800 rounded-tr-xs shadow-2xs border border-[#C2EBC0]")
                                  : (isDark ? "bg-[#202c33] text-white rounded-tl-xs" : "bg-white text-slate-800 rounded-tl-xs shadow-2xs border border-slate-200/90")
                              )}
                            >
                              <Film className="w-4 h-4 text-blue-500 shrink-0" />
                              <span className="font-medium">{isGif ? "GIF" : "Video"}</span>
                              <span className="text-[10px] opacity-75 ml-1">{msg.timeLabel}</span>
                              {isOutbound && (
                                <CheckCheck className={cn("w-3.5 h-3.5 shrink-0", msg.status === "READ" ? "text-[#53bdeb]" : "text-slate-400")} />
                              )}
                            </div>
                          ) : isContactCard ? (
                            /* 4. Contact Card */
                            (() => {
                              let contactDisplayName = "+91 86100 68470";
                              let contactPhone = "918610068470";
                              if (typeof msg.text === "string" && msg.text.startsWith('{"type":"contact"')) {
                                try {
                                  const p = JSON.parse(msg.text);
                                  contactDisplayName = p.displayName || p.phone || contactDisplayName;
                                  contactPhone = p.phone || contactPhone;
                                } catch (_) {}
                              }
                              return (
                                <div
                                  className={cn(
                                    "w-64 sm:w-72 rounded-xl overflow-hidden border shadow-xs transition-all",
                                    isOutbound
                                      ? (isDark ? "bg-[#005c4b] border-emerald-600/30 text-white rounded-tr-xs ml-auto" : "bg-[#D9FDD3] border-[#C2EBC0] text-slate-900 rounded-tr-xs ml-auto shadow-2xs")
                                      : (isDark ? "bg-[#202c33] border-white/10 text-white rounded-tl-xs" : "bg-white border-slate-200 text-slate-900 rounded-tl-xs shadow-2xs")
                                  )}
                                >
                                  <div className="p-3 flex items-center justify-between gap-3">
                                    <div className="flex items-center gap-2.5 min-w-0">
                                      <div className="w-10 h-10 rounded-full bg-pink-500 text-white flex items-center justify-center shrink-0 shadow-xs">
                                        <User className="w-5 h-5" />
                                      </div>
                                      <div className="min-w-0">
                                        <div className={cn("text-xs sm:text-sm font-bold truncate", isDark ? "text-white" : "text-slate-900")}>
                                          {contactDisplayName}
                                        </div>
                                        <div className="text-[11px] text-slate-400">
                                          WhatsApp Contact
                                        </div>
                                      </div>
                                    </div>
                                    <div className="text-[10px] text-slate-400 self-start shrink-0">
                                      {msg.timeLabel}
                                    </div>
                                  </div>
                                  <div className="border-t border-slate-200 dark:border-white/10" />
                                  <div className="flex items-center divide-x divide-slate-200 dark:divide-white/10">
                                    <button
                                      type="button"
                                      onClick={() => handleSelectChat(contactPhone)}
                                      className="flex-1 py-2 text-center text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer"
                                    >
                                      Message
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        handleChatInitiated(contactPhone, contactDisplayName);
                                        toast.success("Contact Saved", `Added ${contactDisplayName} to CRM contacts`);
                                      }}
                                      className="flex-1 py-2 text-center text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer"
                                    >
                                      Save contact
                                    </button>
                                  </div>
                                </div>
                              );
                            })()
                          ) : isDoc ? (
                            /* 5. Document */
                            (() => {
                              const ext = (msg.attachment?.name || msg.fileName || "").split(".").pop()?.toLowerCase();
                              const isWord = ext === "doc" || ext === "docx";
                              const isExcel = ext === "xls" || ext === "xlsx" || ext === "csv";
                              const isPdf = ext === "pdf";
                              return (
                                <div
                                  className={cn(
                                    "w-64 sm:w-72 rounded-xl overflow-hidden border shadow-xs transition-all p-2.5",
                                    isOutbound
                                      ? (isDark ? "bg-[#005c4b] border-emerald-600/30 text-white rounded-tr-xs ml-auto" : "bg-[#D9FDD3] border-[#C2EBC0] text-slate-900 rounded-tr-xs ml-auto shadow-2xs")
                                      : (isDark ? "bg-[#202c33] border-white/10 text-white rounded-tl-xs" : "bg-white border-slate-200 text-slate-900 rounded-tl-xs shadow-2xs")
                                  )}
                                >
                                  <div className="flex items-center justify-between gap-3">
                                    <div className="flex items-center gap-2.5 min-w-0">
                                      <div className={cn(
                                        "w-10 h-10 rounded-lg flex items-center justify-center shrink-0 font-bold text-xs shadow-xs text-white",
                                        isWord ? "bg-blue-600" : isExcel ? "bg-emerald-600" : isPdf ? "bg-red-600" : "bg-teal-600"
                                      )}>
                                        {isWord ? "W" : isExcel ? "X" : isPdf ? "PDF" : <File className="w-5 h-5" />}
                                      </div>
                                      <div className="min-w-0 flex-1">
                                        <div className={cn("text-xs font-semibold truncate", isDark ? "text-white" : "text-slate-900")} title={msg.attachment?.name || msg.fileName || undefined}>
                                          {msg.attachment?.name || msg.fileName || "Document"}
                                        </div>
                                        <div className={cn("text-[10px] mt-0.5", isDark ? "text-slate-400" : "text-slate-500")}>
                                          {ext?.toUpperCase() || "FILE"} • {msg.attachment?.size || "Document"}
                                        </div>
                                      </div>
                                    </div>
                                    <a
                                      href={msg.attachment?.url || msg.mediaUrl || "#"}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      download={msg.attachment?.name || msg.fileName || undefined}
                                      className={cn(
                                        "w-8 h-8 rounded-full border flex items-center justify-center shrink-0 transition-transform active:scale-95",
                                        isDark ? "border-white/10 hover:bg-white/10 text-slate-300" : "border-slate-300 hover:bg-black/5 text-slate-700"
                                      )}
                                      title="Download file"
                                    >
                                      <Download className="w-4 h-4" />
                                    </a>
                                  </div>
                                  <div className={cn(
                                    "flex items-center justify-end gap-1 text-[10px] mt-1.5",
                                    isDark ? "text-slate-400" : "text-slate-500"
                                  )}>
                                    <span>{msg.timeLabel}</span>
                                    {isOutbound && (
                                      <CheckCheck className={cn("w-3.5 h-3.5", msg.status === "READ" ? "text-[#53bdeb]" : "text-slate-400")} />
                                    )}
                                  </div>
                                </div>
                              );
                            })()
                          ) : isVoice ? (
                            /* 6. Voice Note (PTT) */
                            <div
                              className={cn(
                                "rounded-2xl p-2.5 pr-6 text-sm transition-all shadow-xs w-fit min-w-[285px] sm:min-w-[315px]",
                                isOutbound
                                  ? (isDark ? "bg-[#005c4b] border border-emerald-600/30 text-white rounded-tr-xs" : "bg-[#D9FDD3] border border-[#C2EBC0] text-slate-900 rounded-tr-xs shadow-2xs")
                                  : (isDark ? "bg-[#202c33] border border-white/10 text-white rounded-tl-xs" : "bg-white border border-slate-200 text-slate-900 rounded-tl-xs shadow-2xs")
                              )}
                            >
                              <VoiceNotePlayer
                                audioUrl={msg.attachment?.url || msg.mediaUrl || ""}
                                isOutbound={isOutbound}
                                isDark={isDark}
                                durationHint={(() => {
                                  const match = (msg.text || "").match(/\((\d+)s\)/);
                                  if (match) return parseInt(match[1], 10);
                                  const fileMatch = (msg.fileName || "").match(/voice_(\d+)s/);
                                  if (fileMatch) return parseInt(fileMatch[1], 10);
                                  return undefined;
                                })()}
                                avatarUrl={activeChat?.avatar_url || null}
                                contactName={activeChat?.contactName || null}
                                senderAvatarUrl={linkedUserAvatar || currentUser?.picture || currentUser?.avatar_url || null}
                                timeLabel={msg.timeLabel}
                                status={msg.status}
                              />
                            </div>
                          ) : (
                            /* 7. Standard Text / Media with Caption */
                            (() => {
                              const parsed = msg.quotedContext ? {
                                hasQuote: true,
                                quotedSender: msg.quotedContext.sender || "Contact",
                                quotedText: msg.quotedContext.text || "",
                                body: cleanText
                              } : parseQuotedReply(cleanText);
                              return (
                                <div
                                  className={cn(
                                    "rounded-2xl px-3 py-2 pr-7 text-sm leading-relaxed transition-all shadow-xs w-fit",
                                    parsed.hasQuote ? "min-w-[195px] sm:min-w-[220px]" : "min-w-[90px]",
                                    isOutbound
                                      ? (isDark
                                          ? "bg-[#005c4b] border border-emerald-600/30 text-white rounded-tr-xs"
                                          : "bg-[#D9FDD3] border border-[#C2EBC0] text-slate-900 rounded-tr-xs shadow-2xs")
                                      : (isDark
                                          ? "bg-[#202c33] border border-white/10 text-white rounded-tl-xs"
                                          : "bg-white border border-slate-200/90 text-slate-900 rounded-tl-xs shadow-2xs")
                                  )}
                                >
                                  {msg.attachment?.type === "image" && msg.attachment.url && (
                                    <div className="mb-2 rounded-xl overflow-hidden cursor-pointer group shadow-sm">
                                      <img
                                        src={msg.attachment.url}
                                        alt="Photo"
                                        className="w-full max-h-64 object-cover rounded-xl transition-transform hover:scale-101"
                                        onClick={() => setSelectedImagePreview(msg.attachment?.url || null)}
                                        onError={(e) => {
                                          const img = e.currentTarget;
                                          if (!img.dataset.step) {
                                            img.dataset.step = "1";
                                            const fallback = getSmartMediaFallback(msg.attachment?.url, 1);
                                            if (fallback) {
                                              img.src = fallback;
                                              return;
                                            }
                                          }
                                          if (img.dataset.step === "1") {
                                            img.dataset.step = "2";
                                            const fallback = getSmartMediaFallback(msg.attachment?.url, 2);
                                            if (fallback) {
                                              img.src = fallback;
                                              return;
                                            }
                                          }
                                          img.style.display = "none";
                                        }}
                                      />
                                    </div>
                                  )}

                                  {(msg.attachment?.type === "video" || isGif || msg.messageType === "video" || msg.messageType === "gif") && msg.attachment?.url && (
                                    <div className="mb-2 rounded-xl overflow-hidden shadow-sm bg-black relative max-w-[290px] sm:max-w-[340px]">
                                      {isGif ? (
                                        <>
                                          <video
                                            src={msg.attachment.url}
                                            autoPlay
                                            loop
                                            muted
                                            playsInline
                                            className="w-full max-h-72 rounded-xl object-contain block"
                                          />
                                          <div className="absolute bottom-2 left-2 px-1.5 py-0.5 rounded bg-black/60 backdrop-blur-xs text-white text-[10px] font-bold tracking-wider uppercase pointer-events-none">
                                            GIF
                                          </div>
                                        </>
                                      ) : (
                                        <video
                                          src={msg.attachment.url}
                                          controls
                                          preload="metadata"
                                          className="w-full max-h-72 rounded-xl object-contain block"
                                        />
                                      )}
                                    </div>
                                  )}

                                  {/* Quoted Tag UI matching real WhatsApp Web (Image 10) */}
                                  {parsed.hasQuote && (
                                    <div className={cn(
                                      "w-full min-w-[180px] sm:min-w-[205px] rounded-[6px] px-2.5 py-1.5 mb-1.5 border-l-[3.5px] text-xs select-none transition-all overflow-hidden",
                                      isOutbound
                                        ? (isDark
                                            ? "bg-black/25 border-l-[#53bdeb]"
                                            : "bg-black/[0.06] border-l-[#00a884]")
                                        : (isDark
                                            ? "bg-black/25 border-l-[#00a884]"
                                            : "bg-black/[0.06] border-l-[#00a884]")
                                    )}>
                                      <div className="flex flex-col leading-snug gap-0.5">
                                        <span className={cn(
                                          "font-semibold text-[12px] truncate",
                                          isOutbound
                                            ? (isDark ? "text-[#53bdeb]" : "text-[#00a884]")
                                            : "text-[#00a884]"
                                        )}>
                                          {parsed.quotedSender}
                                        </span>
                                        <span className="text-[12px] line-clamp-2 break-words opacity-85 text-slate-800 dark:text-slate-200">
                                          {parsed.quotedText}
                                        </span>
                                      </div>
                                    </div>
                                  )}

                                    <div className="flex flex-wrap items-baseline justify-end gap-x-2.5 gap-y-0.5 min-w-0">
                                      {cleanDisplayCaption(parsed.body, msg.fileName) ? (
                                        <span className="whitespace-pre-wrap select-text break-words text-sm mr-auto">
                                          {cleanDisplayCaption(parsed.body, msg.fileName)}
                                        </span>
                                      ) : !msg.attachment?.url && !isVoice && !isDoc && !isContactCard ? (
                                        <span className="italic text-xs text-slate-400 mr-auto">
                                          {msg.text && !["[Empty Message]", "[Attachment Received]"].includes(msg.text)
                                            ? cleanDisplayCaption(msg.text, msg.fileName) || "Active message"
                                            : "Active message"}
                                        </span>
                                      ) : null}

                                      <span className={cn(
                                        "inline-flex items-center gap-1 text-[11px] font-sans whitespace-nowrap select-none shrink-0 ml-auto mt-0.5",
                                        isDark ? "text-slate-400" : "text-slate-500"
                                      )}>
                                        <span>{msg.timeLabel}</span>
                                        {msg.isEdited && (
                                          <span className="text-[10px] italic opacity-75 mr-0.5">(edited)</span>
                                        )}
                                        {isOutbound && (
                                          <span title={msg.status === "READ" ? "Read" : "Delivered"}>
                                            {msg.status === "PENDING" ? (
                                              <Clock className="w-3.5 h-3.5 text-slate-400" />
                                            ) : (
                                              <CheckCheck
                                                className={cn(
                                                  "w-3.5 h-3.5 shrink-0",
                                                  msg.status === "READ" ? "text-[#53bdeb]" : "text-slate-400"
                                                )}
                                              />
                                            )}
                                          </span>
                                        )}
                                      </span>
                                    </div>
                                  </div>
                                );
                              })()
                            )}
                        </MessageBubbleContainer>
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

                                {/* Reply Quoted Message Preview Banner */}
                {replyingToMessage && (
                  <div className={cn(
                    "mx-4 mb-2 p-2.5 rounded-xl border-l-4 border-l-[#00a884] shadow-md flex items-center justify-between gap-3 text-xs animate-in fade-in slide-in-from-bottom-2",
                    isDark ? "bg-[#202c33] border-t border-r border-b border-white/10 text-white" : "bg-emerald-50 border border-emerald-200 text-slate-800"
                  )}>
                    <div className="min-w-0 flex-1">
                      <div className="font-bold text-[#00a884] text-[11px] flex items-center gap-1">
                        <CornerUpLeft className="w-3.5 h-3.5" />
                        <span>Replying to {replyingToMessage.sender === "outbound" ? "You" : activeChat?.contactName}</span>
                      </div>
                      <p className="truncate text-slate-500 dark:text-slate-400 text-[11px] mt-0.5">
                        {replyingToMessage.text ? (parseQuotedReply(replyingToMessage.text).body || replyingToMessage.text) : (replyingToMessage.fileName || "[Attachment]")}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setReplyingToMessage(null)}
                      className="p-1 rounded-full hover:bg-black/5 dark:hover:bg-white/10 text-slate-400 cursor-pointer"
                      title="Cancel reply"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}

                {/* Edit Message Banner */}
                {editingMessage && (
                  <div className={cn(
                    "mx-4 mb-2 p-2.5 rounded-xl border-l-4 border-l-blue-500 shadow-md flex items-center justify-between gap-3 text-xs animate-in fade-in slide-in-from-bottom-2",
                    isDark ? "bg-[#202c33] border-t border-r border-b border-white/10 text-white" : "bg-blue-50 border border-blue-200 text-slate-800"
                  )}>
                    <div className="min-w-0 flex-1">
                      <div className="font-bold text-blue-500 text-[11px] flex items-center gap-1">
                        <Pencil className="w-3.5 h-3.5" />
                        <span>Editing message</span>
                      </div>
                      <p className="truncate text-slate-500 dark:text-slate-400 text-[11px] mt-0.5">
                        {editingMessage.text}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleCancelEdit}
                      className="p-1 rounded-full hover:bg-black/5 dark:hover:bg-white/10 text-slate-400 cursor-pointer"
                      title="Cancel edit"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}

                {/* Message Input Dock or Blocked Banner */}
                {activeChat?.is_blocked ? (
                  <div className={cn(
                    "p-4 border-t text-center flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0",
                    isDark ? "border-[#1E293B] bg-[#090A0F] text-slate-300" : "border-slate-200 bg-slate-50 text-slate-700"
                  )}>
                    <div className="flex items-center gap-2 text-xs font-semibold text-rose-500">
                      <Ban className="w-4 h-4 shrink-0" />
                      <span>This contact is blocked. You cannot send or receive messages with this contact.</span>
                    </div>
                    <button
                      type="button"
                      onClick={handleToggleBlockContact}
                      className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition-all cursor-pointer shadow-xs shrink-0"
                    >
                      Unblock Contact
                    </button>
                  </div>
                ) : (
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
                        ref={messageInputRef}
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
                )}
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
              <div className={cn("p-4 border-b space-y-3", isDark ? "border-[#1E293B]/60" : "border-slate-200")}>
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
                  </div>
                </div>

                {/* Only Number below name */}
                <div className="space-y-2 pt-1 text-xs">
                  <div className={cn("flex items-center gap-2.5 p-2 rounded-xl border transition-colors", isDark ? "bg-white/5 border-white/5 text-slate-200" : "bg-slate-50 border-slate-200/80 text-slate-700")}>
                    <Phone className="w-3.5 h-3.5 shrink-0 text-emerald-500" />
                    <span className="font-mono text-xs truncate select-all">{activeChat.phone}</span>
                  </div>

                  {/* Add to Contact Button */}
                  <button
                    type="button"
                    onClick={handleAddToContact}
                    disabled={isAddingContact}
                    className={cn(
                      "w-full h-9 flex items-center justify-center gap-2 px-3 rounded-xl font-semibold text-xs transition-all cursor-pointer shadow-xs hover:scale-101 active:scale-98",
                      isDark
                        ? "bg-emerald-600 hover:bg-emerald-500 text-white"
                        : "bg-emerald-600 hover:bg-emerald-700 text-white"
                    )}
                  >
                    {isAddingContact ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <UserPlus className="w-3.5 h-3.5" />
                    )}
                    <span>{isContactSaved || activeChat.contact_id ? "Saved to Contacts" : "Add to Contact"}</span>
                  </button>
                </div>
              </div>

              {/* Deal Status & Pipeline */}
              <div className={cn("p-4 border-b space-y-3", isDark ? "border-[#1E293B]/60" : "border-slate-200")}>
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

                {/* Create Deal Button below the amount enter */}
                <button
                  type="button"
                  onClick={handleCreateDealFromDrawer}
                  disabled={isCreatingDeal}
                  className={cn(
                    "w-full h-9 flex items-center justify-center gap-2 px-3 rounded-xl font-semibold text-xs transition-all cursor-pointer shadow-xs hover:scale-101 active:scale-98",
                    isDark
                      ? "bg-indigo-600 hover:bg-indigo-500 text-white"
                      : "bg-indigo-600 hover:bg-indigo-700 text-white"
                  )}
                >
                  {isCreatingDeal ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Handshake className="w-3.5 h-3.5" />}
                  <span>Create Deal</span>
                </button>

                <div className={cn("flex items-center justify-between text-xs pt-1 border-t", isDark ? "border-white/5 text-slate-400" : "border-slate-200/80 text-slate-500")}>
                  <span>Target Close Date:</span>
                  <span className={cn("font-semibold", isDark ? "text-slate-200" : "text-slate-800")}>{activeChat.dealCloseDate}</span>
                </div>
              </div>

              {/* Internal Notes & CRM Section (Text Area UP, Button BELOW) */}
              <div className={cn("p-4 border-b space-y-2.5", isDark ? "border-[#1E293B]/60" : "border-slate-200")}>
                <span className={cn("font-bold text-xs block uppercase tracking-wider", isDark ? "text-slate-400" : "text-slate-500")}>
                  Internal Notes & CRM
                </span>

                {/* Text area UP (on top) */}
                <textarea
                  value={newNoteText}
                  onChange={(e) => setNewNoteText(e.target.value)}
                  placeholder="Record customer preferences, budget discussion, or next steps..."
                  rows={3}
                  className={cn(
                    "w-full border rounded-xl p-2.5 text-xs focus:outline-none focus:ring-1 resize-none transition-all shadow-2xs",
                    isDark
                      ? "bg-[#131B2E] border-[#1E293B] text-white placeholder-slate-500 focus:border-emerald-500"
                      : "bg-slate-50 border-slate-200 text-slate-900 placeholder-slate-400 focus:border-emerald-500 focus:bg-white"
                  )}
                />

                {/* Add Note Button BELOW text area */}
                <button
                  type="button"
                  onClick={handleAddNoteInline}
                  disabled={!newNoteText.trim() || isSubmittingNote}
                  className={cn(
                    "w-full h-8.5 flex items-center justify-center gap-1.5 px-3 rounded-xl font-semibold text-xs transition-all cursor-pointer shadow-xs disabled:opacity-50 disabled:cursor-not-allowed",
                    isDark
                      ? "bg-emerald-600 hover:bg-emerald-500 text-white"
                      : "bg-emerald-600 hover:bg-emerald-700 text-white"
                  )}
                >
                  {isSubmittingNote ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                  <span>Add Note</span>
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
        initialQR={null}
        sessionId={currentUser?.id || api.getCurrentUser()?.id || null}
        onStatusChange={(status, phone) => {
          setQrStatus(status);
          if (phone) {
            setQrPhone(phone);
            qrPhoneRef.current = phone;
          }
          if (status === "CONNECTED" && phone) {
            loadConversations(false);
          }
        }}
      />

      {/* Start New WhatsApp Chat Modal */}
      <NewWhatsAppChatModal
        isOpen={showNewChatModal}
        onClose={() => setShowNewChatModal(false)}
        onChatInitiated={handleChatInitiated}
      />

            {/* Message Info Modal */}
      {infoModalMessage && (
        <div className="fixed inset-0 z-60 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className={cn(
            "rounded-2xl shadow-2xl max-w-sm w-full border overflow-hidden animate-in fade-in zoom-in-95 duration-150",
            isDark ? "bg-[#202c33] border-white/10 text-white" : "bg-white border-slate-200 text-slate-900"
          )}>
            <div className={cn(
              "px-5 py-3.5 border-b flex items-center justify-between",
              isDark ? "border-white/10 bg-black/20" : "border-slate-100 bg-slate-50"
            )}>
              <div className="flex items-center gap-2">
                <Info className="w-4 h-4 text-[#00a884]" />
                <h3 className="font-bold text-sm">Message info</h3>
              </div>
              <button
                type="button"
                onClick={() => setInfoModalMessage(null)}
                className="p-1 rounded-full hover:bg-black/5 dark:hover:bg-white/10 text-slate-400"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              <div className={cn(
                "p-3 rounded-xl border",
                isDark ? "bg-black/30 border-white/5 text-slate-200" : "bg-slate-50 border-slate-200 text-slate-800"
              )}>
                <p className="whitespace-pre-wrap">{infoModalMessage.text || "[Media attachment]"}</p>
              </div>

              <div className="space-y-3 pt-1">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 dark:text-slate-400 flex items-center gap-1.5 font-medium">
                    <CheckCheck className="w-4 h-4 text-[#53bdeb]" /> Read
                  </span>
                  <span className="font-mono text-slate-700 dark:text-slate-300">
                    {infoModalMessage.status === "READ" ? infoModalMessage.timeLabel : "—"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 dark:text-slate-400 flex items-center gap-1.5 font-medium">
                    <CheckCheck className="w-4 h-4 text-slate-400" /> Delivered
                  </span>
                  <span className="font-mono text-slate-700 dark:text-slate-300">
                    {infoModalMessage.status === "DELIVERED" || infoModalMessage.status === "READ" ? infoModalMessage.timeLabel : "—"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 dark:text-slate-400 flex items-center gap-1.5 font-medium">
                    <Clock className="w-4 h-4 text-slate-400" /> Sent
                  </span>
                  <span className="font-mono text-slate-700 dark:text-slate-300">{infoModalMessage.timeLabel}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirmMessage && (
        <div className="fixed inset-0 z-60 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className={cn(
            "rounded-2xl shadow-2xl max-w-sm w-full border p-5 animate-in fade-in zoom-in-95 duration-150",
            isDark ? "bg-[#202c33] border-white/10 text-white" : "bg-white border-slate-200 text-slate-900"
          )}>
            <h3 className="text-base font-bold">Delete message?</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 leading-relaxed">
              {deleteConfirmMessage.sender === "outbound"
                ? "You can delete this message for everyone in this chat or only for yourself."
                : "Delete this message from your chat history."}
            </p>

            <div className="flex flex-col gap-2 mt-5">
              {deleteConfirmMessage.sender === "outbound" && (
                <button
                  type="button"
                  onClick={() => handleDeleteMessage(true)}
                  className="w-full py-2.5 px-4 rounded-xl bg-red-600 hover:bg-red-700 text-white font-semibold text-xs transition-all cursor-pointer shadow-xs active:scale-98"
                >
                  Delete for everyone
                </button>
              )}
              <button
                type="button"
                onClick={() => handleDeleteMessage(false)}
                className={cn(
                  "w-full py-2.5 px-4 rounded-xl font-semibold text-xs transition-all cursor-pointer shadow-2xs active:scale-98",
                  isDark ? "bg-white/10 hover:bg-white/20 text-white" : "bg-slate-100 hover:bg-slate-200 text-slate-800"
                )}
              >
                Delete for me
              </button>
              <button
                type="button"
                onClick={() => setDeleteConfirmMessage(null)}
                className="w-full py-2 px-4 rounded-xl text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white text-xs transition-all cursor-pointer text-center"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

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
