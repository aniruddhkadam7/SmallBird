# smallbirdai.com — primary domain and SEO

Product name everywhere: **SmallBird AI**. Primary domain: **https://smallbirdai.com**.
`smallbird.in` keeps working but 301-redirects to smallbirdai.com.

## Done in this repo
- Desktop app: window titles, tray, bubble, settings, errors, macOS permission text say "SmallBird AI". "Open Dashboard" now opens smallbirdai.com.
  Kept on purpose (changing them would sign users out or break auto-update): bundle identifier `com.smallbird.app`, keychain service name, `productName`.
- Backend: CORS allows smallbirdai.com (+www) and smallbird.in. Emails use `_shared/brand.ts` (links go to smallbirdai.com).
- Admin console, phone web app (`noindex`), READMEs.

## Deploy steps (in order)
1. **Vercel (website project):** add `smallbirdai.com` and `www.smallbirdai.com`; set smallbirdai.com as Primary. Keep `smallbird.in` and set it to "Redirect to smallbirdai.com" (308/301, preserve path). Add DNS records Vercel shows.
2. **Supabase → Auth → URL Configuration:** Site URL `https://smallbirdai.com`; add `https://smallbirdai.com/**` and `https://www.smallbirdai.com/**` to Redirect URLs (keep smallbird.in). Needed for sign-in and `/auth/handoff`.
3. **Redeploy edge functions** (CORS + emails): `supabase functions deploy` for request-otp verify-otp stt-token session-heartbeat usage-report llm-proxy welcome-email razorpay-webhook resume-ai.
4. **Resend:** verify `smallbirdai.com` (SPF/DKIM), create support@ and payments@ mailboxes, then `supabase secrets set MAIL_DOMAIN=smallbirdai.com`. Until then mail still sends from smallbird.in so nothing breaks.
5. **Release the desktop app** (release-update skill) so users get the new name and links.
6. Admin console: add `admin.smallbirdai.com` in Vercel.

## SEO — apply in the website repo (SmallBird-website, Next.js)
`src/app/layout.tsx`:
```ts
export const metadata: Metadata = {
  metadataBase: new URL("https://smallbirdai.com"),
  title: { default: "SmallBird AI – AI Interview Copilot | Real-time Interview Answers", template: "%s | SmallBird AI" },
  description: "SmallBird AI listens to your interview and suggests answers in real time. Invisible in screen share. Download for Windows and Mac.",
  applicationName: "SmallBird AI",
  alternates: { canonical: "/" },
  openGraph: { siteName: "SmallBird AI", url: "https://smallbirdai.com", type: "website" },
  twitter: { card: "summary_large_image" },
  robots: { index: true, follow: true },
};
```
Add JSON-LD on the home page (name + alternateName helps "smallbird" queries):
```tsx
<script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify([
  { "@context": "https://schema.org", "@type": "Organization", name: "SmallBird AI", alternateName: ["SmallBird", "Small Bird AI", "smallbirdai"], url: "https://smallbirdai.com", logo: "https://smallbirdai.com/smallbird-logo.png", sameAs: [/* LinkedIn, X, YouTube, Instagram, GitHub */] },
  { "@context": "https://schema.org", "@type": "WebSite", name: "SmallBird AI", alternateName: "SmallBird", url: "https://smallbirdai.com" },
  { "@context": "https://schema.org", "@type": "SoftwareApplication", name: "SmallBird AI", applicationCategory: "BusinessApplication", operatingSystem: "Windows, macOS", offers: { "@type": "Offer", price: "0", priceCurrency: "USD" } },
]) }} />
```
`src/app/sitemap.ts` (list /, /download, /pricing, /resume, blog) and `src/app/robots.ts` (`allow: "/"`, `disallow: ["/dashboard","/api"]`, `sitemap: "https://smallbirdai.com/sitemap.xml"`).
Use "SmallBird AI" in the H1, footer, and download page text. Every page needs a unique title + description and a canonical on smallbirdai.com.

## After go-live
1. Google Search Console: add **Domain property** for smallbirdai.com and smallbird.in; submit the sitemap; in the smallbird.in property use **Change of Address** → smallbirdai.com. Do the same in Bing Webmaster Tools.
2. Request indexing for the home page.
3. Create the same profile everywhere with the exact name "SmallBird AI" and a link to smallbirdai.com: LinkedIn company page, X, YouTube, Instagram, Product Hunt, GitHub org, G2/Capterra, Crunchbase. These backlinks plus the name matter most for ranking on "smallbird" / "smallbird ai".
4. Get the download pages and blog posts indexed; write 5–10 pages on target searches (AI interview copilot, interview answer generator, etc.).

Note: ranking #1 for plain "smallbird" cannot be guaranteed — it is a common word. "smallbird ai" is realistic within weeks once indexed. Plain "smallbird" depends on backlinks and branded searches growing.
