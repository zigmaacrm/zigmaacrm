"use client";

import React from "react";
import Sidebar from "@/components/layout/Sidebar";
import Header from "@/components/layout/Header";
import ModulesAndFieldsManager from "@/components/settings/ModulesAndFieldsManager";
import { Sliders } from "lucide-react";
import Link from "next/link";

import { api } from "@/lib/api";

export default function SettingsModulesPage() {
  const [isAdmin, setIsAdmin] = React.useState(true);

  React.useEffect(() => {
    if (typeof window !== "undefined") {
      const user = api.getCurrentUser();
      const roleStr = (user?.role || api.getActiveRole() || "").toLowerCase();
      setIsAdmin(roleStr.includes("admin"));
    }
  }, []);

  return (
    <div className="flex h-screen bg-[#F8FAFC] dark:bg-[#0b0f19] text-slate-900 dark:text-slate-100 font-sans overflow-hidden select-none">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Header />

        <main className="flex-1 overflow-y-auto p-6 lg:p-8 space-y-6 custom-scrollbar bg-[#F8FAFC] dark:bg-[#0b0f19]">
          {/* Breadcrumbs */}
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
            <Link href="/settings" className="hover:text-red-600 transition-colors">
              Settings
            </Link>
            <span className="text-slate-300">/</span>
            <span className="text-slate-800 font-bold">Modules & Fields</span>
          </div>

          <div className="w-full max-w-5xl mx-auto">
            <ModulesAndFieldsManager readOnly={!isAdmin} />
          </div>
        </main>
      </div>
    </div>
  );
}
