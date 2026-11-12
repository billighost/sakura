import { canonicalResourcePath } from "./resourcePolicy";
import { musicRoute } from "./offlineNavigation";

export interface PrefetchConnection { saveData?: boolean; effectiveType?: string }
export function allowSpeculativePrefetch({ online, visible, playback, connection }: {
 online: boolean; visible: boolean; playback: string; connection?: PrefetchConnection;
}) {
 return online && visible && playback !== "resolving" && playback !== "buffering" &&
  !connection?.saveData && !["slow-2g", "2g"].includes(connection?.effectiveType || "");
}

/** Match the exact keys consumed by music pages; never prefetch a mutation. */
export function routePrefetchTargets(href: string, origin = "https://sakura.invalid"): { paths: string[]; surface?: "home" | "discover" } {
 let url: URL;
 try { url = new URL(href, origin); } catch { return { paths: [] as string[] }; }
 if (url.origin !== new URL(origin).origin) return { paths: [] as string[] };
 const parts = url.pathname.split("/").filter(Boolean);
 let paths: string[] = [], surface: "home" | "discover" | undefined;
 if (parts.length === 1) {
  switch (parts[0]) {
   case "home": surface = "home"; paths = ["/api/v2/mixes", "/api/v2/bloom/shelf"]; break;
   case "discover": surface = "discover"; paths = ["/api/v2/mixes"]; break;
   case "library": paths = ["/api/v2/library?kind=all"]; break;
   case "liked": paths = ["/api/v2/library?kind=liked", "/api/v2/library?kind=all"]; break;
   case "profile": paths = ["/api/v2/profile"]; break;
   case "bloom": paths = ["/api/v2/bloom/shelf"]; break;
   case "search": {
    const query = url.searchParams.get("q")?.trim();
    paths = [query ? "/api/v2/search?" + new URLSearchParams({ q: query, searchVersion: "2" }) : "/api/v2/search/suggestions"];
    break;
   }
  }
 } else if (parts.length === 2) {
  const bases: Record<string, string> = { artist: "artists", album: "albums", playlist: "playlists", mix: "mixes", track: "recordings", bloom: "bloom" };
  if (bases[parts[0]]) {
   try { paths = ["/api/v2/" + bases[parts[0]] + "/" + encodeURIComponent(decodeURIComponent(parts[1]))]; } catch { /* Invalid route identity. */ }
  }
 }
 return { paths: paths.map(canonicalResourcePath), surface };
}

type PrefetchTask = { key: string; priority: number; work: (signal: AbortSignal) => Promise<unknown>; controller: AbortController };
/** A small queue bounds data prefetch separately from Next's route scheduler. */
export class PrefetchQueue {
 private pending: PrefetchTask[] = [];
 private active = new Map<string, PrefetchTask>();
 private disposed = false;
 constructor(private canRun: () => boolean, private concurrency = 2, private capacity = 20) {}
 enqueue(key: string, work: PrefetchTask["work"], priority = 0) {
  if (this.disposed || this.active.has(key)) return;
  const existing = this.pending.find(task => task.key === key);
  if (existing) { existing.priority = Math.max(existing.priority, priority); this.resume(); return; }
  if (this.pending.length >= this.capacity) {
   const lowest = this.pending.reduce((index, task, current) => task.priority < this.pending[index].priority ? current : index, 0);
   if (this.pending[lowest].priority > priority) return;
   this.pending.splice(lowest, 1)[0].controller.abort();
  }
  this.pending.push({ key, work, priority, controller: new AbortController() });
  this.resume();
 }
 resume() {
  if (this.disposed || !this.canRun()) return;
  this.pending.sort((a, b) => b.priority - a.priority);
  while (this.active.size < this.concurrency && this.pending.length && this.canRun()) {
   const task = this.pending.shift()!; this.active.set(task.key, task);
   void Promise.resolve().then(() => {
    task.controller.signal.throwIfAborted(); return task.work(task.controller.signal);
   }).catch(() => {}).finally(() => {
    if (this.active.get(task.key) === task) this.active.delete(task.key);
    this.resume();
   });
  }
 }
 dispose() {
  this.disposed = true;
  for (const task of [...this.pending, ...this.active.values()]) task.controller.abort(new DOMException("Prefetch owner changed", "AbortError"));
  this.pending = []; this.active.clear();
 }
}

/** Intent must warm the route as well as its separate client data cache. */
export function createRouteShellPrefetch(queue: PrefetchQueue, prefetch: (href: string, options: { onInvalidate: () => void }) => void, origin: string) {
 const warmed = new Set<string>();
 return (href: string, priority = 0) => {
  let url: URL;
  try { url = new URL(href, origin); } catch { return; }
  if (url.origin !== new URL(origin).origin || !musicRoute(url.pathname)) return;
  const path = url.pathname + url.search;
  if (warmed.has(path)) return;
  queue.enqueue("shell:" + path, async signal => {
   signal.throwIfAborted();
   if (warmed.has(path)) return;
   warmed.add(path);
   // Next owns transfer deduplication and tells us when its cached shell expires.
   try { prefetch(path, { onInvalidate: () => { warmed.delete(path); } }); }
   catch (error) { warmed.delete(path); throw error; }
   while (warmed.size > 32) warmed.delete(warmed.values().next().value!);
  }, priority);
 };
}
