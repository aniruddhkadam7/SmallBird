"use client"

import { useEffect } from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { endPageView, trackEvent, trackPageView } from "@/lib/analytics"

// Mounted once in the root layout (inside <Suspense>, for useSearchParams).
// Records a page view on every route change, the time on the page when the
// tab hides or the visitor moves on, and these clicks anywhere on the site:
//  - a link to the Windows installer -> "download_windows"
//  - any element with data-track="<name>" -> that name
export function AnalyticsTracker() {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  useEffect(() => {
    trackPageView(pathname, new URLSearchParams(searchParams.toString()))
  }, [pathname, searchParams])

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") endPageView()
    }
    const onClick = (e: MouseEvent) => {
      const el = (e.target as HTMLElement | null)?.closest<HTMLElement>("a, button, [data-track]")
      if (!el) return
      const named = el.closest<HTMLElement>("[data-track]")?.dataset.track
      if (named) return trackEvent(named)
      const href = el instanceof HTMLAnchorElement ? el.href : ""
      if (/\.(exe|msi)(\?|$)/i.test(href)) trackEvent("download_windows")
      else if (/\.(dmg|pkg)(\?|$)/i.test(href)) trackEvent("download_mac")
    }
    document.addEventListener("visibilitychange", onHide)
    window.addEventListener("pagehide", endPageView)
    document.addEventListener("click", onClick, { capture: true })
    return () => {
      document.removeEventListener("visibilitychange", onHide)
      window.removeEventListener("pagehide", endPageView)
      document.removeEventListener("click", onClick, { capture: true })
    }
  }, [])

  return null
}
