import assert from "node:assert/strict";
import { test } from "node:test";
import { createLyricTransport, readLyricProviderJson } from "../src/rebuild/lyrics/transport";
import { SyncStartGate } from "../src/rebuild/lyrics/syncStartGate";
import { HostedSyncError } from "../src/rebuild/lyrics/hostedSync";
import { pollSyncWhenVisible, syncPollDelay, waitForSyncPoll, type SyncPollEnvironment } from "../src/rebuild/player/autoSyncPolling";

const signal = () => new AbortController().signal;
const tick = () => new Promise(resolve => setImmediate(resolve));

test("404 and rejected provider bodies are cancelled before return/retry, without waiting for a stalled cancellation", async () => {
  for (const status of [404, 400, 429, 503]) {
    let cancelled = 0, calls = 0;
    const transport = createLyricTransport({ now: () => 1000, wait: async () => {}, fetch: async () => {
      calls++;
      return new Response(new ReadableStream({ cancel: () => { cancelled++; return new Promise<void>(() => {}); } }), { status, headers: status === 429 ? { "Retry-After": "90" } : {} });
    } }, "fixture");
    const result = await transport.read("https://provider.invalid/lyrics");
    assert.equal(result.status, status === 404 ? "missing" : "unavailable");
    assert.equal(cancelled, calls);
    if (status === 429 && result.status === "unavailable") assert.equal(result.retryAfterMs, 90_000);
  }
});

test("streamed provider JSON bounds bytes and disposes malformed/oversized envelopes without truncating candidates", async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("x".repeat(40))); }, cancel() { cancelled = true; } }));
  await assert.rejects(readLyricProviderJson(response, signal(), 32), RangeError); assert.equal(cancelled, true); assert.equal(response.body?.locked, false);
  const malformed = new Response("{bad-json");
  await assert.rejects(readLyricProviderJson(malformed, signal(), 32), SyntaxError); assert.equal(malformed.body?.locked, false);
  cancelled = false;
  const lengthRejected = new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { "Content-Length": "33" } });
  await assert.rejects(readLyricProviderJson(lengthRejected, signal(), 32), RangeError); assert.equal(cancelled, true);
  const bytes = new TextEncoder().encode(JSON.stringify({ lines: ["日本語", "🎵"] }));
  const chunks = new ReadableStream<Uint8Array>({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } });
  assert.deepEqual(await readLyricProviderJson(new Response(chunks), signal()), { lines: ["日本語", "🎵"] });
});

test("aborting a stalled provider body returns promptly and releases the reader", async () => {
  let cancelled = false;
  const controller = new AbortController(), response = new Response(new ReadableStream({ cancel() { cancelled = true; } }));
  const work = readLyricProviderJson(response, controller.signal), rejected = assert.rejects(work, { name: "AbortError" });
  controller.abort(); await rejected; assert.equal(cancelled, true); assert.equal(response.body?.locked, false);
});

test("start leases suppress duplicate work, roll back failures and bound live account cooldowns without evicting them", () => {
  let now = 1000; const gate = new SyncStartGate(() => now, 2);
  const first = gate.reserve("one");
  assert.throws(() => gate.reserve("one"), error => error instanceof HostedSyncError && error.status === 429);
  first.release(); gate.reserve("one").release();
  const accepted = gate.reserve("one"); accepted.accepted(); accepted.release();
  assert.throws(() => gate.reserve("one"), error => error instanceof HostedSyncError && error.retryAfterMs === 60_000);
  const other = gate.reserve("two");
  assert.throws(() => gate.reserve("overflow"), error => error instanceof HostedSyncError && error.status === 429);
  assert.throws(() => gate.reserve("one"), HostedSyncError);
  other.release(); now += 60_000; gate.reserve("one").release(); gate.reserve("overflow").release();
});

function environment(initial = true) {
  let active = initial; const listeners = new Set<() => void>();
  const environment: SyncPollEnvironment = { active: () => active, subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; } };
  return { environment, set(value: boolean) { active = value; for (const listener of [...listeners]) listener(); }, listeners };
}

test("hidden/offline polling does no work, wakes promptly and cleans listeners on cancellation", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const f = environment(false), controller = new AbortController(); let ready = false;
  const work = waitForSyncPoll(5000, controller.signal, f.environment).then(() => { ready = true; });
  t.mock.timers.tick(20_000); await Promise.resolve(); assert.equal(ready, false);
  f.set(true); await work; assert.equal(ready, true); assert.equal(f.listeners.size, 0);
  f.set(false);
  const cancelled = waitForSyncPoll(1000, controller.signal, f.environment), rejected = assert.rejects(cancelled, { name: "AbortError" });
  controller.abort(); await rejected; assert.equal(f.listeners.size, 0);
});

test("hiding an in-flight read leaves the accepted operation alive and ignores an uncancellable late result", async () => {
  const f = environment(), operation = new AbortController(); let finish!: (value: string) => void, transportSignal: AbortSignal | undefined;
  const pending = pollSyncWhenVisible(signal => { transportSignal = signal; return new Promise(resolve => { finish = resolve; }); }, operation.signal, f.environment);
  await tick(); f.set(false); f.set(true);
  assert.equal(await pending, null); assert.equal(transportSignal?.aborted, true); assert.equal(operation.signal.aborted, false); assert.equal(f.listeners.size, 0);
  finish("obsolete result"); await tick();
  assert.equal(await pollSyncWhenVisible(async () => "completed accepted job", operation.signal, f.environment), "completed accepted job");
});

test("older servers get bounded adaptive cadence; explicit phase hints remain bounded", () => {
  assert.equal(syncPollDelay({}, 0), 2000); assert.equal(syncPollDelay({}, 20), 10_000);
  assert.equal(syncPollDelay({ phase: "queued", retryAfterMs: 5000 }, 0), 5000);
  assert.equal(syncPollDelay({ retryAfterMs: NaN }, 1), 3000);
  assert.equal(syncPollDelay({ retryAfterMs: -10 }, 0), 1000);
  assert.equal(syncPollDelay({ retryAfterMs: 1e6 }, 0), 10_000);
});
