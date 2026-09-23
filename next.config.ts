import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  images: {
    // 90 is used by the hero POV comparison so its UI text stays crisp.
    qualities: [75, 90],
  },
};

export default nextConfig;
