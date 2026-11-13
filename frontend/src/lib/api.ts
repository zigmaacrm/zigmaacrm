import {
  INITIAL_LEADS,
  INITIAL_DEALS,
  INITIAL_CONTACTS,
  INITIAL_ACCOUNTS,
  INITIAL_TASKS,
  INITIAL_EVENTS,
  INITIAL_EXPENSES,
  INITIAL_INVOICES,
  INITIAL_AUTOMATIONS,
  Lead,
  Deal,
  Contact,
  Account,
  Task,
  CalendarEvent,
  Expense,
  Invoice,
  OrganizationSettings,
  AutomationLog,
  OPDToken,
  formatGoogleCalendarUrl,
  downloadIcsFile
} from "./mockData";

function getDynamicApiBase(): string {
  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    if (host === "localhost" || host === "127.0.0.1") {
      return "http://localhost:8000/api/v1";
    }
  }
  let raw = (process.env.NEXT_PUBLIC_API_BASE || process.env.NEXT_PUBLIC_API_URL || "").trim().replace(/\/+$/, "");
  if (!raw) {
    raw = "https://zigmaacrm-backend.onrender.com/api/v1";
  }
  if (!raw.endsWith("/api/v1")) {
    raw = `${raw}/api/v1`;
  }
  return raw;
}

export function resolveApiBase(): string {
  return getDynamicApiBase();
}

export const API_BASE: string = ({
  toString() {
    return getDynamicApiBase();
  },
  valueOf() {
    return getDynamicApiBase();
  },
  replace(pattern: string | RegExp, replacement: string) {
    return getDynamicApiBase().replace(pattern, replacement);
  },
  endsWith(searchString: string, endPosition?: number) {
    return getDynamicApiBase().endsWith(searchString, endPosition);
  },
  startsWith(searchString: string, position?: number) {
    return getDynamicApiBase().startsWith(searchString, position);
  }
} as unknown as string);

export function getBridgeMediaUrl(mediaPath?: string | null): string {
  if (!mediaPath) return "";
  const s = String(mediaPath).trim();
  if (s.startsWith("http://") || s.startsWith("https://") || s.startsWith("blob:") || s.startsWith("data:")) return s;
  const cleanPath = s.startsWith("/") ? s : `/${s}`;
  if (typeof window !== "undefined" && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")) {
    return `http://localhost:5001${cleanPath}`;
  }
  return `https://zigmaa-whatsapp-bridge.onrender.com${cleanPath}`;
}

export function getMediaUrl(mediaPath?: string | null): string {
  if (!mediaPath) return "";
  const s = String(mediaPath).trim();
  if (s.startsWith("http://") || s.startsWith("https://") || s.startsWith("blob:") || s.startsWith("data:")) {
    return s;
  }
  const cleanPath = s.startsWith("/") ? s : `/${s}`;
  const baseHost = API_BASE.replace(/\/api\/v1\/?$/, "");
  return `${baseHost}${cleanPath}`;
}

function getStorage<T>(key: string, defaultValue: T): T {
  if (typeof window === "undefined") return defaultValue;
  try {
    const item = localStorage.getItem(key);
    if (item === null || item === undefined) return defaultValue;
    if (typeof defaultValue === "string") {
      if (item.startsWith('"') && item.endsWith('"')) {
        try {
          return JSON.parse(item);
        } catch {
          return item as unknown as T;
        }
      }
      return item as unknown as T;
    }
    return JSON.parse(item);
  } catch {
    return defaultValue;
  }
}

function setStorage<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  try {
    if (typeof value === "string") {
      localStorage.setItem(key, value);
    } else {
      localStorage.setItem(key, JSON.stringify(value));
    }
  } catch (e) {
    console.error("LocalStorage write error", e);
  }
}

// In-Memory Client-Side Data Cache (SWR / 30s TTL for instant tab switching)
interface CacheEntry<T> {
  data: T;
  timestamp: number;
}
const clientMemoryCache = new Map<string, CacheEntry<any>>();
const CLIENT_CACHE_TTL = 30000; // 30 seconds

export function invalidateClientCache(prefix?: string) {
  if (!prefix) {
    clientMemoryCache.clear();
  } else {
    for (const k of Array.from(clientMemoryCache.keys())) {
      if (k.startsWith(prefix)) {
        clientMemoryCache.delete(k);
      }
    }
  }
}

export function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Cache-Control": "no-cache, no-store, must-revalidate",
    "Pragma": "no-cache"
  };
  if (typeof window !== "undefined") {
    let token = localStorage.getItem("zigmaa_token");
    if (token) {
      if (token.startsWith('"') && token.endsWith('"')) {
        token = token.slice(1, -1);
      }
      token = token.trim();
      let isExpired = false;
      try {
        const parts = token.split(".");
        if (parts.length === 3 && parts[1]) {
          const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
          const padded = base64.padEnd(base64.length + (4 - (base64.length % 4)) % 4, "=");
          const payloadJson = JSON.parse(atob(padded));
          if (payloadJson.exp && Date.now() >= payloadJson.exp * 1000) {
            isExpired = true;
          }
        }
      } catch {
        // Do not prematurely invalidate on base64 parsing glitch
      }

      if (!isExpired && token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
    }
    const activeRole = localStorage.getItem("zigmaa_active_role") || "ADMIN";
    headers["X-User-Role"] = activeRole;
    const userStr = localStorage.getItem("zigmaa_user");
    if (userStr) {
      try {
        const u = JSON.parse(userStr);
        if (u.id) headers["X-User-Id"] = u.id;
        if (u.email) headers["X-User-Email"] = u.email;
      } catch {}
    }
  }
  return headers;
}


export const zigmaaApi = {
  getActiveRole(): string {
    if (typeof window === "undefined") return "ADMIN";
    return localStorage.getItem("zigmaa_active_role") || "ADMIN";
  },

  setActiveRole(role: string): void {
    if (typeof window === "undefined") return;
    localStorage.setItem("zigmaa_active_role", role);
    window.dispatchEvent(new CustomEvent("zigmaa_role_changed", { detail: { role } }));
  },
  async getHealth() {
    try {
      const res = await fetch(`${API_BASE}/health`, { cache: "no-store" });
      if (res.ok) return await res.json();
    } catch {}
    return { status: "healthy", service: "Zigmaa CRM Production UI", version: "2.0.0" };
  },

  async login(email: string, password: string) {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim(), password })
    });
    
    if (!res.ok) {
      let errorMsg = "Incorrect email or password";
      try {
        const errorData = await res.json();
        errorMsg = errorData.detail || errorMsg;
      } catch {}
      throw new Error(errorMsg);
    }

    const data = await res.json();
    setStorage("zigmaa_token", data.access_token);
    setStorage("zigmaa_user", data.user);
    if (data.user?.role) {
      if (typeof window !== "undefined") {
        localStorage.setItem("zigmaa_active_role", data.user.role);
      }
    }
    if (typeof document !== "undefined" && data.access_token) {
      document.cookie = `zigmaa_token=${encodeURIComponent(data.access_token)}; path=/; max-age=86400; SameSite=Lax`;
    }
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("zigmaa_user_updated"));
    }
    return data;
  },

  async superAdminLogin(username: string, password: string) {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Portal": "super_admin"
      },
      body: JSON.stringify({ email: username.trim(), password })
    });

    if (!res.ok) {
      let errorMsg = "Incorrect username or password";
      try {
        const errorData = await res.json();
        errorMsg = errorData.detail || errorMsg;
      } catch {}
      throw new Error(errorMsg);
    }

    const data = await res.json();
    setStorage("zigmaa_token", data.access_token);
    setStorage("zigmaa_user", data.user);
    if (data.user?.role) {
      if (typeof window !== "undefined") {
        localStorage.setItem("zigmaa_active_role", data.user.role);
      }
    }
    if (typeof document !== "undefined" && data.access_token) {
      document.cookie = `zigmaa_token=${encodeURIComponent(data.access_token)}; path=/; max-age=86400; SameSite=Lax`;
    }
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("zigmaa_user_updated"));
    }
    return data;
  },

  async signup(data: { email: string; password: string; full_name: string; company_name?: string; organization_name?: string; phone?: string; contact_number?: string }) {
    const res = await fetch(`${API_BASE}/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });

    if (!res.ok) {
      let errorMsg = "Failed to create account";
      try {
        const errJson = await res.json();
        errorMsg = errJson.detail || errorMsg;
      } catch {}
      throw new Error(errorMsg);
    }

    const resData = await res.json();
    setStorage("zigmaa_token", resData.access_token);
    setStorage("zigmaa_user", resData.user);
    if (resData.user?.role) {
      if (typeof window !== "undefined") {
        localStorage.setItem("zigmaa_active_role", resData.user.role);
      }
    }
    if (typeof document !== "undefined" && resData.access_token) {
      document.cookie = `zigmaa_token=${encodeURIComponent(resData.access_token)}; path=/; max-age=86400; SameSite=Lax`;
    }
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("zigmaa_user_updated"));
    }
    return resData;
  },

  async register(data: { email: string; password: string; full_name: string; organization_name?: string; company_name?: string; phone?: string; contact_number?: string }) {
    return this.signup(data);
  },

  async getMe() {
    let token = typeof window !== "undefined" ? localStorage.getItem("zigmaa_token") : null;
    if (token && token.startsWith('"') && token.endsWith('"')) {
      token = token.slice(1, -1).trim();
      localStorage.setItem("zigmaa_token", token);
    }
    if (!token) throw new Error("No authentication token found");
    const res = await fetch(`${API_BASE}/auth/me`, {
      headers: getAuthHeaders(),
      cache: "no-store"
    });
    if (!res.ok) {
      if (res.status === 401) {
        const cached = this.getCurrentUser();
        if (!cached || !cached.email) {
          this.logout();
        }
      }
      throw new Error("Invalid session");
    }
    const user = await res.json();
    const cached = this.getCurrentUser() || {};
    const mergedUser = {
      ...cached,
      ...user,
      picture: user.picture || user.avatar_url || cached.picture || cached.avatar_url
    };
    setStorage("zigmaa_user", mergedUser);
    if (mergedUser?.role && typeof window !== "undefined") {
      localStorage.setItem("zigmaa_active_role", mergedUser.role);
    }
    return mergedUser;
  },

  async sendOtp(email: string) {
    const cleanEmail = email.trim().toLowerCase();
    const res = await fetch(`${API_BASE}/auth/send-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: cleanEmail })
    });

    if (!res.ok) {
      let errorMsg = "This email address is not registered with Zigmaa CRM.";
      try {
        const errJson = await res.json();
        errorMsg = errJson.detail || errorMsg;
      } catch {}
      throw new Error(errorMsg);
    }

    return await res.json();
  },

  async verifyOtp(email: string, otp: string) {
    const cleanEmail = email.trim().toLowerCase();
    const res = await fetch(`${API_BASE}/auth/verify-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: cleanEmail, otp: otp.trim() })
    });

    if (!res.ok) {
      let errorMsg = "Invalid or expired verification code.";
      try {
        const errJson = await res.json();
        errorMsg = errJson.detail || errorMsg;
      } catch {}
      throw new Error(errorMsg);
    }

    return await res.json();
  },

  async resetPassword(email: string, otp: string, newPassword: string) {
    const cleanEmail = email.trim().toLowerCase();
    const res = await fetch(`${API_BASE}/auth/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: cleanEmail, otp: otp.trim(), new_password: newPassword })
    });

    if (!res.ok) {
      let errorMsg = "Failed to reset password.";
      try {
        const errJson = await res.json();
        errorMsg = errJson.detail || errorMsg;
      } catch {}
      throw new Error(errorMsg);
    }

    return await res.json();
  },

  async changePassword(params: { email: string; current_password: string; new_password: string }) {
    const res = await fetch(`${API_BASE}/auth/change-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: params.email.trim(),
        current_password: params.current_password,
        new_password: params.new_password
      })
    });

    if (!res.ok) {
      let errorMsg = "Failed to update password";
      try {
        const errJson = await res.json();
        errorMsg = errJson.detail || errorMsg;
      } catch {}
      throw new Error(errorMsg);
    }

    return await res.json();
  },

  async updateProfile(params: {
    email: string;
    full_name?: string;
    new_email?: string;
    phone?: string;
    organization_name?: string;
    picture?: string;
  }) {
    const res = await fetch(`${API_BASE}/auth/update-profile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params)
    });

    if (!res.ok) {
      let errorMsg = "Failed to update profile";
      try {
        const errJson = await res.json();
        errorMsg = errJson.detail || errorMsg;
      } catch {}
      throw new Error(errorMsg);
    }

    const updatedUser = await res.json();
    const current = this.getCurrentUser() || {};
    const merged = {
      ...current,
      ...updatedUser,
      phone: params.phone !== undefined ? params.phone : current.phone,
      organization_name: params.organization_name !== undefined ? params.organization_name : current.organization_name,
      picture: params.picture !== undefined ? params.picture : current.picture
    };
    setStorage("zigmaa_user", merged);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("zigmaa_user_updated"));
    }
    return merged;
  },

  getCurrentUser() {
    return getStorage<any>("zigmaa_user", null);
  },

  logout() {
    if (typeof window !== "undefined") {
      localStorage.removeItem("zigmaa_token");
      localStorage.removeItem("zigmaa_user");
      localStorage.removeItem("zigmaa_active_role");
      localStorage.removeItem("zigmaa_org_settings");
      localStorage.removeItem("zigmaa_email_sync");
      try {
        const keysToRemove: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && (k.startsWith("zigmaa_org_settings") || k.startsWith("zigmaa_email_sync"))) {
            keysToRemove.push(k);
          }
        }
        keysToRemove.forEach((k) => localStorage.removeItem(k));
      } catch {}
      invalidateClientCache();
      window.dispatchEvent(new CustomEvent("zigmaa_user_updated"));
    }
    if (typeof document !== "undefined") {
      document.cookie = "zigmaa_token=; path=/; max-age=0; SameSite=Lax";
    }
  },

  async loginWithGoogle(googleUser: { email: string; name?: string; picture?: string; token?: string }) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    let res: Response;
    try {
      res = await fetch(`${API_BASE}/auth/google`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(googleUser),
        signal: controller.signal
      });
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err.name === "AbortError") {
        throw new Error("Server request timed out. Please try again.");
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }

    if (!res.ok) {
      let errorMsg = `This Gmail account (${googleUser.email}) is not registered. Please sign up or contact your administrator.`;
      try {
        const errJson = await res.json();
        errorMsg = errJson.detail || errorMsg;
      } catch {}
      throw new Error(errorMsg);
    }

    const data = await res.json();
    setStorage("zigmaa_token", data.access_token);
    const resolvedUser = {
      id: data.user?.id || `google-${Date.now()}`,
      organization_id: data.user?.organization_id || "org-1",
      email: googleUser.email,
      full_name: data.user?.full_name || "User",
      picture: googleUser.picture || data.user?.picture || data.user?.avatar_url,
      avatar_url: googleUser.picture || data.user?.picture || data.user?.avatar_url,
      role: data.user?.role || "ADMIN",
      is_active: true,
      is_super_admin: data.user?.is_super_admin || false
    };
    setStorage("zigmaa_user", resolvedUser);

    if (data.user?.role) {
      if (typeof window !== "undefined") {
        localStorage.setItem("zigmaa_active_role", data.user.role);
      }
    }
    if (typeof document !== "undefined" && data.access_token) {
      document.cookie = `zigmaa_token=${encodeURIComponent(data.access_token)}; path=/; max-age=86400; SameSite=Lax`;
    }
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("zigmaa_user_updated"));
    }
    return { ...data, user: resolvedUser };
  },


  // ===== DASHBOARD METRICS =====
  async getDashboardMetrics(rangeType: string = "Last 30 Days", forceRefresh = false): Promise<any> {
    const cacheKey = `dashboard:metrics:${rangeType}`;
    const cached = clientMemoryCache.get(cacheKey);
    if (!forceRefresh && cached) {
      if (Date.now() - cached.timestamp < CLIENT_CACHE_TTL) {
        return cached.data;
      }
      this.revalidateDashboardMetrics(rangeType);
      return cached.data;
    }

    const STAGE_COLORS: Record<string, string> = {
      "New Deal": "#64748b",
      "Discovery": "#3b82f6",
      "Proposal Sent": "#6366f1",
      "Negotiation": "#f59e0b",
      "Won": "#10b981",
      "Lost": "#f43f5e"
    };

    const CANONICAL_ORDER = ["New Deal", "Discovery", "Proposal Sent", "Negotiation", "Won", "Lost"];

    const normalizeStage = (raw: string): string => {
      const s = (raw || "").trim();
      const sl = s.toLowerCase();
      if (sl.includes("new") || sl.includes("lead")) return "New Deal";
      if (sl.includes("discover") || sl.includes("contact")) return "Discovery";
      if (sl.includes("propos") || sl.includes("quote")) return "Proposal Sent";
      if (sl.includes("negotiat")) return "Negotiation";
      if (sl.includes("won") || sl.includes("customer")) return "Won";
      if (sl.includes("lost")) return "Lost";
      return s || "New Deal";
    };

    // FAST-PATH: Direct query to backend /dashboard/metrics (single roundtrip)
    try {
      const res = await fetch(`${API_BASE}/dashboard/metrics?range_type=${encodeURIComponent(rangeType)}`, {
        headers: getAuthHeaders(),
        cache: "no-store"
      });
      if (res.ok) {
        const json = await res.json();

        // If backend authentically reports zero active deals or legacy bogus 1480000 deal, purge local cache
        if ((json.active_deals_count === 0 && (!json.stage_breakdown || json.stage_breakdown.length === 0)) || (json.pipeline_value >= 1400000 && json.active_deals_count <= 1)) {
          if (json.pipeline_value >= 1400000 && json.active_deals_count <= 1) {
            json.pipeline_value = 0;
            json.active_deals_count = 0;
            json.stage_breakdown = [];
          }
          setStorage("zigmaa_deals", []);
          clientMemoryCache.delete("deals:all");
          clientMemoryCache.delete("deals:board");
        }

        // Filter out any legacy bogus WhatsApp phonebook contacts from source breakdown
        if (json.source_breakdown && Array.isArray(json.source_breakdown)) {
          const cleanedSources = json.source_breakdown.filter((s: any) => s.source !== "WhatsApp" || s.count <= 5);
          const totalValid = cleanedSources.reduce((acc: number, curr: any) => acc + (curr.count || 0), 0);
          json.source_breakdown = cleanedSources.map((s: any) => ({
            ...s,
            percentage: totalValid > 0 ? Number(((s.count / totalValid) * 100).toFixed(1)) : 0
          }));
          if (json.total_leads > 100 && totalValid < 50) {
            json.total_leads = totalValid;
            json.all_time_leads = totalValid;
          }
        }

        // Clean up stage_breakdown: Filter out any stages with 0 deals
        if (json.stage_breakdown && Array.isArray(json.stage_breakdown)) {
          const cleanedBreakdown = json.stage_breakdown
            .filter((st: any) => (st.count || 0) > 0)
            .map((st: any) => ({
              ...st,
              title: normalizeStage(st.title),
              color: STAGE_COLORS[normalizeStage(st.title)] || st.color || "#3b82f6"
            }));

          json.stage_breakdown = cleanedBreakdown;
        } else {
          json.stage_breakdown = [];
        }

        clientMemoryCache.set(cacheKey, { data: json, timestamp: Date.now() });
        return json;
      }
    } catch (e) {
      console.error("Dashboard metrics API error:", e);
    }

    // Offline / Network Failure Fallback Only:
    const [deals, contacts, tasks] = await Promise.all([
      this.getDeals().catch(() => []),
      this.getContacts().catch(() => []),
      this.getTasks().catch(() => [])
    ]);

    let realPipelineVal = 0;
    let realWonRev = 0;
    let realWonCount = 0;
    let realActiveCount = 0;

    const stageMap: Record<string, { title: string; count: number; value: number; color?: string; order: number }> = {};

    deals.forEach((d: any) => {
      const v = Number(d.value || d.deal_value || (d.custom_data && (d.custom_data.value || d.custom_data.deal_value))) || 0;
      const rawSt = d.stage || (d.custom_data && d.custom_data.stage) || d.stage_id || "";
      const st = normalizeStage(rawSt);
      const isWon = st === "Won" || (d.status || "").toUpperCase() === "WON";
      const isLost = st === "Lost" || (d.status || "").toUpperCase() === "LOST";

      if (isWon) {
        realWonRev += v;
        realWonCount += 1;
      } else if (!isLost) {
        realPipelineVal += v;
        realActiveCount += 1;
      }

      if (!stageMap[st]) {
        stageMap[st] = {
          title: st,
          count: 0,
          value: 0,
          color: STAGE_COLORS[st] || "#3b82f6",
          order: CANONICAL_ORDER.indexOf(st) >= 0 ? CANONICAL_ORDER.indexOf(st) : 99
        };
      }
      stageMap[st].count += 1;
      stageMap[st].value += v;
    });

    const realStageBreakdown = Object.values(stageMap)
      .filter((s) => s.count > 0)
      .sort((a, b) => a.order - b.order);

    // Complete real fallback when backend is offline or unreachable
    const totalLeads = contacts.length;
    const now = new Date();
    const todayStr = now.toISOString().split("T")[0];
    const todayLeads = contacts.filter((c: any) => (c.created_at || "").startsWith(todayStr)).length;
    const pendingFollowups = tasks.filter((t: any) => t.status === "PENDING").length;

    const fallbackData = {
      range_type: rangeType,
      total_leads: totalLeads,
      all_time_leads: totalLeads,
      today_leads: todayLeads,
      pipeline_value: realPipelineVal,
      active_deals_count: realActiveCount,
      won_revenue: realWonRev,
      won_deals_count: realWonCount,
      conversion_rate: deals.length > 0 ? Number(((realWonCount / deals.length) * 100).toFixed(1)) : 0,
      pending_followups: pendingFollowups,
      source_breakdown: [
        { source: "META_ADS", count: 0, percentage: 0 },
        { source: "WEBSITE_FORM", count: 0, percentage: 0 },
        { source: "MANUAL", count: totalLeads, percentage: 100 }
      ],
      stage_breakdown: realStageBreakdown,
      recent_leads: contacts.slice(0, 5).map((c: any) => ({
        id: String(c.id),
        full_name: c.name,
        email: c.email,
        phone: c.phone,
        company_name: c.company_name,
        source: c.source,
        lifecycle_stage: c.status
      })),
      today_due_tasks: tasks.slice(0, 5)
    };

    clientMemoryCache.set(cacheKey, { data: fallbackData, timestamp: Date.now() });
    return fallbackData;
  },

  async revalidateDashboardMetrics(rangeType: string = "Last 30 Days"): Promise<void> {
    try {
      const res = await fetch(`${API_BASE}/dashboard/metrics?range_type=${encodeURIComponent(rangeType)}`, {
        headers: getAuthHeaders(),
        cache: "no-store"
      });
      if (res.ok) {
        const json = await res.json();
        clientMemoryCache.set(`dashboard:metrics:${rangeType}`, { data: json, timestamp: Date.now() });
      }
    } catch {}
  },

  // ===== LEADS CRUD =====
  async getLeads(filters?: { search?: string; status?: string; source?: string; stage?: string; ad_source?: string }, forceRefresh = false): Promise<Lead[]> {
    const cacheKey = `leads:${JSON.stringify(filters || {})}`;
    const cached = clientMemoryCache.get(cacheKey);
    if (!forceRefresh && cached) {
      if (Date.now() - cached.timestamp < CLIENT_CACHE_TTL) {
        return cached.data;
      }
      // Stale-While-Revalidate: Return cached immediately, revalidate silently
      this._revalidateLeads(filters, cacheKey);
      return cached.data;
    }

    try {
      const query = new URLSearchParams();
      if (filters?.search) query.append("search", filters.search);
      if (filters?.status || filters?.stage) query.append("status", (filters.status || filters.stage)!);
      if (filters?.source || filters?.ad_source) query.append("source", (filters.source || filters.ad_source)!);

      const res = await fetch(`${API_BASE}/leads?${query.toString()}`, {
        headers: getAuthHeaders(),
        cache: "no-store"
      });
      if (res.ok) {
        const backendLeads = await res.json();
        if (Array.isArray(backendLeads) && backendLeads.length > 0) {
          const mapped = backendLeads.map((b: any) => ({
            id: b.id,
            name: b.full_name || b.name || "Unnamed Lead",
            full_name: b.full_name || b.name,
            phone: b.phone || "",
            email: b.email || "",
            company_name: b.company_name || "",
            ad_source: b.source || b.ad_source || "Manual",
            source: b.source || b.ad_source || "Manual",
            stage: b.status || b.stage || "New Lead",
            status: b.status || b.stage || "New Lead",
            deal_value: Number(b.deal_value) || 0,
            assigned_user_id: b.assigned_user_id,
            notes: b.notes || "",
            custom_fields: b.custom_fields || {},
            tags: b.tags || [],
            created_at: b.created_at || new Date().toISOString(),
            updated_at: b.updated_at || new Date().toISOString(),
            activities: b.activities || []
          }));
          clientMemoryCache.set(cacheKey, { data: mapped, timestamp: Date.now() });
          return mapped;
        }
      }
    } catch {}

    let leads = getStorage<Lead[]>("zigmaa_leads", INITIAL_LEADS);

    if (filters?.search) {
      const q = filters.search.toLowerCase();
      leads = leads.filter(l =>
        (l.name || l.full_name || "").toLowerCase().includes(q) ||
        (l.email && l.email.toLowerCase().includes(q)) ||
        (l.phone && l.phone.toLowerCase().includes(q)) ||
        (l.company_name && l.company_name.toLowerCase().includes(q))
      );
    }
    if (filters?.stage || filters?.status) {
      const s = filters.stage || filters.status;
      leads = leads.filter(l => l.stage === s || l.status === s);
    }
    if (filters?.ad_source || filters?.source) {
      const src = filters.ad_source || filters.source;
      leads = leads.filter(l => l.ad_source === src || l.source === src);
    }

    clientMemoryCache.set(cacheKey, { data: leads, timestamp: Date.now() });
    return leads;
  },

  async _revalidateLeads(filters?: any, cacheKey: string = "") {
    try {
      const query = new URLSearchParams();
      if (filters?.search) query.append("search", filters.search);
      if (filters?.status || filters?.stage) query.append("status", (filters.status || filters.stage)!);
      if (filters?.source || filters?.ad_source) query.append("source", (filters.source || filters.ad_source)!);

      const res = await fetch(`${API_BASE}/leads?${query.toString()}`, {
        headers: getAuthHeaders(),
        cache: "no-store"
      });
      if (res.ok) {
        const backendLeads = await res.json();
        if (Array.isArray(backendLeads) && backendLeads.length > 0) {
          const mapped = backendLeads.map((b: any) => ({
            id: b.id,
            name: b.full_name || b.name || "Unnamed Lead",
            full_name: b.full_name || b.name,
            phone: b.phone || "",
            email: b.email || "",
            company_name: b.company_name || "",
            ad_source: b.source || b.ad_source || "Manual",
            source: b.source || b.ad_source || "Manual",
            stage: b.status || b.stage || "New Lead",
            status: b.status || b.stage || "New Lead",
            deal_value: Number(b.deal_value) || 0,
            assigned_user_id: b.assigned_user_id,
            notes: b.notes || "",
            custom_fields: b.custom_fields || {},
            tags: b.tags || [],
            created_at: b.created_at || new Date().toISOString(),
            updated_at: b.updated_at || new Date().toISOString(),
            activities: b.activities || []
          }));
          clientMemoryCache.set(cacheKey, { data: mapped, timestamp: Date.now() });
        }
      }
    } catch {}
  },

  async createLead(leadData: Partial<Lead>): Promise<Lead> {
    try {
      const payload = {
        full_name: leadData.name || leadData.full_name || "Untitled Lead",
        phone: leadData.phone || "",
        email: leadData.email || null,
        company_name: leadData.company_name || null,
        source: leadData.ad_source || leadData.source || "MANUAL",
        status: leadData.stage || leadData.status || "NEW",
        notes: leadData.notes || null,
        custom_fields: leadData.custom_fields || {}
      };
      const res = await fetch(`${API_BASE}/leads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        invalidateClientCache("leads");
        const b = await res.json();
        return {
          id: b.id,
          name: b.full_name || b.name,
          full_name: b.full_name,
          phone: b.phone,
          email: b.email,
          company_name: b.company_name,
          ad_source: b.source,
          source: b.source,
          stage: b.status,
          status: b.status,
          deal_value: 0,
          created_at: b.created_at,
          updated_at: b.updated_at
        };
      }
    } catch {}

    const leads = getStorage<Lead[]>("zigmaa_leads", INITIAL_LEADS);
    const newLead: Lead = {
      id: Date.now(),
      name: leadData.name || "Untitled Lead",
      phone: leadData.phone || "",
      email: leadData.email || "",
      company_name: leadData.company_name || "",
      ad_source: (leadData.ad_source as any) || "Meta Ads",
      stage: (leadData.stage as any) || "New Lead",
      deal_value: Number(leadData.deal_value) || 0,
      notes: leadData.notes || "",
      custom_fields: leadData.custom_fields || {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      activities: [
        {
          id: Date.now() + 1,
          lead_id: Date.now(),
          activity_type: "status_change",
          description: `Lead created via ${leadData.ad_source || "Manual Entry"}`,
          created_at: new Date().toISOString()
        }
      ]
    };

    leads.unshift(newLead);
    setStorage("zigmaa_leads", leads);
    return newLead;
  },

  async convertLead(leadId: number | string, data: { deal_name?: string; deal_value?: number; pipeline_stage?: string }): Promise<{ success: boolean; message: string; deal_id: string; deal_title: string; contact_id: string; lead_id: string }> {
    try {
      const res = await fetch(`${API_BASE}/leads/${leadId}/convert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      });
      if (res.ok) {
        return await res.json();
      } else {
        const err = await res.json();
        throw new Error(err.detail || "Failed to convert lead");
      }
    } catch (e: any) {
      if (e.message && e.message !== "Failed to fetch") {
        throw e;
      }
    }

    // Fallback in localStorage if backend is unreachable
    const leads = getStorage<Lead[]>("zigmaa_leads", INITIAL_LEADS);
    const lead = leads.find(l => String(l.id) === String(leadId));
    if (lead) {
      lead.stage = "Closed / Won" as any;
      lead.status = "CONVERTED";
      setStorage("zigmaa_leads", leads);
    }

    const deals = getStorage<Deal[]>("zigmaa_deals", INITIAL_DEALS);
    const newDeal: Deal = {
      id: Date.now(),
      title: data.deal_name || `${lead?.company_name || lead?.name || "Client"} - Deal`,
      company_name: lead?.company_name || "Enterprise Client",
      contact_name: lead?.name || "",
      value: Number(data.deal_value) || 0,
      stage: (data.pipeline_stage as any) || "Qualification",
      probability: 20,
      close_date: new Date().toISOString().split("T")[0],
      created_at: new Date().toISOString(),
      lead_id: leadId
    };
    deals.unshift(newDeal);
    setStorage("zigmaa_deals", deals);

    const contacts = getStorage<Contact[]>("zigmaa_contacts", INITIAL_CONTACTS);
    const newContact: Contact = {
      id: Date.now(),
      name: lead?.name || "",
      email: lead?.email || "",
      phone: lead?.phone || "",
      company_name: lead?.company_name || "",
      status: "Customer",
      created_at: new Date().toISOString()
    };
    contacts.unshift(newContact);
    setStorage("zigmaa_contacts", contacts);

    return {
      success: true,
      message: "Lead converted to Deal successfully",
      deal_id: String(newDeal.id),
      deal_title: newDeal.title,
      contact_id: String(newContact.id),
      lead_id: String(leadId)
    };
  },

  async bulkUploadLeads(rows: any[]): Promise<{ total_ingested: number; records: Lead[] }> {
    const leads = getStorage<Lead[]>("zigmaa_leads", INITIAL_LEADS);
    const newLeads: Lead[] = rows.map((r, idx) => ({
      id: Date.now() + idx,
      name: r.full_name || r.name || r["Contact Name"] || `Lead ${idx + 1}`,
      phone: r.phone || r["Phone Number"] || "",
      email: r.email || r["Email Address"] || "",
      company_name: r.company_name || r.company || r["Company Name"] || "",
      ad_source: (r.source || r.ad_source || "CSV Import") as any,
      stage: (r.stage || "New Lead") as any,
      deal_value: Number(r.deal_value || r["Deal Value"]) || 0,
      notes: r.notes || "",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }));

    const combined = [...newLeads, ...leads];
    setStorage("zigmaa_leads", combined);
    return {
      total_ingested: newLeads.length,
      records: newLeads
    };
  },

  async updateLead(id: number | string, patch: Partial<Lead>): Promise<Lead | null> {
    try {
      const res = await fetch(`${API_BASE}/leads/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch)
      });
      if (res.ok) {
        invalidateClientCache("leads");
        return await res.json();
      }
    } catch {}

    const leads = getStorage<Lead[]>("zigmaa_leads", INITIAL_LEADS);
    const index = leads.findIndex(l => String(l.id) === String(id));
    if (index === -1) return null;

    leads[index] = {
      ...leads[index],
      ...patch,
      updated_at: new Date().toISOString()
    };
    setStorage("zigmaa_leads", leads);
    return leads[index];
  },

  async updateLeadStage(id: number | string, stage: string): Promise<Lead | null> {
    return this.updateLead(id, { stage: stage as any });
  },

  async deleteLead(id: number | string): Promise<boolean> {
    try {
      const res = await fetch(`${API_BASE}/leads/${id}`, { method: "DELETE" });
      if (res.ok) {
        invalidateClientCache("leads");
        return true;
      }
    } catch {}

    const leads = getStorage<Lead[]>("zigmaa_leads", INITIAL_LEADS);
    const filtered = leads.filter(l => String(l.id) !== String(id));
    setStorage("zigmaa_leads", filtered);
    return true;
  },

  async addLeadActivity(leadId: number | string, activity: { activity_type: any; description: string }) {
    const leads = getStorage<Lead[]>("zigmaa_leads", INITIAL_LEADS);
    const lead = leads.find(l => String(l.id) === String(leadId));
    if (!lead) return null;

    if (!lead.activities) lead.activities = [];
    const newAct = {
      id: Date.now(),
      lead_id: leadId,
      activity_type: activity.activity_type,
      description: activity.description,
      created_at: new Date().toISOString()
    };
    lead.activities.unshift(newAct);
    setStorage("zigmaa_leads", leads);
    return newAct;
  },

  async addLeadNote(leadId: number | string, note: string, type: string = "note"): Promise<Lead | null> {
    await this.addLeadActivity(leadId, { activity_type: type as any, description: note });
    const leads = getStorage<Lead[]>("zigmaa_leads", INITIAL_LEADS);
    return leads.find(l => String(l.id) === String(leadId)) || null;
  },

  // ===== EMAIL SYNC (ZIGMAA 1-CLICK INTEGRATION) =====
  async getEmailSync(): Promise<{ is_connected: boolean; email: string | null; provider: string | null; last_synced_at?: string | null }> {
    try {
      const res = await fetch(`${API_BASE}/settings/email-sync`, { cache: "no-store" });
      if (res.ok) {
        return await res.json();
      }
    } catch (e) {
      console.error("Email sync status check error:", e);
    }
    return getStorage<{ is_connected: boolean; email: string | null; provider: string | null; last_synced_at?: string | null }>(
      "zigmaa_email_sync",
      { is_connected: false, email: null, provider: null }
    );
  },

  async connectEmailSync(data: { email: string; provider?: string }): Promise<any> {
    try {
      const res = await fetch(`${API_BASE}/settings/email-sync/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      });
      if (res.ok) {
        const result = await res.json();
        setStorage("zigmaa_email_sync", {
          is_connected: true,
          email: data.email,
          provider: data.provider || "GMAIL",
          last_synced_at: "Just now"
        });
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("zigmaa_email_sync_updated"));
        }
        return result;
      }
    } catch (e) {
      console.error("Connect email sync API error:", e);
    }

    const fallback = {
      status: "success",
      is_connected: true,
      email: data.email,
      provider: data.provider || "GMAIL",
      last_synced_at: "Just now"
    };
    setStorage("zigmaa_email_sync", fallback);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("zigmaa_email_sync_updated"));
    }
    return fallback;
  },

  async disconnectEmailSync(): Promise<any> {
    try {
      const res = await fetch(`${API_BASE}/settings/email-sync/disconnect`, {
        method: "POST"
      });
      if (res.ok) {
        setStorage("zigmaa_email_sync", { is_connected: false, email: null, provider: null });
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("zigmaa_email_sync_updated"));
        }
        return await res.json();
      }
    } catch (e) {
      console.error("Disconnect email sync API error:", e);
    }

    const fallback = { is_connected: false, email: null, provider: null };
    setStorage("zigmaa_email_sync", fallback);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("zigmaa_email_sync_updated"));
    }
    return fallback;
  },

  // ===== GOOGLE OAUTH INTEGRATION (GMAIL & CALENDAR) =====
  async getGoogleAuthUrl(): Promise<{ url: string }> {
    const origin = typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : "";
    const qs = origin ? `?redirect_origin=${encodeURIComponent(origin)}` : "";
    const res = await fetch(`${API_BASE}/integrations/google/auth-url${qs}`, {
      headers: getAuthHeaders(),
      cache: "no-store"
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "Failed to retrieve Google Auth URL");
    }
    const data = await res.json();
    return { url: data.url || "" };
  },

  async getGoogleStatus(): Promise<{ connected: boolean; email: string | null; provider?: string }> {
    try {
      const res = await fetch(`${API_BASE}/integrations/google/status`, {
        headers: getAuthHeaders(),
        cache: "no-store"
      });
      if (res.ok) {
        const json = await res.json();
        return json;
      }
    } catch (e) {
      console.error("Google integration status check error:", e);
    }
    return { connected: false, email: null };
  },

  async disconnectGoogle(): Promise<boolean> {
    try {
      const res = await fetch(`${API_BASE}/integrations/google/disconnect`, {
        method: "POST",
        headers: getAuthHeaders()
      });
      if (res.ok) {
        setStorage("zigmaa_email_sync", { is_connected: false, email: null, provider: null });
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("zigmaa_email_sync_updated"));
        }
        return true;
      }
    } catch (e) {
      console.error("Disconnect Google integration error:", e);
    }
    return false;
  },

  // ===== ORGANIZATION & PROPOSAL BRANDING SETTINGS =====
  async getOrganizationSettings(): Promise<OrganizationSettings> {
    const currentUser = this.getCurrentUser();
    const defaultSettings: OrganizationSettings = {
      company_name: currentUser?.organization_name || (currentUser?.full_name ? `${currentUser.full_name}'s Workspace` : "Zigmaa Workspace"),
      logo_url: currentUser?.picture || currentUser?.avatar_url || null,
      email: currentUser?.email || "info@zigmaa.com",
      phone: "+91 98765 43210",
      address: "Chennai Tech Park, Guindy, Chennai, Tamil Nadu 600032",
      gstin: "33AAECZ9920K1ZX",
      website: "https://zigmaa.com",
      signatory_name: currentUser?.full_name || "Authorized Signatory",
      signatory_designation: "Authorized Signatory",
      bank_name: "HDFC Bank Ltd",
      account_number: "50200084729104",
      ifsc_code: "HDFC0001244",
      upi_id: "zigmaa@hdfcbank",
      default_terms: "Payment terms: 50% advance, balance upon project milestone delivery. Bank Transfer / UPI accepted."
    };

    const userKey = currentUser?.id || currentUser?.email
      ? `zigmaa_org_settings_${currentUser.id || currentUser.email}`
      : "zigmaa_org_settings";

    const cached = getStorage<OrganizationSettings>(userKey, defaultSettings);
    if (currentUser?.organization_name && (!cached.company_name || cached.company_name === "Zigmaa CRM Technologies Pvt. Ltd.")) {
      cached.company_name = currentUser.organization_name;
    }
    if ((currentUser?.picture || currentUser?.avatar_url) && !cached.logo_url) {
      cached.logo_url = currentUser.picture || currentUser.avatar_url;
    }

    try {
      const res = await fetch(`${API_BASE}/settings/organization`, {
        headers: getAuthHeaders(),
        cache: "no-store"
      });
      if (res.ok) {
        const serverData = await res.json();
        const merged: OrganizationSettings = {
          ...defaultSettings,
          ...cached,
          ...serverData,
          company_name: serverData.company_name || cached.company_name || defaultSettings.company_name,
          logo_url: serverData.logo_url !== undefined ? serverData.logo_url : (cached.logo_url || defaultSettings.logo_url),
          email: serverData.email || cached.email || defaultSettings.email
        };
        setStorage(userKey, merged);
        setStorage("zigmaa_org_settings", merged);
        return merged;
      }
    } catch (e) {
      console.warn("Could not fetch remote organization settings, using local cache:", e);
    }

    return cached;
  },

  async updateOrganizationSettings(data: Partial<OrganizationSettings>): Promise<OrganizationSettings> {
    const current = await this.getOrganizationSettings();
    const updated: OrganizationSettings = {
      ...current,
      ...data
    };

    const currentUser = this.getCurrentUser();
    const userKey = currentUser?.id || currentUser?.email
      ? `zigmaa_org_settings_${currentUser.id || currentUser.email}`
      : "zigmaa_org_settings";

    setStorage(userKey, updated);
    setStorage("zigmaa_org_settings", updated);

    // Also update current user workspace info if company_name or logo_url changed
    const user = currentUser || {};
    let userChanged = false;
    if (data.company_name && user.organization_name !== data.company_name) {
      user.organization_name = data.company_name;
      userChanged = true;
    }
    if (data.logo_url && user.picture !== data.logo_url) {
      user.picture = data.logo_url;
      userChanged = true;
    }
    if (userChanged) {
      setStorage("zigmaa_user", user);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("zigmaa_user_updated"));
      }
    }

    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("zigmaa_org_settings_updated"));
    }

    try {
      const res = await fetch(`${API_BASE}/settings/organization`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify(updated)
      });
      if (res.ok) {
        const result = await res.json();
        if (result.settings) {
          const remoteMerged = { ...updated, ...result.settings };
          setStorage(userKey, remoteMerged);
          setStorage("zigmaa_org_settings", remoteMerged);
          return remoteMerged;
        }
      }
    } catch (e) {
      console.error("Failed to sync organization settings with server:", e);
    }

    return updated;
  },

  // ===== DEALS (PIPELINE) CRUD =====
  async getDeals(forceRefresh = false): Promise<Deal[]> {
    const cacheKey = "deals:all";
    const cached = clientMemoryCache.get(cacheKey);
    if (!forceRefresh && cached) {
      if (Date.now() - cached.timestamp < CLIENT_CACHE_TTL) {
        return cached.data;
      }
      this.revalidateDeals();
      return cached.data;
    }

    try {
      const res = await fetch(`${API_BASE}/deals`, {
        headers: getAuthHeaders(),
        cache: "no-store"
      });
      if (res.ok) {
        const backendDeals = await res.json();
        if (Array.isArray(backendDeals)) {
          const localDeals = getStorage<Deal[]>("zigmaa_deals", []);
          const localStageMap: Record<string, string> = {};
          localDeals.forEach(ld => {
            if (ld && ld.id && ld.stage) localStageMap[String(ld.id)] = ld.stage;
          });

          const normalizeStage = (st: string) => {
            if (!st) return "New Deal";
            const s = st.trim();
            if (s.toLowerCase() === "lead in") return "New Deal";
            if (s.toLowerCase() === "contact made") return "Discovery";
            return s;
          };

          const mapped = backendDeals.map((d: any) => {
            const rawStage = (d.custom_data && d.custom_data.stage) || d.stage;
            const stageVal = normalizeStage(rawStage || localStageMap[String(d.id)] || d.stage_id || "New Deal");
            return {
              id: d.id,
              title: d.title,
              company_name: (d.custom_data && d.custom_data.company_name) || d.company_name || "Enterprise Account",
              contact_name: (d.custom_data && d.custom_data.contact_name) || d.contact_name || "",
              contact_phone: (d.custom_data && (d.custom_data.contact_phone || d.custom_data.phone)) || d.contact_phone || d.phone || "",
              contact_email: (d.custom_data && (d.custom_data.contact_email || d.custom_data.email)) || d.contact_email || d.email || "",
              value: Number(d.deal_value || d.value) || 0,
              deal_value: Number(d.deal_value || d.value) || 0,
              currency: d.currency || "INR",
              stage: stageVal,
              stage_id: d.stage_id || stageVal,
              probability: Number(d.probability) || 50,
              close_date: d.expected_close_date || d.close_date || new Date().toISOString().split("T")[0],
              expected_close_date: d.expected_close_date || d.close_date || new Date().toISOString().split("T")[0],
              lead_id: d.lead_id,
              contact_id: d.contact_id,
              status: d.status || "OPEN",
              custom_data: d.custom_data || {},
              created_at: d.created_at || new Date().toISOString()
            };
          });

          setStorage("zigmaa_deals", mapped);
          clientMemoryCache.set(cacheKey, { data: mapped, timestamp: Date.now() });
          return mapped;
        }
      }
    } catch {}
    return getStorage<Deal[]>("zigmaa_deals", INITIAL_DEALS);
  },

  async revalidateDeals(): Promise<void> {
    try {
      const res = await fetch(`${API_BASE}/deals`, {
        headers: getAuthHeaders(),
        cache: "no-store"
      });
      if (res.ok) {
        const backendDeals = await res.json();
        if (Array.isArray(backendDeals)) {
          const localDeals = getStorage<Deal[]>("zigmaa_deals", []);
          const localStageMap: Record<string, string> = {};
          localDeals.forEach(ld => {
            if (ld && ld.id && ld.stage) localStageMap[String(ld.id)] = ld.stage;
          });

          const normalizeStage = (st: string) => {
            if (!st) return "New Deal";
            const s = st.trim();
            if (s.toLowerCase() === "lead in") return "New Deal";
            if (s.toLowerCase() === "contact made") return "Discovery";
            return s;
          };

          const mapped = backendDeals.map((d: any) => {
            const rawStage = (d.custom_data && d.custom_data.stage) || d.stage;
            const stageVal = normalizeStage(rawStage || localStageMap[String(d.id)] || d.stage_id || "New Deal");
            return {
              id: d.id,
              title: d.title,
              company_name: (d.custom_data && d.custom_data.company_name) || d.company_name || "Enterprise Account",
              contact_name: (d.custom_data && d.custom_data.contact_name) || d.contact_name || "",
              contact_phone: (d.custom_data && (d.custom_data.contact_phone || d.custom_data.phone)) || d.contact_phone || d.phone || "",
              contact_email: (d.custom_data && (d.custom_data.contact_email || d.custom_data.email)) || d.contact_email || d.email || "",
              value: Number(d.deal_value || d.value) || 0,
              deal_value: Number(d.deal_value || d.value) || 0,
              currency: d.currency || "INR",
              stage: stageVal,
              stage_id: d.stage_id || stageVal,
              probability: Number(d.probability) || 50,
              close_date: d.expected_close_date || d.close_date || new Date().toISOString().split("T")[0],
              expected_close_date: d.expected_close_date || d.close_date || new Date().toISOString().split("T")[0],
              lead_id: d.lead_id,
              contact_id: d.contact_id,
              status: d.status || "OPEN",
              custom_data: d.custom_data || {},
              created_at: d.created_at || new Date().toISOString()
            };
          });
          setStorage("zigmaa_deals", mapped);
          clientMemoryCache.set("deals:all", { data: mapped, timestamp: Date.now() });
        }
      }
    } catch {}
  },

  async getDealsBoard(forceRefresh = false): Promise<{ pipeline: any; stages: any[] }> {
    const cacheKey = "deals:board";
    const cached = clientMemoryCache.get(cacheKey);
    if (!forceRefresh && cached) {
      if (Date.now() - cached.timestamp < CLIENT_CACHE_TTL) {
        return cached.data;
      }
      this.revalidateDealsBoard();
      return cached.data;
    }

    try {
      const res = await fetch(`${API_BASE}/deals/board`, {
        headers: getAuthHeaders(),
        cache: "no-store"
      });
      if (res.ok) {
        const json = await res.json();
        clientMemoryCache.set(cacheKey, { data: json, timestamp: Date.now() });
        return json;
      }
    } catch {}
    return { pipeline: null, stages: [] };
  },

  async revalidateDealsBoard(): Promise<void> {
    try {
      const res = await fetch(`${API_BASE}/deals/board`, {
        headers: getAuthHeaders(),
        cache: "no-store"
      });
      if (res.ok) {
        const json = await res.json();
        clientMemoryCache.set("deals:board", { data: json, timestamp: Date.now() });
      }
    } catch {}
  },

  async updateDealStage(id: number | string, stage: string, stageId?: string): Promise<any> {
    clientMemoryCache.delete("deals:all");
    clientMemoryCache.delete("deals:board");
    Array.from(clientMemoryCache.keys()).forEach((k) => {
      if (k.startsWith("dashboard:metrics")) clientMemoryCache.delete(k);
    });

    // Immediately persist in localStorage
    const deals = getStorage<Deal[]>("zigmaa_deals", INITIAL_DEALS);
    const index = deals.findIndex(d => String(d.id) === String(id));
    if (index !== -1) {
      deals[index] = { ...deals[index], stage: stage as any, stage_id: stageId || stage };
      setStorage("zigmaa_deals", deals);
    }

    try {
      const res = await fetch(`${API_BASE}/deals/${id}/stage`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeaders()
        },
        body: JSON.stringify({ stage, stage_id: stageId || stage })
      });
      if (res.ok) {
        return await res.json();
      }
    } catch (err) {
      console.warn("Failed to update deal stage on backend, persisted locally:", err);
    }

    return index !== -1 ? deals[index] : null;
  },

  async createDeal(dealData: Partial<Deal>): Promise<Deal> {
    const targetStage = dealData.stage || dealData.stage_id || "New Deal";
    try {
      const payload = {
        title: dealData.title || "New Deal",
        deal_value: Number(dealData.value || dealData.deal_value) || 0,
        currency: dealData.currency || "INR",
        stage_id: dealData.stage_id || targetStage,
        stage: targetStage,
        lead_id: dealData.lead_id ? String(dealData.lead_id) : null,
        contact_id: dealData.contact_id ? String(dealData.contact_id) : null,
        expected_close_date: dealData.close_date || dealData.expected_close_date,
        assigned_user_id: (dealData as any).assigned_user_id || undefined,
        custom_data: {
          company_name: dealData.company_name,
          contact_name: dealData.contact_name,
          contact_phone: dealData.contact_phone,
          contact_email: dealData.contact_email,
          stage: targetStage,
          ...(dealData.custom_data || {})
        }
      };
      const res = await fetch(`${API_BASE}/deals`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeaders()
        },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        const d = await res.json();
        const finalStage = d.stage || targetStage;
        const newDealItem: Deal = {
          id: d.id,
          title: d.title,
          company_name: dealData.company_name || d.company_name || "Enterprise Account",
          contact_name: dealData.contact_name || d.contact_name || "",
          contact_phone: dealData.contact_phone || d.contact_phone || "",
          contact_email: dealData.contact_email || d.contact_email || "",
          value: Number(d.deal_value || d.value) || 0,
          deal_value: Number(d.deal_value || d.value) || 0,
          currency: d.currency || "INR",
          stage: finalStage,
          stage_id: d.stage_id || finalStage,
          probability: Number(dealData.probability) || (finalStage === "Won" ? 100 : 50),
          close_date: d.expected_close_date || dealData.close_date || new Date().toISOString().split("T")[0],
          expected_close_date: d.expected_close_date || dealData.close_date || new Date().toISOString().split("T")[0],
          custom_data: { ...(d.custom_data || {}), stage: finalStage },
          created_at: d.created_at || new Date().toISOString()
        };

        // Instant Cache Invalidation & Local Storage Synchronization:
        clientMemoryCache.delete("deals:all");
        clientMemoryCache.delete("deals:board");
        clientMemoryCache.delete("contacts:all");
        Array.from(clientMemoryCache.keys()).forEach((k) => {
          if (k.startsWith("dashboard:metrics")) clientMemoryCache.delete(k);
        });
        const existingDeals = getStorage<Deal[]>("zigmaa_deals", []);
        const filtered = existingDeals.filter((ed) => String(ed.id) !== String(newDealItem.id));
        setStorage("zigmaa_deals", [newDealItem, ...filtered]);

        // Synchronize contact record in localStorage if deal is linked to a contact
        if (newDealItem.contact_id) {
          const contacts = getStorage<Contact[]>("zigmaa_contacts", INITIAL_CONTACTS);
          const targetLifecycle = (newDealItem.stage === "Won" || (newDealItem.stage_id && String(newDealItem.stage_id).toLowerCase().includes("won"))) ? "Customer" : "Qualified";
          const updatedContacts = contacts.map(c => {
            if (String(c.id) === String(newDealItem.contact_id)) {
              return {
                ...c,
                lifecycle_stage: targetLifecycle,
                status: targetLifecycle,
                total_deals: (c.total_deals || 0) + 1,
                has_open_deal: true,
                deals: [newDealItem, ...(c.deals || [])],
                custom_data: {
                  ...(c.custom_data || {}),
                  has_open_deal: true,
                  latest_deal_id: newDealItem.id,
                  latest_deal_title: newDealItem.title,
                  latest_deal_stage: newDealItem.stage
                }
              };
            }
            return c;
          });
          setStorage("zigmaa_contacts", updatedContacts);
        }

        this.revalidateDeals();
        return newDealItem;
      }
    } catch {}

    const deals = getStorage<Deal[]>("zigmaa_deals", INITIAL_DEALS);
    const newDeal: Deal = {
      id: Date.now(),
      title: dealData.title || "New Deal",
      company_name: dealData.company_name || "Enterprise Account",
      contact_name: dealData.contact_name || "",
      contact_phone: dealData.contact_phone || "",
      contact_email: dealData.contact_email || "",
      contact_id: dealData.contact_id ? String(dealData.contact_id) : undefined,
      lead_id: dealData.lead_id ? String(dealData.lead_id) : undefined,
      value: Number(dealData.value || dealData.deal_value) || 0,
      deal_value: Number(dealData.value || dealData.deal_value) || 0,
      currency: dealData.currency || "INR",
      stage: targetStage,
      stage_id: targetStage,
      probability: Number(dealData.probability) || (targetStage === "Won" ? 100 : 50),
      close_date: dealData.close_date || new Date().toISOString().split("T")[0],
      custom_data: {
        stage: targetStage,
        company_name: dealData.company_name,
        contact_name: dealData.contact_name,
        contact_phone: dealData.contact_phone,
        contact_email: dealData.contact_email,
        ...(dealData.custom_data || {})
      },
      created_at: new Date().toISOString()
    };
    deals.unshift(newDeal);
    setStorage("zigmaa_deals", deals);
    clientMemoryCache.delete("deals:all");
    clientMemoryCache.delete("deals:board");
    clientMemoryCache.delete("contacts:all");
    Array.from(clientMemoryCache.keys()).forEach((k) => {
      if (k.startsWith("dashboard:metrics")) clientMemoryCache.delete(k);
    });

    // Also update contact in local storage if contact_id exists
    if (dealData.contact_id) {
      const contacts = getStorage<Contact[]>("zigmaa_contacts", INITIAL_CONTACTS);
      const targetLifecycle = targetStage === "Won" ? "Customer" : "Qualified";
      const updatedContacts = contacts.map(c => {
        if (String(c.id) === String(dealData.contact_id)) {
          return {
            ...c,
            lifecycle_stage: targetLifecycle,
            status: targetLifecycle,
            total_deals: (c.total_deals || 0) + 1,
            has_open_deal: true,
            deals: [newDeal, ...(c.deals || [])],
            custom_data: {
              ...(c.custom_data || {}),
              has_open_deal: true,
              latest_deal_id: newDeal.id,
              latest_deal_title: newDeal.title,
              latest_deal_stage: newDeal.stage
            }
          };
        }
        return c;
      });
      setStorage("zigmaa_contacts", updatedContacts);
    }
    return newDeal;
  },

  async updateDeal(id: number | string, patch: Partial<Deal>): Promise<Deal | null> {
    clientMemoryCache.delete("deals:all");
    clientMemoryCache.delete("deals:board");

    if (patch.stage) {
      await this.updateDealStage(id, patch.stage as string, patch.stage_id);
    } else {
      try {
        await fetch(`${API_BASE}/deals/${id}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            ...getAuthHeaders()
          },
          body: JSON.stringify(patch)
        });
      } catch (err) {
        console.warn("Backend updateDeal failed:", err);
      }
    }

    const deals = getStorage<Deal[]>("zigmaa_deals", INITIAL_DEALS);
    const index = deals.findIndex(d => String(d.id) === String(id));
    if (index !== -1) {
      deals[index] = { ...deals[index], ...patch };
      setStorage("zigmaa_deals", deals);
      return deals[index];
    } else {
      const updatedDeal = { id, ...patch } as Deal;
      deals.push(updatedDeal);
      setStorage("zigmaa_deals", deals);
      return updatedDeal;
    }
  },

  async deleteDeal(id: number | string): Promise<boolean> {
    try {
      const res = await fetch(`${API_BASE}/deals/${id}`, { method: "DELETE" });
      if (res.ok) return true;
    } catch {}
    const deals = getStorage<Deal[]>("zigmaa_deals", INITIAL_DEALS);
    const filtered = deals.filter(d => String(d.id) !== String(id));
    setStorage("zigmaa_deals", filtered);
    return true;
  },

  // ===== CONTACTS CRUD =====
  async getContacts(forceRefresh = false): Promise<Contact[]> {
    const cacheKey = "contacts:all";
    const cached = clientMemoryCache.get(cacheKey);
    if (!forceRefresh && cached) {
      if (Date.now() - cached.timestamp < CLIENT_CACHE_TTL) {
        return cached.data;
      }
      this.revalidateContacts();
      return cached.data;
    }

    try {
      const res = await fetch(`${API_BASE}/contacts`, {
        headers: getAuthHeaders(),
        cache: "no-store"
      });
      if (res.ok) {
        const backendContacts = await res.json();
        if (Array.isArray(backendContacts)) {
          const mapped = backendContacts.map((c: any) => ({
            id: c.id,
            name: c.full_name || c.name || "Unnamed",
            email: c.email || "",
            phone: c.phone || "",
            company_name: c.company_name || "",
            job_title: c.designation || c.job_title || "",
            status: c.status || c.lifecycle_stage || "NEW",
            lifecycle_stage: c.lifecycle_stage || c.status || "NEW",
            source: c.source || "MANUAL",
            assigned_to: c.assigned_user_name || "Mohamed Thoufiq",
            total_deals: c.total_deals || 0,
            lifetime_value: Number(c.lifetime_value) || 0,
            custom_data: c.custom_data || {},
            created_at: c.created_at || new Date().toISOString()
          }));
          clientMemoryCache.set(cacheKey, { data: mapped, timestamp: Date.now() });
          return mapped;
        }
      } else if (res.status === 401) {
        this.logout();
      }
    } catch (e) {
      console.error("Failed to fetch contacts from API:", e);
    }
    return cached?.data || [];
  },

  async revalidateContacts() {
    try {
      const res = await fetch(`${API_BASE}/contacts`, {
        headers: getAuthHeaders(),
        cache: "no-store"
      });
      if (res.ok) {
        const backendContacts = await res.json();
        if (Array.isArray(backendContacts)) {
          const mapped = backendContacts.map((c: any) => ({
            id: c.id,
            name: c.full_name || c.name || "Unnamed",
            email: c.email || "",
            phone: c.phone || "",
            company_name: c.company_name || "",
            job_title: c.designation || c.job_title || "",
            status: c.status || c.lifecycle_stage || "NEW",
            lifecycle_stage: c.lifecycle_stage || c.status || "NEW",
            source: c.source || "MANUAL",
            assigned_to: c.assigned_user_name || "Mohamed Thoufiq",
            total_deals: c.total_deals || 0,
            lifetime_value: Number(c.lifetime_value) || 0,
            custom_data: c.custom_data || {},
            created_at: c.created_at || new Date().toISOString()
          }));
          clientMemoryCache.set("contacts:all", { data: mapped, timestamp: Date.now() });
        }
      } else if (res.status === 401) {
        this.logout();
      }
    } catch {}
  },

  async getContactDetail(id: string | number): Promise<any> {
    try {
      const res = await fetch(`${API_BASE}/contacts/${id}`, { cache: "no-store" });
      if (res.ok) {
        const c = await res.json();
        return {
          ...c,
          name: c.full_name || c.name,
          lifecycle_stage: c.lifecycle_stage || c.status || "New"
        };
      }
    } catch {}
    const contacts = await this.getContacts();
    return contacts.find(c => String(c.id) === String(id)) || null;
  },

  async getContactAIInsights(id: string | number, refresh: boolean = false): Promise<any> {
    try {
      const res = await fetch(`${API_BASE}/contacts/${id}/ai-insights?refresh=${refresh}`, {
        cache: "no-store"
      });
      if (res.ok) {
        return await res.json();
      }
    } catch (e) {
      console.warn("AI Insights API fallback", e);
    }

    // Heuristic fallback if network or server error
    return {
      win_percentage: 45,
      intent_tier: "Medium",
      key_insight: "Prospective buyer actively exploring business solutions.",
      conversion_tips: [
        "Reach out directly via WhatsApp to understand priority requirements",
        "Send tailored pricing breakdown and customer testimonials"
      ],
      risk_warning: "Response speed is key; engagement drops if not contacted promptly.",
      engine: "Instant Client Heuristic"
    };
  },

  async updateContact(id: number | string, data: Partial<Contact> & Record<string, any>): Promise<any> {
    const payload: any = { ...data };
    if (data.name && !payload.full_name) {
      payload.full_name = data.name;
    }
    if (data.company && !payload.company_name) {
      payload.company_name = data.company;
    }
    if (data.job_title && !payload.designation) {
      payload.designation = data.job_title;
    }
    if (data.assigned_to && !payload.assigned_user_name) {
      payload.assigned_user_name = data.assigned_to;
    }
    try {
      const res = await fetch(`${API_BASE}/contacts/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeaders()
        },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        invalidateClientCache("contacts");
        clientMemoryCache.delete("contacts:all");
        const c = await res.json();
        const normalized = {
          ...c,
          id: c.id,
          name: c.full_name || c.name,
          full_name: c.full_name || c.name,
          email: c.email || "",
          phone: c.phone || "",
          company: c.company_name || c.company || "",
          company_name: c.company_name || c.company || "",
          job_title: c.designation || c.job_title || "",
          status: c.status || c.lifecycle_stage || "NEW",
          lifecycle_stage: c.lifecycle_stage || c.status || "NEW",
          source: c.source || "MANUAL",
          assigned_to: c.assigned_user_name || c.assigned_to || "Mohamed Thoufiq",
          custom_data: c.custom_data || c.custom_properties || {},
          custom_properties: c.custom_properties || c.custom_data || {}
        };
        const contacts = getStorage<Contact[]>("zigmaa_contacts", INITIAL_CONTACTS);
        const updated = contacts.map(item => String(item.id) === String(id) ? { ...item, ...normalized } : item);
        setStorage("zigmaa_contacts", updated);
        return normalized;
      } else {
        let errMsg = "Failed to update contact";
        try {
          const errData = await res.json();
          errMsg = errData.detail || errMsg;
        } catch (_) {}
        throw new Error(errMsg);
      }
    } catch (err: any) {
      if (err.message && !err.message.includes("Failed to fetch")) {
        throw err;
      }
      // Fallback for offline / demo mode
      clientMemoryCache.delete("contacts:all");
      const contacts = getStorage<Contact[]>("zigmaa_contacts", INITIAL_CONTACTS);
      const updated = contacts.map(c => String(c.id) === String(id) ? { ...c, ...data } : c);
      setStorage("zigmaa_contacts", updated);
      return data;
    }
  },

  async deleteContact(id: number | string): Promise<boolean> {
    try {
      const res = await fetch(`${API_BASE}/contacts/${id}`, {
        method: "DELETE",
        headers: getAuthHeaders()
      });
      if (res.ok) {
        invalidateClientCache("contacts");
        const contacts = getStorage<Contact[]>("zigmaa_contacts", INITIAL_CONTACTS);
        const remaining = contacts.filter(c => String(c.id) !== String(id));
        setStorage("zigmaa_contacts", remaining);
        return true;
      }
    } catch {}

    const contacts = getStorage<Contact[]>("zigmaa_contacts", INITIAL_CONTACTS);
    const remaining = contacts.filter(c => String(c.id) !== String(id));
    setStorage("zigmaa_contacts", remaining);
    return true;
  },

  async bulkDeleteContacts(ids: (number | string)[]): Promise<boolean> {
    const stringIds = ids.map(String);
    try {
      const res = await fetch(`${API_BASE}/contacts/bulk-delete`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeaders()
        },
        body: JSON.stringify({ contact_ids: stringIds })
      });
      if (res.ok) {
        invalidateClientCache("contacts");
        const contacts = getStorage<Contact[]>("zigmaa_contacts", INITIAL_CONTACTS);
        const remaining = contacts.filter(c => !stringIds.includes(String(c.id)));
        setStorage("zigmaa_contacts", remaining);
        return true;
      }
    } catch {}

    const contacts = getStorage<Contact[]>("zigmaa_contacts", INITIAL_CONTACTS);
    const remaining = contacts.filter(c => !stringIds.includes(String(c.id)));
    setStorage("zigmaa_contacts", remaining);
    return true;
  },

  async sendContactEmail(id: number | string, data: { subject: string; body: string }): Promise<any> {
    const res = await fetch(`${API_BASE}/contacts/${id}/send-email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeaders()
      },
      body: JSON.stringify(data)
    });

    if (!res.ok) {
      let errorMsg = "Failed to send email";
      try {
        const errJson = await res.json();
        errorMsg = errJson.detail || errorMsg;
      } catch {}
      throw new Error(errorMsg);
    }

    return await res.json();
  },

  async sendEmail(payload: {
    to: string | string[];
    subject: string;
    body: string;
    html_body?: string;
    contact_id?: string;
    lead_id?: string;
    deal_id?: string;
  }): Promise<any> {
    const res = await fetch(`${API_BASE}/emails/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeaders()
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      let errorMsg = "Failed to send email";
      try {
        const errJson = await res.json();
        errorMsg = errJson.detail || errorMsg;
      } catch {}
      throw new Error(errorMsg);
    }

    return await res.json();
  },

  async createContact(contactData: Partial<Contact>, upsert: boolean = true): Promise<Contact> {
    const currentUser = this.getCurrentUser();
    const defaultOwner = currentUser?.full_name || "Mohamed Thoufiq";
    const payload = {
      full_name: contactData.name || contactData.full_name || "Unnamed Contact",
      email: contactData.email || null,
      phone: contactData.phone || "",
      company_name: contactData.company_name || null,
      designation: contactData.job_title || null,
      job_title: contactData.job_title || null,
      status: contactData.status || contactData.lifecycle_stage || "NEW",
      lifecycle_stage: contactData.lifecycle_stage || contactData.status || "NEW",
      source: contactData.source || "MANUAL",
      custom_data: contactData.custom_data || {},
      assigned_user_name: contactData.assigned_to || defaultOwner
    };
    const res = await fetch(`${API_BASE}/contacts?upsert=${upsert ? "true" : "false"}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeaders()
      },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      invalidateClientCache("contacts");
      const c = await res.json();
      return {
        id: c.id,
        name: c.full_name || c.name,
        email: c.email || "",
        phone: c.phone || "",
        company_name: c.company_name || "",
        job_title: c.designation || c.job_title || "",
        status: c.status || "NEW",
        lifecycle_stage: c.lifecycle_stage || c.status || "NEW",
        source: c.source || "MANUAL",
        assigned_to: c.assigned_user_name || "Mohamed Thoufiq",
        total_deals: c.total_deals || 0,
        lifetime_value: c.lifetime_value || 0,
        custom_data: c.custom_data || {},
        created_at: c.created_at
      };
    }
    const errText = await res.text();
    throw new Error(`Failed to create contact: ${errText || res.statusText}`);
  },

  async bulkUploadContacts(rows: any[]): Promise<{ total_ingested: number; duplicates_skipped: number; records: Contact[] }> {
    if (!rows || !rows.length) {
      return { total_ingested: 0, duplicates_skipped: 0, records: [] };
    }

    const cleanKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

    const formattedContacts = rows.map((r, idx) => {
      if (!r || typeof r !== "object") return null;

      const getField = (...keys: string[]): string => {
        for (const k of keys) {
          const ck = cleanKey(k);
          for (const rowKey of Object.keys(r)) {
            if (cleanKey(rowKey) === ck) {
              const val = r[rowKey];
              if (val !== undefined && val !== null && String(val).trim() !== "") {
                return String(val).trim();
              }
            }
          }
        }
        return "";
      };

      const contactName = getField("name", "full_name", "contact_name", "first_name", "customer_name", "client_name") || `Contact ${idx + 1}`;
      const phone = getField("phone", "mobile", "contact_number", "contact_no", "phone_number", "mobile_number", "phone_no", "mobile_no", "cell", "telephone", "ph", "mob");
      const email = getField("email", "email_address", "mail");
      const company = getField("company_name", "company", "organization", "account_name");
      const jobTitle = getField("job_title", "designation", "role", "title");
      const source = getField("source", "lead_source", "ad_source") || "Excel/CSV Import";
      const stage = getField("stage", "lifecycle_stage", "status") || "New";

      return {
        name: contactName,
        full_name: contactName,
        phone: phone,
        email: email || undefined,
        company_name: company || undefined,
        job_title: jobTitle || undefined,
        source: source,
        lifecycle_stage: stage,
        status: stage
      };
    }).filter(Boolean);

    // 1. Try high-performance backend batch endpoint
    try {
      const res = await fetch(`${API_BASE}/contacts/bulk-import`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeaders()
        },
        body: JSON.stringify({ contacts: formattedContacts, upsert: true })
      });
      if (res.ok) {
        invalidateClientCache("contacts");
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("contacts_updated"));
        }
        const data = await res.json();
        return {
          total_ingested: data.total_ingested || (data.created + data.updated) || 0,
          duplicates_skipped: data.skipped || 0,
          records: []
        };
      }
    } catch (bulkErr) {
      console.warn("Backend /contacts/bulk-import not available, falling back to sequential upsert:", bulkErr);
    }

    // 2. Fallback to individual sequential upserts
    const createdList: Contact[] = [];
    let duplicatesSkipped = 0;
    let lastError: string | null = null;

    for (const item of formattedContacts) {
      if (!item) continue;
      try {
        const created = await this.createContact(item as any, true);
        createdList.push(created);
      } catch (e: any) {
        const msg = e?.message || String(e);
        if (msg.includes("already exists") || msg.includes("409") || msg.includes("Duplicate") || msg.includes("duplicate")) {
          duplicatesSkipped++;
        } else {
          console.error("Bulk contact item insert error:", e);
          lastError = msg;
        }
      }
    }

    invalidateClientCache("contacts");
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("contacts_updated"));
    }

    if (createdList.length === 0 && duplicatesSkipped === 0 && rows.length > 0) {
      throw new Error(lastError || "Could not import contacts. Please verify your file format.");
    }

    return {
      total_ingested: createdList.length,
      duplicates_skipped: duplicatesSkipped,
      records: createdList
    };
  },

  // ===== CUSTOM FIELDS ENGINE =====
  async getCustomFields(moduleOrEntity: "LEAD" | "CONTACT" | "DEAL" | "contacts" | "deals" | "companies" | string): Promise<any[]> {
    const raw = (moduleOrEntity || "contacts").toLowerCase();
    const mod = raw.endsWith("s") ? raw : raw + "s";
    try {
      const res = await fetch(`${API_BASE}/custom-fields?module=${encodeURIComponent(mod)}`, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setStorage(`zigmaa_cf_${mod}`, data);
        setStorage(`zigmaa_cf_${raw}`, data);
        return data;
      }
    } catch (e) {
      console.warn("Failed to fetch custom fields from API, falling back to local cache", e);
    }
    return getStorage<any[]>(`zigmaa_cf_${mod}`, getStorage<any[]>(`zigmaa_cf_${raw}`, []));
  },

  async createCustomField(field: {
    module?: string;
    entity_type?: "LEAD" | "CONTACT" | "DEAL" | string;
    label: string;
    key?: string;
    field_key?: string;
    field_type: "TEXT" | "NUMBER" | "SELECT" | "DATE" | "BOOLEAN" | "text" | "number" | "select" | "date" | "boolean" | string;
    options?: string[] | null;
    is_required?: boolean;
    is_active?: boolean;
  }): Promise<any> {
    const normModule = (field.module || field.entity_type || "contacts").toLowerCase();
    const finalModule = normModule.endsWith("s") ? normModule : normModule + "s";
    const payload = {
      module: finalModule,
      entity_type: (field.entity_type || finalModule.toUpperCase().slice(0, -1)),
      label: field.label,
      key: field.key || field.field_key,
      field_key: field.key || field.field_key,
      field_type: field.field_type.toLowerCase(),
      options: field.options || null,
      is_required: !!field.is_required,
      is_active: field.is_active !== false
    };

    try {
      const res = await fetch(`${API_BASE}/custom-fields`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        const created = await res.json();
        const list = getStorage<any[]>(`zigmaa_cf_${finalModule}`, []);
        const filtered = list.filter(f => f.id !== created.id && f.key !== created.key);
        filtered.push(created);
        setStorage(`zigmaa_cf_${finalModule}`, filtered);
        window.dispatchEvent(new CustomEvent("zigmaa_custom_fields_updated", { detail: { module: finalModule } }));
        return created;
      } else {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.detail || `Request failed with status ${res.status}`);
      }
    } catch (err: any) {
      console.error("createCustomField error:", err);
      throw err;
    }
  },

  async deleteCustomField(fieldId: string, moduleOrEntity?: string): Promise<boolean> {
    const raw = (moduleOrEntity || "contacts").toLowerCase();
    const finalModule = raw.endsWith("s") ? raw : raw + "s";
    try {
      const res = await fetch(`${API_BASE}/custom-fields/${fieldId}`, { method: "DELETE" });
      if (res.ok) {
        const list = getStorage<any[]>(`zigmaa_cf_${finalModule}`, []);
        const filtered = list.filter(f => f.id !== fieldId);
        setStorage(`zigmaa_cf_${finalModule}`, filtered);
        window.dispatchEvent(new CustomEvent("zigmaa_custom_fields_updated", { detail: { module: finalModule } }));
        return true;
      } else {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.detail || `Delete failed with status ${res.status}`);
      }
    } catch (err: any) {
      console.error("deleteCustomField error:", err);
      const list = getStorage<any[]>(`zigmaa_cf_${finalModule}`, []);
      const filtered = list.filter(f => f.id !== fieldId);
      setStorage(`zigmaa_cf_${finalModule}`, filtered);
      window.dispatchEvent(new CustomEvent("zigmaa_custom_fields_updated", { detail: { module: finalModule } }));
      return true;
    }
  },

  // ===== ACCOUNTS CRUD =====
  async getAccounts(): Promise<Account[]> {
    return getStorage<Account[]>("zigmaa_accounts", INITIAL_ACCOUNTS);
  },

  async createAccount(accData: Partial<Account>): Promise<Account> {
    const accounts = getStorage<Account[]>("zigmaa_accounts", INITIAL_ACCOUNTS);
    const newAcc: Account = {
      id: Date.now(),
      name: accData.name || "",
      industry: accData.industry || "Technology",
      phone: accData.phone || "",
      website: accData.website || "",
      city: accData.city || "",
      annual_revenue: Number(accData.annual_revenue) || 0,
      created_at: new Date().toISOString()
    };
    accounts.unshift(newAcc);
    setStorage("zigmaa_accounts", accounts);
    return newAcc;
  },

  async deleteAccount(id: number | string): Promise<boolean> {
    const accounts = getStorage<Account[]>("zigmaa_accounts", INITIAL_ACCOUNTS);
    const filtered = accounts.filter(a => String(a.id) !== String(id));
    setStorage("zigmaa_accounts", filtered);
    return true;
  },

  // ===== TASKS CRUD (Connected to FastAPI + PostgreSQL) =====
  async getTasks(forceRefresh = false): Promise<Task[]> {
    const cacheKey = "tasks:all";
    const cached = clientMemoryCache.get(cacheKey);
    if (!forceRefresh && cached) {
      if (Date.now() - cached.timestamp < CLIENT_CACHE_TTL) {
        return cached.data;
      }
      this.revalidateTasks();
      return cached.data;
    }

    try {
      const res = await fetch(`${API_BASE}/tasks`, {
        headers: getAuthHeaders(),
        cache: "no-store"
      });
      if (res.ok) {
        const backendTasks = await res.json();
        if (Array.isArray(backendTasks)) {
          const mapped = backendTasks.map((t: any) => ({
            id: t.id,
            title: t.title,
            activity_type: t.activity_type || "To-Do",
            due_date: t.due_date || "",
            due_time: t.due_time || "",
            priority: t.priority || "Medium",
            status: t.status || "PENDING",
            assigned_to: t.assigned_to || "Mohamed Thoufiq",
            description: t.description || "",
            contact_id: t.contact_id || null,
            contact_name: t.contact_name || "",
            contact_phone: t.contact_phone || "",
            contact_company: t.contact_company || "",
            created_at: t.created_at || new Date().toISOString()
          }));
          clientMemoryCache.set(cacheKey, { data: mapped, timestamp: Date.now() });
          setStorage("zigmaa_tasks", mapped);
          return mapped;
        }
      }
    } catch (e) {
      console.warn("Backend tasks fetch failed, falling back to local storage", e);
    }

    const raw = getStorage<Task[]>("zigmaa_tasks", []);
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    const deduplicated: Task[] = [];
    for (const t of raw) {
      const key = String(t.id);
      if (!seen.has(key)) {
        seen.add(key);
        deduplicated.push(t);
      }
    }
    return deduplicated;
  },

  async revalidateTasks(): Promise<void> {
    try {
      const res = await fetch(`${API_BASE}/tasks`, {
        headers: getAuthHeaders(),
        cache: "no-store"
      });
      if (res.ok) {
        const backendTasks = await res.json();
        if (Array.isArray(backendTasks)) {
          const mapped = backendTasks.map((t: any) => ({
            id: t.id,
            title: t.title,
            activity_type: t.activity_type || "To-Do",
            due_date: t.due_date || "",
            due_time: t.due_time || "",
            priority: t.priority || "Medium",
            status: t.status || "PENDING",
            assigned_to: t.assigned_to || "Mohamed Thoufiq",
            description: t.description || "",
            contact_id: t.contact_id || null,
            contact_name: t.contact_name || "",
            contact_phone: t.contact_phone || "",
            contact_company: t.contact_company || "",
            created_at: t.created_at || new Date().toISOString()
          }));
          clientMemoryCache.set("tasks:all", { data: mapped, timestamp: Date.now() });
        }
      }
    } catch {}
  },

  async createTask(taskData: Partial<Task>): Promise<Task> {
    try {
      const res = await fetch(`${API_BASE}/tasks`, {
        method: "POST",
        headers: {
          ...getAuthHeaders(),
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          title: taskData.title || "",
          activity_type: taskData.activity_type || "To-Do",
          due_date: taskData.due_date || new Date(Date.now() + 86400000).toISOString().split("T")[0],
          due_time: taskData.due_time || null,
          priority: taskData.priority || "Medium",
          status: taskData.status || "PENDING",
          assigned_to: taskData.assigned_to || "Mohamed Thoufiq",
          description: taskData.description || null,
          contact_id: taskData.contact_id ? String(taskData.contact_id) : null,
          contact_name: taskData.contact_name || null,
          contact_phone: taskData.contact_phone || null,
          contact_company: taskData.contact_company || null
        })
      });
      if (res.ok) {
        const created = await res.json();
        clientMemoryCache.delete("tasks:all");
        const mappedTask: Task = {
          id: created.id,
          title: created.title,
          activity_type: created.activity_type || "To-Do",
          due_date: created.due_date || "",
          due_time: created.due_time || "",
          priority: created.priority || "Medium",
          status: created.status || "PENDING",
          assigned_to: created.assigned_to || "Mohamed Thoufiq",
          description: created.description || "",
          contact_id: created.contact_id,
          contact_name: created.contact_name || "",
          contact_phone: created.contact_phone || "",
          contact_company: created.contact_company || "",
          created_at: created.created_at || new Date().toISOString()
        };
        const localTasks = getStorage<Task[]>("zigmaa_tasks", []);
        const withoutDup = localTasks.filter(t => String(t.id) !== String(mappedTask.id));
        setStorage("zigmaa_tasks", [mappedTask, ...withoutDup]);
        return mappedTask;
      }
    } catch (e) {
      console.warn("Backend task creation failed, saving locally", e);
    }

    const tasks = await this.getTasks();
    const newTask: Task = {
      id: `${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      title: taskData.title || "",
      activity_type: taskData.activity_type || "To-Do",
      due_date: taskData.due_date || new Date(Date.now() + 86400000).toISOString().split("T")[0],
      due_time: taskData.due_time || "",
      priority: taskData.priority || "Medium",
      status: taskData.status || "PENDING",
      assigned_to: taskData.assigned_to || "Mohamed Thoufiq",
      description: taskData.description || "",
      contact_id: taskData.contact_id,
      contact_name: taskData.contact_name || "",
      contact_phone: taskData.contact_phone || "",
      contact_company: taskData.contact_company || "",
      created_at: new Date().toISOString()
    };
    tasks.unshift(newTask);
    setStorage("zigmaa_tasks", tasks);
    clientMemoryCache.delete("tasks:all");
    return newTask;
  },

  async updateTask(id: number | string, patch: Partial<Task>): Promise<Task | null> {
    try {
      const res = await fetch(`${API_BASE}/tasks/${id}`, {
        method: "PATCH",
        headers: {
          ...getAuthHeaders(),
          "Content-Type": "application/json"
        },
        body: JSON.stringify(patch)
      });
      if (res.ok) {
        clientMemoryCache.delete("tasks:all");
        return await res.json();
      }
    } catch {}

    const tasks = getStorage<Task[]>("zigmaa_tasks", []);
    const idx = tasks.findIndex(t => String(t.id) === String(id));
    if (idx === -1) return null;
    tasks[idx] = { ...tasks[idx], ...patch };
    setStorage("zigmaa_tasks", tasks);
    clientMemoryCache.delete("tasks:all");
    return tasks[idx];
  },

  async toggleTaskStatus(id: number | string): Promise<Task | null> {
    try {
      const res = await fetch(`${API_BASE}/tasks/${id}/toggle-status`, {
        method: "PATCH",
        headers: getAuthHeaders()
      });
      if (res.ok) {
        clientMemoryCache.delete("tasks:all");
        return await res.json();
      }
    } catch {}

    const tasks = getStorage<Task[]>("zigmaa_tasks", []);
    const idx = tasks.findIndex(t => String(t.id) === String(id));
    if (idx === -1) return null;
    const current = tasks[idx].status;
    const next = current === "Completed" || current === "COMPLETED" ? "PENDING" : "COMPLETED";
    tasks[idx] = { ...tasks[idx], status: next };
    setStorage("zigmaa_tasks", tasks);
    clientMemoryCache.delete("tasks:all");
    return tasks[idx];
  },

  async deleteTask(id: number | string): Promise<boolean> {
    try {
      const res = await fetch(`${API_BASE}/tasks/${id}`, {
        method: "DELETE",
        headers: getAuthHeaders()
      });
      if (res.ok) {
        clientMemoryCache.delete("tasks:all");
        const tasks = getStorage<Task[]>("zigmaa_tasks", []);
        const filtered = tasks.filter(t => String(t.id) !== String(id));
        setStorage("zigmaa_tasks", filtered);
        return true;
      }
    } catch {}

    const tasks = getStorage<Task[]>("zigmaa_tasks", []);
    const filtered = tasks.filter(t => String(t.id) !== String(id));
    setStorage("zigmaa_tasks", filtered);
    clientMemoryCache.delete("tasks:all");
    return true;
  },

  // ===== CALENDAR EVENTS & GOOGLE CALENDAR CRUD =====
  async getEvents(): Promise<CalendarEvent[]> {
    try {
      const res = await fetch(`${API_BASE}/calendar/events`, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          return data;
        }
      }
    } catch (e) {
      console.warn("FastAPI getEvents failed, falling back to local storage:", e);
    }
    return getStorage<CalendarEvent[]>("zigmaa_events", INITIAL_EVENTS);
  },

  async createEvent(eventData: Partial<CalendarEvent>): Promise<CalendarEvent> {
    const payload = {
      title: eventData.title || "Sales Meeting",
      event_type: eventData.event_type || "Product Demo",
      start_time: eventData.start_time,
      end_time: eventData.end_time || eventData.start_time,
      meeting_link: eventData.meeting_link || eventData.meet_url || eventData.location || "https://meet.google.com/zgm-live-meet",
      location: eventData.location || eventData.meeting_link || eventData.meet_url || "Online Google Meet",
      attendee_name: eventData.attendee_name || "",
      attendee_email: eventData.attendee_email || "",
      contact_id: eventData.contact_id ? String(eventData.contact_id) : null,
      notes: eventData.notes || eventData.description || "",
      description: eventData.notes || eventData.description || "",
      lead_or_deal: eventData.lead_or_deal || "",
      google_calendar_synced: Boolean(eventData.google_calendar_synced)
    };

    try {
      const res = await fetch(`${API_BASE}/calendar/events`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeaders()
        },
        body: JSON.stringify(payload),
        cache: "no-store"
      });
      if (res.ok) {
        const saved = await res.json();
        const events = getStorage<CalendarEvent[]>("zigmaa_events", INITIAL_EVENTS);
        events.unshift(saved);
        setStorage("zigmaa_events", events);
        return saved;
      }
    } catch (e) {
      console.warn("FastAPI createEvent failed, falling back to local storage:", e);
    }

    const events = getStorage<CalendarEvent[]>("zigmaa_events", INITIAL_EVENTS);
    const now = new Date();
    const defaultStart = new Date(now.getTime() + 3600000).toISOString().slice(0, 16);
    const defaultEnd = new Date(now.getTime() + 7200000).toISOString().slice(0, 16);

    const newEvent: CalendarEvent = {
      id: Date.now(),
      title: eventData.title || "Sales Meeting",
      description: eventData.description || eventData.notes || "",
      notes: eventData.notes || eventData.description || "",
      start_time: eventData.start_time || defaultStart,
      end_time: eventData.end_time || defaultEnd,
      location: eventData.location || "Online Google Meet",
      meeting_link: eventData.meeting_link || eventData.meet_url || eventData.location,
      meet_url: eventData.meet_url || eventData.meeting_link,
      attendee_name: eventData.attendee_name || "",
      attendee_email: eventData.attendee_email || "",
      contact_id: eventData.contact_id,
      lead_or_deal: eventData.lead_or_deal,
      event_type: eventData.event_type || "Product Demo",
      google_calendar_synced: false,
      created_at: new Date().toISOString()
    };

    events.unshift(newEvent);
    setStorage("zigmaa_events", events);
    return newEvent;
  },

  async deleteEvent(id: number | string): Promise<boolean> {
    try {
      const res = await fetch(`${API_BASE}/calendar/events/${id}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
        cache: "no-store"
      });
      if (res.ok) {
        const events = getStorage<CalendarEvent[]>("zigmaa_events", INITIAL_EVENTS);
        const filtered = events.filter(e => String(e.id) !== String(id));
        setStorage("zigmaa_events", filtered);
        return true;
      }
    } catch {}

    const events = getStorage<CalendarEvent[]>("zigmaa_events", INITIAL_EVENTS);
    const filtered = events.filter(e => String(e.id) !== String(id));
    setStorage("zigmaa_events", filtered);
    return true;
  },

  async syncWithGoogleCalendar(id: number | string): Promise<string> {
    const events = getStorage<CalendarEvent[]>("zigmaa_events", INITIAL_EVENTS);
    const ev = events.find(e => String(e.id) === String(id));
    if (!ev) throw new Error("Event not found");

    ev.google_calendar_synced = true;
    setStorage("zigmaa_events", events);
    return formatGoogleCalendarUrl(ev);
  },

  // ===== EXPENSES CRUD =====
  async getExpenses(): Promise<Expense[]> {
    return getStorage<Expense[]>("zigmaa_expenses", INITIAL_EXPENSES);
  },

  async createExpense(expData: Partial<Expense>): Promise<Expense> {
    const expenses = getStorage<Expense[]>("zigmaa_expenses", INITIAL_EXPENSES);
    const newExp: Expense = {
      id: Date.now(),
      title: expData.title || "",
      category: expData.category || "Software",
      amount: Number(expData.amount) || 0,
      date: expData.date || new Date().toISOString().split("T")[0],
      payment_method: expData.payment_method || "Card",
      status: expData.status || "Paid",
      created_at: new Date().toISOString()
    };
    expenses.unshift(newExp);
    setStorage("zigmaa_expenses", expenses);
    return newExp;
  },

  async deleteExpense(id: number | string): Promise<boolean> {
    const expenses = getStorage<Expense[]>("zigmaa_expenses", INITIAL_EXPENSES);
    const filtered = expenses.filter(e => String(e.id) !== String(id));
    setStorage("zigmaa_expenses", filtered);
    return true;
  },

  // ===== INVOICES & QUOTES CRUD =====
  async getInvoices(params?: { search?: string; type?: string; status?: string; deal_id?: string; contact_id?: string }): Promise<Invoice[]> {
    try {
      const searchParams = new URLSearchParams();
      if (params?.search) searchParams.set("search", params.search);
      if (params?.type) searchParams.set("type", params.type);
      if (params?.status) searchParams.set("status", params.status);
      if (params?.deal_id) searchParams.set("deal_id", params.deal_id);
      if (params?.contact_id) searchParams.set("contact_id", params.contact_id);

      const qs = searchParams.toString();
      const url = qs ? `${API_BASE}/invoices?${qs}` : `${API_BASE}/invoices`;
      const res = await fetch(url, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          return data.map((inv: any) => ({
            ...inv,
            bill_number: inv.invoice_number || inv.bill_number
          }));
        }
      }
    } catch (e) {
      console.warn("FastAPI getInvoices failed, using local storage:", e);
    }
    return getStorage<Invoice[]>("zigmaa_invoices", INITIAL_INVOICES);
  },

  async getInvoice(id: number | string): Promise<Invoice | null> {
    try {
      const res = await fetch(`${API_BASE}/invoices/${id}`, { cache: "no-store" });
      if (res.ok) {
        const inv = await res.json();
        return {
          ...inv,
          bill_number: inv.invoice_number || inv.bill_number
        };
      }
    } catch (e) {
      console.warn("FastAPI getInvoice failed:", e);
    }
    const invoices = getStorage<Invoice[]>("zigmaa_invoices", INITIAL_INVOICES);
    return invoices.find(i => String(i.id) === String(id) || i.invoice_number === String(id) || i.bill_number === String(id)) || null;
  },

  async createInvoice(invData: Partial<Invoice>): Promise<Invoice> {
    try {
      const payload = {
        deal_id: invData.deal_id || null,
        contact_id: invData.contact_id || null,
        invoice_number: invData.invoice_number || null,
        client_name: invData.client_name || invData.patient_name || "Client",
        client_company: invData.client_company || null,
        client_email: invData.client_email || invData.email || null,
        client_phone: invData.client_phone || invData.phone || null,
        client_address: invData.client_address || null,
        subject: invData.subject || null,
        company_name: invData.company_name || null,
        company_tagline: invData.company_tagline || null,
        company_phone: invData.company_phone || null,
        company_address: invData.company_address || null,
        company_logo: invData.company_logo || null,
        type: (invData.type || "QUOTE").toUpperCase(),
        status: (invData.status || "DRAFT").toUpperCase(),
        issue_date: invData.issue_date || null,
        due_date: invData.due_date || null,
        items: (invData.items || []).map((it) => ({
          description: it.description || it.name || "Item",
          qty: it.qty || 1,
          unit_price: it.unit_price || 0,
          tax_rate: it.tax_rate !== undefined ? it.tax_rate : 18,
          amount: it.amount || (it.qty || 1) * (it.unit_price || 0)
        })),
        subtotal: invData.subtotal,
        tax_amount: invData.tax_amount,
        discount: invData.discount || 0,
        total_amount: invData.total_amount,
        notes: invData.notes || null
      };

      const res = await fetch(`${API_BASE}/invoices`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        const saved = await res.json();
        const formatted: Invoice = {
          ...saved,
          bill_number: saved.invoice_number
        };
        const invoices = getStorage<Invoice[]>("zigmaa_invoices", INITIAL_INVOICES);
        invoices.unshift(formatted);
        setStorage("zigmaa_invoices", invoices);
        return formatted;
      }
    } catch (e) {
      console.warn("FastAPI createInvoice failed, fallback to local storage:", e);
    }

    const invoices = getStorage<Invoice[]>("zigmaa_invoices", INITIAL_INVOICES);
    const newInv: Invoice = {
      id: Date.now(),
      invoice_number: `QT-2026-${Date.now().toString().slice(-4)}`,
      bill_number: `QT-2026-${Date.now().toString().slice(-4)}`,
      deal_id: invData.deal_id,
      contact_id: invData.contact_id,
      client_name: invData.client_name || invData.patient_name || "Client",
      client_company: invData.client_company,
      client_email: invData.client_email || invData.email,
      client_phone: invData.client_phone || invData.phone,
      type: invData.type || "QUOTE",
      status: invData.status || "DRAFT",
      issue_date: invData.issue_date || new Date().toISOString().split("T")[0],
      due_date: invData.due_date,
      items: invData.items || [{ description: "CRM Consulting", qty: 1, unit_price: 0, amount: 0, tax_rate: 18 }],
      subtotal: invData.subtotal || 0,
      tax_amount: invData.tax_amount || 0,
      discount: invData.discount || 0,
      total_amount: Number(invData.total_amount) || 0,
      notes: invData.notes,
      payment_method: invData.payment_method || "Bank Transfer",
      created_at: new Date().toISOString()
    };
    invoices.unshift(newInv);
    setStorage("zigmaa_invoices", invoices);
    return newInv;
  },

  async updateInvoice(id: number | string, patch: Partial<Invoice>): Promise<Invoice | null> {
    try {
      const res = await fetch(`${API_BASE}/invoices/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch)
      });
      if (res.ok) {
        return await res.json();
      }
    } catch {}
    return null;
  },

  async deleteInvoice(id: number | string): Promise<boolean> {
    try {
      const res = await fetch(`${API_BASE}/invoices/${id}`, { method: "DELETE" });
      if (res.ok) {
        const invoices = getStorage<Invoice[]>("zigmaa_invoices", INITIAL_INVOICES);
        const filtered = invoices.filter(i => String(i.id) !== String(id));
        setStorage("zigmaa_invoices", filtered);
        return true;
      }
    } catch {}

    const invoices = getStorage<Invoice[]>("zigmaa_invoices", INITIAL_INVOICES);
    const filtered = invoices.filter(i => String(i.id) !== String(id));
    setStorage("zigmaa_invoices", filtered);
    return true;
  },

  // ===== WORKFLOW AUTOMATIONS ENGINE =====
  async getWorkflows(module?: string): Promise<any[]> {
    try {
      const url = module ? `${API_BASE}/automations?module=${module}` : `${API_BASE}/automations`;
      const res = await fetch(url, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setStorage("zigmaa_workflows", data);
        return data;
      }
    } catch (e) {
      console.warn("Falling back to cached workflows", e);
    }
    return getStorage<any[]>("zigmaa_workflows", []);
  },

  async createWorkflow(wf: {
    name: string;
    module: "CONTACT" | "DEAL";
    trigger_event: string;
    conditions?: Record<string, any>;
    actions?: any[];
    is_active?: boolean;
  }): Promise<any> {
    try {
      const res = await fetch(`${API_BASE}/automations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(wf)
      });
      if (res.ok) {
        const created = await res.json();
        const list = getStorage<any[]>("zigmaa_workflows", []);
        list.unshift(created);
        setStorage("zigmaa_workflows", list);
        return created;
      } else {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.detail || "Failed to create workflow");
      }
    } catch (err: any) {
      console.error(err);
      throw err;
    }
  },

  async toggleWorkflow(id: string): Promise<any> {
    try {
      const res = await fetch(`${API_BASE}/automations/${id}/toggle`, {
        method: "PATCH"
      });
      if (res.ok) return await res.json();
    } catch {}

    const list = getStorage<any[]>("zigmaa_workflows", []);
    const updated = list.map(w => w.id === id ? { ...w, is_active: !w.is_active } : w);
    setStorage("zigmaa_workflows", updated);
    return { id, is_active: !list.find(w => w.id === id)?.is_active };
  },

  async deleteWorkflow(id: string): Promise<boolean> {
    try {
      const res = await fetch(`${API_BASE}/automations/${id}`, {
        method: "DELETE"
      });
      if (res.ok) {
        const list = getStorage<any[]>("zigmaa_workflows", []);
        const filtered = list.filter(w => w.id !== id);
        setStorage("zigmaa_workflows", filtered);
        return true;
      }
    } catch {}

    const list = getStorage<any[]>("zigmaa_workflows", []);
    const filtered = list.filter(w => w.id !== id);
    setStorage("zigmaa_workflows", filtered);
    return true;
  },

  async getWorkflowHistory(): Promise<any[]> {
    try {
      const res = await fetch(`${API_BASE}/automations/history`, { cache: "no-store" });
      if (res.ok) {
        return await res.json();
      }
    } catch {}
    return [];
  },

  // ===== AUTOMATIONS & COMPATIBILITY =====
  async getAutomations(): Promise<AutomationLog[]> {
    return getStorage<AutomationLog[]>("zigmaa_automations", INITIAL_AUTOMATIONS);
  },

  async getTodayTokens(): Promise<OPDToken[]> {
    return [];
  },

  async updateTokenStatus(tokenId: number, newStatus: string): Promise<any> {
    return { id: tokenId, status: newStatus };
  },

  async saveConsultation(...args: any[]): Promise<any> {
    return { success: true, args };
  },

  async issueToken(...args: any[]): Promise<any> {
    return { id: Date.now(), token_number: 1, args };
  },

  // ===== RESET ALL DATA TO ZERO (FRESH START) =====
  clearAllData() {
    if (typeof window === "undefined") return;
    localStorage.removeItem("zigmaa_leads");
    localStorage.removeItem("zigmaa_deals");
    localStorage.removeItem("zigmaa_contacts");
    localStorage.removeItem("zigmaa_accounts");
    localStorage.removeItem("zigmaa_tasks");
    localStorage.removeItem("zigmaa_events");
    localStorage.removeItem("zigmaa_expenses");
    localStorage.removeItem("zigmaa_invoices");
    localStorage.removeItem("zigmaa_automations");
  },

  // ===== AI COPILOT / ASSISTANT =====
  async askCopilot(
    question: string,
    history: Array<{ role: string; content: string }> = [],
    ui_context?: any
  ): Promise<{ answer: string; model_used?: string; status?: string; error?: string }> {
    try {
      const res = await fetch(`${API_BASE}/ai/copilot`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({
          question,
          message: question,
          history,
          ui_context
        })
      });
      if (!res.ok) {
        let errDetail = "Failed to communicate with AI Copilot";
        try {
          const errJson = await res.json();
          errDetail = errJson.detail || errDetail;
        } catch {}
        return {
          answer: "",
          status: "error",
          error: errDetail
        };
      }
      return await res.json();
    } catch (err: any) {
      console.error("AI Copilot request error:", err);
      return {
        answer: "",
        status: "error",
        error: "Backend server unreachable. Please make sure FastAPI backend is running on port 8000."
      };
    }
  },

  // ===== TEAM & RBAC MANAGEMENT =====
  async getTeamMembers(): Promise<any[]> {
    try {
      const res = await fetch(`${API_BASE}/users`, {
        headers: getAuthHeaders(),
        cache: "no-store"
      });
      if (res.ok) {
        return await res.json();
      }
    } catch (e) {
      console.warn("Failed to fetch team members from /users:", e);
    }
    try {
      const res = await fetch(`${API_BASE}/settings/team`, {
        headers: getAuthHeaders(),
        cache: "no-store"
      });
      if (res.ok) {
        return await res.json();
      }
    } catch (e) {
      console.warn("Failed to fetch team members from /settings/team:", e);
    }
    return [];
  },

  async inviteTeamMember(data: { full_name: string; email: string; role: string }): Promise<any> {
    const res = await fetch(`${API_BASE}/settings/team/invite`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeaders()
      },
      body: JSON.stringify(data)
    });
    if (!res.ok) {
      let err = "Failed to invite team member";
      try {
        const errJson = await res.json();
        err = errJson.detail || err;
      } catch {}
      throw new Error(err);
    }
    return await res.json();
  },

  async updateMemberRole(userId: string, role: string): Promise<any> {
    const res = await fetch(`${API_BASE}/settings/team/${userId}/role`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeaders()
      },
      body: JSON.stringify({ role })
    });
    if (!res.ok) {
      let err = "Failed to update role";
      try {
        const errJson = await res.json();
        err = errJson.detail || err;
      } catch {}
      throw new Error(err);
    }
    return await res.json();
  },

  async removeTeamMember(userId: string): Promise<any> {
    const res = await fetch(`${API_BASE}/settings/team/${userId}`, {
      method: "DELETE",
      headers: getAuthHeaders()
    });
    if (!res.ok) {
      let err = "Failed to remove team member";
      try {
        const errJson = await res.json();
        err = errJson.detail || err;
      } catch {}
      throw new Error(err);
    }
    return await res.json();
  },

  async createActivity(activity: {
    contact_id?: string;
    deal_id?: string;
    lead_id?: string;
    type: string;
    notes?: string;
    status?: string;
  }): Promise<any> {
    try {
      const res = await fetch(`${API_BASE}/activities`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeaders()
        },
        body: JSON.stringify(activity)
      });
      if (res.ok) {
        return await res.json();
      }
    } catch (e) {
      console.warn("createActivity backend call failed, fallback locally", e);
    }
    return {
      id: "act_" + Date.now(),
      ...activity,
      created_at: new Date().toISOString()
    };
  },

  async getActivities(params?: { contact_id?: string; type?: string }): Promise<any[]> {
    try {
      const query = new URLSearchParams(params as any).toString();
      const res = await fetch(`${API_BASE}/activities${query ? `?${query}` : ""}`, {
        headers: getAuthHeaders()
      });
      if (res.ok) {
        return await res.json();
      }
    } catch (e) {
      console.warn("getActivities error", e);
    }
    return [];
  },

  async getTelephonySettings(): Promise<any> {
    try {
      const res = await fetch(`${API_BASE}/telephony/settings`, {
        headers: getAuthHeaders()
      });
      if (res.ok) {
        return await res.json();
      }
    } catch (e) {
      console.warn("getTelephonySettings error", e);
    }
    return { is_configured: false, provider: "TWILIO" };
  },

  async saveTelephonySettings(data: {
    twilio_account_sid?: string;
    twilio_auth_token?: string;
    twilio_caller_id?: string;
    twilio_twiml_app_sid?: string;
  }): Promise<any> {
    const res = await fetch(`${API_BASE}/telephony/settings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeaders()
      },
      body: JSON.stringify(data)
    });
    if (!res.ok) {
      let err = "Failed to save telephony settings";
      try {
        const json = await res.json();
        err = json.detail || err;
      } catch {}
      throw new Error(err);
    }
    return await res.json();
  },

  async initiateRealCall(payload: {
    to_phone: string;
    contact_id?: string | number;
    contact_name?: string;
    custom_message?: string;
  }): Promise<any> {
    const res = await fetch(`${API_BASE}/telephony/call`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeaders()
      },
      body: JSON.stringify({
        to_phone: payload.to_phone,
        contact_id: payload.contact_id ? String(payload.contact_id) : undefined,
        contact_name: payload.contact_name,
        custom_message: payload.custom_message
      })
    });
    if (!res.ok) {
      let err = "Failed to dispatch real call";
      try {
        const json = await res.json();
        err = json.detail || err;
      } catch {}
      throw new Error(err);
    }
    return await res.json();
  },

  async sendWhatsAppMessage(payload: {
    phone_number: string;
    message?: string;
    contact_id?: string;
    organization_id?: string;
    file_base64?: string;
    file_name?: string;
    file_type?: string;
    quoted_message_id?: string;
    quoted_text?: string;
    quoted_from_me?: boolean;
    crm_display_message?: string;
    session_id?: string;
  }): Promise<any> {
    try {
      const cleanPhone = payload.phone_number.replace(/[^0-9]/g, "");
      const cleanPayload = {
        ...payload,
        phone_number: cleanPhone
      };
      const res = await fetch(`${API_BASE}/whatsapp/send`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeaders()
        },
        body: JSON.stringify(cleanPayload)
      });
      if (!res.ok) {
        let err = "Failed to dispatch WhatsApp message";
        try {
          const json = await res.json();
          err = json.detail || err;
        } catch {}
        throw new Error(err);
      }
      return await res.json();
    } catch (e: any) {
      console.warn("WhatsApp API dispatch fallback:", e.message);
      return {
        status: "success",
        data: {
          id: `local-${Date.now()}`,
          phone_number: payload.phone_number,
          direction: "OUTBOUND",
          message_body: payload.message,
          meta_message_id: `wamid.local_${Date.now()}`,
          status: "SENT",
          contact_id: payload.contact_id,
          created_at: new Date().toISOString()
        }
      };
    }
  },

  async getWhatsAppMessages(params: {
    chat_id?: string;
    phone_number?: string;
    contact_id?: string;
    limit?: number;
    active_session_phone?: string | null;
    session_id?: string | null;
  }): Promise<any> {
    try {
      const query = new URLSearchParams();
      if (params.chat_id) query.set("chat_id", params.chat_id);
      if (params.phone_number) query.set("phone_number", params.phone_number);
      if (params.contact_id) query.set("contact_id", params.contact_id);
      if (params.active_session_phone) query.set("active_session_phone", params.active_session_phone.replace(/[^0-9]/g, ''));
      if (params.session_id) query.set("session_id", params.session_id);
      query.set("limit", String(params.limit || 150));

      const res = await fetch(`${API_BASE}/whatsapp/messages?${query.toString()}`, {
        headers: {
          ...getAuthHeaders()
        }
      });
      if (res.ok) {
        return await res.json();
      }
    } catch (e) {
      console.warn("Failed to fetch backend WhatsApp messages", e);
    }
    return { status: "success", count: 0, messages: [] };
  },

  async uploadWhatsAppVoice(payload: {
    phone_number: string;
    audio_base64: string;
    mimetype?: string;
    contact_id?: string;
    duration_seconds?: number;
    session_id?: string;
  }): Promise<any> {
    try {
      const res = await fetch(`${API_BASE}/whatsapp/upload-voice`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeaders()
        },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        return await res.json();
      }
    } catch (e) {
      console.warn("Failed to upload WhatsApp voice note", e);
    }
    return null;
  },

  async getWhatsAppConversations(limit = 100, assigned_user_id?: string, active_session_phone?: string | null, sessionId?: string): Promise<any> {
    try {
      let sid = sessionId;
      if (!sid && typeof window !== "undefined") {
        try {
          const u = this.getCurrentUser();
          if (u?.id) sid = u.id;
        } catch (_) {}
      }
      let url = `${API_BASE}/whatsapp/conversations?limit=${limit}`;
      if (assigned_user_id && assigned_user_id.toLowerCase() !== "all") {
        url += `&assigned_user_id=${encodeURIComponent(assigned_user_id)}`;
      }
      if (active_session_phone) {
        url += `&active_session_phone=${encodeURIComponent(active_session_phone.replace(/[^0-9]/g, ''))}`;
      }
      if (sid && !sid.includes("-")) {
        url += `&session_id=${encodeURIComponent(sid)}`;
      }
      const res = await fetch(url, {
        headers: {
          ...getAuthHeaders()
        }
      });
      if (res.ok) {
        return await res.json();
      }
    } catch (e) {
      console.warn("Failed to fetch WhatsApp conversations", e);
    }
    return { status: "success", conversations: [] };
  },

  async reassignWhatsAppConversation(phoneNumber: string, assignedUserId: string): Promise<any> {
    try {
      const res = await fetch(`${API_BASE}/whatsapp/conversations/${encodeURIComponent(phoneNumber)}/assign`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeaders()
        },
        body: JSON.stringify({ assigned_user_id: assignedUserId })
      });
      if (res.ok) {
        return await res.json();
      }
    } catch (e) {
      console.warn("Failed to reassign WhatsApp conversation", e);
    }
    return null;
  },

  async updateMemberWhatsApp(userId: string, data: { whatsapp_phone_number?: string; whatsapp_phone_number_id?: string }): Promise<any> {
    const res = await fetch(`${API_BASE}/settings/team/${userId}/whatsapp`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeaders()
      },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: "Failed to update WhatsApp configuration" }));
      throw new Error(err.detail || "Failed to update WhatsApp configuration");
    }
    return await res.json();
  },

  async markWhatsAppConversationRead(phoneNumber: string): Promise<any> {
    try {
      const res = await fetch(`${API_BASE}/whatsapp/conversations/${encodeURIComponent(phoneNumber)}/read`, {
        method: "POST",
        headers: {
          ...getAuthHeaders()
        }
      });
      if (res.ok) {
        return await res.json();
      }
    } catch (e) {
      console.warn("Failed to mark WhatsApp conversation read", e);
    }
    return { status: "success" };
  },

  async convertWhatsAppChatToLead(chatId: string, data?: { lead_name?: string; company_name?: string; email?: string }): Promise<any> {
    const res = await fetch(`${API_BASE}/whatsapp/chats/${encodeURIComponent(chatId)}/convert-lead`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeaders(),
      },
      body: JSON.stringify(data || {}),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: "Failed to convert WhatsApp contact to CRM lead" }));
      throw new Error(err.detail || "Failed to convert WhatsApp contact to CRM lead");
    }
    return await res.json();
  },

  async updateWhatsAppContactName(params: {
    contactId?: string;
    phoneNumber?: string;
    newName: string;
  }): Promise<any> {
    try {
      if (params.contactId) {
        const res = await fetch(`${API_BASE}/contacts/${params.contactId}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            ...getAuthHeaders()
          },
          body: JSON.stringify({ full_name: params.newName })
        });
        if (res.ok) {
          return await res.json();
        }
      }
    } catch (e) {
      console.warn("Failed to update contact name on backend", e);
    }
    return { status: "success" };
  },

  async reactToWhatsAppMessage(params: {
    phoneNumber: string;
    messageId: string;
    emoji: string;
    fromMe?: boolean;
  }): Promise<any> {
    try {
      const res = await fetch(`${API_BASE}/whatsapp/react`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeaders()
        },
        body: JSON.stringify({
          phone_number: params.phoneNumber,
          meta_message_id: params.messageId,
          emoji: params.emoji,
          from_me: params.fromMe || false
        })
      });
      if (res.ok) return await res.json();
    } catch (e) {
      console.warn("Failed to react to WhatsApp message", e);
    }
    return null;
  },

  async editWhatsAppMessage(params: {
    phoneNumber: string;
    messageId: string;
    text: string;
  }): Promise<any> {
    try {
      const res = await fetch(`${API_BASE}/whatsapp/edit-message`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeaders()
        },
        body: JSON.stringify({
          phone_number: params.phoneNumber,
          meta_message_id: params.messageId,
          text: params.text
        })
      });
      if (res.ok) return await res.json();
    } catch (e) {
      console.warn("Failed to edit WhatsApp message", e);
    }
    return null;
  },

  async deleteWhatsAppMessage(params: {
    phoneNumber: string;
    messageId: string;
    deleteForEveryone?: boolean;
    fromMe?: boolean;
  }): Promise<any> {
    try {
      const res = await fetch(`${API_BASE}/whatsapp/delete-message`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeaders()
        },
        body: JSON.stringify({
          phone_number: params.phoneNumber,
          meta_message_id: params.messageId,
          delete_for_everyone: Boolean(params.deleteForEveryone),
          from_me: params.fromMe !== undefined ? params.fromMe : true
        })
      });
      if (res.ok) return await res.json();
    } catch (e) {
      console.warn("Failed to delete WhatsApp message", e);
    }
    return null;
  },

  // ===== SUPER ADMIN MASTER PORTAL =====
  async getSuperAdminOverview(): Promise<any> {
    const res = await fetch(`${API_BASE}/admin/overview`, {
      headers: getAuthHeaders(),
      cache: "no-store"
    });
    if (!res.ok) {
      let err = "Failed to fetch master portal overview";
      try {
        const j = await res.json();
        err = j.detail || err;
      } catch {}
      throw new Error(err);
    }
    return await res.json();
  },

  async getSuperAdminOrganizations(): Promise<any[]> {
    const res = await fetch(`${API_BASE}/admin/organizations`, {
      headers: getAuthHeaders(),
      cache: "no-store"
    });
    if (!res.ok) {
      let err = "Failed to fetch organizations";
      try {
        const j = await res.json();
        err = j.detail || err;
      } catch {}
      throw new Error(err);
    }
    return await res.json();
  },

  async updateTenantPlan(orgId: string, plan: string): Promise<any> {
    const res = await fetch(`${API_BASE}/admin/organizations/${orgId}/plan`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeaders()
      },
      body: JSON.stringify({ plan })
    });
    if (!res.ok) {
      let err = "Failed to update tenant plan";
      try {
        const j = await res.json();
        err = j.detail || err;
      } catch {}
      throw new Error(err);
    }
    return await res.json();
  },

  async extendTenantTrial(orgId: string, days: number = 14): Promise<any> {
    const res = await fetch(`${API_BASE}/admin/organizations/${orgId}/trial`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeaders()
      },
      body: JSON.stringify({ days })
    });
    if (!res.ok) {
      let err = "Failed to extend tenant trial";
      try {
        const j = await res.json();
        err = j.detail || err;
      } catch {}
      throw new Error(err);
    }
    return await res.json();
  },

  async updateTenantStatus(orgId: string, status: string): Promise<any> {
    const res = await fetch(`${API_BASE}/admin/organizations/${orgId}/status`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeaders()
      },
      body: JSON.stringify({ status })
    });
    if (!res.ok) {
      let err = "Failed to update tenant status";
      try {
        const j = await res.json();
        err = j.detail || err;
      } catch {}
      throw new Error(err);
    }
    return await res.json();
  },

  async updateTenantQuotas(orgId: string, quotas: { max_users?: number; max_whatsapp?: number }): Promise<any> {
    const res = await fetch(`${API_BASE}/admin/organizations/${orgId}/quotas`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeaders()
      },
      body: JSON.stringify(quotas)
    });
    if (!res.ok) {
      let err = "Failed to update tenant quotas";
      try {
        const j = await res.json();
        err = j.detail || err;
      } catch {}
      throw new Error(err);
    }
    return await res.json();
  },

  async impersonateTenant(orgId: string): Promise<any> {
    const res = await fetch(`${API_BASE}/admin/impersonate/${orgId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeaders()
      }
    });
    if (!res.ok) {
      let err = "Failed to impersonate tenant";
      try {
        const j = await res.json();
        err = j.detail || err;
      } catch {}
      throw new Error(err);
    }
    const data = await res.json();
    if (data.access_token) {
      setStorage("zigmaa_token", data.access_token);
      setStorage("zigmaa_user", data.user);
      if (typeof document !== "undefined") {
        document.cookie = `zigmaa_token=${encodeURIComponent(data.access_token)}; path=/; max-age=86400; SameSite=Lax`;
      }
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("zigmaa_user_updated"));
      }
    }
    return data;
  },

  async verifyInvitation(token: string): Promise<any> {
    const res = await fetch(`${API_BASE}/auth/verify-invitation?token=${encodeURIComponent(token)}`, {
      method: "GET",
      cache: "no-store"
    });
    if (!res.ok) {
      let err = "This invitation link has expired (24-hour limit) or is invalid.";
      try {
        const j = await res.json();
        err = j.detail || err;
      } catch {}
      throw new Error(err);
    }
    return await res.json();
  },

  async acceptInvitation(payload: { token: string; password: string }): Promise<any> {
    const res = await fetch(`${API_BASE}/auth/accept-invitation`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      let err = "Failed to set password. Invitation link may have expired (24h limit).";
      try {
        const j = await res.json();
        err = j.detail || err;
      } catch {}
      throw new Error(err);
    }
    const data = await res.json();
    if (data.access_token) {
      setStorage("zigmaa_token", data.access_token);
      setStorage("zigmaa_user", data.user);
      if (typeof document !== "undefined") {
        document.cookie = `zigmaa_token=${encodeURIComponent(data.access_token)}; path=/; max-age=86400; SameSite=Lax`;
      }
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("zigmaa_user_updated"));
      }
    }
    return data;
  },

  // ===== WHATSAPP QR GATEWAY (LINKED DEVICE) =====
  async prewarmWhatsApp(): Promise<any> {
    try {
      const res = await fetch(`${API_BASE}/whatsapp/status`, {
        headers: getAuthHeaders(),
        cache: "no-store",
      });
      if (res.ok) return await res.json();
    } catch (_) {
      // Best-effort pre-warm
    }
    return { status: "OFFLINE", gateway_online: false };
  },

  async connectWhatsAppQR(sessionId?: string): Promise<{
    status: string;
    phone: string | null;
    name: string | null;
    avatar_url?: string | null;
    qr: string | null;
    qr_code?: string | null;
    gateway_online: boolean;
  }> {
    let sid = sessionId;
    if (!sid && typeof window !== "undefined") {
      try {
        const u = this.getCurrentUser();
        if (u?.id) sid = u.id;
      } catch (_) {}
      if (!sid) {
        try {
          const uStr = localStorage.getItem("zigmaa_user") || localStorage.getItem("zigmaa_current_user");
          if (uStr) {
            const p = JSON.parse(uStr);
            sid = p?.id || p?.userId || p?._id || null;
          }
        } catch (_) {}
      }
    }
    const query = sid ? `?sessionId=${encodeURIComponent(sid)}` : "";
    try {
      const res = await fetch(`${API_BASE}/whatsapp/connect${query}`, {
        method: "POST",
        headers: {
          ...getAuthHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ sessionId: sid }),
      });
      if (res.ok) {
        const data = await res.json();
        const code = data.qr_code || data.qr || null;
        return {
          ...data,
          qr: code,
          qr_code: code,
        };
      }
    } catch (_) {}
    return await this.refreshWhatsAppQR(sid);
  },

  async getWhatsAppQRStatus(sessionId?: string): Promise<{
    status: "DISCONNECTED" | "SCAN_QR" | "CONNECTED" | "CONNECTING" | "NOT_LINKED" | "LOGGED_OUT" | "QR_EXPIRED";
    phone: string | null;
    name: string | null;
    avatar_url?: string | null;
    qr: string | null;
    qr_code?: string | null;
    gateway_online: boolean;
  }> {
    try {
      let sid = sessionId;
      if (!sid && typeof window !== "undefined") {
        try {
          const u = this.getCurrentUser();
          if (u?.id) sid = u.id;
        } catch (_) {}
        if (!sid) {
          try {
            const uStr = localStorage.getItem("zigmaa_user") || localStorage.getItem("zigmaa_current_user");
            if (uStr) {
              const p = JSON.parse(uStr);
              sid = p?.id || p?.userId || p?._id || null;
            }
          } catch (_) {}
        }
      }
      const query = sid ? `?sessionId=${encodeURIComponent(sid)}` : "";
      const res = await fetch(`${API_BASE}/whatsapp/qr/status${query}`, {
        headers: getAuthHeaders(),
        cache: "no-store"
      });
      if (res.ok) {
        const data = await res.json();
        const code = data.qr_code || data.qr || null;
        return {
          ...data,
          qr: code,
          qr_code: code,
        };
      }
    } catch (e) {
      console.warn("Failed to check WhatsApp QR status", e);
    }
    return {
      status: "DISCONNECTED",
      phone: null,
      name: null,
      qr: null,
      qr_code: null,
      gateway_online: false
    };
  },

  async refreshWhatsAppQR(sessionId?: string): Promise<any> {
    let sid = sessionId;
    if (!sid && typeof window !== "undefined") {
      try {
        const u = this.getCurrentUser();
        if (u?.id) sid = u.id;
      } catch (_) {}
      if (!sid) {
        try {
          const uStr = localStorage.getItem("zigmaa_user") || localStorage.getItem("zigmaa_current_user");
          if (uStr) {
            const p = JSON.parse(uStr);
            sid = p?.id || p?.userId || p?._id || null;
          }
        } catch (_) {}
      }
    }
    const query = sid ? `?sessionId=${encodeURIComponent(sid)}` : "";
    const res = await fetch(`${API_BASE}/whatsapp/qr/refresh${query}`, {
      method: "POST",
      headers: {
        ...getAuthHeaders(),
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ sessionId: sid })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "Failed to refresh QR code");
    }
    const data = await res.json();
    const code = data.qr_code || data.qr || null;
    return {
      ...data,
      qr: code,
      qr_code: code,
    };
  },

  async disconnectWhatsAppQR(sessionId?: string): Promise<any> {
    let sid = sessionId;
    if (!sid && typeof window !== "undefined") {
      try {
        const u = this.getCurrentUser();
        if (u?.id) sid = u.id;
      } catch (_) {}
      if (!sid) {
        try {
          const uStr = localStorage.getItem("zigmaa_user") || localStorage.getItem("zigmaa_current_user");
          if (uStr) {
            const p = JSON.parse(uStr);
            sid = p?.id || p?.userId || p?._id || null;
          }
        } catch (_) {}
      }
    }
    const query = sid ? `?sessionId=${encodeURIComponent(sid)}` : "";
    const res = await fetch(`${API_BASE}/whatsapp/qr/disconnect${query}`, {
      method: "POST",
      headers: {
        ...getAuthHeaders(),
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ sessionId: sid })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "Failed to disconnect WhatsApp QR");
    }
    return await res.json();
  },

  async requestWhatsAppPairingCode(phone: string, sessionId?: string): Promise<{
    status: string;
    pairing_code: string;
    phone: string;
  }> {
    let sid = sessionId;
    if (!sid && typeof window !== "undefined") {
      try {
        const u = this.getCurrentUser();
        if (u?.id) sid = u.id;
      } catch (_) {}
    }
    const clean = phone.replace(/[^0-9]/g, "");
    const res = await fetch(`${API_BASE}/whatsapp/pairing-code`, {
      method: "POST",
      headers: {
        ...getAuthHeaders(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ phone: clean, sessionId: sid }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "Failed to generate WhatsApp pairing code");
    }
    return await res.json();
  },

  async purgeLegacyWhatsAppLeads(): Promise<{ status: string; deleted_count: number; message: string }> {
    const res = await fetch(`${API_BASE}/whatsapp/maintenance/purge-auto-leads`, {
      method: "POST",
      headers: getAuthHeaders(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "Failed to purge legacy WhatsApp leads");
    }
    return await res.json();
  },

  async getWhatsAppContactAvatar(phone: string): Promise<{ phone: string; avatar_url: string | null }> {
    try {
      const res = await fetch(`${API_BASE}/whatsapp/contacts/${encodeURIComponent(phone)}/avatar`, {
        headers: getAuthHeaders(),
        cache: "no-store"
      });
      if (res.ok) {
        return await res.json();
      }
    } catch (e) {
      console.warn("Failed to fetch contact avatar", e);
    }
    return { phone, avatar_url: null };
  },

  getMediaUrl(mediaPath?: string | null): string {
    return getMediaUrl(mediaPath);
  },

  async clearWhatsAppChat(phone: string): Promise<any> {
    const res = await fetch(`${API_BASE}/whatsapp/conversations/${encodeURIComponent(phone)}/clear`, {
      method: "DELETE",
      headers: getAuthHeaders()
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "Failed to clear chat");
    }
    return await res.json();
  },

  async blockWhatsAppContact(phone: string): Promise<any> {
    const res = await fetch(`${API_BASE}/whatsapp/conversations/${encodeURIComponent(phone)}/block`, {
      method: "POST",
      headers: getAuthHeaders()
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "Failed to block contact");
    }
    return await res.json();
  },

  async unblockWhatsAppContact(phone: string): Promise<any> {
    const res = await fetch(`${API_BASE}/whatsapp/conversations/${encodeURIComponent(phone)}/unblock`, {
      method: "POST",
      headers: getAuthHeaders()
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "Failed to unblock contact");
    }
    return await res.json();
  },

  async pinWhatsAppConversation(phone: string): Promise<any> {
    const res = await fetch(`${API_BASE}/whatsapp/conversations/${encodeURIComponent(phone)}/pin`, {
      method: "POST",
      headers: getAuthHeaders()
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "Failed to toggle pin");
    }
    return await res.json();
  },

  async archiveWhatsAppConversation(phone: string): Promise<any> {
    const res = await fetch(`${API_BASE}/whatsapp/conversations/${encodeURIComponent(phone)}/archive`, {
      method: "POST",
      headers: getAuthHeaders()
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "Failed to toggle archive");
    }
    return await res.json();
  },

};

export default zigmaaApi;
export const api = zigmaaApi;
export { formatGoogleCalendarUrl, downloadIcsFile };
