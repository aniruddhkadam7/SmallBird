import { normalizeResume, type ResumeData, type TemplateId } from "./types"

// A made-up person, only to show the templates (marketing pages, and the
// editor while a resume is still empty). Templates fit different amounts on a
// page, so each one gets the base below plus as many EXTRAS as fill exactly
// one A4 page in it. Re-measure EXTRA_COUNT after changing any text here.

/** Optional lines, added in this order. */
const EXTRAS = [
  "redis",
  "mentoring",
  "practices",
  "dashboard",
  "speaker",
  "pingwatch",
  "runbooks",
  "loglensUsers",
  "school",
  "expenseUsers",
  "oncall",
  "gcp",
  "monolith",
] as const

type Extra = (typeof EXTRAS)[number]

const EXTRA_COUNT: Record<TemplateId, number> = {
  navy: 4,
  classic: 8,
  modern: 0,
  sidebar: 13,
  bold: 6,
}

function build(has: (extra: Extra) => boolean): ResumeData {
  const when = <T,>(extra: Extra, ...items: T[]): T[] => (has(extra) ? items : [])
  return normalizeResume({
    name: "Priya Sharma",
    tagline: "Backend Engineer • Cloud",
    contact: [
      { label: "E-mail", value: "priya.sharma@example.com" },
      { label: "Phone", value: "+91 98765 43210" },
      { label: "Location", value: "Pune, India" },
      { label: "LinkedIn", value: "linkedin.com/in/priyasharma" },
    ],
    sections: [
      {
        title: "Summary",
        kind: "text",
        text: "Backend engineer with 3 years of experience building Python and Go services on AWS. I like making slow systems fast and keeping them easy to run.",
      },
      {
        title: "Work experience",
        kind: "entries",
        listStyle: "bullets",
        entries: [
          {
            heading: "Fintech Labs Pvt. Ltd.",
            headingRight: "Jul 2023 - Present",
            subheading: "Software Engineer",
            subheadingRight: "Pune, India",
            items: [
              "**Project:** UPI Payments Gateway",
              "**Client:** In-house",
              "**Technologies:** Go, PostgreSQL, AWS",
              "**Responsibilities:**",
              "Built a payments API in Go that handles 2M requests a day with 99.95% uptime.",
              "Cut report generation time from 40 minutes to 6 by moving batch jobs to AWS Lambda.",
              "Set up CI/CD with GitHub Actions, so releases went from weekly to daily.",
              ...when("redis", "Added Redis caching to the merchant lookup, bringing p95 latency down from 180ms to 35ms."),
              ...when("monolith", "Split the billing module out of the monolith into its own service with zero downtime."),
              ...when("runbooks", "Wrote runbooks and on-call alerts that cut incident response time by half."),
              ...when("mentoring", "Mentored 2 new engineers and ran the team's weekly code reviews."),
            ],
          },
          {
            heading: "CloudNest Technologies",
            headingRight: "Jul 2022 - Jun 2023",
            subheading: "Junior Software Engineer",
            subheadingRight: "Bengaluru, India",
            items: [
              "Wrote Python services for an inventory platform used by 300+ retail stores.",
              "Moved 40 cron jobs to a queue-based worker system, ending missed nightly runs.",
              "Wrote integration tests that raised coverage from 45% to 80%.",
              ...when("oncall", "Joined the on-call rotation and fixed the three most frequent alerts at the source."),
              ...when("dashboard", "Built an internal admin dashboard in React that the support team uses every day."),
            ],
          },
        ],
      },
      {
        title: "Projects",
        kind: "entries",
        listStyle: "bullets",
        entries: [
          {
            heading: "LogLens",
            subheading: "Go, ClickHouse, React",
            items: [
              "Open-source log search tool that queries 50GB of logs in under 2 seconds.",
              "300+ stars on GitHub; used by two small startups in production.",
              ...when("loglensUsers", "Added saved searches and Slack alerts, the two most requested features."),
            ],
          },
          {
            heading: "ExpenseSplit",
            subheading: "Python, FastAPI, PostgreSQL",
            items: [
              "Bill-splitting app with UPI payment links, used by 1,000+ students at COEP.",
              ...when("expenseUsers", "Handles 20,000+ settled bills; deployed on AWS for under Rs 500 a month."),
            ],
          },
          ...when("pingwatch", {
            heading: "PingWatch",
            subheading: "Go, Prometheus, Grafana",
            items: ["Uptime monitor that checks 500 endpoints a minute and sends alerts to Slack and email."],
          }),
        ],
      },
      {
        title: "Education",
        kind: "entries",
        listStyle: "italic",
        entries: [
          {
            heading: "B.Tech in Computer Engineering",
            headingRight: "2018 - 2022",
            subheading: "CGPA: 8.6/10",
            subheadingRight: "COEP, Pune",
            items: ["Final-year project: real-time fraud detection on UPI transactions"],
          },
          ...when("school", {
            heading: "Higher Secondary (Science)",
            headingRight: "2016 - 2018",
            subheading: "Score: 91%",
            subheadingRight: "Fergusson College, Pune",
            items: [],
          }),
        ],
      },
      {
        title: "Technical skills",
        kind: "table",
        rows: [
          { label: "Languages", value: "Go, Python, SQL, TypeScript" },
          { label: "Cloud & tools", value: "AWS (Lambda, RDS, S3), Docker, PostgreSQL, Redis" },
          ...when("practices", { label: "Practices", value: "REST APIs, CI/CD, unit and integration testing, system design" }),
        ],
      },
      {
        title: "Achievements",
        kind: "entries",
        listStyle: "bullets",
        entries: [
          {
            items: [
              "AWS Certified Developer – Associate (2024).",
              "Winner, Smart India Hackathon 2021 (software edition).",
              ...when("gcp", "Google Cloud Associate Cloud Engineer (2023)."),
              ...when("speaker", "Speaker at PyCon India 2024 on scaling Python services."),
            ],
          },
        ],
      },
    ],
  })
}

/** The sample resume in `template`, filling one page of it. */
export function sampleResume(template: TemplateId): ResumeData {
  const extras = new Set<Extra>(EXTRAS.slice(0, EXTRA_COUNT[template]))
  return { ...build((extra) => extras.has(extra)), template }
}
