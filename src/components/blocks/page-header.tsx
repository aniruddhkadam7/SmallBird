import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { LocalPrice } from "@/components/blocks/local-price"

export function PageHeader({
  eyebrow,
  title,
  description,
  descriptionUsd,
}: {
  eyebrow: string
  title: string
  description: string
  // Shown instead of description to visitors outside India.
  descriptionUsd?: string
}) {
  return (
    <div className="mx-auto max-w-3xl px-4 pt-16 text-center sm:pt-24">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Smallbird
      </Link>

      <p className="mt-8 text-sm font-medium tracking-wide text-primary uppercase">{eyebrow}</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
      <p className="mt-4 text-muted-foreground">
        {descriptionUsd ? <LocalPrice inr={description} usd={descriptionUsd} /> : description}
      </p>
    </div>
  )
}
