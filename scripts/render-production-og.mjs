import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { OG_PAGES, OG_SIZE } from "../src/rebuild/og/catalog.ts";
import { ogDirectionFor, OG_IMAGE_REVISION } from "../src/rebuild/og/selections.ts";
import { renderOgImage } from "../src/rebuild/og/image.tsx";
import { encodeOgImage } from "../src/rebuild/og/encode.ts";
import { staticOgData } from "../src/rebuild/seo/metadata.ts";

const directory = resolve("public/og");
await mkdir(directory, { recursive: true });
const manifest = { revision: OG_IMAGE_REVISION, dimensions: OG_SIZE, images: [] };
for (const sample of OG_PAGES) {
  const page = staticOgData(sample.id);
  const direction = ogDirectionFor(page.id);
  const response = await renderOgImage(page, direction);
  const png = new Uint8Array(await response.arrayBuffer());
  for (const format of ["jpeg", "webp"]) {
    const bytes = await encodeOgImage(png, format);
    const metadata = await sharp(bytes).metadata();
    assert.equal(metadata.width, OG_SIZE.width);
    assert.equal(metadata.height, OG_SIZE.height);
    assert.ok(bytes.length < 250_000, "Static OG images must stay below 250 KB.");
    const file = `${page.id}.${format === "jpeg" ? "jpg" : "webp"}`;
    await writeFile(resolve(directory, file), bytes);
    manifest.images.push({ page: page.id, direction, format, file, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
  }
  console.log(`Rendered ${page.label}: ${direction.toUpperCase()}`);
}
await writeFile(resolve(directory, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify({ images: manifest.images.length, largestBytes: Math.max(...manifest.images.map(image => image.bytes)), directory }));
