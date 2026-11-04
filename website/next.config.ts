import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  images: {
    // 90 is used by the hero POV comparison so its UI text stays crisp.
    qualities: [75, 90],
  },
  // smallbirdai.com is the primary domain. smallbird.in still points here,
  // so send it (and any www host) to the primary domain, keeping the path —
  // except checkout and what it needs (sign-in handoff, APIs, assets), which
  // stays on smallbird.in while it's the only domain Razorpay has approved
  // (see src/lib/payment-domain.ts). The smallbird.in rules are temporary
  // (307) so browsers don't cache them over the exceptions.
  async redirects() {
    return [
      {
        source: "/",
        has: [{ type: "host", value: "(www\\.)?smallbird\\.in" }],
        destination: "https://smallbirdai.com/",
        permanent: false,
      },
      {
        source: "/:path((?!pay(?:/|$)|auth/handoff|api/|_next/|smallbird-logo\\.png).+)",
        has: [{ type: "host", value: "(www\\.)?smallbird\\.in" }],
        destination: "https://smallbirdai.com/:path",
        permanent: false,
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
