"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useAdminQuery, AdminApiError, prefetchAdminQuery } from "@/lib/useAdminQuery";
import { Unauthorized } from "@/components/Unauthorized";
import { PageLoading } from "@/components/PageLoading";
import { ManageMinutesPanel } from "@/components/ManageMinutesPanel";
import { GrantPassPanel } from "@/components/GrantPassPanel";
import { TranscriptModal } from "@/components/TranscriptModal";
import { BanUserPanel } from "@/components/BanUserPanel";
import { Modal } from "@/components/Modal";
import { formatDuration } from "@/lib/format";
import { deviceBadge, deviceLabel, userStage, type DeviceKind, type DeviceOs } from "@/lib/devices";

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
  amount_paise: number;
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

interface UserDetail {
  profile: { userId: string; email: string; displayName: string | null; createdAt: string; lastSignInAt: string | null; signUpProvider: string | null; isOwner: boolean; isBanned: boolean; banReason: string | null; bannedAt: string | null; bannedByEmail: string | null };
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

export default function UserDetailPage() {
  const params = useParams<{ id: string }>();
  const userId = params.id;

  const { data: detail, error, mutate } = useAdminQuery<UserDetail>("admin-user-detail", { userId });
  const [openTranscriptId, setOpenTranscriptId] = useState<string | null>(null);
  const [manageMinutesOpen, setManageMinutesOpen] = useState(false);
  const [grantPassOpen, setGrantPassOpen] = useState(false);
  const [banOpen, setBanOpen] = useState(false);
  const [billingOpen, setBillingOpen] = useState(false);

  if (error instanceof AdminApiError && error.status === 403) return <Unauthorized />;
  if (error instanceof AdminApiError && error.status === 404) return <p className="text-sm text-muted">User not found.</p>;
  if (!detail) return <PageLoading error={error} />;

  const hasBilling = detail.purchases.length > 0 || detail.subscriptions.length > 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="break-all text-lg font-semibold text-ink">{detail.profile.email}</h1>
            {detail.profile.isOwner && <span className="badge badge-ok">Owner</span>}
            {detail.profile.isBanned && <span className="badge badge-danger">Banned</span>}
          </div>
          <p className="text-sm text-muted">
            {detail.profile.displayName ?? "No display name"} &middot; joined{" "}
            {new Date(detail.profile.createdAt).toLocaleString()}
            {detail.profile.lastSignInAt && <> &middot; last sign-in {new Date(detail.profile.lastSignInAt).toLocaleString()}</>}
            {detail.profile.signUpProvider && <> &middot; signed up with {detail.profile.signUpProvider === "google" ? "Google" : detail.profile.signUpProvider}</>}
          </p>
          <p className="mt-1 text-sm font-medium text-ink">{userStage(detail.devices, detail.sessionsSummary.total)}</p>
          <p className="mt-1 break-all font-mono text-xs text-muted">{detail.profile.userId}</p>
        </div>
        {/* All admin actions and secondary info live behind these buttons instead
            of a permanent right-hand column, so the tables below get the page's
            full width. */}
        <div className="flex flex-shrink-0 flex-wrap gap-2">
          <button type="button" onClick={() => setManageMinutesOpen(true)} className="btn-secondary px-2.5 py-1.5 text-xs">
            Manage minutes
          </button>
          <button type="button" onClick={() => setGrantPassOpen(true)} className="btn-secondary px-2.5 py-1.5 text-xs">
            Grant a pass
          </button>
          <button type="button" onClick={() => setBanOpen(true)} className="btn-secondary px-2.5 py-1.5 text-xs">
            {detail.profile.isBanned ? "Unban user" : "Ban user"}
          </button>
          {hasBilling && (
            <button type="button" onClick={() => setBillingOpen(true)} className="btn-secondary px-2.5 py-1.5 text-xs">
              Billing
            </button>
          )}
        </div>
      </div>

      <div className="space-y-6">
        <section className="card">
          <h2 className="text-sm font-semibold text-ink">Overview</h2>
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-6">
            <div>
              <p className="text-xs text-muted">Plan</p>
              <p className="text-base font-medium">{detail.entitlement.planId}</p>
            </div>
            <div>
              <p className="text-xs text-muted">Remaining</p>
              <p className="text-base font-medium">{Number(detail.entitlement.remainingMinutes).toFixed(1)} min</p>
            </div>
            <div>
              <p className="text-xs text-muted">Period end</p>
              <p className="text-base font-medium">
                {detail.entitlement.periodEnd ? new Date(detail.entitlement.periodEnd).toLocaleDateString() : "--"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted">Interviews</p>
              <p className="text-base font-medium">{detail.sessionsSummary.total}</p>
            </div>
            <div>
              <p className="text-xs text-muted">Completed</p>
              <p className="text-base font-medium">{detail.sessionsSummary.completed}</p>
            </div>
            <div>
              <p className="text-xs text-muted">Terminated</p>
              <p className="text-base font-medium">{detail.sessionsSummary.terminated}</p>
            </div>
            <div>
              <p className="text-xs text-muted">Expired</p>
              <p className="text-base font-medium">{detail.sessionsSummary.expired}</p>
            </div>
            <div>
              <p className="text-xs text-muted">Transcripts</p>
              <p className="text-base font-medium">{detail.transcriptCount}</p>
            </div>
            <div>
              <p className="text-xs text-muted">LLM calls</p>
              <p className="text-base font-medium">{detail.usageCostsSummary.totalCalls}</p>
            </div>
            <div>
              <p className="text-xs text-muted">Input tokens</p>
              <p className="text-base font-medium">{detail.usageCostsSummary.totalInputTokens.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-xs text-muted">Output tokens</p>
              <p className="text-base font-medium">{detail.usageCostsSummary.totalOutputTokens.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-xs text-muted">Est. AI cost</p>
              <p className="text-base font-medium">${detail.usageCostsSummary.estimatedCostUsd.toFixed(4)}</p>
            </div>
          </div>
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold text-ink">Devices ({detail.devices.length})</h2>
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

        <section>
          <h2 className="mb-2 text-sm font-semibold text-ink">Entitlement ledger ({detail.ledger.length})</h2>
          <div className="table-wrap max-h-96 overflow-y-auto">
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
                {detail.ledger.map((l) => (
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
          </div>
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold text-ink">Interview sessions ({detail.sessions.length})</h2>
          <div className="table-wrap max-h-96 overflow-y-auto">
            <table>
              <thead>
                <tr>
                  <th>Started</th>
                  <th>Status</th>
                  <th>Device</th>
                  <th>Duration</th>
                  <th>Minutes consumed</th>
                  <th>Deducted</th>
                  <th>Transcript</th>
                </tr>
              </thead>
              <tbody>
                {detail.sessions.map((s) => (
                  <tr key={s.id}>
                    <td className="whitespace-nowrap">{new Date(s.started_at).toLocaleString()}</td>
                    <td>
                      <span
                        className={`badge ${
                          s.status === "completed"
                            ? "badge-ok"
                            : s.status === "active"
                              ? "badge-warn"
                              : "badge-danger"
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
                    <td>
                      {s.transcript_id ? (
                        <button
                          onClick={() => setOpenTranscriptId(s.transcript_id)}
                          onMouseEnter={() => prefetchAdminQuery("admin-transcript-detail", { transcriptId: s.transcript_id })}
                          className="btn-secondary px-2 py-1 text-xs"
                        >
                          {s.transcript_turn_count} turn{s.transcript_turn_count === 1 ? "" : "s"}
                        </button>
                      ) : (
                        <span className="badge badge-danger" title="No transcript was ever saved for this session">
                          Missing
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
                {detail.sessions.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-6 text-center text-muted">
                      No sessions.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold text-ink">Transcripts ({detail.transcripts.length})</h2>
          <div className="table-wrap max-h-96 overflow-y-auto">
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
                {detail.transcripts.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <button
                        onClick={() => setOpenTranscriptId(t.id)}
                        onMouseEnter={() => prefetchAdminQuery("admin-transcript-detail", { transcriptId: t.id })}
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
          </div>
        </section>
      </div>

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
                        {p.plan_id} &middot; ₹{(p.amount_paise / 100).toFixed(2)}
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
