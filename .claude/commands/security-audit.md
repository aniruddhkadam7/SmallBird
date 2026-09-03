---
description: Deep, Smallbird-specific security review covering concurrent-session/account-sharing abuse, API key and secret handling, Supabase database and RLS security, payment/webhook integrity, the desktop app's attack surface, and crash resilience.
---

# Smallbird security audit

Framing to give the user up front, every time this runs: no software is
"unhackable" and no audit proves zero vulnerabilities — this finds and fixes
concrete, known classes of real-world weakness in this specific app's actual
architecture. Report it that way, not as a guarantee.

This is a living checklist for a real, evolving codebase — when a check below
references a file, function, or table that no longer exists or has moved, that's
a signal the app changed since this was written, not that the check no longer
matters. Re-locate the equivalent code and check the same underlying property.

If the Supabase MCP tools (`mcp__supabase__*`) are connected this session, run
`get_advisors` (both `security` and `performance` types) as a first pass — it
catches missing-RLS and other Supabase-detectable issues automatically before
the manual checks below. If they're not connected, note that to the user and
fall back to asking them to check the Supabase Dashboard's own Advisors page
(Project → Advisors) for the same automated checks, or run the equivalent SQL
queries below yourself through whatever database access is available.

## A. Multi-account / concurrent-session abuse

The actual enforcement lives in a database constraint, not app logic — a unique
partial index on `interview_sessions` (one active row per user). Verify this
constraint still exists (query `pg_indexes` / `pg_constraint` for
`interview_sessions`) rather than trusting that it does. If it's ever missing,
`stt-token`'s insert would silently allow unlimited concurrent sessions per
account with no error at all — this is the single point of failure for the
entire "one user, one active session" guarantee, so confirm it directly against
the live database, not just by reading migration files (the base schema
predates the migrations present in this repo and was applied by hand — the
files on disk are not proof of what's actually enforced in production).

Check every path that can mint a session-scoped credential
(`backend/supabase/functions/stt-token`) or extend one
(`session-heartbeat`) actually calls the shared entitlement/auth check
(`_shared/entitlement.ts`'s `requireEntitlement`) before doing anything — a new
function added later that forgets this call is a full auth bypass for that one
endpoint. Grep every file under `backend/supabase/functions/*/index.ts` for
`requireEntitlement` and confirm the count matches the number of functions that
should require it (everything except a genuinely public health-check, if one
exists).

Confirm the `force`-based override in `stt-token` (ending someone else's active
session to start a new one) can only ever terminate a session belonging to the
*same* `user_id` — re-read the actual SQL/logic and verify the `WHERE` clause is
scoped by the authenticated caller's own id from the verified JWT, never by a
client-supplied id. This is the one place a subtle bug would let User A kick
User B off their session.

Check the desktop app's own concurrency (`interview_mode/commands.rs`,
`stt/backend_token.rs`) can't be bypassed by calling the Edge Functions directly
with a stolen/replayed access token from outside the app — since the real
enforcement is server-side (the DB constraint above), this should already hold,
but confirm there's no separate client-only check that the server doesn't also
enforce.

## B. Secrets and API key handling

None of `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `DEEPGRAM_API_KEY`,
`RAZORPAY_KEY_SECRET`, or `SUPABASE_SERVICE_ROLE_KEY` should ever reach a
client — not the desktop binary, not the website's client-side JS bundle. Grep
the entire `src/` (desktop) and website `src/` trees for each of those names;
any match outside `backend/supabase/functions/` or a server-only
`route.ts`/server component is a real leak. The Supabase *anon* key and
`NEXT_PUBLIC_*` values are meant to be public (protected by RLS, not secrecy) —
don't flag those.

The desktop app's `tauri.conf.json` CSP (`app.security.csp`) should keep
`script-src 'self'` with no `unsafe-inline`/`unsafe-eval` — re-check it hasn't
drifted after any change that touches windows/webview config, since a loosened
CSP is easy to introduce accidentally while debugging something unrelated (e.g.
an inline `<script>` added for a quick fix) and easy to miss in review.

Any local file holding a live credential (`~/.tauri/smallbird-updater.key`, the
GitHub PAT at `~/.tauri/smallbird-releases.pat.txt`, `backend/.env`-style files)
must never be committed — confirm `.gitignore` actually covers these paths and
run `git log --all --full-history -- <path>` on each to confirm none was ever
committed even transiently. If a credential (GitHub token, Supabase service
key, Razorpay secret) was ever pasted into a chat/terminal that isn't fully
trusted, or committed and later removed, treat it as compromised and get it
rotated regardless of whether this audit finds active misuse — history and
process memory aren't something this check can fully rule out.

## C. Database and RLS security

Query `pg_policies` directly for every table in `public` and confirm: every
table holding user data (`entitlements`, `interview_sessions`, `purchases`,
`usage_costs`, `usage_events`) has RLS *enabled* (`rowsecurity = true` in
`pg_tables`), and every `SELECT`/`UPDATE` policy scopes by `auth.uid() =
user_id` (or an equivalent ownership check) — never a bare `USING (true)` on a
table with per-user data. A table with RLS enabled but zero policies is
fail-closed (safe but broken); a table with RLS *disabled* is the actual danger
— anyone with the anon key (i.e. everyone) can read or write every row.

Every Edge Function's `admin` client (built with the service role key) bypasses
RLS entirely by design — confirm each one only ever reads/writes rows it has
already independently verified belong to the authenticated caller (via
`requireEntitlement`'s own `userId`), never a client-supplied id used
unchecked in a `.eq()`/`.insert()` call.

Webhook idempotency: confirm `webhook_events` still has a unique constraint on
`(event_type, entity_id)` and that `razorpay-webhook` checks/inserts into it
*before* calling `increment_entitlement_minutes` — a retried webhook delivery
without this would double-credit minutes for a single payment. Also confirm the
webhook handler verifies the `X-Razorpay-Signature` HMAC against the raw request
body (not a re-serialized/parsed version, which can produce a different byte
sequence and either break legitimate webhooks or, worse, get "fixed" by
disabling verification) before trusting anything in the payload — an
unauthenticated `order.paid` event would let anyone credit themselves minutes
for free with a forged request to the public webhook URL.

Check for SQL injection surface: this app should have none, since all database
access goes through Supabase's PostgREST client or parameterized RPC calls —
grep for any raw string concatenation into a `.sql()`/raw query call as a
regression check, since introducing one later (e.g. a debug endpoint) would be
a real hole in an app that otherwise has none.

## D. Auth and session security

Every Edge Function that isn't the webhook should call `requireEntitlement`
(which calls `supabase.auth.getUser(jwt)` — a real network verification against
Supabase Auth, not just decoding the JWT payload) before trusting `userId` from
the token. Confirm no function was ever "optimized" to skip this by decoding the
JWT locally without signature verification — that would let anyone forge a JWT
claiming any `user_id` and access/spend another user's entitlement, since the
downstream queries use the service role key and don't re-check ownership.

The desktop app's Google OAuth (`auth/oauth.rs`) uses PKCE with
`code_challenge_method=plain`. `plain` is spec-valid and the flow is still
sound (the verifier never leaves the local machine), but `S256` is strictly
stronger and costs nothing extra on a platform that can trivially compute
SHA-256 — flag this as a real, low-effort hardening opportunity, not a live
vulnerability.

Confirm refresh tokens are stored via the OS credential store
(`session_store.rs`'s use of the `keyring` crate on Windows), never written to
a plain file or app-local storage — a refresh token on disk in plaintext would
survive even if the OS user account were compromised in a way that credential
manager entries wouldn't.

Confirm email-OTP rate limiting is actually configured in Supabase (dashboard,
not just SMTP provider limits) — without it, the login flow's built-in code
guesser is an enumeration/brute-force target given only a 6-digit code.

## E. Payment and webhook integrity

The amount charged must always be computed server-side from `plans` by
`plan_id`, never trusted from client input — confirm both
`api/razorpay/create-order` and `create-subscription` (website) look up the
price server-side and never forward a client-supplied amount to Razorpay's
Orders/Subscriptions API. A client-controlled amount is a direct "pay 1 rupee
for a full plan" exploit.

Confirm `plan_id` values accepted by these routes are validated against the
actual `plans` table (or a fixed enum matching it) — an arbitrary string here
that doesn't correspond to a real plan could let a webhook credit an
undefined/free-tier amount of minutes, or crash the minute-crediting RPC on an
unexpected value.

## F. Desktop app (Tauri) attack surface

Read `src-tauri/capabilities/default.json` and confirm the permission list is
still the minimum the app actually uses — each addition here (during any future
feature work) should be deliberate, not copy-pasted broadly. A capability like
unrestricted `fs:*` or `shell:*` granted to the webview would let a compromised
or malicious web-rendered surface (there isn't one today — no remote content is
loaded — but re-verify this hasn't changed) read/write arbitrary files or spawn
processes.

Confirm the app never loads remote/untrusted web content into a webview
(`WebviewUrl::App` only, no `WebviewUrl::External` pointed at anything other
than the user's own browser via the opener plugin) — Tauri's security model
assumes the webview only ever renders code that shipped in the bundle.

The auto-updater's trust boundary is the signing keypair
(`~/.tauri/smallbird-updater.key`) — anyone who obtains that private key can
sign a malicious build that every existing install will silently accept and
run. This is the highest-impact single secret in the whole system (a
compromise here has code-execution-on-every-user's-machine impact, not just
data exposure) — confirm it's never been committed, never leaves the local
machine, and that the password protecting it isn't stored next to the key in a
way that makes possessing one worthless without the other but possessing both
trivial (right now they're both under `~/.tauri/` — flag this as worth moving
the password to a separate, non-adjacent location or a password manager, since
an attacker who finds one directory finds both).

## G. Crash resilience ("no crash for any user")

Grep Rust code for `.unwrap()`/`.expect()` on anything derived from network
responses, user input, or file I/O (as opposed to a genuinely-infallible
invariant like a hardcoded literal) — each one is a potential panic that can
crash the whole process for one specific user's specific input, not just fail
gracefully. Prioritize the STT/audio pipeline and the Edge Function response
parsing paths (`personal/providers/*.rs`, `stt/*.rs`) — these handle the least
predictable input (network streams, third-party API responses).

Grep TypeScript/React code for `.then()` chains or `async` calls with no
`.catch()`/try-catch and no error boundary above them — an unhandled promise
rejection in the overlay or main window can leave the UI in a stuck/frozen
state rather than crashing outright, which is worse for a user mid-interview
(silent hang, not even a visible error to report).

Edge Functions should never let an uncaught exception reach the client as a raw
500 with a stack trace — confirm every function's top-level handler catches
broadly and returns `entitlementErrorResponse`-style generic errors, since a
leaked stack trace can reveal internal file paths, table names, or logic that
helps an attacker.

## H. Rate limiting and cost-abuse

Entitlement minutes bound total usage, but nothing currently stops a user from
calling `llm-proxy` in a tight loop within their remaining balance to run up
real OpenAI/Anthropic API cost far faster than a human interview would — check
whether `requireEntitlement` or `llm-proxy` itself enforces any per-minute
request cap, and if not, flag this as a real (if currently unexploited) cost
exposure, not just a security one.

## Output format

Report findings grouped by section (A–H above), each tagged Critical / High /
Medium / Low / Info, with: what was checked, what was found, the concrete
failure scenario if left unfixed (not just "this is a best practice"), and the
specific fix. Skip a section entirely (don't pad it with "no issues found"
filler) only after actually running its checks — never skip a section because
it seems unlikely to have a problem.
