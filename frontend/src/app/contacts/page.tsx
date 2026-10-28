"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import {
  UserCheck,
  Plus,
  Search,
  Phone,
  Mail,
  MessageSquare,
  Building2,
  Trash2,
  X,
  CheckSquare,
  Square,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Tag,
  Handshake,
  User,
  Sliders,
  MoreVertical,
  MoreHorizontal,
  Edit2,
  Upload,
  Menu,
  ArrowUp,
  ArrowDown
} from "lucide-react";
import Sidebar from "@/components/layout/Sidebar";
import Header from "@/components/layout/Header";
import ContactSlideDrawer from "@/components/contacts/ContactSlideDrawer";
import NewContactDrawer from "@/components/contacts/NewContactDrawer";
import BulkUploadContactsModal from "@/components/contacts/BulkUploadContactsModal";
import ManageCustomFieldsModal from "@/components/common/ManageCustomFieldsModal";
import MoreViewsDropdown from "@/components/common/MoreViewsDropdown";
import FilterSelect from "@/components/common/FilterSelect";
import CallDialerModal from "@/components/common/CallDialerModal";
import { api } from "@/lib/api";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Contact, Deal } from "@/lib/mockData";
import Link from "next/link";
import { useToast } from "@/components/common/ToastProvider";
import ColumnCustomizerPopover, { ColumnDefinition, useColumnVisibility } from "@/components/common/ColumnCustomizerPopover";
import { SourceBadge } from "@/components/common/SourceBadge";
import CustomDropdown from "@/components/common/CustomDropdown";
import WhatsAppIcon from "@/components/common/WhatsAppIcon";

const CONTACT_COLUMNS: ColumnDefinition[] = [
  { id: "name", label: "Contact Name", locked: true },
  { id: "email", label: "Email" },
  { id: "phone", label: "Phone", locked: true },
  { id: "company", label: "Company" },
  { id: "source", label: "Source" },
  { id: "lifecycleStage", label: "Lifecycle Stage" },
  { id: "owner", label: "Owner" },
  { id: "actions", label: "Actions", locked: true }
];

const LIFECYCLE_STAGES = [
  "New",
  "Contacted",
  "Interested",
  "Qualified",
  "Customer"
];

const SOURCES = [
  "All Sources",
  "Meta Ads",
  "Google Ads",
  "Website Form",
  "Referral",
  "Cold Outreach",
  "WhatsApp",
  "Instagram",
  "LinkedIn Ads",
  "YouTube",
  "Advertisement",
  "Manual"
];

const CONTACTS_MORE_VIEWS = [
  "Untouched Enquiries (> 24h)",
  "Converted / Won",
  "Junk / Disqualified"
];

export type SmartViewTab =
  | "All Contacts"
  | "My Contacts"
  | "New Leads"
  | "Today's Leads"
  | "Customers"
  | "With Open Deals"
  | "Without Deals"
  | "Untouched Enquiries (> 24h)"
  | "Converted / Won"
  | "Junk / Disqualified"
  | "Recently modified"
  | "Recently created";

export default function ContactsPage() {
  const { toast, confirm } = useToast();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [currentUser, setCurrentUser] = useState<any>(null);

  // Smart Views Tabs system
  const [activeTab, setActiveTab] = useState<SmartViewTab>("All Contacts");
  const [showMoreViewsDropdown, setShowMoreViewsDropdown] = useState(false);
  const [selectedSource, setSelectedSource] = useState<string>("All Sources");
  const [searchQuery, setSearchQuery] = useState("");
  
  // Sleek Slide-Over Drawer for New Contact & Bulk Import Modal
  const [showAddDrawer, setShowAddDrawer] = useState(false);
  const [showBulkUpload, setShowBulkUpload] = useState(false);
  const [showContactDropdown, setShowContactDropdown] = useState(false);
  
  const [pageSize, setPageSize] = useState(20);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<number | string>>(new Set());
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [openDrawerInEditMode, setOpenDrawerInEditMode] = useState(false);
  const [showCustomFields, setShowCustomFields] = useState(false);
  const [customFields, setCustomFields] = useState<any[]>([]);

  // Active action menu row ID for 3-dots
  const [activeActionMenuId, setActiveActionMenuId] = useState<number | string | null>(null);

  // Column Sorting state (Asc / Desc popup triggered by the 3-horizontal lines menu button)
  const [sortField, setSortField] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [activeSortMenuColumn, setActiveSortMenuColumn] = useState<string | null>(null);

  // Quick Deal Drawer/Modal State
  const [dealModalContact, setDealModalContact] = useState<Contact | null>(null);
  const [dealTitle, setDealTitle] = useState("");
  const [dealValue, setDealValue] = useState("");
  const [dealStage, setDealStage] = useState("Discovery");
  const [savingDeal, setSavingDeal] = useState(false);
  const [deals, setDeals] = useState<Deal[]>([]);

  const dynamicContactColumns = useMemo(() => {
    return customFields.map((cf) => ({
      id: cf.key || cf.field_key,
      label: cf.label,
      isCustom: true
    }));
  }, [customFields]);

  // Column Visibility State persisted in localStorage
  const {
    visibleColumns,
    toggleColumn,
    resetColumns
  } = useColumnVisibility("zigmaa_contacts_columns", CONTACT_COLUMNS, dynamicContactColumns);

  // In-App Phone Call Dialer Modal
  const [callModalContact, setCallModalContact] = useState<Contact | null>(null);

  const loadContacts = async (forceRefresh = false) => {
    try {
      const data = await api.getContacts(forceRefresh);
      setContacts(data || []);
    } catch (e) {
      console.error(e);
    }
  };

  const loadDeals = async () => {
    try {
      const d = await api.getDeals();
      setDeals(d || []);
    } catch {}
  };

  const handleCustomFieldsLoaded = useCallback((cfs: any[]) => {
    setCustomFields((prev) => {
      if (
        prev.length === cfs.length &&
        prev.every((p, i) => (p.key || p.id) === (cfs[i]?.key || cfs[i]?.id))
      ) {
        return prev;
      }
      return cfs;
    });
  }, []);

  const loadCustomFields = async () => {
    try {
      const cfs = await api.getCustomFields("CONTACT");
      handleCustomFieldsLoaded(cfs || []);
    } catch {}
  };

  useEffect(() => {
    loadContacts();
    loadDeals();
    loadCustomFields();
    try {
      const u = api.getCurrentUser();
      if (u) setCurrentUser(u);
    } catch {}

    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const q = params.get("search");
      if (q) {
        setSearchQuery(q);
      }
      if (params.get("new") === "true" || params.get("add") === "true") {
        setShowAddDrawer(true);
      }
    }
  }, []);

  const handleCreateContact = async (contactData: Partial<Contact>) => {
    // 1. Duplicate check on mobile number
    const rawInputPhone = contactData.phone || "";
    const cleanInputDigits = rawInputPhone.replace(/\D/g, "");
    if (cleanInputDigits.length >= 7) {
      const suffix = cleanInputDigits.slice(-10);
      const dup = contacts.find((c) => {
        const p = (c.phone || "").replace(/\D/g, "");
        return p.endsWith(suffix) || suffix.endsWith(p.slice(-10));
      });
      if (dup) {
        toast.warning(
          "Duplicate Mobile Number",
          `A contact with mobile number "${contactData.phone}" already exists: "${dup.name || (dup as any).full_name}".`
        );
        throw new Error(`A contact with mobile number "${contactData.phone}" already exists: "${dup.name || (dup as any).full_name}".`);
      }
    }

    // 2. Duplicate check on email
    const cleanInputEmail = (contactData.email || "").trim().toLowerCase();
    if (cleanInputEmail) {
      const dup = contacts.find((c) => (c.email || "").trim().toLowerCase() === cleanInputEmail);
      if (dup) {
        toast.warning(
          "Duplicate Email",
          `A contact with email "${contactData.email}" already exists: "${dup.name || (dup as any).full_name}".`
        );
        throw new Error(`A contact with email "${contactData.email}" already exists: "${dup.name || (dup as any).full_name}".`);
      }
    }

    const tempId = `temp-${Date.now()}`;
    const optimisticContact: Contact = {
      id: tempId,
      name: contactData.name || "New Contact",
      email: contactData.email || "",
      phone: contactData.phone || "",
      company_name: contactData.company_name || "",
      designation: contactData.designation || "",
      status: contactData.status || "Lead",
      lifecycle_stage: contactData.lifecycle_stage || "Lead",
      source: contactData.source || "Direct",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...contactData,
    } as Contact;

    // 1. Optimistically insert into state & close drawer immediately
    setContacts((prev) => [optimisticContact, ...prev]);
    setShowAddDrawer(false);
    toast.success("Contact Created", `${contactData.name || "Contact"} added.`);

    // 2. Perform network request in background
    try {
      const created = await api.createContact(contactData);
      if (created && created.id) {
        setContacts((prev) =>
          prev.map((c) => (c.id === tempId ? { ...c, ...created } : c))
        );
      }
    } catch (err: any) {
      // Rollback on failure
      setContacts((prev) => prev.filter((c) => c.id !== tempId));
      toast.error("Failed to Save", err.message || "Could not save contact. Reverted.");
    }
  };

  const handleDelete = async (id: number | string) => {
    const contact = contacts.find((c) => String(c.id) === String(id));
    const confirmed = await confirm({
      title: "Delete Contact",
      message: `Are you sure you want to delete ${contact ? `"${contact.name}"` : "this contact"}?`,
      confirmText: "Delete",
      cancelText: "Cancel",
      variant: "danger"
    });

    if (confirmed) {
      const previousContacts = contacts;
      // Optimistic removal
      setContacts((prev) => prev.filter((c) => String(c.id) !== String(id)));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      toast.success("Contact Deleted", "The contact record was deleted.");

      try {
        await api.deleteContact(id);
      } catch (err: any) {
        // Rollback
        setContacts(previousContacts);
        toast.error("Delete Failed", err.message || "Failed to delete contact from server.");
      }
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    const count = selectedIds.size;
    const confirmed = await confirm({
      title: `Delete ${count} Contacts`,
      message: `Are you sure you want to delete ${count} selected contacts? This action cannot be undone.`,
      confirmText: `Delete ${count} Contacts`,
      cancelText: "Cancel",
      variant: "danger"
    });

    if (confirmed) {
      const previousContacts = contacts;
      const idsToDelete = Array.from(selectedIds);
      // Optimistic bulk removal
      setContacts((prev) => prev.filter((c) => !selectedIds.has(c.id)));
      setSelectedIds(new Set());
      toast.success("Contacts Deleted", `${count} contacts deleted.`);

      try {
        await api.bulkDeleteContacts(idsToDelete);
      } catch (err: any) {
        setContacts(previousContacts);
        toast.error("Delete Failed", err.message || "Could not delete contacts. Reverted.");
      }
    }
  };

  const handleStageChange = async (contactId: number | string, newStatus: string) => {
    const previous = contacts.find((c) => String(c.id) === String(contactId));
    // Optimistic status update
    setContacts((prev) =>
      prev.map((c) =>
        String(c.id) === String(contactId)
          ? { ...c, status: newStatus as any, lifecycle_stage: newStatus as any }
          : c
      )
    );
    toast.info("Status Changed", `Contact status updated to "${newStatus}"`);
    try {
      await api.updateContact(contactId, {
        status: newStatus,
        lifecycle_stage: newStatus
      });
    } catch (err: any) {
      if (previous) {
        setContacts((prev) =>
          prev.map((c) => (String(c.id) === String(contactId) ? previous : c))
        );
      }
      toast.error("Update Failed", "Could not update status. Reverted.");
    }
  };

  const getContactDeals = useCallback((contact: Contact) => {
    return deals.filter(d => 
      (d.contact_id && String(d.contact_id) === String(contact.id)) ||
      (contact.name && d.contact_name && d.contact_name.toLowerCase().trim() === contact.name.toLowerCase().trim()) ||
      (contact.company_name && d.company_name && d.company_name.toLowerCase().trim() === contact.company_name.toLowerCase().trim())
    );
  }, [deals]);

  const handleOpenDealModal = (contact: Contact) => {
    setDealModalContact(contact);
    setDealTitle(`${contact.company_name || contact.name} - Deal`);
    setDealValue("");
    setDealStage("Discovery");
  };

  const handleSaveDealModal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dealModalContact || !dealTitle.trim() || !dealValue) {
      toast.warning("Validation", "Please provide a deal title and amount.");
      return;
    }

    setSavingDeal(true);
    try {
      const createdDeal = await api.createDeal({
        title: dealTitle.trim(),
        company_name: dealModalContact.company_name || dealModalContact.name,
        contact_name: dealModalContact.name,
        contact_phone: dealModalContact.phone,
        contact_email: dealModalContact.email,
        contact_id: dealModalContact.id,
        value: Number(dealValue) || 0,
        deal_value: Number(dealValue) || 0,
        stage: dealStage,
        probability: dealStage === "Won" ? 100 : 50,
        close_date: new Date(Date.now() + 14 * 86400000).toISOString().split("T")[0]
      });

      // Automatically advance contact's lifecycle stage to reflect the deal conversion
      const targetLifecycle = dealStage === "Won" ? "Customer" : "Qualified";

      // 1. Optimistic update of local contacts state for instant UI conversion feedback
      setContacts((prev) =>
        prev.map((c) =>
          String(c.id) === String(dealModalContact.id)
            ? {
                ...c,
                lifecycle_stage: targetLifecycle,
                status: targetLifecycle,
                total_deals: (c.total_deals || 0) + 1,
                deals: [createdDeal, ...(c.deals || [])],
                custom_data: {
                  ...(c.custom_data || {}),
                  has_open_deal: true,
                  latest_deal_id: createdDeal.id,
                  latest_deal_title: dealTitle.trim(),
                  latest_deal_stage: dealStage
                }
              }
            : c
        )
      );

      // 2. Also update local deals state
      setDeals((prev) => [createdDeal, ...prev.filter(d => String(d.id) !== String(createdDeal.id))]);

      // 3. Persist contact update to backend/storage
      await api.updateContact(dealModalContact.id, {
        lifecycle_stage: targetLifecycle,
        status: targetLifecycle,
        custom_data: {
          has_open_deal: true,
          latest_deal_id: createdDeal.id,
          latest_deal_title: dealTitle.trim(),
          latest_deal_stage: dealStage
        }
      }).catch(() => {});

      toast.success(
        "Deal Created & Converted",
        `"${dealTitle}" added directly to "${dealStage}" stage in Pipeline Deals. Contact converted to "${targetLifecycle}".`
      );
      setDealModalContact(null);
      await loadContacts(true);
      await loadDeals();
    } catch (err: any) {
      toast.error("Error", err.message || "Failed to create deal.");
    } finally {
      setSavingDeal(false);
    }
  };

  const handleExportCsv = () => {
    if (contacts.length === 0) {
      toast.warning("Export Warning", "No contacts available to export.");
      return;
    }
    const headers = ["Name", "Job Title", "Company", "Mobile", "Email", "Source", "Lifecycle Stage", "Owner"];
    const rows = contacts.map((c) => [
      `"${c.name}"`,
      `"${c.job_title || ""}"`,
      `"${c.company_name || ""}"`,
      `"${c.phone}"`,
      `"${c.email || ""}"`,
      `"${c.source || "Manual"}"`,
      `"${c.lifecycle_stage || c.status || "New"}"`,
      `"${c.assigned_to || "Mohamed Thoufiq"}"`
    ]);
    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `zigmaa_contacts_${new Date().toISOString().split("T")[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success("Export Complete", `Exported ${contacts.length} contacts.`);
  };


  // Filtered contacts based on Smart Views tabs, Source dropdown, and Search query
  const filteredContacts = useMemo(() => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

    return contacts.filter((c) => {
      const rawStage = c.lifecycle_stage || c.status || "New";
      const stageLower = rawStage.toLowerCase();
      const contactOwner = (c.assigned_to || (c as any).assigned_user_name || "").toLowerCase();
      const currentUserName = (currentUser?.full_name || currentUser?.name || "Mohamed Thoufiq").toLowerCase();

      // 1. Smart Views Tab Filtering
      if (activeTab === "My Contacts") {
        if (!contactOwner.includes(currentUserName) && !currentUserName.includes(contactOwner)) {
          return false;
        }
      } else if (activeTab === "New Leads") {
        if (stageLower !== "new" && stageLower !== "lead") return false;
      } else if (activeTab === "Today's Leads") {
        const createdAtTime = c.created_at ? new Date(c.created_at).getTime() : 0;
        if (createdAtTime < todayStart) return false;
      } else if (activeTab === "Customers") {
        if (stageLower !== "customer" && stageLower !== "won") return false;
      } else if (activeTab === "With Open Deals") {
        const hasDeals = (c.deals && c.deals.length > 0) || (typeof c.total_deals === "number" && c.total_deals > 0);
        if (!hasDeals) return false;
      } else if (activeTab === "Without Deals") {
        const hasDeals = (c.deals && c.deals.length > 0) || (typeof c.total_deals === "number" && c.total_deals > 0);
        if (hasDeals) return false;
      } else if (activeTab === "Untouched Enquiries (> 24h)") {
        const createdAtTime = c.created_at ? new Date(c.created_at).getTime() : 0;
        const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
        const isUntouched = (stageLower === "new" || stageLower === "lead") && createdAtTime > 0 && createdAtTime < oneDayAgo;
        if (!isUntouched) return false;
      } else if (activeTab === "Converted / Won") {
        if (stageLower !== "customer" && stageLower !== "won" && stageLower !== "qualified") return false;
      } else if (activeTab === "Junk / Disqualified") {
        if (stageLower !== "junk" && stageLower !== "lost" && stageLower !== "disqualified" && stageLower !== "archived") return false;
      } else if (activeTab === "Recently created") {
        const createdAtTime = c.created_at ? new Date(c.created_at).getTime() : 0;
        const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        if (createdAtTime < sevenDaysAgo) return false;
      } else if (activeTab === "Recently modified") {
        const updatedTime = c.updated_at ? new Date(c.updated_at).getTime() : (c.created_at ? new Date(c.created_at).getTime() : 0);
        const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;
        if (updatedTime < threeDaysAgo) return false;
      }

      // 2. Source Selector Filtering
      if (selectedSource && selectedSource !== "All Sources") {
        const contactSrc = (c.source || "Manual").toLowerCase().trim();
        const targetSrc = selectedSource.toLowerCase().trim();
        if (targetSrc.includes("meta") && !contactSrc.includes("meta")) return false;
        else if (targetSrc.includes("google") && !contactSrc.includes("google")) return false;
        else if (targetSrc.includes("web") && !contactSrc.includes("web")) return false;
        else if (targetSrc.includes("referral") && !contactSrc.includes("referral")) return false;
        else if (targetSrc.includes("cold") && !contactSrc.includes("cold")) return false;
        else if (targetSrc.includes("whatsapp") && !contactSrc.includes("whatsapp")) return false;
        else if (targetSrc.includes("instagram") && !contactSrc.includes("instagram")) return false;
        else if (targetSrc.includes("linkedin") && !contactSrc.includes("linkedin")) return false;
        else if (targetSrc.includes("youtube") && !contactSrc.includes("youtube")) return false;
        else if (targetSrc.includes("advertisement") && !contactSrc.includes("advert")) return false;
        else if (targetSrc.includes("manual") && !contactSrc.includes("manual")) return false;
        else if (!contactSrc.includes(targetSrc) && !targetSrc.includes(contactSrc)) return false;
      }

      // 3. Instant Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          c.name.toLowerCase().includes(q) ||
          c.phone.toLowerCase().includes(q) ||
          (c.email && c.email.toLowerCase().includes(q)) ||
          (c.company_name && c.company_name.toLowerCase().includes(q)) ||
          (c.assigned_to && c.assigned_to.toLowerCase().includes(q))
        );
      }

      return true;
    });
  }, [contacts, activeTab, selectedSource, searchQuery, currentUser]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      (window as any).__ZIGMAA_PAGE_STATE = {
        page: "/contacts",
        activeTab,
        totalRecords: contacts.length,
        visibleCount: filteredContacts.length,
        selectedSource,
        sampleNames: filteredContacts.slice(0, 5).map((c) => c.name).filter(Boolean)
      };
    }
  }, [activeTab, contacts.length, filteredContacts, selectedSource]);

  const toggleSelectAll = () => {
    if (selectedIds.size === paginatedContacts.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(paginatedContacts.map((c) => c.id)));
    }
  };

  const toggleSelectOne = (id: number | string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  // Dynamic available sources based on standard sources + any incoming contact source (e.g. WhatsApp)
  const availableSources = useMemo(() => {
    const list = new Set(["All Sources", "WhatsApp", ...SOURCES.filter((s) => s !== "All Sources")]);
    contacts.forEach((c) => {
      if (c.source) list.add(c.source);
    });
    return Array.from(list);
  }, [contacts]);

  // Sorted contacts based on sortField & sortOrder (Defaults to created_at DESC so newest inbound leads appear at the top)
  const sortedContacts = useMemo(() => {
    if (!sortField) {
      return [...filteredContacts].sort((a, b) => {
        const timeA = a.created_at ? new Date(a.created_at).getTime() : 0;
        const timeB = b.created_at ? new Date(b.created_at).getTime() : 0;
        return timeB - timeA;
      });
    }
    const sorted = [...filteredContacts].sort((a, b) => {
      if (sortField === "created_at") {
        const timeA = a.created_at ? new Date(a.created_at).getTime() : 0;
        const timeB = b.created_at ? new Date(b.created_at).getTime() : 0;
        return sortOrder === "asc" ? timeA - timeB : timeB - timeA;
      }
      let aVal = (a as any)[sortField] ?? "";
      let bVal = (b as any)[sortField] ?? "";
      if (sortField === "lifecycle_stage") {
        aVal = a.lifecycle_stage || a.status || "";
        bVal = b.lifecycle_stage || b.status || "";
      }
      const strA = String(aVal).toLowerCase();
      const strB = String(bVal).toLowerCase();
      if (strA < strB) return sortOrder === "asc" ? -1 : 1;
      if (strA > strB) return sortOrder === "asc" ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [filteredContacts, sortField, sortOrder]);

  const totalPages = Math.ceil(sortedContacts.length / pageSize) || 1;
  const paginatedContacts = sortedContacts.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const startRecordIndex = sortedContacts.length === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const endRecordIndex = Math.min(currentPage * pageSize, sortedContacts.length);

  // Quick stats summary for Twozo-style footer
  const contactsWithDealsCount = useMemo(() => {
    return filteredContacts.filter(
      (c) => (c.deals && c.deals.length > 0) || (typeof c.total_deals === "number" && c.total_deals > 0)
    ).length;
  }, [filteredContacts]);

  const contactsWithoutDealsCount = useMemo(() => {
    return filteredContacts.length - contactsWithDealsCount;
  }, [filteredContacts, contactsWithDealsCount]);

  const untouchedContactsCount = useMemo(() => {
    return filteredContacts.filter((c) => {
      const st = (c.lifecycle_stage || c.status || "").toLowerCase();
      return st === "new" || st === "lead";
    }).length;
  }, [filteredContacts]);

  // Helper for source badge with exact branded icon and pill styling
  const renderSourceBadge = (src?: string) => {
    return <SourceBadge source={src} />;
  };

  return (
    <div className="flex h-screen bg-[#F8FAFC] dark:bg-[#0b0f19] text-slate-900 dark:text-slate-100 font-sans overflow-hidden select-none">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Header />
        <main className="flex-1 flex flex-col min-h-0 bg-[#F8FAFC] dark:bg-[#0b0f19] overflow-hidden p-4 lg:p-6 pb-2">
          {/* Controls: Responsive Row Above Table (Single row on wide screens, wraps cleanly on laptops without clipping) */}
          <div className="flex flex-wrap xl:flex-nowrap items-center justify-between gap-2 pb-2.5 shrink-0">
            {/* Left: Navigation Tabs + More Views (···) */}
            <div className="flex items-center gap-1 sm:gap-1.5 text-xs sm:text-sm shrink-0 overflow-x-auto max-w-full scrollbar-none">
              {(
                [
                  "All Contacts",
                  "My Contacts",
                  "New Leads",
                  "Today's Leads"
                ] as const
              ).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={(e) => {
                    setActiveTab(tab);
                    setCurrentPage(1);
                    e.currentTarget.blur();
                  }}
                  className={`px-2 sm:px-2.5 xl:px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer whitespace-nowrap text-xs xl:text-sm outline-none! focus:outline-none! focus-visible:outline-none! ring-0! focus:ring-0! focus-visible:ring-0! border select-none ${
                    activeTab === tab
                      ? "bg-red-50 text-red-600 font-bold border-red-200/80 shadow-2xs"
                      : "border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                  }`}
                  style={{ outline: "none", boxShadow: activeTab === tab ? undefined : "none" }}
                >
                  {tab}
                </button>
              ))}

              {/* More Views Dropdown (···) */}
              <MoreViewsDropdown
                views={CONTACTS_MORE_VIEWS}
                activeView={activeTab}
                onSelect={(view) => {
                  setActiveTab(view as SmartViewTab);
                  setCurrentPage(1);
                }}
              />
            </div>

            {/* Right Actions: [Search] [Source ▾] [+ Add Contact] [Export] [Columns Popover] */}
            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 flex-wrap sm:flex-nowrap">
              {/* Search Box */}
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search..."
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="pl-8.5 pr-3 h-9 bg-white border border-slate-200 rounded-xl text-xs sm:text-sm font-medium text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500 w-24 sm:w-28 md:w-32 lg:w-36 shadow-2xs transition-all"
                />
              </div>

              {/* Standard FilterSelect Source Dropdown */}
              <FilterSelect
                placeholder="Source"
                value={selectedSource === "All Sources" ? "" : selectedSource}
                options={availableSources.filter((s) => s !== "All Sources")}
                onChange={(val) => {
                  setSelectedSource(val === "ALL" ? "All Sources" : val);
                  setCurrentPage(1);
                }}
                className="shrink-0 [&>button]:h-9 [&>button]:py-0 [&>button]:px-2.5 sm:[&>button]:px-3 [&>button]:text-xs sm:[&>button]:text-sm"
              />

              {/* Add Contact with Split Dropdown */}
              <div className="relative inline-block shrink-0">
                <div className="inline-flex rounded-xl shadow-xs overflow-hidden bg-red-600 hover:bg-red-700 transition-colors h-9">
                  <button
                    type="button"
                    onClick={() => setShowAddDrawer(true)}
                    className="px-3 text-white text-xs sm:text-sm font-semibold cursor-pointer flex items-center gap-1.5 hover:bg-red-700 active:bg-red-800 transition-colors whitespace-nowrap"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Add Contact</span>
                  </button>

                  <div className="w-[1px] bg-red-500/80 my-1 shrink-0" />

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowContactDropdown((prev) => !prev);
                    }}
                    className="px-2 text-white text-xs sm:text-sm font-semibold cursor-pointer flex items-center justify-center hover:bg-red-700 active:bg-red-800 transition-colors"
                    title="More options"
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Dropdown Menu */}
                {showContactDropdown && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setShowContactDropdown(false)}
                    />
                    <div className="absolute right-0 top-full mt-1.5 w-52 bg-white rounded-xl shadow-2xl border border-slate-200 py-1.5 z-50 text-xs animate-in fade-in zoom-in-95 duration-100 text-left">
                      <button
                        type="button"
                        onClick={() => {
                          setShowContactDropdown(false);
                          setShowAddDrawer(true);
                        }}
                        className="w-full px-3.5 py-2 text-slate-700 hover:bg-slate-50 flex items-center gap-2.5 cursor-pointer font-medium text-xs"
                      >
                        <Plus className="w-4 h-4 text-red-600 shrink-0" />
                        <span>Add Single Contact</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowContactDropdown(false);
                          setShowBulkUpload(true);
                        }}
                        className="w-full px-3.5 py-2 text-slate-700 hover:bg-slate-50 flex items-center gap-2.5 cursor-pointer font-medium text-xs"
                      >
                        <Upload className="w-4 h-4 text-emerald-600 shrink-0" />
                        <span>Bulk Import (CSV / Excel)</span>
                      </button>
                    </div>
                  </>
                )}
              </div>

              {/* Export Button */}
              <button
                type="button"
                onClick={handleExportCsv}
                className="h-9 px-2.5 sm:px-3.5 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-xl text-xs sm:text-sm font-semibold shadow-2xs transition-colors cursor-pointer flex items-center justify-center shrink-0 whitespace-nowrap"
              >
                Export
              </button>

              {/* Table Column Customizer Dropdown */}
              <ColumnCustomizerPopover
                storageKey="zigmaa_contacts_columns"
                module="contacts"
                columns={CONTACT_COLUMNS}
                visibleColumns={visibleColumns}
                onToggle={toggleColumn}
                onReset={resetColumns}
                onCustomFieldsLoaded={handleCustomFieldsLoaded}
                onOpenCustomFields={() => setShowCustomFields(true)}
              />
            </div>
          </div>

          {/* TABLE CONTAINER: Stretches full remaining height so footer is strictly anchored at the bottom */}
          <div className="bg-white border border-slate-200/80 rounded-xl shadow-xs flex-1 flex flex-col min-h-0 overflow-hidden">
            {/* Scrollable table body area */}
            <div className="flex-1 overflow-auto custom-scrollbar">
              <table className="w-full border-separate border-spacing-0 text-left text-sm min-w-max">
                <thead className="sticky top-0 z-20 bg-white shadow-[0_1px_0_0_#f1f5f9]">
                  <tr className="bg-white text-[12px] font-medium text-slate-500 tracking-normal capitalize select-none">
                    <th className="py-3.5 px-4 w-14 min-w-[56px] text-center border-b border-r border-slate-200/70 bg-white">
                      <div className="flex items-center justify-center">
                        <button
                          type="button"
                          onClick={toggleSelectAll}
                          className="flex items-center justify-center cursor-pointer text-slate-400 hover:text-slate-600 transition-colors"
                        >
                          {selectedIds.size > 0 && selectedIds.size === paginatedContacts.length ? (
                            <CheckSquare className="w-4 h-4 text-red-600" />
                          ) : (
                            <Square className="w-4 h-4 text-slate-300 hover:text-slate-400" />
                          )}
                        </button>
                      </div>
                    </th>
                    {/* Contact Name Header (Standard Flow) */}
                    {visibleColumns.name !== false && (
                      <th className="py-3.5 px-6 border-b border-r border-slate-200/70 w-[210px] min-w-[210px] bg-white transition-all duration-150">
                        <div className="flex items-center justify-between relative">
                          <span className="font-medium text-slate-700">Contact Name</span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveSortMenuColumn(activeSortMenuColumn === "name" ? null : "name");
                            }}
                            className={`w-6 h-6 rounded-md flex items-center justify-center transition-colors cursor-pointer ${
                              sortField === "name" ? "bg-red-50 text-red-600" : "text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                            }`}
                            title="Sort Contact Name"
                          >
                            <Menu className="w-3.5 h-3.5" />
                          </button>

                          {/* Asc / Desc Popover Menu */}
                          {activeSortMenuColumn === "name" && (
                            <>
                              <div
                                className="fixed inset-0 z-30"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setActiveSortMenuColumn(null);
                                }}
                              />
                              <div className="absolute left-0 top-full mt-1 w-32 bg-white rounded-xl shadow-xl border border-slate-200 py-1 z-40 text-xs animate-in fade-in zoom-in-95 duration-100 font-normal text-slate-700">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSortField("name");
                                    setSortOrder("asc");
                                    setActiveSortMenuColumn(null);
                                  }}
                                  className={`w-full px-3 py-1.5 flex items-center gap-2 hover:bg-slate-50 cursor-pointer ${
                                    sortField === "name" && sortOrder === "asc" ? "text-red-600 font-bold bg-red-50/50" : ""
                                  }`}
                                >
                                  <ArrowUp className="w-3.5 h-3.5 text-slate-500" />
                                  <span>Asc</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSortField("name");
                                    setSortOrder("desc");
                                    setActiveSortMenuColumn(null);
                                  }}
                                  className={`w-full px-3 py-1.5 flex items-center gap-2 hover:bg-slate-50 cursor-pointer ${
                                    sortField === "name" && sortOrder === "desc" ? "text-red-600 font-bold bg-red-50/50" : ""
                                  }`}
                                >
                                  <ArrowDown className="w-3.5 h-3.5 text-slate-500" />
                                  <span>Desc</span>
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      </th>
                    )}

                    {/* Email Header */}
                    {visibleColumns.email !== false && (
                      <th className="py-3.5 px-6 border-b border-r border-slate-200/70 w-[210px] min-w-[210px] bg-white transition-all duration-150">
                        <div className="flex items-center justify-between relative">
                          <span className="font-medium text-slate-700">Email</span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveSortMenuColumn(activeSortMenuColumn === "email" ? null : "email");
                            }}
                            className={`w-6 h-6 rounded-md flex items-center justify-center transition-colors cursor-pointer ${
                              sortField === "email" ? "bg-red-50 text-red-600" : "text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                            }`}
                            title="Sort Email"
                          >
                            <Menu className="w-3.5 h-3.5" />
                          </button>

                          {activeSortMenuColumn === "email" && (
                            <>
                              <div
                                className="fixed inset-0 z-30"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setActiveSortMenuColumn(null);
                                }}
                              />
                              <div className="absolute right-0 top-full mt-1 w-32 bg-white rounded-xl shadow-xl border border-slate-200 py-1 z-40 text-xs animate-in fade-in zoom-in-95 duration-100 font-normal text-slate-700">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSortField("email");
                                    setSortOrder("asc");
                                    setActiveSortMenuColumn(null);
                                  }}
                                  className={`w-full px-3 py-1.5 flex items-center gap-2 hover:bg-slate-50 cursor-pointer ${
                                    sortField === "email" && sortOrder === "asc" ? "text-red-600 font-bold bg-red-50/50" : ""
                                  }`}
                                >
                                  <ArrowUp className="w-3.5 h-3.5 text-slate-500" />
                                  <span>Asc</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSortField("email");
                                    setSortOrder("desc");
                                    setActiveSortMenuColumn(null);
                                  }}
                                  className={`w-full px-3 py-1.5 flex items-center gap-2 hover:bg-slate-50 cursor-pointer ${
                                    sortField === "email" && sortOrder === "desc" ? "text-red-600 font-bold bg-red-50/50" : ""
                                  }`}
                                >
                                  <ArrowDown className="w-3.5 h-3.5 text-slate-500" />
                                  <span>Desc</span>
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      </th>
                    )}

                    {/* Phone Header */}
                    {visibleColumns.phone !== false && (
                      <th className="py-3.5 px-6 border-b border-r border-slate-200/70 w-[210px] min-w-[210px] bg-white transition-all duration-150">
                        <div className="flex items-center justify-between relative">
                          <span className="font-medium text-slate-700">Phone</span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveSortMenuColumn(activeSortMenuColumn === "phone" ? null : "phone");
                            }}
                            className={`w-6 h-6 rounded-md flex items-center justify-center transition-colors cursor-pointer ${
                              sortField === "phone" ? "bg-red-50 text-red-600" : "text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                            }`}
                            title="Sort Phone"
                          >
                            <Menu className="w-3.5 h-3.5" />
                          </button>

                          {activeSortMenuColumn === "phone" && (
                            <>
                              <div
                                className="fixed inset-0 z-30"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setActiveSortMenuColumn(null);
                                }}
                              />
                              <div className="absolute right-0 top-full mt-1 w-32 bg-white rounded-xl shadow-xl border border-slate-200 py-1 z-40 text-xs animate-in fade-in zoom-in-95 duration-100 font-normal text-slate-700">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSortField("phone");
                                    setSortOrder("asc");
                                    setActiveSortMenuColumn(null);
                                  }}
                                  className={`w-full px-3 py-1.5 flex items-center gap-2 hover:bg-slate-50 cursor-pointer ${
                                    sortField === "phone" && sortOrder === "asc" ? "text-red-600 font-bold bg-red-50/50" : ""
                                  }`}
                                >
                                  <ArrowUp className="w-3.5 h-3.5 text-slate-500" />
                                  <span>Asc</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSortField("phone");
                                    setSortOrder("desc");
                                    setActiveSortMenuColumn(null);
                                  }}
                                  className={`w-full px-3 py-1.5 flex items-center gap-2 hover:bg-slate-50 cursor-pointer ${
                                    sortField === "phone" && sortOrder === "desc" ? "text-red-600 font-bold bg-red-50/50" : ""
                                  }`}
                                >
                                  <ArrowDown className="w-3.5 h-3.5 text-slate-500" />
                                  <span>Desc</span>
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      </th>
                    )}

                    {/* Company Header */}
                    {visibleColumns.company !== false && (
                      <th className="py-3.5 px-6 border-b border-r border-slate-200/70 w-[210px] min-w-[210px] bg-white transition-all duration-150">
                        <div className="flex items-center justify-between relative">
                          <span className="font-medium text-slate-700">Company</span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveSortMenuColumn(activeSortMenuColumn === "company_name" ? null : "company_name");
                            }}
                            className={`w-6 h-6 rounded-md flex items-center justify-center transition-colors cursor-pointer ${
                              sortField === "company_name" ? "bg-red-50 text-red-600" : "text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                            }`}
                            title="Sort Company"
                          >
                            <Menu className="w-3.5 h-3.5" />
                          </button>

                          {activeSortMenuColumn === "company_name" && (
                            <>
                              <div
                                className="fixed inset-0 z-30"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setActiveSortMenuColumn(null);
                                }}
                              />
                              <div className="absolute right-0 top-full mt-1 w-32 bg-white rounded-xl shadow-xl border border-slate-200 py-1 z-40 text-xs animate-in fade-in zoom-in-95 duration-100 font-normal text-slate-700">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSortField("company_name");
                                    setSortOrder("asc");
                                    setActiveSortMenuColumn(null);
                                  }}
                                  className={`w-full px-3 py-1.5 flex items-center gap-2 hover:bg-slate-50 cursor-pointer ${
                                    sortField === "company_name" && sortOrder === "asc" ? "text-red-600 font-bold bg-red-50/50" : ""
                                  }`}
                                >
                                  <ArrowUp className="w-3.5 h-3.5 text-slate-500" />
                                  <span>Asc</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSortField("company_name");
                                    setSortOrder("desc");
                                    setActiveSortMenuColumn(null);
                                  }}
                                  className={`w-full px-3 py-1.5 flex items-center gap-2 hover:bg-slate-50 cursor-pointer ${
                                    sortField === "company_name" && sortOrder === "desc" ? "text-red-600 font-bold bg-red-50/50" : ""
                                  }`}
                                >
                                  <ArrowDown className="w-3.5 h-3.5 text-slate-500" />
                                  <span>Desc</span>
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      </th>
                    )}

                    {/* Source Header */}
                    {visibleColumns.source !== false && (
                      <th className="py-3.5 px-6 border-b border-r border-slate-200/70 w-[210px] min-w-[210px] bg-white transition-all duration-150">
                        <div className="flex items-center justify-between relative">
                          <span className="font-medium text-slate-700">Source</span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveSortMenuColumn(activeSortMenuColumn === "source" ? null : "source");
                            }}
                            className={`w-6 h-6 rounded-md flex items-center justify-center transition-colors cursor-pointer ${
                              sortField === "source" ? "bg-red-50 text-red-600" : "text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                            }`}
                            title="Sort Source"
                          >
                            <Menu className="w-3.5 h-3.5" />
                          </button>

                          {activeSortMenuColumn === "source" && (
                            <>
                              <div
                                className="fixed inset-0 z-30"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setActiveSortMenuColumn(null);
                                }}
                              />
                              <div className="absolute right-0 top-full mt-1 w-32 bg-white rounded-xl shadow-xl border border-slate-200 py-1 z-40 text-xs animate-in fade-in zoom-in-95 duration-100 font-normal text-slate-700">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSortField("source");
                                    setSortOrder("asc");
                                    setActiveSortMenuColumn(null);
                                  }}
                                  className={`w-full px-3 py-1.5 flex items-center gap-2 hover:bg-slate-50 cursor-pointer ${
                                    sortField === "source" && sortOrder === "asc" ? "text-red-600 font-bold bg-red-50/50" : ""
                                  }`}
                                >
                                  <ArrowUp className="w-3.5 h-3.5 text-slate-500" />
                                  <span>Asc</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSortField("source");
                                    setSortOrder("desc");
                                    setActiveSortMenuColumn(null);
                                  }}
                                  className={`w-full px-3 py-1.5 flex items-center gap-2 hover:bg-slate-50 cursor-pointer ${
                                    sortField === "source" && sortOrder === "desc" ? "text-red-600 font-bold bg-red-50/50" : ""
                                  }`}
                                >
                                  <ArrowDown className="w-3.5 h-3.5 text-slate-500" />
                                  <span>Desc</span>
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      </th>
                    )}

                    {/* Lifecycle Stage Header */}
                    {visibleColumns.lifecycleStage !== false && (
                      <th className="py-3.5 px-6 border-b border-r border-slate-200/70 w-[210px] min-w-[210px] bg-white transition-all duration-150">
                        <div className="flex items-center justify-between relative">
                          <span className="font-medium text-slate-700">Lifecycle Stage</span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveSortMenuColumn(activeSortMenuColumn === "lifecycle_stage" ? null : "lifecycle_stage");
                            }}
                            className={`w-6 h-6 rounded-md flex items-center justify-center transition-colors cursor-pointer ${
                              sortField === "lifecycle_stage" ? "bg-red-50 text-red-600" : "text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                            }`}
                            title="Sort Stage"
                          >
                            <Menu className="w-3.5 h-3.5" />
                          </button>

                          {activeSortMenuColumn === "lifecycle_stage" && (
                            <>
                              <div
                                className="fixed inset-0 z-30"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setActiveSortMenuColumn(null);
                                }}
                              />
                              <div className="absolute right-0 top-full mt-1 w-32 bg-white rounded-xl shadow-xl border border-slate-200 py-1 z-40 text-xs animate-in fade-in zoom-in-95 duration-100 font-normal text-slate-700">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSortField("lifecycle_stage");
                                    setSortOrder("asc");
                                    setActiveSortMenuColumn(null);
                                  }}
                                  className={`w-full px-3 py-1.5 flex items-center gap-2 hover:bg-slate-50 cursor-pointer ${
                                    sortField === "lifecycle_stage" && sortOrder === "asc" ? "text-red-600 font-bold bg-red-50/50" : ""
                                  }`}
                                >
                                  <ArrowUp className="w-3.5 h-3.5 text-slate-500" />
                                  <span>Asc</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSortField("lifecycle_stage");
                                    setSortOrder("desc");
                                    setActiveSortMenuColumn(null);
                                  }}
                                  className={`w-full px-3 py-1.5 flex items-center gap-2 hover:bg-slate-50 cursor-pointer ${
                                    sortField === "lifecycle_stage" && sortOrder === "desc" ? "text-red-600 font-bold bg-red-50/50" : ""
                                  }`}
                                >
                                  <ArrowDown className="w-3.5 h-3.5 text-slate-500" />
                                  <span>Desc</span>
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      </th>
                    )}

                    {/* Owner Header */}
                    {visibleColumns.owner !== false && (
                      <th className="py-3.5 px-6 border-b border-r border-slate-200/70 w-[210px] min-w-[210px] bg-white transition-all duration-150">
                        <div className="flex items-center justify-between relative">
                          <span className="font-medium text-slate-700">Owner</span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveSortMenuColumn(activeSortMenuColumn === "assigned_to" ? null : "assigned_to");
                            }}
                            className={`w-6 h-6 rounded-md flex items-center justify-center transition-colors cursor-pointer ${
                              sortField === "assigned_to" ? "bg-red-50 text-red-600" : "text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                            }`}
                            title="Sort Owner"
                          >
                            <Menu className="w-3.5 h-3.5" />
                          </button>

                          {activeSortMenuColumn === "assigned_to" && (
                            <>
                              <div
                                className="fixed inset-0 z-30"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setActiveSortMenuColumn(null);
                                }}
                              />
                              <div className="absolute right-0 top-full mt-1 w-32 bg-white rounded-xl shadow-xl border border-slate-200 py-1 z-40 text-xs animate-in fade-in zoom-in-95 duration-100 font-normal text-slate-700">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSortField("assigned_to");
                                    setSortOrder("asc");
                                    setActiveSortMenuColumn(null);
                                  }}
                                  className={`w-full px-3 py-1.5 flex items-center gap-2 hover:bg-slate-50 cursor-pointer ${
                                    sortField === "assigned_to" && sortOrder === "asc" ? "text-red-600 font-bold bg-red-50/50" : ""
                                  }`}
                                >
                                  <ArrowUp className="w-3.5 h-3.5 text-slate-500" />
                                  <span>Asc</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSortField("assigned_to");
                                    setSortOrder("desc");
                                    setActiveSortMenuColumn(null);
                                  }}
                                  className={`w-full px-3 py-1.5 flex items-center gap-2 hover:bg-slate-50 cursor-pointer ${
                                    sortField === "assigned_to" && sortOrder === "desc" ? "text-red-600 font-bold bg-red-50/50" : ""
                                  }`}
                                >
                                  <ArrowDown className="w-3.5 h-3.5 text-slate-500" />
                                  <span>Desc</span>
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      </th>
                    )}

                    {/* Dynamic Custom Fields */}
                    {customFields.map((cf) => {
                      const colKey = cf.key || cf.field_key;
                      if (!colKey || visibleColumns[colKey] === false) return null;
                      return (
                        <th
                          key={cf.id}
                          className="py-3.5 px-6 border-b border-r border-slate-200/70 w-[210px] min-w-[210px] bg-white transition-all duration-150"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-medium text-slate-700">{cf.label}</span>
                          </div>
                        </th>
                      );
                    })}

                    {/* Actions Header (Standard Flow) */}
                    {visibleColumns.actions !== false && (
                      <th className="py-3.5 px-6 text-right border-b border-slate-100 w-28 min-w-[112px] bg-white transition-all duration-150">Actions</th>
                    )}
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {paginatedContacts.length === 0 ? (
                    <tr>
                      <td
                        colSpan={
                          1 +
                          [
                            visibleColumns.name !== false,
                            visibleColumns.email !== false,
                            visibleColumns.phone !== false,
                            visibleColumns.company !== false,
                            visibleColumns.source !== false,
                            visibleColumns.lifecycleStage !== false,
                            visibleColumns.owner !== false,
                            ...customFields.map((cf) => visibleColumns[cf.key || cf.field_key] !== false),
                            visibleColumns.actions !== false
                          ].filter(Boolean).length
                        }
                        className="py-24 text-center"
                      >
                        <div className="max-w-md mx-auto space-y-1.5">
                          <p className="text-sm font-semibold text-slate-800">No contacts found</p>
                          <p className="text-xs text-slate-400">Inbound enquiries and verified clients will appear in this unified directory.</p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    paginatedContacts.map((contact) => {
                      const isSelected = selectedIds.has(contact.id);
                      const currentStage = contact.lifecycle_stage || contact.status || "New";
                      const isMenuOpen = activeActionMenuId === contact.id;
                      // Clean initials for avatar
                      const initials = (contact.name || "C")
                        .trim()
                        .split(/\s+/)
                        .map((part) => part[0])
                        .slice(0, 2)
                        .join("")
                        .toUpperCase();

                      return (
                        <tr
                          key={contact.id}
                          onClick={() => {
                            setOpenDrawerInEditMode(false);
                            setSelectedContact(contact);
                          }}
                          className={`border-b border-slate-100 hover:bg-slate-50/50 transition-colors cursor-pointer group ${
                            isSelected ? "bg-red-50/30" : ""
                          }`}
                        >
                          {/* Checkbox (Standard Flow) */}
                          <td
                            className="py-4 px-4 w-14 min-w-[56px] text-center border-b border-slate-100 transition-colors"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleSelectOne(contact.id);
                            }}
                          >
                            <div className="flex items-center justify-center">
                              {isSelected ? (
                                <CheckSquare className="w-4 h-4 text-red-600" />
                              ) : (
                                <Square className="w-4 h-4 text-slate-300 group-hover:text-slate-400" />
                              )}
                            </div>
                          </td>

                          {/* Contact Name (Single Column with Initials Circle Avatar + designation/company subtext - Standard Flow) */}
                          {visibleColumns.name !== false && (
                            <td className="py-4 px-6 border-b border-slate-100 w-[210px] min-w-[210px] transition-all duration-150">
                              <div className="flex items-center gap-2.5">
                                <div className="w-7 h-7 rounded-full bg-slate-100 text-slate-700 text-xs font-bold flex items-center justify-center shrink-0 border border-slate-200/80">
                                  {initials || "C"}
                                </div>
                                <div className="min-w-0 flex flex-col">
                                  <span className="font-medium text-slate-800 group-hover:text-red-600 transition-colors text-[13px] truncate">
                                    {contact.name || "—"}
                                  </span>
                                  {contact.designation ? (
                                    <span className="text-[11px] text-slate-400 truncate">
                                      {contact.designation}
                                    </span>
                                  ) : contact.company_name ? (
                                    <span className="text-[11px] text-slate-400 truncate">
                                      {contact.company_name}
                                    </span>
                                  ) : null}
                                </div>
                              </div>
                            </td>
                          )}

                          {/* Email (Clean slate styling, no red) */}
                          {visibleColumns.email !== false && (
                            <td className="py-4 px-6 border-b border-slate-100 w-[210px] min-w-[210px] text-slate-600 text-[12px] transition-all duration-150" onClick={(e) => e.stopPropagation()}>
                              {contact.email ? (
                                <a
                                  href={`mailto:${contact.email}`}
                                  className="font-normal text-slate-600 hover:text-slate-900 hover:underline block truncate"
                                >
                                  {contact.email}
                                </a>
                              ) : (
                                <span className="text-slate-400 font-normal">—</span>
                              )}
                            </td>
                          )}

                          {/* Phones (Strict single line, clean straight alignment) */}
                          {visibleColumns.phone !== false && (
                            <td className="py-4 px-6 border-b border-slate-100 w-[210px] min-w-[210px] text-slate-700 text-[13px] transition-all duration-150" onClick={(e) => e.stopPropagation()}>
                              <div className="flex items-center gap-2 font-sans whitespace-nowrap">
                                {contact.phone ? (
                                  <a
                                    href={`tel:${contact.phone}`}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      api.createActivity({
                                        contact_id: String(contact.id),
                                        type: "CALL",
                                        notes: `Call Clicked: Outbound call triggered for ${contact.name || contact.phone}`,
                                        status: "COMPLETED"
                                      }).catch(() => {});
                                    }}
                                    className="font-mono tracking-tight select-text text-blue-600 hover:text-blue-800 hover:underline cursor-pointer text-left"
                                    title={`Call ${contact.phone}`}
                                  >
                                    {contact.phone}
                                  </a>
                                ) : (
                                  <span className="font-mono tracking-tight text-slate-400 select-text">—</span>
                                )}
                                <div className="flex items-center gap-1 opacity-70 group-hover:opacity-100 transition-opacity">
                                  {contact.phone && (
                                    <a
                                      href={`tel:${contact.phone}`}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        api.createActivity({
                                          contact_id: String(contact.id),
                                          type: "CALL",
                                          notes: `Call Clicked: Outbound call triggered for ${contact.name || contact.phone}`,
                                          status: "COMPLETED"
                                        }).catch(() => {});
                                      }}
                                      className="p-1 rounded text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors cursor-pointer"
                                      title={`Call ${contact.phone}`}
                                    >
                                      <Phone className="w-3.5 h-3.5" />
                                    </a>
                                  )}
                                  {contact.phone && (
                                    <a
                                      href={`https://wa.me/${contact.phone.replace(/[^0-9]/g, "")}`}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="p-1 rounded text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 transition-colors cursor-pointer"
                                      title="Chat on WhatsApp"
                                    >
                                      <WhatsAppIcon className="w-3.5 h-3.5 fill-current text-slate-400 hover:text-emerald-600" />
                                    </a>
                                  )}
                                  {contact.email && (
                                    <a
                                      href={`mailto:${contact.email}`}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        api.createActivity({
                                          contact_id: String(contact.id),
                                          type: "EMAIL",
                                          notes: `Email Clicked: Compose email to ${contact.email}`,
                                          status: "COMPLETED"
                                        }).catch(() => {});
                                      }}
                                      className="p-1 rounded text-slate-400 hover:text-purple-600 hover:bg-purple-50 transition-colors cursor-pointer"
                                      title={`Email ${contact.email}`}
                                    >
                                      <Mail className="w-3.5 h-3.5" />
                                    </a>
                                  )}
                                </div>
                              </div>
                            </td>
                          )}

                          {/* Company */}
                          {visibleColumns.company !== false && (
                            <td className="py-4 px-6 border-b border-slate-100 w-[210px] min-w-[210px] text-[13px] text-slate-600 transition-all duration-150">
                              {contact.company_name ? (
                                <span className="inline-flex items-center gap-1.5 truncate">
                                  <Building2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                  <span className="truncate">{contact.company_name}</span>
                                </span>
                              ) : (
                                <span className="text-slate-400">—</span>
                              )}
                            </td>
                          )}

                          {/* Source Tag */}
                          {visibleColumns.source !== false && (
                            <td className="py-4 px-6 border-b border-slate-100 w-[210px] min-w-[210px] transition-all duration-150">
                              {renderSourceBadge(contact.source)}
                            </td>
                          )}

                          {/* Lifecycle Stage */}
                          {visibleColumns.lifecycleStage !== false && (
                            <td className="py-4 px-6 border-b border-slate-100 w-[210px] min-w-[210px] transition-all duration-150" onClick={(e) => e.stopPropagation()}>
                              <CustomDropdown
                                value={currentStage}
                                options={LIFECYCLE_STAGES}
                                onChange={(newVal) => handleStageChange(contact.id, newVal)}
                                variant="pill"
                              />
                            </td>
                          )}

                          {/* Owner */}
                          {visibleColumns.owner !== false && (
                            <td className="py-4 px-6 border-b border-slate-100 w-[210px] min-w-[210px] transition-all duration-150">
                              <div className="flex items-center gap-2 text-[13px] text-slate-700">
                                <div className="w-5 h-5 rounded-full bg-slate-100 text-slate-600 text-[10px] font-semibold flex items-center justify-center shrink-0 border border-slate-200">
                                  {(contact.assigned_to || "M").substring(0, 1).toUpperCase()}
                                </div>
                                <span className="truncate">{contact.assigned_to || "Mohamed Thoufiq"}</span>
                              </div>
                            </td>
                          )}

                          {/* Dynamic Custom Fields Values */}
                          {customFields.map((cf) => {
                            const colKey = cf.key || cf.field_key;
                            if (!colKey || visibleColumns[colKey] === false) return null;
                            const customProps = (contact as any).custom_properties || (contact as any).custom_data || {};
                            const val = customProps[colKey] ?? customProps[cf.label];

                            return (
                              <td
                                key={cf.id}
                                className="py-4 px-6 border-b border-slate-100 w-[210px] min-w-[210px] text-[13px] text-slate-700 transition-all duration-150"
                              >
                                {val !== undefined && val !== null && String(val).trim() !== "" ? (
                                  typeof val === "boolean" ? (
                                    val ? (
                                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                        Yes
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-600">
                                        No
                                      </span>
                                    )
                                  ) : (
                                    <span className="truncate block max-w-[180px] font-medium text-slate-800">
                                      {String(val)}
                                    </span>
                                  )
                                ) : (
                                  <span className="text-slate-300 font-normal">—</span>
                                )}
                              </td>
                            );
                          })}

                          {/* Actions (Standard Flow) */}
                          {visibleColumns.actions !== false && (() => {
                            const contactDeals = getContactDeals(contact);
                            const hasDeal = contactDeals.length > 0 || (typeof contact.total_deals === "number" && contact.total_deals > 0) || (contact.custom_data && contact.custom_data.has_open_deal);

                            return (
                              <td
                                className="py-4 px-6 border-b border-slate-100 text-right w-28 min-w-[112px] transition-all duration-150"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <div className="flex items-center justify-end gap-1.5 relative">
                                  {hasDeal ? (
                                    <Link
                                      href={`/pipeline?search=${encodeURIComponent(contact.company_name || contact.name)}`}
                                      className="text-emerald-700 bg-emerald-50 border border-emerald-200/90 hover:bg-emerald-100 hover:border-emerald-300 text-[11px] px-2 py-0.5 rounded-lg font-semibold transition-all cursor-pointer flex items-center gap-1 shadow-2xs group/deal"
                                      title={contactDeals[0] ? `View Deal: "${contactDeals[0].title}" (${contactDeals[0].stage})` : "View Deal in Pipeline"}
                                    >
                                      <Handshake className="w-3 h-3 text-emerald-600 group-hover/deal:scale-110 transition-transform" />
                                      <span>{contactDeals.length > 1 ? `${contactDeals.length} Deals` : "Deal Active"}</span>
                                    </Link>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => handleOpenDealModal(contact)}
                                      className="text-red-600 border border-red-200/90 hover:bg-red-50 hover:border-red-300 text-[11px] px-2 py-0.5 rounded-lg font-semibold transition-all cursor-pointer flex items-center gap-1 shadow-2xs"
                                      title="Convert Contact to Deal"
                                    >
                                      <Plus className="w-3 h-3" />
                                      <span>Deal</span>
                                    </button>
                                  )}

                                  {/* Three-dots menu */}
                                  <div className="relative">
                                    <button
                                      type="button"
                                      onClick={() => setActiveActionMenuId(isMenuOpen ? null : contact.id)}
                                      className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                                      title="Options"
                                    >
                                      <MoreVertical className="w-4 h-4" />
                                    </button>

                                    {isMenuOpen && (
                                      <>
                                        <div
                                          className="fixed inset-0 z-30"
                                          onClick={() => setActiveActionMenuId(null)}
                                        />
                                        <div className="absolute right-0 mt-1 w-44 bg-white rounded-xl shadow-xl border border-slate-200 py-1 z-40 text-xs animate-in fade-in zoom-in-95 duration-100 text-left">
                                          {hasDeal && (
                                            <Link
                                              href={`/pipeline?search=${encodeURIComponent(contact.company_name || contact.name)}`}
                                              onClick={() => setActiveActionMenuId(null)}
                                              className="w-full px-3.5 py-2 text-emerald-700 hover:bg-emerald-50/60 flex items-center gap-2 cursor-pointer font-medium"
                                            >
                                              <Handshake className="w-3.5 h-3.5 text-emerald-600" />
                                              <span>View in Pipeline</span>
                                            </Link>
                                          )}
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setActiveActionMenuId(null);
                                              handleOpenDealModal(contact);
                                            }}
                                            className="w-full px-3.5 py-2 text-slate-700 hover:bg-slate-50 flex items-center gap-2 cursor-pointer font-medium"
                                          >
                                            <Plus className="w-3.5 h-3.5 text-slate-400" />
                                            <span>{hasDeal ? "Add Another Deal" : "Create Deal"}</span>
                                          </button>
                                          <div className="my-1 border-t border-slate-100" />
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setActiveActionMenuId(null);
                                              setOpenDrawerInEditMode(false);
                                              setSelectedContact(contact);
                                            }}
                                            className="w-full px-3.5 py-2 text-slate-700 hover:bg-slate-50 flex items-center gap-2 cursor-pointer font-medium"
                                          >
                                            <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
                                            <span>View Details</span>
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setActiveActionMenuId(null);
                                              setOpenDrawerInEditMode(true);
                                              setSelectedContact(contact);
                                            }}
                                            className="w-full px-3.5 py-2 text-slate-700 hover:bg-slate-50 flex items-center gap-2 cursor-pointer font-medium"
                                          >
                                            <Edit2 className="w-3.5 h-3.5 text-red-600" />
                                            <span className="font-semibold text-slate-900">Edit Contact</span>
                                          </button>
                                          <div className="my-1 border-t border-slate-100" />
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setActiveActionMenuId(null);
                                              handleDelete(contact.id);
                                            }}
                                            className="w-full px-3.5 py-2 text-rose-600 hover:bg-rose-50 flex items-center gap-2 cursor-pointer font-medium"
                                          >
                                            <Trash2 className="w-3.5 h-3.5 text-rose-500" />
                                            <span>Delete Contact</span>
                                          </button>
                                        </div>
                                      </>
                                    )}
                                  </div>
                                </div>
                              </td>
                            );
                          })()}
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* CLEAN BOTTOM PAGINATION FOOTER BAR: Docked at the bottom, no clutter */}
            <div className="shrink-0 bg-white border-t border-slate-100 px-5 py-3 flex items-center justify-between text-xs text-slate-600 font-medium flex-wrap gap-4">
              {/* Left: Showing 1-X of Y + Page Chevrons + Bulk Selection Actions */}
              <div className="flex items-center gap-3">
                <span className="text-slate-500 font-normal">
                  Showing <strong className="font-semibold text-slate-700">{startRecordIndex}-{endRecordIndex}</strong> of <strong className="font-semibold text-slate-700">{filteredContacts.length}</strong>
                </span>

                <div className="flex items-center gap-1.5 ml-2">
                  <button
                    type="button"
                    disabled={currentPage <= 1}
                    onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                    className="w-7 h-7 flex items-center justify-center rounded border border-slate-200 hover:bg-slate-50 text-slate-400 hover:text-slate-600 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors"
                    title="Previous Page"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>

                  <div className="w-7 h-7 flex items-center justify-center rounded bg-red-600 text-white font-semibold text-xs shadow-2xs">
                    {currentPage}
                  </div>

                  <button
                    type="button"
                    disabled={currentPage >= totalPages}
                    onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                    className="w-7 h-7 flex items-center justify-center rounded border border-slate-200 hover:bg-slate-50 text-slate-400 hover:text-slate-600 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors"
                    title="Next Page"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Bulk Action Controls */}
                {selectedIds.size > 0 && (
                  <div className="flex items-center gap-2 ml-3 animate-in fade-in duration-150">
                    <span className="text-xs font-semibold text-red-600 bg-red-50 px-2.5 py-1 rounded-full border border-red-200">
                      {selectedIds.size} {selectedIds.size === 1 ? "contact" : "contacts"} selected
                    </span>

                    <button
                      type="button"
                      onClick={handleBulkDelete}
                      className="bg-rose-50 text-rose-600 border border-rose-200 hover:bg-rose-100 font-medium text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5 cursor-pointer transition-colors shadow-2xs"
                      title="Delete Selected Contacts"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-rose-600" />
                      <span>Delete Selected</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setSelectedIds(new Set())}
                      className="text-slate-500 hover:text-slate-700 text-xs px-2 py-1 rounded-md hover:bg-slate-100 transition-colors cursor-pointer font-medium"
                    >
                      Deselect All
                    </button>
                  </div>
                )}
              </div>

              {/* Right: Per Page Select Dropdown with clean spacing */}
              <div className="flex items-center gap-3 pr-2">
                <CustomDropdown
                  value={pageSize}
                  options={[
                    { value: 10, label: "Showing 10 Per Page" },
                    { value: 20, label: "Showing 20 Per Page" },
                    { value: 25, label: "Showing 25 Per Page" },
                    { value: 50, label: "Showing 50 Per Page" },
                    { value: 100, label: "Showing 100 Per Page" }
                  ]}
                  onChange={(val) => {
                    setPageSize(Number(val));
                    setCurrentPage(1);
                  }}
                  variant="minimal"
                  align="right"
                />
              </div>
            </div>
          </div>
        </main>
      </div>

      {/* NEW CONTACT SLIDE-OVER DRAWER */}
      <NewContactDrawer
        isOpen={showAddDrawer}
        onClose={() => setShowAddDrawer(false)}
        onSubmit={handleCreateContact}
        customFields={customFields}
        currentUser={currentUser}
      />

      {/* BULK UPLOAD CONTACTS MODAL */}
      <BulkUploadContactsModal
        isOpen={showBulkUpload}
        onClose={() => setShowBulkUpload(false)}
        onSuccess={() => {
          loadContacts();
        }}
      />

      {/* QUICK CREATE DEAL ACTION DRAWER / POPUP */}
      {dealModalContact && (
        <div className="fixed inset-0 z-60 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full border border-slate-200 overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-red-100 text-red-600 flex items-center justify-center">
                  <Handshake className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-sm">Create Deal</h3>
                  <p className="text-[11px] text-slate-500">For {dealModalContact.name}</p>
                </div>
              </div>
              <button
                onClick={() => setDealModalContact(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveDealModal} className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Deal Title <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={dealTitle}
                  onChange={(e) => setDealTitle(e.target.value)}
                  className="w-full bg-slate-50 text-slate-900 text-xs px-3.5 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-red-500 font-medium"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Deal Value (₹) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    required
                    min={0}
                    placeholder="e.g. 50000"
                    value={dealValue}
                    onChange={(e) => setDealValue(e.target.value)}
                    className="w-full bg-slate-50 text-slate-900 text-xs px-3.5 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-red-500 font-semibold"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Pipeline Stage
                  </label>
                  <CustomDropdown
                    value={dealStage}
                    options={["New Deal", "Discovery", "Proposal Sent", "Negotiation", "Won"]}
                    onChange={(val) => setDealStage(val)}
                    variant="input"
                  />
                </div>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setDealModalContact(null)}
                  className="px-4 py-2 text-xs font-semibold text-slate-500 hover:text-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingDeal}
                  className="px-5 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold shadow-xs cursor-pointer disabled:opacity-50"
                >
                  {savingDeal ? "Saving..." : "Create Deal"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Twozo Style Slide-over Profile Drawer */}
      <ContactSlideDrawer
        contact={selectedContact}
        isOpen={!!selectedContact}
        onClose={() => {
          setSelectedContact(null);
          setOpenDrawerInEditMode(false);
        }}
        onUpdated={loadContacts}
        onOpenCreateDeal={(c) => handleOpenDealModal(c)}
        initialEditMode={openDrawerInEditMode}
      />

      {/* Manage Custom Fields Modal */}
      <ManageCustomFieldsModal
        entityType="CONTACT"
        isOpen={showCustomFields}
        onClose={() => setShowCustomFields(false)}
        onFieldsChanged={() => {
          loadCustomFields();
          loadContacts();
        }}
      />
      {/* IN-APP PHONE CALL DIALER MODAL */}
      {callModalContact && (
        <CallDialerModal
          isOpen={Boolean(callModalContact)}
          onClose={() => setCallModalContact(null)}
          contact={callModalContact}
          onCallLogged={() => loadContacts()}
        />
      )}
    </div>
  );
}
