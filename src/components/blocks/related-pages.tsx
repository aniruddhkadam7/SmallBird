import Link from "next/link"
import { ArrowRight } from "lucide-react"

export function RelatedPages({
  title = "Related pages",
  links,
}: {
  title?: string
  links: { href: string; label: string; description: string }[]
}) {
  return (
    <section className="mx-auto mt-16 max-w-3xl px-4">
      <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="group rounded-xl border border-border p-4 transition-colors hover:border-foreground/30"
          >
            <span className="flex items-center gap-1.5 font-medium text-foreground">
              {link.label}
              <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
            </span>
            <p className="mt-1 text-sm text-muted-foreground">{link.description}</p>
          </Link>
        ))}
      </div>
    </section>
  )
}
