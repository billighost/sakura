const CACHE="sakura-ink-shell-v1";
const OFFLINE="/offline";
self.addEventListener("install",event=>event.waitUntil((async()=>{
 const cache=await caches.open(CACHE);
 try{const response=await fetch(OFFLINE,{cache:"reload"});if(response.ok){await cache.put(OFFLINE,response.clone());const html=await response.text();const assets=[...new Set(html.match(/\/_next\/static\/[^"\s<>]+\.(?:js|css)/g)||[])];await Promise.allSettled(assets.map(url=>cache.add(url)));}}catch{}
 await self.skipWaiting();
})()));
self.addEventListener("activate",event=>event.waitUntil((async()=>{for(const name of await caches.keys())if(name.startsWith("sakura")&&name!==CACHE)await caches.delete(name);await self.clients.claim();})()));
self.addEventListener("fetch",event=>{
 const request=event.request;const url=new URL(request.url);
 if(request.method!=="GET"||url.origin!==self.location.origin||url.pathname.startsWith("/api/")||request.headers.has("RSC")||url.searchParams.has("_rsc"))return;
 if(request.mode==="navigate"){event.respondWith(fetch(request).catch(async()=>{const saved=await caches.match(OFFLINE);return saved||new Response("Your offline library has not been opened on this device yet.",{status:503,headers:{"Content-Type":"text/plain"}});}));return;}
 if(url.pathname.startsWith("/_next/static/")||url.pathname.startsWith("/icons/")){event.respondWith((async()=>{const cache=await caches.open(CACHE);const saved=await cache.match(request);if(saved)return saved;const response=await fetch(request);if(response.ok){await cache.put(request,response.clone());const keys=await cache.keys();if(keys.length>250)await cache.delete(keys.find(key=>new URL(key.url).pathname!==OFFLINE));}return response;})());}
});
