/**
 * Sakura service worker.
 *
 * Caching responsibilities are split deliberately:
 *
 *   - **This worker** owns things that are the same for everybody: the app
 *     shell, hashed build assets, fonts, cover images, audio blobs.
 *   - **IndexedDB** (see `lib/useOfflineData.ts`) owns per-user API data,
 *     where it can be keyed by user id.
 *
 * That split is a correctness requirement, not a style choice. The previous
 * worker cached `/api/favorites`, `/api/profile` and friends in a single shared
 * bucket with no user scoping, so on a device where two people had both signed
 * in, whoever loaded second could be served the first one's library straight
 * out of the cache. API responses are no longer cached here at all; the parts
 * that must survive offline are stored per-user in IndexedDB instead.
 *
 * Navigation documents are still cached (they're needed for offline cold
 * starts) and are purged wholesale on sign-out via the CLEAR_CACHES message.
 */

const VERSION = "v4";
const SHELL_CACHE = `sakura-shell-${VERSION}`;
const PAGE_CACHE = `sakura-pages-${VERSION}`;
const AUDIO_CACHE = `sakura-audio-${VERSION}`;
const IMAGE_CACHE = `sakura-images-${VERSION}`;
const FONT_CACHE = `sakura-fonts-${VERSION}`;

const CURRENT_CACHES = [
  SHELL_CACHE,
  PAGE_CACHE,
  AUDIO_CACHE,
  IMAGE_CACHE,
  FONT_CACHE,
];

/** Entries kept per cache, oldest evicted first. Prevents unbounded growth. */
const CACHE_LIMITS = {
  [PAGE_CACHE]: 60,
  [IMAGE_CACHE]: 400,
  [AUDIO_CACHE]: 120,
};

const SHELL_ASSETS = [
  "/offline",
  "/manifest.json",
  "/icons/icon-transparent-192.png",
  "/icons/icon-transparent-512.png",
  "/icons/favicon.ico",
  "/icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      // addAll is atomic: one 404 discards the whole batch and install fails.
      // Individual puts let a missing icon degrade instead of breaking the SW.
      Promise.all(
        SHELL_ASSETS.map((url) =>
          cache.add(url).catch(() => {
            /* non-fatal */
          })
        )
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith("sakura-") && !CURRENT_CACHES.includes(key))
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("message", (event) => {
  const type = event.data?.type;

  if (type === "SKIP_WAITING") {
    self.skipWaiting();
    return;
  }

  // Sign-out: drop everything that could contain the previous user's content.
  if (type === "CLEAR_CACHES") {
    event.waitUntil(
      (async () => {
        const keys = await caches.keys();
        await Promise.all(
          keys.filter((k) => k.startsWith("sakura-")).map((k) => caches.delete(k))
        );
      })()
    );
  }
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  // Never intercept: dev tooling, auth flows, or anything non-http.
  if (!url.protocol.startsWith("http")) return;
  if (
    url.pathname.startsWith("/_next/webpack-hmr") ||
    url.pathname.includes("hot-update") ||
    url.pathname.startsWith("/api/auth") ||
    url.pathname === "/manifest.json"
  ) {
    return;
  }

  // API traffic is owned by the IndexedDB layer — see the file header.
  if (url.origin === self.location.origin && url.pathname.startsWith("/api/")) {
    return;
  }

  if (isAudioRequest(url)) {
    event.respondWith(audioStrategy(request));
    return;
  }

  if (isFontRequest(url, request)) {
    event.respondWith(cacheFirst(FONT_CACHE, request));
    return;
  }

  if (isImageRequest(url, request)) {
    event.respondWith(cacheFirst(IMAGE_CACHE, request, true));
    return;
  }

  // Hashed build output is immutable — the filename changes when content does,
  // so it can be served from cache forever with no revalidation.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(SHELL_CACHE, request));
    return;
  }

  if (request.mode === "navigate" || isRscRequest(url, request)) {
    event.respondWith(pageStrategy(request));
    return;
  }

  event.respondWith(staleWhileRevalidate(SHELL_CACHE, request));
});

/* ── Strategies ─────────────────────────────────────────────────────────── */

/**
 * Documents: serve cache immediately when we have it, refresh behind the
 * scenes. This is what makes a warm start paint instantly instead of waiting
 * on the network, which was the main thing the old network-first path cost.
 */
async function pageStrategy(request) {
  const cache = await caches.open(PAGE_CACHE);
  const cacheKey = pageCacheKey(request);
  const cached = await cache.match(cacheKey);

  const network = fetch(request)
    .then((response) => {
      // Don't cache redirects — replaying a cached redirect to /login after
      // the user has signed in produces a loop.
      if (response.ok && !response.redirected && response.type !== "opaqueredirect") {
        cache.put(cacheKey, response.clone()).then(() => trim(PAGE_CACHE));
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    // Revalidate without blocking the response.
    network.catch(() => {});
    return cached;
  }

  const fresh = await network;
  if (fresh) return fresh;

  const shell = await caches.open(SHELL_CACHE);
  const offlinePage = await shell.match("/offline");
  if (offlinePage) return offlinePage;

  return new Response(
    "<!doctype html><meta charset=utf-8><title>Offline</title><body style=\"font-family:system-ui;background:#0E0B0F;color:#F5F0F2;display:grid;place-items:center;height:100vh;margin:0\"><p>You're offline.</p>",
    { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

/**
 * Audio needs range-request awareness. A 206 cannot be stored — `cache.put`
 * rejects on partial responses — and the previous version called it anyway,
 * unguarded, producing an unhandled rejection on every seek in a track that
 * wasn't already cached.
 */
async function audioStrategy(request) {
  const cache = await caches.open(AUDIO_CACHE);

  const cached = await cache.match(request, { ignoreVary: true });
  if (cached) return cached;

  const response = await fetch(request);

  if (response.ok && response.status === 200 && !request.headers.has("range")) {
    cache
      .put(request, response.clone())
      .then(() => trim(AUDIO_CACHE))
      .catch(() => {
        /* quota or unsupported response — playback continues regardless */
      });
  }

  return response;
}

async function cacheFirst(cacheName, request, limited = false) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    // Opaque cross-origin responses (status 0) are still worth caching for
    // images — we can't inspect them but the browser can replay them.
    if (response.ok || response.type === "opaque") {
      cache
        .put(request, response.clone())
        .then(() => limited && trim(cacheName))
        .catch(() => {});
    }
    return response;
  } catch {
    return new Response("", { status: 504, statusText: "Offline" });
  }
}

async function staleWhileRevalidate(cacheName, request) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const network = fetch(request)
    .then((response) => {
      if (response.ok && !response.redirected) {
        cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    network.catch(() => {});
    return cached;
  }

  const fresh = await network;
  return fresh || new Response("", { status: 504, statusText: "Offline" });
}

/* ── Helpers ────────────────────────────────────────────────────────────── */

/**
 * RSC payloads and HTML documents share a URL but are entirely different
 * bodies. Without distinct keys one overwrites the other and the router is
 * handed HTML where it expects a flight stream.
 */
function pageCacheKey(request) {
  const url = new URL(request.url);
  if (isRscRequest(url, request)) {
    url.searchParams.set("__rsc", "1");
  }
  return new Request(url.toString(), { headers: request.headers });
}

function isRscRequest(url, request) {
  return (
    request.headers.get("rsc") === "1" ||
    request.headers.has("next-router-state-tree") ||
    request.headers.has("next-router-prefetch") ||
    url.pathname.startsWith("/_next/data/")
  );
}

function isAudioRequest(url) {
  return (
    (url.hostname.includes("res.cloudinary.com") && url.pathname.includes("/audio/")) ||
    url.pathname.startsWith("/api/stream") ||
    /\.(mp3|m4a|aac|ogg|opus|flac|wav)(\?|$)/i.test(url.pathname)
  );
}

function isFontRequest(url, request) {
  return (
    request.destination === "font" ||
    /\.(woff2?|ttf|otf)(\?|$)/i.test(url.pathname)
  );
}

function isImageRequest(url, request) {
  return (
    request.destination === "image" ||
    /\.(jpg|jpeg|png|gif|svg|webp|avif|ico)(\?|$)/i.test(url.pathname) ||
    url.hostname.includes("res.cloudinary.com") ||
    url.hostname.includes("dzcdn.net") ||
    url.hostname.includes("deezer.com")
  );
}

/**
 * Bound a cache to its entry limit, evicting oldest-first.
 *
 * Cache Storage has no size cap of its own, so without this the image and
 * audio caches grow until the origin hits its quota — at which point *every*
 * subsequent write fails, including the ones that matter.
 */
async function trim(cacheName) {
  const limit = CACHE_LIMITS[cacheName];
  if (!limit) return;

  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= limit) return;

  // cache.keys() returns insertion order, so the front is the oldest.
  await Promise.all(keys.slice(0, keys.length - limit).map((key) => cache.delete(key)));
}
