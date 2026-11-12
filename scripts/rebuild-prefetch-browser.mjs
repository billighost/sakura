/** Isolated signed synthetic account; proves the actual intent controller/cache handoff. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { chromium, expect } from "@playwright/test";
import { encode } from "next-auth/jwt";
import "dotenv/config";

const root = await fs.realpath(fileURLToPath(new URL("..", import.meta.url)));
const port = Number(process.env.SAKURA_PREFETCH_TEST_PORT || 3102), base = `http://127.0.0.1:${port}`;
const fixture = path.join(root, "src/app/prefetch-check"), fixtureFile = path.join(fixture, "page.tsx");
const account = { id: "97090000-0000-4000-8000-000000000401", username: "Prefetch fixture", email: "prefetch@example.invalid" };
const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
assert.ok(secret, "Local auth signing configuration is required");
assert.equal(await fs.stat(fixtureFile).then(() => true, () => false), false, "Never overwrite an existing route");
await fs.mkdir(fixture, { recursive: true }); await fs.copyFile(path.join(root, "scripts/fixtures/prefetch-room.tsx"), fixtureFile);
await fs.mkdir(path.join(root, ".local/prefetch-performance"), { recursive: true });
const nextEnvFile = path.join(root, "next-env.d.ts"), previousNextEnv = await fs.readFile(nextEnvFile, "utf8");
const server = spawn(process.execPath, [path.join(root, "node_modules/next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", String(port)], {
 cwd: root, env: { ...process.env, SAKURA_BUILD_DIR: ".next-performance-front-dev" }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "", browser;
const checks = [], requests = [], errors = [];
const defaults = { theme: "light", audioQuality: "high", audioTechnology: "none", privateSession: false, discovery: .5, reducedMotion: true, openingAnimation: 0, seedArtists: [], seedGenres: [], onboarded: true, volume: .8, timeZone: "Africa/Lagos", explicitContent: true };
const track = { recordingId: "97090000-0000-4000-8000-000000000402", metadata: { title: "Prepared fixture song", artists: ["Prepared artist"], durationMs: 120000 }, reference: { provider: "deezer", id: "prefetch-song" }, references: [{ provider: "deezer", id: "prefetch-song" }], coverUrl: null };
try {
 await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error("Isolated Next server did not become ready")), 60000);
  const log = data => { serverLog = (serverLog + data).slice(-12000); if (serverLog.includes("Ready in")) { clearTimeout(timeout); resolve(); } };
  server.stdout.on("data", log); server.stderr.on("data", log); server.once("error", reject); server.once("exit", code => { clearTimeout(timeout); reject(new Error(`Isolated server exited (${code})`)); });
 });
 browser = await chromium.launch({ channel: "chrome", headless: true });
 const context = await browser.newContext({ serviceWorkers: "block", reducedMotion: "reduce" });
 const token = await encode({ token: { id: account.id, name: account.username }, secret, salt: "authjs.session-token" });
 await context.addCookies([{ name: "authjs.session-token", value: token, url: base }]);
 await context.addInitScript(() => sessionStorage.setItem("sakura-ink-opening", "1"));
 let failFeed = false, artistGate, releaseArtist;
 const waitArtist = new Promise(resolve => releaseArtist = resolve);
 await context.route("**/api/**", async route => {
  const request = route.request(), url = new URL(request.url()), endpoint = url.pathname;
  requests.push({ path: endpoint, method: request.method(), search: url.search });
  if (endpoint === "/api/v2/bootstrap" || endpoint === "/api/v2/profile") return route.fulfill({ json: { profile: account } });
  if (endpoint === "/api/v2/settings") return route.fulfill({ json: defaults });
  if (endpoint === "/api/v2/taste") return route.fulfill({ json: { feedback: [] } });
  if (endpoint === "/api/v2/listening-session") return route.fulfill({ json: { session: null, serverTime: Date.now() } });
  if (endpoint === "/api/v2/library/state") return route.fulfill({ json: { likedIds: [], favoriteRevisions: {}, favoriteStates: {} } });
  if (endpoint === "/api/v2/library") return route.fulfill({ json: { recordings: [], playlists: [], favoriteRevisions: {}, favoriteStates: {}, nextCursor: null } });
  if (endpoint === "/api/v2/artists/prefetch-fixture") { artistGate = true; await waitArtist; return route.fulfill({ json: { name: "Artist prepared before opening" } }); }
  if (endpoint === "/api/v2/feed" || endpoint === "/api/v2/feed/hero") {
   if (failFeed) return route.fulfill({ status: 503, json: { error: "Synthetic outage" } });
   const item = { track, lane: "similar", reason: "Prepared recommendation explanation" };
   return route.fulfill({ json: endpoint.endsWith("hero") ? { item, refreshAt: Date.now() + 600000 } : { items: [item], sections: [], nextCursor: null, personalized: true, totalCandidates: 1, generatedAt: new Date().toISOString() } });
  }
  if (endpoint === "/api/v2/bloom/shelf") return route.fulfill({ json: { blooms: [], entries: [] } });
  return route.fulfill({ json: { accepted: true, artists: [], mixes: [], events: [] } });
 });
 const page = await context.newPage(); page.setDefaultTimeout(30000); page.on("pageerror", error => errors.push(error.message));
 await page.goto(base + "/prefetch-check", { waitUntil: "domcontentloaded", timeout: 180000 });
 await expect(page.locator("[data-boot]")).toHaveText("ready");
 await page.locator("[data-prefetch-artist]").focus(); await expect.poll(() => artistGate).toBe(true);
 assert.equal(requests.filter(request => request.path.endsWith("/artists/prefetch-fixture")).length, 1);
 await page.locator("[data-prefetch-artist]").click(); releaseArtist();
 await expect(page.locator("[data-prepared-artist]")).toHaveText("Artist prepared before opening");
 assert.equal(requests.filter(request => request.path.endsWith("/artists/prefetch-fixture")).length, 1);
 checks.push("Keyboard intent starts artist data before opening; a mounted view joins the same outstanding request.");
 await page.locator("[data-prefetch-feed]").hover();
 await expect.poll(() => requests.filter(request => request.path === "/api/v2/feed" && request.search.includes("surface=discover")).length).toBe(1);
 await expect.poll(() => requests.filter(request => request.path === "/api/v2/feed/hero" && request.search.includes("surface=discover")).length).toBe(1);
 await page.locator("[data-prefetch-feed]").click();
 await expect(page.locator('[data-personalized-feed="discover"]')).toContainText("Prepared fixture song");
 assert.equal(requests.filter(request => request.path === "/api/v2/feed" && request.search.includes("surface=discover")).length, 1);
 assert.equal(requests.filter(request => request.path === "/api/v2/feed/hero" && request.search.includes("surface=discover")).length, 1);
 checks.push("Discovery navigation consumes the actual preloaded feed and hero caches with no duplicate provider calls.");
 failFeed = true;
 await page.evaluate(owner => window.dispatchEvent(new CustomEvent("sakura-listening-erased", { detail: { accountId: owner, scope: "history", period: "all" } })), account.id);
 await expect(page.locator('[data-personalized-feed="discover"] [data-song-id]')).toHaveCount(0);
 await expect(page.locator('[data-personalized-feed="discover"] [role="alert"]')).toBeVisible();
 checks.push("Listening erasure removes prefetched explanations immediately even when current data cannot be fetched.");
 assert.deepEqual(errors, []);
 await page.screenshot({ path: path.join(root, ".local/prefetch-performance/verified.png") });
 const report = { checkedAt: new Date().toISOString(), checks, requests, errors, environment: "Isolated Next development server; synthetic signed account and intercepted APIs. Browser proof is functional, not a production latency benchmark." };
 await fs.writeFile(path.join(root, ".local/prefetch-performance/report.json"), JSON.stringify(report, null, 2));
 console.log(JSON.stringify({ checks, errors }, null, 2));
} catch (error) { console.error(serverLog); throw error; }
finally {
 await browser?.close(); server.kill(); await fs.unlink(fixtureFile); await fs.rmdir(fixture).catch(() => {});
 const nextEnv = await fs.readFile(nextEnvFile, "utf8");
 if (nextEnv.includes(".next-performance-front-dev/")) await fs.writeFile(nextEnvFile, previousNextEnv);
 const configFile = path.join(root, "tsconfig.json"), config = JSON.parse(await fs.readFile(configFile, "utf8"));
 const cleaned = config.include.filter(entry => !entry.startsWith(".next-performance-front-dev/"));
 if (cleaned.length !== config.include.length) { config.include = cleaned; await fs.writeFile(configFile, JSON.stringify(config, null, 2) + "\n"); }
}
