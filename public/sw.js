const SHELL_CACHE = "sakura-shell-v1";
const API_CACHE = "sakura-api-v1";
const AUDIO_CACHE = "sakura-audio-v1";

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
              key !== AUDIO_CACHE
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

  // Bypass service worker for cross-origin (except Cloudinary audio), manifest, and vercel routes
  if (url.origin !== self.location.origin && !isAudioRequest(url)) return;
  if (url.pathname === "/manifest.json" || url.pathname.includes("vercel") || url.pathname.includes("sso")) return;

  if (isApiRequest(url)) {
    event.respondWith(networkFirst(request));
  } else if (isAudioRequest(url)) {
    event.respondWith(cacheOnPlay(request));
  } else {
    event.respondWith(staleWhileRevalidate(request));
  }
});

function isApiRequest(url) {
  return (
    url.origin === self.location.origin &&
    API_PATHS.some((path) => url.pathname.startsWith(path))
  );
}

function isAudioRequest(url) {
  return url.hostname.includes("res.cloudinary.com") && url.pathname.includes("/audio/");
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
    throw err;
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

async function staleWhileRevalidate(request) {
  const cache = await caches.open(SHELL_CACHE);
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
      throw err;
    });
  return cached || fetchPromise;
}
