/** Real browser exporter checks; synthetic audio stays in the browser, never the catalog. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import { chromium } from "@playwright/test";
import { createServer } from "node:http";

const benchmark = process.argv.includes("--benchmark");

/** Compare the current renderer with/without reusable inputs; this is not a
 * benchmark of an older implementation or of remote media transfer. */
async function benchmarkClips(page) {
  const results = [];
  for (const seconds of [5, 8, 12]) {
    const result = await page.evaluate(async ({ seconds, preparedFirst }) => {
      const rate = 22050, count = rate * 15, bytes = new ArrayBuffer(44 + count * 2), view = new DataView(bytes);
      const ascii = (offset, text) => [...text].forEach((letter, index) => view.setUint8(offset + index, letter.charCodeAt(0)));
      ascii(0, "RIFF"); view.setUint32(4, 36 + count * 2, true); ascii(8, "WAVE"); ascii(12, "fmt "); view.setUint32(16, 16, true);
      view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true);
      view.setUint16(32, 2, true); view.setUint16(34, 16, true); ascii(36, "data"); view.setUint32(40, count * 2, true);
      for (let sample = 0; sample < count; sample++) view.setInt16(44 + sample * 2, Math.sin(sample / rate * (sample < rate * .2 ? 220 : 880) * Math.PI * 2) * 2000, true);
      const source = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
      const track = { ...window.fixtureTrack, durationMs: 15000, audioUrl: source };
      const input = { track, lines: [], colorMode: "light", layout: "square" };
      const renderer = window.SakuraShareRenderer, modes = preparedFirst ? ["prepared", "unprepared"] : ["unprepared", "prepared"], runs = {};
      try {
        for (const mode of modes) {
          const controller = new AbortController(), audio = new renderer.ShareAudioPreparation();
          let requests = 0, transferredBytes = 0, paints = 0, card, inputPreparationMs = 0;
          const fetcher = window.fetch, fillText = CanvasRenderingContext2D.prototype.fillText;
          window.fetch = async (...args) => {
            const response = await fetcher(...args);
            if (String(args[0]) === source) { requests++; transferredBytes += Number(response.headers.get("Content-Length")) || 0; }
            return response;
          };
          CanvasRenderingContext2D.prototype.fillText = function (...args) { paints++; return fillText.apply(this, args); };
          try {
            if (mode === "prepared") {
              const before = performance.now();
              [card] = await Promise.all([renderer.renderShareCard(input, controller.signal), audio.prepare(track, null, controller.signal)]);
              inputPreparationMs = performance.now() - before;
            }
            const requestsBefore = requests, bytesBefore = transferredBytes, paintsBefore = paints, started = performance.now();
            const playerTime = window.playerFixture.currentTime;
            let firstProgressMs = null;
            const output = await renderer.renderShareVideo(input, {
              seconds, startSeconds: .2, signal: controller.signal,
              ...(mode === "prepared" ? { card, audio } : {}),
              onProgress: () => { firstProgressMs ??= performance.now() - started; },
            });
            const exportMs = performance.now() - started;
            const element = document.createElement("video"), videoUrl = URL.createObjectURL(output.blob);
            let decoded;
            try {
              element.src = videoUrl;
              await new Promise((resolve, reject) => { element.onloadedmetadata = resolve; element.onerror = () => reject(new Error("Benchmark video cannot be played")); });
              const pcm = await new OfflineAudioContext(2, 1, 48000).decodeAudioData(await output.blob.arrayBuffer());
              const samples = pcm.getChannelData(0), start = Math.round(.25 * pcm.sampleRate), end = Math.round((seconds - .25) * pcm.sampleRate);
              let crossings = 0, energy = 0;
              for (let index = start + 1; index < end; index++) { if (samples[index - 1] < 0 && samples[index] >= 0) crossings++; energy += samples[index] ** 2; }
              decoded = { duration: element.duration, width: element.videoWidth, height: element.videoHeight, pitch: crossings / ((end - start) / pcm.sampleRate), rms: Math.sqrt(energy / (end - start)) };
            } finally { element.removeAttribute("src"); element.load(); URL.revokeObjectURL(videoUrl); }
            runs[mode] = {
              inputPreparationMs, firstProgressMs, exportMs, bytes: output.blob.size, decoded,
              preparationAudioRequests: requestsBefore, exportAudioRequests: requests - requestsBefore,
              exportAudioBytes: transferredBytes - bytesBefore, cardTextPaintsDuringExport: paints - paintsBefore,
              playerContinues: !window.playerFixture.paused, playerAdvanced: window.playerFixture.currentTime !== playerTime,
              playerSourceUnchanged: window.playerFixture.src === window.fixtureTrack.audioUrl,
            };
          } finally { audio.clear(); window.fetch = fetcher; CanvasRenderingContext2D.prototype.fillText = fillText; }
        }
        return { seconds, order: modes, runs };
      } finally { URL.revokeObjectURL(source); }
    }, { seconds, preparedFirst: seconds === 8 });
    for (const [mode, run] of Object.entries(result.runs)) {
      assert.equal(run.decoded.width, 1080); assert.equal(run.decoded.height, 1080);
      assert.ok(Math.abs(run.decoded.duration - seconds) < .1); assert.ok(Math.abs(run.decoded.pitch - 880) < 10); assert.ok(run.decoded.rms > .02);
      assert.equal(run.playerContinues, true); assert.equal(run.playerAdvanced, true); assert.equal(run.playerSourceUnchanged, true);
      assert.equal(run.exportAudioRequests, mode === "prepared" ? 0 : 1);
      if (mode === "prepared") { assert.equal(run.exportAudioBytes, 0); assert.equal(run.cardTextPaintsDuringExport, 0); }
      else assert.ok(run.cardTextPaintsDuringExport > 0);
    }
    results.push(result);
    console.log(JSON.stringify({ benchmarkClip: result }));
  }
  const report = { checkedAt: new Date().toISOString(), browser: await page.context().browser().version(), source: "15-second generated local WAV; no remote transfer", samplesPerMode: 1, codecProbe: "already warm for both modes", results };
  await fs.writeFile(".local/rebuild-share-export-benchmark.json", JSON.stringify(report, null, 2) + "\n");
  return report;
}

await fs.mkdir(".local", { recursive: true });
const bundle = path.resolve(".local/rebuild-share-export.js");
await build({ entryPoints: ["src/rebuild/player/shareRender.ts"], bundle: true, format: "iife", globalName: "SakuraShareRenderer", platform: "browser", outfile: bundle });
const browserOptions = { headless: true };
if (process.env.PLAYWRIGHT_EXECUTABLE_PATH) browserOptions.executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
else {
  for (const candidate of ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"]) {
    if (await fs.access(candidate).then(() => true, () => false)) { browserOptions.executablePath = candidate;break; }
  }
}
const browser = await chromium.launch(browserOptions);
const origin = createServer((_request, response) => { response.setHeader("Content-Type", "text/html");response.end("<!doctype html><title>Sakura exporter verification</title>"); });
await new Promise(resolve => origin.listen(0, "127.0.0.1", resolve));
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${origin.address().port}`);
  await page.setContent('<button id="video">Prepare video</button><button id="cancel">Prepare cancellable video</button>');
  await page.addScriptTag({ path: bundle });
  const png = await page.evaluate(async () => {
    const calls = [];
    const original = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, ...args) { calls.push(text);return original.call(this, text, ...args); };
    const track = { id: "fixture", title: "Exporter verification", artists: ["Synthetic fixture"], albumTitle: null, coverUrl: null, durationMs: 3000, versionLabel: "Test recording", reference: { provider: "deezer", id: "fixture" }, references: [] };
    window.fixtureTrack = track;
    const lines = [{ text: "東京へ行く", start: 1.25, end: 2.5 }, { text: "These exact selected words remain intact.", start: 2.5, end: 3 }];
    const result = await window.SakuraShareRenderer.renderShareCard({ track, lines, colorMode: "dark", layout: "portrait" });
    const bytes = new Uint8Array(await result.blob.arrayBuffer());
    const image = document.createElement("img");image.src = URL.createObjectURL(result.blob);image.style.width = "300px";document.body.append(image);
    return { width: result.canvas.width, height: result.canvas.height, mime: result.file.type, signature: Array.from(bytes.slice(0, 8)), size: bytes.length, calls };
  });
  assert.equal(png.width, 1080);assert.equal(png.height, 1350);assert.equal(png.mime, "image/png");assert.deepEqual(png.signature, [137, 80, 78, 71, 13, 10, 26, 10]);assert.ok(png.size > 10000);
  assert.ok(png.calls.includes("東京へ行く"));assert.ok(png.calls.join(" ").includes("These exact selected words remain intact."));
  await page.screenshot({ path: ".local/rebuild-share-export.png" });
  const supported = await page.evaluate(async () => Boolean(await window.SakuraShareRenderer.videoExportMime("square")));
  let video = null;
  if (supported) {
    await page.evaluate(async () => {
      window.preparedSquare = await window.SakuraShareRenderer.renderShareCard({ track: window.fixtureTrack, lines: [], colorMode: "light", layout: "square" });
      window.pngEncodeCount = 0;
      const toBlob = HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob = function (...args) { window.pngEncodeCount++;return toBlob.apply(this, args); };
      const rate = 22050;const count = rate * 3;const bytes = new ArrayBuffer(44 + count * 2);const view = new DataView(bytes);
      const ascii = (offset, text) => [...text].forEach((letter, index) => view.setUint8(offset + index, letter.charCodeAt(0)));
      ascii(0, "RIFF");view.setUint32(4, 36 + count * 2, true);ascii(8, "WAVE");ascii(12, "fmt ");view.setUint32(16, 16, true);view.setUint16(20, 1, true);view.setUint16(22, 1, true);view.setUint32(24, rate, true);view.setUint32(28, rate * 2, true);view.setUint16(32, 2, true);view.setUint16(34, 16, true);ascii(36, "data");view.setUint32(40, count * 2, true);
      // The source changes pitch at the chosen .2s start. Decode the finished
      // clip below to prove it contains the selected segment of actual audio.
      for (let sample = 0; sample < count; sample++) view.setInt16(44 + sample * 2, Math.sin(sample / rate * (sample < rate * .2 ? 220 : 880) * Math.PI * 2) * 2000, true);
      window.fixtureTrack.audioUrl = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
      window.playerFixture = new Audio(window.fixtureTrack.audioUrl);
      window.playerFixture.loop = true;
      document.getElementById("video").onclick = () => {
        const controller = new AbortController();
        let inputTurns = 0;
        const clock = setInterval(() => inputTurns++, 0);
        void window.playerFixture.play();
        window.videoResult = (async () => {
          const input = { track: window.fixtureTrack, lines: [], colorMode: "light", layout: "square" };
          const preparation = new window.SakuraShareRenderer.ShareAudioPreparation();
          const fetcher = window.fetch, fillText = CanvasRenderingContext2D.prototype.fillText;
          let audioRequests = 0, paintedText = 0;
          window.fetch = (...args) => { audioRequests++; return fetcher(...args); };
          CanvasRenderingContext2D.prototype.fillText = function (...args) { paintedText++; return fillText.apply(this, args); };
          try {
            const card = window.preparedSquare;
            const prepareStarted = performance.now();
            await preparation.prepare(window.fixtureTrack, null, controller.signal);
            const audioPrepareMs = performance.now() - prepareStarted;
            const repeatStarted = performance.now();
            await preparation.prepare(window.fixtureTrack, null, controller.signal);
            const audioRepeatMs = performance.now() - repeatStarted;
            const requestsBefore = audioRequests, paintsBefore = paintedText, exportStarted = performance.now();
            const result = await window.SakuraShareRenderer.renderShareVideo(input, { seconds: 1, startSeconds: .2, card, audio: preparation, signal: controller.signal, onProgress: () => {} });
            return { size: result.blob.size, mime: result.file.type, bytes: Array.from(new Uint8Array(await result.blob.arrayBuffer())),
              pngEncodes: window.pngEncodeCount, inputTurns,
              preparation: { audioPrepareMs, audioRepeatMs, exportMs: performance.now() - exportStarted,
                preparationAudioRequests: requestsBefore, exportAudioRequests: audioRequests - requestsBefore, duplicateCardTextPaints: paintedText - paintsBefore,
                playerContinues: !window.playerFixture.paused, playerSourceUnchanged: window.playerFixture.src === window.fixtureTrack.audioUrl } };
          } finally {
            clearInterval(clock);preparation.clear();window.fetch = fetcher;CanvasRenderingContext2D.prototype.fillText = fillText;
          }
        })();
      };
      document.getElementById("cancel").onclick = () => {
        const controller = new AbortController();
        window.cancelResult = window.SakuraShareRenderer.renderShareVideo({ track: window.fixtureTrack, lines: [], colorMode: "light", layout: "square" }, { seconds: 3, startSeconds: 0, signal: controller.signal, onProgress: () => {} }).then(() => "unexpected-success", error => error.name);
        setTimeout(() => controller.abort(), 100);
      };
    });
    await page.locator("#video").click();
    video = await page.evaluate(() => window.videoResult);
    assert.equal(video.pngEncodes, 0, "Video reuses the prepared card without rendering or PNG encoding again");
    assert.ok(video.inputTurns > 0, "Input tasks continue while video frames are encoded");
    assert.ok(video.size > 10000);assert.ok(video.mime.startsWith("video/webm"));assert.deepEqual(video.bytes.slice(0, 4), [26, 69, 223, 163]);
    assert.equal(video.preparation.preparationAudioRequests, 1);
    assert.equal(video.preparation.exportAudioRequests, 0);
    assert.equal(video.preparation.duplicateCardTextPaints, 0);
    assert.equal(video.preparation.playerContinues, true);
    assert.equal(video.preparation.playerSourceUnchanged, true);
    const binary = Buffer.from(video.bytes);assert.ok(binary.includes(Buffer.from("A_OPUS")), "WebM includes encoded audio");assert.ok(binary.includes(Buffer.from("V_VP")), "WebM includes encoded video");
    const decoded = await page.evaluate(async bytes => {
      const blob = new Blob([new Uint8Array(bytes)], { type: "video/webm" });
      const element = document.createElement("video");element.src = URL.createObjectURL(blob);
      await new Promise((resolve, reject) => { element.onloadedmetadata = resolve;element.onerror = () => reject(new Error("Exported video cannot be played")); });
      const audio = await new OfflineAudioContext(2, 1, 48000).decodeAudioData(await blob.arrayBuffer());
      const samples = audio.getChannelData(0);const start = Math.round(.25 * audio.sampleRate);const end = Math.round(.75 * audio.sampleRate);let crossings = 0;let energy = 0;
      for (let index = start + 1; index < end; index++) { if (samples[index - 1] < 0 && samples[index] >= 0) crossings++;energy += samples[index] ** 2; }
      URL.revokeObjectURL(element.src);
      return { duration: element.duration, width: element.videoWidth, height: element.videoHeight, pitch: crossings / ((end - start) / audio.sampleRate), rms: Math.sqrt(energy / (end - start)) };
    }, video.bytes);
    assert.equal(decoded.width, 1080);assert.equal(decoded.height, 1080);assert.ok(Math.abs(decoded.duration - 1) < .1);assert.ok(Math.abs(decoded.pitch - 880) < 10);assert.ok(decoded.rms > .02);
    video.decoded = decoded;
    await fs.writeFile(".local/rebuild-share-export.webm", binary);
    await page.locator("#cancel").click();
    assert.equal(await page.evaluate(() => window.cancelResult), "AbortError");
    const unavailable = await page.evaluate(async () => {
      return window.SakuraShareRenderer.renderShareVideo({ track: window.fixtureTrack, lines: [], colorMode: "light", layout: "square" }, { seconds: 1, startSeconds: 5, signal: new AbortController().signal, onProgress: () => {} }).then(() => "unexpected-success", error => error.message);
    });
    assert.ok(unavailable.includes("no audio at this clip position"));
    const canceledArtwork = await page.evaluate(async () => {
      const controller = new AbortController(), original = createImageBitmap;
      let closed = 0;
      const url = URL.createObjectURL(window.preparedSquare.blob);
      window.createImageBitmap = async (...args) => {
        const bitmap = await original(...args);
        const close = bitmap.close.bind(bitmap);
        bitmap.close = () => { closed++;close(); };
        controller.abort();
        return bitmap;
      };
      try {
        const name = await window.SakuraShareRenderer.renderShareCard({ track: { ...window.fixtureTrack, coverUrl: url }, lines: [], colorMode: "light", layout: "square" }, controller.signal).then(() => "unexpected-success", error => error.name);
        return { name, closed };
      } finally { window.createImageBitmap = original;URL.revokeObjectURL(url); }
    });
    assert.deepEqual(canceledArtwork, { name: "AbortError", closed: 1 }, "Artwork finishing after cancellation releases its decoded bitmap");
  }
  if (benchmark) { assert.equal(supported, true, "Benchmark requires browser video encoding"); await benchmarkClips(page); }
  const report = { checkedAt: new Date().toISOString(), png: { width: png.width, height: png.height, bytes: png.size, exactText: true }, webmSupported: supported, webm: video ? { bytes: video.size, audioTrack: true, videoTrack: true, decoded: video.decoded, preparation: video.preparation, cancellation: "AbortError", preparedCardReused: video.pngEncodes === 0, inputTurns: video.inputTurns, canceledBitmapReleased: true } : null };
  await fs.writeFile(".local/rebuild-share-export-report.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
} finally { await browser.close();await new Promise(resolve => origin.close(resolve)); }
