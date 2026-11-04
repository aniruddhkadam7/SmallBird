import type { Metadata } from "next"
import { FileUp, ShieldCheck, Sparkles, Target } from "lucide-react"
import { ResumePreview } from "@/components/resume/resume-preview"
import { StartResumeButton } from "@/components/blocks/start-resume-button"
import { StartWithTemplate } from "@/components/blocks/start-with-template"
import { RESUME_LIMITS } from "@/lib/plans"
import { resumeFonts } from "@/lib/resume/fonts"
import { sampleResume } from "@/lib/resume/sample"
import { TEMPLATES } from "@/lib/resume/types"
import "../../resume/resume.css"

export const metadata: Metadata = {
  title: "AI Resume Builder — Tailor Your Resume to Any Job",
  description:
    "Free AI resume builder from SmallBird AI. Import your old resume, tailor it to any job description, pick from 3 templates and download a clean, ATS-friendly PDF. AI never makes up experience.",
  alternates: {
    canonical: "/ai-resume-builder",
  },
}

const FEATURES = [
  {
    icon: FileUp,
    title: "Import your old resume",
    text: "Upload a PDF or DOCX. AI reads it and fills in every section for you, so you don't type anything twice.",
  },
  {
    icon: Target,
    title: "Tailor it to each job",
    text: "Paste the job description. AI rewrites your summary and bullets in the job's own words, and shows which skills the job wants that your resume doesn't mention.",
  },
  {
    icon: Sparkles,
    title: "Improve any bullet point",
    text: "One click turns weak lines like \"responsible for backend\" into clear results with strong verbs.",
  },
  {
    icon: ShieldCheck,
    title: "Honest by design",
    text: "AI only rewords and reorders what you really did. It never adds jobs, skills or numbers you don't have. Every AI change can be undone.",
  },
]

export default function AiResumeBuilderPage() {
  return (
    <div className={`${resumeFonts} mx-auto max-w-7xl px-4 py-14 sm:py-20`}>
      <div className="grid items-center gap-12 lg:grid-cols-2">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-blue-600" />
            New · Free for every SmallBird AI account
          </span>
          <h1 className="mt-5 text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
            AI resume builder that tailors your resume to every job
          </h1>
          <p className="mt-5 max-w-xl text-lg text-muted-foreground">
            Import your old resume, paste a job description, and get a clean, ATS-friendly resume in minutes. Then download
            it as a PDF. Your resumes stay saved in your account, so you can come back and edit them any time.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <StartResumeButton />
            <span className="text-sm text-muted-foreground">
              No credit card. Free plan: {RESUME_LIMITS.free.maxResumes} resumes and {RESUME_LIMITS.free.aiPerDay} AI
              actions a day.{" "}
              <a href="/pricing" className="underline underline-offset-2 hover:text-foreground">
                More with a pass
              </a>
            </span>
          </div>
        </div>

        <div className="flex justify-center rounded-2xl border border-border bg-neutral-100 p-4 sm:p-8">
          <div className="w-fit shadow-xl" style={{ zoom: 0.62 }}>
            <ResumePreview data={sampleResume("navy")} />
          </div>
        </div>
      </div>

      <div className="mt-20 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {FEATURES.map(({ icon: Icon, title, text }) => (
          <div key={title} className="rounded-xl border border-border bg-card p-5">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
              <Icon className="h-5 w-5 text-blue-600" />
            </span>
            <h2 className="mt-4 font-semibold text-foreground">{title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{text}</p>
          </div>
        ))}
      </div>

      <div className="mt-20">
        <h2 className="text-center text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">Pick a template</h2>
        <p className="mt-2 text-center text-muted-foreground">
          Same content, {TEMPLATES.length} looks. Tap one to start, and switch any time in the editor.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-6">
          {TEMPLATES.map((t) => (
            <StartWithTemplate
              key={t.id}
              template={t.id}
              label={t.name}
              className="flex w-[350px] max-w-full flex-col items-center gap-4 rounded-2xl border border-border bg-neutral-100 p-4 transition-transform hover:-translate-y-1"
            >
              <div className="relative">
                <div className="w-fit shadow-lg" style={{ zoom: 0.4 }}>
                  <ResumePreview data={sampleResume(t.id)} />
                </div>
                <span className="absolute inset-x-0 bottom-4 mx-auto w-fit rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                  Use this template
                </span>
              </div>
              <div className="text-center">
                <div className="font-semibold text-foreground">{t.name}</div>
                <div className="text-sm text-muted-foreground">{t.description}</div>
              </div>
            </StartWithTemplate>
          ))}
        </div>
      </div>

      <div className="mt-20 flex flex-col items-center gap-5 rounded-2xl border border-border bg-card px-6 py-12 text-center">
        <h2 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          Got the interview? SmallBird AI helps there too.
        </h2>
        <p className="max-w-2xl text-muted-foreground">
          The same account gives you SmallBird AI&apos;s live interview assistant, which answers using the resume and job
          description you just worked on.
        </p>
        <StartResumeButton label="Start with my resume" />
      </div>
    </div>
  )
}
