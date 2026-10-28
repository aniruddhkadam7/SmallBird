import type { MetadataRoute } from "next";

// Lets the console be added to a phone's home screen and open full-screen
// like an app (no browser bars). iOS reads the apple-* tags in layout.tsx;
// this covers Android/Chrome.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Smallbird Admin",
    short_name: "SB Admin",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#0e1525",
    theme_color: "#0e1525",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
