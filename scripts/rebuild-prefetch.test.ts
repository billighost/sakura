import assert from "node:assert/strict";
import test from "node:test";
import { allowSpeculativePrefetch, createRouteShellPrefetch, PrefetchQueue, routePrefetchTargets } from "../src/rebuild/app/prefetchPolicy";
import { recommendationJson } from "../src/rebuild/app/recommendationTransport";
import { feedTasteKey, feedViewKey } from "../src/rebuild/app/feedIdentity";
import { clearRecommendationCache } from "../src/rebuild/app/recommendationCache";
import { DEFAULT_SETTINGS } from "../src/rebuild/data/validation";

const tick = () => new Promise<void>(resolve => setImmediate(resolve));

test("route intent targets match mounted resource keys without warming mutations or external URLs", () => {
 assert.deepEqual(routePrefetchTargets("/search?q=wind%20song&tab=Artists").paths, ["/api/v2/search?q=wind+song&searchVersion=2"]);
 assert.deepEqual(routePrefetchTargets("/artist/spotify%3A42").paths, ["/api/v2/artists/spotify%3A42"]);
 assert.deepEqual(routePrefetchTargets("/mix/top-songs").paths,["/api/v2/profile"]);
 assert.deepEqual(routePrefetchTargets("/liked").paths,["/api/v2/library?kind=liked"]);
 assert.equal(routePrefetchTargets("/home").surface, "home");
 for (const href of ["https://elsewhere.example/library", "/api/v2/bloom/id/reveal", "/login", "/import", "/library/downloaded", "/artist/%E0"])
  assert.deepEqual(routePrefetchTargets(href).paths, [], href);
});

test("prefetch gives audio recovery, offline mode, hidden tabs and constrained connections bandwidth first", () => {
 const normal = { online: true, visible: true, playback: "playing" };
 assert.equal(allowSpeculativePrefetch(normal), true);
 for (const patch of [{ online: false }, { visible: false }, { playback: "buffering" }, { playback: "resolving" }, { connection: { saveData: true } }, { connection: { effectiveType: "2g" } }])
  assert.equal(allowSpeculativePrefetch({ ...normal, ...patch }), false);
});

test("pending navigation intent outranks idle work while duplicate requests join and concurrency stays bounded", async () => {
 let permitted = false;
 const queue = new PrefetchQueue(() => permitted, 2), started: string[] = [], release = new Map<string, () => void>();
 const task = (name: string) => async () => { started.push(name); await new Promise<void>(resolve => release.set(name, resolve)); };
 queue.enqueue("idle", task("idle")); queue.enqueue("intent", task("intent"), 10); queue.enqueue("other", task("other")); queue.enqueue("intent", task("duplicate"));
 await tick(); assert.deepEqual(started, []);
 permitted = true; queue.resume(); await tick(); assert.deepEqual(started, ["intent", "idle"]);
 permitted = false; release.get("intent")!(); await tick(); assert.deepEqual(started, ["intent", "idle"]);
 permitted = true; queue.resume(); await tick(); assert.deepEqual(started, ["intent", "idle", "other"]);
 release.get("idle")!(); release.get("other")!(); queue.dispose();
});

test("an account change cancels running leases and prevents queued private work from starting", async () => {
 const queue = new PrefetchQueue(() => true, 1), started: string[] = []; let aborted = false;
 queue.enqueue("old-account", signal => new Promise<void>(resolve => { started.push("old-account"); signal.addEventListener("abort", () => { aborted = true; resolve(); }); }));
 queue.enqueue("queued-private", async () => { started.push("queued-private"); });
 await tick(); queue.dispose(); await tick();
 assert.equal(aborted, true); assert.deepEqual(started, ["old-account"]);
});

test("route shells share the intent queue, deduplicate hover/focus, and warm again after Next invalidation", async () => {
 let allowed = false;
 const queue = new PrefetchQueue(() => allowed, 1), calls: string[] = [], invalidations = new Map<string, () => void>();
 const warm = createRouteShellPrefetch(queue, (href, options) => { calls.push(href); invalidations.set(href, options.onInvalidate); }, "https://sakura.invalid");
 warm("/home"); warm("/discover#songs", 10); warm("https://sakura.invalid/discover", 10);
 for (const href of ["https://elsewhere.example/discover", "javascript:alert(1)", "/api/v2/history", "/login"]) warm(href, 20);
 await tick(); assert.deepEqual(calls, [], "Shell requests wait for audio/connection policy just like data");
 allowed = true; queue.resume(); await tick();
 assert.deepEqual(calls, ["/discover", "/home"], "Intent outranks idle preparation and ignores fragments");
 warm("/discover", 10); await tick(); assert.equal(calls.length, 2, "Completed shells also deduplicate repeated intent");
 invalidations.get("/discover")!(); warm("/discover", 10); await tick(); assert.deepEqual(calls, ["/discover", "/home", "/discover"]);
 allowed = false; warm("/library/downloaded", 10); queue.dispose(); allowed = true; queue.resume(); await tick();
 assert.equal(calls.length, 3, "Account disposal prevents queued route requests from starting");
});

test("recommendation prefetch and visible consumers share a request without sharing cancellation", async t => {
 let calls = 0, release!: (response: Response) => void;
 t.mock.method(globalThis, "fetch", async () => { calls++; return new Promise<Response>(resolve => release = resolve); });
 const first = new AbortController(), second = new AbortController();
 const prefetched = recommendationJson("prefetch-share-account", "/api/v2/feed?surface=home", first.signal);
 const visible = recommendationJson("prefetch-share-account", "/api/v2/feed?surface=home", second.signal);
 await tick(); first.abort(); await assert.rejects(prefetched, { name: "AbortError" });
 release(Response.json({ items: ["ready"] })); assert.deepEqual(await visible, { items: ["ready"] }); assert.equal(calls, 1);
 assert.deepEqual(await recommendationJson("prefetch-share-account", "/api/v2/feed?surface=home", second.signal), { items: ["ready"] }); assert.equal(calls, 1);
});

test("account and taste identities never share recommendation responses and explicit refresh bypasses the handoff cache", async t => {
 let calls = 0;
 t.mock.method(globalThis, "fetch", async () => Response.json({ generation: ++calls }));
 const signal = new AbortController().signal, path = "/api/v2/feed?surface=discover";
 assert.equal((await recommendationJson("prefetch-account-one", path, signal, { identity: "taste-one" })).generation, 1);
 assert.equal((await recommendationJson("prefetch-account-two", path, signal, { identity: "taste-one" })).generation, 2);
 assert.equal((await recommendationJson("prefetch-account-one", path, signal, { identity: "taste-two" })).generation, 3);
 assert.equal((await recommendationJson("prefetch-account-one", path, signal, { identity: "taste-one", force: true })).generation, 4);
});

test("an erasure fence rejects an old prefetched response and forces the next view to read current data", async t => {
 const values = new Map<string, string>(), previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
 Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: (key: string) => values.get(key) || null, setItem: (key: string, value: string) => values.set(key, value) } });
 t.after(() => { if (previous) Object.defineProperty(globalThis, "localStorage", previous); else Reflect.deleteProperty(globalThis, "localStorage"); });
 let calls = 0, release!: (response: Response) => void;
 t.mock.method(globalThis, "fetch", async () => { if (++calls === 1) return new Promise<Response>(resolve => release = resolve); return Response.json({ items: [] }); });
 const signal = new AbortController().signal, pending = recommendationJson("prefetch-erased-account", "/api/v2/feed", signal);
 await tick(); clearRecommendationCache("prefetch-erased-account"); release(Response.json({ items: ["erased explanation"] }));
 await assert.rejects(pending, { name: "AbortError" });
 assert.deepEqual(await recommendationJson("prefetch-erased-account", "/api/v2/feed", signal), { items: [] }); assert.equal(calls, 2);
});

test("expired cursor responses stay authoritative and are never reused as successful prefetched data", async t => {
 let calls = 0; t.mock.method(globalThis, "fetch", async () => { calls++; return Response.json({ error: "Cursor expired" }, { status: 410 }); });
 const signal = new AbortController().signal;
 await recommendationJson("prefetch-cursor-account", "/api/v2/feed?cursor=expired", signal, { acceptStatuses: [410] });
 await recommendationJson("prefetch-cursor-account", "/api/v2/feed?cursor=expired", signal, { acceptStatuses: [410] });
 assert.equal(calls, 2);
});

test("prefetch and mounted feed identities include recommendation settings rather than unrelated appearance", () => {
 const settings = { ...DEFAULT_SETTINGS, onboarded: true, seedArtists: [], seedGenres: [], seedArtistSelections: [] };
 assert.equal(feedTasteKey(settings), feedTasteKey({ ...settings, theme: "dark", volume: .1 }));
 assert.notEqual(feedTasteKey(settings), feedTasteKey({ ...settings, privateSession: true }));
 assert.notEqual(feedTasteKey(settings), feedTasteKey({ ...settings, seedGenres: ["Jazz"] }));
 assert.notEqual(feedViewKey("one", "home", "balanced", settings), feedViewKey("two", "home", "balanced", settings));
});
