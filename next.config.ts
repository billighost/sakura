import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["172.20.10.3", "localhost", "127.0.0.1"],
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
