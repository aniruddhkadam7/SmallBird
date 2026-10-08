// Single source of truth for plan data — id, display, and pricing all live
// here so pricing.tsx and purchase-flow-dialog.tsx can't drift out of sync
// with each other (a real bug that happened once already: the Supabase
// `plans` table was seeded with different ids than the website used).
// These `id` values must match `public.plans.id` exactly.

export type PlanId = "free" | "starter" | "pro" | "pro-plus";

export type BillingKind = "free" | "one_time" | "monthly" | "yearly";

export interface Plan {
  id: PlanId
  name: string
  emoji: string
  price: string
  priceInPaise: number
  cadence: string
  billingNote: string
  description: string
  features: string[]
  cta: string
  billingKind: BillingKind
  recommended?: boolean
}

export const PLANS: Plan[] = [
  {
    id: "free",
    name: "Free",
    emoji: "🆓",
    price: "₹0",
    priceInPaise: 0,
    cadence: "",
    billingNote: "10 minutes/month",
    description: "Experience all Smallbird features.",
    features: ["10 minutes/month", "Interview Mode", "Screen Analysis", "Coding Answers", "Basic context upload"],
    cta: "Start Free",
    billingKind: "free",
  },
  {
    id: "starter",
    name: "Starter Pass",
    emoji: "🟢",
    price: "₹299",
    priceInPaise: 29900,
    cadence: "one-time",
    billingNote: "60 minutes · ₹4.98/min",
    description: "For a single upcoming interview.",
    features: ["60 minutes of AI time", "Interview Mode", "Screen Analysis", "Coding Answers", "CV + JD context", "Valid until used"],
    cta: "Get Starter Pass",
    billingKind: "one_time",
  },
  {
    id: "pro",
    name: "Pro Pass",
    emoji: "⭐",
    price: "₹559",
    priceInPaise: 55900,
    cadence: "one-time",
    billingNote: "120 minutes · ₹4.66/min",
    description: "For a few rounds of interviews.",
    features: ["120 minutes of AI time", "Interview Mode", "Screen Analysis", "Coding Answers", "Full context library", "Valid until used"],
    cta: "Get Pro Pass",
    billingKind: "one_time",
  },
  {
    id: "pro-plus",
    name: "Pro+ Pass",
    emoji: "🔥",
    price: "₹999",
    priceInPaise: 99900,
    cadence: "one-time",
    billingNote: "240 minutes · ₹4.16/min",
    description: "Best value for serious interview prep.",
    features: ["240 minutes of AI time", "Interview Mode", "Screen Analysis", "Coding Answers", "Full context library", "Priority support (support@smallbird.in)", "Valid until used"],
    cta: "Get Pro+ Pass",
    billingKind: "one_time",
    recommended: true,
  },
];

export function getPlan(id: PlanId): Plan {
  const plan = PLANS.find((p) => p.id === id);
  if (!plan) throw new Error(`Unknown plan id: ${id}`);
  return plan;
}

export const PAID_PLAN_IDS = new Set<PlanId>(["starter", "pro", "pro-plus"]);
