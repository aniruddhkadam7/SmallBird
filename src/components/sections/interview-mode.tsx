"use client"

import { motion } from "motion/react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Briefcase } from "lucide-react"

export function InterviewModeSection() {
  return (
    <section id="modes" className="border-t border-border py-20 px-4 sm:py-28">
      <div className="mx-auto max-w-5xl">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Built for one thing: your interview
          </h2>
          <p className="mt-4 text-muted-foreground">
            Smallbird listens, understands your context, and helps you respond well.
          </p>
        </div>

        <div className="mt-14 flex justify-center">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.5, ease: "easeOut" }}
            className="w-full max-w-md"
          >
            <Card className="h-full transition-all duration-300 hover:-translate-y-1 hover:shadow-lg">
              <CardHeader>
                <div className="glass-subtle mb-2 flex h-10 w-10 items-center justify-center rounded-lg">
                  <Briefcase className="h-5 w-5 text-foreground" />
                </div>
                <CardTitle className="text-xl">Interview Mode</CardTitle>
                <CardDescription className="text-base">
                  Real-time AI assistance during interviews, grounded in your CV, the job description, and any extra
                  context you provide.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Use it when you're the one being interviewed and want relevant, well-informed responses on the
                  spot.
                </p>
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </div>
    </section>
  )
}
