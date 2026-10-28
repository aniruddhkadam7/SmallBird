import Link from "next/link";
import { X } from "lucide-react";

// "Showing: Joined today ✕" -- names the slice a Home card opened; the ✕
// goes back to the full list.
export function FilterChip({ label, clearHref }: { label: string; clearHref: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-muted">Showing</span>
      <Link
        href={clearHref}
        className="inline-flex items-center gap-1.5 rounded-full bg-accent/10 py-1 pl-3 pr-2 font-medium text-accent hover:bg-accent/15"
        aria-label={`${label} -- remove this filter`}
      >
        {label}
        <X size={14} aria-hidden />
      </Link>
    </div>
  );
}
