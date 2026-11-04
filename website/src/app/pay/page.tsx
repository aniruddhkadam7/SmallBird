import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Checkout",
  robots: { index: false, follow: false },
}

// Landing page for checkout on the Razorpay-approved domain (see
// lib/payment-domain.ts). The purchase dialog in the root layout opens the
// payment step for ?plan= on its own once the signed-in session is read.
export default function PayPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="text-xl font-semibold">Secure checkout</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        Your payment form should open in a moment. If it doesn&apos;t, go back to{" "}
        <a className="underline" href="https://smallbirdai.com/pricing">
          pricing
        </a>{" "}
        and choose your pass again.
      </p>
    </main>
  )
}
