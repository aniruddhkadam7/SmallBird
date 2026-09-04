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
    features: ["10 minutes/month", "Interview Mode", "Basic context upload"],
    cta: "Start Free",
    billingKind: "free",
  },
  {
    id: "starter",
    name: "Starter",
    emoji: "🎯",
    price: "₹199",
    priceInPaise: 19900,
    cadence: "one-time",
    billingNote: "1 hour",
    description: "One-time interview pass.",
    features: ["1 hour of Interview Mode", "CV + JD context", "Real-time AI assistance", "Valid until used"],
    cta: "Get Starter",
    billingKind: "one_time",
  },
  {
    id: "pro",
    name: "Pro",
    emoji: "🚀",
    price: "₹499",
    priceInPaise: 49900,
    cadence: "/ month",
    billingNote: "3 hours/month",
    description: "For active job seekers.",
    features: ["3 hours/month", "Interview Mode", "Full context library", "Priority support (support@smallbird.in)"],
    cta: "Start Pro",
    billingKind: "monthly",
  },
  {
    id: "pro-plus",
    name: "Pro Plus",
    emoji: "⭐",
    price: "₹799",
    priceInPaise: 79900,
    cadence: "/ month",
    billingNote: "6 hours/month",
    description: "For heavy interview usage.",
    features: ["6 hours/month", "Interview Mode", "Full context library", "Priority support (support@smallbird.in)"],
    cta: "Get Pro Plus",
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
