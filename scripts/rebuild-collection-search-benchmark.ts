/** Source CPU comparison; excludes browser rendering and network latency. */
import { writeFile, mkdir } from "node:fs/promises";
import { CollectionSearchIndex, collectionSearchWords } from "../src/rebuild/app/collectionSearch";
import { sortRoomTracks } from "../src/rebuild/app/trackSorting";
import type { MusicTrack } from "../src/rebuild/app/types";

// Exact original HEAD normalization and filter path, verified during Phase 1.
const legacyText = (value: string) => value.normalize("NFKC")
  .replace(/\p{Script=Latin}\p{M}*/gu, span => span.normalize("NFKD").replace(/\p{M}/gu, ""))
  .toLowerCase().replace(/[^\p{L}\p{N}\p{M}]+/gu, " ").trim();
function legacyMatch(track: MusicTrack, query: string) {
  const words = legacyText(query).split(" ").filter(Boolean);
  if (!words.length) return true;
  const text = legacyText([track.title, ...track.artists, ...(track.artistCredits || []).map(credit => credit.name),
    track.albumTitle || "", track.versionLabel, ...(track.alternateTitles || [])].join(" "));
  return words.every(word => text.includes(word));
}
function cards(size: number): MusicTrack[] {
  return Array.from({ length: size }, (_, i) => ({ id: String(i), title: "Canci\u00f3n " + i + " \u590f\u306e\u97f3\u697d",
    artists: ["Beyonc\u00e9", "\u6b4c\u624b"], artistCredits: [{ name: "Featured voice", role: "featured" }],
    albumTitle: "\u590f\u306e\u5ead / The summer garden", versionLabel: "Original recording", alternateTitles: ["\ubcc4\ube5b"],
    durationMs: 180000 + i, coverUrl: null, albumId: null, artistId: null, reference: { provider: "deezer", id: String(i) }, references: [] }));
}
const quantile = (values: number[], q: number) => [...values].sort((a, b) => a - b)[Math.floor(values.length * q)];
async function sample(run: () => unknown | Promise<unknown>) {
  const values: number[] = [];
  for (let pass = 0; pass < 30; pass++) { const start = performance.now(); await run(); if (pass >= 5) values.push(performance.now() - start); }
  return { medianMs: quantile(values, .5), p95Ms: quantile(values, .95), samples: values.length };
}
async function main() {
const report = { checkedAt: new Date().toISOString(), scope: "Node source CPU on this machine; not browser/production performance", methodology: "25 samples after 5 warmups; baseline exact legacy per-track normalization/filter plus title sort; current memoized title order and asynchronous indexed filter. Cold index cost/yields reported separately.", rows: [] as unknown[] };
for (const size of [100, 1000, 5000]) {
  const tracks = cards(size), words = collectionSearchWords("cancion beyonce"), sorted = sortRoomTracks(tracks, "title", "asc");
  const baseline = await sample(() => sortRoomTracks(tracks.filter(track => legacyMatch(track, "cancion beyonce")), "title", "asc"));
  const coldSamples: number[] = [], chunks: number[] = [];
  for (let pass = 0; pass < 10; pass++) {
    const index = new CollectionSearchIndex(); let yields = 0;
    const start = performance.now();
    await index.filter(sorted, words, { yield: async () => { yields++; await new Promise<void>(resolve => setTimeout(resolve, 0)); } });
    coldSamples.push(performance.now() - start); chunks.push(yields);
  }
  const index = new CollectionSearchIndex(); await index.filter(sorted, words);
  const current = await sample(() => index.filter(sorted, words));
  report.rows.push({ size, baseline, currentWarm: current, coldIndex: { medianMs: quantile(coldSamples, .5), p95Ms: quantile(coldSamples, .9), yields: chunks } });
}
await mkdir(".local", { recursive: true });
await writeFile(".local/collection-search-source-benchmark.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

}
void main().catch(error => { console.error(error); process.exitCode = 1; });
