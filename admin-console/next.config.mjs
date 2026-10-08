import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // This app lives inside the desktop app's repo, which has its own
  // lockfile -- pin the trace root to this directory so Next doesn't guess
  // wrong and pull unrelated files into the build.
  outputFileTracingRoot: __dirname,
  // Pages folded into others -- keep old bookmarks working.
  async redirects() {
    return [
      { source: "/subscriptions", destination: "/payments", permanent: false },
      { source: "/data-integrity", destination: "/system-health", permanent: false },
    ];
  },
};

export default nextConfig;
