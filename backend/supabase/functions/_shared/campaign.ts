// Shared by admin-campaign (sends marketing email) and unsubscribe (opt-out):
// the email layout and the signed unsubscribe link.

import { BRAND, SITE_URL, SUPPORT_EMAIL } from "./brand.ts";

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

// An unsubscribe link is signed with a key only the server has, so nobody
// can unsubscribe a different person by editing the link.
async function sign(userId: string): Promise<string> {
  const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`unsubscribe:${userId}`));
  return Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function verifyUnsubscribeToken(userId: string, token: string): Promise<boolean> {
  const expected = await sign(userId);
  if (expected.length !== token.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  return diff === 0;
}

/// Link in the email body: a page on the website with an "Unsubscribe" button.
export async function unsubscribePageUrl(userId: string): Promise<string> {
  return `${SITE_URL}/unsubscribe?u=${userId}&t=${await sign(userId)}`;
}

/// Link for the List-Unsubscribe header (mail apps' own unsubscribe button):
/// answers a one-click POST directly.
export async function unsubscribeOneClickUrl(userId: string): Promise<string> {
  const base = Deno.env.get("SUPABASE_URL")!;
  return `${base}/functions/v1/unsubscribe?u=${userId}&t=${await sign(userId)}`;
}

// "priya kumar" -> "Priya"; nothing when there's no usable name.
function firstName(name: string | null): string | null {
  const first = name?.trim().split(/\s+/)[0];
  if (!first) return null;
  return first.charAt(0).toUpperCase() + first.slice(1);
}

export interface CampaignContent {
  headline: string;
  body: string;
  ctaLabel: string | null;
  ctaHref: string | null;
}

// Plain text with blank lines between paragraphs becomes paragraphs.
function paragraphs(body: string): string {
  return body
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px;font-size:16px;line-height:1.55;">${escapeHtml(p.trim()).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function absoluteHref(href: string): string {
  return href.startsWith("/") ? `${SITE_URL}${href}` : href;
}

export function campaignHtml(content: CampaignContent, name: string | null, unsubscribeUrl: string): string {
  const first = firstName(name);
  const greeting = first ? `Hi ${escapeHtml(first)},` : "Hi there,";
  const button =
    content.ctaLabel && content.ctaHref
      ? `<tr><td align="center" style="padding:6px 0 26px;">
          <a href="${escapeHtml(absoluteHref(content.ctaHref))}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-size:16px;font-weight:600;padding:14px 28px;border-radius:8px;">${escapeHtml(content.ctaLabel)}</a>
        </td></tr>`
      : "";
  return `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;padding:32px;">
        <tr><td style="font-size:20px;font-weight:700;padding-bottom:20px;">${BRAND}</td></tr>
        <tr><td style="font-size:22px;font-weight:700;line-height:1.3;padding-bottom:16px;">${escapeHtml(content.headline)}</td></tr>
        <tr><td style="font-size:16px;line-height:1.5;padding-bottom:10px;">${greeting}</td></tr>
        <tr><td style="padding-bottom:10px;">${paragraphs(content.body)}</td></tr>
        ${button}
        <tr><td style="font-size:15px;line-height:1.5;color:#555555;">Team ${BRAND}</td></tr>
      </table>
      <p style="max-width:520px;margin:16px 0 0;font-size:12px;line-height:1.5;color:#8a8f98;text-align:center;">
        You're receiving this because you have a ${BRAND} account. Questions? Write to ${SUPPORT_EMAIL}.<br>
        <a href="${escapeHtml(unsubscribeUrl)}" style="color:#8a8f98;">Unsubscribe from these emails</a>
      </p>
    </td></tr>
  </table>
</body>
</html>`;
}

export function campaignText(content: CampaignContent, name: string | null, unsubscribeUrl: string): string {
  const cta = content.ctaLabel && content.ctaHref ? `\n${content.ctaLabel}: ${absoluteHref(content.ctaHref)}\n` : "";
  return `${content.headline}\n\n${firstName(name) ? `Hi ${firstName(name)},` : "Hi there,"}\n\n${content.body}\n${cta}\nTeam ${BRAND}\n\nUnsubscribe: ${unsubscribeUrl}\n`;
}
