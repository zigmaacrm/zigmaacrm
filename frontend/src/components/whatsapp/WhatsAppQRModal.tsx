"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  QrCode,
  Smartphone,
  CheckCircle2,
  X,
  RefreshCw,
  AlertTriangle,
  Unlink,
  Loader2,
  ShieldCheck,
  Zap,
  Phone,
  Copy,
  Check
} from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/components/common/ToastProvider";
import { cn } from "@/lib/utils";

interface WhatsAppQRModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialQR?: string | null;
  sessionId?: string | null;
  onStatusChange?: (status: any, phone: string | null) => void;
}

export default function WhatsAppQRModal({
  isOpen,
  onClose,
  initialQR,
  sessionId,
  onStatusChange
}: WhatsAppQRModalProps) {
  const { toast } = useToast();
  const [status, setStatus] = useState<string>("DISCONNECTED");
  const [phone, setPhone] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(initialQR || null);
  const [gatewayOnline, setGatewayOnline] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [hasTimedOut, setHasTimedOut] = useState(false);
  const [linkMethod, setLinkMethod] = useState<"qr" | "phone">("qr");
  const [pairingPhone, setPairingPhone] = useState("");
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [isRequestingCode, setIsRequestingCode] = useState(false);
  const [hasCopiedCode, setHasCopiedCode] = useState(false);

  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const timeoutTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isCheckingRef = useRef(false);

  const getResolvedSessionId = (): string | undefined => {
    if (sessionId) return sessionId;
    try {
      const u = api.getCurrentUser();
      if (u?.id) return u.id;
    } catch (_) {}
    return undefined;
  };

  const handleRequestPairingCode = async () => {
    let clean = pairingPhone.replace(/[^0-9]/g, "");
    if (clean.length === 10 && /^[6-9]/.test(clean)) {
      clean = `91${clean}`;
    }
    if (!clean || clean.length < 8) {
      toast.error("Invalid Phone Number", "Please include country code, e.g. 919600471080");
      return;
    }
    setIsRequestingCode(true);
    try {
      const sId = getResolvedSessionId();
      const res = await api.requestWhatsAppPairingCode(clean, sId);
      if (res?.pairing_code) {
        setPairingCode(res.pairing_code);
        setHasTimedOut(false);
        if (timeoutTimerRef.current) clearTimeout(timeoutTimerRef.current);
        timeoutTimerRef.current = setTimeout(() => {
          setHasTimedOut(true);
        }, 120000);
        toast.success("Pairing Code Ready", "Enter this 8-digit code in WhatsApp on your phone");
        if (!pollIntervalRef.current) {
          pollIntervalRef.current = setInterval(checkStatus, 1500);
        }
      }
    } catch (e: any) {
      const errMsg = e.message || "";
      if (errMsg.includes("bridge v2") || errMsg.includes("QR Code") || errMsg.includes("PAIRING_FALLBACK")) {
        toast.error("Pairing Code Notice", "Cloud bridge requires QR Code linking. Switching to QR scan tab.");
        setLinkMethod("qr");
      } else {
        toast.error("Pairing Error", errMsg || "Failed to generate pairing code. Please try again.");
      }
    } finally {
      setIsRequestingCode(false);
    }
  };

  useEffect(() => {
    if (initialQR) {
      setQrCode(initialQR);
      setHasTimedOut(false);
      if (timeoutTimerRef.current) clearTimeout(timeoutTimerRef.current);
    }
  }, [initialQR, isOpen]);

  const checkStatus = async () => {
    if (isCheckingRef.current) return;
    isCheckingRef.current = true;
    try {
      const sId = getResolvedSessionId();
      const data = await api.getWhatsAppQRStatus(sId);
      setStatus(data.status);
      setPhone(data.phone);
      setName(data.name);
      const code = data.qr_code || data.qr;
      if (code) {
        setQrCode(code);
        setGatewayOnline(true);
        setHasTimedOut(false);
        if (timeoutTimerRef.current) clearTimeout(timeoutTimerRef.current);
      }
      setGatewayOnline(data.gateway_online);
      if (onStatusChange) {
        onStatusChange(data.status, data.phone);
      }
      if (data.status === "CONNECTED") {
        setStatus("CONNECTED");
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
        if (timeoutTimerRef.current) {
          clearTimeout(timeoutTimerRef.current);
          timeoutTimerRef.current = null;
        }
        const cleanP = data.phone ? `+${data.phone.replace(/[^0-9]/g, "")}` : "device";
        toast.success("WhatsApp Connected!", `Successfully linked ${cleanP}. All conversations and messages are now synced.`);
        setTimeout(() => {
          onClose();
        }, 1200);
      }
    } catch (e) {
      console.warn("Failed to check QR status", e);
    } finally {
      isCheckingRef.current = false;
    }
  };

  useEffect(() => {
    if (!isOpen) {
      setQrCode(null);
      setHasTimedOut(false);
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      if (timeoutTimerRef.current) {
        clearTimeout(timeoutTimerRef.current);
        timeoutTimerRef.current = null;
      }
      return;
    }

    let isMounted = true;
    setHasTimedOut(false);
    if (initialQR) {
      setQrCode(initialQR);
    } else {
      setQrCode(null);
    }

    // Set 25s timeout for connection/QR generation to allow cloud container cold start
    if (timeoutTimerRef.current) clearTimeout(timeoutTimerRef.current);
    timeoutTimerRef.current = setTimeout(() => {
      if (isMounted) {
        setHasTimedOut(true);
      }
    }, 25000);

    const initQR = async () => {
      try {
        const sId = getResolvedSessionId();
        // 1. Check if already connected or if a valid QR is cached
        const data = await api.getWhatsAppQRStatus(sId);
        if (!isMounted) return;
        setStatus(data.status);
        setPhone(data.phone);
        setName(data.name);
        setGatewayOnline(data.gateway_online);

        if (data.status === "CONNECTED") {
          if (timeoutTimerRef.current) clearTimeout(timeoutTimerRef.current);
          if (onStatusChange) onStatusChange("CONNECTED", data.phone);
          const cleanP = data.phone ? `+${data.phone.replace(/[^0-9]/g, "")}` : "device";
          toast.success("WhatsApp Connected!", `Successfully linked ${cleanP}. All conversations and messages are now synced.`);
          setTimeout(() => {
            if (isMounted) onClose();
          }, 1200);
          return;
        }

        const validQr = data.qr_code || data.qr;
        if (validQr) {
          setQrCode(validQr);
          setStatus(data.status || "SCAN_QR");
          setGatewayOnline(true);
          setHasTimedOut(false);
          if (timeoutTimerRef.current) clearTimeout(timeoutTimerRef.current);
          return;
        }

        // 2. Connect endpoint triggers Baileys and returns QR immediately (0-2s)
        const res = await api.connectWhatsAppQR(sId).catch(() => null);
        if (!isMounted) return;
        const newQr = res?.qr_code || res?.qr;
        if (newQr) {
          setQrCode(newQr);
          setGatewayOnline(true);
          setStatus((res?.status as any) || "SCAN_QR");
          setHasTimedOut(false);
          if (timeoutTimerRef.current) clearTimeout(timeoutTimerRef.current);
        }
        if (onStatusChange && res?.status) {
          onStatusChange(res.status as any, res.phone || null);
        }
      } catch (e) {
        console.warn("Init QR error", e);
      }
    };

    initQR();
    // Fast polling fallback: 1.5s
    pollIntervalRef.current = setInterval(checkStatus, 1500);

    return () => {
      isMounted = false;
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      if (timeoutTimerRef.current) {
        clearTimeout(timeoutTimerRef.current);
        timeoutTimerRef.current = null;
      }
    };
  }, [isOpen, sessionId]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    setHasTimedOut(false);
    if (timeoutTimerRef.current) clearTimeout(timeoutTimerRef.current);
    timeoutTimerRef.current = setTimeout(() => {
      setHasTimedOut(true);
    }, 25000);

    try {
      const sId = getResolvedSessionId();
      const res = await api.connectWhatsAppQR(sId);
      const code = res?.qr_code || res?.qr;
      if (code) {
        setQrCode(code);
        setGatewayOnline(true);
        setStatus((res.status as any) || "SCAN_QR");
        setHasTimedOut(false);
        if (timeoutTimerRef.current) clearTimeout(timeoutTimerRef.current);
      }
      toast.success("QR Code Refreshed", "Ready for pairing");
      await checkStatus();
    } catch (err: any) {
      toast.error("Error", err.message || "Failed to refresh QR code");
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleDisconnect = async () => {
    setIsDisconnecting(true);
    try {
      const sId = getResolvedSessionId();
      await api.disconnectWhatsAppQR(sId);
      setStatus("NOT_LINKED");
      setPhone(null);
      setQrCode(null);
      try {
        localStorage.removeItem("zigmaa_whatsapp_status");
        localStorage.removeItem("zigmaa_whatsapp_phone");
        for (const k of ["zigmaa_user", "zigmaa_current_user"]) {
          const uStr = localStorage.getItem(k);
          if (uStr) {
            const parsed = JSON.parse(uStr);
            delete parsed.whatsapp_phone_number;
            delete parsed.whatsapp_phone_number_id;
            localStorage.setItem(k, JSON.stringify(parsed));
          }
        }
        window.dispatchEvent(new CustomEvent("zigmaa_user_updated"));
      } catch (_) {}
      if (onStatusChange) onStatusChange("NOT_LINKED", null);
      toast.success("Disconnected", "WhatsApp session logged out successfully.");
      await checkStatus();
    } catch (err: any) {
      toast.error("Error", err.message || "Failed to disconnect session");
    } finally {
      setIsDisconnecting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl max-w-md w-full overflow-hidden border border-slate-200 dark:border-slate-800"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/10 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <QrCode className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                Link WhatsApp (QR Scan)
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Connect your real phone without deleting WhatsApp
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

        {/* Body */}
        <div className="p-6 space-y-4">
          {status !== "CONNECTED" && (
            <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800/80 rounded-xl">
              <button
                type="button"
                onClick={() => setLinkMethod("qr")}
                className={cn(
                  "flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer",
                  linkMethod === "qr"
                    ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs"
                    : "text-slate-500 hover:text-slate-900 dark:hover:text-white"
                )}
              >
                <QrCode className="w-3.5 h-3.5" />
                <span>Scan QR Code</span>
              </button>
              <button
                type="button"
                onClick={() => setLinkMethod("phone")}
                className={cn(
                  "flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer",
                  linkMethod === "phone"
                    ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs"
                    : "text-slate-500 hover:text-slate-900 dark:hover:text-white"
                )}
              >
                <Phone className="w-3.5 h-3.5" />
                <span>Link with Phone Number</span>
              </button>
            </div>
          )}

          {status === "CONNECTED" ? (
            /* Connected State */
            <div className="text-center py-4 space-y-4">
              <div className="w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 mx-auto flex items-center justify-center ring-8 ring-emerald-50 dark:ring-emerald-900/20">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <div>
                <h4 className="text-base font-bold text-slate-900 dark:text-white">
                  WhatsApp Connected Successfully!
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Your real WhatsApp account is live and synced with Zigmaa CRM.
                </p>
              </div>

              <div className="bg-slate-50 dark:bg-slate-800/60 p-3.5 rounded-xl border border-slate-200 dark:border-slate-700/60 flex items-center justify-between text-left">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-emerald-500 text-white flex items-center justify-center font-bold text-xs shadow-xs">
                    WA
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-800 dark:text-slate-200">
                      {name || "Connected Account"}
                    </p>
                    <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold">
                      {phone || "Active"}
                    </p>
                  </div>
                </div>
                <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
                  Live
                </span>
              </div>

              <div className="flex items-center gap-2 pt-2">
                <button
                  onClick={handleDisconnect}
                  disabled={isDisconnecting}
                  className="flex-1 py-2 px-3 bg-rose-50 hover:bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:hover:bg-rose-900/50 dark:text-rose-300 text-xs font-semibold rounded-xl border border-rose-200 dark:border-rose-900/50 flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  {isDisconnecting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Unlink className="w-3.5 h-3.5" />
                  )}
                  <span>Disconnect Account</span>
                </button>
                <button
                  onClick={onClose}
                  className="flex-1 py-2 px-3 bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-100 text-white dark:text-slate-900 text-xs font-semibold rounded-xl transition-colors cursor-pointer"
                >
                  Done
                </button>
              </div>
            </div>
          ) : linkMethod === "phone" ? (
            /* Link with Phone Number Pairing Code View */
            <div className="space-y-4 py-1">
              <div className="text-center space-y-1">
                <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                  Link with Phone Number Code
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs mx-auto">
                  No camera needed. Enter your phone number below and type the 8-digit code in WhatsApp.
                </p>
              </div>

              {!pairingCode ? (
                <div className="space-y-3 pt-1">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      WhatsApp Phone Number (with Country Code)
                    </label>
                    <input
                      type="tel"
                      value={pairingPhone}
                      onChange={(e) => setPairingPhone(e.target.value)}
                      placeholder="e.g. 919600471080"
                      className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-medium text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                    />
                    <p className="text-[10px] text-slate-400 mt-1">
                      Include country code (e.g. 91 for India) without + or spaces.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={handleRequestPairingCode}
                    disabled={isRequestingCode || !pairingPhone.trim()}
                    className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all shadow-xs disabled:opacity-50 cursor-pointer"
                  >
                    {isRequestingCode ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Generating Code...</span>
                      </>
                    ) : (
                      <>
                        <Zap className="w-4 h-4" />
                        <span>Get 8-Digit Pairing Code</span>
                      </>
                    )}
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="bg-emerald-50 dark:bg-emerald-950/40 p-4 rounded-2xl border border-emerald-200 dark:border-emerald-800/50 text-center space-y-2">
                    <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 uppercase tracking-wider block">
                      Your WhatsApp Pairing Code
                    </span>
                    <div className="flex items-center justify-center gap-2.5">
                      <span className="font-mono text-2xl sm:text-3xl font-black tracking-widest text-slate-900 dark:text-white select-all">
                        {pairingCode.length === 8 ? `${pairingCode.slice(0, 4)} - ${pairingCode.slice(4)}` : pairingCode}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard?.writeText(pairingCode);
                          setHasCopiedCode(true);
                          setTimeout(() => setHasCopiedCode(false), 2000);
                        }}
                        className="p-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:text-emerald-600 transition-colors cursor-pointer"
                        title="Copy code"
                      >
                        {hasCopiedCode ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2 text-xs text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/40 p-3.5 rounded-xl border border-slate-200 dark:border-slate-700/60">
                    <p className="font-bold text-slate-800 dark:text-slate-200 text-[11px]">How to link on your phone:</p>
                    <ol className="list-decimal list-inside space-y-1.5 text-[11px] leading-relaxed">
                      <li>Open <strong>WhatsApp</strong> on your phone</li>
                      <li>Tap <strong>Settings (or ⋮) &rarr; Linked Devices &rarr; Link a Device</strong></li>
                      <li>Tap <strong>Link with phone number instead</strong> at the bottom</li>
                      <li>Enter the 8-character code shown above</li>
                    </ol>
                    <div className="mt-2 p-2 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/50 text-[10px] text-amber-800 dark:text-amber-300">
                      <strong>Important:</strong> Enter this code on the exact phone running WhatsApp with this number ({pairingPhone}). Codes expire in 60s.
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <button
                      type="button"
                      onClick={() => setPairingCode(null)}
                      className="text-xs font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-white transition-colors cursor-pointer"
                    >
                      &larr; Change number
                    </button>
                    <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Waiting for code on phone...</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : hasTimedOut && !qrCode ? (
            /* Cloud Gateway Connection Timeout State with Retry */
            <div className="text-center py-6 space-y-4">
              <div className="w-14 h-14 rounded-2xl bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 mx-auto flex items-center justify-center ring-8 ring-amber-50/50 dark:ring-amber-900/10">
                <AlertTriangle className="w-7 h-7" />
              </div>
              <div className="space-y-1">
                <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                  Gateway Taking Longer to Respond
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs mx-auto leading-relaxed">
                  The cloud bridge may be waking up from sleep. You can retry connection or link via phone number.
                </p>
              </div>
              <div className="flex flex-col gap-2 pt-2 max-w-xs mx-auto">
                <button
                  type="button"
                  onClick={() => {
                    setHasTimedOut(false);
                    setLinkMethod("phone");
                  }}
                  className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-xs"
                >
                  <Phone className="w-3.5 h-3.5" />
                  <span>Link with Phone Number Code instead</span>
                </button>
                <div className="flex items-center gap-2">
                  <button
                    onClick={async () => {
                      setHasTimedOut(false);
                      await handleRefresh();
                    }}
                    disabled={isRefreshing}
                    className="flex-1 py-2 px-3 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-60"
                  >
                    <RefreshCw className={cn("w-3.5 h-3.5", isRefreshing && "animate-spin")} />
                    <span>{isRefreshing ? "Retrying..." : "Retry QR"}</span>
                  </button>
                  <button
                    onClick={onClose}
                    className="flex-1 py-2 px-3 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-semibold inline-flex items-center justify-center transition-colors cursor-pointer"
                  >
                    <span>Close</span>
                  </button>
                </div>
              </div>
            </div>
          ) : !gatewayOnline && !qrCode ? (
            /* Cloud Gateway Connecting / Waking Up State */
            <div className="text-center py-8 space-y-4">
              <div className="w-14 h-14 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 mx-auto flex items-center justify-center ring-8 ring-emerald-50/50 dark:ring-emerald-900/10">
                <Loader2 className="w-7 h-7 animate-spin" />
              </div>
              <div className="space-y-1">
                <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                  Connecting to WhatsApp Gateway...
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs mx-auto leading-relaxed">
                  Connecting to live cloud bridge service. The pairing QR code will appear automatically in a few seconds.
                </p>
              </div>
              <div className="flex items-center justify-center gap-2 pt-2">
                <button
                  onClick={async () => {
                    await handleRefresh();
                  }}
                  disabled={isRefreshing}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs disabled:opacity-60"
                >
                  <RefreshCw className={cn("w-3.5 h-3.5", isRefreshing && "animate-spin")} />
                  <span>{isRefreshing ? "Waking Cloud Bridge..." : "Check Now"}</span>
                </button>
                <button
                  onClick={onClose}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-semibold inline-flex items-center transition-colors cursor-pointer"
                >
                  <span>Close</span>
                </button>
              </div>
            </div>
          ) : (
            /* QR Code Display & Instructions */
            <div className="space-y-4">
              <div className="bg-slate-50 dark:bg-slate-800/40 p-4 rounded-xl border border-slate-200 dark:border-slate-800 flex justify-center">
                {qrCode ? (
                  <div className="bg-white p-3 rounded-xl shadow-xs border border-slate-100 flex flex-col items-center">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={qrCode}
                      alt="WhatsApp QR Code"
                      className="w-56 h-56 object-contain"
                    />
                    <div className="flex items-center gap-1.5 mt-2.5 text-[11px] text-emerald-600 dark:text-emerald-500 font-semibold">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                      <span>Live QR Code &bull; Scan Now</span>
                    </div>
                  </div>
                ) : (
                  <div className="w-56 h-56 flex flex-col items-center justify-center text-slate-400 gap-2.5 p-3 text-center">
                    <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
                    <div>
                      <span className="text-xs font-semibold block text-slate-700 dark:text-slate-300">
                        Generating QR Code...
                      </span>
                      <span className="text-[11px] text-slate-400 mt-1 block">
                        Connecting to WhatsApp cloud gateway.
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={handleRefresh}
                      disabled={isRefreshing}
                      className="mt-1 text-xs text-emerald-600 dark:text-emerald-400 font-semibold hover:underline flex items-center gap-1 cursor-pointer disabled:opacity-50"
                    >
                      <RefreshCw className={cn("w-3 h-3", isRefreshing && "animate-spin")} />
                      <span>{isRefreshing ? "Requesting QR..." : "Tap to Retry"}</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Step by step instructions */}
              <div className="space-y-2 text-xs text-slate-600 dark:text-slate-300">
                <div className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-emerald-500/10 text-emerald-600 font-bold flex items-center justify-center shrink-0 text-[11px]">
                    1
                  </span>
                  <span>Open <strong>WhatsApp</strong> on your phone.</span>
                </div>
                <div className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-emerald-500/10 text-emerald-600 font-bold flex items-center justify-center shrink-0 text-[11px]">
                    2
                  </span>
                  <span>
                    Tap <strong>Menu (⋮)</strong> on Android or <strong>Settings</strong> on Your Phone &rarr; select <strong>Linked Devices</strong>.
                  </span>
                </div>
                <div className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-emerald-500/10 text-emerald-600 font-bold flex items-center justify-center shrink-0 text-[11px]">
                    3
                  </span>
                  <span>
                    Tap <strong>Link a Device</strong> and point your camera at the QR code above.
                  </span>
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setLinkMethod("phone")}
                  className="text-xs text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 font-semibold inline-flex items-center gap-1 cursor-pointer"
                >
                  <Phone className="w-3.5 h-3.5" />
                  <span>Link with phone number instead</span>
                </button>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleDisconnect}
                    disabled={isDisconnecting}
                    className="px-2.5 py-1.5 text-xs text-rose-600 hover:text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg flex items-center gap-1 transition-colors font-semibold cursor-pointer"
                    title="Reset or unlink this session"
                  >
                    {isDisconnecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Unlink className="w-3.5 h-3.5" />}
                    <span>Reset</span>
                  </button>
                  <button
                    onClick={handleRefresh}
                    disabled={isRefreshing}
                    className="px-3 py-1.5 text-xs text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg flex items-center gap-1.5 transition-colors font-medium cursor-pointer"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
                    <span>Refresh QR</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

