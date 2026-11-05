import { Nav } from "@/components/sections/nav"
import { Footer } from "@/components/sections/footer"
import { PromoBanner, PromoPopup } from "@/components/blocks/promo"
import { getActivePromotion } from "@/lib/live-pricing"

// Marketing chrome (top nav + footer) lives here rather than the root
// layout, so /dashboard can have its own full-page sidebar shell with none
// of this — a route group, not a URL segment, so it doesn't show up in any
// path (this page is still just "/", "/download", etc).
// The current announcement (sale banner/popup) shows on these pages only.
export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  const promo = await getActivePromotion()
  return (
    <>
      <PromoBanner promo={promo} />
      <Nav />
      <main>{children}</main>
      <Footer />
      <PromoPopup promo={promo} />
    </>
  )
}
