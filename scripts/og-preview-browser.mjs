import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import { OG_SELECTIONS } from "../src/rebuild/og/selections.ts";

const base = process.env.SAKURA_TEST_URL || "http://localhost:3000";
const output = resolve(".local/og-preview");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1, colorScheme: "light", serviceWorkers: "block", reducedMotion: "reduce", acceptDownloads: true });
const page = await context.newPage();
page.setDefaultTimeout(60_000);
const errors = [];
const checks = [];
page.on("pageerror", error => errors.push(error.message));
async function imagesReady(scope = "[data-og-option]") {
  await page.waitForFunction(selector => {
    const images = [...document.querySelectorAll(selector + " img")];
    return images.length > 0 && images.every(image => image.complete && image.naturalWidth === 1200 && image.naturalHeight === 630);
  }, scope);
}

try {
  const response = await page.goto(base + "/og-preview", { waitUntil: "load", timeout: 120_000 });
  assert.equal(response?.status(), 200);
  assert.equal(new URL(page.url()).pathname, "/og-preview", "The review gallery is accessible without an account.");
  await page.getByRole("heading", { name: "Good music deserves a beautiful hello." }).waitFor();
  await imagesReady();
  assert.equal(await page.locator('meta[name="robots"]').getAttribute("content"), "noindex, nofollow");
  assert.equal(await page.locator("[data-og-option]").count(), 3);
  assert.equal(await page.locator('[data-og-option="c"] button[aria-pressed="true"]').count(), 1);
  checks.push("Public, non-indexed gallery renders three 1200 × 630 WebP previews with the approved default selected.");
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: resolve(output, "gallery-desktop.png"), fullPage: true });

  await page.getByRole("button", { name: "Choose A", exact: true }).click();
  await page.getByLabel("Preview page", { exact: true }).selectOption("artist");
  await imagesReady();
  await page.getByRole("button", { name: "Choose C", exact: true }).click();
  await page.getByRole("button", { name: "Choose B", exact: true }).click();
  assert.equal(await page.locator('[data-og-option="b"] button[aria-pressed="true"]').count(), 1);
  await page.reload({ waitUntil: "load" });
  await imagesReady();
  await page.waitForFunction(() => document.querySelector('[data-og-option="b"] button[aria-pressed="true"]') !== null);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("sakura-og-preview-choices-v1") || "{}"));
  assert.deepEqual(saved, { ...OG_SELECTIONS, default: "a", artist: "b" });
  checks.push("Per-page choices survive a reload and preserve earlier page selections.");
  await page.screenshot({ path: resolve(output, "gallery-artist-desktop.png"), fullPage: true });

  await page.getByRole("button", { name: "Enlarge Artist option B", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  await imagesReady("dialog");
  await page.screenshot({ path: resolve(output, "gallery-full-size.png") });
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("dialog").isVisible(), false);
  checks.push("The full-size viewer shows the generated image and supports keyboard dismissal.");

  await page.getByRole("button", { name: "WhatsApp", exact: true }).click();
  await imagesReady();
  assert.equal(await page.locator("[data-whatsapp-preview]").count(), 3);
  await page.screenshot({ path: resolve(output, "gallery-whatsapp.png"), fullPage: true });
  checks.push("WhatsApp-style cards compare all three designs at chat size.");

  await page.getByLabel("Preview sample", { exact: true }).selectOption("missing");
  await imagesReady();
  await page.getByLabel("Preview sample", { exact: true }).selectOption("long");
  await imagesReady();
  checks.push("Long-title and missing-artwork previews generate successfully in the gallery.");
  await page.getByLabel("Preview sample", { exact: true }).selectOption("original");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save choices", exact: true }).click();
  const download = await downloadPromise;
  const selectionFile = resolve(output, "choices-browser-test.txt");
  await download.saveAs(selectionFile);
  const selection = await readFile(selectionFile, "utf8");
  assert.ok(selection.includes("Website & fallback (/): A — Paper & Petals"));
  assert.ok(selection.includes("Artist (/artist/[id]): B — After Hours"));
  assert.ok(selection.includes("Playlist (/playlist/[id]): B — After Hours"));
  checks.push("Selection download preserves all approved choices alongside edits made in the gallery.");

  const pngDownloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download Artist option B PNG", exact: true }).click();
  const pngDownload = await pngDownloadPromise;
  const pngPath = resolve(output, "download-browser-test.png");
  await pngDownload.saveAs(pngPath);
  const png = await readFile(pngPath);
  assert.equal(png.subarray(1, 4).toString(), "PNG");
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
  checks.push("Individual PNG download retains the full OG dimensions.");

  await page.getByRole("button", { name: "Image", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel("Preview page", { exact: true }).selectOption("default");
  await imagesReady();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, "Mobile gallery must not overflow horizontally.");
  await page.screenshot({ path: resolve(output, "gallery-mobile.png"), fullPage: true });
  await page.getByRole("button", { name: "Enlarge Website & fallback option C", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  await imagesReady("dialog");
  assert.equal(await page.evaluate(() => { const box = document.querySelector("dialog").getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth; }), true);
  await page.getByRole("button", { name: "Close full size preview", exact: true }).click();
  checks.push("390 px mobile layout and full-size viewer fit the viewport.");

  for (const [query, status] of [["page=missing", 404], ["page=artist&option=d", 400], ["page=artist&sample=unknown", 400]]) {
    const invalid = await context.request.get(base + "/og-preview/render?" + query);
    assert.equal(invalid.status(), status);
    assert.equal(invalid.headers()["x-robots-tag"], "noindex, nofollow");
  }
  const crawler = await context.request.get(base + "/og-preview/render?page=default&option=a", { headers: { "User-Agent": "WhatsApp/2.26" } });
  assert.equal(crawler.status(), 200);
  assert.equal(crawler.headers()["content-type"], "image/png");
  assert.equal(crawler.headers()["x-robots-tag"], "noindex, nofollow");
  checks.push("Preview image endpoint rejects unknown inputs and serves PNG to an unauthenticated WhatsApp user agent.");

  assert.deepEqual(errors, [], "Gallery must render without browser exceptions.");
  await writeFile(resolve(output, "browser-report.json"), JSON.stringify({ passed: checks.length, checks, pageErrors: errors }, null, 2) + "\n");
  console.log(JSON.stringify({ passed: checks.length, checks, output }));
} catch (error) {
  await page.screenshot({ path: resolve(output, "browser-failure.png"), fullPage: true }).catch(() => {});
  console.error(JSON.stringify({ checks, pageErrors: errors }));
  throw error;
} finally {
  await browser.close();
}
