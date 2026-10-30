// Real Deepgram spend, for admin-deepgram-usage and admin-user-ai-costs.
//
// Deepgram's request log gives each request's exact USD cost and the key it
// used; stt-token mints one key per interview, so costs map straight onto
// interviews. Requests are synced into public.deepgram_request_costs
// (0059_deepgram_request_costs.sql) at most every SYNC_MS so page loads don't
// page through Deepgram's API each time. Call these only after the caller's
// admin check has passed -- they use the service role.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const SYNC_MS = 10 * 60 * 1000;
const PAGE_SIZE = 100; // Deepgram's maximum
const MAX_PAGES = 400;
// Before the first sync: interviews only have a stored key from 2026-09-26.
const FIRST_SYNC_FROM = "2026-09-01";

export function serviceClient(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

function deepgramConfig() {
  const projectId = Deno.env.get("DEEPGRAM_PROJECT_ID");
  const key = Deno.env.get("DEEPGRAM_API_KEY");
  return projectId && key ? { projectId, key } : null;
}

async function deepgramGet(path: string) {
  const cfg = deepgramConfig()!;
  const res = await fetch(`https://api.deepgram.com/v1/projects/${cfg.projectId}${path}`, {
    headers: { Authorization: `Token ${cfg.key}` },
  });
  if (!res.ok) {
    const body = await res.text();
    console.error("deepgram api error", path.split("?")[0], res.status, body.slice(0, 300));
    throw new Error(`Deepgram request failed (${res.status})`);
  }
  return res.json();
}

/// Pulls Deepgram's request log since the last synced request (minus a day,
/// for requests that were still running) into deepgram_request_costs, if
/// the last sync is older than SYNC_MS. Errors are logged, not thrown: the
/// cached rows are still good.
export async function syncDeepgramCosts(db: SupabaseClient): Promise<void> {
  if (!deepgramConfig()) return;

  const { data: sync } = await db.from("external_cost_sync").select("synced_at").eq("source", "deepgram").maybeSingle();
  if (sync && Date.now() - Date.parse(sync.synced_at) < SYNC_MS) return;

  try {
    const { data: latest } = await db
      .from("deepgram_request_costs")
      .select("created")
      .order("created", { ascending: false })
      .limit(1)
      .maybeSingle();
    const start = latest ? new Date(Date.parse(latest.created) - 86400_000).toISOString() : `${FIRST_SYNC_FROM}T00:00:00Z`;
    const end = new Date(Date.now() + 3600_000).toISOString();

    let loggedShape = false;
    for (let page = 0; page < MAX_PAGES; page++) {
      const params = new URLSearchParams({ start, end, limit: String(PAGE_SIZE), page: String(page) });
      const json = await deepgramGet(`/requests?${params}`);
      // deno-lint-ignore no-explicit-any
      const requests = (json.requests ?? []) as any[];
      if (!loggedShape && requests[0]) {
        // One-line sample so the field mapping below can be checked in logs.
        console.log("deepgram request sample keys", Object.keys(requests[0]), Object.keys(requests[0].response?.details ?? {}));
        loggedShape = true;
      }

      const rows = requests.map((r) => ({
        request_id: String(r.request_id),
        api_key_id: r.api_key_id ?? r.accessor ?? null,
        created: r.created,
        usd: Number(r.response?.details?.usd ?? 0),
        duration_seconds: Number(r.response?.details?.duration ?? 0),
      }));
      if (rows.length > 0) {
        const { error } = await db.from("deepgram_request_costs").upsert(rows);
        if (error) throw error;
      }
      if (requests.length < PAGE_SIZE) break;
    }

    await db.from("external_cost_sync").upsert({ source: "deepgram", synced_at: new Date().toISOString() });
  } catch (err) {
    console.error("deepgram cost sync failed; using cached rows", err);
  }
}

/// Deepgram's prepaid balance in USD (sum of the project's balances), or
/// null if Deepgram doesn't return one.
export async function deepgramBalanceUsd(): Promise<number | null> {
  if (!deepgramConfig()) return null;
  try {
    const json = await deepgramGet("/balances");
    // deno-lint-ignore no-explicit-any
    const balances = (json.balances ?? []) as any[];
    if (balances.length === 0) return null;
    return balances.reduce((sum, b) => sum + Number(b.amount ?? 0), 0);
  } catch {
    return null;
  }
}

export function deepgramConfigured(): boolean {
  return deepgramConfig() !== null;
}
