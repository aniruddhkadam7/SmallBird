// Real OpenAI spend via the organization admin API (OPENAI_ADMIN_KEY, an
// sk-admin- key). Used by admin-openai-balance, admin-ai-usage and
// admin-user-ai-costs.
//
// OpenAI's admin API allows 30 requests a minute, so nothing here calls it
// per page load: daily costs live in public.openai_daily_costs
// (0058_openai_daily_costs.sql) and are refreshed from OpenAI at most every
// REFRESH_MS. Call these only after the caller's admin check has passed --
// they use the service role to read and write that table.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

export const DAY = 86400;
const REFRESH_MS = 10 * 60 * 1000;
// A finished day's bill can still settle for a bit; re-fetch the last few.
const REFETCH_DAYS = 3;

export interface DailyCost {
  day: string; // YYYY-MM-DD, UTC
  appUsd: number; // the app's own key (OPENAI_API_KEY)
  orgUsd: number; // every key in the org
}

export class OpenAiAdminError extends Error {}

export function getOpenAiAdminKey(): string {
  return (Deno.env.get("OPENAI_ADMIN_KEY") ?? "").trim();
}

export const dayKey = (unix: number) => new Date(unix * 1000).toISOString().slice(0, 10);

function serviceClient(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

async function adminGet(adminKey: string, path: string) {
  const res = await fetch(`https://api.openai.com/v1/organization/${path}`, {
    headers: { Authorization: `Bearer ${adminKey}` },
  });
  if (!res.ok) {
    const body = await res.text();
    console.error("openai admin api error", path.split("?")[0], res.status, body.slice(0, 300));
    throw new OpenAiAdminError(
      res.status === 401 || res.status === 403 ? "OpenAI rejected the admin key" : `OpenAI admin request failed (${res.status})`,
    );
  }
  return res.json();
}

/// The OpenAI key id (key_...) of OPENAI_API_KEY, the key the proxy and
/// resume-ai bill to, found by matching its last 4 characters against each
/// project key's redacted value. null if no project key matches.
async function findAppApiKeyId(adminKey: string): Promise<string | null> {
  const appKey = (Deno.env.get("OPENAI_API_KEY") ?? "").trim();
  if (appKey.length < 8) return null;
  const tail = appKey.slice(-4);

  const projects = await adminGet(adminKey, "projects?limit=100");
  for (const project of projects.data ?? []) {
    const keys = await adminGet(adminKey, `projects/${project.id}/api_keys?limit=100`);
    // deno-lint-ignore no-explicit-any
    const match = (keys.data ?? []).find((k: any) => typeof k.redacted_value === "string" && k.redacted_value.endsWith(tail));
    if (match) return match.id;
  }
  return null;
}

/// Pulls daily costs from startDay (YYYY-MM-DD) to today from OpenAI and
/// upserts them into openai_daily_costs.
async function refreshFromOpenAi(db: SupabaseClient, adminKey: string, startDay: string): Promise<void> {
  const appKeyId = await findAppApiKeyId(adminKey);
  if (!appKeyId) console.error("no OpenAI project key matches OPENAI_API_KEY; app_usd will stay 0");

  const byDay = new Map<string, { app_usd: number; org_usd: number }>();
  let page: string | null = null;
  for (let i = 0; i < 20; i++) {
    const params = new URLSearchParams({
      start_time: String(Date.parse(`${startDay}T00:00:00Z`) / 1000),
      bucket_width: "1d",
      limit: "180",
      group_by: "api_key_id",
    });
    if (page) params.set("page", page);

    const json = await adminGet(adminKey, `costs?${params}`);
    for (const bucket of json.data ?? []) {
      const day = dayKey(bucket.start_time);
      const totals = byDay.get(day) ?? { app_usd: 0, org_usd: 0 };
      for (const r of bucket.results ?? []) {
        const usd = Number(r.amount?.value ?? 0);
        totals.org_usd += usd;
        if (appKeyId && r.api_key_id === appKeyId) totals.app_usd += usd;
      }
      byDay.set(day, totals);
    }
    if (!json.has_more || !json.next_page) break;
    page = json.next_page;
  }

  const fetchedAt = new Date().toISOString();
  const rows = [...byDay].map(([day, t]) => ({ day, ...t, fetched_at: fetchedAt }));
  if (rows.length === 0) return;
  const { error } = await db.from("openai_daily_costs").upsert(rows);
  if (error) console.error("openai_daily_costs upsert failed", error);
}

/// Daily costs from startDay (YYYY-MM-DD) to today, from the cache table,
/// refreshing it from OpenAI first when it's missing days or stale. If
/// OpenAI fails (e.g. rate limited), the cached days are still returned.
/// null when OPENAI_ADMIN_KEY isn't set.
export async function getDailyCosts(startDay: string): Promise<DailyCost[] | null> {
  const adminKey = getOpenAiAdminKey();
  if (!adminKey) return null;
  const db = serviceClient();

  const read = async () => {
    const { data, error } = await db
      .from("openai_daily_costs")
      .select("day, app_usd, org_usd, fetched_at")
      .gte("day", startDay)
      .order("day");
    if (error) throw error;
    return data ?? [];
  };

  let rows = await read();
  const { data: oldest } = await db.from("openai_daily_costs").select("day").order("day").limit(1).maybeSingle();
  const lastFetch = rows.reduce((max, r) => Math.max(max, Date.parse(r.fetched_at)), 0);

  const missingHistory = !oldest || oldest.day > startDay;
  const stale = Date.now() - lastFetch > REFRESH_MS;
  if (missingHistory || stale) {
    const recent = dayKey(Date.now() / 1000 - REFETCH_DAYS * DAY);
    const from = missingHistory ? startDay : recent < startDay ? startDay : recent;
    try {
      await refreshFromOpenAi(db, adminKey, from);
      rows = await read();
    } catch (err) {
      console.error("openai cost refresh failed; using cached days", err);
    }
  }

  return rows.map((r) => ({ day: r.day, appUsd: Number(r.app_usd), orgUsd: Number(r.org_usd) }));
}

export interface RealCost {
  // usage_costs day (YYYY-MM-DD, UTC) -> scale from estimate to real cost
  factorByDay: Map<string, number>;
  unattributedUsd: number;
  totalUsd: number;
  thisMonthUsd: number;
}

/// usage_costs.estimated_cost_usd is a list-price estimate that runs 25-50%
/// low (OpenAI bills the app at the priority tier and prices cached input and
/// cache writes differently). Given the estimate total of EVERY usage_costs
/// row per UTC day, returns per-day factors that turn an estimate into its
/// share of what OpenAI actually billed the app's key that day. null when
/// OPENAI_ADMIN_KEY isn't set or no real costs are available.
export async function realCostByDay(estimateByDay: Map<string, number>): Promise<RealCost | null> {
  if (estimateByDay.size === 0) return null;

  const firstDay = [...estimateByDay.keys()].reduce((min, d) => (d < min ? d : min));
  const days = await getDailyCosts(firstDay);
  if (!days || days.length === 0) return null;

  const monthStart = dayKey(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1) / 1000);
  const factorByDay = new Map<string, number>();
  let unattributedUsd = 0;
  let totalUsd = 0;
  let thisMonthUsd = 0;
  for (const { day, appUsd } of days) {
    totalUsd += appUsd;
    if (day >= monthStart) thisMonthUsd += appUsd;
    const estimate = estimateByDay.get(day) ?? 0;
    if (estimate > 0) factorByDay.set(day, appUsd / estimate);
    else unattributedUsd += appUsd;
  }
  // Days OpenAI shows no spend for keep a factor of 0, not the estimate.
  for (const key of estimateByDay.keys()) if (!factorByDay.has(key)) factorByDay.set(key, 0);

  return { factorByDay, unattributedUsd, totalUsd, thisMonthUsd };
}

// USD -> INR for the console's rupee columns. Live rate from open.er-api.com
// (free, no key), cached per function instance; the fallback is only used
// if that lookup fails.
const FALLBACK_USD_TO_INR = 95;
const RATE_TTL_MS = 6 * 60 * 60 * 1000;
let cachedRate: { inr: number; at: number } | null = null;

export async function usdToInr(): Promise<number> {
  if (cachedRate && Date.now() - cachedRate.at < RATE_TTL_MS) return cachedRate.inr;
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD", { signal: AbortSignal.timeout(3000) });
    const inr = Number((await res.json())?.rates?.INR);
    if (Number.isFinite(inr) && inr > 0) {
      cachedRate = { inr, at: Date.now() };
      return inr;
    }
  } catch (err) {
    console.error("USD->INR lookup failed", err);
  }
  return cachedRate?.inr ?? FALLBACK_USD_TO_INR;
}
