import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { SharedFlight } from "../src/rebuild/app/sharedFlight";
import { musicTrack } from "../src/rebuild/app/types";
import { appendUniqueFeedItems } from "../src/rebuild/app/feedItems";
import { HERO_REFRESH_MS } from "../src/rebuild/recommendations/hero";
import type { JsonOptions } from "../src/rebuild/app/errors";
import type { FeedState } from "../src/rebuild/app/recommendationViews";

type Raw = Record<string, unknown>;
type Views = typeof import("../src/rebuild/app/recommendationViews");
type Cache = typeof import("../src/rebuild/app/recommendationCache");
type Transport = typeof import("../src/rebuild/app/recommendationTransport");
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const compiled = new Map<string, string>();

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}

function moduleFrom<T>(path: string, dependencies: Record<string, unknown>, globals: Record<string, unknown>): T {
  let source = compiled.get(path);
  if (!source) {
    source = ts.transpileModule(readFileSync(path, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    compiled.set(path, source);
  }
  const exports = {}, context = vm.createContext({
    module: { exports }, exports, URLSearchParams, AbortController, DOMException, ...globals,
    require(name: string) {
      if (name in dependencies) return dependencies[name];
      throw new Error("Unexpected recommendation fixture dependency: " + name);
    },
  });
  vm.runInContext(source, context, { filename: path });
  return context.module.exports as T;
}

// The real view, request-sharing and invalidation modules run together. Only
// requestJson and the device I/O boundary are replaced, so no provider, DB,
// global fetch, localStorage or IndexedDB is touched by this suite.
function fixture() {
  let now = Date.parse("2026-11-12T12:00:00.000Z");
  class ClockDate extends Date { static now() { return now; } }
  const storage = new Map<string, string>();
  const disk = new Map<string, { data: unknown; savedAt: number }>();
  const storageWrites: string[] = [], writes: { accountId: string; key: string }[] = [];
  const requests: { path: string; signal: AbortSignal; options: JsonOptions; response: ReturnType<typeof deferred<Raw>> }[] = [];
  const diskKey = (accountId: string, key: string) => JSON.stringify([accountId, key]);
  const globals = {
    Date: ClockDate, navigator: { onLine: true },
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem(key: string, value: string) { storage.set(key, value); storageWrites.push(key); },
    },
  };
  const cache = moduleFrom<Cache>("src/rebuild/app/recommendationCache.ts", {
    "./offline": {
      async localRead(accountId: string, key: string) {
        const value = disk.get(diskKey(accountId, key));
        return value ? structuredClone(value) : undefined;
      },
      async localWrite(accountId: string, key: string, value: { data: unknown; savedAt: number }) {
        writes.push({ accountId, key });
        disk.set(diskKey(accountId, key), structuredClone(value));
      },
    },
  }, globals);
  const policy = moduleFrom<typeof import("../src/rebuild/app/resourcePolicy")>("src/rebuild/app/resourcePolicy.ts", {}, globals);
  const transport = moduleFrom<Transport>("src/rebuild/app/recommendationTransport.ts", {
    "./errors": {
      requestJson(path: string, init: RequestInit, options: JsonOptions) {
        assert.ok(init.signal, "Each underlying request has a shared abort signal");
        const response = deferred<Raw>();
        requests.push({ path, signal: init.signal, options, response });
        return response.promise;
      },
    },
    "./sharedFlight": { SharedFlight }, "./resourcePolicy": policy, "./recommendationCache": cache,
  }, globals);
  const views = moduleFrom<Views>("src/rebuild/app/recommendationViews.ts", {
    "./types": { musicTrack }, "./recommendationTransport": transport, "./resourcePolicy": policy,
    "../recommendations/hero": { HERO_REFRESH_MS }, "./recommendationCache": cache,
  }, globals);
  return {
    views, cache, transport, requests, writes, storageWrites,
    now: () => now, advance: (ms: number) => { now += ms; },
    seed(accountId: string, key: string, state: FeedState) {
      disk.set(diskKey(accountId, "recommendation-view:feed:" + key), { data: structuredClone(state), savedAt: now - 1000 });
    },
    persisted(accountId: string, kind: "feed" | "hero", key: string) {
      return disk.get(diskKey(accountId, "recommendation-view:" + kind + ":" + key));
    },
  };
}

const account = "recommendation-account", key = account + ":home:balanced:taste-one";
const signal = () => new AbortController().signal;
const item = (id: string) => ({
  track: { id, title: "Song " + id, artists: ["Fixture artist"], durationMs: 180000, reference: { provider: "deezer", id } },
  reason: "Selected for fixture listening", lane: "similar",
});
function feedEnvelope(id = "first", nextCursor: string | null = "session-one:page-two"): Raw {
  return {
    items: [item(id)], sections: [{ id: "shelf", title: "Your shelf", description: "Saved ordering", tracks: [item("shelf-song").track] }],
    nextCursor, personalized: true, totalCandidates: 36, generatedAt: "2026-11-12T11:59:00.000Z",
  };
}
function heroEnvelope(now: number, id = "hero", generatedAt = now): Raw {
  return { item: item(id), refreshAt: now + HERO_REFRESH_MS, generatedAt: new Date(generatedAt).toISOString() };
}

test("cold feed and hero prefetch/mount consumers share one includeHero request and its completed handoff", async () => {
  const h = fixture();
  const prefetchedFeed = h.views.loadFirstFeed(account, key, "home", "balanced", signal());
  const prefetchedHero = h.views.loadInitialHero(account, key, "home", "balanced", signal());
  await tick();
  const mountedFeed = h.views.loadFirstFeed(account, key, "home", "balanced", signal());
  const mountedHero = h.views.loadInitialHero(account, key, "home", "balanced", signal());
  await tick();
  assert.equal(h.requests.length, 1);
  const request = h.requests[0], url = new URL(request.path, "https://sakura.invalid");
  assert.equal(url.pathname, "/api/v2/feed");
  assert.equal(url.searchParams.get("includeHero"), "1");
  assert.equal(url.searchParams.get("limit"), "12");
  assert.equal(url.searchParams.get("surface"), "home");
  assert.equal(url.searchParams.get("mode"), "balanced");
  assert.equal(request.options.accountId, account);
  assert.equal(request.options.context, "page");
  assert.deepEqual(Array.from(request.options.acceptStatuses ?? []), [409, 410]);
  request.response.resolve({ ...feedEnvelope(), hero: heroEnvelope(h.now()) });
  const [prefeed, prehero, feed, hero] = await Promise.all([prefetchedFeed, prefetchedHero, mountedFeed, mountedHero]);
  assert.equal(prefeed.feed?.items[0].track.id, "first");
  assert.equal(feed.feed?.nextCursor, "session-one:page-two");
  assert.equal(prehero.item?.track.id, "hero");
  assert.equal(hero.item?.track.id, "hero");
  assert.equal(h.views.cachedFeed(account, key).ready, true);
  assert.equal(h.views.cachedHero(account, key).ready, true);
  assert.ok(h.persisted(account, "feed", key));
  assert.ok(h.persisted(account, "hero", key));
  await h.views.loadFirstFeed(account, key, "home", "balanced", signal());
  await h.views.loadInitialHero(account, key, "home", "balanced", signal());
  assert.equal(h.requests.length, 1, "A mount after completed prefetch still uses its handoff");
});

test("a warm disk feed from before combined envelopes uses standalone hero and retains its session", async () => {
  const h = fixture(), warm = h.views.parseFeed(feedEnvelope("warm", "existing-session:page-three"));
  h.seed(account, key, warm);
  const hero = h.views.loadInitialHero(account, key, "home", "balanced", signal());
  await tick();
  assert.equal(h.requests.length, 1);
  assert.equal(new URL(h.requests[0].path, "https://sakura.invalid").pathname, "/api/v2/feed/hero");
  const restored = await h.views.restoreFeed(account, key);
  assert.equal(restored?.state.nextCursor, "existing-session:page-three");
  assert.equal(h.views.freshFeed(restored), true);
  h.requests[0].response.resolve(heroEnvelope(h.now(), "warm-hero"));
  assert.equal((await hero).item?.track.id, "warm-hero");
  assert.deepEqual(structuredClone(h.views.cachedFeed(account, key)), structuredClone(warm));
  assert.deepEqual(h.persisted(account, "feed", key)?.data, structuredClone(warm));
  assert.deepEqual(h.writes, [{ accountId: account, key: "recommendation-view:hero:" + key }]);
});

test("independent hero rotation preserves paginated feed ordering, sections and session cursor", async () => {
  const h = fixture(), first = h.views.loadFirstFeed(account, key, "home", "balanced", signal());
  await tick();
  h.requests[0].response.resolve({ ...feedEnvelope(), hero: heroEnvelope(h.now()) });
  const initial = (await first).feed!;
  const nextPage = h.transport.recommendationJson(account,
    "/api/v2/feed?surface=home&mode=balanced&limit=12&cursor=" + encodeURIComponent(initial.nextCursor!), signal(), { identity: key });
  await tick();
  const pageUrl = new URL(h.requests[1].path, "https://sakura.invalid");
  assert.equal(pageUrl.searchParams.get("cursor"), "session-one:page-two");
  assert.equal(pageUrl.searchParams.has("includeHero"), false);
  h.requests[1].response.resolve({ ...feedEnvelope("second", "session-one:page-three"), items: [item("first"), item("second")] });
  const page = h.views.parseFeed(await nextPage);
  const paginated = { ...page, items: appendUniqueFeedItems(initial.items, page.items), sections: initial.sections };
  h.views.saveFeed(account, key, paginated, h.cache.recommendationCacheVersion(account));
  const before = structuredClone(h.views.cachedFeed(account, key)), writeCount = h.writes.length;
  h.advance(HERO_REFRESH_MS);
  const rotating = h.views.loadHero(account, key, "home", "balanced", signal());
  await tick();
  assert.equal(new URL(h.requests[2].path, "https://sakura.invalid").pathname, "/api/v2/feed/hero");
  h.requests[2].response.resolve(heroEnvelope(h.now(), "rotated-hero"));
  assert.equal((await rotating).item?.track.id, "rotated-hero");
  assert.deepEqual(Array.from(before.items, value => value.track.id), ["first", "second"]);
  assert.equal(before.nextCursor, "session-one:page-three");
  assert.deepEqual(structuredClone(h.views.cachedFeed(account, key)), before);
  assert.deepEqual(h.persisted(account, "feed", key)?.data, before);
  assert.deepEqual(h.writes.slice(writeCount), [{ accountId: account, key: "recommendation-view:hero:" + key }]);
});

test("erasure fences a shared inflight response before it can repopulate either cache", async () => {
  const h = fixture(), oldFeed = h.views.loadFirstFeed(account, key, "home", "balanced", signal());
  const oldHero = h.views.loadInitialHero(account, key, "home", "balanced", signal());
  const rejectedFeed = assert.rejects(oldFeed, { name: "AbortError" });
  const rejectedHero = assert.rejects(oldHero, { name: "AbortError" });
  await tick();
  assert.equal(h.requests.length, 1);
  h.views.invalidateRecommendationViews(account, new Event("sakura-listening-erased"));
  h.requests[0].response.resolve({ ...feedEnvelope("erased-private-explanation"), hero: heroEnvelope(h.now(), "erased-private-hero") });
  await Promise.all([rejectedFeed, rejectedHero]);
  assert.equal(h.writes.length, 0);
  assert.equal(h.persisted(account, "feed", key), undefined);
  assert.equal(h.persisted(account, "hero", key), undefined);
  assert.equal(h.views.cachedFeed(account, key).ready, false);
  assert.equal(h.views.cachedHero(account, key).ready, false);
  assert.equal(await h.views.restoreFeed(account, key), undefined);
  assert.equal((await h.views.restoreHero(account, key)).ready, false);
  const replacement = h.views.loadFirstFeed(account, key, "home", "balanced", signal());
  await tick();
  assert.equal(h.requests.length, 2, "The erased request cannot satisfy the next version's handoff");
  h.requests[1].response.resolve({ ...feedEnvelope("current"), hero: heroEnvelope(h.now(), "current-hero") });
  assert.equal((await replacement).feed?.items[0].track.id, "current");
  assert.equal(h.views.cachedHero(account, key).item?.track.id, "current-hero");
});

test("feed and hero listeners invalidate one dispatched event only once per account", async () => {
  const h = fixture(), otherAccount = "other-account", otherKey = otherAccount + ":home:balanced:taste-one";
  const initial = [
    h.views.loadFirstFeed(account, key, "home", "balanced", signal()),
    h.views.loadFirstFeed(otherAccount, otherKey, "home", "balanced", signal()),
  ];
  await tick();
  for (const request of h.requests) request.response.resolve({ ...feedEnvelope(), hero: heroEnvelope(h.now()) });
  await Promise.all(initial);
  const event = new Event("sakura-taste-updated");
  h.views.invalidateRecommendationViews(account, event);
  const firstVersion = h.cache.recommendationCacheVersion(account);
  h.advance(100);
  h.views.invalidateRecommendationViews(account, event);
  assert.equal(h.cache.recommendationCacheVersion(account), firstVersion);
  assert.equal(h.storageWrites.length, 1);
  assert.equal(h.views.cachedFeed(account, key).ready, false);
  assert.equal(h.views.cachedHero(account, key).ready, false);
  assert.equal(h.views.cachedFeed(otherAccount, otherKey).ready, true);
  h.views.invalidateRecommendationViews(otherAccount, event);
  h.views.invalidateRecommendationViews(otherAccount, event);
  assert.equal(h.storageWrites.length, 2, "The same event fences each affected account once");
  assert.equal(h.views.cachedFeed(otherAccount, otherKey).ready, false);
  assert.equal(h.views.cachedHero(otherAccount, otherKey).ready, false);
  h.cache.clearRecommendationCache(account);
  const writes = h.storageWrites.length, version = h.cache.recommendationCacheVersion(account);
  h.views.invalidateRecommendationViews(account, new Event("sakura-recommendations-cleared"));
  assert.equal(h.storageWrites.length, writes, "An existing storage fence is not incremented again");
  assert.equal(h.cache.recommendationCacheVersion(account), version);
});

test("canceling a feed prefetch lease retains the hero consumer and its shared request", async () => {
  const h = fixture(), prefetch = new AbortController();
  const departing = h.views.loadFirstFeed(account, key, "home", "balanced", prefetch.signal);
  const visible = h.views.loadInitialHero(account, key, "home", "balanced", signal());
  const rejected = assert.rejects(departing, { name: "AbortError" });
  await tick();
  assert.equal(h.requests.length, 1);
  prefetch.abort();
  await rejected;
  assert.equal(h.requests[0].signal.aborted, false, "One remaining consumer keeps provider work alive");
  h.requests[0].response.resolve({ ...feedEnvelope(), hero: heroEnvelope(h.now(), "visible-hero") });
  assert.equal((await visible).item?.track.id, "visible-hero");
  assert.equal(h.views.cachedFeed(account, key).items[0].track.id, "first");
  await h.views.loadFirstFeed(account, key, "home", "balanced", signal());
  assert.equal(h.requests.length, 1);
});

test("a slow combined first page cannot roll back a newer independent hero rotation", async () => {
  const h = fixture(), slow = h.views.loadFirstFeed(account, key, "home", "balanced", signal());
  await tick();
  const oldTime = h.now();
  h.advance(1000);
  const rotated = h.views.loadHero(account, key, "home", "balanced", signal());
  await tick();
  assert.equal(h.requests.length, 2);
  h.requests[1].response.resolve(heroEnvelope(h.now(), "newer-hero"));
  const newer = await rotated;
  h.requests[0].response.resolve({ ...feedEnvelope(), hero: heroEnvelope(h.now(), "older-hero", oldTime) });
  const first = await slow;
  assert.equal(first.feed?.items[0].track.id, "first");
  assert.equal(first.hero, newer);
  assert.equal(h.views.cachedHero(account, key).item?.track.id, "newer-hero");
  assert.equal(h.views.cachedHero(account, key).generatedAt, newer.generatedAt);
  const savedHero = h.persisted(account, "hero", key)?.data as { item: { track: { id: string } } };
  assert.equal(savedHero.item.track.id, "newer-hero");
});
