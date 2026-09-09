import { requireSession } from "@/lib/requireSession";
import { Nav } from "@/components/Nav";
import { SignOutButton } from "@/components/SignOutButton";
import { ThemeToggle } from "@/components/ThemeToggle";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const initial = (session.user.email ?? "?").charAt(0).toUpperCase();

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-64 flex-shrink-0 flex-col border-r border-border bg-surface">
        <div className="flex items-center gap-2.5 border-b border-border px-4 py-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-sm font-bold text-white">
            S
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-ink">Smallbird Admin</p>
            <p className="text-[11px] text-muted">Internal console</p>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto py-2">
          <Nav />
        </div>
        <div className="flex items-center gap-2.5 border-t border-border p-3">
          <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-accent/15 text-xs font-semibold text-accent">
            {initial}
          </div>
          <p className="min-w-0 flex-1 truncate text-xs text-muted">{session.user.email}</p>
          <ThemeToggle />
        </div>
        <div className="border-t border-border p-3">
          <SignOutButton />
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto bg-subtle p-6">{children}</main>
    </div>
  );
}
