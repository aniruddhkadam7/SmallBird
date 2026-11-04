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
        src: "/smallbird-icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/smallbird-icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  }
}
