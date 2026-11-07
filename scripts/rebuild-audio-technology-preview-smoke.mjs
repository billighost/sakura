import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";

const base = process.env.SAKURA_AUDIO_PREVIEW_URL || "http://127.0.0.1:8766";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const report = [];
try {
  for (const width of [1440, 390, 320]) {
    const page = await browser.newPage({ viewport: { width, height: width === 1440 ? 1050 : 844 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(base, { waitUntil: "networkidle" });
    await expect(page.locator(".mode")).toHaveCount(6);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await page.getByRole("button", { name: "Play original", exact: true }).click();
    await expect.poll(() => page.evaluate(() => side)).toBe("original");
    await expect.poll(() => page.evaluate(() => cursor())).toBeGreaterThan(0.3);
    const before = await page.evaluate(() => cursor());
    await page.getByRole("button", { name: "Play enhanced", exact: true }).click();
    await expect.poll(() => page.evaluate(() => side)).toBe("enhanced");
    const after = await page.evaluate(() => cursor());
    assert.ok(after >= before - 0.05 && after - before < 1.5);
    for (const name of ["Warmth", "Punch", "Night", "Headphones", "None", "Clarity"]) {
      await page.getByRole("button", { name, exact: true }).click();
      await expect.poll(() => page.evaluate(() => side)).toBe("enhanced");
      await expect(page.locator("#modeName")).toHaveText(name);
    }
    await page.getByLabel("Preview volume", { exact: true }).fill("0");
    assert.equal(await page.evaluate(() => Number(document.getElementById("volume").value)), 0);
    await page.getByLabel("Comparison position", { exact: true }).fill("12");
    await expect.poll(() => page.evaluate(() => cursor())).toBeGreaterThan(11.9);
    await page.getByRole("button", { name: "Play enhanced", exact: true }).click();
    await expect.poll(() => page.evaluate(() => side)).toBe(null);
    const stopped = await page.evaluate(() => cursor());
    await page.waitForTimeout(150);
    assert.ok(Math.abs(await page.evaluate(() => cursor()) - stopped) < 0.01);
    await mkdir(".local/audio-technology", { recursive: true });
    await page.screenshot({ path: `.local/audio-technology/preview-${width}.png`, fullPage: true });
    assert.deepEqual(errors, []);
    report.push({ width, modes: 6, preservesPosition: true, noOverflow: true, pauseAndSeek: true, errors });
    await page.close();
  }
  await writeFile(".local/audio-technology/preview-browser-report.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally { await browser.close(); }
