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
    name: "Starter",
    emoji: "🟢",
    price: "₹399",
    priceInPaise: 39900,
    cadence: "one-time",
    billingNote: "1 hour",
    description: "One-time interview pass.",
    features: ["1 hour of Interview Mode", "Screen Analysis", "Coding Answers", "CV + JD context", "Real-time AI assistance", "Valid until used"],
    cta: "Get Starter",
    billingKind: "one_time",
  },
  {
    id: "pro",
    name: "Pro",
    emoji: "⭐",
    price: "₹749",
    priceInPaise: 74900,
    cadence: "/ month",
    billingNote: "2 hours/month",
    description: "For active job seekers.",
    features: ["2 hours/month", "Interview Mode", "Screen Analysis", "Coding Answers", "Full context library", "Priority support (support@smallbird.in)"],
    cta: "Start Pro",
    billingKind: "monthly",
  },
  {
    id: "pro-plus",
    name: "Pro+",
    emoji: "🔥",
    price: "₹1,399",
    priceInPaise: 139900,
    cadence: "/ month",
    billingNote: "4 hours/month",
    description: "For serious interview prep.",
    features: ["4 hours/month", "Interview Mode", "Screen Analysis", "Coding Answers", "Full context library", "Priority support (support@smallbird.in)"],
    cta: "Get Pro+",
    billingKind: "monthly",
    recommended: true,
  },
];

export function getPlan(id: PlanId): Plan {
  const plan = PLANS.find((p) => p.id === id);
  if (!plan) throw new Error(`Unknown plan id: ${id}`);
  return plan;
}

export const PAID_PLAN_IDS = new Set<PlanId>(["starter", "pro", "pro-plus"]);
export const SUBSCRIPTION_PLAN_IDS = new Set<PlanId>(["pro", "pro-plus"]);
