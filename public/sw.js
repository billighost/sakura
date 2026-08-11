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
 * ── Why navigations are network-first (they used to be stale-while-revalidate)
 *
 * SWR is the right shape for an asset and the wrong one for an App Router
 * document, for two reasons that both bite only after a deploy:
 *
 *  1. A cached document hard-codes the build id of the deploy it came from, so
 *     it boots by requesting `/_next/static/<old-build>/…`. Those files are gone
 *     from the server after the next deploy, and they're only in `SHELL_CACHE`
 *     if this exact device happened to fetch them before. When they're not, the
 *     page loads and then fails to hydrate — a blank shell, which is a worse
 *     failure than a slow one. SWR guarantees the *first* paint after every
 *     deploy is the stale one, so this isn't an edge case, it's the norm.
 *  2. It made the app version the user sees lag one launch behind, permanently.
 *
 * Network-first with a short timeout keeps the offline cold start (the reason
 * documents are cached at all) while costing at most `NAV_TIMEOUT_MS` of wait
 * on a bad connection. It's cheap in practice because the document is small and
 * everything expensive it references — chunks, fonts, art — is still served
 * cache-first and doesn't touch the network at all.
 *
 * ── Why RSC payloads are no longer cached
 *
 * They were, keyed separately from the HTML. Two problems, same root cause: a
 * flight stream is a *build-coupled, user-coupled* artifact, not a document.
 * Replaying one from a previous build into a newer router is undefined
 * behaviour, and — the serious half — the streams for authenticated routes
 * embed server-rendered user content, which is exactly the shared-bucket
 * leak the API rule above exists to prevent. Letting them through to the
 * network costs nothing: when a flight fetch fails the App Router falls back
 * to a full navigation, which this worker can still serve offline.
 */

const VERSION = "v5";
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
  // Build output accumulates across deploys whenever VERSION isn't bumped.
  // Generous, because evicting a chunk the current build still needs costs a
  // refetch — `cacheFirst` falls through to the network on a miss.
  [SHELL_CACHE]: 250,
};

/** Longest a navigation waits on the network before the cache answers. */
const NAV_TIMEOUT_MS = 2500;

/** Sentinel resolved by the race when the navigation timeout wins. */
const TIMED_OUT = Symbol("timed-out");

/** Last-resort document when even the cache has nothing. Matches /offline. */
const OFFLINE_HTML =
  "<!doctype html><meta charset=utf-8><title>Offline</title><body style=\"font-family:system-ui;background:#0E0B0F;color:#F5F0F2;display:grid;place-items:center;height:100vh;margin:0\"><p>You're offline.</p>";

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

  /*
   * Deliberately NOT calling skipWaiting() here.
   *
   * It was called unconditionally, which quietly disabled the update handshake
   * in SWRegister.tsx: the new worker activated the instant it installed, fired
   * `controllerchange`, and the page reloaded itself underneath whoever was
   * using it — mid-track, mid-scroll, no warning. The "A new version is ready"
   * prompt could never appear either, because `registration.waiting` had
   * already moved on by the time anything looked at it.
   *
   * Waiting is the correct default. The message handler below still honours an
   * explicit SKIP_WAITING, which is what the Update button sends. A genuine
   * first install has no worker to wait behind, so it activates immediately
   * regardless.
   */
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
    // OfflineBanner probes this to tell "connected" from "connected to a
    // captive portal". Answering it from cache would make the probe always
    // succeed, so it has to reach the network every time.
    url.pathname === "/manifest.json"
  ) {
    return;
  }

  const sameOrigin = url.origin === self.location.origin;

  /*
   * The artwork proxy is an API route by path and an image by everything that
   * matters. It exists to launder cross-origin covers so canvas exports don't
   * taint, which means every share card and every hero tint re-fetches the same
   * handful of images through it. Public artwork, no user scoping needed.
   */
  const isProxiedImage = sameOrigin && url.pathname === "/api/image-proxy";

  // Other API traffic is owned by the IndexedDB layer — see the file header.
  if (sameOrigin && url.pathname.startsWith("/api/") && !isProxiedImage) {
    return;
  }

  // Flight streams go straight to the network — see the file header for why
  // caching them is both a correctness and a privacy problem.
  if (isRscRequest(url, request)) return;

  if (isAudioRequest(url)) {
    event.respondWith(audioStrategy(event));
    return;
  }

  if (isFontRequest(url, request)) {
    event.respondWith(cacheFirst(FONT_CACHE, event));
    return;
  }

  if (isProxiedImage || isImageRequest(url, request)) {
    event.respondWith(cacheFirst(IMAGE_CACHE, event, true));
    return;
  }

  // Hashed build output is immutable — the filename changes when content does,
  // so it can be served from cache forever with no revalidation.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(SHELL_CACHE, event, true));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(pageStrategy(event));
    return;
  }

  event.respondWith(staleWhileRevalidate(SHELL_CACHE, event));
});

/* ── Strategies ─────────────────────────────────────────────────────────────
 *
 * Each takes the FetchEvent rather than the Request so background cache writes
 * can be handed to `event.waitUntil`. Without that the worker is eligible for
 * termination the moment it returns a response, and a `.then()` cache write
 * racing that shutdown is silently dropped — which is why a warm cache used to
 * look unreliable on mobile Safari, where the worker is killed aggressively.
 */

/**
 * Documents: network-first, bounded by NAV_TIMEOUT_MS, cache as the fallback.
 *
 * The network promise is raced rather than aborted, so a slow response still
 * lands in the cache for next time even when the user was served the cached
 * copy on this visit.
 */
async function pageStrategy(event) {
  const cache = await caches.open(PAGE_CACHE);
  const cacheKey = pageCacheKey(event.request);

  const network = fetch(event.request)
    .then((response) => {
      // Don't cache redirects — replaying a cached redirect to /login after
      // the user has signed in produces a loop.
      if (response.ok && !response.redirected && response.type !== "opaqueredirect") {
        event.waitUntil(
          cache
            .put(cacheKey, response.clone())
            .then(() => trim(PAGE_CACHE))
            .catch(() => {})
        );
      }
      return response;
    })
    .catch(() => null);

  const timeout = new Promise((resolve) => setTimeout(() => resolve(TIMED_OUT), NAV_TIMEOUT_MS));
  const first = await Promise.race([network, timeout]);
  if (first && first !== TIMED_OUT) return first;

  const cached = await cache.match(cacheKey, { ignoreVary: true });
  if (cached) return cached;

  // Nothing cached, so the wait was unavoidable — let the request finish.
  const fresh = await network;
  if (fresh) return fresh;

  const shell = await caches.open(SHELL_CACHE);
  const offlinePage = await shell.match("/offline");
  if (offlinePage) return offlinePage;

  return new Response(OFFLINE_HTML, {
    status: 503,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

/**
 * Audio needs range-request awareness. A 206 cannot be stored — `cache.put`
 * rejects on partial responses — and the previous version called it anyway,
 * unguarded, producing an unhandled rejection on every seek in a track that
 * wasn't already cached.
 */
async function audioStrategy(event) {
  const { request } = event;
  const cache = await caches.open(AUDIO_CACHE);

  const cached = await cache.match(request, { ignoreVary: true });
  if (cached) return cached;

  const response = await fetch(request);

  if (response.ok && response.status === 200 && !request.headers.has("range")) {
    event.waitUntil(
      cache
        .put(request, response.clone())
        .then(() => trim(AUDIO_CACHE))
        .catch(() => {
          /* quota or unsupported response — playback continues regardless */
        })
    );
  }

  return response;
}

async function cacheFirst(cacheName, event, limited = false) {
  const { request } = event;
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    // Opaque cross-origin responses (status 0) are still worth caching for
    // images — we can't inspect them but the browser can replay them.
    if (response.ok || response.type === "opaque") {
      event.waitUntil(
        cache
          .put(request, response.clone())
          .then(() => (limited ? trim(cacheName) : undefined))
          .catch(() => {})
      );
    }
    return response;
  } catch {
    return new Response("", { status: 504, statusText: "Offline" });
  }
}

async function staleWhileRevalidate(cacheName, event) {
  const { request } = event;
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const network = fetch(request)
    .then((response) => {
      if (response.ok && !response.redirected) {
        event.waitUntil(cache.put(request, response.clone()).catch(() => {}));
      }
      return response;
    })
    .catch(() => null);

  if (cached) return cached;

  const fresh = await network;
  return fresh || new Response("", { status: 504, statusText: "Offline" });
}

/* ── Helpers ────────────────────────────────────────────────────────────── */

/**
 * Documents are keyed by URL alone.
 *
 * This used to carry `{ headers: request.headers }`, which made the entry
 * subject to Vary matching against a navigation's full header set — including
 * `Accept`, which differs between a cold load and a prefetch. Misses looked
 * random. Only flight streams needed the header distinction and those aren't
 * cached at all now, so the key can be the simple thing.
 */
function pageCacheKey(request) {
  const url = new URL(request.url);
  url.hash = "";
  return url.toString();
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
