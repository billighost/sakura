import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["172.20.10.3", "localhost", "127.0.0.1", "sakura-orcin.vercel.app", "https://sakura-orcin.vercel.app"],
  turbopack: {
    root: path.resolve(__dirname),
  },
  serverExternalPackages: [],
  experimental: {
    serverActions: {
      allowedOrigins: ["172.20.10.3", "sakura-orcin.vercel.app", "localhost:3000"],
    },
  },
};

export default nextConfig;
