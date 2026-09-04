import type { MetadataRoute } from "next"
import { siteName } from "@/lib/site"

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${siteName} — AI Assistant`,
    short_name: siteName,
    description:
      "Real-time AI assistance during interviews — with context from your CV and the job description.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#0f0f12",
    icons: [
      {
        src: "/smallbird-logo.png",
        sizes: "any",
        type: "image/png",
      },
    ],
  }
}
