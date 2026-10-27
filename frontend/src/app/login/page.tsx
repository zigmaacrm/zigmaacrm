"use client";

import { useState, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { 
  Eye, 
  EyeOff, 
  X, 
  CheckCircle2, 
  ChevronDown, 
  Users, 
  Briefcase, 
  GitBranch, 
  Zap, 
  BarChart3, 
  CheckCircle, 
  Check,
  ArrowUpRight,
  ShieldCheck,
  Building2,
  Phone,
  FileText,
  Trophy,
  ArrowRight,
  Layers,
  Sparkles,
  Mail,
  Lock,
  AlertCircle
} from "lucide-react";
import { api } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const pathname = usePathname();
  const [isSignUp, setIsSignUp] = useState(pathname === "/signup");
  const [isResetPassword, setIsResetPassword] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [otpValues, setOtpValues] = useState(["", "", "", "", "", ""]);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");

  // Login form state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // Sign up form state
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [signUpPassword, setSignUpPassword] = useState("");
  const [signUpEmail, setSignUpEmail] = useState("");
  const [countryCode, setCountryCode] = useState("+91");
  const [contactNumber, setContactNumber] = useState("");
  const [showSignUpPassword, setShowSignUpPassword] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [otpVerified, setOtpVerified] = useState(false);
  const [toastMessage, setToastMessage] = useState("");

  useEffect(() => {
    // Keep login and sign-up pages permanently in pure light mode
    document.documentElement.classList.remove("dark");
    document.documentElement.style.colorScheme = "light";
  }, []);

  useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => setToastMessage(""), 4500);
      return () => clearTimeout(timer);
    }
  }, [toastMessage]);

  // Field-level error validation mapping (e.g. { email: "Invalid email", password: "Password is required" })
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const validateEmailFormat = (val: string) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val.trim());
  };

  const validatePhoneFormat = (val: string) => {
    const clean = val.replace(/\D/g, "");
    return clean.length === 10;
  };

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();

    if (!email.trim() && !password) {
      setError("Please enter your email and password.");
      return;
    }

    if (!email.trim()) {
      setError("Email address is required.");
      return;
    }

    if (!validateEmailFormat(email)) {
      setError("Please enter a valid email address.");
      return;
    }

    if (!password) {
      setError("Password is required.");
      return;
    }

    setSubmitting(true);
    setError("");
    setSuccessMsg("");

    try {
      const loginRes = await api.login(email, password);
      const user = loginRes?.user;
      const roleStr = (user?.role || "").toLowerCase();
      const emailStr = (user?.email || email || "").toLowerCase();
      const isSuper = !!user?.is_super_admin || roleStr === "super_admin" || ["admin@zigmaa.com", "zigmaaadmin", "zigmaaadmin@zigmaa.com"].includes(emailStr);
      if (isSuper) {
        api.logout();
        setError("Incorrect email or password");
        return;
      }
      window.location.href = "/";
    } catch (err: any) {
      const errMsg = err.message || "Incorrect email or password";
      setError(errMsg);
      // Keep error message in top banner only - no duplicate underneath the fields
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    const errors: Record<string, string> = {};

    if (!firstName.trim()) {
      errors.firstName = "First name is required";
    }
    if (!lastName.trim()) {
      errors.lastName = "Last name is required";
    }
    if (!companyName.trim()) {
      errors.companyName = "Company name is required";
    }
    if (!signUpPassword) {
      errors.signUpPassword = "Password is required";
    } else if (signUpPassword.length < 6) {
      errors.signUpPassword = "Password must be at least 6 characters";
    }

    if (!signUpEmail.trim()) {
      errors.signUpEmail = "Email is required";
    } else if (!validateEmailFormat(signUpEmail)) {
      errors.signUpEmail = "Invalid email";
    }

    if (!contactNumber.trim()) {
      errors.contactNumber = "Contact number is required";
    } else if (!validatePhoneFormat(contactNumber)) {
      errors.contactNumber = "Please enter a valid 10-digit mobile number";
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setFieldErrors({});
    setSubmitting(true);
    setError("");
    setSuccessMsg("");

    try {
      const fullName = `${firstName.trim()} ${lastName.trim()}`;
      const fullPhone = `${countryCode} ${contactNumber.trim()}`;
      await api.register({
        email: signUpEmail.trim(),
        password: signUpPassword,
        full_name: fullName,
        organization_name: companyName.trim(),
        company_name: companyName.trim(),
        phone: fullPhone,
        contact_number: fullPhone
      });
      window.location.href = "/";
    } catch (err: any) {
      const errMsg = err.message || "Failed to create account.";
      setError(errMsg);

      // Highlight corresponding field
      const lower = errMsg.toLowerCase();
      const newFieldErrors: Record<string, string> = {};
      if (lower.includes("email")) {
        newFieldErrors.signUpEmail = "Already registered email";
      }
      if (lower.includes("company")) {
        newFieldErrors.companyName = "Already registered company name";
      }
      if (lower.includes("phone") || lower.includes("contact")) {
        newFieldErrors.contactNumber = "Already registered phone number";
      }
      if (Object.keys(newFieldErrors).length > 0) {
        setFieldErrors(newFieldErrors);
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSendOtp(e: React.FormEvent) {
    e.preventDefault();
    const cleanEmail = resetEmail.trim().toLowerCase();
    if (!cleanEmail) {
      setError("Please enter your email address");
      return;
    }
    if (!validateEmailFormat(cleanEmail)) {
      setError("Please enter a valid email address");
      return;
    }

    setSubmitting(true);
    setError("");
    setSuccessMsg("");

    try {
      const res = await api.sendOtp(cleanEmail);
      setOtpSent(true);
      setOtpVerified(false);
      setToastMessage(`OTP sent to ${cleanEmail}`);
      setError("");
      setSuccessMsg("");
    } catch (err: any) {
      // STRICT: Ensure OTP screen is NEVER displayed if email is not registered
      setOtpSent(false);
      setOtpVerified(false);
      setSuccessMsg("");
      setToastMessage("");
      setError(err.message || "This email address is not registered with Zigmaa CRM. Please verify the email or sign up.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    const cleanEmail = resetEmail.trim().toLowerCase();
    const otpCode = otpValues.join("").trim();
    if (otpCode.length !== 6) {
      setError("Please enter the complete 6-digit OTP");
      return;
    }

    setSubmitting(true);
    setError("");
    setSuccessMsg("");

    try {
      const res = await api.verifyOtp(cleanEmail, otpCode);
      setOtpVerified(true);
      setSuccessMsg("Code verified! Please enter your new password below.");
    } catch (err: any) {
      setError(err.message || "Invalid or expired verification code.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResetPasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    const cleanEmail = resetEmail.trim().toLowerCase();
    const otpCode = otpValues.join("").trim();
    if (!newPassword || newPassword.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }

    setSubmitting(true);
    setError("");
    setSuccessMsg("");

    try {
      const res = await api.resetPassword(cleanEmail, otpCode, newPassword);
      setSuccessMsg(res.message || "Password updated successfully. Please log in.");
      setTimeout(() => {
        setIsResetPassword(false);
        setOtpSent(false);
        setOtpVerified(false);
        setPassword(newPassword);
        setEmail(cleanEmail);
      }, 1500);
    } catch (err: any) {
      setError(err.message || "Failed to reset password.");
    } finally {
      setSubmitting(false);
    }
  }


  // Google OAuth Client ID
  const GOOGLE_CLIENT_ID =
    process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ||
    "38953728767-m0ufev60495sh0qnmmjpjg2smio9dbhl.apps.googleusercontent.com";

  // Load Google Identity Services SDK dynamically
  useEffect(() => {
    if (typeof window !== "undefined") {
      const existingScript = document.getElementById("google-gsi-script");
      if (!existingScript) {
        const script = document.createElement("script");
        script.id = "google-gsi-script";
        script.src = "https://accounts.google.com/gsi/client";
        script.async = true;
        script.defer = true;
        document.body.appendChild(script);
      }
    }
  }, []);

  const handleGoogleSignIn = () => {
    setGoogleLoading(true);
    setError("");

    if (typeof window === "undefined") {
      setGoogleLoading(false);
      return;
    }

    const google = (window as any).google;

    if (google?.accounts?.oauth2) {
      // Auto-reset loading after 12 seconds so the button never stays stuck
      const safetyTimer = setTimeout(() => {
        setGoogleLoading(false);
      }, 12000);

      // Reset loading if the user closes or dismisses the Google popup
      const onWindowFocus = () => {
        setTimeout(() => {
          setGoogleLoading((curr) => {
            // If still loading after focus regained, user likely closed the popup
            return false;
          });
        }, 2000);
      };
      window.addEventListener("focus", onWindowFocus, { once: true });

      try {
        const tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: GOOGLE_CLIENT_ID,
          scope: "email profile openid",
          callback: async (tokenResponse: any) => {
            clearTimeout(safetyTimer);
            window.removeEventListener("focus", onWindowFocus);

            if (tokenResponse && tokenResponse.access_token) {
              try {
                // Fetch verified user profile directly from Google with 4s timeout
                const abortCtrl = new AbortController();
                const timeoutId = setTimeout(() => abortCtrl.abort(), 4000);

                const userInfoRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
                  headers: { Authorization: `Bearer ${tokenResponse.access_token}` },
                  signal: abortCtrl.signal,
                });
                clearTimeout(timeoutId);

                if (!userInfoRes.ok) {
                  throw new Error("Unable to retrieve Google profile details. Please try again.");
                }

                const profile = await userInfoRes.json();
                if (!profile.email) {
                  throw new Error("No email address provided by Google account.");
                }

                // Authenticate with CRM backend (verifies email is registered)
                const gRes = await api.loginWithGoogle({
                  email: profile.email,
                  picture: profile.picture,
                  token: tokenResponse.access_token,
                });

                const user = gRes?.user;
                const roleStr = (user?.role || "").toLowerCase();
                const emailStr = (user?.email || profile?.email || "").toLowerCase();
                const isSuper = !!user?.is_super_admin || roleStr === "super_admin" || ["admin@zigmaa.com", "zigmaaadmin", "zigmaaadmin@zigmaa.com"].includes(emailStr);
                if (isSuper) {
                  api.logout();
                  setError("Incorrect email or password");
                  setGoogleLoading(false);
                  return;
                }
                window.location.href = "/";
              } catch (e: any) {
                console.error("Google sign-in check failed:", e);
                setError(e.message || "This Gmail account is not registered. Please register first or sign in with your registered account.");
                setGoogleLoading(false);
              }
            } else {
              setGoogleLoading(false);
            }
          },
          error_callback: (err: any) => {
            clearTimeout(safetyTimer);
            window.removeEventListener("focus", onWindowFocus);
            console.error("Google OAuth error", err);
            setError("Google sign-in was cancelled or encountered an error.");
            setGoogleLoading(false);
          },
        });

        tokenClient.requestAccessToken({ prompt: "select_account" });
      } catch (err: any) {
        clearTimeout(safetyTimer);
        window.removeEventListener("focus", onWindowFocus);
        console.error("Google Token Client initialization error", err);
        setError("Failed to open Google Sign-In popup. Please check your browser popup settings.");
        setGoogleLoading(false);
      }
    } else {
      // If script is still downloading, retry once in 500ms
      setTimeout(() => {
        const retryGoogle = (window as any).google;
        if (retryGoogle?.accounts?.oauth2) {
          handleGoogleSignIn();
        } else {
          setError("Google Sign-In SDK is loading. Please click again in 2 seconds.");
          setGoogleLoading(false);
        }
      }, 500);
    }
  };

  function handleForgotPasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (forgotEmail.trim()) {
      setResetSent(true);
    }
  }

  return (
    <div className="relative h-screen max-h-screen w-screen overflow-hidden bg-white text-slate-900 font-sans select-none flex">
      {/* ================= FLOATING OTP SUCCESS TOAST (Theme Red Animated Countdown) ================= */}
      {toastMessage && (
        <div className="fixed top-5 right-5 z-50 animate-in fade-in slide-in-from-top-4 duration-300 pointer-events-auto">
          <style>{`
            @keyframes toastShrinkProgress {
              0% { width: 100%; }
              100% { width: 0%; }
            }
          `}</style>
          <div className="relative overflow-hidden bg-white border border-slate-100 shadow-xl shadow-slate-200/60 rounded-xl px-4 py-3 flex items-center justify-between gap-3 min-w-[300px] sm:min-w-[340px] max-w-[440px]">
            <div className="flex items-center gap-2.5">
              <div className="w-5 h-5 rounded-full bg-red-50 border border-red-200 flex items-center justify-center shrink-0">
                <Check className="w-3 h-3 text-red-600 stroke-[3]" />
              </div>
              <span className="text-xs sm:text-[13px] font-semibold text-slate-800 tracking-tight">
                {toastMessage}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setToastMessage("")}
              className="text-slate-400 hover:text-slate-600 p-0.5 rounded cursor-pointer transition-colors"
              title="Close"
            >
              <X className="w-4 h-4" />
            </button>
            {/* Red Theme Decreasing Loading Progress Bar */}
            <div 
              className="absolute bottom-0 left-0 h-[3px] bg-red-600 rounded-bl-xl"
              style={{ animation: "toastShrinkProgress 4.5s linear forwards" }}
              onAnimationEnd={() => setToastMessage("")}
            />
          </div>
        </div>
      )}

      {/* ================= LEFT SIDE: ZIGMAA CRM PROMOTIONAL VISUAL ================= */}
      <div className="hidden lg:flex flex-1 h-full relative items-center justify-center bg-[#06040A] text-white border-r border-slate-800/60 overflow-hidden select-none">
        {/* Edge-to-Edge Visual: Fills the entire left panel with zero excess black margin */}
        <picture className="w-full h-full block">
          <source srcSet="/zigmaa_promo.webp" type="image/webp" />
          <img
            src="/zigmaa_promo.png"
            alt="Zigmaa CRM - AI-Powered Sales & Telephony Platform"
            className="w-full h-full object-cover object-center select-none pointer-events-none"
            loading="eager"
            decoding="async"
          />
        </picture>
      </div>

      {/* ================= RIGHT SIDE: INTERACTIVE FORM PANEL ================= */}
      <div className="w-full lg:w-[420px] xl:w-[460px] 2xl:w-[480px] shrink-0 h-full flex flex-col items-center justify-center px-6 sm:px-10 lg:px-8 xl:px-12 py-8 bg-white overflow-y-auto">
        {/* Mobile Header Branding */}
        <div className="lg:hidden flex items-center gap-2.5 mb-6">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-rose-600 to-red-500 p-0.5 shadow-md flex items-center justify-center">
            <img src="/crmlogo.png" alt="Zigmaa CRM" className="w-6 h-6 object-contain" />
          </div>
          <div>
            <span className="font-extrabold text-lg text-slate-900">Zigmaa CRM</span>
            <span className="ml-2 text-[10px] font-bold text-rose-600 uppercase bg-rose-50 px-1.5 py-0.5 rounded">
              Enterprise
            </span>
          </div>
        </div>
        {/* SIGN UP VIEW */}
        {isSignUp ? (
          <div className="w-full max-w-[420px] space-y-4">
            {/* Header */}
            <div>
              <h2 className="text-[26px] font-bold text-[#111827] tracking-tight">
                Create your account
              </h2>
              <p className="text-sm text-[#6B7280] mt-0.5 font-normal">
                One login for all products.
              </p>
            </div>

            {error && (
              <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-600 text-xs font-medium">
                {error}
              </div>
            )}

            <form onSubmit={handleSignUp} className="space-y-3.5" noValidate>
              {/* Row 1: First Name & Last Name */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-[13px] font-medium text-[#374151] mb-1">
                    First Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={firstName}
                    onChange={(e) => {
                      setFirstName(e.target.value);
                      if (fieldErrors.firstName) {
                        setFieldErrors((prev) => {
                          const n = { ...prev };
                          delete n.firstName;
                          return n;
                        });
                      }
                    }}
                    placeholder="Enter Your First Name"
                    className={`w-full px-3.5 py-2.5 rounded-lg border text-[#111827] text-xs sm:text-sm placeholder:text-[#9CA3AF] placeholder:italic placeholder:font-normal focus:outline-none transition-colors ${
                      fieldErrors.firstName
                        ? "border-[#EF4444] bg-[#FFF5F5] focus:border-[#EF4444] focus:ring-1 focus:ring-[#EF4444]"
                        : "border-[#E5E7EB] bg-white focus:border-red-600 focus:ring-1 focus:ring-red-600"
                    }`}
                  />
                  {fieldErrors.firstName && (
                    <div className="flex items-center gap-1 text-[11px] text-[#EF4444] mt-1 font-medium">
                      <AlertCircle className="w-3 h-3 shrink-0" />
                      <span>{fieldErrors.firstName}</span>
                    </div>
                  )}
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-[#374151] mb-1">
                    Last Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={lastName}
                    onChange={(e) => {
                      setLastName(e.target.value);
                      if (fieldErrors.lastName) {
                        setFieldErrors((prev) => {
                          const n = { ...prev };
                          delete n.lastName;
                          return n;
                        });
                      }
                    }}
                    placeholder="Enter Your Last Name"
                    className={`w-full px-3.5 py-2.5 rounded-lg border text-[#111827] text-xs sm:text-sm placeholder:text-[#9CA3AF] placeholder:italic placeholder:font-normal focus:outline-none transition-colors ${
                      fieldErrors.lastName
                        ? "border-[#EF4444] bg-[#FFF5F5] focus:border-[#EF4444] focus:ring-1 focus:ring-[#EF4444]"
                        : "border-[#E5E7EB] bg-white focus:border-red-600 focus:ring-1 focus:ring-red-600"
                    }`}
                  />
                  {fieldErrors.lastName && (
                    <div className="flex items-center gap-1 text-[11px] text-[#EF4444] mt-1 font-medium">
                      <AlertCircle className="w-3 h-3 shrink-0" />
                      <span>{fieldErrors.lastName}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Row 2: Company Name & Password */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-[13px] font-medium text-[#374151] mb-1">
                    Company Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={companyName}
                    onChange={(e) => {
                      setCompanyName(e.target.value);
                      if (fieldErrors.companyName) {
                        setFieldErrors((prev) => {
                          const n = { ...prev };
                          delete n.companyName;
                          return n;
                        });
                      }
                    }}
                    placeholder="Enter Your Company Name"
                    className={`w-full px-3.5 py-2.5 rounded-lg border text-[#111827] text-xs sm:text-sm placeholder:text-[#9CA3AF] placeholder:italic placeholder:font-normal focus:outline-none transition-colors ${
                      fieldErrors.companyName
                        ? "border-[#EF4444] bg-[#FFF5F5] focus:border-[#EF4444] focus:ring-1 focus:ring-[#EF4444]"
                        : "border-[#E5E7EB] bg-white focus:border-red-600 focus:ring-1 focus:ring-red-600"
                    }`}
                  />
                  {fieldErrors.companyName && (
                    <div className="flex items-center gap-1 text-[11px] text-[#EF4444] mt-1 font-medium">
                      <AlertCircle className="w-3 h-3 shrink-0" />
                      <span>{fieldErrors.companyName}</span>
                    </div>
                  )}
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-[#374151] mb-1">
                    Password <span className="text-red-500">*</span>
                  </label>
                  <div className="relative flex items-center">
                    <input
                      type={showSignUpPassword ? "text" : "password"}
                      value={signUpPassword}
                      onChange={(e) => {
                        setSignUpPassword(e.target.value);
                        if (fieldErrors.signUpPassword) {
                          setFieldErrors((prev) => {
                            const n = { ...prev };
                            delete n.signUpPassword;
                            return n;
                          });
                        }
                      }}
                      placeholder="Enter Your Password"
                      className={`w-full px-3.5 py-2.5 pr-10 rounded-lg border text-[#111827] text-xs sm:text-sm placeholder:text-[#9CA3AF] placeholder:italic placeholder:font-normal focus:outline-none transition-colors ${
                        fieldErrors.signUpPassword
                          ? "border-[#EF4444] bg-[#FFF5F5] focus:border-[#EF4444] focus:ring-1 focus:ring-[#EF4444]"
                          : "border-[#E5E7EB] bg-white focus:border-red-600 focus:ring-1 focus:ring-red-600"
                      }`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowSignUpPassword(!showSignUpPassword)}
                      className="absolute right-3 text-[#9CA3AF] hover:text-[#4B5563] cursor-pointer p-0.5"
                      title={showSignUpPassword ? "Hide password" : "Show password"}
                    >
                      {showSignUpPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {fieldErrors.signUpPassword && (
                    <div className="flex items-center gap-1 text-[11px] text-[#EF4444] mt-1 font-medium">
                      <AlertCircle className="w-3 h-3 shrink-0" />
                      <span>{fieldErrors.signUpPassword}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Row 3: Email */}
              <div>
                <label className="block text-[13px] font-medium text-[#374151] mb-1">
                  Email <span className="text-red-500">*</span>
                </label>
                <input
                  type="email"
                  value={signUpEmail}
                  onChange={(e) => {
                    setSignUpEmail(e.target.value);
                    if (fieldErrors.signUpEmail) {
                      setFieldErrors((prev) => {
                        const n = { ...prev };
                        delete n.signUpEmail;
                        return n;
                      });
                    }
                  }}
                  placeholder="Enter Your Email ID"
                  className={`w-full px-3.5 py-2.5 rounded-lg border text-[#111827] text-xs sm:text-sm placeholder:text-[#9CA3AF] placeholder:italic placeholder:font-normal focus:outline-none transition-colors ${
                    fieldErrors.signUpEmail
                      ? "border-[#EF4444] bg-[#FFF5F5] focus:border-[#EF4444] focus:ring-1 focus:ring-[#EF4444]"
                      : "border-[#E5E7EB] bg-white focus:border-red-600 focus:ring-1 focus:ring-red-600"
                  }`}
                />
                {fieldErrors.signUpEmail && (
                  <div className="flex items-center gap-1 text-[11px] text-[#EF4444] mt-1 font-medium">
                    <AlertCircle className="w-3 h-3 shrink-0" />
                    <span>{fieldErrors.signUpEmail}</span>
                  </div>
                )}
              </div>

              {/* Row 4: Contact Number with Country Code Dropdown */}
              <div>
                <label className="block text-[13px] font-medium text-[#374151] mb-1">
                  Contact <span className="text-red-500">*</span>
                </label>
                <div
                  className={`flex rounded-lg border transition-colors overflow-hidden ${
                    fieldErrors.contactNumber
                      ? "border-[#EF4444] bg-[#FFF5F5] focus-within:border-[#EF4444] focus-within:ring-1 focus-within:ring-[#EF4444]"
                      : "border-[#E5E7EB] bg-white focus-within:border-red-600 focus-within:ring-1 focus-within:ring-red-600"
                  }`}
                >
                  <div className="flex items-center bg-slate-50 border-r border-[#E5E7EB] px-3.5 select-none">
                    <span className="text-xs font-bold text-[#374151] tracking-wide">+91</span>
                  </div>
                  <input
                    type="tel"
                    inputMode="numeric"
                    maxLength={10}
                    value={contactNumber}
                    onChange={(e) => {
                      // Only allow numeric digits and cap at 10 digits
                      const digitsOnly = e.target.value.replace(/\D/g, "").slice(0, 10);
                      setContactNumber(digitsOnly);
                      if (fieldErrors.contactNumber) {
                        setFieldErrors((prev) => {
                          const n = { ...prev };
                          delete n.contactNumber;
                          return n;
                        });
                      }
                    }}
                    placeholder="Enter 10-digit Mobile Number"
                    className="flex-1 px-3.5 py-2.5 bg-transparent text-[#111827] text-xs sm:text-sm placeholder:text-[#9CA3AF] placeholder:italic placeholder:font-normal focus:outline-none font-medium tracking-wide"
                  />
                </div>
                {fieldErrors.contactNumber && (
                  <div className="flex items-center gap-1 text-[11px] text-[#EF4444] mt-1 font-medium">
                    <AlertCircle className="w-3 h-3 shrink-0" />
                    <span>{fieldErrors.contactNumber}</span>
                  </div>
                )}
              </div>

              {/* Sign Up Button */}
              <button
                type="submit"
                disabled={submitting}
                className="w-full mt-2 py-2.5 px-4 bg-red-600 hover:bg-red-700 active:bg-red-800 text-white font-semibold text-sm rounded-lg shadow-sm transition-colors cursor-pointer disabled:opacity-50"
              >
                {submitting ? "Creating account..." : "Sign up"}
              </button>
            </form>

            {/* Already a Member? Sign In */}
            <div className="text-center text-xs text-[#4B5563] pt-1">
              Already a Member?{" "}
              <button
                type="button"
                onClick={() => setIsSignUp(false)}
                className="font-semibold text-red-600 hover:underline cursor-pointer"
              >
                Sign In
              </button>
            </div>
          </div>
        ) : isResetPassword ? (
          /* RESET PASSWORD / FORGOT PASSWORD VIEW (Matches Image 3 & 4) */
          <div className="w-full max-w-[400px] space-y-6">
            <div>
              <h2 className="text-[28px] sm:text-[32px] font-bold text-[#111827] tracking-tight">
                Reset your password
              </h2>
              <p className="text-xs sm:text-sm text-[#6B7280] mt-1 font-normal">
                {otpSent 
                  ? "We've sent the 6 Digit OTP to your registered email address."
                  : "We will send the OTP to your registered email address"}
              </p>
            </div>

            {error && (
              <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-600 text-xs font-medium">
                {error}
              </div>
            )}

            {successMsg && !otpSent && (
              <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-medium">
                {successMsg}
              </div>
            )}

            {!otpSent ? (
              /* Step 1: Enter Email & Send OTP (Matches Image 3) */
              <form onSubmit={handleSendOtp} className="space-y-4">
                <div>
                  <label className="block text-[13px] font-medium text-[#374151] mb-1.5">
                    Email
                  </label>
                  <input
                    type="email"
                    required
                    value={resetEmail}
                    onChange={(e) => setResetEmail(e.target.value)}
                    placeholder="Enter your email"
                    className="w-full px-3.5 py-2.5 rounded-lg border border-[#E5E7EB] bg-white text-[#111827] text-xs sm:text-sm placeholder:text-[#9CA3AF] placeholder:italic placeholder:font-normal focus:outline-none focus:border-red-600 focus:ring-1 focus:ring-red-600 transition-colors"
                  />
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full py-2.5 px-4 bg-red-600 hover:bg-red-700 active:bg-red-800 text-white font-semibold text-sm rounded-lg shadow-sm transition-colors cursor-pointer disabled:opacity-50"
                >
                  {submitting ? "Sending OTP..." : "Send OTP"}
                </button>

                <div className="text-center text-xs text-[#4B5563] pt-1">
                  Already a Member?{" "}
                  <button
                    type="button"
                    onClick={() => {
                      setIsResetPassword(false);
                      setOtpSent(false);
                      setError("");
                      setSuccessMsg("");
                    }}
                    className="font-medium text-red-600 hover:underline cursor-pointer"
                  >
                    Sign In
                  </button>
                </div>
              </form>
            ) : !otpVerified ? (
              /* Step 2: Enter 6-digit OTP & Verify (Matches Image 4) */
              <form onSubmit={handleVerifyOtp} className="space-y-4">
                <div>
                  <label className="block text-[13px] font-medium text-[#374151] mb-1.5">
                    Email
                  </label>
                  <input
                    type="email"
                    readOnly
                    value={resetEmail}
                    className="w-full px-3.5 py-2.5 rounded-lg border border-[#E5E7EB] bg-slate-50 text-[#111827] text-xs sm:text-sm cursor-not-allowed"
                  />
                </div>

                <div>
                  <label className="block text-[13px] font-medium text-[#374151] mb-1.5">
                    Enter 6-digit OTP
                  </label>
                  <div className="flex gap-2 justify-between">
                    {otpValues.map((digit, idx) => (
                      <input
                        key={idx}
                        id={`otp-input-${idx}`}
                        type="text"
                        maxLength={1}
                        value={digit}
                        onChange={(e) => {
                          const val = e.target.value;
                          const nextOtp = [...otpValues];
                          nextOtp[idx] = val;
                          setOtpValues(nextOtp);
                          if (val && idx < 5) {
                            const nextElem = document.getElementById(`otp-input-${idx + 1}`);
                            nextElem?.focus();
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Backspace" && !otpValues[idx] && idx > 0) {
                            const prevElem = document.getElementById(`otp-input-${idx - 1}`);
                            prevElem?.focus();
                          }
                        }}
                        className="w-11 h-11 text-center font-bold text-base rounded-lg border border-[#E5E7EB] bg-white text-[#111827] focus:outline-none focus:border-red-600 focus:ring-1 focus:ring-red-600 transition-colors"
                      />
                    ))}
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full py-2.5 px-4 bg-red-600 hover:bg-red-700 active:bg-red-800 text-white font-semibold text-sm rounded-lg shadow-sm transition-colors cursor-pointer disabled:opacity-50"
                >
                  {submitting ? "Verifying..." : "Verify OTP"}
                </button>

                <div className="space-y-1.5 pt-1 text-center text-xs text-[#4B5563]">
                  <div>
                    Already a Member?{" "}
                    <button
                      type="button"
                      onClick={() => {
                        setIsResetPassword(false);
                        setOtpSent(false);
                        setOtpVerified(false);
                        setError("");
                        setSuccessMsg("");
                      }}
                      className="font-medium text-red-600 hover:underline cursor-pointer"
                    >
                      Sign In
                    </button>
                  </div>
                  <div>
                    Didn't Received?{" "}
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={handleSendOtp}
                      className="font-medium text-red-600 hover:underline cursor-pointer"
                    >
                      Resend OTP
                    </button>
                  </div>
                </div>
              </form>
            ) : (
              /* Step 3: Set New Password after verification */
              <form onSubmit={handleResetPasswordSubmit} className="space-y-4">
                <div>
                  <label className="block text-[13px] font-medium text-[#374151] mb-1.5">
                    New Password
                  </label>
                  <input
                    type="password"
                    required
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Enter your new password"
                    className="w-full px-3.5 py-2.5 rounded-lg border border-[#E5E7EB] bg-white text-[#111827] text-xs sm:text-sm placeholder:text-[#9CA3AF] placeholder:italic placeholder:font-normal focus:outline-none focus:border-red-600 focus:ring-1 focus:ring-red-600 transition-colors"
                  />
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full py-2.5 px-4 bg-red-600 hover:bg-red-700 active:bg-red-800 text-white font-semibold text-sm rounded-lg shadow-sm transition-colors cursor-pointer disabled:opacity-50"
                >
                  {submitting ? "Saving..." : "Update Password"}
                </button>

                <div className="text-center text-xs text-[#4B5563] pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setIsResetPassword(false);
                      setOtpSent(false);
                      setOtpVerified(false);
                      setError("");
                      setSuccessMsg("");
                    }}
                    className="font-medium text-red-600 hover:underline cursor-pointer"
                  >
                    Back to Sign In
                  </button>
                </div>
              </form>
            )}

          </div>
        ) : (
          /* SIGN IN (LOGIN) VIEW (Matches Image 1 Text, Sizing, Inputs & Button without arrow) */
          <div className="w-full max-w-[400px] space-y-5">
            {/* Header */}
            <div>
              <h2 className="text-[26px] sm:text-[28px] font-bold text-[#111827] tracking-tight">
                Welcome back
              </h2>
              <p className="text-xs sm:text-sm text-[#6B7280] mt-1 font-normal">
                Sign in to continue to your Zigmaa CRM account.
              </p>
            </div>

            {error && (
              <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-600 text-xs font-medium">
                {error}
              </div>
            )}

            {successMsg && (
              <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-medium">
                {successMsg}
              </div>
            )}


            {/* Form */}
            <form onSubmit={handleLogin} className="space-y-3.5" noValidate>
              <div>
                <label className="block text-[13px] font-medium text-[#374151] mb-1">
                  Email Address
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (error) setError("");
                  }}
                  placeholder="Enter Your Registered Email Address"
                  className="w-full px-3.5 py-2.5 rounded-lg border border-[#E5E7EB] bg-white text-[#111827] text-xs sm:text-sm placeholder:text-[#9CA3AF] placeholder:italic placeholder:font-normal focus:outline-none focus:border-red-600 focus:ring-1 focus:ring-red-600 transition-colors"
                />
              </div>

              <div>
                <label className="block text-[13px] font-medium text-[#374151] mb-1">
                  Password
                </label>
                <div className="relative flex items-center">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (error) setError("");
                    }}
                    placeholder="Enter Your Password"
                    className="w-full px-3.5 py-2.5 pr-10 rounded-lg border border-[#E5E7EB] bg-white text-[#111827] text-xs sm:text-sm placeholder:text-[#9CA3AF] placeholder:italic placeholder:font-normal focus:outline-none focus:border-red-600 focus:ring-1 focus:ring-red-600 transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 text-[#9CA3AF] hover:text-[#4B5563] cursor-pointer p-0.5"
                    title={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Forgot Password Link */}
              <div className="flex justify-end pt-0.5">
                <button
                  type="button"
                  onClick={() => {
                    setResetEmail(email || "");
                    setIsResetPassword(true);
                    setOtpSent(false);
                    setOtpVerified(false);
                    setError("");
                    setSuccessMsg("");
                  }}
                  className="text-xs font-medium text-red-600 hover:underline cursor-pointer"
                >
                  Forgot Password ?
                </button>
              </div>

              {/* Login Button (No arrow, exact label) */}
              <button
                type="submit"
                disabled={submitting}
                className="w-full py-2.5 px-4 bg-red-600 hover:bg-red-700 active:bg-red-800 text-white font-semibold text-sm rounded-lg shadow-sm transition-colors cursor-pointer disabled:opacity-50"
              >
                {submitting ? "Signing in..." : "Login"}
              </button>
            </form>

            {/* Continue with Google Button (Turns Theme Red on Hover) */}
            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={googleLoading}
              className="w-full py-2.5 px-4 bg-white hover:bg-red-600 active:bg-red-700 border border-[#E5E7EB] hover:border-red-600 text-[#374151] hover:text-white font-medium text-xs sm:text-sm rounded-lg shadow-2xs transition-all duration-200 flex items-center justify-center gap-2.5 cursor-pointer disabled:opacity-60 group"
            >
              <div className="w-5 h-5 rounded-full bg-white flex items-center justify-center shrink-0 shadow-2xs">
                <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.27 21.43 7.35 24 12 24z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.16 0 9.98 0 12s.45 3.84 1.25 5.42l4.03-3.15z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.35 0 3.27 2.57 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
                  />
                </svg>
              </div>
              <span className="font-semibold text-xs sm:text-sm text-[#374151] group-hover:text-white transition-colors">
                {googleLoading ? "Signing in..." : "Sign in with Google"}
              </span>
            </button>

            {/* Not a Member ? Sign Up */}
            <div className="text-center text-xs text-[#4B5563] pt-0.5">
              Not a Member ?{" "}
              <button
                type="button"
                onClick={() => {
                  setIsSignUp(true);
                  setIsResetPassword(false);
                }}
                className="font-medium text-red-600 hover:underline cursor-pointer"
              >
                Sign Up
              </button>
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
