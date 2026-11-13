import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import sharp from "sharp";
import { OG_IMAGE_REVISION } from "../src/rebuild/og/selections.ts";

// Read-only release checks: no session cookies, account fixtures, or API writes.
// node --import tsx scripts/og-whatsapp-live.mjs [https://sakuraplayer.vercel.app]
const base = new URL(process.argv[2] || process.env.SAKURA_TEST_URL || "https://sakuraplayer.vercel.app");
const local = ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname);
assert.ok(base.protocol === "https:" || (local && base.protocol === "http:"));
const output = resolve(".local/whatsapp/release");
await mkdir(output, { recursive: true });
const manifest = JSON.parse(await readFile("public/og/manifest.json", "utf8"));
const rootImage = manifest.images.find(image => image.page === "default" && image.format === "jpeg");
const agents = {
  web: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  whatsapp: "WhatsApp/2.26",
  facebook: "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
  fetcher: "Meta-ExternalFetcher/1.1",
  agent: "meta-externalagent/1.1",
  twitter: "Twitterbot/1.0",
};
const cases = [
  ...Object.keys(agents).map(agent => ({ path: "/", agent })),
  { path: `/?preview=whatsapp-${OG_IMAGE_REVISION}`, agent: "web" },
  ...["whatsapp", "facebook", "fetcher", "agent", "twitter"].map(agent => ({ path: "/artist/deezer%3A110616822", agent })),
];
const decode = text => text?.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
function meta(html, name) {
  const tag = [...html.matchAll(/<meta\s[^>]*>/gi)].map(match => match[0]).find(tag => /(?:name|property)="([^"]+)"/.exec(tag)?.[1] === name);
  return decode(tag && /content="([^"]*)"/.exec(tag)?.[1]);
}
const report = { base: base.origin, revision: OG_IMAGE_REVISION, checks: [], failures: [] };
const images = new Map();
for (const { path, agent } of cases) {
  const start = performance.now();
  try {
    const headers = { "User-Agent": agents[agent], "Accept-Encoding": "gzip, deflate", Accept: "text/html,*/*" };
    const response = await fetch(new URL(path, base), { headers, redirect: "manual", signal: AbortSignal.timeout(12_000) });
    assert.equal(response.status, 200, "Public preview HTML must not redirect to sign-in");
    assert.match(response.headers.get("content-type") || "", /text\/html/);
    const html = await response.text();
    const headEnd = html.indexOf("</head>");
    assert.ok(headEnd > 0, "The HTML contains a head");
    const head = html.slice(0, headEnd);
    for (const field of ["og:title", "og:description", "og:url", "og:image", "og:image:alt", "og:site_name"]) assert.ok(meta(head, field), `${field} is in the initial head for ${agent}`);
    assert.ok(Buffer.byteLength(head) < 64 * 1024, "Preview metadata appears before a small scraper's cutoff");
    assert.equal(meta(head, "og:image:type"), "image/jpeg");
    assert.equal(meta(head, "og:image:width"), "1200");
    assert.equal(meta(head, "og:image:height"), "630");
    assert.equal(meta(head, "twitter:card"), "summary_large_image");
    assert.equal(meta(head, "twitter:image"), meta(head, "og:image"));
    const canonical = new URL(meta(head, "og:url"));
    const advertised = new URL(meta(head, "og:image"));
    assert.equal(canonical.pathname, new URL(path, base).pathname);
    assert.equal(advertised.origin, canonical.origin, "The image uses the configured public origin");
    if (!local) assert.equal(advertised.origin, base.origin, "The advertised image must belong to this deployment");
    assert.equal(advertised.searchParams.get("v"), OG_IMAGE_REVISION, "The deployment uses the current image revision");
    const htmlMs = Math.round(performance.now() - start);
    const imageUrl = local ? new URL(advertised.pathname + advertised.search, base) : advertised;
    const imageKey = imageUrl.href + " " + agent;
    let image = images.get(imageKey);
    if (!image) {
      const imageStart = performance.now();
      const fetched = await fetch(imageUrl, { headers: { "User-Agent": agents[agent], Accept: "image/jpeg", "Accept-Encoding": "identity" }, redirect: "manual", signal: AbortSignal.timeout(15_000) });
      assert.equal(fetched.status, 200, "The exact advertised image URL must return an image");
      assert.match(fetched.headers.get("content-type") || "", /^image\/jpeg(?:;|$)/);
      const bytes = Buffer.from(await fetched.arrayBuffer());
      const info = await sharp(bytes).metadata();
      assert.equal(info.width, 1200); assert.equal(info.height, 630);
      assert.equal(info.format, "jpeg"); assert.equal(info.space, "srgb");
      assert.ok(bytes.length < 250_000, "Preview images stay compact");
      if (canonical.pathname === "/") assert.equal(createHash("sha256").update(bytes).digest("hex"), rootImage.sha256, "The deployed root image matches the selected release asset");
      const filename = canonical.pathname === "/" ? "website.jpg" : "artist.jpg";
      await writeFile(resolve(output, filename), bytes);
      image = { url: advertised.href, bytes: bytes.length, ms: Math.round(performance.now() - imageStart) };
      images.set(imageKey, image);
    }
    report.checks.push({ path, agent, title: meta(head, "og:title"), headBytes: Buffer.byteLength(head), htmlMs, image });
  } catch (error) {
    report.failures.push({ path, agent, message: error instanceof Error ? error.message : String(error) });
  }
}
await writeFile(resolve(output, "report.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
if (report.failures.length) process.exitCode = 1;
