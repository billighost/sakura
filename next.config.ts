import type { NextConfig } from "next";
import { HTML_LIMITED_BOT_UA_RE } from "next/dist/shared/lib/router/utils/html-bots";
import path from "node:path";
const config:NextConfig={
 distDir:process.env.SAKURA_BUILD_DIR||".next",
 compress:true,
 // Preserve Next's bot defaults and include Meta's newer link fetchers.
 htmlLimitedBots:new RegExp(`${HTML_LIMITED_BOT_UA_RE.source}|Meta-External(?:Fetcher|Agent)`,HTML_LIMITED_BOT_UA_RE.flags),
 allowedDevOrigins:["localhost","172.20.10.3"],
 turbopack:{root:path.resolve(__dirname)},
 cacheComponents:true,
 partialPrefetching:true,
 serverExternalPackages:["kuromoji"],
 outputFileTracingIncludes:{"/api/v2/readings":["./node_modules/kuromoji/dict/**/*"],"/og-preview/render":["./public/og-preview/fonts/**/*","./public/og-preview/artwork/*.jpg"],"/og/*/*":["./public/og-preview/fonts/**/*","./public/og-preview/artwork/*.jpg","./public/og/*"]},
 experimental:{useOffline:true},
};
export default config;
