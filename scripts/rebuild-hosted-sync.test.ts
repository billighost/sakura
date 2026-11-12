import assert from "node:assert/strict";
import test from "node:test";
import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { createHostedSync, HostedSyncError, verifiedSyncAudio, type VerifiedSyncAudio } from "../src/rebuild/lyrics/hostedSync";
import { canAutoSync } from "../src/rebuild/lyrics/autoSync";
import { LyricAlignmentError, WHISPER_SYNC_ENGINE } from "../src/rebuild/lyrics/whisperSync";
import { ProductError, uuid } from "../src/rebuild/data/validation";
import type { TimedLyric } from "../src/rebuild/lyrics/parse";
import { recordingLyricIdentity } from "../src/rebuild/lyrics/recordingIdentity";

const secret = "test-only-hosted-sync-signing-key-32-bytes";
const accountId = "11111111-1111-4111-8111-111111111111";
const recordingId = "22222222-2222-4222-8222-222222222222";
const audioSha256 = "a".repeat(64);
const workerUrl = "https://test-only-sakura.hf.space";
const audio: VerifiedSyncAudio = {
  recordingId, audioSha256, sizeBytes: 100_000, durationSeconds: 30,
  audioUrl: `https://res.cloudinary.com/test/video/upload/v1/sakura/v2/audio/${recordingId}/${audioSha256}.mp3`,
};
const source: TimedLyric[] = [{ text: "Hello, world!", start: 0 }, { text: "We are here.", start: 0 }];
const result = {
  recordingId, audioSha256, durationSeconds: 30, engine: WHISPER_SYNC_ENGINE, elapsedMs: 1278,
  words: [
    { text: "Hello", start: 2, end: 2.5, probability: .99 }, { text: "world", start: 2.6, end: 3, probability: .98 },
    { text: "We", start: 7, end: 7.2, probability: .99 }, { text: "are", start: 7.3, end: 7.5, probability: .98 },
    { text: "here", start: 7.6, end: 8, probability: .99 },
  ],
};
const frame = (value: unknown = result) => `event: complete\ndata: ${JSON.stringify([value])}\n\n`;
type Call = { url: string; init?: RequestInit };

function streamedResponse(chunks: (string | Uint8Array)[]) {
  let index = 0, cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index === chunks.length) { controller.close(); return; }
      const next = chunks[index++];
      controller.enqueue(typeof next === "string" ? new TextEncoder().encode(next) : next);
    },
    cancel() { cancelled = true; },
  });
  return { response: new Response(stream, { headers: { "Content-Type": "text/event-stream" } }), cancelled: () => cancelled };
}

function fixture(chunks: (string | Uint8Array)[] = [frame()], lines = source) {
  const calls: Call[] = [], stream = streamedResponse(chunks);
  let currentTime = 1_800_000_000_000;
  const worker = createHostedSync({ url: workerUrl, secret, now: () => currentTime, fetch: async (url, init) => {
    calls.push({ url: String(url), init });
    return init?.method === "POST" ? Response.json({ event_id: "test_event-1" }) : stream.response;
  } });
  return { worker, calls, stream, lines, setTime: (value: number) => { currentTime = value; }, getTime: () => currentTime };
}

function isHosted(status: number) {
  return (error: unknown) => error instanceof HostedSyncError && error.status === status;
}

test("hosted start signs only verified audio metadata and returns an account-bound resumable token", async () => {
  const f = fixture();
  const pending = await f.worker.start(accountId, audio, source);
  assert.equal(pending.status, "pending");
  assert.equal(f.calls.length, 1);
  const call = f.calls[0];
  assert.equal(call.url, workerUrl + "/gradio_api/call/transcribe");
  assert.equal(call.init?.redirect, "error");
  assert.equal(call.init?.cache, "no-store");
  const { data } = JSON.parse(call.init!.body as string) as { data: [string, string] };
  assert.equal(data[1], createHmac("sha256", secret).update(data[0]).digest("hex"));
  const submitted = JSON.parse(data[0]);
  for (const key of ["recordingId", "audioUrl", "audioSha256", "sizeBytes", "durationSeconds"] as const) assert.equal(submitted[key], audio[key]);
  assert.equal(submitted.expiresAt, f.getTime() + 300_000);
  assert.match(submitted.nonce, /^[A-Za-z0-9_-]{32}$/);
  assert.equal(submitted.lines, undefined);
  assert.equal(submitted.accountId, undefined);
  const [encoded, signature] = pending.jobToken.split(".");
  assert.equal(signature, createHmac("sha256", secret).update("sakura-lyrics-token-v1:" + encoded).digest("hex"));
  const job = JSON.parse(Buffer.from(encoded, "base64url").toString());
  assert.equal(job.accountId, accountId);
  assert.deepEqual(job.lines, source);
  assert.equal(job.eventId, "test_event-1");
});

test("complete SSE results preserve provider punctuation and attach recording/content evidence", async () => {
  const f = fixture(["event: heartbeat\ndata: null\n\n", frame(), "event: heartbeat\n\n"]);
  const { jobToken } = await f.worker.start(accountId, audio, source);
  const complete = await f.worker.poll(accountId, jobToken);
  assert.equal(complete.status, "complete");
  if (complete.status !== "complete") return;
  assert.deepEqual(complete.lines.map(line => line.text), source.map(line => line.text));
  assert.deepEqual(complete.lines.map(line => line.start), [2, 7]);
  assert.deepEqual(complete.lines.map(line => line.end), [3, 8]);
  assert.equal(complete.lines[0].words!.map(word => word.text).join(""), source[0].text);
  assert.equal(complete.evidence.audioSha256, audioSha256);
  assert.equal(complete.evidence.engine, WHISPER_SYNC_ENGINE);
  assert.equal(complete.evidence.elapsedMs, result.elapsedMs);
  assert.equal(complete.evidence.sourceContentKey, createHash("sha256").update(JSON.stringify(source.map(line => line.text))).digest("hex"));
  assert.ok(complete.evidence.confidence > .98);
  assert.equal(f.calls[1].url, workerUrl + "/gradio_api/call/transcribe/test_event-1");
  assert.equal(f.calls[1].init?.redirect, "error");
  assert.equal(f.stream.cancelled(), true);
});

test("account changes, expired jobs and modified payload/signature tokens never contact the worker", async () => {
  const f = fixture();
  const { jobToken } = await f.worker.start(accountId, audio, source);
  const [encoded, signature] = jobToken.split(".");
  const changed = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(encoded, "base64url").toString()), audioSha256: "b".repeat(64) })).toString("base64url");
  await assert.rejects(f.worker.poll("another-account", jobToken), isHosted(403));
  for (const token of [`${changed}.${signature}`, `${encoded}.${"0".repeat(64)}`, `${jobToken}.extra`, null, "x".repeat(70_001)]) {
    await assert.rejects(f.worker.poll(accountId, token), isHosted(400));
  }
  f.setTime(f.getTime() + 15 * 60_000);
  await assert.rejects(f.worker.poll(accountId, jobToken), isHosted(410));
  assert.equal(f.calls.length, 1);
});

test("only immutable public CDN paths for the exact recording SHA can enter signed jobs", () => {
  assert.equal(verifiedSyncAudio(audio), audio);
  const invalid = [
    audio.audioUrl.replace("https:", "http:"), audio.audioUrl.replace("res.cloudinary.com", "127.0.0.1"),
    audio.audioUrl.replace("res.cloudinary.com", "res.cloudinary.com.attacker.invalid"),
    audio.audioUrl.replace("res.cloudinary.com", "user:password@res.cloudinary.com"), audio.audioUrl + "?token=private", audio.audioUrl + "#fragment",
    audio.audioUrl.replace(audioSha256, "b".repeat(64)), audio.audioUrl.replace(recordingId, accountId),
    audio.audioUrl.replace(".mp3", ".mp3/another.mp3"), audio.audioUrl.replace(".mp3", ".mp3.exe"),
  ];
  for (const audioUrl of invalid) assert.throws(() => verifiedSyncAudio({ ...audio, audioUrl }), isHosted(409), audioUrl);
  for (const patch of [{ sizeBytes: 0 }, { sizeBytes: 30 * 1024 * 1024 + 1 }, { sizeBytes: 1.5 }, { durationSeconds: 601 }, { durationSeconds: Infinity }, { audioSha256: "preview" }]) {
    assert.throws(() => verifiedSyncAudio({ ...audio, ...patch }), isHosted(409));
  }
});

test("untrusted worker locations, weak keys and invalid worker event IDs are refused", async () => {
  for (const url of ["http://test.hf.space", "https://test.hf.space.attacker.invalid", "https://127.0.0.1", workerUrl + "?token=x", "https://u:p@test.hf.space"]) {
    assert.throws(() => createHostedSync({ url, secret }), HostedSyncError);
  }
  assert.throws(() => createHostedSync({ url: workerUrl, secret: "weak" }), HostedSyncError);
  for (const event_id of [undefined, "../other", "event?token=x", "x".repeat(101)]) {
    const worker = createHostedSync({ url: workerUrl, secret, fetch: async () => Response.json({ event_id }) });
    await assert.rejects(worker.start(accountId, audio, source), /job identity/);
  }
});

test("unsupported lyrics stop before a job or audio transfer is requested", async () => {
  const f = fixture();
  for (const lines of [[], [{ text: "你好", start: 0 }], [{ text: "안녕하세요", start: 0 }], [{ text: "hello ".repeat(2000), start: 0 }]]) {
    await assert.rejects(f.worker.start(accountId, audio, lines), isHosted(422));
  }
  assert.equal(f.calls.length, 0);
});

test("mismatched checksums, recordings, durations or engines cannot produce synchronized lyrics", async () => {
  const invalid = [
    { audioSha256: "b".repeat(64) }, { recordingId: accountId }, { durationSeconds: 32 }, { durationSeconds: null },
    { engine: "unverified-model" }, { elapsedMs: -1 }, { words: [{ text: 42, start: 2, end: 3 }] },
  ];
  for (const patch of invalid) {
    const f = fixture([frame({ ...result, ...patch })]);
    const { jobToken } = await f.worker.start(accountId, audio, source);
    await assert.rejects(f.worker.poll(accountId, jobToken), /did not match this verified recording/);
  }
});

test("poor alignment and invalid word times retain the original plain source without fabricated timing", async () => {
  const snapshot = structuredClone(source);
  for (const words of [[], result.words.slice(1), result.words.map(word => ({ ...word, probability: .1 })), [{ text: "Hello", start: 5, end: 4 }]]) {
    const f = fixture([frame({ ...result, words })]);
    const { jobToken } = await f.worker.start(accountId, audio, source);
    await assert.rejects(f.worker.poll(accountId, jobToken), LyricAlignmentError);
    assert.deepEqual(source, snapshot);
    assert.ok(source.every(line => line.start === 0 && line.end === undefined));
  }
});

test("LF event fields and JSON survive arbitrary byte chunks including multibyte source text", async () => {
  const accented = [{ text: "Café world!", start: 0 }];
  const completed = { ...result, words: [{ text: "Café", start: 2, end: 2.5, probability: .99 }, result.words[1]] };
  const bytes = new TextEncoder().encode("event: heartbeat\ndata: null\n\n" + frame(completed));
  const f = fixture([...bytes].map(value => Uint8Array.of(value)), accented);
  const { jobToken } = await f.worker.start(accountId, audio, accented);
  const answer = await f.worker.poll(accountId, jobToken);
  assert.equal(answer.status, "complete");
  if (answer.status === "complete") assert.equal(answer.lines[0].text, accented[0].text);
});

test("CRLF SSE boundaries split between chunks still dispatch complete", async () => {
  const bytes = new TextEncoder().encode(frame().replace(/\n/g, "\r\n"));
  const f = fixture([...bytes].map(value => Uint8Array.of(value)));
  const { jobToken } = await f.worker.start(accountId, audio, source);
  assert.equal((await f.worker.poll(accountId, jobToken)).status, "complete");
});

test("multiline SSE data and heartbeat-only streams handle completed and pending jobs", async () => {
  const multiline = JSON.stringify([result], null, 2).split("\n").map(line => "data: " + line).join("\n");
  const f = fixture([`: keepalive\n\nevent: heartbeat\ndata: null\n\nevent: complete\n${multiline}\n\n`]);
  const { jobToken } = await f.worker.start(accountId, audio, source);
  assert.equal((await f.worker.poll(accountId, jobToken)).status, "complete");
  const idle = fixture(["event: heartbeat\ndata: null\n\n"]);
  const pending = await idle.worker.start(accountId, audio, source);
  assert.deepEqual(await idle.worker.poll(accountId, pending.jobToken), { status: "pending" });
});

test("worker failures, malformed SSE and oversized streams return honest failures", async () => {
  for (const chunks of [["event: error\ndata: private-worker-trace\n\n"], ["event: complete\ndata: {bad-json}\n\n"], ["x".repeat(1_000_001)]]) {
    const f = fixture(chunks);
    const { jobToken } = await f.worker.start(accountId, audio, source);
    await assert.rejects(f.worker.poll(accountId, jobToken), error => error instanceof HostedSyncError && !error.message.includes("private-worker-trace"));
  }
  const worker = createHostedSync({ url: workerUrl, secret, fetch: async () => new Response(null, { status: 503 }) });
  await assert.rejects(worker.start(accountId, audio, source), /asleep, busy|quota/);
});

type RouteFixtureOptions = { account?: { id: string } | null; track?: Record<string, unknown> | null; plain?: string; instrumental?: boolean; pollError?: Error };
function routeFixture(options: RouteFixtureOptions = {}) {
  const calls: { kind: string; args: unknown[] }[] = [];
  const defaultTrack = { title: "Song", artists: ["Artist"], albumTitle: "Album", durationMs: 30_000, metadata: { language: "en" }, readyPlayback: { url: audio.audioUrl, sha256: audioSha256, sizeBytes: audio.sizeBytes, durationMs: 30_000 } };
  const exports: { POST?: (request: Request) => Promise<Response> } = {};
  const compiled = ts.transpileModule(readFileSync("src/app/api/v2/lyrics/sync/route.ts", "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const dependency = (name: string) => {
    if (name === "@/rebuild/server/performance") return { withApiTiming: async (_route: string, _request: Request, operation: () => Promise<Response>) => operation() };
    if (name === "next/server") return { NextResponse: { json: Response.json } };
    if (name === "@/rebuild/auth") return { requireRebuildAccount: async () => options.account === undefined ? { id: accountId } : options.account };
    if (name === "@/rebuild/data/catalog") return { cardsForIds: async (...args: unknown[]) => { calls.push({ kind: "cards", args }); return options.track === null ? [] : [options.track || defaultTrack]; } };
    if (name === "@/rebuild/data/validation") return { ProductError, uuid };
    if (name === "@/rebuild/lyrics/autoSync") return { canAutoSync };
    if (name === "@/rebuild/lyrics/recordingIdentity") return { recordingLyricIdentity };
    if (name === "@/rebuild/lyrics/whisperSync") return { LyricAlignmentError };
    if (name === "@/rebuild/lyrics/service") return { resolveVerifiedLyrics: async (...args: unknown[]) => { calls.push({ kind: "lyrics", args }); return { status: "matched", track: { plainLyrics: options.plain ?? source.map(line => line.text).join("\n"), instrumental: options.instrumental || false } }; } };
    if (name === "@/rebuild/lyrics/hostedSync") return { HostedSyncError, createHostedSync: () => ({
      start: async (...args: unknown[]) => { verifiedSyncAudio(args[1] as VerifiedSyncAudio); calls.push({ kind: "start", args }); return { status: "pending", jobToken: "server-signed-job" }; },
      poll: async (...args: unknown[]) => { calls.push({ kind: "poll", args }); if (options.pollError) throw options.pollError; return { status: "pending" }; },
    }) };
    throw new Error("Unexpected sync route dependency: " + name);
  };
  new Function("require", "module", "exports", compiled)(dependency, { exports }, exports);
  return { calls, handle: exports.POST!, post: (body: unknown) => exports.POST!(new Request("http://localhost/api/v2/lyrics/sync", { method: "POST", body: JSON.stringify(body) })) };
}

test("sync route authenticates before reading input, canonical audio or lyrics", async () => {
  const f = routeFixture({ account: null });
  let bodyReads = 0;
  const request = new Request("http://localhost/api/v2/lyrics/sync", { method: "POST", body: "invalid JSON" });
  request.text = async () => { bodyReads++; throw new Error("Unauthenticated input must not be read"); };
  const response = await f.handle(request);
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.deepEqual(f.calls, []);
  assert.equal(bodyReads, 0);
});

test("sync route ignores caller audio locations and signs only account-scoped canonical full audio", async () => {
  const f = routeFixture();
  const response = await f.post({ recordingId, lines: source, audioUrl: "http://127.0.0.1/private", audioSha256: "forged", durationSeconds: 1 });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.deepEqual(f.calls.find(call => call.kind === "cards")!.args, [accountId, [recordingId]]);
  assert.deepEqual(f.calls.find(call => call.kind === "start")!.args.slice(0, 3), [accountId, audio, source]);
  const lookup = f.calls.find(call => call.kind === "lyrics")!;
  assert.equal(lookup.args[1], true);
});

test("sync route rejects missing audio, changed or instrumental lyrics and prefilled timings", async () => {
  for (const options of [{ track: null }, { plain: "Different words" }, { instrumental: true }]) {
    const f = routeFixture(options);
    assert.equal((await f.post({ recordingId, lines: source })).status, 409);
    assert.ok(!f.calls.some(call => call.kind === "start"));
  }
  const f = routeFixture();
  assert.equal((await f.post({ recordingId, lines: [{ text: "Hello", start: 2 }] })).status, 400);
  assert.ok(!f.calls.some(call => call.kind === "cards"));
});

test("sync route polls in the current account without catalogue/acquisition work and reports poor alignment as422", async () => {
  const f = routeFixture({ pollError: new LyricAlignmentError("Original plain lyrics kept.") });
  const response = await f.post({ jobToken: "opaque-signed-token" });
  assert.equal(response.status, 422);
  assert.deepEqual(f.calls.map(call => call.kind), ["poll"]);
  assert.equal(f.calls[0].args[0], accountId);
  assert.match((await response.json()).error, /plain lyrics kept/);
});
