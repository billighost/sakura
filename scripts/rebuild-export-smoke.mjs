/** Real browser exporter checks; synthetic audio stays in the browser, never the catalog. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import { chromium } from "@playwright/test";
import { createServer } from "node:http";

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
    await page.evaluate(() => {
      const rate = 22050;const count = rate * 3;const bytes = new ArrayBuffer(44 + count * 2);const view = new DataView(bytes);
      const ascii = (offset, text) => [...text].forEach((letter, index) => view.setUint8(offset + index, letter.charCodeAt(0)));
      ascii(0, "RIFF");view.setUint32(4, 36 + count * 2, true);ascii(8, "WAVE");ascii(12, "fmt ");view.setUint32(16, 16, true);view.setUint16(20, 1, true);view.setUint16(22, 1, true);view.setUint32(24, rate, true);view.setUint32(28, rate * 2, true);view.setUint16(32, 2, true);view.setUint16(34, 16, true);ascii(36, "data");view.setUint32(40, count * 2, true);
      // The source changes pitch at the chosen .2s start. Decode the finished
      // clip below to prove it contains the selected segment of actual audio.
      for (let sample = 0; sample < count; sample++) view.setInt16(44 + sample * 2, Math.sin(sample / rate * (sample < rate * .2 ? 220 : 880) * Math.PI * 2) * 2000, true);
      window.fixtureTrack.audioUrl = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
      document.getElementById("video").onclick = () => {
        const controller = new AbortController();
        window.videoResult = window.SakuraShareRenderer.renderShareVideo({ track: window.fixtureTrack, lines: [], colorMode: "light", layout: "square" }, { seconds: 1, startSeconds: .2, signal: controller.signal, onProgress: () => {} }).then(async result => ({ size: result.blob.size, mime: result.file.type, bytes: Array.from(new Uint8Array(await result.blob.arrayBuffer())) }));
      };
      document.getElementById("cancel").onclick = () => {
        const controller = new AbortController();
        window.cancelResult = window.SakuraShareRenderer.renderShareVideo({ track: window.fixtureTrack, lines: [], colorMode: "light", layout: "square" }, { seconds: 3, startSeconds: 0, signal: controller.signal, onProgress: () => {} }).then(() => "unexpected-success", error => error.name);
        setTimeout(() => controller.abort(), 100);
      };
    });
    await page.locator("#video").click();
    video = await page.evaluate(() => window.videoResult);
    assert.ok(video.size > 10000);assert.ok(video.mime.startsWith("video/webm"));assert.deepEqual(video.bytes.slice(0, 4), [26, 69, 223, 163]);
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
  }
  const report = { checkedAt: new Date().toISOString(), png: { width: png.width, height: png.height, bytes: png.size, exactText: true }, webmSupported: supported, webm: video ? { bytes: video.size, audioTrack: true, videoTrack: true, decoded: video.decoded, cancellation: "AbortError" } : null };
  await fs.writeFile(".local/rebuild-share-export-report.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
} finally { await browser.close();await new Promise(resolve => origin.close(resolve)); }
