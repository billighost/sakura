import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { chromium, webkit } from "@playwright/test";
import { analyseAudio, comparisonGains, audioWaveform, encodeAudioWav, type SampleBuffer } from "../src/rebuild/audio/analysis";
import { AUDIO_TECHNOLOGIES, audioTechnology } from "../src/rebuild/audio/presets";
import { configurePlaybackAudioSession, needsMediaVolumeGain } from "../src/rebuild/audio/engine";

test("background playback claims a playback audio session where supported and tolerates unavailable APIs", () => {
  const host = { audioSession: { type: "auto" } };
  assert.equal(configurePlaybackAudioSession(host), true); assert.equal(host.audioSession.type, "playback");
  assert.equal(configurePlaybackAudioSession({}), false);
  const blocked = { audioSession: { get type() { return "auto"; }, set type(_: string) { throw new Error("unsupported"); } } };
  assert.equal(configurePlaybackAudioSession(blocked), false);
});

test("Fixed media volume detection covers iPhone and desktop-mode iPad", () => {
  assert.equal(needsMediaVolumeGain({ userAgent: "iPhone", platform: "iPhone", maxTouchPoints: 5 }), true);
  assert.equal(needsMediaVolumeGain({ userAgent: "Macintosh Safari", platform: "MacIntel", maxTouchPoints: 5 }), true);
  assert.equal(needsMediaVolumeGain({ userAgent: "Macintosh Safari", platform: "MacIntel", maxTouchPoints: 0 }), false);
  assert.equal(needsMediaVolumeGain({ userAgent: "Android", platform: "Linux", maxTouchPoints: 5 }), false);
});

function tone(amplitude = 0.1, channels = 2, seconds = 3, sampleRate = 48000): SampleBuffer {
  const length = Math.round(sampleRate * seconds), data = Array.from({ length: channels }, () => Float32Array.from({ length }, (_, i) => amplitude * Math.sin(2 * Math.PI * 1000 * i / sampleRate)));
  return { length, sampleRate, numberOfChannels: channels, getChannelData: channel => data[channel] };
}
test("K-weighted integrated loudness agrees with the BS.1770 stereo 1kHz reference", () => {
  const mono = analyseAudio(tone(0.1, 1)), stereo = analyseAudio(tone());
  assert.ok(Math.abs((mono.loudnessLufs ?? 0) - (-23.0)) < 0.08);
  assert.ok(Math.abs((stereo.loudnessLufs ?? 0) - (-20.0)) < 0.08);
  assert.ok(Math.abs((stereo.loudnessLufs ?? 0) - (mono.loudnessLufs ?? 0) - 10 * Math.log10(2)) < 0.001);
  assert.ok(Math.abs((mono.crestDb ?? 0) - 3.01) < 0.02);
});
test("Absolute and relative gates reject silence, and matching never uses a louder target", () => {
  const silence = tone(0); assert.equal(analyseAudio(silence).loudnessLufs, null);
  const withQuiet = tone(0.1, 1, 6), samples = withQuiet.getChannelData(0);
  for (let i = 3 * withQuiet.sampleRate; i < samples.length; i++) samples[i] *= 0.01;
  assert.ok(Math.abs((analyseAudio(withQuiet).loudnessLufs ?? 0) - (analyseAudio(tone(0.1, 1)).loudnessLufs ?? 0)) < 0.4);
  const original = analyseAudio(tone(0.9)), enhanced = analyseAudio(tone(0.4)), gains = comparisonGains(original, enhanced);
  assert.ok(gains.originalGain > 0 && gains.originalGain <= 1 && gains.enhancedGain > 0 && gains.enhancedGain <= 1);
  assert.ok(Math.abs((original.loudnessLufs ?? 0) + 20 * Math.log10(gains.originalGain) - (enhanced.loudnessLufs ?? 0) - 20 * Math.log10(gains.enhancedGain)) < 0.00001);
  assert.ok((original.peakDbfs ?? 0) + 20 * Math.log10(gains.originalGain) <= -1 + 0.00001);
  const sparse = comparisonGains({ loudnessLufs: null, peakDbfs: 0, rmsDbfs: -80, crestDb: 80 }, { loudnessLufs: null, peakDbfs: -2, rmsDbfs: -82, crestDb: 80 });
  assert.ok(Math.abs(sparse.originalGain - 10 ** (-1 / 20)) < 0.00001); assert.equal(sparse.enhancedGain, sparse.originalGain);
});
test("Measurement rejects invalid samples and WAV/waveforms preserve channel shape", () => {
  const buffer = tone(0.1, 1, 0.001); buffer.getChannelData(0)[3] = Number.NaN; assert.throws(() => analyseAudio(buffer));
  const stereo = tone(0.5, 2, 0.01), waveform = audioWaveform(stereo, 0.5, 8), wav = encodeAudioWav(stereo, 0.5);
  assert.equal(waveform.length, 8); assert.ok(waveform.every(value => value >= 0 && value <= 0.25 + 0.00001));
  const view = new DataView(wav.buffer); assert.equal(view.getUint16(22, true), 2); assert.equal(view.getUint32(24, true), 48000); assert.equal(view.getUint32(40, true), stereo.length * 4);
  assert.equal(audioTechnology("untrusted"), "none"); assert.equal(AUDIO_TECHNOLOGIES.length, 6);
});

async function browserModule(file: string, dependencies: Record<string, string> = {}): Promise<string> {
  let code = ts.transpileModule(await readFile(file, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 } }).outputText;
  for (const [name, url] of Object.entries(dependencies)) code = code.replaceAll(`"${name}"`, JSON.stringify(url));
  return "data:text/javascript;base64," + Buffer.from(code).toString("base64");
}
for (const browserName of ["Chrome", "WebKit"]) test(`${browserName} background recovery preserves native media and explicit pause`, { timeout: 60000 }, async t => {
  const presets = await browserModule("src/rebuild/audio/presets.ts"), engine = await browserModule("src/rebuild/audio/engine.ts", { "./presets": presets });
  const wav = Buffer.from(encodeAudioWav(tone(0.1, 1, 8))).toString("base64");
  const browser = browserName === "WebKit" ? await webkit.launch({ headless: true }) : await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage(); await page.evaluate("globalThis.__name = (fn) => fn");
    if (!await page.evaluate(() => typeof AudioContext === "function")) { t.skip("This Windows WebKit runtime has no Web Audio support; iPhone background audio needs device verification."); return; }
    const result = await page.evaluate(async ({ engine, wav }) => {
      const { MediaAudioEngine } = await import(engine);
      const session = { type: "auto" }; Object.defineProperty(navigator, "audioSession", { value: session, configurable: true });
      const media = new Audio("data:audio/wav;base64," + wav); media.loop = true;
      const supportsGraph = typeof AudioContext === "function";
      const controller = new MediaAudioEngine(media, { requiresVolumeGraph: supportsGraph }); await controller.setMode("none"); await media.play();
      const context = controller.context as AudioContext | null, source = media.src;
      await new Promise(resolve => setTimeout(resolve, 250)); const before = media.currentTime;
      if (context) await context.suspend();
      else { document.dispatchEvent(new Event("visibilitychange")); window.dispatchEvent(new Event("pageshow")); }
      const deadline = performance.now() + 3000;
      while (context && context.state !== "running" && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
      const recovered = context?.state ?? "native"; await new Promise(resolve => setTimeout(resolve, 100)); const progressed = media.currentTime > before;
      media.pause(); if (context) await context.suspend(); document.dispatchEvent(new Event("visibilitychange")); window.dispatchEvent(new Event("pageshow"));
      await new Promise(resolve => setTimeout(resolve, 100)); const stayedPaused = media.paused && (!context || context.state === "suspended");
      controller.dispose();
      return { type: session.type, recovered, progressed, stayedPaused, sameSource: source === media.src };
    }, { engine, wav });
    assert.ok(["running", "native"].includes(result.recovered));
    assert.deepEqual({ ...result, recovered: "checked" }, { type: "playback", recovered: "checked", progressed: true, stayedPaused: true, sameSource: true });
  } finally { await browser.close(); }
});
test("iPhone fixed element volume still produces the saved level, mute and dry bypass", { timeout: 60000 }, async () => {
  const presets = await browserModule("src/rebuild/audio/presets.ts"), engine = await browserModule("src/rebuild/audio/engine.ts", { "./presets": presets });
  const wav = Buffer.from(encodeAudioWav(tone(0.1, 1, 8))).toString("base64");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage(); await page.evaluate("globalThis.__name = (fn) => fn");
    const result = await page.evaluate(async ({ engine, wav }) => {
      const { MediaAudioEngine } = await import(engine);
      const media = new Audio("data:audio/wav;base64," + wav); media.loop = true;
      Object.defineProperty(media, "volume", { get: () => 1, set: () => {} });
      const controller = new MediaAudioEngine(media, { requiresVolumeGraph: true });
      controller.setVolume(0.3); const beforeGesture = controller.initialized;
      await controller.setMode("none"); const source = controller.source;
      const live: AudioContext = controller.context, meter = live.createAnalyser(); meter.fftSize = 2048;
      controller.master.connect(meter); await media.play();
      const rms = () => { const data = new Float32Array(meter.fftSize); meter.getFloatTimeDomainData(data); return Math.sqrt(data.reduce((sum, x) => sum + x * x, 0) / data.length); };
      const deadline = performance.now() + 5000;
      while ((media.currentTime < 0.6 || rms() < 0.001) && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 30));
      const saved = rms(); controller.setVolume(1); await new Promise(resolve => setTimeout(resolve, 200)); const full = rms();
      controller.setVolume(0); await new Promise(resolve => setTimeout(resolve, 120)); const muted = rms();
      controller.setVolume(0.3); await controller.setMode("night"); await new Promise(resolve => setTimeout(resolve, 150)); const enhanced = rms();
      await controller.setMode("none"); await new Promise(resolve => setTimeout(resolve, 150)); const restored = rms(), sameSource = controller.source === source, branches = controller.branches.size;
      await live.suspend(); await controller.setMode("none"); const resumed = live.state;
      media.pause(); controller.dispose();
      const direct = new MediaAudioEngine(new Audio(), { requiresVolumeGraph: false }); await direct.setMode("none"); const desktopDirect = !direct.initialized; direct.dispose();
      const incompatible = new MediaAudioEngine(new Audio("https://example.invalid/no-cors.mp3"), { requiresVolumeGraph: true });
      let rejectedUnsafe = false; try { await incompatible.setMode("none"); } catch { rejectedUnsafe = !incompatible.initialized; } incompatible.dispose();
      return { beforeGesture, elementVolume: media.volume, savedRatio: saved / full, restoredRatio: restored / full, muted, enhanced, sameSource, branches, resumed, desktopDirect, rejectedUnsafe };
    }, { engine, wav });
    assert.equal(result.beforeGesture, false); assert.equal(result.elementVolume, 1);
    assert.ok(Math.abs(result.savedRatio - 0.3) < 0.015, JSON.stringify(result));
    assert.ok(Math.abs(result.restoredRatio - 0.3) < 0.015, JSON.stringify(result));
    assert.ok(result.muted < 0.000001); assert.ok(result.enhanced > 0.001);
    assert.equal(result.sameSource, true); assert.equal(result.branches, 1); assert.equal(result.resumed, "running");
    assert.equal(result.desktopDirect, true); assert.equal(result.rejectedUnsafe, true);
  } finally { await browser.close(); }
});
test("Actual browser renders preserve None, safe peaks, crossfeed mono and comparison timing", { timeout: 60000 }, async () => {
  const presets = await browserModule("src/rebuild/audio/presets.ts"), engine = await browserModule("src/rebuild/audio/engine.ts", { "./presets": presets }), analysis = await browserModule("src/rebuild/audio/analysis.ts", { "./presets": presets }), preview = await browserModule("src/rebuild/audio/preview.ts", { "./presets": presets, "./engine": engine, "./analysis": analysis });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage();
    // tsx preserves function names with this helper; evaluated callbacks run
    // outside the Node bundle where that helper otherwise lives.
    await page.evaluate("globalThis.__name = (fn) => fn");
    const report = await page.evaluate(async urls => {
      const { createAudioGraph, renderAudio, MediaAudioEngine } = await import(urls.engine);
      const { prepareComparison } = await import(urls.preview);
      const { analyseAudio, encodeAudioWav } = await import(urls.analysis);
      const modes = ["none", "clarity", "warmth", "punch", "night", "headphones"];
      const context = new OfflineAudioContext(2, 48000 * 2, 48000), input = context.createBuffer(2, 48000 * 2, 48000);
      for (let channel = 0; channel < 2; channel++) { const data = input.getChannelData(channel); for (let i = 0; i < data.length; i++) data[i] = 0.35 * Math.sin(2 * Math.PI * 1000 * i / 48000) + 0.15 * Math.sin(2 * Math.PI * 90 * i / 48000); }
      const source = context.createBufferSource(); source.buffer = input; const graph = createAudioGraph(context, source, "none"); graph.output.connect(context.destination); source.start(); const dry = await context.startRendering(); graph.dispose();
      let dryError = 0; for (let channel = 0; channel < 2; channel++) for (let i = 0; i < input.length; i++) dryError = Math.max(dryError, Math.abs(input.getChannelData(channel)[i] - dry.getChannelData(channel)[i]));
      const comparisons = [];
      for (const mode of modes) {
        const comparison = await prepareComparison(input, mode);
        const delta = comparison.originalMetrics.loudnessLufs + 20 * Math.log10(comparison.originalGain) - comparison.enhancedMetrics.loudnessLufs - 20 * Math.log10(comparison.enhancedGain);
        let peak = 0, finite = true; for (let channel = 0; channel < 2; channel++) for (const sample of comparison.enhanced.getChannelData(channel)) { finite &&= Number.isFinite(sample); peak = Math.max(peak, Math.abs(sample)); }
        comparisons.push({ mode, delta, peak, finite, length: comparison.enhanced.length });
      }
      // Mono crossfeed is an exact center-preserving matrix aside from preamp.
      const mono = context.createBuffer(1, input.length, 48000); mono.copyToChannel(input.getChannelData(0), 0);
      const headphone = await renderAudio(mono, "headphones"); let monoError = 0;
      const preamp = 10 ** (-2 / 20); for (let i = 0; i < mono.length; i++) monoError = Math.max(monoError, Math.abs(headphone.getChannelData(0)[i] - mono.getChannelData(0)[i] * preamp));
      // A low-level impulse sees delay but no compression; trimming must keep its frame.
      const impulse = context.createBuffer(1, 4800, 48000); impulse.getChannelData(0)[200] = 0.001;
      const aligned = await renderAudio(impulse, "night"); const peakAt = aligned.getChannelData(0).reduce((best: number, value: number, index: number, data: Float32Array) => Math.abs(value) > Math.abs(data[best]) ? index : best, 0);
      // Real crossfeed transfers bass from a hard-panned channel; high-frequency transfer is much smaller.
      async function crossLevel(hz: number) { const one = context.createBuffer(2, 48000, 48000); const data = one.getChannelData(0); for (let i = 0; i < data.length; i++) data[i] = 0.1 * Math.sin(2 * Math.PI * hz * i / 48000); const processed = await renderAudio(one, "headphones"); const right = processed.getChannelData(1); let sum = 0; for (let i = 4800; i < right.length; i++) sum += right[i] ** 2; return Math.sqrt(sum / (right.length - 4800)); }
      const bassTransfer = await crossLevel(100), trebleTransfer = await crossLevel(6000);
      const abort = new AbortController(); abort.abort(); let cancelled = false; try { await prepareComparison(input, "warmth", { signal: abort.signal }); } catch (error) { cancelled = (error as DOMException).name === "AbortError"; }
      const hot = context.createBuffer(2, 48000, 48000); for (let channel = 0; channel < 2; channel++) hot.getChannelData(channel).fill(1); const safe = await renderAudio(hot, "punch"); const safePeak = analyseAudio(safe).peakDbfs;
      // The controller keeps listening volume after DSP, independent of compression.
      const wav = encodeAudioWav(mono); let binary = ""; for (const byte of wav) binary += String.fromCharCode(byte);
      const media = new Audio("data:audio/wav;base64," + btoa(binary)); media.loop = true;
      const controller = new MediaAudioEngine(media); await controller.setMode("night");
      const live: AudioContext = controller.context, outputMeter = live.createAnalyser(), inputMeter = live.createAnalyser(); outputMeter.fftSize = inputMeter.fftSize = 2048;
      controller.master.connect(outputMeter); controller.source.connect(inputMeter); await media.play();
      const rms = (meter: AnalyserNode) => { const data = new Float32Array(2048); meter.getFloatTimeDomainData(data); return Math.sqrt(data.reduce((sum, value) => sum + value * value, 0) / data.length); };
      const deadline = performance.now() + 5000; let loud = rms(outputMeter);
      while ((loud < 0.01 || media.currentTime < 0.6) && performance.now() < deadline) { await new Promise(resolve => setTimeout(resolve, 30)); loud = rms(outputMeter); }
      await new Promise(resolve => setTimeout(resolve, 150)); loud = rms(outputMeter); const inputLoud = rms(inputMeter); controller.setVolume(0.25);
      await new Promise(resolve => setTimeout(resolve, 200)); const quiet = rms(outputMeter), inputQuiet = rms(inputMeter);
      for (const mode of modes) await controller.setMode(mode);
      await new Promise(resolve => setTimeout(resolve, 150)); const branchesAfterSwitch = controller.branches.size;
      controller.setVolume(0); await new Promise(resolve => setTimeout(resolve, 100)); const mutedRms = rms(outputMeter); media.pause(); controller.dispose();
      return { dryError, comparisons, monoError, peakAt, bassTransfer, trebleTransfer, cancelled, safePeak, mediaVolumeRatio: quiet / loud, inputVolumeRatio: inputQuiet / inputLoud, branchesAfterSwitch, mutedRms, mediaDiagnostic: { loud, quiet, currentTime: media.currentTime, readyState: media.readyState, contextState: live.state } };
    }, { engine, preview, analysis });
    assert.equal(report.dryError, 0);
    for (const comparison of report.comparisons) { assert.ok(comparison.finite); assert.equal(comparison.length, 96000); assert.ok(Math.abs(comparison.delta) < 0.00001); assert.ok(comparison.peak < 0.95); }
    assert.ok(report.monoError < 0.000001); assert.ok(Math.abs(report.peakAt - 200) <= 1); assert.ok(report.bassTransfer > report.trebleTransfer * 20); assert.ok(report.cancelled); assert.ok((report.safePeak ?? 0) < 0);
    assert.ok(Math.abs(report.mediaVolumeRatio - 0.25) < 0.015, `Media volume ratio was ${report.mediaVolumeRatio}: ${JSON.stringify(report.mediaDiagnostic)}`);
    assert.ok(Math.abs(report.inputVolumeRatio - 1) < 0.02); assert.equal(report.branchesAfterSwitch, 1); assert.ok(report.mutedRms < 0.000001);
  } finally { await browser.close(); }
});
