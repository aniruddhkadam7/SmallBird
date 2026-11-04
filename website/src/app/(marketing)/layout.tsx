import { Nav } from "@/components/sections/nav"
import { Footer } from "@/components/sections/footer"

// Marketing chrome (top nav + footer) lives here rather than the root
// layout, so /dashboard can have its own full-page sidebar shell with none
// of this — a route group, not a URL segment, so it doesn't show up in any
// path (this page is still just "/", "/download", etc).
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Nav />
      <main>{children}</main>
      <Footer />
    </>
  )
}
