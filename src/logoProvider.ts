// Company logo lookup for the "Start Interview" details prompt (see
// CompanySelect.tsx). Uses Logo.dev's image CDN, which resolves a domain to
// a small PNG logo — the same shape Clearbit's now-defunct free logo API
// used, just under a new operator.
//
// LOGO_DEV_TOKEN is a *publishable* key (safe to ship client-side, rate-
// limited, image-only) — not a secret. Get a free one at https://logo.dev
// (no card required) and paste it in below; logos still resolve without it,
// just at lower quality/possibly watermarked, so this feature works either
// way.
export const LOGO_DEV_TOKEN = "pk_Kr0oY6iDRiGgziV3_bgwyA";

export function logoUrlForDomain(domain: string, size = 32): string {
  const params = new URLSearchParams({ size: String(size) });
  if (LOGO_DEV_TOKEN) params.set("token", LOGO_DEV_TOKEN);
  return `https://img.logo.dev/${domain}?${params.toString()}`;
}
