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

interface WhatsAppQRModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStatusChange?: (status: "DISCONNECTED" | "SCAN_QR" | "CONNECTED", phone: string | null) => void;
}

export default function WhatsAppQRModal({
  isOpen,
  onClose,
  onStatusChange
}: WhatsAppQRModalProps) {
  const { toast } = useToast();
  const [status, setStatus] = useState<"DISCONNECTED" | "SCAN_QR" | "CONNECTED">("DISCONNECTED");
  const [phone, setPhone] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [gatewayOnline, setGatewayOnline] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const checkStatus = async () => {
    try {
      const data = await api.getWhatsAppQRStatus();
      setStatus(data.status);
      setPhone(data.phone);
      setName(data.name);
      setQrCode(data.qr);
      setGatewayOnline(data.gateway_online);
      if (onStatusChange) {
        onStatusChange(data.status, data.phone);
      }
    } catch (e) {
      console.warn("Failed to check QR status", e);
    }
  };

  useEffect(() => {
    if (!isOpen) {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      return;
    }

    checkStatus();
    pollIntervalRef.current = setInterval(checkStatus, 2500);

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [isOpen]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await api.refreshWhatsAppQR();
      toast.success("QR Code Refreshed", "Generating fresh pairing session...");
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
      await api.disconnectWhatsAppQR();
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
          ) : !gatewayOnline ? (
            /* Gateway offline warning */
            <div className="text-center py-6 space-y-4">
              <div className="w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400 mx-auto flex items-center justify-center">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                  WhatsApp Gateway Starting...
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-xs mx-auto">
                  The local WhatsApp bridge service is launching on port 5001. Please wait a moment or verify `start.bat`.
                </p>
              </div>
              <div className="flex items-center justify-center gap-2">
                <button
                  onClick={checkStatus}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Retry Connection</span>
                </button>
                <button
                  onClick={onClose}
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-100 text-white dark:text-slate-900 rounded-xl text-xs font-semibold inline-flex items-center transition-colors cursor-pointer"
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
                  <div className="bg-white p-2.5 rounded-lg shadow-sm border border-slate-100">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={qrCode}
                      alt="WhatsApp QR Code"
                      className="w-56 h-56 object-contain"
                    />
                  </div>
                ) : (
                  <div className="w-56 h-56 flex flex-col items-center justify-center text-slate-400 gap-2">
                    <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
                    <span className="text-xs font-semibold">Generating QR Code...</span>
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
                    Tap <strong>Menu (⋮)</strong> on Android or <strong>Settings</strong> on iPhone &rarr; select <strong>Linked Devices</strong>.
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
                <div className="flex items-center gap-1.5 text-[11px] text-emerald-600 font-semibold">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>₹0 Cost • Personal app stays active</span>
                </div>
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

