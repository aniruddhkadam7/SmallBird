import type { MetadataRoute } from "next"
import { siteUrl } from "@/lib/site"

const routes: { path: string; changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"]; priority: number }[] = [
  { path: "", changeFrequency: "weekly", priority: 1 },
  { path: "/pricing", changeFrequency: "monthly", priority: 0.9 },
  { path: "/download", changeFrequency: "monthly", priority: 0.9 },
  { path: "/ai-interview-assistant", changeFrequency: "monthly", priority: 0.8 },
  { path: "/ai-interview-copilot", changeFrequency: "monthly", priority: 0.8 },
  { path: "/ai-coding-interview-assistant", changeFrequency: "monthly", priority: 0.8 },
  { path: "/ai-meeting-assistant", changeFrequency: "monthly", priority: 0.8 },
  { path: "/features/real-time-ai", changeFrequency: "monthly", priority: 0.7 },
]

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date()
  return routes.map((route) => ({
    url: `${siteUrl}${route.path}`,
    lastModified,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }))
}
