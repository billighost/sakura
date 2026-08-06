const SHELL_CACHE = "sakura-shell-v2";
const API_CACHE = "sakura-api-v2";
const AUDIO_CACHE = "sakura-audio-v1";
const IMAGE_CACHE = "sakura-images-v2";
const FONT_CACHE = "sakura-fonts-v2";

const SHELL_ASSETS = [
  "/",
  "/home",
  "/manifest.json",
  "/icons/icon-transparent-192.png",
  "/icons/icon-transparent-512.png",
  "/icons/favicon.ico",
  "/icons/apple-touch-icon.png",
];

const API_PATHS = [
  "/api/tracks",
  "/api/albums",
  "/api/artists",
  "/api/playlists",
  "/api/history",
  "/api/favorites",
  "/api/profile",
  "/api/settings",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter(
            (key) =>
              key !== SHELL_CACHE &&
              key !== API_CACHE &&
              key !== AUDIO_CACHE &&
              key !== IMAGE_CACHE &&
              key !== FONT_CACHE
          )
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== "GET") return;

  // Bypass service worker for development HMR, SSO, manifest, or vercel build links
  if (
    url.pathname === "/manifest.json" ||
    url.pathname.includes("vercel") ||
    url.pathname.includes("sso") ||
    url.pathname.startsWith("/_next/webpack-hmr") ||
    url.pathname.includes("hot-update")
  ) {
    return;
  }

  // Handle Audio Requests
  if (isAudioRequest(url)) {
    event.respondWith(cacheOnPlay(request));
    return;
  }

  // Handle Fonts
  if (isFontRequest(url, request)) {
    event.respondWith(cacheFirst(FONT_CACHE, request));
    return;
  }

  // Handle Images
  if (isImageRequest(url, request)) {
    event.respondWith(staleWhileRevalidate(IMAGE_CACHE, request));
    return;
  }

  // Handle API requests
  if (isApiRequest(url)) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Handle Next.js page document navigation or RSC requests
  const isNav = request.mode === "navigate";
  const isRsc = isNextRscRequest(url, request);

  if (isNav || isRsc) {
    event.respondWith(networkFirstWithFallback(request, isNav));
    return;
  }

  // Default Shell Assets (JS chunks, static bundles, etc.)
  event.respondWith(staleWhileRevalidate(SHELL_CACHE, request));
});

function isNextRscRequest(url, request) {
  return (
    request.headers.get("rsc") === "1" ||
    request.headers.has("next-router-state-tree") ||
    request.headers.has("next-router-prefetch") ||
    url.pathname.startsWith("/_next/data/")
  );
}

function getCacheRequest(request) {
  const url = new URL(request.url);
  const isRsc =
    request.headers.get("rsc") === "1" ||
    request.headers.has("next-router-state-tree") ||
    request.headers.has("next-router-prefetch");

  if (isRsc) {
    // Differentiate cache key to prevent overwriting raw HTML or vice versa
    url.searchParams.set("__rsc", "1");
    return new Request(url.toString(), {
      method: request.method,
      headers: request.headers,
      credentials: request.credentials,
      mode: request.mode,
    });
  }
  return request;
}

async function networkFirstWithFallback(request, isNav) {
  const cacheKey = getCacheRequest(request);
  const shellCache = await caches.open(SHELL_CACHE);

  try {
    const response = await fetch(request);
    if (response.redirected) {
      return response;
    }
    if (response.ok) {
      shellCache.put(cacheKey, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await shellCache.match(cacheKey);
    if (cached) return cached;

    if (isNav) {
      const fallbackShell =
        (await shellCache.match("/home")) || (await shellCache.match("/"));
      if (fallbackShell) return fallbackShell;
    }
    return new Response("Offline (Network Error)", { status: 480, statusText: "Offline" });
  }
}

function isApiRequest(url) {
  return (
    url.origin === self.location.origin &&
    API_PATHS.some((path) => url.pathname.startsWith(path))
  );
}

function isAudioRequest(url) {
  return (
    (url.hostname.includes("res.cloudinary.com") && url.pathname.includes("/audio/")) ||
    url.pathname.startsWith("/api/stream")
  );
}

function isFontRequest(url, request) {
  return (
    url.hostname.includes("fonts.gstatic.com") ||
    url.hostname.includes("fonts.googleapis.com") ||
    request.destination === "font" ||
    url.pathname.endsWith(".woff2") ||
    url.pathname.endsWith(".woff") ||
    url.pathname.endsWith(".ttf")
  );
}

function isImageRequest(url, request) {
  return (
    request.destination === "image" ||
    url.pathname.match(/\.(jpg|jpeg|png|gif|svg|webp|ico)/i) ||
    url.hostname.includes("res.cloudinary.com") ||
    url.hostname.includes("deezer.com") ||
    url.hostname.includes("dzcdn.net")
  );
}

async function networkFirst(request) {
  const cache = await caches.open(API_CACHE);
  try {
    const response = await fetch(request);
    if (response.redirected) {
      return response;
    }
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    return new Response(JSON.stringify({ error: "Offline" }), { 
      status: 503, 
      headers: { "Content-Type": "application/json" } 
    });
  }
}

async function cacheOnPlay(request) {
  const cache = await caches.open(AUDIO_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.redirected) {
    return response;
  }
  if (response.ok) {
    cache.put(request, response.clone());
  }
  return response;
}

async function cacheFirst(cacheName, request) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    return fetch(request);
  }
}

async function staleWhileRevalidate(cacheName, request) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request)
    .then((response) => {
      if (response.redirected) {
        return response;
      }
      if (response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch((err) => {
      if (cached) return cached;
      return new Response("Network failure", { status: 480 });
    });
  return cached || fetchPromise;
}
