import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect } from "@playwright/test";
import sharp from "sharp";
import { config as loadEnv } from "dotenv";
import pg from "pg";
import { OG_PAGES } from "../src/rebuild/og/catalog.ts";
import { cleanPreviewText } from "../src/rebuild/seo/metadata.ts";
import { DEFAULT_SETTINGS } from "../src/rebuild/data/validation.ts";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });
const base = process.env.SAKURA_TEST_URL || "http://localhost:3000";
const output = resolve(".local/og-preview/seo");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block", reducedMotion: "reduce" });
const checks = [], pageErrors = [], fixtures = [];
let inspectedPage;
const decode = text => text?.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
function meta(html, name) {
  const tag = [...html.matchAll(/<meta\s[^>]*>/g)].map(match => match[0]).find(tag => /(?:name|property)="([^"]+)"/.exec(tag)?.[1] === name);
  return decode(tag && /content="([^"]*)"/.exec(tag)?.[1]);
}
async function checkImage(path, filename, format = "jpeg") {
  const response = await context.request.get(base + path, { headers: { "User-Agent": "WhatsApp/2.26" }, timeout: 90_000 });
  assert.equal(response.status(), 200, path);
  assert.equal(response.headers()["content-type"]?.split(";")[0], "image/" + format);
  const bytes = await response.body();
  const info = await sharp(bytes).metadata();
  assert.equal(info.width, 1200); assert.equal(info.height, 630);
  assert.ok(bytes.length < 250_000);
  if (filename) await writeFile(resolve(output, filename), bytes);
  return response;
}
async function checkPage(path, options = {}) {
  const response = await context.request.get(base + path, { headers: { "User-Agent": options.ua || "WhatsApp/2.26" }, maxRedirects: 0, timeout: 90_000 });
  assert.equal(response.status(), 200, path);
  const html = await response.text();
  const head = html.slice(0, html.indexOf("</head>"));
  for (const field of ["og:title", "og:description", "og:url", "og:image", "og:image:alt", "og:site_name"]) assert.ok(meta(head, field), path + " " + field + " in the head");
  assert.equal(meta(head, "og:image:type"), "image/jpeg");
  assert.equal(meta(head, "og:image:width"), "1200");
  assert.equal(meta(head, "og:image:height"), "630");
  assert.equal(meta(head, "og:site_name"), "Sakura");
  assert.equal(meta(head, "twitter:card"), "summary_large_image");
  assert.equal(meta(head, "twitter:image"), meta(head, "og:image"));
  assert.ok(new URL(meta(head, "og:image")).protocol === "https:" || new URL(meta(head, "og:image")).hostname === "localhost");
  assert.equal(new URL(meta(head, "og:url")).pathname, options.canonical || path);
  const canonical = /<link[^>]*rel="canonical"[^>]*href="([^"]+)"/.exec(head)?.[1];
  assert.equal(decode(canonical), meta(head, "og:url"));
  assert.ok(meta(head, "robots").includes(options.indexable ? "index, follow" : "noindex"));
  if (options.title) assert.equal(meta(head, "og:title"), options.title);
  if (options.image) assert.equal(new URL(meta(head, "og:image")).pathname, options.image);
  if (options.fetchImage !== false) {
    const image = new URL(meta(head, "og:image"));
    await checkImage(image.pathname + image.search, options.filename);
  }
  return { html, head, image: new URL(meta(head, "og:image")) };
}

async function liveFixtures() {
  const connectionString = process.env.SAKURA_REBUILD_DATABASE_URL || process.env.DATABASE_URL;
  if (!connectionString) return false;
  const pool = new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 3500, query_timeout: 3500, statement_timeout: 3500 });
  try {
    const queries = [
      ["artist", 'SELECT id,name AS title FROM sakura_v2."Artist" ORDER BY updated_at DESC LIMIT 1'],
      ["album", 'SELECT id,title FROM sakura_v2."Album" ORDER BY updated_at DESC LIMIT 1'],
      ["track", `SELECT r.id,r.metadata->>'title' AS title FROM sakura_v2."Recording" r WHERE r.state='verified' AND EXISTS(SELECT 1 FROM sakura_v2."ExternalReference" e WHERE e.recording_id=r.id AND e.verified_at IS NOT NULL) LIMIT 1`],
      ["playlist", 'SELECT id,name AS title FROM sakura_v2."Playlist" ORDER BY updated_at DESC LIMIT 1'],
      ["mix", 'SELECT id,name AS title FROM sakura_v2."Mix" WHERE status=\'ready\' ORDER BY generated_at DESC LIMIT 1'],
      ["share", 'SELECT slug AS id,kind,payload->>\'title\' AS title FROM sakura_v2."Share" WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 2'],
    ];
    for (const [kind, query] of queries) {
      const result = await pool.query(query);
      for (const row of result.rows) if (row.title) fixtures.push({ ...row, entity: kind });
    }
    return true;
  } catch { return false; }
  finally { await pool.end(); }
}

try {
  for (const page of OG_PAGES.filter(page => !page.route.includes("["))) {
    await checkPage(page.route, { indexable: page.visibility === "public", image: "/og/" + page.id + ".jpg" });
  }
  checks.push("All 18 ordinary URLs return anonymous WhatsApp metadata, correct canonicals, selected JPEGs, and indexing policy.");
  for (const ua of ["facebookexternalhit/1.1", "Twitterbot/1.0"]) await checkPage("/artist/deezer%3A110616822", { ua, fetchImage: false });
  checks.push("Meta and Twitter crawlers receive entity metadata inside the HTML head without a login redirect.");
  const artist = await checkPage("/artist/deezer%3A110616822", { title: "Ayra Starr · Sakura", image: "/og/artist/deezer%3A110616822", filename: "artist-live.jpg" });
  await checkImage(artist.image.pathname + artist.image.search + "&format=webp", "artist-live.webp", "webp");
  checks.push("The public catalogue artist preview shows its real name and serves both JPEG and WebP.");
  const hasDatabaseFixtures = await liveFixtures();
  for (const fixture of fixtures) {
    const share = fixture.entity === "share";
    const path = (share ? "/s/" : "/" + fixture.entity + "/") + encodeURIComponent(fixture.id);
    const title = cleanPreviewText(fixture.title, share ? 100 : 120) + (share && fixture.kind === "lyric" ? " — shared lyrics" : "") + " · Sakura";
    const response = await checkPage(path, { title, image: "/og/" + fixture.entity + "/" + encodeURIComponent(fixture.id), filename: fixture.entity + "-database-" + (fixture.kind || "preview") + ".jpg" });
    if (["share", "playlist", "mix"].includes(fixture.entity)) {
      const imageResponse = await context.request.get(base + response.image.pathname + response.image.search);
      assert.equal(imageResponse.headers()["cache-control"], "no-store");
    }
  }
  if (fixtures.length) checks.push("Available database entities, playlists, mixes, and shares return real names and public images; collection/share images prohibit HTTP caching.");
  for (const kind of ["playlists", "mixes"]) {
    const response = await context.request.get(base + "/api/v2/" + kind + "/a345cc65-cefa-42c0-9b4a-067f1fba8a61");
    assert.equal(response.status(), 401);
  }
  checks.push("Playlist and mix account APIs still reject unauthenticated requests.");
  for (const path of ["/og/profile/a345cc65-cefa-42c0-9b4a-067f1fba8a61", "/og/share/invalid", "/s/invalid"]) assert.equal((await context.request.get(base + path, { headers: { "User-Agent": "WhatsApp/2.26" } })).status(), 404);
  assert.equal((await context.request.get(base + "/og/artist/deezer%3A110616822?format=png")).status(), 400);
  const robots = await (await context.request.get(base + "/robots.txt")).text();
  assert.ok(robots.includes("Allow: /")); assert.ok(!/^Disallow: \/$/m.test(robots)); assert.ok(!robots.includes("Disallow: /og/"));
  const sitemap = await (await context.request.get(base + "/sitemap.xml")).text();
  assert.equal([...sitemap.matchAll(/<loc>/g)].length, 4);
  assert.ok(!sitemap.includes("/library") && !sitemap.includes("/profile"));
  checks.push("Missing/invalid preview inputs are rejected, and robots plus sitemap permit public discovery without listing account pages.");
  const landing = await context.newPage();
  inspectedPage = landing;
  landing.on("pageerror", error => pageErrors.push(error.message));
  await landing.goto(base + "/", { waitUntil: "domcontentloaded" });
  await landing.getByRole("heading", { name: "Your little music world." }).waitFor();
  assert.equal(await landing.title(), "Sakura — your little music world");
  assert.ok(await landing.locator('script[type="application/ld+json"]').count());
  await landing.screenshot({ path: resolve(output, "landing-desktop.png"), fullPage: true });
  await landing.setViewportSize({ width: 390, height: 844 });
  assert.equal(await landing.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await landing.screenshot({ path: resolve(output, "landing-mobile.png"), fullPage: true });
  checks.push("The public homepage has useful content, a single branded title, structured data, and a fitting mobile layout.");

  // Exercise real preference controls with an isolated synthetic account; no DB writes.
  const device = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1280, height: 900 }, colorScheme: "light" });
  const account = { id: "a345cc65-cefa-42c0-9b4a-067f1fba8a62", username: "Preview test", email: "preview@example.invalid" };
  const settings = { ...DEFAULT_SETTINGS, theme: "light", openingAnimation: 0, onboarded: true, revision: 0, fieldRevisions: {} };
  let failSaves = false, failReads = false, attempted = 0, settingsReads = 0;
  await device.addInitScript(() => sessionStorage.setItem("sakura-ink-opening", "1"));
  await device.route("**/api/**", async route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    if (["/api/v2/bootstrap", "/api/v2/profile"].includes(path)) return route.fulfill({ json: { profile: account } });
    if (path === "/api/v2/settings") {
      if (req.method() === "PATCH") {
        attempted++;
        if (failSaves) return route.abort("internetdisconnected");
        const { expectedRevision, ...patch } = req.postDataJSON();
        assert.equal(expectedRevision, settings.revision);
        const revision = settings.revision + 1;
        Object.assign(settings, patch, { revision, fieldRevisions: { ...settings.fieldRevisions, ...Object.fromEntries(Object.keys(patch).map(key => [key, revision])) } });
      } else { settingsReads++; if (failReads) return route.abort("internetdisconnected"); }
      return route.fulfill({ json: settings });
    }
    if (path === "/api/v2/library/state") return route.fulfill({ json: { favoriteStates: {} } });
    if (path === "/api/v2/listening-session") return route.fulfill({ json: { session: null, serverTime: Date.now() } });
    if (path === "/api/v2/taste") return route.fulfill({ json: { feedback: [], tasteEvidence: [], historyClearedAt: null } });
    if (path === "/api/auth/session") return route.fulfill({ json: { user: account } });
    return route.fulfill({ json: { items: [], recordings: [], playlists: [] } });
  });
  const preferences = await device.newPage();
  inspectedPage = preferences;
  const draft = () => preferences.evaluate(id => JSON.parse(localStorage.getItem("sakura-v2-preferences:" + id) || "null"), account.id);
  preferences.on("pageerror", error => pageErrors.push(error.message));
  preferences.setDefaultTimeout(60_000);
  await preferences.goto(base + "/settings", { waitUntil: "domcontentloaded" });
  await preferences.getByRole("heading", { name: "Just the way you like it." }).waitFor();
  await expect.poll(() => settingsReads).toBeGreaterThan(0);
  await expect.poll(() => preferences.evaluate(() => document.documentElement.dataset.inkTheme)).toBe("light");
  await expect.poll(async () => (await draft())?.serverRevision).toBe(0);
  await preferences.evaluate(() => {
    window.preferenceNotices = [];
    new MutationObserver(() => {
      const notices = [...document.querySelectorAll('[role="alert"], [role="status"]')].map(node => node.textContent || "");
      for (const text of notices) if (/preferences.*saved.*device|preferences are saved here/i.test(text)) window.preferenceNotices.push(text);
    }).observe(document.body, { subtree: true, childList: true });
  });
  failSaves = true;
  await preferences.getByRole("button", { name: "Change appearance", exact: true }).click();
  await expect.poll(() => attempted).toBeGreaterThan(0);
  await expect.poll(async () => (await draft())?.pendingPatch?.theme).toBe("dark");
  await preferences.waitForTimeout(400);
  assert.deepEqual(await preferences.evaluate(() => window.preferenceNotices), []);
  assert.deepEqual((await preferences.locator('[role="alert"]').allTextContents()).filter(text => text.trim()), []);
  failReads = true;
  await preferences.reload({ waitUntil: "domcontentloaded" });
  await expect.poll(() => preferences.evaluate(() => document.documentElement.dataset.inkTheme)).toBe("dark");
  await preferences.waitForTimeout(400);
  assert.deepEqual((await preferences.locator('[role="alert"]').allTextContents()).filter(text => text.trim()), []);
  failSaves = false;
  failReads = false;
  await preferences.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(() => settings.theme, { timeout: 20_000 }).toBe("dark");
  await expect.poll(async () => (await draft())?.pending, { timeout: 20_000 }).toBe(false);
  checks.push("A failed preference sync stays quiet, survives reload, and synchronizes the pending choice after reconnecting.");
  await preferences.screenshot({ path: resolve(output, "preferences-after-reconnect.png"), fullPage: true });
  await device.close();
  assert.deepEqual(pageErrors, []);
  const report = { passed: checks.length, checks, databaseFixturesAvailable: hasDatabaseFixtures, databaseEntityKinds: [...new Set(fixtures.map(item => item.entity))], pageErrors };
  await writeFile(resolve(output, "browser-report.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
} catch (error) {
  await inspectedPage?.screenshot({ path: resolve(output, "browser-failure.png"), fullPage: true }).catch(() => {});
  const alerts = await inspectedPage?.locator('[role="alert"]').allTextContents().catch(() => []);
  console.error(JSON.stringify({ checks, alerts, pageErrors }));
  throw error;
} finally { await browser.close(); }
