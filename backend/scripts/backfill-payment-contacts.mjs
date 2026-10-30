// One-off: fills public.payment_contacts (migration 0062) for purchases made
// before razorpay-webhook started saving the payer's phone/email. For each
// purchase it asks Razorpay for that order's payments and saves what the
// payer typed at checkout. Safe to run more than once (upsert on payment id).
//
// Run after 0062 is applied, with the keys in the environment (never commit
// them):
//   RAZORPAY_KEY_ID=... RAZORPAY_KEY_SECRET=... \
//   SUPABASE_URL=https://xubbwgrjvvsbfvxcuzav.supabase.co SUPABASE_SERVICE_ROLE_KEY=... \
//   node backend/scripts/backfill-payment-contacts.mjs

const { RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
for (const [name, value] of Object.entries({ RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY })) {
  if (!value) throw new Error(`Missing ${name}`);
}

const rzpAuth = "Basic " + Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString("base64");
const db = { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` };

const purchasesRes = await fetch(`${SUPABASE_URL}/rest/v1/purchases?select=user_id,razorpay_order_id`, { headers: db });
if (!purchasesRes.ok) throw new Error(`Reading purchases failed: ${purchasesRes.status} ${await purchasesRes.text()}`);
const purchases = await purchasesRes.json();

let saved = 0;
for (const { user_id, razorpay_order_id } of purchases) {
  if (!razorpay_order_id) continue;
  const res = await fetch(`https://api.razorpay.com/v1/orders/${razorpay_order_id}/payments`, { headers: { Authorization: rzpAuth } });
  if (!res.ok) {
    console.error(`Order ${razorpay_order_id}: Razorpay returned ${res.status}`);
    continue;
  }
  const { items = [] } = await res.json();
  const rows = items.map((p) => ({
    user_id,
    razorpay_payment_id: p.id,
    razorpay_order_id: p.order_id ?? razorpay_order_id,
    contact: p.contact || null,
    email: p.email || null,
    method: p.method ?? null,
    vpa: p.vpa ?? p.upi?.vpa ?? null,
    bank: p.bank ?? null,
    wallet: p.wallet ?? null,
    amount_paise: p.amount ?? null,
    status: p.status === "captured" || p.status === "authorized" ? "paid" : p.status === "failed" ? "failed" : p.status,
    created_at: new Date(p.created_at * 1000).toISOString(),
  }));
  if (rows.length === 0) continue;

  const up = await fetch(`${SUPABASE_URL}/rest/v1/payment_contacts?on_conflict=razorpay_payment_id`, {
    method: "POST",
    headers: { ...db, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify(rows),
  });
  if (!up.ok) {
    console.error(`Order ${razorpay_order_id}: saving failed: ${up.status} ${await up.text()}`);
    continue;
  }
  saved += rows.length;
}

console.log(`Done: ${saved} payment(s) saved from ${purchases.length} purchase(s).`);
