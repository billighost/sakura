import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  compress: true,
  allowedDevOrigins: ["localhost", "172.20.10.3"],
  turbopack: {
    root: path.resolve(__dirname),
  },
  /**
   * Cache Components — the basis for instant navigation, and for three things
   * this app wanted and couldn't have without it.
   *
   * 1. Partial Prerendering becomes the default: every route ships a static HTML
   *    shell that paints immediately while the session-dependent parts stream
   *    in. Before this, /home was `force-dynamic`, so a <Link> to it could
   *    prefetch nothing at all and every tap on Home waited on the server.
   * 2. `partialPrefetching` (below) requires this flag — `next build` throws at
   *    config validation without it.
   * 3. Client-side navigation starts preserving component state via React's
   *    <Activity>: the previous route is hidden rather than unmounted, so going
   *    Back returns a page with its state intact instead of a blank one that
   *    re-fetches everything it just had.
   *
   * Routes not yet converted carry `export const instant = false`, which marks
   * them as allowed to block. They still ship a static shell; they're just
   * exempt from instant-navigation validation until each is worked through.
   */
  cacheComponents: true,
  partialPrefetching: true,
  // serverExternalPackages: ["telegram", "big-integer"],
  experimental: {
    serverActions: {
      allowedOrigins: ["*"],
    },
    /**
     * A failed navigation, RSC fetch, prefetch or Server Action stays pending
     * and retries when the connection returns, instead of throwing. Pairs with
     * the `useOffline()` hook in OfflineBanner, which is a more honest signal
     * than `navigator.onLine` — that only reports the OS network interface, so
     * it says "online" on WiFi with no upstream, which is exactly when the app
     * looks broken for no visible reason.
     *
     * Note this covers framework requests only. The per-page `fetch()` calls in
     * client components keep their own error handling; their offline story is
     * the service worker plus the IndexedDB caches in lib/offline-db.
     */
    useOffline: true,
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