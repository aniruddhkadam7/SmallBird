// One place for the product name and domains used in emails and CORS.
// smallbirdai.com is the primary domain; smallbird.in stays live and is
// redirected to it.
export const BRAND = "SmallBird AI";
export const SITE_URL = "https://smallbirdai.com";

// Domain emails are sent from. It must be verified in Resend before it can
// be used, so it stays on the old domain until MAIL_DOMAIN is set to
// smallbirdai.com (supabase secrets set MAIL_DOMAIN=smallbirdai.com).
export const MAIL_DOMAIN = Deno.env.get("MAIL_DOMAIN") ?? "smallbird.in";
export const SUPPORT_EMAIL = `support@${MAIL_DOMAIN}`;
export const NOREPLY_ADDRESS = `${BRAND} <noreply@${MAIL_DOMAIN}>`;
