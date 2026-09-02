// Single source of truth for plan data — id, display, and pricing all live
// here so pricing.tsx and purchase-flow-dialog.tsx can't drift out of sync
// with each other (a real bug that happened once already: the Supabase
// `plans` table was seeded with different ids than the website used).
// These `id` values must match `public.plans.id` exactly.

export type PlanId = "free" | "interview-pass" | "pro-monthly" | "pro-annual";

export type BillingKind = "free" | "one_time" | "monthly" | "yearly";

export interface Plan {
  id: PlanId
  name: string
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
    price: "₹0",
    priceInPaise: 0,
    cadence: "",
    billingNote: "No card required",
    description: "Limited usage, suitable for trying Smallbird.",
    features: ["Limited monthly usage", "Interview Mode", "Basic context upload"],
    cta: "Start Free",
    billingKind: "free",
  },
  {
    id: "interview-pass",
    name: "Interview Pass",
    price: "₹199",
    priceInPaise: 19900,
    cadence: "one-time",
    billingNote: "2 hours of Interview Mode",
    description: "A one-time pass for a single high-stakes interview.",
    features: ["2 hours of Interview Mode", "CV + JD context", "Real-time AI assistance", "Valid until used"],
    cta: "Get Interview Pass",
    billingKind: "one_time",
  },
  {
    id: "pro-monthly",
    name: "Pro Monthly",
    price: "₹699",
    priceInPaise: 69900,
    cadence: "/ month",
    billingNote: "Billed monthly",
    description: "Full Interview assistance with generous usage.",
    features: ["Interview Mode", "Generous monthly usage", "Full context library", "Priority support"],
    cta: "Start Pro",
    billingKind: "monthly",
  },
  {
    id: "pro-annual",
    name: "Pro Annual",
    price: "₹4,999",
    priceInPaise: 499900,
    cadence: "/ year",
    billingNote: "Billed yearly · best value",
    description: "Same Pro features as monthly, at the best price.",
    features: ["Interview Mode", "Generous monthly usage", "Full context library", "Priority support"],
    cta: "Get Pro Annual",
    billingKind: "yearly",
    recommended: true,
  },
];

export function getPlan(id: PlanId): Plan {
  const plan = PLANS.find((p) => p.id === id);
  if (!plan) throw new Error(`Unknown plan id: ${id}`);
  return plan;
}

export const PAID_PLAN_IDS = new Set<PlanId>(["interview-pass", "pro-monthly", "pro-annual"]);
export const SUBSCRIPTION_PLAN_IDS = new Set<PlanId>(["pro-monthly", "pro-annual"]);
