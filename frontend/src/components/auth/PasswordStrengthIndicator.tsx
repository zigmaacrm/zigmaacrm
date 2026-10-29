"use client";

import React from "react";
import { Check, X } from "lucide-react";
import { checkPasswordStrength } from "@/lib/passwordValidation";

interface PasswordStrengthIndicatorProps {
  password: string;
  showAlways?: boolean;
}

export default function PasswordStrengthIndicator({
  password,
  showAlways = false,
}: PasswordStrengthIndicatorProps) {
  if (!showAlways && !password) return null;

  const { isValid, metCount, requirements } = checkPasswordStrength(password);

  const getStrengthLabel = () => {
    if (metCount === 0) return { text: "Too Weak", color: "text-slate-400", barColor: "bg-slate-200" };
    if (metCount <= 2) return { text: "Weak", color: "text-rose-500", barColor: "bg-rose-500" };
    if (metCount === 3) return { text: "Medium", color: "text-amber-500", barColor: "bg-amber-500" };
    return { text: "Strong", color: "text-emerald-600", barColor: "bg-emerald-500" };
  };

  const strength = getStrengthLabel();

  return (
    <div className="mt-2.5 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/60 text-xs space-y-2 animate-in fade-in duration-150">
      <div className="flex items-center justify-between text-[11px] font-semibold">
        <span className="text-slate-500 dark:text-slate-400">Password Strength:</span>
        <span className={`font-bold ${strength.color}`}>{strength.text}</span>
      </div>

      {/* Strength Bar */}
      <div className="grid grid-cols-4 gap-1.5 h-1.5 w-full">
        {[1, 2, 3, 4].map((step) => (
          <div
            key={step}
            className={`h-full rounded-full transition-all duration-200 ${
              metCount >= step ? strength.barColor : "bg-slate-200 dark:bg-slate-700"
            }`}
          />
        ))}
      </div>

      {/* Requirement Checklist */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-1 text-[11px]">
        {requirements.map((req) => (
          <div
            key={req.id}
            className={`flex items-center gap-1.5 transition-colors ${
              req.met ? "text-emerald-600 dark:text-emerald-400 font-medium" : "text-slate-400 dark:text-slate-500"
            }`}
          >
            <div
              className={`w-3.5 h-3.5 rounded-full flex items-center justify-center shrink-0 transition-colors ${
                req.met ? "bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600" : "bg-slate-200 dark:bg-slate-700 text-slate-400"
              }`}
            >
              {req.met ? <Check className="w-2.5 h-2.5" /> : <X className="w-2.5 h-2.5" />}
            </div>
            <span>{req.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
