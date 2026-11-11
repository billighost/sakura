import "dotenv/config";
import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chromium, expect } from "@playwright/test";
import { encode } from "next-auth/jwt";
import { VERIFIED_LYRICS_VERSION } from "../src/rebuild/lyrics/versions.ts";

const base = process.env.SAKURA_TEST_URL || "http://localhost:3012", secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
assert.ok(secret, "Synthetic auth signing configuration is required");
const account = { id: "95170000-0000-4000-8000-000000000491", username: "Lyric studio", email: "studio@example.invalid" };
const token = await encode({ token: { id: account.id, name: account.username }, secret, salt: "authjs.session-token" });
const dir = "src/app/(music)/lyric-studio-check", route = dir + "/page.tsx";
assert.equal(await fs.stat(route).then(() => true, () => false), false, "Do not overwrite a fixture");
await fs.mkdir(dir, { recursive: true }); await fs.copyFile("scripts/fixtures/lyric-studio-room.tsx", route);
const output = ".local/lyric-studio-review"; await fs.mkdir(output, { recursive: true });
const samples = 24000 * 12, wav = Buffer.alloc(44 + samples * 2);
wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(24000, 24); wav.writeUInt32LE(48000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(samples * 2, 40);
for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 440 / 24000) * 500), 44 + i * 2);
const id = "95170000-0000-4000-8000-000000000481", assetId = "95180000-0000-4000-8000-000000000481", sha256 = createHash("sha256").update(wav).digest("hex");
const browser = await chromium.launch({ channel: "chrome", headless: true }), errors = [], checks = [], publications = [], network = [];
let session = null, revision = 0;
try {
 const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
 await context.addCookies([{ name: "authjs.session-token", value: token, url: base }]);
 await context.addInitScript(() => {sessionStorage.setItem("sakura-ink-opening", "1"); const NativeAudio=window.Audio;window.Audio=function(...args){const audio=new NativeAudio(...args);window.studioAudio=audio;return audio;};window.Audio.prototype=NativeAudio.prototype;});
 await context.route("**/api/**", async route => {
  const request = route.request(), path = new URL(request.url()).pathname, data = request.method() === "POST" || request.method() === "PUT" || request.method() === "PATCH" ? request.postDataJSON() : {};network.push({path,method:request.method(),range:request.headers().range});
  if (path === "/api/v2/profile") return route.fulfill({ json: { profile: account } });
  if (path === "/api/auth/session") return route.fulfill({ json: { user: account } });
  if (path === "/api/v2/settings") return route.fulfill({ json: { theme: "light", openingAnimation: 0, reducedMotion: false, audioTechnology: "none", privateSession: true, onboarded: true, seedArtists: [], seedGenres: [], volume: .8 } });
  if (path === "/api/v2/listening-session") { if (request.method() === "PUT") session = { state: data.state, revision: ++revision, deviceId: data.deviceId, updatedAt: Date.now() }; return route.fulfill({ json: { accepted: true, session, serverTime: Date.now() } }); }
  if (path === "/api/v2/recordings/resolve") return route.fulfill({ json: { status: "resolved", recording: { id, reference: {provider: "deezer", id: "481"}, references: [{provider: "deezer", id: "481"}], metadata: { title: "Words in the garden", artists: ["Studio fixture"], albumTitle: "A little manuscript", durationMs: 12000 } }, playback: { assetId, url: base + "/api/v2/recordings/" + id + "/audio", fallbackUrl: "/api/v2/recordings/" + id + "/audio", sizeBytes: wav.length, sha256, mimeType: "audio/wav" } } });
  if (path.endsWith("/audio")) { const range = request.headers().range?.match(/bytes=(\d+)-(\d*)/); if (!range) return route.fulfill({ body: wav, contentType: "audio/wav", headers: { "Accept-Ranges": "bytes" } }); const start = Number(range[1]), end = range[2] ? Math.min(wav.length - 1, Number(range[2])) : wav.length - 1; return route.fulfill({ status: 206, body: wav.subarray(start, end + 1), contentType: "audio/wav", headers: { "Accept-Ranges": "bytes", "Content-Range": `bytes ${start}-${end}/${wav.length}` } }); }
  if (path === "/api/v2/lyrics/challenge") return route.fulfill({ json: { prefix: "studio-fixture", target: "f".repeat(64), expiresAt: Date.now() + 240000 } });
  if (path === "/api/v2/lyrics/publish") { publications.push(data); return route.fulfill({ status: 201, json: { published: true, lyricsAvailable: true, lyrics: { schemaVersion: VERIFIED_LYRICS_VERSION, timing: "synced", provider: "lrclib", instrumental: false, lines: [{ text: "The first petals find the light", start: 1 }, { text: "A song is carried on the breeze", start: 3 }, { text: "And every word has room to bloom", start: 6 }] } } }); }
  return route.fulfill({ json: { recordings: [], items: [], tracks: [], feedback: [], history: [], tasteEvidence: [] } });
 });
 const page = await context.newPage(); page.setDefaultTimeout(45000); page.on("pageerror", error => errors.push(error.message));
 await page.goto(base + "/lyric-studio-check", { waitUntil: "domcontentloaded", timeout: 90000 }); await page.getByRole("heading", { name: "Lyric studio verification" }).waitFor();
 await page.getByRole("button", { name: "Play studio fixture", exact: true }).click(); await expect.poll(() => page.evaluate(() => window.studioProbe?.status),{timeout:20000}).toBe("playing");
 await page.getByRole("button", { name: "Missing lyrics? Add the words", exact: true }).click();
 const studio = page.locator("dialog").last(); await expect(studio).toBeVisible();
 await studio.getByRole("textbox", { name: "Lyrics text" }).fill("First draft line\nSecond draft line");
 await studio.getByRole("button", { name: "Open preview", exact: true }).click(); await expect(studio.getByRole("complementary", { name: "Lyric playback preview" })).toContainText("First draft line");
 await page.screenshot({ path: output + "/phone-editor.png" });
 await studio.getByRole("button", { name: "Close", exact: true }).click(); await expect(page.locator("[data-lyric-studio]")).toHaveCount(0);
 await page.getByRole("button", { name: "Missing lyrics? Add the words", exact: true }).click(); await expect(page.getByRole("textbox", { name: "Lyrics text" })).toHaveValue("First draft line\nSecond draft line"); checks.push("Closing and reopening retains the exact manuscript draft; plain preview shows every line");
 await page.locator('input[type="file"]').setInputFiles({ name: "garden.lrc", mimeType: "text/plain", buffer: Buffer.from("[00:01.00]The first petals find the light\n[00:03.00]A song is carried on the breeze\n[00:06.00]And every word has room to bloom") });
 await expect(page.getByRole("button", { name: "Words in time Synced LRC" })).toHaveAttribute("aria-pressed", "true");
 await page.getByRole("button", { name: "Open preview", exact: true }).click(); await page.getByRole("button", { name: "Restart song & preview", exact: true }).click();
 await page.getByRole("complementary", { name: "Lyric playback preview" }).getByRole("button").filter({ hasText: "A song is carried" }).click(); await expect.poll(() => page.evaluate(() => window.studioProbe?.positionMs)).toBeGreaterThanOrEqual(3000); checks.push("LRC file import selects synced format; preview line starts playback at its timestamp");
 for (const width of [320, 390, 1440]) { await page.setViewportSize({ width, height: width > 700 ? 1000 : 844 }); const fit = await page.locator("[data-lyric-studio]").evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth })); assert.ok(fit.scroll <= fit.width + 1, `Studio overflows at ${width}: ${JSON.stringify(fit)}`); await page.screenshot({ path: `${output}/editor-${width}.png` }); }
 checks.push("Editor and side preview fit 320px, 390px and desktop without horizontal overflow");
 await page.setViewportSize({ width: 390, height: 844 }); await page.getByRole("button", { name: "Publish to LRCLIB", exact: true }).click(); await expect(page.locator("[data-lyric-studio]")).toHaveCount(0); assert.equal(publications.length, 1); assert.equal(publications[0].format, "lrc"); assert.match(publications[0].publishToken, /^studio-fixture:\d+$/); checks.push("Real browser worker completes challenge and publishes one validated synthetic LRC submission");
 await page.getByRole("button", { name: "Sync lyrics", exact: true }).click(); await expect(page.getByRole("heading", { name: "Let the words meet the music." })).toBeVisible();
 for (const position of [1000, 3000, 6000]) { await page.evaluate(position => window.studioProbe.seek(position), position); await expect.poll(() => page.evaluate(() => window.studioProbe.status)).toBe("playing"); await page.getByRole("button", { name: /^Time next line/ }).click(); }
 await page.screenshot({ path: output + "/phone-tap-timing.png" });
 await page.evaluate(() => window.studioProbe.seek(11500)); await expect(page.getByRole("heading", { name: "A final listen, a little polish." })).toBeVisible({ timeout: 15000 }); assert.equal(await page.evaluate(() => window.studioProbe.track.title), "Words in the garden"); checks.push("Sync lyrics restarts the song; sequential taps record media time; natural end holds song and opens review");
 await page.screenshot({ path: output + "/phone-timing-review.png" }); await expect(page.getByRole("spinbutton", { name: "Start time for line 1" })).toBeVisible();
 await page.getByRole("button", { name: "Publish to LRCLIB", exact: true }).click(); await expect(page.locator("[data-lyric-studio]")).toHaveCount(0); assert.equal(publications.length, 2); assert.equal(publications[1].format, "lrc"); checks.push("Tap-generated synced lyrics can be reviewed and published with a separate explicit action");
 assert.deepEqual(errors, []); await fs.writeFile(output + "/report.json", JSON.stringify({ checks, publications: publications.length, errors }, null, 2)); console.log(JSON.stringify({ checks, publications: publications.length, errors }));
} catch (error) { const page=browser.contexts()[0]?.pages()[0];const state=await page?.evaluate(()=>({status:window.studioProbe?.status,error:window.studioProbe?.error,track:window.studioProbe?.track,audio:window.studioAudio?{src:window.studioAudio.src,paused:window.studioAudio.paused,time:window.studioAudio.currentTime,duration:window.studioAudio.duration,ready:window.studioAudio.readyState,error:window.studioAudio.error?.code}:null})).catch(()=>null);await page?.screenshot({path:output+"/failure.png"}).catch(()=>{}); console.error(JSON.stringify({ checks, errors, publications: publications.length,state,network:network.slice(-20) })); throw error; }
finally { await browser.close(); await fs.unlink(route); await fs.rmdir(dir).catch(() => {}); }
