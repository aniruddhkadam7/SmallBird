"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";

// Page frame: on desktop (lg+) the sidebar sits beside the content; on
// phones it's a slide-in drawer behind a top bar, so tables get the full
// screen width. Only <main> scrolls, and it can shrink below its widest
// table (min-w-0) -- wide tables scroll inside their own .table-wrap instead
// of dragging the whole page sideways.
export function AdminShell({ sidebar, children }: { sidebar: React.ReactNode; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Close the drawer after navigating.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <div className="flex h-dvh overflow-hidden">
      {open && (
        <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setOpen(false)} aria-hidden="true" />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-shrink-0 flex-col border-r border-border bg-surface transition-transform duration-200 lg:static lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="absolute right-2 top-4 rounded-lg p-1.5 text-muted hover:bg-subtle hover:text-ink lg:hidden"
          aria-label="Close menu"
        >
          <X size={18} />
        </button>
        {sidebar}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2.5 border-b border-border bg-surface px-3 py-2.5 lg:hidden">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-lg p-1.5 text-ink hover:bg-subtle"
            aria-label="Open menu"
          >
            <Menu size={20} />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element -- tiny static logo, no optimization needed */}
          <img src="/smallbird-logo.png" alt="" width={24} height={24} className="h-6 w-6" />
          <span className="text-sm font-semibold text-ink">Smallbird Admin</span>
        </header>
        <main className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden bg-subtle p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
