import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  compress: true,
  allowedDevOrigins: ["localhost", "172.20.10.3"],
  turbopack: {
    root: path.resolve(__dirname),
  },
  // serverExternalPackages: ["telegram", "big-integer"],
  experimental: {
    serverActions: {
      allowedOrigins: ["*"],
    },
  },
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Access-Control-Allow-Methods", value: "GET,POST,PUT,DELETE,OPTIONS,PATCH" },
          { key: "Access-Control-Allow-Headers", value: "Content-Type, Authorization" },
        ],
      },
    ];
  },
};

export default nextConfig;