import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    // Multiple lockfiles exist under ~; pin the workspace root.
    root: __dirname,
  },
};

export default nextConfig;
