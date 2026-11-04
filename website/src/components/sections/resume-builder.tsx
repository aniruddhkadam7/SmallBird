import Image, { type StaticImageData } from "next/image"
import Link from "next/link"
import { ArrowRight, Check } from "lucide-react"
import { StartResumeButton } from "@/components/blocks/start-resume-button"
import { StartWithTemplate } from "@/components/blocks/start-with-template"
import { TEMPLATES, type TemplateId } from "@/lib/resume/types"
import navyImage from "@/assets/resume-templates/navy.png"
import classicImage from "@/assets/resume-templates/classic.png"
import modernImage from "@/assets/resume-templates/modern.png"
import sidebarImage from "@/assets/resume-templates/sidebar.png"
import boldImage from "@/assets/resume-templates/bold.png"

// Homepage band for the resume builder: a picture of each template, scrolling
// sideways in the same endless marquee as the Reviews section. Bold Header's
// picture is our own render (the original sample has a real actor's photo and
// a studio logo, which can't go on the site).

const IMAGES: Record<TemplateId, StaticImageData> = {
  navy: navyImage,
  classic: classicImage,
  modern: modernImage,
  sidebar: sidebarImage,
  bold: boldImage,
}

function TemplateCard({ id }: { id: TemplateId }) {
  const template = TEMPLATES.find((t) => t.id === id)!
  return (
    <StartWithTemplate
      template={id}
      label={template.name}
      className="glass flex w-[260px] shrink-0 flex-col overflow-hidden rounded-xl transition-transform hover:-translate-y-1 sm:w-[300px]"
    >
      <div className="relative h-[330px] w-full overflow-hidden bg-neutral-100 px-4 pt-4 sm:h-[370px]">
        <span className="absolute inset-x-0 bottom-4 z-10 mx-auto w-fit rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          Use this template
        </span>
        <Image
          src={IMAGES[id]}
          alt={`${template.name} resume template`}
          // Served as-is (no resizing round-trip) and loaded right away: lazy
          // loading never fires inside the moving, masked strip, and there are
          // only five distinct files (the repeats reuse them).
          unoptimized
          loading="eager"
          className="h-auto w-full rounded-sm shadow-md"
        />
      </div>
      <div className="w-full border-t border-border px-4 py-3">
        <div className="text-sm font-semibold text-foreground">{template.name}</div>
        <div className="text-xs text-muted-foreground">{template.description}</div>
      </div>
    </StartWithTemplate>
  )
}

export function ResumeBuilder() {
  return (
    <section id="resume-builder" className="border-t border-border py-14 sm:py-20">
      <div className="mx-auto max-w-5xl px-4 text-center">
        <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Industry-standard resume templates, <span className="text-primary">built for ATS</span>
        </h2>
        <p className="mx-auto mt-4 max-w-2xl text-muted-foreground">
          Pick a proven template, let AI tailor it to the job, and download an ATS-friendly PDF.
        </p>
        <div className="mx-auto mt-5 flex max-w-3xl flex-wrap justify-center gap-x-5 gap-y-2 text-sm text-foreground/80">
          {["ATS-friendly PDF", "AI-tailored to the job", "No made-up experience", "Saved in your account"].map((point) => (
            <span key={point} className="inline-flex items-center gap-1.5">
              <Check className="h-4 w-4 text-blue-600" />
              {point}
            </span>
          ))}
        </div>
      </div>

      <div
        className="relative mt-12 overflow-hidden"
        style={{
          maskImage: "linear-gradient(to right, transparent, black 5%, black 95%, transparent)",
          WebkitMaskImage: "linear-gradient(to right, transparent, black 5%, black 95%, transparent)",
        }}
      >
        {/* The marquee scrolls by half its width, so each half must be wider than
            the widest screen: two rounds of the templates per half. */}
        <div className="animate-marquee flex w-max gap-5">
          {[...TEMPLATES, ...TEMPLATES, ...TEMPLATES, ...TEMPLATES].map((t, i) => (
            <TemplateCard key={`${t.id}-${i}`} id={t.id} />
          ))}
        </div>
      </div>

      <div className="mt-10 flex flex-wrap items-center justify-center gap-4 px-4">
        <StartResumeButton />
        <Link
          href="/ai-resume-builder"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground/80 transition-colors hover:text-foreground"
        >
          See how it works <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </section>
  )
}
