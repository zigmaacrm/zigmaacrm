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
  Zap
} from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/components/common/ToastProvider";
import { cn } from "@/lib/utils";

interface WhatsAppQRModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialQR?: string | null;
  sessionId?: string | null;
  onStatusChange?: (status: "DISCONNECTED" | "SCAN_QR" | "CONNECTED" | "CONNECTING", phone: string | null) => void;
}

export default function WhatsAppQRModal({
  isOpen,
  onClose,
  initialQR,
  sessionId,
  onStatusChange
}: WhatsAppQRModalProps) {
  const { toast } = useToast();
  const [status, setStatus] = useState<"DISCONNECTED" | "SCAN_QR" | "CONNECTED" | "CONNECTING">("DISCONNECTED");
  const [phone, setPhone] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(initialQR || null);
  const [gatewayOnline, setGatewayOnline] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [hasTimedOut, setHasTimedOut] = useState(false);

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
      if (data.status === "CONNECTED" && pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
        if (timeoutTimerRef.current) clearTimeout(timeoutTimerRef.current);
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

    // Set 12s timeout for connection/QR generation
    if (timeoutTimerRef.current) clearTimeout(timeoutTimerRef.current);
    timeoutTimerRef.current = setTimeout(() => {
      if (isMounted) {
        setHasTimedOut(true);
      }
    }, 12000);

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

        if (data.status === "CONNECTED" || data.phone) {
          if (timeoutTimerRef.current) clearTimeout(timeoutTimerRef.current);
          if (onStatusChange) onStatusChange(data.status || "CONNECTED", data.phone);
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
    }, 12000);

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
        <div className="p-6 space-y-5">
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
          ) : hasTimedOut && !qrCode ? (
            /* Cloud Gateway Connection Timeout State with Retry */
            <div className="text-center py-8 space-y-4">
              <div className="w-14 h-14 rounded-2xl bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 mx-auto flex items-center justify-center ring-8 ring-amber-50/50 dark:ring-amber-900/10">
                <AlertTriangle className="w-7 h-7" />
              </div>
              <div className="space-y-1">
                <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                  Gateway Taking Longer to Respond
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs mx-auto leading-relaxed">
                  The WhatsApp Gateway bridge took longer than 12 seconds to generate your pairing code. The cloud container may be performing a cold restart.
                </p>
              </div>
              <div className="flex items-center justify-center gap-2 pt-2">
                <button
                  onClick={async () => {
                    setHasTimedOut(false);
                    await handleRefresh();
                  }}
                  disabled={isRefreshing}
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs disabled:opacity-60"
                >
                  <RefreshCw className={cn("w-3.5 h-3.5", isRefreshing && "animate-spin")} />
                  <span>{isRefreshing ? "Connecting to Gateway..." : "Retry Connection"}</span>
                </button>
                <button
                  onClick={onClose}
                  className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-semibold inline-flex items-center transition-colors cursor-pointer"
                >
                  <span>Close</span>
                </button>
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
                  onClick={handleRefresh}
                  disabled={isRefreshing}
                  className="px-3 py-1.5 text-xs text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg flex items-center gap-1.5 transition-colors font-medium cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
                  <span>Refresh QR</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

