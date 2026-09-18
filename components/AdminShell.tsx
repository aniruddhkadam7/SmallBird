"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { Nav } from "@/components/Nav";
import { SignOutButton } from "@/components/SignOutButton";
import { ThemeToggle } from "@/components/ThemeToggle";

function Brand() {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-accent text-sm font-bold text-white">
        S
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-ink">Smallbird Admin</p>
        <p className="text-[11px] text-muted">Internal console</p>
      </div>
    </div>
  );
}

// Below lg the sidebar becomes an off-canvas drawer opened from a sticky top
// bar; at lg and up it's a permanent sticky column.
export function AdminShell({ email, children }: { email: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const initial = (email || "?").charAt(0).toUpperCase();

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

  return (
    <div className="min-h-screen lg:flex">
      <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-border bg-surface/90 px-4 py-3 backdrop-blur lg:hidden">
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
        <ThemeToggle />
      </header>

      <div
        onClick={() => setOpen(false)}
        aria-hidden
        className={`fixed inset-0 z-40 bg-ink/40 transition-opacity lg:hidden ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col border-r border-border bg-surface transition-transform duration-200 lg:sticky lg:top-0 lg:z-auto lg:h-screen lg:w-64 lg:max-w-none lg:flex-shrink-0 lg:translate-x-0 ${
          open ? "translate-x-0 shadow-xl" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-4">
          <Brand />
          <button
            onClick={() => setOpen(false)}
            aria-label="Close menu"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-subtle hover:text-ink lg:hidden"
          >
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto py-2">
          <Nav />
        </div>
        <div className="flex items-center gap-2.5 border-t border-border p-3">
          <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-accent/15 text-xs font-semibold text-accent">
            {initial}
          </div>
          <p className="min-w-0 flex-1 truncate text-xs text-muted">{email}</p>
          <ThemeToggle />
        </div>
        <div className="border-t border-border p-3">
          <SignOutButton />
        </div>
      </aside>

      <main className="min-w-0 flex-1 bg-subtle p-4 sm:p-6">{children}</main>
    </div>
  );
}
