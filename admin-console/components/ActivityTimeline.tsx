"use client";

import { useState } from "react";
import {
  UserPlus,
  Gift,
  Mail,
  Monitor,
  Smartphone,
  Globe,
  Mic,
  Hourglass,
  CreditCard,
  Wrench,
  Ban,
  Eye,
  AlertTriangle,
  type LucideIcon,
} from "lucide-react";
import { formatDuration, formatMinutes, formatRupees } from "@/lib/format";
import type { DeviceKind, DeviceOs } from "@/lib/devices";

// The person's journey on one line each, oldest first: registered, free
// minutes, app installed, first interview, ran out, bought... Built from
// the same data the rest of the user page shows (admin_user_detail).

interface TimelineInput {
  profile: {
    createdAt: string;
    lastSignInAt: string | null;
    signUpProvider: string | null;
    welcomeEmailSentAt?: string | null;
    isBanned: boolean;
    bannedAt: string | null;
    banReason: string | null;
  };
  devices: { kind: DeviceKind; os: DeviceOs; appVersion: string | null; firstSeenAt: string; lastSeenAt: string }[];
  ledger: {
    id: number;
    delta: number;
    balance_before: number;
    balance_after: number;
    source: string;
    reference_id: string | null;
    reason: string | null;
    created_at: string;
  }[];
  purchases: { id: number; plan_id: string; amount_paise: number; razorpay_order_id: string; created_at: string }[];
  sessions: { id: string; started_at: string; actual_duration_seconds: number | null; minutes_consumed: number | null; plan_id?: string | null }[];
}

type Tone = "accent" | "ok" | "warn" | "danger" | "muted";

interface Event {
  at: string;
  // Breaks ties between events in the same moment (Registered comes before
  // the free minutes it triggers, a purchase before the interview it pays for).
  order: number;
  icon: LucideIcon;
  tone: Tone;
  title: string;
  detail?: string;
  // Interviews after the first are grouped into one line per run.
  kind?: "session";
  sessions?: TimelineInput["sessions"];
}

const TONE: Record<Tone, string> = {
  accent: "bg-accent/15 text-accent",
  ok: "bg-ok/15 text-ok",
  warn: "bg-warn/15 text-warn",
  danger: "bg-danger/15 text-danger",
  muted: "bg-ink/10 text-muted",
};

const OS_NAME: Record<string, string> = { windows: "Windows", macos: "Mac", linux: "Linux", android: "Android", ios: "iPhone" };

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
}

// "Today", "Yesterday", or "Wed, 8 Oct 2026" -- the heading over each day.
function dayOf(iso: string): string {
  const d = new Date(iso);
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(new Date()) - start(d)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

const ms = (iso: string) => Date.parse(iso);

function planName(id: string): string {
  return id.charAt(0).toUpperCase() + id.slice(1).replace(/[_-]/g, " ");
}

function buildEvents(d: TimelineInput): Event[] {
  const events: Event[] = [];
  const p = d.profile;

  events.push({
    at: p.createdAt,
    order: 0,
    icon: UserPlus,
    tone: "accent",
    title: "Registered",
    detail: p.signUpProvider ? `Signed up with ${p.signUpProvider === "google" ? "Google" : p.signUpProvider}` : undefined,
  });
  if (p.welcomeEmailSentAt) {
    events.push({ at: p.welcomeEmailSentAt, order: 2, icon: Mail, tone: "muted", title: "Welcome email sent", detail: "Download the app" });
  }

  for (const dev of d.devices) {
    const os = OS_NAME[dev.os];
    if (dev.kind === "desktop") {
      events.push({
        at: dev.firstSeenAt,
        order: 3,
        icon: Monitor,
        tone: "ok",
        title: `Started using the desktop app${os ? ` on ${os}` : ""}`,
        detail: dev.appVersion ? `Version ${dev.appVersion}` : undefined,
      });
    } else if (dev.kind === "browser" && (dev.os === "android" || dev.os === "ios")) {
      events.push({ at: dev.firstSeenAt, order: 3, icon: Smartphone, tone: "ok", title: `Used Smallbird on their phone (${os})` });
    } else {
      events.push({ at: dev.firstSeenAt, order: 3, icon: Globe, tone: "muted", title: `Signed in on the website${os ? ` (${os})` : ""}` });
    }
  }

  // Minute changes. Purchases are listed from the payments themselves below,
  // so their ledger rows only matter when they credit a payment twice.
  const credited = new Set<string>();
  for (const l of [...d.ledger].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    const delta = Number(l.delta);
    if (l.source === "SIGNUP_GRANT") {
      events.push({ at: l.created_at, order: 1, icon: Gift, tone: "accent", title: `Got ${formatMinutes(delta)} free minutes`, detail: "Free trial" });
    } else if (l.source === "PURCHASE") {
      const ref = l.reference_id ?? "";
      if (credited.has(ref)) {
        events.push({
          at: l.created_at,
          order: 5,
          icon: AlertTriangle,
          tone: "warn",
          title: `Same payment credited again (+${formatMinutes(delta)} min)`,
          detail: "No new payment for this",
        });
      }
      credited.add(ref);
    } else if (l.source === "USAGE") {
      if (Number(l.balance_before) > 0 && Number(l.balance_after) <= 0) {
        events.push({ at: l.created_at, order: 8, icon: Hourglass, tone: "warn", title: "Ran out of minutes" });
      }
    } else {
      const added = delta >= 0;
      events.push({
        at: l.created_at,
        order: 5,
        icon: Wrench,
        tone: "muted",
        title: `${l.source === "REFUND_ADJUSTMENT" ? "Refund" : "Admin"} ${added ? "added" : "removed"} ${formatMinutes(Math.abs(delta))} min`,
        detail: l.reason ?? undefined,
      });
    }
  }

  for (const pu of d.purchases) {
    const minutes = d.ledger.find((l) => l.source === "PURCHASE" && l.reference_id === pu.razorpay_order_id);
    events.push({
      at: pu.created_at,
      order: 4,
      icon: CreditCard,
      tone: "ok",
      title: `Bought ${planName(pu.plan_id)} · ${formatRupees(pu.amount_paise)}`,
      detail: minutes ? `+${formatMinutes(Number(minutes.delta))} minutes` : undefined,
    });
  }

  for (const s of d.sessions) {
    events.push({ at: s.started_at, order: 7, icon: Mic, tone: "accent", title: "", kind: "session", sessions: [s] });
  }

  if (p.isBanned && p.bannedAt) {
    events.push({ at: p.bannedAt, order: 9, icon: Ban, tone: "danger", title: "Banned", detail: p.banReason ?? undefined });
  }

  // Nothing happens before registering; the free-minutes grant can be
  // stamped a split second before the account itself.
  for (const e of events) if (ms(e.at) < ms(p.createdAt)) e.at = p.createdAt;
  // By real time (not text), then by `order` for the same moment.
  events.sort((a, b) => ms(a.at) - ms(b.at) || a.order - b.order);

  // The first interview gets its own line; later runs of back-to-back
  // interviews (nothing else happened in between) become one line each.
  const out: Event[] = [];
  let seenFirst = false;
  for (const e of events) {
    if (e.kind !== "session") {
      out.push(e);
      continue;
    }
    const s = e.sessions![0];
    if (!seenFirst) {
      seenFirst = true;
      out.push({
        ...e,
        title: s.plan_id === "free" ? "First interview, on the free trial" : "First interview",
        detail: s.actual_duration_seconds != null ? formatDuration(s.actual_duration_seconds) : undefined,
      });
      continue;
    }
    const last = out[out.length - 1];
    // Grouped only within one day, so each group sits under the right day heading.
    if (
      last?.kind === "session" &&
      last.title !== "" &&
      !last.title.startsWith("First") &&
      dayOf(last.sessions![0].started_at) === dayOf(s.started_at)
    ) {
      last.sessions!.push(s);
    } else {
      out.push({ ...e, title: "group", sessions: [s] });
    }
  }
  for (const e of out) {
    if (e.kind === "session" && !e.title.startsWith("First")) {
      const n = e.sessions!.length;
      const secs = e.sessions!.reduce((t, s) => t + (s.actual_duration_seconds ?? 0), 0);
      e.title = n === 1 ? "Did an interview" : `${n} interviews`;
      const parts = [];
      if (n > 1) parts.push(`until ${timeOf(e.sessions![n - 1].started_at)}`);
      if (secs > 0) parts.push(formatDuration(secs) + (n > 1 ? " in total" : ""));
      e.detail = parts.join(" · ") || undefined;
    }
  }

  // "Last seen" only when it's later than everything above, including the
  // last interview of a grouped run.
  const lastSeen = [p.lastSignInAt, ...d.devices.map((x) => x.lastSeenAt)]
    .filter((x): x is string => Boolean(x))
    .sort((a, b) => ms(a) - ms(b))
    .pop();
  const latest = Math.max(
    0,
    ...out.map((e) => ms(e.at)),
    ...d.sessions.map((x) => ms(x.started_at) + (x.actual_duration_seconds ?? 0) * 1000),
  );
  if (lastSeen && ms(lastSeen) > latest) {
    out.push({ at: lastSeen, order: 10, icon: Eye, tone: "muted", title: "Last seen" });
  }
  return out;
}

const COLLAPSED = 12;

export function ActivityTimeline({ detail }: { detail: TimelineInput }) {
  const events = buildEvents(detail);
  const [showAll, setShowAll] = useState(false);
  // Long histories open on the latest activity, with the start one tap away.
  const hidden = showAll ? 0 : Math.max(events.length - COLLAPSED, 0);
  const shown = events.slice(hidden);

  return (
    <section className="card">
      <h2 className="mb-4 text-sm font-semibold text-ink">Activity timeline</h2>
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="mb-3 w-full rounded-lg bg-subtle py-2 text-xs font-medium text-accent hover:bg-ink/[0.06]"
        >
          Show {hidden} earlier event{hidden === 1 ? "" : "s"}
        </button>
      )}
      <ol className="relative">
        {shown.map((e, i) => {
          const Icon = e.icon;
          const day = dayOf(e.at);
          const newDay = i === 0 || dayOf(shown[i - 1].at) !== day;
          return (
            <li key={`${e.at}-${i}`} className="relative">
              {newDay && (
                <p className={`mb-3 text-[11px] font-semibold uppercase tracking-wide text-muted ${i === 0 ? "" : "pt-1"}`}>{day}</p>
              )}
              <div className="relative flex gap-3 pb-5">
              {i < shown.length - 1 && <span aria-hidden className="absolute left-[15px] top-8 h-[calc(100%-2rem)] w-px bg-border" />}
              <span className={`relative z-10 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full ${TONE[e.tone]}`}>
                <Icon size={15} strokeWidth={2.2} />
              </span>
              <div className="min-w-0 flex-1 pt-1">
                <p className="text-sm font-medium text-ink">{e.title}</p>
                <p className="text-xs text-muted">
                  <span className="font-medium tabular-nums text-ink/70">{timeOf(e.at)}</span>
                  {e.detail && <> · {e.detail}</>}
                </p>
              </div>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
