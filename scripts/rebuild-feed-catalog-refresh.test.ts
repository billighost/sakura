import assert from "node:assert/strict";
import test from "node:test";
import { parseFeedCatalogRefresh, waitForFeedCatalog } from "../src/rebuild/app/feedCatalogRefresh";

const initial = { pending: true, completedAt: null, retryAfterMs: 2000 };
const signal = () => new AbortController().signal;
const immediate = async (_delay: number, current: AbortSignal) => { current.throwIfAborted(); };
const visible = async (read: (signal: AbortSignal) => Promise<Record<string, unknown>>, current: AbortSignal) => read(current);

test("catalogue polling waits for indexed completion and bounds server hints", async () => {
  const delays: number[] = []; let reads = 0;
  const ready = await waitForFeedCatalog(initial, signal(), async () => ({ catalogRefresh: {
    pending: ++reads < 3, completedAt: reads < 3 ? null : 12345, retryAfterMs: 500_000,
  } }), async delay => { delays.push(delay); }, visible);
  assert.equal(ready, true); assert.equal(reads, 3);
  assert.deepEqual(delays, [2000, 60_000, 60_000]);
  assert.equal(parseFeedCatalogRefresh({ pending: true, retryAfterMs: -1 })?.retryAfterMs, 1000);
  assert.equal(parseFeedCatalogRefresh({ pending: true, retryAfterMs: NaN })?.retryAfterMs, 2000);
});

test("legacy/malformed status never implies catalogue completion", async () => {
  for (const raw of [{}, { catalogRefresh: { pending: "false" } }]) {
    assert.equal(await waitForFeedCatalog(initial, signal(), async () => raw, immediate, visible), false);
  }
});

test("pending catalogues and unavailable status stop after bounded reads", async () => {
  let pendingReads = 0, failures = 0;
  assert.equal(await waitForFeedCatalog(initial, signal(), async () => {
    pendingReads++; return { catalogRefresh: initial };
  }, immediate, visible), false);
  assert.equal(pendingReads, 30);
  assert.equal(await waitForFeedCatalog(initial, signal(), async () => {
    failures++; throw new Error("Unavailable");
  }, immediate, visible), false);
  assert.equal(failures, 3);
});

test("leaving a view aborts status polling before a late completion can publish", async () => {
  const controller = new AbortController(); let finish!: (raw: Record<string, unknown>) => void;
  const work = waitForFeedCatalog(initial, controller.signal, () => new Promise(resolve => { finish = resolve; }), immediate, visible);
  const rejected = assert.rejects(work, { name: "AbortError" });
  await new Promise(resolve => setImmediate(resolve));
  controller.abort(); finish({ catalogRefresh: { pending: false, completedAt: 12345 } });
  await rejected;
});
