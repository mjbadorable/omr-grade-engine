import type { NextConfig } from "next";
import { securityHeaders } from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  async headers() {
    return [{
      source: "/(.*)",
      headers: securityHeaders({ clerkPublishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, dev: process.env.NODE_ENV !== "production" }),
    }];
  },
};

export default nextConfig;
