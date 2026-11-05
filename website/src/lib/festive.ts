// Festive themes for site announcements (site_promotions.theme), shared by
// the server (lib/live-pricing.ts) and the decorations
// (components/blocks/festive-effects.tsx). Lives outside that "use client"
// file because the server can't read plain values exported from one.
export type FestiveTheme = "none" | "diwali" | "newyear" | "confetti"
export const FESTIVE_THEMES: FestiveTheme[] = ["none", "diwali", "newyear", "confetti"]
