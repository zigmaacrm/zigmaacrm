export interface Activity {
  id: number | string;
  lead_id?: number | string;
  contact_id?: number | string;
  activity_type: "call" | "note" | "whatsapp" | "email" | "status_change" | "meeting" | string;
  description?: string;
  notes?: string;
  status?: string;
  created_at: string;
}

export interface Lead {
  id: number | string;
  name: string;
  full_name?: string;
  phone: string;
  email?: string;
  company_name?: string;
  ad_source?: "Meta Ads" | "Google Ads" | "Walk-in" | "Referral" | "Website Form" | "LinkedIn" | "Direct" | string;
  stage?: "New Lead" | "Contacted / Follow-up" | "Contacted" | "Qualified" | "Consultation Booked" | "Closed / Won" | "CONVERTED" | "Lost" | string;
  status?: string;
  source?: string;
  deal_value: number;
  notes?: string;
  custom_fields?: Record<string, any>;
  created_at: string;
  updated_at?: string;
  activities?: Activity[];
}

export interface Deal {
  id: number | string;
  title: string;
  company_name: string;
  contact_name: string;
  contact_email?: string;
  contact_phone?: string;
  value: number;
  deal_value?: number;
  currency?: string;
  stage: "New Deal" | "New" | "Discovery" | "Proposal Sent" | "Negotiation" | "Won" | "Lost" | "Qualification" | "Needs Analysis" | "Proposal / Quote" | "Closed Won" | "Closed Lost" | string;
  stage_id?: string;
  probability: number;
  close_date: string;
  expected_close_date?: string;
  created_at: string;
  lead_id?: number | string;
  contact_id?: number | string;
  owner_id?: number | string;
  owner_name?: string;
  assigned_user_id?: number | string;
  status?: string;
  custom_data?: Record<string, any>;
}

export interface Contact {
  id: number | string;
  name: string;
  full_name?: string;
  email: string;
  phone: string;
  company_name: string;
  company?: string;
  job_title?: string;
  designation?: string;
  status?: "New" | "Contacted" | "Interested" | "Qualified" | "Customer" | "Active" | "Lead" | string;
  lifecycle_stage?: "New" | "Contacted" | "Interested" | "Qualified" | "Customer" | string;
  source?: "Meta Ads" | "Google Ads" | "Website" | "Manual" | string;
  assigned_to?: string;
  total_deals?: number;
  lifetime_value?: number;
  created_at: string;
  updated_at?: string;
  custom_data?: Record<string, any>;
  deals?: any[];
  activities?: any[];
}

export interface Account {
  id: number | string;
  name: string;
  industry?: string;
  phone?: string;
  website?: string;
  city?: string;
  annual_revenue?: number;
  created_at: string;
}

export interface Task {
  id: number | string;
  title: string;
  activity_type?: "Call" | "WhatsApp" | "Email" | "Meeting" | "To-Do" | string;
  due_date: string;
  due_time?: string;
  priority: "High" | "Medium" | "Low" | "Urgent" | string;
  status: "To Do" | "In Progress" | "Completed" | "PENDING" | "COMPLETED" | string;
  assigned_to?: string;
  owner_id?: number | string;
  owner_name?: string;
  description?: string;
  contact_id?: number | string;
  contact_name?: string;
  contact_phone?: string;
  contact_company?: string;
  related_to?: string;
  created_at: string;
}

export interface CalendarEvent {
  id: number | string;
  title: string;
  description?: string;
  notes?: string;
  start_time: string;
  end_time?: string;
  location?: string;
  meeting_link?: string;
  attendee_name?: string;
  attendee_email?: string;
  attendee_phone?: string;
  contact_id?: number | string;
  event_type?: "Product Demo" | "Discovery Call" | "Follow-up" | "Closing Meeting" | "Meeting" | "Call" | "Demo" | "Consultation" | string;
  lead_or_deal?: string;
  meet_url?: string;
  meet_link?: string;
  google_meet_link?: string;
  google_event_id?: string;
  google_calendar_synced?: boolean;
  status?: string;
  created_at?: string;
}

export interface Expense {
  id: number | string;
  title: string;
  category: "Marketing" | "Software" | "Office" | "Travel" | "Salaries" | "Other" | string;
  amount: number;
  date: string;
  notes?: string;
  payment_method?: "Card" | "UPI" | "Bank Transfer" | "Cash" | string;
  vendor?: string;
  status?: "Paid" | "Pending" | string;
  created_at?: string;
}

export interface InvoiceItem {
  id?: number | string;
  description?: string;
  name?: string;
  qty: number;
  quantity?: number;
  unit_price: number;
  tax_rate?: number;
  amount?: number;
  total?: number;
}

export interface OrganizationSettings {
  id?: string | number;
  organization_id?: string;
  company_name: string;
  logo_url?: string | null;
  email?: string;
  phone?: string;
  address?: string;
  gstin?: string;
  website?: string;
  signatory_name?: string;
  signatory_designation?: string;
  bank_name?: string;
  account_number?: string;
  ifsc_code?: string;
  upi_id?: string;
  default_terms?: string;
  company_email?: string;
  company_phone?: string;
  company_address?: string;
  tax_number?: string;
  gst_number?: string;
  currency?: string;
}

export interface Invoice {
  id: number | string;
  invoice_number?: string;
  bill_number?: string;
  title?: string;
  deal_id?: number | string;
  contact_id?: number | string;
  client_name?: string;
  recipient_name?: string;
  client_company?: string;
  client_email?: string;
  recipient_email?: string;
  client_phone?: string;
  recipient_phone?: string;
  recipient_address?: string;
  patient_name?: string;
  phone?: string;
  email?: string;
  type?: "QUOTE" | "INVOICE" | string;
  status?: "DRAFT" | "SENT" | "PAID" | "OVERDUE" | "Paid" | "Pending" | string;
  issue_date?: string;
  due_date?: string;
  items: InvoiceItem[];
  subtotal?: number;
  tax_amount?: number;
  discount?: number;
  discount_amount?: number;
  total_amount: number;
  notes?: string;
  terms?: string;
  payment_method?: "Cash" | "UPI" | "Card" | "Bank Transfer" | string;
  created_at?: string;
  updated_at?: string;
}

export interface AutomationLog {
  id: number | string;
  recipient_phone: string;
  message_type: "WhatsApp" | "SMS" | "Email";
  content: string;
  status: "Sent" | "Delivered" | "Failed";
  sent_at: string;
}

export interface User {
  id: number | string;
  full_name?: string;
  name?: string;
  email: string;
  role: "ADMIN" | "SALES_REP" | string;
  picture?: string;
}

// Clean initial empty state arrays
export const INITIAL_LEADS: Lead[] = [];
export const INITIAL_DEALS: Deal[] = [];
export const INITIAL_CONTACTS: Contact[] = [];
export const INITIAL_ACCOUNTS: Account[] = [];
export const INITIAL_TASKS: Task[] = [];
export const INITIAL_EVENTS: CalendarEvent[] = [];
export const INITIAL_EXPENSES: Expense[] = [];
export const INITIAL_INVOICES: Invoice[] = [];
export const INITIAL_AUTOMATIONS: AutomationLog[] = [];

export interface OPDToken {
  id: number;
  token_number: number;
  patient_name: string;
  phone: string;
  status: "Waiting" | "With Doctor" | "Completed" | string;
  bp?: string;
  pulse?: string;
  temp?: string;
  clinical_notes?: string;
  review_date?: string;
  lead_id?: any;
  date_str: string;
  created_at: string;
}
export const INITIAL_TOKENS: OPDToken[] = [];
