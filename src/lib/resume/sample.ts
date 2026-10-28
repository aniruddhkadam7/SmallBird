import { normalizeResume } from "./types"

// A made-up person, only to show the templates on the marketing pages.
export const SAMPLE_RESUME = normalizeResume({
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
          headingRight: "Jul 2022 - Present",
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
          ],
        },
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
      ],
    },
    {
      title: "Technical skills",
      kind: "table",
      rows: [
        { label: "Languages", value: "Go, Python, SQL, TypeScript" },
        { label: "Cloud & tools", value: "AWS (Lambda, RDS, S3), Docker, PostgreSQL, Redis" },
      ],
    },
  ],
})
