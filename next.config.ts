import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    // Multiple lockfiles exist under ~; pin the workspace root.
    root: __dirname,
  },
  async headers() {
    return [{ source: '/c/:path*', headers: [{ key: 'X-Robots-Tag', value: 'noindex' }] }];
  },
};

export default nextConfig;
