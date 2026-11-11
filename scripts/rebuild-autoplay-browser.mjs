/** Real MusicProvider and native audio endings. Only synthetic account APIs;
 * visibility events simulate minimization, without claiming iPhone OS testing. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { chromium, expect } from "@playwright/test";
import { encode } from "next-auth/jwt";
import "dotenv/config";

const base = process.env.SAKURA_TEST_URL || "http://localhost:3012";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname), "Autoplay fixtures must run locally");
const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
assert.ok(secret, "Local auth signing configuration is required");
const account = { id: "90000000-0000-4000-8000-000000000065", username: "Autoplay fixture", email: "autoplay@example.invalid" };
const token = await encode({ token: { id: account.id, name: account.username }, secret, salt: "authjs.session-token" });
const routeFile = "src/app/(music)/autoplay-check/page.tsx";
assert.equal(await fs.stat(routeFile).then(() => true, () => false), false, "Do not overwrite an existing autoplay fixture");
await fs.mkdir("src/app/(music)/autoplay-check", { recursive: true }); await fs.copyFile("scripts/fixtures/autoplay-room.tsx", routeFile);
await fs.mkdir(".local", { recursive: true });
const rate = 8000, seconds = 8, samples = rate * seconds, wav = Buffer.alloc(44 + samples * 2);
wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(samples * 2, 40);
for (let index = 0; index < samples; index++) wav.writeInt16LE(Math.round(Math.sin(index * Math.PI * 2 * 220 / rate) * 800), 44 + index * 2);
const sha = createHash("sha256").update(wav).digest("hex");
const tracks = Array.from({ length: 8 }, (_, index) => {
  const id = `80000000-0000-4000-8000-${String(index + 65).padStart(12, "0")}`, assetId = `81000000-0000-4000-8000-${String(index + 65).padStart(12, "0")}`;
  return { id, recordingId: id, title: "Continuous song " + (index + 1), artists: ["Fixture ensemble"], artistsComplete: true, artistId: null, albumId: null, albumTitle: "Continuous listening", coverUrl: null, versionLabel: "Original recording", durationMs: seconds * 1000, reference: { provider: "deezer", id: String(index + 65) }, references: [{ provider: "deezer", id: String(index + 65) }], readyPlayback: { kind: "stream", delivery: "cdn", assetId, sizeBytes: wav.length, sha256: sha, mimeType: "audio/wav", durationMs: seconds * 1000, url: `https://res.cloudinary.com/autoplay-fixture/video/upload/v1/sakura/v2/audio/${id}/${sha}.wav`, fallbackUrl: `/api/v2/recordings/${id}/audio?assetId=${assetId}` } };
});
const settings = { theme: "light", audioQuality: "balanced", audioTechnology: "none", privateSession: false, learnFromListening: true, reducedMotion: true, openingAnimation: 0, onboarded: true, volume: .3, shuffle: false, repeat: "off", seedArtists: [], seedGenres: [] };
const report = { scope: "Actual Next provider, native HTMLAudioElement endings, generated WAV, synthetic APIs and simulated background visibility; no iPhone hardware or server database writes", checks: [], ended: [], requests: [], pageErrors: [], history: [] };
let session = null, smartRequests = 0;
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
await context.addCookies([{ name: "authjs.session-token", value: token, url: base }]);
await context.addInitScript(() => {
  sessionStorage.setItem("sakura-ink-opening", "1");
  const NativeAudio = window.Audio;
  window.autoplayAudioEvents = [];
  window.Audio = function (...args) {
    const audio = new NativeAudio(...args); window.autoplayAudio = audio;
    for (const name of ["playing", "pause", "ended"]) audio.addEventListener(name, () => window.autoplayAudioEvents.push({ name, source: audio.src, time: Date.now() }));
    return audio;
  };
  window.Audio.prototype = NativeAudio.prototype;
  window.autoplayHidden = false;
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => window.autoplayHidden ? "hidden" : "visible" });
});
const page = await context.newPage(); page.setDefaultTimeout(45000); page.on("pageerror", error => report.pageErrors.push(error.message));
function audio(route) {
  const match = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range || "");
  const start = match ? Number(match[1]) : 0, end = match?.[2] ? Math.min(wav.length - 1, Number(match[2])) : wav.length - 1;
  if (start >= wav.length) return route.fulfill({ status: 416, headers: { "Content-Range": `bytes */${wav.length}` } });
  const headers = { "Accept-Ranges": "bytes", "Content-Length": String(end - start + 1), ETag: '"' + sha + '"' };
  if (match) headers["Content-Range"] = `bytes ${start}-${end}/${wav.length}`;
  return route.fulfill({ status: match ? 206 : 200, contentType: "audio/wav", body: wav.subarray(start, end + 1), headers });
}
await context.route("https://res.cloudinary.com/autoplay-fixture/**", audio);
await context.route("**/api/**", async route => {
  const request = route.request(), path = new URL(request.url()).pathname, method = request.method(); report.requests.push({ path, method });
  const owner = request.headers()["x-sakura-account"]; if (owner && owner !== account.id) return route.fulfill({ status: 401, json: { error: "Session changed" } });
  if (path === "/api/v2/profile") return route.fulfill({ json: { profile: account } });
  if (path === "/api/v2/settings") { if (method === "PATCH") Object.assign(settings, request.postDataJSON()); return route.fulfill({ json: { ...settings, revision: 0 } }); }
  if (path === "/api/v2/home") return route.fulfill({ json: { featured: tracks, mixes: [], needsOnboarding: false } });
  if (path === "/api/v2/library") return route.fulfill({ json: { recordings: [], playlists: [] } });
  if (path === "/api/v2/taste") return route.fulfill({ json: { feedback: [], tasteEvidence: [] } });
  if (path === "/api/v2/smart-queue") { smartRequests++; return route.fulfill({ json: { tracks, reason: "Your listening choices" } }); }
  if (path === "/api/v2/history") { const chunk = request.postDataJSON(); report.history.push(chunk); return route.fulfill({ json: { accepted: true, eventId: chunk.eventId, sequence: chunk.sequence } }); }
  if (path === "/api/v2/listening-session") {
    if (method === "PUT") { const input = request.postDataJSON(); session = { state: input.state, revision: (session?.revision || 0) + 1, deviceId: input.deviceId, updatedAt: Date.now() }; return route.fulfill({ json: { accepted: true, session, serverTime: Date.now() } }); }
    return route.fulfill({ json: { session, serverTime: Date.now() } });
  }
  if (path === "/api/v2/recordings/resolve") { const input = request.postDataJSON(), track = tracks.find(track => track.reference.id === input.reference.id); return route.fulfill({ json: { status: "resolved", recording: { ...track, metadata: { title: track.title, artists: track.artists, durationMs: track.durationMs } }, playback: track.readyPlayback } }); }
  if (path.endsWith("/audio")) return audio(route);
  if (path === "/api/auth/session") return route.fulfill({ json: { user: account } });
  return route.fulfill({ json: { items: [], recordings: [] } });
});
const state = () => page.evaluate(() => ({ id: window.autoplayState?.track?.id, title: window.autoplayState?.track?.title, status: window.autoplayState?.status, current: window.autoplayState?.currentEntryId, queue: window.autoplayState?.queue.map(entry => ({ id: entry.track.id, entryId: entry.entryId, priority: entry.priority, localOnly: entry.localOnly })), source: window.autoplayAudio?.src, paused: window.autoplayAudio?.paused, duration: window.autoplayAudio?.duration, ready: Object.values(window.autoplayState?.downloads || {}).filter(entry => entry.status === "ready").map(entry => ({ id: entry.recordingId, requested: entry.requested })), mediaState: navigator.mediaSession?.playbackState, error: window.autoplayState?.error }));
async function naturalNext(label) {
  const before = await state(); assert.equal(before.status, "playing", JSON.stringify(before));
  await page.evaluate(() => window.autoplayState.seek(Math.max(0, window.autoplayAudio.duration * 1000 - 90)));
  await expect.poll(async () => (await state()).current, { timeout: 20000 }).not.toBe(before.current);
  await expect.poll(async () => (await state()).status, { timeout: 20000 }).toBe("playing");
  const after = await state(); report.ended.push({ label, from: before.id, to: after.id, source: after.source, mediaState: after.mediaState });
  assert.equal(after.mediaState, "playing"); return after;
}
try {
  await page.goto(base + "/autoplay-check", { waitUntil: "domcontentloaded", timeout: 90000 }); await page.getByRole("button", { name: "Start continuous listening" }).waitFor();
  await page.getByRole("button", { name: "Start continuous listening" }).click(); await expect.poll(async () => (await state()).status).toBe("playing");
  await expect.poll(async () => (await state()).queue.length).toBeGreaterThan(4);
  await expect.poll(async () => (await state()).ready.length).toBeGreaterThanOrEqual(2);
  report.checks.push("A single-song selection automatically prepares personalized future songs and complete next-track audio");
  await page.evaluate(() => { window.autoplayHidden = true; document.dispatchEvent(new Event("visibilitychange")); });
  for (let index = 0; index < 5; index++) await naturalNext("background-" + index);
  const nativeEnds = await page.evaluate(() => window.autoplayAudioEvents.filter(event => event.name === "ended").length); assert.ok(nativeEnds >= 5);
  report.checks.push("Five real native track endings continue while simulated visibility is hidden, with Media Session remaining active");
  await page.evaluate(() => window.autoplayState.addQueue(window.autoplayTracks[7]));
  const manual = await naturalNext("manual-choice"); assert.equal(manual.id, tracks[7].id);
  report.checks.push("An intentional queue addition plays before generated recommendations");
  await page.evaluate(() => { window.autoplayState.pause(); document.dispatchEvent(new Event("visibilitychange")); window.dispatchEvent(new Event("pageshow")); });
  await page.waitForTimeout(400); const paused = await state(); assert.equal(paused.status, "paused"); assert.equal(paused.paused, true);
  report.checks.push("Explicit pause remains paused across background and page-show events");
  await page.evaluate(() => { window.autoplayState.requestDownload(window.autoplayTracks[0]); window.autoplayState.requestDownload(window.autoplayTracks[1]); });
  await expect.poll(async () => { const ready = (await state()).ready; return tracks.slice(0, 2).every(track => ready.some(entry => entry.id === track.id && entry.requested !== false)); }, { timeout: 20000 }).toBe(true);
  const onlineSmartCount = smartRequests; await context.setOffline(true);
  await page.evaluate(async () => { window.autoplayState.clearQueue(); await Promise.all(window.autoplayTracks.slice(2).map(track => window.autoplayState.removeDownload(track.id))); });
  await page.evaluate(() => window.autoplayState.play(window.autoplayTracks[0], [window.autoplayTracks[0]])); await expect.poll(async () => (await state()).status, { timeout: 20000 }).toBe("playing");
  for (let index = 0; index < 5; index++) { const after = await naturalNext("offline-" + index); assert.ok([tracks[0].id, tracks[1].id].includes(after.id), JSON.stringify(after)); assert.ok(after.source.startsWith("blob:")); }
  assert.equal(smartRequests, onlineSmartCount);
  report.checks.push("Offline playback cycles two downloaded songs for five endings using local blobs, without new recommendation requests");
  assert.deepEqual(report.pageErrors, []); await page.screenshot({ path: ".local/autoplay-browser-mobile.png" });
  await fs.writeFile(".local/autoplay-browser-report.json", JSON.stringify(report, null, 2)); console.log(JSON.stringify({ checks: report.checks, transitions: report.ended.length, pageErrors: report.pageErrors }));
} catch (error) { await page.screenshot({ path: ".local/autoplay-browser-failure.png" }).catch(() => {}); await fs.writeFile(".local/autoplay-browser-report.json", JSON.stringify({ ...report, failure: String(error), finalState: await state().catch(() => null) }, null, 2)); throw error; }
finally { await browser.close(); await fs.unlink(routeFile); await fs.rmdir("src/app/(music)/autoplay-check").catch(() => {}); }
