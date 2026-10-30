-- OpenAI's real daily bill, cached for the admin console.
--
-- OpenAI's admin API allows 30 requests a minute, and the Users page asks
-- for costs on every load -- calling OpenAI each time hit 429s. The admin-*
-- functions read this table instead and refresh it from
-- /v1/organization/costs at most every 10 minutes (_shared/openaiCosts.ts).
-- app_usd is the app's own OpenAI key (OPENAI_API_KEY); org_usd is every key
-- in the org, which is what the prepaid credit balance pays for.

create table if not exists public.openai_daily_costs (
  day date primary key, -- UTC, as OpenAI buckets it
  app_usd numeric not null default 0,
  org_usd numeric not null default 0,
  fetched_at timestamptz not null default now()
);

alter table public.openai_daily_costs enable row level security;
-- Zero policies: only the service role (edge functions) reads or writes it.
