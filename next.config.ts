import type { NextConfig } from "next";
import path from "node:path";
const config:NextConfig={
 compress:true,
 allowedDevOrigins:["localhost","172.20.10.3"],
 turbopack:{root:path.resolve(__dirname)},
 cacheComponents:true,
 partialPrefetching:true,
 serverExternalPackages:["kuromoji"],
 outputFileTracingIncludes:{"/api/v2/readings":["./node_modules/kuromoji/dict/**/*"]},
 experimental:{useOffline:true},
};
export default config;
