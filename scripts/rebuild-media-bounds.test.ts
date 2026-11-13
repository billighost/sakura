import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { createArtworkDelivery, ArtworkDeliveryError } from "../src/rebuild/player/artworkDelivery";
import { completeAudio, verifyCompleteAudio, AudioPromotions, AudioPromotionError } from "../src/rebuild/server/promotion";
import { AudioResolutionJobs } from "../src/rebuild/server/jobs";
import type { CanonicalRecording } from "../src/rebuild/core/types";
import type { RecordingRepository, StoredAudioAsset, ResolveRecordingResult } from "../src/rebuild/server/contracts";
import type { ReadonlySql } from "../src/rebuild/server/repository";
import type { RecordingIngestor } from "../src/rebuild/server/ingestion";
import type { AudioSourceDiscovery } from "../src/rebuild/server/sources";
import type { RecordingResolver } from "../src/rebuild/server/resolver";
import type { PlaybackTargets } from "../src/rebuild/server/targets";

const artwork = "https://e-cdns-images.dzcdn.net/cover.png";
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const image = () => new Response(Uint8Array.of(1, 2, 3), { headers: { "Content-Type": "image/png" } });

test("artwork burst bounds actual transfers and shares an overflow-era queued identity", async () => {
  let calls = 0, active = 0, peak = 0;
  const releases: (() => void)[] = [];
  const load = createArtworkDelivery({ maxQueued: 100, fetch: async () => {
    calls++; active++; peak = Math.max(peak, active);
    await new Promise<void>(resolve => releases.push(resolve)); active--; return image();
  } });
  const requests = Array.from({ length: 80 }, (_, index) => load(`${artwork}?fixture=${index}`));
  requests.push(load(`${artwork}?fixture=79`));
  await tick(); assert.equal(calls, 4);
  while (calls < 80 || releases.length) { releases.splice(0).forEach(release => release()); await tick(); }
  const results = await Promise.all(requests);
  assert.equal(calls, 80); assert.equal(peak, 4); assert.equal(results[79], results[80]);
});

test("artwork overflow rejects before upstream work and departing queued owners release admission", async () => {
  const gate = deferred<void>(); let calls = 0;
  const load = createArtworkDelivery({ maxConcurrent: 1, maxQueued: 1, fetch: async () => { calls++; await gate.promise; return image(); } });
  const first = load(`${artwork}?active`), controller = new AbortController();
  const abandoned = load(`${artwork}?queued`, controller.signal);
  await assert.rejects(load(`${artwork}?overflow`), error => error instanceof ArtworkDeliveryError && error.status === 503);
  controller.abort(); await assert.rejects(abandoned, { name: "AbortError" });
  const replacement = load(`${artwork}?replacement`);
  await tick(); assert.equal(calls, 1); gate.resolve();
  await Promise.all([first, replacement]); assert.equal(calls, 2);
});

test("one artwork subscriber can cancel without stopping another; last departure cancels reading", async () => {
  const gate = deferred<void>(); let upstreamSignal: AbortSignal | undefined, calls = 0;
  const load = createArtworkDelivery({ fetch: async (_url, init) => { calls++; upstreamSignal = init?.signal ?? undefined; await gate.promise; return image(); } });
  const controller = new AbortController();
  const first = load(artwork, controller.signal), second = load(artwork);
  await tick(); controller.abort(); await assert.rejects(first, { name: "AbortError" });
  assert.equal(upstreamSignal?.aborted, false); gate.resolve(); await second; assert.equal(calls, 1);

  let cancelled = false, reads = 0;
  const reading = createArtworkDelivery({ fetch: async () => { reads++; return new Response(new ReadableStream<Uint8Array>({
    start(stream) { stream.enqueue(Uint8Array.of(1)); }, cancel() { cancelled = true; },
  }), { headers: { "Content-Type": "image/png" } }); } });
  const owner = new AbortController(), request = reading(artwork, owner.signal);
  await tick(); owner.abort(); await assert.rejects(request, { name: "AbortError" });
  await tick(); assert.equal(cancelled, true); assert.equal(reads, 1);
});

test("queued artwork has a finite deadline even when the active mock ignores abort", async () => {
  const gate = deferred<void>(); let calls = 0;
  const load = createArtworkDelivery({ maxConcurrent: 1, maxQueued: 1, timeoutMs: 20, fetch: async () => { calls++; await gate.promise; return image(); } });
  const active = load(`${artwork}?active`), queued = load(`${artwork}?queued`);
  await Promise.all([assert.rejects(active, { name: "TimeoutError" }), assert.rejects(queued, { name: "TimeoutError" })]);
  assert.equal(calls, 1); gate.resolve(); await tick();
});

function audioResponse(bytes: Uint8Array, chunkBytes = 7) {
  let position = 0;
  return new Response(new ReadableStream<Uint8Array>({ pull(stream) {
    if (position === bytes.length) { stream.close(); return; }
    const end = Math.min(bytes.length, position + chunkBytes); stream.enqueue(bytes.subarray(position, end)); position = end;
  } }), { headers: { "Content-Type": "audio/mpeg" } });
}

test("source assembly and streamed CDN verification preserve every byte and exact SHA", async () => {
  const bytes = Uint8Array.from({ length: 1003 }, (_, index) => index % 251), sha = createHash("sha256").update(bytes).digest("hex");
  assert.deepEqual(await completeAudio(audioResponse(bytes), bytes.length), Buffer.from(bytes));
  await verifyCompleteAudio(audioResponse(bytes), bytes.length, sha);
  await assert.rejects(verifyCompleteAudio(audioResponse(bytes), bytes.length, "0".repeat(64)), error => error instanceof AudioPromotionError && error.reason === "integrity");
  await assert.rejects(verifyCompleteAudio(audioResponse(bytes), bytes.length + 1, sha), error => error instanceof AudioPromotionError && error.reason === "provider");
  await assert.rejects(verifyCompleteAudio(audioResponse(bytes), bytes.length - 1, sha), error => error instanceof AudioPromotionError && error.reason === "integrity");
  await assert.rejects(verifyCompleteAudio(new Response(bytes, { headers: { "Content-Type": "text/plain" } }), bytes.length, sha), error => error instanceof AudioPromotionError && error.reason === "integrity");
});

test("streamed verification cancellation releases a stalled response without publishing success", async () => {
  let cancelled = false; const owner = new AbortController();
  const response = new Response(new ReadableStream<Uint8Array>({ start(stream) { stream.enqueue(Uint8Array.of(1)); }, cancel() { cancelled = true; } }), { headers: { "Content-Type": "audio/mpeg" } });
  const pending = verifyCompleteAudio(response, 10, "a".repeat(64), owner.signal);
  owner.abort(); await assert.rejects(pending, { name: "AbortError" }); assert.equal(cancelled, true);
});

const accountId = "11111111-1111-4111-8111-111111111111", recordingId = "22222222-2222-4222-8222-222222222222", jobId = "33333333-3333-4333-8333-333333333333";
const recording: CanonicalRecording = { recordingId, references: [{ provider: "deezer", id: "1" }], metadata: { title: "Generated", artists: ["Generated artist"], durationMs: 180000 } };
const asset: StoredAudioAsset = { assetId: jobId, recordingId, candidate: { candidateId: jobId, audioKind: "full", metadata: recording.metadata }, locator: { kind: "telegram-worker", messageId: "42", chatScope: "fixturebot" }, state: "ready", verifiedAt: new Date().toISOString(), mimeType: "audio/mpeg", sizeBytes: 1000, ownerAccountId: null };

test("busy promotion failures remain capped and expire without affecting verified assets", async () => {
  const gate = deferred<Response>(); const owners = [new AbortController(), new AbortController()];
  const promotions = new AudioPromotions({ open: async () => gate.promise }, {} as RecordingIngestor);
  const active = owners.map((owner, index) => promotions.prepare(recording, { ...asset, assetId: `active-${index}`, locator: { kind: "telegram-worker", messageId: String(42 + index), chatScope: "fixturebot" } }, owner.signal));
  await Promise.all(Array.from({ length: 1500 }, async (_, index) => {
    await assert.rejects(promotions.prepare(recording, { ...asset, assetId: `busy-${index}`, locator: { kind: "telegram-worker", messageId: String(100 + index), chatScope: "fixturebot" } }), error => error instanceof AudioPromotionError && error.reason === "busy");
  }));
  assert.equal(promotions.failureReason(recordingId, "busy-0"), undefined);
  assert.equal(promotions.failureReason(recordingId, "busy-1499"), "busy");
  assert.equal(Array.from({ length: 1500 }, (_, index) => promotions.failureReason(recordingId, `busy-${index}`)).filter(Boolean).length, 1000);
  owners.forEach(owner => owner.abort()); gate.resolve(new Response("short", { headers: { "Content-Type": "audio/mpeg" } }));
  await Promise.all(active.map(pending => assert.rejects(pending, { name: "AbortError" })));
  const verified = { ...asset, sha256: "a".repeat(64) }; assert.equal(await promotions.prepare(recording, verified), verified);
});

test("compact job polls use one account-scoped SQL read and no repeated canonical projection", async () => {
  let queries = 0, projections = 0;
  const row = { id: jobId, accountId, recordingId, state: "resolving", result: null as ResolveRecordingResult | null, leaseUntil: new Date(Date.now() + 110000), attempts: 1 };
  const query: ReadonlySql = async <Row>(statement: string, parameters: readonly unknown[]) => { queries++; assert.match(statement, /account_id=\$2::uuid/); return (parameters[1] === accountId ? [row] : []) as Row[]; };
  const repository = { async findById() { projections++; return recording; } } as unknown as RecordingRepository;
  const jobs = new AudioResolutionJobs(query, repository, {} as RecordingIngestor, {} as AudioSourceDiscovery, {} as RecordingResolver);
  const compact = await jobs.getStatus(jobId, accountId);
  assert.deepEqual(compact, { status: "pending", schemaVersion: 1, jobId, recordingId, pollUrl: `/api/v2/recordings/jobs/${jobId}`, retryAfterMs: 1000 });
  assert.equal(queries, 1); assert.equal(projections, 0); assert.equal(await jobs.getStatus(jobId, "foreign-account"), null);
  const legacy = await jobs.get(jobId, accountId); assert.ok(legacy?.status === "pending" && legacy.recording === recording); assert.equal(projections, 1);
  assert.ok((await jobs.getStatus(jobId, accountId, { background: true }))?.status === "pending");
  row.leaseUntil = new Date(Date.now() + 80000);
  const background = await jobs.getStatus(jobId, accountId, { background: true }); assert.ok(background?.status === "pending" && background.retryAfterMs === 5000);
  const foreground = await jobs.getStatus(jobId, accountId); assert.ok(foreground?.status === "pending" && foreground.retryAfterMs === 1000);
});

test("compact terminal status retains full playback decoration and expired-attempt fences", async () => {
  const resolved: ResolveRecordingResult = { status: "resolved", recording, playback: { kind: "stream", assetId: asset.assetId, url: "https://fixture.invalid/audio", mimeType: asset.mimeType, sizeBytes: asset.sizeBytes, durationMs: 180000 } };
  let decoration = 0, updates = 0;
  const row = { id: jobId, accountId, recordingId, state: "ready", result: resolved as ResolveRecordingResult | null, leaseUntil: null, attempts: 1 };
  const query: ReadonlySql = async <Row>(statement: string, parameters: readonly unknown[]) => {
    if (statement.startsWith("UPDATE")) { updates++; assert.match(statement, /attempts>=2/); assert.match(statement, /lease_until<NOW\(\)/); row.result = JSON.parse(parameters[2] as string); }
    return [row] as Row[];
  };
  const targets = { async decorate(result: ResolveRecordingResult, owner: string) { decoration++; assert.equal(owner, accountId); return result; } } as PlaybackTargets;
  const jobs = new AudioResolutionJobs(query, {} as RecordingRepository, {} as RecordingIngestor, {} as AudioSourceDiscovery, {} as RecordingResolver, targets);
  assert.equal(await jobs.getStatus(jobId, accountId), resolved); assert.equal(decoration, 1);
  Object.assign(row, { state: "resolving", result: null, attempts: 2, leaseUntil: null });
  const failed = await jobs.getStatus(jobId, accountId); assert.ok(failed?.status === "unavailable" && failed.retryable); assert.equal(updates, 1);
});
