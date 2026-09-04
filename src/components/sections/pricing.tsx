"use client"

import { motion } from "motion/react"
import { Check } from "lucide-react"
import { LiquidButton } from "@/components/ui/liquid-glass-button"
import { Badge } from "@/components/ui/badge"
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { usePurchaseFlow } from "@/lib/purchase-flow"
import { PLANS } from "@/lib/plans"
import { siVisa, siGooglepay, siPhonepe, siPaytm } from "simple-icons"

// Only payment methods actually supported through our Razorpay checkout --
// Apple Pay is deliberately left out since Razorpay doesn't support it for
// Indian merchants, and listing it would set a false expectation. Mastercard,
// Amex, CRED, and UPI are hand-built text/shape badges below since simple-icons
// either has no real logo for them (CRED) or only ships a flat single-color
// mark that reads as an unrecognizable blob/box (Mastercard, Amex).
const paymentMethods = [
  { name: "Visa", color: `#${siVisa.hex}`, icon: siVisa },
  { name: "Google Pay", color: `#${siGooglepay.hex}`, icon: siGooglepay },
  { name: "Paytm", color: `#${siPaytm.hex}`, icon: siPaytm },
  { name: "PhonePe", color: `#${siPhonepe.hex}`, icon: siPhonepe },
]

export function Pricing() {
  const { startFlow } = usePurchaseFlow()

  return (
    <section id="pricing" className="border-t border-border py-14 px-4 sm:py-20">
      <div className="mx-auto max-w-6xl">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Simple, transparent pricing
          </h2>
          <p className="mt-4 text-muted-foreground">
            Priced for India. One-time, monthly, or yearly — pick what fits
            how often you use Smallbird.
          </p>
        </div>

        <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {PLANS.map((plan, i) => (
            <motion.div
              key={plan.id}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: 0.5, delay: i * 0.08, ease: "easeOut" }}
              className="relative h-full"
            >
              {plan.recommended ? (
                <Badge className="absolute -top-3 left-1/2 z-20 -translate-x-1/2">
                  MOST POPULAR
                </Badge>
              ) : null}

              <Card
                className={cn(
                  "h-full transition-all duration-300 hover:-translate-y-1 hover:shadow-lg",
                  plan.recommended && "shadow-md",
                )}
              >
                <CardHeader>
                  <CardTitle className="text-lg">
                    {plan.emoji} {plan.name}
                  </CardTitle>
                  <div className="mt-2 flex items-baseline gap-1.5">
                    <span className="text-3xl font-semibold tracking-tight">
                      {plan.price}
                    </span>
                    {plan.cadence ? (
                      <span className="text-sm text-muted-foreground">{plan.cadence}</span>
                    ) : null}
                  </div>
                  <p className="text-xs font-medium text-muted-foreground">{plan.billingNote}</p>
                  <CardDescription>{plan.description}</CardDescription>
                </CardHeader>
                <CardContent className="flex-1">
                  <ul className="space-y-2.5 text-sm">
                    {plan.features.map((f) => (
                      <li key={f} className="flex items-start gap-2">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-foreground" />
                        <span className="text-muted-foreground">{f}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
                <CardFooter>
                  <LiquidButton
                    className="w-full"
                    variant={plan.recommended ? "default" : "outline"}
                    onClick={() => startFlow(plan.id)}
                  >
                    {plan.cta}
                  </LiquidButton>
                </CardFooter>
              </Card>
            </motion.div>
          ))}
        </div>

        <p className="mt-8 text-center text-xs text-muted-foreground">
          Prices are in INR and include applicable taxes. Starter is a
          one-time purchase; Pro and Pro Plus are recurring subscriptions.
        </p>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-2.5">
          <span className="text-sm font-medium text-foreground">Pay with</span>

          <span
            title="Visa"
            className="flex h-11 w-20 items-center justify-center rounded-lg border border-border bg-card"
          >
            <svg viewBox="0 0 24 24" className="h-6 w-12" fill={`#${siVisa.hex}`} aria-hidden="true">
              <path d={siVisa.path} />
            </svg>
          </span>

          <span title="Mastercard" className="relative flex h-11 w-20 items-center justify-center rounded-lg border border-border bg-card">
            <span className="absolute h-7 w-7 -translate-x-2 rounded-full bg-[#EB001B]" />
            <span className="absolute h-7 w-7 translate-x-2 rounded-full bg-[#F79E1B] mix-blend-multiply" />
          </span>

          <span
            title="American Express"
            className="flex h-11 w-20 items-center justify-center rounded-lg bg-[#006FCF] text-[11px] font-bold tracking-tight text-white"
          >
            AMEX
          </span>

          {paymentMethods.slice(1).map((m) => (
            <span
              key={m.name}
              title={m.name}
              className="flex h-11 w-20 items-center justify-center rounded-lg border border-border bg-card"
            >
              <svg viewBox="0 0 24 24" className="h-7 w-7" fill={m.color} aria-hidden="true">
                <path d={m.icon.path} />
              </svg>
            </span>
          ))}

          <span
            title="CRED"
            className="flex h-11 w-20 items-center justify-center rounded-lg bg-black text-[11px] font-bold tracking-tight text-white"
          >
            CRED
          </span>

          <span className="flex h-11 w-20 items-center justify-center rounded-lg border border-border bg-card text-xs font-bold text-foreground">
            UPI
          </span>
        </div>
      </div>
    </section>
  )
}
