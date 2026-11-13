import { mkdir, writeFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const destination = resolve("public/og-preview/fonts");
const staging = resolve(".local/og-fonts");
await Promise.all([mkdir(destination, { recursive: true }), mkdir(staging, { recursive: true })]);
const families = [
  { name: "Fraunces", query: "Fraunces:ital,opsz,wght@0,72,600;1,72,600", license: "fraunces" },
  { name: "Inter", query: "Inter:wght@400;600", license: "inter" },
  ...["JP", "SC", "KR", "Arabic", "Devanagari", "Thai", "Hebrew"].map(script => ({ name: "Noto Sans " + script, query: "Noto+Sans+" + script + ":wght@400", license: "notosans" + script.toLowerCase(), fallback: true })),
];
const sources = [];
async function download(url, file) {
  try { if ((await stat(file)).size > 0) return; } catch {}
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (!response.ok) throw new Error(`Font download failed (${response.status}): ${url}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      await writeFile(file, bytes);
      return;
    } catch (error) { if (attempt === 1) throw error; console.log("Retrying " + url); }
  }
}
for (const family of families) {
  const response = await fetch("https://fonts.googleapis.com/css2?family=" + family.query, { headers: { "User-Agent": "Sakura fonts" }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error("Unable to resolve " + family.name);
  const css = await response.text();
  for (const [, rule] of css.matchAll(/@font-face\s*\{([^}]+)\}/g)) {
    const url = /src:\s*url\(([^)]+)\)/.exec(rule)?.[1];
    const weight = Number(/font-weight:\s*(\d+)/.exec(rule)?.[1]);
    const style = /font-style:\s*(\w+)/.exec(rule)?.[1];
    if (!url || !weight || !style || !rule.includes("format('truetype')")) throw new Error("Expected a static TrueType font.");
    const file = family.fallback ? family.license + ".ttf" : `${family.name.toLowerCase()}-${weight}-${style}.ttf`;
    const source = family.name === "Noto Sans JP" ? "https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-jp@5.2.8/files/noto-sans-jp-japanese-400-normal.woff" : family.name === "Noto Sans SC" ? "https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-sc/files/noto-sans-sc-chinese-simplified-400-normal.woff" : family.name === "Noto Sans KR" ? "https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-kr/files/noto-sans-kr-korean-400-normal.woff" : url;
    await download(source, resolve(family.fallback ? staging : destination, file));
    sources.push({ family: family.name, file, url: source, weight, style, fallback: Boolean(family.fallback) });
  }
  await download(`https://raw.githubusercontent.com/google/fonts/main/ofl/${family.license}/OFL.txt`, resolve(destination, family.license + "-OFL.txt"));
  console.log("Prepared " + family.name);
}
await writeFile(resolve(staging, "sources.json"), JSON.stringify(sources));
// Local Unicode shards keep each request's font parsing small and require no font CDN.
const prepared = spawnSync("python", [resolve("scripts/subset-og-fonts.py"), destination, staging], { encoding: "utf8", windowsHide: true });
if (prepared.status !== 0) throw new Error(prepared.stderr || "Font preparation failed.");
console.log(prepared.stdout.trim());
