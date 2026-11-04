// The SmallBird™ wordmark exactly as the desktop app and website draw it:
// Playfair Display bold, with a small ™.
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`font-brand font-bold tracking-[0.01em] text-ink ${className}`}>
      SmallBird AI
      <sup className="ml-px text-[0.55em] font-normal">™</sup>
    </span>
  );
}
