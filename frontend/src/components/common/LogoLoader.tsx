"use client";

import React from "react";
import { cn } from "@/lib/utils";

interface LogoLoaderProps {
  size?: "sm" | "md" | "lg" | "xl";
  text?: string;
  fullScreen?: boolean;
  className?: string;
  theme?: "light" | "dark" | "auto";
}

export default function LogoLoader({
  size = "lg",
  text = "ZIGMAA CRM",
  fullScreen = false,
  className,
  theme = "auto"
}: LogoLoaderProps) {
  const isLight = theme === "light";
  const sizeMap = {
    sm: {
      logo: "w-12 h-12",
      ripple: "w-20 h-20",
      bar: "w-28 h-1",
      beam: "w-14",
      textSize: "text-[10px]"
    },
    md: {
      logo: "w-20 h-20",
      ripple: "w-32 h-32",
      bar: "w-36 h-1",
      beam: "w-16",
      textSize: "text-[11px]"
    },
    lg: {
      logo: "w-28 h-28",
      ripple: "w-44 h-44",
      bar: "w-44 h-1.5",
      beam: "w-20",
      textSize: "text-xs"
    },
    xl: {
      logo: "w-36 h-36",
      ripple: "w-56 h-56",
      bar: "w-52 h-1.5",
      beam: "w-24",
      textSize: "text-sm"
    }
  }[size];

  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => {
    setMounted(true);
  }, []);

  const content = (
    <div className={cn("flex flex-col items-center justify-center gap-6 select-none relative", className)}>
      {/* Logo Hero Area */}
      <div className="relative flex items-center justify-center">
        {/* Deep ambient background ruby blur */}
        <div className="absolute inset-0 rounded-full bg-red-600/20 blur-3xl transform scale-150 pointer-events-none" />

        {/* Concentric ambient ripples radiating from behind the logo */}
        <div
          className={cn(
            "absolute rounded-full border border-red-500/25 pointer-events-none animate-ripple-1",
            sizeMap.ripple
          )}
        />
        <div
          className={cn(
            "absolute rounded-full border border-red-400/15 pointer-events-none animate-ripple-2",
            sizeMap.ripple
          )}
        />

        {/* The Pure Floating Logo */}
        <div className="relative z-10 flex items-center justify-center">
          {mounted ? (
            <img
              src="/loadinglogo.png"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).src = "/crmlogo.png";
              }}
              alt="Zigmaa CRM"
              className={cn(
                "object-contain animate-logo-breathe select-none pointer-events-none drop-shadow-[0_0_24px_rgba(239,68,68,0.45)]",
                sizeMap.logo
              )}
            />
          ) : (
            <div className={cn("rounded-full bg-red-500/10", sizeMap.logo)} />
          )}
        </div>
      </div>

      {/* Modern High-Tech Capsule Progress Track */}
      <div className="flex flex-col items-center gap-3">
        <div
          className={cn(
            "relative rounded-full overflow-hidden shadow-inner",
            isLight
              ? "bg-slate-200 border border-slate-300"
              : "bg-slate-950/80 border border-white/10",
            sizeMap.bar
          )}
        >
          {/* Luminous laser beam gliding through the track */}
          <div
            className={cn(
              "absolute inset-y-0 rounded-full animate-progress-slide",
              isLight
                ? "bg-gradient-to-r from-transparent via-red-600 to-transparent shadow-[0_0_12px_rgba(220,38,38,0.85)]"
                : "bg-gradient-to-r from-transparent via-red-500 to-transparent shadow-[0_0_12px_rgba(239,68,68,0.9)]",
              sizeMap.beam
            )}
          />
        </div>

        {/* Minimalist Branded Status Text */}
        {text && (
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "font-bold uppercase tracking-[0.25em] drop-shadow-sm",
                isLight ? "text-slate-800" : "text-slate-200",
                sizeMap.textSize
              )}
            >
              {text}
            </span>
            <span className="flex gap-1 items-center">
              <span
                className={cn(
                  "w-1.5 h-1.5 rounded-full animate-ping",
                  isLight
                    ? "bg-red-600 shadow-[0_0_8px_rgba(220,38,38,0.9)]"
                    : "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.9)]"
                )}
              />
            </span>
          </div>
        )}
      </div>
    </div>
  );

  if (fullScreen) {
    return (
      <div
        className={cn(
          "fixed inset-0 z-50 flex items-center justify-center overflow-hidden select-none animate-in fade-in duration-300",
          isLight ? "bg-slate-50" : "bg-[#0B0F19]"
        )}
      >
        {/* Subtle Dot Matrix Grid Backdrop */}
        <div
          className={cn(
            "absolute inset-0 pointer-events-none",
            isLight ? "opacity-[0.3]" : "opacity-[0.08]"
          )}
          style={{
            backgroundImage: isLight
              ? "radial-gradient(rgba(148, 163, 184, 0.4) 1px, transparent 1px)"
              : "radial-gradient(rgba(255, 255, 255, 0.6) 1px, transparent 1px)",
            backgroundSize: "24px 24px"
          }}
        />

        {/* Elegant ambient volumetric crimson blooms */}
        <div
          className={cn(
            "absolute w-[500px] h-[500px] rounded-full blur-[120px] pointer-events-none",
            isLight ? "bg-red-500/10" : "bg-red-600/12"
          )}
        />
        <div
          className={cn(
            "absolute w-[250px] h-[250px] rounded-full blur-[70px] pointer-events-none",
            isLight ? "bg-rose-500/10" : "bg-rose-500/10"
          )}
        />

        {/* Concentric subtle decorative rings behind card */}
        <div
          className={cn(
            "absolute w-[420px] h-[420px] rounded-full border pointer-events-none animate-pulse",
            isLight ? "border-red-500/15" : "border-red-500/10"
          )}
        />
        <div
          className={cn(
            "absolute w-[600px] h-[600px] rounded-full border pointer-events-none",
            isLight ? "border-slate-200" : "border-slate-800/40"
          )}
        />

        {/* Card container with ultra-premium frosted glass finish */}
        <div
          className={cn(
            "relative z-10 px-12 py-10 rounded-3xl backdrop-blur-xl flex flex-col items-center",
            isLight
              ? "bg-white/85 border border-slate-200/90 shadow-[0_20px_50px_-15px_rgba(0,0,0,0.08),0_0_30px_rgba(239,68,68,0.08)]"
              : "bg-slate-900/50 border border-white/[0.08] shadow-[0_20px_60px_-15px_rgba(0,0,0,0.8),0_0_40px_rgba(239,68,68,0.12)]"
          )}
        >
          {content}
        </div>
      </div>
    );
  }

  return content;
}
