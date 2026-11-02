"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, UserPlus, CreditCard, type LucideIcon } from "lucide-react";
import useSWR from "swr";
import { createClient } from "@/lib/supabase/client";
import { formatJoined, formatPayment } from "@/lib/format";

// The bell: who registered and who paid in the last 7 days
// (admin_notifications). "New" means
// newer than the last time this browser opened the bell -- that's a
// per-viewer convenience, so it lives in localStorage.

const SEEN_KEY = "admin-notifications-seen";
const SEEN_EVENT = "notificationsseen";

interface Notification {
  kind: "signup" | "payment";
  userId: string;
  email: string;
  at: string;
  detail: { provider?: string; planId?: string; amountPaise?: number | null; currency?: string; amountMinor?: number | null };
}

function planName(id: string): string {
  return id.charAt(0).toUpperCase() + id.slice(1).replace(/[_-]/g, " ");
}

function describe(n: Notification): { icon: LucideIcon; tone: string; title: string } {
  switch (n.kind) {
    case "signup":
      return {
        icon: UserPlus,
        tone: "bg-accent/15 text-accent",
        title: n.detail.provider === "google" ? "New registration (Google)" : "New registration",
      };
    case "payment":
      return {
        icon: CreditCard,
        tone: "bg-ok/15 text-ok",
        title: `Paid ${formatPayment(n.detail)}${n.detail.planId ? ` · ${planName(n.detail.planId)}` : ""}`,
      };
  }
}

// Calls the RPC straight from the browser rather than through an admin-*
// Edge Function: admin_notifications() checks current_admin_user_id() itself
// (a non-admin gets an error), and skipping the function saves its cold start.
async function fetchNotifications(): Promise<Notification[]> {
  const { data, error } = await createClient().rpc("admin_notifications", { p_limit: 40 });
  if (error) throw new Error(error.message);
  return (data ?? []) as Notification[];
}

function readSeen(): number {
  try {
    const v = Number(localStorage.getItem(SEEN_KEY));
    if (v) return v;
  } catch {
    // Storage blocked -- fall through to the default.
  }
  // First time on this browser: count the last day as new.
  return Date.now() - 86_400_000;
}

// placement "below": opens under the phone top bar; "side": opens to the
// right of the desktop sidebar.
export function NotificationBell({ placement, className = "" }: { placement: "below" | "side"; className?: string }) {
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState<number | null>(null);
  // What "seen" was when the panel opened, so this open still highlights
  // the items that were new.
  const [seenAtOpen, setSeenAtOpen] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  const { data, error, mutate } = useSWR("admin_notifications", fetchNotifications, {
    refreshInterval: 60_000,
    dedupingInterval: 4000,
  });
  const items = data ?? [];
  const unread = seen === null ? 0 : items.filter((n) => Date.parse(n.at) > seen).length;

  // Read post-mount to avoid an SSR mismatch; keep the phone and desktop
  // bells (and other tabs) in step.
  useEffect(() => {
    setSeen(readSeen());
    const sync = () => setSeen(readSeen());
    const onStorage = (e: StorageEvent) => e.key === SEEN_KEY && sync();
    window.addEventListener(SEEN_EVENT, sync);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(SEEN_EVENT, sync);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setSeenAtOpen(seen ?? readSeen());
    setOpen(true);
    try {
      localStorage.setItem(SEEN_KEY, String(Date.now()));
    } catch {
      // Ignore -- the count just won't clear on reload.
    }
    window.dispatchEvent(new Event(SEEN_EVENT));
  }

  const panelPosition =
    placement === "below"
      ? "fixed inset-x-3 top-[calc(env(safe-area-inset-top)+4rem)]"
      : "absolute left-full top-0 ml-3 w-96";

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        onClick={toggle}
        aria-label={unread ? `Notifications, ${unread} new` : "Notifications"}
        aria-expanded={open}
        title="Notifications"
        className="relative flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-subtle hover:text-ink lg:h-8 lg:w-8"
      >
        <Bell size={18} strokeWidth={1.8} />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold leading-none text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className={`${panelPosition} z-50 overflow-hidden rounded-xl border border-border bg-surface shadow-xl`}>
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <p className="text-sm font-semibold text-ink">Notifications</p>
            <p className="text-[11px] text-muted">Last 7 days</p>
          </div>
          <div className="max-h-[min(28rem,70vh)] overflow-y-auto">
            {error && !data ? (
              <div className="px-4 py-6 text-center text-sm text-muted">
                <p>Couldn&apos;t load notifications.</p>
                <button onClick={() => mutate()} className="mt-2 font-medium text-accent hover:underline">
                  Try again
                </button>
              </div>
            ) : !data ? (
              <p className="px-4 py-6 text-center text-sm text-muted">Loading...</p>
            ) : items.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted">Nothing new this week.</p>
            ) : (
              items.map((n, i) => {
                const { icon: Icon, tone, title } = describe(n);
                const isNew = Date.parse(n.at) > seenAtOpen;
                return (
                  <Link
                    key={`${n.kind}-${n.userId}-${n.at}-${i}`}
                    href={`/users/${n.userId}`}
                    className={`flex items-start gap-3 border-b border-border px-4 py-3 last:border-b-0 hover:bg-subtle ${
                      isNew ? "bg-accent/5" : ""
                    }`}
                  >
                    <span className={`mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full ${tone}`}>
                      <Icon size={15} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-ink">{title}</span>
                      <span className="block truncate text-xs text-muted">{n.email}</span>
                    </span>
                    <span className="flex flex-shrink-0 flex-col items-end gap-1">
                      <span className="whitespace-nowrap text-[11px] text-muted">{formatJoined(n.at)}</span>
                      {isNew && <span className="h-2 w-2 rounded-full bg-accent" aria-label="New" />}
                    </span>
                  </Link>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
