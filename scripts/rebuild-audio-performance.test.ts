import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";
import { chromium } from "@playwright/test";
import { NextOccurrencePlanner, AutoplayRetryGate } from "../src/rebuild/app/nextOccurrence";
import { previewSourceUrls } from "../src/rebuild/app/playbackSource";
import { analyseAudio, audioWaveform, measureAudio, measuredWaveform, measureAudioAsync, encodeAudioWav } from "../src/rebuild/audio/analysis";
import { AudioAnalysisSession } from "../src/rebuild/audio/analysisSession";
import { previewWorkingBytes, MAX_PREVIEW_WORKING_BYTES, inspectAudioInput } from "../src/rebuild/audio/mediaInput";
import { musicTrack, type QueueEntry } from "../src/rebuild/app/types";

const entry = (id: number, manual = false): QueueEntry => ({ entryId: String(id), priority: manual ? "manual" : "automatic",
  track: musicTrack({ id: "deezer:" + id, title: "Song " + id, artists: ["Artist"], reference: { provider: "deezer", id: String(id) } }) });

test("prepared shuffle and transition reuse one occurrence and return updated metadata", () => {
  const planner = new NextOccurrencePlanner(), queue = Array.from({ length: 20 }, (_, index) => entry(index + 1));
  const options = { queue, currentEntryId: "1", shuffle: true, repeat: "off" as const };
  let draws = 0; const random = () => { draws++; return .99; };
  assert.equal(planner.reserve(options, random)?.entryId, "20");
  const updated = queue.map(item => item.entryId === "20" ? { ...item, track: { ...item.track, title: "Updated" } } : item);
  assert.equal(planner.reserve({ ...options, queue: updated }, random)?.track.title, "Updated"); assert.equal(draws, 1);
  const manual = entry(30, true);
  assert.equal(planner.reserve({ ...options, queue: [...updated, manual] }, random)?.entryId, "30");
  planner.clear(); assert.equal(planner.reserve(options, random)?.entryId, "20"); assert.equal(draws, 2);
});

test("repeat preparation follows the manual anchor and invalidates removed/ineligible occurrences", () => {
  const planner = new NextOccurrencePlanner(), queue = [entry(1), entry(2, true), entry(3, true), entry(4)];
  const options = { queue, currentEntryId: "1", shuffle: true, repeat: "all" as const, anchorEntryId: "1" };
  assert.equal(planner.reserve(options)?.entryId, "2");
  assert.equal(planner.reserve({ ...options, eligible: item => item.entryId !== "2" })?.entryId, "3");
  assert.equal(planner.reserve({ ...options, queue: [queue[0], queue[3]] })?.entryId, "1");
});

test("empty autoplay backoff is bounded and fresh choice/reconnect resets immediately", () => {
  let now = 0; const gate = new AutoplayRetryGate(() => now);
  gate.empty("queue"); assert.equal(gate.ready("queue"), false); now = 2000; assert.equal(gate.ready("queue"), true);
  gate.empty("queue"); now = 5999; assert.equal(gate.ready("queue"), false);
  gate.success("queue"); assert.equal(gate.ready("queue"), true);
  gate.empty("queue"); gate.clear(); assert.equal(gate.ready("queue"), true);
  for (let index = 0; index < 40; index++) gate.empty(String(index));
  assert.equal(gate.ready("0"), true); assert.equal(gate.ready("39"), false);
});

test("the exact attached Blob precedes its network fallback for preview", () => {
  const track = entry(1).track; track.audioUrl = "blob:exact-current-song";
  track.readyPlayback = { url: "https://cdn.example/file.mp3", fallbackUrl: "/exact-audio" } as typeof track.readyPlayback;
  assert.deepEqual(previewSourceUrls(track), ["blob:exact-current-song", "/exact-audio", "https://cdn.example/file.mp3"]);
});

function samples(seconds = 3, sampleRate = 48000) {
  const length = Math.round(seconds * sampleRate), channels = [new Float32Array(length), new Float32Array(length)];
  for (let channel = 0; channel < 2; channel++) for (let i = 0; i < length; i++) channels[channel][i] = .8 * Math.sin(i * .17) + .3 * Math.sin(i * .0007);
  return { length, sampleRate, numberOfChannels: 2, getChannelData: (channel: number) => channels[channel] };
}

test("one-pass measurements preserve exact loudness accumulation and gained waveform bins", () => {
  for (const buffer of [samples(.05, 8000), samples(3, 48000), samples(.5, 192000)]) {
    const measured = measureAudio(buffer);
    assert.deepEqual(measured.metrics, analyseAudio(buffer));
    for (const gain of [.01, .5, 1, 2]) assert.deepEqual(measuredWaveform(measured.peaks, gain), audioWaveform(buffer, gain));
  }
});

test("unsupported worker fallback yields to cancellation and cached original results avoid rescans", async () => {
  const buffer = samples(24), controller = new AbortController();
  const waiting = measureAudioAsync(buffer, controller.signal); setTimeout(() => controller.abort(), 0);
  await assert.rejects(waiting, error => error instanceof DOMException && error.name === "AbortError");
  const session = new AudioAnalysisSession(() => { throw new Error("No worker"); });
  try {
    const small = samples(.1), first = await session.measure(small);
    small.getChannelData = () => { assert.fail("A cached immutable buffer must not be rescanned"); };
    assert.equal(await session.measure(small), first);
  } finally { session.dispose(); }
});

test("working admission preserves eight-minute 48k stereo and rejects enormous resampled PCM", () => {
  const metadata = { durationSeconds: 480, sampleRate: 48000, numberOfChannels: 2, codec: "mp3", canDecode: true };
  assert.ok(previewWorkingBytes(metadata, 48000, 20 * 1024 * 1024) <= MAX_PREVIEW_WORKING_BYTES);
  assert.ok(previewWorkingBytes(metadata, 192000, 20 * 1024 * 1024) > MAX_PREVIEW_WORKING_BYTES);
});

test("container preflight reads actual PCM geometry and cancellation prevents inspection", async () => {
  const wav = encodeAudioWav(samples(1));
  const metadata = await inspectAudioInput(wav.buffer, new AbortController().signal);
  assert.equal(metadata.durationSeconds, 1); assert.equal(metadata.numberOfChannels, 2); assert.equal(metadata.sampleRate, 48000);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(inspectAudioInput(wav.buffer, controller.signal), error => error instanceof DOMException && error.name === "AbortError");
});

async function browserModule(path: string, dependencies: Record<string, string> = {}) {
  let code = ts.transpileModule(await readFile(path, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
  for (const [dependency, url] of Object.entries(dependencies)) code = code.replaceAll(JSON.stringify(dependency), JSON.stringify(url));
  return "data:text/javascript;base64," + Buffer.from(code).toString("base64");
}

test("first offline metadata inspection uses native audio without playback and releases canceled probes", { timeout: 60000 }, async () => {
  const metadataModule = await browserModule("src/rebuild/audio/mediaInput.ts");
  const wav = Buffer.from(encodeAudioWav(samples(.75))).toString("base64");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage();
    await page.route("http://sakura-audio-metadata.test/**", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Native audio metadata fixture</title>" }));
    await page.goto("http://sakura-audio-metadata.test/");
    await page.evaluate("globalThis.__name = fn => fn");
    const report = await page.evaluate(async ({ metadataModule, wav }) => {
      // The standalone module has no mediabunny import map: this reproduces an
      // unavailable lazy chunk while native Blob playback remains available.
      const { inspectAudioInput, inspectNativeAudioInput } = await import(metadataModule);
      const bytes = Uint8Array.from(atob(wav), byte => byte.charCodeAt(0)).buffer;
      const urls = new Set<string>(), released: HTMLMediaElement[] = [];
      const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
      URL.createObjectURL = value => { const url = create(value); urls.add(url); return url; };
      URL.revokeObjectURL = url => { urls.delete(url); revoke(url); };
      const load = HTMLMediaElement.prototype.load;
      HTMLMediaElement.prototype.load = function() { if (!this.getAttribute("src")) released.push(this); load.call(this); };
      let plays = 0;
      HTMLMediaElement.prototype.play = () => { plays++; return Promise.resolve(); };
      const metadata = await inspectAudioInput(bytes, new AbortController().signal);
      const activeAfterRead = urls.size;
      const OriginalAudio = globalThis.Audio;
      class StalledAudio extends EventTarget {
        src = ""; preload = "";
        load() {} pause() {} removeAttribute() { this.src = ""; }
      }
      globalThis.Audio = StalledAudio as unknown as typeof Audio;
      const controller = new AbortController();
      const pending = inspectNativeAudioInput(bytes, controller.signal);
      const activeBeforeAbort = urls.size;
      controller.abort();
      let canceled = false;
      try { await pending; } catch (error) { canceled = (error as DOMException).name === "AbortError"; }
      globalThis.Audio = OriginalAudio;
      return { metadata, plays, activeAfterRead, activeBeforeAbort, activeAfterAbort: urls.size,
        canceled, detached: released.length > 0 && released.every(element => !element.getAttribute("src")) };
    }, { metadataModule, wav });
    assert.equal(report.metadata.durationSeconds, .75); assert.equal(report.metadata.estimatedDimensions, true);
    assert.equal(report.plays, 0); assert.equal(report.activeAfterRead, 0); assert.equal(report.activeBeforeAbort, 1);
    assert.equal(report.activeAfterAbort, 0); assert.ok(report.canceled); assert.ok(report.detached);
  } finally { await browser.close(); }
});

test("real module-worker analysis keeps input live, preserves PCM, and terminates canceled work", { timeout: 60000 }, async () => {
  const presets = await browserModule("src/rebuild/audio/presets.ts");
  const analysis = await browserModule("src/rebuild/audio/analysis.ts", { "./presets": presets });
  const session = await browserModule("src/rebuild/audio/analysisSession.ts", { "./analysis": analysis });
  const worker = await browserModule("src/rebuild/audio/analysis.worker.ts", { "./analysis": analysis });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage();
    await page.route("http://sakura-audio-worker.test/**", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Audio worker fixture</title>" }));
    await page.goto("http://sakura-audio-worker.test/");
    await page.evaluate("globalThis.__name = fn => fn");
    const report = await page.evaluate(async urls => {
      const { AudioAnalysisSession } = await import(urls.session);
      const workerUrl = URL.createObjectURL(new Blob([`import ${JSON.stringify(urls.worker)}`], { type: "text/javascript" }));
      let terminated = 0, responses = 0;
      const session = new AudioAnalysisSession(() => { const worker = new Worker(workerUrl, { type: "module" }); worker.addEventListener("message", () => responses++); const terminate = worker.terminate.bind(worker); worker.terminate = () => { terminated++; terminate(); }; return worker; });
      const length = 24 * 48000, channels = [new Float32Array(length).fill(.1), new Float32Array(length).fill(.2)];
      const buffer = { length, sampleRate: 48000, numberOfChannels: 2, getChannelData: (channel: number) => channels[channel] };
      let inputs = 0; const interval = setInterval(() => inputs++, 10);
      try {
        const started = performance.now(), value = await session.measure(buffer);
        const elapsedMs = performance.now() - started, cached = await session.measure(buffer);
        const controller = new AbortController(); const pending = session.measure({ ...buffer }, controller.signal);
        controller.abort(); let canceled = false; try { await pending; } catch (error) { canceled = (error as DOMException).name === "AbortError"; }
        return { elapsedMs, inputs, same: value === cached, intact: channels[0].length === length && channels[0][1] > 0, canceled, terminated, responses };
      } finally { clearInterval(interval); session.dispose(); URL.revokeObjectURL(workerUrl); }
    }, { session, worker });
    assert.ok(report.inputs > 0); assert.ok(report.same); assert.ok(report.intact); assert.ok(report.canceled); assert.equal(report.terminated, 1); assert.equal(report.responses, 1);
  } finally { await browser.close(); }
});
