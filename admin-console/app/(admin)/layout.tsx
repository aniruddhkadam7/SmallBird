import { requireSession } from "@/lib/requireSession";
import { AdminShell } from "@/components/AdminShell";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();

  return <AdminShell email={session.user.email ?? ""}>{children}</AdminShell>;
}
