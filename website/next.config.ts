import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  images: {
    // 90 is used by the hero POV comparison so its UI text stays crisp.
    qualities: [75, 90],
  },
  // smallbirdai.com is the primary domain. smallbird.in still points here,
  // so send it (and any www host) to the primary domain, keeping the path.
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "(www\\.)?smallbird\\.in" }],
        destination: "https://smallbirdai.com/:path*",
        permanent: true,
      },
      {
        source: "/:path*",
        has: [{ type: "host", value: "www\\.smallbirdai\\.com" }],
        destination: "https://smallbirdai.com/:path*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
