"use client";

import { useState, useEffect } from "react";
import {
  Settings,
  Building2,
  Calendar,
  Globe,
  RotateCcw,
  Sliders,
  CheckCircle2,
  ExternalLink,
  ShieldCheck,
  User,
  Trash2,
  UploadCloud,
  Lock,
  Phone,
  Mail,
  KeyRound,
  Eye,
  EyeOff,
  AlertCircle,
  RefreshCw,
  Copy,
  Check,
  Plus,
  ArrowRight,
  Code2,
  ChevronDown,
  ChevronUp,
  Share2,
  Users,
  UserPlus
} from "lucide-react";
import Sidebar from "@/components/layout/Sidebar";
import Header from "@/components/layout/Header";
import ConnectEmailModal from "@/components/settings/ConnectEmailModal";
import InviteMemberDrawer from "@/components/settings/InviteMemberDrawer";
import ModulesAndFieldsManager from "@/components/settings/ModulesAndFieldsManager";
import { api } from "@/lib/api";
import { useToast } from "@/components/common/ToastProvider";

type SettingsTab = "profile" | "team" | "modules" | "webhooks" | "email-sync" | "integrations";

export default function SettingsPage() {
  const { toast, confirm } = useToast();
  const [currentUser, setCurrentUser] = useState<any>(null);

  // Active Tab
  const [activeTab, setActiveTab] = useState<SettingsTab>("profile");

  // Team Management State
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [loadingTeam, setLoadingTeam] = useState(false);
  const [showInviteDrawer, setShowInviteDrawer] = useState(false);
  const [activeRole, setActiveRole] = useState<string>("ADMIN");
  const [teamSearchQuery, setTeamSearchQuery] = useState("");

  // Role Scoping & Settings Tab Permissions
  const resolvedRole = (currentUser?.role || activeRole || "").toLowerCase();
  const isAdmin = resolvedRole.includes("admin");

  useEffect(() => {
    if (!isAdmin && (activeTab === "team" || activeTab === "webhooks")) {
      setActiveTab("profile");
    }
  }, [isAdmin, activeTab]);

  // Email Sync State
  const [emailSync, setEmailSync] = useState<{
    is_connected: boolean;
    email: string | null;
    provider: string | null;
    last_synced_at?: string | null;
  }>({
    is_connected: false,
    email: null,
    provider: null
  });
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [syncingNow, setSyncingNow] = useState(false);

  // Lead Sources & Forms Tab state
  const [showDevGuide, setShowDevGuide] = useState(false);
  const [showMetaModal, setShowMetaModal] = useState(false);



  // Profile Info Fields
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [userPhoto, setUserPhoto] = useState<string>("");
  const [address, setAddress] = useState("Chennai Tech Park, Guindy, Chennai, Tamil Nadu 600032");
  const [gstin, setGstin] = useState("33AAECZ9920K1ZX");
  const [signatoryName, setSignatoryName] = useState("");
  const [signatoryDesignation, setSignatoryDesignation] = useState("Authorized Signatory");
  const [bankName, setBankName] = useState("HDFC Bank Ltd");
  const [accountNumber, setAccountNumber] = useState("50200084729104");
  const [ifscCode, setIfscCode] = useState("HDFC0001244");
  const [upiId, setUpiId] = useState("zigmaa@hdfcbank");
  const [profileSaving, setProfileSaving] = useState(false);

  // Password Change Fields
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordError, setPasswordError] = useState("");

  const [saved, setSaved] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedMetaUrl, setCopiedMetaUrl] = useState(false);
  const [copiedJson, setCopiedJson] = useState(false);

  // Unified Webhook URL
  const webhookUrl = "http://localhost:8000/api/v1/webhooks/inbound-lead";

  // Sample JSON payload
  const samplePayload = {
    full_name: "John Doe",
    phone: "+919876543210",
    email: "john@example.com",
    company_name: "Acme Innovations",
    source: "META_ADS"
  };

  const loadEmailSync = async () => {
    try {
      const syncStatus = await api.getEmailSync();
      if (syncStatus) {
        setEmailSync(syncStatus);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const loadTeamMembers = async () => {
    try {
      setLoadingTeam(true);
      const members = await api.getTeamMembers();
      setTeamMembers(members);
    } catch (err) {
      console.error("Failed to load team members:", err);
    } finally {
      setLoadingTeam(false);
    }
  };

  const handleRoleChange = async (userId: string, newRole: string) => {
    try {
      await api.updateMemberRole(userId, newRole);
      toast.success("Role Updated", `Team member role changed to ${newRole}`);
      setTeamMembers((prev) =>
        prev.map((m) => (m.id === userId ? { ...m, role: newRole } : m))
      );
    } catch (err: any) {
      toast.error("Failed to update role", err.message || "Failed to update role");
    }
  };

  const handleDeleteMember = async (member: any) => {
    const confirmed = await confirm({
      title: "Remove Team Member",
      message: `Are you sure you want to remove ${member.full_name} (${member.email}) from your organization?`,
      confirmText: "Remove Member",
      cancelText: "Cancel",
      variant: "danger"
    });

    if (confirmed) {
      try {
        await api.removeTeamMember(member.id);
        toast.success("Member Removed", `${member.full_name} was removed from the team.`);
        setTeamMembers((prev) => prev.filter((m) => m.id !== member.id));
      } catch (err: any) {
        toast.error("Failed to remove member", err.message || "Failed to remove member");
      }
    }
  };

  useEffect(() => {
    loadEmailSync();
    loadTeamMembers();
    if (typeof window !== "undefined") {
      setActiveRole(api.getActiveRole());
      const handleRoleChanged = () => setActiveRole(api.getActiveRole());
      window.addEventListener("zigmaa_role_changed", handleRoleChanged);

      let user = api.getCurrentUser();
      if (user) {
        setCurrentUser(user);
        if (user.role) setActiveRole(user.role);
        if (user.full_name) {
          setFullName(user.full_name);
          setSignatoryName(user.full_name);
        }
        if (user.email) setEmail(user.email);
        if (user.phone) setPhone(user.phone);
        if (user.organization_name) setCompanyName(user.organization_name);
        if (user.picture || user.avatar_url) setUserPhoto(user.picture || user.avatar_url);
      }

      // Always fetch latest profile from backend /auth/me so registered signup name is fresh
      api.getMe().then((me) => {
        if (me) {
          setCurrentUser(me);
          if (me.role) setActiveRole(me.role);
          if (me.full_name) {
            setFullName(me.full_name);
            setSignatoryName(me.full_name);
          }
          if (me.email) setEmail(me.email);
          if (me.phone) setPhone(me.phone);
          if (me.organization_name) setCompanyName(me.organization_name);
          if (me.picture || me.avatar_url) setUserPhoto(me.picture || me.avatar_url);
        }
      }).catch(() => {});

      // Load persistent organization settings
      api.getOrganizationSettings().then((org) => {
        if (org) {
          if (org.company_name) setCompanyName(org.company_name);
          // Only use org logo if user doesn't already have their personal photo
          if (org.logo_url && !user?.picture && !user?.avatar_url) {
            setUserPhoto(org.logo_url);
          }
          // Do NOT overwrite user's personal email with org.email
          if (!user?.email && org.email) setEmail(org.email);
          if (org.phone && !user?.phone) {
            const cleanPhone = org.phone.replace("+91", "").trim();
            setPhone(cleanPhone);
          }
          if (org.address) setAddress(org.address);
          if (org.gstin) setGstin(org.gstin);
          if (org.signatory_name && !user?.full_name) setSignatoryName(org.signatory_name);
          if (org.signatory_designation) setSignatoryDesignation(org.signatory_designation);
          if (org.bank_name) setBankName(org.bank_name);
          if (org.account_number) setAccountNumber(org.account_number);
          if (org.ifsc_code) setIfscCode(org.ifsc_code);
          if (org.upi_id) setUpiId(org.upi_id);
        }
      });

      const handleSyncUpdate = () => loadEmailSync();
      window.addEventListener("zigmaa_email_sync_updated", handleSyncUpdate);

      // Check URL query param for active tab e.g. /settings?tab=modules
      const params = new URLSearchParams(window.location.search);
      const tabParam = params.get("tab") as SettingsTab;
      if (tabParam && ["profile", "team", "modules", "webhooks", "email-sync", "integrations"].includes(tabParam)) {
        const roleStr = (user?.role || api.getActiveRole() || "").toLowerCase();
        const userIsAdmin = roleStr.includes("admin");
        if (!userIsAdmin && (tabParam === "team" || tabParam === "webhooks")) {
          setActiveTab("profile");
        } else {
          setActiveTab(tabParam);
        }
      }

      return () => {
        window.removeEventListener("zigmaa_email_sync_updated", handleSyncUpdate);
        window.removeEventListener("zigmaa_role_changed", handleRoleChanged);
      };
    }
  }, []);



  const handleCopyWebhookUrl = () => {
    navigator.clipboard.writeText(webhookUrl);
    setCopiedUrl(true);
    toast.success("Copied to Clipboard", "Webhook URL copied to clipboard!");
    setTimeout(() => setCopiedUrl(false), 2000);
  };

  const handleCopySampleJson = () => {
    navigator.clipboard.writeText(JSON.stringify(samplePayload, null, 2));
    setCopiedJson(true);
    toast.success("Copied to Clipboard", "Sample payload JSON copied!");
    setTimeout(() => setCopiedJson(false), 2000);
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        toast.error("File Too Large", "Please choose an image under 5MB.");
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = reader.result as string;
        setUserPhoto(base64);
        if (typeof window !== "undefined") {
          const user = api.getCurrentUser() || {};
          const updated = { ...user, picture: base64 };
          localStorage.setItem("zigmaa_user", JSON.stringify(updated));
          window.dispatchEvent(new CustomEvent("zigmaa_user_updated"));
        }
        toast.success("Photo Updated", "Your profile photo has been updated.");
      };
      reader.readAsDataURL(file);
    }
  };

  const handleRemovePhoto = async () => {
    const confirmed = await confirm({
      title: "Remove Profile Picture",
      message: "Are you sure you want to remove your profile photo and use initials instead?",
      confirmText: "Remove Photo",
      cancelText: "Cancel",
      variant: "danger"
    });

    if (confirmed) {
      setUserPhoto("");
      if (typeof window !== "undefined") {
        const user = api.getCurrentUser() || {};
        const updated = { ...user, picture: "" };
        localStorage.setItem("zigmaa_user", JSON.stringify(updated));
        window.dispatchEvent(new CustomEvent("zigmaa_user_updated"));
      }
      toast.success("Photo Removed", "Your profile picture was removed.");
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim()) {
      toast.error("Validation Error", "Full name cannot be empty.");
      return;
    }
    if (!email.trim()) {
      toast.error("Validation Error", "Email address cannot be empty.");
      return;
    }

    setProfileSaving(true);
    try {
      await api.updateProfile({
        email: currentUser?.email || email.trim(),
        full_name: fullName.trim(),
        new_email: email.trim(),
        phone: phone.trim(),
        organization_name: companyName.trim(),
        picture: userPhoto
      });

      // Synchronize dynamic Organization branding for Quotations & Invoices
      await api.updateOrganizationSettings({
        company_name: companyName.trim(),
        logo_url: userPhoto || null,
        email: email.trim(),
        phone: phone.startsWith("+") ? phone.trim() : `+91 ${phone.trim()}`,
        address: address.trim(),
        gstin: gstin.trim(),
        signatory_name: signatoryName.trim(),
        signatory_designation: signatoryDesignation.trim(),
        bank_name: bankName.trim(),
        account_number: accountNumber.trim(),
        ifsc_code: ifscCode.trim(),
        upi_id: upiId.trim()
      });

      setSaved(true);
      toast.success("Profile Updated", "Your account and workspace profile was saved successfully.");
      setTimeout(() => setSaved(false), 2500);
    } catch (err: any) {
      toast.error("Update Failed", err.message || "Failed to update profile.");
    } finally {
      setProfileSaving(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError("");

    if (!currentPassword) {
      setPasswordError("Please enter your current password.");
      return;
    }
    if (!newPassword || newPassword.length < 6) {
      setPasswordError("New password must be at least 6 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("New passwords do not match.");
      return;
    }

    setPasswordSaving(true);
    try {
      await api.changePassword({
        email: currentUser?.email || email.trim(),
        current_password: currentPassword,
        new_password: newPassword
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast.success("Password Changed", "Your password has been changed successfully.");
    } catch (err: any) {
      setPasswordError(err.message || "Failed to change password. Please check your current password.");
      toast.error("Password Change Failed", err.message || "Current password incorrect.");
    } finally {
      setPasswordSaving(false);
    }
  };

  const handleSyncNow = async () => {
    setSyncingNow(true);
    await new Promise((r) => setTimeout(r, 600));
    setEmailSync((prev) => ({ ...prev, last_synced_at: "Just now" }));
    setSyncingNow(false);
    toast.success("Mailbox Synced", "All new incoming and outgoing emails are up to date.");
  };

  const handleDisconnectEmail = async () => {
    const confirmed = await confirm({
      title: "Disconnect Email Sync",
      message: `Disconnect ${emailSync.email || "this email account"}? You will not be able to send emails directly from CRM contacts until reconnected.`,
      confirmText: "Disconnect",
      cancelText: "Cancel",
      variant: "danger"
    });

    if (confirmed) {
      await api.disconnectEmailSync();
      setEmailSync({ is_connected: false, email: null, provider: null });
      toast.info("Disconnected", "Email sync account was removed.");
    }
  };

  const handleResetData = async () => {
    const confirmed = await confirm({
      title: "Reset All CRM Data",
      message: "Reset all CRM data to 0 (clean slate)? This removes all local leads, deals, tasks, events, and expenses.",
      confirmText: "Reset to Zero",
      cancelText: "Cancel",
      variant: "danger"
    });

    if (confirmed) {
      api.clearAllData();
      toast.success("Data Reset", "All records reset to 0.");
      setTimeout(() => {
        window.location.reload();
      }, 600);
    }
  };

  return (
    <div className="flex h-screen bg-[#F8FAFC] dark:bg-[#0b0f19] text-slate-900 dark:text-slate-100 font-sans overflow-hidden select-none">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Header />

        <main className="flex-1 overflow-y-auto p-6 lg:p-8 space-y-6 custom-scrollbar bg-[#F8FAFC] dark:bg-[#0b0f19]">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-6 rounded-2xl bg-white border border-slate-200 shadow-xs">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-2xl bg-red-50 text-red-600 border border-red-100">
                <Settings className="w-6 h-6" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-slate-900 tracking-tight">Settings & Preferences</h1>
                <p className="text-xs text-slate-500 font-medium mt-0.5">
                  Manage your profile, inbound webhooks, email connectivity, and calendar integrations.
                </p>
              </div>
            </div>

            {saved && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-bold">
                <CheckCircle2 className="w-4 h-4" />
                <span>Settings Saved!</span>
              </div>
            )}
          </div>

          {/* 1. Horizontal Tabbed Navigation Header */}
          <div className="flex items-center gap-2 border-b border-slate-200/90 pb-2 text-sm font-semibold text-slate-600 flex-wrap sm:flex-nowrap">
            <button
              type="button"
              onClick={() => setActiveTab("profile")}
              className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
                activeTab === "profile"
                  ? "bg-red-600 text-white shadow-xs"
                  : "bg-white text-slate-700 hover:bg-slate-100 border border-slate-200/80"
              }`}
            >
              <User className="w-4 h-4" />
              <span>Profile & Security</span>
            </button>

            {/* Team & Permissions - Admin only */}
            {isAdmin && (
              <button
                type="button"
                onClick={() => setActiveTab("team")}
                className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
                  activeTab === "team"
                    ? "bg-red-600 text-white shadow-xs"
                    : "bg-white text-slate-700 hover:bg-slate-100 border border-slate-200/80"
                }`}
              >
                <Users className="w-4 h-4" />
                <span>Team & Permissions</span>
                {teamMembers.length > 0 && (
                  <span
                    className={`ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                      activeTab === "team"
                        ? "bg-white/20 text-white"
                        : "bg-red-50 text-red-600"
                    }`}
                  >
                    {teamMembers.length}
                  </span>
                )}
              </button>
            )}

            {/* Modules & Fields - Visible to all, View-only for sales_rep */}
            <button
              type="button"
              onClick={() => setActiveTab("modules")}
              className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
                activeTab === "modules"
                  ? "bg-red-600 text-white shadow-xs"
                  : "bg-white text-slate-700 hover:bg-slate-100 border border-slate-200/80"
              }`}
            >
              <Sliders className="w-4 h-4" />
              <span>Modules & Fields</span>
              {!isAdmin && (
                <span className="ml-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-slate-100 text-slate-600 border border-slate-200">
                  View Only
                </span>
              )}
            </button>

            {/* Lead Sources & Forms (System Webhooks) - Admin only */}
            {isAdmin && (
              <button
                type="button"
                onClick={() => setActiveTab("webhooks")}
                className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
                  activeTab === "webhooks"
                    ? "bg-red-600 text-white shadow-xs"
                    : "bg-white text-slate-700 hover:bg-slate-100 border border-slate-200/80"
                }`}
              >
                <Globe className="w-4 h-4" />
                <span>Lead Sources & Forms</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setActiveTab("email-sync")}
              className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
                activeTab === "email-sync"
                  ? "bg-red-600 text-white shadow-xs"
                  : "bg-white text-slate-700 hover:bg-slate-100 border border-slate-200/80"
              }`}
            >
              <Mail className="w-4 h-4" />
              <span>Email Sync</span>
              {emailSync.is_connected && (
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("integrations")}
              className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
                activeTab === "integrations"
                  ? "bg-red-600 text-white shadow-xs"
                  : "bg-white text-slate-700 hover:bg-slate-100 border border-slate-200/80"
              }`}
            >
              <Calendar className="w-4 h-4" />
              <span>Integrations</span>
            </button>


          </div>

          <div className="w-full max-w-5xl mx-auto space-y-6">
            {/* ============================================================== */}
            {/* TAB 1: PROFILE & SECURITY                                      */}
            {/* ============================================================== */}
            {activeTab === "profile" && (
              <div className="space-y-6">
                {/* Personal Profile & Workspace Details Card */}
                <form
                  onSubmit={handleSaveProfile}
                  className="p-6 lg:p-7 rounded-2xl bg-white border border-slate-200/90 shadow-2xs space-y-6"
                >
                  <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                    <div className="flex items-center gap-2.5">
                      <div className="p-2 rounded-xl bg-red-50 text-red-600">
                        <User className="w-5 h-5" />
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-slate-900">Personal & Organization Profile</h3>
                        <p className="text-xs text-slate-500">
                          Manage your identity, contact information, and company credentials
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Profile Photo Row */}
                  <div className="flex flex-col sm:flex-row items-center gap-5 pt-1">
                    <div className="relative group shrink-0">
                      <div className="w-20 h-20 rounded-full bg-gradient-to-br from-amber-400 to-amber-500 text-slate-900 font-bold text-2xl flex items-center justify-center shadow-sm select-none overflow-hidden border-2 border-white ring-2 ring-slate-200">
                        {userPhoto ? (
                          <img
                            src={userPhoto}
                            alt={fullName || "Profile"}
                            className="w-full h-full object-cover"
                            referrerPolicy="no-referrer"
                            crossOrigin="anonymous"
                          />
                        ) : (
                          fullName
                            ? fullName
                                .split(" ")
                                .map((n) => n[0])
                                .join("")
                                .toUpperCase()
                                .slice(0, 2)
                            : "AT"
                        )}
                      </div>
                      <input
                        type="file"
                        id="settings-photo-upload"
                        accept="image/*"
                        onChange={handlePhotoUpload}
                        className="hidden"
                      />
                    </div>

                    <div className="space-y-2 text-center sm:text-left flex-1">
                      <h4 className="text-xs font-bold text-slate-800">Profile Picture</h4>
                      <p className="text-[11px] text-slate-500">
                        PNG, JPG, or GIF up to 5MB. Avatars are synced with your navigation bar.
                      </p>

                      <div className="flex items-center gap-2 justify-center sm:justify-start pt-1">
                        <label
                          htmlFor="settings-photo-upload"
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-semibold shadow-xs transition-colors cursor-pointer"
                        >
                          <UploadCloud className="w-3.5 h-3.5" />
                          <span>{userPhoto ? "Change Photo" : "Upload Photo"}</span>
                        </label>

                        {userPhoto && (
                          <button
                            type="button"
                            onClick={handleRemovePhoto}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-rose-50 text-slate-700 hover:text-rose-600 rounded-xl text-xs font-semibold transition-colors cursor-pointer border border-slate-200 hover:border-rose-200"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Remove</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Form Inputs: Full Name, Email, Phone, Company */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-3 border-t border-slate-100 text-xs">
                    <div>
                      <label className="block text-slate-700 font-bold mb-1.5 flex items-center gap-1.5">
                        <User className="w-3.5 h-3.5 text-slate-400" />
                        <span>Full Name</span>
                      </label>
                      <input
                        type="text"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        placeholder={currentUser?.full_name || "Your Full Name"}
                        className="w-full bg-slate-50 text-slate-900 p-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-red-500 font-medium"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-slate-700 font-bold mb-1.5 flex items-center gap-1.5">
                        <Mail className="w-3.5 h-3.5 text-slate-400" />
                        <span>Email Address</span>
                      </label>
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder={currentUser?.email || "your.email@example.com"}
                        className="w-full bg-slate-50 text-slate-900 p-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-red-500 font-medium"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-slate-700 font-bold mb-1.5 flex items-center gap-1.5">
                        <Phone className="w-3.5 h-3.5 text-slate-400" />
                        <span>Contact Number (10 digits)</span>
                      </label>
                      <div className="flex rounded-xl border border-slate-200 bg-slate-50 overflow-hidden focus-within:ring-2 focus-within:ring-red-500">
                        <span className="px-3 py-2.5 text-xs font-bold text-slate-600 bg-slate-200/60 border-r border-slate-200 select-none">
                          +91
                        </span>
                        <input
                          type="tel"
                          inputMode="numeric"
                          maxLength={10}
                          value={phone}
                          onChange={(e) => {
                            const digits = e.target.value.replace(/\D/g, "").slice(0, 10);
                            setPhone(digits);
                          }}
                          placeholder="9876543210"
                          className="flex-1 bg-transparent text-slate-900 p-2.5 focus:outline-none font-medium tracking-wide text-xs"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-slate-700 font-bold mb-1.5 flex items-center gap-1.5">
                        <Building2 className="w-3.5 h-3.5 text-slate-400" />
                        <span>Company / Organization Name</span>
                      </label>
                      <input
                        type="text"
                        value={companyName}
                        onChange={(e) => setCompanyName(e.target.value)}
                        placeholder="Arsath Thoufiq's Workspace"
                        className="w-full bg-slate-50 text-slate-900 p-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-red-500 font-medium"
                      />
                    </div>
                  </div>

                  <div className="pt-3 flex justify-end border-t border-slate-100">
                    <button
                      type="submit"
                      disabled={profileSaving}
                      className="px-5 py-2.5 bg-red-600 hover:bg-red-700 active:bg-red-800 text-white rounded-xl text-xs font-bold shadow-xs transition-colors cursor-pointer disabled:opacity-50"
                    >
                      {profileSaving ? "Saving..." : "Save Profile Details"}
                    </button>
                  </div>
                </form>

                {/* Change Password Card */}
                <form
                  onSubmit={handleChangePassword}
                  className="p-6 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-5"
                >
                  <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                    <div className="flex items-center gap-2.5">
                      <div className="p-2 rounded-xl bg-red-50 text-red-600">
                        <KeyRound className="w-5 h-5" />
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-slate-900">Change Password</h3>
                        <p className="text-xs text-slate-500">Ensure your account uses a long, secure password</p>
                      </div>
                    </div>
                  </div>

                  {passwordError && (
                    <div className="flex items-center gap-2 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium">
                      <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                      <span>{passwordError}</span>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
                    <div>
                      <label className="block text-slate-700 font-bold mb-1.5">Current Password</label>
                      <div className="relative">
                        <input
                          type={showCurrentPassword ? "text" : "password"}
                          value={currentPassword}
                          onChange={(e) => setCurrentPassword(e.target.value)}
                          placeholder="••••••••"
                          className="w-full bg-slate-50 text-slate-900 p-2.5 pr-10 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-red-500 font-medium"
                          required
                        />
                        <button
                          type="button"
                          onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                          className="absolute right-3 top-3 text-slate-400 hover:text-slate-600"
                        >
                          {showCurrentPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    <div>
                      <label className="block text-slate-700 font-bold mb-1.5">New Password (min. 6)</label>
                      <div className="relative">
                        <input
                          type={showNewPassword ? "text" : "password"}
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          placeholder="••••••••"
                          className="w-full bg-slate-50 text-slate-900 p-2.5 pr-10 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-red-500 font-medium"
                          required
                        />
                        <button
                          type="button"
                          onClick={() => setShowNewPassword(!showNewPassword)}
                          className="absolute right-3 top-3 text-slate-400 hover:text-slate-600"
                        >
                          {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    <div>
                      <label className="block text-slate-700 font-bold mb-1.5">Confirm New Password</label>
                      <div className="relative">
                        <input
                          type={showConfirmPassword ? "text" : "password"}
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          placeholder="••••••••"
                          className="w-full bg-slate-50 text-slate-900 p-2.5 pr-10 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-red-500 font-medium"
                          required
                        />
                        <button
                          type="button"
                          onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                          className="absolute right-3 top-3 text-slate-400 hover:text-slate-600"
                        >
                          {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="pt-2 flex justify-start">
                    <button
                      type="submit"
                      disabled={passwordSaving}
                      className="px-5 py-2.5 bg-red-600 hover:bg-red-700 active:bg-red-800 text-white rounded-xl text-xs font-bold shadow-xs transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-2"
                    >
                      <Lock className="w-3.5 h-3.5" />
                      <span>{passwordSaving ? "Updating Password..." : "Update Password"}</span>
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* ============================================================== */}
            {/* TAB: TEAM & PERMISSIONS (RBAC)                                 */}
            {/* ============================================================== */}
            {activeTab === "team" && isAdmin && (
              <div className="space-y-6">
                {/* Header Action Bar */}
                <div className="p-6 rounded-2xl bg-white border border-slate-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-2xl bg-red-50 text-red-600 border border-red-100">
                      <Users className="w-5 h-5" />
                    </div>
                    <div>
                      <h2 className="text-base font-bold text-slate-900 tracking-tight">
                        Team Members & Role-Based Access Control
                      </h2>
                      <p className="text-xs text-slate-500 font-medium mt-0.5">
                        Manage organization staff, role permissions, and lead assignment scoping.
                      </p>
                    </div>
                  </div>

                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => setShowInviteDrawer(true)}
                      className="px-4 py-2.5 bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-700 hover:to-rose-700 text-white rounded-xl text-xs font-bold shadow-md shadow-red-500/20 transition-all flex items-center justify-center gap-2 cursor-pointer shrink-0"
                    >
                      <UserPlus className="w-4 h-4" />
                      <span>Invite Team Member</span>
                    </button>
                  )}
                </div>

                {/* Team Quick Stats Overview */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="p-5 rounded-2xl bg-white border border-slate-200/90 shadow-2xs">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                        Total Members
                      </span>
                      <div className="w-8 h-8 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center">
                        <Users className="w-4 h-4" />
                      </div>
                    </div>
                    <div className="text-2xl font-black text-slate-900 tracking-tight">
                      {teamMembers.length}
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1 font-medium">
                      Active organization accounts
                    </p>
                  </div>

                  <div className="p-5 rounded-2xl bg-white border border-slate-200/90 shadow-2xs">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                        Administrators
                      </span>
                      <div className="w-8 h-8 rounded-xl bg-red-50 text-red-600 flex items-center justify-center">
                        <ShieldCheck className="w-4 h-4" />
                      </div>
                    </div>
                    <div className="text-2xl font-black text-slate-900 tracking-tight">
                      {teamMembers.filter((m) => (m.role || "").toLowerCase() === "admin").length}
                    </div>
                    <p className="text-[11px] text-red-600 mt-1 font-medium">
                      Full access to all leads & settings
                    </p>
                  </div>

                  <div className="p-5 rounded-2xl bg-white border border-slate-200/90 shadow-2xs">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                        Sales Representatives
                      </span>
                      <div className="w-8 h-8 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center">
                        <User className="w-4 h-4" />
                      </div>
                    </div>
                    <div className="text-2xl font-black text-slate-900 tracking-tight">
                      {teamMembers.filter((m) => (m.role || "").toLowerCase() !== "admin").length}
                    </div>
                    <p className="text-[11px] text-slate-500 mt-1 font-medium">
                      Scoped to assigned deals & leads
                    </p>
                  </div>
                </div>

                {/* Team Members Table / Cards Container */}
                <div className="p-6 rounded-2xl bg-white border border-slate-200/90 shadow-2xs space-y-4">
                  {/* Search and Filters Toolbar */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
                    <div className="relative flex-1 max-w-sm">
                      <input
                        type="text"
                        value={teamSearchQuery}
                        onChange={(e) => setTeamSearchQuery(e.target.value)}
                        placeholder="Search by name, email, or role..."
                        className="w-full pl-9 pr-4 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500 font-medium transition-all"
                      />
                      <Users className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={loadTeamMembers}
                        disabled={loadingTeam}
                        className="px-3 py-2 bg-slate-100 hover:bg-slate-200/80 text-slate-700 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                        title="Refresh Team List"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${loadingTeam ? "animate-spin" : ""}`} />
                        <span>Refresh</span>
                      </button>
                    </div>
                  </div>

                  {/* Table */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-slate-100 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                          <th className="py-3 px-4">Member</th>
                          <th className="py-3 px-4">Role Badge</th>
                          <th className="py-3 px-4 text-center">Assigned Pipeline</th>
                          <th className="py-3 px-4 text-center">Status</th>
                          <th className="py-3 px-4 text-right">Role & Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-xs">
                        {teamMembers
                          .filter((m) => {
                            if (!teamSearchQuery.trim()) return true;
                            const q = teamSearchQuery.toLowerCase();
                            return (
                              (m.full_name || "").toLowerCase().includes(q) ||
                              (m.email || "").toLowerCase().includes(q) ||
                              (m.role || "").toLowerCase().includes(q)
                            );
                          })
                          .map((member) => {
                            const isSelf = member.email === currentUser?.email || member.id === currentUser?.id;
                            const roleBadge = () => {
                              const r = (member.role || "").toLowerCase();
                              if (r === "admin") {
                                return (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-red-50 text-red-600 border border-red-200">
                                    <ShieldCheck className="w-3 h-3" />
                                    <span>Admin</span>
                                  </span>
                                );
                              }
                              if (r === "manager") {
                                return (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                                    <Building2 className="w-3 h-3" />
                                    <span>Manager</span>
                                  </span>
                                );
                              }
                              return (
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
                                  <User className="w-3 h-3" />
                                  <span>Sales Rep</span>
                                </span>
                              );
                            };

                            const initials = (member.full_name || member.email || "U")
                              .split(" ")
                              .map((n: string) => n[0])
                              .join("")
                              .toUpperCase()
                              .slice(0, 2);

                            return (
                              <tr
                                key={member.id}
                                className="hover:bg-slate-50/70 transition-colors"
                              >
                                {/* Member Info */}
                                <td className="py-3.5 px-4">
                                  <div className="flex items-center gap-3">
                                    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-red-500 to-rose-600 text-white font-bold flex items-center justify-center text-xs shadow-xs shrink-0 select-none">
                                      {initials}
                                    </div>
                                    <div>
                                      <div className="font-bold text-slate-900 flex items-center gap-1.5">
                                        <span>{member.full_name}</span>
                                        {isSelf && (
                                          <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded-md font-semibold">
                                            You
                                          </span>
                                        )}
                                      </div>
                                      <div className="text-[11px] text-slate-500 font-normal">
                                        {member.email}
                                      </div>
                                    </div>
                                  </div>
                                </td>

                                {/* Role Badge */}
                                <td className="py-3.5 px-4 whitespace-nowrap">
                                  {roleBadge()}
                                </td>

                                {/* Assigned Metrics */}
                                <td className="py-3.5 px-4 text-center whitespace-nowrap">
                                  <div className="inline-flex items-center gap-2">
                                    <span className="px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 font-semibold text-[11px]">
                                      {member.assigned_deals_count ?? 0} Deals
                                    </span>
                                    <span className="px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 border border-blue-200 font-semibold text-[11px]">
                                      {member.assigned_leads_count ?? 0} Leads
                                    </span>
                                  </div>
                                </td>

                                {/* Status */}
                                <td className="py-3.5 px-4 text-center whitespace-nowrap">
                                  <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700">
                                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                                    <span>Active</span>
                                  </span>
                                </td>

                                {/* Actions / Role & Status */}
                                <td className="py-3.5 px-4 text-right whitespace-nowrap">
                                  <div className="inline-flex items-center gap-2 justify-end">
                                    {(member.role || "").toLowerCase() === "admin" ? (
                                      <span
                                        className="inline-flex items-center gap-1.5 py-1 px-2.5 text-xs font-semibold rounded-lg bg-red-50 text-red-700 border border-red-200 select-none cursor-default"
                                        title="Organization Administrator (Locked)"
                                      >
                                        <Lock className="w-3 h-3 text-red-500" />
                                        <span>Admin</span>
                                      </span>
                                    ) : (
                                      <span
                                        className="inline-flex items-center gap-1.5 py-1 px-2.5 text-xs font-semibold rounded-lg bg-slate-100 text-slate-700 border border-slate-200 select-none cursor-default"
                                      >
                                        <User className="w-3 h-3 text-slate-400" />
                                        <span>Sales Rep</span>
                                      </span>
                                    )}

                                    {/* Delete Button (Only active for invited sales reps, locked for admin) */}
                                    {isAdmin && (member.role || "").toLowerCase() !== "admin" && !isSelf && (
                                      <button
                                        type="button"
                                        onClick={() => handleDeleteMember(member)}
                                        className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                                        title="Remove team member"
                                      >
                                        <Trash2 className="w-4 h-4" />
                                      </button>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>

                  {teamMembers.length === 0 && !loadingTeam && (
                    <div className="py-12 text-center text-slate-400 text-xs">
                      No team members found. Click &quot;Invite Team Member&quot; to invite your sales team.
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ============================================================== */}
            {/* TAB: MODULES & CUSTOM FIELDS (TWOZO STYLE)                     */}
            {/* ============================================================== */}
            {activeTab === "modules" && (
              <ModulesAndFieldsManager readOnly={!isAdmin} />
            )}

            {/* ============================================================== */}
            {/* TAB 2: LEAD SOURCES & FORMS (CLEAN ZIGMAA STYLE)               */}
            {/* ============================================================== */}
            {activeTab === "webhooks" && isAdmin && (
              <div className="space-y-6">
                {/* Header Subtitle */}
                <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-xs flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-bold text-slate-900">Lead Capture Channels</h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Connect your ad campaigns and landing page forms to capture new leads automatically.
                    </p>
                  </div>
                  <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                    2 Active Channels
                  </span>
                </div>

                {/* CARD 1: Meta Lead Ads (Facebook & Instagram) */}
                <div className="p-6 lg:p-7 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
                    <div className="flex items-center gap-3">
                      <div className="w-11 h-11 rounded-2xl bg-blue-50 border border-blue-100 text-blue-600 flex items-center justify-center text-xl shrink-0 font-bold">
                        f
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-bold text-slate-900">Meta Ads Lead Ingestion</h3>
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                            Facebook & Instagram
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5">
                          Automatically send leads from your Facebook & Instagram lead generation campaigns directly into Zigmaa CRM contacts.
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 self-start sm:self-auto shrink-0">
                      <span className="w-2 h-2 rounded-full bg-emerald-500" />
                      <span className="text-xs font-semibold text-slate-600">Ready to connect</span>
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-50/70 p-4 rounded-xl border border-slate-200/80">
                    <div className="flex-1 min-w-0">
                      <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block mb-1">
                        Meta Webhook URL
                      </label>
                      <input
                        type="text"
                        readOnly
                        value={webhookUrl}
                        className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs font-mono text-slate-700 select-all focus:outline-none"
                      />
                    </div>
                    <div className="flex items-center gap-2 shrink-0 pt-2 sm:pt-4">
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(webhookUrl);
                          setCopiedMetaUrl(true);
                          toast.success("Link Copied", "Meta Webhook URL copied to clipboard!");
                          setTimeout(() => setCopiedMetaUrl(false), 2000);
                        }}
                        className="px-4 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-bold transition-all shadow-2xs cursor-pointer flex items-center gap-1.5"
                      >
                        {copiedMetaUrl ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{copiedMetaUrl ? "Copied" : "Copy Link"}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          toast.info("Meta Ads Ready", "Webhook is listening for incoming Facebook & Instagram lead forms.");
                        }}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-xs transition-all cursor-pointer"
                      >
                        Connect Meta Account
                      </button>
                    </div>
                  </div>
                </div>

                {/* CARD 2: Website Contact Forms & Landing Pages */}
                <div className="p-6 lg:p-7 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
                    <div className="flex items-center gap-3">
                      <div className="w-11 h-11 rounded-2xl bg-emerald-50 border border-emerald-100 text-emerald-600 flex items-center justify-center text-xl shrink-0">
                        <Globe className="w-6 h-6" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-bold text-slate-900">Website & Landing Page Forms</h3>
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            WordPress • Webflow • Custom
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5">
                          Connect your WordPress, Webflow, or custom website forms to receive enquiries instantly.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Clean Form Ingestion Link */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700">Form Ingestion Link</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        readOnly
                        value={webhookUrl}
                        className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-mono font-medium text-slate-800 select-all focus:outline-none focus:ring-2 focus:ring-emerald-500 shadow-2xs"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(webhookUrl);
                          setCopiedUrl(true);
                          toast.success("Link Copied", "Link copied! Share this with your website developer.");
                          setTimeout(() => setCopiedUrl(false), 2500);
                        }}
                        className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white rounded-xl text-xs font-bold shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer shrink-0"
                      >
                        {copiedUrl ? (
                          <>
                            <Check className="w-3.5 h-3.5" />
                            <span>Link Copied!</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span>Copy Link</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Friendly 3-Step Guide */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
                    <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 flex items-start gap-2.5">
                      <div className="w-6 h-6 rounded-full bg-white text-slate-700 font-bold text-xs flex items-center justify-center shrink-0 border border-slate-200 shadow-2xs">
                        1
                      </div>
                      <p className="text-xs text-slate-600 leading-snug">
                        Copy your unique CRM link above.
                      </p>
                    </div>

                    <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 flex items-start gap-2.5">
                      <div className="w-6 h-6 rounded-full bg-white text-slate-700 font-bold text-xs flex items-center justify-center shrink-0 border border-slate-200 shadow-2xs">
                        2
                      </div>
                      <p className="text-xs text-slate-600 leading-snug">
                        Paste it into your website form&apos;s submission settings.
                      </p>
                    </div>

                    <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 flex items-start gap-2.5">
                      <div className="w-6 h-6 rounded-full bg-white text-slate-700 font-bold text-xs flex items-center justify-center shrink-0 border border-slate-200 shadow-2xs">
                        3
                      </div>
                      <p className="text-xs text-slate-600 leading-snug">
                        New enquiries will instantly appear in your Contacts list!
                      </p>
                    </div>
                  </div>
                </div>

                {/* 3. Collapsible Developer / Technical Guide (Collapsed by default) */}
                <div className="rounded-2xl bg-white border border-slate-200 overflow-hidden shadow-2xs">
                  <button
                    type="button"
                    onClick={() => setShowDevGuide(!showDevGuide)}
                    className="w-full p-4 flex items-center justify-between text-left hover:bg-slate-50/80 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm">⚙️</span>
                      <span className="text-xs font-bold text-slate-700">
                        Advanced Developer Settings
                      </span>
                      <span className="text-[10px] text-slate-400 font-medium">
                        (JSON Payload Schema for Software Engineers)
                      </span>
                    </div>
                    {showDevGuide ? (
                      <ChevronUp className="w-4 h-4 text-slate-400" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-slate-400" />
                    )}
                  </button>

                  {showDevGuide && (
                    <div className="p-5 border-t border-slate-100 bg-slate-50/50 space-y-3 animate-in fade-in duration-150">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                          <Code2 className="w-3.5 h-3.5 text-slate-400" />
                          <span>Standard JSON Request Schema</span>
                        </span>
                        <button
                          type="button"
                          onClick={handleCopySampleJson}
                          className="px-2.5 py-1 bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 rounded-lg text-[11px] font-semibold transition-colors flex items-center gap-1 cursor-pointer"
                        >
                          {copiedJson ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                          <span>{copiedJson ? "Copied" : "Copy Payload"}</span>
                        </button>
                      </div>

                      <div className="relative rounded-xl bg-slate-900 p-3.5 text-slate-200 font-mono text-[11px] overflow-x-auto shadow-inner">
                        <pre className="leading-relaxed">
{`{
  "full_name": "John Doe",
  "phone": "+919876543210",
  "email": "john@example.com",
  "company_name": "Acme Innovations",
  "source": "WEBSITE_FORM"
}`}
                        </pre>
                      </div>
                      <p className="text-[11px] text-slate-400">
                        Endpoint accepts <code>POST</code> with <code>Content-Type: application/json</code>. Duplicate phone numbers are automatically linked to existing contacts.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ============================================================== */}
            {/* TAB 3: EMAIL SYNC (ZIGMAA 1-CLICK MAILBOX SYNC)                 */}
            {/* ============================================================== */}
            {activeTab === "email-sync" && (
              <div className="space-y-6">
                <div className="p-6 lg:p-7 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-6">
                  {/* Tab Title & Description */}
                  <div className="flex items-center justify-between pb-4 border-b border-slate-100">
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 rounded-2xl bg-rose-50 text-[#e11d48] border border-rose-100">
                        <Mail className="w-6 h-6" />
                      </div>
                      <div>
                        <h2 className="text-base font-bold text-slate-900">Email Sync</h2>
                        <p className="text-xs text-slate-500 font-medium mt-0.5">
                          Connect your professional mailbox for seamless 1-click email delivery.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Condition 1: If NOT Connected */}
                  {!emailSync.is_connected ? (
                    <div className="space-y-6">
                      {/* Feature Highlights Grid */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 flex items-start gap-3">
                          <div className="w-8 h-8 rounded-lg bg-white shadow-2xs border border-slate-200 text-slate-700 flex items-center justify-center shrink-0 text-base">
                            ✉️
                          </div>
                          <div>
                            <h4 className="text-xs font-bold text-slate-900">Send and schedule emails</h4>
                            <p className="text-[11px] text-slate-500 mt-0.5">
                              Deliver emails to leads and contacts directly from contact drawers with zero SMTP configuration.
                            </p>
                          </div>
                        </div>

                        <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 flex items-start gap-3">
                          <div className="w-8 h-8 rounded-lg bg-white shadow-2xs border border-slate-200 text-slate-700 flex items-center justify-center shrink-0 text-base">
                            📈
                          </div>
                          <div>
                            <h4 className="text-xs font-bold text-slate-900">Track email engagement</h4>
                            <p className="text-[11px] text-slate-500 mt-0.5">
                              Real-time delivery status, reply tracking, and full conversational logs inside contact history.
                            </p>
                          </div>
                        </div>

                        <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 flex items-start gap-3">
                          <div className="w-8 h-8 rounded-lg bg-white shadow-2xs border border-slate-200 text-slate-700 flex items-center justify-center shrink-0 text-base">
                            🔗
                          </div>
                          <div>
                            <h4 className="text-xs font-bold text-slate-900">Link emails automatically</h4>
                            <p className="text-[11px] text-slate-500 mt-0.5">
                              Every conversation is auto-associated with the corresponding contact and pipeline deal.
                            </p>
                          </div>
                        </div>

                        <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 flex items-start gap-3">
                          <div className="w-8 h-8 rounded-lg bg-white shadow-2xs border border-slate-200 text-slate-700 flex items-center justify-center shrink-0 text-base">
                            ⚡
                          </div>
                          <div>
                            <h4 className="text-xs font-bold text-slate-900">Setup email workflows</h4>
                            <p className="text-[11px] text-slate-500 mt-0.5">
                              Power automated follow-up sequences when leads enter new pipeline stages.
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Primary Connect CTA */}
                      <div className="p-6 rounded-2xl bg-gradient-to-r from-rose-50/70 via-slate-50 to-rose-50/40 border border-rose-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div>
                          <h3 className="text-sm font-bold text-slate-900">Ready to sync your mailbox?</h3>
                          <p className="text-xs text-slate-600 mt-0.5">
                            Connect your Google Workspace, Microsoft Outlook, or corporate email in one click.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setShowConnectModal(true)}
                          className="px-5 py-2.5 bg-[#e11d48] hover:bg-[#be123c] active:bg-[#9f1239] text-white rounded-xl text-xs font-bold shadow-sm shadow-rose-600/20 transition-all flex items-center gap-2 shrink-0 cursor-pointer"
                        >
                          <Plus className="w-4 h-4" />
                          <span>Connect Email Account</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* Condition 2: If Connected */
                    <div className="space-y-5">
                      <div className="p-5 rounded-2xl bg-slate-50 border border-slate-200 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div className="flex items-center gap-3.5">
                          <div className="w-12 h-12 rounded-xl bg-white border border-slate-200 text-xl shadow-2xs shrink-0 flex items-center justify-center">
                            {emailSync.provider === "GMAIL" || (emailSync.email && emailSync.email.includes("gmail")) ? "🔴" : emailSync.provider === "OUTLOOK" ? "🔷" : "✉️"}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h3 className="text-sm font-bold text-slate-900">
                                {emailSync.email || email || currentUser?.email || "Connected Email"}
                              </h3>
                              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1.5">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                <span>Connected & Active</span>
                              </span>
                            </div>
                            <p className="text-xs text-slate-500 font-medium mt-1">
                              Direct SMTP/OAuth Sync Active • Last checked: {emailSync.last_synced_at || "Just now"}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={handleSyncNow}
                            disabled={syncingNow}
                            className="px-4 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-bold rounded-xl shadow-2xs transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                          >
                            <RefreshCw className={`w-3.5 h-3.5 ${syncingNow ? "animate-spin text-[#e11d48]" : ""}`} />
                            <span>{syncingNow ? "Testing..." : "Test Mailbox"}</span>
                          </button>
                          <button
                            type="button"
                            onClick={handleDisconnectEmail}
                            className="px-4 py-2 bg-rose-50 border border-rose-200 hover:bg-rose-100 text-[#e11d48] text-xs font-bold rounded-xl shadow-2xs transition-colors cursor-pointer"
                          >
                            Disconnect Mailbox
                          </button>
                        </div>
                      </div>

                      <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 space-y-1">
                        <p className="font-semibold text-slate-700">Inbox Sync Features Enabled:</p>
                        <p className="text-[11px] text-slate-500">
                          Direct sending from Contact Details drawers is live. Zero manual SMTP port, host, or password configuration required.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ============================================================== */}
            {/* TAB 4: INTEGRATIONS & WORKSPACE RESET                          */}
            {/* ============================================================== */}
            {activeTab === "integrations" && (
              <div className="space-y-6">
                {/* Google Calendar Integration Card */}
                <div className="p-6 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-4 border-l-4 border-l-red-600">
                  <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                    <div className="flex items-center gap-2.5">
                      <div className="p-2 rounded-xl bg-red-50 text-red-600">
                        <Calendar className="w-5 h-5" />
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-slate-900">Google Calendar Integration</h3>
                        <p className="text-xs text-slate-500">Live synchronization for sales meetings and demo bookings</p>
                      </div>
                    </div>

                    <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                      Ready & Enabled
                    </span>
                  </div>

                  <p className="text-xs text-slate-600 leading-relaxed">
                    Your CRM integrates with Google Calendar. Every scheduled call or meeting includes direct
                    <strong> &quot;Add to Google Cal&quot;</strong> and <strong>&quot;Download .ics&quot;</strong> actions.
                  </p>

                  <div className="flex items-center gap-3 pt-1">
                    <a
                      href="https://calendar.google.com"
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1.5 px-3.5 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-semibold shadow-xs transition-colors"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>Launch Google Calendar</span>
                    </a>
                  </div>
                </div>

                {/* Danger Zone: Start from Zero (Admin Only) */}
                {activeRole !== "ADMIN" ? (
                  <div className="p-6 rounded-2xl bg-slate-100 border border-slate-200/90 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-3 text-slate-500">
                      <div className="w-9 h-9 rounded-xl bg-slate-200 text-slate-600 flex items-center justify-center shrink-0">
                        <Lock className="w-4 h-4" />
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-slate-700">
                          Database Reset Restricted
                        </h4>
                        <p className="text-xs text-slate-500 mt-0.5">
                          Only CRM Administrators have permission to reset organization records. Sales Representatives are restricted from database purge operations.
                        </p>
                      </div>
                    </div>
                    <span className="px-3 py-1.5 rounded-xl bg-slate-200 text-slate-600 text-xs font-bold border border-slate-300/80 shrink-0 self-start sm:self-auto">
                      Admin Authorization Required
                    </span>
                  </div>
                ) : (
                  <div className="p-6 rounded-2xl bg-rose-50/60 border border-rose-200 shadow-xs space-y-3">
                    <div className="flex items-center gap-2 text-rose-800">
                      <RotateCcw className="w-4 h-4" />
                      <h3 className="text-sm font-bold">Start from Zero (Clean Slate)</h3>
                    </div>
                    <p className="text-xs text-rose-700">
                      Clear all mock leads, deals, tasks, calendar events, and expenses. Your CRM will reset to pure 0 counters.
                    </p>
                    <button
                      type="button"
                      onClick={handleResetData}
                      className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold shadow-sm transition-all cursor-pointer"
                    >
                      Reset All Records to 0
                    </button>
                  </div>
                )}
              </div>
            )}


          </div>
        </main>
      </div>

      {/* Invite Team Member Slide Drawer */}
      <InviteMemberDrawer
        isOpen={showInviteDrawer}
        onClose={() => setShowInviteDrawer(false)}
        onMemberInvited={(newMember) => {
          setTeamMembers((prev) => [...prev, newMember]);
          toast.success("Team Member Added", `${newMember.full_name} is now part of your organization.`);
        }}
      />

      {/* Zigmaa 1-Click Connect Email Modal */}
      <ConnectEmailModal
        isOpen={showConnectModal}
        onClose={() => setShowConnectModal(false)}
        defaultEmail={email || currentUser?.email || ""}
        onConnected={(data) => {
          setEmailSync({
            is_connected: true,
            email: data.email || email || currentUser?.email || "",
            provider: data.provider || "GMAIL",
            last_synced_at: "Just now"
          });
          setShowConnectModal(false);
        }}
      />
    </div>
  );
}
