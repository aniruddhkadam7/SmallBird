"use client";

import { useEffect, useState } from "react";
import { Ban, ChevronDown, Clock, Copy, Phone, Receipt, Ticket } from "lucide-react";
import { useParams } from "next/navigation";
import { useAdminQuery, AdminApiError } from "@/lib/useAdminQuery";
import { Unauthorized } from "@/components/Unauthorized";
import { PageLoading } from "@/components/PageLoading";
import { ManageMinutesPanel } from "@/components/ManageMinutesPanel";
import { GrantPassPanel } from "@/components/GrantPassPanel";
import { TranscriptModal } from "@/components/TranscriptModal";
import { prefetchTranscript } from "@/lib/transcript";
import { BanUserPanel } from "@/components/BanUserPanel";
import { ActivityTimeline } from "@/components/ActivityTimeline";
import { Modal } from "@/components/Modal";
import { avatarGradient, formatDuration, formatJoined, formatPayment, formatRupees } from "@/lib/format";
import { formatAiCost, formatDeepgramCost, useUserAiCosts } from "@/lib/userAiCosts";
import { deviceBadge, deviceLabel, userStage, type DeviceKind, type DeviceOs } from "@/lib/devices";
import { formatIpLocation, useIpLocation } from "@/lib/ipLocation";

interface LedgerRow {
  id: number;
  delta: number;
  balance_before: number;
  balance_after: number;
  source: string;
  reference_id: string | null;
  reason: string | null;
  created_at: string;
}

interface PurchaseRow {
  id: number;
  plan_id: string;
  amount_paise: number | null;
  currency?: string;
  amount_minor?: number | null;
  razorpay_order_id: string;
  created_at: string;
}

interface SubscriptionRow {
  id: string;
  plan: string;
  status: string;
  current_period_end: string | null;
}

interface SessionRow {
  id: string;
  started_at: string;
  ended_at: string | null;
  status: string;
  minutes_consumed: number | null;
  actual_duration_seconds: number | null;
  usage_deducted: boolean;
  termination_reason: string | null;
  client_kind: DeviceKind | null;
  client_os: DeviceOs | null;
  // AI answers given during the session; 0 means nothing was asked.
  ai_answers: number;
  plan_id: string | null;
  transcript_id: string | null;
  transcript_turn_count: number | null;
}

interface TranscriptRow {
  id: string;
  role: string | null;
  company: string | null;
  started_at_ms: number;
  ended_at_ms: number;
  turn_count: number;
  created_at: string;
}

interface DeviceRow {
  kind: DeviceKind;
  os: DeviceOs;
  appVersion: string | null;
  userAgent: string | null;
  lastIp: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  signInCount: number;
  sessionCount: number;
}

// What we know about reaching the user: what they typed at Razorpay checkout,
// then their CVs (0062). Missing until that migration is applied, so every
// use is optional.
interface ContactInfo {
  phones: { value: string; source: string }[];
  locations: string[];
  linkedin: string[];
  links: { label: string; value: string }[];
  emails: string[];
  cvNames: string[];
  payments?: {
    paymentId: string;
    method: string | null;
    vpa: string | null;
    bank: string | null;
    wallet: string | null;
    amountPaise: number | null;
    status: string;
    createdAt: string;
  }[];
}

interface UserDetail {
  profile: {
    userId: string;
    email: string;
    displayName: string | null;
    fullName?: string | null;
    avatarUrl?: string | null;
    createdAt: string;
    lastSignInAt: string | null;
    updatedAt?: string | null;
    emailConfirmedAt?: string | null;
    signUpProvider: string | null;
    providers?: string[];
    welcomeEmailSentAt: string | null;
    isOwner: boolean;
    isBanned: boolean;
    banReason: string | null;
    bannedAt: string | null;
    bannedByEmail: string | null;
  };
  contact?: ContactInfo;
  resumeBuilder?: { resumes: number; aiRequests: number; lastUsedAt: string | null };
  devices: DeviceRow[];
  entitlement: { planId: string; remainingMinutes: number; periodStart: string; periodEnd: string | null; updatedAt: string };
  ledger: LedgerRow[];
  purchases: PurchaseRow[];
  subscriptions: SubscriptionRow[];
  sessionsSummary: { total: number; totalMinutesConsumed: number; completed: number; terminated: number; expired: number; active: number };
  sessions: SessionRow[];
  usageCostsSummary: { totalInputTokens: number; totalOutputTokens: number; totalCalls: number; estimatedCostUsd: number };
  transcripts: TranscriptRow[];
  transcriptCount: number;
}

const SOURCE_BADGE: Record<string, string> = {
  PURCHASE: "badge-ok",
  SIGNUP_GRANT: "badge-muted",
  USAGE: "badge-warn",
  ADMIN_GRANT: "badge-ok",
  ADMIN_CORRECTION: "badge-danger",
  REFUND_ADJUSTMENT: "badge-danger",
};

// The page is split into tabs so each part is one short screen instead of
// one very long scroll; the open tab is kept in the URL hash, so a refresh or
// the back button returns to it.
const TABS = ["overview", "activity", "sessions", "transcripts", "devices", "minutes"] as const;
type Tab = (typeof TABS)[number];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-sm font-medium text-ink">{children}</dd>
    </div>
  );
}

// Lists show this many rows at first, then grow by this much per "Show more".
const PAGE = 30;

// "30 Oct, 3:01 pm" (adds the year when it isn't this year).
function shortDateTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    ...(d.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }),
    hour: "numeric",
    minute: "2-digit",
  });
}

function MoreButton({ total, shown, onMore }: { total: number; shown: number; onMore: () => void }) {
  if (total <= shown) return null;
  return (
    <button onClick={onMore} className="block w-full border-t border-border py-2.5 text-center text-sm font-medium text-accent hover:bg-subtle">
      Show more ({total - shown} left)
    </button>
  );
}

// The phone/tablet version of a tab's table: one short row per item in a
// single card (below lg, where tables would otherwise become a tall card
// per row).
function CompactList({
  children,
  empty,
  total,
  shown,
  onMore,
}: {
  children: React.ReactNode;
  empty: string;
  total: number;
  shown: number;
  onMore: () => void;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-card lg:hidden">
      {total === 0 ? (
        <p className="py-6 text-center text-sm text-muted">{empty}</p>
      ) : (
        <ul className="divide-y divide-border">{children}</ul>
      )}
      <MoreButton total={total} shown={shown} onMore={onMore} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted">{label}</p>
      <p className="truncate text-base font-medium text-ink">{value}</p>
    </div>
  );
}

export default function UserDetailPage() {
  const params = useParams<{ id: string }>();
  const userId = params.id;

  const { data: detail, error, mutate } = useAdminQuery<UserDetail>("admin-user-detail", { userId });
  const aiCosts = useUserAiCosts([userId]);
  const userAiCost = aiCosts?.users[userId];
  const [openTranscriptId, setOpenTranscriptId] = useState<string | null>(null);
  const [manageMinutesOpen, setManageMinutesOpen] = useState(false);
  const [grantPassOpen, setGrantPassOpen] = useState(false);
  const [banOpen, setBanOpen] = useState(false);
  const [billingOpen, setBillingOpen] = useState(false);
  // Devices are newest first, so this is where the user was last seen.
  const lastIp = detail?.devices.find((d) => d.lastIp)?.lastIp ?? null;
  const ipLocation = useIpLocation(lastIp);
  const [tab, setTab] = useState<Tab>("overview");
  const [shown, setShown] = useState(PAGE);
  const showMore = () => setShown((n) => n + PAGE);
  useEffect(() => {
    const fromHash = window.location.hash.slice(1) as Tab;
    if (TABS.includes(fromHash)) setTab(fromHash);
  }, []);
  const selectTab = (t: Tab) => {
    setTab(t);
    setShown(PAGE);
    history.replaceState(null, "", t === "overview" ? window.location.pathname + window.location.search : `#${t}`);
  };

  if (error instanceof AdminApiError && error.status === 403) return <Unauthorized />;
  if (error instanceof AdminApiError && error.status === 404) return <p className="text-sm text-muted">User not found.</p>;
  if (!detail) return <PageLoading error={error} />;

  const hasBilling = detail.purchases.length > 0 || detail.subscriptions.length > 0;
  const contact = detail.contact;
  const phone = contact?.phones[0];
  const fmt = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : "--");
  const ipPlace = formatIpLocation(ipLocation);
  const name = [detail.profile.fullName, detail.profile.displayName, ...(contact?.cvNames ?? [])].filter(
    (n, i, all): n is string => !!n && all.indexOf(n) === i,
  );
  const paidPaise = detail.purchases.reduce((sum, p) => sum + (p.amount_paise ?? 0), 0);
  const lastSeen = detail.devices[0]?.lastSeenAt ?? detail.profile.lastSignInAt;

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "overview", label: "Overview" },
    { id: "activity", label: "Activity" },
    { id: "sessions", label: "Sessions", count: detail.sessions.length },
    { id: "transcripts", label: "Transcripts", count: detail.transcripts.length },
    { id: "devices", label: "Devices", count: detail.devices.length },
    { id: "minutes", label: "Minutes", count: detail.ledger.length },
  ];

  const actions = [
    { label: "Manage minutes", icon: Clock, onClick: () => setManageMinutesOpen(true) },
    { label: "Grant a pass", icon: Ticket, onClick: () => setGrantPassOpen(true) },
    { label: detail.profile.isBanned ? "Unban user" : "Ban user", icon: Ban, onClick: () => setBanOpen(true), danger: !detail.profile.isBanned },
    ...(hasBilling ? [{ label: "Billing", icon: Receipt, onClick: () => setBillingOpen(true) }] : []),
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      {/* Who this is, how to reach them, and what an admin can do. */}
      <section className="card">
        <div className="flex items-start gap-3">
          {detail.profile.avatarUrl ? (
            // Google profile photo; plain img so no remote-image config is needed.
            <img src={detail.profile.avatarUrl} alt="" referrerPolicy="no-referrer" className="h-12 w-12 flex-shrink-0 rounded-full" />
          ) : (
            <span
              className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-lg font-semibold text-white ${avatarGradient(detail.profile.email)}`}
            >
              {(name[0] ?? detail.profile.email).charAt(0).toUpperCase()}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <h1 className="min-w-0 break-all text-base font-semibold text-ink sm:text-lg">{name[0] ?? detail.profile.email}</h1>
              {detail.profile.isOwner && <span className="badge badge-ok">Owner</span>}
              {detail.profile.isBanned && <span className="badge badge-danger">Banned</span>}
              <span className={`badge ${detail.entitlement.planId !== "free" ? "badge-ok" : "badge-muted"}`}>{detail.entitlement.planId}</span>
            </div>
            {name[0] && <p className="break-all text-sm text-muted">{detail.profile.email}</p>}
            <p className="mt-0.5 text-xs text-muted">
              {userStage(detail.devices, detail.sessionsSummary.total)} · joined {formatJoined(detail.profile.createdAt)}
              {lastSeen && <> · last seen {formatJoined(lastSeen)}</>}
            </p>
            {phone && (
              <a
                href={`tel:${phone.value.replace(/[^\d+]/g, "")}`}
                className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-accent/10 px-2.5 py-1 text-sm font-medium text-accent hover:bg-accent/20"
              >
                <Phone size={13} /> {phone.value}
              </a>
            )}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          {actions.map(({ label, icon: Icon, onClick, danger }) => (
            <button
              key={label}
              type="button"
              onClick={onClick}
              className={`btn-secondary flex items-center justify-center gap-1.5 px-3 py-2 text-xs ${danger ? "text-danger" : ""}`}
            >
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>
      </section>

      {/* The numbers an admin looks for first. */}
      <div className="grid grid-cols-3 gap-2 lg:grid-cols-6">
        {[
          { label: "Minutes left", value: Number(detail.entitlement.remainingMinutes).toFixed(1) },
          { label: "Interviews", value: detail.sessionsSummary.total },
          { label: "Transcripts", value: detail.transcriptCount },
          { label: "Paid", value: paidPaise ? formatRupees(paidPaise) : "₹0" },
          { label: "AI cost", value: formatAiCost(userAiCost?.totalUsd ?? 0, aiCosts) },
          { label: "Resumes", value: detail.resumeBuilder?.resumes ?? 0 },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-border bg-surface px-3 py-2.5 shadow-card">
            <p className="truncate text-[11px] text-muted">{s.label}</p>
            <p className="truncate text-base font-semibold tabular-nums text-ink">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Tabs stay in reach while scrolling (below the phone top bar). */}
      <nav className="sticky top-[calc(3.75rem+env(safe-area-inset-top))] z-20 -mx-4 border-b border-border bg-subtle/95 px-4 backdrop-blur sm:-mx-6 sm:px-6 lg:top-0">
        <div className="-mb-px flex gap-1 overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => selectTab(t.id)}
              className={`flex-shrink-0 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${
                tab === t.id ? "border-accent text-accent" : "border-transparent text-muted hover:text-ink"
              }`}
            >
              {t.label}
              {t.count != null && <span className="ml-1 text-xs opacity-70">{t.count}</span>}
            </button>
          ))}
        </div>
      </nav>

      {tab === "overview" && (
        <div className="space-y-4">
          <section className="card">
            <h2 className="text-sm font-semibold text-ink">Contact</h2>
            <p className="text-xs text-muted">Phone from Razorpay checkout or the user&apos;s CVs; location from IP and CVs.</p>
            <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Mobile number">
                {contact?.phones.length ? (
                  <ul className="space-y-0.5">
                    {contact.phones.map((p) => (
                      <li key={p.value}>
                        <a href={`tel:${p.value.replace(/[^\d+]/g, "")}`} className="text-accent hover:underline">
                          {p.value}
                        </a>{" "}
                        <span className="text-xs font-normal text-muted">({p.source})</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className="text-muted">Not given</span>
                )}
              </Field>
              <Field label="Name">{name.join(" · ") || "--"}</Field>
              <Field label="Email">
                <span className="break-all">{detail.profile.email}</span>
                {contact?.emails.map((e) => (
                  <span key={e} className="block break-all text-xs font-normal text-muted">
                    {e} (CV)
                  </span>
                ))}
              </Field>
              <Field label="Location">
                {ipPlace && (
                  <span className="block">
                    {ipPlace} <span className="text-xs font-normal text-muted">(from IP)</span>
                  </span>
                )}
                {contact?.locations.map((l) => (
                  <span key={l} className="block">
                    {l} <span className="text-xs font-normal text-muted">(CV)</span>
                  </span>
                ))}
                {!ipPlace && !contact?.locations.length && "--"}
              </Field>
              {!!contact?.linkedin.length && (
                <Field label="LinkedIn">
                  {contact.linkedin.map((l) => (
                    <a
                      key={l}
                      href={/^https?:\/\//i.test(l) ? l : `https://${l}`}
                      target="_blank"
                      rel="noreferrer"
                      className="block break-all text-accent hover:underline"
                    >
                      {l}
                    </a>
                  ))}
                </Field>
              )}
              {contact?.links.map((l) => (
                <Field key={l.value} label={l.label || "Link"}>
                  <span className="break-all">{l.value}</span>
                </Field>
              ))}
              {detail.resumeBuilder && (detail.resumeBuilder.resumes > 0 || detail.resumeBuilder.aiRequests > 0) && (
                <Field label="Resume builder">
                  {detail.resumeBuilder.resumes} CV{detail.resumeBuilder.resumes === 1 ? "" : "s"} · {detail.resumeBuilder.aiRequests} AI request
                  {detail.resumeBuilder.aiRequests === 1 ? "" : "s"}
                  {detail.resumeBuilder.lastUsedAt && (
                    <span className="block text-xs font-normal text-muted">last used {formatJoined(detail.resumeBuilder.lastUsedAt)}</span>
                  )}
                </Field>
              )}
              {!!contact?.payments?.length && (
                <Field label="Razorpay payments">
                  <ul className="space-y-0.5">
                    {contact.payments.map((p) => (
                      <li key={p.paymentId}>
                        <span className={p.status === "paid" ? "text-ok" : "text-danger"}>{p.status}</span>
                        {p.amountPaise != null && <> · ₹{(p.amountPaise / 100).toFixed(0)}</>}
                        {p.method && <> · {p.method}</>}
                        {(p.vpa || p.bank || p.wallet) && <span className="text-xs font-normal text-muted"> ({p.vpa ?? p.bank ?? p.wallet})</span>}
                        <span className="block text-xs font-normal text-muted">{fmt(p.createdAt)}</span>
                      </li>
                    ))}
                  </ul>
                </Field>
              )}
              {detail.profile.isBanned && (
                <Field label="Banned">
                  <span className="text-danger">
                    {fmt(detail.profile.bannedAt)}
                    {detail.profile.bannedByEmail && <> by {detail.profile.bannedByEmail}</>}
                  </span>
                  {detail.profile.banReason && <span className="block text-xs font-normal text-muted">{detail.profile.banReason}</span>}
                </Field>
              )}
            </dl>

            <details className="group mt-4 border-t border-border pt-3">
              <summary className="flex cursor-pointer list-none items-center gap-1 text-xs font-medium text-accent">
                <ChevronDown size={14} className="transition-transform group-open:rotate-180" /> More details
              </summary>
              <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="Sign-in methods">
                  <span className="capitalize">
                    {(detail.profile.providers?.length ? detail.profile.providers : [detail.profile.signUpProvider]).filter(Boolean).join(", ") || "--"}
                  </span>
                </Field>
                <Field label="Joined">{fmt(detail.profile.createdAt)}</Field>
                <Field label="Last sign-in">{fmt(detail.profile.lastSignInAt)}</Field>
                <Field label="Email confirmed">{fmt(detail.profile.emailConfirmedAt)}</Field>
                <Field label="Welcome email sent">{fmt(detail.profile.welcomeEmailSentAt)}</Field>
                <Field label="Account updated">{fmt(detail.profile.updatedAt)}</Field>
                <Field label="Last IP">
                  <span className="font-mono">{lastIp ?? "--"}</span>
                </Field>
                <Field label="User id">
                  <button
                    type="button"
                    onClick={() => navigator.clipboard?.writeText(detail.profile.userId)}
                    className="inline-flex max-w-full items-center gap-1 font-mono text-xs text-muted hover:text-ink"
                    title="Copy"
                  >
                    <span className="break-all">{detail.profile.userId}</span> <Copy size={12} className="flex-shrink-0" />
                  </button>
                </Field>
              </dl>
            </details>
          </section>

          <section className="card">
            <h2 className="text-sm font-semibold text-ink">Usage</h2>
            <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-6">
              <Stat label="Plan" value={detail.entitlement.planId} />
              <Stat label="Period end" value={detail.entitlement.periodEnd ? new Date(detail.entitlement.periodEnd).toLocaleDateString() : "--"} />
              <Stat label="Minutes used" value={Number(detail.sessionsSummary.totalMinutesConsumed).toFixed(1)} />
              <Stat label="Completed" value={detail.sessionsSummary.completed} />
              <Stat label="Terminated" value={detail.sessionsSummary.terminated} />
              <Stat label="Expired" value={detail.sessionsSummary.expired} />
              <Stat label="LLM calls" value={detail.usageCostsSummary.totalCalls} />
              <Stat label="Input tokens" value={detail.usageCostsSummary.totalInputTokens.toLocaleString()} />
              <Stat label="Output tokens" value={detail.usageCostsSummary.totalOutputTokens.toLocaleString()} />
              <Stat label="Deepgram" value={formatDeepgramCost(userAiCost?.deepgramUsd ?? 0, aiCosts)} />
              <Stat label="Est. AI cost (list)" value={`$${detail.usageCostsSummary.estimatedCostUsd.toFixed(4)}`} />
            </div>
          </section>
        </div>
      )}

      {tab === "activity" && <ActivityTimeline detail={detail} />}

      {tab === "devices" && (
        <section>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Device</th>
                  <th>App version</th>
                  <th>Sign-ins</th>
                  <th>Interviews</th>
                  <th>First seen</th>
                  <th>Last seen</th>
                  <th>Last IP</th>
                </tr>
              </thead>
              <tbody>
                {detail.devices.map((d) => (
                  <tr key={`${d.kind}-${d.os}`}>
                    <td>
                      <span className={`badge ${deviceBadge(d)} whitespace-nowrap`} title={d.userAgent ?? ""}>
                        {deviceLabel(d)}
                      </span>
                    </td>
                    <td>{d.appVersion ? `v${d.appVersion}` : "--"}</td>
                    <td>{d.signInCount}</td>
                    <td>{d.sessionCount}</td>
                    <td className="whitespace-nowrap">{new Date(d.firstSeenAt).toLocaleString()}</td>
                    <td className="whitespace-nowrap">{new Date(d.lastSeenAt).toLocaleString()}</td>
                    <td className="font-mono text-xs text-muted">{d.lastIp ?? "--"}</td>
                  </tr>
                ))}
                {detail.devices.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-6 text-center text-muted">
                      No device recorded yet. It shows up on the user&apos;s next sign-in or interview.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === "minutes" && (
        <section>
          <CompactList empty="No ledger history." total={detail.ledger.length} shown={shown} onMore={showMore}>
            {detail.ledger.slice(0, shown).map((l) => (
              <li key={l.id} className="flex items-center gap-3 px-3 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className={`badge ${SOURCE_BADGE[l.source] ?? "badge-muted"}`}>{l.source.replace(/_/g, " ").toLowerCase()}</span>
                    <span className="truncate text-xs text-muted">{shortDateTime(l.created_at)}</span>
                  </span>
                  {(l.reason ?? l.reference_id) && <span className="mt-0.5 block truncate text-xs text-muted">{l.reason ?? l.reference_id}</span>}
                </span>
                <span className="flex-shrink-0 text-right">
                  <span className={`block text-sm font-semibold tabular-nums ${Number(l.delta) >= 0 ? "text-ok" : "text-danger"}`}>
                    {Number(l.delta) >= 0 ? "+" : ""}
                    {Number(l.delta).toFixed(1)}
                  </span>
                  <span className="block text-[11px] tabular-nums text-muted">→ {Number(l.balance_after).toFixed(1)}</span>
                </span>
              </li>
            ))}
          </CompactList>
          <div className="table-wrap hidden lg:block">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Source</th>
                  <th>Delta</th>
                  <th>Balance</th>
                  <th>Reason / reference</th>
                </tr>
              </thead>
              <tbody>
                {detail.ledger.slice(0, shown).map((l) => (
                  <tr key={l.id}>
                    <td className="whitespace-nowrap">{new Date(l.created_at).toLocaleString()}</td>
                    <td>
                      <span className={`badge ${SOURCE_BADGE[l.source] ?? "badge-muted"}`}>{l.source}</span>
                    </td>
                    <td className={Number(l.delta) >= 0 ? "text-ok" : "text-danger"}>
                      {Number(l.delta) >= 0 ? "+" : ""}
                      {Number(l.delta).toFixed(2)}
                    </td>
                    <td>
                      {Number(l.balance_before).toFixed(1)} &rarr; {Number(l.balance_after).toFixed(1)}
                    </td>
                    <td className="max-w-xs truncate text-muted" title={l.reason ?? l.reference_id ?? ""}>
                      {l.reason ?? l.reference_id ?? "--"}
                    </td>
                  </tr>
                ))}
                {detail.ledger.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-muted">
                      No ledger history.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <MoreButton total={detail.ledger.length} shown={shown} onMore={showMore} />
          </div>
        </section>
      )}

      {tab === "sessions" && (
        <section>
          <p className="mb-2 text-xs text-muted">
            AI spent in total: <span className="font-medium text-ink">{formatAiCost(userAiCost?.totalUsd ?? 0, aiCosts)}</span>
            {aiCosts && ` (${userAiCost?.calls ?? 0} AI calls, including ones outside interviews like Resume Builder)`}
            {" · "}Deepgram in total:{" "}
            <span className="font-medium text-ink">{formatDeepgramCost(userAiCost?.deepgramUsd ?? 0, aiCosts)}</span>
          </p>
          {/* Phones/tablets: one compact row per session. */}
          <CompactList empty="No sessions." total={detail.sessions.length} shown={shown} onMore={showMore}>
            {detail.sessions.slice(0, shown).map((s) => {
              const ai = userAiCost?.sessions[s.id];
              return (
                <li key={s.id} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 text-sm font-medium text-ink">
                      <span className="truncate">{shortDateTime(s.started_at)}</span>
                      <span
                        className={`h-2 w-2 flex-shrink-0 rounded-full ${
                          s.status === "completed" ? "bg-ok" : s.status === "active" ? "bg-warn" : "bg-danger"
                        }`}
                        title={s.status + (s.termination_reason ? ` (${s.termination_reason})` : "")}
                      />
                      {s.status !== "completed" && <span className="text-xs font-normal text-muted">{s.status}</span>}
                    </p>
                    <p className="truncate text-xs text-muted">
                      {[
                        s.client_kind ? deviceLabel({ kind: s.client_kind, os: s.client_os ?? "unknown" }) : null,
                        s.actual_duration_seconds != null ? formatDuration(s.actual_duration_seconds) : null,
                        s.minutes_consumed != null ? `${Number(s.minutes_consumed).toFixed(1)} min${s.usage_deducted ? "" : " (not deducted)"}` : null,
                        aiCosts ? `AI ${formatAiCost(ai?.costUsd ?? 0, aiCosts)} · DG ${formatDeepgramCost(ai?.deepgramUsd ?? 0, aiCosts)}` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  {s.transcript_id ? (
                    <button
                      onClick={() => setOpenTranscriptId(s.transcript_id)}
                      className="flex-shrink-0 rounded-md border border-border px-2 py-1 text-xs font-medium text-accent"
                    >
                      {s.transcript_turn_count} turn{s.transcript_turn_count === 1 ? "" : "s"}
                    </button>
                  ) : s.ai_answers > 0 ? (
                    <span className="badge badge-danger flex-shrink-0">Missing</span>
                  ) : (
                    <span className="flex-shrink-0 text-[11px] text-muted">No questions</span>
                  )}
                </li>
              );
            })}
          </CompactList>
          <div className="table-wrap hidden lg:block">
            <table>
              <thead>
                <tr>
                  <th>Started</th>
                  <th>Status</th>
                  <th>Device</th>
                  <th>Duration</th>
                  <th>Minutes consumed</th>
                  <th>Deducted</th>
                  <th>AI spent</th>
                  <th>Deepgram</th>
                  <th>Transcript</th>
                </tr>
              </thead>
              <tbody>
                {detail.sessions.slice(0, shown).map((s) => (
                  <tr key={s.id}>
                    <td className="whitespace-nowrap">{new Date(s.started_at).toLocaleString()}</td>
                    <td>
                      <span
                        className={`badge ${
                          s.status === "completed" ? "badge-ok" : s.status === "active" ? "badge-warn" : "badge-danger"
                        }`}
                      >
                        {s.status}
                      </span>
                      {s.termination_reason && <span className="ml-1 text-xs text-muted">({s.termination_reason})</span>}
                    </td>
                    <td className="whitespace-nowrap text-xs">
                      {s.client_kind ? deviceLabel({ kind: s.client_kind, os: s.client_os ?? "unknown" }) : "--"}
                    </td>
                    <td>{s.actual_duration_seconds != null ? formatDuration(s.actual_duration_seconds) : "--"}</td>
                    <td>{s.minutes_consumed != null ? Number(s.minutes_consumed).toFixed(2) : "--"}</td>
                    <td>{s.usage_deducted ? "Yes" : "No"}</td>
                    <td className="whitespace-nowrap">{formatAiCost(userAiCost?.sessions[s.id]?.costUsd ?? 0, aiCosts)}</td>
                    <td className="whitespace-nowrap">{formatDeepgramCost(userAiCost?.sessions[s.id]?.deepgramUsd ?? 0, aiCosts)}</td>
                    <td>
                      {s.transcript_id ? (
                        <button
                          onClick={() => setOpenTranscriptId(s.transcript_id)}
                          onMouseEnter={() => prefetchTranscript(s.transcript_id!)}
                          className="btn-secondary px-2 py-1 text-xs"
                        >
                          {s.transcript_turn_count} turn{s.transcript_turn_count === 1 ? "" : "s"}
                        </button>
                      ) : s.ai_answers > 0 ? (
                        <span className="badge badge-danger" title="The AI answered in this session, but no transcript was ever saved">
                          Missing
                        </span>
                      ) : (
                        <span className="badge badge-muted" title="Nothing was asked in this session (e.g. a Test Audio run), so there was nothing to save">
                          No questions
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
                {detail.sessions.length === 0 && (
                  <tr>
                    <td colSpan={9} className="py-6 text-center text-muted">
                      No sessions.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <MoreButton total={detail.sessions.length} shown={shown} onMore={showMore} />
          </div>
        </section>
      )}

      {tab === "transcripts" && (
        <section>
          <CompactList empty="No transcripts." total={detail.transcripts.length} shown={shown} onMore={showMore}>
            {detail.transcripts.slice(0, shown).map((t) => (
              <li key={t.id}>
                <button onClick={() => setOpenTranscriptId(t.id)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink">
                      {t.role ?? "Interview"} {t.company ? `@ ${t.company}` : ""}
                    </span>
                    <span className="block truncate text-xs text-muted">
                      {shortDateTime(t.created_at)} · {formatDuration((t.ended_at_ms - t.started_at_ms) / 1000)}
                    </span>
                  </span>
                  <span className="flex-shrink-0 text-xs font-medium text-accent">
                    {t.turn_count} turn{t.turn_count === 1 ? "" : "s"}
                  </span>
                </button>
              </li>
            ))}
          </CompactList>
          <div className="table-wrap hidden lg:block">
            <table>
              <thead>
                <tr>
                  <th>Interview</th>
                  <th>Turns</th>
                  <th>Duration</th>
                  <th>Saved</th>
                </tr>
              </thead>
              <tbody>
                {detail.transcripts.slice(0, shown).map((t) => (
                  <tr key={t.id}>
                    <td>
                      <button
                        onClick={() => setOpenTranscriptId(t.id)}
                        onMouseEnter={() => prefetchTranscript(t.id)}
                        className="font-medium text-accent hover:underline"
                      >
                        {t.role ?? "Interview"} {t.company ? `@ ${t.company}` : ""}
                      </button>
                    </td>
                    <td>{t.turn_count}</td>
                    <td>{formatDuration((t.ended_at_ms - t.started_at_ms) / 1000)}</td>
                    <td className="whitespace-nowrap">{new Date(t.created_at).toLocaleString()}</td>
                  </tr>
                ))}
                {detail.transcripts.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-muted">
                      No transcripts.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <MoreButton total={detail.transcripts.length} shown={shown} onMore={showMore} />
          </div>
        </section>
      )}

      <TranscriptModal transcriptId={openTranscriptId} onClose={() => setOpenTranscriptId(null)} />

      {banOpen && (
        <Modal title={detail.profile.isBanned ? "Unban user" : "Ban user"} onClose={() => setBanOpen(false)}>
          <BanUserPanel
            userId={detail.profile.userId}
            isBanned={detail.profile.isBanned}
            banReason={detail.profile.banReason}
            bannedAt={detail.profile.bannedAt}
            bannedByEmail={detail.profile.bannedByEmail}
            onSuccess={() => {
              mutate();
              setBanOpen(false);
            }}
          />
        </Modal>
      )}

      {manageMinutesOpen && (
        <Modal title="Manage minutes" onClose={() => setManageMinutesOpen(false)}>
          <ManageMinutesPanel
            userId={detail.profile.userId}
            currentBalance={Number(detail.entitlement.remainingMinutes)}
            onSuccess={() => {
              mutate();
              setManageMinutesOpen(false);
            }}
          />
        </Modal>
      )}

      {grantPassOpen && (
        <Modal title="Grant a pass" onClose={() => setGrantPassOpen(false)}>
          <GrantPassPanel
            userId={detail.profile.userId}
            onSuccess={() => {
              mutate();
              setGrantPassOpen(false);
            }}
            onCancel={() => setGrantPassOpen(false)}
          />
        </Modal>
      )}

      {billingOpen && (
        <Modal title="Billing" onClose={() => setBillingOpen(false)}>
          <div className="space-y-5">
            {detail.purchases.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Purchases</h3>
                <ul className="mt-2 space-y-2 text-sm">
                  {detail.purchases.map((p) => (
                    <li key={p.id} className="border-b border-border pb-2 last:border-0 last:pb-0">
                      <p className="font-medium">
                        {p.plan_id} &middot; {formatPayment({ currency: p.currency, amountMinor: p.amount_minor, amountPaise: p.amount_paise })}
                      </p>
                      <p className="text-xs text-muted">{new Date(p.created_at).toLocaleString()}</p>
                      <p className="font-mono text-xs text-muted">{p.razorpay_order_id}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {detail.subscriptions.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Subscription</h3>
                <ul className="mt-2 space-y-2 text-sm">
                  {detail.subscriptions.map((s) => (
                    <li key={s.id}>
                      <p className="font-medium">
                        {s.plan} &middot; <span className="badge badge-muted">{s.status}</span>
                      </p>
                      {s.current_period_end && (
                        <p className="text-xs text-muted">Renews/ends {new Date(s.current_period_end).toLocaleDateString()}</p>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
