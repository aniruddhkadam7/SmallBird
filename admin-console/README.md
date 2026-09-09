# Smallbird Admin Console

Internal-only admin app for Smallbird staff. Separate app, separate domain
(`admin.smallbird.in`), separate authorization from the customer product.

**Nothing here is trusted for authorization.** Every admin action calls a
Supabase Edge Function (`admin-*` in `../backend/supabase/functions/`) that
independently re-verifies the caller's session and checks them against the
server-side `admin_users` allowlist table on every single request. This
app's login page, middleware, and layout only redirect for UX; none of them
decide who is actually an admin.

## Local development

```powershell
npm install
npm run dev
```

Needs `.env.local` (copy `.env.local.example`) with:
- `NEXT_PUBLIC_SUPABASE_URL` -- same Supabase project as the rest of Smallbird.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` -- the public anon key (safe to expose;
  it's already public in the desktop app and website). **Never** put the
  service-role key here -- it isn't needed and must never reach the browser.

## Adding an admin

There's no self-service admin signup. To grant someone access:

1. They need a Supabase Auth account (email+password) in this same project
   -- create one via the Supabase Dashboard (Authentication -> Add user) or
   have them sign up normally if that flow exists elsewhere.
2. Insert a row into `public.admin_users` with their `auth.users.id` and
   email. This table has zero RLS policies (by design -- see
   `../backend/supabase/migrations/0016_admin_console_foundation.sql`), so
   this has to be done directly against the database (Supabase SQL editor,
   or an MCP/CLI session with DB access) -- there is deliberately no API
   endpoint that lets an admin grant admin access to someone else through
   this app.

## Deploying

1. New Vercel project pointed at this `admin-console/` directory (set the
   project's root directory to `admin-console` if importing the whole
   monorepo).
2. Set the two env vars above in Vercel's project settings.
3. Add a custom domain `admin.smallbird.in` in Vercel, then add the CNAME
   record it gives you to the existing `smallbird.in` DNS zone. No new
   domain purchase needed -- this is a subdomain of the domain you already
   own.

## What's built

- **Dashboard** -- overview stats (users, subscriptions, minutes, interviews,
  transcripts, AI cost, suspicious-account count).
- **Users** -- searchable/filterable list + a detail page (entitlement
  ledger, purchases, subscriptions, recent sessions, AI usage) with a
  Grant/Remove/Set-balance panel (required reason, confirmation dialog, fully
  audited via `admin_adjust_entitlement`) and a Grant-pass panel for
  time-boxed trials/promotional access (`admin_grant_pass` -- sets
  `period_end` too, audited as `GRANT_PASS`).
- **Subscriptions** -- current subscription record per user, filterable by
  status. Empty today -- production only has one-time purchases so far, not
  recurring subscriptions (see Payments for those).
- **Sessions** -- every interview session, filterable by status/search, flags
  sessions force-ended by another device.
- **Transcripts** -- read-only list + full turn-by-turn detail view. No
  delete option exists anywhere in this app, by design.
- **Payments** -- traces every minute grant back to its Razorpay
  order/payment id and whether the webhook that granted it was actually
  recorded (`webhook_recorded` column).
- **AI Usage** -- token/cost totals, by model, by user (empty until real
  traffic flows through `llm-proxy` -- `usage_costs` has 0 rows as of this
  writing).
- **Abuse / Risk** -- heuristic flags (entitlement-ceiling violations,
  negative balances, repeated force-terminations, unusually long sessions,
  abnormal token usage). Never acts automatically -- surface only.
- **Data Integrity** -- live checks (missing entitlement rows, paid plan with
  no purchase record, duplicate subscriptions, sessions missing duration,
  ledger/balance mismatches).
- **System Health** -- operational signals derived from data already in the
  schema (stuck-active sessions, failed-session rates, webhook/ledger/session
  recency). No raw error log yet -- see the page's own note on what a deeper
  integration (a `system_errors` table, or Supabase's platform log API) would
  add.
- **Data Integrity** -- live checks (missing entitlement rows, paid plan with
  no purchase record, duplicate subscriptions, sessions missing duration,
  ledger/balance mismatches).
- **Audit Logs** -- every admin action, who did it, before/after values.
- **Settings** -- optional TOTP two-factor enrollment (Supabase Auth's
  built-in MFA, no extra infrastructure), and a read-only list of who's on
  the admin allowlist.

Every nav section in the original spec is built. Not built: raw exception
logging (System Health explains why), CSV export, and rate limiting at the
application layer (Supabase's own platform-level rate limits apply to every
Edge Function already).
