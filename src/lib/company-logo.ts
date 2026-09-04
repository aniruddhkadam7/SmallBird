import { COMPANIES } from "./companies"

// Publishable key for img.logo.dev — safe to ship client-side (rate-limited,
// image-only, distinct from the secret key used for server-side lookups).
// Same key used by the desktop app's own company picker.
const LOGO_DEV_TOKEN = "pk_Kr0oY6iDRiGgziV3_bgwyA"

/// Resolves a free-typed company name (as stored on interview_transcripts,
/// e.g. "Morgan Stanley") to a known domain, so a logo can be fetched for
/// it — case-insensitive exact match against the bundled COMPANIES list.
/// Returns null for anything not in that list; callers should render no logo
/// (not a broken image) in that case.
export function resolveCompanyDomain(name: string | null | undefined): string | null {
  if (!name) return null
  const lowered = name.trim().toLowerCase()
  if (!lowered) return null
  return COMPANIES.find((c) => c.name.toLowerCase() === lowered)?.domain ?? null
}

export function logoUrlForDomain(domain: string, size = 32): string {
  const params = new URLSearchParams({ size: String(size), token: LOGO_DEV_TOKEN })
  return `https://img.logo.dev/${domain}?${params.toString()}`
}
