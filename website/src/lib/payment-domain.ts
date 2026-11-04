// The domain Razorpay has approved for this merchant account. Checkout from
// any other domain is blocked (payment_risk_check_failed), so while
// smallbirdai.com awaits Razorpay approval, buyers on it are signed in on
// smallbird.in and pay there (see /api/checkout-handoff and app/pay).
// Once smallbirdai.com shows "Approved" in Razorpay -> Business website
// details, set PAYMENT_ORIGIN to null and drop the smallbird.in redirect
// exceptions in next.config.ts.
export const PAYMENT_ORIGIN: string | null = "https://smallbird.in"

/** True when checkout must hop to PAYMENT_ORIGIN instead of running here. */
export function mustPayElsewhere(): boolean {
  return !!PAYMENT_ORIGIN && window.location.origin !== PAYMENT_ORIGIN && !isLocalhost()
}

function isLocalhost(): boolean {
  const host = window.location.hostname
  return host === "localhost" || host === "127.0.0.1"
}
