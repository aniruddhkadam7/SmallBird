"use client"

import type { ReactNode } from "react"
import { usePurchaseFlow } from "@/lib/purchase-flow"
import type { TemplateId } from "@/lib/resume/types"

// Wraps a template preview so tapping it starts a resume in that template:
// signed in, straight to /resume/new; otherwise the site's sign-up dialog,
// which then lands there.
export function StartWithTemplate({
  template,
  label,
  className,
  children,
}: {
  template: TemplateId
  label: string
  className?: string
  children: ReactNode
}) {
  const { requestPageAccess } = usePurchaseFlow()
  return (
    <button
      type="button"
      aria-label={`Build my resume with the ${label} template`}
      onClick={() => requestPageAccess(`/resume/new?template=${template}`, "signup")}
      className={`group cursor-pointer text-left ${className ?? ""}`}
    >
      {children}
    </button>
  )
}
