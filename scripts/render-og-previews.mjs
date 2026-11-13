import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { OG_PAGES, OG_DIRECTIONS, OG_SIZE, getOgPreviewPage } from "../src/rebuild/og/catalog.ts";
import { renderOgPreview } from "../src/rebuild/og/image.tsx";

const directory = resolve(".local/og-preview");
await mkdir(resolve(directory, "png"), { recursive: true });
const filter = process.argv.find(argument => argument.startsWith("--pages="))?.slice(8).split(",");
const fixture = process.argv.includes("--long") ? "long" : process.argv.includes("--missing") ? "missing" : "original";
const pages = filter ? OG_PAGES.filter(page => filter.includes(page.id)) : OG_PAGES;
assert.ok(pages.length, "Select at least one known preview page.");
const manifest = { dimensions: OG_SIZE, fixture, generator: "scripts/render-og-previews.mjs", images: [] };
for (const original of pages) {
  const page = getOgPreviewPage(original.id, fixture);
  for (const direction of OG_DIRECTIONS) {
    const response = await renderOgPreview(page, direction.id);
    const png = Buffer.from(await response.arrayBuffer());
    assert.equal(png.subarray(1, 4).toString(), "PNG");
    assert.equal(png.readUInt32BE(16), OG_SIZE.width);
    assert.equal(png.readUInt32BE(20), OG_SIZE.height);
    assert.ok(png.length < 1_000_000, "Previews should stay comfortably below 1 MB.");
    const file = `${page.id}-${direction.id}${fixture === "original" ? "" : "-" + fixture}.png`;
    await writeFile(resolve(directory, "png", file), png);
    manifest.images.push({ page: page.id, label: page.label, direction: direction.id, name: direction.name, file: "png/" + file, bytes: png.length, sha256: createHash("sha256").update(png).digest("hex") });
  }
  console.log(`Rendered ${page.label}: A, B, C`);
}
await writeFile(resolve(directory, `manifest-${fixture}.json`), JSON.stringify(manifest, null, 2) + "\n");

const sheet = spawnSync("python", ["-c", [
  "from PIL import Image, ImageDraw",
  "from pathlib import Path",
  "import json, sys",
  "directory = Path(sys.argv[1])",
  "manifest = json.loads((directory / sys.argv[2]).read_text(encoding='utf-8'))",
  "images = manifest['images']",
  "rows = min(len(images) // 3, 10)",
  "for part in range((len(images) // 3 + rows - 1) // rows):",
  " selected = images[part * rows * 3:(part + 1) * rows * 3]",
  " canvas = Image.new('RGB', (1836, (len(selected) // 3) * 355 + 20), '#f5f5ee')",
  " draw = ImageDraw.Draw(canvas)",
  " for index, item in enumerate(selected):",
  "  x = 12 + (index % 3) * 608; y = 12 + (index // 3) * 355",
  "  source = Image.open(directory / item['file']).convert('RGB').resize((596, 313), Image.Resampling.LANCZOS)",
  "  canvas.paste(source, (x, y))",
  "  draw.text((x + 4, y + 322), item['label'] + ' / ' + item['direction'].upper() + ' / ' + item['name'], fill='#273b34')",
  " canvas.save(directory / ('contact-sheet-' + manifest['fixture'] + '-' + str(part + 1) + '.jpg'), quality=92)",
].join("\n"), directory, `manifest-${fixture}.json`], { encoding: "utf8", windowsHide: true });
if (sheet.status !== 0) throw new Error(sheet.stderr || "Unable to render the contact sheets.");
console.log(JSON.stringify({ images: manifest.images.length, fixture, largestBytes: Math.max(...manifest.images.map(item => item.bytes)), directory }));
