import type { ResumeData } from "./types"

// The editor's "Resume check": quick tips worked out in the browser (no AI),
// about what recruiters and ATS filters look for. Most important first.

const WEAK_START = /^(responsible for|worked on|helped|assisted|involved in|duties included|tasks included)\b/i
const BUZZWORDS = /\b(synergy|leverage|leveraged|go-getter|hard[- ]working|team player|results[- ]driven|detail[- ]oriented)\b/i

function words(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

export function resumeTips(data: ResumeData): string[] {
  const tips: string[] = []
  const contact = data.contact.map((c) => `${c.label} ${c.value}`.toLowerCase())
  const hasValue = (test: (s: string) => boolean) => data.contact.some((c) => c.value && test(`${c.label} ${c.value}`.toLowerCase()))

  if (!data.name.trim()) tips.push("Add your full name at the top.")
  if (!hasValue((s) => s.includes("@"))) tips.push("Add your e-mail address.")
  if (!hasValue((s) => /\d{7,}|\d[\d\s-]{8,}\d/.test(s))) tips.push("Add a phone number recruiters can call.")
  if (!contact.some((s) => s.includes("linkedin"))) tips.push("Add your LinkedIn profile link.")

  const summary = data.sections.find((s) => s.kind === "text" && s.text.trim())
  if (!summary) tips.push("Add a 2–3 line summary at the top saying who you are and what you're good at.")
  else if (summary.kind === "text" && words(summary.text) > 80) tips.push("Your summary is long. Keep it to 2–3 lines (under 60 words).")

  const skills = data.sections.some((s) => s.kind === "table" && s.rows.some((r) => r.value.trim()))
  if (!skills) tips.push("Add a skills section. ATS filters match skills by name.")

  const bullets: string[] = []
  for (const section of data.sections) {
    if (section.kind !== "entries") continue
    for (const entry of section.entries) {
      const items = entry.items.filter((i) => i.trim() && !/^\*\*[^*]+\*\*:?\s*$/.test(i.trim()))
      const name = entry.heading || entry.subheading
      if (name && items.length === 0 && section.listStyle === "bullets") tips.push(`Add 2–4 bullet points under "${name}".`)
      if (name && section.listStyle === "bullets" && !entry.headingRight && !entry.subheadingRight && /experience|work|employment/i.test(section.title)) {
        tips.push(`Add dates to "${name}".`)
      }
      if (section.listStyle === "bullets") bullets.push(...items)
    }
  }

  if (bullets.length > 0) {
    const long = bullets.filter((b) => words(b) > 35).length
    if (long > 0) tips.push(`${long} bullet${long > 1 ? "s are" : " is"} very long. Keep each under about 25 words.`)
    const weak = bullets.filter((b) => WEAK_START.test(b.replace(/^-\s*/, ""))).length
    if (weak > 0) {
      tips.push(`${weak} bullet${weak > 1 ? "s start" : " starts"} with words like "Responsible for". Start with an action verb: Built, Led, Cut.`)
    }
    const withNumbers = bullets.filter((b) => /\d/.test(b)).length
    if (withNumbers < Math.ceil(bullets.length / 3)) {
      tips.push("Few bullets have numbers. Add real ones where you can: users, %, time or money saved.")
    }
    if (bullets.some((b) => BUZZWORDS.test(b))) tips.push('Cut buzzwords like "team player" or "leverage". Show it with a result instead.')
  }

  return tips
}
