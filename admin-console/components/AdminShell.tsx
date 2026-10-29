"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import Image from "next/image";
import { Menu, X, ChevronsLeft, ChevronsRight, LayoutDashboard, Users, Video, Receipt, type LucideIcon } from "lucide-react";
import { Nav } from "@/components/Nav";
import { SignOutButton } from "@/components/SignOutButton";
import { ThemeToggle } from "@/components/ThemeToggle";
import { NotificationBell } from "@/components/NotificationBell";
import { Wordmark } from "@/components/Wordmark";

const COLLAPSE_KEY = "admin-sidebar-collapsed";

// The phone tab bar's shortcuts; everything else is under "More" (the drawer).
const TABS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/dashboard", label: "Home", icon: LayoutDashboard },
  { href: "/users", label: "Users", icon: Users },
  { href: "/sessions", label: "Sessions", icon: Video },
  { href: "/payments", label: "Payments", icon: Receipt },
];

// On phones every table is shown as a stack of cards (see globals.css), and
// each cell needs its column name to label it. Copies each header's text
// onto the cells below it as data-label, and keeps doing so as tables
// re-render with new data.
function useTableCellLabels() {
  useEffect(() => {
    const label = () => {
      document.querySelectorAll("table").forEach((table) => {
        const heads = Array.from(table.querySelectorAll("thead th")).map((th) => th.textContent?.trim() ?? "");
        table.querySelectorAll("tbody tr").forEach((tr) => {
          Array.from(tr.children).forEach((td, i) => {
            const text = (td as HTMLElement).hasAttribute("colspan") ? "" : heads[i] ?? "";
            if (td.getAttribute("data-label") !== text) td.setAttribute("data-label", text);
          });
        });
      });
    };
    label();
    const observer = new MutationObserver(label);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
}

function Brand({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <Link href="/dashboard" prefetch aria-label="Home" className="flex min-w-0 items-center gap-2.5">
      <Image src="/smallbird-logo.png" alt="" width={32} height={32} className="h-8 w-8 flex-shrink-0" />
      <div className={`min-w-0 ${collapsed ? "lg:hidden" : ""}`}>
        <p className="whitespace-nowrap leading-tight">
          <Wordmark className="text-[18px]" />
        </p>
        <p className="text-[11px] text-muted">Admin console</p>
      </div>
    </Link>
  );
}

// Below lg the sidebar becomes an off-canvas drawer opened from a sticky top
// bar; at lg and up it's a permanent sticky column that can also collapse
// down to an icon-only rail (toggle persisted in localStorage, same pattern
// as ThemeToggle) to reclaim width for wide tables.
export function AdminShell({ email, children }: { email: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();
  const initial = (email || "?").charAt(0).toUpperCase();
  useTableCellLabels();

  // Close the drawer after navigating.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Lock background scroll and allow Escape to close while the drawer is open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Read the saved collapse preference post-mount to avoid an SSR mismatch.
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {
      // Private browsing / storage blocked -- stays expanded.
    }
  }, []);

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
    } catch {
      // Ignore -- preference just won't persist.
    }
  }

  return (
    <div className="min-h-screen lg:flex">
      <header className="safe-x sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-border bg-surface/90 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur lg:hidden">
        <button
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          aria-expanded={open}
          className="-ml-1.5 flex h-9 w-9 items-center justify-center rounded-lg text-ink transition-colors hover:bg-subtle"
        >
          <Menu size={20} />
        </button>
        <div className="min-w-0 flex-1">
          <Brand />
        </div>
        <div className="flex items-center gap-1">
          <NotificationBell placement="below" />
          <ThemeToggle />
        </div>
      </header>

      <div
        onClick={() => setOpen(false)}
        aria-hidden
        className={`fixed inset-0 z-40 bg-ink/40 transition-opacity lg:hidden ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col border-r border-border bg-surface pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] transition-transform lg:pb-0 lg:pt-0 duration-200 lg:sticky lg:top-0 lg:z-auto lg:h-screen lg:max-w-none lg:flex-shrink-0 lg:translate-x-0 lg:transition-[width] lg:duration-150 ${
          open ? "translate-x-0 shadow-xl" : "-translate-x-full"
        } ${collapsed ? "lg:w-16" : "lg:w-52"}`}
      >
        <button
          onClick={toggleCollapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="absolute -right-3 top-5 z-10 hidden h-6 w-6 items-center justify-center rounded-full border border-border bg-surface text-muted shadow-sm hover:text-ink lg:flex"
        >
          {collapsed ? <ChevronsRight size={13} /> : <ChevronsLeft size={13} />}
        </button>

        <div
          className={`flex items-center justify-between gap-2 border-b border-border px-4 py-4 ${
            collapsed ? "lg:flex-col lg:px-2" : "lg:pl-4 lg:pr-2"
          }`}
        >
          <Brand collapsed={collapsed} />
          <NotificationBell placement="side" className="hidden lg:block" />
          <button
            onClick={() => setOpen(false)}
            aria-label="Close menu"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-subtle hover:text-ink lg:hidden"
          >
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto overflow-x-hidden py-2">
          <Nav collapsed={collapsed} />
        </div>
        <div className={`flex items-center gap-2.5 border-t border-border p-3 ${collapsed ? "lg:flex-col" : ""}`}>
          <div
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-accent/15 text-xs font-semibold text-accent"
            title={collapsed ? email : undefined}
          >
            {initial}
          </div>
          <p className={`min-w-0 flex-1 truncate text-xs text-muted ${collapsed ? "lg:hidden" : ""}`}>{email}</p>
          <ThemeToggle />
        </div>
        <div className="border-t border-border p-3">
          <SignOutButton collapsed={collapsed} />
        </div>
      </aside>

      <main className="safe-x min-w-0 flex-1 overflow-x-hidden bg-subtle pb-[calc(5.5rem+env(safe-area-inset-bottom))] pt-4 sm:pt-6 lg:p-6">
        {children}
      </main>

      <nav
        aria-label="Main"
        className="safe-x fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-border bg-surface/90 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
      >
        {TABS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              prefetch
              className={`flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${active ? "text-accent" : "text-muted"}`}
            >
              <Icon size={21} strokeWidth={active ? 2.4 : 2} />
              {label}
            </Link>
          );
        })}
        <button
          onClick={() => setOpen(true)}
          aria-label="More pages"
          className={`flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${
            TABS.some((t) => pathname === t.href || pathname.startsWith(t.href + "/")) ? "text-muted" : "text-accent"
          }`}
        >
          <Menu size={21} />
          More
        </button>
      </nav>
    </div>
  );
}
