"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export function SignOutButton({ collapsed = false }: { collapsed?: boolean }) {
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <button
      onClick={handleSignOut}
      aria-label="Sign out"
      title={collapsed ? "Sign out" : undefined}
      className={`btn-secondary flex w-full items-center justify-center gap-2 ${collapsed ? "lg:px-0" : ""}`}
    >
      <LogOut size={14} className={collapsed ? "lg:mr-0" : ""} />
      <span className={collapsed ? "lg:hidden" : ""}>Sign out</span>
    </button>
  );
}
