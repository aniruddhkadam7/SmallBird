// Shared types and helpers for the Pricing & Offers page
// (app/(admin)/pricing). Data comes from the admin-pricing Edge Function.
import { createClient } from "@/lib/supabase/client";
import { callAdminFunction } from "@/lib/adminApi";

export interface PlanRow {
  id: string;
  display_name: string;
  included_minutes: number;
  is_active: boolean;
  price_inr_paise: number;
  price_usd_cents: number;
  sale_price_inr_paise: number | null;
  sale_price_usd_cents: number | null;
  sale_label: string | null;
  sale_starts_at: string | null;
  sale_ends_at: string | null;
  previous_price_inr_paise: number | null;
  previous_price_usd_cents: number | null;
  price_changed_at: string | null;
}

export interface PromotionRow {
  id: string;
  title: string;
  message: string | null;
  cta_label: string | null;
  cta_href: string | null;
  show_banner: boolean;
  show_popup: boolean;
  starts_at: string;
  ends_at: string | null;
  created_at: string;
}

export interface PricingData {
  plans: PlanRow[];
  promotions: PromotionRow[];
  now: string;
}

export type Status = "live" | "scheduled" | "ended" | "none";

export function windowStatus(startsAt: string | null, endsAt: string | null, now = Date.now()): Status {
  if (startsAt && Date.parse(startsAt) > now) return "scheduled";
  if (endsAt && Date.parse(endsAt) <= now) return "ended";
  return "live";
}

export function saleStatus(plan: PlanRow): Status {
  if (!plan.sale_price_inr_paise && !plan.sale_price_usd_cents) return "none";
  return windowStatus(plan.sale_starts_at, plan.sale_ends_at);
}

export function rupees(paise: number | null | undefined): string {
  if (paise == null) return "—";
  const r = paise / 100;
  return `₹${Number.isInteger(r) ? r : r.toFixed(2)}`;
}

export function dollars(cents: number | null | undefined): string {
  if (cents == null) return "—";
  const d = cents / 100;
  return `$${Number.isInteger(d) ? d : d.toFixed(2)}`;
}

export function percentOff(regular: number, sale: number | null): string {
  if (sale == null || regular <= 0) return "";
  return `${Math.round((1 - sale / regular) * 100)}% off`;
}

export function when(iso: string | null): string {
  if (!iso) return "no end date";
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
}

/// <input type="datetime-local"> value -> ISO string (the browser's own time zone).
export function localInputToIso(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}

/// Calls admin-pricing with the signed-in admin's session.
export async function pricingAction<T = { ok: true }>(body: Record<string, unknown>): Promise<T> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error("Session expired — please sign in again.");
  return callAdminFunction<T>(session.access_token, "admin-pricing", body);
}
