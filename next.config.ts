import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  reactCompiler: true,
  experimental: { serverActions: { bodySizeLimit: "26mb" } },
};

export default nextConfig;
