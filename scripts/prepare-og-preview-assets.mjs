import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import "./prepare-og-fonts.mjs";

// Public catalogue illustrations only. No account data or audio is downloaded.
const directory = resolve("public/og-preview");
await mkdir(resolve(directory, "fonts"), { recursive: true });
await mkdir(resolve(directory, "artwork"), { recursive: true });

async function download(url, destination) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Asset request failed (${response.status}): ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(destination, bytes);
  return bytes.length;
}

const fonts = JSON.parse(await readFile(resolve(directory, "fonts/fallbacks.json"), "utf8")).sources;

const illustrations = [
  { file: "ayra-portrait.jpg", title: "Ayra Starr", kind: "artist", providerId: "110616822", url: "https://cdn-images.dzcdn.net/images/artist/dbbf92fde4a28452a455f885b065008e/1000x1000-000000-80-0-0.jpg" },
  { file: "ayra-album.jpg", title: "The Year I Turned 21", kind: "album", providerId: "591361242", url: "https://cdn-images.dzcdn.net/images/cover/d096ea1c1019d1af67c0a2e434890e1e/1000x1000-000000-80-0-0.jpg" },
  { file: "rema-album.jpg", title: "HEIS", kind: "album", providerId: "611102372", url: "https://cdn-images.dzcdn.net/images/cover/4891a944de9418f059cabda0c7699160/1000x1000-000000-80-0-0.jpg" },
  { file: "burna-album.jpg", title: "Love, Damini", kind: "album", providerId: "317928987", url: "https://cdn-images.dzcdn.net/images/cover/db5eb0966610c92af8a685ea3032ef4d/1000x1000-000000-80-0-0.jpg" },
];
for (const illustration of illustrations) {
  await download(illustration.url, resolve(directory, "artwork", illustration.file));
}
// Reuse Sakura's existing, code-authored Bloom world rather than inventing its art.
const convert = spawnSync("python", ["-c", [
  "from PIL import Image",
  "from pathlib import Path",
  "import sys, json",
  "destination = Path(sys.argv[1])",
  "for file in destination.glob('*.jpg'):",
  " image = Image.open(file).convert('RGB')",
  " image.thumbnail((800, 800), Image.Resampling.LANCZOS)",
  " image.save(file, 'JPEG', quality=88, optimize=True)",
  "for theme in ('light', 'dark'):",
  " image = Image.open(Path('public/bloom/covers') / ('sakura-' + theme + '-960.webp')).convert('RGB')",
  " image.save(destination / ('bloom-' + theme + '.jpg'), 'JPEG', quality=90, optimize=True)",
].join("\n"), resolve(directory, "artwork")], { encoding: "utf8", windowsHide: true });
if (convert.status !== 0) throw new Error(convert.stderr || "Unable to prepare the artwork.");

await writeFile(resolve(directory, "asset-sources.json"), JSON.stringify({
  purpose: "Illustrative OG design previews; catalogue artwork belongs to its respective owners.",
  fonts,
  illustrations,
  bloom: { source: "public/bloom/covers/sakura-{light,dark}-960.webp", generator: "scripts/rebuild-bloom-covers.mjs" },
}, null, 2) + "\n");
console.log(`Prepared ${illustrations.length + 2} local illustrations and ${fonts.length} local fonts.`);
// Assert the source cover exists so the command fails clearly after a partial checkout.
await readFile("public/bloom/covers/sakura-light-960.webp");
