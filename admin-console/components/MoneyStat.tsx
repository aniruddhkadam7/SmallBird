// Stat tile for the AI usage page cost cards.

/// A stat tile: rupees large, dollars small underneath, so it fits half a
/// phone screen.
export function MoneyStat({ label, usd, rate, danger }: { label: string; usd: number | null; rate: number; danger?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className={`mt-1.5 text-xl font-semibold tabular-nums sm:text-2xl ${danger ? "text-danger" : "text-ink"}`}>
        {usd == null ? "—" : `₹${(usd * rate).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
      </p>
      {usd != null && <p className="text-xs tabular-nums text-muted">${usd.toFixed(2)}</p>}
    </div>
  );
}
