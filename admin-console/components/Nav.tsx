"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  CreditCard,
  Video,
  Receipt,
  Cpu,
  ShieldAlert,
  Activity,
  ScrollText,
  KeyRound,
  Settings,
  type LucideIcon,
} from "lucide-react";

const BUILT: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/users", label: "Users", icon: Users },
  { href: "/subscriptions", label: "Subscriptions", icon: CreditCard },
  // Transcripts are shown inline under each session now (see /sessions) --
  // no separate top-level nav entry. The list/detail pages still exist for
  // direct links from Sessions/Users, just not linked from here.
  { href: "/sessions", label: "Sessions", icon: Video },
  { href: "/payments", label: "Payments", icon: Receipt },
  { href: "/ai-usage", label: "AI Usage & Models", icon: Cpu },
  { href: "/abuse", label: "Abuse / Risk", icon: ShieldAlert },
  { href: "/system-health", label: "System Health", icon: Activity },
  { href: "/audit-logs", label: "Audit Logs", icon: ScrollText },
  { href: "/api-keys", label: "API Keys", icon: KeyRound },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <nav className="flex h-full flex-col gap-0.5 p-3">
      {BUILT.map((item) => {
        const active = pathname === item.href || pathname.startsWith(item.href + "/");
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`group flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              active ? "bg-accent text-white shadow-sm" : "text-ink/80 hover:bg-subtle hover:text-ink"
            }`}
          >
            <Icon size={16} className={active ? "text-white" : "text-muted group-hover:text-ink"} strokeWidth={2} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
