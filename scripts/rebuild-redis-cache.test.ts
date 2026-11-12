import assert from "node:assert/strict";
import { test } from "node:test";
import { publicCatalogMetadata, SharedPublicMetadataCache, type PublicRedisTransport, type SharedPublicCacheScope } from "../src/rebuild/server/redisCache";

function fixture(options: { timeoutMs?: number; cooldownMs?: number } = {}) {
  const rows = new Map<string, string>();
  const calls = { get: 0, set: 0 };
  const clock = { now: 1_000 };
  const transport: PublicRedisTransport = {
    async get(key) { calls.get++; return rows.get(key) ?? null; },
    async set(key, value) { calls.set++; rows.set(key, value); return "OK"; },
  };
  const cache = new SharedPublicMetadataCache({ transport, now: () => clock.now, ...options });
  return { cache, transport, rows, calls, clock };
}

test("missing Redis configuration is a no-op and private scopes cannot invoke the transport", async () => {
  const empty = new SharedPublicMetadataCache();
  await empty.set("provider_deezer", "track:1", { title: "Song" }, 300);
  assert.equal(await empty.get("provider_deezer", "track:1"), undefined);
  const f = fixture();
  const unsafe = "account_session" as SharedPublicCacheScope;
  await f.cache.set(unsafe, "private", { revision: 1 }, 300);
  assert.equal(await f.cache.get(unsafe, "private"), undefined);
  assert.deepEqual(f.calls, { get: 0, set: 0 });
});

test("public metadata keys conceal raw queries and scope/namespace/value copies remain independent", async () => {
  const f = fixture();
  const query = "metadata:/search?q=A+specific+artist&limit=24";
  const value = { data: [{ title: "Song", artist: { name: "Artist" } }] };
  await f.cache.set("provider_deezer", query, value, 300);
  const key = [...f.rows.keys()][0];
  assert.match(key, /^sakura:public:v1:provider_deezer:[a-f0-9]{64}$/);
  assert.doesNotMatch(key, /specific|artist|search|limit/);
  assert.equal(await f.cache.get("provider_spotify", query), undefined);
  const first = await f.cache.get<typeof value>("provider_deezer", query);
  assert.deepEqual(first, value);
  first!.data[0].title = "Caller edit";
  assert.equal((await f.cache.get<typeof value>("provider_deezer", query))!.data[0].title, "Song");
  const separate = new SharedPublicMetadataCache({ transport: f.transport, namespace: "sakura:test:v1", now: () => f.clock.now });
  assert.equal(await separate.get("provider_deezer", query), undefined);
});

test("cache records expire and malformed, oversized or secret-bearing responses are ignored", async () => {
  const f = fixture();
  await f.cache.set("provider_deezer", "track:1", { title: "Song" }, 3);
  const key = [...f.rows.keys()][0];
  f.clock.now += 3_000;
  assert.equal(await f.cache.get("provider_deezer", "track:1"), undefined);
  for (const raw of ["not json", "null", JSON.stringify({ version: 1, expiresAt: f.clock.now + 1_000, value: { access_token: "private" } }),
    JSON.stringify({ version: 1, expiresAt: f.clock.now + 100_000_000, value: {} }), " ".repeat(300 * 1024)]) {
    f.rows.set(key, raw);
    assert.equal(await f.cache.get("provider_deezer", "track:1"), undefined);
  }
});

test("private fields/media targets never get persisted; public projection removes preview and search addresses", async () => {
  const f = fixture();
  for (const value of [{ accountId: "private" }, { access_token: "private" }, { playback: { url: "/api/audio" } },
    { preview_url: "https://preview.invalid/audio.mp3" }, { url: "https://media.invalid/a?signature=private" }]) {
    await f.cache.set("provider_deezer", "track:1", value, 300);
  }
  assert.equal(f.calls.set, 0);
  const raw = { title: "Song", artist: { name: "Artist" }, preview: "https://preview.invalid/audio.mp3",
    album: { cover: "https://image.invalid/cover.jpg" }, next: "https://api.deezer.com/search?q=Private+query&index=24",
    href: "https://api.spotify.com/v1/search?q=Private+query", total: 40 };
  const safe = publicCatalogMetadata(raw);
  assert.deepEqual(safe, { title: "Song", artist: { name: "Artist" }, album: { cover: "https://image.invalid/cover.jpg" }, next: "available", total: 40 });
  await f.cache.set("provider_deezer", "track:1", safe, 300);
  assert.equal(f.calls.set, 1);
  assert.doesNotMatch([...f.rows.values()][0], /preview|Private|audio\.mp3/);
});

test("Redis failures do not retry and subsequent work bypasses the outage until cooldown expires", async () => {
  const f = fixture({ cooldownMs: 1_000 });
  let failed = true;
  f.transport.get = async key => { f.calls.get++; if (failed) throw new Error("service unavailable"); return f.rows.get(key) ?? null; };
  assert.equal(await f.cache.get("provider_deezer", "track:1"), undefined);
  await f.cache.set("provider_deezer", "track:1", {}, 300);
  assert.equal(await f.cache.get("provider_deezer", "track:1"), undefined);
  assert.deepEqual(f.calls, { get: 1, set: 0 });
  f.clock.now += 1_001; failed = false;
  await f.cache.set("provider_deezer", "track:1", { title: "Restored" }, 300);
  assert.deepEqual(await f.cache.get("provider_deezer", "track:1"), { title: "Restored" });
});

test("an unresponsive Redis operation is aborted and a full cache queue is bypassed", { timeout: 2_000 }, async () => {
  let calls = 0;
  const signals: AbortSignal[] = [];
  const transport: PublicRedisTransport = {
    async get(_key, signal) { calls++; signals.push(signal); return new Promise<never>(() => {}); },
    async set() { throw new Error("not used"); },
  };
  const cache = new SharedPublicMetadataCache({ transport, timeoutMs: 12 });
  const active = Array.from({ length: 4 }, (_, index) => cache.get("provider_deezer", `track:${index}`));
  assert.equal(await cache.get("provider_deezer", "overflow"), undefined);
  assert.deepEqual(await Promise.all(active), [undefined, undefined, undefined, undefined]);
  assert.equal(calls, 4);
  assert.equal(signals.every(signal => signal.aborted), true);
  assert.equal(await cache.get("provider_deezer", "later"), undefined);
  assert.equal(calls, 4);
});

test("invalid TTL, cyclic payloads and oversized public metadata are not sent", async () => {
  const f = fixture();
  const cycle: Record<string, unknown> = {}; cycle.value = cycle;
  for (const ttl of [0, -1, 0.5, NaN, Infinity, 86_401]) await f.cache.set("provider_deezer", "track:1", {}, ttl);
  await f.cache.set("provider_deezer", "track:1", cycle, 300);
  await f.cache.set("provider_deezer", "track:1", { text: "x".repeat(300 * 1024) }, 300);
  assert.equal(f.calls.set, 0);
});
